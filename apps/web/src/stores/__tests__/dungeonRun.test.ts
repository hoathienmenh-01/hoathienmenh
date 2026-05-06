import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const fetchDungeonRunListMock = vi.fn();
const startDungeonRunMock = vi.fn();
const nextDungeonEncounterMock = vi.fn();
const claimDungeonRunMock = vi.fn();

vi.mock('@/api/dungeonRun', () => ({
  fetchDungeonRunList: (...a: unknown[]) => fetchDungeonRunListMock(...a),
  startDungeonRun: (...a: unknown[]) => startDungeonRunMock(...a),
  nextDungeonEncounter: (...a: unknown[]) => nextDungeonEncounterMock(...a),
  claimDungeonRun: (...a: unknown[]) => claimDungeonRunMock(...a),
}));

import { useDungeonRunStore } from '@/stores/dungeonRun';
import type {
  DungeonAvailabilityView,
  DungeonClaimResult,
  DungeonRunStatus,
  DungeonRunView,
  DungeonLockReason,
} from '@/api/dungeonRun';

function buildAvailability(
  partial: Partial<DungeonAvailabilityView> & { key: string },
): DungeonAvailabilityView {
  return {
    dungeon: {
      key: partial.key,
      name: partial.dungeon?.name ?? `Dungeon ${partial.key}`,
      description: partial.dungeon?.description ?? '',
      recommendedRealm: partial.dungeon?.recommendedRealm ?? 'phamnhan',
      monsters: partial.dungeon?.monsters ?? ['son_thu_lon'],
      staminaEntry: partial.dungeon?.staminaEntry ?? 5,
      element: partial.dungeon?.element ?? null,
      regionKey: partial.dungeon?.regionKey ?? 'son_coc',
      dailyLimit: partial.dungeon?.dailyLimit,
      runReward: partial.dungeon?.runReward,
    },
    unlocked: partial.unlocked ?? true,
    startable: partial.startable ?? true,
    staminaShort: partial.staminaShort ?? false,
    dailyUsed: partial.dailyUsed ?? 0,
    dailyLimit: partial.dailyLimit ?? null,
    lockReason: (partial.lockReason ?? null) as DungeonLockReason,
  };
}

function buildRun(
  partial: Partial<DungeonRunView> & { id: string; status: DungeonRunStatus },
): DungeonRunView {
  return {
    id: partial.id,
    templateKey: partial.templateKey ?? 'son_coc_normal',
    status: partial.status,
    encounterIndex: partial.encounterIndex ?? 0,
    totalEncounters: partial.totalEncounters ?? 3,
    currentMonster: partial.currentMonster ?? null,
    killedMonsters: partial.killedMonsters ?? [],
    startedAt: partial.startedAt ?? '2026-05-06T00:00:00.000Z',
    completedAt: partial.completedAt ?? null,
    claimedAt: partial.claimedAt ?? null,
    reward: partial.reward ?? { linhThach: 100, exp: 50 },
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  fetchDungeonRunListMock.mockReset();
  startDungeonRunMock.mockReset();
  nextDungeonEncounterMock.mockReset();
  claimDungeonRunMock.mockReset();
});

describe('useDungeonRunStore.load', () => {
  it('happy path → available + activeRun set, loaded=true', async () => {
    const av = [buildAvailability({ key: 'son_coc_normal' })];
    const run = buildRun({ id: 'r1', status: 'ACTIVE' });
    fetchDungeonRunListMock.mockResolvedValue({
      available: av,
      activeRun: run,
    });
    const s = useDungeonRunStore();
    await s.load();
    expect(s.available).toEqual(av);
    expect(s.activeRun).toEqual(run);
    expect(s.loaded).toBe(true);
    expect(s.lastError).toBeNull();
    expect(s.totalCount).toBe(1);
    expect(s.hasActiveRun).toBe(true);
  });

  it('error path (envelope code) → lastError = code', async () => {
    fetchDungeonRunListMock.mockRejectedValue({ code: 'NO_CHARACTER' });
    const s = useDungeonRunStore();
    await s.load();
    expect(s.lastError).toBe('NO_CHARACTER');
    expect(s.loaded).toBe(false);
    expect(s.available).toEqual([]);
    expect(s.activeRun).toBeNull();
  });

  it('unknown error → fallback UNKNOWN_ERROR', async () => {
    fetchDungeonRunListMock.mockRejectedValue(new Error('weird'));
    const s = useDungeonRunStore();
    await s.load();
    expect(s.lastError).toBe('UNKNOWN_ERROR');
  });
});

