/**
 * Story chapters — Phase 33.0 Tu Tiên Lộ Quyển II–IV catalog foundation.
 *
 * Layer này KHÔNG đè catalog `STORY_CHAPTERS` (Phase 21 chap 1–8) trong
 * `story-chapters.ts`. Mục tiêu là mở rộng tiến trình cốt truyện Chap 9–27
 * (Quyển II: Tiên Giới Tù Thiên, Quyển III: Thánh Đạo Vấn Thiên, Quyển IV:
 * Bản Nguyên Vĩnh Hằng) ở mức **catalog static** + **runtime hook**.
 *
 * Kiến trúc:
 *   - `STORY_CHAPTERS_V2` — 19 chương Chap 9–27, mỗi chương khai báo:
 *       requiredRealmKey/order, mainNpcKeys, bossKeys, dungeonKeys, mainQuest /
 *       sideQuest / hiddenQuest / dailyQuest / weeklyQuest keys, storyFlagKeys,
 *       endingFlagKeys (Quyển IV), rewardPolicyKey, repeatableAfterClear.
 *   - Helper `phase33ChapterByKey`, `phase33ChaptersByVolume`,
 *     `phase33ChaptersByRealmOrder` để API/UI dùng.
 *
 * Reward policy keys (catalog-only, runtime áp dụng ở phase sau):
 *   - `reward_policy_quyen_ii` — Quyển II: bind reward + daily/weekly cap +
 *     no top item.
 *   - `reward_policy_quyen_iii` — Quyển III: tăng cap cho Thánh Cảnh / Đạo Vực
 *     nhưng cấm grant Tiên Ngọc nạp + cấm Thánh Vị/Đạo Quả miễn phí.
 *   - `reward_policy_quyen_iv` — Quyển IV: endgame, ending route flags, cấm
 *     grant Bản Nguyên Khí/Vĩnh Hằng/Hư Không bừa bãi.
 *
 * Spec: `docs/story/PHASE12_STORY_PROGRESS.md` §Phase 33 + `docs/story/
 * TU_TIEN_LO_QUYEN_II_IV_IMPLEMENTATION_PLAN.md`.
 *
 * Source canon: `docs/story/TU_TIEN_LO_QUYEN_II_TIEN_GIOI.md`,
 * `docs/story/TU_TIEN_LO_QUYEN_III_THANH_DAO_VAN_THIEN.md`,
 * `docs/story/TU_TIEN_LO_QUYEN_IV_BAN_NGUYEN_VINH_HANG.md`.
 */

import { REALMS, realmByKey } from './realms';

export type Phase33VolumeKey =
  | 'quyen_ii_tien_gioi'
  | 'quyen_iii_thanh_dao'
  | 'quyen_iv_ban_nguyen';

export type Phase33RewardPolicyKey =
  | 'reward_policy_quyen_ii'
  | 'reward_policy_quyen_iii'
  | 'reward_policy_quyen_iv';

export interface Phase33RepeatableConfig {
  /** Có daily quest sau khi clear chap. */
  daily: boolean;
  /** Có weekly quest sau khi clear chap. */
  weekly: boolean;
  /** Số lần claim daily/ngày. */
  dailyCap: number;
  /** Số lần claim weekly/tuần. */
  weeklyCap: number;
}

export interface Phase33ChapterDef {
  /** Unique key, format `ch{NN}` (ch09 .. ch27). */
  chapKey: string;
  /** Số chương (9..27) cho UI sort. */
  chapNumber: number;
  /** Volume key. */
  volumeKey: Phase33VolumeKey;
  titleVi: string;
  titleEn: string;
  themeVi: string;
  themeEn: string;
  /** Realm key (match `REALMS[].key`). */
  requiredRealmKey: string;
  /** Realm order (match `REALMS[].order`). Test enforce. */
  requiredRealmOrder: number;
  /** Previous chap key (null nếu là Chap 9 — gate boundary từ Phase 21 chap 8). */
  previousChapKey: string | null;
  /** Next chap key (null nếu là Chap 27 endgame). */
  nextChapKey: string | null;
  /** NPC chính xuất hiện (match `npc_*` key). */
  mainNpcKeys: readonly string[];
  /** Boss chính của chap (match `boss_*` key). */
  bossKeys: readonly string[];
  /** Hệ thống mở khoá sau chap (display + hook). */
  unlocks: readonly string[];
  /** Quest chính tuyến — 5 quest mỗi chap. */
  mainQuestKeys: readonly string[];
  /** Quest phụ — 3 quest mỗi chap. */
  sideQuestKeys: readonly string[];
  /** Quest ẩn / cơ duyên — 1 quest mỗi chap. */
  hiddenQuestKeys: readonly string[];
  /** Daily repeatable sau khi clear (≥ 0). */
  dailyQuestKeys: readonly string[];
  /** Weekly repeatable sau khi clear (≥ 0). */
  weeklyQuestKeys: readonly string[];
  /** Story dungeon templates gắn chap (≥ 1). */
  storyDungeonKeys: readonly string[];
  /** Story flag mới phát sinh trong chap (intro + clear + route + boss). */
  storyFlagKeys: readonly string[];
  /** Ending route flag (chỉ Quyển IV — Chap 26–27). */
  endingFlagKeys: readonly string[];
  /** Dialogue node ids cho chap (Phase 33 dialogue catalog). */
  dialogueNodeKeys: readonly string[];
  /** Reward policy key (xem `Phase33RewardPolicyKey`). */
  rewardPolicyKey: Phase33RewardPolicyKey;
  /** Cấu hình repeatable sau khi clear. */
  repeatableAfterClear: Phase33RepeatableConfig;
  /** Tóm tắt cốt truyện ngắn cho UI tooltip (Vietnamese). */
  summaryVi: string;
  /** English summary (i18n parity). */
  summaryEn: string;
}

function mainQuestKeysFor(chapNumber: number): readonly string[] {
  const padded = String(chapNumber).padStart(2, '0');
  return [
    `q_ch${padded}_main_01`,
    `q_ch${padded}_main_02`,
    `q_ch${padded}_main_03`,
    `q_ch${padded}_main_04`,
    `q_ch${padded}_main_05`,
  ];
}

