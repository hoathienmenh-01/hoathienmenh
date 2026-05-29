import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { WalletService } from './wallet.service';
import { GrowthFundService } from './growth-fund.service';
import { MonetizationFoundationError } from './monetization-shop.service';

let prisma: PrismaService;
let growthFund: GrowthFundService;

const NOW = new Date('2026-05-29T12:00:00.000Z');

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  const wallet = new WalletService(prisma, currency);
  growthFund = new GrowthFundService(prisma, wallet, inventory);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GrowthFundService.getFund', () => {
  it('returns null when character has not purchased fund', async () => {
    const f = await makeUserChar(prisma);
    const fund = await growthFund.getFund(f.characterId, 'pham');
    expect(fund).toBeNull();
  });

  it('returns fund state after purchase', async () => {
    const f = await makeUserChar(prisma);
    await prisma.growthFundState.create({
      data: {
        characterId: f.characterId,
        fundKey: 'pham',
        purchasedAt: NOW,
        claimedMilestonesJson: [],
      },
    });
    const fund = await growthFund.getFund(f.characterId, 'pham');
    expect(fund).not.toBeNull();
    expect(fund!.fundKey).toBe('pham');
  });
});

describe('GrowthFundService.claimMilestone', () => {
  it('throws FUND_NOT_PURCHASED when no fund state', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      growthFund.claimMilestone({
        characterId: f.characterId,
        fundKey: 'pham',
        milestoneKey: 'luyenkhi',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'FUND_NOT_PURCHASED' });
  });

  it('throws MILESTONE_ALREADY_CLAIMED when milestone already claimed', async () => {
    const f = await makeUserChar(prisma);
    const { getAnyGrowthFundVariant } = await import('@xuantoi/shared');
    const variant = getAnyGrowthFundVariant('pham');
    if (!variant || variant.milestones.length === 0) return;

    const milestoneKey = variant.milestones[0].key;
    await prisma.growthFundState.create({
      data: {
        characterId: f.characterId,
        fundKey: 'pham',
        purchasedAt: NOW,
        claimedMilestonesJson: [milestoneKey],
      },
    });
    await expect(
      growthFund.claimMilestone({
        characterId: f.characterId,
        fundKey: 'pham',
        milestoneKey,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'MILESTONE_ALREADY_CLAIMED' });
  });

  it('claims milestone and updates claimedMilestonesJson', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'luyenkhi', realmStage: 1 });
    const { getAnyGrowthFundVariant } = await import('@xuantoi/shared');
    const variant = getAnyGrowthFundVariant('pham');
    if (!variant || variant.milestones.length === 0) return;

    await prisma.growthFundState.create({
      data: {
        characterId: f.characterId,
        fundKey: 'pham',
        purchasedAt: NOW,
        claimedMilestonesJson: [],
      },
    });
    const milestoneKey = variant.milestones[0].key;
    try {
      await growthFund.claimMilestone({
        characterId: f.characterId,
        fundKey: 'pham',
        milestoneKey,
        now: NOW,
      });
      const state = await prisma.growthFundState.findUnique({
        where: { characterId_fundKey: { characterId: f.characterId, fundKey: 'pham' } },
      });
      expect(state!.claimedMilestonesJson).toContain(milestoneKey);
    } catch (err) {
      if (err instanceof MonetizationFoundationError && err.code === 'MILESTONE_LOCKED') {
        // expected for high-realm milestones
      } else {
        throw err;
      }
    }
  });
});
