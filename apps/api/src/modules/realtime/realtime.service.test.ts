/**
 * Unit test RealtimeService — 84 dòng core WS adapter, trước đây chỉ có test
 * qua `realtime.gateway.test.ts` (auth handshake). File này cover trực tiếp
 * các method:
 *   - attach/detach userSockets map (aggregation, cleanup khi 0 socket).
 *   - emitToUser/broadcast/emitToRoom/joinUserToRoom/leaveUserFromRoom — đều
 *     phải no-op trước khi `bind(server)` và no-op khi user không có socket.
 *   - isOnline / countOnline — đếm theo USER chứ không phải theo socket (user
 *     2 tab = 1 online, không phải 2).
 *   - bind() chỉ nhận server lần đầu (idempotent).
 *   - Frame shape `{type, payload, ts}` phải đúng và nhất quán ở cả 3 emit.
 *
 * Không cần Prisma/DB; dùng fake Socket.IO Server (object trả chainable
 * `to().emit()` + `sockets.sockets.get()`) đủ để verify call pattern.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeService } from './realtime.service';

type EmitCall = { target: 'to' | 'all'; to?: string; event: string; frame: unknown };

function makeFakeServer() {
  const calls: EmitCall[] = [];
  const socketJoins = new Map<string, string[]>();
  const socketLeaves = new Map<string, string[]>();
  // Track socket-level emit (vd `sock.emit('error', {...})` từ kickUser)
  // và disconnect call. Key by socket id (sid).
  const socketEmits = new Map<string, Array<{ event: string; payload: unknown }>>();
  const socketDisconnects = new Map<string, boolean>();

  const server = {
    emit: vi.fn((event: string, frame: unknown) => {
      calls.push({ target: 'all', event, frame });
      return true;
    }),
    to: vi.fn((target: string) => ({
      emit: vi.fn((event: string, frame: unknown) => {
        calls.push({ target: 'to', to: target, event, frame });
        return true;
      }),
    })),
    sockets: {
      sockets: {
        get: vi.fn((sid: string) => ({
          join: vi.fn((room: string) => {
            const arr = socketJoins.get(sid) ?? [];
            arr.push(room);
            socketJoins.set(sid, arr);
          }),
          leave: vi.fn((room: string) => {
            const arr = socketLeaves.get(sid) ?? [];
            arr.push(room);
            socketLeaves.set(sid, arr);
          }),
          emit: vi.fn((event: string, payload: unknown) => {
            const arr = socketEmits.get(sid) ?? [];
            arr.push({ event, payload });
            socketEmits.set(sid, arr);
            return true;
          }),
          disconnect: vi.fn((close?: boolean) => {
            socketDisconnects.set(sid, close ?? false);
          }),
        })),
      },
    },
  };
  return {
    server,
    calls,
    socketJoins,
    socketLeaves,
    socketEmits,
    socketDisconnects,
  };
}

let svc: RealtimeService;

beforeEach(() => {
  svc = new RealtimeService();
});

describe('RealtimeService.attach / detach / isOnline / countOnline', () => {
  it('attach thêm socket vào set userSockets; isOnline=true; countOnline=1', () => {
    svc.attach('u1', 's1');
    expect(svc.isOnline('u1')).toBe(true);
    expect(svc.countOnline()).toBe(1);
  });

  it('attach 2 socket cùng 1 user — countOnline vẫn 1 (đếm theo user, không theo socket)', () => {
    svc.attach('u1', 's1');
    svc.attach('u1', 's2');
    expect(svc.countOnline()).toBe(1);
    expect(svc.isOnline('u1')).toBe(true);
  });

  it('attach 2 user khác nhau — countOnline=2', () => {
    svc.attach('u1', 's1');
    svc.attach('u2', 's2');
    expect(svc.countOnline()).toBe(2);
  });

  it('detach socket cuối cùng xoá user khỏi map — isOnline=false, countOnline=0', () => {
    svc.attach('u1', 's1');
    svc.detach('u1', 's1');
    expect(svc.isOnline('u1')).toBe(false);
    expect(svc.countOnline()).toBe(0);
  });

  it('detach socket giữa — user vẫn online nếu còn socket khác', () => {
    svc.attach('u1', 's1');
    svc.attach('u1', 's2');
    svc.detach('u1', 's1');
    expect(svc.isOnline('u1')).toBe(true);
    expect(svc.countOnline()).toBe(1);
  });

  it('detach user không tồn tại — no-op, không throw', () => {
    expect(() => svc.detach('nonexistent', 's1')).not.toThrow();
    expect(svc.countOnline()).toBe(0);
  });

  it('detach socket không tồn tại của user đã có — user vẫn giữ socket cũ', () => {
    svc.attach('u1', 's1');
    svc.detach('u1', 'phantom');
    expect(svc.isOnline('u1')).toBe(true);
  });

  it('isOnline=false cho user chưa từng attach', () => {
    expect(svc.isOnline('ghost')).toBe(false);
  });
});

describe('RealtimeService.emitToUser', () => {
  it('no-op khi chưa bind server (không throw)', () => {
    svc.attach('u1', 's1');
    expect(() =>
      svc.emitToUser('u1', 'mail:new', { mailId: 'x' }),
    ).not.toThrow();
  });

  it('no-op khi user không có socket (không throw, không emit)', () => {
    const { server, calls } = makeFakeServer();
    svc.bind(server as unknown as Parameters<RealtimeService['bind']>[0]);
    svc.emitToUser('ghost', 'mail:new', { mailId: 'x' });
    expect(calls.length).toBe(0);
  });

  it('emit tới TỪNG socket của user với frame {type, payload, ts}', () => {
    const { server, calls } = makeFakeServer();
    svc.bind(server as unknown as Parameters<RealtimeService['bind']>[0]);
    svc.attach('u1', 's1');
    svc.attach('u1', 's2');
    svc.emitToUser('u1', 'mail:new', { mailId: 'x' });
    expect(calls.length).toBe(2);
    const socketTargets = calls.map((c) => c.to).sort();
    expect(socketTargets).toEqual(['s1', 's2']);
    for (const c of calls) {
      expect(c.event).toBe('mail:new');
      const frame = c.frame as { type: string; payload: unknown; ts: number };
      expect(frame.type).toBe('mail:new');
      expect(frame.payload).toEqual({ mailId: 'x' });
      expect(typeof frame.ts).toBe('number');
      expect(frame.ts).toBeGreaterThan(0);
    }
  });
});

describe('RealtimeService.broadcast', () => {
  it('no-op khi chưa bind server', () => {
    expect(() => svc.broadcast('chat:msg', { id: 'x' })).not.toThrow();
  });

  it('emit server.emit(type, frame) với frame shape đầy đủ', () => {
    const { server, calls } = makeFakeServer();
    svc.bind(server as unknown as Parameters<RealtimeService['bind']>[0]);
    svc.broadcast('chat:msg', { id: 'x' });
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ target: 'all', event: 'chat:msg' });
    const frame = calls[0].frame as { type: string; payload: unknown; ts: number };
    expect(frame.type).toBe('chat:msg');
    expect(frame.payload).toEqual({ id: 'x' });
  });
});

describe('RealtimeService.emitToRoom', () => {
  it('no-op khi chưa bind server', () => {
    expect(() => svc.emitToRoom('sect:1', 'chat:msg', {})).not.toThrow();
  });

  it('emit server.to(room).emit(type, frame) với frame shape đầy đủ', () => {
    const { server, calls } = makeFakeServer();
    svc.bind(server as unknown as Parameters<RealtimeService['bind']>[0]);
    svc.emitToRoom('sect:abc', 'chat:msg', { id: 'y' });
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({
      target: 'to',
      to: 'sect:abc',
      event: 'chat:msg',
    });
    const frame = calls[0].frame as { type: string; payload: unknown };
    expect(frame.type).toBe('chat:msg');
    expect(frame.payload).toEqual({ id: 'y' });
  });
});

describe('RealtimeService.joinUserToRoom / leaveUserFromRoom', () => {
  it('no-op khi chưa bind server', () => {
    svc.attach('u1', 's1');
    expect(() => svc.joinUserToRoom('u1', 'room')).not.toThrow();
    expect(() => svc.leaveUserFromRoom('u1', 'room')).not.toThrow();
  });

  it('no-op khi user không có socket', () => {
    const { server, socketJoins } = makeFakeServer();
    svc.bind(server as unknown as Parameters<RealtimeService['bind']>[0]);
    svc.joinUserToRoom('ghost', 'room');
    expect(socketJoins.size).toBe(0);
  });

  it('joinUserToRoom gọi socket.join cho MỌI socket của user', () => {
    const { server, socketJoins } = makeFakeServer();
    svc.bind(server as unknown as Parameters<RealtimeService['bind']>[0]);
    svc.attach('u1', 's1');
    svc.attach('u1', 's2');
    svc.joinUserToRoom('u1', 'sect:abc');
    expect(socketJoins.get('s1')).toEqual(['sect:abc']);
    expect(socketJoins.get('s2')).toEqual(['sect:abc']);
  });

  it('leaveUserFromRoom gọi socket.leave cho MỌI socket của user', () => {
    const { server, socketLeaves } = makeFakeServer();
    svc.bind(server as unknown as Parameters<RealtimeService['bind']>[0]);
    svc.attach('u1', 's1');
    svc.attach('u1', 's2');
    svc.leaveUserFromRoom('u1', 'sect:abc');
    expect(socketLeaves.get('s1')).toEqual(['sect:abc']);
    expect(socketLeaves.get('s2')).toEqual(['sect:abc']);
  });
});

describe('RealtimeService.kickUser — admin ban hardening', () => {
  it('kickUser emit error{code} + disconnect tất cả socket của user, return true', () => {
    const { server, socketEmits, socketDisconnects } = makeFakeServer();
    svc.bind(server as unknown as Parameters<RealtimeService['bind']>[0]);
    svc.attach('u1', 's1');
    svc.attach('u1', 's2');

    const ok = svc.kickUser('u1', 'ACCOUNT_BANNED');

    expect(ok).toBe(true);
    expect(socketEmits.get('s1')).toEqual([
      { event: 'error', payload: { code: 'ACCOUNT_BANNED' } },
    ]);
    expect(socketEmits.get('s2')).toEqual([
      { event: 'error', payload: { code: 'ACCOUNT_BANNED' } },
    ]);
    // disconnect(true) — close = true để force socket close.
    expect(socketDisconnects.get('s1')).toBe(true);
    expect(socketDisconnects.get('s2')).toBe(true);
  });

  it('kickUser idempotent — user không online → return false, không throw', () => {
    const { server, socketEmits } = makeFakeServer();
    svc.bind(server as unknown as Parameters<RealtimeService['bind']>[0]);

    const ok = svc.kickUser('u-not-online', 'ACCOUNT_BANNED');

    expect(ok).toBe(false);
    expect(socketEmits.size).toBe(0);
  });

  it('kickUser no-op khi server chưa bind (return false, không throw)', () => {
    // Không gọi bind() trước.
    svc.attach('u1', 's1');
    const ok = svc.kickUser('u1', 'ACCOUNT_BANNED');
    expect(ok).toBe(false);
  });
});

describe('RealtimeService.bind — idempotent', () => {
  it('bind() chỉ nhận server lần đầu; lần 2 bị bỏ qua (tránh ghi đè khi double-init)', () => {
    const first = makeFakeServer();
    const second = makeFakeServer();
    svc.bind(first.server as unknown as Parameters<RealtimeService['bind']>[0]);
    svc.bind(second.server as unknown as Parameters<RealtimeService['bind']>[0]);
    svc.broadcast('chat:msg', { id: 'x' });
    // Chỉ server đầu tiên nhận emit; server thứ 2 không nhận gì.
    expect(first.calls.length).toBe(1);
    expect(second.calls.length).toBe(0);
  });
});
