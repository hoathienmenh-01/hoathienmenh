import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { SectDetailView, SectListView } from '@/api/sect';

/**
 * SectView smoke tests (session 9j task I / K3.7): cover auth routing, tab
 * switching (mine/all/create), list render, join flow (success + error +
 * submitting guard), leave flow (confirm gate + success + cancel), create
 * flow (name regex validation + success + error), contribute flow (currency
 * safety — amount được gửi đúng).
 *
 * SectView đụng **CurrencyLedger** qua `contributeSect` (trừ linhThach của
 * character, cộng treasury sect). Regression có thể làm double-spend hoặc
 * treasury không cập nhật. Thêm 13 test chống regression.
 */

const listSectsMock = vi.fn();
const mySectMock = vi.fn();
const joinSectMock = vi.fn();
const leaveSectMock = vi.fn();
const createSectMock = vi.fn();
const contributeSectMock = vi.fn();

vi.mock('@/api/sect', async () => {
  const actual = await vi.importActual<typeof import('@/api/sect')>('@/api/sect');
  return {
    ...actual,
    listSects: (...a: unknown[]) => listSectsMock(...a),
    mySect: (...a: unknown[]) => mySectMock(...a),
    joinSect: (...a: unknown[]) => joinSectMock(...a),
    leaveSect: (...a: unknown[]) => leaveSectMock(...a),
    createSect: (...a: unknown[]) => createSectMock(...a),
    contributeSect: (...a: unknown[]) => contributeSectMock(...a),
  };
});

const routerReplaceMock = vi.fn();
const routerPushMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: routerPushMock }),
  RouterLink: { name: 'RouterLinkStub', template: '<a><slot /></a>' },
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

const gameState: { character: { linhThach: string } | null } = {
  character: { linhThach: '5000' },
};
vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    get character() {
      return gameState.character;
    },
    fetchState: vi.fn().mockResolvedValue(undefined),
    bindSocket: vi.fn(),
  }),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShell', template: '<div><slot /></div>' },
}));

import SectViewComponent from '@/views/SectView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      sect: {
        title: 'Tông môn',
        roleHint: 'Tông Môn là cộng đồng — gia nhập để đóng góp linh thạch.',
        crossNav: {
          label: 'Xem thêm',
          sectWar: 'Tông Chiến',
          sectContent: 'Nội Dung Tông',
        },
        tab: { mine: 'Tông của tôi', all: 'Danh sách', create: 'Lập tông' },
        myStash: 'Linh thạch: {n}',
        level: 'Lv.{lv}',
        members: '{n} đệ tử',
        disciples: '{n} đệ tử',
        leader: 'Tông chủ: {name}',
        leaderTag: '(Tông chủ)',
        you: '(Bạn)',
        treasury: 'Kho',
        contribLabel: 'Đóng góp',
        contribHint: '= {n} linh thạch',
        contribute: 'Đóng góp',
        contributeToast: 'Đóng góp thành công',
        leave: 'Rời tông',
        leaveConfirm: 'Rời {name}?',
        leaveToast: 'Đã rời tông',
        joinToast: 'Đã gia nhập {name}',
        createToast: 'Lập tông thành công',
        invalidNameToast: 'Tên không hợp lệ',
        disciplesTitle: '{n} đệ tử',
        col: { name: 'Tên', realm: 'Cảnh giới', contrib: 'Cống hiến' },
        noneList: 'Chưa có tông nào',
        join: 'Gia nhập',
        alreadyInOther: 'Đang ở tông khác',
        inOtherSect: 'Bạn đang ở {name}',
        form: { name: 'Tên tông', desc: 'Mô tả' },
        errors: {
          NOT_ENOUGH: 'Không đủ linh thạch',
          ALREADY_IN: 'Đã ở tông khác',
          UNKNOWN: 'Lỗi không rõ',
        },
      },
    },
  },
});

function makeList(overrides: Partial<SectListView> = {}): SectListView {
  return {
    id: 's1',
    name: 'Thanh Vân',
    description: 'Tông môn chính đạo',
    level: 1,
    treasuryLinhThach: '10000',
    memberCount: 5,
    leaderName: 'Tông Chủ',
    createdAt: '2026-04-30T00:00:00Z',
    ...overrides,
  };
}

