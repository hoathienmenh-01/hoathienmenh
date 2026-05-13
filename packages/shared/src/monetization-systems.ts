/**
 * Phase 27.1–27.5 — Monetization Systems V1 (catalog).
 *
 * Mở rộng `monetization-foundation.ts` (Phase 27.0) bằng các hệ kiếm tiền
 * V1 thực sự dùng được trong game:
 *
 *   1. Battle Pass V2 — multiple seasons + mission tracking + addExp/claim
 *      free/paid + unlock-paid.
 *   2. Growth Fund V2 — bổ sung biến thể `tien` (Hợp Thể → Đại Thừa →
 *      Nhân Tiên) cho late game.
 *   3. Limited Periodic Shop — shop ngày / tuần / tháng với rotating
 *      product list + cap mua / period (phía trên shop foundation).
 *   4. Sweep ticket items — định nghĩa item key cho `sweep_ticket_*` (đã
 *      chấp nhận trong `SweepableContentType`).
 *
 * Toàn bộ vẫn pure data + pure helper. Server (`apps/api`) là source of
 * truth: enforce cap, debit currency, log ledger qua các service riêng
 * (`BattlePassV2Service`, `GrowthFundV2Service`, `LimitedShopService`,
 * extension cho `SweepTicketService`). Web (`apps/web`) load catalog qua
 * API hoặc direct import.
 *
 * Catalog level test: `validateMonetizationSystemsCatalog()` kiểm tra:
 *   - battle pass mission def hợp lệ + reward không chứa endgame.
 *   - growth fund milestone realmOrder tăng dần.
 *   - limited shop purchaseLimit count > 0 và period hợp lệ.
 *   - sweep ticket item key match `SWEEP_TICKET_ITEM_KEYS`.
 *   - không reward `MonetizationReward` vi phạm `validateBattlePassReward`.
 *
 * Anti-P2W invariants (xem `monetization-foundation.ts`):
 *   - Premium track battle pass KHÔNG drop pháp bảo top / công pháp chí
 *     tôn / nguyên liệu endgame > cap.
 *   - Growth fund mốc KHÔNG vượt cảnh giới (không grant lên thẳng realm
 *     cao); chỉ thưởng resource trong cap.
 *   - Limited shop KHÔNG bán nguyên liệu endgame vô hạn — mọi item đều có
 *     `quantity` cố định và `purchaseLimitCount` ≤ ngưỡng config.
 */

import type { MonetizationReward, BattlePassTrack } from './monetization';
import type {
  WalletCurrencyKey,
  GrowthFundKey,
  GrowthFundMilestoneDef,
  GrowthFundVariantDef,
} from './monetization-foundation';
import { ENTITLEMENT_VALUE_CAPS } from './monetization-foundation';

// ─── Anti-P2W reward validators (Phase 27.1–27.5) ─────────────────────────

/**
 * Item key tuyệt đối cấm xuất hiện trong reward (pháp bảo top, artifact
 * endgame trực tiếp, công pháp chí tôn hoàn chỉnh). Đây là ngắt mạch
 * anti-P2W: bất kỳ catalog nào (battle pass paid, growth fund, limited
 * shop) chứa key này sẽ FAIL validation.
 */
export const FORBIDDEN_REWARD_ITEM_KEYS: ReadonlySet<string> = new Set([
  // Pháp bảo top hoàn chỉnh (Phase 23.5+ artifact).
  'hau_tho_tran_hon_an',
  'ban_nguyen_chi_bao',
  'hu_khong_chi_bao',
  // Trang bị huyền thoại trực tiếp (Phase 22.x).
  'tien_huyen_kiem',
  'tien_huyen_giap',
  'than_dan',
]);

/**
 * Cap số lượng cho từng item theo monetization reward. Item KHÔNG có trong
 * map = không cho phép trong reward. Bao gồm cả vé quét + Tinh Thiết +
 * pháp bảo fragment cấp thấp/trung.
 */
