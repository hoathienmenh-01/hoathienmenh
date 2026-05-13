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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SystemGiftDef } from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { DistributeResult, SystemGiftError, SystemGiftService } from './system-gift.service';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('admin/system-gift')
@UseGuards(AdminGuard)
@RequireAdmin()
export class SystemGiftAdminController {
  constructor(private readonly svc: SystemGiftService) {}

  @Get()
  async list(): Promise<{ ok: true; data: { gifts: SystemGiftDef[] } }> {
    const gifts = await this.svc.list();
    return { ok: true, data: { gifts } };
  }

  @Get(':giftKey')
  async get(
    @Param('giftKey') giftKey: string,
  ): Promise<{ ok: true; data: { gift: SystemGiftDef | null } }> {
    const gift = await this.svc.get(giftKey);
    return { ok: true, data: { gift } };
  }

  @Post()
  @HttpCode(200)
  async upsert(
    @Req() req: Request & { userId?: string },
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { gift: SystemGiftDef } }> {
    if (!isSystemGiftDef(body)) fail('INVALID_INPUT');
    try {
      const gift = await this.svc.upsertDef(body, req.userId ?? null);
      return { ok: true, data: { gift } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':giftKey/distribute')
  @HttpCode(200)
  async distribute(
    @Req() req: Request & { userId?: string },
    @Param('giftKey') giftKey: string,
  ): Promise<{ ok: true; data: DistributeResult }> {
    try {
      const data = await this.svc.distribute(giftKey, req.userId ?? null);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof SystemGiftError) {
      switch (e.code) {
        case 'GIFT_NOT_FOUND':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'GIFT_EXPIRED':
        case 'GIFT_KEY_DUP':
          fail(e.code, HttpStatus.CONFLICT);
        // eslint-disable-next-line no-fallthrough
        case 'INVALID_DEF':
        case 'INVALID_INPUT':
          fail(e.code, HttpStatus.BAD_REQUEST);
      }
    }
    throw e;
  }
}

function isSystemGiftDef(v: unknown): v is SystemGiftDef {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.giftKey === 'string' &&
    typeof o.title === 'string' &&
    typeof o.body === 'string' &&
    !!o.reward &&
    typeof o.reward === 'object' &&
    !!o.targetRule &&
    typeof o.targetRule === 'object'
  );
}
