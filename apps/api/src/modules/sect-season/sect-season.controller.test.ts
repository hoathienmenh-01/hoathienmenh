/**
 * Phase 13.2.A foundation + Phase 13.2.B claim — controller-level pure-unit
 * tests cho `sect-season.controller.ts`.
 *
 * 5 endpoint:
 *   - `GET  /sect-season/current` — auth required.
 *   - `GET  /sect-season/leaderboard` — public.
 *   - `GET  /sect-season/me` — auth required.
 *   - `GET  /sect-season/milestones` — public (Phase 13.2.B).
 *   - `POST /sect-season/milestones/:milestoneKey/claim?seasonKey=...` —
 *     auth required (Phase 13.2.B).
 *
 * Lock-in invariants:
 *   1. UNAUTHENTICATED → 401 cho mọi mutation/`me`/`current` endpoint.
 *   2. SEASON_KEY_REQUIRED → 400 nếu `claim` thiếu `seasonKey`.
 *   3. SectSeasonError mapping:
 *      - NO_CHARACTER / SEASON_NOT_FOUND / SECT_SEASON_MILESTONE_NOT_FOUND → 404.
 *      - SECT_SEASON_NOT_ELIGIBLE → 400.
 *      - SECT_SEASON_ALREADY_CLAIMED → 409.
 *   4. Public endpoint (`leaderboard`, `milestones`) KHÔNG check auth, KHÔNG throw.
 *   5. Service trả raw view → controller wrap `{ ok: true, data }` envelope.
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { SectSeasonController } from './sect-season.controller';
import {
  SectSeasonError,
  type SectSeasonCurrentView,
  type SectSeasonService,
} from './sect-season.service';
import type {
  SectSeasonClaimResult,
  SectSeasonDef,
  SectSeasonLeaderboardView,
  SectSeasonMilestoneDef,
  SectSeasonMyStatusView,
} from '@xuantoi/shared';
import type { AuthService } from '../auth/auth.service';
import type { SectSeasonHistoryService } from './sect-season-history.service';

const STUB_LB: SectSeasonLeaderboardView = {
  seasonKey: 'season_2026_s2',
  rows: [],
};
const STUB_ME: SectSeasonMyStatusView = {
  seasonKey: 'season_2026_s2',
  hasSect: false,
  sectId: null,
  sectName: null,
  personalPoints: 0,
  weeksContributed: 0,
  achievedMilestoneKeys: [],
  nextMilestoneKey: 'milestone_bronze',
  claimedMilestoneKeys: [],
  claimableMilestoneKeys: [],
};
const STUB_CURRENT: SectSeasonCurrentView = {
  seasonKey: 'season_2026_s2',
  season: { key: 'season_2026_s2' } as SectSeasonDef,
  milestones: [],
  leaderboard: [],
  me: STUB_ME,
};
const STUB_CLAIM_RESULT: SectSeasonClaimResult = {
  seasonKey: 'season_2026_s2',
  milestoneKey: 'milestone_bronze',
  granted: { linhThach: 100, tienNgoc: 0, items: [], titleKey: null, buffKey: null },
  pointsAtClaim: 200,
  claimedAtIso: '2026-05-08T00:00:00.000Z',
};
const STUB_MILESTONES: SectSeasonMilestoneDef[] = [];

function makeReq(cookie: string | undefined): Request {
  return { cookies: cookie ? { xt_access: cookie } : {} } as unknown as Request;
}

function makeController(
  opts: {
    authedUserId?: string | null;
    currentImpl?: () => Promise<SectSeasonCurrentView>;
    leaderboardImpl?: (k?: string) => Promise<SectSeasonLeaderboardView>;
    meImpl?: (uid: string, k?: string) => Promise<SectSeasonMyStatusView | null>;
    milestonesImpl?: () => ReadonlyArray<SectSeasonMilestoneDef>;
    claimImpl?: (
      uid: string,
      seasonKey: string,
      milestoneKey: string,
    ) => Promise<SectSeasonClaimResult>;
  } = {},
) {
  const auth = {
    userIdFromAccess: async (t: string | undefined) =>
      t ? (opts.authedUserId === undefined ? 'u1' : opts.authedUserId) : null,
  } as unknown as AuthService;
  const sectSeason = {
    getCurrent: opts.currentImpl ?? (async () => STUB_CURRENT),
    getLeaderboard: opts.leaderboardImpl ?? (async () => STUB_LB),
    getMyStatus: opts.meImpl ?? (async () => STUB_ME),
    listMilestones: opts.milestonesImpl ?? (() => STUB_MILESTONES),
    claimMilestone: opts.claimImpl ?? (async () => STUB_CLAIM_RESULT),
  } as unknown as SectSeasonService;
  const sectSeasonHistory = {} as unknown as SectSeasonHistoryService;
  return new SectSeasonController(sectSeason, sectSeasonHistory, auth);
}

async function expectHttpError(p: Promise<unknown>, status: number, code: string) {
  try {
    await p;
    throw new Error('expected throw');
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    const err = e as HttpException;
    expect(err.getStatus()).toBe(status);
    expect(err.getResponse()).toMatchObject({ ok: false, error: { code } });
  }
}

describe('SectSeasonController', () => {
  describe('GET /sect-season/current — auth required', () => {
    it('401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.current(makeReq(undefined)),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });

    it('200 envelope { ok, data: SectSeasonCurrentView }', async () => {
      const c = makeController();
      const r = await c.current(makeReq('valid'));
      expect(r).toEqual({ ok: true, data: STUB_CURRENT });
    });

    it('404 NO_CHARACTER khi service throw', async () => {
      const c = makeController({
        currentImpl: async () => {
          throw new SectSeasonError('NO_CHARACTER');
        },
      });
      await expectHttpError(
        c.current(makeReq('valid')),
        HttpStatus.NOT_FOUND,
        'NO_CHARACTER',
      );
    });
  });

  describe('GET /sect-season/leaderboard — PUBLIC', () => {
    it('200 envelope khi không cookie (no auth)', async () => {
      const c = makeController();
      const r = await c.leaderboard();
      expect(r).toEqual({ ok: true, data: STUB_LB });
    });

    it('200 truyền seasonKey query → service', async () => {
      const calls: Array<string | undefined> = [];
      const c = makeController({
        leaderboardImpl: async (k) => {
          calls.push(k);
          return STUB_LB;
        },
      });
      await c.leaderboard('season_2026_s3');
      expect(calls).toEqual(['season_2026_s3']);
    });
  });

  describe('GET /sect-season/me — auth required', () => {
    it('401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.me(makeReq(undefined)),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });

    it('200 envelope { ok, data: SectSeasonMyStatusView }', async () => {
      const c = makeController();
      const r = await c.me(makeReq('valid'));
      expect(r).toEqual({ ok: true, data: STUB_ME });
    });

    it('200 truyền (userId, seasonKey) → service', async () => {
      const calls: Array<[string, string | undefined]> = [];
      const c = makeController({
        meImpl: async (uid, k) => {
          calls.push([uid, k]);
          return STUB_ME;
        },
      });
      await c.me(makeReq('valid'), 'season_2026_s2');
      expect(calls).toEqual([['u1', 'season_2026_s2']]);
    });
  });

  describe('GET /sect-season/milestones — PUBLIC (Phase 13.2.B)', () => {
    it('200 envelope { ok, data: { milestones } } khi không cookie', () => {
      const c = makeController();
      const r = c.milestones();
      expect(r).toEqual({ ok: true, data: { milestones: STUB_MILESTONES } });
    });
  });

  describe('POST /sect-season/milestones/:key/claim — auth required (Phase 13.2.B)', () => {
    it('401 khi không cookie', async () => {
      const c = makeController();
      await expectHttpError(
        c.claim(makeReq(undefined), 'milestone_bronze', 'season_2026_s2'),
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
      );
    });

    it('400 SEASON_KEY_REQUIRED khi không truyền query seasonKey', async () => {
      const c = makeController();
      await expectHttpError(
        c.claim(makeReq('valid'), 'milestone_bronze', undefined),
        HttpStatus.BAD_REQUEST,
        'SEASON_KEY_REQUIRED',
      );
    });

    it('400 SEASON_KEY_REQUIRED khi seasonKey rỗng', async () => {
      const c = makeController();
      await expectHttpError(
        c.claim(makeReq('valid'), 'milestone_bronze', ''),
        HttpStatus.BAD_REQUEST,
        'SEASON_KEY_REQUIRED',
      );
    });

    it('200 envelope; truyền (userId, seasonKey, milestoneKey)', async () => {
      const calls: Array<[string, string, string]> = [];
      const c = makeController({
        claimImpl: async (uid, sk, mk) => {
          calls.push([uid, sk, mk]);
          return STUB_CLAIM_RESULT;
        },
      });
      const r = await c.claim(makeReq('valid'), 'milestone_bronze', 'season_2026_s2');
      expect(r).toEqual({ ok: true, data: STUB_CLAIM_RESULT });
      expect(calls).toEqual([['u1', 'season_2026_s2', 'milestone_bronze']]);
    });

    const errorCases: Array<
      [
        | 'NO_CHARACTER'
        | 'SEASON_NOT_FOUND'
        | 'SECT_SEASON_MILESTONE_NOT_FOUND'
        | 'SECT_SEASON_NOT_ELIGIBLE'
        | 'SECT_SEASON_ALREADY_CLAIMED',
        number,
      ]
    > = [
      ['NO_CHARACTER', HttpStatus.NOT_FOUND],
      ['SEASON_NOT_FOUND', HttpStatus.NOT_FOUND],
      ['SECT_SEASON_MILESTONE_NOT_FOUND', HttpStatus.NOT_FOUND],
      ['SECT_SEASON_NOT_ELIGIBLE', HttpStatus.BAD_REQUEST],
      ['SECT_SEASON_ALREADY_CLAIMED', HttpStatus.CONFLICT],
    ];
    for (const [code, status] of errorCases) {
      it(`SectSeasonError(${code}) → HTTP ${status}`, async () => {
        const c = makeController({
          claimImpl: async () => {
            throw new SectSeasonError(code);
          },
        });
        await expectHttpError(
          c.claim(makeReq('valid'), 'milestone_bronze', 'season_2026_s2'),
          status,
          code,
        );
      });
    }

    it('non-SectSeasonError → rethrow (KHÔNG bị handleErr nuốt)', async () => {
      const c = makeController({
        claimImpl: async () => {
          throw new Error('boom');
        },
      });
      await expect(
        c.claim(makeReq('valid'), 'milestone_bronze', 'season_2026_s2'),
      ).rejects.toThrow('boom');
    });
  });
});
