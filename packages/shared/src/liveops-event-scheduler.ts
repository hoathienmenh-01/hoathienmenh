/**
 * LiveOps Event Scheduler — Phase 15.1–15.2.
 *
 * Hệ thống cho admin tạo/schedule event runtime mà KHÔNG cần deploy code.
 * Khác `liveops.ts` (catalog tĩnh, baseline retention/boss schedule), file
 * này định nghĩa shape cho event row động lưu trong DB
 * (`LiveOpsScheduledEvent`) + validators dùng chung FE/BE.
 *
 * Phase 15.1 (foundation):
 *   - Catalog 7 event type: `DOUBLE_DUNGEON_DROP`, `CULTIVATION_EXP_BOOST`,
 *     `SHOP_DISCOUNT`, `SECT_SHOP_DISCOUNT`, `DAILY_LOGIN_BONUS`,
 *     `BOSS_REWARD_BOOST`, `FESTIVAL_GIFT`.
 *   - Per-type cap config (`LIVEOPS_EVENT_TYPE_CAPS`) — server-authoritative
 *     anti-balance: drop/exp boost cap ≤ 2.0, discount cap ≤ 0.5 (50% off).
 *   - Validator `validateLiveOpsScheduledEventInput` (key/title/desc/window/
 *     multiplier/rewardJson) → reject ở admin endpoint.
 *
 * Phase 15.2 (runtime wire):
 *   - `pickActiveLiveOpsMultiplier(modifiers, type)` — pick MAX multiplier
 *     trong các active modifier cùng type. KHÔNG stack (max-only) tránh
 *     2 event cùng loại nhân lên vô hạn.
 *   - `clampLiveOpsMultiplier(type, mul)` — defense-in-depth: kẹp giá trị
 *     vào [min, max] cap dù admin lỡ bypass FE validator.
 *
 * Anti-balance-break design:
 *   - Drop multiplier ≤ 2.0 (không 5x/10x → không lật meta dungeon farm).
 *   - Exp multiplier ≤ 2.0 (giảm progression compression dài hạn).
 *   - Discount ≤ 50% (shop economy không sập — vẫn còn meaningful sink).
 *   - Compose: max-only (không product) — 2 admin tạo overlap event không
 *     stack.
 *
 * Không thuộc scope phase này:
 *   - Battle pass / gacha / pet / wife — không có hooks ở đây.
 *   - Reward catalog → Phase 15.3+ sẽ có FESTIVAL_GIFT claim grant; phase
 *     này chỉ stub validator + persistence.
 */

// ---------------------------------------------------------------------------
// Type catalog
// ---------------------------------------------------------------------------

/**
 * Loại event runtime. Mỗi type map vào 1 hook ở runtime modifier compose:
 *   - `DOUBLE_DUNGEON_DROP`   → dungeon-run claim (Phase 15.2 wire).
 *   - `CULTIVATION_EXP_BOOST` → cultivation tick (Phase 15.2 wire).
 *   - `SHOP_DISCOUNT`         → shop purchase price multiplier (Phase 15.3+).
 *   - `SECT_SHOP_DISCOUNT`    → sect shop purchase price multiplier (Phase 15.3+).
 *   - `DAILY_LOGIN_BONUS`     → daily login claim multiplier (Phase 15.3+).
 *   - `BOSS_REWARD_BOOST`     → boss kill reward multiplier (Phase 15.3+).
 *   - `FESTIVAL_GIFT`         → one-time claim từ `LiveOpsEventRewardClaim` (Phase 15.3+).
 */
export type LiveOpsScheduledEventType =
  | 'DOUBLE_DUNGEON_DROP'
  | 'CULTIVATION_EXP_BOOST'
  | 'SHOP_DISCOUNT'
  | 'SECT_SHOP_DISCOUNT'
  | 'DAILY_LOGIN_BONUS'
  | 'BOSS_REWARD_BOOST'
  | 'FESTIVAL_GIFT';

