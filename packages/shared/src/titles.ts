/**
 * Title (Danh hiệu) catalog foundation — Phase 11.9.A
 *
 * Pure data + deterministic helpers. KHÔNG runtime/schema/migration.
 *
 * Design intent (P11-9):
 * - Static catalog cho TitleDef cosmetic (đã có `Character.title` String? trong
 *   Prisma từ phase 0). Catalog này chỉ định nghĩa key + metadata; runtime
 *   chưa enforce ownership ở phase này.
 * - Source variety: realm milestone (mỗi major realm), achievement, sect rank,
 *   event seasonal, donation tier.
 * - Rarity: common / rare / epic / legendary / mythic — match tier với power
 *   curve trong `BALANCE_MODEL.md` §3 (cosmetic không có stat reward — phase
 *   11.9.B sẽ optional thêm tiny stat bonus per rarity).
 * - Element coverage cho Ngũ Hành milestone (kim/moc/thuy/hoa/tho) + neutral
 *   cho realm/achievement/event.
 * - Phase 11.9.B runtime sẽ thêm Prisma `CharacterTitleUnlock { id, characterId,
 *   titleKey, unlockedAt, source }` + service `unlockTitle` (idempotent on
 *   key+characterId) + `equipTitle(titleKey)` (validate ownership) + `getOwnedTitles`
 *   + auto-grant trên realm breakthrough event + achievement complete event.
 *
 * Convention:
 * - `key`: stable string immutable (vd `realm_kim_dan_milestone`).
 * - `nameVi`/`nameEn`: i18n cosmetic display (vd "Kim Đan Chân Tu" / "Golden
 *   Core Adept").
 * - `unlockCondition`: schema kind discriminator cho Phase 11.9.B service
 *   match auto-grant logic.
 * - `rarity`: 5-tier — common (50%+), rare (25%), epic (15%), legendary (8%),
 *   mythic (2%) baseline catalog spread.
 *
 * Curve (24 title baseline):
 * - 9 realm milestone (luyenkhi → hu_khong_chi_ton spread).
 * - 5 element devotion (kim/moc/thuy/hoa/tho mastery).
 * - 4 achievement (first kill / first dungeon / first boss / first breakthrough).
 * - 3 sect rank (initiate / inner / elder).
 * - 2 event seasonal (placeholder).
 * - 1 donation tier (placeholder).
 */

import type { ElementKey } from './combat';

export type TitleRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

/**
 * Source / unlock condition kind cho Phase 11.9.B auto-grant matching.
 *
 * - `realm_milestone`: unlock khi Character.realmKey reach `unlockRealmKey`.
 * - `element_mastery`: unlock khi composeBuffMods damage_bonus[element] ≥
 *    threshold OR equipping ≥3 element-themed item (Phase 11.9.B logic).
 * - `achievement`: unlock khi specific achievement complete (Phase 11.10).
 * - `sect_rank`: unlock khi sect role match (`initiate`/`inner`/`elder`).
 * - `sect_season`: unlock khi season milestone claim grant title (Phase 13.2.B).
 * - `event`: unlock khi event participation match (Phase 15+).
 * - `donation`: unlock khi cumulative topup tier match (Phase 16+).
 */
export type TitleSource =
  | 'realm_milestone'
  | 'element_mastery'
  | 'achievement'
  | 'sect_rank'
  | 'sect_season'
  | 'event'
  | 'donation';

export interface TitleDef {
  readonly key: string;
  readonly nameVi: string;
  readonly nameEn: string;
  readonly description: string;
  readonly rarity: TitleRarity;
  readonly source: TitleSource;
  /** Element của title (null = neutral). */
  readonly element: ElementKey | null;
  /** Realm key trigger cho `realm_milestone` (null cho source khác). */
  readonly unlockRealmKey: string | null;
  /** Achievement key trigger cho `achievement` source (null khác). */
  readonly unlockAchievementKey: string | null;
  /** Sect role trigger cho `sect_rank` source (null khác). */
  readonly unlockSectRole: string | null;
  /**
   * Optional flavor stat bonus (Phase 11.9.B sẽ apply qua composeTitleMods).
   * Hiện tại catalog-only metadata.
   */
  readonly flavorStatBonus: TitleStatBonus | null;
}

/**
 * Optional cosmetic stat bonus per title (Phase 11.9.B áp).
 * Cap design: rare ≤ +2%, epic ≤ +5%, legendary ≤ +10%, mythic ≤ +15%.
 */
export interface TitleStatBonus {
  readonly statTarget: 'atk' | 'def' | 'hpMax' | 'mpMax' | 'spirit';
  /** Multiplier (1.05 = +5%). */
  readonly value: number;
}

/**
 * 24 title baseline cover: realm milestone + element mastery + achievement +
 * sect rank + event + donation.
 *
 * Stable order: realm tier ascending, sau đó element, sau đó misc.
 */
