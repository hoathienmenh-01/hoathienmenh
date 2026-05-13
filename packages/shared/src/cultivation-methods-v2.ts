/**
 * Phase 26.3 — Cultivation Method V2 / Công Pháp Progression.
 *
 * Mở rộng hệ công pháp Phase 11.1 (`cultivation-methods.ts`) thành 1 hệ
 * build nhân vật dài hạn, server-authoritative:
 *
 * - 9 phẩm cấp `PHAM → CHI_TON` (kế thừa khái niệm 9 tier như equipment /
 *   alchemy / drop economy).
 * - 6 nhóm `QI / BODY / HYBRID / ELEMENTAL / SECT / FORBIDDEN / SPECIAL`.
 * - 9 hệ `KIM / MOC / THUY / HOA / THO / NONE / MIXED / HUYEN / HON_NGUYEN`.
 * - Mỗi công pháp có `level / star / exp`, baseline + per-level / per-star
 *   stat, passive effects, fragment recipe.
 * - Mảnh công pháp (`method_fragment_<methodKey>`) drop từ Drop Economy V2
 *   theo `materialTier / materialCategory: 'METHOD_FRAGMENT' / sourceHint`
 *   — quái thường rơi mảnh tier thấp với tỉ lệ rất thấp, boss/dungeon là
 *   nguồn chính, world boss / event là nguồn công pháp hiếm.
 *
 * Module này là **pure / deterministic** — server gọi qua
 * `CultivationMethodV2Service` để mutate `CharacterCultivationMethod`
 * row (level, star, equippedSlot) và ghi `MethodUpgradeLog`.
 *
 * Source of truth: `docs/BALANCE_MODEL.md` §26.3 + `docs/AI_HANDOFF_REPORT.md`.
 *
 * KHÔNG xoá `cultivation-methods.ts` (Phase 11.1) — giữ legacy cho
 * backward-compat catalog `CULTIVATION_METHODS` (12 method, expMultiplier
 * cố định, không level). Hệ V2 mới song song qua slot system.
 */
import type { ElementKey } from './combat';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type MethodCategory =
  | 'QI'
  | 'BODY'
  | 'HYBRID'
  | 'ELEMENTAL'
  | 'SECT'
  | 'FORBIDDEN'
  | 'SPECIAL';

export const METHOD_CATEGORIES: readonly MethodCategory[] = [
  'QI',
  'BODY',
  'HYBRID',
  'ELEMENTAL',
  'SECT',
  'FORBIDDEN',
  'SPECIAL',
] as const;

export type MethodElement =
  | 'KIM'
  | 'MOC'
  | 'THUY'
  | 'HOA'
  | 'THO'
  | 'NONE'
  | 'MIXED'
  | 'HUYEN'
  | 'HON_NGUYEN';

export const METHOD_ELEMENTS: readonly MethodElement[] = [
  'KIM',
  'MOC',
  'THUY',
  'HOA',
  'THO',
  'NONE',
  'MIXED',
  'HUYEN',
  'HON_NGUYEN',
] as const;

/**
 * 9-tier method grade — đồng bộ với `materialTier` (1..9) trong Drop Economy V2.
 * Tier 1 = PHAM (cơ bản, có thể nhận từ quest / NPC shop) — tier 9 = CHI_TON
 * (endgame, mảnh chỉ rơi từ world boss / event).
 */
export type MethodGrade =
  | 'PHAM'
  | 'LINH'
  | 'HUYEN'
  | 'DIA'
  | 'THIEN'
  | 'TIEN'
  | 'THAN'
  | 'DAO'
  | 'CHI_TON';

export const METHOD_GRADES: readonly MethodGrade[] = [
  'PHAM',
  'LINH',
  'HUYEN',
  'DIA',
  'THIEN',
  'TIEN',
  'THAN',
  'DAO',
  'CHI_TON',
] as const;

const METHOD_GRADE_BY_TIER: Record<number, MethodGrade> = {
  1: 'PHAM',
  2: 'LINH',
  3: 'HUYEN',
  4: 'DIA',
  5: 'THIEN',
  6: 'TIEN',
  7: 'THAN',
  8: 'DAO',
  9: 'CHI_TON',
};

export function methodGradeForTier(tier: number): MethodGrade {
  const clamp = Math.max(1, Math.min(9, Math.floor(tier)));
  return METHOD_GRADE_BY_TIER[clamp]!;
}

export type MethodSource =
  | 'STARTER'
  | 'MAIN_QUEST'
  | 'SIDE_QUEST'
  | 'NPC_SHOP'
  | 'SECT_SHOP'
  | 'DUNGEON_DROP'
  | 'BOSS_DROP'
  | 'WORLD_BOSS'
  | 'EVENT'
  | 'MARKET'
  | 'FRAGMENT_COMBINE'
  | 'ADMIN_ONLY';

export const METHOD_SOURCES: readonly MethodSource[] = [
  'STARTER',
  'MAIN_QUEST',
  'SIDE_QUEST',
  'NPC_SHOP',
  'SECT_SHOP',
  'DUNGEON_DROP',
  'BOSS_DROP',
  'WORLD_BOSS',
  'EVENT',
  'MARKET',
  'FRAGMENT_COMBINE',
  'ADMIN_ONLY',
] as const;

/**
 * Equip slot V2 — character có thể equip nhiều công pháp đồng thời, mỗi
 * slot 1 method:
 *   - `QI_MAIN`: công pháp chính Luyện Khí, wire vào cultivation rate.
 *   - `BODY_MAIN`: công pháp chính Luyện Thể, wire vào body cultivation rate.
 *   - `SUPPORT`: công pháp phụ trợ (1 slot khi đã mở), cộng nhẹ stat combat.
 *   - `SECT`: công pháp tông môn, cần `SECT` category + cùng sect.
 *   - `SPECIAL`: công pháp đặc biệt (Forbidden / Chí Tôn / Hỗn Nguyên).
 *
 * Đồng bộ với `CharacterCultivationMethod.equippedSlot` (Prisma).
 */
export type MethodEquipSlot =
  | 'QI_MAIN'
  | 'BODY_MAIN'
  | 'SUPPORT'
  | 'SECT'
  | 'SPECIAL';

