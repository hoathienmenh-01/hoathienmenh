#!/usr/bin/env node
/**
 * smoke-achievement.mjs — Achievement state + claim endpoints smoke cho
 * Xuân Tôi.
 *
 * Negative-path-only — positive claim path yêu cầu progress tracked đến
 * completed (`completedAt != null`) qua gameplay event như kill monster /
 * boss / breakthrough / spec elemental cultivate gain → defer cho future
 * smoke với gameplay automation hoặc admin `achievement.incrementProgress`
 * seed. Tương tự ALREADY_CLAIMED 409 (claim 2 lần liên tiếp, atomic CAS
 * `where { id, claimedAt: null }`) cũng defer.
 *
 * Mục tiêu: cover 2 achievement endpoints qua HTTP — nằm trong
 * `apps/api/src/modules/character` (Phase 11.10.E + 11.10.C-1):
 *   - `GET  /api/character/achievements`        — list state (read-only,
 *                                                 idempotent).
 *   - `POST /api/character/achievement/claim`   — atomic CAS claim với
 *                                                 ledger applyTx + title
 *                                                 unlock + item grant.
 *
 * Verify auth gate (401 unauth × 2), zod validation (400 INVALID_INPUT
 * cho achievementKey missing/empty/>64 chars), controller order
 * (zod → char → service: pre-onboard với valid key → NO_CHARACTER 404,
 * KHÔNG phải ACHIEVEMENT_NOT_FOUND — vì controller `findByUser` check
 * char *trước* khi gọi `claimReward`), NO_CHARACTER 404 fallback (cho
 * /achievements và /achievement/claim valid key pre-onboard),
 * ACHIEVEMENT_NOT_FOUND 404 (key không trong shared catalog
 * `ACHIEVEMENTS`), NOT_FOUND_PROGRESS 404 (fresh char chưa từng track
 * row qua `incrementProgress` cho key đó), shape contract cho /achievements
 * post-onboard (achievementKey/progress/completedAt/claimedAt/def với
 * hidden anti-spoil filter), và anti-FE-self-grant invariant (failed
 * claim attempts KHÔNG đụng linhThach/tienNgoc).
 *
 * 14-step:
 *   1. `GET  /api/character/achievements`     (no auth)             → 401.
 *   2. `POST /api/character/achievement/claim`(no auth)             → 401.
 *   3. `POST /api/_auth/register`                                   — fresh
 *                                                                   user.
 *   4. `GET  /api/character/achievements`     (pre-onboard)         → 404
 *                                                                   NO_CHARACTER.
 *   5. `POST /api/character/achievement/claim`({})                  → 400
 *                                                                   INVALID_INPUT
 *                                                                   (zod
 *                                                                   missing
 *                                                                   achievementKey).
 *   6. `POST /api/character/achievement/claim`({achievementKey:''}) → 400
 *                                                                   INVALID_INPUT
 *                                                                   (zod
 *                                                                   min(1)).
 *   7. `POST /api/character/achievement/claim`({achievementKey:
 *                                              65*'X'})             → 400
 *                                                                   INVALID_INPUT
 *                                                                   (zod
 *                                                                   max(64)).
 *   8. `POST /api/character/achievement/claim`({achievementKey:
 *                                              'first_monster_kill'})
 *                                              (pre-onboard)        → 404
 *                                                                   NO_CHARACTER
 *                                                                   (controller
 *                                                                   char
 *                                                                   check
 *                                                                   trước
 *                                                                   service
 *                                                                   catalog
 *                                                                   check).
 *   9. `POST /api/character/onboard`                                — fresh
 *                                                                   char.
 *  10. `GET  /api/character/achievements`     (post-onboard)        → 200
 *                                                                   achievements
 *                                                                   array
 *                                                                   shape +
 *                                                                   fresh
 *                                                                   char
 *                                                                   progress=0
 *                                                                   /completedAt=null
 *                                                                   /claimedAt=null
 *                                                                   cho
 *                                                                   non-hidden
 *                                                                   achievement.
 *  11. `POST /api/character/achievement/claim`({achievementKey:
 *                                              'invalid'})          → 404
 *                                                                   ACHIEVEMENT_NOT_FOUND
 *                                                                   (post-
 *                                                                   onboard,
 *                                                                   service
 *                                                                   `getAchievementDef`
 *                                                                   returns
 *                                                                   undefined).
 *  12. `POST /api/character/achievement/claim`({achievementKey:
 *                                              'first_monster_kill'})
 *                                              (fresh char)         → 404
 *                                                                   NOT_FOUND_PROGRESS
 *                                                                   (service
 *                                                                   findUnique
 *                                                                   returns
 *                                                                   null
 *                                                                   vì chưa
 *                                                                   incrementProgress).
 *  13. `anti-FE-self-grant` snapshot currency before/after fail attempts
 *                                                                   → linhThach
 *                                                                   /tienNgoc
 *                                                                   KHÔNG
 *                                                                   đụng.
 *  14. `POST /api/_auth/logout` + GET /achievements + POST /claim   → 401.
 *
 * Chạy:
 *   pnpm smoke:achievement
 *   # hoặc trực tiếp:
 *   node scripts/smoke-achievement.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE          — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS        — default 10000ms / request.
 *   SMOKE_VERBOSE           — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY          — default "thanh_van".
 *   SMOKE_ACHIEVEMENT_KEY   — default "first_monster_kill" (key tồn tại
 *                             trong `packages/shared/src/achievements.ts`
 *                             không hidden, chưa completed bởi fresh char).
 *
 * Yêu cầu môi trường (giống smoke:mission):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:achievement`
 *
 * Defer:
 *   - Positive claim path (track progress qua gameplay event đến completed
 *     → POST /achievement/claim → ledger applyTx LINH_THACH+TIEN_NGOC+exp
 *     + InventoryService.grantTx + title unlock → idempotent retry →
 *     ALREADY_CLAIMED 409 atomic CAS guard `claimedAt: null`).
 *   - NOT_COMPLETED 409 (row tồn tại nhưng `completedAt === null`).
 *   - ALREADY_CLAIMED 409 (đã claim 1 lần, claim lại fire CAS guard).
 *   Tất cả yêu cầu admin `achievement.incrementProgress` seed hoặc
 *   gameplay automation → defer.
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
const ACHIEVEMENT_KEY = process.env.SMOKE_ACHIEVEMENT_KEY ?? 'first_monster_kill';

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
  process.stdout.write(`[smoke:achievement] ${name} ... `);
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
  return `smoke-ach-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `ach_${rand}`;
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
    `[smoke:achievement] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}, achievementKey = ${ACHIEVEMENT_KEY}`,
  );

  // 1. GET /character/achievements chưa auth → 401.
  await step('GET /character/achievements — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/character/achievements');
    assertStatus(r, 401, 'GET /character/achievements unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'GET /character/achievements unauth');
  });

  // 2. POST /character/achievement/claim chưa auth → 401.
  await step('POST /character/achievement/claim — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/character/achievement/claim', {
      method: 'POST',
      body: { achievementKey: ACHIEVEMENT_KEY },
    });
    assertStatus(r, 401, 'POST /character/achievement/claim unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'POST /character/achievement/claim unauth');
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

  // 4. GET /character/achievements pre-onboard → 404 NO_CHARACTER.
  await step('GET /character/achievements — pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/character/achievements');
    assertStatus(r, 404, 'GET /character/achievements pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'GET /character/achievements pre-onboard');
  });

  // 5. POST /character/achievement/claim ({}) → 400 INVALID_INPUT (zod missing).
  await step('POST /character/achievement/claim — ({}) 400 INVALID_INPUT', async () => {
    const r = await http('/api/character/achievement/claim', { method: 'POST', body: {} });
    assertStatus(r, 400, 'POST /character/achievement/claim ({})');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /character/achievement/claim ({})');
  });

  // 6. POST /character/achievement/claim ({achievementKey:''}) → 400 INVALID_INPUT (zod min(1)).
  await step("POST /character/achievement/claim — ({achievementKey:''}) 400 INVALID_INPUT", async () => {
    const r = await http('/api/character/achievement/claim', {
      method: 'POST',
      body: { achievementKey: '' },
    });
    assertStatus(r, 400, "POST /character/achievement/claim ({achievementKey:''})");
    assertErrorCode(r, 'INVALID_INPUT', "POST /character/achievement/claim ({achievementKey:''})");
  });

  // 7. POST /character/achievement/claim ({achievementKey: 65*'X'}) → 400 INVALID_INPUT (zod max(64)).
  await step('POST /character/achievement/claim — ({achievementKey: 65 chars}) 400 INVALID_INPUT', async () => {
    const r = await http('/api/character/achievement/claim', {
      method: 'POST',
      body: { achievementKey: 'X'.repeat(65) },
    });
    assertStatus(r, 400, 'POST /character/achievement/claim ({achievementKey: 65 chars})');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /character/achievement/claim ({achievementKey: 65 chars})');
  });

  // 8. POST /character/achievement/claim ({achievementKey: valid}) pre-onboard
  //    → 404 NO_CHARACTER (controller `findByUser` check char *trước* khi gọi service).
  await step('POST /character/achievement/claim — ({achievementKey: valid}) pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/character/achievement/claim', {
      method: 'POST',
      body: { achievementKey: ACHIEVEMENT_KEY },
    });
    assertStatus(r, 404, `POST /character/achievement/claim ({achievementKey: ${ACHIEVEMENT_KEY}}) pre-onboard`);
    assertErrorCode(
      r,
      'NO_CHARACTER',
      `POST /character/achievement/claim ({achievementKey: ${ACHIEVEMENT_KEY}}) pre-onboard`,
    );
  });

  // 9. Onboard character.
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

  // 10. GET /character/achievements post-onboard → 200 achievements array shape.
  await step('GET /character/achievements — post-onboard 200 achievements[]', async () => {
    const r = await http('/api/character/achievements');
    assertStatus(r, 200, 'GET /character/achievements post-onboard');
    if (!r.body?.ok)
      throw new Error(`GET /character/achievements: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const achievements = r.body?.data?.achievements;
    assert(Array.isArray(achievements), 'GET /character/achievements: achievements not array');
    assert(
      achievements.length >= 1,
      `GET /character/achievements: achievements.length >= 1, got ${achievements.length}`,
    );
    // Verify shape — pick first row.
    const first = achievements[0];
    assert(typeof first.achievementKey === 'string' && first.achievementKey.length > 0, 'achievement.achievementKey string');
    assert(typeof first.progress === 'number', 'achievement.progress number');
    // completedAt + claimedAt are ISO string OR null.
    assert(
      first.completedAt === null || typeof first.completedAt === 'string',
      'achievement.completedAt null|string',
    );
    assert(
      first.claimedAt === null || typeof first.claimedAt === 'string',
      'achievement.claimedAt null|string',
    );
    assert(typeof first.def === 'object' && first.def !== null, 'achievement.def object');
    // Find configured ACHIEVEMENT_KEY và verify fresh char state.
    const target = achievements.find((a) => a.achievementKey === ACHIEVEMENT_KEY);
    assert(target, `GET /character/achievements: achievementKey '${ACHIEVEMENT_KEY}' not in catalog (or hidden uncompleted)`);
    assert(
      target.progress === 0,
      `achievement '${ACHIEVEMENT_KEY}': fresh char progress=0, got ${target.progress}`,
    );
    assert(
      target.completedAt === null,
      `achievement '${ACHIEVEMENT_KEY}': fresh char completedAt=null, got ${target.completedAt}`,
    );
    assert(
      target.claimedAt === null,
      `achievement '${ACHIEVEMENT_KEY}': fresh char claimedAt=null, got ${target.claimedAt}`,
    );
  });

  // Snapshot currency BEFORE failed claim attempts (anti-FE-self-grant).
  const before = await fetchCharCurrencies();

  // 11. POST /character/achievement/claim ({achievementKey: invalid}) post-onboard
  //     → 404 ACHIEVEMENT_NOT_FOUND (service `getAchievementDef(key)` returns undefined).
  await step('POST /character/achievement/claim — ({achievementKey: invalid}) post-onboard 404 ACHIEVEMENT_NOT_FOUND', async () => {
    const key = randomNonexistentKey();
    const r = await http('/api/character/achievement/claim', {
      method: 'POST',
      body: { achievementKey: key },
    });
    assertStatus(r, 404, `POST /character/achievement/claim ({achievementKey: ${key}}) post-onboard`);
    assertErrorCode(
      r,
      'ACHIEVEMENT_NOT_FOUND',
      `POST /character/achievement/claim ({achievementKey: ${key}}) post-onboard`,
    );
  });

  // 12. POST /character/achievement/claim ({achievementKey: valid}) fresh char
  //     → 404 NOT_FOUND_PROGRESS (service findUnique returns null vì chưa incrementProgress).
  await step('POST /character/achievement/claim — ({achievementKey: valid}) post-onboard fresh 404 NOT_FOUND_PROGRESS', async () => {
    const r = await http('/api/character/achievement/claim', {
      method: 'POST',
      body: { achievementKey: ACHIEVEMENT_KEY },
    });
    assertStatus(r, 404, `POST /character/achievement/claim ({achievementKey: ${ACHIEVEMENT_KEY}}) fresh`);
    assertErrorCode(
      r,
      'NOT_FOUND_PROGRESS',
      `POST /character/achievement/claim ({achievementKey: ${ACHIEVEMENT_KEY}}) fresh`,
    );
  });

  // 13. Anti-FE-self-grant: currency unchanged sau failed claim attempts.
  await step('anti-FE-self-grant — currency unchanged sau failed claim attempts', async () => {
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

  // 14. logout + GET /achievements + POST /claim → 401.
  await step('logout + GET /character/achievements + POST /character/achievement/claim — 401 UNAUTHENTICATED', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const me = await http('/api/character/achievements');
    assertStatus(me, 401, 'GET /character/achievements post-logout');
    assertErrorCode(me, 'UNAUTHENTICATED', 'GET /character/achievements post-logout');
    const claim = await http('/api/character/achievement/claim', {
      method: 'POST',
      body: { achievementKey: ACHIEVEMENT_KEY },
    });
    assertStatus(claim, 401, 'POST /character/achievement/claim post-logout');
    assertErrorCode(claim, 'UNAUTHENTICATED', 'POST /character/achievement/claim post-logout');
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:achievement] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:achievement] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:achievement] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:achievement] unexpected error:', err);
  process.exitCode = 1;
});
