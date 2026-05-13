/**
 * Phase 27.0 — Monetization Foundation (catalog).
 *
 * Mục tiêu: foundation cho thẻ tháng/Nguyệt Tạp, pass tiện ích, vé quét,
 * mua thêm lượt, mở slot, quỹ trưởng thành cảnh giới. Không bán thắng
 * thẳng (no top công pháp / pháp bảo / Đan Vân endgame); chỉ bán
 * tiện ích / thời gian / lượt trong giới hạn.
 *
 * Toàn bộ catalog ở đây là **pure data** + **pure helper**:
 *   - Server (`apps/api`) load catalog → enforce cap, debit currency,
 *     log ledger qua `MonetizationShopPurchase` + `CurrencyLedger`.
 *   - Web (`apps/web`) load catalog (qua API hoặc direct import) → render
 *     shop / monthly cards / sweep / growth fund UI.
 *
 * Catalog level test: `validateMonetizationFoundationCatalog()` đảm bảo
 * cap nằm trong `MONETIZATION_MAX_*` (xem `monetization.ts`) — vi phạm
 * = anti-P2W invariant FAIL.
 */

import type { MonetizationReward } from './monetization';

// ─── Currency keys (unified wallet) ────────────────────────────────────────

export const WALLET_CURRENCY_KEYS = [
  'TIEN_NGOC',
  'TIEN_NGOC_KHOA',
  'LINH_THACH',
  'CONG_HIEN_TONG_MON',
  'TRIAL_POINT',
  'EVENT_TOKEN',
] as const;

export type WalletCurrencyKey = (typeof WALLET_CURRENCY_KEYS)[number];

export interface WalletCurrencyDef {
  key: WalletCurrencyKey;
  nameVi: string;
  nameEn: string;
  /** Premium = mua bằng tiền thật. */
  premium: boolean;
  /** `true` = không thể giao dịch / trade với người chơi khác. */
  bound: boolean;
  /** Mô tả nguồn nhận chính (cho tooltip / UI). */
  sourceHintVi: string;
}

export const WALLET_CURRENCIES: readonly WalletCurrencyDef[] = [
  {
    key: 'TIEN_NGOC',
    nameVi: 'Tiên Ngọc',
    nameEn: 'Immortal Jade',
    premium: true,
    bound: false,
    sourceHintVi: 'Nạp tiền thật hoặc admin grant.',
  },
  {
    key: 'TIEN_NGOC_KHOA',
    nameVi: 'Tiên Ngọc Khoá',
    nameEn: 'Bound Immortal Jade',
    premium: true,
    bound: true,
    sourceHintVi: 'Thẻ tháng, pass, nhiệm vụ, event, bồi thường.',
  },
  {
    key: 'LINH_THACH',
    nameVi: 'Linh Thạch',
    nameEn: 'Spirit Stone',
    premium: false,
    bound: false,
    sourceHintVi: 'Farm, nhiệm vụ, bán đồ, chợ.',
  },
  {
    key: 'CONG_HIEN_TONG_MON',
    nameVi: 'Cống Hiến Tông Môn',
    nameEn: 'Sect Contribution',
    premium: false,
    bound: true,
    sourceHintVi: 'Nhiệm vụ / boss / bí cảnh tông môn.',
  },
  {
    key: 'TRIAL_POINT',
    nameVi: 'Điểm Tháp',
    nameEn: 'Trial Point',
    premium: false,
    bound: true,
    sourceHintVi: 'Đăng Tiên Tháp / Linh Khí Tháp / Huyết Thể Tháp.',
  },
  {
    key: 'EVENT_TOKEN',
    nameVi: 'Điểm Sự Kiện',
    nameEn: 'Event Token',
    premium: false,
    bound: true,
    sourceHintVi: 'Hoạt động mùa, event pass.',
  },
] as const;

export function getWalletCurrencyDef(key: WalletCurrencyKey): WalletCurrencyDef {
  const def = WALLET_CURRENCIES.find((c) => c.key === key);
  if (!def) throw new Error(`Unknown wallet currency: ${key}`);
  return def;
}

// ─── Entitlement keys ──────────────────────────────────────────────────────

export const ENTITLEMENT_KEYS = [
  'MONTHLY_CARD_SMALL',
  'MONTHLY_CARD_LARGE',
  'AUTO_FARM_EXTENDED',
  'DAILY_DUNGEON_EXTRA_ATTEMPT',
  'SWEEP_TICKET_DAILY',
  'ALCHEMY_QUEUE_SLOT',
  'BODY_TRIAL_EXTRA_ATTEMPT',
  'MARKET_SLOT_BONUS',
  'INVENTORY_SLOT_BONUS',
] as const;

