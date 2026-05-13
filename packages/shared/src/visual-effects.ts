/**
 * Phase 42.0 — Visual Effects, Combat Feedback, Item Aura & Presentation
 * System V1 shared catalog.
 *
 * Định nghĩa **presentation-only** catalog cho hiệu ứng hình ảnh nhẹ trong
 * Xuân Tôi (text-based MUD). Catalog này KHÔNG ảnh hưởng combat formula,
 * drop rate, damage hay reward — chỉ là metadata để FE chọn CSS class,
 * icon, duration. Reduced-motion fallback bắt buộc.
 *
 * Quy tắc bất biến:
 *   - Mọi effect phải có `reducedMotionFallback` (key của một effect khác
 *     hoặc 'NONE') để Low-effect mode chuyển sang.
 *   - `durationMs` không vượt {@link EFFECT_SAFETY.MAX_DURATION_MS_HIGH}.
 *   - `priority` dùng cho queue: effect priority cao được hiện trước khi
 *     vượt quá `maxVisible`.
 *   - Effect catalog là static, deterministic; không chứa secret / RNG.
 *
 * KHÔNG đụng gameplay/balance/economy — Phase 42 là tầng UI/UX. Một số
 * element trong catalog (LIGHTNING/WIND/DARK/LIGHT/CHAOS/VOID) chỉ hiện
 * trong presentation; chúng KHÔNG có entry trong combat formula.
 */

// ─────────────────────────────────────────────────────────────────────
// Effect Type / Element / Intensity / Motion Level
// ─────────────────────────────────────────────────────────────────────

export const VISUAL_EFFECT_TYPES = [
  // Combat feedback
  'DAMAGE',
  'HEAL',
  'CRIT',
  'MISS',
  'BLOCK',
  'SHIELD',
  'DOT',
  'LIFESTEAL',
  'COUNTER',
  // Status
  'BUFF',
  'DEBUFF',
  'CLEANSE',
  // Items / drops
  'ITEM_AURA',
  'RARE_DROP',
  // Boss
  'BOSS_APPEAR',
  'BOSS_WARNING',
  'BOSS_CHARGING',
  'BOSS_ENRAGE',
  'BOSS_SHIELD',
  'BOSS_HEALING',
  'BOSS_LOW_HP',
  'BOSS_DEFEATED',
  // Breakthrough
  'REALM_BREAKTHROUGH',
  'REALM_BREAKTHROUGH_FAILED',
  'BODY_BREAKTHROUGH',
  // Crafting
  'ALCHEMY_SUCCESS',
  'ALCHEMY_FAIL',
  'ALCHEMY_HIGH_QUALITY',
  'DAN_VAN_APPEAR',
  'CRAFT_SUCCESS',
  'CRAFT_FAIL',
  'ARTIFACT_AWAKEN',
  // System
  'EVENT_BANNER',
  'SYSTEM_TOAST',
  'TITLE_UNLOCK',
  'ACHIEVEMENT_UNLOCK',
] as const;
export type VisualEffectType = (typeof VISUAL_EFFECT_TYPES)[number];

export const VISUAL_EFFECT_ELEMENTS = [
  'NONE',
  'FIRE',
  'WATER',
  'WOOD',
  'METAL',
  'EARTH',
  'LIGHTNING',
  'WIND',
  'DARK',
  'LIGHT',
  'CHAOS',
  'VOID',
] as const;
export type VisualEffectElement = (typeof VISUAL_EFFECT_ELEMENTS)[number];

export const VISUAL_EFFECT_INTENSITIES = [
  'NONE',
  'LOW',
  'MEDIUM',
  'HIGH',
  'LEGENDARY',
  'IMMORTAL',
] as const;
export type VisualEffectIntensity = (typeof VISUAL_EFFECT_INTENSITIES)[number];

export const VISUAL_EFFECT_MOTION_LEVELS = ['OFF', 'LOW', 'MEDIUM', 'HIGH'] as const;
export type VisualEffectMotionLevel = (typeof VISUAL_EFFECT_MOTION_LEVELS)[number];

export const VISUAL_EFFECT_RARITIES = [
  'COMMON',
  'UNCOMMON',
  'RARE',
  'EPIC',
  'LEGENDARY',
  'MYTHIC',
  'IMMORTAL',
] as const;
export type VisualEffectRarity = (typeof VISUAL_EFFECT_RARITIES)[number];

/** Phẩm cấp (game term) — alias hợp lệ với equipment quality system. */
export const VISUAL_EFFECT_QUALITIES = [
  'HA_PHAM',
  'TRUNG_PHAM',
  'THUONG_PHAM',
  'CUC_PHAM',
  'DAN_VAN',
  'THAN_PHAM',
  'TIEN_PHAM',
] as const;
export type VisualEffectQuality = (typeof VISUAL_EFFECT_QUALITIES)[number];

// ─────────────────────────────────────────────────────────────────────
// Safety limits / queue defaults
// ─────────────────────────────────────────────────────────────────────

export const EFFECT_SAFETY = {
  /** Floating combat text tối đa hiện cùng lúc (mobile safety). */
  DEFAULT_MAX_FLOATING_TEXTS: 10,
  /** Popup (rare drop / boss warning / breakthrough) tối đa cùng lúc. */
  DEFAULT_MAX_POPUPS: 3,
  /** Queue size tối đa trước khi drop sự kiện cũ. */
  DEFAULT_MAX_QUEUE: 64,
  /** Duration ceiling theo motion level (ms). */
  MAX_DURATION_MS_LOW: 600,
  MAX_DURATION_MS_MEDIUM: 1200,
  MAX_DURATION_MS_HIGH: 2500,
  /** Cooldown giữa hai effect cùng dedupeKey (gom small damage). */
  DEFAULT_DEDUPE_COOLDOWN_MS: 200,
} as const;

// ─────────────────────────────────────────────────────────────────────
// Visual Effect Definition
// ─────────────────────────────────────────────────────────────────────

