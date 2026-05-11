/**
 * Phase 18.2 — SessionService integration tests.
 *
 * Cover:
 *   - createSession: tạo row + emit SecurityEvent SESSION_CREATED.
 *   - touchSession: update lastSeenAt (no-op nếu revoked).
 *   - revokeSession: idempotent + revoke child RefreshToken + emit.
 *   - revokeAllForUser: revoke nhiều session 1 lúc.
 *   - handleReuseDetected: emit REFRESH_TOKEN_REUSED CRITICAL + revoke
 *     session family.
 *   - handleReuseDetected fallback (no sessionId): revoke tất cả
 *     refresh token user.
 *   - listForUser: filter revoked + current flag.
 *   - listForAdmin: filter userId/status + pagination.
 *
 * Privacy:
 *   - Verify response KHÔNG chứa hashedToken/jti raw.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { SessionService } from './session.service';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let service: SessionService;

const IP_HASH = 'a'.repeat(64);
const UA = 'Mozilla/5.0 vitest';

async function createUser(email = `s-${Math.random().toString(36).slice(2, 10)}@xt.local`) {
  return prisma.user.create({
    data: {
      email,
      passwordHash: 'x',
      passwordVersion: 1,
      role: 'PLAYER',
      banned: false,
    },
  });
}

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  service = new SessionService(prisma);
});

beforeEach(async () => {
  await prisma.securityEvent.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.userSession.deleteMany({});
  await prisma.user.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('SessionService.createSession', () => {
  it('tạo UserSession row với ipHash + userAgent + emit SESSION_CREATED', async () => {
    const user = await createUser();
    const exp = new Date(Date.now() + 60_000);
    const s = await service.createSession({
      userId: user.id,
      ipHash: IP_HASH,
      userAgent: UA,
      expiresAt: exp,
    });
    expect(s.userId).toBe(user.id);
    expect(s.ipHash).toBe(IP_HASH);
    expect(s.userAgent).toBe(UA);
    expect(s.expiresAt.getTime()).toBe(exp.getTime());
    expect(s.revokedAt).toBeNull();
    expect(s.suspicious).toBe(false);

    const ev = await prisma.securityEvent.findMany({
      where: { type: 'SESSION_CREATED', userId: user.id },
    });
    expect(ev.length).toBe(1);
    expect(ev[0].severity).toBe('INFO');
    expect(ev[0].ipHash).toBe(IP_HASH);
    const detail = ev[0].detailJson as { sessionId: string };
    expect(detail.sessionId).toBe(s.id);
  });
});

describe('SessionService.touchSession', () => {
  it('update lastSeenAt khi session active', async () => {
    const user = await createUser();
    const s = await service.createSession({
      userId: user.id,
      ipHash: IP_HASH,
      userAgent: UA,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const before = s.lastSeenAt.getTime();
    await new Promise((r) => setTimeout(r, 30));
    await service.touchSession(s.id);
    const after = await prisma.userSession.findUnique({ where: { id: s.id } });
    expect(after?.lastSeenAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('no-op khi session đã revoked', async () => {
    const user = await createUser();
    const s = await service.createSession({
      userId: user.id,
      ipHash: IP_HASH,
      userAgent: UA,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await service.revokeSession({
      sessionId: s.id,
      reason: 'USER_LOGOUT',
      revokedById: user.id,
    });
    const before = (await prisma.userSession.findUnique({ where: { id: s.id } }))!.lastSeenAt;
    await new Promise((r) => setTimeout(r, 20));
    await service.touchSession(s.id);
    const after = await prisma.userSession.findUnique({ where: { id: s.id } });
    expect(after?.lastSeenAt.getTime()).toBe(before.getTime());
  });
});

describe('SessionService.revokeSession', () => {
  it('revoke session + revoke tất cả RefreshToken con + emit SESSION_REVOKED', async () => {
    const user = await createUser();
    const s = await service.createSession({
      userId: user.id,
      ipHash: IP_HASH,
      userAgent: UA,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await prisma.refreshToken.create({
      data: {
        jti: 'jti-a',
        userId: user.id,
        hashedToken: 'h1',
        passwordVersion: 1,
        expiresAt: new Date(Date.now() + 60_000),
        sessionId: s.id,
      },
    });
    await prisma.refreshToken.create({
      data: {
        jti: 'jti-b',
        userId: user.id,
        hashedToken: 'h2',
        passwordVersion: 1,
        expiresAt: new Date(Date.now() + 60_000),
        sessionId: s.id,
      },
    });

    const out = await service.revokeSession({
      sessionId: s.id,
      reason: 'ADMIN_REVOKE',
      revokedById: 'admin-1',
    });
    expect(out?.revokedAt).not.toBeNull();
    expect(out?.revokedReason).toBe('ADMIN_REVOKE');
    expect(out?.revokedById).toBe('admin-1');

    const tokens = await prisma.refreshToken.findMany({
      where: { sessionId: s.id },
    });
    expect(tokens.length).toBe(2);
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);

    const ev = await prisma.securityEvent.findMany({
      where: { type: 'SESSION_REVOKED', userId: user.id },
    });
    expect(ev.length).toBe(1);
  });

  it('idempotent — revoke 2 lần không emit event thứ 2', async () => {
    const user = await createUser();
    const s = await service.createSession({
      userId: user.id,
      ipHash: IP_HASH,
      userAgent: UA,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await service.revokeSession({
      sessionId: s.id,
      reason: 'USER_LOGOUT',
      revokedById: user.id,
    });
    await service.revokeSession({
      sessionId: s.id,
      reason: 'ADMIN_REVOKE',
      revokedById: 'admin-1',
    });
    const evs = await prisma.securityEvent.findMany({
      where: { type: 'SESSION_REVOKED' },
    });
    expect(evs.length).toBe(1);
  });

  it('return null khi sessionId không tồn tại', async () => {
    const out = await service.revokeSession({
      sessionId: 'missing-id',
      reason: 'ADMIN_REVOKE',
      revokedById: 'admin-1',
    });
    expect(out).toBeNull();
  });
});

describe('SessionService.handleReuseDetected', () => {
  it('emit REFRESH_TOKEN_REUSED CRITICAL + revoke session', async () => {
    const user = await createUser();
    const s = await service.createSession({
      userId: user.id,
      ipHash: IP_HASH,
      userAgent: UA,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const t = await prisma.refreshToken.create({
      data: {
        jti: 'jti-reuse',
        userId: user.id,
        hashedToken: 'h-reuse',
        passwordVersion: 1,
        expiresAt: new Date(Date.now() + 60_000),
        sessionId: s.id,
      },
    });

    await service.handleReuseDetected({
      refreshTokenId: t.id,
      sessionId: s.id,
      userId: user.id,
      ipHash: IP_HASH,
    });

    const after = await prisma.userSession.findUnique({ where: { id: s.id } });
    expect(after?.revokedAt).not.toBeNull();
    expect(after?.revokedReason).toBe('REFRESH_REUSED');

    const reuseEv = await prisma.securityEvent.findMany({
      where: { type: 'REFRESH_TOKEN_REUSED' },
    });
    expect(reuseEv.length).toBe(1);
    expect(reuseEv[0].severity).toBe('CRITICAL');
    expect(reuseEv[0].ipHash).toBe(IP_HASH);
    // detail KHÔNG chứa raw token / hashedToken.
    const detail = JSON.stringify(reuseEv[0].detailJson);
    expect(detail).not.toContain('h-reuse');
  });

  it('fallback khi sessionId=null: revoke tất cả refresh token của user', async () => {
    const user = await createUser();
    await prisma.refreshToken.createMany({
      data: [
        {
          jti: 'orphan-1',
          userId: user.id,
          hashedToken: 'h1',
          passwordVersion: 1,
          expiresAt: new Date(Date.now() + 60_000),
        },
        {
          jti: 'orphan-2',
          userId: user.id,
          hashedToken: 'h2',
          passwordVersion: 1,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    });
    await service.handleReuseDetected({
      refreshTokenId: 'orphan-1-id',
      sessionId: null,
      userId: user.id,
      ipHash: IP_HASH,
    });
    const tokens = await prisma.refreshToken.findMany({
      where: { userId: user.id },
    });
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
  });
});

describe('SessionService.listForUser', () => {
  it('default chỉ trả ACTIVE; flag current=true cho session khớp', async () => {
    const user = await createUser();
    const s1 = await service.createSession({
      userId: user.id,
      ipHash: IP_HASH,
      userAgent: 'UA1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const s2 = await service.createSession({
      userId: user.id,
      ipHash: IP_HASH,
      userAgent: 'UA2',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await service.revokeSession({
      sessionId: s2.id,
      reason: 'USER_LOGOUT',
      revokedById: user.id,
    });

    const out = await service.listForUser({
      userId: user.id,
      currentSessionId: s1.id,
    });
    expect(out.sessions.length).toBe(1);
    expect(out.sessions[0].id).toBe(s1.id);
    expect(out.sessions[0].current).toBe(true);
    expect(out.sessions[0].status).toBe('ACTIVE');
  });

  it('includeRevoked=true trả cả REVOKED', async () => {
    const user = await createUser();
    const s = await service.createSession({
      userId: user.id,
      ipHash: IP_HASH,
      userAgent: UA,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await service.revokeSession({
      sessionId: s.id,
      reason: 'USER_LOGOUT',
      revokedById: user.id,
    });
    const out = await service.listForUser({
      userId: user.id,
      includeRevoked: true,
    });
    expect(out.sessions.length).toBe(1);
    expect(out.sessions[0].status).toBe('REVOKED');
  });
});

describe('SessionService.listForAdmin', () => {
  it('filter status=ACTIVE bỏ qua revoked + expired', async () => {
    const u1 = await createUser();
    await service.createSession({
      userId: u1.id,
      ipHash: IP_HASH,
      userAgent: 'active',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const revoked = await service.createSession({
      userId: u1.id,
      ipHash: IP_HASH,
      userAgent: 'revoked',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await service.revokeSession({
      sessionId: revoked.id,
      reason: 'ADMIN_REVOKE',
      revokedById: 'admin',
    });
    await prisma.userSession.create({
      data: {
        userId: u1.id,
        ipHash: IP_HASH,
        userAgent: 'expired',
        expiresAt: new Date(Date.now() - 10_000),
      },
    });

    const active = await service.listForAdmin({
      status: 'ACTIVE',
      limit: 50,
    });
    expect(active.sessions.length).toBe(1);
    expect(active.sessions[0].userAgent).toBe('active');

    const revokedList = await service.listForAdmin({
      status: 'REVOKED',
      limit: 50,
    });
    expect(revokedList.sessions.length).toBe(1);
    expect(revokedList.sessions[0].userAgent).toBe('revoked');

    const expiredList = await service.listForAdmin({
      status: 'EXPIRED',
      limit: 50,
    });
    expect(expiredList.sessions.length).toBe(1);
    expect(expiredList.sessions[0].userAgent).toBe('expired');
  });

  it('filter theo userId', async () => {
    const u1 = await createUser();
    const u2 = await createUser();
    await service.createSession({
      userId: u1.id,
      ipHash: IP_HASH,
      userAgent: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await service.createSession({
      userId: u2.id,
      ipHash: IP_HASH,
      userAgent: 'u2',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const out = await service.listForAdmin({
      userId: u1.id,
      limit: 50,
    });
    expect(out.sessions.length).toBe(1);
    expect(out.sessions[0].userId).toBe(u1.id);
  });

  it('pagination — nextCursor khi vượt limit', async () => {
    const u = await createUser();
    for (let i = 0; i < 3; i++) {
      await service.createSession({
        userId: u.id,
        ipHash: IP_HASH,
        userAgent: `s-${i}`,
        expiresAt: new Date(Date.now() + 60_000),
      });
    }
    const page = await service.listForAdmin({ limit: 2 });
    expect(page.sessions.length).toBe(2);
    expect(page.nextCursor).not.toBeNull();
  });
});

describe('SessionService privacy', () => {
  it('toSummary không expose hashedToken/jti', () => {
    const row = {
      id: 'sess-1',
      userId: 'u-1',
      ipHash: IP_HASH,
      userAgent: UA,
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      revokedReason: null,
      revokedById: null,
      suspicious: false,
    };
    const summary = service.toSummary(row as never, null, new Date());
    const stringified = JSON.stringify(summary);
    expect(stringified).not.toContain('hashedToken');
    expect(stringified).not.toContain('jti');
    expect(stringified).not.toContain('password');
  });
});
