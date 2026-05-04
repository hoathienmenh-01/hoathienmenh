#!/usr/bin/env node
/**
 * smoke-breakthrough.mjs — Breakthrough endpoint state machine smoke cho Xuân Tôi.
 *
 * Mục tiêu: cover breakthrough endpoint qua HTTP để đóng "smoke gap" được
 * liệt kê ở `docs/AI_HANDOFF_REPORT.md` Recommended Next Roadmap
 * (`smoke:breakthrough`). Verify negative path (fresh char không thể đột phá
 * vì realmStage<9), error code shape, anti-FE-self-grant invariant.
 *
 * Smoke này KHÔNG cần admin seed → chỉ cover negative path. Full positive
 * path (đột phá thành công sang realm cao hơn) yêu cầu admin seed
 * `realmStage=9` + `exp >= cost` hoặc fast-forward realm script — defer cho
 * future smoke với admin secret.
 *
 *   1. `POST /api/character/breakthrough` (no auth)  → 401 UNAUTHENTICATED.
 *   2. `POST /api/_auth/register`                    — fresh user.
 *   3. `POST /api/character/breakthrough` (no char)  → 404 NO_CHARACTER
 *                                                       (logged in nhưng
 *                                                       chưa onboard).
 *   4. `POST /api/character/onboard`                 — fresh character
 *                                                       (luyenkhi stage=1,
 *                                                       exp=0).
 *   5. `GET  /api/character/me`                      — snapshot realmKey/
 *                                                       realmStage/exp/level/
 *                                                       hpMax/mpMax/hp/mp
 *                                                       cho anti-FE-grant
 *                                                       compare + verify
 *                                                       starting state.
 *   6. `POST /api/character/breakthrough`            → 409 NOT_AT_PEAK
 *                                                       (realmStage < 9 →
 *                                                       fail trước khi
 *                                                       check exp).
 *   7. `GET  /api/character/me`                      — verify realmKey/
 *                                                       realmStage/exp/
 *                                                       hpMax/mpMax KHÔNG
 *                                                       đổi qua failed
 *                                                       breakthrough (anti-
 *                                                       FE-self-grant).
 *   8. `POST /api/character/breakthrough` (idem)     → 409 NOT_AT_PEAK lần 2
 *                                                       (idempotent fail).
 *   9. `GET  /api/character/me`                      — verify state vẫn
 *                                                       unchanged sau idem
 *                                                       fail.
 *  10. `POST /api/character/breakthrough` body junk  → 409 NOT_AT_PEAK
 *                                                       (endpoint không
 *                                                       parse body — body
 *                                                       junk bị ignore,
 *                                                       vẫn chạy logic
 *                                                       NOT_AT_PEAK).
 *  11. `POST /api/_auth/logout` + breakthrough       → 401 UNAUTHENTICATED.
 *
 * Anti-FE-self-grant invariant (per Luật bắt buộc — KHÔNG để frontend tự
 * cộng EXP/realm/HP/MP qua failed breakthrough):
 *   - `realmKey` KHÔNG đổi qua failed call (fresh char vẫn `luyen_khi_1`).
 *   - `realmStage` KHÔNG đổi (vẫn 1).
 *   - `exp` KHÔNG đổi (vẫn 0 — failed breakthrough KHÔNG trừ exp).
 *   - `hpMax` / `mpMax` KHÔNG đổi (chỉ tăng 20% khi breakthrough thành
 *     công, không thay đổi qua failed call).
 *   - `level` KHÔNG đổi.
 *
 * Chạy:
 *   pnpm smoke:breakthrough
 *   # hoặc trực tiếp:
 *   node scripts/smoke-breakthrough.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE   — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS — default 10000ms / request.
 *   SMOKE_VERBOSE    — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY   — default "thanh_van" (cho onboard, không ảnh hưởng
 *                       breakthrough).
 *
 * Yêu cầu môi trường (giống smoke:topup / smoke:cultivation):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api bootstrap` (seed 3 sect)
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:breakthrough`
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
  process.stdout.write(`[smoke:breakthrough] ${name} ... `);
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
  return `smoke-breakthrough-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `bk_${rand}`;
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
 * Helper: extract immutable progression fields cho anti-FE-self-grant compare.
 * @param {any} ch
 */
function snapshotProgression(ch) {
  return {
    realmKey: String(ch.realmKey ?? ''),
    realmStage: typeof ch.realmStage === 'number' ? ch.realmStage : null,
    exp: String(ch.exp ?? ''),
    level: typeof ch.level === 'number' ? ch.level : null,
    hpMax: typeof ch.hpMax === 'number' ? ch.hpMax : null,
    mpMax: typeof ch.mpMax === 'number' ? ch.mpMax : null,
  };
}

/**
 * @param {ReturnType<typeof snapshotProgression>} before
 * @param {ReturnType<typeof snapshotProgression>} after
 * @param {string} label
 */
