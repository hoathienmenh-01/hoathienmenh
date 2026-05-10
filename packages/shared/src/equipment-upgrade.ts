/**
 * Equipment Reforge / Enchant Foundation — Phase 15.0.A.
 *
 * Late-game tối ưu trang bị: 2 sink mới song song với refine (Phase 11.5)
 * và gem (Phase 11.4):
 *
 *   - **Reforge** (`tẩy luyện`): re-roll danh sách *substat* phụ của trang bị
 *     trong giới hạn `ALLOWED_SUBSTAT_KINDS`. KHÔNG đụng tới `ItemDef.bonuses`
 *     gốc (main stat). Mỗi reroll consume linhThach + material → tẩy lại tất
 *     cả slot substat từ đầu (overwrite). Phần thưởng nhỏ hơn refine để không
 *     phá tier progression: substat ranges per quality cap thấp.
 *   - **Enchant** (`phụ ma`): gắn 1 hệ Ngũ Hành lên trang bị + nâng cấp
 *     enchant level 1..{@link MAX_ENCHANT_LEVEL}. Mỗi level cộng bonus nhỏ
 *     theo hệ (Mộc → hpMax, Hỏa → atk, Thổ → def, Kim → atk, Thủy → mpMax).
 *     Cap level 5 — không stack vô hạn. Cost tăng theo level + quality.
 *     Element được khoá khi enchant level 1 trở lên (foundation phase chưa
 *     hỗ trợ đổi hệ — tránh phá audit ledger / balance).
 *
 * **Không phá hủy trang bị**: cả 2 op không bao giờ delete `InventoryItem`
 * row (khác refine extreme stage có `break` → row biến mất). Fail = throw
 * + rollback transaction; success = update field. Player không mất item.
 *
 * **Anti-balance-break**: substat ranges + enchant per-level bonus cố ý
 * giữ thấp hơn `getRefineStatMultiplier` × `ItemBonus` (Phase 11.5). Tổng
 * power đóng góp foundation < +20% so với baseline → không lật meta Arena/PvE.
 *
 * **Server-authoritative**:
 *   - Server roll RNG (deterministic seed test inject — Phase 11.5 pattern).
 *   - Server compute cost từ {@link getReforgeCost} / {@link getEnchantCost}.
 *   - Server consume linhThach (CurrencyLedger reason `EQUIPMENT_REFORGE` /
 *     `EQUIPMENT_ENCHANT`) + material (ItemLedger reason cùng key).
 *   - Server ghi history audit (`EquipmentReforgeHistory` /
 *     `EquipmentEnchantHistory`) trong cùng `$transaction` với mutation.
 *   - Concurrent request không double-spend nhờ `updateMany` guard pattern
 *     (currency `gte: cost`, item `gte: materialQty`) + history audit row.
 */

import type { Quality } from './enums';
import type { ItemKind } from './items';
import type { ElementKey } from './combat';
import { ELEMENTS } from './combat';

// ---------------------------------------------------------------------------
// Substat — Reforge
// ---------------------------------------------------------------------------

/**
 * Loại substat có thể roll khi reforge. Hẹp hơn `ItemBonus` để tránh đụng
 * `elementResist` / `elementalAtkBonus` / `tribulationSupport` (các field
 * design rõ qua catalog, không random reroll).
 */
export type EquipmentSubstatKind = 'atk' | 'def' | 'hpMax' | 'mpMax' | 'spirit';

export const ALLOWED_SUBSTAT_KINDS: readonly EquipmentSubstatKind[] = [
  'atk',
  'def',
  'hpMax',
  'mpMax',
  'spirit',
] as const;

/** 1 substat sau roll — kind + integer value > 0. */
export interface EquipmentSubstat {
  kind: EquipmentSubstatKind;
  value: number;
}

/** Type guard cho `EquipmentSubstatKind`. */
export function isEquipmentSubstatKind(input: unknown): input is EquipmentSubstatKind {
  return (
    typeof input === 'string' &&
    (ALLOWED_SUBSTAT_KINDS as readonly string[]).includes(input)
  );
}

/**
 * Per-quality reroll bound — số slot substat + min/max value per kind.
 *
 * Slot count: PHAM 1, LINH 2, HUYEN 3, TIEN 3, THAN 4. Cap THAN ở 4 (không
 * 5) để total power không vượt refine + gem stack đã có ở Phase 11.
 *
 * Value range: hẹp so với base `ItemBonus` (vd Phàm Giáp def=4, LINH-quality
 * substat def 1..3). Total substat contribution < 30% base bonus per item.
 *
 * Cost: linhThach scale theo quality, material scale theo `ALLOWED_REFORGE_
 * MATERIAL_BY_QUALITY`. Fail = không có (success luôn → reroll xong khi đủ
 * resource). Foundation phase KHÔNG có protection charm.
 */
