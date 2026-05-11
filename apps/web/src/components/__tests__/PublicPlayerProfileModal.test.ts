/**
 * Phase 19.1.C — PublicPlayerProfileModal smoke tests.
 *
 * Verify:
 *   - Render loading → profile khi fetchPublicProfile resolve.
 *   - Render error UI khi fetchPublicProfile reject (NOT_FOUND).
 *   - STRANGER → tất cả action button hiển thị; SELF → chỉ self-notice.
 *   - BLOCKED_BY_ME → render nút unblock; character=null + blockedByMe notice.
 *   - canSendFriendRequest=true → click button gọi sendFriendRequest +
 *     reload profile + emit changed.
 *   - canMessage=true → click message button emit `open-private-chat` +
 *     emit `close`.
 *   - canBlock=true → confirm + click block gọi blockUser + emit
 *     `changed`. confirm=false thì KHÔNG gọi API.
 *   - BLOCKED_BY_ME → click Unblock gọi unblockUser + reload.
 *   - userId=null (đóng modal) → render rỗng, KHÔNG gọi API.
 *
 * Note: modal dùng <Teleport to="body"> → query trực tiếp `document`
 * thay vì wrapper.find (giống pattern ChatReportModal.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const fetchPublicProfileMock = vi.fn();
const sendFriendRequestMock = vi.fn();
const blockUserMock = vi.fn();
const unblockUserMock = vi.fn();

vi.mock('@/api/social', () => ({
  fetchPublicProfile: (...a: unknown[]) => fetchPublicProfileMock(...a),
  sendFriendRequest: (...a: unknown[]) => sendFriendRequestMock(...a),
  blockUser: (...a: unknown[]) => blockUserMock(...a),
  unblockUser: (...a: unknown[]) => unblockUserMock(...a),
}));

import PublicPlayerProfileModal from '@/components/PublicPlayerProfileModal.vue';

const messages = {
  vi: {
    common: { confirm: 'Đồng ý', cancel: 'Huỷ', loading: 'Đang tải…' },
    toast: {
      title: {
        info: 'Tin',
        warning: 'Cảnh báo',
        error: 'Lỗi',
        success: 'Thành công',
      },
    },
    social: {
      online: 'Trực tuyến',
      offline: 'Ngoại tuyến',
    },
    publicProfile: {
      title: 'Hồ sơ',
      viewProfile: 'Xem hồ sơ',
      noCharacter: 'Chưa có character.',
      blockedByMeNotice: 'Đã chặn.',
      confirm: { block: 'Chặn {name}?' },
      relationship: {
        SELF: 'Bản thân',
        FRIEND: 'Bằng hữu',
        PENDING_INCOMING: 'Lời mời đến',
        PENDING_OUTGOING: 'Lời mời đi',
        BLOCKED_BY_ME: 'Đã chặn',
        BLOCKED_ME: 'Không rõ',
        STRANGER: 'Người lạ',
      },
      fields: {
        realm: 'Cảnh giới',
        level: 'Cấp',
        powerScore: 'Lực chiến',
        title: 'Danh hiệu',
        titleNone: '—',
        sect: 'Tông môn',
        sectNone: 'Vô môn',
        joined: 'Nhập đạo',
        mutualFriends: 'Bạn chung',
        sameSect: 'Cùng tông',
        sameSectYes: 'Cùng tông',
      },
      actions: {
        sendFriendRequest: 'Kết bạn',
        message: 'Nhắn',
        block: 'Chặn',
        unblock: 'Bỏ chặn',
        selfNotice: 'Tự thao tác.',
      },
      toast: {
        requestSent: 'Đã gửi lời mời.',
        blocked: 'Đã chặn.',
        unblocked: 'Đã bỏ chặn.',
      },
      errors: {
        NOT_FOUND: 'Không tìm thấy.',
        NOT_AUTHORIZED: 'Không có quyền.',
        SELF_NOT_ALLOWED: 'Không thể tự.',
        ALREADY_PENDING: 'Đã có lời mời.',
        ALREADY_FRIENDS: 'Đã là bạn.',
        BLOCKED: 'Bị chặn.',
        INVALID_INPUT: 'Lỗi.',
        RATE_LIMITED: 'Quá nhanh.',
        ABUSE_BLOCKED: 'Bị khoá.',
        UNKNOWN: 'Lỗi.',
      },
    },
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

function mountModal(props: { open: boolean; userId: string | null }) {
  setActivePinia(createPinia());
  return mount(PublicPlayerProfileModal, {
    attachTo: document.body,
    props,
    global: { plugins: [i18n] },
  });
}

function strangerProfile(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'peer-1',
    displayName: 'Peer One',
    relationshipStatus: 'STRANGER',
    actions: {
      canSendFriendRequest: true,
      canMessage: true,
      canBlock: true,
      canReport: true,
    },
    character: {
      characterName: 'Peer One',
      realmKey: 'luyen_khi',
      realmStage: 3,
      realmFullName: 'Luyện Khí — Tầng 3',
      level: 30,
      title: null,
      powerScore: 123,
      sectId: null,
      sectName: null,
    },
    online: false,
    joinedYearMonth: '2030-01',
    mutualFriendCount: 2,
    sameSect: false,
    ...overrides,
  };
}

function qs(sel: string): HTMLElement | null {
  return document.querySelector(sel);
}

beforeEach(() => {
  document.body.innerHTML = '';
  fetchPublicProfileMock.mockReset();
  sendFriendRequestMock.mockReset();
  blockUserMock.mockReset();
  unblockUserMock.mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PublicPlayerProfileModal — render & flows', () => {
  it('userId=null → modal đóng, KHÔNG gọi fetchPublicProfile', async () => {
    const w = mountModal({ open: false, userId: null });
    await flushPromises();
    expect(fetchPublicProfileMock).not.toHaveBeenCalled();
    expect(qs('[data-testid="public-profile-modal"]')).toBeNull();
    w.unmount();
  });

  it('STRANGER profile render đầy đủ field + 3 action button', async () => {
    fetchPublicProfileMock.mockResolvedValueOnce(strangerProfile());
    const w = mountModal({ open: true, userId: 'peer-1' });
    await flushPromises();

    expect(fetchPublicProfileMock).toHaveBeenCalledWith('peer-1');
    expect(qs('[data-testid="public-profile-display-name"]')?.textContent).toBe(
      'Peer One',
    );
    expect(qs('[data-testid="public-profile-relationship"]')?.textContent).toBe(
      'Người lạ',
    );
    expect(qs('[data-testid="public-profile-realm"]')?.textContent).toBe(
      'Luyện Khí — Tầng 3',
    );
    expect(qs('[data-testid="public-profile-power"]')?.textContent).toBe('123');
    expect(qs('[data-testid="public-profile-action-friend"]')).toBeTruthy();
    expect(qs('[data-testid="public-profile-action-message"]')).toBeTruthy();
    expect(qs('[data-testid="public-profile-action-block"]')).toBeTruthy();
    // Unblock chỉ hiện khi BLOCKED_BY_ME — STRANGER thì không.
    expect(qs('[data-testid="public-profile-action-unblock"]')).toBeNull();
    w.unmount();
  });

  it('NOT_FOUND error → render error message, KHÔNG render action', async () => {
    fetchPublicProfileMock.mockRejectedValueOnce(
      Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' }),
    );
    const w = mountModal({ open: true, userId: 'ghost' });
    await flushPromises();

    expect(qs('[data-testid="public-profile-error"]')?.textContent).toBe(
      'Không tìm thấy.',
    );
    expect(qs('[data-testid="public-profile-action-friend"]')).toBeNull();
    w.unmount();
  });

  it('SELF → render self-notice, KHÔNG render action button khác', async () => {
    fetchPublicProfileMock.mockResolvedValueOnce(
      strangerProfile({
        relationshipStatus: 'SELF',
        actions: {
          canSendFriendRequest: false,
          canMessage: false,
          canBlock: false,
          canReport: false,
        },
        mutualFriendCount: null,
        sameSect: null,
      }),
    );
    const w = mountModal({ open: true, userId: 'me' });
    await flushPromises();

    expect(qs('[data-testid="public-profile-action-friend"]')).toBeNull();
    expect(qs('[data-testid="public-profile-action-message"]')).toBeNull();
    expect(qs('[data-testid="public-profile-action-self"]')).toBeTruthy();
    w.unmount();
  });

  it('BLOCKED_BY_ME → render unblock button + blockedByMe notice (character=null)', async () => {
    fetchPublicProfileMock.mockResolvedValueOnce({
      userId: 'peer-1',
      displayName: 'Peer One',
      relationshipStatus: 'BLOCKED_BY_ME',
      actions: {
        canSendFriendRequest: false,
        canMessage: false,
        canBlock: false,
        canReport: false,
      },
      character: null,
      online: false,
      joinedYearMonth: null,
      mutualFriendCount: null,
      sameSect: null,
    });
    const w = mountModal({ open: true, userId: 'peer-1' });
    await flushPromises();

    expect(
      qs('[data-testid="public-profile-no-character"]')?.textContent,
    ).toBe('Đã chặn.');
    expect(qs('[data-testid="public-profile-action-unblock"]')).toBeTruthy();
    expect(qs('[data-testid="public-profile-action-block"]')).toBeNull();
    w.unmount();
  });

  it('click Add Friend gọi sendFriendRequest(userId, null) + reload + emit changed', async () => {
    fetchPublicProfileMock
      .mockResolvedValueOnce(strangerProfile())
      .mockResolvedValueOnce(
        strangerProfile({
          relationshipStatus: 'PENDING_OUTGOING',
          actions: {
            canSendFriendRequest: false,
            canMessage: false,
            canBlock: true,
            canReport: true,
          },
        }),
      );
    sendFriendRequestMock.mockResolvedValueOnce({ id: 'r1', status: 'PENDING' });
    const w = mountModal({ open: true, userId: 'peer-1' });
    await flushPromises();

    (qs('[data-testid="public-profile-action-friend"]') as HTMLButtonElement)
      .click();
    await flushPromises();

    expect(sendFriendRequestMock).toHaveBeenCalledWith('peer-1', null);
    expect(fetchPublicProfileMock).toHaveBeenCalledTimes(2);
    expect(w.emitted('changed')).toBeTruthy();
    w.unmount();
  });

  it('click Message emit open-private-chat + close', async () => {
    fetchPublicProfileMock.mockResolvedValueOnce(strangerProfile());
    const w = mountModal({ open: true, userId: 'peer-1' });
    await flushPromises();

    (qs('[data-testid="public-profile-action-message"]') as HTMLButtonElement)
      .click();
    await flushPromises();

    expect(w.emitted('open-private-chat')).toEqual([['peer-1']]);
    expect(w.emitted('close')).toBeTruthy();
    w.unmount();
  });

  it('click Block với confirm=true gọi blockUser + reload profile + emit changed', async () => {
    fetchPublicProfileMock
      .mockResolvedValueOnce(strangerProfile())
      .mockResolvedValueOnce(
        strangerProfile({
          relationshipStatus: 'BLOCKED_BY_ME',
          actions: {
            canSendFriendRequest: false,
            canMessage: false,
            canBlock: false,
            canReport: false,
          },
          character: null,
        }),
      );
    blockUserMock.mockResolvedValueOnce({ id: 'b1', blockedUserId: 'peer-1' });
    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockImplementation(() => true);

    const w = mountModal({ open: true, userId: 'peer-1' });
    await flushPromises();

    (qs('[data-testid="public-profile-action-block"]') as HTMLButtonElement)
      .click();
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalled();
    expect(blockUserMock).toHaveBeenCalledWith('peer-1');
    expect(w.emitted('changed')).toBeTruthy();
    confirmSpy.mockRestore();
    w.unmount();
  });

  it('click Block với confirm=false KHÔNG gọi blockUser', async () => {
    fetchPublicProfileMock.mockResolvedValueOnce(strangerProfile());
    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockImplementation(() => false);

    const w = mountModal({ open: true, userId: 'peer-1' });
    await flushPromises();

    (qs('[data-testid="public-profile-action-block"]') as HTMLButtonElement)
      .click();
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalled();
    expect(blockUserMock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
    w.unmount();
  });

  it('BLOCKED_BY_ME → click Unblock gọi unblockUser + emit changed', async () => {
    fetchPublicProfileMock
      .mockResolvedValueOnce({
        userId: 'peer-1',
        displayName: 'Peer One',
        relationshipStatus: 'BLOCKED_BY_ME',
        actions: {
          canSendFriendRequest: false,
          canMessage: false,
          canBlock: false,
          canReport: false,
        },
        character: null,
        online: false,
        joinedYearMonth: null,
        mutualFriendCount: null,
        sameSect: null,
      })
      .mockResolvedValueOnce(strangerProfile());
    unblockUserMock.mockResolvedValueOnce({ removed: true });

    const w = mountModal({ open: true, userId: 'peer-1' });
    await flushPromises();

    (qs('[data-testid="public-profile-action-unblock"]') as HTMLButtonElement)
      .click();
    await flushPromises();

    expect(unblockUserMock).toHaveBeenCalledWith('peer-1');
    expect(w.emitted('changed')).toBeTruthy();
    w.unmount();
  });
});
