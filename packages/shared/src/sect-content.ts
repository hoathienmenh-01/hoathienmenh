/**
 * Phase 26.5 — Sect content (bí cảnh tông môn + sect boss).
 *
 * Bổ sung content riêng cho tông môn (sect). KHÔNG sửa `sect-war.ts` /
 * `sect-missions.ts` / `sect-shop.ts` cũ — đây là layer content (PvE) song
 * song với layer governance (war / mission / shop). Runtime service
 * `SectContentService` (cụm API) sẽ enforce gating + cap + contribution
 * cost.
 *
 * Pure catalog + helper. Anti-P2W: cap daily/weekly per member + per sect,
 * không bypass bằng premium.
 */
import type { DungeonRunReward } from './combat';
import type { MonsterFamily } from './monster-taxonomy';
import type { BossSchedule } from './world-bosses-v2';

// ───────────────────────────────────────────────────────────────────────────
// SectDungeonCategory — phân loại bí cảnh tông môn
// ───────────────────────────────────────────────────────────────────────────

export type SectDungeonCategory =
  | 'LINH_MACH'          // farm EXP/linh khí/linh thạch nhỏ
  | 'DUOC_VIEN'          // nguyên liệu luyện đan
  | 'HUYET_TRI'          // nguyên liệu luyện thể
  | 'TANG_KINH'          // mảnh công pháp
  | 'LUYEN_KHI'          // nguyên liệu trang bị/pháp bảo
  | 'CAM_DIA';           // weekly cap, nội dung cao cấp

export const SECT_DUNGEON_CATEGORIES: readonly SectDungeonCategory[] = [
  'LINH_MACH',
  'DUOC_VIEN',
  'HUYET_TRI',
  'TANG_KINH',
  'LUYEN_KHI',
  'CAM_DIA',
] as const;

// ───────────────────────────────────────────────────────────────────────────
// SectDungeonDef
// ───────────────────────────────────────────────────────────────────────────

export interface SectDungeonDef {
  key: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  loreVi?: string;
  loreEn?: string;
  category: SectDungeonCategory;
  /** Cấp tông môn tối thiểu để mở khoá. */
  requiredSectLevel: number;
  /** sourceTier cố định (1..9). */
  sourceTier: number;
  /** Cap lượt clear / member / ngày. */
  dailyAttemptsPerMember: number;
  /** Cap lượt / sect / tuần (CAM_DIA dùng). null = không cap tuần. */
  weeklyAttemptsPerSect?: number | null;
  /** Cống hiến cost mỗi lượt. 0 = miễn phí. */
  contributionCost: number;
  /** Realm order khuyến nghị. */
  recommendedRealmOrder: number;
  recommendedPower: number;
  firstClearReward?: DungeonRunReward | null;
  repeatRewardProfile: DungeonRunReward;
  /** Drop profile resolver key. */
  dropProfileKey: string;
  /** Boss key trong dungeon (optional, ref `sectBosses`). */
  bossKey?: string | null;
  enabled: boolean;
}

// ───────────────────────────────────────────────────────────────────────────
// SectBossCategory
// ───────────────────────────────────────────────────────────────────────────

export type SectBossCategory =
  | 'GUARDIAN'           // thủ hộ linh mạch — daily training
  | 'INVADER'            // yêu vương xâm nhập — sự kiện giờ/tuần
  | 'TRIAL'              // tông môn thí luyện boss — theo cấp tông môn
  | 'QUEST';             // boss nhiệm vụ tông môn — gắn nhiệm vụ tuần

export const SECT_BOSS_CATEGORIES: readonly SectBossCategory[] = [
  'GUARDIAN',
  'INVADER',
  'TRIAL',
  'QUEST',
] as const;

// ───────────────────────────────────────────────────────────────────────────
// SectBossDef
// ───────────────────────────────────────────────────────────────────────────

export interface SectBossDef {
  key: string;
  nameVi: string;
  nameEn: string;
  titleVi: string;
  titleEn: string;
  descriptionVi: string;
  descriptionEn: string;
  loreVi?: string;
  loreEn?: string;
  category: SectBossCategory;
  family: MonsterFamily;
  /** Cấp tông môn tối thiểu. */
  requiredSectLevel: number;
  sourceTier: number;
  bossTier: number;
  recommendedRealmOrder: number;
  recommendedPower: number;
  schedule?: BossSchedule | null;
  /**
   * HP scaling theo sect level. `baseHp + sectLevel * hpPerLevel`.
   */
  hpScalingBySectLevel: {
    baseHp: number;
    hpPerLevel: number;
  };
  /** Cap lượt / member / ngày. */
  dailyAttemptsPerMember: number;
  /** Cap lượt / sect / tuần. */
  weeklyAttemptsPerSect: number;
  firstKillReward?: DungeonRunReward | null;
  /** Cống hiến tông môn cho mỗi participant. */
  contributionReward: number;
  /** Sect buff key tạm thời sau khi clear (optional). */
  sectBuffRewardKey?: string | null;
  /** Sect buff thời lượng (giờ). */
  sectBuffDurationHours?: number | null;
  /** Ranking reward (TRIAL / INVADER có thể có). */
  rankingRewardProfile?: {
    top1: DungeonRunReward;
    top3: DungeonRunReward;
    participation: DungeonRunReward;
  } | null;
  /** Drop profile resolver key. */
  dropProfileKey: string;
  enabled: boolean;
}

