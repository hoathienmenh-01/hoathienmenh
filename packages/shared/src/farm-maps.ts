/**
 * Phase 26.5 — Farm Map V2 catalog.
 *
 * Mỗi `FarmMapDef`:
 *   - Gắn 1 `regionKey` (existing `MAP_REGIONS`).
 *   - Có `sourceTier` cố định (1..9) — Drop Economy V2 dùng làm
 *     `effectiveDropTier = min(playerTier, sourceTier)`.
 *   - `recommendedRealmOrder` / `unlockRealmOrder` (REALMS order, 0..27).
 *   - `autoFarmAllowed` / `sweepAllowed` / `freeSessionMinutes` /
 *     `premiumSessionMinutes` / `maxSessionMinutes`.
 *   - `monsterPool` / `eliteEncounterPool` / `miniBossEncounterPool` /
 *     `higherTierMonsterPool` / `opportunityPool` — reference `MONSTERS`,
 *     `world-bosses-v2` keys + opportunity catalog.
 *   - `dropProfileKey` — hook để wire vào DropEconomyService (string key
 *     resolve to weighted material category preset).
 *
 * **Pure catalog + helper** — không Prisma. Service `FarmService` runtime
 * (Phase 26.5 cụm API) sẽ ingest `FarmMapDef` + `FarmSession` Prisma model.
 *
 * Seed Phase 26.5:
 *   - Khu sâu (3 farm map / khu): `son_coc`, `hac_lam`, `kim_son_mach`.
 *   - Khu nông (1 farm map đại diện): 6 khu còn lại — đủ để smoke test
 *     World Content V2 chạy thật, mở rộng phase sau.
 */
import type { RegionKey } from './map-regions';
import type { MonsterFamily } from './monster-taxonomy';

// ───────────────────────────────────────────────────────────────────────────
// FarmMap types
// ───────────────────────────────────────────────────────────────────────────

/**
 * Drop profile key — hook string resolve runtime sang preset weight cho
 * Drop Economy V2. Service map qua catalog: `farm_normal_tier_<n>` /
 * `farm_elite_tier_<n>` / `farm_body_tier_<n>` / v.v.
 *
 * Tách thành string opaque thay vì union literal vì Drop Economy V2
 * runtime sẽ resolve dynamic theo category multiplier + monster family.
 */
export type DropProfileKey = string;

/**
 * Source hint cho cap key — gắn vào `DailyContentCap.capKey` /
 * `WeeklyContentCap.capKey` để service tra. Format: `farm_session:<key>`,
 * `farm_minutes:<sourceTier>`, ...
 */
export type FarmCapKey = string;

export interface FarmMapMonsterEntry {
  /** Monster key — match `MONSTERS[i].key` ở `combat.ts`. */
  monsterKey: string;
  /** Weight roll trong pool (≥ 1). */
  weight: number;
  /**
   * Realm order min / max (theo `REALMS.order`) mà entry này được spawn.
   * Cho phép cùng `monsterKey` xuất hiện ở nhiều farm map với realm range
   * khác nhau (cap tier theo map vẫn enforce).
   */
  minRealmOrder: number;
  maxRealmOrder: number;
  /** Family hint — drop economy weight reference. */
  family: MonsterFamily;
  /**
   * Auto-battle có được phép vs monster này khi ở trong farm session.
   * Tổng quát: chỉ NORMAL được `true`, ELITE / MINI_BOSS / BOSS → `false`.
   */
  canAutoBattle: boolean;
  /** `true` = chỉ xuất hiện qua manual challenge / encounter / sweep. */
  manualOnly: boolean;
  /** Danger level — UI hiển thị warning trước khi challenge. */
  dangerLevel: 'SAFE' | 'CAUTION' | 'DANGEROUS' | 'EXTREME';
}

