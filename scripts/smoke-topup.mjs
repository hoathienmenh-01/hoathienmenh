#!/usr/bin/env node
/**
 * smoke-topup.mjs — Topup order state machine smoke cho Xuân Tôi.
 *
 * Mục tiêu: cover topup endpoints end-to-end qua HTTP để đóng "smoke gap"
 * được liệt kê ở `docs/AI_HANDOFF_REPORT.md` Recommended Next Roadmap
 * (`smoke:topup`). Verify:
 *
 *   1. `GET  /api/topup/packages`           — public, không auth, trả ≥ 1
 *                                              package + bank info.
 *   2. `GET  /api/topup/me` (no auth)       → 401 UNAUTHENTICATED.
 *   3. `POST /api/topup/create` (no auth)   → 401 UNAUTHENTICATED.
 *   4. `POST /api/_auth/register`           — fresh user.
 *   5. `POST /api/character/onboard`        — fresh character (cần character
 *                                              tồn tại để onboard pipeline +
 *                                              snapshot tienNgoc/linhThach
 *                                              starting).
 *   6. `GET  /api/character/me`             — snapshot tienNgoc + linhThach
 *                                              cho anti-FE-self-grant compare.
 *   7. `GET  /api/topup/me`                 → 200, orders=[] (fresh user).
 *   8. `POST /api/topup/create`             → 200, body { packageKey:
 *                                              <first valid> }, response
 *                                              order có status=PENDING +
 *                                              transferCode khớp regex
 *                                              `^TOPUP-[A-Z2-9]{6}$` +
 *                                              tienNgocAmount = pkg.tienNgoc
 *                                              + pkg.bonus.
 *   9. `GET  /api/topup/me`                 → 200, orders=[1 PENDING].
 *  10. `POST /api/topup/create`             → 400 INVALID_PACKAGE, body
 *                                              { packageKey: 'invalid_xyz' }.
 *  11. `POST /api/topup/create`             → 400 INVALID_PACKAGE, body {}
 *                                              (Zod missing field).
 *  12. Tạo thêm 4 PENDING orders để đạt MAX_PENDING_PER_USER (= 5) → 4 lần
 *      200 OK, mỗi order có transferCode unique.
 *  13. `POST /api/topup/create`             → 429 TOO_MANY_PENDING (lần 6
 *                                              sau khi đã 5 PENDING).
 *  14. `GET  /api/topup/me`                 → 200, orders.length = 5 PENDING
 *                                              + transferCode unique pairwise.
 *  15. Anti-FE-self-grant invariant         → `GET /api/character/me` lại,
 *                                              tienNgoc + linhThach KHÔNG
 *                                              thay đổi (server không credit
 *                                              tới khi admin approve).
 *  16. `POST /api/_auth/logout` + `GET /api/topup/me` → 401 UNAUTHENTICATED.
 *
 * Anti-FE-self-grant invariant (per Luật bắt buộc — KHÔNG để frontend tự cộng
 * EXP/tiền/item — tiền/item/reward phải qua ledger/service/idempotency):
 *   - `tienNgoc` KHÔNG thay đổi sau create order (status PENDING, server chỉ
 *     credit khi admin POST /admin/topup/:id/approve).
 *   - `linhThach` KHÔNG thay đổi (topup không liên quan LT — chỉ tiên ngọc).
 *
 * Chạy:
 *   pnpm smoke:topup
 *   # hoặc trực tiếp:
 *   node scripts/smoke-topup.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE   — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS — default 10000ms / request.
 *   SMOKE_VERBOSE    — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY   — default "thanh_van" (cho onboard, không ảnh hưởng topup).
 *
 * Yêu cầu môi trường (giống smoke:cultivation / smoke:economy):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api bootstrap` (seed 3 sect)
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:topup`
 *
 * KHÔNG yêu cầu admin login. KHÔNG đụng payment thật (server chỉ tạo order
 * PENDING, không gọi gateway). KHÔNG mutate DB ngoài user mới do chính smoke
 * tạo (random email + character name + 5 PENDING orders chỉ gắn user đó).
 *
 * Exit code:
 *   0 — toàn bộ invariant OK.
 *   1 — ít nhất 1 invariant fail.
 *
 * Zero-install: chỉ dùng native fetch + Intl từ Node 20+.
 */

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const BASE = (process.env.SMOKE_API_BASE ?? 'http://localhost:3000').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);
const VERBOSE = process.env.SMOKE_VERBOSE === '1';
const SECT_KEY = process.env.SMOKE_SECT_KEY ?? 'thanh_van';

