import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { DEFAULT_PLAYER_SETTINGS } from '@xuantoi/shared';

/**
 * Phase 15.13 — `/dev/effects-preview` admin gate regression.
 *
 * View là dev / preview lab nên KHÔNG được lộ cho player thường:
 *  - chưa login → redirect `/auth`.
 *  - login nhưng KHÔNG admin → redirect `/home` + render empty state
 *    `effects-preview-forbidden`, KHÔNG fetch settings.
 *  - login + admin → render `EffectPreviewPanel`.
 */

const routerReplaceMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

const fetchPlayerSettingsMock = vi.fn();
vi.mock('@/api/playerExperience', () => ({
  fetchPlayerSettings: (...a: unknown[]) => fetchPlayerSettingsMock(...a),
}));

interface AuthState {
  isAuthenticated: boolean;
  isAdmin: boolean;
  hydrate: ReturnType<typeof vi.fn>;
}
const authState: AuthState = {
  isAuthenticated: false,
  isAdmin: false,
  hydrate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell-stub"><slot /></div>',
  },
}));
vi.mock('@/components/visual-effects/EffectPreviewPanel.vue', () => ({
  default: {
    name: 'EffectPreviewPanelStub',
    template: '<div data-testid="effect-preview-panel-stub" />',
  },
}));

import EffectsPreviewView from '@/views/EffectsPreviewView.vue';

function mountView() {
  return mount(EffectsPreviewView, { attachTo: document.body });
}

describe('EffectsPreviewView — admin gate', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    authState.isAuthenticated = false;
    authState.isAdmin = false;
    authState.hydrate = vi.fn().mockResolvedValue(undefined);
    fetchPlayerSettingsMock.mockResolvedValue({
      settings: { ...DEFAULT_PLAYER_SETTINGS },
    });
    document.body.innerHTML = '';
  });

  it('chưa login → redirect /auth, KHÔNG fetch settings', async () => {
    authState.isAuthenticated = false;
    authState.isAdmin = false;
    const w = mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(fetchPlayerSettingsMock).not.toHaveBeenCalled();
    w.unmount();
  });

  it('login nhưng KHÔNG admin → redirect /home + render forbidden state, KHÔNG fetch settings', async () => {
    authState.isAuthenticated = true;
    authState.isAdmin = false;
    const w = mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/home');
    expect(fetchPlayerSettingsMock).not.toHaveBeenCalled();
    expect(
      document.querySelector('[data-testid="effects-preview-forbidden"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="effect-preview-panel-stub"]'),
    ).toBeNull();
    w.unmount();
  });

  it('admin → KHÔNG redirect, fetch settings + render EffectPreviewPanel', async () => {
    authState.isAuthenticated = true;
    authState.isAdmin = true;
    const w = mountView();
    await flushPromises();
    expect(routerReplaceMock).not.toHaveBeenCalled();
    expect(fetchPlayerSettingsMock).toHaveBeenCalledOnce();
    expect(
      document.querySelector('[data-testid="effects-preview-forbidden"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="effect-preview-panel-stub"]'),
    ).not.toBeNull();
    w.unmount();
  });
});
