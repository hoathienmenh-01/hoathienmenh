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
import { ShopPackError, ShopPacksService } from './shop-packs.service';

type AdminReq = Request & { userId: string; role: Role };

const GrantPackInput = z.object({
  packId: z.string().min(1),
});

const GrantPackByBodyInput = GrantPackInput.extend({
  userId: z.string().min(1),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('admin')
@UseGuards(AdminGuard)
export class ShopPacksAdminController {
  constructor(private readonly shopPacks: ShopPacksService) {}

  @Post('shop-packs/users/:id/grant')
  @HttpCode(200)
  @RequireAdmin()
  async grantPack(
    @Req() req: AdminReq,
    @Param('id') targetUserId: string,
    @Body() body: unknown,
  ) {
    const parsed = GrantPackInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const result = await this.shopPacks.adminGrantPack(
        req.userId,
        targetUserId,
        parsed.data.packId,
      );
      return { ok: true, data: result };
    } catch (e) {
      if (e instanceof ShopPackError) {
        const status =
          e.code === 'NO_CHARACTER'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.BAD_REQUEST;
        fail(e.code, status);
      }
      throw e;
    }
  }

  @Post('shop/grant-pack')
  @HttpCode(200)
  @RequireAdmin()
  async grantPackByBody(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = GrantPackByBodyInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const result = await this.shopPacks.adminGrantPack(
        req.userId,
        parsed.data.userId,
        parsed.data.packId,
      );
      return { ok: true, data: result };
    } catch (e) {
      if (e instanceof ShopPackError) {
        const status =
          e.code === 'NO_CHARACTER'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.BAD_REQUEST;
        fail(e.code, status);
      }
      throw e;
    }
  }
}
