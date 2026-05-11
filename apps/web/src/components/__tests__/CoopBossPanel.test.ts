/**
 * Phase 20.2 — CoopBossPanel smoke tests.
 *
 * Verify:
 *   - Load my-run on mount (empty state khi không có run).
 *   - Empty state: leader gọi createCoopBossRun với bossKey selected.
 *   - LOBBY: member chưa join thấy "Tham gia run"; click gọi joinCoopBossRun.
 *   - IN_PROGRESS + participant: contribution form render; submit gọi
 *     recordCoopBossContribution.
 *   - CLEARED + myReward PENDING: hiển thị claim button, click gọi
 *     claimCoopBossReward.
 *   - Confirm modal cancel: bấm confirm gọi cancelCoopBossRun.
 *   - i18n keys resolve.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const getMyRunMock = vi.fn();
const createRunMock = vi.fn();
const joinRunMock = vi.fn();
const leaveRunMock = vi.fn();
const contributeMock = vi.fn();
const finishRunMock = vi.fn();
const cancelRunMock = vi.fn();
const claimMock = vi.fn();

vi.mock('@/api/coopBoss', () => ({
  getMyCoopBossRun: (...a: unknown[]) => getMyRunMock(...a),
  createCoopBossRun: (...a: unknown[]) => createRunMock(...a),
  joinCoopBossRun: (...a: unknown[]) => joinRunMock(...a),
  leaveCoopBossRun: (...a: unknown[]) => leaveRunMock(...a),
  recordCoopBossContribution: (...a: unknown[]) => contributeMock(...a),
  finishCoopBossRun: (...a: unknown[]) => finishRunMock(...a),
  cancelCoopBossRun: (...a: unknown[]) => cancelRunMock(...a),
  claimCoopBossReward: (...a: unknown[]) => claimMock(...a),
}));

vi.mock('@/ws/client', () => ({
  on: () => () => undefined,
}));

import CoopBossPanel from '@/components/CoopBossPanel.vue';
import vi_messages from '@/i18n/vi.json' assert { type: 'json' };
import { useAuthStore } from '@/stores/auth';
import { BOSSES } from '@xuantoi/shared';

const i18nRoot = vi_messages as Record<string, unknown>;

const messages = {
  vi: {
    common: { confirm: 'Đồng ý', cancel: 'Huỷ', loading: 'Đang tải…' },
    toast: {
      title: {
        info: 'Tin',
        warning: 'Cảnh báo',
        error: 'Lỗi',
        success: 'Thành công',
        system: 'Hệ thống',
      },
    },
    coopBoss: i18nRoot.coopBoss as Record<string, unknown>,
  },
};

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages,
});

const leaderId = 'user-leader';
const memberId = 'user-member';
const VALID_BOSS = BOSSES[0]!.key;

function mountPanel(userId: string | null = leaderId) {
  setActivePinia(createPinia());
  if (userId) {
    const authStore = useAuthStore();
    authStore.user = {
      id: userId,
      email: `${userId}@xt.local`,
      role: 'PLAYER',
      createdAt: new Date().toISOString(),
    };
  }
  return mount(CoopBossPanel, {
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
}

function buildRun(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'run-1',
    bossKey: VALID_BOSS,
    partyId: 'party-1',
    worldBossEventId: null,
    status: 'LOBBY' as const,
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: null,
    resultSummaryJson: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function buildParticipant(
  userId: string,
  over: Partial<Record<string, unknown>> = {},
) {
  return {
    id: `part-${userId}`,
    runId: 'run-1',
    userId,
    characterId: `char-${userId}`,
    partyId: 'party-1',
    characterName: `Char-${userId}`,
    joinedAt: '2026-01-01T00:00:00Z',
    leftAt: null,
    eligibleForReward: true,
    finalContributionScore: null,
    ...over,
  };
}

function buildContribution(
  participantId: string,
  over: Partial<Record<string, unknown>> = {},
) {
  return {
    id: `contrib-${participantId}`,
    runId: 'run-1',
    participantId,
    damageDone: '50000',
    supportScore: 10,
    survivalSeconds: 120,
    actionCount: 1,
    contributionScore: 510,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  getMyRunMock.mockReset();
  createRunMock.mockReset();
  joinRunMock.mockReset();
  leaveRunMock.mockReset();
  contributeMock.mockReset();
  finishRunMock.mockReset();
  cancelRunMock.mockReset();
  claimMock.mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('CoopBossPanel — render & flows', () => {
  it('render empty state khi chưa có run + create form gọi API', async () => {
    getMyRunMock.mockResolvedValueOnce({
      run: null,
      participants: [],
      myContribution: null,
      myReward: null,
      myRewardPreview: null,
    });
    createRunMock.mockResolvedValueOnce({
      run: buildRun(),
      participants: [buildParticipant(leaderId)],
      myContribution: null,
      myReward: null,
      myRewardPreview: null,
    });

    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.find('[data-testid="coop-boss-empty"]').exists()).toBe(true);

    await wrapper
      .find('[data-testid="coop-boss-create-form"]')
      .trigger('submit');
    await flushPromises();

    expect(createRunMock).toHaveBeenCalledWith({ bossKey: VALID_BOSS });
    expect(wrapper.find('[data-testid="coop-boss-run"]').exists()).toBe(true);
  });

  it('member ngoài run thấy join button → click gọi joinCoopBossRun', async () => {
    getMyRunMock.mockResolvedValueOnce({
      run: buildRun(),
      participants: [buildParticipant(leaderId)],
      myContribution: null,
      myReward: null,
      myRewardPreview: null,
    });
    joinRunMock.mockResolvedValueOnce({
      run: buildRun(),
      participants: [buildParticipant(leaderId), buildParticipant(memberId)],
      myContribution: null,
      myReward: null,
      myRewardPreview: null,
    });

    const wrapper = mountPanel(memberId);
    await flushPromises();

    const joinBtn = wrapper.find('[data-testid="coop-boss-join"]');
    expect(joinBtn.exists()).toBe(true);
    await joinBtn.trigger('click');
    await flushPromises();

    expect(joinRunMock).toHaveBeenCalledWith('run-1');
  });

  it('participant trong IN_PROGRESS thấy contribution form → submit gọi record', async () => {
    getMyRunMock.mockResolvedValueOnce({
      run: buildRun({ status: 'IN_PROGRESS' }),
      participants: [buildParticipant(memberId)],
      myContribution: null,
      myReward: null,
      myRewardPreview: null,
    });
    contributeMock.mockResolvedValueOnce({
      contribution: buildContribution(`part-${memberId}`),
    });
    // refresh sau record
    getMyRunMock.mockResolvedValueOnce({
      run: buildRun({ status: 'IN_PROGRESS' }),
      participants: [buildParticipant(memberId)],
      myContribution: buildContribution(`part-${memberId}`),
      myReward: null,
      myRewardPreview: { tier: 'NORMAL', linhThach: 100 },
    });

    const wrapper = mountPanel(memberId);
    await flushPromises();

    const form = wrapper.find('[data-testid="coop-boss-contribution-form"]');
    expect(form.exists()).toBe(true);

    await wrapper
      .find('[data-testid="coop-boss-damage-input"]')
      .setValue(5000);
    await wrapper
      .find('[data-testid="coop-boss-support-input"]')
      .setValue(20);
    await wrapper
      .find('[data-testid="coop-boss-survival-input"]')
      .setValue(60);
    await form.trigger('submit');
    await flushPromises();

    expect(contributeMock).toHaveBeenCalledWith({
      runId: 'run-1',
      damageDone: 5000,
      supportScore: 20,
      survivalSeconds: 60,
    });
  });

  it('leader cancel: confirm modal mở; bấm confirm gọi cancelCoopBossRun', async () => {
    getMyRunMock.mockResolvedValueOnce({
      run: buildRun(),
      participants: [buildParticipant(leaderId)],
      myContribution: null,
      myReward: null,
      myRewardPreview: null,
    });
    cancelRunMock.mockResolvedValueOnce({
      run: null,
      participants: [],
      myContribution: null,
      myReward: null,
      myRewardPreview: null,
    });

    const wrapper = mountPanel(leaderId);
    await flushPromises();

    await wrapper.find('[data-testid="coop-boss-cancel"]').trigger('click');
    await flushPromises();

    // ConfirmModal teleports to body, so query document.body directly.
    const confirmBtn = document.body.querySelector(
      '[data-testid="coop-boss-confirm-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirmBtn).toBeTruthy();
    confirmBtn?.click();
    await flushPromises();

    expect(cancelRunMock).toHaveBeenCalledWith('run-1');
  });

  it('CLEARED + PENDING reward: hiển thị claim button, click gọi claim', async () => {
    getMyRunMock.mockResolvedValueOnce({
      run: buildRun({
        status: 'CLEARED',
        finishedAt: '2026-01-01T00:05:00Z',
        resultSummaryJson: { mvpUserId: memberId, totalDamage: '50000' },
      }),
      participants: [
        buildParticipant(leaderId, {
          finalContributionScore: 200,
          eligibleForReward: true,
        }),
        buildParticipant(memberId, {
          finalContributionScore: 800,
          eligibleForReward: true,
        }),
      ],
      myContribution: buildContribution(`part-${memberId}`),
      myReward: {
        id: 'claim-1',
        runId: 'run-1',
        userId: memberId,
        characterId: `char-${memberId}`,
        status: 'PENDING' as const,
        rewardTier: 'MVP' as const,
        rewardJson: { tier: 'MVP', linhThach: 500, tienNgoc: 10, exp: 200 },
        claimedAt: null,
        createdAt: '2026-01-01T00:05:00Z',
      },
      myRewardPreview: null,
    });
    claimMock.mockResolvedValueOnce({
      claim: {
        id: 'claim-1',
        runId: 'run-1',
        userId: memberId,
        characterId: `char-${memberId}`,
        status: 'CLAIMED' as const,
        rewardTier: 'MVP' as const,
        rewardJson: { tier: 'MVP', linhThach: 500, tienNgoc: 10, exp: 200 },
        claimedAt: '2026-01-01T00:06:00Z',
        createdAt: '2026-01-01T00:05:00Z',
      },
    });

    const wrapper = mountPanel(memberId);
    await flushPromises();

    const claimBtn = wrapper.find('[data-testid="coop-boss-claim"]');
    expect(claimBtn.exists()).toBe(true);
    await claimBtn.trigger('click');
    await flushPromises();

    expect(claimMock).toHaveBeenCalledWith('run-1');
  });
});
