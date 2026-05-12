/**
 * Phase 23.3 — Set Bonus catalog + helpers.
 *
 * Mục tiêu: bổ sung lớp **set bonus** (cộng hưởng theo bộ 2/4/6 món) trên nền
 * Phase 23.2 (`equipmentTier`, `requiredRealmOrder`, `powerBudget`) và Phase
 * 22.1 (`equipmentElement`). Không thay đổi catalog `ITEMS` — set ownership
 * được xác định qua classifier `getItemSetKey()` đối chiếu `equipmentElement`
 * + `equipmentTier` + `slot` với catalog `SET_BONUSES`.
 *
 * Không phá balance:
 * - Bonus ratio thuần stat (`atkRatio`, `defRatio`, `hpMaxRatio`,
 *   `mpMaxRatio`, `spiritRatio`) áp lên baseline aggregation, đi qua envelope
 *   cap chung ở `equipment-build.ts`.
 * - 2-piece 3–5%, 4-piece 6–10%, 6-piece 10–15% (envelope theo plan Phase
 *   23.3); set tier thấp không thể vượt cap 2-piece dù mặc full 6 món.
 * - Không stack cùng set 2 lần (`getEquippedSetPieces` group theo `setKey`).
 * - Duplicate inventory id không tính 2 món (`Set<inventoryItemId>` guard).
 *
 * Catalog Ngũ Hành: 5 element × 2 set (mid tier 4 / endgame tier 8) = 10 set.
 *
 * Pure / deterministic: không IO, không Date, không random.
 */

import type { ElementKey } from './combat';
import { EQUIP_SLOTS, type EquipSlot, type Quality } from './enums';
import { getEquipmentElement } from './elemental-equipment';
import type { ItemDef } from './items';
import {
  EQUIPMENT_SET_BONUS_CAPS,
  getEquipmentTierForRealmOrder,
} from './equipment-progression';

export type SetTag =
  | 'pve'
  | 'boss'
  | 'sustain'
  | 'burst'
  | 'control'
  | 'tank'
  | 'support';

/**
 * Additive ratio cho 5 stat baseline (atk/def/hpMax/mpMax/spirit). Áp lên
 * baseline aggregation, đi qua envelope cap ở `equipment-build.ts`. Mỗi field
 * optional; missing = 0.
 */
export interface SetBonusBonusEnvelope {
  atkRatio?: number;
  defRatio?: number;
  hpMaxRatio?: number;
  mpMaxRatio?: number;
  spiritRatio?: number;
}

export interface SetBonusTierDef {
  pieces: 2 | 4 | 6;
  bonusRatio: SetBonusBonusEnvelope;
  /** Mô tả gameplay (tiếng Anh). UI có thể override bằng i18n key theo `setKey`. */
  description: string;
  descriptionVi?: string;
  /**
   * Optional cooldown (seconds) cho hiệu ứng đặc biệt 6-piece. Runtime chưa
   * wire — chỉ surface qua catalog để Phase 23.4+ apply.
   */
  cooldownSec?: number;
}

export interface SetBonusDef {
  setKey: string;
  name: string;
  nameVi: string;
  description: string;
  descriptionVi?: string;
  /** Tier range item được match vào set (≥ minTier, ≤ maxTier). */
  allowedTiers: readonly number[];
  /** realmOrder tối thiểu để 2-piece kích hoạt. */
  requiredRealmOrder: number;
  elementAffinity: ElementKey;
  /** 6 slot ưu tiên thuộc set (subset của `EQUIP_SLOTS`). */
  requiredSlots: readonly EquipSlot[];
  tiers: readonly SetBonusTierDef[];
  tags: readonly SetTag[];
  /**
   * Tổng cap ratio (sum of all bonus ratios) — ratio tổng không được vượt
   * giá trị này dù 6-piece active. Mặc định = `EQUIPMENT_SET_BONUS_CAPS.sixPiece.max`.
   */
  bonusCap: number;
}

const SET_REQUIRED_SLOTS_DEFAULT: readonly EquipSlot[] = [
  'WEAPON',
  'ARMOR',
  'HAT',
  'BELT',
  'BOOTS',
  'ARTIFACT_1',
] as const;

const TWO_PIECE_RATIO = EQUIPMENT_SET_BONUS_CAPS.twoPiece.max; // 0.05
const FOUR_PIECE_RATIO = EQUIPMENT_SET_BONUS_CAPS.fourPiece.max; // 0.10
const SIX_PIECE_RATIO = EQUIPMENT_SET_BONUS_CAPS.sixPiece.max; // 0.15

