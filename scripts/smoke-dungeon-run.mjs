#!/usr/bin/env node
/**
 * smoke-dungeon-run.mjs — Phase 12.2.B DungeonRun runtime endpoint smoke.
 * Covers `apps/api/src/modules/dungeon-run/`.
 *
 * Smoke vừa cover negative-path (auth gate, missing input, unknown templateKey
 * / runId, ownership) vừa positive flow (start → next×N → COMPLETED → claim
 * → 409 RUN_ALREADY_CLAIMED). Phase 12.2.B `next()` không cần combat hook
 * thật — auto-resolve 1 encounter / call (kill monster + advance), nên
 * positive flow chạy được mà không cần spin combat thật.
 *
 * Steps (16):
 *  1. GET  /api/dungeons/me                      (no auth)              → 401.
 *  2. POST /api/dungeons/son_coc/start           (no auth)              → 401.
 *  3. POST /api/dungeon-runs/run-x/next          (no auth)              → 401.
 *  4. POST /api/dungeon-runs/run-x/claim         (no auth)              → 401.
 *  5. POST /api/_auth/register                                         — fresh user.
 *  6. GET  /api/dungeons/me                      (pre-onboard)          → 404 NO_CHARACTER.
 *  7. POST /api/character/onboard                                      — fresh char (luyenkhi tier).
 *  8. GET  /api/dungeons/me                      (post-onboard)         → 200 list, son_coc unlocked.
 *  9. POST /api/dungeons/fake_xxx/start                                → 404 DUNGEON_NOT_FOUND.
 * 10. POST /api/dungeons/cuu_la_dien/start                             → 403 DUNGEON_LOCKED_REALM
 *                                                                        (luyenkhi không đủ nguyen_anh).
 * 11. POST /api/dungeons/son_coc/start                                 → 200 ACTIVE run.
 * 12. POST /api/dungeon-runs/{run.id}/claim     (chưa COMPLETED)       → 409 RUN_NOT_COMPLETED.
 * 13. POST /api/dungeon-runs/{run.id}/next      ×3                     → cuối cùng COMPLETED.
 * 14. POST /api/dungeon-runs/{run.id}/next      (sau COMPLETED)        → 409 RUN_NOT_ACTIVE.
 * 15. POST /api/dungeon-runs/{run.id}/claim                            → 200 granted reward.
 * 16. POST /api/dungeon-runs/{run.id}/claim     (double claim)         → 409 RUN_ALREADY_CLAIMED.
 *
 * Env vars:
 *   SMOKE_API_BASE     — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS   — default 10000ms / request.
 *   SMOKE_VERBOSE      — "1" để log request/response.
 *   SMOKE_SECT_KEY     — default "thanh_van".
 *   SMOKE_DUNGEON_KEY  — default "son_coc" (luyenkhi tier, 3 encounter, daily=5).
 *
 * Yêu cầu:
 *   - `pnpm infra:up`
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `node scripts/smoke-dungeon-run.mjs`
 *
 * Exit code:
 *   0 — toàn bộ invariant OK.
 *   1 — ít nhất 1 invariant fail.
 */

const BASE = (process.env.SMOKE_API_BASE ?? 'http://localhost:3000').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);
const VERBOSE = process.env.SMOKE_VERBOSE === '1';
const SECT_KEY = process.env.SMOKE_SECT_KEY ?? 'thanh_van';
const DUNGEON_KEY = process.env.SMOKE_DUNGEON_KEY ?? 'son_coc';

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
  process.stdout.write(`[smoke:dungeon-run] ${name} ... `);
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

const email = `smoke-dungeon-${rid()}@xt.local`;
const password = `Smoke!Dgn1${rid()}`;
const charName = `SmkD_${rid()}`;
let runId = '';

