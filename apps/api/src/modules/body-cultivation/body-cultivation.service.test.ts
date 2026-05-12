import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BODY_CULTIVATION_INJURY_MS,
  computeBodyBreakthroughRequirement,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  BodyCultivationError,
  BodyCultivationService,
} from './body-cultivation.service';

let prisma: PrismaService;
let service: BodyCultivationService;
let inventory: InventoryService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  inventory = new InventoryService(prisma, realtime, chars);
  service = new BodyCultivationService(prisma, realtime, inventory, chars);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('BodyCultivationService', () => {
  it('returns Phàm Thân defaults for a fresh character', async () => {
    const f = await makeUserChar(prisma);

    const status = await service.getStatus(f.userId);

    expect(status.bodyRealmKey).toBe('pham_than');
    expect(status.bodyStage).toBe(1);
    expect(status.bodyExp).toBe('0');
    expect(status.bodyCultivating).toBe(false);
    expect(status.breakthroughRequirement?.materials[0]?.itemKey).toBe(
      'khi_huyet_thao',
    );
  });

  it('toggles bodyCultivating without granting currencies', async () => {
    const f = await makeUserChar(prisma, {
      linhThach: 0n,
      tienNgoc: 0,
    });

    const started = await service.setBodyCultivating(f.userId, true);
    const stopped = await service.setBodyCultivating(f.userId, false);
    const c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });

    expect(started.bodyCultivating).toBe(true);
    expect(stopped.bodyCultivating).toBe(false);
    expect(c.linhThach).toBe(0n);
    expect(c.tienNgoc).toBe(0);
  });

  it('gates breakthrough when not at peak, missing exp, materials, or Qi realm', async () => {
    const notPeak = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      bodyRealmKey: 'pham_than',
      bodyStage: 1,
    });
    await expect(service.attemptBreakthrough(notPeak.userId)).rejects.toMatchObject(
      { code: 'INSUFFICIENT_EXP' },
    );

    const req = computeBodyBreakthroughRequirement(0, 1);
    const noMaterial = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      bodyRealmKey: 'pham_than',
      bodyStage: 1,
      bodyExp: req.bodyExpCost,
    });
    await expect(service.attemptBreakthrough(noMaterial.userId)).rejects.toMatchObject(
      { code: 'MISSING_MATERIALS' },
    );

    const qiGate = await makeUserChar(prisma, {
      realmKey: 'phamnhan',
      bodyRealmKey: 'luyen_bi',
      bodyStage: 9,
      bodyExp: computeBodyBreakthroughRequirement(1, 2).bodyExpCost,
    });
    await expect(service.attemptBreakthrough(qiGate.userId)).rejects.toMatchObject(
      { code: 'QI_GATE' },
    );
  });

  it('consumes material transactionally, advances realm, and writes attempt log on success', async () => {
    const req = computeBodyBreakthroughRequirement(0, 1);
    const f = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      bodyRealmKey: 'pham_than',
      bodyStage: 1,
      bodyExp: req.bodyExpCost,
      linhThach: 0n,
      tienNgoc: 0,
    });
    await inventory.grant(f.characterId, [...req.materials], {
      reason: 'ADMIN_GRANT',
      refType: 'Test',
      refId: f.characterId,
    });

    const result = await service.attemptBreakthrough(
      f.userId,
      () => 0,
      new Date('2026-01-01T00:00:00.000Z'),
    );

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    const logs = await prisma.bodyBreakthroughAttemptLog.findMany({
      where: { characterId: f.characterId },
    });
    const remaining = await prisma.inventoryItem.findMany({
      where: { characterId: f.characterId },
    });

    expect(result.success).toBe(true);
    expect(c.bodyRealmKey).toBe('luyen_bi');
    expect(c.bodyStage).toBe(1);
    expect(c.bodyExp).toBe(0n);
    expect(c.linhThach).toBe(0n);
    expect(c.tienNgoc).toBe(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.success).toBe(true);
    expect(remaining).toHaveLength(0);
  });

  it('records failed breakthrough injury and consumes materials once', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const req = computeBodyBreakthroughRequirement(0, 1);
    const f = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      bodyRealmKey: 'pham_than',
      bodyStage: 1,
      bodyExp: req.bodyExpCost,
    });
    await inventory.grant(f.characterId, [...req.materials], {
      reason: 'ADMIN_GRANT',
      refType: 'Test',
      refId: f.characterId,
    });

    const result = await service.attemptBreakthrough(f.userId, () => 1, now);

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    const log = await prisma.bodyBreakthroughAttemptLog.findFirstOrThrow({
      where: { characterId: f.characterId },
    });
    expect(result.success).toBe(false);
    expect(c.bodyRealmKey).toBe('pham_than');
    expect(c.bodyExp).toBe(req.bodyExpCost - req.bodyExpCost / 4n);
    expect(c.bodyInjuryUntil?.toISOString()).toBe(
      new Date(now.getTime() + BODY_CULTIVATION_INJURY_MS).toISOString(),
    );
    expect(log.success).toBe(false);
    expect(log.injuryUntil?.toISOString()).toBe(c.bodyInjuryUntil?.toISOString());
  });

  it('rolls back log and character update if material consume races after precheck', async () => {
    const req = computeBodyBreakthroughRequirement(0, 1);
    const f = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      bodyRealmKey: 'pham_than',
      bodyStage: 1,
      bodyExp: req.bodyExpCost,
    });
    await inventory.grant(f.characterId, [...req.materials], {
      reason: 'ADMIN_GRANT',
      refType: 'Test',
      refId: f.characterId,
    });
    const originalConsume = inventory.consumeOneByItemKeyTx.bind(inventory);
    let first = true;
    inventory.consumeOneByItemKeyTx = async (...args) => {
      if (first) {
        first = false;
        await prisma.inventoryItem.deleteMany({
          where: { characterId: f.characterId, itemKey: req.materials[0]!.itemKey },
        });
      }
      return originalConsume(...args);
    };

    await expect(service.attemptBreakthrough(f.userId, () => 0)).rejects.toThrow(
      'INVENTORY_ITEM_NOT_FOUND',
    );

    const c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    const logCount = await prisma.bodyBreakthroughAttemptLog.count({
      where: { characterId: f.characterId },
    });
    expect(c.bodyRealmKey).toBe('pham_than');
    expect(c.bodyExp).toBe(req.bodyExpCost);
    expect(logCount).toBe(0);
  });

  it('concurrent breakthrough attempts leave only one successful mutation', async () => {
    const req = computeBodyBreakthroughRequirement(0, 1);
    const f = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      bodyRealmKey: 'pham_than',
      bodyStage: 1,
      bodyExp: req.bodyExpCost,
    });
    await inventory.grant(
      f.characterId,
      req.materials.map((m) => ({ ...m, qty: m.qty * 2 })),
      {
        reason: 'ADMIN_GRANT',
        refType: 'Test',
        refId: f.characterId,
      },
    );

    const outcomes = await Promise.allSettled([
      service.attemptBreakthrough(f.userId, () => 0),
      service.attemptBreakthrough(f.userId, () => 0),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter(
      (o): o is PromiseRejectedResult => o.status === 'rejected',
    );
    const c = await prisma.character.findUniqueOrThrow({
      where: { id: f.characterId },
    });
    const logCount = await prisma.bodyBreakthroughAttemptLog.count({
      where: { characterId: f.characterId },
    });

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(BodyCultivationError);
    expect((rejected[0]?.reason as BodyCultivationError).code).toBe(
      'CONCURRENT_ATTEMPT',
    );
    expect(c.bodyRealmKey).toBe('luyen_bi');
    expect(logCount).toBe(1);
  });
});
