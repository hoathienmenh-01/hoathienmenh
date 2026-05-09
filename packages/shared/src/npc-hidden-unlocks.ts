/**
 * Phase 12.10.C — NPC Hidden Unlocks catalog.
 *
 * Hidden dialogue / quest mở khoá theo affinity tier — KHÔNG đăng ký quest mới
 * (catalog đã ổn định ở `quests.ts`), chỉ "tag" quest / dialogue node có sẵn
 * là "hidden" tới tier `requiredAffinityTier`.
 *
 *   - `hiddenDialogueUnlocks[]` — gate `StoryDialogueNode` cho FE chỉ render
 *     hint khi unlock. Server-side condition `affinity_min` đã enforce
 *     visibility (story-dialogues.ts), catalog NÀY chỉ thông báo cho FE biết
 *     "có content ẩn" để hiển thị tooltip.
 *   - `hiddenQuestUnlocks[]` — gate `QUESTS[]`. Catalog NÀY ánh xạ quest →
 *     tier mở khoá để FE hiển thị "đạt tri giao mới mở quest này".
 *
 * KHÔNG mutate `QUESTS` / `STORY_DIALOGUES` runtime — caller (API
 * controller) check tier player vs `requiredAffinityTier` rồi trả về list
 * unlock state (locked / unlocked).
 *
 * Persistence: KHÔNG ghi DB. Catalog tĩnh, query bằng helper.
 *
 * Design refs:
 *   - `docs/story/PHASE12_STORY_PROGRESS.md` Phase 12.10.C row.
 *   - `docs/BALANCE_MODEL.md` — không reward gì khi "view" hidden unlock,
 *     reward đến từ chính dialogue/quest đã unlock.
 */

import { NPCS } from './npcs';
import { QUESTS } from './quests';
import { STORY_DIALOGUES } from './story-dialogues';
import {
  AFFINITY_TIERS,
  NPC_AFFINITY,
  type AffinityTierDef,
  type AffinityTierKey,
} from './npc-affinity';

export interface NpcHiddenDialogueUnlockDef {
  /** Match `NPCS[].key` + `NPC_AFFINITY[].npcKey`. */
  npcKey: string;
  /** Match `STORY_DIALOGUES[].id`. */
  dialogueNodeId: string;
  /** Tier required để mở khoá. */
  requiredAffinityTier: AffinityTierKey;
  /** Lý do unlock — flavor cho FE locked state. */
  unlockReason: string;
  /** English fallback. */
  unlockReasonEn: string;
}

export interface NpcHiddenQuestUnlockDef {
  /** Match `NPCS[].key` + `NPC_AFFINITY[].npcKey`. */
  npcKey: string;
  /** Match `QUESTS[].key`. */
  questKey: string;
  /** Tier required để mở khoá. */
  requiredAffinityTier: AffinityTierKey;
  /** Lý do unlock — flavor cho FE locked state. */
  unlockReason: string;
  /** English fallback. */
  unlockReasonEn: string;
}

/**
 * Hidden dialogue node unlock — reference các node đã có condition
 * `affinity_min` trong `STORY_DIALOGUES` (story-dialogues.ts).
 *
 * Catalog hiện tại reference 1 node Lăng Vân Sinh `inner_secret` (gate
 * `affinity_min: 30` ⇔ tier `ban_huu`). Khi thêm node hidden mới, append vào
 * mảng này — invariant test verify `dialogueNodeId` ∈ `STORY_DIALOGUES`.
 */
export const NPC_HIDDEN_DIALOGUE_UNLOCKS: readonly NpcHiddenDialogueUnlockDef[] = [
  {
    npcKey: 'npc_lang_van_sinh',
    dialogueNodeId: 'story_dlg_lang_van_sinh_inner_secret',
    requiredAffinityTier: 'ban_huu',
    unlockReason: 'Khi đạt Bằng Hữu, chưởng môn mới chia sẻ chuyện Hoa Thiên xưa.',
    unlockReasonEn: 'At Companion tier, the sect master shares old Hoa Thiên lore.',
  },
  {
    npcKey: 'npc_han_da',
    dialogueNodeId: 'story_dlg_han_da_resolution_apology',
    requiredAffinityTier: 'ban_huu',
    unlockReason: 'Hàn Dạ chỉ tha thứ và chia sẻ tâm sự khi đã coi con là bằng hữu.',
    unlockReasonEn: 'Hàn Dạ only forgives and confides once he treats you as a companion.',
  },
] as const;

