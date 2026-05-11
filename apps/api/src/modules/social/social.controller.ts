import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type {
  FriendListResponse,
  FriendRequestRow,
  IncomingFriendRequestsResponse,
  OutgoingFriendRequestsResponse,
  PlayerBlockListResponse,
  PlayerBlockRow,
  PublicPlayerProfileResponse,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import { SocialError, SocialService } from './social.service';

const ACCESS_COOKIE = 'xt_access';

const SendFriendRequestInput = z.object({
  receiverUserId: z.string().min(1).max(64),
  message: z.string().max(200).optional().nullable(),
});

const BlockInput = z.object({
  userId: z.string().min(1).max(64),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

function statusFor(code: SocialError['code']): number {
  switch (code) {
    case 'NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'NOT_AUTHORIZED':
      return HttpStatus.FORBIDDEN;
    case 'SELF_NOT_ALLOWED':
    case 'INVALID_INPUT':
    case 'INVALID_TRANSITION':
      return HttpStatus.BAD_REQUEST;
    case 'ALREADY_PENDING':
    case 'ALREADY_FRIENDS':
      return HttpStatus.CONFLICT;
    case 'BLOCKED':
      return HttpStatus.FORBIDDEN;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

/**
 * Phase 19.1 — Social System Foundation public REST surface.
 *
 * All endpoints require PLAYER session (cookie `xt_access`). RBAC by
 * auth-only.
 *
 * Phase 19.1.B — mutation endpoint gắn `@RateLimitPolicy()`:
 *   - `POST /social/friend-requests` → `SOCIAL_FRIEND_REQUEST` (10/min user).
 *   - `POST /social/block` + `DELETE /social/block/:userId` → `SOCIAL_BLOCK_TOGGLE`
 *     (30 / 10 min user).
 * GET list endpoint KHÔNG gắn (fall through default API).
 *
 * Response shape: `{ ok: true, data }` cho success, `{ ok: false,
 * error: { code, message } }` cho lỗi (matches existing controllers).
 * Khi rate-limit hit, `RateLimitGuard` ném 429 với
 * `code='RATE_LIMITED'` hoặc `code='ABUSE_BLOCKED'` (FE xử lý riêng).
 */
@Controller('social')
export class SocialController {
  constructor(
    private readonly social: SocialService,
    private readonly auth: AuthService,
  ) {}

  // ---------------------------------------------------------------------------
  // Friend lists
  // ---------------------------------------------------------------------------

  @Get('friends')
  async listFriends(
    @Req() req: Request,
  ): Promise<{ ok: true; data: FriendListResponse }> {
    const userId = await this.requireUserId(req);
    const friends = await this.social.listFriends(userId);
    return { ok: true, data: { friends } };
  }

  @Get('friend-requests/incoming')
  async listIncoming(
    @Req() req: Request,
  ): Promise<{ ok: true; data: IncomingFriendRequestsResponse }> {
    const userId = await this.requireUserId(req);
    const requests = await this.social.listIncomingRequests(userId);
    return { ok: true, data: { requests } };
  }

  @Get('friend-requests/outgoing')
  async listOutgoing(
    @Req() req: Request,
  ): Promise<{ ok: true; data: OutgoingFriendRequestsResponse }> {
    const userId = await this.requireUserId(req);
    const requests = await this.social.listOutgoingRequests(userId);
    return { ok: true, data: { requests } };
  }

  // ---------------------------------------------------------------------------
  // Phase 19.1.C — Public player profile (Inspect Player)
  // ---------------------------------------------------------------------------

  /**
   * `GET /social/profile/:userId` — trả về public profile cho viewer
   * authenticated. Rate-limit `SOCIAL_PROFILE_VIEW` chống enumeration
   * scrape (60 req / phút / tài khoản, vượt → block 5 phút).
   *
   * Privacy: response chỉ chứa field whitelist trong
   * `PublicPlayerProfileDto`. Service throw `NOT_FOUND` cho cả case
   * "user không tồn tại" và "target đã block viewer" (404 mask).
   */
  @Get('profile/:userId')
  @RateLimitPolicy('SOCIAL_PROFILE_VIEW')
  async getPublicProfile(
    @Req() req: Request,
    @Param('userId') targetUserId: string,
  ): Promise<{ ok: true; data: PublicPlayerProfileResponse }> {
    const viewerUserId = await this.requireUserId(req);
    if (typeof targetUserId !== 'string' || targetUserId.length === 0) {
      fail('INVALID_INPUT');
    }
    if (targetUserId.length > 64) {
      fail('INVALID_INPUT');
    }
    try {
      const profile = await this.social.getPublicProfile(
        viewerUserId,
        targetUserId,
      );
      return { ok: true, data: { profile } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  // ---------------------------------------------------------------------------
  // Friend request mutations
  // ---------------------------------------------------------------------------

  @Post('friend-requests')
  @HttpCode(200)
  @RateLimitPolicy('SOCIAL_FRIEND_REQUEST')
  async sendFriendRequest(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { request: FriendRequestRow } }> {
    const userId = await this.requireUserId(req);
    const parsed = SendFriendRequestInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const request = await this.social.sendFriendRequest(
        userId,
        parsed.data.receiverUserId,
        parsed.data.message ?? null,
      );
      return { ok: true, data: { request } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('friend-requests/:id/accept')
  @HttpCode(200)
  async accept(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{
    ok: true;
    data: { request: FriendRequestRow; friendUserId: string };
  }> {
    const userId = await this.requireUserId(req);
    try {
      const res = await this.social.acceptFriendRequest(userId, id);
      return { ok: true, data: res };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('friend-requests/:id/decline')
  @HttpCode(200)
  async decline(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { request: FriendRequestRow } }> {
    const userId = await this.requireUserId(req);
    try {
      const request = await this.social.declineFriendRequest(userId, id);
      return { ok: true, data: { request } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Delete('friend-requests/:id')
  @HttpCode(200)
  async cancel(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { request: FriendRequestRow } }> {
    const userId = await this.requireUserId(req);
    try {
      const request = await this.social.cancelFriendRequest(userId, id);
      return { ok: true, data: { request } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  // ---------------------------------------------------------------------------
  // Friendship + block mutations
  // ---------------------------------------------------------------------------

  @Delete('friends/:friendUserId')
  @HttpCode(200)
  async removeFriend(
    @Req() req: Request,
    @Param('friendUserId') friendUserId: string,
  ): Promise<{ ok: true; data: { removed: boolean } }> {
    const userId = await this.requireUserId(req);
    try {
      const data = await this.social.removeFriend(userId, friendUserId);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('blocks')
  async listBlocks(
    @Req() req: Request,
  ): Promise<{ ok: true; data: PlayerBlockListResponse }> {
    const userId = await this.requireUserId(req);
    const blocks = await this.social.listBlocks(userId);
    return { ok: true, data: { blocks } };
  }

  @Post('block')
  @HttpCode(200)
  @RateLimitPolicy('SOCIAL_BLOCK_TOGGLE')
  async block(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { block: PlayerBlockRow } }> {
    const userId = await this.requireUserId(req);
    const parsed = BlockInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const block = await this.social.blockUser(
        userId,
        parsed.data.userId,
      );
      return { ok: true, data: { block } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Delete('block/:userId')
  @HttpCode(200)
  @RateLimitPolicy('SOCIAL_BLOCK_TOGGLE')
  async unblock(
    @Req() req: Request,
    @Param('userId') targetId: string,
  ): Promise<{ ok: true; data: { removed: boolean } }> {
    const userId = await this.requireUserId(req);
    const data = await this.social.unblockUser(userId, targetId);
    return { ok: true, data };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async requireUserId(req: Request): Promise<string> {
    const id = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  private handleErr(e: unknown): never {
    if (e instanceof SocialError) {
      fail(e.code, statusFor(e.code));
    }
    throw e;
  }
}
