#!/usr/bin/env node
/**
 * smoke-next-action.mjs — Smart next-action recommendation state machine smoke
 * cho Xuân Tôi.
 *
 * Mục tiêu: cover `GET /api/me/next-actions` qua HTTP — endpoint read-only
 * compute "Nên làm gì tiếp?" cho user dựa trên trạng thái character
 * (`apps/api/src/modules/next-action/next-action.service.ts`). Verify state
 * machine reactivity (action xuất hiện / biến mất khi underlying state đổi),
 * shape contract (key/priority/params/route), và NO_CHARACTER fallback.
 *
 *   1. `GET /api/me/next-actions` (no auth)            → 401.
 *   2. `POST /api/_auth/register`                      — fresh user.
 *   3. `GET /api/me/next-actions`                      → 200, actions =
 *                                                        [{key:
 *                                                        'NO_CHARACTER',
 *                                                        priority:1,
 *                                                        params:{},
 *                                                        route:'/onboarding'}].
 *   4. `POST /api/character/onboard`                   — fresh char
 *                                                        (cultivating=false
 *                                                        default).
 *   5. `GET /api/me/next-actions`                      → 200, KHÔNG có
 *                                                        NO_CHARACTER, có
 *                                                        DAILY_LOGIN_AVAILABLE
 *                                                        (priority=2,
 *                                                        route='/'),
 *                                                        KHÔNG có
 *                                                        BREAKTHROUGH_READY
 *                                                        (fresh char
 *                                                        realmStage=1).
 *                                                        Verify
 *                                                        sorted ASC by
 *                                                        priority.
 *   6. `POST /api/daily-login/claim`                   — claim daily
 *                                                        reward (changes
 *                                                        `dailyLoginToday`
 *                                                        state).
 *   7. `GET /api/me/next-actions`                      → 200,
 *                                                        DAILY_LOGIN
 *                                                        _AVAILABLE
 *                                                        KHÔNG còn nữa
 *                                                        (state đã đổi
 *                                                        — verify
 *                                                        reactive),
 *                                                        có CULTIVATE
 *                                                        _IDLE (empty
 *                                                        fallback vì
 *                                                        cultivating
 *                                                        =false +
 *                                                        actions.length
 *                                                        ===0 trước
 *                                                        empty fallback).
 *   8. `POST /api/character/cultivate {cultivating:true}` — toggle on.
 *   9. `GET /api/me/next-actions`                      → 200, CULTIVATE
 *                                                        _IDLE KHÔNG
 *                                                        còn (cultivating
 *                                                        =true), actions
 *                                                        =[] (empty).
 *  10. `POST /api/character/cultivate {cultivating:false}` — toggle off.
 *  11. `GET /api/me/next-actions`                      → 200, CULTIVATE
 *                                                        _IDLE returns
 *                                                        again
 *                                                        (verify state
 *                                                        toggle reactive).
 *  12. `POST /api/_auth/logout` + GET /me/next-actions → 401.
 *
 * State machine reactivity invariant:
 *   - NO_CHARACTER chỉ xuất hiện khi character chưa onboard (length=1
 *     fallback short-circuit).
 *   - DAILY_LOGIN_AVAILABLE xuất hiện khi `dailyLoginToday` row chưa tồn
 *     tại; biến mất ngay sau `POST /daily-login/claim` (reactive query).
 *   - CULTIVATE_IDLE chỉ xuất hiện ở empty fallback (`!cultivating &&
 *     actions.length === 0`); biến mất khi toggle cultivating=true HOẶC
 *     khi có action urgent khác.
 *
 * Chạy:
 *   pnpm smoke:next-action
 *   # hoặc trực tiếp:
 *   node scripts/smoke-next-action.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE     — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS   — default 10000ms / request.
 *   SMOKE_VERBOSE      — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY     — default "thanh_van".
 *
 * Yêu cầu môi trường (giống smoke:daily-login):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api bootstrap` (seed 3 sect)
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:next-action`
 *
 * Exit code:
 *   0 — toàn bộ invariant OK.
 *   1 — ít nhất 1 invariant fail.
 *
 * Zero-install: chỉ dùng native fetch + Intl từ Node 20+.
 */

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const BASE = (process.env.SMOKE_API_BASE ?? 'http://localhost:3000').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);
const VERBOSE = process.env.SMOKE_VERBOSE === '1';
const SECT_KEY = process.env.SMOKE_SECT_KEY ?? 'thanh_van';

// -----------------------------------------------------------------------------
// Cookie jar — Node fetch không có cookie jar built-in, tự track set-cookie.
// -----------------------------------------------------------------------------

/** @type {Map<string, string>} */
const cookieJar = new Map();