const MAX_PENDING_PER_USER = 5;
const TRANSFER_CODE_RE = /^TOPUP-[A-Z2-9]{6}$/;

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
 * @param {() => Promise<void | { skip: true; note: string }>} fn
 */
async function step(name, fn) {
  process.stdout.write(`[smoke:topup] ${name} ... `);
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
// Helpers random.
// -----------------------------------------------------------------------------

function randomEmail() {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `smoke-topup-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `topup_${rand}`;
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

/**
 * @type {{
 *   email?: string;
 *   userId?: string;
 *   characterId?: string;
 *   firstPackageKey?: string;
 *   firstPackageTienNgoc?: number;
 *   startingTienNgoc?: string;
 *   startingLinhThach?: string;
 *   transferCodes?: string[];
 * }}
 */
const state = {};

/**
 * Helper: extract immutable economy fields cho anti-FE-self-grant compare.
 * @param {any} ch
 */
function snapshotEconomy(ch) {
  return {
    tienNgoc: String(ch.tienNgoc ?? ''),
    linhThach: String(ch.linhThach ?? ''),
  };
}

/**
 * @param {ReturnType<typeof snapshotEconomy>} before
 * @param {ReturnType<typeof snapshotEconomy>} after
 * @param {string} label
 */
function assertEconomyImmutable(before, after, label) {
  for (const key of /** @type {const} */ (['tienNgoc', 'linhThach'])) {
    if (before[key] !== after[key]) {
      throw new Error(
        `${label}: field ${key} thay đổi qua topup create order (anti-FE-self-grant — server chỉ credit khi admin approve): before=${before[key]} after=${after[key]}`,
      );
    }
  }
}

async function main() {
  console.log(`[smoke:topup] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}`);

  // 1. GET /topup/packages — public, không cần auth.
  await step('topup/packages — public list (no auth)', async () => {
    const r = await http('/api/topup/packages');
    assertStatus(r, 200, 'topup/packages');
    if (!r.body?.ok) throw new Error(`topup/packages: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const packages = r.body?.data?.packages;
    assert(Array.isArray(packages), 'topup/packages: data.packages phải là array');
    assert(packages.length >= 1, `topup/packages: ≥ 1 package required, got ${packages.length}`);
    for (const pkg of packages) {
      assert(typeof pkg.key === 'string' && pkg.key.length > 0, `topup/packages: package thiếu key`);
      assert(typeof pkg.name === 'string', `topup/packages: ${pkg.key} thiếu name`);
      assert(typeof pkg.tienNgoc === 'number' && pkg.tienNgoc > 0, `topup/packages: ${pkg.key} thiếu tienNgoc > 0`);
      assert(typeof pkg.priceVND === 'number' && pkg.priceVND > 0, `topup/packages: ${pkg.key} thiếu priceVND > 0`);
      assert(typeof pkg.bonus === 'number' && pkg.bonus >= 0, `topup/packages: ${pkg.key} thiếu bonus >= 0`);
    }
    state.firstPackageKey = packages[0].key;
    state.firstPackageTienNgoc = packages[0].tienNgoc + packages[0].bonus;
    const bank = r.body?.data?.bank;
    assert(bank && typeof bank.bankName === 'string', 'topup/packages: data.bank.bankName missing');
    assert(typeof bank.accountNumber === 'string', 'topup/packages: data.bank.accountNumber missing');
  });

  // 2. GET /topup/me chưa auth → 401.
  await step('topup/me — 401 UNAUTHENTICATED khi chưa register', async () => {
    const r = await http('/api/topup/me');
    assertStatus(r, 401, 'topup/me unauth');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `topup/me unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 3. POST /topup/create chưa auth → 401.
  await step('topup/create — 401 UNAUTHENTICATED khi chưa register', async () => {
    const r = await http('/api/topup/create', {
      method: 'POST',
      body: { packageKey: state.firstPackageKey },
    });
    assertStatus(r, 401, 'topup/create unauth');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `topup/create unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 4. Register fresh user.
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
  });

  // 6. Snapshot economy fields starting (cho anti-FE-self-grant compare).
  /** @type {ReturnType<typeof snapshotEconomy>} */
  let initialEconomy;
  await step('character/me — snapshot tienNgoc + linhThach starting', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me: no character in body');
    initialEconomy = snapshotEconomy(ch);
    state.startingTienNgoc = initialEconomy.tienNgoc;
    state.startingLinhThach = initialEconomy.linhThach;
  });

  // 7. GET /topup/me empty cho fresh user.
  await step('topup/me — empty list cho fresh user', async () => {
    const r = await http('/api/topup/me');
    assertStatus(r, 200, 'topup/me empty');
    if (!r.body?.ok) throw new Error(`topup/me empty: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const orders = r.body?.data?.orders;
    assert(Array.isArray(orders), 'topup/me empty: data.orders phải là array');
    assert(orders.length === 0, `topup/me empty: expect 0 orders, got ${orders.length}`);
  });

  // 8. POST /topup/create → 200 + transferCode regex.
  /** @type {string[]} */
  const transferCodes = [];
  state.transferCodes = transferCodes;
  await step('topup/create — first PENDING order', async () => {
    const r = await http('/api/topup/create', {
      method: 'POST',
      body: { packageKey: state.firstPackageKey },
    });
    assertStatus(r, 200, 'topup/create first');
    if (!r.body?.ok) throw new Error(`topup/create first: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const order = r.body?.data?.order;
    assert(order, 'topup/create first: missing data.order');
    assert(order.packageKey === state.firstPackageKey, `topup/create first: packageKey mismatch ${order.packageKey} vs ${state.firstPackageKey}`);
    assert(order.status === 'PENDING', `topup/create first: status phải PENDING, got ${order.status}`);
    assert(typeof order.transferCode === 'string', 'topup/create first: missing transferCode');
    assert(TRANSFER_CODE_RE.test(order.transferCode), `topup/create first: transferCode '${order.transferCode}' không khớp regex ${TRANSFER_CODE_RE}`);
    assert(
      order.tienNgocAmount === state.firstPackageTienNgoc,
      `topup/create first: tienNgocAmount=${order.tienNgocAmount} phải = pkg.tienNgoc + pkg.bonus = ${state.firstPackageTienNgoc}`,
    );
    transferCodes.push(order.transferCode);
  });

  // 9. GET /topup/me → 1 PENDING order.
  await step('topup/me — 1 PENDING order sau create', async () => {
    const r = await http('/api/topup/me');
    assertStatus(r, 200, 'topup/me 1');
    const orders = r.body?.data?.orders;
    assert(Array.isArray(orders) && orders.length === 1, `topup/me 1: expect 1 order, got ${orders?.length}`);
    assert(orders[0].status === 'PENDING', `topup/me 1: order status PENDING, got ${orders[0].status}`);
    assert(orders[0].transferCode === transferCodes[0], 'topup/me 1: transferCode mismatch');
  });

  // 10. POST /topup/create body { packageKey: 'invalid_xyz' } → 400 INVALID_PACKAGE.
  await step('topup/create — 400 INVALID_PACKAGE cho packageKey lạ', async () => {
    const r = await http('/api/topup/create', {
      method: 'POST',
      body: { packageKey: 'invalid_xyz_smoke_topup' },
    });
    assertStatus(r, 400, 'topup/create invalid');
    assert(r.body?.error?.code === 'INVALID_PACKAGE', `topup/create invalid: expect code INVALID_PACKAGE, got ${r.body?.error?.code}`);
  });

  // 11. POST /topup/create body {} → 400 INVALID_PACKAGE (Zod missing field).
  await step('topup/create — 400 INVALID_PACKAGE cho body {} (missing packageKey)', async () => {
    const r = await http('/api/topup/create', {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 400, 'topup/create missing');
    assert(r.body?.error?.code === 'INVALID_PACKAGE', `topup/create missing: expect code INVALID_PACKAGE, got ${r.body?.error?.code}`);
  });

  // 12. Tạo thêm 4 PENDING orders (để đủ 5 trên user, sau đó thử 6 → TOO_MANY_PENDING).
  await step('topup/create — fill thêm 4 PENDING orders để đạt MAX (= 5)', async () => {
    for (let i = 0; i < MAX_PENDING_PER_USER - 1; i++) {
      const r = await http('/api/topup/create', {
        method: 'POST',
        body: { packageKey: state.firstPackageKey },
      });
      assertStatus(r, 200, `topup/create fill #${i + 2}`);
      const order = r.body?.data?.order;
      assert(order && order.status === 'PENDING', `topup/create fill #${i + 2}: order PENDING required`);
      transferCodes.push(order.transferCode);
    }
    // Verify pairwise unique.
    const set = new Set(transferCodes);
    assert(set.size === transferCodes.length, `topup/create fill: transferCode KHÔNG unique pairwise — ${transferCodes.join(', ')}`);
  });

  // 13. POST /topup/create lần 6 → 429 TOO_MANY_PENDING.
  await step('topup/create — 429 TOO_MANY_PENDING khi đã 5 PENDING', async () => {
    const r = await http('/api/topup/create', {
      method: 'POST',
      body: { packageKey: state.firstPackageKey },
    });
    assertStatus(r, 429, 'topup/create over');
    assert(r.body?.error?.code === 'TOO_MANY_PENDING', `topup/create over: expect code TOO_MANY_PENDING, got ${r.body?.error?.code}`);
  });

  // 14. GET /topup/me → 5 PENDING orders + transferCodes match.
  await step('topup/me — 5 PENDING orders sau khi fill MAX', async () => {
    const r = await http('/api/topup/me');
    assertStatus(r, 200, 'topup/me 5');
    const orders = r.body?.data?.orders;
    assert(Array.isArray(orders) && orders.length === MAX_PENDING_PER_USER, `topup/me 5: expect ${MAX_PENDING_PER_USER} orders, got ${orders?.length}`);
    for (const order of orders) {
      assert(order.status === 'PENDING', `topup/me 5: every order phải PENDING, got ${order.status}`);
      assert(typeof order.transferCode === 'string' && TRANSFER_CODE_RE.test(order.transferCode), `topup/me 5: transferCode '${order.transferCode}' không hợp lệ`);
      assert(transferCodes.includes(order.transferCode), `topup/me 5: transferCode '${order.transferCode}' không match danh sách create`);
    }
  });

  // 15. Anti-FE-self-grant: GET /character/me lại, tienNgoc + linhThach KHÔNG đổi.
  await step('character/me — anti-FE-self-grant: tienNgoc + linhThach KHÔNG đổi sau create order PENDING', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me post-create');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me post-create: no character in body');
    const after = snapshotEconomy(ch);
    assertEconomyImmutable(initialEconomy, after, 'character/me post-create');
  });

  // 16. POST /_auth/logout + GET /topup/me → 401.
  await step('logout + topup/me — 401 UNAUTHENTICATED post-logout', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const r = await http('/api/topup/me');
    assertStatus(r, 401, 'topup/me post-logout');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `topup/me post-logout: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:topup] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:topup] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:topup] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:topup] unexpected error:', err);
  process.exitCode = 1;
});
