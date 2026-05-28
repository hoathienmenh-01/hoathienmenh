#!/usr/bin/env node
/**
 * smoke-gem.mjs — Gem endpoint smoke (negative paths) cho Xuân Tôi.
 *
 * Cover:
 *   1. POST /character/gem/socket (no auth)    → 401 UNAUTHENTICATED.
 *   2. POST /_auth/register                      — fresh user.
 *   3. POST /character/gem/combine (no auth)   → 401 UNAUTHENTICATED.
 *   4. POST /character/gem/socket (no char)    → 404 NO_CHARACTER.
 *   5. POST /character/onboard                   — create character.
 *   6. POST /character/gem/socket {}            → 400 INVALID_INPUT.
 *   7. POST /character/gem/unsocket {}          → 400 INVALID_INPUT.
 *   8. POST /character/gem/combine {}           → 400 INVALID_INPUT.
 *   9. POST /character/gem/combine { bad key }  → 409 INSUFFICIENT_QTY.
 *  10. POST /character/gem/socket { fake ids }  → 404 GEM_NOT_FOUND / EQUIPMENT_NOT_FOUND.
 *  11. Logout + POST /character/gem/combine     → 401.
 *
 * Positive path (combine 3→1) requires gems in inventory — gems are NOT in
 * the `itemByKey` catalog so admin `grant-item` cannot grant them. Positive
 * path deferred to integration test or future admin gem-grant endpoint.
 *
 * Chạy: pnpm smoke:gem
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
  process.stdout.write(`[smoke:gem] ${name} ... `);
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
  return `smoke-gem-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `gm_${rand}`;
}

// -----------------------------------------------------------------------------
// Main flow
// -----------------------------------------------------------------------------

/** @type {{ email?: string; userId?: string; characterId?: string }} */
const state = {};

async function main() {
  console.log(`[smoke:gem] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms`);

  // 1. POST /gem/socket chưa auth → 401.
  await step('gem/socket — 401 UNAUTHENTICATED khi chưa register', async () => {
    const r = await http('/api/character/gem/socket', {
      method: 'POST',
      body: { equipmentInventoryItemId: 'fake', gemKey: 'gem_kim_pham' },
    });
    assertStatus(r, 401, 'gem/socket unauth');
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

  // 3. POST /gem/combine chưa auth → 401.
  await step('gem/combine — 401 UNAUTHENTICATED khi chưa register', async () => {
    const r = await http('/api/character/gem/combine', {
      method: 'POST',
      body: { srcGemKey: 'gem_kim_pham' },
    });
    assertStatus(r, 401, 'gem/combine unauth');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `expect UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 4. POST /gem/socket khi chưa onboard → 404 NO_CHARACTER.
  await step('gem/socket — 404 NO_CHARACTER khi chưa onboard', async () => {
    const r = await http('/api/character/gem/socket', {
      method: 'POST',
      body: { equipmentInventoryItemId: 'fake', gemKey: 'gem_kim_pham' },
    });
    assertStatus(r, 404, 'gem/socket no-char');
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

  // 6. POST /gem/socket {} → 400 INVALID_INPUT.
  await step('gem/socket — 400 INVALID_INPUT khi body rỗng', async () => {
    const r = await http('/api/character/gem/socket', {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 400, 'gem/socket empty-body');
    assert(r.body?.error?.code === 'INVALID_INPUT', `expect INVALID_INPUT, got ${r.body?.error?.code}`);
  });

  // 7. POST /gem/unsocket {} → 400 INVALID_INPUT.
  await step('gem/unsocket — 400 INVALID_INPUT khi body rỗng', async () => {
    const r = await http('/api/character/gem/unsocket', {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 400, 'gem/unsocket empty-body');
    assert(r.body?.error?.code === 'INVALID_INPUT', `expect INVALID_INPUT, got ${r.body?.error?.code}`);
  });

  // 8. POST /gem/combine {} → 400 INVALID_INPUT.
  await step('gem/combine — 400 INVALID_INPUT khi body rỗng', async () => {
    const r = await http('/api/character/gem/combine', {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 400, 'gem/combine empty-body');
    assert(r.body?.error?.code === 'INVALID_INPUT', `expect INVALID_INPUT, got ${r.body?.error?.code}`);
  });

  // 9. POST /gem/combine { srcGemKey: 'gem_kim_pham' } → 409 INSUFFICIENT_QTY (no gems).
  await step('gem/combine — 409 INSUFFICIENT_QTY khi chưa có gem', async () => {
    const r = await http('/api/character/gem/combine', {
      method: 'POST',
      body: { srcGemKey: 'gem_kim_pham' },
    });
    assertStatus(r, 409, 'gem/combine no-gems');
    assert(r.body?.error?.code === 'INSUFFICIENT_QTY', `expect INSUFFICIENT_QTY, got ${r.body?.error?.code}`);
  });

  // 10. POST /gem/socket { fake ids } → 404.
  await step('gem/socket — 404 EQUIPMENT_NOT_FOUND cho fake inventoryItemId', async () => {
    const r = await http('/api/character/gem/socket', {
      method: 'POST',
      body: { equipmentInventoryItemId: 'nonexistent-id-12345', gemKey: 'gem_kim_pham' },
    });
    assertStatus(r, 404, 'gem/socket fake-equip');
    assert(
      r.body?.error?.code === 'EQUIPMENT_NOT_FOUND' || r.body?.error?.code === 'GEM_NOT_FOUND',
      `expect EQUIPMENT_NOT_FOUND|GEM_NOT_FOUND, got ${r.body?.error?.code}`,
    );
  });

  // 11. Logout + gem/combine → 401.
  await step('logout + gem/combine — 401 UNAUTHENTICATED post-logout', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const r = await http('/api/character/gem/combine', {
      method: 'POST',
      body: { srcGemKey: 'gem_kim_pham' },
    });
    assertStatus(r, 401, 'gem/combine post-logout');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `expect UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // -----------------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:gem] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:gem] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:gem] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:gem] unexpected error:', err);
  process.exitCode = 1;
});
