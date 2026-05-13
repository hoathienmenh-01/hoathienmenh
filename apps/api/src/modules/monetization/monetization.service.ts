import { Injectable } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import {
  MONTHLY_CARD_CONFIG,
  getActiveBattlePassSeason,
  getBattlePassLevelForXp,
  getBattlePassReward,
  canClaimBattlePassReward,
  canClaimMonthlyCard,
  getMonthlyCardDailyReward,
  getMonthlyCardDaysRemaining,
  getVipLevelFromTopup,
  getVipPerks,
  validateBattlePassReward,
  validateVipPerks,
  type BattlePassSeasonDef,
  type BattlePassTrack,
  type MonetizationReward,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';

export class MonetizationError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'NO_ACTIVE_SEASON'
      | 'INVALID_INPUT'
      | 'LEVEL_LOCKED'
      | 'PREMIUM_LOCKED'
      | 'ALREADY_CLAIMED'
      | 'INACTIVE_MONTHLY_CARD'
      | 'MONTHLY_CARD_ALREADY_CLAIMED',
  ) {
    super(code);
  }
}

export interface BattlePassState {
  season: BattlePassSeasonDef;
  progress: {
    xp: number;
    level: number;
    premiumUnlocked: boolean;
    claimedFreeLevels: number[];
    claimedPremiumLevels: number[];
  };
}

