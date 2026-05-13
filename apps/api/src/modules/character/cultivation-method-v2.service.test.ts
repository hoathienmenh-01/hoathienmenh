import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CULTIVATION_METHODS_V2,
  STARTER_METHOD_V2_KEYS,
  getMethodV2Def,
  methodFragmentItemKey,
  methodUpgradeLinhThachCost,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import {
  CultivationMethodV2Error,
  CultivationMethodV2Service,
} from './cultivation-method-v2.service';
import { CurrencyService } from './currency.service';
import { CharacterService } from './character.service';
import { InventoryService } from '../inventory/inventory.service';
import { RealtimeService } from '../realtime/realtime.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

/**
 * Phase 26.3 — CultivationMethodV2Service integration test.
 *
 * Coverage:
 *   - `grantStarterV2IfMissing`: tạo 2 starter row idempotent.
 *   - `unlock`: validate realm + consume fragment + linhThach + tạo
 *     `CharacterCultivationMethod` + ghi `MethodUpgradeLog`.
 *   - `equipV2` / `unequipV2`: validate slot + occupy conflict + mirror
 *     QI_MAIN sang `Character.equippedCultivationMethodKey` legacy.
 *   - `upgrade`: consume linh thạch + material → level+1.
 *   - `starUp`: consume fragments → star+1.
 *   - `getEquippedSnapshot`: trả các method đang equip để stat compose.
 *
 * Test cần Postgres test container — fallback `TEST_DATABASE_URL` mirror
 * pattern các test khác (xem `cultivation-method.service.test.ts`).
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let inventory: InventoryService;
let currency: CurrencyService;
let svc: CultivationMethodV2Service;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  inventory = new InventoryService(prisma, realtime, chars);
  currency = new CurrencyService(prisma);
  svc = new CultivationMethodV2Service(prisma, inventory, currency);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function giveFragments(
  characterId: string,
  methodKey: string,
  qty: number,
): Promise<void> {
  const itemKey = methodFragmentItemKey(methodKey);
  await inventory.grantTx(prisma, characterId, [{ itemKey, qty }], {
    reason: 'METHOD_FRAGMENT_GRANT',
    refType: 'TestSetup',
    refId: methodKey,
  });
}

async function findRow(characterId: string, methodKey: string) {
  return prisma.characterCultivationMethod.findUnique({
    where: { characterId_methodKey: { characterId, methodKey } },
  });
}

/**
 * Helper — chọn 1 method tier-2 không sect-locked để test unlock flow.
 * Catalog có nhiều method tier-2 (xem `CULTIVATION_METHODS_V2`); tier-2
 * có `unlockLinhThachCost = 800` và `fragmentsRequired = 18` (theo
 * `TIER_BASELINE`).
 */
function pickUnlockableTier2(): {
  key: string;
  fragmentsRequired: number;
  unlockLinhThachCost: number;
  unlockRealmOrder: number;
} {
  const m = CULTIVATION_METHODS_V2.find(
    (m) =>
      m.tier === 2 &&
      !m.requiredSect &&
      m.enabled &&
      !STARTER_METHOD_V2_KEYS.includes(m.key),
  );
  if (!m) throw new Error('no unlockable tier-2 method in catalog');
  return {
    key: m.key,
    fragmentsRequired: m.fragmentsRequired,
    unlockLinhThachCost: m.unlockLinhThachCost,
    unlockRealmOrder: m.unlockRealmOrder,
  };
}

describe('CultivationMethodV2Service.grantStarterV2IfMissing (Phase 26.3 onboard)', () => {
  it('tạo 2 row starter cho character mới (idempotent)', async () => {
    const f = await makeUserChar(prisma);
    await svc.grantStarterV2IfMissing(f.characterId);
    await svc.grantStarterV2IfMissing(f.characterId);

    const rows = await prisma.characterCultivationMethod.findMany({
      where: { characterId: f.characterId },
    });
    expect(rows.length).toBe(STARTER_METHOD_V2_KEYS.length);
    const keys = rows.map((r) => r.methodKey).sort();
    expect(keys).toEqual([...STARTER_METHOD_V2_KEYS].sort());
    for (const r of rows) {
      expect(r.level).toBe(1);
      expect(r.star).toBe(0);
      expect(r.methodExp).toBe(0n);
      expect(r.source).toBe('starter');
    }
  });
});

