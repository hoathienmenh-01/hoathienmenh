#!/usr/bin/env node
/**
 * smoke-spiritual-root.mjs — Linh Căn (Spiritual Root) state machine smoke
 * cho Xuân Tôi.
 *
 * Mục tiêu: cover spiritual-root endpoints qua HTTP để đóng smoke gap còn lại
 * cho character module. Verify lazy-roll onboard idempotent + reroll negative
 * path (fresh char không có `linh_can_dan` item) + anti-FE-self-grant
 * invariant (failed reroll KHÔNG đụng grade/element/secondary/purity/
 * rerollCount).
 *
 * Smoke này KHÔNG cần admin seed → chỉ cover negative path + lazy onboard
 * idempotency. Full positive path (reroll thành công với inventory có
 * `linh_can_dan`) yêu cầu admin seed item hoặc dungeon drop — defer cho
 * future smoke với admin secret.
 *
 *   1. `GET  /api/character/spiritual-root` (no auth)        → 401.
 *   2. `POST /api/character/spiritual-root/reroll` (no auth) → 401.
 *   3. `POST /api/_auth/register`                            — fresh user.
 *   4. `GET  /api/character/spiritual-root` (no char)        → 404
 *                                                              NO_CHARACTER.
 *   5. `POST /api/character/spiritual-root/reroll` (no char) → 404
 *                                                              NO_CHARACTER.
 *   6. `POST /api/character/onboard`                         — fresh char.
 *   7. `GET  /api/character/spiritual-root`                  → 200, lazy
 *                                                              auto-roll
 *                                                              onboard,
 *                                                              snapshot
 *                                                              {grade,
 *                                                              primaryElement,
 *                                                              secondaryElements,
 *                                                              purity,
 *                                                              rerollCount=0}.
 *                                                              Verify shape:
 *                                                              grade ∈ pham/
 *                                                              linh/huyen/
 *                                                              tien/than;
 *                                                              primaryElement
 *                                                              ∈ kim/moc/
 *                                                              thuy/hoa/tho;
 *                                                              purity ∈
 *                                                              [80,100];
 *                                                              rerollCount=0.
 *   8. `GET  /api/character/spiritual-root` (lần 2)          → 200, state
 *                                                              IDEMPOTENT
 *                                                              (rollOnboard
 *                                                              guard log
 *                                                              source=
 *                                                              'onboard' →
 *                                                              KHÔNG re-roll).
 *   9. `POST /api/character/spiritual-root/reroll`           → 409
 *                                                              LINH_CAN_DAN_
 *                                                              INSUFFICIENT
 *                                                              (fresh char
 *                                                              có 0 stack
 *                                                              `linh_can_dan`
 *                                                              trong
 *                                                              inventory).
 *  10. `GET  /api/character/spiritual-root`                  → 200, state
 *                                                              KHÔNG đổi
 *                                                              qua failed
 *                                                              reroll
 *                                                              (anti-FE-
 *                                                              grant).
 *  11. `POST /api/character/spiritual-root/reroll` (idem)    → 409
 *                                                              LINH_CAN_DAN_
 *                                                              INSUFFICIENT
 *                                                              lần 2.
 *  12. `GET  /api/character/spiritual-root`                  → 200, state
 *                                                              vẫn KHÔNG
 *                                                              đổi sau idem
 *                                                              fail.
 *  13. `POST /api/_auth/logout` + GET /spiritual-root        → 401.
 *
 * Anti-FE-self-grant invariant (per Luật bắt buộc — KHÔNG để frontend tự
 * thay đổi linh căn qua failed reroll):
 *   - `grade` KHÔNG đổi qua failed call.
 *   - `primaryElement` KHÔNG đổi.
 *   - `secondaryElements` KHÔNG đổi (joined sorted compare).
 *   - `purity` KHÔNG đổi.
 *   - `rerollCount` KHÔNG đổi (tăng chỉ khi reroll THÀNH CÔNG).
 *
 * Chạy:
 *   pnpm smoke:spiritual-root
 *   # hoặc trực tiếp:
 *   node scripts/smoke-spiritual-root.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE   — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS — default 10000ms / request.
 *   SMOKE_VERBOSE    — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY   — default "thanh_van" (cho onboard).
 *
 * Yêu cầu môi trường (giống smoke:breakthrough / smoke:topup):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api bootstrap` (seed 3 sect)
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:spiritual-root`
 *
 * KHÔNG yêu cầu admin login. KHÔNG mutate DB ngoài user mới do chính smoke
 * tạo (random email + character name).
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

const VALID_GRADES = new Set(['pham', 'linh', 'huyen', 'tien', 'than']);
const VALID_ELEMENTS = new Set(['kim', 'moc', 'thuy', 'hoa', 'tho']);

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
  process.stdout.write(`[smoke:spiritual-root] ${name} ... `);
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
  return `smoke-spiritual-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `lc_${rand}`;
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

/**
 * @type {{
 *   email?: string;
 *   userId?: string;
 *   characterId?: string;
 * }}
 */
