/**
 * Phase 45.0 — Remote Config Center V1.
 *
 * Hệ key/value runtime cho phép admin chỉnh config vận hành không cần
 * redeploy. Khác với Feature Flag (chỉ on/off boolean), Remote Config
 * lưu giá trị nhiều type: string / number / boolean / json.
 *
 * Design:
 *   - Catalog hardcoded trong shared (FE+BE đồng bộ). Admin chỉ chỉnh
 *     được key thuộc catalog — reject key ngoài catalog (anti-typo +
 *     anti-injection).
 *   - Mỗi key có `defaultValue` (fallback khi DB row chưa tồn tại / cache
 *     fail) + `valueType` (validate strict) + `cap` (anti-abuse).
 *   - `public: true` → expose qua `GET /config/public` cho FE đọc client
 *     (gating UI hint, không phải sensitive).
 *   - Audit log qua `AdminAuditLog` action `ADMIN_REMOTE_CONFIG_UPDATE`
 *     — reuse pattern với feature flag.
 *
 * Phase 45.0 chỉ catalog + validator + helper. Service runtime + admin
 * controller ở `apps/api/src/modules/remote-config/`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RemoteConfigValueType = 'string' | 'number' | 'boolean' | 'json';

export const REMOTE_CONFIG_VALUE_TYPES: readonly RemoteConfigValueType[] = [
  'string',
  'number',
  'boolean',
  'json',
] as const;

export function isRemoteConfigValueType(s: string): s is RemoteConfigValueType {
  return (REMOTE_CONFIG_VALUE_TYPES as readonly string[]).includes(s);
}

export type RemoteConfigKey =
  | 'max_daily_claims'
  | 'maintenance_message'
  | 'visual_effect_default_level'
  | 'reward_safety_mode'
  | 'market_enabled'
  | 'secret_realm_enabled'
  | 'pet_box_enabled';

export const REMOTE_CONFIG_KEYS: readonly RemoteConfigKey[] = [
  'max_daily_claims',
  'maintenance_message',
  'visual_effect_default_level',
  'reward_safety_mode',
  'market_enabled',
  'secret_realm_enabled',
  'pet_box_enabled',
] as const;

export function isRemoteConfigKey(s: string): s is RemoteConfigKey {
  return (REMOTE_CONFIG_KEYS as readonly string[]).includes(s);
}

/**
 * Giá trị runtime sau khi parse. Discriminated union để FE/BE phân loại
 * không cần `as` cast bừa.
 */
export type RemoteConfigValue =
  | { readonly type: 'string'; readonly value: string }
  | { readonly type: 'number'; readonly value: number }
  | { readonly type: 'boolean'; readonly value: boolean }
  | { readonly type: 'json'; readonly value: unknown };

/**
 * Cap rule cho từng value type:
 *   - `string`  — `maxLength` ký tự (default 1000).
 *   - `number`  — `min` / `max` inclusive (số nguyên hoặc float).
 *   - `boolean` — không cần cap, trùng default.
 *   - `json`    — `maxBytes` JSON.stringify (default 8192).
 *
 * Validator ở dưới sẽ reject value vượt cap với code rõ ràng.
 */
export interface RemoteConfigCap {
  readonly maxLength?: number;
  readonly min?: number;
  readonly max?: number;
  readonly maxBytes?: number;
  /** Optional enum whitelist cho string keys (vd reward_safety_mode). */
  readonly enumValues?: readonly string[];
}

