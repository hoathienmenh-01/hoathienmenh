#!/usr/bin/env node
/**
 * smoke-daily-login.mjs — Daily login claim state machine smoke cho Xuân Tôi.
 *
 * Mục tiêu: cover daily-login endpoints qua HTTP — đây là smoke đầu tiên
 * cho non-character module sau khi character module HTTP smoke gap đóng hết
 * (cultivate #359 / breakthrough #361 / spiritual-root #362 / cultivation-method
 * #363 / skill #364). Verify status idempotency, claim một-lần-mỗi-ngày
 * idempotency, ledger applyTx delta đúng (server-authoritative balance), và
 * anti-FE-self-grant invariant (failed idempotent claim KHÔNG mutate streak /
 * balance / canClaimToday).
 *
 *   1. `GET  /api/daily-login/me` (no auth)          → 401.
 *   2. `POST /api/daily-login/claim` (no auth)       → 401.
 *   3. `POST /api/_auth/register`                    — fresh user.
 *   4. `GET  /api/daily-login/me` (no char)          → 404 NO_CHARACTER.
 *   5. `POST /api/daily-login/claim` (no char)       → 404 NO_CHARACTER.
 *   6. `POST /api/character/onboard`                 — fresh char.
 *   7. `GET  /api/daily-login/me`                    → 200, canClaimToday
 *                                                      =true,
 *                                                      currentStreak=0,
 *                                                      todayDateLocal
 *                                                      khớp regex
 *                                                      `^\d{4}-\d{2}-\d{2}$`,
 *                                                      nextRewardLinhThach
 *                                                      ='100'.
 *   8. `GET  /api/character/state`                   — snapshot
 *                                                      linhThach (= '0'
 *                                                      cho fresh char).
 *   9. `POST /api/daily-login/claim`                 → 200, claimed
 *                                                      =true,
 *                                                      linhThachDelta
 *                                                      ='100', newStreak
 *                                                      =1, claimDateLocal
 *                                                      = todayDateLocal.
 *  10. `GET  /api/daily-login/me`                    → canClaimToday
 *                                                      =false,
 *                                                      currentStreak=1,
 *                                                      todayDateLocal
 *                                                      KHÔNG đổi.
 *  11. `GET  /api/character/state`                   — character.linhThach
 *                                                      = '100'
 *                                                      (server-authoritative
 *                                                      balance đã tăng
 *                                                      qua CurrencyService
 *                                                      .applyTx —
 *                                                      verify ledger
 *                                                      thật).
 *  12. `POST /api/daily-login/claim` (lần 2)         → 200, claimed
 *                                                      =false
 *                                                      (idempotent),
 *                                                      linhThachDelta
 *                                                      ='0', newStreak
 *                                                      =1 preserved.
 *  13. `POST /api/daily-login/claim` (lần 3)         → 200, claimed
 *                                                      =false, anti
 *                                                      -double-spend.
 *  14. `GET  /api/daily-login/me`                    — state unchanged
 *                                                      sau 2 idempotent
 *                                                      claim.
 *  15. `GET  /api/character/state`                   — linhThach VẪN
 *                                                      '100' (failed
 *                                                      idempotent claim
 *                                                      KHÔNG cộng tiền
 *                                                      thêm — anti
 *                                                      -FE-self-grant).
 *  16. `POST /api/_auth/logout` user 1 + register user 2 + onboard.
 *  17. (gộp vào 16) onboard user 2.
 *  18. Snapshot player 2 jar + `POST /api/_auth/login` admin → swap jar.
 *  19. `POST /api/admin/users/:id/seed-daily-login-streak` { days: 6 }
 *                                                  → 200 ok, rowsCreated=6,
 *                                                  previousRowCount=0,
 *                                                  newStreakWillBe=7.
 *  20. `GET  /api/admin/audit?action=admin.daily_login.seed`
 *                                                  → row >= 1.
 *  21. seed-daily-login-streak lần 2 idempotent     → rowsCreated=0,
 *                                                  previousRowCount=6
 *                                                  (P2002 skip).
 *  22. admin logout + restore player 2 jar.
 *  23. `GET  /api/daily-login/me`                   → currentStreak=6,
 *                                                  canClaimToday=true
 *                                                  (yesterday claim →
 *                                                  chain).
 *  24. `POST /api/daily-login/claim`                → claimed=true,
 *                                                  newStreak=7,
 *                                                  delta=100.
 *  25. `GET  /api/character/state`                  → linhThach='100'
 *                                                  (admin seed delta=0
 *                                                  → only today's claim
 *                                                  cộng tiền — anti
 *                                                  -FE-self-grant).
 *  26. `POST /api/_auth/logout` + GET /me           → 401.
 *
 * Anti-FE-self-grant invariant (per Luật bắt buộc — KHÔNG để FE tự cộng
 * tiền/streak qua double-claim):
 *   - `currentStreak` KHÔNG đổi qua idempotent claim (P2002 unique constraint
 *     guard).
 *   - `canClaimToday` vẫn = false sau idempotent claim.
 *   - `todayDateLocal` KHÔNG đổi (deterministic theo `MISSION_RESET_TZ`).
 *   - `character.linhThach` KHÔNG đổi qua idempotent claim — verify ledger
 *     applyTx KHÔNG được gọi 2 lần cho cùng characterId+claimDateLocal.
 *   - admin seedDailyLoginStreak KHÔNG cộng tiền (delta=0 cho mọi historical
 *     row) — chỉ today's claim cộng 100 LT qua CurrencyService.applyTx.
 *
 * Chạy:
 *   pnpm smoke:daily-login
 *   # hoặc trực tiếp:
 *   node scripts/smoke-daily-login.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE       — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS     — default 10000ms / request.
 *   SMOKE_VERBOSE        — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY       — default "thanh_van".
 *   SMOKE_ADMIN_EMAIL    — default "admin@example.com" (bootstrap admin
 *                          từ INITIAL_ADMIN_EMAIL).
 *   SMOKE_ADMIN_PASSWORD — default "change-me-bootstrap-pass".
 *
 * Yêu cầu môi trường (giống smoke:skill):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api bootstrap` (seed 3 sect)
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:daily-login`
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
const EXPECTED_REWARD = '100'; // DAILY_LOGIN_LINH_THACH = 100n.
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'change-me-bootstrap-pass';
const SEED_DAYS = 6;

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

/** Snapshot toàn bộ jar (cho admin/player swap). @returns {Map<string,string>} */
function snapshotCookies() {
  return new Map(cookieJar);
}

