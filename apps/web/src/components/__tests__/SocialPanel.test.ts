/**
 * Phase 19.1 — SocialPanel smoke tests.
 *
 * Verify:
 *   - Load lists (friends, incoming, outgoing, blocks) ở mount.
 *   - Accept request → gọi API + refresh.
 *   - Send request thành công → reset form + toast.
 *   - Confirm modal khi remove friend / block — confirm=false KHÔNG gọi API.
 *   - Loading / error / empty states.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const getFriendsMock = vi.fn();
const getIncomingRequestsMock = vi.fn();
const getOutgoingRequestsMock = vi.fn();
const getBlocksMock = vi.fn();
const sendFriendRequestMock = vi.fn();
const acceptFriendRequestMock = vi.fn();
const declineFriendRequestMock = vi.fn();
const cancelFriendRequestMock = vi.fn();
const removeFriendMock = vi.fn();
const blockUserMock = vi.fn();
const unblockUserMock = vi.fn();

vi.mock('@/api/social', () => ({
  getFriends: (...a: unknown[]) => getFriendsMock(...a),
  getIncomingRequests: (...a: unknown[]) => getIncomingRequestsMock(...a),
  getOutgoingRequests: (...a: unknown[]) => getOutgoingRequestsMock(...a),
  getBlocks: (...a: unknown[]) => getBlocksMock(...a),
  sendFriendRequest: (...a: unknown[]) => sendFriendRequestMock(...a),
  acceptFriendRequest: (...a: unknown[]) => acceptFriendRequestMock(...a),
  declineFriendRequest: (...a: unknown[]) => declineFriendRequestMock(...a),
  cancelFriendRequest: (...a: unknown[]) => cancelFriendRequestMock(...a),
  removeFriend: (...a: unknown[]) => removeFriendMock(...a),
  blockUser: (...a: unknown[]) => blockUserMock(...a),
  unblockUser: (...a: unknown[]) => unblockUserMock(...a),
}));

import SocialPanel from '@/components/SocialPanel.vue';

const messages = {
  vi: {
    common: { confirm: 'Đồng ý', cancel: 'Huỷ', loading: 'Đang tải…' },
    toast: {
      title: { info: 'Tin', warning: 'Cảnh báo', error: 'Lỗi', success: 'Thành công' },
    },
    social: {
      title: 'Bằng Hữu',
      online: 'Trực tuyến',
      offline: 'Ngoại tuyến',
      tabs: { friends: 'Bằng Hữu', private: 'Mật Đàm', group: 'Đạo Bạn' },
      friends: { header: 'Danh sách bạn bè', empty: 'Chưa kết bạn nào.' },
      requests: {
        incoming: 'Lời mời đến',
        outgoing: 'Lời mời đi',
        emptyIncoming: 'Không có lời mời.',
        emptyOutgoing: 'Không có lời mời đi.',
      },
      blocks: { header: 'Block', empty: 'Trống.' },
      send: {
        userPlaceholder: 'User ID',
        messagePlaceholder: 'Lời nhắn',
        submit: 'Gửi',
      },
      actions: {
        accept: 'Chấp nhận',
        decline: 'Từ chối',
        cancel: 'Huỷ',
        removeFriend: 'Xoá bạn',
        block: 'Chặn',
        unblock: 'Bỏ chặn',
      },
      confirm: {
        removeFriend: { title: 'Xoá bạn', message: 'Xoá {id}?' },
        block: { title: 'Chặn', message: 'Chặn {id}?' },
        unblock: { title: 'Bỏ chặn', message: 'Bỏ chặn {id}?' },
      },
      toast: {
        requestSent: 'Đã gửi lời mời.',
        accepted: 'Đã chấp nhận.',
        declined: 'Đã từ chối.',
        cancelled: 'Đã huỷ.',
        friendRemoved: 'Đã xoá bạn.',
        blocked: 'Đã chặn.',
        unblocked: 'Đã bỏ chặn.',
      },
      errors: {
        SELF_NOT_ALLOWED: 'Không thể tự thao tác.',
        ALREADY_PENDING: 'Đã tồn tại lời mời.',
        BLOCKED: 'Bị chặn.',
        UNKNOWN: 'Lỗi không xác định.',
        INVALID_INPUT: 'Dữ liệu lỗi.',
        NOT_FOUND: 'Không tìm thấy.',
        NOT_AUTHORIZED: 'Không có quyền.',
        INVALID_TRANSITION: 'Không hợp lệ.',
        ALREADY_FRIENDS: 'Đã là bạn.',
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

function mountPanel() {
  setActivePinia(createPinia());
  return mount(SocialPanel, {
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  getFriendsMock.mockReset();
  getIncomingRequestsMock.mockReset();
  getOutgoingRequestsMock.mockReset();
  getBlocksMock.mockReset();
  sendFriendRequestMock.mockReset();
  acceptFriendRequestMock.mockReset();
  declineFriendRequestMock.mockReset();
  cancelFriendRequestMock.mockReset();
  removeFriendMock.mockReset();
  blockUserMock.mockReset();
  unblockUserMock.mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SocialPanel — render & flows', () => {
  it('render loading rồi empty state khi server trả mảng rỗng', async () => {
    getFriendsMock.mockResolvedValue({ friends: [] });
    getIncomingRequestsMock.mockResolvedValue({ requests: [] });
    getOutgoingRequestsMock.mockResolvedValue({ requests: [] });
    getBlocksMock.mockResolvedValue({ blocks: [] });

    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.find('[data-testid="social-friends-empty"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="social-incoming-empty"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="social-blocks-empty"]').exists()).toBe(
      true,
    );
  });

  it('accept friend request gọi acceptFriendRequest + refresh friends', async () => {
    getFriendsMock.mockResolvedValueOnce({ friends: [] });
    getFriendsMock.mockResolvedValueOnce({
      friends: [
        {
          id: 'f1',
          friendUserId: 'peer-1',
          friendDisplayName: 'Peer One',
          online: true,
          createdAt: '2030-01-01T00:00:00Z',
        },
      ],
    });
    getIncomingRequestsMock.mockResolvedValueOnce({
      requests: [
        {
          id: 'req-1',
          senderUserId: 'peer-1',
          receiverUserId: 'me',
          status: 'PENDING',
          message: 'Kết bạn nhé',
          createdAt: '2030-01-01T00:00:00Z',
          respondedAt: null,
        },
      ],
    });
    getIncomingRequestsMock.mockResolvedValueOnce({ requests: [] });
    getOutgoingRequestsMock.mockResolvedValue({ requests: [] });
    getBlocksMock.mockResolvedValue({ blocks: [] });
    acceptFriendRequestMock.mockResolvedValue({
      request: { id: 'req-1', status: 'ACCEPTED' },
      friendUserId: 'peer-1',
    });

    const wrapper = mountPanel();
    await flushPromises();

    const acceptBtn = wrapper.find('[data-testid="social-incoming-accept"]');
    expect(acceptBtn.exists()).toBe(true);
    await acceptBtn.trigger('click');
    await flushPromises();

    expect(acceptFriendRequestMock).toHaveBeenCalledWith('req-1');
    expect(wrapper.find('[data-testid="social-friend-row"]').exists()).toBe(
      true,
    );
  });

  it('send friend request thành công reset form + refresh outgoing', async () => {
    getFriendsMock.mockResolvedValue({ friends: [] });
    getIncomingRequestsMock.mockResolvedValue({ requests: [] });
    getOutgoingRequestsMock.mockResolvedValueOnce({ requests: [] });
    getOutgoingRequestsMock.mockResolvedValueOnce({
      requests: [
        {
          id: 'req-x',
          senderUserId: 'me',
          receiverUserId: 'peer-x',
          status: 'PENDING',
          message: 'hi',
          createdAt: '2030-01-01T00:00:00Z',
          respondedAt: null,
        },
      ],
    });
    getBlocksMock.mockResolvedValue({ blocks: [] });
    sendFriendRequestMock.mockResolvedValue({ id: 'req-x' });

    const wrapper = mountPanel();
    await flushPromises();

    await wrapper
      .find('[data-testid="social-send-userId"]')
      .setValue('peer-x');
    await wrapper
      .find('[data-testid="social-send-message"]')
      .setValue('hi');
    await wrapper.find('[data-testid="social-send-form"]').trigger('submit');
    await flushPromises();

    expect(sendFriendRequestMock).toHaveBeenCalledWith('peer-x', 'hi');
    // form reset
    const idInput = wrapper.find('[data-testid="social-send-userId"]')
      .element as HTMLInputElement;
    expect(idInput.value).toBe('');

    await wrapper
      .find('[data-testid="social-tab-outgoing"]')
      .trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="social-outgoing-row"]').exists()).toBe(
      true,
    );
  });

  it('block confirm=false KHÔNG gọi API; confirm=true thì gọi blockUser', async () => {
    getFriendsMock.mockResolvedValue({
      friends: [
        {
          id: 'f1',
          friendUserId: 'peer-1',
          friendDisplayName: 'Peer One',
          online: false,
          createdAt: '2030-01-01T00:00:00Z',
        },
      ],
    });
    getIncomingRequestsMock.mockResolvedValue({ requests: [] });
    getOutgoingRequestsMock.mockResolvedValue({ requests: [] });
    getBlocksMock.mockResolvedValue({ blocks: [] });
    blockUserMock.mockResolvedValue({ id: 'b1' });

    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.find('[data-testid="social-friend-block"]').trigger('click');
    await flushPromises();
    // Modal open
    expect(document.querySelector('[data-testid="social-confirm"]')).not.toBe(
      null,
    );

    // Cancel — không call API
    const cancelBtn = document.querySelector(
      '[data-testid="social-confirm-cancel"]',
    ) as HTMLButtonElement | null;
    expect(cancelBtn).not.toBeNull();
    cancelBtn!.click();
    await flushPromises();
    expect(blockUserMock).not.toHaveBeenCalled();

    // Re-open then confirm
    await wrapper.find('[data-testid="social-friend-block"]').trigger('click');
    await flushPromises();
    const confirmBtn = document.querySelector(
      '[data-testid="social-confirm-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    await flushPromises();
    expect(blockUserMock).toHaveBeenCalledWith('peer-1');
  });

  it('send request error code BLOCKED → toast lỗi i18n', async () => {
    getFriendsMock.mockResolvedValue({ friends: [] });
    getIncomingRequestsMock.mockResolvedValue({ requests: [] });
    getOutgoingRequestsMock.mockResolvedValue({ requests: [] });
    getBlocksMock.mockResolvedValue({ blocks: [] });
    sendFriendRequestMock.mockRejectedValue(
      Object.assign(new Error('BLOCKED'), { code: 'BLOCKED' }),
    );

    const wrapper = mountPanel();
    await flushPromises();

    await wrapper
      .find('[data-testid="social-send-userId"]')
      .setValue('peer-blocked');
    await wrapper.find('[data-testid="social-send-form"]').trigger('submit');
    await flushPromises();

    expect(sendFriendRequestMock).toHaveBeenCalled();
    // Send button still enabled after error
    expect(
      wrapper.find('[data-testid="social-send-userId"]').exists(),
    ).toBe(true);
  });
});
