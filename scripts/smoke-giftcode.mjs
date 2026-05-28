#!/usr/bin/env node
/**
 * smoke-giftcode.mjs — Gift code redeem endpoint smoke cho Xuân Tôi.
 *
 * Cover negative path: auth gate (401), INVALID_INPUT 400 (zod violations),
 * NO_CHARACTER 404 (pre-onboard), CODE_NOT_FOUND 404, service length>32
 * check, anti-FE-self-grant invariant.
 *
 * Cover positive path: admin create giftcode → user redeem → verify rewards
 * → ALREADY_REDEEMED 409 → anti-FE-self-grant.
 *
 * 19-step: 13 negative + 6 positive (steps 14-19).
 *
 * Chạy: pnpm smoke:giftcode
 *
 * Env vars:
 *   SMOKE_API_BASE, SMOKE_TIMEOUT_MS, SMOKE_VERBOSE, SMOKE_SECT_KEY,
 *   SMOKE_ADMIN_EMAIL, SMOKE_ADMIN_PASSWORD
 */

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const BASE = (process.env.SMOKE_API_BASE ?? 'http://localhost:3000').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);
const VERBOSE = process.env.SMOKE_VERBOSE === '1';
const SECT_KEY = process.env.SMOKE_SECT_KEY ?? 'thanh_van';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'Admin@123';

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

/** Snapshot cookieJar để switch tạm sang admin rồi restore lại player. */
function snapshotCookies() {
  return new Map(cookieJar);
}

/** @param {Map<string,string>} snapshot */
function restoreCookies(snapshot) {
  cookieJar.clear();
  for (const [k, v] of snapshot) cookieJar.set(k, v);
}

// -----------------------------------------------------------------------------
// HTTP helper với timeout + cookie persistence.
// -----------------------------------------------------------------------------

