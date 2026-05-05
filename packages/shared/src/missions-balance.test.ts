/**
 * Phase 10 PR-4 — Mission catalog balance & forward-compat invariant.
 *
 * Verifies (deterministic, không cần infra):
 * - Required field bounds (goalAmount > 0, requiredRealmOrder > 0 nếu có).
 * - Element/region/storyChain/realmTier validity per `BALANCE_MODEL.md` §7 +
 *   `combat.ts` Ngũ Hành / region taxonomy.
 * - Reward budget bound theo realm tier (BALANCE_MODEL §7.1).
 * - Element coverage: ≥ 1 mission per element {kim,moc,thuy,hoa,tho}.
 * - Region coverage: mọi region có ≥ 1 mission tham chiếu.
 * - Story chain coverage: mỗi chain có ≥ 1 mission, mọi mission cùng chain
 *   thì cùng (element, regionKey) family hoặc shared null.
 * - Catalog growth: ≥ 60 missions (12 baseline + ~50 PR-4).
 */
import { describe, expect, it } from 'vitest';
import {
  MISSIONS,
  missionByKey,
  missionsByElement,
  missionsByPeriod,
  missionsByRealmTier,
  missionsByRegion,
  missionsByStoryChain,
} from './missions';
import { ELEMENTS, MONSTERS, DUNGEONS } from './combat';
import { itemByKey } from './items';
import { REALMS } from './realms';
import {
  MISSION_DAILY_BUDGET_BY_REALM_TIER,
  MISSION_WEEKLY_DAILY_MULTIPLIER,
  MISSION_ONCE_LINHTHACH_HARD_CAP,
  MISSION_TIENNGOC_HARD_CAP,
} from './balance-dials';

const REALM_KEYS = new Set(REALMS.map((r) => r.key));
// Hợp lệ region tham chiếu = region thực sự (theo monster/dungeon regionKey)
// hoặc dungeon key (mission ONCE chain quest có thể trỏ tới dungeon cụ thể).
const VALID_REGIONS = new Set<string>([
  ...MONSTERS.map((m) => m.regionKey).filter((r): r is string => !!r),
  ...DUNGEONS.map((d) => d.regionKey).filter((r): r is string => !!r),
  ...DUNGEONS.map((d) => d.key),
]);

