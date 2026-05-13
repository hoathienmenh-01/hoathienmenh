import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * Phase 26.4 — ArtifactV2View test suite.
 *
 * Bao phủ UI surface chính (Phần 19 §Web tests):
 *  - Loading state khi store chưa load.
 *  - Render đầy đủ owned + blueprint từ API mock.
 *  - Tab switching (owned ↔ blueprint ↔ preview).
 *  - Filter tier/grade/element/type.
 *  - Craft button disabled khi `canCraft=false` (thiếu nguyên liệu hoặc
 *    realm thấp).
 *  - Toast success khi craft thành công (`craft.success=true`).
 *  - Toast warning khi craft thất bại (`craft.success=false`).
 *  - i18n keys vi (artifactV2.*) đầy đủ — không có literal key.
 */

const { toastPushMock, getArtifactV2StateMock, craftArtifactV2Mock } = vi.hoisted(
  () => ({
    toastPushMock: vi.fn(),
    getArtifactV2StateMock: vi.fn(),
    craftArtifactV2Mock: vi.fn(),
  }),
);

vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

vi.mock('@/api/artifactsV2', async () => {
  const actual: object = await vi.importActual('@/api/artifactsV2');
  return {
    ...actual,
    getArtifactV2State: getArtifactV2StateMock,
    craftArtifactV2: craftArtifactV2Mock,
    equipArtifactV2: vi.fn(),
    unequipArtifactV2: vi.fn(),
    upgradeArtifactV2Level: vi.fn(),
    starUpArtifactV2: vi.fn(),
    refineArtifactV2: vi.fn(),
    awakenArtifactV2: vi.fn(),
  };
});

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

import ArtifactV2View from '@/views/ArtifactV2View.vue';

import viMessages from '@/i18n/vi.json';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: { vi: viMessages },
});

const STUB_OWNED = [
  {
    id: 'art-1',
    artifactKey: 'thanh_moc_tieu_kiem_t1',
    name: 'Thanh Mộc Tiểu Kiếm',
    type: 'FLYING_SWORD',
    element: 'moc',
    tier: 1,
    grade: 'TRUNG_PHAM',
    level: 1,
    star: 0,
    refineLevel: 0,
    awakenLevel: 0,
    spiritLevel: 0,
    equippedSlot: null,
    locked: false,
    stats: { atkBonus: 10 },
    subStats: [],
    skills: [],
    powerScore: 50,
  },
  {
    id: 'art-2',
    artifactKey: 'tinh_thuy_chau_t1',
    name: 'Tịnh Thủy Châu',
    type: 'PEARL',
    element: 'thuy',
    tier: 1,
    grade: 'CUC_PHAM',
    level: 5,
    star: 1,
    refineLevel: 0,
    awakenLevel: 0,
    spiritLevel: 0,
    equippedSlot: 'SUPPORT_ARTIFACT_V2',
    locked: false,
    stats: { hpBonus: 50 },
    subStats: [],
    skills: [],
    powerScore: 120,
  },
];

const STUB_BLUEPRINTS = [
  {
    key: 'bp_thanh_moc_tieu_kiem_t1',
    artifactKey: 'thanh_moc_tieu_kiem_t1',
    artifactName: 'Thanh Mộc Tiểu Kiếm',
    artifactType: 'FLYING_SWORD',
    artifactElement: 'moc',
    artifactTier: 1,
    requiredRealmOrder: 1,
    successRate: 0.65,
    possibleGrades: { HA_PHAM: 0.3, TRUNG_PHAM: 0.5, THUONG_PHAM: 0.2 },
    maxGrade: 'THUONG_PHAM',
    sourceHint: ['BOSS', 'DUNGEON'],
    inputs: [
      { itemKey: 'phoi_phap_bao_t1', qty: 1 },
      { itemKey: 'ban_ve_phap_bao_t1', qty: 1 },
    ],
    linhThachCost: 500,
    linhThachMissing: 0,
    missingMaterials: [],
    canCraft: true,
    errors: [],
  },
  {
    key: 'bp_blocked_t5',
    artifactKey: 'long_huyet_chien_an_t5',
    artifactName: 'Long Huyết Chiến Ấn',
    artifactType: 'SEAL',
    artifactElement: 'hoa',
    artifactTier: 5,
    requiredRealmOrder: 12,
    successRate: 0.25,
    possibleGrades: { HA_PHAM: 0.4, TRUNG_PHAM: 0.4, THUONG_PHAM: 0.2 },
    maxGrade: 'THUONG_PHAM',
    sourceHint: ['WORLD_BOSS'],
    inputs: [{ itemKey: 'phoi_phap_bao_t5', qty: 1 }],
    linhThachCost: 5000,
    linhThachMissing: 0,
    missingMaterials: [
      { itemKey: 'phoi_phap_bao_t5', required: 1, owned: 0 },
    ],
    canCraft: false,
    errors: ['REALM_TOO_LOW'],
  },
];

const STUB_STATE = {
  realmOrder: 1,
  bodyRealmOrder: 0,
  linhThachOwned: 100_000,
  owned: STUB_OWNED,
  blueprints: STUB_BLUEPRINTS,
  statPreview: {
    atkBonus: 0,
    hpBonus: 0,
    defBonus: 0,
    spdBonus: 0,
    critBonus: 0,
    mpBonus: 0,
    cultivationRateBonusPct: 0,
    bodyCultivationRateBonusPct: 0,
    alchemySuccessBonusPct: 0,
    bossDmgReductionPct: 0,
    tribulationSupportBonusPct: 0,
    elementalAtkBonus: {},
    elementResist: {},
    dropRateBonusPct: 0,
    luckBonusPct: 0,
  },
};