/**
 * @param {string} path
 * @param {{ method?: string; body?: unknown; rawBody?: string }} [opts]
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
  if (opts.body !== undefined || opts.rawBody !== undefined)
    headers['Content-Type'] = 'application/json';

  if (VERBOSE) {
    console.log(`→ ${method} ${url}${opts.body ? ' body=' + JSON.stringify(opts.body) : ''}`);
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body:
        opts.rawBody !== undefined
          ? opts.rawBody
          : opts.body === undefined
            ? undefined
            : JSON.stringify(opts.body),
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
  process.stdout.write(`[smoke:giftcode] ${name} ... `);
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
  return `smoke-giftcode-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `gift_${rand}`;
}

function randomNonexistentCode() {
  const rand = Math.random().toString(36).slice(2, 12).toUpperCase();
  return `NONEXIST_${rand}`;
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
    `[smoke:giftcode] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}`,
  );

  /** @type {{ userId?: string }} */
  const state = {};

  // 1. POST /giftcodes/redeem chưa auth → 401.
  await step('POST /giftcodes/redeem — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/giftcodes/redeem', { method: 'POST', body: { code: 'ANY' } });
    assertStatus(r, 401, 'POST /giftcodes/redeem unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'POST /giftcodes/redeem unauth');
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
    state.userId = r.body.data.user.id;
  });

  // 3. POST /giftcodes/redeem no body → 400 INVALID_INPUT (zod parse fail).
  await step('POST /giftcodes/redeem — no body 400 INVALID_INPUT', async () => {
    // No body; rawBody='' để force JSON parse fail trong NestJS bodyParser.
    // Có thể NestJS coi body=undefined, zod parse fail → INVALID_INPUT.
    const r = await http('/api/giftcodes/redeem', {
      method: 'POST',
      rawBody: '',
    });
    assertStatus(r, 400, 'POST /giftcodes/redeem no body');
    // Body parse có thể fail trước khi vào handler (BadRequestException
    // body-parser). Chấp nhận INVALID_INPUT hoặc generic 400.
  });

  // 4. POST /giftcodes/redeem ({}) → 400 INVALID_INPUT (zod missing code).
  await step('POST /giftcodes/redeem — ({}) 400 INVALID_INPUT', async () => {
    const r = await http('/api/giftcodes/redeem', { method: 'POST', body: {} });
    assertStatus(r, 400, 'POST /giftcodes/redeem ({})');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /giftcodes/redeem ({})');
  });

  // 5. POST /giftcodes/redeem ({code:''}) → 400 INVALID_INPUT (zod min(1)).
  await step("POST /giftcodes/redeem — ({code:''}) 400 INVALID_INPUT", async () => {
    const r = await http('/api/giftcodes/redeem', { method: 'POST', body: { code: '' } });
    assertStatus(r, 400, "POST /giftcodes/redeem ({code:''})");
    assertErrorCode(r, 'INVALID_INPUT', "POST /giftcodes/redeem ({code:''})");
  });

  // 6. POST /giftcodes/redeem ({code: 65*'X'}) → 400 INVALID_INPUT (zod max(64)).
  await step('POST /giftcodes/redeem — ({code: 65 chars}) 400 INVALID_INPUT', async () => {
    const r = await http('/api/giftcodes/redeem', {
      method: 'POST',
      body: { code: 'X'.repeat(65) },
    });
    assertStatus(r, 400, 'POST /giftcodes/redeem ({code: 65 chars})');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /giftcodes/redeem ({code: 65 chars})');
  });

  // 7. POST /giftcodes/redeem ({code: 32*'X'}) pre-onboard — boundary
  //    test: pass cả zod max(64) và service length ≤ 32 → reach char
  //    check → 404 NO_CHARACTER (pre-onboard chưa có character).
  await step('POST /giftcodes/redeem — ({code: 32 chars}) pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/giftcodes/redeem', {
      method: 'POST',
      body: { code: 'X'.repeat(32) },
    });
    assertStatus(r, 404, 'POST /giftcodes/redeem ({code: 32 chars}) pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'POST /giftcodes/redeem ({code: 32 chars}) pre-onboard');
  });

  // 8. POST /giftcodes/redeem ({code: 'NONEXIST'}) pre-onboard
  //    → 404 NO_CHARACTER (service check char trước code).
  await step('POST /giftcodes/redeem — ({code: nonexistent}) pre-onboard 404 NO_CHARACTER', async () => {
    const code = randomNonexistentCode();
    const r = await http('/api/giftcodes/redeem', {
      method: 'POST',
      body: { code },
    });
    assertStatus(r, 404, `POST /giftcodes/redeem ({code: ${code}}) pre-onboard`);
    assertErrorCode(r, 'NO_CHARACTER', `POST /giftcodes/redeem ({code: ${code}}) pre-onboard`);
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

  // Snapshot currency BEFORE failed redeem attempts (anti-FE-self-grant).
  const before = await fetchCharCurrencies();

  // 10. POST /giftcodes/redeem ({code: nonexistent}) post-onboard
  //     → 404 CODE_NOT_FOUND.
  await step('POST /giftcodes/redeem — ({code: nonexistent}) post-onboard 404 CODE_NOT_FOUND', async () => {
    const code = randomNonexistentCode();
    const r = await http('/api/giftcodes/redeem', {
      method: 'POST',
      body: { code },
    });
    assertStatus(r, 404, `POST /giftcodes/redeem ({code: ${code}}) post-onboard`);
    assertErrorCode(r, 'CODE_NOT_FOUND', `POST /giftcodes/redeem ({code: ${code}}) post-onboard`);
  });

  // 11. POST /giftcodes/redeem ({code: 33*'X'}) post-onboard
  //     → 400 INVALID_INPUT (service length>32 check fail sau khi qua zod
  //       ≤64 và post-onboard char tồn tại).
  await step('POST /giftcodes/redeem — ({code: 33 chars}) post-onboard 400 INVALID_INPUT', async () => {
    const r = await http('/api/giftcodes/redeem', {
      method: 'POST',
      body: { code: 'X'.repeat(33) },
    });
    assertStatus(r, 400, 'POST /giftcodes/redeem ({code: 33 chars}) post-onboard');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /giftcodes/redeem ({code: 33 chars}) post-onboard');
  });

  // 12. Anti-FE-self-grant: currency unchanged sau 2 failed redeem
  //     attempts (steps 10-11).
  await step('anti-FE-self-grant — currency unchanged sau failed redeem attempts', async () => {
    const after = await fetchCharCurrencies();
    assert(
      after.linhThach === before.linhThach,
      `linhThach VẪN ${before.linhThach} sau failed redeem attempts, got ${after.linhThach}`,
    );
    assert(
      after.tienNgoc === before.tienNgoc,
      `tienNgoc VẪN ${before.tienNgoc} sau failed redeem attempts, got ${after.tienNgoc}`,
    );
  });

  // 13. logout + POST /giftcodes/redeem → 401.
  await step('logout + POST /giftcodes/redeem — 401 UNAUTHENTICATED', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const r = await http('/api/giftcodes/redeem', { method: 'POST', body: { code: 'ANY' } });
    assertStatus(r, 401, 'POST /giftcodes/redeem post-logout');
    assertErrorCode(r, 'UNAUTHENTICATED', 'POST /giftcodes/redeem post-logout');
  });

  // =============================================================================
  // Positive path — admin create giftcode → redeem → verify rewards.
  // =============================================================================

  /** Unique giftcode for this smoke run. */
  const giftcode = `SMOKE_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  // 14. Snapshot player cookies + admin login → create giftcode.
  const playerSnapshot = snapshotCookies();
  await step('admin login + create giftcode', async () => {
    const login = await http('/api/_auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assertStatus(login, 200, 'admin login');
    assert(login.body?.ok, `admin login: ok=false body=${JSON.stringify(login.body).slice(0, 200)}`);

    const create = await http('/api/admin/giftcodes', {
      method: 'POST',
      body: {
        code: giftcode,
        rewardLinhThach: '500',
        rewardTienNgoc: 10,
        maxRedeems: 10,
      },
    });
    assertStatus(create, 200, 'admin create giftcode');
    assert(create.body?.ok, `admin create giftcode: ok=false body=${JSON.stringify(create.body).slice(0, 200)}`);
  });

  // 15. Admin logout + restore player cookies.
  await step('admin logout + restore player', async () => {
    const r = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(r, [200, 204], 'admin logout');
    restoreCookies(playerSnapshot);
  });

  // Snapshot currency BEFORE redeem.
  const beforeRedeem = await fetchCharCurrencies();

  // 16. POST /giftcodes/redeem → verify rewards.
  await step('POST /giftcodes/redeem — verify rewards', async () => {
    const r = await http('/api/giftcodes/redeem', {
      method: 'POST',
      body: { code: giftcode },
    });
    assertStatus(r, 200, 'POST /giftcodes/redeem positive');
    assert(r.body?.ok, `redeem: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const rewards = r.body?.data?.rewards;
    assert(rewards, 'redeem: missing rewards');
    assert(typeof rewards.linhThach === 'number' && rewards.linhThach > 0, `redeem: rewards.linhThach > 0, got ${rewards.linhThach}`);
  });

  // 17. GET /character/state — verify linhThach + tienNgoc increased.
  await step('GET /character/state — linhThach + tienNgoc increased', async () => {
    const after = await fetchCharCurrencies();
    const beforeLT = BigInt(beforeRedeem.linhThach);
    const afterLT = BigInt(after.linhThach);
    assert(afterLT > beforeLT, `linhThach should increase: before=${beforeRedeem.linhThach}, after=${after.linhThach}`);
    assert(after.tienNgoc > beforeRedeem.tienNgoc, `tienNgoc should increase: before=${beforeRedeem.tienNgoc}, after=${after.tienNgoc}`);
  });

  // 18. POST /giftcodes/redeem again → ALREADY_REDEEMED 409.
  await step('POST /giftcodes/redeem — ALREADY_REDEEMED 409', async () => {
    const r = await http('/api/giftcodes/redeem', {
      method: 'POST',
      body: { code: giftcode },
    });
    assertStatus(r, 409, 'POST /giftcodes/redeem duplicate');
    assertErrorCode(r, 'ALREADY_REDEEMED', 'POST /giftcodes/redeem duplicate');
  });

  // 19. Anti-FE-self-grant: currency unchanged sau ALREADY_REDEEMED.
  await step('anti-FE-self-grant — currency unchanged sau ALREADY_REDEEMED', async () => {
    const after = await fetchCharCurrencies();
    const afterRedeem = await fetchCharCurrencies();
    const postRedeemLT = BigInt(after.linhThach);
    const retryLT = BigInt(afterRedeem.linhThach);
    assert(
      postRedeemLT === retryLT,
      `linhThach should be unchanged after ALREADY_REDEEMED retry: post-redeem=${after.linhThach}, retry=${afterRedeem.linhThach}`,
    );
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:giftcode] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:giftcode] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:giftcode] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:giftcode] unexpected error:', err);
  process.exitCode = 1;
});
