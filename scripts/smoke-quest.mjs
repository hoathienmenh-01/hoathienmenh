#!/usr/bin/env node
/**
 * smoke-quest.mjs — Quest list/accept/progress endpoints smoke cho Xuân Tôi.
 * Phase 12 Story PR-2 — covers `apps/api/src/modules/quest/`.
 *
 * Negative-path-heavy: positive claim path (reward grant via RewardLedger
 * idempotency) defer cho Phase 12 PR-3 (`smoke:quest-claim` future).
 *
 * Steps:
 *  1. GET  /api/quests/me                  (no auth)              → 401.
 *  2. POST /api/quests/accept              (no auth)              → 401.
 *  3. POST /api/quests/progress            (no auth)              → 401.
 *  4. POST /api/_auth/register                                    — fresh user.
 *  5. GET  /api/quests/me                  (pre-onboard)          → 404.
 *  6. POST /api/quests/accept     ({})                            → 400 INVALID_INPUT.
 *  7. POST /api/quests/progress   ({questKey:'q1'})               → 400 INVALID_INPUT.
 *  8. POST /api/character/onboard                                  — fresh char.
 *  9. GET  /api/quests/me                  (post-onboard)         → 200 array.
 * 10. POST /api/quests/accept     ({questKey: 'fake_xxx'})        → 404 QUEST_UNKNOWN.
 * 11. POST /api/quests/accept     ({questKey: 'luyenkhi_main_01'}) → 403 QUEST_LOCKED_REALM
 *                                                                  (phamnhan char không đủ realm).
 * 12. POST /api/quests/accept     ({questKey: 'phamnhan_sect_01'}) → 403 QUEST_LOCKED_PREREQUISITE
 *                                                                  (cần phamnhan_main_01 COMPLETED trước).
 * 13. POST /api/quests/accept     ({questKey: 'phamnhan_grind_01'}) → 200 ACCEPTED.
 * 14. POST /api/quests/accept     ({questKey: 'phamnhan_grind_01'}) → 409 QUEST_NOT_AVAILABLE
 *                                                                  (CAS guard double-accept).
 * 15. POST /api/quests/progress   ({questKey: 'phamnhan_grind_01',
 *                                    stepId: 'fake_step'})        → 404 QUEST_STEP_UNKNOWN.
 * 16. POST /api/quests/progress   ({questKey: 'phamnhan_grind_01',
 *                                    stepId: 'step_01'})          → 409 QUEST_STEP_KIND_MISMATCH
 *                                                                  (kill step không qua progress).
 *
 * Env vars:
 *   SMOKE_API_BASE     — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS   — default 10000ms / request.
 *   SMOKE_VERBOSE      — "1" để log request/response.
 *   SMOKE_SECT_KEY     — default "thanh_van".
 *
 * Yêu cầu:
 *   - `pnpm infra:up`
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:quest`
 *
 * Defer: positive flow (track kill via combat → progress → COMPLETED → claim
 * via PR-3 reward ledger) yêu cầu gameplay automation. Future smoke có thể
 * seed via admin grant-exp + admin quest-track endpoint (Phase 12 PR-3+).
 *
 * Exit code:
 *   0 — toàn bộ invariant OK.
 *   1 — ít nhất 1 invariant fail.
 */

const BASE = (process.env.SMOKE_API_BASE ?? 'http://localhost:3000').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);
const VERBOSE = process.env.SMOKE_VERBOSE === '1';
const SECT_KEY = process.env.SMOKE_SECT_KEY ?? 'thanh_van';

/** @type {Map<string, string>} */
const cookieJar = new Map();

/** @param {Response} res */
function storeSetCookie(res) {
  const raw =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.raw?.()['set-cookie'] ?? []);
  for (const line of raw) {
    const eq = line.indexOf('=');
    const semi = line.indexOf(';');
    if (eq < 0) continue;
    const name = line.slice(0, eq).trim();
    const value = line.slice(eq + 1, semi < 0 ? undefined : semi).trim();
    if (value === '' || value === 'deleted') cookieJar.delete(name);
    else cookieJar.set(name, value);
  }
}