function assertProgressionImmutable(before, after, label) {
  for (const key of /** @type {const} */ (['realmKey', 'realmStage', 'exp', 'level', 'hpMax', 'mpMax'])) {
    if (before[key] !== after[key]) {
      throw new Error(
        `${label}: field ${key} thay đổi qua failed breakthrough (anti-FE-self-grant): before=${before[key]} after=${after[key]}`,
      );
    }
  }
}

async function main() {
  console.log(`[smoke:breakthrough] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}`);

  // 1. POST /breakthrough chưa auth → 401.
  await step('breakthrough — 401 UNAUTHENTICATED khi chưa register', async () => {
    const r = await http('/api/character/breakthrough', { method: 'POST' });
    assertStatus(r, 401, 'breakthrough unauth');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `breakthrough unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
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

  // 3. POST /breakthrough khi chưa onboard → 404 NO_CHARACTER.
  await step('breakthrough — 404 NO_CHARACTER khi chưa onboard', async () => {
    const r = await http('/api/character/breakthrough', { method: 'POST' });
    assertStatus(r, 404, 'breakthrough no-char');
    assert(r.body?.error?.code === 'NO_CHARACTER', `breakthrough no-char: expect code NO_CHARACTER, got ${r.body?.error?.code}`);
  });

  // 4. Onboard character.
  await step('onboard — create character (luyenkhi stage=1, exp=0)', async () => {
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

  // 5. Snapshot starting progression state (immutable cho anti-FE-grant).
  /** @type {ReturnType<typeof snapshotProgression>} */
  let initialSnapshot;
  await step('character/me — snapshot starting progression state', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me: no character in body');
    assert(typeof ch.realmStage === 'number', 'character/me: realmStage missing');
    assert(ch.realmStage < 9, `character/me: fresh char realmStage phải < 9, got ${ch.realmStage}`);
    assert(typeof ch.realmKey === 'string' && ch.realmKey.length > 0, 'character/me: realmKey missing');
    initialSnapshot = snapshotProgression(ch);
  });

  // 6. POST /breakthrough fresh char (realmStage<9) → 409 NOT_AT_PEAK.
  await step('breakthrough — 409 NOT_AT_PEAK cho fresh char (realmStage<9)', async () => {
    const r = await http('/api/character/breakthrough', { method: 'POST' });
    assertStatus(r, 409, 'breakthrough not-at-peak');
    assert(r.body?.error?.code === 'NOT_AT_PEAK', `breakthrough not-at-peak: expect code NOT_AT_PEAK, got ${r.body?.error?.code}`);
  });

  // 7. character/me — verify state unchanged sau failed breakthrough (anti-FE-grant).
  await step('character/me — anti-FE-self-grant: state unchanged sau failed breakthrough', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me post-fail');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me post-fail: no character in body');
    const after = snapshotProgression(ch);
    assertProgressionImmutable(initialSnapshot, after, 'character/me post-fail');
  });

  // 8. POST /breakthrough idempotent fail → 409 NOT_AT_PEAK lần 2.
  await step('breakthrough — 409 NOT_AT_PEAK lần 2 (idempotent fail)', async () => {
    const r = await http('/api/character/breakthrough', { method: 'POST' });
    assertStatus(r, 409, 'breakthrough idempotent-fail');
    assert(r.body?.error?.code === 'NOT_AT_PEAK', `breakthrough idempotent-fail: expect code NOT_AT_PEAK, got ${r.body?.error?.code}`);
  });

  // 9. character/me — verify state vẫn unchanged sau idempotent fail.
  await step('character/me — state vẫn unchanged sau idempotent fail', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me post-idem');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me post-idem: no character in body');
    const after = snapshotProgression(ch);
    assertProgressionImmutable(initialSnapshot, after, 'character/me post-idem');
  });

  // 10. POST /breakthrough với body junk → vẫn 409 NOT_AT_PEAK (endpoint không parse body).
  await step('breakthrough — body junk vẫn 409 NOT_AT_PEAK (endpoint không parse body)', async () => {
    const r = await http('/api/character/breakthrough', {
      method: 'POST',
      body: { foo: 'bar', realmStage: 9, exp: '99999999999' },
    });
    assertStatus(r, 409, 'breakthrough junk-body');
    assert(r.body?.error?.code === 'NOT_AT_PEAK', `breakthrough junk-body: expect code NOT_AT_PEAK (body bị ignore), got ${r.body?.error?.code}`);
  });

  // 11. logout + POST /breakthrough → 401 UNAUTHENTICATED.
  await step('logout + breakthrough — 401 UNAUTHENTICATED post-logout', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const r = await http('/api/character/breakthrough', { method: 'POST' });
    assertStatus(r, 401, 'breakthrough post-logout');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `breakthrough post-logout: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:breakthrough] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:breakthrough] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:breakthrough] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:breakthrough] unexpected error:', err);
  process.exitCode = 1;
});
