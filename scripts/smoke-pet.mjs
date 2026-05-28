#!/usr/bin/env node
/**
 * smoke-pet.mjs — Pet box + collection endpoint smoke cho Xuân Tôi.
 *
 * Cover:
 *   1. GET  /pets/catalog (no auth)              → 200 (public endpoint).
 *   2. POST /_auth/register                        — fresh user.
 *   3. GET  /pets/collection (no char)            → 404 NO_CHARACTER.
 *   4. POST /character/onboard                     — create character.
 *   5. GET  /pets/catalog                          → 200 + shape (pets[]).
 *   6. GET  /pets/collection                       → 200 + empty array.
 *   7. GET  /pets/boxes                            → 200 + shape (boxes[]).
 *   8. POST /pets/boxes/nonexistent/open           → 400 PET_BOX_NOT_FOUND.
 *   9. POST /pets/boxes/pet_box_standard/open      → 409 (no ticket).
 *  10. Admin login → grant-item pet_ticket_standard ×1 → logout.
 *  11. POST /pets/boxes/pet_box_standard/open      → 200 + result shape.
 *  12. GET  /pets/collection                        → verify pet or shard granted.
 *  13. Logout + GET /pets/collection               → 401.
 *
 * Chạy: pnpm smoke:pet
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
  process.stdout.write(`[smoke:pet] ${name} ... `);
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
  return `smoke-pet-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `pt_${rand}`;
}

// -----------------------------------------------------------------------------
// Main flow
// -----------------------------------------------------------------------------

/** @type {{ email?: string; userId?: string; characterId?: string }} */
const state = {};

