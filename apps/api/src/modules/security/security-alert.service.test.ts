/**
 * Phase 18.3 — SecurityAlertService unit tests.
 *
 * Pure-unit: mock PrismaService với in-memory fake table. Test:
 *   - `createFromEvent`: tạo alert cho event WARN/CRITICAL; skip INFO.
 *   - `createFromEvent`: idempotent theo `eventId` (gọi 2 lần → 1 row).
 *   - `createFromEvent`: fail-soft khi DB throw (return null, không crash).
 *   - `createDirect`: tạo alert thuần WARN/CRITICAL; skip INFO.
 *   - `listAlerts`: filter severity/status/type/source/userId/from/to.
 *   - `listAlerts`: pagination cursor + nextCursor null khi hết.
 *   - `acknowledgeAlert`: OPEN → ACKNOWLEDGED; ACKNOWLEDGED idempotent;
 *     RESOLVED reject `ALERT_ALREADY_RESOLVED`; not-found reject.
 *   - `resolveAlert`: OPEN → RESOLVED; ACKNOWLEDGED → RESOLVED;
 *     RESOLVED reject; invalid note reject `INVALID_NOTE`.
 *   - `resolveAlert`: OPEN skip-ack path cũng set acknowledgedAt/By.
 *   - `getSummary`: tính đúng openCritical/openWarn + tokenReuse +
 *     suspicious + rateLimit + blockedSubjects + latestCriticalEvents.
 *   - `getSummary`: fail-soft khi 1 query throw → count đó = 0.
 *   - Privacy: response KHÔNG có raw IP / token / cookie / password.
 */
import { describe, expect, it, vi } from 'vitest';
import { SecurityAlertService } from './security-alert.service';
import type { PrismaService } from '../../common/prisma.service';

interface FakeAlertRow {
  id: string;
  type: string;
  severity: string;
  status: string;
  source: string;
  eventId: string | null;
  relatedUserId: string | null;
  relatedCharacterId: string | null;
  relatedSessionId: string | null;
  detailsJson: unknown;
  createdAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedByAdminId: string | null;
  resolvedAt: Date | null;
  resolvedByAdminId: string | null;
  resolutionNote: string | null;
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
  expiresAt: Date;
  liftedAt: Date | null;
}