export const MONETIZATION_ITEM_REWARD_MAX_QTY: Readonly<Record<string, number>> = {
  // Core consumable (battle pass / shop / growth fund — match
  // `monetization.ts` MAX_ITEM_QTY_PER_REWARD + thêm key cho shop V1).
  tinh_thiet: 20,
  yeu_dan: 12,
  han_ngoc: 6,
  phap_bao_shard: 10,
  awaken_stone: 1,
  refine_protection_charm: 2,
  son_coc_yeu_phu: 2,
  hac_lam_yeu_phu: 2,
  yeu_thu_dong_phu: 1,
  kim_son_mach_phu: 1,
  moc_huyen_lam_phu: 1,
  thuy_long_uyen_phu: 1,
  // Sweep ticket items — chỉ là vé, không tăng drop trực tiếp.
  BI_CANH_TICKET: 10,
  sweep_ticket_common: 10,
  sweep_ticket_dungeon: 10,
  sweep_ticket_daily_farm: 10,
  sweep_ticket_personal_boss: 5,
  // Item utility cấp thấp.
  PROTECTION_TALISMAN: 3,
  REFORGE_TOKEN: 2,
  UNSOCKET_TALISMAN: 3,
  STONE_LUYEN_KHI: 50,
  GEM_LOW_RANDOM: 5,
  PHAP_BAO_FRAGMENT_T1: 5,
};

/**
 * Reward validator áp dụng cho **Phase 27.1–27.5** flows (battle pass
 * mission reward, growth fund milestone, limited shop). Cấm endgame, cấm
 * vượt cap, currency chỉ chấp nhận WalletCurrency keys.
 */
export function validateMonetizationSystemsReward(
  reward: MonetizationReward,
): boolean {
  if (!Number.isInteger(reward.qty) || reward.qty <= 0) return false;

  if (reward.kind === 'currency') {
    // Chấp nhận currency theo schema cũ (linhThach/tienNgocKhoa) lẫn
    // wallet-key (Phase 27.0 LINH_THACH/TIEN_NGOC_KHOA/TRIAL_POINT/…).
    const allowedKeys = new Set([
      'linhThach',
      'tienNgocKhoa',
      'LINH_THACH',
      'TIEN_NGOC_KHOA',
      'TRIAL_POINT',
      'EVENT_TOKEN',
      'CONG_HIEN_TONG_MON',
    ]);
    if (!allowedKeys.has(reward.key)) return false;
    if (reward.key === 'linhThach' || reward.key === 'LINH_THACH') {
      return reward.qty <= 60_000; // growth fund cao nhất cần ~60k
    }
    if (reward.key === 'tienNgocKhoa' || reward.key === 'TIEN_NGOC_KHOA') {
      return reward.qty <= 1_000; // growth fund cao nhất cần ~800
    }
    return reward.qty <= 5_000; // các currency phụ
  }

  if (reward.kind === 'cosmetic') {
    return ['title_', 'aura_', 'frame_'].some((p) => reward.key.startsWith(p));
  }

  if (FORBIDDEN_REWARD_ITEM_KEYS.has(reward.key)) return false;
  const maxQty = MONETIZATION_ITEM_REWARD_MAX_QTY[reward.key];
  return maxQty !== undefined && reward.qty <= maxQty;
}

// ─── Battle Pass V2 — missions + multi-season catalog ──────────────────────

/** Source mà battle pass exp có thể được cộng. Server enforce mapping. */
export const BATTLE_PASS_EXP_SOURCES = [
  'CULTIVATION_TICK',
  'AUTO_FARM_SESSION',
  'ALCHEMY_ATTEMPT',
  'DUNGEON_CLEAR',
  'PERSONAL_BOSS_KILL',
  'SECT_MISSION_COMPLETE',
  'MARKET_TRADE',
  'TRIAL_TOWER_CLEAR',
  'BREAKTHROUGH_SUCCESS',
  'DAILY_MISSION_COMPLETE',
] as const;

export type BattlePassExpSource = (typeof BATTLE_PASS_EXP_SOURCES)[number];