const MID_TIERS: readonly number[] = [4, 5];
const END_TIERS: readonly number[] = [8, 9];

/**
 * Catalog 10 set theo Ngũ Hành (5 element × 2 set mid/endgame). Bonus ratio
 * giữ trong envelope plan Phase 23.3 (`docs/phase-23-3-set-bonus-gear-resonance-plan.md`).
 *
 * Không hardcode "+50% damage" — mỗi set ≤ `SIX_PIECE_RATIO` (15%) tổng.
 */
export const SET_BONUSES: readonly SetBonusDef[] = [
  // ─── Kim ───────────────────────────────────────────────────────────
  {
    setKey: 'kim_phong_set',
    name: 'Kim Phong Liệt Khí',
    nameVi: 'Kim Phong Liệt Khí',
    description: 'Mid-tier Kim set — fast metallic strikes, crit-focused burst.',
    descriptionVi: 'Bộ Kim trung kỳ — kiếm khí sắc nhọn, thiên về crit và burst chính xác.',
    allowedTiers: MID_TIERS,
    requiredRealmOrder: 10,
    elementAffinity: 'kim',
    requiredSlots: SET_REQUIRED_SLOTS_DEFAULT,
    tiers: [
      {
        pieces: 2,
        bonusRatio: { atkRatio: 0.04 },
        description: '+4% physical attack.',
        descriptionVi: '+4% sát thương vật lý.',
      },
      {
        pieces: 4,
        bonusRatio: { atkRatio: 0.08 },
        description: '+8% physical attack.',
        descriptionVi: '+8% sát thương vật lý.',
      },
      {
        pieces: 6,
        bonusRatio: { atkRatio: 0.12, spiritRatio: 0.03 },
        description: '+12% physical attack and +3% spirit; faster crit cadence (cooldown 30s).',
        descriptionVi: '+12% sát thương vật lý và +3% linh; tăng nhịp bạo kích (cooldown 30 giây).',
        cooldownSec: 30,
      },
    ],
    tags: ['pve', 'burst'],
    bonusCap: SIX_PIECE_RATIO,
  },
  {
    setKey: 'kim_quang_sat_set',
    name: 'Kim Quang Sát Phong',
    nameVi: 'Kim Quang Sát Phong',
    description: 'Endgame Kim set — precision burst with armor pierce.',
    descriptionVi: 'Bộ Kim hậu kỳ — bạo kích chính xác xuyên giáp.',
    allowedTiers: END_TIERS,
    requiredRealmOrder: 22,
    elementAffinity: 'kim',
    requiredSlots: SET_REQUIRED_SLOTS_DEFAULT,
    tiers: [
      {
        pieces: 2,
        bonusRatio: { atkRatio: 0.05 },
        description: '+5% physical attack.',
        descriptionVi: '+5% sát thương vật lý.',
      },
      {
        pieces: 4,
        bonusRatio: { atkRatio: 0.09, spiritRatio: 0.02 },
        description: '+9% attack, +2% spirit.',
        descriptionVi: '+9% sát thương, +2% linh.',
      },
      {
        pieces: 6,
        bonusRatio: { atkRatio: 0.12, spiritRatio: 0.03 },
        description:
          '+12% attack and +3% spirit; finishing strike pierces 20% of target armor (cooldown 45s).',
        descriptionVi:
          '+12% sát thương và +3% linh; đòn kết liễu xuyên 20% giáp (cooldown 45 giây).',
        cooldownSec: 45,
      },
    ],
    tags: ['pve', 'boss', 'burst'],
    bonusCap: SIX_PIECE_RATIO,
  },

  // ─── Mộc ───────────────────────────────────────────────────────────
  {
    setKey: 'thanh_diep_tu_sinh_set',
    name: 'Thanh Diệp Tự Sinh',
    nameVi: 'Thanh Diệp Tự Sinh',
    description: 'Mid-tier Mộc set — regen and sustain.',
    descriptionVi: 'Bộ Mộc trung kỳ — hồi phục và sustain dài hơi.',
    allowedTiers: MID_TIERS,
    requiredRealmOrder: 10,
    elementAffinity: 'moc',
    requiredSlots: SET_REQUIRED_SLOTS_DEFAULT,
    tiers: [
      {
        pieces: 2,
        bonusRatio: { hpMaxRatio: 0.04 },
        description: '+4% HP max.',
        descriptionVi: '+4% HP tối đa.',
      },
      {
        pieces: 4,
        bonusRatio: { hpMaxRatio: 0.06, mpMaxRatio: 0.04 },
        description: '+6% HP max and +4% MP max.',
        descriptionVi: '+6% HP và +4% MP tối đa.',
      },
      {
        pieces: 6,
        bonusRatio: { hpMaxRatio: 0.08, mpMaxRatio: 0.04, spiritRatio: 0.02 },
        description: '+8% HP, +4% MP, +2% spirit; regen burst on heal (cooldown 60s).',
        descriptionVi: '+8% HP, +4% MP, +2% linh; hồi sinh tức thì khi nhận heal (cooldown 60 giây).',
        cooldownSec: 60,
      },
    ],
    tags: ['pve', 'sustain', 'support'],
    bonusCap: SIX_PIECE_RATIO,
  },
  {
    setKey: 'van_moc_tham_lam_set',
    name: 'Vạn Mộc Tham Thiên',
    nameVi: 'Vạn Mộc Tham Thiên',
    description: 'Endgame Mộc set — life thrive and grow.',
    descriptionVi: 'Bộ Mộc hậu kỳ — sinh trưởng vạn vật, sustain bền bỉ.',
    allowedTiers: END_TIERS,
    requiredRealmOrder: 22,
    elementAffinity: 'moc',
    requiredSlots: SET_REQUIRED_SLOTS_DEFAULT,
    tiers: [
      {
        pieces: 2,
        bonusRatio: { hpMaxRatio: 0.05 },
        description: '+5% HP max.',
        descriptionVi: '+5% HP tối đa.',
      },
      {
        pieces: 4,
        bonusRatio: { hpMaxRatio: 0.07, mpMaxRatio: 0.03 },
        description: '+7% HP and +3% MP max.',
        descriptionVi: '+7% HP và +3% MP tối đa.',
      },
      {
        pieces: 6,
        bonusRatio: { hpMaxRatio: 0.1, mpMaxRatio: 0.03, spiritRatio: 0.02 },
        description: '+10% HP, +3% MP, +2% spirit; over-time regen burst (cooldown 75s).',
        descriptionVi: '+10% HP, +3% MP, +2% linh; tái sinh kéo dài (cooldown 75 giây).',
        cooldownSec: 75,
      },
    ],
    tags: ['pve', 'sustain', 'tank'],
    bonusCap: SIX_PIECE_RATIO,
  },

  // ─── Thuỷ ─────────────────────────────────────────────────────────
  {
    setKey: 'han_thuy_han_tam_set',
    name: 'Hàn Thuỷ Hàn Tâm',
    nameVi: 'Hàn Thuỷ Hàn Tâm',
    description: 'Mid-tier Thuỷ set — evasion and control.',
    descriptionVi: 'Bộ Thuỷ trung kỳ — né tránh và khống chế nhẹ.',
    allowedTiers: MID_TIERS,
    requiredRealmOrder: 10,
    elementAffinity: 'thuy',
    requiredSlots: SET_REQUIRED_SLOTS_DEFAULT,
    tiers: [
      {
        pieces: 2,
        bonusRatio: { spiritRatio: 0.04 },
        description: '+4% spirit.',
        descriptionVi: '+4% linh.',
      },
      {
        pieces: 4,
        bonusRatio: { spiritRatio: 0.06, mpMaxRatio: 0.04 },
        description: '+6% spirit and +4% MP max.',
        descriptionVi: '+6% linh và +4% MP tối đa.',
      },
      {
        pieces: 6,
        bonusRatio: { spiritRatio: 0.08, mpMaxRatio: 0.04, defRatio: 0.02 },
        description: '+8% spirit, +4% MP, +2% defense; slow aura on hit (cooldown 30s).',
        descriptionVi: '+8% linh, +4% MP, +2% thủ; aura giảm tốc khi trúng đòn (cooldown 30 giây).',
        cooldownSec: 30,
      },
    ],
    tags: ['pve', 'control'],
    bonusCap: SIX_PIECE_RATIO,
  },
  {
    setKey: 'bich_hai_linh_toa_set',
    name: 'Bích Hải Linh Toạ',
    nameVi: 'Bích Hải Linh Toạ',
    description: 'Endgame Thuỷ set — control and debuff sustain.',
    descriptionVi: 'Bộ Thuỷ hậu kỳ — khống chế và debuff dày đặc.',
    allowedTiers: END_TIERS,
    requiredRealmOrder: 22,
    elementAffinity: 'thuy',
    requiredSlots: SET_REQUIRED_SLOTS_DEFAULT,
    tiers: [
      {
        pieces: 2,
        bonusRatio: { spiritRatio: 0.05 },
        description: '+5% spirit.',
        descriptionVi: '+5% linh.',
      },
      {
        pieces: 4,
        bonusRatio: { spiritRatio: 0.07, mpMaxRatio: 0.03 },
        description: '+7% spirit and +3% MP max.',
        descriptionVi: '+7% linh và +3% MP tối đa.',
      },
      {
        pieces: 6,
        bonusRatio: { spiritRatio: 0.1, mpMaxRatio: 0.03, defRatio: 0.02 },
        description:
          '+10% spirit, +3% MP, +2% defense; root pulse on debuffed target (cooldown 60s).',
        descriptionVi:
          '+10% linh, +3% MP, +2% thủ; trói giữ mục tiêu mang debuff (cooldown 60 giây).',
        cooldownSec: 60,
      },
    ],
    tags: ['pve', 'control', 'support'],
    bonusCap: SIX_PIECE_RATIO,
  },

  // ─── Hoả ─────────────────────────────────────────────────────────
  {
    setKey: 'lieu_hoa_phon_set',
    name: 'Liệu Hoả Phần Vân',
    nameVi: 'Liệu Hoả Phần Vân',
    description: 'Mid-tier Hoả set — burn and burst.',
    descriptionVi: 'Bộ Hoả trung kỳ — burn và burst sát thương.',
    allowedTiers: MID_TIERS,
    requiredRealmOrder: 10,
    elementAffinity: 'hoa',
    requiredSlots: SET_REQUIRED_SLOTS_DEFAULT,
    tiers: [
      {
        pieces: 2,
        bonusRatio: { atkRatio: 0.03, spiritRatio: 0.01 },
        description: '+3% attack and +1% spirit.',
        descriptionVi: '+3% sát thương và +1% linh.',
      },
      {
        pieces: 4,
        bonusRatio: { atkRatio: 0.06, spiritRatio: 0.02 },
        description: '+6% attack and +2% spirit.',
        descriptionVi: '+6% sát thương và +2% linh.',
      },
      {
        pieces: 6,
        bonusRatio: { atkRatio: 0.1, spiritRatio: 0.03 },
        description: '+10% attack and +3% spirit; ignite DoT on crit (cooldown 30s).',
        descriptionVi:
          '+10% sát thương và +3% linh; đốt cháy theo thời gian khi bạo kích (cooldown 30 giây).',
        cooldownSec: 30,
      },
    ],
    tags: ['pve', 'burst'],
    bonusCap: SIX_PIECE_RATIO,
  },
  {
    setKey: 'cuu_u_diem_hoa_set',
    name: 'Cửu U Điểm Hoả',
    nameVi: 'Cửu U Điểm Hoả',
    description: 'Endgame Hoả set — burn-over-time and big burst.',
    descriptionVi: 'Bộ Hoả hậu kỳ — DoT lâu dài và burst lớn.',
    allowedTiers: END_TIERS,
    requiredRealmOrder: 22,
    elementAffinity: 'hoa',
    requiredSlots: SET_REQUIRED_SLOTS_DEFAULT,
    tiers: [
      {
        pieces: 2,
        bonusRatio: { atkRatio: 0.04, spiritRatio: 0.01 },
        description: '+4% attack and +1% spirit.',
        descriptionVi: '+4% sát thương và +1% linh.',
      },
      {
        pieces: 4,
        bonusRatio: { atkRatio: 0.07, spiritRatio: 0.02 },
        description: '+7% attack and +2% spirit.',
        descriptionVi: '+7% sát thương và +2% linh.',
      },
      {
        pieces: 6,
        bonusRatio: { atkRatio: 0.1, spiritRatio: 0.05 },
        description:
          '+10% attack and +5% spirit; lingering burn (3 stacks max) on weakened target (cooldown 45s).',
        descriptionVi:
          '+10% sát thương và +5% linh; burn dai dẳng (tối đa 3 stack) trên mục tiêu yếu (cooldown 45 giây).',
        cooldownSec: 45,
      },
    ],
    tags: ['pve', 'boss', 'burst'],
    bonusCap: SIX_PIECE_RATIO,
  },

  // ─── Thổ ─────────────────────────────────────────────────────────
  {
    setKey: 'hau_tho_hu_vien_set',
    name: 'Hậu Thổ Hư Viên',
    nameVi: 'Hậu Thổ Hư Viên',
    description: 'Mid-tier Thổ set — armor, shield, reflect.',
    descriptionVi: 'Bộ Thổ trung kỳ — giáp, shield, phản đòn.',
    allowedTiers: MID_TIERS,
    requiredRealmOrder: 10,
    elementAffinity: 'tho',
    requiredSlots: SET_REQUIRED_SLOTS_DEFAULT,
    tiers: [
      {
        pieces: 2,
        bonusRatio: { defRatio: 0.04 },
        description: '+4% defense.',
        descriptionVi: '+4% thủ.',
      },
      {
        pieces: 4,
        bonusRatio: { defRatio: 0.07, hpMaxRatio: 0.03 },
        description: '+7% defense and +3% HP max.',
        descriptionVi: '+7% thủ và +3% HP tối đa.',
      },
      {
        pieces: 6,
        bonusRatio: { defRatio: 0.1, hpMaxRatio: 0.04 },
        description:
          '+10% defense and +4% HP; reflect 5% of damage taken when below 40% HP (cooldown 30s).',
        descriptionVi:
          '+10% thủ và +4% HP; phản đòn 5% sát thương khi dưới 40% HP (cooldown 30 giây).',
        cooldownSec: 30,
      },
    ],
    tags: ['pve', 'tank'],
    bonusCap: SIX_PIECE_RATIO,
  },
  {
    setKey: 'bat_quai_cuong_ngoa_set',
    name: 'Bát Quái Cường Ngoạ',
    nameVi: 'Bát Quái Cường Ngoạ',
    description: 'Endgame Thổ set — fortress shield and reflect.',
    descriptionVi: 'Bộ Thổ hậu kỳ — shield kiên cố và phản đòn.',
    allowedTiers: END_TIERS,
    requiredRealmOrder: 22,
    elementAffinity: 'tho',
    requiredSlots: SET_REQUIRED_SLOTS_DEFAULT,
    tiers: [
      {
        pieces: 2,
        bonusRatio: { defRatio: 0.05 },
        description: '+5% defense.',
        descriptionVi: '+5% thủ.',
      },
      {
        pieces: 4,
        bonusRatio: { defRatio: 0.08, hpMaxRatio: 0.03 },
        description: '+8% defense and +3% HP max.',
        descriptionVi: '+8% thủ và +3% HP tối đa.',
      },
      {
        pieces: 6,
        bonusRatio: { defRatio: 0.1, hpMaxRatio: 0.05 },
        description:
          '+10% defense and +5% HP; absorb shield on heavy hit (cooldown 60s).',
        descriptionVi: '+10% thủ và +5% HP; shield hấp thụ đòn nặng (cooldown 60 giây).',
        cooldownSec: 60,
      },
    ],
    tags: ['pve', 'tank', 'support'],
    bonusCap: SIX_PIECE_RATIO,
  },
] as const;

