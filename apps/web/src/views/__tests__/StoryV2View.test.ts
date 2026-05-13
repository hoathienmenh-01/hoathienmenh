import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type {
  Phase33ChapterView,
  Phase33ClaimResult,
  Phase33QuestView,
} from '@/api/storyV2';

/**
 * Phase 33.2 — StoryV2View UI smoke coverage.
 *
 * Cover:
 *   1. Loaded → render chapter cards + status badges + counters.
 *   2. Click chapter card → fetch quests + render quest list.
 *   3. Accept button → POST /story/v2/quests/accept + toast success.
 *   4. Claim button → POST /story/v2/quests/claim + toast success.
 *   5. Locked chapter → button disabled.
 *
 * Mock `@/api/storyV2` để Pinia store thật chạy → cover store ↔ view loop.
 */

const fetchChaptersMock = vi.fn();
const fetchQuestsMock = vi.fn();
const fetchDialoguesMock = vi.fn();
const acceptMock = vi.fn();
const progressMock = vi.fn();
const completeMock = vi.fn();
const claimMock = vi.fn();

vi.mock('@/api/storyV2', () => ({
  fetchPhase33Chapters: (...a: unknown[]) => fetchChaptersMock(...a),
  fetchPhase33Quests: (...a: unknown[]) => fetchQuestsMock(...a),
  fetchPhase33Dialogues: (...a: unknown[]) => fetchDialoguesMock(...a),
  acceptPhase33Quest: (...a: unknown[]) => acceptMock(...a),
  progressPhase33Quest: (...a: unknown[]) => progressMock(...a),
  completePhase33Quest: (...a: unknown[]) => completeMock(...a),
  claimPhase33Quest: (...a: unknown[]) => claimMock(...a),
}));

const toastPushMock = vi.fn();

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    isAuthenticated: true,
    hydrate: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    character: { id: 'c1', realmKey: 'do_kiep' },
    fetchState: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

const routerReplaceMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: vi.fn() }),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

import StoryV2View from '@/views/StoryV2View.vue';

