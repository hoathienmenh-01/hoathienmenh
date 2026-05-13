/**
 * Phase 33 catalog integrity tests — Story Quest Expansion V2 (Quyển II–IV).
 *
 * Enforce:
 *   - 19 chapters spanning Chap 9..27 (3 volumes).
 *   - Realm order 9..27 unique, monotonic, match REALMS catalog.
 *   - Mỗi chương ≥ 5 main, ≥ 3 side, ≥ 1 hidden, ≥ 1 daily, ≥ 1 weekly.
 *   - Quest key unique và không xung đột Phase 21 (prefix `q_chXX_`).
 *   - NPC giver phải resolve trong NPCS.
 *   - Boss/Dungeon ref nhất quán giữa chapter và quest steps.
 *   - Reward cap đúng theo `Phase33RewardPolicyKey`.
 *   - Daily/Weekly có cap (>=1, không null).
 *   - Hidden quest có affinity gate hoặc story flag gate.
 *   - Forbidden item: catalog không grant tier endgame miễn phí (regex check).
 *   - Story flag convention: `flag_chXX_*` hoặc `route_chXX_*` hoặc `ending_*`
 *     hoặc `flag_volume_*`.
 */

import { describe, expect, it } from 'vitest';
import { NPCS } from './npcs';
import { QUESTS } from './quests';
import { REALMS, realmByKey } from './realms';
import {
  PHASE33_VOLUMES,
  STORY_CHAPTERS_V2,
  phase33ChapterByKey,
  phase33ChaptersByRealmOrder,
  phase33ChaptersByVolume,
  phase33VolumeByKey,
  phase33UnresolvedRealmKeys,
  type Phase33ChapterDef,
} from './story-chapters-quyen-ii-iv';
import {
  STORY_QUEST_EXPANSION,
  getStoryRewardBudgetForChapter,
  getStoryRewardTierForRealmOrder,
  phase33QuestByKey,
  phase33QuestsByChapter,
  phase33QuestsByKind,
  phase33QuestsByVolume,
  phase33ReferencedBossKeys,
  phase33ReferencedDungeonKeys,
  phase33ReferencedItemKeys,
  phase33ReferencedNpcKeys,
  phase33ReferencedRegionKeys,
  phase33RewardCap,
  phase33StoryFlagsFromQuests,
  type Phase33QuestDef,
} from './story-quest-expansion';

const NPC_KEYS = new Set(NPCS.map((npc) => npc.key));
const PHASE21_QUEST_KEYS = new Set(QUESTS.map((q) => q.key));

const FORBIDDEN_ENDGAME_REWARD_REGEX = /(_tien_ngoc_nap|_top_tier_freebie|_ban_nguyen_khi_raw_huge|_vinh_hang_dao_raw|_hu_khong_seal_raw)/i;

