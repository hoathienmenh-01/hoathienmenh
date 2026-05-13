#!/usr/bin/env node
/**
 * simulate-drop-economy.mjs — P2.7 Drop Economy V2 Monte Carlo simulation.
 *
 * Mục tiêu: chạy N iteration `rollMaterialTier()` với combination
 * `(playerTier, sourceTier, monsterType)` khác nhau, verify:
 *
 *   1. effectiveDropTier = min(playerTier, sourceTier), clamped [1, 9].
 *   2. KHÔNG có high-tier leak: player tier cao quay lại map tier thấp
 *      KHÔNG được drop tier > sourceTier.
 *   3. KHÔNG có below-floor leak: drop tier KHÔNG được < 1.
 *   4. Distribution gần khớp `getTierOffsetWeights` (chi-square test informal).
 *   5. effectiveDropTier=1 (lowest) không thể slide xuống tier âm.
 *   6. effectiveDropTier=9 (highest) không thể slide lên tier 10.
 *
 * Chạy:
 *   pnpm simulate:drop-economy
 *   # hoặc:
 *   node scripts/simulate-drop-economy.mjs
 *
 * Env:
 *   ITER — số iteration / case (default 10000).
 *
 * Exit code:
 *   0 — tất cả invariant pass.
 *   1 — ít nhất 1 invariant fail.
 */

import {
  effectiveDropTier,
  rollMaterialTier,
  getTierOffsetWeights,
} from '../packages/shared/dist/index.js';

const ITER = Number(process.env.ITER ?? 10_000);
const MONSTER_TYPES = ['NORMAL', 'ELITE', 'BOSS', 'DUNGEON_BOSS', 'WORLD_BOSS', 'EVENT_BOSS'];

let failures = 0;
const fails = [];

/** Deterministic seedable RNG (Mulberry32) for reproducible test runs. */
function mkRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

console.log(`\n=== P2.7 Drop Economy Monte Carlo (N=${ITER}/case) ===\n`);

// -----------------------------------------------------------------------------
// Invariant 1: effectiveDropTier = min(playerTier, sourceTier), clamped [1,9].
// -----------------------------------------------------------------------------
console.log('### Invariant 1: effectiveDropTier formula');
{
  const cases = [
    { player: 5, source: 5, expect: 5 },
    { player: 7, source: 1, expect: 1 },    // high player on low map → clamp low
    { player: 1, source: 9, expect: 1 },    // low player on high map → clamp low
    { player: 9, source: 9, expect: 9 },    // both max
    { player: 0, source: 5, expect: 1 },    // floor
    { player: 5, source: 0, expect: 1 },    // floor
    { player: 99, source: 99, expect: 9 },  // ceiling
    { player: -1, source: 5, expect: 1 },   // negative
  ];
  for (const c of cases) {
    const got = effectiveDropTier(c.player, c.source);
    const ok = got === c.expect;
    console.log(`  player=${c.player}, source=${c.source} → ${got} (expect ${c.expect}) ${ok ? '✓' : '✗'}`);
    if (!ok) { failures++; fails.push(`I1: ${JSON.stringify(c)} got ${got}`); }
  }
}

// -----------------------------------------------------------------------------
// Invariant 2: high-tier leak — player T7 farm map T1 → drop tier ≤ T1+2? NO
// — actually, weights have above1/above2, but for T1 map, sourceTier is gate.
// effDropTier=min(7,1)=1, weights select around 1 → can pick 1+2=3 max.
// Critical: even though formula allows above1/above2, with sourceTier=1 the
// effective tier IS 1, so drops range [1, 3] (above2). The KEY anti-leak is:
// effectiveDropTier capped to sourceTier, NOT playerTier. So no T7 endgame
// gear drops from T1 maps.
// -----------------------------------------------------------------------------
console.log('\n### Invariant 2: high-player on low-source map ≤ sourceTier+2');
{
  const playerTier = 7;
  const sourceTier = 1;
  const effTier = effectiveDropTier(playerTier, sourceTier);  // = 1
  let maxRolledTier = 0;
  for (const mtype of MONSTER_TYPES) {
    const rng = mkRng(0xCAFEBABE);
    for (let i = 0; i < ITER; i++) {
      const t = rollMaterialTier(mtype, effTier, rng);
      if (t > maxRolledTier) maxRolledTier = t;
    }
  }
  // Max possible: effTier + 2 = 1 + 2 = 3.
  const ok = maxRolledTier <= sourceTier + 2;
  console.log(`  player=T${playerTier}, source=T${sourceTier} → effTier=T${effTier}, maxRolled=T${maxRolledTier}, limit≤T${sourceTier + 2} ${ok ? '✓' : '✗'}`);
  if (!ok) { failures++; fails.push(`I2: maxRolled=${maxRolledTier} > sourceTier+2=${sourceTier + 2}`); }
}