export interface VisualEffectDef {
  /** Unique key, format SCREAMING_SNAKE_CASE (vd `DAMAGE_FIRE_HIGH`). */
  key: string;
  type: VisualEffectType;
  element: VisualEffectElement;
  intensity: VisualEffectIntensity;
  /** Optional binding to drop rarity (gate cho ITEM_AURA / RARE_DROP). */
  rarity?: VisualEffectRarity;
  /** Item tier gate (inclusive), null = mọi tier. */
  tierMin?: number;
  tierMax?: number;
  /** Icon key (chuỗi, FE map sang asset/css). */
  iconKey: string;
  /** Tailwind / CSS class (FE inject). */
  cssClass: string;
  /** Animation key (FE map sang keyframes — không bắt buộc tồn tại trong CSS). */
  animationKey: string;
  /** Thời lượng hiển thị (ms). MUST ≤ {@link EFFECT_SAFETY.MAX_DURATION_MS_HIGH}. */
  durationMs: number;
  /** Priority để queue manager xử lý (cao = hiện trước). */
  priority: number;
  /** Key của effect fallback khi reduce-motion = true (hoặc 'NONE'). */
  reducedMotionFallback: string;
  /** i18n key cho mô tả hoặc free text (description ngắn). */
  description: string;
  /** Tag tự do để filter / debug. */
  tags?: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────
// Catalog
// ─────────────────────────────────────────────────────────────────────

/**
 * NONE effect — sentinel khi reduce-motion = true & không cần hiển thị
 * animation. FE render text/badge tĩnh.
 */
export const EFFECT_NONE: VisualEffectDef = Object.freeze({
  key: 'NONE',
  type: 'SYSTEM_TOAST',
  element: 'NONE',
  intensity: 'NONE',
  iconKey: 'none',
  cssClass: '',
  animationKey: 'none',
  durationMs: 0,
  priority: 0,
  reducedMotionFallback: 'NONE',
  description: 'visual.effect.none',
});

function def(
  key: string,
  type: VisualEffectType,
  element: VisualEffectElement,
  intensity: VisualEffectIntensity,
  opts: Partial<Omit<VisualEffectDef, 'key' | 'type' | 'element' | 'intensity'>> = {},
): VisualEffectDef {
  const durationMs = opts.durationMs ?? defaultDurationFor(intensity);
  return Object.freeze({
    key,
    type,
    element,
    intensity,
    iconKey: opts.iconKey ?? key.toLowerCase(),
    cssClass: opts.cssClass ?? '',
    animationKey: opts.animationKey ?? key.toLowerCase(),
    durationMs,
    priority: opts.priority ?? defaultPriorityFor(type, intensity),
    reducedMotionFallback: opts.reducedMotionFallback ?? 'NONE',
    description: opts.description ?? `visual.effect.${key}`,
    rarity: opts.rarity,
    tierMin: opts.tierMin,
    tierMax: opts.tierMax,
    tags: opts.tags,
  });
}

function defaultDurationFor(intensity: VisualEffectIntensity): number {
  switch (intensity) {
    case 'NONE':
      return 0;
    case 'LOW':
      return 350;
    case 'MEDIUM':
      return 700;
    case 'HIGH':
      return 1100;
    case 'LEGENDARY':
      return 1600;
    case 'IMMORTAL':
      return 2200;
  }
}

function defaultPriorityFor(type: VisualEffectType, intensity: VisualEffectIntensity): number {
  let base = 50;
  if (
    type === 'BOSS_APPEAR' ||
    type === 'BOSS_DEFEATED' ||
    type === 'BOSS_ENRAGE' ||
    type === 'BOSS_WARNING'
  ) {
    base = 90;
  } else if (type === 'REALM_BREAKTHROUGH' || type === 'REALM_BREAKTHROUGH_FAILED') {
    base = 85;
  } else if (type === 'RARE_DROP' || type === 'ARTIFACT_AWAKEN') {
    base = 80;
  } else if (type === 'CRIT' || type === 'COUNTER' || type === 'DAN_VAN_APPEAR') {
    base = 70;
  } else if (type === 'ALCHEMY_HIGH_QUALITY' || type === 'ACHIEVEMENT_UNLOCK') {
    base = 65;
  } else if (type === 'DAMAGE' || type === 'HEAL') {
    base = 30;
  }
  // Boost theo intensity (LEGENDARY/IMMORTAL hiện trước)
  if (intensity === 'LEGENDARY') base += 8;
  else if (intensity === 'IMMORTAL') base += 14;
  return base;
}

/** Catalog chính. KHÔNG export trực tiếp để force người dùng đi qua helper. */
const CATALOG: readonly VisualEffectDef[] = Object.freeze([
  EFFECT_NONE,

  // ── Floating combat text ──────────────────────────────────────────
  def('DAMAGE_LOW', 'DAMAGE', 'NONE', 'LOW', { reducedMotionFallback: 'NONE' }),
  def('DAMAGE_MEDIUM', 'DAMAGE', 'NONE', 'MEDIUM', { reducedMotionFallback: 'DAMAGE_LOW' }),
  def('DAMAGE_HIGH', 'DAMAGE', 'NONE', 'HIGH', { reducedMotionFallback: 'DAMAGE_LOW' }),
  def('HEAL_LOW', 'HEAL', 'NONE', 'LOW'),
  def('HEAL_MEDIUM', 'HEAL', 'NONE', 'MEDIUM', { reducedMotionFallback: 'HEAL_LOW' }),
  def('CRIT', 'CRIT', 'NONE', 'HIGH', { reducedMotionFallback: 'DAMAGE_LOW' }),
  def('MISS', 'MISS', 'NONE', 'LOW'),
  def('BLOCK', 'BLOCK', 'NONE', 'LOW'),
  def('SHIELD', 'SHIELD', 'NONE', 'MEDIUM', { reducedMotionFallback: 'BLOCK' }),
  def('DOT', 'DOT', 'NONE', 'LOW'),
  def('LIFESTEAL', 'LIFESTEAL', 'NONE', 'LOW'),
  def('COUNTER', 'COUNTER', 'NONE', 'MEDIUM', { reducedMotionFallback: 'DAMAGE_LOW' }),

  // ── Elemental damage variants ─────────────────────────────────────
  def('DAMAGE_FIRE', 'DAMAGE', 'FIRE', 'MEDIUM', { reducedMotionFallback: 'DAMAGE_LOW' }),
  def('DAMAGE_WATER', 'DAMAGE', 'WATER', 'MEDIUM', { reducedMotionFallback: 'DAMAGE_LOW' }),
  def('DAMAGE_WOOD', 'DAMAGE', 'WOOD', 'MEDIUM', { reducedMotionFallback: 'DAMAGE_LOW' }),
  def('DAMAGE_METAL', 'DAMAGE', 'METAL', 'MEDIUM', { reducedMotionFallback: 'DAMAGE_LOW' }),
  def('DAMAGE_EARTH', 'DAMAGE', 'EARTH', 'MEDIUM', { reducedMotionFallback: 'DAMAGE_LOW' }),
  def('DAMAGE_LIGHTNING', 'DAMAGE', 'LIGHTNING', 'HIGH', {
    reducedMotionFallback: 'DAMAGE_LOW',
  }),
  def('DAMAGE_WIND', 'DAMAGE', 'WIND', 'MEDIUM', { reducedMotionFallback: 'DAMAGE_LOW' }),
  def('DAMAGE_DARK', 'DAMAGE', 'DARK', 'MEDIUM', { reducedMotionFallback: 'DAMAGE_LOW' }),
  def('DAMAGE_LIGHT', 'DAMAGE', 'LIGHT', 'MEDIUM', { reducedMotionFallback: 'DAMAGE_LOW' }),

  // ── Buff / Debuff sentinel ────────────────────────────────────────
  def('BUFF', 'BUFF', 'NONE', 'LOW'),
  def('DEBUFF', 'DEBUFF', 'NONE', 'LOW'),
  def('CLEANSE', 'CLEANSE', 'LIGHT', 'MEDIUM', { reducedMotionFallback: 'NONE' }),

  // ── Item Aura per intensity (gate theo rarity/tier ở helper) ──────
  def('ITEM_AURA_NONE', 'ITEM_AURA', 'NONE', 'NONE', { durationMs: 0 }),
  def('ITEM_AURA_LOW', 'ITEM_AURA', 'NONE', 'LOW', { reducedMotionFallback: 'NONE' }),
  def('ITEM_AURA_MEDIUM', 'ITEM_AURA', 'NONE', 'MEDIUM', {
    reducedMotionFallback: 'ITEM_AURA_LOW',
  }),
  def('ITEM_AURA_HIGH', 'ITEM_AURA', 'NONE', 'HIGH', {
    reducedMotionFallback: 'ITEM_AURA_LOW',
  }),
  def('ITEM_AURA_LEGENDARY', 'ITEM_AURA', 'NONE', 'LEGENDARY', {
    reducedMotionFallback: 'ITEM_AURA_LOW',
  }),
  def('ITEM_AURA_IMMORTAL', 'ITEM_AURA', 'NONE', 'IMMORTAL', {
    reducedMotionFallback: 'ITEM_AURA_LOW',
  }),

  // Elemental aura variants — dùng cho item có element xác định
  def('ITEM_AURA_FIRE', 'ITEM_AURA', 'FIRE', 'MEDIUM', {
    reducedMotionFallback: 'ITEM_AURA_LOW',
  }),
  def('ITEM_AURA_WATER', 'ITEM_AURA', 'WATER', 'MEDIUM', {
    reducedMotionFallback: 'ITEM_AURA_LOW',
  }),
  def('ITEM_AURA_WOOD', 'ITEM_AURA', 'WOOD', 'MEDIUM', {
    reducedMotionFallback: 'ITEM_AURA_LOW',
  }),
  def('ITEM_AURA_METAL', 'ITEM_AURA', 'METAL', 'MEDIUM', {
    reducedMotionFallback: 'ITEM_AURA_LOW',
  }),
  def('ITEM_AURA_EARTH', 'ITEM_AURA', 'EARTH', 'MEDIUM', {
    reducedMotionFallback: 'ITEM_AURA_LOW',
  }),
  def('ITEM_AURA_LIGHTNING', 'ITEM_AURA', 'LIGHTNING', 'HIGH', {
    reducedMotionFallback: 'ITEM_AURA_LOW',
  }),
  def('ITEM_AURA_DARK', 'ITEM_AURA', 'DARK', 'HIGH', {
    reducedMotionFallback: 'ITEM_AURA_LOW',
  }),
  def('ITEM_AURA_LIGHT', 'ITEM_AURA', 'LIGHT', 'HIGH', {
    reducedMotionFallback: 'ITEM_AURA_LOW',
  }),

  // ── Rare drop popup theo rarity ───────────────────────────────────
  def('RARE_DROP_RARE', 'RARE_DROP', 'NONE', 'LOW', { rarity: 'RARE' }),
  def('RARE_DROP_EPIC', 'RARE_DROP', 'NONE', 'MEDIUM', {
    rarity: 'EPIC',
    reducedMotionFallback: 'RARE_DROP_RARE',
  }),
  def('RARE_DROP_LEGENDARY', 'RARE_DROP', 'NONE', 'LEGENDARY', {
    rarity: 'LEGENDARY',
    reducedMotionFallback: 'RARE_DROP_RARE',
  }),
  def('RARE_DROP_MYTHIC', 'RARE_DROP', 'NONE', 'IMMORTAL', {
    rarity: 'MYTHIC',
    reducedMotionFallback: 'RARE_DROP_RARE',
  }),

  // ── Boss warnings ─────────────────────────────────────────────────
  def('BOSS_APPEAR', 'BOSS_APPEAR', 'NONE', 'HIGH', { reducedMotionFallback: 'NONE' }),
  def('BOSS_WARNING', 'BOSS_WARNING', 'NONE', 'MEDIUM', { reducedMotionFallback: 'NONE' }),
  def('BOSS_CHARGING', 'BOSS_CHARGING', 'NONE', 'HIGH', { reducedMotionFallback: 'NONE' }),
  def('BOSS_ENRAGE', 'BOSS_ENRAGE', 'FIRE', 'HIGH', { reducedMotionFallback: 'NONE' }),
  def('BOSS_SHIELD', 'BOSS_SHIELD', 'EARTH', 'MEDIUM', { reducedMotionFallback: 'NONE' }),
  def('BOSS_HEALING', 'BOSS_HEALING', 'WOOD', 'MEDIUM', { reducedMotionFallback: 'NONE' }),
  def('BOSS_LOW_HP', 'BOSS_LOW_HP', 'NONE', 'MEDIUM', { reducedMotionFallback: 'NONE' }),
  def('BOSS_DEFEATED', 'BOSS_DEFEATED', 'LIGHT', 'LEGENDARY', {
    reducedMotionFallback: 'NONE',
  }),

  // ── Breakthrough ──────────────────────────────────────────────────
  def('REALM_BREAKTHROUGH', 'REALM_BREAKTHROUGH', 'LIGHT', 'LEGENDARY', {
    reducedMotionFallback: 'NONE',
  }),
  def('REALM_BREAKTHROUGH_FAILED', 'REALM_BREAKTHROUGH_FAILED', 'DARK', 'HIGH', {
    reducedMotionFallback: 'NONE',
  }),
  def('BODY_BREAKTHROUGH', 'BODY_BREAKTHROUGH', 'EARTH', 'HIGH', {
    reducedMotionFallback: 'NONE',
  }),

  // ── Alchemy / Craft ───────────────────────────────────────────────
  def('ALCHEMY_SUCCESS', 'ALCHEMY_SUCCESS', 'FIRE', 'MEDIUM', {
    reducedMotionFallback: 'NONE',
  }),
  def('ALCHEMY_FAIL', 'ALCHEMY_FAIL', 'DARK', 'LOW', { reducedMotionFallback: 'NONE' }),
  def('ALCHEMY_HIGH_QUALITY', 'ALCHEMY_HIGH_QUALITY', 'LIGHT', 'HIGH', {
    reducedMotionFallback: 'NONE',
  }),
  def('DAN_VAN_APPEAR', 'DAN_VAN_APPEAR', 'LIGHT', 'LEGENDARY', {
    reducedMotionFallback: 'NONE',
  }),
  def('CRAFT_SUCCESS', 'CRAFT_SUCCESS', 'METAL', 'MEDIUM', {
    reducedMotionFallback: 'NONE',
  }),
  def('CRAFT_FAIL', 'CRAFT_FAIL', 'DARK', 'LOW', { reducedMotionFallback: 'NONE' }),
  def('ARTIFACT_AWAKEN', 'ARTIFACT_AWAKEN', 'LIGHT', 'LEGENDARY', {
    reducedMotionFallback: 'NONE',
  }),

  // ── System ────────────────────────────────────────────────────────
  def('EVENT_BANNER', 'EVENT_BANNER', 'NONE', 'MEDIUM'),
  def('SYSTEM_TOAST', 'SYSTEM_TOAST', 'NONE', 'LOW'),
  def('TITLE_UNLOCK', 'TITLE_UNLOCK', 'LIGHT', 'HIGH', { reducedMotionFallback: 'NONE' }),
  def('ACHIEVEMENT_UNLOCK', 'ACHIEVEMENT_UNLOCK', 'LIGHT', 'HIGH', {
    reducedMotionFallback: 'NONE',
  }),
]);

const CATALOG_BY_KEY: Readonly<Record<string, VisualEffectDef>> = Object.freeze(
  Object.fromEntries(CATALOG.map((e) => [e.key, e])),
);

/** Toàn bộ catalog (read-only). FE/tests dùng để iterate. */
export function getAllVisualEffects(): readonly VisualEffectDef[] {
  return CATALOG;
}

// ─────────────────────────────────────────────────────────────────────
// Public helpers
// ─────────────────────────────────────────────────────────────────────

export function getEffectByKey(key: string): VisualEffectDef | null {
  return CATALOG_BY_KEY[key] ?? null;
}

export function getEffectOrFallback(key: string): VisualEffectDef {
  return CATALOG_BY_KEY[key] ?? EFFECT_NONE;
}

/**
 * Map item tier (1..10) → ITEM_AURA effect intensity theo spec Phase 42.
 * Reduced-motion fallback đã built-in vào def.
 */
export function getItemAuraEffect(
  tier: number,
  rarity?: VisualEffectRarity,
  element?: VisualEffectElement,
): VisualEffectDef {
  // Rarity is the strongest gate; tier chỉ tăng cấp khi tier ≥ 5.
  let key = 'ITEM_AURA_NONE';
  if (rarity === 'IMMORTAL' || rarity === 'MYTHIC') key = 'ITEM_AURA_IMMORTAL';
  else if (rarity === 'LEGENDARY') key = 'ITEM_AURA_LEGENDARY';
  else if (rarity === 'EPIC') key = 'ITEM_AURA_HIGH';
  else if (rarity === 'RARE' || rarity === 'UNCOMMON') key = 'ITEM_AURA_LOW';
  // Tier override (chỉ "lên" được, không hạ).
  if (tier >= 9) key = bumpAura(key, 'ITEM_AURA_LEGENDARY');
  else if (tier >= 7) key = bumpAura(key, 'ITEM_AURA_HIGH');
  else if (tier >= 5) key = bumpAura(key, 'ITEM_AURA_MEDIUM');
  else if (tier >= 3) key = bumpAura(key, 'ITEM_AURA_LOW');
  // Elemental override (giữ intensity, đổi sang variant element nếu có).
  if (element && element !== 'NONE') {
    const elemKey = `ITEM_AURA_${element}`;
    if (CATALOG_BY_KEY[elemKey]) key = elemKey;
  }
  return CATALOG_BY_KEY[key] ?? EFFECT_NONE;
}

const AURA_ORDER = [
  'ITEM_AURA_NONE',
  'ITEM_AURA_LOW',
  'ITEM_AURA_MEDIUM',
  'ITEM_AURA_HIGH',
  'ITEM_AURA_LEGENDARY',
  'ITEM_AURA_IMMORTAL',
] as const;

function bumpAura(currentKey: string, atLeastKey: string): string {
  const a = AURA_ORDER.indexOf(currentKey as (typeof AURA_ORDER)[number]);
  const b = AURA_ORDER.indexOf(atLeastKey as (typeof AURA_ORDER)[number]);
  if (a < 0) return atLeastKey;
  if (b < 0) return currentKey;
  return AURA_ORDER[Math.max(a, b)];
}

/** Map damage type + element → effect (fallback DAMAGE_LOW). */
export function getEffectByDamageType(
  type: 'normal' | 'crit' | 'miss' | 'block' | 'shield' | 'dot' | 'lifesteal' | 'counter' | 'heal',
  element?: VisualEffectElement,
): VisualEffectDef {
  if (type === 'crit') return CATALOG_BY_KEY['CRIT'];
  if (type === 'miss') return CATALOG_BY_KEY['MISS'];
  if (type === 'block') return CATALOG_BY_KEY['BLOCK'];
  if (type === 'shield') return CATALOG_BY_KEY['SHIELD'];
  if (type === 'dot') return CATALOG_BY_KEY['DOT'];
  if (type === 'lifesteal') return CATALOG_BY_KEY['LIFESTEAL'];
  if (type === 'counter') return CATALOG_BY_KEY['COUNTER'];
  if (type === 'heal') return CATALOG_BY_KEY['HEAL_MEDIUM'];
  if (element && element !== 'NONE') {
    const key = `DAMAGE_${element}`;
    if (CATALOG_BY_KEY[key]) return CATALOG_BY_KEY[key];
  }
  return CATALOG_BY_KEY['DAMAGE_MEDIUM'];
}

/** Map drop rarity → RARE_DROP_* effect, COMMON/UNCOMMON → null. */
export function getEffectByRarity(
  rarity: VisualEffectRarity | null | undefined,
): VisualEffectDef | null {
  if (!rarity) return null;
  switch (rarity) {
    case 'RARE':
      return CATALOG_BY_KEY['RARE_DROP_RARE'];
    case 'EPIC':
      return CATALOG_BY_KEY['RARE_DROP_EPIC'];
    case 'LEGENDARY':
      return CATALOG_BY_KEY['RARE_DROP_LEGENDARY'];
    case 'MYTHIC':
    case 'IMMORTAL':
      return CATALOG_BY_KEY['RARE_DROP_MYTHIC'];
    default:
      return null;
  }
}

/** Map element + actionType → presentation effect. */
export function getElementalEffect(
  element: VisualEffectElement,
  actionType: 'damage' | 'heal' | 'shield' | 'stun' | 'crit',
): VisualEffectDef {
  if (actionType === 'heal') return CATALOG_BY_KEY['HEAL_MEDIUM'];
  if (actionType === 'shield') return CATALOG_BY_KEY['SHIELD'];
  if (actionType === 'crit') return CATALOG_BY_KEY['CRIT'];
  if (actionType === 'stun') {
    // Lôi = stun fits theo Phase 42 catalog
    return CATALOG_BY_KEY['DAMAGE_LIGHTNING'] ?? CATALOG_BY_KEY['DEBUFF'];
  }
  const k = `DAMAGE_${element}`;
  return CATALOG_BY_KEY[k] ?? CATALOG_BY_KEY['DAMAGE_MEDIUM'];
}

/** Map effect → reduced-motion fallback (đệ quy 1 cấp). */
export function getReducedMotionEffect(key: string): VisualEffectDef {
  const e = CATALOG_BY_KEY[key];
  if (!e) return EFFECT_NONE;
  if (e.reducedMotionFallback === e.key) return EFFECT_NONE;
  return CATALOG_BY_KEY[e.reducedMotionFallback] ?? EFFECT_NONE;
}

export function getBossWarningEffect(
  warningType:
    | 'BOSS_APPEAR'
    | 'BOSS_WARNING'
    | 'BOSS_CHARGING'
    | 'BOSS_ENRAGE'
    | 'BOSS_SHIELD'
    | 'BOSS_HEALING'
    | 'BOSS_LOW_HP'
    | 'BOSS_DEFEATED',
): VisualEffectDef {
  return CATALOG_BY_KEY[warningType] ?? CATALOG_BY_KEY['BOSS_WARNING'];
}

// ─────────────────────────────────────────────────────────────────────
// Validator helpers (foundation for admin preview lab)
// ─────────────────────────────────────────────────────────────────────

export function validateEffectKeyExists(key: string): boolean {
  return CATALOG_BY_KEY[key] !== undefined;
}

export function validateEffectHasFallback(effect: VisualEffectDef): boolean {
  if (!effect.reducedMotionFallback) return false;
  if (effect.reducedMotionFallback === 'NONE') return true;
  return CATALOG_BY_KEY[effect.reducedMotionFallback] !== undefined;
}

export function validateEffectIntensityAllowed(
  effect: VisualEffectDef,
  motion: VisualEffectMotionLevel,
): boolean {
  if (motion === 'OFF') return effect.intensity === 'NONE';
  if (motion === 'LOW')
    return effect.intensity === 'NONE' || effect.intensity === 'LOW';
  if (motion === 'MEDIUM')
    return effect.intensity !== 'LEGENDARY' && effect.intensity !== 'IMMORTAL';
  return true; // HIGH cho phép mọi intensity
}

export function validateEffectDurationSafe(effect: VisualEffectDef): boolean {
  return effect.durationMs >= 0 && effect.durationMs <= EFFECT_SAFETY.MAX_DURATION_MS_HIGH;
}

/**
 * Item effect policy — chặn gắn effect quá mạnh cho item rarity thấp.
 * Trả về `null` nếu hợp lệ, hoặc error code.
 */
export function validateItemEffectPolicy(opts: {
  rarity: VisualEffectRarity;
  effect: VisualEffectDef;
}): string | null {
  const { rarity, effect } = opts;
  if (effect.type !== 'ITEM_AURA') return null;
  // COMMON không được phép có aura.
  if (rarity === 'COMMON' && effect.intensity !== 'NONE') {
    return 'ITEM_EFFECT_TOO_INTENSE_FOR_RARITY';
  }
  // RARE max MEDIUM, EPIC max HIGH, LEGENDARY+ ok.
  const order: VisualEffectIntensity[] = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'LEGENDARY', 'IMMORTAL'];
  const idx = order.indexOf(effect.intensity);
  if (rarity === 'UNCOMMON' && idx > order.indexOf('LOW')) {
    return 'ITEM_EFFECT_TOO_INTENSE_FOR_RARITY';
  }
  if (rarity === 'RARE' && idx > order.indexOf('MEDIUM')) {
    return 'ITEM_EFFECT_TOO_INTENSE_FOR_RARITY';
  }
  if (rarity === 'EPIC' && idx > order.indexOf('HIGH')) {
    return 'ITEM_EFFECT_TOO_INTENSE_FOR_RARITY';
  }
  return null;
}

