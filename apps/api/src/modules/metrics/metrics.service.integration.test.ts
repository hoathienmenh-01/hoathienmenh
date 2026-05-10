/**
 * Phase 17.5 — integration test cho `MetricsService` với REAL Redis +
 * Prisma. Lock-in:
 *   - Queue depth: BullMQ key prefix `bull:` đúng — push 1 job vào
 *     `bull:cultivation:wait` qua redis raw → collectQueueMetrics()
 *     count = 1.
 *   - Cron: insert 1 row `SectTerritoryDecayLog` → collectCronMetrics()
 *     trả lastRunAt + contextKey đúng.
 *   - End-to-end collectAll() trên real infra → errors=[].
 *
 * Yêu cầu infra (CI có sẵn theo `.github/workflows/ci.yml`):
 *   - Postgres 5432 (`DATABASE_URL`).
 *   - Redis 6379 (`REDIS_URL`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import IORedis from 'ioredis';
import { MetricsService } from './metrics.service';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TEST_DATABASE_URL } from '../../test-helpers';

let prisma: PrismaService;
let redis: InstanceType<typeof IORedis>;
let realtime: RealtimeService;
let svc: MetricsService;

const TEST_QUEUE_KEYS = [
  'bull:cultivation:wait',
  'bull:cultivation:active',
  'bull:cultivation:delayed',
  'bull:cultivation:completed',
  'bull:cultivation:failed',
  'bull:ops:wait',
  'bull:mission-reset:wait',
  'bull:territory-cron:wait',
  'bull:sect-season-cron:wait',
  'bull:ledger-checker-cron:wait',
  'bull:anomaly-scanner-cron:wait',
];

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  realtime = new RealtimeService();
  svc = new MetricsService(prisma, realtime, redis as unknown as InstanceType<typeof IORedis>);
});

afterAll(async () => {
  // Dọn key test trong Redis.
  await redis.del(...TEST_QUEUE_KEYS);
  await prisma.$disconnect();
  await redis.quit();
});

beforeEach(async () => {
  // Sạch key BullMQ trước mỗi test.
  await redis.del(...TEST_QUEUE_KEYS);
  // Sạch decay log để cron last-run reproducible.
  await prisma.sectTerritoryDecayLog.deleteMany({});
});

describe('MetricsService integration — Redis BullMQ key contract', () => {
  it('queue empty (no key) → mọi count = 0', async () => {
    const r = await svc.collectQueueMetrics();
    expect(r.available).toBe(true);
    const cult = r.queues.find((q) => q.name === 'cultivation');
    expect(cult).toEqual({
      name: 'cultivation',
      waiting: 0,
      active: 0,
      delayed: 0,
      completed: 0,
      failed: 0,
    });
  });

  it('push 2 element vào bull:cultivation:wait → waiting=2', async () => {
    await redis.rpush('bull:cultivation:wait', 'job-1', 'job-2');
    const r = await svc.collectQueueMetrics();
    const cult = r.queues.find((q) => q.name === 'cultivation');
    expect(cult?.waiting).toBe(2);
    expect(cult?.active).toBe(0);
  });

  it('zadd vào bull:ops:delayed/completed/failed → đếm đúng zcard', async () => {
    await redis.zadd('bull:ops:delayed', '1700000000', 'd1');
    await redis.zadd('bull:ops:completed', '1700000001', 'c1', '1700000002', 'c2');
    await redis.zadd('bull:ops:failed', '1700000003', 'f1');
    const r = await svc.collectQueueMetrics();
    const ops = r.queues.find((q) => q.name === 'ops');
    expect(ops?.delayed).toBe(1);
    expect(ops?.completed).toBe(2);
    expect(ops?.failed).toBe(1);
  });
});

describe('MetricsService integration — Prisma cron last-run', () => {
  it('chưa có row → cron lastRunAt null', async () => {
    const r = await svc.collectCronMetrics();
    const decay = r.jobs.find((j) => j.job === 'territory-decay');
    expect(decay?.lastRunAt).toBeNull();
    expect(decay?.contextKey).toBeNull();
  });

  it('insert SectTerritoryDecayLog → collectCronMetrics trả lastRunAt + contextKey', async () => {
    const triggeredAt = new Date('2026-05-08T10:00:00Z');
    await prisma.sectTerritoryDecayLog.create({
      data: {
        periodKey: 'wk-2026-19',
        decayBps: 100,
        rowsAffected: 0,
        pointsBefore: 0,
        pointsAfter: 0,
        triggeredAt,
        triggeredBy: 'test-integration',
      },
    });
    const r = await svc.collectCronMetrics();
    const decay = r.jobs.find((j) => j.job === 'territory-decay');
    expect(decay?.lastRunAt).toBe(triggeredAt.toISOString());
    expect(decay?.lastStatus).toBe('OK');
    expect(decay?.contextKey).toBe('wk-2026-19');
  });
});

describe('MetricsService integration — collectAll end-to-end', () => {
  it('real infra → errors=[], mọi block có data', async () => {
    const r = await svc.collectAll();
    expect(r.schema).toBe(1);
    expect(r.errors).toEqual([]);
    expect(r.system.uptimeMs).toBeGreaterThan(0);
    expect(r.ws?.serverBound).toBe(true);
    expect(r.queue?.available).toBe(true);
    expect(r.cron?.available).toBe(true);
    // Bảo đảm payload không chứa env DB password.
    const json = JSON.stringify(r);
    expect(json).not.toContain('mtt:mtt');
    expect(json).not.toContain('postgresql://');
    expect(json).not.toContain('redis://');
  });
});
