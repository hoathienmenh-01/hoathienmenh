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
import { ExtraAttemptService, SweepTicketService } from './sweep-attempt.service';
import { GrowthFundService } from './growth-fund.service';

let prisma: PrismaService;
let wallet: WalletService;
let entitlements: EntitlementService;
let shop: MonetizationShopService;
let sweep: SweepTicketService;
let extraAttempt: ExtraAttemptService;
let growthFund: GrowthFundService;

const NOW = new Date('2027-02-01T12:00:00.000Z');

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
  sweep = new SweepTicketService(prisma, wallet);
  extraAttempt = new ExtraAttemptService(prisma, wallet);
  growthFund = new GrowthFundService(prisma, wallet, inventory);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('MonetizationShopService — server-authoritative purchase', () => {
  it('lists products with remaining = limit when no purchases yet', async () => {
    const f = await makeUserChar(prisma);
    const listings = await shop.listProducts(f.characterId, NOW);
    const sweepTickets = listings.find((l) => l.product.key === 'sweep_ticket_x5');
    expect(sweepTickets).toBeDefined();
    expect(sweepTickets!.purchasedInPeriod).toBe(0);
    expect(sweepTickets!.remaining).toBe(sweepTickets!.product.purchaseLimitCount);
    expect(sweepTickets!.soldOut).toBe(false);
  });

  it('purchases sweep_ticket_x5 → debits TIEN_NGOC_KHOA + logs purchase row', async () => {
    const f = await makeUserChar(prisma);
    await prisma.character.update({
      where: { id: f.characterId },
      data: { tienNgocKhoa: 200 },
    });
    const result = await shop.purchase(f.characterId, 'sweep_ticket_x5', NOW);
    expect(result.product.key).toBe('sweep_ticket_x5');

    const character = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    expect(character.tienNgocKhoa).toBe(200 - result.product.priceAmount);

    const rows = await prisma.monetizationShopPurchase.findMany({
      where: { characterId: f.characterId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].productKey).toBe('sweep_ticket_x5');

    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: f.characterId, reason: 'MONETIZATION_SHOP_BUY' },
    });
    expect(ledger.length).toBeGreaterThan(0);
  });

  it('enforces purchase limit per period — third buy throws PURCHASE_LIMIT_REACHED', async () => {
    const f = await makeUserChar(prisma);
    await prisma.character.update({
      where: { id: f.characterId },
      data: { tienNgocKhoa: 10_000 },
    });
    await shop.purchase(f.characterId, 'sweep_ticket_x5', NOW);
    await shop.purchase(f.characterId, 'sweep_ticket_x5', NOW);
    await shop.purchase(f.characterId, 'sweep_ticket_x5', NOW);
    await expect(
      shop.purchase(f.characterId, 'sweep_ticket_x5', NOW),
    ).rejects.toThrow(MonetizationFoundationError);
    await expect(
      shop.purchase(f.characterId, 'sweep_ticket_x5', NOW),
    ).rejects.toMatchObject({ code: 'PURCHASE_LIMIT_REACHED' });
  });

  it('throws INSUFFICIENT_CURRENCY when balance < price', async () => {
    const f = await makeUserChar(prisma);
    // Tien ngoc khoa = 0 default
    await expect(
      shop.purchase(f.characterId, 'sweep_ticket_x5', NOW),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CURRENCY' });
  });

  it('purchases monthly_card_tieu_nguyet_tap → grants entitlements + upfront reward', async () => {
    const f = await makeUserChar(prisma);
    await prisma.character.update({
      where: { id: f.characterId },
      data: { tienNgoc: 1000 },
    });
    await shop.purchase(f.characterId, 'monthly_card_tieu_nguyet_tap', NOW);

    const sub = await prisma.monthlyCardSubscription.findUnique({
      where: {
        characterId_cardKey: {
          characterId: f.characterId,
          cardKey: 'tieu_nguyet_tap',
        },
      },
    });
    expect(sub).toBeTruthy();
    expect(sub!.activeUntil.getTime()).toBeGreaterThan(NOW.getTime());

    const ents = await entitlements.getActiveEntitlements(f.characterId, NOW);
    const keys = ents.map((e) => e.key).sort();
    expect(keys).toContain('MONTHLY_CARD_SMALL');
    expect(keys).toContain('SWEEP_TICKET_DAILY');
    expect(keys).toContain('AUTO_FARM_EXTENDED');
  });
});

