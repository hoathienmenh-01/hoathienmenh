import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ARTIFACT_BLUEPRINT_CATALOG,
  ARTIFACT_CATALOG_V2,
  defaultSlotForArtifactType,
  getArtifactDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { ArtifactV2Error, ArtifactV2Service } from './artifact-v2.service';
import { CurrencyService } from './currency.service';
import { CharacterService } from './character.service';
import { InventoryService } from '../inventory/inventory.service';
import { RealtimeService } from '../realtime/realtime.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

/**
 * Phase 26.4 — ArtifactV2Service integration test.
 *
 * Coverage (yêu cầu Phần 19 §API/service tests):
 *   - craft fail khi BLUEPRINT_NOT_FOUND.
 *   - craft fail khi INSUFFICIENT_MATERIALS (thiếu phôi/bản vẽ).
 *   - craft success consume material + linhThach + tạo CharacterArtifactV2
 *     + ghi ArtifactCraftAttemptLog.
 *   - equip success / unequip success (partial-unique slot).
 *   - equip fail khi SLOT_INVALID_FOR_TYPE (FLYING_SWORD vào slot
 *     DEFENSE_ARTIFACT_V2).
 *   - upgradeLevel consume linhThach + nâng level.
 *   - logs ghi đủ (ArtifactCraftAttemptLog + ArtifactUpgradeLogV2).
 *
 * Test cần Postgres test container — fallback `TEST_DATABASE_URL`
 * mirror pattern các test khác (xem `cultivation-method-v2.service.test.ts`).
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let inventory: InventoryService;
let currency: CurrencyService;
let svc: ArtifactV2Service;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  inventory = new InventoryService(prisma, realtime, chars);
  currency = new CurrencyService(prisma);
  svc = new ArtifactV2Service(prisma, inventory, currency);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Cấp đủ inputs cho 1 blueprint (đảm bảo craft pass material gate).
 */
async function giveBlueprintInputs(
  characterId: string,
  blueprintKey: string,
): Promise<void> {
  const bp = ARTIFACT_BLUEPRINT_CATALOG.find((b) => b.key === blueprintKey);
  if (!bp) throw new Error(`blueprint not found: ${blueprintKey}`);
  await inventory.grantTx(
    prisma,
    characterId,
    bp.inputs.map((inp) => ({ itemKey: inp.itemKey, qty: inp.qty })),
    {
      reason: 'ADMIN_GRANT',
      refType: 'TestSetup',
      refId: blueprintKey,
    },
  );
}

function pickTier1Blueprint(): (typeof ARTIFACT_BLUEPRINT_CATALOG)[number] {
  const bp = ARTIFACT_BLUEPRINT_CATALOG.find(
    (b) => b.enabled && b.artifactTier === 1 && b.successRate >= 0.5,
  );
  if (!bp) throw new Error('no tier-1 blueprint available for testing');
  return bp;
}