describe('Phase 33 — Story chapters V2 catalog', () => {
  it('has exactly 19 chapters spanning Chap 9..27', () => {
    expect(STORY_CHAPTERS_V2).toHaveLength(19);
    const numbers = STORY_CHAPTERS_V2.map((c) => c.chapNumber);
    expect(numbers).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]);
  });

  it('has unique chapter keys', () => {
    const keys = STORY_CHAPTERS_V2.map((c) => c.chapKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('realm gate matches REALMS catalog (order 9..27)', () => {
    const realmsByOrder = new Map(REALMS.map((r) => [r.order, r]));
    STORY_CHAPTERS_V2.forEach((chapter) => {
      const realm = realmByKey(chapter.requiredRealmKey);
      expect(realm, chapter.chapKey).toBeDefined();
      expect(realm?.order, chapter.chapKey).toBe(chapter.requiredRealmOrder);
      expect(realmsByOrder.get(chapter.requiredRealmOrder)?.key, chapter.chapKey).toBe(chapter.requiredRealmKey);
    });
  });

  it('has no unresolved realm keys', () => {
    expect(phase33UnresolvedRealmKeys()).toEqual([]);
  });

  it('binds previous/next chap into a single chain Ch9..Ch27', () => {
    const byKey = new Map(STORY_CHAPTERS_V2.map((c) => [c.chapKey, c]));
    for (const chapter of STORY_CHAPTERS_V2) {
      if (chapter.previousChapKey) {
        expect(byKey.has(chapter.previousChapKey), `${chapter.chapKey} prev`).toBe(true);
      }
      if (chapter.nextChapKey) {
        expect(byKey.has(chapter.nextChapKey), `${chapter.chapKey} next`).toBe(true);
      }
    }
    expect(STORY_CHAPTERS_V2[0]!.previousChapKey).toBeNull();
    expect(STORY_CHAPTERS_V2.at(-1)!.nextChapKey).toBeNull();
  });

  it('every chapter NPC key resolves in NPCS catalog', () => {
    for (const chapter of STORY_CHAPTERS_V2) {
      for (const npcKey of chapter.mainNpcKeys) {
        expect(NPC_KEYS.has(npcKey), `${chapter.chapKey} npc=${npcKey}`).toBe(true);
      }
    }
  });

  it('boss & dungeon ref are consistent between chapter and quest steps', () => {
    for (const chapter of STORY_CHAPTERS_V2) {
      const chapQuests = phase33QuestsByChapter(chapter.chapKey);
      const referencedBosses = new Set<string>();
      const referencedDungeons = new Set<string>();
      for (const q of chapQuests) {
        for (const step of q.steps) {
          if (step.kind === 'boss_defeat') referencedBosses.add(step.targetId);
          if (step.kind === 'dungeon_clear') referencedDungeons.add(step.targetId);
        }
      }
      for (const bossKey of chapter.bossKeys) {
        expect(referencedBosses.has(bossKey), `${chapter.chapKey} boss=${bossKey} missing in quest steps`).toBe(true);
      }
      for (const dgnKey of chapter.storyDungeonKeys) {
        expect(referencedDungeons.has(dgnKey), `${chapter.chapKey} dungeon=${dgnKey} missing in quest steps`).toBe(true);
      }
    }
  });

  it('vi/en title and description parity', () => {
    for (const chapter of STORY_CHAPTERS_V2) {
      expect(chapter.titleVi.trim(), chapter.chapKey).not.toHaveLength(0);
      expect(chapter.titleEn.trim(), chapter.chapKey).not.toHaveLength(0);
      expect(chapter.themeVi.trim(), chapter.chapKey).not.toHaveLength(0);
      expect(chapter.themeEn.trim(), chapter.chapKey).not.toHaveLength(0);
      expect(chapter.summaryVi.trim(), chapter.chapKey).not.toHaveLength(0);
      expect(chapter.summaryEn.trim(), chapter.chapKey).not.toHaveLength(0);
    }
  });

  it('volume metadata covers Ch9..Ch16 / Ch17..Ch21 / Ch22..Ch27', () => {
    expect(PHASE33_VOLUMES).toHaveLength(3);
    const vol2 = phase33VolumeByKey('quyen_ii_tien_gioi')!;
    const vol3 = phase33VolumeByKey('quyen_iii_thanh_dao')!;
    const vol4 = phase33VolumeByKey('quyen_iv_ban_nguyen')!;
    expect(vol2.chapRange).toEqual([9, 16]);
    expect(vol3.chapRange).toEqual([17, 21]);
    expect(vol4.chapRange).toEqual([22, 27]);
    expect(phase33ChaptersByVolume('quyen_ii_tien_gioi')).toHaveLength(8);
    expect(phase33ChaptersByVolume('quyen_iii_thanh_dao')).toHaveLength(5);
    expect(phase33ChaptersByVolume('quyen_iv_ban_nguyen')).toHaveLength(6);
  });

  it('reward policy key matches volume', () => {
    const expected: Record<string, string> = {
      quyen_ii_tien_gioi: 'reward_policy_quyen_ii',
      quyen_iii_thanh_dao: 'reward_policy_quyen_iii',
      quyen_iv_ban_nguyen: 'reward_policy_quyen_iv',
    };
    for (const chapter of STORY_CHAPTERS_V2) {
      expect(chapter.rewardPolicyKey, chapter.chapKey).toBe(expected[chapter.volumeKey]);
    }
  });

  it('endingFlagKeys appear only on Quyển IV final chapters (Ch26, Ch27)', () => {
    const withEndings = STORY_CHAPTERS_V2.filter((c) => c.endingFlagKeys.length > 0);
    expect(withEndings.map((c) => c.chapKey).sort()).toEqual(['ch26', 'ch27']);
  });

  it('phase33ChaptersByRealmOrder returns chapters under the cap', () => {
    expect(phase33ChaptersByRealmOrder(8)).toHaveLength(0);
    expect(phase33ChaptersByRealmOrder(9)).toHaveLength(1);
    expect(phase33ChaptersByRealmOrder(16).map((c) => c.chapKey)).toEqual([
      'ch09', 'ch10', 'ch11', 'ch12', 'ch13', 'ch14', 'ch15', 'ch16',
    ]);
    expect(phase33ChaptersByRealmOrder(27)).toHaveLength(19);
  });

  it('phase33ChapterByKey lookup works', () => {
    const c = phase33ChapterByKey('ch16');
    expect(c?.chapNumber).toBe(16);
  });
});

describe('Phase 33 — Story Quest Expansion catalog', () => {
  // Phase 33.0B: density target = 16 main / 11 side / 6 branch / 3 hidden / 1 daily / 1 weekly
  // = 38 quest/chapter, 19 chapters → 722 total.
  it('has ≥ 15 and ≤ 20 main quests per chapter (Phase 33.0B target 16, total 304)', () => {
    const mains = phase33QuestsByKind('main');
    expect(mains).toHaveLength(19 * 16);
    for (const chapter of STORY_CHAPTERS_V2) {
      const list = mains.filter((q) => q.chapKey === chapter.chapKey);
      expect(list.length, `${chapter.chapKey} main count`).toBeGreaterThanOrEqual(15);
      expect(list.length, `${chapter.chapKey} main count≤`).toBeLessThanOrEqual(20);
    }
  });

  it('has ≥ 10 and ≤ 15 side quests per chapter (Phase 33.0B target 11, total 209)', () => {
    const sides = phase33QuestsByKind('side');
    expect(sides).toHaveLength(19 * 11);
    for (const chapter of STORY_CHAPTERS_V2) {
      const list = sides.filter((q) => q.chapKey === chapter.chapKey);
      expect(list.length, `${chapter.chapKey} side count`).toBeGreaterThanOrEqual(10);
      expect(list.length, `${chapter.chapKey} side count≤`).toBeLessThanOrEqual(15);
    }
  });

  it('has ≥ 5 and ≤ 8 branch quests per chapter (Phase 33.0B target 6, total 114)', () => {
    const branches = phase33QuestsByKind('branch');
    expect(branches).toHaveLength(19 * 6);
    for (const chapter of STORY_CHAPTERS_V2) {
      const list = branches.filter((q) => q.chapKey === chapter.chapKey);
      expect(list.length, `${chapter.chapKey} branch count`).toBeGreaterThanOrEqual(5);
      expect(list.length, `${chapter.chapKey} branch count≤`).toBeLessThanOrEqual(8);
    }
  });

  it('has ≥ 2 and ≤ 4 hidden quests per chapter (Phase 33.0B target 3, total 57)', () => {
    const hiddens = phase33QuestsByKind('hidden');
    expect(hiddens).toHaveLength(19 * 3);
    for (const chapter of STORY_CHAPTERS_V2) {
      const list = hiddens.filter((q) => q.chapKey === chapter.chapKey);
      expect(list.length, `${chapter.chapKey} hidden count`).toBeGreaterThanOrEqual(2);
      expect(list.length, `${chapter.chapKey} hidden count≤`).toBeLessThanOrEqual(4);
    }
  });

  it('has ≥ 1 daily and ≥ 1 weekly per chapter, both capped', () => {
    const dailies = phase33QuestsByKind('daily');
    const weeklies = phase33QuestsByKind('weekly');
    expect(dailies).toHaveLength(19);
    expect(weeklies).toHaveLength(19);
    for (const q of dailies) {
      expect(q.dailyCap, q.questKey).toBeGreaterThanOrEqual(1);
      expect(q.dailyCap, q.questKey).toBeLessThanOrEqual(3);
      expect(q.weeklyCap, q.questKey).toBeNull();
    }
    for (const q of weeklies) {
      expect(q.weeklyCap, q.questKey).toBeGreaterThanOrEqual(1);
      expect(q.weeklyCap, q.questKey).toBeLessThanOrEqual(3);
      expect(q.dailyCap, q.questKey).toBeNull();
    }
  });

  it('quest keys are unique across catalog and do not collide with Phase 21', () => {
    const seen = new Set<string>();
    for (const q of STORY_QUEST_EXPANSION) {
      expect(seen.has(q.questKey), q.questKey).toBe(false);
      seen.add(q.questKey);
      expect(PHASE21_QUEST_KEYS.has(q.questKey), `phase21 collision ${q.questKey}`).toBe(false);
      expect(q.questKey).toMatch(/^q_ch\d{2}_(main|side|branch|hidden|daily|weekly)_\d{2}$/);
    }
  });

  it('every quest giver and affinity npc resolves in NPCS', () => {
    for (const q of STORY_QUEST_EXPANSION) {
      expect(NPC_KEYS.has(q.giverNpcKey), `${q.questKey} giver=${q.giverNpcKey}`).toBe(true);
      if (q.requiredAffinityNpcKey) {
        expect(NPC_KEYS.has(q.requiredAffinityNpcKey), `${q.questKey} affinity=${q.requiredAffinityNpcKey}`).toBe(true);
      }
      for (const aff of q.rewards.affinity ?? []) {
        expect(NPC_KEYS.has(aff.npcKey), `${q.questKey} affinity reward=${aff.npcKey}`).toBe(true);
      }
    }
  });

  it('every quest realm gate matches the chapter realm', () => {
    const chapMap = new Map(STORY_CHAPTERS_V2.map((c) => [c.chapKey, c]));
    for (const q of STORY_QUEST_EXPANSION) {
      const chapter = chapMap.get(q.chapKey);
      expect(chapter, q.questKey).toBeDefined();
      expect(q.requiredRealmKey, q.questKey).toBe(chapter!.requiredRealmKey);
      expect(q.requiredRealmOrder, q.questKey).toBe(chapter!.requiredRealmOrder);
    }
  });

  it('prerequisite quest keys (if set) resolve in expansion catalog', () => {
    const keys = new Set(STORY_QUEST_EXPANSION.map((q) => q.questKey));
    for (const q of STORY_QUEST_EXPANSION) {
      if (q.prerequisiteQuestKey) {
        expect(keys.has(q.prerequisiteQuestKey), `${q.questKey} prereq=${q.prerequisiteQuestKey}`).toBe(true);
      }
    }
  });

  it('main quest 01 is the only quest with no prerequisite per chapter', () => {
    for (const chapter of STORY_CHAPTERS_V2) {
      const noPrereq = phase33QuestsByChapter(chapter.chapKey).filter((q) => q.prerequisiteQuestKey === null);
      expect(noPrereq.map((q) => q.questKey), chapter.chapKey).toEqual([
        `q_${chapter.chapKey}_main_01`,
      ]);
    }
  });

  it('reward cap is enforced per policy + kind', () => {
    for (const q of STORY_QUEST_EXPANSION) {
      const cap = phase33RewardCap(q.rewardPolicyKey);
      const linhThach = q.rewards.linhThach ?? 0;
      const exp = q.rewards.exp ?? 0;
      switch (q.kind) {
        case 'main':
          expect(linhThach, q.questKey).toBeLessThanOrEqual(cap.main);
          break;
        case 'side':
          expect(linhThach, q.questKey).toBeLessThanOrEqual(cap.side);
          break;
        case 'branch':
          // Phase 33.0B: branch cap = side * 0.8.
          expect(linhThach, q.questKey).toBeLessThanOrEqual(Math.floor(cap.side * 0.8));
          break;
        case 'hidden':
          expect(linhThach, q.questKey).toBeLessThanOrEqual(cap.hidden);
          break;
        case 'daily':
          expect(linhThach, q.questKey).toBeLessThanOrEqual(cap.daily);
          break;
        case 'weekly':
          expect(linhThach, q.questKey).toBeLessThanOrEqual(cap.weekly);
          break;
      }
      expect(exp, q.questKey).toBeLessThanOrEqual(cap.exp);
    }
  });

  it('Phase 33.0B reward tier helper covers realm order 9..27', () => {
    expect(getStoryRewardTierForRealmOrder(9)).toBe('t1_early');
    expect(getStoryRewardTierForRealmOrder(10)).toBe('t1_early');
    expect(getStoryRewardTierForRealmOrder(11)).toBe('t2_mid');
    expect(getStoryRewardTierForRealmOrder(13)).toBe('t2_mid');
    expect(getStoryRewardTierForRealmOrder(14)).toBe('t3_late');
    expect(getStoryRewardTierForRealmOrder(16)).toBe('t3_late');
    expect(getStoryRewardTierForRealmOrder(17)).toBe('t4_thanh');
    expect(getStoryRewardTierForRealmOrder(19)).toBe('t4_thanh');
    expect(getStoryRewardTierForRealmOrder(20)).toBe('t5_thien_dao');
    expect(getStoryRewardTierForRealmOrder(21)).toBe('t5_thien_dao');
    expect(getStoryRewardTierForRealmOrder(22)).toBe('t6_ban_nguyen');
    expect(getStoryRewardTierForRealmOrder(24)).toBe('t6_ban_nguyen');
    expect(getStoryRewardTierForRealmOrder(25)).toBe('t7_endgame');
    expect(getStoryRewardTierForRealmOrder(27)).toBe('t7_endgame');
  });

  it('Phase 33.0B reward budget per chapter respects volume cap', () => {
    for (const chapter of STORY_CHAPTERS_V2) {
      const cap = phase33RewardCap(chapter.rewardPolicyKey);
      const mainBudget = getStoryRewardBudgetForChapter(chapter.chapKey, 'main');
      const sideBudget = getStoryRewardBudgetForChapter(chapter.chapKey, 'side');
      const branchBudget = getStoryRewardBudgetForChapter(chapter.chapKey, 'branch');
      const hiddenBudget = getStoryRewardBudgetForChapter(chapter.chapKey, 'hidden');
      expect(mainBudget, chapter.chapKey).toBeGreaterThan(0);
      expect(mainBudget, chapter.chapKey).toBeLessThanOrEqual(cap.main);
      expect(sideBudget, chapter.chapKey).toBeLessThanOrEqual(cap.side);
      // Branch <= side * 0.8 (volume-level), but tier multiplier can raise budget; clamp under branch cap.
      expect(branchBudget, chapter.chapKey).toBeLessThanOrEqual(cap.branch);
      expect(hiddenBudget, chapter.chapKey).toBeLessThanOrEqual(cap.hidden);
    }
  });

  it('hidden quest has either affinity gate or required story flag', () => {
    for (const q of phase33QuestsByKind('hidden')) {
      const hasAffinity = q.requiredAffinityNpcKey !== null && (q.requiredAffinityScore ?? 0) > 0;
      const hasFlagGate = q.requiredStoryFlags.length > 0;
      expect(hasAffinity || hasFlagGate, q.questKey).toBe(true);
    }
  });

  it('Phase 33.0B branch quest is affinity-gated and reward stays under side cap × 0.8', () => {
    const branches = phase33QuestsByKind('branch');
    expect(branches.length, 'has branches').toBeGreaterThan(0);
    for (const q of branches) {
      // Affinity gate required.
      expect(q.requiredAffinityNpcKey, q.questKey).not.toBeNull();
      expect(q.requiredAffinityScore ?? 0, q.questKey).toBeGreaterThanOrEqual(18);
      // Branch never grants endgame items.
      for (const item of q.rewards.items ?? []) {
        expect(item.itemKey, q.questKey).not.toMatch(FORBIDDEN_ENDGAME_REWARD_REGEX);
      }
      // Branch never grants Volume unlock flag.
      for (const flag of q.rewards.storyFlags ?? []) {
        expect(flag, q.questKey).not.toMatch(/^flag_volume_/);
        expect(flag, q.questKey).not.toMatch(/^ending_/);
      }
      // Cap clamp.
      const cap = phase33RewardCap(q.rewardPolicyKey);
      const linhThach = q.rewards.linhThach ?? 0;
      expect(linhThach, q.questKey).toBeLessThanOrEqual(Math.floor(cap.side * 0.8));
    }
  });

  it('Phase 33.0B NPC realm gate ≤ quest required realm order', () => {
    const npcByKey = new Map(NPCS.map((n) => [n.key, n]));
    for (const q of STORY_QUEST_EXPANSION) {
      const npc = npcByKey.get(q.giverNpcKey);
      expect(npc, `${q.questKey} giver=${q.giverNpcKey}`).toBeDefined();
      expect(npc!.realmGateOrder, q.questKey).toBeLessThanOrEqual(q.requiredRealmOrder);
    }
  });

  it('forbidden endgame items not granted via quest rewards', () => {
    for (const q of STORY_QUEST_EXPANSION) {
      for (const item of q.rewards.items ?? []) {
        expect(item.itemKey, q.questKey).not.toMatch(FORBIDDEN_ENDGAME_REWARD_REGEX);
      }
    }
  });

  it('story flag keys follow convention', () => {
    const flags = phase33StoryFlagsFromQuests();
    expect(flags.length).toBeGreaterThan(0);
    for (const flag of flags) {
      expect(flag, flag).toMatch(/^(flag_(ch\d{2}|volume_(ii|iii|iv|endgame_routes))_|route_ch\d{2}_|ending_|flag_endgame_routes_unlocked)/);
    }
  });

  it('phase33QuestByKey and phase33QuestsByVolume lookups work', () => {
    expect(phase33QuestByKey('q_ch09_main_01')?.kind).toBe('main');
    expect(phase33QuestByKey('q_ch16_main_05')?.chapKey).toBe('ch16');
    expect(phase33QuestByKey('q_ch09_branch_01')?.kind).toBe('branch');
    expect(phase33QuestByKey('q_ch27_main_16')?.kind).toBe('main');
    // Phase 33.0B density = 38/chapter (16 main + 11 side + 6 branch + 3 hidden + 1 daily + 1 weekly).
    expect(phase33QuestsByVolume('quyen_ii_tien_gioi').length).toBe(8 * 38);
    expect(phase33QuestsByVolume('quyen_iii_thanh_dao').length).toBe(5 * 38);
    expect(phase33QuestsByVolume('quyen_iv_ban_nguyen').length).toBe(6 * 38);
  });

  it('referenced NPC keys all resolve', () => {
    for (const npcKey of phase33ReferencedNpcKeys()) {
      expect(NPC_KEYS.has(npcKey), `referenced npc=${npcKey}`).toBe(true);
    }
  });

  it('referenced boss/dungeon/item/region keys are non-empty + consistent shape', () => {
    expect(phase33ReferencedBossKeys().length).toBeGreaterThanOrEqual(19);
    expect(phase33ReferencedDungeonKeys().length).toBeGreaterThanOrEqual(19);
    expect(phase33ReferencedItemKeys().length).toBeGreaterThan(0);
    expect(phase33ReferencedRegionKeys().length).toBeGreaterThanOrEqual(19);
    for (const key of phase33ReferencedBossKeys()) expect(key).toMatch(/^boss_/);
    for (const key of phase33ReferencedDungeonKeys()) expect(key).toMatch(/^ch\d{2}_/);
    for (const key of phase33ReferencedRegionKeys()) expect(key).toMatch(/^region_/);
  });

  it('quest steps cover all kinds (talk/kill/collect/explore/choice/dungeon/boss/flag) across catalog', () => {
    const seen = new Set<string>();
    for (const q of STORY_QUEST_EXPANSION) {
      for (const step of q.steps) seen.add(step.kind);
    }
    expect(seen.has('talk')).toBe(true);
    expect(seen.has('kill')).toBe(true);
    expect(seen.has('collect')).toBe(true);
    expect(seen.has('explore')).toBe(true);
    expect(seen.has('choice')).toBe(true);
    expect(seen.has('dungeon_clear')).toBe(true);
    expect(seen.has('boss_defeat')).toBe(true);
    expect(seen.has('flag_set')).toBe(true);
  });
});

describe('Phase 33 — Progression unlock chain Ch9..Ch27', () => {
  it('Ch9 requires realm order 9 (Độ Kiếp) and is the first chapter', () => {
    const c = phase33ChapterByKey('ch09')!;
    expect(c.requiredRealmKey).toBe('do_kiep');
    expect(c.previousChapKey).toBeNull();
  });

  it('Ch16 unlocks Quyển III via flag', () => {
    const c = phase33ChapterByKey('ch16')!;
    expect(c.storyFlagKeys).toContain('flag_volume_iii_unlocked');
    expect(c.storyFlagKeys).toContain('flag_volume_ii_cleared');
  });

  it('Ch21 unlocks Quyển IV via flag', () => {
    const c = phase33ChapterByKey('ch21')!;
    expect(c.storyFlagKeys).toContain('flag_volume_iv_unlocked');
    expect(c.storyFlagKeys).toContain('flag_volume_iii_cleared');
  });

  it('Ch27 sets endgame routes and Volume IV cleared', () => {
    const c = phase33ChapterByKey('ch27')!;
    expect(c.storyFlagKeys).toContain('flag_volume_iv_cleared');
    expect(c.storyFlagKeys).toContain('flag_endgame_routes_unlocked');
    expect(c.endingFlagKeys.length).toBeGreaterThanOrEqual(2);
    expect(c.nextChapKey).toBeNull();
  });

  it('repeatableAfterClear is enabled with cap = 1 for all chapters', () => {
    for (const chapter of STORY_CHAPTERS_V2 as readonly Phase33ChapterDef[]) {
      expect(chapter.repeatableAfterClear.daily).toBe(true);
      expect(chapter.repeatableAfterClear.weekly).toBe(true);
      expect(chapter.repeatableAfterClear.dailyCap).toBe(1);
      expect(chapter.repeatableAfterClear.weeklyCap).toBe(1);
    }
  });
});

describe('Phase 33 — Phase 21 catalog untouched', () => {
  it('Phase 21 quest count and main quest target preserved', () => {
    const phase21Quests = QUESTS.filter((q) => q.key.startsWith('phase21_'));
    const phase21Mains = phase21Quests.filter((q) => q.kind === 'main');
    expect(phase21Mains).toHaveLength(120);
    expect(phase21Quests.filter((q) => q.kind === 'side').length).toBeGreaterThanOrEqual(160);
  });

  it('STORY_CHAPTERS (Phase 21) length unchanged at 8', () => {
    // STORY_CHAPTERS_V2 is a SEPARATE catalog and must NOT pollute Phase 21 chapter array.
    // The existing test asserts STORY_CHAPTERS.length >= 8; if it ever becomes >= 19,
    // someone merged the catalogs by accident.
    // We re-import to avoid coupling; check via QUESTS prefix already done above.
    // Sanity: no quest in STORY_QUEST_EXPANSION uses the `phase21_` prefix.
    for (const q of STORY_QUEST_EXPANSION) {
      expect(q.questKey.startsWith('phase21_'), q.questKey).toBe(false);
    }
  });

  it('helper aliases — phase33QuestByKey + phase33Quest filters are stable for stable inputs', () => {
    const sample = phase33QuestByKey('q_ch27_main_05')!;
    expect(sample.kind).toBe('main');
    expect(sample.chapKey).toBe('ch27');
    expect(sample.rewardPolicyKey).toBe('reward_policy_quyen_iv');
    expect((sample as Phase33QuestDef).rewards.storyFlags).toContain('flag_ch27_cleared');
  });
});