function sideQuestKeysFor(chapNumber: number): readonly string[] {
  const padded = String(chapNumber).padStart(2, '0');
  return [
    `q_ch${padded}_side_01`,
    `q_ch${padded}_side_02`,
    `q_ch${padded}_side_03`,
  ];
}

function hiddenQuestKeysFor(chapNumber: number): readonly string[] {
  const padded = String(chapNumber).padStart(2, '0');
  return [`q_ch${padded}_hidden_01`];
}

function dailyQuestKeysFor(chapNumber: number): readonly string[] {
  const padded = String(chapNumber).padStart(2, '0');
  return [`q_ch${padded}_daily_01`];
}

function weeklyQuestKeysFor(chapNumber: number): readonly string[] {
  const padded = String(chapNumber).padStart(2, '0');
  return [`q_ch${padded}_weekly_01`];
}

function rewardPolicyFor(volume: Phase33VolumeKey): Phase33RewardPolicyKey {
  switch (volume) {
    case 'quyen_ii_tien_gioi':
      return 'reward_policy_quyen_ii';
    case 'quyen_iii_thanh_dao':
      return 'reward_policy_quyen_iii';
    case 'quyen_iv_ban_nguyen':
      return 'reward_policy_quyen_iv';
  }
}

const QUYEN_II_TIEN_GIOI: ReadonlyArray<
  Omit<
    Phase33ChapterDef,
    | 'mainQuestKeys'
    | 'sideQuestKeys'
    | 'hiddenQuestKeys'
    | 'dailyQuestKeys'
    | 'weeklyQuestKeys'
    | 'rewardPolicyKey'
    | 'volumeKey'
    | 'repeatableAfterClear'
  >
