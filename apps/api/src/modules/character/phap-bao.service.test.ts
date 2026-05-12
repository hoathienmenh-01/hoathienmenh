import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { PhapBaoError, PhapBaoService } from './phap-bao.service';
import { CurrencyService } from './currency.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let svc: PhapBaoService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const currency = new CurrencyService(prisma);
  svc = new PhapBaoService(prisma, currency);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Phase 23.5 — Pháp Bảo Advanced Artifact System integration tests.
 *
 * Cover server-authority gates KHÔNG cover ở shared unit (`phap-bao.test.ts`):
 *   - Ownership check (chỉ trả pháp bảo có `characterId` khớp).
 *   - Catalog filter (chỉ trả entries có `itemKey ∈ PHAP_BAO_CATALOG`).
 *   - Realm gate surface qua `canEquip` (UI lock state).
 *   - Preview surface refine cost (đã có cap → null).
 *   - Awaken cost = null cho quality thấp / chưa đủ điều kiện.
 */
describe('PhapBaoService.listForCharacter', () => {
  it('trả pháp bảo đang sở hữu + filter catalog (loại item không thuộc PHAP_BAO_CATALOG)', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'luyenkhi' });

    // Pháp bảo (thuộc catalog) — tier 2, requiredRealmOrder 4.
    await prisma.inventoryItem.create({
      data: {
        characterId: ctx.characterId,
        itemKey: 'ngu_hanh_linh_chau',
        qty: 1,
      },
    });
    // Random equipment (KHÔNG thuộc catalog) — không trả về.
    await prisma.inventoryItem.create({
      data: {
        characterId: ctx.characterId,
        itemKey: 'huyen_kiem',
        qty: 1,
      },
    });

    const result = await svc.listForCharacter(ctx.characterId);
    expect(result).toHaveLength(1);
    expect(result[0].def.artifactKey).toBe('ngu_hanh_linh_chau');
    expect(result[0].def.artifactTier).toBe(2);
    expect(result[0].refineLevel).toBe(0);
    expect(result[0].starLevel).toBe(0);
    expect(result[0].awakenStage).toBe(0);
  });

  it('canEquip=false khi cảnh giới character < requiredRealmOrder của pháp bảo', async () => {
    // luyenkhi order=0 → realmOrder = 1 (1-indexed).
    const ctx = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await prisma.inventoryItem.create({
      data: {
        characterId: ctx.characterId,
        itemKey: 'ngu_hanh_linh_chau', // requiredRealmOrder 4
        qty: 1,
      },
    });
    const result = await svc.listForCharacter(ctx.characterId);
    expect(result[0].canEquip).toBe(false);
    expect(result[0].requiredRealmOrder).toBe(4);
  });

  it('KHÔNG trả pháp bảo của character khác (ownership)', async () => {
    const charA = await makeUserChar(prisma);
    const charB = await makeUserChar(prisma);
    // Pháp bảo của charA.
    await prisma.inventoryItem.create({
      data: {
        characterId: charA.characterId,
        itemKey: 'ngu_hanh_linh_chau',
        qty: 1,
      },
    });
    // Query bằng charB → empty.
    const result = await svc.listForCharacter(charB.characterId);
    expect(result).toHaveLength(0);
  });

  it('throw NO_CHARACTER khi character không tồn tại', async () => {
    await expect(svc.listForCharacter('non-existent-id')).rejects.toThrow(
      PhapBaoError,
    );
  });
});

