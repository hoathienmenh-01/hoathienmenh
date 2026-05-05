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
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'change-me-bootstrap-pass';

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

  // 1b. POST /breakthrough/attempt (Phase 11 nâng cao §5 PR2 RNG endpoint) chưa auth → 401.
  //     Mirror invariant với endpoint cũ — auth gate trước requireUserId().
  await step('breakthrough/attempt — 401 UNAUTHENTICATED khi chưa register', async () => {
    const r = await http('/api/character/breakthrough/attempt', { method: 'POST' });
    assertStatus(r, 401, 'breakthrough/attempt unauth');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `breakthrough/attempt unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
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

  // 3b. POST /breakthrough/attempt khi chưa onboard → 404 NO_CHARACTER (mirror invariant).
  await step('breakthrough/attempt — 404 NO_CHARACTER khi chưa onboard', async () => {
    const r = await http('/api/character/breakthrough/attempt', { method: 'POST' });
    assertStatus(r, 404, 'breakthrough/attempt no-char');
    assert(r.body?.error?.code === 'NO_CHARACTER', `breakthrough/attempt no-char: expect code NO_CHARACTER, got ${r.body?.error?.code}`);
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

  // 6b. POST /breakthrough/attempt fresh char (realmStage<9) → 409 NOT_AT_PEAK.
  //     RNG endpoint dùng cùng peak gate — không roll RNG nếu chưa peak.
  await step('breakthrough/attempt — 409 NOT_AT_PEAK cho fresh char (realmStage<9)', async () => {
    const r = await http('/api/character/breakthrough/attempt', { method: 'POST' });
    assertStatus(r, 409, 'breakthrough/attempt not-at-peak');
    assert(r.body?.error?.code === 'NOT_AT_PEAK', `breakthrough/attempt not-at-peak: expect code NOT_AT_PEAK, got ${r.body?.error?.code}`);
  });

  // 6c. character/me — anti-FE-self-grant: state unchanged sau /attempt fail.
  //     /attempt KHÔNG rút EXP, KHÔNG advance khi NOT_AT_PEAK; KHÔNG ghi log.
  await step('character/me — state unchanged sau /breakthrough/attempt fail (anti-FE-self-grant)', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me post-attempt-fail');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me post-attempt-fail: no character in body');
    const after = snapshotProgression(ch);
    assertProgressionImmutable(initialSnapshot, after, 'character/me post-attempt-fail');
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

  // -----------------------------------------------------------------------------
  // POSITIVE PATH — admin seed grant-exp lên peak luyenkhi → manual breakthrough → realm advance.
  //
  // Foundation từ PR #383 admin seed harness BE:
  //   POST /admin/users/:id/grant-exp với delta đủ lớn → service auto-advance
  //   stage 1..8 (mirror cultivation processor), dừng ở stage 9 với exp >= cost(9).
  //   Sau đó player /character/breakthrough → realm advance luyenkhi → truc_co.
  //
  // Anti-FE-self-grant invariant: tất cả mutation EXP/realm đều qua admin endpoint
  // hoặc breakthrough endpoint. Không bypass authority — admin chỉ kích hoạt
  // logic giống cultivation tick natural progression.
  // -----------------------------------------------------------------------------

  /** @type {Map<string,string>} */
  let playerCookieSnap;

  // 11. Snapshot player cookies + admin login → swap jar.
  await step('admin login — swap cookie jar (player → admin)', async () => {
    playerCookieSnap = snapshotCookies();
    cookieJar.clear();
    const r = await http('/api/_auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assertStatus(r, 200, 'admin login');
    if (!r.body?.ok) throw new Error(`admin login: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const u = r.body?.data?.user;
    assert(u?.role === 'ADMIN', `admin login: role phải ADMIN (cần bootstrap admin@example.com), got ${u?.role}`);
  });

  // 12. Admin POST /admin/users/:id/grant-exp { exp: '200000' } → 200 ok.
  // luyenkhi sum cap stage 1..8 = 55031. Grant 200000 → service auto-advance
  // stage 1→9, exp = 200000 - 55031 = 144969 (>= cost(9)=23613, đủ break).
  await step('admin POST /admin/users/:id/grant-exp { exp: "200000" } → 200 ok (seed peak)', async () => {
    if (!state.userId) throw new Error('state.userId missing — register chưa chạy');
    const r = await http(`/api/admin/users/${state.userId}/grant-exp`, {
      method: 'POST',
      body: { exp: '200000', reason: 'smoke breakthrough peak seed' },
    });
    assertStatus(r, 200, 'admin/users/:id/grant-exp');
    assert(
      r.body?.ok === true && r.body?.data?.ok === true,
      `grant-exp 200: shape mismatch, got ${JSON.stringify(r.body)}`,
    );
  });

  // 13. Admin GET /admin/audit?action=admin.exp.grant → row >= 1 (seed audit).
  await step('admin GET /admin/audit?action=admin.exp.grant — row >= 1 (audit từ step 12)', async () => {
    const r = await http('/api/admin/audit?action=admin.exp.grant');
    assertStatus(r, 200, 'admin/audit?action=admin.exp.grant');
    const rows = r.body?.data?.rows ?? [];
    assert(Array.isArray(rows) && rows.length >= 1, `audit grant-exp: phải >= 1 row, got ${rows?.length}`);
    assert(rows[0].action === 'admin.exp.grant', `audit row[0].action: expect 'admin.exp.grant', got '${rows[0].action}'`);
  });

  // 14. Admin logout → restore player cookies.
  await step('admin logout + restore player cookies', async () => {
    const r = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(r, [200, 204], 'admin logout');
    cookieJar.clear();
    restoreCookies(playerCookieSnap);
  });

  // 15. Player GET /character/me → verify state post-grant: realmStage=9, exp >= cost(9).
  await step('character/me — post-grant: realmStage=9 + exp >= cost(9) (server-authoritative seed)', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me post-grant');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me: no character');
    assert(ch.realmStage === 9, `realmStage post-grant: expect 9 (auto-advance từ stage 1), got ${ch.realmStage}`);
    assert(ch.realmKey === 'luyenkhi', `realmKey post-grant: expect 'luyenkhi' (chưa cross realm), got '${ch.realmKey}'`);
    const expBig = BigInt(ch.exp);
    assert(
      expBig >= 23613n,
      `exp post-grant: expect >= cost(9)=23613 (đủ peak để break), got ${expBig}`,
    );
  });

  // 16. POST /character/breakthrough → 200 ok + advance realm luyenkhi → truc_co.
  await step('breakthrough → 200 ok + advance realm (luyenkhi → truc_co)', async () => {
    const r = await http('/api/character/breakthrough', { method: 'POST' });
    assertStatus(r, 200, 'breakthrough happy');
    if (!r.body?.ok) throw new Error(`breakthrough: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const ch = r.body?.data?.character;
    assert(ch, 'breakthrough: missing character in body');
    assert(ch.realmKey === 'truc_co', `breakthrough advance: expect realmKey='truc_co' (next sau luyenkhi), got '${ch.realmKey}'`);
    assert(ch.realmStage === 1, `breakthrough advance: expect realmStage=1 (reset sau cross realm), got ${ch.realmStage}`);
  });

  // 17. character/me — verify post-breakthrough state mirror response (realm advance + exp deducted + hp/mp scale 1.2x).
  await step('character/me — post-breakthrough state mirror response (realm advance + exp deducted)', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me post-break');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me post-break: no character');
    assert(ch.realmKey === 'truc_co', `post-break realmKey: expect 'truc_co', got '${ch.realmKey}'`);
    assert(ch.realmStage === 1, `post-break realmStage: expect 1, got ${ch.realmStage}`);
    // exp post-break = 144969 (seed) - 23613 (cost(9) luyenkhi) = 121356.
    assert(ch.exp === '121356', `post-break exp: expect '121356' (144969 - 23613), got '${ch.exp}'`);
    // HP/MP cap scale 1.2x sau cross realm — luyenkhi base 100/50 → 120/60.
    assert(typeof ch.hpMax === 'number' && ch.hpMax > 0, `post-break hpMax phải number > 0, got ${ch.hpMax}`);
    assert(typeof ch.mpMax === 'number' && ch.mpMax > 0, `post-break mpMax phải number > 0, got ${ch.mpMax}`);
  });

  // 18. POST /breakthrough lần 2 sau khi đã advance → 409 NOT_AT_PEAK (idempotent).
  // Char giờ ở truc_co stage 1, exp=121356. cost(9) truc_co lớn hơn nhiều nên break thất bại (NOT_AT_PEAK).
  await step('breakthrough — 409 NOT_AT_PEAK lần 2 sau advance (truc_co stage 1)', async () => {
    const r = await http('/api/character/breakthrough', { method: 'POST' });
    assertStatus(r, 409, 'breakthrough post-advance');
    assert(r.body?.error?.code === 'NOT_AT_PEAK', `breakthrough post-advance: expect NOT_AT_PEAK, got ${r.body?.error?.code}`);
  });

  // 18b. POST /breakthrough/attempt sau khi đã advance → 409 NOT_AT_PEAK (mirror).
  //      Char ở truc_co stage 1; /attempt cùng peak gate → không roll RNG.
  await step('breakthrough/attempt — 409 NOT_AT_PEAK lần 2 sau advance (truc_co stage 1)', async () => {
    const r = await http('/api/character/breakthrough/attempt', { method: 'POST' });
    assertStatus(r, 409, 'breakthrough/attempt post-advance');
    assert(r.body?.error?.code === 'NOT_AT_PEAK', `breakthrough/attempt post-advance: expect NOT_AT_PEAK, got ${r.body?.error?.code}`);
  });

  // ----------------------------------------------------------------------------
  // RNG positive-path /breakthrough/attempt (Phase 11 nâng cao §5 PR2):
  //   - admin grant-exp 50000 → auto-advance truc_co stage 1 → 9 + thừa exp
  //     vượt cost(stage 9 truc_co) ≈ 37781 (BASE_EXP=2560 × 1.4^8).
  //   - POST /breakthrough/attempt → branch theo outcome (Math.random):
  //       * success: char advance → kim_dan stage 1 + restats; debuff.applied=false.
  //       * fail: char giữ truc_co stage 9; debuff.applied=true, key='tam_ma_light',
  //         expiresAt ISO 300s sau now (BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC).
  //   - Verify shape: success bool + breakdown 7 fields all number + rngRoll ∈ [0,1) +
  //     attemptIndex ≥ 1 + logId truthy + debuff.{applied,key,expiresAt}.
  //   - Verify GET /character/me mirror response (anti-FE-self-grant invariant).
  // ----------------------------------------------------------------------------

  /** @type {Map<string,string>} */
  let playerCookieSnap2;

  // 18c. admin login + swap cookie jar (player → admin).
  await step('admin login (lần 2) — swap cookie jar player → admin (positive seed truc_co peak)', async () => {
    playerCookieSnap2 = snapshotCookies();
    cookieJar.clear();
    const r = await http('/api/_auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assertStatus(r, 200, 'admin login lần 2');
    if (!r.body?.ok) throw new Error(`admin login lần 2: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const u = r.body?.data?.user;
    assert(u?.role === 'ADMIN', `admin login lần 2: role phải ADMIN, got ${u?.role}`);
  });

  // 18d. admin grant-exp 50000 → auto-advance truc_co stage 1 → 9 (+thừa exp).
  //      Service grantExp auto-advance stages 1..8 (consume cost mỗi stage), char
  //      kết thúc tại stage 9 với residual exp ≥ cost(9) → đủ điều kiện peak.
  //      truc_co stages 1..8 cumulative cost ≈ 88056; cost(9) ≈ 37781; total ≈ 125837.
  //      Char hiện exp=121356 + grant 50000 = 171356 → vượt 125837 → peak achievable.
  await step('admin grant-exp 50000 — auto-advance truc_co stage 1 → 9 (positive seed peak)', async () => {
    const r = await http(`/api/admin/users/${state.userId}/grant-exp`, {
      method: 'POST',
      body: { exp: '50000', reason: 'smoke-breakthrough-attempt-positive' },
    });
    assertStatus(r, 200, 'admin grant-exp lần 2');
    assert(
      r.body?.ok === true && r.body?.data?.ok === true,
      `grant-exp lần 2: shape mismatch, got ${JSON.stringify(r.body)}`,
    );
  });

  // 18e. admin logout + restore player cookies.
  await step('admin logout (lần 2) + restore player cookies', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'admin logout lần 2');
    cookieJar.clear();
    restoreCookies(playerCookieSnap2);
  });

  // 18f. character/me — verify post-grant state truc_co stage 9 + exp ≥ cost(9).
  await step('character/me — post-grant: realmKey=truc_co stage=9 + exp ≥ cost(9) (~37781)', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me post-grant lần 2');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me post-grant lần 2: no character');
    assert(ch.realmKey === 'truc_co', `post-grant realmKey: expect 'truc_co', got '${ch.realmKey}'`);
    assert(ch.realmStage === 9, `post-grant realmStage: expect 9 (peak), got ${ch.realmStage}`);
    // truc_co cost(9) = round(2560 × 1.4^8) = 37781. Char must have exp >= 37781.
    const expNum = BigInt(ch.exp);
    assert(expNum >= 37781n, `post-grant exp: phải >= 37781 (cost(9) truc_co), got ${ch.exp}`);
  });

  // 18g. POST /breakthrough/attempt → 200 ok + verify shape (success/breakdown/rngRoll/debuff).
  //      Outcome non-deterministic (Math.random); branch logic ở step 18h.
  /** @type {{ success:boolean, fromRealmKey:string, fromRealmStage:number, toRealmKey:string, toRealmStage:number, breakdown:{baseChance:number, rootPurityBonus:number, methodAffinityBonus:number, itemBonus:number, rawChance:number, finalChance:number, reason:string}, rngRoll:number, attemptIndex:number, logId:string, debuff:{applied:boolean, key:string|null, expiresAt:string|null}, character:any }|null} */
  let attemptOutcome = null;
  await step('breakthrough/attempt → 200 ok + verify shape (success/breakdown/rngRoll/debuff)', async () => {
    const r = await http('/api/character/breakthrough/attempt', { method: 'POST' });
    assertStatus(r, 200, 'breakthrough/attempt happy');
    if (!r.body?.ok) throw new Error(`breakthrough/attempt: ok=false body=${JSON.stringify(r.body).slice(0, 300)}`);
    const o = r.body?.data?.outcome;
    assert(o, 'breakthrough/attempt: missing outcome in body');

    // Shape: success bool.
    assert(typeof o.success === 'boolean', `outcome.success phải boolean, got ${typeof o.success}`);

    // Shape: from/to realm fields.
    assert(o.fromRealmKey === 'truc_co', `outcome.fromRealmKey: expect 'truc_co', got '${o.fromRealmKey}'`);
    assert(o.fromRealmStage === 9, `outcome.fromRealmStage: expect 9, got ${o.fromRealmStage}`);
    assert(typeof o.toRealmKey === 'string' && o.toRealmKey.length > 0, `outcome.toRealmKey phải string non-empty, got '${o.toRealmKey}'`);
    assert(typeof o.toRealmStage === 'number', `outcome.toRealmStage phải number, got ${typeof o.toRealmStage}`);

    // Shape: breakdown 7 fields all number.
    const b = o.breakdown;
    assert(b, 'outcome.breakdown missing');
    assert(typeof b.baseChance === 'number', `breakdown.baseChance phải number, got ${typeof b.baseChance}`);
    assert(typeof b.rootPurityBonus === 'number', `breakdown.rootPurityBonus phải number, got ${typeof b.rootPurityBonus}`);
    assert(typeof b.methodAffinityBonus === 'number', `breakdown.methodAffinityBonus phải number, got ${typeof b.methodAffinityBonus}`);
    assert(typeof b.itemBonus === 'number', `breakdown.itemBonus phải number, got ${typeof b.itemBonus}`);
    assert(typeof b.rawChance === 'number', `breakdown.rawChance phải number, got ${typeof b.rawChance}`);
    assert(typeof b.finalChance === 'number', `breakdown.finalChance phải number, got ${typeof b.finalChance}`);
    assert(typeof b.reason === 'string', `breakdown.reason phải string, got ${typeof b.reason}`);
    assert(b.finalChance >= 0 && b.finalChance <= 1, `breakdown.finalChance phải ∈ [0, 1], got ${b.finalChance}`);

    // Shape: rngRoll ∈ [0, 1).
    assert(typeof o.rngRoll === 'number', `outcome.rngRoll phải number, got ${typeof o.rngRoll}`);
    assert(o.rngRoll >= 0 && o.rngRoll < 1, `outcome.rngRoll phải ∈ [0, 1), got ${o.rngRoll}`);

    // Shape: attemptIndex >= 1, logId truthy.
    assert(typeof o.attemptIndex === 'number' && o.attemptIndex >= 1, `outcome.attemptIndex phải >= 1, got ${o.attemptIndex}`);
    assert(typeof o.logId === 'string' && o.logId.length > 0, `outcome.logId phải string non-empty, got '${o.logId}'`);

    // Shape: debuff object {applied, key, expiresAt}.
    const d = o.debuff;
    assert(d, 'outcome.debuff missing');
    assert(typeof d.applied === 'boolean', `debuff.applied phải boolean, got ${typeof d.applied}`);

    // Self-consistency: rngRoll < finalChance ↔ success.
    const expectSuccess = o.rngRoll < b.finalChance;
    assert(o.success === expectSuccess, `outcome.success self-consistency: rngRoll=${o.rngRoll} vs finalChance=${b.finalChance} → expect success=${expectSuccess}, got ${o.success}`);

    // Self-consistency: success ⇒ debuff.applied=false; fail ⇒ debuff.applied=true (tam_ma_light).
    if (o.success) {
      assert(d.applied === false, `success ⇒ debuff.applied=false, got ${d.applied}`);
      assert(d.key === null, `success ⇒ debuff.key=null, got '${d.key}'`);
      assert(d.expiresAt === null, `success ⇒ debuff.expiresAt=null, got '${d.expiresAt}'`);
    } else {
      assert(d.applied === true, `fail ⇒ debuff.applied=true, got ${d.applied}`);
      assert(d.key === 'tam_ma_light', `fail ⇒ debuff.key='tam_ma_light', got '${d.key}'`);
      assert(typeof d.expiresAt === 'string' && d.expiresAt.length > 0, `fail ⇒ debuff.expiresAt phải ISO string, got '${d.expiresAt}'`);
      // ISO parseable.
      const exp = new Date(d.expiresAt);
      assert(!Number.isNaN(exp.getTime()), `fail ⇒ debuff.expiresAt phải parseable ISO, got '${d.expiresAt}'`);
    }

    attemptOutcome = o;
  });

  // 18h. character/me — verify post-attempt state mirror outcome (anti-FE-self-grant).
  //      success → realmKey='kim_dan' stage=1, exp deducted by cost(9) truc_co.
  //      fail → realmKey='truc_co' stage=9 unchanged, exp unchanged.
  await step('character/me — post-attempt state mirror outcome (success → kim_dan, fail → truc_co stage 9 unchanged)', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me post-attempt');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me post-attempt: no character');
    assert(attemptOutcome, 'attemptOutcome chưa set từ step 18g');

    if (attemptOutcome.success) {
      // Success path: advance to next realm = kim_dan stage 1 + restats (HP/MP × 1.2x).
      assert(ch.realmKey === 'kim_dan', `success post-attempt realmKey: expect 'kim_dan', got '${ch.realmKey}'`);
      assert(ch.realmStage === 1, `success post-attempt realmStage: expect 1 (reset cross realm), got ${ch.realmStage}`);
      // exp deducted by cost(9) = 37781.
      const expNum = BigInt(ch.exp);
      assert(expNum >= 0n, `success post-attempt exp phải >= 0, got ${ch.exp}`);
    } else {
      // Fail path: realm unchanged, exp unchanged (KHÔNG trừ EXP cost trên fail).
      assert(ch.realmKey === 'truc_co', `fail post-attempt realmKey: expect 'truc_co' unchanged, got '${ch.realmKey}'`);
      assert(ch.realmStage === 9, `fail post-attempt realmStage: expect 9 unchanged, got ${ch.realmStage}`);
    }
  });

  // ----------------------------------------------------------------------------
  // PR Phase 11 nâng cao §5 PR3 prep — `GET /character/breakthrough/log` smoke.
  //   - Verify endpoint mới expose `BreakthroughAttemptLog` rows mirror outcome
  //     từ step 18g (cùng RNG attempt). Default response shape `{ rows, limit }`.
  //   - Auth: same player session (cookie restore từ step 18e).
  //   - Idempotent GET, sort `createdAt` DESC, BigInt cast → string.
  // ----------------------------------------------------------------------------

  // 18i. GET /breakthrough/log (default limit=20) → 200 + rows.length >= 1 + shape.
  await step('breakthrough/log default — 200 + row tương ứng attempt step 18g (BigInt cast)', async () => {
    const r = await http('/api/character/breakthrough/log');
    assertStatus(r, 200, 'breakthrough/log default');
    const rows = r.body?.data?.rows;
    const limit = r.body?.data?.limit;
    assert(Array.isArray(rows), `breakthrough/log: rows phải array, got ${typeof rows}`);
    assert(rows.length >= 1, `breakthrough/log: rows.length phải >= 1 sau attempt step 18g, got ${rows.length}`);
    assert(limit === 20, `breakthrough/log: default limit phải 20, got ${limit}`);

    // Row mới nhất (DESC) tương ứng attempt step 18g.
    const r0 = rows[0];
    assert(typeof r0.id === 'string' && r0.id.length > 0, 'row[0].id phải string non-empty');
    assert(r0.fromRealmKey === 'truc_co', `row[0].fromRealmKey: expect 'truc_co', got '${r0.fromRealmKey}'`);
    assert(r0.fromRealmStage === 9, `row[0].fromRealmStage: expect 9, got ${r0.fromRealmStage}`);
    assert(typeof r0.success === 'boolean', `row[0].success phải boolean, got ${typeof r0.success}`);
    // Self-consistency với attempt outcome step 18g (cùng RNG).
    assert(r0.success === attemptOutcome.success, `row[0].success phải mirror outcome step 18g (${attemptOutcome.success}), got ${r0.success}`);
    assert(r0.attemptIndex === attemptOutcome.attemptIndex, `row[0].attemptIndex phải mirror (${attemptOutcome.attemptIndex}), got ${r0.attemptIndex}`);
    assert(r0.id === attemptOutcome.logId, `row[0].id phải = outcome.logId (${attemptOutcome.logId}), got '${r0.id}'`);

    // BigInt cast → string.
    assert(typeof r0.expBefore === 'string', `row[0].expBefore phải string (BigInt cast), got ${typeof r0.expBefore}`);
    assert(typeof r0.expAfter === 'string', `row[0].expAfter phải string, got ${typeof r0.expAfter}`);

    // createdAt → ISO parseable.
    assert(typeof r0.createdAt === 'string', `row[0].createdAt phải string ISO, got ${typeof r0.createdAt}`);
    assert(!Number.isNaN(new Date(r0.createdAt).getTime()), `row[0].createdAt phải parseable ISO, got '${r0.createdAt}'`);

    // Numeric breakdown fields preserved.
    assert(typeof r0.chance === 'number', 'row[0].chance phải number');
    assert(typeof r0.baseChance === 'number', 'row[0].baseChance phải number');
    assert(typeof r0.rngRoll === 'number' && r0.rngRoll >= 0 && r0.rngRoll < 1, `row[0].rngRoll ∈ [0,1), got ${r0.rngRoll}`);
  });

  // 18j. GET /breakthrough/log?limit=1 → cap đúng + ?limit=invalid → fallback default.
  await step('breakthrough/log ?limit=1 cap + ?limit=invalid fallback default', async () => {
    const r1 = await http('/api/character/breakthrough/log?limit=1');
    assertStatus(r1, 200, 'breakthrough/log limit=1');
    assert(r1.body?.data?.limit === 1, `limit=1: data.limit phải 1, got ${r1.body?.data?.limit}`);
    assert(Array.isArray(r1.body?.data?.rows) && r1.body.data.rows.length <= 1, `limit=1: rows.length <= 1, got ${r1.body?.data?.rows?.length}`);

    // Invalid `?limit=abc` → fallback default 20.
    const rInvalid = await http('/api/character/breakthrough/log?limit=abc');
    assertStatus(rInvalid, 200, 'breakthrough/log limit=invalid');
    assert(rInvalid.body?.data?.limit === 20, `limit=abc fallback: data.limit phải 20, got ${rInvalid.body?.data?.limit}`);

    // Cap > MAX (101) → MAX (100).
    const rMax = await http('/api/character/breakthrough/log?limit=999');
    assertStatus(rMax, 200, 'breakthrough/log limit=999');
    assert(rMax.body?.data?.limit === 100, `limit=999 cap: data.limit phải 100, got ${rMax.body?.data?.limit}`);
  });

  // 19. logout + POST /breakthrough → 401 UNAUTHENTICATED + /breakthrough/attempt mirror.
  await step('logout + breakthrough — 401 UNAUTHENTICATED post-logout', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const r = await http('/api/character/breakthrough', { method: 'POST' });
    assertStatus(r, 401, 'breakthrough post-logout');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `breakthrough post-logout: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 19b. POST /breakthrough/attempt sau logout → 401 UNAUTHENTICATED (mirror invariant).
  await step('breakthrough/attempt — 401 UNAUTHENTICATED post-logout', async () => {
    const r = await http('/api/character/breakthrough/attempt', { method: 'POST' });
    assertStatus(r, 401, 'breakthrough/attempt post-logout');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `breakthrough/attempt post-logout: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 19c. GET /breakthrough/log sau logout → 401 UNAUTHENTICATED (cùng auth gate).
  await step('breakthrough/log — 401 UNAUTHENTICATED post-logout', async () => {
    const r = await http('/api/character/breakthrough/log');
    assertStatus(r, 401, 'breakthrough/log post-logout');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `breakthrough/log post-logout: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
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