describe('useDungeonRunStore counters', () => {
  it('startableCount đúng theo flag startable', async () => {
    fetchDungeonRunListMock.mockResolvedValue({
      available: [
        buildAvailability({ key: 'a', startable: true }),
        buildAvailability({ key: 'b', startable: false, lockReason: 'LOCKED_REALM' }),
        buildAvailability({ key: 'c', startable: true }),
      ],
      activeRun: null,
    });
    const s = useDungeonRunStore();
    await s.load();
    expect(s.totalCount).toBe(3);
    expect(s.startableCount).toBe(2);
  });

  it('isRunCompleted + isRunClaimable đúng theo status + claimedAt', async () => {
    const completedRun = buildRun({
      id: 'r1',
      status: 'COMPLETED',
      claimedAt: null,
    });
    fetchDungeonRunListMock.mockResolvedValue({
      available: [],
      activeRun: completedRun,
    });
    const s = useDungeonRunStore();
    await s.load();
    expect(s.isRunCompleted).toBe(true);
    expect(s.isRunClaimable).toBe(true);
  });

  it('isRunClaimable=false khi đã CLAIMED', async () => {
    const claimedRun = buildRun({
      id: 'r1',
      status: 'CLAIMED',
      claimedAt: '2026-05-06T01:00:00.000Z',
    });
    fetchDungeonRunListMock.mockResolvedValue({
      available: [],
      activeRun: claimedRun,
    });
    const s = useDungeonRunStore();
    await s.load();
    expect(s.isRunCompleted).toBe(false);
    expect(s.isRunClaimable).toBe(false);
  });
});

describe('useDungeonRunStore.start', () => {
  it('happy path → call API + reload list', async () => {
    startDungeonRunMock.mockResolvedValue(buildRun({ id: 'r1', status: 'ACTIVE' }));
    fetchDungeonRunListMock.mockResolvedValue({
      available: [buildAvailability({ key: 'son_coc_normal', startable: false, dailyUsed: 1, dailyLimit: 3 })],
      activeRun: buildRun({ id: 'r1', status: 'ACTIVE' }),
    });
    const s = useDungeonRunStore();
    await s.start('son_coc_normal');
    expect(startDungeonRunMock).toHaveBeenCalledWith('son_coc_normal');
    expect(fetchDungeonRunListMock).toHaveBeenCalledTimes(1);
    expect(s.activeRun?.id).toBe('r1');
    expect(s.submittingError).toBeNull();
    expect(s.submittingKey).toBeNull();
  });

  it('error path → throw + submittingError set, KHÔNG reload', async () => {
    startDungeonRunMock.mockRejectedValue({ code: 'DUNGEON_LOCKED_REALM' });
    const s = useDungeonRunStore();
    await expect(s.start('son_coc_hard')).rejects.toBeTruthy();
    expect(s.submittingError).toBe('DUNGEON_LOCKED_REALM');
    expect(fetchDungeonRunListMock).not.toHaveBeenCalled();
    expect(s.submittingKey).toBeNull();
  });
});

describe('useDungeonRunStore.next', () => {
  it('throw NO_ACTIVE_RUN nếu chưa có activeRun', async () => {
    const s = useDungeonRunStore();
    await expect(s.next()).rejects.toMatchObject({ code: 'NO_ACTIVE_RUN' });
    expect(nextDungeonEncounterMock).not.toHaveBeenCalled();
  });

  it('happy path → call API với run.id + reload list', async () => {
    const run = buildRun({ id: 'r1', status: 'ACTIVE' });
    fetchDungeonRunListMock.mockResolvedValueOnce({
      available: [],
      activeRun: run,
    });
    const s = useDungeonRunStore();
    await s.load();

    const next = buildRun({ id: 'r1', status: 'ACTIVE', encounterIndex: 1 });
    nextDungeonEncounterMock.mockResolvedValue(next);
    fetchDungeonRunListMock.mockResolvedValueOnce({
      available: [],
      activeRun: next,
    });
    const result = await s.next();
    expect(nextDungeonEncounterMock).toHaveBeenCalledWith('r1');
    expect(result.encounterIndex).toBe(1);
    expect(s.activeRun?.encounterIndex).toBe(1);
  });

  it('error path → submittingError set + throw', async () => {
    const run = buildRun({ id: 'r1', status: 'ACTIVE' });
    fetchDungeonRunListMock.mockResolvedValue({
      available: [],
      activeRun: run,
    });
    const s = useDungeonRunStore();
    await s.load();

    nextDungeonEncounterMock.mockRejectedValue({ code: 'RUN_NOT_ACTIVE' });
    await expect(s.next()).rejects.toBeTruthy();
    expect(s.submittingError).toBe('RUN_NOT_ACTIVE');
  });
});