export const LIVEOPS_EVENT_TYPES: readonly LiveOpsScheduledEventType[] = [
  'DOUBLE_DUNGEON_DROP',
  'CULTIVATION_EXP_BOOST',
  'SHOP_DISCOUNT',
  'SECT_SHOP_DISCOUNT',
  'DAILY_LOGIN_BONUS',
  'BOSS_REWARD_BOOST',
  'FESTIVAL_GIFT',
] as const;

/**
 * Status lifecycle:
 *   `DRAFT` (admin tạo, chưa schedule)
 *     → `SCHEDULED` (admin enable, đang đợi tới `startsAt`)
 *     → `ACTIVE` (cron transition khi `now ≥ startsAt < endsAt`)
 *     → `ENDED` (cron transition khi `now ≥ endsAt`).
 *   `DISABLED` = admin disable bất kỳ lúc nào (kill switch).
 *
 * Cron 5-phút (`LIVEOPS_EVENT_RECOMPUTE_CRON_MS = 300000`) recompute idempotent:
 *   - SCHEDULED → ACTIVE khi tới `startsAt`.
 *   - ACTIVE    → ENDED khi qua `endsAt`.
 *   - DRAFT/DISABLED không bao giờ tự transition.
 */
export type LiveOpsScheduledEventStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'ENDED'
  | 'DISABLED';

export const LIVEOPS_EVENT_STATUSES: readonly LiveOpsScheduledEventStatus[] = [
  'DRAFT',
  'SCHEDULED',
  'ACTIVE',
  'ENDED',
  'DISABLED',
] as const;

// ---------------------------------------------------------------------------
// Per-type cap (server-authoritative anti-balance)
// ---------------------------------------------------------------------------

/**
 * Mỗi event type có 1 trong 4 "kind":
 *   - `BOOST` — multiplier ≥ 1.0, ≤ `multiplierMax`. Áp lên reward output:
 *     `granted = base × multiplier`. Ví dụ: dungeon drop, exp tick,
 *     boss reward, daily login bonus.
 *   - `DISCOUNT` — multiplier ∈ `[0, multiplierMax]`. Áp lên giá:
 *     `finalPrice = basePrice × (1 − multiplier)`. Cap mặc định 0.5
 *     (max 50% off — economy không sập).
 *   - `REWARD` — chỉ dùng `rewardJson` (one-time grant). `multiplier`
 *     ignored. Validator yêu cầu `rewardJson` non-empty.
 *
 * Anti-balance: cap được enforce ở 3 chỗ:
 *   1. FE form (UX hint, validator client-side).
 *   2. Shared `validateLiveOpsScheduledEventInput` — phải gọi ở API tạo/update.
 *   3. API runtime `clampLiveOpsMultiplier` — defense-in-depth khi compose
 *      modifier (ngộ nhỡ DB row cũ có giá trị xấu hơn cap mới).
 */
export interface LiveOpsEventTypeCap {
  readonly kind: 'BOOST' | 'DISCOUNT' | 'REWARD';
  readonly multiplierMin: number;
  readonly multiplierMax: number;
  readonly rewardJsonRequired: boolean;
  readonly description: string;
}

/**
 * Cap config per type. Sửa ở đây = đổi balance — phải update doc
 * `BALANCE_MODEL.md §LiveOps` + `ECONOMY_MODEL.md §LiveOps Discounts`.
 *
 * Cap chọn nhỏ phòng economy:
 *   - BOOST drop/exp 2.0 (max ×2 — không 5x/10x phá farm meta).
 *   - DISCOUNT 0.5 (max 50% off — sink shop vẫn meaningful).
 *   - REWARD: stub one-time claim (`FESTIVAL_GIFT`). multiplier ignore.
 */
export const LIVEOPS_EVENT_TYPE_CAPS: Record<
  LiveOpsScheduledEventType,
  LiveOpsEventTypeCap
