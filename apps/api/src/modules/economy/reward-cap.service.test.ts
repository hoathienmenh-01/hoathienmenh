import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import {
  RewardCapService,
  dayBucketFor,
  getDailyRewardCapTz,
} from './reward-cap.service';

/**
 * Phase 16.5 — Integration test cho RewardCapService.applyCapTx.
 *
 * Bao phủ:
 * - Under-cap → grant đầy đủ.
 * - Over-cap (vượt phần) → grant phần còn lại, cắt phần dư.
 * - Cạn cap → grant 0, wasCapped=true.
 * - Reset theo dayBucket khi đổi ngày (override `now`).
 * - Per-source isolation (DUNGEON cap không ăn vào MISSION).
 * - Concurrent grants không vượt cap (CAS retry chứng minh).
 * - RewardCapEvent ledger ghi đúng granted/capped (không phải requested).
 * - Negative requested coerce → 0n (không cho accum âm).
 */

let prisma: PrismaService;
let svc: RewardCapService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new RewardCapService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('RewardCapService.applyCapTx — basic flow', () => {
  it('first grant under cap → full grant, wasCapped=false', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const result = await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'MISSION',
        requestedExp: 500n,
        requestedLinhThach: 200n,
        realmKey: 'phamnhan',
      }),
    );
    expect(result.wasCapped).toBe(false);
    expect(result.grantedExp).toBe(500n);
    expect(result.grantedLinhThach).toBe(200n);
    expect(result.cappedExp).toBe(0n);
    expect(result.cappedLinhThach).toBe(0n);
  });

  it('grant exceeding cap → partial grant + wasCapped=true', async () => {
    // phamnhan MISSION cap = exp 1500, linhThach 500. Request 5000 + 1000.
    const f = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const result = await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'MISSION',
        requestedExp: 5000n,
        requestedLinhThach: 1000n,
        realmKey: 'phamnhan',
      }),
    );
    expect(result.wasCapped).toBe(true);
    expect(result.grantedExp).toBe(1500n);
    expect(result.grantedLinhThach).toBe(500n);
    expect(result.cappedExp).toBe(3500n);
    expect(result.cappedLinhThach).toBe(500n);
    expect(result.remainingExp).toBe(0n);
    expect(result.remainingLinhThach).toBe(0n);
  });

  it('grant at exactly cap → wasCapped=false (boundary)', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const result = await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'MISSION',
        requestedExp: 1500n,
        requestedLinhThach: 500n,
        realmKey: 'phamnhan',
      }),
    );
    expect(result.wasCapped).toBe(false);
    expect(result.grantedExp).toBe(1500n);
    expect(result.grantedLinhThach).toBe(500n);
    expect(result.remainingExp).toBe(0n);
    expect(result.remainingLinhThach).toBe(0n);
  });

  it('exhausted cap → next grant returns 0', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // 1st grant: full cap.
    await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'MISSION',
        requestedExp: 1500n,
        requestedLinhThach: 500n,
        realmKey: 'phamnhan',
      }),
    );
    // 2nd grant: cap đã hết → grant 0.
    const r2 = await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'MISSION',
        requestedExp: 100n,
        requestedLinhThach: 100n,
        realmKey: 'phamnhan',
      }),
    );
    expect(r2.wasCapped).toBe(true);
    expect(r2.grantedExp).toBe(0n);
    expect(r2.grantedLinhThach).toBe(0n);
    expect(r2.cappedExp).toBe(100n);
    expect(r2.cappedLinhThach).toBe(100n);
  });

  it('multiple grants in same day accumulate correctly', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // Grant 600 + 200 → còn 900 + 300.
    await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'MISSION',
        requestedExp: 600n,
        requestedLinhThach: 200n,
        realmKey: 'phamnhan',
      }),
    );
    // Grant tiếp 600 + 200 → còn 300 + 100.
    const r2 = await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'MISSION',
        requestedExp: 600n,
        requestedLinhThach: 200n,
        realmKey: 'phamnhan',
      }),
    );
    expect(r2.wasCapped).toBe(false);
    expect(r2.grantedExp).toBe(600n);
    expect(r2.remainingExp).toBe(300n);
    expect(r2.remainingLinhThach).toBe(100n);
  });

  it('per-source isolation — DUNGEON exhausted không ảnh hưởng MISSION', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // DUNGEON full grant phamnhan: exp 2400, linh 600.
    await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'DUNGEON',
        requestedExp: 100000n,
        requestedLinhThach: 100000n,
        realmKey: 'phamnhan',
      }),
    );
    // MISSION cap riêng → vẫn còn 1500 / 500.
    const r = await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'MISSION',
        requestedExp: 1500n,
        requestedLinhThach: 500n,
        realmKey: 'phamnhan',
      }),
    );
    expect(r.wasCapped).toBe(false);
    expect(r.grantedExp).toBe(1500n);
    expect(r.grantedLinhThach).toBe(500n);
  });

  it('day bucket reset — new day grants full cap again', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const now1 = new Date('2026-01-15T12:00:00Z');
    const now2 = new Date('2026-01-16T12:00:00Z');
    // Day 1: full grant
    const r1 = await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'MISSION',
        requestedExp: 1500n,
        requestedLinhThach: 500n,
        realmKey: 'phamnhan',
        now: now1,
      }),
    );
    expect(r1.dayBucket).toMatch(/2026-01-1[56]/);
    // Day 2: cap reset, full grant lại được.
    const r2 = await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'MISSION',
        requestedExp: 1500n,
        requestedLinhThach: 500n,
        realmKey: 'phamnhan',
        now: now2,
      }),
    );
    expect(r2.dayBucket).not.toBe(r1.dayBucket);
    expect(r2.grantedExp).toBe(1500n);
    expect(r2.grantedLinhThach).toBe(500n);
    expect(r2.wasCapped).toBe(false);
  });

  it('higher realm has higher cap', async () => {
    const charLow = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const charHigh = await makeUserChar(prisma, { realmKey: 'kim_dan' });
    // phamnhan MISSION exp cap = 1500.
    const rLow = await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: charLow.characterId,
        source: 'MISSION',
        requestedExp: 100000n,
        requestedLinhThach: 100000n,
        realmKey: 'phamnhan',
      }),
    );
    // kim_dan MISSION exp cap = 4500 (×3 multiplier).
    const rHigh = await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: charHigh.characterId,
        source: 'MISSION',
        requestedExp: 100000n,
        requestedLinhThach: 100000n,
        realmKey: 'kim_dan',
      }),
    );
    expect(rHigh.grantedExp).toBeGreaterThan(rLow.grantedExp);
    expect(rHigh.grantedLinhThach).toBeGreaterThan(rLow.grantedLinhThach);
  });
});

