import { Injectable } from '@nestjs/common';
import {
  GROWTH_FUND_VARIANTS,
  GROWTH_FUND_V2_VARIANTS,
  LIMITED_SHOP_KEYS,
  LIMITED_SHOP_PERIOD_BY_KEY,
  type MonetizationOverview,
  WALLET_CURRENCIES,
  type WalletCurrencyKey,
  getActiveBattlePassSeason,
  getBattlePassLevelForXp,
  periodKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { EntitlementService } from './entitlement.service';
import { WalletService } from './wallet.service';

/**
 * Phase 27.1–27.5 — MonetizationOverviewService.
 *
 * Aggregator endpoint cho UI `Đặc Quyền` — load 1 call lấy snapshot:
 *   - wallet (6 currency)
 *   - entitlements active
 *   - monthly cards active + canClaimToday
 *   - battle pass season + level + premium status
 *   - growth funds purchased + claimed milestones
 *   - limited shop period keys + reset time
 *   - sweep ticket inventory count
 *   - extra attempt usage today
 *
 * KHÔNG cập nhật state — chỉ READ. Side effect 0.
 */
@Injectable()
export class MonetizationOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly entitlements: EntitlementService,
  ) {}

  async overview(characterId: string, now: Date = new Date()): Promise<MonetizationOverview> {
    const [
      walletBalances,
      activeEntitlements,
      monthlyCards,
      battlePassProgress,
      growthFunds,
      sweepTicketCounts,
      extraAttempts,
    ] = await Promise.all([
      this.loadWallet(characterId),
      this.entitlements.getActiveEntitlements(characterId, now),
      this.loadMonthlyCards(characterId, now),
      this.loadBattlePass(characterId, now),
      this.loadGrowthFunds(characterId),
      this.loadSweepTickets(characterId),
      this.loadExtraAttempts(characterId, now),
    ]);

    const limitedShops = LIMITED_SHOP_KEYS.map((shopKey) => {
      const period = LIMITED_SHOP_PERIOD_BY_KEY[shopKey];
      return {
        shopKey,
        period,
        periodKey: periodKey(now, period),
      };
    });

    return {
      activeEntitlements: activeEntitlements.map((e) => ({
        key: e.key as string,
        value: e.value,
        source: e.source,
        expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null,
      })),
      monthlyCards,
      battlePass: battlePassProgress,
      growthFunds,
      limitedShops,
      sweepTickets: sweepTicketCounts,
      extraAttempts,
      wallet: walletBalances,
    };
  }

  private async loadWallet(
    characterId: string,
  ): Promise<MonetizationOverview['wallet']> {
    const balances = await this.wallet.getWallet(characterId);
    return WALLET_CURRENCIES.map((def): { currency: WalletCurrencyKey; amount: number } => ({
      currency: def.key,
      amount: balances[def.key] ?? 0,
    }));
  }

  private async loadMonthlyCards(
    characterId: string,
    now: Date,
  ): Promise<MonetizationOverview['monthlyCards']> {
    const subs = await this.prisma.monthlyCardSubscription.findMany({
      where: { characterId, activeUntil: { gt: now } },
      orderBy: { cardKey: 'asc' },
    });
    const startOfDay = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    ));
    return subs.map((s) => {
      const daysRemaining = Math.max(
        Math.ceil((s.activeUntil.getTime() - now.getTime()) / 86_400_000),
        0,
      );
      const canClaimToday = !s.lastClaimAt || s.lastClaimAt < startOfDay;
      return {
        cardKey: s.cardKey,
        activeUntil: s.activeUntil.toISOString(),
        daysRemaining,
        canClaimToday,
        lastClaimAt: s.lastClaimAt ? s.lastClaimAt.toISOString() : null,
      };
    });
  }

  private async loadBattlePass(
    characterId: string,
    now: Date,
  ): Promise<MonetizationOverview['battlePass']> {
    const season = getActiveBattlePassSeason(now);
    if (!season) {
      return {
        seasonId: null,
        level: 0,
        maxLevel: 0,
        xp: 0,
        xpPerLevel: 0,
        premiumUnlocked: false,
        endsAt: null,
      };
    }
    const progress = await this.prisma.battlePassProgress.findUnique({
      where: {
        characterId_seasonId: { characterId, seasonId: season.seasonId },
      },
    });
    const xp = progress?.xp ?? 0;
    return {
      seasonId: season.seasonId,
      level: getBattlePassLevelForXp(xp, season),
      maxLevel: season.maxLevel,
      xp,
      xpPerLevel: season.xpPerLevel,
      premiumUnlocked: progress?.premiumUnlocked ?? false,
      endsAt: season.endAt,
    };
  }

  private async loadGrowthFunds(
    characterId: string,
  ): Promise<MonetizationOverview['growthFunds']> {
    const allVariants = [...GROWTH_FUND_VARIANTS, ...GROWTH_FUND_V2_VARIANTS];
    const states = await this.prisma.growthFundState.findMany({
      where: { characterId },
    });
    const stateByKey = new Map(states.map((s) => [s.fundKey, s]));
    return allVariants.map((v) => {
      const state = stateByKey.get(v.key);
      const claimedArr =
        state && Array.isArray(state.claimedMilestonesJson)
          ? state.claimedMilestonesJson.filter((x): x is string => typeof x === 'string')
          : [];
      return {
        fundKey: v.key as string,
        purchased: !!state,
        purchasedAt: state ? state.purchasedAt.toISOString() : null,
        claimedMilestones: claimedArr,
      };
    });
  }

  private async loadSweepTickets(
    characterId: string,
  ): Promise<MonetizationOverview['sweepTickets']> {
    const tickets = ['BI_CANH_TICKET', 'sweep_ticket_common'];
    const inv = await this.prisma.inventoryItem.findMany({
      where: { characterId, itemKey: { in: tickets } },
      select: { itemKey: true, qty: true },
    });
    const byKey = new Map(inv.map((i) => [i.itemKey, i.qty]));
    return tickets.map((itemKey) => ({
      itemKey,
      quantity: byKey.get(itemKey) ?? 0,
    }));
  }

  private async loadExtraAttempts(
    characterId: string,
    now: Date,
  ): Promise<MonetizationOverview['extraAttempts']> {
    const dailyKey = periodKey(now, 'DAILY');
    const rows = await this.prisma.paidLimitPurchase.findMany({
      where: { characterId, periodKey: dailyKey },
      select: { limitKey: true, usedCount: true, maxCount: true },
    });
    const nextReset = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    )).toISOString();
    return rows.map((r) => ({
      limitKey: r.limitKey,
      usedToday: r.usedCount,
      maxPerDay: r.maxCount,
      nextResetAt: nextReset,
    }));
  }
}
