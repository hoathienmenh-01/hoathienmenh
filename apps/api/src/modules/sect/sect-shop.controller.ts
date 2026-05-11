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
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import { SectShopError, SectShopService } from './sect-shop.service';

const ACCESS_COOKIE = 'xt_access';

const BuyInput = z.object({
  entryKey: z.string().min(1).max(80),
  qty: z.number().int().positive().max(99),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

/**
 * Phase 13.1.B — Sect Shop HTTP endpoints.
 *
 * Routes:
 *   - GET  /sect/shop          → list catalog + per-user state
 *   - POST /sect/shop/buy      → atomic buy (server-authoritative cost)
 *
 * Anti-abuse:
 *   - SectShopService rate-limits 30 req/60s/userId.
 *   - Daily/weekly limit enforced server-side qua SUM(qty) trong window.
 *   - Atomic CAS spend `sectContribBalance >= cost*qty` — race-safe.
 */
@Controller('sect/shop')
export class SectShopController {
  constructor(
    private readonly shop: SectShopService,
    private readonly auth: AuthService,
  ) {}

  private async requireUserId(req: Request): Promise<string> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return userId;
  }

  @Get()
  async list(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      const data = await this.shop.list(userId);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('buy')
  @HttpCode(200)
  @RateLimitPolicy('SECT_SHOP_BUY')
  async buy(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const parsed = BuyInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.shop.buy(userId, parsed.data.entryKey, parsed.data.qty);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof SectShopError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'ENTRY_NOT_FOUND':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'SECT_REQUIRED':
        case 'INSUFFICIENT_CONTRIBUTION':
        case 'DAILY_LIMIT':
        case 'WEEKLY_LIMIT':
        case 'SECT_LEVEL_REQUIRED':
          fail(e.code, HttpStatus.CONFLICT);
        // eslint-disable-next-line no-fallthrough
        case 'INVALID_QTY':
        case 'NON_STACKABLE_QTY_GT_1':
          fail(e.code, HttpStatus.BAD_REQUEST);
        // eslint-disable-next-line no-fallthrough
        case 'RATE_LIMITED':
          fail(e.code, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    throw e;
  }
}
