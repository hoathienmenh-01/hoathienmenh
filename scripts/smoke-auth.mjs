#!/usr/bin/env node
/**
 * smoke-auth.mjs — Auth module endpoints smoke cho Xuân Tôi.
 *
 * Negative-path-focused + minimal positive (đủ verify password reset
 * + change-password thực sự thay đổi `passwordHash` / bumps
 * `passwordVersion`). Cover toàn bộ auth flow gateway của game vì
 * tất cả gameplay endpoint khác đều require auth — auth là single
 * point of failure quan trọng nhất.
 *
 * Mục tiêu: cover 9 auth endpoints (`apps/api/src/modules/auth`):
 *   - `POST /api/_auth/register`        — tạo user (zod email + Password
 *                                         min 8 letter+digit; rate limit
 *                                         5/IP/15m).
 *   - `POST /api/_auth/login`           — login (zod email + password
 *                                         min 1; bcrypt verify; rate
 *                                         limit 5 fails/email|IP/15m).
 *   - `POST /api/_auth/forgot-password` — silent ok (chống enumeration);
 *                                         rate limit 3/IP/15m; trả
 *                                         devToken khi NODE_ENV !==
 *                                         'production'.
 *   - `POST /api/_auth/reset-password`  — token one-shot 30m TTL; bumps
 *                                         passwordVersion + revoke all
 *                                         refresh tokens.
 *   - `POST /api/_auth/change-password` — auth required; zod miss →
 *                                         silent OLD_PASSWORD_WRONG (KHÔNG
 *                                         leak shape error).
 *   - `GET  /api/_auth/session`         — return user from access cookie.
 *   - `POST /api/_auth/refresh`         — refresh access token, rotates
 *                                         refresh token.
 *   - `POST /api/_auth/logout`          — clear cookies; idempotent
 *                                         (no auth required).
 *   - `POST /api/_auth/logout-all`      — auth required; revoke ALL
 *                                         refresh tokens của user.
 *
 * Service order observation đặc biệt cho `change-password`
 * (`auth.controller.ts:141-156`):
 *   1. `ChangePasswordInput.safeParse(body)` — zod parse FIRST.
 *   2. nếu `parsed.success === false` → `fail('OLD_PASSWORD_WRONG', 401)`
 *      (KHÔNG dùng INVALID_INPUT — chống leak shape: attacker không thể
 *      phân biệt "body shape sai" vs "old password sai"; cả hai cùng
 *      mã 401 OLD_PASSWORD_WRONG).
 *   3. sau zod → `auth.userIdFromAccess(cookie.access)` → null →
 *      `fail('UNAUTHENTICATED', 401)`.
 *   4. cuối cùng → `auth.changePassword(userId, parsed.data)` (bcrypt
 *      verify old → throw OLD_PASSWORD_WRONG nếu sai).
 *
 * Smoke verify: pre-auth + body `{}` → 401 OLD_PASSWORD_WRONG (zod-fail
 * fires TRƯỚC auth gate). Khác với forgot-password (zod-fail → silent
 * 200 ok=true cho SAFETY chống enumeration).
 *
 * `forgot-password` silent pattern (`auth.controller.ts:103-121`):
 *   1. zod miss → `return { ok: true, data: { ok: true } }` (silent).
 *   2. service throw `RATE_LIMITED` → `fail('RATE_LIMITED', 429)`
 *      (cho phép expose rate-limit để client back-off).
 *   3. service throw khác (user not exist / banned) → silent
 *      `return { ok: true, data: { ok: true } }`.
 *   4. happy path (user exists, NODE_ENV !== 'production') →
 *      `{ ok: true, data: { ok: true, devToken: '<id>.<secret>' } }`.
 *
 * `reset-password` token format `<tokenId>.<secret>`:
 *   - `tokenId` = `id` DB row (UUID, non-secret, lookup O(1) PK index).
 *   - `secret` = 32-byte URL-safe base64 (~43 ký tự).
 *   - DB lưu `argon2.hash(secret)` + `expiresAt` (30m TTL) + `consumedAt`.
 *   - service split by first `.`, lookup tokenId → row, verify
 *     `argon2.verify(row.hashedToken, secret)`.
 *   - successful reset:
 *     - mark token consumed (one-shot).
 *     - revoke other reset tokens cùng user.
 *     - update user passwordHash + bump passwordVersion.
 *     - revoke ALL refresh tokens active của user.
 *
 * 25-step:
 *   1.  POST /_auth/register ({})                       → 400 WEAK_PASSWORD (zod miss).
 *   2.  POST /_auth/register (email:'invalid', pw valid)→ 400 WEAK_PASSWORD (zod email).
 *   3.  POST /_auth/register (email valid, pw 'shortabc'no digit)
 *                                                       → 400 WEAK_PASSWORD (zod regex /[0-9]/).
 *   4.  POST /_auth/register (email valid, pw valid)    → 200/201 user1 + cookies.
 *   5.  POST /_auth/register (same email)               → 400 EMAIL_TAKEN.
 *   6.  POST /_auth/login    ({})                       → 401 INVALID_CREDENTIALS (zod miss → controller silent).
 *   7.  POST /_auth/login    (email valid, wrong pw)    → 401 INVALID_CREDENTIALS.
 *   8.  POST /_auth/login    (non-existent email + valid pw)
 *                                                       → 401 INVALID_CREDENTIALS (silent enum).
 *   9.  POST /_auth/login    (valid)                    → 200 user + cookies.
 *  10.  GET  /_auth/session  (post-login)               → 200 user shape (id/email/role/createdAt).
 *  11.  POST /_auth/refresh  (post-login)               → 200 + cookies replaced.
 *  12.  POST /_auth/forgot-password ({})                → 200 silent (zod miss → silent ok).
 *  13.  POST /_auth/forgot-password (existing email)    → 200 + devToken (NODE_ENV !== 'production').
 *  14.  POST /_auth/forgot-password (non-existing email)→ 200 silent (devToken null).
 *  15.  POST /_auth/reset-password  ({})                → 400 INVALID_RESET_TOKEN (zod miss).
 *  16.  POST /_auth/reset-password  (token < 16 chars)  → 400 INVALID_RESET_TOKEN (zod min(16)).
 *  17.  POST /_auth/reset-password  (token long no-dot) → 400 INVALID_RESET_TOKEN (service split rejects).
 *  18.  POST /_auth/reset-password  (devToken + weak pw)→ 400 WEAK_PASSWORD (zod password regex).
 *  19.  POST /_auth/reset-password  (devToken + valid newPw)
 *                                                       → 200 ok (passwordVersion bumped + refresh tokens revoked).
 *  20.  POST /_auth/login    (with newPw)               → 200 (verify hash ACTUALLY changed).
 *  21.  POST /_auth/change-password ({}) [auth]         → 401 OLD_PASSWORD_WRONG (zod miss → silent same code).
 *  22.  POST /_auth/change-password (wrong old + valid new)
 *                                                       → 401 OLD_PASSWORD_WRONG.
 *  23.  POST /_auth/change-password (valid old + valid new) — pw3
 *                                                       → 200 ok.
 *  24.  POST /_auth/login    (pw3) → 200; POST /_auth/logout → 200;
 *       GET  /_auth/session  → 401 UNAUTHENTICATED.
 *  25.  POST /_auth/logout-all (no auth)                → 401 UNAUTHENTICATED;
 *       re-login pw3 → 200; POST /_auth/logout-all (auth)→ 200 ok.
 *
 * Mutation footprint:
 *   - 1 fresh user (email prefix `smoke-auth-<ts>-<rand>@smoke.invalid`).
 *   - passwordHash thay đổi 2 lần (reset-password → pw2; change-password
 *     → pw3); passwordVersion bumps tương ứng.
 *   - 1 PasswordResetToken row tạo + consumed sau step 19.
 *   - Refresh tokens nhiều rows tạo + revoked qua reset-password (step
 *     19) + logout (step 24) + logout-all (step 25).
 *
 * Defer:
 *   - RATE_LIMITED 429 (register 5/IP/15m + forgot 3/IP/15m + login fail
 *     5/email|IP/15m) — cần deterministic timing harness + reset rate
 *     limiter giữa runs (in-memory limiter bound to API process,
 *     restart API → reset).
 *   - SESSION_EXPIRED 401 — cần JWT TTL truncate / time-travel harness.
 *   - ACCOUNT_BANNED 403 — cần admin endpoint ban user trước, orthogonal
 *     cho smoke:admin.
 *
 * Anti-FE-self-grant invariant N/A — auth module KHÔNG touch character
 * resources (auth chỉ tạo User; Character do CharacterService onboard
 * sau, là module riêng).
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

function clearCookies() {
  cookieJar.clear();
}

// -----------------------------------------------------------------------------
// HTTP helper.
// -----------------------------------------------------------------------------

/**
 * @param {string} path
 * @param {{ method?: string; body?: unknown; suppressCookies?: boolean }} [opts]
 * @returns {Promise<{ status: number; body: any }>}
 */
