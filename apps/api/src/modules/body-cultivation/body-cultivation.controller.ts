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
import {
  BodyCultivationError,
  BodyCultivationService,
} from './body-cultivation.service';

const ACCESS_COOKIE = 'xt_access';
const ToggleInput = z.object({ bodyCultivating: z.boolean().optional() }).optional();

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('character/body-cultivation')
export class BodyCultivationController {
  constructor(
    private readonly auth: AuthService,
    private readonly bodyCultivation: BodyCultivationService,
  ) {}

  private async requireUserId(req: Request): Promise<string> {
    const id = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  @Get()
  async status(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      const bodyCultivation = await this.bodyCultivation.getStatus(userId);
      return { ok: true, data: { bodyCultivation } };
    } catch (e) {
      this.mapError(e);
    }
  }

  @Post('start')
  @HttpCode(200)
  async start(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const parsed = ToggleInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const bodyCultivation = await this.bodyCultivation.setBodyCultivating(
        userId,
        true,
      );
      return { ok: true, data: { bodyCultivation } };
    } catch (e) {
      this.mapError(e);
    }
  }

  @Post('stop')
  @HttpCode(200)
  async stop(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const parsed = ToggleInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const bodyCultivation = await this.bodyCultivation.setBodyCultivating(
        userId,
        false,
      );
      return { ok: true, data: { bodyCultivation } };
    } catch (e) {
      this.mapError(e);
    }
  }

  @Post('breakthrough')
  @HttpCode(200)
  async breakthrough(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      const bodyCultivation = await this.bodyCultivation.attemptBreakthrough(userId);
      return { ok: true, data: { bodyCultivation } };
    } catch (e) {
      this.mapError(e);
    }
  }

  private mapError(e: unknown): never {
    if (e instanceof BodyCultivationError) {
      if (e.code === 'NO_CHARACTER') fail(e.code, HttpStatus.NOT_FOUND);
      fail(e.code, HttpStatus.CONFLICT);
    }
    throw e;
  }
}
