/**
 * NPC Shop catalog — Phase 9.
 *
 * Static list of items NPC bán cho người chơi. Mỗi entry override hoặc
 * dùng `price` mặc định trong `ITEMS`. Currency mặc định LINH_THACH; có
 * thể đổi sang TIEN_NGOC cho item premium.
 *
 * Stock = infinite cho closed beta. `dailyLimit` opt-in per item (M10).
 */

import { ITEMS, type ItemDef } from './items';

export type ShopCurrency = 'LINH_THACH' | 'TIEN_NGOC';

export interface ShopEntryDef {
  itemKey: string;
  /** Override price; nếu undefined dùng `ItemDef.price`. */
  price?: number;
  currency: ShopCurrency;
  /**
   * M10 — Daily purchase cap per character cho item này. Reset lúc 00:00
   * theo `MISSION_RESET_TZ` (mặc định Asia/Ho_Chi_Minh). Undefined =
   * unlimited. Server tổng `qtyDelta` của ItemLedger reason='SHOP_BUY'
   * trong cửa sổ DAILY local tz; pre-check `current + qty > dailyLimit`
   * → throw `SHOP_DAILY_LIMIT`. Anti-hoard / inflation control.
   */
  dailyLimit?: number;
}

export interface ShopEntryView {
  itemKey: string;
  name: string;
  description: string;
  kind: string;
  quality: string;
  price: number;
  currency: ShopCurrency;
  stackable: boolean;
  /** M10 — Daily cap; null khi unlimited. FE hiển thị badge "X/Y today". */
  dailyLimit: number | null;
}

/**
 * Shop catalog — chỉnh ở đây để rebalance, không cần migration.
 *
 * Phase 9 closed beta: 12 entries (4 vũ khí phàm/linh, 3 giáp, 4 đan,
 * 1 quặng). Tất cả LINH_THACH. Item huyền/tiên phẩm không bán NPC để
 * khuyến khích boss/dungeon.
 */
export const NPC_SHOP: readonly ShopEntryDef[] = [
  // Pills HP (stackable, low/mid) — anti-hoard cap.
  { itemKey: 'huyet_chi_dan', currency: 'LINH_THACH', dailyLimit: 20 },
  { itemKey: 'thanh_lam_dan', currency: 'LINH_THACH', dailyLimit: 20 },
  // Pill MP
  { itemKey: 'hoi_nguyen_dan', currency: 'LINH_THACH', dailyLimit: 20 },
  // Pill EXP entry-tier (siết chặt hơn — tránh skip cultivation)
  { itemKey: 'co_thien_dan', currency: 'LINH_THACH', dailyLimit: 10 },
  // Ore — rare resource, low cap
  { itemKey: 'huyet_tinh', currency: 'LINH_THACH', dailyLimit: 10 },
  // Starter equipment phàm phẩm — non-stackable, 5 đủ trang bị 1 set
  { itemKey: 'so_kiem', currency: 'LINH_THACH', dailyLimit: 5 },
  { itemKey: 'pham_giap', currency: 'LINH_THACH', dailyLimit: 5 },
  { itemKey: 'pham_thuc_dai', currency: 'LINH_THACH', dailyLimit: 5 },
  { itemKey: 'pham_hai', currency: 'LINH_THACH', dailyLimit: 5 },
  { itemKey: 'pham_quan', currency: 'LINH_THACH', dailyLimit: 5 },
  { itemKey: 'ngoc_tram', currency: 'LINH_THACH', dailyLimit: 5 },
];

export interface ShopEntryWithDef {
  entry: ShopEntryDef;
  def: ItemDef;
  /** Giá hiệu dụng (override hoặc ItemDef.price). */
  price: number;
}

/** Entries đã merge với ItemDef. Bỏ entry trỏ tới itemKey không tồn tại. */
export function npcShopEntries(): ShopEntryWithDef[] {
  return NPC_SHOP.flatMap((e) => {
    const def = ITEMS.find((i) => i.key === e.itemKey);
    if (!def) return [];
    return [{ entry: e, def, price: e.price ?? def.price }];
  });
}

export function npcShopByKey(itemKey: string): ShopEntryWithDef | undefined {
  return npcShopEntries().find((x) => x.entry.itemKey === itemKey);
}

export function toShopEntryView(x: ShopEntryWithDef): ShopEntryView {
  return {
    itemKey: x.def.key,
    name: x.def.name,
    description: x.def.description,
    kind: x.def.kind,
    quality: x.def.quality,
    price: x.price,
    currency: x.entry.currency,
    stackable: x.def.stackable,
    dailyLimit: x.entry.dailyLimit ?? null,
  };
}
