/**
 * Dialogue catalog skeleton — Phase 12 PR-1 (Story / NPC / Quest catalog foundation).
 *
 * Phase 12 PR-4 sẽ thêm `NpcDialogueModal.vue` + `GET /npc/:id/dialogue` endpoint consume catalog này.
 * PR-1 chỉ cần skeleton: 1 default dialogue per NPC + branch theo realm gate / quest status.
 *
 * Source design: `docs/story/TU_TIEN_LO_STORY_BIBLE.md` §6.
 *
 * Naming convention: `dlg_<npc_key>_<variant>`.
 *
 * KHÔNG phải runtime gameplay text — UI sẽ render `text` như string Vietnamese (i18n parity sẽ
 * thêm ở PR-4 nếu cần). Choice `label` cũng chỉ là Vietnamese hardcoded ở skeleton — PR-4 sẽ
 * convert thành i18n key nếu locale en cần.
 */

/**
 * Dialogue branch condition — server-authoritative filter ở Phase 12 PR-4
 * `GET /npc/:id/dialogue?characterId=...` sẽ pick line đầu tiên thoả mãn.
 *
 * Order matters: catalog phải sắp xếp `realm_min(high)` / `quest_status` / `always` từ specific → general.
 */
export type DialogueBranchCondition =
  | { kind: 'always' }
  | { kind: 'realm_min'; realmOrder: number }
  | { kind: 'quest_status'; questKey: string; status: 'available' | 'accepted' | 'completed' | 'claimed' }
  | { kind: 'faction_member'; faction: string };

export interface DialogueChoiceDef {
  /** Choice key unique trong cùng dialogue line. */
  key: string;
  /** Hiển thị Vietnamese (PR-4 sẽ wire i18n). */
  label: string;
  /** Nếu set, click choice navigate sang dialogue id này. */
  nextDialogueId?: string;
  /** Nếu set, click choice trigger accept quest (server-side ở PR-2 quest runtime). */
  acceptQuestKey?: string;
  /** Đóng modal sau khi click. Default false. */
  closeDialogue?: boolean;
}

export interface DialogueLineDef {
  /** Unique id. Format `dlg_<npc>_<variant>`. */
  id: string;
  /** Speaker — phải match `NPCS[].key`. */
  speakerNpcKey: string;
  /** Branch condition. Catalog sắp specific → general. */
  condition: DialogueBranchCondition;
  /** Text Vietnamese (PR-4 i18n). */
  text: string;
  /** Choices cho UI button. Array rỗng = chỉ có nút "Đóng" mặc định. */
  choices: readonly DialogueChoiceDef[];
}

/**
 * Skeleton 4 default dialogue (1 per NPC) + 4 branch dialogue khi player ở realm cao hơn.
 * PR-4 sẽ expand: thêm dialogue accepted / completed / claimed cho từng quest chain.
 */
