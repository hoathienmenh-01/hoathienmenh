#!/usr/bin/env node
/**
 * smoke-cultivation-method.mjs — Cultivation Method (Công Pháp) state machine
 * smoke cho Xuân Tôi.
 *
 * Mục tiêu: cover cultivation-method endpoints qua HTTP để đóng smoke gap
 * còn lại cho character module sau khi #359 cover cultivate, #361 cover
 * breakthrough, #362 cover spiritual-root. Verify auto-grant + auto-equip
 * starter `khai_thien_quyet` qua onboard, equip idempotency, body validation,
 * METHOD_NOT_FOUND cho key catalog không có, REALM_TOO_LOW cho method tier
 * cao hơn (verify realm gate), anti-FE-self-grant invariant (failed equip
 * KHÔNG đụng equippedMethodKey/learned methodKeys).
 *
 * Phase 11.X positive path UNBLOCKED qua admin grant-method (PR sau #389) +
 * grant-spiritual-root + set-realm: admin seed `CharacterCultivationMethod`
 * row source='admin' + force primaryElement để tránh FORBIDDEN_ELEMENT
 * non-deterministic + force realm để vượt REALM_TOO_LOW. Player
 * sau đó tự equip qua public endpoint — admin KHÔNG bypass equip gate
 * (validateLearnable vẫn chạy full).
 *
 *   1. `GET  /api/character/cultivation-method` (no auth)        → 401.
 *   2. `POST /api/character/cultivation-method/equip` (no auth)  → 401.
 *   3. `POST /api/_auth/register`                                — fresh user.
 *   4. `GET  /api/character/cultivation-method` (no char)        → 404
 *                                                                  NO_CHARACTER.
 *   5. `POST /api/character/cultivation-method/equip` (no char)  → 404
 *                                                                  NO_CHARACTER.
 *   6. `POST /api/character/onboard`                             — fresh char.
 *   7. `GET  /api/character/cultivation-method`                  → 200,
 *                                                                  equipped=
 *                                                                  'khai_thien
 *                                                                  _quyet',
 *                                                                  learned[]
 *                                                                  contains
 *                                                                  starter.
 *                                                                  Snapshot
 *                                                                  {equipped,
 *                                                                  learned
 *                                                                  methodKeys
 *                                                                  sorted
 *                                                                  joined}.
 *   8. `POST /api/character/cultivation-method/equip` body {}    → 400
 *                                                                  INVALID_INPUT
 *                                                                  (Zod fail
 *                                                                  missing
 *                                                                  methodKey).
 *   9. `POST .../equip` body {methodKey:''}                      → 400
 *                                                                  INVALID_INPUT
 *                                                                  (Zod min
 *                                                                  1).
 *  10. `POST .../equip` body {methodKey:'fake_xyz_unknown'}      → 404
 *                                                                  METHOD_NOT_
 *                                                                  FOUND
 *                                                                  (catalog
 *                                                                  miss).
 *  11. `POST .../equip` body {methodKey:'cuu_cuc_kim_cuong_quyet'} → 409
 *                                                                  REALM_TOO_LOW
 *                                                                  (fresh
 *                                                                  char ở
 *                                                                  luyenkhi
 *                                                                  order=1,
 *                                                                  truc_co
 *                                                                  order=2
 *                                                                  yêu cầu).
 *  12. `GET  /api/character/cultivation-method`                  → 200, state
 *                                                                  KHÔNG đổi
 *                                                                  qua 4
 *                                                                  failed
 *                                                                  attempts
 *                                                                  (anti-FE-
 *                                                                  grant).
 *  13. `POST .../equip` body {methodKey:'khai_thien_quyet'}      → 200
 *                                                                  idempotent
 *                                                                  re-equip
 *                                                                  starter,
 *                                                                  state vẫn
 *                                                                  giống
 *                                                                  snapshot.
 *  14. admin login + swap jar + set-realm truc_co s1 +            → 200 admin
 *      grant-spiritual-root than/kim + grant-method                  seed harness
 *      `cuu_cuc_kim_cuong_quyet` + grant-method idempotent           (positive path).
 *      + admin logout + restore player jar.
 *  15. `GET  /cultivation-method` (post-admin-seed)              → 200,
 *                                                                  learned[]
 *                                                                  có 2 row
 *                                                                  (starter
 *                                                                  + cuu_cuc),
 *                                                                  equipped=
 *                                                                  khai_thien
 *                                                                  (admin
 *                                                                  KHÔNG
 *                                                                  auto-equip).
 *  16. `POST .../equip` body {methodKey:'cuu_cuc_kim_cuong_quyet'} → 200
 *                                                                  switch
 *                                                                  positive
 *                                                                  path (
 *                                                                  realm
 *                                                                  truc_co
 *                                                                  + element
 *                                                                  kim qua
 *                                                                  forbidden
 *                                                                  moc).
 *  17. `POST .../equip` body {methodKey:'cuu_cuc_kim_cuong_quyet'} → 200
 *                                                                  idempotent
 *                                                                  re-equip
 *                                                                  cuu_cuc
 *                                                                  (state
 *                                                                  unchanged).
 *  18. `POST .../equip` body {methodKey:'khai_thien_quyet'}      → 200
 *                                                                  switch
 *                                                                  back
 *                                                                  starter
 *                                                                  (downgrade
 *                                                                  always
 *                                                                  OK — starter
 *                                                                  unlock
 *                                                                  phamnhan).
 *  19. `POST /api/_auth/logout` + GET /cultivation-method        → 401.
 *
 * Anti-FE-self-grant invariant (per Luật bắt buộc — KHÔNG để frontend tự
 * thay đổi công pháp qua failed equip):
 *   - `equippedMethodKey` KHÔNG đổi qua failed attempts.
 *   - `learned[]` methodKeys KHÔNG có row mới (sorted joined compare).
 *   - Admin grant-method **KHÔNG** auto-equip — chỉ insert row
 *     `CharacterCultivationMethod` với source='admin'. Player phải
 *     gọi `POST /equip` thủ công (server vẫn validate realm/sect/
 *     element gate — admin KHÔNG bypass equip).
 *   - Admin grant-method idempotent qua P2002 catch — gọi 2 lần
 *     vẫn chỉ 1 row, audit ghi cả 2 lần với `alreadyLearned: true` lc 2.
 *
 * Chạy:
 *   pnpm smoke:cultivation-method
 *   # hoặc trực tiếp:
 *   node scripts/smoke-cultivation-method.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE     — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS   — default 10000ms / request.
 *   SMOKE_VERBOSE      — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY     — default "thanh_van".
 *   SMOKE_HIGH_TIER    — default "cuu_cuc_kim_cuong_quyet" (truc_co tier).
 *   SMOKE_ADMIN_EMAIL    — default "admin@example.com" (bootstrap admin).
 *   SMOKE_ADMIN_PASSWORD — default "change-me-bootstrap-pass" (bootstrap).
 *
 * Yêu cầu môi trường (giống smoke:spiritual-root):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api bootstrap` (seed 3 sect + admin
 *     INITIAL_ADMIN_EMAIL/PASSWORD env cần match SMOKE_ADMIN_EMAIL/PASSWORD).
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:cultivation-method`
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
const STARTER_METHOD_KEY = 'khai_thien_quyet';
const HIGH_TIER_METHOD_KEY = process.env.SMOKE_HIGH_TIER ?? 'cuu_cuc_kim_cuong_quyet';
const FAKE_METHOD_KEY = 'fake_xyz_unknown_cultivation_method_key';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'change-me-bootstrap-pass';

// `cuu_cuc_kim_cuong_quyet` (truc_co tier, requiredSect=null,
// forbiddenElements=['moc']). Force primaryElement='kim' qua admin
// grant-spiritual-root để deterministic equip-pass (avoid 'moc'
// non-deterministic onboard roll).
const FORCE_PRIMARY_ELEMENT = 'kim';
const FORCE_ROOT_GRADE = 'than'; // max grade để đủ secondaryElementCount=4.

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
  process.stdout.write(`[smoke:cm] ${name} ... `);
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
  return `smoke-cm-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `cm_${rand}`;
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

/**
 * Helper: extract immutable cultivation-method state cho anti-FE-grant compare.
 * @param {any} cm
 */
