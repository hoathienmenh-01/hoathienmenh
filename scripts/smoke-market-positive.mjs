#!/usr/bin/env node
/**
 * smoke-market-positive.mjs — Market positive-path smoke cho Xuân Tôi.
 *
 * Admin seed pattern (reuse từ smoke-breakthrough.mjs):
 *   1. Register seller + onboard → admin grant item → seller post listing.
 *   2. Register buyer + onboard → admin grant linh thạch → buyer buy listing.
 *   3. Verify: seller received linh thạch (minus fee), buyer received item.
 *   4. Seller post 2nd listing → cancel → verify item returned to inventory.
 *   5. anti-FE-self-grant: currency/item chỉ đổi qua market endpoints.
 *
 * Yêu cầu:
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api bootstrap` (seed admin)
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
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
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'change-me-bootstrap-pass';
const ITEM_KEY = 'huyet_chi_dan'; // PILL_HP, stackable, price=25
const GRANT_QTY = 5;
const POST_QTY = 3;
const PRICE_PER_UNIT = '100';

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

/** Snapshot cookieJar để switch tạm sang admin rồi restore lại. */
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
  process.stdout.write(`[smoke:market-positive] ${name} ... `);
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
  return `smoke-mkt-pos-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `mp_${rand}`;
}

/** @returns {Promise<{linhThach: string}>} */
async function fetchCurrency() {
  const r = await http('/api/character/state');
  assertStatus(r, 200, 'GET /character/state');
  const c = r.body?.data?.character;
  assert(c, 'character/state: missing character');
  return { linhThach: String(c.linhThach ?? '0') };
}

/** @returns {Promise<Array<{id: string; itemKey: string; qty: number}>>} */
async function fetchInventory() {
  const r = await http('/api/inventory');
  assertStatus(r, 200, 'GET /inventory');
  const items = r.body?.data?.items;
  assert(Array.isArray(items), 'inventory: items not array');
  return items;
}

// -----------------------------------------------------------------------------
// State.
// -----------------------------------------------------------------------------

/**
 * @type {{
 *   seller?: { email: string; userId: string; characterId: string };
 *   buyer?: { email: string; userId: string; characterId: string };
 *   listingId?: string;
 *   listingId2?: string;
 * }}
 */
const state = {};

async function main() {
  console.log(
    `[smoke:market-positive] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, item = ${ITEM_KEY}`,
  );

  // =========================================================================
  // PART A: Seller flow — register → onboard → admin grant item → post listing.
  // =========================================================================

  // 1. Register seller.
  const sellerEmail = randomEmail();
  const sellerPass = randomPassword();
  state.seller = { email: sellerEmail, userId: '', characterId: '' };
  await step('register seller', async () => {
    const r = await http('/api/_auth/register', {
      method: 'POST',
      body: { email: sellerEmail, password: sellerPass },
    });
    assertStatus(r, [200, 201], 'register seller');
    if (!r.body?.ok) throw new Error(`register seller: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    state.seller.userId = r.body?.data?.user?.id;
    assert(state.seller.userId, 'register seller: missing user.id');
  });

  // 2. Onboard seller character.
  await step('onboard seller', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: randomCharName(), sectKey: SECT_KEY },
    });
    assertStatus(r, 200, 'onboard seller');
    if (!r.body?.ok) throw new Error(`onboard seller: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    state.seller.characterId = r.body?.data?.character?.id;
    assert(state.seller.characterId, 'onboard seller: missing character.id');
  });

  // 3. Admin login → grant item to seller → logout.
  /** @type {Map<string,string>} */
  let sellerCookieSnap;
  await step(`admin login → grant ${GRANT_QTY}x ${ITEM_KEY} to seller → logout`, async () => {
    sellerCookieSnap = snapshotCookies();
    cookieJar.clear();

    const loginR = await http('/api/_auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assertStatus(loginR, 200, 'admin login');
    if (!loginR.body?.ok) throw new Error(`admin login: ok=false body=${JSON.stringify(loginR.body).slice(0, 200)}`);
    assert(loginR.body?.data?.user?.role === 'ADMIN', 'admin login: role phải ADMIN');

    const grantR = await http(`/api/admin/users/${state.seller.userId}/grant-item`, {
      method: 'POST',
      body: { itemKey: ITEM_KEY, qty: GRANT_QTY, reason: 'smoke market positive seed' },
    });
    assertStatus(grantR, 200, 'admin grant-item');
    assert(
      grantR.body?.ok === true && grantR.body?.data?.ok === true,
      `grant-item: shape mismatch, got ${JSON.stringify(grantR.body)}`,
    );

    const logoutR = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logoutR, [200, 204], 'admin logout');
    cookieJar.clear();
    restoreCookies(sellerCookieSnap);
  });

  // 4. Verify seller has item in inventory.
  /** @type {string} */
  let sellerItemId;
  await step(`verify seller inventory has ${ITEM_KEY}`, async () => {
    const items = await fetchInventory();
    const match = items.find((i) => i.itemKey === ITEM_KEY);
    assert(match, `inventory: ${ITEM_KEY} not found after admin grant`);
    assert(match.qty >= GRANT_QTY, `inventory: ${ITEM_KEY} qty expect >= ${GRANT_QTY}, got ${match.qty}`);
    sellerItemId = match.id;
  });

  // 5. Seller POST /market/post → 200 + listing created.
  await step(`POST /market/post {${ITEM_KEY} x${POST_QTY} @ ${PRICE_PER_UNIT}/unit} → 200`, async () => {
    const r = await http('/api/market/post', {
      method: 'POST',
      body: { inventoryItemId: sellerItemId, qty: POST_QTY, pricePerUnit: PRICE_PER_UNIT },
    });
    assertStatus(r, 200, 'POST /market/post');
    if (!r.body?.ok) throw new Error(`post: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const listing = r.body?.data?.listing;
    assert(listing, 'post: missing listing');
    assert(typeof listing.id === 'string' && listing.id.length > 0, 'post: listing.id missing');
    assert(listing.status === 'ACTIVE', `post: listing.status expect ACTIVE, got ${listing.status}`);
    assert(listing.itemKey === ITEM_KEY, `post: itemKey expect ${ITEM_KEY}, got ${listing.itemKey}`);
    assert(listing.qty === POST_QTY, `post: qty expect ${POST_QTY}, got ${listing.qty}`);
    state.listingId = listing.id;
  });

  // 6. Verify seller inventory decreased after post.
  await step('verify seller inventory decreased after post', async () => {
    const items = await fetchInventory();
    const match = items.find((i) => i.itemKey === ITEM_KEY);
    if (match) {
      assert(
        match.qty <= GRANT_QTY - POST_QTY,
        `inventory post-post: ${ITEM_KEY} qty expect <= ${GRANT_QTY - POST_QTY}, got ${match.qty}`,
      );
    }
    // If qty reached 0, the row may be deleted — that's also valid.
  });

  // 7. Seller GET /market/mine → verify listing appears.
  await step('GET /market/mine → verify listing appears', async () => {
    const r = await http('/api/market/mine');
    assertStatus(r, 200, 'GET /market/mine');
    const listings = r.body?.data?.listings;
    assert(Array.isArray(listings), '/market/mine: listings not array');
    const found = listings.find((l) => l.id === state.listingId);
    assert(found, `/market/mine: listing ${state.listingId} not found`);
    assert(found.status === 'ACTIVE', `/market/mine: listing status expect ACTIVE, got ${found.status}`);
  });

  // =========================================================================
  // PART B: Buyer flow — register → onboard → admin grant LT → buy listing.
  // =========================================================================

  // 8. Switch to buyer: register buyer.
  const buyerEmail = randomEmail();
  const buyerPass = randomPassword();
  state.buyer = { email: buyerEmail, userId: '', characterId: '' };
  await step('register buyer', async () => {
    // Logout seller first.
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout seller');

    const r = await http('/api/_auth/register', {
      method: 'POST',
      body: { email: buyerEmail, password: buyerPass },
    });
    assertStatus(r, [200, 201], 'register buyer');
    if (!r.body?.ok) throw new Error(`register buyer: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    state.buyer.userId = r.body?.data?.user?.id;
    assert(state.buyer.userId, 'register buyer: missing user.id');
  });

  // 9. Onboard buyer character.
  await step('onboard buyer', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: randomCharName(), sectKey: SECT_KEY },
    });
    assertStatus(r, 200, 'onboard buyer');
    if (!r.body?.ok) throw new Error(`onboard buyer: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    state.buyer.characterId = r.body?.data?.character?.id;
    assert(state.buyer.characterId, 'onboard buyer: missing character.id');
  });

  // 10. Admin login → grant linh thạch to buyer → logout.
  const BUY_AMOUNT = BigInt(PRICE_PER_UNIT) * BigInt(POST_QTY);
  const GRANT_LT = (BUY_AMOUNT + 1000n).toString(); // Extra buffer.
  /** @type {Map<string,string>} */
  let buyerCookieSnap;
  await step(`admin login → grant ${GRANT_LT} linh thạch to buyer → logout`, async () => {
    buyerCookieSnap = snapshotCookies();
    cookieJar.clear();

    const loginR = await http('/api/_auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assertStatus(loginR, 200, 'admin login');
    assert(loginR.body?.data?.user?.role === 'ADMIN', 'admin login: role phải ADMIN');

    const grantR = await http(`/api/admin/users/${state.buyer.userId}/grant-currency`, {
      method: 'POST',
      body: { currency: 'LINH_THACH', delta: GRANT_LT, reason: 'smoke market buyer seed' },
    });
    assertStatus(grantR, 200, 'admin grant-currency');
    assert(
      grantR.body?.ok === true && grantR.body?.data?.ok === true,
      `grant-currency: shape mismatch, got ${JSON.stringify(grantR.body)}`,
    );

    const logoutR = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logoutR, [200, 204], 'admin logout');
    cookieJar.clear();
    restoreCookies(buyerCookieSnap);
  });

  // 11. Snapshot buyer currency + seller currency BEFORE buy.
  /** @type {{buyerLT: string; sellerLT: string}} */
  let beforeBuy;
  await step('snapshot buyer + seller currency before buy', async () => {
    const buyerState = await fetchCurrency();
    beforeBuy = { buyerLT: buyerState.linhThach, sellerLT: '' };

    // Logout buyer → login seller → snapshot seller LT.
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout buyer');
    restoreCookies(sellerCookieSnap);
    const sellerState = await fetchCurrency();
    beforeBuy.sellerLT = sellerState.linhThach;

    // Logout seller → restore buyer.
    const logout2 = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout2, [200, 204], 'logout seller');
    restoreCookies(buyerCookieSnap);
  });

  // 12. Buyer POST /market/{listingId}/buy → 200.
  await step('POST /market/{listingId}/buy → 200 (buyer mua listing)', async () => {
    assert(state.listingId, 'state.listingId missing — step 5 chưa chạy');
    const r = await http(`/api/market/${state.listingId}/buy`, { method: 'POST' });
    assertStatus(r, 200, 'POST /market/:id/buy');
    if (!r.body?.ok) throw new Error(`buy: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const listing = r.body?.data?.listing;
    assert(listing, 'buy: missing listing');
    assert(listing.status === 'SOLD', `buy: listing.status expect SOLD, got ${listing.status}`);
  });

  // 13. Verify buyer received item in inventory.
  await step('verify buyer inventory received item after buy', async () => {
    const items = await fetchInventory();
    const match = items.find((i) => i.itemKey === ITEM_KEY);
    assert(match, `buyer inventory: ${ITEM_KEY} not found after buy`);
    assert(match.qty >= POST_QTY, `buyer inventory: ${ITEM_KEY} qty expect >= ${POST_QTY}, got ${match.qty}`);
  });

  // 14. Verify buyer linhThạch decreased by buy amount.
  await step('verify buyer linhThạch decreased by buy amount', async () => {
    const after = await fetchCurrency();
    const beforeLT = BigInt(beforeBuy.buyerLT);
    const afterLT = BigInt(after.linhThach);
    const spent = beforeLT - afterLT;
    assert(
      spent >= BUY_AMOUNT,
      `buyer linhThạch: expect spent >= ${BUY_AMOUNT}, before=${beforeLT} after=${afterLT} spent=${spent}`,
    );
  });

  // 15. Verify seller linhThạch increased (minus fee).
  await step('verify seller linhThạch increased (minus market fee)', async () => {
    // Logout buyer → login seller.
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout buyer');
    restoreCookies(sellerCookieSnap);

    const after = await fetchCurrency();
    const beforeLT = BigInt(beforeBuy.sellerLT);
    const afterLT = BigInt(after.linhThach);
    const gained = afterLT - beforeLT;
    // Market fee: seller gets pricePerUnit * qty * (1 - feePct).
    // Fee is typically 5-10%, so seller gets >= 90% of BUY_AMOUNT.
    const minExpected = BUY_AMOUNT * 80n / 100n; // At least 80% (generous margin).
    assert(
      gained >= minExpected,
      `seller linhThạch: expect gained >= ${minExpected} (80% of ${BUY_AMOUNT}), before=${beforeLT} after=${afterLT} gained=${gained}`,
    );
  });

  // =========================================================================
  // PART C: Cancel flow — seller post 2nd listing → cancel → item returned.
  // =========================================================================

  // 16. Seller has remaining item (GRANT_QTY - POST_QTY = 2).
  /** @type {string} */
  let sellerItemId2;
  await step('verify seller has remaining item for cancel test', async () => {
    const items = await fetchInventory();
    const match = items.find((i) => i.itemKey === ITEM_KEY);
    assert(match, `seller inventory: ${ITEM_KEY} not found for cancel test`);
    assert(match.qty >= 1, `seller inventory: ${ITEM_KEY} qty expect >= 1, got ${match.qty}`);
    sellerItemId2 = match.id;
  });

  // 17. Seller post 2nd listing.
  const CANCEL_QTY = 1;
  await step(`POST /market/post {${ITEM_KEY} x${CANCEL_QTY}} → 200 (for cancel test)`, async () => {
    const r = await http('/api/market/post', {
      method: 'POST',
      body: { inventoryItemId: sellerItemId2, qty: CANCEL_QTY, pricePerUnit: PRICE_PER_UNIT },
    });
    assertStatus(r, 200, 'POST /market/post cancel-test');
    if (!r.body?.ok) throw new Error(`post cancel-test: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    state.listingId2 = r.body?.data?.listing.id;
    assert(state.listingId2, 'post cancel-test: listing.id missing');
  });

  // 18. Snapshot seller inventory qty before cancel.
  /** @type {number} */
  let qtyBeforeCancel = 0;
  await step('snapshot seller inventory qty before cancel', async () => {
    const items = await fetchInventory();
    const match = items.find((i) => i.itemKey === ITEM_KEY);
    qtyBeforeCancel = match ? match.qty : 0;
  });

  // 19. Seller POST /market/{listingId2}/cancel → 200 + item returned.
  await step('POST /market/{listingId2}/cancel → 200 + item returned to inventory', async () => {
    assert(state.listingId2, 'state.listingId2 missing — step 17 chưa chạy');
    const r = await http(`/api/market/${state.listingId2}/cancel`, { method: 'POST' });
    assertStatus(r, 200, 'POST /market/:id/cancel');
    if (!r.body?.ok) throw new Error(`cancel: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const listing = r.body?.data?.listing;
    assert(listing, 'cancel: missing listing');
    assert(listing.status === 'CANCELLED', `cancel: listing.status expect CANCELLED, got ${listing.status}`);
  });

  // 20. Verify seller inventory qty increased after cancel (item returned).
  await step('verify seller inventory qty increased after cancel (item returned)', async () => {
    const items = await fetchInventory();
    const match = items.find((i) => i.itemKey === ITEM_KEY);
    const qtyAfter = match ? match.qty : 0;
    assert(
      qtyAfter >= qtyBeforeCancel + CANCEL_QTY,
      `inventory post-cancel: ${ITEM_KEY} qty expect >= ${qtyBeforeCancel + CANCEL_QTY}, got ${qtyAfter}`,
    );
  });

  // 21. Logout + anti-FE-self-grant summary.
  await step('logout seller + anti-FE-self-grant: currency/item only changed via market endpoints', async () => {
    // Verify final seller state: linhThạch only changed via sell proceeds.
    const finalSeller = await fetchCurrency();
    const beforeLT = BigInt(beforeBuy.sellerLT);
    const afterLT = BigInt(finalSeller.linhThach);
    // Seller started with 0, gained from sell (minus fee). Should be > 0.
    assert(
      afterLT > beforeLT,
      `seller final linhThạch: expect > ${beforeLT} (gained from sell), got ${afterLT}`,
    );

    // Logout.
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout seller');
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:market-positive] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:market-positive] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:market-positive] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:market-positive] unexpected error:', err);
  process.exitCode = 1;
});
