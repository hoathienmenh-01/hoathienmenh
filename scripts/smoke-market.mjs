#!/usr/bin/env node
/**
 * smoke-market.mjs — Market listings/post/buy/cancel/mine endpoints smoke
 * cho Xuân Tôi.
 *
 * Negative-path-only — positive post/buy/cancel path yêu cầu inventory item
 * thực (qua `inventory.grantTx` từ dungeon drop / craft / mail) → defer cho
 * future smoke với gameplay automation hoặc admin `inventory.grant` seed.
 * Tương tự positive buy path yêu cầu listing tồn tại + buyer khác seller +
 * buyer có đủ linh thạch → defer.
 *
 * Mục tiêu: cover 5 market endpoints qua HTTP — `apps/api/src/modules/market`:
 *   - `GET  /api/market/listings`     — list active listings (filter optional
 *                                       `?kind=WEAPON|ARMOR|...`).
 *   - `GET  /api/market/mine`         — list my own listings (any status).
 *   - `POST /api/market/post`         — post listing với atomic `$transaction`
 *                                       trừ inventory + create listing.
 *   - `POST /api/market/<id>/buy`     — buy listing với atomic `$transaction`
 *                                       trừ buyer linh thạch + cộng seller
 *                                       (after fee) + grant item to buyer.
 *   - `POST /api/market/<id>/cancel`  — cancel own listing với atomic flip
 *                                       `ACTIVE → CANCELLED` + return item to
 *                                       seller inventory.
 *
 * Verify auth gate (401 unauth × 2), NO_CHARACTER 404 (controller
 * `requireCharacter` check char *trước* zod parse cho /post → pre-onboard
 * với valid hoặc invalid body đều → NO_CHARACTER), INVALID_INPUT 400 (zod
 * fail post-onboard cho /post: missing fields / qty không phải positive int /
 * pricePerUnit không phải positive int hoặc string regex `/^[0-9]+$/`),
 * INVENTORY_ITEM_NOT_FOUND 404 (post-onboard, valid zod body nhưng
 * inventoryItemId không tồn tại trong DB hoặc không thuộc về char), LISTING_NOT_FOUND
 * 404 (post-onboard, listing id không tồn tại cho /buy + /cancel), shape contract
 * cho /listings (listings array + feePct number) và /mine (listings array
 * non-null), và anti-FE-self-grant invariant (failed post/buy/cancel attempts
 * KHÔNG đụng linhThach/tienNgoc).
 *
 * 14-step:
 *   1.  `GET  /api/market/listings`            (no auth)         → 401.
 *   2.  `POST /api/market/post`                (no auth)         → 401.
 *   3.  `POST /api/_auth/register`                               — fresh
 *                                                                user.
 *   4.  `GET  /api/market/listings`            (pre-onboard)     → 404
 *                                                                NO_CHARACTER.
 *   5.  `POST /api/market/post`                (pre-onboard)     → 404
 *                                                                NO_CHARACTER
 *                                                                (controller
 *                                                                `requireCharacter`
 *                                                                check
 *                                                                trước zod).
 *   6.  `POST /api/market/{bogus}/buy`         (pre-onboard)     → 404
 *                                                                NO_CHARACTER.
 *   7.  `POST /api/character/onboard`                            — fresh
 *                                                                char.
 *   8.  `POST /api/market/post`                ({})              → 400
 *                                                                INVALID_INPUT
 *                                                                (zod missing
 *                                                                inventoryItemId
 *                                                                /qty
 *                                                                /pricePerUnit).
 *   9.  `POST /api/market/post`                (qty:-1)          → 400
 *                                                                INVALID_INPUT
 *                                                                (zod qty
 *                                                                positive
 *                                                                int).
 *  10.  `POST /api/market/post`                (valid body, fake
 *                                              inv id)           → 404
 *                                                                INVENTORY_ITEM_NOT_FOUND
 *                                                                (service
 *                                                                findUnique
 *                                                                inv).
 *  11.  `POST /api/market/{bogus}/buy`         (post-onboard)    → 404
 *                                                                LISTING_NOT_FOUND.
 *  12.  `POST /api/market/{bogus}/cancel`      (post-onboard)    → 404
 *                                                                LISTING_NOT_FOUND.
 *  13.  `GET  /api/market/listings` + `GET /api/market/mine`     → 200
 *                                              (post-onboard)     shape
 *                                                                contract
 *                                                                (listings
 *                                                                array +
 *                                                                feePct
 *                                                                number).
 *  14.  `anti-FE-self-grant` snapshot currency before/after fail attempts
 *                                                                + logout
 *                                                                + GET
 *                                                                /listings
 *                                                                401.
 *
 * Chạy:
 *   pnpm smoke:market
 *   # hoặc trực tiếp:
 *   node scripts/smoke-market.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE   — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS — default 10000ms / request.
 *   SMOKE_VERBOSE    — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY   — default "thanh_van".
 *
 * Yêu cầu môi trường:
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:market`
 *
 * Defer:
 *   - Positive post path (admin grant inv item → POST /market/post → atomic
 *     `$transaction` { qty deduct or row delete + Listing.create
 *     status=ACTIVE } → ListingView return).
 *   - Positive buy path (seller post → buyer /buy → atomic
 *     `$transaction` { CAS flip ACTIVE → SOLD + buyer linhThach -= total
 *     + seller linhThach += total*(1-feePct) + grant item to buyer
 *     inventory } → BUYER_LINH_THACH ledger entry).
 *   - Positive cancel path (seller post → seller /cancel → atomic
 *     `$transaction` { CAS flip ACTIVE → CANCELLED + return item } →
 *     ListingView return).
 *   - INSUFFICIENT_LINH_THACH 409 (buyer thiếu linh thạch khi /buy).
 *   - CANNOT_BUY_OWN 409 (seller thử /buy chính listing của mình).
 *   - NOT_OWNER 409 (non-seller thử /cancel listing của người khác).
 *   - LISTING_INACTIVE 409 (CAS conflict — listing đã sold/cancelled bởi
 *     concurrent call).
 *   Tất cả yêu cầu admin `inventory.grant` seed hoặc gameplay automation
 *   → defer.
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
  process.stdout.write(`[smoke:market] ${name} ... `);
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
  return `smoke-market-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `mkt_${rand}`;
}

function randomBogusId() {
  const rand = Math.random().toString(36).slice(2, 12);
  return `bogus_${rand}`;
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
    `[smoke:market] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}`,
  );

  // 1. GET /market/listings chưa auth → 401.
  await step('GET /market/listings — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/market/listings');
    assertStatus(r, 401, 'GET /market/listings unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'GET /market/listings unauth');
  });

  // 2. POST /market/post chưa auth → 401.
  await step('POST /market/post — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/market/post', {
      method: 'POST',
      body: { inventoryItemId: 'x', qty: 1, pricePerUnit: 100 },
    });
    assertStatus(r, 401, 'POST /market/post unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'POST /market/post unauth');
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

  // 4. GET /market/listings pre-onboard → 404 NO_CHARACTER.
  await step('GET /market/listings — pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/market/listings');
    assertStatus(r, 404, 'GET /market/listings pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'GET /market/listings pre-onboard');
  });

  // 5. POST /market/post pre-onboard → 404 NO_CHARACTER (controller
  //    requireCharacter check char *trước* zod parse, body invalid không
  //    matter — vẫn 404).
  await step('POST /market/post — pre-onboard 404 NO_CHARACTER (char check trước zod)', async () => {
    const r = await http('/api/market/post', {
      method: 'POST',
      body: { inventoryItemId: 'x', qty: 1, pricePerUnit: 100 },
    });
    assertStatus(r, 404, 'POST /market/post pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'POST /market/post pre-onboard');
  });

  // 6. POST /market/<bogus>/buy pre-onboard → 404 NO_CHARACTER.
  await step('POST /market/<bogus>/buy — pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http(`/api/market/${randomBogusId()}/buy`, { method: 'POST' });
    assertStatus(r, 404, 'POST /market/<bogus>/buy pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'POST /market/<bogus>/buy pre-onboard');
  });

  // 7. Onboard character.
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

  // 8. POST /market/post ({}) → 400 INVALID_INPUT (zod missing).
  await step('POST /market/post — ({}) 400 INVALID_INPUT', async () => {
    const r = await http('/api/market/post', { method: 'POST', body: {} });
    assertStatus(r, 400, 'POST /market/post ({})');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /market/post ({})');
  });

  // 9. POST /market/post (qty:-1) → 400 INVALID_INPUT (zod positive int).
  await step('POST /market/post — (qty:-1) 400 INVALID_INPUT', async () => {
    const r = await http('/api/market/post', {
      method: 'POST',
      body: { inventoryItemId: randomBogusId(), qty: -1, pricePerUnit: 100 },
    });
    assertStatus(r, 400, 'POST /market/post (qty:-1)');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /market/post (qty:-1)');
  });

  // Snapshot currency BEFORE failed post/buy/cancel attempts.
  const before = await fetchCharCurrencies();

  // 10. POST /market/post (valid zod, fake inv id) → 404 INVENTORY_ITEM_NOT_FOUND.
  await step('POST /market/post — (valid body, fake inv id) post-onboard 404 INVENTORY_ITEM_NOT_FOUND', async () => {
    const r = await http('/api/market/post', {
      method: 'POST',
      body: { inventoryItemId: randomBogusId(), qty: 1, pricePerUnit: 100 },
    });
    assertStatus(r, 404, 'POST /market/post (valid, fake inv id)');
    assertErrorCode(r, 'INVENTORY_ITEM_NOT_FOUND', 'POST /market/post (valid, fake inv id)');
  });

  // 11. POST /market/<bogus>/buy post-onboard → 404 LISTING_NOT_FOUND.
  await step('POST /market/<bogus>/buy — post-onboard 404 LISTING_NOT_FOUND', async () => {
    const r = await http(`/api/market/${randomBogusId()}/buy`, { method: 'POST' });
    assertStatus(r, 404, 'POST /market/<bogus>/buy post-onboard');
    assertErrorCode(r, 'LISTING_NOT_FOUND', 'POST /market/<bogus>/buy post-onboard');
  });

  // 12. POST /market/<bogus>/cancel post-onboard → 404 LISTING_NOT_FOUND.
  await step('POST /market/<bogus>/cancel — post-onboard 404 LISTING_NOT_FOUND', async () => {
    const r = await http(`/api/market/${randomBogusId()}/cancel`, { method: 'POST' });
    assertStatus(r, 404, 'POST /market/<bogus>/cancel post-onboard');
    assertErrorCode(r, 'LISTING_NOT_FOUND', 'POST /market/<bogus>/cancel post-onboard');
  });

  // 13. GET /market/listings + GET /market/mine post-onboard → 200 shape.
  await step('GET /market/listings + /market/mine — post-onboard 200 shape', async () => {
    const listings = await http('/api/market/listings');
    assertStatus(listings, 200, 'GET /market/listings post-onboard');
    if (!listings.body?.ok)
      throw new Error(`GET /market/listings: ok=false body=${JSON.stringify(listings.body).slice(0, 200)}`);
    const data1 = listings.body?.data;
    assert(Array.isArray(data1?.listings), 'GET /market/listings: data.listings not array');
    assert(typeof data1?.feePct === 'number', `GET /market/listings: data.feePct must be number, got ${typeof data1?.feePct}`);
    assert(data1.feePct >= 0 && data1.feePct <= 0.5, `GET /market/listings: feePct in [0,0.5], got ${data1.feePct}`);

    const mine = await http('/api/market/mine');
    assertStatus(mine, 200, 'GET /market/mine post-onboard');
    if (!mine.body?.ok)
      throw new Error(`GET /market/mine: ok=false body=${JSON.stringify(mine.body).slice(0, 200)}`);
    const data2 = mine.body?.data;
    assert(Array.isArray(data2?.listings), 'GET /market/mine: data.listings not array');
    // Fresh char chưa post listing nào → expect mine empty.
    assert(
      data2.listings.length === 0,
      `GET /market/mine: fresh char listings empty, got ${data2.listings.length}`,
    );
  });

  // 14. anti-FE-self-grant + logout + GET /listings 401.
  await step('anti-FE-self-grant + logout + GET /market/listings 401', async () => {
    const after = await fetchCharCurrencies();
    assert(
      after.linhThach === before.linhThach,
      `linhThach VẪN ${before.linhThach} sau failed post/buy/cancel, got ${after.linhThach}`,
    );
    assert(
      after.tienNgoc === before.tienNgoc,
      `tienNgoc VẪN ${before.tienNgoc} sau failed post/buy/cancel, got ${after.tienNgoc}`,
    );

    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const listings = await http('/api/market/listings');
    assertStatus(listings, 401, 'GET /market/listings post-logout');
    assertErrorCode(listings, 'UNAUTHENTICATED', 'GET /market/listings post-logout');
    const post = await http('/api/market/post', {
      method: 'POST',
      body: { inventoryItemId: 'x', qty: 1, pricePerUnit: 100 },
    });
    assertStatus(post, 401, 'POST /market/post post-logout');
    assertErrorCode(post, 'UNAUTHENTICATED', 'POST /market/post post-logout');
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:market] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:market] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:market] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:market] unexpected error:', err);
  process.exitCode = 1;
});
