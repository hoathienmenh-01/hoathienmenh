import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { WalletService } from './wallet.service';
import { EntitlementService } from './entitlement.service';
import { MonetizationOverviewService } from './monetization-overview.service';

let prisma: PrismaService;
let overview: MonetizationOverviewService;

const NOW = new Date('2026-05-29T12:00:00.000Z');

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const currency = new CurrencyService(prisma);
  const wallet = new WalletService(prisma, currency);
  const entitlements = new EntitlementService(prisma);
  overview = new MonetizationOverviewService(prisma, wallet, entitlements);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('MonetizationOverviewService.overview', () => {
  it('returns overview for fresh character without errors', async () => {
    const f = await makeUserChar(prisma);
    const data = await overview.overview(f.characterId, NOW);
    expect(data).toHaveProperty('wallet');
    expect(data).toHaveProperty('activeEntitlements');
    expect(data).toHaveProperty('battlePass');
    expect(data).toHaveProperty('monthlyCards');
    expect(data).toHaveProperty('growthFunds');
  });

  it('returns wallet as array of currency entries', async () => {
    const f = await makeUserChar(prisma);
    const data = await overview.overview(f.characterId, NOW);
    expect(Array.isArray(data.wallet)).toBe(true);
    for (const entry of data.wallet) {
      expect(entry).toHaveProperty('currency');
      expect(entry).toHaveProperty('amount');
    }
  });

  it('returns zero wallet balances for fresh character', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n, tienNgoc: 0 });
    const data = await overview.overview(f.characterId, NOW);
    const linhThach = data.wallet.find((w) => w.currency === 'LINH_THACH');
    const tienNgoc = data.wallet.find((w) => w.currency === 'TIEN_NGOC');
    expect(linhThach?.amount ?? 0).toBe(0);
    expect(tienNgoc?.amount ?? 0).toBe(0);
  });

  it('reflects wallet balance after character creation', async () => {
    const f = await makeUserChar(prisma, { linhThach: 5000n, tienNgoc: 100 });
    const data = await overview.overview(f.characterId, NOW);
    const linhThach = data.wallet.find((w) => w.currency === 'LINH_THACH');
    const tienNgoc = data.wallet.find((w) => w.currency === 'TIEN_NGOC');
    expect(linhThach?.amount ?? 0).toBe(5000);
    expect(tienNgoc?.amount ?? 0).toBe(100);
  });

  it('returns empty activeEntitlements for fresh character', async () => {
    const f = await makeUserChar(prisma);
    const data = await overview.overview(f.characterId, NOW);
    expect(Array.isArray(data.activeEntitlements)).toBe(true);
    expect(data.activeEntitlements).toHaveLength(0);
  });
});
