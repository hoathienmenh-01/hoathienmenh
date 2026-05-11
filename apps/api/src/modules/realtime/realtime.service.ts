import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { WsEventType, WsFrame } from '@xuantoi/shared';

@Injectable()
export class RealtimeService {
  private server: Server | null = null;
  private readonly logger = new Logger(RealtimeService.name);
  private readonly userSockets = new Map<string, Set<string>>();

  bind(server: Server): void {
    if (!this.server) this.server = server;
  }

  attach(userId: string, socketId: string): void {
    let set = this.userSockets.get(userId);
    if (!set) {
      set = new Set();
      this.userSockets.set(userId, set);
    }
    set.add(socketId);
  }

  detach(userId: string, socketId: string): void {
    const set = this.userSockets.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) this.userSockets.delete(userId);
  }

  emitToUser<T>(userId: string, type: WsEventType, payload: T): void {
    if (!this.server) return;
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    const frame: WsFrame<T> = { type, payload, ts: Date.now() };
    for (const sid of sockets) {
      this.server.to(sid).emit(type, frame);
    }
  }

  broadcast<T>(type: WsEventType, payload: T): void {
    if (!this.server) return;
    const frame: WsFrame<T> = { type, payload, ts: Date.now() };
    this.server.emit(type, frame);
  }

  emitToRoom<T>(room: string, type: WsEventType, payload: T): void {
    if (!this.server) return;
    const frame: WsFrame<T> = { type, payload, ts: Date.now() };
    this.server.to(room).emit(type, frame);
  }

  joinUserToRoom(userId: string, room: string): void {
    if (!this.server) return;
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    for (const sid of sockets) {
      this.server.sockets.sockets.get(sid)?.join(room);
    }
  }

  leaveUserFromRoom(userId: string, room: string): void {
    if (!this.server) return;
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    for (const sid of sockets) {
      void this.server.sockets.sockets.get(sid)?.leave(room);
    }
  }

  isOnline(userId: string): boolean {
    return (this.userSockets.get(userId)?.size ?? 0) > 0;
  }

  /**
   * Phase 19.3 — Số connection (socket) hiện tại của 1 user. Hỗ trợ
   * `PresenceService` tính state transition (0↔1) cho fanout
   * `presence:update`. Multi-tab safe: count = số tab WS đang mở.
   */
  countConnectionsForUser(userId: string): number {
    return this.userSockets.get(userId)?.size ?? 0;
  }

  /**
   * Force-disconnect tất cả socket của user (vd khi admin ban giữa
   * session). Emit `error` frame với code/reason để client log + render
   * banner trước khi `disconnect(true)`. Idempotent — gọi với userId
   * không online thì no-op (return false). Trả về `true` nếu đã kick
   * được >= 1 socket.
   *
   * Pattern: snapshot Set socket id (clone) trước khi loop để tránh mutate
   * trong khi iterate (`detach` từ `handleDisconnect` callback sẽ xoá
   * khỏi `userSockets`).
   */
  kickUser(userId: string, reason: string): boolean {
    if (!this.server) return false;
    const sockets = this.userSockets.get(userId);
    if (!sockets || sockets.size === 0) return false;
    const sids = [...sockets];
    let kicked = 0;
    for (const sid of sids) {
      const sock = this.server.sockets.sockets.get(sid);
      if (!sock) continue;
      try {
        sock.emit('error', { code: reason });
      } catch {
        // emit có thể throw nếu socket đã closing — ignore.
      }
      sock.disconnect(true);
      kicked += 1;
    }
    return kicked > 0;
  }

  countOnline(): number {
    return this.userSockets.size;
  }

  trace(): void {
    this.logger.debug(
      `online=${this.countOnline()} sockets=${[...this.userSockets].map(([u, s]) => `${u}:${s.size}`).join(',')}`,
    );
  }
}