const SET_BY_KEY: ReadonlyMap<string, SetBonusDef> = new Map(
  SET_BONUSES.map((set) => [set.setKey, set] as const),
);

export function getSetBonusDefByKey(setKey: string): SetBonusDef | undefined {
  return SET_BY_KEY.get(setKey);
}

export function listSetBonusesForElement(element: ElementKey): readonly SetBonusDef[] {
  return SET_BONUSES.filter((s) => s.elementAffinity === element);
}

/**
 * Light view của 1 món trang bị đang đeo. Compose từ `InventoryView` ở runtime
 * (api/web) hoặc test fixture; chỉ giữ field cần cho compute set/resonance.
 */
export interface EquippedPiece {
  /** ID dòng `InventoryItem`. Dùng để dedup trong `getEquippedSetPieces`. */
  inventoryItemId: string;
  itemKey: string;
  /** Slot đang đeo. Null = không equip → ignore khi compute. */
  equippedSlot: EquipSlot | null;
  quality: Quality;
  equipmentTier?: number;
  requiredRealmOrder?: number;
  equipmentElement?: ElementKey | null;
  /** Phase 11.5 refine level proxy cho enhance resonance. Default 0. */
  enhanceLevel?: number;
}

/**
 * Classify 1 item vào setKey (nếu match). Match khi:
 * - Item có `slot` thuộc `set.requiredSlots`.
 * - `item.equipmentTier` thuộc `set.allowedTiers`.
 * - `getEquipmentElement(item)` (fallback từ bonuses.elementalAtkBonus) === set.elementAffinity.
 *
 * Trả `undefined` nếu không match set nào. Stable: lần lượt duyệt `SET_BONUSES`
 * và trả set đầu tiên match — catalog không có overlap giữa các set khác hệ.
 */