export const TITLES: readonly TitleDef[] = [
  // ===== REALM MILESTONE — 9 =====
  {
    key: 'realm_luyenkhi_initiate',
    nameVi: 'Luyện Khí Tân Đồ',
    nameEn: 'Qi Refining Initiate',
    description: 'Bước chân đầu tiên trên con đường tu tiên.',
    rarity: 'common',
    source: 'realm_milestone',
    element: null,
    unlockRealmKey: 'luyenkhi',
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: null,
  },
  {
    key: 'realm_truc_co_pillar',
    nameVi: 'Trúc Cơ Trụ Đạo',
    nameEn: 'Foundation Pillar',
    description: 'Trụ căn cơ vững chắc, đường tu tiên rộng mở.',
    rarity: 'common',
    source: 'realm_milestone',
    element: null,
    unlockRealmKey: 'truc_co',
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: null,
  },
  {
    key: 'realm_kim_dan_adept',
    nameVi: 'Kim Đan Chân Tu',
    nameEn: 'Golden Core Adept',
    description: 'Kim đan ngưng tụ, danh vọng vang dội tiểu thiên thế giới.',
    rarity: 'rare',
    source: 'realm_milestone',
    element: null,
    unlockRealmKey: 'kim_dan',
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.02 },
  },
  {
    key: 'realm_nguyen_anh_master',
    nameVi: 'Nguyên Anh Chân Quân',
    nameEn: 'Nascent Soul Lord',
    description: 'Nguyên anh xuất khiếu, một niệm đoạt thiên cơ.',
    rarity: 'rare',
    source: 'realm_milestone',
    element: null,
    unlockRealmKey: 'nguyen_anh',
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.02 },
  },
  {
    key: 'realm_hoa_than_sage',
    nameVi: 'Hoá Thần Đại Sư',
    nameEn: 'Spirit Transformation Sage',
    description: 'Hoá thân thần thông, vạn vật quy nhất.',
    rarity: 'epic',
    source: 'realm_milestone',
    element: null,
    unlockRealmKey: 'hoa_than',
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.04 },
  },
  {
    key: 'realm_do_kiep_tribulant',
    nameVi: 'Độ Kiếp Khôi Lâm',
    nameEn: 'Tribulation Survivor',
    description: 'Một thân vượt thiên kiếp, danh chấn thiên hạ.',
    rarity: 'epic',
    source: 'realm_milestone',
    element: null,
    unlockRealmKey: 'do_kiep',
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'def', value: 1.04 },
  },
  {
    key: 'realm_thien_tien_celestial',
    nameVi: 'Thiên Tiên Chân Nhân',
    nameEn: 'Celestial Immortal',
    description: 'Bay khỏi tam giới ngoài, tự xưng tiên nhân.',
    rarity: 'legendary',
    source: 'realm_milestone',
    element: null,
    unlockRealmKey: 'thien_tien',
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.07 },
  },
  {
    key: 'realm_thanh_nhan_sage',
    nameVi: 'Thánh Nhân Vô Cảnh',
    nameEn: 'Sage Without Bounds',
    description: 'Vượt qua nhân tiên hạn cảnh, đứng ngang hàng đại đạo.',
    rarity: 'legendary',
    source: 'realm_milestone',
    element: null,
    unlockRealmKey: 'thanh_nhan',
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.08 },
  },
  {
    key: 'realm_hu_khong_chi_ton',
    nameVi: 'Hư Không Chí Tôn',
    nameEn: 'Sovereign of the Void',
    description: 'Đỉnh phong tu tiên giới — nắm vận mệnh vô tận thiên hà.',
    rarity: 'mythic',
    source: 'realm_milestone',
    element: null,
    unlockRealmKey: 'hu_khong_chi_ton',
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.12 },
  },

  // ===== ELEMENT MASTERY — 5 =====
  {
    key: 'element_kim_blade_master',
    nameVi: 'Kim Quang Kiếm Tổ',
    nameEn: 'Golden Blade Master',
    description: 'Tinh thông kim hệ kiếm pháp, khí thế sắc bén thiên hạ.',
    rarity: 'epic',
    source: 'element_mastery',
    element: 'kim',
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.05 },
  },
  {
    key: 'element_moc_forest_lord',
    nameVi: 'Mộc Linh Sâm Quân',
    nameEn: 'Forest Lord of Wood',
    description: 'Mộc khí thấm nhuận vạn vật, sinh cơ vô tận.',
    rarity: 'epic',
    source: 'element_mastery',
    element: 'moc',
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'hpMax', value: 1.05 },
  },
  {
    key: 'element_thuy_ocean_sovereign',
    nameVi: 'Thuỷ Vực Chí Tôn',
    nameEn: 'Sovereign of the Deep',
    description: 'Thuỷ pháp tinh thâm, thao túng vạn dòng nước.',
    rarity: 'epic',
    source: 'element_mastery',
    element: 'thuy',
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'mpMax', value: 1.05 },
  },
  {
    key: 'element_hoa_phoenix_flame',
    nameVi: 'Hoả Diễm Phượng Hoàng',
    nameEn: 'Phoenix of the Eternal Flame',
    description: 'Hoả khí thiêu đốt vạn vật, một niệm hoá tro tàn.',
    rarity: 'epic',
    source: 'element_mastery',
    element: 'hoa',
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.05 },
  },
  {
    key: 'element_tho_earth_tyrant',
    nameVi: 'Thổ Địa Bá Vương',
    nameEn: 'Earth Tyrant',
    description: 'Thổ khí ổn trọng như sơn, công thủ kiêm bị.',
    rarity: 'epic',
    source: 'element_mastery',
    element: 'tho',
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'def', value: 1.05 },
  },

  // ===== ACHIEVEMENT — 4 =====
  {
    key: 'achievement_first_kill',
    nameVi: 'Sơ Sát',
    nameEn: 'First Blood',
    description: 'Lần đầu chính thức ra tay sát địch.',
    rarity: 'common',
    source: 'achievement',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: 'first_monster_kill',
    unlockSectRole: null,
    flavorStatBonus: null,
  },
  {
    key: 'achievement_first_dungeon',
    nameVi: 'Sơ Đăng Bí Cảnh',
    nameEn: 'First Dungeon Clear',
    description: 'Bước chân đầu tiên vào bí cảnh, mở mang nhãn giới.',
    rarity: 'common',
    source: 'achievement',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: 'first_dungeon_clear',
    unlockSectRole: null,
    flavorStatBonus: null,
  },
  {
    key: 'achievement_first_boss',
    nameVi: 'Đồ Lục Yêu Vương',
    nameEn: 'Boss Slayer',
    description: 'Đầu tiên đánh hạ một yêu vương — danh chấn tiểu thế giới.',
    rarity: 'rare',
    source: 'achievement',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: 'first_boss_kill',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.02 },
  },
  {
    key: 'achievement_first_breakthrough',
    nameVi: 'Đột Phá Nhất Trọng',
    nameEn: 'First Breakthrough',
    description: 'Lần đầu vượt qua bình cảnh, lên trọng kế tiếp.',
    rarity: 'common',
    source: 'achievement',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: 'first_breakthrough',
    unlockSectRole: null,
    flavorStatBonus: null,
  },

  // ===== SECT RANK — 3 =====
  {
    key: 'sect_initiate',
    nameVi: 'Tông Môn Đệ Tử',
    nameEn: 'Sect Initiate',
    description: 'Đệ tử mới gia nhập tông môn, tu hành sơ cấp.',
    rarity: 'common',
    source: 'sect_rank',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: 'initiate',
    flavorStatBonus: null,
  },
  {
    key: 'sect_inner_disciple',
    nameVi: 'Tông Môn Nội Đệ Tử',
    nameEn: 'Inner Sect Disciple',
    description: 'Đệ tử tinh anh được tông môn ưu ái cấp pháp.',
    rarity: 'rare',
    source: 'sect_rank',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: 'inner',
    flavorStatBonus: { statTarget: 'spirit', value: 1.02 },
  },
  {
    key: 'sect_elder',
    nameVi: 'Tông Môn Trưởng Lão',
    nameEn: 'Sect Elder',
    description: 'Trưởng lão kỳ cựu — chấp chưởng quyền trượng tông môn.',
    rarity: 'epic',
    source: 'sect_rank',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: 'elder',
    flavorStatBonus: { statTarget: 'atk', value: 1.04 },
  },

  // ===== EVENT — 2 (placeholder Phase 15+) =====
  {
    key: 'event_lunar_new_year_2026',
    nameVi: 'Thiên Lễ Tế Đăng',
    nameEn: 'Heavenly Lantern Bearer',
    description: 'Tham gia lễ hội Thiên Lễ Tế Đăng đầu năm — danh hiệu mùa.',
    rarity: 'rare',
    source: 'event',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: null,
  },
  {
    key: 'event_dragon_boat_2026',
    nameVi: 'Long Chu Đoạt Quán',
    nameEn: 'Dragon Boat Champion',
    description: 'Chiến thắng giải Long Chu — danh hiệu mùa.',
    rarity: 'rare',
    source: 'event',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: null,
  },
  // Phase 13.0 §C — Huyết Nguyệt weekly boss event participation reward.
  // Unlock cho character damage Cuu La Thien De trong Saturday 21:00 slot
  // (event_huyet_nguyet_weekend). Wire qua BossService.distributeRewards
  // hook — nếu spawnedAt/regionKey/bossKey match LiveOpsEventDef, mọi
  // participant (mọi BossDamage row) nhận title (idempotent).
  {
    key: 'event_huyet_nguyet_2026',
    nameVi: 'Huyết Nguyệt Quân',
    nameEn: 'Blood Moon Warrior',
    description: 'Tham gia tuần sự kiện Huyết Nguyệt — đối đầu Cửu La Thiên Đế dưới ánh trăng máu.',
    rarity: 'epic',
    source: 'event',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.03 },
  },

  // ===== DONATION — 1 (placeholder Phase 16+) =====
  {
    key: 'donation_tier_phoenix',
    nameVi: 'Phụng Hoàng Hộ Pháp',
    nameEn: 'Phoenix Patron',
    description: 'Hộ trì tông môn cấp Phụng Hoàng — danh hiệu cosmetic.',
    rarity: 'legendary',
    source: 'donation',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: null,
  },
  {
    key: 'phase21_title_hoa_thien_tan_do',
    nameVi: 'Hoa Thiên Tân Đồ',
    nameEn: 'Hoa Thiên New Disciple',
    description: 'Danh hiệu cosmetic mở từ checkpoint chương Phase 21.',
    rarity: 'common',
    source: 'event',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: null,
  },
  {
    key: 'phase21_title_linh_can_so_tinh',
    nameVi: 'Linh Căn Sơ Tỉnh',
    nameEn: 'Root Awakened',
    description: 'Danh hiệu cosmetic mở từ checkpoint chương Phase 21.',
    rarity: 'common',
    source: 'event',
    element: 'moc',
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: null,
  },
  {
    key: 'phase21_title_ngoai_mon_tru_cot',
    nameVi: 'Ngoại Môn Trụ Cột',
    nameEn: 'Outer-Court Pillar',
    description: 'Danh hiệu cosmetic mở từ checkpoint chương Phase 21.',
    rarity: 'rare',
    source: 'event',
    element: 'thuy',
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: null,
  },
  {
    key: 'phase21_title_bi_canh_khai_mon',
    nameVi: 'Bí Cảnh Khai Môn',
    nameEn: 'Secret-Realm Opener',
    description: 'Danh hiệu cosmetic mở từ checkpoint chương Phase 21.',
    rarity: 'rare',
    source: 'event',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: null,
  },
  {
    key: 'phase21_title_ma_dao_tham_van',
    nameVi: 'Ma Đạo Thẩm Vấn',
    nameEn: 'Demonic Path Interrogator',
    description: 'Danh hiệu cosmetic mở từ checkpoint chương Phase 21.',
    rarity: 'epic',
    source: 'event',
    element: 'tho',
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: null,
  },
  {
    key: 'phase21_title_ngu_hanh_thien_menh',
    nameVi: 'Ngũ Hành Thiên Mệnh',
    nameEn: 'Five-Element Mandate',
    description: 'Danh hiệu cosmetic mở từ checkpoint chương Phase 21.',
    rarity: 'epic',
    source: 'event',
    element: 'kim',
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: null,
  },
  {
    key: 'phase21_title_thanh_tam_ho_dao',
    nameVi: 'Thanh Tâm Hộ Đạo',
    nameEn: 'Clear-Heart Protector',
    description: 'Danh hiệu cosmetic mở từ checkpoint chương Phase 21.',
    rarity: 'legendary',
    source: 'event',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: null,
  },
  {
    key: 'phase21_title_hoa_thien_ho_phap',
    nameVi: 'Hoa Thiên Hộ Pháp',
    nameEn: 'Hoa Thiên Protector',
    description: 'Danh hiệu cosmetic mở từ checkpoint chương Phase 21.',
    rarity: 'legendary',
    source: 'event',
    element: 'thuy',
    unlockRealmKey: null,
    unlockAchievementKey: null,
    unlockSectRole: null,
    flavorStatBonus: null,
  },
  {
    key: 'phase21_title_achievement_033',
    nameVi: 'Danh Hiệu Phase 21 033',
    nameEn: 'Phase 21 Title 033',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'common',
    source: 'achievement',
    element: 'hoa',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_033',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'mpMax', value: 1.01 },
  },
  {
    key: 'phase21_title_achievement_034',
    nameVi: 'Danh Hiệu Phase 21 034',
    nameEn: 'Phase 21 Title 034',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'rare',
    source: 'achievement',
    element: 'tho',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_034',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.02 },
  },
  {
    key: 'phase21_title_achievement_035',
    nameVi: 'Danh Hiệu Phase 21 035',
    nameEn: 'Phase 21 Title 035',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'epic',
    source: 'achievement',
    element: 'kim',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_035',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.04 },
  },
  {
    key: 'phase21_title_achievement_036',
    nameVi: 'Danh Hiệu Phase 21 036',
    nameEn: 'Phase 21 Title 036',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'legendary',
    source: 'achievement',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_036',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'def', value: 1.08 },
  },
  {
    key: 'phase21_title_achievement_037',
    nameVi: 'Danh Hiệu Phase 21 037',
    nameEn: 'Phase 21 Title 037',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'mythic',
    source: 'achievement',
    element: 'thuy',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_037',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'hpMax', value: 1.12 },
  },
  {
    key: 'phase21_title_achievement_038',
    nameVi: 'Danh Hiệu Phase 21 038',
    nameEn: 'Phase 21 Title 038',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'common',
    source: 'achievement',
    element: 'hoa',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_038',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'mpMax', value: 1.01 },
  },
  {
    key: 'phase21_title_achievement_039',
    nameVi: 'Danh Hiệu Phase 21 039',
    nameEn: 'Phase 21 Title 039',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'rare',
    source: 'achievement',
    element: 'tho',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_039',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.02 },
  },
  {
    key: 'phase21_title_achievement_040',
    nameVi: 'Danh Hiệu Phase 21 040',
    nameEn: 'Phase 21 Title 040',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'epic',
    source: 'achievement',
    element: 'kim',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_040',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.04 },
  },
  {
    key: 'phase21_title_achievement_041',
    nameVi: 'Danh Hiệu Phase 21 041',
    nameEn: 'Phase 21 Title 041',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'legendary',
    source: 'achievement',
    element: 'moc',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_041',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'def', value: 1.08 },
  },
  {
    key: 'phase21_title_achievement_042',
    nameVi: 'Danh Hiệu Phase 21 042',
    nameEn: 'Phase 21 Title 042',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'mythic',
    source: 'achievement',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_042',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'hpMax', value: 1.12 },
  },
  {
    key: 'phase21_title_achievement_043',
    nameVi: 'Danh Hiệu Phase 21 043',
    nameEn: 'Phase 21 Title 043',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'common',
    source: 'achievement',
    element: 'hoa',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_043',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'mpMax', value: 1.01 },
  },
  {
    key: 'phase21_title_achievement_044',
    nameVi: 'Danh Hiệu Phase 21 044',
    nameEn: 'Phase 21 Title 044',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'rare',
    source: 'achievement',
    element: 'tho',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_044',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.02 },
  },
  {
    key: 'phase21_title_achievement_045',
    nameVi: 'Danh Hiệu Phase 21 045',
    nameEn: 'Phase 21 Title 045',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'epic',
    source: 'achievement',
    element: 'kim',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_045',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.04 },
  },
  {
    key: 'phase21_title_achievement_046',
    nameVi: 'Danh Hiệu Phase 21 046',
    nameEn: 'Phase 21 Title 046',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'legendary',
    source: 'achievement',
    element: 'moc',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_046',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'def', value: 1.08 },
  },
  {
    key: 'phase21_title_achievement_047',
    nameVi: 'Danh Hiệu Phase 21 047',
    nameEn: 'Phase 21 Title 047',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'mythic',
    source: 'achievement',
    element: 'thuy',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_047',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'hpMax', value: 1.12 },
  },
  {
    key: 'phase21_title_achievement_048',
    nameVi: 'Danh Hiệu Phase 21 048',
    nameEn: 'Phase 21 Title 048',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'common',
    source: 'achievement',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_048',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'mpMax', value: 1.01 },
  },
  {
    key: 'phase21_title_achievement_049',
    nameVi: 'Danh Hiệu Phase 21 049',
    nameEn: 'Phase 21 Title 049',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'rare',
    source: 'achievement',
    element: 'tho',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_049',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.02 },
  },
  {
    key: 'phase21_title_achievement_050',
    nameVi: 'Danh Hiệu Phase 21 050',
    nameEn: 'Phase 21 Title 050',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'epic',
    source: 'achievement',
    element: 'kim',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_050',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.04 },
  },
  {
    key: 'phase21_title_achievement_051',
    nameVi: 'Danh Hiệu Phase 21 051',
    nameEn: 'Phase 21 Title 051',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'legendary',
    source: 'achievement',
    element: 'moc',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_051',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'def', value: 1.08 },
  },
  {
    key: 'phase21_title_achievement_052',
    nameVi: 'Danh Hiệu Phase 21 052',
    nameEn: 'Phase 21 Title 052',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'mythic',
    source: 'achievement',
    element: 'thuy',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_052',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'hpMax', value: 1.12 },
  },
  {
    key: 'phase21_title_achievement_053',
    nameVi: 'Danh Hiệu Phase 21 053',
    nameEn: 'Phase 21 Title 053',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'common',
    source: 'achievement',
    element: 'hoa',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_053',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'mpMax', value: 1.01 },
  },
  {
    key: 'phase21_title_achievement_054',
    nameVi: 'Danh Hiệu Phase 21 054',
    nameEn: 'Phase 21 Title 054',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'rare',
    source: 'achievement',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_054',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.02 },
  },
  {
    key: 'phase21_title_achievement_055',
    nameVi: 'Danh Hiệu Phase 21 055',
    nameEn: 'Phase 21 Title 055',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'epic',
    source: 'achievement',
    element: 'kim',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_055',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.04 },
  },
  {
    key: 'phase21_title_achievement_056',
    nameVi: 'Danh Hiệu Phase 21 056',
    nameEn: 'Phase 21 Title 056',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'legendary',
    source: 'achievement',
    element: 'moc',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_056',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'def', value: 1.08 },
  },
  {
    key: 'phase21_title_achievement_057',
    nameVi: 'Danh Hiệu Phase 21 057',
    nameEn: 'Phase 21 Title 057',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'mythic',
    source: 'achievement',
    element: 'thuy',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_057',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'hpMax', value: 1.12 },
  },
  {
    key: 'phase21_title_achievement_058',
    nameVi: 'Danh Hiệu Phase 21 058',
    nameEn: 'Phase 21 Title 058',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'common',
    source: 'achievement',
    element: 'hoa',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_058',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'mpMax', value: 1.01 },
  },
  {
    key: 'phase21_title_achievement_059',
    nameVi: 'Danh Hiệu Phase 21 059',
    nameEn: 'Phase 21 Title 059',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'rare',
    source: 'achievement',
    element: 'tho',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_059',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.02 },
  },
  {
    key: 'phase21_title_achievement_060',
    nameVi: 'Danh Hiệu Phase 21 060',
    nameEn: 'Phase 21 Title 060',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'epic',
    source: 'achievement',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_060',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.04 },
  },
  {
    key: 'phase21_title_achievement_061',
    nameVi: 'Danh Hiệu Phase 21 061',
    nameEn: 'Phase 21 Title 061',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'legendary',
    source: 'achievement',
    element: 'moc',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_061',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'def', value: 1.08 },
  },
  {
    key: 'phase21_title_achievement_062',
    nameVi: 'Danh Hiệu Phase 21 062',
    nameEn: 'Phase 21 Title 062',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'mythic',
    source: 'achievement',
    element: 'thuy',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_062',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'hpMax', value: 1.12 },
  },
  {
    key: 'phase21_title_achievement_063',
    nameVi: 'Danh Hiệu Phase 21 063',
    nameEn: 'Phase 21 Title 063',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'common',
    source: 'achievement',
    element: 'hoa',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_063',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'mpMax', value: 1.01 },
  },
  {
    key: 'phase21_title_achievement_064',
    nameVi: 'Danh Hiệu Phase 21 064',
    nameEn: 'Phase 21 Title 064',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'rare',
    source: 'achievement',
    element: 'tho',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_064',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.02 },
  },
  {
    key: 'phase21_title_achievement_065',
    nameVi: 'Danh Hiệu Phase 21 065',
    nameEn: 'Phase 21 Title 065',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'epic',
    source: 'achievement',
    element: 'kim',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_065',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.04 },
  },
  {
    key: 'phase21_title_achievement_066',
    nameVi: 'Danh Hiệu Phase 21 066',
    nameEn: 'Phase 21 Title 066',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'legendary',
    source: 'achievement',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_066',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'def', value: 1.08 },
  },
  {
    key: 'phase21_title_achievement_067',
    nameVi: 'Danh Hiệu Phase 21 067',
    nameEn: 'Phase 21 Title 067',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'mythic',
    source: 'achievement',
    element: 'thuy',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_067',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'hpMax', value: 1.12 },
  },
  {
    key: 'phase21_title_achievement_068',
    nameVi: 'Danh Hiệu Phase 21 068',
    nameEn: 'Phase 21 Title 068',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'common',
    source: 'achievement',
    element: 'hoa',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_068',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'mpMax', value: 1.01 },
  },
  {
    key: 'phase21_title_achievement_069',
    nameVi: 'Danh Hiệu Phase 21 069',
    nameEn: 'Phase 21 Title 069',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'rare',
    source: 'achievement',
    element: 'tho',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_069',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.02 },
  },
  {
    key: 'phase21_title_achievement_070',
    nameVi: 'Danh Hiệu Phase 21 070',
    nameEn: 'Phase 21 Title 070',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'epic',
    source: 'achievement',
    element: 'kim',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_070',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.04 },
  },
  {
    key: 'phase21_title_achievement_071',
    nameVi: 'Danh Hiệu Phase 21 071',
    nameEn: 'Phase 21 Title 071',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'legendary',
    source: 'achievement',
    element: 'moc',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_071',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'def', value: 1.08 },
  },
  {
    key: 'phase21_title_achievement_072',
    nameVi: 'Danh Hiệu Phase 21 072',
    nameEn: 'Phase 21 Title 072',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'mythic',
    source: 'achievement',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_072',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'hpMax', value: 1.12 },
  },
  {
    key: 'phase21_title_achievement_073',
    nameVi: 'Danh Hiệu Phase 21 073',
    nameEn: 'Phase 21 Title 073',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'common',
    source: 'achievement',
    element: 'hoa',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_073',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'mpMax', value: 1.01 },
  },
  {
    key: 'phase21_title_achievement_074',
    nameVi: 'Danh Hiệu Phase 21 074',
    nameEn: 'Phase 21 Title 074',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'rare',
    source: 'achievement',
    element: 'tho',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_074',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.02 },
  },
  {
    key: 'phase21_title_achievement_075',
    nameVi: 'Danh Hiệu Phase 21 075',
    nameEn: 'Phase 21 Title 075',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'epic',
    source: 'achievement',
    element: 'kim',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_075',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.04 },
  },
  {
    key: 'phase21_title_achievement_076',
    nameVi: 'Danh Hiệu Phase 21 076',
    nameEn: 'Phase 21 Title 076',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'legendary',
    source: 'achievement',
    element: 'moc',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_076',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'def', value: 1.08 },
  },
  {
    key: 'phase21_title_achievement_077',
    nameVi: 'Danh Hiệu Phase 21 077',
    nameEn: 'Phase 21 Title 077',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'mythic',
    source: 'achievement',
    element: 'thuy',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_077',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'hpMax', value: 1.12 },
  },
  {
    key: 'phase21_title_achievement_078',
    nameVi: 'Danh Hiệu Phase 21 078',
    nameEn: 'Phase 21 Title 078',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'common',
    source: 'achievement',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_078',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'mpMax', value: 1.01 },
  },
  {
    key: 'phase21_title_achievement_079',
    nameVi: 'Danh Hiệu Phase 21 079',
    nameEn: 'Phase 21 Title 079',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'rare',
    source: 'achievement',
    element: 'tho',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_079',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.02 },
  },
  {
    key: 'phase21_title_achievement_080',
    nameVi: 'Danh Hiệu Phase 21 080',
    nameEn: 'Phase 21 Title 080',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'epic',
    source: 'achievement',
    element: 'kim',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_080',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.04 },
  },
  {
    key: 'phase21_title_achievement_081',
    nameVi: 'Danh Hiệu Phase 21 081',
    nameEn: 'Phase 21 Title 081',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'legendary',
    source: 'achievement',
    element: 'moc',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_081',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'def', value: 1.08 },
  },
  {
    key: 'phase21_title_achievement_082',
    nameVi: 'Danh Hiệu Phase 21 082',
    nameEn: 'Phase 21 Title 082',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'mythic',
    source: 'achievement',
    element: 'thuy',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_082',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'hpMax', value: 1.12 },
  },
  {
    key: 'phase21_title_achievement_083',
    nameVi: 'Danh Hiệu Phase 21 083',
    nameEn: 'Phase 21 Title 083',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'common',
    source: 'achievement',
    element: 'hoa',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_083',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'mpMax', value: 1.01 },
  },
  {
    key: 'phase21_title_achievement_084',
    nameVi: 'Danh Hiệu Phase 21 084',
    nameEn: 'Phase 21 Title 084',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'rare',
    source: 'achievement',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_084',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.02 },
  },
  {
    key: 'phase21_title_achievement_085',
    nameVi: 'Danh Hiệu Phase 21 085',
    nameEn: 'Phase 21 Title 085',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'epic',
    source: 'achievement',
    element: 'kim',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_085',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.04 },
  },
  {
    key: 'phase21_title_achievement_086',
    nameVi: 'Danh Hiệu Phase 21 086',
    nameEn: 'Phase 21 Title 086',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'legendary',
    source: 'achievement',
    element: 'moc',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_086',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'def', value: 1.08 },
  },
  {
    key: 'phase21_title_achievement_087',
    nameVi: 'Danh Hiệu Phase 21 087',
    nameEn: 'Phase 21 Title 087',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'mythic',
    source: 'achievement',
    element: 'thuy',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_087',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'hpMax', value: 1.12 },
  },
  {
    key: 'phase21_title_achievement_088',
    nameVi: 'Danh Hiệu Phase 21 088',
    nameEn: 'Phase 21 Title 088',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'common',
    source: 'achievement',
    element: 'hoa',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_088',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'mpMax', value: 1.01 },
  },
  {
    key: 'phase21_title_achievement_089',
    nameVi: 'Danh Hiệu Phase 21 089',
    nameEn: 'Phase 21 Title 089',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'rare',
    source: 'achievement',
    element: 'tho',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_089',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.02 },
  },
  {
    key: 'phase21_title_achievement_090',
    nameVi: 'Danh Hiệu Phase 21 090',
    nameEn: 'Phase 21 Title 090',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'epic',
    source: 'achievement',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_090',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.04 },
  },
  {
    key: 'phase21_title_achievement_091',
    nameVi: 'Danh Hiệu Phase 21 091',
    nameEn: 'Phase 21 Title 091',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'legendary',
    source: 'achievement',
    element: 'moc',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_091',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'def', value: 1.08 },
  },
  {
    key: 'phase21_title_achievement_092',
    nameVi: 'Danh Hiệu Phase 21 092',
    nameEn: 'Phase 21 Title 092',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'mythic',
    source: 'achievement',
    element: 'thuy',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_092',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'hpMax', value: 1.12 },
  },
  {
    key: 'phase21_title_achievement_093',
    nameVi: 'Danh Hiệu Phase 21 093',
    nameEn: 'Phase 21 Title 093',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'common',
    source: 'achievement',
    element: 'hoa',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_093',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'mpMax', value: 1.01 },
  },
  {
    key: 'phase21_title_achievement_094',
    nameVi: 'Danh Hiệu Phase 21 094',
    nameEn: 'Phase 21 Title 094',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'rare',
    source: 'achievement',
    element: 'tho',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_094',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.02 },
  },
  {
    key: 'phase21_title_achievement_095',
    nameVi: 'Danh Hiệu Phase 21 095',
    nameEn: 'Phase 21 Title 095',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'epic',
    source: 'achievement',
    element: 'kim',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_095',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.04 },
  },
  {
    key: 'phase21_title_achievement_096',
    nameVi: 'Danh Hiệu Phase 21 096',
    nameEn: 'Phase 21 Title 096',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'legendary',
    source: 'achievement',
    element: null,
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_096',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'def', value: 1.08 },
  },
  {
    key: 'phase21_title_achievement_097',
    nameVi: 'Danh Hiệu Phase 21 097',
    nameEn: 'Phase 21 Title 097',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'mythic',
    source: 'achievement',
    element: 'thuy',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_097',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'hpMax', value: 1.12 },
  },
  {
    key: 'phase21_title_achievement_098',
    nameVi: 'Danh Hiệu Phase 21 098',
    nameEn: 'Phase 21 Title 098',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'common',
    source: 'achievement',
    element: 'hoa',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_098',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'mpMax', value: 1.01 },
  },
  {
    key: 'phase21_title_achievement_099',
    nameVi: 'Danh Hiệu Phase 21 099',
    nameEn: 'Phase 21 Title 099',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'rare',
    source: 'achievement',
    element: 'tho',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_099',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'spirit', value: 1.02 },
  },
  {
    key: 'phase21_title_achievement_100',
    nameVi: 'Danh Hiệu Phase 21 100',
    nameEn: 'Phase 21 Title 100',
    description: 'Danh hiệu nhỏ mở qua achievement Phase 21; ưu tiên cosmetic và bonus nằm trong cap rarity.',
    rarity: 'epic',
    source: 'achievement',
    element: 'kim',
    unlockRealmKey: null,
    unlockAchievementKey: 'phase21_achievement_100',
    unlockSectRole: null,
    flavorStatBonus: { statTarget: 'atk', value: 1.04 },
  }];

