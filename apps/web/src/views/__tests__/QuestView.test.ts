import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { QuestProgressView, QuestStatus } from '@/api/quest';

const fetchQuestsMock = vi.fn();
const acceptQuestMock = vi.fn();
const claimQuestMock = vi.fn();

vi.mock('@/api/quest', () => ({
  fetchQuests: (...a: unknown[]) => fetchQuestsMock(...a),
  acceptQuest: (...a: unknown[]) => acceptQuestMock(...a),
  claimQuest: (...a: unknown[]) => claimQuestMock(...a),
}));

const fetchStoryDungeonListMock = vi.fn();
vi.mock('@/api/storyDungeon', () => ({
  fetchStoryDungeonList: (...a: unknown[]) => fetchStoryDungeonListMock(...a),
  fetchStoryDungeon: vi.fn(),
  startStoryDungeon: vi.fn(),
  advanceStoryDungeon: vi.fn(),
  clearStoryDungeon: vi.fn(),
  claimStoryDungeon: vi.fn(),
}));

const routerPushMock = vi.fn();

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
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
    character: { id: 'c1', realmKey: 'phamnhan' },
    fetchState: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: routerPushMock }),
}));

import QuestView from '@/views/QuestView.vue';

const messages = {
  vi: {
    common: { loadingData: 'Đang tải…' },
    quest: {
      title: 'Nhiệm Vụ',
      subtitle: '',
      totalCount: 'Đã hiện: {n}',
      empty: 'Chưa có nhiệm vụ',
      emptyFiltered: 'Không có nhiệm vụ {kind}',
      expand: 'Xem',
      collapse: 'Thu gọn',
      accept: 'Nhận',
      claim: 'Nhận thưởng',
      acceptOk: 'Đã nhận {quest}',
      claimOk: 'Đã nhận thưởng {quest}: +{linhThach}, +{exp}',
      acceptedHint: 'Đang thực hiện',
      claimedHint: 'Đã lĩnh',
      lockedHint: 'Khoá',
      steps: 'Bước',
      rewards: 'Thưởng',
      filter: { all: 'Tất cả' },
      kind: {
        main: 'Chính',
        realm: 'Realm',
        sect: 'Tông',
        npc: 'NPC',
        grind: 'Grind',
      },
      stepKind: { kill: 'Diệt', collect: 'Thu', talk: 'Talk', explore: 'Explore', choice: 'Chọn' },
      stepHint: { foundIn: 'Tìm tại: {dungeons}' },
      status: {
        LOCKED: 'Khoá',
        AVAILABLE: 'Sẵn',
        ACCEPTED: 'Đang',
        COMPLETED: 'Done',
        CLAIMED: 'Đã lĩnh',
      },
      reward: {
        linhThach: '{n} LT',
        tienNgoc: '{n} TN',
        exp: '{n} EXP',
        congHien: '{n} CH',
        item: '{itemKey}×{qty}',
      },
      errors: {
        QUEST_LOCKED_REALM: 'Realm thấp',
        QUEST_NOT_COMPLETED: 'Chưa xong',
        UNKNOWN: 'Lỗi',
      },
    },
  },
};

function buildQuest(
  partial: Partial<QuestProgressView> & { key: string; status: QuestStatus },
): QuestProgressView {
  return {
    key: partial.key,
    name: partial.name ?? `Quest ${partial.key}`,
    description: partial.description ?? 'desc',
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

function mountView() {
  const i18n = makeI18n();
  return mount(QuestView, {
    global: { plugins: [i18n] },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  fetchQuestsMock.mockReset();
  acceptQuestMock.mockReset();
  claimQuestMock.mockReset();
  toastPushMock.mockReset();
  fetchStoryDungeonListMock.mockReset();
  // Default: no story dungeons available — existing tests don't expect CTAs.
  // CTA-specific tests override this in their setup.
  fetchStoryDungeonListMock.mockResolvedValue({ dungeons: [], activeRun: null });
  routerPushMock.mockReset();
});

describe('QuestView — render', () => {
  it('loaded + danh sách quest hiển thị + status badge đúng', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q_main', status: 'AVAILABLE', kind: 'main' }),
      buildQuest({ key: 'q_acc', status: 'ACCEPTED', kind: 'sect' }),
      buildQuest({ key: 'q_done', status: 'COMPLETED', kind: 'main' }),
      buildQuest({ key: 'q_claimed', status: 'CLAIMED', kind: 'realm' }),
      buildQuest({ key: 'q_lock', status: 'LOCKED', kind: 'realm' }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="quest-list"]').exists()).toBe(true);
    expect(w.find('[data-testid="quest-row-q_main"]').exists()).toBe(true);
    expect(w.find('[data-testid="quest-row-q_acc"]').exists()).toBe(true);
    expect(w.find('[data-testid="quest-status-q_acc"]').text()).toBe('Đang');
    expect(w.find('[data-testid="quest-status-q_done"]').text()).toBe('Done');
    expect(w.find('[data-testid="quest-status-q_lock"]').text()).toBe('Khoá');
    expect(w.find('[data-testid="quest-total-count"]').text()).toContain('5');
  });

  it('loading khi chưa loaded', async () => {
    let resolveFn: (v: QuestProgressView[]) => void = () => {};
    fetchQuestsMock.mockReturnValue(
      new Promise<QuestProgressView[]>((resolve) => {
        resolveFn = resolve;
      }),
    );
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="quest-loading"]').exists()).toBe(true);
    resolveFn([]);
    await flushPromises();
  });

  it('error envelope → render quest-error + i18n key', async () => {
    fetchQuestsMock.mockRejectedValue({ code: 'QUEST_LOCKED_REALM' });
    const w = mountView();
    await flushPromises();
    const err = w.find('[data-testid="quest-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toBe('Realm thấp');
  });

  it('empty filtered → render quest-empty với kind label', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q_only', status: 'AVAILABLE', kind: 'main' }),
    ]);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="quest-filter-sect"]').trigger('click');
    await flushPromises();
    const empty = w.find('[data-testid="quest-empty"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain('Tông');
  });
});

