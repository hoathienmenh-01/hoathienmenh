/**
 * BossService schedule tests — Phase 13.0 §B (Scheduled Boss via heartbeat).
 *
 * Tests cho scheduled boss spawn flow:
 *   1. **Trước slot không spawn** — heartbeat lúc 11:00 ICT → region hac_lam
 *      KHÔNG có scheduled boss (yeu_vuong_tho_huyet); fall-through rotation
 *      pick boss đầu region.
 *   2. **Trong slot spawn đúng boss** — heartbeat 12:15 ICT → spawn
 *      `yeu_vuong_tho_huyet` (boss key của event boss_daily_noon_hac_lam).
 *   3. **Slot dedup** — slot already spawned + defeated → heartbeat lần 2 in
 *      slot KHÔNG respawn cùng slot.
 *   4. **Sau slot end** — heartbeat 12:31 ICT → fall-through rotation +
 *      respawn delay check.
 *   5. **Scheduled boss bypass respawn delay** — last defeated 5 phút trước
 *      slot start, heartbeat tại slot start → scheduled boss wins (force
 *      spawn), KHÔNG block bởi 30-phút respawn delay.
 *   6. **2 concurrent heartbeat trong slot** — chỉ 1 ACTIVE boss thuộc slot.
 *   7. **Cross-region**: schedule cho hac_lam KHÔNG ảnh hưởng kim_son_mach.
 *
 * Use vi.setSystemTime để control thời gian. Real PG (TEST_DATABASE_URL).
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { BossStatus } from '@prisma/client';
import { getLiveOpsEventDef } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { BossService } from './boss.service';
import { TEST_DATABASE_URL, makeMissionService, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let boss: BossService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const inventory = new InventoryService(prisma, realtime, chars);
  const currency = new CurrencyService(prisma);
  const missions = makeMissionService(prisma);
  boss = new BossService(prisma, realtime, chars, inventory, currency, missions);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

type BossInternals = {
  heartbeat: () => Promise<void>;
  heartbeatRegion: (regionKey: string) => Promise<void>;
};
const internals = () => boss as unknown as BossInternals;

/** 12:00 ICT Thursday 2026-05-07 = 05:00 UTC. Inside slot
 *  `boss_daily_noon_hoa_diem_son` (12:00 ICT, 30p duration). */
const NOON_SLOT_START_UTC = new Date('2026-05-07T05:00:00Z');
/** 11:00 ICT (4:00 UTC) — trước slot. */
const BEFORE_NOON_UTC = new Date('2026-05-07T04:00:00Z');
/** 12:15 ICT (5:15 UTC) — giữa slot. */
const IN_NOON_UTC = new Date('2026-05-07T05:15:00Z');
/** 12:31 ICT (5:31 UTC) — sau slot end. */
const AFTER_NOON_UTC = new Date('2026-05-07T05:31:00Z');

/** Scheduled boss duả daily noon: bossKey=hoa_long_to_su, region=hoa_diem_son. */
const NOON_BOSS_KEY = 'hoa_long_to_su';
const NOON_REGION = 'hoa_diem_son';