describe('useDungeonRunStore.claim', () => {
  it('throw NO_ACTIVE_RUN nếu chưa có activeRun', async () => {
    const s = useDungeonRunStore();
    await expect(s.claim()).rejects.toMatchObject({ code: 'NO_ACTIVE_RUN' });
    expect(claimDungeonRunMock).not.toHaveBeenCalled();
  });

  it('happy path → save lastClaimResult + reload list', async () => {
    const run = buildRun({
      id: 'r1',
      status: 'COMPLETED',
      completedAt: '2026-05-06T00:30:00.000Z',
      claimedAt: null,
    });
    fetchDungeonRunListMock.mockResolvedValueOnce({
      available: [],
      activeRun: run,
    });
    const s = useDungeonRunStore();
    await s.load();

    const claimResult: DungeonClaimResult = {
      runId: 'r1',
      templateKey: 'son_coc_normal',
      claimedAt: '2026-05-06T01:00:00.000Z',
      granted: { linhThach: 100, tienNgoc: 0, exp: 50, items: [] },
    };
    claimDungeonRunMock.mockResolvedValue(claimResult);
    const claimedRun = buildRun({
      id: 'r1',
      status: 'CLAIMED',
      claimedAt: '2026-05-06T01:00:00.000Z',
    });
    fetchDungeonRunListMock.mockResolvedValueOnce({
      available: [],
      activeRun: claimedRun,
    });

    const result = await s.claim();
    expect(claimDungeonRunMock).toHaveBeenCalledWith('r1');
    expect(result).toEqual(claimResult);
    expect(s.lastClaimResult).toEqual(claimResult);
    expect(s.activeRun?.status).toBe('CLAIMED');
  });

  it('error path → submittingError set + throw', async () => {
    const run = buildRun({ id: 'r1', status: 'COMPLETED' });
    fetchDungeonRunListMock.mockResolvedValue({
      available: [],
      activeRun: run,
    });
    const s = useDungeonRunStore();
    await s.load();

    claimDungeonRunMock.mockRejectedValue({ code: 'RUN_ALREADY_CLAIMED' });
    await expect(s.claim()).rejects.toBeTruthy();
    expect(s.submittingError).toBe('RUN_ALREADY_CLAIMED');
    expect(s.lastClaimResult).toBeNull();
  });
});

describe('useDungeonRunStore.findAvailability + reset + clearLastClaimResult', () => {
  it('findAvailability trả đúng theo dungeon.key', async () => {
    fetchDungeonRunListMock.mockResolvedValue({
      available: [
        buildAvailability({ key: 'a' }),
        buildAvailability({ key: 'b' }),
      ],
      activeRun: null,
    });
    const s = useDungeonRunStore();
    await s.load();
    expect(s.findAvailability('a')?.dungeon.key).toBe('a');
    expect(s.findAvailability('zzz')).toBeUndefined();
  });

  it('clearLastClaimResult clears modal state', async () => {
    const s = useDungeonRunStore();
    s.lastClaimResult = {
      runId: 'r1',
      templateKey: 'son_coc_normal',
      claimedAt: '2026-05-06T01:00:00.000Z',
      granted: { linhThach: 100, tienNgoc: 0, exp: 50, items: [] },
    };
    s.clearLastClaimResult();
    expect(s.lastClaimResult).toBeNull();
  });

  it('reset trả store về trạng thái rỗng', async () => {
    fetchDungeonRunListMock.mockResolvedValue({
      available: [buildAvailability({ key: 'a' })],
      activeRun: buildRun({ id: 'r1', status: 'ACTIVE' }),
    });
    const s = useDungeonRunStore();
    await s.load();
    expect(s.loaded).toBe(true);
    s.reset();
    expect(s.loaded).toBe(false);
    expect(s.available).toEqual([]);
    expect(s.activeRun).toBeNull();
    expect(s.lastError).toBeNull();
    expect(s.lastClaimResult).toBeNull();
  });
});