> = [
  {
    chapKey: 'ch09',
    chapNumber: 9,
    titleVi: 'Cửu Trọng Thiên Kiếp',
    titleEn: 'Nine-Layer Heavenly Tribulation',
    themeVi: 'Vượt Cửu Trọng Thiên Kiếp khi Tịch Thiên Ấn lén cắm ngầm dưới linh mạch.',
    themeEn: 'Cross the nine-layer tribulation while a Tịch Thiên seal sabotages the spirit vein.',
    requiredRealmKey: 'do_kiep',
    requiredRealmOrder: 9,
    previousChapKey: null,
    nextChapKey: 'ch10',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_moc_thanh_y',
      'npc_han_da',
      'npc_huyet_la_sat',
    ],
    bossKeys: ['boss_thien_kiep_hoa_than'],
    unlocks: [
      'Cửu Trọng Kiếp Đài',
      'Tiên Giới (foundation)',
      'Tiên Thạch sơ cấp',
      'Tiên Khí sơ cấp',
    ],
    storyDungeonKeys: ['ch09_cuu_trong_thien_kiep'],
    storyFlagKeys: [
      'flag_ch09_intro',
      'flag_ch09_tichthien_an_found',
      'flag_ch09_cleared',
      'flag_ch10_unlocked',
      'route_ch09_inner_demon_resolved',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch09_intro',
      'dlg_ch09_preboss',
      'dlg_ch09_postboss',
      'dlg_ch09_choice',
    ],
    summaryVi:
      'Lăng Vân Sinh phát hiện Tịch Thiên Ấn dưới linh mạch ngay khi Cửu Trọng Thiên Kiếp tụ. Người chơi vừa vượt kiếp vừa chống Thiên Kiếp Hóa Thân biến hình từ chính lỗi lầm cũ.',
    summaryEn:
      'Lăng Vân Sinh detects a Tịch Thiên seal under the spirit vein as the nine-layer tribulation gathers. The player crosses heavenly tribulation while battling the Tribulation Avatar built from their own past sins.',
  },
  {
    chapKey: 'ch10',
    chapNumber: 10,
    titleVi: 'Phi Thăng Doanh',
    titleEn: 'Ascension Camp',
    themeVi: 'Phi thăng giả bị Tiên Đình lùa vào trại lao động, thuế tài nguyên, xiềng luật.',
    themeEn: 'Ascendants are herded into Tiên Đình labor camps with resource taxes and law chains.',
    requiredRealmKey: 'nhan_tien',
    requiredRealmOrder: 10,
    previousChapKey: 'ch09',
    nextChapKey: 'ch11',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_to_nguyet_ly',
      'npc_luc_binh',
      'npc_van_kim_nuong',
    ],
    bossKeys: ['boss_tien_gioi_giam_cong'],
    unlocks: [
      'Danh vọng Phi Thăng Giả',
      'Shop Phi Thăng Doanh',
      'Phân biệt Tiên Đình / Phản Tiên Đình (sơ cấp)',
    ],
    storyDungeonKeys: ['ch10_phi_thang_doanh_mine_break'],
    storyFlagKeys: [
      'flag_ch10_intro',
      'flag_ch10_doanh_truong_seen',
      'flag_ch10_cleared',
      'flag_ch11_unlocked',
      'route_ch10_saved_prisoners',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch10_intro',
      'dlg_ch10_preboss',
      'dlg_ch10_postboss',
      'dlg_ch10_choice',
    ],
    summaryVi:
      'Phi Thăng Doanh là trại lao động Tiên Đình. Người chơi chọn phá xiềng giải phóng phi thăng giả hay nhập Tiên Đình để thăng tiến nội bộ.',
    summaryEn:
      'The Ascension Camp is a Tiên Đình labor zone. The player chooses between breaking the chains for fellow ascendants or joining Tiên Đình for internal advancement.',
  },
  {
    chapKey: 'ch11',
    chapNumber: 11,
    titleVi: 'Tiểu Tiên Mạch Đầu Tiên',
    titleEn: 'First Minor Immortal Vein',
    themeVi: 'Đặt nền móng Phân Điện Hoa Thiên đầu tiên trên Tiên Giới, đối đầu Địa Mạch Tiên Thú.',
    themeEn: 'Build the first Hoa Thiên branch palace in Tiên Giới and face the Earth Vein Beast.',
    requiredRealmKey: 'dia_tien',
    requiredRealmOrder: 11,
    previousChapKey: 'ch10',
    nextChapKey: 'ch12',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_moc_thanh_y',
      'npc_to_nguyet_ly',
    ],
    bossKeys: ['boss_dia_mach_tien_thu'],
    unlocks: [
      'Tiên Phủ',
      'Phân Điện Hoa Thiên Tiên Giới',
      'Tiên Mạch khai thác sơ cấp',
    ],
    storyDungeonKeys: ['ch11_tieu_tien_mach_guardian'],
    storyFlagKeys: [
      'flag_ch11_intro',
      'flag_ch11_mach_secured',
      'flag_ch11_cleared',
      'flag_ch12_unlocked',
      'route_ch11_branch_palace_built',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch11_intro',
      'dlg_ch11_preboss',
      'dlg_ch11_postboss',
    ],
    summaryVi:
      'Hoa Thiên Môn cần một Tiểu Tiên Mạch để dựng Phân Điện. Địa Mạch Tiên Thú là chủ rừng tiên cũ, không phải kẻ thù tự nhiên — người chơi chọn đàm hay diệt.',
    summaryEn:
      'Hoa Thiên needs a minor immortal vein to establish a branch palace. The Earth Vein Beast is not a natural enemy — the player chooses parley or kill.',
  },
  {
    chapKey: 'ch12',
    chapNumber: 12,
    titleVi: 'Thiên Môn Không Mở Cho Kẻ Nghèo',
    titleEn: 'The Heavenly Gate Does Not Open to the Poor',
    themeVi: 'Tiên Đình chặn Tiên Thuật trừ người nộp đủ thuế — người chơi gia nhập Phản Tiên Đình.',
    themeEn: 'Tiên Đình locks immortal arts behind a tax wall; the player joins the counter-court.',
    requiredRealmKey: 'thien_tien',
    requiredRealmOrder: 12,
    previousChapKey: 'ch11',
    nextChapKey: 'ch13',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_han_da',
      'npc_luc_binh',
      'npc_van_kim_nuong',
    ],
    bossKeys: ['boss_thien_mon_thu_tuong'],
    unlocks: [
      'Tiên Thuật',
      'Faction Tiên Đình',
      'Faction Phản Tiên Đình',
      'Thiên Môn thí luyện',
    ],
    storyDungeonKeys: ['ch12_thien_mon_trial'],
    storyFlagKeys: [
      'flag_ch12_intro',
      'flag_ch12_trial_passed',
      'flag_ch12_cleared',
      'flag_ch13_unlocked',
      'route_ch12_anti_tien_dinh',
      'route_ch12_tien_dinh',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch12_intro',
      'dlg_ch12_preboss',
      'dlg_ch12_postboss',
      'dlg_ch12_choice',
    ],
    summaryVi:
      'Thiên Môn Thủ Tướng đại diện luật chặn người nghèo. Người chơi chọn gia nhập Phản Tiên Đình (chính tuyến) hoặc cúi đầu Tiên Đình để thăng tiến trá hình.',
    summaryEn:
      'The Gate Marshal embodies the law that blocks the poor. The player joins the Counter Tiên Đình (canonical path) or bows to Tiên Đình for an alternate political route.',
  },
  {
    chapKey: 'ch13',
    chapNumber: 13,
    titleVi: 'Sử Sách Bị Xóa',
    titleEn: 'Histories Erased',
    themeVi: 'Hoa Thiên Tiên Vực bị xóa khỏi sử Tiên Giới; người chơi khôi phục truyền thừa cổ.',
    themeEn: 'The Hoa Thiên Immortal Domain is erased from Tiên Giới history; the player recovers lost lineage.',
    requiredRealmKey: 'huyen_tien',
    requiredRealmOrder: 13,
    previousChapKey: 'ch12',
    nextChapKey: 'ch14',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_to_nguyet_ly',
      'npc_hoa_thien_dao_to',
    ],
    bossKeys: ['boss_huyen_co_khoi_loi'],
    unlocks: [
      'Di tích Tiên Vực',
      'Cổ truyền thừa Hoa Thiên',
      'Pháp tắc sơ cấp foundation',
    ],
    storyDungeonKeys: ['ch13_thu_kho_cam'],
    storyFlagKeys: [
      'flag_ch13_intro',
      'flag_ch13_thu_kho_opened',
      'flag_ch13_cleared',
      'flag_ch14_unlocked',
      'route_ch13_lineage_restored',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch13_intro',
      'dlg_ch13_preboss',
      'dlg_ch13_postboss',
    ],
    summaryVi:
      'Thư Khố Cấm còn lưu dấu Hoa Thiên Tiên Vực. Huyền Cơ Khôi Lỗi canh giữ; phá nó người chơi nhận tàn ảnh Hoa Thiên Đạo Tổ.',
    summaryEn:
      'The forbidden archive still holds the Hoa Thiên Domain’s mark. The Mechanism Puppet guards it; defeat reveals a remnant of the Hoa Thiên Patriarch.',
  },
  {
    chapKey: 'ch14',
    chapNumber: 14,
    titleVi: 'Kim Thân Bất Hủ',
    titleEn: 'Indestructible Golden Body',
    themeVi: 'Luyện Kim Thân — nền tảng chống pháp tắc cao cấp; đối đầu Kim Giáp Tiên Quan.',
    themeEn: 'Forge the Golden Body — a foundation against higher law; face the Golden Guard.',
    requiredRealmKey: 'kim_tien',
    requiredRealmOrder: 14,
    previousChapKey: 'ch13',
    nextChapKey: 'ch15',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_moc_thanh_y',
      'npc_han_da',
    ],
    bossKeys: ['boss_kim_giap_tien_quan'],
    unlocks: [
      'Kim Thân',
      'Tiên Khí cao',
      'Set Tiên Khí cơ bản',
    ],
    storyDungeonKeys: ['ch14_kim_than_tri'],
    storyFlagKeys: [
      'flag_ch14_intro',
      'flag_ch14_kim_than_forged',
      'flag_ch14_cleared',
      'flag_ch15_unlocked',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch14_intro',
      'dlg_ch14_preboss',
      'dlg_ch14_postboss',
    ],
    summaryVi:
      'Kim Thân Trì là thử thách thân thể — đánh bại Kim Giáp Tiên Quan, người chơi mở Kim Thân để đỡ pháp tắc tầng cao.',
    summaryEn:
      'The Golden Body Pool tests the body. Defeating the Golden Guard unlocks the Golden Body to withstand high-tier law.',
  },
  {
    chapKey: 'ch15',
    chapNumber: 15,
    titleVi: 'Thái Ất Tranh Pháp',
    titleEn: 'Tai Yi Law Contest',
    themeVi: 'Tranh pháp tắc sơ cấp với Thái Ất Pháp Linh; mở set Tiên Khí và pháp tắc nguyên thủy.',
    themeEn: 'Contest primary law against the Tai Yi Spirit; open primal law and Tiên Khí sets.',
    requiredRealmKey: 'thai_at_kim_tien',
    requiredRealmOrder: 15,
    previousChapKey: 'ch14',
    nextChapKey: 'ch16',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_han_da',
      'npc_to_nguyet_ly',
    ],
    bossKeys: ['boss_thai_at_phap_linh'],
    unlocks: [
      'Pháp tắc sơ cấp',
      'Set Tiên Khí Thái Ất',
      'Đại La Đạo Quả preview',
    ],
    storyDungeonKeys: ['ch15_thai_at_phap_linh'],
    storyFlagKeys: [
      'flag_ch15_intro',
      'flag_ch15_phap_seed_obtained',
      'flag_ch15_cleared',
      'flag_ch16_unlocked',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch15_intro',
      'dlg_ch15_preboss',
      'dlg_ch15_postboss',
    ],
    summaryVi:
      'Người chơi tranh đoạt mảnh pháp tắc đầu tiên từ Thái Ất Pháp Linh. Mảnh này là tiền đề cho Đại La Đạo Quả.',
    summaryEn:
      'The player wrests the first law fragment from the Tai Yi Spirit. The shard seeds the Da Luo Dao Fruit.',
  },
  {
    chapKey: 'ch16',
    chapNumber: 16,
    titleVi: 'Đại La Bất Diệt',
    titleEn: 'Da Luo Imperishable',
    themeVi: 'Bạch Đế Tử lộ diện; người chơi hoàn chỉnh Đại La Đạo Quả, mở đường Chuẩn Thánh.',
    themeEn: 'Bạch Đế Tử reveals himself; the player completes the Da Luo Dao Fruit and unlocks the Saint path.',
    requiredRealmKey: 'dai_la_kim_tien',
    requiredRealmOrder: 16,
    previousChapKey: 'ch15',
    nextChapKey: 'ch17',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_moc_thanh_y',
      'npc_han_da',
      'npc_to_nguyet_ly',
      'npc_huyet_la_sat',
    ],
    bossKeys: ['boss_bach_de_tu'],
    unlocks: [
      'Đạo Quả Đại La',
      'Chuẩn Thánh path',
      'Quyển III gate',
    ],
    storyDungeonKeys: ['ch16_bach_de_final'],
    storyFlagKeys: [
      'flag_ch16_intro',
      'flag_ch16_bach_de_truth',
      'flag_ch16_cleared',
      'flag_volume_ii_cleared',
      'flag_volume_iii_unlocked',
      'route_ch16_saved_prisoners',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch16_intro',
      'dlg_ch16_preboss',
      'dlg_ch16_postboss',
      'dlg_ch16_choice',
    ],
    summaryVi:
      'Bạch Đế Tử là cánh tay Tịch Thiên Điện trong Tiên Giới. Đánh bại y, người chơi hoàn chỉnh Đạo Quả Đại La, bước vào Chuẩn Thánh và mở Quyển III.',
    summaryEn:
      'Bạch Đế Tử is Tịch Thiên Điện’s envoy in Tiên Giới. Defeating him completes the Da Luo Dao Fruit and unlocks Quyển III.',
  },
];