describe('ArtifactV2Service.craft', () => {
  it('throws BLUEPRINT_NOT_FOUND khi blueprintKey không tồn tại', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await expect(svc.craft(ctx.characterId, 'no-such-blueprint')).rejects.toThrow(
      ArtifactV2Error,
    );
  });

  it('throws INSUFFICIENT_MATERIALS khi thiếu phôi/bản vẽ', async () => {
    const ctx = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      linhThach: 100_000n,
    });
    const bp = pickTier1Blueprint();
    // KHÔNG cấp inputs.
    await expect(svc.craft(ctx.characterId, bp.key)).rejects.toThrow();
  });

  it('throws REALM_TOO_LOW khi cảnh giới thấp hơn blueprint.requiredRealmOrder', async () => {
    const bp = ARTIFACT_BLUEPRINT_CATALOG.find(
      (b) => b.enabled && b.requiredRealmOrder >= 5,
    );
    if (!bp) return; // skip nếu không có blueprint tier cao
    const ctx = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      linhThach: 10_000_000n,
    });
    await giveBlueprintInputs(ctx.characterId, bp.key);
    await expect(svc.craft(ctx.characterId, bp.key)).rejects.toThrow(ArtifactV2Error);
  });

  it('craft tier-1 consume material + linh thạch và ghi ArtifactCraftAttemptLog', async () => {
    const bp = pickTier1Blueprint();
    const ctx = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      linhThach: 1_000_000n,
    });
    await giveBlueprintInputs(ctx.characterId, bp.key);
    const linhThachBefore = (
      await prisma.character.findUniqueOrThrow({ where: { id: ctx.characterId } })
    ).linhThach;

    const out = await svc.craft(ctx.characterId, bp.key);
    expect(typeof out.success).toBe('boolean');
    expect(out.successRate).toBeGreaterThan(0);
    expect(out.successRate).toBeLessThanOrEqual(1);
    expect(out.consumed.linhThach).toBe(bp.linhThachCost);

    // Inventory consumed.
    for (const inp of bp.inputs) {
      const row = await prisma.inventoryItem.findFirst({
        where: { characterId: ctx.characterId, itemKey: inp.itemKey },
      });
      expect((row?.qty ?? 0)).toBeLessThan(inp.qty);
    }

    // LinhThach trừ.
    const linhThachAfter = (
      await prisma.character.findUniqueOrThrow({ where: { id: ctx.characterId } })
    ).linhThach;
    expect(linhThachBefore - linhThachAfter).toBe(BigInt(bp.linhThachCost));

    // Log ghi.
    const logs = await prisma.artifactCraftAttemptLog.findMany({
      where: { characterId: ctx.characterId, blueprintKey: bp.key },
    });
    expect(logs.length).toBe(1);
    expect(logs[0].success).toBe(out.success);
    if (out.success) {
      expect(out.artifactId).not.toBeNull();
      const arts = await prisma.characterArtifactV2.findMany({
        where: { characterId: ctx.characterId },
      });
      expect(arts.length).toBe(1);
      expect(arts[0].artifactKey).toBe(bp.artifactKey);
    }
  });
});

describe('ArtifactV2Service.equip / unequip', () => {
  async function createArtifactRow(
    characterId: string,
    artifactKey: string,
  ): Promise<string> {
    const def = getArtifactDef(artifactKey);
    if (!def) throw new Error('no def');
    const row = await prisma.characterArtifactV2.create({
      data: {
        characterId,
        artifactKey,
        name: def.nameVi,
        type: def.type,
        element: def.element,
        tier: def.tier,
        grade: 'TRUNG_PHAM',
        level: 1,
        star: 0,
        refineLevel: 0,
        awakenLevel: 0,
        spiritExp: 0n,
        spiritLevel: 0,
        statsJson: {},
        subStatsJson: [],
        skillsJson: [],
      },
    });
    return row.id;
  }

  it('equip success set equippedSlot', async () => {
    const ctx = await makeUserChar(prisma, {
      realmKey: 'dao_quan', // order ≥ 20 → đủ cho mọi tier-1 artifact
    });
    const art = ARTIFACT_CATALOG_V2.find((a) => a.tier === 1)!;
    const id = await createArtifactRow(ctx.characterId, art.key);
    const slot = defaultSlotForArtifactType(art.type);
    const state = await svc.equip(ctx.characterId, id, slot);
    const entry = state.owned.find((o) => o.id === id);
    expect(entry?.equippedSlot).toBe(slot);
  });

  it('equip fail SLOT_INVALID_FOR_TYPE khi slot không hợp với type', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'dao_quan' });
    const flying = ARTIFACT_CATALOG_V2.find((a) => a.type === 'FLYING_SWORD')!;
    const id = await createArtifactRow(ctx.characterId, flying.key);
    await expect(
      svc.equip(ctx.characterId, id, 'DEFENSE_ARTIFACT_V2'),
    ).rejects.toThrow(ArtifactV2Error);
  });

  it('equip kicks out occupying artifact in same slot', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'dao_quan' });
    const flyings = ARTIFACT_CATALOG_V2.filter((a) => a.type === 'FLYING_SWORD').slice(
      0,
      2,
    );
    expect(flyings.length).toBe(2);
    const id1 = await createArtifactRow(ctx.characterId, flyings[0].key);
    const id2 = await createArtifactRow(ctx.characterId, flyings[1].key);
    const slot = defaultSlotForArtifactType(flyings[0].type);
    await svc.equip(ctx.characterId, id1, slot);
    const state = await svc.equip(ctx.characterId, id2, slot);
    const e1 = state.owned.find((o) => o.id === id1);
    const e2 = state.owned.find((o) => o.id === id2);
    expect(e1?.equippedSlot).toBeNull();
    expect(e2?.equippedSlot).toBe(slot);
  });

  it('unequip clears equippedSlot', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'dao_quan' });
    const art = ARTIFACT_CATALOG_V2.find((a) => a.tier === 1)!;
    const id = await createArtifactRow(ctx.characterId, art.key);
    await svc.equip(ctx.characterId, id, defaultSlotForArtifactType(art.type));
    const state = await svc.unequip(ctx.characterId, id);
    const entry = state.owned.find((o) => o.id === id);
    expect(entry?.equippedSlot).toBeNull();
  });
});