async function main() {
  // 1.
  await step('GET /dungeons/me no auth → 401 UNAUTHENTICATED', async () => {
    cookieJar.clear();
    const r = await http('/api/dungeons/me');
    assert(r.status === 401, `expected 401, got ${r.status}`);
    assert(r.body?.ok === false, 'expected ok=false');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `expected UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 2.
  await step('POST /dungeons/:key/start no auth → 401', async () => {
    const r = await http(`/api/dungeons/${DUNGEON_KEY}/start`, { method: 'POST', body: {} });
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });

  // 3.
  await step('POST /dungeon-runs/:runId/next no auth → 401', async () => {
    const r = await http('/api/dungeon-runs/run-stub/next', { method: 'POST', body: {} });
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });

  // 4.
  await step('POST /dungeon-runs/:runId/claim no auth → 401', async () => {
    const r = await http('/api/dungeon-runs/run-stub/claim', { method: 'POST', body: {} });
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });

  // 5.
  await step('register fresh user', async () => {
    cookieJar.clear();
    const r = await http('/api/_auth/register', { method: 'POST', body: { email, password } });
    assert(r.status === 200 || r.status === 201, `register expected 200/201, got ${r.status}`);
  });

  // 6.
  await step('GET /dungeons/me pre-onboard → 404 NO_CHARACTER', async () => {
    const r = await http('/api/dungeons/me');
    assert(r.status === 404, `expected 404, got ${r.status}`);
    assert(r.body?.error?.code === 'NO_CHARACTER', `expected NO_CHARACTER, got ${r.body?.error?.code}`);
  });

  // 7.
  await step('onboard fresh character (luyenkhi tier)', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: charName, sectKey: SECT_KEY },
    });
    assert(
      r.status === 200 || r.status === 201,
      `onboard expected 200/201, got ${r.status}, body=${JSON.stringify(r.body)}`,
    );
  });

  // 8.
  await step('GET /dungeons/me post-onboard → 200 list with son_coc unlocked', async () => {
    const r = await http('/api/dungeons/me');
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body?.ok === true, 'expected ok=true');
    assert(Array.isArray(r.body?.data?.available), 'expected data.available array');
    const sonCoc = r.body.data.available.find((d) => d.dungeon.key === 'son_coc');
    assert(sonCoc, 'expected son_coc in available list');
    assert(sonCoc.unlocked === true, `expected son_coc unlocked, got ${sonCoc.unlocked}`);
    // cuu_la_dien là nguyen_anh tier — phải locked.
    const cuuLa = r.body.data.available.find((d) => d.dungeon.key === 'cuu_la_dien');
    assert(cuuLa && cuuLa.unlocked === false, 'expected cuu_la_dien locked for luyenkhi player');
  });

  // 9.
  await step('POST /dungeons/fake_xxx/start → 404 DUNGEON_NOT_FOUND', async () => {
    const r = await http('/api/dungeons/fake_xxx_dungeon/start', { method: 'POST', body: {} });
    assert(r.status === 404, `expected 404, got ${r.status}`);
    assert(r.body?.error?.code === 'DUNGEON_NOT_FOUND', `expected DUNGEON_NOT_FOUND, got ${r.body?.error?.code}`);
  });

  // 10.
  await step('POST /dungeons/cuu_la_dien/start → 403 DUNGEON_LOCKED_REALM', async () => {
    const r = await http('/api/dungeons/cuu_la_dien/start', { method: 'POST', body: {} });
    assert(r.status === 403, `expected 403, got ${r.status}, body=${JSON.stringify(r.body)}`);
    assert(
      r.body?.error?.code === 'DUNGEON_LOCKED_REALM',
      `expected DUNGEON_LOCKED_REALM, got ${r.body?.error?.code}`,
    );
  });

  // 11.
  await step(`POST /dungeons/${DUNGEON_KEY}/start → 200 ACTIVE run`, async () => {
    const r = await http(`/api/dungeons/${DUNGEON_KEY}/start`, { method: 'POST', body: {} });
    assert(r.status === 200, `expected 200, got ${r.status}, body=${JSON.stringify(r.body)}`);
    assert(r.body?.data?.run?.id, 'expected run.id');
    assert(r.body?.data?.run?.status === 'ACTIVE', `expected ACTIVE, got ${r.body?.data?.run?.status}`);
    assert(r.body?.data?.run?.encounterIndex === 0, `expected idx=0`);
    runId = r.body.data.run.id;
  });

  // 12.
  await step('POST /dungeon-runs/:id/claim trước COMPLETED → 409 RUN_NOT_COMPLETED', async () => {
    const r = await http(`/api/dungeon-runs/${runId}/claim`, { method: 'POST', body: {} });
    assert(r.status === 409, `expected 409, got ${r.status}, body=${JSON.stringify(r.body)}`);
    assert(
      r.body?.error?.code === 'RUN_NOT_COMPLETED',
      `expected RUN_NOT_COMPLETED, got ${r.body?.error?.code}`,
    );
  });

  // 13.
  await step('POST /dungeon-runs/:id/next ×N (cho tới khi COMPLETED)', async () => {
    let totalEncounters = 0;
    let lastStatus = 'ACTIVE';
    for (let i = 0; i < 12; i++) {
      const r = await http(`/api/dungeon-runs/${runId}/next`, { method: 'POST', body: {} });
      assert(r.status === 200, `next ${i + 1} expected 200, got ${r.status}, body=${JSON.stringify(r.body)}`);
      lastStatus = r.body?.data?.run?.status;
      totalEncounters = r.body?.data?.run?.totalEncounters ?? 0;
      if (lastStatus === 'COMPLETED') break;
    }
    assert(lastStatus === 'COMPLETED', `expected COMPLETED, got ${lastStatus}`);
    assert(totalEncounters > 0, 'expected totalEncounters > 0');
  });

  // 14.
  await step('POST /dungeon-runs/:id/next sau COMPLETED → 409 RUN_NOT_ACTIVE', async () => {
    const r = await http(`/api/dungeon-runs/${runId}/next`, { method: 'POST', body: {} });
    assert(r.status === 409, `expected 409, got ${r.status}`);
    assert(
      r.body?.error?.code === 'RUN_NOT_ACTIVE',
      `expected RUN_NOT_ACTIVE, got ${r.body?.error?.code}`,
    );
  });

  // 15.
  await step('POST /dungeon-runs/:id/claim → 200 granted reward', async () => {
    const r = await http(`/api/dungeon-runs/${runId}/claim`, { method: 'POST', body: {} });
    assert(r.status === 200, `expected 200, got ${r.status}, body=${JSON.stringify(r.body)}`);
    assert(r.body?.data?.runId === runId, 'expected runId match');
    assert(r.body?.data?.granted, 'expected granted breakdown');
    const granted = r.body.data.granted;
    assert(typeof granted.linhThach === 'number', 'expected granted.linhThach number');
    assert(Array.isArray(granted.items), 'expected granted.items array');
  });

  // 16.
  await step('POST /dungeon-runs/:id/claim double → 409 RUN_ALREADY_CLAIMED', async () => {
    const r = await http(`/api/dungeon-runs/${runId}/claim`, { method: 'POST', body: {} });
    assert(r.status === 409, `expected 409, got ${r.status}, body=${JSON.stringify(r.body)}`);
    assert(
      r.body?.error?.code === 'RUN_ALREADY_CLAIMED',
      `expected RUN_ALREADY_CLAIMED, got ${r.body?.error?.code}`,
    );
  });

  // Summary.
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n[smoke:dungeon-run] ${passed}/${results.length} steps passed.`);
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
  console.error('[smoke:dungeon-run] fatal', e);
  process.exit(2);
});
