/**
 * Phase 35.1 — CoCultivationPanel smoke tests.
 *
 * Verify:
 *   - Mount fetches status + history.
 *   - Empty active → invite form visible, history shows empty state.
 *   - Send invitation calls API + clears input + refreshes.
 *   - Active session → accept/cancel/complete buttons toggle by status.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const getStatusMock = vi.fn();
const getHistoryMock = vi.fn();
const requestMock = vi.fn();
const acceptMock = vi.fn();
const cancelMock = vi.fn();
const completeMock = vi.fn();

vi.mock('@/api/coCultivation', () => ({
  getCoCultivationStatus: (...a: unknown[]) => getStatusMock(...a),
  getCoCultivationHistory: (...a: unknown[]) => getHistoryMock(...a),
  requestCoCultivation: (...a: unknown[]) => requestMock(...a),
  acceptCoCultivation: (...a: unknown[]) => acceptMock(...a),
  cancelCoCultivation: (...a: unknown[]) => cancelMock(...a),
  completeCoCultivation: (...a: unknown[]) => completeMock(...a),
}));

import CoCultivationPanel from '@/components/CoCultivationPanel.vue';
import { useAuthStore } from '@/stores/auth';

const messages = {
  vi: {
    common: { loading: 'Đang tải…' },
    toast: {
      title: { info: 'i', warning: 'w', error: 'e', success: 's' },
    },
    coCultivation: {
      title: 'Hợp luyện',
      subtitle: 'sub',
      tab: 'Hợp luyện',
      today: { sessions: 's', buffSeconds: 'b', bonusExp: 'x' },
      active: {
        title: 't',
        empty: 'EMPTY_ACTIVE',
        partner: 'p',
        status: 'st',
        duration: 'd',
      },
      send: { partner: 'p', placeholder: 'pl', action: 'INVITE' },
      action: { accept: 'A', complete: 'C', cancel: 'X' },
      history: { title: 'h', empty: 'EMPTY_HISTORY' },
      requestSent: 'sent',
      accepted: 'acc',
      cancelled: 'can',
      completed: 'done',
      errors: { UNKNOWN: 'err' },
    },
  },
};

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    messages,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  const auth = useAuthStore();
  auth.user = {
    id: 'u-me',
    email: 'me@test',
    role: 'PLAYER',
    createdAt: '2025-01-01T00:00:00.000Z',
  };
  getStatusMock.mockResolvedValue({
    active: null,
    today: {
      userId: 'u-me',
      dateKey: '2025-01-01',
      sessionsCompleted: 0,
      totalBuffSeconds: 0,
      totalBonusExp: '0',
      remainingSessions: 3,
      remainingBuffSeconds: 1800,
    },
  });
  getHistoryMock.mockResolvedValue({ sessions: [], hasMore: false });
});

describe('CoCultivationPanel', () => {
  it('renders empty active + empty history on mount', async () => {
    const wrapper = mount(CoCultivationPanel, {
      global: { plugins: [makeI18n()] },
    });
    await flushPromises();
    expect(getStatusMock).toHaveBeenCalledTimes(1);
    expect(getHistoryMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="co-cult-empty"]').text()).toContain(
      'EMPTY_ACTIVE',
    );
    expect(
      wrapper.find('[data-testid="co-cult-history-empty"]').text(),
    ).toContain('EMPTY_HISTORY');
    expect(wrapper.find('[data-testid="co-cult-send-form"]').exists()).toBe(
      true,
    );
  });

  it('sends invite, clears form, refreshes status', async () => {
    requestMock.mockResolvedValue({
      id: 's1',
      initiatorUserId: 'u-me',
      partnerUserId: 'u-friend',
      status: 'PENDING',
    });
    const wrapper = mount(CoCultivationPanel, {
      global: { plugins: [makeI18n()] },
    });
    await flushPromises();
    const input = wrapper.find(
      '[data-testid="co-cult-partner-input"]',
    );
    await input.setValue('u-friend');
    await wrapper
      .find('[data-testid="co-cult-send-form"]')
      .trigger('submit.prevent');
    await flushPromises();
    expect(requestMock).toHaveBeenCalledWith({ partnerUserId: 'u-friend' });
    expect((input.element as HTMLInputElement).value).toBe('');
    // refreshed after submit
    expect(getStatusMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('renders accept/cancel buttons when PENDING and viewer is partner', async () => {
    getStatusMock.mockResolvedValue({
      active: {
        id: 's1',
        initiatorUserId: 'u-other',
        partnerUserId: 'u-me',
        initiatorCharacterId: 'c1',
        partnerCharacterId: 'c2',
        status: 'PENDING',
        durationSec: 600,
        buffPercent: 3,
        startedAt: null,
        completedAt: null,
        expiresAt: null,
        rewardApplied: false,
        bonusExpGranted: '0',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      today: {
        userId: 'u-me',
        dateKey: '2025-01-01',
        sessionsCompleted: 0,
        totalBuffSeconds: 0,
        totalBonusExp: '0',
        remainingSessions: 3,
        remainingBuffSeconds: 1800,
      },
    });
    const wrapper = mount(CoCultivationPanel, {
      global: { plugins: [makeI18n()] },
    });
    await flushPromises();
    expect(wrapper.find('[data-testid="co-cult-accept"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="co-cult-cancel"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="co-cult-complete"]').exists()).toBe(
      false,
    );
  });

  it('renders complete button when ACTIVE', async () => {
    getStatusMock.mockResolvedValue({
      active: {
        id: 's1',
        initiatorUserId: 'u-me',
        partnerUserId: 'u-friend',
        initiatorCharacterId: 'c1',
        partnerCharacterId: 'c2',
        status: 'ACTIVE',
        durationSec: 600,
        buffPercent: 3,
        startedAt: '2025-01-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
        rewardApplied: false,
        bonusExpGranted: '0',
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      today: {
        userId: 'u-me',
        dateKey: '2025-01-01',
        sessionsCompleted: 0,
        totalBuffSeconds: 0,
        totalBonusExp: '0',
        remainingSessions: 3,
        remainingBuffSeconds: 1800,
      },
    });
    const wrapper = mount(CoCultivationPanel, {
      global: { plugins: [makeI18n()] },
    });
    await flushPromises();
    expect(wrapper.find('[data-testid="co-cult-complete"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="co-cult-cancel"]').exists()).toBe(true);
  });
});
