/**
 * Story dialogue foundation — Phase 12 Story Dialogue Foundation PR.
 *
 * Layer hội thoại nhánh độc lập với `dialogues.ts` (Phase 12 PR-1) — file đó là
 * "NPC quick-accept dialog" (mở modal → 1 line text → choice = accept quest).
 * File này thêm tầng "story dialogue node" branching thật:
 *
 *   - Mỗi `StoryDialogueNodeDef` là một line text + nhiều `StoryDialogueChoiceDef`.
 *   - Choice có `effects[]` server-side: `mark_seen`, `advance_quest_step`,
 *     `give_reward`, `set_flag`, `clear_flag` (ECONOMY_MODEL §3 — tiny rewards,
 *     không break balance). `clear_flag` cho phép plot reversal sau khi player
 *     đổi quan hệ với NPC (vd apology arc).
 *   - Choice có thể `nextNodeId` → modal load tiếp node mới.
 *   - Node có `conditions[]` — chỉ visible khi mọi condition true. Server filter
 *     khi `GET /story/dialogue/:npcKey` (specificity score: highest first).
 *   - Choice cũng có `conditions[]` — disabled (nhưng vẫn render) nếu fail, để
 *     player thấy "lựa chọn bị khoá" thay vì biến mất bí ẩn.
 *
 * Phase 12.9 Story Dialogue Branch Advanced thêm:
 *   - Condition `choice_made { nodeId, choiceKey }` — branch theo lựa chọn
 *     player đã pick ở node trước (NPC nhớ lựa chọn cũ → followup khác nhau).
 *   - Effect `clear_flag` — cho phép undo `set_flag` trong arc kết thúc.
 *   - Multi-step branching tree (vd Hàn Dạ first_meet → followup_rival/neutral
 *     → resolution_apology) chứng minh NPC nhớ + branch + revert được.
 *
 * Persistence:
 *   - `Character.storyDialogueSeen` (Json array of nodeId) — mark-seen idempotent.
 *   - `Character.storyDialogueChoices` (Json map nodeId → choiceKey, Phase 12.9)
 *     — last-write-wins per node, dùng cho `choice_made` condition.
 *   - `Character.storyFlags` (Json map flagKey → value) — set-flag idempotent;
 *     `clear_flag` xoá entry.
 *   - Quest progress vẫn đi qua `QuestProgress` (PR-2) + `QuestService.progress`.
 *
 * Source design: spec Phase 12 Story Dialogue Foundation + Phase 12.9 advanced.
 *
 * Naming convention: `story_dlg_<npc_key>_<arc>_<seq>`.
 *
 * Đặt tên `StoryDialogueNodeDef` / `StoryDialogueChoiceDef` để KHÔNG xung đột với
 * `DialogueLineDef` / `DialogueChoiceDef` của catalog cũ (`dialogues.ts`).
 * Spec gốc dùng "DialogueNodeDef / DialogueChoiceDef" — file này map alias.
 */

import { NPCS } from './npcs';
import { QUESTS } from './quests';

/** Story flag value — chỉ scalar primitive cho dễ serialize JSON + invariant test. */
export type StoryFlagValue = string | number | boolean;

/**
 * Visibility / availability condition cho `StoryDialogueNodeDef` &
 * `StoryDialogueChoiceDef`.
 *
 * Tất cả conditions trong array phải true để node/choice "match". Nếu rỗng /
 * undefined → coi như `[{kind:'always'}]`.
 */
export type StoryDialogueCondition =
  | { kind: 'always' }
  | { kind: 'realm_min'; realmOrder: number }
  | {
      kind: 'quest_status';
      questKey: string;
      status: 'available' | 'accepted' | 'completed' | 'claimed';
    }
  | { kind: 'flag_equals'; flagKey: string; value: StoryFlagValue }
  | { kind: 'flag_set'; flagKey: string }
  | { kind: 'flag_unset'; flagKey: string }
  | { kind: 'seen'; nodeId: string }
  | { kind: 'not_seen'; nodeId: string }
  /**
   * Phase 12.9 — match khi player đã pick `choiceKey` ở `nodeId` trước đó
   * (`Character.storyDialogueChoices[nodeId] === choiceKey`). Cho phép
   * NPC nhớ lựa chọn cũ + render follow-up branching khác nhau.
   */
  | { kind: 'choice_made'; nodeId: string; choiceKey: string };