/**
 * Nhiệm vụ Battle Pass — counter-based. Server tăng `progress` qua
 * `addBattlePassMissionProgress(characterId, source, delta)`. Khi
 * `progress >= target` mission tự complete → cộng `expReward` vào
 * `BattlePassProgress.xp`. Mỗi mission claim 1 lần / season + scope
 * (DAILY/WEEKLY/SEASON).
 */
export type BattlePassMissionScope = 'DAILY' | 'WEEKLY' | 'SEASON';

export interface BattlePassMissionDef {
  key: string;
  /** Scope reset bucket. */
  scope: BattlePassMissionScope;
  source: BattlePassExpSource;
  /** Số đơn vị cần đạt (giờ tu / lần luyện / lần clear / …). */
  target: number;
  /** EXP cộng vào battle pass khi complete. */
  expReward: number;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
}

/** Cap toàn bộ exp 1 mission có thể grant — anti-P2W / chống farm vô hạn. */
export const BATTLE_PASS_MISSION_EXP_CAP = 300;

/** Cap số mission per scope per season — UI không xếp quá dài. */
export const BATTLE_PASS_MAX_MISSIONS_PER_SCOPE = 12;

export const BATTLE_PASS_MISSIONS_V1: readonly BattlePassMissionDef[] = [
  // Daily missions
  {
    key: 'bp_daily_cultivation_tick',
    scope: 'DAILY',
    source: 'CULTIVATION_TICK',
    target: 60,
    expReward: 30,
    nameVi: 'Tu luyện 60 phút',
    nameEn: 'Cultivate 60 minutes',
    descriptionVi: 'Tích lũy 60 phút Nhập Định.',
  },
  {
    key: 'bp_daily_auto_farm',
    scope: 'DAILY',
    source: 'AUTO_FARM_SESSION',
    target: 1,
    expReward: 20,
    nameVi: 'Hoàn tất 1 phiên auto farm',
    nameEn: 'Complete 1 auto farm session',
    descriptionVi: 'Hoàn thành ít nhất 1 phiên auto farm.',
  },
  {
    key: 'bp_daily_alchemy',
    scope: 'DAILY',
    source: 'ALCHEMY_ATTEMPT',
    target: 1,
    expReward: 25,
    nameVi: 'Luyện đan 1 lần',
    nameEn: 'Refine alchemy 1 time',
    descriptionVi: 'Thử luyện đan 1 lần (thành công hoặc thất bại).',
  },
  {
    key: 'bp_daily_dungeon',
    scope: 'DAILY',
    source: 'DUNGEON_CLEAR',
    target: 1,
    expReward: 30,
    nameVi: 'Vượt 1 bí cảnh',
    nameEn: 'Clear 1 dungeon',
    descriptionVi: 'Hoàn thành 1 bí cảnh thường.',
  },
  {
    key: 'bp_daily_personal_boss',
    scope: 'DAILY',
    source: 'PERSONAL_BOSS_KILL',
    target: 1,
    expReward: 35,
    nameVi: 'Đánh boss cá nhân 1 lần',
    nameEn: 'Defeat personal boss 1 time',
    descriptionVi: 'Tiêu diệt boss cá nhân ít nhất 1 lần.',
  },
  // Weekly missions
  {
    key: 'bp_weekly_dungeon',
    scope: 'WEEKLY',
    source: 'DUNGEON_CLEAR',
    target: 10,
    expReward: 150,
    nameVi: 'Vượt 10 bí cảnh',
    nameEn: 'Clear 10 dungeons',
    descriptionVi: 'Hoàn thành 10 bí cảnh trong tuần.',
  },
  {
    key: 'bp_weekly_sect_mission',
    scope: 'WEEKLY',
    source: 'SECT_MISSION_COMPLETE',
    target: 5,
    expReward: 120,
    nameVi: 'Hoàn thành 5 nhiệm vụ tông môn',
    nameEn: 'Complete 5 sect missions',
    descriptionVi: 'Hoàn thành 5 nhiệm vụ tông môn trong tuần.',
  },
  {
    key: 'bp_weekly_market_trade',
    scope: 'WEEKLY',
    source: 'MARKET_TRADE',
    target: 3,
    expReward: 90,
    nameVi: 'Giao dịch chợ 3 lần',
    nameEn: 'Trade at market 3 times',
    descriptionVi: 'Thực hiện 3 giao dịch chợ (mua hoặc bán).',
  },
  {
    key: 'bp_weekly_trial_tower',
    scope: 'WEEKLY',
    source: 'TRIAL_TOWER_CLEAR',
    target: 5,
    expReward: 150,
    nameVi: 'Vượt 5 tầng Đăng Tiên Tháp',
    nameEn: 'Clear 5 trial tower floors',
    descriptionVi: 'Vượt 5 tầng Đăng Tiên Tháp.',
  },
  // Season-long
  {
    key: 'bp_season_breakthrough',
    scope: 'SEASON',
    source: 'BREAKTHROUGH_SUCCESS',
    target: 1,
    expReward: 300,
    nameVi: 'Đột phá thành công 1 lần',
    nameEn: 'Successful breakthrough 1 time',
    descriptionVi: 'Đột phá thành công ít nhất 1 lần trong mùa.',
  },
  {
    key: 'bp_season_daily_mission',
    scope: 'SEASON',
    source: 'DAILY_MISSION_COMPLETE',
    target: 30,
    expReward: 300,
    nameVi: 'Hoàn thành 30 nhiệm vụ ngày',
    nameEn: 'Complete 30 daily missions',
    descriptionVi: 'Tổng hoàn thành 30 nhiệm vụ ngày trong mùa.',
  },
] as const;

