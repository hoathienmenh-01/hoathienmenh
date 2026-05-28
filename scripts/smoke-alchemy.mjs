#!/usr/bin/env node
/**
 * smoke-alchemy.mjs — Alchemy endpoint smoke cho Xuân Tôi.
 *
 * Cover:
 *   1. GET  /character/alchemy/recipes (no auth)  → 401 UNAUTHENTICATED.
 *   2. POST /_auth/register                        — fresh user.
 *   3. POST /character/alchemy/craft (no auth)     → 401 UNAUTHENTICATED.
 *   4. GET  /character/alchemy/recipes (no char)   → 404 NO_CHARACTER.
 *   5. POST /character/onboard                      — create character.
 *   6. GET  /character/alchemy/recipes              → 200 + shape (furnaceLevel, recipes[]).
 *   7. POST /character/alchemy/craft { bad key }   → 404 RECIPE_NOT_FOUND.
 *   8. POST /character/alchemy/craft {}            → 400 INVALID_INPUT.
 *   9. POST /character/alchemy/craft (no items)    → 409 INSUFFICIENT_INGREDIENTS.
 *  10. Admin login → grant-item linh_thao ×5 + grant-currency 500 → logout + restore.
 *  11. POST /character/alchemy/craft               → 200 + outcome shape.
 *  12. GET  /character/me                           — verify linhThach deducted (anti-FE-self-grant).
 *  13. Logout + POST /character/alchemy/recipes     → 401.
 *
 * Chạy: pnpm smoke:alchemy
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
 * @param {() => Promise<void | { skip: true; note: string }>} fn
 */
