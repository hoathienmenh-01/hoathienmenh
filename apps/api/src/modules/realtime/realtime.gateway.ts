import { Inject, Logger, forwardRef } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import type { WsFrame } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { PresenceService } from '../presence/presence.service';

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
import { RealtimeService } from './realtime.service';

const ACCESS_COOKIE = 'xt_access';

@WebSocketGateway({
  path: '/ws',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly realtime: RealtimeService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => PresenceService))
    private readonly presence: PresenceService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.emit('error', { code: 'UNAUTHENTICATED' });
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
      });
      // Ban check trên realtime path. Phase 2 concurrency hardening: JWT
      // hợp lệ KHÔNG đủ — user có thể đã bị admin ban giữa lúc token còn
      // sống (token TTL ~15 phút). Auth REST path đã chặn trên login/
      // refresh/me (`auth.service.ts` `ACCOUNT_BANNED`); WS gateway
      // trước fix bỏ sót, banned user vẫn nhận `state:update` /
      // `chat:msg` / `cultivate:tick` cho đến khi token expire. Sau fix:
      // `User.banned` true → emit error code `ACCOUNT_BANNED` + disconnect
      // ngay, không attach socket vào `userSockets`.
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { banned: true },
      });
      if (!user || user.banned) {
        client.emit('error', { code: 'ACCOUNT_BANNED' });
        client.disconnect(true);
        return;
      }
      client.data.userId = payload.sub;
      this.realtime.bind(this.server);
      this.realtime.attach(payload.sub, client.id);
      // Auto-join world room cho mọi socket; sect room nếu có sectId.
      void client.join('world');
      const char = await this.prisma.character.findUnique({
        where: { userId: payload.sub },
        select: { sectId: true },
      });
      if (char?.sectId) void client.join(`sect:${char.sectId}`);
      this.logger.log(`ws conn user=${payload.sub} sid=${client.id}`);

      // Phase 19.3 — presence tracking. markConnected returns previous /
      // current connection counts so we know if this socket transitioned
      // user from offline → online (and only fanout in that case).
      try {
        const update = await this.presence.markConnected(payload.sub);
        if (update.previousConnections === 0 && update.currentConnections > 0) {
          await this.presence.fanoutPresenceUpdate(update);
        }
      } catch (e) {
        this.logger.warn(
          `presence markConnected failed user=${payload.sub}: ${(e as Error).message}`,
        );
      }
    } catch {
      client.emit('error', { code: 'UNAUTHENTICATED' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;
    this.realtime.detach(userId, client.id);

    // Phase 19.3 — presence tracking. markDisconnected returns counts
    // AFTER detach; if user now has 0 active connections → emit
    // presence:update OFFLINE to friends.
    try {
      const update = await this.presence.markDisconnected(userId);
      if (update.previousConnections > 0 && update.currentConnections === 0) {
        await this.presence.fanoutPresenceUpdate(update);
      }
    } catch (e) {
      this.logger.warn(
        `presence markDisconnected failed user=${userId}: ${(e as Error).message}`,
      );
    }
  }

  @SubscribeMessage('ping')
  onPing(
    @MessageBody() _data: unknown,
    @ConnectedSocket() _client: Socket,
  ): WsFrame<Record<string, never>> {
    return { type: 'pong', payload: {}, ts: Date.now() };
  }

  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth?.token as string | undefined;
    if (auth) return auth;
    const cookieHeader = client.handshake.headers.cookie;
    if (!cookieHeader) return null;
    const cookies = parseCookie(cookieHeader);
    return cookies[ACCESS_COOKIE] ?? null;
  }
}
