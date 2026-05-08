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
      },
      npcAffinity: {
        title: 'Quan Hệ Đạo Hữu',
        subtitle: 'Mỗi NPC có thân tình riêng.',
        empty: 'Chưa kết duyên cùng đạo hữu nào.',
        nextTierHint: 'Còn {points} điểm để lên {tier}.',
        maxTierReached: 'Đã đạt đỉnh quan hệ.',
        errors: {
          UNKNOWN: 'Không thể tải quan hệ.',
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