export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

export interface EntitlementDef {
  key: EntitlementKey;
  nameVi: string;
  nameEn: string;
  /** Anti-P2W: cap tối đa giá trị runtime mà entitlement này được phép trả về. */
  maxValue: number;
  /** Hint mô tả tác dụng — dùng cho UI tooltip. */
  descriptionVi: string;
}

/**
 * Cap tối đa cho `EntitlementDef.maxValue` — tránh PR sau lỡ tay set
 * `INVENTORY_SLOT_BONUS = 9999` → đập kinh tế.
 */
export const ENTITLEMENT_VALUE_CAPS: Readonly<Record<EntitlementKey, number>> = {
  MONTHLY_CARD_SMALL: 1,
  MONTHLY_CARD_LARGE: 1,
  AUTO_FARM_EXTENDED: 24 * 60, // phút — auto farm phiên tối đa 24h
  DAILY_DUNGEON_EXTRA_ATTEMPT: 2,
  SWEEP_TICKET_DAILY: 3,
  ALCHEMY_QUEUE_SLOT: 2,
  BODY_TRIAL_EXTRA_ATTEMPT: 1,
  MARKET_SLOT_BONUS: 10,
  INVENTORY_SLOT_BONUS: 100,
};

export const ENTITLEMENTS: readonly EntitlementDef[] = [
  {
    key: 'MONTHLY_CARD_SMALL',
    nameVi: 'Tiểu Nguyệt Tạp',
    nameEn: 'Small Monthly Card',
    maxValue: 1,
    descriptionVi: 'Cho phép claim quà ngày và một số tiện ích nhỏ.',
  },
  {
    key: 'MONTHLY_CARD_LARGE',
    nameVi: 'Đại Nguyệt Tạp',
    nameEn: 'Large Monthly Card',
    maxValue: 1,
    descriptionVi: 'Quyền lợi lớn hơn, auto farm dài hơn, thêm lượt.',
  },
  {
    key: 'AUTO_FARM_EXTENDED',
    nameVi: 'Auto Farm Dài',
    nameEn: 'Extended Auto Farm',
    maxValue: 8 * 60,
    descriptionVi: 'Tăng thời lượng phiên auto farm (phút).',
  },
  {
    key: 'DAILY_DUNGEON_EXTRA_ATTEMPT',
    nameVi: '+Lượt Bí Cảnh / Ngày',
    nameEn: 'Extra Dungeon Attempt',
    maxValue: 1,
    descriptionVi: 'Thêm 1 lượt bí cảnh thường / ngày.',
  },
  {
    key: 'SWEEP_TICKET_DAILY',
    nameVi: 'Vé Quét / Ngày',
    nameEn: 'Daily Sweep Ticket',
    maxValue: 2,
    descriptionVi: 'Nhận vé quét hằng ngày (claim cùng monthly card).',
  },
  {
    key: 'ALCHEMY_QUEUE_SLOT',
    nameVi: '+Hàng Chờ Luyện Đan',
    nameEn: 'Alchemy Queue Slot',
    maxValue: 1,
    descriptionVi: 'Mở thêm 1 slot hàng chờ luyện đan.',
  },
  {
    key: 'BODY_TRIAL_EXTRA_ATTEMPT',
    nameVi: '+Lượt Luyện Thể / Ngày',
    nameEn: 'Extra Body Trial Attempt',
    maxValue: 1,
    descriptionVi: 'Thêm 1 lượt thí luyện luyện thể / ngày.',
  },
  {
    key: 'MARKET_SLOT_BONUS',
    nameVi: '+Slot Chợ',
    nameEn: 'Market Slot Bonus',
    maxValue: 10,
    descriptionVi: 'Tăng slot đăng bán ở chợ.',
  },
  {
    key: 'INVENTORY_SLOT_BONUS',
    nameVi: '+Slot Túi / Kho',
    nameEn: 'Inventory Slot Bonus',
    maxValue: 100,
    descriptionVi: 'Mở rộng túi / kho (theo gói).',
  },
] as const;

export function getEntitlementDef(key: EntitlementKey): EntitlementDef {
  const def = ENTITLEMENTS.find((e) => e.key === key);
  if (!def) throw new Error(`Unknown entitlement: ${key}`);
  return def;
}

