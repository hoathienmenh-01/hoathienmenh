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
const VALID_KIND_REGEX = /^(phamnhan|luyenkhi|truc_co)_(main|realm|sect|npc|grind)_\d{2}$/;

describe('QUESTS catalog integrity (Phase 12 PR-1)', () => {
  it('has unique keys', () => {
    const keys = QUESTS.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('catalog covers exactly 15 quest (5 per 3 realms đầu)', () => {
    expect(QUESTS).toHaveLength(15);
    expect(questsByRealm('phamnhan')).toHaveLength(5);
    expect(questsByRealm('luyenkhi')).toHaveLength(5);
    expect(questsByRealm('truc_co')).toHaveLength(5);
  });

  it('every quest has 1 main + 1 realm + 1 sect + 1 grind + 1 npc per realm', () => {
    for (const realm of ['phamnhan', 'luyenkhi', 'truc_co']) {
      const inRealm = questsByRealm(realm);
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
      expect(q.key, q.key).toMatch(VALID_KIND_REGEX);
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

  it('main quest chain hoa_thien_main is sequential across 3 realms', () => {
    const chain = questsByChain('hoa_thien_main');
    expect(chain.length).toBeGreaterThanOrEqual(3);
    const phamnhanMain = chain.find((q) => q.key === 'phamnhan_main_01');
    const luyenkhiMain = chain.find((q) => q.key === 'luyenkhi_main_01');
    const trucCoMain = chain.find((q) => q.key === 'truc_co_main_01');
    expect(phamnhanMain).toBeDefined();
    expect(luyenkhiMain).toBeDefined();
    expect(trucCoMain).toBeDefined();
    expect(luyenkhiMain!.prerequisiteQuestKey).toBe('phamnhan_main_01');
    expect(trucCoMain!.prerequisiteQuestKey).toBe('luyenkhi_main_01');
  });

  it('main quest reward exp > grind quest reward exp (in same realm)', () => {
    for (const realm of ['phamnhan', 'luyenkhi', 'truc_co']) {
      const inRealm = questsByRealm(realm);
      const main = inRealm.find((q) => q.kind === 'main')!;
      const grind = inRealm.find((q) => q.kind === 'grind')!;
      expect(main.rewards.exp ?? 0, `realm=${realm}`).toBeGreaterThan(grind.rewards.exp ?? 0);
    }
  });

  it('questByKey resolves known keys, returns undefined for unknown', () => {
    expect(questByKey('phamnhan_main_01')?.name).toBe('Hoa Thiên Tuyển Đồ');
    expect(questByKey('nonexistent_xyz_99')).toBeUndefined();
  });

  it('questsByGiver returns correct count', () => {
    // Lăng Vân Sinh: 6 quest
    expect(questsByGiver('npc_lang_van_sinh').length).toBe(6);
    // Hàn Dạ: 1 quest
    expect(questsByGiver('npc_han_da').length).toBe(1);
    // Tô Nguyệt Ly: 1 quest
    expect(questsByGiver('npc_to_nguyet_ly').length).toBe(1);
  });

  it('questsByKind returns correct count (3 of each)', () => {
    expect(questsByKind('main')).toHaveLength(3);
    expect(questsByKind('realm')).toHaveLength(3);
    expect(questsByKind('sect')).toHaveLength(3);
    expect(questsByKind('npc')).toHaveLength(3);
    expect(questsByKind('grind')).toHaveLength(3);
  });

  it('questsAvailableAtRealm gates correctly', () => {
    expect(questsAvailableAtRealm(0).length).toBe(5); // chỉ phamnhan
    expect(questsAvailableAtRealm(1).length).toBe(10); // phamnhan + luyenkhi
    expect(questsAvailableAtRealm(2).length).toBe(15); // all 3 realms
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
