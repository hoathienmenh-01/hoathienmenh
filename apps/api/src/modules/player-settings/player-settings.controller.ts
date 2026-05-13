import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PlayerSettingsRow } from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { PlayerSettingsError, PlayerSettingsService } from './player-settings.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

/**
 * Phase 41.0 — Player Settings REST surface.
 *
 *   - `GET /player/settings`            — đọc settings (lazy default).
 *   - `PATCH /player/settings`          — update partial; merge stored JSON.
 *   - `POST /player/settings/reset`     — reset về `DEFAULT_PLAYER_SETTINGS`.
 *
 * Tất cả enforce session cookie (`xt_access`) + characterId của requester.
 */
@Controller('player/settings')
export class PlayerSettingsController {
  constructor(
    private readonly svc: PlayerSettingsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async get(@Req() req: Request): Promise<{ ok: true; data: { settings: PlayerSettingsRow } }> {
    const userId = await this.requireUserId(req);
    try {
      const settings = await this.svc.getSettings(userId);
      return { ok: true, data: { settings } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Patch()
  async patch(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { settings: PlayerSettingsRow } }> {
    const userId = await this.requireUserId(req);
    try {
      const settings = await this.svc.patchSettings(userId, body);
      return { ok: true, data: { settings } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('reset')
  @HttpCode(200)
  async reset(@Req() req: Request): Promise<{ ok: true; data: { settings: PlayerSettingsRow } }> {
    const userId = await this.requireUserId(req);
    try {
      const settings = await this.svc.resetSettings(userId);
      return { ok: true, data: { settings } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private async requireUserId(req: Request): Promise<string> {
    const id = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  private handleErr(e: unknown): never {
    if (e instanceof PlayerSettingsError) {
      if (e.code === 'NO_CHARACTER') fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
      if (e.code === 'PLAYER_SETTINGS_PAYLOAD_TOO_LARGE') {
        fail('PLAYER_SETTINGS_PAYLOAD_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE);
      }
      fail('PLAYER_SETTINGS_INVALID');
    }
    throw e;
  }
}
