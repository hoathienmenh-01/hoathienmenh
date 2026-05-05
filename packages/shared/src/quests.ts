/**
 * Quest catalog — Phase 12 PR-1 (Story / NPC / Quest catalog foundation).
 *
 * Static catalog: KHÔNG lưu DB, KHÔNG runtime persistence ở PR này.
 * - Phase 12 PR-2 sẽ thêm `QuestProgress` Prisma model + `QuestService.list/accept/progress/complete`.
 * - Phase 12 PR-3 sẽ thêm `QuestService.claim` đi qua `CurrencyService` / `ItemService` + `RewardLedger` idempotency.
 * - Phase 12 PR-5 sẽ wire main storyline `phamnhan_main_01` end-to-end với UI.
 *
 * Source design: `docs/story/TU_TIEN_LO_STORY_BIBLE.md` §9 + §11.
 * Progress tracker: `docs/story/PHASE12_STORY_PROGRESS.md` §5 Implemented quest chains.
 *
 * Quest naming convention (story bible §9): `<realm_code>_<type>_<seq>`.
 *   - realm_code = `REALMS[].key` (phamnhan / luyenkhi / truc_co / kim_dan / …).
 *   - type = `main` / `realm` / `sect` / `npc` / `grind`.
 *   - seq = 2-digit zero-padded số thứ tự trong cùng (realm, type).
 *
 * PR này catalog 15 quest cho 3 cảnh giới đầu (5 quest mỗi cảnh giới):
 *   - Phàm Nhân: phamnhan_main_01, phamnhan_realm_01, phamnhan_sect_01, phamnhan_grind_01, phamnhan_npc_01.
 *   - Luyện Khí: luyenkhi_main_01, luyenkhi_realm_01, luyenkhi_sect_01, luyenkhi_grind_01, luyenkhi_npc_01.
 *   - Trúc Cơ:   truc_co_main_01, truc_co_realm_01, truc_co_sect_01, truc_co_grind_01, truc_co_npc_01.
 *
 * Reward band tham khảo `docs/BALANCE_MODEL.md`. Reward đi qua `RewardLedger` ở Phase 12 PR-3.
 */

/**
 * Quest type — match story bible naming (`main` / `realm` / `sect` / `npc` / `grind`).
 *
 * - `main`: cốt truyện chính, mỗi cảnh giới có 1 main quest (gate breakthrough).
 * - `realm`: nhiệm vụ riêng cảnh giới mở khoá gameplay (vd Linh Tuyền Động).
 * - `sect`: nhiệm vụ tông môn (Hoa Thiên Môn) — daily / contribute.
 * - `npc`: nhiệm vụ giao bởi NPC cụ thể (intro NPC + side story).
 * - `grind`: nhiệm vụ cày (kill / collect quantity) — repeatable trong PR-2 nếu cần.
 */
export type QuestKind = 'main' | 'realm' | 'sect' | 'npc' | 'grind';

/**
 * Quest step objective. Phase 12 PR-2 `QuestService.progress` sẽ track theo `(kind, targetType, targetId)`.
 * - `kill`: kill `count` quái có `targetType='monster'` + `targetId=<monster_key>`.
 * - `collect`: nhặt `count` item có `targetType='item'` + `targetId=<item_key>`.
 * - `talk`: nói chuyện với NPC `targetType='npc'` + `targetId=<npc_key>` (count=1).
 * - `explore`: vào region `targetType='region'` + `targetId=<region_key>` (count=1).
 * - `choice`: chọn `targetType='choice'` + `targetId=<choice_key>` (count=1, lưu vào karma/flag).
 */
export type QuestStepKind = 'kill' | 'collect' | 'talk' | 'explore' | 'choice';

export interface QuestStepDef {
  /** Step id unique trong cùng quest, format `step_<seq>`. */
  id: string;
  kind: QuestStepKind;
  /** Loại target: `monster` / `item` / `npc` / `region` / `choice`. Khớp với `kind`. */
  targetType: 'monster' | 'item' | 'npc' | 'region' | 'choice';
  /** Target id — match catalog tương ứng (monster_key / item_key / npc_key / region_key / choice_key). */
  targetId: string;
  /** Số lượng cần đạt (kill count / collect count). 1 cho talk/explore/choice. */
  count: number;
  /** Mô tả step cho UI (Vietnamese). */
  description: string;
}