export function getItemSetKey(
  item: Pick<ItemDef, 'slot' | 'equipmentTier' | 'equipmentElement' | 'bonuses'>,
): string | undefined {
  if (!item.slot || item.equipmentTier === undefined) return undefined;
  const element = getEquipmentElement(item);
  if (!element) return undefined;
  for (const set of SET_BONUSES) {
    if (set.elementAffinity !== element) continue;
    if (!set.requiredSlots.includes(item.slot)) continue;
    if (!set.allowedTiers.includes(item.equipmentTier)) continue;
    return set.setKey;
  }
  return undefined;
}

export interface EquippedSetPiece {
  setKey: string;
  inventoryItemId: string;
  itemKey: string;
  equippedSlot: EquipSlot;
  equipmentTier: number;
  equipmentElement: ElementKey;
}

export interface EquippedSetGroup {
  setKey: string;
  set: SetBonusDef;
  pieces: readonly EquippedSetPiece[];
}

/**
 * Nhóm các món đang đeo theo `setKey`. Dedup `inventoryItemId` (cùng 1
 * inventory row không tính 2 món). Item không match set nào → bị bỏ qua.
 * Item match set nhưng `equipmentTier` undefined → bỏ qua (an toàn cho legacy).
 *
 * @param equipped Trang bị đang đeo + ItemDef resolved.
 * @returns Map setKey → EquippedSetGroup.
 */
