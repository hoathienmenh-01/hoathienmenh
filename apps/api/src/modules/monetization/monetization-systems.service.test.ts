import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { WalletService } from './wallet.service';
import { EntitlementService } from './entitlement.service';
import {
  MonetizationFoundationError,
  MonetizationShopService,
} from './monetization-shop.service';
import { GrowthFundService } from './growth-fund.service';
import { BattlePassV2Service } from './battle-pass-v2.service';
import { LimitedShopService } from './limited-shop.service';
import { MonetizationOverviewService } from './monetization-overview.service';

let prisma: PrismaService;
let wallet: WalletService;
let entitlements: EntitlementService;
let shop: MonetizationShopService;
let growthFund: GrowthFundService;
let battlePassV2: BattlePassV2Service;
let limitedShop: LimitedShopService;
let overview: MonetizationOverviewService;

// Phase 27.1+ — pin clock inside active battle pass season
// `phase_25_1_foundation` (2026-05-01 → 2026-06-01).
const NOW = new Date('2026-05-15T12:00:00.000Z');

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  wallet = new WalletService(prisma, currency);
  entitlements = new EntitlementService(prisma);
  shop = new MonetizationShopService(prisma, wallet, entitlements, inventory);
  growthFund = new GrowthFundService(prisma, wallet, inventory);
  battlePassV2 = new BattlePassV2Service(prisma);
  limitedShop = new LimitedShopService(prisma, wallet, inventory);
  overview = new MonetizationOverviewService(prisma, wallet, entitlements);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('BattlePassV2Service — missions DAILY/WEEKLY/SEASON', () => {
  it('lists all V1 missions with 0 progress for fresh character', async () => {
    const f = await makeUserChar(prisma);
    const view = await battlePassV2.listMissions(f.characterId, NOW);
    expect(view.seasonId).toBeTruthy();
    expect(view.daily.length).toBeGreaterThan(0);
    expect(view.weekly.length).toBeGreaterThan(0);
    expect(view.season.length).toBeGreaterThan(0);
    for (const m of [...view.daily, ...view.weekly, ...view.season]) {
      expect(m.progress).toBe(0);
      expect(m.completed).toBe(false);
      expect(m.claimed).toBe(false);
    }
  });

  it('addProgress on AUTO_FARM_MIN updates daily auto-farm mission + grants exp when complete', async () => {
    const f = await makeUserChar(prisma);
    // Auto-farm daily mission target — push delta beyond target to trigger
    // complete (target is in catalog).
    const result = await battlePassV2.addProgress(
      f.characterId,
      'AUTO_FARM_SESSION',
      999_999,
      NOW,
    );
    expect(result.completedMissions.length).toBeGreaterThan(0);
    expect(result.granted).toBeGreaterThan(0);
    expect(result.newXp).toBe(result.granted);
  });

  it('addProgress is idempotent for completed mission — second call grants 0 extra exp', async () => {
    const f = await makeUserChar(prisma);
    const first = await battlePassV2.addProgress(
      f.characterId,
      'AUTO_FARM_SESSION',
      999_999,
      NOW,
    );
    expect(first.granted).toBeGreaterThan(0);
    const second = await battlePassV2.addProgress(
      f.characterId,
      'AUTO_FARM_SESSION',
      999_999,
      NOW,
    );
    expect(second.granted).toBe(0);
    expect(second.completedMissions).toEqual([]);
  });

  it('unlockPaidTrack sets premiumUnlocked = true', async () => {
    const f = await makeUserChar(prisma);
    await battlePassV2.unlockPaidTrack(f.characterId, NOW);
    const row = await prisma.battlePassProgress.findFirst({
      where: { characterId: f.characterId },
    });
    expect(row).toBeDefined();
    expect(row!.premiumUnlocked).toBe(true);
  });

  it('unlockPaidTrack is idempotent — calling twice keeps premiumUnlocked = true', async () => {
    const f = await makeUserChar(prisma);
    await battlePassV2.unlockPaidTrack(f.characterId, NOW);
    await battlePassV2.unlockPaidTrack(f.characterId, NOW);
    const rows = await prisma.battlePassProgress.findMany({
      where: { characterId: f.characterId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].premiumUnlocked).toBe(true);
  });
});

describe('LimitedShopService — purchase limits per period', () => {
  it('lists all 3 shops (DAILY/WEEKLY/MONTHLY) with items', async () => {
    const f = await makeUserChar(prisma);
    const shops = await limitedShop.listShops(f.characterId, NOW);
    expect(shops.length).toBe(3);
    expect(shops.find((s) => s.shopKey === 'DAILY_SHOP')).toBeDefined();
    expect(shops.find((s) => s.shopKey === 'WEEKLY_SHOP')).toBeDefined();
    expect(shops.find((s) => s.shopKey === 'MONTHLY_SHOP')).toBeDefined();
    for (const sh of shops) {
      for (const item of sh.items) {
        expect(item.purchasedInPeriod).toBe(0);
        expect(item.remaining).toBe(item.item.purchaseLimitCount);
        expect(item.soldOut).toBe(false);
      }
    }
  });

  it('purchase debits currency + grants reward + logs LimitedShopPurchase row', async () => {
    const f = await makeUserChar(prisma);
    await prisma.character.update({
      where: { id: f.characterId },
      data: { tienNgocKhoa: 10_000, tienNgoc: 10_000, linhThach: 10_000_000n },
    });
    const shops = await limitedShop.listShops(f.characterId, NOW);
    const daily = shops.find((s) => s.shopKey === 'DAILY_SHOP')!;
    const first = daily.items[0];
    const result = await limitedShop.purchase(
      f.characterId,
      'DAILY_SHOP',
      first.item.itemKey,
      NOW,
    );
    expect(result.totalInPeriod).toBe(1);
    expect(result.limit).toBe(first.item.purchaseLimitCount);

    const row = await prisma.limitedShopPurchase.findFirst({
      where: { characterId: f.characterId },
    });
    expect(row).toBeDefined();
    expect(row!.quantity).toBe(1);
  });

  it('throws PURCHASE_LIMIT_REACHED when exceeding limit', async () => {
    const f = await makeUserChar(prisma);
    await prisma.character.update({
      where: { id: f.characterId },
      data: { tienNgocKhoa: 100_000, tienNgoc: 100_000, linhThach: 100_000_000n },
    });
    const shops = await limitedShop.listShops(f.characterId, NOW);
    const daily = shops.find((s) => s.shopKey === 'DAILY_SHOP')!;
    const first = daily.items[0];
    const limit = first.item.purchaseLimitCount;
    for (let i = 0; i < limit; i++) {
      await limitedShop.purchase(f.characterId, 'DAILY_SHOP', first.item.itemKey, NOW);
    }
    await expect(
      limitedShop.purchase(f.characterId, 'DAILY_SHOP', first.item.itemKey, NOW),
    ).rejects.toThrow(MonetizationFoundationError);
  });

  it('throws INSUFFICIENT_CURRENCY when funds inadequate', async () => {
    const f = await makeUserChar(prisma);
    // No funds — character starts at 0
    const shops = await limitedShop.listShops(f.characterId, NOW);
    const daily = shops.find((s) => s.shopKey === 'DAILY_SHOP')!;
    const first = daily.items[0];
    await expect(
      limitedShop.purchase(f.characterId, 'DAILY_SHOP', first.item.itemKey, NOW),
    ).rejects.toThrow(MonetizationFoundationError);
  });

  it('throws PRODUCT_NOT_FOUND for unknown item key', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      limitedShop.purchase(f.characterId, 'DAILY_SHOP', 'unknown_item_key_xxx', NOW),
    ).rejects.toThrow(MonetizationFoundationError);
  });
});

