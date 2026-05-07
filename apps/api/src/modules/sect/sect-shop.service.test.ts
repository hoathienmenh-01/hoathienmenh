/**
 * Phase 13.1.B — SectShopService integration tests.
 *
 * Coverage matrix:
 *   - buy success: trừ contribution, grant item stackable, ghi ledger
 *     `SECT_SHOP_BUY` + `SectShopPurchase` audit row.
 *   - INSUFFICIENT_CONTRIBUTION: balance < cost*qty → reject, không grant,
 *     không ledger.
 *   - DAILY_LIMIT: trong limit success, vượt limit reject + 0 mutation.
 *   - WEEKLY_LIMIT: trong limit success, vượt limit reject + 0 mutation.
 *   - NON_STACKABLE_QTY_GT_1: reject sớm (qty > 1 cho non-stackable item),
 *     không CAS spend.
 *   - RATE_LIMITED: spam buy bị limiter reject (custom limiter inject).
 *   - concurrent CAS: 2 buy song song không làm balance âm (CAS guard).
 *   - InventoryService fail (giả lập grantTx throw) → tx rollback,
 *     contribution KHÔNG bị trừ + KHÔNG ledger.
 *   - failed purchase (any-step throw) KHÔNG ghi ledger success.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Cho phép override `itemByKey().stackable` cho test NON_STACKABLE_QTY_GT_1.
// Mọi entry trong SECT_SHOP_ENTRIES hiện tại map tới stackable=true item, nên
// code path này chỉ reach được qua mock. Toggle qua biến `forceNonStackable`
// — KHÔNG đổi behavior production.
let forceNonStackable = false;

vi.mock('@xuantoi/shared', async () => {
  const actual = await vi.importActual<typeof import('@xuantoi/shared')>(
    '@xuantoi/shared',
  );
  return {
    ...actual,
    itemByKey: (k: string) => {
      const def = actual.itemByKey(k);
      if (def && forceNonStackable) {
        return { ...def, stackable: false };
      }
      return def;
    },
  };
});

import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { InventoryService } from '../inventory/inventory.service';
import { SectShopService } from './sect-shop.service';
import type { RateLimiter, RateLimitResult } from '../../common/rate-limiter';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let svc: SectShopService;
let inventory: InventoryService;

function makeAlwaysAllowedLimiter(): RateLimiter {
  return {
    async check(): Promise<RateLimitResult> {
      return { allowed: true, count: 1 };
    },
  };
}

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  inventory = new InventoryService(prisma, realtime, chars);
  svc = new SectShopService(prisma, inventory, makeAlwaysAllowedLimiter());
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeMember(opts?: {
  contribBalance?: number;
  contribLifetime?: number;
}): Promise<{ userId: string; characterId: string; sectId: string }> {
  const f = await makeUserChar(prisma);
  const sect = await prisma.sect.create({
    data: {
      name: `S-${nextSuffix()}`,
      description: '',
      leaderId: f.characterId,
      treasuryLinhThach: 0n,
    },
  });
  await prisma.character.update({
    where: { id: f.characterId },
    data: {
      sectId: sect.id,
      sectContribBalance: opts?.contribBalance ?? 1000,
      sectContribLifetime: opts?.contribLifetime ?? 1000,
    },
  });
  return { userId: f.userId, characterId: f.characterId, sectId: sect.id };
}

describe('SectShopService.buy — success path', () => {
  it('buy 1× sect_shop_huyet_chi_dan: trừ 50 contribution, grant item, ghi ledger SECT_SHOP_BUY', async () => {
    const m = await makeMember({ contribBalance: 200, contribLifetime: 200 });

    const r = await svc.buy(m.userId, 'sect_shop_huyet_chi_dan', 1);

    expect(r.entryKey).toBe('sect_shop_huyet_chi_dan');
    expect(r.itemKey).toBe('huyet_chi_dan');
    expect(r.qty).toBe(1);
    expect(r.totalCost).toBe(50);
    expect(r.contributionBalance).toBe(150);
    // lifetime KHÔNG đổi (chỉ tăng khi nhận, không giảm khi spend).
    expect(r.contributionLifetime).toBe(200);

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: m.characterId },
    });
    expect(c.sectContribBalance).toBe(150);
    expect(c.sectContribLifetime).toBe(200);

    const inv = await prisma.inventoryItem.findFirst({
      where: { characterId: m.characterId, itemKey: 'huyet_chi_dan' },
    });
    expect(inv).not.toBeNull();
    expect(inv!.qty).toBe(1);

    const purchase = await prisma.sectShopPurchase.findFirstOrThrow({
      where: { characterId: m.characterId, entryKey: 'sect_shop_huyet_chi_dan' },
    });
    expect(purchase.qty).toBe(1);
    expect(purchase.contributionSpent).toBe(50);

    const ledger = await prisma.sectContributionLedger.findFirstOrThrow({
      where: { characterId: m.characterId, reason: 'SECT_SHOP_BUY' },
    });
    expect(ledger.delta).toBe(-50);
    expect(ledger.refType).toBe('SectShopPurchase');
    expect(ledger.refId).toBe(purchase.id);
  });
});

describe('SectShopService.buy — error paths', () => {
  it('INSUFFICIENT_CONTRIBUTION: balance 30 < cost 50 → reject, balance không đổi, không ledger', async () => {
    const m = await makeMember({ contribBalance: 30, contribLifetime: 30 });

    await expect(
      svc.buy(m.userId, 'sect_shop_huyet_chi_dan', 1),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CONTRIBUTION' });

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: m.characterId },
    });
    expect(c.sectContribBalance).toBe(30);

    const inv = await prisma.inventoryItem.findMany({
      where: { characterId: m.characterId },
    });
    expect(inv).toHaveLength(0);

    const ledger = await prisma.sectContributionLedger.findMany({
      where: { characterId: m.characterId },
    });
    expect(ledger).toHaveLength(0);
  });

  it('DAILY_LIMIT: 5/5 đã mua hôm nay → request thứ 6 reject, không trừ contribution', async () => {
    const m = await makeMember({ contribBalance: 1000, contribLifetime: 1000 });

    // Buy đủ 5× — daily limit cho `huyet_chi_dan` = 5.
    for (let i = 0; i < 5; i++) {
      await svc.buy(m.userId, 'sect_shop_huyet_chi_dan', 1);
    }

    const before = await prisma.character.findUniqueOrThrow({
      where: { id: m.characterId },
    });
    expect(before.sectContribBalance).toBe(1000 - 5 * 50);

    await expect(
      svc.buy(m.userId, 'sect_shop_huyet_chi_dan', 1),
    ).rejects.toMatchObject({ code: 'DAILY_LIMIT' });

    const after = await prisma.character.findUniqueOrThrow({
      where: { id: m.characterId },
    });
    expect(after.sectContribBalance).toBe(before.sectContribBalance);
  });

  it('WEEKLY_LIMIT: weeklyLimit=3 cho co_thien_dan — buy lần thứ 4 reject', async () => {
    const m = await makeMember({ contribBalance: 5000, contribLifetime: 5000 });

    // co_thien_dan: contributionCost=200, weeklyLimit=3, no dailyLimit.
    for (let i = 0; i < 3; i++) {
      await svc.buy(m.userId, 'sect_shop_co_thien_dan', 1);
    }
    const beforeBal = (
      await prisma.character.findUniqueOrThrow({ where: { id: m.characterId } })
    ).sectContribBalance;
    expect(beforeBal).toBe(5000 - 3 * 200);

    await expect(
      svc.buy(m.userId, 'sect_shop_co_thien_dan', 1),
    ).rejects.toMatchObject({ code: 'WEEKLY_LIMIT' });

    const afterBal = (
      await prisma.character.findUniqueOrThrow({ where: { id: m.characterId } })
    ).sectContribBalance;
    expect(afterBal).toBe(beforeBal);
  });

  it('NON_STACKABLE_QTY_GT_1: stackable=false item mua qty=2 reject sớm — KHÔNG CAS, không trừ', async () => {
    // Catalog hiện tại không có entry non-stackable; force qua mock
    // `itemByKey` để cover defensive code path. Production catalog stable
    // tất cả stackable=true; nếu future thêm non-stackable entry, FE/BE
    // đã sẵn sàng reject qty>1 đúng pattern.
    const m = await makeMember({ contribBalance: 100000, contribLifetime: 100000 });

    forceNonStackable = true;
    try {
      await expect(
        svc.buy(m.userId, 'sect_shop_huyet_chi_dan', 2),
      ).rejects.toMatchObject({ code: 'NON_STACKABLE_QTY_GT_1' });
    } finally {
      forceNonStackable = false;
    }

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: m.characterId },
    });
    expect(c.sectContribBalance).toBe(100000);
    const purchases = await prisma.sectShopPurchase.findMany({
      where: { characterId: m.characterId },
    });
    expect(purchases).toHaveLength(0);
  });

  it('RATE_LIMITED: limiter reject lần thứ 2 → throw RATE_LIMITED, balance KHÔNG đổi', async () => {
    let calls = 0;
    const flakyLimiter: RateLimiter = {
      async check(): Promise<RateLimitResult> {
        calls += 1;
        return { allowed: calls <= 1, count: calls };
      },
    };
    const flakySvc = new SectShopService(prisma, inventory, flakyLimiter);
    const m = await makeMember({ contribBalance: 500, contribLifetime: 500 });

    await flakySvc.buy(m.userId, 'sect_shop_huyet_chi_dan', 1);
    await expect(
      flakySvc.buy(m.userId, 'sect_shop_huyet_chi_dan', 1),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: m.characterId },
    });
    // chỉ trừ 1 lần (50), call thứ 2 bị limiter chặn TRƯỚC CAS.
    expect(c.sectContribBalance).toBe(450);
  });

  it('SECT_REQUIRED: character không thuộc sect → reject sớm', async () => {
    const f = await makeUserChar(prisma);
    await prisma.character.update({
      where: { id: f.characterId },
      data: { sectContribBalance: 1000 },
    });

    await expect(
      svc.buy(f.userId, 'sect_shop_huyet_chi_dan', 1),
    ).rejects.toMatchObject({ code: 'SECT_REQUIRED' });
  });

  it('ENTRY_NOT_FOUND: entryKey không có trong catalog → reject', async () => {
    const m = await makeMember({ contribBalance: 1000, contribLifetime: 1000 });
    await expect(
      svc.buy(m.userId, 'sect_shop_unknown_xyz', 1),
    ).rejects.toMatchObject({ code: 'ENTRY_NOT_FOUND' });
  });
});

describe('SectShopService.buy — concurrency + rollback', () => {
  it('concurrent buy 2 song song với balance đủ cho cả 2 → cả 2 success, balance đúng (CAS guard)', async () => {
    const m = await makeMember({ contribBalance: 200, contribLifetime: 200 });
    // Cost = 50 mỗi lần; 2 lần liên tiếp = 100. Balance đủ → cả 2 success.
    const r = await Promise.all([
      svc.buy(m.userId, 'sect_shop_huyet_chi_dan', 1),
      svc.buy(m.userId, 'sect_shop_huyet_chi_dan', 1),
    ]);
    expect(r.map((x) => x.totalCost)).toEqual([50, 50]);

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: m.characterId },
    });
    expect(c.sectContribBalance).toBe(100); // 200 - 50*2
    expect(c.sectContribBalance).toBeGreaterThanOrEqual(0); // never negative
  });

  it('concurrent buy với balance đủ cho 1: tổng spend KHÔNG vượt balance (CAS guard)', async () => {
    const m = await makeMember({ contribBalance: 50, contribLifetime: 50 });
    // Cost = 50; 2 lần concurrent — chỉ 1 lần được phép thành công.
    const results = await Promise.allSettled([
      svc.buy(m.userId, 'sect_shop_huyet_chi_dan', 1),
      svc.buy(m.userId, 'sect_shop_huyet_chi_dan', 1),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(fulfilled.length).toBeLessThanOrEqual(2);
    // Bất kể thắng/thua race, balance không bao giờ âm.
    const c = await prisma.character.findUniqueOrThrow({
      where: { id: m.characterId },
    });
    expect(c.sectContribBalance).toBeGreaterThanOrEqual(0);
    // Nếu cả 2 success → balance = 0; nếu 1 success → balance = 0; nếu rejected
    // do INSUFFICIENT_CONTRIBUTION sau CAS → balance phù hợp với # success.
    expect(c.sectContribBalance).toBe(50 - fulfilled.length * 50);
    // Nếu 1 reject thì lý do là INSUFFICIENT_CONTRIBUTION (CAS lose).
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({
        code: 'INSUFFICIENT_CONTRIBUTION',
      });
    }
  });

  it('InventoryService.grantTx fail → toàn bộ tx rollback: balance KHÔNG trừ, KHÔNG ledger, KHÔNG purchase', async () => {
    const m = await makeMember({ contribBalance: 500, contribLifetime: 500 });

    // Spy grantTx để throw — simulate inventory insert vỡ.
    const spy = vi
      .spyOn(inventory, 'grantTx')
      .mockRejectedValueOnce(new Error('inventory write failed'));

    await expect(
      svc.buy(m.userId, 'sect_shop_huyet_chi_dan', 1),
    ).rejects.toThrow(/inventory write failed/);

    spy.mockRestore();

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: m.characterId },
    });
    expect(c.sectContribBalance).toBe(500); // rollback
    const purchases = await prisma.sectShopPurchase.findMany({
      where: { characterId: m.characterId },
    });
    expect(purchases).toHaveLength(0);
    const ledger = await prisma.sectContributionLedger.findMany({
      where: { characterId: m.characterId },
    });
    expect(ledger).toHaveLength(0);
    const inv = await prisma.inventoryItem.findMany({
      where: { characterId: m.characterId },
    });
    expect(inv).toHaveLength(0);
  });

  it('failed purchase (insufficient) KHÔNG ghi ledger SECT_SHOP_BUY success row', async () => {
    const m = await makeMember({ contribBalance: 10, contribLifetime: 10 });

    await expect(
      svc.buy(m.userId, 'sect_shop_huyet_chi_dan', 1),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CONTRIBUTION' });

    const ledgers = await prisma.sectContributionLedger.findMany({
      where: { characterId: m.characterId, reason: 'SECT_SHOP_BUY' },
    });
    expect(ledgers).toHaveLength(0);
  });
});
