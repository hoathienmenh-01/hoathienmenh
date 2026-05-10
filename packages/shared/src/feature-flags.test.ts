/**
 * Phase 15.4 — Feature Flag catalog invariants.
 *
 * Mục tiêu: bảo đảm catalog hardcode shared (FE+BE) không bị lệch theo
 * thời gian:
 *   - Mọi `FeatureFlagKey` trong type union đều có entry trong catalog.
 *   - Catalog không có duplicate key.
 *   - `category` mỗi flag là `FeatureFlagCategory` hợp lệ.
 *   - Mọi flag Phase 15.4 đều `requiresRestart=false` (apply runtime qua
 *     cache invalidate).
 *   - `PUBLIC_FEATURE_FLAG_KEYS` whitelist là subset của catalog.
 *   - Helper `getFeatureFlagDef`/`getDefaultFeatureFlagEnabled` consistent.
 */
import { describe, expect, it } from 'vitest';
import {
  FEATURE_FLAG_CATALOG,
  FEATURE_FLAG_CATEGORIES,
  FEATURE_FLAG_KEYS,
  PUBLIC_FEATURE_FLAG_KEYS,
  getDefaultFeatureFlagEnabled,
  getFeatureFlagDef,
  isFeatureFlagCategory,
  isFeatureFlagKey,
  isPublicFeatureFlag,
} from './feature-flags';

describe('feature-flags catalog invariants', () => {
  it('catalog length matches keys list length', () => {
    expect(FEATURE_FLAG_CATALOG.length).toBe(FEATURE_FLAG_KEYS.length);
  });

  it('every catalog entry maps to a known FeatureFlagKey', () => {
    for (const def of FEATURE_FLAG_CATALOG) {
      expect(isFeatureFlagKey(def.key)).toBe(true);
    }
  });

  it('every FeatureFlagKey has a catalog entry', () => {
    for (const key of FEATURE_FLAG_KEYS) {
      const def = FEATURE_FLAG_CATALOG.find((d) => d.key === key);
      expect(def, `missing catalog entry for ${key}`).toBeDefined();
    }
  });

  it('catalog keys are unique', () => {
    const seen = new Set<string>();
    for (const def of FEATURE_FLAG_CATALOG) {
      expect(seen.has(def.key), `duplicate key ${def.key}`).toBe(false);
      seen.add(def.key);
    }
  });

  it('every catalog entry has a valid category', () => {
    for (const def of FEATURE_FLAG_CATALOG) {
      expect(isFeatureFlagCategory(def.category)).toBe(true);
    }
  });

  it('every Phase 15.4 flag is requiresRestart=false', () => {
    for (const def of FEATURE_FLAG_CATALOG) {
      // Phase 15.4 invariant — apply runtime qua cache invalidate, không
      // có flag nào cần restart server. Reserve false-flag check cho 15.5+.
      expect(def.requiresRestart).toBe(false);
    }
  });

  it('every catalog entry has non-empty description vi/en', () => {
    for (const def of FEATURE_FLAG_CATALOG) {
      expect(def.descriptionVi.length).toBeGreaterThan(0);
      expect(def.descriptionEn.length).toBeGreaterThan(0);
    }
  });
});

describe('feature-flags public whitelist', () => {
  it('PUBLIC_FEATURE_FLAG_KEYS subset of catalog keys', () => {
    for (const key of PUBLIC_FEATURE_FLAG_KEYS) {
      expect(isFeatureFlagKey(key)).toBe(true);
    }
  });

  it('isPublicFeatureFlag matches catalog public field', () => {
    for (const def of FEATURE_FLAG_CATALOG) {
      expect(isPublicFeatureFlag(def.key)).toBe(def.public);
    }
  });

  it('admin/safety category flags are NOT public (security)', () => {
    for (const def of FEATURE_FLAG_CATALOG) {
      if (def.category === 'ADMIN' || def.category === 'SAFETY') {
        expect(def.public, `${def.key} (${def.category}) leaked public`).toBe(
          false,
        );
      }
    }
  });
});

describe('feature-flags helpers', () => {
  it('getFeatureFlagDef returns the catalog entry', () => {
    const def = getFeatureFlagDef('ARENA_ENABLED');
    expect(def.key).toBe('ARENA_ENABLED');
    expect(def.category).toBe('GAMEPLAY');
    expect(def.defaultEnabled).toBe(true);
  });

  it('getDefaultFeatureFlagEnabled mirrors catalog defaultEnabled', () => {
    for (const def of FEATURE_FLAG_CATALOG) {
      expect(getDefaultFeatureFlagEnabled(def.key)).toBe(def.defaultEnabled);
    }
  });

  it('isFeatureFlagKey rejects unknown keys', () => {
    expect(isFeatureFlagKey('ARENA_ENABLED')).toBe(true);
    expect(isFeatureFlagKey('UNKNOWN_FLAG')).toBe(false);
    expect(isFeatureFlagKey('')).toBe(false);
    expect(isFeatureFlagKey('arena_enabled')).toBe(false); // case-sensitive
  });

  it('isFeatureFlagCategory rejects unknown categories', () => {
    expect(isFeatureFlagCategory('GAMEPLAY')).toBe(true);
    expect(isFeatureFlagCategory('UNKNOWN')).toBe(false);
    expect(isFeatureFlagCategory('gameplay')).toBe(false); // case-sensitive
  });
});

describe('feature-flags categories', () => {
  it('FEATURE_FLAG_CATEGORIES list is exhaustive', () => {
    const expected = ['GAMEPLAY', 'ECONOMY', 'LIVEOPS', 'ADMIN', 'SAFETY'];
    expect([...FEATURE_FLAG_CATEGORIES].sort()).toEqual(
      [...expected].sort(),
    );
  });
});