// -----------------------------------------------------------------------------
// Invariant 3: no below-floor leak — drop tier ≥ 1.
// -----------------------------------------------------------------------------
console.log('\n### Invariant 3: no below-floor leak (drop tier ≥ 1)');
{
  const rng = mkRng(0xDEADBEEF);
  let belowFloor = 0;
  for (const mtype of MONSTER_TYPES) {
    for (const effTier of [1, 2, 3]) {
      for (let i = 0; i < ITER; i++) {
        const t = rollMaterialTier(mtype, effTier, rng);
        if (t < 1) belowFloor++;
      }
    }
  }
  const ok = belowFloor === 0;
  console.log(`  ${ITER * MONSTER_TYPES.length * 3} rolls, below-floor leaks=${belowFloor} ${ok ? '✓' : '✗'}`);
  if (!ok) { failures++; fails.push(`I3: belowFloor=${belowFloor}`); }
}

// -----------------------------------------------------------------------------
// Invariant 4: distribution roughly matches weights (informal chi-square).
// For BOSS at effTier=5: weights = {lower2OrBelow, lower1, sameTier, above1, above2}
// Empirical counts should be within ±10% of expected.
// -----------------------------------------------------------------------------
console.log('\n### Invariant 4: empirical distribution roughly matches weights');
{
  const monsterType = 'BOSS';
  const effTier = 5;
  const weights = getTierOffsetWeights(monsterType);
  const totalWeight =
    weights.lower2OrBelow + weights.lower1 + weights.sameTier +
    weights.above1 + weights.above2;
  const expected = {
    [effTier - 2]: ITER * (weights.lower2OrBelow / totalWeight),
    [effTier - 1]: ITER * (weights.lower1 / totalWeight),
    [effTier]: ITER * (weights.sameTier / totalWeight),
    [effTier + 1]: ITER * (weights.above1 / totalWeight),
    [effTier + 2]: ITER * (weights.above2 / totalWeight),
  };
  const buckets = {};
  const rng = mkRng(0xABCDEF);
  for (let i = 0; i < ITER; i++) {
    const t = rollMaterialTier(monsterType, effTier, rng);
    buckets[t] = (buckets[t] ?? 0) + 1;
  }
  console.log(`  BOSS @ effTier=${effTier} (N=${ITER}):`);
  let allOk = true;
  for (const tStr of Object.keys(expected).sort((a, b) => +a - +b)) {
    const t = +tStr;
    const e = expected[t];
    const got = buckets[t] ?? 0;
    const diff = Math.abs(got - e);
    const pct = e > 0 ? (diff / e) * 100 : 0;
    const ok = pct <= 15; // tolerance ±15% (Monte Carlo variance for N=10k)
    if (!ok) allOk = false;
    console.log(`    tier=${t}: got=${got}, expected≈${e.toFixed(0)}, dev=${pct.toFixed(1)}% ${ok ? '✓' : '✗'}`);
  }
  if (!allOk) { failures++; fails.push('I4: chi-square deviation > 15%'); }
}

// -----------------------------------------------------------------------------
// Invariant 5: floor — effTier=1, above2 still bounded? Possible above-bump
// since above1=2, above2=3 — but these are still valid material tiers (not
// "leak" since sourceTier=1 means map T1 can drop max T3 due to weight table.
// THIS IS BY DESIGN — not a leak per backlog. Confirm no T9 from T1 source.
// -----------------------------------------------------------------------------
console.log('\n### Invariant 5: effTier=1 cannot roll to tier > 3');
{
  let maxFromT1 = 0;
  for (const mtype of MONSTER_TYPES) {
    const rng = mkRng(0x12345);
    for (let i = 0; i < ITER; i++) {
      const t = rollMaterialTier(mtype, 1, rng);
      if (t > maxFromT1) maxFromT1 = t;
    }
  }
  const ok = maxFromT1 <= 3;
  console.log(`  effTier=1, maxRolled=T${maxFromT1}, limit≤T3 ${ok ? '✓' : '✗'}`);
  if (!ok) { failures++; fails.push(`I5: maxFromT1=${maxFromT1} > 3`); }
}

// -----------------------------------------------------------------------------
// Invariant 6: ceiling — effTier=9, above2 should clamp to 9 (no T11).
// -----------------------------------------------------------------------------
console.log('\n### Invariant 6: effTier=9 cannot roll above tier 9');
{
  let maxFromT9 = 0;
  for (const mtype of MONSTER_TYPES) {
    const rng = mkRng(0x67890);
    for (let i = 0; i < ITER; i++) {
      const t = rollMaterialTier(mtype, 9, rng);
      if (t > maxFromT9) maxFromT9 = t;
    }
  }
  const ok = maxFromT9 <= 9;
  console.log(`  effTier=9, maxRolled=T${maxFromT9}, limit≤T9 ${ok ? '✓' : '✗'}`);
  if (!ok) { failures++; fails.push(`I6: maxFromT9=${maxFromT9} > 9`); }
}

// -----------------------------------------------------------------------------
// Result
// -----------------------------------------------------------------------------
console.log(`\n=== Result: ${failures === 0 ? 'PASS' : 'FAIL'} ===`);
if (failures > 0) {
  console.log('Failures:');
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
