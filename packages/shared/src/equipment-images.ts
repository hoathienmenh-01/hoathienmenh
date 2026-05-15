import type { EquipSlot } from './enums';

/**
 * Cửu Thiên Mộng — Equipment art (80 ảnh chia 10 tier x 8 slot).
 *
 * Tên file dạng `{slot}{tier}.webp` lưu ở `apps/web/public/equipment/{sm|md}/`:
 *  - `sm/` = 256x256 webp (inventory grid).
 *  - `md/` = 512x512 webp (detail/loadout).
 *
 * Slot art name mapping (theo quy ước người dùng cung cấp):
 *  - kiem       (kiếm)        → WEAPON
 *  - ao         (áo/giáp)     → ARMOR
 *  - mu         (mũ)          → HAT (HELMET)
 *  - giay       (giày)        → BOOTS
 *  - dai        (đai)         → BELT
 *  - daychuyen  (ngọc bội)    → TRAM (NECKLACE)
 *  - phapbao    (pháp bảo)    → ARTIFACT_1 / ARTIFACT_2 / ARTIFACT_3
 *  - nhan       (nhẫn)        → RING (catalog hiện không có slot RING; được
 *                               dùng làm art phụ trong các view tham chiếu
 *                               trực tiếp bằng `equipmentArtName: 'nhan'`).
 *
 * Hàm trả về `null` nếu không xác định được slot hoặc tier ngoài 1..10 —
 * caller sẽ fallback sang frame mặc định.
 */
export type EquipmentArtName =
  | 'kiem'
  | 'ao'
  | 'mu'
  | 'giay'
  | 'dai'
  | 'daychuyen'
  | 'phapbao'
  | 'nhan';

export type EquipmentArtSize = 'sm' | 'md';

const SLOT_ART_NAME: Partial<Record<EquipSlot, EquipmentArtName>> = {
  WEAPON: 'kiem',
  ARMOR: 'ao',
  HAT: 'mu',
  BOOTS: 'giay',
  BELT: 'dai',
  TRAM: 'daychuyen',
  ARTIFACT_1: 'phapbao',
  ARTIFACT_2: 'phapbao',
  ARTIFACT_3: 'phapbao',
};

const LOOSE_SLOT_ART_NAME: Record<string, EquipmentArtName> = {
  weapon: 'kiem',
  armor: 'ao',
  chest: 'ao',
  helmet: 'mu',
  hat: 'mu',
  boots: 'giay',
  belt: 'dai',
  necklace: 'daychuyen',
  amulet: 'daychuyen',
  tram: 'daychuyen',
  ring: 'nhan',
  artifact: 'phapbao',
  phap_bao: 'phapbao',
  phapbao: 'phapbao',
  offhand: 'phapbao',
};

const MIN_TIER = 1;
const MAX_TIER = 10;

function clampTier(tier: number | null | undefined): number | null {
  if (typeof tier !== 'number' || !Number.isFinite(tier)) return null;
  const t = Math.round(tier);
  if (t < MIN_TIER) return MIN_TIER;
  if (t > MAX_TIER) return MAX_TIER;
  return t;
}

function resolveArtName(
  slot: EquipSlot | string | null | undefined,
): EquipmentArtName | null {
  if (!slot) return null;
  const direct = SLOT_ART_NAME[slot as EquipSlot];
  if (direct) return direct;
  const loose = LOOSE_SLOT_ART_NAME[String(slot).toLowerCase()];
  return loose ?? null;
}

export interface EquipmentImageInput {
  slot?: EquipSlot | string | null;
  /** Khi caller muốn bypass slot mapping (ví dụ dùng nhẫn / pháp bảo riêng). */
  artName?: EquipmentArtName | null;
  /** Equipment tier 1..10. Sẽ clamp về 1..10. */
  tier?: number | null;
  /** 'sm' (256x256 grid) hoặc 'md' (512x512 detail). Mặc định 'sm'. */
  size?: EquipmentArtSize;
}

export interface EquipmentImageResolved {
  /** Đường dẫn /equipment/{sm|md}/{artName}{tier}.webp */
  url: string;
  artName: EquipmentArtName;
  tier: number;
  size: EquipmentArtSize;
}

/**
 * Resolve URL ảnh trang bị từ slot + tier. Trả về null nếu thiếu thông tin.
 *
 * Ví dụ:
 *   getEquipmentImage({ slot: 'WEAPON', tier: 3 })
 *     → { url: '/equipment/sm/kiem3.webp', artName: 'kiem', tier: 3, size: 'sm' }
 *   getEquipmentImage({ artName: 'nhan', tier: 7, size: 'md' })
 *     → { url: '/equipment/md/nhan7.webp', artName: 'nhan', tier: 7, size: 'md' }
 */
export function getEquipmentImage(
  input: EquipmentImageInput,
): EquipmentImageResolved | null {
  const tier = clampTier(input.tier ?? null);
  if (tier === null) return null;
  const artName = input.artName ?? resolveArtName(input.slot);
  if (!artName) return null;
  const size: EquipmentArtSize = input.size ?? 'sm';
  return {
    url: `/equipment/${size}/${artName}${tier}.webp`,
    artName,
    tier,
    size,
  };
}

export const __equipmentImageTest = {
  resolveArtName,
  clampTier,
  SLOT_ART_NAME,
  LOOSE_SLOT_ART_NAME,
};
