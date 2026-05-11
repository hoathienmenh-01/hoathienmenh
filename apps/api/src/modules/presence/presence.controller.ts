import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PresenceQueryResponse } from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { PresenceService } from './presence.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

/**
 * Phase 19.3 — Presence read-only REST surface.
 *
 * Routes:
 *   - `GET /social/presence?userIds=a,b,c` → batch query online +
 *     lastSeenAt cho ≤50 user.
 *
 * Auth: yêu cầu PLAYER session (`xt_access` cookie). KHÔNG mở public —
 * presence là semi-private (chỉ user authenticated query được).
 *
 * Privacy:
 *   - Service đã filter blocker-of-viewer (user đã block viewer →
 *     không leak presence).
 *   - Phase 19.3 chưa fuzz `lastSeenAt`; future có thể round xuống
 *     phút/giờ. Hiện trả ISO timestamp gốc.
 */
@Controller('social')
export class PresenceController {
  constructor(
    private readonly presence: PresenceService,
    private readonly auth: AuthService,
  ) {}

  @Get('presence')
  async listPresence(
    @Req() req: Request,
    @Query('userIds') userIdsRaw: string | undefined,
  ): Promise<{ ok: true; data: PresenceQueryResponse }> {
    const viewerUserId = await this.requireUserId(req);
    if (!userIdsRaw || typeof userIdsRaw !== 'string') {
      return { ok: true, data: { presences: [] } };
    }
    const ids = userIdsRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 64);
    if (ids.length === 0) {
      return { ok: true, data: { presences: [] } };
    }
    if (ids.length > 50) {
      fail('INVALID_INPUT');
    }
    const presences = await this.presence.listPresenceForUsers(
      viewerUserId,
      ids,
    );
    return { ok: true, data: { presences } };
  }

  private async requireUserId(req: Request): Promise<string> {
    const id = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }
}