export const DIALOGUES: readonly DialogueLineDef[] = [
  // ============================================================================
  // Lăng Vân Sinh — chưởng môn Hoa Thiên Môn
  // ============================================================================
  {
    id: 'dlg_lang_van_sinh_default',
    speakerNpcKey: 'npc_lang_van_sinh',
    condition: { kind: 'always' },
    text: 'Đệ tử mới — Hoa Thiên Môn nay đã suy tàn, nhưng đạo thống chưa dứt. Con sẵn sàng nghe ta giao việc chứ?',
    choices: [
      {
        key: 'accept_phamnhan_main',
        label: 'Xin chưởng môn chỉ giáo (nhận Hoa Thiên Tuyển Đồ)',
        acceptQuestKey: 'phamnhan_main_01',
        closeDialogue: true,
      },
      {
        key: 'leave',
        label: 'Đệ tử xin cáo lui.',
        closeDialogue: true,
      },
    ],
  },
  {
    id: 'dlg_lang_van_sinh_truc_co',
    speakerNpcKey: 'npc_lang_van_sinh',
    condition: { kind: 'realm_min', realmOrder: 2 }, // Trúc Cơ
    text: 'Con đã đến Trúc Cơ. Đạo cơ phải vững — nhận Trúc Cơ Đan và chọn hướng tu của riêng con.',
    choices: [
      {
        key: 'accept_truc_co_main',
        label: 'Xin nhận Trúc Đạo Cơ.',
        acceptQuestKey: 'truc_co_main_01',
        closeDialogue: true,
      },
      {
        key: 'leave',
        label: 'Đệ tử xin cáo lui.',
        closeDialogue: true,
      },
    ],
  },

  // ============================================================================
  // Mộc Thanh Y — đại sư tỷ
  // ============================================================================
  {
    id: 'dlg_moc_thanh_y_default',
    speakerNpcKey: 'npc_moc_thanh_y',
    condition: { kind: 'always' },
    text: 'Sư đệ — quy củ tông môn không phải dạng vừa. Tâm tu trước thân tu. Có việc cần con giúp.',
    choices: [
      {
        key: 'accept_phamnhan_sect',
        label: 'Xin nhận Quét Lá Hậu Sơn.',
        acceptQuestKey: 'phamnhan_sect_01',
        closeDialogue: true,
      },
      {
        key: 'accept_phamnhan_grind',
        label: 'Xin nhận Diệt Sơn Thử.',
        acceptQuestKey: 'phamnhan_grind_01',
        closeDialogue: true,
      },
      {
        key: 'accept_phamnhan_npc',
        label: 'Xin sư tỷ giảng linh căn.',
        acceptQuestKey: 'phamnhan_npc_01',
        closeDialogue: true,
      },
      {
        key: 'leave',
        label: 'Đệ tử xin cáo lui.',
        closeDialogue: true,
      },
    ],
  },
  {
    id: 'dlg_moc_thanh_y_luyen_khi',
    speakerNpcKey: 'npc_moc_thanh_y',
    condition: { kind: 'realm_min', realmOrder: 1 }, // Luyện Khí
    text: 'Linh Tuyền Động không phải nơi đi tự do. Có việc tông môn nặng tay hơn — con có dám nhận?',
    choices: [
      {
        key: 'accept_luyenkhi_realm',
        label: 'Xin nhận Linh Tuyền Mở Cửa.',
        acceptQuestKey: 'luyenkhi_realm_01',
        closeDialogue: true,
      },
      {
        key: 'accept_luyenkhi_sect',
        label: 'Xin nhận Hộ Pháp Tông Môn.',
        acceptQuestKey: 'luyenkhi_sect_01',
        closeDialogue: true,
      },
      {
        key: 'accept_luyenkhi_grind',
        label: 'Xin nhận Hắc Mộc Lâm Thanh Tẩy.',
        acceptQuestKey: 'luyenkhi_grind_01',
        closeDialogue: true,
      },
      {
        key: 'leave',
        label: 'Đệ tử xin cáo lui.',
        closeDialogue: true,
      },
    ],
  },

  // ============================================================================
  // Hàn Dạ — Huyền Kiếm Tông rival
  // ============================================================================
  {
    id: 'dlg_han_da_default',
    speakerNpcKey: 'npc_han_da',
    condition: { kind: 'realm_min', realmOrder: 1 }, // Luyện Khí
    text: 'Đệ tử Hoa Thiên Môn — kiếm của con có dám đối kiếm với ta không?',
    choices: [
      {
        key: 'accept_han_da_duel',
        label: 'Xin được lĩnh giáo (nhận Lời Thách Đấu).',
        acceptQuestKey: 'luyenkhi_npc_01',
        closeDialogue: true,
      },
      {
        key: 'leave',
        label: 'Lần khác đi.',
        closeDialogue: true,
      },
    ],
  },

  // ============================================================================
  // Tô Nguyệt Ly — hậu nhân Hoa Thiên lưu đày
  // ============================================================================
  {
    id: 'dlg_to_nguyet_ly_default',
    speakerNpcKey: 'npc_to_nguyet_ly',
    condition: { kind: 'realm_min', realmOrder: 2 }, // Trúc Cơ
    text: 'Đạo hữu… ta biết một điều mà Hoa Thiên Môn không muốn con biết. Có dám nghe không?',
    choices: [
      {
        key: 'accept_to_nguyet_ly_hidden',
        label: 'Xin nghe (nhận Bóng Trong Sương).',
        acceptQuestKey: 'truc_co_npc_01',
        closeDialogue: true,
      },
      {
        key: 'leave',
        label: 'Tạm chưa.',
        closeDialogue: true,
      },
    ],
  },

  // ============================================================================
  // Lăng Vân Sinh — Kim Đan / Nguyên Anh branch
  // ============================================================================
  {
    id: 'dlg_lang_van_sinh_kim_dan',
    speakerNpcKey: 'npc_lang_van_sinh',
    condition: { kind: 'realm_min', realmOrder: 3 }, // Kim Đan
    text: 'Đệ tử… ta cảm thấy Hạt Giống Vô Danh đang cộng hưởng. Tịch Thiên Điện đã ngửi thấy con. Sẵn sàng kết đan chưa?',
    choices: [
      {
        key: 'accept_kim_dan_main',
        label: 'Xin nhận Kết Đan Phong Ba.',
        acceptQuestKey: 'kim_dan_main_01',
        closeDialogue: true,
      },
      {
        key: 'accept_kim_dan_realm',
        label: 'Xin nhận Kim Đan Dị Tượng.',
        acceptQuestKey: 'kim_dan_realm_01',
        closeDialogue: true,
      },
      {
        key: 'leave',
        label: 'Đệ tử xin cáo lui.',
        closeDialogue: true,
      },
    ],
  },
  {
    id: 'dlg_lang_van_sinh_nguyen_anh',
    speakerNpcKey: 'npc_lang_van_sinh',
    condition: { kind: 'realm_min', realmOrder: 4 }, // Nguyên Anh
    text: 'Nguyên Anh xuất khiếu cần tâm vững. Con phải vào Tâm Cảnh Phong Ấn — đối mặt chính mình. Đi cùng ta nhé?',
    choices: [
      {
        key: 'accept_nguyen_anh_main',
        label: 'Xin nhận Nguyên Anh Vấn Tâm.',
        acceptQuestKey: 'nguyen_anh_main_01',
        closeDialogue: true,
      },
      {
        key: 'accept_nguyen_anh_realm',
        label: 'Xin nhận Tâm Cảnh Phá Chấp.',
        acceptQuestKey: 'nguyen_anh_realm_01',
        closeDialogue: true,
      },
      {
        key: 'leave',
        label: 'Đệ tử xin cáo lui.',
        closeDialogue: true,
      },
    ],
  },

  // ============================================================================
  // Mộc Thanh Y — Kim Đan / Nguyên Anh branch (arc cứu sư tỷ kéo dài)
  // ============================================================================
  {
    id: 'dlg_moc_thanh_y_kim_dan',
    speakerNpcKey: 'npc_moc_thanh_y',
    condition: { kind: 'realm_min', realmOrder: 3 }, // Kim Đan
    text: 'Sư đệ… Tịch Linh Chủng trong cơ thể ta lan rộng rồi. Hoa Thiên Kim Trận đang bị yêu thú phá. Đi giúp ta được không?',
    choices: [
      {
        key: 'accept_kim_dan_sect',
        label: 'Xin nhận Phòng Tuyến Hoa Thiên.',
        acceptQuestKey: 'kim_dan_sect_01',
        closeDialogue: true,
      },
      {
        key: 'accept_kim_dan_grind',
        label: 'Xin nhận Săn Bạc Lang Quần.',
        acceptQuestKey: 'kim_dan_grind_01',
        closeDialogue: true,
      },
      {
        key: 'leave',
        label: 'Đệ tử xin cáo lui.',
        closeDialogue: true,
      },
    ],
  },
  {
    id: 'dlg_moc_thanh_y_nguyen_anh',
    speakerNpcKey: 'npc_moc_thanh_y',
    condition: { kind: 'realm_min', realmOrder: 4 }, // Nguyên Anh
    text: 'Tâm cảnh ta đã phong ấn… Nếu con vào, có thể không trở ra được. Nhưng nếu con không cứu — Tịch Linh Chủng sẽ ăn nốt linh thức ta.',
    choices: [
      {
        key: 'accept_nguyen_anh_sect',
        label: 'Đệ tử xin vào tâm cảnh sư tỷ (nhận Tâm Ma Của Đại Sư Tỷ).',
        acceptQuestKey: 'nguyen_anh_sect_01',
        closeDialogue: true,
      },
      {
        key: 'accept_nguyen_anh_grind',
        label: 'Xin nhận Hoang Thổ Huyết Tế trước.',
        acceptQuestKey: 'nguyen_anh_grind_01',
        closeDialogue: true,
      },
      {
        key: 'leave',
        label: 'Để đệ tử nghĩ thêm.',
        closeDialogue: true,
      },
    ],
  },

  // ============================================================================
  // Huyết La Sát — ma tu bị Hoa Thiên ruồng bỏ (Kim Đan unlock)
  // ============================================================================
  {
    id: 'dlg_huyet_la_sat_default',
    speakerNpcKey: 'npc_huyet_la_sat',
    condition: { kind: 'realm_min', realmOrder: 3 }, // Kim Đan
    text: 'Hậu bối Hoa Thiên… con muốn biết sự thật về tông môn của mình không? Hay con chỉ muốn nghe lời chưởng môn?',
    choices: [
      {
        key: 'accept_kim_dan_npc',
        label: 'Đệ tử xin nghe (nhận Máu Trên Thềm Đá).',
        acceptQuestKey: 'kim_dan_npc_01',
        closeDialogue: true,
      },
      {
        key: 'accept_nguyen_anh_npc',
        label: 'Tiếp tục đêm trảm niệm (nhận Đêm Trảm Niệm).',
        acceptQuestKey: 'nguyen_anh_npc_01',
        closeDialogue: true,
      },
      {
        key: 'leave',
        label: 'Ta không tin ma tu.',
        closeDialogue: true,
      },
    ],
  },

  // ============================================================================
  // Phase 21 — extended important NPC quick dialogues
  // ============================================================================
  {
    id: 'dlg_a_linh_default',
    speakerNpcKey: 'npc_a_linh',
    condition: { kind: 'always' },
    text: 'Sư huynh mới tới phải không? Ta là A Linh. Đi chậm thôi: nhận túi, thử hô hấp, rồi mới chạy ra Sơn Cốc — không ai thành tiên trong một bữa cơm.',
    choices: [
      { key: 'guided_path', label: 'Nhờ A Linh chỉ đường nhập môn.', closeDialogue: true },
      { key: 'leave', label: 'Ta tự xem trước.', closeDialogue: true },
    ],
  },
  {
    id: 'dlg_van_kim_nuong_default',
    speakerNpcKey: 'npc_van_kim_nuong',
    condition: { kind: 'realm_min', realmOrder: 1 },
    text: 'Hoa Thiên Môn lại có người xuống núi mua đồ? Ta bán theo giá thị trường, nhưng tin tức thì phải trả bằng độ tin cậy.',
    choices: [
      { key: 'market_rules', label: 'Hỏi về quy củ Vạn Bảo Thương Hội.', closeDialogue: true },
      { key: 'leave', label: 'Lần sau giao dịch.', closeDialogue: true },
    ],
  },
  {
    id: 'dlg_bach_de_tu_default',
    speakerNpcKey: 'npc_bach_de_tu',
    condition: { kind: 'realm_min', realmOrder: 4 },
    text: 'Phàm tu Hoa Thiên cũng dám hỏi tiên luật? Đừng vội giận. Trật tự có giá của nó, tự do cũng có giá của nó.',
    choices: [
      { key: 'ask_immortal_law', label: 'Hỏi vì sao tiên luật cần khoá đường tu.', closeDialogue: true },
      { key: 'leave', label: 'Không nghe lời cao ngạo.', closeDialogue: true },
    ],
  },
  {
    id: 'dlg_tich_linh_su_gia_default',
    speakerNpcKey: 'npc_tich_linh_su_gia',
    condition: { kind: 'realm_min', realmOrder: 2 },
    text: 'Ngươi gọi đó là Tịch Linh khí vì sợ nó. Ta gọi đó là yên tĩnh: không tranh đoạt, không thiên kiếp, không kẻ yếu chết vì mộng thành tiên.',
    choices: [
      { key: 'reject_silence', label: 'Đạo của ta không cần sự yên tĩnh cưỡng ép.', closeDialogue: true },
      { key: 'leave', label: 'Rời khỏi đạo âm lạnh.', closeDialogue: true },
    ],
  },
  {
    id: 'dlg_huyet_ha_su_gia_default',
    speakerNpcKey: 'npc_huyet_ha_su_gia',
    condition: { kind: 'realm_min', realmOrder: 3 },
    text: 'Chính đạo gọi bọn ta là ma. Nhưng khi họ đuổi một người vào đường cùng, họ vẫn gọi mình là sạch sẽ. Ngươi muốn mua gì: thuốc, tin, hay sự thật?',
    choices: [
      { key: 'ask_demonic_market', label: 'Hỏi về chợ đen và Huyết La Sát.', closeDialogue: true },
      { key: 'leave', label: 'Không giao dịch với huyết khí.', closeDialogue: true },
    ],
  },
  {
    id: 'dlg_hoa_thien_dao_to_default',
    speakerNpcKey: 'npc_hoa_thien_dao_to',
    condition: { kind: 'realm_min', realmOrder: 4 },
    text: 'Tàn niệm này chỉ giữ được một câu: vá trời không phải thắng trời, mà là để chúng sinh còn quyền tự bước tiếp.',
    choices: [
      { key: 'receive_ancestral_echo', label: 'Ghi nhớ lời tổ sư.', closeDialogue: true },
      { key: 'leave', label: 'Cúi đầu rời phong ấn.', closeDialogue: true },
    ],
  },
  {
    id: 'dlg_tich_thien_dao_chu_default',
    speakerNpcKey: 'npc_tich_thien_dao_chu',
    condition: { kind: 'realm_min', realmOrder: 4 },
    text: 'Tự do tu tiên? Các ngươi gọi lòng tham bằng mỹ từ đại đạo. Một ngày nào đó, chính các ngươi sẽ cầu xin ta khoá con đường này.',
    choices: [
      { key: 'deny_locked_dao', label: 'Không ai được thay chúng sinh chọn đạo.', closeDialogue: true },
      { key: 'leave', label: 'Cắt đứt đạo âm.', closeDialogue: true },
    ],
  },

] as const;

