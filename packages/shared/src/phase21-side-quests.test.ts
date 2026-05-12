import { describe, expect, it } from 'vitest';
import { PHASE21_SIDE_QUESTS } from './phase21-side-quests';
import { STORY_CHAPTERS } from './story-chapters';
import { NPCS } from './npcs';
import { REALMS } from './realms';

describe('PHASE21_SIDE_QUESTS catalog integrity', () => {
  it('contains at least 40 side quests with unique keys', () => {
    expect(PHASE21_SIDE_QUESTS).toHaveLength(160);
    const keys = PHASE21_SIDE_QUESTS.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => key.startsWith('phase21_side_'))).toBe(true);
  });

  it('all entries are side quests with mini-story fields', () => {
    for (const quest of PHASE21_SIDE_QUESTS) {
      expect(quest.kind, quest.key).toBe('side');
      expect(quest.description.length, quest.key).toBeGreaterThan(80);
      expect(quest.objective?.length ?? 0, quest.key).toBeGreaterThan(20);
      expect(quest.requirement?.length ?? 0, quest.key).toBeGreaterThan(10);
      expect(quest.loreSummary.length, quest.key).toBeGreaterThan(20);
    }
  });

  it('links to valid chapters, NPCs, realms, and prerequisites', () => {
    const chapterKeys = new Set(STORY_CHAPTERS.map((c) => c.chapterKey));
    const npcKeys = new Set(NPCS.map((n) => n.key));
    const realmKeys = new Set(REALMS.map((r) => r.key));
    const phase21MainPrereq = /^phase21_ch\d{2}_main_\d{2}$/;
    for (const quest of PHASE21_SIDE_QUESTS) {
      expect(chapterKeys.has(quest.chapterKey ?? ''), quest.key).toBe(true);
      expect(npcKeys.has(quest.giverNpcKey), quest.key).toBe(true);
      expect(npcKeys.has(quest.startNpcKey ?? quest.giverNpcKey), quest.key).toBe(true);
      expect(npcKeys.has(quest.endNpcKey ?? quest.giverNpcKey), quest.key).toBe(true);
      expect(realmKeys.has(quest.realmKey), quest.key).toBe(true);
      expect(quest.prerequisiteQuestKey, quest.key).toMatch(phase21MainPrereq);
    }
  });

  it('is distributed across core NPCs, realms, and chapters', () => {
    expect(new Set(PHASE21_SIDE_QUESTS.map((q) => q.giverNpcKey)).size).toBeGreaterThanOrEqual(10);
    expect(new Set(PHASE21_SIDE_QUESTS.map((q) => q.realmKey)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(PHASE21_SIDE_QUESTS.map((q) => q.chapterKey)).size).toBe(8);
    expect(
      PHASE21_SIDE_QUESTS.filter((q) => q.rewards.affinity && q.rewards.affinity.length > 0).length,
    ).toBeGreaterThanOrEqual(20);
  });

  it('keeps side quest rewards moderate', () => {
    for (const quest of PHASE21_SIDE_QUESTS) {
      expect(quest.rewards.linhThach ?? 0, quest.key).toBeLessThanOrEqual(700);
      expect(quest.rewards.exp ?? 0, quest.key).toBeLessThanOrEqual(2_200);
      expect(quest.rewards.congHien ?? 0, quest.key).toBeLessThanOrEqual(180);
      for (const item of quest.rewards.items ?? []) {
        expect(item.qty, `${quest.key}:${item.itemKey}`).toBeGreaterThan(0);
        expect(item.qty, `${quest.key}:${item.itemKey}`).toBeLessThanOrEqual(1);
      }
    }
  });
});
