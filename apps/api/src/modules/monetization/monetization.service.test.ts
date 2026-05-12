import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { MonetizationError, MonetizationService } from './monetization.service';

let prisma: PrismaService;
let monetization: MonetizationService;

const NOW = new Date('2026-05-12T12:00:00.000Z');
const TOMORROW = new Date('2026-05-13T00:01:00.000Z');

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  monetization = new MonetizationService(prisma, currency, inventory);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('MonetizationService battle pass claims', () => {
  it('claims reached free reward once and writes currency/item ledgers', async () => {
    const f = await makeUserChar(prisma, { linhThach: 1000n });
    await monetization.currentBattlePass(f.userId, NOW);
    await prisma.battlePassProgress.update({
      where: {
        characterId_seasonId: {
          characterId: f.characterId,
          seasonId: 'phase_25_1_foundation',
        },
      },
      data: { xp: 100, level: 1 },
    });

    const state = await monetization.claimBattlePassReward(
      f.userId,
      { level: 1, track: 'free' },
      NOW,
    );

    expect(state.progress.claimedFreeLevels).toContain(1);
    const character = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    expect(character.linhThach).toBe(1500n);
    const currencyLedger = await prisma.currencyLedger.findMany({
      where: { characterId: f.characterId, reason: 'BATTLE_PASS_REWARD' },
    });
    expect(currencyLedger).toHaveLength(1);
    expect(currencyLedger[0].delta).toBe(500n);
    const itemLedger = await prisma.itemLedger.findMany({
      where: { characterId: f.characterId, reason: 'BATTLE_PASS_REWARD' },
    });
    expect(itemLedger.some((row) => row.itemKey === 'tinh_thiet')).toBe(true);

    await expect(
      monetization.claimBattlePassReward(f.userId, { level: 1, track: 'free' }, NOW),
    ).rejects.toMatchObject({ code: 'ALREADY_CLAIMED' });
    const afterDuplicate = await prisma.currencyLedger.count({
      where: { characterId: f.characterId, reason: 'BATTLE_PASS_REWARD' },
    });
    expect(afterDuplicate).toBe(1);
  });

  it('rejects premium claims before unlock and unreached levels', async () => {
    const f = await makeUserChar(prisma);
    await monetization.currentBattlePass(f.userId, NOW);
    await prisma.battlePassProgress.update({
      where: {
        characterId_seasonId: {
          characterId: f.characterId,
          seasonId: 'phase_25_1_foundation',
        },
      },
      data: { xp: 100, level: 1 },
    });

    await expect(
      monetization.claimBattlePassReward(f.userId, { level: 1, track: 'premium' }, NOW),
    ).rejects.toMatchObject({ code: 'PREMIUM_LOCKED' });
    await expect(
      monetization.claimBattlePassReward(f.userId, { level: 2, track: 'free' }, NOW),
    ).rejects.toMatchObject({ code: 'LEVEL_LOCKED' });
  });

  it('claim all grants only currently claimable tracks and does not double claim', async () => {
    const f = await makeUserChar(prisma);
    await monetization.adminGrantBattlePassPremium(f.userId, f.userId, NOW);
    await prisma.battlePassProgress.update({
      where: {
        characterId_seasonId: {
          characterId: f.characterId,
          seasonId: 'phase_25_1_foundation',
        },
      },
      data: { xp: 200, level: 2 },
    });

    const first = await monetization.claimAllBattlePassRewards(f.userId, NOW);
    expect(first.progress.claimedFreeLevels.sort()).toEqual([1, 2]);
    expect(first.progress.claimedPremiumLevels.sort()).toEqual([1, 2]);
    const ledgerCount = await prisma.currencyLedger.count({
      where: { characterId: f.characterId, reason: 'BATTLE_PASS_REWARD' },
    });

    const second = await monetization.claimAllBattlePassRewards(f.userId, NOW);
    expect(second.progress.claimedFreeLevels.sort()).toEqual([1, 2]);
    expect(second.progress.claimedPremiumLevels.sort()).toEqual([1, 2]);
    await expect(
      prisma.currencyLedger.count({
        where: { characterId: f.characterId, reason: 'BATTLE_PASS_REWARD' },
      }),
    ).resolves.toBe(ledgerCount);
  });
});

describe('MonetizationService monthly card and VIP', () => {
  it('claims monthly card once per UTC day with ledger records', async () => {
    const f = await makeUserChar(prisma);
    await monetization.adminGrantMonthlyCard(f.userId, f.userId, NOW);

    const first = await monetization.claimMonthlyCard(f.userId, NOW);
    expect(first.canClaimToday).toBe(false);
    const ledgers = await prisma.currencyLedger.findMany({
      where: { characterId: f.characterId, reason: 'MONTHLY_CARD_REWARD' },
      orderBy: { createdAt: 'asc' },
    });
    expect(ledgers.length).toBeGreaterThanOrEqual(2);

    await expect(monetization.claimMonthlyCard(f.userId, NOW)).rejects.toMatchObject({
      code: 'MONTHLY_CARD_ALREADY_CLAIMED',
    });
    const afterDuplicate = await prisma.currencyLedger.count({
      where: { characterId: f.characterId, reason: 'MONTHLY_CARD_REWARD' },
    });
    expect(afterDuplicate).toBe(ledgers.length);

    const second = await monetization.claimMonthlyCard(f.userId, TOMORROW);
    expect(second.subscription?.totalClaimedDays).toBe(2);
  });

  it('returns VIP light perks after admin grant and records audit', async () => {
    const f = await makeUserChar(prisma);
    await monetization.adminGrantVip(f.userId, f.userId, 2, 80_000);

    const state = await monetization.vip(f.userId);
    expect(state.profile.vipLevel).toBe(2);
    expect(state.perks.dungeonEntryBonusDaily).toBeLessThanOrEqual(1);
    expect(state.perks.inventorySlotBonus).toBeGreaterThan(0);
    await expect(
      prisma.adminAuditLog.count({ where: { action: 'admin.vip.grant' } }),
    ).resolves.toBe(1);
  });

  it('rejects users without characters', async () => {
    await expect(monetization.vip('missing-user')).rejects.toBeInstanceOf(MonetizationError);
  });
});