export function getBattlePassMission(
  key: string,
): BattlePassMissionDef | undefined {
  return BATTLE_PASS_MISSIONS_V1.find((m) => m.key === key);
}

export function getBattlePassMissionsByScope(
  scope: BattlePassMissionScope,
): readonly BattlePassMissionDef[] {
  return BATTLE_PASS_MISSIONS_V1.filter((m) => m.scope === scope);
}

/** Map source → list mission để service tăng progress nhanh. */
export function getBattlePassMissionsBySource(
  source: BattlePassExpSource,
): readonly BattlePassMissionDef[] {
  return BATTLE_PASS_MISSIONS_V1.filter((m) => m.source === source);
}

// ─── Battle Pass V2 — paid unlock product key (link tới shop foundation) ───

/**
 * Khoá unlock paid track battle pass — match `SHOP_PRODUCTS` key
 * `battle_pass_premium_unlock` trong `monetization-foundation.ts`. Service
 * `unlockBattlePassPaid` debit qua shop foundation.
 */
export const BATTLE_PASS_PAID_UNLOCK_PRODUCT_KEY = 'battle_pass_premium_unlock';

// ─── Growth Fund V2 — bổ sung biến thể `tien` (late game) ──────────────────

export const GROWTH_FUND_V2_KEYS = ['tien'] as const;

export type GrowthFundV2Key = (typeof GROWTH_FUND_V2_KEYS)[number];

/**
 * Quỹ Trưởng Thành biến thể `tien` — mua 1 lần late game. Mốc Hợp Thể →
 * Nhân Tiên. KHÔNG cộng cảnh giới; chỉ thưởng resource có cap.
 */
