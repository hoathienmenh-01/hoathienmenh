import {
  Body,
  Controller,
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
  MyPartyDungeonRoomResponse,
  PartyDungeonRewardClaimDto,
  PartyDungeonRunDetailResponse,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import {
  PartyDungeonError,
  PartyDungeonService,
} from './party-dungeon.service';

const ACCESS_COOKIE = 'xt_access';

const CreateRoomInput = z.object({
  dungeonKey: z.string().min(1).max(80),
});

const RoomIdInput = z.object({
  roomId: z.string().min(1).max(80),
});

const RunIdParam = z.string().min(1).max(80);

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

/**
 * Phase 20.1 — Party Dungeon Co-op PvE Foundation REST surface.
 *
 * Auth: cookie `xt_access` → `AuthService.requireUserId`. Mọi
 * endpoint yêu cầu authenticated PLAYER.
 *
 * Privacy / authz: tất cả mutation pass qua service `PartyDungeon
 * Service`. Service enforce:
 *   - Caller phải ở party active. Non-member → `NOT_IN_PARTY` →
 *     404 mask (`NOT_FOUND`).
 *   - Caller phải ở cùng party với room. Người ngoài party →
 *     `NOT_PARTY_MEMBER` → 404 mask.
 *   - Leader-only ops (`createRoom`, `startRun`, `cancelRoom`) →
 *     `NOT_PARTY_LEADER` → 403.
 *
 * Rate-limit:
 *   - `POST /party/dungeon/rooms`        → `PARTY_DUNGEON_CREATE`
 *   - `POST /party/dungeon/ready`        → `PARTY_DUNGEON_READY`
 *   - `POST /party/dungeon/unready`      → `PARTY_DUNGEON_READY`
 *   - `POST /party/dungeon/start`        → `PARTY_DUNGEON_START`
 *   - `POST /party/dungeon/cancel`       → `PARTY_DUNGEON_START`
 *   - `POST /party/dungeon/runs/:id/claim-reward` →
 *     `PARTY_DUNGEON_CLAIM`
 *
 * GET endpoints KHÔNG gắn policy (fall through `DEFAULT_API`).
 *
 * KHÔNG log token / cookie / secret. Lỗi service map sang HTTP
 * status thông qua `statusFor`.
 */
@Controller('party/dungeon')
export class PartyDungeonController {
  constructor(
    private readonly party: PartyDungeonService,
    private readonly auth: AuthService,
  ) {}

  private async requireUserId(req: Request): Promise<string> {
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    const token = cookies[ACCESS_COOKIE];
    const id = await this.auth.userIdFromAccess(token);
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  private statusFor(code: PartyDungeonError['code']): number {
    switch (code) {
      case 'NOT_FOUND':
      case 'ROOM_NOT_FOUND':
      case 'RUN_NOT_FOUND':
      case 'PARTICIPANT_NOT_FOUND':
      case 'REWARD_NOT_FOUND':
      case 'NOT_IN_PARTY':
      case 'NOT_PARTY_MEMBER':
        return HttpStatus.NOT_FOUND;
      case 'NOT_AUTHORIZED':
      case 'NOT_PARTY_LEADER':
        return HttpStatus.FORBIDDEN;
      case 'INVALID_INPUT':
      case 'INVALID_DUNGEON':
      case 'NO_CHARACTER':
        return HttpStatus.BAD_REQUEST;
      case 'ROOM_ALREADY_EXISTS':
      case 'ROOM_NOT_LOBBY':
      case 'NOT_ENOUGH_MEMBERS':
      case 'NOT_ALL_READY':
      case 'RUN_NOT_COMPLETED':
      case 'REWARD_ALREADY_CLAIMED':
      case 'DAILY_CAP_REACHED':
      case 'WEEKLY_CAP_REACHED':
        // Phase 20.3 — cap gate reject mirrors REWARD_ALREADY_CLAIMED
        // (caller có row hợp lệ nhưng bị reject vì cap ngoài tham
        // số) → 409 Conflict.
        return HttpStatus.CONFLICT;
      default:
        return HttpStatus.BAD_REQUEST;
    }
  }

  private rethrowAsHttp(e: unknown): never {
    if (e instanceof PartyDungeonError) {
      throw new HttpException(
        { ok: false, error: { code: e.code, message: e.code } },
        this.statusFor(e.code),
      );
    }
    if (e instanceof HttpException) throw e;
    throw new HttpException(
      { ok: false, error: { code: 'INTERNAL' } },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  @Get('room')
  async getMyRoom(
    @Req() req: Request,
  ): Promise<{ ok: true; data: MyPartyDungeonRoomResponse }> {
    const userId = await this.requireUserId(req);
    const data = await this.party.getMyRoom(userId);
    return { ok: true, data };
  }

  @Get('runs/:id')
  async getRunDetail(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: PartyDungeonRunDetailResponse }> {
    const userId = await this.requireUserId(req);
    const parsed = RunIdParam.safeParse(id);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.party.getRunDetail({
        userId,
        runId: parsed.data,
      });
      return { ok: true, data };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  @Post('rooms')
  @HttpCode(HttpStatus.CREATED)
  @RateLimitPolicy('PARTY_DUNGEON_CREATE')
  async createRoom(
    @Req() req: Request,
    @Body() raw: unknown,
  ): Promise<{ ok: true; data: MyPartyDungeonRoomResponse }> {
    const userId = await this.requireUserId(req);
    const parsed = CreateRoomInput.safeParse(raw);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.party.createRoom({
        leaderUserId: userId,
        dungeonKey: parsed.data.dungeonKey,
      });
      return { ok: true, data };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('join')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('PARTY_DUNGEON_READY')
  async joinRoom(
    @Req() req: Request,
    @Body() raw: unknown,
  ): Promise<{ ok: true; data: MyPartyDungeonRoomResponse }> {
    const userId = await this.requireUserId(req);
    const parsed = RoomIdInput.safeParse(raw);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.party.joinFromParty({
        userId,
        roomId: parsed.data.roomId,
      });
      return { ok: true, data };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('ready')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('PARTY_DUNGEON_READY')
  async setReady(
    @Req() req: Request,
    @Body() raw: unknown,
  ): Promise<{ ok: true; data: MyPartyDungeonRoomResponse }> {
    const userId = await this.requireUserId(req);
    const parsed = RoomIdInput.safeParse(raw);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.party.setReady({
        userId,
        roomId: parsed.data.roomId,
      });
      return { ok: true, data };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('unready')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('PARTY_DUNGEON_READY')
  async cancelReady(
    @Req() req: Request,
    @Body() raw: unknown,
  ): Promise<{ ok: true; data: MyPartyDungeonRoomResponse }> {
    const userId = await this.requireUserId(req);
    const parsed = RoomIdInput.safeParse(raw);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.party.cancelReady({
        userId,
        roomId: parsed.data.roomId,
      });
      return { ok: true, data };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('start')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('PARTY_DUNGEON_START')
  async startRun(
    @Req() req: Request,
    @Body() raw: unknown,
  ): Promise<{ ok: true; data: MyPartyDungeonRoomResponse }> {
    const userId = await this.requireUserId(req);
    const parsed = RoomIdInput.safeParse(raw);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.party.startRun({
        leaderUserId: userId,
        roomId: parsed.data.roomId,
      });
      return { ok: true, data };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('PARTY_DUNGEON_START')
  async cancelRoom(
    @Req() req: Request,
    @Body() raw: unknown,
  ): Promise<{ ok: true; data: MyPartyDungeonRoomResponse }> {
    const userId = await this.requireUserId(req);
    const parsed = RoomIdInput.safeParse(raw);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.party.cancelRoom({
        leaderUserId: userId,
        roomId: parsed.data.roomId,
      });
      return { ok: true, data };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }

  @Post('runs/:id/claim-reward')
  @HttpCode(HttpStatus.OK)
  @RateLimitPolicy('PARTY_DUNGEON_CLAIM')
  async claimReward(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { claim: PartyDungeonRewardClaimDto } }> {
    const userId = await this.requireUserId(req);
    const parsed = RunIdParam.safeParse(id);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const claim = await this.party.claimReward({
        userId,
        runId: parsed.data,
      });
      return { ok: true, data: { claim } };
    } catch (e) {
      this.rethrowAsHttp(e);
    }
  }
}