export function getEquippedSetPieces(
  equipped: readonly {
    piece: EquippedPiece;
    item: Pick<ItemDef, 'slot' | 'equipmentTier' | 'equipmentElement' | 'bonuses'>;
  }[],
): ReadonlyMap<string, EquippedSetGroup> {
  const out = new Map<string, EquippedSetGroup>();
  const seenIds = new Set<string>();
  const seenSetSlots = new Map<string, Set<EquipSlot>>();
  for (const { piece, item } of equipped) {
    if (!piece.equippedSlot) continue;
    if (seenIds.has(piece.inventoryItemId)) continue;
    seenIds.add(piece.inventoryItemId);
    const setKey = getItemSetKey(item);
    if (!setKey) continue;
    const set = getSetBonusDefByKey(setKey);
    if (!set) continue;
    if (item.equipmentTier === undefined) continue;
    const element = getEquipmentElement(item);
    if (!element) continue;
    const slotsUsed = seenSetSlots.get(setKey) ?? new Set<EquipSlot>();
    if (slotsUsed.has(piece.equippedSlot)) continue;
    slotsUsed.add(piece.equippedSlot);
    seenSetSlots.set(setKey, slotsUsed);
    const group = out.get(setKey) ?? { setKey, set, pieces: [] as readonly EquippedSetPiece[] };
    out.set(setKey, {
      setKey,
      set,
      pieces: [
        ...group.pieces,
        {
          setKey,
          inventoryItemId: piece.inventoryItemId,
          itemKey: piece.itemKey,
          equippedSlot: piece.equippedSlot,
          equipmentTier: item.equipmentTier,
          equipmentElement: element,
        },
      ],
    });
  }
  return out;
}

