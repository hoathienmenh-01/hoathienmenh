import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const fetchQuestsMock = vi.fn();
const acceptQuestMock = vi.fn();
const claimQuestMock = vi.fn();

vi.mock('@/api/quest', () => ({
  fetchQuests: (...a: unknown[]) => fetchQuestsMock(...a),
  acceptQuest: (...a: unknown[]) => acceptQuestMock(...a),
  claimQuest: (...a: unknown[]) => claimQuestMock(...a),
}));

import { useQuestStore } from '@/stores/quest';
import type {
  QuestClaimResult,
  QuestProgressView,
  QuestStatus,
} from '@/api/quest';

function buildQuest(
  partial: Partial<QuestProgressView> & { key: string; status: QuestStatus },
): QuestProgressView {
  return {
    key: partial.key,
    name: partial.name ?? `Quest ${partial.key}`,
    description: partial.description ?? '',
    kind: partial.kind ?? 'main',
    realmKey: partial.realmKey ?? 'phamnhan',
    requiredRealmOrder: partial.requiredRealmOrder ?? 0,
    giverNpcKey: partial.giverNpcKey ?? 'npc_x',
    chainKey: partial.chainKey ?? null,
    prerequisiteQuestKey: partial.prerequisiteQuestKey ?? null,
    status: partial.status,
    steps: partial.steps ?? [],
    completable: partial.completable ?? partial.status === 'COMPLETED',
    acceptedAt: partial.acceptedAt ?? null,
    completedAt: partial.completedAt ?? null,
    claimedAt: partial.claimedAt ?? null,
    rewards: partial.rewards ?? {},
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  fetchQuestsMock.mockReset();
  acceptQuestMock.mockReset();
  claimQuestMock.mockReset();
});

describe('useQuestStore.load', () => {
  it('happy path → quests set + loaded=true + lastError=null', async () => {
    const list = [
      buildQuest({ key: 'phamnhan_main_01', status: 'AVAILABLE', kind: 'main' }),
      buildQuest({ key: 'phamnhan_realm_01', status: 'LOCKED', kind: 'realm' }),
    ];
    fetchQuestsMock.mockResolvedValue(list);
    const s = useQuestStore();
    await s.load();
    expect(s.quests).toEqual(list);
    expect(s.loaded).toBe(true);
    expect(s.lastError).toBeNull();
    expect(s.totalCount).toBe(2);
  });

  it('error path (envelope code) → lastError = code', async () => {
    fetchQuestsMock.mockRejectedValue({ code: 'NO_CHARACTER' });
    const s = useQuestStore();
    await s.load();
    expect(s.lastError).toBe('NO_CHARACTER');
    expect(s.loaded).toBe(false);
    expect(s.quests).toEqual([]);
  });

  it('unknown error → fallback UNKNOWN_ERROR', async () => {
    fetchQuestsMock.mockRejectedValue(new Error('weird'));
    const s = useQuestStore();
    await s.load();
    expect(s.lastError).toBe('UNKNOWN_ERROR');
  });
});

describe('useQuestStore filter', () => {
  it('kindFilter null → trả tất cả', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q1', status: 'AVAILABLE', kind: 'main' }),
      buildQuest({ key: 'q2', status: 'AVAILABLE', kind: 'sect' }),
    ]);
    const s = useQuestStore();
    await s.load();
    expect(s.filteredQuests.map((q) => q.key)).toEqual(['q1', 'q2']);
  });

  it('setKindFilter("main") → chỉ trả main', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q1', status: 'AVAILABLE', kind: 'main' }),
      buildQuest({ key: 'q2', status: 'AVAILABLE', kind: 'sect' }),
      buildQuest({ key: 'q3', status: 'AVAILABLE', kind: 'main' }),
    ]);
    const s = useQuestStore();
    await s.load();
    s.setKindFilter('main');
    expect(s.filteredQuests.map((q) => q.key)).toEqual(['q1', 'q3']);
    expect(s.filteredCount).toBe(2);
    expect(s.totalCount).toBe(3);
  });
});

