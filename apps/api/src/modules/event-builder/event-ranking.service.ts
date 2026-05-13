import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  validateEventRanking,
  type EventRankingDef,
  type EventRankingType,
  type BracketMode,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 28.0 — EventRankingService.
 *
 * - CRUD ranking def.
 * - Submit / increment score per character.
 * - Finalize (admin): lock ranking, compute rank theo score desc per bracket.
 */
@Injectable()
export class EventRankingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(eventKey: string): Promise<EventRankingDef[]> {
    const rows = await this.prisma.eventRankingDef.findMany({
      where: { eventKey },
      orderBy: [{ enabled: 'desc' }, { startsAt: 'asc' }],
    });
    return rows.map((r) => this.toShared(r));
  }

  async upsert(
    input: EventRankingDef,
    _adminUserId: string,
  ): Promise<EventRankingDef> {
    const v = validateEventRanking(input);
    if (!v.ok) {
      throw new HttpException(
        {
          ok: false,
          error: { code: 'EVENT_RANKING_INVALID', meta: { issues: v.errors } },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const evt = await this.prisma.eventDef.findUnique({
      where: { key: input.eventKey },
    });
    if (!evt) {
      throw new HttpException(
        { ok: false, error: { code: 'EVENT_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    const row = await this.prisma.eventRankingDef.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        eventKey: input.eventKey,
        rankingType: input.rankingType,
        bracketMode: input.bracketMode,
        bracketKey: input.bracketKey ?? null,
        scoreFormulaKey: input.scoreFormulaKey,
        rewardProfileKey: input.rewardProfileKey ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        finalized: input.finalized,
        enabled: input.enabled,
      },
      update: {
        rankingType: input.rankingType,
        bracketMode: input.bracketMode,
        bracketKey: input.bracketKey ?? null,
        scoreFormulaKey: input.scoreFormulaKey,
        rewardProfileKey: input.rewardProfileKey ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        finalized: input.finalized,
        enabled: input.enabled,
      },
    });
    return this.toShared(row);
  }

  // -------------------------------------------------------------------------
  // Player runtime
  // -------------------------------------------------------------------------

  /**
   * Submit / increment score cho 1 character cho 1 ranking. Idempotent
   * theo rankingKey+characterId.
   *
   * Gọi `rankingEligible=false` khi service event đã xác định high-level
   * vào low-bracket bị block ranking — caller phải skip không gọi service.
   */
  async submitScore(input: {
    rankingKey: string;
    characterId: string;
    bracketKey: string | null;
    deltaScore: number;
  }): Promise<{ score: number }> {
    const ranking = await this.prisma.eventRankingDef.findUnique({
      where: { key: input.rankingKey },
    });
    if (!ranking || !ranking.enabled) {
      throw new HttpException(
        { ok: false, error: { code: 'RANKING_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    if (ranking.finalized) {
      throw new HttpException(
        { ok: false, error: { code: 'RANKING_FINALIZED' } },
        HttpStatus.CONFLICT,
      );
    }
    const now = new Date();
    if (now < ranking.startsAt || now > ranking.endsAt) {
      throw new HttpException(
        { ok: false, error: { code: 'RANKING_WINDOW_CLOSED' } },
        HttpStatus.CONFLICT,
      );
    }
    const delta = Math.max(0, Math.floor(input.deltaScore));
    const cur = await this.prisma.eventRankingEntry.findUnique({
      where: {
        rankingKey_characterId: {
          rankingKey: input.rankingKey,
          characterId: input.characterId,
        },
      },
    });
    const newScore = (cur?.score ?? 0) + delta;
    const updated = await this.prisma.eventRankingEntry.upsert({
      where: {
        rankingKey_characterId: {
          rankingKey: input.rankingKey,
          characterId: input.characterId,
        },
      },
      create: {
        eventKey: ranking.eventKey,
        rankingKey: input.rankingKey,
        characterId: input.characterId,
        bracketKey: input.bracketKey,
        score: newScore,
      },
      update: { score: newScore, bracketKey: input.bracketKey ?? cur?.bracketKey },
    });
    return { score: updated.score };
  }

  async leaderboard(
    rankingKey: string,
    opts?: { bracketKey?: string | null; limit?: number },
  ) {
    const limit = Math.min(500, Math.max(1, opts?.limit ?? 100));
    return this.prisma.eventRankingEntry.findMany({
      where: {
        rankingKey,
        ...(opts?.bracketKey !== undefined
          ? { bracketKey: opts.bracketKey }
          : {}),
      },
      orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
      take: limit,
    });
  }

  /**
   * Finalize ranking — compute `rank` per bracket theo score desc; lock
   * `finalized=true`. Idempotent: gọi lần 2 không có-op (đã lock).
   */
  async finalize(
    rankingKey: string,
    _adminUserId: string,
  ): Promise<{ finalized: boolean; entries: number }> {
    const ranking = await this.prisma.eventRankingDef.findUnique({
      where: { key: rankingKey },
    });
    if (!ranking) {
      throw new HttpException(
        { ok: false, error: { code: 'RANKING_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    if (ranking.finalized) {
      return { finalized: false, entries: 0 };
    }
    const entries = await this.prisma.eventRankingEntry.findMany({
      where: { rankingKey },
      orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
    });
    // Tính rank per bracket (NULL bracket = global).
    const perBracket = new Map<string, number>();
    for (const e of entries) {
      const k = e.bracketKey ?? '__GLOBAL__';
      const next = (perBracket.get(k) ?? 0) + 1;
      perBracket.set(k, next);
      await this.prisma.eventRankingEntry.update({
        where: { id: e.id },
        data: { rank: next },
      });
    }
    await this.prisma.eventRankingDef.update({
      where: { key: rankingKey },
      data: { finalized: true },
    });
    return { finalized: true, entries: entries.length };
  }

  private toShared(row: {
    key: string;
    eventKey: string;
    rankingType: string;
    bracketMode: string;
    bracketKey: string | null;
    scoreFormulaKey: string;
    rewardProfileKey: string | null;
    startsAt: Date;
    endsAt: Date;
    finalized: boolean;
    enabled: boolean;
  }): EventRankingDef {
    return {
      key: row.key,
      eventKey: row.eventKey,
      rankingType: row.rankingType as EventRankingType,
      bracketMode: row.bracketMode as BracketMode,
      bracketKey: row.bracketKey,
      scoreFormulaKey: row.scoreFormulaKey,
      rewardProfileKey: row.rewardProfileKey,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      finalized: row.finalized,
      enabled: row.enabled,
    };
  }
}
