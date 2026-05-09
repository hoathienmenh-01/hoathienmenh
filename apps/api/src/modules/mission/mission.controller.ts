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
  MissionError,
  MissionProgressView,
  MissionService,
} from './mission.service';

const ACCESS_COOKIE = 'xt_access';

const ClaimInput = z.object({
  missionKey: z.string().min(1).max(80),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('missions')
export class MissionController {
  constructor(
    private readonly missions: MissionService,
    private readonly auth: AuthService,
  ) {}

  @Get('me')
  async me(
    @Req() req: Request,
  ): Promise<{ ok: true; data: { missions: MissionProgressView[] } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const missions = await this.missions.listForUser(userId);
      return { ok: true, data: { missions } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('claim')
  @HttpCode(200)
  async claim(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = ClaimInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const claim = await this.missions.claim(userId, parsed.data.missionKey);
      const missions = await this.missions.listForUser(userId);
      return { ok: true, data: { missions, claim } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof MissionError) {
      switch (e.code) {
        case 'NO_CHARACTER':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'MISSION_UNKNOWN':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'NOT_READY':
        case 'ALREADY_CLAIMED':
          fail(e.code, HttpStatus.CONFLICT);
      }
    }
    throw e;
  }
}
