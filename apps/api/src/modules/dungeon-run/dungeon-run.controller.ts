import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import {
  DungeonClaimResult,
  DungeonListView,
  DungeonRunError,
  DungeonRunService,
  DungeonRunView,
} from './dungeon-run.service';

const ACCESS_COOKIE = 'xt_access';

const TemplateKeyParam = z.string().min(1).max(80);
const RunIdParam = z.string().min(1).max(80);

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

/**
 * Phase 12.2.B — DungeonRun runtime HTTP surface.
 *
 * Endpoints:
 *  - GET  /dungeons/me                    → list catalog + active run
 *  - POST /dungeons/:templateKey/start    → start new run
 *  - POST /dungeon-runs/:runId/next       → advance 1 encounter
 *  - POST /dungeon-runs/:runId/claim      → claim completion bonus reward
 *
 * Auth gate: cookie `xt_access` (UNAUTHENTICATED 401 nếu thiếu / invalid).
 * Validation: `templateKey` + `runId` zod-parsed (INVALID_INPUT 400 nếu fail).
 * Error mapping (`DungeonRunError`):
 *  - `NO_CHARACTER` / `DUNGEON_NOT_FOUND` / `RUN_NOT_FOUND` → 404
 *  - `RUN_NOT_OWNED` → 403
 *  - `DUNGEON_LOCKED_REALM` → 403
 *  - `DUNGEON_DAILY_LIMIT_REACHED` / `STAMINA_LOW` / `ALREADY_IN_RUN` /
 *    `RUN_NOT_ACTIVE` / `RUN_NOT_COMPLETED` / `RUN_ALREADY_CLAIMED` /
 *    `RUN_NO_REWARD` → 409
 */
@Controller()
export class DungeonRunController {
  constructor(
    private readonly runs: DungeonRunService,
    private readonly auth: AuthService,
  ) {}

  @Get('dungeons/me')
  async list(
    @Req() req: Request,
  ): Promise<{ ok: true; data: DungeonListView }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const view = await this.runs.listForUser(userId);
      return { ok: true, data: view };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('dungeons/:templateKey/start')
  @HttpCode(200)
  async start(
    @Req() req: Request,
    @Param('templateKey') templateKey: string,
    @Body() _body: unknown,
  ): Promise<{ ok: true; data: { run: DungeonRunView } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = TemplateKeyParam.safeParse(templateKey);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const run = await this.runs.startRun(userId, parsed.data);
      return { ok: true, data: { run } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('dungeon-runs/:runId/next')
  @HttpCode(200)
  async next(
    @Req() req: Request,
    @Param('runId') runId: string,
    @Body() _body: unknown,
  ): Promise<{ ok: true; data: { run: DungeonRunView } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = RunIdParam.safeParse(runId);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const run = await this.runs.nextEncounter(userId, parsed.data);
      return { ok: true, data: { run } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('dungeon-runs/:runId/claim')
  @HttpCode(200)
  async claim(
    @Req() req: Request,
    @Param('runId') runId: string,
    @Body() _body: unknown,
  ): Promise<{
    ok: true;
    data: {
      runId: string;
      templateKey: string;
      claimedAt: string;
      granted: DungeonClaimResult['granted'];
    };
  }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = RunIdParam.safeParse(runId);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const result = await this.runs.claimRun(userId, parsed.data);
      return {
        ok: true,
        data: {
          runId: result.runId,
          templateKey: result.templateKey,
          claimedAt: result.claimedAt.toISOString(),
          granted: result.granted,
        },
      };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof DungeonRunError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'DUNGEON_NOT_FOUND':
        case 'RUN_NOT_FOUND':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'RUN_NOT_OWNED':
        case 'DUNGEON_LOCKED_REALM':
          fail(e.code, HttpStatus.FORBIDDEN);
        // eslint-disable-next-line no-fallthrough
        case 'DUNGEON_DAILY_LIMIT_REACHED':
        case 'STAMINA_LOW':
        case 'ALREADY_IN_RUN':
        case 'RUN_NOT_ACTIVE':
        case 'RUN_NOT_COMPLETED':
        case 'RUN_ALREADY_CLAIMED':
        case 'RUN_NO_REWARD':
          fail(e.code, HttpStatus.CONFLICT);
      }
    }
    throw e;
  }
}