describe('QuestView — filter', () => {
  it('click filter main → chỉ render quest main', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q_main', status: 'AVAILABLE', kind: 'main' }),
      buildQuest({ key: 'q_sect', status: 'AVAILABLE', kind: 'sect' }),
      buildQuest({ key: 'q_grind', status: 'AVAILABLE', kind: 'grind' }),
    ]);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="quest-filter-main"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="quest-row-q_main"]').exists()).toBe(true);
    expect(w.find('[data-testid="quest-row-q_sect"]').exists()).toBe(false);
    expect(w.find('[data-testid="quest-row-q_grind"]').exists()).toBe(false);
  });

  it('click filter all (sau khi đã lọc) → render lại tất cả', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q_main', status: 'AVAILABLE', kind: 'main' }),
      buildQuest({ key: 'q_sect', status: 'AVAILABLE', kind: 'sect' }),
    ]);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="quest-filter-main"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="quest-row-q_sect"]').exists()).toBe(false);
    await w.find('[data-testid="quest-filter-all"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="quest-row-q_sect"]').exists()).toBe(true);
  });
});

describe('QuestView — accept button', () => {
  it('AVAILABLE → click accept → call API + toast success', async () => {
    fetchQuestsMock
      .mockResolvedValueOnce([
        buildQuest({ key: 'q1', status: 'AVAILABLE' }),
      ])
      .mockResolvedValueOnce([
        buildQuest({ key: 'q1', status: 'ACCEPTED' }),
      ]);
    acceptQuestMock.mockResolvedValue(
      buildQuest({ key: 'q1', status: 'ACCEPTED' }),
    );
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="quest-accept-q1"]').trigger('click');
    await flushPromises();
    expect(acceptQuestMock).toHaveBeenCalledWith('q1');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
    // After reload, status = ACCEPTED → accept button gone, hint visible
    expect(w.find('[data-testid="quest-accept-q1"]').exists()).toBe(false);
    expect(w.find('[data-testid="quest-accepted-hint-q1"]').exists()).toBe(true);
  });

  it('accept fail → toast error theo i18n key', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q1', status: 'AVAILABLE' }),
    ]);
    acceptQuestMock.mockRejectedValue({ code: 'QUEST_LOCKED_REALM' });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="quest-accept-q1"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text: 'Realm thấp' }),
    );
  });

  it('ACCEPTED status → KHÔNG có accept button + có hint', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q1', status: 'ACCEPTED' }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="quest-accept-q1"]').exists()).toBe(false);
    expect(w.find('[data-testid="quest-accepted-hint-q1"]').exists()).toBe(true);
  });
});

