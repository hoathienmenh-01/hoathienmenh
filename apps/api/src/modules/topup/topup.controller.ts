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
import { TOPUP_PACKAGES } from '@xuantoi/shared';
import { TopupError, TopupService } from './topup.service';
import { AuthService } from '../auth/auth.service';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';

const ACCESS_COOKIE = 'xt_access';

const CreateInput = z.object({
  packageKey: z.string().min(1).max(64),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('topup')
export class TopupController {
  constructor(
    private readonly topup: TopupService,
    private readonly auth: AuthService,
  ) {}

  private async userId(req: Request): Promise<string | null> {
    return this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
  }

  @Get('packages')
  packages() {
    return {
      ok: true,
      data: { packages: TOPUP_PACKAGES, bank: this.topup.bankInfo() },
    };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const userId = await this.userId(req);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const orders = await this.topup.listForUser(userId);
    return { ok: true, data: { orders } };
  }

  @Post('create')
  @HttpCode(200)
  @RateLimitPolicy('TOPUP_CREATE_ORDER')
  async create(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.userId(req);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = CreateInput.safeParse(body);
    if (!parsed.success) fail('INVALID_PACKAGE');
    try {
      const order = await this.topup.createOrder(userId, parsed.data.packageKey);
      return { ok: true, data: { order } };
    } catch (e) {
      if (e instanceof TopupError) {
        const status =
          e.code === 'INVALID_PACKAGE'
            ? HttpStatus.BAD_REQUEST
            : e.code === 'TOO_MANY_PENDING'
              ? HttpStatus.TOO_MANY_REQUESTS
              : HttpStatus.CONFLICT;
        fail(e.code, status);
      }
      throw e;
    }
  }
}
