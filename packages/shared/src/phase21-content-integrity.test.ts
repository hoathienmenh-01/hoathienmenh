import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from './achievements';
import { missionsByPeriod } from './missions';
import { NPCS } from './npcs';
import { QUESTS } from './quests';
import { STORY_CHAPTERS } from './story-chapters';
import { STORY_DIALOGUES } from './story-dialogues';
import { TITLES } from './titles';

function resourceScore(q: { rewards: { linhThach?: number; exp?: number; congHien?: number } }): number {
  return (q.rewards.linhThach ?? 0) + (q.rewards.exp ?? 0) * 0.35 + (q.rewards.congHien ?? 0) * 3;
}

describe('Phase 21 mega content integrity', () => {
  const phase21Quests = QUESTS.filter((q) => q.key.startsWith('phase21_'));
  const questKeys = new Set(QUESTS.map((q) => q.key));
  const npcKeys = new Set(NPCS.map((n) => n.key));
  const chapterKeys = new Set(STORY_CHAPTERS.map((c) => c.chapterKey));

  it('meets minimum content targets', () => {
    expect(STORY_CHAPTERS.length).toBeGreaterThanOrEqual(8);
    expect(phase21Quests.filter((q) => q.kind === 'main')).toHaveLength(120);
    expect(phase21Quests.filter((q) => q.kind === 'side').length).toBeGreaterThanOrEqual(160);
    expect(phase21Quests.filter((q) => q.kind === 'branch').length).toBeGreaterThanOrEqual(64);
    expect(phase21Quests.filter((q) => q.kind === 'hidden').length).toBeGreaterThanOrEqual(40);
    expect(missionsByPeriod('DAILY').length).toBeGreaterThanOrEqual(30);
    expect(missionsByPeriod('WEEKLY').length).toBeGreaterThanOrEqual(20);
    expect(ACHIEVEMENTS.length + TITLES.length).toBeGreaterThanOrEqual(100);
    expect(STORY_DIALOGUES.length).toBeGreaterThanOrEqual(600);
  });

  it('has unique chapter and quest keys', () => {
    expect(chapterKeys.size).toBe(STORY_CHAPTERS.length);
    expect(questKeys.size).toBe(QUESTS.length);
  });

  it('gates every chapter and binds 15 main quests per chapter', () => {
    for (const chapter of STORY_CHAPTERS) {
      expect(chapter.unlockGate).toBeTruthy();
      expect(chapter.unlockGate.requiredRealmKey.length).toBeGreaterThan(0);
      expect(chapter.unlockGate.requiredBattlePower ?? 0).toBeGreaterThanOrEqual(0);
      const main = phase21Quests.filter((q) => q.kind === 'main' && q.chapterKey === chapter.chapterKey);
      expect(main, chapter.chapterKey).toHaveLength(15);
      for (const key of chapter.mainQuestKeys) expect(questKeys.has(key), key).toBe(true);
    }
  });

  it('validates quest chapter, NPC, and chain links', () => {
    for (const q of phase21Quests) {
      expect(q.chapterKey && chapterKeys.has(q.chapterKey), q.key).toBe(true);
      expect(npcKeys.has(q.giverNpcKey), q.key).toBe(true);
      if (q.previousQuestKey) expect(questKeys.has(q.previousQuestKey), `${q.key} previous`).toBe(true);
      if (q.nextQuestKey) expect(questKeys.has(q.nextQuestKey), `${q.key} next`).toBe(true);
      if (q.prerequisiteQuestKey) expect(questKeys.has(q.prerequisiteQuestKey), `${q.key} prereq`).toBe(true);
    }
  });

  it('enforces branch hooks and hidden triggers', () => {
    for (const q of phase21Quests.filter((x) => x.kind === 'branch')) {
      expect(q.steps.some((s) => s.kind === 'choice') || q.loreSummary.includes('Branch'), q.key).toBe(true);
    }
    for (const q of phase21Quests.filter((x) => x.kind === 'hidden')) {
      expect((q as { trigger?: string }).trigger?.length ?? 0, q.key).toBeGreaterThan(0);
      expect(q.steps.some((s) => s.kind === 'explore'), q.key).toBe(true);
    }
  });

  it('keeps side/branch/hidden reward ratios below main baseline', () => {
    const mainAvg = phase21Quests.filter((q) => q.kind === 'main').reduce((sum, q) => sum + resourceScore(q), 0) / 120;
    const maxRatio = { side: 0.45, branch: 0.6, hidden: 0.5 } as const;
    for (const kind of ['side', 'branch', 'hidden'] as const) {
      const list = phase21Quests.filter((q) => q.kind === kind);
      const avg = list.reduce((sum, q) => sum + resourceScore(q), 0) / list.length;
      expect(avg / mainAvg, kind).toBeLessThanOrEqual(maxRatio[kind]);
    }
  });

  it('daily and weekly templates are capped', () => {
    for (const m of missionsByPeriod('DAILY').filter((x) => x.key.startsWith('daily_phase21_'))) {
      expect(m.rewards.linhThach ?? 0, m.key).toBeLessThanOrEqual(500);
      expect(m.rewards.exp ?? 0, m.key).toBeLessThanOrEqual(1200);
    }
    for (const m of missionsByPeriod('WEEKLY').filter((x) => x.key.startsWith('weekly_phase21_'))) {
      expect(m.rewards.linhThach ?? 0, m.key).toBeLessThanOrEqual(2000);
      expect(m.rewards.exp ?? 0, m.key).toBeLessThanOrEqual(6000);
    }
  });

  it('dialogue references valid NPCs and quests', () => {
    for (const node of STORY_DIALOGUES) {
      expect(npcKeys.has(node.npcKey), node.id).toBe(true);
      if (node.questKey) expect(questKeys.has(node.questKey), node.id).toBe(true);
      expect(node.text.length, node.id).toBeGreaterThan(0);
      expect(node.textEn?.length ?? 0, node.id).toBeGreaterThan(0);
    }
  });
});
