import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  bodyExpCostForStage,
  bodyRateForRealm,
  computeBodyStatBonus,
  computeBreakthroughChance,
  fullBodyRealmName,
  getBodyRealmByKey,
  BODY_REALMS,
  evaluateBreakthroughOutcome,
  expCostForStage,
  getCultivationMethodDef,
  nextRealm,
  titleForRealmMilestone,
  tribulationRequiredForBreakthrough,
  type BreakthroughChanceBreakdown,
  type CharacterStatePayload,
  type ElementKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AchievementService } from './achievement.service';
import { BuffService } from './buff.service';
import { SpiritualRootService } from './spiritual-root.service';
import { CultivationMethodService } from './cultivation-method.service';
import { CharacterSkillService } from './character-skill.service';
import { TitleService } from './title.service';

interface OnboardInput {
  name: string;
  sectKey: 'thanh_van' | 'huyen_thuy' | 'tu_la';
}

const SECT_NAMES: Record<OnboardInput['sectKey'], string> = {
  thanh_van: 'Thanh Vân Môn',
  huyen_thuy: 'Huyền Thuỷ Cung',
  tu_la: 'Tu La Tông',
};

const SECT_STARTING_STATS: Record<
  OnboardInput['sectKey'],
  { power: number; spirit: number; speed: number; luck: number; hpMax: number; mpMax: number }
> = {
  thanh_van: { power: 14, spirit: 8, speed: 12, luck: 5, hpMax: 100, mpMax: 50 },
  huyen_thuy: { power: 8, spirit: 14, speed: 8, luck: 6, hpMax: 130, mpMax: 70 },
  tu_la: { power: 16, spirit: 6, speed: 10, luck: 4, hpMax: 90, mpMax: 40 },
};

class DomainError extends Error {
  constructor(
    public code:
      | 'NAME_TAKEN'
      | 'ALREADY_ONBOARDED'
      | 'NO_CHARACTER'
      | 'NOT_AT_PEAK'
      | 'TRIBULATION_REQUIRED',
  ) {
    super(code);
  }
}

/**
 * Phase 11 nâng cao §5 PR2 wire — error class cho `attemptBreakthrough()`.
 * Tách bạch khỏi `DomainError` (deterministic `breakthrough()`) vì RNG path
 * có thêm `INVALID_RNG` defensive throw khi caller pass roll out-of-range.
 * Controller map → HTTP code:
 *   - `NO_CHARACTER` → 404
 *   - `NOT_AT_PEAK` → 409
 *   - `INVALID_RNG` → 400 (caller bug, server tự throw nếu rng fn lỗi)
 */
export class BreakthroughError extends Error {
  constructor(
    public code: 'NO_CHARACTER' | 'NOT_AT_PEAK' | 'INVALID_RNG',
  ) {
    super(code);
  }
}

/**
 * Phase 11 nâng cao §5 PR2 wire — outcome shape của `attemptBreakthrough()`.
 * Mirror `TribulationAttemptOutcome` pattern (Phase 11.6.B). FE consume
 * `breakdown` cho tooltip, `rngRoll` cho replay debug, `success` cho UI
 * branching, `debuff` fields cho Tâm Ma countdown render.
 */
export interface BreakthroughAttemptOutcome {
  readonly success: boolean;
  readonly fromRealmKey: string;
  readonly fromRealmStage: number;
  readonly toRealmKey: string;
  readonly toRealmStage: number;
  readonly breakdown: BreakthroughChanceBreakdown;
  readonly rngRoll: number;
  readonly attemptIndex: number;
  readonly logId: string;
  readonly debuffApplied: boolean;
  readonly debuffKey: 'tam_ma_light' | null;
  readonly debuffExpiresAt: Date | null;
  readonly character: CharacterStatePayload;
}

type CharRow = Prisma.CharacterGetPayload<{ include: { sect: true; user: true } }>;

