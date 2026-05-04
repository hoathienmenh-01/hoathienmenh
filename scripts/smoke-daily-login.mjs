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
 *  16. `POST /api/_auth/logout` + GET /me            → 401.
 *
 * Anti-FE-self-grant invariant (per Luật bắt buộc — KHÔNG để FE tự cộng
 * tiền/streak qua double-claim):
 *   - `currentStreak` KHÔNG đổi qua idempotent claim (P2002 unique constraint
 *     guard).
 *   - `canClaimToday` vẫn = false sau idempotent claim.
 *   - `todayDateLocal` KHÔNG đổi (deterministic theo `MISSION_RESET_TZ`).
 *   - `character.linhThach` KHÔNG đổi qua idempotent claim — verify ledger
 *     applyTx KHÔNG được gọi 2 lần cho cùng characterId+claimDateLocal.
 *
 * Chạy:
 *   pnpm smoke:daily-login
 *   # hoặc trực tiếp:
 *   node scripts/smoke-daily-login.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE     — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS   — default 10000ms / request.
 *   SMOKE_VERBOSE      — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY     — default "thanh_van".
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

  // 16. logout + GET /me → 401 UNAUTHENTICATED.
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
