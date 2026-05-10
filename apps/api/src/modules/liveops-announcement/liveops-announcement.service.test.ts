/**
 * Phase 15.3.B — LiveOpsAnnouncementService integration tests.
 *
 * Cover:
 *   - createAnnouncement happy path + validate failures (key dup, window
 *     invalid, severity invalid, message overlong, HTML injection).
 *   - updateAnnouncement merge logic + reject manual ACTIVE/ENDED set.
 *   - disableAnnouncement → status='DISABLED' + disabledAt set.
 *   - getActiveAnnouncementsPublic respect target + viewer (anonymous /
 *     authenticated / admin) + chỉ trả ACTIVE + window.
 *   - recomputeStatuses: SCHEDULED→ACTIVE / ACTIVE→ENDED idempotent.
 *   - Public payload KHÔNG chứa adminId / disabledAt / id (public-safe).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';
import {
  LiveOpsAnnouncementError,
  LiveOpsAnnouncementService,
  type CreateAnnouncementInput,
} from './liveops-announcement.service';

let prisma: PrismaService;
let service: LiveOpsAnnouncementService;
let adminUserId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  service = new LiveOpsAnnouncementService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
  const admin = await makeUserChar(prisma, { role: 'ADMIN' });
  adminUserId = admin.userId;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function inputBase(
  overrides: Partial<CreateAnnouncementInput> = {},
): CreateAnnouncementInput {
  const start = new Date('2026-08-01T00:00:00Z');
  const end = new Date('2026-08-02T00:00:00Z');
  return {
    key: `ann-${nextSuffix()}`,
    severity: 'INFO',
    target: 'ALL',
    titleVi: 'Sự kiện đôi rớt vật phẩm',
    titleEn: 'Double drop event',
    messageVi: 'Tỷ lệ rớt vật phẩm hầm ngục x2 trong 24h.',
    messageEn: 'Dungeon drop rate doubled for 24h.',
    startsAt: start,
    endsAt: end,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createAnnouncement
// ---------------------------------------------------------------------------

describe('LiveOpsAnnouncementService — createAnnouncement', () => {
  it('admin can create DRAFT announcement (default)', async () => {
    const v = await service.createAnnouncement(adminUserId, inputBase());
    expect(v.id).toBeDefined();
    expect(v.status).toBe('DRAFT');
    expect(v.severity).toBe('INFO');
    expect(v.target).toBe('ALL');
    expect(v.createdByAdminId).toBe(adminUserId);
  });

  it('admin can create SCHEDULED announcement via initialStatus', async () => {
    const v = await service.createAnnouncement(
      adminUserId,
      inputBase({ initialStatus: 'SCHEDULED' }),
    );
    expect(v.status).toBe('SCHEDULED');
  });

  it('rejects duplicate key (P2002)', async () => {
    const data = inputBase();
    await service.createAnnouncement(adminUserId, data);
    await expect(
      service.createAnnouncement(adminUserId, data),
    ).rejects.toMatchObject({ code: 'ANNOUNCEMENT_KEY_DUPLICATE' });
  });

  it('rejects window invalid (startsAt >= endsAt)', async () => {
    const start = new Date('2026-08-02T00:00:00Z');
    const end = new Date('2026-08-01T00:00:00Z');
    await expect(
      service.createAnnouncement(
        adminUserId,
        inputBase({ startsAt: start, endsAt: end }),
      ),
    ).rejects.toBeInstanceOf(LiveOpsAnnouncementError);
  });

  it('rejects HTML/script injection in title', async () => {
    await expect(
      service.createAnnouncement(
        adminUserId,
        inputBase({ titleVi: '<script>alert(1)</script>' }),
      ),
    ).rejects.toMatchObject({ code: 'ANNOUNCEMENT_TITLE_UNSAFE' });
  });

  it('rejects HTML/script injection in message', async () => {
    await expect(
      service.createAnnouncement(
        adminUserId,
        inputBase({ messageVi: 'javascript:alert(1)' }),
      ),
    ).rejects.toMatchObject({ code: 'ANNOUNCEMENT_MESSAGE_UNSAFE' });
  });

  it('rejects overlong title', async () => {
    const long = 'x'.repeat(200);
    await expect(
      service.createAnnouncement(adminUserId, inputBase({ titleVi: long })),
    ).rejects.toMatchObject({ code: 'ANNOUNCEMENT_TITLE_TOO_LONG' });
  });
});

// ---------------------------------------------------------------------------
// updateAnnouncement / disableAnnouncement
// ---------------------------------------------------------------------------

describe('LiveOpsAnnouncementService — updateAnnouncement / disableAnnouncement', () => {
  it('updateAnnouncement success — title + severity', async () => {
    const ann = await service.createAnnouncement(adminUserId, inputBase());
    const updated = await service.updateAnnouncement(ann.id, {
      titleVi: 'Tiêu đề mới',
      severity: 'WARNING',
    });
    expect(updated.titleVi).toBe('Tiêu đề mới');
    expect(updated.severity).toBe('WARNING');
  });

  it('updateAnnouncement rejects manual ACTIVE/ENDED set', async () => {
    const ann = await service.createAnnouncement(adminUserId, inputBase());
    await expect(
      service.updateAnnouncement(ann.id, {
        status: 'ACTIVE' as never,
      }),
    ).rejects.toMatchObject({
      code: 'ANNOUNCEMENT_INVALID_STATUS_TRANSITION',
    });
  });

  it('disableAnnouncement sets status DISABLED + disabledAt', async () => {
    const ann = await service.createAnnouncement(
      adminUserId,
      inputBase({ initialStatus: 'SCHEDULED' }),
    );
    const dis = await service.disableAnnouncement(ann.id);
    expect(dis.status).toBe('DISABLED');
    expect(dis.disabledAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// recomputeStatuses (cron transitions)
// ---------------------------------------------------------------------------

describe('LiveOpsAnnouncementService — recomputeStatuses', () => {
  it('SCHEDULED → ACTIVE khi tới startsAt; idempotent gọi lần 2', async () => {
    const start = new Date('2026-08-01T00:00:00Z');
    const end = new Date('2026-08-02T00:00:00Z');
    const ann = await service.createAnnouncement(
      adminUserId,
      inputBase({
        initialStatus: 'SCHEDULED',
        startsAt: start,
        endsAt: end,
      }),
    );

    // Trước startsAt — không transition.
    let summary = await service.recomputeStatuses(
      new Date('2026-07-31T23:59:00Z'),
    );
    expect(summary.activated).toHaveLength(0);
    expect(summary.ended).toHaveLength(0);

    // Sau startsAt — activate 1.
    summary = await service.recomputeStatuses(
      new Date('2026-08-01T00:00:01Z'),
    );
    expect(summary.activated).toHaveLength(1);
    expect(summary.activated[0]?.key).toBe(ann.key);
    expect(summary.activated[0]?.type).toBe('ANNOUNCEMENT_ACTIVE');
    // Public-safe payload — KHÔNG chứa adminId / id.
    expect(summary.activated[0]).not.toHaveProperty('createdByAdminId');
    expect(summary.activated[0]).not.toHaveProperty('id');

    // Idempotent — gọi lần 2 không re-broadcast.
    summary = await service.recomputeStatuses(
      new Date('2026-08-01T00:00:02Z'),
    );
    expect(summary.activated).toHaveLength(0);
    expect(summary.ended).toHaveLength(0);
  });

  it('ACTIVE → ENDED khi qua endsAt; idempotent gọi lần 2', async () => {
    const start = new Date('2026-08-01T00:00:00Z');
    const end = new Date('2026-08-02T00:00:00Z');
    const ann = await service.createAnnouncement(
      adminUserId,
      inputBase({
        initialStatus: 'SCHEDULED',
        startsAt: start,
        endsAt: end,
      }),
    );
    // Activate first.
    await service.recomputeStatuses(new Date('2026-08-01T00:00:01Z'));

    // Pass endsAt — end 1.
    let summary = await service.recomputeStatuses(
      new Date('2026-08-02T00:00:01Z'),
    );
    expect(summary.ended).toHaveLength(1);
    expect(summary.ended[0]?.key).toBe(ann.key);
    expect(summary.ended[0]?.type).toBe('ANNOUNCEMENT_ENDED');

    // Idempotent.
    summary = await service.recomputeStatuses(
      new Date('2026-08-02T00:00:02Z'),
    );
    expect(summary.ended).toHaveLength(0);
  });

  it('DISABLED announcement KHÔNG tự ACTIVE qua recompute', async () => {
    const start = new Date('2026-08-01T00:00:00Z');
    const end = new Date('2026-08-02T00:00:00Z');
    const ann = await service.createAnnouncement(
      adminUserId,
      inputBase({
        initialStatus: 'SCHEDULED',
        startsAt: start,
        endsAt: end,
      }),
    );
    await service.disableAnnouncement(ann.id);
    const summary = await service.recomputeStatuses(
      new Date('2026-08-01T00:00:01Z'),
    );
    expect(summary.activated).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getActiveAnnouncementsPublic — public-safe filtering
// ---------------------------------------------------------------------------

describe('LiveOpsAnnouncementService — getActiveAnnouncementsPublic', () => {
  const start = new Date('2026-08-01T00:00:00Z');
  const end = new Date('2026-08-02T00:00:00Z');
  const within = new Date('2026-08-01T12:00:00Z');

  it('chỉ trả ACTIVE; SCHEDULED/ENDED/DISABLED không xuất hiện', async () => {
    // ACTIVE (sẽ activate qua recompute)
    const a = await service.createAnnouncement(
      adminUserId,
      inputBase({ initialStatus: 'SCHEDULED', startsAt: start, endsAt: end }),
    );
    await service.recomputeStatuses(within);
    void a;

    // SCHEDULED (chưa tới startsAt)
    await service.createAnnouncement(
      adminUserId,
      inputBase({
        initialStatus: 'SCHEDULED',
        startsAt: new Date('2026-09-01T00:00:00Z'),
        endsAt: new Date('2026-09-02T00:00:00Z'),
      }),
    );

    // DRAFT
    await service.createAnnouncement(
      adminUserId,
      inputBase({ startsAt: start, endsAt: end }),
    );

    // DISABLED
    const ann = await service.createAnnouncement(
      adminUserId,
      inputBase({ initialStatus: 'SCHEDULED', startsAt: start, endsAt: end }),
    );
    await service.disableAnnouncement(ann.id);

    const list = await service.getActiveAnnouncementsPublic('anonymous', within);
    expect(list).toHaveLength(1);
    expect(list[0]?.key).toBe(a.key);
  });

  it('respect target — anonymous chỉ thấy ALL', async () => {
    await service.createAnnouncement(
      adminUserId,
      inputBase({
        initialStatus: 'SCHEDULED',
        target: 'ALL',
        key: 'ann-all',
        startsAt: start,
        endsAt: end,
      }),
    );
    await service.createAnnouncement(
      adminUserId,
      inputBase({
        initialStatus: 'SCHEDULED',
        target: 'AUTHENTICATED',
        key: 'ann-auth',
        startsAt: start,
        endsAt: end,
      }),
    );
    await service.recomputeStatuses(within);

    const anon = await service.getActiveAnnouncementsPublic(
      'anonymous',
      within,
    );
    expect(anon.map((a) => a.key)).toEqual(['ann-all']);

    const auth = await service.getActiveAnnouncementsPublic(
      'authenticated',
      within,
    );
    expect(auth.map((a) => a.key).sort()).toEqual(['ann-all', 'ann-auth']);
  });

  it('public payload KHÔNG chứa adminId/disabledAt/id', async () => {
    await service.createAnnouncement(
      adminUserId,
      inputBase({ initialStatus: 'SCHEDULED', startsAt: start, endsAt: end }),
    );
    await service.recomputeStatuses(within);
    const list = await service.getActiveAnnouncementsPublic(
      'authenticated',
      within,
    );
    expect(list).toHaveLength(1);
    const item = list[0]!;
    expect(item).not.toHaveProperty('id');
    expect(item).not.toHaveProperty('createdByAdminId');
    expect(item).not.toHaveProperty('disabledAt');
    expect(item).not.toHaveProperty('createdAt');
    expect(item).not.toHaveProperty('updatedAt');
    expect(item).toHaveProperty('key');
    expect(item).toHaveProperty('severity');
    expect(item).toHaveProperty('target');
    expect(item).toHaveProperty('titleVi');
  });
});
