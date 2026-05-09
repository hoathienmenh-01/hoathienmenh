import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import NpcAffinityPanel from '@/components/NpcAffinityPanel.vue';
import { useNpcAffinityStore } from '@/stores/npcAffinity';
import * as api from '@/api/npcAffinity';
import type { NpcAffinityView } from '@/api/npcAffinity';

vi.mock('@/api/npcAffinity', () => ({
  fetchNpcAffinities: vi.fn(),
  fetchNpcAffinity: vi.fn(),
  // Phase 12.10.B — gift API mocks.
  giftNpc: vi.fn(),
  fetchNpcGiftDaily: vi.fn(),
  // Phase 12.10.C — shop + unlocks API mocks.
  fetchNpcShop: vi.fn(),
  buyNpcShopItem: vi.fn(),
  fetchNpcUnlocks: vi.fn(),
}));

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: {
        refresh: 'Làm mới',
        loadingData: 'Đang tải dữ liệu…',
        loading: 'Đang xử lý…',
      },
      npcAffinity: {
        title: 'Quan Hệ Đạo Hữu',
        subtitle: 'Mỗi NPC có thân tình riêng.',
        empty: 'Chưa kết duyên cùng đạo hữu nào.',
        nextTierHint: 'Còn {points} điểm để lên {tier}.',
        maxTierReached: 'Đã đạt đỉnh quan hệ.',
        // Phase 12.10.B
        giftLabel: 'Tặng',
        giftButton: 'Trao quà',
        giftLocked: 'Hết lượt ({used}/{limit})',
        giftDaily: 'Hôm nay {used}/{limit}',
        giftSuccess: 'Thân tình +{delta}',
        giftTierUp: 'Đã lên cảnh giới {tier}',
        errors: {
          UNKNOWN: 'Không thể tải quan hệ.',
        },
        giftErrors: {
          ITEM_NOT_IN_INVENTORY: 'Túi đồ không có vật phẩm.',
          DAILY_LIMIT_REACHED: 'Đã hết lượt tặng hôm nay.',
          UNKNOWN: 'Không thể tặng quà.',
        },
        // Phase 12.10.C
        shopToggle: 'Cửa hàng & ưu đãi đặc biệt',
        shop: {
          buy: 'Mua',
          lockedShort: 'Khoá',
          limitReached: 'Hết lượt',
          linhThach: 'linh thạch',
          tienNgoc: 'tiên ngọc',
          locked: 'Cần đạt {tier}',
          dailyStock: 'Hôm nay {used}/{limit}',
          weeklyStock: 'Tuần này {used}/{limit}',
          unlimitedStock: 'Không giới hạn',
        },
        shopErrors: {
          INSUFFICIENT_AFFINITY_TIER: 'Quan hệ chưa đủ để mua.',
          INSUFFICIENT_FUNDS: 'Không đủ linh thạch.',
          DAILY_LIMIT_REACHED: 'Hết lượt mua hôm nay.',
          UNKNOWN: 'Không thể mua, thử lại.',
        },
        unlocks: {
          title: 'Cơ duyên ẩn',
          dialogueLabel: 'Đối thoại',
          questLabel: 'Nhiệm vụ',
        },
      },
    },
  },
});

function makeAffinity(overrides: Partial<NpcAffinityView> = {}): NpcAffinityView {
  return {
    npcKey: 'npc_lang_van_sinh',
    npcName: 'Lăng Vân Sinh',
    score: 35,
    minScore: -50,
    maxScore: 200,
    initialScore: 0,
    currentTier: {
      key: 'ban_huu',
      label: 'Bằng Hữu',
      labelEn: 'Companion',
      minScore: 30,
      order: 2,
    },
    nextTier: {
      key: 'tri_giao',
      label: 'Tri Giao',
      labelEn: 'Confidant',
      minScore: 60,
      order: 3,
      pointsToReach: 25,
    },
    unlocks: [
      {
        tierKey: 'quen_biet',
        tierLabel: 'Quen Biết',
        tierLabelEn: 'Acquaintance',
        tierMinScore: 10,
        description: 'Mở dialogue tâm sự sơ giao.',
        descriptionEn: 'Unlocks small-talk dialogue.',
        reached: true,
      },
      {
        tierKey: 'ban_huu',
        tierLabel: 'Bằng Hữu',
        tierLabelEn: 'Companion',
        tierMinScore: 30,
        description: 'Bí cảnh được mở khoá.',
        descriptionEn: 'Hidden realm unlocked.',
        reached: true,
      },
      {
        tierKey: 'tri_giao',
        tierLabel: 'Tri Giao',
        tierLabelEn: 'Confidant',
        tierMinScore: 60,
        description: 'Bí ẩn nhân vật được hé lộ.',
        descriptionEn: 'Character secret revealed.',
        reached: false,
      },
    ],
    ...overrides,
  };
}

