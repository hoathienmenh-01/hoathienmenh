import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Optional,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import { OnboardingQuestService } from '../onboarding-quest/onboarding-quest.service';
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

const ClaimInput = z.object({
  questKey: z.string().min(1).max(80),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('quests')
export class QuestController {
  constructor(
    private readonly quests: QuestService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    @Optional() private readonly onboarding?: OnboardingQuestService,
  ) {}

  @Get('me')
  async me(
    @Req() req: Request,
  ): Promise<{ ok: true; data: { quests: QuestProgressView[] } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const quests = await this.quests.listForUser(userId);
      // Phase 44.2 — Onboarding auto-track QUEST_VIEW. Best-effort.
      if (this.onboarding) {
        try {
          const c = await this.prisma.character.findUnique({
            where: { userId },
            select: { id: true },
          });
          if (c) void this.onboarding.notifyAction(c.id, 'QUEST_VIEW');
        } catch { /* fail-soft */ }
      }
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

  // Phase 12 PR-3 — Quest claim reward.
  // Auth gate (UNAUTHENTICATED 401) + Zod validate (INVALID_INPUT 400) +
  // service errors (404 unknown / 409 not-completed / 409 already-claimed).
  // BE-only mutation point: response trả về granted breakdown để FE render
  // toast / animation, KHÔNG cộng currency phía FE.
  @Post('claim')
  @HttpCode(200)
  async claim(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = ClaimInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const result = await this.quests.claim(userId, parsed.data.questKey);
      return {
        ok: true,
        data: {
          questKey: result.questKey,
          claimedAt: result.claimedAt.toISOString(),
          granted: result.granted,
        },
      };
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
        case 'QUEST_NOT_FOUND_PROGRESS':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'QUEST_LOCKED_REALM':
        case 'QUEST_LOCKED_PREREQUISITE':
          fail(e.code, HttpStatus.FORBIDDEN);
        // eslint-disable-next-line no-fallthrough
        case 'QUEST_NOT_AVAILABLE':
        case 'QUEST_NOT_ACCEPTED':
        case 'QUEST_STEP_KIND_MISMATCH':
        case 'QUEST_NOT_COMPLETED':
        case 'QUEST_ALREADY_CLAIMED':
          fail(e.code, HttpStatus.CONFLICT);
      }
    }
    throw e;
  }
}
