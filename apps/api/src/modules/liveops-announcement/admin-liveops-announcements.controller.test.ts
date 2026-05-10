/**
 * Phase 15.3.B — AdminLiveOpsAnnouncementsController unit tests.
 *
 * Pure unit (instantiate controller trực tiếp, bypass `AdminGuard` —
 * AdminGuard có test riêng tại `admin.guard.test.ts`).
 *
 * Cover:
 *   - list OK.
 *   - create OK + audit log written.
 *   - create INVALID_INPUT khi body malformed.
 *   - create maps service error code → HttpException.
 *   - update OK + audit log.
 *   - disable OK + audit log.
 *   - recomputeStatus OK + audit log + broadcast called once per row.
 *   - recompute idempotent — gọi 2 lần không double broadcast (khi
 *     summary trả empty arrays).
 */
import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { AdminLiveOpsAnnouncementsController } from './admin-liveops-announcements.controller';
import {
  LiveOpsAnnouncementError,
  type AnnouncementRecomputeSummary,
  type LiveOpsAnnouncementService,
  type LiveOpsAnnouncementView,
} from './liveops-announcement.service';
import type { LiveOpsBroadcastService } from './liveops-broadcast.service';

type AdminReq = Request & {
  userId: string;
  role: 'ADMIN' | 'MOD' | 'PLAYER';
};

function makeReq(userId = 'admin1'): AdminReq {
  return {
    userId,
    role: 'ADMIN',
    cookies: {},
  } as unknown as AdminReq;
}

function makeView(
  over: Partial<LiveOpsAnnouncementView> = {},
): LiveOpsAnnouncementView {
  return {
    id: 'ann1',
    key: 'announcement-001',
    severity: 'INFO',
    status: 'DRAFT',
    target: 'ALL',
    titleVi: 'Tiêu đề',
    titleEn: 'Title',
    messageVi: 'Nội dung',
    messageEn: 'Body',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-08-02T00:00:00.000Z',
    createdByAdminId: 'admin1',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    disabledAt: null,
    ...over,
  };
}

interface ServiceStubs {
  list?: () => Promise<LiveOpsAnnouncementView[]>;
  create?: LiveOpsAnnouncementService['createAnnouncement'];
  update?: LiveOpsAnnouncementService['updateAnnouncement'];
  disable?: LiveOpsAnnouncementService['disableAnnouncement'];
  recompute?: () => Promise<AnnouncementRecomputeSummary>;
}

function makeController(stubs: ServiceStubs = {}): {
  c: AdminLiveOpsAnnouncementsController;
  audit: { count: number; actions: string[] };
  broadcast: { count: number; keys: string[] };
} {
  const audit = { count: 0, actions: [] as string[] };
  const broadcast = { count: 0, keys: [] as string[] };

  const service = {
    listAnnouncements: stubs.list ?? (async () => [makeView()]),
    createAnnouncement: stubs.create ?? (async () => makeView()),
    updateAnnouncement:
      stubs.update ?? (async () => makeView({ titleVi: 'Sửa' })),
    disableAnnouncement:
      stubs.disable ??
      (async () =>
        makeView({ status: 'DISABLED', disabledAt: '2026-08-01T00:00:00.000Z' })),
    recomputeStatuses:
      stubs.recompute ??
      (async () => ({
        scannedAt: '2026-08-01T00:01:00.000Z',
        activated: [],
        ended: [],
      })),
    getAnnouncementById: async () => null,
    getActiveAnnouncementsPublic: async () => [],
  } as unknown as LiveOpsAnnouncementService;

  const broadcastSvc = {
    broadcastAnnouncement: (payload: { key: string }) => {
      broadcast.count++;
      broadcast.keys.push(payload.key);
    },
    broadcastEvent: () => {},
  } as unknown as LiveOpsBroadcastService;

  const prisma = {
    adminAuditLog: {
      create: async (input: { data: { action: string } }) => {
        audit.count++;
        audit.actions.push(input.data.action);
        return {};
      },
    },
  } as unknown as ConstructorParameters<
    typeof AdminLiveOpsAnnouncementsController
  >[2];

  return {
    c: new AdminLiveOpsAnnouncementsController(service, broadcastSvc, prisma),
    audit,
    broadcast,
  };
}

const VALID_BODY = {
  key: 'announcement-test-1',
  severity: 'INFO',
  target: 'ALL',
  titleVi: 'Tiêu đề',
  titleEn: 'Title',
  messageVi: 'Nội dung',
  messageEn: 'Body',
  startsAt: '2026-08-01T00:00:00.000Z',
  endsAt: '2026-08-02T00:00:00.000Z',
};

