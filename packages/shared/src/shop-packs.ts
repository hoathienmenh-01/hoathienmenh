/**
 * Phase 25.2 — Limited Resource Shop Packs (shared catalog).
 *
 * Static pack definitions with purchase-limit windows, reward validators,
 * and window-key helpers. Server runtime enforces limits via
 * `ShopPackPurchase` persistence; UI reads remaining limits from API.
 *
 * Rules:
 *   - No top-tier equipment direct sale.
 *   - No max-star/max-awaken pháp bảo.
 *   - No `requiredRealmOrder` bypass items.
 *   - No unlimited material/dungeon access.
 *   - Spender advantage capped 20-40%.
 *   - F2P always has farm path.
 */

import type { MonetizationReward, MonetizationRewardKind } from './monetization';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShopPackCategory =
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'EVENT'
  | 'STARTER'
  | 'VIP';

export type PurchaseLimitWindow =
  | 'DAY'
  | 'WEEK'
  | 'MONTH'
  | 'SEASON'
  | 'LIFETIME';

export interface ShopPackDef {
  packId: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  category: ShopPackCategory;
  /** Currency used to buy: 'tienNgoc' or 'tienNgocKhoa'. */
  priceCurrency: 'tienNgoc' | 'tienNgocKhoa';
  priceAmount: number;
  purchaseLimit: number;
  purchaseLimitWindow: PurchaseLimitWindow;
  requiredRealmOrder?: number;
  maxRealmOrder?: number;
  vipRequired?: number;
  rewards: readonly MonetizationReward[];
  startsAt?: string;
  endsAt?: string;
  active: boolean;
  tags: readonly string[];
}

export interface ShopPackView extends ShopPackDef {
  remainingPurchases: number;
}

// ---------------------------------------------------------------------------
// Reward helpers (reuse from monetization)
// ---------------------------------------------------------------------------

function currency(key: string, qty: number): MonetizationReward {
  return { kind: 'currency', key, qty };
}

function item(key: string, qty: number): MonetizationReward {
  return { kind: 'item', key, qty };
}

// ---------------------------------------------------------------------------
// Forbidden reward keys (same as monetization)
// ---------------------------------------------------------------------------

const DIRECT_EQUIPMENT_TOP_KEYS = new Set([
  'tien_huyen_kiem',
  'tien_huyen_giap',
  'than_dan',
]);

const FORBIDDEN_ARTIFACT_KEYS = new Set([
  'hau_tho_tran_hon_an',
  'ban_nguyen_chi_bao',
  'hu_khong_chi_bao',
]);

const MAX_PACK_ITEM_QTY: Readonly<Record<string, number>> = {
  tinh_thiet: 30,
  yeu_dan: 15,
  han_ngoc: 8,
  phap_bao_shard: 12,
  awaken_stone: 2,
  refine_protection_charm: 3,
  linh_thao: 20,
  phu_van_ngoc: 8,
  tien_kim_sa: 8,
  son_coc_yeu_phu: 3,
  hac_lam_yeu_phu: 3,
  moc_huyen_lam_phu: 2,
  thuy_long_uyen_phu: 2,
  hoa_diem_son_phu: 2,
  hoang_tho_huyet_phu: 2,
  ho_kiep_phu: 2,
};

// ---------------------------------------------------------------------------
// Reward validator
// ---------------------------------------------------------------------------

export function validateShopPackReward(reward: MonetizationReward): boolean {
  if (!Number.isInteger(reward.qty) || reward.qty <= 0) return false;
  if (reward.kind === 'currency') {
    if (!['linhThach', 'tienNgocKhoa'].includes(reward.key)) return false;
    if (reward.key === 'linhThach') return reward.qty <= 10_000;
    return reward.qty <= 100;
  }
  if (reward.kind === 'cosmetic') {
    return ['title_', 'aura_', 'frame_'].some((p) => reward.key.startsWith(p));
  }
  if (DIRECT_EQUIPMENT_TOP_KEYS.has(reward.key)) return false;
  if (FORBIDDEN_ARTIFACT_KEYS.has(reward.key)) return false;
  const maxQty = MAX_PACK_ITEM_QTY[reward.key];
  if (maxQty !== undefined) return reward.qty <= maxQty;
  return reward.qty <= 20;
}

// ---------------------------------------------------------------------------
// Pack catalog
// ---------------------------------------------------------------------------