function mountPanel(props: { autoLoad?: boolean } = { autoLoad: false }) {
  return mount(NpcAffinityPanel, {
    props,
    global: { plugins: [i18n] },
  });
}

describe('NpcAffinityPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(api.fetchNpcAffinities).mockReset();
    vi.mocked(api.fetchNpcAffinity).mockReset();
  });

  it('renders empty state when affinities array is empty', async () => {
    const store = useNpcAffinityStore();
    store.affinities = [];
    store.loaded = true;
    const w = mountPanel();
    await w.vm.$nextTick();
    const empty = w.find('[data-testid="npc-affinity-empty"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain('Chưa kết duyên');
  });

  it('renders loading state', async () => {
    const store = useNpcAffinityStore();
    store.loading = true;
    const w = mountPanel();
    await w.vm.$nextTick();
    const loading = w.find('[data-testid="npc-affinity-loading"]');
    expect(loading.exists()).toBe(true);
  });

  it('renders error state', async () => {
    const store = useNpcAffinityStore();
    store.error = 'UNKNOWN';
    const w = mountPanel();
    await w.vm.$nextTick();
    const err = w.find('[data-testid="npc-affinity-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain('Không thể tải quan hệ.');
  });

  it('renders NPC name, score, tier, next tier hint, and unlocks', async () => {
    const store = useNpcAffinityStore();
    store.affinities = [makeAffinity()];
    store.loaded = true;
    const w = mountPanel();
    await w.vm.$nextTick();
    expect(w.find('[data-testid="npc-affinity-name-npc_lang_van_sinh"]').text()).toBe(
      'Lăng Vân Sinh',
    );
    expect(w.find('[data-testid="npc-affinity-tier-npc_lang_van_sinh"]').text()).toBe(
      'Bằng Hữu',
    );
    expect(w.find('[data-testid="npc-affinity-score-npc_lang_van_sinh"]').text()).toContain(
      '35/200',
    );
    expect(w.find('[data-testid="npc-affinity-next-npc_lang_van_sinh"]').text()).toContain(
      'Còn 25 điểm',
    );
    const unlocks = w.find('[data-testid="npc-affinity-unlocks-npc_lang_van_sinh"]');
    expect(unlocks.exists()).toBe(true);
    expect(unlocks.text()).toContain('Mở dialogue tâm sự sơ giao.');
    expect(unlocks.text()).toContain('Bí ẩn nhân vật được hé lộ.');
  });

  it('hides next-tier hint and shows max tier reached when nextTier is null', async () => {
    const store = useNpcAffinityStore();
    store.affinities = [makeAffinity({ nextTier: null, score: 100 })];
    store.loaded = true;
    const w = mountPanel();
    await w.vm.$nextTick();
    expect(w.find('[data-testid="npc-affinity-next-npc_lang_van_sinh"]').exists()).toBe(false);
    expect(w.text()).toContain('Đã đạt đỉnh quan hệ.');
  });

  it('progress bar width reflects (score - min) / (max - min)', async () => {
    const store = useNpcAffinityStore();
    // score=35, min=-50, max=200 → (35 - -50) / 250 = 0.34 → 34%
    store.affinities = [makeAffinity({ score: 35 })];
    store.loaded = true;
    const w = mountPanel();
    await w.vm.$nextTick();
    const bar = w.find(
      '[data-testid="npc-affinity-bar-npc_lang_van_sinh"]',
    ).element as HTMLElement;
    expect(bar.style.width).toBe('34%');
  });

  it('refresh button calls store.refresh()', async () => {
    const store = useNpcAffinityStore();
    store.affinities = [makeAffinity()];
    store.loaded = true;
    vi.mocked(api.fetchNpcAffinities).mockResolvedValue({
      affinities: [makeAffinity({ score: 50 })],
      caps: { perChoice: 20, perQuestReward: 40 },
    });
    const w = mountPanel();
    await w.vm.$nextTick();
    const btn = w.find('[data-testid="npc-affinity-refresh"]')
      .element as HTMLButtonElement;
    btn.click();
    await flushPromises();
    expect(api.fetchNpcAffinities).toHaveBeenCalledTimes(1);
  });

  it('autoLoad=true triggers store.load() on mount when not loaded', async () => {
    vi.mocked(api.fetchNpcAffinities).mockResolvedValue({
      affinities: [makeAffinity()],
      caps: { perChoice: 20, perQuestReward: 40 },
    });
    const w = mountPanel({ autoLoad: true });
    await flushPromises();
    expect(api.fetchNpcAffinities).toHaveBeenCalledTimes(1);
    expect(w.find('[data-testid="npc-affinity-name-npc_lang_van_sinh"]').exists()).toBe(true);
  });
});