export interface ActiveSetBonus {
  setKey: string;
  set: SetBonusDef;
  pieceCount: number;
  /** Tier nào đang active. 6-piece bao gồm 2 + 4 piece (gộp). */
  activeTiers: readonly SetBonusTierDef[];
  /** Tổng ratio đã gộp (sum 2+4+6 nếu đủ piece), clamp về `set.bonusCap`. */
  totalRatio: SetBonusBonusEnvelope;
  /** Slot còn thiếu để lên tier kế tiếp (rỗng nếu đã 6-piece). */
  missingSlots: readonly EquipSlot[];
}

function addEnvelope(a: SetBonusBonusEnvelope, b: SetBonusBonusEnvelope): SetBonusBonusEnvelope {
  return {
    atkRatio: (a.atkRatio ?? 0) + (b.atkRatio ?? 0),
    defRatio: (a.defRatio ?? 0) + (b.defRatio ?? 0),
    hpMaxRatio: (a.hpMaxRatio ?? 0) + (b.hpMaxRatio ?? 0),
    mpMaxRatio: (a.mpMaxRatio ?? 0) + (b.mpMaxRatio ?? 0),
    spiritRatio: (a.spiritRatio ?? 0) + (b.spiritRatio ?? 0),
  };
}

export function sumEnvelope(env: SetBonusBonusEnvelope): number {
  return (
    (env.atkRatio ?? 0) +
    (env.defRatio ?? 0) +
    (env.hpMaxRatio ?? 0) +
    (env.mpMaxRatio ?? 0) +
    (env.spiritRatio ?? 0)
  );
}

