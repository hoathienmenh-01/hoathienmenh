#!/usr/bin/env node
/**
 * smoke-mail.mjs — Mail inbox + unread-count + read + claim endpoints smoke
 * cho Xuân Tôi. Negative-path-only (positive claim path yêu cầu admin
 * `mail.sendToCharacter` để seed mail row → defer cho future smoke với
 * admin secret).
 *
 * Mục tiêu: cover 4 mail endpoints qua HTTP — `apps/api/src/modules/mail`.
 * Verify auth gate (401 unauth), NO_CHARACTER fallback (404 cho inbox/
 * read/claim, 200 count=0 silent cho unread-count), MAIL_NOT_FOUND 404,
 * INVALID_INPUT 400 (id > 80 char), shape contract cho empty inbox + zero
 * unread count.
 *
 *   1. `GET  /api/mail/me`             (no auth)         → 401.
 *   2. `GET  /api/mail/unread-count`   (no auth)         → 401.
 *   3. `POST /api/mail/{id}/read`      (no auth)         → 401.
 *   4. `POST /api/mail/{id}/claim`     (no auth)         → 401.
 *   5. `POST /api/_auth/register`                        — fresh user.
 *   6. `GET  /api/mail/me`             (pre-onboard)     → 404
 *                                                        NO_CHARACTER.
 *   7. `GET  /api/mail/unread-count`   (pre-onboard)     → 200 count=0
 *                                                        (silent
 *                                                        fallback,
 *                                                        KHÔNG
 *                                                        throw).
 *   8. `POST /api/mail/abc/read`       (pre-onboard)     → 404
 *                                                        NO_CHARACTER.
 *   9. `POST /api/mail/abc/claim`      (pre-onboard)     → 404
 *                                                        NO_CHARACTER.
 *  10. `POST /api/character/onboard`                     — fresh char.
 *  11. `GET  /api/mail/me`             (fresh char)      → 200,
 *                                                        mails=[]
 *                                                        empty
 *                                                        inbox.
 *  12. `GET  /api/mail/unread-count`   (fresh char)      → 200,
 *                                                        count=0.
 *  13. `POST /api/mail/nonexistent-id/read`              → 404
 *                                                        MAIL_NOT_FOUND
 *                                                        (mail KHÔNG
 *                                                        thuộc về
 *                                                        char).
 *  14. `POST /api/mail/nonexistent-id/claim`             → 404
 *                                                        MAIL_NOT_FOUND.
 *  15. `POST /api/mail/{81-char-id}/read`                → 400
 *                                                        INVALID_INPUT
 *                                                        (IdParam
 *                                                        max(80)
 *                                                        violation).
 *  16. `POST /api/_auth/logout` + GET /mail/me           → 401.
 *
 * Anti-FE-self-grant invariant (mặc dù không có positive claim ở smoke
 * này, vẫn verify gián tiếp): failed claim attempts (NO_CHARACTER /
 * MAIL_NOT_FOUND / INVALID_INPUT) KHÔNG đụng `linhThach` /
 * `tienNgoc` của character. Snapshot `/api/character/state` trước/sau
 * 4 claim fail attempt để chắc.
 *
 * Chạy:
 *   pnpm smoke:mail
 *   # hoặc trực tiếp:
 *   node scripts/smoke-mail.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE     — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS   — default 10000ms / request.
 *   SMOKE_VERBOSE      — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY     — default "thanh_van".
 *
 * Yêu cầu môi trường (giống smoke:leaderboard):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:mail`
 *
 * Defer: positive claim path (mail with reward → claim → ledger
 * applyTx LINH_THACH/TIEN_NGOC + inventory.grantTx + character.exp
 * increment + claimedAt set + idempotent retry → ALREADY_CLAIMED 409)
 * yêu cầu admin `mail.sendToCharacter` để seed mail row → defer cho
 * future smoke với admin secret. Tương tự `MAIL_EXPIRED` (yêu cầu
 * mail row với `expiresAt < now`) và `NO_REWARD` (yêu cầu mail row
 * không có reward) cũng defer.
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
 * @param {() => Promise<void>} fn
 */