// ─── Monthly cards ─────────────────────────────────────────────────────────

export const MONTHLY_CARD_KEYS = [
  'tieu_nguyet_tap',
  'dai_nguyet_tap',
  'the_luyen_dan',
  'the_luyen_the',
  'the_thuong_hoi',
] as const;

export type MonthlyCardKey = (typeof MONTHLY_CARD_KEYS)[number];

export interface MonthlyCardEntitlementGrant {
  key: EntitlementKey;
  /** Giá trị runtime — cap bởi `ENTITLEMENT_VALUE_CAPS`. */
  value: number;
}

export interface MonthlyCardVariantDef {
  key: MonthlyCardKey;
  nameVi: string;
  nameEn: string;
  priceCurrency: WalletCurrencyKey;
  priceAmount: number;
  durationDays: number;
  /** Daily reward được claim 1 lần / ngày khi card còn hạn. */
  dailyReward: readonly MonetizationReward[];
  /** Upfront reward được grant ngay tại purchase. */
  upfrontReward: readonly MonetizationReward[];
  /** Entitlement được active suốt thời gian card còn hạn. */
  entitlements: readonly MonthlyCardEntitlementGrant[];
  descriptionVi: string;
}

const DEFAULT_MONTHLY_DURATION_DAYS = 30;

export const MONTHLY_CARD_VARIANTS: readonly MonthlyCardVariantDef[] = [
  {
    key: 'tieu_nguyet_tap',
    nameVi: 'Tiểu Nguyệt Tạp',
    nameEn: 'Small Monthly Card',
    priceCurrency: 'TIEN_NGOC',
    priceAmount: 90,
    durationDays: DEFAULT_MONTHLY_DURATION_DAYS,
    dailyReward: [
      { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 10 },
    ],
    upfrontReward: [
      { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 60 },
    ],
    entitlements: [
      { key: 'MONTHLY_CARD_SMALL', value: 1 },
      { key: 'SWEEP_TICKET_DAILY', value: 1 },
      { key: 'AUTO_FARM_EXTENDED', value: 4 * 60 },
    ],
    descriptionVi:
      'Daily Tiên Ngọc Khoá nhỏ + auto farm dài hơn + 1 vé quét / ngày. Không tăng sát thương / drop hiếm.',
  },
  {
    key: 'dai_nguyet_tap',
    nameVi: 'Đại Nguyệt Tạp',
    nameEn: 'Large Monthly Card',
    priceCurrency: 'TIEN_NGOC',
    priceAmount: 250,
    durationDays: DEFAULT_MONTHLY_DURATION_DAYS,
    dailyReward: [
      { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 25 },
    ],
    upfrontReward: [
      { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 150 },
    ],
    entitlements: [
      { key: 'MONTHLY_CARD_LARGE', value: 1 },
      { key: 'SWEEP_TICKET_DAILY', value: 2 },
      { key: 'AUTO_FARM_EXTENDED', value: 8 * 60 },
      { key: 'DAILY_DUNGEON_EXTRA_ATTEMPT', value: 1 },
    ],
    descriptionVi:
      'Quyền lợi lớn: +1 lượt bí cảnh thường, 2 vé quét / ngày, auto farm 8h, vẫn giữ daily cap.',
  },
  {
    key: 'the_luyen_dan',
    nameVi: 'Thẻ Luyện Đan',
    nameEn: 'Alchemy Card',
    priceCurrency: 'TIEN_NGOC',
    priceAmount: 120,
    durationDays: DEFAULT_MONTHLY_DURATION_DAYS,
    dailyReward: [
      { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 8 },
    ],
    upfrontReward: [],
    entitlements: [{ key: 'ALCHEMY_QUEUE_SLOT', value: 1 }],
    descriptionVi:
      '+1 hàng chờ luyện đan. Không tăng Đan Vân / công thức endgame.',
  },
  {
    key: 'the_luyen_the',
    nameVi: 'Thẻ Luyện Thể',
    nameEn: 'Body Cultivation Card',
    priceCurrency: 'TIEN_NGOC',
    priceAmount: 120,
    durationDays: DEFAULT_MONTHLY_DURATION_DAYS,
    dailyReward: [
      { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 8 },
    ],
    upfrontReward: [],
    entitlements: [{ key: 'BODY_TRIAL_EXTRA_ATTEMPT', value: 1 }],
    descriptionVi:
      '+1 lượt thí luyện luyện thể / ngày. Không bán bodyExp khổng lồ.',
  },
  {
    key: 'the_thuong_hoi',
    nameVi: 'Thẻ Thương Hội',
    nameEn: 'Merchant Guild Card',
    priceCurrency: 'TIEN_NGOC',
    priceAmount: 120,
    durationDays: DEFAULT_MONTHLY_DURATION_DAYS,
    dailyReward: [
      { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 8 },
    ],
    upfrontReward: [],
    entitlements: [{ key: 'MARKET_SLOT_BONUS', value: 5 }],
    descriptionVi:
      'Tăng slot chợ. Không sinh tài nguyên mới — chỉ tiện ích trade.',
  },
] as const;

