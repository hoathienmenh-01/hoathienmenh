/**
 * Controller-level pure-unit tests cho `apps/api/src/modules/quest/quest.controller.ts`.
 *
 * 4 endpoint:
 *  - `GET /quests/me`: auth → list `QuestProgressView[]`.
 *  - `POST /quests/accept`: auth → zod ({ questKey }) → accept → return view.
 *  - `POST /quests/progress`: auth → zod ({ questKey, stepId, amount? }) → progress.
 *  - `POST /quests/claim` (Phase 12 PR-3): auth → zod ({ questKey }) → claim → granted breakdown.
 *
 * Error mapping (`QuestError`):
 *  - `NO_CHARACTER` / `QUEST_UNKNOWN` / `QUEST_STEP_UNKNOWN` / `QUEST_NOT_FOUND_PROGRESS` → 404
 *  - `QUEST_LOCKED_REALM` / `QUEST_LOCKED_PREREQUISITE` → 403
 *  - `QUEST_NOT_AVAILABLE` / `QUEST_NOT_ACCEPTED` / `QUEST_STEP_KIND_MISMATCH` /
 *    `QUEST_NOT_COMPLETED` / `QUEST_ALREADY_CLAIMED` → 409
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { QuestController } from './quest.controller';
import {
  QuestError,
  type QuestClaimResult,
  type QuestProgressView,
  type QuestService,
} from './quest.service';
import type { AuthService } from '../auth/auth.service';
import type { PrismaService } from '../../common/prisma.service';

const STUB_VIEW: QuestProgressView = {
  key: 'phamnhan_grind_01',
  name: 'stub',
  description: 'stub',
  kind: 'grind',
  realmKey: 'phamnhan',
  requiredRealmOrder: 0,
  giverNpcKey: 'npc_x',
  chainKey: null,
  prerequisiteQuestKey: null,
  status: 'ACCEPTED',
  steps: [],
  completable: false,
  acceptedAt: null,
  completedAt: null,
  claimedAt: null,
  rewards: { exp: 0, linhThach: 0, items: [] },
};

function makeReq(cookie: string | undefined): Request {
  return { cookies: cookie ? { xt_access: cookie } : {} } as unknown as Request;
}

const STUB_CLAIM: QuestClaimResult = {
  questKey: 'phamnhan_grind_01',
  claimedAt: new Date('2026-05-05T00:00:00Z'),
  granted: { linhThach: 50, tienNgoc: 0, exp: 80, congHien: 0, items: [], affinity: [] },
};

function makeController(
  opts: {
    authedUserId?: string | null;
    listImpl?: (uid: string) => Promise<QuestProgressView[]>;
    acceptImpl?: (uid: string, k: string) => Promise<QuestProgressView>;
    progressImpl?: (
      uid: string,
      input: { questKey: string; stepId: string; amount?: number },
    ) => Promise<QuestProgressView>;
    claimImpl?: (uid: string, k: string) => Promise<QuestClaimResult>;
  } = {},
) {
  const auth = {
    userIdFromAccess: async (t: string | undefined) =>
      t ? (opts.authedUserId === undefined ? 'u1' : opts.authedUserId) : null,
  } as unknown as AuthService;
  const quests = {
    listForUser: opts.listImpl ?? (async () => []),
    accept: opts.acceptImpl ?? (async () => STUB_VIEW),
    progress: opts.progressImpl ?? (async () => STUB_VIEW),
    claim: opts.claimImpl ?? (async () => STUB_CLAIM),
  } as unknown as QuestService;
  const prisma = {} as unknown as PrismaService;
  return new QuestController(quests, auth, prisma);
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
    const body = ex.getResponse() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(code);
  }
}

describe('QuestController.me', () => {
  it('null auth → 401 UNAUTHENTICATED', async () => {
    const c = makeController({ authedUserId: null });
    await expectHttpError(c.me(makeReq(undefined)), HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED');
  });

  it('envelope { ok, data: { quests } }', async () => {
    const c = makeController({ listImpl: async () => [STUB_VIEW] });
    const res = await c.me(makeReq('tok'));
    expect(res).toEqual({ ok: true, data: { quests: [STUB_VIEW] } });
  });

  it('NO_CHARACTER → 404', async () => {
    const c = makeController({
      listImpl: async () => {
        throw new QuestError('NO_CHARACTER');
      },
    });
    await expectHttpError(c.me(makeReq('tok')), HttpStatus.NOT_FOUND, 'NO_CHARACTER');
  });
});

describe('QuestController.accept', () => {
  it('null auth → 401', async () => {
    const c = makeController({ authedUserId: null });
    await expectHttpError(
      c.accept(makeReq(undefined), { questKey: 'q1' }),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });

  it('zod missing questKey → 400 INVALID_INPUT', async () => {
    const c = makeController();
    await expectHttpError(
      c.accept(makeReq('tok'), {}),
      HttpStatus.BAD_REQUEST,
      'INVALID_INPUT',
    );
  });

  it('QUEST_LOCKED_REALM → 403', async () => {
    const c = makeController({
      acceptImpl: async () => {
        throw new QuestError('QUEST_LOCKED_REALM');
      },
    });
    await expectHttpError(
      c.accept(makeReq('tok'), { questKey: 'q1' }),
      HttpStatus.FORBIDDEN,
      'QUEST_LOCKED_REALM',
    );
  });

  it('QUEST_LOCKED_PREREQUISITE → 403', async () => {
    const c = makeController({
      acceptImpl: async () => {
        throw new QuestError('QUEST_LOCKED_PREREQUISITE');
      },
    });
    await expectHttpError(
      c.accept(makeReq('tok'), { questKey: 'q1' }),
      HttpStatus.FORBIDDEN,
      'QUEST_LOCKED_PREREQUISITE',
    );
  });

  it('QUEST_NOT_AVAILABLE → 409', async () => {
    const c = makeController({
      acceptImpl: async () => {
        throw new QuestError('QUEST_NOT_AVAILABLE');
      },
    });
    await expectHttpError(
      c.accept(makeReq('tok'), { questKey: 'q1' }),
      HttpStatus.CONFLICT,
      'QUEST_NOT_AVAILABLE',
    );
  });

  it('QUEST_UNKNOWN → 404', async () => {
    const c = makeController({
      acceptImpl: async () => {
        throw new QuestError('QUEST_UNKNOWN');
      },
    });
    await expectHttpError(
      c.accept(makeReq('tok'), { questKey: 'q1' }),
      HttpStatus.NOT_FOUND,
      'QUEST_UNKNOWN',
    );
  });

  it('envelope ok { ok, data: { quest } }', async () => {
    const c = makeController();
    const res = await c.accept(makeReq('tok'), { questKey: 'phamnhan_grind_01' });
    expect(res).toEqual({ ok: true, data: { quest: STUB_VIEW } });
  });
});

describe('QuestController.progress', () => {
  it('null auth → 401', async () => {
    const c = makeController({ authedUserId: null });
    await expectHttpError(
      c.progress(makeReq(undefined), { questKey: 'q1', stepId: 's1' }),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });

  it('zod missing stepId → 400', async () => {
    const c = makeController();
    await expectHttpError(
      c.progress(makeReq('tok'), { questKey: 'q1' }),
      HttpStatus.BAD_REQUEST,
      'INVALID_INPUT',
    );
  });

  it('zod amount > 100 → 400', async () => {
    const c = makeController();
    await expectHttpError(
      c.progress(makeReq('tok'), { questKey: 'q1', stepId: 's1', amount: 101 }),
      HttpStatus.BAD_REQUEST,
      'INVALID_INPUT',
    );
  });

  it('QUEST_STEP_KIND_MISMATCH → 409', async () => {
    const c = makeController({
      progressImpl: async () => {
        throw new QuestError('QUEST_STEP_KIND_MISMATCH');
      },
    });
    await expectHttpError(
      c.progress(makeReq('tok'), { questKey: 'q1', stepId: 's1' }),
      HttpStatus.CONFLICT,
      'QUEST_STEP_KIND_MISMATCH',
    );
  });

  it('QUEST_NOT_ACCEPTED → 409', async () => {
    const c = makeController({
      progressImpl: async () => {
        throw new QuestError('QUEST_NOT_ACCEPTED');
      },
    });
    await expectHttpError(
      c.progress(makeReq('tok'), { questKey: 'q1', stepId: 's1' }),
      HttpStatus.CONFLICT,
      'QUEST_NOT_ACCEPTED',
    );
  });

  it('QUEST_STEP_UNKNOWN → 404', async () => {
    const c = makeController({
      progressImpl: async () => {
        throw new QuestError('QUEST_STEP_UNKNOWN');
      },
    });
    await expectHttpError(
      c.progress(makeReq('tok'), { questKey: 'q1', stepId: 's1' }),
      HttpStatus.NOT_FOUND,
      'QUEST_STEP_UNKNOWN',
    );
  });

  it('passes amount when provided', async () => {
    let captured: { questKey: string; stepId: string; amount?: number } | null = null;
    const c = makeController({
      progressImpl: async (_uid, input) => {
        captured = input;
        return STUB_VIEW;
      },
    });
    await c.progress(makeReq('tok'), { questKey: 'q1', stepId: 's1', amount: 5 });
    expect(captured).toEqual({ questKey: 'q1', stepId: 's1', amount: 5 });
  });

  it('envelope ok { ok, data: { quest } }', async () => {
    const c = makeController();
    const res = await c.progress(makeReq('tok'), { questKey: 'q1', stepId: 's1' });
    expect(res).toEqual({ ok: true, data: { quest: STUB_VIEW } });
  });
});

describe('QuestController.claim — Phase 12 PR-3', () => {
  it('null auth → 401', async () => {
    const c = makeController({ authedUserId: null });
    await expectHttpError(
      c.claim(makeReq(undefined), { questKey: 'q1' }),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });

  it('zod missing questKey → 400 INVALID_INPUT', async () => {
    const c = makeController();
    await expectHttpError(
      c.claim(makeReq('tok'), {}),
      HttpStatus.BAD_REQUEST,
      'INVALID_INPUT',
    );
  });

  it('QUEST_UNKNOWN → 404', async () => {
    const c = makeController({
      claimImpl: async () => {
        throw new QuestError('QUEST_UNKNOWN');
      },
    });
    await expectHttpError(
      c.claim(makeReq('tok'), { questKey: 'q1' }),
      HttpStatus.NOT_FOUND,
      'QUEST_UNKNOWN',
    );
  });

  it('QUEST_NOT_FOUND_PROGRESS → 404', async () => {
    const c = makeController({
      claimImpl: async () => {
        throw new QuestError('QUEST_NOT_FOUND_PROGRESS');
      },
    });
    await expectHttpError(
      c.claim(makeReq('tok'), { questKey: 'q1' }),
      HttpStatus.NOT_FOUND,
      'QUEST_NOT_FOUND_PROGRESS',
    );
  });

  it('QUEST_NOT_COMPLETED → 409', async () => {
    const c = makeController({
      claimImpl: async () => {
        throw new QuestError('QUEST_NOT_COMPLETED');
      },
    });
    await expectHttpError(
      c.claim(makeReq('tok'), { questKey: 'q1' }),
      HttpStatus.CONFLICT,
      'QUEST_NOT_COMPLETED',
    );
  });

  it('QUEST_ALREADY_CLAIMED → 409', async () => {
    const c = makeController({
      claimImpl: async () => {
        throw new QuestError('QUEST_ALREADY_CLAIMED');
      },
    });
    await expectHttpError(
      c.claim(makeReq('tok'), { questKey: 'q1' }),
      HttpStatus.CONFLICT,
      'QUEST_ALREADY_CLAIMED',
    );
  });

  it('envelope ok { ok, data: { questKey, claimedAt, granted } }', async () => {
    const c = makeController();
    const res = await c.claim(makeReq('tok'), { questKey: 'phamnhan_grind_01' });
    expect(res).toEqual({
      ok: true,
      data: {
        questKey: 'phamnhan_grind_01',
        claimedAt: '2026-05-05T00:00:00.000Z',
        granted: STUB_CLAIM.granted,
      },
    });
  });
});

describe('QuestController unknown error rethrow', () => {
  it('non-QuestError bubbles up untouched', async () => {
    const ohno = new Error('boom');
    const c = makeController({
      listImpl: async () => {
        throw ohno;
      },
    });
    await expect(c.me(makeReq('tok'))).rejects.toBe(ohno);
  });
});
