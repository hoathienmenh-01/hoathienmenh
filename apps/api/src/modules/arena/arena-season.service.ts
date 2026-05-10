/**
 * Phase 14.1.C — Arena Season service.
 *
 * Trách nhiệm:
 *   - `getOrCreateActiveSeason(now?, tx?)`: lazy-create `ArenaSeason` row
 *     cho tuần ICT hiện tại (status=ACTIVE).
 *   - `getOrCreateStanding(tx, seasonId, characterId, initialRating)`:
 *     lazy-create `ArenaStanding` row.
 *   - `applyMatchToStandings(tx, seasonId, attackerId, defenderId, outcome,
 *     ratingDelta)`: increment wins/losses + apply Elo delta, recompute
 *     tier theo `arenaSeasonTierFor`.
 *   - `getCurrentSeasonView()`, `getLeaderboard(...)`, `getMyStanding(...)`,
 *     `getRewardPreview(...)`: read views cho FE.
 *   - `settleSeason(seasonKey?)`: chốt rank, gửi reward mail (idempotent
 *     qua `ArenaSeasonRewardGrant` UNIQUE).
 *   - `createNextSeason()`: admin force tạo season kế tiếp (Phase 14.1.D
 *     có thể tự rollover qua cron).
 *
 * KHÔNG đụng `ArenaProfile` (Phase 14.1.B) — standing độc lập per-season.
 * KHÔNG modify Sect/Mail schema.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { ArenaSeason, ArenaStanding, Prisma, PrismaClient } from '@prisma/client';
import {
  ARENA_SEASON_DEFAULT_TZ,
  ARENA_SEASON_REWARD_TABLE,
  arenaCurrentSeasonKey,
  arenaSeasonRewardFor,
  arenaSeasonTierFor,
  isArenaSeasonRewardValid,
  sectWarWeekKey,
  type ArenaLeaderboardEntry,
  type ArenaLeaderboardView,
  type ArenaMatchOutcome,
  type ArenaMyStandingView,
  type ArenaRatingDelta,
  type ArenaSeasonReward,
  type ArenaSeasonRewardPreviewView,
  type ArenaSeasonSettleSummary,
  type ArenaSeasonStatus,
  type ArenaSeasonTier,
  type ArenaSeasonView,
} from '@xuantoi/shared';
import { localPartsInTz, utcDateForLocal } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { MailService } from '../mail/mail.service';

/* ---------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------- */

export type ArenaSeasonServiceErrorCode =
  | 'NO_CHARACTER'
  | 'SEASON_NOT_FOUND'
  | 'SEASON_NOT_ACTIVE'
  | 'SEASON_ALREADY_SETTLED'
  | 'INVALID_INPUT';

export class ArenaSeasonServiceError extends Error {
  constructor(public code: ArenaSeasonServiceErrorCode) {
    super(code);
  }
}

/* ---------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

const LEADERBOARD_DEFAULT_LIMIT = 20;
const LEADERBOARD_MAX_LIMIT = 100;

type Tx = Prisma.TransactionClient;
type AnyClient = PrismaClient | Tx;

/* ---------------------------------------------------------------------------
 * Service
 * ------------------------------------------------------------------------- */

@Injectable()
export class ArenaSeasonService {
  private readonly logger = new Logger(ArenaSeasonService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly mailService?: MailService,
  ) {}

  /* --------------------------------------------------------------------
   * Time helpers (mirror sect-war Monday 00:00 ICT cadence)
   * ------------------------------------------------------------------ */

  private currentSeasonWindow(now: Date): { startsAt: Date; endsAt: Date } {
    const tz = ARENA_SEASON_DEFAULT_TZ;
    const parts = localPartsInTz(now, tz);
    const isoDow = parts.dayOfWeek === 0 ? 7 : parts.dayOfWeek;
    const utc = Date.UTC(parts.year, parts.month - 1, parts.day);
    const dt = new Date(utc);
    dt.setUTCDate(dt.getUTCDate() - (isoDow - 1));
    const startsAt = utcDateForLocal(
      dt.getUTCFullYear(),
      dt.getUTCMonth() + 1,
      dt.getUTCDate(),
      0,
      0,
      tz,
    );
    const next = new Date(dt);
    next.setUTCDate(next.getUTCDate() + 7);
    const endsAt = utcDateForLocal(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      0,
      0,
      tz,
    );
    return { startsAt, endsAt };
  }

