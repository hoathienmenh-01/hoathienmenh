import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type {
  OnboardingClaimResult,
  OnboardingDayView,
  OnboardingProgressView,
  OnboardingTaskView,
} from '@/api/onboardingQuest';

/**
 * Phase 34.0 — OnboardingQuestView UI smoke coverage.
 *
 * Cover:
 *   1. Loaded → render day grid + overall progress %.
 *   2. Click day card (AVAILABLE) → show day detail with tasks.
 *   3. Locked day card disabled.
 *   4. Complete button → POST complete + toast success.
 *   5. Claim button → POST claim + toast success.
 */

const fetchProgressMock = vi.fn();
const acceptTaskMock = vi.fn();
const completeTaskMock = vi.fn();
const claimTaskMock = vi.fn();
const recomputeMock = vi.fn();

vi.mock('@/api/onboardingQuest', () => ({
  fetchOnboardingProgress: (...a: unknown[]) => fetchProgressMock(...a),
  fetchOnboardingDay: vi.fn(),
  acceptOnboardingTask: (...a: unknown[]) => acceptTaskMock(...a),
  completeOnboardingTask: (...a: unknown[]) => completeTaskMock(...a),
  claimOnboardingTask: (...a: unknown[]) => claimTaskMock(...a),
  recomputeOnboarding: (...a: unknown[]) => recomputeMock(...a),
}));

const toastPushMock = vi.fn();

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { id: 'u1' },
    hydrate: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

const routerPushMock = vi.fn().mockResolvedValue(undefined);
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPushMock, replace: vi.fn() }),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

import OnboardingQuestView from '@/views/OnboardingQuestView.vue';

const messages = {
  vi: {
    common: { loadingData: 'Đang tải…' },
    onboardingQuest: {
      title: 'Khai Đạo 7 Ngày',
      subtitle: 'sub',
      overallProgress: '{claimed}/{total} ({pct}%)',
      dayLabel: 'Ngày {n}',
      totalTasks: '{n} nhiệm vụ',
      doneCount: '{done}/{total}',
      empty: 'Trống.',
      back: 'Trở lại',
      completeToast: 'Hoàn thành: {name}.',
      claimToast: 'Lĩnh thưởng +{linhThach} +{exp}.',
      claimToastTitle: 'Lĩnh + {title}.',
      novice_cultivator_title: 'Tân Tu Sĩ',
      dayStatus: {
        LOCKED: 'Khoá',
        AVAILABLE: 'Khả dụng',
        IN_PROGRESS: 'Đang tiến',
        COMPLETED: 'Hoàn tất',
      },
      taskStatus: {
        LOCKED: 'Khoá',
        AVAILABLE: 'Sẵn sàng',
        COMPLETED: 'Hoàn thành',
        CLAIMED: 'Đã thưởng',
      },
      category: {
        tutorial: 'Hướng dẫn',
        cultivation: 'Tu luyện',
        combat: 'Chiến đấu',
        story: 'Cốt truyện',
        social: 'Xã hội',
        system: 'Hệ thống',
      },
      actions: {
        open: 'Mở',
        complete: 'Báo',
        claim: 'Thưởng',
        claimed: 'Đã lĩnh',
      },
      reward: {
        linhThach: 'LT',
        exp: 'EXP',
        title: 'Danh hiệu',
      },
      error: { UNKNOWN_ERROR: 'Lỗi.' },
    },
  },
};

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    missingWarn: false,
    fallbackWarn: false,
    messages,
  });
}

function buildTask(
  partial: Partial<OnboardingTaskView> & {
    taskKey: string;
    status: OnboardingTaskView['status'];
  },
): OnboardingTaskView {
  return {
    taskKey: partial.taskKey,
    dayNumber: partial.dayNumber ?? 1,
    titleVi: partial.titleVi ?? `Task ${partial.taskKey}`,
    titleEn: partial.titleEn ?? `Task ${partial.taskKey}`,
    descriptionVi: partial.descriptionVi ?? 'desc',
    descriptionEn: partial.descriptionEn ?? 'desc',
    actionRoute: partial.actionRoute ?? '/inventory',
    category: partial.category ?? 'tutorial',
    status: partial.status,
    completedAt: partial.completedAt ?? null,
    claimedAt: partial.claimedAt ?? null,
    reward: partial.reward ?? { linhThach: 100, exp: 0 },
  };
}

function buildDay(
  partial: Partial<OnboardingDayView> & {
    dayNumber: number;
    status: OnboardingDayView['status'];
    tasks?: OnboardingTaskView[];
  },
): OnboardingDayView {
  const tasks = partial.tasks ?? [];
  return {
    dayNumber: partial.dayNumber,
    titleVi: partial.titleVi ?? `Day ${partial.dayNumber}`,
    titleEn: partial.titleEn ?? `Day ${partial.dayNumber}`,
    themeVi: partial.themeVi ?? 'theme',
    themeEn: partial.themeEn ?? 'theme',
    status: partial.status,
    unlockedAt: partial.unlockedAt ?? null,
    completedAt: partial.completedAt ?? null,
    totalTasks: tasks.length,
    completedTasks: tasks.filter(
      (t) => t.status === 'COMPLETED' || t.status === 'CLAIMED',
    ).length,
    claimedTasks: tasks.filter((t) => t.status === 'CLAIMED').length,
    tasks,
  };
}

function buildProgress(days: OnboardingDayView[]): OnboardingProgressView {
  const totalTasks = days.reduce((s, d) => s + d.totalTasks, 0);
  const completedTasks = days.reduce((s, d) => s + d.completedTasks, 0);
  const claimedTasks = days.reduce((s, d) => s + d.claimedTasks, 0);
  return {
    totalDays: days.length,
    totalTasks,
    completedTasks,
    claimedTasks,
    days,
  };
}

