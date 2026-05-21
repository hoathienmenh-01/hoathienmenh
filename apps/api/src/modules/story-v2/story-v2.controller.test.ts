/**
 * Phase 33.1 Controller pure-unit tests cho `Phase33StoryController`.
 *
 * 7 endpoint:
 *  - `GET /story/v2/chapters`: auth → list chapters.
 *  - `GET /story/v2/chapters/:chapKey/quests`: auth → list quests.
 *  - `GET /story/v2/quests/:questKey/dialogues?phase=`: auth → list dialogues.
 *  - `POST /story/v2/quests/accept`: auth → zod({questKey}) → accept.
 *  - `POST /story/v2/quests/progress`: auth → zod({questKey, stepId, amount?}) → progress.
 *  - `POST /story/v2/quests/complete`: auth → zod({questKey}) → complete.
 *  - `POST /story/v2/quests/claim`: auth → zod({questKey}) → claim atomic.
 *
 * Error mapping (`Phase33StoryError`):
 *  - `NO_CHARACTER` / `STORY_V2_QUEST_UNKNOWN` / `STORY_V2_CHAPTER_UNKNOWN` /
 *    `STORY_V2_QUEST_STEP_UNKNOWN` / `STORY_V2_QUEST_NOT_FOUND_PROGRESS` → 404
 *  - `STORY_V2_QUEST_LOCKED_*` → 403
 *  - `STORY_V2_QUEST_NOT_AVAILABLE` / `STORY_V2_QUEST_NOT_ACCEPTED` /
 *    `STORY_V2_QUEST_NOT_COMPLETED` / `STORY_V2_QUEST_ALREADY_CLAIMED` /
 *    `STORY_V2_QUEST_STEP_KIND_NOT_SUPPORTED` → 409
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { Phase33StoryController } from './story-v2.controller';
import {
  Phase33StoryError,
  type Phase33ChapterView,
  type Phase33ClaimResult,
  type Phase33DialogueView,
  type Phase33QuestView,
  type Phase33StoryService,
} from './story-v2.service';
import type { AuthService } from '../auth/auth.service';

const STUB_QUEST_VIEW: Phase33QuestView = {
  questKey: 'q_ch09_main_01',
  kind: 'main',
  chapKey: 'ch09',
  volumeKey: 'quyen_ii_tien_gioi',
  titleVi: 'stub vi',
  titleEn: 'stub en',
  descriptionVi: 'stub vi',
  descriptionEn: 'stub en',
  giverNpcKey: 'npc_luc_binh',
  requiredRealmKey: 'do_kiep',
  requiredRealmOrder: 9,
  prerequisiteQuestKey: null,
  status: 'ACCEPTED',
  steps: [],
  completable: false,
  acceptedAt: null,
  completedAt: null,
  claimedAt: null,
  rewards: { linhThach: 100, exp: 50, congHien: 8 },
};

const STUB_CHAPTER_VIEW: Phase33ChapterView = {
  chapKey: 'ch09',
  volumeKey: 'quyen_ii_tien_gioi',
  titleVi: 'stub',
  titleEn: 'stub',
  themeVi: 'stub',
  themeEn: 'stub',
  status: 'AVAILABLE',
  mainQuestsTotal: 5,
  mainQuestsCompletedCount: 0,
  unlockedAt: null,
  completedAt: null,
  storyFlags: [],
};

const STUB_DIALOGUE_VIEW: Phase33DialogueView = {
  dialogueId: 'dlg_q_ch09_main_01_INTRO',
  questKey: 'q_ch09_main_01',
  chapterKey: 'ch09',
  speakerNpcKey: 'npc_luc_binh',
  phase: 'INTRO',
  textVi: 'stub vi',
  textEn: 'stub en',
};

const STUB_CLAIM: Phase33ClaimResult = {
  questKey: 'q_ch09_main_01',
  claimedAt: new Date('2026-05-05T00:00:00Z'),
  granted: {
    linhThach: 100,
    exp: 50,
    congHien: 8,
    items: [],
    affinity: [],
    storyFlags: [],
  },
};

function makeReq(cookie: string | undefined): Request {
  return { cookies: cookie ? { xt_access: cookie } : {} } as unknown as Request;
}

interface MakeOpts {
  authedUserId?: string | null;
  listChapImpl?: (uid: string) => Promise<Phase33ChapterView[]>;
  listQuestImpl?: (uid: string, ck: string) => Promise<Phase33QuestView[]>;
  listDlgImpl?: (
    uid: string,
    qk: string,
    p?: unknown,
  ) => Promise<Phase33DialogueView[]>;
  acceptImpl?: (uid: string, qk: string) => Promise<Phase33QuestView>;
  progressImpl?: (
    uid: string,
    input: { questKey: string; stepId: string; amount?: number },
  ) => Promise<Phase33QuestView>;
  completeImpl?: (uid: string, qk: string) => Promise<Phase33QuestView>;
  claimImpl?: (uid: string, qk: string) => Promise<Phase33ClaimResult>;
}

function makeController(opts: MakeOpts = {}) {
  const auth = {
    userIdFromAccess: async (t: string | undefined) =>
      t ? (opts.authedUserId === undefined ? 'u1' : opts.authedUserId) : null,
  } as unknown as AuthService;
  const story = {
    listChaptersForUser: opts.listChapImpl ?? (async () => []),
    listQuestsForChapter: opts.listQuestImpl ?? (async () => []),
    listDialoguesForQuest: opts.listDlgImpl ?? (async () => []),
    acceptQuest: opts.acceptImpl ?? (async () => STUB_QUEST_VIEW),
    progressQuest: opts.progressImpl ?? (async () => STUB_QUEST_VIEW),
    completeQuest: opts.completeImpl ?? (async () => STUB_QUEST_VIEW),
    claimReward: opts.claimImpl ?? (async () => STUB_CLAIM),
  } as unknown as Phase33StoryService;
  const featureFlags = {
    requireEnabled: async () => {},
  } as unknown as import('../feature-flag/feature-flag.service').FeatureFlagService;
  const prisma = {
    character: { findUnique: async () => null },
  } as unknown as import('../../common/prisma.service').PrismaService;
  return new Phase33StoryController(story, auth, featureFlags, prisma);
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

describe('Phase33StoryController.listChapters', () => {
  it('null auth → 401', async () => {
    const c = makeController({ authedUserId: null });
    await expectHttpError(
      c.listChapters(makeReq(undefined)),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });

  it('envelope { ok, data: { chapters } }', async () => {
    const c = makeController({ listChapImpl: async () => [STUB_CHAPTER_VIEW] });
    const res = await c.listChapters(makeReq('tok'));
    expect(res).toEqual({ ok: true, data: { chapters: [STUB_CHAPTER_VIEW] } });
  });

  it('NO_CHARACTER → 404', async () => {
    const c = makeController({
      listChapImpl: async () => {
        throw new Phase33StoryError('NO_CHARACTER');
      },
    });
    await expectHttpError(
      c.listChapters(makeReq('tok')),
      HttpStatus.NOT_FOUND,
      'NO_CHARACTER',
    );
  });
});

describe('Phase33StoryController.listQuests', () => {
  it('null auth → 401', async () => {
    const c = makeController({ authedUserId: null });
    await expectHttpError(
      c.listQuests(makeReq(undefined), 'ch09'),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });

  it('STORY_V2_CHAPTER_UNKNOWN → 404', async () => {
    const c = makeController({
      listQuestImpl: async () => {
        throw new Phase33StoryError('STORY_V2_CHAPTER_UNKNOWN');
      },
    });
    await expectHttpError(
      c.listQuests(makeReq('tok'), 'ch_invalid'),
      HttpStatus.NOT_FOUND,
      'STORY_V2_CHAPTER_UNKNOWN',
    );
  });

  it('envelope { ok, data: { quests } }', async () => {
    const c = makeController({
      listQuestImpl: async () => [STUB_QUEST_VIEW],
    });
    const res = await c.listQuests(makeReq('tok'), 'ch09');
    expect(res).toEqual({ ok: true, data: { quests: [STUB_QUEST_VIEW] } });
  });
});

describe('Phase33StoryController.listDialogues', () => {
  it('null auth → 401', async () => {
    const c = makeController({ authedUserId: null });
    await expectHttpError(
      c.listDialogues(makeReq(undefined), 'q_ch09_main_01'),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });

  it('invalid phase → 400 INVALID_INPUT', async () => {
    const c = makeController();
    await expectHttpError(
      c.listDialogues(makeReq('tok'), 'q_ch09_main_01', 'NOT_A_PHASE'),
      HttpStatus.BAD_REQUEST,
      'INVALID_INPUT',
    );
  });

  it('STORY_V2_QUEST_UNKNOWN → 404', async () => {
    const c = makeController({
      listDlgImpl: async () => {
        throw new Phase33StoryError('STORY_V2_QUEST_UNKNOWN');
      },
    });
    await expectHttpError(
      c.listDialogues(makeReq('tok'), 'q_invalid'),
      HttpStatus.NOT_FOUND,
      'STORY_V2_QUEST_UNKNOWN',
    );
  });

  it('STORY_V2_QUEST_NOT_FOUND_PROGRESS → 404', async () => {
    const c = makeController({
      listDlgImpl: async () => {
        throw new Phase33StoryError('STORY_V2_QUEST_NOT_FOUND_PROGRESS');
      },
    });
    await expectHttpError(
      c.listDialogues(makeReq('tok'), 'q_ch09_main_01'),
      HttpStatus.NOT_FOUND,
      'STORY_V2_QUEST_NOT_FOUND_PROGRESS',
    );
  });

  it('envelope { ok, data: { dialogues } }', async () => {
    const c = makeController({
      listDlgImpl: async () => [STUB_DIALOGUE_VIEW],
    });
    const res = await c.listDialogues(
      makeReq('tok'),
      'q_ch09_main_01',
      'INTRO',
    );
    expect(res).toEqual({
      ok: true,
      data: { dialogues: [STUB_DIALOGUE_VIEW] },
    });
  });
});

describe('Phase33StoryController.accept', () => {
  it('null auth → 401', async () => {
    const c = makeController({ authedUserId: null });
    await expectHttpError(
      c.accept(makeReq(undefined), { questKey: 'q1' }),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });

  it('zod missing questKey → 400', async () => {
    const c = makeController();
    await expectHttpError(
      c.accept(makeReq('tok'), {}),
      HttpStatus.BAD_REQUEST,
      'INVALID_INPUT',
    );
  });

  it('LOCKED_REALM → 403', async () => {
    const c = makeController({
      acceptImpl: async () => {
        throw new Phase33StoryError('STORY_V2_QUEST_LOCKED_REALM');
      },
    });
    await expectHttpError(
      c.accept(makeReq('tok'), { questKey: 'q1' }),
      HttpStatus.FORBIDDEN,
      'STORY_V2_QUEST_LOCKED_REALM',
    );
  });

  it('LOCKED_PREREQUISITE → 403', async () => {
    const c = makeController({
      acceptImpl: async () => {
        throw new Phase33StoryError('STORY_V2_QUEST_LOCKED_PREREQUISITE');
      },
    });
    await expectHttpError(
      c.accept(makeReq('tok'), { questKey: 'q1' }),
      HttpStatus.FORBIDDEN,
      'STORY_V2_QUEST_LOCKED_PREREQUISITE',
    );
  });

  it('envelope ok with quest view', async () => {
    const c = makeController({
      acceptImpl: async () => STUB_QUEST_VIEW,
    });
    const res = await c.accept(makeReq('tok'), { questKey: 'q1' });
    expect(res).toEqual({ ok: true, data: { quest: STUB_QUEST_VIEW } });
  });
});

describe('Phase33StoryController.progress', () => {
  it('zod missing stepId → 400', async () => {
    const c = makeController();
    await expectHttpError(
      c.progress(makeReq('tok'), { questKey: 'q1' }),
      HttpStatus.BAD_REQUEST,
      'INVALID_INPUT',
    );
  });

  it('STEP_KIND_NOT_SUPPORTED → 409', async () => {
    const c = makeController({
      progressImpl: async () => {
        throw new Phase33StoryError(
          'STORY_V2_QUEST_STEP_KIND_NOT_SUPPORTED',
        );
      },
    });
    await expectHttpError(
      c.progress(makeReq('tok'), { questKey: 'q1', stepId: 'step_1' }),
      HttpStatus.CONFLICT,
      'STORY_V2_QUEST_STEP_KIND_NOT_SUPPORTED',
    );
  });

  it('NOT_ACCEPTED → 409', async () => {
    const c = makeController({
      progressImpl: async () => {
        throw new Phase33StoryError('STORY_V2_QUEST_NOT_ACCEPTED');
      },
    });
    await expectHttpError(
      c.progress(makeReq('tok'), { questKey: 'q1', stepId: 'step_1' }),
      HttpStatus.CONFLICT,
      'STORY_V2_QUEST_NOT_ACCEPTED',
    );
  });
});

describe('Phase33StoryController.complete', () => {
  it('NOT_COMPLETED → 409', async () => {
    const c = makeController({
      completeImpl: async () => {
        throw new Phase33StoryError('STORY_V2_QUEST_NOT_COMPLETED');
      },
    });
    await expectHttpError(
      c.complete(makeReq('tok'), { questKey: 'q1' }),
      HttpStatus.CONFLICT,
      'STORY_V2_QUEST_NOT_COMPLETED',
    );
  });
});

describe('Phase33StoryController.claim', () => {
  it('ALREADY_CLAIMED → 409', async () => {
    const c = makeController({
      claimImpl: async () => {
        throw new Phase33StoryError('STORY_V2_QUEST_ALREADY_CLAIMED');
      },
    });
    await expectHttpError(
      c.claim(makeReq('tok'), { questKey: 'q1' }),
      HttpStatus.CONFLICT,
      'STORY_V2_QUEST_ALREADY_CLAIMED',
    );
  });

  it('envelope ok with granted breakdown', async () => {
    const c = makeController({ claimImpl: async () => STUB_CLAIM });
    const res = await c.claim(makeReq('tok'), { questKey: 'q1' });
    expect(res).toEqual({
      ok: true,
      data: {
        questKey: STUB_CLAIM.questKey,
        claimedAt: STUB_CLAIM.claimedAt.toISOString(),
        granted: STUB_CLAIM.granted,
      },
    });
  });
});