export function getMonthlyCardVariant(key: string): MonthlyCardVariantDef | undefined {
  return MONTHLY_CARD_VARIANTS.find((c) => c.key === key);
}

// ─── Shop products (limited) ───────────────────────────────────────────────

export const SHOP_PRODUCT_TYPES = [
  'MONTHLY_CARD',
  'SWEEP_TICKET',
  'EXTRA_ATTEMPT',
  'INVENTORY_SLOT',
  'QUEUE_SLOT',
  'MARKET_SLOT',
  'BATTLE_PASS_PREMIUM',
  'GROWTH_FUND',
  'LIMITED_BUNDLE',
  'NAME_CHANGE',
  'SOCIAL_PRESTIGE',
] as const;

export type ShopProductType = (typeof SHOP_PRODUCT_TYPES)[number];

export const PURCHASE_LIMIT_TYPES = ['DAILY', 'WEEKLY', 'MONTHLY', 'LIFETIME', 'NONE'] as const;

export type PurchaseLimitType = (typeof PURCHASE_LIMIT_TYPES)[number];

export interface ShopProductDef {
  key: string;
  nameVi: string;
  nameEn: string;
  productType: ShopProductType;
  priceCurrency: WalletCurrencyKey;
  priceAmount: number;
  reward: readonly MonetizationReward[];
  /** Nếu sản phẩm là MONTHLY_CARD, ref tới `MonthlyCardVariantDef.key`. */
  monthlyCardKey?: MonthlyCardKey;
  /** Nếu sản phẩm là EXTRA_ATTEMPT, ref tới `EXTRA_ATTEMPT_LIMITS` key. */
  extraAttemptLimitKey?: ExtraAttemptLimitKey;
  /** Nếu sản phẩm là GROWTH_FUND, ref tới `GROWTH_FUND_VARIANTS.key`. */
  growthFundKey?: GrowthFundKey;
  /** Entitlement grant kèm theo (vd MARKET_SLOT). */
  entitlement?: MonthlyCardEntitlementGrant;
  /** Số ngày entitlement còn hạn (nếu có grant). */
  entitlementDurationDays?: number;
  purchaseLimitType: PurchaseLimitType;
  purchaseLimitCount: number;
  enabled: boolean;
  descriptionVi: string;
}

