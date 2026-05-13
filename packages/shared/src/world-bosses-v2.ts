/**
 * Phase 26.5 — World Boss V2 catalog.
 *
 * Mở rộng song song `boss.ts` cũ (Phase 7 + 10) + `coop-boss.ts` (multi-
 * region cooperative). V2 thêm `BossCategory` (10 loại) để phân biệt boss
 * theo nguồn xuất hiện và cap reward:
 *
 *   - REGION_BOSS  — boss khu vực, daily cap.
 *   - HOURLY_BOSS  — boss giờ (12:00 / 18:00 / 21:00 ...).
 *   - WORLD_BOSS   — server-wide, weekly cap.
 *   - EVENT_BOSS   — chỉ mở trong event.
 *   - MAIN_QUEST_BOSS / SIDE_QUEST_BOSS — chặn cốt truyện.
 *   - DUNGEON_BOSS — gắn dungeon V2.
 *   - SECT_BOSS    — sect content (xem `sect-content.ts`).
 *   - HIDDEN_BOSS  — điều kiện đặc biệt.
 *   - TRIAL_BOSS   — Trial Tower.
 *
 * Pure catalog + helper. Service `BossV2Service` runtime (cụm API) sẽ
 * resolve schedule + spawn + reward grant qua `WorldBoss` Prisma model
 * (existing) + thêm `bossV2Key` field qua additive migration.
 */
import type { DungeonRunReward } from './combat';
import type { RegionKey } from './map-regions';
import type { MonsterFamily } from './monster-taxonomy';
import type { ElementKey } from './combat';

// ───────────────────────────────────────────────────────────────────────────
// BossCategory
// ───────────────────────────────────────────────────────────────────────────

export type BossCategory =
  | 'REGION_BOSS'
  | 'HOURLY_BOSS'
  | 'WORLD_BOSS'
  | 'EVENT_BOSS'
  | 'MAIN_QUEST_BOSS'
  | 'SIDE_QUEST_BOSS'
  | 'DUNGEON_BOSS'
  | 'SECT_BOSS'
  | 'HIDDEN_BOSS'
  | 'TRIAL_BOSS';

export const BOSS_CATEGORIES: readonly BossCategory[] = [
  'REGION_BOSS',
  'HOURLY_BOSS',
  'WORLD_BOSS',
  'EVENT_BOSS',
  'MAIN_QUEST_BOSS',
  'SIDE_QUEST_BOSS',
  'DUNGEON_BOSS',
  'SECT_BOSS',
  'HIDDEN_BOSS',
  'TRIAL_BOSS',
] as const;

// ───────────────────────────────────────────────────────────────────────────
// Schedule / Spawn types
// ───────────────────────────────────────────────────────────────────────────

/**
 * Schedule cho HOURLY_BOSS / WORLD_BOSS / EVENT_BOSS. Service runtime
 * resolve thành cron rule khi spawn.
 */
export interface BossSchedule {
  /** Giờ trong ngày (UTC) — 0..23, support nhiều mốc. `null` = on-demand. */
  hoursOfDay?: readonly number[] | null;
  /** Ngày trong tuần (0=Sun..6=Sat). `null` = mọi ngày. */
  daysOfWeek?: readonly number[] | null;
  /** Event window: chỉ active trong event này. `null` = không liên kết event. */
  eventKey?: string | null;
  /** Thời lượng active (phút) sau khi spawn. */
  activeMinutes: number;
}