function makePrisma(): {
  prisma: PrismaService;
  alerts: FakeAlertRow[];
  events: FakeEventRow[];
  blocks: FakeBlockRow[];
} {
  const alerts: FakeAlertRow[] = [];
  const events: FakeEventRow[] = [];
  const blocks: FakeBlockRow[] = [];
  let seq = 0;

  const matchAlert = (
    row: FakeAlertRow,
    where: Record<string, unknown>,
  ): boolean => {
    if (where.id && row.id !== where.id) return false;
    if (where.eventId && row.eventId !== where.eventId) return false;
    if (where.severity && row.severity !== where.severity) return false;
    if (where.status && row.status !== where.status) return false;
    if (where.type && row.type !== where.type) return false;
    if (where.source && row.source !== where.source) return false;
    if (where.relatedUserId && row.relatedUserId !== where.relatedUserId)
      return false;
    if (where.createdAt && typeof where.createdAt === 'object') {
      const f = where.createdAt as { gte?: Date; lte?: Date };
      if (f.gte && row.createdAt < f.gte) return false;
      if (f.lte && row.createdAt > f.lte) return false;
    }
    return true;
  };

  const prisma = {
    securityAlert: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        alerts.find((r) => matchAlert(r, where)) ?? null,
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          alerts.find((r) => r.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row: FakeAlertRow = {
          id: `alert-${seq}`,
          type: data.type as string,
          severity: data.severity as string,
          status: (data.status as string) ?? 'OPEN',
          source: data.source as string,
          eventId: (data.eventId as string | null) ?? null,
          relatedUserId: (data.relatedUserId as string | null) ?? null,
          relatedCharacterId: (data.relatedCharacterId as string | null) ?? null,
          relatedSessionId: (data.relatedSessionId as string | null) ?? null,
          detailsJson: data.detailsJson ?? {},
          createdAt: new Date(),
          acknowledgedAt: null,
          acknowledgedByAdminId: null,
          resolvedAt: null,
          resolvedByAdminId: null,
          resolutionNote: null,
        };
        alerts.push(row);
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
          const r = alerts.find((x) => x.id === where.id);
          if (!r) throw new Error('not-found');
          for (const [k, v] of Object.entries(data)) {
            (r as unknown as Record<string, unknown>)[k] = v;
          }
          return r;
        },
      ),
      findMany: vi.fn(
        async ({
          where = {},
          take = 50,
          cursor,
          skip,
        }: {
          where?: Record<string, unknown>;
          take?: number;
          cursor?: { id: string };
          skip?: number;
        }) => {
          let sorted = alerts
            .filter((r) => matchAlert(r, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          if (cursor) {
            const idx = sorted.findIndex((r) => r.id === cursor.id);
            if (idx >= 0) {
              sorted = sorted.slice(idx + (skip ?? 0));
            }
          }
          return sorted.slice(0, take);
        },
      ),
      count: vi.fn(async ({ where = {} }: { where?: Record<string, unknown> } = {}) =>
        alerts.filter((r) => matchAlert(r, where)).length,
      ),
    },
    securityEvent: {
      findMany: vi.fn(
        async ({
          where = {},
          take = 50,
        }: {
          where?: Record<string, unknown>;
          take?: number;
        }) => {
          let sorted = events
            .filter((r) => {
              if (where.type && r.type !== where.type) return false;
              if (where.severity && r.severity !== where.severity) return false;
              return true;
            })
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return sorted.slice(0, take);
        },
      ),
      count: vi.fn(async ({ where = {} }: { where?: Record<string, unknown> } = {}) =>
        events.filter((r) => {
          if (where.type && r.type !== where.type) return false;
          if (where.createdAt && typeof where.createdAt === 'object') {
            const f = where.createdAt as { gte?: Date };
            if (f.gte && r.createdAt < f.gte) return false;
          }
          return true;
        }).length,
      ),
    },
    securityBlock: {
      count: vi.fn(async () =>
        blocks.filter((b) => !b.liftedAt && b.expiresAt > new Date()).length,
      ),
    },
  } as unknown as PrismaService;

  return { prisma, alerts, events, blocks };
}