export const SHOP_PRODUCTS: readonly ShopProductDef[] = [
  // Monthly cards
  ...MONTHLY_CARD_VARIANTS.map<ShopProductDef>((card) => ({
    key: `monthly_card_${card.key}`,
    nameVi: card.nameVi,
    nameEn: card.nameEn,
    productType: 'MONTHLY_CARD',
    priceCurrency: card.priceCurrency,
    priceAmount: card.priceAmount,
    reward: card.upfrontReward,
    monthlyCardKey: card.key,
    purchaseLimitType: 'NONE',
    purchaseLimitCount: 0,
    enabled: true,
    descriptionVi: card.descriptionVi,
  })),
  // Sweep tickets — bound currency only (anti-trade)
  {
    key: 'sweep_ticket_x5',
    nameVi: 'Vé Quét × 5',
    nameEn: 'Sweep Ticket × 5',
    productType: 'SWEEP_TICKET',
    priceCurrency: 'TIEN_NGOC_KHOA',
    priceAmount: 60,
    reward: [{ kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 0 }],
    purchaseLimitType: 'DAILY',
    purchaseLimitCount: 3,
    enabled: true,
    descriptionVi: '5 vé quét dùng cho nội dung đã clear. Vẫn tính daily cap.',
  },
  // Extra attempts — sold via dedicated endpoint, exposed as catalog entries
  {
    key: 'extra_attempt_dungeon',
    nameVi: '+Lượt Bí Cảnh Thường',
    nameEn: '+Daily Dungeon Attempt',
    productType: 'EXTRA_ATTEMPT',
    priceCurrency: 'TIEN_NGOC_KHOA',
    priceAmount: 30,
    reward: [],
    extraAttemptLimitKey: 'DAILY_DUNGEON',
    purchaseLimitType: 'DAILY',
    purchaseLimitCount: 2,
    enabled: true,
    descriptionVi: 'Mua thêm 1 lượt bí cảnh thường / ngày. Tối đa 2 lượt / ngày.',
  },
  {
    key: 'extra_attempt_boss',
    nameVi: '+Lượt Boss Cá Nhân',
    nameEn: '+Personal Boss Attempt',
    productType: 'EXTRA_ATTEMPT',
    priceCurrency: 'TIEN_NGOC_KHOA',
    priceAmount: 50,
    reward: [],
    extraAttemptLimitKey: 'PERSONAL_BOSS',
    purchaseLimitType: 'DAILY',
    purchaseLimitCount: 1,
    enabled: true,
    descriptionVi: 'Mua thêm 1 lượt boss cá nhân / ngày.',
  },
  {
    key: 'extra_attempt_farm',
    nameVi: '+Lượt Farm Map',
    nameEn: '+Farm Map Session',
    productType: 'EXTRA_ATTEMPT',
    priceCurrency: 'TIEN_NGOC_KHOA',
    priceAmount: 20,
    reward: [],
    extraAttemptLimitKey: 'FARM_MAP',
    purchaseLimitType: 'DAILY',
    purchaseLimitCount: 2,
    enabled: true,
    descriptionVi: 'Mua thêm phiên farm map / ngày. Tối đa 2 phiên / ngày.',
  },
  // Slot expansions — lifetime
  {
    key: 'inventory_slot_pack',
    nameVi: 'Mở Rộng Túi (+50 slot, 30 ngày)',
    nameEn: 'Inventory Expansion (+50, 30d)',
    productType: 'INVENTORY_SLOT',
    priceCurrency: 'TIEN_NGOC',
    priceAmount: 80,
    reward: [],
    entitlement: { key: 'INVENTORY_SLOT_BONUS', value: 50 },
    entitlementDurationDays: 30,
    purchaseLimitType: 'MONTHLY',
    purchaseLimitCount: 2,
    enabled: true,
    descriptionVi: 'Mở thêm 50 ô túi trong 30 ngày.',
  },
  {
    key: 'alchemy_queue_slot_pack',
    nameVi: '+1 Hàng Chờ Luyện Đan (30 ngày)',
    nameEn: '+1 Alchemy Queue Slot (30d)',
    productType: 'QUEUE_SLOT',
    priceCurrency: 'TIEN_NGOC',
    priceAmount: 60,
    reward: [],
    entitlement: { key: 'ALCHEMY_QUEUE_SLOT', value: 1 },
    entitlementDurationDays: 30,
    purchaseLimitType: 'MONTHLY',
    purchaseLimitCount: 1,
    enabled: true,
    descriptionVi: 'Thêm 1 slot hàng chờ luyện đan trong 30 ngày.',
  },
  {
    key: 'market_slot_pack',
    nameVi: '+5 Slot Chợ (30 ngày)',
    nameEn: '+5 Market Slots (30d)',
    productType: 'MARKET_SLOT',
    priceCurrency: 'TIEN_NGOC',
    priceAmount: 50,
    reward: [],
    entitlement: { key: 'MARKET_SLOT_BONUS', value: 5 },
    entitlementDurationDays: 30,
    purchaseLimitType: 'MONTHLY',
    purchaseLimitCount: 2,
    enabled: true,
    descriptionVi: 'Mở thêm 5 slot đăng bán ở chợ trong 30 ngày.',
  },
  // Battle pass premium unlock — foundation hookup
  {
    key: 'battle_pass_premium_unlock',
    nameVi: 'Mở Tiên Lộ Lệnh Cao Cấp',
    nameEn: 'Unlock Premium Battle Pass',
    productType: 'BATTLE_PASS_PREMIUM',
    priceCurrency: 'TIEN_NGOC',
    priceAmount: 200,
    reward: [],
    purchaseLimitType: 'LIFETIME',
    purchaseLimitCount: 1,
    enabled: true,
    descriptionVi: 'Mở nhánh cao cấp của Tiên Lộ Lệnh mùa hiện tại.',
  },
  // Growth fund — foundation
  {
    key: 'growth_fund_pham',
    nameVi: 'Quỹ Trưởng Thành — Phàm',
    nameEn: 'Growth Fund — Mortal',
    productType: 'GROWTH_FUND',
    priceCurrency: 'TIEN_NGOC',
    priceAmount: 320,
    reward: [],
    growthFundKey: 'pham',
    purchaseLimitType: 'LIFETIME',
    purchaseLimitCount: 1,
    enabled: true,
    descriptionVi:
      'Mua 1 lần. Nhận thưởng theo mốc Luyện Khí → Hoá Thần. Không vượt cảnh giới.',
  },
  // Misc one-shots
  {
    key: 'name_change',
    nameVi: 'Đổi Tên Nhân Vật',
    nameEn: 'Character Name Change',
    productType: 'NAME_CHANGE',
    priceCurrency: 'TIEN_NGOC',
    priceAmount: 100,
    reward: [],
    purchaseLimitType: 'MONTHLY',
    purchaseLimitCount: 1,
    enabled: true,
    descriptionVi: 'Đổi tên hiển thị nhân vật. 1 lần / tháng.',
  },
  {
    key: 'limited_starter_bundle',
    nameVi: 'Gói Tân Thủ Giới Hạn',
    nameEn: 'Limited Starter Bundle',
    productType: 'LIMITED_BUNDLE',
    priceCurrency: 'TIEN_NGOC',
    priceAmount: 30,
    reward: [
      { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 100 },
      { kind: 'currency', key: 'LINH_THACH', qty: 2000 },
    ],
    purchaseLimitType: 'LIFETIME',
    purchaseLimitCount: 1,
    enabled: true,
    descriptionVi: 'Gói tân thủ — chỉ mua 1 lần / tài khoản.',
  },
] as const;

