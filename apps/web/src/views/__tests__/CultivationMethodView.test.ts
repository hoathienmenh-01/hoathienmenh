import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * Phase 11.1.C — CultivationMethodView test suite.
 *
 * Bao phủ:
 *  - Loading state khi store chưa loaded.
 *  - Render đầy đủ method từ store.learned (kết hợp với catalog static).
 *  - Filter theo grade (pham/huyen/tien/than).
 *  - Empty state khi filter không khớp.
 *  - Equipped badge + button label "Đang vận" cho method đang equip.
 *  - Click equip → store.equip called.
 *  - Toast success khi equip thành công.
 *  - Toast error khi server reject (errCode).
 *  - Equip button disabled khi inFlight hoặc đã equip.
 *  - Render method có element=null hiển thị "Vô hệ".
 */

const replaceMock = vi.fn();
const equipMock = vi.fn();
const fetchStateMock = vi.fn().mockResolvedValue(undefined);
const toastPushMock = vi.fn();

interface LearnedRowStub {
  methodKey: string;
  source: string;
  learnedAt: string;
}

const STUB_LEARNED: LearnedRowStub[] = [
  {
    methodKey: 'khai_thien_quyet',
    source: 'starter',
    learnedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    methodKey: 'cuu_cuc_kim_cuong_quyet',
    source: 'sect_shop',
    learnedAt: '2026-02-01T00:00:00.000Z',
  },
];

interface MethodStoreStub {
  equippedMethodKey: string | null;
  equippedMethodElementAffinity: number;
  learned: LearnedRowStub[];
  loaded: boolean;
  inFlight: Set<string>;
  affinityPercentLabel: string | null;
  affinityTierKey: string | null;
  fetchState: typeof fetchStateMock;
  equip: typeof equipMock;
  isEquipped: (k: string) => boolean;
  isEquipping: (k: string) => boolean;
  reset: () => void;
}

const methodState: MethodStoreStub = {
  equippedMethodKey: 'khai_thien_quyet',
  equippedMethodElementAffinity: 0,
  learned: STUB_LEARNED,
  loaded: true,
  inFlight: new Set<string>(),
  affinityPercentLabel: null,
  affinityTierKey: null,
  fetchState: fetchStateMock,
  equip: equipMock,
  isEquipped: (k: string) => methodState.equippedMethodKey === k,
  isEquipping: (k: string) => methodState.inFlight.has(k),
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
vi.mock('@/stores/cultivationMethod', () => ({
  useCultivationMethodStore: () => methodState,
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

import CultivationMethodView from '@/views/CultivationMethodView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      cultivationMethod: {
        title: 'Công Pháp',
        subtitle: 'sub',
        loading: 'Đang tải',
        empty: 'Trống',
        equippedSummary: 'Vận: {key}',
        equippedNone: 'Chưa vận',
        filter: {
          grade: 'Cấp',
          all: 'Tất cả',
          shown: 'Hiển thị {shown}/{total} (kho {catalog})',
        },
        grade: {
          pham: 'Phàm',
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
          loi: 'Lôi',
          phong: 'Phong',
          bang: 'Băng',
          doc: 'Độc',
          am: 'Âm',
          duong: 'Dương',
          hon_don: 'Hỗn Độn',
          none: 'Vô hệ',
        },
        source: {
          starter: 'Khởi đầu',
          sect_shop: 'Tông môn',
          dungeon_drop: 'Bí cảnh',
          boss_drop: 'Boss',
          event: 'Sự kiện',
          quest_milestone: 'Nhiệm vụ',
        },
        field: {
          expMultiplier: 'Tu luyện',
          source: 'Nguồn',
        },
        badge: {
          equipped: 'Đang vận',
        },
        affinity: {
          primary: 'Cùng hệ chính (+10%)',
          secondary: 'Cùng hệ phụ (+5%)',
        },
        button: {
          equip: 'Vận',
          equipping: 'Đang vận…',
          equipped: 'Đang vận',
        },
        equip: {
          success: 'Đã vận {name}',
          errors: {
            NOT_LEARNED: 'Chưa học',
            REALM_TOO_LOW: 'Cảnh giới thấp',
            UNKNOWN: 'Lỗi',
          },
        },
      },
    },
  },
});

function mountView() {
  return mount(CultivationMethodView, { global: { plugins: [i18n] } });
}

