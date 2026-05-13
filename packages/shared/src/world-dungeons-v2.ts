/**
 * Phase 26.5 — World Dungeon V2 catalog.
 *
 * **Mở rộng song song** combat.ts `DUNGEONS` cũ + `story-dungeons.ts`. Không
 * thay thế, không sửa: V1 dùng cho `DungeonRunService` legacy + story chain
 * (`StoryDungeonRun`); V2 thêm layer phân loại theo `DungeonCategory` để
 * người chơi farm nguyên liệu chuyên biệt (luyện đan / luyện thể / công
 * pháp / pháp bảo / trang bị / vượt kiếp / story / side / sect / event /
 * tower / general).
 *
 * Reward repeat cap, first-clear unique, anti-P2W invariants được enforce
 * server-side qua `DailyContentCap` / `WeeklyContentCap` (xem Prisma
 * migration trong cụm 6).
 *
 * Pure catalog + helper — KHÔNG Prisma. Service `DungeonV2Service` runtime
 * sẽ reuse `DungeonRun` Prisma model (Phase 12.2.B) cho expedition execution
 * thực tế và bổ sung `dungeonV2Key` field qua additive migration.
 */
import type { DungeonRunReward } from './combat';
import type { RegionKey } from './map-regions';

// ───────────────────────────────────────────────────────────────────────────
// DungeonCategory
// ───────────────────────────────────────────────────────────────────────────

export type DungeonCategory =
  | 'ALCHEMY_MATERIAL'
  | 'BODY_MATERIAL'
  | 'METHOD_FRAGMENT'
  | 'ARTIFACT_MATERIAL'
  | 'EQUIPMENT_MATERIAL'
  | 'QI_BREAKTHROUGH'
  | 'BODY_BREAKTHROUGH'
  | 'TRIBULATION'
  | 'STORY'
  | 'SIDE_QUEST'
  | 'SECT'
  | 'EVENT'
  | 'TOWER'
  | 'GENERAL';

export const DUNGEON_CATEGORIES: readonly DungeonCategory[] = [
  'ALCHEMY_MATERIAL',
  'BODY_MATERIAL',
  'METHOD_FRAGMENT',
  'ARTIFACT_MATERIAL',
  'EQUIPMENT_MATERIAL',
  'QI_BREAKTHROUGH',
  'BODY_BREAKTHROUGH',
  'TRIBULATION',
  'STORY',
  'SIDE_QUEST',
  'SECT',
  'EVENT',
  'TOWER',
  'GENERAL',
] as const;

// ───────────────────────────────────────────────────────────────────────────
// DungeonV2Def
// ───────────────────────────────────────────────────────────────────────────

export interface DungeonV2Def {
  key: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  loreVi?: string;
  loreEn?: string;
  category: DungeonCategory;
  regionKey: RegionKey;
  bookKey?: string | null;
  chapterKey?: string | null;
  /** sourceTier cố định cho instance này (1..9). */
  sourceTier: number;
  /** dungeonTier — chia mức khó trong cùng sourceTier (1..5). */
  dungeonTier: number;
  /** Realm order tối thiểu để mở khoá. */
  unlockRealmOrder: number;
  /** Quest required (optional). */
  unlockQuestKey?: string | null;
  /** Power point khuyến nghị (UI hint). */
  recommendedPower: number;
  /** Số lượt clear / ngày. */
  dailyAttempts: number;
  /** Optional weekly cap (rare event dungeon). */
  weeklyAttempts?: number | null;
  /** Sweep allowed (instant clear). */
  sweepAllowed: boolean;
  /** Reward chỉ nhận 1 lần khi clear lần đầu. */
  firstClearReward?: DungeonRunReward | null;
  /** Reward repeat — chia theo `dailyAttempts`. */
  repeatRewardProfile: DungeonRunReward;
  /** Boss key (optional, reference `world-bosses-v2`). */
  bossKey?: string | null;
  /** Pool monster keys (reference `MONSTERS`). */
  monsterPool: readonly string[];
  /** Drop profile resolver key. */
  dropProfileKey: string;
  /** UI source hint (label). */
  sourceHintVi: string;
  sourceHintEn: string;
  enabled: boolean;
}

