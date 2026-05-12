import { describe, expect, it } from 'vitest';
import {
  BATTLE_PASS_SEASONS,
  MONTHLY_CARD_CONFIG,
  getBattlePassLevelForXp,
  canClaimBattlePassReward,
  canClaimMonthlyCard,
  getMonthlyCardDailyReward,
  getVipLevelFromTopup,
  getVipPerks,
  validateBattlePassReward,
  validateBattlePassSeason,
  validateMonthlyCardConfig,
  validateVipPerks,
} from './monetization';

describe('monetization shared config', () => {
  it('maps battle pass xp to capped levels', () => {
    expect(getBattlePassLevelForXp(0)).toBe(0);
    expect(getBattlePassLevelForXp(99)).toBe(0);
    expect(getBattlePassLevelForXp(100)).toBe(1);
    expect(getBattlePassLevelForXp(999)).toBe(9);
    expect(getBattlePassLevelForXp(10_000)).toBe(10);
  });

  it('allows free reward claim when level is reached', () => {
    expect(
      canClaimBattlePassReward(
        {
          xp: 200,
          level: 2,
          premiumUnlocked: false,
          claimedFreeLevels: [],
          claimedPremiumLevels: [],
        },
        2,
        'free',
      ),
    ).toBe(true);
  });

  it('rejects premium reward before premium unlock', () => {
    expect(
      canClaimBattlePassReward(
        {
          xp: 300,
          level: 3,
          premiumUnlocked: false,
          claimedFreeLevels: [],
          claimedPremiumLevels: [],
        },
        3,
        'premium',
      ),
    ).toBe(false);
  });

  it('rejects duplicate battle pass reward claims', () => {
    expect(
      canClaimBattlePassReward(
        {
          xp: 300,
          level: 3,
          premiumUnlocked: true,
          claimedFreeLevels: [3],
          claimedPremiumLevels: [3],
        },
        3,
        'premium',
      ),
    ).toBe(false);
  });

  it('validates reward configs against forbidden direct power', () => {
    expect(BATTLE_PASS_SEASONS.every(validateBattlePassSeason)).toBe(true);
    expect(validateMonthlyCardConfig()).toBe(true);
    expect(validateBattlePassReward({ kind: 'item', key: 'tien_huyen_kiem', qty: 1 })).toBe(
      false,
    );
    expect(validateBattlePassReward({ kind: 'item', key: 'phap_bao_shard', qty: 999 })).toBe(
      false,
    );
  });

  it('allows monthly card claim once per UTC day', () => {
    const subscription = {
      activeUntil: '2026-06-01T00:00:00.000Z',
      lastClaimAt: '2026-05-12T01:00:00.000Z',
      totalClaimedDays: 1,
    };
    expect(canClaimMonthlyCard(subscription, new Date('2026-05-12T23:00:00.000Z'))).toBe(
      false,
    );
    expect(canClaimMonthlyCard(subscription, new Date('2026-05-13T00:00:00.000Z'))).toBe(
      true,
    );
  });

  it('returns daily monthly card rewards with special day rewards', () => {
    const rewards = getMonthlyCardDailyReward(30);
    expect(rewards).toEqual(
      expect.arrayContaining(MONTHLY_CARD_CONFIG.dailyRewards.map((reward) => reward)),
    );
    expect(rewards.some((reward) => reward.key === 'awaken_stone')).toBe(true);
  });

  it('maps VIP level and validates light perks', () => {
    expect(getVipLevelFromTopup(0)).toBe(0);
    expect(getVipLevelFromTopup(50_000)).toBe(1);
    expect(getVipLevelFromTopup(1_000_000)).toBe(5);
    expect(getVipPerks(5).dungeonEntryBonusDaily).toBeLessThanOrEqual(1);
    expect([0, 1, 2, 3, 4, 5].every(validateVipPerks)).toBe(true);
  });
});
