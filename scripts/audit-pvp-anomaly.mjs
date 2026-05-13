#!/usr/bin/env node
/**
 * audit-pvp-anomaly.mjs — P2.3 Anti-cheat anomaly classifier coverage audit.
 *
 * Mục tiêu: verify `classifyPvpAnomaly()` từ `packages/shared/src/pvp.ts`
 * cover đủ 8 anomaly type với severity bucket + blockRewardClaim flag.
 *
 *   1. PVP_POWER_JUMP_BEFORE_MATCH        — severity 0.8, blockReward=true
 *   2. PVP_DAMAGE_OUTLIER                  — severity 0.6, blockReward=false
 *   3. ARENA_RATING_GAIN_OUTLIER           — severity 0.7, blockReward=false
 *   4. ARENA_TARGET_FARMING                — severity 0.9, blockReward=true
 *   5. SECT_WAR_SCORE_OUTLIER              — severity 0.7, blockReward=false
 *   6. TERRITORY_PRODUCTION_DUPLICATE_CLAIM — severity 1.0, blockReward=true
 *   7. SEASON_REWARD_DOUBLE_CLAIM          — severity 1.0, blockReward=true
 *   8. ROSTER_SWAP_EXPLOIT                 — severity 1.0, blockReward=true
 *
 * Phase 29.0 invariant: `blockRewardClaim = severity >= 0.8`.
 *
 * Chạy:
 *   pnpm audit:pvp-anomaly
 *   # hoặc:
 *   node scripts/audit-pvp-anomaly.mjs
 *
 * Exit code:
 *   0 — tất cả 8 type cover + invariant pass.
 *   1 — ít nhất 1 type miss hoặc invariant fail.
 */

import {
  classifyPvpAnomaly,
  isPvpAnomalyType,
  PVP_ANOMALY_TYPES,
  PVP_ANOMALY_RISK_WEIGHT,
} from '../packages/shared/dist/index.js';

let failures = 0;
const fails = [];

console.log('\n=== P2.3 Anti-cheat Anomaly Classifier Audit ===\n');

// -----------------------------------------------------------------------------
// 1. PVP_ANOMALY_TYPES has exactly 8 entries.
// -----------------------------------------------------------------------------
console.log('### Check 1: PVP_ANOMALY_TYPES has 8 entries');
{
  const ok = PVP_ANOMALY_TYPES.length === 8;
  console.log(`  count=${PVP_ANOMALY_TYPES.length} ${ok ? '✓' : '✗'}`);
  if (!ok) { failures++; fails.push(`PVP_ANOMALY_TYPES length=${PVP_ANOMALY_TYPES.length}`); }
}

// -----------------------------------------------------------------------------
// 2. Risk weight catalog has exactly 8 entries.
// -----------------------------------------------------------------------------
console.log('\n### Check 2: PVP_ANOMALY_RISK_WEIGHT has 8 entries');
{
  const keys = Object.keys(PVP_ANOMALY_RISK_WEIGHT);
  const ok = keys.length === 8;
  console.log(`  count=${keys.length} ${ok ? '✓' : '✗'}`);
  if (!ok) { failures++; fails.push(`PVP_ANOMALY_RISK_WEIGHT length=${keys.length}`); }
}

// -----------------------------------------------------------------------------
// 3. Each anomaly type classifies with severity + blockRewardClaim.
// -----------------------------------------------------------------------------
console.log('\n### Check 3: Each of 8 anomaly types classifies correctly');
{
  const expected = {
    'PVP_POWER_JUMP_BEFORE_MATCH': { severity: 0.8, blockRewardClaim: true },
    'PVP_DAMAGE_OUTLIER': { severity: 0.6, blockRewardClaim: false },
    'ARENA_RATING_GAIN_OUTLIER': { severity: 0.7, blockRewardClaim: false },
    'ARENA_TARGET_FARMING': { severity: 0.9, blockRewardClaim: true },
    'SECT_WAR_SCORE_OUTLIER': { severity: 0.7, blockRewardClaim: false },
    'TERRITORY_PRODUCTION_DUPLICATE_CLAIM': { severity: 1.0, blockRewardClaim: true },
    'SEASON_REWARD_DOUBLE_CLAIM': { severity: 1.0, blockRewardClaim: true },
    'ROSTER_SWAP_EXPLOIT': { severity: 1.0, blockRewardClaim: true },
  };
  for (const type of PVP_ANOMALY_TYPES) {
    const got = classifyPvpAnomaly(type);
    const exp = expected[type];
    if (!exp) {
      failures++;
      fails.push(`No expected value for ${type}`);
      continue;
    }
    const sevOk = Math.abs(got.severity - exp.severity) < 1e-9;
    const blockOk = got.blockRewardClaim === exp.blockRewardClaim;
    const ok = sevOk && blockOk;
    console.log(`  ${type}: severity=${got.severity} (expect ${exp.severity}) ${sevOk ? '✓' : '✗'} | blockReward=${got.blockRewardClaim} (expect ${exp.blockRewardClaim}) ${blockOk ? '✓' : '✗'}`);
    if (!ok) { failures++; fails.push(`${type}: severity=${got.severity}, blockReward=${got.blockRewardClaim}`); }
  }
}

// -----------------------------------------------------------------------------
// 4. blockRewardClaim invariant: blockRewardClaim ⇔ severity ≥ 0.8.
// -----------------------------------------------------------------------------
console.log('\n### Check 4: blockRewardClaim ⇔ severity ≥ 0.8');
{
  let invariantBreaks = 0;
  for (const type of PVP_ANOMALY_TYPES) {
    const got = classifyPvpAnomaly(type);
    const shouldBlock = got.severity >= 0.8;
    if (got.blockRewardClaim !== shouldBlock) {
      invariantBreaks++;
      console.log(`  ${type}: invariant BROKEN (severity=${got.severity}, block=${got.blockRewardClaim})`);
    }
  }
  const ok = invariantBreaks === 0;
  console.log(`  invariant breaks=${invariantBreaks} ${ok ? '✓' : '✗'}`);
  if (!ok) { failures++; fails.push(`invariantBreaks=${invariantBreaks}`); }
}

// -----------------------------------------------------------------------------
// 5. isPvpAnomalyType type-guard: accept all 8, reject unknown.
// -----------------------------------------------------------------------------
console.log('\n### Check 5: isPvpAnomalyType type-guard');
{
  let okCount = 0;
  for (const type of PVP_ANOMALY_TYPES) {
    if (isPvpAnomalyType(type)) okCount++;
  }
  const badInputs = ['UNKNOWN_TYPE', null, undefined, 42, '', 'pvp_power_jump_before_match'];
  let badRejected = 0;
  for (const bad of badInputs) {
    if (!isPvpAnomalyType(bad)) badRejected++;
  }
  const ok = okCount === 8 && badRejected === badInputs.length;
  console.log(`  accept valid: ${okCount}/8, reject invalid: ${badRejected}/${badInputs.length} ${ok ? '✓' : '✗'}`);
  if (!ok) { failures++; fails.push(`type-guard accept=${okCount}/8, reject=${badRejected}/${badInputs.length}`); }
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