export function getDungeonV2ByKey(key: string): DungeonV2Def | undefined {
  return DUNGEONS_V2.find((d) => d.key === key);
}

export function getDungeonsV2ByRegion(region: RegionKey): readonly DungeonV2Def[] {
  return DUNGEONS_V2.filter((d) => d.regionKey === region);
}

export function getDungeonsV2ByCategory(
  category: DungeonCategory,
): readonly DungeonV2Def[] {
  return DUNGEONS_V2.filter((d) => d.category === category);
}

/**
 * Validate gating cho dungeon V2.
 */
export function canEnterDungeonV2(
  dungeon: DungeonV2Def,
  args: {
    playerRealmOrder: number;
    clearedQuestKeys?: readonly string[];
  },
): {
  allowed: boolean;
  reason?: 'REALM_TOO_LOW' | 'QUEST_REQUIRED' | 'DISABLED';
} {
  if (!dungeon.enabled) return { allowed: false, reason: 'DISABLED' };
  if (args.playerRealmOrder < dungeon.unlockRealmOrder) {
    return { allowed: false, reason: 'REALM_TOO_LOW' };
  }
  if (dungeon.unlockQuestKey) {
    const cleared = args.clearedQuestKeys ?? [];
    if (!cleared.includes(dungeon.unlockQuestKey)) {
      return { allowed: false, reason: 'QUEST_REQUIRED' };
    }
  }
  return { allowed: true };
}

// ───────────────────────────────────────────────────────────────────────────
// Seed — bao phủ đủ 7 nhóm bí cảnh theo spec (Phần 7)
// ═══════════════════════════════════════════════════════════════════════════

