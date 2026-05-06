/**
 * BossService region-isolation tests — Phase 12.6 (boss-by-region
 * auto-spawn). Build trên top of `boss.service.concurrency.test.ts`
 * (cùng-region race). Phase 12.6 đổi semantic global "≤1 ACTIVE" thành
 * "≤1 ACTIVE per region" qua partial unique index
 * `WorldBoss_status_region_active_unique` (migration
 * `20260523000000_phase_12_6_world_boss_region_key`).
 *
 * Test surface:
 *
 *   1. **Cross-region isolation** — concurrent `spawnNew(regionA)` +
 *      `spawnNew(regionB)` → cả 2 thành công, 2 ACTIVE rows ở 2 region
 *      khác (KHÔNG conflict trên partial unique).
 *
 *   2. **Heartbeat loop spawns missing regions** — start với DB blank,
 *      gọi `heartbeat()` 1 lần → mỗi region trong `bossSpawnRegions()`
 *      nhận đúng 1 ACTIVE row.
 *
 *   3. **Heartbeat skip region đã có ACTIVE** — pre-create 1 ACTIVE ở
 *      region A, gọi heartbeat → region A giữ nguyên (không bị flip
 *      hoặc spawn thêm), region khác mới spawn.
 *
 *   4. **adminSpawn(regionKey) per-region isolation** — admin force
 *      spawn region A KHÔNG ảnh hưởng region B's ACTIVE.
 *
 *   5. **adminSpawn validate def.regionKey vs opts.regionKey mismatch**
 *      — bossKey thuộc region X + regionKey=Y → INVALID_BOSS_KEY.
 *
 *   6. **listActive() returns all regions sorted** — sau heartbeat
 *      multi-region, `listActive(viewerCharId)` trả về list sorted.
 *
 *   7. **getCurrentByRegion() filter chính xác** — region A có ACTIVE
 *      → trả về row đó; region B trống → null.
 *
 * Use real PG (`TEST_DATABASE_URL`) — KHÔNG mock prisma. Partial unique
 * index ở DB là authoritative guard.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BossStatus } from '@prisma/client';
import {
  BOSSES,
  WORLD_BOSS_REGION_KEY,
  bossSpawnRegions,
  bossesByRegion,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { BossError, BossService } from './boss.service';
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

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Truy cập private `heartbeat` / `spawnNew` của BossService — pattern
 * private-cast khớp với `boss.service.test.ts:37` (cooldowns clear).
 */
type BossInternals = {
  heartbeat: () => Promise<void>;
  spawnNew: (overrides?: {
    level?: number;
    regionKey?: string;
  }) => Promise<{
    id: string;
    bossKey: string;
    level: number;
    maxHp: bigint;
    regionKey: string;
  } | null>;
};
const internals = () => boss as unknown as BossInternals;

/**
 * Pick 2 region keys khác nhau từ catalog cho cross-region test. Phase
 * 12.6 catalog có ≥2 region (ngoài 'world'); nếu 1 trong 2 không có
 * boss spawn-able thì skip. Determinstic: lấy 2 region đầu tiên trong
 * `bossSpawnRegions()` mà mỗi region có ≥1 boss.
 */
function pickTwoRegions(): { a: string; b: string } {
  const regions = bossSpawnRegions().filter(
    (r) => bossesByRegion(r).length > 0,
  );
  if (regions.length < 2) {
    throw new Error(
      `pickTwoRegions: catalog không có ≥2 spawn-able region (got ${regions.length}: ${regions.join(', ')})`,
    );
  }
  return { a: regions[0], b: regions[1] };
}

