import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { WalletService } from './wallet.service';
import { LimitedShopService } from './limited-shop.service';

let prisma: PrismaService;
let limitedShop: LimitedShopService;

const NOW = new Date('2026-05-29T12:00:00.000Z');

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  const wallet = new WalletService(prisma, currency);
  limitedShop = new LimitedShopService(prisma, wallet, inventory);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('LimitedShopService.listShops', () => {
  it('returns shop listings for character', async () => {
    const f = await makeUserChar(prisma);
    const shops = await limitedShop.listShops(f.characterId, NOW);
    expect(Array.isArray(shops)).toBe(true);
    for (const shop of shops) {
      expect(shop).toHaveProperty('shopKey');
      expect(shop).toHaveProperty('period');
      expect(shop).toHaveProperty('items');
      expect(Array.isArray(shop.items)).toBe(true);
    }
  });

  it('returns zero purchased for fresh character', async () => {
    const f = await makeUserChar(prisma);
    const shops = await limitedShop.listShops(f.characterId, NOW);
    for (const shop of shops) {
      for (const item of shop.items) {
        expect(item.purchasedInPeriod).toBe(0);
        expect(item.soldOut).toBe(false);
      }
    }
  });
});

describe('LimitedShopService.purchase', () => {
  it('throws PRODUCT_NOT_FOUND for nonexistent shopKey+itemKey', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      limitedShop.purchase(f.characterId, 'nonexistent_shop' as any, 'nonexistent_item', NOW),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
  });
});
