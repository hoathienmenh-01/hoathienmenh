import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * GiftCodeView skeleton/smoke tests (session 9i task K1): cover các nhánh
 * onMounted (chưa auth → /auth, có auth → bindSocket) + onRedeem flow:
 * - Empty trim ⇒ no-op.
 * - Success: toast success + clear input + render reward block.
 * - Error code có i18n key: toast với label cụ thể.
 * - Error code không có i18n key: fallback sang `giftcode.errors.UNKNOWN`.
 *
 * Pattern: mock @/api/giftcode, vue-router, 3 stores, AppShell stub.
 * Nhánh hiện tại của catch dùng pattern cũ `(e as { code?: string }).code` —
 * sẽ migrate sang `extractApiErrorCodeOrDefault` trong PR follow-up; test
 * này verify behavior đúng cho cả 2 implementation.
 */

const redeemGiftCodeMock = vi.fn();
vi.mock('@/api/giftcode', () => ({
  redeemGiftCode: (...a: unknown[]) => redeemGiftCodeMock(...a),
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
};
vi.mock('@/stores/game', () => ({
  useGameStore: () => gameState,
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell-stub"><slot /></div>',
  },
}));

vi.mock('@/lib/itemName', () => ({
  itemName: (key: string) => `item:${key}`,
}));

import GiftCodeView from '@/views/GiftCodeView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { loading: 'Đang xử lý…' },
      giftcode: {
        title: 'Đổi giftcode',
        hint: 'Nhập mã quà tặng',
        placeholder: 'Mã giftcode',
        redeem: 'Đổi quà',
        successToast: 'Đã nhận thưởng từ mã {code}.',
        lastReward: 'Phần thưởng của mã {code}',
        reward: {
          linhThach: 'Linh Thạch',
          tienNgoc: 'Tiên Ngọc',
          exp: 'EXP',
        },
        errors: {
          UNKNOWN: 'Có lỗi xảy ra.',
          CODE_NOT_FOUND: 'Mã không tồn tại.',
          CODE_EXPIRED: 'Mã đã hết hạn.',
          ALREADY_REDEEMED: 'Mã đã được đổi.',
        },
      },
    },
  },
});

let wrapper: ReturnType<typeof mount> | null = null;

function mountView() {
  wrapper = mount(GiftCodeView, {
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
  return wrapper;
}

describe('GiftCodeView — onMounted routing', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    authState.isAuthenticated = true;
    authState.hydrate = vi.fn().mockResolvedValue(undefined);
    gameState.bindSocket = vi.fn();
    gameState.fetchState = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it('chưa auth ⇒ router.replace("/auth") + KHÔNG bindSocket', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(gameState.bindSocket).not.toHaveBeenCalled();
  });

  it('có auth ⇒ bindSocket() + KHÔNG router.replace', async () => {
    mountView();
    await flushPromises();
    expect(gameState.bindSocket).toHaveBeenCalledOnce();
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });
});

describe('GiftCodeView — onRedeem flow', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    authState.isAuthenticated = true;
    authState.hydrate = vi.fn().mockResolvedValue(undefined);
    gameState.bindSocket = vi.fn();
    gameState.fetchState = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it('input rỗng (chỉ whitespace) ⇒ KHÔNG gọi API + KHÔNG toast', async () => {
    const w = mountView();
    await flushPromises();
    const input = w.find('input');
    await input.setValue('   ');
    await w.find('form').trigger('submit.prevent');
    await flushPromises();
    expect(redeemGiftCodeMock).not.toHaveBeenCalled();
    expect(toastPushMock).not.toHaveBeenCalled();
  });

  it('redeem thành công ⇒ toast success, clear input, render reward block', async () => {
    redeemGiftCodeMock.mockResolvedValue({
      code: 'WELCOME',
      grantedLinhThach: '100',
      grantedTienNgoc: 5,
      grantedExp: '0',
      grantedItems: [{ itemKey: 'BINH_KHI_SAT', qty: 1 }],
    });
    const w = mountView();
    await flushPromises();
    await w.find('input').setValue('welcome');
    await w.find('form').trigger('submit.prevent');
    await flushPromises();
    expect(redeemGiftCodeMock).toHaveBeenCalledWith('welcome');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
    expect((w.find('input').element as HTMLInputElement).value).toBe('');
    expect(w.text()).toContain('Phần thưởng của mã WELCOME');
    expect(w.text()).toContain('100');
    expect(w.text()).toContain('item:BINH_KHI_SAT');
  });

  it('redeem trim trước khi gọi API (input có trailing whitespace)', async () => {
    redeemGiftCodeMock.mockResolvedValue({
      code: 'TRIM',
      grantedLinhThach: '0',
      grantedTienNgoc: 0,
      grantedExp: '0',
      grantedItems: [],
    });
    const w = mountView();
    await flushPromises();
    await w.find('input').setValue('  TRIM  ');
    await w.find('form').trigger('submit.prevent');
    await flushPromises();
    expect(redeemGiftCodeMock).toHaveBeenCalledWith('TRIM');
  });

  it('error code có i18n key (CODE_NOT_FOUND) ⇒ toast với label cụ thể', async () => {
    redeemGiftCodeMock.mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'CODE_NOT_FOUND' }),
    );
    const w = mountView();
    await flushPromises();
    await w.find('input').setValue('bad');
    await w.find('form').trigger('submit.prevent');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Mã không tồn tại.',
    });
  });

  it('error code đã được dùng (ALREADY_REDEEMED) ⇒ toast tương ứng', async () => {
    redeemGiftCodeMock.mockRejectedValue(
      Object.assign(new Error('used'), { code: 'ALREADY_REDEEMED' }),
    );
    const w = mountView();
    await flushPromises();
    await w.find('input').setValue('used');
    await w.find('form').trigger('submit.prevent');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Mã đã được đổi.',
    });
  });

  it('error code KHÔNG có i18n key ⇒ fallback giftcode.errors.UNKNOWN', async () => {
    redeemGiftCodeMock.mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'TOTALLY_NEW_CODE' }),
    );
    const w = mountView();
    await flushPromises();
    await w.find('input').setValue('x');
    await w.find('form').trigger('submit.prevent');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Có lỗi xảy ra.',
    });
  });

  it('error không có code field ⇒ fallback UNKNOWN', async () => {
    redeemGiftCodeMock.mockRejectedValue(new Error('no code attached'));
    const w = mountView();
    await flushPromises();
    await w.find('input').setValue('x');
    await w.find('form').trigger('submit.prevent');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Có lỗi xảy ra.',
    });
  });

  it('busy lock: trong khi pending, button disabled', async () => {
    const resolveHolder: { current: ((v: unknown) => void) | null } = {
      current: null,
    };
    redeemGiftCodeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHolder.current = resolve;
        }),
    );
    const w = mountView();
    await flushPromises();
    await w.find('input').setValue('lock');
    const submit = w.find('form');
    await submit.trigger('submit.prevent');
    await flushPromises();
    const btn = w.find('button[type="submit"]');
    expect(btn.attributes('disabled')).toBeDefined();
    resolveHolder.current?.({
      code: 'LOCK',
      grantedLinhThach: '0',
      grantedTienNgoc: 0,
      grantedExp: '0',
      grantedItems: [],
    });
    await flushPromises();
  });
});