  /* --------------------------------------------------------------------
   * Lazy-create season + standing
   * ------------------------------------------------------------------ */

  /**
   * Lazy-create `ArenaSeason` cho tuần hiện tại (hoặc trả row đã có). Nếu
   * gọi trong tx, dùng tx; ngược lại dùng `this.prisma`.
   *
   * Race-safe: dùng `upsert` theo `seasonKey` UNIQUE — 2 caller concurrent
   * vẫn ra 1 row.
   */
  async getOrCreateActiveSeason(
    now: Date = new Date(),
    client: AnyClient = this.prisma,
  ): Promise<ArenaSeason> {
    const seasonKey = arenaCurrentSeasonKey(now);
    const window = this.currentSeasonWindow(now);
    const c = client as PrismaClient;
    return c.arenaSeason.upsert({
      where: { seasonKey },
      update: {},
      create: {
        seasonKey,
        status: 'ACTIVE',
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      },
    });
  }

  /**
   * Lazy-create `ArenaStanding` row cho (seasonId, characterId). Nếu đã có
   * trả row hiện tại; ngược lại tạo với `initialRating` (default 1000).
   */
  async getOrCreateStanding(
    seasonId: string,
    characterId: string,
    initialRating: number,
    client: AnyClient = this.prisma,
  ): Promise<ArenaStanding> {
    const c = client as PrismaClient;
    return c.arenaStanding.upsert({
      where: {
        seasonId_characterId: { seasonId, characterId },
      },
      update: {},
      create: {
        seasonId,
        characterId,
        rating: initialRating,
        tier: arenaSeasonTierFor(initialRating),
      },
    });
  }

  /* --------------------------------------------------------------------
   * Apply match → standing (called from ArenaService.createMatch tx)
   * ------------------------------------------------------------------ */

  /**
   * Apply 1 match outcome lên 2 standings (attacker + defender). Idempotent
   * theo standing row — luôn lazy-create rồi update. Phải gọi trong tx
   * cùng với `arenaMatch.update` để rollback nếu fail.
   *
   * `ratingDelta.attacker`/`ratingDelta.defender` được tính ở caller (Elo
   * helper). Service ở đây chỉ apply (clamp rating + recompute tier +
   * increment counters).
   */
  async applyMatchToStandings(
    tx: Tx,
    seasonId: string,
    attackerCharacterId: string,
    defenderCharacterId: string,
    outcome: ArenaMatchOutcome,
    ratingDelta: ArenaRatingDelta,
    attackerRatingAfter: number,
    defenderRatingAfter: number,
  ): Promise<void> {
    // Lazy-create cả 2 standing với rating "before delta" để đúng audit.
    const aBefore = attackerRatingAfter - ratingDelta.attacker;
    const dBefore = defenderRatingAfter - ratingDelta.defender;
    await this.getOrCreateStanding(seasonId, attackerCharacterId, aBefore, tx);
    await this.getOrCreateStanding(seasonId, defenderCharacterId, dBefore, tx);

    // Apply rating + counters cho attacker.
    await tx.arenaStanding.update({
      where: { seasonId_characterId: { seasonId, characterId: attackerCharacterId } },
      data: {
        rating: attackerRatingAfter,
        tier: arenaSeasonTierFor(attackerRatingAfter),
        wins: outcome === 'ATTACKER_WIN' ? { increment: 1 } : undefined,
        losses: outcome === 'DEFENDER_WIN' ? { increment: 1 } : undefined,
      },
    });

    // Apply rating + counters cho defender.
    await tx.arenaStanding.update({
      where: { seasonId_characterId: { seasonId, characterId: defenderCharacterId } },
      data: {
        rating: defenderRatingAfter,
        tier: arenaSeasonTierFor(defenderRatingAfter),
        wins: outcome === 'DEFENDER_WIN' ? { increment: 1 } : undefined,
        losses: outcome === 'ATTACKER_WIN' ? { increment: 1 } : undefined,
      },
    });
  }