/**
 * Hidden quest unlock — quest có `prerequisiteQuestKey` chain `hoa_thien_main`
 * thường gate theo tier affinity với NPC giao quest.
 *
 * Catalog tham khảo: chỉ list các quest mà bản thân quest đã có barrier
 * affinity / chain (hoặc design intent là "ẩn") — không phải toàn bộ
 * `QUESTS[]`. FE render hint "Cần đạt {tier} với {npcName}".
 */
export const NPC_HIDDEN_QUEST_UNLOCKS: readonly NpcHiddenQuestUnlockDef[] = [
  {
    npcKey: 'npc_lang_van_sinh',
    questKey: 'phamnhan_realm_01',
    requiredAffinityTier: 'quen_biet',
    unlockReason: 'Lăng Vân Sinh chỉ giao Hạt Giống Vô Danh khi con đã quen mặt.',
    unlockReasonEn: 'Lăng Vân Sinh only entrusts the Nameless Seed once you are familiar.',
  },
  {
    npcKey: 'npc_moc_thanh_y',
    questKey: 'phamnhan_main_01',
    requiredAffinityTier: 'xa_la',
    unlockReason: 'Đại sư tỷ Mộc Thanh Y mở quest hướng dẫn nhập môn cho mọi đệ tử.',
    unlockReasonEn: 'Senior sister Mộc Thanh Y opens the orientation quest for all disciples.',
  },
  {
    npcKey: 'npc_han_da',
    questKey: 'phamnhan_main_01',
    requiredAffinityTier: 'ban_huu',
    unlockReason: 'Hàn Dạ chỉ chấp nhận tỷ thí khi đã coi con là bằng hữu.',
    unlockReasonEn: 'Hàn Dạ only spars with you once treated as a companion.',
  },
] as const;

/** Aggregated config object — convenience export. */
export const NPC_HIDDEN_UNLOCKS = {
  dialogues: NPC_HIDDEN_DIALOGUE_UNLOCKS,
  quests: NPC_HIDDEN_QUEST_UNLOCKS,
} as const;

export interface NpcHiddenUnlockView {
  kind: 'dialogue' | 'quest';
  /** Reference key — `dialogueNodeId` hoặc `questKey`. */
  refKey: string;
  npcKey: string;
  requiredAffinityTier: AffinityTierKey;
  requiredTierLabel: string;
  requiredTierLabelEn: string;
  requiredTierMinScore: number;
  unlockReason: string;
  unlockReasonEn: string;
  /** True = player đã đạt tier này. */
  unlocked: boolean;
}

/** Lookup tier def. */
function tierDefForKey(key: AffinityTierKey): AffinityTierDef {
  return AFFINITY_TIERS.find((t) => t.key === key) ?? AFFINITY_TIERS[0];
}

/**
 * Build view list cho 1 NPC + tier hiện tại của character. Server gọi từ
 * `GET /story/npc-affinity/:npcKey/unlocks`.
 */
export function npcHiddenUnlocksForAffinity(
  npcKey: string,
  currentTier: AffinityTierKey,
): NpcHiddenUnlockView[] {
  const curOrder = AFFINITY_TIERS.find((t) => t.key === currentTier)?.order ?? 0;

  const out: NpcHiddenUnlockView[] = [];
  for (const d of NPC_HIDDEN_DIALOGUE_UNLOCKS) {
    if (d.npcKey !== npcKey) continue;
    const tier = tierDefForKey(d.requiredAffinityTier);
    out.push({
      kind: 'dialogue',
      refKey: d.dialogueNodeId,
      npcKey: d.npcKey,
      requiredAffinityTier: d.requiredAffinityTier,
      requiredTierLabel: tier.label,
      requiredTierLabelEn: tier.labelEn,
      requiredTierMinScore: tier.minScore,
      unlockReason: d.unlockReason,
      unlockReasonEn: d.unlockReasonEn,
      unlocked: curOrder >= tier.order,
    });
  }
  for (const q of NPC_HIDDEN_QUEST_UNLOCKS) {
    if (q.npcKey !== npcKey) continue;
    const tier = tierDefForKey(q.requiredAffinityTier);
    out.push({
      kind: 'quest',
      refKey: q.questKey,
      npcKey: q.npcKey,
      requiredAffinityTier: q.requiredAffinityTier,
      requiredTierLabel: tier.label,
      requiredTierLabelEn: tier.labelEn,
      requiredTierMinScore: tier.minScore,
      unlockReason: q.unlockReason,
      unlockReasonEn: q.unlockReasonEn,
      unlocked: curOrder >= tier.order,
    });
  }
  // Sort: locked first by tier order ASC, then unlocked.
  out.sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? 1 : -1;
    const ao = AFFINITY_TIERS.find((t) => t.key === a.requiredAffinityTier)?.order ?? 0;
    const bo = AFFINITY_TIERS.find((t) => t.key === b.requiredAffinityTier)?.order ?? 0;
    return ao - bo;
  });
  return out;
}

