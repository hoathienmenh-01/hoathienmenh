#!/usr/bin/env node
/**
 * smoke-shop.mjs — NPC Shop endpoints smoke cho Xuân Tôi.
 *
 * Negative-path-focused + positive buy path (Phase 9 deferred — unblocked
 * PR #389 admin grant-currency endpoint). Positive: admin grant LinhThach
 * 25 → POST /shop/buy {itemKey:'huyet_chi_dan', qty:1} → atomic spend
 * + grant inventory + ledger SHOP_BUY (per service order: currency.applyTx
 * → inventory.grantTx).
 *
 * Mục tiêu: cover 2 shop endpoints qua HTTP (`apps/api/src/modules/shop`):
 *   - `GET  /api/shop/npc` — list NPC shop entries (auth, không cần
 *                            char — chỉ require user id).
 *   - `POST /api/shop/buy` — mua item (auth + zod itemKey 1-64 chars +
 *                            qty int 1-99 + service order qty validate
 *                            → catalog (`npcShopByKey`) → stackable
 *                            check → char findUnique → atomic
 *                            `currency.applyTx + inventory.grantTx`).
 *
 * Service order (`shop.service.ts:51-107`): qty validate (defensive
 * sau zod) → `npcShopByKey(itemKey)` → `itemByKey(itemKey)` → stackable
 * check → `prisma.character.findUnique({ userId })` → atomic `$transaction`
 * `currency.applyTx({ delta: -BigInt(totalPrice), reason: 'SHOP_BUY' })`
 * + `inventory.grantTx`.
 *
 * Critical observation — service catalog check TRƯỚC char check:
 *   - Pre-onboard với bogus itemKey → service fires ITEM_NOT_IN_SHOP
 *     404 trước khi reach char findUnique → verify catalog gate trước
 *     char gate.
 *   - Pre-onboard với valid itemKey + qty=1 → service: qty pass →
 *     catalog pass → stackable pass (huyet_chi_dan stackable=true) →
 *     char findUnique null → NO_CHARACTER 404.
 *   - Post-onboard với non-stackable item + qty=2 → service: qty pass
 *     → catalog pass → stackable check fails → NON_STACKABLE_QTY_GT_1
 *     400 trước char check.
 *   - Post-onboard fresh char (0 LT) với valid item + qty=1 → service:
 *     qty pass → catalog pass → stackable pass → char pass → atomic tx
 *     → currency.applyTx insufficient → INSUFFICIENT_FUNDS 409.
 *
 * 20-step (was 14 negative-only — extended +6 positive-path post-#389):
 *   1.  `GET  /api/shop/npc` (no auth) → 401 UNAUTHENTICATED.
 *   2.  `POST /api/shop/buy` (no auth) → 401 UNAUTHENTICATED.
 *   3.  `POST /api/_auth/register` — fresh user.
 *   4.  `GET  /api/shop/npc` (auth, pre-onboard) → 200 entries[] shape
 *                                                  verify (entries
 *                                                  array, contain
 *                                                  so_kiem stackable
 *                                                  false + huyet_chi_dan
 *                                                  stackable true, both
 *                                                  có price > 0 +
 *                                                  currency LINH_THACH).
 *                                                  No char required.
 *   5.  `POST /api/shop/buy` ({}) → 400 INVALID_INPUT (zod missing).
 *   6.  `POST /api/shop/buy` ({itemKey:'huyet_chi_dan', qty:0}) → 400
 *                                                  INVALID_INPUT
 *                                                  (zod min(1)).
 *   7.  `POST /api/shop/buy` ({itemKey:'huyet_chi_dan', qty:100}) → 400
 *                                                  INVALID_INPUT
 *                                                  (zod max(99)).
 *   8.  `POST /api/shop/buy` ({itemKey:'bogus', qty:1}) pre-onboard →
 *                                                  404 ITEM_NOT_IN_SHOP
 *                                                  (service catalog
 *                                                  miss BEFORE char
 *                                                  check).
 *   9.  `POST /api/shop/buy` ({itemKey:'huyet_chi_dan', qty:1})
 *                                                  pre-onboard → 404
 *                                                  NO_CHARACTER
 *                                                  (catalog pass +
 *                                                  stackable pass +
 *                                                  char null).
 *  10.  `POST /api/character/onboard` — fresh char (auto-join thanh_van,
 *                                       0 LT, 0 TN).
 *  11.  `POST /api/shop/buy` ({itemKey:'bogus', qty:1}) post-onboard →
 *                                                  404 ITEM_NOT_IN_SHOP
 *                                                  (catalog miss luôn
 *                                                  TRƯỚC char check
 *                                                  bất kể có char hay
 *                                                  không).
 *  12.  `POST /api/shop/buy` ({itemKey:'so_kiem', qty:2}) post-onboard →
 *                                                  400 NON_STACKABLE_QTY_GT_1
 *                                                  (so_kiem stackable=false,
 *                                                  service order: qty
 *                                                  → catalog → stackable
 *                                                  fail TRƯỚC char +
 *                                                  funds).
 *  13.  `POST /api/shop/buy` ({itemKey:'huyet_chi_dan', qty:1})
 *                                                  post-onboard fresh
 *                                                  0 LT → 409
 *                                                  INSUFFICIENT_FUNDS
 *                                                  (service: qty pass
 *                                                  → catalog pass →
 *                                                  stackable pass →
 *                                                  char pass → atomic
 *                                                  tx applyTx fail
 *                                                  → CurrencyError
 *                                                  → ShopError(INSUFFICIENT_FUNDS)
 *                                                  qua 409).
 *  13.5.Anti-FE-self-grant invariant snapshot — currency KHÔNG đổi
 *                                                  qua 3 failed buys
 *                                                  (cô lập trước
 *                                                  positive seed).
 *  14.  admin login + grant-currency LINH_THACH 25 (PR #389) +
 *                                                  admin logout/
 *                                                  restore player.
 *  15.  `GET  /api/character/state` → linhThach=25 post-grant.
 *  16.  `GET  /api/inventory` pre-buy → KHÔNG có huyet_chi_dan row.
 *  17.  `POST /api/shop/buy` ({itemKey:'huyet_chi_dan', qty:1})
 *                                                  post-grant 25 LT
 *                                                  → 200 atomic spend
 *                                                  25 LT + grant 1
 *                                                  huyet_chi_dan +
 *                                                  ledger SHOP_BUY
 *                                                  (data.totalPrice=
 *                                                  25, currency=LINH
 *                                                  _THACH).
 *  18.  `GET  /api/character/state` → linhThach=0 post-buy
 *                                                  (atomic spend).
 *  19.  `GET  /api/inventory` post-buy → huyet_chi_dan stack qty=1
 *                                                  (server grantTx,
 *                                                  KHÔNG do FE tự
 *                                                  cộng).
 *  20.  `POST /api/_auth/logout` + `GET /api/shop/npc` → 401.
 *
 * Chạy:
 *   pnpm smoke:shop
 *   # hoặc trực tiếp:
 *   node scripts/smoke-shop.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE       — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS     — default 10000ms / request.
 *   SMOKE_VERBOSE        — "1" để log request/response (debug).
 *   SMOKE_ADMIN_EMAIL    — default "admin@example.com" (bootstrap admin).
 *   SMOKE_ADMIN_PASSWORD — default "change-me-bootstrap-pass".
 *
 * Yêu cầu môi trường:
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api bootstrap` (seed admin user)
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:shop`
 *
 * Mutation footprint:
 *   - 1 fresh user + 1 fresh character + auto-joined thanh_van sect.
 *   - Admin grant-currency 25 LT → 1 CurrencyLedger row
 *     reason='ADMIN_GRANT' + 1 AdminAuditLog row action='admin.currency
 *     .grant'.
 *   - Shop buy 1× huyet_chi_dan → 1 CurrencyLedger row reason='SHOP_BUY'
 *     delta=-25 + 1 ItemLedger row reason='SHOP_BUY' qty=+1 + 1
 *     CharacterInventory row qty=1.
 *
 * Defer:
 *   - INVALID_QTY 400 từ service (qty không integer hoặc bypass zod)
 *     defer cho simplicity — đã cover INVALID_INPUT 400 từ zod.
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

// Items in NPC_SHOP catalog used for verification:
const STACKABLE_PILL = 'huyet_chi_dan'; // stackable=true, price 25 LT.
const NON_STACKABLE_WEAPON = 'so_kiem'; // stackable=false, price 30 LT.

// Shop buy positive-path — admin grant-currency LinhThach 25 →
// POST /shop/buy {itemKey:'huyet_chi_dan', qty:1} → atomic spend 25 LT
// + grant 1 inventory stack + CurrencyLedger reason='SHOP_BUY' +
// ItemLedger reason='SHOP_BUY' (per service order: currency.applyTx →
// inventory.grantTx).
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'change-me-bootstrap-pass';

/** State giữa các step (giống smoke:skill cookie-jar swap pattern). */
const state = {
  /** @type {string | null} */
  userId: null,
};

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
// HTTP helper.
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
  process.stdout.write(`[smoke:shop] ${name} ... `);
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
  return `smoke-shop-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `shp_${rand}`;
}

function randomBogusItemKey() {
  const rand = Math.random().toString(36).slice(2, 12);
  return `bogus_item_${rand}`;
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
  console.log(`[smoke:shop] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms`);

  // 1. GET /shop/npc (no auth) → 401.
  await step('GET /shop/npc — 401 UNAUTHENTICATED (no auth)', async () => {
    const r = await http('/api/shop/npc');
    assertStatus(r, 401, 'GET /shop/npc unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'GET /shop/npc unauth');
  });

  // 2. POST /shop/buy (no auth) → 401.
  await step('POST /shop/buy — 401 UNAUTHENTICATED (no auth)', async () => {
    const r = await http('/api/shop/buy', {
      method: 'POST',
      body: { itemKey: STACKABLE_PILL, qty: 1 },
    });
    assertStatus(r, 401, 'POST /shop/buy unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'POST /shop/buy unauth');
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
    state.userId = r.body?.data?.user?.id ?? null;
  });

  // 4. GET /shop/npc auth pre-onboard → 200 entries[] shape (no char
  //    required — controller chỉ check userId).
  await step('GET /shop/npc — pre-onboard 200 entries[] shape', async () => {
    const r = await http('/api/shop/npc');
    assertStatus(r, 200, 'GET /shop/npc pre-onboard');
    if (!r.body?.ok)
      throw new Error(`GET /shop/npc: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const entries = r.body?.data?.entries;
    assert(Array.isArray(entries), 'GET /shop/npc: entries not array');
    assert(entries.length > 0, 'GET /shop/npc: entries empty');
    const pill = entries.find((e) => e.itemKey === STACKABLE_PILL);
    assert(pill, `GET /shop/npc: missing ${STACKABLE_PILL}`);
    assert(pill.stackable === true, `${STACKABLE_PILL}: expect stackable=true`);
    assert(typeof pill.price === 'number' && pill.price > 0, `${STACKABLE_PILL}: invalid price`);
    assert(pill.currency === 'LINH_THACH', `${STACKABLE_PILL}: expect LINH_THACH currency`);
    const weapon = entries.find((e) => e.itemKey === NON_STACKABLE_WEAPON);
    assert(weapon, `GET /shop/npc: missing ${NON_STACKABLE_WEAPON}`);
    assert(weapon.stackable === false, `${NON_STACKABLE_WEAPON}: expect stackable=false`);
    assert(typeof weapon.price === 'number' && weapon.price > 0, `${NON_STACKABLE_WEAPON}: invalid price`);
  });

  // 5. POST /shop/buy ({}) → 400 INVALID_INPUT (zod missing).
  await step('POST /shop/buy — ({}) 400 INVALID_INPUT (zod missing)', async () => {
    const r = await http('/api/shop/buy', { method: 'POST', body: {} });
    assertStatus(r, 400, 'POST /shop/buy ({})');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /shop/buy ({})');
  });

  // 6. POST /shop/buy (qty:0) → 400 INVALID_INPUT (zod min(1)).
  await step('POST /shop/buy — (qty:0) 400 INVALID_INPUT (zod min(1))', async () => {
    const r = await http('/api/shop/buy', {
      method: 'POST',
      body: { itemKey: STACKABLE_PILL, qty: 0 },
    });
    assertStatus(r, 400, 'POST /shop/buy qty:0');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /shop/buy qty:0');
  });

  // 7. POST /shop/buy (qty:100) → 400 INVALID_INPUT (zod max(99)).
  await step('POST /shop/buy — (qty:100) 400 INVALID_INPUT (zod max(99))', async () => {
    const r = await http('/api/shop/buy', {
      method: 'POST',
      body: { itemKey: STACKABLE_PILL, qty: 100 },
    });
    assertStatus(r, 400, 'POST /shop/buy qty:100');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /shop/buy qty:100');
  });

  // 8. POST /shop/buy (bogus item, qty:1) pre-onboard → 404
  //    ITEM_NOT_IN_SHOP (service catalog miss TRƯỚC char check).
  await step('POST /shop/buy — (bogus item) pre-onboard 404 ITEM_NOT_IN_SHOP', async () => {
    const r = await http('/api/shop/buy', {
      method: 'POST',
      body: { itemKey: randomBogusItemKey(), qty: 1 },
    });
    assertStatus(r, 404, 'POST /shop/buy bogus pre-onboard');
    assertErrorCode(r, 'ITEM_NOT_IN_SHOP', 'POST /shop/buy bogus pre-onboard');
  });

  // 9. POST /shop/buy (valid pill, qty:1) pre-onboard → 404
  //    NO_CHARACTER (catalog pass + stackable pass + char null).
  await step('POST /shop/buy — (valid pill, qty:1) pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/shop/buy', {
      method: 'POST',
      body: { itemKey: STACKABLE_PILL, qty: 1 },
    });
    assertStatus(r, 404, 'POST /shop/buy valid pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'POST /shop/buy valid pre-onboard');
  });

  // 10. Onboard fresh char.
  await step('onboard — create character (auto-join thanh_van)', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: randomCharName(), sectKey: 'thanh_van' },
    });
    assertStatus(r, 200, 'onboard');
    if (!r.body?.ok)
      throw new Error(`onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.character?.id, 'onboard: missing character.id');
  });

  // Snapshot currency BEFORE failed buys steps 11-14.
  const before = await fetchCharCurrencies();

  // 11. POST /shop/buy (bogus item, qty:1) post-onboard → 404
  //     ITEM_NOT_IN_SHOP (catalog miss vẫn fires TRƯỚC char check
  //     bất kể có char hay không — verify service order consistency).
  await step('POST /shop/buy — (bogus item) post-onboard 404 ITEM_NOT_IN_SHOP', async () => {
    const r = await http('/api/shop/buy', {
      method: 'POST',
      body: { itemKey: randomBogusItemKey(), qty: 1 },
    });
    assertStatus(r, 404, 'POST /shop/buy bogus post-onboard');
    assertErrorCode(r, 'ITEM_NOT_IN_SHOP', 'POST /shop/buy bogus post-onboard');
  });

  // 12. POST /shop/buy (so_kiem, qty:2) post-onboard → 400
  //     NON_STACKABLE_QTY_GT_1 (so_kiem stackable=false; service: qty
  //     pass → catalog pass → stackable check fails TRƯỚC char + funds).
  await step('POST /shop/buy — (so_kiem, qty:2) post-onboard 400 NON_STACKABLE_QTY_GT_1', async () => {
    const r = await http('/api/shop/buy', {
      method: 'POST',
      body: { itemKey: NON_STACKABLE_WEAPON, qty: 2 },
    });
    assertStatus(r, 400, 'POST /shop/buy so_kiem qty:2');
    assertErrorCode(r, 'NON_STACKABLE_QTY_GT_1', 'POST /shop/buy so_kiem qty:2');
  });

  // 13. POST /shop/buy (huyet_chi_dan, qty:1) post-onboard fresh 0 LT
  //     → 409 INSUFFICIENT_FUNDS (service: qty pass → catalog pass →
  //     stackable pass → char pass → atomic tx fail at currency.applyTx
  //     → ShopError(INSUFFICIENT_FUNDS)).
  await step('POST /shop/buy — (huyet_chi_dan, qty:1) post-onboard fresh 0 LT 409 INSUFFICIENT_FUNDS', async () => {
    const r = await http('/api/shop/buy', {
      method: 'POST',
      body: { itemKey: STACKABLE_PILL, qty: 1 },
    });
    assertStatus(r, 409, 'POST /shop/buy fresh 0 LT');
    assertErrorCode(r, 'INSUFFICIENT_FUNDS', 'POST /shop/buy fresh 0 LT');
  });

  // 13.5. anti-FE-self-grant invariant (failed buys 11-13): linhThach +
  //       tienNgoc KHÔNG đổi qua 3 failed buys (catalog miss / stackable
  //       fail / atomic INSUFFICIENT_FUNDS rollback). Snapshot trước positive
  //       path để cô lập invariant chỉ với failed buys.
  await step('anti-FE-self-grant — currency KHÔNG đổi qua 3 failed buys 11-13', async () => {
    const afterFailed = await fetchCharCurrencies();
    assert(
      afterFailed.linhThach === before.linhThach,
      `linhThach post-failed-buys: expect '${before.linhThach}', got '${afterFailed.linhThach}'`,
    );
    assert(
      afterFailed.tienNgoc === before.tienNgoc,
      `tienNgoc post-failed-buys: expect ${before.tienNgoc}, got ${afterFailed.tienNgoc}`,
    );
  });

  // ---------------------------------------------------------------------------
  // POSITIVE PATH (Phase 9 deferred — unblocked PR #389 admin grant-currency).
  //
  // Snapshot before vs after invariant: linhThach 0 → 25 (admin grant) → 0
  // (shop spend), inventory huyet_chi_dan KHÔNG có row pre-buy → qty=1 row
  // post-buy. Atomic spend currency + grant inventory + 2 ledger entries
  // (CurrencyLedger reason='SHOP_BUY' delta=-25 + ItemLedger reason='SHOP_BUY'
  // qty=+1).
  // ---------------------------------------------------------------------------

  // 14. Snapshot player cookies + admin login swap → grant-currency 25 LT →
  //     restore player cookies.
  /** @type {Map<string,string> | null} */
  let playerCookieSnap = null;
  await step('admin login + grant-currency LINH_THACH 25 (seed shop buy)', async () => {
    if (!state.userId) throw new Error('state.userId missing — register chưa chạy');
    playerCookieSnap = snapshotCookies();
    cookieJar.clear();
    const login = await http('/api/_auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assertStatus(login, 200, 'admin login (shop buy seed)');
    const u = login.body?.data?.user;
    assert(u?.role === 'ADMIN', `admin login: role phải ADMIN, got ${u?.role}`);

    const grant = await http(`/api/admin/users/${state.userId}/grant-currency`, {
      method: 'POST',
      body: {
        currency: 'LINH_THACH',
        delta: '25',
        reason: 'smoke shop buy seed',
      },
    });
    assertStatus(grant, 200, 'admin grant-currency 25 LT');
    assert(
      grant.body?.ok === true && grant.body?.data?.ok === true,
      `grant-currency 25 LT: shape mismatch, got ${JSON.stringify(grant.body)}`,
    );

    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'admin logout (shop buy seed)');
    cookieJar.clear();
    if (!playerCookieSnap) throw new Error('playerCookieSnap missing');
    restoreCookies(playerCookieSnap);
  });

  // 15. GET /character/state → linhThach=25 (verify grant cộng đúng).
  await step('GET /character/state — linhThach=25 post-grant', async () => {
    const cur = await fetchCharCurrencies();
    assert(
      cur.linhThach === '25',
      `linhThach post-grant: expect '25', got '${cur.linhThach}'`,
    );
  });

  // 16. GET /api/inventory pre-buy: KHÔNG có huyet_chi_dan row.
  await step(`GET /inventory pre-buy — KHÔNG có ${STACKABLE_PILL} row (chưa mua)`, async () => {
    const r = await http('/api/inventory');
    assertStatus(r, 200, 'GET /inventory pre-buy');
    const items = r.body?.data?.items ?? [];
    assert(Array.isArray(items), 'GET /inventory pre-buy: items not array');
    const found = items.find((/** @type {any} */ it) => it.itemKey === STACKABLE_PILL);
    assert(!found, `GET /inventory pre-buy: ${STACKABLE_PILL} đã có (expect chưa mua, got qty=${found?.qty})`);
  });

  // 17. POST /shop/buy huyet_chi_dan qty=1 → 200 atomic spend 25 LT + grant 1
  //     inventory + ledger SHOP_BUY (currency.applyTx + inventory.grantTx).
  await step(`POST /shop/buy — (${STACKABLE_PILL}, qty:1) post-grant 25 LT → 200 atomic`, async () => {
    const r = await http('/api/shop/buy', {
      method: 'POST',
      body: { itemKey: STACKABLE_PILL, qty: 1 },
    });
    assertStatus(r, 200, 'POST /shop/buy positive');
    if (!r.body?.ok) throw new Error(`shop/buy: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const data = r.body?.data;
    assert(data, 'shop/buy positive: missing data');
    assert(data.itemKey === STACKABLE_PILL, `shop/buy.itemKey: expect ${STACKABLE_PILL}, got ${data.itemKey}`);
    assert(data.qty === 1, `shop/buy.qty: expect 1, got ${data.qty}`);
    assert(data.totalPrice === 25, `shop/buy.totalPrice: expect 25, got ${data.totalPrice}`);
    assert(data.currency === 'LINH_THACH', `shop/buy.currency: expect LINH_THACH, got ${data.currency}`);
  });

  // 18. GET /character/state → linhThach=0 post-spend (25 - 25 = 0, atomic).
  await step('GET /character/state — linhThach=0 post-buy (25 LT - 25 LT)', async () => {
    const cur = await fetchCharCurrencies();
    assert(
      cur.linhThach === '0',
      `linhThach post-buy: expect '0' (25 grant - 25 spend), got '${cur.linhThach}'`,
    );
  });

  // 19. GET /inventory post-buy → huyet_chi_dan stack qty=1 (grantTx
  //     server-authoritative, KHÔNG do FE tự cộng).
  await step(`GET /inventory post-buy — ${STACKABLE_PILL} qty=1 (server grantTx)`, async () => {
    const r = await http('/api/inventory');
    assertStatus(r, 200, 'GET /inventory post-buy');
    const items = r.body?.data?.items ?? [];
    const found = items.find((/** @type {any} */ it) => it.itemKey === STACKABLE_PILL);
    assert(found, `GET /inventory post-buy: thiếu ${STACKABLE_PILL} stack (expect grantTx tạo row)`);
    assert(found.qty === 1, `${STACKABLE_PILL}.qty: expect 1, got ${found.qty}`);
  });

  // 20. logout + GET /shop/npc 401.
  await step('logout + GET /shop/npc 401', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const npcAfter = await http('/api/shop/npc');
    assertStatus(npcAfter, 401, 'GET /shop/npc post-logout');
    assertErrorCode(npcAfter, 'UNAUTHENTICATED', 'GET /shop/npc post-logout');
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:shop] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:shop] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:shop] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:shop] unexpected error:', err);
  process.exitCode = 1;
});