/**
 * Effect áp dụng server-side khi player chọn choice. Apply tuần tự theo thứ tự
 * trong array. KHÔNG fail-soft individually — nếu effect fail (vd quest chưa
 * accept với `advance_quest_step`), service bubble error code (`INVALID_CHOICE`).
 *
 * `give_reward` tổng cap: `linhThach <= 100`, `tienNgoc <= 5`, `exp <= 200`
 * (tránh dialogue bypass quest reward — invariant test ENFORCED).
 */
export type StoryDialogueEffect =
  | { kind: 'mark_seen' }
  | {
      kind: 'advance_quest_step';
      questKey: string;
      stepId: string;
      amount?: number;
    }
  | {
      kind: 'give_reward';
      linhThach?: number;
      tienNgoc?: number;
      exp?: number;
    }
  | { kind: 'set_flag'; flagKey: string; value: StoryFlagValue }
  /**
   * Phase 12.9 — xoá flag khỏi `Character.storyFlags` (no-op nếu chưa set).
   * Cho phép plot reversal trong arc kết thúc (vd apology xoá relation flag).
   */
  | { kind: 'clear_flag'; flagKey: string };

/**
 * Choice trong story dialogue node. `label` là Vietnamese hardcoded; `labelEn`
 * optional cho i18n. FE pick `label` theo locale.
 */
export interface StoryDialogueChoiceDef {
  /** Key unique trong cùng node. */
  key: string;
  /** Vietnamese label. */
  label: string;
  /** English label (optional fallback — vẫn render `label` nếu trống). */
  labelEn?: string;
  /** Conditions để choice clickable. Fail → render disabled. */
  conditions?: readonly StoryDialogueCondition[];
  /** Effects áp dụng tuần tự khi pick. `mark_seen` cho NODE PARENT luôn implicit. */
  effects?: readonly StoryDialogueEffect[];
  /** Nếu set, server trả về node mới sau khi apply effects; nếu null → đóng modal. */
  nextNodeId?: string;
}

export interface StoryDialogueNodeDef {
  /** Unique id. Format `story_dlg_<npc_key>_<arc>_<seq>`. */
  id: string;
  /** Speaker — phải match `NPCS[].key`. */
  npcKey: string;
  /** Optional quest binding (link với quest chain để gating dễ trace). */
  questKey?: string;
  /** Conditions để node visible. `[]`/undefined → always. */
  conditions?: readonly StoryDialogueCondition[];
  /** Vietnamese text. */
  text: string;
  /** English text (optional). */
  textEn?: string;
  /** Choices — empty = chỉ có button đóng. */
  choices: readonly StoryDialogueChoiceDef[];
}

/**
 * Reward cap cho `give_reward` effect. Phase 12 Story Dialogue Foundation
 * cố ý giữ reward NHỎ — KHÔNG thay quest claim. `BALANCE_MODEL.md` đặt cap để
 * dialogue choice KHÔNG farm vô tận.
 */
export const STORY_DIALOGUE_REWARD_CAP = {
  linhThach: 100,
  tienNgoc: 5,
  exp: 200,
} as const;

/**
 * Catalog các node story dialogue mẫu cho 3 cảnh giới đầu (Phàm Nhân + Luyện Khí).
 * Foundation PR — chỉ vài node đại diện exercise đủ 4 effect kind. Các PR
 * story sau sẽ mở rộng với arc rõ ràng hơn.
 */