describe('CultivationMethodV2Service.getV2State (Phase 26.3)', () => {
  it('character không V2 row → catalog full nhưng tất cả unlocked=false', async () => {
    const f = await makeUserChar(prisma);
    const state = await svc.getV2State(f.characterId);
    expect(state.catalog.length).toBe(
      CULTIVATION_METHODS_V2.filter((m) => m.enabled).length,
    );
    for (const c of state.catalog) {
      expect(c.unlocked).toBe(false);
      expect(c.level).toBe(0);
      expect(c.star).toBe(0);
      expect(c.equippedSlot).toBeNull();
    }
    expect(state.equippedSlots.length).toBe(0);
    expect(state.cultivationRateMul).toBe(1);
    expect(state.bodyRateMul).toBe(1);
  });

  it('character đã starter → catalog row của starter có unlocked=true', async () => {
    const f = await makeUserChar(prisma);
    await svc.grantStarterV2IfMissing(f.characterId);
    const state = await svc.getV2State(f.characterId);
    const starterEntries = state.catalog.filter((c) =>
      STARTER_METHOD_V2_KEYS.includes(c.methodKey),
    );
    expect(starterEntries.length).toBe(STARTER_METHOD_V2_KEYS.length);
    for (const e of starterEntries) {
      expect(e.unlocked).toBe(true);
      expect(e.level).toBe(1);
    }
  });
});

describe('CultivationMethodV2Service.unlock (Phase 26.3)', () => {
  it('thiếu fragment → INSUFFICIENT_QTY', async () => {
    const pick = pickUnlockableTier2();
    const f = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      realmStage: pick.unlockRealmOrder + 1,
      linhThach: BigInt(pick.unlockLinhThachCost * 2),
    });
    // Cần realm đủ cao — set thông qua realmKey/stage không quan trọng vì
    // service đọc `realmByKey(c.realmKey).order`. Patch thông qua update.
    await prisma.character.update({
      where: { id: f.characterId },
      data: { realmKey: 'kim_dan' },
    });
    await expect(svc.unlock(f.characterId, pick.key)).rejects.toThrowError();
  });

  it('thiếu linh thạch → service throw (INSUFFICIENT_LINH_THACH)', async () => {
    const pick = pickUnlockableTier2();
    const f = await makeUserChar(prisma, { linhThach: 0n });
    await prisma.character.update({
      where: { id: f.characterId },
      data: { realmKey: 'kim_dan' },
    });
    await giveFragments(f.characterId, pick.key, pick.fragmentsRequired);
    await expect(svc.unlock(f.characterId, pick.key)).rejects.toThrowError();
  });

  it('realm thấp hơn unlockRealmOrder → REALM_TOO_LOW', async () => {
    const pick = pickUnlockableTier2();
    const f = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      linhThach: BigInt(pick.unlockLinhThachCost * 2),
    });
    await giveFragments(f.characterId, pick.key, pick.fragmentsRequired);
    await expect(svc.unlock(f.characterId, pick.key)).rejects.toBeInstanceOf(
      CultivationMethodV2Error,
    );
    await expect(svc.unlock(f.characterId, pick.key)).rejects.toMatchObject({
      code: 'REALM_TOO_LOW',
    });
  });

  it('method không tồn tại → METHOD_NOT_FOUND', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      svc.unlock(f.characterId, 'nonexistent_method_key'),
    ).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
  });

  it('happy path: đủ fragment + linhThach + realm → tạo V2 row + log', async () => {
    const pick = pickUnlockableTier2();
    const f = await makeUserChar(prisma, {
      linhThach: BigInt(pick.unlockLinhThachCost * 2),
    });
    await prisma.character.update({
      where: { id: f.characterId },
      data: { realmKey: 'kim_dan' },
    });
    await giveFragments(f.characterId, pick.key, pick.fragmentsRequired);

    const state = await svc.unlock(f.characterId, pick.key);

    const row = await findRow(f.characterId, pick.key);
    expect(row).not.toBeNull();
    expect(row!.level).toBe(1);
    expect(row!.star).toBe(0);
    expect(row!.source).toBe('fragment_combine');

    // Fragment đã bị consume hết (nếu fragmentsRequired > 0 catalog có set).
    const remaining = await prisma.inventoryItem.aggregate({
      where: { characterId: f.characterId, itemKey: methodFragmentItemKey(pick.key) },
      _sum: { qty: true },
    });
    expect(remaining._sum.qty ?? 0).toBe(0);

    // Linh thạch bị trừ.
    const c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    expect(c.linhThach).toBe(
      BigInt(pick.unlockLinhThachCost * 2) - BigInt(pick.unlockLinhThachCost),
    );

    // Method log có 1 entry UNLOCK.
    const logs = await prisma.methodUpgradeLog.findMany({
      where: { characterId: f.characterId, methodKey: pick.key },
    });
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe('UNLOCK');
    expect(logs[0].success).toBe(true);

    // State trả ra ghi nhận method này đã unlocked.
    const entry = state.catalog.find((c) => c.methodKey === pick.key)!;
    expect(entry.unlocked).toBe(true);
    expect(entry.level).toBe(1);
  });

  it('unlock 2 lần → METHOD_ALREADY_UNLOCKED', async () => {
    const pick = pickUnlockableTier2();
    const f = await makeUserChar(prisma, {
      linhThach: BigInt(pick.unlockLinhThachCost * 10),
    });
    await prisma.character.update({
      where: { id: f.characterId },
      data: { realmKey: 'kim_dan' },
    });
    await giveFragments(f.characterId, pick.key, pick.fragmentsRequired * 2);
    await svc.unlock(f.characterId, pick.key);
    await expect(svc.unlock(f.characterId, pick.key)).rejects.toMatchObject({
      code: 'METHOD_ALREADY_UNLOCKED',
    });
  });
});