  /* --------------------------------------------------------------------
   * Read views
   * ------------------------------------------------------------------ */

  async getCurrentSeasonView(now: Date = new Date()): Promise<ArenaSeasonView> {
    const season = await this.getOrCreateActiveSeason(now);
    return this.toSeasonView(season);
  }

  async getSeasonByKey(seasonKey: string): Promise<ArenaSeasonView | null> {
    const row = await this.prisma.arenaSeason.findUnique({ where: { seasonKey } });
    if (!row) return null;
    return this.toSeasonView(row);
  }

  async getLeaderboard(
    opts: { seasonKey?: string; limit?: number; offset?: number } = {},
    now: Date = new Date(),
  ): Promise<ArenaLeaderboardView> {
    const limit = clampLimit(opts.limit ?? LEADERBOARD_DEFAULT_LIMIT, LEADERBOARD_MAX_LIMIT);
    const offset = Math.max(0, opts.offset ?? 0);
    const season = opts.seasonKey
      ? await this.prisma.arenaSeason.findUnique({ where: { seasonKey: opts.seasonKey } })
      : await this.getOrCreateActiveSeason(now);
    if (!season) {
      return {
        seasonKey: opts.seasonKey ?? arenaCurrentSeasonKey(now),
        entries: [],
        total: 0,
      };
    }
    const total = await this.prisma.arenaStanding.count({
      where: { seasonId: season.id },
    });
    const rows = await this.prisma.arenaStanding.findMany({
      where: { seasonId: season.id },
      orderBy: [{ rating: 'desc' }, { wins: 'desc' }, { characterId: 'asc' }],
      skip: offset,
      take: limit,
      include: {
        character: {
          select: {
            id: true,
            name: true,
            sect: { select: { name: true } },
          },
        },
      },
    });
    const entries: ArenaLeaderboardEntry[] = rows.map((row, i) => ({
      rank: offset + i + 1,
      characterId: row.characterId,
      characterName: row.character.name,
      rating: row.rating,
      tier: this.normalizeTier(row.tier, row.rating),
      wins: row.wins,
      losses: row.losses,
      sectName: row.character.sect?.name ?? null,
    }));
    return {
      seasonKey: season.seasonKey,
      entries,
      total,
    };
  }

  async getMyStanding(
    characterId: string,
    seasonKey?: string,
    now: Date = new Date(),
  ): Promise<ArenaMyStandingView | null> {
    const season = seasonKey
      ? await this.prisma.arenaSeason.findUnique({ where: { seasonKey } })
      : await this.getOrCreateActiveSeason(now);
    if (!season) return null;
    const row = await this.prisma.arenaStanding.findUnique({
      where: { seasonId_characterId: { seasonId: season.id, characterId } },
    });
    if (!row) {
      return {
        seasonKey: season.seasonKey,
        characterId,
        rating: 1000,
        tier: 'SILVER',
        wins: 0,
        losses: 0,
        rank: null,
      };
    }
    // Compute rank live: count standings có rating cao hơn + 1.
    const higher = await this.prisma.arenaStanding.count({
      where: {
        seasonId: season.id,
        OR: [
          { rating: { gt: row.rating } },
          { rating: row.rating, wins: { gt: row.wins } },
        ],
      },
    });
    return {
      seasonKey: season.seasonKey,
      characterId,
      rating: row.rating,
      tier: this.normalizeTier(row.tier, row.rating),
      wins: row.wins,
      losses: row.losses,
      rank: row.rank ?? higher + 1,
    };
  }

  async getRewardPreview(
    seasonKey?: string,
    now: Date = new Date(),
  ): Promise<ArenaSeasonRewardPreviewView> {
    const key = seasonKey ?? arenaCurrentSeasonKey(now);
    return {
      seasonKey: key,
      tiers: ARENA_SEASON_REWARD_TABLE.map((entry) => ({
        tier: entry.tier,
        reward: entry.reward,
        labelI18nKey: entry.labelI18nKey,
        descriptionI18nKey: entry.descriptionI18nKey,
      })),
    };
  }

