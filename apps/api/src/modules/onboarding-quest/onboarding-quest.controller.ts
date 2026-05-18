import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import {
  OnboardingClaimResult,
  OnboardingDayView,
  OnboardingProgressView,
  OnboardingQuestError,
  OnboardingQuestService,
  OnboardingTaskView,
} from './onboarding-quest.service';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

/**
 * Phase 34.0 — 7-Day Onboarding Questline controller.
 *
 * Route prefix `/onboarding-quest/v1/*` (KHÔNG dùng `/onboarding` để tránh
 * va chạm với existing `/onboarding` flow tạo character).
 */
@Controller('onboarding-quest/v1')
export class OnboardingQuestController {
  constructor(
    private readonly svc: OnboardingQuestService,
    private readonly auth: AuthService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  @Get('progress')
  async getProgress(
    @Req() req: Request,
  ): Promise<{ ok: true; data: OnboardingProgressView }> {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const data = await this.svc.getProgress(userId);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('days/:dayNumber')
  async getDay(
    @Req() req: Request,
    @Param('dayNumber', new ParseIntPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    dayNumber: number,
  ): Promise<{ ok: true; data: OnboardingDayView }> {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    if (dayNumber < 1 || dayNumber > 7) fail('INVALID_INPUT');
    try {
      const data = await this.svc.getDay(userId, dayNumber);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('tasks/:taskKey/accept')
  @HttpCode(200)
  async acceptTask(
    @Req() req: Request,
    @Param('taskKey') taskKey: string,
  ): Promise<{ ok: true; data: OnboardingTaskView }> {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    await this.featureFlags.requireEnabled('ONBOARDING_ENABLED');
    if (!taskKey || taskKey.length > 64) fail('INVALID_INPUT');
    try {
      const data = await this.svc.acceptTask(userId, taskKey);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('tasks/:taskKey/complete')
  @HttpCode(200)
  async completeTask(
    @Req() req: Request,
    @Param('taskKey') taskKey: string,
  ): Promise<{ ok: true; data: OnboardingTaskView }> {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    if (!taskKey || taskKey.length > 64) fail('INVALID_INPUT');
    try {
      const data = await this.svc.completeTask(userId, taskKey);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('tasks/:taskKey/claim')
  @HttpCode(200)
  async claimTask(
    @Req() req: Request,
    @Param('taskKey') taskKey: string,
  ): Promise<{ ok: true; data: OnboardingClaimResult }> {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    if (!taskKey || taskKey.length > 64) fail('INVALID_INPUT');
    try {
      const data = await this.svc.claimTask(userId, taskKey);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('recompute')
  @HttpCode(200)
  async recompute(
    @Req() req: Request,
  ): Promise<{ ok: true; data: OnboardingProgressView }> {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const data = await this.svc.recompute(userId);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof OnboardingQuestError) {
      if (
        e.code === 'NO_CHARACTER' ||
        e.code === 'ONBOARDING_TASK_UNKNOWN' ||
        e.code === 'ONBOARDING_DAY_UNKNOWN'
      ) {
        fail(e.code, HttpStatus.NOT_FOUND);
      }
      if (
        e.code === 'ONBOARDING_TASK_LOCKED' ||
        e.code === 'ONBOARDING_TASK_NOT_COMPLETED' ||
        e.code === 'ONBOARDING_TASK_ALREADY_CLAIMED'
      ) {
        fail(e.code, HttpStatus.CONFLICT);
      }
    }
    throw e;
  }
}