export const STORY_DIALOGUES: readonly StoryDialogueNodeDef[] = [
  // ============================================================================
  // Lăng Vân Sinh — chưởng môn Hoa Thiên Môn (Phàm Nhân entry)
  // ============================================================================
  {
    id: 'story_dlg_lang_van_sinh_chapter_1_intro',
    npcKey: 'npc_lang_van_sinh',
    conditions: [{ kind: 'realm_min', realmOrder: 0 }],
    text: 'Đệ tử mới — Hoa Thiên Môn nay đã suy tàn, nhưng đạo thống chưa dứt. Hôm nay con đã đứng trên Hoa Thiên Sơn, ta muốn nghe lòng con thật.',
    textEn:
      'New disciple — though the Hoa Thiên Sect has fallen, our path is not yet broken. Now that you stand upon the mountain, I want to hear your true heart.',
    choices: [
      {
        key: 'respect',
        label: 'Đệ tử lắng nghe chưởng môn dạy bảo.',
        labelEn: 'Disciple listens attentively, sect master.',
        effects: [
          { kind: 'set_flag', flagKey: 'attitude_lang_van_sinh', value: 'respect' },
          { kind: 'give_reward', linhThach: 20 },
          { kind: 'mark_seen' },
        ],
      },
      {
        key: 'doubt',
        label: 'Tông môn suy tàn… đệ tử không chắc còn đáng theo.',
        labelEn: 'A fallen sect… the disciple is not sure it is worth following.',
        effects: [
          { kind: 'set_flag', flagKey: 'attitude_lang_van_sinh', value: 'doubt' },
          { kind: 'mark_seen' },
        ],
      },
      {
        key: 'ask_seed',
        label: 'Đệ tử nghe hậu sơn có Hạt Giống Vô Danh — chưởng môn có biết?',
        labelEn:
          'I have heard there is a Seed of the Nameless in the back mountain — does the sect master know of it?',
        nextNodeId: 'story_dlg_lang_van_sinh_seed_truth',
        // Không closeDialogue — modal load node tiếp.
      },
    ],
  },
  {
    id: 'story_dlg_lang_van_sinh_seed_truth',
    npcKey: 'npc_lang_van_sinh',
    questKey: 'phamnhan_realm_01',
    /**
     * Visible mặc định CHỈ khi player đã accept quest seed (= đã đi qua choice
     * chain `ask_seed` từ intro → accept). Player từ intro vẫn có thể navigate
     * tới đây bất kể status (qua `nextNodeId`) — server chỉ filter pick-default.
     * `not_seen` để node biến mất khỏi default rotation sau khi đã chọn xong.
     */
    conditions: [
      { kind: 'realm_min', realmOrder: 0 },
      { kind: 'quest_status', questKey: 'phamnhan_realm_01', status: 'accepted' },
      { kind: 'not_seen', nodeId: 'story_dlg_lang_van_sinh_seed_truth' },
    ],
    text: 'Hạt Giống ấy là mảnh truyền thừa cuối cùng… Ta cấm đệ tử thường vào, nhưng nếu con muốn, ta sẽ không cản. Nguy hiểm, nhưng không dối lừa con.',
    textEn:
      'That seed is the last shard of our inheritance… I forbid common disciples from entering, yet if you wish to seek it, I shall not stand in your way. Dangerous, but I shall not deceive you.',
    choices: [
      {
        key: 'accept',
        label: 'Đệ tử tự nguyện đi. Xin chưởng môn ban phép.',
        labelEn: 'Disciple goes willingly. Sect master, grant me leave.',
        conditions: [{ kind: 'quest_status', questKey: 'phamnhan_realm_01', status: 'accepted' }],
        effects: [
          {
            kind: 'advance_quest_step',
            questKey: 'phamnhan_realm_01',
            stepId: 'step_01',
          },
          { kind: 'set_flag', flagKey: 'seed_lore_unlocked', value: true },
          { kind: 'mark_seen' },
        ],
      },
      {
        key: 'decline',
        label: 'Đệ tử… chưa sẵn sàng.',
        labelEn: 'Disciple is not yet ready.',
        effects: [{ kind: 'mark_seen' }],
      },
    ],
  },

  // ============================================================================
  // Mộc Thanh Y — linh căn vấn đáp (gắn `phamnhan_npc_01` choice step)
  // ============================================================================
  {
    id: 'story_dlg_moc_thanh_y_linh_can',
    npcKey: 'npc_moc_thanh_y',
    questKey: 'phamnhan_npc_01',
    conditions: [
      { kind: 'realm_min', realmOrder: 0 },
      { kind: 'quest_status', questKey: 'phamnhan_npc_01', status: 'accepted' },
    ],
    text: 'Sư đệ — linh căn ngũ hành định hướng tu, nhưng tâm con định bản thân. Hôm nay, con chọn hướng nào trước?',
    textEn:
      'Junior — the five elements decide one’s path of cultivation, yet the heart decides oneself. Today, which path do you choose?',
    choices: [
      {
        key: 'kim',
        label: 'Đệ tử chọn Kim — chí hướng kiên định, không lùi.',
        labelEn: 'I choose Metal — steadfast, never retreating.',
        effects: [
          { kind: 'set_flag', flagKey: 'linh_can_path', value: 'kim' },
          {
            kind: 'advance_quest_step',
            questKey: 'phamnhan_npc_01',
            stepId: 'step_02',
          },
          { kind: 'give_reward', exp: 50 },
          { kind: 'mark_seen' },
        ],
      },
      {
        key: 'moc',
        label: 'Đệ tử chọn Mộc — sinh trưởng bao dung, tâm tu trước thân tu.',
        labelEn: 'I choose Wood — growth and tolerance, mind before body.',
        effects: [
          { kind: 'set_flag', flagKey: 'linh_can_path', value: 'moc' },
          {
            kind: 'advance_quest_step',
            questKey: 'phamnhan_npc_01',
            stepId: 'step_02',
          },
          { kind: 'give_reward', exp: 50 },
          { kind: 'mark_seen' },
        ],
      },
      {
        key: 'thuy',
        label: 'Đệ tử chọn Thuỷ — uyển chuyển, theo dòng mà phá đá.',
        labelEn: 'I choose Water — flowing, breaking stone by patience.',
        effects: [
          { kind: 'set_flag', flagKey: 'linh_can_path', value: 'thuy' },
          {
            kind: 'advance_quest_step',
            questKey: 'phamnhan_npc_01',
            stepId: 'step_02',
          },
          { kind: 'give_reward', exp: 50 },
          { kind: 'mark_seen' },
        ],
      },
    ],
  },

  // ============================================================================
  // Hàn Dạ — first meeting (Luyện Khí), set quan hệ rival/neutral
  // ============================================================================
  {
    id: 'story_dlg_han_da_first_meet',
    npcKey: 'npc_han_da',
    conditions: [
      { kind: 'realm_min', realmOrder: 1 },
      { kind: 'not_seen', nodeId: 'story_dlg_han_da_first_meet' },
    ],
    text: 'Đệ tử Hoa Thiên — kiếm của con có dám lên tiếng không? Hay chỉ biết quét lá hậu sơn?',
    textEn:
      'Disciple of Hoa Thiên — does your sword dare speak, or does it only sweep leaves on the back mountain?',
    choices: [
      {
        key: 'rival',
        label: 'Lần sau, kiếm sẽ trả lời thay đệ tử.',
        labelEn: 'Next time, my sword shall answer for me.',
        effects: [
          { kind: 'set_flag', flagKey: 'han_da_relation', value: 'rival' },
          { kind: 'mark_seen' },
        ],
      },
      {
        key: 'neutral',
        label: 'Ta không đến đây để gây sự với huynh.',
        labelEn: 'I did not come here to quarrel with you.',
        effects: [
          { kind: 'set_flag', flagKey: 'han_da_relation', value: 'neutral' },
          { kind: 'mark_seen' },
        ],
      },
    ],
  },

  // ============================================================================
  // Hàn Dạ — Phase 12.9 multi-step branching tree.
  //
  //   first_meet (rival) → followup_rival (spar / decline) → resolution_apology
  //   first_meet (neutral) → followup_neutral (study / part)
  //
  // Server pick node theo specificity: `choice_made` (5) cao hơn `flag_equals` (4),
  // nên followup_rival/neutral pick \u01b0u tiên hơn các node fallback. Resolution
  // arc dùng `clear_flag` để xoá `han_da_relation` (revert sang neutral).
  // ============================================================================
  {
    id: 'story_dlg_han_da_followup_rival',
    npcKey: 'npc_han_da',
    conditions: [
      { kind: 'realm_min', realmOrder: 1 },
      {
        kind: 'choice_made',
        nodeId: 'story_dlg_han_da_first_meet',
        choiceKey: 'rival',
      },
      { kind: 'not_seen', nodeId: 'story_dlg_han_da_followup_rival' },
    ],
    text: 'Lần trước đệ tử nói kiếm sẽ trả lời. Hôm nay ta chờ — một chiêu, không hơn không kém.',
    textEn:
      'Last time you said your sword would answer. Today I wait — one strike, no more, no less.',
    choices: [
      {
        key: 'spar',
        label: 'Đệ tử chấp nhận. Một chiêu, kiếm trả lời.',
        labelEn: 'I accept. One strike, my sword answers.',
        effects: [
          { kind: 'set_flag', flagKey: 'han_da_spar_arranged', value: true },
          { kind: 'give_reward', linhThach: 30 },
          { kind: 'mark_seen' },
        ],
      },
      {
        key: 'decline',
        label: 'Đệ tử rút lại lời cũ. Hôm nay không tiện.',
        labelEn: 'I take back my words. Today is not the time.',
        effects: [{ kind: 'mark_seen' }],
      },
    ],
  },
  {
    id: 'story_dlg_han_da_followup_neutral',
    npcKey: 'npc_han_da',
    conditions: [
      { kind: 'realm_min', realmOrder: 1 },
      {
        kind: 'choice_made',
        nodeId: 'story_dlg_han_da_first_meet',
        choiceKey: 'neutral',
      },
      { kind: 'not_seen', nodeId: 'story_dlg_han_da_followup_neutral' },
    ],
    text: 'Đệ tử không gây sự thì ta không phiền. Nhưng kiếm cô đơn thì rỉ — muốn cùng ta luyện một chiêu không?',
    textEn:
      'If you do not quarrel, I do not mind. Yet a lonely sword rusts — care to drill a strike with me?',
    choices: [
      {
        key: 'study',
        label: 'Đệ tử xin học. Phiền huynh chỉ giáo.',
        labelEn: 'I beg to learn. Please instruct me.',
        effects: [
          { kind: 'set_flag', flagKey: 'han_da_mentor', value: true },
          { kind: 'give_reward', linhThach: 20, exp: 30 },
          { kind: 'mark_seen' },
        ],
      },
      {
        key: 'part_ways',
        label: 'Đệ tử cảm tạ, song đường ai nấy đi.',
        labelEn: 'I thank you, but our paths must part.',
        effects: [{ kind: 'mark_seen' }],
      },
    ],
  },
  {
    id: 'story_dlg_han_da_resolution_apology',
    npcKey: 'npc_han_da',
    /**
     * Visible khi player đã chấp nhận spar (rival path) nhưng giờ muốn xin lỗi.
     * Effect `clear_flag` xoá `han_da_relation` flag (revert sang neutral) —
     * mirror narrative reconciliation. KHÔNG đụng `han_da_spar_arranged` (giữ
     * lịch sử spar). Specificity: choice_made + flag_equals + seen + not_seen
     * → max(5,4,3) = 5 (cao hơn first_meet/followup chuẩn).
     */
    conditions: [
      { kind: 'realm_min', realmOrder: 1 },
      { kind: 'flag_equals', flagKey: 'han_da_relation', value: 'rival' },
      { kind: 'seen', nodeId: 'story_dlg_han_da_followup_rival' },
      { kind: 'not_seen', nodeId: 'story_dlg_han_da_resolution_apology' },
    ],
    text: 'Sau trận đấu hôm trước, đệ tử nghĩ lại — kiếm thật không đáng vung vào người đồng môn. Xin huynh xí xoá lời cũ.',
    textEn:
      'After our duel, I have reflected — a sword should not be drawn upon a fellow disciple. Please forget my earlier words.',
    choices: [
      {
        key: 'apologize',
        label: 'Đệ tử xin lỗi. Quan hệ cũ, xí xoá.',
        labelEn: 'I apologize. Let the old enmity be erased.',
        effects: [
          { kind: 'clear_flag', flagKey: 'han_da_relation' },
          { kind: 'mark_seen' },
        ],
      },
      {
        key: 'stand',
        label: 'Đệ tử giữ lời. Kiếm vẫn còn.',
        labelEn: 'I stand by my words. The sword remains.',
        effects: [{ kind: 'mark_seen' }],
      },
    ],
  },
] as const;

