import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/api/tribulation', () => ({
  attemptTribulation: vi.fn(),
  fetchAttemptLog: vi.fn(),
  fetchTribulationPreview: vi.fn(),
  TRIBULATION_LOG_DEFAULT_LIMIT: 20,
  TRIBULATION_LOG_MAX_LIMIT: 100,
}));

import * as api from '@/api/tribulation';
import { useTribulationStore } from '@/stores/tribulation';

const mockedAttempt = vi.mocked(api.attemptTribulation);

const STUB_SUCCESS: api.TribulationOutcomeView = {
  success: true,
  tribulationKey: 'kim_dan_to_nguyen_anh',
  fromRealmKey: 'kim_dan',
  toRealmKey: 'nguyen_anh',
  severity: 'major',
  type: 'lei',
  wavesCompleted: 5,
  totalDamage: 1234,
  finalHp: 567,
  attemptIndex: 1,
  reward: {
    linhThach: 1000,
    expBonus: '50000',
    titleKey: 'do_kiep_thanh_cong',
  },
  penalty: null,
  logId: 'log-1',
};

const STUB_FAIL: api.TribulationOutcomeView = {
  success: false,
  tribulationKey: 'kim_dan_to_nguyen_anh',
  fromRealmKey: 'kim_dan',
  toRealmKey: 'nguyen_anh',
  severity: 'major',
  type: 'lei',
  wavesCompleted: 2,
  totalDamage: 999,
  finalHp: 0,
  attemptIndex: 1,
  reward: null,
  penalty: {
    expBefore: '100000',
    expAfter: '50000',
    expLoss: '50000',
    cooldownAt: '2026-05-02T07:00:00.000Z',
    taoMaActive: false,
    taoMaExpiresAt: null,
  },
  logId: 'log-2',
};

describe('useTribulationStore — Phase 11.6.D', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('initial state: lastOutcome null, inFlight false, lastError null', () => {
    const s = useTribulationStore();
    expect(s.lastOutcome).toBeNull();
    expect(s.inFlight).toBe(false);
    expect(s.lastError).toBeNull();
  });

  it('attempt success outcome: lastOutcome populated, success branch, return null', async () => {
    mockedAttempt.mockResolvedValueOnce(STUB_SUCCESS);
    const s = useTribulationStore();
    const err = await s.attempt();
    expect(err).toBeNull();
    expect(s.lastOutcome).not.toBeNull();
    expect(s.lastOutcome?.success).toBe(true);
    expect(s.lastOutcome?.toRealmKey).toBe('nguyen_anh');
    expect(s.lastOutcome?.reward?.linhThach).toBe(1000);
    expect(s.inFlight).toBe(false);
    expect(s.lastError).toBeNull();
  });

  it('attempt fail simulation outcome: lastOutcome populated, fail branch, return null', async () => {
    mockedAttempt.mockResolvedValueOnce(STUB_FAIL);
    const s = useTribulationStore();
    const err = await s.attempt();
    expect(err).toBeNull();
    expect(s.lastOutcome?.success).toBe(false);
    expect(s.lastOutcome?.penalty?.expLoss).toBe('50000');
    expect(s.lastError).toBeNull();
  });

  it('attempt server reject COOLDOWN_ACTIVE: lastError set, return code, lastOutcome unchanged', async () => {
    const s = useTribulationStore();
    s.lastOutcome = STUB_SUCCESS;
    mockedAttempt.mockRejectedValueOnce({ code: 'COOLDOWN_ACTIVE' });
    const err = await s.attempt();
    expect(err).toBe('COOLDOWN_ACTIVE');
    expect(s.lastError).toBe('COOLDOWN_ACTIVE');
    // Previous outcome preserved (not cleared by reject)
    expect(s.lastOutcome).toStrictEqual(STUB_SUCCESS);
  });

  it('attempt nested error.code: extract đúng (axios envelope shape)', async () => {
    mockedAttempt.mockRejectedValueOnce({
      error: { code: 'NOT_AT_PEAK', message: 'not at peak' },
    });
    const s = useTribulationStore();
    const err = await s.attempt();
    expect(err).toBe('NOT_AT_PEAK');
    expect(s.lastError).toBe('NOT_AT_PEAK');
  });

  it('attempt unknown error: trả "UNKNOWN"', async () => {
    mockedAttempt.mockRejectedValueOnce(new Error('boom'));
    const s = useTribulationStore();
    const err = await s.attempt();
    expect(err).toBe('UNKNOWN');
    expect(s.lastError).toBe('UNKNOWN');
  });

  it('attempt double-call → second returns IN_FLIGHT (race protect)', async () => {
    let resolveFn!: (v: api.TribulationOutcomeView) => void;
    mockedAttempt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );
    const s = useTribulationStore();
    const p1 = s.attempt();
    expect(s.inFlight).toBe(true);
    const r2 = await s.attempt();
    expect(r2).toBe('IN_FLIGHT');
    expect(mockedAttempt).toHaveBeenCalledTimes(1);
    resolveFn(STUB_SUCCESS);
    await p1;
    expect(s.inFlight).toBe(false);
  });

  it('clearLastOutcome: reset lastOutcome về null, không động inFlight/lastError', () => {
    const s = useTribulationStore();
    s.lastOutcome = STUB_SUCCESS;
    s.lastError = 'X';
    s.clearLastOutcome();
    expect(s.lastOutcome).toBeNull();
    expect(s.lastError).toBe('X');
  });

  it('reset: clear toàn bộ state', () => {
    const s = useTribulationStore();
    s.lastOutcome = STUB_SUCCESS;
    s.lastError = 'X';
    s.inFlight = true;
    s.reset();
    expect(s.lastOutcome).toBeNull();
    expect(s.lastError).toBeNull();
    expect(s.inFlight).toBe(false);
  });

  it('attempt clear lastError trên start (không inherit error cũ)', async () => {
    const s = useTribulationStore();
    s.lastError = 'OLD_CODE';
    mockedAttempt.mockResolvedValueOnce(STUB_SUCCESS);
    await s.attempt();
    expect(s.lastError).toBeNull();
  });
});