const SECT_NAME_TO_KEY: Record<string, OnboardInput['sectKey']> = {
  'Thanh Vân Môn': 'thanh_van',
  'Huyền Thuỷ Cung': 'huyen_thuy',
  'Tu La Tông': 'tu_la',
};

export interface PublicProfileView {
  id: string;
  name: string;
  realmKey: string;
  realmStage: number;
  level: number;
  power: number;
  spirit: number;
  speed: number;
  luck: number;
  sectId: string | null;
  sectKey: string | null;
  sectName: string | null;
  role: 'PLAYER' | 'MOD' | 'ADMIN';
  createdAt: string;
}

@Injectable()
export class CharacterService {
  private readonly logger = new Logger(CharacterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly spiritualRoot?: SpiritualRootService,
    private readonly cultivationMethod?: CultivationMethodService,
    private readonly characterSkill?: CharacterSkillService,
    private readonly titles?: TitleService,
    @Optional()
    @Inject(forwardRef(() => AchievementService))
    private readonly achievements?: AchievementService,
    // Phase 11 nâng cao §5 PR2 wire — Optional cho backward-compat: legacy
    // bootstrap (vd test deterministic `breakthrough()` không cần BuffService)
    // tiếp tục pass undefined; chỉ `attemptBreakthrough()` consume nếu có.
    @Optional()
    private readonly buffs?: BuffService,
  ) {}

  async findByUser(userId: string) {
    const c = await this.prisma.character.findUnique({
      where: { userId },
      include: { sect: true, user: true },
    });
    if (!c) return null;
    return this.toState(c);
  }

  /**
   * Public-safe profile view — không lộ exp, hp/mp/stamina, currency, cultivating.
   * Trả null nếu không tìm thấy hoặc owner đang banned.
   */
  async findPublicProfile(characterId: string): Promise<PublicProfileView | null> {
    const c = await this.prisma.character.findUnique({
      where: { id: characterId },
      include: { sect: true, user: true },
    });
    if (!c) return null;
    if (c.user.banned) return null;
    return {
      id: c.id,
      name: c.name,
      realmKey: c.realmKey,
      realmStage: c.realmStage,
      level: c.level,
      power: c.power,
      spirit: c.spirit,
      speed: c.speed,
      luck: c.luck,
      sectId: c.sectId,
      sectKey: c.sect ? SECT_NAME_TO_KEY[c.sect.name] ?? null : null,
      sectName: c.sect?.name ?? null,
      role: c.user.role,
      createdAt: c.createdAt.toISOString(),
    };
  }

  async getStateOrThrow(userId: string): Promise<CharacterStatePayload> {
    const c = await this.prisma.character.findUnique({
      where: { userId },
      include: { sect: true, user: true },
    });
    if (!c) throw new DomainError('NO_CHARACTER');
    return this.toState(c);
  }

