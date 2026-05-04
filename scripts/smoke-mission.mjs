#!/usr/bin/env node
/**
 * smoke-mission.mjs — Mission list + claim endpoints smoke cho Xuân Tôi.
 * Negative-path-only (positive claim path yêu cầu progress thực — track
 * goalKind ≥ goalAmount qua gameplay event như breakthrough/clear-dungeon
 * → defer cho future smoke với clock injection hoặc gameplay automation).
 *
 * Mục tiêu: cover 2 mission endpoints qua HTTP — `apps/api/src/modules/
 * mission`. Verify auth gate (401 unauth × 2), zod validation (400
 * INVALID_INPUT cho missionKey missing/empty/>80 chars), service order
 * (MISSION_UNKNOWN check **trước** char check — catalog validate
 * trước cả khi load character), NO_CHARACTER fallback (404 cho /me và
 * /claim với valid missionKey pre-onboard), MISSION_UNKNOWN 404 (cho
 * key không tồn tại trong shared catalog), NOT_READY 409 (fresh char
 * chưa có progress nào ≥ goalAmount), shape contract cho /me sau
 * onboard (key/name/period/goalKind/goalAmount/currentAmount/claimed/
 * completable/rewards/quality), và anti-FE-self-grant invariant
 * (failed claim attempts KHÔNG đụng linhThach/tienNgoc).
 *
 *   1. `GET  /api/missions/me`              (no auth)              → 401.
 *   2. `POST /api/missions/claim`           (no auth)              → 401.
 *   3. `POST /api/_auth/register`                                  — fresh
 *                                                                  user.
 *   4. `GET  /api/missions/me`              (pre-onboard)          → 404
 *                                                                  NO_CHARACTER.
 *   5. `POST /api/missions/claim`           ({})                   → 400
 *                                                                  INVALID_INPUT
 *                                                                  (zod
 *                                                                  missing
 *                                                                  missionKey).
 *   6. `POST /api/missions/claim`     ({missionKey:''})            → 400
 *                                                                  INVALID_INPUT
 *                                                                  (zod
 *                                                                  min(1)).
 *   7. `POST /api/missions/claim`     ({missionKey: 81*'X'})       → 400
 *                                                                  INVALID_INPUT
 *                                                                  (zod
 *                                                                  max(80)).
 *   8. `POST /api/missions/claim`     ({missionKey: 'INVALID'})    → 404
 *                                                                  MISSION_UNKNOWN
 *                                                                  pre-
 *                                                                  onboard
 *                                                                  (catalog
 *                                                                  check
 *                                                                  trước
 *                                                                  char
 *                                                                  check).
 *   9. `POST /api/missions/claim`     ({missionKey:
 *                                       'once_first_breakthrough'}) → 404
 *                                                                  NO_CHARACTER
 *                                                                  pre-
 *                                                                  onboard
 *                                                                  (valid
 *                                                                  key
 *                                                                  qua
 *                                                                  catalog
 *                                                                  →
 *                                                                  char
 *                                                                  check).
 *  10. `POST /api/character/onboard`                               — fresh
 *                                                                  char.
 *  11. `GET  /api/missions/me`             (post-onboard)          → 200
 *                                                                  missions
 *                                                                  array
 *                                                                  shape
 *                                                                  +
 *                                                                  fresh
 *                                                                  char
 *                                                                  currentAmount=0
 *                                                                  + claimed=false
 *                                                                  + completable=false.
 *  12. `POST /api/missions/claim`     ({missionKey:
 *                                       'once_first_breakthrough'}) → 409
 *                                                                  NOT_READY
 *                                                                  (fresh
 *                                                                  char,
 *                                                                  no
 *                                                                  progress).
 *  13. `anti-FE-self-grant` snapshot currency before/after fail attempts
 *                                                                  → linhThach
 *                                                                  /tienNgoc
 *                                                                  KHÔNG
 *                                                                  đụng.
 *  14. `POST /api/_auth/logout` + GET /me + POST /claim            → 401.
 *
 * Chạy:
 *   pnpm smoke:mission
 *   # hoặc trực tiếp:
 *   node scripts/smoke-mission.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE     — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS   — default 10000ms / request.
 *   SMOKE_VERBOSE      — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY     — default "thanh_van".
 *   SMOKE_MISSION_KEY  — default "once_first_breakthrough" (bất kỳ key
 *                        nào tồn tại trong `packages/shared/src/missions.ts`
 *                        và không completable bởi fresh char đều dùng được).
 *
 * Yêu cầu môi trường (giống smoke:giftcode):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:mission`
 *
 * Defer: positive claim path (track mission progress qua breakthrough /
 * clear-dungeon / boss-hit gameplay event đến `currentAmount >= goalAmount`
 * → POST /missions/claim → ledger applyTx LINH_THACH+TIEN_NGOC+exp +
 * inventory.grantTx + atomic CAS update claimed=true → idempotent retry
 * → ALREADY_CLAIMED 409) yêu cầu gameplay automation hoặc admin
 * `mission.track` seed → defer cho future smoke. Tương tự ALREADY_CLAIMED
 * 409 (claim 2 lần liên tiếp, atomic guard `updateMany count !== 1`)
 * cũng defer.
 *
 * Exit code:
 *   0 — toàn bộ invariant OK.
 *   1 — ít nhất 1 invariant fail.
 *
 * Zero-install: chỉ dùng native fetch từ Node 20+.
 */

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const BASE = (process.env.SMOKE_API_BASE ?? 'http://localhost:3000').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);
const VERBOSE = process.env.SMOKE_VERBOSE === '1';
const SECT_KEY = process.env.SMOKE_SECT_KEY ?? 'thanh_van';
const MISSION_KEY = process.env.SMOKE_MISSION_KEY ?? 'once_first_breakthrough';