describe('BossService — Phase 12.6 region isolation', () => {
  // ─────────────────────────────────────────────────────────────────────
  // Test 1 — Cross-region concurrent spawn
  // ─────────────────────────────────────────────────────────────────────
  it('concurrent spawnNew(regionA) + spawnNew(regionB) → cả 2 thành công, 2 ACTIVE rows ở 2 region khác', async () => {
    const { a, b } = pickTwoRegions();
    const [resA, resB] = await Promise.all([
      internals().spawnNew({ regionKey: a }),
      internals().spawnNew({ regionKey: b }),
    ]);
    expect(resA).not.toBeNull();
    expect(resB).not.toBeNull();
    expect(resA?.regionKey).toBe(a);
    expect(resB?.regionKey).toBe(b);

    const all = await prisma.worldBoss.findMany({
      where: { status: BossStatus.ACTIVE },
      orderBy: { regionKey: 'asc' },
    });
    expect(all.length).toBe(2);
    const regionsActive = new Set(all.map((r) => r.regionKey));
    expect(regionsActive.has(a)).toBe(true);
    expect(regionsActive.has(b)).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 2 — Heartbeat loop spawns mỗi region trong catalog
  // ─────────────────────────────────────────────────────────────────────
  it('heartbeat() từ DB blank → spawn đủ 1 ACTIVE per region trong bossSpawnRegions()', async () => {
    await internals().heartbeat();

    const expected = bossSpawnRegions().filter(
      (r) => bossesByRegion(r).length > 0,
    );
    const all = await prisma.worldBoss.findMany({
      where: { status: BossStatus.ACTIVE },
      select: { regionKey: true, bossKey: true },
    });
    expect(all.length).toBe(expected.length);

    // Mỗi region xuất hiện đúng 1 lần.
    const counts = new Map<string, number>();
    for (const row of all) {
      counts.set(row.regionKey, (counts.get(row.regionKey) ?? 0) + 1);
    }
    for (const region of expected) {
      expect(counts.get(region) ?? 0).toBe(1);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 3 — Heartbeat skip region đã có ACTIVE
  // ─────────────────────────────────────────────────────────────────────
  it('heartbeat() khi region A đã có ACTIVE → KHÔNG spawn thêm region A, region khác vẫn spawn', async () => {
    const { a } = pickTwoRegions();
    const candidatesA = bossesByRegion(a);
    const defA = candidatesA[0];

    const preExisting = await prisma.worldBoss.create({
      data: {
        bossKey: defA.key,
        name: defA.name,
        level: 1,
        maxHp: BigInt(defA.baseMaxHp),
        currentHp: BigInt(defA.baseMaxHp),
        status: BossStatus.ACTIVE,
        spawnedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60_000),
        rewardTotal: BigInt(defA.baseRewardLinhThach),
        regionKey: a,
      },
    });

    await internals().heartbeat();

    // Region A: vẫn 1 ACTIVE (chính là pre-existing, không bị flip).
    const regionAActive = await prisma.worldBoss.findMany({
      where: { status: BossStatus.ACTIVE, regionKey: a },
    });
    expect(regionAActive.length).toBe(1);
    expect(regionAActive[0].id).toBe(preExisting.id);

    // Tổng ACTIVE = số region (mỗi region đúng 1 ACTIVE).
    const expected = bossSpawnRegions().filter(
      (r) => bossesByRegion(r).length > 0,
    );
    const allActive = await prisma.worldBoss.count({
      where: { status: BossStatus.ACTIVE },
    });
    expect(allActive).toBe(expected.length);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 4 — adminSpawn(regionKey) per-region isolation
  // ─────────────────────────────────────────────────────────────────────
  it('adminSpawn(regionA) KHÔNG ảnh hưởng region B ACTIVE', async () => {
    const { a, b } = pickTwoRegions();
    const candidatesB = bossesByRegion(b);
    const defB = candidatesB[0];

    // Pre-create ACTIVE region B (sentinel).
    const sentinelB = await prisma.worldBoss.create({
      data: {
        bossKey: defB.key,
        name: defB.name,
        level: 1,
        maxHp: BigInt(defB.baseMaxHp),
        currentHp: BigInt(defB.baseMaxHp),
        status: BossStatus.ACTIVE,
        spawnedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60_000),
        rewardTotal: BigInt(defB.baseRewardLinhThach),
        regionKey: b,
      },
    });

    const admin = await prisma.user.create({
      data: { email: `admin-${Date.now()}@xt.local`, passwordHash: 'x', role: 'ADMIN' },
    });
    const candidatesA = bossesByRegion(a);
    const defA = candidatesA[0];
    const r = await boss.adminSpawn(admin.id, {
      bossKey: defA.key,
      level: 1,
      regionKey: a,
    });
    expect(r.regionKey).toBe(a);

    // Sentinel region B intact.
    const sentinelAfter = await prisma.worldBoss.findUniqueOrThrow({
      where: { id: sentinelB.id },
    });
    expect(sentinelAfter.status).toBe(BossStatus.ACTIVE);
    expect(sentinelAfter.currentHp).toBe(BigInt(defB.baseMaxHp));

    // Both region A và region B đều đúng 1 ACTIVE.
    const activeA = await prisma.worldBoss.count({
      where: { status: BossStatus.ACTIVE, regionKey: a },
    });
    const activeB = await prisma.worldBoss.count({
      where: { status: BossStatus.ACTIVE, regionKey: b },
    });
    expect(activeA).toBe(1);
    expect(activeB).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 5 — adminSpawn validate def.regionKey vs opts.regionKey
  // ─────────────────────────────────────────────────────────────────────
  it('adminSpawn(bossKey thuộc region X, regionKey=Y) → throw INVALID_BOSS_KEY', async () => {
    const { a, b } = pickTwoRegions();
    const candidatesA = bossesByRegion(a);
    const defA = candidatesA[0];
    const admin = await prisma.user.create({
      data: { email: `admin-${Date.now()}@xt.local`, passwordHash: 'x', role: 'ADMIN' },
    });
    await expect(
      boss.adminSpawn(admin.id, {
        bossKey: defA.key,
        level: 1,
        regionKey: b, // mismatch — defA thuộc region a
      }),
    ).rejects.toThrowError(BossError);
    await expect(
      boss.adminSpawn(admin.id, {
        bossKey: defA.key,
        level: 1,
        regionKey: b,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BOSS_KEY' });

    // KHÔNG có boss nào được tạo.
    const total = await prisma.worldBoss.count();
    expect(total).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 6 — listActive() trả về tất cả region sorted
  // ─────────────────────────────────────────────────────────────────────
  it('listActive() sau heartbeat → list ACTIVE multi-region sorted theo regionKey', async () => {
    await internals().heartbeat();
    const list = await boss.listActive(null);
    expect(list.length).toBeGreaterThan(0);

    // Sorted ascending by regionKey.
    const regionKeys = list.map((b) => b.regionKey);
    const sorted = [...regionKeys].sort();
    expect(regionKeys).toEqual(sorted);

    // Distinct (≤1 per region).
    const distinct = new Set(regionKeys);
    expect(distinct.size).toBe(regionKeys.length);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 7 — getCurrentByRegion() filter chính xác
  // ─────────────────────────────────────────────────────────────────────
  it('getCurrentByRegion(regionA) → row region A; getCurrentByRegion(emptyRegion) → null', async () => {
    const { a } = pickTwoRegions();
    const candidatesA = bossesByRegion(a);
    const defA = candidatesA[0];
    await prisma.worldBoss.create({
      data: {
        bossKey: defA.key,
        name: defA.name,
        level: 1,
        maxHp: BigInt(defA.baseMaxHp),
        currentHp: BigInt(defA.baseMaxHp),
        status: BossStatus.ACTIVE,
        spawnedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60_000),
        rewardTotal: BigInt(defA.baseRewardLinhThach),
        regionKey: a,
      },
    });

    const inA = await boss.getCurrentByRegion(a, null);
    expect(inA).not.toBeNull();
    expect(inA?.regionKey).toBe(a);

    // Empty region — pick một region khác mà chưa spawn.
    const emptyRegion = bossSpawnRegions().find(
      (r) => r !== a && bossesByRegion(r).length > 0,
    );
    if (emptyRegion) {
      const inEmpty = await boss.getCurrentByRegion(emptyRegion, null);
      expect(inEmpty).toBeNull();
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 8 — Migration backfill: legacy WorldBoss row default 'world'
  // ─────────────────────────────────────────────────────────────────────
  it('schema default regionKey="world" + ACTIVE row insert without regionKey → backfilled "world"', async () => {
    // Bỏ explicit regionKey field — Prisma schema default phải kick in
    // và set 'world' (matching migration `ADD COLUMN ... DEFAULT 'world'
    // NOT NULL`).
    const raw = await prisma.$executeRawUnsafe(`
      INSERT INTO "WorldBoss"
        ("id", "bossKey", "name", "level", "maxHp", "currentHp", "status",
         "spawnedAt", "expiresAt", "rewardTotal")
      VALUES
        ('legacy-${Date.now()}', '${BOSSES[BOSSES.length - 1].key}',
         'Legacy Boss', 1, 1000, 1000, 'ACTIVE',
         NOW(), NOW() + INTERVAL '1 hour', 0)
    `);
    expect(raw).toBe(1);

    const legacyRow = await prisma.worldBoss.findFirst({
      where: { name: 'Legacy Boss' },
    });
    expect(legacyRow).not.toBeNull();
    expect(legacyRow?.regionKey).toBe(WORLD_BOSS_REGION_KEY);
  });
});
