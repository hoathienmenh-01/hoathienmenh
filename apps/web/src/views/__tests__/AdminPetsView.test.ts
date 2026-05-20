import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const catalogAuditMock = vi.fn().mockResolvedValue([]);
const boxesAuditMock = vi.fn().mockResolvedValue([]);
const sourcesAuditMock = vi.fn().mockResolvedValue([]);
const getPetsMock = vi.fn().mockResolvedValue([]);
const getShardsMock = vi.fn().mockResolvedValue([]);
const getBoxLogsMock = vi.fn().mockResolvedValue([]);
const grantPetMock = vi.fn().mockResolvedValue(undefined);
const grantShardMock = vi.fn().mockResolvedValue(undefined);
const revokePetMock = vi.fn().mockResolvedValue(undefined);
const adjustPetMock = vi.fn().mockResolvedValue(undefined);
const pityResetMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/api/pet', () => ({
  adminListCatalogAudit: (...a: unknown[]) => catalogAuditMock(...a),
  adminListBoxesAudit: (...a: unknown[]) => boxesAuditMock(...a),
  adminListSourcesAudit: (...a: unknown[]) => sourcesAuditMock(...a),
  adminGetCharacterPets: (...a: unknown[]) => getPetsMock(...a),
  adminGetCharacterShards: (...a: unknown[]) => getShardsMock(...a),
  adminGetBoxLogs: (...a: unknown[]) => getBoxLogsMock(...a),
  adminGrantPet: (...a: unknown[]) => grantPetMock(...a),
  adminGrantShard: (...a: unknown[]) => grantShardMock(...a),
  adminRevokePet: (...a: unknown[]) => revokePetMock(...a),
  adminAdjustPet: (...a: unknown[]) => adjustPetMock(...a),
  adminPityReset: (...a: unknown[]) => pityResetMock(...a),
}));

vi.mock('@/lib/apiError', () => ({
  extractApiErrorCodeOrDefault: () => 'UNKNOWN',
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hydrate: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: true,
    isAdmin: true,
    user: { id: '1', role: 'ADMIN' },
  }),
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: vi.fn() }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShellStub', template: '<div data-testid="app-shell"><slot /></div>' },
}));
vi.mock('@/components/xianxia/XTPageEyebrow.vue', () => ({
  default: { name: 'XTPageEyebrowStub', template: '<div />' },
}));

import AdminPetsView from '@/views/AdminPetsView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { loading: 'Đang tải', error: { UNKNOWN: 'Lỗi' } },
      adminPets: {
        title: 'Linh Thú Phổ Lục',
        tabs: { audit: 'Audit', character: 'Nhân vật', logs: 'Logs', grant: 'Grant' },
        noIssues: 'Không có',
        characterIdPlaceholder: 'CID',
        form: { petKey: 'Pet', reason: 'Lý do', amount: 'Amount', level: 'Lv', star: 'Star', evolution: 'Evo', boxKey: 'Box', poolKey: 'Pool' },
        actions: { audit: 'Audit', load: 'Tải', grant: 'Grant', shardGrant: 'Shard', adjust: 'Adjust', revoke: 'Revoke', pityReset: 'Pity' },
      },
    },
  },
});

function mountView() {
  return mount(AdminPetsView, { global: { plugins: [i18n] } });
}

describe('AdminPetsView — render', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    catalogAuditMock.mockResolvedValue([]);
    boxesAuditMock.mockResolvedValue([]);
    sourcesAuditMock.mockResolvedValue([]);
  });

  it('render title', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Linh Thú Phổ Lục');
    w.unmount();
  });

  it('render tabs', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Audit');
    expect(w.text()).toContain('Nhân vật');
    expect(w.text()).toContain('Logs');
    expect(w.text()).toContain('Grant');
    w.unmount();
  });

  it('audit tab shows no issues by default', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Không có');
    w.unmount();
  });
});
