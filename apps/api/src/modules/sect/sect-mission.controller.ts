import {
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
import { AuthService } from '../auth/auth.service';
import { SectMissionError, SectMissionService } from './sect-mission.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

/**
 * Phase 13.1.B — Sect Mission HTTP endpoints.
 *
 * Routes:
 *   - GET  /sect/missions                          → list view
 *   - POST /sect/missions/:key/claim               → claim reward (idempotent)
 *
 * Auth: Bắt buộc cookie session. Service tự throw `NO_CHARACTER` /
 * `SECT_REQUIRED` khi không có character / chưa vào sect.
 */
@Controller('sect/missions')
export class SectMissionController {
  constructor(
    private readonly missions: SectMissionService,
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
      const data = await this.missions.list(userId);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':key/claim')
  @HttpCode(200)
  async claim(@Req() req: Request, @Param('key') key: string) {
    const userId = await this.requireUserId(req);
    try {
      const data = await this.missions.claim(userId, key);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof SectMissionError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'MISSION_NOT_FOUND':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'SECT_REQUIRED':
        case 'ALREADY_CLAIMED':
          fail(e.code, HttpStatus.CONFLICT);
        // eslint-disable-next-line no-fallthrough
        case 'MISSION_NOT_READY':
          fail(e.code, HttpStatus.BAD_REQUEST);
      }
    }
    throw e;
  }
}
