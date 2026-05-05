import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/api/breakthrough', () => ({
  attemptBreakthrough: vi.fn(),
  fetchAttemptLog: vi.fn(),
  BREAKTHROUGH_LOG_DEFAULT_LIMIT: 20,
  BREAKTHROUGH_LOG_MAX_LIMIT: 100,
}));

import * as api from '@/api/breakthrough';
import { useBreakthroughStore } from '@/stores/breakthrough';

const mockedAttempt = vi.mocked(api.attemptBreakthrough);
const mockedFetch = vi.mocked(api.fetchAttemptLog);

const CHARACTER = { id: 'char-1', realmKey: 'kim_dan', realmStage: 1 };

const STUB_SUCCESS: api.BreakthroughAttemptOutcomeView = {
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
  character: CHARACTER,
};

const STUB_FAIL: api.BreakthroughAttemptOutcomeView = {
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
  character: CHARACTER,
};

function rowFor(
  id: string,
  attemptIndex: number,
  success: boolean,
): api.BreakthroughAttemptLogView {
  return {
    id,
    fromRealmKey: 'truc_co',
    fromRealmStage: 9,
    toRealmKey: success ? 'kim_dan' : 'truc_co',
    toRealmStage: success ? 1 : 9,
    chance: 0.85,
    baseChance: 0.7,
    rootPurityBonus: 0.1,
    methodAffinityBonus: 0.05,
    itemBonus: 0,
    rawChance: 0.85,
    rngRoll: success ? 0.42 : 0.91,
    success,
    expBefore: '500000',
    expAfter: success ? '0' : '500000',
    tamMaActive: !success,
    tamMaExpiresAt: success ? null : '2026-05-04T13:30:00.000Z',
    attemptIndex,
    createdAt: '2026-05-04T12:00:00.000Z',
  };
}

