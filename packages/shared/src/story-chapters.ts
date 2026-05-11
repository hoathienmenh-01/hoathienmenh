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

export interface StoryChapterUnlockCondition {
  kind: 'realm' | 'quest_claimed' | 'story_flag';
  realmKey?: string;
  questKey?: string;
  flagKey?: string;
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
    relatedDungeonKeys: ['story_dgn_phamnhan_hau_son'],
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
      'Uses the story-bible onboarding chain: Hoa Thiên admission, Hậu Sơn proof, and the first hint of the Nameless Seed.',
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
      descriptionVi: 'Hoàn thành chương Phàm Nhân Nhập Đạo.',
      descriptionEn: 'Complete Mortal Enters the Dao.',
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
    relatedDungeonKeys: ['story_dgn_luyenkhi_linh_tuyen'],
    relatedBossKeys: ['moc_dinh_co_yeu'],
    chapterReward: {
      linhThach: 320,
      exp: 900,
      congHien: 60,
      items: [{ itemKey: 'linh_lo_dan', qty: 2 }],
      achievementKeys: ['phase21_story_chapter_02_complete'],
      titleKeys: ['phase21_title_linh_can_so_tinh'],
    },
    loreSummary:
      'Anchors spiritual-root teaching, Five Element choice, and the Tịch Linh Chủng foreshadow around Mộc Thanh Y.',
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
      kind: 'quest_claimed',
      questKey: 'phase21_ch02_main_05',
      descriptionVi: 'Hoàn thành chương Linh Căn Thức Tỉnh.',
      descriptionEn: 'Complete Spiritual Root Awakening.',
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
    relatedDungeonKeys: ['story_dgn_luyenkhi_tong_mon_tran'],
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
      'Expands “Ngoại môn còn lửa” into sect contribution, Hàn Dạ rivalry, and party/social tutorial hooks.',
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
      kind: 'quest_claimed',
      questKey: 'phase21_ch03_main_05',
      descriptionVi: 'Hoàn thành chương Tông Môn Sơ Khởi.',
      descriptionEn: 'Complete Sect Foundations.',
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
      'Draws from “Bí cảnh dưới giếng cũ”: old well, Five-Element puzzle, erased Hoa Thiên branch, and inheritance choice.',
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
      kind: 'quest_claimed',
      questKey: 'phase21_ch04_main_05',
      descriptionVi: 'Hoàn thành chương Bí Cảnh Huyết Nguyệt.',
      descriptionEn: 'Complete Blood Moon Secret Realm.',
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
      'Uses “Máu trên thềm đá”: investigate a destroyed village, confront Huyết La Sát, and choose kill/spare/cooperate.',
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
      kind: 'quest_claimed',
      questKey: 'phase21_ch05_main_05',
      descriptionVi: 'Hoàn thành chương Ma Tu Xuất Thế.',
      descriptionEn: 'Complete Demonic Cultivator Emerges.',
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
      'Binds Ngũ Hành awakening, co-op/party pressure, and the first explicit Tịch Thiên signal without resolving late-game twists.',
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
