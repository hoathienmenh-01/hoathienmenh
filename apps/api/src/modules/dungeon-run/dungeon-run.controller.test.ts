/**
 * Controller-level pure-unit tests cho
 * `apps/api/src/modules/dungeon-run/dungeon-run.controller.ts`.
 *
 * 4 endpoint:
 *  - `GET /dungeons/me`: auth → list `DungeonListView`.
 *  - `POST /dungeons/:templateKey/start`: auth → zod (param) → start.
 *  - `POST /dungeon-runs/:runId/next`: auth → zod (param) → next.
 *  - `POST /dungeon-runs/:runId/claim`: auth → zod (param) → claim.
 *
 * Error mapping (`DungeonRunError`):
 *  - `NO_CHARACTER` / `DUNGEON_NOT_FOUND` / `RUN_NOT_FOUND` → 404
 *  - `RUN_NOT_OWNED` / `DUNGEON_LOCKED_REALM` → 403
 *  - `DUNGEON_DAILY_LIMIT_REACHED` / `STAMINA_LOW` / `ALREADY_IN_RUN` /
 *    `RUN_NOT_ACTIVE` / `RUN_NOT_COMPLETED` / `RUN_ALREADY_CLAIMED` /
 *    `RUN_NO_REWARD` → 409
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { DungeonRunController } from './dungeon-run.controller';
import {
  DungeonClaimResult,
  DungeonListView,
  DungeonRunError,
  DungeonRunService,
  DungeonRunView,
} from './dungeon-run.service';
import type { AuthService } from '../auth/auth.service';

const STUB_RUN: DungeonRunView = {
  id: 'run-1',
  templateKey: 'son_coc',
  status: 'ACTIVE',
  encounterIndex: 0,
  totalEncounters: 3,
  currentMonster: null,
  killedMonsters: [],
  startedAt: '2026-05-06T00:00:00Z',
  completedAt: null,
  claimedAt: null,
  reward: null,
};

const STUB_LIST: DungeonListView = {
  available: [],
  activeRun: null,
};

const STUB_CLAIM: DungeonClaimResult = {
  runId: 'run-1',
  templateKey: 'son_coc',
  claimedAt: new Date('2026-05-06T00:00:00Z'),
  granted: { linhThach: 50, tienNgoc: 0, exp: 100, items: [{ itemKey: 'huyet_chi_dan', qty: 1 }] },
  capped: false,
  dailyCapRemaining: { exp: 2300, linhThach: 550 },
};

function makeReq(cookie: string | undefined): Request {
  return { cookies: cookie ? { xt_access: cookie } : {} } as unknown as Request;
}

function makeController(
  opts: {
    authedUserId?: string | null;
    listImpl?: (uid: string) => Promise<DungeonListView>;
    startImpl?: (uid: string, key: string) => Promise<DungeonRunView>;
    nextImpl?: (uid: string, runId: string) => Promise<DungeonRunView>;
    claimImpl?: (uid: string, runId: string) => Promise<DungeonClaimResult>;
  } = {},
) {
  const auth = {
    userIdFromAccess: async (t: string | undefined) =>
      t ? (opts.authedUserId === undefined ? 'u1' : opts.authedUserId) : null,
  } as unknown as AuthService;
  const runs = {
    listForUser: opts.listImpl ?? (async () => STUB_LIST),
    startRun: opts.startImpl ?? (async () => STUB_RUN),
    nextEncounter: opts.nextImpl ?? (async () => STUB_RUN),
    claimRun: opts.claimImpl ?? (async () => STUB_CLAIM),
  } as unknown as DungeonRunService;
  return new DungeonRunController(runs, auth);
}

describe('DungeonRunController auth gate', () => {
  it('GET /dungeons/me throws 401 nếu không có cookie', async () => {
    const ctrl = makeController({ authedUserId: null });
    await expect(ctrl.list(makeReq(undefined))).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('POST start throws 401 nếu không có cookie', async () => {
    const ctrl = makeController({ authedUserId: null });
    await expect(
      ctrl.start(makeReq(undefined), 'son_coc', {}),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
  });

  it('POST next throws 401 nếu không có cookie', async () => {
    const ctrl = makeController({ authedUserId: null });
    await expect(
      ctrl.next(makeReq(undefined), 'run-1', {}),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
  });

  it('POST claim throws 401 nếu không có cookie', async () => {
    const ctrl = makeController({ authedUserId: null });
    await expect(
      ctrl.claim(makeReq(undefined), 'run-1', {}),
    ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
  });
});

describe('DungeonRunController param validation', () => {
  it('start throws 400 INVALID_INPUT khi templateKey rỗng', async () => {
    const ctrl = makeController();
    await expect(ctrl.start(makeReq('tok'), '', {})).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('next throws 400 INVALID_INPUT khi runId rỗng', async () => {
    const ctrl = makeController();
    await expect(ctrl.next(makeReq('tok'), '', {})).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
  });
});

describe('DungeonRunController happy path', () => {
  it('GET /dungeons/me returns envelope { ok:true, data }', async () => {
    const ctrl = makeController();
    const res = await ctrl.list(makeReq('tok'));
    expect(res.ok).toBe(true);
    expect(res.data).toEqual(STUB_LIST);
  });

  it('POST start returns envelope { ok:true, data:{ run } }', async () => {
    const ctrl = makeController();
    const res = await ctrl.start(makeReq('tok'), 'son_coc', {});
    expect(res.ok).toBe(true);
    expect(res.data.run.id).toBe(STUB_RUN.id);
  });

  it('POST next returns envelope { ok:true, data:{ run } }', async () => {
    const ctrl = makeController();
    const res = await ctrl.next(makeReq('tok'), 'run-1', {});
    expect(res.ok).toBe(true);
    expect(res.data.run.id).toBe(STUB_RUN.id);
  });

  it('POST claim returns envelope { ok:true, data:{ runId, granted } }', async () => {
    const ctrl = makeController();
    const res = await ctrl.claim(makeReq('tok'), 'run-1', {});
    expect(res.ok).toBe(true);
    expect(res.data.runId).toBe('run-1');
    expect(res.data.claimedAt).toBe('2026-05-06T00:00:00.000Z');
    expect(res.data.granted.linhThach).toBe(50);
  });
});

describe('DungeonRunController error mapping', () => {
  const cases404: Array<DungeonRunError['code']> = [
    'NO_CHARACTER',
    'DUNGEON_NOT_FOUND',
    'RUN_NOT_FOUND',
  ];
  for (const code of cases404) {
    it(`maps ${code} → 404`, async () => {
      const ctrl = makeController({
        listImpl: async () => {
          throw new DungeonRunError(code as 'NO_CHARACTER');
        },
      });
      await expect(ctrl.list(makeReq('tok'))).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });
  }

  const cases403: Array<DungeonRunError['code']> = [
    'RUN_NOT_OWNED',
    'DUNGEON_LOCKED_REALM',
  ];
  for (const code of cases403) {
    it(`maps ${code} → 403`, async () => {
      const ctrl = makeController({
        startImpl: async () => {
          throw new DungeonRunError(code as 'DUNGEON_LOCKED_REALM');
        },
      });
      await expect(
        ctrl.start(makeReq('tok'), 'son_coc', {}),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });
  }

  const cases409: Array<DungeonRunError['code']> = [
    'DUNGEON_DAILY_LIMIT_REACHED',
    'STAMINA_LOW',
    'ALREADY_IN_RUN',
    'RUN_NOT_ACTIVE',
    'RUN_NOT_COMPLETED',
    'RUN_ALREADY_CLAIMED',
    'RUN_NO_REWARD',
  ];
  for (const code of cases409) {
    it(`maps ${code} → 409`, async () => {
      const ctrl = makeController({
        claimImpl: async () => {
          throw new DungeonRunError(code as 'RUN_ALREADY_CLAIMED');
        },
      });
      await expect(
        ctrl.claim(makeReq('tok'), 'run-1', {}),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    });
  }

  it('non-DungeonRunError lỗi gốc bubble lên (không bị nuốt)', async () => {
    const ctrl = makeController({
      listImpl: async () => {
        throw new Error('boom');
      },
    });
    await expect(ctrl.list(makeReq('tok'))).rejects.toThrow('boom');
  });
});

// Avoid unused-import lint (HttpException only referenced for typing context).
void HttpException;