const QUYEN_III_THANH_DAO: ReadonlyArray<
  Omit<
    Phase33ChapterDef,
    | 'mainQuestKeys'
    | 'sideQuestKeys'
    | 'hiddenQuestKeys'
    | 'dailyQuestKeys'
    | 'weeklyQuestKeys'
    | 'rewardPolicyKey'
    | 'volumeKey'
    | 'repeatableAfterClear'
  >
> = [
  {
    chapKey: 'ch17',
    chapNumber: 17,
    titleVi: 'Trảm Tam Niệm',
    titleEn: 'Sever the Three Thoughts',
    themeVi: 'Trảm Tham/Sợ/Chấp để vượt Chuẩn Thánh; sai một niệm → debuff tâm ma vĩnh viễn.',
    themeEn: 'Sever Greed/Fear/Attachment to pass Saint-aspirant; one wrong cut leaves permanent debuff.',
    requiredRealmKey: 'chuan_thanh',
    requiredRealmOrder: 17,
    previousChapKey: 'ch16',
    nextChapKey: 'ch18',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_moc_thanh_y',
      'npc_han_da',
      'npc_huyet_la_sat',
    ],
    bossKeys: ['boss_tam_niem_hoa_than'],
    unlocks: [
      'Tam Niệm passive đạo tâm',
      'Thánh Cảnh dungeon',
      'Tam Niệm Đài map',
    ],
    storyDungeonKeys: ['ch17_tam_niem_dai'],
    storyFlagKeys: [
      'flag_ch17_intro',
      'flag_ch17_niem_tham_resolved',
      'flag_ch17_niem_so_resolved',
      'flag_ch17_niem_chap_resolved',
      'flag_ch17_cleared',
      'flag_ch18_unlocked',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch17_intro',
      'dlg_ch17_preboss',
      'dlg_ch17_postboss',
      'dlg_ch17_choice',
    ],
    summaryVi:
      'Đại La Đạo Quả rạn nứt. Người chơi vào Tam Niệm Đài, đối diện Tham/Sợ/Chấp dưới hình Tam Niệm Hóa Thân, chọn trảm niệm → passive vĩnh viễn.',
    summaryEn:
      'The Da Luo Dao Fruit fractures. The player enters the Three Thoughts Platform, confronting Greed/Fear/Attachment as the Avatar and choosing one cut for a permanent passive.',
  },
  {
    chapKey: 'ch18',
    chapNumber: 18,
    titleVi: 'Lập Đạo Không Quỳ Trời',
    titleEn: 'Found a Dao Without Kneeling to Heaven',
    themeVi: 'Chọn đạo hiệu, lập Thánh vị, đối đầu Tịch Thiên Pháp Tướng và Thành Thánh Kiếp.',
    themeEn: 'Choose a dao title, claim sainthood, face the Tịch Thiên Dharma Avatar and the Saint Tribulation.',
    requiredRealmKey: 'thanh_nhan',
    requiredRealmOrder: 18,
    previousChapKey: 'ch17',
    nextChapKey: 'ch19',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_tich_thien_thanh_su',
      'npc_to_nguyet_ly',
    ],
    bossKeys: ['boss_tich_thien_phap_tuong'],
    unlocks: [
      'Lập Đạo',
      'Thánh vị',
      'Tín Ngưỡng currency (cap)',
      'Đạo hiệu',
    ],
    storyDungeonKeys: ['ch18_thanh_nhan_kiep'],
    storyFlagKeys: [
      'flag_ch18_intro',
      'flag_ch18_dao_hieu_chosen',
      'flag_ch18_tin_nguong_returned',
      'flag_ch18_cleared',
      'flag_ch19_unlocked',
      'route_ch18_thanh_doc_lap',
      'route_ch18_thanh_lien_minh',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch18_intro',
      'dlg_ch18_preboss',
      'dlg_ch18_postboss',
      'dlg_ch18_choice',
    ],
    summaryVi:
      'Người chơi chọn đạo hiệu, đối đầu Thành Thánh Kiếp và Tịch Thiên Pháp Tướng. Tín ngưỡng có thể nhận, giảm, hoặc trao lại — ảnh hưởng đạo vực sau này.',
    summaryEn:
      'The player picks a dao title, weathering the Saint Tribulation and the Tịch Thiên Avatar. Faith can be received, reduced, or returned — affecting future dao domains.',
  },
  {
    chapKey: 'ch19',
    chapNumber: 19,
    titleVi: 'Hỗn Nguyên Quy Nhất',
    titleEn: 'Primordial Unification',
    themeVi: 'Hợp nhất pháp tắc tại Hỗn Nguyên Chi Hải, ổn định Đạo Liên Hoa Thiên.',
    themeEn: 'Fuse laws at the Primordial Sea, stabilizing the Hoa Thiên Dao Lotus.',
    requiredRealmKey: 'hon_nguyen',
    requiredRealmOrder: 19,
    previousChapKey: 'ch18',
    nextChapKey: 'ch20',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_moc_thanh_y',
      'npc_hoa_thien_dao_to',
    ],
    bossKeys: ['boss_hon_nguyen_co_thu'],
    unlocks: [
      'Hợp nhất pháp tắc (sơ cấp)',
      'Hỗn Nguyên Chi Hải map',
      'Đạo Liên Hoa Thiên foundation',
    ],
    storyDungeonKeys: ['ch19_hon_nguyen_chi_hai'],
    storyFlagKeys: [
      'flag_ch19_intro',
      'flag_ch19_co_thu_calmed',
      'flag_ch19_cleared',
      'flag_ch20_unlocked',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch19_intro',
      'dlg_ch19_preboss',
      'dlg_ch19_postboss',
    ],
    summaryVi:
      'Hỗn Nguyên Cổ Thú là thẩm phán pháp tắc nguyên thủy. Người chơi thuyết phục hoặc đánh bại nó để hợp nhất pháp tắc lần đầu.',
    summaryEn:
      'The Primordial Beast judges fused laws. The player persuades or defeats it to achieve the first stable law fusion.',
  },
  {
    chapKey: 'ch20',
    chapNumber: 20,
    titleVi: 'Một Đạo Vực, Vạn Sinh Linh',
    titleEn: 'One Dao Domain, Ten Thousand Lives',
    themeVi: 'Mở Đạo Vực Hoa Thiên — quản lý vạn sinh linh; chọn luật mềm hay luật sắt.',
    themeEn: 'Open the Hoa Thiên Dao Domain — govern ten thousand lives; soft law or iron law.',
    requiredRealmKey: 'dao_quan',
    requiredRealmOrder: 20,
    previousChapKey: 'ch19',
    nextChapKey: 'ch21',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_to_nguyet_ly',
      'npc_dao_vuc_chi_tam',
    ],
    bossKeys: ['boss_dao_quan_doi_lap'],
    unlocks: [
      'Đạo Vực management foundation',
      'Quân Đoàn Hoa Thiên',
      'Server event hook (Đạo Vực)',
    ],
    storyDungeonKeys: ['ch20_dao_vuc_tai_ach'],
    storyFlagKeys: [
      'flag_ch20_intro',
      'flag_ch20_dao_vuc_opened',
      'flag_ch20_cleared',
      'flag_ch21_unlocked',
      'route_ch20_luat_mem',
      'route_ch20_luat_sat',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch20_intro',
      'dlg_ch20_preboss',
      'dlg_ch20_postboss',
      'dlg_ch20_choice',
    ],
    summaryVi:
      'Người chơi mở Đạo Vực Hoa Thiên đầu tiên. Chọn luật mềm (nương theo sinh linh) hoặc luật sắt (răn đe). Đạo Vực Tai Ách là phép thử nội tại.',
    summaryEn:
      'The player opens the first Hoa Thiên Dao Domain. Choose soft law or iron law; the Calamity is the internal trial.',
  },
  {
    chapKey: 'ch21',
    chapNumber: 21,
    titleVi: 'Ta Là Trời Hay Trời Là Ta',
    titleEn: 'Am I Heaven, or Is Heaven Me?',
    themeVi: 'Thiên Đạo quyền năng foundation; Thiên Đạo Bản Ngã bị ăn mòn và Tịch Thiên Thánh Sứ chân thân.',
    themeEn: 'Heavenly Dao power foundation; the corrupted Heaven Ego and Tịch Thiên Saint Envoy real body.',
    requiredRealmKey: 'thien_dao',
    requiredRealmOrder: 21,
    previousChapKey: 'ch20',
    nextChapKey: 'ch22',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_tich_thien_thanh_su',
      'npc_hoa_thien_dao_to',
    ],
    bossKeys: ['boss_tich_thien_thanh_su_chan_than'],
    unlocks: [
      'Thiên Đạo quyền năng (foundation)',
      'Thế Giới Chi Tâm map',
      'Quyển IV gate',
    ],
    storyDungeonKeys: ['ch21_thien_dao_ban_nga'],
    storyFlagKeys: [
      'flag_ch21_intro',
      'flag_ch21_ban_nga_cleansed',
      'flag_ch21_thanh_su_truth',
      'flag_ch21_cleared',
      'flag_volume_iii_cleared',
      'flag_volume_iv_unlocked',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch21_intro',
      'dlg_ch21_preboss',
      'dlg_ch21_postboss',
      'dlg_ch21_choice',
    ],
    summaryVi:
      'Người chơi đối diện Thiên Đạo Bản Ngã đã bị Tịch Thiên Điện ăn mòn, lộ chân thân Tịch Thiên Thánh Sứ. Đây là ngưỡng mở Quyển IV.',
    summaryEn:
      'The player confronts the Heaven Ego corrupted by Tịch Thiên Điện, revealing the Saint Envoy’s true body. This opens Quyển IV.',
  },
];

