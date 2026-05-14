import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  DAILY_ENCOUNTER_REWARD_CAPS,
  dailyEncounterByKey,
  realmByKey,
  rollDailyEncounter,
} from '@xuantoi/shared';
import { CurrencyKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WebPushService } from '../web-push/web-push.service';

/**
 * Phase 34.1 — Daily Random Encounter / Kỳ Ngộ Service.
 *
 * Per-character daily encounter row keyed by `(characterId, dateKey)`.
 * Status flow: AVAILABLE → ACCEPTED → COMPLETED → CLAIMED (or SKIPPED).
 *
 * Reward path (claim):
 *  - `CurrencyService.applyTx('ENCOUNTER_CLAIM')` for linhThach.
 *  - `Character.exp` increment for exp.
 *  - **NEVER** mints tienNgoc, **NEVER** grants endgame items.
 *
 * Reward cap re-checked at claim time against
 * `DAILY_ENCOUNTER_REWARD_CAPS` — defence in depth.
 */
export const DAILY_ENCOUNTER_STATUSES = [
  'AVAILABLE',
  'ACCEPTED',
  'COMPLETED',
  'CLAIMED',
  'SKIPPED',
] as const;
export type DailyEncounterStatus = (typeof DAILY_ENCOUNTER_STATUSES)[number];

export interface DailyEncounterTodayView {
  encounterKey: string;
  rarity: string;
  dateKey: string;
  status: DailyEncounterStatus;
  choiceKey: string | null;
  titleVi: string;
  titleEn: string;
  descriptionVi: string;
  descriptionEn: string;
  rewardProfile: {
    linhThach: number;
    exp: number;
  };
  acceptedAt: string | null;
  completedAt: string | null;
  claimedAt: string | null;
}

export interface DailyEncounterClaimResult {
  claimed: boolean;
  linhThachGranted: number;
  expGranted: number;
  view: DailyEncounterTodayView;
}

export class DailyEncounterError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'DailyEncounterError';
  }
}

function getResetTz(): string {
  const v = process.env.MISSION_RESET_TZ?.trim();
  return v && v.length > 0 ? v : 'Asia/Ho_Chi_Minh';
}

/**
 * Returns `YYYY-MM-DD` in the configured reset tz, derived from `now`.
 * Exposed for testing.
 */
export function dailyEncounterDateKey(now: Date = new Date()): string {
  const tz = getResetTz();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA locale returns YYYY-MM-DD natively.
  return fmt.format(now);
}

@Injectable()
export class DailyEncounterService {
  private readonly logger = new Logger(DailyEncounterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    // Phase 44.1 — Realtime + WebPush optional cho rare/hidden encounter
    // notification. Fail-soft — không phá flow encounter nếu notify fail.
    @Optional() private readonly realtime?: RealtimeService,
    @Optional() private readonly webPush?: WebPushService,
  ) {}

  /**
   * Phase 44.1 — Battle encounter adapter TODO.
   *
   * `DAILY_ENCOUNTER_TYPES` có 'minor_boss' / 'tiny_secret_realm' là encounter
   * dạng battle. Combat hook chưa "safe" để wire trực tiếp (combat.service.ts
   * required `monsterKey` + queue tick — không match encounter signature đơn
   * giản). PR này KHÔNG sửa combat.service.
   *
   * Khi balance team / combat team mở hook adapter:
   *   1. Thêm `encounter.battleAdapter` field vào catalog với
   *      `{ monsterKey, lootProfileKey }`.
   *   2. Trong `accept()`, nếu encounter có battleAdapter → enqueue 1
   *      `CombatStartJob` thay vì flip status `ACCEPTED`.
   *   3. Khi combat job finish → callback flip `COMPLETED`.
   *
   * Hiện tại flow vẫn là tutorial-style choose → complete → claim.
   */

