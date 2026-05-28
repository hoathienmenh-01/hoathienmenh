#!/usr/bin/env node
/**
 * Phase 43 — Smoke aggregator runner.
 *
 * Chạy chuỗi smoke nền phục vụ QA regression + deploy verify:
 *
 *   1. smoke:health             — Health endpoints (no auth, no DB seed).
 *   2. smoke:auth               — Auth flow (login/register/forgot/reset).
 *   3. smoke:admin              — Admin login + read-only admin endpoints.
 *   4. smoke:economy            — Currency ledger invariants nền + mail-reward chain.
 *   5. smoke:breakthrough       — Breakthrough negative + positive path (admin seed).
 *   6. smoke:mission            — Mission negative + positive claim (admin seed).
 *   7. smoke:spiritual-root     — Spiritual root negative + positive reroll (admin seed).
 *   8. smoke:combat             — Combat encounter negative path + reward shape.
 *   9. smoke:cultivation        — Cultivation toggle on/off + idempotency.
 *  10. smoke:boss               — Boss attack negative path + auth guards.
 *  11. smoke:dungeon-run        — Dungeon run start/next/claim + double-claim guard.
 *  12. smoke:mail               — Mail list/read/claim negative path.
 *  13. smoke:giftcode           — Giftcode redeem negative path + auth guards.
 *  14. smoke:ws                 — WebSocket connect + cultivation tick + mission push.
 *  15. smoke:achievement        — Achievement unlock + claim positive path (admin seed).
 *  16. smoke:daily-login        — Daily login streak + claim positive path.
 *  17. smoke:cultivation-method — Cultivation method equip + switch.
 *  18. smoke:skill              — Skill equip + use positive path.
 *  19. smoke:shop               — Shop buy positive path.
 *  20. smoke:sect               — Sect create/join/leave/contribute.
 *  21. smoke:alchemy            — Alchemy recipes + craft positive path (admin seed).
 *  22. smoke:gem                — Gem socket/unsocket/combine negative paths.
 *  23. smoke:refine             — Refine equipment positive path (admin seed).
 *  24. smoke:pet                — Pet box open + collection positive path (admin seed).
 *  25. smoke:inventory          — Inventory equip/unequip/use negative + positive paths.
 *  26. smoke:leaderboard        — Leaderboard ranking endpoints.
 *  27. smoke:market             — Market listings/post/buy/cancel/mine.
 *  28. smoke:chat               — Chat send/receive + scope rate-limit.
 *  29. smoke:topup              — Topup order state machine (create → approve/reject).
 *  30. smoke:quest              — Quest list/accept/progress/claim.
 *  31. smoke:social             — Social system (friends + co-cultivation).
 *  32. smoke:npc                — NPC dialogue + affinity.
 *  33. smoke:story-dungeon      — Story dungeon end-to-end flow.
 *  34. smoke:tribulation        — Tribulation attempt + preview.
 *  35. smoke:body-cultivation   — Body cultivation (Luyện Thể).
 *  36. smoke:coop               — Co-op party + party dungeon + co-op boss.
 *  37. smoke:next-action        — Smart next-action recommendation.
 *
 * Mỗi module có thể chạy riêng qua `pnpm smoke:<name>`.
 *
 * Mỗi step có timeout cứng 60s. Step fail → tiếp tục step kế tiếp +
 * tổng kết failures cuối cùng. Exit code:
 *   0 — mọi step pass.
 *   1 — ≥1 step fail.
 *
 * Sử dụng:
 *   pnpm smoke:all                    # full set
 *   pnpm smoke:all --only=health,auth # subset
 *   SMOKE_API_BASE=http://localhost:3000 pnpm smoke:all
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { flushAuthRateLimits } from './flush-auth-rate-limits.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const ALL_SUITES = [
  { name: 'health', script: 'scripts/smoke-health.mjs' },
  { name: 'auth', script: 'scripts/smoke-auth.mjs' },
  { name: 'admin', script: 'scripts/smoke-admin.mjs' },
  { name: 'economy', script: 'scripts/smoke-economy.mjs' },
  { name: 'breakthrough', script: 'scripts/smoke-breakthrough.mjs' },
  { name: 'mission', script: 'scripts/smoke-mission.mjs' },
  { name: 'spiritual-root', script: 'scripts/smoke-spiritual-root.mjs' },
  { name: 'combat', script: 'scripts/smoke-combat.mjs' },
  { name: 'cultivation', script: 'scripts/smoke-cultivation.mjs' },
  { name: 'boss', script: 'scripts/smoke-boss.mjs' },
  { name: 'dungeon-run', script: 'scripts/smoke-dungeon-run.mjs' },
  { name: 'mail', script: 'scripts/smoke-mail.mjs' },
  { name: 'giftcode', script: 'scripts/smoke-giftcode.mjs' },
  { name: 'ws', script: 'scripts/smoke-ws.mjs' },
  // Phase 15.8 — Beta readiness smoke expansion.
  { name: 'achievement', script: 'scripts/smoke-achievement.mjs' },
  { name: 'daily-login', script: 'scripts/smoke-daily-login.mjs' },
  { name: 'cultivation-method', script: 'scripts/smoke-cultivation-method.mjs' },
  { name: 'skill', script: 'scripts/smoke-skill.mjs' },
  { name: 'shop', script: 'scripts/smoke-shop.mjs' },
  { name: 'sect', script: 'scripts/smoke-sect.mjs' },
  { name: 'alchemy', script: 'scripts/smoke-alchemy.mjs' },
  { name: 'gem', script: 'scripts/smoke-gem.mjs' },
  { name: 'refine', script: 'scripts/smoke-refine.mjs' },
  { name: 'pet', script: 'scripts/smoke-pet.mjs' },
  // Phase 15.8 — Full coverage expansion (inventory, leaderboard, market, chat, topup, quest, social, npc, story-dungeon, tribulation, body-cultivation, coop, next-action).
  { name: 'inventory', script: 'scripts/smoke-inventory.mjs' },
  { name: 'leaderboard', script: 'scripts/smoke-leaderboard.mjs' },
  { name: 'market', script: 'scripts/smoke-market.mjs' },
  { name: 'chat', script: 'scripts/smoke-chat.mjs' },
  { name: 'topup', script: 'scripts/smoke-topup.mjs' },
  { name: 'quest', script: 'scripts/smoke-quest.mjs' },
  { name: 'social', script: 'scripts/smoke-social.mjs' },
  { name: 'npc', script: 'scripts/smoke-npc.mjs' },
  { name: 'story-dungeon', script: 'scripts/smoke-story-dungeon.mjs' },
  { name: 'tribulation', script: 'scripts/smoke-tribulation.mjs' },
  { name: 'body-cultivation', script: 'scripts/smoke-body-cultivation.mjs' },
  { name: 'coop', script: 'scripts/smoke-coop.mjs' },
  { name: 'next-action', script: 'scripts/smoke-next-action.mjs' },
];

/**
 * Opt-in suites — excluded from default `pnpm smoke:all` run.
 * Only runs when explicitly selected via --only=restore-drill.
 */