export interface FarmMapDef {
  key: string;
  /** Tên hiển thị Vi/En. */
  nameVi: string;
  nameEn: string;
  /** Lore ngắn (≤ 240 ký tự / locale). */
  loreVi: string;
  loreEn: string;
  regionKey: RegionKey;
  /** Quyển/chương optional — group content theo arc story. */
  bookKey?: string | null;
  chapterKey?: string | null;
  /** sourceTier (1..9) — cap drop. */
  sourceTier: number;
  /** Realm order tối thiểu mới mở farm map. */
  unlockRealmOrder: number;
  /** Realm order khuyến nghị (UI hint). */
  recommendedRealmOrder: number;
  /** Realm body order khuyến nghị (UI hint, optional). */
  recommendedBodyRealmOrder?: number | null;
  /** Quest key required (optional). */
  unlockQuestKey?: string | null;
  /** Cho auto-farm vs map này không. */
  autoFarmAllowed: boolean;
  /** Cho sweep instant. */
  sweepAllowed: boolean;
  /** Phiên free (phút). */
  freeSessionMinutes: number;
  /** Phiên thẻ tháng (phút). */
  monthlyCardSessionMinutes: number;
  /** Phiên VIP/premium (phút). */
  premiumSessionMinutes: number;
  /** Max phiên (chặn auto-continue vô hạn). */
  maxSessionMinutes: number;
  /** Stamina/phút (0 = không tốn stamina). */
  staminaCostPerMinute: number;
  /** Daily reward cap key — DailyContentCap row reference. */
  dailyRewardCapKey: FarmCapKey;
  /** Pool quái thường (auto-battle). */
  monsterPool: readonly FarmMapMonsterEntry[];
  /** Pool tinh anh (manual encounter). */
  eliteEncounterPool: readonly FarmMapMonsterEntry[];
  /** Pool mini boss (manual encounter). */
  miniBossEncounterPool: readonly FarmMapMonsterEntry[];
  /**
   * Pool quái cao hơn 1 tier — xuất hiện hiếm, tạo manual encounter,
   * KHÔNG auto. Cho phép drop nguyên liệu tier cao hơn 1 với rate thấp
   * (xem Drop Economy V2 `above1`).
   */
  higherTierMonsterPool: readonly FarmMapMonsterEntry[];
  /** Opportunity (cơ duyên) key reference `opportunities.ts`. */
  opportunityPool: readonly string[];
  /** Drop profile resolver key. */
  dropProfileKey: DropProfileKey;
  /** UI source hint (label). */
  sourceHintVi: string;
  sourceHintEn: string;
  enabled: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// Session limit derivation (helper)
// ───────────────────────────────────────────────────────────────────────────

export interface FarmSessionLimitEntitlement {
  /** Monthly Card active? (xem `MonthlyCardSubscription` Prisma). */
  hasActiveMonthlyCard?: boolean;
  /** VIP level ≥ threshold? (xem `VipProfile`). */
  hasActiveVip?: boolean;
}

/**
 * Derive max session minutes — phụ thuộc map + entitlements. KHÔNG bypass
 * map.maxSessionMinutes (anti-P2W cap floor).
 *
 * Priority: VIP > MonthlyCard > Free.
 */
export function getFarmSessionLimit(
  map: FarmMapDef,
  entitlements: FarmSessionLimitEntitlement = {},
): number {
  let chosen = map.freeSessionMinutes;
  if (entitlements.hasActiveMonthlyCard) {
    chosen = Math.max(chosen, map.monthlyCardSessionMinutes);
  }
  if (entitlements.hasActiveVip) {
    chosen = Math.max(chosen, map.premiumSessionMinutes);
  }
  return Math.min(chosen, map.maxSessionMinutes);
}

/**
 * Validate player có mở khoá map chưa.
 *   - `playerRealmOrder >= unlockRealmOrder`.
 *   - `playerQuestKeys` chứa `unlockQuestKey` nếu có set.
 */
export function canEnterFarmMap(
  map: FarmMapDef,
  args: { playerRealmOrder: number; clearedQuestKeys?: readonly string[] },
): { allowed: boolean; reason?: 'REALM_TOO_LOW' | 'QUEST_REQUIRED' | 'DISABLED' } {
  if (!map.enabled) return { allowed: false, reason: 'DISABLED' };
  if (args.playerRealmOrder < map.unlockRealmOrder) {
    return { allowed: false, reason: 'REALM_TOO_LOW' };
  }
  if (map.unlockQuestKey) {
    const cleared = args.clearedQuestKeys ?? [];
    if (!cleared.includes(map.unlockQuestKey)) {
      return { allowed: false, reason: 'QUEST_REQUIRED' };
    }
  }
  return { allowed: true };
}

export function getFarmMapByKey(key: string): FarmMapDef | undefined {
  return FARM_MAPS.find((m) => m.key === key);
}

export function getFarmMapsByRegion(region: RegionKey): readonly FarmMapDef[] {
  return FARM_MAPS.filter((m) => m.regionKey === region);
}

// ───────────────────────────────────────────────────────────────────────────
// Seed — khu sâu son_coc / hac_lam / kim_son_mach + 6 khu đại diện
// ───────────────────────────────────────────────────────────────────────────

/**
 * Helper build entry — reduce boilerplate, KHÔNG che giấu data.
 */
function entry(
  monsterKey: string,
  family: MonsterFamily,
  opts: {
    weight?: number;
    minRealmOrder?: number;
    maxRealmOrder?: number;
    canAutoBattle?: boolean;
    manualOnly?: boolean;
    dangerLevel?: FarmMapMonsterEntry['dangerLevel'];
  } = {},
): FarmMapMonsterEntry {
  return {
    monsterKey,
    weight: opts.weight ?? 10,
    minRealmOrder: opts.minRealmOrder ?? 0,
    maxRealmOrder: opts.maxRealmOrder ?? 27,
    family,
    canAutoBattle: opts.canAutoBattle ?? true,
    manualOnly: opts.manualOnly ?? false,
    dangerLevel: opts.dangerLevel ?? 'SAFE',
  };
}

export const FARM_MAPS: readonly FarmMapDef[] = [
  // ═══════════════════════════════════════════════════════════════════════
  // Khu 1 — Sơn Cốc (Luyện Khí, sourceTier 1, 3 farm map sâu)
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'son_coc_thao_nguyen',
    nameVi: 'Sơn Cốc — Thảo Nguyên Yêu Thử',
    nameEn: 'Mountain Valley — Beast-Mouse Meadow',
    loreVi:
      'Thảo nguyên mở rộng quanh chân núi, sơn thử lông vàng và đá quan yêu tinh tuần tra giữa cỏ rậm. Bãi luyện khí đầu tiên cho tu sĩ mới nhập môn.',
    loreEn:
      'Open meadows below the mountain — golden-furred mountain rats and stone-spirit imps patrol the long grass; the first training ground for fresh disciples.',
    regionKey: 'son_coc',
    sourceTier: 1,
    unlockRealmOrder: 1,
    recommendedRealmOrder: 1,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 60,
    monthlyCardSessionMinutes: 480,
    premiumSessionMinutes: 720,
    maxSessionMinutes: 1440,
    staminaCostPerMinute: 0,
    dailyRewardCapKey: 'farm_session:son_coc_thao_nguyen',
    monsterPool: [
      entry('son_thu_lon', 'YEU_THU', { weight: 14 }),
      entry('da_quan', 'CO_THU', { weight: 10 }),
    ],
    eliteEncounterPool: [
      entry('huyet_lang', 'YEU_THU', { weight: 5, canAutoBattle: false, manualOnly: true, dangerLevel: 'CAUTION' }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: ['son_coc_co_duyen_linh_thao', 'son_coc_co_duyen_van_co'],
    dropProfileKey: 'farm_normal_tier_1',
    sourceHintVi: 'Linh thảo cấp 1, đan sa thô, thú cốt nhỏ.',
    sourceHintEn: 'Tier-1 spirit herbs, raw alchemical sand, small beast bones.',
    enabled: true,
  },
  {
    key: 'son_coc_son_lam',
    nameVi: 'Sơn Cốc — Sơn Lâm Yêu Thú',
    nameEn: 'Mountain Valley — Beast-Forest Path',
    loreVi:
      'Rừng thưa dọc sườn núi, nơi Huyết Lang săn mồi vào đêm. Tu sĩ Luyện Khí muốn tiến nhanh thường thử vận may ở đây.',
    loreEn:
      'Sparse forest on the mountainside where Blood-Wolves hunt at dusk — disciples seeking faster progress test their luck here.',
    regionKey: 'son_coc',
    sourceTier: 1,
    unlockRealmOrder: 1,
    recommendedRealmOrder: 1,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 60,
    monthlyCardSessionMinutes: 480,
    premiumSessionMinutes: 720,
    maxSessionMinutes: 1440,
    staminaCostPerMinute: 0,
    dailyRewardCapKey: 'farm_session:son_coc_son_lam',
    monsterPool: [
      entry('huyet_lang', 'YEU_THU', { weight: 12 }),
      entry('son_thu_lon', 'YEU_THU', { weight: 8 }),
    ],
    eliteEncounterPool: [
      entry('huyet_lang', 'YEU_THU', { weight: 5, canAutoBattle: false, manualOnly: true, dangerLevel: 'CAUTION' }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: ['son_coc_co_duyen_an_choi', 'son_coc_co_duyen_linh_thao'],
    dropProfileKey: 'farm_normal_tier_1',
    sourceHintVi: 'Huyết tinh nhỏ, da thú, mảnh công thức luyện thể sơ.',
    sourceHintEn: 'Small blood essence, beast hides, basic body-cultivation recipe shards.',
    enabled: true,
  },
  {
    key: 'son_coc_cao_nguyen',
    nameVi: 'Sơn Cốc — Cao Nguyên Đá',
    nameEn: 'Mountain Valley — Stone Plateau',
    loreVi:
      'Cao nguyên đá khô cằn, Đá Quan Yêu Tinh ẩn dưới đá tảng. Có cơ duyên gặp mảnh đan tinh cổ.',
    loreEn:
      'A dry stone plateau where stone-spirit imps hide beneath boulders — occasionally yields ancient pill-essence shards.',
    regionKey: 'son_coc',
    sourceTier: 1,
    unlockRealmOrder: 1,
    recommendedRealmOrder: 2,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 60,
    monthlyCardSessionMinutes: 480,
    premiumSessionMinutes: 720,
    maxSessionMinutes: 1440,
    staminaCostPerMinute: 0,
    dailyRewardCapKey: 'farm_session:son_coc_cao_nguyen',
    monsterPool: [
      entry('da_quan', 'CO_THU', { weight: 14 }),
      entry('son_thu_lon', 'YEU_THU', { weight: 6 }),
    ],
    eliteEncounterPool: [],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [
      entry('hac_yeu_xa', 'YEU_THU', { weight: 3, canAutoBattle: false, manualOnly: true, dangerLevel: 'DANGEROUS', minRealmOrder: 2 }),
    ],
    opportunityPool: ['son_coc_co_duyen_da_co', 'son_coc_co_duyen_van_co'],
    dropProfileKey: 'farm_normal_tier_1',
    sourceHintVi: 'Đan sa thô, đá khoáng, mảnh đan tinh cổ.',
    sourceHintEn: 'Raw alchemical sand, ore fragments, ancient pill-essence shards.',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Khu 2 — Hắc Lâm (Trúc Cơ, sourceTier 2, 3 farm map sâu)
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'hac_lam_rim_bia',
    nameVi: 'Hắc Lâm — Rìa Bìa Âm Mộc',
    nameEn: 'Black Forest — Yin-Wood Fringe',
    loreVi:
      'Bìa rừng nơi âm mộc bắt đầu chuyển sang hắc khí. Hắc Yêu Xà và Thi Quỷ chia nhau địa bàn, tu sĩ Trúc Cơ thường rèn kiếm ở đây.',
    loreEn:
      'Forest fringe where yin-wood turns to dark mist — Black Yao Serpents and corpse-ghosts share territory; Foundation Establishment disciples temper their blades here.',
    regionKey: 'hac_lam',
    sourceTier: 2,
    unlockRealmOrder: 2,
    recommendedRealmOrder: 2,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 60,
    monthlyCardSessionMinutes: 480,
    premiumSessionMinutes: 720,
    maxSessionMinutes: 1440,
    staminaCostPerMinute: 1,
    dailyRewardCapKey: 'farm_session:hac_lam_rim_bia',
    monsterPool: [
      entry('hac_yeu_xa', 'YEU_THU', { weight: 12, minRealmOrder: 2 }),
      entry('thi_quy', 'QUY_VAT', { weight: 10, minRealmOrder: 2 }),
    ],
    eliteEncounterPool: [
      entry('hac_lam_ma', 'QUY_VAT', { weight: 4, canAutoBattle: false, manualOnly: true, dangerLevel: 'CAUTION', minRealmOrder: 2 }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: ['hac_lam_co_duyen_huyet_tinh', 'hac_lam_co_duyen_linh_thao_am'],
    dropProfileKey: 'farm_normal_tier_2',
    sourceHintVi: 'Huyết tinh tier 2, da rắn yêu, mảnh công pháp tà.',
    sourceHintEn: 'Tier-2 blood essence, yao serpent hides, heretic method fragments.',
    enabled: true,
  },
  {
    key: 'hac_lam_sau',
    nameVi: 'Hắc Lâm — Lõi Hắc Mộc',
    nameEn: 'Black Forest — Heart of Dark Wood',
    loreVi:
      'Lõi rừng dày đặc nhất, Hắc Lâm Ma di chuyển trong sương đen. Mỗi tấc đất đều chôn bí mật cổ.',
    loreEn:
      'The thickest heart of the forest where Black-Forest Phantoms drift through ink-black mist — every inch hides an ancient secret.',
    regionKey: 'hac_lam',
    sourceTier: 2,
    unlockRealmOrder: 2,
    recommendedRealmOrder: 2,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 60,
    monthlyCardSessionMinutes: 480,
    premiumSessionMinutes: 720,
    maxSessionMinutes: 1440,
    staminaCostPerMinute: 2,
    dailyRewardCapKey: 'farm_session:hac_lam_sau',
    monsterPool: [
      entry('thi_quy', 'QUY_VAT', { weight: 12, minRealmOrder: 2 }),
      entry('hac_lam_ma', 'QUY_VAT', { weight: 8, minRealmOrder: 2 }),
    ],
    eliteEncounterPool: [
      entry('hac_lam_ma', 'QUY_VAT', { weight: 4, canAutoBattle: false, manualOnly: true, dangerLevel: 'CAUTION', minRealmOrder: 2 }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [
      entry('thuy_lan_yeu', 'YEU_THU', { weight: 2, canAutoBattle: false, manualOnly: true, dangerLevel: 'DANGEROUS', minRealmOrder: 3 }),
    ],
    opportunityPool: ['hac_lam_co_duyen_tan_quyen', 'hac_lam_co_duyen_linh_thao_am'],
    dropProfileKey: 'farm_normal_tier_2',
    sourceHintVi: 'Tâm ma vụn, mảnh công pháp tà, đan sa âm.',
    sourceHintEn: 'Inner-demon shards, dark method fragments, yin alchemical sand.',
    enabled: true,
  },
  {
    key: 'hac_lam_co_thu',
    nameVi: 'Hắc Lâm — Cổ Thụ Hoá Tinh',
    nameEn: 'Black Forest — Ancient Tree Spirits',
    loreVi:
      'Cụm cổ thụ vạn năm thành tinh — Tang Diệp Yêu Phụ và Cổ Thụ Chi Linh nương theo huyết khí cổ. Cẩn thận khi đêm xuống.',
    loreEn:
      'Cluster of millennium-old trees turned spirit — Mulberry Yao Matriarchs and Ancient Tree Spirits feed on ancestral blood-qi. Beware after nightfall.',
    regionKey: 'hac_lam',
    sourceTier: 2,
    unlockRealmOrder: 2,
    recommendedRealmOrder: 2,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 60,
    monthlyCardSessionMinutes: 480,
    premiumSessionMinutes: 720,
    maxSessionMinutes: 1440,
    staminaCostPerMinute: 1,
    dailyRewardCapKey: 'farm_session:hac_lam_co_thu',
    monsterPool: [
      entry('hac_yeu_xa', 'YEU_THU', { weight: 8, minRealmOrder: 2 }),
      entry('thi_quy', 'QUY_VAT', { weight: 6, minRealmOrder: 2 }),
      entry('hac_lam_ma', 'QUY_VAT', { weight: 4, minRealmOrder: 2 }),
    ],
    eliteEncounterPool: [],
    miniBossEncounterPool: [
      entry('hac_lam_ma', 'QUY_VAT', { weight: 1, canAutoBattle: false, manualOnly: true, dangerLevel: 'DANGEROUS', minRealmOrder: 2 }),
    ],
    higherTierMonsterPool: [],
    opportunityPool: ['hac_lam_co_duyen_co_thu', 'hac_lam_co_duyen_tan_quyen'],
    dropProfileKey: 'farm_normal_tier_2',
    sourceHintVi: 'Linh thảo âm hệ, mộc tinh hoa, mảnh công pháp tâm pháp.',
    sourceHintEn: 'Yin spirit herbs, wood essence shards, mind-method fragments.',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Khu 3 — Kim Sơn Mạch (Kim Đan, sourceTier 3, 3 farm map sâu)
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'kim_son_mach_quang_dao',
    nameVi: 'Kim Sơn Mạch — Quặng Đạo',
    nameEn: 'Golden Mountain Vein — Ore Path',
    loreVi:
      'Đường hầm khai khoáng cổ — Kim Quang Thạch Giáp và Huyền Kim Lang Thú tuần tra. Tu sĩ Kim Đan luyện tinh thiết ở đây.',
    loreEn:
      'Ancient mining tunnels where Gold-Light Stone Plates and Mystic-Gold Wolf Beasts patrol — Golden Core cultivators refine spirit-iron here.',
    regionKey: 'kim_son_mach',
    sourceTier: 3,
    unlockRealmOrder: 3,
    recommendedRealmOrder: 3,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 60,
    monthlyCardSessionMinutes: 480,
    premiumSessionMinutes: 720,
    maxSessionMinutes: 1440,
    staminaCostPerMinute: 2,
    dailyRewardCapKey: 'farm_session:kim_son_mach_quang_dao',
    monsterPool: [
      entry('kim_quang_thach_giap', 'KHOI_LOI', { weight: 12, minRealmOrder: 3 }),
      entry('huyen_kim_lang_thu', 'YEU_THU', { weight: 10, minRealmOrder: 3 }),
    ],
    eliteEncounterPool: [
      entry('tinh_thiet_kiem_linh', 'LINH_THE', { weight: 4, canAutoBattle: false, manualOnly: true, dangerLevel: 'CAUTION', minRealmOrder: 3 }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: ['kim_son_co_duyen_tinh_thiet', 'kim_son_co_duyen_co_xuong'],
    dropProfileKey: 'farm_artifact_tier_3',
    sourceHintVi: 'Tinh thiết tier 3, linh kim cổ, phôi pháp bảo cấp thấp.',
    sourceHintEn: 'Tier-3 spirit-iron, ancient spirit-metal, low-tier artifact blanks.',
    enabled: true,
  },
  {
    key: 'kim_son_mach_kiem_linh',
    nameVi: 'Kim Sơn Mạch — Kiếm Linh Cốc',
    nameEn: 'Golden Mountain Vein — Sword-Spirit Valley',
    loreVi:
      'Hẻm núi kiếm khí ngàn năm — Tinh Thiết Kiếm Linh tuần ranh, mỗi nhát chém vang vọng tổ tông kiếm tu.',
    loreEn:
      'A valley humming with thousand-year sword-qi — Crystal-Iron Sword Spirits patrol; each strike echoes the ancestors of sword cultivation.',
    regionKey: 'kim_son_mach',
    sourceTier: 3,
    unlockRealmOrder: 3,
    recommendedRealmOrder: 3,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 60,
    monthlyCardSessionMinutes: 480,
    premiumSessionMinutes: 720,
    maxSessionMinutes: 1440,
    staminaCostPerMinute: 3,
    dailyRewardCapKey: 'farm_session:kim_son_mach_kiem_linh',
    monsterPool: [
      entry('tinh_thiet_kiem_linh', 'LINH_THE', { weight: 14, minRealmOrder: 3 }),
      entry('kim_dieu_thuong_phong', 'YEU_THU', { weight: 6, minRealmOrder: 3 }),
    ],
    eliteEncounterPool: [
      entry('tich_thien_sat_thu', 'TA_TU', { weight: 3, canAutoBattle: false, manualOnly: true, dangerLevel: 'DANGEROUS', minRealmOrder: 3 }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: ['kim_son_co_duyen_kiem_phach', 'kim_son_co_duyen_tinh_thiet'],
    dropProfileKey: 'farm_equipment_tier_3',
    sourceHintVi: 'Mảnh kiếm linh, tinh thiết, bản vẽ pháp bảo cấp thấp.',
    sourceHintEn: 'Sword-spirit shards, spirit-iron, low-tier artifact blueprints.',
    enabled: true,
  },
  {
    key: 'kim_son_mach_thuong_van',
    nameVi: 'Kim Sơn Mạch — Đỉnh Thương Vân',
    nameEn: 'Golden Mountain Vein — Spear-Cloud Peak',
    loreVi:
      'Đỉnh núi gió mạnh, Kim Diệu Thương Phong tuần ranh tầng cao. Phù hợp tu sĩ Kim Đan trung kỳ.',
    loreEn:
      'A windy peak patrolled by Gold-Talon Spear-Wind beasts — suited to mid-stage Golden Core cultivators.',
    regionKey: 'kim_son_mach',
    sourceTier: 3,
    unlockRealmOrder: 3,
    recommendedRealmOrder: 3,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 60,
    monthlyCardSessionMinutes: 480,
    premiumSessionMinutes: 720,
    maxSessionMinutes: 1440,
    staminaCostPerMinute: 3,
    dailyRewardCapKey: 'farm_session:kim_son_mach_thuong_van',
    monsterPool: [
      entry('kim_dieu_thuong_phong', 'YEU_THU', { weight: 14, minRealmOrder: 3 }),
      entry('huyen_kim_lang_thu', 'YEU_THU', { weight: 8, minRealmOrder: 3 }),
    ],
    eliteEncounterPool: [],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [
      entry('thuy_thanh_long_vuong', 'CO_THU', { weight: 1, canAutoBattle: false, manualOnly: true, dangerLevel: 'EXTREME', minRealmOrder: 3 }),
    ],
    opportunityPool: ['kim_son_co_duyen_van_co', 'kim_son_co_duyen_kiem_phach'],
    dropProfileKey: 'farm_artifact_tier_3',
    sourceHintVi: 'Lông cánh kim diệu, đá phong vũ, phôi pháp bảo bay.',
    sourceHintEn: 'Gold-talon feathers, wind-rain stones, flying-artifact blanks.',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 6 khu đại diện (1 farm map / khu) — đủ để smoke test World Content V2.
  // Mở rộng phase sau lên 3 farm map / khu theo target spec.
  // ═══════════════════════════════════════════════════════════════════════
  {
    key: 'yeu_thu_dong_quan_dao',
    nameVi: 'Yêu Thú Động — Cửa Hang Yêu',
    nameEn: 'Beast Cavern — Yao Entrance',
    loreVi:
      'Cửa hang yêu thú cấp Kim Đan trung. Kim Giáp Thú trấn giữ ngoài, Huyền Quy ẩn sâu bên trong.',
    loreEn:
      'Entrance of the mid-Golden-Core beast cavern — Gold-Armored Beasts guard the gate while Mystic Tortoises lurk deeper.',
    regionKey: 'yeu_thu_dong',
    sourceTier: 3,
    unlockRealmOrder: 3,
    recommendedRealmOrder: 3,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 60,
    monthlyCardSessionMinutes: 480,
    premiumSessionMinutes: 720,
    maxSessionMinutes: 1440,
    staminaCostPerMinute: 3,
    dailyRewardCapKey: 'farm_session:yeu_thu_dong_quan_dao',
    monsterPool: [
      entry('kim_giap_thu', 'YEU_THU', { weight: 10, minRealmOrder: 3 }),
      entry('huyen_quy', 'CO_THU', { weight: 6, minRealmOrder: 3 }),
    ],
    eliteEncounterPool: [
      entry('yeu_long_tieu', 'YEU_THU', { weight: 4, canAutoBattle: false, manualOnly: true, dangerLevel: 'CAUTION', minRealmOrder: 3 }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_body_tier_3',
    sourceHintVi: 'Yêu đan kim đan, mai rùa cổ, đoán cốt thạch.',
    sourceHintEn: 'Golden Core yao pills, ancient tortoise shells, bone-forging stones.',
    enabled: true,
  },
  {
    key: 'moc_huyen_lam_rim',
    nameVi: 'Mộc Huyền Lâm — Bìa Cổ Lâm',
    nameEn: 'Wood-Mystery Forest — Forest Edge',
    loreVi:
      'Bìa rừng cổ — Thanh Mang Xà và Tang Diệp Yêu Phụ lượn vào ban ngày. Mảnh công pháp mộc hệ đôi khi rơi từ tổ chim cổ.',
    loreEn:
      'Edge of the ancient woods — Azure Mang serpents and Mulberry Yao Matriarchs drift through daylight; wood-method shards sometimes fall from primeval nests.',
    regionKey: 'moc_huyen_lam',
    sourceTier: 2,
    unlockRealmOrder: 2,
    recommendedRealmOrder: 2,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 60,
    monthlyCardSessionMinutes: 480,
    premiumSessionMinutes: 720,
    maxSessionMinutes: 1440,
    staminaCostPerMinute: 1,
    dailyRewardCapKey: 'farm_session:moc_huyen_lam_rim',
    monsterPool: [
      entry('thanh_mang_xa', 'YEU_THU', { weight: 12, minRealmOrder: 2 }),
      entry('tang_diep_yeu_phu', 'YEU_THU', { weight: 8, minRealmOrder: 2 }),
    ],
    eliteEncounterPool: [
      entry('co_thu_chi_linh', 'LINH_THE', { weight: 4, canAutoBattle: false, manualOnly: true, dangerLevel: 'CAUTION', minRealmOrder: 2 }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_alchemy_tier_2',
    sourceHintVi: 'Linh thảo mộc hệ, mảnh công pháp mộc, lá cổ thụ ngàn năm.',
    sourceHintEn: 'Wood-element herbs, wood-method fragments, millennium-tree leaves.',
    enabled: true,
  },
  {
    key: 'thuy_long_uyen_hong_thuy',
    nameVi: 'Thuỷ Long Uyên — Vùng Hồng Thuỷ',
    nameEn: 'Water-Dragon Abyss — Crimson-Water Zone',
    loreVi:
      'Vùng hồ vạn trượng — Thuỷ Lan Yêu nương theo dòng nước nóng, hơi lạnh ngưng tụ băng tinh.',
    loreEn:
      'A 10,000-fathom lake zone — Water-Orchid Yao drift along hot currents; chill vapors crystallize ice essence.',
    regionKey: 'thuy_long_uyen',
    sourceTier: 3,
    unlockRealmOrder: 3,
    recommendedRealmOrder: 3,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 60,
    monthlyCardSessionMinutes: 480,
    premiumSessionMinutes: 720,
    maxSessionMinutes: 1440,
    staminaCostPerMinute: 2,
    dailyRewardCapKey: 'farm_session:thuy_long_uyen_hong_thuy',
    monsterPool: [
      entry('thuy_lan_yeu', 'YEU_THU', { weight: 12, minRealmOrder: 3 }),
      entry('han_tinh_quy_phach', 'QUY_VAT', { weight: 8, minRealmOrder: 3 }),
    ],
    eliteEncounterPool: [
      entry('huyen_thuy_giao_long', 'CO_THU', { weight: 4, canAutoBattle: false, manualOnly: true, dangerLevel: 'DANGEROUS', minRealmOrder: 3 }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_alchemy_tier_3',
    sourceHintVi: 'Băng tinh nguyên tuỷ, vẩy giao long, đan thuỷ tinh.',
    sourceHintEn: 'Ice-essence marrow, flood-dragon scales, water-essence pills.',
    enabled: true,
  },
  {
    key: 'hoa_diem_son_dia_nguc',
    nameVi: 'Hoả Diệm Sơn — Cửa Địa Ngục',
    nameEn: 'Flame-Burning Mountain — Underworld Gate',
    loreVi:
      'Cửa địa ngục dung nham — đan sĩ Nguyên Anh tinh luyện hoả tinh, dòng dung nham nung đỏ vạn dặm.',
    loreEn:
      'A lava-mouthed underworld gate — Nascent-Soul alchemists refine flame essence as crimson lava bakes the heavens.',
    regionKey: 'hoa_diem_son',
    sourceTier: 4,
    unlockRealmOrder: 4,
    recommendedRealmOrder: 4,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 60,
    monthlyCardSessionMinutes: 480,
    premiumSessionMinutes: 720,
    maxSessionMinutes: 1440,
    staminaCostPerMinute: 3,
    dailyRewardCapKey: 'farm_session:hoa_diem_son_dia_nguc',
    monsterPool: [],
    eliteEncounterPool: [],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_alchemy_tier_4',
    sourceHintVi: 'Hoả tinh, đan sa hoả hệ, mảnh công pháp hoả.',
    sourceHintEn: 'Flame essence, fire alchemical sand, fire-method fragments.',
    // Disabled = không có monster pool detail trong PR 26.5; mở phase sau.
    enabled: false,
  },
  {
    key: 'hoang_tho_huyet_van_thach',
    nameVi: 'Hoàng Thổ Huyệt — Vạn Thạch Trận',
    nameEn: 'Yellow-Earth Hollow — Stone-Array Field',
    loreVi:
      'Trận thạch ngàn năm — Thạch Long Cổ Giáp ẩn trong đá tảng. Mỗi tấc đất phong ấn linh khí tổ tông.',
    loreEn:
      'A thousand-year stone-array field — Stone Dragon Ancient Plates lurk inside boulders; every inch seals ancestral spirit qi.',
    regionKey: 'hoang_tho_huyet',
    sourceTier: 4,
    unlockRealmOrder: 4,
    recommendedRealmOrder: 4,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 60,
    monthlyCardSessionMinutes: 480,
    premiumSessionMinutes: 720,
    maxSessionMinutes: 1440,
    staminaCostPerMinute: 3,
    dailyRewardCapKey: 'farm_session:hoang_tho_huyet_van_thach',
    monsterPool: [],
    eliteEncounterPool: [],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_body_tier_4',
    sourceHintVi: 'Đoán cốt thạch hoàng, đá địa long, vật liệu trang bị tier 4.',
    sourceHintEn: 'Yellow bone-forging stones, earth-dragon stones, tier-4 equipment material.',
    enabled: false,
  },
  {
    key: 'cuu_la_dien_ma_huyet',
    nameVi: 'Cửu La Điện — Ma Huyệt Bí Cảnh',
    nameEn: 'Nine-Net Hall — Demon Hollow Secret',
    loreVi:
      'Bí cảnh thượng cổ — Cửu La Thiên Đế trấn áp ma đạo. Dành cho tu sĩ Hoá Thần thử nghiệm tâm cảnh.',
    loreEn:
      'An ancient secret realm — the Heavenly Emperor of Nine Nets suppresses demon-paths; for Spirit-Transformation cultivators to test their dao mind.',
    regionKey: 'cuu_la_dien',
    sourceTier: 5,
    unlockRealmOrder: 5,
    recommendedRealmOrder: 5,
    autoFarmAllowed: false,
    sweepAllowed: false,
    freeSessionMinutes: 30,
    monthlyCardSessionMinutes: 60,
    premiumSessionMinutes: 90,
    maxSessionMinutes: 120,
    staminaCostPerMinute: 5,
    dailyRewardCapKey: 'farm_session:cuu_la_dien_ma_huyet',
    monsterPool: [],
    eliteEncounterPool: [],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_tribulation_tier_5',
    sourceHintVi: 'Ma hạch, tâm ma vụn, nguyên liệu vượt kiếp.',
    sourceHintEn: 'Demon cores, inner-demon shards, tribulation materials.',
    enabled: false,
  },
];