const mockedFetchLog = vi.mocked(api.fetchAttemptLog);

const STUB_LOG_ROW: api.TribulationAttemptLogView = {
  id: 'log-x-1',
  tribulationKey: 'kim_dan_to_nguyen_anh',
  fromRealmKey: 'kim_dan',
  toRealmKey: 'nguyen_anh',
  severity: 'major',
  type: 'lei',
  success: true,
  wavesCompleted: 5,
  totalDamage: 1234,
  finalHp: 567,
  hpInitial: 1000,
  expBefore: '100000',
  expAfter: '150000',
  expLoss: '0',
  taoMaActive: false,
  taoMaExpiresAt: null,
  cooldownAt: null,
  linhThachReward: 1000,
  expBonusReward: '50000',
  titleKeyReward: 'do_kiep_thanh_cong',
  attemptIndex: 1,
  taoMaRoll: 0.5,
  createdAt: '2026-05-02T01:00:00.000Z',
};

describe('useTribulationStore — Phase 11.6.G fetchHistory', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('initial state: history null, historyLoading false, historyError null', () => {
    const s = useTribulationStore();
    expect(s.history).toBeNull();
    expect(s.historyLoading).toBe(false);
    expect(s.historyError).toBeNull();
  });

  it('fetchHistory success → history populated với rows, return null', async () => {
    mockedFetchLog.mockResolvedValueOnce({ rows: [STUB_LOG_ROW], limit: 20 });
    const s = useTribulationStore();
    const err = await s.fetchHistory();
    expect(err).toBeNull();
    expect(s.history).toHaveLength(1);
    expect(s.history?.[0]?.id).toBe('log-x-1');
    expect(s.historyLoading).toBe(false);
    expect(s.historyError).toBeNull();
  });

  it('fetchHistory empty server → history=[]', async () => {
    mockedFetchLog.mockResolvedValueOnce({ rows: [], limit: 20 });
    const s = useTribulationStore();
    await s.fetchHistory();
    expect(s.history).toEqual([]);
  });

  it('fetchHistory(limit=10) → forward limit qua api', async () => {
    mockedFetchLog.mockResolvedValueOnce({ rows: [], limit: 10 });
    const s = useTribulationStore();
    await s.fetchHistory(10);
    expect(mockedFetchLog).toHaveBeenCalledWith(10);
  });

  it('fetchHistory server reject UNAUTHENTICATED → historyError set, return code', async () => {
    mockedFetchLog.mockRejectedValueOnce({ code: 'UNAUTHENTICATED' });
    const s = useTribulationStore();
    const err = await s.fetchHistory();
    expect(err).toBe('UNAUTHENTICATED');
    expect(s.historyError).toBe('UNAUTHENTICATED');
    expect(s.history).toBeNull();
  });

  it('fetchHistory unknown error → trả "UNKNOWN"', async () => {
    mockedFetchLog.mockRejectedValueOnce(new Error('network'));
    const s = useTribulationStore();
    const err = await s.fetchHistory();
    expect(err).toBe('UNKNOWN');
    expect(s.historyError).toBe('UNKNOWN');
  });

  it('fetchHistory double-call → second returns IN_FLIGHT (race protect)', async () => {
    let resolveFn!: (v: {
      rows: api.TribulationAttemptLogView[];
      limit: number;
    }) => void;
    mockedFetchLog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );
    const s = useTribulationStore();
    const p1 = s.fetchHistory();
    expect(s.historyLoading).toBe(true);
    const r2 = await s.fetchHistory();
    expect(r2).toBe('IN_FLIGHT');
    expect(mockedFetchLog).toHaveBeenCalledTimes(1);
    resolveFn({ rows: [], limit: 20 });
    await p1;
    expect(s.historyLoading).toBe(false);
  });

  it('fetchHistory clear historyError trên start', async () => {
    const s = useTribulationStore();
    s.historyError = 'OLD';
    mockedFetchLog.mockResolvedValueOnce({ rows: [], limit: 20 });
    await s.fetchHistory();
    expect(s.historyError).toBeNull();
  });

  it('reset clear history + historyLoading + historyError', () => {
    const s = useTribulationStore();
    s.history = [STUB_LOG_ROW];
    s.historyLoading = true;
    s.historyError = 'X';
    s.reset();
    expect(s.history).toBeNull();
    expect(s.historyLoading).toBe(false);
    expect(s.historyError).toBeNull();
  });
});

