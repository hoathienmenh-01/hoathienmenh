import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  NOTIFICATION_LIMITS,
  isNotificationType,
  type NotificationListResponse,
  type NotificationRow,
  type NotificationType,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { NotificationService } from './notification.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

/**
 * Phase 19.3 — Notification REST surface.
 *
 * Routes (all require PLAYER cookie session):
 *   - `GET /notifications?cursor=&limit=&types=&unread=true|false` —
 *     list của chính user.
 *   - `GET /notifications/unread-count` — badge count.
 *   - `POST /notifications/:id/read` — mark 1 entry.
 *   - `POST /notifications/read-all` — mark all.
 *
 * Privacy:
 *   - Mọi route filter `userId = requester`. Không có cross-user
 *     access path. MOD/ADMIN không có endpoint xem notification user
 *     khác (audit hành vi user là việc của audit log, không phải
 *     notification inbox).
 *
 * Errors:
 *   - 401 UNAUTHENTICATED nếu thiếu cookie / expired.
 *   - 400 INVALID_INPUT nếu query param sai.
 *   - 403 FORBIDDEN nếu mark read notification của user khác.
 *   - 404 NOTIFICATION_NOT_FOUND nếu id không tồn tại.
 */
@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('types') typesRaw: string | undefined,
    @Query('unread') unreadRaw: string | undefined,
  ): Promise<{ ok: true; data: NotificationListResponse }> {
    const userId = await this.requireUserId(req);
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 20;
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
      fail('INVALID_INPUT');
    }
    if (parsedLimit > NOTIFICATION_LIMITS.LIST_PAGE_MAX) {
      fail('INVALID_INPUT');
    }
    let types: NotificationType[] | null = null;
    if (typesRaw && typeof typesRaw === 'string') {
      const split = typesRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const filtered: NotificationType[] = [];
      for (const s of split) {
        if (!isNotificationType(s)) fail('INVALID_INPUT');
        filtered.push(s);
      }
      types = filtered;
    }
    let unreadOnly: boolean | undefined;
    if (unreadRaw === 'true') unreadOnly = true;
    else if (unreadRaw === 'false') unreadOnly = false;

    const data = await this.notifications.listNotifications({
      userId,
      types,
      cursor: cursor ?? null,
      limit: parsedLimit,
      unreadOnly,
    });
    return { ok: true, data };
  }

  @Get('unread-count')
  async unreadCount(
    @Req() req: Request,
  ): Promise<{ ok: true; data: { unreadCount: number } }> {
    const userId = await this.requireUserId(req);
    const unreadCount = await this.notifications.countUnread(userId);
    return { ok: true, data: { unreadCount } };
  }

  @Post(':id/read')
  async markRead(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { notification: NotificationRow } }> {
    const userId = await this.requireUserId(req);
    if (!id || typeof id !== 'string') fail('INVALID_INPUT');
    const notification = await this.notifications.markRead(userId, id);
    return { ok: true, data: { notification } };
  }

  @Post('read-all')
  async markAllRead(
    @Req() req: Request,
  ): Promise<{ ok: true; data: { markedCount: number } }> {
    const userId = await this.requireUserId(req);
    const res = await this.notifications.markAllRead(userId);
    return { ok: true, data: res };
  }

  private async requireUserId(req: Request): Promise<string> {
    const id = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }
}
