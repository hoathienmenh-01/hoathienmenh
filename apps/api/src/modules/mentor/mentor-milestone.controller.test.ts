/**
 * Phase 35.2 — pure-unit tests cho 3 endpoint milestone trên MentorController:
 *   - GET  /mentor/milestones
 *   - POST /mentor/milestones/:milestoneKey/claim
 *   - POST /mentor/milestones/recompute
 *
 * Error mapping (`MentorMilestoneError`):
 *   - NO_CHARACTER / NOT_FOUND / MILESTONE_NOT_FOUND  → 404
 *   - NOT_AUTHORIZED                                  → 403
 *   - NOT_IN_ACTIVE_RELATION                          → 400
 *   - MILESTONE_LOCKED / MILESTONE_ALREADY_CLAIMED    → 409
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { MentorController } from './mentor.controller';
import {
  MentorMilestoneError,
  type MentorMilestoneService,
} from './mentor-milestone.service';
import type { MentorService } from './mentor.service';
import type { AuthService } from '../auth/auth.service';
import type { MentorMilestoneListResponse } from '@xuantoi/shared';

const STUB_LIST: MentorMilestoneListResponse = {
  asMentor: [],
  asDisciple: null,
};

function makeReq(cookie: string | undefined): Request {
  return { cookies: cookie ? { xt_access: cookie } : {} } as unknown as Request;
}

interface MakeOpts {
  authedUserId?: string | null;
  listImpl?: (uid: string) => Promise<MentorMilestoneListResponse>;
  claimImpl?: (
    uid: string,
    key: string,
  ) => Promise<{ role: string; rewardLinhThach: string; mailId: string }>;
  recomputeImpl?: (
    uid: string,
  ) => Promise<{ relationId: string; created: number; promoted: number } | null>;
}

function makeCtrl(opts: MakeOpts = {}) {
  const auth = {
    userIdFromAccess: async (t: string | undefined) =>
      t ? (opts.authedUserId === undefined ? 'u1' : opts.authedUserId) : null,
  } as unknown as AuthService;
  const svc = {} as unknown as MentorService;
  const milestones = {
    listForUser: opts.listImpl ?? (async () => STUB_LIST),
    claim:
      opts.claimImpl ??
      (async () => ({
        role: 'DISCIPLE',
        rewardLinhThach: '8000',
        mailId: 'mail_stub',
      })),
    recomputeForUser:
      opts.recomputeImpl ??
      (async () => ({ relationId: 'rel_stub', created: 0, promoted: 0 })),
  } as unknown as MentorMilestoneService;
  const featureFlags = { requireEnabled: async () => {} } as any;
  return new MentorController(svc, milestones, auth, featureFlags);
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

describe('MentorController.milestones auth', () => {
  it('GET /mentor/milestones không cookie → 401', async () => {
    const ctrl = makeCtrl();
    await expectHttpError(
      ctrl.milestonesList(makeReq(undefined)),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });

  it('POST /mentor/milestones/:key/claim không cookie → 401', async () => {
    const ctrl = makeCtrl();
    await expectHttpError(
      ctrl.milestonesClaim(makeReq(undefined), 'mentor_milestone_truc_co'),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });

  it('POST /mentor/milestones/recompute không cookie → 401', async () => {
    const ctrl = makeCtrl();
    await expectHttpError(
      ctrl.milestonesRecompute(makeReq(undefined)),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });
});

describe('MentorController.milestones happy path', () => {
  it('GET /mentor/milestones trả về envelope ok', async () => {
    const ctrl = makeCtrl();
    const res = await ctrl.milestonesList(makeReq('tok'));
    expect(res.ok).toBe(true);
    expect(res.data).toEqual(STUB_LIST);
  });

  it('POST claim trả về role + rewardLinhThach + mailId', async () => {
    const ctrl = makeCtrl();
    const res = await ctrl.milestonesClaim(
      makeReq('tok'),
      'mentor_milestone_truc_co',
    );
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({
      role: 'DISCIPLE',
      rewardLinhThach: '8000',
      mailId: 'mail_stub',
    });
  });

  it('POST recompute null relation → relationId null, created/promoted 0', async () => {
    const ctrl = makeCtrl({
      recomputeImpl: async () => null,
    });
    const res = await ctrl.milestonesRecompute(makeReq('tok'));
    expect(res.data).toEqual({ relationId: null, created: 0, promoted: 0 });
  });

  it('POST recompute trả relationId nếu user có ACTIVE relation', async () => {
    const ctrl = makeCtrl();
    const res = await ctrl.milestonesRecompute(makeReq('tok'));
    expect(res.data.relationId).toBe('rel_stub');
  });
});

describe('MentorController.milestones error mapping', () => {
  it('claim MILESTONE_LOCKED → 409', async () => {
    const ctrl = makeCtrl({
      claimImpl: async () => {
        throw new MentorMilestoneError('MILESTONE_LOCKED');
      },
    });
    await expectHttpError(
      ctrl.milestonesClaim(makeReq('tok'), 'mentor_milestone_kim_dan'),
      HttpStatus.CONFLICT,
      'MILESTONE_LOCKED',
    );
  });

  it('claim MILESTONE_ALREADY_CLAIMED → 409', async () => {
    const ctrl = makeCtrl({
      claimImpl: async () => {
        throw new MentorMilestoneError('MILESTONE_ALREADY_CLAIMED');
      },
    });
    await expectHttpError(
      ctrl.milestonesClaim(makeReq('tok'), 'mentor_milestone_truc_co'),
      HttpStatus.CONFLICT,
      'MILESTONE_ALREADY_CLAIMED',
    );
  });

  it('claim MILESTONE_NOT_FOUND → 404', async () => {
    const ctrl = makeCtrl({
      claimImpl: async () => {
        throw new MentorMilestoneError('MILESTONE_NOT_FOUND');
      },
    });
    await expectHttpError(
      ctrl.milestonesClaim(makeReq('tok'), 'nope'),
      HttpStatus.NOT_FOUND,
      'MILESTONE_NOT_FOUND',
    );
  });

  it('claim NOT_IN_ACTIVE_RELATION → 400', async () => {
    const ctrl = makeCtrl({
      claimImpl: async () => {
        throw new MentorMilestoneError('NOT_IN_ACTIVE_RELATION');
      },
    });
    await expectHttpError(
      ctrl.milestonesClaim(makeReq('tok'), 'mentor_milestone_truc_co'),
      HttpStatus.BAD_REQUEST,
      'NOT_IN_ACTIVE_RELATION',
    );
  });

  it('list NO_CHARACTER → 404', async () => {
    const ctrl = makeCtrl({
      listImpl: async () => {
        throw new MentorMilestoneError('NO_CHARACTER');
      },
    });
    await expectHttpError(
      ctrl.milestonesList(makeReq('tok')),
      HttpStatus.NOT_FOUND,
      'NO_CHARACTER',
    );
  });

  it('recompute NOT_AUTHORIZED → 403', async () => {
    const ctrl = makeCtrl({
      recomputeImpl: async () => {
        throw new MentorMilestoneError('NOT_AUTHORIZED');
      },
    });
    await expectHttpError(
      ctrl.milestonesRecompute(makeReq('tok')),
      HttpStatus.FORBIDDEN,
      'NOT_AUTHORIZED',
    );
  });
});