async function main() {
  console.log(`[smoke:pet] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms`);

  // 1. GET /pets/catalog (public) → 200.
  await step('pets/catalog — 200 public (no auth required)', async () => {
    const r = await http('/api/pets/catalog');
    assertStatus(r, 200, 'pets/catalog public');
    assert(r.body?.ok === true, 'pets/catalog: ok !== true');
    const data = r.body?.data;
    assert(data, 'pets/catalog: missing data');
    assert(Array.isArray(data.pets), 'pets/catalog: data.pets phải array');
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

  // 3. GET /pets/collection khi chưa onboard → 404 NO_CHARACTER.
  await step('pets/collection — 404 NO_CHARACTER khi chưa onboard', async () => {
    const r = await http('/api/pets/collection');
    assertStatus(r, 404, 'pets/collection no-char');
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

  // 5. GET /pets/catalog (authed) → 200 + shape.
  await step('pets/catalog — 200 + shape (pets[])', async () => {
    const r = await http('/api/pets/catalog');
    assertStatus(r, 200, 'pets/catalog authed');
    assert(r.body?.ok === true, 'pets/catalog: ok !== true');
    const pets = r.body?.data?.pets;
    assert(Array.isArray(pets), 'pets phải array');
    if (pets.length > 0) {
      const p0 = pets[0];
      assert(typeof p0.petKey === 'string', 'pet.petKey phải string');
      assert(typeof p0.nameVi === 'string' || typeof p0.nameEn === 'string', 'pet.nameVi/nameEn phải string');
    }
  });

  // 6. GET /pets/collection → 200 + empty array.
  await step('pets/collection — 200 + empty array (fresh char)', async () => {
    const r = await http('/api/pets/collection');
    assertStatus(r, 200, 'pets/collection fresh');
    assert(r.body?.ok === true, 'pets/collection: ok !== true');
    const pets = r.body?.data?.pets;
    assert(Array.isArray(pets), 'pets phải array');
    assert(pets.length === 0, `fresh char pets phải empty, got ${pets.length}`);
  });

  // 7. GET /pets/boxes → 200 + shape.
  await step('pets/boxes — 200 + shape (boxes[])', async () => {
    const r = await http('/api/pets/boxes');
    assertStatus(r, 200, 'pets/boxes');
    assert(r.body?.ok === true, 'pets/boxes: ok !== true');
    const boxes = r.body?.data?.boxes;
    assert(Array.isArray(boxes), 'boxes phải array');
    assert(boxes.length > 0, 'boxes.length phải > 0');
    const b0 = boxes[0];
    assert(typeof b0.boxKey === 'string', 'box.boxKey phải string');
    assert(typeof b0.nameVi === 'string' || typeof b0.nameEn === 'string', 'box.nameVi/nameEn phải string');
  });

  // 8. POST /pets/boxes/nonexistent/open → 400 PET_BOX_NOT_FOUND.
  await step('pets/boxes/nonexistent/open — 400 PET_BOX_NOT_FOUND', async () => {
    const r = await http('/api/pets/boxes/nonexistent_box_key/open', {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 400, 'pet box nonexistent');
    assert(r.body?.error?.code === 'PET_BOX_NOT_FOUND', `expect PET_BOX_NOT_FOUND, got ${r.body?.error?.code}`);
  });

  // 9. POST /pets/boxes/pet_box_standard/open khi chưa có ticket → 409.
  await step('pets/boxes/pet_box_standard/open — 409 khi chưa có ticket', async () => {
    const r = await http('/api/pets/boxes/pet_box_standard/open', {
      method: 'POST',
      body: {},
    });
    // Could be 409 INSUFFICIENT_QTY or similar cost-related error.
    assertStatus(r, [400, 409], 'pet box no-ticket');
    assert(
      r.body?.error?.code === 'INSUFFICIENT_QTY' ||
        r.body?.error?.code === 'PET_BOX_INVALID_COST' ||
        r.body?.error?.code === 'INVALID_INPUT',
      `expect INSUFFICIENT_QTY|PET_BOX_INVALID_COST|INVALID_INPUT, got ${r.body?.error?.code}`,
    );
  });

  // 10. Admin login → grant-item pet_ticket_standard ×1 → logout.
  /** @type {Map<string,string>} */
  let playerCookieSnap;
  await step('admin login → grant-item pet_ticket_standard ×1 → logout', async () => {
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

    // Grant pet_ticket_standard ×1.
    const grant = await http(`/api/admin/users/${state.userId}/grant-item`, {
      method: 'POST',
      body: { itemKey: 'pet_ticket_standard', qty: 1, reason: 'smoke-pet seed' },
    });
    assertStatus(grant, 200, 'admin grant-item pet_ticket_standard');
    assert(grant.body?.ok === true, `grant-item: ok=false, got ${JSON.stringify(grant.body)}`);

    // Admin logout + restore player.
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'admin logout');
    cookieJar.clear();
    restoreCookies(playerCookieSnap);
  });

  // 11. POST /pets/boxes/pet_box_standard/open → 200 + result shape.
  await step('pets/boxes/pet_box_standard/open — 200 + result shape', async () => {
    const r = await http('/api/pets/boxes/pet_box_standard/open', {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 200, 'pet box open happy');
    assert(r.body?.ok === true, `pet box open: ok=false, got ${JSON.stringify(r.body).slice(0, 300)}`);
    const data = r.body?.data;
    assert(data, 'pet box open: missing data');
    // Result should have a result object with rarity, resultType, etc.
    assert(data.result || data.results, 'pet box open: missing result/results');
  });

  // 12. GET /pets/collection — verify pet or shard granted.
  await step('pets/collection — verify pet or shard granted sau box open', async () => {
    const r = await http('/api/pets/collection');
    assertStatus(r, 200, 'pets/collection post-open');
    assert(r.body?.ok === true, 'pets/collection: ok !== true');
    const pets = r.body?.data?.pets;
    assert(Array.isArray(pets), 'pets phải array');
    // After opening 1 box, should have at least 1 pet or shard.
    // Check shards too.
    const shardsR = await http('/api/pets/shards');
    assertStatus(shardsR, 200, 'pets/shards');
    const shards = shardsR.body?.data?.shards;
    assert(Array.isArray(shards), 'shards phải array');
    // At least one of pets or shards should be non-empty.
    assert(
      pets.length > 0 || shards.length > 0,
      `sau box open phải có pet hoặc shard, got pets=${pets.length} shards=${shards.length}`,
    );
  });

  // 13. Logout + pets/collection → 401.
  await step('logout + pets/collection — 401 UNAUTHENTICATED post-logout', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const r = await http('/api/pets/collection');
    assertStatus(r, 401, 'pets/collection post-logout');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `expect UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // -----------------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:pet] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:pet] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:pet] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:pet] unexpected error:', err);
  process.exitCode = 1;
});