// ============================================================================
// Helpers — pure (không đụng runtime). Service consume.
// ============================================================================

export function storyDialogueNodeById(id: string): StoryDialogueNodeDef | undefined {
  return STORY_DIALOGUES.find((d) => d.id === id);
}

export function storyDialogueNodesByNpc(npcKey: string): StoryDialogueNodeDef[] {
  return STORY_DIALOGUES.filter((d) => d.npcKey === npcKey);
}

/**
 * Score node theo condition specificity (dùng để pick ưu tiên):
 *   `quest_status`/`choice_made` > `flag_equals`/`flag_set` > `seen`/`not_seen`
 *   > `realm_min` > `always`.
 *
 * Trong cùng kind, lấy max của tất cả condition (vd `realm_min` cao hơn ưu tiên hơn).
 */
export function storyDialogueNodeSpecificity(node: StoryDialogueNodeDef): number {
  const conds = node.conditions ?? [{ kind: 'always' as const }];
  let best = 1;
  for (const c of conds) {
    let score = 1;
    switch (c.kind) {
      case 'always':
        score = 1;
        break;
      case 'realm_min':
        score = 2 + c.realmOrder * 0.01;
        break;
      case 'seen':
      case 'not_seen':
        score = 3;
        break;
      case 'flag_set':
      case 'flag_unset':
      case 'flag_equals':
        score = 4;
        break;
      case 'quest_status':
      case 'choice_made':
        score = 5;
        break;
    }
    if (score > best) best = score;
  }
  return best;
}

