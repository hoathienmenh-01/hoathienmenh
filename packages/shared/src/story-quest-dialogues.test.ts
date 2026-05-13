/**
 * Phase 33.0B — Story Quest Dialogue catalog integrity tests.
 *
 * Enforce:
 *   - MAIN quest Ch9–Ch27 có đủ INTRO + ACCEPT + IN_PROGRESS + COMPLETE + CLAIMED.
 *   - HIDDEN quest có đủ HIDDEN_HINT + HIDDEN_TRIGGER + COMPLETE + AFTERMATH.
 *   - BRANCH quest có đủ INTRO (opening) + AFTERMATH (ending).
 *   - Boss climax quest (MAIN có boss_defeat step) thêm BOSS_PRE + BOSS_VICTORY.
 *   - dialogueId unique toàn catalog.
 *   - questKey và speakerNpcKey resolve.
 *   - speakerNpcKey.realmGateOrder ≤ quest.requiredRealmOrder.
 *   - textVi và textEn non-empty, không generic (boilerplate).
 *   - Không có 100+ dialogue line trùng exact text (anti copy-paste).
 *   - Dialogue không attempt mutate story flag (Phase 33.0B chỉ catalog).
 */

import { describe, expect, it } from 'vitest';
import { NPCS } from './npcs';
import { STORY_CHAPTERS_V2 } from './story-chapters-quyen-ii-iv';
import {
  STORY_QUEST_EXPANSION,
  phase33QuestsByChapter,
  phase33QuestsByKind,
} from './story-quest-expansion';
import {
  STORY_QUEST_DIALOGUES,
  phase33DialogueById,
  phase33DialoguesByPhase,
  phase33DialoguesForChapter,
  phase33DialoguesForQuest,
  phase33QuestKindHasDialogueCoverage,
} from './story-quest-dialogues';

const NPC_BY_KEY = new Map(NPCS.map((n) => [n.key, n]));
const QUEST_BY_KEY = new Map(STORY_QUEST_EXPANSION.map((q) => [q.questKey, q]));

