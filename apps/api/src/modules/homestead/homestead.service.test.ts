import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { WorldCapService } from '../world-content/world-cap.service';
import { CharacterService } from '../character/character.service';
import { RealtimeService } from '../realtime/realtime.service';
import { makeUserChar, wipeAll } from '../../test-helpers';
import { HomesteadError, HomesteadService } from './homestead.service';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

const remoteConfig = {
  getValue: vi.fn(async () => ({
    energyRegenPerHourMultiplier: 1,
    fieldGrowthMinutesMultiplier: 1,
    gardenDurationMinutesMultiplier: 1,
    dailyCapMultiplier: 1,
    upgradeCostMultiplier: 1,
  })),
};

let prisma: PrismaService;
let svc: HomesteadService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new HomesteadService(
    prisma,
    new CurrencyService(prisma),
    new InventoryService(prisma, new RealtimeService(), new CharacterService(prisma, new RealtimeService())),
    new WorldCapService(prisma),
    remoteConfig as never,
  );
});

beforeEach(async () => {
  remoteConfig.getValue.mockClear();
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('HomesteadService', () => {
  it('creates default homestead lazily', async () => {
    const { characterId } = await makeUserChar(prisma);
    const view = await svc.getOverview(characterId, new Date('2026-01-01T00:00:00.000Z'));
    expect(view.homestead.level).toBe(1);
    expect(view.homestead.fieldSlots).toBe(2);
    expect(view.homestead.gardenSlots).toBe(1);
  });

  it('upgrades when realm, currency, and spiritual energy meet requirements', async () => {
    const { characterId } = await makeUserChar(prisma, {
      realmKey: 'luyenkhi',
      linhThach: 10_000n,
    });
    const result = await svc.upgrade(characterId, new Date('2026-01-01T00:00:00.000Z'));
    expect(result.fromLevel).toBe(1);
    expect(result.toLevel).toBe(2);
    const ledger = await prisma.currencyLedger.findFirst({ where: { characterId } });
    expect(ledger?.reason).toBe('HOMESTEAD_UPGRADE');
  });

  it('plants a crop and blocks harvest before ready time', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const { characterId } = await makeUserChar(prisma);
    const slot = await svc.plantField(characterId, { slotIndex: 0, cropKey: 'linh_thao_mam' }, now);
    expect(slot.state).toBe('GROWING');
    await expect(svc.harvestField(characterId, { slotIndex: 0 }, now)).rejects.toMatchObject({
      code: 'NOT_READY',
    });
  });

  it('harvests only once and grants via ItemLedger', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const later = new Date('2026-01-01T01:00:00.000Z');
    const { characterId } = await makeUserChar(prisma);
    await svc.plantField(characterId, { slotIndex: 0, cropKey: 'linh_thao_mam' }, now);
    const result = await svc.harvestField(characterId, { slotIndex: 0 }, later);
    expect(result.qty).toBe(2);
    await expect(svc.harvestField(characterId, { slotIndex: 0 }, later)).rejects.toBeInstanceOf(
      HomesteadError,
    );
    const item = await prisma.inventoryItem.findFirst({
      where: { characterId, itemKey: 'linh_thao' },
    });
    expect(item?.qty).toBe(2);
    const ledger = await prisma.itemLedger.findFirst({ where: { characterId } });
    expect(ledger?.reason).toBe('HOMESTEAD_FIELD_HARVEST');
  });

  it('does not duplicate reward under spam harvest', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const later = new Date('2026-01-01T01:00:00.000Z');
    const { characterId } = await makeUserChar(prisma);
    await svc.plantField(characterId, { slotIndex: 0, cropKey: 'linh_thao_mam' }, now);
    const results = await Promise.allSettled([
      svc.harvestField(characterId, { slotIndex: 0 }, later),
      svc.harvestField(characterId, { slotIndex: 0 }, later),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const item = await prisma.inventoryItem.findFirst({
      where: { characterId, itemKey: 'linh_thao' },
    });
    expect(item?.qty).toBe(2);
  });

  it('enforces daily cap on field harvests', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const later = new Date('2026-01-01T01:00:00.000Z');
    const { characterId } = await makeUserChar(prisma);
    await svc.getOverview(characterId, now);
    await prisma.homestead.update({
      where: { characterId },
      data: { spiritualEnergy: 120 },
    });
    for (let i = 0; i < 12; i += 1) {
      await svc.plantField(characterId, { slotIndex: 0, cropKey: 'linh_thao_mam' }, now);
      await svc.harvestField(characterId, { slotIndex: 0 }, later);
    }
    await svc.plantField(characterId, { slotIndex: 0, cropKey: 'linh_thao_mam' }, now);
    await expect(svc.harvestField(characterId, { slotIndex: 0 }, later)).rejects.toMatchObject({
      code: 'DAILY_CAP_REACHED',
    });
  });

  it('caps offline spiritual energy at storage cap', async () => {
    const { characterId } = await makeUserChar(prisma);
    await svc.getOverview(characterId, new Date('2026-01-01T00:00:00.000Z'));
    const view = await svc.getOverview(characterId, new Date('2026-01-02T00:00:00.000Z'));
    expect(view.homestead.spiritualEnergy).toBe(120);
  });

  it('blocks production above realm tier', async () => {
    const { characterId } = await makeUserChar(prisma, { realmKey: 'luyenkhi' });
    await expect(
      svc.plantField(characterId, { slotIndex: 0, cropKey: 'huyet_tinh_dang' }),
    ).rejects.toMatchObject({ code: 'HOMESTEAD_LEVEL_TOO_LOW' });
  });

  it('starts and claims garden production through capped inventory grant', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const later = new Date('2026-01-01T02:00:00.000Z');
    const { characterId } = await makeUserChar(prisma);
    await svc.startGarden(characterId, { slotIndex: 0, productionKey: 'tinh_thiet_loc' }, now);
    const result = await svc.claimGarden(characterId, { slotIndex: 0 }, later);
    expect(result.itemKey).toBe('tinh_thiet');
    const ledger = await prisma.itemLedger.findFirst({ where: { characterId } });
    expect(ledger?.reason).toBe('HOMESTEAD_GARDEN_CLAIM');
  });
});