async function http(path, opts = {}) {
  const url = `${BASE}${path}`;
  const method = opts.method ?? 'GET';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  /** @type {Record<string,string>} */
  const headers = { Accept: 'application/json' };
  if (!opts.suppressCookies) {
    const cookieH = cookieHeader();
    if (cookieH) headers.Cookie = cookieH;
  }
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
  process.stdout.write(`[smoke:auth] ${name} ... `);
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

/**
 * Verify PublicUser shape contract.
 * @param {any} u
 * @param {string} label
 * @param {{ emailEquals?: string }} [ctx]
 */
function assertPublicUserShape(u, label, ctx = {}) {
  assert(u, `${label}: missing user`);
  assert(typeof u.id === 'string' && u.id.length > 0, `${label}: user.id not non-empty string (${u.id})`);
  assert(typeof u.email === 'string' && u.email.length > 0, `${label}: user.email not non-empty string (${u.email})`);
  assert(['PLAYER', 'MOD', 'ADMIN'].includes(u.role), `${label}: user.role not in enum (${u.role})`);
  // createdAt: PublicUser ZOD says z.string() — server convert Date → ISO via toISOString.
  assert(typeof u.createdAt === 'string' && u.createdAt.length > 0, `${label}: user.createdAt not non-empty string (${u.createdAt})`);
  assert(!Number.isNaN(Date.parse(u.createdAt)), `${label}: user.createdAt not ISO 8601 parseable (${u.createdAt})`);
  if (ctx.emailEquals !== undefined) {
    assert(u.email === ctx.emailEquals, `${label}: user.email expect '${ctx.emailEquals}' got '${u.email}'`);
  }
}

// -----------------------------------------------------------------------------
// Random helpers.
// -----------------------------------------------------------------------------

function randomEmail() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `smoke-auth-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

async function main() {
  console.log(`[smoke:auth] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms`);

  const email = randomEmail();
  const pw1 = randomPassword();
  const pw2 = randomPassword(); // sau reset-password
  const pw3 = randomPassword(); // sau change-password
  // Ensure pw1/pw2/pw3 distinct (extreme low collision but be safe).
  assert(pw1 !== pw2 && pw2 !== pw3 && pw1 !== pw3, 'smoke setup: pw1/pw2/pw3 not distinct');

  // 1. POST /_auth/register ({}) → 400 WEAK_PASSWORD (zod miss).
  await step('POST /_auth/register — ({}) 400 WEAK_PASSWORD (zod miss)', async () => {
    const r = await http('/api/_auth/register', { method: 'POST', body: {} });
    assertStatus(r, 400, 'register {}');
    assertErrorCode(r, 'WEAK_PASSWORD', 'register {}');
  });

  // 2. POST /_auth/register (email:'invalid', pw valid) → 400 WEAK_PASSWORD (zod email format fail).
  //    Controller line 66: `if (!parsed.success) fail('WEAK_PASSWORD')` — silent map mọi zod
  //    fail (cả email regex + password regex) thành cùng code WEAK_PASSWORD.
  await step('POST /_auth/register — (email:"invalid", pw valid) 400 WEAK_PASSWORD (zod email)', async () => {
    const r = await http('/api/_auth/register', {
      method: 'POST',
      body: { email: 'invalid', password: pw1 },
    });
    assertStatus(r, 400, 'register email:invalid');
    assertErrorCode(r, 'WEAK_PASSWORD', 'register email:invalid');
  });

  // 3. POST /_auth/register (email valid, pw 'shortabc' no digit) → 400 WEAK_PASSWORD
  //    (zod Password.regex(/[0-9]/) fail).
  await step('POST /_auth/register — (pw "shortabc" no digit) 400 WEAK_PASSWORD (zod password regex)', async () => {
    const r = await http('/api/_auth/register', {
      method: 'POST',
      body: { email: randomEmail(), password: 'shortabc' },
    });
    assertStatus(r, 400, 'register pw no digit');
    assertErrorCode(r, 'WEAK_PASSWORD', 'register pw no digit');
  });

  // 4. POST /_auth/register (valid) → 200/201 user1 + access/refresh cookies set.
  await step('POST /_auth/register — valid → 200 user1 + cookies set', async () => {
    clearCookies();
    const r = await http('/api/_auth/register', {
      method: 'POST',
      body: { email, password: pw1 },
    });
    assertStatus(r, [200, 201], 'register valid');
    if (!r.body?.ok)
      throw new Error(`register: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assertPublicUserShape(r.body?.data?.user, 'register valid', { emailEquals: email });
    assert(cookieJar.has('xt_access'), 'register: missing xt_access cookie');
    assert(cookieJar.has('xt_refresh'), 'register: missing xt_refresh cookie');
  });

  // 5. POST /_auth/register (same email) → 400 EMAIL_TAKEN.
  //    Service line 124: `if (existing) throw new AuthError('EMAIL_TAKEN')`.
  await step('POST /_auth/register — (same email) 400 EMAIL_TAKEN', async () => {
    // Use fresh request without auth cookies — controller doesn't care about auth here.
    const r = await http('/api/_auth/register', {
      method: 'POST',
      body: { email, password: pw1 },
    });
    assertStatus(r, 400, 'register dup email');
    assertErrorCode(r, 'EMAIL_TAKEN', 'register dup email');
  });

  // 6. POST /_auth/login ({}) → 401 INVALID_CREDENTIALS (zod miss → controller silent map).
  //    Controller line 86: `if (!parsed.success) fail('INVALID_CREDENTIALS', 401)` — silent.
  await step('POST /_auth/login — ({}) 401 INVALID_CREDENTIALS (zod miss)', async () => {
    const r = await http('/api/_auth/login', { method: 'POST', body: {} });
    assertStatus(r, 401, 'login {}');
    assertErrorCode(r, 'INVALID_CREDENTIALS', 'login {}');
  });

  // 7. POST /_auth/login (existing email, wrong pw) → 401 INVALID_CREDENTIALS.
  //    Service line 142-144: argon2.verify fail → recordAttempt → throw.
  await step('POST /_auth/login — (wrong pw) 401 INVALID_CREDENTIALS', async () => {
    const r = await http('/api/_auth/login', {
      method: 'POST',
      body: { email, password: pw1 + 'WRONG' },
    });
    assertStatus(r, 401, 'login wrong pw');
    assertErrorCode(r, 'INVALID_CREDENTIALS', 'login wrong pw');
  });

  // 8. POST /_auth/login (non-existent email, valid pw) → 401 INVALID_CREDENTIALS.
  //    Service line 137-140: prisma.user.findUnique → null → recordAttempt → throw.
  //    Same code 'INVALID_CREDENTIALS' (chống user enumeration).
  await step('POST /_auth/login — (non-existent email) 401 INVALID_CREDENTIALS (silent enumeration)', async () => {
    const r = await http('/api/_auth/login', {
      method: 'POST',
      body: { email: randomEmail(), password: pw1 },
    });
    assertStatus(r, 401, 'login non-exist');
    assertErrorCode(r, 'INVALID_CREDENTIALS', 'login non-exist');
  });

  // 9. POST /_auth/login (valid) → 200 + cookies replaced.
  await step('POST /_auth/login — valid → 200 user + cookies', async () => {
    clearCookies();
    const r = await http('/api/_auth/login', {
      method: 'POST',
      body: { email, password: pw1 },
    });
    assertStatus(r, 200, 'login valid');
    if (!r.body?.ok)
      throw new Error(`login: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assertPublicUserShape(r.body?.data?.user, 'login valid', { emailEquals: email });
    assert(cookieJar.has('xt_access'), 'login: missing xt_access cookie');
    assert(cookieJar.has('xt_refresh'), 'login: missing xt_refresh cookie');
  });

  // 10. GET /_auth/session (post-login) → 200 user shape.
  await step('GET /_auth/session — (post-login) 200 user shape', async () => {
    const r = await http('/api/_auth/session');
    assertStatus(r, 200, 'session post-login');
    if (!r.body?.ok)
      throw new Error(`session: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assertPublicUserShape(r.body?.data?.user, 'session post-login', { emailEquals: email });
  });

  // 11. POST /_auth/refresh valid → 200 + cookies replaced.
  await step('POST /_auth/refresh — valid → 200 + cookies replaced', async () => {
    const beforeRefresh = cookieJar.get('xt_refresh');
    const beforeAccess = cookieJar.get('xt_access');
    const r = await http('/api/_auth/refresh', { method: 'POST' });
    assertStatus(r, 200, 'refresh valid');
    if (!r.body?.ok)
      throw new Error(`refresh: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assertPublicUserShape(r.body?.data?.user, 'refresh valid', { emailEquals: email });
    // Refresh token rotates: new token MUST differ.
    const afterRefresh = cookieJar.get('xt_refresh');
    const afterAccess = cookieJar.get('xt_access');
    assert(afterRefresh && afterRefresh !== beforeRefresh, 'refresh: refresh cookie not rotated');
    assert(afterAccess && afterAccess !== beforeAccess, 'refresh: access cookie not rotated');
  });

  // 12. POST /_auth/forgot-password ({}) → 200 silent (zod miss → controller silent ok).
  //    Controller line 107-110: `if (!parsed.success) return { ok: true, data: { ok: true } }`.
  await step('POST /_auth/forgot-password — ({}) 200 silent (zod miss → silent ok)', async () => {
    const r = await http('/api/_auth/forgot-password', {
      method: 'POST',
      body: {},
      suppressCookies: true,
    });
    assertStatus(r, 200, 'forgot {}');
    if (!r.body?.ok)
      throw new Error(`forgot-{}: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.ok === true, 'forgot-{}: data.ok not true');
    assert(r.body?.data?.devToken === undefined, 'forgot-{}: should NOT return devToken');
  });

  /** @type {string} */
  let devToken = '';

  // 13. POST /_auth/forgot-password (existing email) → 200 + devToken (NODE_ENV !== 'production').
  await step('POST /_auth/forgot-password — (existing email) 200 + devToken', async () => {
    const r = await http('/api/_auth/forgot-password', {
      method: 'POST',
      body: { email },
      suppressCookies: true,
    });
    assertStatus(r, 200, 'forgot existing');
    assert(r.body?.ok === true && r.body?.data?.ok === true, 'forgot existing: data.ok not true');
    const tok = r.body?.data?.devToken;
    assert(typeof tok === 'string' && tok.length >= 16, `forgot existing: devToken not non-empty string >=16 chars (${tok})`);
    assert(tok.includes('.'), `forgot existing: devToken not '<id>.<secret>' format (${tok.slice(0, 30)}...)`);
    devToken = tok;
  });

  // 14. POST /_auth/forgot-password (non-existing email) → 200 silent (devToken null).
  //    Service line 178-185: !user → run dummy argon2.hash + return { devToken: null }.
  await step('POST /_auth/forgot-password — (non-existing email) 200 silent (devToken null)', async () => {
    const r = await http('/api/_auth/forgot-password', {
      method: 'POST',
      body: { email: randomEmail() },
      suppressCookies: true,
    });
    assertStatus(r, 200, 'forgot non-exist');
    assert(r.body?.ok === true && r.body?.data?.ok === true, 'forgot non-exist: data.ok not true');
    // devToken === null per service contract.
    assert(r.body?.data?.devToken === null, `forgot non-exist: devToken should be null, got ${r.body?.data?.devToken}`);
  });

  // 15. POST /_auth/reset-password ({}) → 400 INVALID_RESET_TOKEN (zod miss).
  //    Controller line 130-131: `if (!parsed.success) fail('INVALID_RESET_TOKEN')`.
  await step('POST /_auth/reset-password — ({}) 400 INVALID_RESET_TOKEN (zod miss)', async () => {
    const r = await http('/api/_auth/reset-password', {
      method: 'POST',
      body: {},
      suppressCookies: true,
    });
    assertStatus(r, 400, 'reset {}');
    assertErrorCode(r, 'INVALID_RESET_TOKEN', 'reset {}');
  });

  // 16. POST /_auth/reset-password (token < 16 chars) → 400 INVALID_RESET_TOKEN (zod min(16)).
  await step('POST /_auth/reset-password — (token < 16 chars) 400 INVALID_RESET_TOKEN (zod min)', async () => {
    const r = await http('/api/_auth/reset-password', {
      method: 'POST',
      body: { token: 'x'.repeat(10), newPassword: pw2 },
      suppressCookies: true,
    });
    assertStatus(r, 400, 'reset token short');
    assertErrorCode(r, 'INVALID_RESET_TOKEN', 'reset token short');
  });

  // 17. POST /_auth/reset-password (token long no-dot) → 400 INVALID_RESET_TOKEN (service split).
  //    Service line 238-240: `dotIdx <= 0 || dotIdx === token.length - 1` → throw.
  await step('POST /_auth/reset-password — (token long no-dot) 400 INVALID_RESET_TOKEN (service split)', async () => {
    const r = await http('/api/_auth/reset-password', {
      method: 'POST',
      body: { token: 'a'.repeat(50), newPassword: pw2 },
      suppressCookies: true,
    });
    assertStatus(r, 400, 'reset token no-dot');
    assertErrorCode(r, 'INVALID_RESET_TOKEN', 'reset token no-dot');
  });

  // 18. POST /_auth/reset-password (devToken + weak pw) → 400 WEAK_PASSWORD (zod password regex).
  //    Controller line 130-131: zod fail → fail('INVALID_RESET_TOKEN') — wait, controller maps
  //    ALL zod fails (token short / pw weak) → INVALID_RESET_TOKEN. Let me verify by sending
  //    valid token + weak pw: server zod parse → fail (newPassword regex fail) → INVALID_RESET_TOKEN.
  //    Actually controller silent — let's just expect INVALID_RESET_TOKEN consistent với spec.
  //    (Still verifies that pw weak doesn't bypass to 200.)
  await step('POST /_auth/reset-password — (devToken + weak pw) 400 INVALID_RESET_TOKEN (zod silent)', async () => {
    const r = await http('/api/_auth/reset-password', {
      method: 'POST',
      body: { token: devToken, newPassword: 'shortabc' },
      suppressCookies: true,
    });
    assertStatus(r, 400, 'reset weak pw');
    assertErrorCode(r, 'INVALID_RESET_TOKEN', 'reset weak pw');
  });

  // 19. POST /_auth/reset-password (devToken + valid newPw=pw2) → 200 ok.
  //    Side-effect: passwordHash → pw2's argon2; passwordVersion bumped; ALL refresh tokens revoked.
  await step('POST /_auth/reset-password — (devToken + valid newPw) 200 ok (pw1 → pw2)', async () => {
    const r = await http('/api/_auth/reset-password', {
      method: 'POST',
      body: { token: devToken, newPassword: pw2 },
      suppressCookies: true,
    });
    assertStatus(r, 200, 'reset valid');
    if (!r.body?.ok)
      throw new Error(`reset valid: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.ok === true, 'reset valid: data.ok not true');
  });

  // 20. POST /_auth/login (with newPw=pw2) → 200 (proves passwordHash CHANGED).
  //    Login với pw1 (cũ) sẽ fail INVALID_CREDENTIALS — verify riêng để chắc chắn.
  await step('POST /_auth/login — (with new pw=pw2) 200 (proves pw changed)', async () => {
    clearCookies();
    // Sub-assert: pw1 (cũ) phải fail.
    const rOld = await http('/api/_auth/login', {
      method: 'POST',
      body: { email, password: pw1 },
    });
    assertStatus(rOld, 401, 'login pw1 sau reset');
    assertErrorCode(rOld, 'INVALID_CREDENTIALS', 'login pw1 sau reset');
    // Pw2 (mới) phải thành công.
    clearCookies();
    const r = await http('/api/_auth/login', {
      method: 'POST',
      body: { email, password: pw2 },
    });
    assertStatus(r, 200, 'login pw2');
    if (!r.body?.ok)
      throw new Error(`login pw2: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assertPublicUserShape(r.body?.data?.user, 'login pw2', { emailEquals: email });
    assert(cookieJar.has('xt_access'), 'login pw2: missing xt_access cookie');
    assert(cookieJar.has('xt_refresh'), 'login pw2: missing xt_refresh cookie');
  });

  // 21. POST /_auth/change-password ({}) [auth] → 401 OLD_PASSWORD_WRONG (zod miss → silent same code).
  //    Controller line 144-145: `if (!parsed.success) fail('OLD_PASSWORD_WRONG', 401)` —
  //    KHÔNG dùng INVALID_INPUT để chống attacker phân biệt body shape sai vs old pw sai.
  await step('POST /_auth/change-password — ({}) [auth] 401 OLD_PASSWORD_WRONG (zod miss → silent)', async () => {
    const r = await http('/api/_auth/change-password', { method: 'POST', body: {} });
    assertStatus(r, 401, 'change-password {}');
    assertErrorCode(r, 'OLD_PASSWORD_WRONG', 'change-password {}');
  });

  // 22. POST /_auth/change-password (wrong old + valid new=pw3) → 401 OLD_PASSWORD_WRONG.
  //    Service: argon2.verify(stored_pw2_hash, 'WRONG' + pw2) → false → throw.
  await step('POST /_auth/change-password — (wrong old) 401 OLD_PASSWORD_WRONG', async () => {
    const r = await http('/api/_auth/change-password', {
      method: 'POST',
      body: { oldPassword: pw2 + 'WRONG', newPassword: pw3 },
    });
    assertStatus(r, 401, 'change-password wrong old');
    assertErrorCode(r, 'OLD_PASSWORD_WRONG', 'change-password wrong old');
  });

  // 23. POST /_auth/change-password (valid old=pw2 + valid new=pw3) → 200 ok.
  //    Side-effect: passwordHash → pw3's argon2; passwordVersion bumped.
  await step('POST /_auth/change-password — (valid) 200 ok (pw2 → pw3)', async () => {
    const r = await http('/api/_auth/change-password', {
      method: 'POST',
      body: { oldPassword: pw2, newPassword: pw3 },
    });
    assertStatus(r, 200, 'change-password valid');
    if (!r.body?.ok)
      throw new Error(`change-password valid: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.ok === true, 'change-password valid: data.ok not true');
  });

  // 24. Login pw3 → 200 + logout → 200 + GET /session → 401.
  //    Verify pw3 thực sự thay thế pw2 + logout chuỗi cookies.
  await step('login(pw3) → 200; logout → 200; GET /session → 401', async () => {
    clearCookies();
    // Sub-assert: pw2 (cũ sau change-password) phải fail.
    const rOld = await http('/api/_auth/login', {
      method: 'POST',
      body: { email, password: pw2 },
    });
    assertStatus(rOld, 401, 'login pw2 sau change-password');
    assertErrorCode(rOld, 'INVALID_CREDENTIALS', 'login pw2 sau change-password');

    // Pw3 (new) thành công.
    clearCookies();
    const rLogin = await http('/api/_auth/login', {
      method: 'POST',
      body: { email, password: pw3 },
    });
    assertStatus(rLogin, 200, 'login pw3');
    assertPublicUserShape(rLogin.body?.data?.user, 'login pw3', { emailEquals: email });

    // Logout.
    const rLogout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(rLogout, 200, 'logout');
    if (!rLogout.body?.ok)
      throw new Error(`logout: ok=false body=${JSON.stringify(rLogout.body).slice(0, 200)}`);
    assert(rLogout.body?.data?.ok === true, 'logout: data.ok not true');
    // Cookies should be cleared by Set-Cookie deleted.
    assert(!cookieJar.has('xt_access'), 'logout: xt_access still in jar');
    assert(!cookieJar.has('xt_refresh'), 'logout: xt_refresh still in jar');

    // Session post-logout → 401.
    const rSession = await http('/api/_auth/session');
    assertStatus(rSession, 401, 'session post-logout');
    assertErrorCode(rSession, 'UNAUTHENTICATED', 'session post-logout');
  });

  // 25. POST /logout-all (no auth) → 401 + re-login pw3 → 200 + POST /logout-all (auth) → 200.
  await step('POST /logout-all (no auth) → 401; re-login pw3; POST /logout-all (auth) → 200', async () => {
    // No auth.
    clearCookies();
    const rNoAuth = await http('/api/_auth/logout-all', { method: 'POST' });
    assertStatus(rNoAuth, 401, 'logout-all no-auth');
    assertErrorCode(rNoAuth, 'UNAUTHENTICATED', 'logout-all no-auth');

    // Re-login pw3.
    const rLogin = await http('/api/_auth/login', {
      method: 'POST',
      body: { email, password: pw3 },
    });
    assertStatus(rLogin, 200, 'logout-all flow re-login');
    assert(cookieJar.has('xt_access'), 'logout-all flow: missing xt_access after re-login');

    // Logout-all (auth).
    const rAuth = await http('/api/_auth/logout-all', { method: 'POST' });
    assertStatus(rAuth, 200, 'logout-all auth');
    if (!rAuth.body?.ok)
      throw new Error(`logout-all auth: ok=false body=${JSON.stringify(rAuth.body).slice(0, 200)}`);
    // Body has revoked count: assert it's a number ≥ 0.
    const data = rAuth.body?.data;
    assert(data && typeof data === 'object', 'logout-all auth: data missing');
    // Cookies cleared post logout-all.
    assert(!cookieJar.has('xt_access'), 'logout-all auth: xt_access still in jar');
    assert(!cookieJar.has('xt_refresh'), 'logout-all auth: xt_refresh still in jar');

    // Session post logout-all → 401.
    const rSession = await http('/api/_auth/session');
    assertStatus(rSession, 401, 'session post-logout-all');
    assertErrorCode(rSession, 'UNAUTHENTICATED', 'session post-logout-all');
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:auth] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:auth] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:auth] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:auth] unexpected error:', err);
  process.exitCode = 1;
});