describe('GrowthFund V2 — tien variant integration', () => {
  it('shop sells growth_fund_tien — purchase creates GrowthFundState(tien)', async () => {
    const f = await makeUserChar(prisma);
    await prisma.character.update({
      where: { id: f.characterId },
      data: { tienNgoc: 5000 },
    });
    await shop.purchase(f.characterId, 'growth_fund_tien', NOW);
    const state = await prisma.growthFundState.findUnique({
      where: {
        characterId_fundKey: {
          characterId: f.characterId,
          fundKey: 'tien',
        },
      },
    });
    expect(state).toBeDefined();
  });

  it('claim tien milestone fails when realm < required', async () => {
    const f = await makeUserChar(prisma);
    await prisma.character.update({
      where: { id: f.characterId },
      data: { tienNgoc: 5000, realmKey: 'luyenkhi' },
    });
    await shop.purchase(f.characterId, 'growth_fund_tien', NOW);
    await expect(
      growthFund.claimMilestone({
        characterId: f.characterId,
        fundKey: 'tien',
        milestoneKey: 'luyen_hu',
        now: NOW,
      }),
    ).rejects.toThrow(MonetizationFoundationError);
  });

  it('claim tien milestone succeeds when realm meets required', async () => {
    const f = await makeUserChar(prisma);
    await prisma.character.update({
      where: { id: f.characterId },
      data: { tienNgoc: 5000, realmKey: 'luyen_hu' },
    });
    await shop.purchase(f.characterId, 'growth_fund_tien', NOW);
    const view = await growthFund.claimMilestone({
      characterId: f.characterId,
      fundKey: 'tien',
      milestoneKey: 'luyen_hu',
      now: NOW,
    });
    const m = view.milestones.find((x) => x.key === 'luyen_hu')!;
    expect(m.claimed).toBe(true);
  });
});

describe('MonetizationOverviewService — aggregator', () => {
  it('returns full snapshot with empty defaults for fresh character', async () => {
    const f = await makeUserChar(prisma);
    const snap = await overview.overview(f.characterId, NOW);
    expect(snap.activeEntitlements).toEqual([]);
    expect(snap.monthlyCards).toEqual([]);
    expect(snap.battlePass.seasonId).toBeTruthy();
    expect(snap.battlePass.level).toBe(0);
    expect(snap.battlePass.premiumUnlocked).toBe(false);
    expect(snap.growthFunds.length).toBeGreaterThan(0);
    expect(snap.growthFunds.find((g) => g.fundKey === 'tien')!.purchased).toBe(false);
    expect(snap.limitedShops.length).toBe(3);
    expect(snap.wallet.length).toBeGreaterThan(0);
  });

  it('reflects monthly card after purchase', async () => {
    const f = await makeUserChar(prisma);
    await prisma.character.update({
      where: { id: f.characterId },
      data: { tienNgoc: 5000 },
    });
    await shop.purchase(f.characterId, 'monthly_card_tieu_nguyet_tap', NOW);
    const snap = await overview.overview(f.characterId, NOW);
    expect(snap.monthlyCards.length).toBe(1);
    expect(snap.monthlyCards[0].cardKey).toBe('tieu_nguyet_tap');
    expect(snap.monthlyCards[0].daysRemaining).toBeGreaterThan(0);
  });

  it('reflects battle pass after unlock', async () => {
    const f = await makeUserChar(prisma);
    await battlePassV2.unlockPaidTrack(f.characterId, NOW);
    const snap = await overview.overview(f.characterId, NOW);
    expect(snap.battlePass.premiumUnlocked).toBe(true);
  });
});
