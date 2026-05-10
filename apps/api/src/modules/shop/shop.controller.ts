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
import { ShopError, ShopService } from './shop.service';

const ACCESS_COOKIE = 'xt_access';

const BuyInput = z.object({
  itemKey: z.string().min(1).max(64),
  qty: z.number().int().min(1).max(99),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('shop')
export class ShopController {
  constructor(
    private readonly shop: ShopService,
    private readonly auth: AuthService,
  ) {}

  private async requireUserId(req: Request): Promise<string> {
    const id = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  @Get('npc')
  async list(@Req() req: Request) {
    await this.requireUserId(req);
    const entries = this.shop.list();
    return { ok: true, data: { entries } };
  }

  @Post('buy')
  @HttpCode(200)
  async buy(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const parsed = BuyInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const r = await this.shop.buy(userId, parsed.data.itemKey, parsed.data.qty);
      return {
        ok: true,
        data: {
          itemKey: r.itemKey,
          qty: r.qty,
          totalPrice: r.totalPrice,
          // Phase 15.3.A — LiveOps SHOP_DISCOUNT discount info expose ra FE.
          originalPrice: r.originalPrice,
          finalPrice: r.finalPrice,
          liveOpsDiscount: r.liveOpsDiscount,
          currency: r.currency,
        },
      };
    } catch (e) {
      if (e instanceof ShopError) {
        if (e.code === 'NO_CHARACTER') fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
        if (e.code === 'ITEM_NOT_IN_SHOP') fail('ITEM_NOT_IN_SHOP', HttpStatus.NOT_FOUND);
        if (e.code === 'INSUFFICIENT_FUNDS') fail('INSUFFICIENT_FUNDS', HttpStatus.CONFLICT);
        if (e.code === 'SHOP_DAILY_LIMIT') fail('SHOP_DAILY_LIMIT', HttpStatus.CONFLICT);
        if (e.code === 'RATE_LIMITED') fail('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
        fail(e.code, HttpStatus.BAD_REQUEST);
      }
      throw e;
    }
  }
}
