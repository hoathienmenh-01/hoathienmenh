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
import { COSMETIC_SOURCES, type CosmeticSource } from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { CosmeticError, CosmeticsService } from './cosmetics.service';

type AdminReq = Request & { userId: string; role: Role };

const GrantInput = z.object({
  cosmeticId: z.string().min(1),
  source: z
    .enum(COSMETIC_SOURCES as readonly [CosmeticSource, ...CosmeticSource[]])
    .optional(),
  durationDays: z.number().int().min(1).max(3650).optional(),
  reason: z.string().min(1).max(120).optional(),
});

const RevokeInput = z.object({
  cosmeticId: z.string().min(1),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('admin')
@UseGuards(AdminGuard)
export class CosmeticsAdminController {
  constructor(private readonly service: CosmeticsService) {}

  @Post('cosmetics/users/:id/grant')
  @HttpCode(200)
  @RequireAdmin()
  async grant(
    @Req() req: AdminReq,
    @Param('id') targetUserId: string,
    @Body() body: unknown,
  ) {
    const parsed = GrantInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const result = await this.service.adminGrant(
        req.userId,
        targetUserId,
        parsed.data.cosmeticId,
        {
          source: parsed.data.source,
          durationDays: parsed.data.durationDays,
          reason: parsed.data.reason,
        },
      );
      return { ok: true, data: result };
    } catch (e) {
      this.failCosmetic(e);
    }
  }

  @Post('cosmetics/users/:id/revoke')
  @HttpCode(200)
  @RequireAdmin()
  async revoke(
    @Req() req: AdminReq,
    @Param('id') targetUserId: string,
    @Body() body: unknown,
  ) {
    const parsed = RevokeInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const result = await this.service.adminRevoke(
        req.userId,
        targetUserId,
        parsed.data.cosmeticId,
      );
      return { ok: true, data: result };
    } catch (e) {
      this.failCosmetic(e);
    }
  }

  private failCosmetic(e: unknown): never {
    if (e instanceof CosmeticError) {
      const status =
        e.code === 'NO_CHARACTER' || e.code === 'COSMETIC_NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST;
      fail(e.code, status);
    }
    throw e;
  }
}