function scaleEnvelope(env: SetBonusBonusEnvelope, factor: number): SetBonusBonusEnvelope {
  if (factor === 1) return { ...env };
  return {
    atkRatio: (env.atkRatio ?? 0) * factor,
    defRatio: (env.defRatio ?? 0) * factor,
    hpMaxRatio: (env.hpMaxRatio ?? 0) * factor,
    mpMaxRatio: (env.mpMaxRatio ?? 0) * factor,
    spiritRatio: (env.spiritRatio ?? 0) * factor,
  };
}

export function clampEnvelopeToCap(
  env: SetBonusBonusEnvelope,
  cap: number,
): SetBonusBonusEnvelope {
  const total = sumEnvelope(env);
  if (total <= cap || total === 0) return env;
  return scaleEnvelope(env, cap / total);
}

/**
 * Tổng hợp active set bonuses từ các nhóm `getEquippedSetPieces`. Logic:
 * - pieceCount ≥ 2 → kích 2-piece.
 * - pieceCount ≥ 4 → cộng dồn 4-piece.
 * - pieceCount ≥ 6 → cộng dồn 6-piece.
 * - totalRatio clamp về `set.bonusCap` (15% mặc định).
 * - `missingSlots`: slot còn thiếu để đạt tier cao hơn (`requiredSlots` \ slot đang dùng).
 */
export function computeActiveSetBonuses(
  groups: ReadonlyMap<string, EquippedSetGroup>,
): readonly ActiveSetBonus[] {
  const out: ActiveSetBonus[] = [];
  for (const group of groups.values()) {
    const pieceCount = group.pieces.length;
    if (pieceCount < 2) continue;
    const activeTiers: SetBonusTierDef[] = [];
    let totalRatio: SetBonusBonusEnvelope = {};
    for (const tier of group.set.tiers) {
      if (pieceCount >= tier.pieces) {
        activeTiers.push(tier);
        totalRatio = addEnvelope(totalRatio, tier.bonusRatio);
      }
    }
    totalRatio = clampEnvelopeToCap(totalRatio, group.set.bonusCap);
    const usedSlots = new Set(group.pieces.map((p) => p.equippedSlot));
    const missingSlots = group.set.requiredSlots.filter((s) => !usedSlots.has(s));
    out.push({
      setKey: group.setKey,
      set: group.set,
      pieceCount,
      activeTiers,
      totalRatio,
      missingSlots,
    });
  }
  return out;
}

/**
 * Slot còn thiếu trong 1 set cụ thể. Hữu ích cho UI hiển thị "thiếu 2 món
 * để lên 4-piece".
 */
export function getMissingSetSlots(
  groups: ReadonlyMap<string, EquippedSetGroup>,
  setKey: string,
): readonly EquipSlot[] {
  const set = getSetBonusDefByKey(setKey);
  if (!set) return [];
  const group = groups.get(setKey);
  const usedSlots = new Set(group?.pieces.map((p) => p.equippedSlot) ?? []);
  return set.requiredSlots.filter((s) => !usedSlots.has(s));
}

/** Reasons returned bởi `validateSetBonusDefinition`. */
export type SetBonusValidationError =
  | 'INVALID_SET_KEY'
  | 'INVALID_NAME'
  | 'INVALID_ALLOWED_TIERS'
  | 'INVALID_REQUIRED_REALM_ORDER'
  | 'INVALID_REQUIRED_SLOTS'
  | 'INVALID_TIERS_LENGTH'
  | 'INVALID_TIER_PIECES'
  | 'TIER_RATIO_OVER_CAP'
  | 'BONUS_CAP_OUT_OF_RANGE'
  | 'TIER_RATIO_NEGATIVE';

export interface SetBonusValidationResult {
  ok: boolean;
  errors: readonly SetBonusValidationError[];
}