describe('CultivationMethodV2Service.equipV2 / unequipV2 (Phase 26.3)', () => {
  it('equip method chưa unlock → METHOD_NOT_UNLOCKED', async () => {
    const f = await makeUserChar(prisma);
    const pick = pickUnlockableTier2();
    await expect(
      svc.equipV2(f.characterId, pick.key, 'QI_MAIN'),
    ).rejects.toMatchObject({ code: 'METHOD_NOT_UNLOCKED' });
  });

  it('equip QI_MAIN starter → mirror sang Character.equippedCultivationMethodKey', async () => {
    const f = await makeUserChar(prisma);
    await svc.grantStarterV2IfMissing(f.characterId);
    const qiStarter = STARTER_METHOD_V2_KEYS.find(
      (k) => getMethodV2Def(k)?.primarySlot === 'QI_MAIN',
    );
    expect(qiStarter).toBeDefined();
    await svc.equipV2(f.characterId, qiStarter!, 'QI_MAIN');

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    expect(c.equippedCultivationMethodKey).toBe(qiStarter);

    const row = await findRow(f.characterId, qiStarter!);
    expect(row!.equippedSlot).toBe('QI_MAIN');
  });

  it('unequip QI_MAIN → clear cả slot + Character legacy field', async () => {
    const f = await makeUserChar(prisma);
    await svc.grantStarterV2IfMissing(f.characterId);
    const qiStarter = STARTER_METHOD_V2_KEYS.find(
      (k) => getMethodV2Def(k)?.primarySlot === 'QI_MAIN',
    )!;
    await svc.equipV2(f.characterId, qiStarter, 'QI_MAIN');
    await svc.unequipV2(f.characterId, 'QI_MAIN');

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    expect(c.equippedCultivationMethodKey).toBeNull();
    const row = await findRow(f.characterId, qiStarter);
    expect(row!.equippedSlot).toBeNull();
  });

  it('equip method có slot không trong allowedSlots → SLOT_NOT_ALLOWED', async () => {
    const f = await makeUserChar(prisma);
    await svc.grantStarterV2IfMissing(f.characterId);
    const qiStarter = STARTER_METHOD_V2_KEYS.find(
      (k) => getMethodV2Def(k)?.primarySlot === 'QI_MAIN',
    )!;
    const def = getMethodV2Def(qiStarter)!;
    const disallowed = (['QI_MAIN', 'BODY_MAIN', 'SUPPORT', 'SECT', 'SPECIAL'] as const).find(
      (s) => !def.allowedSlots.includes(s),
    );
    if (!disallowed) return;
    await expect(
      svc.equipV2(f.characterId, qiStarter, disallowed),
    ).rejects.toMatchObject({ code: 'SLOT_NOT_ALLOWED' });
  });
});