  /* --------------------------------------------------------------------
   * Settle (Phase 14.1.C M5) — idempotent
   * ------------------------------------------------------------------ */

  /**
   * Settle 1 season:
   *   1. Tìm season theo `seasonKey` (mặc định = current).
   *   2. Chốt rank (sort rating DESC, wins DESC, characterId ASC).
   *   3. Mỗi standing → tier reward → upsert `ArenaSeasonRewardGrant`. Nếu
   *      grant đã có (UNIQUE seasonId+characterId hit), skip mail.
   *   4. Mail reward qua `MailService.sendToCharacter` cho mỗi grant mới.
   *   5. Set season.status = SETTLED + settledAt.
   *
   * Idempotent: gọi lại sẽ không tạo grant trùng (UNIQUE) và không gửi mail
   * trùng (chỉ mail cho grant *new*).
   */
  async settleSeason(
    seasonKey?: string,
    now: Date = new Date(),
  ): Promise<ArenaSeasonSettleSummary> {
    const targetKey = seasonKey ?? arenaCurrentSeasonKey(now);
    const season = await this.prisma.arenaSeason.findUnique({
      where: { seasonKey: targetKey },
    });
    if (!season) {
      throw new ArenaSeasonServiceError('SEASON_NOT_FOUND');
    }

    // Chốt rank — sort theo rating DESC, wins DESC, id ASC.
    const standings = await this.prisma.arenaStanding.findMany({
      where: { seasonId: season.id },
      orderBy: [{ rating: 'desc' }, { wins: 'desc' }, { characterId: 'asc' }],
      include: {
        character: {
          select: { id: true, name: true },
        },
      },
    });

    // Cập nhật rank + tier vào standing trước khi grant — giữ DB
    // consistent dù mail step có fail.
    for (let i = 0; i < standings.length; i++) {
      const s = standings[i];
      const rank = i + 1;
      const tier = arenaSeasonTierFor(s.rating);
      if (s.rank !== rank || s.tier !== tier) {
        await this.prisma.arenaStanding.update({
          where: { id: s.id },
          data: { rank, tier },
        });
      }
    }

    // Idempotent grant — upsert mỗi (seasonId, characterId) → mail nếu mới.
    let grants = 0;
    let newGrants = 0;
    for (let i = 0; i < standings.length; i++) {
      const s = standings[i];
      const rank = i + 1;
      const tier = arenaSeasonTierFor(s.rating);
      const reward = arenaSeasonRewardFor(tier);
      if (!isArenaSeasonRewardValid(reward)) {
        this.logger.warn(
          `[arena-season] settle skip char=${s.characterId} reward=invalid`,
        );
        continue;
      }

      const existing = await this.prisma.arenaSeasonRewardGrant.findUnique({
        where: {
          seasonId_characterId: { seasonId: season.id, characterId: s.characterId },
        },
      });
      if (existing) {
        grants += 1;
        continue;
      }

      // New grant — try to send mail first; nếu fail → ném ra ngoài
      // (transaction view: mail + grant đều fail). Mail là external write
      // → không nên rollback cùng tx Prisma; ta chấp nhận grant tạo trước
      // mail thì idempotent qua check `existing` lần kế.
      let mailId: string | null = null;
      try {
        if (this.mailService) {
          const subj = `Arena ${season.seasonKey} — Rank ${rank} (${tier})`;
          const body = this.buildMailBody(season.seasonKey, rank, tier, reward);
          const mail = await this.mailService.sendToCharacter({
            recipientCharacterId: s.characterId,
            subject: subj,
            body,
            senderName: 'Đấu Trường Vô Lượng',
            rewardLinhThach: BigInt(reward.linhThach),
            rewardTienNgoc: reward.tienNgoc,
            rewardExp: BigInt(reward.exp),
            rewardItems: reward.items.map((it) => ({
              itemKey: it.itemKey,
              qty: it.qty,
            })),
          });
          mailId = mail.id;
        }
      } catch (err) {
        this.logger.warn(
          `[arena-season] mail fail char=${s.characterId} err=${(err as Error).message}`,
        );
        // mailId stays null — grant vẫn ghi để player không bị grant lại,
        // và admin có thể re-send mail manually qua audit.
      }

      try {
        await this.prisma.arenaSeasonRewardGrant.create({
          data: {
            seasonId: season.id,
            characterId: s.characterId,
            rank,
            tier,
            rewardJson: serializeReward(reward),
            mailId,
          },
        });
        grants += 1;
        newGrants += 1;
      } catch (err) {
        // P2002 race — đã có row do call concurrent; coi như existing.
        if ((err as { code?: string }).code === 'P2002') {
          grants += 1;
          continue;
        }
        throw err;
      }
    }

    // Set season status.
    const settledAt = season.settledAt ?? now;
    if (season.status !== 'SETTLED' || season.settledAt === null) {
      await this.prisma.arenaSeason.update({
        where: { id: season.id },
        data: {
          status: 'SETTLED',
          settledAt,
        },
      });
    }

    return {
      seasonKey: season.seasonKey,
      settledAtIso: settledAt.toISOString(),
      participants: standings.length,
      grants,
      newGrants,
    };
  }

