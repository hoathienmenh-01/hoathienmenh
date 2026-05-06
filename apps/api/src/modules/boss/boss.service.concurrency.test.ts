/**
 * BossService concurrency regression tests — Phase 12.X (concurrency phase 2).
 *
 * Covers boss spawn cron auto race: 2+ concurrent `BossService.heartbeat()`
 * (or `spawnNew()`) ticks must NEVER produce 2 simultaneous ACTIVE
 * `WorldBoss` rows. Without the partial unique index
 * `WorldBoss_status_active_unique` (migration
 * `20260522000000_concurrency_boss_active_unique`), 2 heartbeats running on
 * different pods (or a single pod where the previous tick is still
 * in-flight) can each pass the `findFirst({status: ACTIVE}) === null`
 * check and both `worldBoss.create()` succeed → 2 ACTIVE bosses split
 * leaderboard / damage tracking / ledger.
 *
 * Test pattern: mirror `inventory.service.concurrency.test.ts` —
 *
 *   1. **5× concurrent `spawnNew()`** (no prior ACTIVE) → exactly 1 row
 *      created with `status = ACTIVE`, 4 calls return null (race lost
 *      via Prisma `P2002`).
 *
 *   2. **Pre-create 1 ACTIVE row, then `spawnNew()`** → returns null
 *      gracefully (no throw). Existing ACTIVE not corrupted.
 *
 *   3. **2× concurrent `heartbeat()`** (no prior ACTIVE, no recent
 *      DEFEATED/EXPIRED) → exactly 1 ACTIVE row in DB after both settle.
 *      In-process re-entry guard (`heartbeatRunning`) covers the
 *      same-process case; partial unique index covers multi-pod.
 *
 *   4. **`adminSpawn(force=true)` race with `heartbeat()`** — admin
 *      flips ACTIVE → EXPIRED, then a parallel heartbeat spawns a fresh
 *      ACTIVE before admin's `spawnNew` finishes. Admin's `create()`
 *      hits P2002 → adminSpawn throws `BOSS_ALREADY_ACTIVE`. Critical:
 *      no audit log row is written for the failed spawn.
 *
 * Use real PG (`TEST_DATABASE_URL`) + `Promise.allSettled` concurrent —
 * KHÔNG mock prisma. Thread interleaving non-deterministic per PG
 * isolation (default ReadCommitted) — partial unique index is the
 * authoritative guard regardless of interleaving order.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BossStatus } from '@prisma/client';
import { BOSSES, bossByKey } from '@xuantoi/shared';
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

const DEF = BOSSES[0];

/**
 * Resolve cả ok-result và rejection cho Promise.all concurrent — wrap qua
 * `allSettled` thay vì `Promise.all` (which fail-fast khi 1 throw). Khớp
 * pattern `inventory.service.concurrency.test.ts:73-83`.
 */
async function runConcurrent<T>(
  fn: () => Promise<T>,
  count: number,
): Promise<Array<{ ok: true; value: T } | { ok: false; err: unknown }>> {
  const settled = await Promise.allSettled(Array.from({ length: count }, fn));
  return settled.map((s) =>
    s.status === 'fulfilled'
      ? { ok: true as const, value: s.value }
      : { ok: false as const, err: s.reason },
  );
}

/**
 * Truy cập private `heartbeat` / `spawnNew` của BossService — pattern
 * private-cast khớp với `boss.service.test.ts:37` (cooldowns clear).
 */
type BossInternals = {
  heartbeat: () => Promise<void>;
  spawnNew: (overrides?: {
    def?: ReturnType<typeof bossByKey>;
    level?: number;
  }) => Promise<{ id: string; bossKey: string; level: number; maxHp: bigint } | null>;
};
const internals = () => boss as unknown as BossInternals;

