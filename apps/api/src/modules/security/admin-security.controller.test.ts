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

interface AlertMockOpts {
  alerts?: import('./security-alert.service').SecurityAlertService | null;
}

function makeMocks(opts: AlertMockOpts = {}): {
  ctrl: AdminSecurityController;
  audit: AuditLog[];
  abuse: SecurityAbuseService;
  rateLimit: RateLimitService;
  sessions: import('../auth/session.service').SessionService;
  alerts: import('./security-alert.service').SecurityAlertService;
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
  const sessions = {
    listForAdmin: vi.fn(async () => ({ sessions: [], nextCursor: null })),
    findById: vi.fn(async () => null),
    revokeSession: vi.fn(async () => null),
    toSummary: vi.fn((row) => row),
  } as unknown as import('../auth/session.service').SessionService;
  const defaultAlerts = {
    listAlerts: vi.fn(async () => ({
      alerts: [
        {
          id: 'alert-1',
          type: 'LOGIN_ABUSE',
          severity: 'WARN',
          status: 'OPEN',
          source: 'AUTH',
          eventId: 'evt-x',
          relatedUserId: null,
          relatedCharacterId: null,
          relatedSessionId: null,
          detailsJson: { email: 'a@b.c' },
          createdAt: new Date().toISOString(),
          acknowledgedAt: null,
          acknowledgedByAdminId: null,
          resolvedAt: null,
          resolvedByAdminId: null,
          resolutionNote: null,
        },
      ],
      nextCursor: null,
    })),
    getSummary: vi.fn(async () => ({
      openCritical: 1,
      openWarn: 2,
      blockedSubjects: 0,
      tokenReuseLast24h: 0,
      suspiciousSessionsLast24h: 0,
      rateLimitHitsLast24h: 0,
      latestCriticalEvents: [],
      generatedAt: new Date().toISOString(),
    })),
    acknowledgeAlert: vi.fn(async () => ({
      ok: true as const,
      alert: {
        id: 'alert-1',
        type: 'LOGIN_ABUSE',
        severity: 'WARN',
        status: 'ACKNOWLEDGED',
        source: 'AUTH',
        eventId: 'evt-x',
        relatedUserId: null,
        relatedCharacterId: null,
        relatedSessionId: null,
        detailsJson: {},
        createdAt: new Date().toISOString(),
        acknowledgedAt: new Date().toISOString(),
        acknowledgedByAdminId: 'admin-1',
        resolvedAt: null,
        resolvedByAdminId: null,
        resolutionNote: null,
      },
    })),
    resolveAlert: vi.fn(async () => ({
      ok: true as const,
      alert: {
        id: 'alert-1',
        type: 'LOGIN_ABUSE',
        severity: 'WARN',
        status: 'RESOLVED',
        source: 'AUTH',
        eventId: 'evt-x',
        relatedUserId: null,
        relatedCharacterId: null,
        relatedSessionId: null,
        detailsJson: {},
        createdAt: new Date().toISOString(),
        acknowledgedAt: new Date().toISOString(),
        acknowledgedByAdminId: 'admin-1',
        resolvedAt: new Date().toISOString(),
        resolvedByAdminId: 'admin-1',
        resolutionNote: 'fixed',
      },
    })),
  } as unknown as import('./security-alert.service').SecurityAlertService;
  const alerts =
    opts.alerts === undefined
      ? defaultAlerts
      : (opts.alerts as import('./security-alert.service').SecurityAlertService);
  const ctrl = new AdminSecurityController(
    prisma,
    abuse,
    rateLimit,
    ipHash,
    sessions,
    alerts,
  );
  return { ctrl, audit, abuse, rateLimit, sessions, alerts };
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

  // -------------------- Phase 18.2 admin sessions --------------------

  it('GET /admin/security/sessions → list + audit ADMIN_SECURITY_SESSIONS_VIEW', async () => {
    const { ctrl, audit, sessions } = makeMocks();
    (sessions.listForAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessions: [{ id: 's1', userId: 'u1' }],
      nextCursor: null,
    });
    const r = await ctrl.listSessions(makeReq() as Request, undefined, 'ALL');
    expect(r.ok).toBe(true);
    expect(r.data.sessions.length).toBe(1);
    expect(typeof r.data.generatedAt).toBe('string');
    expect(
      audit.some((a) => a.action === 'ADMIN_SECURITY_SESSIONS_VIEW'),
    ).toBe(true);
  });

  it('GET /admin/security/sessions INVALID_STATUS khi status sai', async () => {
    const { ctrl } = makeMocks();
    await expect(
      ctrl.listSessions(makeReq() as Request, undefined, 'NOPE'),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('GET /admin/security/sessions forward userId filter', async () => {
    const { ctrl, sessions } = makeMocks();
    await ctrl.listSessions(makeReq() as Request, 'u-abc');
    const call = (sessions.listForAdmin as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.userId).toBe('u-abc');
  });

  it('POST /admin/security/sessions/:id/revoke → success + audit', async () => {
    const { ctrl, audit, sessions } = makeMocks();
    (sessions.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'sess-1',
      userId: 'u-victim',
      revokedAt: null,
    });
    (sessions.revokeSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      {
        id: 'sess-1',
        userId: 'u-victim',
        revokedAt: new Date(),
        revokedReason: 'ADMIN_REVOKE',
      },
    );
    const r = await ctrl.revokeSession(makeReq() as Request, 'sess-1');
    expect(r.ok).toBe(true);
    const log = audit.find((a) => a.action === 'ADMIN_SECURITY_SESSION_REVOKE');
    expect(log).toBeDefined();
    expect((log!.meta as { sessionId: string }).sessionId).toBe('sess-1');
    expect((log!.meta as { userId: string }).userId).toBe('u-victim');
    expect((log!.meta as { reason: string }).reason).toBe('ADMIN_REVOKE');
  });

  it('POST /admin/security/sessions/:id/revoke → 404 + audit FAILED khi session không tồn tại', async () => {
    const { ctrl, audit, sessions } = makeMocks();
    (sessions.findById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      null,
    );
    let captured: HttpException | undefined;
    try {
      await ctrl.revokeSession(makeReq() as Request, 'ghost');
    } catch (err) {
      captured = err as HttpException;
    }
    expect(captured?.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(
      audit.some((a) => a.action === 'ADMIN_SECURITY_SESSION_REVOKE_FAILED'),
    ).toBe(true);
  });

  it('POST revoke INVALID_INPUT khi sessionId rỗng', async () => {
    const { ctrl } = makeMocks();
    await expect(
      ctrl.revokeSession(makeReq() as Request, ''),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  // ============== Phase 18.3 — alert workflow endpoints ==============

  it('GET /admin/security/alerts → list + audit ADMIN_SECURITY_ALERTS_VIEW', async () => {
    const { ctrl, audit, alerts } = makeMocks();
    const r = await ctrl.listAlerts(makeReq() as Request);
    expect(r.ok).toBe(true);
    expect(r.data.alerts.length).toBe(1);
    expect(
      audit.some((a) => a.action === 'ADMIN_SECURITY_ALERTS_VIEW'),
    ).toBe(true);
    expect((alerts.listAlerts as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('GET /admin/security/alerts forward filter severity/status/type/source/userId/from/to', async () => {
    const { ctrl, alerts } = makeMocks();
    await ctrl.listAlerts(
      makeReq() as Request,
      'OPEN',
      'CRITICAL',
      'LOGIN_ABUSE',
      'AUTH',
      '2026-06-29T00:00:00.000Z',
      '2026-06-30T00:00:00.000Z',
      'user-42',
      '20',
    );
    const args = (alerts.listAlerts as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.status).toBe('OPEN');
    expect(args.severity).toBe('CRITICAL');
    expect(args.type).toBe('LOGIN_ABUSE');
    expect(args.source).toBe('AUTH');
    expect(args.userId).toBe('user-42');
    expect(args.limit).toBe(20);
    expect(args.from instanceof Date).toBe(true);
    expect(args.to instanceof Date).toBe(true);
  });

  it('GET /admin/security/alerts INVALID_STATUS khi status sai', async () => {
    const { ctrl } = makeMocks();
    await expect(
      ctrl.listAlerts(makeReq() as Request, 'BAD'),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('GET /admin/security/summary → data + audit', async () => {
    const { ctrl, audit } = makeMocks();
    const r = await ctrl.summary(makeReq() as Request);
    expect(r.ok).toBe(true);
    expect(r.data.openCritical).toBe(1);
    expect(r.data.openWarn).toBe(2);
    expect(
      audit.some((a) => a.action === 'ADMIN_SECURITY_SUMMARY_VIEW'),
    ).toBe(true);
  });

  it('POST /admin/security/alerts/:id/ack → success + audit', async () => {
    const { ctrl, audit, alerts } = makeMocks();
    const r = await ctrl.ackAlert(makeReq() as Request, 'alert-1');
    expect(r.ok).toBe(true);
    expect(r.data.alert.status).toBe('ACKNOWLEDGED');
    expect(
      audit.some((a) => a.action === 'ADMIN_SECURITY_ALERT_ACK'),
    ).toBe(true);
    expect(
      (alerts.acknowledgeAlert as ReturnType<typeof vi.fn>).mock.calls[0],
    ).toEqual(['alert-1', 'admin-1']);
  });

  it('POST ack → 404 + audit FAILED khi alert không tồn tại', async () => {
    const { ctrl, audit, alerts } = makeMocks();
    (alerts.acknowledgeAlert as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      { ok: false, code: 'ALERT_NOT_FOUND' },
    );
    let captured: HttpException | undefined;
    try {
      await ctrl.ackAlert(makeReq() as Request, 'ghost');
    } catch (err) {
      captured = err as HttpException;
    }
    expect(captured?.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(
      audit.some((a) => a.action === 'ADMIN_SECURITY_ALERT_ACK_FAILED'),
    ).toBe(true);
  });

  it('POST ack → 409 ALERT_ALREADY_RESOLVED khi alert đã close', async () => {
    const { ctrl, alerts } = makeMocks();
    (alerts.acknowledgeAlert as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      { ok: false, code: 'ALERT_ALREADY_RESOLVED' },
    );
    let captured: HttpException | undefined;
    try {
      await ctrl.ackAlert(makeReq() as Request, 'alert-1');
    } catch (err) {
      captured = err as HttpException;
    }
    expect(captured?.getStatus()).toBe(HttpStatus.CONFLICT);
  });

  it('POST /admin/security/alerts/:id/resolve → success + audit + forward note', async () => {
    const { ctrl, audit, alerts } = makeMocks();
    const r = await ctrl.resolveAlert(
      makeReq() as Request,
      'alert-1',
      { note: 'fixed' },
    );
    expect(r.ok).toBe(true);
    expect(r.data.alert.status).toBe('RESOLVED');
    const call = (alerts.resolveAlert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call).toEqual(['alert-1', 'admin-1', 'fixed']);
    expect(
      audit.some((a) => a.action === 'ADMIN_SECURITY_ALERT_RESOLVE'),
    ).toBe(true);
  });

  it('POST resolve → 400 INVALID_NOTE khi note trống', async () => {
    const { ctrl, alerts } = makeMocks();
    (alerts.resolveAlert as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      { ok: false, code: 'INVALID_NOTE' },
    );
    let captured: HttpException | undefined;
    try {
      await ctrl.resolveAlert(makeReq() as Request, 'alert-1', { note: '' });
    } catch (err) {
      captured = err as HttpException;
    }
    expect(captured?.getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });

  it('POST resolve → 409 khi đã RESOLVED trước đó', async () => {
    const { ctrl, alerts } = makeMocks();
    (alerts.resolveAlert as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      { ok: false, code: 'ALERT_ALREADY_RESOLVED' },
    );
    let captured: HttpException | undefined;
    try {
      await ctrl.resolveAlert(
        makeReq() as Request,
        'alert-1',
        { note: 'late' },
      );
    } catch (err) {
      captured = err as HttpException;
    }
    expect(captured?.getStatus()).toBe(HttpStatus.CONFLICT);
  });
});