export interface ReforgeQualityRule {
  quality: Quality;
  /** Số slot substat tạo ra mỗi reroll (overwrite toàn bộ). */
  slots: number;
  /** Per-kind value range (inclusive). */
  ranges: Readonly<Record<EquipmentSubstatKind, { min: number; max: number }>>;
  /** Cost linhThach mỗi reroll. */
  linhThachCost: number;
  /** Item key + qty consume mỗi reroll. */
  material: { itemKey: string; qty: number };
}

export const EQUIPMENT_REFORGE_CONFIG: Readonly<Record<Quality, ReforgeQualityRule>> = {
  PHAM: {
    quality: 'PHAM',
    slots: 1,
    ranges: {
      atk: { min: 1, max: 2 },
      def: { min: 1, max: 2 },
      hpMax: { min: 5, max: 12 },
      mpMax: { min: 3, max: 8 },
      spirit: { min: 1, max: 1 },
    },
    linhThachCost: 80,
    material: { itemKey: 'tinh_thiet', qty: 1 },
  },
  LINH: {
    quality: 'LINH',
    slots: 2,
    ranges: {
      atk: { min: 1, max: 3 },
      def: { min: 1, max: 3 },
      hpMax: { min: 8, max: 20 },
      mpMax: { min: 5, max: 12 },
      spirit: { min: 1, max: 2 },
    },
    linhThachCost: 240,
    material: { itemKey: 'tinh_thiet', qty: 2 },
  },
  HUYEN: {
    quality: 'HUYEN',
    slots: 3,
    ranges: {
      atk: { min: 2, max: 5 },
      def: { min: 2, max: 5 },
      hpMax: { min: 15, max: 35 },
      mpMax: { min: 8, max: 20 },
      spirit: { min: 1, max: 3 },
    },
    linhThachCost: 720,
    material: { itemKey: 'yeu_dan', qty: 1 },
  },
  TIEN: {
    quality: 'TIEN',
    slots: 3,
    ranges: {
      atk: { min: 3, max: 7 },
      def: { min: 3, max: 7 },
      hpMax: { min: 25, max: 55 },
      mpMax: { min: 15, max: 30 },
      spirit: { min: 2, max: 4 },
    },
    linhThachCost: 2400,
    material: { itemKey: 'yeu_dan', qty: 2 },
  },
  THAN: {
    quality: 'THAN',
    slots: 4,
    ranges: {
      atk: { min: 4, max: 10 },
      def: { min: 4, max: 10 },
      hpMax: { min: 40, max: 80 },
      mpMax: { min: 20, max: 45 },
      spirit: { min: 3, max: 6 },
    },
    linhThachCost: 7200,
    material: { itemKey: 'han_ngoc', qty: 1 },
  },
};

// ---------------------------------------------------------------------------
// Enchant — Ngũ Hành
// ---------------------------------------------------------------------------

/**
 * Cap level enchant — không stack vô hạn. Foundation phase đặt 5 để dễ tune;
 * future PR có thể nâng nếu balance dial cho phép.
 */
export const MAX_ENCHANT_LEVEL = 5;

/**
 * Per-level bonus map theo hệ Ngũ Hành. Identity với `EquipmentSubstatKind`:
 *
 *   - `moc` (Mộc — sustain/heal): hpMax += `bonusPerLevel` × `level`.
 *   - `hoa` (Hỏa — burst): atk += `bonusPerLevel` × `level`.
 *   - `tho` (Thổ — defense): def += `bonusPerLevel` × `level`.
 *   - `kim` (Kim — crit/armor pierce): atk += `bonusPerLevel` × `level`. Kim
 *     ưu tiên atk như Hỏa nhưng giá trị thấp hơn vì còn thể hiện effect
 *     "crit/armor pierce" ở phase sau (chưa wire ở foundation).
 *   - `thuy` (Thủy — control/recovery): mpMax += `bonusPerLevel` × `level`.
 *
 * Bonus per level cố ý nhỏ (1..15 tuỳ kind). `level=5` là cap → ví dụ Hỏa
 * tối đa +10 atk (~ tier LINH bonus base). Tổng cap < 1 trang bị tier kế.
 */