@Injectable()
export class MonetizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
  ) {}

  async currentBattlePass(userId: string, now: Date = new Date()): Promise<BattlePassState> {
    const characterId = await this.getCharacterId(userId);
    const season = await this.ensureActiveSeason(now);
    const progress = await this.ensureBattlePassProgress(characterId, season);
    return { season, progress: this.toProgressView(progress) };
  }

  async battlePassProgress(userId: string, now: Date = new Date()): Promise<BattlePassState> {
    return this.currentBattlePass(userId, now);
  }

  async claimBattlePassReward(
    userId: string,
    input: { level: number; track: BattlePassTrack },
    now: Date = new Date(),
  ): Promise<BattlePassState> {
    if (!Number.isInteger(input.level) || input.level < 1) {
      throw new MonetizationError('INVALID_INPUT');
    }
    const characterId = await this.getCharacterId(userId);
    const season = await this.ensureActiveSeason(now);
    await this.prisma.$transaction(async (tx) => {
      const progress = await this.ensureBattlePassProgressTx(tx, characterId, season);
      this.assertBattlePassClaimable(progress, input.level, input.track);
      const rewards = this.validatedRewards(getBattlePassReward(input.level, input.track, season));
      const data =
        input.track === 'free'
          ? { claimedFreeLevels: { push: input.level } }
          : { claimedPremiumLevels: { push: input.level } };
      const updated = await tx.battlePassProgress.updateMany({
        where: { id: progress.id },
        data,
      });
      if (updated.count === 0) throw new MonetizationError('ALREADY_CLAIMED');
      await this.grantRewardsTx(tx, characterId, rewards, {
        reason: 'BATTLE_PASS_REWARD',
        refType: 'BattlePassProgress',
        refId: `${season.seasonId}:${input.track}:${input.level}`,
        meta: { seasonId: season.seasonId, track: input.track, level: input.level },
      });
    });
    return this.currentBattlePass(userId, now);
  }

  async claimAllBattlePassRewards(
    userId: string,
    now: Date = new Date(),
  ): Promise<BattlePassState> {
    const characterId = await this.getCharacterId(userId);
    const season = await this.ensureActiveSeason(now);
    await this.prisma.$transaction(async (tx) => {
      const progress = await this.ensureBattlePassProgressTx(tx, characterId, season);
      const claims: { level: number; track: BattlePassTrack; rewards: MonetizationReward[] }[] =
        [];
      for (const reward of season.rewards) {
        for (const track of ['free', 'premium'] as const) {
          if (canClaimBattlePassReward(progress, reward.level, track)) {
            claims.push({
              level: reward.level,
              track,
              rewards: this.validatedRewards(getBattlePassReward(reward.level, track, season)),
            });
          }
        }
      }
      if (claims.length === 0) return;
      const freeLevels = claims.filter((claim) => claim.track === 'free').map((claim) => claim.level);
      const premiumLevels = claims
        .filter((claim) => claim.track === 'premium')
        .map((claim) => claim.level);
      await tx.battlePassProgress.update({
        where: { id: progress.id },
        data: {
          claimedFreeLevels: [...new Set([...progress.claimedFreeLevels, ...freeLevels])],
          claimedPremiumLevels: [
            ...new Set([...progress.claimedPremiumLevels, ...premiumLevels]),
          ],
        },
      });
      for (const claim of claims) {
        await this.grantRewardsTx(tx, characterId, claim.rewards, {
          reason: 'BATTLE_PASS_REWARD',
          refType: 'BattlePassProgress',
          refId: `${season.seasonId}:${claim.track}:${claim.level}`,
          meta: { seasonId: season.seasonId, track: claim.track, level: claim.level },
        });
      }
    });
    return this.currentBattlePass(userId, now);
  }

  async monthlyCard(userId: string, now: Date = new Date()) {
    const characterId = await this.getCharacterId(userId);
    const subscription = await this.prisma.monthlyCardSubscription.findUnique({
      where: {
        characterId_cardKey: { characterId, cardKey: LEGACY_MONTHLY_CARD_KEY },
      },
    });
    const nextDay = (subscription?.totalClaimedDays ?? 0) + 1;
    return {
      subscription,
      config: MONTHLY_CARD_CONFIG,
      active: subscription ? subscription.activeUntil > now : false,
      daysRemaining: getMonthlyCardDaysRemaining(subscription, now),
      canClaimToday: canClaimMonthlyCard(subscription, now),
      todayReward: getMonthlyCardDailyReward(nextDay),
    };
  }

  async claimMonthlyCard(userId: string, now: Date = new Date()) {
    const characterId = await this.getCharacterId(userId);
    await this.prisma.$transaction(async (tx) => {
      const subscription = await tx.monthlyCardSubscription.findUnique({
        where: {
          characterId_cardKey: { characterId, cardKey: LEGACY_MONTHLY_CARD_KEY },
        },
      });
      if (!subscription || subscription.activeUntil <= now) {
        throw new MonetizationError('INACTIVE_MONTHLY_CARD');
      }
      if (!canClaimMonthlyCard(subscription, now)) {
        throw new MonetizationError('MONTHLY_CARD_ALREADY_CLAIMED');
      }
      const day = subscription.totalClaimedDays + 1;
      const updated = await tx.monthlyCardSubscription.updateMany({
        where: {
          id: subscription.id,
          activeUntil: { gt: now },
          OR: [
            { lastClaimAt: null },
            { lastClaimAt: { lt: startOfUtcDay(now) } },
          ],
        },
        data: {
          lastClaimAt: now,
          totalClaimedDays: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new MonetizationError('MONTHLY_CARD_ALREADY_CLAIMED');
      }
      await this.grantRewardsTx(tx, characterId, getMonthlyCardDailyReward(day), {
        reason: 'MONTHLY_CARD_REWARD',
        refType: 'MonthlyCardSubscription',
        refId: `${subscription.id}:${day}`,
        meta: { day },
      });
    });
    return this.monthlyCard(userId, now);
  }

  async vip(userId: string) {
    const characterId = await this.getCharacterId(userId);
    const profile = await this.prisma.vipProfile.upsert({
      where: { characterId },
      create: { characterId, vipLevel: 0, lifetimeTopupAmount: 0 },
      update: {},
    });
    return {
      profile,
      perks: getVipPerks(profile.vipLevel),
      nextLevel: profile.vipLevel >= 5 ? null : profile.vipLevel + 1,
    };
  }

  async adminGrantBattlePassPremium(actorUserId: string, userId: string, now = new Date()) {
    const characterId = await this.getCharacterId(userId);
    const season = await this.ensureActiveSeason(now);
    await this.prisma.$transaction(async (tx) => {
      await this.ensureBattlePassProgressTx(tx, characterId, season);
      await tx.battlePassProgress.update({
        where: { characterId_seasonId: { characterId, seasonId: season.seasonId } },
        data: { premiumUnlocked: true },
      });
      await tx.adminAuditLog.create({
        data: {
          actorUserId,
          action: 'admin.battle_pass.grant_premium',
          meta: { userId, characterId, seasonId: season.seasonId },
        },
      });
    });
  }

  async adminGrantMonthlyCard(
    actorUserId: string,
    userId: string,
    now = new Date(),
  ) {
    const characterId = await this.getCharacterId(userId);
    const activeUntil = new Date(now.getTime() + MONTHLY_CARD_CONFIG.durationDays * 86_400_000);
    await this.prisma.$transaction(async (tx) => {
      const subscription = await tx.monthlyCardSubscription.upsert({
        where: {
          characterId_cardKey: { characterId, cardKey: LEGACY_MONTHLY_CARD_KEY },
        },
        create: { characterId, cardKey: LEGACY_MONTHLY_CARD_KEY, activeUntil },
        update: { activeUntil },
      });
      await this.grantRewardsTx(tx, characterId, MONTHLY_CARD_CONFIG.upfrontReward, {
        reason: 'MONTHLY_CARD_REWARD',
        refType: 'MonthlyCardSubscription',
        refId: `${subscription.id}:upfront:${now.toISOString()}`,
        meta: { upfront: true },
        actorUserId,
      });
      await tx.adminAuditLog.create({
        data: {
          actorUserId,
          action: 'admin.monthly_card.grant',
          meta: { userId, characterId, activeUntil: activeUntil.toISOString() },
        },
      });
    });
  }

  async adminGrantVip(actorUserId: string, userId: string, level: number, lifetimeTopupAmount = 0) {
    if (!validateVipPerks(level)) throw new MonetizationError('INVALID_INPUT');
    const characterId = await this.getCharacterId(userId);
    const derivedLevel = Math.max(level, getVipLevelFromTopup(lifetimeTopupAmount));
    if (!validateVipPerks(derivedLevel)) throw new MonetizationError('INVALID_INPUT');
    await this.prisma.$transaction(async (tx) => {
      await tx.vipProfile.upsert({
        where: { characterId },
        create: {
          characterId,
          vipLevel: derivedLevel,
          lifetimeTopupAmount,
          grantedByAdmin: true,
        },
        update: {
          vipLevel: derivedLevel,
          lifetimeTopupAmount,
          grantedByAdmin: true,
        },
      });
      await tx.adminAuditLog.create({
        data: {
          actorUserId,
          action: 'admin.vip.grant',
          meta: { userId, characterId, vipLevel: derivedLevel, lifetimeTopupAmount },
        },
      });
    });
  }

  private async getCharacterId(userId: string): Promise<string> {
    const character = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!character) throw new MonetizationError('NO_CHARACTER');
    return character.id;
  }

  private async ensureActiveSeason(now: Date): Promise<BattlePassSeasonDef> {
    const season = getActiveBattlePassSeason(now);
    if (!season) throw new MonetizationError('NO_ACTIVE_SEASON');
    await this.prisma.battlePassSeason.upsert({
      where: { seasonId: season.seasonId },
      create: {
        seasonId: season.seasonId,
        name: season.nameVi,
        startAt: new Date(season.startAt),
        endAt: new Date(season.endAt),
        active: season.active,
        config: season as unknown as Prisma.InputJsonValue,
      },
      update: {
        name: season.nameVi,
        startAt: new Date(season.startAt),
        endAt: new Date(season.endAt),
        active: season.active,
        config: season as unknown as Prisma.InputJsonValue,
      },
    });
    return season;
  }

  private async ensureBattlePassProgress(characterId: string, season: BattlePassSeasonDef) {
    return this.prisma.battlePassProgress.upsert({
      where: { characterId_seasonId: { characterId, seasonId: season.seasonId } },
      create: { characterId, seasonId: season.seasonId },
      update: {
        level: getBattlePassLevelForXp(0, season),
      },
    });
  }

  private async ensureBattlePassProgressTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    season: BattlePassSeasonDef,
  ) {
    const existing = await tx.battlePassProgress.findUnique({
      where: { characterId_seasonId: { characterId, seasonId: season.seasonId } },
    });
    if (existing) {
      const level = getBattlePassLevelForXp(existing.xp, season);
      if (existing.level !== level) {
        return tx.battlePassProgress.update({
          where: { id: existing.id },
          data: { level },
        });
      }
      return existing;
    }
    return tx.battlePassProgress.create({
      data: { characterId, seasonId: season.seasonId },
    });
  }

  private assertBattlePassClaimable(
    progress: {
      xp: number;
      level: number;
      premiumUnlocked: boolean;
      claimedFreeLevels: number[];
      claimedPremiumLevels: number[];
    },
    level: number,
    track: BattlePassTrack,
  ) {
    if (progress.level < level) throw new MonetizationError('LEVEL_LOCKED');
    if (track === 'premium' && !progress.premiumUnlocked) {
      throw new MonetizationError('PREMIUM_LOCKED');
    }
    if (!canClaimBattlePassReward(progress, level, track)) {
      throw new MonetizationError('ALREADY_CLAIMED');
    }
  }

  private async grantRewardsTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    rewards: readonly MonetizationReward[],
    meta: {
      reason: 'BATTLE_PASS_REWARD' | 'MONTHLY_CARD_REWARD';
      refType: string;
      refId: string;
      meta: Record<string, unknown>;
      actorUserId?: string;
    },
  ) {
    const items: { itemKey: string; qty: number }[] = [];
    for (const reward of rewards) {
      if (reward.kind === 'currency') {
        if (reward.key === 'linhThach') {
          await this.currency.applyTx(tx, {
            characterId,
            currency: CurrencyKind.LINH_THACH,
            delta: BigInt(reward.qty),
            reason: meta.reason,
            refType: meta.refType,
            refId: meta.refId,
            meta: meta.meta,
            actorUserId: meta.actorUserId,
          });
        }
        if (reward.key === 'tienNgocKhoa') {
          await tx.character.update({
            where: { id: characterId },
            data: { tienNgocKhoa: { increment: reward.qty } },
          });
          await tx.currencyLedger.create({
            data: {
              characterId,
              currency: CurrencyKind.TIEN_NGOC,
              delta: BigInt(reward.qty),
              reason: meta.reason,
              refType: meta.refType,
              refId: meta.refId,
              meta: { ...meta.meta, locked: true },
              actorUserId: meta.actorUserId,
            },
          });
        }
      }
      if (reward.kind === 'item') items.push({ itemKey: reward.key, qty: reward.qty });
    }
    if (items.length > 0) {
      await this.inventory.grantTx(tx, characterId, items, {
        reason: meta.reason,
        refType: meta.refType,
        refId: meta.refId,
        actorUserId: meta.actorUserId,
        extra: meta.meta as Prisma.InputJsonValue,
      });
    }
  }

  private validatedRewards(rewards: readonly MonetizationReward[]): MonetizationReward[] {
    if (!rewards.every(validateBattlePassReward)) {
      throw new MonetizationError('INVALID_INPUT');
    }
    return [...rewards];
  }

  private toProgressView(progress: {
    xp: number;
    level: number;
    premiumUnlocked: boolean;
    claimedFreeLevels: number[];
    claimedPremiumLevels: number[];
  }) {
    return {
      xp: progress.xp,
      level: progress.level,
      premiumUnlocked: progress.premiumUnlocked,
      claimedFreeLevels: progress.claimedFreeLevels,
      claimedPremiumLevels: progress.claimedPremiumLevels,
    };
  }
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Phase 27.0 — Legacy MonthlyCardSubscription rows pre-Phase 27.0 default to
 * `tieu_nguyet_tap` ("Tiểu Nguyệt Tạp"). Thứ tụ đổi unique sang composite
  * `(characterId, cardKey)` nên lối đi "legacy" vẫn dùng `cardKey` này.
 */
const LEGACY_MONTHLY_CARD_KEY = 'tieu_nguyet_tap';
