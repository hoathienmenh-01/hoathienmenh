import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'socket.io';
import { PrismaService } from '../../common/prisma.service';
import { makeUserChar, wipeAll } from '../../test-helpers';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationService } from './notification.service';

/**
 * Phase 19.3 — NotificationService unit / integration tests.
 *
 * Re-use real Postgres (matches `social.service.test.ts` pattern).
 * `RealtimeService` is a real instance bound to a stub Socket.IO
 * server so `emitToUser` can record events without an actual WS
 * stack. Tests focus on contract: own-user-only, idempotent
 * markRead, ordering, fanout-only-when-online.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let realtime: RealtimeService;
let service: NotificationService;
const emittedEvents: Array<{
  socketId: string;
  type: string;
  payload: unknown;
}> = [];

function fakeServer(): Server {
  // Minimal stub. RealtimeService only uses `.to(sid).emit(type, frame)`.
  const emitter = {
    emit: (type: string, payload: unknown) => {
      // socketId tracked via closure below.
      emittedEvents.push({ socketId: 'unused', type, payload });
    },
  };
  return {
    to: () => emitter,
    emit: () => undefined,
    sockets: { sockets: new Map() },
  } as unknown as Server;
}

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  realtime = new RealtimeService();
  realtime.bind(fakeServer());
  service = new NotificationService(prisma, realtime);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await wipeAll(prisma);
  emittedEvents.length = 0;
});

async function makePlayer() {
  return makeUserChar(prisma);
}

describe('Phase 19.3 — NotificationService.createNotification', () => {
  it('persists row + emits notification:new + unread-count khi user online', async () => {
    const u = await makePlayer();
    realtime.attach(u.userId, 'sock-1');

    const row = await service.createNotification({
      userId: u.userId,
      type: 'FRIEND_REQUEST_RECEIVED',
      titleKey: 'notification.friendRequestReceived.title',
      bodyKey: 'notification.friendRequestReceived.body',
      entityType: 'FRIEND_REQUEST',
      entityId: 'req-1',
      data: { senderName: 'Alice' },
    });

    expect(row.type).toBe('FRIEND_REQUEST_RECEIVED');
    expect(row.entityType).toBe('FRIEND_REQUEST');
    expect(row.entityId).toBe('req-1');
    expect(row.readAt).toBeNull();

    // Async fanout — give it 1 tick.
    await new Promise((r) => setTimeout(r, 20));

    const types = emittedEvents.map((e) => e.type);
    expect(types).toContain('notification:new');
    expect(types).toContain('notification:unread-count');
  });

  it('KHÔNG emit WS event khi user offline (DB row vẫn lưu)', async () => {
    const u = await makePlayer();
    // No attach → offline.

    await service.createNotification({
      userId: u.userId,
      type: 'PRIVATE_MESSAGE_RECEIVED',
      titleKey: 'notification.privateMessage.title',
      bodyKey: 'notification.privateMessage.body',
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(emittedEvents.length).toBe(0);

    const persisted = await prisma.notification.findFirst({
      where: { userId: u.userId },
    });
    expect(persisted).not.toBeNull();
  });

  it('entityType không hợp lệ → stored as null (sanitize)', async () => {
    const u = await makePlayer();
    const row = await service.createNotification({
      userId: u.userId,
      type: 'SECURITY_ALERT_USER',
      titleKey: 'security.alert.title',
      bodyKey: 'security.alert.body',
      entityType: 'BOGUS_ENTITY_TYPE',
    });
    expect(row.entityType).toBeNull();
  });
});

describe('Phase 19.3 — NotificationService.listNotifications', () => {
  it('chỉ trả notification của requester (no cross-user leak)', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await service.createNotification({
      userId: a.userId,
      type: 'FRIEND_REQUEST_RECEIVED',
      titleKey: 'k', bodyKey: 'k',
    });
    await service.createNotification({
      userId: b.userId,
      type: 'FRIEND_REQUEST_RECEIVED',
      titleKey: 'k', bodyKey: 'k',
    });

    const aList = await service.listNotifications({ userId: a.userId });
    expect(aList.notifications).toHaveLength(1);
    const bList = await service.listNotifications({ userId: b.userId });
    expect(bList.notifications).toHaveLength(1);
  });

  it('orderBy createdAt desc + pagination cursor', async () => {
    const u = await makePlayer();
    for (let i = 0; i < 5; i++) {
      await service.createNotification({
        userId: u.userId,
        type: 'PRIVATE_MESSAGE_RECEIVED',
        titleKey: `t-${i}`,
        bodyKey: `b-${i}`,
      });
      // Tiny delay so createdAt differs.
      await new Promise((r) => setTimeout(r, 5));
    }
    const page = await service.listNotifications({ userId: u.userId, limit: 3 });
    expect(page.notifications).toHaveLength(3);
    expect(page.total).toBe(5);
    // Most recent first.
    expect(page.notifications[0].titleKey).toBe('t-4');
  });

  it('unreadOnly=true filter đúng read state', async () => {
    const u = await makePlayer();
    const r1 = await service.createNotification({
      userId: u.userId,
      type: 'FRIEND_REQUEST_RECEIVED',
      titleKey: 'k', bodyKey: 'k',
    });
    await service.createNotification({
      userId: u.userId,
      type: 'FRIEND_REQUEST_ACCEPTED',
      titleKey: 'k', bodyKey: 'k',
    });
    await service.markRead(u.userId, r1.id);

    const unread = await service.listNotifications({
      userId: u.userId,
      unreadOnly: true,
    });
    expect(unread.notifications).toHaveLength(1);
    expect(unread.notifications[0].readAt).toBeNull();
  });
});

describe('Phase 19.3 — NotificationService.markRead / markAllRead', () => {
  it('cross-user markRead → FORBIDDEN', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const row = await service.createNotification({
      userId: a.userId,
      type: 'FRIEND_REQUEST_RECEIVED',
      titleKey: 'k', bodyKey: 'k',
    });
    await expect(
      service.markRead(b.userId, row.id),
    ).rejects.toMatchObject({
      response: { error: { code: 'FORBIDDEN' } },
    });
  });

  it('markRead idempotent (gọi 2 lần không update readAt lần 2)', async () => {
    const u = await makePlayer();
    const row = await service.createNotification({
      userId: u.userId,
      type: 'FRIEND_REQUEST_RECEIVED',
      titleKey: 'k', bodyKey: 'k',
    });
    const first = await service.markRead(u.userId, row.id);
    expect(first.readAt).not.toBeNull();
    const firstReadAt = first.readAt;

    await new Promise((r) => setTimeout(r, 10));
    const second = await service.markRead(u.userId, row.id);
    expect(second.readAt).toBe(firstReadAt);
  });

  it('markAllRead → count khớp số unread + unread=0 sau đó', async () => {
    const u = await makePlayer();
    for (let i = 0; i < 3; i++) {
      await service.createNotification({
        userId: u.userId,
        type: 'PRIVATE_MESSAGE_RECEIVED',
        titleKey: 'k', bodyKey: 'k',
      });
    }
    const res = await service.markAllRead(u.userId);
    expect(res.markedCount).toBe(3);
    expect(await service.countUnread(u.userId)).toBe(0);
  });

  it('NOTIFICATION_NOT_FOUND nếu id không tồn tại', async () => {
    const u = await makePlayer();
    await expect(
      service.markRead(u.userId, 'does-not-exist'),
    ).rejects.toMatchObject({
      response: { error: { code: 'NOTIFICATION_NOT_FOUND' } },
    });
  });
});

describe('Phase 19.3 — NotificationService.fanoutRealtimeIfOnline', () => {
  it('isOnline=false → KHÔNG emit, không throw', async () => {
    const u = await makePlayer();
    const spy = vi.spyOn(realtime, 'emitToUser');
    await service.fanoutRealtimeIfOnline(u.userId, {
      id: 'n1',
      type: 'FRIEND_REQUEST_RECEIVED',
      titleKey: 'k', bodyKey: 'k',
      entityType: null,
      entityId: null,
      dataJson: {},
      readAt: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