describe('RewardCapService.applyCapTx — audit log', () => {
  it('wasCapped=true → RewardCapEvent ghi granted + capped đúng', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'MISSION',
        requestedExp: 5000n,
        requestedLinhThach: 1000n,
        realmKey: 'phamnhan',
        refType: 'MissionProgress',
        refId: 'mp-test-1',
        meta: { missionKey: 'daily_chat' },
      }),
    );
    const events = await prisma.rewardCapEvent.findMany({
      where: { characterId: f.characterId },
    });
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.source).toBe('MISSION');
    expect(ev.requestedExp).toBe(5000n);
    expect(ev.requestedLinhThach).toBe(1000n);
    expect(ev.grantedExp).toBe(1500n);
    expect(ev.grantedLinhThach).toBe(500n);
    expect(ev.cappedExp).toBe(3500n);
    expect(ev.cappedLinhThach).toBe(500n);
    expect(ev.refType).toBe('MissionProgress');
    expect(ev.refId).toBe('mp-test-1');
    expect(ev.meta).toEqual({ missionKey: 'daily_chat' });
  });

  it('wasCapped=false → KHÔNG ghi RewardCapEvent (giữ table sạch)', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'MISSION',
        requestedExp: 100n,
        requestedLinhThach: 50n,
        realmKey: 'phamnhan',
      }),
    );
    const count = await prisma.rewardCapEvent.count({
      where: { characterId: f.characterId },
    });
    expect(count).toBe(0);
  });
});

describe('RewardCapService.applyCapTx — concurrency', () => {
  it('5 concurrent grants không vượt cap (CAS retry chứng minh)', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    // 5 calls đồng thời, mỗi cái request 400 EXP + 150 linh, total 2000+750.
    // Cap MISSION phamnhan = 1500 + 500 → CAS phải đảm bảo accum ≤ cap.
    const results = await Promise.all(
      Array.from({ length: 5 }).map(() =>
        prisma.$transaction((tx) =>
          svc.applyCapTx(tx, {
            characterId: f.characterId,
            source: 'MISSION',
            requestedExp: 400n,
            requestedLinhThach: 150n,
            realmKey: 'phamnhan',
          }),
        ),
      ),
    );
    // Tổng granted không vượt cap.
    const totalExp = results.reduce((s, r) => s + r.grantedExp, 0n);
    const totalLinh = results.reduce((s, r) => s + r.grantedLinhThach, 0n);
    expect(totalExp).toBeLessThanOrEqual(1500n);
    expect(totalLinh).toBeLessThanOrEqual(500n);
    // Bucket DB thực tế.
    const bucket = await prisma.characterDailyRewardBucket.findFirst({
      where: { characterId: f.characterId, source: 'MISSION' },
    });
    expect(bucket).not.toBeNull();
    expect(bucket!.expAccum).toBeLessThanOrEqual(1500n);
    expect(bucket!.linhThachAccum).toBeLessThanOrEqual(500n);
    // Bucket = đúng tổng granted (không double-count).
    expect(bucket!.expAccum).toBe(totalExp);
    expect(bucket!.linhThachAccum).toBe(totalLinh);
  });
});