function resetState() {
  methodState.equippedMethodKey = 'khai_thien_quyet';
  methodState.equippedMethodElementAffinity = 0;
  methodState.affinityPercentLabel = null;
  methodState.affinityTierKey = null;
  methodState.learned = STUB_LEARNED;
  methodState.loaded = true;
  methodState.inFlight = new Set();
  equipMock.mockReset();
  fetchStateMock.mockReset();
  fetchStateMock.mockResolvedValue(undefined);
  toastPushMock.mockClear();
}

describe('CultivationMethodView — render & loading', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('hiển thị loading khi store.loaded=false', async () => {
    methodState.loaded = false;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="cultivation-method-loading"]').exists()).toBe(true);
    expect(w.find('[data-testid="cultivation-method-list"]').exists()).toBe(false);
  });

  it('render đủ method đã học sau khi loaded', async () => {
    const w = mountView();
    await flushPromises();
    const cards = w.findAll('[data-testid^="cultivation-method-card-"]');
    expect(cards).toHaveLength(STUB_LEARNED.length);
    expect(
      w.find('[data-testid="cultivation-method-card-khai_thien_quyet"]').exists(),
    ).toBe(true);
    expect(
      w
        .find('[data-testid="cultivation-method-card-cuu_cuc_kim_cuong_quyet"]')
        .exists(),
    ).toBe(true);
  });

  it('hiển thị equipped key trong header', async () => {
    methodState.equippedMethodKey = 'khai_thien_quyet';
    const w = mountView();
    await flushPromises();
    const txt = w.find('[data-testid="cultivation-method-equipped"]').text();
    expect(txt).toContain('khai_thien_quyet');
  });

  it('hiển thị "Chưa vận" khi không có method equipped', async () => {
    methodState.equippedMethodKey = null;
    const w = mountView();
    await flushPromises();
    const txt = w.find('[data-testid="cultivation-method-equipped"]').text();
    expect(txt).toContain('Chưa vận');
  });

  it('result count reflect filtered/total/catalog', async () => {
    const w = mountView();
    await flushPromises();
    const txt = w.find('[data-testid="cultivation-method-count"]').text();
    expect(txt).toContain(`${STUB_LEARNED.length}/${STUB_LEARNED.length}`);
  });

  it('method đang equip hiển thị badge "Đang vận"', async () => {
    methodState.equippedMethodKey = 'khai_thien_quyet';
    const w = mountView();
    await flushPromises();
    expect(
      w
        .find(
          '[data-testid="cultivation-method-equipped-badge-khai_thien_quyet"]',
        )
        .exists(),
    ).toBe(true);
    expect(
      w
        .find(
          '[data-testid="cultivation-method-equipped-badge-cuu_cuc_kim_cuong_quyet"]',
        )
        .exists(),
    ).toBe(false);
  });
});

describe('CultivationMethodView — filter grade', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('filter grade=pham → chỉ render method pham', async () => {
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="cultivation-method-filter-grade"]')
      .setValue('pham');
    await flushPromises();
    expect(
      w.find('[data-testid="cultivation-method-card-khai_thien_quyet"]').exists(),
    ).toBe(true);
    expect(
      w
        .find('[data-testid="cultivation-method-card-cuu_cuc_kim_cuong_quyet"]')
        .exists(),
    ).toBe(false);
  });

  it('filter grade=than (no learned method match) → empty state', async () => {
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="cultivation-method-filter-grade"]')
      .setValue('than');
    await flushPromises();
    expect(w.find('[data-testid="cultivation-method-empty"]').exists()).toBe(true);
    expect(w.find('[data-testid="cultivation-method-list"]').exists()).toBe(false);
  });

  it('filter grade=all → render đủ', async () => {
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="cultivation-method-filter-grade"]')
      .setValue('pham');
    await flushPromises();
    await w
      .find('[data-testid="cultivation-method-filter-grade"]')
      .setValue('all');
    await flushPromises();
    const cards = w.findAll('[data-testid^="cultivation-method-card-"]');
    expect(cards).toHaveLength(STUB_LEARNED.length);
  });
});