// ── Phase 14.3.A — fetchPreview tests ────────────────────────────────────
const mockedFetchPreview = vi.mocked(api.fetchTribulationPreview);

const STUB_PREVIEW: api.TribulationPreviewView = {
  requirement: true,
  fromRealmKey: 'kim_dan',
  toRealmKey: 'nguyen_anh',
  atPeak: true,
  def: {
    key: 'tribulation_kim_dan_nguyen_anh',
    name: 'Tiểu Lôi Kiếp',
    description: 'Lôi kiếp đầu tiên',
    type: 'lei',
    severity: 'minor',
    wavesCount: 3,
  },
  successChance: { base: 0.75, affinity: 0, supports: 0, final: 0.75 },
  supports: [],
  supportTotalBonus: 0,
  rewardHint: { linhThach: 1000, expBonus: '50000', titleKey: null },
  penaltyHint: {
    expLossRatio: 0.1,
    cooldownMinutes: 30,
    taoMaDebuffChance: 0.4,
    taoMaDebuffDurationMinutes: 15,
  },
  cooldownAt: null,
  taoMaUntil: null,
};

describe('useTribulationStore — Phase 14.3.A fetchPreview', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('initial state: preview undefined, previewLoading false, previewError null', () => {
    const s = useTribulationStore();
    expect(s.preview).toBeUndefined();
    expect(s.previewLoading).toBe(false);
    expect(s.previewError).toBeNull();
  });

  it('fetchPreview success → preview populated, return null', async () => {
    mockedFetchPreview.mockResolvedValueOnce(STUB_PREVIEW);
    const s = useTribulationStore();
    const err = await s.fetchPreview();
    expect(err).toBeNull();
    expect(s.preview).not.toBeNull();
    expect(s.preview).not.toBeUndefined();
    expect(s.preview!.def.key).toBe('tribulation_kim_dan_nguyen_anh');
    expect(s.preview!.successChance.final).toBeCloseTo(0.75);
    expect(s.previewLoading).toBe(false);
    expect(s.previewError).toBeNull();
  });

  it('fetchPreview returns null (low-tier) → preview === null, return null', async () => {
    mockedFetchPreview.mockResolvedValueOnce(null);
    const s = useTribulationStore();
    const err = await s.fetchPreview();
    expect(err).toBeNull();
    expect(s.preview).toBeNull();
  });

  it('fetchPreview server reject UNAUTHENTICATED → previewError set, return code', async () => {
    mockedFetchPreview.mockRejectedValueOnce({ code: 'UNAUTHENTICATED' });
    const s = useTribulationStore();
    const err = await s.fetchPreview();
    expect(err).toBe('UNAUTHENTICATED');
    expect(s.previewError).toBe('UNAUTHENTICATED');
    expect(s.preview).toBeUndefined();
  });

  it('fetchPreview unknown error → trả "UNKNOWN"', async () => {
    mockedFetchPreview.mockRejectedValueOnce(new Error('boom'));
    const s = useTribulationStore();
    const err = await s.fetchPreview();
    expect(err).toBe('UNKNOWN');
    expect(s.previewError).toBe('UNKNOWN');
  });

  it('fetchPreview double-call → second returns IN_FLIGHT (race protect)', async () => {
    let resolveFn!: (v: api.TribulationPreviewView | null) => void;
    mockedFetchPreview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );
    const s = useTribulationStore();
    const p1 = s.fetchPreview();
    expect(s.previewLoading).toBe(true);
    const r2 = await s.fetchPreview();
    expect(r2).toBe('IN_FLIGHT');
    expect(mockedFetchPreview).toHaveBeenCalledTimes(1);
    resolveFn(STUB_PREVIEW);
    await p1;
    expect(s.previewLoading).toBe(false);
  });

  it('reset clear preview + previewLoading + previewError', () => {
    const s = useTribulationStore();
    s.preview = STUB_PREVIEW;
    s.previewLoading = true;
    s.previewError = 'X';
    s.reset();
    expect(s.preview).toBeUndefined();
    expect(s.previewLoading).toBe(false);
    expect(s.previewError).toBeNull();
  });
});