export const SHOP_PACKS: readonly ShopPackDef[] = [
  {
    packId: 'daily_cultivation_support',
    nameVi: 'Gói Tu Luyện Hằng Ngày',
    nameEn: 'Daily Cultivation Support Pack',
    descriptionVi: 'Hỗ trợ tu luyện mỗi ngày: linh thạch, đá luyện khí, tinh thiết.',
    descriptionEn: 'Daily cultivation boost: spirit stones, refining materials, and ore.',
    category: 'DAILY',
    priceCurrency: 'tienNgoc',
    priceAmount: 50,
    purchaseLimit: 1,
    purchaseLimitWindow: 'DAY',
    rewards: [
      currency('linhThach', 2_000),
      item('tinh_thiet', 5),
      item('linh_thao', 5),
    ],
    active: true,
    tags: ['equipment', 'cultivation'],
  },
  {
    packId: 'weekly_equipment_forge',
    nameVi: 'Gói Luyện Trang Bị Tuần',
    nameEn: 'Weekly Equipment Forge Pack',
    descriptionVi: 'Nguyên liệu luyện trang bị hàng tuần: tinh thiết, hàn ngọc, phù bảo hộ.',
    descriptionEn: 'Weekly forging materials: ore, gems, and protection charms.',
    category: 'WEEKLY',
    priceCurrency: 'tienNgoc',
    priceAmount: 200,
    purchaseLimit: 1,
    purchaseLimitWindow: 'WEEK',
    rewards: [
      item('tinh_thiet', 15),
      item('han_ngoc', 3),
      item('refine_protection_charm', 2),
    ],
    active: true,
    tags: ['equipment', 'reforge'],
  },
  {
    packId: 'weekly_gem_socket',
    nameVi: 'Gói Khảm Ngọc Tuần',
    nameEn: 'Weekly Gem Socket Pack',
    descriptionVi: 'Ngọc và nguyên liệu khảm hàng tuần.',
    descriptionEn: 'Weekly gem socketing materials.',
    category: 'WEEKLY',
    priceCurrency: 'tienNgoc',
    priceAmount: 150,
    purchaseLimit: 1,
    purchaseLimitWindow: 'WEEK',
    rewards: [
      item('han_ngoc', 4),
      item('phu_van_ngoc', 4),
      currency('linhThach', 1_500),
    ],
    active: true,
    tags: ['gem'],
  },
  {
    packId: 'weekly_reforge',
    nameVi: 'Gói Tẩy Luyện Tuần',
    nameEn: 'Weekly Reforge Pack',
    descriptionVi: 'Nguyên liệu tẩy luyện trang bị hàng tuần.',
    descriptionEn: 'Weekly reforging materials.',
    category: 'WEEKLY',
    priceCurrency: 'tienNgoc',
    priceAmount: 180,
    purchaseLimit: 1,
    purchaseLimitWindow: 'WEEK',
    rewards: [
      item('tinh_thiet', 10),
      item('linh_thao', 8),
      currency('linhThach', 2_000),
    ],
    active: true,
    tags: ['equipment', 'reforge'],
  },
  {
    packId: 'weekly_phap_bao_essence',
    nameVi: 'Gói Tinh Hoa Pháp Bảo Tuần',
    nameEn: 'Weekly Pháp Bảo Essence Pack',
    descriptionVi: 'Mảnh pháp bảo, nguyên liệu thức tỉnh, và phù hỗ trợ.',
    descriptionEn: 'Artifact shards, awaken stones, and support talismans.',
    category: 'WEEKLY',
    priceCurrency: 'tienNgoc',
    priceAmount: 250,
    purchaseLimit: 1,
    purchaseLimitWindow: 'WEEK',
    rewards: [
      item('phap_bao_shard', 6),
      item('awaken_stone', 1),
      item('son_coc_yeu_phu', 1),
    ],
    active: true,
    tags: ['phapBao'],
  },
  {
    packId: 'monthly_protection_charm',
    nameVi: 'Gói Bảo Hộ Phù Tháng',
    nameEn: 'Monthly Protection Charm Pack',
    descriptionVi: 'Phù bảo hộ cường hóa và nguyên liệu quý hàng tháng.',
    descriptionEn: 'Monthly protection charms and rare materials.',
    category: 'MONTHLY',
    priceCurrency: 'tienNgoc',
    priceAmount: 400,
    purchaseLimit: 1,
    purchaseLimitWindow: 'MONTH',
    rewards: [
      item('refine_protection_charm', 3),
      item('phap_bao_shard', 8),
      item('han_ngoc', 5),
      currency('linhThach', 5_000),
    ],
    active: true,
    tags: ['equipment', 'phapBao'],
  },
  {
    packId: 'starter_growth',
    nameVi: 'Gói Khởi Đầu Tu Sĩ',
    nameEn: 'Starter Growth Pack',
    descriptionVi: 'Mua một lần duy nhất: bộ nguyên liệu khởi đầu đầy đủ.',
    descriptionEn: 'One-time starter materials bundle.',
    category: 'STARTER',
    priceCurrency: 'tienNgoc',
    priceAmount: 100,
    purchaseLimit: 1,
    purchaseLimitWindow: 'LIFETIME',
    rewards: [
      currency('linhThach', 5_000),
      item('tinh_thiet', 20),
      item('linh_thao', 15),
      item('yeu_dan', 10),
      item('refine_protection_charm', 1),
    ],
    active: true,
    tags: ['equipment', 'cultivation'],
  },
  {
    packId: 'event_ngu_hanh_material',
    nameVi: 'Gói Ngũ Hành Nguyên Liệu',
    nameEn: 'Event Ngũ Hành Material Pack',
    descriptionVi: 'Nguyên liệu ngũ hành đặc biệt, giới hạn sự kiện.',
    descriptionEn: 'Limited event elemental materials pack.',
    category: 'EVENT',
    priceCurrency: 'tienNgoc',
    priceAmount: 300,
    purchaseLimit: 2,
    purchaseLimitWindow: 'WEEK',
    rewards: [
      item('tien_kim_sa', 5),
      item('han_ngoc', 4),
      item('linh_thao', 10),
      item('tinh_thiet', 10),
    ],
    active: true,
    tags: ['equipment', 'gem'],
  },
] as const;