export interface ElementalEnchantEffect {
  element: ElementKey;
  /** Stat kind ưu tiên — apply qua `level × bonusPerLevel`. */
  statKind: EquipmentSubstatKind;
  /** Bonus mỗi level (level 1 = bonusPerLevel × 1, ..., level 5 = ×5). */
  bonusPerLevel: number;
  /** UI label tiếng Việt cho hệ. */
  labelVi: string;
  /** UI label tiếng Anh cho hệ. */
  labelEn: string;
}

export const ELEMENTAL_ENCHANT_EFFECTS: Readonly<Record<ElementKey, ElementalEnchantEffect>> = {
  moc: {
    element: 'moc',
    statKind: 'hpMax',
    bonusPerLevel: 12,
    labelVi: 'Mộc — sinh khí (HP)',
    labelEn: 'Wood — sustain (HP)',
  },
  hoa: {
    element: 'hoa',
    statKind: 'atk',
    bonusPerLevel: 2,
    labelVi: 'Hỏa — bộc phát (ATK)',
    labelEn: 'Fire — burst (ATK)',
  },
  tho: {
    element: 'tho',
    statKind: 'def',
    bonusPerLevel: 2,
    labelVi: 'Thổ — phòng ngự (DEF)',
    labelEn: 'Earth — defense (DEF)',
  },
  kim: {
    element: 'kim',
    statKind: 'atk',
    bonusPerLevel: 1,
    labelVi: 'Kim — sắc bén (ATK)',
    labelEn: 'Metal — pierce (ATK)',
  },
  thuy: {
    element: 'thuy',
    statKind: 'mpMax',
    bonusPerLevel: 6,
    labelVi: 'Thủy — linh lực (MP)',
    labelEn: 'Water — recovery (MP)',
  },
};

/** Per-quality cost rule cho enchant (level-up từ `level` → `level + 1`). */
export interface EnchantQualityRule {
  quality: Quality;
  /**
   * Cost linhThach base. Cost cuối = `base × (currentLevel + 1)` — geometric
   * step nhẹ để late-level cảm thấy đắt đỏ hơn nhưng không vô lý.
   */
  baseLinhThachCost: number;
  /** Item key + qty consume mỗi level-up. */
  material: { itemKey: string; qty: number };
}

export const EQUIPMENT_ENCHANT_CONFIG: Readonly<Record<Quality, EnchantQualityRule>> = {
  PHAM: { quality: 'PHAM', baseLinhThachCost: 100, material: { itemKey: 'tinh_thiet', qty: 1 } },
  LINH: { quality: 'LINH', baseLinhThachCost: 320, material: { itemKey: 'tinh_thiet', qty: 2 } },
  HUYEN: { quality: 'HUYEN', baseLinhThachCost: 960, material: { itemKey: 'yeu_dan', qty: 1 } },
  TIEN: { quality: 'TIEN', baseLinhThachCost: 3000, material: { itemKey: 'yeu_dan', qty: 3 } },
  THAN: { quality: 'THAN', baseLinhThachCost: 9000, material: { itemKey: 'han_ngoc', qty: 1 } },
};

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Trả config reforge cho 1 quality (throw nếu thiếu). */
export function getReforgeRule(quality: Quality): ReforgeQualityRule {
  const rule = EQUIPMENT_REFORGE_CONFIG[quality];
  if (!rule) throw new Error(`No reforge rule for quality: ${quality}`);
  return rule;
}

/** Trả config enchant cho 1 quality (throw nếu thiếu). */
export function getEnchantRule(quality: Quality): EnchantQualityRule {
  const rule = EQUIPMENT_ENCHANT_CONFIG[quality];
  if (!rule) throw new Error(`No enchant rule for quality: ${quality}`);
  return rule;
}

/**
 * Cost cho 1 reroll reforge — flat per quality. Independent of current
 * substats (reroll luôn overwrite hết).
 */
export function getReforgeCost(quality: Quality): {
  linhThachCost: number;
  materialKey: string;
  materialQty: number;
} {
  const r = getReforgeRule(quality);
  return {
    linhThachCost: r.linhThachCost,
    materialKey: r.material.itemKey,
    materialQty: r.material.qty,
  };
}

/**
 * Cost cho 1 lần level-up enchant từ `currentLevel` → `currentLevel + 1`.
 * Throw nếu `currentLevel >= MAX_ENCHANT_LEVEL` (caller phải check trước).
 */