export const METHOD_EQUIP_SLOTS: readonly MethodEquipSlot[] = [
  'QI_MAIN',
  'BODY_MAIN',
  'SUPPORT',
  'SECT',
  'SPECIAL',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Stat scaling block — tất cả field optional, đơn vị **percent** (vd `12`
 * = +12%). Method final stat compose:
 *   final = base + perLevel × (level - 1) + perStar × star
 * Stat compose `qiExpMul = 1 + finalQiExpPercent/100` (capped — xem cap
 * bên dưới).
 */
export interface MethodStatScaling {
  qiExpPercent?: number;
  bodyExpPercent?: number;
  hpMaxPercent?: number;
  mpMaxPercent?: number;
  atkPercent?: number;
  defPercent?: number;
  spiritPercent?: number;
  staminaMaxPercent?: number;
  bossDamageReduction?: number;
  /** Element damage bonus fraction (vd `0.05` = +5%). */
  elementalAtkBonus?: number;
  /** Cultivation tribulation support bonus (capped composition). */
  tribulationSupport?: number;
}

export interface MethodUpgradeMaterial {
  itemKey: string;
  qty: number;
}

export interface MethodBreakthroughMaterial {
  itemKey: string;
  qty: number;
  /** Trigger ở level `atLevel` (1-indexed) — phải khớp `maxLevel` hoặc các mốc. */
  atLevel: number;
}

export interface MethodPassiveEffect {
  key: string;
  description: string;
}

export interface CultivationMethodV2Def {
  key: string;
  name: string;
  description: string;
  lore?: string;
  category: MethodCategory;
  element: MethodElement;
  /** Subordinate Ngũ Hành element nếu `element === 'MIXED'`. */
  subElement?: ElementKey | null;
  grade: MethodGrade;
  /** 1..9 — đồng bộ với materialTier trong Drop Economy V2. */
  tier: number;
  unlockRealmOrder: number;
  /** Body realm requirement nếu là BODY/HYBRID, default 0. */
  unlockBodyRealmOrder?: number;
  /** Sect-locked method — set `'thanh_van' / 'huyen_thuy' / 'tu_la'`; null = open. */
  requiredSect?: string | null;
  maxLevel: number;
  maxStar: number;
  /** Fragment item key — `method_fragment_<methodKey>`. Auto-derived ở `fragmentItemKey()`. */
  fragmentItemKey: string;
  /** Số mảnh cần để unlock (sau khi `STARTER` => 0). */
  fragmentsRequired: number;
  /** Số mảnh cần để star-up (mỗi sao). */
  fragmentsPerStar: number;
  /** Nguyên liệu nâng cấp 1 level (level → level+1). Linh thạch tính riêng. */
  upgradeMaterials: readonly MethodUpgradeMaterial[];
  /** Nguyên liệu đột phá ở mốc cụ thể (level breakthrough). */
  breakthroughMaterials: readonly MethodBreakthroughMaterial[];
  baseStats: MethodStatScaling;
  perLevelStats: MethodStatScaling;
  perStarStats: MethodStatScaling;
  passiveEffects: readonly MethodPassiveEffect[];
  sourceHint: readonly MethodSource[];
  /** Mặc định slot khi equip lần đầu. */
  primarySlot: MethodEquipSlot;
  /** Slot phụ được phép — character có thể chuyển method qua slot khác. */
  allowedSlots: readonly MethodEquipSlot[];
  /** Có thể trade qua market? Endgame thường false. */
  tradeable: boolean;
  /** Bind khi unlock — không trade được sau khi đã unlock. */
  bindOnUnlock: boolean;
  enabled: boolean;
  /** Linh thạch cost mỗi lần unlock — 0 cho starter. */
  unlockLinhThachCost: number;
}

// ---------------------------------------------------------------------------
// Helper builders
// ---------------------------------------------------------------------------

export function methodFragmentItemKey(methodKey: string): string {
  return `method_fragment_${methodKey}`;
}

/**
 * Convert MethodElement → ElementKey (Ngũ Hành thuần). Trả `null` cho
 * `NONE / MIXED / HUYEN / HON_NGUYEN`.
 */
export function methodElementToElementKey(element: MethodElement): ElementKey | null {
  switch (element) {
    case 'KIM':
      return 'kim';
    case 'MOC':
      return 'moc';
    case 'THUY':
      return 'thuy';
    case 'HOA':
      return 'hoa';
    case 'THO':
      return 'tho';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Per-tier balance defaults
// ---------------------------------------------------------------------------

/**
 * Defaults cho mỗi tier — dùng làm baseline khi viết catalog. Có thể
 * override per-method nếu cần.
 */
interface TierBaseline {
  maxLevel: number;
  maxStar: number;
  fragmentsRequired: number;
  fragmentsPerStar: number;
  unlockLinhThachCost: number;
  unlockRealmOrder: number;
}

const TIER_BASELINE: Readonly<Record<number, TierBaseline>> = {
  1: { maxLevel: 10, maxStar: 3, fragmentsRequired: 10, fragmentsPerStar: 6, unlockLinhThachCost: 0, unlockRealmOrder: 0 },
  2: { maxLevel: 12, maxStar: 3, fragmentsRequired: 18, fragmentsPerStar: 10, unlockLinhThachCost: 800, unlockRealmOrder: 2 },
  3: { maxLevel: 15, maxStar: 4, fragmentsRequired: 28, fragmentsPerStar: 14, unlockLinhThachCost: 2_500, unlockRealmOrder: 3 },
  4: { maxLevel: 18, maxStar: 4, fragmentsRequired: 40, fragmentsPerStar: 18, unlockLinhThachCost: 8_000, unlockRealmOrder: 4 },
  5: { maxLevel: 22, maxStar: 5, fragmentsRequired: 55, fragmentsPerStar: 22, unlockLinhThachCost: 22_000, unlockRealmOrder: 6 },
  6: { maxLevel: 25, maxStar: 5, fragmentsRequired: 70, fragmentsPerStar: 28, unlockLinhThachCost: 60_000, unlockRealmOrder: 9 },
  7: { maxLevel: 30, maxStar: 6, fragmentsRequired: 90, fragmentsPerStar: 36, unlockLinhThachCost: 150_000, unlockRealmOrder: 13 },
  8: { maxLevel: 35, maxStar: 6, fragmentsRequired: 120, fragmentsPerStar: 45, unlockLinhThachCost: 360_000, unlockRealmOrder: 17 },
  9: { maxLevel: 40, maxStar: 7, fragmentsRequired: 150, fragmentsPerStar: 60, unlockLinhThachCost: 800_000, unlockRealmOrder: 21 },
};

export function tierBaseline(tier: number): TierBaseline {
  const t = Math.max(1, Math.min(9, Math.floor(tier)));
  return TIER_BASELINE[t]!;
}

/**
 * Linh thạch cost cho mỗi lần upgrade level → level+1 — scale theo
 * `tier` × `(level + 1)`. Phải monotonic tăng (test ép invariant).
 */
export function methodUpgradeLinhThachCost(tier: number, level: number): number {
  const t = Math.max(1, Math.min(9, Math.floor(tier)));
  const l = Math.max(1, Math.floor(level));
  const base = 40 * Math.pow(2.1, t - 1);
  return Math.round(base * (l + 1));
}

/**
 * EXP cost cho mỗi lần level-up (sau khi đã pay material/linhThach).
 * Pure scale theo tier × level. Caller dùng để check method có đủ
 * `methodExp` không.
 */
export function methodUpgradeExpCost(tier: number, level: number): bigint {
  const t = Math.max(1, Math.min(9, Math.floor(tier)));
  const l = Math.max(1, Math.floor(level));
  const base = 60 * Math.pow(1.85, t - 1);
  return BigInt(Math.round(base * (l + 1) * 5));
}

// ---------------------------------------------------------------------------
// Stat compose
// ---------------------------------------------------------------------------

/**
 * Compose 1 method stat tại `level / star`:
 *   final = base + perLevel × (level - 1) + perStar × star
 */
export function computeMethodStatBonus(
  def: CultivationMethodV2Def,
  level: number,
  star: number,
): MethodStatScaling {
  const lvl = Math.max(1, Math.min(def.maxLevel, Math.floor(level)));
  const st = Math.max(0, Math.min(def.maxStar, Math.floor(star)));
  const lvlMul = lvl - 1;
  const out: MethodStatScaling = {};
  const keys: ReadonlyArray<keyof MethodStatScaling> = [
    'qiExpPercent',
    'bodyExpPercent',
    'hpMaxPercent',
    'mpMaxPercent',
    'atkPercent',
    'defPercent',
    'spiritPercent',
    'staminaMaxPercent',
    'bossDamageReduction',
    'elementalAtkBonus',
    'tribulationSupport',
  ];
  for (const k of keys) {
    const b = def.baseStats[k] ?? 0;
    const pl = def.perLevelStats[k] ?? 0;
    const ps = def.perStarStats[k] ?? 0;
    const v = b + pl * lvlMul + ps * st;
    if (v !== 0) out[k] = Number(v.toFixed(4));
  }
  return out;
}

/**
 * Snapshot tổng hợp các method đang equip — dùng để wire vào cultivation
 * processor / body processor / combat snapshot.
 */
export interface EquippedMethodSnapshotEntry {
  def: CultivationMethodV2Def;
  level: number;
  star: number;
  slot: MethodEquipSlot;
}

export interface AggregatedMethodBonuses {
  qiExpPercent: number;
  bodyExpPercent: number;
  hpMaxPercent: number;
  mpMaxPercent: number;
  atkPercent: number;
  defPercent: number;
  spiritPercent: number;
  staminaMaxPercent: number;
  bossDamageReduction: number;
  elementalAtkBonus: number;
  tribulationSupport: number;
}

const EMPTY_AGG: AggregatedMethodBonuses = {
  qiExpPercent: 0,
  bodyExpPercent: 0,
  hpMaxPercent: 0,
  mpMaxPercent: 0,
  atkPercent: 0,
  defPercent: 0,
  spiritPercent: 0,
  staminaMaxPercent: 0,
  bossDamageReduction: 0,
  elementalAtkBonus: 0,
  tribulationSupport: 0,
};

// Caps chống lạm phát — tham chiếu `docs/BALANCE_MODEL.md` §26.3.
export const METHOD_BONUS_CAPS = {
  qiExpPercent: 200,
  bodyExpPercent: 180,
  hpMaxPercent: 60,
  mpMaxPercent: 60,
  atkPercent: 40,
  defPercent: 40,
  spiritPercent: 50,
  staminaMaxPercent: 40,
  bossDamageReduction: 0.3,
  elementalAtkBonus: 0.25,
  tribulationSupport: 0.25,
} as const;

export function aggregateEquippedMethods(
  entries: readonly EquippedMethodSnapshotEntry[],
): AggregatedMethodBonuses {
  if (entries.length === 0) return { ...EMPTY_AGG };
  const out: AggregatedMethodBonuses = { ...EMPTY_AGG };
  for (const entry of entries) {
    const stats = computeMethodStatBonus(entry.def, entry.level, entry.star);
    out.qiExpPercent += stats.qiExpPercent ?? 0;
    out.bodyExpPercent += stats.bodyExpPercent ?? 0;
    out.hpMaxPercent += stats.hpMaxPercent ?? 0;
    out.mpMaxPercent += stats.mpMaxPercent ?? 0;
    out.atkPercent += stats.atkPercent ?? 0;
    out.defPercent += stats.defPercent ?? 0;
    out.spiritPercent += stats.spiritPercent ?? 0;
    out.staminaMaxPercent += stats.staminaMaxPercent ?? 0;
    out.bossDamageReduction += stats.bossDamageReduction ?? 0;
    out.elementalAtkBonus += stats.elementalAtkBonus ?? 0;
    out.tribulationSupport += stats.tribulationSupport ?? 0;
  }
  out.qiExpPercent = Math.min(METHOD_BONUS_CAPS.qiExpPercent, out.qiExpPercent);
  out.bodyExpPercent = Math.min(METHOD_BONUS_CAPS.bodyExpPercent, out.bodyExpPercent);
  out.hpMaxPercent = Math.min(METHOD_BONUS_CAPS.hpMaxPercent, out.hpMaxPercent);
  out.mpMaxPercent = Math.min(METHOD_BONUS_CAPS.mpMaxPercent, out.mpMaxPercent);
  out.atkPercent = Math.min(METHOD_BONUS_CAPS.atkPercent, out.atkPercent);
  out.defPercent = Math.min(METHOD_BONUS_CAPS.defPercent, out.defPercent);
  out.spiritPercent = Math.min(METHOD_BONUS_CAPS.spiritPercent, out.spiritPercent);
  out.staminaMaxPercent = Math.min(
    METHOD_BONUS_CAPS.staminaMaxPercent,
    out.staminaMaxPercent,
  );
  out.bossDamageReduction = Math.min(
    METHOD_BONUS_CAPS.bossDamageReduction,
    out.bossDamageReduction,
  );
  out.elementalAtkBonus = Math.min(
    METHOD_BONUS_CAPS.elementalAtkBonus,
    out.elementalAtkBonus,
  );
  out.tribulationSupport = Math.min(
    METHOD_BONUS_CAPS.tribulationSupport,
    out.tribulationSupport,
  );
  return out;
}

/**
 * Convenience helpers cho runtime — trả về multiplier `≥ 1.0` để compose.
 */
export function computeMethodCultivationRateBonus(
  entries: readonly EquippedMethodSnapshotEntry[],
): number {
  const agg = aggregateEquippedMethods(entries);
  return 1 + agg.qiExpPercent / 100;
}

export function computeMethodBodyRateBonus(
  entries: readonly EquippedMethodSnapshotEntry[],
): number {
  const agg = aggregateEquippedMethods(entries);
  return 1 + agg.bodyExpPercent / 100;
}

export function computeMethodElementalBonus(
  entries: readonly EquippedMethodSnapshotEntry[],
): number {
  const agg = aggregateEquippedMethods(entries);
  return Math.max(0, agg.elementalAtkBonus);
}

// ---------------------------------------------------------------------------
// Slot / equip validation
// ---------------------------------------------------------------------------

export type CanEquipResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'METHOD_DISABLED'
        | 'NOT_UNLOCKED'
        | 'REALM_TOO_LOW'
        | 'BODY_REALM_TOO_LOW'
        | 'WRONG_SECT'
        | 'SLOT_NOT_ALLOWED'
        | 'SLOT_CONFLICT'
        | 'ELEMENT_CONFLICT';
    };

export interface CharacterEquipContext {
  realmOrder: number;
  bodyRealmOrder: number;
  sectKey: string | null;
  unlocked: boolean;
  /** Method đang occupy slot này (nếu khác key) → conflict. */
  occupyingMethodKey: string | null;
}

export function canEquipMethod(
  def: CultivationMethodV2Def,
  slot: MethodEquipSlot,
  ctx: CharacterEquipContext,
): CanEquipResult {
  if (!def.enabled) return { ok: false, code: 'METHOD_DISABLED' };
  if (!ctx.unlocked) return { ok: false, code: 'NOT_UNLOCKED' };
  if (!def.allowedSlots.includes(slot)) {
    return { ok: false, code: 'SLOT_NOT_ALLOWED' };
  }
  if (ctx.realmOrder < def.unlockRealmOrder) {
    return { ok: false, code: 'REALM_TOO_LOW' };
  }
  if (
    def.unlockBodyRealmOrder !== undefined &&
    ctx.bodyRealmOrder < def.unlockBodyRealmOrder
  ) {
    return { ok: false, code: 'BODY_REALM_TOO_LOW' };
  }
  if (def.requiredSect && ctx.sectKey !== def.requiredSect) {
    return { ok: false, code: 'WRONG_SECT' };
  }
  if (ctx.occupyingMethodKey && ctx.occupyingMethodKey !== def.key) {
    return { ok: false, code: 'SLOT_CONFLICT' };
  }
  return { ok: true };
}

export type CanUpgradeResult =
  | { ok: true }
  | { ok: false; code: 'NOT_UNLOCKED' | 'MAX_LEVEL' | 'INSUFFICIENT_EXP' };

export function canUpgradeMethod(
  def: CultivationMethodV2Def,
  state: { unlocked: boolean; level: number; methodExp: bigint },
): CanUpgradeResult {
  if (!state.unlocked) return { ok: false, code: 'NOT_UNLOCKED' };
  if (state.level >= def.maxLevel) return { ok: false, code: 'MAX_LEVEL' };
  const need = methodUpgradeExpCost(def.tier, state.level);
  if (state.methodExp < need) return { ok: false, code: 'INSUFFICIENT_EXP' };
  return { ok: true };
}

export type CanStarUpResult =
  | { ok: true }
  | { ok: false; code: 'NOT_UNLOCKED' | 'MAX_STAR' | 'INSUFFICIENT_FRAGMENTS' };

export function canStarUpMethod(
  def: CultivationMethodV2Def,
  state: { unlocked: boolean; star: number; fragmentsOwned: number },
): CanStarUpResult {
  if (!state.unlocked) return { ok: false, code: 'NOT_UNLOCKED' };
  if (state.star >= def.maxStar) return { ok: false, code: 'MAX_STAR' };
  if (state.fragmentsOwned < def.fragmentsPerStar) {
    return { ok: false, code: 'INSUFFICIENT_FRAGMENTS' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Catalog builder helpers
// ---------------------------------------------------------------------------

function qiMethod(
  key: string,
  name: string,
  description: string,
  tier: number,
  options: Partial<CultivationMethodV2Def> = {},
): CultivationMethodV2Def {
  const base = tierBaseline(tier);
  return {
    key,
    name,
    description,
    lore: options.lore ?? `Công pháp Luyện Khí phẩm cấp ${methodGradeForTier(tier)}.`,
    category: 'QI',
    element: options.element ?? 'NONE',
    subElement: options.subElement ?? null,
    grade: methodGradeForTier(tier),
    tier,
    unlockRealmOrder: options.unlockRealmOrder ?? base.unlockRealmOrder,
    unlockBodyRealmOrder: options.unlockBodyRealmOrder,
    requiredSect: options.requiredSect ?? null,
    maxLevel: options.maxLevel ?? base.maxLevel,
    maxStar: options.maxStar ?? base.maxStar,
    fragmentItemKey: methodFragmentItemKey(key),
    fragmentsRequired: options.fragmentsRequired ?? base.fragmentsRequired,
    fragmentsPerStar: options.fragmentsPerStar ?? base.fragmentsPerStar,
    upgradeMaterials: options.upgradeMaterials ?? defaultQiUpgradeMaterials(tier),
    breakthroughMaterials:
      options.breakthroughMaterials ?? defaultQiBreakthroughMaterials(tier, options.maxLevel ?? base.maxLevel),
    baseStats: options.baseStats ?? {
      qiExpPercent: 4 + tier * 2,
      mpMaxPercent: 2 + tier,
      spiritPercent: 1 + tier,
    },
    perLevelStats: options.perLevelStats ?? {
      qiExpPercent: 0.5 + tier * 0.18,
      mpMaxPercent: 0.4 + tier * 0.12,
      spiritPercent: 0.2 + tier * 0.08,
    },
    perStarStats: options.perStarStats ?? {
      qiExpPercent: 2 + tier * 0.6,
      atkPercent: 1 + tier * 0.4,
      mpMaxPercent: 1 + tier * 0.4,
    },
    passiveEffects: options.passiveEffects ?? [],
    sourceHint: options.sourceHint ?? defaultQiSource(tier),
    primarySlot: options.primarySlot ?? 'QI_MAIN',
    allowedSlots: options.allowedSlots ?? ['QI_MAIN', 'SUPPORT'],
    tradeable: options.tradeable ?? tier <= 5,
    bindOnUnlock: options.bindOnUnlock ?? tier >= 6,
    enabled: options.enabled ?? true,
    unlockLinhThachCost: options.unlockLinhThachCost ?? base.unlockLinhThachCost,
  };
}

function bodyMethod(
  key: string,
  name: string,
  description: string,
  tier: number,
  options: Partial<CultivationMethodV2Def> = {},
): CultivationMethodV2Def {
  const base = tierBaseline(tier);
  return {
    key,
    name,
    description,
    lore: options.lore ?? `Công pháp Luyện Thể phẩm cấp ${methodGradeForTier(tier)}.`,
    category: 'BODY',
    element: options.element ?? 'NONE',
    subElement: options.subElement ?? null,
    grade: methodGradeForTier(tier),
    tier,
    unlockRealmOrder: options.unlockRealmOrder ?? base.unlockRealmOrder,
    unlockBodyRealmOrder:
      options.unlockBodyRealmOrder ?? Math.max(0, base.unlockRealmOrder - 1),
    requiredSect: options.requiredSect ?? null,
    maxLevel: options.maxLevel ?? base.maxLevel,
    maxStar: options.maxStar ?? base.maxStar,
    fragmentItemKey: methodFragmentItemKey(key),
    fragmentsRequired: options.fragmentsRequired ?? base.fragmentsRequired,
    fragmentsPerStar: options.fragmentsPerStar ?? base.fragmentsPerStar,
    upgradeMaterials: options.upgradeMaterials ?? defaultBodyUpgradeMaterials(tier),
    breakthroughMaterials:
      options.breakthroughMaterials ?? defaultBodyBreakthroughMaterials(tier, options.maxLevel ?? base.maxLevel),
    baseStats: options.baseStats ?? {
      bodyExpPercent: 4 + tier * 2,
      hpMaxPercent: 3 + tier * 1.2,
      defPercent: 2 + tier * 0.6,
      staminaMaxPercent: 1 + tier * 0.6,
    },
    perLevelStats: options.perLevelStats ?? {
      bodyExpPercent: 0.5 + tier * 0.18,
      hpMaxPercent: 0.4 + tier * 0.14,
      defPercent: 0.3 + tier * 0.1,
    },
    perStarStats: options.perStarStats ?? {
      bodyExpPercent: 1.6 + tier * 0.5,
      hpMaxPercent: 1.2 + tier * 0.5,
      defPercent: 1 + tier * 0.4,
      bossDamageReduction: 0.005 + tier * 0.002,
    },
    passiveEffects: options.passiveEffects ?? [],
    sourceHint: options.sourceHint ?? defaultBodySource(tier),
    primarySlot: options.primarySlot ?? 'BODY_MAIN',
    allowedSlots: options.allowedSlots ?? ['BODY_MAIN', 'SUPPORT'],
    tradeable: options.tradeable ?? tier <= 5,
    bindOnUnlock: options.bindOnUnlock ?? tier >= 6,
    enabled: options.enabled ?? true,
    unlockLinhThachCost: options.unlockLinhThachCost ?? base.unlockLinhThachCost,
  };
}

function elementalMethod(
  key: string,
  name: string,
  description: string,
  tier: number,
  element: MethodElement,
  options: Partial<CultivationMethodV2Def> = {},
): CultivationMethodV2Def {
  const base = tierBaseline(tier);
  return {
    key,
    name,
    description,
    lore: options.lore ?? `Công pháp Ngũ Hành hệ ${element} phẩm cấp ${methodGradeForTier(tier)}.`,
    category: 'ELEMENTAL',
    element,
    subElement: options.subElement ?? methodElementToElementKey(element),
    grade: methodGradeForTier(tier),
    tier,
    unlockRealmOrder: options.unlockRealmOrder ?? base.unlockRealmOrder,
    unlockBodyRealmOrder: options.unlockBodyRealmOrder,
    requiredSect: options.requiredSect ?? null,
    maxLevel: options.maxLevel ?? base.maxLevel,
    maxStar: options.maxStar ?? base.maxStar,
    fragmentItemKey: methodFragmentItemKey(key),
    fragmentsRequired: options.fragmentsRequired ?? base.fragmentsRequired,
    fragmentsPerStar: options.fragmentsPerStar ?? base.fragmentsPerStar,
    upgradeMaterials: options.upgradeMaterials ?? defaultElementalUpgradeMaterials(tier, element),
    breakthroughMaterials:
      options.breakthroughMaterials ??
      defaultElementalBreakthroughMaterials(tier, options.maxLevel ?? base.maxLevel),
    baseStats: options.baseStats ?? defaultElementalBaseStats(element, tier),
    perLevelStats: options.perLevelStats ?? defaultElementalPerLevelStats(element, tier),
    perStarStats: options.perStarStats ?? defaultElementalPerStarStats(element, tier),
    passiveEffects: options.passiveEffects ?? [],
    sourceHint: options.sourceHint ?? defaultElementalSource(tier),
    primarySlot: options.primarySlot ?? 'SUPPORT',
    allowedSlots: options.allowedSlots ?? ['QI_MAIN', 'BODY_MAIN', 'SUPPORT'],
    tradeable: options.tradeable ?? tier <= 5,
    bindOnUnlock: options.bindOnUnlock ?? tier >= 6,
    enabled: options.enabled ?? true,
    unlockLinhThachCost: options.unlockLinhThachCost ?? base.unlockLinhThachCost,
  };
}

function hybridMethod(
  key: string,
  name: string,
  description: string,
  tier: number,
  options: Partial<CultivationMethodV2Def> = {},
): CultivationMethodV2Def {
  const base = tierBaseline(tier);
  return {
    key,
    name,
    description,
    lore: options.lore ?? `Công pháp song tu phẩm cấp ${methodGradeForTier(tier)}.`,
    category: 'HYBRID',
    element: options.element ?? 'MIXED',
    subElement: options.subElement ?? null,
    grade: methodGradeForTier(tier),
    tier,
    unlockRealmOrder: options.unlockRealmOrder ?? base.unlockRealmOrder,
    unlockBodyRealmOrder:
      options.unlockBodyRealmOrder ?? Math.max(0, base.unlockRealmOrder - 1),
    requiredSect: options.requiredSect ?? null,
    maxLevel: options.maxLevel ?? base.maxLevel,
    maxStar: options.maxStar ?? base.maxStar,
    fragmentItemKey: methodFragmentItemKey(key),
    fragmentsRequired: options.fragmentsRequired ?? Math.round(base.fragmentsRequired * 1.15),
    fragmentsPerStar: options.fragmentsPerStar ?? Math.round(base.fragmentsPerStar * 1.2),
    upgradeMaterials: options.upgradeMaterials ?? defaultHybridUpgradeMaterials(tier),
    breakthroughMaterials:
      options.breakthroughMaterials ?? defaultHybridBreakthroughMaterials(tier, options.maxLevel ?? base.maxLevel),
    baseStats: options.baseStats ?? {
      qiExpPercent: 3 + tier * 1.2,
      bodyExpPercent: 3 + tier * 1.2,
      hpMaxPercent: 2 + tier * 0.6,
      defPercent: 1 + tier * 0.4,
      mpMaxPercent: 1 + tier * 0.4,
    },
    perLevelStats: options.perLevelStats ?? {
      qiExpPercent: 0.3 + tier * 0.1,
      bodyExpPercent: 0.3 + tier * 0.1,
      hpMaxPercent: 0.2 + tier * 0.08,
      defPercent: 0.1 + tier * 0.06,
    },
    perStarStats: options.perStarStats ?? {
      qiExpPercent: 1.3 + tier * 0.35,
      bodyExpPercent: 1.3 + tier * 0.35,
      atkPercent: 0.8 + tier * 0.3,
      defPercent: 0.8 + tier * 0.3,
    },
    passiveEffects: options.passiveEffects ?? [],
    sourceHint: options.sourceHint ?? defaultHybridSource(tier),
    primarySlot: options.primarySlot ?? 'SUPPORT',
    allowedSlots: options.allowedSlots ?? ['QI_MAIN', 'BODY_MAIN', 'SUPPORT'],
    tradeable: options.tradeable ?? tier <= 4,
    bindOnUnlock: options.bindOnUnlock ?? tier >= 5,
    enabled: options.enabled ?? true,
    unlockLinhThachCost:
      options.unlockLinhThachCost ?? Math.round(base.unlockLinhThachCost * 1.15),
  };
}

function specialMethod(
  key: string,
  name: string,
  description: string,
  tier: number,
  options: Partial<CultivationMethodV2Def> = {},
): CultivationMethodV2Def {
  const base = tierBaseline(tier);
  return {
    key,
    name,
    description,
    lore: options.lore ?? `Công pháp Đặc biệt phẩm cấp ${methodGradeForTier(tier)}.`,
    category: options.category ?? 'SPECIAL',
    element: options.element ?? 'HON_NGUYEN',
    subElement: options.subElement ?? null,
    grade: methodGradeForTier(tier),
    tier,
    unlockRealmOrder: options.unlockRealmOrder ?? base.unlockRealmOrder,
    unlockBodyRealmOrder: options.unlockBodyRealmOrder,
    requiredSect: options.requiredSect ?? null,
    maxLevel: options.maxLevel ?? base.maxLevel,
    maxStar: options.maxStar ?? base.maxStar,
    fragmentItemKey: methodFragmentItemKey(key),
    fragmentsRequired: options.fragmentsRequired ?? Math.round(base.fragmentsRequired * 1.2),
    fragmentsPerStar: options.fragmentsPerStar ?? Math.round(base.fragmentsPerStar * 1.2),
    upgradeMaterials: options.upgradeMaterials ?? defaultSpecialUpgradeMaterials(tier),
    breakthroughMaterials:
      options.breakthroughMaterials ?? defaultSpecialBreakthroughMaterials(tier, options.maxLevel ?? base.maxLevel),
    baseStats: options.baseStats ?? {
      qiExpPercent: 6 + tier,
      bodyExpPercent: 4 + tier * 0.6,
      atkPercent: 3 + tier * 0.6,
      defPercent: 3 + tier * 0.6,
      tribulationSupport: 0.02 + tier * 0.005,
    },
    perLevelStats: options.perLevelStats ?? {
      qiExpPercent: 0.4 + tier * 0.12,
      bodyExpPercent: 0.3 + tier * 0.1,
      atkPercent: 0.2 + tier * 0.06,
      defPercent: 0.2 + tier * 0.06,
    },
    perStarStats: options.perStarStats ?? {
      qiExpPercent: 2 + tier * 0.5,
      bodyExpPercent: 1.4 + tier * 0.4,
      atkPercent: 1.2 + tier * 0.4,
      defPercent: 1.2 + tier * 0.4,
      tribulationSupport: 0.01 + tier * 0.003,
    },
    passiveEffects: options.passiveEffects ?? [],
    sourceHint: options.sourceHint ?? defaultSpecialSource(tier),
    primarySlot: options.primarySlot ?? 'SPECIAL',
    allowedSlots: options.allowedSlots ?? ['SPECIAL', 'SUPPORT'],
    tradeable: options.tradeable ?? false,
    bindOnUnlock: options.bindOnUnlock ?? true,
    enabled: options.enabled ?? true,
    unlockLinhThachCost:
      options.unlockLinhThachCost ?? Math.round(base.unlockLinhThachCost * 1.25),
  };
}

// ---------------------------------------------------------------------------
// Default upgrade/breakthrough material packs (reuse existing items.ts keys)
// ---------------------------------------------------------------------------

function defaultQiUpgradeMaterials(tier: number): MethodUpgradeMaterial[] {
  if (tier <= 1) return [{ itemKey: 'linh_thao_t1', qty: 4 }];
  if (tier <= 2) return [{ itemKey: 'truc_tam_thao_t2', qty: 6 }];
  if (tier <= 3) return [{ itemKey: 'kim_lien_tu_t3', qty: 6 }];
  if (tier <= 4) return [{ itemKey: 'anh_nguyen_hoa_t4', qty: 8 }];
  if (tier <= 5) return [{ itemKey: 'hu_khong_sa_t5', qty: 6 }];
  if (tier <= 6) return [{ itemKey: 'hu_khong_sa_t5', qty: 10 }];
  if (tier <= 7) return [{ itemKey: 'hu_khong_sa_t5', qty: 14 }];
  if (tier <= 8) return [{ itemKey: 'hu_khong_sa_t5', qty: 18 }];
  return [{ itemKey: 'hu_khong_sa_t5', qty: 24 }];
}

function defaultQiBreakthroughMaterials(
  tier: number,
  maxLevel: number,
): MethodBreakthroughMaterial[] {
  const mid = Math.max(2, Math.floor(maxLevel / 2));
  return [
    { itemKey: 'yeu_dan_non_t2', qty: 2 + tier, atLevel: mid },
    { itemKey: 'yeu_dan_t3', qty: 1 + tier, atLevel: maxLevel },
  ];
}

function defaultBodyUpgradeMaterials(tier: number): MethodUpgradeMaterial[] {
  if (tier <= 1) return [{ itemKey: 'khi_huyet_thao_t1', qty: 4 }];
  if (tier <= 2) return [{ itemKey: 'doan_cot_thach_t2', qty: 6 }];
  if (tier <= 3) return [{ itemKey: 'tay_tuy_dich_t3', qty: 6 }];
  if (tier <= 4) return [{ itemKey: 'kim_than_tinh_t4', qty: 8 }];
  if (tier <= 5) return [{ itemKey: 'kim_than_tinh_t4', qty: 12 }];
  if (tier <= 6) return [{ itemKey: 'kim_than_tinh_t4', qty: 16 }];
  if (tier <= 7) return [{ itemKey: 'kim_than_tinh_t4', qty: 20 }];
  if (tier <= 8) return [{ itemKey: 'kim_than_tinh_t4', qty: 26 }];
  return [{ itemKey: 'kim_than_tinh_t4', qty: 32 }];
}

function defaultBodyBreakthroughMaterials(
  tier: number,
  maxLevel: number,
): MethodBreakthroughMaterial[] {
  const mid = Math.max(2, Math.floor(maxLevel / 2));
  return [
    { itemKey: 'doan_cot_thach_t2', qty: 2 + tier, atLevel: mid },
    { itemKey: 'tay_tuy_dich_t3', qty: 1 + tier, atLevel: maxLevel },
  ];
}

function defaultElementalUpgradeMaterials(
  tier: number,
  element: MethodElement,
): MethodUpgradeMaterial[] {
  if (tier <= 2) {
    if (element === 'MOC') return [{ itemKey: 'moc_linh_qua_t2', qty: 5 }];
    if (element === 'THUY') return [{ itemKey: 'han_lo_hoa_t2', qty: 5 }];
    if (element === 'HOA') return [{ itemKey: 'bot_dan_sa_t1', qty: 8 }];
    if (element === 'KIM') return [{ itemKey: 'tinh_thiet_t3', qty: 3 }];
    if (element === 'THO') return [{ itemKey: 'doan_cot_thach_t2', qty: 5 }];
    return [{ itemKey: 'linh_thao_t1', qty: 6 }];
  }
  if (tier <= 4) return [{ itemKey: 'anh_nguyen_hoa_t4', qty: 6 }];
  if (tier <= 6) return [{ itemKey: 'hu_khong_sa_t5', qty: 10 }];
  return [{ itemKey: 'hu_khong_sa_t5', qty: 18 }];
}

function defaultElementalBreakthroughMaterials(
  tier: number,
  maxLevel: number,
): MethodBreakthroughMaterial[] {
  const mid = Math.max(2, Math.floor(maxLevel / 2));
  return [
    { itemKey: 'kim_lien_tu_t3', qty: 2 + tier, atLevel: mid },
    { itemKey: 'hon_tinh_t4', qty: 1 + tier, atLevel: maxLevel },
  ];
}

function defaultHybridUpgradeMaterials(tier: number): MethodUpgradeMaterial[] {
  if (tier <= 2) {
    return [
      { itemKey: 'linh_thao_t1', qty: 4 },
      { itemKey: 'khi_huyet_thao_t1', qty: 4 },
    ];
  }
  if (tier <= 4) {
    return [
      { itemKey: 'kim_lien_tu_t3', qty: 4 },
      { itemKey: 'tay_tuy_dich_t3', qty: 4 },
    ];
  }
  return [
    { itemKey: 'hu_khong_sa_t5', qty: 8 },
    { itemKey: 'kim_than_tinh_t4', qty: 10 },
  ];
}

function defaultHybridBreakthroughMaterials(
  tier: number,
  maxLevel: number,
): MethodBreakthroughMaterial[] {
  const mid = Math.max(2, Math.floor(maxLevel / 2));
  return [
    { itemKey: 'hon_tinh_nho_t3', qty: 2 + tier, atLevel: mid },
    { itemKey: 'linh_hon_sa_t5', qty: 1 + tier, atLevel: maxLevel },
  ];
}

function defaultSpecialUpgradeMaterials(tier: number): MethodUpgradeMaterial[] {
  if (tier <= 4) return [{ itemKey: 'hon_tinh_t4', qty: 4 }];
  if (tier <= 6) return [{ itemKey: 'linh_hon_sa_t5', qty: 6 }];
  return [{ itemKey: 'linh_hon_sa_t5', qty: 12 }];
}

function defaultSpecialBreakthroughMaterials(
  tier: number,
  maxLevel: number,
): MethodBreakthroughMaterial[] {
  const mid = Math.max(2, Math.floor(maxLevel / 2));
  return [
    { itemKey: 'linh_hon_sa_t5', qty: 2 + tier, atLevel: mid },
    { itemKey: 'can_khon_tuy_t5', qty: 1 + tier, atLevel: maxLevel },
  ];
}

// ---------------------------------------------------------------------------
// Default sourceHint per tier — Drop Economy V2 sẽ tự sinh rule cho item
// fragment.
// ---------------------------------------------------------------------------

function defaultQiSource(tier: number): MethodSource[] {
  if (tier <= 1) return ['STARTER', 'NPC_SHOP', 'MAIN_QUEST'];
  if (tier <= 2) return ['NPC_SHOP', 'DUNGEON_DROP', 'MAIN_QUEST'];
  if (tier <= 3) return ['DUNGEON_DROP', 'BOSS_DROP'];
  if (tier <= 4) return ['DUNGEON_DROP', 'BOSS_DROP'];
  if (tier <= 5) return ['BOSS_DROP', 'WORLD_BOSS'];
  if (tier <= 6) return ['BOSS_DROP', 'WORLD_BOSS', 'EVENT'];
  if (tier <= 7) return ['WORLD_BOSS', 'EVENT'];
  return ['WORLD_BOSS', 'EVENT', 'FRAGMENT_COMBINE'];
}

function defaultBodySource(tier: number): MethodSource[] {
  if (tier <= 1) return ['STARTER', 'NPC_SHOP', 'SIDE_QUEST'];
  if (tier <= 2) return ['NPC_SHOP', 'DUNGEON_DROP', 'SIDE_QUEST'];
  if (tier <= 3) return ['DUNGEON_DROP', 'BOSS_DROP'];
  if (tier <= 4) return ['DUNGEON_DROP', 'BOSS_DROP'];
  if (tier <= 5) return ['BOSS_DROP', 'WORLD_BOSS'];
  if (tier <= 6) return ['BOSS_DROP', 'WORLD_BOSS', 'EVENT'];
  if (tier <= 7) return ['WORLD_BOSS', 'EVENT'];
  return ['WORLD_BOSS', 'EVENT', 'FRAGMENT_COMBINE'];
}

function defaultElementalSource(tier: number): MethodSource[] {
  if (tier <= 1) return ['NPC_SHOP', 'DUNGEON_DROP'];
  if (tier <= 3) return ['DUNGEON_DROP', 'BOSS_DROP'];
  if (tier <= 5) return ['BOSS_DROP', 'WORLD_BOSS'];
  if (tier <= 7) return ['BOSS_DROP', 'WORLD_BOSS', 'EVENT'];
  return ['WORLD_BOSS', 'EVENT', 'FRAGMENT_COMBINE'];
}

function defaultHybridSource(tier: number): MethodSource[] {
  if (tier <= 3) return ['DUNGEON_DROP', 'BOSS_DROP'];
  if (tier <= 5) return ['BOSS_DROP', 'WORLD_BOSS'];
  if (tier <= 7) return ['WORLD_BOSS', 'EVENT'];
  return ['WORLD_BOSS', 'EVENT', 'FRAGMENT_COMBINE'];
}

function defaultSpecialSource(tier: number): MethodSource[] {
  if (tier <= 4) return ['BOSS_DROP', 'EVENT'];
  if (tier <= 6) return ['WORLD_BOSS', 'EVENT'];
  return ['WORLD_BOSS', 'EVENT', 'FRAGMENT_COMBINE'];
}

// ---------------------------------------------------------------------------
// Elemental stat blocks — tuned per Ngũ Hành theme.
// ---------------------------------------------------------------------------

function defaultElementalBaseStats(
  element: MethodElement,
  tier: number,
): MethodStatScaling {
  switch (element) {
    case 'KIM':
      return {
        atkPercent: 4 + tier * 1.4,
        defPercent: 1 + tier * 0.5,
        elementalAtkBonus: 0.01 + tier * 0.004,
      };
    case 'MOC':
      return {
        hpMaxPercent: 4 + tier * 1.4,
        spiritPercent: 2 + tier * 0.5,
        elementalAtkBonus: 0.01 + tier * 0.003,
      };
    case 'THUY':
      return {
        mpMaxPercent: 4 + tier * 1.4,
        spiritPercent: 2 + tier * 0.5,
        elementalAtkBonus: 0.01 + tier * 0.003,
      };
    case 'HOA':
      return {
        atkPercent: 5 + tier * 1.4,
        elementalAtkBonus: 0.015 + tier * 0.005,
      };
    case 'THO':
      return {
        hpMaxPercent: 3 + tier * 1.2,
        defPercent: 4 + tier * 1.4,
        elementalAtkBonus: 0.01 + tier * 0.003,
      };
    default:
      return {
        atkPercent: 2 + tier,
        defPercent: 2 + tier,
        elementalAtkBonus: 0.01 + tier * 0.003,
      };
  }
}

function defaultElementalPerLevelStats(
  element: MethodElement,
  tier: number,
): MethodStatScaling {
  switch (element) {
    case 'KIM':
      return {
        atkPercent: 0.3 + tier * 0.1,
        elementalAtkBonus: 0.001 + tier * 0.0004,
      };
    case 'MOC':
      return {
        hpMaxPercent: 0.3 + tier * 0.1,
        spiritPercent: 0.15 + tier * 0.05,
      };
    case 'THUY':
      return {
        mpMaxPercent: 0.3 + tier * 0.1,
        spiritPercent: 0.15 + tier * 0.05,
      };
    case 'HOA':
      return {
        atkPercent: 0.4 + tier * 0.12,
        elementalAtkBonus: 0.0015 + tier * 0.0005,
      };
    case 'THO':
      return {
        defPercent: 0.4 + tier * 0.12,
        hpMaxPercent: 0.2 + tier * 0.08,
      };
    default:
      return {
        atkPercent: 0.2 + tier * 0.05,
        defPercent: 0.2 + tier * 0.05,
      };
  }
}

function defaultElementalPerStarStats(
  element: MethodElement,
  tier: number,
): MethodStatScaling {
  const elemental = 0.005 + tier * 0.002;
  switch (element) {
    case 'KIM':
      return { atkPercent: 1.2 + tier * 0.45, elementalAtkBonus: elemental };
    case 'MOC':
      return {
        hpMaxPercent: 1.2 + tier * 0.45,
        spiritPercent: 0.5 + tier * 0.2,
        elementalAtkBonus: elemental,
      };
    case 'THUY':
      return {
        mpMaxPercent: 1.2 + tier * 0.45,
        spiritPercent: 0.5 + tier * 0.2,
        elementalAtkBonus: elemental,
      };
    case 'HOA':
      return { atkPercent: 1.5 + tier * 0.5, elementalAtkBonus: elemental };
    case 'THO':
      return {
        defPercent: 1.5 + tier * 0.5,
        hpMaxPercent: 0.8 + tier * 0.25,
        bossDamageReduction: 0.004 + tier * 0.0015,
      };
    default:
      return { atkPercent: 0.6 + tier * 0.2, defPercent: 0.6 + tier * 0.2 };
  }
}

// ---------------------------------------------------------------------------
// Static catalog — 9 tier × 4 method ≈ 36 entries.
// ---------------------------------------------------------------------------

const CATALOG_INPUT: readonly CultivationMethodV2Def[] = [
  // ───────────────── Tier 1 — Phàm ─────────────────
  qiMethod(
    'dan_khi_quyet',
    'Dẫn Khí Quyết',
    'Công pháp khởi đầu Luyện Khí — dẫn linh khí trời đất nhập kinh mạch.',
    1,
    {
      sourceHint: ['STARTER'],
      fragmentsRequired: 0,
      unlockLinhThachCost: 0,
      tradeable: false,
      bindOnUnlock: true,
    },
  ),
  bodyMethod(
    'toi_than_quyet',
    'Tôi Thân Quyết',
    'Công pháp khởi đầu Luyện Thể — tôi luyện da thịt phàm phẩm.',
    1,
    {
      sourceHint: ['STARTER'],
      fragmentsRequired: 0,
      unlockLinhThachCost: 0,
      tradeable: false,
      bindOnUnlock: true,
    },
  ),
  elementalMethod(
    'tieu_moc_sinh_tuc_cong',
    'Tiểu Mộc Sinh Tức Công',
    'Công pháp Mộc hệ sơ cấp — gia tốc tự nhiên hồi phục.',
    1,
    'MOC',
    { primarySlot: 'SUPPORT' },
  ),
  elementalMethod(
    'kim_quang_quyet',
    'Kim Quang Quyết',
    'Công pháp Kim hệ sơ cấp — luyện kiếm khí sắc bén.',
    1,
    'KIM',
    { primarySlot: 'SUPPORT' },
  ),

  // ───────────────── Tier 2 — Linh ─────────────────
  qiMethod(
    'truc_co_tu_linh_quyet',
    'Trúc Cơ Tụ Linh Quyết',
    'Công pháp Luyện Khí Trúc Cơ — tụ linh khí thành đan điền.',
    2,
  ),
  bodyMethod(
    'doan_cot_cong',
    'Đoán Cốt Công',
    'Công pháp Luyện Thể tôi cốt — xương cốt rắn chắc như đồng.',
    2,
  ),
  elementalMethod(
    'han_thuy_tam_phap',
    'Hàn Thuỷ Tâm Pháp',
    'Công pháp Thuỷ hệ — vận khí nước hồi MP và né tránh.',
    2,
    'THUY',
  ),
  elementalMethod(
    'liet_hoa_quyet',
    'Liệt Hoả Quyết',
    'Công pháp Hoả hệ — bạo phát mãnh liệt, atk cao.',
    2,
    'HOA',
  ),

  // ───────────────── Tier 3 — Huyền ─────────────────
  qiMethod(
    'kim_dan_huyen_cong',
    'Kim Đan Huyền Công',
    'Công pháp Kim Đan — ngưng tinh khí thành kim đan.',
    3,
  ),
  bodyMethod(
    'tay_tuy_kim_than_quyet',
    'Tẩy Tuỷ Kim Thân Quyết',
    'Công pháp Luyện Thể — tẩy tuỷ luyện kim thân, def cao.',
    3,
  ),
  elementalMethod(
    'hau_tho_bao_dien',
    'Hậu Thổ Bảo Điển',
    'Công pháp Thổ hệ — kiên cố như đại địa, HP/def cao.',
    3,
    'THO',
  ),
  elementalMethod(
    'thanh_moc_truong_sinh_cong',
    'Thanh Mộc Trường Sinh Công',
    'Công pháp Mộc hệ — sinh cơ bừng bừng, hồi phục cường đại.',
    3,
    'MOC',
  ),

  // ───────────────── Tier 4 — Địa ─────────────────
  qiMethod(
    'nguyen_anh_tam_kinh',
    'Nguyên Anh Tâm Kinh',
    'Công pháp Nguyên Anh — ngưng nguyên anh tinh thần.',
    4,
  ),
  bodyMethod(
    'kim_cuong_phap_than',
    'Kim Cương Pháp Thân',
    'Công pháp Luyện Thể — pháp thân bất hoại, def + boss reduction.',
    4,
  ),
  hybridMethod(
    'ngu_hanh_luan_chuyen_quyet',
    'Ngũ Hành Luân Chuyển Quyết',
    'Công pháp song tu — ngũ hành luân chuyển, cân bằng khí thể.',
    4,
  ),
  elementalMethod(
    'huyen_bang_dao_quyet',
    'Huyền Băng Đạo Quyết',
    'Công pháp Thuỷ hệ — Huyền Băng đông cứng vạn vật.',
    4,
    'THUY',
  ),

  // ───────────────── Tier 5 — Thiên ─────────────────
  qiMethod(
    'hu_linh_thien_quyet',
    'Hư Linh Thiên Quyết',
    'Công pháp Hoá Thần — hư linh nhập thể, spirit cực mạnh.',
    5,
  ),
  bodyMethod(
    'bat_hoai_chan_than_cong',
    'Bất Hoại Chân Thân Công',
    'Công pháp Luyện Thể bất hoại — HP/def cao, sống dai trước boss.',
    5,
  ),
  hybridMethod(
    'can_khon_hop_nhat_cong',
    'Càn Khôn Hợp Nhất Công',
    'Công pháp song tu — càn khôn hợp nhất, khí thể đồng tiến.',
    5,
  ),
  elementalMethod(
    'xich_viem_phan_thien_quyet',
    'Xích Viêm Phần Thiên Quyết',
    'Công pháp Hoả hệ — phần thiên chi viêm, sát thương cực lớn.',
    5,
    'HOA',
  ),

  // ───────────────── Tier 6 — Tiên ─────────────────
  qiMethod(
    'kiep_loi_tam_kinh',
    'Kiếp Lôi Tâm Kinh',
    'Công pháp luyện kiếp lôi — hỗ trợ vượt kiếp, atk + tribulationSupport.',
    6,
    {
      baseStats: {
        qiExpPercent: 12,
        mpMaxPercent: 6,
        atkPercent: 4,
        tribulationSupport: 0.04,
      },
      perLevelStats: {
        qiExpPercent: 1.2,
        atkPercent: 0.4,
        tribulationSupport: 0.001,
      },
      perStarStats: {
        qiExpPercent: 4,
        atkPercent: 2,
        tribulationSupport: 0.01,
      },
    },
  ),
  bodyMethod(
    'long_tuong_tran_nguc_cong',
    'Long Tượng Trấn Ngục Công',
    'Công pháp Luyện Thể — long tượng chi lực, atk + def + boss reduction.',
    6,
  ),
  hybridMethod(
    'tien_cot_duong_than_quyet',
    'Tiên Cốt Dưỡng Thần Quyết',
    'Công pháp song tu — tiên cốt dưỡng thần, tinh khí thần hợp nhất.',
    6,
  ),
  elementalMethod(
    'thien_kim_kiem_dien',
    'Thiên Kim Kiếm Điển',
    'Công pháp Kim hệ — kiếm khí lăng không, atk cực cao.',
    6,
    'KIM',
  ),

  // ───────────────── Tier 7 — Thần ─────────────────
  qiMethod(
    'huyen_tien_dao_kinh',
    'Huyền Tiên Đạo Kinh',
    'Công pháp Huyền Tiên — đạo kinh chí cao, spirit/qi rate cực mạnh.',
    7,
  ),
  bodyMethod(
    'dai_la_kim_than_cong',
    'Đại La Kim Thân Công',
    'Công pháp Luyện Thể — đại la kim thân bất hoại.',
    7,
  ),
  elementalMethod(
    'ngu_hanh_quy_nguyen_phap',
    'Ngũ Hành Quy Nguyên Pháp',
    'Công pháp Ngũ Hành quy nguyên — bonus damage mọi hệ.',
    7,
    'MIXED',
    {
      baseStats: {
        atkPercent: 6,
        defPercent: 5,
        elementalAtkBonus: 0.05,
      },
      perLevelStats: {
        atkPercent: 0.5,
        defPercent: 0.4,
        elementalAtkBonus: 0.0015,
      },
      perStarStats: {
        atkPercent: 2,
        defPercent: 1.5,
        elementalAtkBonus: 0.01,
      },
    },
  ),
  specialMethod(
    'thai_at_thanh_tam_quyet',
    'Thái Ất Thanh Tâm Quyết',
    'Công pháp đặc biệt — thanh tâm chống tâm ma, hỗ trợ vượt kiếp.',
    7,
    {
      category: 'SPECIAL',
      element: 'HUYEN',
      primarySlot: 'SUPPORT',
      allowedSlots: ['SUPPORT', 'SPECIAL'],
      baseStats: {
        qiExpPercent: 8,
        mpMaxPercent: 6,
        tribulationSupport: 0.06,
        spiritPercent: 4,
      },
      perLevelStats: {
        spiritPercent: 0.3,
        tribulationSupport: 0.0015,
      },
      perStarStats: {
        spiritPercent: 1.4,
        tribulationSupport: 0.012,
      },
    },
  ),

  // ───────────────── Tier 8 — Đạo ─────────────────
  qiMethod(
    'thanh_nhan_van_phap_kinh',
    'Thánh Nhân Vạn Pháp Kinh',
    'Công pháp Thánh Nhân — vạn pháp đồng quy, qiExp cực hạn.',
    8,
  ),
  bodyMethod(
    'hon_nguyen_bat_diet_the',
    'Hỗn Nguyên Bất Diệt Thể',
    'Công pháp Luyện Thể — hỗn nguyên bất diệt, HP/def/staminaMax cực cao.',
    8,
  ),
  hybridMethod(
    'dao_quan_vo_cau_quyet',
    'Đạo Quân Vô Cấu Quyết',
    'Công pháp song tu — đạo quân vô cấu, khí thể đồng tiến đến đạo.',
    8,
    { element: 'HON_NGUYEN' },
  ),
  elementalMethod(
    'van_moc_sinh_linh_dien',
    'Vạn Mộc Sinh Linh Điển',
    'Công pháp Mộc hệ — vạn mộc sinh linh, hồi phục + spirit cực mạnh.',
    8,
    'MOC',
  ),

  // ───────────────── Tier 9 — Chí Tôn ─────────────────
  qiMethod(
    'thien_dao_hoa_nguyen_kinh',
    'Thiên Đạo Hoá Nguyên Kinh',
    'Công pháp Thiên Đạo — hoá nguyên đạo chân, qiExp đỉnh phong.',
    9,
    {
      sourceHint: ['WORLD_BOSS', 'EVENT', 'FRAGMENT_COMBINE'],
      tradeable: false,
      bindOnUnlock: true,
    },
  ),
  bodyMethod(
    'vinh_hang_chan_than_quyet',
    'Vĩnh Hằng Chân Thân Quyết',
    'Công pháp Luyện Thể — vĩnh hằng chân thân, bossReduction cực hạn.',
    9,
    {
      sourceHint: ['WORLD_BOSS', 'EVENT', 'FRAGMENT_COMBINE'],
      tradeable: false,
      bindOnUnlock: true,
    },
  ),
  specialMethod(
    'hu_khong_chi_ton_phap',
    'Hư Không Chí Tôn Pháp',
    'Công pháp Chí Tôn — hư không vô tận, mọi stat đều cộng cực lớn.',
    9,
    {
      category: 'SPECIAL',
      element: 'HON_NGUYEN',
      tradeable: false,
      bindOnUnlock: true,
      sourceHint: ['WORLD_BOSS', 'EVENT', 'FRAGMENT_COMBINE'],
    },
  ),
  hybridMethod(
    'ban_nguyen_hon_don_kinh',
    'Bản Nguyên Hỗn Độn Kinh',
    'Công pháp song tu Chí Tôn — bản nguyên hỗn độn, khí thể song toàn.',
    9,
    {
      element: 'HON_NGUYEN',
      tradeable: false,
      bindOnUnlock: true,
      sourceHint: ['WORLD_BOSS', 'EVENT', 'FRAGMENT_COMBINE'],
    },
  ),
];

export const CULTIVATION_METHODS_V2: readonly CultivationMethodV2Def[] = CATALOG_INPUT;

const METHOD_V2_BY_KEY = new Map(CULTIVATION_METHODS_V2.map((m) => [m.key, m]));

export function getMethodV2Def(key: string): CultivationMethodV2Def | undefined {
  return METHOD_V2_BY_KEY.get(key);
}

/**
 * Starter methods auto-grant khi onboard character V2 — không cần
 * fragment, có sẵn sau khi nhân vật được tạo.
 */
export const STARTER_METHOD_V2_KEYS: readonly string[] = [
  'dan_khi_quyet',
  'toi_than_quyet',
];

// ---------------------------------------------------------------------------
// Catalog validation — guard catalog drift.
// ---------------------------------------------------------------------------

export function validateMethodCatalog(
  catalog: readonly CultivationMethodV2Def[] = CULTIVATION_METHODS_V2,
): true {
  const seenKeys = new Set<string>();
  for (const def of catalog) {
    if (!def.key) throw new Error('METHOD_V2_EMPTY_KEY');
    if (seenKeys.has(def.key)) throw new Error(`METHOD_V2_DUPLICATE_KEY:${def.key}`);
    seenKeys.add(def.key);

    if (def.tier < 1 || def.tier > 9) {
      throw new Error(`METHOD_V2_TIER_RANGE:${def.key}`);
    }
    if (!METHOD_CATEGORIES.includes(def.category)) {
      throw new Error(`METHOD_V2_CATEGORY:${def.key}`);
    }
    if (!METHOD_ELEMENTS.includes(def.element)) {
      throw new Error(`METHOD_V2_ELEMENT:${def.key}`);
    }
    if (!METHOD_GRADES.includes(def.grade)) {
      throw new Error(`METHOD_V2_GRADE:${def.key}`);
    }
    if (def.grade !== methodGradeForTier(def.tier)) {
      throw new Error(`METHOD_V2_GRADE_TIER_MISMATCH:${def.key}`);
    }
    if (def.fragmentItemKey !== methodFragmentItemKey(def.key)) {
      throw new Error(`METHOD_V2_FRAGMENT_ITEM_KEY:${def.key}`);
    }
    if (def.maxLevel < 1 || def.maxLevel > 60) {
      throw new Error(`METHOD_V2_MAX_LEVEL:${def.key}`);
    }
    if (def.maxStar < 0 || def.maxStar > 9) {
      throw new Error(`METHOD_V2_MAX_STAR:${def.key}`);
    }
    if (def.fragmentsRequired < 0) {
      throw new Error(`METHOD_V2_FRAGMENTS_NEGATIVE:${def.key}`);
    }
    if (def.fragmentsPerStar < 0) {
      throw new Error(`METHOD_V2_FRAGMENTS_PER_STAR_NEGATIVE:${def.key}`);
    }
    if (def.allowedSlots.length === 0) {
      throw new Error(`METHOD_V2_ALLOWED_SLOTS_EMPTY:${def.key}`);
    }
    if (!def.allowedSlots.includes(def.primarySlot)) {
      throw new Error(`METHOD_V2_PRIMARY_SLOT_NOT_IN_ALLOWED:${def.key}`);
    }
    if (def.unlockLinhThachCost < 0) {
      throw new Error(`METHOD_V2_NEGATIVE_LINH_THACH:${def.key}`);
    }
    for (const source of def.sourceHint) {
      if (!METHOD_SOURCES.includes(source)) {
        throw new Error(`METHOD_V2_SOURCE:${def.key}`);
      }
    }

    // Starter rule — STARTER source must have fragmentsRequired = 0.
    if (def.sourceHint.includes('STARTER') && def.fragmentsRequired !== 0) {
      throw new Error(`METHOD_V2_STARTER_FRAGMENTS:${def.key}`);
    }

    // Endgame rule — tier 8-9 không được rơi nguyên quyển từ
    // NORMAL_MONSTER source. Method catalog dùng sourceHint là method-level
    // source — không cho `NPC_SHOP` hoặc `MAIN_QUEST` lấy nguyên quyển.
    if (def.tier >= 8) {
      const bad: MethodSource[] = ['NPC_SHOP', 'MAIN_QUEST', 'SIDE_QUEST', 'MARKET'];
      for (const s of def.sourceHint) {
        if (bad.includes(s)) {
          throw new Error(`METHOD_V2_ENDGAME_SOURCE_TOO_EASY:${def.key}:${s}`);
        }
      }
    }

    // Body rule — BODY method phải có bodyExpPercent >= 0 ở base hoặc per-level.
    if (def.category === 'BODY') {
      const hasBody =
        (def.baseStats.bodyExpPercent ?? 0) > 0 ||
        (def.perLevelStats.bodyExpPercent ?? 0) > 0 ||
        (def.perStarStats.bodyExpPercent ?? 0) > 0;
      if (!hasBody) {
        throw new Error(`METHOD_V2_BODY_NO_BODY_BONUS:${def.key}`);
      }
      // BODY method không được cộng atkPercent > bodyExpPercent ở base — tránh
      // biến body thành DPS thuần.
      const baseAtk = def.baseStats.atkPercent ?? 0;
      const baseBody = def.baseStats.bodyExpPercent ?? 0;
      if (baseAtk > baseBody + 5) {
        throw new Error(`METHOD_V2_BODY_TOO_OFFENSIVE:${def.key}`);
      }
    }

    if (def.category === 'QI') {
      const hasQi =
        (def.baseStats.qiExpPercent ?? 0) > 0 ||
        (def.perLevelStats.qiExpPercent ?? 0) > 0 ||
        (def.perStarStats.qiExpPercent ?? 0) > 0;
      if (!hasQi) {
        throw new Error(`METHOD_V2_QI_NO_QI_BONUS:${def.key}`);
      }
      // QI method không nên cộng bodyExpPercent quá nhiều — tránh thay thế
      // hệ Luyện Thể.
      const baseBody = def.baseStats.bodyExpPercent ?? 0;
      if (baseBody > 6) {
        throw new Error(`METHOD_V2_QI_BODY_OVERFLOW:${def.key}`);
      }
    }

    // Hybrid: cả qi+body phải có baseline >= 1%.
    if (def.category === 'HYBRID') {
      if (
        (def.baseStats.qiExpPercent ?? 0) < 1 ||
        (def.baseStats.bodyExpPercent ?? 0) < 1
      ) {
        throw new Error(`METHOD_V2_HYBRID_MISSING_DUAL_BONUS:${def.key}`);
      }
      // Hybrid phải thấp hơn QI/BODY chuyên biệt ở từng nhánh.
      const sameTierQi = catalog.find(
        (m) => m.tier === def.tier && m.category === 'QI',
      );
      const sameTierBody = catalog.find(
        (m) => m.tier === def.tier && m.category === 'BODY',
      );
      if (
        sameTierQi &&
        (def.baseStats.qiExpPercent ?? 0) >= (sameTierQi.baseStats.qiExpPercent ?? 0)
      ) {
        throw new Error(`METHOD_V2_HYBRID_QI_NOT_LOWER:${def.key}`);
      }
      if (
        sameTierBody &&
        (def.baseStats.bodyExpPercent ?? 0) >=
          (sameTierBody.baseStats.bodyExpPercent ?? 0)
      ) {
        throw new Error(`METHOD_V2_HYBRID_BODY_NOT_LOWER:${def.key}`);
      }
    }

    // Upgrade material reference check.
    for (const m of def.upgradeMaterials) {
      if (m.qty <= 0) {
        throw new Error(`METHOD_V2_UPGRADE_MAT_QTY:${def.key}:${m.itemKey}`);
      }
    }
    for (const m of def.breakthroughMaterials) {
      if (m.qty <= 0) {
        throw new Error(`METHOD_V2_BT_MAT_QTY:${def.key}:${m.itemKey}`);
      }
      if (m.atLevel <= 0 || m.atLevel > def.maxLevel) {
        throw new Error(`METHOD_V2_BT_AT_LEVEL:${def.key}:${m.atLevel}`);
      }
    }
  }

  // Upgrade cost monotonic — cost level N+1 >= level N.
  for (let tier = 1; tier <= 9; tier++) {
    let prev = -1;
    for (let level = 1; level <= 40; level++) {
      const cost = methodUpgradeLinhThachCost(tier, level);
      if (cost < prev) throw new Error(`METHOD_V2_UPGRADE_COST_NON_MONOTONIC:${tier}:${level}`);
      prev = cost;
    }
  }
  return true;
}

// Validate eagerly at module load — catalog drift = startup throw.
validateMethodCatalog();

// ---------------------------------------------------------------------------
// Catalog filters & UI helpers
// ---------------------------------------------------------------------------

export interface MethodFilter {
  category?: MethodCategory;
  element?: MethodElement;
  grade?: MethodGrade;
  tier?: number;
  slot?: MethodEquipSlot;
}

export function filterMethods(
  filter: MethodFilter,
  catalog: readonly CultivationMethodV2Def[] = CULTIVATION_METHODS_V2,
): CultivationMethodV2Def[] {
  return catalog.filter((m) => {
    if (filter.category && m.category !== filter.category) return false;
    if (filter.element && m.element !== filter.element) return false;
    if (filter.grade && m.grade !== filter.grade) return false;
    if (filter.tier !== undefined && m.tier !== filter.tier) return false;
    if (filter.slot && !m.allowedSlots.includes(filter.slot)) return false;
    return true;
  });
}