describe('SecurityAlertService.createFromEvent', () => {
  it('tạo alert CRITICAL cho REFRESH_TOKEN_REUSED event', async () => {
    const { prisma, alerts } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    const out = await svc.createFromEvent({
      eventId: 'evt-1',
      eventType: 'REFRESH_TOKEN_REUSED',
      eventSeverity: 'CRITICAL',
      relatedUserId: 'u-1',
      relatedSessionId: 'sess-1',
      detailsJson: { reason: 'rotated_token_reused' },
    });
    expect(out).not.toBeNull();
    expect(out?.severity).toBe('CRITICAL');
    expect(out?.type).toBe('REFRESH_TOKEN_REUSED');
    expect(out?.source).toBe('SESSION');
    expect(out?.status).toBe('OPEN');
    expect(out?.eventId).toBe('evt-1');
    expect(out?.relatedUserId).toBe('u-1');
    expect(out?.relatedSessionId).toBe('sess-1');
    expect(alerts.length).toBe(1);
  });

  it('tạo alert WARN cho LOGIN_FAILED', async () => {
    const { prisma, alerts } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    const out = await svc.createFromEvent({
      eventId: 'evt-2',
      eventType: 'LOGIN_FAILED',
      eventSeverity: 'WARN',
    });
    expect(out?.severity).toBe('WARN');
    expect(out?.type).toBe('LOGIN_ABUSE');
    expect(out?.source).toBe('AUTH');
    expect(alerts.length).toBe(1);
  });

  it('skip INFO event (vd SESSION_CREATED) → return null + không tạo row', async () => {
    const { prisma, alerts } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    const out = await svc.createFromEvent({
      eventId: 'evt-3',
      eventType: 'SESSION_CREATED',
      eventSeverity: 'INFO',
    });
    expect(out).toBeNull();
    expect(alerts.length).toBe(0);
  });

  it('idempotent theo eventId — gọi 2 lần chỉ tạo 1 row', async () => {
    const { prisma, alerts } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    const first = await svc.createFromEvent({
      eventId: 'evt-dup',
      eventType: 'LOGIN_FAILED',
      eventSeverity: 'WARN',
    });
    const second = await svc.createFromEvent({
      eventId: 'evt-dup',
      eventType: 'LOGIN_FAILED',
      eventSeverity: 'WARN',
    });
    expect(first?.id).toBe(second?.id);
    expect(alerts.length).toBe(1);
  });

  it('unknown event type → fail-soft (OTHER/INFO → skip, không crash)', async () => {
    const { prisma, alerts } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    const out = await svc.createFromEvent({
      eventId: 'evt-unknown',
      eventType: 'NEW_EVENT_TYPE_FROM_FUTURE',
      eventSeverity: 'WAT',
    });
    expect(out).toBeNull();
    expect(alerts.length).toBe(0);
  });

  it('DB throw → fail-soft return null', async () => {
    const { prisma } = makePrisma();
    (prisma.securityAlert as unknown as { create: ReturnType<typeof vi.fn> }).create =
      vi.fn(async () => {
        throw new Error('db-down');
      });
    const svc = new SecurityAlertService(prisma);
    const out = await svc.createFromEvent({
      eventId: 'evt-fail',
      eventType: 'REFRESH_TOKEN_REUSED',
      eventSeverity: 'CRITICAL',
    });
    expect(out).toBeNull();
  });

  it('detailsJson sanitized không chứa raw IP / token / password', async () => {
    const { prisma, alerts } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    await svc.createFromEvent({
      eventId: 'evt-priv',
      eventType: 'REFRESH_TOKEN_REUSED',
      eventSeverity: 'CRITICAL',
      detailsJson: { reason: 'rotated', oldJti: 'jti-1' },
    });
    const json = JSON.stringify(alerts[0].detailsJson);
    expect(json).not.toMatch(/password/i);
    expect(json).not.toMatch(/cookie/i);
    expect(json).not.toMatch(/127\.0\.0\.1/);
    expect(json).not.toMatch(/refresh.*hash/i);
  });
});

describe('SecurityAlertService.createDirect', () => {
  it('skip nếu severity INFO', async () => {
    const { prisma, alerts } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    const out = await svc.createDirect({
      type: 'OTHER',
      severity: 'INFO',
      source: 'OTHER',
    });
    expect(out).toBeNull();
    expect(alerts.length).toBe(0);
  });

  it('tạo direct alert WARN', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    const out = await svc.createDirect({
      type: 'OTHER',
      severity: 'WARN',
      source: 'OTHER',
      detailsJson: { reason: 'manual-investigate' },
    });
    expect(out?.severity).toBe('WARN');
    expect(out?.eventId).toBeNull();
  });

  it('DB throw → fail-soft null', async () => {
    const { prisma } = makePrisma();
    (prisma.securityAlert as unknown as { create: ReturnType<typeof vi.fn> }).create =
      vi.fn(async () => {
        throw new Error('db-down');
      });
    const svc = new SecurityAlertService(prisma);
    const out = await svc.createDirect({
      type: 'OTHER',
      severity: 'CRITICAL',
      source: 'OTHER',
    });
    expect(out).toBeNull();
  });
});

