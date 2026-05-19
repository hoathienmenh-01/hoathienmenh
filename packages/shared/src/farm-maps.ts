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
 *
 * Phase content-depth expansion:
 *   - Khu 4-6 (`yeu_thu_dong`, `moc_huyen_lam`, `thuy_long_uyen`): 3 farm
 *     map / khu, enabled, có monster pool đầy đủ.
 *   - Khu 7-8 (`hoa_diem_son`, `hoang_tho_huyet`): 3 farm map / khu, 1
 *     placeholder disabled + 2 enabled với monster pool.
 *   - Khu 9 (`cuu_la_dien`): 3 farm map / khu, tất cả disabled (chưa có
 *     monster catalog cho Hoá Thần tier).
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
  // Khu 4 — Yêu Thú Động (Kim Đan, sourceTier 3, 3 farm map)
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
    key: 'yeu_thu_dong_huyen_quy_dong',
    nameVi: 'Yêu Thú Động — Huyền Quy Sào',
    nameEn: 'Beast Cavern — Mystic Tortoise Den',
    loreVi:
      'Sâu trong động, Huyền Quy ngàn năm canh giữ ao linh tuyền. Kim Giáp Thú tuần tra quanh mép nước, tu sĩ Kim Đan trung kỳ mới dám đặt chân.',
    loreEn:
      'Deep inside the cavern, millennium-old Mystic Tortoises guard a spirit-spring pool; Gold-Armored Beasts patrol the waterline — only mid-stage Golden Core cultivators dare enter.',
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
    dailyRewardCapKey: 'farm_session:yeu_thu_dong_huyen_quy_dong',
    monsterPool: [
      entry('huyen_quy', 'CO_THU', { weight: 12, minRealmOrder: 3 }),
      entry('kim_giap_thu', 'YEU_THU', { weight: 6, minRealmOrder: 3 }),
    ],
    eliteEncounterPool: [
      entry('yeu_long_tieu', 'YEU_THU', { weight: 3, canAutoBattle: false, manualOnly: true, dangerLevel: 'DANGEROUS', minRealmOrder: 3 }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_body_tier_3',
    sourceHintVi: 'Mai rùa cổ, yêu đan huyền, đoán cốt thạch thượng.',
    sourceHintEn: 'Ancient tortoise shells, mystic yao pills, superior bone-forging stones.',
    enabled: true,
  },
  {
    key: 'yeu_thu_dong_san_huyet',
    nameVi: 'Yêu Thú Động — Sàn Huyết Đấu',
    nameEn: 'Beast Cavern — Blood Arena Floor',
    loreVi:
      'Đấu trường cổ nơi yêu thú thượng cổ đại chiến — máu yêu khí ngưng tụ thành tinh thể. Yêu Long Tiểu canh giữ lối vào tầng sâu nhất.',
    loreEn:
      'An ancient arena where primordial beasts clash — congealed yao blood crystallizes on the floor; the Young Yao Dragon guards the entrance to the deepest level.',
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
    staminaCostPerMinute: 4,
    dailyRewardCapKey: 'farm_session:yeu_thu_dong_san_huyet',
    monsterPool: [
      entry('kim_giap_thu', 'YEU_THU', { weight: 8, minRealmOrder: 3 }),
      entry('huyen_quy', 'CO_THU', { weight: 8, minRealmOrder: 3 }),
    ],
    eliteEncounterPool: [
      entry('yeu_long_tieu', 'YEU_THU', { weight: 4, canAutoBattle: false, manualOnly: true, dangerLevel: 'DANGEROUS', minRealmOrder: 3 }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_body_tier_3',
    sourceHintVi: 'Huyết tinh yêu thú, yêu đan, mảnh võ kỹ thượng cổ.',
    sourceHintEn: 'Beast blood crystals, yao pills, ancient martial-arts shards.',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Khu 5 — Mộc Huyền Lâm (Trúc Cơ, sourceTier 2, 3 farm map)
  // ═══════════════════════════════════════════════════════════════════════
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
    key: 'moc_huyen_lam_co_thu_tim',
    nameVi: 'Mộc Huyền Lâm — Tim Cổ Thụ',
    nameEn: 'Wood-Mystery Forest — Ancient Tree Heart',
    loreVi:
      'Lõi cổ thụ vạn năm — Cổ Thụ Chi Linh ngưng tụ mộc tinh hoa ngàn năm. Tịch Linh Quỷ ẩn trong rễ cây, cẩn thận khi chạm vào vỏ cây cổ.',
    loreEn:
      'Heart of a ten-thousand-year tree — Ancient Tree Spirits condense millennium wood essence; Tich-Ling Ghosts hide in the roots — beware touching the ancient bark.',
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
    staminaCostPerMinute: 2,
    dailyRewardCapKey: 'farm_session:moc_huyen_lam_co_thu_tim',
    monsterPool: [
      entry('co_thu_chi_linh', 'LINH_THE', { weight: 12, minRealmOrder: 2 }),
      entry('tich_linh_quy', 'QUY_VAT', { weight: 8, minRealmOrder: 2 }),
    ],
    eliteEncounterPool: [
      entry('thien_la_co_yeu', 'YEU_THU', { weight: 3, canAutoBattle: false, manualOnly: true, dangerLevel: 'CAUTION', minRealmOrder: 2 }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_alchemy_tier_2',
    sourceHintVi: 'Mộc tinh hoa, hồn tinh cổ thụ, lá bồ đề cổ.',
    sourceHintEn: 'Wood essence, ancient-tree soul crystals, primeval bodhi leaves.',
    enabled: true,
  },
  {
    key: 'moc_huyen_lam_am_bi',
    nameVi: 'Mộc Huyền Lâm — Âm Bí Cốc',
    nameEn: 'Wood-Mystery Forest — Yin-Secret Valley',
    loreVi:
      'Thung lũng âm bí nơi sương mộc đen che phủ bầu trời — Ký Ức Méo hiện hình từ ký ức cổ, Thiên La Cổ Yêu canh giữ lối vào bí cảnh.',
    loreEn:
      'A yin-secret valley shrouded in black wood-mist — Twisted Memories manifest from ancient recollections while Heavenly-Net Old Yao guard the secret-realm entrance.',
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
    staminaCostPerMinute: 2,
    dailyRewardCapKey: 'farm_session:moc_huyen_lam_am_bi',
    monsterPool: [
      entry('thanh_mang_xa', 'YEU_THU', { weight: 8, minRealmOrder: 2 }),
      entry('tang_diep_yeu_phu', 'YEU_THU', { weight: 6, minRealmOrder: 2 }),
      entry('ky_uc_meo', 'LINH_THE', { weight: 4, minRealmOrder: 2 }),
    ],
    eliteEncounterPool: [
      entry('thien_la_co_yeu', 'YEU_THU', { weight: 3, canAutoBattle: false, manualOnly: true, dangerLevel: 'DANGEROUS', minRealmOrder: 2 }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_alchemy_tier_2',
    sourceHintVi: 'Mảnh ký ức cổ, linh thảo âm hệ, mộc tinh hoa đậm đặc.',
    sourceHintEn: 'Ancient memory shards, yin spirit herbs, concentrated wood essence.',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Khu 6 — Thuỷ Long Uyên (Kim Đan, sourceTier 3, 3 farm map)
  // ═══════════════════════════════════════════════════════════════════════
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
    key: 'thuy_long_uyen_bang_ha',
    nameVi: 'Thuỷ Long Uyên — Băng Hà Đáy Hồ',
    nameEn: 'Water-Dragon Abyss — Lake-Bottom Glacier',
    loreVi:
      'Đáy hồ đóng băng vạn năm — Hàn Tinh Quỷ Phách ngưng tụ hàn khí, Thuỷ Lân Yêu bơi trong dòng nước đóng băng nửa chừng.',
    loreEn:
      'A lake bottom frozen for ten thousand years — Cold-Soul Ghost Phantasms crystallize chill energy while Water-Orchid Yao swim through half-frozen currents.',
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
    staminaCostPerMinute: 3,
    dailyRewardCapKey: 'farm_session:thuy_long_uyen_bang_ha',
    monsterPool: [
      entry('han_tinh_quy_phach', 'QUY_VAT', { weight: 12, minRealmOrder: 3 }),
      entry('thuy_lan_yeu', 'YEU_THU', { weight: 6, minRealmOrder: 3 }),
    ],
    eliteEncounterPool: [
      entry('huyen_thuy_giao_long', 'CO_THU', { weight: 3, canAutoBattle: false, manualOnly: true, dangerLevel: 'DANGEROUS', minRealmOrder: 3 }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_alchemy_tier_3',
    sourceHintVi: 'Băng tinh hàn, hồn tinh quỷ, thuỷ nguyên tinh.',
    sourceHintEn: 'Cold ice crystals, ghost soul fragments, water-essence marrow.',
    enabled: true,
  },
  {
    key: 'thuy_long_uyen_long_cung',
    nameVi: 'Thuỷ Long Uyên — Long Cung Cổ',
    nameEn: 'Water-Dragon Abyss — Ancient Dragon Palace',
    loreVi:
      'Cung điện ngầm dưới đáy vực — Huyền Thuỷ Giao Long canh giữ ngai rồng cổ. Giao Long cấp cao ẩn trong bóng tối, chờ kẻ xâm nhập.',
    loreEn:
      'A submerged palace at the abyss floor — Mystic Water Flood Dragons guard an ancient dragon throne; elder dragons lurk in the shadows, awaiting intruders.',
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
    staminaCostPerMinute: 4,
    dailyRewardCapKey: 'farm_session:thuy_long_uyen_long_cung',
    monsterPool: [
      entry('thuy_lan_yeu', 'YEU_THU', { weight: 8, minRealmOrder: 3 }),
      entry('han_tinh_quy_phach', 'QUY_VAT', { weight: 8, minRealmOrder: 3 }),
    ],
    eliteEncounterPool: [
      entry('huyen_thuy_giao_long', 'CO_THU', { weight: 4, canAutoBattle: false, manualOnly: true, dangerLevel: 'DANGEROUS', minRealmOrder: 3 }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [
      entry('thuy_thanh_long_vuong', 'CO_THU', { weight: 1, canAutoBattle: false, manualOnly: true, dangerLevel: 'EXTREME', minRealmOrder: 3 }),
    ],
    opportunityPool: [],
    dropProfileKey: 'farm_alchemy_tier_3',
    sourceHintVi: 'Vẩy giao long cổ, long châu, nguyên liệu pháp bảo thuỷ hệ.',
    sourceHintEn: 'Ancient flood-dragon scales, dragon pearls, water-artifact materials.',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Khu 7 — Hoả Diệm Sơn (Nguyên Anh, sourceTier 4, 3 farm map)
  // ═══════════════════════════════════════════════════════════════════════
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
    key: 'hoa_diem_son_duong_nham',
    nameVi: 'Hoả Diệm Sơn — Dòng Nham Thạch',
    nameEn: 'Flame-Burning Mountain — Lava River',
    loreVi:
      'Dòng nham chảy xiết giữa hai vách núi lửa — Hoả Yến Thử chạy trên mặt nham nóng, Xích Diệm Yêu Xà ẩn trong khe đá nóng bỏng.',
    loreEn:
      'A raging lava river between two volcanic walls — Flame Rats scurry across the molten surface while Red-Flame Yao Serpents hide in scorching crevices.',
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
    staminaCostPerMinute: 4,
    dailyRewardCapKey: 'farm_session:hoa_diem_son_duong_nham',
    monsterPool: [
      entry('hoa_yen_thu', 'YEU_THU', { weight: 12, minRealmOrder: 4 }),
      entry('xich_diem_yeu_xa', 'YEU_THU', { weight: 8, minRealmOrder: 4 }),
    ],
    eliteEncounterPool: [
      entry('hoa_long_chi_linh', 'LINH_THE', { weight: 3, canAutoBattle: false, manualOnly: true, dangerLevel: 'DANGEROUS', minRealmOrder: 4 }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_alchemy_tier_4',
    sourceHintVi: 'Hoả tinh, nham tinh, đan sa hoả hệ thượng hạng.',
    sourceHintEn: 'Flame essence, lava crystals, premium fire alchemical sand.',
    enabled: true,
  },
  {
    key: 'hoa_diem_son_chu_tuoc_dinh',
    nameVi: 'Hoả Diệm Sơn — Đỉnh Chu Tước',
    nameEn: 'Flame-Burning Mountain — Vermillion-Sparrow Peak',
    loreVi:
      'Đỉnh núi lửa cao nhất — Chu Tước Huyết Điêu bay lượn trên biển lửa, Hoả Long Chi Linh canh giữ phượng hoàng tổ cổ.',
    loreEn:
      'The highest volcanic peak — Vermillion Sparrow Blood Eagles soar above a sea of fire while Flame Dragon Spirits guard an ancient phoenix nest.',
    regionKey: 'hoa_diem_son',
    sourceTier: 4,
    unlockRealmOrder: 4,
    recommendedRealmOrder: 4,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 30,
    monthlyCardSessionMinutes: 240,
    premiumSessionMinutes: 480,
    maxSessionMinutes: 720,
    staminaCostPerMinute: 5,
    dailyRewardCapKey: 'farm_session:hoa_diem_son_chu_tuoc_dinh',
    monsterPool: [
      entry('xich_diem_yeu_xa', 'YEU_THU', { weight: 10, minRealmOrder: 4 }),
      entry('hoa_yen_thu', 'YEU_THU', { weight: 6, minRealmOrder: 4 }),
    ],
    eliteEncounterPool: [
      entry('hoa_long_chi_linh', 'LINH_THE', { weight: 4, canAutoBattle: false, manualOnly: true, dangerLevel: 'DANGEROUS', minRealmOrder: 4 }),
    ],
    miniBossEncounterPool: [
      entry('chu_tuoc_huyet_dieu', 'YEU_THU', { weight: 1, canAutoBattle: false, manualOnly: true, dangerLevel: 'EXTREME', minRealmOrder: 4 }),
    ],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_alchemy_tier_4',
    sourceHintVi: 'Phượng huyết tinh, hoả tinh nguyên thuỷ, mảnh công pháp hoả hệ thượng.',
    sourceHintEn: 'Phoenix blood essence, primordial flame crystals, premium fire-method fragments.',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Khu 8 — Hoàng Thổ Huyệt (Nguyên Anh, sourceTier 4, 3 farm map)
  // ═══════════════════════════════════════════════════════════════════════
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
    key: 'hoang_tho_huyet_thach_linh',
    nameVi: 'Hoàng Thổ Huyệt — Thạch Linh Trận',
    nameEn: 'Yellow-Earth Hollow — Stone-Spirit Array',
    loreVi:
      'Trận thạch ngàn năm — Thạch Quang Yêu Thú gác cổng trận, Chấp Niệm Ảnh lơ lửng giữa các trụ đá phong ấn.',
    loreEn:
      'A thousand-year stone array — Stone-Light Yao Beasts guard the array gate while Attachment Specters drift between sealing stone pillars.',
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
    staminaCostPerMinute: 4,
    dailyRewardCapKey: 'farm_session:hoang_tho_huyet_thach_linh',
    monsterPool: [
      entry('thach_quang_yeu_thu', 'CO_THU', { weight: 10, minRealmOrder: 4 }),
      entry('chap_niem_anh', 'QUY_VAT', { weight: 6, minRealmOrder: 4 }),
    ],
    eliteEncounterPool: [
      entry('hoang_tho_cu_yeu', 'CO_THU', { weight: 3, canAutoBattle: false, manualOnly: true, dangerLevel: 'DANGEROUS', minRealmOrder: 4 }),
    ],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_body_tier_4',
    sourceHintVi: 'Thạch linh tinh, đất cổ ngàn năm, mảnh trận pháp.',
    sourceHintEn: 'Stone-spirit essence, thousand-year earth, formation-method shards.',
    enabled: true,
  },
  {
    key: 'hoang_tho_huyet_long_mach',
    nameVi: 'Hoàng Thổ Huyệt — Long Mạch Địa Đạo',
    nameEn: 'Yellow-Earth Hollow — Dragon-Vein Tunnels',
    loreVi:
      'Địa đạo xuyên qua long mạch — Tâm Ma Nguyên Anh ẩn trong bóng tối đất, Thổ Địa Lão Tử canh giữ kho tàng cuối đường hầm.',
    loreEn:
      'Tunnels running through a dragon vein — Nascent-Soul Inner Demons lurk in the earth shadows while the Earth-Lord Elder guards the treasure at tunnel\'s end.',
    regionKey: 'hoang_tho_huyet',
    sourceTier: 4,
    unlockRealmOrder: 4,
    recommendedRealmOrder: 4,
    autoFarmAllowed: true,
    sweepAllowed: true,
    freeSessionMinutes: 30,
    monthlyCardSessionMinutes: 240,
    premiumSessionMinutes: 480,
    maxSessionMinutes: 720,
    staminaCostPerMinute: 5,
    dailyRewardCapKey: 'farm_session:hoang_tho_huyet_long_mach',
    monsterPool: [
      entry('thach_quang_yeu_thu', 'CO_THU', { weight: 8, minRealmOrder: 4 }),
      entry('chap_niem_anh', 'QUY_VAT', { weight: 6, minRealmOrder: 4 }),
      entry('tam_ma_nguyen_anh', 'TAM_MA', { weight: 4, minRealmOrder: 4 }),
    ],
    eliteEncounterPool: [
      entry('hoang_tho_cu_yeu', 'CO_THU', { weight: 3, canAutoBattle: false, manualOnly: true, dangerLevel: 'DANGEROUS', minRealmOrder: 4 }),
    ],
    miniBossEncounterPool: [
      entry('thach_long_co_giap', 'CO_THU', { weight: 1, canAutoBattle: false, manualOnly: true, dangerLevel: 'EXTREME', minRealmOrder: 4 }),
    ],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_body_tier_4',
    sourceHintVi: 'Long mạch tinh hoa, tâm ma nguyên anh, đá rồng cổ.',
    sourceHintEn: 'Dragon-vein essence, nascent-soul demon shards, ancient dragon stones.',
    enabled: true,
  },

  // ═══════════════════════════════════════════════════════════════════════
  // Khu 9 — Cửu La Điện (Hoá Thần, sourceTier 5, 3 farm map)
  // ═══════════════════════════════════════════════════════════════════════
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
  {
    key: 'cuu_la_dien_lau_dai',
    nameVi: 'Cửu La Điện — Lầu Đài Ma Đạo',
    nameEn: 'Nine-Net Hall — Demon-Path Tower',
    loreVi:
      'Lầu đài cổ nơi ma tu thượng cổ luyện ma công — Cửu La Huyền Quân trấn giữ tầng giữa. Dành cho tu sĩ Hoá Thần trung kỳ.',
    loreEn:
      'An ancient tower where primordial demon-cultivators refined dark arts — the Nine-Net Mysterious Army guards the middle floors; reserved for mid-stage Spirit-Transformation cultivators.',
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
    dailyRewardCapKey: 'farm_session:cuu_la_dien_lau_dai',
    monsterPool: [],
    eliteEncounterPool: [],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_tribulation_tier_5',
    sourceHintVi: 'Ma hạch thượng hạng, công pháp ma đạo, mảnh tâm pháp vô thượng.',
    sourceHintEn: 'Premium demon cores, demon-path methods, supreme mind-method fragments.',
    enabled: false,
  },
  {
    key: 'cuu_la_dien_thap_dao',
    nameVi: 'Cửu La Điện — Tháp Đạo Luân Hồi',
    nameEn: 'Nine-Net Hall — Dao-Reincarnation Pagoda',
    loreVi:
      'Tháp thử nghiệm đạo tâm — tầng cao nhất ẩn giấu bí mật của Cửu La Thiên Đế. Chỉ tu sĩ Hoá Thần hậu kỳ mới có thể leo lên đỉnh.',
    loreEn:
      'A pagoda testing dao conviction — the topmost floor hides the Heavenly Emperor of Nine Nets\' deepest secret; only late-stage Spirit-Transformation cultivators may attempt the ascent.',
    regionKey: 'cuu_la_dien',
    sourceTier: 5,
    unlockRealmOrder: 5,
    recommendedRealmOrder: 5,
    autoFarmAllowed: false,
    sweepAllowed: false,
    freeSessionMinutes: 20,
    monthlyCardSessionMinutes: 40,
    premiumSessionMinutes: 60,
    maxSessionMinutes: 90,
    staminaCostPerMinute: 6,
    dailyRewardCapKey: 'farm_session:cuu_la_dien_thap_dao',
    monsterPool: [],
    eliteEncounterPool: [],
    miniBossEncounterPool: [],
    higherTierMonsterPool: [],
    opportunityPool: [],
    dropProfileKey: 'farm_tribulation_tier_5',
    sourceHintVi: 'Đạo tâm tinh hoa, vật liệu vượt kiếp tối thượng, mảnh công pháp thiên đạo.',
    sourceHintEn: 'Dao-conviction essence, supreme tribulation materials, heavenly-method fragments.',
    enabled: false,
  },
];
