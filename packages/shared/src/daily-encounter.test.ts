import { describe, expect, it } from 'vitest';
import {
  DAILY_ENCOUNTER_RARITIES,
  DAILY_ENCOUNTER_REWARD_CAPS,
  DAILY_ENCOUNTER_TYPES,
  DAILY_ENCOUNTERS,
  dailyEncounterByKey,
  dailyEncountersAvailableFor,
  rollDailyEncounter,
} from './daily-encounter';

describe('daily-encounter — catalog audit', () => {
  it('exposes >= 8 encounters', () => {
    expect(DAILY_ENCOUNTERS.length).toBeGreaterThanOrEqual(8);
  });

  it('encounter keys are unique', () => {
    const set = new Set(DAILY_ENCOUNTERS.map((e) => e.key));
    expect(set.size).toBe(DAILY_ENCOUNTERS.length);
  });

  it('every encounter has a known rarity + type', () => {
    for (const e of DAILY_ENCOUNTERS) {
      expect(DAILY_ENCOUNTER_RARITIES).toContain(e.rarity);
      expect(DAILY_ENCOUNTER_TYPES).toContain(e.type);
    }
  });

  it('every encounter has bilingual title + description', () => {
    for (const e of DAILY_ENCOUNTERS) {
      expect(e.titleVi.length).toBeGreaterThan(0);
      expect(e.titleEn.length).toBeGreaterThan(0);
      expect(e.descriptionVi.length).toBeGreaterThan(0);
      expect(e.descriptionEn.length).toBeGreaterThan(0);
    }
  });
});

describe('daily-encounter — reward guardrails', () => {
  it('NO tienNgoc minted on any encounter (catalog enforces 0)', () => {
    for (const e of DAILY_ENCOUNTERS) {
      expect(e.rewardProfile.tienNgoc).toBe(0);
    }
  });

  it('NO endgame item grants — items array is empty', () => {
    for (const e of DAILY_ENCOUNTERS) {
      expect(e.rewardProfile.items).toEqual([]);
    }
  });

  it('linhThach within [0, linhThachMax]', () => {
    for (const e of DAILY_ENCOUNTERS) {
      expect(e.rewardProfile.linhThach).toBeGreaterThanOrEqual(0);
      expect(e.rewardProfile.linhThach).toBeLessThanOrEqual(
        DAILY_ENCOUNTER_REWARD_CAPS.linhThachMax,
      );
    }
  });

  it('exp within [0, expMax]', () => {
    for (const e of DAILY_ENCOUNTERS) {
      expect(e.rewardProfile.exp).toBeGreaterThanOrEqual(0);
      expect(e.rewardProfile.exp).toBeLessThanOrEqual(
        DAILY_ENCOUNTER_REWARD_CAPS.expMax,
      );
    }
  });

  it('choice affinity delta within affinityDeltaMax', () => {
    for (const e of DAILY_ENCOUNTERS) {
      const all = [
        e.rewardProfile.affinityDelta,
        ...(e.choices?.map((c) => c.affinityDelta) ?? []),
      ];
      for (const d of all) {
        if (d === undefined) continue;
        expect(Math.abs(d)).toBeLessThanOrEqual(
          DAILY_ENCOUNTER_REWARD_CAPS.affinityDeltaMax,
        );
      }
    }
  });
});

describe('daily-encounter — gating', () => {
  it('lookup by key works for first + last', () => {
    expect(dailyEncounterByKey(DAILY_ENCOUNTERS[0]!.key)?.key).toBe(
      DAILY_ENCOUNTERS[0]!.key,
    );
    expect(
      dailyEncounterByKey(DAILY_ENCOUNTERS[DAILY_ENCOUNTERS.length - 1]!.key)
        ?.key,
    ).toBe(DAILY_ENCOUNTERS[DAILY_ENCOUNTERS.length - 1]!.key);
  });

  it('unknown key returns undefined', () => {
    expect(dailyEncounterByKey('does_not_exist')).toBeUndefined();
  });

  it('realm gate excludes high-realm encounters', () => {
    const pool = dailyEncountersAvailableFor({ realmOrder: 1 });
    for (const e of pool) {
      expect(e.requiredRealmOrder).toBeLessThanOrEqual(1);
    }
  });

  it('hidden encounter does NOT leak without required story flag', () => {
    const hidden = DAILY_ENCOUNTERS.find(
      (e) => e.rarity === 'hidden' && e.requiredStoryFlags?.length,
    )!;
    const poolNoFlag = dailyEncountersAvailableFor({
      realmOrder: 99,
      storyFlags: new Set<string>(),
    });
    expect(poolNoFlag.map((e) => e.key)).not.toContain(hidden.key);

    const poolWithFlags = dailyEncountersAvailableFor({
      realmOrder: 99,
      storyFlags: new Set(hidden.requiredStoryFlags!),
    });
    expect(poolWithFlags.map((e) => e.key)).toContain(hidden.key);
  });
});

describe('daily-encounter — deterministic roller', () => {
  it('same seed → same encounter', () => {
    const a = rollDailyEncounter({ seed: 'char-1|2025-05-13', realmOrder: 10 });
    const b = rollDailyEncounter({ seed: 'char-1|2025-05-13', realmOrder: 10 });
    expect(a.key).toBe(b.key);
  });

  it('different seed → likely different encounter (smoke)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      seen.add(
        rollDailyEncounter({ seed: `char-${i}|2025-05-13`, realmOrder: 99 }).key,
      );
    }
    // Should hit at least 2 distinct encounters across 20 seeds.
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it('falls back to first encounter when no candidates', () => {
    const out = rollDailyEncounter({ seed: 'x', realmOrder: 0 });
    expect(out).toBeDefined();
    // realmOrder=0 has no candidates → falls back to DAILY_ENCOUNTERS[0].
    expect(out.key).toBe(DAILY_ENCOUNTERS[0]!.key);
  });
});
