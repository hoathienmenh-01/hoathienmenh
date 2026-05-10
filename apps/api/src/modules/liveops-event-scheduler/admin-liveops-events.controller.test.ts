/**
 * Phase 15.1–15.2 — AdminLiveOpsEventsController unit tests.
 *
 * Test pure-unit (instantiate controller trực tiếp + bypass `AdminGuard`
 * — guard logic test riêng ở `admin.guard.test.ts`). Cover:
 *   - listEvents OK.
 *   - createEvent OK + audit log written.
 *   - createEvent INVALID_INPUT khi body malformed.
 *   - createEvent maps service error code → HttpException.
 *   - updateEvent OK + audit log.
 *   - disableEvent OK + audit log.
 *   - recomputeStatus OK + audit log.
 */
import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { AdminLiveOpsEventsController } from './admin-liveops-events.controller';
import {
  LiveOpsEventSchedulerError,
  type LiveOpsEventSchedulerService,
  type LiveOpsScheduledEventView,
  type RecomputeSummary,
} from './liveops-event-scheduler.service';

type AdminReq = Request & { userId: string; role: 'ADMIN' | 'MOD' | 'PLAYER' };

function makeReq(userId = 'admin1'): AdminReq {
  return {
    userId,
    role: 'ADMIN',
    cookies: {},
  } as unknown as AdminReq;
}

