import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const fetchListMock = vi.fn();
const fetchOneMock = vi.fn();
const startMock = vi.fn();
const advanceMock = vi.fn();
const clearMock = vi.fn();
const claimMock = vi.fn();

vi.mock('@/api/storyDungeon', () => ({
  fetchStoryDungeonList: (...a: unknown[]) => fetchListMock(...a),
  fetchStoryDungeon: (...a: unknown[]) => fetchOneMock(...a),
  startStoryDungeon: (...a: unknown[]) => startMock(...a),
  advanceStoryDungeon: (...a: unknown[]) => advanceMock(...a),
  clearStoryDungeon: (...a: unknown[]) => clearMock(...a),
  claimStoryDungeon: (...a: unknown[]) => claimMock(...a),
}));

import { useStoryDungeonStore } from '@/stores/storyDungeon';
import type {
  StoryDungeonAvailabilityStatus,
  StoryDungeonClaimResult,
  StoryDungeonRunStatus,
  StoryDungeonRunView,
  StoryDungeonView,
} from '@/api/storyDungeon';

function buildDungeon(
  partial: Partial<StoryDungeonView> & { key: string; status: StoryDungeonAvailabilityStatus },
): StoryDungeonView {
  return {
    key: partial.key,
    titleI18nKey: partial.titleI18nKey ?? `story.${partial.key}.title`,
    descriptionI18nKey: partial.descriptionI18nKey ?? `story.${partial.key}.desc`,
    titleVi: partial.titleVi ?? `Bí cảnh ${partial.key}`,
    descriptionVi: partial.descriptionVi ?? 'desc',
    requiredQuestKey: partial.requiredQuestKey ?? 'quest_x',
    requiredQuestStep: partial.requiredQuestStep ?? null,
    regionKey: partial.regionKey ?? 'son_coc',
    recommendedRealm: partial.recommendedRealm ?? 'phamnhan',
    minRealmKey: partial.minRealmKey ?? null,
    npcKey: partial.npcKey ?? null,
    entryDialogueKey: partial.entryDialogueKey ?? null,
    clearDialogueKey: partial.clearDialogueKey ?? null,
    monsters: partial.monsters ?? [],
    boss: partial.boss ?? null,
    rewardHint: partial.rewardHint ?? null,
    oneTime: partial.oneTime ?? true,
    status: partial.status,
  };
}

function buildRun(
  partial: Partial<StoryDungeonRunView> & { id: string; status: StoryDungeonRunStatus },
): StoryDungeonRunView {
  return {
    id: partial.id,
    templateKey: partial.templateKey ?? 'story_intro',
    status: partial.status,
    currentStep: partial.currentStep ?? 0,
    totalSteps: partial.totalSteps ?? 3,
    currentMonster: partial.currentMonster ?? null,
    killedMonsters: partial.killedMonsters ?? [],
    startedAt: partial.startedAt ?? '2026-05-07T00:00:00.000Z',
    clearedAt: partial.clearedAt ?? null,
    claimedAt: partial.claimedAt ?? null,
    rewardHint: partial.rewardHint ?? null,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  fetchListMock.mockReset();
  fetchOneMock.mockReset();
  startMock.mockReset();
  advanceMock.mockReset();
  clearMock.mockReset();
  claimMock.mockReset();
});

describe('useStoryDungeonStore.load', () => {
  it('happy path → dungeons + activeRun set, loaded=true', async () => {
    const ds = [
      buildDungeon({ key: 'a', status: 'available' }),
      buildDungeon({ key: 'b', status: 'locked' }),
      buildDungeon({ key: 'c', status: 'cleared' }),
    ];
    const run = buildRun({ id: 'r1', status: 'ACTIVE', templateKey: 'a' });
    fetchListMock.mockResolvedValue({ dungeons: ds, activeRun: run });
    const s = useStoryDungeonStore();
    await s.load();
    expect(s.loaded).toBe(true);
    expect(s.dungeons).toEqual(ds);
    expect(s.activeRun).toEqual(run);
    expect(s.totalCount).toBe(3);
    expect(s.availableCount).toBe(1);
    expect(s.lockedCount).toBe(1);
    expect(s.clearedCount).toBe(1);
    expect(s.hasActiveRun).toBe(true);
    expect(s.isRunActive).toBe(true);
    expect(s.isRunCleared).toBe(false);
    expect(s.isRunClaimable).toBe(false);
    expect(s.lastError).toBeNull();
  });

  it('error envelope → lastError = code, loaded=false', async () => {
    fetchListMock.mockRejectedValue({ code: 'NO_CHARACTER' });
    const s = useStoryDungeonStore();
    await s.load();
    expect(s.lastError).toBe('NO_CHARACTER');
    expect(s.loaded).toBe(false);
    expect(s.dungeons).toEqual([]);
    expect(s.activeRun).toBeNull();
  });

  it('unknown error → fallback UNKNOWN_ERROR', async () => {
    fetchListMock.mockRejectedValue(new Error('weird'));
    const s = useStoryDungeonStore();
    await s.load();
    expect(s.lastError).toBe('UNKNOWN_ERROR');
  });
});