describe('RewardCapService.applyCapTx — Body Cultivation source', () => {
  it('BODY_CULTIVATION has an isolated EXP-only bucket', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'phamnhan' });

    const body = await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'BODY_CULTIVATION',
        requestedExp: 5000n,
        requestedLinhThach: 99n,
        realmKey: 'phamnhan',
      }),
    );
    const mission = await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'MISSION',
        requestedExp: 1500n,
        requestedLinhThach: 500n,
        realmKey: 'phamnhan',
      }),
    );

    expect(body.grantedExp).toBe(3300n);
    expect(body.grantedLinhThach).toBe(0n);
    expect(body.wasCapped).toBe(true);
    expect(mission.grantedExp).toBe(1500n);
    expect(mission.grantedLinhThach).toBe(500n);
    const buckets = await prisma.characterDailyRewardBucket.findMany({
      where: { characterId: f.characterId },
      orderBy: { source: 'asc' },
    });
    expect(buckets.map((b) => b.source)).toEqual([
      'BODY_CULTIVATION',
      'MISSION',
    ]);
  });
});

describe('RewardCapService.applyCapTx — coercion', () => {
  it('negative requestedExp/linhThach → coerce 0n (no negative grant)', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const r = await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'MISSION',
        requestedExp: -100n,
        requestedLinhThach: -50n,
        realmKey: 'phamnhan',
      }),
    );
    expect(r.grantedExp).toBe(0n);
    expect(r.grantedLinhThach).toBe(0n);
    expect(r.wasCapped).toBe(false);
  });

  it('zero request → grant 0, wasCapped=false, không tạo bucket dư', async () => {
    const f = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const r = await prisma.$transaction((tx) =>
      svc.applyCapTx(tx, {
        characterId: f.characterId,
        source: 'MISSION',
        requestedExp: 0n,
        requestedLinhThach: 0n,
        realmKey: 'phamnhan',
      }),
    );
    expect(r.grantedExp).toBe(0n);
    expect(r.grantedLinhThach).toBe(0n);
    expect(r.wasCapped).toBe(false);
    const bucket = await prisma.characterDailyRewardBucket.findFirst({
      where: { characterId: f.characterId },
    });
    expect(bucket).toBeNull();
  });
});

describe('RewardCapService — helpers', () => {
  it('getDailyRewardCapTz default Asia/Ho_Chi_Minh', () => {
    const old = process.env.DAILY_REWARD_CAP_TZ;
    delete process.env.DAILY_REWARD_CAP_TZ;
    expect(getDailyRewardCapTz()).toBe('Asia/Ho_Chi_Minh');
    if (old !== undefined) process.env.DAILY_REWARD_CAP_TZ = old;
  });

  it('getDailyRewardCapTz override qua env', () => {
    const old = process.env.DAILY_REWARD_CAP_TZ;
    process.env.DAILY_REWARD_CAP_TZ = 'UTC';
    expect(getDailyRewardCapTz()).toBe('UTC');
    if (old === undefined) delete process.env.DAILY_REWARD_CAP_TZ;
    else process.env.DAILY_REWARD_CAP_TZ = old;
  });

  it('dayBucketFor return YYYY-MM-DD format', () => {
    const s = dayBucketFor(new Date('2026-05-09T08:00:00Z'), 'UTC');
    expect(s).toBe('2026-05-09');
  });

  it('dayBucketFor sử dụng tz Asia/Ho_Chi_Minh đẩy 17:00 UTC sang ngày kế', () => {
    // 17:00 UTC = 00:00 sáng hôm sau theo Asia/Ho_Chi_Minh (+07).
    const s = dayBucketFor(new Date('2026-05-09T17:00:00Z'), 'Asia/Ho_Chi_Minh');
    expect(s).toBe('2026-05-10');
  });
});