export function validateSetBonusDefinition(set: SetBonusDef): SetBonusValidationResult {
  const errors: SetBonusValidationError[] = [];
  if (!set.setKey || typeof set.setKey !== 'string') errors.push('INVALID_SET_KEY');
  if (!set.name || !set.nameVi) errors.push('INVALID_NAME');
  if (!Array.isArray(set.allowedTiers) || set.allowedTiers.length === 0) {
    errors.push('INVALID_ALLOWED_TIERS');
  } else {
    for (const tier of set.allowedTiers) {
      if (!Number.isInteger(tier) || tier < 1 || tier > 10) {
        errors.push('INVALID_ALLOWED_TIERS');
        break;
      }
    }
  }
  if (!Number.isInteger(set.requiredRealmOrder) || set.requiredRealmOrder < 1 || set.requiredRealmOrder > 28) {
    errors.push('INVALID_REQUIRED_REALM_ORDER');
  }
  if (
    !Array.isArray(set.requiredSlots) ||
    set.requiredSlots.length < 2 ||
    set.requiredSlots.length > 6
  ) {
    errors.push('INVALID_REQUIRED_SLOTS');
  } else {
    const slotSet = new Set<EquipSlot>();
    for (const slot of set.requiredSlots) {
      if (!(EQUIP_SLOTS as readonly string[]).includes(slot)) {
        errors.push('INVALID_REQUIRED_SLOTS');
        break;
      }
      if (slotSet.has(slot)) {
        errors.push('INVALID_REQUIRED_SLOTS');
        break;
      }
      slotSet.add(slot);
    }
  }
  if (!Array.isArray(set.tiers) || set.tiers.length !== 3) {
    errors.push('INVALID_TIERS_LENGTH');
  } else {
    const expectedPieces: readonly (2 | 4 | 6)[] = [2, 4, 6];
    for (let i = 0; i < set.tiers.length; i += 1) {
      const tier = set.tiers[i];
      if (tier.pieces !== expectedPieces[i]) {
        errors.push('INVALID_TIER_PIECES');
      }
      const total = sumEnvelope(tier.bonusRatio);
      const cap =
        tier.pieces === 2
          ? EQUIPMENT_SET_BONUS_CAPS.twoPiece.max
          : tier.pieces === 4
            ? EQUIPMENT_SET_BONUS_CAPS.fourPiece.max
            : EQUIPMENT_SET_BONUS_CAPS.sixPiece.max;
      if (total > cap + 1e-6) errors.push('TIER_RATIO_OVER_CAP');
      for (const v of [
        tier.bonusRatio.atkRatio,
        tier.bonusRatio.defRatio,
        tier.bonusRatio.hpMaxRatio,
        tier.bonusRatio.mpMaxRatio,
        tier.bonusRatio.spiritRatio,
      ]) {
        if (v !== undefined && (v < 0 || !Number.isFinite(v))) {
          errors.push('TIER_RATIO_NEGATIVE');
          break;
        }
      }
    }
  }
  if (
    typeof set.bonusCap !== 'number' ||
    !Number.isFinite(set.bonusCap) ||
    set.bonusCap < EQUIPMENT_SET_BONUS_CAPS.twoPiece.min ||
    set.bonusCap > EQUIPMENT_SET_BONUS_CAPS.sixPiece.max
  ) {
    errors.push('BONUS_CAP_OUT_OF_RANGE');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Sanity check toàn bộ `SET_BONUSES` catalog. Return danh sách `setKey` lỗi
 * (rỗng nếu hợp lệ) — dùng trong unit tests.
 */
export function validateSetBonusCatalog(): readonly {
  setKey: string;
  errors: readonly SetBonusValidationError[];
}[] {
  return SET_BONUSES.flatMap((set) => {
    const result = validateSetBonusDefinition(set);
    if (result.ok) return [];
    return [{ setKey: set.setKey, errors: result.errors }];
  });
}

/**
 * Catalog reference power score baseline cho mỗi set theo tier trung bình của
 * `allowedTiers`. Dùng cho test "set tier thấp không vượt cap tier cao" và
 * cho UI gợi ý power range.
 */
export function getSetReferenceTier(set: SetBonusDef): number {
  const sorted = [...set.allowedTiers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function getSetReferenceBasePower(set: SetBonusDef): number {
  const refTier = getSetReferenceTier(set);
  const realm = Math.min(28, Math.max(1, set.requiredRealmOrder));
  const tier = getEquipmentTierForRealmOrder(realm);
  return tier.tier === refTier ? tier.basePower : tier.basePower;
}