describe('useStoryDungeonStore.start', () => {
  it('happy path → call API + reload list', async () => {
    const ds = [buildDungeon({ key: 'a', status: 'available' })];
    const run = buildRun({ id: 'r1', status: 'ACTIVE', templateKey: 'a' });
    startMock.mockResolvedValue(run);
    fetchListMock.mockResolvedValue({ dungeons: ds, activeRun: run });

    const s = useStoryDungeonStore();
    await s.start('a');
    expect(startMock).toHaveBeenCalledWith('a');
    expect(fetchListMock).toHaveBeenCalledTimes(1);
    expect(s.activeRun?.id).toBe('r1');
    expect(s.submittingError).toBeNull();
    expect(s.submittingKey).toBeNull();
  });

  it('error envelope DUNGEON_LOCKED → throw + submittingError, KHÔNG reload', async () => {
    startMock.mockRejectedValue({ code: 'DUNGEON_LOCKED' });
    const s = useStoryDungeonStore();
    await expect(s.start('a')).rejects.toBeTruthy();
    expect(s.submittingError).toBe('DUNGEON_LOCKED');
    expect(fetchListMock).not.toHaveBeenCalled();
  });
});

describe('useStoryDungeonStore.advance', () => {
  it('throw NO_ACTIVE_RUN nếu chưa có activeRun', async () => {
    const s = useStoryDungeonStore();
    await expect(s.advance()).rejects.toMatchObject({ code: 'NO_ACTIVE_RUN' });
    expect(advanceMock).not.toHaveBeenCalled();
  });

  it('happy path → call API với run.id + reload', async () => {
    const run = buildRun({ id: 'r1', status: 'ACTIVE', templateKey: 'a', currentStep: 0 });
    fetchListMock.mockResolvedValueOnce({ dungeons: [], activeRun: run });
    const s = useStoryDungeonStore();
    await s.load();

    const next = buildRun({ id: 'r1', status: 'ACTIVE', templateKey: 'a', currentStep: 1 });
    advanceMock.mockResolvedValue(next);
    fetchListMock.mockResolvedValueOnce({ dungeons: [], activeRun: next });

    const result = await s.advance();
    expect(advanceMock).toHaveBeenCalledWith('r1');
    expect(result.currentStep).toBe(1);
    expect(s.activeRun?.currentStep).toBe(1);
  });
});

describe('useStoryDungeonStore.clear', () => {
  it('happy path → ACTIVE → CLEARED + reload', async () => {
    const run = buildRun({
      id: 'r1',
      status: 'ACTIVE',
      templateKey: 'a',
      currentStep: 3,
      totalSteps: 3,
    });
    fetchListMock.mockResolvedValueOnce({ dungeons: [], activeRun: run });
    const s = useStoryDungeonStore();
    await s.load();

    const cleared = buildRun({
      id: 'r1',
      status: 'CLEARED',
      templateKey: 'a',
      currentStep: 3,
      totalSteps: 3,
      clearedAt: '2026-05-07T01:00:00.000Z',
    });
    clearMock.mockResolvedValue(cleared);
    fetchListMock.mockResolvedValueOnce({ dungeons: [], activeRun: cleared });

    const result = await s.clear();
    expect(clearMock).toHaveBeenCalledWith('r1');
    expect(result.status).toBe('CLEARED');
    expect(s.isRunCleared).toBe(true);
    expect(s.isRunClaimable).toBe(true);
  });

  it('error RUN_STEP_INVALID → submittingError + throw', async () => {
    const run = buildRun({ id: 'r1', status: 'ACTIVE', templateKey: 'a' });
    fetchListMock.mockResolvedValue({ dungeons: [], activeRun: run });
    const s = useStoryDungeonStore();
    await s.load();

    clearMock.mockRejectedValue({ code: 'RUN_STEP_INVALID' });
    await expect(s.clear()).rejects.toBeTruthy();
    expect(s.submittingError).toBe('RUN_STEP_INVALID');
  });
});

