/**
 * Phase 15.4 — useFeatureFlagsStore unit tests.
 *
 * Cover:
 *   - ensureLoaded() fetches & maps flag → boolean.
 *   - ensureLoaded() honors TTL — không fetch lại trong 30s.
 *   - refresh() force-fetch.
 *   - isEnabled() default fail-open khi chưa load (loaded=false → trả true).
 *   - isDisabled() trả true chỉ khi đã load + flag explicit false.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { getPublicFeatureFlagsMock } = vi.hoisted(() => ({
  getPublicFeatureFlagsMock: vi.fn(),
}));

vi.mock('@/api/featureFlag', () => ({
  getPublicFeatureFlags: getPublicFeatureFlagsMock,
}));

import { useFeatureFlagsStore } from '@/stores/featureFlags';

beforeEach(() => {
  setActivePinia(createPinia());
  getPublicFeatureFlagsMock.mockReset();
});

describe('useFeatureFlagsStore.ensureLoaded', () => {
  it('fetch list public và map enabled', async () => {
    getPublicFeatureFlagsMock.mockResolvedValueOnce([
      { key: 'ARENA_ENABLED', enabled: false },
      { key: 'EQUIPMENT_REFORGE_ENABLED', enabled: true },
    ]);
    const store = useFeatureFlagsStore();
    await store.ensureLoaded();
    expect(store.loaded).toBe(true);
    expect(store.isEnabled('ARENA_ENABLED')).toBe(false);
    expect(store.isEnabled('EQUIPMENT_REFORGE_ENABLED')).toBe(true);
    expect(store.isDisabled('ARENA_ENABLED')).toBe(true);
    expect(store.isDisabled('EQUIPMENT_REFORGE_ENABLED')).toBe(false);
  });

  it('TTL — không fetch lại trong 30s', async () => {
    getPublicFeatureFlagsMock.mockResolvedValue([]);
    const store = useFeatureFlagsStore();
    await store.ensureLoaded();
    await store.ensureLoaded();
    await store.ensureLoaded();
    expect(getPublicFeatureFlagsMock).toHaveBeenCalledTimes(1);
  });

  it('refresh() force-fetch ngay', async () => {
    getPublicFeatureFlagsMock.mockResolvedValue([]);
    const store = useFeatureFlagsStore();
    await store.ensureLoaded();
    await store.refresh();
    expect(getPublicFeatureFlagsMock).toHaveBeenCalledTimes(2);
  });
});

describe('useFeatureFlagsStore fail-open semantics', () => {
  it('chưa loaded → isEnabled trả true (fail-open) cho mọi key', () => {
    const store = useFeatureFlagsStore();
    expect(store.loaded).toBe(false);
    expect(store.isEnabled('ARENA_ENABLED')).toBe(true);
    expect(store.isDisabled('ARENA_ENABLED')).toBe(false);
  });

  it('loaded nhưng key không trong response → fail-open', async () => {
    getPublicFeatureFlagsMock.mockResolvedValueOnce([
      { key: 'ARENA_ENABLED', enabled: false },
    ]);
    const store = useFeatureFlagsStore();
    await store.ensureLoaded();
    expect(store.isEnabled('MARKET_ENABLED')).toBe(true);
    expect(store.isDisabled('MARKET_ENABLED')).toBe(false);
  });

  it('reset() trả store về initial state', async () => {
    getPublicFeatureFlagsMock.mockResolvedValueOnce([
      { key: 'ARENA_ENABLED', enabled: false },
    ]);
    const store = useFeatureFlagsStore();
    await store.ensureLoaded();
    store.reset();
    expect(store.loaded).toBe(false);
    expect(store.isEnabled('ARENA_ENABLED')).toBe(true);
  });
});
