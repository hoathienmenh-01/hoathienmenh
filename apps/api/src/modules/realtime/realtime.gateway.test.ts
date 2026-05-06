import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplication } from '@nestjs/common';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { WsFrame } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeModule } from './realtime.module';
import { RealtimeService } from './realtime.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

const ACCESS_SECRET = 'test-ws-access-secret';
const ACCESS_COOKIE = 'xt_access';

let app: INestApplication;
let prisma: PrismaService;
let realtime: RealtimeService;
let jwt: JwtService;
let port: number;

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  const mod = await Test.createTestingModule({
    imports: [RealtimeModule],
  }).compile();
  app = mod.createNestApplication();
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(0);
  const addr = (app.getHttpServer().address() as AddressInfo) ?? { port: 0 };
  port = addr.port;
  prisma = app.get(PrismaService);
  realtime = app.get(RealtimeService);
  jwt = app.get(JwtService);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await app?.close();
});

async function signAccess(userId: string): Promise<string> {
  return jwt.signAsync({ sub: userId }, { secret: ACCESS_SECRET, expiresIn: '15m' });
}

interface ConnectOpts {
  cookie?: string;
  token?: string;
}

function connect(opts: ConnectOpts = {}): ClientSocket {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  return ioClient(`http://127.0.0.1:${port}`, {
    path: '/ws',
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: headers,
    auth: opts.token ? { token: opts.token } : {},
  });
}

function waitConnect(sock: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout')), 4000);
    sock.once('connect', () => {
      clearTimeout(t);
      resolve();
    });
    sock.once('connect_error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

function waitEvent<T>(sock: ClientSocket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`event "${event}" timeout`)), timeoutMs);
    sock.once(event, (payload: T) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

function waitClosed(sock: ClientSocket, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (!sock.connected) return resolve();
      if (Date.now() - start > timeoutMs) return resolve();
      setTimeout(tick, 30);
    };
    tick();
  });
}

