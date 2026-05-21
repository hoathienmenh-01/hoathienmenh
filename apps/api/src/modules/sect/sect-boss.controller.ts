import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  HttpException,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { SectBossService, SectBossError } from './sect-boss.service';
import { AuthService } from '../auth/auth.service';

const ACCESS_COOKIE = 'xt_access';

const SpawnInput = z.object({
  bossKey: z.string().min(1),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('sect-boss')
export class SectBossController {
  constructor(
    private readonly sectBoss: SectBossService,
    private readonly auth: AuthService,
  ) {}

  private async getUserId(req: Request): Promise<string | null> {
    return this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
  }

  @Get('list')
  async list(@Req() req: Request) {
    const userId = await this.getUserId(req);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const bosses = await this.sectBoss.list(userId);
      return { ok: true, data: { bosses } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('active')
  async active(@Req() req: Request) {
    const userId = await this.getUserId(req);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const boss = await this.sectBoss.getActive(userId);
      return { ok: true, data: { boss } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('spawn')
  @HttpCode(200)
  async spawn(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.getUserId(req);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = SpawnInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const boss = await this.sectBoss.spawn(userId, parsed.data.bossKey);
      return { ok: true, data: { boss } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('fight')
  @HttpCode(200)
  async fight(@Req() req: Request) {
    const userId = await this.getUserId(req);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const result = await this.sectBoss.fight(userId);
      return { ok: true, data: result };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('claim')
  @HttpCode(200)
  async claim(@Req() req: Request) {
    const userId = await this.getUserId(req);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const result = await this.sectBoss.claim(userId);
      return { ok: true, data: result };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof SectBossError) {
      const status =
        e.code === 'NO_CHARACTER' || e.code === 'SECT_REQUIRED'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.BAD_REQUEST;
      fail(e.code, status);
    }
    throw e;
  }
}
