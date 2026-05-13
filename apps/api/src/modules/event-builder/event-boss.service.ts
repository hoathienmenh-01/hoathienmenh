import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  validateEventBoss,
  type EventBossDef,
  type EventBossType,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 28.0 — EventBossService.
 *
 * Foundation cho boss event — CRUD spec. Combat runtime (attack, damage,
 * last-hit reward) wire ở PR2 với BossModule hiện có.
 */
@Injectable()
export class EventBossService {
  constructor(private readonly prisma: PrismaService) {}

  async list(eventKey: string): Promise<EventBossDef[]> {
    const rows = await this.prisma.eventBossDef.findMany({
      where: { eventKey },
      orderBy: [{ enabled: 'desc' }, { bossTier: 'asc' }, { key: 'asc' }],
    });
    return rows.map((r) => this.toShared(r));
  }

  async upsert(
    input: EventBossDef,
    _adminUserId: string,
  ): Promise<EventBossDef> {
    const v = validateEventBoss(input);
    if (!v.ok) {
      throw new HttpException(
        {
          ok: false,
          error: { code: 'EVENT_BOSS_INVALID', meta: { issues: v.errors } },
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
    const row = await this.prisma.eventBossDef.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        eventKey: input.eventKey,
        bracketKey: input.bracketKey ?? null,
        name: input.name,
        description: input.description ?? '',
        bossType: input.bossType,
        sourceTier: input.sourceTier,
        bossTier: input.bossTier,
        recommendedPower: input.recommendedPower,
        hpFormulaKey: input.hpFormulaKey ?? null,
        scheduleKey: input.scheduleKey ?? null,
        participationRewardProfileKey:
          input.participationRewardProfileKey ?? null,
        damageRankingRewardProfileKey:
          input.damageRankingRewardProfileKey ?? null,
        lastHitRewardProfileKey: input.lastHitRewardProfileKey ?? null,
        sectRewardProfileKey: input.sectRewardProfileKey ?? null,
        dailyAttempts: input.dailyAttempts,
        weeklyAttempts: input.weeklyAttempts ?? null,
        enabled: input.enabled,
      },
      update: {
        bracketKey: input.bracketKey ?? null,
        name: input.name,
        description: input.description ?? '',
        bossType: input.bossType,
        sourceTier: input.sourceTier,
        bossTier: input.bossTier,
        recommendedPower: input.recommendedPower,
        hpFormulaKey: input.hpFormulaKey ?? null,
        scheduleKey: input.scheduleKey ?? null,
        participationRewardProfileKey:
          input.participationRewardProfileKey ?? null,
        damageRankingRewardProfileKey:
          input.damageRankingRewardProfileKey ?? null,
        lastHitRewardProfileKey: input.lastHitRewardProfileKey ?? null,
        sectRewardProfileKey: input.sectRewardProfileKey ?? null,
        dailyAttempts: input.dailyAttempts,
        weeklyAttempts: input.weeklyAttempts ?? null,
        enabled: input.enabled,
      },
    });
    return this.toShared(row);
  }

  private toShared(row: {
    key: string;
    eventKey: string;
    bracketKey: string | null;
    name: string;
    description: string;
    bossType: string;
    sourceTier: number;
    bossTier: number;
    recommendedPower: number;
    hpFormulaKey: string | null;
    scheduleKey: string | null;
    participationRewardProfileKey: string | null;
    damageRankingRewardProfileKey: string | null;
    lastHitRewardProfileKey: string | null;
    sectRewardProfileKey: string | null;
    dailyAttempts: number;
    weeklyAttempts: number | null;
    enabled: boolean;
  }): EventBossDef {
    return {
      key: row.key,
      eventKey: row.eventKey,
      bracketKey: row.bracketKey,
      name: row.name,
      description: row.description,
      bossType: row.bossType as EventBossType,
      sourceTier: row.sourceTier,
      bossTier: row.bossTier,
      recommendedPower: row.recommendedPower,
      hpFormulaKey: row.hpFormulaKey,
      scheduleKey: row.scheduleKey,
      participationRewardProfileKey: row.participationRewardProfileKey,
      damageRankingRewardProfileKey: row.damageRankingRewardProfileKey,
      lastHitRewardProfileKey: row.lastHitRewardProfileKey,
      sectRewardProfileKey: row.sectRewardProfileKey,
      dailyAttempts: row.dailyAttempts,
      weeklyAttempts: row.weeklyAttempts,
      enabled: row.enabled,
    };
  }
}
