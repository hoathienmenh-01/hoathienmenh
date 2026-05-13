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
  PLAYER_REPORT_LIMITS,
  PLAYER_REPORT_STATUSES,
  type PlayerReportListResponse,
  type PlayerReportRow,
  type PlayerReportStatus,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { AdminGuard } from '../admin/admin.guard';
import { PlayerReportError, PlayerReportService } from './player-report.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

function clampLimit(raw: string | undefined): number {
  if (!raw) return PLAYER_REPORT_LIMITS.LIST_PAGE_DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return PLAYER_REPORT_LIMITS.LIST_PAGE_DEFAULT;
  return Math.min(Math.max(n, 1), PLAYER_REPORT_LIMITS.LIST_PAGE_MAX);
}

function clampStatus(raw: string | undefined): PlayerReportStatus | null {
  if (!raw) return null;
  return (PLAYER_REPORT_STATUSES as readonly string[]).includes(raw)
    ? (raw as PlayerReportStatus)
    : null;
}

@Controller('support/report-player')
export class PlayerReportController {
  constructor(
    private readonly svc: PlayerReportService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { report: PlayerReportRow } }> {
    const userId = await this.requireUserId(req);
    try {
      const report = await this.svc.create(userId, body);
      return { ok: true, data: { report } };
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
  ): Promise<{ ok: true; data: PlayerReportListResponse }> {
    const userId = await this.requireUserId(req);
    try {
      const data = await this.svc.listForUser(userId, {
        cursor: cursor ?? null,
        limit: clampLimit(limit),
        status: clampStatus(status),
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
  ): Promise<{ ok: true; data: { report: PlayerReportRow } }> {
    const userId = await this.requireUserId(req);
    try {
      const report = await this.svc.getForUser(userId, id);
      return { ok: true, data: { report } };
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
    if (e instanceof PlayerReportError) {
      switch (e.code) {
        case 'NO_CHARACTER':
          fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
        case 'REPORT_NOT_FOUND':
          fail('REPORT_NOT_FOUND', HttpStatus.NOT_FOUND);
        case 'REPORT_TARGET_NOT_FOUND':
          fail('REPORT_TARGET_NOT_FOUND', HttpStatus.NOT_FOUND);
        case 'REPORT_RATE_LIMITED':
          fail('REPORT_RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
        case 'REPORT_SELF_NOT_ALLOWED':
          fail('REPORT_SELF_NOT_ALLOWED');
        case 'SUPPORT_PERMISSION_DENIED':
          fail('SUPPORT_PERMISSION_DENIED', HttpStatus.FORBIDDEN);
        case 'REPORT_VALIDATION_FAILED':
        default:
          fail('REPORT_VALIDATION_FAILED');
      }
    }
    throw e;
  }
}

@Controller('admin/support/reports')
@UseGuards(AdminGuard)
export class AdminPlayerReportController {
  constructor(private readonly svc: PlayerReportService) {}

  @Get()
  async list(
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('status') status: string | undefined,
    @Query('targetCharacterId') target: string | undefined,
  ): Promise<{ ok: true; data: PlayerReportListResponse }> {
    try {
      const data = await this.svc.adminList({
        cursor: cursor ?? null,
        limit: clampLimit(limit),
        status: clampStatus(status),
        targetCharacterId: target ?? null,
      });
      return { ok: true, data };
    } catch (e) {
      handleAdminErr(e);
    }
  }

  @Get(':id')
  async detail(
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { report: PlayerReportRow } }> {
    try {
      const report = await this.svc.adminGet(id);
      return { ok: true, data: { report } };
    } catch (e) {
      handleAdminErr(e);
    }
  }

  @Patch(':id')
  async patch(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { report: PlayerReportRow } }> {
    try {
      const report = await this.svc.adminPatch(id, body);
      return { ok: true, data: { report } };
    } catch (e) {
      handleAdminErr(e);
    }
  }
}

function handleAdminErr(e: unknown): never {
  if (e instanceof PlayerReportError) {
    switch (e.code) {
      case 'REPORT_NOT_FOUND':
        fail('REPORT_NOT_FOUND', HttpStatus.NOT_FOUND);
      case 'REPORT_VALIDATION_FAILED':
        fail('REPORT_VALIDATION_FAILED');
      default:
        fail('ADMIN_SUPPORT_PERMISSION_DENIED', HttpStatus.FORBIDDEN);
    }
  }
  throw e;
}