export function getEnchantCost(
  quality: Quality,
  currentLevel: number,
): { linhThachCost: number; materialKey: string; materialQty: number } {
  if (!Number.isInteger(currentLevel) || currentLevel < 0) {
    throw new Error(`enchant currentLevel invalid: ${currentLevel}`);
  }
  if (currentLevel >= MAX_ENCHANT_LEVEL) {
    throw new Error(`enchant currentLevel at cap: ${currentLevel} >= ${MAX_ENCHANT_LEVEL}`);
  }
  const r = getEnchantRule(quality);
  const next = currentLevel + 1;
  return {
    linhThachCost: r.baseLinhThachCost * next,
    materialKey: r.material.itemKey,
    materialQty: r.material.qty,
  };
}

/**
 * Roll N substats cho reroll. Pure deterministic theo `rng()`.
 *
 *   - Mỗi slot: random kind từ `ALLOWED_SUBSTAT_KINDS`, value uniformly random
 *     trong `[min, max]` (inclusive).
 *   - KHÔNG enforce uniqueness kind giữa slots — 2 slot cùng atk = additive
 *     (caller compose sum). Tổng power vẫn cap qua range × slots.
 *
 * @param quality quality của equipment.
 * @param rng `() => number` trong `[0, 1)`. Default `Math.random` (production).
 *   Test inject deterministic seed.
 */
export function rollReforgedSubstats(
  quality: Quality,
  rng: () => number = Math.random,
): EquipmentSubstat[] {
  const rule = getReforgeRule(quality);
  const out: EquipmentSubstat[] = [];
  for (let i = 0; i < rule.slots; i++) {
    const kindIdx = Math.floor(rng() * ALLOWED_SUBSTAT_KINDS.length);
    const kind = ALLOWED_SUBSTAT_KINDS[
      Math.min(kindIdx, ALLOWED_SUBSTAT_KINDS.length - 1)
    ];
    const range = rule.ranges[kind];
    const span = range.max - range.min + 1;
    const value = range.min + Math.floor(rng() * span);
    out.push({ kind, value });
  }
  return out;
}

/**
 * Compose substats list thành additive bonus map (sum value per kind).
 * Pure helper — caller (InventoryService.equipBonus) cộng vào tổng equipment
 * bonus.
 */
export function composeSubstatBonus(
  substats: readonly EquipmentSubstat[],
): Record<EquipmentSubstatKind, number> {
  const out: Record<EquipmentSubstatKind, number> = {
    atk: 0,
    def: 0,
    hpMax: 0,
    mpMax: 0,
    spirit: 0,
  };
  for (const s of substats) {
    if (!isEquipmentSubstatKind(s.kind)) continue;
    if (!Number.isFinite(s.value) || s.value <= 0) continue;
    out[s.kind] += Math.floor(s.value);
  }
  return out;
}

/**
 * Compose enchant bonus cho 1 (element, level) tuple. Trả zero map nếu
 * `element` null hoặc `level <= 0`. Cap level ở `MAX_ENCHANT_LEVEL` để
 * defensive guard catalog drift.
 *
 * Pure deterministic — không IO, idempotent. Caller (InventoryService) gọi
 * 1 lần per equipped item rồi sum.
 */
export function composeEnchantBonus(
  element: ElementKey | null,
  level: number,
): Record<EquipmentSubstatKind, number> {
  const zero: Record<EquipmentSubstatKind, number> = {
    atk: 0,
    def: 0,
    hpMax: 0,
    mpMax: 0,
    spirit: 0,
  };
  if (element === null) return zero;
  if (!Number.isFinite(level) || level <= 0) return zero;
  const effective = Math.min(Math.floor(level), MAX_ENCHANT_LEVEL);
  const eff = ELEMENTAL_ENCHANT_EFFECTS[element];
  if (!eff) return zero;
  return { ...zero, [eff.statKind]: eff.bonusPerLevel * effective };
}

/**
 * Type guard cho element key — chấp nhận lowercase string từ DB
 * (`InventoryItem.enchantElement`). Trả `null` nếu invalid.
 */
export function parseEnchantElement(input: string | null | undefined): ElementKey | null {
  if (input === null || input === undefined) return null;
  if ((ELEMENTS as readonly string[]).includes(input)) return input as ElementKey;
  return null;
}

/**
 * Item kind có thể reforge / enchant. Pill / ore / skill book không có
 * substat hay element enchant. Wire vào API runtime để reject sớm.
 */
const UPGRADABLE_KINDS: ReadonlySet<ItemKind> = new Set<ItemKind>([
  'WEAPON',
  'ARMOR',
  'BELT',
  'BOOTS',
  'HAT',
  'TRAM',
  'ARTIFACT',
]);

export function isUpgradableItemKind(kind: ItemKind): boolean {
  return UPGRADABLE_KINDS.has(kind);
}