// ============================================================================
// Phase 12.10.B — gift action UI flow.
// ============================================================================

describe('NpcAffinityPanel — Phase 12.10.B gift flow', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(api.fetchNpcAffinities).mockReset();
    vi.mocked(api.fetchNpcGiftDaily).mockReset();
    vi.mocked(api.giftNpc).mockReset();
  });

  function seedStore(opts: {
    affinity?: NpcAffinityView;
    daily?: api.NpcGiftDailyCount;
  } = {}): ReturnType<typeof useNpcAffinityStore> {
    const store = useNpcAffinityStore();
    store.affinities = [opts.affinity ?? makeAffinity()];
    store.loaded = true;
    if (opts.daily) {
      store.dailyCounts[opts.daily.npcKey] = opts.daily;
      store.dailyLoaded = true;
    }
    return store;
  }

  it('renders gift section khi NPC có gift preference (button + select + daily indicator)', async () => {
    seedStore();
    const w = mountPanel();
    await w.vm.$nextTick();
    const section = w.find('[data-testid="npc-affinity-gift-npc_lang_van_sinh"]');
    expect(section.exists()).toBe(true);
    expect(
      w.find('[data-testid="npc-affinity-gift-button-npc_lang_van_sinh"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="npc-affinity-gift-select-npc_lang_van_sinh"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="npc-affinity-gift-daily-npc_lang_van_sinh"]').text(),
    ).toContain('Hôm nay 0/');
    // Initial state — button không locked.
    const btn = w.find('[data-testid="npc-affinity-gift-button-npc_lang_van_sinh"]')
      .element as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain('Trao quà');
  });

  it('click gift button → store.giftNpc + toast hiển thị "+N"', async () => {
    seedStore();
    vi.mocked(api.giftNpc).mockResolvedValue({
      affinity: makeAffinity({ score: 41 }),
      gift: {
        npcKey: 'npc_lang_van_sinh',
        itemKey: 'linh_lo_dan',
        affinityDelta: 6,
        previousScore: 35,
        newScore: 41,
        tierChanged: false,
        dayBucket: '2026-06-01',
        sequence: 1,
        remainingToday: 4,
        dailyLimit: 5,
      },
    });
    const w = mountPanel();
    await w.vm.$nextTick();

    const btn = w.find('[data-testid="npc-affinity-gift-button-npc_lang_van_sinh"]')
      .element as HTMLButtonElement;
    btn.click();
    await flushPromises();

    expect(api.giftNpc).toHaveBeenCalledWith('npc_lang_van_sinh', 'linh_lo_dan');

    // Toast row hiện ra với delta.
    const toast = w.find('[data-testid="npc-affinity-gift-toast-npc_lang_van_sinh"]');
    expect(toast.exists()).toBe(true);
    expect(toast.text()).toContain('Thân tình +6');

    // Daily indicator update từ 0/5 → 1/5.
    expect(
      w.find('[data-testid="npc-affinity-gift-daily-npc_lang_van_sinh"]').text(),
    ).toContain('Hôm nay 1/');

    // Affinity score row update — refresh trong template.
    expect(
      w.find('[data-testid="npc-affinity-score-npc_lang_van_sinh"]').text(),
    ).toContain('41/');
  });

  it('toast tier-up hiển thị khi tierChanged=true', async () => {
    seedStore();
    vi.mocked(api.giftNpc).mockResolvedValue({
      affinity: makeAffinity({
        score: 60,
        currentTier: {
          key: 'tri_giao',
          label: 'Tri Giao',
          labelEn: 'Confidant',
          minScore: 60,
          order: 3,
        },
        nextTier: null,
      }),
      gift: {
        npcKey: 'npc_lang_van_sinh',
        itemKey: 'linh_lo_dan',
        affinityDelta: 25,
        previousScore: 35,
        newScore: 60,
        tierChanged: true,
        dayBucket: '2026-06-01',
        sequence: 1,
        remainingToday: 4,
        dailyLimit: 5,
      },
    });
    const w = mountPanel();
    await w.vm.$nextTick();
    const btn = w.find('[data-testid="npc-affinity-gift-button-npc_lang_van_sinh"]')
      .element as HTMLButtonElement;
    btn.click();
    await flushPromises();

    const toast = w.find('[data-testid="npc-affinity-gift-toast-npc_lang_van_sinh"]');
    expect(toast.text()).toContain('Đã lên cảnh giới Tri Giao');
  });

  it('button locked khi remainingToday=0 (label "Hết lượt")', async () => {
    seedStore({
      daily: {
        npcKey: 'npc_lang_van_sinh',
        dayBucket: '2026-06-01',
        usedToday: 5,
        dailyLimit: 5,
        remainingToday: 0,
      },
    });
    const w = mountPanel();
    await w.vm.$nextTick();
    const btn = w.find('[data-testid="npc-affinity-gift-button-npc_lang_van_sinh"]')
      .element as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('Hết lượt (5/5)');

    // Daily indicator hiện 5/5.
    expect(
      w.find('[data-testid="npc-affinity-gift-daily-npc_lang_van_sinh"]').text(),
    ).toContain('Hôm nay 5/5');

    // Click không trigger api.
    btn.click();
    await flushPromises();
    expect(api.giftNpc).not.toHaveBeenCalled();
  });

  it('inline error hiện khi gift reject (ITEM_NOT_IN_INVENTORY)', async () => {
    seedStore();
    vi.mocked(api.giftNpc).mockRejectedValue({ code: 'ITEM_NOT_IN_INVENTORY' });
    const w = mountPanel();
    await w.vm.$nextTick();
    const btn = w.find('[data-testid="npc-affinity-gift-button-npc_lang_van_sinh"]')
      .element as HTMLButtonElement;
    btn.click();
    await flushPromises();

    const err = w.find('[data-testid="npc-affinity-gift-error-npc_lang_van_sinh"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain('Túi đồ không có vật phẩm');

    // Không có toast khi error.
    expect(
      w.find('[data-testid="npc-affinity-gift-toast-npc_lang_van_sinh"]').exists(),
    ).toBe(false);

    // Daily count KHÔNG update.
    expect(
      w.find('[data-testid="npc-affinity-gift-daily-npc_lang_van_sinh"]').text(),
    ).toContain('Hôm nay 0/');
  });

  it('autoLoad=true gọi store.loadDaily() khi mount', async () => {
    vi.mocked(api.fetchNpcAffinities).mockResolvedValue({
      affinities: [makeAffinity()],
      caps: { perChoice: 20, perQuestReward: 40 },
    });
    vi.mocked(api.fetchNpcGiftDaily).mockResolvedValue([
      {
        npcKey: 'npc_lang_van_sinh',
        dayBucket: '2026-06-01',
        usedToday: 2,
        dailyLimit: 5,
        remainingToday: 3,
      },
    ]);
    const w = mountPanel({ autoLoad: true });
    await flushPromises();
    expect(api.fetchNpcGiftDaily).toHaveBeenCalledTimes(1);
    expect(
      w.find('[data-testid="npc-affinity-gift-daily-npc_lang_van_sinh"]').text(),
    ).toContain('Hôm nay 2/');
  });
});

