#!/usr/bin/env node
/**
 * smoke-tribulation.mjs — Tribulation endpoint state machine smoke cho Xuân Tôi.
 *
 * Mục tiêu: cover `POST /api/character/tribulation` (Phase 11.6.B MVP) +
 * `GET /api/character/tribulation/log` (Phase 11.6.F) qua HTTP để đóng "smoke
 * gap" được liệt kê ở `docs/AI_HANDOFF_REPORT.md` — tribulation endpoint
 * chưa có HTTP smoke (mặc dù service test 1753/1753 vitest đã cover full).
 *
 * Smoke COVER cả negative path (steps 1-17) + positive path admin-seeded
 * (steps 18-28, mirror smoke-breakthrough.mjs). Positive path:
 *   - admin login → swap cookie jar (player → admin)
 *   - admin grant-spiritual-root: huyen primary='thuy' secondaries=['tho','kim']
 *     (Phase 11.6.C resist demo seed)
 *   - admin set-realm to 'kim_dan' stage=9 (peak, exp reset = 0)
 *   - admin grant-exp 1 tỷ (đảm bảo > expCostForStage('kim_dan', 9))
 *   - restore player jar → POST /tribulation → endpoint chạy simulateTribulation
 *     với element resist multiplier từ Phase 11.6.C wire
 *   - verify response shape valid (success | fail tolerant — RNG = Math.random
 *     qua HTTP nondeterministic, smoke không assert exact outcome)
 *   - verify log row written + 2nd attempt 409 (NOT_AT_PEAK | COOLDOWN_ACTIVE)
 *
 *   1. `POST /api/character/tribulation` (no auth)        → 401 UNAUTHENTICATED.
 *   2. `GET  /api/character/tribulation/log` (no auth)    → 401 UNAUTHENTICATED.
 *   3. `POST /api/_auth/register`                         — fresh user.
 *   4. `POST /api/character/tribulation` (no char)        → 404 NO_CHARACTER.
 *   5. `GET  /api/character/tribulation/log` (no char)    → 404 NO_CHARACTER.
 *   6. `POST /api/character/onboard`                      — fresh character
 *                                                            (luyenkhi
 *                                                            stage=1, exp=0).
 *   7. `GET  /api/character/me`                           — snapshot realmKey/
 *                                                            realmStage/exp/
 *                                                            level/hpMax/mpMax/
 *                                                            tribulationCooldownAt
 *                                                            cho anti-FE-grant.
 *   8. `POST /api/character/tribulation` (fresh char)     → 409 NOT_AT_PEAK
 *                                                            (realmStage<9 →
 *                                                            fail trước khi
 *                                                            check catalog).
 *   9. `GET  /api/character/me`                           — verify state KHÔNG
 *                                                            đổi qua failed
 *                                                            attempt (anti-
 *                                                            FE-self-grant).
 *  10. `POST /api/character/tribulation` (idempotent)     → 409 NOT_AT_PEAK
 *                                                            lần 2.
 *  11. `GET  /api/character/me`                           — verify state vẫn
 *                                                            unchanged sau
 *                                                            idempotent fail.
 *  12. `POST /api/character/tribulation` body junk        → 409 NOT_AT_PEAK
 *                                                            (endpoint không
 *                                                            parse body —
 *                                                            body bị ignore).
 *  13. `GET  /api/character/tribulation/log`              → 200, rows=[],
 *                                                            limit=20
 *                                                            (TRIBULATION_LOG_DEFAULT_LIMIT).
 *                                                            (Failed attempt
 *                                                            ở step 8/10/12
 *                                                            KHÔNG ghi log
 *                                                            vì throw trước
 *                                                            khi simulation.)
 *  14. `GET /api/character/tribulation/log?limit=5`       → 200, rows=[],
 *                                                            limit=5 (echo).
 *  15. `GET /api/character/tribulation/log?limit=invalid` → 200, rows=[],
 *                                                            limit=20
 *                                                            (default fallback).
 *  16. `GET /api/character/tribulation/log?limit=0`       → 200, rows=[],
 *                                                            limit=20
 *                                                            (invalid fallback).
 *  17. `GET /api/character/tribulation/log?limit=999`     → 200, rows=[],
 *                                                            limit=100
 *                                                            (capped MAX).
 *  18. `POST /api/_auth/login` (admin)                   — swap jar player→admin.
 *  19. `POST /api/admin/users/:id/grant-spiritual-root`   — huyen thuy/tho/kim.
 *  20. `POST /api/admin/users/:id/set-realm`              — kim_dan stage=9.
 *  21. `POST /api/admin/users/:id/grant-exp`              — 1 tỷ exp.
 *  22. (restore player jar) + `GET /api/character/me`     — verify char ID match.
 *  23. `GET  /api/character/me`                           — verify post-seed state
 *                                                            (kim_dan/9, primary=
 *                                                            thuy, sec=[tho,kim],
 *                                                            grade=huyen).
 *  24. `POST /api/character/tribulation` (positive)       → 200 ok, success|fail
 *                                                            tolerant. Verify
 *                                                            response shape:
 *                                                            tribulationKey,
 *                                                            fromRealmKey=kim_dan,
 *                                                            toRealmKey, waves,
 *                                                            damage, finalHp,
 *                                                            attemptIndex>=1,
 *                                                            logId, branch
 *                                                            (success→reward,
 *                                                            fail→penalty).
 *  25. `GET  /api/character/tribulation/log`              → 200, rows.length=1
 *                                                            với log row khớp
 *                                                            outcome (id, success,
 *                                                            tribulationKey,
 *                                                            fromRealmKey).
 *  26. `POST /api/character/tribulation` (2nd)            → 409 NOT_AT_PEAK
 *                                                            (nếu success →
 *                                                            realm advance) HOẶC
 *                                                            409 COOLDOWN_ACTIVE
 *                                                            (nếu fail).
 *  27. `POST /api/_auth/logout` + tribulation             → 401 UNAUTHENTICATED.
 *  28. `GET  /api/character/tribulation/log` post-logout  → 401 UNAUTHENTICATED.
 *
 * Anti-FE-self-grant invariant (per Luật bắt buộc — KHÔNG để frontend tự
 * cộng EXP/realm/HP/MP qua failed tribulation attempt):
 *   - `realmKey` KHÔNG đổi qua failed attempt (fresh char vẫn `luyen_khi_1`).
 *   - `realmStage` KHÔNG đổi (vẫn 1).
 *   - `exp` KHÔNG đổi (vẫn 0 — failed NOT_AT_PEAK throw trước khi mutate).
 *   - `hpMax` / `mpMax` KHÔNG đổi.
 *   - `tribulationCooldownAt` KHÔNG được set (cooldown chỉ set khi
 *     simulation FAIL, không phải khi NOT_AT_PEAK throw).
 *   - `taoMaUntil` KHÔNG được set.
 *   - `level` KHÔNG đổi.
 *
 * Chạy:
 *   pnpm smoke:tribulation
 *   # hoặc trực tiếp:
 *   node scripts/smoke-tribulation.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE   — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS — default 10000ms / request.
 *   SMOKE_VERBOSE    — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY   — default "thanh_van" (cho onboard, không ảnh hưởng
 *                       tribulation).
 *
 * Yêu cầu môi trường (giống smoke:breakthrough):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api bootstrap` (seed 3 sect)
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:tribulation`
 *
 * KHÔNG yêu cầu admin login. KHÔNG mutate DB ngoài user mới do chính smoke
 * tạo (random email + character name).
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

// Mirror constants từ apps/api/src/modules/character/tribulation.service.ts
const TRIBULATION_LOG_DEFAULT_LIMIT = 20;
const TRIBULATION_LOG_MAX_LIMIT = 100;

// Phase 11.6.C resist demo seed: huyen grade với primary='thuy' + secondaries=
// ['tho','kim'] để khi attempt kim_dan→nguyen_anh tribulation (waves nhiều
// element), helper `computeSpiritualRootTribulationResist` apply runtime.
// KHÔNG assert exact multiplier (RNG không deterministic qua HTTP) — chỉ
// verify endpoint trả response shape valid + log row written.
const POSITIVE_SEED_REALM_KEY = 'kim_dan';
const POSITIVE_SEED_REALM_STAGE = 9;
// Grant 1 tỷ EXP — đảm bảo > expCostForStage('kim_dan', 9) bigint cost.
// `set-realm` reset exp = 0 trước khi grant-exp, nên tích luỹ đầy đủ residual.
// `grant-exp` auto-advance stages 1..8 nhưng đã ở peak 9 → KHÔNG advance, exp
// tích luỹ tiếp như cultivation tick natural behavior (admin.service.ts:500).
const POSITIVE_SEED_EXP_DELTA = '1000000000';

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
  process.stdout.write(`[smoke:tribulation] ${name} ... `);
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
  return `smoke-tribulation-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `tb_${rand}`;
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
 * Bao gồm cooldown / taoMaUntil — failed NOT_AT_PEAK KHÔNG được set những
 * field này (chỉ set khi simulation FAIL, không phải gate fail).
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
    tribulationCooldownAt: ch.tribulationCooldownAt == null ? null : String(ch.tribulationCooldownAt),
    taoMaUntil: ch.taoMaUntil == null ? null : String(ch.taoMaUntil),
  };
}

/**
 * @param {ReturnType<typeof snapshotProgression>} before
 * @param {ReturnType<typeof snapshotProgression>} after
 * @param {string} label
 */