/** Phase 11.6.H — pagination "Load more" tests. */
describe('useTribulationStore — Phase 11.6.H pagination', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  function makeRow(id: string): api.TribulationAttemptLogView {
    return { ...STUB_LOG_ROW, id };
  }

  it('initial historyLimit = TRIBULATION_LOG_DEFAULT_LIMIT (20)', () => {
    const s = useTribulationStore();
    expect(s.historyLimit).toBe(20);
  });

  it('historyHasMore=false khi history null', () => {
    const s = useTribulationStore();
    expect(s.historyHasMore).toBe(false);
    expect(s.historyMaxReached).toBe(false);
  });

  it('historyHasMore=false khi rows < historyLimit (server đã trả hết)', async () => {
    mockedFetchLog.mockResolvedValueOnce({ rows: [makeRow('a')], limit: 20 });
    const s = useTribulationStore();
    await s.fetchHistory();
    expect(s.history).toHaveLength(1);
    expect(s.historyLimit).toBe(20);
    expect(s.historyHasMore).toBe(false);
    expect(s.historyMaxReached).toBe(false);
  });

  it('historyHasMore=true khi rows === historyLimit và limit < MAX', async () => {
    const rows = Array.from({ length: 20 }, (_v, i) => makeRow(`r${i}`));
    mockedFetchLog.mockResolvedValueOnce({ rows, limit: 20 });
    const s = useTribulationStore();
    await s.fetchHistory();
    expect(s.history).toHaveLength(20);
    expect(s.historyLimit).toBe(20);
    expect(s.historyHasMore).toBe(true);
    expect(s.historyMaxReached).toBe(false);
  });

  it('historyHasMore=false khi historyLimit đạt MAX (100), historyMaxReached=true khi rows full', async () => {
    const rows = Array.from({ length: 100 }, (_v, i) => makeRow(`r${i}`));
    mockedFetchLog.mockResolvedValueOnce({ rows, limit: 100 });
    const s = useTribulationStore();
    await s.fetchHistory(100);
    expect(s.historyLimit).toBe(100);
    expect(s.historyHasMore).toBe(false);
    expect(s.historyMaxReached).toBe(true);
  });

  it('fetchHistory(limit) clamp [1, MAX] và set historyLimit', async () => {
    mockedFetchLog.mockResolvedValueOnce({ rows: [], limit: 100 });
    const s = useTribulationStore();
    await s.fetchHistory(999_999);
    expect(s.historyLimit).toBe(100);
    expect(mockedFetchLog).toHaveBeenCalledWith(100);
  });

  it('fetchHistory(0) clamp về 1', async () => {
    mockedFetchLog.mockResolvedValueOnce({ rows: [], limit: 1 });
    const s = useTribulationStore();
    await s.fetchHistory(0);
    expect(s.historyLimit).toBe(1);
    expect(mockedFetchLog).toHaveBeenCalledWith(1);
  });

  it('fetchHistory() (no arg) preserve historyLimit hiện tại', async () => {
    const rows = Array.from({ length: 40 }, (_v, i) => makeRow(`r${i}`));
    mockedFetchLog.mockResolvedValueOnce({ rows, limit: 40 });
    const s = useTribulationStore();
    s.historyLimit = 40;
    await s.fetchHistory();
    expect(mockedFetchLog).toHaveBeenLastCalledWith(40);
    expect(s.historyLimit).toBe(40);
  });

  it('loadMoreHistory: tăng historyLimit thêm 20 và re-fetch với limit mới', async () => {
    const rows40 = Array.from({ length: 40 }, (_v, i) => makeRow(`r${i}`));
    mockedFetchLog.mockResolvedValueOnce({ rows: rows40, limit: 40 });
    const s = useTribulationStore();
    s.historyLimit = 20;
    s.history = rows40.slice(0, 20);
    const err = await s.loadMoreHistory();
    expect(err).toBeNull();
    expect(s.historyLimit).toBe(40);
    expect(s.history).toHaveLength(40);
    expect(mockedFetchLog).toHaveBeenLastCalledWith(40);
  });

  it('loadMoreHistory: clamp ở MAX khi tăng vượt 100', async () => {
    const rows100 = Array.from({ length: 100 }, (_v, i) => makeRow(`r${i}`));
    mockedFetchLog.mockResolvedValueOnce({ rows: rows100, limit: 100 });
    const s = useTribulationStore();
    s.historyLimit = 90;
    s.history = rows100.slice(0, 90);
    const err = await s.loadMoreHistory();
    expect(err).toBeNull();
    expect(s.historyLimit).toBe(100);
    expect(mockedFetchLog).toHaveBeenLastCalledWith(100);
  });

  it('loadMoreHistory: trả "MAX_REACHED" khi historyLimit đã = MAX', async () => {
    const s = useTribulationStore();
    s.historyLimit = 100;
    const err = await s.loadMoreHistory();
    expect(err).toBe('MAX_REACHED');
    expect(mockedFetchLog).not.toHaveBeenCalled();
  });

  it('loadMoreHistory: trả "IN_FLIGHT" khi đang fetch', async () => {
    let resolveFn!: (v: {
      rows: api.TribulationAttemptLogView[];
      limit: number;
    }) => void;
    mockedFetchLog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );
    const s = useTribulationStore();
    const p1 = s.fetchHistory();
    expect(s.historyLoading).toBe(true);
    const r2 = await s.loadMoreHistory();
    expect(r2).toBe('IN_FLIGHT');
    expect(mockedFetchLog).toHaveBeenCalledTimes(1);
    resolveFn({ rows: [], limit: 20 });
    await p1;
  });

  it('loadMoreHistory: forward error code từ server', async () => {
    mockedFetchLog.mockRejectedValueOnce({ code: 'NETWORK_ERROR' });
    const s = useTribulationStore();
    s.historyLimit = 20;
    s.history = Array.from({ length: 20 }, (_v, i) => makeRow(`r${i}`));
    const err = await s.loadMoreHistory();
    expect(err).toBe('NETWORK_ERROR');
    expect(s.historyError).toBe('NETWORK_ERROR');
    // historyLimit đã được set lên 40 vì fetchHistory(40) đặt trước try.
    expect(s.historyLimit).toBe(40);
  });

  it('reset: historyLimit về DEFAULT_LIMIT', () => {
    const s = useTribulationStore();
    s.historyLimit = 80;
    s.history = [STUB_LOG_ROW];
    s.reset();
    expect(s.historyLimit).toBe(20);
  });
});

