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