async function step(name, fn) {
  process.stdout.write(`[smoke:alchemy] ${name} ... `);
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
// Helpers random
// -----------------------------------------------------------------------------

function randomEmail() {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `smoke-alchemy-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `al_${rand}`;
}

// -----------------------------------------------------------------------------
// Main flow
// -----------------------------------------------------------------------------

/** @type {{ email?: string; userId?: string; characterId?: string }} */
const state = {};

async function main() {
  console.log(`[smoke:alchemy] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms`);

  // 1. GET /alchemy/recipes chưa auth → 401.
  await step('alchemy/recipes — 401 UNAUTHENTICATED khi chưa register', async () => {
    const r = await http('/api/character/alchemy/recipes');
    assertStatus(r, 401, 'alchemy/recipes unauth');
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

  // 3. POST /alchemy/craft chưa auth → 401.
  await step('alchemy/craft — 401 UNAUTHENTICATED khi chưa register', async () => {
    const r = await http('/api/character/alchemy/craft', {
      method: 'POST',
      body: { recipeKey: 'recipe_tieu_phuc_dan' },
    });
    assertStatus(r, 401, 'alchemy/craft unauth');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `expect UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 4. GET /alchemy/recipes khi chưa onboard → 404 NO_CHARACTER.
  await step('alchemy/recipes — 404 NO_CHARACTER khi chưa onboard', async () => {
    const r = await http('/api/character/alchemy/recipes');
    assertStatus(r, 404, 'alchemy/recipes no-char');
    assert(r.body?.error?.code === 'NO_CHARACTER', `expect NO_CHARACTER, got ${r.body?.error?.code}`);
  });

  // 5. Onboard character.
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

  // 6. GET /alchemy/recipes → 200 + shape.
  await step('alchemy/recipes — 200 + shape (furnaceLevel, recipes[])', async () => {
    const r = await http('/api/character/alchemy/recipes');
    assertStatus(r, 200, 'alchemy/recipes');
    assert(r.body?.ok === true, 'alchemy/recipes: ok !== true');
    const al = r.body?.data?.alchemy;
    assert(al, 'alchemy/recipes: missing data.alchemy');
    assert(typeof al.furnaceLevel === 'number', `furnaceLevel phải number, got ${typeof al.furnaceLevel}`);
    assert(Array.isArray(al.recipes), 'recipes phải array');
    assert(al.recipes.length > 0, 'recipes.length phải > 0');
    // Check first recipe shape.
    const r0 = al.recipes[0];
    assert(typeof r0.key === 'string', 'recipe.key phải string');
    assert(typeof r0.name === 'string', 'recipe.name phải string');
    assert(typeof r0.successRate === 'number', 'recipe.successRate phải number');
    assert(Array.isArray(r0.inputs), 'recipe.inputs phải array');
  });

  // 7. POST /alchemy/craft { bad key } → 404 RECIPE_NOT_FOUND.
  await step('alchemy/craft — 404 RECIPE_NOT_FOUND cho recipe key không tồn tại', async () => {
    const r = await http('/api/character/alchemy/craft', {
      method: 'POST',
      body: { recipeKey: 'nonexistent_recipe_xyz' },
    });
    assertStatus(r, 404, 'alchemy/craft bad-key');
    assert(r.body?.error?.code === 'RECIPE_NOT_FOUND', `expect RECIPE_NOT_FOUND, got ${r.body?.error?.code}`);
  });

  // 8. POST /alchemy/craft {} → 400 INVALID_INPUT.
  await step('alchemy/craft — 400 INVALID_INPUT khi body rỗng', async () => {
    const r = await http('/api/character/alchemy/craft', {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 400, 'alchemy/craft empty-body');
    assert(r.body?.error?.code === 'INVALID_INPUT', `expect INVALID_INPUT, got ${r.body?.error?.code}`);
  });

  // 9. POST /alchemy/craft recipe_tieu_phuc_dan khi chưa có items → 409 INSUFFICIENT_INGREDIENTS.
  await step('alchemy/craft — 409 INSUFFICIENT_INGREDIENTS khi chưa có nguyên liệu', async () => {
    const r = await http('/api/character/alchemy/craft', {
      method: 'POST',
      body: { recipeKey: 'recipe_tieu_phuc_dan' },
    });
    assertStatus(r, 409, 'alchemy/craft no-items');
    assert(
      r.body?.error?.code === 'INSUFFICIENT_INGREDIENTS' || r.body?.error?.code === 'INSUFFICIENT_FUNDS',
      `expect INSUFFICIENT_INGREDIENTS|INSUFFICIENT_FUNDS, got ${r.body?.error?.code}`,
    );
  });

  // Snapshot linhThach BEFORE admin seed (anti-FE-self-grant).
  /** @type {string} */
  let linhThachBefore;
  await step('character/me — snapshot linhThach before admin seed', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me snapshot');
    linhThachBefore = String(r.body?.data?.character?.linhThach ?? '0');
  });

  // 10. Admin login → grant-item linh_thao ×5 + grant-currency 500 linhThach → logout restore.
  /** @type {Map<string,string>} */
  let playerCookieSnap;
  await step('admin login → grant-item linh_thao ×5 + grant-currency 500 linhThach → logout', async () => {
    playerCookieSnap = snapshotCookies();
    cookieJar.clear();

    // Admin login.
    const login = await http('/api/_auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assertStatus(login, 200, 'admin login');
    assert(login.body?.ok === true, `admin login: ok=false`);
    assert(login.body?.data?.user?.role === 'ADMIN', `admin role phải ADMIN, got ${login.body?.data?.user?.role}`);

    // Grant linh_thao ×5.
    const grantItem = await http(`/api/admin/users/${state.userId}/grant-item`, {
      method: 'POST',
      body: { itemKey: 'linh_thao', qty: 5, reason: 'smoke-alchemy seed' },
    });
    assertStatus(grantItem, 200, 'admin grant-item linh_thao');
    assert(grantItem.body?.ok === true, `grant-item: ok=false, got ${JSON.stringify(grantItem.body)}`);

    // Grant linhThach 500.
    const grantCurrency = await http(`/api/admin/users/${state.userId}/grant-currency`, {
      method: 'POST',
      body: { currency: 'LINH_THACH', delta: '500', reason: 'smoke-alchemy seed' },
    });
    assertStatus(grantCurrency, 200, 'admin grant-currency');
    assert(grantCurrency.body?.ok === true, `grant-currency: ok=false, got ${JSON.stringify(grantCurrency.body)}`);

    // Admin logout + restore player.
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'admin logout');
    cookieJar.clear();
    restoreCookies(playerCookieSnap);
  });

  // 11. POST /alchemy/craft recipe_tieu_phuc_dan → 200 + outcome shape.
  await step('alchemy/craft — 200 + outcome shape (recipe_tieu_phuc_dan)', async () => {
    const r = await http('/api/character/alchemy/craft', {
      method: 'POST',
      body: { recipeKey: 'recipe_tieu_phuc_dan' },
    });
    assertStatus(r, 200, 'alchemy/craft happy');
    assert(r.body?.ok === true, `alchemy/craft: ok=false, got ${JSON.stringify(r.body).slice(0, 200)}`);
    const al = r.body?.data?.alchemy;
    assert(al, 'alchemy/craft: missing data.alchemy');
    assert(typeof al.furnaceLevel === 'number', `furnaceLevel phải number, got ${typeof al.furnaceLevel}`);

    const o = al.outcome;
    assert(o, 'alchemy/craft: missing outcome');
    assert(typeof o.recipeKey === 'string', 'outcome.recipeKey phải string');
    assert(typeof o.success === 'boolean', `outcome.success phải boolean, got ${typeof o.success}`);
    assert(typeof o.rollValue === 'number', `outcome.rollValue phải number, got ${typeof o.rollValue}`);
    assert(typeof o.successRate === 'number', `outcome.successRate phải number, got ${typeof o.successRate}`);
    assert(typeof o.alchemyExpGained === 'string', `outcome.alchemyExpGained phải string (BigInt), got ${typeof o.alchemyExpGained}`);
    assert(typeof o.linhThachConsumed === 'string', `outcome.linhThachConsumed phải string (BigInt), got ${typeof o.linhThachConsumed}`);
    assert(Array.isArray(o.inputsConsumed), 'outcome.inputsConsumed phải array');
  });

  // 12. GET /character/me — verify linhThach deducted (anti-FE-self-grant).
  await step('character/me — linhThach deducted sau craft (anti-FE-self-grant)', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me post-craft');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me: no character');
    const after = String(ch.linhThach ?? '0');
    const beforeBig = BigInt(linhThachBefore);
    const afterBig = BigInt(after);
    // recipe_tieu_phuc_dan costs 50 linhThach. After should be before - 50.
    assert(afterBig === beforeBig - 50n, `linhThach: expect ${beforeBig - 50n} (${beforeBig} - 50), got ${afterBig}`);
  });

  // 13. Logout + alchemy/recipes → 401.
  await step('logout + alchemy/recipes — 401 UNAUTHENTICATED post-logout', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const r = await http('/api/character/alchemy/recipes');
    assertStatus(r, 401, 'alchemy/recipes post-logout');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `expect UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // -----------------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:alchemy] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:alchemy] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:alchemy] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:alchemy] unexpected error:', err);
  process.exitCode = 1;
});
