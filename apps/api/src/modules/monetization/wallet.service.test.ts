import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { WalletService } from './wallet.service';

let prisma: PrismaService;
let wallet: WalletService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const currency = new CurrencyService(prisma);
  wallet = new WalletService(prisma, currency);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('WalletService.getWallet', () => {
  it('returns zero balances for fresh character', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n, tienNgoc: 0 });
    const w = await wallet.getWallet(f.characterId);
    expect(w.LINH_THACH).toBe(0);
    expect(w.TIEN_NGOC).toBe(0);
    expect(w.TIEN_NGOC_KHOA).toBe(0);
  });
});

describe('WalletService.applyTx', () => {
  it('credits linhThach and writes ledger row', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n });
    await prisma.$transaction((tx) =>
      wallet.applyTx(tx, {
        characterId: f.characterId,
        currency: 'LINH_THACH',
        delta: 500,
        reason: 'ADMIN_GRANT',
        refType: 'test',
        refId: 'credit-1',
      }),
    );
    const w = await wallet.getWallet(f.characterId);
    expect(w.LINH_THACH).toBe(500);
    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: f.characterId, reason: 'ADMIN_GRANT' },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].delta).toBe(500n);
  });

  it('debits tienNgoc and writes ledger row', async () => {
    const f = await makeUserChar(prisma, { tienNgoc: 200 });
    await prisma.$transaction((tx) =>
      wallet.applyTx(tx, {
        characterId: f.characterId,
        currency: 'TIEN_NGOC',
        delta: -50,
        reason: 'SHOP_BUY',
        refType: 'test',
        refId: 'debit-1',
      }),
    );
    const w = await wallet.getWallet(f.characterId);
    expect(w.TIEN_NGOC).toBe(150);
    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: f.characterId, reason: 'SHOP_BUY' },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].delta).toBe(-50n);
  });

  it('throws INSUFFICIENT_FUNDS when debit exceeds balance', async () => {
    const f = await makeUserChar(prisma, { tienNgoc: 10 });
    await expect(
      prisma.$transaction((tx) =>
        wallet.applyTx(tx, {
          characterId: f.characterId,
          currency: 'TIEN_NGOC',
          delta: -100,
          reason: 'SHOP_BUY',
          refType: 'test',
          refId: 'overdraft-1',
        }),
      ),
    ).rejects.toThrow('INSUFFICIENT_FUNDS');
  });

  it('handles concurrent debits safely (CAS)', async () => {
    const f = await makeUserChar(prisma, { tienNgoc: 100 });
    const results = await Promise.allSettled([
      prisma.$transaction((tx) =>
        wallet.applyTx(tx, {
          characterId: f.characterId,
          currency: 'TIEN_NGOC',
          delta: -60,
          reason: 'SHOP_BUY',
          refType: 'test',
          refId: 'concurrent-a',
        }),
      ),
      prisma.$transaction((tx) =>
        wallet.applyTx(tx, {
          characterId: f.characterId,
          currency: 'TIEN_NGOC',
          delta: -60,
          reason: 'SHOP_BUY',
          refType: 'test',
          refId: 'concurrent-b',
        }),
      ),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    const w = await wallet.getWallet(f.characterId);
    expect(w.TIEN_NGOC).toBeGreaterThanOrEqual(0);
  });
});

describe('WalletService.listLedger', () => {
  it('returns ledger entries for character', async () => {
    const f = await makeUserChar(prisma);
    await prisma.$transaction((tx) =>
      wallet.applyTx(tx, {
        characterId: f.characterId,
        currency: 'LINH_THACH',
        delta: 100,
        reason: 'ADMIN_GRANT',
        refType: 'test',
        refId: 'ledger-1',
      }),
    );
    const entries = await wallet.listLedger(f.characterId, { limit: 10 });
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].reason).toBe('ADMIN_GRANT');
  });
});
