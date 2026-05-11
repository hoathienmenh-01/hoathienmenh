import { describe, expect, it } from 'vitest';
import { ITEMS } from './items';
import { NPCS } from './npcs';
import { QUESTS } from './quests';
import { REALMS } from './realms';
import {
  STORY_CHAPTERS,
  storyChapterByKey,
  storyChaptersByQuestChain,
  storyChaptersUnlockedAtRealm,
} from './story-chapters';

const ITEM_KEYS = new Set(ITEMS.map((item) => item.key));
const NPC_KEYS = new Set(NPCS.map((npc) => npc.key));
const QUEST_KEYS = new Set(QUESTS.map((quest) => quest.key));
const REALMS_BY_KEY = new Map(REALMS.map((realm) => [realm.key, realm]));

describe('STORY_CHAPTERS catalog integrity (Phase 21)', () => {
  it('has at least six ordered main-story chapters with unique keys', () => {
    expect(STORY_CHAPTERS.length).toBeGreaterThanOrEqual(6);
    const keys = STORY_CHAPTERS.map((chapter) => chapter.chapterKey);
    expect(new Set(keys).size).toBe(keys.length);

    STORY_CHAPTERS.forEach((chapter, index) => {
      expect(chapter.order).toBe(index + 1);
    });
  });

  it('has vi/en title and description parity', () => {
    for (const chapter of STORY_CHAPTERS) {
      expect(chapter.titleVi.trim(), chapter.chapterKey).not.toHaveLength(0);
      expect(chapter.titleEn.trim(), chapter.chapterKey).not.toHaveLength(0);
      expect(chapter.descriptionVi.trim(), chapter.chapterKey).not.toHaveLength(0);
      expect(chapter.descriptionEn.trim(), chapter.chapterKey).not.toHaveLength(0);
    }
  });

  it('realm gates match REALMS catalog', () => {
    for (const chapter of STORY_CHAPTERS) {
      const realm = REALMS_BY_KEY.get(chapter.requiredRealmKey);
      expect(realm, chapter.chapterKey).toBeDefined();
      expect(chapter.requiredRealmOrder, chapter.chapterKey).toBe(realm?.order);

      if (chapter.unlockCondition.realmKey) {
        expect(REALMS_BY_KEY.has(chapter.unlockCondition.realmKey), chapter.chapterKey).toBe(true);
      }
    }
  });

  it('references NPCs and quest prerequisites that resolve when already cataloged', () => {
    for (const chapter of STORY_CHAPTERS) {
      for (const npcKey of chapter.involvedNpcKeys) {
        expect(NPC_KEYS.has(npcKey), `${chapter.chapterKey} npc=${npcKey}`).toBe(true);
      }

      if (chapter.unlockCondition.questKey) {
        const isFutureQuest = chapter.unlockCondition.questKey.startsWith('phase21_');
        expect(
          isFutureQuest || QUEST_KEYS.has(chapter.unlockCondition.questKey),
          `${chapter.chapterKey} unlock quest=${chapter.unlockCondition.questKey}`,
        ).toBe(true);
      }
    }
  });

  it('reserves five main quest keys per chapter for Checkpoint 3', () => {
    for (const chapter of STORY_CHAPTERS) {
      expect(chapter.mainQuestKeys, chapter.chapterKey).toHaveLength(5);
      expect(new Set(chapter.mainQuestKeys).size, chapter.chapterKey).toBe(5);
      for (const questKey of chapter.mainQuestKeys) {
        expect(questKey.startsWith('phase21_ch'), `${chapter.chapterKey} quest=${questKey}`).toBe(true);
      }
    }
  });

  it('chapter rewards are modest and reference existing item catalog entries', () => {
    for (const chapter of STORY_CHAPTERS) {
      expect(chapter.chapterReward.linhThach ?? 0, chapter.chapterKey).toBeLessThanOrEqual(1_500);
      expect(chapter.chapterReward.exp ?? 0, chapter.chapterKey).toBeLessThanOrEqual(5_500);
      expect(chapter.chapterReward.congHien ?? 0, chapter.chapterKey).toBeLessThanOrEqual(250);

      for (const item of chapter.chapterReward.items ?? []) {
        expect(ITEM_KEYS.has(item.itemKey), `${chapter.chapterKey} item=${item.itemKey}`).toBe(true);
        expect(item.qty, `${chapter.chapterKey} item=${item.itemKey}`).toBeGreaterThan(0);
      }
    }
  });

  it('lookup helpers return deterministic chapter groups', () => {
    const first = STORY_CHAPTERS[0]!;
    expect(storyChapterByKey(first.chapterKey)).toBe(first);
    expect(storyChaptersByQuestChain(first.mainQuestChainKey)).toEqual([first]);
    expect(storyChaptersUnlockedAtRealm(0).map((chapter) => chapter.chapterKey)).toEqual([
      'chapter_pham_nhan_nhap_dao',
    ]);
  });
});
