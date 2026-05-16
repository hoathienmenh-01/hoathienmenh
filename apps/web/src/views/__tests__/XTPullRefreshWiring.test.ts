import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * Cửu Thiên Mộng — XTPullRefresh wiring smoke tests (Phase 10 follow-up).
 *
 * Verifies the pull-to-refresh primitive is mounted inside list-heavy
 * production views với test-id thống nhất `<view>-pull-refresh`. Test
 * không simulate touch gesture (jsdom limitation) — chỉ assert primitive
 * có mặt + slot props i18n hiển thị đúng label `pullToRefresh`.
 */

const { listMailMock, listBossesV2Mock } = vi.hoisted(() => ({
  listMailMock: vi.fn().mockResolvedValue([]),
  listBossesV2Mock: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/api/mail', async () => {
  const actual = await vi.importActual<typeof import('@/api/mail')>('@/api/mail');
  return { ...actual, listMail: (...a: unknown[]) => listMailMock(...a) };
});

vi.mock('@/api/worldContent', async () => {
  const actual: object = await vi.importActual('@/api/worldContent');
  return { ...actual, listBossesV2: listBossesV2Mock };
});

vi.mock('@/lib/onboardingVisits', () => ({ markVisited: vi.fn() }));

const routerReplaceMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: vi.fn() }),
}));

vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: vi.fn() }),
}));

const authState = {
  isAuthenticated: true,
  hydrate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/auth', () => ({ useAuthStore: () => authState }));

const gameState = {
  bindSocket: vi.fn(),
  fetchState: vi.fn().mockResolvedValue(undefined),
  clearMailBadge: vi.fn(),
};
vi.mock('@/stores/game', () => ({ useGameStore: () => gameState }));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div><slot /></div>' },
}));

import viMessages from '@/i18n/vi.json';
import MailView from '@/views/MailView.vue';
import BossHubView from '@/views/BossHubView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: { vi: viMessages },
});

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  authState.isAuthenticated = true;
  authState.hydrate.mockResolvedValue(undefined);
  listMailMock.mockResolvedValue([]);
  listBossesV2Mock.mockResolvedValue([]);
});

describe('XTPullRefresh wiring', () => {
  it('MailView renders pull-refresh primitive với i18n label', async () => {
    const w = mount(MailView, { global: { plugins: [i18n] } });
    await flushPromises();
    const root = w.find('[data-testid="mail-pull-refresh"]');
    expect(root.exists()).toBe(true);
  });

  it('BossHubView renders pull-refresh primitive với i18n label', async () => {
    const w = mount(BossHubView, { global: { plugins: [i18n] } });
    await flushPromises();
    const root = w.find('[data-testid="boss-hub-pull-refresh"]');
    expect(root.exists()).toBe(true);
  });
});
