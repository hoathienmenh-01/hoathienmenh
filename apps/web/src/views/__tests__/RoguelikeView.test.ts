import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import type {
  RoguelikeListView,
  RoguelikeRunStatus,
  RoguelikeRunView,
} from '@/api/roguelike';

const fetchRoguelikeListMock = vi.fn();
const fetchRoguelikeLeaderboardMock = vi.fn();
const startRoguelikeRunMock = vi.fn();
const chooseRoguelikeFloorMock = vi.fn();
const claimRoguelikeRunMock = vi.fn();
const abandonRoguelikeRunMock = vi.fn();

vi.mock('@/api/roguelike', () => ({
  fetchRoguelikeList: (...a: unknown[]) => fetchRoguelikeListMock(...a),
  fetchRoguelikeLeaderboard: (...a: unknown[]) =>
    fetchRoguelikeLeaderboardMock(...a),
  startRoguelikeRun: (...a: unknown[]) => startRoguelikeRunMock(...a),
  chooseRoguelikeFloor: (...a: unknown[]) => chooseRoguelikeFloorMock(...a),
  claimRoguelikeRun: (...a: unknown[]) => claimRoguelikeRunMock(...a),
  abandonRoguelikeRun: (...a: unknown[]) => abandonRoguelikeRunMock(...a),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div><slot /></div>' },
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ isAuthenticated: true }),
}));

vi.mock('@/stores/game', () => ({
  useGameStore: () => ({ character: { id: 'c1', realmKey: 'luyenkhi' } }),
}));

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

import RoguelikeView from '@/views/RoguelikeView.vue';

const messages = {
  vi: {
    common: {
      refresh: 'Làm mới',
      loadingData: 'Đang tải',
      close: 'Đóng',
    },
    roguelike: {
      kicker: 'Phase 38',
      title: 'Roguelike Bí Cảnh',
      subtitle: 'sub',
      realmCount: 'Bí cảnh',
      unlockedCount: 'Đã mở',
      activeStatus: 'Trạng thái',
      runCard: 'Run',
      floor: 'Tầng {n}',
      resource: 'Tài nguyên',
      score: 'Điểm',
      rewardMul: 'Hệ số',
      activeBuffs: 'Buff',
      buffTurns: '{n} tầng',
      noBuffs: 'Không buff',
      choices: 'Lựa chọn',
      abandon: 'Bỏ',
      claim: 'Lĩnh thưởng',
      rewardPreview: 'Preview',
      milestones: 'Mốc',
      log: 'Log',
      emptyLog: 'Trống log',
      realmList: 'Danh sách',
      emptyRealms: 'Trống',
      realmReq: 'Yêu cầu {realm}',
      unlocked: 'Mở',
      locked: 'Khoá',
      daily: 'Ngày',
      weekly: 'Tuần',
      start: 'Bắt đầu',
      leaderboard: 'BXH',
      emptyLeaderboard: 'Trống BXH',
      floorScore: 'Tầng {floor} · {score}',
      claimedTitle: 'Đã lĩnh',
      startToast: 'Start ok',
      choiceToast: 'Choice {floor}',
      abandonToast: 'Bỏ ok',
      claimToast: '+{linhThach} +{exp}',
      statusToast: {
        COMPLETED: 'Done',
        FAILED: 'Fail',
        ABANDONED: 'Bỏ',
        CLAIMED: 'Claimed',
      },
      status: {
        ACTIVE: 'Đang',
        COMPLETED: 'Xong',
        FAILED: 'Fail',
        ABANDONED: 'Bỏ',
        CLAIMED: 'Lĩnh',
      },
      floorType: {
        COMBAT: 'Đánh',
        ELITE: 'Elite',
        MINI_BOSS: 'Boss',
        TRAP: 'Bẫy',
        TREASURE: 'Rương',
        MERCHANT: 'Shop',
        EVENT: 'Event',
        REST: 'Nghỉ',
        INHERITANCE: 'Truyền thừa',
      },
      errors: {
        UNKNOWN: 'Lỗi',
        UNKNOWN_ERROR: 'Lỗi',
      },
    },
  },
};

