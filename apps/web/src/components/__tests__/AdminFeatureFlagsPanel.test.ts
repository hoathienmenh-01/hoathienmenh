/**
 * Phase 15.4 — AdminFeatureFlagsPanel tests.
 *
 * Cover:
 *   - render list flags từ adminListFeatureFlags().
 *   - search input filter theo key.
 *   - category filter ẩn flag không khớp.
 *   - toggle non-major flag → adminUpdateFeatureFlag gọi ngay (no confirm).
 *   - toggle major flag (ARENA_ENABLED) khi đang ON → confirm modal hiện;
 *     click confirm → API gọi.
 *   - bật flag major không cần confirm modal.
 *   - refreshDefaults / clearCache buttons gọi đúng API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import type { FeatureFlagAdminView } from '@xuantoi/shared';

const {
  listMock,
  updateMock,
  refreshDefaultsMock,
  clearCacheMock,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  updateMock: vi.fn(),
  refreshDefaultsMock: vi.fn(),
  clearCacheMock: vi.fn(),
}));

vi.mock('@/api/featureFlag', () => ({
  adminListFeatureFlags: listMock,
  adminUpdateFeatureFlag: updateMock,
  adminRefreshFeatureFlagDefaults: refreshDefaultsMock,
  adminClearFeatureFlagCache: clearCacheMock,
}));

import AdminFeatureFlagsPanel from '@/components/AdminFeatureFlagsPanel.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      common: { loading: 'Đang tải…', confirm: 'OK', cancel: 'Huỷ' },
      adminFeatureFlags: {
        title: 'Feature Flags',
        hint: 'Bật/tắt nhanh',
        loading: 'Đang tải…',
        empty: 'Trống',
        filter: {
          searchPlaceholder: 'Tìm…',
          allCategories: 'Tất cả nhóm',
        },
        category: {
          GAMEPLAY: 'Gameplay',
          ECONOMY: 'Kinh tế',
          LIVEOPS: 'LiveOps',
          ADMIN: 'Admin',
          SAFETY: 'An toàn',
        },
        row: {
          module: 'Module: {module}',
          default: 'Mặc định: {value}',
          updatedAt: 'Cập nhật: {at}',
          notUpdated: 'chưa thay đổi',
          on: 'BẬT',
          off: 'TẮT',
          publicTag: 'PUBLIC',
          publicHint: 'Public hint',
        },
        actions: {
          enable: 'Bật',
          disable: 'Tắt',
          refresh: 'Làm mới',
          refreshDefaults: 'Đồng bộ default',
          clearCache: 'Xoá cache',
        },
        confirm: {
          title: 'Xác nhận tắt',
          message: 'Tắt {key} — {description}',
        },
        toast: {
          enabled: 'Đã bật {key}',
          disabled: 'Đã tắt {key}',
          refreshedDefaults: 'Đồng bộ {created} / {existing}',
          cacheCleared: 'Đã xoá cache',
        },
        errors: {
          UNKNOWN: 'Lỗi.',
          INVALID_INPUT: 'Input lỗi.',
        },
      },
      toast: { title: { info: 'Info', error: 'Lỗi', success: 'OK' } },
    },
  },
});

function makeFlag(over: Partial<FeatureFlagAdminView> = {}): FeatureFlagAdminView {
  return {
    key: 'ARENA_ENABLED',
    enabled: true,
    category: 'GAMEPLAY',
    descriptionVi: 'Đấu Đài',
    descriptionEn: 'Arena',
    public: true,
    requiresRestart: false,
    module: 'arena',
    defaultEnabled: true,
    updatedByAdminId: null,
    updatedAt: null,
    ...over,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  listMock.mockReset();
  updateMock.mockReset();
  refreshDefaultsMock.mockReset();
  clearCacheMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AdminFeatureFlagsPanel', () => {
  it('render list flags từ API', async () => {
    listMock.mockResolvedValue([
      makeFlag({ key: 'ARENA_ENABLED' }),
      makeFlag({ key: 'MARKET_ENABLED', category: 'ECONOMY' }),
    ]);
    const w = mount(AdminFeatureFlagsPanel, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(
      w.find('[data-testid="admin-feature-flag-row-ARENA_ENABLED"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="admin-feature-flag-row-MARKET_ENABLED"]').exists(),
    ).toBe(true);
  });

  it('empty state khi không có flag nào sau filter', async () => {
    listMock.mockResolvedValue([
      makeFlag({ key: 'ARENA_ENABLED', category: 'GAMEPLAY' }),
    ]);
    const w = mount(AdminFeatureFlagsPanel, { global: { plugins: [i18n] } });
    await flushPromises();
    await w
      .find('[data-testid="admin-feature-flags-search"]')
      .setValue('zzz_no_match');
    expect(w.find('[data-testid="admin-feature-flags-empty"]').exists()).toBe(
      true,
    );
  });

  it('toggle flag NON-major (SHOP_DISCOUNT_EVENTS_ENABLED) gọi API trực tiếp', async () => {
    listMock.mockResolvedValue([
      makeFlag({
        key: 'SHOP_DISCOUNT_EVENTS_ENABLED',
        enabled: true,
        category: 'ECONOMY',
      }),
    ]);
    updateMock.mockResolvedValue(
      makeFlag({ key: 'SHOP_DISCOUNT_EVENTS_ENABLED', enabled: false }),
    );
    const w = mount(AdminFeatureFlagsPanel, { global: { plugins: [i18n] } });
    await flushPromises();
    await w
      .find('[data-testid="admin-feature-flag-toggle-SHOP_DISCOUNT_EVENTS_ENABLED"]')
      .trigger('click');
    await flushPromises();
    expect(updateMock).toHaveBeenCalledWith('SHOP_DISCOUNT_EVENTS_ENABLED', false);
  });

  it('TẮT flag MAJOR (ARENA_ENABLED) → confirm modal hiện trước khi gọi API', async () => {
    listMock.mockResolvedValue([
      makeFlag({ key: 'ARENA_ENABLED', enabled: true }),
    ]);
    updateMock.mockResolvedValue(
      makeFlag({ key: 'ARENA_ENABLED', enabled: false }),
    );
    const w = mount(AdminFeatureFlagsPanel, {
      attachTo: document.body,
      global: { plugins: [i18n] },
    });
    await flushPromises();
    await w
      .find('[data-testid="admin-feature-flag-toggle-ARENA_ENABLED"]')
      .trigger('click');
    await flushPromises();
    expect(updateMock).not.toHaveBeenCalled();
    // ConfirmModal teleports to document.body — query DOM instead of wrapper.
    const confirmBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="admin-feature-flag-confirm-confirm"]',
    );
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    await flushPromises();
    expect(updateMock).toHaveBeenCalledWith('ARENA_ENABLED', false);
    w.unmount();
  });

  it('BẬT flag MAJOR đang OFF → KHÔNG cần confirm', async () => {
    listMock.mockResolvedValue([
      makeFlag({ key: 'ARENA_ENABLED', enabled: false }),
    ]);
    updateMock.mockResolvedValue(
      makeFlag({ key: 'ARENA_ENABLED', enabled: true }),
    );
    const w = mount(AdminFeatureFlagsPanel, { global: { plugins: [i18n] } });
    await flushPromises();
    await w
      .find('[data-testid="admin-feature-flag-toggle-ARENA_ENABLED"]')
      .trigger('click');
    await flushPromises();
    expect(updateMock).toHaveBeenCalledWith('ARENA_ENABLED', true);
  });

  it('Refresh defaults / Clear cache buttons gọi đúng API', async () => {
    listMock.mockResolvedValue([]);
    refreshDefaultsMock.mockResolvedValue({ created: 2, existing: 9 });
    clearCacheMock.mockResolvedValue({ cleared: true });
    const w = mount(AdminFeatureFlagsPanel, { global: { plugins: [i18n] } });
    await flushPromises();
    await w
      .find('[data-testid="admin-feature-flags-refresh-defaults"]')
      .trigger('click');
    await flushPromises();
    expect(refreshDefaultsMock).toHaveBeenCalledTimes(1);
    await w
      .find('[data-testid="admin-feature-flags-clear-cache"]')
      .trigger('click');
    await flushPromises();
    expect(clearCacheMock).toHaveBeenCalledTimes(1);
  });
});