/** @param {Response} res */
function storeSetCookie(res) {
  /** @type {string[]} */
  const raw =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : // @ts-ignore fallback cũ
        (res.headers.raw?.()['set-cookie'] ?? []);
  for (const line of raw) {
    const eq = line.indexOf('=');
    const semi = line.indexOf(';');
    if (eq < 0) continue;
    const name = line.slice(0, eq).trim();
    const value = line.slice(eq + 1, semi < 0 ? undefined : semi).trim();
    if (value === '' || value === 'deleted') {
      cookieJar.delete(name);
    } else {
      cookieJar.set(name, value);
    }
  }
}

function cookieHeader() {
  if (cookieJar.size === 0) return undefined;
  return Array.from(cookieJar, ([k, v]) => `${k}=${v}`).join('; ');
}

// -----------------------------------------------------------------------------
// HTTP helper với timeout + cookie persistence.
// -----------------------------------------------------------------------------

/**
 * @param {string} path
 * @param {{ method?: string; body?: unknown }} [opts]
 * @returns {Promise<{ status: number; body: any }>}
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

  if (VERBOSE) {
    console.log(`→ ${method} ${url}${opts.body ? ' body=' + JSON.stringify(opts.body) : ''}`);
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
    storeSetCookie(res);
    let body;
    const ctype = res.headers.get('content-type') ?? '';
    if (ctype.includes('application/json')) {
      body = await res.json().catch(() => null);
    } else {
      body = await res.text().catch(() => null);
    }
    if (VERBOSE) {
      console.log(`← ${res.status} ${method} ${path}`);
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------------
// Step runner.
// -----------------------------------------------------------------------------

/** @type {{ name: string; ok: boolean; note?: string }[]} */
const results = [];

/**
 * @param {string} name
 * @param {() => Promise<void | { skip: true; note: string }>} fn
 */
async function step(name, fn) {
  process.stdout.write(`[smoke:next-action] ${name} ... `);
  try {
    const out = await fn();
    if (out && out.skip) {
      console.log(`SKIP (${out.note})`);
      results.push({ name, ok: true, note: `SKIP ${out.note}` });
    } else {
      console.log('OK');
      results.push({ name, ok: true });
    }
  } catch (err) {
    console.log('FAIL');
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, note: msg });
    console.error(`  ↳ ${msg}`);
  }
}

/**
 * @param {{ status: number; body: any }} r
 * @param {number | number[]} expected
 * @param {string} label
 */
function assertStatus(r, expected, label) {
  const ok = Array.isArray(expected) ? expected.includes(r.status) : r.status === expected;
  if (!ok) {
    throw new Error(
      `${label}: expect status ${Array.isArray(expected) ? expected.join('|') : expected}, got ${r.status}. Body: ${JSON.stringify(r.body).slice(0, 300)}`,
    );
  }
}