describe('useNpcAffinityStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(api.fetchNpcAffinities).mockReset();
  });

  it('load() fills affinities + caps + sets loaded flag', async () => {
    vi.mocked(api.fetchNpcAffinities).mockResolvedValue({
      affinities: [makeAffinity()],
      caps: { perChoice: 20, perQuestReward: 40 },
    });
    const store = useNpcAffinityStore();
    await store.load();
    expect(store.affinities).toHaveLength(1);
    expect(store.caps?.perChoice).toBe(20);
    expect(store.loaded).toBe(true);
    expect(store.error).toBeNull();
  });

  it('load() with API error sets error code', async () => {
    vi.mocked(api.fetchNpcAffinities).mockRejectedValue({
      code: 'NO_CHARACTER',
    });
    const store = useNpcAffinityStore();
    await store.load();
    expect(store.error).toBe('NO_CHARACTER');
    expect(store.loaded).toBe(false);
  });

  it('findByNpcKey returns matching affinity', () => {
    const store = useNpcAffinityStore();
    store.affinities = [makeAffinity()];
    expect(store.findByNpcKey('npc_lang_van_sinh')?.npcName).toBe('Lăng Vân Sinh');
    expect(store.findByNpcKey('npc_unknown')).toBeUndefined();
  });

  it('reset() clears all state', () => {
    const store = useNpcAffinityStore();
    store.affinities = [makeAffinity()];
    store.loaded = true;
    store.error = 'X';
    store.reset();
    expect(store.affinities).toEqual([]);
    expect(store.loaded).toBe(false);
    expect(store.error).toBeNull();
  });
});

