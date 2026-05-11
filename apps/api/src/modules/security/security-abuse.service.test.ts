/**
 * Phase 18.1 — SecurityAbuseService unit tests.
 *
 * Pure-unit: mock PrismaService + IpHashService. Test:
 *   - `isBlocked()` returns blocked=true khi có active block.
 *   - `isBlocked()` returns blocked=false khi không có block / đã lift.
 *   - `recordRateLimitViolation()` tạo event row; threshold → tạo block.
 *   - `recordLoginFailed()` không lưu password; tạo event với chỉ email.
 *   - `createBlock()` idempotent: gọi 2 lần liên tiếp chỉ tạo 1 block.
 *   - `liftBlock()` set liftedAt + tạo BLOCK_LIFTED event.
 *   - DB throw → fail-soft (return safe default, không crash caller).
 *   - `ABUSE_BLOCK_ENABLED=false` → no-op.
 *   - `listActiveBlocks()` + `listRecentEvents()` pagination.
 *   - DetailJson KHÔNG chứa raw IP (chỉ hash) và KHÔNG chứa password.
 */
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { SecurityAbuseService } from './security-abuse.service';
import { IpHashService } from './ip-hash.service';
import type { PrismaService } from '../../common/prisma.service';

function makeIpHash(): IpHashService {
  return new IpHashService({
    get: () => 'test-salt',
  } as unknown as ConfigService);
}

function makeCfg(env: Record<string, string> = {}): ConfigService {
  return {
    get: (k: string) => env[k],
  } as unknown as ConfigService;
}

interface FakeEventRow {
  id: string;
  type: string;
  severity: string;
  ipHash: string | null;
  userId: string | null;
  characterId: string | null;
  policy: string | null;
  detailJson: unknown;
  createdAt: Date;
}

interface FakeBlockRow {
  id: string;
  type: string;
  subjectHash: string;
  reason: string;
  expiresAt: Date;
  createdAt: Date;
  liftedAt: Date | null;
  liftedById: string | null;
}

function makePrisma(): {
  prisma: PrismaService;
  events: FakeEventRow[];
  blocks: FakeBlockRow[];
} {
  const events: FakeEventRow[] = [];
  const blocks: FakeBlockRow[] = [];
  let evtSeq = 0;
  let blkSeq = 0;

  const prisma = {
    securityEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        evtSeq += 1;
        const row: FakeEventRow = {
          id: `evt-${evtSeq}`,
          type: data.type as string,
          severity: (data.severity as string) ?? 'INFO',
          ipHash: (data.ipHash as string | null) ?? null,
          userId: (data.userId as string | null) ?? null,
          characterId: (data.characterId as string | null) ?? null,
          policy: (data.policy as string | null) ?? null,
          detailJson: data.detailJson ?? {},
          createdAt: new Date(),
        };
        events.push(row);
        return row;
      }),
      count: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          events.filter((e) => {
            if (where.type && e.type !== where.type) return false;
            if (where.ipHash && e.ipHash !== where.ipHash) return false;
            if (where.userId && e.userId !== where.userId) return false;
            return true;
          }).length,
      ),
      findMany: vi.fn(async () => events.slice().reverse()),
    },
    securityBlock: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          const now = new Date();
          return (
            blocks.find((b) => {
              if (where.type && b.type !== where.type) return false;
              if (where.subjectHash && b.subjectHash !== where.subjectHash)
                return false;
              if (b.liftedAt !== null) return false;
              if (b.expiresAt <= now) return false;
              return true;
            }) ?? null
          );
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        blocks.find((b) => b.id === where.id) ?? null,
      ),
      findMany: vi.fn(async () =>
        blocks.filter((b) => !b.liftedAt && b.expiresAt > new Date()),
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        blkSeq += 1;
        const row: FakeBlockRow = {
          id: `blk-${blkSeq}`,
          type: data.type as string,
          subjectHash: data.subjectHash as string,
          reason: data.reason as string,
          expiresAt: data.expiresAt as Date,
          createdAt: new Date(),
          liftedAt: null,
          liftedById: null,
        };
        blocks.push(row);
        return row;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const b = blocks.find((x) => x.id === where.id);
          if (!b) throw new Error('not-found');
          b.liftedAt = (data.liftedAt as Date | null) ?? new Date();
          b.liftedById = (data.liftedById as string | null) ?? null;
          return b;
        },
      ),
    },
  } as unknown as PrismaService;
  return { prisma, events, blocks };
}

