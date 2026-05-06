/**
 * Test for AdminService.runLedgerAudit() — endpoint wrapper around the pure
 * `auditLedger()` function from `ledger-audit.ts`. The pure function itself
 * is already covered by `apps/api/scripts/audit-ledger.test.ts`; this test
 * focuses on the JSON serialization path (bigint → string) used by HTTP.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CurrencyKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { TopupService } from '../topup/topup.service';
import { QuestService } from '../quest/quest.service';
import { AdminService } from './admin.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let admin: AdminService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const topup = new TopupService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  const quests = new QuestService(prisma, currency, inventory);
  admin = new AdminService(prisma, chars, topup, realtime, currency, inventory, quests);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await wipeAll(prisma);
  await prisma.$disconnect();
});

describe('AdminService.runLedgerAudit', () => {
  it('trả result rỗng khi DB sạch', async () => {
    const r = await admin.runLedgerAudit();
    expect(r.charactersScanned).toBe(0);
    expect(r.itemKeysScanned).toBe(0);
    expect(r.currencyDiscrepancies).toEqual([]);
    expect(r.inventoryDiscrepancies).toEqual([]);
  });

  it('không có discrepancy khi character.linhThach khớp ledger', async () => {
    const c = await makeUserChar(prisma, { linhThach: 100n, tienNgoc: 0 });
    await prisma.currencyLedger.create({
      data: {
        characterId: c.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 100n,
        reason: 'INITIAL',
      },
    });
    const r = await admin.runLedgerAudit();
    expect(r.charactersScanned).toBe(1);
    expect(r.currencyDiscrepancies).toEqual([]);
  });

  it('phát hiện linhThach mismatch — character có 100 nhưng ledger chỉ ghi 50', async () => {
    const c = await makeUserChar(prisma, { linhThach: 100n, tienNgoc: 0 });
    await prisma.currencyLedger.create({
      data: {
        characterId: c.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 50n,
        reason: 'PARTIAL',
      },
    });
    const r = await admin.runLedgerAudit();
    expect(r.currencyDiscrepancies).toHaveLength(1);
    const d = r.currencyDiscrepancies[0];
    expect(d?.characterId).toBe(c.characterId);
    expect(d?.field).toBe('linhThach');
    // bigint → string serialization
    expect(d?.ledgerSum).toBe('50');
    expect(d?.characterValue).toBe('100');
    expect(d?.diff).toBe('50');
  });

  it('phát hiện tienNgoc mismatch (bigint serialization từ Number)', async () => {
    await makeUserChar(prisma, { linhThach: 0n, tienNgoc: 200 });
    // Không tạo ledger entry → diff = 200 - 0
    const r = await admin.runLedgerAudit();
    const tn = r.currencyDiscrepancies.find((d) => d.field === 'tienNgoc');
    expect(tn).toBeDefined();
    expect(tn?.ledgerSum).toBe('0');
    expect(tn?.characterValue).toBe('200');
    expect(tn?.diff).toBe('200');
  });

  it('phát hiện inventory mismatch — InventoryItem có 5 nhưng ItemLedger chỉ ghi 3', async () => {
    const c = await makeUserChar(prisma);
    await prisma.inventoryItem.create({
      data: { characterId: c.characterId, itemKey: 'sword', qty: 5 },
    });
    await prisma.itemLedger.create({
      data: {
        characterId: c.characterId,
        itemKey: 'sword',
        qtyDelta: 3,
        reason: 'PARTIAL',
      },
    });
    const r = await admin.runLedgerAudit();
    expect(r.inventoryDiscrepancies).toHaveLength(1);
    const inv = r.inventoryDiscrepancies[0];
    expect(inv?.characterId).toBe(c.characterId);
    expect(inv?.itemKey).toBe('sword');
    expect(inv?.ledgerSum).toBe(3);
    expect(inv?.inventorySum).toBe(5);
    expect(inv?.diff).toBe(2);
  });

  it('cộng dồn nhiều ledger entry cho cùng character + currency', async () => {
    const c = await makeUserChar(prisma, { linhThach: 100n, tienNgoc: 0 });
    await prisma.currencyLedger.createMany({
      data: [
        {
          characterId: c.characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: 60n,
          reason: 'A',
        },
        {
          characterId: c.characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: 40n,
          reason: 'B',
        },
      ],
    });
    const r = await admin.runLedgerAudit();
    expect(r.currencyDiscrepancies).toEqual([]);
  });
});
