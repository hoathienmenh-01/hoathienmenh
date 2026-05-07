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
  StoryDungeonError,
  StoryDungeonService,
  type StoryDungeonRunView,
  type StoryDungeonView,
} from './story-dungeon.service';

/**
 * Phase 12.8.A + 12.8.B — Story Dungeon HTTP surface.
 *
 * Phase 12.8.A read-only:
 *   - `GET /story/dungeons`        → list catalog (`enabled=true`) + status per template.
 *   - `GET /story/dungeons/:key`   → single template + status.
 *
 * Phase 12.8.B runtime:
 *   - `POST /story/dungeons/:key/start`      → start (or idempotent retry) story dungeon.
 *   - `POST /story/dungeons/:runId/advance`  → kill 1 monster step.
 *   - `POST /story/dungeons/:runId/clear`    → transition ACTIVE → CLEARED + quest auto-advance.
 *   - `POST /story/dungeons/:runId/claim`    → grant reward (CAS-guarded, idempotent).
 *
 * Auth: cookie `xt_access` (mirror `StoryDialogueController` /
 * `DungeonRunController`).
 *
 * Param disambiguation: `:key` matches template key shape
 * `^story_dgn_[a-z0-9_]+$`, `:runId` matches cuid `^c[a-z0-9]+$`.
 * NestJS routes by exact suffix nên các POST endpoints /start /advance
 * /clear /claim không xung đột nhau dù cùng prefix `:param`.
 *
 * Error mapping (`StoryDungeonError`):
 *  - `NO_CHARACTER` / `DUNGEON_NOT_FOUND` / `RUN_NOT_FOUND` → 404
 *  - `RUN_NOT_OWNED` / `DUNGEON_LOCKED` → 403
 *  - `DUNGEON_ALREADY_CLEARED` / `ALREADY_IN_RUN` / `RUN_NOT_ACTIVE` /
 *    `RUN_STEP_INVALID` / `RUN_NOT_CLEARED` / `RUN_ALREADY_CLAIMED` /
 *    `RUN_NO_REWARD` → 409
 */

const ACCESS_COOKIE = 'xt_access';

const DungeonKeyParam = z
  .string()
  .min(1)
  .max(120)
  .regex(/^story_dgn_[a-z0-9_]+$/);

const RunIdParam = z.string().min(1).max(80).regex(/^c[a-z0-9]+$/);

function fail(code: string, status = HttpStatus.BAD_REQUEST, detail?: string): never {
  throw new HttpException(
    { ok: false, error: { code, message: detail ?? code } },
    status,
  );
}

@Controller('story/dungeons')
export class StoryDungeonController {
  constructor(
    private readonly service: StoryDungeonService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
  ): Promise<{ ok: true; data: { dungeons: StoryDungeonView[] } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const dungeons = await this.service.listForUser(userId);
      return { ok: true, data: { dungeons } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get(':key')
  async getByKey(
    @Req() req: Request,
    @Param('key') key: string,
  ): Promise<{ ok: true; data: { dungeon: StoryDungeonView } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = DungeonKeyParam.safeParse(key);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const dungeon = await this.service.getByKey(userId, parsed.data);
      return { ok: true, data: { dungeon } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':key/start')
  @HttpCode(200)
  async start(
    @Req() req: Request,
    @Param('key') key: string,
    @Body() _body: unknown,
  ): Promise<{ ok: true; data: { run: StoryDungeonRunView } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = DungeonKeyParam.safeParse(key);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const run = await this.service.startRun(userId, parsed.data);
      return { ok: true, data: { run } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':runId/advance')
  @HttpCode(200)
  async advance(
    @Req() req: Request,
    @Param('runId') runId: string,
    @Body() _body: unknown,
  ): Promise<{ ok: true; data: { run: StoryDungeonRunView } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = RunIdParam.safeParse(runId);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const run = await this.service.advance(userId, parsed.data);
      return { ok: true, data: { run } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':runId/clear')
  @HttpCode(200)
  async clear(
    @Req() req: Request,
    @Param('runId') runId: string,
    @Body() _body: unknown,
  ): Promise<{ ok: true; data: { run: StoryDungeonRunView } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = RunIdParam.safeParse(runId);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const run = await this.service.clear(userId, parsed.data);
      return { ok: true, data: { run } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':runId/claim')
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
      granted: {
        linhThach: number;
        tienNgoc: number;
        exp: number;
        items: Array<{ itemKey: string; qty: number }>;
      };
    };
  }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = RunIdParam.safeParse(runId);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const result = await this.service.claim(userId, parsed.data);
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
    if (e instanceof StoryDungeonError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'DUNGEON_NOT_FOUND':
        case 'RUN_NOT_FOUND':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'RUN_NOT_OWNED':
        case 'DUNGEON_LOCKED':
          fail(e.code, HttpStatus.FORBIDDEN);
        // eslint-disable-next-line no-fallthrough
        case 'DUNGEON_ALREADY_CLEARED':
        case 'ALREADY_IN_RUN':
        case 'RUN_NOT_ACTIVE':
        case 'RUN_STEP_INVALID':
        case 'RUN_NOT_CLEARED':
        case 'RUN_ALREADY_CLAIMED':
        case 'RUN_NO_REWARD':
          fail(e.code, HttpStatus.CONFLICT);
      }
    }
    throw e;
  }
}