export function validateBossEffectPolicy(effect: VisualEffectDef): string | null {
  const ok =
    effect.type === 'BOSS_APPEAR' ||
    effect.type === 'BOSS_WARNING' ||
    effect.type === 'BOSS_CHARGING' ||
    effect.type === 'BOSS_ENRAGE' ||
    effect.type === 'BOSS_SHIELD' ||
    effect.type === 'BOSS_HEALING' ||
    effect.type === 'BOSS_LOW_HP' ||
    effect.type === 'BOSS_DEFEATED';
  if (!ok) return 'BOSS_EFFECT_TYPE_MISMATCH';
  if (!validateEffectDurationSafe(effect)) return 'BOSS_EFFECT_DURATION_UNSAFE';
  return null;
}

/** Sanity-check toàn catalog. Trả về list error code; empty = ok. */
export function validateEffectCatalog(): readonly string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const e of CATALOG) {
    if (seen.has(e.key)) errors.push(`DUPLICATE_KEY:${e.key}`);
    seen.add(e.key);
    if (!validateEffectHasFallback(e)) errors.push(`MISSING_FALLBACK:${e.key}`);
    if (!validateEffectDurationSafe(e)) errors.push(`DURATION_UNSAFE:${e.key}`);
  }
  return errors;
}

// ─────────────────────────────────────────────────────────────────────
// Status Effects (BUFF/DEBUFF presentation catalog)
// ─────────────────────────────────────────────────────────────────────

