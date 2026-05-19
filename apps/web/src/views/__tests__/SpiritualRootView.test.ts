import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * Phase 11.3.D — SpiritualRootView test suite.
 *
 * Bao phủ:
 *  - Loading + empty state (state=null hoặc grade không hợp lệ).
 *  - Render grade card + element wheel + secondary list khi có state.
 *  - Element wheel mark đúng role (primary/secondary/inactive).
 *  - Reroll confirm dialog open/close.
 *  - Reroll success → toast.
 *  - Reroll error LINH_CAN_DAN_INSUFFICIENT → toast error.
 *  - Reroll button disabled khi rerolling=true.
 */

const replaceMock = vi.fn();
const rerollMock = vi.fn();
const fetchStateMock = vi.fn().mockResolvedValue(undefined);
const toastPushMock = vi.fn();

interface SpiritualRootStateStub {
  grade: string;
  primaryElement: string;
  secondaryElements: string[];
  purity: number;
  rerollCount: number;
}

interface RootStoreStub {
  state: SpiritualRootStateStub | null;
  loaded: boolean;
  rerolling: boolean;
  fetchState: typeof fetchStateMock;
  reroll: typeof rerollMock;
  reset: () => void;
}

const STUB_STATE: SpiritualRootStateStub = {
  grade: 'linh',
  primaryElement: 'kim',
  secondaryElements: ['moc'],
  purity: 88,
  rerollCount: 0,
};

const rootState: RootStoreStub = {
  state: STUB_STATE,
  loaded: true,
  rerolling: false,
  fetchState: fetchStateMock,
  reroll: rerollMock,
  reset: vi.fn(),
};

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hydrate: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: true,
  }),
}));
vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    fetchState: vi.fn().mockResolvedValue(undefined),
    bindSocket: vi.fn(),
    character: { realmKey: 'truc_co' },
  }),
}));
vi.mock('@/stores/spiritualRoot', () => ({
  useSpiritualRootStore: () => rootState,
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({
    push: toastPushMock,
  }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

import SpiritualRootView from '@/views/SpiritualRootView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      spiritualRoot: {
        title: 'Linh Căn',
        subtitle: 'sub',
        loading: 'Đang tải linh căn',
        empty: 'Trống',
        rerollCount: 'Đã tái khai: {count}',
        field: {
          tier: 'T{tier}',
          purity: 'Thuần',
          cultivationMultiplier: 'Tu',
          statBonus: 'Stat',
          secondaryCount: 'Phụ',
        },
        grade: {
          pham: 'Phàm',
          linh: 'Linh',
          huyen: 'Huyền',
          tien: 'Tiên',
          than: 'Thần',
        },
        element: {
          kim: 'Kim',
          moc: 'Mộc',
          thuy: 'Thuỷ',
          hoa: 'Hoả',
          tho: 'Thổ',
          role: {
            primary: 'Chính',
            secondary: 'Phụ',
            inactive: 'Vô',
          },
        },
        elements: {
          title: 'Ngũ hành',
          legend: 'legend',
          secondaryLabel: 'Phụ',
        },
        reroll: {
          title: 'Tái khai',
          description: 'desc',
          warning: 'warn',
          success: 'Đã tái khai',
          button: { idle: 'Tái khai', inFlight: 'Đang gieo' },
          confirm: {
            title: 'Xác nhận',
            body: 'body',
            cost: 'cost',
            cancel: 'Huỷ',
            accept: 'Đồng ý',
          },
          errors: {
            LINH_CAN_DAN_INSUFFICIENT: 'Hết Linh Căn Đan',
            NOT_INITIALIZED: 'Chưa khai',
            UNKNOWN: 'Lỗi',
          },
        },
      },
    },
  },
});

function mountView() {
  return mount(SpiritualRootView, { global: { plugins: [i18n] } });
}

function resetState() {
  rootState.state = { ...STUB_STATE, secondaryElements: ['moc'] };
  rootState.loaded = true;
  rootState.rerolling = false;
  rerollMock.mockReset();
  fetchStateMock.mockReset();
  fetchStateMock.mockResolvedValue(undefined);
  toastPushMock.mockClear();
}

describe('SpiritualRootView — loading & empty states', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('loading state khi store.loaded=false', async () => {
    rootState.loaded = false;
    rootState.state = null;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="spiritual-root-loading"]').exists()).toBe(true);
    expect(w.find('[data-testid="spiritual-root-grade-card"]').exists()).toBe(false);
  });

  it('empty state khi state=null nhưng loaded=true', async () => {
    rootState.loaded = true;
    rootState.state = null;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="spiritual-root-empty"]').exists()).toBe(true);
  });

  it('empty state khi grade không hợp lệ (defensive)', async () => {
    rootState.loaded = true;
    rootState.state = { ...STUB_STATE, grade: 'unknown_grade' };
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="spiritual-root-empty"]').exists()).toBe(true);
  });
});