const OPT_IN_SUITES = [
  { name: 'restore-drill', script: 'scripts/restore-drill.mjs' },
  { name: 'sect-positive', script: 'scripts/smoke-sect-positive.mjs' },
  { name: 'market-positive', script: 'scripts/smoke-market-positive.mjs' },
];

const STEP_TIMEOUT_MS = Number(process.env.SMOKE_ALL_TIMEOUT_MS ?? 60_000);

const AVAILABLE_SUITES = [...ALL_SUITES, ...OPT_IN_SUITES];

function parseArgs(argv) {
  const opts = { only: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--only=')) {
      const list = a
        .slice('--only='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const unknown = list.filter(
        (s) => !AVAILABLE_SUITES.some((suite) => suite.name === s),
      );
      if (unknown.length > 0) {
        // eslint-disable-next-line no-console
        console.error(
          `[smoke:all] Unknown suite(s): ${unknown.join(', ')}. Valid: ${AVAILABLE_SUITES.map((s) => s.name).join(', ')}`,
        );
        process.exit(2);
      }
      opts.only = list;
    } else if (a === '--help' || a === '-h') {
      // eslint-disable-next-line no-console
      console.log(
        `Usage: pnpm smoke:all [--only=${AVAILABLE_SUITES.map((s) => s.name).join(',')}]`,
      );
      // eslint-disable-next-line no-console
      console.log(
        `Opt-in suites (excluded from default run): ${OPT_IN_SUITES.map((s) => s.name).join(', ')}`,
      );
      process.exit(0);
    }
  }
  return opts;
}

function runStep(name, script) {
  return new Promise((resolveStep) => {
    const start = Date.now();
    const child = spawn(process.execPath, [resolve(REPO_ROOT, script)], {
      stdio: 'inherit',
      env: process.env,
    });
    const timer = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error(`[smoke:all] ${name} TIMEOUT after ${STEP_TIMEOUT_MS}ms — killing`);
      child.kill('SIGKILL');
    }, STEP_TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const ms = Date.now() - start;
      resolveStep({ name, code: code ?? 1, ms });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      // eslint-disable-next-line no-console
      console.error(`[smoke:all] ${name} spawn error: ${e.message}`);
      resolveStep({ name, code: 1, ms: Date.now() - start });
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv);
  const suites = opts.only
    ? AVAILABLE_SUITES.filter((s) => opts.only.includes(s.name))
    : ALL_SUITES;

  // eslint-disable-next-line no-console
  console.log(`[smoke:all] Running ${suites.length} suite(s): ${suites.map((s) => s.name).join(', ')}`);

  const results = [];
  for (const suite of suites) {
    // eslint-disable-next-line no-console
    console.log(`\n[smoke:all] === ${suite.name} ===`);
    const result = await runStep(suite.name, suite.script);
    results.push(result);
  }

  // eslint-disable-next-line no-console
  console.log('\n[smoke:all] Summary:');
  let failures = 0;
  for (const r of results) {
    const status = r.code === 0 ? 'PASS' : 'FAIL';
    if (r.code !== 0) failures += 1;
    // eslint-disable-next-line no-console
    console.log(`  - ${r.name.padEnd(10)} ${status} (${r.ms}ms)`);
  }
  // eslint-disable-next-line no-console
  console.log(`[smoke:all] failures=${failures}/${results.length}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(`[smoke:all] FATAL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
});