/** Restore jar từ snapshot (clear current + replay). @param {Map<string,string>} snap */
function restoreCookies(snap) {
  cookieJar.clear();
  for (const [k, v] of snap) cookieJar.set(k, v);
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
  process.stdout.write(`[smoke:daily-login] ${name} ... `);
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
  return `smoke-daily-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `dl_${rand}`;
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

async function main() {
  console.log(
    `[smoke:daily-login] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}, expected reward = ${EXPECTED_REWARD} LinhThach`,
  );

  // 1. GET /me chưa auth → 401.
  await step('GET /daily-login/me — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/daily-login/me');
    assertStatus(r, 401, 'GET /me unauth');
    assert(
      r.body?.error?.code === 'UNAUTHENTICATED',
      `GET /me unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`,
    );
  });

  // 2. POST /claim chưa auth → 401.
  await step('POST /daily-login/claim — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/daily-login/claim', { method: 'POST' });
    assertStatus(r, 401, 'POST /claim unauth');
    assert(
      r.body?.error?.code === 'UNAUTHENTICATED',
      `POST /claim unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`,
    );
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

  // 4. GET /me khi chưa onboard → 404 NO_CHARACTER.
  await step('GET /daily-login/me — 404 NO_CHARACTER khi chưa onboard', async () => {
    const r = await http('/api/daily-login/me');
    assertStatus(r, 404, 'GET /me no-char');
    assert(
      r.body?.error?.code === 'NO_CHARACTER',
      `GET /me no-char: expect code NO_CHARACTER, got ${r.body?.error?.code}`,
    );
  });

  // 5. POST /claim khi chưa onboard → 404 NO_CHARACTER.
  await step('POST /daily-login/claim — 404 NO_CHARACTER khi chưa onboard', async () => {
    const r = await http('/api/daily-login/claim', { method: 'POST' });
    assertStatus(r, 404, 'POST /claim no-char');
    assert(
      r.body?.error?.code === 'NO_CHARACTER',
      `POST /claim no-char: expect code NO_CHARACTER, got ${r.body?.error?.code}`,
    );
  });

  // 6. Onboard character.
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

  // 7. GET /me → 200, canClaimToday=true, currentStreak=0, todayDateLocal
  //    YYYY-MM-DD, nextRewardLinhThach='100'.
  /** @type {string} */
  let todayDateLocal;
  await step('GET /daily-login/me — fresh char canClaimToday=true, streak=0, reward=100', async () => {
    const r = await http('/api/daily-login/me');
    assertStatus(r, 200, 'GET /me first');
    if (!r.body?.ok)
      throw new Error(`GET /me first: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const d = r.body?.data;
    assert(d, 'GET /me first: missing data');
    assert(d.canClaimToday === true, `GET /me first: expect canClaimToday=true, got ${d.canClaimToday}`);
    assert(d.currentStreak === 0, `GET /me first: expect currentStreak=0, got ${d.currentStreak}`);
    assert(typeof d.todayDateLocal === 'string', `GET /me first: todayDateLocal phải string, got ${typeof d.todayDateLocal}`);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(d.todayDateLocal), `GET /me first: todayDateLocal phải khớp YYYY-MM-DD, got ${d.todayDateLocal}`);
    assert(
      d.nextRewardLinhThach === EXPECTED_REWARD,
      `GET /me first: expect nextRewardLinhThach='${EXPECTED_REWARD}', got '${d.nextRewardLinhThach}'`,
    );
    todayDateLocal = d.todayDateLocal;
  });

  // 8. GET /character/state — snapshot linhThach trước claim.
  /** @type {string} */
  let linhThachBefore;
  await step('GET /character/state — snapshot linhThach trước claim', async () => {
    const r = await http('/api/character/state');
    assertStatus(r, 200, 'GET /state pre-claim');
    if (!r.body?.ok)
      throw new Error(
        `GET /state pre-claim: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`,
      );
    const c = r.body?.data?.character;
    assert(c, 'GET /state pre-claim: missing character');
    assert(typeof c.linhThach === 'string', `GET /state pre-claim: linhThach phải string, got ${typeof c.linhThach}`);
    linhThachBefore = c.linhThach;
  });

  // 9. POST /claim lần đầu → 200, claimed=true, delta='100', newStreak=1.
  await step('POST /daily-login/claim — lần 1 claimed=true delta=100 streak=1', async () => {
    const r = await http('/api/daily-login/claim', { method: 'POST' });
    assertStatus(r, 200, 'POST /claim first');
    if (!r.body?.ok)
      throw new Error(
        `POST /claim first: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`,
      );
    const d = r.body?.data;
    assert(d, 'POST /claim first: missing data');
    assert(d.claimed === true, `POST /claim first: expect claimed=true, got ${d.claimed}`);
    assert(
      d.linhThachDelta === EXPECTED_REWARD,
      `POST /claim first: expect delta='${EXPECTED_REWARD}', got '${d.linhThachDelta}'`,
    );
    assert(d.newStreak === 1, `POST /claim first: expect newStreak=1, got ${d.newStreak}`);
    assert(
      d.claimDateLocal === todayDateLocal,
      `POST /claim first: expect claimDateLocal='${todayDateLocal}', got '${d.claimDateLocal}'`,
    );
  });

  // 10. GET /me sau claim → canClaimToday=false, currentStreak=1.
  await step('GET /daily-login/me — sau claim canClaimToday=false streak=1', async () => {
    const r = await http('/api/daily-login/me');
    assertStatus(r, 200, 'GET /me post-claim');
    const d = r.body?.data;
    assert(d.canClaimToday === false, `GET /me post-claim: expect canClaimToday=false, got ${d.canClaimToday}`);
    assert(d.currentStreak === 1, `GET /me post-claim: expect currentStreak=1, got ${d.currentStreak}`);
    assert(
      d.todayDateLocal === todayDateLocal,
      `GET /me post-claim: todayDateLocal đổi unexpected, before='${todayDateLocal}' after='${d.todayDateLocal}'`,
    );
  });

  // 11. GET /character/state — linhThach += 100 (server-authoritative ledger
  //     applyTx đã cộng 100 LT qua transaction).
  await step('GET /character/state — linhThach += 100 (ledger applyTx server-authoritative)', async () => {
    const r = await http('/api/character/state');
    assertStatus(r, 200, 'GET /state post-claim');
    const c = r.body?.data?.character;
    const expectedAfter = (BigInt(linhThachBefore) + BigInt(EXPECTED_REWARD)).toString();
    assert(
      c.linhThach === expectedAfter,
      `GET /state post-claim: expect linhThach='${expectedAfter}' (before='${linhThachBefore}' + reward='${EXPECTED_REWARD}'), got '${c.linhThach}'`,
    );
  });

  // 12. POST /claim lần 2 cùng ngày → 200, claimed=false (idempotent),
  //     linhThachDelta='0', newStreak=1 preserved.
  await step('POST /daily-login/claim — lần 2 idempotent claimed=false delta=0', async () => {
    const r = await http('/api/daily-login/claim', { method: 'POST' });
    assertStatus(r, 200, 'POST /claim second');
    const d = r.body?.data;
    assert(d.claimed === false, `POST /claim second: expect claimed=false, got ${d.claimed}`);
    assert(d.linhThachDelta === '0', `POST /claim second: expect delta='0', got '${d.linhThachDelta}'`);
    assert(d.newStreak === 1, `POST /claim second: expect newStreak=1 preserved, got ${d.newStreak}`);
    assert(
      d.claimDateLocal === todayDateLocal,
      `POST /claim second: claimDateLocal đổi unexpected, expect '${todayDateLocal}', got '${d.claimDateLocal}'`,
    );
  });

  // 13. POST /claim lần 3 cùng ngày → 200, claimed=false (anti-double-spend
  //     repeated).
  await step('POST /daily-login/claim — lần 3 anti-double-spend', async () => {
    const r = await http('/api/daily-login/claim', { method: 'POST' });
    assertStatus(r, 200, 'POST /claim third');
    const d = r.body?.data;
    assert(d.claimed === false, `POST /claim third: expect claimed=false, got ${d.claimed}`);
    assert(d.linhThachDelta === '0', `POST /claim third: expect delta='0', got '${d.linhThachDelta}'`);
    assert(d.newStreak === 1, `POST /claim third: expect newStreak=1, got ${d.newStreak}`);
  });

  // 14. GET /me — state KHÔNG đổi sau 2 idempotent claim (anti-FE-grant
  //     status invariant).
  await step('GET /daily-login/me — state unchanged sau 2 idempotent claim', async () => {
    const r = await http('/api/daily-login/me');
    assertStatus(r, 200, 'GET /me post-idempotent');
    const d = r.body?.data;
    assert(d.canClaimToday === false, `GET /me post-idempotent: canClaimToday=false unchanged, got ${d.canClaimToday}`);
    assert(d.currentStreak === 1, `GET /me post-idempotent: currentStreak=1 unchanged, got ${d.currentStreak}`);
    assert(
      d.todayDateLocal === todayDateLocal,
      `GET /me post-idempotent: todayDateLocal unchanged, expect '${todayDateLocal}', got '${d.todayDateLocal}'`,
    );
  });

  // 15. GET /character/state — linhThach VẪN = before + 100 (anti-FE-grant
  //     ledger invariant: idempotent claim KHÔNG được gọi applyTx lại).
  await step('GET /character/state — linhThach unchanged sau 2 idempotent claim (anti-FE-self-grant)', async () => {
    const r = await http('/api/character/state');
    assertStatus(r, 200, 'GET /state post-idempotent');
    const c = r.body?.data?.character;
    const expectedAfter = (BigInt(linhThachBefore) + BigInt(EXPECTED_REWARD)).toString();
    assert(
      c.linhThach === expectedAfter,
      `GET /state post-idempotent: expect linhThach='${expectedAfter}' (anti-FE-grant: idempotent claim KHÔNG cộng tiền thêm), got '${c.linhThach}'`,
    );
  });

  // -----------------------------------------------------------------------------
  // Positive multi-day flow (admin seedDailyLoginStreak → player claim → newStreak=N+1).
  // -----------------------------------------------------------------------------
  // Cần fresh user 2 vì user 1 đã claim hôm nay (canClaimToday=false). Admin
  // bootstrap qua INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD ở apps/api/.env.

  /** @type {string | null} */
  let player2UserId = null;
  /** @type {Map<string,string> | null} */
  let player2CookieSnap = null;

  // 16. Logout user 1 + register user 2 + onboard.
  const email2 = randomEmail();
  const password2 = randomPassword();
  await step('logout user 1 + register user 2 (multi-day positive flow)', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout user 1');
    cookieJar.clear();
    const r = await http('/api/_auth/register', {
      method: 'POST',
      body: { email: email2, password: password2 },
    });
    assertStatus(r, [200, 201], 'register user 2');
    if (!r.body?.ok)
      throw new Error(`register user 2: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    player2UserId = r.body?.data?.user?.id;
    assert(player2UserId, 'register user 2: missing user.id');
  });

  // 17. Onboard user 2.
  await step('onboard user 2', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: randomCharName(), sectKey: SECT_KEY },
    });
    assertStatus(r, [200, 201], 'onboard user 2');
    if (!r.body?.ok)
      throw new Error(`onboard user 2: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
  });

  // 18. Snapshot player 2 jar + admin login (jar swap).
  await step('admin login — swap cookie jar (player 2 → admin)', async () => {
    player2CookieSnap = snapshotCookies();
    cookieJar.clear();
    const r = await http('/api/_auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assertStatus(r, 200, 'admin login');
    if (!r.body?.ok)
      throw new Error(`admin login: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const u = r.body?.data?.user;
    assert(u?.role === 'ADMIN', `admin login: role phải ADMIN (cần bootstrap admin@example.com), got ${u?.role}`);
  });

  // 19. Admin POST /admin/users/:id/seed-daily-login-streak {days:6} → 200 ok.
  await step(`admin POST /admin/users/:id/seed-daily-login-streak { days: ${SEED_DAYS} } → 200 ok`, async () => {
    if (!player2UserId) throw new Error('player2UserId missing — register chưa chạy');
    const r = await http(`/api/admin/users/${player2UserId}/seed-daily-login-streak`, {
      method: 'POST',
      body: { days: SEED_DAYS, reason: 'smoke daily-login multi-day positive' },
    });
    assertStatus(r, 200, 'admin seed-daily-login-streak');
    assert(
      r.body?.ok === true && r.body?.data?.rowsCreated === SEED_DAYS,
      `seed-daily-login-streak shape: expect rowsCreated=${SEED_DAYS}, got ${JSON.stringify(r.body).slice(0, 300)}`,
    );
    assert(
      r.body?.data?.previousRowCount === 0,
      `seed-daily-login-streak: expect previousRowCount=0 (fresh char), got ${r.body?.data?.previousRowCount}`,
    );
    assert(
      r.body?.data?.newStreakWillBe === SEED_DAYS + 1,
      `seed-daily-login-streak: expect newStreakWillBe=${SEED_DAYS + 1}, got ${r.body?.data?.newStreakWillBe}`,
    );
  });

  // 20. Admin GET /admin/audit?action=admin.daily_login.seed → row >= 1.
  await step('admin GET /admin/audit?action=admin.daily_login.seed — row >= 1', async () => {
    const r = await http('/api/admin/audit?action=admin.daily_login.seed');
    assertStatus(r, 200, 'admin/audit?action=admin.daily_login.seed');
    const rows = r.body?.data?.rows ?? [];
    assert(Array.isArray(rows) && rows.length >= 1, `audit seed: phải >= 1 row, got ${rows?.length}`);
    assert(
      rows[0].action === 'admin.daily_login.seed',
      `audit row[0].action: expect 'admin.daily_login.seed', got '${rows[0].action}'`,
    );
  });

  // 21. Idempotent: seed lại lần 2 → rowsCreated=0, previousRowCount=SEED_DAYS.
  await step(`admin seed-daily-login-streak idempotent (2nd call) → rowsCreated=0, previousRowCount=${SEED_DAYS}`, async () => {
    if (!player2UserId) throw new Error('player2UserId missing');
    const r = await http(`/api/admin/users/${player2UserId}/seed-daily-login-streak`, {
      method: 'POST',
      body: { days: SEED_DAYS, reason: 'smoke daily-login idempotent' },
    });
    assertStatus(r, 200, 'admin seed-daily-login-streak idempotent');
    assert(
      r.body?.data?.rowsCreated === 0,
      `seed idempotent: expect rowsCreated=0 (P2002 skip), got ${r.body?.data?.rowsCreated}`,
    );
    assert(
      r.body?.data?.previousRowCount === SEED_DAYS,
      `seed idempotent: expect previousRowCount=${SEED_DAYS}, got ${r.body?.data?.previousRowCount}`,
    );
  });

  // 22. Admin logout + restore player 2 jar.
  await step('admin logout + restore player 2 cookies', async () => {
    const r = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(r, [200, 204], 'admin logout');
    cookieJar.clear();
    if (!player2CookieSnap) throw new Error('player2CookieSnap missing');
    restoreCookies(player2CookieSnap);
  });

  // 23. Player 2 GET /daily-login/me → currentStreak=SEED_DAYS, canClaimToday=true.
  await step(`GET /daily-login/me — post-seed: currentStreak=${SEED_DAYS}, canClaimToday=true`, async () => {
    const r = await http('/api/daily-login/me');
    assertStatus(r, 200, 'GET /me post-seed');
    const s = r.body?.data;
    assert(
      s?.currentStreak === SEED_DAYS,
      `currentStreak post-seed: expect ${SEED_DAYS} (yesterday claim → chain), got ${s?.currentStreak}`,
    );
    assert(s?.canClaimToday === true, `canClaimToday post-seed: expect true (chưa claim hôm nay), got ${s?.canClaimToday}`);
    assert(s?.nextRewardLinhThach === EXPECTED_REWARD, `nextRewardLinhThach: expect '${EXPECTED_REWARD}', got '${s?.nextRewardLinhThach}'`);
  });

  // 24. Player 2 POST /daily-login/claim → claimed=true, newStreak=SEED_DAYS+1, delta=100.
  await step(`POST /daily-login/claim — multi-day positive claimed=true newStreak=${SEED_DAYS + 1}`, async () => {
    const r = await http('/api/daily-login/claim', { method: 'POST' });
    assertStatus(r, 200, 'POST /claim multi-day');
    const data = r.body?.data;
    assert(data?.claimed === true, `claimed: expect true (chưa claim hôm nay), got ${data?.claimed}`);
    assert(
      data?.linhThachDelta === EXPECTED_REWARD,
      `linhThachDelta: expect '${EXPECTED_REWARD}', got '${data?.linhThachDelta}'`,
    );
    assert(
      data?.newStreak === SEED_DAYS + 1,
      `newStreak: expect ${SEED_DAYS + 1} (admin seeded ${SEED_DAYS} → +1 today), got ${data?.newStreak}`,
    );
  });

  // 25. GET /character/state — linhThach=100 (only today's reward; seeded historicals delta=0).
  await step("GET /character/state — linhThach='100' (admin seed delta=0, only today's claim cộng tiền)", async () => {
    const r = await http('/api/character/state');
    assertStatus(r, 200, 'GET /state post-multi-day');
    const c = r.body?.data?.character;
    assert(
      c?.linhThach === EXPECTED_REWARD,
      `linhThach post-multi-day: expect '${EXPECTED_REWARD}' (admin seed KHÔNG cộng tiền — chỉ today's claim 100 LT), got '${c?.linhThach}'`,
    );
  });

  // 26. logout + GET /me → 401 UNAUTHENTICATED.
  await step('logout + GET /daily-login/me — 401 UNAUTHENTICATED', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const r = await http('/api/daily-login/me');
    assertStatus(r, 401, 'GET /me post-logout');
    assert(
      r.body?.error?.code === 'UNAUTHENTICATED',
      `GET /me post-logout: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`,
    );
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:daily-login] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:daily-login] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:daily-login] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:daily-login] unexpected error:', err);
  process.exitCode = 1;
});