export const STATUS_EFFECT_TYPES = [
  'BURN',
  'POISON',
  'FREEZE',
  'STUN',
  'BLEED',
  'WEAKEN',
  'ARMOR_BREAK',
  'SILENCE',
  'SHIELD',
  'COUNTER',
  'ATTACK_UP',
  'DEFENSE_UP',
  'SPEED_UP',
  'SPEED_DOWN',
  'REGEN',
  'CLEANSE',
  'CURSE',
  'LIFESTEAL',
  'REFLECT',
  'IMMUNE',
] as const;
export type StatusEffectType = (typeof STATUS_EFFECT_TYPES)[number];

export interface StatusEffectDef {
  key: StatusEffectType;
  labelVi: string;
  labelEn: string;
  tooltipVi: string;
  tooltipEn: string;
  element: VisualEffectElement;
  iconKey: string;
  /** Liên kết tới visual effect catalog. */
  effectKey: string;
  positive: boolean;
  stackable: boolean;
  maxStack?: number;
  defaultDuration?: number;
  cssClass: string;
}

function statusDef(
  key: StatusEffectType,
  opts: Omit<StatusEffectDef, 'key'>,
): StatusEffectDef {
  return Object.freeze({ key, ...opts });
}

const STATUS_CATALOG: readonly StatusEffectDef[] = Object.freeze([
  statusDef('BURN', {
    labelVi: 'Bỏng',
    labelEn: 'Burn',
    tooltipVi: 'Sát thương Hỏa theo thời gian.',
    tooltipEn: 'Fire damage over time.',
    element: 'FIRE',
    iconKey: 'status-burn',
    effectKey: 'DOT',
    positive: false,
    stackable: true,
    maxStack: 5,
    defaultDuration: 3,
    cssClass: 'text-red-300 border-red-400/60',
  }),
  statusDef('POISON', {
    labelVi: 'Trúng độc',
    labelEn: 'Poison',
    tooltipVi: 'Sát thương Mộc theo thời gian.',
    tooltipEn: 'Wood (poison) damage over time.',
    element: 'WOOD',
    iconKey: 'status-poison',
    effectKey: 'DOT',
    positive: false,
    stackable: true,
    maxStack: 5,
    defaultDuration: 3,
    cssClass: 'text-green-300 border-green-400/60',
  }),
  statusDef('FREEZE', {
    labelVi: 'Đóng băng',
    labelEn: 'Freeze',
    tooltipVi: 'Đối thủ chậm hoặc bị giam.',
    tooltipEn: 'Target slowed or rooted.',
    element: 'WATER',
    iconKey: 'status-freeze',
    effectKey: 'DEBUFF',
    positive: false,
    stackable: false,
    defaultDuration: 2,
    cssClass: 'text-cyan-300 border-cyan-400/60',
  }),
  statusDef('STUN', {
    labelVi: 'Choáng',
    labelEn: 'Stun',
    tooltipVi: 'Mất lượt do Lôi/Phong chấn.',
    tooltipEn: 'Skip turn from lightning/wind shock.',
    element: 'LIGHTNING',
    iconKey: 'status-stun',
    effectKey: 'DEBUFF',
    positive: false,
    stackable: false,
    defaultDuration: 1,
    cssClass: 'text-yellow-300 border-yellow-400/60',
  }),
  statusDef('BLEED', {
    labelVi: 'Chảy máu',
    labelEn: 'Bleed',
    tooltipVi: 'Sát thương Kim theo thời gian.',
    tooltipEn: 'Metal damage over time.',
    element: 'METAL',
    iconKey: 'status-bleed',
    effectKey: 'DOT',
    positive: false,
    stackable: true,
    maxStack: 5,
    defaultDuration: 3,
    cssClass: 'text-rose-300 border-rose-400/60',
  }),
  statusDef('WEAKEN', {
    labelVi: 'Suy yếu',
    labelEn: 'Weaken',
    tooltipVi: 'Giảm sát thương gây ra.',
    tooltipEn: 'Reduce outgoing damage.',
    element: 'DARK',
    iconKey: 'status-weaken',
    effectKey: 'DEBUFF',
    positive: false,
    stackable: false,
    defaultDuration: 3,
    cssClass: 'text-purple-300 border-purple-400/60',
  }),
  statusDef('ARMOR_BREAK', {
    labelVi: 'Vỡ giáp',
    labelEn: 'Armor Break',
    tooltipVi: 'Giảm phòng ngự — Kim phá thủ.',
    tooltipEn: 'Reduce defense — metal pierce.',
    element: 'METAL',
    iconKey: 'status-armor-break',
    effectKey: 'DEBUFF',
    positive: false,
    stackable: false,
    defaultDuration: 3,
    cssClass: 'text-amber-300 border-amber-400/60',
  }),
  statusDef('SILENCE', {
    labelVi: 'Câm lặng',
    labelEn: 'Silence',
    tooltipVi: 'Không thi triển kỹ năng.',
    tooltipEn: 'Cannot cast skills.',
    element: 'DARK',
    iconKey: 'status-silence',
    effectKey: 'DEBUFF',
    positive: false,
    stackable: false,
    defaultDuration: 2,
    cssClass: 'text-violet-300 border-violet-400/60',
  }),
  statusDef('SHIELD', {
    labelVi: 'Khiên',
    labelEn: 'Shield',
    tooltipVi: 'Hấp thụ sát thương kế tiếp.',
    tooltipEn: 'Absorb incoming damage.',
    element: 'EARTH',
    iconKey: 'status-shield',
    effectKey: 'SHIELD',
    positive: true,
    stackable: false,
    defaultDuration: 3,
    cssClass: 'text-yellow-200 border-yellow-300/60',
  }),
  statusDef('COUNTER', {
    labelVi: 'Phản kích',
    labelEn: 'Counter',
    tooltipVi: 'Phản đòn khi bị tấn công.',
    tooltipEn: 'Counter-attack when hit.',
    element: 'METAL',
    iconKey: 'status-counter',
    effectKey: 'COUNTER',
    positive: true,
    stackable: false,
    defaultDuration: 2,
    cssClass: 'text-amber-200 border-amber-300/60',
  }),
  statusDef('ATTACK_UP', {
    labelVi: 'Tăng công',
    labelEn: 'Attack Up',
    tooltipVi: 'Tăng sát thương gây ra.',
    tooltipEn: 'Increase outgoing damage.',
    element: 'FIRE',
    iconKey: 'status-attack-up',
    effectKey: 'BUFF',
    positive: true,
    stackable: false,
    defaultDuration: 3,
    cssClass: 'text-orange-200 border-orange-300/60',
  }),
  statusDef('DEFENSE_UP', {
    labelVi: 'Tăng thủ',
    labelEn: 'Defense Up',
    tooltipVi: 'Tăng phòng ngự.',
    tooltipEn: 'Increase defense.',
    element: 'EARTH',
    iconKey: 'status-defense-up',
    effectKey: 'BUFF',
    positive: true,
    stackable: false,
    defaultDuration: 3,
    cssClass: 'text-yellow-100 border-yellow-200/60',
  }),
  statusDef('SPEED_UP', {
    labelVi: 'Tăng tốc',
    labelEn: 'Speed Up',
    tooltipVi: 'Tăng tốc độ ra đòn.',
    tooltipEn: 'Increase action speed.',
    element: 'WIND',
    iconKey: 'status-speed-up',
    effectKey: 'BUFF',
    positive: true,
    stackable: false,
    defaultDuration: 3,
    cssClass: 'text-emerald-200 border-emerald-300/60',
  }),
  statusDef('SPEED_DOWN', {
    labelVi: 'Giảm tốc',
    labelEn: 'Speed Down',
    tooltipVi: 'Giảm tốc độ ra đòn.',
    tooltipEn: 'Reduce action speed.',
    element: 'WATER',
    iconKey: 'status-speed-down',
    effectKey: 'DEBUFF',
    positive: false,
    stackable: false,
    defaultDuration: 3,
    cssClass: 'text-sky-300 border-sky-400/60',
  }),
  statusDef('REGEN', {
    labelVi: 'Hồi máu',
    labelEn: 'Regen',
    tooltipVi: 'Hồi HP theo thời gian.',
    tooltipEn: 'Heal HP over time.',
    element: 'WOOD',
    iconKey: 'status-regen',
    effectKey: 'HEAL_LOW',
    positive: true,
    stackable: false,
    defaultDuration: 5,
    cssClass: 'text-lime-200 border-lime-300/60',
  }),
  statusDef('CLEANSE', {
    labelVi: 'Thanh tẩy',
    labelEn: 'Cleanse',
    tooltipVi: 'Xoá hiệu ứng tiêu cực.',
    tooltipEn: 'Remove negative effects.',
    element: 'LIGHT',
    iconKey: 'status-cleanse',
    effectKey: 'CLEANSE',
    positive: true,
    stackable: false,
    defaultDuration: 1,
    cssClass: 'text-white border-white/60',
  }),
  statusDef('CURSE', {
    labelVi: 'Nguyền',
    labelEn: 'Curse',
    tooltipVi: 'Giảm sức mạnh + sát thương Ám.',
    tooltipEn: 'Reduce power and inflict dark damage.',
    element: 'DARK',
    iconKey: 'status-curse',
    effectKey: 'DEBUFF',
    positive: false,
    stackable: false,
    defaultDuration: 4,
    cssClass: 'text-fuchsia-300 border-fuchsia-400/60',
  }),
  statusDef('LIFESTEAL', {
    labelVi: 'Hấp huyết',
    labelEn: 'Lifesteal',
    tooltipVi: 'Hồi máu theo % sát thương gây ra.',
    tooltipEn: 'Heal a portion of damage dealt.',
    element: 'DARK',
    iconKey: 'status-lifesteal',
    effectKey: 'LIFESTEAL',
    positive: true,
    stackable: false,
    defaultDuration: 3,
    cssClass: 'text-pink-200 border-pink-300/60',
  }),
  statusDef('REFLECT', {
    labelVi: 'Phản công',
    labelEn: 'Reflect',
    tooltipVi: 'Phản hồi 1 phần sát thương.',
    tooltipEn: 'Reflect a portion of damage.',
    element: 'METAL',
    iconKey: 'status-reflect',
    effectKey: 'COUNTER',
    positive: true,
    stackable: false,
    defaultDuration: 2,
    cssClass: 'text-yellow-200 border-yellow-300/60',
  }),
  statusDef('IMMUNE', {
    labelVi: 'Miễn nhiễm',
    labelEn: 'Immune',
    tooltipVi: 'Không bị áp các hiệu ứng tiêu cực.',
    tooltipEn: 'Cannot be inflicted with negative effects.',
    element: 'LIGHT',
    iconKey: 'status-immune',
    effectKey: 'BUFF',
    positive: true,
    stackable: false,
    defaultDuration: 2,
    cssClass: 'text-amber-100 border-amber-200/60',
  }),
]);