export function getShopProduct(key: string): ShopProductDef | undefined {
  return SHOP_PRODUCTS.find((p) => p.key === key);
}

// ─── Sweep ticket rules ────────────────────────────────────────────────────

export const SWEEPABLE_CONTENT_TYPES = ['DUNGEON', 'FARM_MAP', 'SECT_DUNGEON'] as const;

export type SweepableContentType = (typeof SWEEPABLE_CONTENT_TYPES)[number];

export const NON_SWEEPABLE_CONTENT_TYPES = [
  'WORLD_BOSS',
  'TRIAL_TOWER',
  'ARENA',
  'COOP_BOSS',
  'STORY_DUNGEON',
] as const;

export type NonSweepableContentType = (typeof NON_SWEEPABLE_CONTENT_TYPES)[number];

export function canSweepContentType(type: string): type is SweepableContentType {
  return (SWEEPABLE_CONTENT_TYPES as readonly string[]).includes(type);
}

// ─── Extra attempt limits ──────────────────────────────────────────────────

export const EXTRA_ATTEMPT_LIMIT_KEYS = [
  'DAILY_DUNGEON',
  'PERSONAL_BOSS',
  'FARM_MAP',
] as const;

export type ExtraAttemptLimitKey = (typeof EXTRA_ATTEMPT_LIMIT_KEYS)[number];

export interface ExtraAttemptLimitDef {
  key: ExtraAttemptLimitKey;
  nameVi: string;
  /** Tối đa số lượt mua thêm / ngày — anti-P2W cap. */
  maxPerDay: number;
}

export const EXTRA_ATTEMPT_LIMITS: readonly ExtraAttemptLimitDef[] = [
  { key: 'DAILY_DUNGEON', nameVi: 'Bí cảnh thường', maxPerDay: 2 },
  { key: 'PERSONAL_BOSS', nameVi: 'Boss cá nhân', maxPerDay: 1 },
  { key: 'FARM_MAP', nameVi: 'Farm map', maxPerDay: 2 },
] as const;

export function getExtraAttemptLimit(key: string): ExtraAttemptLimitDef | undefined {
  return EXTRA_ATTEMPT_LIMITS.find((l) => l.key === key);
}

// ─── Growth fund ───────────────────────────────────────────────────────────

export const GROWTH_FUND_KEYS = ['pham'] as const;

export type GrowthFundKey = (typeof GROWTH_FUND_KEYS)[number];

