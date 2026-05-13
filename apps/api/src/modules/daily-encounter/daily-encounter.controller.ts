import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import {
  DailyEncounterError,
  DailyEncounterService,
} from './daily-encounter.service';

const ACCESS_COOKIE = 'xt_access';
const ChooseInput = z.object({ choiceKey: z.string().min(1).max(64) });

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('encounters/v1')
export class DailyEncounterController {
  constructor(
    private readonly svc: DailyEncounterService,
    private readonly auth: AuthService,
  ) {}

  private async requireUserId(req: Request): Promise<string> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return userId;
  }

  @Get('today')
  async today(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      const encounter = await this.svc.today(userId);
      return { ok: true, data: { encounter } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('history')
  async history(@Req() req: Request, @Query('limit') limit?: string) {
    const userId = await this.requireUserId(req);
    const parsed = z
      .object({ limit: z.coerce.number().int().min(1).max(90).optional() })
      .safeParse({ limit });
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const history = await this.svc.history(userId, parsed.data.limit ?? 30);
      return { ok: true, data: { history } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('today/accept')
  @HttpCode(200)
  async accept(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      const encounter = await this.svc.accept(userId);
      return { ok: true, data: { encounter } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('today/choose')
  @HttpCode(200)
  async choose(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const parsed = ChooseInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const encounter = await this.svc.choose(userId, parsed.data.choiceKey);
      return { ok: true, data: { encounter } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('today/complete')
  @HttpCode(200)
  async complete(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      const encounter = await this.svc.complete(userId);
      return { ok: true, data: { encounter } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('today/skip')
  @HttpCode(200)
  async skip(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      const encounter = await this.svc.skip(userId);
      return { ok: true, data: { encounter } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('today/claim')
  @HttpCode(200)
  async claim(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      const result = await this.svc.claim(userId);
      return { ok: true, data: result };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof DailyEncounterError) {
      const code = e.code;
      switch (code) {
        case 'NO_CHARACTER':
        case 'ENCOUNTER_NOT_FOUND':
        case 'ENCOUNTER_CATALOG_MISSING':
          fail(code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'ENCOUNTER_NOT_COMPLETED':
        case 'ENCOUNTER_FROZEN':
          fail(code, HttpStatus.CONFLICT);
        // eslint-disable-next-line no-fallthrough
        case 'ENCOUNTER_HAS_NO_CHOICES':
        case 'ENCOUNTER_CHOICE_INVALID':
          fail(code, HttpStatus.BAD_REQUEST);
        // eslint-disable-next-line no-fallthrough
        default:
          fail(code, HttpStatus.BAD_REQUEST);
      }
    }
    throw e;
  }
}