// ---------------------------------------------------------------------------

describe('AdminLiveOpsAnnouncementsController.list', () => {
  it('returns ok + announcements', async () => {
    const { c } = makeController();
    const r = await c.list();
    expect(r.ok).toBe(true);
    expect(r.data.announcements).toHaveLength(1);
  });
});

describe('AdminLiveOpsAnnouncementsController.create', () => {
  it('happy path returns view + audit log written', async () => {
    const { c, audit } = makeController();
    const r = await c.create(makeReq(), VALID_BODY);
    expect(r.ok).toBe(true);
    expect(audit.count).toBe(1);
    expect(audit.actions).toContain('ADMIN_LIVEOPS_ANNOUNCEMENT_CREATE');
  });

  it('rejects malformed body INVALID_INPUT', async () => {
    const { c } = makeController();
    await expect(
      c.create(makeReq(), { ...VALID_BODY, severity: 'BOGUS' }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('maps ANNOUNCEMENT_KEY_DUPLICATE to 409', async () => {
    const { c } = makeController({
      create: async () => {
        throw new LiveOpsAnnouncementError('ANNOUNCEMENT_KEY_DUPLICATE');
      },
    });
    await expect(c.create(makeReq(), VALID_BODY)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('maps ANNOUNCEMENT_NOT_FOUND to 404 (defensive — create không trả NOT_FOUND but adapter chung)', async () => {
    const { c } = makeController({
      create: async () => {
        throw new LiveOpsAnnouncementError('ANNOUNCEMENT_NOT_FOUND');
      },
    });
    await expect(c.create(makeReq(), VALID_BODY)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('AdminLiveOpsAnnouncementsController.update', () => {
  it('happy path returns view + audit log written', async () => {
    const { c, audit } = makeController();
    const r = await c.update(makeReq(), 'ann1', { titleVi: 'Sửa' });
    expect(r.ok).toBe(true);
    expect(audit.actions).toContain('ADMIN_LIVEOPS_ANNOUNCEMENT_UPDATE');
  });

  it('rejects unknown field (strict zod)', async () => {
    const { c } = makeController();
    await expect(
      c.update(makeReq(), 'ann1', { titleVi: 'Sửa', extra: 'x' }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

describe('AdminLiveOpsAnnouncementsController.disable', () => {
  it('happy path returns DISABLED view + audit log written', async () => {
    const { c, audit } = makeController();
    const r = await c.disable(makeReq(), 'ann1');
    expect(r.data.status).toBe('DISABLED');
    expect(audit.actions).toContain('ADMIN_LIVEOPS_ANNOUNCEMENT_DISABLE');
  });
});

describe('AdminLiveOpsAnnouncementsController.recompute', () => {
  it('broadcasts each transitioned row + audit log written', async () => {
    const { c, audit, broadcast } = makeController({
      recompute: async () => ({
        scannedAt: '2026-08-01T00:01:00.000Z',
        activated: [
          {
            type: 'ANNOUNCEMENT_ACTIVE',
            key: 'ann-a',
            severity: 'INFO',
            target: 'ALL',
            title: 'A',
            message: 'a',
            titleVi: 'A',
            titleEn: null,
            messageVi: 'a',
            messageEn: null,
            startsAt: '2026-08-01T00:00:00.000Z',
            endsAt: '2026-08-02T00:00:00.000Z',
          },
        ],
        ended: [
          {
            type: 'ANNOUNCEMENT_ENDED',
            key: 'ann-b',
            severity: 'INFO',
            target: 'ALL',
            title: 'B',
            message: 'b',
            titleVi: 'B',
            titleEn: null,
            messageVi: 'b',
            messageEn: null,
            startsAt: '2026-07-30T00:00:00.000Z',
            endsAt: '2026-07-31T00:00:00.000Z',
          },
        ],
      }),
    });
    const r = await c.recompute(makeReq());
    expect(r.data.activated).toHaveLength(1);
    expect(r.data.ended).toHaveLength(1);
    expect(broadcast.count).toBe(2);
    expect(broadcast.keys.sort()).toEqual(['ann-a', 'ann-b']);
    expect(audit.actions).toContain('ADMIN_LIVEOPS_ANNOUNCEMENT_RECOMPUTE');
  });

  it('idempotent — empty summary KHÔNG broadcast', async () => {
    const { c, broadcast } = makeController();
    await c.recompute(makeReq());
    await c.recompute(makeReq());
    expect(broadcast.count).toBe(0);
  });
});
