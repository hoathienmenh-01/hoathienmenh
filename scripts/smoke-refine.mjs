#!/usr/bin/env node
/**
 * smoke-refine.mjs — Refine endpoint smoke cho Xuân Tôi.
 *
 * Cover:
 *   1. POST /character/refine (no auth)         → 401 UNAUTHENTICATED.
 *   2. POST /_auth/register                       — fresh user.
 *   3. POST /character/refine (no char)           → 404 NO_CHARACTER.
 *   4. POST /character/onboard                     — create character.
 *   5. POST /character/refine {}                  → 400 INVALID_INPUT.
 *   6. POST /character/refine { fake id }         → 404 EQUIPMENT_NOT_FOUND.
 *   7. Admin login → grant-item so_kiem ×1 + tinh_thiet ×5 + grant-currency 1000 → logout.
 *   8. GET /inventory                               — find so_kiem inventory item id.
 *   9. POST /character/refine { id, useProtection } → 200 + outcome shape.
 *  10. GET /inventory                               — verify refineLevel changed.
 *  11. Logout + POST /character/refine              → 401.
 *
 * Chạy: pnpm smoke:refine
 *
 * Env vars:
 *   SMOKE_API_BASE, SMOKE_TIMEOUT_MS, SMOKE_VERBOSE, SMOKE_SECT_KEY
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

// -----------------------------------------------------------------------------
// Cookie jar
// -----------------------------------------------------------------------------

/** @type {Map<string, string>} */
const cookieJar = new Map();

/** @param {Response} res */
function storeSetCookie(res) {
  /** @type {string[]} */
  const raw =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.raw?.()['set-cookie'] ?? []);
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

function snapshotCookies() {
  return new Map(cookieJar);
}

/** @param {Map<string,string>} snapshot */
function restoreCookies(snapshot) {
  cookieJar.clear();
  for (const [k, v] of snapshot) cookieJar.set(k, v);
}

// -----------------------------------------------------------------------------
// HTTP helper
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
// Step runner
// -----------------------------------------------------------------------------

/** @type {{ name: string; ok: boolean; note?: string }[]} */
const results = [];

/**
 * @param {string} name
 * @param {() => Promise<void>} fn
 */
