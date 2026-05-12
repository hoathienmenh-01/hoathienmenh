import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { ShopPackError, ShopPacksService } from './shop-packs.service';

let prisma: PrismaService;
let shopPacks: ShopPacksService;

const NOW = new Date('2026-05-12T12:00:00.000Z');

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  shopPacks = new ShopPacksService(prisma, currency, inventory);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ShopPacksService', () => {
  it('lists active packs with remaining purchases', async () => {
    const f = await makeUserChar(prisma, { tienNgoc: 1000 });
    const packs = await shopPacks.listPacks(f.userId, NOW);
    expect(packs.length).toBeGreaterThan(0);
    expect(packs[0]!.remainingPurchases).toBeGreaterThan(0);
  });

  it('purchases a daily pack and deducts tienNgoc', async () => {
    const f = await makeUserChar(prisma, { tienNgoc: 1000 });
    const result = await shopPacks.purchase(
      f.userId,
      { packId: 'daily_cultivation_support' },
      NOW,
    );
    expect(result.packId).toBe('daily_cultivation_support');

    const character = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    expect(character.tienNgoc).toBe(950);
  });

  it('grants currency and item rewards on purchase', async () => {
    const f = await makeUserChar(prisma, { tienNgoc: 1000 });
    await shopPacks.purchase(
      f.userId,
      { packId: 'daily_cultivation_support' },
      NOW,
    );

    const character = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    expect(character.linhThach).toBe(2000n);

    const items = await prisma.inventoryItem.findMany({
      where: { characterId: f.characterId },
    });
    expect(items.length).toBeGreaterThan(0);
  });

  it('writes currency ledger on purchase', async () => {
    const f = await makeUserChar(prisma, { tienNgoc: 1000 });
    await shopPacks.purchase(
      f.userId,
      { packId: 'daily_cultivation_support' },
      NOW,
    );

    const deductLedger = await prisma.currencyLedger.findMany({
      where: { characterId: f.characterId, reason: 'SHOP_PACK_PURCHASE' },
    });
    expect(deductLedger.length).toBe(1);
    expect(deductLedger[0]!.delta).toBe(-50n);

    const rewardLedger = await prisma.currencyLedger.findMany({
      where: { characterId: f.characterId, reason: 'SHOP_PACK_REWARD' },
    });
    expect(rewardLedger.length).toBeGreaterThanOrEqual(1);
  });

  it('blocks purchase over daily limit', async () => {
    const f = await makeUserChar(prisma, { tienNgoc: 1000 });
    await shopPacks.purchase(
      f.userId,
      { packId: 'daily_cultivation_support' },
      NOW,
    );

    await expect(
      shopPacks.purchase(
        f.userId,
        { packId: 'daily_cultivation_support' },
        NOW,
      ),
    ).rejects.toThrow('PURCHASE_LIMIT_REACHED');
  });

  it('blocks purchase when insufficient funds', async () => {
    const f = await makeUserChar(prisma, { tienNgoc: 10 });
    await expect(
      shopPacks.purchase(
        f.userId,
        { packId: 'daily_cultivation_support' },
        NOW,
      ),
    ).rejects.toThrow('INSUFFICIENT_FUNDS');
  });

  it('blocks purchase of inactive pack', async () => {
    const f = await makeUserChar(prisma, { tienNgoc: 1000 });
    await expect(
      shopPacks.purchase(f.userId, { packId: 'nonexistent_pack' }, NOW),
    ).rejects.toThrow('PACK_NOT_FOUND');
  });

  it('prevents duplicate reward via idempotency key', async () => {
    const f = await makeUserChar(prisma, { tienNgoc: 1000 });
    const first = await shopPacks.purchase(
      f.userId,
      { packId: 'starter_growth', idempotencyKey: 'idem-key-1' },
      NOW,
    );

    const second = await shopPacks.purchase(
      f.userId,
      { packId: 'starter_growth', idempotencyKey: 'idem-key-1' },
      NOW,
    );
    expect(second.purchaseId).toBe(first.purchaseId);

    const character = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    expect(character.tienNgoc).toBe(900);

    const purchases = await prisma.shopPackPurchase.findMany({
      where: { characterId: f.characterId, packId: 'starter_growth' },
    });
    expect(purchases).toHaveLength(1);
  });

  it('blocks purchase over weekly limit', async () => {
    const f = await makeUserChar(prisma, { tienNgoc: 2000 });
    await shopPacks.purchase(
      f.userId,
      { packId: 'weekly_equipment_forge' },
      NOW,
    );

    await expect(
      shopPacks.purchase(
        f.userId,
        { packId: 'weekly_equipment_forge' },
        NOW,
      ),
    ).rejects.toThrow('PURCHASE_LIMIT_REACHED');
  });

  it('admin grant works without currency deduction', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN', tienNgoc: 0 });
    const player = await makeUserChar(prisma, { tienNgoc: 0 });

    const result = await shopPacks.adminGrantPack(
      admin.userId,
      player.userId,
      'daily_cultivation_support',
      NOW,
    );
    expect(result.packId).toBe('daily_cultivation_support');

    const character = await prisma.character.findUniqueOrThrow({
      where: { id: player.characterId },
    });
    expect(character.linhThach).toBe(2000n);
    expect(character.tienNgoc).toBe(0);

    const audit = await prisma.adminAuditLog.findFirst({
      where: { actorUserId: admin.userId, action: 'admin.shop_pack.grant' },
    });
    expect(audit).toBeTruthy();
  });
});