describe('SpiritualRootView — render state', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('hiển thị grade card với name + tier + purity', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="spiritual-root-grade-card"]').exists()).toBe(true);
    expect(w.find('[data-testid="spiritual-root-grade-name"]').text()).toContain('Linh');
    expect(w.find('[data-testid="spiritual-root-purity"]').text()).toContain('88');
    expect(w.find('[data-testid="spiritual-root-tier"]').text()).toContain('T1');
  });

  it('hiển thị reroll count trong header', async () => {
    rootState.state = { ...STUB_STATE, rerollCount: 3 };
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="spiritual-root-reroll-count"]').text()).toContain('3');
  });

  it('element wheel: primary kim, secondary moc, còn lại inactive', async () => {
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="spiritual-root-element-kim"]').attributes('data-role'),
    ).toBe('primary');
    expect(
      w.find('[data-testid="spiritual-root-element-moc"]').attributes('data-role'),
    ).toBe('secondary');
    expect(
      w.find('[data-testid="spiritual-root-element-thuy"]').attributes('data-role'),
    ).toBe('inactive');
    expect(
      w.find('[data-testid="spiritual-root-element-hoa"]').attributes('data-role'),
    ).toBe('inactive');
    expect(
      w.find('[data-testid="spiritual-root-element-tho"]').attributes('data-role'),
    ).toBe('inactive');
  });

  it('secondary list ẩn khi không có secondary (grade=pham)', async () => {
    rootState.state = { ...STUB_STATE, grade: 'pham', secondaryElements: [] };
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="spiritual-root-secondary-list"]').exists()).toBe(false);
  });

  it('secondary list hiển thị tên elements khi có secondary', async () => {
    rootState.state = {
      ...STUB_STATE,
      grade: 'tien',
      secondaryElements: ['moc', 'thuy', 'hoa'],
    };
    const w = mountView();
    await flushPromises();
    const txt = w.find('[data-testid="spiritual-root-secondary-list"]').text();
    expect(txt).toContain('Mộc');
    expect(txt).toContain('Thuỷ');
    expect(txt).toContain('Hoả');
  });
});

describe('SpiritualRootView — reroll flow', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('click reroll button mở confirm dialog', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="spiritual-root-reroll-confirm"]').exists()).toBe(false);
    await w.find('[data-testid="spiritual-root-reroll-button"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="spiritual-root-reroll-confirm"]').exists()).toBe(true);
  });

  it('cancel button đóng dialog mà không gọi reroll', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="spiritual-root-reroll-button"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="spiritual-root-reroll-cancel"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="spiritual-root-reroll-confirm"]').exists()).toBe(false);
    expect(rerollMock).not.toHaveBeenCalled();
  });

  it('accept button gọi reroll() + toast success khi thành công', async () => {
    rerollMock.mockResolvedValueOnce(null);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="spiritual-root-reroll-button"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="spiritual-root-reroll-accept"]').trigger('click');
    await flushPromises();
    expect(rerollMock).toHaveBeenCalledTimes(1);
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'success',
      text: 'Đã tái khai',
    });
  });

  it('accept button → toast error LINH_CAN_DAN_INSUFFICIENT khi server reject', async () => {
    rerollMock.mockResolvedValueOnce('LINH_CAN_DAN_INSUFFICIENT');
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="spiritual-root-reroll-button"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="spiritual-root-reroll-accept"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Hết Linh Căn Đan',
    });
  });

  it('accept button → toast error UNKNOWN fallback khi error code không có i18n', async () => {
    rerollMock.mockResolvedValueOnce('UNREGISTERED_CODE');
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="spiritual-root-reroll-button"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="spiritual-root-reroll-accept"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Lỗi',
    });
  });

  it('reroll button disabled khi rerolling=true + label đổi sang "Đang gieo"', async () => {
    rootState.rerolling = true;
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="spiritual-root-reroll-button"]');
    expect(btn.attributes('disabled')).toBeDefined();
    expect(btn.text()).toContain('Đang gieo');
  });
});

describe('SpiritualRootView — role hint + cross-nav', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    rootState.loaded = true;
    rootState.rerolling = false;
    rootState.state = {
      grade: 'linh',
      primaryElement: 'thuy',
      secondaryElements: ['kim'],
      purity: 80,
      rerollCount: 0,
    };
  });

  it('render role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="spiritual-root-role-section"]').exists()).toBe(true);
    expect(w.find('[data-testid="spiritual-root-role-hint"]').text()).toBeTruthy();
  });

  it('render cross-nav với link đúng', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="spiritual-root-cross-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="spiritual-root-cross-nav-cultivation"]').exists()).toBe(true);
    expect(w.find('[data-testid="spiritual-root-cross-nav-breakthrough"]').exists()).toBe(true);
  });
});
