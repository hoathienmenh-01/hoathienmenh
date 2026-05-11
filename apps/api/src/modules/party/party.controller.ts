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
  MyPartyResponse,
  PartyDto,
  PartyInviteDto,
  PartyInviteListResponse,
  PartyMemberDto,
  PartyMemberListResponse,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import { PartyError, PartyService } from './party.service';

const ACCESS_COOKIE = 'xt_access';

const CreatePartyInput = z.object({
  name: z.string().max(80).optional().nullable(),
});

const InviteInput = z.object({
  inviteeUserId: z.string().min(1).max(64),
});

const TransferLeaderInput = z.object({
  targetUserId: z.string().min(1).max(64),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

function statusFor(code: PartyError['code']): number {
  switch (code) {
    case 'NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'NOT_AUTHORIZED':
      return HttpStatus.FORBIDDEN;
    case 'BLOCKED':
      return HttpStatus.FORBIDDEN;
    case 'SELF_NOT_ALLOWED':
    case 'INVALID_INPUT':
      return HttpStatus.BAD_REQUEST;
    case 'ALREADY_IN_PARTY':
    case 'INVITEE_IN_OTHER_PARTY':
    case 'DUPLICATE_INVITE':
    case 'PARTY_FULL':
    case 'TOO_MANY_PENDING_INVITES':
    case 'INVITE_EXPIRED':
    case 'INVITE_NOT_PENDING':
    case 'PARTY_DISBANDED':
      return HttpStatus.CONFLICT;
    case 'NOT_MEMBER':
    case 'TARGET_NOT_MEMBER':
      return HttpStatus.NOT_FOUND;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

/**
 * Phase 19.4 — Group / Party System Upgrade REST surface.
 *
 * Auth: cookie `xt_access` → `AuthService.requireUserId`. Mọi endpoint
 * yêu cầu authenticated PLAYER.
 *
 * Rate-limit: gắn `@RateLimitPolicy()` cho mutation:
 *   - `POST /party` → `PARTY_CREATE` (10 / giờ / user).
 *   - `POST /party/invites` → `PARTY_INVITE_SEND` (20 / phút / user).
 *   - Các mutation khác (accept/decline/cancel/leave/kick/transfer/
 *     disband) → `PARTY_MUTATION` (60 / phút / user).
 *
 * GET endpoint KHÔNG gắn policy (fall through `DEFAULT_API`).
 *
 * Response shape: `{ ok: true, data }` cho success;
 * `{ ok: false, error: { code, message } }` cho lỗi (matches existing
 * controllers).
 *
 * KHÔNG log token / cookie / secret. Lỗi service được map sang HTTP
 * status thông qua `statusFor`.
 */
@Controller('party')
export class PartyController {
  constructor(
    private readonly party: PartyService,
    private readonly auth: AuthService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read endpoints
  // ---------------------------------------------------------------------------

  @Get('me')
  async getMyParty(
    @Req() req: Request,
  ): Promise<{ ok: true; data: MyPartyResponse }> {
    const userId = await this.requireUserId(req);
    const result = await this.party.getMyParty(userId);
    return { ok: true, data: result };
  }

  @Get('members')
  async listMembers(
    @Req() req: Request,
  ): Promise<{ ok: true; data: PartyMemberListResponse }> {
    const userId = await this.requireUserId(req);
    const members = await this.party.listMembers(userId);
    return { ok: true, data: { members } };
  }

  @Get('invites/incoming')
  async listIncomingInvites(
    @Req() req: Request,
  ): Promise<{ ok: true; data: PartyInviteListResponse }> {
    const userId = await this.requireUserId(req);
    const invites = await this.party.listIncomingInvites(userId);
    return { ok: true, data: { invites } };
  }

  @Get('invites/outgoing')
  async listOutgoingInvites(
    @Req() req: Request,
  ): Promise<{ ok: true; data: PartyInviteListResponse }> {
    const userId = await this.requireUserId(req);
    const invites = await this.party.listOutgoingInvites(userId);
    return { ok: true, data: { invites } };
  }

  // ---------------------------------------------------------------------------
  // Create + lifecycle
  // ---------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimitPolicy('PARTY_CREATE')
  async createParty(
    @Req() req: Request,
    @Body() raw: unknown,
  ): Promise<{
    ok: true;
    data: { party: PartyDto; members: PartyMemberDto[] };
  }> {
    const userId = await this.requireUserId(req);
    const parsed = CreatePartyInput.safeParse(raw);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const result = await this.party.createParty(userId, parsed.data.name ?? null);
      return { ok: true, data: result };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('invites')
  @HttpCode(HttpStatus.CREATED)
  @RateLimitPolicy('PARTY_INVITE_SEND')
  async sendInvite(
    @Req() req: Request,
    @Body() raw: unknown,
  ): Promise<{ ok: true; data: { invite: PartyInviteDto } }> {
    const userId = await this.requireUserId(req);
    const parsed = InviteInput.safeParse(raw);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const invite = await this.party.inviteToParty(
        userId,
        parsed.data.inviteeUserId,
      );
      return { ok: true, data: { invite } };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('invites/:id/accept')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('PARTY_MUTATION')
  async acceptInvite(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{
    ok: true;
    data: { party: PartyDto; members: PartyMemberDto[] };
  }> {
    const userId = await this.requireUserId(req);
    if (!id || id.length > 64) fail('INVALID_INPUT');
    try {
      const result = await this.party.acceptInvite(userId, id);
      return { ok: true, data: result };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('invites/:id/decline')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('PARTY_MUTATION')
  async declineInvite(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { invite: PartyInviteDto } }> {
    const userId = await this.requireUserId(req);
    if (!id || id.length > 64) fail('INVALID_INPUT');
    try {
      const invite = await this.party.declineInvite(userId, id);
      return { ok: true, data: { invite } };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Delete('invites/:id')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('PARTY_MUTATION')
  async cancelInvite(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { invite: PartyInviteDto } }> {
    const userId = await this.requireUserId(req);
    if (!id || id.length > 64) fail('INVALID_INPUT');
    try {
      const invite = await this.party.cancelInvite(userId, id);
      return { ok: true, data: { invite } };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('leave')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('PARTY_MUTATION')
  async leaveParty(
    @Req() req: Request,
  ): Promise<{
    ok: true;
    data: { party: PartyDto | null; members: PartyMemberDto[] };
  }> {
    const userId = await this.requireUserId(req);
    try {
      const result = await this.party.leaveParty(userId);
      return { ok: true, data: result };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('members/:userId/kick')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('PARTY_MUTATION')
  async kickMember(
    @Req() req: Request,
    @Param('userId') targetUserId: string,
  ): Promise<{
    ok: true;
    data: { party: PartyDto; members: PartyMemberDto[] };
  }> {
    const callerUserId = await this.requireUserId(req);
    if (!targetUserId || targetUserId.length > 64) fail('INVALID_INPUT');
    try {
      const result = await this.party.kickMember(callerUserId, targetUserId);
      return { ok: true, data: result };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('leader/transfer')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('PARTY_MUTATION')
  async transferLeader(
    @Req() req: Request,
    @Body() raw: unknown,
  ): Promise<{
    ok: true;
    data: { party: PartyDto; members: PartyMemberDto[] };
  }> {
    const callerUserId = await this.requireUserId(req);
    const parsed = TransferLeaderInput.safeParse(raw);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const result = await this.party.transferLeader(
        callerUserId,
        parsed.data.targetUserId,
      );
      return { ok: true, data: result };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('disband')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('PARTY_MUTATION')
  async disbandParty(
    @Req() req: Request,
  ): Promise<{ ok: true; data: { partyId: string } }> {
    const callerUserId = await this.requireUserId(req);
    try {
      const result = await this.party.disbandParty(callerUserId);
      return { ok: true, data: result };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async requireUserId(req: Request): Promise<string> {
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    const token = cookies[ACCESS_COOKIE];
    const id = await this.auth.userIdFromAccess(token);
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  private rethrowAsHttp(e: unknown): never {
    if (e instanceof PartyError) {
      fail(e.code, statusFor(e.code));
    }
    throw e;
  }
}