describe('BossService — concurrency regression (spawn cron auto race)', () => {
  // ─────────────────────────────────────────────────────────────────────
  // Race 1 — 5× concurrent spawnNew with no prior ACTIVE
  // ─────────────────────────────────────────────────────────────────────
  it('5× concurrent spawnNew → exactly 1 ACTIVE row, 4 race-lost calls return null', async () => {
    const results = await runConcurrent(() => internals().spawnNew(), 5);

    const okCount = results.filter((r) => r.ok && r.value !== null).length;
    const nullCount = results.filter((r) => r.ok && r.value === null).length;
    const errCount = results.filter((r) => !r.ok).length;

    // Critical invariant: cả 5 call phải settled (ok), không call nào throw.
    // 1 winner + 4 race-lost no-op.
    expect(errCount).toBe(0);
    expect(okCount).toBe(1);
    expect(nullCount).toBe(4);

    // DB: exactly 1 ACTIVE row.
    const activeCount = await prisma.worldBoss.count({
      where: { status: BossStatus.ACTIVE },
    });
    expect(activeCount).toBe(1);

    // Total bosses created (kể cả race-lost should NOT have created
    // partial rows) = 1.
    const totalCount = await prisma.worldBoss.count();
    expect(totalCount).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Race 2 — spawnNew when ACTIVE already exists (cron-after-admin-spawn)
  // ─────────────────────────────────────────────────────────────────────
  it('spawnNew khi đã có ACTIVE → returns null (no throw, không corrupt existing)', async () => {
    const def = bossByKey(DEF.key)!;
    const existing = await prisma.worldBoss.create({
      data: {
        bossKey: def.key,
        name: def.name,
        level: 1,
        maxHp: BigInt(def.baseMaxHp),
        currentHp: BigInt(def.baseMaxHp),
        status: BossStatus.ACTIVE,
        spawnedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60_000),
        rewardTotal: BigInt(def.baseRewardLinhThach),
      },
    });

    const r = await internals().spawnNew();
    expect(r).toBeNull();

    // Existing row giữ nguyên — không bị flip status, không bị decrement HP.
    const after = await prisma.worldBoss.findUniqueOrThrow({
      where: { id: existing.id },
    });
    expect(after.status).toBe(BossStatus.ACTIVE);
    expect(after.currentHp).toBe(BigInt(def.baseMaxHp));

    // DB still exactly 1 ACTIVE row.
    const activeCount = await prisma.worldBoss.count({
      where: { status: BossStatus.ACTIVE },
    });
    expect(activeCount).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Race 3 — 2× concurrent heartbeat from "blank slate" (no ACTIVE)
  // ─────────────────────────────────────────────────────────────────────
  it('2× concurrent heartbeat (no prior ACTIVE) → exactly 1 ACTIVE row sau race', async () => {
    const results = await runConcurrent(() => internals().heartbeat(), 2);

    // Heartbeat không throw — 2 path:
    //   a) intra-process: heartbeatRunning flag → 2nd call skip,
    //      1st call spawn. Result: 1 ACTIVE.
    //   b) flag cleared between (await microtask), 2 spawn race —
    //      partial unique index → 1 winner + 1 P2002 swallowed.
    expect(results.every((r) => r.ok)).toBe(true);

    const activeCount = await prisma.worldBoss.count({
      where: { status: BossStatus.ACTIVE },
    });
    expect(activeCount).toBe(1);

    const totalCount = await prisma.worldBoss.count();
    expect(totalCount).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Race 4 — adminSpawn(force=true) racing with concurrent spawnNew
  // ─────────────────────────────────────────────────────────────────────
  it('adminSpawn(force=true) race với spawnNew → admin throws BOSS_ALREADY_ACTIVE, KHÔNG ghi audit log', async () => {
    const admin = await prisma.user.create({
      data: { email: `admin-${Date.now()}@xt.local`, passwordHash: 'x', role: 'ADMIN' },
    });
    // Setup: 1 ACTIVE boss (admin sẽ force-replace).
    const def = bossByKey(DEF.key)!;
    await prisma.worldBoss.create({
      data: {
        bossKey: def.key,
        name: def.name,
        level: 1,
        maxHp: BigInt(def.baseMaxHp),
        currentHp: BigInt(def.baseMaxHp),
        status: BossStatus.ACTIVE,
        spawnedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60_000),
        rewardTotal: BigInt(def.baseRewardLinhThach),
      },
    });

    // Race: admin force=true (flip ACTIVE→EXPIRED + spawn) song song với
    // 1 spawnNew "as if" heartbeat. Outcomes hợp lệ:
    //   (a) admin tới sau heartbeat: admin.findFirst thấy heartbeat-spawned
    //       boss (ACTIVE), force flip → spawn succeed.
    //   (b) admin force-flip win: heartbeat thấy không ACTIVE → spawn
    //       succeed → admin sau đó hit P2002 → throw BOSS_ALREADY_ACTIVE.
    //   (c) admin tới trước: flip cũ → admin spawnNew win → heartbeat
    //       hit P2002 → no-op.
    // Bound trên: 1 ACTIVE sau race; nếu admin throw thì KHÔNG ghi audit
    // log (bossId chưa được tạo); nếu admin succeed thì có audit.
    const [adminResult] = await Promise.allSettled([
      boss.adminSpawn(admin.id, { bossKey: DEF.key, level: 2, force: true }),
      internals().spawnNew(),
    ]);

    // 1 ACTIVE row only.
    const activeCount = await prisma.worldBoss.count({
      where: { status: BossStatus.ACTIVE },
    });
    expect(activeCount).toBe(1);

    // Audit log invariant: số entry BOSS_SPAWN khớp với số adminSpawn
    // succeed (0 nếu race-lost throw; 1 nếu race-won).
    const auditCount = await prisma.adminAuditLog.count({
      where: { actorUserId: admin.id, action: 'BOSS_SPAWN' },
    });
    if (adminResult.status === 'fulfilled') {
      expect(auditCount).toBe(1);
    } else {
      // Race-lost path: admin spawn rejected, no audit log written
      // (KHÔNG nói dối là admin đã spawn).
      expect(adminResult.reason).toBeInstanceOf(BossError);
      expect((adminResult.reason as BossError).code).toBe('BOSS_ALREADY_ACTIVE');
      expect(auditCount).toBe(0);
    }
  });
});
