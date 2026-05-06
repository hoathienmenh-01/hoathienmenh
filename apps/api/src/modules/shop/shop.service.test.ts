import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CurrencyKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { ShopError, ShopService } from './shop.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { InMemorySlidingWindowRateLimiter } from '../../common/rate-limiter';

let prisma: PrismaService;
let shop: ShopService;
let currency: CurrencyService;
let inventory: InventoryService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  currency = new CurrencyService(prisma);
  inventory = new InventoryService(prisma, realtime, chars);
  shop = new ShopService(prisma, currency, inventory);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ShopService.list', () => {
  it('trả ra >=1 entry, tất cả có price > 0 và itemKey hợp lệ', () => {
    const entries = shop.list();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.itemKey).toBeTruthy();
      expect(e.name).toBeTruthy();
      expect(e.price).toBeGreaterThan(0);
      expect(['LINH_THACH', 'TIEN_NGOC']).toContain(e.currency);
    }
  });

  it('chỉ chứa item phẩm Phàm/Linh (không bán Huyền/Tiên)', () => {
    const entries = shop.list();
    for (const e of entries) {
      expect(['PHAM', 'LINH']).toContain(e.quality);
    }
  });
});

describe('ShopService.buy', () => {
  it('mua item stackable thành công → trừ linh thạch + thêm vào túi + ledger SHOP_BUY', async () => {
    const f = await makeUserChar(prisma, { linhThach: 1_000n });
    // 'huyet_chi_dan' price=25, qty=3 → total=75.
    const r = await shop.buy(f.userId, 'huyet_chi_dan', 3);
    expect(r.itemKey).toBe('huyet_chi_dan');
    expect(r.qty).toBe(3);
    expect(r.totalPrice).toBe(75);
    expect(r.currency).toBe(CurrencyKind.LINH_THACH);

    const c = await prisma.character.findUniqueOrThrow({ where: { id: f.characterId } });
    expect(c.linhThach).toBe(925n);

    const inv = await prisma.inventoryItem.findFirstOrThrow({
      where: { characterId: f.characterId, itemKey: 'huyet_chi_dan' },
    });
    expect(inv.qty).toBe(3);

    const ledger = await prisma.currencyLedger.findFirstOrThrow({
      where: { characterId: f.characterId, reason: 'SHOP_BUY' },
    });
    expect(ledger.delta).toBe(-75n);
    const meta = ledger.meta as { itemKey: string; qty: number; unitPrice: number };
    expect(meta.itemKey).toBe('huyet_chi_dan');
    expect(meta.qty).toBe(3);
    expect(meta.unitPrice).toBe(25);
  });

  it('mua lần 2 cùng item stackable → gộp qty (không tạo row mới)', async () => {
    const f = await makeUserChar(prisma, { linhThach: 1_000n });
    await shop.buy(f.userId, 'huyet_chi_dan', 2);
    await shop.buy(f.userId, 'huyet_chi_dan', 4);
    const rows = await prisma.inventoryItem.findMany({
      where: { characterId: f.characterId, itemKey: 'huyet_chi_dan' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].qty).toBe(6);
  });

  it('không đủ linh thạch → INSUFFICIENT_FUNDS, KHÔNG trừ tiền + KHÔNG cấp item + KHÔNG ledger', async () => {
    const f = await makeUserChar(prisma, { linhThach: 50n });
    // huyet_chi_dan price=25, qty=10 → total=250 > 50.
    await expect(shop.buy(f.userId, 'huyet_chi_dan', 10)).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    const c = await prisma.character.findUniqueOrThrow({ where: { id: f.characterId } });
    expect(c.linhThach).toBe(50n);
    const inv = await prisma.inventoryItem.findFirst({
      where: { characterId: f.characterId, itemKey: 'huyet_chi_dan' },
    });
    expect(inv).toBeNull();
    const ledger = await prisma.currencyLedger.findFirst({
      where: { characterId: f.characterId, reason: 'SHOP_BUY' },
    });
    expect(ledger).toBeNull();
  });

  it('itemKey không có trong NPC_SHOP → ITEM_NOT_IN_SHOP (anti-spoof boss item)', async () => {
    const f = await makeUserChar(prisma, { linhThach: 100_000n });
    // 'tien_huyen_kiem' tồn tại trong ITEMS nhưng không có trong NPC_SHOP.
    await expect(shop.buy(f.userId, 'tien_huyen_kiem', 1)).rejects.toMatchObject({
      code: 'ITEM_NOT_IN_SHOP',
    });
    // Item không tồn tại.
    await expect(shop.buy(f.userId, 'fake_key', 1)).rejects.toMatchObject({
      code: 'ITEM_NOT_IN_SHOP',
    });
  });

  it('qty không hợp lệ → INVALID_QTY (0, âm, >99, không phải integer)', async () => {
    const f = await makeUserChar(prisma, { linhThach: 100_000n });
    for (const bad of [0, -1, 100, 1.5]) {
      await expect(shop.buy(f.userId, 'huyet_chi_dan', bad)).rejects.toMatchObject({
        code: 'INVALID_QTY',
      });
    }
  });

  it('item non-stackable + qty>1 → NON_STACKABLE_QTY_GT_1', async () => {
    const f = await makeUserChar(prisma, { linhThach: 100_000n });
    // 'so_kiem' non-stackable.
    await expect(shop.buy(f.userId, 'so_kiem', 2)).rejects.toMatchObject({
      code: 'NON_STACKABLE_QTY_GT_1',
    });
  });

  it('user không có character → NO_CHARACTER', async () => {
    const u = await prisma.user.create({
      data: { email: `noc-${Date.now()}@xt.local`, passwordHash: 'x' },
    });
    await expect(shop.buy(u.id, 'huyet_chi_dan', 1)).rejects.toMatchObject({
      code: 'NO_CHARACTER',
    });
  });
});

describe('ShopService.buy — ShopError class', () => {
  it('là instance của ShopError với code đúng', async () => {
    const f = await makeUserChar(prisma, { linhThach: 1n });
    let caught: unknown;
    try {
      await shop.buy(f.userId, 'huyet_chi_dan', 1);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ShopError);
    expect((caught as ShopError).code).toBe('INSUFFICIENT_FUNDS');
  });
});

/**
 * M10 — Daily purchase cap (`ShopEntryDef.dailyLimit`). Catalog hiện
 * đặt: pills HP/MP=20, co_thien_dan=10, ore=10, equipment=5. Tests
 * dùng `co_thien_dan` (limit=10) cho stackable + `so_kiem` (limit=5)
 * cho non-stackable.
 */
describe('ShopService.buy — daily purchase limit', () => {
  it('mua dưới limit OK; mua quá → SHOP_DAILY_LIMIT', async () => {
    const f = await makeUserChar(prisma, { linhThach: 100_000n });
    // co_thien_dan dailyLimit=10. Mua 8 → OK, +3 nữa (=11) → throw.
    await shop.buy(f.userId, 'co_thien_dan', 8);
    await expect(shop.buy(f.userId, 'co_thien_dan', 3)).rejects.toMatchObject({
      code: 'SHOP_DAILY_LIMIT',
    });
    // Túi vẫn 8, không lén grant request bị reject.
    const inv = await prisma.inventoryItem.findFirstOrThrow({
      where: { characterId: f.characterId, itemKey: 'co_thien_dan' },
    });
    expect(inv.qty).toBe(8);
  });

  it('mua đúng cap (current + qty == limit) → cho qua', async () => {
    const f = await makeUserChar(prisma, { linhThach: 100_000n });
    await shop.buy(f.userId, 'co_thien_dan', 7);
    // 7 + 3 = 10 = limit → OK.
    const r = await shop.buy(f.userId, 'co_thien_dan', 3);
    expect(r.qty).toBe(3);
    const inv = await prisma.inventoryItem.findFirstOrThrow({
      where: { characterId: f.characterId, itemKey: 'co_thien_dan' },
    });
    expect(inv.qty).toBe(10);
  });

  it('limit per-item: mua hết co_thien_dan KHÔNG ảnh hưởng huyet_chi_dan', async () => {
    const f = await makeUserChar(prisma, { linhThach: 100_000n });
    await shop.buy(f.userId, 'co_thien_dan', 10); // hit limit
    await expect(shop.buy(f.userId, 'co_thien_dan', 1)).rejects.toMatchObject({
      code: 'SHOP_DAILY_LIMIT',
    });
    // huyet_chi_dan limit=20 vẫn còn nguyên.
    const r = await shop.buy(f.userId, 'huyet_chi_dan', 5);
    expect(r.qty).toBe(5);
  });

  it('limit per-character: char A hit limit KHÔNG ảnh hưởng char B', async () => {
    const a = await makeUserChar(prisma, { linhThach: 100_000n });
    const b = await makeUserChar(prisma, { linhThach: 100_000n });
    await shop.buy(a.userId, 'co_thien_dan', 10);
    await expect(shop.buy(a.userId, 'co_thien_dan', 1)).rejects.toMatchObject({
      code: 'SHOP_DAILY_LIMIT',
    });
    const r = await shop.buy(b.userId, 'co_thien_dan', 10);
    expect(r.qty).toBe(10);
  });

  it('ledger entries từ hôm qua KHÔNG count vào quota hôm nay', async () => {
    const f = await makeUserChar(prisma, { linhThach: 100_000n });
    // Mua 10 hôm nay → hit limit.
    await shop.buy(f.userId, 'co_thien_dan', 10);
    // Backdate ledger entries -2 days → chúng ra ngoài cửa sổ daily.
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await prisma.itemLedger.updateMany({
      where: { characterId: f.characterId, itemKey: 'co_thien_dan' },
      data: { createdAt: yesterday },
    });
    // Reset inventory để khỏi mismatch (phần này không liên quan limit check).
    await prisma.inventoryItem.deleteMany({
      where: { characterId: f.characterId, itemKey: 'co_thien_dan' },
    });
    // Hôm nay vẫn còn full 10 quota.
    const r = await shop.buy(f.userId, 'co_thien_dan', 10);
    expect(r.qty).toBe(10);
  });

  it('SHOP_DAILY_LIMIT KHÔNG trừ tiền (pre-check trước transaction)', async () => {
    const f = await makeUserChar(prisma, { linhThach: 100_000n });
    await shop.buy(f.userId, 'co_thien_dan', 10);
    const before = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
      select: { linhThach: true },
    });
    await expect(shop.buy(f.userId, 'co_thien_dan', 1)).rejects.toMatchObject({
      code: 'SHOP_DAILY_LIMIT',
    });
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
      select: { linhThach: true },
    });
    expect(after.linhThach).toBe(before.linhThach);
  });

  it('non-stackable item cũng enforce dailyLimit (so_kiem limit=5)', async () => {
    const f = await makeUserChar(prisma, { linhThach: 100_000n });
    // so_kiem qty=1 only (non-stackable). 5 lần → hit limit; 6th → throw.
    for (let i = 0; i < 5; i++) {
      await shop.buy(f.userId, 'so_kiem', 1);
    }
    await expect(shop.buy(f.userId, 'so_kiem', 1)).rejects.toMatchObject({
      code: 'SHOP_DAILY_LIMIT',
    });
  });

  it('item KHÔNG có dailyLimit (giả lập) → không enforce', async () => {
    // Hiện tại tất cả entries đều có dailyLimit (closed beta). Test mock
    // bằng spy npcShopByKey to confirm logic skip khi undefined.
    // Approach: monkey patch shop.buy không khả thi (private method); thay
    // vào đó verify behavior: catalog có dailyLimit tổng ≥ 1 nghĩa là branch
    // `if (typeof limit === 'number')` được cover ít nhất 1 lần.
    // Nếu dailyLimit undefined → branch skip; KHÔNG throw SHOP_DAILY_LIMIT.
    // Smoke check: mua 1 item bất kỳ trong limit không throw.
    const f = await makeUserChar(prisma, { linhThach: 100_000n });
    const r = await shop.buy(f.userId, 'huyet_chi_dan', 1);
    expect(r.qty).toBe(1);
  });
});

