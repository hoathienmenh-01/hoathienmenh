import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { MailView } from '@/api/mail';

/**
 * MailView smoke tests (session 9j task B / K3): cover onMounted routing,
 * render list (unread dot / rewardBadge / unread count badge / empty state),
 * select flow (readMail gọi khi chưa read + skip khi đã read, không block
 * nếu readMail throw), claim flow (toast success + cập nhật list +
 * fetchState; error map mail.errors.<code> / fallback UNKNOWN), double-click
 * guard (claiming ref tránh double call).
 */

const listMailMock = vi.fn();
const readMailMock = vi.fn();
const claimMailMock = vi.fn();

vi.mock('@/api/mail', async () => {
  const actual = await vi.importActual<typeof import('@/api/mail')>('@/api/mail');
  return {
    ...actual,
    listMail: (...a: unknown[]) => listMailMock(...a),
    readMail: (...a: unknown[]) => readMailMock(...a),
    claimMail: (...a: unknown[]) => claimMailMock(...a),
  };
});

// Smart onboarding visits import là dynamic → stub module.
vi.mock('@/lib/onboardingVisits', () => ({
  markVisited: vi.fn(),
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

const gameState = {
  bindSocket: vi.fn(),
  fetchState: vi.fn().mockResolvedValue(undefined),
  clearMailBadge: vi.fn(),
};
vi.mock('@/stores/game', () => ({
  useGameStore: () => gameState,
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

import MailViewComponent from '@/views/MailView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { reload: 'Tải lại', loading: 'Đang xử lý…', loadingData: 'Đang tải…' },
      mail: {
        title: 'Hộp Thư',
        empty: 'Không có thư.',
        unread: 'Chưa đọc',
        unreadBadge: '{n} chưa đọc',
        rewardBadge: 'Thưởng',
        from: 'Từ',
        selectHint: 'Chọn một thư bên trái.',
        expiresAt: 'Hạn',
        claim: 'Nhận thưởng',
        claimToast: 'Đã nhận thưởng từ "{subject}"',
        status: { claimed: 'Đã nhận' },
        reward: {
          label: 'Phần thưởng',
          linhThach: 'Linh Thạch',
          tienNgoc: 'Tiên Ngọc',
          exp: 'EXP',
        },
        errors: {
          ALREADY_CLAIMED: 'Thư này đã nhận rồi.',
          UNKNOWN: 'Có lỗi xảy ra.',
        },
        roleHint: 'Thiên Đạo truyền thư — nhận quà, thông báo sự kiện.',
        crossNav: {
          social: 'Xã Giao',
          socialDesc: 'Bạn bè & Trò chuyện',
          market: 'Phường Thị',
          marketDesc: 'Mua bán vật phẩm',
        },
      },
    },
  },
});

function makeMail(over: Partial<MailView> = {}): MailView {
  return {
    id: 'm_1',
    senderName: 'Hệ Thống',
    subject: 'Mail 1',
    body: 'Nội dung thư 1.',
    rewardLinhThach: '0',
    rewardTienNgoc: 0,
    rewardExp: '0',
    rewardItems: [],
    readAt: null,
    claimedAt: null,
    expiresAt: null,
    createdAt: '2026-04-30T07:00:00.000Z',
    claimable: false,
    mailType: 'SYSTEM',
    status: 'UNREAD',
    deleted: false,
    ...over,
  };
}

function mountView() {
  return mount(MailViewComponent, { global: { plugins: [i18n] } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  listMailMock.mockReset();
  readMailMock.mockReset();
  claimMailMock.mockReset();
  routerReplaceMock.mockReset();
  toastPushMock.mockReset();
  authState.isAuthenticated = true;
  authState.hydrate.mockReset();
  authState.hydrate.mockResolvedValue(undefined);
  gameState.bindSocket.mockReset();
  gameState.fetchState.mockReset();
  gameState.fetchState.mockResolvedValue(undefined);
  gameState.clearMailBadge.mockReset();
});

describe('MailView — onMounted routing', () => {
  it('chưa auth → router.replace(/auth) + không gọi listMail', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(listMailMock).not.toHaveBeenCalled();
  });

  it('có auth → fetchState + bindSocket + clearMailBadge + listMail', async () => {
    listMailMock.mockResolvedValue([]);
    mountView();
    await flushPromises();
    expect(gameState.fetchState).toHaveBeenCalled();
    expect(gameState.bindSocket).toHaveBeenCalled();
    expect(gameState.clearMailBadge).toHaveBeenCalled();
    expect(listMailMock).toHaveBeenCalledTimes(1);
  });
});

describe('MailView — list render', () => {
  it('empty state: không có mail → render mail.empty', async () => {
    listMailMock.mockResolvedValue([]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Không có thư.');
  });

  it('unread badge: đếm mail chưa đọc', async () => {
    listMailMock.mockResolvedValue([
      makeMail({ id: 'm1', subject: 'A', readAt: null }),
      makeMail({ id: 'm2', subject: 'B', readAt: '2026-04-30T06:00:00.000Z' }),
      makeMail({ id: 'm3', subject: 'C', readAt: null }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('2 chưa đọc');
  });

  it('rewardBadge cho mail claimable', async () => {
    listMailMock.mockResolvedValue([
      makeMail({ id: 'm_claim', subject: 'Thư thưởng', claimable: true }),
    ]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Thư thưởng');
    expect(w.text()).toContain('Thưởng');
  });

  it('selectHint khi chưa chọn mail nào', async () => {
    listMailMock.mockResolvedValue([makeMail({ id: 'm1', subject: 'Mail 1' })]);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Chọn một thư bên trái.');
  });
});

describe('MailView — select flow', () => {
  it('click mail chưa đọc → readMail được gọi + cập nhật readAt', async () => {
    const unread = makeMail({ id: 'm_u', subject: 'Unread', readAt: null });
    const afterRead = { ...unread, readAt: '2026-04-30T07:30:00.000Z' };
    listMailMock.mockResolvedValue([unread]);
    readMailMock.mockResolvedValue(afterRead);

    const w = mountView();
    await flushPromises();

    // Click vào subject item.
    const listItem = w.findAll('li').find((el) => el.text().includes('Unread'));
    expect(listItem).toBeDefined();
    await listItem!.trigger('click');
    await flushPromises();

    expect(readMailMock).toHaveBeenCalledWith('m_u');
    // Body panel render subject đã chọn.
    expect(w.text()).toContain('Unread');
    expect(w.text()).toContain('Nội dung thư 1.');
  });

  it('click mail đã đọc → readMail KHÔNG gọi', async () => {
    const read = makeMail({
      id: 'm_r',
      subject: 'Read',
      readAt: '2026-04-30T06:00:00.000Z',
    });
    listMailMock.mockResolvedValue([read]);

    const w = mountView();
    await flushPromises();

    const listItem = w.findAll('li').find((el) => el.text().includes('Read'));
    await listItem!.trigger('click');
    await flushPromises();

    expect(readMailMock).not.toHaveBeenCalled();
  });

  it('readMail throw → silent (không toast, vẫn render body)', async () => {
    const unread = makeMail({ id: 'm_fail', subject: 'FailRead', readAt: null });
    listMailMock.mockResolvedValue([unread]);
    readMailMock.mockRejectedValue(new Error('network'));

    const w = mountView();
    await flushPromises();
    const listItem = w.findAll('li').find((el) => el.text().includes('FailRead'));
    await listItem!.trigger('click');
    await flushPromises();

    expect(toastPushMock).not.toHaveBeenCalled();
    // Body vẫn render (bởi selectedId đã set ngay trước readMail).
    expect(w.text()).toContain('FailRead');
  });
});

describe('MailView — claim flow', () => {
  it('click Nhận thưởng → claimMail + toast success + fetchState', async () => {
    const claimable = makeMail({
      id: 'm_c',
      subject: 'Claim me',
      claimable: true,
      rewardLinhThach: '100',
    });
    const afterClaim = {
      ...claimable,
      claimable: false,
      claimedAt: '2026-04-30T07:35:00.000Z',
    };
    listMailMock.mockResolvedValue([claimable]);
    readMailMock.mockResolvedValue({ ...claimable, readAt: '2026-04-30T07:34:00.000Z' });
    claimMailMock.mockResolvedValue(afterClaim);

    const w = mountView();
    await flushPromises();

    // Select first.
    const listItem = w.findAll('li').find((el) => el.text().includes('Claim me'));
    await listItem!.trigger('click');
    await flushPromises();

    const claimBtn = w.findAll('button').find((b) => b.text().includes('Nhận thưởng'));
    expect(claimBtn).toBeDefined();
    // fetchState được gọi lần 1 lúc mount; reset để kiểm lần claim.
    gameState.fetchState.mockClear();
    await claimBtn!.trigger('click');
    await flushPromises();

    expect(claimMailMock).toHaveBeenCalledWith('m_c');
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'success',
      text: 'Đã nhận thưởng từ "Claim me"',
    });
    expect(gameState.fetchState).toHaveBeenCalled();
    // Sau claim, badge claimed hiển thị.
    expect(w.text()).toContain('Đã nhận');
  });

  it('claim error → toast mail.errors.<code> (ALREADY_CLAIMED)', async () => {
    const claimable = makeMail({
      id: 'm_ac',
      subject: 'Already',
      claimable: true,
    });
    listMailMock.mockResolvedValue([claimable]);
    readMailMock.mockResolvedValue({ ...claimable, readAt: '2026-04-30T07:34:00.000Z' });
    claimMailMock.mockRejectedValue(
      Object.assign(new Error('dup'), { code: 'ALREADY_CLAIMED' }),
    );

    const w = mountView();
    await flushPromises();
    const listItem = w.findAll('li').find((el) => el.text().includes('Already'));
    await listItem!.trigger('click');
    await flushPromises();
    const claimBtn = w.findAll('button').find((b) => b.text().includes('Nhận thưởng'));
    await claimBtn!.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Thư này đã nhận rồi.',
    });
  });

  it('claim error code lạ → fallback mail.errors.UNKNOWN', async () => {
    const claimable = makeMail({ id: 'm_unk', subject: 'Unk', claimable: true });
    listMailMock.mockResolvedValue([claimable]);
    readMailMock.mockResolvedValue({ ...claimable, readAt: '2026-04-30T07:34:00.000Z' });
    claimMailMock.mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'WEIRD' }),
    );

    const w = mountView();
    await flushPromises();
    const listItem = w.findAll('li').find((el) => el.text().includes('Unk'));
    await listItem!.trigger('click');
    await flushPromises();
    const claimBtn = w.findAll('button').find((b) => b.text().includes('Nhận thưởng'));
    await claimBtn!.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Có lỗi xảy ra.',
    });
  });

  it('claiming guard: click lần 2 trong khi pending → claimMail chỉ gọi 1 lần', async () => {
    const claimable = makeMail({ id: 'm_g', subject: 'Guarded', claimable: true });
    listMailMock.mockResolvedValue([claimable]);
    readMailMock.mockResolvedValue({ ...claimable, readAt: '2026-04-30T07:34:00.000Z' });
    const resolveHolder: { current: ((v: MailView) => void) | null } = { current: null };
    claimMailMock.mockImplementation(
      () =>
        new Promise<MailView>((resolve) => {
          resolveHolder.current = resolve;
        }),
    );

    const w = mountView();
    await flushPromises();
    const listItem = w.findAll('li').find((el) => el.text().includes('Guarded'));
    await listItem!.trigger('click');
    await flushPromises();
    const claimBtn = w.findAll('button').find((b) => b.text().includes('Nhận thưởng'));
    await claimBtn!.trigger('click');
    await flushPromises();
    await claimBtn!.trigger('click');
    await flushPromises();

    expect(claimMailMock).toHaveBeenCalledTimes(1);

    resolveHolder.current?.({
      ...claimable,
      claimable: false,
      claimedAt: '2026-04-30T07:36:00.000Z',
    });
    await flushPromises();
  });
});

describe('MailView — list fetch error', () => {
  it('listMail throw → toast error, render empty list', async () => {
    listMailMock.mockRejectedValue(Object.assign(new Error('net'), { code: 'BOOM' }));
    const w = mountView();
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Có lỗi xảy ra.',
    });
    // Header vẫn render.
    expect(w.text()).toContain('Hộp Thư');
  });
});

describe('MailView — cross-navigation', () => {
  it('render role hint', async () => {
    listMailMock.mockResolvedValue([]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="mail-role-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="mail-role-hint"]').text()).toContain('Thiên Đạo');
  });

  it('render cross-navigation links', async () => {
    listMailMock.mockResolvedValue([]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="mail-cross-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-social"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-market"]').exists()).toBe(true);
  });
});