describe('useStoryDungeonStore.claim', () => {
  it('throw NO_ACTIVE_RUN nếu chưa có activeRun', async () => {
    const s = useStoryDungeonStore();
    await expect(s.claim()).rejects.toMatchObject({ code: 'NO_ACTIVE_RUN' });
    expect(claimMock).not.toHaveBeenCalled();
  });

  it('happy path → save lastClaimResult + reload', async () => {
    const run = buildRun({
      id: 'r1',
      status: 'CLEARED',
      templateKey: 'a',
      clearedAt: '2026-05-07T01:00:00.000Z',
    });
    fetchListMock.mockResolvedValueOnce({ dungeons: [], activeRun: run });
    const s = useStoryDungeonStore();
    await s.load();

    const claimResult: StoryDungeonClaimResult = {
      runId: 'r1',
      templateKey: 'a',
      claimedAt: '2026-05-07T02:00:00.000Z',
      granted: { linhThach: 200, tienNgoc: 0, exp: 800, items: [] },
    };
    claimMock.mockResolvedValue(claimResult);
    const claimed = buildRun({
      id: 'r1',
      status: 'CLAIMED',
      templateKey: 'a',
      claimedAt: '2026-05-07T02:00:00.000Z',
    });
    fetchListMock.mockResolvedValueOnce({ dungeons: [], activeRun: claimed });

    const result = await s.claim();
    expect(claimMock).toHaveBeenCalledWith('r1');
    expect(result).toEqual(claimResult);
    expect(s.lastClaimResult).toEqual(claimResult);
    expect(s.activeRun?.status).toBe('CLAIMED');
  });

  it('double claim RUN_ALREADY_CLAIMED → submittingError + throw, KHÔNG ghi lastClaimResult', async () => {
    const run = buildRun({ id: 'r1', status: 'CLEARED', templateKey: 'a' });
    fetchListMock.mockResolvedValue({ dungeons: [], activeRun: run });
    const s = useStoryDungeonStore();
    await s.load();

    claimMock.mockRejectedValue({ code: 'RUN_ALREADY_CLAIMED' });
    await expect(s.claim()).rejects.toBeTruthy();
    expect(s.submittingError).toBe('RUN_ALREADY_CLAIMED');
    expect(s.lastClaimResult).toBeNull();
  });
});

describe('useStoryDungeonStore.findDungeon + findDungeonForQuest', () => {
  it('findDungeon trả đúng theo key', async () => {
    fetchListMock.mockResolvedValue({
      dungeons: [
        buildDungeon({ key: 'a', status: 'available', requiredQuestKey: 'q1' }),
        buildDungeon({ key: 'b', status: 'locked', requiredQuestKey: 'q2' }),
      ],
      activeRun: null,
    });
    const s = useStoryDungeonStore();
    await s.load();
    expect(s.findDungeon('a')?.key).toBe('a');
    expect(s.findDungeon('zzz')).toBeUndefined();
  });

  it('findDungeonForQuest trả entry theo requiredQuestKey', async () => {
    fetchListMock.mockResolvedValue({
      dungeons: [
        buildDungeon({ key: 'a', status: 'available', requiredQuestKey: 'q1' }),
        buildDungeon({ key: 'b', status: 'locked', requiredQuestKey: 'q2' }),
      ],
      activeRun: null,
    });
    const s = useStoryDungeonStore();
    await s.load();
    expect(s.findDungeonForQuest('q1')?.key).toBe('a');
    expect(s.findDungeonForQuest('q_unknown')).toBeUndefined();
  });
});

describe('useStoryDungeonStore.reset + clearLastClaimResult', () => {
  it('reset → store về trạng thái rỗng', async () => {
    fetchListMock.mockResolvedValue({
      dungeons: [buildDungeon({ key: 'a', status: 'available' })],
      activeRun: buildRun({ id: 'r1', status: 'ACTIVE', templateKey: 'a' }),
    });
    const s = useStoryDungeonStore();
    await s.load();
    expect(s.loaded).toBe(true);
    s.reset();
    expect(s.loaded).toBe(false);
    expect(s.dungeons).toEqual([]);
    expect(s.activeRun).toBeNull();
    expect(s.lastError).toBeNull();
    expect(s.lastClaimResult).toBeNull();
  });

  it('clearLastClaimResult clears modal state', () => {
    const s = useStoryDungeonStore();
    s.lastClaimResult = {
      runId: 'r1',
      templateKey: 'a',
      claimedAt: '2026-05-07T02:00:00.000Z',
      granted: { linhThach: 100, tienNgoc: 0, exp: 50, items: [] },
    };
    s.clearLastClaimResult();
    expect(s.lastClaimResult).toBeNull();
  });
});