function cookieHeader() {
  if (cookieJar.size === 0) return undefined;
  return Array.from(cookieJar, ([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * @param {string} path
 * @param {{ method?: string; body?: unknown }} [opts]
 */
async function http(path, opts = {}) {
  const url = `${BASE}${path}`;
  const method = opts.method ?? 'GET';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  /** @type {Record<string,string>} */
  const headers = { Accept: 'application/json' };
  const cookieH = cookieHeader();
  if (cookieH) headers.Cookie = cookieH;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  if (VERBOSE) console.log(`→ ${method} ${url}${opts.body ? ' body=' + JSON.stringify(opts.body) : ''}`);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
    storeSetCookie(res);
    const ctype = res.headers.get('content-type') ?? '';
    const body = ctype.includes('application/json') ? await res.json().catch(() => null) : await res.text().catch(() => null);
    if (VERBOSE) console.log(`← ${res.status} ${method} ${path}`);
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/** @type {{ name: string; ok: boolean; note?: string }[]} */
const results = [];

/** @param {string} name @param {() => Promise<void>} fn */
async function step(name, fn) {
  process.stdout.write(`[smoke:quest] ${name} ... `);
  try {
    await fn();
    console.log('OK');
    results.push({ name, ok: true });
  } catch (e) {
    console.log('FAIL');
    results.push({ name, ok: false, note: e instanceof Error ? e.message : String(e) });
    if (VERBOSE && e instanceof Error) console.log(e.stack);
  }
}

/** @param {boolean} cond @param {string} msg */
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function rid() {
  return Math.random().toString(36).slice(2, 10);
}

const email = `smoke-quest-${rid()}@xt.local`;
const password = `Smoke!Quest1${rid()}`;
const charName = `SmkQ_${rid()}`;

async function main() {
  // 1.
  await step('GET /quests/me no auth → 401 UNAUTHENTICATED', async () => {
    cookieJar.clear();
    const r = await http('/api/quests/me');
    assert(r.status === 401, `expected 401, got ${r.status}`);
    assert(r.body?.ok === false, 'expected ok=false');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `expected UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 2.
  await step('POST /quests/accept no auth → 401', async () => {
    const r = await http('/api/quests/accept', { method: 'POST', body: { questKey: 'phamnhan_grind_01' } });
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });

  // 3.
  await step('POST /quests/progress no auth → 401', async () => {
    const r = await http('/api/quests/progress', { method: 'POST', body: { questKey: 'q', stepId: 's' } });
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });

  // 4.
  await step('register fresh user', async () => {
    cookieJar.clear();
    const r = await http('/api/_auth/register', { method: 'POST', body: { email, password } });
    assert(r.status === 200 || r.status === 201, `register expected 200/201, got ${r.status}`);
  });

  // 5.
  await step('GET /quests/me pre-onboard → 404 NO_CHARACTER', async () => {
    const r = await http('/api/quests/me');
    assert(r.status === 404, `expected 404, got ${r.status}`);
    assert(r.body?.error?.code === 'NO_CHARACTER', `expected NO_CHARACTER, got ${r.body?.error?.code}`);
  });

  // 6.
  await step('POST /quests/accept missing questKey → 400 INVALID_INPUT', async () => {
    const r = await http('/api/quests/accept', { method: 'POST', body: {} });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body?.error?.code === 'INVALID_INPUT', `expected INVALID_INPUT, got ${r.body?.error?.code}`);
  });

  // 7.
  await step('POST /quests/progress missing stepId → 400 INVALID_INPUT', async () => {
    const r = await http('/api/quests/progress', { method: 'POST', body: { questKey: 'phamnhan_main_01' } });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body?.error?.code === 'INVALID_INPUT', `expected INVALID_INPUT, got ${r.body?.error?.code}`);
  });

  // 8.
  await step('onboard fresh character', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: charName, sectKey: SECT_KEY },
    });
    assert(r.status === 200 || r.status === 201, `onboard expected 200/201, got ${r.status}, body=${JSON.stringify(r.body)}`);
  });

  // 9.
  await step('GET /quests/me post-onboard → 200 array', async () => {
    const r = await http('/api/quests/me');
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body?.ok === true, 'expected ok=true');
    assert(Array.isArray(r.body?.data?.quests), 'expected quests array');
    // Onboard mặc định luyenkhi (test-helpers default) — sẽ thấy phamnhan + một số luyenkhi quest no-prereq.
    const list = r.body.data.quests;
    assert(list.length > 0, 'expected at least 1 quest visible');
    // Shape contract: mỗi quest có key/name/status/steps.
    const sample = list[0];
    assert(typeof sample.key === 'string' && sample.key.length > 0, 'quest.key string');
    assert(typeof sample.status === 'string' && ['LOCKED', 'AVAILABLE', 'ACCEPTED', 'COMPLETED', 'CLAIMED'].includes(sample.status), `quest.status enum, got ${sample.status}`);
    assert(Array.isArray(sample.steps), 'quest.steps array');
  });

  // 10.
  await step('POST /quests/accept fake_xxx → 404 QUEST_UNKNOWN', async () => {
    const r = await http('/api/quests/accept', { method: 'POST', body: { questKey: 'fake_xxx_quest' } });
    assert(r.status === 404, `expected 404, got ${r.status}`);
    assert(r.body?.error?.code === 'QUEST_UNKNOWN', `expected QUEST_UNKNOWN, got ${r.body?.error?.code}`);
  });

  // 11.
  await step('POST /quests/accept truc_co_main_01 (locked realm) → 403 QUEST_LOCKED_REALM', async () => {
    // truc_co_main_01 yêu cầu order >= 2; fresh char default luyenkhi (order 1).
    const r = await http('/api/quests/accept', { method: 'POST', body: { questKey: 'truc_co_main_01' } });
    assert(r.status === 403, `expected 403, got ${r.status}, body=${JSON.stringify(r.body)}`);
    assert(r.body?.error?.code === 'QUEST_LOCKED_REALM', `expected QUEST_LOCKED_REALM, got ${r.body?.error?.code}`);
  });

  // 12.
  await step('POST /quests/accept phamnhan_sect_01 (locked prereq) → 403 QUEST_LOCKED_PREREQUISITE', async () => {
    const r = await http('/api/quests/accept', { method: 'POST', body: { questKey: 'phamnhan_sect_01' } });
    assert(r.status === 403, `expected 403, got ${r.status}, body=${JSON.stringify(r.body)}`);
    assert(r.body?.error?.code === 'QUEST_LOCKED_PREREQUISITE', `expected QUEST_LOCKED_PREREQUISITE, got ${r.body?.error?.code}`);
  });

  // 13.
  await step('POST /quests/accept phamnhan_grind_01 → 200 ACCEPTED', async () => {
    const r = await http('/api/quests/accept', { method: 'POST', body: { questKey: 'phamnhan_grind_01' } });
    assert(r.status === 200, `expected 200, got ${r.status}, body=${JSON.stringify(r.body)}`);
    assert(r.body?.data?.quest?.status === 'ACCEPTED', `expected ACCEPTED, got ${r.body?.data?.quest?.status}`);
    assert(r.body?.data?.quest?.acceptedAt, 'expected acceptedAt set');
  });

  // 14.
  await step('POST /quests/accept phamnhan_grind_01 again → 409 QUEST_NOT_AVAILABLE', async () => {
    const r = await http('/api/quests/accept', { method: 'POST', body: { questKey: 'phamnhan_grind_01' } });
    assert(r.status === 409, `expected 409, got ${r.status}`);
    assert(r.body?.error?.code === 'QUEST_NOT_AVAILABLE', `expected QUEST_NOT_AVAILABLE, got ${r.body?.error?.code}`);
  });

  // 15.
  await step('POST /quests/progress fake stepId → 404 QUEST_STEP_UNKNOWN', async () => {
    const r = await http('/api/quests/progress', {
      method: 'POST',
      body: { questKey: 'phamnhan_grind_01', stepId: 'fake_step_xxx' },
    });
    assert(r.status === 404, `expected 404, got ${r.status}`);
    assert(r.body?.error?.code === 'QUEST_STEP_UNKNOWN', `expected QUEST_STEP_UNKNOWN, got ${r.body?.error?.code}`);
  });

  // 16.
  await step('POST /quests/progress kill step → 409 QUEST_STEP_KIND_MISMATCH', async () => {
    // phamnhan_grind_01 step_01 là kill — chỉ cộng qua track() (CombatService hook), không qua endpoint.
    const r = await http('/api/quests/progress', {
      method: 'POST',
      body: { questKey: 'phamnhan_grind_01', stepId: 'step_01' },
    });
    assert(r.status === 409, `expected 409, got ${r.status}`);
    assert(r.body?.error?.code === 'QUEST_STEP_KIND_MISMATCH', `expected QUEST_STEP_KIND_MISMATCH, got ${r.body?.error?.code}`);
  });

  // Summary.
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n[smoke:quest] ${passed}/${results.length} steps passed.`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.name}: ${r.note}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[smoke:quest] fatal', e);
  process.exit(2);
});