async function step(name, fn) {
  process.stdout.write(`[smoke:refine] ${name} ... `);
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

// -----------------------------------------------------------------------------
// Helpers random
// -----------------------------------------------------------------------------

function randomEmail() {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `smoke-refine-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `rf_${rand}`;
}

// -----------------------------------------------------------------------------
// Main flow
// -----------------------------------------------------------------------------

/** @type {{ email?: string; userId?: string; characterId?: string }} */
const state = {};

async function main() {
  console.log(`[smoke:refine] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms`);

  // 1. POST /refine chưa auth → 401.
  await step('refine — 401 UNAUTHENTICATED khi chưa register', async () => {
    const r = await http('/api/character/refine', {
      method: 'POST',
      body: { equipmentInventoryItemId: 'fake', useProtection: false },
    });
    assertStatus(r, 401, 'refine unauth');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `expect UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 2. Register fresh user.
  const email = randomEmail();
  const password = randomPassword();
  state.email = email;
  await step('register', async () => {
    const r = await http('/api/_auth/register', {
      method: 'POST',
      body: { email, password },
    });
    assertStatus(r, [200, 201], 'register');
    if (!r.body?.ok) throw new Error(`register: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    state.userId = r.body?.data?.user?.id;
    assert(state.userId, 'register: missing user.id');
  });

  // 3. POST /refine khi chưa onboard → 404 NO_CHARACTER.
  await step('refine — 404 NO_CHARACTER khi chưa onboard', async () => {
    const r = await http('/api/character/refine', {
      method: 'POST',
      body: { equipmentInventoryItemId: 'fake', useProtection: false },
    });
    assertStatus(r, 404, 'refine no-char');
    assert(r.body?.error?.code === 'NO_CHARACTER', `expect NO_CHARACTER, got ${r.body?.error?.code}`);
  });

  // 4. Onboard character.
  await step('onboard — create character', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: randomCharName(), sectKey: SECT_KEY },
    });
    assertStatus(r, 200, 'onboard');
    if (!r.body?.ok) throw new Error(`onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const ch = r.body?.data?.character;
    assert(ch, 'onboard: missing character');
    state.characterId = ch.id;
    assert(state.characterId, 'onboard: missing character.id');
  });

  // 5. POST /refine {} → 400 INVALID_INPUT.
  await step('refine — 400 INVALID_INPUT khi body rỗng', async () => {
    const r = await http('/api/character/refine', {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 400, 'refine empty-body');
    assert(r.body?.error?.code === 'INVALID_INPUT', `expect INVALID_INPUT, got ${r.body?.error?.code}`);
  });

  // 6. POST /refine { fake id } → 404 EQUIPMENT_NOT_FOUND.
  await step('refine — 404 EQUIPMENT_NOT_FOUND cho fake inventoryItemId', async () => {
    const r = await http('/api/character/refine', {
      method: 'POST',
      body: { equipmentInventoryItemId: 'nonexistent-id-12345', useProtection: false },
    });
    assertStatus(r, 404, 'refine fake-id');
    assert(r.body?.error?.code === 'EQUIPMENT_NOT_FOUND', `expect EQUIPMENT_NOT_FOUND, got ${r.body?.error?.code}`);
  });

  // 7. Admin login → grant-item so_kiem ×1 + tinh_thiet ×5 + grant-currency 1000 → logout.
  /** @type {Map<string,string>} */
  let playerCookieSnap;
  await step('admin login → grant so_kiem + tinh_thiet + linhThach → logout', async () => {
    playerCookieSnap = snapshotCookies();
    cookieJar.clear();

    // Admin login.
    const login = await http('/api/_auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assertStatus(login, 200, 'admin login');
    assert(login.body?.ok === true, 'admin login: ok=false');
    assert(login.body?.data?.user?.role === 'ADMIN', `admin role phải ADMIN`);

    // Grant so_kiem ×1.
    const g1 = await http(`/api/admin/users/${state.userId}/grant-item`, {
      method: 'POST',
      body: { itemKey: 'so_kiem', qty: 1, reason: 'smoke-refine seed' },
    });
    assertStatus(g1, 200, 'admin grant-item so_kiem');
    assert(g1.body?.ok === true, `grant-item so_kiem: ok=false`);

    // Grant tinh_thiet ×5.
    const g2 = await http(`/api/admin/users/${state.userId}/grant-item`, {
      method: 'POST',
      body: { itemKey: 'tinh_thiet', qty: 5, reason: 'smoke-refine seed' },
    });
    assertStatus(g2, 200, 'admin grant-item tinh_thiet');
    assert(g2.body?.ok === true, `grant-item tinh_thiet: ok=false`);

    // Grant linhThach 1000.
    const g3 = await http(`/api/admin/users/${state.userId}/grant-currency`, {
      method: 'POST',
      body: { currency: 'LINH_THACH', delta: '1000', reason: 'smoke-refine seed' },
    });
    assertStatus(g3, 200, 'admin grant-currency');
    assert(g3.body?.ok === true, `grant-currency: ok=false`);

    // Admin logout + restore player.
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'admin logout');
    cookieJar.clear();
    restoreCookies(playerCookieSnap);
  });

  // 8. GET /inventory — find so_kiem inventory item id.
  /** @type {string} */
  let equipItemId;
  await step('inventory — find so_kiem inventory item id', async () => {
    const r = await http('/api/inventory');
    assertStatus(r, 200, 'inventory list');
    assert(r.body?.ok === true, 'inventory: ok !== true');
    const items = r.body?.data?.items;
    assert(Array.isArray(items), 'inventory: items phải array');
    const sword = items.find((/** @type {any} */ i) => i.itemKey === 'so_kiem');
    assert(sword, `inventory: không tìm thấy so_kiem trong items (count=${items.length})`);
    assert(typeof sword.id === 'string' && sword.id.length > 0, 'so_kiem.id phải string non-empty');
    equipItemId = sword.id;
  });

  // 9. POST /refine { equipmentInventoryItemId, useProtection: false } → 200 + outcome shape.
  await step('refine — 200 + outcome shape', async () => {
    const r = await http('/api/character/refine', {
      method: 'POST',
      body: { equipmentInventoryItemId: equipItemId, useProtection: false },
    });
    assertStatus(r, 200, 'refine happy');
    assert(r.body?.ok === true, `refine: ok=false, got ${JSON.stringify(r.body).slice(0, 200)}`);
    const ref = r.body?.data?.refine;
    assert(ref, 'refine: missing data.refine');
    assert(typeof ref.success === 'boolean', `refine.success phải boolean, got ${typeof ref.success}`);
    assert(typeof ref.rollValue === 'number', `refine.rollValue phải number, got ${typeof ref.rollValue}`);
    assert(typeof ref.newLevel === 'number', `refine.newLevel phải number, got ${typeof ref.newLevel}`);
    assert(typeof ref.successRate === 'number', `refine.successRate phải number, got ${typeof ref.successRate}`);
    assert(typeof ref.linhThachConsumed === 'string', `refine.linhThachConsumed phải string (BigInt), got ${typeof ref.linhThachConsumed}`);
  });

  // 10. GET /inventory — verify refineLevel changed on so_kiem.
  await step('inventory — verify so_kiem refineLevel changed', async () => {
    const r = await http('/api/inventory');
    assertStatus(r, 200, 'inventory post-refine');
    const items = r.body?.data?.items;
    const sword = items.find((/** @type {any} */ i) => i.itemKey === 'so_kiem');
    assert(sword, 'inventory: so_kiem disappeared after refine');
    // refineLevel should be >= 1 (was 0 before).
    assert(typeof sword.refineLevel === 'number', `refineLevel phải number, got ${typeof sword.refineLevel}`);
    assert(sword.refineLevel >= 1, `refineLevel phải >= 1 sau refine attempt, got ${sword.refineLevel}`);
  });

  // 11. Logout + refine → 401.
  await step('logout + refine — 401 UNAUTHENTICATED post-logout', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const r = await http('/api/character/refine', {
      method: 'POST',
      body: { equipmentInventoryItemId: equipItemId, useProtection: false },
    });
    assertStatus(r, 401, 'refine post-logout');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `expect UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // -----------------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:refine] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:refine] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:refine] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:refine] unexpected error:', err);
  process.exitCode = 1;
});