export interface QuestRewardDef {
  /** Linh Thạch (currency main). KHÔNG được < 0. */
  linhThach?: number;
  /** Tiên Ngọc (premium currency). Hiếm. */
  tienNgoc?: number;
  /** EXP cảnh giới. */
  exp?: number;
  /** Cống Hiến tông môn. */
  congHien?: number;
  /** Items reward. Item key match `ITEMS[].key`. */
  items?: ReadonlyArray<{ itemKey: string; qty: number }>;
}

export interface QuestDef {
  /** Unique key, format `<realm>_<type>_<seq>`. Match story bible §9. */
  key: string;
  /** Display name (Vietnamese). */
  name: string;
  /** Description / flavor text cho UI quest list. */
  description: string;
  kind: QuestKind;
  /**
   * Realm gate — match `REALMS[].key`. Player phải đạt realm này (order >= `requiredRealmOrder`)
   * mới available. Server-authoritative ở Phase 12 PR-2.
   */
  realmKey: string;
  requiredRealmOrder: number;
  /** NPC giao quest — match `NPCS[].key`. */
  giverNpcKey: string;
  /**
   * Chain key — group nhiều quest thành arc cốt truyện.
   * Vd `hoa_thien_main` = main chain xuyên suốt 3 cảnh giới đầu (PR này), `mộc_thanh_y_arc` = arc cứu Mộc Thanh Y.
   * `null` = standalone quest. Phase 12 PR-2 dùng `chainKey` để gate quest tiếp theo.
   */
  chainKey: string | null;
  /** Quest prerequisite — phải claim quest này trước khi available. `null` = không có prereq. */
  prerequisiteQuestKey: string | null;
  /** Steps theo thứ tự. UI render từ trên xuống. */
  steps: readonly QuestStepDef[];
  /** Reward khi claim — Phase 12 PR-3 đi qua `RewardLedger` idempotency `(characterId, QUEST_CLAIM, questKey)`. */
  rewards: QuestRewardDef;
  /** Tóm tắt lore link story bible. KHÔNG phải runtime gameplay text. */
  loreSummary: string;
}

/**
 * 15 quest cho 3 cảnh giới đầu. Reward band tham khảo BALANCE_MODEL — main quest reward cao hơn
 * grind/sect ~3-5x, realm quest mở khoá gameplay ~2x grind.
 *
 * Tất cả `targetId` placeholder (vd monster `son_thu`, item `linh_thao_so_cap`) sẽ wire với catalog
 * thực tế ở Phase 12 PR-2 (validation: target tồn tại trong `MONSTERS` / `ITEMS` / `NPCS` / `MAP_REGIONS`).
 * PR này CHỈ catalog quest definition — không validate cross-catalog (test ở PR-2).
 */
