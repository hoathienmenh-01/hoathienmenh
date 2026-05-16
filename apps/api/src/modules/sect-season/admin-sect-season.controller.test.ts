/**
 * Phase 15.8 — Pure-unit tests cho `AdminSectSeasonController`.
 *
 * Mock `SectSeasonHistoryService` → assert envelope shape + HttpException
 * mapping. Guard wiring (AdminGuard + @RequireAdmin) đã được cover trong
 * `admin.guard.spec.ts` ở module Admin.
 *
 * Lock-in invariants:
 *   1. 400 SEASON_KEY_REQUIRED nếu param rỗng.
 *   2. 404 CHAMPION_SNAPSHOT_NOT_FOUND map từ `SectSeasonHistoryError`.
 *   3. 200 envelope { ok: true, data: SectSeasonChampionSnapshotDetail }.
 *   4. Non-history error → rethrow nguyên (KHÔNG nuốt).
 */
import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { AdminSectSeasonController } from './admin-sect-season.controller';
import {
  type SectSeasonChampionSnapshotDetail,
  SectSeasonHistoryError,
  type SectSeasonHistoryService,
} from './sect-season-history.service';

const STUB_SNAPSHOT: SectSeasonChampionSnapshotDetail = {
  seasonKey: 'season_2026_s1',
  sectId: 'sect_alpha',
  rank: 1,
  memberCount: 3,
  memberCharacterIds: ['char_a', 'char_b', 'char_c'],
  createdAt: '2026-04-27T00:15:00.000Z',
};

function makeController(opts: {
  getImpl?: (k: string) => Promise<SectSeasonChampionSnapshotDetail>;
}) {
  const history = {
    getChampionSnapshot:
      opts.getImpl ?? (async () => STUB_SNAPSHOT),
  } as unknown as SectSeasonHistoryService;
  return new AdminSectSeasonController(history);
}

async function expectHttpError(
  p: Promise<unknown>,
  status: number,
  code: string,
) {
  try {
    await p;
    throw new Error('expected throw');
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    const err = e as HttpException;
    expect(err.getStatus()).toBe(status);
    expect(err.getResponse()).toMatchObject({
      ok: false,
      error: { code },
    });
  }
}

describe('AdminSectSeasonController.championSnapshot', () => {
  it('200 envelope { ok, data } khi snapshot tồn tại', async () => {
    const calls: string[] = [];
    const c = makeController({
      getImpl: async (k) => {
        calls.push(k);
        return STUB_SNAPSHOT;
      },
    });
    const r = await c.championSnapshot('season_2026_s1');
    expect(r).toEqual({ ok: true, data: STUB_SNAPSHOT });
    expect(calls).toEqual(['season_2026_s1']);
  });

  it('400 SEASON_KEY_REQUIRED khi param rỗng', async () => {
    const c = makeController({});
    await expectHttpError(
      c.championSnapshot(''),
      HttpStatus.BAD_REQUEST,
      'SEASON_KEY_REQUIRED',
    );
  });

  it('404 CHAMPION_SNAPSHOT_NOT_FOUND khi service throw', async () => {
    const c = makeController({
      getImpl: async () => {
        throw new SectSeasonHistoryError('CHAMPION_SNAPSHOT_NOT_FOUND');
      },
    });
    await expectHttpError(
      c.championSnapshot('season_2026_s1'),
      HttpStatus.NOT_FOUND,
      'CHAMPION_SNAPSHOT_NOT_FOUND',
    );
  });

  it('non-history error → rethrow nguyên', async () => {
    const c = makeController({
      getImpl: async () => {
        throw new Error('boom');
      },
    });
    await expect(c.championSnapshot('season_2026_s1')).rejects.toThrow(
      'boom',
    );
  });

  it('snapshot empty members → vẫn trả 200 data với memberCount=0', async () => {
    const empty: SectSeasonChampionSnapshotDetail = {
      ...STUB_SNAPSHOT,
      memberCount: 0,
      memberCharacterIds: [],
    };
    const c = makeController({ getImpl: async () => empty });
    const r = await c.championSnapshot('season_2026_s_zero');
    expect(r.data.memberCount).toBe(0);
    expect(r.data.memberCharacterIds).toEqual([]);
  });
});
