import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'socket.io';
import { PrismaService } from '../../common/prisma.service';
import { makeUserChar, wipeAll } from '../../test-helpers';
import { RealtimeService } from '../realtime/realtime.service';
import { PresenceService } from './presence.service';

/**
 * Phase 19.3 — PresenceService tests.
 *
 * Validates:
 *   - markConnected / markDisconnected upsert `UserPresence.lastSeenAt`.
 *   - listPresenceForUsers respects blocker-of-viewer hide policy.
 *   - fanoutPresenceUpdate emits `presence:update` ONLY when state
 *     transitions (0 ↔ ≥1 connections) and only to friends NOT blocked.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let realtime: RealtimeService;
let service: PresenceService;
const emittedEvents: Array<{ type: string; payload: unknown }> = [];

function fakeServer(): Server {
  const emitter = {
    emit: (type: string, payload: unknown) => {
      emittedEvents.push({ type, payload });
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
  service = new PresenceService(prisma, realtime);
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

async function makeFriendship(a: string, b: string) {
  const [userAId, userBId] = a < b ? [a, b] : [b, a];
  await prisma.friendship.create({
    data: { userAId, userBId },
  });
}

describe('Phase 19.3 — PresenceService.markConnected / markDisconnected', () => {
  it('markConnected first socket → currentConnections=1, previous=0; lastSeenAt persisted', async () => {
    const u = await makePlayer();
    realtime.attach(u.userId, 'sock-1');
    const update = await service.markConnected(u.userId);
    expect(update.previousConnections).toBe(0);
    expect(update.currentConnections).toBe(1);

    const row = await prisma.userPresence.findUnique({ where: { userId: u.userId } });
    expect(row).not.toBeNull();
    expect(row?.lastSeenAt).toBeInstanceOf(Date);
  });

  it('markConnected second socket → previous=1, current=2 (multi-tab)', async () => {
    const u = await makePlayer();
    realtime.attach(u.userId, 'sock-1');
    await service.markConnected(u.userId);
    realtime.attach(u.userId, 'sock-2');
    const update = await service.markConnected(u.userId);
    expect(update.previousConnections).toBe(1);
    expect(update.currentConnections).toBe(2);
  });

  it('markDisconnected last socket → current=0, previous=1; presence offline', async () => {
    const u = await makePlayer();
    realtime.attach(u.userId, 'sock-1');
    await service.markConnected(u.userId);
    realtime.detach(u.userId, 'sock-1');
    const update = await service.markDisconnected(u.userId);
    expect(update.previousConnections).toBe(1);
    expect(update.currentConnections).toBe(0);
  });
});

describe('Phase 19.3 — PresenceService.listPresenceForUsers', () => {
  it('online flag matches isOnline; lastSeenAt round-trips ISO', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    realtime.attach(b.userId, 'sock-1');
    await service.markConnected(b.userId);

    const rows = await service.listPresenceForUsers(a.userId, [a.userId, b.userId]);
    const byId = new Map(rows.map((r) => [r.userId, r]));
    expect(byId.get(a.userId)?.status).toBe('OFFLINE');
    expect(byId.get(b.userId)?.status).toBe('ONLINE');
    expect(typeof byId.get(b.userId)?.lastSeenAt).toBe('string');
  });

  it('blocker-of-viewer → presence hidden (OFFLINE + null lastSeenAt)', async () => {
    const viewer = await makePlayer();
    const blocker = await makePlayer();
    realtime.attach(blocker.userId, 'sock-1');
    await service.markConnected(blocker.userId);

    await prisma.playerBlock.create({
      data: {
        blockerUserId: blocker.userId,
        blockedUserId: viewer.userId,
      },
    });

    const rows = await service.listPresenceForUsers(viewer.userId, [blocker.userId]);
    expect(rows[0].status).toBe('OFFLINE');
    expect(rows[0].lastSeenAt).toBeNull();
  });

  it('dedupe userIds + cap 50', async () => {
    const u = await makePlayer();
    const ids = Array(60).fill(u.userId);
    const rows = await service.listPresenceForUsers(u.userId, ids);
    expect(rows).toHaveLength(1);
  });

  it('empty input → empty result', async () => {
    const u = await makePlayer();
    const rows = await service.listPresenceForUsers(u.userId, []);
    expect(rows).toEqual([]);
  });
});

describe('Phase 19.3 — PresenceService.fanoutPresenceUpdate', () => {
  it('state transition 0→1 → emit to all non-blocked friends', async () => {
    const u = await makePlayer();
    const f1 = await makePlayer();
    const f2 = await makePlayer();
    await makeFriendship(u.userId, f1.userId);
    await makeFriendship(u.userId, f2.userId);
    realtime.attach(f1.userId, 'sock-f1');
    realtime.attach(f2.userId, 'sock-f2');

    const spy = vi.spyOn(realtime, 'emitToUser');
    await service.fanoutPresenceUpdate({
      userId: u.userId,
      previousConnections: 0,
      currentConnections: 1,
    });
    const calls = spy.mock.calls.map((c) => ({ to: c[0], type: c[1] }));
    expect(calls).toEqual(
      expect.arrayContaining([
        { to: f1.userId, type: 'presence:update' },
        { to: f2.userId, type: 'presence:update' },
      ]),
    );
    spy.mockRestore();
  });

  it('non-transition (1→2 same online) → KHÔNG emit', async () => {
    const u = await makePlayer();
    const f1 = await makePlayer();
    await makeFriendship(u.userId, f1.userId);

    const spy = vi.spyOn(realtime, 'emitToUser');
    await service.fanoutPresenceUpdate({
      userId: u.userId,
      previousConnections: 1,
      currentConnections: 2,
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('skip friend đã block user → KHÔNG emit cho friend đó', async () => {
    const u = await makePlayer();
    const f1 = await makePlayer();
    const blocker = await makePlayer();
    await makeFriendship(u.userId, f1.userId);
    await makeFriendship(u.userId, blocker.userId);
    await prisma.playerBlock.create({
      data: {
        blockerUserId: blocker.userId,
        blockedUserId: u.userId,
      },
    });

    const spy = vi.spyOn(realtime, 'emitToUser');
    await service.fanoutPresenceUpdate({
      userId: u.userId,
      previousConnections: 0,
      currentConnections: 1,
    });
    const recipients = spy.mock.calls.map((c) => c[0]);
    expect(recipients).toContain(f1.userId);
    expect(recipients).not.toContain(blocker.userId);
    spy.mockRestore();
  });

  it('transition 1→0 (offline) → emit OFFLINE status', async () => {
    const u = await makePlayer();
    const f1 = await makePlayer();
    await makeFriendship(u.userId, f1.userId);

    const spy = vi.spyOn(realtime, 'emitToUser');
    await service.fanoutPresenceUpdate({
      userId: u.userId,
      previousConnections: 1,
      currentConnections: 0,
    });
    const call = spy.mock.calls.find((c) => c[0] === f1.userId);
    expect(call).toBeDefined();
    const payload = call?.[2] as { status: string };
    expect(payload.status).toBe('OFFLINE');
    spy.mockRestore();
  });
});
