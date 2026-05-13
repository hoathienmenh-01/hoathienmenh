/**
 * Phase 34.0 — Pure unit tests cho `OnboardingQuestController`.
 *
 * 6 endpoint:
 *   - GET  /onboarding-quest/v1/progress
 *   - GET  /onboarding-quest/v1/days/:dayNumber
 *   - POST /onboarding-quest/v1/tasks/:taskKey/accept
 *   - POST /onboarding-quest/v1/tasks/:taskKey/complete
 *   - POST /onboarding-quest/v1/tasks/:taskKey/claim
 *   - POST /onboarding-quest/v1/recompute
 *
 * Error mapping (`OnboardingQuestError`):
 *   - NO_CHARACTER / ONBOARDING_TASK_UNKNOWN / ONBOARDING_DAY_UNKNOWN → 404
 *   - ONBOARDING_TASK_LOCKED / NOT_COMPLETED / ALREADY_CLAIMED → 409
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { OnboardingQuestController } from './onboarding-quest.controller';
import {
  OnboardingQuestError,
  type OnboardingClaimResult,
  type OnboardingDayView,
  type OnboardingProgressView,
  type OnboardingQuestService,
  type OnboardingTaskView,
} from './onboarding-quest.service';
import type { AuthService } from '../auth/auth.service';

const STUB_TASK_VIEW: OnboardingTaskView = {
  taskKey: 'd1_claim_daily_login',
  dayNumber: 1,
  titleVi: 'stub vi',
  titleEn: 'stub en',
  descriptionVi: 'stub vi',
  descriptionEn: 'stub en',
  actionRoute: '/daily-login',
  category: 'tutorial',
  status: 'AVAILABLE',
  completedAt: null,
  claimedAt: null,
  reward: { linhThach: 100, exp: 0 },
};

const STUB_DAY_VIEW: OnboardingDayView = {
  dayNumber: 1,
  titleVi: 'stub',
  titleEn: 'stub',
  themeVi: 'stub',
  themeEn: 'stub',
  status: 'AVAILABLE',
  unlockedAt: null,
  completedAt: null,
  totalTasks: 1,
  completedTasks: 0,
  claimedTasks: 0,
  tasks: [STUB_TASK_VIEW],
};

const STUB_PROGRESS_VIEW: OnboardingProgressView = {
  totalDays: 7,
  totalTasks: 26,
  completedTasks: 0,
  claimedTasks: 0,
  days: [STUB_DAY_VIEW],
};

const STUB_CLAIM_RESULT: OnboardingClaimResult = {
  taskKey: 'd1_claim_daily_login',
  status: 'CLAIMED',
  claimed: true,
  linhThachGranted: 100,
  expGranted: 0,
};

function makeReq(cookie: string | undefined): Request {
  return { cookies: cookie ? { xt_access: cookie } : {} } as unknown as Request;
}

interface MakeOpts {
  authedUserId?: string | null;
  getProgressImpl?: (uid: string) => Promise<OnboardingProgressView>;
  getDayImpl?: (uid: string, d: number) => Promise<OnboardingDayView>;
  acceptImpl?: (uid: string, tk: string) => Promise<OnboardingTaskView>;
  completeImpl?: (uid: string, tk: string) => Promise<OnboardingTaskView>;
  claimImpl?: (uid: string, tk: string) => Promise<OnboardingClaimResult>;
  recomputeImpl?: (uid: string) => Promise<OnboardingProgressView>;
}

function makeController(opts: MakeOpts = {}) {
  const auth = {
    userIdFromAccess: async (t: string | undefined) =>
      t ? (opts.authedUserId === undefined ? 'u1' : opts.authedUserId) : null,
  } as unknown as AuthService;
  const svc = {
    getProgress: opts.getProgressImpl ?? (async () => STUB_PROGRESS_VIEW),
    getDay: opts.getDayImpl ?? (async () => STUB_DAY_VIEW),
    acceptTask: opts.acceptImpl ?? (async () => STUB_TASK_VIEW),
    completeTask: opts.completeImpl ?? (async () => STUB_TASK_VIEW),
    claimTask: opts.claimImpl ?? (async () => STUB_CLAIM_RESULT),
    recompute: opts.recomputeImpl ?? (async () => STUB_PROGRESS_VIEW),
  } as unknown as OnboardingQuestService;
  return new OnboardingQuestController(svc, auth);
}

async function expectHttpError(
  p: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  try {
    await p;
    throw new Error('expected HttpException');
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    const ex = e as HttpException;
    expect(ex.getStatus()).toBe(status);
    expect(ex.getResponse()).toMatchObject({ error: { code } });
  }
}

describe('OnboardingQuestController auth', () => {
  it('GET /progress without cookie → 401', async () => {
    const ctrl = makeController();
    await expectHttpError(
      ctrl.getProgress(makeReq(undefined)),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });

  it('GET /days/1 without cookie → 401', async () => {
    const ctrl = makeController();
    await expectHttpError(
      ctrl.getDay(makeReq(undefined), 1),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });

  it('POST /tasks/:taskKey/accept without cookie → 401', async () => {
    const ctrl = makeController();
    await expectHttpError(
      ctrl.acceptTask(makeReq(undefined), 'd1_claim_daily_login'),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });

  it('POST /tasks/:taskKey/complete without cookie → 401', async () => {
    const ctrl = makeController();
    await expectHttpError(
      ctrl.completeTask(makeReq(undefined), 'd1_claim_daily_login'),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });

  it('POST /tasks/:taskKey/claim without cookie → 401', async () => {
    const ctrl = makeController();
    await expectHttpError(
      ctrl.claimTask(makeReq(undefined), 'd1_claim_daily_login'),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });

  it('POST /recompute without cookie → 401', async () => {
    const ctrl = makeController();
    await expectHttpError(
      ctrl.recompute(makeReq(undefined)),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });
});

describe('OnboardingQuestController happy path', () => {
  it('GET /progress → returns progress view', async () => {
    const ctrl = makeController();
    const res = await ctrl.getProgress(makeReq('tok'));
    expect(res).toEqual({ ok: true, data: STUB_PROGRESS_VIEW });
  });

  it('GET /days/1 → returns day view', async () => {
    const ctrl = makeController();
    const res = await ctrl.getDay(makeReq('tok'), 1);
    expect(res).toEqual({ ok: true, data: STUB_DAY_VIEW });
  });

  it('GET /days/99 → 400 INVALID_INPUT (out of range)', async () => {
    const ctrl = makeController();
    await expectHttpError(
      ctrl.getDay(makeReq('tok'), 99),
      HttpStatus.BAD_REQUEST,
      'INVALID_INPUT',
    );
  });

  it('GET /days/0 → 400 INVALID_INPUT (out of range)', async () => {
    const ctrl = makeController();
    await expectHttpError(
      ctrl.getDay(makeReq('tok'), 0),
      HttpStatus.BAD_REQUEST,
      'INVALID_INPUT',
    );
  });

  it('POST /tasks/:taskKey/accept → returns task view', async () => {
    const ctrl = makeController();
    const res = await ctrl.acceptTask(makeReq('tok'), 'd1_claim_daily_login');
    expect(res).toEqual({ ok: true, data: STUB_TASK_VIEW });
  });

  it('POST /tasks/:taskKey/complete → returns task view', async () => {
    const ctrl = makeController({
      completeImpl: async () => ({ ...STUB_TASK_VIEW, status: 'COMPLETED' }),
    });
    const res = await ctrl.completeTask(makeReq('tok'), 'd1_claim_daily_login');
    expect(res.data.status).toBe('COMPLETED');
  });

  it('POST /tasks/:taskKey/claim → returns claim result', async () => {
    const ctrl = makeController();
    const res = await ctrl.claimTask(makeReq('tok'), 'd1_claim_daily_login');
    expect(res).toEqual({ ok: true, data: STUB_CLAIM_RESULT });
  });

  it('POST /recompute → returns progress view', async () => {
    const ctrl = makeController();
    const res = await ctrl.recompute(makeReq('tok'));
    expect(res).toEqual({ ok: true, data: STUB_PROGRESS_VIEW });
  });
});

describe('OnboardingQuestController error mapping', () => {
  it('NO_CHARACTER → 404', async () => {
    const ctrl = makeController({
      getProgressImpl: async () => {
        throw new OnboardingQuestError('NO_CHARACTER');
      },
    });
    await expectHttpError(
      ctrl.getProgress(makeReq('tok')),
      HttpStatus.NOT_FOUND,
      'NO_CHARACTER',
    );
  });

  it('ONBOARDING_TASK_UNKNOWN on complete → 404', async () => {
    const ctrl = makeController({
      completeImpl: async () => {
        throw new OnboardingQuestError('ONBOARDING_TASK_UNKNOWN');
      },
    });
    await expectHttpError(
      ctrl.completeTask(makeReq('tok'), 'bogus_task'),
      HttpStatus.NOT_FOUND,
      'ONBOARDING_TASK_UNKNOWN',
    );
  });

  it('ONBOARDING_DAY_UNKNOWN on getDay → 404', async () => {
    const ctrl = makeController({
      getDayImpl: async () => {
        throw new OnboardingQuestError('ONBOARDING_DAY_UNKNOWN');
      },
    });
    await expectHttpError(
      ctrl.getDay(makeReq('tok'), 5),
      HttpStatus.NOT_FOUND,
      'ONBOARDING_DAY_UNKNOWN',
    );
  });

  it('ONBOARDING_TASK_LOCKED on accept → 409', async () => {
    const ctrl = makeController({
      acceptImpl: async () => {
        throw new OnboardingQuestError('ONBOARDING_TASK_LOCKED');
      },
    });
    await expectHttpError(
      ctrl.acceptTask(makeReq('tok'), 'd2_check_realm'),
      HttpStatus.CONFLICT,
      'ONBOARDING_TASK_LOCKED',
    );
  });

  it('ONBOARDING_TASK_NOT_COMPLETED on claim → 409', async () => {
    const ctrl = makeController({
      claimImpl: async () => {
        throw new OnboardingQuestError('ONBOARDING_TASK_NOT_COMPLETED');
      },
    });
    await expectHttpError(
      ctrl.claimTask(makeReq('tok'), 'd1_claim_daily_login'),
      HttpStatus.CONFLICT,
      'ONBOARDING_TASK_NOT_COMPLETED',
    );
  });

  it('ONBOARDING_TASK_ALREADY_CLAIMED on claim → 409', async () => {
    const ctrl = makeController({
      claimImpl: async () => {
        throw new OnboardingQuestError('ONBOARDING_TASK_ALREADY_CLAIMED');
      },
    });
    await expectHttpError(
      ctrl.claimTask(makeReq('tok'), 'd1_claim_daily_login'),
      HttpStatus.CONFLICT,
      'ONBOARDING_TASK_ALREADY_CLAIMED',
    );
  });

  it('empty taskKey → 400 INVALID_INPUT (guard before service call)', async () => {
    const ctrl = makeController();
    await expectHttpError(
      ctrl.completeTask(makeReq('tok'), ''),
      HttpStatus.BAD_REQUEST,
      'INVALID_INPUT',
    );
  });

  it('oversize taskKey (> 64 chars) → 400 INVALID_INPUT', async () => {
    const ctrl = makeController();
    const huge = 'x'.repeat(65);
    await expectHttpError(
      ctrl.completeTask(makeReq('tok'), huge),
      HttpStatus.BAD_REQUEST,
      'INVALID_INPUT',
    );
  });
});