  async onboard(userId: string, input: OnboardInput) {
    const existing = await this.prisma.character.findUnique({ where: { userId } });
    if (existing) throw new DomainError('ALREADY_ONBOARDED');

    const stats = SECT_STARTING_STATS[input.sectKey];
    try {
      const sect = await this.prisma.sect.upsert({
        where: { name: SECT_NAMES[input.sectKey] },
        update: {},
        create: { name: SECT_NAMES[input.sectKey] },
      });
      const c = await this.prisma.character.create({
        data: {
          userId,
          name: input.name,
          realmKey: 'luyenkhi',
          realmStage: 1,
          level: 1,
          ...stats,
          hp: stats.hpMax,
          mp: stats.mpMax,
          sectId: sect.id,
        },
        include: { sect: true, user: true },
      });
      // Phase 11.3.A — server-authoritative roll Linh căn lần đầu khi onboard.
      // Idempotent (chỉ roll lần đầu, retry an toàn).
      if (this.spiritualRoot) {
        await this.spiritualRoot.rollOnboard(c.id);
      }
      // Phase 11.1.B — auto-grant + auto-equip công pháp khởi đầu
      // `khai_thien_quyet`. Idempotent.
      if (this.cultivationMethod) {
        await this.cultivationMethod.grantStarterIfMissing(c.id);
      }
      // Phase 11.2.B — auto-grant + auto-equip skill khởi đầu `basic_attack`.
      // Idempotent — re-call an toàn.
      if (this.characterSkill) {
        await this.characterSkill.grantStarterIfMissing(c.id);
      }
      // Phase 11.9.C-3 — auto-unlock realm milestone title
      // `realm_luyenkhi_initiate` cho character mới (luyenkhi là realm khởi
      // đầu, mọi nhân vật unlock 1 lần). Fail-soft: title unlock lỗi KHÔNG
      // fail onboard core path (giống breakthrough Phase 11.9.C). Idempotent
      // qua `CharacterTitleUnlock` composite UNIQUE — retry-safe.
      if (this.titles) {
        const titleDef = titleForRealmMilestone('luyenkhi');
        if (titleDef) {
          try {
            await this.titles.unlockTitle(
              c.id,
              titleDef.key,
              'realm_milestone',
            );
          } catch (err) {
            this.logger.warn(
              `onboard: failed to auto-unlock title ${titleDef.key} for char ${c.id}: ${(err as Error).message}`,
            );
          }
        }
      }
      const fresh = await this.prisma.character.findUnique({
        where: { id: c.id },
        include: { sect: true, user: true },
      });
      const state = this.toState(fresh ?? c);
      this.realtime.emitToUser(userId, 'state:update', state);
      return state;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new DomainError('NAME_TAKEN');
      }
      throw e;
    }
  }

  async setCultivating(userId: string, on: boolean): Promise<CharacterStatePayload> {
    const c = await this.prisma.character.findUnique({ where: { userId } });
    if (!c) throw new DomainError('NO_CHARACTER');
    const updated = await this.prisma.character.update({
      where: { userId },
      data: { cultivating: on },
      include: { sect: true, user: true },
    });
    const state = this.toState(updated);
    this.realtime.emitToUser(userId, 'state:update', state);
    return state;
  }

  /**
   * Đột phá khi đạt đỉnh (trọng 9). Yêu cầu exp >= cost(stage=9).
   *
   * Phase 14.3.A — gate `TRIBULATION_REQUIRED`: nếu `nextRealm()` transition
   * có `TribulationDef` trong catalog (`tribulationRequiredForBreakthrough`),
   * route này KHÔNG advance realm — throw `TRIBULATION_REQUIRED` để FE
   * redirect player sang `POST /character/tribulation`. Đảm bảo player
   * không bypass kiếp bằng manual breakthrough endpoint.
   *
   * Low-tier transitions (phamnhan→luyenkhi, luyenkhi→truc_co, truc_co→kim_dan)
   * KHÔNG có catalog entry → gate pass-through, behavior cũ giữ nguyên.
   */
  async breakthrough(userId: string): Promise<CharacterStatePayload> {
    const c = await this.prisma.character.findUnique({ where: { userId } });
    if (!c) throw new DomainError('NO_CHARACTER');

    if (c.realmStage < 9) throw new DomainError('NOT_AT_PEAK');
    const cost = expCostForStage(c.realmKey, 9);
    if (cost === null || c.exp < cost) throw new DomainError('NOT_AT_PEAK');

    const next = nextRealm(c.realmKey);
    if (tribulationRequiredForBreakthrough(c.realmKey, next?.key)) {
      throw new DomainError('TRIBULATION_REQUIRED');
    }
    const newRealm = next ? next.key : c.realmKey;
    const newStage = next ? 1 : 9;

    const updated = await this.prisma.character.update({
      where: { userId },
      data: {
        realmKey: newRealm,
        realmStage: newStage,
        exp: c.exp - cost,
        // mở rộng dung lượng HP/MP khi vượt cảnh — tăng 20%.
        hpMax: Math.round(c.hpMax * 1.2),
        mpMax: Math.round(c.mpMax * 1.2),
        hp: Math.round(c.hpMax * 1.2),
        mp: Math.round(c.mpMax * 1.2),
      },
      include: { sect: true, user: true },
    });

    // Phase 11.9.C — auto-unlock realm milestone title sau breakthrough thành
    // công. Fail-soft: title unlock lỗi KHÔNG fail breakthrough (cosmetic
    // flavor, không phải core path). Idempotent qua `unlockTitle` composite
    // UNIQUE `(characterId, titleKey)`. Bỏ qua nếu realm không thay đổi
    // (`!next` = đã đạt cao nhất) hoặc realm mới không có title milestone.
    if (this.titles && next) {
      const titleDef = titleForRealmMilestone(newRealm);
      if (titleDef) {
        try {
          await this.titles.unlockTitle(
            updated.id,
            titleDef.key,
            'realm_milestone',
          );
        } catch (err) {
          this.logger.warn(
            `breakthrough: failed to auto-unlock title ${titleDef.key} for char ${updated.id}: ${(err as Error).message}`,
          );
        }
      }
    }

    // Phase 11.10.G-2 — fail-soft post-update tracking BREAKTHROUGH event.
    // Symmetric với `CultivationProcessor` auto-tick low-tier breakthrough
    // (line 196 `achievements.trackEvent('BREAKTHROUGH', 1)`) và
    // `TribulationService` SUCCESS path (Phase 11.10.G). Manual peak
    // breakthrough trước đó KHÔNG fire BREAKTHROUGH → 4 catalog achievement
    // BREAKTHROUGH miss khi player click button đột phá thủ công ở stage 9.
    // Skip nếu `!next` (đã đạt cao nhất, không advance realm).
    // MissionService.track defer (cross-module wire MissionModule →
    // CharacterModule cycle, scope larger Phase 11.10.G-3).
    if (next && this.achievements) {
      try {
        await this.achievements.trackEvent(updated.id, 'BREAKTHROUGH', 1);
      } catch (err) {
        this.logger.warn(
          `breakthrough: achievement BREAKTHROUGH track failed for char ${updated.id}: ${(err as Error).message}`,
        );
      }
    }

    const state = this.toState(updated);
    this.realtime.emitToUser(userId, 'state:update', state);
    return state;
  }

  /**
   * Phase 11 nâng cao §5 PR2 wire — RNG-based breakthrough attempt.
   *
   * Khác `breakthrough()` deterministic (luôn success):
   *   - Compute `BreakthroughChanceBreakdown` qua `computeBreakthroughChance()`
   *     (4 layer: base + rootPurity + methodAffinity + itemBonus).
   *   - Roll RNG `[0, 1)` (default `Math.random`, test inject deterministic).
   *   - `evaluateBreakthroughOutcome()` decide success/fail.
   *   - SUCCESS → realm advance + restats + auto-unlock title + track
   *     BREAKTHROUGH achievement (giống `breakthrough()`); INSERT
   *     `BreakthroughAttemptLog{success:true}`.
   *   - FAIL → KHÔNG advance realm, KHÔNG trừ EXP cost; apply `tam_ma_light`
   *     debuff qua `BuffService.applyBuffTx` (nếu inject), INSERT
   *     `BreakthroughAttemptLog{success:false, tamMaActive:true}`.
   *
   * **Forward-compat**: endpoint cũ `POST /character/breakthrough` (deterministic)
   * vẫn giữ nguyên cho backward-compat client. PR3 wire UI sẽ migrate sang
   * endpoint mới `POST /character/breakthrough/attempt`.
   *
   * **idempotencyKey**: caller debounce qua key. Composite UNIQUE
   * `(characterId, idempotencyKey)` enforce ở DB → P2002 nếu dup. Caller có
   * thể swallow + retry idempotent trên cùng key. PR2 chưa wire UI, key default
   * null (NULL ≠ NULL trong Postgres → multiple rows OK).
   *
   * @param userId user id (server-trusted, đã resolve từ session).
   * @param rng deterministic RNG source. Default `Math.random` runtime; test
   *   inject `() => 0.0` lock-in success, `() => 0.99` lock-in fail.
   * @param now timestamp gốc cho `tamMaExpiresAt` computation. Default
   *   `new Date()`. Inject từ test để control timeline.
   * @param idempotencyKey optional caller-supplied debounce key.
   */
  async attemptBreakthrough(
    userId: string,
    rng: () => number = Math.random,
    now: Date = new Date(),
    idempotencyKey?: string,
  ): Promise<BreakthroughAttemptOutcome> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const c = await tx.character.findUnique({
        where: { userId },
        include: { sect: true, user: true },
      });
      if (!c) throw new BreakthroughError('NO_CHARACTER');

      // Realm gate: peak (stage 9) + đủ EXP cost — giống `breakthrough()`.
      if (c.realmStage < 9) throw new BreakthroughError('NOT_AT_PEAK');
      const cost = expCostForStage(c.realmKey, 9);
      if (cost === null || c.exp < cost) {
        throw new BreakthroughError('NOT_AT_PEAK');
      }

      // Compute breakdown — pure shared formula. Defensive narrow string →
      // ElementKey union (Prisma trả về string?), legacy character (no root
      // / no method) → bonus layer = 0 fallback.
      const primaryElement: ElementKey | undefined =
        c.primaryElement && (['kim', 'moc', 'thuy', 'hoa', 'tho'] as const).includes(c.primaryElement as ElementKey)
          ? (c.primaryElement as ElementKey)
          : undefined;
      const secondaryElements: ElementKey[] = (c.secondaryElements ?? []).filter(
        (e): e is ElementKey =>
          (['kim', 'moc', 'thuy', 'hoa', 'tho'] as const).includes(e as ElementKey),
      );
      const methodDef = c.equippedCultivationMethodKey
        ? getCultivationMethodDef(c.equippedCultivationMethodKey)
        : undefined;
      const methodElement: ElementKey | undefined = methodDef?.element ?? undefined;
      // `Character.rootPurity` schema = Int 0-100; formula expects [0, 1].
      const rootPurityNorm = (c.rootPurity ?? 0) / 100;

      const breakdown = computeBreakthroughChance({
        realmStage: c.realmStage,
        expCurrent: c.exp,
        expCost: cost,
        rootPurity: rootPurityNorm,
        rootPrimaryElement: primaryElement,
        rootSecondaryElements: secondaryElements,
        methodElement,
        // PR2 itemBonus = 0 (chưa có pill consumable wire). PR3+ sẽ aggregate
        // từ active buff catalog (vd `pill_breakthrough_t1` itemBonus=0.05).
        itemBonus: 0,
      });

      const rngRoll = rng();
      if (!Number.isFinite(rngRoll) || rngRoll < 0 || rngRoll >= 1) {
        throw new BreakthroughError('INVALID_RNG');
      }

      const result = evaluateBreakthroughOutcome({
        breakdown,
        rngRoll,
        now,
      });

      // Đếm attempt index cho character (audit + tests). Mỗi attempt = 1 row
      // mới — không reset khi cross realm (lifetime counter).
      const priorAttempts = await tx.breakthroughAttemptLog.count({
        where: { characterId: c.id },
      });
      const attemptIndex = priorAttempts + 1;

      const next = nextRealm(c.realmKey);

      if (result.success) {
        // === SUCCESS PATH === realm advance + restats (giống `breakthrough()`).
        const newRealm = next ? next.key : c.realmKey;
        const newStage = next ? 1 : 9;
        const newHpMax = Math.round(c.hpMax * 1.2);
        const newMpMax = Math.round(c.mpMax * 1.2);

        const updated = await tx.character.update({
          where: { id: c.id },
          data: {
            realmKey: newRealm,
            realmStage: newStage,
            exp: c.exp - cost,
            hpMax: newHpMax,
            mpMax: newMpMax,
            hp: newHpMax,
            mp: newMpMax,
          },
          include: { sect: true, user: true },
        });

        const log = await tx.breakthroughAttemptLog.create({
          data: {
            characterId: c.id,
            fromRealmKey: c.realmKey,
            fromRealmStage: 9,
            toRealmKey: newRealm,
            toRealmStage: newStage,
            chance: breakdown.finalChance,
            baseChance: breakdown.baseChance,
            rootPurityBonus: breakdown.rootPurityBonus,
            methodAffinityBonus: breakdown.methodAffinityBonus,
            itemBonus: breakdown.itemBonus,
            rawChance: breakdown.rawChance,
            rngRoll,
            success: true,
            expBefore: c.exp,
            expAfter: c.exp - cost,
            tamMaActive: false,
            tamMaExpiresAt: null,
            idempotencyKey: idempotencyKey ?? null,
            attemptIndex,
          },
        });

        return {
          success: true as const,
          fromRealmKey: c.realmKey,
          fromRealmStage: 9,
          toRealmKey: newRealm,
          toRealmStage: newStage,
          breakdown,
          rngRoll,
          attemptIndex,
          logId: log.id,
          debuffApplied: false,
          debuffKey: null,
          debuffExpiresAt: null,
          character: updated,
          newRealm,
          hadNext: next !== null,
        };
      }

      // === FAIL PATH === KHÔNG advance, KHÔNG trừ EXP. Apply `tam_ma_light`
      // qua `BuffService.applyBuffTx` cùng tx (atomic — log + buff insert
      // pass/fail nguyên khối). Legacy bootstrap (no BuffService inject) skip
      // buff apply nhưng vẫn log `tamMaActive=true` cho audit consistency.
      if (
        this.buffs &&
        result.debuffApplied &&
        result.debuffKey &&
        result.debuffExpiresAt
      ) {
        await this.buffs.applyBuffTx(
          tx,
          c.id,
          result.debuffKey,
          'breakthrough',
          now,
          result.debuffExpiresAt,
        );
      }

      const log = await tx.breakthroughAttemptLog.create({
        data: {
          characterId: c.id,
          fromRealmKey: c.realmKey,
          fromRealmStage: 9,
          toRealmKey: c.realmKey,
          toRealmStage: 9,
          chance: breakdown.finalChance,
          baseChance: breakdown.baseChance,
          rootPurityBonus: breakdown.rootPurityBonus,
          methodAffinityBonus: breakdown.methodAffinityBonus,
          itemBonus: breakdown.itemBonus,
          rawChance: breakdown.rawChance,
          rngRoll,
          success: false,
          expBefore: c.exp,
          expAfter: c.exp,
          tamMaActive: result.debuffApplied,
          tamMaExpiresAt: result.debuffExpiresAt,
          idempotencyKey: idempotencyKey ?? null,
          attemptIndex,
        },
      });

      return {
        success: false as const,
        fromRealmKey: c.realmKey,
        fromRealmStage: 9,
        toRealmKey: c.realmKey,
        toRealmStage: 9,
        breakdown,
        rngRoll,
        attemptIndex,
        logId: log.id,
        debuffApplied: result.debuffApplied,
        debuffKey: result.debuffKey,
        debuffExpiresAt: result.debuffExpiresAt,
        character: c,
        newRealm: c.realmKey,
        hadNext: false,
      };
    });

    // Post-tx side effects (success path only) — fail-soft như `breakthrough()`.
    // Tribulation success post-tx pattern (Phase 11.10.G).
    if (outcome.success && outcome.hadNext) {
      if (this.titles) {
        const titleDef = titleForRealmMilestone(outcome.newRealm);
        if (titleDef) {
          try {
            await this.titles.unlockTitle(
              outcome.character.id,
              titleDef.key,
              'realm_milestone',
            );
          } catch (err) {
            this.logger.warn(
              `attemptBreakthrough: failed to auto-unlock title ${titleDef.key} for char ${outcome.character.id}: ${(err as Error).message}`,
            );
          }
        }
      }
      if (this.achievements) {
        try {
          await this.achievements.trackEvent(
            outcome.character.id,
            'BREAKTHROUGH',
            1,
          );
        } catch (err) {
          this.logger.warn(
            `attemptBreakthrough: achievement BREAKTHROUGH track failed for char ${outcome.character.id}: ${(err as Error).message}`,
          );
        }
      }
    }

    const state = this.toState(outcome.character);
    this.realtime.emitToUser(userId, 'state:update', state);
    return {
      success: outcome.success,
      fromRealmKey: outcome.fromRealmKey,
      fromRealmStage: outcome.fromRealmStage,
      toRealmKey: outcome.toRealmKey,
      toRealmStage: outcome.toRealmStage,
      breakdown: outcome.breakdown,
      rngRoll: outcome.rngRoll,
      attemptIndex: outcome.attemptIndex,
      logId: outcome.logId,
      debuffApplied: outcome.debuffApplied,
      debuffKey: outcome.debuffKey,
      debuffExpiresAt: outcome.debuffExpiresAt,
      character: state,
    };
  }

  /**
   * Phase 11 nâng cao §5 PR3 prep — read-only audit log của
   * `BreakthroughAttemptLog` cho FE history view.
   *
   *   - Sort theo `createdAt` DESC (mới nhất đầu).
   *   - Cap tại `BREAKTHROUGH_LOG_MAX_LIMIT` để tránh DOS (mirror
   *     `TribulationService.listAttemptLogs` pattern).
   *   - BigInt fields (`expBefore`, `expAfter`) cast → string (giữ
   *     precision khi qua JSON serialize).
   *   - DateTime fields (`tamMaExpiresAt`, `createdAt`) cast → ISO string.
   *   - Character ownership check phải do caller (controller) làm trước:
   *     resolve `characterId` từ session userId → tránh leak log của
   *     character khác.
   *
   * @param characterId character id (server-trusted, đã resolve).
   * @param limit số row tối đa. Default `BREAKTHROUGH_LOG_DEFAULT_LIMIT`,
   *   cap tại `BREAKTHROUGH_LOG_MAX_LIMIT`.
   * @returns array `BreakthroughAttemptLogView` (BigInt → string, Date → ISO).
   */
  async listBreakthroughAttemptLogs(
    characterId: string,
    limit: number = BREAKTHROUGH_LOG_DEFAULT_LIMIT,
  ): Promise<BreakthroughAttemptLogView[]> {
    const safeLimit = Math.max(
      1,
      Math.min(BREAKTHROUGH_LOG_MAX_LIMIT, Math.floor(limit)),
    );
    const rows = await this.prisma.breakthroughAttemptLog.findMany({
      where: { characterId },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });
    return rows.map((r) => ({
      id: r.id,
      fromRealmKey: r.fromRealmKey,
      fromRealmStage: r.fromRealmStage,
      toRealmKey: r.toRealmKey,
      toRealmStage: r.toRealmStage,
      chance: r.chance,
      baseChance: r.baseChance,
      rootPurityBonus: r.rootPurityBonus,
      methodAffinityBonus: r.methodAffinityBonus,
      itemBonus: r.itemBonus,
      rawChance: r.rawChance,
      rngRoll: r.rngRoll,
      success: r.success,
      expBefore: r.expBefore.toString(),
      expAfter: r.expAfter.toString(),
      tamMaActive: r.tamMaActive,
      tamMaExpiresAt: r.tamMaExpiresAt ? r.tamMaExpiresAt.toISOString() : null,
      attemptIndex: r.attemptIndex,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private toState(c: CharRow): CharacterStatePayload {
    const expNext = expCostForStage(c.realmKey, c.realmStage);
    const bodyRealm = getBodyRealmByKey(c.bodyRealmKey) ?? BODY_REALMS[0]!;
    const bodyExpNext = bodyExpCostForStage(bodyRealm, c.bodyStage);
    return {
      id: c.id,
      name: c.name,
      realmKey: c.realmKey,
      realmStage: c.realmStage,
      level: c.level,
      exp: c.exp.toString(),
      expNext: (expNext ?? 0n).toString(),
      hp: c.hp,
      hpMax: c.hpMax,
      mp: c.mp,
      mpMax: c.mpMax,
      stamina: c.stamina,
      staminaMax: c.staminaMax,
      power: c.power,
      spirit: c.spirit,
      speed: c.speed,
      luck: c.luck,
      linhThach: c.linhThach.toString(),
      tienNgoc: c.tienNgoc,
      tienNgocKhoa: c.tienNgocKhoa,
      cultivating: c.cultivating,
      sectId: c.sectId,
      sectKey: c.sect ? SECT_NAME_TO_KEY[c.sect.name] ?? null : null,
      role: c.user.role,
      banned: c.user.banned,
      tribulationCooldownAt: c.tribulationCooldownAt
        ? c.tribulationCooldownAt.toISOString()
        : null,
      taoMaUntil: c.taoMaUntil ? c.taoMaUntil.toISOString() : null,
      // Phase 11.3.A — expose Spiritual Root state cho FE consume từ /me +
      // state:update WS broadcast. `null` cho legacy character chưa lazy-roll.
      // Cast Prisma `String?` → narrow union qua type assertion (server đã
      // validate value lúc roll/grant; legacy null fallback giữ nguyên).
      spiritualRootGrade:
        (c.spiritualRootGrade as CharacterStatePayload['spiritualRootGrade']) ??
        null,
      primaryElement:
        (c.primaryElement as CharacterStatePayload['primaryElement']) ?? null,
      secondaryElements: (c.secondaryElements ??
        []) as CharacterStatePayload['secondaryElements'],
      rootPurity: c.rootPurity,
      // Phase 11.9.C — expose equipped title cho FE consume từ /me + state:update
      // WS broadcast. `null` khi character chưa equip (mặc định) hoặc đã unequip.
      // Server nguồn duy nhất — FE không tự set field này. Catalog key reference
      // ở `packages/shared/src/titles.ts`.
      title: c.title ?? null,
      bodyRealmKey: bodyRealm.key,
      bodyRealmName: fullBodyRealmName(bodyRealm, c.bodyStage),
      bodyStage: c.bodyStage,
      bodyExp: c.bodyExp.toString(),
      bodyExpNext: (bodyExpNext ?? 0n).toString(),
      bodyRate: bodyRateForRealm(bodyRealm.key),
      bodyCultivating: c.bodyCultivating,
      bodyInjuryUntil: c.bodyInjuryUntil
        ? c.bodyInjuryUntil.toISOString()
        : null,
      physiqueKey: c.physiqueKey,
      bodyStatBonus: computeBodyStatBonus(bodyRealm.order, c.bodyStage),
    };
  }
}

export { DomainError };

/**
 * Phase 11 nâng cao §5 PR3 prep — pagination defaults cho
 * `listBreakthroughAttemptLogs`. MAX cap để tránh DOS qua `?limit=999999`.
 * Mirror `TRIBULATION_LOG_*` pattern từ `tribulation.service.ts`.
 */
export const BREAKTHROUGH_LOG_DEFAULT_LIMIT = 20;
export const BREAKTHROUGH_LOG_MAX_LIMIT = 100;

/**
 * Phase 11 nâng cao §5 PR3 prep — view-friendly shape của
 * `BreakthroughAttemptLog` cho FE consume. BigInt fields cast → string
 * (giữ precision khi qua JSON), DateTime cast → ISO string.
 */
export interface BreakthroughAttemptLogView {
  id: string;
  fromRealmKey: string;
  fromRealmStage: number;
  toRealmKey: string;
  toRealmStage: number;
  chance: number;
  baseChance: number;
  rootPurityBonus: number;
  methodAffinityBonus: number;
  itemBonus: number;
  rawChance: number;
  rngRoll: number;
  success: boolean;
  expBefore: string;
  expAfter: string;
  tamMaActive: boolean;
  tamMaExpiresAt: string | null;
  attemptIndex: number;
  createdAt: string;
}