const TITLES_BY_KEY = new Map<string, TitleDef>(TITLES.map((t) => [t.key, t]));

/**
 * Lookup title by key.
 */
export function getTitleDef(key: string): TitleDef | undefined {
  return TITLES_BY_KEY.get(key);
}

/**
 * Filter theo rarity.
 */
export function titlesByRarity(rarity: TitleRarity): readonly TitleDef[] {
  return TITLES.filter((t) => t.rarity === rarity);
}

/**
 * Filter theo source.
 */
export function titlesBySource(source: TitleSource): readonly TitleDef[] {
  return TITLES.filter((t) => t.source === source);
}

/**
 * Filter theo element (null = neutral).
 */
export function titlesByElement(
  element: ElementKey | null
): readonly TitleDef[] {
  return TITLES.filter((t) => t.element === element);
}

/**
 * Tìm title sẽ unlock khi đạt realm này (1 hoặc 0).
 *
 * @param realmKey Realm key vừa đạt.
 */
export function titleForRealmMilestone(
  realmKey: string
): TitleDef | undefined {
  return TITLES.find(
    (t) => t.source === 'realm_milestone' && t.unlockRealmKey === realmKey
  );
}

/**
 * Tìm title sẽ unlock khi achievement này complete (1 hoặc 0).
 *
 * @param achievementKey Achievement key.
 */
