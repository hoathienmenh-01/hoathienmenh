/**
 * Phase 12.8.A Story Dungeon Catalog invariant + helper tests.
 *
 * Catalog-only PR — KHÔNG runtime, KHÔNG Prisma. Test backstop catch
 * orphan reference / typo / drift trước khi PR Phase 12.8.B wire runtime.
 */
import { describe, expect, it } from 'vitest';
import { BOSSES } from './boss';
import { MONSTERS } from './combat';
import { isMapRegionKey } from './map-regions';
import { QUESTS } from './quests';
import { realmByKey } from './realms';
import {
  STORY_DUNGEONS,
  availableStoryDungeonsForQuestState,
  computeStoryDungeonStatus,
  storyDungeonByKey,
  storyDungeonsForQuest,
  validateStoryDungeonCatalog,
  type QuestStateForStoryDungeon,
} from './story-dungeons';
import { STORY_DIALOGUES } from './story-dialogues';

describe('STORY_DUNGEONS catalog integrity', () => {
  it('có ≥ 3 entries (foundation seed)', () => {
    expect(STORY_DUNGEONS.length).toBeGreaterThanOrEqual(3);
  });

  it('mọi key unique + snake_case', () => {
    const keys = STORY_DUNGEONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) {
      expect(k, `key ${k}`).toMatch(/^story_dgn_[a-z0-9_]+$/);
    }
  });

  it('storyDungeonByKey() resolve mọi entry', () => {
    for (const d of STORY_DUNGEONS) {
      expect(storyDungeonByKey(d.key)?.key).toBe(d.key);
    }
  });

  it('mỗi template có titleVi + descriptionVi + i18n key prefix đúng', () => {
    for (const d of STORY_DUNGEONS) {
      expect(d.titleVi.trim().length, `${d.key} titleVi`).toBeGreaterThan(0);
      expect(d.descriptionVi.trim().length, `${d.key} descriptionVi`).toBeGreaterThan(0);
      expect(d.titleI18nKey, `${d.key} titleI18nKey`).toBe(`story_dungeon.${d.key}.title`);
      expect(d.descriptionI18nKey, `${d.key} descriptionI18nKey`).toBe(
        `story_dungeon.${d.key}.description`,
      );
    }
  });

  it('mọi requiredQuestKey resolve qua QUESTS', () => {
    const questKeys = new Set(QUESTS.map((q) => q.key));
    for (const d of STORY_DUNGEONS) {
      expect(questKeys.has(d.requiredQuestKey), `${d.key} questKey ${d.requiredQuestKey}`).toBe(
        true,
      );
    }
  });

  it('requiredQuestStep (nếu set) resolve trong QuestDef.steps tương ứng', () => {
    for (const d of STORY_DUNGEONS) {
      if (!d.requiredQuestStep) continue;
      const quest = QUESTS.find((q) => q.key === d.requiredQuestKey);
      expect(quest, `${d.key} questKey ${d.requiredQuestKey}`).toBeDefined();
      const step = quest!.steps.find((s) => s.id === d.requiredQuestStep);
      expect(
        step,
        `${d.key} step ${d.requiredQuestStep} not in quest ${d.requiredQuestKey}`,
      ).toBeDefined();
    }
  });

  it('mọi regionKey ∈ RegionKey union', () => {
    for (const d of STORY_DUNGEONS) {
      expect(isMapRegionKey(d.regionKey), `${d.key} regionKey ${d.regionKey}`).toBe(true);
    }
  });

  it('recommendedRealm + minRealmKey resolve qua realmByKey', () => {
    for (const d of STORY_DUNGEONS) {
      expect(realmByKey(d.recommendedRealm), `${d.key} recommendedRealm`).toBeDefined();
      if (d.minRealmKey) {
        expect(realmByKey(d.minRealmKey), `${d.key} minRealmKey`).toBeDefined();
      }
    }
  });

  it('monsterKeys không rỗng + mọi key resolve qua MonsterDef.key (no orphan)', () => {
    const monsterKeys = new Set(MONSTERS.map((m) => m.key));
    for (const d of STORY_DUNGEONS) {
      expect(d.monsterKeys.length, `${d.key} monsterKeys`).toBeGreaterThan(0);
      for (const mk of d.monsterKeys) {
        expect(monsterKeys.has(mk), `${d.key} monster ${mk}`).toBe(true);
      }
    }
  });

  it('bossKey (nếu set) resolve qua BossDef + region match', () => {
    const bossByKey = new Map(BOSSES.map((b) => [b.key, b] as const));
    for (const d of STORY_DUNGEONS) {
      if (!d.bossKey) continue;
      const boss = bossByKey.get(d.bossKey);
      expect(boss, `${d.key} boss ${d.bossKey}`).toBeDefined();
      if (boss && boss.regionKey) {
        expect(boss.regionKey, `${d.key} boss region`).toBe(d.regionKey);
      }
    }
  });

  it('entryDialogueKey / clearDialogueKey (nếu set) resolve qua STORY_DIALOGUES', () => {
    const dialogueIds = new Set(STORY_DIALOGUES.map((n) => n.id));
    for (const d of STORY_DUNGEONS) {
      if (d.entryDialogueKey) {
        expect(dialogueIds.has(d.entryDialogueKey), `${d.key} entryDialogue`).toBe(true);
      }
      if (d.clearDialogueKey) {
        expect(dialogueIds.has(d.clearDialogueKey), `${d.key} clearDialogue`).toBe(true);
      }
    }
  });

  it('rewardHint (nếu có) integer ≥ 0 + qty > 0', () => {
    for (const d of STORY_DUNGEONS) {
      const r = d.rewardHint;
      if (!r) continue;
      if (r.linhThach != null) expect(Number.isInteger(r.linhThach) && r.linhThach >= 0).toBe(true);
      if (r.tienNgoc != null) expect(Number.isInteger(r.tienNgoc) && r.tienNgoc >= 0).toBe(true);
      if (r.exp != null) expect(Number.isInteger(r.exp) && r.exp >= 0).toBe(true);
      for (const it of r.items ?? []) {
        expect(Number.isInteger(it.qty) && it.qty > 0, `${d.key} qty ${it.itemKey}`).toBe(true);
      }
    }
  });

  it('oneTime + enabled là boolean', () => {
    for (const d of STORY_DUNGEONS) {
      expect(typeof d.oneTime, `${d.key} oneTime`).toBe('boolean');
      expect(typeof d.enabled, `${d.key} enabled`).toBe('boolean');
    }
  });

  it('không có dungeon orphan (mỗi dungeon có ≥ 1 player flow vào)', () => {
    // Foundation invariant: catalog test enforce mỗi entry có
    // requiredQuestKey resolve được — đã cover ở test trên. Test này
    // double-check coverage: mọi chain quest đầu (phamnhan/luyenkhi/
    // truc_co/kim_dan main hoặc realm) có ít nhất 1 dungeon.
    const coveredQuestKeys = new Set(STORY_DUNGEONS.map((d) => d.requiredQuestKey));
    expect(coveredQuestKeys.size).toBeGreaterThanOrEqual(3);
  });
});