describe('SecurityAlertService.listAlerts', () => {
  async function seed(svc: SecurityAlertService): Promise<void> {
    await svc.createFromEvent({
      eventId: 'e-a',
      eventType: 'REFRESH_TOKEN_REUSED',
      eventSeverity: 'CRITICAL',
      relatedUserId: 'u-1',
    });
    await svc.createFromEvent({
      eventId: 'e-b',
      eventType: 'LOGIN_FAILED',
      eventSeverity: 'WARN',
      relatedUserId: 'u-2',
    });
    await svc.createFromEvent({
      eventId: 'e-c',
      eventType: 'IP_BLOCKED',
      eventSeverity: 'CRITICAL',
    });
  }

  it('list all (no filter) trả 3 row sorted desc', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    await seed(svc);
    const out = await svc.listAlerts({});
    expect(out.alerts.length).toBe(3);
    expect(out.nextCursor).toBeNull();
  });

  it('filter severity=CRITICAL → 2 row', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    await seed(svc);
    const out = await svc.listAlerts({ severity: 'CRITICAL' });
    expect(out.alerts.length).toBe(2);
    out.alerts.forEach((a) => expect(a.severity).toBe('CRITICAL'));
  });

  it('filter type=REFRESH_TOKEN_REUSED', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    await seed(svc);
    const out = await svc.listAlerts({ type: 'REFRESH_TOKEN_REUSED' });
    expect(out.alerts.length).toBe(1);
    expect(out.alerts[0].type).toBe('REFRESH_TOKEN_REUSED');
  });

  it('filter source=SESSION', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    await seed(svc);
    const out = await svc.listAlerts({ source: 'SESSION' });
    expect(out.alerts.length).toBe(1);
    expect(out.alerts[0].source).toBe('SESSION');
  });

  it('filter userId', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    await seed(svc);
    const out = await svc.listAlerts({ userId: 'u-2' });
    expect(out.alerts.length).toBe(1);
    expect(out.alerts[0].relatedUserId).toBe('u-2');
  });

  it('pagination cursor trả nextCursor khi còn page', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    await seed(svc);
    const page1 = await svc.listAlerts({ limit: 2 });
    expect(page1.alerts.length).toBe(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await svc.listAlerts({
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.alerts.length).toBeGreaterThanOrEqual(0);
    expect(page2.nextCursor).toBeNull();
  });
});

describe('SecurityAlertService.acknowledgeAlert', () => {
  it('OPEN → ACKNOWLEDGED + set acknowledgedAt/By', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    const created = await svc.createFromEvent({
      eventId: 'e1',
      eventType: 'LOGIN_FAILED',
      eventSeverity: 'WARN',
    });
    const out = await svc.acknowledgeAlert(created!.id, 'admin-1');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.alert.status).toBe('ACKNOWLEDGED');
      expect(out.alert.acknowledgedByAdminId).toBe('admin-1');
      expect(out.alert.acknowledgedAt).not.toBeNull();
    }
  });

  it('ACKNOWLEDGED idempotent (no-op, return current)', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    const created = await svc.createFromEvent({
      eventId: 'e2',
      eventType: 'LOGIN_FAILED',
      eventSeverity: 'WARN',
    });
    await svc.acknowledgeAlert(created!.id, 'admin-1');
    const out = await svc.acknowledgeAlert(created!.id, 'admin-2');
    expect(out.ok).toBe(true);
    if (out.ok) {
      // Acknowledged by first admin, not second.
      expect(out.alert.acknowledgedByAdminId).toBe('admin-1');
    }
  });

  it('RESOLVED → reject ALERT_ALREADY_RESOLVED', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    const created = await svc.createFromEvent({
      eventId: 'e3',
      eventType: 'LOGIN_FAILED',
      eventSeverity: 'WARN',
    });
    await svc.resolveAlert(created!.id, 'admin-1', 'fixed');
    const out = await svc.acknowledgeAlert(created!.id, 'admin-2');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('ALERT_ALREADY_RESOLVED');
  });

  it('not-found → reject ALERT_NOT_FOUND', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    const out = await svc.acknowledgeAlert('missing-id', 'admin-1');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('ALERT_NOT_FOUND');
  });
});

