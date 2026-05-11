import { describe, it, expect } from 'vitest';
import { REALMS } from './realms';
import { NPCS } from './npcs';
import { ITEMS } from './items';
import {
  QUESTS,
  questByKey,
  questsByRealm,
  questsByGiver,
  questsByKind,
  questsByChain,
  questsAvailableAtRealm,
} from './quests';
import type { QuestDef, QuestKind } from './quests';

const REALM_KEYS = new Set(REALMS.map((r) => r.key));
const NPC_KEYS = new Set(NPCS.map((n) => n.key));
const ITEM_KEYS = new Set(ITEMS.map((it) => it.key));
const VALID_KIND_REGEX = /^(phamnhan|luyenkhi|truc_co|kim_dan|nguyen_anh)_(main|realm|sect|npc|grind)_\d{2}$/;
const PHASE21_MAIN_REGEX = /^phase21_ch\d{2}_main_\d{2}$/;
const CATALOGED_REALMS = ['phamnhan', 'luyenkhi', 'truc_co', 'kim_dan', 'nguyen_anh'];

describe('QUESTS catalog integrity (Phase 12 PR-1 + Story Foundation Extension)', () => {
  it('has unique keys', () => {
    const keys = QUESTS.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('catalog covers baseline 25 quests plus 30 Phase 21 main quests', () => {
    expect(QUESTS).toHaveLength(55);
    for (const realm of CATALOGED_REALMS) {
      expect(
        questsByRealm(realm).filter((q) => !q.key.startsWith('phase21_')),
        `realm=${realm}`,
      ).toHaveLength(5);
    }
    expect(QUESTS.filter((q) => q.key.startsWith('phase21_'))).toHaveLength(30);
  });

  it('every quest has 1 main + 1 realm + 1 sect + 1 grind + 1 npc per realm', () => {
    for (const realm of CATALOGED_REALMS) {
      const inRealm = questsByRealm(realm).filter((q) => !q.key.startsWith('phase21_'));
      const kinds: QuestKind[] = ['main', 'realm', 'sect', 'npc', 'grind'];
      for (const kind of kinds) {
        expect(
          inRealm.filter((q) => q.kind === kind),
          `realm=${realm} kind=${kind}`,
        ).toHaveLength(1);
      }
    }
  });

  it('quest key matches naming convention <realm>_<type>_<seq>', () => {
    for (const q of QUESTS) {
      expect(VALID_KIND_REGEX.test(q.key) || PHASE21_MAIN_REGEX.test(q.key), q.key).toBe(true);
    }
  });

  it('every quest realmKey matches REALMS catalog', () => {
    for (const q of QUESTS) {
      expect(REALM_KEYS.has(q.realmKey), `quest ${q.key} realmKey ${q.realmKey}`).toBe(true);
    }
  });

  it('every quest requiredRealmOrder matches REALMS[realmKey].order', () => {
    for (const q of QUESTS) {
      const realm = REALMS.find((r) => r.key === q.realmKey);
      expect(realm).toBeDefined();
      expect(q.requiredRealmOrder, `quest ${q.key}`).toBe(realm!.order);
    }
  });

  it('every quest giverNpcKey matches NPCS catalog', () => {
    for (const q of QUESTS) {
      expect(NPC_KEYS.has(q.giverNpcKey), `quest ${q.key} giver ${q.giverNpcKey}`).toBe(true);
    }
  });

  it('every quest has at least 1 step', () => {
    for (const q of QUESTS) {
      expect(q.steps.length, q.key).toBeGreaterThan(0);
    }
  });

  it('every step id is unique within its quest', () => {
    for (const q of QUESTS) {
      const ids = q.steps.map((s) => s.id);
      expect(new Set(ids).size, q.key).toBe(ids.length);
    }
  });

  it('step kind matches targetType (kill→monster, collect→item, talk→npc, explore→region, choice→choice)', () => {
    const kindToTargetType: Record<string, string> = {
      kill: 'monster',
      collect: 'item',
      talk: 'npc',
      explore: 'region',
      choice: 'choice',
    };
    for (const q of QUESTS) {
      for (const step of q.steps) {
        expect(step.targetType, `${q.key}.${step.id}`).toBe(kindToTargetType[step.kind]);
      }
    }
  });

  it('step count is positive', () => {
    for (const q of QUESTS) {
      for (const step of q.steps) {
        expect(step.count, `${q.key}.${step.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('reward.linhThach / tienNgoc / exp / congHien are non-negative when present', () => {
    for (const q of QUESTS) {
      const r = q.rewards;
      if (r.linhThach !== undefined) expect(r.linhThach, q.key).toBeGreaterThanOrEqual(0);
      if (r.tienNgoc !== undefined) expect(r.tienNgoc, q.key).toBeGreaterThanOrEqual(0);
      if (r.exp !== undefined) expect(r.exp, q.key).toBeGreaterThanOrEqual(0);
      if (r.congHien !== undefined) expect(r.congHien, q.key).toBeGreaterThanOrEqual(0);
      if (r.items) {
        for (const it of r.items) {
          expect(it.qty, `${q.key} item ${it.itemKey}`).toBeGreaterThan(0);
        }
      }
    }
  });

  // Phase 12 PR-3 — claim path đi qua `InventoryService.grantTx`. Item missing
  // sẽ silently no-op ở runtime → reward bị drop. Validate cross-catalog ngay
  // ở build time để chặn placeholder đi vào ledger gameplay.
  it('every reward.items[].itemKey exists in ITEMS catalog', () => {
    for (const q of QUESTS) {
      if (!q.rewards.items) continue;
      for (const it of q.rewards.items) {
        expect(
          ITEM_KEYS.has(it.itemKey),
          `quest ${q.key} reward itemKey=${it.itemKey}`,
        ).toBe(true);
      }
    }
  });

  it('every prerequisiteQuestKey points to an existing quest (or null)', () => {
    const allKeys = new Set(QUESTS.map((q) => q.key));
    for (const q of QUESTS) {
      if (q.prerequisiteQuestKey !== null) {
        expect(allKeys.has(q.prerequisiteQuestKey), `${q.key} prereq ${q.prerequisiteQuestKey}`).toBe(true);
      }
    }
  });

  it('main quest chain hoa_thien_main is sequential across 5 realms', () => {
    const chain = questsByChain('hoa_thien_main');
    expect(chain.length).toBeGreaterThanOrEqual(5);
    const phamnhanMain = chain.find((q) => q.key === 'phamnhan_main_01');
    const luyenkhiMain = chain.find((q) => q.key === 'luyenkhi_main_01');
    const trucCoMain = chain.find((q) => q.key === 'truc_co_main_01');
    const kimDanMain = chain.find((q) => q.key === 'kim_dan_main_01');
    const nguyenAnhMain = chain.find((q) => q.key === 'nguyen_anh_main_01');
    expect(phamnhanMain).toBeDefined();
    expect(luyenkhiMain).toBeDefined();
    expect(trucCoMain).toBeDefined();
    expect(kimDanMain).toBeDefined();
    expect(nguyenAnhMain).toBeDefined();
    expect(luyenkhiMain!.prerequisiteQuestKey).toBe('phamnhan_main_01');
    expect(trucCoMain!.prerequisiteQuestKey).toBe('luyenkhi_main_01');
    expect(kimDanMain!.prerequisiteQuestKey).toBe('truc_co_main_01');
    expect(nguyenAnhMain!.prerequisiteQuestKey).toBe('kim_dan_main_01');
  });

  it('Phase 21 main quest chains are linked by previous/next metadata', () => {
    const phase21 = QUESTS.filter((q) => q.key.startsWith('phase21_'));
    expect(phase21).toHaveLength(30);
    const allKeys = new Set(QUESTS.map((q) => q.key));
    const chapterKeys = new Set(phase21.map((q) => q.chapterKey));
    expect(chapterKeys.size).toBe(6);

    for (const q of phase21) {
      expect(q.kind, q.key).toBe('main');
      expect(q.chapterKey, q.key).toMatch(/^chapter_/);
      expect(q.chainKey, q.key).toMatch(/^phase21_chapter_\d{2}_main$/);
      expect(q.objective?.trim(), q.key).not.toHaveLength(0);
      expect(q.requirement?.trim(), q.key).not.toHaveLength(0);
      expect(q.startNpcKey, q.key).toBeTruthy();
      expect(q.endNpcKey, q.key).toBeTruthy();
      if (q.previousQuestKey) expect(allKeys.has(q.previousQuestKey), `${q.key}.previous`).toBe(true);
      if (q.nextQuestKey) expect(allKeys.has(q.nextQuestKey), `${q.key}.next`).toBe(true);
    }

    expect(questByKey('phase21_ch01_main_01')?.previousQuestKey).toBeNull();
    expect(questByKey('phase21_ch06_main_05')?.nextQuestKey).toBeNull();
  });

  it('moc_thanh_y_arc is sequential across truc_co → kim_dan → nguyen_anh', () => {
    const chain = questsByChain('moc_thanh_y_arc');
    expect(chain.length).toBe(3);
    const trucCoSect = chain.find((q) => q.key === 'truc_co_sect_01');
    const kimDanSect = chain.find((q) => q.key === 'kim_dan_sect_01');
    const nguyenAnhSect = chain.find((q) => q.key === 'nguyen_anh_sect_01');
    expect(trucCoSect).toBeDefined();
    expect(kimDanSect).toBeDefined();
    expect(nguyenAnhSect).toBeDefined();
    expect(kimDanSect!.prerequisiteQuestKey).toBe('truc_co_sect_01');
    expect(nguyenAnhSect!.prerequisiteQuestKey).toBe('kim_dan_sect_01');
  });

  it('huyet_la_sat_arc is sequential across kim_dan → nguyen_anh', () => {
    const chain = questsByChain('huyet_la_sat_arc');
    expect(chain.length).toBe(2);
    const kimDanNpc = chain.find((q) => q.key === 'kim_dan_npc_01');
    const nguyenAnhNpc = chain.find((q) => q.key === 'nguyen_anh_npc_01');
    expect(kimDanNpc).toBeDefined();
    expect(nguyenAnhNpc).toBeDefined();
    expect(kimDanNpc!.prerequisiteQuestKey).toBe('kim_dan_main_01');
    expect(nguyenAnhNpc!.prerequisiteQuestKey).toBe('kim_dan_npc_01');
  });

  it('main quest reward exp > grind quest reward exp (in same realm)', () => {
    for (const realm of CATALOGED_REALMS) {
      const inRealm = questsByRealm(realm).filter((q) => !q.key.startsWith('phase21_'));
      const main = inRealm.find((q) => q.kind === 'main')!;
      const grind = inRealm.find((q) => q.kind === 'grind')!;
      expect(main.rewards.exp ?? 0, `realm=${realm}`).toBeGreaterThan(grind.rewards.exp ?? 0);
    }
  });

  it('main quest reward exp scales up across realms (gate breakthrough)', () => {
    const phamnhanExp = QUESTS.find((q) => q.key === 'phamnhan_main_01')!.rewards.exp!;
    const luyenkhiExp = QUESTS.find((q) => q.key === 'luyenkhi_main_01')!.rewards.exp!;
    const trucCoExp = QUESTS.find((q) => q.key === 'truc_co_main_01')!.rewards.exp!;
    const kimDanExp = QUESTS.find((q) => q.key === 'kim_dan_main_01')!.rewards.exp!;
    const nguyenAnhExp = QUESTS.find((q) => q.key === 'nguyen_anh_main_01')!.rewards.exp!;
    expect(luyenkhiExp).toBeGreaterThan(phamnhanExp);
    expect(trucCoExp).toBeGreaterThan(luyenkhiExp);
    expect(kimDanExp).toBeGreaterThan(trucCoExp);
    expect(nguyenAnhExp).toBeGreaterThan(kimDanExp);
  });

  it('questByKey resolves known keys, returns undefined for unknown', () => {
    expect(questByKey('phamnhan_main_01')?.name).toBe('Hoa Thiên Tuyển Đồ');
    expect(questByKey('nonexistent_xyz_99')).toBeUndefined();
  });

  it('questsByGiver returns correct count', () => {
    expect(questsByGiver('npc_lang_van_sinh').filter((q) => !q.key.startsWith('phase21_')).length).toBe(10);
    expect(questsByGiver('npc_moc_thanh_y').filter((q) => !q.key.startsWith('phase21_')).length).toBe(11);
    expect(questsByGiver('npc_han_da').filter((q) => !q.key.startsWith('phase21_')).length).toBe(1);
    expect(questsByGiver('npc_to_nguyet_ly').filter((q) => !q.key.startsWith('phase21_')).length).toBe(1);
    expect(questsByGiver('npc_huyet_la_sat').filter((q) => !q.key.startsWith('phase21_')).length).toBe(2);
  });

  it('questsByKind returns expected baseline plus Phase 21 counts', () => {
    expect(questsByKind('main')).toHaveLength(35);
    expect(questsByKind('realm')).toHaveLength(5);
    expect(questsByKind('sect')).toHaveLength(5);
    expect(questsByKind('npc')).toHaveLength(5);
    expect(questsByKind('grind')).toHaveLength(5);
  });

  it('questsAvailableAtRealm gates correctly', () => {
    const baselineAvailableAtRealm = (realmOrder: number) =>
      questsAvailableAtRealm(realmOrder).filter((q) => !q.key.startsWith('phase21_'));

    expect(baselineAvailableAtRealm(0).length).toBe(5); // chỉ phamnhan
    expect(baselineAvailableAtRealm(1).length).toBe(10); // phamnhan + luyenkhi
    expect(baselineAvailableAtRealm(2).length).toBe(15); // + truc_co
    expect(baselineAvailableAtRealm(3).length).toBe(20); // + kim_dan
    expect(baselineAvailableAtRealm(4).length).toBe(25); // all 5 realms
    expect(questsAvailableAtRealm(4).filter((q) => q.key.startsWith('phase21_')).length).toBe(30);
  });

  it('chain key consistency: quest in same chain must be in adjacent realms', () => {
    const chains = new Set(QUESTS.map((q) => q.chainKey).filter((c): c is string => c !== null));
    for (const chain of chains) {
      const inChain = questsByChain(chain);
      const orders = inChain.map((q) => q.requiredRealmOrder);
      const sorted = [...orders].sort((a, b) => a - b);
      // adjacent diff <= 1 (same realm or next realm)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i] - sorted[i - 1], `chain=${chain}`).toBeLessThanOrEqual(1);
      }
    }
  });
});