function mountView() {
  return mount(OnboardingQuestView, {
    attachTo: document.body,
    global: { plugins: [makeI18n()] },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  fetchProgressMock.mockReset();
  acceptTaskMock.mockReset();
  completeTaskMock.mockReset();
  claimTaskMock.mockReset();
  recomputeMock.mockReset();
  toastPushMock.mockReset();
  routerPushMock.mockClear();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('OnboardingQuestView render', () => {
  it('renders 7 day cards + overall progress', async () => {
    const days = Array.from({ length: 7 }, (_, i) =>
      buildDay({
        dayNumber: i + 1,
        status: i === 0 ? 'AVAILABLE' : 'LOCKED',
        tasks: [
          buildTask({
            taskKey: `d${i + 1}_x`,
            dayNumber: i + 1,
            status: i === 0 ? 'AVAILABLE' : 'LOCKED',
          }),
        ],
      }),
    );
    fetchProgressMock.mockResolvedValue(buildProgress(days));
    const w = mountView();
    await flushPromises();

    const grid = w.find('[data-testid="onboarding-day-grid"]');
    expect(grid.exists()).toBe(true);
    for (let n = 1; n <= 7; n++) {
      expect(w.find(`[data-testid="onboarding-day-card-${n}"]`).exists()).toBe(
        true,
      );
    }
    // Card 1 unlocked → not disabled.
    expect(
      w
        .find('[data-testid="onboarding-day-card-1"]')
        .attributes('disabled'),
    ).toBeUndefined();
    // Card 2 locked → disabled attr present.
    expect(
      w
        .find('[data-testid="onboarding-day-card-2"]')
        .attributes('disabled'),
    ).toBeDefined();
  });

  it('shows empty placeholder when 0 days', async () => {
    fetchProgressMock.mockResolvedValue(buildProgress([]));
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Trống.');
  });
});

describe('OnboardingQuestView interactions', () => {
  function setupOneDay(): OnboardingDayView {
    return buildDay({
      dayNumber: 1,
      status: 'AVAILABLE',
      tasks: [
        buildTask({ taskKey: 'd1_a', status: 'AVAILABLE' }),
        buildTask({ taskKey: 'd1_b', status: 'COMPLETED' }),
        buildTask({ taskKey: 'd1_c', status: 'CLAIMED' }),
      ],
    });
  }

  it('click day card → show task list', async () => {
    fetchProgressMock.mockResolvedValue(buildProgress([setupOneDay()]));
    const w = mountView();
    await flushPromises();

    await w.find('[data-testid="onboarding-day-card-1"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-testid="onboarding-task-d1_a"]').exists()).toBe(true);
    expect(w.find('[data-testid="onboarding-task-d1_b"]').exists()).toBe(true);
    expect(w.find('[data-testid="onboarding-task-d1_c"]').exists()).toBe(true);

    // Complete button only on AVAILABLE task.
    expect(w.find('[data-testid="onboarding-complete-d1_a"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-testid="onboarding-complete-d1_b"]').exists()).toBe(
      false,
    );
    // Claim button only on COMPLETED task.
    expect(w.find('[data-testid="onboarding-claim-d1_b"]').exists()).toBe(true);
    expect(w.find('[data-testid="onboarding-claim-d1_a"]').exists()).toBe(
      false,
    );
    // CLAIMED → claimed label.
    expect(w.find('[data-testid="onboarding-claimed-d1_c"]').exists()).toBe(
      true,
    );
  });

  it('complete button → POST + toast success', async () => {
    fetchProgressMock.mockResolvedValue(buildProgress([setupOneDay()]));
    completeTaskMock.mockResolvedValue(
      buildTask({ taskKey: 'd1_a', status: 'COMPLETED' }),
    );
    const w = mountView();
    await flushPromises();

    await w.find('[data-testid="onboarding-day-card-1"]').trigger('click');
    await flushPromises();
    await w
      .find('[data-testid="onboarding-complete-d1_a"]')
      .trigger('click');
    await flushPromises();

    expect(completeTaskMock).toHaveBeenCalledWith('d1_a');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('claim button → POST + toast success', async () => {
    fetchProgressMock.mockResolvedValue(buildProgress([setupOneDay()]));
    const claimResult: OnboardingClaimResult = {
      taskKey: 'd1_b',
      status: 'CLAIMED',
      claimed: true,
      linhThachGranted: 100,
      expGranted: 50,
    };
    claimTaskMock.mockResolvedValue(claimResult);
    const w = mountView();
    await flushPromises();

    await w.find('[data-testid="onboarding-day-card-1"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="onboarding-claim-d1_b"]').trigger('click');
    await flushPromises();

    expect(claimTaskMock).toHaveBeenCalledWith('d1_b');
    const calls = toastPushMock.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.text.includes('100'))).toBe(true);
  });

  it('open button → router.push to actionRoute', async () => {
    fetchProgressMock.mockResolvedValue(buildProgress([setupOneDay()]));
    const w = mountView();
    await flushPromises();

    await w.find('[data-testid="onboarding-day-card-1"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="onboarding-open-d1_a"]').trigger('click');
    await flushPromises();

    expect(routerPushMock).toHaveBeenCalledWith('/inventory');
  });

  it('back button → return to day grid', async () => {
    fetchProgressMock.mockResolvedValue(buildProgress([setupOneDay()]));
    const w = mountView();
    await flushPromises();

    await w.find('[data-testid="onboarding-day-card-1"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="onboarding-back"]').exists()).toBe(true);

    await w.find('[data-testid="onboarding-back"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-testid="onboarding-day-grid"]').exists()).toBe(true);
  });
});