/**
 * Validate catalog — invariant test:
 *   1. Mọi `npcKey` ∈ `NPCS` + `NPC_AFFINITY`.
 *   2. Dialogue ref ∈ `STORY_DIALOGUES`.
 *   3. Quest ref ∈ `QUESTS`.
 *   4. `requiredAffinityTier` ∈ `AFFINITY_TIERS`.
 *   5. KHÔNG duplicate `(npcKey, dialogueNodeId)` / `(npcKey, questKey)`.
 *   6. `unlockReason` non-empty.
 */
export function validateNpcHiddenUnlocksCatalog(): string[] {
  const errs: string[] = [];
  const npcKeys = new Set(NPCS.map((n) => n.key));
  const affinityKeys = new Set(NPC_AFFINITY.map((a) => a.npcKey));
  const dialogueKeys = new Set(STORY_DIALOGUES.map((d) => d.id));
  const questKeys = new Set(QUESTS.map((q) => q.key));
  const tierKeys = new Set(AFFINITY_TIERS.map((t) => t.key));

  const seenDlg = new Set<string>();
  for (const d of NPC_HIDDEN_DIALOGUE_UNLOCKS) {
    const where = `${d.npcKey}:dlg:${d.dialogueNodeId}`;
    if (!npcKeys.has(d.npcKey)) errs.push(`HiddenUnlock ${where} unknown NPC`);
    if (!affinityKeys.has(d.npcKey)) {
      errs.push(`HiddenUnlock ${where} NPC missing NPC_AFFINITY config`);
    }
    if (!dialogueKeys.has(d.dialogueNodeId)) {
      errs.push(`HiddenUnlock ${where} unknown dialogue node`);
    }
    if (!tierKeys.has(d.requiredAffinityTier)) {
      errs.push(`HiddenUnlock ${where} unknown tier ${d.requiredAffinityTier}`);
    }
    if (seenDlg.has(where)) errs.push(`HiddenUnlock ${where} duplicate`);
    seenDlg.add(where);
    if (d.unlockReason.trim().length === 0) {
      errs.push(`HiddenUnlock ${where} empty unlockReason`);
    }
    if (d.unlockReasonEn.trim().length === 0) {
      errs.push(`HiddenUnlock ${where} empty unlockReasonEn`);
    }
  }

  const seenQuest = new Set<string>();
  for (const q of NPC_HIDDEN_QUEST_UNLOCKS) {
    const where = `${q.npcKey}:quest:${q.questKey}`;
    if (!npcKeys.has(q.npcKey)) errs.push(`HiddenUnlock ${where} unknown NPC`);
    if (!affinityKeys.has(q.npcKey)) {
      errs.push(`HiddenUnlock ${where} NPC missing NPC_AFFINITY config`);
    }
    if (!questKeys.has(q.questKey)) {
      errs.push(`HiddenUnlock ${where} unknown quest`);
    }
    if (!tierKeys.has(q.requiredAffinityTier)) {
      errs.push(`HiddenUnlock ${where} unknown tier ${q.requiredAffinityTier}`);
    }
    if (seenQuest.has(where)) errs.push(`HiddenUnlock ${where} duplicate`);
    seenQuest.add(where);
    if (q.unlockReason.trim().length === 0) {
      errs.push(`HiddenUnlock ${where} empty unlockReason`);
    }
    if (q.unlockReasonEn.trim().length === 0) {
      errs.push(`HiddenUnlock ${where} empty unlockReasonEn`);
    }
  }

  return errs;
}