describe('Phase 33.0B — Story Quest Dialogue catalog', () => {
  it('catalog has dialogues for MAIN + HIDDEN + BRANCH quests only', () => {
    const phases = new Set(STORY_QUEST_DIALOGUES.map((d) => d.phase));
    // Phase 33.0B core coverage scope.
    expect(phases.has('INTRO')).toBe(true);
    expect(phases.has('ACCEPT')).toBe(true);
    expect(phases.has('IN_PROGRESS')).toBe(true);
    expect(phases.has('COMPLETE')).toBe(true);
    expect(phases.has('CLAIMED')).toBe(true);
    expect(phases.has('HIDDEN_HINT')).toBe(true);
    expect(phases.has('HIDDEN_TRIGGER')).toBe(true);
    expect(phases.has('AFTERMATH')).toBe(true);
    expect(phases.has('BOSS_PRE')).toBe(true);
    expect(phases.has('BOSS_VICTORY')).toBe(true);
    // Side/daily/weekly chưa cover trong Phase 33.0B core.
    for (const d of STORY_QUEST_DIALOGUES) {
      const q = QUEST_BY_KEY.get(d.questKey);
      expect(q, `dialogue ${d.dialogueId} questKey resolve`).toBeDefined();
      expect(['main', 'hidden', 'branch'], `dialogue ${d.dialogueId} quest kind`).toContain(q!.kind);
    }
  });

  it('every MAIN quest has INTRO + ACCEPT + IN_PROGRESS + COMPLETE + CLAIMED', () => {
    for (const q of phase33QuestsByKind('main')) {
      const phases = new Set(phase33DialoguesForQuest(q.questKey).map((d) => d.phase));
      for (const p of ['INTRO', 'ACCEPT', 'IN_PROGRESS', 'COMPLETE', 'CLAIMED'] as const) {
        expect(phases.has(p), `${q.questKey} missing ${p}`).toBe(true);
      }
    }
  });

  it('every HIDDEN quest has HIDDEN_HINT + HIDDEN_TRIGGER + COMPLETE + AFTERMATH', () => {
    for (const q of phase33QuestsByKind('hidden')) {
      const phases = new Set(phase33DialoguesForQuest(q.questKey).map((d) => d.phase));
      for (const p of ['HIDDEN_HINT', 'HIDDEN_TRIGGER', 'COMPLETE', 'AFTERMATH'] as const) {
        expect(phases.has(p), `${q.questKey} missing ${p}`).toBe(true);
      }
    }
  });

  it('every BRANCH quest has INTRO (opening) + AFTERMATH (ending)', () => {
    for (const q of phase33QuestsByKind('branch')) {
      const phases = new Set(phase33DialoguesForQuest(q.questKey).map((d) => d.phase));
      for (const p of ['INTRO', 'AFTERMATH'] as const) {
        expect(phases.has(p), `${q.questKey} missing ${p}`).toBe(true);
      }
    }
  });

  it('every MAIN quest with boss_defeat step has BOSS_PRE + BOSS_VICTORY', () => {
    for (const q of phase33QuestsByKind('main')) {
      const hasBossStep = q.steps.some((s) => s.kind === 'boss_defeat');
      if (!hasBossStep) continue;
      const phases = new Set(phase33DialoguesForQuest(q.questKey).map((d) => d.phase));
      for (const p of ['BOSS_PRE', 'BOSS_VICTORY'] as const) {
        expect(phases.has(p), `${q.questKey} boss climax missing ${p}`).toBe(true);
      }
    }
    // Sanity: at least 19 boss-climax quests (q05/chap).
    expect(phase33DialoguesByPhase('BOSS_PRE').length).toBeGreaterThanOrEqual(19);
    expect(phase33DialoguesByPhase('BOSS_VICTORY').length).toBeGreaterThanOrEqual(19);
  });

  it('phase33QuestKindHasDialogueCoverage helper agrees with raw phase set', () => {
    for (const q of [
      ...phase33QuestsByKind('main'),
      ...phase33QuestsByKind('hidden'),
      ...phase33QuestsByKind('branch'),
    ]) {
      expect(phase33QuestKindHasDialogueCoverage(q), q.questKey).toBe(true);
    }
  });

  it('dialogueId unique across catalog', () => {
    const seen = new Set<string>();
    for (const d of STORY_QUEST_DIALOGUES) {
      expect(seen.has(d.dialogueId), `dup ${d.dialogueId}`).toBe(false);
      seen.add(d.dialogueId);
      expect(d.dialogueId).toMatch(
        /^dlg_q_ch\d{2}_(main|hidden|branch)_\d{2}_(INTRO|ACCEPT|IN_PROGRESS|READY_TO_COMPLETE|COMPLETE|CLAIMED|HIDDEN_HINT|HIDDEN_TRIGGER|BOSS_PRE|BOSS_START|BOSS_VICTORY|AFTERMATH)$/,
      );
    }
  });

  it('speakerNpcKey resolves and realmGateOrder ≤ quest requiredRealmOrder', () => {
    for (const d of STORY_QUEST_DIALOGUES) {
      const npc = NPC_BY_KEY.get(d.speakerNpcKey);
      expect(npc, `${d.dialogueId} speaker=${d.speakerNpcKey}`).toBeDefined();
      const q = QUEST_BY_KEY.get(d.questKey);
      expect(q, `${d.dialogueId} quest=${d.questKey}`).toBeDefined();
      // Speaker must have realm gate ≤ quest realm order (NPC reachable bằng cảnh giới quest).
      expect(npc!.realmGateOrder, `${d.dialogueId}`).toBeLessThanOrEqual(q!.requiredRealmOrder);
    }
  });

  it('every dialogue.chapterKey matches its quest.chapKey', () => {
    for (const d of STORY_QUEST_DIALOGUES) {
      const q = QUEST_BY_KEY.get(d.questKey)!;
      expect(d.chapterKey, d.dialogueId).toBe(q.chapKey);
    }
  });

  it('textVi & textEn không rỗng và đủ độ dài', () => {
    for (const d of STORY_QUEST_DIALOGUES) {
      expect(d.textVi.trim().length, d.dialogueId).toBeGreaterThanOrEqual(10);
      expect(d.textEn.trim().length, d.dialogueId).toBeGreaterThanOrEqual(10);
      // Anti placeholder.
      expect(d.textVi.toLowerCase(), d.dialogueId).not.toMatch(/^(todo|tbd|placeholder|lorem)/);
      expect(d.textEn.toLowerCase(), d.dialogueId).not.toMatch(/^(todo|tbd|placeholder|lorem)/);
    }
  });

  it('dialogue line không quá generic — không có >50 dòng VI trùng exact text', () => {
    // Bucket by exact text and check the largest bucket.
    const viBuckets = new Map<string, number>();
    for (const d of STORY_QUEST_DIALOGUES) {
      viBuckets.set(d.textVi, (viBuckets.get(d.textVi) ?? 0) + 1);
    }
    const maxBucket = Math.max(...viBuckets.values());
    expect(maxBucket, 'no >50 identical VI lines').toBeLessThanOrEqual(50);
  });

  it('dialogue không mutate story flag trong Phase 33.0B (read-only catalog)', () => {
    for (const d of STORY_QUEST_DIALOGUES) {
      expect(d.setStoryFlags, d.dialogueId).toHaveLength(0);
      expect(d.nextDialogueId, d.dialogueId).toBeNull();
    }
  });

  it('lookup helpers', () => {
    const first = STORY_QUEST_DIALOGUES[0]!;
    expect(phase33DialogueById(first.dialogueId)?.dialogueId).toBe(first.dialogueId);
    expect(phase33DialogueById('dlg_does_not_exist')).toBeUndefined();
    const ch09 = phase33DialoguesForChapter('ch09');
    expect(ch09.length).toBeGreaterThan(0);
    for (const d of ch09) expect(d.chapterKey).toBe('ch09');
    const introPhase = phase33DialoguesByPhase('INTRO');
    expect(introPhase.length).toBeGreaterThanOrEqual(19);
    // MAIN INTRO at least 304, BRANCH INTRO at least 114, combined ≥ 418.
    expect(introPhase.length).toBeGreaterThanOrEqual(304 + 114);
  });

  it('coverage stats meet Phase 33.0B core spec (≥ 1900 lines)', () => {
    // Min math: 304 main × 5 + 19 boss×2 + 57 hidden × 4 + 114 branch × 2 = 2014.
    expect(STORY_QUEST_DIALOGUES.length).toBeGreaterThanOrEqual(1900);
    // Per chapter ≥ ~100 lines (16 main × 5 + 3 hidden × 4 + 6 branch × 2 + boss 2 = 106).
    for (const chapter of STORY_CHAPTERS_V2) {
      const chap = phase33DialoguesForChapter(chapter.chapKey);
      const mains = phase33QuestsByChapter(chapter.chapKey).filter((q) => q.kind === 'main');
      const expectedMin = mains.length * 5; // at minimum main coverage.
      expect(chap.length, chapter.chapKey).toBeGreaterThanOrEqual(expectedMin);
    }
  });
});