describe('SecurityAlertService.resolveAlert', () => {
  it('OPEN → RESOLVED + set ack snapshot (skip-ack path)', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    const created = await svc.createFromEvent({
      eventId: 'e1',
      eventType: 'LOGIN_FAILED',
      eventSeverity: 'WARN',
    });
    const out = await svc.resolveAlert(
      created!.id,
      'admin-1',
      'Blocked offender IP.',
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.alert.status).toBe('RESOLVED');
      expect(out.alert.resolvedByAdminId).toBe('admin-1');
      expect(out.alert.resolutionNote).toBe('Blocked offender IP.');
      // Skip-ack: acknowledged snapshot cũng được set.
      expect(out.alert.acknowledgedByAdminId).toBe('admin-1');
    }
  });

  it('ACKNOWLEDGED → RESOLVED, giữ ack info gốc', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    const created = await svc.createFromEvent({
      eventId: 'e2',
      eventType: 'LOGIN_FAILED',
      eventSeverity: 'WARN',
    });
    await svc.acknowledgeAlert(created!.id, 'mod-1');
    const out = await svc.resolveAlert(created!.id, 'admin-1', 'done');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.alert.status).toBe('RESOLVED');
      expect(out.alert.acknowledgedByAdminId).toBe('mod-1');
      expect(out.alert.resolvedByAdminId).toBe('admin-1');
    }
  });

  it('RESOLVED → reject ALERT_ALREADY_RESOLVED', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    const created = await svc.createFromEvent({
      eventId: 'e3',
      eventType: 'LOGIN_FAILED',
      eventSeverity: 'WARN',
    });
    await svc.resolveAlert(created!.id, 'admin-1', 'fixed');
    const out = await svc.resolveAlert(created!.id, 'admin-2', 'again');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('ALERT_ALREADY_RESOLVED');
  });

  it('empty/whitespace note → reject INVALID_NOTE', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    const created = await svc.createFromEvent({
      eventId: 'e4',
      eventType: 'LOGIN_FAILED',
      eventSeverity: 'WARN',
    });
    const out1 = await svc.resolveAlert(created!.id, 'admin-1', '');
    expect(out1.ok).toBe(false);
    if (!out1.ok) expect(out1.code).toBe('INVALID_NOTE');
    const out2 = await svc.resolveAlert(created!.id, 'admin-1', '   ');
    expect(out2.ok).toBe(false);
    if (!out2.ok) expect(out2.code).toBe('INVALID_NOTE');
    const out3 = await svc.resolveAlert(created!.id, 'admin-1', 42);
    expect(out3.ok).toBe(false);
    if (!out3.ok) expect(out3.code).toBe('INVALID_NOTE');
  });

  it('not-found → reject ALERT_NOT_FOUND', async () => {
    const { prisma } = makePrisma();
    const svc = new SecurityAlertService(prisma);
    const out = await svc.resolveAlert('missing', 'admin-1', 'note');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('ALERT_NOT_FOUND');
  });
});