function makeView(over: Partial<LiveOpsScheduledEventView> = {}): LiveOpsScheduledEventView {
  return {
    id: 'ev1',
    key: 'event-001',
    type: 'DOUBLE_DUNGEON_DROP',
    title: 'Test',
    description: '',
    status: 'SCHEDULED',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-08-02T00:00:00.000Z',
    configJson: { multiplier: 1.5 },
    createdByAdminId: 'admin1',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

interface Stubs {
  listEvents?: () => Promise<LiveOpsScheduledEventView[]>;
  createEvent?: LiveOpsEventSchedulerService['createEvent'];
  updateEvent?: LiveOpsEventSchedulerService['updateEvent'];
  disableEvent?: LiveOpsEventSchedulerService['disableEvent'];
  recomputeStatuses?: () => Promise<RecomputeSummary>;
}

function makeController(stubs: Stubs = {}): {
  c: AdminLiveOpsCronControllerLike;
  audit: { count: number; actions: string[] };
} {
  const audit = { count: 0, actions: [] as string[] };
  const service = {
    listEvents: stubs.listEvents ?? (async () => [makeView()]),
    createEvent:
      stubs.createEvent ??
      (async () => makeView()),
    updateEvent: stubs.updateEvent ?? (async () => makeView({ title: 'updated' })),
    disableEvent:
      stubs.disableEvent ?? (async () => makeView({ status: 'DISABLED' })),
    recomputeStatuses:
      stubs.recomputeStatuses ??
      (async () => ({
        scannedAt: '2026-08-01T00:01:00.000Z',
        toActivated: 1,
        toEnded: 0,
      })),
    // Phase 15.3.B — admin recompute endpoint chuyển sang dùng method mới
    // (trả thêm rows transition để broadcast). Default stub trả empty
    // arrays — test riêng cover broadcast wiring.
    recomputeStatusesWithTransitions: async () => ({
      scannedAt: '2026-08-01T00:01:00.000Z',
      toActivated: 1,
      toEnded: 0,
      activated: [],
      ended: [],
    }),
    getEventById: async () => null,
    getEventByKey: async () => null,
    getActiveEvents: async () => [],
    getRuntimeModifiers: async () => [],
    getActiveMultiplier: async () => 1,
  } as unknown as LiveOpsEventSchedulerService;

  const prisma = {
    adminAuditLog: {
      create: async (input: { data: { action: string } }) => {
        audit.count++;
        audit.actions.push(input.data.action);
        return {};
      },
    },
  } as unknown as ConstructorParameters<typeof AdminLiveOpsEventsController>[1];
  // Phase 15.3.B — broadcast stub: capture event broadcasts để test recompute
  // emit đúng public-safe payload. Không-op nếu test không assert.
  const broadcast = {
    broadcastEvent: () => {},
    broadcastAnnouncement: () => {},
  } as unknown as ConstructorParameters<typeof AdminLiveOpsEventsController>[2];
  return {
    c: new AdminLiveOpsEventsController(service, prisma, broadcast),
    audit,
  };
}

type AdminLiveOpsCronControllerLike = AdminLiveOpsEventsController;

const VALID_BODY = {
  key: 'event-test-1',
  type: 'DOUBLE_DUNGEON_DROP' as const,
  title: 'Test',
  description: 'd',
  startsAt: '2026-08-01T00:00:00.000Z',
  endsAt: '2026-08-02T00:00:00.000Z',
  configJson: { multiplier: 1.5 },
  initialStatus: 'SCHEDULED' as const,
};

describe('AdminLiveOpsEventsController.listEvents', () => {
  it('returns events list (no audit)', async () => {
    const { c, audit } = makeController();
    const r = await c.listEvents();
    expect(r.ok).toBe(true);
    expect(r.data.events).toHaveLength(1);
    expect(audit.count).toBe(0);
  });
});

describe('AdminLiveOpsEventsController.createEvent', () => {
  it('OK + audit log ADMIN_LIVEOPS_EVENT_CREATE', async () => {
    const { c, audit } = makeController();
    const r = await c.createEvent(makeReq('admin42'), VALID_BODY);
    expect(r.ok).toBe(true);
    expect(audit.count).toBe(1);
    expect(audit.actions).toContain('ADMIN_LIVEOPS_EVENT_CREATE');
  });

  it('INVALID_INPUT khi body thiếu key', async () => {
    const { c, audit } = makeController();
    const { key, ...body } = VALID_BODY;
    void key;
    await expect(
      c.createEvent(makeReq(), body as unknown as typeof VALID_BODY),
    ).rejects.toBeInstanceOf(HttpException);
    expect(audit.count).toBe(0);
  });

  it('INVALID_INPUT khi extra key trong body (.strict)', async () => {
    const { c, audit } = makeController();
    await expect(
      c.createEvent(makeReq(), {
        ...VALID_BODY,
        evil: 'x',
      } as unknown as typeof VALID_BODY),
    ).rejects.toBeInstanceOf(HttpException);
    expect(audit.count).toBe(0);
  });

  it('maps EVENT_KEY_DUPLICATE → HTTP 409', async () => {
    const { c, audit } = makeController({
      createEvent: async () => {
        throw new LiveOpsEventSchedulerError('EVENT_KEY_DUPLICATE');
      },
    });
    let caught: HttpException | null = null;
    try {
      await c.createEvent(makeReq(), VALID_BODY);
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught?.getStatus()).toBe(409);
    expect(audit.count).toBe(0);
  });

  it('maps EVENT_MULTIPLIER_OVER_CAP → HTTP 400', async () => {
    const { c } = makeController({
      createEvent: async () => {
        throw new LiveOpsEventSchedulerError('EVENT_MULTIPLIER_OVER_CAP');
      },
    });
    let caught: HttpException | null = null;
    try {
      await c.createEvent(makeReq(), VALID_BODY);
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught?.getStatus()).toBe(400);
  });
});

describe('AdminLiveOpsEventsController.updateEvent', () => {
  it('OK + audit log ADMIN_LIVEOPS_EVENT_UPDATE', async () => {
    const { c, audit } = makeController();
    const r = await c.updateEvent(makeReq(), 'ev1', { title: 'New title' });
    expect(r.ok).toBe(true);
    expect(audit.count).toBe(1);
    expect(audit.actions).toContain('ADMIN_LIVEOPS_EVENT_UPDATE');
  });

  it('maps EVENT_NOT_FOUND → HTTP 404', async () => {
    const { c } = makeController({
      updateEvent: async () => {
        throw new LiveOpsEventSchedulerError('EVENT_NOT_FOUND');
      },
    });
    let caught: HttpException | null = null;
    try {
      await c.updateEvent(makeReq(), 'missing', { title: 'x' });
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught?.getStatus()).toBe(404);
  });
});

describe('AdminLiveOpsEventsController.disableEvent / recomputeStatus', () => {
  it('disableEvent OK + audit', async () => {
    const { c, audit } = makeController();
    const r = await c.disableEvent(makeReq(), 'ev1');
    expect(r.ok).toBe(true);
    expect(r.data.status).toBe('DISABLED');
    expect(audit.actions).toContain('ADMIN_LIVEOPS_EVENT_DISABLE');
  });

  it('recomputeStatus OK + audit', async () => {
    const { c, audit } = makeController();
    const r = await c.recomputeStatus(makeReq());
    expect(r.ok).toBe(true);
    expect(r.data.toActivated).toBe(1);
    expect(audit.actions).toContain('ADMIN_LIVEOPS_EVENT_RECOMPUTE');
  });
});