export function dialogueById(id: string): DialogueLineDef | undefined {
  return DIALOGUES.find((d) => d.id === id);
}

export function dialoguesByNpc(npcKey: string): DialogueLineDef[] {
  return DIALOGUES.filter((d) => d.speakerNpcKey === npcKey);
}

/**
 * Server-authoritative branch picker — Phase 12 PR-4 `GET /npc/:id/dialogue` sẽ wrap function này.
 * Trả về dialogue đầu tiên thoả mãn condition theo thứ tự catalog.
 *
 * Lưu ý: PR-1 KHÔNG implement `quest_status` / `faction_member` filter (cần runtime). PR-4 sẽ
 * implement đầy đủ. PR-1 chỉ filter `always` + `realm_min`.
 */
export function pickDialogueForNpc(
  npcKey: string,
  realmOrder: number,
): DialogueLineDef | undefined {
  const candidates = dialoguesByNpc(npcKey);
  // Specific (high realm_min) trước, sau đó always (catalog order trong cùng NPC).
  const sorted = [...candidates].sort((a, b) => {
    const ar = a.condition.kind === 'realm_min' ? a.condition.realmOrder : -1;
    const br = b.condition.kind === 'realm_min' ? b.condition.realmOrder : -1;
    return br - ar;
  });
  return sorted.find((d) => {
    if (d.condition.kind === 'always') return true;
    if (d.condition.kind === 'realm_min') return realmOrder >= d.condition.realmOrder;
    // quest_status / faction_member: chưa implement runtime filter ở PR-1.
    return false;
  });
}