function buildRun(status: RoguelikeRunStatus): RoguelikeRunView {
  return {
    id: 'run1',
    realmKey: 'mist_cave',
    status,
    seed: 'seed',
    currentFloor: status === 'ACTIVE' ? 0 : 10,
    hp: 90,
    hpMax: 120,
    resource: 30,
    score: 88,
    rewardMultiplier: 1.1,
    activeBuffs: [],
    floorHistory: [],
    currentFloorDef:
      status === 'ACTIVE'
        ? {
            key: 'f1',
            floorNumber: 1,
            floorType: 'COMBAT',
            nameVi: 'Chiến tầng 1',
            nameEn: 'Combat floor 1',
            descriptionVi: '',
            descriptionEn: '',
            minRealmOrder: 0,
            powerMultiplier: 1,
            monsterKeys: [],
            choiceKeys: ['safe'],
            baseReward: { linhThach: 20, exp: 40 },
          }
        : null,
    choices:
      status === 'ACTIVE'
        ? [
            {
              key: 'safe',
              titleVi: 'Đánh chắc',
              titleEn: 'Safe strike',
              descriptionVi: 'Ít rủi ro',
              descriptionEn: 'Low risk',
              risk: 'LOW',
              reward: 'SAFE_PROGRESS',
              hpDeltaPct: -3,
              resourceDelta: 1,
              scoreDelta: 10,
              rewardMultiplier: 1,
              outcomeVi: 'Qua tầng',
              outcomeEn: 'Cleared',
            },
          ]
        : [],
    rewardPreview: {
      linhThach: 100,
      exp: 200,
      items: [],
      milestoneFloors: status === 'ACTIVE' ? [] : [10],
    },
    startedAt: '2026-05-14T00:00:00.000Z',
    completedAt: status === 'COMPLETED' ? '2026-05-14T00:01:00.000Z' : null,
    failedAt: null,
    abandonedAt: null,
    claimedAt: null,
    expiresAt: null,
  };
}

function buildList(activeRun: RoguelikeRunView | null): RoguelikeListView {
  return {
    activeRun,
    realms: [
      {
        realm: {
          key: 'mist_cave',
          nameVi: 'Mê Vụ',
          nameEn: 'Mist',
          descriptionVi: '',
          descriptionEn: '',
          requiredRealmOrder: 0,
          recommendedPower: 80,
          dailyEntryLimit: 3,
          weeklyRewardClaimLimit: 14,
          baseHp: 120,
          baseResource: 30,
          rewardMultiplier: 1,
        },
        unlocked: true,
        activeRunId: activeRun?.id ?? null,
        dailyUsed: 0,
        dailyLimit: 3,
        weeklyClaimsUsed: 0,
        weeklyClaimLimit: 14,
      },
    ],
  };
}

async function mountView() {
  setActivePinia(createPinia());
  const i18n = createI18n({ legacy: false, locale: 'vi', messages });
  const wrapper = mount(RoguelikeView, {
    global: { plugins: [i18n] },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchRoguelikeLeaderboardMock.mockResolvedValue([
    {
      characterId: 'c1',
      characterName: 'Dao',
      bestFloor: 10,
      bestScore: 123,
      fastestClearMs: null,
      weekBucket: '2026-W20',
      monthBucket: '2026-05',
      updatedAt: '2026-05-14T00:00:00.000Z',
    },
  ]);
});

describe('RoguelikeView', () => {
  it('renders realm list, active run, choices, reward preview and leaderboard', async () => {
    fetchRoguelikeListMock.mockResolvedValue(buildList(buildRun('ACTIVE')));
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('Roguelike Bí Cảnh');
    expect(wrapper.text()).toContain('Mê Vụ');
    expect(wrapper.text()).toContain('Đánh chắc');
    expect(wrapper.text()).toContain('Preview');
    expect(wrapper.text()).toContain('Dao');
  });

  it('dispatches choice and claim actions', async () => {
    fetchRoguelikeListMock
      .mockResolvedValueOnce(buildList(buildRun('ACTIVE')))
      .mockResolvedValue(buildList(buildRun('COMPLETED')));
    chooseRoguelikeFloorMock.mockResolvedValue(buildRun('COMPLETED'));
    claimRoguelikeRunMock.mockResolvedValue({
      runId: 'run1',
      claimedAt: '2026-05-14T00:02:00.000Z',
      granted: { linhThach: 100, exp: 200, items: [] },
      run: { ...buildRun('COMPLETED'), status: 'CLAIMED', claimedAt: 'x' },
    });
    const wrapper = await mountView();
    await wrapper.findAll('button').find((b) => b.text().includes('Đánh chắc'))?.trigger('click');
    await flushPromises();
    expect(chooseRoguelikeFloorMock).toHaveBeenCalledWith('run1', 'safe');

    await wrapper.findAll('button').find((b) => b.text() === 'Lĩnh thưởng')?.trigger('click');
    await flushPromises();
    expect(claimRoguelikeRunMock).toHaveBeenCalledWith('run1');
    expect(wrapper.text()).toContain('Đã lĩnh');
  });
});