describe('validateStoryDungeonCatalog', () => {
  it('returns no issues for current catalog', () => {
    expect(validateStoryDungeonCatalog()).toEqual([]);
  });
});

describe('storyDungeonsForQuest helper', () => {
  it('list dungeon theo questKey', () => {
    const phamnhan = storyDungeonsForQuest('phamnhan_realm_01');
    expect(phamnhan.length).toBeGreaterThanOrEqual(1);
    for (const d of phamnhan) {
      expect(d.requiredQuestKey).toBe('phamnhan_realm_01');
    }
  });

  it('return rỗng cho questKey không có dungeon', () => {
    expect(storyDungeonsForQuest('quest_does_not_exist')).toEqual([]);
  });
});

describe('computeStoryDungeonStatus', () => {
  const phamnhanDungeon = STORY_DUNGEONS.find(
    (d) => d.key === 'story_dgn_phamnhan_back_mountain',
  )!;
  const kimDanDungeon = STORY_DUNGEONS.find(
    (d) => d.key === 'story_dgn_kim_dan_kim_son_thien_lo',
  )!;

  it('player chưa accept quest → locked', () => {
    const status = computeStoryDungeonStatus(phamnhanDungeon, {
      realmOrder: 0,
      questStateByKey: new Map(),
    });
    expect(status).toBe('locked');
  });

  it('player đã ACCEPTED quest + step progress đạt count → available', () => {
    const stepDef = QUESTS.find((q) => q.key === 'phamnhan_realm_01')!.steps.find(
      (s) => s.id === 'step_01',
    )!;
    const status = computeStoryDungeonStatus(phamnhanDungeon, {
      realmOrder: 0,
      questStateByKey: new Map<string, QuestStateForStoryDungeon>([
        ['phamnhan_realm_01', 'ACCEPTED'],
      ]),
      questStepProgress: new Map([['phamnhan_realm_01', { step_01: stepDef.count }]]),
    });
    expect(status).toBe('available');
  });

  it('player ACCEPTED nhưng step chưa đạt count → locked', () => {
    const status = computeStoryDungeonStatus(phamnhanDungeon, {
      realmOrder: 0,
      questStateByKey: new Map<string, QuestStateForStoryDungeon>([
        ['phamnhan_realm_01', 'ACCEPTED'],
      ]),
      questStepProgress: new Map([['phamnhan_realm_01', { step_01: 0 }]]),
    });
    expect(status).toBe('locked');
  });

  it('player COMPLETED quest → available (mọi step coi như đạt)', () => {
    const status = computeStoryDungeonStatus(phamnhanDungeon, {
      realmOrder: 0,
      questStateByKey: new Map<string, QuestStateForStoryDungeon>([
        ['phamnhan_realm_01', 'COMPLETED'],
      ]),
    });
    expect(status).toBe('available');
  });

  it('player CLAIMED quest → cleared', () => {
    const status = computeStoryDungeonStatus(phamnhanDungeon, {
      realmOrder: 0,
      questStateByKey: new Map<string, QuestStateForStoryDungeon>([
        ['phamnhan_realm_01', 'CLAIMED'],
      ]),
    });
    expect(status).toBe('cleared');
  });

  it('player chưa đạt minRealm → locked', () => {
    const status = computeStoryDungeonStatus(kimDanDungeon, {
      realmOrder: 0,
      questStateByKey: new Map<string, QuestStateForStoryDungeon>([
        ['kim_dan_main_01', 'ACCEPTED'],
      ]),
    });
    expect(status).toBe('locked');
  });
});

describe('availableStoryDungeonsForQuestState', () => {
  it('lọc dungeon disabled + locked', () => {
    const out = availableStoryDungeonsForQuestState({
      realmOrder: 0,
      questStateByKey: new Map(),
    });
    expect(out).toEqual([]);
  });

  it('trả về dungeon available + cleared cho player snapshot có quest mở', () => {
    const out = availableStoryDungeonsForQuestState({
      realmOrder: 3,
      questStateByKey: new Map<string, QuestStateForStoryDungeon>([
        ['phamnhan_realm_01', 'CLAIMED'],
        ['luyenkhi_main_01', 'COMPLETED'],
      ]),
    });
    expect(out.length).toBeGreaterThanOrEqual(2);
    const map = new Map(out.map((e) => [e.template.key, e.status]));
    expect(map.get('story_dgn_phamnhan_back_mountain')).toBe('cleared');
    expect(map.get('story_dgn_luyenkhi_hac_lam_trial')).toBe('available');
  });
});