describe('SecurityAlertService.getSummary', () => {
  it('đếm openCritical/openWarn + 24h windows + blockedSubjects', async () => {
    const { prisma, alerts, events, blocks } = makePrisma();
    const now = new Date();
    // 2 OPEN CRITICAL
    alerts.push(
      ...makeAlert(['CRITICAL', 'OPEN'], ['CRITICAL', 'OPEN']),
    );
    // 1 OPEN WARN
    alerts.push(...makeAlert(['WARN', 'OPEN']));
    // 1 RESOLVED CRITICAL (không tính vào openCritical)
    alerts.push(...makeAlert(['CRITICAL', 'RESOLVED']));

    // 3 RATE_LIMIT_VIOLATION trong 24h
    for (let i = 0; i < 3; i++) {
      events.push(makeEvt('RATE_LIMIT_VIOLATION', 'INFO', now));
    }
    // 1 RATE_LIMIT_VIOLATION ngoài 24h (không tính)
    events.push(makeEvt('RATE_LIMIT_VIOLATION', 'INFO', new Date(0)));
    // 2 REFRESH_TOKEN_REUSED
    events.push(makeEvt('REFRESH_TOKEN_REUSED', 'CRITICAL', now));
    events.push(makeEvt('REFRESH_TOKEN_REUSED', 'CRITICAL', now));
    // 1 SESSION_SUSPICIOUS
    events.push(makeEvt('SESSION_SUSPICIOUS', 'WARN', now));

    // 2 active blocks
    blocks.push({
      id: 'b1',
      type: 'IP',
      subjectHash: 'h1',
      expiresAt: new Date(Date.now() + 60_000),
      liftedAt: null,
    });
    blocks.push({
      id: 'b2',
      type: 'USER',
      subjectHash: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      liftedAt: null,
    });

    const svc = new SecurityAlertService(prisma);
    const out = await svc.getSummary();
    expect(out.openCritical).toBe(2);
    expect(out.openWarn).toBe(1);
    expect(out.blockedSubjects).toBe(2);
    expect(out.tokenReuseLast24h).toBe(2);
    expect(out.suspiciousSessionsLast24h).toBe(1);
    expect(out.rateLimitHitsLast24h).toBe(3);
    expect(out.generatedAt).toMatch(/T/);
  });

  it('fail-soft khi 1 query throw → count đó = 0, không kéo cả summary', async () => {
    const { prisma } = makePrisma();
    (
      prisma.securityAlert as unknown as { count: ReturnType<typeof vi.fn> }
    ).count = vi.fn(async () => {
      throw new Error('db-down');
    });
    const svc = new SecurityAlertService(prisma);
    const out = await svc.getSummary();
    expect(out.openCritical).toBe(0);
    expect(out.openWarn).toBe(0);
  });

  it('latestCriticalEvents top 5 desc + chỉ chứa ipHash, không raw IP', async () => {
    const { prisma, events } = makePrisma();
    for (let i = 0; i < 7; i++) {
      events.push(
        makeEvt(
          'REFRESH_TOKEN_REUSED',
          'CRITICAL',
          new Date(2026, 0, i + 1),
          `hash-${i}`,
        ),
      );
    }
    const svc = new SecurityAlertService(prisma);
    const out = await svc.getSummary();
    expect(out.latestCriticalEvents.length).toBe(5);
    out.latestCriticalEvents.forEach((e) => {
      expect(e.severity).toBe('CRITICAL');
      // ipHash hex-like — không phải raw IP.
      if (e.ipHash) {
        expect(e.ipHash).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
      }
    });
  });
});

function makeAlert(...keys: Array<[string, string]>): FakeAlertRow[] {
  return keys.map(([severity, status], i) => ({
    id: `seed-${severity}-${status}-${i}-${Math.random()}`,
    type: 'OTHER',
    severity,
    status,
    source: 'OTHER',
    eventId: null,
    relatedUserId: null,
    relatedCharacterId: null,
    relatedSessionId: null,
    detailsJson: {},
    createdAt: new Date(),
    acknowledgedAt: null,
    acknowledgedByAdminId: null,
    resolvedAt: null,
    resolvedByAdminId: null,
    resolutionNote: null,
  }));
}

function makeEvt(
  type: string,
  severity: string,
  createdAt: Date,
  ipHash: string | null = null,
): FakeEventRow {
  return {
    id: `evt-${Math.random()}`,
    type,
    severity,
    ipHash,
    userId: null,
    characterId: null,
    policy: null,
    detailJson: {},
    createdAt,
  };
}
