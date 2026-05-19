import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type {
  LoadoutApplyResult,
  LoadoutPresetView,
} from '@xuantoi/shared';

/**
 * Phase QOL-2 — LoadoutView smoke tests.
 *
 * Covers: empty state, list render, create flow, apply success, apply warnings,
 * set-default click. Uses mocked API modules.
 */

const listLoadoutPresetsMock = vi.fn();
const createLoadoutPresetMock = vi.fn();
const updateLoadoutPresetMock = vi.fn();
const deleteLoadoutPresetMock = vi.fn();
const applyLoadoutPresetMock = vi.fn();
const setLoadoutDefaultMock = vi.fn();

vi.mock('@/api/loadout', () => ({
  listLoadoutPresets: (...a: unknown[]) => listLoadoutPresetsMock(...a),
  createLoadoutPreset: (...a: unknown[]) => createLoadoutPresetMock(...a),
  updateLoadoutPreset: (...a: unknown[]) => updateLoadoutPresetMock(...a),
  deleteLoadoutPreset: (...a: unknown[]) => deleteLoadoutPresetMock(...a),
  applyLoadoutPreset: (...a: unknown[]) => applyLoadoutPresetMock(...a),
  setLoadoutDefault: (...a: unknown[]) => setLoadoutDefaultMock(...a),
}));

vi.mock('@/api/inventory', () => ({
  listInventory: () => Promise.resolve([]),
}));
vi.mock('@/api/skill', () => ({
  getSkillState: () =>
    Promise.resolve({ maxEquipped: 4, learned: [] }),
}));
vi.mock('@/api/artifactsV2', () => ({
  getArtifactV2State: () =>
    Promise.resolve({
      realmOrder: 1,
      bodyRealmOrder: 1,
      linhThachOwned: 0,
      owned: [],
      blueprints: [],
      statPreview: {},
    }),
}));

import LoadoutView from '@/views/LoadoutView.vue';

function buildI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    missingWarn: false,
    missingFallbackWarn: false,
    messages: {
      vi: {
        common: {
          apiFallback: {
            loadoutCreate: 'Tạo thất bại',
            loadoutApply: 'Áp dụng thất bại',
            loadoutDelete: 'Xoá thất bại',
            loadoutSetDefault: 'Đặt mặc định thất bại',
          },
        },
        loadout: {
          title: 'Bộ Trang Bị Nhanh',
          subtitle: 'Sub',
          empty: 'Chưa có bộ trang bị nhanh nào.',
          loadFail: 'Không tải được.',
          mode: { PVE: 'PvE', PVP: 'PvP', BOSS: 'Boss', CUSTOM: 'Tự do' },
          form: {
            name: 'Tên',
            namePlaceholder: 'Tên',
            mode: 'Chế độ',
            equipmentLabel: '{n} trang bị',
            skillLabel: '{n}/4 thuật pháp',
            artifactLabel: '{n} pháp bảo',
            skillEmpty: 'Skill empty',
            artifactEmpty: 'Artifact empty',
            submitCreate: 'Tạo bộ',
            submitUpdate: 'Lưu',
            cancel: 'Huỷ',
          },
          actions: {
            create: 'Tạo bộ mới',
            apply: 'Áp dụng',
            edit: 'Sửa',
            delete: 'Xoá',
            setDefault: 'Đặt mặc định',
            isDefault: 'Mặc định',
            deleteConfirm: 'Xoá "{name}"?',
          },
          summary: {
            equipmentCount: '{n} trang bị',
            skillCount: '{n} thuật pháp',
            skillUntouched: 'Skill untouched',
            artifactCount: '{n} pháp bảo',
            artifactUntouched: 'Artifact untouched',
            appliedToast: 'Đã áp dụng {name}.',
            deletedToast: 'Đã xoá {name}.',
            createdToast: 'Đã tạo {name}.',
            updatedToast: 'Đã cập nhật {name}.',
            defaultSetToast: 'Đã đặt {name} mặc định {mode}.',
          },
          warning: {
            title: 'Thiếu vật phẩm:',
            EQUIPMENT_MISSING: 'Trang bị slot {slot} thiếu.',
            SKILL_NOT_LEARNED: 'Skill {ref} chưa lĩnh hội.',
            ARTIFACT_MISSING: 'Pháp bảo slot {slot} thiếu.',
          },
          errors: {},
          roleHint: 'Lưu và chuyển nhanh giữa các bộ trang bị.',
          crossNav: {
            equipment: 'Trang Bị',
            equipmentDesc: 'Xem trang bị đang mặc',
            inventory: 'Túi Đồ',
            inventoryDesc: 'Quản lý vật phẩm',
          },
        },
      },
    },
  });
}