// ---------------------------------------------------------------------------
// Pack lookup
// ---------------------------------------------------------------------------

export function getShopPackById(packId: string): ShopPackDef | undefined {
  return SHOP_PACKS.find((p) => p.packId === packId);
}

export function getActiveShopPacks(now: Date = new Date()): readonly ShopPackDef[] {
  return SHOP_PACKS.filter((p) => {
    if (!p.active) return false;
    if (p.startsAt && now < new Date(p.startsAt)) return false;
    if (p.endsAt && now >= new Date(p.endsAt)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Pack validator
// ---------------------------------------------------------------------------

export function validateShopPackDef(pack: ShopPackDef): boolean {
  if (!pack.packId || !pack.nameVi || !pack.nameEn) return false;
  if (pack.priceAmount <= 0) return false;
  if (pack.purchaseLimit <= 0) return false;
  if (pack.rewards.length === 0) return false;
  return pack.rewards.every(validateShopPackReward);
}

// ---------------------------------------------------------------------------
// Purchase window key
// ---------------------------------------------------------------------------

export function getPurchaseWindowKey(
  window: PurchaseLimitWindow,
  now: Date = new Date(),
): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  switch (window) {
    case 'DAY':
      return `${y}-${m}-${d}`;
    case 'WEEK': {
      const jan1 = new Date(Date.UTC(y, 0, 1));
      const dayOfYear = Math.floor((now.getTime() - jan1.getTime()) / 86_400_000);
      const week = Math.ceil((dayOfYear + jan1.getUTCDay() + 1) / 7);
      return `${y}-W${String(week).padStart(2, '0')}`;
    }
    case 'MONTH':
      return `${y}-${m}`;
    case 'SEASON':
      return `${y}-Q${Math.ceil((now.getUTCMonth() + 1) / 3)}`;
    case 'LIFETIME':
      return 'LIFETIME';
  }
}

// ---------------------------------------------------------------------------
// Realm gate check
// ---------------------------------------------------------------------------

export function canPurchaseShopPack(
  pack: ShopPackDef,
  realmOrder: number,
  vipLevel = 0,
  now: Date = new Date(),
): { ok: boolean; reason?: string } {
  if (!pack.active) return { ok: false, reason: 'PACK_INACTIVE' };
  if (pack.startsAt && now < new Date(pack.startsAt))
    return { ok: false, reason: 'PACK_NOT_STARTED' };
  if (pack.endsAt && now >= new Date(pack.endsAt))
    return { ok: false, reason: 'PACK_EXPIRED' };
  if (pack.requiredRealmOrder !== undefined && realmOrder < pack.requiredRealmOrder)
    return { ok: false, reason: 'REALM_TOO_LOW' };
  if (pack.maxRealmOrder !== undefined && realmOrder > pack.maxRealmOrder)
    return { ok: false, reason: 'REALM_TOO_HIGH' };
  if (pack.vipRequired !== undefined && vipLevel < pack.vipRequired)
    return { ok: false, reason: 'VIP_REQUIRED' };
  return { ok: true };
}
