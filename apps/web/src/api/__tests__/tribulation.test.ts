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
  attemptTribulation,
  fetchAttemptLog,
  TRIBULATION_LOG_DEFAULT_LIMIT,
  TRIBULATION_LOG_MAX_LIMIT,
  type TribulationAttemptLogView,
  type TribulationOutcomeView,
} from '@/api/tribulation';

const STUB_SUCCESS_OUTCOME: TribulationOutcomeView = {
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
  consumedSupportItems: [],
  supportTotalBonus: 0,
  successChance: {
    base: 0.7,
    supportBonus: 0,
    elementAdjustment: 0,
    raw: 0.7,
    final: 0.7,
    floorHit: false,
    ceilHit: false,
  },
};

const STUB_FAIL_OUTCOME: TribulationOutcomeView = {
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
    taoMaActive: true,
    taoMaExpiresAt: '2026-05-02T08:00:00.000Z',
  },
  logId: 'log-2',
  consumedSupportItems: [],
  supportTotalBonus: 0,
  successChance: {
    base: 0.7,
    supportBonus: 0,
    elementAdjustment: 0,
    raw: 0.7,
    final: 0.7,
    floorHit: false,
    ceilHit: false,
  },
};

describe('api/tribulation — Phase 11.6.D client', () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it('attemptTribulation: POST /character/tribulation với body rỗng + parse success outcome', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: { tribulation: STUB_SUCCESS_OUTCOME },
      },
    });
    const out = await attemptTribulation();
    expect(postMock).toHaveBeenCalledWith('/character/tribulation', {});
    expect(out.success).toBe(true);
    expect(out.fromRealmKey).toBe('kim_dan');
    expect(out.toRealmKey).toBe('nguyen_anh');
    expect(out.reward?.linhThach).toBe(1000);
    expect(out.reward?.expBonus).toBe('50000');
    expect(out.penalty).toBeNull();
  });

  it('attemptTribulation: parse fail outcome với penalty branch', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: { tribulation: STUB_FAIL_OUTCOME },
      },
    });
    const out = await attemptTribulation();
    expect(out.success).toBe(false);
    expect(out.reward).toBeNull();
    expect(out.penalty?.expLoss).toBe('50000');
    expect(out.penalty?.cooldownAt).toBe('2026-05-02T07:00:00.000Z');
    expect(out.penalty?.taoMaActive).toBe(true);
    expect(out.penalty?.taoMaExpiresAt).toBe('2026-05-02T08:00:00.000Z');
  });

  it('attemptTribulation: server reject (NOT_AT_PEAK) → throws preserving code', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: false,
        error: { code: 'NOT_AT_PEAK', message: 'not at peak' },
      },
    });
    await expect(attemptTribulation()).rejects.toMatchObject({
      code: 'NOT_AT_PEAK',
    });
  });

  it('attemptTribulation: server reject (COOLDOWN_ACTIVE) → throws preserving code', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: false,
        error: { code: 'COOLDOWN_ACTIVE', message: 'cooldown' },
      },
    });
    await expect(attemptTribulation()).rejects.toMatchObject({
      code: 'COOLDOWN_ACTIVE',
    });
  });

  it('attemptTribulation: empty data → throws fallback Error', async () => {
    postMock.mockResolvedValueOnce({ data: { ok: true } });
    await expect(attemptTribulation()).rejects.toBeInstanceOf(Error);
  });
});

const STUB_LOG_ROW: TribulationAttemptLogView = {
  id: 'log-1',
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

describe('api/tribulation — Phase 11.6.G fetchAttemptLog', () => {
  beforeEach(() => {
    postMock.mockReset();
    getMock.mockReset();
  });

  it('fetchAttemptLog (no arg) → GET /character/tribulation/log không query', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: { rows: [STUB_LOG_ROW], limit: 20 },
      },
    });
    const out = await fetchAttemptLog();
    expect(getMock).toHaveBeenCalledWith('/character/tribulation/log');
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.id).toBe('log-1');
    expect(out.limit).toBe(20);
  });

  it('fetchAttemptLog(5) → GET với ?limit=5', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: { rows: [], limit: 5 },
      },
    });
    await fetchAttemptLog(5);
    expect(getMock).toHaveBeenCalledWith('/character/tribulation/log?limit=5');
  });

  it('fetchAttemptLog(0) → GET với ?limit=0 (server clamp)', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: { rows: [], limit: 1 },
      },
    });
    await fetchAttemptLog(0);
    // Client KHÔNG clamp — server-authoritative clamp về [1, MAX]
    expect(getMock).toHaveBeenCalledWith('/character/tribulation/log?limit=0');
  });

  it('fetchAttemptLog: empty rows → trả về rows=[]', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: true,
        data: { rows: [], limit: 20 },
      },
    });
    const out = await fetchAttemptLog();
    expect(out.rows).toEqual([]);
  });

  it('fetchAttemptLog: server reject (UNAUTHENTICATED) → throws preserving code', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        ok: false,
        error: { code: 'UNAUTHENTICATED', message: 'Need login' },
      },
    });
    await expect(fetchAttemptLog()).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('fetchAttemptLog: empty data → throws fallback Error', async () => {
    getMock.mockResolvedValueOnce({ data: { ok: true } });
    await expect(fetchAttemptLog()).rejects.toBeInstanceOf(Error);
  });

  it('TRIBULATION_LOG constants match server defaults', () => {
    expect(TRIBULATION_LOG_DEFAULT_LIMIT).toBe(20);
    expect(TRIBULATION_LOG_MAX_LIMIT).toBe(100);
  });
});

