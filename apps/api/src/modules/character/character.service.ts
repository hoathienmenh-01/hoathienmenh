import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  expCostForStage,
  nextRealm,
  titleForRealmMilestone,
  type CharacterStatePayload,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AchievementService } from './achievement.service';
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
  constructor(public code: 'NAME_TAKEN' | 'ALREADY_ONBOARDED' | 'NO_CHARACTER' | 'NOT_AT_PEAK') {
    super(code);
  }
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
   */
  async breakthrough(userId: string): Promise<CharacterStatePayload> {
    const c = await this.prisma.character.findUnique({ where: { userId } });
    if (!c) throw new DomainError('NO_CHARACTER');

    if (c.realmStage < 9) throw new DomainError('NOT_AT_PEAK');
    const cost = expCostForStage(c.realmKey, 9);
    if (cost === null || c.exp < cost) throw new DomainError('NOT_AT_PEAK');

    const next = nextRealm(c.realmKey);
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

  private toState(c: CharRow): CharacterStatePayload {
    const expNext = expCostForStage(c.realmKey, c.realmStage);
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
    };
  }
}

export { DomainError };