export const GROWTH_FUND_V2_VARIANTS: readonly GrowthFundVariantDef[] = [
  {
    key: 'tien' as GrowthFundKey,
    nameVi: 'Quỹ Trưởng Thành — Tiên',
    nameEn: 'Growth Fund — Immortal',
    priceCurrency: 'TIEN_NGOC' as WalletCurrencyKey,
    priceAmount: 680,
    descriptionVi:
      'Mua 1 lần. Nhận thưởng theo mốc Luyện Hư → Nhân Tiên. Không vượt cảnh giới.',
    milestones: [
      {
        key: 'luyen_hu',
        realmKey: 'luyen_hu',
        realmOrder: 6,
        nameVi: 'Đạt Luyện Hư',
        reward: [
          { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 400 },
          { kind: 'currency', key: 'LINH_THACH', qty: 18_000 },
        ],
      },
      {
        key: 'hop_the',
        realmKey: 'hop_the',
        realmOrder: 7,
        nameVi: 'Đạt Hợp Thể',
        reward: [
          { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 480 },
          { kind: 'currency', key: 'LINH_THACH', qty: 24_000 },
        ],
      },
      {
        key: 'dai_thua',
        realmKey: 'dai_thua',
        realmOrder: 8,
        nameVi: 'Đạt Đại Thừa',
        reward: [
          { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 560 },
          { kind: 'currency', key: 'LINH_THACH', qty: 32_000 },
        ],
      },
      {
        key: 'do_kiep',
        realmKey: 'do_kiep',
        realmOrder: 9,
        nameVi: 'Đạt Độ Kiếp',
        reward: [
          { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 640 },
          { kind: 'currency', key: 'LINH_THACH', qty: 42_000 },
        ],
      },
      {
        key: 'nhan_tien',
        realmKey: 'nhan_tien',
        realmOrder: 10,
        nameVi: 'Đạt Nhân Tiên',
        reward: [
          { kind: 'currency', key: 'TIEN_NGOC_KHOA', qty: 800 },
          { kind: 'currency', key: 'LINH_THACH', qty: 60_000 },
        ],
      },
    ],
  },
] as const;

export function getGrowthFundV2Variant(
  key: string,
): GrowthFundVariantDef | undefined {
  return GROWTH_FUND_V2_VARIANTS.find((v) => v.key === key);
}

export function getGrowthFundV2Milestone(
  fundKey: string,
  milestoneKey: string,
): GrowthFundMilestoneDef | undefined {
  const variant = getGrowthFundV2Variant(fundKey);
  if (!variant) return undefined;
  return variant.milestones.find((m) => m.key === milestoneKey);
}

// ─── Limited Periodic Shop ────────────────────────────────────────────────

export const LIMITED_SHOP_KEYS = [
  'DAILY_SHOP',
  'WEEKLY_SHOP',
  'MONTHLY_SHOP',
] as const;

export type LimitedShopKey = (typeof LIMITED_SHOP_KEYS)[number];

export type LimitedShopPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface LimitedShopItemDef {
  /** Unique cross-shop. */
  itemKey: string;
  /** Shop chứa item. */
  shopKey: LimitedShopKey;
  nameVi: string;
  nameEn: string;
  priceCurrency: WalletCurrencyKey;
  priceAmount: number;
  /** Số lượng / lần mua (e.g. 1 vé / lần). */
  quantity: number;
  /** Cap mua trong period (DAILY=daily, …). */
  purchaseLimitCount: number;
  /** Reward được grant khi mua. */
  reward: readonly MonetizationReward[];
  /** Tier reward — UI grouping. */
  tier: 'COMMON' | 'RARE' | 'PREMIUM';
  enabled: boolean;
  descriptionVi: string;
}

export const LIMITED_SHOP_PERIOD_BY_KEY: Readonly<Record<LimitedShopKey, LimitedShopPeriod>> = {
  DAILY_SHOP: 'DAILY',
  WEEKLY_SHOP: 'WEEKLY',
  MONTHLY_SHOP: 'MONTHLY',
};

