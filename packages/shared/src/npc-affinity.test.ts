/**
 * Phase 12.10.A — NPC affinity catalog + tier helper invariant tests.
 */

import { describe, expect, it } from 'vitest';
import { NPCS } from './npcs';
import {
  AFFINITY_DELTA_CAP_PER_CHOICE,
  AFFINITY_DELTA_CAP_PER_QUEST_REWARD,
  AFFINITY_TIERS,
  NPC_AFFINITY,
  affinityTierForScore,
  clampAffinityScore,
  nextAffinityTierForScore,
  npcAffinityDefForKey,
  validateNpcAffinityCatalog,
} from './npc-affinity';

describe('npc-affinity catalog', () => {
  it('catalog passes validateNpcAffinityCatalog (no errors)', () => {
    expect(validateNpcAffinityCatalog()).toEqual([]);
  });

  it('every NPC_AFFINITY entry references a known NPC', () => {
    const npcKeys = new Set(NPCS.map((n) => n.key));
    for (const def of NPC_AFFINITY) {
      expect(npcKeys.has(def.npcKey)).toBe(true);
    }
  });

  it('cap constants are positive integers', () => {
    expect(AFFINITY_DELTA_CAP_PER_CHOICE).toBeGreaterThan(0);
    expect(AFFINITY_DELTA_CAP_PER_QUEST_REWARD).toBeGreaterThan(0);
    expect(Number.isInteger(AFFINITY_DELTA_CAP_PER_CHOICE)).toBe(true);
    expect(Number.isInteger(AFFINITY_DELTA_CAP_PER_QUEST_REWARD)).toBe(true);
  });
});

describe('affinityTierForScore', () => {
  it('returns xa_la for low / negative score', () => {
    expect(affinityTierForScore(-100).key).toBe('xa_la');
    expect(affinityTierForScore(0).key).toBe('xa_la');
    expect(affinityTierForScore(9).key).toBe('xa_la');
  });

  it('returns quen_biet at exact threshold 10', () => {
    expect(affinityTierForScore(10).key).toBe('quen_biet');
    expect(affinityTierForScore(29).key).toBe('quen_biet');
  });

  it('returns ban_huu at threshold 30', () => {
    expect(affinityTierForScore(30).key).toBe('ban_huu');
    expect(affinityTierForScore(59).key).toBe('ban_huu');
  });

  it('returns tri_giao at threshold 60', () => {
    expect(affinityTierForScore(60).key).toBe('tri_giao');
    expect(affinityTierForScore(99).key).toBe('tri_giao');
  });

  it('returns tri_ky at threshold 100+', () => {
    expect(affinityTierForScore(100).key).toBe('tri_ky');
    expect(affinityTierForScore(200).key).toBe('tri_ky');
  });

  it('order monotonic increasing with score', () => {
    const t1 = affinityTierForScore(0);
    const t2 = affinityTierForScore(10);
    const t3 = affinityTierForScore(30);
    const t4 = affinityTierForScore(60);
    const t5 = affinityTierForScore(100);
    expect(t1.order).toBeLessThan(t2.order);
    expect(t2.order).toBeLessThan(t3.order);
    expect(t3.order).toBeLessThan(t4.order);
    expect(t4.order).toBeLessThan(t5.order);
  });
});

describe('nextAffinityTierForScore', () => {
  it('returns next tier for non-max', () => {
    expect(nextAffinityTierForScore(0)?.key).toBe('quen_biet');
    expect(nextAffinityTierForScore(10)?.key).toBe('ban_huu');
    expect(nextAffinityTierForScore(30)?.key).toBe('tri_giao');
    expect(nextAffinityTierForScore(60)?.key).toBe('tri_ky');
  });

  it('returns null at max tier', () => {
    expect(nextAffinityTierForScore(100)).toBeNull();
    expect(nextAffinityTierForScore(999)).toBeNull();
  });
});

describe('clampAffinityScore', () => {
  it('clamps to [minScore, maxScore] for known NPC', () => {
    // npc_lang_van_sinh: [-50, 200]
    expect(clampAffinityScore('npc_lang_van_sinh', -100)).toBe(-50);
    expect(clampAffinityScore('npc_lang_van_sinh', 0)).toBe(0);
    expect(clampAffinityScore('npc_lang_van_sinh', 250)).toBe(200);
    // npc_huyet_la_sat: [-100, 100]
    expect(clampAffinityScore('npc_huyet_la_sat', -200)).toBe(-100);
    expect(clampAffinityScore('npc_huyet_la_sat', 200)).toBe(100);
  });

  it('returns raw score for unknown NPC', () => {
    expect(clampAffinityScore('npc_unknown', 50)).toBe(50);
    expect(clampAffinityScore('npc_unknown', -1000)).toBe(-1000);
  });
});

describe('npcAffinityDefForKey', () => {
  it('returns def for known NPC', () => {
    const def = npcAffinityDefForKey('npc_lang_van_sinh');
    expect(def?.npcKey).toBe('npc_lang_van_sinh');
    expect(def?.minScore).toBe(-50);
    expect(def?.maxScore).toBe(200);
  });

  it('returns undefined for unknown NPC', () => {
    expect(npcAffinityDefForKey('npc_unknown')).toBeUndefined();
  });
});

describe('AFFINITY_TIERS ladder integrity', () => {
  it('tier order is 0..N strictly increasing', () => {
    const orders = AFFINITY_TIERS.map((t) => t.order);
    for (let i = 0; i < orders.length; i += 1) {
      expect(orders[i]).toBe(i);
    }
  });

  it('tier minScore strictly increasing', () => {
    let prev = -Infinity;
    for (const t of AFFINITY_TIERS) {
      expect(t.minScore).toBeGreaterThan(prev);
      prev = t.minScore;
    }
  });

  it('xa_la tier covers negative score range', () => {
    expect(AFFINITY_TIERS[0].key).toBe('xa_la');
    expect(AFFINITY_TIERS[0].minScore).toBeLessThanOrEqual(0);
  });
});