// ============================================================================
// Phase 12.10.C — Shop + Hidden Unlocks UI flow.
// ============================================================================

function makeShop(
  overrides: Partial<api.NpcShopListView> = {},
): api.NpcShopListView {
  return {
    npcKey: 'npc_lang_van_sinh',
    npcName: 'Lăng Vân Sinh',
    currentScore: 30,
    currentTier: {
      key: 'ban_huu',
      label: 'Bằng Hữu',
      labelEn: 'Companion',
      minScore: 30,
      order: 2,
    },
    entries: [
      {
        npcKey: 'npc_lang_van_sinh',
        itemKey: 'huyet_chi_dan',
        requiredAffinityTier: 'quen_biet',
        requiredTierLabel: 'Quen Biết',
        requiredTierLabelEn: 'Acquaintance',
        requiredTierMinScore: 10,
        cost: 30,
        currency: 'LINH_THACH',
        stockType: 'daily',
        dailyLimit: 5,
        weeklyLimit: null,
        unlockHint: 'Kiếm tiểu đan giữ tâm.',
        unlockHintEn: 'Small mind-clearing pill.',
        item: {
          key: 'huyet_chi_dan',
          name: 'Huyết Chi Đan',
          description: 'Hồi máu nhẹ.',
          quality: 'common',
          kind: 'consumable',
          stackable: true,
        },
        currentTier: 'ban_huu',
        unlocked: true,
        purchased: 1,
        remaining: 4,
        limitReached: false,
      },
      {
        npcKey: 'npc_lang_van_sinh',
        itemKey: 'skill_book_kim_quang_tram',
        requiredAffinityTier: 'tri_giao',
        requiredTierLabel: 'Tri Giao',
        requiredTierLabelEn: 'Confidant',
        requiredTierMinScore: 60,
        cost: 800,
        currency: 'LINH_THACH',
        stockType: 'weekly',
        dailyLimit: null,
        weeklyLimit: 1,
        unlockHint: 'Bí kíp đặc biệt.',
        unlockHintEn: 'Rare technique.',
        item: {
          key: 'skill_book_kim_quang_tram',
          name: 'Kim Quang Trảm Thức',
          description: 'Kiếm pháp.',
          quality: 'rare',
          kind: 'skillbook',
          stackable: false,
        },
        currentTier: 'ban_huu',
        unlocked: false,
        purchased: 0,
        remaining: 1,
        limitReached: false,
      },
    ],
    ...overrides,
  };
}

