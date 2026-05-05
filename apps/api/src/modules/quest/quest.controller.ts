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
  QuestError,
  QuestProgressView,
  QuestService,
} from './quest.service';

const ACCESS_COOKIE = 'xt_access';

const AcceptInput = z.object({
  questKey: z.string().min(1).max(80),
});

const ProgressInput = z.object({
  questKey: z.string().min(1).max(80),
  stepId: z.string().min(1).max(40),
  amount: z.number().int().positive().max(100).optional(),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('quests')
export class QuestController {
  constructor(
    private readonly quests: QuestService,
    private readonly auth: AuthService,
  ) {}

  @Get('me')
  async me(
    @Req() req: Request,
  ): Promise<{ ok: true; data: { quests: QuestProgressView[] } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const quests = await this.quests.listForUser(userId);
      return { ok: true, data: { quests } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('accept')
  @HttpCode(200)
  async accept(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = AcceptInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const view = await this.quests.accept(userId, parsed.data.questKey);
      return { ok: true, data: { quest: view } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('progress')
  @HttpCode(200)
  async progress(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = ProgressInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const view = await this.quests.progress(userId, parsed.data);
      return { ok: true, data: { quest: view } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof QuestError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'QUEST_UNKNOWN':
        case 'QUEST_STEP_UNKNOWN':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'QUEST_LOCKED_REALM':
        case 'QUEST_LOCKED_PREREQUISITE':
          fail(e.code, HttpStatus.FORBIDDEN);
        // eslint-disable-next-line no-fallthrough
        case 'QUEST_NOT_AVAILABLE':
        case 'QUEST_NOT_ACCEPTED':
        case 'QUEST_STEP_KIND_MISMATCH':
          fail(e.code, HttpStatus.CONFLICT);
      }
    }
    throw e;
  }
}
