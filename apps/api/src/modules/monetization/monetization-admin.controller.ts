import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { MonetizationError, MonetizationService } from './monetization.service';

type AdminReq = Request & { userId: string; role: Role };

const VipGrantInput = z.object({
  level: z.number().int().min(0).max(5),
  lifetimeTopupAmount: z.number().int().min(0).max(10_000_000).default(0),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('admin')
@UseGuards(AdminGuard)
export class MonetizationAdminController {
  constructor(private readonly monetization: MonetizationService) {}

  @Post('battle-pass/users/:id/grant-premium')
  @HttpCode(200)
  @RequireAdmin()
  async grantBattlePassPremium(@Req() req: AdminReq, @Param('id') id: string) {
    try {
      await this.monetization.adminGrantBattlePassPremium(req.userId, id);
      return { ok: true };
    } catch (e) {
      this.failMonetization(e);
    }
  }

  @Post('monthly-card/users/:id/grant')
  @HttpCode(200)
  @RequireAdmin()
  async grantMonthlyCard(@Req() req: AdminReq, @Param('id') id: string) {
    try {
      await this.monetization.adminGrantMonthlyCard(req.userId, id);
      return { ok: true };
    } catch (e) {
      this.failMonetization(e);
    }
  }

  @Post('vip/users/:id/grant')
  @HttpCode(200)
  @RequireAdmin()
  async grantVip(@Req() req: AdminReq, @Param('id') id: string, @Body() body: unknown) {
    const parsed = VipGrantInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      await this.monetization.adminGrantVip(
        req.userId,
        id,
        parsed.data.level,
        parsed.data.lifetimeTopupAmount,
      );
      return { ok: true };
    } catch (e) {
      this.failMonetization(e);
    }
  }

  private failMonetization(e: unknown): never {
    if (e instanceof MonetizationError) {
      const status =
        e.code === 'NO_CHARACTER' || e.code === 'NO_ACTIVE_SEASON'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST;
      fail(e.code, status);
    }
    throw e;
  }
}
