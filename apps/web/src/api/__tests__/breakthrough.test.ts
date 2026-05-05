import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/i18n', () => ({
  i18n: {
    global: {
      t: (k: string) => k,
    },
  },
}));

const { postMock, getMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  getMock: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  apiClient: {
    post: postMock,
    get: getMock,
  },
}));

import {
  attemptBreakthrough,
  fetchAttemptLog,
  BREAKTHROUGH_LOG_DEFAULT_LIMIT,
  BREAKTHROUGH_LOG_MAX_LIMIT,
  type BreakthroughAttemptLogView,
  type BreakthroughAttemptOutcomeView,
} from '@/api/breakthrough';

const STUB_CHARACTER_PAYLOAD = { id: 'char-1', realmKey: 'kim_dan', realmStage: 1 };

const STUB_SUCCESS_OUTCOME: BreakthroughAttemptOutcomeView = {
  success: true,
  fromRealmKey: 'truc_co',
  fromRealmStage: 9,
  toRealmKey: 'kim_dan',
  toRealmStage: 1,
  breakdown: {
    reason: 'all',
    baseChance: 0.7,
    rootPurityBonus: 0.1,
    methodAffinityBonus: 0.05,
    itemBonus: 0,
    rawChance: 0.85,
    finalChance: 0.85,
  },
  rngRoll: 0.42,
  attemptIndex: 1,
  logId: 'btlog-1',
  debuff: { applied: false, key: null, expiresAt: null },
  character: STUB_CHARACTER_PAYLOAD,
};

const STUB_FAIL_OUTCOME: BreakthroughAttemptOutcomeView = {
  success: false,
  fromRealmKey: 'truc_co',
  fromRealmStage: 9,
  toRealmKey: 'truc_co',
  toRealmStage: 9,
  breakdown: {
    reason: 'all',
    baseChance: 0.7,
    rootPurityBonus: 0.05,
    methodAffinityBonus: 0,
    itemBonus: 0,
    rawChance: 0.75,
    finalChance: 0.75,
  },
  rngRoll: 0.91,
  attemptIndex: 2,
  logId: 'btlog-2',
  debuff: {
    applied: true,
    key: 'tam_ma_light',
    expiresAt: '2026-05-04T13:30:00.000Z',
  },
  character: STUB_CHARACTER_PAYLOAD,
};

const STUB_LOG_ROW: BreakthroughAttemptLogView = {
  id: 'btlog-1',
  fromRealmKey: 'truc_co',
  fromRealmStage: 9,
  toRealmKey: 'kim_dan',
  toRealmStage: 1,
  chance: 0.85,
  baseChance: 0.7,
  rootPurityBonus: 0.1,
  methodAffinityBonus: 0.05,
  itemBonus: 0,
  rawChance: 0.85,
  rngRoll: 0.42,
  success: true,
  expBefore: '500000',
  expAfter: '0',
  tamMaActive: false,
  tamMaExpiresAt: null,
  attemptIndex: 1,
  createdAt: '2026-05-04T12:00:00.000Z',
};

describe('api/breakthrough — Phase 11 nâng cao §5 PR3 client', () => {
  beforeEach(() => {
    postMock.mockReset();
    getMock.mockReset();
  });

  it('attemptBreakthrough: POST /character/breakthrough/attempt body rỗng + parse success outcome', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: { outcome: STUB_SUCCESS_OUTCOME },
      },
    });
    const out = await attemptBreakthrough();
    expect(postMock).toHaveBeenCalledWith('/character/breakthrough/attempt', {});
    expect(out.success).toBe(true);
    expect(out.fromRealmKey).toBe('truc_co');
    expect(out.toRealmKey).toBe('kim_dan');
    expect(out.breakdown.finalChance).toBeCloseTo(0.85);
    expect(out.rngRoll).toBeCloseTo(0.42);
    expect(out.debuff.applied).toBe(false);
    expect(out.debuff.key).toBeNull();
    expect(out.attemptIndex).toBe(1);
  });

  it('attemptBreakthrough: parse fail outcome với debuff branch (tam_ma_light)', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: { outcome: STUB_FAIL_OUTCOME },
      },
    });
    const out = await attemptBreakthrough();
    expect(out.success).toBe(false);
    expect(out.debuff.applied).toBe(true);
    expect(out.debuff.key).toBe('tam_ma_light');
    expect(out.debuff.expiresAt).toBe('2026-05-04T13:30:00.000Z');
    expect(out.breakdown.rawChance).toBeCloseTo(0.75);
  });

  it('attemptBreakthrough: throw envelope error khi server reject (NOT_AT_PEAK)', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: false,
        error: { code: 'NOT_AT_PEAK', message: 'Not at peak' },
      },
    });
    await expect(attemptBreakthrough()).rejects.toMatchObject({
      code: 'NOT_AT_PEAK',
    });
  });

  it('attemptBreakthrough: throw fallback error khi data vắng', async () => {
    postMock.mockResolvedValueOnce({ data: { ok: true } });
    await expect(attemptBreakthrough()).rejects.toThrow('common.apiFallback.breakthrough');
  });

  it('fetchAttemptLog: GET /character/breakthrough/log không kèm limit khi omit', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: { rows: [STUB_LOG_ROW], limit: 20 },
      },
    });
    const res = await fetchAttemptLog();
    expect(getMock).toHaveBeenCalledWith('/character/breakthrough/log');
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].id).toBe('btlog-1');
    expect(res.limit).toBe(20);
  });

  it('fetchAttemptLog: GET với ?limit=N khi provided', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: { rows: [], limit: 50 },
      },
    });
    await fetchAttemptLog(50);
    expect(getMock).toHaveBeenCalledWith('/character/breakthrough/log?limit=50');
  });

  it('fetchAttemptLog: parse rows với BigInt-as-string + ISO date string', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: { rows: [STUB_LOG_ROW], limit: 20 },
      },
    });
    const res = await fetchAttemptLog();
    expect(typeof res.rows[0].expBefore).toBe('string');
    expect(typeof res.rows[0].expAfter).toBe('string');
    expect(typeof res.rows[0].createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(res.rows[0].createdAt))).toBe(false);
  });

  it('fetchAttemptLog: throw envelope error khi server reject (UNAUTHENTICATED)', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: false,
        error: { code: 'UNAUTHENTICATED', message: 'Session expired' },
      },
    });
    await expect(fetchAttemptLog()).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('exposes pagination constants matching server BREAKTHROUGH_LOG defaults', () => {
    expect(BREAKTHROUGH_LOG_DEFAULT_LIMIT).toBe(20);
    expect(BREAKTHROUGH_LOG_MAX_LIMIT).toBe(100);
  });
});
