/**
 * Phase 20.1 — PartyDungeonPanel smoke tests.
 *
 * Verify:
 *   - Load my-room on mount (empty state khi không có room).
 *   - Empty state: leader gọi createPartyDungeonRoom với dungeonKey selected.
 *   - LOBBY: member chưa join thấy "Tham gia phòng"; sau join thấy ready
 *     toggle. Leader thấy nút start disable khi NOT_ENOUGH_MEMBERS.
 *   - COMPLETED + myReward PENDING: hiển thị claim button, click gọi
 *     claimPartyDungeonReward.
 *   - Confirm modal: cancel false KHÔNG gọi cancel API, true gọi.
 *   - i18n keys resolve.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const getMyRoomMock = vi.fn();
const createRoomMock = vi.fn();
const joinRoomMock = vi.fn();
const setReadyMock = vi.fn();
const cancelReadyMock = vi.fn();
const startRunMock = vi.fn();
const cancelRoomMock = vi.fn();
const claimMock = vi.fn();

vi.mock('@/api/partyDungeon', () => ({
  getMyPartyDungeonRoom: (...a: unknown[]) => getMyRoomMock(...a),
  createPartyDungeonRoom: (...a: unknown[]) => createRoomMock(...a),
  joinPartyDungeonRoom: (...a: unknown[]) => joinRoomMock(...a),
  setPartyDungeonReady: (...a: unknown[]) => setReadyMock(...a),
  cancelPartyDungeonReady: (...a: unknown[]) => cancelReadyMock(...a),
  startPartyDungeonRun: (...a: unknown[]) => startRunMock(...a),
  cancelPartyDungeonRoom: (...a: unknown[]) => cancelRoomMock(...a),
  claimPartyDungeonReward: (...a: unknown[]) => claimMock(...a),
}));

vi.mock('@/ws/client', () => ({
  on: () => () => undefined,
}));

import PartyDungeonPanel from '@/components/PartyDungeonPanel.vue';
import vi_messages from '@/i18n/vi.json' assert { type: 'json' };
import { useAuthStore } from '@/stores/auth';
import { DUNGEONS } from '@xuantoi/shared';

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
    partyDungeon: (i18nRoot.partyDungeon as Record<string, unknown>),
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
const VALID_DUNGEON = DUNGEONS[0]!.key;

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
  return mount(PartyDungeonPanel, {
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
}

function buildRoom(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'room-1',
    partyId: 'party-1',
    leaderUserId: leaderId,
    dungeonKey: VALID_DUNGEON,
    status: 'LOBBY' as const,
    minMembers: 2,
    maxMembers: 5,
    createdAt: '2026-01-01T00:00:00Z',
    startedAt: null,
    finishedAt: null,
    canceledAt: null,
    currentRunId: null,
    ...over,
  };
}

function buildParticipant(
  userId: string,
  over: Partial<Record<string, unknown>> = {},
) {
  return {
    id: `part-${userId}`,
    roomId: 'room-1',
    userId,
    characterId: `char-${userId}`,
    characterName: `Char-${userId}`,
    readyAt: null,
    joinedAt: '2026-01-01T00:00:00Z',
    leftAt: null,
    resultStatus: null,
    ...over,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  getMyRoomMock.mockReset();
  createRoomMock.mockReset();
  joinRoomMock.mockReset();
  setReadyMock.mockReset();
  cancelReadyMock.mockReset();
  startRunMock.mockReset();
  cancelRoomMock.mockReset();
  claimMock.mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PartyDungeonPanel — render & flows', () => {
  it('render empty state khi chưa có room + create form gọi API', async () => {
    getMyRoomMock.mockResolvedValueOnce({
      room: null,
      participants: [],
      currentRun: null,
      myReward: null,
    });
    createRoomMock.mockResolvedValueOnce({
      room: buildRoom(),
      participants: [buildParticipant(leaderId)],
      currentRun: null,
      myReward: null,
    });

    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.find('[data-testid="party-dungeon-empty"]').exists()).toBe(
      true,
    );

    await wrapper
      .find('[data-testid="party-dungeon-create-form"]')
      .trigger('submit');
    await flushPromises();

    expect(createRoomMock).toHaveBeenCalledWith(VALID_DUNGEON);
    expect(wrapper.find('[data-testid="party-dungeon-room"]').exists()).toBe(
      true,
    );
  });

  it('member chưa join thấy join button → click gọi joinPartyDungeonRoom', async () => {
    getMyRoomMock.mockResolvedValueOnce({
      room: buildRoom(),
      participants: [buildParticipant(leaderId)],
      currentRun: null,
      myReward: null,
    });
    joinRoomMock.mockResolvedValueOnce({
      room: buildRoom(),
      participants: [buildParticipant(leaderId), buildParticipant(memberId)],
      currentRun: null,
      myReward: null,
    });

    const wrapper = mountPanel(memberId);
    await flushPromises();

    const joinBtn = wrapper.find('[data-testid="party-dungeon-join"]');
    expect(joinBtn.exists()).toBe(true);
    await joinBtn.trigger('click');
    await flushPromises();

    expect(joinRoomMock).toHaveBeenCalledWith('room-1');
    expect(
      wrapper.find('[data-testid="party-dungeon-ready-toggle"]').exists(),
    ).toBe(true);
  });

  it('leader thấy nút start disable khi NOT_ENOUGH_MEMBERS', async () => {
    getMyRoomMock.mockResolvedValueOnce({
      room: buildRoom(),
      participants: [
        buildParticipant(leaderId, { readyAt: '2026-01-01T00:00:00Z' }),
      ],
      currentRun: null,
      myReward: null,
    });

    const wrapper = mountPanel(leaderId);
    await flushPromises();

    const startBtn = wrapper.find('[data-testid="party-dungeon-start"]');
    expect(startBtn.exists()).toBe(true);
    expect((startBtn.element as HTMLButtonElement).disabled).toBe(true);
  });

  it('leader cancel: confirm modal mở; bấm confirm gọi cancelPartyDungeonRoom', async () => {
    getMyRoomMock.mockResolvedValueOnce({
      room: buildRoom(),
      participants: [buildParticipant(leaderId)],
      currentRun: null,
      myReward: null,
    });
    cancelRoomMock.mockResolvedValueOnce({
      room: null,
      participants: [],
      currentRun: null,
      myReward: null,
    });

    const wrapper = mountPanel(leaderId);
    await flushPromises();

    await wrapper.find('[data-testid="party-dungeon-cancel"]').trigger('click');
    await flushPromises();

    // ConfirmModal teleports to body, so query document.body directly.
    const confirmBtn = document.body.querySelector(
      '[data-testid="party-dungeon-confirm-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirmBtn).toBeTruthy();
    confirmBtn?.click();
    await flushPromises();

    expect(cancelRoomMock).toHaveBeenCalledWith('room-1');
  });

  it('COMPLETED + PENDING reward: hiển thị claim button, click gọi claim', async () => {
    getMyRoomMock.mockResolvedValueOnce({
      room: buildRoom({
        status: 'COMPLETED',
        finishedAt: '2026-01-01T00:01:00Z',
        currentRunId: 'run-1',
      }),
      participants: [
        buildParticipant(leaderId, { readyAt: '2026-01-01T00:00:00Z' }),
        buildParticipant(memberId, { readyAt: '2026-01-01T00:00:00Z' }),
      ],
      currentRun: {
        id: 'run-1',
        roomId: 'room-1',
        partyId: 'party-1',
        dungeonKey: VALID_DUNGEON,
        result: 'CLEAR',
        startedAt: '2026-01-01T00:00:30Z',
        finishedAt: '2026-01-01T00:01:00Z',
        combatSummaryJson: null,
        rewardSummaryJson: null,
      },
      myReward: {
        id: 'claim-1',
        runId: 'run-1',
        userId: memberId,
        characterId: `char-${memberId}`,
        status: 'PENDING',
        rewardJson: { linhThach: 50, exp: 100 },
        claimedAt: null,
        createdAt: '2026-01-01T00:01:00Z',
      },
    });
    claimMock.mockResolvedValueOnce({
      claim: {
        id: 'claim-1',
        runId: 'run-1',
        userId: memberId,
        characterId: `char-${memberId}`,
        status: 'CLAIMED',
        rewardJson: { linhThach: 50, exp: 100 },
        claimedAt: '2026-01-01T00:02:00Z',
        createdAt: '2026-01-01T00:01:00Z',
      },
    });
    // refresh after claim
    getMyRoomMock.mockResolvedValueOnce({
      room: buildRoom({
        status: 'COMPLETED',
        currentRunId: 'run-1',
      }),
      participants: [],
      currentRun: null,
      myReward: null,
    });

    const wrapper = mountPanel(memberId);
    await flushPromises();

    const claimBtn = wrapper.find('[data-testid="party-dungeon-claim"]');
    expect(claimBtn.exists()).toBe(true);
    await claimBtn.trigger('click');
    await flushPromises();

    expect(claimMock).toHaveBeenCalledWith('run-1');
  });
});
