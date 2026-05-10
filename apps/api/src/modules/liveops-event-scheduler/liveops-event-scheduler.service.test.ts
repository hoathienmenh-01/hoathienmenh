/**
 * Phase 15.1–15.2 — LiveOpsEventSchedulerService integration tests.
 *
 * Cover:
 *   - createEvent success (admin) + audit-able view shape.
 *   - createEvent validation: key duplicate, multiplier cap reject, window invalid.
 *   - updateEvent success + reject manual SCHEDULED→ACTIVE/ACTIVE→ENDED.
 *   - disableEvent → status='DISABLED' (kill switch).
 *   - recomputeStatuses idempotent: 2 lần liên tiếp KHÔNG double transition.
 *   - SCHEDULED → ACTIVE khi tới startsAt (recompute).
 *   - ACTIVE → ENDED khi qua endsAt (recompute).
 *   - getActiveEvents/getRuntimeModifiers chỉ trả event đúng status + window.
 *   - Multi-instance race: 2 promise.all recompute → đúng 1 winner per row.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, nextSuffix, wipeAll } from '../../test-helpers';
import { LiveOpsEventSchedulerService } from './liveops-event-scheduler.service';

let prisma: PrismaService;
let service: LiveOpsEventSchedulerService;
let adminUserId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  service = new LiveOpsEventSchedulerService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
  const admin = await makeUserChar(prisma, { role: 'ADMIN' });
  adminUserId = admin.userId;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function inputBase(overrides: Record<string, unknown> = {}): {
  key: string;
  type:
    | 'DOUBLE_DUNGEON_DROP'
    | 'CULTIVATION_EXP_BOOST'
    | 'SHOP_DISCOUNT'
    | 'SECT_SHOP_DISCOUNT'
    | 'DAILY_LOGIN_BONUS'
    | 'BOSS_REWARD_BOOST'
    | 'FESTIVAL_GIFT';
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  configJson: { multiplier?: number; rewardJson?: Record<string, unknown> };
} {
  const start = new Date('2026-08-01T00:00:00Z');
  const end = new Date('2026-08-02T00:00:00Z');
  return {
    key: `event-${nextSuffix()}`,
    type: 'DOUBLE_DUNGEON_DROP',
    title: 'Test Event',
    description: 'Test description',
    startsAt: start,
    endsAt: end,
    configJson: { multiplier: 1.5 },
    ...overrides,
  } as ReturnType<typeof inputBase>;
}

describe('LiveOpsEventSchedulerService — createEvent', () => {
  it('admin can create SCHEDULED event with valid input', async () => {
    const v = await service.createEvent(adminUserId, inputBase());
    expect(v.id).toBeDefined();
    expect(v.status).toBe('SCHEDULED');
    expect(v.type).toBe('DOUBLE_DUNGEON_DROP');
    expect(v.configJson).toMatchObject({ multiplier: 1.5 });
    expect(v.createdByAdminId).toBe(adminUserId);
  });

  it('rejects duplicate key (P2002)', async () => {
    const data = inputBase();
    await service.createEvent(adminUserId, data);
    await expect(service.createEvent(adminUserId, data)).rejects.toMatchObject({
      code: 'EVENT_KEY_DUPLICATE',
    });
  });

  it('rejects multiplier above cap (>2.0 for DOUBLE_DUNGEON_DROP)', async () => {
    await expect(
      service.createEvent(
        adminUserId,
        inputBase({ configJson: { multiplier: 3.0 } }),
      ),
    ).rejects.toMatchObject({ code: 'EVENT_MULTIPLIER_OVER_CAP' });
  });

  it('rejects window invalid (startsAt >= endsAt)', async () => {
    const start = new Date('2026-08-02T00:00:00Z');
    const end = new Date('2026-08-01T00:00:00Z');
    await expect(
      service.createEvent(adminUserId, inputBase({ startsAt: start, endsAt: end })),
    ).rejects.toMatchObject({ code: 'EVENT_WINDOW_INVALID' });
  });
});

describe('LiveOpsEventSchedulerService — updateEvent / disableEvent', () => {
  it('updateEvent success — title + multiplier', async () => {
    const ev = await service.createEvent(adminUserId, inputBase());
    const updated = await service.updateEvent(ev.id, {
      title: 'New title',
      configJson: { multiplier: 1.2 },
    });
    expect(updated.title).toBe('New title');
    expect(updated.configJson).toMatchObject({ multiplier: 1.2 });
  });

  it('updateEvent rejects manual SCHEDULED→ACTIVE', async () => {
    const ev = await service.createEvent(adminUserId, inputBase());
    await expect(
      service.updateEvent(ev.id, { status: 'ACTIVE' }),
    ).rejects.toMatchObject({ code: 'EVENT_TYPE_INVALID' });
  });

  it('disableEvent sets status=DISABLED', async () => {
    const ev = await service.createEvent(adminUserId, inputBase());
    const disabled = await service.disableEvent(ev.id);
    expect(disabled.status).toBe('DISABLED');
  });
});

describe('LiveOpsEventSchedulerService — recomputeStatuses', () => {
  it('SCHEDULED → ACTIVE khi tới startsAt', async () => {
    const start = new Date('2026-08-01T00:00:00Z');
    const end = new Date('2026-08-02T00:00:00Z');
    const ev = await service.createEvent(
      adminUserId,
      inputBase({ startsAt: start, endsAt: end }),
    );
    const summary = await service.recomputeStatuses(
      new Date('2026-08-01T00:01:00Z'),
    );
    expect(summary.toActivated).toBe(1);
    const reloaded = await service.getEventById(ev.id);
    expect(reloaded?.status).toBe('ACTIVE');
  });

  it('ACTIVE → ENDED khi qua endsAt', async () => {
    const start = new Date('2026-08-01T00:00:00Z');
    const end = new Date('2026-08-02T00:00:00Z');
    const ev = await service.createEvent(
      adminUserId,
      inputBase({ startsAt: start, endsAt: end }),
    );
    // First tick: activate.
    await service.recomputeStatuses(new Date('2026-08-01T01:00:00Z'));
    // Second tick: end.
    const summary = await service.recomputeStatuses(
      new Date('2026-08-02T00:00:01Z'),
    );
    expect(summary.toEnded).toBe(1);
    const reloaded = await service.getEventById(ev.id);
    expect(reloaded?.status).toBe('ENDED');
  });

  it('SCHEDULED → ENDED khi event đã quá hạn (chưa từng activate)', async () => {
    const start = new Date('2026-07-01T00:00:00Z');
    const end = new Date('2026-07-02T00:00:00Z');
    const ev = await service.createEvent(
      adminUserId,
      inputBase({ startsAt: start, endsAt: end }),
    );
    const summary = await service.recomputeStatuses(
      new Date('2026-08-01T00:00:00Z'),
    );
    expect(summary.toEnded).toBe(1);
    const reloaded = await service.getEventById(ev.id);
    expect(reloaded?.status).toBe('ENDED');
  });

  it('idempotent — 2 lần recompute liên tiếp KHÔNG double transition', async () => {
    const start = new Date('2026-08-01T00:00:00Z');
    const end = new Date('2026-08-02T00:00:00Z');
    await service.createEvent(
      adminUserId,
      inputBase({ startsAt: start, endsAt: end }),
    );
    const a = await service.recomputeStatuses(new Date('2026-08-01T00:01:00Z'));
    expect(a.toActivated).toBe(1);
    const b = await service.recomputeStatuses(new Date('2026-08-01T00:02:00Z'));
    expect(b.toActivated).toBe(0);
    expect(b.toEnded).toBe(0);
  });

  it('race-safe — 2 song song recompute → tổng count=1 (DB-level)', async () => {
    const start = new Date('2026-08-01T00:00:00Z');
    const end = new Date('2026-08-02T00:00:00Z');
    await service.createEvent(
      adminUserId,
      inputBase({ startsAt: start, endsAt: end }),
    );
    const now = new Date('2026-08-01T00:01:00Z');
    const [a, b] = await Promise.all([
      service.recomputeStatuses(now),
      service.recomputeStatuses(now),
    ]);
    // updateMany tổng count phải = 1 — winner thắng race, loser count=0.
    expect(a.toActivated + b.toActivated).toBe(1);
  });
});

describe('LiveOpsEventSchedulerService — runtime modifiers', () => {
  it('getRuntimeModifiers trả đúng modifier cho ACTIVE event', async () => {
    const start = new Date('2026-08-01T00:00:00Z');
    const end = new Date('2026-08-02T00:00:00Z');
    await service.createEvent(
      adminUserId,
      inputBase({ startsAt: start, endsAt: end, configJson: { multiplier: 1.5 } }),
    );
    await service.recomputeStatuses(new Date('2026-08-01T00:01:00Z'));
    const mods = await service.getRuntimeModifiers(new Date('2026-08-01T01:00:00Z'));
    expect(mods).toHaveLength(1);
    expect(mods[0].type).toBe('DOUBLE_DUNGEON_DROP');
    expect(mods[0].multiplier).toBe(1.5);
  });

  it('getActiveMultiplier trả max của 2 event cùng type', async () => {
    const start = new Date('2026-08-01T00:00:00Z');
    const end = new Date('2026-08-02T00:00:00Z');
    await service.createEvent(
      adminUserId,
      inputBase({ startsAt: start, endsAt: end, configJson: { multiplier: 1.5 } }),
    );
    await service.createEvent(
      adminUserId,
      inputBase({ startsAt: start, endsAt: end, configJson: { multiplier: 1.8 } }),
    );
    await service.recomputeStatuses(new Date('2026-08-01T00:01:00Z'));
    const mul = await service.getActiveMultiplier(
      'DOUBLE_DUNGEON_DROP',
      new Date('2026-08-01T01:00:00Z'),
    );
    expect(mul).toBe(1.8);
  });

  it('multiplier reload luôn được clamp (defense-in-depth)', async () => {
    const start = new Date('2026-08-01T00:00:00Z');
    const end = new Date('2026-08-02T00:00:00Z');
    // Bypass validator bằng cách insert raw row với multiplier vượt cap.
    const raw = await prisma.liveOpsScheduledEvent.create({
      data: {
        key: `bypass-${nextSuffix()}`,
        type: 'DOUBLE_DUNGEON_DROP',
        title: 'Bypass test',
        description: '',
        status: 'ACTIVE',
        startsAt: start,
        endsAt: end,
        configJson: { multiplier: 5.0 },
      },
    });
    expect(raw.id).toBeDefined();
    const mul = await service.getActiveMultiplier(
      'DOUBLE_DUNGEON_DROP',
      new Date('2026-08-01T01:00:00Z'),
    );
    // Cap = 2.0 cho DOUBLE_DUNGEON_DROP — service phải clamp dù DB lưu 5.0.
    expect(mul).toBeLessThanOrEqual(2.0);
  });

  it('DISABLED event không trả về trong getActiveEvents', async () => {
    const start = new Date('2026-08-01T00:00:00Z');
    const end = new Date('2026-08-02T00:00:00Z');
    const ev = await service.createEvent(
      adminUserId,
      inputBase({ startsAt: start, endsAt: end }),
    );
    await service.recomputeStatuses(new Date('2026-08-01T00:01:00Z'));
    await service.disableEvent(ev.id);
    const active = await service.getActiveEvents(new Date('2026-08-01T01:00:00Z'));
    expect(active).toHaveLength(0);
  });
});
