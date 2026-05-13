import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const { listSectDungeonsMock, listSectBossesMock } = vi.hoisted(() => ({
  listSectDungeonsMock: vi.fn(),
  listSectBossesMock: vi.fn(),
}));

vi.mock('@/api/worldContent', async () => {
  const actual: object = await vi.importActual('@/api/worldContent');
  return {
    ...actual,
    listSectDungeons: listSectDungeonsMock,
    listSectBosses: listSectBossesMock,
  };
});

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div><slot /></div>' },
}));

import SectContentView from '@/views/SectContentView.vue';
import viMessages from '@/i18n/vi.json';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: { vi: viMessages },
});

function mountView() {
  return mount(SectContentView, { global: { plugins: [i18n] } });
}

const STUB_D = [
  {
    key: 'linh_mach_dong',
    nameVi: 'Linh Mạch Động',
    nameEn: 'Spirit Vein Cave',
    category: 'GENERAL',
    requiredSectLevel: 1,
    sourceTier: 1,
    dailyAttemptsPerMember: 2,
    weeklyAttemptsPerSect: null,
    contributionCost: 100,
  },
];
const STUB_B = [
  {
    key: 'thu_ho_linh_mach',
    nameVi: 'Thủ Hộ Linh Mạch',
    nameEn: 'Spirit Vein Guardian',
    category: 'SECT_BOSS',
    family: 'LINH_THE',
    requiredSectLevel: 1,
    sourceTier: 1,
    bossTier: 1,
  },
];

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe('SectContentView', () => {
  it('loading → list dungeon (default tab)', async () => {
    let resolveD: (v: unknown) => void = () => undefined;
    listSectDungeonsMock.mockReturnValueOnce(
      new Promise((res) => {
        resolveD = res;
      }),
    );
    listSectBossesMock.mockResolvedValue(STUB_B);
    const w = mountView();
    expect(w.find('[data-testid="sect-content-dungeon-loading"]').exists()).toBe(true);
    resolveD(STUB_D);
    await flushPromises();
    expect(w.find('[data-testid="sect-content-dungeon-list"]').exists()).toBe(true);
    expect(w.findAll('[data-testid^="sect-dungeon-item-"]').length).toBe(1);
  });

  it('switch tab boss render list boss', async () => {
    listSectDungeonsMock.mockResolvedValueOnce(STUB_D);
    listSectBossesMock.mockResolvedValueOnce(STUB_B);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="sect-content-tab-boss"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="sect-content-boss-list"]').exists()).toBe(true);
    expect(w.findAll('[data-testid^="sect-boss-item-"]').length).toBe(1);
  });

  it('empty state cho cả 2 tab', async () => {
    listSectDungeonsMock.mockResolvedValueOnce([]);
    listSectBossesMock.mockResolvedValueOnce([]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="sect-content-dungeon-empty"]').exists()).toBe(true);
    await w.find('[data-testid="sect-content-tab-boss"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="sect-content-boss-empty"]').exists()).toBe(true);
  });

  it('không crash khi user chưa có sect (fetch vẫn lấy catalog)', async () => {
    listSectDungeonsMock.mockResolvedValueOnce(STUB_D);
    listSectBossesMock.mockResolvedValueOnce(STUB_B);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="sect-content-view"]').exists()).toBe(true);
  });

  it('error state cả 2 fetch fail + reload', async () => {
    listSectDungeonsMock.mockRejectedValueOnce(new Error('boom'));
    listSectBossesMock.mockRejectedValueOnce(new Error('boom'));
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="sect-content-dungeon-error"]').exists()).toBe(true);
    listSectDungeonsMock.mockResolvedValueOnce(STUB_D);
    listSectBossesMock.mockResolvedValueOnce(STUB_B);
    await w
      .find('[data-testid="sect-content-dungeon-error"] button')
      .trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="sect-content-dungeon-list"]').exists()).toBe(true);
  });
});