export interface GrowthFundMilestoneDef {
  key: string;
  /** Realm key trong shared `REALMS` (vd `luyenkhi`, `truc_co`, …). */
  realmKey: string;
  /** `realm.order` snapshot — dùng cho cmp nhanh. */
  realmOrder: number;
  nameVi: string;
  reward: readonly MonetizationReward[];
}

export interface GrowthFundVariantDef {
  key: GrowthFundKey;
  nameVi: string;
  nameEn: string;
  priceCurrency: WalletCurrencyKey;
  priceAmount: number;
  milestones: readonly GrowthFundMilestoneDef[];
  descriptionVi: string;
}

export const GROWTH_FUND_VARIANTS: readonly GrowthFundVariantDef[] = [
  {
    key: 'pham',
    nameVi: 'Quỹ Trưởng Thành — Phàm',
    nameEn: 'Growth Fund — Mortal',
    priceCurrency: 'TIEN_NGOC',
    priceAmount: 320,
    descriptionVi:
      'Mua 1 lần. Nhận thưởng theo mốc Luyện Khí → Hoá Thần. Không vượt cảnh giới.',
    milestones: [
      {
        key: 'luyenkhi',
        realmKey: 'luyenkhi',
        realmOrder: 1,
        nameVi: 'Đạt Luyện Khí',
        reward: [
          { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 80 },
          { kind: 'currency', key: 'LINH_THACH', qty: 1000 },
        ],
      },
      {
        key: 'truc_co',
        realmKey: 'truc_co',
        realmOrder: 2,
        nameVi: 'Đạt Trúc Cơ',
        reward: [
          { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 120 },
          { kind: 'currency', key: 'LINH_THACH', qty: 2500 },
        ],
      },
      {
        key: 'kim_dan',
        realmKey: 'kim_dan',
        realmOrder: 3,
        nameVi: 'Đạt Kim Đan',
        reward: [
          { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 180 },
          { kind: 'currency', key: 'LINH_THACH', qty: 4500 },
        ],
      },
      {
        key: 'nguyen_anh',
        realmKey: 'nguyen_anh',
        realmOrder: 4,
        nameVi: 'Đạt Nguyên Anh',
        reward: [
          { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 240 },
          { kind: 'currency', key: 'LINH_THACH', qty: 7500 },
        ],
      },
      {
        key: 'hoa_than',
        realmKey: 'hoa_than',
        realmOrder: 5,
        nameVi: 'Đạt Hoá Thần',
        reward: [
          { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 320 },
          { kind: 'currency', key: 'LINH_THACH', qty: 12_000 },
        ],
      },
    ],
  },
] as const;

export function getGrowthFundVariant(key: string): GrowthFundVariantDef | undefined {
  return GROWTH_FUND_VARIANTS.find((v) => v.key === key);
}

export function getGrowthFundMilestone(
  fundKey: GrowthFundKey,
  milestoneKey: string,
): GrowthFundMilestoneDef | undefined {
  const variant = getGrowthFundVariant(fundKey);
  if (!variant) return undefined;
  return variant.milestones.find((m) => m.key === milestoneKey);
}

// ─── Error codes ───────────────────────────────────────────────────────────

export const MONETIZATION_ERROR_CODES = [
  'INSUFFICIENT_CURRENCY',
  'PRODUCT_NOT_FOUND',
  'PRODUCT_DISABLED',
  'PURCHASE_LIMIT_REACHED',
  'ENTITLEMENT_EXPIRED',
  'DAILY_CLAIM_ALREADY_DONE',
  'CONTENT_NOT_CLEARED',
  'CAP_REACHED',
  'INVALID_CURRENCY',
  'TRANSACTION_CONFLICT',
  'MILESTONE_LOCKED',
  'MILESTONE_ALREADY_CLAIMED',
  'EXTRA_ATTEMPT_LIMIT_REACHED',
  'FUND_NOT_PURCHASED',
  'FUND_ALREADY_PURCHASED',
  'CARD_ALREADY_ACTIVE',
  'INACTIVE_CARD',
  'INVALID_INPUT',
] as const;

export type MonetizationErrorCode = (typeof MONETIZATION_ERROR_CODES)[number];

// ─── Period bucket helpers (server + client) ───────────────────────────────

const PERIOD_TIMEZONE_OFFSET_MS = 0; // UTC bucket — server đồng bộ với
// `CurrencyLedger` (UTC). Lý do: cap reset đồng bộ across all flows.