> = {
  DOUBLE_DUNGEON_DROP: {
    kind: 'BOOST',
    multiplierMin: 1.0,
    multiplierMax: 2.0,
    rewardJsonRequired: false,
    description: 'Dungeon drop multiplier (≤ 2.0 hard cap).',
  },
  CULTIVATION_EXP_BOOST: {
    kind: 'BOOST',
    multiplierMin: 1.0,
    multiplierMax: 2.0,
    rewardJsonRequired: false,
    description: 'Cultivation tick exp multiplier (≤ 2.0 hard cap).',
  },
  SHOP_DISCOUNT: {
    kind: 'DISCOUNT',
    multiplierMin: 0,
    multiplierMax: 0.5,
    rewardJsonRequired: false,
    description: 'Shop NPC discount fraction (≤ 50% off).',
  },
  SECT_SHOP_DISCOUNT: {
    kind: 'DISCOUNT',
    multiplierMin: 0,
    multiplierMax: 0.5,
    rewardJsonRequired: false,
    description: 'Sect shop discount fraction (≤ 50% off).',
  },
  DAILY_LOGIN_BONUS: {
    kind: 'BOOST',
    multiplierMin: 1.0,
    multiplierMax: 2.0,
    rewardJsonRequired: false,
    description: 'Daily login reward multiplier (≤ 2.0 hard cap).',
  },
  BOSS_REWARD_BOOST: {
    kind: 'BOOST',
    multiplierMin: 1.0,
    multiplierMax: 2.0,
    rewardJsonRequired: false,
    description: 'Boss kill reward multiplier (≤ 2.0 hard cap).',
  },
  FESTIVAL_GIFT: {
    kind: 'REWARD',
    multiplierMin: 1.0,
    multiplierMax: 1.0,
    rewardJsonRequired: true,
    description: 'One-time festival gift claim (rewardJson required).',
  },
};

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/** Lowercase alphanumeric snake-or-kebab, 3–64 chars, start/end alphanumeric. */
export const LIVEOPS_EVENT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$/;
export const LIVEOPS_EVENT_TITLE_MAX = 120;
export const LIVEOPS_EVENT_DESC_MAX = 500;
/** Window tối thiểu 60s để cron 5-phút không miss event quá ngắn. */
export const LIVEOPS_EVENT_MIN_WINDOW_MS = 60_000;
/** Window tối đa 365 ngày — tránh admin lỡ tạo event vĩnh viễn. */
export const LIVEOPS_EVENT_MAX_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
/** Cron tick interval — pattern */
export const LIVEOPS_EVENT_RECOMPUTE_CRON = '*/5 * * * *';

export type LiveOpsScheduledEventValidationCode =
  | 'EVENT_KEY_INVALID'
  | 'EVENT_TYPE_INVALID'
  | 'EVENT_TITLE_TOO_LONG'
  | 'EVENT_TITLE_REQUIRED'
  | 'EVENT_DESC_TOO_LONG'
  | 'EVENT_WINDOW_INVALID'
  | 'EVENT_WINDOW_TOO_SHORT'
  | 'EVENT_WINDOW_TOO_LONG'
  | 'EVENT_MULTIPLIER_REQUIRED'
  | 'EVENT_MULTIPLIER_INVALID'
  | 'EVENT_MULTIPLIER_BELOW_MIN'
  | 'EVENT_MULTIPLIER_OVER_CAP'
  | 'EVENT_REWARD_JSON_REQUIRED'
  | 'EVENT_REWARD_JSON_INVALID'
  | 'EVENT_REWARD_ITEM_INVALID'
  | 'EVENT_REWARD_QTY_INVALID'
  | 'EVENT_REWARD_CURRENCY_INVALID'
  | 'EVENT_REWARD_EMPTY'
  | 'EVENT_REWARD_OVER_CAP';

export interface LiveOpsScheduledEventInput {
  readonly key: string;
  readonly type: LiveOpsScheduledEventType;
  readonly title: string;
  readonly description?: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly configJson: LiveOpsScheduledEventConfigInput;
}

export interface LiveOpsScheduledEventConfigInput {
  readonly multiplier?: number;
  readonly rewardJson?: Readonly<Record<string, unknown>>;
}

/**
 * Validate input *trước* khi ghi DB. Trả về `null` nếu pass, hoặc 1
 * error code trong `LiveOpsScheduledEventValidationCode`. API endpoint
 * map code → HTTP 400 + i18n.
 */