export const LIMITED_SHOP_ITEMS: readonly LimitedShopItemDef[] = [
  // ─── DAILY_SHOP — vật phẩm tiêu hao + vé quét cấp thấp ────────────────
  {
    itemKey: 'daily_sweep_dungeon',
    shopKey: 'DAILY_SHOP',
    nameVi: 'Vé Quét Bí Cảnh',
    nameEn: 'Dungeon Sweep Ticket',
    priceCurrency: 'TIEN_NGOC_KHOA',
    priceAmount: 30,
    quantity: 1,
    purchaseLimitCount: 2,
    reward: [{ kind: 'item', key: 'BI_CANH_TICKET', qty: 1 }],
    tier: 'COMMON',
    enabled: true,
    descriptionVi: 'Vé quét bí cảnh đã clear. Tối đa 2 vé / ngày.',
  },
  {
    itemKey: 'daily_protection_charm',
    shopKey: 'DAILY_SHOP',
    nameVi: 'Bảo Hộ Phù',
    nameEn: 'Protection Talisman',
    priceCurrency: 'LINH_THACH',
    priceAmount: 800,
    quantity: 1,
    purchaseLimitCount: 1,
    reward: [{ kind: 'item', key: 'refine_protection_charm', qty: 1 }],
    tier: 'COMMON',
    enabled: true,
    descriptionVi: 'Phù chống vỡ khi luyện khí. 1 cái / ngày.',
  },
  {
    itemKey: 'daily_stone_luyenkhi',
    shopKey: 'DAILY_SHOP',
    nameVi: 'Đá Luyện Khí',
    nameEn: 'Refining Stone',
    priceCurrency: 'LINH_THACH',
    priceAmount: 300,
    quantity: 5,
    purchaseLimitCount: 4,
    reward: [{ kind: 'item', key: 'tinh_thiet', qty: 5 }],
    tier: 'COMMON',
    enabled: true,
    descriptionVi: 'Tinh Thiết để luyện trang bị. Tối đa 4 lần / ngày.',
  },
  // ─── WEEKLY_SHOP — nguyên liệu cấp trung + mảnh ──────────────────────
  {
    itemKey: 'weekly_phap_bao_shard',
    shopKey: 'WEEKLY_SHOP',
    nameVi: 'Mảnh Pháp Bảo T1',
    nameEn: 'Phap Bao Fragment T1',
    priceCurrency: 'TIEN_NGOC_KHOA',
    priceAmount: 80,
    quantity: 2,
    purchaseLimitCount: 3,
    reward: [{ kind: 'item', key: 'phap_bao_shard', qty: 2 }],
    tier: 'RARE',
    enabled: true,
    descriptionVi: 'Mảnh pháp bảo cấp 1. Tối đa 3 lần / tuần.',
  },
  {
    itemKey: 'weekly_yeu_dan',
    shopKey: 'WEEKLY_SHOP',
    nameVi: 'Yêu Đan',
    nameEn: 'Yeu Dan',
    priceCurrency: 'LINH_THACH',
    priceAmount: 2_500,
    quantity: 3,
    purchaseLimitCount: 2,
    reward: [{ kind: 'item', key: 'yeu_dan', qty: 3 }],
    tier: 'RARE',
    enabled: true,
    descriptionVi: 'Yêu Đan hỗ trợ luyện đan. Tối đa 2 lần / tuần.',
  },
  {
    itemKey: 'weekly_han_ngoc',
    shopKey: 'WEEKLY_SHOP',
    nameVi: 'Hàn Ngọc',
    nameEn: 'Han Ngoc',
    priceCurrency: 'TIEN_NGOC_KHOA',
    priceAmount: 120,
    quantity: 1,
    purchaseLimitCount: 2,
    reward: [{ kind: 'item', key: 'han_ngoc', qty: 1 }],
    tier: 'RARE',
    enabled: true,
    descriptionVi: 'Hàn Ngọc khắc ngọc trang bị. Tối đa 2 lần / tuần.',
  },
  // ─── MONTHLY_SHOP — hiếm, có cap chặt ────────────────────────────────
  {
    itemKey: 'monthly_awaken_stone',
    shopKey: 'MONTHLY_SHOP',
    nameVi: 'Giác Tỉnh Thạch',
    nameEn: 'Awaken Stone',
    priceCurrency: 'TIEN_NGOC',
    priceAmount: 150,
    quantity: 1,
    purchaseLimitCount: 1,
    reward: [{ kind: 'item', key: 'awaken_stone', qty: 1 }],
    tier: 'PREMIUM',
    enabled: true,
    descriptionVi: 'Đá giác tỉnh pháp bảo. Chỉ 1 lần / tháng.',
  },
  {
    itemKey: 'monthly_sweep_pack',
    shopKey: 'MONTHLY_SHOP',
    nameVi: 'Túi Vé Quét',
    nameEn: 'Sweep Ticket Pack',
    priceCurrency: 'TIEN_NGOC',
    priceAmount: 80,
    quantity: 1,
    purchaseLimitCount: 2,
    reward: [{ kind: 'item', key: 'BI_CANH_TICKET', qty: 10 }],
    tier: 'PREMIUM',
    enabled: true,
    descriptionVi: 'Túi 10 vé quét bí cảnh. Tối đa 2 lần / tháng.',
  },
  {
    itemKey: 'monthly_unsocket_pack',
    shopKey: 'MONTHLY_SHOP',
    nameVi: 'Tách Ngọc Phù',
    nameEn: 'Unsocket Talisman',
    priceCurrency: 'TIEN_NGOC_KHOA',
    priceAmount: 200,
    quantity: 3,
    purchaseLimitCount: 1,
    reward: [{ kind: 'item', key: 'PROTECTION_TALISMAN', qty: 3 }],
    tier: 'PREMIUM',
    enabled: true,
    descriptionVi: 'Phù tách ngọc khỏi trang bị. 1 lần / tháng.',
  },
] as const;

