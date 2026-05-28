/**
 * Phase 32.0 — Codex player controller (Tu Tiên Bách Khoa).
 *
 * Endpoint:
 *   - GET /codex/entries             → list entries (filter type).
 *   - GET /codex/entries/:entryKey   → detail (kèm market price tham chiếu).
 *   - GET /codex/progress            → overall progress + bestiary %.
 *
 * Player có thể "discover" entry qua server hooks (combat/loot/quest)
 * — không expose discover endpoint public để tránh self-discover bypass.
 */
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
import { CODEX_ENTRY_TYPES, type CodexEntryType, isCodexEntryType } from '@xuantoi/shared';

import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import { CodexService, CodexError } from './codex.service';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

@Controller('codex')
export class CodexPlayerController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly codex: CodexService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  private async getCharacterIdMaybe(req: Request): Promise<string | undefined> {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) return undefined;
    const c = await this.prisma.character.findUnique({
      where: { userId: userId as string },
      select: { id: true },
    });
    return c?.id;
  }

  @Get('entries')
  async list(
    @Req() req: Request,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    await this.featureFlags.requireEnabled('CODEX_ENABLED');
    const characterId = await this.getCharacterIdMaybe(req);
    const parsedType = type && isCodexEntryType(type) ? (type as CodexEntryType) : undefined;
    return {
      ok: true,
      data: await this.codex.list({
        viewerIsAdmin: false,
        characterId,
        type: parsedType,
        limit: limit ? parseInt(limit, 10) : 100,
        offset: offset ? parseInt(offset, 10) : 0,
      }),
    };
  }

  @Get('entries/:entryKey')
  async detail(@Req() req: Request, @Param('entryKey') entryKey: string) {
    const characterId = await this.getCharacterIdMaybe(req);
    try {
      return {
        ok: true,
        data: await this.codex.getDetail({
          viewerIsAdmin: false,
          characterId,
          entryKey,
        }),
      };
    } catch (e) {
      if (e instanceof CodexError) {
        fail(
          e.code,
          e.code === 'CODEX_ENTRY_NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.FORBIDDEN,
        );
      }
      throw e;
    }
  }

  @Get('progress')
  async progress(@Req() req: Request) {
    const characterId = await this.getCharacterIdMaybe(req);
    if (!characterId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return { ok: true, data: await this.codex.getProgress(characterId!) };
  }

  @Post('entries/:entryKey/discover')
  async discover(
    @Req() req: Request,
    @Param('entryKey') entryKey: string,
    @Body() body: { context?: string },
  ) {
    const characterId = await this.getCharacterIdMaybe(req);
    if (!characterId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      return {
        ok: true,
        data: await this.codex.discover(characterId!, entryKey, body.context),
      };
    } catch (e) {
      if (e instanceof CodexError) {
        fail(e.code, HttpStatus.NOT_FOUND);
      }
      throw e;
    }
  }

  @Get('types')
  types() {
    return { ok: true, data: CODEX_ENTRY_TYPES };
  }
}