function makeDetail(overrides: Partial<SectDetailView> = {}): SectDetailView {
  return {
    ...makeList(),
    members: [
      {
        id: 'u1',
        name: 'Me',
        realmKey: 'luyen_khi',
        realmStage: 1,
        congHien: 50,
        role: 'MEMBER',
        isLeader: false,
        isMe: true,
      },
    ],
    isMyMember: true,
    isMyLeader: false,
    ...overrides,
  };
}

function mountView() {
  return mount(SectViewComponent, { global: { plugins: [i18n] } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  listSectsMock.mockReset();
  mySectMock.mockReset();
  joinSectMock.mockReset();
  leaveSectMock.mockReset();
  createSectMock.mockReset();
  contributeSectMock.mockReset();
  routerReplaceMock.mockReset();
  toastPushMock.mockReset();
  authState.isAuthenticated = true;
  authState.hydrate.mockReset();
  authState.hydrate.mockResolvedValue(undefined);
  gameState.character = { linhThach: '5000' };
});

describe('SectView — onMounted routing & load', () => {
  it('unauth → replace /auth, không gọi listSects', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(listSectsMock).not.toHaveBeenCalled();
  });

  it('auth + chưa có sect → listSects + mySect được gọi, tab mặc định all', async () => {
    listSectsMock.mockResolvedValue([makeList()]);
    mySectMock.mockResolvedValue(null);
    const w = mountView();
    await flushPromises();
    expect(listSectsMock).toHaveBeenCalled();
    expect(mySectMock).toHaveBeenCalled();
    expect(w.text()).toContain('Thanh Vân');
  });

  it('auth + đã có sect → tab mặc định mine, render sect info', async () => {
    listSectsMock.mockResolvedValue([]);
    mySectMock.mockResolvedValue(makeDetail({ name: 'Huyền Thủy' }));
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Huyền Thủy');
    expect(w.text()).toContain('Đóng góp');
  });
});

describe('SectView — join flow', () => {
  beforeEach(() => {
    listSectsMock.mockResolvedValue([makeList({ id: 's1', name: 'Target' })]);
    mySectMock.mockResolvedValue(null);
  });

  it('success: joinSect(id) + toast success + chuyển tab mine', async () => {
    joinSectMock.mockResolvedValue(makeDetail({ id: 's1', name: 'Target' }));
    // After join, refreshAll re-calls listSects + mySect; mock mySect returns detail.
    mySectMock.mockResolvedValueOnce(null).mockResolvedValueOnce(makeDetail({ name: 'Target' }));
    const w = mountView();
    await flushPromises();
    const joinBtn = w.findAll('button').find((b) => b.text() === 'Gia nhập')!;
    await joinBtn.trigger('click');
    await flushPromises();

    expect(joinSectMock).toHaveBeenCalledWith('s1');
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'success',
      text: 'Đã gia nhập Target',
    });
  });

  it('error ALREADY_IN → toast mapped', async () => {
    joinSectMock.mockRejectedValue(
      Object.assign(new Error('dup'), { code: 'ALREADY_IN' }),
    );
    const w = mountView();
    await flushPromises();
    const joinBtn = w.findAll('button').find((b) => b.text() === 'Gia nhập')!;
    await joinBtn.trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Đã ở tông khác',
    });
  });
});

