import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';
import { RoguelikeError, RoguelikeService } from './roguelike.service';

const ACCESS_COOKIE = 'xt_access';
const ChoiceInput = z.object({ choiceKey: z.string().min(1).max(80) });

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code } }, status);
}

@Controller()
export class RoguelikeController {
  constructor(
    private readonly roguelike: RoguelikeService,
    private readonly auth: AuthService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  private async requireUserId(req: Request): Promise<string> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return userId;
  }

  @Get('roguelike-realms')
  async listRealms(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      const data = await this.roguelike.listRealms(userId);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('roguelike-realms/:realmKey/start')
  async start(@Req() req: Request, @Param('realmKey') realmKey: string) {
    await this.featureFlags.requireEnabled('ROGUELIKE_ENABLED');
    const userId = await this.requireUserId(req);
    if (!realmKey) fail('INVALID_INPUT');
    try {
      const run = await this.roguelike.start(userId, realmKey);
      return { ok: true, data: { run } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('roguelike-runs/current')
  async current(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      const run = await this.roguelike.getCurrent(userId);
      return { ok: true, data: { run } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('roguelike-runs/leaderboard')
  async leaderboard(@Query('limit') limit?: string) {
    const parsed = z
      .object({ limit: z.coerce.number().int().min(1).max(100).optional() })
      .safeParse({ limit });
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const entries = await this.roguelike.leaderboard(parsed.data.limit ?? 50);
      return { ok: true, data: { entries } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('roguelike-runs/:runId')
  async getRun(@Req() req: Request, @Param('runId') runId: string) {
    const userId = await this.requireUserId(req);
    if (!runId) fail('INVALID_INPUT');
    try {
      const run = await this.roguelike.getRun(userId, runId);
      return { ok: true, data: { run } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('roguelike-runs/:runId/choose')
  async choose(
    @Req() req: Request,
    @Param('runId') runId: string,
    @Body() body: unknown,
  ) {
    const userId = await this.requireUserId(req);
    if (!runId) fail('INVALID_INPUT');
    const parsed = ChoiceInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const run = await this.roguelike.choose(
        userId,
        runId,
        parsed.data.choiceKey,
      );
      return { ok: true, data: { run } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('roguelike-runs/:runId/abandon')
  async abandon(@Req() req: Request, @Param('runId') runId: string) {
    const userId = await this.requireUserId(req);
    if (!runId) fail('INVALID_INPUT');
    try {
      const run = await this.roguelike.abandon(userId, runId);
      return { ok: true, data: { run } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('roguelike-runs/:runId/claim')
  async claim(@Req() req: Request, @Param('runId') runId: string) {
    const userId = await this.requireUserId(req);
    if (!runId) fail('INVALID_INPUT');
    try {
      const result = await this.roguelike.claim(userId, runId);
      return { ok: true, data: result };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof RoguelikeError) {
      const code = e.code;
      if (code === 'NO_CHARACTER') fail(code, HttpStatus.NOT_FOUND);
      if (code === 'REALM_NOT_FOUND' || code === 'RUN_NOT_FOUND') {
        fail(code, HttpStatus.NOT_FOUND);
      }
      if (code === 'RUN_NOT_OWNED') fail(code, HttpStatus.FORBIDDEN);
      if (code === 'FEATURE_DISABLED') {
        fail(code, HttpStatus.SERVICE_UNAVAILABLE);
      }
      if (
        code === 'ALREADY_IN_RUN' ||
        code === 'DAILY_LIMIT_REACHED' ||
        code === 'WEEKLY_CAP_REACHED' ||
        code === 'RUN_ALREADY_CLAIMED'
      ) {
        fail(code, HttpStatus.CONFLICT);
      }
      fail(code);
    }
    throw e;
  }
}