export function getSectDungeonByKey(key: string): SectDungeonDef | undefined {
  return SECT_DUNGEONS.find((d) => d.key === key);
}

export function getSectBossByKey(key: string): SectBossDef | undefined {
  return SECT_BOSSES.find((b) => b.key === key);
}

export function getSectDungeonsByCategory(
  category: SectDungeonCategory,
): readonly SectDungeonDef[] {
  return SECT_DUNGEONS.filter((d) => d.category === category);
}

export function getSectBossesByCategory(
  category: SectBossCategory,
): readonly SectBossDef[] {
  return SECT_BOSSES.filter((b) => b.category === category);
}

/**
 * Compute HP cho sect boss tại sect level. Anti-P2W: scaling
 * deterministic — không cho phép bypass bằng cấp gói.
 */
export function computeSectBossHp(boss: SectBossDef, sectLevel: number): number {
  const lv = Math.max(1, sectLevel);
  return boss.hpScalingBySectLevel.baseHp + boss.hpScalingBySectLevel.hpPerLevel * lv;
}

/**
 * Gating check cho sect dungeon. Membership status, sect level, contribution
 * balance được resolve runtime; helper này chỉ check static config.
 */
export function canEnterSectDungeon(
  dungeon: SectDungeonDef,
  args: {
    playerSectLevel: number;
    playerContribution: number;
    playerRealmOrder?: number;
  },
): {
  allowed: boolean;
  reason?: 'SECT_LEVEL_TOO_LOW' | 'NOT_ENOUGH_CONTRIBUTION' | 'REALM_TOO_LOW' | 'DISABLED';
} {
  if (!dungeon.enabled) return { allowed: false, reason: 'DISABLED' };
  if (args.playerSectLevel < dungeon.requiredSectLevel) {
    return { allowed: false, reason: 'SECT_LEVEL_TOO_LOW' };
  }
  if (args.playerContribution < dungeon.contributionCost) {
    return { allowed: false, reason: 'NOT_ENOUGH_CONTRIBUTION' };
  }
  if (
    args.playerRealmOrder != null &&
    args.playerRealmOrder < dungeon.recommendedRealmOrder
  ) {
    return { allowed: false, reason: 'REALM_TOO_LOW' };
  }
  return { allowed: true };
}

// ───────────────────────────────────────────────────────────────────────────
// Seed — 6 sect dungeon (1 per category) + 4 sect boss (1 per category)
// ───────────────────────────────────────────────────────────────────────────