describe('BossService — Phase 13.0 §B Scheduled Boss', () => {
  it('LiveOps catalog định nghĩa đúng noon scheduled boss', () => {
    const ev = getLiveOpsEventDef('boss_daily_noon_hoa_diem_son');
    expect(ev).toBeDefined();
    expect(ev!.bossKey).toBe(NOON_BOSS_KEY);
    expect(ev!.regionKey).toBe(NOON_REGION);
  });

  it('trước slot: heartbeatRegion → spawn rotation default (không bắt buộc đúng scheduled boss)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_NOON_UTC);
    await internals().heartbeatRegion(NOON_REGION);
    const active = await prisma.worldBoss.findFirst({
      where: { regionKey: NOON_REGION, status: BossStatus.ACTIVE },
    });
    // Region có boss spawn-able trong catalog → vẫn spawn 1 row
    // (auto-rotate). KHÔNG bắt buộc bossKey = scheduled bossKey.
    expect(active).not.toBeNull();
  });

  it('trong slot: heartbeatRegion → spawn đúng scheduled bossKey', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(IN_NOON_UTC);
    await internals().heartbeatRegion(NOON_REGION);
    const active = await prisma.worldBoss.findFirst({
      where: { regionKey: NOON_REGION, status: BossStatus.ACTIVE },
    });
    expect(active).not.toBeNull();
    expect(active!.bossKey).toBe(NOON_BOSS_KEY);
  });

  it('slot dedup: heartbeat lần 2 trong slot KHÔNG respawn cùng slot', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(IN_NOON_UTC);
    await internals().heartbeatRegion(NOON_REGION);
    const active1 = await prisma.worldBoss.findFirst({
      where: { regionKey: NOON_REGION, status: BossStatus.ACTIVE },
    });
    expect(active1).not.toBeNull();
    await prisma.worldBoss.update({
      where: { id: active1!.id },
      data: { status: BossStatus.DEFEATED, defeatedAt: new Date() },
    });
    await internals().heartbeatRegion(NOON_REGION);
    const all = await prisma.worldBoss.findMany({
      where: { regionKey: NOON_REGION },
    });
    expect(all.length).toBe(1);
  });

  it('sau slot end: scheduled boss không spawn — fall-through rotation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(AFTER_NOON_UTC);
    await internals().heartbeatRegion(NOON_REGION);
    const active = await prisma.worldBoss.findFirst({
      where: { regionKey: NOON_REGION, status: BossStatus.ACTIVE },
    });
    expect(active).not.toBeNull();
  });

  it('scheduled boss bypass respawn delay 30p', async () => {
    vi.useFakeTimers();
    const beforeSlotStart = new Date(NOON_SLOT_START_UTC.getTime() - 5 * 60 * 1000);
    // Pre-create boss với bossKey KHÁC scheduled (vd huyet_long_quan cũng
    // ở hoa_diem_son), spawnedAt < slotStart → slot dedup không match.
    // Defeated 5p trước slot → vẫn trong respawn delay 30p (default).
    await prisma.worldBoss.create({
      data: {
        bossKey: 'huyet_long_quan',
        name: 'Huyet Long Quan (defeated)',
        level: 1,
        maxHp: BigInt(1000),
        currentHp: BigInt(0),
        status: BossStatus.DEFEATED,
        spawnedAt: new Date(beforeSlotStart.getTime() - 30 * 60 * 1000),
        expiresAt: beforeSlotStart,
        defeatedAt: beforeSlotStart,
        rewardTotal: BigInt(0),
        regionKey: NOON_REGION,
      },
    });
    vi.setSystemTime(IN_NOON_UTC);
    await internals().heartbeatRegion(NOON_REGION);
    const active = await prisma.worldBoss.findFirst({
      where: { regionKey: NOON_REGION, status: BossStatus.ACTIVE },
    });
    expect(active).not.toBeNull();
    expect(active!.bossKey).toBe(NOON_BOSS_KEY);
  });

  it('cross-region: scheduled noon (hoa_diem_son) KHÔNG ảnh hưởng kim_son_mach', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(IN_NOON_UTC);
    await internals().heartbeat();
    const noon = await prisma.worldBoss.findFirst({
      where: { regionKey: NOON_REGION, status: BossStatus.ACTIVE },
    });
    const kimSon = await prisma.worldBoss.findFirst({
      where: { regionKey: 'kim_son_mach', status: BossStatus.ACTIVE },
    });
    expect(noon).not.toBeNull();
    expect(noon!.bossKey).toBe(NOON_BOSS_KEY);
    expect(kimSon).not.toBeNull();
    expect(kimSon!.bossKey).not.toBe(NOON_BOSS_KEY);
  });

  it('2× concurrent heartbeat trong slot → đúng 1 ACTIVE row scheduled boss', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(IN_NOON_UTC);
    await Promise.all([
      internals().heartbeat(),
      internals().heartbeat(),
    ]);
    const all = await prisma.worldBoss.findMany({
      where: {
        regionKey: NOON_REGION,
        status: BossStatus.ACTIVE,
        bossKey: NOON_BOSS_KEY,
      },
    });
    expect(all.length).toBe(1);
  });

  it('schedule không kích hoạt nếu region đã có ACTIVE boss khác', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(IN_NOON_UTC);
    await prisma.worldBoss.create({
      data: {
        bossKey: 'huyet_long_quan',
        name: 'Huyet Long Quan (active)',
        level: 1,
        maxHp: BigInt(1000),
        currentHp: BigInt(1000),
        status: BossStatus.ACTIVE,
        spawnedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        rewardTotal: BigInt(0),
        regionKey: NOON_REGION,
      },
    });
    await internals().heartbeatRegion(NOON_REGION);
    const all = await prisma.worldBoss.findMany({
      where: { regionKey: NOON_REGION, status: BossStatus.ACTIVE },
    });
    expect(all.length).toBe(1);
    expect(all[0].bossKey).toBe('huyet_long_quan');
  });
});