describe('SecurityAbuseService', () => {
  it('isBlocked() → blocked=false khi không có block', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAbuseService(prisma, makeIpHash(), makeCfg());
    const r = await svc.isBlocked('IP', '1.1.1.1');
    expect(r.blocked).toBe(false);
  });

  it('isBlocked() → blocked=true sau khi createBlock', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAbuseService(prisma, makeIpHash(), makeCfg());
    const ipHash = makeIpHash().hashIp('1.1.1.1');
    const created = await svc.createBlock({
      type: 'IP',
      subjectHash: ipHash,
      reason: 'TEST',
      blockSec: 60,
    });
    expect(created).toBe(true);
    const r = await svc.isBlocked('IP', '1.1.1.1');
    expect(r.blocked).toBe(true);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.reason).toBe('TEST');
  });

  it('createBlock idempotent: gọi 2 lần chỉ tạo 1 block', async () => {
    const { prisma, blocks } = makePrisma();
    const svc = new SecurityAbuseService(prisma, makeIpHash(), makeCfg());
    const a = await svc.createBlock({
      type: 'IP',
      subjectHash: 'abc',
      reason: 'TEST',
      blockSec: 60,
    });
    const b = await svc.createBlock({
      type: 'IP',
      subjectHash: 'abc',
      reason: 'TEST',
      blockSec: 60,
    });
    expect(a).toBe(true);
    expect(b).toBe(false);
    expect(blocks.length).toBe(1);
  });

  it('recordRateLimitViolation() tạo event với policy + ipHash', async () => {
    const { prisma, events } = makePrisma();
    const svc = new SecurityAbuseService(prisma, makeIpHash(), makeCfg());
    await svc.recordRateLimitViolation({
      policy: 'AUTH_LOGIN',
      ip: '1.1.1.1',
      userId: 'user-1',
      severity: 'LOW',
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    const evt = events[0]!;
    expect(evt.type).toBe('RATE_LIMIT_VIOLATION');
    expect(evt.policy).toBe('AUTH_LOGIN');
    // IP must be hashed, never raw.
    expect(evt.ipHash).not.toContain('1.1.1.1');
    expect(evt.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('recordLoginFailed() KHÔNG lưu password, chỉ lưu email', async () => {
    const { prisma, events } = makePrisma();
    const svc = new SecurityAbuseService(prisma, makeIpHash(), makeCfg());
    await svc.recordLoginFailed({
      ip: '1.1.1.1',
      email: 'attacker@example.com',
    });
    expect(events.length).toBe(1);
    const evt = events[0]!;
    expect(evt.type).toBe('LOGIN_FAILED');
    const detail = evt.detailJson as Record<string, unknown>;
    expect(detail.email).toBe('attacker@example.com');
    // Confirm password key absent (any obvious field).
    expect(detail.password).toBeUndefined();
    expect(detail.cookie).toBeUndefined();
    expect(detail.token).toBeUndefined();
  });

  it('liftBlock() set liftedAt + tạo BLOCK_LIFTED event', async () => {
    const { prisma, events, blocks } = makePrisma();
    const svc = new SecurityAbuseService(prisma, makeIpHash(), makeCfg());
    await svc.createBlock({
      type: 'USER',
      subjectHash: 'user-1',
      reason: 'TEST',
      blockSec: 60,
    });
    const block = blocks[0]!;
    const lifted = await svc.liftBlock(block.id, 'admin-1');
    expect(lifted?.id).toBe(block.id);
    expect(block.liftedAt).not.toBe(null);
    expect(block.liftedById).toBe('admin-1');
    expect(events.some((e) => e.type === 'BLOCK_LIFTED')).toBe(true);
  });

  it('liftBlock() trả null khi block không tồn tại', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAbuseService(prisma, makeIpHash(), makeCfg());
    const r = await svc.liftBlock('ghost-id', 'admin-1');
    expect(r).toBe(null);
  });

  it('ABUSE_BLOCK_ENABLED=false → no-op (skip persistence)', async () => {
    const { prisma, events } = makePrisma();
    const svc = new SecurityAbuseService(
      prisma,
      makeIpHash(),
      makeCfg({ ABUSE_BLOCK_ENABLED: 'false' }),
    );
    const r = await svc.recordRateLimitViolation({
      policy: 'AUTH_LOGIN',
      ip: '1.1.1.1',
      userId: 'user-1',
      severity: 'HIGH',
    });
    expect(r).toBe(false);
    expect(events.length).toBe(0);
    const blocked = await svc.isBlocked('IP', '1.1.1.1');
    expect(blocked.blocked).toBe(false);
  });

  it('DB throw → fail-soft (no crash, return safe default)', async () => {
    const failingPrisma = {
      securityEvent: {
        create: vi.fn().mockRejectedValue(new Error('db-down')),
        count: vi.fn().mockRejectedValue(new Error('db-down')),
        findMany: vi.fn().mockRejectedValue(new Error('db-down')),
      },
      securityBlock: {
        findFirst: vi.fn().mockRejectedValue(new Error('db-down')),
        findUnique: vi.fn().mockRejectedValue(new Error('db-down')),
        findMany: vi.fn().mockRejectedValue(new Error('db-down')),
        create: vi.fn().mockRejectedValue(new Error('db-down')),
        update: vi.fn().mockRejectedValue(new Error('db-down')),
      },
    } as unknown as PrismaService;
    const svc = new SecurityAbuseService(
      failingPrisma,
      makeIpHash(),
      makeCfg(),
    );
    // None of these should throw.
    const blocked = await svc.isBlocked('IP', '1.1.1.1');
    expect(blocked.blocked).toBe(false);
    const r1 = await svc.recordRateLimitViolation({
      policy: 'AUTH_LOGIN',
      ip: '1.1.1.1',
      userId: null,
      severity: 'LOW',
    });
    expect(r1).toBe(false);
    const r2 = await svc.recordLoginFailed({
      ip: '1.1.1.1',
      email: 'x@y.z',
    });
    expect(r2).toBe(false);
  });

  it('listActiveBlocks + listRecentEvents trả paged data', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAbuseService(prisma, makeIpHash(), makeCfg());
    await svc.createBlock({
      type: 'IP',
      subjectHash: 'a',
      reason: 'T',
      blockSec: 60,
    });
    await svc.createBlock({
      type: 'USER',
      subjectHash: 'u',
      reason: 'T',
      blockSec: 60,
    });
    const blocks = await svc.listActiveBlocks({ limit: 10 });
    expect(blocks.length).toBeGreaterThanOrEqual(2);

    await svc.recordLoginFailed({ ip: '1.1.1.1', email: 'a@b' });
    const events = await svc.listRecentEvents({ limit: 10 });
    expect(events.length).toBeGreaterThan(0);
  });
});
