/**
 * Phase 21 — Main story chapter catalog.
 *
 * Static content catalog only. Runtime quest state remains server-authoritative
 * through `QuestProgress`; these chapters group existing/new quest keys for the
 * Story/Quest Journal UI and integrity tests.
 *
 * Source: `docs/story/TU_TIEN_LO_STORY_BIBLE.md` + owner DOCX audit captured in
 * `docs/phase-21-content-plan.md`.
 */

import type { ElementKey } from './combat';

export interface StoryChapterUnlockCondition {
  kind: 'realm' | 'quest_claimed' | 'story_flag' | 'multi_gate';
  realmKey?: string;
  questKey?: string;
  flagKey?: string;
  descriptionVi: string;
  descriptionEn: string;
}

export type StoryChapterGateRuntimeStatus =
  | 'runtime_enforced'
  | 'catalog_seeded_runtime_follow_up';

export interface StoryChapterUnlockGate {
  requiredRealmKey: string;
  requiredRealmOrder: number;
  requiredCultivationStage?: number | null;
  requiredBattlePower?: number | null;
  requiredMainQuestKey?: string | null;
  previousChapterKey?: string | null;
  requiredStoryFlag?: string | null;
  requiredDungeonClearKey?: string | null;
  requiredBossDefeatedKey?: string | null;
  requiredSectRank?: string | null;
  requiredElementalAffinity?: ElementKey | 'any' | null;
  runtimeStatus: StoryChapterGateRuntimeStatus;
  descriptionVi: string;
  descriptionEn: string;
}

export interface StoryChapterReward {
  linhThach?: number;
  exp?: number;
  congHien?: number;
  items?: ReadonlyArray<{ itemKey: string; qty: number }>;
  achievementKeys?: readonly string[];
  titleKeys?: readonly string[];
}

export interface StoryChapterDef {
  chapterKey: string;
  order: number;
  titleVi: string;
  titleEn: string;
  descriptionVi: string;
  descriptionEn: string;
  unlockCondition: StoryChapterUnlockCondition;
  unlockGate: StoryChapterUnlockGate;
  requiredRealmKey: string;
  requiredRealmOrder: number;
  mainQuestChainKey: string;
  mainQuestKeys: readonly string[];
  involvedNpcKeys: readonly string[];
  relatedDungeonKeys: readonly string[];
  relatedBossKeys: readonly string[];
  chapterReward: StoryChapterReward;
  loreSummary: string;
}

