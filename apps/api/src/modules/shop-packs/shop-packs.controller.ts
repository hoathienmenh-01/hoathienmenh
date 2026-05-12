import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { ShopPackError, ShopPacksService } from './shop-packs.service';

const ACCESS_COOKIE = 'xt_access';

const PurchaseInput = z.object({
  packId: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('shop-packs')
export class ShopPacksController {
  constructor(
    private readonly shopPacks: ShopPacksService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async listPacks(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    return { ok: true, data: await this.shopPacks.listPacks(userId) };
  }

  @Get('purchases')
  async purchases(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    return { ok: true, data: await this.shopPacks.purchaseHistory(userId) };
  }

  @Post('purchase')
  @HttpCode(200)
  async purchase(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const parsed = PurchaseInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const result = await this.shopPacks.purchase(userId, parsed.data);
      return { ok: true, data: result };
    } catch (e) {
      this.failShopPack(e);
    }
  }

  private async requireUserId(req: Request): Promise<string> {
    const id = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  private failShopPack(e: unknown): never {
    if (e instanceof ShopPackError) {
      const status =
        e.code === 'NO_CHARACTER'
          ? HttpStatus.NOT_FOUND
          : e.code === 'DUPLICATE_PURCHASE' || e.code === 'PURCHASE_LIMIT_REACHED'
            ? HttpStatus.CONFLICT
            : e.code === 'INSUFFICIENT_FUNDS'
              ? HttpStatus.PAYMENT_REQUIRED
              : HttpStatus.BAD_REQUEST;
      fail(e.code, status);
    }
    throw e;
  }
}