function snapshotCM(cm) {
  const learnedKeys = Array.isArray(cm?.learned)
    ? [...cm.learned.map((/** @type {any} */ row) => String(row?.methodKey ?? ''))].sort().join(',')
    : '';
  return {
    equippedMethodKey: String(cm?.equippedMethodKey ?? ''),
    learnedKeys,
    learnedCount: Array.isArray(cm?.learned) ? cm.learned.length : -1,
  };
}

/**
 * @param {ReturnType<typeof snapshotCM>} before
 * @param {ReturnType<typeof snapshotCM>} after
 * @param {string} label
 */
function assertCMImmutable(before, after, label) {
  for (const key of /** @type {const} */ (['equippedMethodKey', 'learnedKeys', 'learnedCount'])) {
    if (before[key] !== after[key]) {
      throw new Error(
        `${label}: field ${key} thay đổi qua failed equip (anti-FE-self-grant): before=${before[key]} after=${after[key]}`,
      );
    }
  }
}

async function main() {
  console.log(`[smoke:cm] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}, starter = ${STARTER_METHOD_KEY}, high-tier = ${HIGH_TIER_METHOD_KEY}`);

  // 1. GET /cultivation-method chưa auth → 401.
  await step('GET /cultivation-method — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/character/cultivation-method');
    assertStatus(r, 401, 'GET unauth');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `GET unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 2. POST /cultivation-method/equip chưa auth → 401.
  await step('POST /cultivation-method/equip — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/character/cultivation-method/equip', {
      method: 'POST',
      body: { methodKey: STARTER_METHOD_KEY },
    });
    assertStatus(r, 401, 'POST unauth');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `POST unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 3. Register fresh user.
  const email = randomEmail();
  const password = randomPassword();
  /** @type {{ userId: string | null }} */
  const state = { userId: null };
  await step('register', async () => {
    const r = await http('/api/_auth/register', {
      method: 'POST',
      body: { email, password },
    });
    assertStatus(r, [200, 201], 'register');
    if (!r.body?.ok) throw new Error(`register: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const userId = r.body?.data?.user?.id;
    assert(typeof userId === 'string' && userId.length > 0, 'register: missing user.id');
    state.userId = userId;
  });

  // 4. GET /cultivation-method khi chưa onboard → 404 NO_CHARACTER.
  await step('GET /cultivation-method — 404 NO_CHARACTER khi chưa onboard', async () => {
    const r = await http('/api/character/cultivation-method');
    assertStatus(r, 404, 'GET no-char');
    assert(r.body?.error?.code === 'NO_CHARACTER', `GET no-char: expect code NO_CHARACTER, got ${r.body?.error?.code}`);
  });

  // 5. POST /cultivation-method/equip khi chưa onboard → 404 NO_CHARACTER.
  await step('POST /cultivation-method/equip — 404 NO_CHARACTER khi chưa onboard', async () => {
    const r = await http('/api/character/cultivation-method/equip', {
      method: 'POST',
      body: { methodKey: STARTER_METHOD_KEY },
    });
    assertStatus(r, 404, 'POST no-char');
    assert(r.body?.error?.code === 'NO_CHARACTER', `POST no-char: expect code NO_CHARACTER, got ${r.body?.error?.code}`);
  });

  // 6. Onboard character.
  await step('onboard — create character', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: randomCharName(), sectKey: SECT_KEY },
    });
    assertStatus(r, 200, 'onboard');
    if (!r.body?.ok) throw new Error(`onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.character, 'onboard: missing character');
  });

  // 7. GET /cultivation-method → 200, fresh char đã được auto-grant +
  //    auto-equip starter qua onboard. Snapshot state.
  /** @type {ReturnType<typeof snapshotCM>} */
  let initialCM;
  await step('GET /cultivation-method — fresh char auto-equipped starter + verify shape', async () => {
    const r = await http('/api/character/cultivation-method');
    assertStatus(r, 200, 'GET first');
    if (!r.body?.ok) throw new Error(`GET first: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const cm = r.body?.data?.cultivationMethod;
    assert(cm, 'GET first: missing data.cultivationMethod');
    assert(cm.equippedMethodKey === STARTER_METHOD_KEY, `GET first: expect equippedMethodKey=${STARTER_METHOD_KEY}, got ${cm.equippedMethodKey}`);
    assert(Array.isArray(cm.learned), 'GET first: learned phải là array');
    assert(cm.learned.length >= 1, `GET first: learned phải có ≥ 1 row, got ${cm.learned.length}`);
    const starter = cm.learned.find((/** @type {any} */ row) => row.methodKey === STARTER_METHOD_KEY);
    assert(starter, `GET first: learned phải chứa methodKey=${STARTER_METHOD_KEY}`);
    assert(starter.source === 'starter', `GET first: starter row source phải = 'starter', got ${starter.source}`);
    assert(typeof starter.learnedAt === 'string', `GET first: starter.learnedAt phải là ISO string, got ${typeof starter.learnedAt}`);
    initialCM = snapshotCM(cm);
  });

  // 8. POST /equip body {} → 400 INVALID_INPUT (Zod fail missing methodKey).
  await step('POST /equip — 400 INVALID_INPUT body {}', async () => {
    const r = await http('/api/character/cultivation-method/equip', {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 400, 'POST body-empty');
    assert(r.body?.error?.code === 'INVALID_INPUT', `POST body-empty: expect code INVALID_INPUT, got ${r.body?.error?.code}`);
  });

  // 9. POST /equip body {methodKey:''} → 400 INVALID_INPUT (Zod min 1).
  await step("POST /equip — 400 INVALID_INPUT body {methodKey:''}", async () => {
    const r = await http('/api/character/cultivation-method/equip', {
      method: 'POST',
      body: { methodKey: '' },
    });
    assertStatus(r, 400, 'POST body-empty-key');
    assert(r.body?.error?.code === 'INVALID_INPUT', `POST body-empty-key: expect code INVALID_INPUT, got ${r.body?.error?.code}`);
  });

  // 10. POST /equip methodKey='fake_xyz_unknown' → 404 METHOD_NOT_FOUND.
  await step('POST /equip — 404 METHOD_NOT_FOUND cho methodKey lạ', async () => {
    const r = await http('/api/character/cultivation-method/equip', {
      method: 'POST',
      body: { methodKey: FAKE_METHOD_KEY },
    });
    assertStatus(r, 404, 'POST method-not-found');
    assert(r.body?.error?.code === 'METHOD_NOT_FOUND', `POST method-not-found: expect code METHOD_NOT_FOUND, got ${r.body?.error?.code}`);
  });

  // 11. POST /equip methodKey='cuu_cuc_kim_cuong_quyet' (truc_co tier) →
  //     409 REALM_TOO_LOW (fresh char ở luyenkhi order=1, truc_co order=2).
  await step('POST /equip — 409 REALM_TOO_LOW cho method tier cao hơn', async () => {
    const r = await http('/api/character/cultivation-method/equip', {
      method: 'POST',
      body: { methodKey: HIGH_TIER_METHOD_KEY },
    });
    assertStatus(r, 409, 'POST realm-too-low');
    assert(r.body?.error?.code === 'REALM_TOO_LOW', `POST realm-too-low: expect code REALM_TOO_LOW, got ${r.body?.error?.code}`);
  });

  // 12. GET /cultivation-method → state KHÔNG đổi qua 4 failed attempts
  //     (anti-FE-self-grant invariant).
  await step('GET /cultivation-method — anti-FE-self-grant: state KHÔNG đổi sau 4 failed equips', async () => {
    const r = await http('/api/character/cultivation-method');
    assertStatus(r, 200, 'GET post-fail');
    const cm = r.body?.data?.cultivationMethod;
    const after = snapshotCM(cm);
    assertCMImmutable(initialCM, after, 'GET post-fail');
  });

  // 13. POST /equip methodKey='khai_thien_quyet' → 200 idempotent re-equip
  //     starter, state vẫn giống snapshot (no duplicate learned row).
  await step('POST /equip — 200 idempotent re-equip starter', async () => {
    const r = await http('/api/character/cultivation-method/equip', {
      method: 'POST',
      body: { methodKey: STARTER_METHOD_KEY },
    });
    assertStatus(r, 200, 'POST equip-starter');
    if (!r.body?.ok) throw new Error(`POST equip-starter: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const cm = r.body?.data?.cultivationMethod;
    const after = snapshotCM(cm);
    assertCMImmutable(initialCM, after, 'POST equip-starter idempotent');
  });

  // ---------------------------------------------------------------------------
  // POSITIVE PATH (Phase 11.X unblocked qua admin grant-method + grant-spiritual
  // -root + set-realm seed harness).
  //
  // Snapshot before vs after invariant: equippedMethodKey starter → cuu_cuc
  // → starter (player switch). learned[] starter-only → starter+cuu_cuc
  // (admin grant + idempotent qua P2002 catch). Admin **KHÔNG** auto-equip
  // method mới grant; player phải tự gọi POST /equip qua public endpoint
  // (server vẫn validateLearnable — admin KHÔNG bypass equip gate).
  // ---------------------------------------------------------------------------

  // 14. Snapshot player cookies + admin login → swap jar → set-realm truc_co
  //     s1 + grant-spiritual-root than/kim + grant-method cuu_cuc + grant-
  //     method idempotent (verify P2002 catch) → admin logout → restore
  //     player jar.
  /** @type {Map<string,string> | null} */
  let playerCookieSnap = null;
  await step('admin login + set-realm truc_co + grant-root + grant-method (positive seed)', async () => {
    if (!state.userId) throw new Error('state.userId missing — register chưa chạy');
    playerCookieSnap = snapshotCookies();
    cookieJar.clear();
    const login = await http('/api/_auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assertStatus(login, 200, 'admin login (cm seed)');
    const u = login.body?.data?.user;
    assert(u?.role === 'ADMIN', `admin login: role phải ADMIN (cần bootstrap admin@example.com), got ${u?.role}`);

    // Force realm → vượt REALM_TOO_LOW khi player equip cuu_cuc.
    const setRealm = await http(`/api/admin/users/${state.userId}/set-realm`, {
      method: 'POST',
      body: { realmKey: 'truc_co', realmStage: 1, reason: 'smoke cm positive seed' },
    });
    assertStatus(setRealm, 200, 'admin set-realm truc_co s1');
    assert(setRealm.body?.ok === true, `set-realm: shape mismatch, got ${JSON.stringify(setRealm.body)}`);

    // Force primaryElement='kim' → vượt FORBIDDEN_ELEMENT khi player equip
    // cuu_cuc_kim_cuong_quyet (forbidden=['moc']). Thần grade để secondary
    // count=4 deterministic.
    const setRoot = await http(`/api/admin/users/${state.userId}/grant-spiritual-root`, {
      method: 'POST',
      body: {
        grade: FORCE_ROOT_GRADE,
        primaryElement: FORCE_PRIMARY_ELEMENT,
        purity: 100,
        reason: 'smoke cm positive seed',
      },
    });
    assertStatus(setRoot, 200, 'admin grant-spiritual-root than/kim');
    assert(setRoot.body?.ok === true, `grant-spiritual-root: shape mismatch, got ${JSON.stringify(setRoot.body)}`);

    // Grant method `cuu_cuc_kim_cuong_quyet` → insert row source='admin'.
    const grant1 = await http(`/api/admin/users/${state.userId}/grant-method`, {
      method: 'POST',
      body: { methodKey: HIGH_TIER_METHOD_KEY, reason: 'smoke cm positive seed' },
    });
    assertStatus(grant1, 200, 'admin grant-method 1st');
    assert(
      grant1.body?.ok === true && grant1.body?.data?.ok === true,
      `grant-method 1st: shape mismatch, got ${JSON.stringify(grant1.body)}`,
    );

    // Grant lại → P2002 catch → vẫn 200 OK (idempotent). Audit ghi 2 row
    // với `alreadyLearned: true` cho lc 2 — verify qua admin-seed-harness-ext
    // service test (vitest), không spam smoke.
    const grant2 = await http(`/api/admin/users/${state.userId}/grant-method`, {
      method: 'POST',
      body: { methodKey: HIGH_TIER_METHOD_KEY, reason: 'smoke cm idempotent' },
    });
    assertStatus(grant2, 200, 'admin grant-method 2nd (idempotent)');
    assert(
      grant2.body?.ok === true && grant2.body?.data?.ok === true,
      `grant-method 2nd: shape mismatch, got ${JSON.stringify(grant2.body)}`,
    );

    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'admin logout (cm seed)');
    cookieJar.clear();
    if (!playerCookieSnap) throw new Error('playerCookieSnap missing');
    restoreCookies(playerCookieSnap);
  });

  // 15. GET /cultivation-method — learned[] post-admin-seed: starter +
  //     cuu_cuc_kim_cuong_quyet (admin grant không dup), equipped vẫn=
  //     starter (admin grant-method KHÔNG auto-equip).
  /** @type {ReturnType<typeof snapshotCM>} */
  let postSeedCM;
  await step('GET /cultivation-method — post-admin-seed: learned starter+cuu_cuc, equipped vẫn starter', async () => {
    const r = await http('/api/character/cultivation-method');
    assertStatus(r, 200, 'GET post-seed');
    if (!r.body?.ok) throw new Error(`GET post-seed: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const cm = r.body?.data?.cultivationMethod;
    assert(cm, 'GET post-seed: missing data.cultivationMethod');
    assert(
      cm.equippedMethodKey === STARTER_METHOD_KEY,
      `GET post-seed: equippedMethodKey phải vẫn starter (admin KHÔNG auto-equip), got ${cm.equippedMethodKey}`,
    );
    assert(Array.isArray(cm.learned), 'GET post-seed: learned phải array');
    assert(
      cm.learned.length === 2,
      `GET post-seed: learned phải 2 row (starter + cuu_cuc, idempotent grant không dup), got ${cm.learned.length}`,
    );
    const seeded = cm.learned.find((/** @type {any} */ row) => row.methodKey === HIGH_TIER_METHOD_KEY);
    assert(seeded, `GET post-seed: learned phải chứa ${HIGH_TIER_METHOD_KEY}`);
    assert(seeded.source === 'admin', `GET post-seed: ${HIGH_TIER_METHOD_KEY} source phải 'admin', got ${seeded.source}`);
    postSeedCM = snapshotCM(cm);
  });

  // 16. POST /equip cuu_cuc_kim_cuong_quyet → 200 switch positive (player
  //     thủ công equip qua public endpoint, server validateLearnable
  //     full — realm truc_co OK, sect null OK, element kim ko forbidden).
  await step(`POST /equip ${HIGH_TIER_METHOD_KEY} — 200 switch positive (post-admin-seed)`, async () => {
    const r = await http('/api/character/cultivation-method/equip', {
      method: 'POST',
      body: { methodKey: HIGH_TIER_METHOD_KEY },
    });
    assertStatus(r, 200, 'POST equip cuu_cuc');
    if (!r.body?.ok) throw new Error(`POST equip cuu_cuc: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const cm = r.body?.data?.cultivationMethod;
    assert(
      cm?.equippedMethodKey === HIGH_TIER_METHOD_KEY,
      `POST equip cuu_cuc: equippedMethodKey phải ${HIGH_TIER_METHOD_KEY}, got ${cm?.equippedMethodKey}`,
    );
    assert(Array.isArray(cm?.learned) && cm.learned.length === 2, `POST equip cuu_cuc: learned vẫn 2 row`);
  });

  // 17. POST /equip cuu_cuc_kim_cuong_quyet lần 2 → 200 idempotent
  //     (state vẫn equipped=cuu_cuc, learned[] không dup).
  await step(`POST /equip ${HIGH_TIER_METHOD_KEY} — 200 idempotent re-equip`, async () => {
    const r = await http('/api/character/cultivation-method/equip', {
      method: 'POST',
      body: { methodKey: HIGH_TIER_METHOD_KEY },
    });
    assertStatus(r, 200, 'POST equip cuu_cuc idempotent');
    const cm = r.body?.data?.cultivationMethod;
    assert(
      cm?.equippedMethodKey === HIGH_TIER_METHOD_KEY,
      `POST equip cuu_cuc 2nd: equippedMethodKey phải ${HIGH_TIER_METHOD_KEY}`,
    );
    assert(Array.isArray(cm?.learned) && cm.learned.length === 2, `POST equip cuu_cuc 2nd: learned vẫn 2 row`);
  });

  // 18. POST /equip starter → 200 switch back (downgrade always OK — starter
  //     unlock=phamnhan, mọi realm đều qualify).
  await step(`POST /equip ${STARTER_METHOD_KEY} — 200 switch back to starter`, async () => {
    const r = await http('/api/character/cultivation-method/equip', {
      method: 'POST',
      body: { methodKey: STARTER_METHOD_KEY },
    });
    assertStatus(r, 200, 'POST equip starter back');
    const cm = r.body?.data?.cultivationMethod;
    assert(
      cm?.equippedMethodKey === STARTER_METHOD_KEY,
      `POST equip starter back: equippedMethodKey phải ${STARTER_METHOD_KEY}`,
    );
    assert(Array.isArray(cm?.learned) && cm.learned.length === 2, `POST equip starter back: learned vẫn 2 row (không mất cuu_cuc)`);
    // Anti-FE invariant: switch back không phải delete — learned snapshot
    // post-seed vẫn match (cuu_cuc row vẫn tồn tại).
    const after = snapshotCM(cm);
    assert(after.learnedKeys === postSeedCM.learnedKeys, `POST equip starter back: learnedKeys lost cuu_cuc row`);
  });

  // 19. logout + GET /cultivation-method → 401 UNAUTHENTICATED.
  await step('logout + GET /cultivation-method — 401 UNAUTHENTICATED', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const r = await http('/api/character/cultivation-method');
    assertStatus(r, 401, 'GET post-logout');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `GET post-logout: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:cm] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:cm] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:cm] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:cm] unexpected error:', err);
  process.exitCode = 1;
});