const STATUS_BY_KEY: Readonly<Record<string, StatusEffectDef>> = Object.freeze(
  Object.fromEntries(STATUS_CATALOG.map((s) => [s.key, s])),
);

export function getAllStatusEffects(): readonly StatusEffectDef[] {
  return STATUS_CATALOG;
}

export function getStatusEffectByKey(key: string): StatusEffectDef | null {
  return STATUS_BY_KEY[key] ?? null;
}

export function validateStatusEffectCatalog(): readonly string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const s of STATUS_CATALOG) {
    if (seen.has(s.key)) errors.push(`DUPLICATE_STATUS:${s.key}`);
    seen.add(s.key);
    if (!validateEffectKeyExists(s.effectKey)) {
      errors.push(`STATUS_EFFECT_KEY_MISSING:${s.key}->${s.effectKey}`);
    }
  }
  return errors;
}

// ─────────────────────────────────────────────────────────────────────
// Player visual-effect settings (extension layer for Phase 41 PlayerSettings)
// ─────────────────────────────────────────────────────────────────────

export interface PlayerVisualEffectSettings {
  visualEffectLevel: VisualEffectMotionLevel;
  enableFloatingCombatText: boolean;
  enableCombatTimelineEffects: boolean;
  enableStatusEffectIcons: boolean;
  enableItemAura: boolean;
  enableRareDropPopup: boolean;
  enableBossWarningEffects: boolean;
  enableBreakthroughEffects: boolean;
  enableCraftingEffects: boolean;
  enableElementalEffects: boolean;
  enableScreenShake: boolean;
  enableSoundEffectsFoundation: boolean;
  maxFloatingTextsOnScreen: number;
  maxEffectPopupsOnScreen: number;
}