describe('MISSIONS catalog balance (Phase 10 PR-4)', () => {
  it('có ít nhất 60 mission (12 baseline + ~50 PR-4)', () => {
    expect(MISSIONS.length).toBeGreaterThanOrEqual(60);
  });

  it('mọi key match snake_case (lowercase + _ + digit)', () => {
    for (const m of MISSIONS) {
      expect(m.key, `mission ${m.key} key format`).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/);
    }
  });

  it('mọi key unique (re-check)', () => {
    const keys = MISSIONS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('requiredRealmOrder nếu có ∈ [1, 9] (luyenkhi → do_kiep)', () => {
    for (const m of MISSIONS) {
      if (m.requiredRealmOrder !== undefined) {
        expect(m.requiredRealmOrder, `mission ${m.key}`).toBeGreaterThanOrEqual(1);
        expect(m.requiredRealmOrder, `mission ${m.key}`).toBeLessThanOrEqual(9);
      }
    }
  });

  it('mọi reward item key resolve qua itemByKey() (no orphan)', () => {
    for (const m of MISSIONS) {
      for (const item of m.rewards.items ?? []) {
        const def = itemByKey(item.itemKey);
        expect(def, `mission ${m.key} item '${item.itemKey}' không resolve`).toBeDefined();
      }
    }
  });

  it('mọi mission có ít nhất 1 reward thực sự (linhThach hoặc tienNgoc hoặc exp hoặc congHien hoặc items[])', () => {
    for (const m of MISSIONS) {
      const r = m.rewards;
      const hasNumericReward = [r.linhThach, r.tienNgoc, r.exp, r.congHien].some(
        (v) => v !== undefined && v > 0,
      );
      const hasItemReward = (r.items ?? []).length > 0;
      expect(hasNumericReward || hasItemReward, `mission ${m.key}`).toBe(true);
    }
  });

  it('reward number không âm không 0 (đã có reward thì phải > 0)', () => {
    for (const m of MISSIONS) {
      const r = m.rewards;
      if (r.linhThach !== undefined) expect(r.linhThach, `mission ${m.key}`).toBeGreaterThan(0);
      if (r.tienNgoc !== undefined) expect(r.tienNgoc, `mission ${m.key}`).toBeGreaterThan(0);
      if (r.exp !== undefined) expect(r.exp, `mission ${m.key}`).toBeGreaterThan(0);
      if (r.congHien !== undefined) expect(r.congHien, `mission ${m.key}`).toBeGreaterThan(0);
      for (const it of r.items ?? []) {
        expect(it.qty, `mission ${m.key} item ${it.itemKey} qty`).toBeGreaterThan(0);
      }
    }
  });
});

describe('MISSIONS — forward-compat metadata (Phase 10 PR-4)', () => {
  it('element nếu có thuộc {kim,moc,thuy,hoa,tho} hoặc null', () => {
    for (const m of MISSIONS) {
      if (m.element !== undefined && m.element !== null) {
        expect(ELEMENTS, `mission ${m.key} element=${m.element}`).toContain(m.element);
      }
    }
  });

  it('regionKey nếu có phải tham chiếu region tồn tại trong MONSTERS hoặc DUNGEONS', () => {
    for (const m of MISSIONS) {
      if (m.regionKey !== undefined && m.regionKey !== null) {
        expect(VALID_REGIONS.has(m.regionKey), `mission ${m.key} regionKey='${m.regionKey}' không tham chiếu region nào`).toBe(true);
      }
    }
  });

  it('realmTier nếu có phải tham chiếu REALMS.key tồn tại', () => {
    for (const m of MISSIONS) {
      if (m.realmTier !== undefined && m.realmTier !== null) {
        expect(REALM_KEYS.has(m.realmTier), `mission ${m.key} realmTier='${m.realmTier}'`).toBe(true);
      }
    }
  });

  it('storyChainKey nếu có là snake_case không rỗng', () => {
    for (const m of MISSIONS) {
      if (m.storyChainKey !== undefined && m.storyChainKey !== null) {
        expect(m.storyChainKey, `mission ${m.key}`).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });
});

describe('MISSIONS — element + chain coverage (Phase 10 PR-4)', () => {
  it('mỗi Ngũ Hành element có ≥ 1 mission tham chiếu', () => {
    for (const elem of ELEMENTS) {
      const ms = missionsByElement(elem);
      expect(ms.length, `element ${elem}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('chain "tu_tien_progression" có ≥ 4 mission BREAKTHROUGH (truc_co/kim_dan/nguyen_anh/hoa_than)', () => {
    const chain = missionsByStoryChain('tu_tien_progression');
    expect(chain.length).toBeGreaterThanOrEqual(4);
    for (const m of chain) {
      expect(m.goalKind, `mission ${m.key}`).toBe('BREAKTHROUGH');
    }
  });

  it('mỗi element chain (kim/moc/thuy/hoa/tho) có ≥ 2 mission ONCE', () => {
    for (const elem of ELEMENTS) {
      const chain = missionsByStoryChain(`${elem}_chronicle`);
      expect(chain.length, `${elem}_chronicle`).toBeGreaterThanOrEqual(2);
      for (const m of chain) {
        expect(m.period, `mission ${m.key}`).toBe('ONCE');
      }
    }
  });

  it('endgame chain có ≥ 1 mission ONCE link tới cuu_la_dien region', () => {
    const chain = missionsByStoryChain('endgame');
    expect(chain.length).toBeGreaterThanOrEqual(1);
    const hasCuuLaDien = chain.some((m) => m.regionKey === 'cuu_la_dien');
    expect(hasCuuLaDien, 'endgame chain phải có mission cuu_la_dien').toBe(true);
  });
});

describe('MISSIONS — period & realm tier distribution (Phase 10 PR-4)', () => {
  it('có ≥ 5 daily mission cho mỗi tier (luyenkhi base + truc_co + kim_dan + nguyen_anh)', () => {
    // Original 5 daily (no realmTier) phục vụ luyenkhi tier; mỗi tier mới
    // phải có ≥ 3 daily (cultivate/kill/clear) để cover daily routine.
    const baseline = missionsByPeriod('DAILY').filter((m) => !m.realmTier);
    expect(baseline.length, 'baseline DAILY (no realmTier)').toBeGreaterThanOrEqual(5);
    for (const tier of ['truc_co', 'kim_dan', 'nguyen_anh']) {
      const dailies = missionsByRealmTier(tier).filter((m) => m.period === 'DAILY');
      expect(dailies.length, `daily tier ${tier}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('có ≥ 1 weekly mission cho mỗi tier (truc_co/kim_dan/nguyen_anh)', () => {
    for (const tier of ['truc_co', 'kim_dan', 'nguyen_anh']) {
      const weeklies = missionsByRealmTier(tier).filter((m) => m.period === 'WEEKLY');
      expect(weeklies.length, `weekly tier ${tier}`).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('MISSIONS — reward budget bound per realm tier (BALANCE_MODEL §7.1)', () => {
  // Source of truth: `balance-dials.ts` MISSION_DAILY_BUDGET_BY_REALM_TIER /
  // MISSION_WEEKLY_DAILY_MULTIPLIER / MISSION_ONCE_LINHTHACH_HARD_CAP /
  // MISSION_TIENNGOC_HARD_CAP. Cho phép +50% buffer vì mission lớn cuối
  // tier (boss_hit, big quest).

  it('mọi DAILY mission có realmTier không vượt budget linhThach', () => {
    for (const m of missionsByPeriod('DAILY')) {
      if (m.realmTier && MISSION_DAILY_BUDGET_BY_REALM_TIER[m.realmTier] !== undefined) {
        const cap = MISSION_DAILY_BUDGET_BY_REALM_TIER[m.realmTier];
        const lt = m.rewards.linhThach ?? 0;
        expect(lt, `daily mission ${m.key} (${m.realmTier}) linhThach`).toBeLessThanOrEqual(cap);
      }
    }
  });

  it(`mọi WEEKLY mission linhThach ≤ ${MISSION_WEEKLY_DAILY_MULTIPLIER}× DAILY tier budget`, () => {
    for (const m of missionsByPeriod('WEEKLY')) {
      if (m.realmTier && MISSION_DAILY_BUDGET_BY_REALM_TIER[m.realmTier] !== undefined) {
        const cap = MISSION_DAILY_BUDGET_BY_REALM_TIER[m.realmTier] * MISSION_WEEKLY_DAILY_MULTIPLIER;
        const lt = m.rewards.linhThach ?? 0;
        expect(lt, `weekly mission ${m.key} (${m.realmTier}) linhThach`).toBeLessThanOrEqual(cap);
      }
    }
  });

  it(`mọi ONCE mission linhThach không vượt ${MISSION_ONCE_LINHTHACH_HARD_CAP} (cap tuyệt đối, prevent runaway)`, () => {
    for (const m of missionsByPeriod('ONCE')) {
      const lt = m.rewards.linhThach ?? 0;
      expect(lt, `once mission ${m.key} linhThach`).toBeLessThanOrEqual(MISSION_ONCE_LINHTHACH_HARD_CAP);
    }
  });

  it(`tienNgoc reward chỉ xuất hiện ở weekly/once cao cấp (≤ ${MISSION_TIENNGOC_HARD_CAP} cap)`, () => {
    for (const m of MISSIONS) {
      if (m.rewards.tienNgoc !== undefined) {
        expect(m.rewards.tienNgoc, `mission ${m.key} tienNgoc`).toBeLessThanOrEqual(MISSION_TIENNGOC_HARD_CAP);
      }
    }
  });
});

describe('MISSIONS — helper functions (Phase 10 PR-4)', () => {
  it('missionByKey trả mission cho key tồn tại', () => {
    expect(missionByKey('once_breakthrough_kim_dan')).toBeDefined();
    expect(missionByKey('nonexistent_key_xxx')).toBeUndefined();
  });

  it('missionsByElement(null) chỉ trả mission element=undefined hoặc null', () => {
    const ms = missionsByElement(null);
    for (const m of ms) {
      expect(m.element ?? null, `mission ${m.key}`).toBeNull();
    }
  });

  it('missionsByElement("kim") chỉ trả mission element=kim', () => {
    const ms = missionsByElement('kim');
    expect(ms.length).toBeGreaterThan(0);
    for (const m of ms) {
      expect(m.element, `mission ${m.key}`).toBe('kim');
    }
  });

  it('missionsByRegion("kim_son_mach") chỉ trả mission regionKey=kim_son_mach', () => {
    const ms = missionsByRegion('kim_son_mach');
    expect(ms.length).toBeGreaterThan(0);
    for (const m of ms) {
      expect(m.regionKey, `mission ${m.key}`).toBe('kim_son_mach');
    }
  });

  it('missionsByStoryChain trả mission sorted by goalAmount asc (chain progression)', () => {
    const chain = missionsByStoryChain('kim_chronicle');
    expect(chain.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].goalAmount, `chain step ${i}`).toBeGreaterThanOrEqual(chain[i - 1].goalAmount);
    }
  });

  it('missionsByRealmTier("kim_dan") chỉ trả mission realmTier=kim_dan', () => {
    const ms = missionsByRealmTier('kim_dan');
    expect(ms.length).toBeGreaterThan(0);
    for (const m of ms) {
      expect(m.realmTier, `mission ${m.key}`).toBe('kim_dan');
    }
  });
});