export const SECT_DUNGEONS: readonly SectDungeonDef[] = [
  {
    key: 'sect_linh_mach_dong',
    nameVi: 'Linh Mạch Động',
    nameEn: 'Spirit-Vein Cave',
    descriptionVi:
      'Hang linh mạch trung tâm tông môn — farm EXP, linh khí, linh thạch nhỏ. Mở từ sect cấp 1.',
    descriptionEn:
      'Central spirit-vein cave of the sect — farm EXP, spirit qi, small spirit stones. Unlocks at sect level 1.',
    category: 'LINH_MACH',
    requiredSectLevel: 1,
    sourceTier: 1,
    dailyAttemptsPerMember: 3,
    contributionCost: 0,
    recommendedRealmOrder: 1,
    recommendedPower: 60,
    firstClearReward: { linhThach: 100, exp: 200 },
    repeatRewardProfile: { linhThach: 30, exp: 80 },
    dropProfileKey: 'sect_dungeon_linh_mach_tier_1',
    enabled: true,
  },
  {
    key: 'sect_duoc_vien_bi_canh',
    nameVi: 'Dược Viên Bí Cảnh',
    nameEn: 'Herb Garden Secret',
    descriptionVi:
      'Bí cảnh dược viên tông môn — farm nguyên liệu luyện đan đặc thù tông môn.',
    descriptionEn:
      'Sect herb garden secret — farm sect-specific alchemy ingredients.',
    category: 'DUOC_VIEN',
    requiredSectLevel: 2,
    sourceTier: 2,
    dailyAttemptsPerMember: 2,
    contributionCost: 50,
    recommendedRealmOrder: 2,
    recommendedPower: 200,
    firstClearReward: { linhThach: 200, exp: 400, items: [{ itemKey: 'linh_thao', qty: 5 }] },
    repeatRewardProfile: { linhThach: 60, exp: 120 },
    dropProfileKey: 'sect_dungeon_duoc_vien_tier_2',
    enabled: true,
  },
  {
    key: 'sect_huyet_tri_luyen_the',
    nameVi: 'Huyết Trì Luyện Thể',
    nameEn: 'Blood-Pool Body Forge',
    descriptionVi:
      'Hồ huyết tông môn — farm nguyên liệu luyện thể, huyết tinh, đoán cốt thạch.',
    descriptionEn:
      'Sect blood pool — farm body-cultivation materials, blood essence, bone-forging stones.',
    category: 'HUYET_TRI',
    requiredSectLevel: 2,
    sourceTier: 2,
    dailyAttemptsPerMember: 2,
    contributionCost: 50,
    recommendedRealmOrder: 2,
    recommendedPower: 250,
    firstClearReward: { linhThach: 200, exp: 400, items: [{ itemKey: 'huyet_chi_dan', qty: 2 }] },
    repeatRewardProfile: { linhThach: 60, exp: 120 },
    dropProfileKey: 'sect_dungeon_huyet_tri_tier_2',
    enabled: true,
  },
  {
    key: 'sect_tang_kinh_thi_luyen',
    nameVi: 'Tàng Kinh Các Thí Luyện',
    nameEn: 'Scripture-Pavilion Trial',
    descriptionVi:
      'Thí luyện tàng kinh các — farm mảnh công pháp tông môn, điểm lĩnh ngộ.',
    descriptionEn:
      'Scripture-pavilion trial — farm sect method fragments, comprehension points.',
    category: 'TANG_KINH',
    requiredSectLevel: 3,
    sourceTier: 3,
    dailyAttemptsPerMember: 2,
    contributionCost: 80,
    recommendedRealmOrder: 3,
    recommendedPower: 500,
    firstClearReward: { linhThach: 350, exp: 700 },
    repeatRewardProfile: { linhThach: 100, exp: 200 },
    dropProfileKey: 'sect_dungeon_tang_kinh_tier_3',
    enabled: true,
  },
  {
    key: 'sect_luyen_khi_phong',
    nameVi: 'Luyện Khí Phòng',
    nameEn: 'Artifact-Forge Chamber',
    descriptionVi:
      'Phòng luyện khí tông môn — farm nguyên liệu trang bị / pháp bảo cấp tông môn.',
    descriptionEn:
      'Sect artifact-forge chamber — farm sect-grade equipment / artifact materials.',
    category: 'LUYEN_KHI',
    requiredSectLevel: 3,
    sourceTier: 3,
    dailyAttemptsPerMember: 2,
    contributionCost: 80,
    recommendedRealmOrder: 3,
    recommendedPower: 550,
    firstClearReward: { linhThach: 350, exp: 700, items: [{ itemKey: 'tinh_thiet', qty: 3 }] },
    repeatRewardProfile: { linhThach: 100, exp: 200 },
    dropProfileKey: 'sect_dungeon_luyen_khi_tier_3',
    enabled: true,
  },
  {
    key: 'sect_cam_dia',
    nameVi: 'Tông Môn Cấm Địa',
    nameEn: 'Sect Forbidden Land',
    descriptionVi:
      'Cấm địa tông môn — nội dung cao cấp, weekly cap, reward hiếm. Mở sect cấp 5.',
    descriptionEn:
      'Sect forbidden land — high-end content, weekly cap, rare rewards. Unlocks at sect level 5.',
    category: 'CAM_DIA',
    requiredSectLevel: 5,
    sourceTier: 5,
    dailyAttemptsPerMember: 1,
    weeklyAttemptsPerSect: 5,
    contributionCost: 200,
    recommendedRealmOrder: 5,
    recommendedPower: 2500,
    firstClearReward: { linhThach: 1500, tienNgoc: 3, exp: 3000 },
    repeatRewardProfile: { linhThach: 400, exp: 800 },
    dropProfileKey: 'sect_dungeon_cam_dia_tier_5',
    enabled: false,
  },
];

