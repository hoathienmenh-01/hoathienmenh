#!/usr/bin/env node
/**
 * smoke-sect-positive.mjs — Sect positive-path smoke cho Xuân Tôi.
 *
 * Admin seed pattern (reuse từ smoke-breakthrough.mjs):
 *   1. Register fresh user + onboard → auto-join thanh_van.
 *   2. Admin login → grant linh thạch → admin logout → restore player.
 *   3. Player POST /sect/contribute {amount} → 200 + congHien tăng +
 *      linhThạch trừ đúng amount.
 *   4. Player POST /sect/leave → 200 (rời sect).
 *   5. Player POST /sect/{existingSectId}/join → 200 join lại sect.
 *   6. anti-FE-self-grant: currency chỉ đổi qua admin grant + contribute.
 *
 * Yêu cầu:
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api bootstrap` (seed admin + 3 sects)
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
const CONTRIBUTION_AMOUNT = '500';

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
  process.stdout.write(`[smoke:sect-positive] ${name} ... `);
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
  return `smoke-sect-pos-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `sp_${rand}`;
}

/** @returns {Promise<{linhThach: string; congHien: number; sectId: string | null}>} */
async function fetchCharState() {
  const r = await http('/api/sect/me');
  assertStatus(r, 200, 'GET /sect/me snapshot');
  const sect = r.body?.data?.sect;
  assert(sect, 'GET /sect/me: missing sect');

  const cR = await http('/api/character/state');
  assertStatus(cR, 200, 'GET /character/state snapshot');
  const c = cR.body?.data?.character;
  assert(c, 'GET /character/state: missing character');

  return {
    linhThach: String(c.linhThach ?? '0'),
    congHien: typeof c.congHien === 'number' ? c.congHien : 0,
    sectId: c.sectId ?? null,
  };
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

/**
 * @type {{
 *   email?: string;
 *   userId?: string;
 *   characterId?: string;
 *   sectId?: string;
 * }}
 */
const state = {};

async function main() {
  console.log(
    `[smoke:sect-positive] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}`,
  );

  // 1. Register fresh user.
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

  // 2. Onboard character — auto-joins thanh_van.
  await step('onboard — create character (auto-join thanh_van)', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: randomCharName(), sectKey: SECT_KEY },
    });
    assertStatus(r, 200, 'onboard');
    if (!r.body?.ok) throw new Error(`onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    state.characterId = r.body?.data?.character?.id;
    assert(state.characterId, 'onboard: missing character.id');
  });

  // 3. GET /sect/me → verify in sect + snapshot congHien.
  /** @type {number} */
  let initialCongHien = 0;
  await step('GET /sect/me — verify auto-joined sect + snapshot congHien', async () => {
    const r = await http('/api/sect/me');
    assertStatus(r, 200, 'GET /sect/me');
    const sect = r.body?.data?.sect;
    assert(sect, 'sect/me: missing sect');
    assert(typeof sect.id === 'string' && sect.id.length > 0, 'sect.id not string');
    state.sectId = sect.id;
    initialCongHien = typeof sect.myCongHien === 'number' ? sect.myCongHien : 0;
  });

  // 4. Snapshot currency BEFORE admin seed (anti-FE-self-grant baseline).
  /** @type {{linhThach: string}} */
  let beforeSeed;
  await step('snapshot currency before admin seed', async () => {
    const r = await http('/api/character/state');
    assertStatus(r, 200, 'GET /character/state');
    const c = r.body?.data?.character;
    assert(c, 'character/state: missing character');
    beforeSeed = { linhThach: String(c.linhThach ?? '0') };
  });

  // 5. Admin login → grant linh thạch → admin logout → restore player.
  /** @type {Map<string,string>} */
  let playerCookieSnap;
  await step('admin login → grant 10000 linh thạch → logout → restore player', async () => {
    playerCookieSnap = snapshotCookies();
    cookieJar.clear();

    const loginR = await http('/api/_auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assertStatus(loginR, 200, 'admin login');
    if (!loginR.body?.ok) throw new Error(`admin login: ok=false body=${JSON.stringify(loginR.body).slice(0, 200)}`);
    const u = loginR.body?.data?.user;
    assert(u?.role === 'ADMIN', `admin login: role phải ADMIN, got ${u?.role}`);

    const grantR = await http(`/api/admin/users/${state.userId}/grant-currency`, {
      method: 'POST',
      body: { currency: 'LINH_THACH', delta: '10000', reason: 'smoke sect positive seed' },
    });
    assertStatus(grantR, 200, 'admin grant-currency');
    assert(
      grantR.body?.ok === true && grantR.body?.data?.ok === true,
      `grant-currency: shape mismatch, got ${JSON.stringify(grantR.body)}`,
    );

    const logoutR = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logoutR, [200, 204], 'admin logout');
    cookieJar.clear();
    restoreCookies(playerCookieSnap);
  });

  // 6. Verify linh thạch increased after admin seed.
  await step('verify linh thạch increased after admin seed', async () => {
    const r = await http('/api/character/state');
    assertStatus(r, 200, 'GET /character/state post-seed');
    const c = r.body?.data?.character;
    assert(c, 'character/state: missing character');
    const afterLT = BigInt(c.linhThach ?? '0');
    const beforeLT = BigInt(beforeSeed.linhThach);
    assert(
      afterLT >= beforeLT + 10000n,
      `linhThạch post-seed: expect >= ${beforeLT + 10000n}, got ${afterLT}`,
    );
  });

  // 7. POST /sect/contribute {amount} → 200 + congHien tăng + linhThạch trừ.
  await step(`POST /sect/contribute {amount:${CONTRIBUTION_AMOUNT}} → 200 + congHien tăng`, async () => {
    const r = await http('/api/sect/contribute', {
      method: 'POST',
      body: { amount: CONTRIBUTION_AMOUNT },
    });
    assertStatus(r, 200, 'POST /sect/contribute');
    if (!r.body?.ok) throw new Error(`contribute: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const sect = r.body?.data?.sect;
    assert(sect, 'contribute: missing sect in response');

    // Verify congHien increased.
    const newCongHien = typeof sect.myCongHien === 'number' ? sect.myCongHien : 0;
    assert(
      newCongHien >= initialCongHien + Number(CONTRIBUTION_AMOUNT),
      `congHien: expect >= ${initialCongHien + Number(CONTRIBUTION_AMOUNT)}, got ${newCongHien}`,
    );
  });

  // 8. Verify linhThạch decreased by contribution amount.
  await step('verify linhThạch decreased by contribution amount', async () => {
    const r = await http('/api/character/state');
    assertStatus(r, 200, 'GET /character/state post-contribute');
    const c = r.body?.data?.character;
    assert(c, 'character/state: missing character');
    // Should have spent CONTRIBUTION_AMOUNT linh thạch.
    // We can't check exact because we granted 10000 and contributed 500.
    const lt = BigInt(c.linhThach ?? '0');
    assert(lt >= 9000n, `linhThạch post-contribute: expect >= 9000 (granted 10000, spent 500), got ${lt}`);
  });

  // 9. POST /sect/leave → 200.
  await step('POST /sect/leave → 200 ok (rời sect)', async () => {
    const r = await http('/api/sect/leave', { method: 'POST' });
    assertStatus(r, 200, 'POST /sect/leave');
    if (!r.body?.ok) throw new Error(`leave: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
  });

  // 10. GET /sect/me → verify no sect after leave.
  await step('GET /sect/me — verify no sect after leave', async () => {
    const r = await http('/api/sect/me');
    assertStatus(r, 200, 'GET /sect/me post-leave');
    const sect = r.body?.data?.sect;
    assert(sect === null || sect === undefined, `sect/me post-leave: expect null sect, got ${JSON.stringify(sect)}`);
  });

  // 11. POST /sect/{existingSectId}/join → 200 (join lại sect cũ).
  await step('POST /sect/{sectId}/join → 200 (join lại sect)', async () => {
    assert(state.sectId, 'state.sectId missing — step 3 chưa chạy');
    const r = await http(`/api/sect/${state.sectId}/join`, { method: 'POST' });
    assertStatus(r, 200, 'POST /sect/:id/join');
    if (!r.body?.ok) throw new Error(`join: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const sect = r.body?.data?.sect;
    assert(sect, 'join: missing sect in response');
    assert(sect.id === state.sectId, `join: sect.id mismatch, expect ${state.sectId}, got ${sect.id}`);
  });

  // 12. GET /sect/me → verify back in sect.
  await step('GET /sect/me — verify back in sect after join', async () => {
    const r = await http('/api/sect/me');
    assertStatus(r, 200, 'GET /sect/me post-join');
    const sect = r.body?.data?.sect;
    assert(sect, 'sect/me post-join: expect sect != null');
    assert(sect.id === state.sectId, `sect/me post-join: id mismatch, expect ${state.sectId}, got ${sect.id}`);
  });

  // 13. anti-FE-self-grant: currency chỉ đổi qua admin grant + contribute.
  await step('anti-FE-self-grant: linhThạch chỉ đổi qua admin grant + contribute', async () => {
    const r = await http('/api/character/state');
    assertStatus(r, 200, 'GET /character/state final');
    const c = r.body?.data?.character;
    assert(c, 'character/state: missing character');
    const finalLT = BigInt(c.linhThach ?? '0');
    // Started with 0, admin granted 10000, contributed 500 → expect 9500.
    assert(
      finalLT === 9500n,
      `linhThạch final: expect 9500 (0 + 10000 grant - 500 contribute), got ${finalLT}`,
    );
  });

  // 14. Logout + GET /sect/me → 401.
  await step('logout + GET /sect/me → 401', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const me = await http('/api/sect/me');
    assertStatus(me, 401, 'GET /sect/me post-logout');
    assertErrorCode(me, 'UNAUTHENTICATED', 'GET /sect/me post-logout');
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:sect-positive] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:sect-positive] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:sect-positive] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:sect-positive] unexpected error:', err);
  process.exitCode = 1;
});