export const DEFAULT_PLAYER_VISUAL_EFFECT_SETTINGS: PlayerVisualEffectSettings = Object.freeze({
  visualEffectLevel: 'MEDIUM',
  enableFloatingCombatText: true,
  enableCombatTimelineEffects: true,
  enableStatusEffectIcons: true,
  enableItemAura: true,
  enableRareDropPopup: true,
  enableBossWarningEffects: true,
  enableBreakthroughEffects: true,
  enableCraftingEffects: true,
  enableElementalEffects: true,
  enableScreenShake: false,
  enableSoundEffectsFoundation: false,
  maxFloatingTextsOnScreen: EFFECT_SAFETY.DEFAULT_MAX_FLOATING_TEXTS,
  maxEffectPopupsOnScreen: EFFECT_SAFETY.DEFAULT_MAX_POPUPS,
});

export const PLAYER_VISUAL_EFFECT_LIMITS = {
  MAX_FLOATING_TEXTS_HARD_CAP: 30,
  MIN_FLOATING_TEXTS: 0,
  MAX_POPUPS_HARD_CAP: 8,
  MIN_POPUPS: 0,
} as const;

/**
 * Validate + sanitize PATCH body cho visual-effect settings. Trả về sanitized
 * object (chỉ field hợp lệ) + error list. Caller có thể merge với current
 * settings.
 */