  /**
   * Force tạo season kế tiếp — admin manual rollover. Phase 14.1.D có thể
   * thay bằng cron auto-rollover Monday 00:00 ICT.
   */
  async createNextSeason(now: Date = new Date()): Promise<ArenaSeasonView> {
    // Tìm tuần kế bằng cách chuyển 7 ngày tới rồi lấy weekKey ICT.
    const next = new Date(now.getTime() + 7 * 24 * 3_600_000);
    const window = this.currentSeasonWindow(next);
    const seasonKey = `arena_${sectWarWeekKey(next, ARENA_SEASON_DEFAULT_TZ)}`;
    const row = await this.prisma.arenaSeason.upsert({
      where: { seasonKey },
      update: {},
      create: {
        seasonKey,
        status: 'ACTIVE',
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      },
    });
    return this.toSeasonView(row);
  }

  /* --------------------------------------------------------------------
   * Internals
   * ------------------------------------------------------------------ */

  private toSeasonView(row: ArenaSeason): ArenaSeasonView {
    return {
      seasonKey: row.seasonKey,
      status: row.status as ArenaSeasonStatus,
      startsAtIso: row.startsAt.toISOString(),
      endsAtIso: row.endsAt.toISOString(),
      settledAtIso: row.settledAt?.toISOString() ?? null,
      cadence: 'weekly',
      timezone: ARENA_SEASON_DEFAULT_TZ,
    };
  }

  private normalizeTier(stored: string, rating: number): ArenaSeasonTier {
    if (
      stored === 'BRONZE' ||
      stored === 'SILVER' ||
      stored === 'GOLD' ||
      stored === 'DIAMOND' ||
      stored === 'IMMORTAL'
    ) {
      return stored;
    }
    return arenaSeasonTierFor(rating);
  }

  private buildMailBody(
    seasonKey: string,
    rank: number,
    tier: ArenaSeasonTier,
    reward: ArenaSeasonReward,
  ): string {
    const lines: string[] = [];
    lines.push(`Mùa ${seasonKey} đã kết thúc. Bạn xếp hạng ${rank} (${tier}).`);
    if (reward.linhThach > 0) lines.push(`- Linh Thạch: ${reward.linhThach}`);
    if (reward.tienNgoc > 0) lines.push(`- Tiên Ngọc: ${reward.tienNgoc}`);
    if (reward.exp > 0) lines.push(`- EXP: ${reward.exp}`);
    if (reward.items.length > 0) {
      const its = reward.items.map((it) => `${it.itemKey} x${it.qty}`).join(', ');
      lines.push(`- Vật phẩm: ${its}`);
    }
    return lines.join('\n');
  }
}

function clampLimit(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return Math.min(max, LEADERBOARD_DEFAULT_LIMIT);
  return Math.min(Math.max(1, Math.floor(value)), max);
}

function serializeReward(reward: ArenaSeasonReward): Prisma.InputJsonValue {
  return {
    linhThach: reward.linhThach,
    tienNgoc: reward.tienNgoc,
    exp: reward.exp,
    items: reward.items.map((it) => ({ itemKey: it.itemKey, qty: it.qty })),
  };
}
