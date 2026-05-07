import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import {
  StoryDungeonError,
  StoryDungeonService,
  type StoryDungeonView,
} from './story-dungeon.service';

/**
 * Phase 12.8.A — Story Dungeon read-only API.
 *
 *   - `GET /story/dungeons`        → list catalog (`enabled=true`) + status per template.
 *   - `GET /story/dungeons/:key`   → single template + status.
 *
 * Auth: cookie `xt_access` (mirror `StoryDialogueController`). KHÔNG có
 * mutation endpoint trong Phase 12.8.A.
 */

const ACCESS_COOKIE = 'xt_access';

const DungeonKeyParam = z
  .string()
  .min(1)
  .max(120)
  .regex(/^story_dgn_[a-z0-9_]+$/);

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

  private handleErr(e: unknown): never {
    if (e instanceof StoryDungeonError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'DUNGEON_NOT_FOUND':
          fail(e.code, HttpStatus.NOT_FOUND);
      }
    }
    throw e;
  }
}