export function validateLiveOpsScheduledEventInput(
  input: LiveOpsScheduledEventInput,
): LiveOpsScheduledEventValidationCode | null {
  if (!LIVEOPS_EVENT_KEY_PATTERN.test(input.key)) return 'EVENT_KEY_INVALID';
  if (!isValidLiveOpsScheduledEventType(input.type))
    return 'EVENT_TYPE_INVALID';
  const title = input.title?.trim() ?? '';
  if (title.length === 0) return 'EVENT_TITLE_REQUIRED';
  if (title.length > LIVEOPS_EVENT_TITLE_MAX) return 'EVENT_TITLE_TOO_LONG';
  if (
    input.description !== undefined &&
    input.description.length > LIVEOPS_EVENT_DESC_MAX
  ) {
    return 'EVENT_DESC_TOO_LONG';
  }
  const startMs = input.startsAt.getTime();
  const endMs = input.endsAt.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    return 'EVENT_WINDOW_INVALID';
  }
  const windowMs = endMs - startMs;
  if (windowMs < LIVEOPS_EVENT_MIN_WINDOW_MS) return 'EVENT_WINDOW_TOO_SHORT';
  if (windowMs > LIVEOPS_EVENT_MAX_WINDOW_MS) return 'EVENT_WINDOW_TOO_LONG';

  const cap = LIVEOPS_EVENT_TYPE_CAPS[input.type];
  const cfg = input.configJson ?? {};

  if (cap.kind === 'REWARD') {
    if (!cfg.rewardJson || typeof cfg.rewardJson !== 'object') {
      return 'EVENT_REWARD_JSON_REQUIRED';
    }
    if (Object.keys(cfg.rewardJson).length === 0) {
      return 'EVENT_REWARD_JSON_REQUIRED';
    }
    if (!isPlainJsonObject(cfg.rewardJson)) {
      return 'EVENT_REWARD_JSON_INVALID';
    }
    return validateLiveOpsEventRewardJson(cfg.rewardJson);
  }

  // BOOST or DISCOUNT — multiplier required.
  if (cfg.multiplier === undefined || cfg.multiplier === null) {
    return 'EVENT_MULTIPLIER_REQUIRED';
  }
  if (!Number.isFinite(cfg.multiplier)) return 'EVENT_MULTIPLIER_INVALID';
  if (cfg.multiplier < cap.multiplierMin) return 'EVENT_MULTIPLIER_BELOW_MIN';
  if (cfg.multiplier > cap.multiplierMax) return 'EVENT_MULTIPLIER_OVER_CAP';

  if (cap.rewardJsonRequired && !cfg.rewardJson) {
    return 'EVENT_REWARD_JSON_REQUIRED';
  }
  if (cfg.rewardJson !== undefined && !isPlainJsonObject(cfg.rewardJson)) {
    return 'EVENT_REWARD_JSON_INVALID';
  }
  return null;
}

export function isValidLiveOpsScheduledEventType(
  s: string,
): s is LiveOpsScheduledEventType {
  return (LIVEOPS_EVENT_TYPES as readonly string[]).includes(s);
}

export function isValidLiveOpsScheduledEventStatus(
  s: string,
): s is LiveOpsScheduledEventStatus {
  return (LIVEOPS_EVENT_STATUSES as readonly string[]).includes(s);
}

function isPlainJsonObject(v: unknown): boolean {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  // Prototype-pollution guard: chỉ cho plain object.
  return Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null;
}

// ---------------------------------------------------------------------------
// Runtime modifier
// ---------------------------------------------------------------------------

/**
 * Shape mà API service trả ra cho runtime hook (dungeon-run, cultivation, ...).
 * `multiplier` semantics theo `LIVEOPS_EVENT_TYPE_CAPS[type].kind`:
 *   - BOOST    → multiplier ≥ 1.0 (apply: granted = base × mul).
 *   - DISCOUNT → multiplier ∈ [0, 0.5] (apply: price = base × (1 − mul)).
 *   - REWARD   → multiplier = 1.0, dùng `rewardJson` để grant.
 */