export function titleForAchievement(
  achievementKey: string
): TitleDef | undefined {
  return TITLES.find(
    (t) =>
      t.source === 'achievement' && t.unlockAchievementKey === achievementKey
  );
}

/**
 * Tìm title sẽ unlock khi sect role này đạt (1 hoặc 0).
 *
 * @param sectRole Sect role key.
 */
export function titleForSectRole(sectRole: string): TitleDef | undefined {
  return TITLES.find(
    (t) => t.source === 'sect_rank' && t.unlockSectRole === sectRole
  );
}

/**
 * Compose flavor stat mods từ list title đang equipped.
 *
 * Convention: chỉ 1 title có thể equip cùng lúc (Character.title String?).
 * Helper này giả định caller đã filter ra title đang equip thực sự.
 * Hỗ trợ cả nhiều title (cho phase 11.9.B+ nếu có "title slot system").
 *
 * @param equippedTitleKeys Các title key đã equip (≥ 1 title).
 */
export interface TitleMods {
  readonly atkMul: number;
  readonly defMul: number;
  readonly hpMaxMul: number;
  readonly mpMaxMul: number;
  readonly spiritMul: number;
}

export function composeTitleMods(
  equippedTitleKeys: readonly string[]
): TitleMods {
  let atkMul = 1;
  let defMul = 1;
  let hpMaxMul = 1;
  let mpMaxMul = 1;
  let spiritMul = 1;

  for (const key of equippedTitleKeys) {
    const def = TITLES_BY_KEY.get(key);
    if (!def || !def.flavorStatBonus) continue;
    const bonus = def.flavorStatBonus;
    switch (bonus.statTarget) {
      case 'atk':
        atkMul *= bonus.value;
        break;
      case 'def':
        defMul *= bonus.value;
        break;
      case 'hpMax':
        hpMaxMul *= bonus.value;
        break;
      case 'mpMax':
        mpMaxMul *= bonus.value;
        break;
      case 'spirit':
        spiritMul *= bonus.value;
        break;
    }
  }

  return { atkMul, defMul, hpMaxMul, mpMaxMul, spiritMul };
}