const QUYEN_IV_BAN_NGUYEN: ReadonlyArray<
  Omit<
    Phase33ChapterDef,
    | 'mainQuestKeys'
    | 'sideQuestKeys'
    | 'hiddenQuestKeys'
    | 'dailyQuestKeys'
    | 'weeklyQuestKeys'
    | 'rewardPolicyKey'
    | 'volumeKey'
    | 'repeatableAfterClear'
  >
> = [
  {
    chapKey: 'ch22',
    chapNumber: 22,
    titleVi: 'Trở Về Nơi Sinh Ra Đạo',
    titleEn: 'Return to Where the Dao Was Born',
    themeVi: 'Bản Nguyên Hải đang bị ăn mòn; Đạo Liên héo úa; sửa nguồn cung pháp tắc.',
    themeEn: 'The Origin Sea is being eroded; the Dao Lotus withers; repair the law supply.',
    requiredRealmKey: 'ban_nguyen',
    requiredRealmOrder: 22,
    previousChapKey: 'ch21',
    nextChapKey: 'ch23',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_nguyen_linh_nu',
      'npc_hoa_thien_dao_to',
    ],
    bossKeys: ['boss_ban_nguyen_thu'],
    unlocks: [
      'Bản Nguyên Hải map',
      'Bản Nguyên Khí (capped)',
      'Đạo Liên tiến hóa',
      'Endgame crafting tier 1',
    ],
    storyDungeonKeys: ['ch22_ban_nguyen_hai'],
    storyFlagKeys: [
      'flag_ch22_intro',
      'flag_ch22_dao_lien_stabilized',
      'flag_ch22_cleared',
      'flag_ch23_unlocked',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch22_intro',
      'dlg_ch22_preboss',
      'dlg_ch22_postboss',
    ],
    summaryVi:
      'Người chơi bước vào Bản Nguyên Hải — nơi sinh ra pháp tắc. Bản Nguyên Thú vừa là kẻ thù vừa là chứng nhân; chiến thắng đưa Đạo Liên Hoa Thiên tiến hóa.',
    summaryEn:
      'The player enters the Origin Sea — birthplace of law. The Origin Beast is enemy and witness; victory evolves the Hoa Thiên Dao Lotus.',
  },
  {
    chapKey: 'ch23',
    chapNumber: 23,
    titleVi: 'Đạo Ngoài Đạo',
    titleEn: 'A Dao Beyond Dao',
    themeVi: 'Phát hiện quy luật ngoài Thiên Đạo; Huyền Huyền Cổ Bi và Vô Tướng Đạo Ảnh.',
    themeEn: 'Discover laws beyond Heaven; the Mystery Stele and Formless Dao Shadow.',
    requiredRealmKey: 'huyen_huyen',
    requiredRealmOrder: 23,
    previousChapKey: 'ch22',
    nextChapKey: 'ch24',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_huyen_huyen_giam_quan',
      'npc_to_nguyet_ly',
    ],
    bossKeys: ['boss_vo_tuong_dao_anh'],
    unlocks: [
      'Huyền Huyền Cổ Bi map',
      'Ngoại Đạo modifier (PvE only)',
      'Build siêu hiếm có điều kiện',
    ],
    storyDungeonKeys: ['ch23_huyen_huyen_co_bi'],
    storyFlagKeys: [
      'flag_ch23_intro',
      'flag_ch23_co_bi_read',
      'flag_ch23_cleared',
      'flag_ch24_unlocked',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch23_intro',
      'dlg_ch23_preboss',
      'dlg_ch23_postboss',
    ],
    summaryVi:
      'Huyền Huyền Cổ Bi cho mỗi người một câu khác nhau. Vô Tướng Đạo Ảnh là bóng của câu trả lời người chơi né tránh.',
    summaryEn:
      'The Mystery Stele shows a different sentence to each viewer. The Formless Dao Shadow is the answer the player avoids.',
  },
  {
    chapKey: 'ch24',
    chapNumber: 24,
    titleVi: 'Không Có Khởi Đầu',
    titleEn: 'No Beginning',
    themeVi: 'Thời gian luân hải bị bẻ cong; ký ức và vòng lặp; Thời Gian Tàn Ảnh.',
    themeEn: 'Time loops bend; memories and cycles; the Time Remnant.',
    requiredRealmKey: 'vo_thuy',
    requiredRealmOrder: 24,
    previousChapKey: 'ch23',
    nextChapKey: 'ch25',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_vo_thuy_lao_nhan',
      'npc_moc_thanh_y',
    ],
    bossKeys: ['boss_thoi_gian_tan_anh'],
    unlocks: [
      'Thời Gian Luân Hải map',
      'Thời Gian dungeon',
      'Ký ức và vòng lặp mechanic foundation',
    ],
    storyDungeonKeys: ['ch24_thoi_gian_luan_hai'],
    storyFlagKeys: [
      'flag_ch24_intro',
      'flag_ch24_vong_lap_broken',
      'flag_ch24_cleared',
      'flag_ch25_unlocked',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch24_intro',
      'dlg_ch24_preboss',
      'dlg_ch24_postboss',
    ],
    summaryVi:
      'Vô Thủy Lão Nhân tiết lộ khởi đầu của người chơi không ở Thanh Khê. Thời Gian Tàn Ảnh là phiên bản đã sai của chính người chơi.',
    summaryEn:
      'The Elder of No-Beginning reveals the player’s true origin was not Thanh Khe. The Time Remnant is a wrong version of the player.',
  },
  {
    chapKey: 'ch25',
    chapNumber: 25,
    titleVi: 'Không Có Kết Thúc',
    titleEn: 'No Ending',
    themeVi: 'Tương lai chiến trường; Vô Chung Chi Môn; định mệnh currency có cap.',
    themeEn: 'Future battlefields; the Endless Gate; capped destiny currency.',
    requiredRealmKey: 'vo_chung',
    requiredRealmOrder: 25,
    previousChapKey: 'ch24',
    nextChapKey: 'ch26',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_vo_chung_dong_tu',
      'npc_tich_thien_thanh_su',
    ],
    bossKeys: ['boss_vo_chung_chi_mon'],
    unlocks: [
      'Tương lai chiến trường map',
      'Định mệnh currency (capped)',
      'Vô Chung Chi Môn',
    ],
    storyDungeonKeys: ['ch25_vo_chung_chi_mon'],
    storyFlagKeys: [
      'flag_ch25_intro',
      'flag_ch25_tichthien_future_seen',
      'flag_ch25_cleared',
      'flag_ch26_unlocked',
    ],
    endingFlagKeys: [],
    dialogueNodeKeys: [
      'dlg_ch25_intro',
      'dlg_ch25_preboss',
      'dlg_ch25_postboss',
    ],
    summaryVi:
      'Vô Chung Chi Môn cho người chơi nhìn tương lai. Tịch Thiên trong tương lai đã trở thành Vô Đạo Chung; người chơi phải tìm cách bẻ định mệnh đó.',
    summaryEn:
      'The Endless Gate shows the future where Tịch Thiên has become the Without-Dao Bell. The player must bend that destiny.',
  },
  {
    chapKey: 'ch26',
    chapNumber: 26,
    titleVi: 'Vĩnh Hằng Không Phải Bất Tử',
    titleEn: 'Eternity Is Not Immortality',
    themeVi: 'Đối đầu Tịch Thiên Đạo Chủ; lựa chọn ending route Tịch Thiên/Đạo Liên/Vô Đạo Chung.',
    themeEn: 'Face the Tịch Thiên Dao Master; choose the Tịch Thiên / Dao Lotus / Without-Dao ending route.',
    requiredRealmKey: 'vinh_hang',
    requiredRealmOrder: 26,
    previousChapKey: 'ch25',
    nextChapKey: 'ch27',
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_tich_thien_dao_chu',
      'npc_hoa_thien_dao_to',
    ],
    bossKeys: ['boss_tich_thien_dao_chu'],
    unlocks: [
      'Vĩnh Hằng Đạo Nguyên',
      'Tịch Thiên ending route foundation',
      'Đạo Liên ending route foundation',
    ],
    storyDungeonKeys: ['ch26_tich_thien_dao_chu'],
    storyFlagKeys: [
      'flag_ch26_intro',
      'flag_ch26_tichthien_truth_full',
      'flag_ch26_cleared',
      'flag_ch27_unlocked',
    ],
    endingFlagKeys: [
      'ending_tich_thien_tan_uoc',
      'ending_van_dao_tu_do',
      'ending_hoa_thien_phuc_sinh',
    ],
    dialogueNodeKeys: [
      'dlg_ch26_intro',
      'dlg_ch26_preboss',
      'dlg_ch26_postboss',
      'dlg_ch26_choice',
    ],
    summaryVi:
      'Tịch Thiên Đạo Chủ tiết lộ Vô Đạo Chung là kẻ ăn mòn quy tắc. Người chơi chọn tân ước với Tịch Thiên, giải phóng vạn đạo, hoặc phục sinh Hoa Thiên.',
    summaryEn:
      'The Tịch Thiên Dao Master reveals the Without-Dao Bell consumes laws. The player chooses a new pact, free all daos, or revive Hoa Thiên.',
  },
  {
    chapKey: 'ch27',
    chapNumber: 27,
    titleVi: 'Hoa Thiên Nở Trong Hư Không',
    titleEn: 'Hoa Thiên Blooms in the Void',
    themeVi: 'Cuối Quyển IV; Vô Đạo Chung; Hư Không Ngoại Vực; seasonal universe foundation.',
    themeEn: 'End of Quyển IV; the Without-Dao Bell; Void Outer Realm; seasonal universe foundation.',
    requiredRealmKey: 'hu_khong_chi_ton',
    requiredRealmOrder: 27,
    previousChapKey: 'ch26',
    nextChapKey: null,
    mainNpcKeys: [
      'npc_lang_van_sinh',
      'npc_hoa_thien_dao_to',
      'npc_tich_thien_dao_chu',
    ],
    bossKeys: ['boss_vo_dao_chung'],
    unlocks: [
      'Hư Không Ngoại Vực',
      'Seasonal universe foundation',
      'Endgame ending route runtime hook',
    ],
    storyDungeonKeys: ['ch27_vo_dao_chung'],
    storyFlagKeys: [
      'flag_ch27_intro',
      'flag_ch27_vo_dao_chung_sealed',
      'flag_ch27_cleared',
      'flag_volume_iv_cleared',
      'flag_endgame_routes_unlocked',
    ],
    endingFlagKeys: [
      'ending_hu_khong_khai_hoa',
      'ending_vo_dao_tram_mac_bad_route',
    ],
    dialogueNodeKeys: [
      'dlg_ch27_intro',
      'dlg_ch27_preboss',
      'dlg_ch27_postboss',
      'dlg_ch27_choice',
    ],
    summaryVi:
      'Hoa Thiên Đạo Tổ tàn ảnh kết hợp người chơi để phong Vô Đạo Chung trong Hư Không. Lựa chọn cuối quyết định Hoa Thiên nở hay rơi vào Hư Không trầm mặc.',
    summaryEn:
      'The Hoa Thiên Patriarch remnant fuses with the player to seal the Without-Dao Bell in the Void. The final choice decides if Hoa Thiên blooms or falls silent.',
  },
];