describe('useQuestStore counts', () => {
  it('activeCount + claimableCount đúng theo status', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q1', status: 'ACCEPTED' }),
      buildQuest({ key: 'q2', status: 'COMPLETED' }),
      buildQuest({ key: 'q3', status: 'COMPLETED' }),
      buildQuest({ key: 'q4', status: 'CLAIMED' }),
      buildQuest({ key: 'q5', status: 'LOCKED' }),
    ]);
    const s = useQuestStore();
    await s.load();
    // active = ACCEPTED + COMPLETED = 1 + 2 = 3
    expect(s.activeCount).toBe(3);
    // claimable = COMPLETED = 2
    expect(s.claimableCount).toBe(2);
  });
});

describe('useQuestStore.accept', () => {
  it('happy path → call API + reload list', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q1', status: 'ACCEPTED' }),
    ]);
    acceptQuestMock.mockResolvedValue(
      buildQuest({ key: 'q1', status: 'ACCEPTED' }),
    );
    const s = useQuestStore();
    await s.accept('q1');
    expect(acceptQuestMock).toHaveBeenCalledWith('q1');
    expect(fetchQuestsMock).toHaveBeenCalledTimes(1);
    expect(s.quests[0]?.status).toBe('ACCEPTED');
    expect(s.submittingError).toBeNull();
    expect(s.submittingKey).toBeNull();
  });

  it('error path → throw + submittingError set, KHÔNG reload', async () => {
    acceptQuestMock.mockRejectedValue({ code: 'QUEST_LOCKED_REALM' });
    const s = useQuestStore();
    await expect(s.accept('q_locked')).rejects.toMatchObject({
      code: 'QUEST_LOCKED_REALM',
    });
    expect(s.submittingError).toBe('QUEST_LOCKED_REALM');
    expect(fetchQuestsMock).not.toHaveBeenCalled();
    expect(s.submittingKey).toBeNull();
  });
});

describe('useQuestStore.claim', () => {
  it('happy path → call API + reload + lastClaimResult set', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q1', status: 'CLAIMED' }),
    ]);
    const claimResult: QuestClaimResult = {
      questKey: 'q1',
      claimedAt: '2026-05-05T00:00:00.000Z',
      granted: {
        linhThach: 1500,
        tienNgoc: 0,
        exp: 1500,
        congHien: 0,
        items: [{ itemKey: 'co_thien_dan', qty: 1 }],
      },
    };
    claimQuestMock.mockResolvedValue(claimResult);
    const s = useQuestStore();
    const r = await s.claim('q1');
    expect(claimQuestMock).toHaveBeenCalledWith('q1');
    expect(fetchQuestsMock).toHaveBeenCalledTimes(1);
    expect(r).toEqual(claimResult);
    expect(s.lastClaimResult).toEqual(claimResult);
    expect(s.quests[0]?.status).toBe('CLAIMED');
  });

  it('claim chưa COMPLETED → throw + submittingError', async () => {
    claimQuestMock.mockRejectedValue({ code: 'QUEST_NOT_COMPLETED' });
    const s = useQuestStore();
    await expect(s.claim('q1')).rejects.toMatchObject({
      code: 'QUEST_NOT_COMPLETED',
    });
    expect(s.submittingError).toBe('QUEST_NOT_COMPLETED');
    expect(fetchQuestsMock).not.toHaveBeenCalled();
  });

  it('claim đã claim rồi → throw QUEST_ALREADY_CLAIMED', async () => {
    claimQuestMock.mockRejectedValue({ code: 'QUEST_ALREADY_CLAIMED' });
    const s = useQuestStore();
    await expect(s.claim('q1')).rejects.toMatchObject({
      code: 'QUEST_ALREADY_CLAIMED',
    });
    expect(s.submittingError).toBe('QUEST_ALREADY_CLAIMED');
  });
});

describe('useQuestStore.reset', () => {
  it('reset → clear state', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q1', status: 'AVAILABLE' }),
    ]);
    const s = useQuestStore();
    await s.load();
    s.setKindFilter('main');
    s.reset();
    expect(s.quests).toEqual([]);
    expect(s.loaded).toBe(false);
    expect(s.kindFilter).toBeNull();
    expect(s.submittingKey).toBeNull();
    expect(s.lastClaimResult).toBeNull();
  });
});