describe('PhapBaoService.preview', () => {
  it('preview pháp bảo trả passive bonus, active skill, refine cost kế tiếp', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    const item = await prisma.inventoryItem.create({
      data: {
        characterId: ctx.characterId,
        itemKey: 'ngu_hanh_linh_chau',
        qty: 1,
      },
    });

    const preview = await svc.preview(ctx.characterId, item.id);
    expect(preview.def.artifactKey).toBe('ngu_hanh_linh_chau');
    expect(preview.refineLevel).toBe(0);
    expect(preview.starLevel).toBe(0);
    expect(preview.awakenStage).toBe(0);
    // Refine cost luôn có (chưa max).
    expect(preview.refineCost).not.toBeNull();
    expect(preview.refineCost?.linhThachCost).toBeGreaterThan(0);
    expect(preview.refineCost?.materialQty).toBeGreaterThan(0);
    // Star cost: pháp bảo này có starCap > 0 → cost có.
    expect(preview.starCost).not.toBeNull();
    // Power score deterministic — call lần 2 trả giá trị y hệt.
    const preview2 = await svc.preview(ctx.characterId, item.id);
    expect(preview2.powerScore).toBe(preview.powerScore);
  });

  it('preview pháp bảo quality LINH (ngu_hanh_linh_chau) → awakenCost null (yêu cầu TIEN/THAN + tier ≥ 5)', async () => {
    const ctx = await makeUserChar(prisma);
    const item = await prisma.inventoryItem.create({
      data: {
        characterId: ctx.characterId,
        itemKey: 'ngu_hanh_linh_chau', // quality LINH, tier 2
        qty: 1,
      },
    });
    const preview = await svc.preview(ctx.characterId, item.id);
    expect(preview.awakenCost).toBeNull();
  });

  it('preview pháp bảo trả starUpEnabled=true, awakenEnabled=true (Phase 23.7 persistence live)', async () => {
    const ctx = await makeUserChar(prisma);
    const item = await prisma.inventoryItem.create({
      data: {
        characterId: ctx.characterId,
        itemKey: 'huyet_nguyet_ho_lo', // quality TIEN, tier 6 — sẽ awaken-able
        qty: 1,
      },
    });
    const preview = await svc.preview(ctx.characterId, item.id);
    // Phase 23.7: star/awaken enabled.
    expect(preview.awakenCost).toBeNull(); // starLevel 0 < required → null
    expect(preview.awakenEnabled).toBe(true);
    expect(preview.starUpEnabled).toBe(true);
  });

  it('throw INVENTORY_ITEM_NOT_FOUND nếu inventoryItem thuộc character khác', async () => {
    const charA = await makeUserChar(prisma);
    const charB = await makeUserChar(prisma);
    const item = await prisma.inventoryItem.create({
      data: {
        characterId: charA.characterId,
        itemKey: 'ngu_hanh_linh_chau',
        qty: 1,
      },
    });
    await expect(svc.preview(charB.characterId, item.id)).rejects.toThrow(
      PhapBaoError,
    );
  });

  it('throw PHAP_BAO_NOT_FOUND nếu inventoryItem không thuộc PHAP_BAO_CATALOG', async () => {
    const ctx = await makeUserChar(prisma);
    const item = await prisma.inventoryItem.create({
      data: {
        characterId: ctx.characterId,
        itemKey: 'huyen_kiem', // equipment thường, không phải pháp bảo
        qty: 1,
      },
    });
    await expect(svc.preview(ctx.characterId, item.id)).rejects.toThrow(
      PhapBaoError,
    );
  });

  it('refineCost reflect refineLevel hiện tại (level cao hơn → cost cao hơn)', async () => {
    const ctx = await makeUserChar(prisma);
    const lowItem = await prisma.inventoryItem.create({
      data: {
        characterId: ctx.characterId,
        itemKey: 'ngu_hanh_linh_chau',
        qty: 1,
        refineLevel: 0,
      },
    });
    const highItem = await prisma.inventoryItem.create({
      data: {
        characterId: ctx.characterId,
        itemKey: 'ngu_hanh_linh_chau',
        qty: 1,
        refineLevel: 5,
      },
    });
    const previewLow = await svc.preview(ctx.characterId, lowItem.id);
    const previewHigh = await svc.preview(ctx.characterId, highItem.id);
    expect(previewLow.refineCost).not.toBeNull();
    expect(previewHigh.refineCost).not.toBeNull();
    expect(previewHigh.refineCost!.linhThachCost).toBeGreaterThan(
      previewLow.refineCost!.linhThachCost,
    );
  });
});

describe('PhapBaoService.listCatalog', () => {
  it('trả toàn bộ catalog metadata (≥ 10 entries)', () => {
    const catalog = svc.listCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(10);
    for (const entry of catalog) {
      expect(entry.artifactKey).toBeTruthy();
      expect(entry.itemKey).toBe(entry.artifactKey);
      expect(entry.artifactTier).toBeGreaterThanOrEqual(1);
      expect(entry.artifactTier).toBeLessThanOrEqual(10);
      expect(entry.requiredRealmOrder).toBeGreaterThanOrEqual(1);
      expect(entry.requiredRealmOrder).toBeLessThanOrEqual(28);
    }
  });
});