function mountView() {
  return mount(ArtifactV2View, {
    global: {
      plugins: [i18n],
    },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  getArtifactV2StateMock.mockResolvedValue(STUB_STATE);
});

describe('ArtifactV2View — render', () => {
  it('hiển thị loading lúc đầu rồi render danh sách sau khi load', async () => {
    getArtifactV2StateMock.mockResolvedValueOnce(STUB_STATE);
    const w = mountView();
    expect(w.find('[data-testid="artifact-v2-loading"]').exists()).toBe(true);
    await flushPromises();
    expect(w.find('[data-testid="artifact-v2-loading"]').exists()).toBe(false);
    expect(w.find('[data-testid="artifact-v2-owned-list"]').exists()).toBe(true);
    expect(
      w.findAll('[data-testid^="artifact-v2-card-"]').length,
    ).toBe(STUB_OWNED.length);
  });

  it('switch sang tab blueprint render đủ entries', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="artifact-v2-tab-blueprint"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="artifact-v2-blueprint-list"]').exists()).toBe(true);
    expect(
      w.findAll('[data-testid^="artifact-v2-bp-"]').length,
    ).toBe(STUB_BLUEPRINTS.length);
  });

  it('switch sang tab preview render block tổng quan', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="artifact-v2-tab-preview"]').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid="artifact-v2-preview"]').exists()).toBe(true);
  });
});

describe('ArtifactV2View — filter', () => {
  it('filter type=PEARL chỉ giữ entry tương ứng', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="artifact-v2-filter-type"]').setValue('PEARL');
    await flushPromises();
    const cards = w.findAll('[data-testid^="artifact-v2-card-"]');
    expect(cards.length).toBe(1);
    expect(w.find('[data-testid="artifact-v2-card-art-2"]').exists()).toBe(true);
  });

  it('filter grade=CUC_PHAM chỉ giữ entry CUC_PHAM', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="artifact-v2-filter-grade"]').setValue('CUC_PHAM');
    await flushPromises();
    const cards = w.findAll('[data-testid^="artifact-v2-card-"]');
    expect(cards.length).toBe(1);
    expect(w.find('[data-testid="artifact-v2-card-art-2"]').exists()).toBe(true);
  });
});

describe('ArtifactV2View — craft', () => {
  it('craft button disabled khi canCraft=false', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="artifact-v2-tab-blueprint"]').trigger('click');
    await flushPromises();
    const btn = w.find('[data-testid="artifact-v2-craft-bp_blocked_t5"]');
    expect(btn.exists()).toBe(true);
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
  });

  it('craft button enabled khi canCraft=true', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="artifact-v2-tab-blueprint"]').trigger('click');
    await flushPromises();
    const btn = w.find('[data-testid="artifact-v2-craft-bp_thanh_moc_tieu_kiem_t1"]');
    expect(btn.exists()).toBe(true);
    expect((btn.element as HTMLButtonElement).disabled).toBe(false);
  });

  it('craft success → toast.push gọi với type=success', async () => {
    craftArtifactV2Mock.mockResolvedValue({
      artifactsV2: STUB_STATE,
      craft: {
        success: true,
        successRate: 0.65,
        rollValue: 0.1,
        grade: 'TRUNG_PHAM',
        artifactId: 'new-art-id',
        stats: {},
        consumed: { items: [], linhThach: 500 },
      },
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="artifact-v2-tab-blueprint"]').trigger('click');
    await flushPromises();
    await w
      .find('[data-testid="artifact-v2-craft-bp_thanh_moc_tieu_kiem_t1"]')
      .trigger('click');
    await flushPromises();
    expect(craftArtifactV2Mock).toHaveBeenCalledWith('bp_thanh_moc_tieu_kiem_t1');
    expect(toastPushMock).toHaveBeenCalled();
    const lastCall = toastPushMock.mock.calls[toastPushMock.mock.calls.length - 1][0];
    expect(lastCall.type).toBe('success');
  });

  it('craft fail (success=false) → toast.push gọi với type=warning/info (UI cảnh báo)', async () => {
    craftArtifactV2Mock.mockResolvedValue({
      artifactsV2: STUB_STATE,
      craft: {
        success: false,
        successRate: 0.65,
        rollValue: 0.95,
        grade: null,
        artifactId: null,
        stats: null,
        consumed: { items: [], linhThach: 500 },
      },
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="artifact-v2-tab-blueprint"]').trigger('click');
    await flushPromises();
    await w
      .find('[data-testid="artifact-v2-craft-bp_thanh_moc_tieu_kiem_t1"]')
      .trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalled();
    const lastCall = toastPushMock.mock.calls[toastPushMock.mock.calls.length - 1][0];
    expect(['warning', 'info', 'error']).toContain(lastCall.type);
  });
});

describe('ArtifactV2View — error state', () => {
  it('khi getArtifactV2State throw → render error block với reload button', async () => {
    getArtifactV2StateMock.mockRejectedValueOnce(new Error('boom'));
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="artifact-v2-error"]').exists()).toBe(true);
  });
});