export function periodKey(now: Date, type: PurchaseLimitType): string {
  if (type === 'NONE' || type === 'LIFETIME') return 'lifetime';
  const t = new Date(now.getTime() + PERIOD_TIMEZONE_OFFSET_MS);
  if (type === 'DAILY') return t.toISOString().slice(0, 10);
  if (type === 'MONTHLY') return t.toISOString().slice(0, 7);
  // WEEKLY — ISO week (Mon = 0). Cheap impl: Thursday of the week → year-week.
  const date = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = Date.UTC(date.getUTCFullYear(), 0, 4);
  const firstThursdayDate = new Date(firstThursday);
  const firstThursdayDayNum = (firstThursdayDate.getUTCDay() + 6) % 7;
  firstThursdayDate.setUTCDate(firstThursdayDate.getUTCDate() - firstThursdayDayNum + 3);
  const weekNum =
    1 +
    Math.round(
      (date.getTime() - firstThursdayDate.getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// ─── Validation (catalog invariants) ───────────────────────────────────────

/**
 * Anti-P2W invariant check. Gọi từ test, fail = catalog bị edit sai cap.
 */
export function validateMonetizationFoundationCatalog(): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  for (const e of ENTITLEMENTS) {
    const cap = ENTITLEMENT_VALUE_CAPS[e.key];
    if (e.maxValue > cap) {
      errors.push(`Entitlement ${e.key} maxValue=${e.maxValue} > cap ${cap}`);
    }
  }

  for (const card of MONTHLY_CARD_VARIANTS) {
    if (card.durationDays <= 0 || card.durationDays > 60) {
      errors.push(`Monthly card ${card.key} durationDays out of range`);
    }
    if (card.priceAmount <= 0) {
      errors.push(`Monthly card ${card.key} price must be > 0`);
    }
    for (const grant of card.entitlements) {
      const cap = ENTITLEMENT_VALUE_CAPS[grant.key];
      if (grant.value > cap) {
        errors.push(
          `Monthly card ${card.key} grants ${grant.key}=${grant.value} > cap ${cap}`,
        );
      }
    }
  }

  for (const product of SHOP_PRODUCTS) {
    if (product.priceAmount <= 0) {
      errors.push(`Shop product ${product.key} price must be > 0`);
    }
    if (
      product.purchaseLimitType !== 'NONE' &&
      product.purchaseLimitCount <= 0
    ) {
      errors.push(
        `Shop product ${product.key} purchaseLimitCount must be > 0 when type != NONE`,
      );
    }
    if (
      product.productType === 'MONTHLY_CARD' &&
      !product.monthlyCardKey
    ) {
      errors.push(`Shop product ${product.key} MONTHLY_CARD missing monthlyCardKey`);
    }
    if (
      product.productType === 'EXTRA_ATTEMPT' &&
      !product.extraAttemptLimitKey
    ) {
      errors.push(
        `Shop product ${product.key} EXTRA_ATTEMPT missing extraAttemptLimitKey`,
      );
    }
    if (
      product.productType === 'GROWTH_FUND' &&
      !product.growthFundKey
    ) {
      errors.push(`Shop product ${product.key} GROWTH_FUND missing growthFundKey`);
    }
    if (product.entitlement) {
      const cap = ENTITLEMENT_VALUE_CAPS[product.entitlement.key];
      if (product.entitlement.value > cap) {
        errors.push(
          `Shop product ${product.key} grants ${product.entitlement.key}=${product.entitlement.value} > cap ${cap}`,
        );
      }
    }
  }

  for (const limit of EXTRA_ATTEMPT_LIMITS) {
    if (limit.maxPerDay <= 0 || limit.maxPerDay > 3) {
      errors.push(
        `Extra attempt limit ${limit.key} maxPerDay=${limit.maxPerDay} out of [1,3]`,
      );
    }
  }

  for (const fund of GROWTH_FUND_VARIANTS) {
    if (fund.priceAmount <= 0) {
      errors.push(`Growth fund ${fund.key} price must be > 0`);
    }
    if (fund.milestones.length === 0) {
      errors.push(`Growth fund ${fund.key} must have at least 1 milestone`);
    }
    let prevOrder = -1;
    for (const m of fund.milestones) {
      if (m.realmOrder <= prevOrder) {
        errors.push(
          `Growth fund ${fund.key} milestones not monotonic at ${m.key}`,
        );
      }
      prevOrder = m.realmOrder;
    }
  }

  return { ok: errors.length === 0, errors };
}