  private async getCharacter(
    userId: string,
  ): Promise<{ id: string; realmKey: string }> {
    const c = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true },
    });
    if (!c) throw new DailyEncounterError('NO_CHARACTER');
    return c;
  }

  /**
   * Get today's encounter row. Lazy-create if missing. The encounter is
   * deterministically rolled from `(characterId, dateKey)` so re-reading the
   * same day returns the same encounter.
   */
  async today(userId: string): Promise<DailyEncounterTodayView> {
    const char = await this.getCharacter(userId);
    const dateKey = dailyEncounterDateKey();
    const row = await this.ensureTodayRow(char.id, char.realmKey, dateKey);
    return this.toView(row);
  }

  async accept(userId: string): Promise<DailyEncounterTodayView> {
    const char = await this.getCharacter(userId);
    const dateKey = dailyEncounterDateKey();
    await this.ensureTodayRow(char.id, char.realmKey, dateKey);
    const cas = await this.prisma.characterDailyEncounter.updateMany({
      where: { characterId: char.id, dateKey, status: 'AVAILABLE' },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    if (cas.count !== 1) {
      // already accepted / completed / etc — re-read.
    }
    const row = await this.prisma.characterDailyEncounter.findUnique({
      where: { characterId_dateKey: { characterId: char.id, dateKey } },
    });
    if (!row) throw new DailyEncounterError('ENCOUNTER_NOT_FOUND');
    return this.toView(row);
  }

  async choose(
    userId: string,
    choiceKey: string,
  ): Promise<DailyEncounterTodayView> {
    const char = await this.getCharacter(userId);
    const dateKey = dailyEncounterDateKey();
    const row = await this.ensureTodayRow(char.id, char.realmKey, dateKey);
    const def = dailyEncounterByKey(row.encounterKey);
    if (!def) throw new DailyEncounterError('ENCOUNTER_CATALOG_MISSING');
    if (!def.choices || def.choices.length === 0) {
      throw new DailyEncounterError('ENCOUNTER_HAS_NO_CHOICES');
    }
    if (!def.choices.some((c) => c.choiceKey === choiceKey)) {
      throw new DailyEncounterError('ENCOUNTER_CHOICE_INVALID');
    }
    if (row.status === 'CLAIMED' || row.status === 'SKIPPED') {
      throw new DailyEncounterError('ENCOUNTER_FROZEN');
    }
    await this.prisma.characterDailyEncounter.update({
      where: { id: row.id },
      data: { choiceKey },
    });
    const fresh = await this.prisma.characterDailyEncounter.findUnique({
      where: { id: row.id },
    });
    return this.toView(fresh!);
  }

  async complete(userId: string): Promise<DailyEncounterTodayView> {
    const char = await this.getCharacter(userId);
    const dateKey = dailyEncounterDateKey();
    await this.ensureTodayRow(char.id, char.realmKey, dateKey);
    await this.prisma.characterDailyEncounter.updateMany({
      where: {
        characterId: char.id,
        dateKey,
        status: { in: ['AVAILABLE', 'ACCEPTED'] },
      },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    const row = await this.prisma.characterDailyEncounter.findUnique({
      where: { characterId_dateKey: { characterId: char.id, dateKey } },
    });
    if (!row) throw new DailyEncounterError('ENCOUNTER_NOT_FOUND');
    return this.toView(row);
  }

  async skip(userId: string): Promise<DailyEncounterTodayView> {
    const char = await this.getCharacter(userId);
    const dateKey = dailyEncounterDateKey();
    await this.ensureTodayRow(char.id, char.realmKey, dateKey);
    await this.prisma.characterDailyEncounter.updateMany({
      where: {
        characterId: char.id,
        dateKey,
        status: { in: ['AVAILABLE', 'ACCEPTED'] },
      },
      data: { status: 'SKIPPED' },
    });
    const row = await this.prisma.characterDailyEncounter.findUnique({
      where: { characterId_dateKey: { characterId: char.id, dateKey } },
    });
    if (!row) throw new DailyEncounterError('ENCOUNTER_NOT_FOUND');
    return this.toView(row);
  }

  /**
   * Atomic claim. CAS: COMPLETED → CLAIMED + currency/exp grant.
   *
   * Race-safe: parallel callers — exactly one wins the `updateMany.count===1`,
   * the loser gets `claimed: false` and the existing grant view.
   */
  async claim(userId: string): Promise<DailyEncounterClaimResult> {
    const char = await this.getCharacter(userId);
    const dateKey = dailyEncounterDateKey();
    const row = await this.ensureTodayRow(char.id, char.realmKey, dateKey);
    const def = dailyEncounterByKey(row.encounterKey);
    if (!def) throw new DailyEncounterError('ENCOUNTER_CATALOG_MISSING');

    const cappedLinhThach = Math.min(
      def.rewardProfile.linhThach,
      DAILY_ENCOUNTER_REWARD_CAPS.linhThachMax,
    );
    const cappedExp = Math.min(
      def.rewardProfile.exp,
      DAILY_ENCOUNTER_REWARD_CAPS.expMax,
    );
    const now = new Date();
    let claimed = false;
    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.characterDailyEncounter.updateMany({
        where: { characterId: char.id, dateKey, status: 'COMPLETED' },
        data: {
          status: 'CLAIMED',
          claimedAt: now,
          linhThachGranted: cappedLinhThach,
          expGranted: cappedExp,
        },
      });
      if (cas.count !== 1) return;
      if (cappedLinhThach > 0) {
        await this.currency.applyTx(tx, {
          characterId: char.id,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(cappedLinhThach),
          reason: 'ENCOUNTER_CLAIM',
          refType: 'DailyEncounter',
          refId: `${char.id}:${dateKey}`,
          meta: { encounterKey: row.encounterKey, dateKey },
        });
      }
      if (cappedExp > 0) {
        await tx.character.update({
          where: { id: char.id },
          data: { exp: { increment: BigInt(cappedExp) } },
        });
      }
      claimed = true;
    });

    const fresh = await this.prisma.characterDailyEncounter.findUnique({
      where: { characterId_dateKey: { characterId: char.id, dateKey } },
    });
    if (!fresh) throw new DailyEncounterError('ENCOUNTER_NOT_FOUND');
    if (!claimed && fresh.status !== 'CLAIMED') {
      throw new DailyEncounterError('ENCOUNTER_NOT_COMPLETED');
    }
    return {
      claimed,
      linhThachGranted: fresh.linhThachGranted,
      expGranted: fresh.expGranted,
      view: this.toView(fresh),
    };
  }

  /**
   * Recent history. Capped at `limit` rows (default 30) ordered by date desc.
   */
  async history(
    userId: string,
    limit = 30,
  ): Promise<DailyEncounterTodayView[]> {
    const char = await this.getCharacter(userId);
    const rows = await this.prisma.characterDailyEncounter.findMany({
      where: { characterId: char.id },
      orderBy: { dateKey: 'desc' },
      take: Math.min(Math.max(1, limit), 90),
    });
    return rows.map((r) => this.toView(r));
  }

  // ── internal ───────────────────────────────────────────────────────────

  private async ensureTodayRow(
    characterId: string,
    realmKey: string,
    dateKey: string,
  ) {
    const existing = await this.prisma.characterDailyEncounter.findUnique({
      where: { characterId_dateKey: { characterId, dateKey } },
    });
    if (existing) return existing;
    const realmOrder = (realmByKey(realmKey)?.order ?? -1) + 1;
    const def = rollDailyEncounter({
      seed: `${characterId}|${dateKey}`,
      realmOrder,
    });
    const row = await this.prisma.characterDailyEncounter.create({
      data: {
        characterId,
        dateKey,
        encounterKey: def.key,
        rarity: def.rarity,
        status: 'AVAILABLE',
      },
    });
    // Phase 44.1 — Notify khi rare/hidden encounter generate (1 lần / dateKey).
    // Realtime banner cho người online + push cho người offline. Fire-and-forget.
    if (def.rarity === 'rare' || def.rarity === 'hidden') {
      this.notifyImportantEncounter(characterId, dateKey, def.key, def.rarity);
    }
    return row;
  }

  /**
   * Phase 44.1 — Realtime + push notify cho rare/hidden encounter. Fail-soft.
   * Push dedupeKey = `encounter-<characterId>-<dateKey>` đảm bảo retry không
   * gửi trùng.
   */
  private notifyImportantEncounter(
    characterId: string,
    dateKey: string,
    encounterKey: string,
    rarity: string,
  ): void {
    try {
      const def = dailyEncounterByKey(encounterKey);
      const title = def?.titleVi ?? 'Kỳ ngộ hiếm';
      // Realtime banner
      if (this.realtime) {
        // Find user from character (best-effort).
        void this.prisma.character
          .findUnique({
            where: { id: characterId },
            select: { userId: true },
          })
          .then((c) => {
            if (!c?.userId) return;
            this.realtime!.emitToUser(c.userId, 'encounter:new', {
              encounterKey,
              rarity,
              dateKey,
              titleVi: title,
            });
            // Web Push fallback nếu user offline. WebPushService cooldown
            // BOSS_SPAWN không dùng — đây là MAIL_NEW-ish 1-off, dùng
            // dedupeKey để guard.
            if (this.webPush) {
              const dedupeKey = `encounter-${characterId}-${dateKey}`;
              void this.webPush
                .sendToUser(c.userId, 'MAIL_NEW', {
                  title: `Kỳ ngộ hiếm: ${title}`,
                  body: 'Một kỳ ngộ hiếm đang chờ — mở Kỳ Ngộ để chọn lựa.',
                  url: '/encounter',
                  tag: dedupeKey,
                  dedupeKey,
                })
                .catch((e) =>
                  this.logger.warn(
                    `encounter push send characterId=${characterId} encounterKey=${encounterKey}: ${(e as Error).message}`,
                  ),
                );
            }
          })
          .catch(() => undefined);
      }
    } catch (e) {
      this.logger.warn(`notifyImportantEncounter failed: ${(e as Error).message}`);
    }
  }

  private toView(row: {
    encounterKey: string;
    rarity: string;
    dateKey: string;
    status: string;
    choiceKey: string | null;
    acceptedAt: Date | null;
    completedAt: Date | null;
    claimedAt: Date | null;
  }): DailyEncounterTodayView {
    const def = dailyEncounterByKey(row.encounterKey);
    const reward = def
      ? {
          linhThach: def.rewardProfile.linhThach,
          exp: def.rewardProfile.exp,
        }
      : { linhThach: 0, exp: 0 };
    return {
      encounterKey: row.encounterKey,
      rarity: row.rarity,
      dateKey: row.dateKey,
      status: row.status as DailyEncounterStatus,
      choiceKey: row.choiceKey,
      titleVi: def?.titleVi ?? row.encounterKey,
      titleEn: def?.titleEn ?? row.encounterKey,
      descriptionVi: def?.descriptionVi ?? '',
      descriptionEn: def?.descriptionEn ?? '',
      rewardProfile: reward,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      claimedAt: row.claimedAt?.toISOString() ?? null,
    };
  }
}