// ── Phase 14.3.D — Encounter API client tests ──────────────────────────────

import {
  fetchTribulationEncounterCurrent,
  startTribulationEncounter,
  resolveTribulationEncounter,
  type TribulationEncounterCurrentView,
  type TribulationEncounterRowView,
} from '@/api/tribulation';

const STUB_ENCOUNTER_VIEW: TribulationEncounterCurrentView = {
  requirement: true,
  atPeak: true,
  fromRealmKey: 'kim_dan',
  toRealmKey: 'nguyen_anh',
  tribulationKey: 'kim_dan_to_nguyen_anh',
  severity: 'minor',
  type: 'lei',
  encounter: {
    key: 'tribulation_encounter_hoa',
    element: 'hoa',
    effectType: 'BURST',
    name: 'Hỏa Kiếp',
    description: 'desc',
    difficulty: 'minor',
    phaseCount: 3,
    successThreshold: 0.6,
    requiredPowerHint: 5000,
    failPenaltyMultiplier: 1.0,
    rewardHintMultiplier: 1.0,
    playerHpMax: 10000,
    playerPrimaryElement: null,
    elementAdvantage: 0,
  },
  successChance: {
    base: 0.7,
    supportBonus: 0,
    elementAdjustment: 0,
    raw: 0.7,
    final: 0.7,
    floorHit: false,
    ceilHit: false,
  },
  pending: null,
  cooldownAt: null,
  taoMaUntil: null,
};

const STUB_ENCOUNTER_ROW: TribulationEncounterRowView = {
  id: 'enc-1',
  tribulationKey: 'kim_dan_to_nguyen_anh',
  fromRealmKey: 'kim_dan',
  toRealmKey: 'nguyen_anh',
  encounterKey: 'tribulation_encounter_hoa',
  effectType: 'BURST',
  element: 'hoa',
  difficulty: 'minor',
  selectedSupportItemKeys: [],
  state: 'pending',
  startedAt: '2026-06-11T00:00:00.000Z',
  resolvedAt: null,
  resolvedAttemptLogId: null,
};

describe('fetchTribulationEncounterCurrent / start / resolve (Phase 14.3.D)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetchTribulationEncounterCurrent: GET /character/tribulation/encounter/current trả encounter view', async () => {
    getMock.mockResolvedValueOnce({
      data: { ok: true, data: { encounter: STUB_ENCOUNTER_VIEW } },
    });
    const res = await fetchTribulationEncounterCurrent();
    expect(getMock).toHaveBeenCalledWith(
      '/character/tribulation/encounter/current',
    );
    expect(res).toEqual(STUB_ENCOUNTER_VIEW);
  });

  it('fetchTribulationEncounterCurrent: trả null khi server trả null', async () => {
    getMock.mockResolvedValueOnce({
      data: { ok: true, data: { encounter: null } },
    });
    const res = await fetchTribulationEncounterCurrent();
    expect(res).toBeNull();
  });

  it('startTribulationEncounter: POST với selectedSupportItemKeys', async () => {
    postMock.mockResolvedValueOnce({
      data: { ok: true, data: { encounter: STUB_ENCOUNTER_ROW } },
    });
    const res = await startTribulationEncounter(['thuan_kiep_dan']);
    expect(postMock).toHaveBeenCalledWith(
      '/character/tribulation/encounter/start',
      { selectedSupportItemKeys: ['thuan_kiep_dan'] },
    );
    expect(res).toEqual(STUB_ENCOUNTER_ROW);
  });

  it('startTribulationEncounter: POST không kèm body khi không chọn items', async () => {
    postMock.mockResolvedValueOnce({
      data: { ok: true, data: { encounter: STUB_ENCOUNTER_ROW } },
    });
    await startTribulationEncounter();
    expect(postMock).toHaveBeenCalledWith(
      '/character/tribulation/encounter/start',
      {},
    );
  });

  it('resolveTribulationEncounter: POST trả TribulationOutcomeView', async () => {
    postMock.mockResolvedValueOnce({
      data: { ok: true, data: { tribulation: STUB_SUCCESS_OUTCOME } },
    });
    const res = await resolveTribulationEncounter();
    expect(postMock).toHaveBeenCalledWith(
      '/character/tribulation/encounter/resolve',
      {},
    );
    expect(res).toEqual(STUB_SUCCESS_OUTCOME);
  });

  it('resolveTribulationEncounter: throws server error', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        ok: false,
        error: { code: 'NO_PENDING_ENCOUNTER', message: 'no encounter' },
      },
    });
    await expect(resolveTribulationEncounter()).rejects.toMatchObject({
      code: 'NO_PENDING_ENCOUNTER',
    });
  });
});
