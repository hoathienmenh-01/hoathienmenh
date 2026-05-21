import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Optional,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import {
  Phase33ChapterView,
  Phase33ClaimResult,
  Phase33DialogueView,
  Phase33QuestView,
  Phase33StoryError,
  Phase33StoryService,
} from './story-v2.service';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';
import { OnboardingQuestService } from '../onboarding-quest/onboarding-quest.service';
import { PrismaService } from '../../common/prisma.service';

const ACCESS_COOKIE = 'xt_access';

const QuestKeyInput = z.object({
  questKey: z.string().min(1).max(80),
});

const ProgressInput = z.object({
  questKey: z.string().min(1).max(80),
  stepId: z.string().min(1).max(40),
  amount: z.number().int().positive().max(100).optional(),
});

const DialoguePhaseQuery = z
  .enum([
    'INTRO',
    'ACCEPT',
    'IN_PROGRESS',
    'READY_TO_COMPLETE',
    'COMPLETE',
    'CLAIMED',
    'HIDDEN_HINT',
    'HIDDEN_TRIGGER',
    'BOSS_PRE',
    'BOSS_START',
    'BOSS_VICTORY',
    'AFTERMATH',
  ])
  .optional();

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('story/v2')
export class Phase33StoryController {
  constructor(
    private readonly storyV2: Phase33StoryService,
    private readonly auth: AuthService,
    private readonly featureFlags: FeatureFlagService,
    private readonly prisma: PrismaService,
    @Optional() private readonly onboarding?: OnboardingQuestService,
  ) {}

  @Get('chapters')
  async listChapters(
    @Req() req: Request,
  ): Promise<{ ok: true; data: { chapters: Phase33ChapterView[] } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const chapters = await this.storyV2.listChaptersForUser(userId);
      // Phase 44.2 — Onboarding auto-track STORY_VIEW. Fire-and-forget.
      if (this.onboarding) {
        const char = await this.prisma.character.findUnique({
          where: { userId },
          select: { id: true },
        });
        if (char) void this.onboarding.notifyAction(char.id, 'STORY_VIEW');
      }
      return { ok: true, data: { chapters } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('chapters/:chapKey/quests')
  async listQuests(
    @Req() req: Request,
    @Param('chapKey') chapKey: string,
  ): Promise<{ ok: true; data: { quests: Phase33QuestView[] } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    if (!chapKey || chapKey.length > 16) fail('INVALID_INPUT');
    try {
      const quests = await this.storyV2.listQuestsForChapter(userId, chapKey);
      return { ok: true, data: { quests } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('quests/:questKey/dialogues')
  async listDialogues(
    @Req() req: Request,
    @Param('questKey') questKey: string,
    @Query('phase') phase?: string,
  ): Promise<{ ok: true; data: { dialogues: Phase33DialogueView[] } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    if (!questKey || questKey.length > 80) fail('INVALID_INPUT');
    const parsedPhase = DialoguePhaseQuery.safeParse(phase);
    if (!parsedPhase.success) fail('INVALID_INPUT');
    try {
      const dialogues = await this.storyV2.listDialoguesForQuest(
        userId,
        questKey,
        parsedPhase.data,
      );
      return { ok: true, data: { dialogues } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('quests/accept')
  @HttpCode(200)
  async accept(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    await this.featureFlags.requireEnabled('STORY_V2_ENABLED');
    const parsed = QuestKeyInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const view = await this.storyV2.acceptQuest(userId, parsed.data.questKey);
      return { ok: true, data: { quest: view } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('quests/progress')
  @HttpCode(200)
  async progress(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = ProgressInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const view = await this.storyV2.progressQuest(userId, parsed.data);
      return { ok: true, data: { quest: view } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('quests/complete')
  @HttpCode(200)
  async complete(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = QuestKeyInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const view = await this.storyV2.completeQuest(
        userId,
        parsed.data.questKey,
      );
      return { ok: true, data: { quest: view } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('quests/claim')
  @HttpCode(200)
  async claim(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = QuestKeyInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const result: Phase33ClaimResult = await this.storyV2.claimReward(
        userId,
        parsed.data.questKey,
      );
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
    if (e instanceof Phase33StoryError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'STORY_V2_QUEST_UNKNOWN':
        case 'STORY_V2_CHAPTER_UNKNOWN':
        case 'STORY_V2_QUEST_NOT_FOUND_PROGRESS':
        case 'STORY_V2_QUEST_STEP_UNKNOWN':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'STORY_V2_QUEST_LOCKED_REALM':
        case 'STORY_V2_QUEST_LOCKED_PREREQUISITE':
        case 'STORY_V2_QUEST_LOCKED_FLAG':
        case 'STORY_V2_QUEST_LOCKED_AFFINITY':
          fail(e.code, HttpStatus.FORBIDDEN);
        // eslint-disable-next-line no-fallthrough
        case 'STORY_V2_QUEST_NOT_AVAILABLE':
        case 'STORY_V2_QUEST_NOT_ACCEPTED':
        case 'STORY_V2_QUEST_NOT_COMPLETED':
        case 'STORY_V2_QUEST_ALREADY_CLAIMED':
        case 'STORY_V2_QUEST_STEP_KIND_NOT_SUPPORTED':
          fail(e.code, HttpStatus.CONFLICT);
      }
    }
    throw e;
  }
}
