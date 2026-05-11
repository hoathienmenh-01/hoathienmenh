/**
 * Phase 18.1 — AdminSecurityController unit tests.
 *
 * Pure-unit: bypass AdminGuard (instantiate trực tiếp). Test:
 *   - GET /admin/security/blocks → list active blocks + audit row.
 *   - GET /admin/security/events → list events + audit row.
 *   - GET /admin/security/rate-limit/status → peek without increment.
 *   - POST /admin/security/blocks/:id/lift → lift block + audit row.
 *   - Lift block 404 khi không tồn tại / đã lift → audit FAILED row.
 *   - Privacy: response chỉ chứa ipHash, KHÔNG raw IP.
 *   - Invalid policy/severity/type → 400 INVALID_*.
 */
import { describe, expect, it, vi } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { AdminSecurityController } from './admin-security.controller';
import type { SecurityAbuseService } from './security-abuse.service';
import type { RateLimitService } from './rate-limit.service';
import type { IpHashService } from './ip-hash.service';
import type { PrismaService } from '../../common/prisma.service';

type AdminReq = Request & { userId: string };

function makeReq(userId = 'admin-1'): AdminReq {
  return { userId } as AdminReq;
}

interface AuditLog {
  actorUserId: string;
  action: string;
  meta: Record<string, unknown>;
}

function makeMocks(): {
  ctrl: AdminSecurityController;
  audit: AuditLog[];
  abuse: SecurityAbuseService;
  rateLimit: RateLimitService;
} {
  const audit: AuditLog[] = [];
  // hex-like stub (64 char) so privacy assertions match real shape.
  const fakeHash = 'a'.repeat(64);
  const prisma = {
    adminAuditLog: {
      create: vi.fn(async ({ data }: { data: AuditLog }) => {
        audit.push(data);
        return data;
      }),
    },
  } as unknown as PrismaService;
  const abuse = {
    listActiveBlocks: vi.fn(async () => [
      {
        id: 'blk-1',
        type: 'IP' as const,
        subjectHash: fakeHash,
        reason: 'TEST',
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      },
    ]),
    listRecentEvents: vi.fn(async () => [
      {
        id: 'evt-1',
        type: 'RATE_LIMIT_VIOLATION',
        severity: 'INFO',
        ipHash: fakeHash,
        userId: null,
        characterId: null,
        policy: 'SHOP_BUY',
        detailJson: { policy: 'SHOP_BUY' },
        createdAt: new Date(),
      },
    ]),
    liftBlock: vi.fn(),
  } as unknown as SecurityAbuseService;
  const rateLimit = {
    peek: vi.fn(async () => ({
      count: 3,
      remaining: 27,
      resetAt: Date.now() + 60_000,
    })),
  } as unknown as RateLimitService;
  const ipHash = {
    hashIp: () => fakeHash,
  } as unknown as IpHashService;
  const ctrl = new AdminSecurityController(prisma, abuse, rateLimit, ipHash);
  return { ctrl, audit, abuse, rateLimit };
}

describe('AdminSecurityController', () => {
  it('GET /admin/security/blocks → list + audit', async () => {
    const { ctrl, audit } = makeMocks();
    const r = await ctrl.listBlocks(makeReq() as Request);
    expect(r.ok).toBe(true);
    expect(r.data.blocks.length).toBe(1);
    expect(r.data.blocks[0].subjectHash).not.toContain('1.2.3.4');
    expect(audit.some((a) => a.action === 'ADMIN_SECURITY_BLOCKS_VIEW')).toBe(
      true,
    );
  });

  it('GET /admin/security/events → list + audit', async () => {
    const { ctrl, audit } = makeMocks();
    const r = await ctrl.listEvents(makeReq() as Request);
    expect(r.ok).toBe(true);
    expect(r.data.events.length).toBe(1);
    // Privacy: ipHash chỉ là hash, không phải raw IP.
    expect(r.data.events[0].ipHash).not.toContain('.');
    expect(audit.some((a) => a.action === 'ADMIN_SECURITY_EVENTS_VIEW')).toBe(
      true,
    );
  });

  it('GET events INVALID_SEVERITY khi severity sai', async () => {
    const { ctrl } = makeMocks();
    await expect(
      ctrl.listEvents(makeReq() as Request, undefined, undefined, 'WAT'),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('GET /admin/security/rate-limit/status peek không increment', async () => {
    const { ctrl, rateLimit } = makeMocks();
    const r = await ctrl.rateLimitStatus('SHOP_BUY', 'USER', 'user-1');
    expect(r.ok).toBe(true);
    expect(r.data.count).toBe(3);
    expect(rateLimit.peek).toHaveBeenCalledTimes(1);
  });

  it('rate-limit/status INVALID_POLICY khi policy sai', async () => {
    const { ctrl } = makeMocks();
    await expect(
      ctrl.rateLimitStatus('NOT_A_POLICY', 'USER', 'x'),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('POST /admin/security/blocks/:id/lift → success + audit', async () => {
    const { ctrl, audit, abuse } = makeMocks();
    (abuse.liftBlock as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'blk-1',
      type: 'IP',
      subjectHash: 'h-1.2.3.4',
      reason: 'TEST',
    });
    const r = await ctrl.liftBlock(makeReq() as Request, 'blk-1');
    expect(r.ok).toBe(true);
    expect(r.data.block.id).toBe('blk-1');
    expect(audit.some((a) => a.action === 'ADMIN_SECURITY_BLOCK_LIFT')).toBe(
      true,
    );
  });

  it('POST lift → 404 + audit FAILED khi không tồn tại', async () => {
    const { ctrl, audit, abuse } = makeMocks();
    (abuse.liftBlock as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    let captured: HttpException | undefined;
    try {
      await ctrl.liftBlock(makeReq() as Request, 'ghost');
    } catch (err) {
      captured = err as HttpException;
    }
    expect(captured?.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(
      audit.some((a) => a.action === 'ADMIN_SECURITY_BLOCK_LIFT_FAILED'),
    ).toBe(true);
  });

  it('POST lift INVALID_INPUT khi blockId rỗng', async () => {
    const { ctrl } = makeMocks();
    await expect(ctrl.liftBlock(makeReq() as Request, '')).rejects.toMatchObject(
      { status: HttpStatus.BAD_REQUEST },
    );
  });
});