describe('RealtimeGateway — WS auth từ cookie', () => {
  it('cookie xt_access hợp lệ → connect OK + map đúng userId', async () => {
    const u = await makeUserChar(prisma);
    const token = await signAccess(u.userId);
    const sock = connect({ cookie: `${ACCESS_COOKIE}=${token}` });
    try {
      await waitConnect(sock);
      // Đợi handleConnection xong (attach userId vào userSockets).
      await new Promise((r) => setTimeout(r, 100));
      expect(sock.connected).toBe(true);
      expect(realtime.isOnline(u.userId)).toBe(true);
    } finally {
      sock.disconnect();
    }
  });

  it('handshake.auth.token hợp lệ → connect OK (fallback path khi không có cookie)', async () => {
    const u = await makeUserChar(prisma);
    const token = await signAccess(u.userId);
    const sock = connect({ token });
    try {
      await waitConnect(sock);
      await new Promise((r) => setTimeout(r, 100));
      expect(realtime.isOnline(u.userId)).toBe(true);
    } finally {
      sock.disconnect();
    }
  });

  it('emitToUser deliver đúng socket của user (không leak qua user khác)', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const sockA = connect({ cookie: `${ACCESS_COOKIE}=${await signAccess(a.userId)}` });
    const sockB = connect({ cookie: `${ACCESS_COOKIE}=${await signAccess(b.userId)}` });
    try {
      await Promise.all([waitConnect(sockA), waitConnect(sockB)]);
      await new Promise((r) => setTimeout(r, 100));

      // Listener cho B — nếu deliver lệch, B sẽ nhận event của A.
      let bGotIt = false;
      sockB.on('cultivate:tick', () => {
        bGotIt = true;
      });

      const recv = waitEvent<WsFrame<{ exp: number }>>(sockA, 'cultivate:tick');
      realtime.emitToUser(a.userId, 'cultivate:tick', { exp: 42 });

      const frame = await recv;
      expect(frame.type).toBe('cultivate:tick');
      expect(frame.payload.exp).toBe(42);
      expect(typeof frame.ts).toBe('number');
      // Cho B 200ms để chứng minh KHÔNG nhận.
      await new Promise((r) => setTimeout(r, 200));
      expect(bGotIt).toBe(false);
    } finally {
      sockA.disconnect();
      sockB.disconnect();
    }
  });

  it('anti-regression G1: cultivate:tick live push không cần F5', async () => {
    const u = await makeUserChar(prisma);
    const sock = connect({ cookie: `${ACCESS_COOKIE}=${await signAccess(u.userId)}` });
    try {
      await waitConnect(sock);
      await new Promise((r) => setTimeout(r, 100));

      const recv = waitEvent<WsFrame<{ realmKey: string; stage: number }>>(
        sock,
        'cultivate:tick',
      );
      realtime.emitToUser(u.userId, 'cultivate:tick', {
        realmKey: 'luyenkhi',
        stage: 1,
      });
      const frame = await recv;
      expect(frame.payload.realmKey).toBe('luyenkhi');
    } finally {
      sock.disconnect();
    }
  });

  it('anti-regression G2: chat:msg broadcast world room đến mọi socket đã auth', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const sockA = connect({ cookie: `${ACCESS_COOKIE}=${await signAccess(a.userId)}` });
    const sockB = connect({ cookie: `${ACCESS_COOKIE}=${await signAccess(b.userId)}` });
    try {
      await Promise.all([waitConnect(sockA), waitConnect(sockB)]);
      await new Promise((r) => setTimeout(r, 100));

      const recvA = waitEvent<WsFrame<{ text: string }>>(sockA, 'chat:msg');
      const recvB = waitEvent<WsFrame<{ text: string }>>(sockB, 'chat:msg');
      realtime.emitToRoom('world', 'chat:msg', { text: 'hello world' });

      const [fa, fb] = await Promise.all([recvA, recvB]);
      expect(fa.payload.text).toBe('hello world');
      expect(fb.payload.text).toBe('hello world');
    } finally {
      sockA.disconnect();
      sockB.disconnect();
    }
  });

  it('không có cookie + không có handshake.auth → bị disconnect ngay', async () => {
    const sock = connect({});
    try {
      // Server emit 'error' rồi disconnect; chờ socket đóng.
      await waitClosed(sock);
      expect(sock.connected).toBe(false);
    } finally {
      sock.disconnect();
    }
  });

  it('JWT sai signature → bị disconnect ngay', async () => {
    const sock = connect({ cookie: `${ACCESS_COOKIE}=not-a-real-jwt` });
    try {
      await waitClosed(sock);
      expect(sock.connected).toBe(false);
    } finally {
      sock.disconnect();
    }
  });

  it('JWT hết hạn → bị disconnect, không attach userId', async () => {
    const u = await makeUserChar(prisma);
    const expired = await jwt.signAsync(
      { sub: u.userId },
      { secret: ACCESS_SECRET, expiresIn: -10 },
    );
    const sock = connect({ cookie: `${ACCESS_COOKIE}=${expired}` });
    try {
      await waitClosed(sock);
      expect(sock.connected).toBe(false);
      expect(realtime.isOnline(u.userId)).toBe(false);
    } finally {
      sock.disconnect();
    }
  });

  it('disconnect: detach khỏi userSockets, isOnline=false sau khi rời', async () => {
    const u = await makeUserChar(prisma);
    const sock = connect({ cookie: `${ACCESS_COOKIE}=${await signAccess(u.userId)}` });
    await waitConnect(sock);
    await new Promise((r) => setTimeout(r, 100));
    expect(realtime.isOnline(u.userId)).toBe(true);
    sock.disconnect();
    await new Promise((r) => setTimeout(r, 200));
    expect(realtime.isOnline(u.userId)).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Concurrency phase 2 — Ban during connection (Realtime hardening)
  //
  // Trước fix: `handleConnection` chỉ verify JWT signature/exp, KHÔNG
  // check `User.banned`. JWT access-token TTL ~15 phút → user bị admin
  // ban vẫn connect/nhận event đến khi token expire. Auth REST path đã
  // chặn login/refresh/me bằng `ACCOUNT_BANNED` (auth.service.ts:148/
  // 312/352) — gateway bỏ sót.
  //
  // Sau fix:
  //  - `handleConnection`: query `user.banned` post-JWT-verify; banned →
  //    emit `error{code:ACCOUNT_BANNED}` + `disconnect(true)`, không
  //    attach socket vào `userSockets`.
  //  - `RealtimeService.kickUser(userId, reason)`: snapshot socket id
  //    set + iterate disconnect — idempotent.
  //  - `AdminService.setBanned(banned=true)`: gọi
  //    `realtime.kickUser(targetUserId, 'ACCOUNT_BANNED')` sau khi
  //    Prisma update + audit.
  // ─────────────────────────────────────────────────────────────────────
  it('user banned trước khi connect → JWT hợp lệ vẫn bị disconnect (ACCOUNT_BANNED)', async () => {
    const u = await makeUserChar(prisma);
    // Ban user TRƯỚC khi connect — emulate admin đã ban xong, user
    // chưa kịp logout.
    await prisma.user.update({
      where: { id: u.userId },
      data: { banned: true },
    });
    const token = await signAccess(u.userId);
    const sock = connect({ cookie: `${ACCESS_COOKIE}=${token}` });
    let errFrame: { code?: string } | null = null;
    sock.on('error', (frame: { code?: string }) => {
      errFrame = frame;
    });
    try {
      await waitClosed(sock);
      expect(sock.connected).toBe(false);
      // Không leak online state — banned user không attach.
      expect(realtime.isOnline(u.userId)).toBe(false);
      // Server emit error trước disconnect; client có thể nhận hoặc bỏ
      // lỡ tuỳ timing transport. Nếu nhận thì code phải đúng.
      if (errFrame !== null) {
        expect((errFrame as { code?: string }).code).toBe('ACCOUNT_BANNED');
      }
    } finally {
      sock.disconnect();
    }
  });

  it('user đang connect → admin ban (kickUser) → socket bị disconnect, isOnline=false', async () => {
    const u = await makeUserChar(prisma);
    const sock = connect({ cookie: `${ACCESS_COOKIE}=${await signAccess(u.userId)}` });
    try {
      await waitConnect(sock);
      await new Promise((r) => setTimeout(r, 100));
      expect(sock.connected).toBe(true);
      expect(realtime.isOnline(u.userId)).toBe(true);

      // Race: trong khi connection còn sống, admin trigger kickUser
      // (mô phỏng AdminService.setBanned wire). Service.kickUser snapshot
      // socket id set + emit `error{code:ACCOUNT_BANNED}` + disconnect.
      let kickErrFrame: { code?: string } | null = null;
      sock.on('error', (frame: { code?: string }) => {
        kickErrFrame = frame;
      });
      const ok = realtime.kickUser(u.userId, 'ACCOUNT_BANNED');
      expect(ok).toBe(true);

      await waitClosed(sock);
      expect(sock.connected).toBe(false);
      // Sau handleDisconnect → detach từ userSockets.
      await new Promise((r) => setTimeout(r, 200));
      expect(realtime.isOnline(u.userId)).toBe(false);
      if (kickErrFrame !== null) {
        expect((kickErrFrame as { code?: string }).code).toBe('ACCOUNT_BANNED');
      }

      // kickUser idempotent — gọi lại trên user đã offline → return false.
      const ok2 = realtime.kickUser(u.userId, 'ACCOUNT_BANNED');
      expect(ok2).toBe(false);
    } finally {
      sock.disconnect();
    }
  });

  it('user có sect → auto-join sect:<id> room → emitToRoom deliver', async () => {
    const u = await makeUserChar(prisma);
    const s = await prisma.sect.create({
      data: { name: `WS-${u.name}`, description: '', leaderId: u.characterId },
    });
    await prisma.character.update({
      where: { id: u.characterId },
      data: { sectId: s.id },
    });
    const sock = connect({ cookie: `${ACCESS_COOKIE}=${await signAccess(u.userId)}` });
    try {
      await waitConnect(sock);
      await new Promise((r) => setTimeout(r, 100));
      const recv = waitEvent<WsFrame<{ msg: string }>>(sock, 'chat:msg');
      realtime.emitToRoom(`sect:${s.id}`, 'chat:msg', { msg: 'sect-only' });
      const frame = await recv;
      expect(frame.payload.msg).toBe('sect-only');
    } finally {
      sock.disconnect();
    }
  });
});