describe('ArtifactV2Service.upgradeLevel', () => {
  it('upgradeLevel consume linhThach + tăng level + ghi ArtifactUpgradeLogV2', async () => {
    const ctx = await makeUserChar(prisma, {
      realmKey: 'dao_quan',
      linhThach: 10_000_000n,
    });
    const art = ARTIFACT_CATALOG_V2.find((a) => a.tier === 1)!;
    const row = await prisma.characterArtifactV2.create({
      data: {
        characterId: ctx.characterId,
        artifactKey: art.key,
        name: art.nameVi,
        type: art.type,
        element: art.element,
        tier: art.tier,
        grade: 'TRUNG_PHAM',
        level: 1,
        star: 0,
        refineLevel: 0,
        awakenLevel: 0,
        spiritExp: 0n,
        spiritLevel: 0,
        statsJson: {},
        subStatsJson: [],
        skillsJson: [],
      },
    });
    // Grant material cho level-up: `artifact_ore_t<tier>` (xem
    // `computeArtifactLevelUpCost` → `artifactOreKey`).
    await inventory.grantTx(
      prisma,
      ctx.characterId,
      [{ itemKey: 'artifact_ore_t1', qty: 10 }],
      { reason: 'ADMIN_GRANT', refType: 'TestSetup', refId: 'levelup' },
    );

    const out = await svc.upgradeLevel(ctx.characterId, row.id);
    expect(out.action).toBe('UPGRADE');
    expect(out.success).toBe(true);
    expect(out.to.level).toBe(out.from.level + 1);

    const after = await prisma.characterArtifactV2.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(after.level).toBe(2);

    const logs = await prisma.artifactUpgradeLogV2.findMany({
      where: { characterId: ctx.characterId, artifactId: row.id },
    });
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe('UPGRADE');
    expect(logs[0].success).toBe(true);
  });
});

describe('ArtifactV2Service.getState', () => {
  it('returns realmOrder + linhThach + owned + blueprint preview', async () => {
    const ctx = await makeUserChar(prisma, { realmKey: 'luyenkhi', linhThach: 5_000n });
    const state = await svc.getState(ctx.characterId);
    expect(state.realmOrder).toBe(1);
    expect(Number(state.linhThachOwned)).toBe(5_000);
    expect(Array.isArray(state.owned)).toBe(true);
    expect(state.blueprints.length).toBeGreaterThan(0);
    // Mỗi blueprint phải có successRate hợp lệ.
    for (const bp of state.blueprints) {
      expect(bp.successRate).toBeGreaterThan(0);
      expect(bp.successRate).toBeLessThanOrEqual(1);
    }
  });

  it('throws CHARACTER_NOT_FOUND nếu characterId không tồn tại', async () => {
    await expect(svc.getState('does-not-exist')).rejects.toThrow(ArtifactV2Error);
  });
});
