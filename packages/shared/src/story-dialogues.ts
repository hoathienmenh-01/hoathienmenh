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
import {
  AFFINITY_DELTA_CAP_PER_CHOICE,
  npcAffinityDefForKey,
} from './npc-affinity';

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
  | { kind: 'choice_made'; nodeId: string; choiceKey: string }
  /**
   * Phase 12.10.A — match khi `CharacterNpcAffinity[npcKey].score >= score`.
   * Gate node/choice theo điểm thân thiện với NPC. Nếu character chưa có
   * row, server fallback `initialScore` của catalog (`NpcAffinityDef`).
   */
  | { kind: 'affinity_min'; npcKey: string; score: number };

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
  | { kind: 'clear_flag'; flagKey: string }
  /**
   * Phase 12.10.A — cộng `delta` điểm thân thiện vào
   * `CharacterNpcAffinity[npcKey].score` (server clamp `[minScore, maxScore]`).
   * `delta` có thể âm (giảm thân thiện). Cap `|delta| <=
   * AFFINITY_DELTA_CAP_PER_CHOICE` enforce ở `validateStoryDialogueCatalog()`.
   * Idempotency: gắn `change_affinity` vào `hasGrantEffect` group → re-pick
   * cùng choice với node đã `seen` throw `ALREADY_APPLIED` (giống `give_reward`).
   */
  | { kind: 'change_affinity'; npcKey: string; delta: number };

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

  // ============================================================================
  // Phase 12.10.A — Lăng Vân Sinh affinity arc (foundation).
  //
  //   intro (seen) → friendly_chat (warm/polite/cold) → inner_secret (gated 30)
  //
  // friendly_chat repeatable một lần (do `not_seen` self) — exercise
  // change_affinity effect + ALREADY_APPLIED idempotency. inner_secret gate
  // theo `affinity_min` ban_huu (30) — exercise locked-by-affinity rule.
  // ============================================================================
  {
    id: 'story_dlg_lang_van_sinh_friendly_chat',
    npcKey: 'npc_lang_van_sinh',
    conditions: [
      { kind: 'realm_min', realmOrder: 0 },
      { kind: 'seen', nodeId: 'story_dlg_lang_van_sinh_chapter_1_intro' },
      { kind: 'not_seen', nodeId: 'story_dlg_lang_van_sinh_friendly_chat' },
    ],
    text: 'Đệ tử quay lại — ta đang pha trà. Nói chuyện đôi câu cũng hay, hay con vẫn còn lạnh lùng?',
    textEn:
      'You have returned, disciple — I was brewing tea. A few words would be welcome, or do you remain distant?',
    choices: [
      {
        key: 'warm',
        label: 'Đệ tử ngồi cùng chưởng môn, xin nghe đôi lời.',
        labelEn: 'I sit with you, sect master, and listen gladly.',
        effects: [
          { kind: 'change_affinity', npcKey: 'npc_lang_van_sinh', delta: 10 },
          { kind: 'mark_seen' },
        ],
      },
      {
        key: 'polite',
        label: 'Đệ tử lễ phép cúi đầu, chỉ chào hỏi rồi đi.',
        labelEn: 'I bow politely, greet, and take my leave.',
        effects: [{ kind: 'mark_seen' }],
      },
      {
        key: 'cold',
        label: 'Đệ tử không có gì để nói. Cáo lui.',
        labelEn: 'I have nothing to say. I take my leave.',
        effects: [
          { kind: 'change_affinity', npcKey: 'npc_lang_van_sinh', delta: -5 },
          { kind: 'mark_seen' },
        ],
      },
    ],
  },
  {
    id: 'story_dlg_lang_van_sinh_inner_secret',
    npcKey: 'npc_lang_van_sinh',
    /**
     * Gate theo affinity ban_huu (30). Khi player đạt mốc bằng cách lặp choice
     * `warm` ở các dialogue về sau (hoặc admin seed), node specificity 4 (do
     * `affinity_min`) > intro/friendly_chat (2/3) → server pick ưu tiên.
     */
    conditions: [
      { kind: 'realm_min', realmOrder: 0 },
      { kind: 'affinity_min', npcKey: 'npc_lang_van_sinh', score: 30 },
      { kind: 'not_seen', nodeId: 'story_dlg_lang_van_sinh_inner_secret' },
    ],
    text: 'Đệ tử… nay ta xem con là tri giao. Có vài chuyện về cố nhân Hoa Thiên, ta muốn kể con nghe.',
    textEn:
      'Disciple… now I count you a true friend. There are matters of Hoa Thiên elders past that I wish to share with you.',
    choices: [
      {
        key: 'listen',
        label: 'Đệ tử cung kính lắng nghe.',
        labelEn: 'I listen with respect.',
        effects: [
          { kind: 'change_affinity', npcKey: 'npc_lang_van_sinh', delta: 5 },
          { kind: 'set_flag', flagKey: 'lang_van_sinh_secret_unlocked', value: true },
          { kind: 'give_reward', linhThach: 50, exp: 30 },
          { kind: 'mark_seen' },
        ],
      },
      {
        key: 'demur',
        label: 'Đệ tử không dám nghe chuyện riêng tông môn lúc này.',
        labelEn: 'I dare not pry into sect matters at this moment.',
        effects: [{ kind: 'mark_seen' }],
      },
    ],
  },

  // ============================================================================
  // Phase 21 — NPC dialogue and affinity expansion
  // ============================================================================
  {
    id: 'story_dlg_a_linh_first_meet_01',
    npcKey: 'npc_a_linh',
    conditions: [{ kind: 'not_seen', nodeId: 'story_dlg_a_linh_first_meet_01' }],
    text: 'Người mới thường ngẩng đầu nhìn núi cao rồi quên thở. Nhìn ta này: hít vào ba nhịp, giữ linh khí ở đan điền, rồi hãy nghĩ đến thành tiên.',
    textEn: 'Newcomers stare at the mountain and forget to breathe. Look at me: inhale for three beats, hold the qi at your dantian, then think about immortality.',
    choices: [{ key: 'follow_breath', label: 'Làm theo nhịp thở của A Linh.', labelEn: 'Follow A Linh’s breathing rhythm.', effects: [{ kind: 'set_flag', flagKey: 'phase21_a_linh_breath_lesson', value: true }, { kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_a_linh_guided_path_idle',
    npcKey: 'npc_a_linh',
    conditions: [{ kind: 'seen', nodeId: 'story_dlg_a_linh_first_meet_01' }],
    text: 'Nếu lạc, cứ theo mùi cháo ở ngoại môn. Tu tiên dài lắm; người còn biết đói thì chưa bị đại đạo nuốt mất.',
    textEn: 'If you get lost, follow the smell of porridge in the outer court. The path is long; if hunger still speaks to you, the Dao has not swallowed you yet.',
    choices: [{ key: 'thank', label: 'Cảm ơn A Linh.', labelEn: 'Thank A Linh.', effects: [{ kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_lang_van_sinh_phase21_first_meet',
    npcKey: 'npc_lang_van_sinh',
    questKey: 'phase21_ch01_main_01',
    conditions: [{ kind: 'quest_status', questKey: 'phase21_ch01_main_01', status: 'available' }],
    text: 'Hoa Thiên Môn nghèo đến mức không giấu được gió lùa qua điện. Nhưng nếu con nguyện đứng lại, ta sẽ cho con một cái tên trong đạo thống này.',
    textEn: 'The Hoa Thiên Sect is so poor we cannot even hide the wind through our hall. Yet if you remain, I will give you a name within this inheritance.',
    choices: [{ key: 'accept_sect_name', label: 'Đệ tử nguyện đứng lại.', labelEn: 'Disciple chooses to remain.', effects: [{ kind: 'set_flag', flagKey: 'phase21_lang_van_sinh_accepted_disciple', value: true }, { kind: 'change_affinity', npcKey: 'npc_lang_van_sinh', delta: 6 }, { kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_lang_van_sinh_phase21_affinity_mid',
    npcKey: 'npc_lang_van_sinh',
    conditions: [{ kind: 'affinity_min', npcKey: 'npc_lang_van_sinh', score: 30 }],
    text: 'Ta từng nghĩ giữ truyền thừa là giữ sách và ấn. Nay nhìn con chạy giữa linh điền, ta mới nhớ truyền thừa cũng là người còn muốn quay về.',
    textEn: 'I once thought inheritance meant books and seals. Watching you return from the fields, I remember inheritance is also a person who still wishes to come home.',
    choices: [{ key: 'promise_return', label: 'Hứa sẽ quay về Hoa Thiên.', labelEn: 'Promise to return to Hoa Thiên.', effects: [{ kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_lang_van_sinh_phase21_realm_changed',
    npcKey: 'npc_lang_van_sinh',
    conditions: [{ kind: 'realm_min', realmOrder: 3 }],
    text: 'Kim Đan không chỉ là dị tượng trên trời. Nó là lời thề trong thân thể: từ nay mỗi lựa chọn của con đều có trọng lượng.',
    textEn: 'A Golden Core is not merely an omen in the sky. It is an oath inside the body: from now on, every choice you make has weight.',
    choices: [{ key: 'accept_weight', label: 'Ghi nhớ trọng lượng của Kim Đan.', labelEn: 'Remember the weight of the Golden Core.', effects: [{ kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_moc_thanh_y_phase21_first_meet',
    npcKey: 'npc_moc_thanh_y',
    conditions: [{ kind: 'not_seen', nodeId: 'story_dlg_moc_thanh_y_phase21_first_meet' }],
    text: 'Đừng gọi ta là dịu dàng. Ta mắng con vì ngoài kia yêu thú không biết nương tay, Tịch Linh khí càng không biết thương người.',
    textEn: 'Do not call me gentle. I scold you because beasts outside will not hold back, and Nether Spirit qi has no mercy at all.',
    choices: [{ key: 'accept_strict_care', label: 'Nhận ra sự nghiêm khắc là bảo hộ.', labelEn: 'Recognize strictness as protection.', effects: [{ kind: 'change_affinity', npcKey: 'npc_moc_thanh_y', delta: 5 }, { kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_moc_thanh_y_phase21_quest_active',
    npcKey: 'npc_moc_thanh_y',
    questKey: 'phase21_side_027',
    conditions: [{ kind: 'quest_status', questKey: 'phase21_side_027', status: 'accepted' }],
    text: 'Mộc khí của ta lệch nhịp? Không sao. Nếu ta ngã, con cứ kéo ta về — nhưng đừng để người khác thấy ta yếu.',
    textEn: 'My Wood qi is out of rhythm? It is fine. If I fall, pull me back — but do not let the others see me weak.',
    choices: [{ key: 'quiet_support', label: 'Lặng lẽ ở lại hộ pháp.', labelEn: 'Stay quietly as her guard.', effects: [{ kind: 'change_affinity', npcKey: 'npc_moc_thanh_y', delta: 4 }, { kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_moc_thanh_y_phase21_affinity_high',
    npcKey: 'npc_moc_thanh_y',
    conditions: [{ kind: 'affinity_min', npcKey: 'npc_moc_thanh_y', score: 60 }],
    text: 'Có lúc ta nghe Tịch Linh Chủng gọi tên mình bằng giọng rất giống ta. Nếu ngày đó ta quên con, hãy dùng mùi Thanh Lam Đan nhắc ta.',
    textEn: 'Sometimes the Nether Spirit Seed calls my name in a voice much like mine. If one day I forget you, remind me with the scent of a Thanh Lam pill.',
    choices: [{ key: 'remember_scent', label: 'Hứa sẽ nhớ mùi Thanh Lam Đan.', labelEn: 'Promise to remember the scent.', effects: [{ kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_han_da_phase21_first_meet',
    npcKey: 'npc_han_da',
    conditions: [{ kind: 'not_seen', nodeId: 'story_dlg_han_da_phase21_first_meet' }],
    text: 'Hoa Thiên Môn yếu, nhưng kiếm trong mắt ngươi chưa gãy. Ta muốn biết đó là ngu dũng hay đạo tâm.',
    textEn: 'Hoa Thiên is weak, but the sword in your eyes has not broken. I want to know whether that is foolish courage or Dao-heart.',
    choices: [{ key: 'answer_with_sword', label: 'Dùng kiếm trả lời.', labelEn: 'Answer with the sword.', effects: [{ kind: 'change_affinity', npcKey: 'npc_han_da', delta: 5 }, { kind: 'mark_seen' }] }, { key: 'answer_with_silence', label: 'Im lặng giữ lễ.', labelEn: 'Remain silent and respectful.', effects: [{ kind: 'change_affinity', npcKey: 'npc_han_da', delta: 3 }, { kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_han_da_phase21_quest_complete',
    npcKey: 'npc_han_da',
    questKey: 'phase21_side_014',
    conditions: [{ kind: 'quest_status', questKey: 'phase21_side_014', status: 'claimed' }],
    text: 'Bạn hay đối thủ? Ta chưa quen chữ bạn. Nhưng nếu sau lưng ta là ngươi, ta sẽ không quay đầu kiểm tra.',
    textEn: 'Friend or rival? I am unused to the word friend. But if you stand behind me, I will not turn to check.',
    choices: [{ key: 'stand_trusted', label: 'Đứng sau lưng hắn một nhịp.', labelEn: 'Stand behind him for a breath.', effects: [{ kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_han_da_phase21_affinity_mid',
    npcKey: 'npc_han_da',
    conditions: [{ kind: 'affinity_min', npcKey: 'npc_han_da', score: 30 }],
    text: 'Đừng hiểu lầm. Ta không tin Hoa Thiên Môn. Ta chỉ tin người đã cùng ta rút kiếm trong gió lạnh.',
    textEn: 'Do not misunderstand. I do not trust the Hoa Thiên Sect. I trust the one who drew a sword beside me in the cold wind.',
    choices: [{ key: 'accept_rival_trust', label: 'Nhận lòng tin của đối thủ.', labelEn: 'Accept a rival’s trust.', effects: [{ kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_to_nguyet_ly_phase21_first_meet',
    npcKey: 'npc_to_nguyet_ly',
    conditions: [{ kind: 'not_seen', nodeId: 'story_dlg_to_nguyet_ly_phase21_first_meet' }],
    text: 'Nếu ta nói lịch sử Hoa Thiên bị xoá, ngươi sẽ tin ta hay tin tấm biển trước sơn môn?',
    textEn: 'If I tell you Hoa Thiên history was erased, will you trust me or the plaque before the mountain gate?',
    choices: [{ key: 'trust_erased_history', label: 'Tin rằng lịch sử có vết xoá.', labelEn: 'Believe history bears erasures.', effects: [{ kind: 'change_affinity', npcKey: 'npc_to_nguyet_ly', delta: 5 }, { kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_to_nguyet_ly_phase21_affinity_mid',
    npcKey: 'npc_to_nguyet_ly',
    conditions: [{ kind: 'affinity_min', npcKey: 'npc_to_nguyet_ly', score: 30 }],
    text: 'Ta không sợ bí mật. Ta chỉ sợ một ngày mình chứng minh được tất cả, nhưng không còn ai muốn nghe.',
    textEn: 'I do not fear secrets. I fear proving everything one day and finding no one left willing to listen.',
    choices: [{ key: 'listen_to_exile', label: 'Nói rằng mình sẽ nghe đến cùng.', labelEn: 'Say you will listen to the end.', effects: [{ kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_to_nguyet_ly_phase21_event_special',
    npcKey: 'npc_to_nguyet_ly',
    questKey: 'phase21_side_017',
    conditions: [{ kind: 'quest_status', questKey: 'phase21_side_017', status: 'claimed' }],
    text: 'Gia phả còn thiếu nhiều tên. Nhưng hôm nay, ít nhất một người trong đó không còn bị im lặng nuốt mất.',
    textEn: 'Many names are still missing from the genealogy. But today, at least one of them is no longer swallowed by silence.',
    choices: [{ key: 'honor_erased_name', label: 'Cùng nàng khắc lại cái tên ấy.', labelEn: 'Carve that name back with her.', effects: [{ kind: 'change_affinity', npcKey: 'npc_to_nguyet_ly', delta: 4 }, { kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_huyet_la_sat_phase21_first_meet',
    npcKey: 'npc_huyet_la_sat',
    conditions: [{ kind: 'not_seen', nodeId: 'story_dlg_huyet_la_sat_phase21_first_meet' }],
    text: 'Nhìn kỹ đi, hậu bối. Ma tu cũng có mặt người. Chính đạo cũng có tay dính máu. Ngươi muốn nghe sự thật hay muốn giữ sạch tai?',
    textEn: 'Look carefully, junior. A demonic cultivator may still have a human face. The righteous path may still have bloodied hands. Do you want truth, or clean ears?',
    choices: [{ key: 'hear_bloody_truth', label: 'Nghe sự thật dính máu.', labelEn: 'Hear the blood-stained truth.', effects: [{ kind: 'change_affinity', npcKey: 'npc_huyet_la_sat', delta: 5 }, { kind: 'mark_seen' }] }, { key: 'keep_distance', label: 'Giữ khoảng cách với ma khí.', labelEn: 'Keep distance from demonic qi.', effects: [{ kind: 'change_affinity', npcKey: 'npc_huyet_la_sat', delta: -2 }, { kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_huyet_la_sat_phase21_affinity_mid',
    npcKey: 'npc_huyet_la_sat',
    conditions: [{ kind: 'affinity_min', npcKey: 'npc_huyet_la_sat', score: 30 }],
    text: 'Đừng tha thứ cho ta quá sớm. Người vội tha thứ thường chỉ muốn bản thân nhẹ lòng, không phải muốn người chết được công bằng.',
    textEn: 'Do not forgive me too soon. Those who rush to forgive often seek their own comfort, not justice for the dead.',
    choices: [{ key: 'withhold_easy_forgiveness', label: 'Không ban lời tha thứ rẻ tiền.', labelEn: 'Do not offer cheap forgiveness.', effects: [{ kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_huyet_la_sat_phase21_quest_complete',
    npcKey: 'npc_huyet_la_sat',
    questKey: 'phase21_side_025',
    conditions: [{ kind: 'quest_status', questKey: 'phase21_side_025', status: 'claimed' }],
    text: 'Chén rượu đó không thử gan ngươi. Nó thử xem ngươi có dám ngồi cùng một kẻ không thể trở lại làm người tốt hay không.',
    textEn: 'That cup did not test your courage. It tested whether you dared sit beside someone who can never return to being good.',
    choices: [{ key: 'sit_without_absolving', label: 'Ngồi lại nhưng không xoá tội.', labelEn: 'Stay seated without absolving guilt.', effects: [{ kind: 'change_affinity', npcKey: 'npc_huyet_la_sat', delta: 4 }, { kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_van_kim_nuong_phase21_first_meet',
    npcKey: 'npc_van_kim_nuong',
    conditions: [{ kind: 'not_seen', nodeId: 'story_dlg_van_kim_nuong_phase21_first_meet' }],
    text: 'Ta không bán đạo tâm, chỉ bán thứ giúp đạo tâm sống sót thêm một ngày. Hoa Thiên muốn uy tín? Trả đúng hẹn trước đã.',
    textEn: 'I do not sell Dao-heart, only things that help it survive another day. Hoa Thiên wants reputation? Pay on time first.',
    choices: [{ key: 'fair_trade', label: 'Đồng ý giao dịch công bằng.', labelEn: 'Agree to fair trade.', effects: [{ kind: 'change_affinity', npcKey: 'npc_van_kim_nuong', delta: 5 }, { kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_van_kim_nuong_phase21_affinity_mid',
    npcKey: 'npc_van_kim_nuong',
    conditions: [{ kind: 'affinity_min', npcKey: 'npc_van_kim_nuong', score: 30 }],
    text: 'Tin tức về Tịch Thiên Điện không nằm trên kệ hàng. Nhưng nếu ngươi giữ chữ tín, ta có thể để quên một tờ sổ ở nơi ngươi nhìn thấy.',
    textEn: 'News of Tịch Thiên Hall is not on a shelf. But if you keep your word, I may forget a ledger where you can see it.',
    choices: [{ key: 'keep_merchant_trust', label: 'Hứa giữ chữ tín với thương hội.', labelEn: 'Promise to keep trust with the guild.', effects: [{ kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_bach_de_tu_phase21_omen',
    npcKey: 'npc_bach_de_tu',
    conditions: [{ kind: 'realm_min', realmOrder: 4 }],
    text: 'Bạch Đế không ghét tự do. Ngài chỉ hiểu rằng tự do không có xiềng xích sẽ biến thành chiến tranh. Ngươi còn quá trẻ để phản bác.',
    textEn: 'The White Emperor does not hate freedom. He merely understands that freedom without chains becomes war. You are too young to refute this.',
    choices: [{ key: 'question_order', label: 'Hỏi trật tự nào cần người khác quỳ.', labelEn: 'Ask what order requires others to kneel.', effects: [{ kind: 'change_affinity', npcKey: 'npc_bach_de_tu', delta: -3 }, { kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_tich_linh_su_gia_phase21_event_special',
    npcKey: 'npc_tich_linh_su_gia',
    conditions: [{ kind: 'realm_min', realmOrder: 2 }],
    text: 'Ta gieo một hạt yên tĩnh vào Mộc Thanh Y, và các ngươi gọi đó là ác. Nhưng các ngươi đã bao giờ hỏi nàng có mệt vì phải mạnh mẽ không?',
    textEn: 'I planted a seed of silence in Mộc Thanh Y, and you call it evil. But have you ever asked whether she is tired of being strong?',
    choices: [{ key: 'reject_tich_ling_seed', label: 'Từ chối thứ yên tĩnh cưỡng ép.', labelEn: 'Reject coerced silence.', effects: [{ kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_huyet_ha_su_gia_phase21_black_market',
    npcKey: 'npc_huyet_ha_su_gia',
    conditions: [{ kind: 'realm_min', realmOrder: 3 }],
    text: 'Huyết Hà không cứu người miễn phí. Nhưng đôi khi cái giá là một lời thừa nhận: chính đạo cũng từng bán đứng người của mình.',
    textEn: 'The Blood River saves no one for free. Sometimes the price is an admission: the righteous path has also betrayed its own.',
    choices: [{ key: 'hear_black_market_terms', label: 'Nghe điều kiện của chợ đen.', labelEn: 'Hear the black-market terms.', effects: [{ kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_hoa_thien_dao_to_phase21_remnant',
    npcKey: 'npc_hoa_thien_dao_to',
    conditions: [{ kind: 'realm_min', realmOrder: 4 }],
    text: 'Nếu con nghe được tàn âm này, nghĩa là phong ấn đã mỏng. Đừng sợ Vô Đạo trước; hãy sợ ngày lòng mình muốn khoá đạo của người khác.',
    textEn: 'If you hear this remnant, the seal has thinned. Do not fear the Dao-less first; fear the day your own heart wants to lock another’s path.',
    choices: [{ key: 'carry_founder_warning', label: 'Mang lời cảnh báo của tổ sư.', labelEn: 'Carry the founder’s warning.', effects: [{ kind: 'mark_seen' }] }],
  },
  {
    id: 'story_dlg_tich_thien_dao_chu_phase21_philosophy',
    npcKey: 'npc_tich_thien_dao_chu',
    conditions: [{ kind: 'realm_min', realmOrder: 4 }],
    text: 'Ta từng mở đường cho chúng sinh. Rồi chúng sinh dùng đường ấy để đốt nhau. Nếu ngươi gọi ta là ác, hãy sống đủ lâu để thấy lòng tốt gây ra đại kiếp.',
    textEn: 'I once opened the path for all beings. Then they used it to burn one another. If you call me evil, live long enough to see kindness cause a calamity.',
    choices: [{ key: 'refuse_final_logic', label: 'Không chấp nhận khoá đạo vì sợ sai lầm.', labelEn: 'Reject locking the Dao out of fear of error.', effects: [{ kind: 'mark_seen' }] }],
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
      // Phase 12.10.A — affinity_min ngang flag_*: gate theo state riêng, KHÔNG
      // thường dùng chung với quest_status/choice_made nên giữ tier 4.
      case 'affinity_min':
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
 * Phase 12.10.A — tổng `change_affinity.delta` per (npcKey) trong 1 choice.
 * Nhiều `change_affinity` cùng npcKey trong 1 choice cộng dồn (catalog không
 * giới hạn — service apply tuần tự). Validator dùng để check cap absolute.
 */
export function totalChoiceAffinityDelta(
  choice: StoryDialogueChoiceDef,
): ReadonlyArray<{ npcKey: string; delta: number }> {
  const map = new Map<string, number>();
  for (const e of choice.effects ?? []) {
    if (e.kind !== 'change_affinity') continue;
    map.set(e.npcKey, (map.get(e.npcKey) ?? 0) + e.delta);
  }
  return [...map.entries()].map(([npcKey, delta]) => ({ npcKey, delta }));
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
    // Phase 12.10.A — affinity_min reference NPC catalog + clamp range hợp lệ.
    if (cond.kind === 'affinity_min') {
      if (!npcKeys.has(cond.npcKey)) {
        errs.push(`${where} affinity_min references unknown npcKey ${cond.npcKey}`);
      } else {
        const def = npcAffinityDefForKey(cond.npcKey);
        if (def) {
          if (cond.score < def.minScore || cond.score > def.maxScore) {
            errs.push(
              `${where} affinity_min score ${cond.score} for ${cond.npcKey} out of bounds [${def.minScore},${def.maxScore}]`,
            );
          }
        }
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
        // Phase 12.10.A — change_affinity reference NPC catalog + cap delta.
        if (e.kind === 'change_affinity') {
          if (!npcKeys.has(e.npcKey)) {
            errs.push(
              `Node ${node.id} choice ${choice.key} change_affinity npcKey ${e.npcKey} not found`,
            );
          } else if (!npcAffinityDefForKey(e.npcKey)) {
            errs.push(
              `Node ${node.id} choice ${choice.key} change_affinity npcKey ${e.npcKey} has no affinity catalog entry`,
            );
          }
          if (Math.abs(e.delta) > AFFINITY_DELTA_CAP_PER_CHOICE) {
            errs.push(
              `Node ${node.id} choice ${choice.key} change_affinity |delta|=${Math.abs(
                e.delta,
              )} > cap ${AFFINITY_DELTA_CAP_PER_CHOICE}`,
            );
          }
          if (e.delta === 0) {
            errs.push(
              `Node ${node.id} choice ${choice.key} change_affinity delta is 0 (no-op effect)`,
            );
          }
        }
      }
    }
  }
  return errs;
}