const state = {};

/**
 * Helper: extract immutable spiritual root fields cho anti-FE-grant compare.
 * @param {any} sr
 */
function snapshotSR(sr) {
  return {
    grade: String(sr?.grade ?? ''),
    primaryElement: String(sr?.primaryElement ?? ''),
    secondaryElements: Array.isArray(sr?.secondaryElements)
      ? [...sr.secondaryElements].sort().join(',')
      : '',
    purity: typeof sr?.purity === 'number' ? sr.purity : null,
    rerollCount: typeof sr?.rerollCount === 'number' ? sr.rerollCount : null,
  };
}

/**
 * @param {ReturnType<typeof snapshotSR>} before
 * @param {ReturnType<typeof snapshotSR>} after
 * @param {string} label
 */
function assertSRImmutable(before, after, label) {
  for (const key of /** @type {const} */ (['grade', 'primaryElement', 'secondaryElements', 'purity', 'rerollCount'])) {
    if (before[key] !== after[key]) {
      throw new Error(
        `${label}: field ${key} thay đổi qua failed reroll (anti-FE-self-grant): before=${before[key]} after=${after[key]}`,
      );
    }
  }
}

async function main() {
  console.log(`[smoke:spiritual-root] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}`);

  // 1. GET /spiritual-root chưa auth → 401.
  await step('GET /spiritual-root — 401 UNAUTHENTICATED khi chưa register', async () => {
    const r = await http('/api/character/spiritual-root');
    assertStatus(r, 401, 'GET unauth');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `GET unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 2. POST /spiritual-root/reroll chưa auth → 401.
  await step('POST /spiritual-root/reroll — 401 UNAUTHENTICATED khi chưa register', async () => {
    const r = await http('/api/character/spiritual-root/reroll', { method: 'POST' });
    assertStatus(r, 401, 'POST unauth');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `POST unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 3. Register fresh user.
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

  // 4. GET /spiritual-root khi chưa onboard → 404 NO_CHARACTER.
  await step('GET /spiritual-root — 404 NO_CHARACTER khi chưa onboard', async () => {
    const r = await http('/api/character/spiritual-root');
    assertStatus(r, 404, 'GET no-char');
    assert(r.body?.error?.code === 'NO_CHARACTER', `GET no-char: expect code NO_CHARACTER, got ${r.body?.error?.code}`);
  });

  // 5. POST /spiritual-root/reroll khi chưa onboard → 404 NO_CHARACTER.
  await step('POST /spiritual-root/reroll — 404 NO_CHARACTER khi chưa onboard', async () => {
    const r = await http('/api/character/spiritual-root/reroll', { method: 'POST' });
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
    const ch = r.body?.data?.character;
    assert(ch, 'onboard: missing character');
    state.characterId = ch.id;
  });

  // 7. GET /spiritual-root → lazy auto-roll onboard, snapshot state.
  /** @type {ReturnType<typeof snapshotSR>} */
  let initialSR;
  await step('GET /spiritual-root — lazy auto-roll onboard + verify shape', async () => {
    const r = await http('/api/character/spiritual-root');
    assertStatus(r, 200, 'GET first');
    if (!r.body?.ok) throw new Error(`GET first: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const sr = r.body?.data?.spiritualRoot;
    assert(sr, 'GET first: missing data.spiritualRoot');
    assert(VALID_GRADES.has(sr.grade), `GET first: grade '${sr.grade}' không trong ${[...VALID_GRADES].join('|')}`);
    assert(VALID_ELEMENTS.has(sr.primaryElement), `GET first: primaryElement '${sr.primaryElement}' không trong ${[...VALID_ELEMENTS].join('|')}`);
    assert(Array.isArray(sr.secondaryElements), 'GET first: secondaryElements phải là array');
    for (const el of sr.secondaryElements) {
      assert(VALID_ELEMENTS.has(el), `GET first: secondaryElements chứa '${el}' không hợp lệ`);
      assert(el !== sr.primaryElement, `GET first: secondaryElements chứa primaryElement '${el}' (phải distinct)`);
    }
    assert(typeof sr.purity === 'number' && sr.purity >= 80 && sr.purity <= 100, `GET first: purity '${sr.purity}' phải ∈ [80,100]`);
    assert(sr.rerollCount === 0, `GET first: rerollCount fresh char phải = 0, got ${sr.rerollCount}`);
    initialSR = snapshotSR(sr);
  });

  // 8. GET /spiritual-root lần 2 → state IDEMPOTENT (rollOnboard idempotency
  //    guard log source='onboard' KHÔNG re-roll).
  await step('GET /spiritual-root — lần 2 IDEMPOTENT (state KHÔNG đổi)', async () => {
    const r = await http('/api/character/spiritual-root');
    assertStatus(r, 200, 'GET second');
    const sr = r.body?.data?.spiritualRoot;
    const after = snapshotSR(sr);
    assertSRImmutable(initialSR, after, 'GET second idempotent');
  });

  // 9. POST /spiritual-root/reroll → 409 LINH_CAN_DAN_INSUFFICIENT (fresh
  //    char không có item linh_can_dan).
  await step('POST /spiritual-root/reroll — 409 LINH_CAN_DAN_INSUFFICIENT cho fresh char', async () => {
    const r = await http('/api/character/spiritual-root/reroll', { method: 'POST' });
    assertStatus(r, 409, 'POST reroll-no-item');
    assert(r.body?.error?.code === 'LINH_CAN_DAN_INSUFFICIENT', `POST reroll-no-item: expect code LINH_CAN_DAN_INSUFFICIENT, got ${r.body?.error?.code}`);
  });

  // 10. GET /spiritual-root → state KHÔNG đổi qua failed reroll (anti-FE-grant).
  await step('GET /spiritual-root — anti-FE-self-grant: state KHÔNG đổi sau failed reroll', async () => {
    const r = await http('/api/character/spiritual-root');
    assertStatus(r, 200, 'GET post-fail');
    const sr = r.body?.data?.spiritualRoot;
    const after = snapshotSR(sr);
    assertSRImmutable(initialSR, after, 'GET post-fail');
  });

  // 11. POST /spiritual-root/reroll lần 2 → 409 idempotent fail.
  await step('POST /spiritual-root/reroll — 409 lần 2 (idempotent fail)', async () => {
    const r = await http('/api/character/spiritual-root/reroll', { method: 'POST' });
    assertStatus(r, 409, 'POST reroll-idem-fail');
    assert(r.body?.error?.code === 'LINH_CAN_DAN_INSUFFICIENT', `POST reroll-idem-fail: expect code LINH_CAN_DAN_INSUFFICIENT, got ${r.body?.error?.code}`);
  });

  // 12. GET /spiritual-root → state vẫn KHÔNG đổi sau idem fail.
  await step('GET /spiritual-root — state vẫn KHÔNG đổi sau idem fail', async () => {
    const r = await http('/api/character/spiritual-root');
    assertStatus(r, 200, 'GET post-idem');
    const sr = r.body?.data?.spiritualRoot;
    const after = snapshotSR(sr);
    assertSRImmutable(initialSR, after, 'GET post-idem');
  });

  // 13. logout + GET /spiritual-root → 401 UNAUTHENTICATED.
  await step('logout + GET /spiritual-root — 401 UNAUTHENTICATED post-logout', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const r = await http('/api/character/spiritual-root');
    assertStatus(r, 401, 'GET post-logout');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `GET post-logout: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:spiritual-root] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:spiritual-root] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:spiritual-root] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:spiritual-root] unexpected error:', err);
  process.exitCode = 1;
});