export const STORY_CHAPTERS: readonly StoryChapterDef[] = [
  {
    chapterKey: 'chapter_pham_nhan_nhap_dao',
    order: 1,
    titleVi: 'Phàm Nhân Nhập Đạo',
    titleEn: 'Mortal Enters the Dao',
    descriptionVi:
      'Một phàm nhân căn cơ yếu bước vào Hoa Thiên Môn, chứng minh đạo tâm bằng việc hậu sơn và nhận ra tông môn nghèo này đang giữ bí mật cổ xưa.',
    descriptionEn:
      'A weak mortal joins Hoa Thiên Môn, proves resolve in the back mountain, and learns the poor sect guards an ancient secret.',
    unlockCondition: {
      kind: 'realm',
      realmKey: 'phamnhan',
      descriptionVi: 'Mở khi tạo nhân vật Phàm Nhân.',
      descriptionEn: 'Unlocked when a Mortal character is created.',
    },
    unlockGate: {
      requiredRealmKey: 'phamnhan',
      requiredRealmOrder: 0,
      requiredCultivationStage: 1,
      requiredBattlePower: 0,
      requiredMainQuestKey: null,
      previousChapterKey: null,
      requiredStoryFlag: 'story_flag_character_created',
      requiredDungeonClearKey: null,
      requiredBossDefeatedKey: null,
      requiredSectRank: null,
      requiredElementalAffinity: null,
      runtimeStatus: 'catalog_seeded_runtime_follow_up',
      descriptionVi:
        'Nhân vật mới Phàm Nhân bước vào Hoa Thiên Môn; gate runtime hiện dựa vào tạo nhân vật/realm.',
      descriptionEn:
        'A new Mortal character enters Hoa Thiên Môn; runtime gate currently relies on character creation/realm.',
    },
    requiredRealmKey: 'phamnhan',
    requiredRealmOrder: 0,
    mainQuestChainKey: 'phase21_chapter_01_main',
    mainQuestKeys: [
      'phase21_ch01_main_01',
      'phase21_ch01_main_02',
      'phase21_ch01_main_03',
      'phase21_ch01_main_04',
      'phase21_ch01_main_05',
    ],
    involvedNpcKeys: ['npc_lang_van_sinh', 'npc_moc_thanh_y'],
    relatedDungeonKeys: ['story_dgn_phamnhan_back_mountain'],
    relatedBossKeys: [],
    chapterReward: {
      linhThach: 180,
      exp: 300,
      congHien: 30,
      items: [{ itemKey: 'so_kiem', qty: 1 }],
      achievementKeys: ['phase21_story_chapter_01_complete'],
      titleKeys: ['phase21_title_hoa_thien_tan_do'],
    },
    loreSummary:
      'CANON_FROM_STORY_BIBLE: Hoa Thiên admission, Hậu Sơn proof, and the first hint of the Nameless Seed.',
  },
  {
    chapterKey: 'chapter_linh_can_thuc_tinh',
    order: 2,
    titleVi: 'Linh Căn Thức Tỉnh',
    titleEn: 'Spiritual Root Awakening',
    descriptionVi:
      'Mộc Thanh Y dẫn người chơi hiểu linh căn Ngũ Hành, học tu luyện đầu tiên và phát hiện dấu Tịch Linh khí trong Linh Tuyền Động.',
    descriptionEn:
      'Mộc Thanh Y teaches the Five-Element spiritual root, first cultivation, and the first trace of Tịch Linh qi in Linh Tuyền Động.',
    unlockCondition: {
      kind: 'quest_claimed',
      questKey: 'phase21_ch01_main_05',
      descriptionVi: 'Hoàn thành nhập môn, đạt Luyện Khí và vượt Hậu Sơn.',
      descriptionEn: 'Complete initiation, reach Qi Refining, and clear Back Mountain.',
    },
    unlockGate: {
      requiredRealmKey: 'luyenkhi',
      requiredRealmOrder: 1,
      requiredCultivationStage: 1,
      requiredBattlePower: 850,
      requiredMainQuestKey: 'phase21_ch01_main_05',
      previousChapterKey: 'chapter_pham_nhan_nhap_dao',
      requiredStoryFlag: 'story_flag_seed_truth_heard',
      requiredDungeonClearKey: 'story_dgn_phamnhan_back_mountain',
      requiredBossDefeatedKey: null,
      requiredSectRank: 'ngoai_mon',
      requiredElementalAffinity: 'any',
      runtimeStatus: 'catalog_seeded_runtime_follow_up',
      descriptionVi:
        'Cần hoàn thành nhập môn, đạt Luyện Khí, vượt Hậu Sơn và có linh căn Ngũ Hành sơ tỉnh.',
      descriptionEn:
        'Requires initiation completion, Qi Refining, Back Mountain clear, and initial Five-Element awakening.',
    },
    requiredRealmKey: 'luyenkhi',
    requiredRealmOrder: 1,
    mainQuestChainKey: 'phase21_chapter_02_main',
    mainQuestKeys: [
      'phase21_ch02_main_01',
      'phase21_ch02_main_02',
      'phase21_ch02_main_03',
      'phase21_ch02_main_04',
      'phase21_ch02_main_05',
    ],
    involvedNpcKeys: ['npc_moc_thanh_y', 'npc_lang_van_sinh'],
    relatedDungeonKeys: ['story_dgn_luyenkhi_hac_lam_trial'],
    relatedBossKeys: [],
    chapterReward: {
      linhThach: 320,
      exp: 900,
      congHien: 60,
      items: [{ itemKey: 'linh_lo_dan', qty: 2 }],
      achievementKeys: ['phase21_story_chapter_02_complete'],
      titleKeys: ['phase21_title_linh_can_so_tinh'],
    },
    loreSummary:
      'CANON_FROM_STORY_BIBLE: spiritual-root teaching, Five Element choice, and Tịch Linh Chủng foreshadow around Mộc Thanh Y.',
  },
  {
    chapterKey: 'chapter_tong_mon_so_khoi',
    order: 3,
    titleVi: 'Tông Môn Sơ Khởi',
    titleEn: 'Sect Foundations',
    descriptionVi:
      'Hoa Thiên Môn nghèo nhưng chưa tàn. Người chơi tu sửa trận cũ, góp tài nguyên, gặp Hàn Dạ và học rằng chính đạo cũng có nghi ngờ.',
    descriptionEn:
      'Hoa Thiên Môn is poor but not dead. The player repairs old arrays, contributes resources, meets Hàn Dạ, and learns the righteous path still doubts them.',
    unlockCondition: {
      kind: 'multi_gate',
      questKey: 'phase21_ch02_main_05',
      descriptionVi: 'Hoàn thành Linh Căn Thức Tỉnh và đủ Luyện Khí trung kỳ.',
      descriptionEn: 'Complete Spiritual Root Awakening and reach mid Qi Refining.',
    },
    unlockGate: {
      requiredRealmKey: 'luyenkhi',
      requiredRealmOrder: 1,
      requiredCultivationStage: 4,
      requiredBattlePower: 1_400,
      requiredMainQuestKey: 'phase21_ch02_main_05',
      previousChapterKey: 'chapter_linh_can_thuc_tinh',
      requiredStoryFlag: 'story_flag_linh_can_awakened',
      requiredDungeonClearKey: 'story_dgn_luyenkhi_hac_lam_trial',
      requiredBossDefeatedKey: null,
      requiredSectRank: 'ngoai_mon',
      requiredElementalAffinity: 'any',
      runtimeStatus: 'catalog_seeded_runtime_follow_up',
      descriptionVi:
        'Cần linh căn thức tỉnh, Luyện Khí trung kỳ, vượt Hắc Lâm và đủ lực chiến tu sửa hộ sơn trận.',
      descriptionEn:
        'Requires awakened root, mid Qi Refining, Black Forest clear, and enough power to repair the sect array.',
    },
    requiredRealmKey: 'luyenkhi',
    requiredRealmOrder: 1,
    mainQuestChainKey: 'phase21_chapter_03_main',
    mainQuestKeys: [
      'phase21_ch03_main_01',
      'phase21_ch03_main_02',
      'phase21_ch03_main_03',
      'phase21_ch03_main_04',
      'phase21_ch03_main_05',
    ],
    involvedNpcKeys: ['npc_lang_van_sinh', 'npc_moc_thanh_y', 'npc_han_da'],
    relatedDungeonKeys: ['story_dgn_truc_co_co_thu_ky'],
    relatedBossKeys: [],
    chapterReward: {
      linhThach: 420,
      exp: 1_200,
      congHien: 100,
      items: [{ itemKey: 'hoi_nguyen_dan', qty: 1 }],
      achievementKeys: ['phase21_story_chapter_03_complete'],
      titleKeys: ['phase21_title_ngoai_mon_tru_cot'],
    },
    loreSummary:
      'CANON_FROM_STORY_BIBLE + AI_EXPANDED_LORE: sect contribution, Hàn Dạ rivalry, and party/social tutorial hooks.',
  },
  {
    chapterKey: 'chapter_bi_canh_huyet_nguyet',
    order: 4,
    titleVi: 'Bí Cảnh Huyết Nguyệt',
    titleEn: 'Blood Moon Secret Realm',
    descriptionVi:
      'Tô Nguyệt Ly lần theo giếng cũ và sử sách bị xoá, mở bí cảnh Huyết Nguyệt nơi truyền thừa Hoa Thiên bị chôn vùi.',
    descriptionEn:
      'Tô Nguyệt Ly follows the old well and erased histories into Blood Moon, where a buried Hoa Thiên inheritance remains.',
    unlockCondition: {
      kind: 'multi_gate',
      questKey: 'phase21_ch03_main_05',
      descriptionVi: 'Hoàn thành Tông Môn Sơ Khởi, đạt Trúc Cơ và tìm chìa giếng cũ.',
      descriptionEn: 'Complete Sect Foundations, reach Foundation Establishment, and find the old-well key.',
    },
    unlockGate: {
      requiredRealmKey: 'truc_co',
      requiredRealmOrder: 2,
      requiredCultivationStage: 1,
      requiredBattlePower: 2_600,
      requiredMainQuestKey: 'phase21_ch03_main_05',
      previousChapterKey: 'chapter_tong_mon_so_khoi',
      requiredStoryFlag: 'story_flag_old_well_key_found',
      requiredDungeonClearKey: 'story_dgn_truc_co_co_thu_ky',
      requiredBossDefeatedKey: null,
      requiredSectRank: 'noi_mon_du_bi',
      requiredElementalAffinity: 'any',
      runtimeStatus: 'catalog_seeded_runtime_follow_up',
      descriptionVi:
        'Cần Trúc Cơ, chìa giếng cũ, ký ức cổ thụ và tư cách nội môn dự bị để mở bí cảnh.',
      descriptionEn:
        'Requires Foundation Establishment, old-well key, ancient-tree memory, and provisional inner-disciple status.',
    },
    requiredRealmKey: 'truc_co',
    requiredRealmOrder: 2,
    mainQuestChainKey: 'phase21_chapter_04_main',
    mainQuestKeys: [
      'phase21_ch04_main_01',
      'phase21_ch04_main_02',
      'phase21_ch04_main_03',
      'phase21_ch04_main_04',
      'phase21_ch04_main_05',
    ],
    involvedNpcKeys: ['npc_to_nguyet_ly', 'npc_lang_van_sinh', 'npc_moc_thanh_y'],
    relatedDungeonKeys: ['story_dgn_truc_co_huyet_nguyet'],
    relatedBossKeys: ['huyet_long_quan'],
    chapterReward: {
      linhThach: 700,
      exp: 2_400,
      congHien: 120,
      items: [{ itemKey: 'co_thien_dan', qty: 1 }],
      achievementKeys: ['phase21_story_chapter_04_complete'],
      titleKeys: ['phase21_title_bi_canh_khai_mon'],
    },
    loreSummary:
      'CANON_FROM_STORY_BIBLE: old well, Five-Element puzzle, erased Hoa Thiên branch, and inheritance choice.',
  },
  {
    chapterKey: 'chapter_ma_tu_xuat_the',
    order: 5,
    titleVi: 'Ma Tu Xuất Thế',
    titleEn: 'Demonic Cultivator Emerges',
    descriptionVi:
      'Huyết La Sát xuất hiện sau một thôn bị diệt. Dấu vết cho thấy chính đạo và ma đạo đều bị Tịch Thiên lợi dụng.',
    descriptionEn:
      'Huyết La Sát appears after a village massacre. Evidence shows both righteous and demonic paths are being used by Tịch Thiên.',
    unlockCondition: {
      kind: 'multi_gate',
      questKey: 'phase21_ch04_main_05',
      descriptionVi: 'Hoàn thành Bí Cảnh Huyết Nguyệt, kết Kim Đan và hạ Huyết Long Quân.',
      descriptionEn: 'Complete Blood Moon, form Golden Core, and defeat Huyết Long Quân.',
    },
    unlockGate: {
      requiredRealmKey: 'kim_dan',
      requiredRealmOrder: 3,
      requiredCultivationStage: 1,
      requiredBattlePower: 4_800,
      requiredMainQuestKey: 'phase21_ch04_main_05',
      previousChapterKey: 'chapter_bi_canh_huyet_nguyet',
      requiredStoryFlag: 'story_flag_huyet_nguyet_inheritance_seen',
      requiredDungeonClearKey: 'story_dgn_truc_co_huyet_nguyet',
      requiredBossDefeatedKey: 'huyet_long_quan',
      requiredSectRank: 'noi_mon',
      requiredElementalAffinity: 'any',
      runtimeStatus: 'catalog_seeded_runtime_follow_up',
      descriptionVi:
        'Cần Kim Đan, truyền thừa Huyết Nguyệt, hạ Huyết Long Quân và đủ thân phận nội môn để điều tra ma tu.',
      descriptionEn:
        'Requires Golden Core, Blood Moon inheritance, Huyết Long Quân defeat, and inner-disciple standing.',
    },
    requiredRealmKey: 'kim_dan',
    requiredRealmOrder: 3,
    mainQuestChainKey: 'phase21_chapter_05_main',
    mainQuestKeys: [
      'phase21_ch05_main_01',
      'phase21_ch05_main_02',
      'phase21_ch05_main_03',
      'phase21_ch05_main_04',
      'phase21_ch05_main_05',
    ],
    involvedNpcKeys: ['npc_huyet_la_sat', 'npc_lang_van_sinh', 'npc_han_da'],
    relatedDungeonKeys: ['story_dgn_kim_dan_huyet_thach'],
    relatedBossKeys: ['yeu_vuong_tho_huyet'],
    chapterReward: {
      linhThach: 1_000,
      exp: 4_200,
      congHien: 160,
      items: [{ itemKey: 'huyet_tinh', qty: 2 }],
      achievementKeys: ['phase21_story_chapter_05_complete'],
      titleKeys: ['phase21_title_ma_dao_tham_van'],
    },
    loreSummary:
      'CANON_FROM_STORY_BIBLE: destroyed village, Huyết La Sát, and kill/spare/cooperate moral branch.',
  },
  {
    chapterKey: 'chapter_ngu_hanh_thien_menh',
    order: 6,
    titleVi: 'Ngũ Hành Thiên Mệnh',
    titleEn: 'Five-Element Heavenly Mandate',
    descriptionVi:
      'Ngũ Hành cộng hưởng với Hạt Giống Vô Danh. Tịch Thiên Điện lộ rõ hơn, buộc người chơi phối hợp đồng đội và chọn hướng thiên mệnh.',
    descriptionEn:
      'The Five Elements resonate with the Nameless Seed. Tịch Thiên Điện becomes clearer, forcing teamwork and a first heavenly-mandate choice.',
    unlockCondition: {
      kind: 'multi_gate',
      questKey: 'phase21_ch05_main_05',
      descriptionVi: 'Hoàn thành Ma Tu Xuất Thế, đạt Kim Đan trung kỳ và phá Huyết Thạch.',
      descriptionEn: 'Complete Demonic Cultivator, reach mid Golden Core, and break the Bloodstone seal.',
    },
    unlockGate: {
      requiredRealmKey: 'kim_dan',
      requiredRealmOrder: 3,
      requiredCultivationStage: 5,
      requiredBattlePower: 7_200,
      requiredMainQuestKey: 'phase21_ch05_main_05',
      previousChapterKey: 'chapter_ma_tu_xuat_the',
      requiredStoryFlag: 'story_flag_huyet_la_sat_choice_made',
      requiredDungeonClearKey: 'story_dgn_kim_dan_huyet_thach',
      requiredBossDefeatedKey: 'yeu_vuong_tho_huyet',
      requiredSectRank: 'chan_truyen_du_bi',
      requiredElementalAffinity: 'any',
      runtimeStatus: 'catalog_seeded_runtime_follow_up',
      descriptionVi:
        'Cần Kim Đan trung kỳ, lựa chọn với Huyết La Sát, phá Huyết Thạch và đủ lực chiến cộng hưởng Ngũ Hành.',
      descriptionEn:
        'Requires mid Golden Core, Huyết La Sát choice, Bloodstone clear, and enough power for Five-Element resonance.',
    },
    requiredRealmKey: 'kim_dan',
    requiredRealmOrder: 3,
    mainQuestChainKey: 'phase21_chapter_06_main',
    mainQuestKeys: [
      'phase21_ch06_main_01',
      'phase21_ch06_main_02',
      'phase21_ch06_main_03',
      'phase21_ch06_main_04',
      'phase21_ch06_main_05',
    ],
    involvedNpcKeys: [
      'npc_lang_van_sinh',
      'npc_moc_thanh_y',
      'npc_han_da',
      'npc_to_nguyet_ly',
      'npc_huyet_la_sat',
    ],
    relatedDungeonKeys: ['story_dgn_kim_dan_ngu_hanh_te_dan'],
    relatedBossKeys: ['kim_phach_long_dieu'],
    chapterReward: {
      linhThach: 1_250,
      exp: 5_000,
      congHien: 200,
      items: [{ itemKey: 'skill_book_kim_quang_tram', qty: 1 }],
      achievementKeys: ['phase21_story_chapter_06_complete'],
      titleKeys: ['phase21_title_ngu_hanh_thien_menh'],
    },
    loreSummary:
      'CANON_FROM_STORY_BIBLE + AI_EXPANDED_LORE: Ngũ Hành awakening, party pressure, and the first explicit Tịch Thiên signal.',
  },
  {
    chapterKey: 'chapter_tam_ma_dai_su_ty',
    order: 7,
    titleVi: 'Tâm Ma Của Đại Sư Tỷ',
    titleEn: 'Senior Sister’s Heart Demon',
    descriptionVi:
      'Tịch Linh Chủng trong Mộc Thanh Y thức tỉnh, biến ký ức thành tâm cảnh. Người chơi phải chọn cứu nhanh bằng tài nguyên quý hay chậm rãi luyện thuốc.',
    descriptionEn:
      'The Tịch Linh Seed inside Mộc Thanh Y awakens, turning memories into a mindscape. The player must choose a costly quick rescue or a slower medicine path.',
    unlockCondition: {
      kind: 'multi_gate',
      questKey: 'phase21_ch06_main_05',
      descriptionVi: 'Hoàn thành Ngũ Hành Thiên Mệnh và đạt Nguyên Anh sơ kỳ.',
      descriptionEn: 'Complete Five-Element Heavenly Mandate and reach early Nascent Soul.',
    },
    unlockGate: {
      requiredRealmKey: 'nguyen_anh',
      requiredRealmOrder: 4,
      requiredCultivationStage: 1,
      requiredBattlePower: 11_000,
      requiredMainQuestKey: 'phase21_ch06_main_05',
      previousChapterKey: 'chapter_ngu_hanh_thien_menh',
      requiredStoryFlag: 'story_flag_tich_linh_seed_resonates',
      requiredDungeonClearKey: 'story_dgn_kim_dan_ngu_hanh_te_dan',
      requiredBossDefeatedKey: 'kim_phach_long_dieu',
      requiredSectRank: 'chan_truyen',
      requiredElementalAffinity: 'moc',
      runtimeStatus: 'catalog_seeded_runtime_follow_up',
      descriptionVi:
        'Cần Nguyên Anh, chân truyền, cộng hưởng Mộc hệ và dấu Tịch Linh Chủng đã bộc phát từ tuyến Ngũ Hành.',
      descriptionEn:
        'Requires Nascent Soul, core-disciple standing, Wood resonance, and the Tịch Linh Seed outbreak from the Five-Element arc.',
    },
    requiredRealmKey: 'nguyen_anh',
    requiredRealmOrder: 4,
    mainQuestChainKey: 'moc_thanh_y_arc',
    mainQuestKeys: [
      'nguyen_anh_main_01',
      'nguyen_anh_realm_01',
      'nguyen_anh_sect_01',
      'nguyen_anh_grind_01',
      'nguyen_anh_npc_01',
    ],
    involvedNpcKeys: ['npc_moc_thanh_y', 'npc_lang_van_sinh', 'npc_tich_linh_su_gia'],
    relatedDungeonKeys: ['story_dgn_nguyen_anh_tam_canh_moc_thanh_y'],
    relatedBossKeys: ['cuu_u_yeu_hau'],
    chapterReward: {
      linhThach: 1_450,
      exp: 5_400,
      congHien: 230,
      items: [{ itemKey: 'thanh_lam_dan', qty: 1 }],
      achievementKeys: ['phase21_story_chapter_07_complete'],
      titleKeys: ['phase21_title_thanh_tam_ho_dao'],
    },
    loreSummary:
      'CANON_FROM_STORY_BIBLE: Mộc Thanh Y is tied to Tịch Thiên Điện through Tịch Linh Chủng; AI_EXPANDED_LORE turns that rescue into a gated Nguyên Anh arc.',
  },
  {
    chapterKey: 'chapter_hoa_thien_son_tang_mot',
    order: 8,
    titleVi: 'Hoa Thiên Sơn Tầng Một',
    titleEn: 'Hoa Thiên Mountain First Layer',
    descriptionVi:
      'Phong ấn Hoa Thiên Sơn mở tầng đầu. Lăng Vân Sinh dẫn người chơi chỉnh thần niệm, chống Tịch Linh Pháp Sư và mở Tàng Kinh Các cổ.',
    descriptionEn:
      'The first seal layer of Hoa Thiên Mountain opens. Lăng Vân Sinh guides the player to stabilize divine sense, resist a Tịch Linh mage, and open the ancient scripture hall.',
    unlockCondition: {
      kind: 'multi_gate',
      questKey: 'nguyen_anh_sect_01',
      descriptionVi: 'Cứu tâm cảnh Mộc Thanh Y và đạt Hoá Thần sơ kỳ.',
      descriptionEn: 'Save Mộc Thanh Y’s mindscape and reach early Spirit Transformation.',
    },
    unlockGate: {
      requiredRealmKey: 'hoa_than',
      requiredRealmOrder: 5,
      requiredCultivationStage: 1,
      requiredBattlePower: 16_000,
      requiredMainQuestKey: 'nguyen_anh_sect_01',
      previousChapterKey: 'chapter_tam_ma_dai_su_ty',
      requiredStoryFlag: 'story_flag_moc_thanh_y_seed_stabilized',
      requiredDungeonClearKey: 'story_dgn_nguyen_anh_tam_canh_moc_thanh_y',
      requiredBossDefeatedKey: 'cuu_u_yeu_hau',
      requiredSectRank: 'hoa_thien_ho_phap',
      requiredElementalAffinity: 'any',
      runtimeStatus: 'catalog_seeded_runtime_follow_up',
      descriptionVi:
        'Cần Hoá Thần, thần niệm ổn định, cứu Mộc Thanh Y và đủ tư cách hộ pháp để vào Hoa Thiên Sơn.',
      descriptionEn:
        'Requires Spirit Transformation, stable divine sense, Mộc Thanh Y rescued, and protector standing to enter Hoa Thiên Mountain.',
    },
    requiredRealmKey: 'hoa_than',
    requiredRealmOrder: 5,
    mainQuestChainKey: 'phase21_chapter_08_main',
    mainQuestKeys: [
      'nguyen_anh_main_01',
      'nguyen_anh_realm_01',
      'nguyen_anh_sect_01',
      'nguyen_anh_grind_01',
      'nguyen_anh_npc_01',
    ],
    involvedNpcKeys: ['npc_lang_van_sinh', 'npc_hoa_thien_dao_to', 'npc_tich_thien_dao_chu'],
    relatedDungeonKeys: ['story_dgn_hoa_than_hoa_thien_son_tang_mot'],
    relatedBossKeys: ['cuu_la_thien_de'],
    chapterReward: {
      linhThach: 1_500,
      exp: 5_500,
      congHien: 250,
      items: [{ itemKey: 'van_linh_dan', qty: 1 }],
      achievementKeys: ['phase21_story_chapter_08_complete'],
      titleKeys: ['phase21_title_hoa_thien_ho_phap'],
    },
    loreSummary:
      'CANON_FROM_STORY_BIBLE: Hoa Thiên Sơn is the sect seal/inheritance center; AI_EXPANDED_LORE only specifies the first-layer dungeon beats for Phase 21.',
  },
] as const;

export function storyChapterByKey(chapterKey: string): StoryChapterDef | undefined {
  return STORY_CHAPTERS.find((chapter) => chapter.chapterKey === chapterKey);
}

export function storyChaptersByQuestChain(
  mainQuestChainKey: string,
): readonly StoryChapterDef[] {
  return STORY_CHAPTERS.filter(
    (chapter) => chapter.mainQuestChainKey === mainQuestChainKey,
  );
}

export function storyChaptersUnlockedAtRealm(
  realmOrder: number,
): readonly StoryChapterDef[] {
  return STORY_CHAPTERS.filter((chapter) => chapter.requiredRealmOrder <= realmOrder);
}