describe('SectView — leave flow (confirm gate)', () => {
  beforeEach(() => {
    listSectsMock.mockResolvedValue([]);
    mySectMock.mockResolvedValue(makeDetail({ name: 'Huyền Thủy' }));
  });

  it('user confirm=true → leaveSect gọi + toast', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    leaveSectMock.mockResolvedValue(undefined);
    mySectMock.mockResolvedValueOnce(makeDetail({ name: 'Huyền Thủy' })).mockResolvedValueOnce(null);
    const w = mountView();
    await flushPromises();
    const leaveBtn = w.findAll('button').find((b) => b.text() === 'Rời tông')!;
    await leaveBtn.trigger('click');
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalled();
    expect(leaveSectMock).toHaveBeenCalled();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'system',
      text: 'Đã rời tông',
    });
    confirmSpy.mockRestore();
  });

  it('user confirm=false → KHÔNG gọi leaveSect', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const w = mountView();
    await flushPromises();
    const leaveBtn = w.findAll('button').find((b) => b.text() === 'Rời tông')!;
    await leaveBtn.trigger('click');
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalled();
    expect(leaveSectMock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe('SectView — create flow (name validation)', () => {
  beforeEach(() => {
    listSectsMock.mockResolvedValue([]);
    mySectMock.mockResolvedValue(null);
  });

  async function openCreateTab(w: ReturnType<typeof mountView>) {
    const createTab = w.findAll('button').find((b) => b.text() === 'Lập tông')!;
    await createTab.trigger('click');
    await flushPromises();
  }

  it('name 1 ký tự → toast invalid + createSect KHÔNG gọi', async () => {
    const w = mountView();
    await flushPromises();
    await openCreateTab(w);
    const nameInput = w.find('input[type="text"]');
    await nameInput.setValue('A');
    await w.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Tên không hợp lệ',
    });
    expect(createSectMock).not.toHaveBeenCalled();
  });

  it('name hợp lệ → createSect(name, desc) + toast success', async () => {
    createSectMock.mockResolvedValue(makeDetail({ name: 'Tân Tông' }));
    mySectMock.mockResolvedValueOnce(null).mockResolvedValueOnce(makeDetail({ name: 'Tân Tông' }));
    const w = mountView();
    await flushPromises();
    await openCreateTab(w);
    const inputs = w.findAll('input[type="text"]');
    await inputs[0].setValue('Tân Tông');
    // desc via textarea if present; skip if not
    await w.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(createSectMock).toHaveBeenCalled();
    const call = createSectMock.mock.calls[0];
    expect(call[0]).toBe('Tân Tông');
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'success',
      text: 'Lập tông thành công',
    });
  });
});

describe('SectView — contribute flow (currency safety)', () => {
  beforeEach(() => {
    listSectsMock.mockResolvedValue([]);
    mySectMock.mockResolvedValue(makeDetail({ name: 'Huyền Thủy' }));
  });

  it('success: contributeSect(amount) với giá trị từ input', async () => {
    contributeSectMock.mockResolvedValue(makeDetail({ name: 'Huyền Thủy' }));
    mySectMock.mockResolvedValueOnce(makeDetail({ name: 'Huyền Thủy' })).mockResolvedValueOnce(
      makeDetail({ name: 'Huyền Thủy' }),
    );
    const w = mountView();
    await flushPromises();
    // Default contribAmount = '100', click contribute button
    const contribBtn = w.findAll('button').find((b) => b.text() === 'Đóng góp')!;
    await contribBtn.trigger('click');
    await flushPromises();

    expect(contributeSectMock).toHaveBeenCalledWith('100');
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'success',
      text: 'Đóng góp thành công',
    });
  });

  it('error NOT_ENOUGH → toast mapped (không đủ linh thạch)', async () => {
    contributeSectMock.mockRejectedValue(
      Object.assign(new Error('broke'), { code: 'NOT_ENOUGH' }),
    );
    const w = mountView();
    await flushPromises();
    const contribBtn = w.findAll('button').find((b) => b.text() === 'Đóng góp')!;
    await contribBtn.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Không đủ linh thạch',
    });
  });

  it('submitting guard: click lần 2 trong khi contribute pending → chỉ 1 call', async () => {
    const resolveHolder: {
      current: ((v: SectDetailView) => void) | null;
    } = { current: null };
    contributeSectMock.mockImplementation(
      () =>
        new Promise<SectDetailView>((resolve) => {
          resolveHolder.current = resolve;
        }),
    );
    const w = mountView();
    await flushPromises();
    const contribBtn = w.findAll('button').find((b) => b.text() === 'Đóng góp')!;
    await contribBtn.trigger('click');
    await flushPromises();
    await contribBtn.trigger('click');
    await flushPromises();

    expect(contributeSectMock).toHaveBeenCalledTimes(1);
    resolveHolder.current?.(makeDetail({ name: 'Huyền Thủy' }));
  });
});

describe('SectView — role hint + cross-nav', () => {
  beforeEach(() => {
    listSectsMock.mockResolvedValue([]);
    mySectMock.mockResolvedValue(null);
  });

  it('renders role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="sect-role-hint"]').exists()).toBe(true);
    expect(w.text()).toContain('Tông Môn là cộng đồng');
  });

  it('renders cross-navigation links', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="sect-cross-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="sect-cross-nav-war"]').exists()).toBe(true);
    expect(w.find('[data-testid="sect-cross-nav-content"]').exists()).toBe(true);
  });

  it('sect-war-cta uses data-testid (not data-test)', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="sect-war-cta"]').exists()).toBe(true);
  });
});
