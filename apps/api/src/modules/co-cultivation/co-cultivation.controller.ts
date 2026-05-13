import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type {
  CoCultivationErrorCode,
  CoCultivationHistoryResponse,
  CoCultivationSessionRow,
  CoCultivationStatusResponse,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { CoCultivationError, CoCultivationService } from './co-cultivation.service';

const ACCESS_COOKIE = 'xt_access';

const RequestSessionInput = z.object({
  partnerUserId: z.string().min(1).max(64),
  durationSec: z.number().int().positive().max(3600).optional(),
  buffPercent: z.number().int().min(1).max(5).optional(),
});

const HistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  before: z.string().datetime().optional(),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

function statusFor(code: CoCultivationErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
    case 'NO_CHARACTER':
      return HttpStatus.NOT_FOUND;
    case 'NOT_AUTHORIZED':
    case 'BLOCKED':
    case 'SELF_NOT_ALLOWED':
      return HttpStatus.FORBIDDEN;
    case 'ALREADY_ACTIVE':
    case 'DAILY_CAP_REACHED':
    case 'BUFF_BUDGET_EXCEEDED':
    case 'COOLDOWN_ACTIVE':
    case 'INVALID_TRANSITION':
    case 'PARTNER_OFFLINE':
      return HttpStatus.CONFLICT;
    case 'INVALID_INPUT':
    case 'NOT_FRIEND':
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

/**
 * Phase 35.1 — Co-Cultivation REST surface (`/social/co-cultivation/*`).
 *
 * Tất cả endpoint yêu cầu PLAYER session (cookie `xt_access`).
 * Server-authoritative — không nhận bonusExp/durationSec từ client
 * tự ý vượt cap (đã clamp ở shared `clampDurationSec`/`clampBuffPercent`).
 */
@Controller('social/co-cultivation')
export class CoCultivationController {
  constructor(
    private readonly svc: CoCultivationService,
    private readonly auth: AuthService,
  ) {}

  @Get('status')
  async status(
    @Req() req: Request,
  ): Promise<{ ok: true; data: CoCultivationStatusResponse }> {
    const userId = await this.requireUserId(req);
    const data = await this.svc.getStatus(userId);
    return { ok: true, data };
  }

  @Get('history')
  async history(
    @Req() req: Request,
    @Query() query: unknown,
  ): Promise<{ ok: true; data: CoCultivationHistoryResponse }> {
    const userId = await this.requireUserId(req);
    const parsed = HistoryQuery.safeParse(query ?? {});
    if (!parsed.success) fail('INVALID_INPUT');
    const data = await this.svc.getHistory(userId, parsed.data);
    return { ok: true, data };
  }

  @Post('sessions')
  @HttpCode(200)
  async request(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { session: CoCultivationSessionRow } }> {
    const userId = await this.requireUserId(req);
    const parsed = RequestSessionInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const session = await this.svc.requestSession(userId, parsed.data);
      return { ok: true, data: { session } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('sessions/:id/accept')
  @HttpCode(200)
  async accept(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { session: CoCultivationSessionRow } }> {
    const userId = await this.requireUserId(req);
    try {
      const session = await this.svc.acceptSession(userId, id);
      return { ok: true, data: { session } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('sessions/:id/cancel')
  @HttpCode(200)
  async cancel(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { session: CoCultivationSessionRow } }> {
    const userId = await this.requireUserId(req);
    try {
      const session = await this.svc.cancelSession(userId, id);
      return { ok: true, data: { session } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('sessions/:id/complete')
  @HttpCode(200)
  async complete(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { session: CoCultivationSessionRow } }> {
    const userId = await this.requireUserId(req);
    try {
      const session = await this.svc.completeSession(userId, id);
      return { ok: true, data: { session } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private async requireUserId(req: Request): Promise<string> {
    const id = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  private handleErr(e: unknown): never {
    if (e instanceof CoCultivationError) {
      fail(e.code, statusFor(e.code));
    }
    throw e;
  }
}
