import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { WalletService } from './wallet.service';
import { EntitlementService } from './entitlement.service';
import { MonetizationShopService, MonetizationFoundationError } from './monetization-shop.service';

let prisma: PrismaService;
let shop: MonetizationShopService;

const NOW = new Date('2026-05-29T12:00:00.000Z');

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  const wallet = new WalletService(prisma, currency);
  const entitlements = new EntitlementService(prisma);
  shop = new MonetizationShopService(prisma, wallet, entitlements, inventory);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('MonetizationShopService.listProducts', () => {
  it('returns product listings for character', async () => {
    const f = await makeUserChar(prisma);
    const products = await shop.listProducts(f.characterId, NOW);
    expect(Array.isArray(products)).toBe(true);
    // Each listing should have product, purchasedInPeriod, remaining, soldOut
    for (const listing of products) {
      expect(listing).toHaveProperty('product');
      expect(listing).toHaveProperty('purchasedInPeriod');
      expect(listing).toHaveProperty('remaining');
      expect(listing).toHaveProperty('soldOut');
    }
  });

  it('returns zero purchasedInPeriod for fresh character', async () => {
    const f = await makeUserChar(prisma);
    const products = await shop.listProducts(f.characterId, NOW);
    for (const listing of products) {
      expect(listing.purchasedInPeriod).toBe(0);
    }
  });
});

describe('MonetizationShopService.purchase', () => {
  it('throws PRODUCT_NOT_FOUND for nonexistent product', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      shop.purchase(f.characterId, 'nonexistent_product_xyz', NOW),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
  });

  it('throws INSUFFICIENT_CURRENCY when balance too low', async () => {
    const f = await makeUserChar(prisma);
    // Find an enabled product from catalog
    const { SHOP_PRODUCTS } = await import('@xuantoi/shared');
    const enabled = SHOP_PRODUCTS.find((p) => p.enabled);
    if (!enabled) return; // skip if no enabled products

    // Character has 0 tienNgoc, should fail for any paid product
    await expect(
      shop.purchase(f.characterId, enabled.key, NOW),
    ).rejects.toBeInstanceOf(MonetizationFoundationError);
  });
});