function defaultRepeatable(): Phase33RepeatableConfig {
  return {
    daily: true,
    weekly: true,
    dailyCap: 1,
    weeklyCap: 1,
  };
}

function expandChapters(
  raw: ReadonlyArray<
    Omit<
      Phase33ChapterDef,
      | 'mainQuestKeys'
      | 'sideQuestKeys'
      | 'hiddenQuestKeys'
      | 'dailyQuestKeys'
      | 'weeklyQuestKeys'
      | 'rewardPolicyKey'
      | 'volumeKey'
      | 'repeatableAfterClear'
    >
  >,
  volumeKey: Phase33VolumeKey,
): readonly Phase33ChapterDef[] {
  return raw.map((chapter) => ({
    ...chapter,
    volumeKey,
    mainQuestKeys: mainQuestKeysFor(chapter.chapNumber),
    sideQuestKeys: sideQuestKeysFor(chapter.chapNumber),
    hiddenQuestKeys: hiddenQuestKeysFor(chapter.chapNumber),
    dailyQuestKeys: dailyQuestKeysFor(chapter.chapNumber),
    weeklyQuestKeys: weeklyQuestKeysFor(chapter.chapNumber),
    rewardPolicyKey: rewardPolicyFor(volumeKey),
    repeatableAfterClear: defaultRepeatable(),
  }));
}