const messages = {
  vi: {
    common: { loadingData: 'Đang tải…' },
    storyV2: {
      title: 'Tu Tiên Lộ',
      subtitle: 'sub',
      totalCount: 'Chương: {n}',
      inProgressCount: 'Đang tiến: {n}',
      completedCount: 'Đã viên mãn: {n}',
      empty: 'Chưa có chương.',
      mainProgress: '{done}/{total}',
      back: 'Trở lại',
      noQuest: 'Trống.',
      acceptToast: 'Nhận: {name}.',
      completeToast: 'Hoàn thành: {name}.',
      claimToast: 'Lĩnh {name} +{linhThach} +{exp}.',
      chapterStatus: {
        LOCKED: 'Khoá',
        AVAILABLE: 'Khả dụng',
        IN_PROGRESS: 'Đang tiến',
        COMPLETED: 'Viên mãn',
      },
      questStatus: {
        LOCKED: 'Khoá',
        AVAILABLE: 'Khả dụng',
        ACCEPTED: 'Đang làm',
        COMPLETED: 'Hoàn thành',
        CLAIMED: 'Đã thưởng',
      },
      kindTab: {
        all: 'Tất cả',
        main: 'Chính',
        side: 'Phụ',
        branch: 'Nhánh',
        hidden: 'Ẩn',
        daily: 'Ngày',
        weekly: 'Tuần',
      },
      actions: {
        accept: 'Nhận',
        complete: 'Báo',
        claim: 'Thưởng',
        claimed: 'Đã lĩnh',
      },
      error: {
        UNKNOWN_ERROR: 'Lỗi.',
      },
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

function buildChapter(
  partial: Partial<Phase33ChapterView> & {
    chapKey: string;
    status: Phase33ChapterView['status'];
  },
): Phase33ChapterView {
  return {
    chapKey: partial.chapKey,
    volumeKey: partial.volumeKey ?? 'quyen_ii_tien_gioi',
    titleVi: partial.titleVi ?? `Chương ${partial.chapKey}`,
    titleEn: partial.titleEn ?? `Chapter ${partial.chapKey}`,
    themeVi: partial.themeVi ?? 'theme',
    themeEn: partial.themeEn ?? 'theme',
    status: partial.status,
    mainQuestsTotal: partial.mainQuestsTotal ?? 16,
    mainQuestsCompletedCount: partial.mainQuestsCompletedCount ?? 0,
    unlockedAt: partial.unlockedAt ?? null,
    completedAt: partial.completedAt ?? null,
    storyFlags: partial.storyFlags ?? [],
  };
}

function buildQuest(
  partial: Partial<Phase33QuestView> & {
    questKey: string;
    status: Phase33QuestView['status'];
  },
): Phase33QuestView {
  return {
    questKey: partial.questKey,
    kind: partial.kind ?? 'main',
    chapKey: partial.chapKey ?? 'chap_9_loi_kiep_phi_thang',
    volumeKey: partial.volumeKey ?? 'quyen_ii_tien_gioi',
    titleVi: partial.titleVi ?? `Quest ${partial.questKey}`,
    titleEn: partial.titleEn ?? `Quest ${partial.questKey}`,
    descriptionVi: partial.descriptionVi ?? 'desc',
    descriptionEn: partial.descriptionEn ?? 'desc',
    giverNpcKey: partial.giverNpcKey ?? 'tich_thien_thanh_su',
    requiredRealmKey: partial.requiredRealmKey ?? 'do_kiep',
    requiredRealmOrder: partial.requiredRealmOrder ?? 11,
    prerequisiteQuestKey: partial.prerequisiteQuestKey ?? null,
    status: partial.status,
    steps: partial.steps ?? [],
    completable: partial.completable ?? false,
    acceptedAt: partial.acceptedAt ?? null,
    completedAt: partial.completedAt ?? null,
    claimedAt: partial.claimedAt ?? null,
    rewards: partial.rewards ?? { linhThach: 100, exp: 200 },
  };
}

function mountView() {
  return mount(StoryV2View, {
    attachTo: document.body,
    global: { plugins: [makeI18n()] },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  fetchChaptersMock.mockReset();
  fetchQuestsMock.mockReset();
  fetchDialoguesMock.mockReset();
  acceptMock.mockReset();
  progressMock.mockReset();
  completeMock.mockReset();
  claimMock.mockReset();
  toastPushMock.mockReset();
  routerReplaceMock.mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('StoryV2View — chapter list', () => {
  it('loaded → render chapter cards + status badges + counters', async () => {
    fetchChaptersMock.mockResolvedValue([
      buildChapter({ chapKey: 'c1', status: 'AVAILABLE', titleVi: 'A' }),
      buildChapter({ chapKey: 'c2', status: 'IN_PROGRESS', titleVi: 'B' }),
      buildChapter({ chapKey: 'c3', status: 'COMPLETED', titleVi: 'C' }),
    ]);
    const w = mountView();
    await flushPromises();

    expect(w.find('[data-testid="story-v2-view"]').exists()).toBe(true);
    expect(w.find('[data-testid="story-v2-chapter-list"]').exists()).toBe(true);
    expect(w.find('[data-testid="story-v2-chapter-card-c1"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-testid="story-v2-chapter-status-c1"]').text()).toBe(
      'Khả dụng',
    );
    expect(w.find('[data-testid="story-v2-chapter-status-c2"]').text()).toBe(
      'Đang tiến',
    );
    expect(w.find('[data-testid="story-v2-chapter-status-c3"]').text()).toBe(
      'Viên mãn',
    );
    expect(w.find('[data-testid="story-v2-total-count"]').text()).toContain(
      '3',
    );
    expect(
      w.find('[data-testid="story-v2-in-progress-count"]').text(),
    ).toContain('1');
    expect(w.find('[data-testid="story-v2-completed-count"]').text()).toContain(
      '1',
    );
    w.unmount();
  });

  it('loaded empty → render empty placeholder', async () => {
    fetchChaptersMock.mockResolvedValue([]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="story-v2-empty"]').exists()).toBe(true);
    w.unmount();
  });
});

describe('StoryV2View — chapter detail + quest actions', () => {
  it('click chapter → fetch quests + render quest list with main tab default', async () => {
    fetchChaptersMock.mockResolvedValue([
      buildChapter({ chapKey: 'c1', status: 'AVAILABLE', titleVi: 'A' }),
    ]);
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ questKey: 'q1', status: 'AVAILABLE', titleVi: 'Q1' }),
      buildQuest({
        questKey: 'q2_side',
        status: 'AVAILABLE',
        kind: 'side',
        titleVi: 'Q2',
      }),
    ]);
    const w = mountView();
    await flushPromises();

    await w.find('[data-testid="story-v2-chapter-card-c1"]').trigger('click');
    await flushPromises();

    expect(w.find('[data-testid="story-v2-chapter-detail"]').exists()).toBe(
      true,
    );
    // Main tab default → q1 (main) hiển thị, q2_side (side) ẩn.
    expect(w.find('[data-testid="story-v2-quest-q1"]').exists()).toBe(true);
    expect(w.find('[data-testid="story-v2-quest-q2_side"]').exists()).toBe(
      false,
    );

    // Click side tab → q2_side hiển thị.
    await w.find('[data-testid="story-v2-tab-side"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="story-v2-quest-q2_side"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-testid="story-v2-quest-q1"]').exists()).toBe(false);
    w.unmount();
  });

  it('accept button → API + toast success', async () => {
    fetchChaptersMock.mockResolvedValue([
      buildChapter({ chapKey: 'c1', status: 'AVAILABLE' }),
    ]);
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ questKey: 'q1', status: 'AVAILABLE', titleVi: 'Q1' }),
    ]);
    acceptMock.mockResolvedValue(
      buildQuest({ questKey: 'q1', status: 'ACCEPTED' }),
    );
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="story-v2-chapter-card-c1"]').trigger('click');
    await flushPromises();

    await w.find('[data-testid="story-v2-accept-q1"]').trigger('click');
    await flushPromises();

    expect(acceptMock).toHaveBeenCalledWith('q1');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
    w.unmount();
  });

  it('claim button COMPLETED → API + toast claim', async () => {
    fetchChaptersMock.mockResolvedValue([
      buildChapter({ chapKey: 'c1', status: 'IN_PROGRESS' }),
    ]);
    fetchQuestsMock.mockResolvedValue([
      buildQuest({
        questKey: 'q1',
        status: 'COMPLETED',
        titleVi: 'Q1',
        completable: true,
      }),
    ]);
    const claimResult: Phase33ClaimResult = {
      questKey: 'q1',
      claimedAt: '2026-05-13T00:00:00.000Z',
      granted: {
        linhThach: 100,
        exp: 200,
        congHien: 0,
        items: [],
        affinity: [],
        storyFlags: [],
      },
    };
    claimMock.mockResolvedValue(claimResult);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="story-v2-chapter-card-c1"]').trigger('click');
    await flushPromises();

    await w.find('[data-testid="story-v2-claim-q1"]').trigger('click');
    await flushPromises();
    expect(claimMock).toHaveBeenCalledWith('q1');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
    w.unmount();
  });

  it('LOCKED chapter → click disabled (no quest fetch)', async () => {
    fetchChaptersMock.mockResolvedValue([
      buildChapter({ chapKey: 'c_locked', status: 'LOCKED' }),
    ]);
    const w = mountView();
    await flushPromises();
    const card = w.find('[data-testid="story-v2-chapter-card-c_locked"]');
    expect(card.attributes('disabled')).toBeDefined();
    w.unmount();
  });
});