export const SECT_BOSSES: readonly SectBossDef[] = [
  // GUARDIAN — daily training
  {
    key: 'sect_boss_thu_ho_linh_mach',
    nameVi: 'Thủ Hộ Linh Mạch',
    nameEn: 'Spirit-Vein Guardian',
    titleVi: 'Boss luyện tập ngày',
    titleEn: 'Daily Training Boss',
    descriptionVi:
      'Linh thể trấn giữ linh mạch tông môn. Đệ tử luyện tập đánh hằng ngày.',
    descriptionEn:
      'Spirit entity guarding the sect spirit-vein. Disciples train against it daily.',
    category: 'GUARDIAN',
    family: 'LINH_THE',
    requiredSectLevel: 1,
    sourceTier: 1,
    bossTier: 1,
    recommendedRealmOrder: 1,
    recommendedPower: 150,
    hpScalingBySectLevel: { baseHp: 1000, hpPerLevel: 500 },
    dailyAttemptsPerMember: 1,
    weeklyAttemptsPerSect: 50,
    firstKillReward: { linhThach: 150, exp: 300 },
    contributionReward: 20,
    dropProfileKey: 'sect_boss_guardian_tier_1',
    enabled: true,
  },
  // INVADER — sự kiện giờ/tuần
  {
    key: 'sect_boss_yeu_vuong_xam_nhap',
    nameVi: 'Yêu Vương Xâm Nhập',
    nameEn: 'Yao King Invasion',
    titleVi: 'Boss sự kiện giờ/tuần',
    titleEn: 'Hourly/Weekly Event Boss',
    descriptionVi:
      'Yêu vương đột nhập tông môn — toàn sect cùng đánh, có ranking damage.',
    descriptionEn:
      'A yao king invades the sect — the whole sect fights together, with damage ranking.',
    category: 'INVADER',
    family: 'YEU_THU',
    requiredSectLevel: 2,
    sourceTier: 3,
    bossTier: 3,
    recommendedRealmOrder: 3,
    recommendedPower: 1200,
    schedule: {
      hoursOfDay: [20],
      daysOfWeek: [2, 5],
      activeMinutes: 60,
    },
    hpScalingBySectLevel: { baseHp: 50000, hpPerLevel: 10000 },
    dailyAttemptsPerMember: 0,
    weeklyAttemptsPerSect: 2,
    firstKillReward: { linhThach: 500, tienNgoc: 1, exp: 1000 },
    contributionReward: 100,
    sectBuffRewardKey: 'sect_buff_yeu_king_kill',
    sectBuffDurationHours: 24,
    rankingRewardProfile: {
      top1: { linhThach: 800, tienNgoc: 5, exp: 1600 },
      top3: { linhThach: 400, tienNgoc: 2, exp: 800 },
      participation: { linhThach: 100, exp: 200 },
    },
    dropProfileKey: 'sect_boss_invader_tier_3',
    enabled: true,
  },
  // TRIAL — theo cấp tông môn
  {
    key: 'sect_boss_thi_luyen',
    nameVi: 'Tông Môn Thí Luyện Boss',
    nameEn: 'Sect Trial Boss',
    titleVi: 'Boss thí luyện theo cấp tông môn',
    titleEn: 'Sect Trial Boss (scales with sect level)',
    descriptionVi:
      'Boss thí luyện cho đệ tử tông môn — HP/damage scale theo cấp tông môn.',
    descriptionEn:
      'A trial boss for sect disciples — HP/damage scales with sect level.',
    category: 'TRIAL',
    family: 'KHOI_LOI',
    requiredSectLevel: 2,
    sourceTier: 2,
    bossTier: 2,
    recommendedRealmOrder: 2,
    recommendedPower: 600,
    hpScalingBySectLevel: { baseHp: 5000, hpPerLevel: 2000 },
    dailyAttemptsPerMember: 1,
    weeklyAttemptsPerSect: 30,
    firstKillReward: { linhThach: 300, exp: 600 },
    contributionReward: 50,
    dropProfileKey: 'sect_boss_trial_tier_2',
    enabled: true,
  },
  // QUEST — gắn nhiệm vụ tuần
  {
    key: 'sect_boss_nhiem_vu_tuan',
    nameVi: 'Boss Nhiệm Vụ Tông Môn (tuần)',
    nameEn: 'Sect Weekly Quest Boss',
    titleVi: 'Boss nhiệm vụ tuần',
    titleEn: 'Weekly Quest Boss',
    descriptionVi:
      'Boss gắn nhiệm vụ tông môn tuần — clear để hoàn thành mission tuần.',
    descriptionEn:
      'Boss tied to sect weekly quest — clear to complete weekly mission.',
    category: 'QUEST',
    family: 'TA_TU',
    requiredSectLevel: 1,
    sourceTier: 2,
    bossTier: 2,
    recommendedRealmOrder: 2,
    recommendedPower: 500,
    hpScalingBySectLevel: { baseHp: 8000, hpPerLevel: 2000 },
    dailyAttemptsPerMember: 0,
    weeklyAttemptsPerSect: 7,
    firstKillReward: { linhThach: 200, exp: 400 },
    contributionReward: 40,
    dropProfileKey: 'sect_boss_quest_tier_2',
    enabled: true,
  },
];