describe('QuestView — claim button', () => {
  it('COMPLETED → click claim → call API + toast success + reload', async () => {
    fetchQuestsMock
      .mockResolvedValueOnce([
        buildQuest({ key: 'q1', status: 'COMPLETED' }),
      ])
      .mockResolvedValueOnce([
        buildQuest({ key: 'q1', status: 'CLAIMED' }),
      ]);
    claimQuestMock.mockResolvedValue({
      questKey: 'q1',
      claimedAt: '2026-05-05T00:00:00.000Z',
      granted: {
        linhThach: 100,
        tienNgoc: 0,
        exp: 1500,
        congHien: 0,
        items: [],
      },
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="quest-claim-q1"]').trigger('click');
    await flushPromises();
    expect(claimQuestMock).toHaveBeenCalledWith('q1');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
    // After reload status = CLAIMED → claim button gone
    expect(w.find('[data-testid="quest-claim-q1"]').exists()).toBe(false);
    expect(w.find('[data-testid="quest-claimed-hint-q1"]').exists()).toBe(true);
  });

  it('AVAILABLE status → KHÔNG có claim button (UI không claim khi chưa COMPLETED)', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q1', status: 'AVAILABLE' }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="quest-claim-q1"]').exists()).toBe(false);
  });

  it('claim fail (server reject) → toast error', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q1', status: 'COMPLETED' }),
    ]);
    claimQuestMock.mockRejectedValue({ code: 'QUEST_NOT_COMPLETED' });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="quest-claim-q1"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text: 'Chưa xong' }),
    );
  });
});

describe('QuestView — toggle expand', () => {
  it('click toggle → render quest-details', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({
        key: 'q1',
        status: 'AVAILABLE',
        steps: [
          {
            id: 'step1',
            kind: 'kill',
            description: 'Diệt yêu',
            targetType: 'monster',
            targetId: 'monster_x',
            count: 5,
            currentCount: 0,
            done: false,
          },
        ],
        rewards: { linhThach: 100, exp: 1500 },
      }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="quest-details-q1"]').exists()).toBe(false);
    await w.find('[data-testid="quest-toggle-q1"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="quest-details-q1"]').exists()).toBe(true);
    expect(w.find('[data-testid="quest-details-q1"]').text()).toContain('100');
    expect(w.find('[data-testid="quest-details-q1"]').text()).toContain('1500');
  });
});

describe('QuestView — Phase 12 Story dungeon hint cho kill+monster step', () => {
  // Hint render qua shared helper `findDungeonsForQuestPlaceholder`. Dùng
  // monster key thật từ catalog để test resolve thật (không mock helper) —
  // close E2E loop catalog → helper → FE render.

  it('kill+monster step với targetId wired vào dungeon → render "Tìm tại: <dungeon name>" hint', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({
        key: 'q_late_game',
        status: 'ACCEPTED',
        steps: [
          {
            id: 'step1',
            // `tich_linh_anh` lvl 5 wire vào `hac_lam` dungeon (PR #439).
            kind: 'kill',
            description: 'Diệt 5 Tịch Linh Ảnh',
            targetType: 'monster',
            targetId: 'tich_linh_anh',
            count: 5,
            currentCount: 2,
            done: false,
          },
        ],
      }),
    ]);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="quest-toggle-q_late_game"]').trigger('click');
    await flushPromises();
    const hint = w.find(
      '[data-testid="quest-step-hint-q_late_game-step1"]',
    );
    expect(hint.exists()).toBe(true);
    // Dungeon `hac_lam` có name "Hắc Lâm" trong catalog.
    expect(hint.text()).toContain('Hắc Lâm');
    expect(hint.text()).toContain('Tìm tại');
  });

  it('kill+monster step với targetId qua questTargetIds alias → resolve hint qua alias', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({
        key: 'q_pr6',
        status: 'ACCEPTED',
        steps: [
          {
            id: 'step1',
            // `son_thu` placeholder của PR-6 critical-path — alias trên
            // `son_thu_lon` (lvl 1, wire vào `son_coc` dungeon).
            kind: 'kill',
            description: 'Diệt 3 Sơn Thú',
            targetType: 'monster',
            targetId: 'son_thu',
            count: 3,
            currentCount: 0,
            done: false,
          },
        ],
      }),
    ]);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="quest-toggle-q_pr6"]').trigger('click');
    await flushPromises();
    const hint = w.find('[data-testid="quest-step-hint-q_pr6-step1"]');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain('Tìm tại');
  });

  it('kill+monster step với targetId orphan → KHÔNG render hint (no dungeon match)', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({
        key: 'q_orphan',
        status: 'ACCEPTED',
        steps: [
          {
            id: 'step1',
            kind: 'kill',
            description: 'Diệt orphan',
            targetType: 'monster',
            targetId: 'this_monster_not_in_any_dungeon',
            count: 1,
            currentCount: 0,
            done: false,
          },
        ],
      }),
    ]);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="quest-toggle-q_orphan"]').trigger('click');
    await flushPromises();
    expect(
      w.find('[data-testid="quest-step-hint-q_orphan-step1"]').exists(),
    ).toBe(false);
  });

  it('non-kill step (vd talk) → KHÔNG render hint', async () => {
    fetchQuestsMock.mockResolvedValue([
      buildQuest({
        key: 'q_talk',
        status: 'ACCEPTED',
        steps: [
          {
            id: 'step1',
            kind: 'talk',
            description: 'Đối thoại sư phụ',
            targetType: 'npc',
            targetId: 'npc_master',
            count: 1,
            currentCount: 0,
            done: false,
          },
        ],
      }),
    ]);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="quest-toggle-q_talk"]').trigger('click');
    await flushPromises();
    expect(
      w.find('[data-testid="quest-step-hint-q_talk-step1"]').exists(),
    ).toBe(false);
  });
});

