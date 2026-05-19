import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hydrate: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: true,
  }),
}));
vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    fetchState: vi.fn().mockResolvedValue(undefined),
    bindSocket: vi.fn(),
  }),
}));
vi.mock('@/stores/npc', () => ({
  useNpcStore: () => ({
    npcs: [],
    loaded: true,
    fetchAll: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('@/stores/npcAffinity', () => ({
  useNpcAffinityStore: () => ({
    affinities: {},
    fetchAll: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('@/stores/storyDialogue', () => ({
  useStoryDialogueStore: () => ({
    talk: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: vi.fn() }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div data-testid="app-shell"><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTLuxHero.vue', () => ({
  default: { name: 'XTLuxHeroStub', props: ['testId'], template: '<div :data-testid="testId || \'hero\'"><slot /></div>' },
}));

import NpcView from '@/views/NpcView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      npc: {
        title: 'NPC',
        subtitle: 'sub',
        loading: 'Đang tải',
        empty: 'Trống',
        roleHint: 'Giao tiếp NPC.',
        crossNav: {
          story: 'Truyện',
          storyDesc: 'desc',
          quests: 'Nhiệm vụ',
          questsDesc: 'desc',
        },
        visibleCount: '{count} NPC',
        filter: { all: 'Tất cả' },
        affinity: { label: 'Thân thiện' },
        talk: 'Nói chuyện',
      },
    },
  },
});

function mountView() {
  return mount(NpcView, { global: { plugins: [i18n] } });
}

describe('NpcView — UX polish', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('render hero', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="npc-view-hero"]').exists()).toBe(true);
  });

  it('render role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="npc-role-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="npc-role-hint"]').text()).toBeTruthy();
  });

  it('render cross-nav', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="npc-cross-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-story"]').exists()).toBe(true);
  });
});
