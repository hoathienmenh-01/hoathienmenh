/**
 * NPC catalog — Phase 12 PR-1 (Story / NPC / Quest catalog foundation).
 *
 * Static catalog: KHÔNG lưu DB, KHÔNG runtime persistence ở PR này.
 * Phase 12 PR-2 sẽ thêm `Character.storyChapter` + Prisma migration cho runtime.
 * Phase 12 PR-4 sẽ thêm `NpcDialogueModal.vue` UI consumer + `GET /npc/:id/dialogue` endpoint.
 *
 * Source design: `docs/story/TU_TIEN_LO_STORY_BIBLE.md` §6 Dàn NPC trụ cột.
 * Progress tracker: `docs/story/PHASE12_STORY_PROGRESS.md` §4 Implemented NPCs.
 *
 * Naming convention: `npc_<snake_case_name>`. Match story bible names; KHÔNG đổi sau khi merge
 * (sẽ break runtime quest progress nếu Phase 12 PR-2 đã go-live).
 *
 * 12 NPC trụ cột được catalog cho Phase 21: 5 NPC gameplay early-game đã có quest
 * trực tiếp và 7 NPC lore/market/antagonist dùng cho dialogue/affinity/hidden hooks.
 * Các NPC endgame vẫn realm-gated cao để không phá tiến trình Nhân Gian.
 *
 * Phase 12 PR-1 (#425) catalog 4 NPC đầu (Lăng Vân Sinh / Mộc Thanh Y / Hàn Dạ / Tô Nguyệt Ly).
 * Phase 12 Story Foundation Extension (this PR) thêm Huyết La Sát unlock ở Kim Đan.
 */

/**
 * Faction map — 6 thế lực core trong story bible §5 + `wandering` cho NPC độc lập.
 * Tịch Thiên Điện là phản diện chính (player KHÔNG join được trong gameplay PR này).
 */
export type NpcFaction =
  | 'hoa_thien_mon'
  | 'tich_thien_dien'
  | 'huyen_kiem_tong'
  | 'van_bao_thuong_hoi'
  | 'huyet_ha_ma_tong'
  | 'tien_dinh_bach_de'
  | 'wandering';

export interface NpcDef {
  /** Unique key. Format `npc_<snake_case>`. */
  key: string;
  /** Display name (Vietnamese). */
  name: string;
  /** Tông môn / phe phái. `null` = NPC độc lập / chưa lộ phe. */
  faction: NpcFaction | null;
  /**
   * Realm order tối thiểu để NPC này xuất hiện với player.
   * Tham chiếu `REALMS[].order` trong `realms.ts`. Player với realm < này KHÔNG thấy NPC.
   * Phase 12 PR-4 UI sẽ filter theo realmGateOrder vs character.realmOrder.
   */
  realmGateOrder: number;
  /** Default dialogue id khi player click NPC lần đầu. Phải tồn tại trong `dialogues.ts`. */
  defaultDialogueId: string;
  /**
   * Quest keys NPC này giao. Tham chiếu `QUESTS[].key` trong `quests.ts`.
   * NPC có thể giao 0 quest (npc thông tin / merchant placeholder) hoặc nhiều quest.
   */
  questKeys: readonly string[];
  /** Mô tả ngắn cho UI portrait + lore tooltip. */
  description: string;
  /** Tóm tắt lore — link tới story bible section. KHÔNG phải runtime gameplay text. */
  loreSummary: string;
}

/**
 * NPC trụ cột unlock theo cảnh giới/lore gate.
 *
 * - **Lăng Vân Sinh** (chưởng môn Hoa Thiên Môn): main quest giver từ Phàm Nhân → Nguyên Anh.
 * - **Mộc Thanh Y** (đại sư tỷ): tutorial / sect / grind quest. Bị Tịch Linh Chủng ăn mòn — arc cứu kéo dài Trúc Cơ → Nguyên Anh.
 * - **Hàn Dạ** (Huyền Kiếm Tông rival): unlock từ Luyện Khí. Lựa chọn bạn / đối thủ / kẻ thù.
 * - **Tô Nguyệt Ly** (hậu nhân Hoa Thiên lưu đày): unlock từ Trúc Cơ. Hidden quest về truyền thừa bị xoá.
 * - **Huyết La Sát** (ma tu bị Hoa Thiên ruồng bỏ): unlock từ Kim Đan. Moral choice ma đạo flag.
 */
