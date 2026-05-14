/**
 * Phase 45.0 — Remote Config catalog + validator invariants.
 */
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_REMOTE_CONFIG_KEYS,
  REMOTE_CONFIG_CATALOG,
  REMOTE_CONFIG_KEYS,
  REMOTE_CONFIG_VALUE_TYPES,
  getDefaultRemoteConfigValue,
  getRemoteConfigDef,
  isPublicRemoteConfigKey,
  isRemoteConfigKey,
  isRemoteConfigValueType,
  validateRemoteConfigValue,
} from './remote-config';

describe('remote-config catalog invariants', () => {
  it('catalog length matches keys list', () => {
    expect(REMOTE_CONFIG_CATALOG.length).toBe(REMOTE_CONFIG_KEYS.length);
  });

  it('every key has a catalog entry and matches type guard', () => {
    for (const key of REMOTE_CONFIG_KEYS) {
      const def = REMOTE_CONFIG_CATALOG.find((d) => d.key === key);
      expect(def, `missing catalog for ${key}`).toBeDefined();
      expect(isRemoteConfigKey(key)).toBe(true);
    }
  });

  it('catalog keys unique', () => {
    const seen = new Set<string>();
    for (const def of REMOTE_CONFIG_CATALOG) {
      expect(seen.has(def.key), `duplicate ${def.key}`).toBe(false);
      seen.add(def.key);
    }
  });

  it('every catalog entry has valid valueType + non-empty description vi/en', () => {
    for (const def of REMOTE_CONFIG_CATALOG) {
      expect(isRemoteConfigValueType(def.valueType)).toBe(true);
      expect(def.descriptionVi.length).toBeGreaterThan(0);
      expect(def.descriptionEn.length).toBeGreaterThan(0);
    }
  });

  it('defaultValue passes validateRemoteConfigValue for its own def', () => {
    for (const def of REMOTE_CONFIG_CATALOG) {
      const violations = validateRemoteConfigValue(def.key, def.defaultValue);
      expect(
        violations,
        `default value for ${def.key} fails own validator: ${JSON.stringify(violations)}`,
      ).toEqual([]);
    }
  });

  it('PUBLIC_REMOTE_CONFIG_KEYS subset + isPublicRemoteConfigKey consistent', () => {
    for (const key of PUBLIC_REMOTE_CONFIG_KEYS) {
      expect(isRemoteConfigKey(key)).toBe(true);
    }
    for (const def of REMOTE_CONFIG_CATALOG) {
      expect(isPublicRemoteConfigKey(def.key)).toBe(def.public);
    }
  });

  it('REMOTE_CONFIG_VALUE_TYPES exhaustive', () => {
    expect([...REMOTE_CONFIG_VALUE_TYPES].sort()).toEqual(
      ['boolean', 'json', 'number', 'string'].sort(),
    );
  });
});

describe('validateRemoteConfigValue — type checks', () => {
  it('null / undefined → VALUE_REQUIRED', () => {
    expect(
      validateRemoteConfigValue('max_daily_claims', null)[0].code,
    ).toBe('VALUE_REQUIRED');
    expect(
      validateRemoteConfigValue('max_daily_claims', undefined)[0].code,
    ).toBe('VALUE_REQUIRED');
  });

  it('number key — type mismatch', () => {
    expect(
      validateRemoteConfigValue('max_daily_claims', '50')[0].code,
    ).toBe('VALUE_TYPE_MISMATCH');
    expect(
      validateRemoteConfigValue('max_daily_claims', true)[0].code,
    ).toBe('VALUE_TYPE_MISMATCH');
    expect(
      validateRemoteConfigValue('max_daily_claims', Number.NaN)[0].code,
    ).toBe('VALUE_TYPE_MISMATCH');
  });

  it('number key — out of range', () => {
    expect(
      validateRemoteConfigValue('max_daily_claims', 0)[0].code,
    ).toBe('VALUE_OUT_OF_RANGE');
    expect(
      validateRemoteConfigValue('max_daily_claims', 1001)[0].code,
    ).toBe('VALUE_OUT_OF_RANGE');
    expect(validateRemoteConfigValue('max_daily_claims', 500)).toEqual([]);
  });

  it('string key — type mismatch + too long', () => {
    expect(
      validateRemoteConfigValue('maintenance_message', 123)[0].code,
    ).toBe('VALUE_TYPE_MISMATCH');
    const longString = 'x'.repeat(600);
    expect(
      validateRemoteConfigValue('maintenance_message', longString)[0].code,
    ).toBe('VALUE_TOO_LONG');
    expect(
      validateRemoteConfigValue('maintenance_message', 'hello'),
    ).toEqual([]);
  });

  it('string key — enum whitelist', () => {
    expect(
      validateRemoteConfigValue('visual_effect_default_level', 'low'),
    ).toEqual([]);
    expect(
      validateRemoteConfigValue('visual_effect_default_level', 'ultra')[0]
        .code,
    ).toBe('VALUE_NOT_IN_ENUM');
    expect(
      validateRemoteConfigValue('reward_safety_mode', 'panic')[0].code,
    ).toBe('VALUE_NOT_IN_ENUM');
    expect(
      validateRemoteConfigValue('reward_safety_mode', 'strict'),
    ).toEqual([]);
  });

  it('boolean key — type mismatch', () => {
    expect(
      validateRemoteConfigValue('market_enabled', 'true')[0].code,
    ).toBe('VALUE_TYPE_MISMATCH');
    expect(
      validateRemoteConfigValue('market_enabled', 1)[0].code,
    ).toBe('VALUE_TYPE_MISMATCH');
    expect(validateRemoteConfigValue('market_enabled', false)).toEqual([]);
    expect(validateRemoteConfigValue('market_enabled', true)).toEqual([]);
  });
});

describe('helpers', () => {
  it('getRemoteConfigDef returns catalog entry', () => {
    const def = getRemoteConfigDef('max_daily_claims');
    expect(def.valueType).toBe('number');
    expect(def.defaultValue).toBe(50);
  });

  it('getDefaultRemoteConfigValue mirrors catalog', () => {
    for (const def of REMOTE_CONFIG_CATALOG) {
      expect(getDefaultRemoteConfigValue(def.key)).toBe(def.defaultValue);
    }
  });

  it('isRemoteConfigKey rejects unknown', () => {
    expect(isRemoteConfigKey('max_daily_claims')).toBe(true);
    expect(isRemoteConfigKey('unknown_key')).toBe(false);
    expect(isRemoteConfigKey('')).toBe(false);
  });

  it('isRemoteConfigValueType rejects unknown', () => {
    expect(isRemoteConfigValueType('number')).toBe(true);
    expect(isRemoteConfigValueType('NUMBER')).toBe(false);
    expect(isRemoteConfigValueType('integer')).toBe(false);
  });
});