export interface BossSpawnRule {
  /** Quest required để boss xuất hiện. */
  questKey?: string | null;
  /** Item required (vd chìa khóa / mảnh ban đồ). */
  requireItemKey?: string | null;
  /** Min realm order. */
  minRealmOrder?: number | null;
  /** UI hint mô tả điều kiện. */
  hintVi?: string;
  hintEn?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// BossV2Def
// ───────────────────────────────────────────────────────────────────────────

export interface BossRankingRewardProfile {
  /** Reward cho top 1. */
  top1: DungeonRunReward;
  /** Reward cho top 2-10. */
  top10: DungeonRunReward;
  /** Reward cho top 11-100. */
  top100: DungeonRunReward;
  /** Reward participation (mọi người tham gia damage > 0). */
  participation: DungeonRunReward;
}

export interface BossV2Def {
  key: string;
  nameVi: string;
  nameEn: string;
  titleVi: string;
  titleEn: string;
  descriptionVi: string;
  descriptionEn: string;
  loreVi?: string;
  loreEn?: string;
  category: BossCategory;
  family: MonsterFamily;
  element: ElementKey | null;
  regionKey?: RegionKey | null;
  dungeonKey?: string | null;
  questKey?: string | null;
  sectRequired?: boolean;
  /** sourceTier cố định (1..9). */
  sourceTier: number;
  /** bossTier — sub-tier khó trong sourceTier (1..5). */
  bossTier: number;
  recommendedRealmOrder: number;
  recommendedPower: number;
  schedule?: BossSchedule | null;
  spawnRule?: BossSpawnRule | null;
  /** Cap daily clear (per character). 0 = không cap daily. */
  dailyRewardCap: number;
  /** Cap weekly clear (per character). 0 = không cap weekly. */
  weeklyRewardCap: number;
  /** Reward chỉ nhận 1 lần khi kill lần đầu. */
  firstKillReward?: DungeonRunReward | null;
  repeatRewardProfile: DungeonRunReward;
  /** Ranking reward (WORLD_BOSS / EVENT_BOSS / TRIAL_BOSS). */
  rankingRewardProfile?: BossRankingRewardProfile | null;
  /** Drop profile resolver key. */
  dropProfileKey: string;
  /** Auto-battle bị chặn trên mọi boss V2 (server enforce, không bypass). */
  manualOnly: boolean;
  enabled: boolean;
}

export function getBossV2ByKey(key: string): BossV2Def | undefined {
  return BOSSES_V2.find((b) => b.key === key);
}

export function getBossesV2ByCategory(category: BossCategory): readonly BossV2Def[] {
  return BOSSES_V2.filter((b) => b.category === category);
}

export function getBossesV2ByRegion(region: RegionKey): readonly BossV2Def[] {
  return BOSSES_V2.filter((b) => b.regionKey === region);
}

// ───────────────────────────────────────────────────────────────────────────
// Seed — bao phủ tất cả 10 BossCategory
// ───────────────────────────────────────────────────────────────────────────

export const BOSSES_V2: readonly BossV2Def[] = [
  // ═══ REGION_BOSS ════════════════════════════════════════════════════════
  {
    key: 'son_coc_thach_giap_lao_yeu',
    nameVi: 'Thạch Giáp Lão Yêu',
    nameEn: 'Old Stone-Plate Yao',
    titleVi: 'Khu chủ Sơn Cốc',
    titleEn: 'Master of Mountain Valley',
    descriptionVi:
      'Lão yêu vạn năm nương theo đá tảng, vảy như kim cương, là khu chủ Sơn Cốc.',
    descriptionEn:
      'A ten-thousand-year-old yao clad in diamond-hard scales — the territorial lord of Mountain Valley.',
    category: 'REGION_BOSS',
    family: 'CO_THU',
    element: 'tho',
    regionKey: 'son_coc',
    sourceTier: 1,
    bossTier: 1,
    recommendedRealmOrder: 1,
    recommendedPower: 200,
    dailyRewardCap: 1,
    weeklyRewardCap: 5,
    firstKillReward: { linhThach: 300, exp: 600, items: [{ itemKey: 'huyet_chi_dan', qty: 2 }] },
    repeatRewardProfile: { linhThach: 80, exp: 150 },
    dropProfileKey: 'boss_region_tier_1',
    manualOnly: true,
    enabled: true,
  },
  {
    key: 'hac_lam_hac_quy_vuong',
    nameVi: 'Hắc Quỷ Vương',
    nameEn: 'Black Ghost King',
    titleVi: 'Khu chủ Hắc Lâm',
    titleEn: 'Master of Black Forest',
    descriptionVi:
      'Quỷ vương âm hệ ngự trị giữa rừng đen, hồn tinh ngàn năm hội tụ.',
    descriptionEn:
      'A yin-element ghost king ruling the black forest — millennium-old soul essence converges within.',
    category: 'REGION_BOSS',
    family: 'QUY_VAT',
    element: 'moc',
    regionKey: 'hac_lam',
    sourceTier: 2,
    bossTier: 2,
    recommendedRealmOrder: 2,
    recommendedPower: 600,
    dailyRewardCap: 1,
    weeklyRewardCap: 5,
    firstKillReward: { linhThach: 600, exp: 1200, items: [{ itemKey: 'huyet_tinh', qty: 3 }] },
    repeatRewardProfile: { linhThach: 150, exp: 300 },
    dropProfileKey: 'boss_region_tier_2',
    manualOnly: true,
    enabled: true,
  },
  {
    key: 'kim_son_huyen_kim_long_vuong',
    nameVi: 'Huyền Kim Long Vương',
    nameEn: 'Mystic-Gold Dragon King',
    titleVi: 'Khu chủ Kim Sơn Mạch',
    titleEn: 'Master of Golden Mountain Vein',
    descriptionVi:
      'Long vương kim hệ ẩn trong mạch núi vàng — vảy huyền kim, kiếm phách tinh thuần.',
    descriptionEn:
      'A gold-element dragon king hidden in the golden vein — mystic-gold scales, pure sword-essence soul.',
    category: 'REGION_BOSS',
    family: 'CO_THU',
    element: 'kim',
    regionKey: 'kim_son_mach',
    sourceTier: 3,
    bossTier: 3,
    recommendedRealmOrder: 3,
    recommendedPower: 1500,
    dailyRewardCap: 1,
    weeklyRewardCap: 4,
    firstKillReward: { linhThach: 1200, tienNgoc: 2, exp: 2400, items: [{ itemKey: 'tinh_thiet', qty: 5 }] },
    repeatRewardProfile: { linhThach: 300, exp: 600 },
    dropProfileKey: 'boss_region_tier_3',
    manualOnly: true,
    enabled: true,
  },

  // ═══ HOURLY_BOSS ════════════════════════════════════════════════════════
  {
    key: 'thien_giang_hoi_yeu',
    nameVi: 'Thiên Giáng Hồi Yêu',
    nameEn: 'Heavenly-Descended Echo Yao',
    titleVi: 'Yêu vương xuất thế',
    titleEn: 'Yao King Emerges',
    descriptionVi:
      'Yêu vương xuất thế theo khung giờ 12:00 / 18:00 / 21:00 (UTC+0). Tu sĩ Kim Đan đua nhau thử vận.',
    descriptionEn:
      'A yao king appears at 12:00 / 18:00 / 21:00 (UTC) — Golden Core cultivators rush to challenge fate.',
    category: 'HOURLY_BOSS',
    family: 'YEU_THU',
    element: null,
    regionKey: 'yeu_thu_dong',
    sourceTier: 3,
    bossTier: 2,
    recommendedRealmOrder: 3,
    recommendedPower: 1400,
    schedule: {
      hoursOfDay: [12, 18, 21],
      daysOfWeek: null,
      activeMinutes: 30,
    },
    dailyRewardCap: 2,
    weeklyRewardCap: 8,
    firstKillReward: { linhThach: 800, tienNgoc: 1, exp: 1600 },
    repeatRewardProfile: { linhThach: 200, exp: 400 },
    dropProfileKey: 'boss_hourly_tier_3',
    manualOnly: true,
    enabled: true,
  },

  // ═══ WORLD_BOSS ═════════════════════════════════════════════════════════
  {
    key: 'cuu_la_huyen_thien_long',
    nameVi: 'Cửu La Huyền Thiên Long',
    nameEn: 'Nine-Net Mystic-Heaven Dragon',
    titleVi: 'Boss thế giới',
    titleEn: 'World Boss',
    descriptionVi:
      'Long thần thượng cổ phong ấn dưới Cửu La Điện — cả server cùng đánh, có ranking damage tuần.',
    descriptionEn:
      'A primordial dragon-god sealed beneath Nine-Net Hall — the entire server fights together, weekly damage ranking.',
    category: 'WORLD_BOSS',
    family: 'CO_THU',
    element: 'thuy',
    regionKey: 'cuu_la_dien',
    sourceTier: 6,
    bossTier: 4,
    recommendedRealmOrder: 9,
    recommendedPower: 15000,
    schedule: {
      hoursOfDay: [20],
      daysOfWeek: [0, 3, 6],
      activeMinutes: 60,
    },
    dailyRewardCap: 0,
    weeklyRewardCap: 3,
    firstKillReward: { linhThach: 5000, tienNgoc: 10, exp: 12000 },
    repeatRewardProfile: { linhThach: 1500, tienNgoc: 2, exp: 3000 },
    rankingRewardProfile: {
      top1: { linhThach: 12000, tienNgoc: 50, exp: 24000 },
      top10: { linhThach: 6000, tienNgoc: 20, exp: 12000 },
      top100: { linhThach: 2000, tienNgoc: 5, exp: 4000 },
      participation: { linhThach: 500, exp: 1000 },
    },
    dropProfileKey: 'boss_world_tier_6',
    manualOnly: true,
    enabled: true,
  },

  // ═══ EVENT_BOSS ═════════════════════════════════════════════════════════
  {
    key: 'sang_xuan_yeu_vuong',
    nameVi: 'Sảng Xuân Yêu Vương',
    nameEn: 'Spring-Joy Yao King',
    titleVi: 'Boss sự kiện mùa xuân',
    titleEn: 'Spring Event Boss',
    descriptionVi:
      'Yêu vương xuất hiện trong sự kiện mùa xuân — token event, danh hiệu, nguyên liệu mùa.',
    descriptionEn:
      'A yao king emerging during the spring event — event tokens, titles, season materials.',
    category: 'EVENT_BOSS',
    family: 'YEU_THU',
    element: 'moc',
    regionKey: 'moc_huyen_lam',
    sourceTier: 3,
    bossTier: 2,
    recommendedRealmOrder: 3,
    recommendedPower: 1200,
    schedule: {
      eventKey: 'spring_festival',
      hoursOfDay: null,
      activeMinutes: 1440,
    },
    dailyRewardCap: 2,
    weeklyRewardCap: 10,
    repeatRewardProfile: { linhThach: 300, exp: 600 },
    dropProfileKey: 'boss_event_tier_3',
    manualOnly: true,
    enabled: false,
  },

  // ═══ MAIN_QUEST_BOSS ═══════════════════════════════════════════════════
  {
    key: 'main_quest_son_coc_son_thu_chua',
    nameVi: 'Sơn Thử Chúa',
    nameEn: 'Mountain Rat King',
    titleVi: 'Boss chính tuyến — chương Sơn Cốc',
    titleEn: 'Main Quest Boss — Mountain Valley Chapter',
    descriptionVi:
      'Sơn thử chúa cấp Luyện Khí, chặn nhiệm vụ chính tuyến đầu tiên. Không farm lặp.',
    descriptionEn:
      'A Qi-Refining mountain-rat king blocking the first main-quest milestone — not farmable.',
    category: 'MAIN_QUEST_BOSS',
    family: 'YEU_THU',
    element: null,
    regionKey: 'son_coc',
    questKey: 'main_son_coc_chap_1',
    sourceTier: 1,
    bossTier: 1,
    recommendedRealmOrder: 1,
    recommendedPower: 100,
    dailyRewardCap: 1,
    weeklyRewardCap: 1,
    firstKillReward: { linhThach: 500, exp: 800 },
    repeatRewardProfile: { linhThach: 0, exp: 0 },
    dropProfileKey: 'boss_quest_tier_1',
    manualOnly: true,
    enabled: true,
  },

  // ═══ SIDE_QUEST_BOSS ═══════════════════════════════════════════════════
  {
    key: 'side_quest_son_coc_co_thuat_su_anh',
    nameVi: 'Bóng Cổ Thuật Sư',
    nameEn: 'Ancient Mage Shadow',
    titleVi: 'Boss nhiệm vụ phụ',
    titleEn: 'Side Quest Boss',
    descriptionVi:
      'Bóng cổ thuật sư gắn nhiệm vụ phụ NPC thân thiện — mở shop ẩn, nguyên liệu đặc thù.',
    descriptionEn:
      'An ancient mage shadow tied to friendly-NPC side-quest — unlocks hidden shop, special materials.',
    category: 'SIDE_QUEST_BOSS',
    family: 'LINH_THE',
    element: null,
    regionKey: 'son_coc',
    questKey: 'side_son_coc_co_thuat_su',
    sourceTier: 1,
    bossTier: 2,
    recommendedRealmOrder: 1,
    recommendedPower: 150,
    dailyRewardCap: 1,
    weeklyRewardCap: 3,
    firstKillReward: { linhThach: 300, exp: 500 },
    repeatRewardProfile: { linhThach: 50, exp: 100 },
    dropProfileKey: 'boss_side_quest_tier_1',
    manualOnly: true,
    enabled: true,
  },

  // ═══ DUNGEON_BOSS ══════════════════════════════════════════════════════
  {
    key: 'dungeon_kim_son_luyen_khi_phong_chu',
    nameVi: 'Luyện Khí Phòng Chủ',
    nameEn: 'Artifact-Forge Master',
    titleVi: 'Boss bí cảnh Luyện Khí Phòng',
    titleEn: 'Boss of Artifact Forge Chamber',
    descriptionVi:
      'Lão giả khôi lỗi giữ lò luyện khí — vảy linh kim, kiếm khí tinh thuần.',
    descriptionEn:
      'A construct-elder guarding the artifact forge — spirit-metal scales, pure sword-qi.',
    category: 'DUNGEON_BOSS',
    family: 'KHOI_LOI',
    element: 'kim',
    regionKey: 'kim_son_mach',
    dungeonKey: 'kim_son_luyen_khi_phong',
    sourceTier: 3,
    bossTier: 3,
    recommendedRealmOrder: 3,
    recommendedPower: 800,
    dailyRewardCap: 2,
    weeklyRewardCap: 10,
    firstKillReward: { linhThach: 600, exp: 1200, items: [{ itemKey: 'tinh_thiet', qty: 2 }] },
    repeatRewardProfile: { linhThach: 150, exp: 300 },
    dropProfileKey: 'boss_dungeon_tier_3',
    manualOnly: true,
    enabled: true,
  },

  // ═══ HIDDEN_BOSS ═══════════════════════════════════════════════════════
  {
    key: 'hidden_hac_lam_thi_quy_de',
    nameVi: 'Thi Quỷ Đế',
    nameEn: 'Corpse-Ghost Emperor',
    titleVi: 'Boss ẩn — Hắc Lâm',
    titleEn: 'Hidden Boss — Black Forest',
    descriptionVi:
      'Boss ẩn hồi sinh khi tu sĩ mang theo đèn lồng cổ vào giữa đêm Hắc Lâm.',
    descriptionEn:
      'A hidden boss reborn when a cultivator carries an ancient lantern into the Black Forest at midnight.',
    category: 'HIDDEN_BOSS',
    family: 'QUY_VAT',
    element: null,
    regionKey: 'hac_lam',
    sourceTier: 2,
    bossTier: 4,
    recommendedRealmOrder: 2,
    recommendedPower: 900,
    spawnRule: {
      requireItemKey: 'co_dang_long',
      hintVi: 'Mang theo Cổ Đăng Lồng vào Hắc Lâm sau giờ Tý.',
      hintEn: 'Bring the Ancient Lantern into Black Forest after midnight.',
    },
    dailyRewardCap: 0,
    weeklyRewardCap: 2,
    firstKillReward: { linhThach: 1500, tienNgoc: 3, exp: 3000 },
    repeatRewardProfile: { linhThach: 200, exp: 400 },
    dropProfileKey: 'boss_hidden_tier_2',
    manualOnly: true,
    enabled: true,
  },

  // ═══ SECT_BOSS ═════════════════════════════════════════════════════════
  {
    key: 'sect_thu_ho_linh_mach',
    nameVi: 'Thủ Hộ Linh Mạch',
    nameEn: 'Spirit-Vein Guardian',
    titleVi: 'Boss tông môn — luyện tập ngày',
    titleEn: 'Sect Boss — daily training',
    descriptionVi:
      'Linh thể trấn giữ linh mạch tông môn — boss luyện tập ngày cho đệ tử tông môn.',
    descriptionEn:
      'A spirit entity guarding the sect spirit-vein — daily training boss for sect disciples.',
    category: 'SECT_BOSS',
    family: 'LINH_THE',
    element: null,
    sectRequired: true,
    sourceTier: 2,
    bossTier: 2,
    recommendedRealmOrder: 2,
    recommendedPower: 500,
    dailyRewardCap: 1,
    weeklyRewardCap: 5,
    firstKillReward: { linhThach: 200, exp: 400 },
    repeatRewardProfile: { linhThach: 50, exp: 100 },
    dropProfileKey: 'boss_sect_tier_2',
    manualOnly: true,
    enabled: true,
  },

  // ═══ TRIAL_BOSS — milestone floor anchor cho Trial Tower ═══════════════
  {
    key: 'trial_dang_tien_milestone_100',
    nameVi: 'Đăng Tiên Tháp — Mốc 100',
    nameEn: 'Ascend-Immortal Tower — Floor 100',
    titleVi: 'Boss cảnh giới checkpoint',
    titleEn: 'Realm Checkpoint Boss',
    descriptionVi:
      'Boss mốc tầng 100 Đăng Tiên Tháp — kiểm tra sức mạnh tổng thể đột phá cảnh giới.',
    descriptionEn:
      'Floor-100 milestone boss of the Ascend-Immortal Tower — tests overall strength to break through.',
    category: 'TRIAL_BOSS',
    family: 'DAO_ANH',
    element: null,
    sourceTier: 3,
    bossTier: 3,
    recommendedRealmOrder: 3,
    recommendedPower: 2500,
    dailyRewardCap: 0,
    weeklyRewardCap: 0,
    firstKillReward: { linhThach: 1000, tienNgoc: 5, exp: 2000 },
    repeatRewardProfile: { linhThach: 0, exp: 0 },
    dropProfileKey: 'boss_trial_tier_3',
    manualOnly: true,
    enabled: true,
  },
];
