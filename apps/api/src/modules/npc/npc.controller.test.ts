/**
 * Controller-level pure-unit tests cho `apps/api/src/modules/npc/npc.controller.ts`.
 *
 * 2 endpoint:
 *  - `GET /npcs/me`: auth → list `NpcView[]`.
 *  - `GET /npcs/:npcKey/dialogue`: auth → zod param → pick dialogue → `NpcDialogueView`.
 *
 * Error mapping (`NpcError`):
 *  - `NO_CHARACTER` / `NPC_UNKNOWN` / `NO_DIALOGUE` → 404
 *  - `NPC_LOCKED_REALM` → 403
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { NpcController } from './npc.controller';
import {
  NpcError,
  type NpcDialogueView,
  type NpcService,
  type NpcView,
} from './npc.service';
import type { AuthService } from '../auth/auth.service';

const STUB_DIALOGUE: NpcDialogueView = {
  dialogueId: 'dlg_lang_van_sinh_default',
  speakerNpcKey: 'npc_lang_van_sinh',
  text: 'stub',
  choices: [
    {
      key: 'leave',
      label: 'Đệ tử xin cáo lui.',
      nextDialogueId: null,
      acceptQuestKey: null,
      acceptQuestStatus: null,
      closeDialogue: true,
    },
  ],
};

const STUB_VIEW: NpcView = {
  key: 'npc_lang_van_sinh',
  name: 'Lăng Vân Sinh',
  faction: 'hoa_thien_mon',
  realmGateOrder: 0,
  description: 'stub',
  loreSummary: 'stub',
  questCount: 1,
  dialogue: STUB_DIALOGUE,
};

function makeReq(cookie: string | undefined): Request {
  return { cookies: cookie ? { xt_access: cookie } : {} } as unknown as Request;
}

function makeController(
  opts: {
    authedUserId?: string | null;
    listImpl?: (uid: string) => Promise<NpcView[]>;
    dialogueImpl?: (uid: string, k: string) => Promise<NpcDialogueView>;
  } = {},
) {
  const auth = {
    userIdFromAccess: async (t: string | undefined) =>
      t ? (opts.authedUserId === undefined ? 'u1' : opts.authedUserId) : null,
  } as unknown as AuthService;
  const npcs = {
    listForUser: opts.listImpl ?? (async () => [STUB_VIEW]),
    getDialogueForNpc: opts.dialogueImpl ?? (async () => STUB_DIALOGUE),
  } as unknown as NpcService;
  return new NpcController(npcs, auth);
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

describe('NpcController.me', () => {
  it('UNAUTHENTICATED 401 khi không có cookie', async () => {
    const c = makeController();
    await expectHttpError(c.me(makeReq(undefined)), HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED');
  });

  it('UNAUTHENTICATED 401 khi cookie có nhưng auth.userIdFromAccess return null', async () => {
    const c = makeController({ authedUserId: null });
    await expectHttpError(c.me(makeReq('bad-token')), HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED');
  });

  it('200 trả về { ok: true, data: { npcs } } envelope', async () => {
    const c = makeController();
    const res = await c.me(makeReq('valid-token'));
    expect(res.ok).toBe(true);
    expect(res.data.npcs).toEqual([STUB_VIEW]);
  });

  it('NO_CHARACTER 404 khi service throw NpcError("NO_CHARACTER")', async () => {
    const c = makeController({
      listImpl: async () => {
        throw new NpcError('NO_CHARACTER');
      },
    });
    await expectHttpError(c.me(makeReq('valid-token')), HttpStatus.NOT_FOUND, 'NO_CHARACTER');
  });
});

describe('NpcController.dialogue', () => {
  it('UNAUTHENTICATED 401 khi không có cookie', async () => {
    const c = makeController();
    await expectHttpError(
      c.dialogue(makeReq(undefined), 'npc_lang_van_sinh'),
      HttpStatus.UNAUTHORIZED,
      'UNAUTHENTICATED',
    );
  });

  it('INVALID_INPUT 400 khi npcKey sai format (không bắt đầu npc_)', async () => {
    const c = makeController();
    await expectHttpError(
      c.dialogue(makeReq('valid-token'), 'invalid_format'),
      HttpStatus.BAD_REQUEST,
      'INVALID_INPUT',
    );
  });

  it('INVALID_INPUT 400 khi npcKey rỗng', async () => {
    const c = makeController();
    await expectHttpError(
      c.dialogue(makeReq('valid-token'), ''),
      HttpStatus.BAD_REQUEST,
      'INVALID_INPUT',
    );
  });

  it('200 trả về { ok: true, data: { dialogue } } envelope', async () => {
    const c = makeController();
    const res = await c.dialogue(makeReq('valid-token'), 'npc_lang_van_sinh');
    expect(res.ok).toBe(true);
    expect(res.data.dialogue).toEqual(STUB_DIALOGUE);
  });

  it('NPC_UNKNOWN 404 khi service throw NpcError("NPC_UNKNOWN")', async () => {
    const c = makeController({
      dialogueImpl: async () => {
        throw new NpcError('NPC_UNKNOWN');
      },
    });
    await expectHttpError(
      c.dialogue(makeReq('valid-token'), 'npc_lang_van_sinh'),
      HttpStatus.NOT_FOUND,
      'NPC_UNKNOWN',
    );
  });

  it('NPC_LOCKED_REALM 403 khi character realm thấp hơn realmGate', async () => {
    const c = makeController({
      dialogueImpl: async () => {
        throw new NpcError('NPC_LOCKED_REALM');
      },
    });
    await expectHttpError(
      c.dialogue(makeReq('valid-token'), 'npc_han_da'),
      HttpStatus.FORBIDDEN,
      'NPC_LOCKED_REALM',
    );
  });

  it('NO_DIALOGUE 404 khi catalog không có line match', async () => {
    const c = makeController({
      dialogueImpl: async () => {
        throw new NpcError('NO_DIALOGUE');
      },
    });
    await expectHttpError(
      c.dialogue(makeReq('valid-token'), 'npc_lang_van_sinh'),
      HttpStatus.NOT_FOUND,
      'NO_DIALOGUE',
    );
  });

  it('NO_CHARACTER 404 khi service throw NpcError("NO_CHARACTER") trong dialogue path', async () => {
    const c = makeController({
      dialogueImpl: async () => {
        throw new NpcError('NO_CHARACTER');
      },
    });
    await expectHttpError(
      c.dialogue(makeReq('valid-token'), 'npc_lang_van_sinh'),
      HttpStatus.NOT_FOUND,
      'NO_CHARACTER',
    );
  });
});