export const STORY_CHAPTERS_V2: readonly Phase33ChapterDef[] = [
  ...expandChapters(QUYEN_II_TIEN_GIOI, 'quyen_ii_tien_gioi'),
  ...expandChapters(QUYEN_III_THANH_DAO, 'quyen_iii_thanh_dao'),
  ...expandChapters(QUYEN_IV_BAN_NGUYEN, 'quyen_iv_ban_nguyen'),
];

export interface Phase33VolumeDef {
  volumeKey: Phase33VolumeKey;
  titleVi: string;
  titleEn: string;
  chapRange: readonly [number, number];
  realmRange: readonly [string, string];
  themeVi: string;
  themeEn: string;
}

export const PHASE33_VOLUMES: readonly Phase33VolumeDef[] = [
  {
    volumeKey: 'quyen_ii_tien_gioi',
    titleVi: 'Quyển II — Tiên Giới Tù Thiên',
    titleEn: 'Volume II — The Caged Heavens',
    chapRange: [9, 16],
    realmRange: ['do_kiep', 'dai_la_kim_tien'],
    themeVi:
      'Phi thăng không phải kết thúc — Tiên Giới là nhà tù cao cấp do Tiên Đình và Tịch Thiên Điện thao túng. Người chơi vạch mặt Bạch Đế Tử và mở đường Chuẩn Thánh.',
    themeEn:
      'Ascension is not the end — Tiên Giới is a high-tier prison run by Tiên Đình and Tịch Thiên Điện. The player exposes Bạch Đế Tử and opens the Saint path.',
  },
  {
    volumeKey: 'quyen_iii_thanh_dao',
    titleVi: 'Quyển III — Thánh Đạo Vấn Thiên',
    titleEn: 'Volume III — Saint Dao Questions Heaven',
    chapRange: [17, 21],
    realmRange: ['chuan_thanh', 'thien_dao'],
    themeVi:
      'Trảm niệm, lập đạo, tín ngưỡng, hợp nhất pháp tắc, đạo vực, Thiên Đạo. Người chơi tự hỏi đạo của mình bảo hộ ai, kiểm soát ai, giải phóng ai.',
    themeEn:
      'Sever thoughts, found a dao, accept faith, fuse laws, govern domains, climb to Heaven. The player asks who their dao guards, controls, or frees.',
  },
  {
    volumeKey: 'quyen_iv_ban_nguyen',
    titleVi: 'Quyển IV — Bản Nguyên Vĩnh Hằng',
    titleEn: 'Volume IV — Eternal Origin',
    chapRange: [22, 27],
    realmRange: ['ban_nguyen', 'hu_khong_chi_ton'],
    themeVi:
      'Bản Nguyên Hải, Ngoại Đạo, thời gian, tương lai, Vĩnh Hằng, Hư Không endgame. Tịch Thiên Đạo Chủ là một nửa sự thật — Vô Đạo Chung ngoài đại đạo đang ăn mòn vạn quy tắc.',
    themeEn:
      'Origin Sea, outer law, time, future, eternity, void endgame. The Tịch Thiên Dao Master is half the truth — the Without-Dao Bell beyond the great dao consumes all laws.',
  },
];

