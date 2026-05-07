import { describe, it, expect } from 'vitest';
import { NPCS } from './npcs';
import { QUESTS } from './quests';
import {
  STORY_DIALOGUES,
  STORY_DIALOGUE_REWARD_CAP,
  storyDialogueAllFlagKeys,
  storyDialogueAllQuestKeys,
  storyDialogueNodeById,
  storyDialogueNodesByNpc,
  storyDialogueNodeSpecificity,
  totalChoiceReward,
  validateStoryDialogueCatalog,
  type StoryDialogueChoiceDef,
  type StoryDialogueNodeDef,
} from './story-dialogues';

/**
 * Phase 12 Story Dialogue Foundation — catalog invariant.
 *
 * `validateStoryDialogueCatalog()` collects all errors; test asserts no errors.
 * Mọi cái khác là sanity check / explicit invariant để regression alert nếu
 * catalog drift (vd thêm node không match NPC, choice đặt nextNodeId sai).
 */
describe('STORY_DIALOGUES catalog invariant', () => {
  it('validateStoryDialogueCatalog returns no errors', () => {
    const errs = validateStoryDialogueCatalog();
    expect(errs, errs.join('\n')).toEqual([]);
  });

  it('every node id is unique and starts with story_dlg_', () => {
    const ids = STORY_DIALOGUES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, id).toMatch(/^story_dlg_/);
    }
  });

  it('every node npcKey points to an existing NPC', () => {
    const npcKeys = new Set(NPCS.map((n) => n.key));
    for (const node of STORY_DIALOGUES) {
      expect(npcKeys.has(node.npcKey), `${node.id} npcKey ${node.npcKey}`).toBe(true);
    }
  });

  it('every node.questKey (if set) points to an existing quest', () => {
    const questKeys = new Set(QUESTS.map((q) => q.key));
    for (const node of STORY_DIALOGUES) {
      if (!node.questKey) continue;
      expect(questKeys.has(node.questKey), `${node.id} questKey ${node.questKey}`).toBe(true);
    }
  });

  it('every choice key is unique within its node + has non-empty label', () => {
    for (const node of STORY_DIALOGUES) {
      const keys = node.choices.map((c) => c.key);
      expect(new Set(keys).size, node.id).toBe(keys.length);
      for (const c of node.choices) {
        expect(c.label.length, `${node.id}.${c.key}`).toBeGreaterThan(0);
      }
    }
  });

  it('every choice.nextNodeId (if set) points to an existing node', () => {
    const ids = new Set(STORY_DIALOGUES.map((n) => n.id));
    for (const node of STORY_DIALOGUES) {
      for (const c of node.choices) {
        if (!c.nextNodeId) continue;
        expect(
          ids.has(c.nextNodeId),
          `${node.id}.${c.key}.nextNodeId ${c.nextNodeId}`,
        ).toBe(true);
      }
    }
  });

  it('every advance_quest_step effect references existing quest + step', () => {
    const questByKey = new Map(QUESTS.map((q) => [q.key, q]));
    for (const node of STORY_DIALOGUES) {
      for (const c of node.choices) {
        for (const e of c.effects ?? []) {
          if (e.kind !== 'advance_quest_step') continue;
          const def = questByKey.get(e.questKey);
          expect(def, `${node.id}.${c.key} questKey ${e.questKey}`).toBeDefined();
          expect(
            def!.steps.find((s) => s.id === e.stepId),
            `${node.id}.${c.key} stepId ${e.stepId}`,
          ).toBeDefined();
        }
      }
    }
  });

  it('every give_reward effect respects STORY_DIALOGUE_REWARD_CAP per choice', () => {
    for (const node of STORY_DIALOGUES) {
      for (const c of node.choices) {
        const r = totalChoiceReward(c);
        expect(r.linhThach, `${node.id}.${c.key}`).toBeLessThanOrEqual(
          STORY_DIALOGUE_REWARD_CAP.linhThach,
        );
        expect(r.tienNgoc, `${node.id}.${c.key}`).toBeLessThanOrEqual(
          STORY_DIALOGUE_REWARD_CAP.tienNgoc,
        );
        expect(r.exp, `${node.id}.${c.key}`).toBeLessThanOrEqual(
          STORY_DIALOGUE_REWARD_CAP.exp,
        );
      }
    }
  });

  it('storyDialogueNodeById resolves known + returns undefined for unknown', () => {
    const known = STORY_DIALOGUES[0];
    expect(storyDialogueNodeById(known.id)?.id).toBe(known.id);
    expect(storyDialogueNodeById('story_dlg_does_not_exist')).toBeUndefined();
  });

  it('storyDialogueNodesByNpc filters correctly', () => {
    const list = storyDialogueNodesByNpc('npc_lang_van_sinh');
    expect(list.length).toBeGreaterThan(0);
    for (const n of list) {
      expect(n.npcKey).toBe('npc_lang_van_sinh');
    }
  });

  it('storyDialogueNodeSpecificity ranks quest_status > flag > realm_min > always', () => {
    const always: StoryDialogueNodeDef = {
      id: 'story_dlg_test_always',
      npcKey: 'npc_lang_van_sinh',
      conditions: [{ kind: 'always' }],
      text: 'x',
      choices: [],
    };
    const realm: StoryDialogueNodeDef = {
      ...always,
      id: 'story_dlg_test_realm',
      conditions: [{ kind: 'realm_min', realmOrder: 1 }],
    };
    const flag: StoryDialogueNodeDef = {
      ...always,
      id: 'story_dlg_test_flag',
      conditions: [{ kind: 'flag_set', flagKey: 'foo' }],
    };
    const quest: StoryDialogueNodeDef = {
      ...always,
      id: 'story_dlg_test_quest',
      conditions: [{ kind: 'quest_status', questKey: 'phamnhan_main_01', status: 'accepted' }],
    };
    expect(storyDialogueNodeSpecificity(quest)).toBeGreaterThan(
      storyDialogueNodeSpecificity(flag),
    );
    expect(storyDialogueNodeSpecificity(flag)).toBeGreaterThan(
      storyDialogueNodeSpecificity(realm),
    );
    expect(storyDialogueNodeSpecificity(realm)).toBeGreaterThan(
      storyDialogueNodeSpecificity(always),
    );
  });

  it('storyDialogueAllFlagKeys returns sorted distinct keys including flags from condition + effects', () => {
    const flags = storyDialogueAllFlagKeys();
    expect(flags).toContain('attitude_lang_van_sinh');
    expect(flags).toContain('linh_can_path');
    expect(flags).toContain('han_da_relation');
    expect(flags).toContain('seed_lore_unlocked');
    // Sorted
    expect([...flags].sort()).toEqual([...flags]);
    // No duplicates
    expect(new Set(flags).size).toBe(flags.length);
  });

  it('storyDialogueAllQuestKeys subset of QUESTS keys', () => {
    const questKeys = new Set(QUESTS.map((q) => q.key));
    const referenced = storyDialogueAllQuestKeys();
    for (const k of referenced) {
      expect(questKeys.has(k), k).toBe(true);
    }
  });

  it('totalChoiceReward sums multiple give_reward effects', () => {
    const choice: StoryDialogueChoiceDef = {
      key: 'k',
      label: 'l',
      effects: [
        { kind: 'give_reward', linhThach: 10, exp: 5 },
        { kind: 'give_reward', linhThach: 20, tienNgoc: 1 },
        { kind: 'mark_seen' },
      ],
    };
    expect(totalChoiceReward(choice)).toEqual({ linhThach: 30, tienNgoc: 1, exp: 5 });
  });

  it('catalog includes at least one node per existing implemented effect kind (mark_seen, advance_quest_step, give_reward, set_flag)', () => {
    const seen = { mark_seen: false, advance_quest_step: false, give_reward: false, set_flag: false };
    for (const n of STORY_DIALOGUES) {
      for (const c of n.choices) {
        for (const e of c.effects ?? []) {
          seen[e.kind] = true;
        }
      }
    }
    expect(seen).toEqual({
      mark_seen: true,
      advance_quest_step: true,
      give_reward: true,
      set_flag: true,
    });
  });
});