describe('CultivationMethodV2Service.upgrade (Phase 26.3)', () => {
  it('upgrade starter (no materials, no breakthrough at level 1) → level 2', async () => {
    const f = await makeUserChar(prisma, { linhThach: 999_999n });
    await svc.grantStarterV2IfMissing(f.characterId);
    const qiStarter = STARTER_METHOD_V2_KEYS[0];
    const def = getMethodV2Def(qiStarter)!;
    // Starter tier-1 thường có upgradeMaterials = [] (theo qiMethod
    // builder); nếu có thì cấp đủ.
    for (const m of def.upgradeMaterials) {
      await inventory.grantTx(prisma, f.characterId, [{ itemKey: m.itemKey, qty: m.qty }], {
        reason: 'METHOD_FRAGMENT_GRANT',
        refType: 'TestSetup',
      });
    }
    // Breakthrough materials nếu level+1 trùng atLevel.
    for (const m of def.breakthroughMaterials.filter((b) => b.atLevel === 2)) {
      await inventory.grantTx(prisma, f.characterId, [{ itemKey: m.itemKey, qty: m.qty }], {
        reason: 'METHOD_FRAGMENT_GRANT',
        refType: 'TestSetup',
      });
    }

    await svc.upgrade(f.characterId, qiStarter);

    const row = await findRow(f.characterId, qiStarter);
    expect(row!.level).toBe(2);

    const logs = await prisma.methodUpgradeLog.findMany({
      where: {
        characterId: f.characterId,
        methodKey: qiStarter,
        action: 'UPGRADE',
      },
    });
    expect(logs.length).toBe(1);

    // Linh thạch bị trừ đúng số lượng.
    const cost = methodUpgradeLinhThachCost(def.tier, 1);
    const c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    expect(c.linhThach).toBe(999_999n - BigInt(cost));
  });

  it('method chưa unlock → METHOD_NOT_UNLOCKED', async () => {
    const f = await makeUserChar(prisma);
    const pick = pickUnlockableTier2();
    await expect(svc.upgrade(f.characterId, pick.key)).rejects.toMatchObject({
      code: 'METHOD_NOT_UNLOCKED',
    });
  });
});

describe('CultivationMethodV2Service.starUp (Phase 26.3)', () => {
  it('thiếu fragment → INSUFFICIENT_QTY (inventory error)', async () => {
    const f = await makeUserChar(prisma);
    await svc.grantStarterV2IfMissing(f.characterId);
    const qiStarter = STARTER_METHOD_V2_KEYS[0];
    await expect(svc.starUp(f.characterId, qiStarter)).rejects.toThrowError();
  });

  it('happy path: đủ fragment → star + 1', async () => {
    const f = await makeUserChar(prisma);
    await svc.grantStarterV2IfMissing(f.characterId);
    const qiStarter = STARTER_METHOD_V2_KEYS[0];
    const def = getMethodV2Def(qiStarter)!;
    await giveFragments(f.characterId, qiStarter, def.fragmentsPerStar);

    await svc.starUp(f.characterId, qiStarter);

    const row = await findRow(f.characterId, qiStarter);
    expect(row!.star).toBe(1);

    const logs = await prisma.methodUpgradeLog.findMany({
      where: {
        characterId: f.characterId,
        methodKey: qiStarter,
        action: 'STAR_UP',
      },
    });
    expect(logs.length).toBe(1);
  });
});

describe('CultivationMethodV2Service.getEquippedSnapshot (Phase 26.3 stat wire)', () => {
  it('chưa equip → snapshot rỗng', async () => {
    const f = await makeUserChar(prisma);
    const snap = await svc.getEquippedSnapshot(f.characterId);
    expect(snap.length).toBe(0);
  });

  it('equip QI_MAIN + BODY_MAIN → snapshot 2 entry với đúng slot', async () => {
    const f = await makeUserChar(prisma);
    await svc.grantStarterV2IfMissing(f.characterId);
    const qi = STARTER_METHOD_V2_KEYS.find(
      (k) => getMethodV2Def(k)?.primarySlot === 'QI_MAIN',
    )!;
    const body = STARTER_METHOD_V2_KEYS.find(
      (k) => getMethodV2Def(k)?.primarySlot === 'BODY_MAIN',
    )!;
    await svc.equipV2(f.characterId, qi, 'QI_MAIN');
    await svc.equipV2(f.characterId, body, 'BODY_MAIN');

    const snap = await svc.getEquippedSnapshot(f.characterId);
    expect(snap.length).toBe(2);
    expect(new Set(snap.map((e) => e.slot))).toEqual(
      new Set(['QI_MAIN', 'BODY_MAIN']),
    );
  });
});