async function step(name, fn) {
  process.stdout.write(`[smoke:mail] ${name} ... `);
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
  return `smoke-mail-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `mail_${rand}`;
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
    `[smoke:mail] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}`,
  );

  // 1. GET /mail/me chưa auth → 401.
  await step('GET /mail/me — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/mail/me');
    assertStatus(r, 401, 'GET /mail/me unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'GET /mail/me unauth');
  });

  // 2. GET /mail/unread-count chưa auth → 401.
  await step('GET /mail/unread-count — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/mail/unread-count');
    assertStatus(r, 401, 'GET /mail/unread-count unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'GET /mail/unread-count unauth');
  });

  // 3. POST /mail/{id}/read chưa auth → 401.
  await step('POST /mail/abc/read — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/mail/abc/read', { method: 'POST', body: {} });
    assertStatus(r, 401, 'POST /mail/abc/read unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'POST /mail/abc/read unauth');
  });

  // 4. POST /mail/{id}/claim chưa auth → 401.
  await step('POST /mail/abc/claim — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/mail/abc/claim', { method: 'POST', body: {} });
    assertStatus(r, 401, 'POST /mail/abc/claim unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'POST /mail/abc/claim unauth');
  });

  // 5. Register fresh user.
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

  // 6. GET /mail/me pre-onboard → 404 NO_CHARACTER.
  await step('GET /mail/me — pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/mail/me');
    assertStatus(r, 404, 'GET /mail/me pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'GET /mail/me pre-onboard');
  });

  // 7. GET /mail/unread-count pre-onboard → 200 count=0 (silent fallback).
  await step('GET /mail/unread-count — pre-onboard 200 count=0 (silent)', async () => {
    const r = await http('/api/mail/unread-count');
    assertStatus(r, 200, 'GET /mail/unread-count pre-onboard');
    if (!r.body?.ok)
      throw new Error(`GET /mail/unread-count: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.count === 0, `GET /mail/unread-count pre-onboard: expect count=0 (silent fallback), got ${r.body?.data?.count}`);
  });

  // 8. POST /mail/abc/read pre-onboard → 404 NO_CHARACTER.
  await step('POST /mail/abc/read — pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/mail/abc/read', { method: 'POST', body: {} });
    assertStatus(r, 404, 'POST /mail/abc/read pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'POST /mail/abc/read pre-onboard');
  });

  // 9. POST /mail/abc/claim pre-onboard → 404 NO_CHARACTER.
  await step('POST /mail/abc/claim — pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/mail/abc/claim', { method: 'POST', body: {} });
    assertStatus(r, 404, 'POST /mail/abc/claim pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'POST /mail/abc/claim pre-onboard');
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

  // 11. GET /mail/me fresh char → 200 mails=[] empty inbox.
  await step('GET /mail/me — fresh char 200 mails=[]', async () => {
    const r = await http('/api/mail/me');
    assertStatus(r, 200, 'GET /mail/me fresh char');
    if (!r.body?.ok)
      throw new Error(`GET /mail/me: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const mails = r.body?.data?.mails;
    assert(Array.isArray(mails), 'GET /mail/me fresh char: mails phải array');
    assert(mails.length === 0, `GET /mail/me fresh char: expect mails=[] empty inbox, got ${mails.length} mails`);
  });

  // 12. GET /mail/unread-count fresh char → 200 count=0.
  await step('GET /mail/unread-count — fresh char 200 count=0', async () => {
    const r = await http('/api/mail/unread-count');
    assertStatus(r, 200, 'GET /mail/unread-count fresh char');
    if (!r.body?.ok)
      throw new Error(`GET /mail/unread-count: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.count === 0, `GET /mail/unread-count fresh char: expect count=0, got ${r.body?.data?.count}`);
  });

  // Snapshot currency BEFORE failed claim attempts (anti-FE-self-grant).
  const before = await fetchCharCurrencies();

  // 13. POST /mail/{nonexistent}/read → 404 MAIL_NOT_FOUND.
  await step('POST /mail/nonexistent-id/read — 404 MAIL_NOT_FOUND', async () => {
    const r = await http('/api/mail/nonexistent-mail-id-12345/read', { method: 'POST', body: {} });
    assertStatus(r, 404, 'POST /mail/nonexistent/read');
    assertErrorCode(r, 'MAIL_NOT_FOUND', 'POST /mail/nonexistent/read');
  });

  // 14. POST /mail/{nonexistent}/claim → 404 MAIL_NOT_FOUND.
  await step('POST /mail/nonexistent-id/claim — 404 MAIL_NOT_FOUND', async () => {
    const r = await http('/api/mail/nonexistent-mail-id-12345/claim', { method: 'POST', body: {} });
    assertStatus(r, 404, 'POST /mail/nonexistent/claim');
    assertErrorCode(r, 'MAIL_NOT_FOUND', 'POST /mail/nonexistent/claim');
  });

  // 15. POST /mail/{81-char-id}/read → 400 INVALID_INPUT (IdParam max(80)).
  await step('POST /mail/{81-char-id}/read — 400 INVALID_INPUT', async () => {
    const longId = 'x'.repeat(81);
    const r = await http(`/api/mail/${longId}/read`, { method: 'POST', body: {} });
    assertStatus(r, 400, 'POST /mail/{long}/read');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /mail/{long}/read');
  });

  // Anti-FE-self-grant invariant — verify currency unchanged sau 4 failed
  // claim/read attempt (steps 13-15 + step 9 claim pre-onboard before
  // onboard) — fresh char nên linhThach='0' tienNgoc=0 không đổi.
  await step('anti-FE-self-grant — currency unchanged sau failed mail attempts', async () => {
    const after = await fetchCharCurrencies();
    assert(
      after.linhThach === before.linhThach,
      `linhThach VẪN ${before.linhThach} sau failed claim attempts, got ${after.linhThach}`,
    );
    assert(
      after.tienNgoc === before.tienNgoc,
      `tienNgoc VẪN ${before.tienNgoc} sau failed claim attempts, got ${after.tienNgoc}`,
    );
  });

  // 16. logout + GET /mail/me → 401.
  await step('logout + GET /mail/me — 401 UNAUTHENTICATED', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const r = await http('/api/mail/me');
    assertStatus(r, 401, 'GET /mail/me post-logout');
    assertErrorCode(r, 'UNAUTHENTICATED', 'GET /mail/me post-logout');
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:mail] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:mail] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:mail] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:mail] unexpected error:', err);
  process.exitCode = 1;
});