export function getLimitedShopItem(itemKey: string): LimitedShopItemDef | undefined {
  return LIMITED_SHOP_ITEMS.find((i) => i.itemKey === itemKey);
}

export function getLimitedShopItemsByShop(
  shopKey: LimitedShopKey,
): readonly LimitedShopItemDef[] {
  return LIMITED_SHOP_ITEMS.filter((i) => i.shopKey === shopKey);
}

// ─── Sweep ticket item keys (chuẩn hoá) ───────────────────────────────────

/**
 * Set item key được chấp nhận làm vé quét. Các item này phải tồn tại
 * trong `packages/shared/src/items.ts` (hoặc được seed). Server validate
 * `ticketKey ∈ SWEEP_TICKET_ITEM_KEYS` trước khi consume.
 */
export const SWEEP_TICKET_ITEM_KEYS = [
  'BI_CANH_TICKET',
  'sweep_ticket_common',
  'sweep_ticket_dungeon',
  'sweep_ticket_daily_farm',
  'sweep_ticket_personal_boss',
] as const;

export type SweepTicketItemKey = (typeof SWEEP_TICKET_ITEM_KEYS)[number];

export function isSweepTicketItemKey(key: string): key is SweepTicketItemKey {
  return (SWEEP_TICKET_ITEM_KEYS as readonly string[]).includes(key);
}

// ─── Monetization overview shape (server → client) ────────────────────────

export interface MonetizationOverview {
  activeEntitlements: Array<{
    key: string;
    value: number;
    source: string;
    expiresAt: string | null;
  }>;
  monthlyCards: Array<{
    cardKey: string;
    activeUntil: string;
    daysRemaining: number;
    canClaimToday: boolean;
    lastClaimAt: string | null;
  }>;
  battlePass: {
    seasonId: string | null;
    level: number;
    maxLevel: number;
    xp: number;
    xpPerLevel: number;
    premiumUnlocked: boolean;
    endsAt: string | null;
  };
  growthFunds: Array<{
    fundKey: string;
    purchased: boolean;
    purchasedAt: string | null;
    claimedMilestones: string[];
  }>;
  limitedShops: Array<{
    shopKey: LimitedShopKey;
    period: LimitedShopPeriod;
    periodKey: string;
  }>;
  sweepTickets: Array<{ itemKey: string; quantity: number }>;
  extraAttempts: Array<{
    limitKey: string;
    usedToday: number;
    maxPerDay: number;
    nextResetAt: string;
  }>;
  wallet: Array<{ currency: WalletCurrencyKey; amount: number }>;
}

// ─── Validation ────────────────────────────────────────────────────────────