// -----------------------------------------------------------------------------
// Cookie jar.
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
 * @param {() => Promise<void>} fn
 */
async function step(name, fn) {
  process.stdout.write(`[smoke:mission] ${name} ... `);
  try {
    await fn();
    console.log('OK');
    results.push({ name, ok: true });
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

/**
 * @param {{ status: number; body: any }} r
 * @param {string} expectedCode
 * @param {string} label
 */
function assertErrorCode(r, expectedCode, label) {
  const code = r.body?.error?.code;
  if (code !== expectedCode) {
    throw new Error(
      `${label}: expect error.code='${expectedCode}', got '${code}'. Body: ${JSON.stringify(r.body).slice(0, 300)}`,
    );
  }
}

// -----------------------------------------------------------------------------
// Helpers random.
// -----------------------------------------------------------------------------

function randomEmail() {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `smoke-mission-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `mis_${rand}`;
}

function randomNonexistentKey() {
  const rand = Math.random().toString(36).slice(2, 12);
  return `nonexist_${rand}`;
}

/** @returns {Promise<{linhThach: string; tienNgoc: number}>} */
async function fetchCharCurrencies() {
  const r = await http('/api/character/state');
  assertStatus(r, 200, 'GET /character/state snapshot');
  const c = r.body?.data?.character;
  assert(c, 'GET /character/state: missing character');
  return {
    linhThach: String(c.linhThach),
    tienNgoc: Number(c.tienNgoc),
  };
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

async function main() {
  console.log(
    `[smoke:mission] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}, missionKey = ${MISSION_KEY}`,
  );

  // 1. GET /missions/me chưa auth → 401.
  await step('GET /missions/me — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/missions/me');
    assertStatus(r, 401, 'GET /missions/me unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'GET /missions/me unauth');
  });

  // 2. POST /missions/claim chưa auth → 401.
  await step('POST /missions/claim — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/missions/claim', {
      method: 'POST',
      body: { missionKey: MISSION_KEY },
    });
    assertStatus(r, 401, 'POST /missions/claim unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'POST /missions/claim unauth');
  });

  // 3. Register fresh user.
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

  // 4. GET /missions/me pre-onboard → 404 NO_CHARACTER.
  await step('GET /missions/me — pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/missions/me');
    assertStatus(r, 404, 'GET /missions/me pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'GET /missions/me pre-onboard');
  });

  // 5. POST /missions/claim ({}) → 400 INVALID_INPUT (zod missing missionKey).
  await step('POST /missions/claim — ({}) 400 INVALID_INPUT', async () => {
    const r = await http('/api/missions/claim', { method: 'POST', body: {} });
    assertStatus(r, 400, 'POST /missions/claim ({})');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /missions/claim ({})');
  });

  // 6. POST /missions/claim ({missionKey:''}) → 400 INVALID_INPUT (zod min(1)).
  await step("POST /missions/claim — ({missionKey:''}) 400 INVALID_INPUT", async () => {
    const r = await http('/api/missions/claim', {
      method: 'POST',
      body: { missionKey: '' },
    });
    assertStatus(r, 400, "POST /missions/claim ({missionKey:''})");
    assertErrorCode(r, 'INVALID_INPUT', "POST /missions/claim ({missionKey:''})");
  });

  // 7. POST /missions/claim ({missionKey: 81*'X'}) → 400 INVALID_INPUT (zod max(80)).
  await step('POST /missions/claim — ({missionKey: 81 chars}) 400 INVALID_INPUT', async () => {
    const r = await http('/api/missions/claim', {
      method: 'POST',
      body: { missionKey: 'X'.repeat(81) },
    });
    assertStatus(r, 400, 'POST /missions/claim ({missionKey: 81 chars})');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /missions/claim ({missionKey: 81 chars})');
  });

  // 8. POST /missions/claim ({missionKey: invalid}) pre-onboard
  //    → 404 MISSION_UNKNOWN (service catalog check trước char check).
  await step('POST /missions/claim — ({missionKey: invalid}) pre-onboard 404 MISSION_UNKNOWN', async () => {
    const key = randomNonexistentKey();
    const r = await http('/api/missions/claim', {
      method: 'POST',
      body: { missionKey: key },
    });
    assertStatus(r, 404, `POST /missions/claim ({missionKey: ${key}}) pre-onboard`);
    assertErrorCode(r, 'MISSION_UNKNOWN', `POST /missions/claim ({missionKey: ${key}}) pre-onboard`);
  });

  // 9. POST /missions/claim ({missionKey: valid}) pre-onboard
  //    → 404 NO_CHARACTER (key qua catalog → char check fail).
  await step('POST /missions/claim — ({missionKey: valid}) pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/missions/claim', {
      method: 'POST',
      body: { missionKey: MISSION_KEY },
    });
    assertStatus(r, 404, `POST /missions/claim ({missionKey: ${MISSION_KEY}}) pre-onboard`);
    assertErrorCode(r, 'NO_CHARACTER', `POST /missions/claim ({missionKey: ${MISSION_KEY}}) pre-onboard`);
  });

  // 10. Onboard character.
  /** @type {string} */
  let myCharName;
  await step('onboard — create character', async () => {
    myCharName = randomCharName();
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: myCharName, sectKey: SECT_KEY },
    });
    assertStatus(r, 200, 'onboard');
    if (!r.body?.ok)
      throw new Error(`onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.character?.id, 'onboard: missing character.id');
  });

  // 11. GET /missions/me post-onboard → 200 missions array shape.
  await step('GET /missions/me — post-onboard 200 missions[]', async () => {
    const r = await http('/api/missions/me');
    assertStatus(r, 200, 'GET /missions/me post-onboard');
    if (!r.body?.ok)
      throw new Error(`GET /missions/me: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const missions = r.body?.data?.missions;
    assert(Array.isArray(missions), 'GET /missions/me: missions not array');
    assert(missions.length >= 1, `GET /missions/me: missions.length >= 1, got ${missions.length}`);
    // Verify mission shape — pick first row.
    const first = missions[0];
    assert(typeof first.key === 'string' && first.key.length > 0, 'mission.key string');
    assert(typeof first.name === 'string', 'mission.name string');
    assert(typeof first.period === 'string', 'mission.period string');
    assert(typeof first.goalKind === 'string', 'mission.goalKind string');
    assert(typeof first.goalAmount === 'number', 'mission.goalAmount number');
    assert(typeof first.currentAmount === 'number', 'mission.currentAmount number');
    assert(typeof first.claimed === 'boolean', 'mission.claimed boolean');
    assert(typeof first.completable === 'boolean', 'mission.completable boolean');
    // Find configured MISSION_KEY và verify fresh char state.
    const target = missions.find((m) => m.key === MISSION_KEY);
    assert(target, `GET /missions/me: missionKey '${MISSION_KEY}' not in catalog`);
    assert(
      target.currentAmount === 0,
      `mission '${MISSION_KEY}': fresh char currentAmount=0, got ${target.currentAmount}`,
    );
    assert(
      target.claimed === false,
      `mission '${MISSION_KEY}': fresh char claimed=false, got ${target.claimed}`,
    );
    assert(
      target.completable === false,
      `mission '${MISSION_KEY}': fresh char completable=false (currentAmount<goalAmount), got ${target.completable}`,
    );
  });

  // Snapshot currency BEFORE failed claim attempts (anti-FE-self-grant).
  const before = await fetchCharCurrencies();

  // 12. POST /missions/claim ({missionKey: valid}) post-onboard fresh char
  //     → 409 NOT_READY (chưa có progress).
  await step('POST /missions/claim — ({missionKey: valid}) post-onboard fresh 409 NOT_READY', async () => {
    const r = await http('/api/missions/claim', {
      method: 'POST',
      body: { missionKey: MISSION_KEY },
    });
    assertStatus(r, 409, `POST /missions/claim ({missionKey: ${MISSION_KEY}}) fresh`);
    assertErrorCode(r, 'NOT_READY', `POST /missions/claim ({missionKey: ${MISSION_KEY}}) fresh`);
  });

  // 13. Anti-FE-self-grant: currency unchanged sau failed claim attempt.
  await step('anti-FE-self-grant — currency unchanged sau failed claim', async () => {
    const after = await fetchCharCurrencies();
    assert(
      after.linhThach === before.linhThach,
      `linhThach VẪN ${before.linhThach} sau failed claim, got ${after.linhThach}`,
    );
    assert(
      after.tienNgoc === before.tienNgoc,
      `tienNgoc VẪN ${before.tienNgoc} sau failed claim, got ${after.tienNgoc}`,
    );
  });

  // 14. logout + GET /me + POST /claim → 401.
  await step('logout + GET /missions/me + POST /missions/claim — 401 UNAUTHENTICATED', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const me = await http('/api/missions/me');
    assertStatus(me, 401, 'GET /missions/me post-logout');
    assertErrorCode(me, 'UNAUTHENTICATED', 'GET /missions/me post-logout');
    const claim = await http('/api/missions/claim', {
      method: 'POST',
      body: { missionKey: MISSION_KEY },
    });
    assertStatus(claim, 401, 'POST /missions/claim post-logout');
    assertErrorCode(claim, 'UNAUTHENTICATED', 'POST /missions/claim post-logout');
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:mission] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:mission] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:mission] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:mission] unexpected error:', err);
  process.exitCode = 1;
});
