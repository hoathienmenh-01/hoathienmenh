#!/usr/bin/env node
/**
 * Phase 43 — Smoke aggregator runner.
 *
 * Chạy chuỗi smoke nền phục vụ QA regression + deploy verify:
 *
 *   1. smoke:health  — Health endpoints (no auth, no DB seed).
 *   2. smoke:auth    — Auth flow (login/register/forgot/reset).
 *   3. smoke:admin   — Admin login + read-only admin endpoints.
 *   4. smoke:economy — Currency ledger invariants nền.
 *
 * Không cố gắng cover toàn bộ gameplay smoke — chỉ "nền vận hành"
 * theo spec Phase 43. Mỗi module có thể chạy riêng qua `pnpm smoke:<name>`.
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const ALL_SUITES = [
  { name: 'health', script: 'scripts/smoke-health.mjs' },
  { name: 'auth', script: 'scripts/smoke-auth.mjs' },
  { name: 'admin', script: 'scripts/smoke-admin.mjs' },
  { name: 'economy', script: 'scripts/smoke-economy.mjs' },
];

const STEP_TIMEOUT_MS = Number(process.env.SMOKE_ALL_TIMEOUT_MS ?? 60_000);

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
        (s) => !ALL_SUITES.some((suite) => suite.name === s),
      );
      if (unknown.length > 0) {
        // eslint-disable-next-line no-console
        console.error(
          `[smoke:all] Unknown suite(s): ${unknown.join(', ')}. Valid: ${ALL_SUITES.map((s) => s.name).join(', ')}`,
        );
        process.exit(2);
      }
      opts.only = list;
    } else if (a === '--help' || a === '-h') {
      // eslint-disable-next-line no-console
      console.log(
        `Usage: pnpm smoke:all [--only=${ALL_SUITES.map((s) => s.name).join(',')}]`,
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
    ? ALL_SUITES.filter((s) => opts.only.includes(s.name))
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