export function validateMonetizationSystemsCatalog(): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Battle Pass missions.
  const missionKeys = new Set<string>();
  for (const m of BATTLE_PASS_MISSIONS_V1) {
    if (missionKeys.has(m.key)) {
      errors.push(`Duplicate battle pass mission key: ${m.key}`);
    }
    missionKeys.add(m.key);
    if (m.target <= 0) {
      errors.push(`Mission ${m.key} target must be > 0`);
    }
    if (m.expReward <= 0 || m.expReward > BATTLE_PASS_MISSION_EXP_CAP) {
      errors.push(
        `Mission ${m.key} expReward=${m.expReward} out of range (0, ${BATTLE_PASS_MISSION_EXP_CAP}]`,
      );
    }
  }
  for (const scope of ['DAILY', 'WEEKLY', 'SEASON'] as const) {
    const count = BATTLE_PASS_MISSIONS_V1.filter((m) => m.scope === scope).length;
    if (count > BATTLE_PASS_MAX_MISSIONS_PER_SCOPE) {
      errors.push(
        `Too many missions in scope ${scope}: ${count} > ${BATTLE_PASS_MAX_MISSIONS_PER_SCOPE}`,
      );
    }
  }

  // Growth Fund V2 milestones tăng dần theo realmOrder.
  for (const v of GROWTH_FUND_V2_VARIANTS) {
    let lastOrder = -1;
    for (const m of v.milestones) {
      if (m.realmOrder <= lastOrder) {
        errors.push(
          `Growth fund ${v.key} milestone ${m.key} realmOrder ${m.realmOrder} <= prev ${lastOrder}`,
        );
      }
      lastOrder = m.realmOrder;
      // Reward không cho item endgame quá mạnh — sử dụng validator V1.
      for (const r of m.reward) {
        if (!validateMonetizationSystemsReward(r)) {
          errors.push(
            `Growth fund ${v.key} milestone ${m.key} reward ${r.kind}:${r.key} qty ${r.qty} not allowed`,
          );
        }
      }
    }
    if (v.priceAmount <= 0) {
      errors.push(`Growth fund ${v.key} price must be > 0`);
    }
  }

  // Limited shop items.
  const shopItemKeys = new Set<string>();
  for (const it of LIMITED_SHOP_ITEMS) {
    if (shopItemKeys.has(it.itemKey)) {
      errors.push(`Duplicate limited shop item key: ${it.itemKey}`);
    }
    shopItemKeys.add(it.itemKey);
    if (it.priceAmount <= 0) {
      errors.push(`Limited shop ${it.itemKey} price must be > 0`);
    }
    if (it.purchaseLimitCount <= 0) {
      errors.push(`Limited shop ${it.itemKey} purchaseLimitCount must be > 0`);
    }
    if (it.quantity <= 0) {
      errors.push(`Limited shop ${it.itemKey} quantity must be > 0`);
    }
    for (const r of it.reward) {
      if (!validateMonetizationSystemsReward(r)) {
        errors.push(
          `Limited shop ${it.itemKey} reward ${r.kind}:${r.key} qty ${r.qty} not allowed`,
        );
      }
    }
  }

  // Sweep ticket key list distinct.
  const seen = new Set<string>();
  for (const k of SWEEP_TICKET_ITEM_KEYS) {
    if (seen.has(k)) errors.push(`Duplicate sweep ticket key: ${k}`);
    seen.add(k);
  }

  // Sanity check entitlement caps still positive (mirror foundation).
  for (const [k, cap] of Object.entries(ENTITLEMENT_VALUE_CAPS)) {
    if (cap < 0) errors.push(`Entitlement ${k} cap < 0`);
  }

  return { ok: errors.length === 0, errors };
}

// ─── Helper: progress-related ─────────────────────────────────────────────

/**
 * Check xem mission có thể complete chưa.
 *
 *   - DAILY/WEEKLY/SEASON: progress >= target. Tách logic claimed list ra
 *     ngoài (lưu DB).
 */
export function isMissionComplete(progress: number, target: number): boolean {
  return Number.isFinite(progress) && progress >= target;
}

export function clampMissionProgress(
  current: number,
  delta: number,
  target: number,
): number {
  const safeCurrent = Number.isFinite(current) ? Math.max(0, Math.floor(current)) : 0;
  const safeDelta = Number.isFinite(delta) ? Math.max(0, Math.floor(delta)) : 0;
  const next = safeCurrent + safeDelta;
  return Math.min(next, Math.max(target, safeCurrent + safeDelta));
}

/** Trả về danh sách track hợp lệ để claim. Helper UI. */
export function listBattlePassTracks(): readonly BattlePassTrack[] {
  return ['free', 'premium'];
}