export function validatePlayerVisualEffectSettings(input: unknown): {
  ok: boolean;
  errors: string[];
  sanitized: Partial<PlayerVisualEffectSettings>;
} {
  const errors: string[] = [];
  const out: Partial<PlayerVisualEffectSettings> = {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['VISUAL_EFFECTS_INVALID'], sanitized: {} };
  }
  const raw = input as Record<string, unknown>;

  if (raw.visualEffectLevel !== undefined) {
    if (
      typeof raw.visualEffectLevel === 'string' &&
      (VISUAL_EFFECT_MOTION_LEVELS as readonly string[]).includes(raw.visualEffectLevel)
    ) {
      out.visualEffectLevel = raw.visualEffectLevel as VisualEffectMotionLevel;
    } else {
      errors.push('VISUAL_EFFECTS_INVALID:visualEffectLevel');
    }
  }

  const boolKeys: (keyof PlayerVisualEffectSettings)[] = [
    'enableFloatingCombatText',
    'enableCombatTimelineEffects',
    'enableStatusEffectIcons',
    'enableItemAura',
    'enableRareDropPopup',
    'enableBossWarningEffects',
    'enableBreakthroughEffects',
    'enableCraftingEffects',
    'enableElementalEffects',
    'enableScreenShake',
    'enableSoundEffectsFoundation',
  ];
  for (const k of boolKeys) {
    const v = raw[k as string];
    if (v === undefined) continue;
    if (typeof v !== 'boolean') {
      errors.push(`VISUAL_EFFECTS_INVALID:${String(k)}`);
      continue;
    }
    (out as Record<string, unknown>)[k as string] = v;
  }

  if (raw.maxFloatingTextsOnScreen !== undefined) {
    if (
      typeof raw.maxFloatingTextsOnScreen === 'number' &&
      Number.isFinite(raw.maxFloatingTextsOnScreen) &&
      raw.maxFloatingTextsOnScreen >= PLAYER_VISUAL_EFFECT_LIMITS.MIN_FLOATING_TEXTS &&
      raw.maxFloatingTextsOnScreen <= PLAYER_VISUAL_EFFECT_LIMITS.MAX_FLOATING_TEXTS_HARD_CAP
    ) {
      out.maxFloatingTextsOnScreen = Math.floor(raw.maxFloatingTextsOnScreen);
    } else {
      errors.push('VISUAL_EFFECTS_INVALID:maxFloatingTextsOnScreen');
    }
  }
  if (raw.maxEffectPopupsOnScreen !== undefined) {
    if (
      typeof raw.maxEffectPopupsOnScreen === 'number' &&
      Number.isFinite(raw.maxEffectPopupsOnScreen) &&
      raw.maxEffectPopupsOnScreen >= PLAYER_VISUAL_EFFECT_LIMITS.MIN_POPUPS &&
      raw.maxEffectPopupsOnScreen <= PLAYER_VISUAL_EFFECT_LIMITS.MAX_POPUPS_HARD_CAP
    ) {
      out.maxEffectPopupsOnScreen = Math.floor(raw.maxEffectPopupsOnScreen);
    } else {
      errors.push('VISUAL_EFFECTS_INVALID:maxEffectPopupsOnScreen');
    }
  }
  return { ok: errors.length === 0, errors, sanitized: out };
}

/**
 * Resolve effective motion level — `reduceMotion=true` ép visualEffectLevel
 * xuống LOW (nếu đang HIGH/MEDIUM) hoặc giữ OFF.
 */
export function resolveEffectiveMotionLevel(opts: {
  reduceMotion: boolean;
  visualEffectLevel: VisualEffectMotionLevel;
}): VisualEffectMotionLevel {
  if (opts.reduceMotion) {
    if (opts.visualEffectLevel === 'OFF') return 'OFF';
    return 'LOW';
  }
  return opts.visualEffectLevel;
}