export const DUNGEONS_V2: readonly DungeonV2Def[] = [
  // ─── 1. Bí cảnh luyện đan (ALCHEMY_MATERIAL) ────────────────────────────
  {
    key: 'son_coc_duoc_vien',
    nameVi: 'Sơn Cốc — Dược Viên Bí Cảnh',
    nameEn: 'Mountain Valley — Herb Garden Secret',
    descriptionVi:
      'Vườn linh thảo cổ ẩn trong sơn cốc — linh thảo cấp 1-2, đan sa thô, mảnh công thức luyện đan sơ.',
    descriptionEn:
      'An ancient herb garden hidden in the mountain valley — tier-1/2 spirit herbs, raw alchemical sand, basic recipe shards.',
    category: 'ALCHEMY_MATERIAL',
    regionKey: 'son_coc',
    sourceTier: 1,
    dungeonTier: 1,
    unlockRealmOrder: 1,
    recommendedPower: 50,
    dailyAttempts: 3,
    sweepAllowed: true,
    firstClearReward: { linhThach: 80, exp: 150, items: [{ itemKey: 'linh_thao', qty: 3 }] },
    repeatRewardProfile: { linhThach: 20, exp: 50, items: [{ itemKey: 'linh_thao', qty: 1 }] },
    monsterPool: ['son_thu_lon', 'da_quan'],
    dropProfileKey: 'dungeon_alchemy_tier_1',
    sourceHintVi: 'Linh thảo cấp 1-2, đan sa, mảnh công thức luyện đan.',
    sourceHintEn: 'Tier-1/2 spirit herbs, alchemical sand, recipe shards.',
    enabled: true,
  },
  {
    key: 'hac_lam_duoc_uyen',
    nameVi: 'Hắc Lâm — Dược Uyên Âm Mộc',
    nameEn: 'Black Forest — Yin-Wood Herb Pool',
    descriptionVi:
      'Hồ nước âm hệ giữa rừng đen — linh thảo tier 2, đan sa âm, mảnh công thức đan sơ trung.',
    descriptionEn:
      'A yin-element pool deep in the black forest — tier-2 spirit herbs, yin alchemical sand, mid-tier recipe shards.',
    category: 'ALCHEMY_MATERIAL',
    regionKey: 'hac_lam',
    sourceTier: 2,
    dungeonTier: 1,
    unlockRealmOrder: 2,
    recommendedPower: 120,
    dailyAttempts: 3,
    sweepAllowed: true,
    firstClearReward: { linhThach: 150, exp: 280, items: [{ itemKey: 'linh_thao', qty: 5 }] },
    repeatRewardProfile: { linhThach: 40, exp: 80 },
    monsterPool: ['hac_yeu_xa', 'thi_quy'],
    dropProfileKey: 'dungeon_alchemy_tier_2',
    sourceHintVi: 'Linh thảo âm hệ tier 2, đan sa âm, đan tinh cổ.',
    sourceHintEn: 'Yin-element herbs tier 2, yin alchemical sand, ancient pill essence.',
    enabled: true,
  },

  // ─── 2. Bí cảnh luyện thể (BODY_MATERIAL) ───────────────────────────────
  {
    key: 'son_coc_huyet_tri',
    nameVi: 'Sơn Cốc — Huyết Trì Luyện Thể',
    nameEn: 'Mountain Valley — Blood-Pool Body Forge',
    descriptionVi:
      'Hồ huyết sơ tu sĩ luyện thể — huyết tinh tier 1, da thú, đoán cốt thạch sơ.',
    descriptionEn:
      'A blood pool for beginning body-cultivation — tier-1 blood essence, beast hides, basic bone-forging stones.',
    category: 'BODY_MATERIAL',
    regionKey: 'son_coc',
    sourceTier: 1,
    dungeonTier: 1,
    unlockRealmOrder: 1,
    recommendedPower: 60,
    dailyAttempts: 3,
    sweepAllowed: true,
    firstClearReward: { linhThach: 80, exp: 150, items: [{ itemKey: 'huyet_chi_dan', qty: 1 }] },
    repeatRewardProfile: { linhThach: 20, exp: 50 },
    monsterPool: ['son_thu_lon', 'huyet_lang'],
    dropProfileKey: 'dungeon_body_tier_1',
    sourceHintVi: 'Huyết tinh tier 1, da thú, đoán cốt thạch sơ.',
    sourceHintEn: 'Tier-1 blood essence, beast hides, basic bone-forging stones.',
    enabled: true,
  },
  {
    key: 'kim_son_huyet_tri',
    nameVi: 'Kim Sơn Mạch — Huyết Trì Luyện Thể',
    nameEn: 'Golden Mountain Vein — Blood-Pool Body Forge',
    descriptionVi:
      'Hồ huyết luyện thể kim đan — huyết tinh tier 3, đoán cốt thạch tinh, tẩy tủy dịch sơ.',
    descriptionEn:
      'A Golden-Core body-cultivation pool — tier-3 blood essence, refined bone-forging stones, marrow-cleansing fluid.',
    category: 'BODY_MATERIAL',
    regionKey: 'kim_son_mach',
    sourceTier: 3,
    dungeonTier: 1,
    unlockRealmOrder: 3,
    recommendedPower: 400,
    dailyAttempts: 2,
    sweepAllowed: true,
    firstClearReward: { linhThach: 280, exp: 600, items: [{ itemKey: 'huyet_tinh', qty: 3 }] },
    repeatRewardProfile: { linhThach: 80, exp: 200 },
    monsterPool: ['kim_quang_thach_giap', 'huyen_kim_lang_thu'],
    dropProfileKey: 'dungeon_body_tier_3',
    sourceHintVi: 'Huyết tinh tier 3, đoán cốt thạch tinh, tẩy tủy dịch.',
    sourceHintEn: 'Tier-3 blood essence, refined bone-forging stones, marrow-cleansing fluid.',
    enabled: true,
  },

  // ─── 3. Bí cảnh công pháp (METHOD_FRAGMENT) ─────────────────────────────
  {
    key: 'hac_lam_tang_kinh_tan_dien',
    nameVi: 'Hắc Lâm — Tàng Kinh Tàn Điện',
    nameEn: 'Black Forest — Method-Scripture Ruins',
    descriptionVi:
      'Điện cổ chứa kinh thư tàn quyển — mảnh công pháp tier 2, điểm lĩnh ngộ, tàn quyển cổ.',
    descriptionEn:
      'Ancient ruins housing tattered scriptures — tier-2 method fragments, comprehension points, ancient torn scrolls.',
    category: 'METHOD_FRAGMENT',
    regionKey: 'hac_lam',
    sourceTier: 2,
    dungeonTier: 2,
    unlockRealmOrder: 2,
    recommendedPower: 150,
    dailyAttempts: 2,
    sweepAllowed: true,
    firstClearReward: { linhThach: 180, exp: 320 },
    repeatRewardProfile: { linhThach: 50, exp: 100 },
    monsterPool: ['hac_lam_ma', 'thi_quy'],
    dropProfileKey: 'dungeon_method_tier_2',
    sourceHintVi: 'Mảnh công pháp tier 2, điểm lĩnh ngộ, tàn quyển.',
    sourceHintEn: 'Tier-2 method fragments, comprehension points, torn scrolls.',
    enabled: true,
  },
  {
    key: 'kim_son_kiem_kinh_dong',
    nameVi: 'Kim Sơn Mạch — Kiếm Kinh Cổ Động',
    nameEn: 'Golden Mountain Vein — Sword-Method Cave',
    descriptionVi:
      'Hang cổ kiếm tu — mảnh công pháp kiếm tier 3, kiếm phách, điểm ngộ tính kiếm.',
    descriptionEn:
      'An ancient sword-cultivator cave — tier-3 sword-method fragments, sword souls, sword-affinity insight points.',
    category: 'METHOD_FRAGMENT',
    regionKey: 'kim_son_mach',
    sourceTier: 3,
    dungeonTier: 2,
    unlockRealmOrder: 3,
    recommendedPower: 450,
    dailyAttempts: 2,
    sweepAllowed: true,
    firstClearReward: { linhThach: 320, exp: 700 },
    repeatRewardProfile: { linhThach: 90, exp: 220 },
    monsterPool: ['tinh_thiet_kiem_linh', 'kim_dieu_thuong_phong'],
    dropProfileKey: 'dungeon_method_tier_3',
    sourceHintVi: 'Mảnh công pháp kiếm tier 3, kiếm phách, điểm ngộ tính.',
    sourceHintEn: 'Tier-3 sword-method fragments, sword souls, insight points.',
    enabled: true,
  },

  // ─── 4. Bí cảnh pháp bảo (ARTIFACT_MATERIAL) ────────────────────────────
  {
    key: 'kim_son_luyen_khi_phong',
    nameVi: 'Kim Sơn Mạch — Luyện Khí Phòng',
    nameEn: 'Golden Mountain Vein — Artifact Forge Chamber',
    descriptionVi:
      'Lò luyện khí cổ — phôi pháp bảo tier 3, bản vẽ pháp bảo, refine stone trung phẩm.',
    descriptionEn:
      'An ancient artifact forge — tier-3 artifact blanks, artifact blueprints, mid-grade refine stones.',
    category: 'ARTIFACT_MATERIAL',
    regionKey: 'kim_son_mach',
    sourceTier: 3,
    dungeonTier: 2,
    unlockRealmOrder: 3,
    recommendedPower: 480,
    dailyAttempts: 2,
    sweepAllowed: true,
    firstClearReward: { linhThach: 400, exp: 800 },
    repeatRewardProfile: { linhThach: 100, exp: 250 },
    monsterPool: ['kim_quang_thach_giap', 'tinh_thiet_kiem_linh'],
    dropProfileKey: 'dungeon_artifact_tier_3',
    sourceHintVi: 'Phôi pháp bảo tier 3, bản vẽ, refine stone, ngũ hành tinh hoa.',
    sourceHintEn: 'Tier-3 artifact blanks, blueprints, refine stones, five-element essence.',
    enabled: true,
  },

  // ─── 5. Bí cảnh trang bị (EQUIPMENT_MATERIAL) ───────────────────────────
  {
    key: 'son_coc_quang_mach',
    nameVi: 'Sơn Cốc — Quặng Mạch Sơ',
    nameEn: 'Mountain Valley — Basic Ore Vein',
    descriptionVi:
      'Mạch quặng sơ cấp — tinh thiết tier 1, đá khoáng, da thú, mảnh trang bị.',
    descriptionEn:
      'A basic ore vein — tier-1 spirit-iron, ore stones, beast hides, equipment shards.',
    category: 'EQUIPMENT_MATERIAL',
    regionKey: 'son_coc',
    sourceTier: 1,
    dungeonTier: 1,
    unlockRealmOrder: 1,
    recommendedPower: 50,
    dailyAttempts: 3,
    sweepAllowed: true,
    firstClearReward: { linhThach: 60, exp: 120 },
    repeatRewardProfile: { linhThach: 15, exp: 40 },
    monsterPool: ['da_quan', 'son_thu_lon'],
    dropProfileKey: 'dungeon_equipment_tier_1',
    sourceHintVi: 'Tinh thiết tier 1, đá khoáng, da thú, mảnh trang bị.',
    sourceHintEn: 'Tier-1 spirit-iron, ore stones, beast hides, equipment shards.',
    enabled: true,
  },

  // ─── 6. Bí cảnh nhiệm vụ (STORY / SIDE_QUEST) ───────────────────────────
  {
    key: 'son_coc_co_thuat_su',
    nameVi: 'Sơn Cốc — Cổ Thuật Sư Di Tích',
    nameEn: 'Mountain Valley — Ancient Mage Ruins',
    descriptionVi:
      'Di tích cổ thuật sư — nhiệm vụ phụ thân thiện NPC, tàn vật cổ, nguyên liệu đặc thù.',
    descriptionEn:
      'An ancient mage ruin — side-quest NPC affinity, ancient relics, special materials.',
    category: 'SIDE_QUEST',
    regionKey: 'son_coc',
    sourceTier: 1,
    dungeonTier: 1,
    unlockRealmOrder: 1,
    recommendedPower: 70,
    dailyAttempts: 1,
    weeklyAttempts: 3,
    sweepAllowed: false,
    firstClearReward: { linhThach: 200, exp: 400, items: [{ itemKey: 'linh_thao', qty: 2 }] },
    repeatRewardProfile: { linhThach: 30, exp: 60 },
    monsterPool: ['son_thu_lon', 'da_quan', 'huyet_lang'],
    dropProfileKey: 'dungeon_side_quest_tier_1',
    sourceHintVi: 'Tàn vật cổ, mảnh công thức, nguyên liệu đặc thù.',
    sourceHintEn: 'Ancient relics, recipe shards, special materials.',
    enabled: true,
  },

  // ─── 7. Bí cảnh vượt kiếp (TRIBULATION) — sourceTier cao, attempt thấp ──
  {
    key: 'cuu_la_thien_kiep_dia',
    nameVi: 'Cửu La Điện — Thiên Kiếp Trận Địa',
    nameEn: 'Nine-Net Hall — Tribulation Array Field',
    descriptionVi:
      'Trận địa thiên kiếp — nguyên liệu vượt kiếp tier 5, lôi tinh, kim đan tribulation pill.',
    descriptionEn:
      'A tribulation array field — tier-5 tribulation materials, lightning essence, tribulation pills.',
    category: 'TRIBULATION',
    regionKey: 'cuu_la_dien',
    sourceTier: 5,
    dungeonTier: 3,
    unlockRealmOrder: 5,
    recommendedPower: 4000,
    dailyAttempts: 1,
    weeklyAttempts: 3,
    sweepAllowed: false,
    firstClearReward: { linhThach: 1500, tienNgoc: 3, exp: 3000 },
    repeatRewardProfile: { linhThach: 300, exp: 600 },
    monsterPool: [],
    dropProfileKey: 'dungeon_tribulation_tier_5',
    sourceHintVi: 'Nguyên liệu vượt kiếp, lôi tinh, tribulation pill.',
    sourceHintEn: 'Tribulation materials, lightning essence, tribulation pills.',
    enabled: false,
  },
];