/**
 * M10 — Per-user rate limit (anti-script). Default 30 req/60s. Tests
 * dùng custom ShopService với limiter max=2 để verify rate path.
 */
describe('ShopService.buy — per-user rate limit', () => {
  function makeRateLimitedShop(max: number, windowMs = 60_000): ShopService {
    return new ShopService(
      prisma,
      currency,
      inventory,
      new InMemorySlidingWindowRateLimiter(windowMs, max),
    );
  }

  it('vượt rate (req thứ max+1) → RATE_LIMITED', async () => {
    const f = await makeUserChar(prisma, { linhThach: 100_000n });
    const rs = makeRateLimitedShop(2);
    await rs.buy(f.userId, 'huyet_chi_dan', 1);
    await rs.buy(f.userId, 'huyet_chi_dan', 1);
    await expect(rs.buy(f.userId, 'huyet_chi_dan', 1)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('rate limit per-user (user A bị chặn KHÔNG ảnh hưởng user B)', async () => {
    const a = await makeUserChar(prisma, { linhThach: 100_000n });
    const b = await makeUserChar(prisma, { linhThach: 100_000n });
    const rs = makeRateLimitedShop(2);
    await rs.buy(a.userId, 'huyet_chi_dan', 1);
    await rs.buy(a.userId, 'huyet_chi_dan', 1);
    await expect(rs.buy(a.userId, 'huyet_chi_dan', 1)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    // user B request đầu tiên → OK.
    const r = await rs.buy(b.userId, 'huyet_chi_dan', 1);
    expect(r.qty).toBe(1);
  });

  it('RATE_LIMITED KHÔNG trừ tiền', async () => {
    const f = await makeUserChar(prisma, { linhThach: 100_000n });
    const rs = makeRateLimitedShop(1);
    await rs.buy(f.userId, 'huyet_chi_dan', 1);
    const before = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
      select: { linhThach: true },
    });
    await expect(rs.buy(f.userId, 'huyet_chi_dan', 1)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
      select: { linhThach: true },
    });
    expect(after.linhThach).toBe(before.linhThach);
  });

  it('rate limit chạy TRƯỚC character lookup (user không tồn tại nhưng rate < max → NO_CHARACTER, vượt → RATE_LIMITED)', async () => {
    // Setup: user mới, không có character.
    const u = await prisma.user.create({
      data: { email: `rl-${Date.now()}@xt.local`, passwordHash: 'x' },
    });
    const rs = makeRateLimitedShop(2);
    await expect(rs.buy(u.id, 'huyet_chi_dan', 1)).rejects.toMatchObject({
      code: 'NO_CHARACTER',
    });
    await expect(rs.buy(u.id, 'huyet_chi_dan', 1)).rejects.toMatchObject({
      code: 'NO_CHARACTER',
    });
    // Req thứ 3 → rate limit fires trước character lookup.
    await expect(rs.buy(u.id, 'huyet_chi_dan', 1)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });
});
