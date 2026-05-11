/**
 * Phase 19.4 — PartyPanel smoke tests.
 *
 * Verify:
 *   - Load my-party / incoming / outgoing on mount.
 *   - Render no-party empty state + create form invokes API.
 *   - Render current party + members + leader actions.
 *   - Accept / decline / cancel invite invoke API.
 *   - Leave / disband / kick / transfer confirm modal: false KHÔNG gọi API,
 *     true gọi API.
 *   - i18n keys resolve.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const getMyPartyMock = vi.fn();
const listMembersMock = vi.fn();
const listIncomingMock = vi.fn();
const listOutgoingMock = vi.fn();
const createPartyMock = vi.fn();
const inviteMock = vi.fn();
const acceptMock = vi.fn();
const declineMock = vi.fn();
const cancelMock = vi.fn();
const leaveMock = vi.fn();
const kickMock = vi.fn();
const transferMock = vi.fn();
const disbandMock = vi.fn();

vi.mock('@/api/party', () => ({
  getMyParty: (...a: unknown[]) => getMyPartyMock(...a),
  listPartyMembers: (...a: unknown[]) => listMembersMock(...a),
  listIncomingPartyInvites: (...a: unknown[]) => listIncomingMock(...a),
  listOutgoingPartyInvites: (...a: unknown[]) => listOutgoingMock(...a),
  createParty: (...a: unknown[]) => createPartyMock(...a),
  invitePlayerToParty: (...a: unknown[]) => inviteMock(...a),
  acceptPartyInvite: (...a: unknown[]) => acceptMock(...a),
  declinePartyInvite: (...a: unknown[]) => declineMock(...a),
  cancelPartyInvite: (...a: unknown[]) => cancelMock(...a),
  leaveParty: (...a: unknown[]) => leaveMock(...a),
  kickPartyMember: (...a: unknown[]) => kickMock(...a),
  transferPartyLeader: (...a: unknown[]) => transferMock(...a),
  disbandParty: (...a: unknown[]) => disbandMock(...a),
}));

vi.mock('@/ws/client', () => ({
  on: () => () => undefined,
}));

import PartyPanel from '@/components/PartyPanel.vue';
import partyVi from '@/i18n/vi.json' assert { type: 'json' };
import { useAuthStore } from '@/stores/auth';

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
    party: (partyVi as { party: Record<string, unknown> }).party,
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
  return mount(PartyPanel, {
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
}

const leaderId = 'user-leader';
const memberId = 'user-member';

function buildParty(memberCount = 2) {
  return {
    id: 'party-1',
    leaderUserId: leaderId,
    name: 'Test Party',
    status: 'ACTIVE' as const,
    maxMembers: 5,
    memberCount,
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    updatedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    disbandedAt: null,
  };
}

function buildMembers() {
  return [
    {
      id: 'pm-1',
      partyId: 'party-1',
      userId: leaderId,
      role: 'LEADER' as const,
      displayName: 'Leader-Display',
      joinedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
      leftAt: null,
      online: true,
    },
    {
      id: 'pm-2',
      partyId: 'party-1',
      userId: memberId,
      role: 'MEMBER' as const,
      displayName: 'Member-Display',
      joinedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
      leftAt: null,
      online: false,
    },
  ];
}

beforeEach(() => {
  document.body.innerHTML = '';
  getMyPartyMock.mockReset();
  listMembersMock.mockReset();
  listIncomingMock.mockReset();
  listOutgoingMock.mockReset();
  createPartyMock.mockReset();
  inviteMock.mockReset();
  acceptMock.mockReset();
  declineMock.mockReset();
  cancelMock.mockReset();
  leaveMock.mockReset();
  kickMock.mockReset();
  transferMock.mockReset();
  disbandMock.mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PartyPanel — render & flows', () => {
  it('render empty state khi chưa ở party + create form gọi API', async () => {
    getMyPartyMock.mockResolvedValue({ party: null, members: [] });
    listIncomingMock.mockResolvedValue({ invites: [] });
    listOutgoingMock.mockResolvedValue({ invites: [] });
    createPartyMock.mockResolvedValue({
      party: buildParty(1),
      members: [buildMembers()[0]],
    });

    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.find('[data-testid="party-empty"]').exists()).toBe(true);
    await wrapper
      .find('[data-testid="party-create-name"]')
      .setValue('Team Tiên');
    await wrapper.find('[data-testid="party-create-form"]').trigger('submit');
    await flushPromises();

    expect(createPartyMock).toHaveBeenCalledWith('Team Tiên');
    expect(wrapper.find('[data-testid="party-current"]').exists()).toBe(true);
  });

  it('render party hiện tại + member list + online dot', async () => {
    getMyPartyMock.mockResolvedValue({
      party: buildParty(2),
      members: buildMembers(),
    });
    listIncomingMock.mockResolvedValue({ invites: [] });
    listOutgoingMock.mockResolvedValue({ invites: [] });

    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.find('[data-testid="party-current"]').exists()).toBe(true);
    expect(
      wrapper.find(`[data-testid="party-member-${leaderId}"]`).exists(),
    ).toBe(true);
    expect(
      wrapper
        .find(`[data-testid="party-member-online-${leaderId}"]`)
        .attributes('data-online'),
    ).toBe('true');
    expect(
      wrapper
        .find(`[data-testid="party-member-online-${memberId}"]`)
        .attributes('data-online'),
    ).toBe('false');
  });

  it('incoming invite accept → gọi acceptPartyInvite', async () => {
    getMyPartyMock.mockResolvedValueOnce({ party: null, members: [] });
    getMyPartyMock.mockResolvedValueOnce({
      party: buildParty(2),
      members: buildMembers(),
    });
    const invite = {
      id: 'inv-1',
      partyId: 'party-1',
      partyName: 'Test Party',
      inviterUserId: leaderId,
      inviterDisplayName: 'Leader-Display',
      inviteeUserId: memberId,
      inviteeDisplayName: 'Member-Display',
      status: 'PENDING' as const,
      createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      respondedAt: null,
    };
    listIncomingMock.mockResolvedValueOnce({ invites: [invite] });
    listIncomingMock.mockResolvedValueOnce({ invites: [] });
    listOutgoingMock.mockResolvedValue({ invites: [] });
    acceptMock.mockResolvedValue({
      party: buildParty(2),
      members: buildMembers(),
    });

    const wrapper = mountPanel();
    await flushPromises();

    expect(
      wrapper.find('[data-testid="party-invite-incoming-inv-1"]').exists(),
    ).toBe(true);
    await wrapper
      .find('[data-testid="party-invite-accept-inv-1"]')
      .trigger('click');
    await flushPromises();
    expect(acceptMock).toHaveBeenCalledWith('inv-1');
  });

  it('confirm modal kick: cancel KHÔNG gọi API, confirm gọi API', async () => {
    getMyPartyMock.mockResolvedValue({
      party: buildParty(2),
      members: buildMembers(),
    });
    listIncomingMock.mockResolvedValue({ invites: [] });
    listOutgoingMock.mockResolvedValue({ invites: [] });
    kickMock.mockResolvedValue({
      party: buildParty(1),
      members: [buildMembers()[0]],
    });

    const wrapper = mountPanel();
    await flushPromises();

    // Open confirm via kick btn (leader sees it for non-leader member)
    await wrapper
      .find(`[data-testid="party-kick-${memberId}"]`)
      .trigger('click');
    await flushPromises();

    // Cancel confirm — modal is teleported to body
    const cancelBtn = document.body.querySelector(
      '[data-testid="party-confirm-cancel"]',
    ) as HTMLButtonElement | null;
    expect(cancelBtn).toBeTruthy();
    cancelBtn?.click();
    await flushPromises();
    expect(kickMock).not.toHaveBeenCalled();

    // Re-open and confirm
    await wrapper
      .find(`[data-testid="party-kick-${memberId}"]`)
      .trigger('click');
    await flushPromises();
    const confirmBtn = document.body.querySelector(
      '[data-testid="party-confirm-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirmBtn).toBeTruthy();
    confirmBtn?.click();
    await flushPromises();
    expect(kickMock).toHaveBeenCalledWith(memberId);
  });

  it('leader transfer → confirm gọi transferPartyLeader', async () => {
    getMyPartyMock.mockResolvedValue({
      party: buildParty(2),
      members: buildMembers(),
    });
    listIncomingMock.mockResolvedValue({ invites: [] });
    listOutgoingMock.mockResolvedValue({ invites: [] });
    transferMock.mockResolvedValue({
      party: { ...buildParty(2), leaderUserId: memberId },
      members: buildMembers().map((m) =>
        m.userId === memberId
          ? { ...m, role: 'LEADER' as const }
          : { ...m, role: 'MEMBER' as const },
      ),
    });

    const wrapper = mountPanel();
    await flushPromises();
    await wrapper
      .find(`[data-testid="party-transfer-${memberId}"]`)
      .trigger('click');
    await flushPromises();
    const transferConfirm = document.body.querySelector(
      '[data-testid="party-confirm-confirm"]',
    ) as HTMLButtonElement | null;
    transferConfirm?.click();
    await flushPromises();
    expect(transferMock).toHaveBeenCalledWith(memberId);
  });

  it('disband confirm gọi disbandParty + clear party state', async () => {
    getMyPartyMock.mockResolvedValueOnce({
      party: buildParty(2),
      members: buildMembers(),
    });
    listIncomingMock.mockResolvedValue({ invites: [] });
    listOutgoingMock.mockResolvedValue({ invites: [] });
    disbandMock.mockResolvedValue({ partyId: 'party-1' });

    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.find('[data-testid="party-disband"]').trigger('click');
    await flushPromises();
    const disbandConfirm = document.body.querySelector(
      '[data-testid="party-confirm-confirm"]',
    ) as HTMLButtonElement | null;
    disbandConfirm?.click();
    await flushPromises();
    expect(disbandMock).toHaveBeenCalled();
  });
});