function makeUnlocks(
  overrides: Partial<api.NpcUnlocksView> = {},
): api.NpcUnlocksView {
  return {
    npcKey: 'npc_lang_van_sinh',
    currentTier: 'ban_huu',
    unlocks: [
      {
        kind: 'dialogue',
        refKey: 'story_dlg_lang_van_sinh_inner_secret',
        npcKey: 'npc_lang_van_sinh',
        requiredAffinityTier: 'ban_huu',
        requiredTierLabel: 'Bằng Hữu',
        requiredTierLabelEn: 'Companion',
        requiredTierMinScore: 30,
        unlockReason: 'Bí mật nội tâm hé lộ.',
        unlockReasonEn: 'Inner secret revealed.',
        unlocked: true,
      },
      {
        kind: 'quest',
        refKey: 'quest_lang_van_sinh_kiem_dao',
        npcKey: 'npc_lang_van_sinh',
        requiredAffinityTier: 'tri_giao',
        requiredTierLabel: 'Tri Giao',
        requiredTierLabelEn: 'Confidant',
        requiredTierMinScore: 60,
        unlockReason: 'Bí mật kiếm đạo.',
        unlockReasonEn: 'Sword path secret.',
        unlocked: false,
      },
    ],
    ...overrides,
  };
}

describe('NpcAffinityPanel — Phase 12.10.C shop + unlocks', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(api.fetchNpcAffinities).mockReset();
    vi.mocked(api.fetchNpcShop).mockReset();
    vi.mocked(api.buyNpcShopItem).mockReset();
    vi.mocked(api.fetchNpcUnlocks).mockReset();
  });

  function seedStore(): ReturnType<typeof useNpcAffinityStore> {
    const store = useNpcAffinityStore();
    store.affinities = [makeAffinity()];
    store.loaded = true;
    return store;
  }

  it('renders shop toggle button and is collapsed by default', async () => {
    seedStore();
    const w = mountPanel();
    await w.vm.$nextTick();
    expect(
      w.find('[data-testid="npc-affinity-shop-toggle-npc_lang_van_sinh"]').exists(),
    ).toBe(true);
    // Section not yet expanded.
    expect(
      w.find('[data-testid="npc-affinity-shop-npc_lang_van_sinh"]').exists(),
    ).toBe(false);
  });

  it('clicking toggle loads shop + unlocks and renders entries', async () => {
    seedStore();
    vi.mocked(api.fetchNpcShop).mockResolvedValue(makeShop());
    vi.mocked(api.fetchNpcUnlocks).mockResolvedValue(makeUnlocks());
    const w = mountPanel();
    await w.vm.$nextTick();

    const toggle = w.find(
      '[data-testid="npc-affinity-shop-toggle-npc_lang_van_sinh"]',
    ).element as HTMLButtonElement;
    toggle.click();
    await flushPromises();

    expect(api.fetchNpcShop).toHaveBeenCalledWith('npc_lang_van_sinh');
    expect(api.fetchNpcUnlocks).toHaveBeenCalledWith('npc_lang_van_sinh');

    const list = w.find('[data-testid="npc-affinity-shop-list-npc_lang_van_sinh"]');
    expect(list.exists()).toBe(true);
    expect(list.text()).toContain('Huyết Chi Đan');
    expect(list.text()).toContain('Kim Quang Trảm Thức');
    expect(list.text()).toContain('30');
    expect(list.text()).toContain('linh thạch');
  });

  it('renders locked items dimmed with required tier hint + disabled buy', async () => {
    seedStore();
    vi.mocked(api.fetchNpcShop).mockResolvedValue(makeShop());
    vi.mocked(api.fetchNpcUnlocks).mockResolvedValue(makeUnlocks());
    const w = mountPanel();
    await w.vm.$nextTick();
    (w.find(
      '[data-testid="npc-affinity-shop-toggle-npc_lang_van_sinh"]',
    ).element as HTMLButtonElement).click();
    await flushPromises();

    const lockedHint = w.find(
      '[data-testid="npc-affinity-shop-locked-npc_lang_van_sinh-skill_book_kim_quang_tram"]',
    );
    expect(lockedHint.exists()).toBe(true);
    expect(lockedHint.text()).toContain('Tri Giao');

    const buyBtn = w.find(
      '[data-testid="npc-affinity-shop-buy-npc_lang_van_sinh-skill_book_kim_quang_tram"]',
    ).element as HTMLButtonElement;
    expect(buyBtn.disabled).toBe(true);
    expect(buyBtn.textContent).toContain('Khoá');
  });

  it('clicking buy on unlocked item calls buyNpcShopItem', async () => {
    seedStore();
    vi.mocked(api.fetchNpcShop).mockResolvedValue(makeShop());
    vi.mocked(api.fetchNpcUnlocks).mockResolvedValue(makeUnlocks());
    vi.mocked(api.buyNpcShopItem).mockResolvedValue({
      shop: makeShop(),
      receipt: {
        characterId: 'c1',
        npcKey: 'npc_lang_van_sinh',
        itemKey: 'huyet_chi_dan',
        qty: 1,
        unitCost: 30,
        totalCost: 30,
        currency: 'LINH_THACH',
        purchased: 2,
        remaining: 3,
        stockType: 'daily',
      },
    });
    const w = mountPanel();
    await w.vm.$nextTick();
    (w.find(
      '[data-testid="npc-affinity-shop-toggle-npc_lang_van_sinh"]',
    ).element as HTMLButtonElement).click();
    await flushPromises();

    const buyBtn = w.find(
      '[data-testid="npc-affinity-shop-buy-npc_lang_van_sinh-huyet_chi_dan"]',
    ).element as HTMLButtonElement;
    expect(buyBtn.disabled).toBe(false);
    buyBtn.click();
    await flushPromises();

    expect(api.buyNpcShopItem).toHaveBeenCalledWith(
      'npc_lang_van_sinh',
      'huyet_chi_dan',
      1,
    );
  });

  it('renders shop buy error state when buyError set', async () => {
    seedStore();
    vi.mocked(api.fetchNpcShop).mockResolvedValue(makeShop());
    vi.mocked(api.fetchNpcUnlocks).mockResolvedValue(makeUnlocks());
    const w = mountPanel();
    await w.vm.$nextTick();
    (w.find(
      '[data-testid="npc-affinity-shop-toggle-npc_lang_van_sinh"]',
    ).element as HTMLButtonElement).click();
    await flushPromises();

    const store = useNpcAffinityStore();
    store.buyError = 'INSUFFICIENT_FUNDS';
    store.buyLoading = null;
    await w.vm.$nextTick();
    const errEl = w.find(
      '[data-testid="npc-affinity-shop-buy-error-npc_lang_van_sinh"]',
    );
    expect(errEl.exists()).toBe(true);
    expect(errEl.text()).toContain('Không đủ linh thạch.');
  });

  it('renders hidden unlock entries with locked/unlocked indicators', async () => {
    seedStore();
    vi.mocked(api.fetchNpcShop).mockResolvedValue(makeShop());
    vi.mocked(api.fetchNpcUnlocks).mockResolvedValue(makeUnlocks());
    const w = mountPanel();
    await w.vm.$nextTick();
    (w.find(
      '[data-testid="npc-affinity-shop-toggle-npc_lang_van_sinh"]',
    ).element as HTMLButtonElement).click();
    await flushPromises();

    const unlocksList = w.find(
      '[data-testid="npc-affinity-unlocks-list-npc_lang_van_sinh"]',
    );
    expect(unlocksList.exists()).toBe(true);
    expect(unlocksList.text()).toContain('Bí mật nội tâm hé lộ.');
    expect(unlocksList.text()).toContain('Bí mật kiếm đạo.');
  });

  it('renders dailyStock + weeklyStock state', async () => {
    seedStore();
    vi.mocked(api.fetchNpcShop).mockResolvedValue(makeShop());
    vi.mocked(api.fetchNpcUnlocks).mockResolvedValue(makeUnlocks());
    const w = mountPanel();
    await w.vm.$nextTick();
    (w.find(
      '[data-testid="npc-affinity-shop-toggle-npc_lang_van_sinh"]',
    ).element as HTMLButtonElement).click();
    await flushPromises();

    const dailyStock = w.find(
      '[data-testid="npc-affinity-shop-stock-npc_lang_van_sinh-huyet_chi_dan"]',
    );
    expect(dailyStock.exists()).toBe(true);
    expect(dailyStock.text()).toContain('Hôm nay 1/5');

    const weeklyStock = w.find(
      '[data-testid="npc-affinity-shop-stock-npc_lang_van_sinh-skill_book_kim_quang_tram"]',
    );
    expect(weeklyStock.exists()).toBe(true);
    expect(weeklyStock.text()).toContain('Tuần này 0/1');
  });
});