export interface LiveOpsRuntimeModifier {
  readonly eventKey: string;
  readonly type: LiveOpsScheduledEventType;
  readonly multiplier: number;
  readonly rewardJson?: Readonly<Record<string, unknown>>;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * Clamp `multiplier` vào range [min, max] của type. Defense-in-depth:
 * dù DB có row cũ (admin sai cap policy), runtime vẫn safe.
 */
export function clampLiveOpsMultiplier(
  type: LiveOpsScheduledEventType,
  multiplier: number,
): number {
  const cap = LIVEOPS_EVENT_TYPE_CAPS[type];
  if (Number.isNaN(multiplier)) return cap.multiplierMin;
  if (multiplier < cap.multiplierMin) return cap.multiplierMin;
  if (multiplier > cap.multiplierMax) return cap.multiplierMax;
  return multiplier;
}

/**
 * Pick MAX multiplier trong các active modifier cùng type. Nếu KHÔNG có
 * → trả default identity:
 *   - BOOST:    1.0 (no-op multiplier).
 *   - DISCOUNT: 0   (no discount).
 *   - REWARD:   1.0 (no-op).
 *
 * Lý do "max-only" thay vì "product":
 *   - Compose multiplicative dễ explode (2 event ×2 → ×4 phá cap 2.0).
 *   - Admin overlap event same-type có thể vô tình stack — max-only là
 *     intent-explicit (admin chủ ý chọn event nào active).
 */
export function pickActiveLiveOpsMultiplier(
  modifiers: readonly LiveOpsRuntimeModifier[],
  type: LiveOpsScheduledEventType,
): number {
  const cap = LIVEOPS_EVENT_TYPE_CAPS[type];
  const matches = modifiers.filter((m) => m.type === type);
  if (matches.length === 0) {
    return cap.kind === 'DISCOUNT' ? 0 : 1.0;
  }
  let best = cap.kind === 'DISCOUNT' ? 0 : 1.0;
  for (const m of matches) {
    const clamped = clampLiveOpsMultiplier(type, m.multiplier);
    if (clamped > best) best = clamped;
  }
  return best;
}

/**
 * `now` trong window `[startsAt, endsAt)` (start inclusive, end exclusive).
 * Pure function — test friendly.
 */
export function isLiveOpsEventActiveAt(
  startsAt: Date,
  endsAt: Date,
  now: Date,
): boolean {
  const t = now.getTime();
  return t >= startsAt.getTime() && t < endsAt.getTime();
}

/**
 * Compute next status từ current status + window:
 *   - `DRAFT`     → `DRAFT`     (không tự transition; admin phải POST schedule).
 *   - `DISABLED`  → `DISABLED`  (kill switch — không recover tự động).
 *   - `SCHEDULED` → `ACTIVE`    nếu `now ≥ startsAt < endsAt`.
 *   - `SCHEDULED` → `ENDED`     nếu `now ≥ endsAt` (lỡ schedule quá khứ).
 *   - `ACTIVE`    → `ENDED`     nếu `now ≥ endsAt`.
 *   - `ENDED`     → `ENDED`     (terminal).
 *
 * Idempotent: gọi nhiều lần với cùng input trả cùng output.
 */
export function nextLiveOpsScheduledEventStatus(
  current: LiveOpsScheduledEventStatus,
  startsAt: Date,
  endsAt: Date,
  now: Date,
): LiveOpsScheduledEventStatus {
  if (current === 'DRAFT' || current === 'DISABLED' || current === 'ENDED') {
    return current;
  }
  const t = now.getTime();
  if (t >= endsAt.getTime()) return 'ENDED';
  if (current === 'SCHEDULED' && t >= startsAt.getTime()) return 'ACTIVE';
  return current;
}

// ============================================================================
// Phase 15.3.A — FESTIVAL_GIFT reward config validation + parsing.
//
// `configJson.rewardJson` shape (canonical):
//
// ```
// {
//   linhThach?: number,            // ≥ 0, ≤ FESTIVAL_GIFT_LINH_THACH_CAP
//   tienNgoc?: number,             // ≥ 0, ≤ FESTIVAL_GIFT_TIEN_NGOC_CAP
//   items?: { itemKey: string, qty: number }[]   // qty ≥ 1, ≤ FESTIVAL_GIFT_ITEM_QTY_CAP
// }
// ```
//
// Anti-balance caps server-side để 1 admin event không thể ban phát "vô
// hạn" (kể cả MOD/admin lỡ tay). Caps cố tình thấp hơn dungeon/boss
// reward — Festival Gift là goodie bag PR, KHÔNG phải end-game farm.
// ============================================================================

/** Cap cứng số linhThach mỗi `FESTIVAL_GIFT` claim — defense-in-depth. */
export const FESTIVAL_GIFT_LINH_THACH_CAP = 1000;
/** Cap cứng số tienNgoc mỗi `FESTIVAL_GIFT` claim — premium currency tighter. */
export const FESTIVAL_GIFT_TIEN_NGOC_CAP = 50;
/** Cap cứng qty mỗi item trong rewardJson.items[]. */
export const FESTIVAL_GIFT_ITEM_QTY_CAP = 50;
/** Cap cứng số entries trong rewardJson.items[]. */
export const FESTIVAL_GIFT_ITEMS_MAX = 10;

export interface LiveOpsEventRewardItem {
  readonly itemKey: string;
  readonly qty: number;
}

export interface LiveOpsEventReward {
  readonly linhThach: number;
  readonly tienNgoc: number;
  readonly items: readonly LiveOpsEventRewardItem[];
}

function isPlainFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validate `rewardJson` payload cho `FESTIVAL_GIFT`. Trả về `null` nếu
 * pass, hoặc 1 error code. Pure-fn — không phụ thuộc DB / item catalog
 * (catalog lookup ở runtime claim flow để không khoá admin tạo event
 * trước item migration).
 *
 * Rules:
 *   - Ít nhất 1 trong (linhThach > 0, tienNgoc > 0, items.length > 0)
 *     phải có (no empty-bag).
 *   - linhThach: integer, 0 ≤ x ≤ `FESTIVAL_GIFT_LINH_THACH_CAP`.
 *   - tienNgoc: integer, 0 ≤ x ≤ `FESTIVAL_GIFT_TIEN_NGOC_CAP`.
 *   - items: array, length ≤ `FESTIVAL_GIFT_ITEMS_MAX`. Mỗi entry:
 *     - itemKey: string non-empty.
 *     - qty: integer, 1 ≤ qty ≤ `FESTIVAL_GIFT_ITEM_QTY_CAP`.
 *   - Không có field nào khác lạ → `EVENT_REWARD_JSON_INVALID`.
 */
export function validateLiveOpsEventRewardJson(
  rewardJson: Readonly<Record<string, unknown>>,
): LiveOpsScheduledEventValidationCode | null {
  const allowedKeys = new Set(['linhThach', 'tienNgoc', 'items']);
  for (const k of Object.keys(rewardJson)) {
    if (!allowedKeys.has(k)) return 'EVENT_REWARD_JSON_INVALID';
  }

  let linhThach = 0;
  if (rewardJson.linhThach !== undefined) {
    const v = rewardJson.linhThach;
    if (!isPlainFiniteNumber(v) || !Number.isInteger(v) || v < 0) {
      return 'EVENT_REWARD_CURRENCY_INVALID';
    }
    if (v > FESTIVAL_GIFT_LINH_THACH_CAP) return 'EVENT_REWARD_OVER_CAP';
    linhThach = v;
  }

  let tienNgoc = 0;
  if (rewardJson.tienNgoc !== undefined) {
    const v = rewardJson.tienNgoc;
    if (!isPlainFiniteNumber(v) || !Number.isInteger(v) || v < 0) {
      return 'EVENT_REWARD_CURRENCY_INVALID';
    }
    if (v > FESTIVAL_GIFT_TIEN_NGOC_CAP) return 'EVENT_REWARD_OVER_CAP';
    tienNgoc = v;
  }

  let itemCount = 0;
  if (rewardJson.items !== undefined) {
    if (!Array.isArray(rewardJson.items)) return 'EVENT_REWARD_JSON_INVALID';
    if (rewardJson.items.length > FESTIVAL_GIFT_ITEMS_MAX) {
      return 'EVENT_REWARD_OVER_CAP';
    }
    for (const raw of rewardJson.items) {
      if (!raw || typeof raw !== 'object') return 'EVENT_REWARD_ITEM_INVALID';
      const obj = raw as Record<string, unknown>;
      const allowedItemKeys = new Set(['itemKey', 'qty']);
      for (const k of Object.keys(obj)) {
        if (!allowedItemKeys.has(k)) return 'EVENT_REWARD_JSON_INVALID';
      }
      const itemKey = obj.itemKey;
      const qty = obj.qty;
      if (typeof itemKey !== 'string' || itemKey.trim().length === 0) {
        return 'EVENT_REWARD_ITEM_INVALID';
      }
      if (!isPlainFiniteNumber(qty) || !Number.isInteger(qty) || qty < 1) {
        return 'EVENT_REWARD_QTY_INVALID';
      }
      if (qty > FESTIVAL_GIFT_ITEM_QTY_CAP) return 'EVENT_REWARD_OVER_CAP';
      itemCount += 1;
    }
  }

  if (linhThach <= 0 && tienNgoc <= 0 && itemCount <= 0) {
    return 'EVENT_REWARD_EMPTY';
  }

  return null;
}

/**
 * Parse rewardJson đã validate (hoặc lỏng) thành tuple typed cho runtime
 * grant. Mọi field bị thiếu → identity (0 / []). Dùng INSIDE festival
 * gift claim flow sau khi pass validate.
 *
 * NOTE: caller PHẢI gọi `validateLiveOpsEventRewardJson` trước khi tin
 * tưởng output. `parseLiveOpsEventReward` chỉ coerce — trả best-effort
 * cho legacy / loose rows.
 */
export function parseLiveOpsEventReward(
  rewardJson: unknown,
): LiveOpsEventReward {
  if (!rewardJson || typeof rewardJson !== 'object' || Array.isArray(rewardJson)) {
    return { linhThach: 0, tienNgoc: 0, items: [] };
  }
  const obj = rewardJson as Record<string, unknown>;
  let linhThach = 0;
  let tienNgoc = 0;
  if (
    isPlainFiniteNumber(obj.linhThach) &&
    Number.isInteger(obj.linhThach) &&
    obj.linhThach >= 0
  ) {
    linhThach = Math.min(obj.linhThach, FESTIVAL_GIFT_LINH_THACH_CAP);
  }
  if (
    isPlainFiniteNumber(obj.tienNgoc) &&
    Number.isInteger(obj.tienNgoc) &&
    obj.tienNgoc >= 0
  ) {
    tienNgoc = Math.min(obj.tienNgoc, FESTIVAL_GIFT_TIEN_NGOC_CAP);
  }
  const items: LiveOpsEventRewardItem[] = [];
  if (Array.isArray(obj.items)) {
    for (const raw of obj.items.slice(0, FESTIVAL_GIFT_ITEMS_MAX)) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const itemKey = r.itemKey;
      const qty = r.qty;
      if (typeof itemKey !== 'string' || itemKey.trim().length === 0) continue;
      if (!isPlainFiniteNumber(qty) || !Number.isInteger(qty) || qty < 1) continue;
      items.push({
        itemKey,
        qty: Math.min(qty, FESTIVAL_GIFT_ITEM_QTY_CAP),
      });
    }
  }
  return { linhThach, tienNgoc, items };
}

/**
 * Phase 15.3.A — Runtime support catalog. Map từ event type → boolean
 * indicating runtime đã wire integration thật. Admin panel hiển thị
 * "runtime supported" badge dựa vào field này (không gây ảnh hưởng đến
 * cron / scheduler core).
 */
export const LIVEOPS_RUNTIME_SUPPORTED_TYPES: Readonly<
  Record<LiveOpsScheduledEventType, boolean>
> = Object.freeze({
  DOUBLE_DUNGEON_DROP: true,
  CULTIVATION_EXP_BOOST: true,
  SHOP_DISCOUNT: true,
  SECT_SHOP_DISCOUNT: true,
  DAILY_LOGIN_BONUS: true,
  BOSS_REWARD_BOOST: true,
  FESTIVAL_GIFT: true,
});

export function isLiveOpsRuntimeSupported(
  type: LiveOpsScheduledEventType,
): boolean {
  return LIVEOPS_RUNTIME_SUPPORTED_TYPES[type] === true;
}