describe('useBreakthroughStore — Phase 11 nâng cao §5 PR3', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('initial state: lastOutcome/history null, inFlight false, no error', () => {
    const s = useBreakthroughStore();
    expect(s.lastOutcome).toBeNull();
    expect(s.history).toBeNull();
    expect(s.inFlight).toBe(false);
    expect(s.lastError).toBeNull();
    expect(s.historyLimit).toBe(20);
    expect(s.historyFilter).toBe('all');
  });

  it('attempt success: lastOutcome populated, return null, inFlight reset', async () => {
    mockedAttempt.mockResolvedValueOnce(STUB_SUCCESS);
    const s = useBreakthroughStore();
    const err = await s.attempt();
    expect(err).toBeNull();
    expect(s.lastOutcome?.success).toBe(true);
    expect(s.lastOutcome?.toRealmKey).toBe('kim_dan');
    expect(s.lastOutcome?.breakdown.finalChance).toBeCloseTo(0.85);
    expect(s.lastOutcome?.debuff.applied).toBe(false);
    expect(s.inFlight).toBe(false);
    expect(s.lastError).toBeNull();
  });

  it('attempt fail (RNG): lastOutcome populated với debuff branch, return null', async () => {
    mockedAttempt.mockResolvedValueOnce(STUB_FAIL);
    const s = useBreakthroughStore();
    const err = await s.attempt();
    expect(err).toBeNull();
    expect(s.lastOutcome?.success).toBe(false);
    expect(s.lastOutcome?.debuff.applied).toBe(true);
    expect(s.lastOutcome?.debuff.key).toBe('tam_ma_light');
    expect(s.lastError).toBeNull();
  });

  it('attempt server-reject (NOT_AT_PEAK): return code, lastOutcome null, lastError set', async () => {
    mockedAttempt.mockRejectedValueOnce({ code: 'NOT_AT_PEAK' });
    const s = useBreakthroughStore();
    const err = await s.attempt();
    expect(err).toBe('NOT_AT_PEAK');
    expect(s.lastOutcome).toBeNull();
    expect(s.lastError).toBe('NOT_AT_PEAK');
    expect(s.inFlight).toBe(false);
  });

  it('attempt envelope error.code shape (axios-style): cũng extract đúng code', async () => {
    mockedAttempt.mockRejectedValueOnce({ error: { code: 'UNAUTHENTICATED' } });
    const s = useBreakthroughStore();
    const err = await s.attempt();
    expect(err).toBe('UNAUTHENTICATED');
    expect(s.lastError).toBe('UNAUTHENTICATED');
  });

  it('attempt unknown error → fallback UNKNOWN code', async () => {
    mockedAttempt.mockRejectedValueOnce(new Error('network blew up'));
    const s = useBreakthroughStore();
    const err = await s.attempt();
    expect(err).toBe('UNKNOWN');
    expect(s.lastError).toBe('UNKNOWN');
  });

  it('attempt re-entry while inFlight: return IN_FLIGHT, không gọi api lần 2', async () => {
    let resolve!: (v: api.BreakthroughAttemptOutcomeView) => void;
    mockedAttempt.mockImplementationOnce(
      () => new Promise((r) => { resolve = r; }),
    );
    const s = useBreakthroughStore();
    const p1 = s.attempt();
    const err2 = await s.attempt();
    expect(err2).toBe('IN_FLIGHT');
    expect(mockedAttempt).toHaveBeenCalledTimes(1);
    resolve(STUB_SUCCESS);
    await p1;
  });

  it('clearLastOutcome xoá lastOutcome', async () => {
    mockedAttempt.mockResolvedValueOnce(STUB_SUCCESS);
    const s = useBreakthroughStore();
    await s.attempt();
    expect(s.lastOutcome).not.toBeNull();
    s.clearLastOutcome();
    expect(s.lastOutcome).toBeNull();
  });

  it('fetchHistory success: history populated, error null', async () => {
    mockedFetch.mockResolvedValueOnce({
      rows: [rowFor('a', 2, true), rowFor('b', 1, false)],
      limit: 20,
    });
    const s = useBreakthroughStore();
    const err = await s.fetchHistory();
    expect(err).toBeNull();
    expect(s.history).toHaveLength(2);
    expect(s.historyLoading).toBe(false);
    expect(s.historyError).toBeNull();
    expect(mockedFetch).toHaveBeenCalledWith(20);
  });

  it('fetchHistory với limit clamp về [1, MAX]', async () => {
    mockedFetch.mockResolvedValueOnce({ rows: [], limit: 100 });
    const s = useBreakthroughStore();
    await s.fetchHistory(999_999);
    expect(s.historyLimit).toBe(100);
    expect(mockedFetch).toHaveBeenCalledWith(100);
  });

  it('fetchHistory với limit ≤ 0 clamp về 1', async () => {
    mockedFetch.mockResolvedValueOnce({ rows: [], limit: 1 });
    const s = useBreakthroughStore();
    await s.fetchHistory(-5);
    expect(s.historyLimit).toBe(1);
  });

  it('fetchHistory error (UNAUTHENTICATED) → return code, historyError set', async () => {
    mockedFetch.mockRejectedValueOnce({ code: 'UNAUTHENTICATED' });
    const s = useBreakthroughStore();
    const err = await s.fetchHistory();
    expect(err).toBe('UNAUTHENTICATED');
    expect(s.history).toBeNull();
    expect(s.historyError).toBe('UNAUTHENTICATED');
  });

  it('loadMoreHistory: tăng limit thêm DEFAULT, refetch', async () => {
    mockedFetch
      .mockResolvedValueOnce({ rows: Array.from({ length: 20 }, (_, i) => rowFor(String(i), i, i % 2 === 0)), limit: 20 })
      .mockResolvedValueOnce({ rows: Array.from({ length: 40 }, (_, i) => rowFor(String(i), i, i % 2 === 0)), limit: 40 });
    const s = useBreakthroughStore();
    await s.fetchHistory();
    expect(s.historyLimit).toBe(20);
    expect(s.history).toHaveLength(20);
    const err = await s.loadMoreHistory();
    expect(err).toBeNull();
    expect(s.historyLimit).toBe(40);
    expect(s.history).toHaveLength(40);
  });

  it('loadMoreHistory: MAX_REACHED khi đã ở MAX limit', async () => {
    mockedFetch.mockResolvedValueOnce({ rows: [], limit: 100 });
    const s = useBreakthroughStore();
    await s.fetchHistory(100);
    expect(s.historyLimit).toBe(100);
    const err = await s.loadMoreHistory();
    expect(err).toBe('MAX_REACHED');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('historyHasMore: true khi rows full + limit < MAX', async () => {
    mockedFetch.mockResolvedValueOnce({
      rows: Array.from({ length: 20 }, (_, i) => rowFor(String(i), i, true)),
      limit: 20,
    });
    const s = useBreakthroughStore();
    await s.fetchHistory();
    expect(s.historyHasMore).toBe(true);
    expect(s.historyMaxReached).toBe(false);
  });

  it('historyHasMore: false khi rows < limit (server đã trả hết)', async () => {
    mockedFetch.mockResolvedValueOnce({
      rows: [rowFor('a', 1, true)],
      limit: 20,
    });
    const s = useBreakthroughStore();
    await s.fetchHistory();
    expect(s.historyHasMore).toBe(false);
  });

  it('historyMaxReached: true khi limit MAX + rows lấp đầy', async () => {
    mockedFetch.mockResolvedValueOnce({
      rows: Array.from({ length: 100 }, (_, i) => rowFor(String(i), i, true)),
      limit: 100,
    });
    const s = useBreakthroughStore();
    await s.fetchHistory(100);
    expect(s.historyMaxReached).toBe(true);
    expect(s.historyHasMore).toBe(false);
  });

  it('filteredHistory: all giữ nguyên, success/fail filter đúng', async () => {
    mockedFetch.mockResolvedValueOnce({
      rows: [rowFor('a', 3, true), rowFor('b', 2, false), rowFor('c', 1, true)],
      limit: 20,
    });
    const s = useBreakthroughStore();
    await s.fetchHistory();
    expect(s.filteredHistory).toHaveLength(3);
    s.setHistoryFilter('success');
    expect(s.filteredHistory).toHaveLength(2);
    expect(s.filteredHistory?.every((r) => r.success)).toBe(true);
    s.setHistoryFilter('fail');
    expect(s.filteredHistory).toHaveLength(1);
    expect(s.filteredHistory?.[0].id).toBe('b');
    s.setHistoryFilter('all');
    expect(s.filteredHistory).toHaveLength(3);
  });

  it('setHistoryFilter ignore invalid value', () => {
    const s = useBreakthroughStore();
    expect(s.historyFilter).toBe('all');
    // @ts-expect-error invalid filter value
    s.setHistoryFilter('xxx');
    expect(s.historyFilter).toBe('all');
  });

  it('history counts: total/success/fail tính trên FULL list (không bị filter ảnh hưởng)', async () => {
    mockedFetch.mockResolvedValueOnce({
      rows: [rowFor('a', 3, true), rowFor('b', 2, false), rowFor('c', 1, true)],
      limit: 20,
    });
    const s = useBreakthroughStore();
    await s.fetchHistory();
    expect(s.historyTotalCount).toBe(3);
    expect(s.historySuccessCount).toBe(2);
    expect(s.historyFailCount).toBe(1);
    s.setHistoryFilter('fail');
    expect(s.historyTotalCount).toBe(3);
    expect(s.historySuccessCount).toBe(2);
    expect(s.historyFailCount).toBe(1);
  });

  it('reset: clear toàn bộ state về initial', async () => {
    mockedAttempt.mockResolvedValueOnce(STUB_SUCCESS);
    mockedFetch.mockResolvedValueOnce({
      rows: [rowFor('a', 1, true)],
      limit: 50,
    });
    const s = useBreakthroughStore();
    await s.attempt();
    await s.fetchHistory(50);
    s.setHistoryFilter('success');
    s.reset();
    expect(s.lastOutcome).toBeNull();
    expect(s.history).toBeNull();
    expect(s.historyLimit).toBe(20);
    expect(s.historyFilter).toBe('all');
    expect(s.lastError).toBeNull();
  });
});
