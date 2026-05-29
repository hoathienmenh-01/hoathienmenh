import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { EntitlementService } from './entitlement.service';

let prisma: PrismaService;
let entitlements: EntitlementService;

const NOW = new Date('2026-05-29T12:00:00.000Z');

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  entitlements = new EntitlementService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('EntitlementService.getActiveEntitlements', () => {
  it('returns empty array for fresh character', async () => {
    const f = await makeUserChar(prisma);
    const list = await entitlements.getActiveEntitlements(f.characterId, NOW);
    expect(list).toEqual([]);
  });

  it('returns non-expired entitlements', async () => {
    const f = await makeUserChar(prisma);
    await entitlements.grantEntitlement({
      characterId: f.characterId,
      key: 'INVENTORY_SLOT_BONUS',
      value: 1,
      durationDays: 30,
      source: 'TEST',
      now: NOW,
    });
    const list = await entitlements.getActiveEntitlements(f.characterId, NOW);
    expect(list).toHaveLength(1);
    expect(list[0].key).toBe('INVENTORY_SLOT_BONUS');
  });

  it('excludes expired entitlements', async () => {
    const f = await makeUserChar(prisma);
    await entitlements.grantEntitlement({
      characterId: f.characterId,
      key: 'INVENTORY_SLOT_BONUS',
      value: 1,
      durationDays: 1,
      source: 'TEST',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    const list = await entitlements.getActiveEntitlements(f.characterId, NOW);
    expect(list).toEqual([]);
  });
});

describe('EntitlementService.hasEntitlement', () => {
  it('returns false when no entitlement', async () => {
    const f = await makeUserChar(prisma);
    const has = await entitlements.hasEntitlement(f.characterId, 'INVENTORY_SLOT_BONUS', NOW);
    expect(has).toBe(false);
  });

  it('returns true when entitlement is active', async () => {
    const f = await makeUserChar(prisma);
    await entitlements.grantEntitlement({
      characterId: f.characterId,
      key: 'INVENTORY_SLOT_BONUS',
      value: 5,
      durationDays: 30,
      source: 'TEST',
      now: NOW,
    });
    const has = await entitlements.hasEntitlement(f.characterId, 'INVENTORY_SLOT_BONUS', NOW);
    expect(has).toBe(true);
  });
});

describe('EntitlementService.getEntitlementValue', () => {
  it('returns 0 when no entitlement', async () => {
    const f = await makeUserChar(prisma);
    const val = await entitlements.getEntitlementValue(f.characterId, 'INVENTORY_SLOT_BONUS', NOW);
    expect(val).toBe(0);
  });

  it('returns value of active entitlement', async () => {
    const f = await makeUserChar(prisma);
    await entitlements.grantEntitlement({
      characterId: f.characterId,
      key: 'INVENTORY_SLOT_BONUS',
      value: 42,
      durationDays: 30,
      source: 'TEST',
      now: NOW,
    });
    const val = await entitlements.getEntitlementValue(f.characterId, 'INVENTORY_SLOT_BONUS', NOW);
    expect(val).toBe(42);
  });
});

describe('EntitlementService.grantEntitlement', () => {
  it('creates entitlement row with correct expiry', async () => {
    const f = await makeUserChar(prisma);
    await entitlements.grantEntitlement({
      characterId: f.characterId,
      key: 'ALCHEMY_QUEUE_SLOT',
      value: 7,
      durationDays: 10,
      source: 'TEST_GRANT',
      now: NOW,
    });
    const row = await prisma.premiumEntitlement.findFirst({
      where: { characterId: f.characterId, entitlementKey: 'ALCHEMY_QUEUE_SLOT' },
    });
    expect(row).not.toBeNull();
    expect(row?.expiresAt?.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('stacks duration on existing entitlement (same key)', async () => {
    const f = await makeUserChar(prisma);
    await entitlements.grantEntitlement({
      characterId: f.characterId,
      key: 'INVENTORY_SLOT_BONUS',
      value: 1,
      durationDays: 10,
      source: 'TEST',
      now: NOW,
    });
    const first = await prisma.premiumEntitlement.findFirst({
      where: { characterId: f.characterId, entitlementKey: 'INVENTORY_SLOT_BONUS' },
    });
    expect(first).not.toBeNull();
    const firstExpiry = first!.expiresAt!;

    await entitlements.grantEntitlement({
      characterId: f.characterId,
      key: 'INVENTORY_SLOT_BONUS',
      value: 1,
      durationDays: 5,
      source: 'TEST',
      now: NOW,
    });
    const second = await prisma.premiumEntitlement.findFirst({
      where: { characterId: f.characterId, entitlementKey: 'INVENTORY_SLOT_BONUS' },
    });
    expect(second).not.toBeNull();
    expect(second!.expiresAt!.getTime()).toBeGreaterThanOrEqual(firstExpiry.getTime());
    const count = await prisma.premiumEntitlement.count({
      where: { characterId: f.characterId, entitlementKey: 'INVENTORY_SLOT_BONUS' },
    });
    expect(count).toBe(1);
  });
});

describe('EntitlementService.grantEntitlementTx', () => {
  it('grants entitlement inside a transaction', async () => {
    const f = await makeUserChar(prisma);
    await prisma.$transaction((tx) =>
      entitlements.grantEntitlementTx(tx, {
        characterId: f.characterId,
        key: 'SWEEP_TICKET_DAILY',
        value: 3,
        durationDays: 7,
        source: 'TX_TEST',
        now: NOW,
      }),
    );
    const row = await prisma.premiumEntitlement.findFirst({
      where: { characterId: f.characterId, entitlementKey: 'SWEEP_TICKET_DAILY' },
    });
    expect(row).not.toBeNull();
  });
});
