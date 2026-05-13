import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  FEEDBACK_LIMITS,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  type FeedbackListResponse,
  type FeedbackStatus,
  type FeedbackType,
  type PlayerFeedbackRow,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { AdminGuard } from '../admin/admin.guard';
import {
  FeedbackError,
  PlayerFeedbackService,
} from './player-feedback.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

function clampLimit(raw: string | undefined): number {
  if (!raw) return FEEDBACK_LIMITS.LIST_PAGE_DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return FEEDBACK_LIMITS.LIST_PAGE_DEFAULT;
  return Math.min(Math.max(n, 1), FEEDBACK_LIMITS.LIST_PAGE_MAX);
}

function clampStatus(raw: string | undefined): FeedbackStatus | null {
  if (!raw) return null;
  return (FEEDBACK_STATUSES as readonly string[]).includes(raw)
    ? (raw as FeedbackStatus)
    : null;
}

function clampType(raw: string | undefined): FeedbackType | null {
  if (!raw) return null;
  return (FEEDBACK_TYPES as readonly string[]).includes(raw)
    ? (raw as FeedbackType)
    : null;
}

@Controller('support/feedback')
export class PlayerFeedbackController {
  constructor(
    private readonly svc: PlayerFeedbackService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { feedback: PlayerFeedbackRow } }> {
    const userId = await this.requireUserId(req);
    try {
      const feedback = await this.svc.create(userId, body);
      return { ok: true, data: { feedback } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('my')
  async listMy(
    @Req() req: Request,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('status') status: string | undefined,
    @Query('type') type: string | undefined,
  ): Promise<{ ok: true; data: FeedbackListResponse }> {
    const userId = await this.requireUserId(req);
    try {
      const data = await this.svc.listForUser(userId, {
        cursor: cursor ?? null,
        limit: clampLimit(limit),
        status: clampStatus(status),
        type: clampType(type),
      });
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get(':id')
  async getOne(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { feedback: PlayerFeedbackRow } }> {
    const userId = await this.requireUserId(req);
    try {
      const feedback = await this.svc.getForUser(userId, id);
      return { ok: true, data: { feedback } };
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
    if (e instanceof FeedbackError) {
      const map: Record<string, [string, number]> = {
        NO_CHARACTER: ['NO_CHARACTER', HttpStatus.NOT_FOUND],
        FEEDBACK_NOT_FOUND: ['FEEDBACK_NOT_FOUND', HttpStatus.NOT_FOUND],
        SUPPORT_PERMISSION_DENIED: [
          'SUPPORT_PERMISSION_DENIED',
          HttpStatus.FORBIDDEN,
        ],
        FEEDBACK_RATE_LIMITED: [
          'FEEDBACK_RATE_LIMITED',
          HttpStatus.TOO_MANY_REQUESTS,
        ],
        FEEDBACK_VALIDATION_FAILED: [
          'FEEDBACK_VALIDATION_FAILED',
          HttpStatus.BAD_REQUEST,
        ],
      };
      const [code, status] = map[e.code] ?? [
        'FEEDBACK_VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
      ];
      fail(code, status);
    }
    throw e;
  }
}

@Controller('admin/support/feedback')
@UseGuards(AdminGuard)
export class AdminFeedbackController {
  constructor(private readonly svc: PlayerFeedbackService) {}

  @Get()
  async list(
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('status') status: string | undefined,
    @Query('type') type: string | undefined,
  ): Promise<{ ok: true; data: FeedbackListResponse }> {
    try {
      const data = await this.svc.adminList({
        cursor: cursor ?? null,
        limit: clampLimit(limit),
        status: clampStatus(status),
        type: clampType(type),
      });
      return { ok: true, data };
    } catch (e) {
      handleAdminErr(e);
    }
  }

  @Get(':id')
  async detail(
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { feedback: PlayerFeedbackRow } }> {
    try {
      const feedback = await this.svc.adminGet(id);
      return { ok: true, data: { feedback } };
    } catch (e) {
      handleAdminErr(e);
    }
  }

  @Patch(':id')
  async patch(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { feedback: PlayerFeedbackRow } }> {
    try {
      const feedback = await this.svc.adminPatch(id, body);
      return { ok: true, data: { feedback } };
    } catch (e) {
      handleAdminErr(e);
    }
  }

  @Post(':id/resolve')
  @HttpCode(200)
  async resolve(
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { feedback: PlayerFeedbackRow } }> {
    try {
      const feedback = await this.svc.adminResolve(id);
      return { ok: true, data: { feedback } };
    } catch (e) {
      handleAdminErr(e);
    }
  }

  @Post(':id/close')
  @HttpCode(200)
  async close(
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { feedback: PlayerFeedbackRow } }> {
    try {
      const feedback = await this.svc.adminClose(id);
      return { ok: true, data: { feedback } };
    } catch (e) {
      handleAdminErr(e);
    }
  }
}

function handleAdminErr(e: unknown): never {
  if (e instanceof FeedbackError) {
    if (e.code === 'FEEDBACK_NOT_FOUND') {
      fail('FEEDBACK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    if (e.code === 'FEEDBACK_VALIDATION_FAILED') {
      fail('FEEDBACK_VALIDATION_FAILED');
    }
    fail('ADMIN_SUPPORT_PERMISSION_DENIED', HttpStatus.FORBIDDEN);
  }
  throw e;
}