export interface RemoteConfigDef {
  readonly key: RemoteConfigKey;
  readonly valueType: RemoteConfigValueType;
  readonly defaultValue: unknown;
  readonly descriptionVi: string;
  readonly descriptionEn: string;
  readonly public: boolean;
  readonly cap?: RemoteConfigCap;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const REMOTE_CONFIG_CATALOG: readonly RemoteConfigDef[] = [
  {
    key: 'max_daily_claims',
    valueType: 'number',
    defaultValue: 50,
    descriptionVi:
      'Số lần claim tối đa trong 1 ngày (mail / mission / daily encounter cộng dồn). Cap [1, 1000].',
    descriptionEn:
      'Max claim count per day across mail / mission / daily encounter. Range [1, 1000].',
    public: false,
    cap: { min: 1, max: 1000 },
  },
  {
    key: 'maintenance_message',
    valueType: 'string',
    defaultValue: '',
    descriptionVi:
      'Thông điệp banner bảo trì hiển thị header FE. Rỗng = ẩn banner. Tối đa 500 ký tự.',
    descriptionEn:
      'Maintenance banner message in FE header. Empty = hide. Max 500 chars.',
    public: true,
    cap: { maxLength: 500 },
  },
  {
    key: 'visual_effect_default_level',
    valueType: 'string',
    defaultValue: 'medium',
    descriptionVi:
      'Mặc định level hiệu ứng combat cho client mới (`low` / `medium` / `high`). Tắt VISUAL_EFFECTS_ENABLED override.',
    descriptionEn:
      'Default combat FX level for new clients (`low` / `medium` / `high`).',
    public: true,
    cap: { enumValues: ['low', 'medium', 'high'], maxLength: 16 },
  },
  {
    key: 'reward_safety_mode',
    valueType: 'string',
    defaultValue: 'normal',
    descriptionVi:
      'Chế độ reward safety (`normal` / `strict` / `lockdown`). `strict` = giảm 50% drop. `lockdown` = block grant phi-admin.',
    descriptionEn:
      'Reward safety mode (`normal` / `strict` / `lockdown`).',
    public: false,
    cap: { enumValues: ['normal', 'strict', 'lockdown'], maxLength: 16 },
  },
  {
    key: 'market_enabled',
    valueType: 'boolean',
    defaultValue: true,
    descriptionVi:
      'Bật/tắt Market qua remote config (mirror MARKET_ENABLED flag — runtime đọc cả hai AND).',
    descriptionEn:
      'Enable/disable Market via remote config (mirror MARKET_ENABLED flag).',
    public: true,
  },
  {
    key: 'secret_realm_enabled',
    valueType: 'boolean',
    defaultValue: true,
    descriptionVi:
      'Bật/tắt Secret Realm qua remote config (mirror SECRET_REALM_ENABLED flag).',
    descriptionEn:
      'Enable/disable Secret Realm via remote config.',
    public: false,
  },
  {
    key: 'pet_box_enabled',
    valueType: 'boolean',
    defaultValue: true,
    descriptionVi:
      'Bật/tắt Pet Box qua remote config (mirror PET_BOX_ENABLED flag).',
    descriptionEn:
      'Enable/disable Pet Box via remote config.',
    public: false,
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getRemoteConfigDef(key: RemoteConfigKey): RemoteConfigDef {
  const def = REMOTE_CONFIG_CATALOG.find((d) => d.key === key);
  if (!def) {
    throw new Error(`Remote config definition missing for key: ${key}`);
  }
  return def;
}

export function getDefaultRemoteConfigValue(key: RemoteConfigKey): unknown {
  return getRemoteConfigDef(key).defaultValue;
}

export const PUBLIC_REMOTE_CONFIG_KEYS: readonly RemoteConfigKey[] =
  REMOTE_CONFIG_CATALOG.filter((d) => d.public).map((d) => d.key);

export function isPublicRemoteConfigKey(key: RemoteConfigKey): boolean {
  return getRemoteConfigDef(key).public;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Pure UTF-8 byte length without depending on Node `Buffer` or DOM
 * `TextEncoder`. Counts each code point's UTF-8 encoding size.
 * Surrogate pairs become 4 bytes (combined).
 */
function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // high surrogate — pair with next low surrogate as 4 bytes total.
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export interface RemoteConfigViolation {
  readonly code:
    | 'VALUE_TYPE_MISMATCH'
    | 'VALUE_REQUIRED'
    | 'VALUE_TOO_LONG'
    | 'VALUE_OUT_OF_RANGE'
    | 'VALUE_NOT_IN_ENUM'
    | 'VALUE_JSON_TOO_LARGE'
    | 'VALUE_JSON_INVALID';
  readonly message: string;
}

/**
 * Validate giá trị raw (unknown) cho 1 remote-config key. Trả về danh
 * sách vi phạm rỗng nếu hợp lệ. Pure — không I/O.
 *
 * Convention: caller phải pass raw value đúng JS type (boolean / number /
 * string / object/array cho json). Nếu pass `string "true"` cho boolean
 * key → flag VALUE_TYPE_MISMATCH. Admin controller chuyển từ raw body
 * sang JS type qua zod trước khi gọi validator này.
 */
export function validateRemoteConfigValue(
  key: RemoteConfigKey,
  value: unknown,
): ReadonlyArray<RemoteConfigViolation> {
  const def = getRemoteConfigDef(key);
  const violations: RemoteConfigViolation[] = [];

  if (value === null || value === undefined) {
    violations.push({
      code: 'VALUE_REQUIRED',
      message: `Value for ${key} is required (got ${value})`,
    });
    return violations;
  }

  switch (def.valueType) {
    case 'string': {
      if (typeof value !== 'string') {
        violations.push({
          code: 'VALUE_TYPE_MISMATCH',
          message: `Expected string for ${key}, got ${typeof value}`,
        });
        break;
      }
      const maxLen = def.cap?.maxLength ?? 1000;
      if (value.length > maxLen) {
        violations.push({
          code: 'VALUE_TOO_LONG',
          message: `String for ${key} length ${value.length} > cap ${maxLen}`,
        });
      }
      if (def.cap?.enumValues && !def.cap.enumValues.includes(value)) {
        violations.push({
          code: 'VALUE_NOT_IN_ENUM',
          message: `Value "${value}" not in enum [${def.cap.enumValues.join(', ')}]`,
        });
      }
      break;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        violations.push({
          code: 'VALUE_TYPE_MISMATCH',
          message: `Expected finite number for ${key}, got ${typeof value}`,
        });
        break;
      }
      const min = def.cap?.min;
      const max = def.cap?.max;
      if (min !== undefined && value < min) {
        violations.push({
          code: 'VALUE_OUT_OF_RANGE',
          message: `Number for ${key} ${value} < min ${min}`,
        });
      }
      if (max !== undefined && value > max) {
        violations.push({
          code: 'VALUE_OUT_OF_RANGE',
          message: `Number for ${key} ${value} > max ${max}`,
        });
      }
      break;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        violations.push({
          code: 'VALUE_TYPE_MISMATCH',
          message: `Expected boolean for ${key}, got ${typeof value}`,
        });
      }
      break;
    }
    case 'json': {
      // accept any non-null object/array; reject primitive non-string
      // for `json` key (string would be `string` valueType instead).
      if (typeof value !== 'object') {
        violations.push({
          code: 'VALUE_TYPE_MISMATCH',
          message: `Expected JSON object/array for ${key}, got ${typeof value}`,
        });
        break;
      }
      let serialized: string;
      try {
        serialized = JSON.stringify(value);
      } catch {
        violations.push({
          code: 'VALUE_JSON_INVALID',
          message: `JSON for ${key} cannot be serialized (cyclic?)`,
        });
        break;
      }
      const maxBytes = def.cap?.maxBytes ?? 8192;
      if (utf8ByteLength(serialized) > maxBytes) {
        violations.push({
          code: 'VALUE_JSON_TOO_LARGE',
          message: `JSON for ${key} byte length > cap ${maxBytes}`,
        });
      }
      break;
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// API contract types
// ---------------------------------------------------------------------------

export interface RemoteConfigAdminView {
  readonly key: RemoteConfigKey;
  readonly valueType: RemoteConfigValueType;
  readonly value: unknown;
  readonly defaultValue: unknown;
  readonly descriptionVi: string;
  readonly descriptionEn: string;
  readonly public: boolean;
  readonly updatedByAdminId: string | null;
  readonly updatedAt: string | null;
}

export interface RemoteConfigPublicView {
  readonly key: RemoteConfigKey;
  readonly valueType: RemoteConfigValueType;
  readonly value: unknown;
}