/** Phase 11.6.J — client-side history filter tests. */
describe('useTribulationStore — Phase 11.6.J filter', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  function makeRow(
    id: string,
    success: boolean,
  ): api.TribulationAttemptLogView {
    return { ...STUB_LOG_ROW, id, success };
  }

  it("initial historyFilter = 'all'", () => {
    const s = useTribulationStore();
    expect(s.historyFilter).toBe('all');
  });

  it('filteredHistory=null khi history null (preserve null sentinel)', () => {
    const s = useTribulationStore();
    expect(s.filteredHistory).toBeNull();
  });

  it("filteredHistory='all' trả full rows (không filter)", () => {
    const s = useTribulationStore();
    s.history = [
      makeRow('a', true),
      makeRow('b', false),
      makeRow('c', true),
    ];
    expect(s.historyFilter).toBe('all');
    expect(s.filteredHistory).toHaveLength(3);
  });

  it("filteredHistory='success' chỉ trả rows success=true", () => {
    const s = useTribulationStore();
    s.history = [
      makeRow('a', true),
      makeRow('b', false),
      makeRow('c', true),
      makeRow('d', false),
    ];
    s.setHistoryFilter('success');
    expect(s.filteredHistory).toHaveLength(2);
    expect(s.filteredHistory?.every((r) => r.success === true)).toBe(true);
  });

  it("filteredHistory='fail' chỉ trả rows success=false", () => {
    const s = useTribulationStore();
    s.history = [
      makeRow('a', true),
      makeRow('b', false),
      makeRow('c', true),
      makeRow('d', false),
    ];
    s.setHistoryFilter('fail');
    expect(s.filteredHistory).toHaveLength(2);
    expect(s.filteredHistory?.every((r) => r.success === false)).toBe(true);
  });

  it("filteredHistory='success' khi 0 rows match → empty array (không null)", () => {
    const s = useTribulationStore();
    s.history = [makeRow('a', false), makeRow('b', false)];
    s.setHistoryFilter('success');
    expect(s.filteredHistory).toEqual([]);
  });

  it("setHistoryFilter ignore giá trị invalid (giữ nguyên filter cũ)", () => {
    const s = useTribulationStore();
    s.setHistoryFilter('success');
    expect(s.historyFilter).toBe('success');
    s.setHistoryFilter('garbage' as 'all');
    expect(s.historyFilter).toBe('success');
  });

  it('setHistoryFilter pure local (không trigger fetchAttemptLog)', () => {
    const s = useTribulationStore();
    s.setHistoryFilter('success');
    s.setHistoryFilter('fail');
    s.setHistoryFilter('all');
    expect(mockedFetchLog).not.toHaveBeenCalled();
  });

  it('reset: historyFilter về "all"', () => {
    const s = useTribulationStore();
    s.setHistoryFilter('fail');
    s.history = [makeRow('a', false)];
    s.reset();
    expect(s.historyFilter).toBe('all');
  });

  it("filteredHistory reactive khi historyFilter thay đổi", () => {
    const s = useTribulationStore();
    s.history = [
      makeRow('a', true),
      makeRow('b', false),
      makeRow('c', true),
    ];
    expect(s.filteredHistory).toHaveLength(3);
    s.setHistoryFilter('success');
    expect(s.filteredHistory).toHaveLength(2);
    s.setHistoryFilter('fail');
    expect(s.filteredHistory).toHaveLength(1);
    s.setHistoryFilter('all');
    expect(s.filteredHistory).toHaveLength(3);
  });

  it("filteredHistory reactive khi history thay đổi (mới fetch)", async () => {
    const s = useTribulationStore();
    s.history = [];
    s.setHistoryFilter('success');
    expect(s.filteredHistory).toEqual([]);
    s.history = [makeRow('a', true), makeRow('b', false), makeRow('c', true)];
    expect(s.filteredHistory).toHaveLength(2);
  });
});