export const QUESTS: readonly QuestDef[] = [
  // ============================================================================
  // PHÀM NHÂN (realm order 0) — 5 quest
  // ============================================================================
  {
    key: 'phamnhan_main_01',
    name: 'Hoa Thiên Tuyển Đồ',
    description:
      'Lăng Vân Sinh chưởng môn nhận con vào ngoại môn. Bị coi thường vì căn cơ yếu — chứng minh bằng hành động.',
    kind: 'main',
    realmKey: 'phamnhan',
    requiredRealmOrder: 0,
    giverNpcKey: 'npc_lang_van_sinh',
    chainKey: 'hoa_thien_main',
    prerequisiteQuestKey: null,
    steps: [
      {
        id: 'step_01',
        kind: 'talk',
        targetType: 'npc',
        targetId: 'npc_lang_van_sinh',
        count: 1,
        description: 'Diện kiến Lăng Vân Sinh chưởng môn.',
      },
      {
        id: 'step_02',
        kind: 'talk',
        targetType: 'npc',
        targetId: 'npc_moc_thanh_y',
        count: 1,
        description: 'Báo cáo Mộc Thanh Y đại sư tỷ — nhận hướng dẫn nhập môn.',
      },
      {
        id: 'step_03',
        kind: 'kill',
        targetType: 'monster',
        targetId: 'son_thu',
        count: 3,
        description: 'Đánh bại 3 Sơn Thử ở hậu sơn — chứng minh thực lực.',
      },
    ],
    rewards: {
      linhThach: 100,
      exp: 200,
      items: [{ itemKey: 'so_kiem', qty: 1 }],
    },
    loreSummary:
      'Onboarding chính tuyến. Hạt Giống Vô Danh trong hậu sơn lộ ra khi player giết Sơn Thử cuối cùng. Story bible §9.1 row 0.',
  },
  {
    key: 'phamnhan_realm_01',
    name: 'Hạt Giống Vô Danh',
    description:
      'Hạt Giống Vô Danh trong hậu sơn vọng linh — Lăng Vân Sinh muốn con đi tìm hiểu nguồn gốc.',
    kind: 'realm',
    realmKey: 'phamnhan',
    requiredRealmOrder: 0,
    giverNpcKey: 'npc_lang_van_sinh',
    chainKey: 'hoa_thien_main',
    prerequisiteQuestKey: 'phamnhan_main_01',
    steps: [
      {
        id: 'step_01',
        kind: 'explore',
        targetType: 'region',
        targetId: 'hoa_thien_hau_son',
        count: 1,
        description: 'Vào Hậu Sơn Hoa Thiên Môn.',
      },
      {
        id: 'step_02',
        kind: 'collect',
        targetType: 'item',
        targetId: 'hat_giong_vo_danh',
        count: 1,
        description: 'Tìm Hạt Giống Vô Danh.',
      },
      {
        id: 'step_03',
        kind: 'talk',
        targetType: 'npc',
        targetId: 'npc_lang_van_sinh',
        count: 1,
        description: 'Mang Hạt Giống về cho Lăng Vân Sinh.',
      },
    ],
    rewards: {
      linhThach: 50,
      exp: 100,
    },
    loreSummary:
      'Hạt Giống = mảnh truyền thừa Hoa Thiên Đạo Tổ. Mở foreshadow endgame inheritance. Story bible §6 + §9.1.',
  },
  {
    key: 'phamnhan_sect_01',
    name: 'Quét Lá Hậu Sơn',
    description:
      'Mộc Thanh Y giao việc quét lá — kiểm tra tâm tính + dạy quy củ tông môn.',
    kind: 'sect',
    realmKey: 'phamnhan',
    requiredRealmOrder: 0,
    giverNpcKey: 'npc_moc_thanh_y',
    chainKey: null,
    prerequisiteQuestKey: 'phamnhan_main_01',
    steps: [
      {
        id: 'step_01',
        kind: 'collect',
        targetType: 'item',
        targetId: 'la_la_phong',
        count: 30,
        description: 'Quét gom 30 Lá La Phong.',
      },
    ],
    rewards: {
      linhThach: 30,
      exp: 50,
      congHien: 10,
    },
    loreSummary: 'Sect daily prototype. Mộc Thanh Y dạy "tâm tu trước thân tu". Story bible §11.',
  },
  {
    key: 'phamnhan_grind_01',
    name: 'Diệt Sơn Thử',
    description: 'Hậu sơn nhiều Sơn Thử ăn linh thảo — Mộc Thanh Y nhờ con dọn sạch.',
    kind: 'grind',
    realmKey: 'phamnhan',
    requiredRealmOrder: 0,
    giverNpcKey: 'npc_moc_thanh_y',
    chainKey: null,
    prerequisiteQuestKey: null,
    steps: [
      {
        id: 'step_01',
        kind: 'kill',
        targetType: 'monster',
        targetId: 'son_thu',
        count: 10,
        description: 'Đánh bại 10 Sơn Thử ở hậu sơn.',
      },
    ],
    rewards: {
      linhThach: 50,
      exp: 80,
    },
    loreSummary: 'Repeatable grind quest prototype — Phase 12 PR-2 sẽ wire repeatable flag.',
  },
  {
    key: 'phamnhan_npc_01',
    name: 'Linh Căn Vấn Đáp',
    description:
      'Mộc Thanh Y giảng giải linh căn — con phải báo lại nhận thức của mình về linh căn để nhận đan nhập môn.',
    kind: 'npc',
    realmKey: 'phamnhan',
    requiredRealmOrder: 0,
    giverNpcKey: 'npc_moc_thanh_y',
    chainKey: null,
    prerequisiteQuestKey: 'phamnhan_main_01',
    steps: [
      {
        id: 'step_01',
        kind: 'talk',
        targetType: 'npc',
        targetId: 'npc_moc_thanh_y',
        count: 1,
        description: 'Nghe Mộc Thanh Y giảng linh căn ngũ hành.',
      },
      {
        id: 'step_02',
        kind: 'choice',
        targetType: 'choice',
        targetId: 'choice_linh_can_path',
        count: 1,
        description: 'Chọn hướng tu đầu tiên (Kim/Mộc/Thuỷ/Hoả/Thổ).',
      },
    ],
    rewards: {
      linhThach: 40,
      exp: 60,
      items: [{ itemKey: 'linh_lo_dan', qty: 1 }],
    },
    loreSummary:
      'Tutorial linh căn — choice flag sẽ ảnh hưởng dialogue branch ở Luyện Khí. Story bible §9.1 row 0 + §11.',
  },

  // ============================================================================
  // LUYỆN KHÍ (realm order 1) — 5 quest
  // ============================================================================
  {
    key: 'luyenkhi_main_01',
    name: 'Linh Khí Nhập Thể',
    description:
      'Mở 9 trọng Luyện Khí — học hấp thu linh khí. Lần đầu gặp dấu vết Tịch Linh khí trong Linh Tuyền Động.',
    kind: 'main',
    realmKey: 'luyenkhi',
    requiredRealmOrder: 1,
    giverNpcKey: 'npc_lang_van_sinh',
    chainKey: 'hoa_thien_main',
    prerequisiteQuestKey: 'phamnhan_main_01',
    steps: [
      {
        id: 'step_01',
        kind: 'explore',
        targetType: 'region',
        targetId: 'linh_tuyen_dong',
        count: 1,
        description: 'Vào Linh Tuyền Động.',
      },
      {
        id: 'step_02',
        kind: 'kill',
        targetType: 'monster',
        targetId: 'tich_linh_anh',
        count: 5,
        description: 'Đánh bại 5 Tịch Linh Ảnh.',
      },
      {
        id: 'step_03',
        kind: 'collect',
        targetType: 'item',
        targetId: 'tich_linh_chung_mau',
        count: 1,
        description: 'Lấy mẫu Tịch Linh Chủng — bằng chứng cho Lăng Vân Sinh.',
      },
      {
        id: 'step_04',
        kind: 'talk',
        targetType: 'npc',
        targetId: 'npc_lang_van_sinh',
        count: 1,
        description: 'Báo cáo Lăng Vân Sinh — nhận hướng dẫn Trúc Cơ.',
      },
    ],
    rewards: {
      linhThach: 300,
      exp: 800,
      items: [{ itemKey: 'linh_lo_dan', qty: 3 }],
    },
    loreSummary:
      'Foreshadow Tịch Thiên Điện — main villain xuất hiện gián tiếp. Story bible §9.1 row 1 + §3.',
  },
  {
    key: 'luyenkhi_realm_01',
    name: 'Linh Tuyền Mở Cửa',
    description:
      'Linh Tuyền Động chỉ mở 1 lần / ngày — Mộc Thanh Y dạy con khoá / mở phong ấn.',
    kind: 'realm',
    realmKey: 'luyenkhi',
    requiredRealmOrder: 1,
    giverNpcKey: 'npc_moc_thanh_y',
    chainKey: null,
    prerequisiteQuestKey: 'luyenkhi_main_01',
    steps: [
      {
        id: 'step_01',
        kind: 'talk',
        targetType: 'npc',
        targetId: 'npc_moc_thanh_y',
        count: 1,
        description: 'Học khoá / mở phong ấn từ Mộc Thanh Y.',
      },
      {
        id: 'step_02',
        kind: 'collect',
        targetType: 'item',
        targetId: 'phong_an_phu',
        count: 3,
        description: 'Thu thập 3 Phong Ấn Phù.',
      },
    ],
    rewards: {
      linhThach: 150,
      exp: 250,
    },
    loreSummary:
      'Mở khoá daily-limit dungeon — gate gameplay phía Phase 12.2.B DungeonRun runtime.',
  },
  {
    key: 'luyenkhi_sect_01',
    name: 'Hộ Pháp Tông Môn',
    description: 'Tông môn bị Sơn Tặc tấn công cổng ngoài — đẩy lui chúng và bảo vệ trận pháp.',
    kind: 'sect',
    realmKey: 'luyenkhi',
    requiredRealmOrder: 1,
    giverNpcKey: 'npc_moc_thanh_y',
    chainKey: null,
    prerequisiteQuestKey: null,
    steps: [
      {
        id: 'step_01',
        kind: 'kill',
        targetType: 'monster',
        targetId: 'son_tac_dau_muc',
        count: 5,
        description: 'Đánh bại 5 Sơn Tặc đầu mục.',
      },
      {
        id: 'step_02',
        kind: 'collect',
        targetType: 'item',
        targetId: 'tran_phap_thach',
        count: 1,
        description: 'Khôi phục Trận Pháp Thạch.',
      },
    ],
    rewards: {
      linhThach: 100,
      exp: 150,
      congHien: 30,
    },
    loreSummary: 'Sect defense gameplay prototype. Story bible §11.',
  },
  {
    key: 'luyenkhi_grind_01',
    name: 'Hắc Mộc Lâm Thanh Tẩy',
    description: 'Hắc Mộc Lâm phía bắc bị quái yêu xâm nhập — Mộc Thanh Y nhờ con thanh tẩy.',
    kind: 'grind',
    realmKey: 'luyenkhi',
    requiredRealmOrder: 1,
    giverNpcKey: 'npc_moc_thanh_y',
    chainKey: null,
    prerequisiteQuestKey: null,
    steps: [
      {
        id: 'step_01',
        kind: 'kill',
        targetType: 'monster',
        targetId: 'hac_moc_yeu',
        count: 15,
        description: 'Đánh bại 15 Hắc Mộc Yêu trong Hắc Mộc Lâm.',
      },
    ],
    rewards: {
      linhThach: 200,
      exp: 350,
    },
    loreSummary: 'Repeatable grind quest level 2 — drop Mộc hệ linh thảo.',
  },
  {
    key: 'luyenkhi_npc_01',
    name: 'Lời Thách Đấu',
    description:
      'Hàn Dạ — đệ tử Huyền Kiếm Tông — thách con đấu. Lựa chọn nhận hay từ chối ảnh hưởng karma rivalry.',
    kind: 'npc',
    realmKey: 'luyenkhi',
    requiredRealmOrder: 1,
    giverNpcKey: 'npc_han_da',
    chainKey: 'han_da_rivalry',
    prerequisiteQuestKey: null,
    steps: [
      {
        id: 'step_01',
        kind: 'talk',
        targetType: 'npc',
        targetId: 'npc_han_da',
        count: 1,
        description: 'Diện kiến Hàn Dạ trên đỉnh Vạn Kiếm Phong.',
      },
      {
        id: 'step_02',
        kind: 'choice',
        targetType: 'choice',
        targetId: 'choice_han_da_duel',
        count: 1,
        description: 'Chọn nhận thách đấu hay từ chối.',
      },
    ],
    rewards: {
      linhThach: 80,
      exp: 120,
    },
    loreSummary:
      'Mở rivalry chain với Hàn Dạ — branch karma sẽ kéo dài qua Trúc Cơ + Kim Đan. Story bible §6.',
  },

  // ============================================================================
  // TRÚC CƠ (realm order 2) — 5 quest
  // ============================================================================
  {
    key: 'truc_co_main_01',
    name: 'Trúc Đạo Cơ',
    description:
      'Xây nền đạo cơ — chọn hướng tu luyện đầu tiên. Lăng Vân Sinh trao Trúc Cơ Đan.',
    kind: 'main',
    realmKey: 'truc_co',
    requiredRealmOrder: 2,
    giverNpcKey: 'npc_lang_van_sinh',
    chainKey: 'hoa_thien_main',
    prerequisiteQuestKey: 'luyenkhi_main_01',
    steps: [
      {
        id: 'step_01',
        kind: 'collect',
        targetType: 'item',
        targetId: 'truc_co_dan',
        count: 1,
        description: 'Nhận Trúc Cơ Đan từ Lăng Vân Sinh.',
      },
      {
        id: 'step_02',
        kind: 'choice',
        targetType: 'choice',
        targetId: 'choice_truc_co_path',
        count: 1,
        description: 'Chọn hướng tu Trúc Cơ (Pháp / Khí / Đan / Kiếm / Trận).',
      },
      {
        id: 'step_03',
        kind: 'explore',
        targetType: 'region',
        targetId: 'hoa_thien_noi_mon',
        count: 1,
        description: 'Vào nội môn Hoa Thiên — chính thức trở thành nội môn đệ tử.',
      },
    ],
    rewards: {
      linhThach: 800,
      exp: 2500,
      items: [{ itemKey: 'co_thien_dan', qty: 1 }],
    },
    loreSummary:
      'Player chính thức nội môn. Choice ảnh hưởng skill / dungeon / faction reputation về sau. Story bible §9.1 row 2.',
  },
  {
    key: 'truc_co_realm_01',
    name: 'Đạo Tâm Lựa Chọn',
    description:
      'Đạo tâm phải vững — Lăng Vân Sinh đưa con vào tâm cảnh thử thách trước khi cấp công pháp sơ cấp.',
    kind: 'realm',
    realmKey: 'truc_co',
    requiredRealmOrder: 2,
    giverNpcKey: 'npc_lang_van_sinh',
    chainKey: 'hoa_thien_main',
    prerequisiteQuestKey: 'truc_co_main_01',
    steps: [
      {
        id: 'step_01',
        kind: 'explore',
        targetType: 'region',
        targetId: 'tam_canh_phong_an',
        count: 1,
        description: 'Vào Tâm Cảnh Phong Ấn.',
      },
      {
        id: 'step_02',
        kind: 'kill',
        targetType: 'monster',
        targetId: 'tam_ma_anh',
        count: 3,
        description: 'Đánh bại 3 Tâm Ma Ảnh.',
      },
      {
        id: 'step_03',
        kind: 'choice',
        targetType: 'choice',
        targetId: 'choice_dao_tam',
        count: 1,
        description: 'Lựa chọn cốt lõi đạo tâm: Chính / Trung / Ma.',
      },
    ],
    rewards: {
      linhThach: 400,
      exp: 1000,
    },
    loreSummary:
      'Foreshadow Phase 11.5 Tâm Ma debuff (đã có) — choice ảnh hưởng future quest unlock. Story bible §11.',
  },
  {
    key: 'truc_co_sect_01',
    name: 'Cứu Đại Sư Tỷ',
    description:
      'Mộc Thanh Y bị Tịch Linh Chủng ăn mòn — Lăng Vân Sinh nhờ con vào Vô Trụ Cốc tìm Tịch Linh Khử Đan.',
    kind: 'sect',
    realmKey: 'truc_co',
    requiredRealmOrder: 2,
    giverNpcKey: 'npc_lang_van_sinh',
    chainKey: 'moc_thanh_y_arc',
    prerequisiteQuestKey: 'truc_co_main_01',
    steps: [
      {
        id: 'step_01',
        kind: 'explore',
        targetType: 'region',
        targetId: 'vo_tru_coc',
        count: 1,
        description: 'Vào Vô Trụ Cốc.',
      },
      {
        id: 'step_02',
        kind: 'kill',
        targetType: 'monster',
        targetId: 'tich_linh_quy',
        count: 8,
        description: 'Đánh bại 8 Tịch Linh Quỷ.',
      },
      {
        id: 'step_03',
        kind: 'collect',
        targetType: 'item',
        targetId: 'tich_linh_khu_dan',
        count: 1,
        description: 'Lấy Tịch Linh Khử Đan.',
      },
      {
        id: 'step_04',
        kind: 'talk',
        targetType: 'npc',
        targetId: 'npc_moc_thanh_y',
        count: 1,
        description: 'Mang đan về cho Mộc Thanh Y — cứu sư tỷ.',
      },
    ],
    rewards: {
      linhThach: 600,
      exp: 1500,
      congHien: 100,
      items: [{ itemKey: 'co_thien_dan', qty: 1 }],
    },
    loreSummary:
      'Mộc Thanh Y arc — emotional beat đầu tiên. Tịch Thiên Điện gián tiếp. Story bible §6 + §11.',
  },
  {
    key: 'truc_co_grind_01',
    name: 'Linh Điền Khai Hoang',
    description:
      'Hoa Thiên Môn cần linh điền mới — Mộc Thanh Y nhờ con thu thập linh thạch khai hoang.',
    kind: 'grind',
    realmKey: 'truc_co',
    requiredRealmOrder: 2,
    giverNpcKey: 'npc_moc_thanh_y',
    chainKey: null,
    prerequisiteQuestKey: null,
    steps: [
      {
        id: 'step_01',
        kind: 'collect',
        targetType: 'item',
        targetId: 'linh_thach_tho',
        count: 50,
        description: 'Thu thập 50 Linh Thạch Thô từ Trúc Cơ dungeon.',
      },
    ],
    rewards: {
      linhThach: 500,
      exp: 800,
      congHien: 80,
    },
    loreSummary: 'Repeatable grind level 3 — feeds linh điền system (long-term Phase 13).',
  },
  {
    key: 'truc_co_npc_01',
    name: 'Bóng Trong Sương',
    description:
      'Tô Nguyệt Ly — bí ẩn xuất hiện ở rừng Vạn Tỉnh — đưa con manh mối truyền thừa Hoa Thiên đã bị xoá.',
    kind: 'npc',
    realmKey: 'truc_co',
    requiredRealmOrder: 2,
    giverNpcKey: 'npc_to_nguyet_ly',
    chainKey: 'to_nguyet_ly_hidden',
    prerequisiteQuestKey: null,
    steps: [
      {
        id: 'step_01',
        kind: 'talk',
        targetType: 'npc',
        targetId: 'npc_to_nguyet_ly',
        count: 1,
        description: 'Gặp Tô Nguyệt Ly trong sương Vạn Tỉnh.',
      },
      {
        id: 'step_02',
        kind: 'collect',
        targetType: 'item',
        targetId: 'manh_giay_co',
        count: 1,
        description: 'Nhận Mảnh Giấy Cổ — manh mối truyền thừa.',
      },
      {
        id: 'step_03',
        kind: 'choice',
        targetType: 'choice',
        targetId: 'choice_to_nguyet_ly_trust',
        count: 1,
        description: 'Lựa chọn tin Tô Nguyệt Ly hay báo Lăng Vân Sinh.',
      },
    ],
    rewards: {
      linhThach: 300,
      exp: 600,
    },
    loreSummary:
      'Hidden quest chain — endgame inheritance foreshadow. Branch trust → unlock Hoa Thiên Đạo Tổ relics ở Kim Đan. Story bible §6 + §11.',
  },
] as const;

export function questByKey(key: string): QuestDef | undefined {
  return QUESTS.find((q) => q.key === key);
}

export function questsByRealm(realmKey: string): QuestDef[] {
  return QUESTS.filter((q) => q.realmKey === realmKey);
}

export function questsByGiver(npcKey: string): QuestDef[] {
  return QUESTS.filter((q) => q.giverNpcKey === npcKey);
}

export function questsByKind(kind: QuestKind): QuestDef[] {
  return QUESTS.filter((q) => q.kind === kind);
}

export function questsByChain(chainKey: string): QuestDef[] {
  return QUESTS.filter((q) => q.chainKey === chainKey);
}

/**
 * Server-authoritative gate — quest available với character đang ở `realmOrder`.
 * Lưu ý: PR này KHÔNG check prerequisite + KHÔNG check faction. Phase 12 PR-2 sẽ wire đầy đủ.
 */
export function questsAvailableAtRealm(realmOrder: number): QuestDef[] {
  return QUESTS.filter((q) => q.requiredRealmOrder <= realmOrder);
}
