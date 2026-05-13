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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  AdminMailLogRow,
  AdminMailSendInput,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import {
  AdminMailError,
  AdminMailService,
  type AdminMailSendResult,
} from './admin-mail.service';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('admin/mail')
@UseGuards(AdminGuard)
@RequireAdmin()
export class AdminMailController {
  constructor(private readonly svc: AdminMailService) {}

  @Get()
  async list(
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
  ): Promise<{ ok: true; data: { logs: AdminMailLogRow[] } }> {
    const lim = limit ? Math.max(1, Math.min(200, parseInt(limit, 10) || 50)) : 50;
    const logs = await this.svc.listAuditLogs({
      cursor: cursor ?? null,
      limit: lim,
    });
    return { ok: true, data: { logs } };
  }

  @Get(':id/logs')
  async details(
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { log: AdminMailLogRow | null } }> {
    const log = await this.svc.getAuditLog(id);
    return { ok: true, data: { log } };
  }

  @Post('send-one')
  @HttpCode(200)
  async sendOne(
    @Req() req: Request & { userId?: string },
    @Body() body: unknown,
  ): Promise<{ ok: true; data: AdminMailSendResult }> {
    if (!isObject(body)) fail('INVALID_INPUT');
    const input = { ...body, kind: 'SEND_ONE' } as AdminMailSendInput;
    try {
      const data = await this.svc.send(req.userId ?? '', input);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('send-bulk')
  @HttpCode(200)
  async sendBulk(
    @Req() req: Request & { userId?: string },
    @Body() body: unknown,
  ): Promise<{ ok: true; data: AdminMailSendResult }> {
    if (!isObject(body)) fail('INVALID_INPUT');
    const input = { ...body, kind: 'SEND_BULK' } as AdminMailSendInput;
    try {
      const data = await this.svc.send(req.userId ?? '', input);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('send-global')
  @HttpCode(200)
  async sendGlobal(
    @Req() req: Request & { userId?: string },
    @Body() body: unknown,
  ): Promise<{ ok: true; data: AdminMailSendResult }> {
    if (!isObject(body)) fail('INVALID_INPUT');
    const input = { ...body, kind: 'SEND_GLOBAL' } as AdminMailSendInput;
    try {
      const data = await this.svc.send(req.userId ?? '', input);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof AdminMailError) {
      if (e.code === 'INVALID_RECIPIENT') fail(e.code, HttpStatus.NOT_FOUND);
      fail(e.code, HttpStatus.BAD_REQUEST);
    }
    throw e;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
