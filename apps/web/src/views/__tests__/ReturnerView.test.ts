import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { ReturnerStateView } from '@/api/returner';

/**
 * ReturnerView smoke tests (Phase 31.0 PR5): empty state + with tier + check
 * button dispatches.
 */

const getStateMock = vi.fn();
const triggerCheckMock = vi.fn();

vi.mock('@/api/returner', () => ({
  getReturnerState: (...a: unknown[]) => getStateMock(...a),
  triggerReturnerCheck: (...a: unknown[]) => triggerCheckMock(...a),
}));

const routerReplaceMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

const authState = {
  isAuthenticated: true,
  hydrate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    name: 'MButtonStub',
    template: '<button v-bind="$attrs"><slot /></button>',
  },
}));

import ReturnerViewComponent from '@/views/ReturnerView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  missingFallbackWarn: false,
  messages: {
    vi: {
      common: { loading: 'Đang xử lý…' },
      returner: {
        title: 'Trở Lại',
        subtitle: 'Sub',
        noState: 'Chưa có dữ liệu',
        inactiveDays: 'Đã rời: {days}',
        currentTier: 'Tier: {tier}',
        noTier: 'Chưa đủ',
        check: 'Kiểm tra',
        checkSuccess: 'Activated',
        checkNoop: 'NoOp',
      },
    },
  },
});

function mountView() {
  return mount(ReturnerViewComponent, { global: { plugins: [i18n] } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  authState.isAuthenticated = true;
});

describe('ReturnerView — Phase 31.0', () => {
  it('state null → render noState', async () => {
    getStateMock.mockResolvedValue(null);
    const w = mountView();
    await flushPromises();

    expect(w.find('[data-testid="returner-view"]').exists()).toBe(true);
    expect(w.text()).toContain('Chưa có dữ liệu');
  });

  it('state có tier → render inactiveDays + currentTier + check button', async () => {
    const state: ReturnerStateView = {
      characterId: 'c1',
      inactiveDays: 14,
      currentTier: 'MEDIUM',
      lastCycleKey: 'u:MEDIUM:2026-01-15',
      lastTriggerAt: '2026-01-15T00:00:00Z',
      prevLoginAt: '2026-01-01T00:00:00Z',
      lastLoginAt: '2026-01-15T00:00:00Z',
    };
    getStateMock.mockResolvedValue(state);
    const w = mountView();
    await flushPromises();

    expect(w.text()).toContain('Đã rời: 14');
    expect(w.text()).toContain('Tier: MEDIUM');
    expect(w.find('[data-testid="returner-check-btn"]').exists()).toBe(true);
  });

  it('click check button: dispatch triggerReturnerCheck + toast', async () => {
    getStateMock.mockResolvedValue({
      characterId: 'c1',
      inactiveDays: 14,
      currentTier: null,
      lastCycleKey: null,
      lastTriggerAt: null,
      prevLoginAt: null,
      lastLoginAt: null,
    });
    triggerCheckMock.mockResolvedValue({ tier: 'SHORT', mailId: 'm1' });
    const w = mountView();
    await flushPromises();

    await w.find('[data-testid="returner-check-btn"]').trigger('click');
    await flushPromises();

    expect(triggerCheckMock).toHaveBeenCalled();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', text: 'Activated' }),
    );
  });
});
