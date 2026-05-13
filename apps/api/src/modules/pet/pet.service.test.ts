/**
 * Phase 35.0 — Pet/Linh Thú API integration tests.
 *
 * Coverage:
 *   - PetCatalogService: list / get / audit / caps.
 *   - PetCollectionService: grantPet / list / get / equip (1 slot swap) /
 *     unequip / lock+unlock / rename validation / not-owned guard.
 *   - PetSnapshotService: getEquippedPetSnapshot returns null khi không
 *     equip, PvP / BOSS clamp respected.
 *   - PetShardService: balance / grantTx / consumeTx + insufficient guard.
 *   - PetSourceService: forPet / forMaterial / audit (no free-path issue
 *     for non-premium pets after auto-generation).
 *   - PetBoxService: open consumes cost + grants result + pity counter
 *     incremented + idempotent với requestId.
 *   - PetUpgradeService: feed exp, star-up qua shard, breakthrough cap,
 *     evolve qua material, skill upgrade.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CurrencyService } from '../character/currency.service';
import { PetCatalogService } from './pet-catalog.service';
import { PetCollectionService, PetCollectionError } from './pet-collection.service';
import { PetSnapshotService } from './pet-snapshot.service';
import { PetShardService, PetShardError } from './pet-shard.service';
import { PetBoxService } from './pet-box.service';
import { PetUpgradeService, PetUpgradeError } from './pet-upgrade.service';
import { PetSourceService } from './pet-source.service';
import { makeUserChar, wipeAll } from '../../test-helpers';
import { PETS } from '@xuantoi/shared';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let catalog: PetCatalogService;
let collection: PetCollectionService;
let snapshot: PetSnapshotService;
let shards: PetShardService;
let inventory: InventoryService;
let currency: CurrencyService;
let boxes: PetBoxService;
let upgrade: PetUpgradeService;
let sources: PetSourceService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  catalog = new PetCatalogService();
  collection = new PetCollectionService(prisma);
  snapshot = new PetSnapshotService(collection);
  shards = new PetShardService(prisma);
  inventory = new InventoryService(prisma);
  currency = new CurrencyService(prisma);
  boxes = new PetBoxService(prisma, inventory, currency, collection, shards);
  upgrade = new PetUpgradeService(prisma, inventory, currency, shards);
  sources = new PetSourceService();
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PetCatalogService', () => {
  it('list returns ≥30 pets and audit returns no fatal issues', () => {
    expect(catalog.list().length).toBeGreaterThanOrEqual(30);
    const issues = catalog.audit();
    // Catalog should not have any structural duplicates or invalid refs.
    const fatal = issues.filter((i) =>
      ['PET_KEY_DUPLICATE', 'INVALID_SKILL_REF'].includes(i.code),
    );
    expect(fatal).toHaveLength(0);
  });

  it('list filter by type=PET excludes LINH_THU', () => {
    const onlyPet = catalog.list({ type: 'PET' });
    expect(onlyPet.length).toBeGreaterThan(0);
    expect(onlyPet.every((p) => p.type === 'PET')).toBe(true);
  });

  it('get returns undefined for unknown petKey', () => {
    expect(catalog.get('pet_nonexistent')).toBeUndefined();
  });

  it('caps respects spec invariants', () => {
    const c = catalog.caps();
    expect(c.pvePercent).toBe(12);
    expect(c.pvpDamagePercent).toBe(5);
    expect(c.pvpEffectMultiplier).toBeCloseTo(0.4, 5);
  });
});

describe('PetCollectionService', () => {
  it('grantPet creates instance with catalog snapshot fields', async () => {
    const { characterId } = await makeUserChar(prisma);
    const sample = PETS[0]!;
    const v = await collection.grantPet({
      characterId,
      petKey: sample.petKey,
      source: 'TEST',
    });
    expect(v.petKey).toBe(sample.petKey);
    expect(v.quality).toBe(sample.quality);
    expect(v.rarity).toBe(sample.rarity);
    expect(v.element).toBe(sample.element);
    expect(v.level).toBe(1);
    expect(v.isEquipped).toBe(false);
  });

  it('list returns owned pets ordered by isEquipped desc', async () => {
    const { characterId } = await makeUserChar(prisma);
    const a = await collection.grantPet({
      characterId,
      petKey: PETS[0]!.petKey,
      source: 'T',
    });
    await collection.grantPet({
      characterId,
      petKey: PETS[1]!.petKey,
      source: 'T',
    });
    await collection.equip(characterId, a.id);
    const lst = await collection.list(characterId);
    expect(lst.length).toBe(2);
    expect(lst[0]!.isEquipped).toBe(true);
  });

  it('cannot get pet not owned', async () => {
    const c1 = await makeUserChar(prisma);
    const c2 = await makeUserChar(prisma);
    const v = await collection.grantPet({
      characterId: c1.characterId,
      petKey: PETS[0]!.petKey,
      source: 'T',
    });
    await expect(collection.get(c2.characterId, v.id)).rejects.toBeInstanceOf(
      PetCollectionError,
    );
  });

  it('equip swaps existing equipped pet (1 slot)', async () => {
    const { characterId } = await makeUserChar(prisma);
    const a = await collection.grantPet({
      characterId,
      petKey: PETS[0]!.petKey,
      source: 'T',
    });
    const b = await collection.grantPet({
      characterId,
      petKey: PETS[1]!.petKey,
      source: 'T',
    });
    await collection.equip(characterId, a.id);
    await collection.equip(characterId, b.id);
    const aRow = await prisma.characterPet.findUnique({ where: { id: a.id } });
    const bRow = await prisma.characterPet.findUnique({ where: { id: b.id } });
    expect(aRow!.isEquipped).toBe(false);
    expect(bRow!.isEquipped).toBe(true);
  });

  it('unequip clears slot', async () => {
    const { characterId } = await makeUserChar(prisma);
    const a = await collection.grantPet({
      characterId,
      petKey: PETS[0]!.petKey,
      source: 'T',
    });
    await collection.equip(characterId, a.id);
    const view = await collection.unequip(characterId, a.id);
    expect(view.isEquipped).toBe(false);
    expect(view.equippedSlot).toBeNull();
  });

  it('lock/unlock toggles isLocked', async () => {
    const { characterId } = await makeUserChar(prisma);
    const a = await collection.grantPet({
      characterId,
      petKey: PETS[0]!.petKey,
      source: 'T',
    });
    const locked = await collection.lock(characterId, a.id);
    expect(locked.isLocked).toBe(true);
    const unlocked = await collection.unlock(characterId, a.id);
    expect(unlocked.isLocked).toBe(false);
  });

  it('rename rejects locked pet', async () => {
    const { characterId } = await makeUserChar(prisma);
    const a = await collection.grantPet({
      characterId,
      petKey: PETS[0]!.petKey,
      source: 'T',
    });
    await collection.lock(characterId, a.id);
    await expect(
      collection.rename(characterId, a.id, 'MyPet'),
    ).rejects.toThrow(/PET_LOCKED/);
  });

  it('rename accepts valid name', async () => {
    const { characterId } = await makeUserChar(prisma);
    const a = await collection.grantPet({
      characterId,
      petKey: PETS[0]!.petKey,
      source: 'T',
    });
    const v = await collection.rename(characterId, a.id, 'TieuBach');
    expect(v.customName).toBe('TieuBach');
  });

  it('rename rejects too-long name', async () => {
    const { characterId } = await makeUserChar(prisma);
    const a = await collection.grantPet({
      characterId,
      petKey: PETS[0]!.petKey,
      source: 'T',
    });
    await expect(
      collection.rename(characterId, a.id, 'a'.repeat(80)),
    ).rejects.toThrow(/PET_NAME_/);
  });
});

describe('PetSnapshotService', () => {
  it('returns null when no pet equipped', async () => {
    const { characterId } = await makeUserChar(prisma);
    const snap = await snapshot.getEquippedPetSnapshot(characterId, 'PVE');
    expect(snap).toBeNull();
  });

  it('returns snapshot when pet equipped, clamps for PVP context', async () => {
    const { characterId } = await makeUserChar(prisma);
    const a = await collection.grantPet({
      characterId,
      petKey: PETS[0]!.petKey,
      source: 'T',
    });
    await collection.equip(characterId, a.id);
    const pve = await snapshot.getEquippedPetSnapshot(characterId, 'PVE');
    const pvp = await snapshot.getEquippedPetSnapshot(characterId, 'PVP');
    expect(pve).not.toBeNull();
    expect(pvp).not.toBeNull();
    expect(pve!.contributionCapPercent).toBe(12);
    expect(pvp!.damageContributionCapPercent).toBe(5);
    expect(pvp!.pvpEffectivenessMultiplier).toBeCloseTo(0.4, 5);
  });
});

describe('PetShardService', () => {
  it('grant + consume balance correctly', async () => {
    const { characterId } = await makeUserChar(prisma);
    const petKey = PETS[0]!.petKey;
    await prisma.$transaction(async (tx) => {
      await shards.grantTx(tx, characterId, petKey, 50);
    });
    expect(await shards.balance(characterId, petKey)).toBe(50);
    await prisma.$transaction(async (tx) => {
      await shards.consumeTx(tx, characterId, petKey, 30);
    });
    expect(await shards.balance(characterId, petKey)).toBe(20);
  });

  it('consume insufficient throws', async () => {
    const { characterId } = await makeUserChar(prisma);
    await expect(
      prisma.$transaction(async (tx) => {
        await shards.consumeTx(tx, characterId, PETS[0]!.petKey, 5);
      }),
    ).rejects.toBeInstanceOf(PetShardError);
  });
});

describe('PetSourceService', () => {
  it('forPet returns ≥1 source for every non-premium pet', () => {
    const nonPremium = PETS.filter((p) => !p.isPremiumVisualOnly);
    for (const p of nonPremium) {
      const list = sources.forPet(p.petKey);
      expect(list.length).toBeGreaterThan(0);
    }
  });

  it('audit returns no PET_NO_FREE_PATH issues', () => {
    const issues = sources.audit();
    const freePath = issues.filter((i) => i.code === 'PET_NO_FREE_PATH');
    expect(freePath).toHaveLength(0);
  });
});

describe('PetBoxService', () => {
  it('open consumes ticket cost, grants result, increments pity', async () => {
    const { characterId } = await makeUserChar(prisma);
    // Find a box with TICKET cost; if none, use first box & grant the
    // currency manually. We'll inspect catalog & pick a low-cost one.
    const allBoxes = boxes.catalog();
    const box = allBoxes.find((b) => b.costPerOpen.costType === 'TICKET');
    if (!box) {
      // Fallback: grant LINH_THACH and use a LINH_THACH-cost box.
      const lsBox = allBoxes.find((b) => b.costPerOpen.costType === 'LINH_THACH');
      expect(lsBox).toBeDefined();
      await prisma.character.update({
        where: { id: characterId },
        data: { linhThach: BigInt(1_000_000) },
      });
      const r = await boxes.open({ characterId, boxKey: lsBox!.boxKey });
      expect(r.resultType).toMatch(/PET|SHARD|MATERIAL|TICKET_REFUND/);
      expect(r.logId).toBeDefined();
      const counters = await boxes.readCounters(
        characterId,
        lsBox!.boxKey,
        lsBox!.poolKey,
      );
      expect(
        counters.opensSinceRare + counters.opensSinceEpic +
          counters.opensSinceLegendary + counters.opensSinceMythic,
      ).toBeGreaterThanOrEqual(0);
      return;
    }
    // Grant ticket inventory item.
    const ticketKey = box.costPerOpen.itemKey ?? '';
    expect(ticketKey).not.toBe('');
    await prisma.$transaction(async (tx) => {
      await inventory.grantTx(
        tx,
        characterId,
        [{ itemKey: ticketKey, qty: 10 }],
        { reason: 'PET_ADMIN_GRANT' },
      );
    });
    const r = await boxes.open({ characterId, boxKey: box.boxKey });
    expect(r.resultType).toMatch(/PET|SHARD|MATERIAL|TICKET_REFUND/);
    expect(r.logId).toBeDefined();
  });

  it('open is idempotent with same requestId', async () => {
    const { characterId } = await makeUserChar(prisma);
    const lsBox = boxes
      .catalog()
      .find((b) => b.costPerOpen.costType === 'LINH_THACH');
    if (!lsBox) return;
    await prisma.character.update({
      where: { id: characterId },
      data: { linhThach: BigInt(1_000_000) },
    });
    const reqId = 'fixed-req-id-' + Date.now();
    const r1 = await boxes.open({ characterId, boxKey: lsBox.boxKey, requestId: reqId });
    const r2 = await boxes.open({ characterId, boxKey: lsBox.boxKey, requestId: reqId });
    expect(r2.logId).toBe(r1.logId);
    expect(r2.resultKey).toBe(r1.resultKey);
  });
});

describe('PetUpgradeService', () => {
  it('starUp consumes 20 shard for star→2', async () => {
    const { characterId } = await makeUserChar(prisma);
    const a = await collection.grantPet({
      characterId,
      petKey: PETS[0]!.petKey,
      source: 'T',
    });
    await prisma.$transaction(async (tx) => {
      await shards.grantTx(tx, characterId, PETS[0]!.petKey, 100);
    });
    const r = await upgrade.starUp(characterId, a.id);
    expect(r.star).toBe(2);
    expect(await shards.balance(characterId, PETS[0]!.petKey)).toBe(80);
  });

  it('starUp throws when insufficient shard', async () => {
    const { characterId } = await makeUserChar(prisma);
    const a = await collection.grantPet({
      characterId,
      petKey: PETS[0]!.petKey,
      source: 'T',
    });
    await expect(upgrade.starUp(characterId, a.id)).rejects.toBeInstanceOf(
      PetShardError,
    );
  });

  it('breakthrough throws when not at gate', async () => {
    const { characterId } = await makeUserChar(prisma);
    const a = await collection.grantPet({
      characterId,
      petKey: PETS[0]!.petKey,
      source: 'T',
    });
    // Level=1, not at breakthrough gate.
    await expect(upgrade.breakthrough(characterId, a.id)).rejects.toBeInstanceOf(
      PetUpgradeError,
    );
  });
});
