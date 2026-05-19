import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import BodyCultivationView from '@/views/BodyCultivationView.vue';

const routerReplaceMock = vi.fn();
const fetchStateMock = vi.fn().mockResolvedValue(undefined);
const startMock = vi.fn();
const stopMock = vi.fn();
const breakthroughMock = vi.fn();
const toastPushMock = vi.fn();

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { template: '<main><slot /></main>' },
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
  RouterLink: { template: '<a><slot /></a>' },
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hydrate: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: true,
  }),
}));

vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    fetchState: fetchStateMock,
    bindSocket: vi.fn(),
  }),
}));

const bodyStoreState = {
  status: null as typeof baseStatus | null,
  loaded: true,
  loading: false,
  actionLoading: false,
  errorCode: null as string | null,
  progress: 0.5,
  fetchState: fetchStateMock,
  start: startMock,
  stop: stopMock,
  breakthrough: breakthroughMock,
  reset: vi.fn(),
};

vi.mock('@/stores/bodyCultivation', () => ({
  useBodyCultivationStore: () => bodyStoreState,
}));

vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({
    push: toastPushMock,
  }),
}));

const messages = {
  vi: {
    common: { cancel: 'Huỷ' },
    bodyCultivation: {
      title: 'Luyện Thể',
      subtitle: 'Rèn thân',
      loading: 'Đang tải',
      empty: 'Trống',
      realmLabel: 'Cảnh giới',
      stage: 'Tầng {stage}',
      training: { on: 'Đang luyện', off: 'Nghỉ' },
      exp: 'Body EXP',
      rate: '+{rate} EXP',
      injury: 'Thương tới {until}',
      start: 'Bắt đầu',
      stop: 'Dừng',
      backHome: 'Về',
      toast: { started: 'Đã bắt đầu', stopped: 'Đã dừng' },
      stats: { title: 'Chỉ số', bossReduction: 'Giảm boss' },
      action: { errors: { UNKNOWN: 'Lỗi' } },
      breakthrough: {
        button: 'Đột phá',
        success: 'Thành công',
        failed: 'Thất bại',
        requirement: 'Điều kiện',
        requiredExp: 'EXP cần',
        requiredPill: 'Đan cần',
        materials: 'Nguyên liệu',
        missing: 'Còn thiếu',
        maxed: 'Tối đa',
        confirmTitle: 'Xác nhận',
        confirmBody: 'Tiêu hao nguyên liệu',
        confirm: 'Thử',
        errors: { UNKNOWN: 'Lỗi' },
      },
    },
  },
};

const baseStatus = {
  bodyRealmKey: 'pham_than',
  bodyRealmName: 'Phàm Thân',
  bodyStage: 1,
  bodyExp: '50',
  bodyExpNext: '120',
  bodyRate: 3,
  bodyCultivating: false,
  bodyInjuryUntil: null,
  physiqueKey: null,
  statBonus: {
    hpMax: 10,
    power: 2,
    def: 3,
    staminaMax: 1,
    bossDamageReduction: 0.01,
  },
  canBreakthrough: false,
  breakthroughRequirement: {
    fromOrder: 0,
    toOrder: 1,
    bodyExpCost: '120',
    materials: [{ itemKey: 'khi_huyet_thao', qty: 2 }],
    pillItemKey: null,
    minSuccessRate: 0.7,
  },
  missingMaterials: [{ itemKey: 'khi_huyet_thao', required: 2, owned: 1 }],
};

function mountView(overrides: Partial<typeof baseStatus> = {}) {
  bodyStoreState.status = { ...baseStatus, ...overrides };

  const i18n = createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    messages,
  });

  return {
    wrapper: mount(BodyCultivationView, { global: { plugins: [i18n] } }),
    start: startMock,
    stop: stopMock,
    breakthrough: breakthroughMock,
  };
}

describe('BodyCultivationView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startMock.mockResolvedValue(null);
    stopMock.mockResolvedValue(null);
    breakthroughMock.mockResolvedValue({ code: null, success: true });
    bodyStoreState.loaded = true;
    bodyStoreState.loading = false;
    bodyStoreState.actionLoading = false;
    bodyStoreState.errorCode = null;
    bodyStoreState.progress = 0.5;
    bodyStoreState.status = null;
  });

  it('renders body state, missing materials and stat bonuses', () => {
    const { wrapper } = mountView();

    expect(wrapper.text()).toContain('Phàm Thân');
    expect(wrapper.text()).toContain('50 / 120');
    expect(wrapper.get('[data-testid="body-missing-materials"]').text()).toContain(
      'Khí Huyết Thảo × 2 (1)',
    );
    expect(wrapper.text()).toContain('+10');
    expect(wrapper.text()).toContain('1%');
  });

  it('start/stop button calls matching store action', async () => {
    const started = mountView();
    await started.wrapper.get('[data-testid="body-cultivation-toggle"]').trigger('click');
    expect(started.start).toHaveBeenCalledOnce();

    const stopped = mountView({ bodyCultivating: true });
    await stopped.wrapper.get('[data-testid="body-cultivation-toggle"]').trigger('click');
    expect(stopped.stop).toHaveBeenCalledOnce();
  });

  it('disables breakthrough when conditions are missing', () => {
    const { wrapper } = mountView({ canBreakthrough: false });

    expect(wrapper.get('[data-testid="body-breakthrough-button"]').attributes('disabled')).toBeDefined();
  });

  it('opens confirm modal and submits breakthrough', async () => {
    const { wrapper, breakthrough } = mountView({
      bodyExp: '120',
      canBreakthrough: true,
      missingMaterials: [],
    });

    await wrapper.get('[data-testid="body-breakthrough-button"]').trigger('click');
    expect(wrapper.find('[data-testid="body-breakthrough-confirm"]').exists()).toBe(true);

    await wrapper.get('[data-testid="body-breakthrough-confirm-submit"]').trigger('click');
    expect(breakthrough).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="body-breakthrough-confirm"]').exists()).toBe(false);
  });
});

describe('BodyCultivationView — role hint + cross-nav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bodyStoreState.loaded = true;
    bodyStoreState.loading = false;
    bodyStoreState.actionLoading = false;
    bodyStoreState.errorCode = null;
    bodyStoreState.progress = 0.5;
    bodyStoreState.status = { ...baseStatus };
  });

  it('render role hint', () => {
    const { wrapper } = mountView();
    expect(wrapper.find('[data-testid="body-cultivation-role-section"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="body-cultivation-role-hint"]').text()).toBeTruthy();
  });

  it('render cross-nav với link đúng', () => {
    const { wrapper } = mountView();
    expect(wrapper.find('[data-testid="body-cultivation-cross-nav"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="body-cultivation-cross-nav-cultivation"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="body-cultivation-cross-nav-breakthrough"]').exists()).toBe(true);
  });
});