/** Phase 11.6.K — history stats summary tests. */
describe('useTribulationStore — Phase 11.6.K stats', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  function makeRow(
    id: string,
    success: boolean,
  ): api.TribulationAttemptLogView {
    return { ...STUB_LOG_ROW, id, success };
  }

  it('historyTotalCount=0 khi history null', () => {
    const s = useTribulationStore();
    expect(s.historyTotalCount).toBe(0);
    expect(s.historySuccessCount).toBe(0);
    expect(s.historyFailCount).toBe(0);
  });

  it('historyTotalCount=0 khi history empty array', () => {
    const s = useTribulationStore();
    s.history = [];
    expect(s.historyTotalCount).toBe(0);
    expect(s.historySuccessCount).toBe(0);
    expect(s.historyFailCount).toBe(0);
  });

  it('counts đúng với mix success/fail', () => {
    const s = useTribulationStore();
    s.history = [
      makeRow('a', true),
      makeRow('b', false),
      makeRow('c', true),
      makeRow('d', false),
      makeRow('e', true),
    ];
    expect(s.historyTotalCount).toBe(5);
    expect(s.historySuccessCount).toBe(3);
    expect(s.historyFailCount).toBe(2);
  });

  it('counts khi all success', () => {
    const s = useTribulationStore();
    s.history = [makeRow('a', true), makeRow('b', true)];
    expect(s.historyTotalCount).toBe(2);
    expect(s.historySuccessCount).toBe(2);
    expect(s.historyFailCount).toBe(0);
  });

  it('counts khi all fail', () => {
    const s = useTribulationStore();
    s.history = [makeRow('a', false), makeRow('b', false), makeRow('c', false)];
    expect(s.historyTotalCount).toBe(3);
    expect(s.historySuccessCount).toBe(0);
    expect(s.historyFailCount).toBe(3);
  });

  it('counts KHÔNG đổi khi historyFilter thay đổi (stats trên FULL list)', () => {
    const s = useTribulationStore();
    s.history = [
      makeRow('a', true),
      makeRow('b', false),
      makeRow('c', true),
    ];
    expect(s.historyTotalCount).toBe(3);
    s.setHistoryFilter('success');
    expect(s.historyTotalCount).toBe(3);
    expect(s.historySuccessCount).toBe(2);
    expect(s.historyFailCount).toBe(1);
    s.setHistoryFilter('fail');
    expect(s.historyTotalCount).toBe(3);
    expect(s.historySuccessCount).toBe(2);
    expect(s.historyFailCount).toBe(1);
  });

  it('counts reactive khi history thay đổi', () => {
    const s = useTribulationStore();
    s.history = [makeRow('a', true)];
    expect(s.historyTotalCount).toBe(1);
    s.history = [
      makeRow('a', true),
      makeRow('b', true),
      makeRow('c', false),
    ];
    expect(s.historyTotalCount).toBe(3);
    expect(s.historySuccessCount).toBe(2);
    expect(s.historyFailCount).toBe(1);
  });

  it('counts về 0 sau reset()', () => {
    const s = useTribulationStore();
    s.history = [makeRow('a', true), makeRow('b', false)];
    expect(s.historyTotalCount).toBe(2);
    s.reset();
    expect(s.historyTotalCount).toBe(0);
    expect(s.historySuccessCount).toBe(0);
    expect(s.historyFailCount).toBe(0);
  });
});