export const NPCS: readonly NpcDef[] = [
  {
    key: 'npc_lang_van_sinh',
    name: 'Lăng Vân Sinh',
    faction: 'hoa_thien_mon',
    realmGateOrder: 0, // Phàm Nhân
    defaultDialogueId: 'dlg_lang_van_sinh_default',
    questKeys: [
      'phamnhan_main_01',
      'phamnhan_realm_01',
      'luyenkhi_main_01',
      'truc_co_main_01',
      'truc_co_realm_01',
      'truc_co_sect_01',
      'kim_dan_main_01',
      'kim_dan_realm_01',
      'nguyen_anh_main_01',
      'nguyen_anh_realm_01',
      'phase21_ch01_main_01',
      'phase21_ch01_main_04',
      'phase21_ch01_main_05',
      'phase21_ch02_main_05',
      'phase21_ch03_main_01',
      'phase21_ch04_main_05',
      'phase21_ch05_main_01',
      'phase21_ch06_main_01',
      'phase21_ch06_main_04',
      'phase21_ch06_main_05',
      'phase21_side_002',
      'phase21_side_004',
      'phase21_side_005',
      'phase21_side_008',
      'phase21_side_012',
      'phase21_side_015',
      'phase21_side_026',
      'phase21_side_030',
      'phase21_side_032',
      'phase21_side_039',
      'phase21_side_040',
    ],
    description: 'Chưởng môn Hoa Thiên Môn. Hiền hậu, nghèo, thâm sâu.',
    loreSummary:
      'Người giữ mảnh truyền thừa cuối cùng của Hoa Thiên. Sẵn sàng hy sinh để mở Hoa Thiên Sơn. Story bible §6.',
  },
  {
    key: 'npc_moc_thanh_y',
    name: 'Mộc Thanh Y',
    faction: 'hoa_thien_mon',
    realmGateOrder: 0, // Phàm Nhân
    defaultDialogueId: 'dlg_moc_thanh_y_default',
    questKeys: [
      'phamnhan_sect_01',
      'phamnhan_grind_01',
      'phamnhan_npc_01',
      'luyenkhi_realm_01',
      'luyenkhi_sect_01',
      'luyenkhi_grind_01',
      'truc_co_grind_01',
      'kim_dan_sect_01',
      'kim_dan_grind_01',
      'nguyen_anh_sect_01',
      'nguyen_anh_grind_01',
      'phase21_ch01_main_02',
      'phase21_ch01_main_03',
      'phase21_ch02_main_01',
      'phase21_ch02_main_02',
      'phase21_ch02_main_03',
      'phase21_ch02_main_04',
      'phase21_ch03_main_02',
      'phase21_ch06_main_02',
      'phase21_side_001',
      'phase21_side_003',
      'phase21_side_006',
      'phase21_side_007',
      'phase21_side_009',
      'phase21_side_010',
      'phase21_side_013',
      'phase21_side_020',
      'phase21_side_027',
      'phase21_side_033',
      'phase21_side_035',
      'phase21_side_038',
    ],
    description: 'Đại sư tỷ Hoa Thiên Môn. Nghiêm khắc, ấm áp. Mộc hệ + alchemy.',
    loreSummary:
      'Bị Tịch Linh Chủng ăn mòn từ Trúc Cơ trở đi — main story sẽ cần player cứu. Story bible §6.',
  },
  {
    key: 'npc_han_da',
    name: 'Hàn Dạ',
    faction: 'huyen_kiem_tong',
    realmGateOrder: 1, // Luyện Khí
    defaultDialogueId: 'dlg_han_da_default',
    questKeys: [
      'luyenkhi_npc_01',
      'phase21_ch03_main_03',
      'phase21_ch03_main_04',
      'phase21_ch03_main_05',
      'phase21_ch05_main_02',
      'phase21_ch06_main_03',
      'phase21_side_011',
      'phase21_side_014',
      'phase21_side_021',
      'phase21_side_024',
      'phase21_side_031',
      'phase21_side_037',
    ],
    description: 'Đệ tử Huyền Kiếm Tông. Lạnh, kiêu ngạo, trọng danh dự.',
    loreSummary:
      'Rival kiếm tu — có thể là bạn / đối thủ / kẻ thù tuỳ lựa chọn moral của player. Arena, duel, sword quests. Story bible §6.',
  },
  {
    key: 'npc_to_nguyet_ly',
    name: 'Tô Nguyệt Ly',
    faction: null, // Hậu nhân Hoa Thiên lưu đày — phe ẩn
    realmGateOrder: 2, // Trúc Cơ
    defaultDialogueId: 'dlg_to_nguyet_ly_default',
    questKeys: [
      'truc_co_npc_01',
      'phase21_ch04_main_01',
      'phase21_ch04_main_02',
      'phase21_ch04_main_03',
      'phase21_ch04_main_04',
      'phase21_side_016',
      'phase21_side_017',
      'phase21_side_018',
      'phase21_side_019',
      'phase21_side_028',
      'phase21_side_034',
      'phase21_side_036',
    ],
    description: 'Hậu nhân nhánh Hoa Thiên lưu đày. Bí ẩn, thông minh.',
    loreSummary:
      'Biết vị trí truyền thừa Hoa Thiên đã bị xoá khỏi lịch sử. Hidden quest, ancient relics. Story bible §6.',
  },
  {
    key: 'npc_huyet_la_sat',
    name: 'Huyết La Sát',
    faction: 'huyet_ha_ma_tong',
    realmGateOrder: 3, // Kim Đan
    defaultDialogueId: 'dlg_huyet_la_sat_default',
    questKeys: [
      'kim_dan_npc_01',
      'nguyen_anh_npc_01',
      'phase21_ch05_main_03',
      'phase21_ch05_main_04',
      'phase21_ch05_main_05',
      'phase21_side_022',
      'phase21_side_023',
      'phase21_side_025',
      'phase21_side_029',
    ],
    description: 'Ma tu bị ruồng bỏ. Tàn nhẫn nhưng có nỗi đau. Từng là đệ tử Hoa Thiên.',
    loreSummary:
      'Mở moral choice ma path: tha / giết / hợp tác. Reveal mặt tối Hoa Thiên Môn. Story bible §6 + §11 (Máu Trên Thềm Đá).',
  },

  {
    key: 'npc_a_linh',
    name: 'A Linh',
    faction: 'hoa_thien_mon',
    realmGateOrder: 0,
    defaultDialogueId: 'dlg_a_linh_default',
    questKeys: [],
    description: 'Linh đồng ngoại môn phụ trách dẫn tân đệ tử qua nửa canh giờ đầu.',
    loreSummary:
      'Guided-path helper anchored to Hoa Thiên onboarding: tu luyện lần đầu, nhận túi đồ, học quy củ và tìm nhịp daily. Phase 21 §New Player Guided Path.',
  },
  {
    key: 'npc_van_kim_nuong',
    name: 'Vạn Kim Nương',
    faction: 'van_bao_thuong_hoi',
    realmGateOrder: 1,
    defaultDialogueId: 'dlg_van_kim_nuong_default',
    questKeys: [],
    description: 'Chủ sự Vạn Bảo Thương Hội dưới núi. Thực tế, sắc bén, theo lợi ích.',
    loreSummary:
      'Biết nhiều bí mật qua giao dịch; dùng cho market, auction, escort, price-control hooks. Story bible §5-6.',
  },
  {
    key: 'npc_bach_de_tu',
    name: 'Bạch Đế Tử',
    faction: 'tien_dinh_bach_de',
    realmGateOrder: 4,
    defaultDialogueId: 'dlg_bach_de_tu_default',
    questKeys: [],
    description: 'Tiên nhân tiếp dẫn cao quý giả tạo, xuất hiện sớm như điềm báo tiên luật.',
    loreSummary:
      'Người của Tiên Đình Bạch Đế, về sau lộ quan hệ với Tịch Thiên Điện trong Tiên Giới. Story bible §6.',
  },
  {
    key: 'npc_tich_linh_su_gia',
    name: 'Tịch Linh Sứ Giả',
    faction: 'tich_thien_dien',
    realmGateOrder: 2,
    defaultDialogueId: 'dlg_tich_linh_su_gia_default',
    questKeys: [],
    description: 'Sứ giả che mặt của Tịch Thiên Điện, gieo Tịch Linh Chủng và thử lòng tu sĩ trẻ.',
    loreSummary:
      'Early antagonist face for Tịch Thiên Điện: nội gián, Tịch Linh Chủng, Tịch Thiên Ấn. Story bible §5.',
  },
  {
    key: 'npc_huyet_ha_su_gia',
    name: 'Huyết Hà Sứ Giả',
    faction: 'huyet_ha_ma_tong',
    realmGateOrder: 3,
    defaultDialogueId: 'dlg_huyet_ha_su_gia_default',
    questKeys: [],
    description: 'Kẻ môi giới chợ đen Huyết Hà Ma Tông, phân biệt ác ý và người bị ruồng bỏ.',
    loreSummary:
      'Supports demonic-path tension, black-market hints, and Huyết La Sát moral contrast. Story bible §5.',
  },
  {
    key: 'npc_hoa_thien_dao_to',
    name: 'Hoa Thiên Đạo Tổ',
    faction: 'hoa_thien_mon',
    realmGateOrder: 4,
    defaultDialogueId: 'dlg_hoa_thien_dao_to_default',
    questKeys: [],
    description: 'Tổ sư cổ xưa từ bi nhưng quyết liệt, chỉ hiện qua tàn niệm và phong ấn.',
    loreSummary:
      'Không chết hoàn toàn, hoá thành phong ấn ngăn Vô Đạo Chủng; Phase 21 dùng tàn niệm làm foreshadow. Story bible §6.',
  },
  {
    key: 'npc_tich_thien_dao_chu',
    name: 'Tịch Thiên Đạo Chủ',
    faction: 'tich_thien_dien',
    realmGateOrder: 4,
    defaultDialogueId: 'dlg_tich_thien_dao_chu_default',
    questKeys: [],
    description: 'Phản diện tối cao lý trí cực đoan, chỉ vang lên qua đạo âm bị phong.',
    loreSummary:
      'Muốn khoá đại đạo vì tin chúng sinh sẽ tự huỷ; Phase 21 chỉ foreshadow triết học, không cho gặp trực diện. Story bible §6.',
  },
  // ─── Phase 33 — Tu Tiên Lộ Quyển II–IV NPC trụ cột ─────────────────────────
  {
    key: 'npc_luc_binh',
    name: 'Lục Bình',
    faction: 'wandering',
    realmGateOrder: 9,
    defaultDialogueId: 'dlg_luc_binh_default',
    questKeys: [],
    description: 'Phi thăng giả nữ ở Phi Thăng Doanh, giữ một mảnh xích cũ của Tiên Đình.',
    loreSummary:
      'Phase 33 Quyển II: bạn đồng hành ở Chap 10 Phi Thăng Doanh; ký ức xích phi thăng mở route giải phóng phạm nhân.',
  },
  {
    key: 'npc_tich_thien_thanh_su',
    name: 'Tịch Thiên Thánh Sứ',
    faction: 'tich_thien_dien',
    realmGateOrder: 16,
    defaultDialogueId: 'dlg_tich_thien_thanh_su_default',
    questKeys: [],
    description: 'Sứ giả Tịch Thiên Điện cấp Thánh Cảnh; chân thân lộ tại Chap 21.',
    loreSummary:
      'Phase 33 Quyển III–IV: cánh tay Tịch Thiên ở Thánh Cảnh / Thiên Đạo; affinity cao mở route tiết lộ chân tướng Vô Đạo Chung.',
  },
  {
    key: 'npc_dao_vuc_chi_tam',
    name: 'Đạo Vực Chi Tâm',
    faction: 'hoa_thien_mon',
    realmGateOrder: 19,
    defaultDialogueId: 'dlg_dao_vuc_chi_tam_default',
    questKeys: [],
    description: 'Linh thể nhân hóa của Đạo Vực Hoa Thiên, phát ngôn tập thể của vạn sinh linh.',
    loreSummary:
      'Phase 33 Quyển III Chap 20: NPC ngữ pháp đại diện Đạo Vực; chọn luật mềm mở affinity, luật sắt khiến NPC im lặng.',
  },
  {
    key: 'npc_nguyen_linh_nu',
    name: 'Nguyên Linh Nữ',
    faction: 'wandering',
    realmGateOrder: 22,
    defaultDialogueId: 'dlg_nguyen_linh_nu_default',
    questKeys: [],
    description: 'Nguyên linh canh giữ Bản Nguyên Hải, ngân tóc bạc đầu, mắt như nước nguyên.',
    loreSummary:
      'Phase 33 Quyển IV Chap 22: NPC bản nguyên đầu tiên; affinity cao hé route Đạo Liên Hoa Thiên tiến hóa.',
  },
  {
    key: 'npc_huyen_huyen_giam_quan',
    name: 'Huyền Huyền Giám Quan',
    faction: 'wandering',
    realmGateOrder: 23,
    defaultDialogueId: 'dlg_huyen_huyen_giam_quan_default',
    questKeys: [],
    description: 'Giám quan Huyền Huyền Cổ Bi — đọc câu khắc khác nhau cho mỗi người.',
    loreSummary:
      'Phase 33 Quyển IV Chap 23: NPC ngoại đạo; câu hỏi của hắn lộ phần dị giáo của đạo người chơi.',
  },
  {
    key: 'npc_vo_thuy_lao_nhan',
    name: 'Vô Thủy Lão Nhân',
    faction: 'wandering',
    realmGateOrder: 24,
    defaultDialogueId: 'dlg_vo_thuy_lao_nhan_default',
    questKeys: [],
    description: 'Lão nhân Vô Thủy ngồi câu cá ở Thời Gian Luân Hải, biết tất cả khởi đầu nhưng không tiết lộ.',
    loreSummary:
      'Phase 33 Quyển IV Chap 24: NPC thời gian; gợi mở khởi đầu thật của người chơi không ở Thanh Khê.',
  },
  {
    key: 'npc_vo_chung_dong_tu',
    name: 'Vô Chung Đồng Tử',
    faction: 'wandering',
    realmGateOrder: 25,
    defaultDialogueId: 'dlg_vo_chung_dong_tu_default',
    questKeys: [],
    description: 'Đồng tử Vô Chung giữ cửa Vô Chung Chi Môn, lời nói ghép từ tương lai và hiện tại.',
    loreSummary:
      'Phase 33 Quyển IV Chap 25: NPC tương lai chiến trường; hé thư từ Tịch Thiên Thánh Sứ tương lai.',
  },
] as const;

export function npcByKey(key: string): NpcDef | undefined {
  return NPCS.find((n) => n.key === key);
}

export function npcsByFaction(faction: NpcFaction): NpcDef[] {
  return NPCS.filter((n) => n.faction === faction);
}

/**
 * Trả về danh sách NPC available với character đang ở realm order `realmOrder`.
 * Server-authoritative gate — tất cả NPC có `realmGateOrder <= realmOrder`.
 * Phase 12 PR-2 / PR-4 sẽ dùng để filter NPC list cho UI.
 */
export function npcsAvailableAtRealm(realmOrder: number): NpcDef[] {
  return NPCS.filter((n) => n.realmGateOrder <= realmOrder);
}