describe('QuestView — Phase 12.8 Story Dungeon CTA', () => {
  // Cover §F mục 6: CTA "Vào bí cảnh cốt truyện" hiển thị đúng status quest +
  // chỉ khi storyDungeonStore có entry match `requiredQuestKey`. Click → router.push
  // tới `/story-dungeons` (player navigate vào StoryDungeonView để start).
  //
  // Mock `fetchStoryDungeonListMock` ở từng test riêng để cover từng trạng thái —
  // beforeEach đã default empty list (no CTA).

  const sdView = {
    key: 'sd_q1',
    titleI18nKey: 'story.sd_q1.title',
    descriptionI18nKey: 'story.sd_q1.desc',
    titleVi: 'Bí Cảnh Sơn Cốc',
    descriptionVi: 'desc',
    requiredQuestKey: 'q_main',
    requiredQuestStep: null,
    regionKey: 'son_coc',
    recommendedRealm: 'phamnhan',
    minRealmKey: null,
    npcKey: null,
    entryDialogueKey: null,
    clearDialogueKey: null,
    monsters: [],
    boss: null,
    rewardHint: null,
    oneTime: true,
    status: 'available' as const,
  };

  it('quest ACCEPTED + có story dungeon match → render CTA quest-story-dungeon-cta-{key}', async () => {
    fetchStoryDungeonListMock.mockResolvedValue({
      dungeons: [sdView],
      activeRun: null,
    });
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q_main', status: 'ACCEPTED', kind: 'main' }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="quest-story-dungeon-cta-q_main"]').exists()).toBe(true);
    w.unmount();
  });

  it('quest AVAILABLE + có story dungeon match → render CTA', async () => {
    fetchStoryDungeonListMock.mockResolvedValue({
      dungeons: [sdView],
      activeRun: null,
    });
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q_main', status: 'AVAILABLE', kind: 'main' }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="quest-story-dungeon-cta-q_main"]').exists()).toBe(true);
    w.unmount();
  });

  it('quest LOCKED + có story dungeon match → KHÔNG render CTA', async () => {
    fetchStoryDungeonListMock.mockResolvedValue({
      dungeons: [sdView],
      activeRun: null,
    });
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q_main', status: 'LOCKED', kind: 'main' }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="quest-story-dungeon-cta-q_main"]').exists()).toBe(false);
    w.unmount();
  });

  it('quest CLAIMED + có story dungeon match → KHÔNG render CTA (đã đi qua)', async () => {
    fetchStoryDungeonListMock.mockResolvedValue({
      dungeons: [sdView],
      activeRun: null,
    });
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q_main', status: 'CLAIMED', kind: 'main' }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="quest-story-dungeon-cta-q_main"]').exists()).toBe(false);
    w.unmount();
  });

  it('quest ACCEPTED + KHÔNG có story dungeon match → KHÔNG render CTA', async () => {
    fetchStoryDungeonListMock.mockResolvedValue({
      dungeons: [{ ...sdView, requiredQuestKey: 'other_quest' }],
      activeRun: null,
    });
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q_main', status: 'ACCEPTED', kind: 'main' }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="quest-story-dungeon-cta-q_main"]').exists()).toBe(false);
    w.unmount();
  });

  it('storyDungeonStore.load fail → CTA fail-soft (KHÔNG crash + KHÔNG CTA)', async () => {
    fetchStoryDungeonListMock.mockRejectedValue({ code: 'NO_CHARACTER' });
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q_main', status: 'ACCEPTED', kind: 'main' }),
    ]);
    const w = mountView();
    await flushPromises();
    // Quest list vẫn render bình thường
    expect(w.find('[data-testid="quest-row-q_main"]').exists()).toBe(true);
    expect(w.find('[data-testid="quest-story-dungeon-cta-q_main"]').exists()).toBe(false);
    w.unmount();
  });

  it('click CTA → router.push("/story-dungeons")', async () => {
    fetchStoryDungeonListMock.mockResolvedValue({
      dungeons: [sdView],
      activeRun: null,
    });
    fetchQuestsMock.mockResolvedValue([
      buildQuest({ key: 'q_main', status: 'ACCEPTED', kind: 'main' }),
    ]);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="quest-story-dungeon-cta-q_main"]').trigger('click');
    expect(routerPushMock).toHaveBeenCalledWith('/story-dungeons');
    w.unmount();
  });
});