export function phase33ChapterByKey(chapKey: string): Phase33ChapterDef | undefined {
  return STORY_CHAPTERS_V2.find((chapter) => chapter.chapKey === chapKey);
}

export function phase33ChaptersByVolume(
  volumeKey: Phase33VolumeKey,
): readonly Phase33ChapterDef[] {
  return STORY_CHAPTERS_V2.filter((chapter) => chapter.volumeKey === volumeKey);
}

export function phase33ChaptersByRealmOrder(
  realmOrder: number,
): readonly Phase33ChapterDef[] {
  return STORY_CHAPTERS_V2.filter((chapter) => chapter.requiredRealmOrder <= realmOrder);
}

export function phase33VolumeByKey(volumeKey: Phase33VolumeKey): Phase33VolumeDef | undefined {
  return PHASE33_VOLUMES.find((volume) => volume.volumeKey === volumeKey);
}

export function phase33RealmExists(realmKey: string): boolean {
  return realmByKey(realmKey) !== undefined;
}

// Compile-time sanity check helper: each chapter realm key MUST resolve via REALMS.
// Runtime: catalog test enforces.
export function phase33UnresolvedRealmKeys(): readonly string[] {
  const unresolved: string[] = [];
  const realmKeys = new Set(REALMS.map((realm) => realm.key));
  for (const chapter of STORY_CHAPTERS_V2) {
    if (!realmKeys.has(chapter.requiredRealmKey)) {
      unresolved.push(chapter.requiredRealmKey);
    }
  }
  return unresolved;
}