describe('ExtraAttemptService', () => {
  it('returns 0 used + maxPerDay remaining when never bought', async () => {
    const f = await makeUserChar(prisma);
    const state = await extraAttempt.getState(f.characterId, NOW);
    expect(state.length).toBeGreaterThan(0);
    for (const s of state) {
      expect(s.usedCount).toBe(0);
      expect(s.remaining).toBe(s.maxCount);
    }
  });

  it('buys until daily cap then throws EXTRA_ATTEMPT_LIMIT_REACHED', async () => {
    const f = await makeUserChar(prisma);
    await prisma.character.update({
      where: { id: f.characterId },
      data: { tienNgocKhoa: 10_000 },
    });
    const stateBefore = await extraAttempt.getState(f.characterId, NOW);
    const target = stateBefore.find((s) => s.maxCount === 2)!;
    expect(target).toBeTruthy();
    await extraAttempt.buyExtraAttempt({
      characterId: f.characterId,
      limitKey: target.limitKey,
      now: NOW,
    });
    await extraAttempt.buyExtraAttempt({
      characterId: f.characterId,
      limitKey: target.limitKey,
      now: NOW,
    });
    await expect(
      extraAttempt.buyExtraAttempt({
        characterId: f.characterId,
        limitKey: target.limitKey,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'EXTRA_ATTEMPT_LIMIT_REACHED' });
  });
});

describe('SweepTicketService', () => {
  it('throws CONTENT_NOT_CLEARED when content has no clear record', async () => {
    const f = await makeUserChar(prisma);
    await prisma.character.update({
      where: { id: f.characterId },
      data: { tienNgocKhoa: 500 },
    });
    await expect(
      sweep.useTicket({
        characterId: f.characterId,
        ticketKey: 'standard',
        contentType: 'DUNGEON',
        contentKey: 'never-cleared',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'CONTENT_NOT_CLEARED' });
  });

  it('uses ticket on a cleared dungeon and writes log + ledger', async () => {
    const f = await makeUserChar(prisma);
    await prisma.character.update({
      where: { id: f.characterId },
      data: { tienNgocKhoa: 500 },
    });
    await prisma.dungeonRun.create({
      data: {
        characterId: f.characterId,
        templateKey: 'rung_thieng_so_cap',
        status: 'COMPLETED',
        encounterIndex: 3,
      },
    });
    const result = await sweep.useTicket({
      characterId: f.characterId,
      ticketKey: 'standard',
      contentType: 'DUNGEON',
      contentKey: 'rung_thieng_so_cap',
      now: NOW,
    });
    expect(result.contentType).toBe('DUNGEON');
    const logs = await prisma.sweepTicketLog.findMany({
      where: { characterId: f.characterId },
    });
    expect(logs).toHaveLength(1);
    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: f.characterId, reason: 'MONETIZATION_SWEEP_TICKET_USE' },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].delta).toBe(BigInt(-SweepTicketService.TICKET_COST_KHOA));
  });
});

describe('GrowthFundService', () => {
  it('throws FUND_NOT_PURCHASED before purchase', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      growthFund.claimMilestone({
        characterId: f.characterId,
        fundKey: 'pham',
        milestoneKey: 'luyenkhi',
      }),
    ).rejects.toMatchObject({ code: 'FUND_NOT_PURCHASED' });
  });

  it('purchase via shop then claim luyenkhi milestone for newbie character', async () => {
    const f = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      tienNgoc: 1000,
    });
    await shop.purchase(f.characterId, 'growth_fund_pham', NOW);
    const state = await growthFund.claimMilestone({
      characterId: f.characterId,
      fundKey: 'pham',
      milestoneKey: 'luyenkhi',
    });
    const luyenkhi = state.milestones.find((m) => m.key === 'luyenkhi')!;
    expect(luyenkhi.claimed).toBe(true);
    expect(luyenkhi.eligible).toBe(true);

    // Claim again throws MILESTONE_ALREADY_CLAIMED
    await expect(
      growthFund.claimMilestone({
        characterId: f.characterId,
        fundKey: 'pham',
        milestoneKey: 'luyenkhi',
      }),
    ).rejects.toMatchObject({ code: 'MILESTONE_ALREADY_CLAIMED' });
  });

  it('blocks claim with MILESTONE_LOCKED when realm too low', async () => {
    const f = await makeUserChar(prisma, {
      realmKey: 'pham_nhan',
      tienNgoc: 1000,
    });
    await shop.purchase(f.characterId, 'growth_fund_pham', NOW);
    const fund = await growthFund.getFund(f.characterId, 'pham');
    expect(fund).not.toBeNull();
    const lateMilestone = fund!.milestones.find((m) => m.realmOrder > 1)!;
    await expect(
      growthFund.claimMilestone({
        characterId: f.characterId,
        fundKey: 'pham',
        milestoneKey: lateMilestone.key,
      }),
    ).rejects.toMatchObject({ code: 'MILESTONE_LOCKED' });
  });
});

describe('WalletService', () => {
  it('returns zero wallet for unknown character', async () => {
    const w = await wallet.getWallet('cuid_unknown');
    expect(w.TIEN_NGOC).toBe(0);
    expect(w.LINH_THACH).toBe(0);
  });

  it('reflects character currency fields', async () => {
    const f = await makeUserChar(prisma, { tienNgoc: 50, linhThach: 1234n });
    await prisma.character.update({
      where: { id: f.characterId },
      data: { tienNgocKhoa: 7, trialPoint: 3, eventToken: 9 },
    });
    const w = await wallet.getWallet(f.characterId);
    expect(w.TIEN_NGOC).toBe(50);
    expect(w.LINH_THACH).toBe(1234);
    expect(w.TIEN_NGOC_KHOA).toBe(7);
    expect(w.TRIAL_POINT).toBe(3);
    expect(w.EVENT_TOKEN).toBe(9);
  });

  it('lists ledger entries with currency filter', async () => {
    const f = await makeUserChar(prisma);
    await prisma.character.update({
      where: { id: f.characterId },
      data: { tienNgocKhoa: 200 },
    });
    await shop.purchase(f.characterId, 'sweep_ticket_x5', NOW);
    const all = await wallet.listLedger(f.characterId);
    expect(all.length).toBeGreaterThan(0);
    const filtered = await wallet.listLedger(f.characterId, {
      currency: 'TIEN_NGOC_KHOA',
    });
    expect(filtered.every((e) => e.currency === 'TIEN_NGOC_KHOA')).toBe(true);
  });
});