describe('CultivationMethodView — equip button', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('button cho method đã equip → disabled + label "Đang vận"', async () => {
    methodState.equippedMethodKey = 'khai_thien_quyet';
    const w = mountView();
    await flushPromises();
    const btn = w.find(
      '[data-testid="cultivation-method-equip-khai_thien_quyet"]',
    );
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    expect(btn.text()).toContain('Đang vận');
  });

  it('click equip → store.equip called với methodKey', async () => {
    methodState.equippedMethodKey = 'khai_thien_quyet';
    equipMock.mockResolvedValueOnce(null);
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="cultivation-method-equip-cuu_cuc_kim_cuong_quyet"]')
      .trigger('click');
    await flushPromises();
    expect(equipMock).toHaveBeenCalledWith('cuu_cuc_kim_cuong_quyet');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('equip server reject với errCode → toast error key tương ứng', async () => {
    methodState.equippedMethodKey = 'khai_thien_quyet';
    equipMock.mockResolvedValueOnce('NOT_LEARNED');
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="cultivation-method-equip-cuu_cuc_kim_cuong_quyet"]')
      .trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text: 'Chưa học' }),
    );
  });

  it('equip server reject với errCode UNKNOWN → toast error UNKNOWN i18n', async () => {
    methodState.equippedMethodKey = 'khai_thien_quyet';
    equipMock.mockResolvedValueOnce('UNKNOWN');
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="cultivation-method-equip-cuu_cuc_kim_cuong_quyet"]')
      .trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text: 'Lỗi' }),
    );
  });

  it('button khi inFlight=true → disabled + label "Đang vận…"', async () => {
    methodState.equippedMethodKey = 'khai_thien_quyet';
    methodState.inFlight = new Set(['cuu_cuc_kim_cuong_quyet']);
    const w = mountView();
    await flushPromises();
    const btn = w.find(
      '[data-testid="cultivation-method-equip-cuu_cuc_kim_cuong_quyet"]',
    );
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    expect(btn.text()).toContain('Đang vận…');
  });
});

describe('CultivationMethodView — Phase 11.1.E affinity badge render', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('affinity primary (+10%): badge "+10%" render trong row equipped + summary', async () => {
    methodState.equippedMethodKey = 'khai_thien_quyet';
    methodState.equippedMethodElementAffinity = 0.1;
    methodState.affinityPercentLabel = '+10%';
    methodState.affinityTierKey = 'cultivationMethod.affinity.primary';
    const w = mountView();
    await flushPromises();
    const badge = w.find(
      '[data-testid="cultivation-method-affinity-badge-khai_thien_quyet"]',
    );
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('+10%');
    expect(badge.attributes('title')).toBe('Cùng hệ chính (+10%)');
    expect(badge.attributes('aria-label')).toBe('Cùng hệ chính (+10%)');
    expect(w.find('[data-testid="cultivation-method-equipped"]').text()).toContain('+10%');
  });

  it('affinity secondary (+5%): badge "+5%" + tooltip secondary', async () => {
    methodState.equippedMethodKey = 'khai_thien_quyet';
    methodState.equippedMethodElementAffinity = 0.05;
    methodState.affinityPercentLabel = '+5%';
    methodState.affinityTierKey = 'cultivationMethod.affinity.secondary';
    const w = mountView();
    await flushPromises();
    const badge = w.find(
      '[data-testid="cultivation-method-affinity-badge-khai_thien_quyet"]',
    );
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe('+5%');
    expect(badge.attributes('title')).toBe('Cùng hệ phụ (+5%)');
  });

  it('affinity 0 (vô hệ / khác hệ / legacy): badge KHÔNG render', async () => {
    methodState.equippedMethodKey = 'khai_thien_quyet';
    methodState.equippedMethodElementAffinity = 0;
    methodState.affinityPercentLabel = null;
    methodState.affinityTierKey = null;
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="cultivation-method-affinity-badge-khai_thien_quyet"]').exists(),
    ).toBe(false);
    expect(
      w.find('[data-testid="cultivation-method-affinity-badge-cuu_cuc_kim_cuong_quyet"]').exists(),
    ).toBe(false);
  });

  it('affinity badge KHÔNG render trên method KHÔNG equipped (chỉ render row đang vận)', async () => {
    methodState.equippedMethodKey = 'khai_thien_quyet';
    methodState.equippedMethodElementAffinity = 0.1;
    methodState.affinityPercentLabel = '+10%';
    methodState.affinityTierKey = 'cultivationMethod.affinity.primary';
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="cultivation-method-affinity-badge-khai_thien_quyet"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="cultivation-method-affinity-badge-cuu_cuc_kim_cuong_quyet"]').exists(),
    ).toBe(false);
  });
});