function buildPreset(over: Partial<LoadoutPresetView> = {}): LoadoutPresetView {
  return {
    id: 'p1',
    name: 'Build PvE',
    mode: 'PVE',
    equipmentSlots: {},
    skillSlots: null,
    artifactSlots: null,
    isDefaultForPve: false,
    isDefaultForPvp: false,
    isDefaultForBoss: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

function buildApplyResult(
  over: Partial<LoadoutApplyResult> = {},
): LoadoutApplyResult {
  return {
    preset: buildPreset(),
    warnings: [],
    appliedEquipmentCount: 0,
    appliedSkillCount: 0,
    appliedArtifactCount: 0,
    ...over,
  };
}

describe('Phase QOL-2 — LoadoutView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listLoadoutPresetsMock.mockReset();
    createLoadoutPresetMock.mockReset();
    updateLoadoutPresetMock.mockReset();
    deleteLoadoutPresetMock.mockReset();
    applyLoadoutPresetMock.mockReset();
    setLoadoutDefaultMock.mockReset();
  });

  it('renders empty state when no presets', async () => {
    listLoadoutPresetsMock.mockResolvedValue([]);
    const wrapper = mount(LoadoutView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    expect(wrapper.text()).toContain('Chưa có bộ trang bị nhanh nào.');
  });

  it('renders preset rows from API', async () => {
    listLoadoutPresetsMock.mockResolvedValue([
      buildPreset({ id: 'a', name: 'Bld A' }),
      buildPreset({ id: 'b', name: 'Bld B', mode: 'PVP' }),
    ]);
    const wrapper = mount(LoadoutView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    expect(wrapper.findAll('[data-testid^="loadout-row-"]')).toHaveLength(2);
    expect(wrapper.text()).toContain('Bld A');
    expect(wrapper.text()).toContain('Bld B');
  });

  it('opens create form on button click', async () => {
    listLoadoutPresetsMock.mockResolvedValue([]);
    const wrapper = mount(LoadoutView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    await wrapper.find('[data-testid="loadout-create-btn"]').trigger('click');
    expect(wrapper.find('[data-testid="loadout-draft-form"]').exists()).toBe(true);
  });

  it('submits create form and refreshes', async () => {
    listLoadoutPresetsMock.mockResolvedValue([]);
    const newPreset = buildPreset({ id: 'new', name: 'X' });
    createLoadoutPresetMock.mockResolvedValue(newPreset);
    const wrapper = mount(LoadoutView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    await wrapper.find('[data-testid="loadout-create-btn"]').trigger('click');
    await wrapper.find('input[type="text"]').setValue('X');
    await wrapper.find('[data-testid="loadout-submit-btn"]').trigger('click');
    await flushPromises();
    expect(createLoadoutPresetMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'X', mode: 'PVE' }),
    );
  });

  it('apply success calls api and refreshes list', async () => {
    listLoadoutPresetsMock.mockResolvedValue([buildPreset({ id: 'pX' })]);
    applyLoadoutPresetMock.mockResolvedValue(buildApplyResult());
    const wrapper = mount(LoadoutView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    await wrapper.find('[data-testid="loadout-apply-pX"]').trigger('click');
    await flushPromises();
    expect(applyLoadoutPresetMock).toHaveBeenCalledWith('pX');
  });

  it('shows warnings when apply returns warnings', async () => {
    listLoadoutPresetsMock.mockResolvedValue([buildPreset({ id: 'pY' })]);
    applyLoadoutPresetMock.mockResolvedValue(
      buildApplyResult({
        warnings: [
          { code: 'EQUIPMENT_MISSING', ref: 'inv1', slot: 'WEAPON' },
        ],
      }),
    );
    const wrapper = mount(LoadoutView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    await wrapper.find('[data-testid="loadout-apply-pY"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="loadout-warnings"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('WEAPON');
  });

  it('set-default for PVP calls api with correct mode', async () => {
    listLoadoutPresetsMock.mockResolvedValue([buildPreset({ id: 'pZ' })]);
    setLoadoutDefaultMock.mockResolvedValue(
      buildPreset({ id: 'pZ', isDefaultForPvp: true }),
    );
    const wrapper = mount(LoadoutView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    await wrapper.find('[data-testid="loadout-setdefault-pZ-PVP"]').trigger('click');
    await flushPromises();
    expect(setLoadoutDefaultMock).toHaveBeenCalledWith('pZ', 'PVP');
  });

  it('delete preset confirms then calls api', async () => {
    listLoadoutPresetsMock.mockResolvedValue([buildPreset({ id: 'pD' })]);
    deleteLoadoutPresetMock.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const wrapper = mount(LoadoutView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    await wrapper.find('[data-testid="loadout-delete-pD"]').trigger('click');
    await flushPromises();
    expect(deleteLoadoutPresetMock).toHaveBeenCalledWith('pD');
    confirmSpy.mockRestore();
  });
});

describe('LoadoutView — cross-navigation', () => {
  it('render role hint', async () => {
    listLoadoutPresetsMock.mockResolvedValue([]);
    const wrapper = mount(LoadoutView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    expect(wrapper.find('[data-testid="loadout-role-hint"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="loadout-role-hint"]').text()).toContain('Lưu và chuyển');
  });

  it('render cross-navigation links', async () => {
    listLoadoutPresetsMock.mockResolvedValue([]);
    const wrapper = mount(LoadoutView, { global: { plugins: [buildI18n()] } });
    await flushPromises();
    expect(wrapper.find('[data-testid="loadout-cross-nav"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="cross-nav-equipment"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="cross-nav-inventory"]').exists()).toBe(true);
  });
});