function assertProgressionImmutable(before, after, label) {
  for (const key of /** @type {const} */ ([
    'realmKey',
    'realmStage',
    'exp',
    'level',
    'hpMax',
    'mpMax',
    'tribulationCooldownAt',
    'taoMaUntil',
  ])) {
    if (before[key] !== after[key]) {
      throw new Error(
        `${label}: field ${key} thay đổi qua failed tribulation attempt (anti-FE-self-grant): before=${before[key]} after=${after[key]}`,
      );
    }
  }
}

async function main() {
  console.log(`[smoke:tribulation] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}`);

  // 1. POST /tribulation chưa auth → 401.
  await step('tribulation — 401 UNAUTHENTICATED khi chưa register', async () => {
    const r = await http('/api/character/tribulation', { method: 'POST' });
    assertStatus(r, 401, 'tribulation unauth');
    assert(
      r.body?.error?.code === 'UNAUTHENTICATED',
      `tribulation unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`,
    );
  });

  // 2. GET /tribulation/log chưa auth → 401.
  await step('tribulation/log — 401 UNAUTHENTICATED khi chưa register', async () => {
    const r = await http('/api/character/tribulation/log');
    assertStatus(r, 401, 'tribulation/log unauth');
    assert(
      r.body?.error?.code === 'UNAUTHENTICATED',
      `tribulation/log unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`,
    );
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

  // 4. POST /tribulation khi chưa onboard → 404 NO_CHARACTER.
  await step('tribulation — 404 NO_CHARACTER khi chưa onboard', async () => {
    const r = await http('/api/character/tribulation', { method: 'POST' });
    assertStatus(r, 404, 'tribulation no-char');
    assert(
      r.body?.error?.code === 'NO_CHARACTER',
      `tribulation no-char: expect code NO_CHARACTER, got ${r.body?.error?.code}`,
    );
  });

  // 5. GET /tribulation/log khi chưa onboard → 404 NO_CHARACTER.
  await step('tribulation/log — 404 NO_CHARACTER khi chưa onboard', async () => {
    const r = await http('/api/character/tribulation/log');
    assertStatus(r, 404, 'tribulation/log no-char');
    assert(
      r.body?.error?.code === 'NO_CHARACTER',
      `tribulation/log no-char: expect code NO_CHARACTER, got ${r.body?.error?.code}`,
    );
  });

  // 6. Onboard character.
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

  // 7. Snapshot starting progression state (immutable cho anti-FE-grant).
  /** @type {ReturnType<typeof snapshotProgression>} */
  let initialSnapshot;
  await step('character/me — snapshot starting progression state', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me: no character in body');
    assert(typeof ch.realmStage === 'number', 'character/me: realmStage missing');
    assert(
      ch.realmStage < 9,
      `character/me: fresh char realmStage phải < 9, got ${ch.realmStage}`,
    );
    assert(
      typeof ch.realmKey === 'string' && ch.realmKey.length > 0,
      'character/me: realmKey missing',
    );
    initialSnapshot = snapshotProgression(ch);
    assert(
      initialSnapshot.tribulationCooldownAt === null,
      `character/me: fresh char tribulationCooldownAt phải null, got ${initialSnapshot.tribulationCooldownAt}`,
    );
    assert(
      initialSnapshot.taoMaUntil === null,
      `character/me: fresh char taoMaUntil phải null, got ${initialSnapshot.taoMaUntil}`,
    );
  });

  // 8. POST /tribulation fresh char (realmStage<9) → 409 NOT_AT_PEAK.
  await step('tribulation — 409 NOT_AT_PEAK cho fresh char (realmStage<9)', async () => {
    const r = await http('/api/character/tribulation', { method: 'POST' });
    assertStatus(r, 409, 'tribulation not-at-peak');
    assert(
      r.body?.error?.code === 'NOT_AT_PEAK',
      `tribulation not-at-peak: expect code NOT_AT_PEAK, got ${r.body?.error?.code}`,
    );
  });

  // 9. character/me — verify state unchanged sau failed tribulation (anti-FE-grant).
  await step('character/me — anti-FE-self-grant: state unchanged sau failed tribulation', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me post-fail');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me post-fail: no character in body');
    const after = snapshotProgression(ch);
    assertProgressionImmutable(initialSnapshot, after, 'character/me post-fail');
  });

  // 10. POST /tribulation idempotent fail → 409 NOT_AT_PEAK lần 2.
  await step('tribulation — 409 NOT_AT_PEAK lần 2 (idempotent fail)', async () => {
    const r = await http('/api/character/tribulation', { method: 'POST' });
    assertStatus(r, 409, 'tribulation idempotent-fail');
    assert(
      r.body?.error?.code === 'NOT_AT_PEAK',
      `tribulation idempotent-fail: expect code NOT_AT_PEAK, got ${r.body?.error?.code}`,
    );
  });

  // 11. character/me — verify state vẫn unchanged sau idempotent fail.
  await step('character/me — state vẫn unchanged sau idempotent fail', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me post-idem');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me post-idem: no character in body');
    const after = snapshotProgression(ch);
    assertProgressionImmutable(initialSnapshot, after, 'character/me post-idem');
  });

  // 12. POST /tribulation với body junk → vẫn 409 NOT_AT_PEAK (endpoint không parse body).
  await step('tribulation — body junk vẫn 409 NOT_AT_PEAK (endpoint không parse body)', async () => {
    const r = await http('/api/character/tribulation', {
      method: 'POST',
      body: { foo: 'bar', realmStage: 9, exp: '99999999999', primaryElement: 'kim' },
    });
    assertStatus(r, 409, 'tribulation junk-body');
    assert(
      r.body?.error?.code === 'NOT_AT_PEAK',
      `tribulation junk-body: expect code NOT_AT_PEAK (body bị ignore), got ${r.body?.error?.code}`,
    );
  });

  // 13. GET /tribulation/log — empty array, default limit.
  await step(
    'tribulation/log — 200 rows=[] limit=20 (chưa attempt nào write log; failed gate KHÔNG write)',
    async () => {
      const r = await http('/api/character/tribulation/log');
      assertStatus(r, 200, 'tribulation/log empty');
      assert(r.body?.ok === true, `tribulation/log empty: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
      const data = r.body?.data;
      assert(Array.isArray(data?.rows), `tribulation/log empty: rows phải là array, got ${typeof data?.rows}`);
      assert(
        data.rows.length === 0,
        `tribulation/log empty: rows phải = [] (failed gate KHÔNG write log), got length=${data.rows.length}`,
      );
      assert(
        data.limit === TRIBULATION_LOG_DEFAULT_LIMIT,
        `tribulation/log empty: limit phải = ${TRIBULATION_LOG_DEFAULT_LIMIT} default, got ${data.limit}`,
      );
    },
  );

  // 14. GET /tribulation/log?limit=5 — valid limit echoed.
  await step('tribulation/log?limit=5 — 200 rows=[] limit=5 (echo valid limit)', async () => {
    const r = await http('/api/character/tribulation/log?limit=5');
    assertStatus(r, 200, 'tribulation/log limit=5');
    assert(r.body?.ok === true, `tribulation/log limit=5: ok=false`);
    assert(
      r.body?.data?.limit === 5,
      `tribulation/log limit=5: limit phải = 5, got ${r.body?.data?.limit}`,
    );
    assert(
      Array.isArray(r.body?.data?.rows) && r.body.data.rows.length === 0,
      `tribulation/log limit=5: rows phải = []`,
    );
  });

  // 15. GET /tribulation/log?limit=invalid — fallback default.
  await step(
    `tribulation/log?limit=invalid — 200 limit=${TRIBULATION_LOG_DEFAULT_LIMIT} (fallback default)`,
    async () => {
      const r = await http('/api/character/tribulation/log?limit=not-a-number');
      assertStatus(r, 200, 'tribulation/log limit=invalid');
      assert(r.body?.ok === true, `tribulation/log limit=invalid: ok=false`);
      assert(
        r.body?.data?.limit === TRIBULATION_LOG_DEFAULT_LIMIT,
        `tribulation/log limit=invalid: limit phải = ${TRIBULATION_LOG_DEFAULT_LIMIT} default, got ${r.body?.data?.limit}`,
      );
    },
  );

  // 16. GET /tribulation/log?limit=0 — fallback default.
  await step(
    `tribulation/log?limit=0 — 200 limit=${TRIBULATION_LOG_DEFAULT_LIMIT} (invalid fallback)`,
    async () => {
      const r = await http('/api/character/tribulation/log?limit=0');
      assertStatus(r, 200, 'tribulation/log limit=0');
      assert(
        r.body?.data?.limit === TRIBULATION_LOG_DEFAULT_LIMIT,
        `tribulation/log limit=0: limit phải = ${TRIBULATION_LOG_DEFAULT_LIMIT} default, got ${r.body?.data?.limit}`,
      );
    },
  );

  // 17. GET /tribulation/log?limit=999 — capped MAX.
  await step(
    `tribulation/log?limit=999 — 200 limit=${TRIBULATION_LOG_MAX_LIMIT} (capped MAX)`,
    async () => {
      const r = await http('/api/character/tribulation/log?limit=999');
      assertStatus(r, 200, 'tribulation/log limit=999');
      assert(
        r.body?.data?.limit === TRIBULATION_LOG_MAX_LIMIT,
        `tribulation/log limit=999: limit phải = ${TRIBULATION_LOG_MAX_LIMIT} cap, got ${r.body?.data?.limit}`,
      );
    },
  );

  // ---------------------------------------------------------------------------
  // POSITIVE PATH — admin seed cho player advance lên kim_dan stage=9 + spiritual
  // root + đủ exp để satisfy `expCostForStage('kim_dan', 9)` invariant. Sau đó
  // player POST /tribulation → endpoint chạy `simulateTribulation` với element
  // resist multiplier từ Phase 11.6.C (`computeSpiritualRootTribulationResist`).
  //
  // Outcome non-deterministic (RNG = Math.random qua HTTP, không inject được).
  // Smoke verify response shape valid + log row được write, không assert exact
  // success/fail (cả 2 path đều có valid shape — fail vẫn 200 với `success:
  // false` + `penalty` non-null thay vì `reward`).
  //
  // Anti-FE-self-grant invariant: tất cả mutation đều qua admin endpoint hoặc
  // tribulation endpoint authoritative. Admin chỉ kích hoạt logic giống
  // cultivation tick natural progression — không bypass server authority.
  // ---------------------------------------------------------------------------

  /** @type {Map<string,string>} */
  let playerCookieSnap;

  // 18. Snapshot player cookies + admin login → swap jar.
  await step('admin login — swap cookie jar (player → admin)', async () => {
    playerCookieSnap = snapshotCookies();
    cookieJar.clear();
    const r = await http('/api/_auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assertStatus(r, 200, 'admin login');
    if (!r.body?.ok) {
      throw new Error(`admin login: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    }
    const u = r.body?.data?.user;
    assert(
      u?.role === 'ADMIN',
      `admin login: role phải ADMIN (cần bootstrap admin@example.com), got ${u?.role}`,
    );
  });

  // 19. Admin grant-spiritual-root: huyen primary='thuy' secondaries=['tho','kim'].
  // Phase 11.6.C demo seed — primary thuy có quan hệ với hoa (khắc), kim
  // (sinh primary), moc (sinh wave), tho (bị primary khắc); secondaries
  // tho+kim cover counter+resonance bonus paths trong helper.
  await step(
    'admin grant-spiritual-root — huyen primary=thuy secondaries=[tho,kim] (Phase 11.6.C demo)',
    async () => {
      if (!state.userId) throw new Error('state.userId missing — register chưa chạy');
      const r = await http(`/api/admin/users/${state.userId}/grant-spiritual-root`, {
        method: 'POST',
        body: {
          grade: 'huyen',
          primaryElement: 'thuy',
          secondaryElements: ['tho', 'kim'],
          purity: 80,
          reason: 'smoke tribulation positive seed',
        },
      });
      assertStatus(r, 200, 'admin/grant-spiritual-root');
      assert(
        r.body?.ok === true && r.body?.data?.ok === true,
        `grant-spiritual-root: shape mismatch, got ${JSON.stringify(r.body).slice(0, 200)}`,
      );
    },
  );

  // 20. Admin set-realm to kim_dan stage=9. Reset exp = 0.
  await step(
    `admin set-realm — ${POSITIVE_SEED_REALM_KEY} stage=${POSITIVE_SEED_REALM_STAGE} (peak, exp reset = 0)`,
    async () => {
      const r = await http(`/api/admin/users/${state.userId}/set-realm`, {
        method: 'POST',
        body: {
          realmKey: POSITIVE_SEED_REALM_KEY,
          realmStage: POSITIVE_SEED_REALM_STAGE,
          reason: 'smoke tribulation positive seed',
        },
      });
      assertStatus(r, 200, 'admin/set-realm');
      assert(
        r.body?.ok === true && r.body?.data?.ok === true,
        `set-realm: shape mismatch, got ${JSON.stringify(r.body).slice(0, 200)}`,
      );
    },
  );

  // 21. Admin grant-exp 1 tỷ → đảm bảo > expCostForStage('kim_dan', 9).
  await step(
    `admin grant-exp ${POSITIVE_SEED_EXP_DELTA} (đủ kim_dan stage=9 cost)`,
    async () => {
      const r = await http(`/api/admin/users/${state.userId}/grant-exp`, {
        method: 'POST',
        body: {
          exp: POSITIVE_SEED_EXP_DELTA,
          reason: 'smoke tribulation positive seed',
        },
      });
      assertStatus(r, 200, 'admin/grant-exp');
      assert(
        r.body?.ok === true && r.body?.data?.ok === true,
        `grant-exp: shape mismatch, got ${JSON.stringify(r.body).slice(0, 200)}`,
      );
    },
  );

  // 22. Restore player cookies — swap jar admin → player.
  await step('restore player cookie jar (admin → player)', async () => {
    if (!playerCookieSnap) throw new Error('playerCookieSnap chưa snapshot');
    restoreCookies(playerCookieSnap);
    // Sanity check: GET /me phải trả về player char không phải admin (admin
    // không có character row).
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me post-restore');
    const ch = r.body?.data?.character;
    assert(ch?.id === state.characterId, `restore: characterId mismatch, got ${ch?.id}`);
  });

  // 23. GET /me — verify realm advance.
  await step(
    `character/me — verify post-seed realm (${POSITIVE_SEED_REALM_KEY} stage=${POSITIVE_SEED_REALM_STAGE}, exp >= cost)`,
    async () => {
      const r = await http('/api/character/me');
      assertStatus(r, 200, 'character/me post-seed');
      const ch = r.body?.data?.character;
      assert(ch, 'character/me post-seed: no character');
      assert(
        ch.realmKey === POSITIVE_SEED_REALM_KEY,
        `realmKey: expect ${POSITIVE_SEED_REALM_KEY}, got ${ch.realmKey}`,
      );
      assert(
        ch.realmStage === POSITIVE_SEED_REALM_STAGE,
        `realmStage: expect ${POSITIVE_SEED_REALM_STAGE}, got ${ch.realmStage}`,
      );
      // exp string vì BigInt — chỉ verify > 0 (admin grant đã chạy).
      const expN = BigInt(String(ch.exp ?? '0'));
      assert(expN > 0n, `exp post-grant: expect > 0, got ${ch.exp}`);
    },
  );

  // 23b. GET /spiritual-root — verify root state via dedicated endpoint
  // (Phase 11.3.A — `/character/me` view không expose primaryElement/secondary/
  // grade fields, separate endpoint phụ trách spiritual root state).
  await step(
    'spiritual-root — verify post-seed state (huyen primary=thuy secondaries=[tho,kim])',
    async () => {
      const r = await http('/api/character/spiritual-root');
      assertStatus(r, 200, 'spiritual-root post-seed');
      const root = r.body?.data?.spiritualRoot;
      assert(root, 'spiritual-root post-seed: no state');
      assert(root.grade === 'huyen', `grade: expect 'huyen', got ${root.grade}`);
      assert(
        root.primaryElement === 'thuy',
        `primaryElement: expect 'thuy', got ${root.primaryElement}`,
      );
      assert(
        Array.isArray(root.secondaryElements) &&
          root.secondaryElements.length === 2 &&
          root.secondaryElements.includes('tho') &&
          root.secondaryElements.includes('kim'),
        `secondaryElements: expect ['tho','kim'], got ${JSON.stringify(root.secondaryElements)}`,
      );
    },
  );

  // 24. POST /tribulation — positive path. Outcome (success/fail) non-deterministic
  // qua HTTP RNG, smoke verify response shape valid cả 2 branch.
  /** @type {{ success: boolean; logId: string; toRealmKey: string; tribulationKey: string }} */
  let outcome;
  await step(
    'tribulation — POST /tribulation positive path (success | fail tolerant, response shape valid)',
    async () => {
      const r = await http('/api/character/tribulation', { method: 'POST' });
      assertStatus(r, 200, 'tribulation positive');
      assert(r.body?.ok === true, `tribulation positive: ok=false`);
      const data = r.body?.data?.tribulation;
      assert(data, `tribulation positive: missing data.tribulation`);
      assert(typeof data.success === 'boolean', `tribulation positive: success phải boolean`);
      assert(
        typeof data.tribulationKey === 'string' && data.tribulationKey.length > 0,
        `tribulation positive: tribulationKey missing`,
      );
      assert(
        data.fromRealmKey === POSITIVE_SEED_REALM_KEY,
        `tribulation positive: fromRealmKey expect ${POSITIVE_SEED_REALM_KEY}, got ${data.fromRealmKey}`,
      );
      assert(
        typeof data.toRealmKey === 'string' && data.toRealmKey.length > 0,
        `tribulation positive: toRealmKey missing`,
      );
      assert(
        typeof data.wavesCompleted === 'number' && data.wavesCompleted >= 0,
        `tribulation positive: wavesCompleted phải number >= 0, got ${data.wavesCompleted}`,
      );
      assert(
        typeof data.totalDamage === 'number' && data.totalDamage >= 0,
        `tribulation positive: totalDamage phải number >= 0, got ${data.totalDamage}`,
      );
      assert(
        typeof data.finalHp === 'number' && data.finalHp >= 0,
        `tribulation positive: finalHp phải number >= 0, got ${data.finalHp}`,
      );
      assert(
        typeof data.attemptIndex === 'number' && data.attemptIndex >= 1,
        `tribulation positive: attemptIndex phải >= 1, got ${data.attemptIndex}`,
      );
      assert(
        typeof data.logId === 'string' && data.logId.length > 0,
        `tribulation positive: logId phải string non-empty (proof log row written)`,
      );
      // Branch shape: success → reward non-null + penalty=null; fail → ngược lại.
      if (data.success) {
        assert(data.reward !== null, `tribulation success: reward phải non-null`);
        assert(data.penalty === null, `tribulation success: penalty phải null`);
      } else {
        assert(data.penalty !== null, `tribulation fail: penalty phải non-null`);
        assert(data.reward === null, `tribulation fail: reward phải null`);
      }
      outcome = {
        success: data.success,
        logId: data.logId,
        toRealmKey: data.toRealmKey,
        tribulationKey: data.tribulationKey,
      };
      console.log(
        `\n  ↳ outcome: ${data.success ? 'SUCCESS' : 'FAIL'} ` +
          `tribulation=${data.tribulationKey} waves=${data.wavesCompleted} ` +
          `damage=${data.totalDamage} finalHp=${data.finalHp}`,
      );
    },
  );

  // 25. GET /tribulation/log — verify 1 row written với log shape valid.
  await step('tribulation/log — 200 rows.length=1 sau attempt (log row written)', async () => {
    const r = await http('/api/character/tribulation/log');
    assertStatus(r, 200, 'tribulation/log post-attempt');
    const rows = r.body?.data?.rows;
    assert(Array.isArray(rows), `tribulation/log post-attempt: rows array required`);
    assert(rows.length === 1, `tribulation/log post-attempt: rows.length expect 1, got ${rows.length}`);
    const row = rows[0];
    assert(row.id === outcome.logId, `log row id mismatch: expect ${outcome.logId}, got ${row.id}`);
    assert(
      row.success === outcome.success,
      `log row success mismatch: expect ${outcome.success}, got ${row.success}`,
    );
    assert(
      row.tribulationKey === outcome.tribulationKey,
      `log row tribulationKey mismatch: expect ${outcome.tribulationKey}, got ${row.tribulationKey}`,
    );
    assert(
      row.fromRealmKey === POSITIVE_SEED_REALM_KEY,
      `log row fromRealmKey mismatch: expect ${POSITIVE_SEED_REALM_KEY}, got ${row.fromRealmKey}`,
    );
    assert(typeof row.createdAt === 'string', `log row createdAt phải ISO string`);
  });

  // 26. POST /tribulation lần 2 — verify gate prevent abuse:
  //   - Nếu vừa SUCCESS → realm advance, char giờ realmStage=1 → 409 NOT_AT_PEAK.
  //   - Nếu vừa FAIL → cooldownAt set → 409 COOLDOWN_ACTIVE.
  // Cả 2 đều 409, code khác nhau theo branch outcome.
  await step('tribulation — 409 sau attempt (NOT_AT_PEAK if success | COOLDOWN_ACTIVE if fail)', async () => {
    const r = await http('/api/character/tribulation', { method: 'POST' });
    assertStatus(r, 409, 'tribulation post-attempt 2nd');
    const code = r.body?.error?.code;
    if (outcome.success) {
      assert(
        code === 'NOT_AT_PEAK',
        `tribulation post-success-2nd: expect NOT_AT_PEAK (realm advanced → stage=1), got ${code}`,
      );
    } else {
      assert(
        code === 'COOLDOWN_ACTIVE',
        `tribulation post-fail-2nd: expect COOLDOWN_ACTIVE, got ${code}`,
      );
    }
  });

  // 27. POST /_auth/logout + tribulation → 401.
  await step('logout + tribulation — 401 UNAUTHENTICATED post-logout', async () => {
    const logoutRes = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logoutRes, [200, 204], 'logout');
    const r = await http('/api/character/tribulation', { method: 'POST' });
    assertStatus(r, 401, 'tribulation post-logout');
    assert(
      r.body?.error?.code === 'UNAUTHENTICATED',
      `tribulation post-logout: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`,
    );
  });

  // 28. GET /tribulation/log post-logout → 401.
  await step('tribulation/log — 401 UNAUTHENTICATED post-logout', async () => {
    const r = await http('/api/character/tribulation/log');
    assertStatus(r, 401, 'tribulation/log post-logout');
    assert(
      r.body?.error?.code === 'UNAUTHENTICATED',
      `tribulation/log post-logout: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`,
    );
  });
}

main()
  .catch((err) => {
    console.error('[smoke:tribulation] fatal:', err);
    results.push({ name: 'fatal', ok: false, note: String(err) });
  })
  .finally(() => {
    const passed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    console.log('');
    console.log(`[smoke:tribulation] ${passed}/${results.length} steps passed.`);
    if (failed.length > 0) {
      console.log('[smoke:tribulation] Failed steps:');
      for (const f of failed) {
        console.log(`  - ${f.name}${f.note ? ` — ${f.note}` : ''}`);
      }
      process.exit(1);
    }
    process.exit(0);
  });