/**
 * Tổng `give_reward` của 1 choice — service / invariant test reuse để verify cap.
 */
export function totalChoiceReward(choice: StoryDialogueChoiceDef): {
  linhThach: number;
  tienNgoc: number;
  exp: number;
} {
  let linhThach = 0;
  let tienNgoc = 0;
  let exp = 0;
  for (const e of choice.effects ?? []) {
    if (e.kind !== 'give_reward') continue;
    linhThach += e.linhThach ?? 0;
    tienNgoc += e.tienNgoc ?? 0;
    exp += e.exp ?? 0;
  }
  return { linhThach, tienNgoc, exp };
}

/**
 * Tập hợp các flag key được referenced trong catalog (dùng admin / debug UI / test).
 */
export function storyDialogueAllFlagKeys(): readonly string[] {
  const keys = new Set<string>();
  for (const node of STORY_DIALOGUES) {
    for (const c of node.conditions ?? []) {
      if (c.kind === 'flag_equals' || c.kind === 'flag_set' || c.kind === 'flag_unset') {
        keys.add(c.flagKey);
      }
    }
    for (const choice of node.choices) {
      for (const c of choice.conditions ?? []) {
        if (c.kind === 'flag_equals' || c.kind === 'flag_set' || c.kind === 'flag_unset') {
          keys.add(c.flagKey);
        }
      }
      for (const e of choice.effects ?? []) {
        if (e.kind === 'set_flag' || e.kind === 'clear_flag') keys.add(e.flagKey);
      }
    }
  }
  return [...keys].sort();
}

