import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  validateEventBracket,
  validateEventBalancePolicy,
  resolveBracketForPlayer,
  computeEffectiveRewardTier,
  isHighLevelInLowBracket,
  computeTokenPenaltyMultiplier,
  defaultEventBalancePolicy,
  type EventBracketDef,
  type EventBalancePolicy,
  type PaidRewardPolicy,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 28.0 — BracketService.
 *
 * Quản lý `EventBracket` + `EventBalancePolicy` per event. Trách nhiệm:
 *   - CRUD bracket (validate qua shared validator).
 *   - CRUD balance policy 1-1.
 *   - Resolve bracket cho player given realmOrder.
 *   - Compute effective reward tier theo formula
 *     `min(playerTier, bracketTier, eventMaxTier)`.
 *   - Token penalty multiplier cho high-level player vào low bracket.
 */
@Injectable()
export class BracketService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Bracket CRUD
  // -------------------------------------------------------------------------

  async listForEvent(eventKey: string): Promise<EventBracketDef[]> {
    const rows = await this.prisma.eventBracket.findMany({
      where: { eventKey },
      orderBy: [{ bracketTier: 'asc' }, { minRealmOrder: 'asc' }],
    });
    return rows.map((r) => this.toShared(r));
  }

  async upsertBracket(
    input: EventBracketDef,
    _adminUserId: string,
  ): Promise<EventBracketDef> {
    const v = validateEventBracket(input);
    if (!v.ok) {
      throw new HttpException(
        {
          ok: false,
          error: { code: 'EVENT_BRACKET_INVALID', meta: { issues: v.errors } },
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
    const row = await this.prisma.eventBracket.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        eventKey: input.eventKey,
        name: input.name,
        minRealmOrder: input.minRealmOrder,
        maxRealmOrder: input.maxRealmOrder,
        minBodyRealmOrder: input.minBodyRealmOrder ?? null,
        maxBodyRealmOrder: input.maxBodyRealmOrder ?? null,
        bracketTier: input.bracketTier,
        rewardTierMin: input.rewardTierMin,
        rewardTierMax: input.rewardTierMax,
        eventMaxTier: input.eventMaxTier,
        rankingEnabled: input.rankingEnabled,
        shopFilterTier: input.shopFilterTier,
        bossPowerMultiplier: input.bossPowerMultiplier,
        missionScalingMultiplier: input.missionScalingMultiplier,
        enabled: input.enabled,
      },
      update: {
        name: input.name,
        minRealmOrder: input.minRealmOrder,
        maxRealmOrder: input.maxRealmOrder,
        minBodyRealmOrder: input.minBodyRealmOrder ?? null,
        maxBodyRealmOrder: input.maxBodyRealmOrder ?? null,
        bracketTier: input.bracketTier,
        rewardTierMin: input.rewardTierMin,
        rewardTierMax: input.rewardTierMax,
        eventMaxTier: input.eventMaxTier,
        rankingEnabled: input.rankingEnabled,
        shopFilterTier: input.shopFilterTier,
        bossPowerMultiplier: input.bossPowerMultiplier,
        missionScalingMultiplier: input.missionScalingMultiplier,
        enabled: input.enabled,
      },
    });
    return this.toShared(row);
  }

  async deleteBracket(key: string): Promise<{ deleted: boolean }> {
    const existing = await this.prisma.eventBracket.findUnique({
      where: { key },
    });
    if (!existing) {
      throw new HttpException(
        { ok: false, error: { code: 'EVENT_BRACKET_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    await this.prisma.eventBracket.delete({ where: { key } });
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Balance policy CRUD
  // -------------------------------------------------------------------------

  async getPolicy(eventKey: string): Promise<EventBalancePolicy | null> {
    const row = await this.prisma.eventBalancePolicy.findUnique({
      where: { eventKey },
    });
    return row ? this.policyToShared(row) : null;
  }

  async upsertPolicy(
    input: EventBalancePolicy,
    adminUserId: string,
  ): Promise<EventBalancePolicy> {
    const v = validateEventBalancePolicy(input);
    if (!v.ok) {
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'EVENT_BALANCE_POLICY_INVALID',
            meta: { issues: v.errors },
          },
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
    const row = await this.prisma.eventBalancePolicy.upsert({
      where: { eventKey: input.eventKey },
      create: {
        eventKey: input.eventKey,
        maxTokenPerDay: input.maxTokenPerDay,
        maxTokenPerWeek: input.maxTokenPerWeek,
        maxTokenPerEvent: input.maxTokenPerEvent,
        maxRareRewardPerDay: input.maxRareRewardPerDay,
        maxRareRewardPerWeek: input.maxRareRewardPerWeek,
        maxShopRareExchangePerEvent: input.maxShopRareExchangePerEvent,
        allowHighLevelEnterLowBracket: input.allowHighLevelEnterLowBracket,
        highLevelLowBracketTokenPenaltyPercent:
          input.highLevelLowBracketTokenPenaltyPercent,
        highLevelLowBracketRankingDisabled:
          input.highLevelLowBracketRankingDisabled,
        sourceTierRewardCap: input.sourceTierRewardCap,
        maxAllowedRewardTierDelta: input.maxAllowedRewardTierDelta,
        paidRewardPolicy: input.paidRewardPolicy,
        enabled: input.enabled,
        updatedByAdminId: adminUserId,
      },
      update: {
        maxTokenPerDay: input.maxTokenPerDay,
        maxTokenPerWeek: input.maxTokenPerWeek,
        maxTokenPerEvent: input.maxTokenPerEvent,
        maxRareRewardPerDay: input.maxRareRewardPerDay,
        maxRareRewardPerWeek: input.maxRareRewardPerWeek,
        maxShopRareExchangePerEvent: input.maxShopRareExchangePerEvent,
        allowHighLevelEnterLowBracket: input.allowHighLevelEnterLowBracket,
        highLevelLowBracketTokenPenaltyPercent:
          input.highLevelLowBracketTokenPenaltyPercent,
        highLevelLowBracketRankingDisabled:
          input.highLevelLowBracketRankingDisabled,
        sourceTierRewardCap: input.sourceTierRewardCap,
        maxAllowedRewardTierDelta: input.maxAllowedRewardTierDelta,
        paidRewardPolicy: input.paidRewardPolicy,
        enabled: input.enabled,
        updatedByAdminId: adminUserId,
      },
    });
    return this.policyToShared(row);
  }

  defaultPolicy(eventKey: string): EventBalancePolicy {
    return defaultEventBalancePolicy(eventKey);
  }

  // -------------------------------------------------------------------------
  // Resolve bracket cho player
  // -------------------------------------------------------------------------

  async resolveForPlayer(
    eventKey: string,
    playerRealmOrder: number,
  ): Promise<EventBracketDef | null> {
    const brackets = await this.listForEvent(eventKey);
    const enabled = brackets.filter((b) => b.enabled);
    return resolveBracketForPlayer(enabled, playerRealmOrder);
  }

  /**
   * Tính reward tier hiệu lực + multiplier penalty cho 1 player.
   *
   * Trả về:
   *  - bracket = null nếu không bracket nào match
   *  - rewardTier = min(playerTier, bracketTier, eventMaxTier)
   *  - tokenMultiplier (≥ 0) cap penalty cho high-level low-bracket
   *  - rankingEligible: false nếu policy block hoặc bracket high-level
   */
  async computePlayerContext(
    eventKey: string,
    playerRealmOrder: number,
    playerTier: number,
  ): Promise<{
    bracket: EventBracketDef | null;
    rewardTier: number;
    tokenMultiplier: number;
    rankingEligible: boolean;
  }> {
    const bracket = await this.resolveForPlayer(eventKey, playerRealmOrder);
    const policy = await this.getPolicy(eventKey);
    if (!bracket) {
      return {
        bracket: null,
        rewardTier: 1,
        tokenMultiplier: 0,
        rankingEligible: false,
      };
    }
    const rewardTier = computeEffectiveRewardTier(
      playerTier,
      bracket.bracketTier,
      bracket.eventMaxTier,
    );
    const isHigh = isHighLevelInLowBracket(playerTier, bracket.bracketTier);
    const penalty = policy?.highLevelLowBracketTokenPenaltyPercent ?? 0.5;
    const tokenMultiplier = isHigh
      ? computeTokenPenaltyMultiplier(playerTier, bracket.bracketTier, penalty)
      : 1;
    const rankingEligible =
      bracket.rankingEnabled &&
      !(policy?.highLevelLowBracketRankingDisabled && isHigh);
    return { bracket, rewardTier, tokenMultiplier, rankingEligible };
  }

  // -------------------------------------------------------------------------
  // Shaping
  // -------------------------------------------------------------------------

  private toShared(row: {
    key: string;
    eventKey: string;
    name: string;
    minRealmOrder: number;
    maxRealmOrder: number;
    minBodyRealmOrder: number | null;
    maxBodyRealmOrder: number | null;
    bracketTier: number;
    rewardTierMin: number;
    rewardTierMax: number;
    eventMaxTier: number;
    rankingEnabled: boolean;
    shopFilterTier: number;
    bossPowerMultiplier: number;
    missionScalingMultiplier: number;
    enabled: boolean;
  }): EventBracketDef {
    return {
      key: row.key,
      eventKey: row.eventKey,
      name: row.name,
      minRealmOrder: row.minRealmOrder,
      maxRealmOrder: row.maxRealmOrder,
      minBodyRealmOrder: row.minBodyRealmOrder,
      maxBodyRealmOrder: row.maxBodyRealmOrder,
      bracketTier: row.bracketTier,
      rewardTierMin: row.rewardTierMin,
      rewardTierMax: row.rewardTierMax,
      eventMaxTier: row.eventMaxTier,
      rankingEnabled: row.rankingEnabled,
      shopFilterTier: row.shopFilterTier,
      bossPowerMultiplier: row.bossPowerMultiplier,
      missionScalingMultiplier: row.missionScalingMultiplier,
      enabled: row.enabled,
    };
  }

  private policyToShared(row: {
    eventKey: string;
    maxTokenPerDay: number;
    maxTokenPerWeek: number;
    maxTokenPerEvent: number;
    maxRareRewardPerDay: number;
    maxRareRewardPerWeek: number;
    maxShopRareExchangePerEvent: number;
    allowHighLevelEnterLowBracket: boolean;
    highLevelLowBracketTokenPenaltyPercent: number;
    highLevelLowBracketRankingDisabled: boolean;
    sourceTierRewardCap: number;
    maxAllowedRewardTierDelta: number;
    paidRewardPolicy: string;
    enabled: boolean;
  }): EventBalancePolicy {
    return {
      eventKey: row.eventKey,
      maxTokenPerDay: row.maxTokenPerDay,
      maxTokenPerWeek: row.maxTokenPerWeek,
      maxTokenPerEvent: row.maxTokenPerEvent,
      maxRareRewardPerDay: row.maxRareRewardPerDay,
      maxRareRewardPerWeek: row.maxRareRewardPerWeek,
      maxShopRareExchangePerEvent: row.maxShopRareExchangePerEvent,
      allowHighLevelEnterLowBracket: row.allowHighLevelEnterLowBracket,
      highLevelLowBracketTokenPenaltyPercent:
        row.highLevelLowBracketTokenPenaltyPercent,
      highLevelLowBracketRankingDisabled: row.highLevelLowBracketRankingDisabled,
      sourceTierRewardCap: row.sourceTierRewardCap,
      maxAllowedRewardTierDelta: row.maxAllowedRewardTierDelta,
      paidRewardPolicy: row.paidRewardPolicy as PaidRewardPolicy,
      enabled: row.enabled,
    };
  }
}
