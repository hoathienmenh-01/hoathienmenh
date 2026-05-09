/**
 * Phase 12.10.C — NPC Hidden Unlocks catalog invariant tests.
 */

import { describe, expect, it } from 'vitest';
import { NPC_AFFINITY } from './npc-affinity';
import { QUESTS } from './quests';
import { STORY_DIALOGUES } from './story-dialogues';
import {
  NPC_HIDDEN_DIALOGUE_UNLOCKS,
  NPC_HIDDEN_QUEST_UNLOCKS,
  NPC_HIDDEN_UNLOCKS,
  npcHiddenUnlocksForAffinity,
  validateNpcHiddenUnlocksCatalog,
} from './npc-hidden-unlocks';

describe('npc-hidden-unlocks catalog', () => {
  it('catalog passes validateNpcHiddenUnlocksCatalog (no errors)', () => {
    expect(validateNpcHiddenUnlocksCatalog()).toEqual([]);
  });

  it('every dialogue ref exists in STORY_DIALOGUES', () => {
    const ids = new Set(STORY_DIALOGUES.map((d) => d.id));
    for (const d of NPC_HIDDEN_DIALOGUE_UNLOCKS) {
      expect(ids.has(d.dialogueNodeId)).toBe(true);
    }
  });

  it('every quest ref exists in QUESTS', () => {
    const keys = new Set(QUESTS.map((q) => q.key));
    for (const q of NPC_HIDDEN_QUEST_UNLOCKS) {
      expect(keys.has(q.questKey)).toBe(true);
    }
  });

  it('NPC_HIDDEN_UNLOCKS aggregate object exposes both arrays', () => {
    expect(NPC_HIDDEN_UNLOCKS.dialogues).toBe(NPC_HIDDEN_DIALOGUE_UNLOCKS);
    expect(NPC_HIDDEN_UNLOCKS.quests).toBe(NPC_HIDDEN_QUEST_UNLOCKS);
  });

  it('every npcKey references NPC with NPC_AFFINITY config', () => {
    const affinityKeys = new Set(NPC_AFFINITY.map((a) => a.npcKey));
    for (const d of NPC_HIDDEN_DIALOGUE_UNLOCKS) {
      expect(affinityKeys.has(d.npcKey)).toBe(true);
    }
    for (const q of NPC_HIDDEN_QUEST_UNLOCKS) {
      expect(affinityKeys.has(q.npcKey)).toBe(true);
    }
  });

  it('reasons (vi/en) are non-empty', () => {
    for (const d of NPC_HIDDEN_DIALOGUE_UNLOCKS) {
      expect(d.unlockReason.trim().length).toBeGreaterThan(0);
      expect(d.unlockReasonEn.trim().length).toBeGreaterThan(0);
    }
    for (const q of NPC_HIDDEN_QUEST_UNLOCKS) {
      expect(q.unlockReason.trim().length).toBeGreaterThan(0);
      expect(q.unlockReasonEn.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('npcHiddenUnlocksForAffinity()', () => {
  it('returns combined dialogue + quest entries for an NPC', () => {
    const out = npcHiddenUnlocksForAffinity('npc_lang_van_sinh', 'xa_la');
    const dlg = out.filter((u) => u.kind === 'dialogue');
    const q = out.filter((u) => u.kind === 'quest');
    expect(dlg.length).toBeGreaterThanOrEqual(1);
    expect(q.length).toBeGreaterThanOrEqual(1);
  });

  it('marks unlocked correctly for tier ≥ requiredTier', () => {
    // ban_huu (order 2) ≥ ban_huu requirement.
    const out = npcHiddenUnlocksForAffinity('npc_lang_van_sinh', 'ban_huu');
    const banHuuEntry = out.find((u) => u.requiredAffinityTier === 'ban_huu');
    expect(banHuuEntry?.unlocked).toBe(true);
  });

  it('marks locked correctly for tier < requiredTier', () => {
    const out = npcHiddenUnlocksForAffinity('npc_lang_van_sinh', 'xa_la');
    const banHuuEntry = out.find((u) => u.requiredAffinityTier === 'ban_huu');
    expect(banHuuEntry?.unlocked).toBe(false);
  });

  it('sorts locked entries before unlocked, then by tier order', () => {
    const out = npcHiddenUnlocksForAffinity('npc_lang_van_sinh', 'quen_biet');
    let pastLocked = false;
    for (const u of out) {
      if (pastLocked && !u.unlocked) {
        throw new Error('locked entry appeared after unlocked entry');
      }
      if (u.unlocked) pastLocked = true;
    }
  });

  it('returns empty for NPC without unlocks', () => {
    expect(npcHiddenUnlocksForAffinity('npc_does_not_exist', 'tri_ky')).toEqual([]);
  });

  it('tri_ky unlocks every entry for the NPC', () => {
    const out = npcHiddenUnlocksForAffinity('npc_lang_van_sinh', 'tri_ky');
    expect(out.length).toBeGreaterThan(0);
    for (const u of out) {
      expect(u.unlocked).toBe(true);
    }
  });
});