/**
 * Tập hợp các quest key được referenced trong catalog (verify exist trong QUESTS).
 */
export function storyDialogueAllQuestKeys(): readonly string[] {
  const keys = new Set<string>();
  for (const node of STORY_DIALOGUES) {
    if (node.questKey) keys.add(node.questKey);
    for (const c of node.conditions ?? []) {
      if (c.kind === 'quest_status') keys.add(c.questKey);
    }
    for (const choice of node.choices) {
      for (const c of choice.conditions ?? []) {
        if (c.kind === 'quest_status') keys.add(c.questKey);
      }
      for (const e of choice.effects ?? []) {
        if (e.kind === 'advance_quest_step') keys.add(e.questKey);
      }
    }
  }
  return [...keys].sort();
}

/**
 * Validate catalog — service init + test invariant. Trả mảng error string;
 * empty = OK. Không throw để caller chọn xử lý (test fail-fast vs runtime warn).
 */
export function validateStoryDialogueCatalog(): string[] {
  const errs: string[] = [];
  const npcKeys = new Set(NPCS.map((n) => n.key));
  const questKeys = new Set(QUESTS.map((q) => q.key));
  const ids = new Set<string>();

  // Collect (nodeId → set of choiceKey) trước để validate `choice_made` /
  // `seen` / `not_seen` reference vào node + choice có tồn tại.
  const choiceMap = new Map<string, Set<string>>();
  for (const node of STORY_DIALOGUES) {
    const set = new Set<string>();
    for (const c of node.choices) set.add(c.key);
    choiceMap.set(node.id, set);
  }

  function validateConditionRef(
    where: string,
    cond: StoryDialogueCondition,
  ): void {
    if (cond.kind === 'seen' || cond.kind === 'not_seen') {
      if (!choiceMap.has(cond.nodeId)) {
        errs.push(`${where} ${cond.kind} references unknown nodeId ${cond.nodeId}`);
      }
    }
    if (cond.kind === 'choice_made') {
      const set = choiceMap.get(cond.nodeId);
      if (!set) {
        errs.push(`${where} choice_made references unknown nodeId ${cond.nodeId}`);
      } else if (!set.has(cond.choiceKey)) {
        errs.push(
          `${where} choice_made references unknown choiceKey ${cond.choiceKey} in node ${cond.nodeId}`,
        );
      }
    }
  }

  for (const node of STORY_DIALOGUES) {
    if (ids.has(node.id)) errs.push(`Duplicate node id: ${node.id}`);
    ids.add(node.id);
    if (!node.id.startsWith('story_dlg_')) {
      errs.push(`Node id must start with story_dlg_: ${node.id}`);
    }
    if (!npcKeys.has(node.npcKey)) {
      errs.push(`Node ${node.id} references unknown npcKey ${node.npcKey}`);
    }
    if (node.questKey && !questKeys.has(node.questKey)) {
      errs.push(`Node ${node.id} references unknown questKey ${node.questKey}`);
    }
    if (node.text.length === 0) errs.push(`Node ${node.id} text is empty`);
    for (const c of node.conditions ?? []) {
      validateConditionRef(`Node ${node.id}`, c);
    }

    const choiceKeys = new Set<string>();
    for (const choice of node.choices) {
      if (choiceKeys.has(choice.key)) {
        errs.push(`Node ${node.id} duplicate choice key: ${choice.key}`);
      }
      choiceKeys.add(choice.key);
      if (choice.label.length === 0) {
        errs.push(`Node ${node.id} choice ${choice.key} has empty label`);
      }
      if (choice.nextNodeId && !STORY_DIALOGUES.find((n) => n.id === choice.nextNodeId)) {
        errs.push(
          `Node ${node.id} choice ${choice.key} nextNodeId ${choice.nextNodeId} not found`,
        );
      }
      for (const c of choice.conditions ?? []) {
        validateConditionRef(`Node ${node.id} choice ${choice.key}`, c);
      }
      const reward = totalChoiceReward(choice);
      if (reward.linhThach > STORY_DIALOGUE_REWARD_CAP.linhThach) {
        errs.push(
          `Node ${node.id} choice ${choice.key} linhThach ${reward.linhThach} > cap ${STORY_DIALOGUE_REWARD_CAP.linhThach}`,
        );
      }
      if (reward.tienNgoc > STORY_DIALOGUE_REWARD_CAP.tienNgoc) {
        errs.push(
          `Node ${node.id} choice ${choice.key} tienNgoc ${reward.tienNgoc} > cap ${STORY_DIALOGUE_REWARD_CAP.tienNgoc}`,
        );
      }
      if (reward.exp > STORY_DIALOGUE_REWARD_CAP.exp) {
        errs.push(
          `Node ${node.id} choice ${choice.key} exp ${reward.exp} > cap ${STORY_DIALOGUE_REWARD_CAP.exp}`,
        );
      }
      for (const e of choice.effects ?? []) {
        if (e.kind === 'advance_quest_step') {
          if (!questKeys.has(e.questKey)) {
            errs.push(
              `Node ${node.id} choice ${choice.key} advance_quest_step questKey ${e.questKey} not found`,
            );
          } else {
            const def = QUESTS.find((q) => q.key === e.questKey);
            if (def && !def.steps.find((s) => s.id === e.stepId)) {
              errs.push(
                `Node ${node.id} choice ${choice.key} advance_quest_step stepId ${e.stepId} not in quest ${e.questKey}`,
              );
            }
          }
        }
      }
    }
  }
  return errs;
}