/** @param {unknown} cond @param {string} msg */
function assert(cond, msg) {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

// -----------------------------------------------------------------------------
// Helpers random.
// -----------------------------------------------------------------------------

function randomEmail() {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `smoke-next-action-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `na_${rand}`;
}

/**
 * Helper: extract action keys (sorted) cho compare.
 * @param {any[]} actions
 * @returns {string[]}
 */
function actionKeys(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.map((a) => String(a?.key ?? ''));
}

/**
 * Helper: find action by key.
 * @param {any[]} actions
 * @param {string} key
 */
function findAction(actions, key) {
  if (!Array.isArray(actions)) return undefined;
  return actions.find((a) => a?.key === key);
}

/**
 * Verify priority sorted ASC.
 * @param {any[]} actions
 */
function assertPrioritySorted(actions) {
  if (!Array.isArray(actions)) throw new Error('assertPrioritySorted: actions không phải array');
  for (let i = 1; i < actions.length; i++) {
    const prev = Number(actions[i - 1]?.priority ?? Infinity);
    const cur = Number(actions[i]?.priority ?? Infinity);
    if (cur < prev) {
      throw new Error(
        `assertPrioritySorted: index ${i} priority=${cur} < index ${i - 1} priority=${prev} (must sorted ASC)`,
      );
    }
  }
}

/**
 * Verify shape của 1 action — key/priority/params/route đầy đủ.
 * @param {any} action
 * @param {string} label
 */
function assertActionShape(action, label) {
  assert(action, `${label}: action null/undefined`);
  assert(typeof action.key === 'string' && action.key.length > 0, `${label}: key phải string non-empty, got ${typeof action.key}`);
  assert(typeof action.priority === 'number' && action.priority >= 1, `${label}: priority phải số >= 1, got ${action.priority}`);
  assert(action.params && typeof action.params === 'object' && !Array.isArray(action.params), `${label}: params phải object, got ${typeof action.params}`);
  assert(typeof action.route === 'string' && action.route.startsWith('/'), `${label}: route phải string bắt đầu /, got ${action.route}`);
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

async function main() {
  console.log(
    `[smoke:next-action] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}`,
  );

  // 1. GET /me/next-actions chưa auth → 401.
  await step('GET /me/next-actions — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/me/next-actions');
    assertStatus(r, 401, 'GET unauth');
    assert(
      r.body?.error?.code === 'UNAUTHENTICATED',
      `GET unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`,
    );
  });

  // 2. Register fresh user.
  const email = randomEmail();
  const password = randomPassword();
  await step('register', async () => {
    const r = await http('/api/_auth/register', {
      method: 'POST',
      body: { email, password },
    });
    assertStatus(r, [200, 201], 'register');
    if (!r.body?.ok)
      throw new Error(`register: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.user?.id, 'register: missing user.id');
  });

  // 3. GET /me/next-actions khi chưa onboard → 200, [NO_CHARACTER] short-circuit.
  await step('GET /me/next-actions — chưa onboard → [NO_CHARACTER] short-circuit', async () => {
    const r = await http('/api/me/next-actions');
    assertStatus(r, 200, 'GET no-char');
    if (!r.body?.ok)
      throw new Error(`GET no-char: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const actions = r.body?.data?.actions;
    assert(Array.isArray(actions), 'GET no-char: actions phải array');
    assert(actions.length === 1, `GET no-char: expect actions.length=1, got ${actions.length}`);
    const a = actions[0];
    assertActionShape(a, 'GET no-char');
    assert(a.key === 'NO_CHARACTER', `GET no-char: expect key=NO_CHARACTER, got ${a.key}`);
    assert(a.priority === 1, `GET no-char: expect priority=1, got ${a.priority}`);
    assert(a.route === '/onboarding', `GET no-char: expect route='/onboarding', got '${a.route}'`);
  });

  // 4. Onboard character.
  await step('onboard — create character', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: randomCharName(), sectKey: SECT_KEY },
    });
    assertStatus(r, 200, 'onboard');
    if (!r.body?.ok)
      throw new Error(`onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.character, 'onboard: missing character');
  });

  // 5. GET /me/next-actions fresh char → KHÔNG có NO_CHARACTER, có
  //    DAILY_LOGIN_AVAILABLE, KHÔNG có BREAKTHROUGH_READY (fresh realmStage=1).
  await step('GET /me/next-actions — fresh char có DAILY_LOGIN_AVAILABLE, không có NO_CHARACTER/BREAKTHROUGH_READY', async () => {
    const r = await http('/api/me/next-actions');
    assertStatus(r, 200, 'GET fresh char');
    const actions = r.body?.data?.actions;
    assert(Array.isArray(actions), 'GET fresh char: actions phải array');
    const keys = actionKeys(actions);
    assert(!keys.includes('NO_CHARACTER'), `GET fresh char: NO_CHARACTER KHÔNG xuất hiện sau onboard, got keys=${JSON.stringify(keys)}`);
    assert(!keys.includes('BREAKTHROUGH_READY'), `GET fresh char: BREAKTHROUGH_READY KHÔNG xuất hiện cho fresh realmStage=1, got keys=${JSON.stringify(keys)}`);
    const dlAction = findAction(actions, 'DAILY_LOGIN_AVAILABLE');
    assert(dlAction, `GET fresh char: DAILY_LOGIN_AVAILABLE phải xuất hiện (chưa claim hôm nay), got keys=${JSON.stringify(keys)}`);
    assertActionShape(dlAction, 'GET fresh char DAILY_LOGIN_AVAILABLE');
    assert(dlAction.priority === 2, `GET fresh char: DAILY_LOGIN_AVAILABLE priority=2 expected, got ${dlAction.priority}`);
    assert(dlAction.route === '/', `GET fresh char: DAILY_LOGIN_AVAILABLE route='/' expected, got '${dlAction.route}'`);
    assertPrioritySorted(actions);
  });

  // 6. POST /daily-login/claim — claim daily reward → state đổi.
  await step('POST /daily-login/claim — claim today để DAILY_LOGIN_AVAILABLE biến mất', async () => {
    const r = await http('/api/daily-login/claim', { method: 'POST' });
    assertStatus(r, 200, 'POST /daily-login/claim');
    const d = r.body?.data;
    assert(d?.claimed === true, `POST /daily-login/claim: expect claimed=true, got ${d?.claimed}`);
  });

  // 7. GET /me/next-actions sau claim → DAILY_LOGIN_AVAILABLE biến mất
  //    (reactive — service re-query DB dailyLoginClaim).
  await step('GET /me/next-actions — sau claim DAILY_LOGIN_AVAILABLE biến mất (reactive)', async () => {
    const r = await http('/api/me/next-actions');
    assertStatus(r, 200, 'GET post-claim');
    const actions = r.body?.data?.actions;
    const keys = actionKeys(actions);
    assert(
      !keys.includes('DAILY_LOGIN_AVAILABLE'),
      `GET post-claim: DAILY_LOGIN_AVAILABLE phải biến mất sau claim, got keys=${JSON.stringify(keys)}`,
    );
    assertPrioritySorted(actions);
    // CULTIVATE_IDLE empty fallback chỉ kích hoạt khi !cultivating &&
    // actions.length === 0 (BEFORE empty fallback push).
    // Fresh char default cultivating=false → expect CULTIVATE_IDLE present.
    const ciAction = findAction(actions, 'CULTIVATE_IDLE');
    assert(ciAction, `GET post-claim: CULTIVATE_IDLE phải xuất hiện (cultivating=false + actions empty), got keys=${JSON.stringify(keys)}`);
    assertActionShape(ciAction, 'GET post-claim CULTIVATE_IDLE');
    assert(ciAction.priority === 5, `GET post-claim: CULTIVATE_IDLE priority=5, got ${ciAction.priority}`);
    assert(ciAction.route === '/', `GET post-claim: CULTIVATE_IDLE route='/', got '${ciAction.route}'`);
  });

  // 8. POST /character/cultivate {cultivating:true} — toggle on.
  await step('POST /character/cultivate {cultivating:true} — toggle nhập định', async () => {
    const r = await http('/api/character/cultivate', {
      method: 'POST',
      body: { cultivating: true },
    });
    assertStatus(r, 200, 'POST cultivate on');
    const c = r.body?.data?.character;
    assert(c?.cultivating === true, `POST cultivate on: expect character.cultivating=true, got ${c?.cultivating}`);
  });

  // 9. GET /me/next-actions sau toggle on → CULTIVATE_IDLE biến mất, actions=[].
  await step('GET /me/next-actions — cultivating=true CULTIVATE_IDLE biến mất, actions=[]', async () => {
    const r = await http('/api/me/next-actions');
    assertStatus(r, 200, 'GET cultivating-on');
    const actions = r.body?.data?.actions;
    assert(Array.isArray(actions), 'GET cultivating-on: actions phải array');
    const keys = actionKeys(actions);
    assert(
      !keys.includes('CULTIVATE_IDLE'),
      `GET cultivating-on: CULTIVATE_IDLE phải biến mất khi cultivating=true, got keys=${JSON.stringify(keys)}`,
    );
    assert(
      actions.length === 0,
      `GET cultivating-on: expect actions=[] (no other urgent actions), got length=${actions.length} keys=${JSON.stringify(keys)}`,
    );
  });

  // 10. POST /character/cultivate {cultivating:false} — toggle off.
  await step('POST /character/cultivate {cultivating:false} — toggle dừng nhập định', async () => {
    const r = await http('/api/character/cultivate', {
      method: 'POST',
      body: { cultivating: false },
    });
    assertStatus(r, 200, 'POST cultivate off');
    const c = r.body?.data?.character;
    assert(c?.cultivating === false, `POST cultivate off: expect character.cultivating=false, got ${c?.cultivating}`);
  });

  // 11. GET /me/next-actions sau toggle off → CULTIVATE_IDLE returns
  //     (verify state machine reactive 2 chiều).
  await step('GET /me/next-actions — toggle off CULTIVATE_IDLE returns (reactive 2 chiều)', async () => {
    const r = await http('/api/me/next-actions');
    assertStatus(r, 200, 'GET cultivating-off');
    const actions = r.body?.data?.actions;
    const keys = actionKeys(actions);
    const ciAction = findAction(actions, 'CULTIVATE_IDLE');
    assert(ciAction, `GET cultivating-off: CULTIVATE_IDLE phải returns sau toggle off, got keys=${JSON.stringify(keys)}`);
    assertActionShape(ciAction, 'GET cultivating-off CULTIVATE_IDLE');
    // DAILY_LOGIN_AVAILABLE vẫn KHÔNG xuất hiện (đã claim hôm nay).
    assert(
      !keys.includes('DAILY_LOGIN_AVAILABLE'),
      `GET cultivating-off: DAILY_LOGIN_AVAILABLE vẫn KHÔNG xuất hiện (đã claim), got keys=${JSON.stringify(keys)}`,
    );
    assertPrioritySorted(actions);
  });

  // 12. logout + GET → 401 UNAUTHENTICATED.
  await step('logout + GET /me/next-actions — 401 UNAUTHENTICATED', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const r = await http('/api/me/next-actions');
    assertStatus(r, 401, 'GET post-logout');
    assert(
      r.body?.error?.code === 'UNAUTHENTICATED',
      `GET post-logout: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`,
    );
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:next-action] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:next-action] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:next-action] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:next-action] unexpected error:', err);
  process.exitCode = 1;
});
