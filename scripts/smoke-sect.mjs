#!/usr/bin/env node
/**
 * smoke-sect.mjs — Sect (môn phái) endpoints smoke cho Xuân Tôi.
 *
 * Negative-path-focused (nhưng có 1 positive /leave để thoát sect rồi
 * negative path tiếp). Positive create/join/contribute path defer cho
 * future smoke với admin seed (sect.create + sect.add) hoặc gameplay
 * automation (linh thạch farm via dungeon drop).
 *
 * Mục tiêu: cover 7 sect endpoints qua HTTP — `apps/api/src/modules/sect`:
 *   - `GET  /api/sect/list`        — list all sects (PUBLIC, no auth).
 *   - `GET  /api/sect/me`          — viewer's own sect (auth + char).
 *   - `GET  /api/sect/:id`         — sect detail by id (PUBLIC, no auth,
 *                                    char optional).
 *   - `POST /api/sect/create`      — tạo sect mới (auth + char + zod
 *                                    name min(2).max(16) + service regex
 *                                    `[\p{L}\p{N} _-]{2,16}`).
 *   - `POST /api/sect/:id/join`    — join sect by id (auth + char +
 *                                    `findUnique` → SECT_NOT_FOUND).
 *   - `POST /api/sect/leave`       — rời sect hiện tại (auth + char +
 *                                    `char.sectId` check → NOT_IN_SECT).
 *   - `POST /api/sect/contribute`  — đóng góp linh thạch lấy cống hiến
 *                                    (auth + zod amount positive int +
 *                                    service amount cap 1M).
 *
 * Critical observation: `/api/character/onboard` gọi `prisma.sect.upsert`
 * cho `SECT_NAMES[input.sectKey]` rồi `character.create` với `sectId:
 * sect.id` — fresh char SAU onboard tự động ở trong sect (e.g.
 * `thanh_van` → "Thanh Vân Môn"). Smoke phải tính đến điều này:
 *   - Pre-onboard: `char === null` → service check NO_CHARACTER 404.
 *   - Post-onboard fresh (in sect): `char.sectId !== null` →
 *     /join bogus → ALREADY_IN_SECT 409 (service order char trước sect
 *     findUnique trước ALREADY_IN_SECT — actual order chars CHECK trước
 *     ALREADY_IN_SECT trước sect findUnique). /contribute → service
 *     order amount cap → char → sectId pass → linhThach check →
 *     INSUFFICIENT_LINH_THACH 409 (fresh char 0 LT).
 *   - Post-leave (no sect): char.sectId === null → /join bogus →
 *     SECT_NOT_FOUND 404, /contribute → NOT_IN_SECT 409, /leave → 409.
 *
 * 14-step:
 *   1.  `GET  /api/sect/list`             (no auth)        → 200
 *                                                            sects[]
 *                                                            (PUBLIC).
 *   2.  `GET  /api/sect/me + POST /api/sect/create` (no auth) → 401
 *                                                            UNAUTHENTICATED
 *                                                            × 2 (combined).
 *   3.  `POST /api/_auth/register`                          — fresh user.
 *   4.  `GET  /api/sect/me`               (pre-onboard)    → 404
 *                                                            NO_CHARACTER.
 *   5.  `POST /api/sect/{bogus}/join`     (pre-onboard)    → 404
 *                                                            NO_CHARACTER
 *                                                            (service char
 *                                                            check trước
 *                                                            ALREADY_IN_SECT
 *                                                            trước sect
 *                                                            findUnique).
 *   6.  `POST /api/character/onboard`                       — fresh char,
 *                                                            auto-joins
 *                                                            `thanh_van`.
 *   7.  `GET  /api/sect/me`               (post-onboard
 *                                          in sect)        → 200 sect
 *                                                            shape (id,
 *                                                            name, totals,
 *                                                            members[]).
 *   8.  `POST /api/sect/create`           ({})             → 400
 *                                                            INVALID_INPUT
 *                                                            (zod missing
 *                                                            name).
 *   9.  `POST /api/sect/create`           ({name:'a'})     → 400
 *                                                            INVALID_INPUT
 *                                                            (zod min(2)
 *                                                            violation).
 *  10.  `POST /api/sect/create`           ({name:'a!b'})   → 400
 *                                                            INVALID_NAME
 *                                                            (service regex
 *                                                            `[\p{L}\p{N} _-]`,
 *                                                            zod len pass
 *                                                            (3 chars) →
 *                                                            service regex
 *                                                            fail).
 *  11.  `POST /api/sect/{bogus}/join`     (post-onboard
 *                                          in sect)        → 409
 *                                                            ALREADY_IN_SECT
 *                                                            (service order
 *                                                            char trước
 *                                                            ALREADY_IN_SECT
 *                                                            trước sect
 *                                                            findUnique).
 *  12.  `POST /api/sect/contribute`       ({amount:100},
 *                                          post-onboard in
 *                                          sect, 0 LT)     → 409
 *                                                            INSUFFICIENT_LINH_THACH
 *                                                            (service order
 *                                                            amount cap → char
 *                                                            → sectId pass
 *                                                            → linhThach<100).
 *  13.  `POST /api/sect/leave` (1st)                        → 200 ok=true,
 *                                                            char.sectId
 *                                                            null;
 *        `POST /api/sect/leave` (2nd)                       → 409
 *                                                            NOT_IN_SECT
 *                                                            (idempotent
 *                                                            guard).
 *  14.  `POST /api/sect/{bogus}/join` (post-leave) → 404 SECT_NOT_FOUND
 *        + `POST /api/sect/contribute` ({amount:100}, post-leave) → 409
 *        NOT_IN_SECT + anti-FE-self-grant + logout + GET /sect/me 401`.
 *
 * Chạy:
 *   pnpm smoke:sect
 *   # hoặc trực tiếp:
 *   node scripts/smoke-sect.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE   — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS — default 10000ms / request.
 *   SMOKE_VERBOSE    — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY   — default "thanh_van".
 *
 * Yêu cầu môi trường:
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:sect`
 *
 * Mutation footprint:
 *   - 1 fresh user + 1 fresh character + auto-joined sect + /leave xuất
 *     khỏi sect (no sect data mutated, char.sectId set null). Throwaway
 *     smoke user, không ảnh hưởng prod data.
 *
 * Defer:
 *   - Positive create path (POST /sect/create với valid name → service
 *     create Sect row + set char.sectId = newSect.id) — yêu cầu test
 *     cleanup vì mutate Sect row; defer.
 *   - Positive join path (admin seed sect S → user fresh-out-of-sect →
 *     POST /S/join → service findUnique pass + atomic update char.sectId
 *     = S.id → ALREADY_IN_SECT 409 trên call thứ 2) — yêu cầu admin
 *     `sect.create` seed; defer.
 *   - Positive contribute path (user trong sect + đủ linh thạch → POST
 *     /contribute → atomic ledger applyTx LINH_THACH(spend) +
 *     character.congHien += amount + sect.totalCongHien += amount) —
 *     yêu cầu farm linh thạch qua dungeon drop hoặc admin grant; defer.
 *   - INVALID_AMOUNT 400 từ service (amount > 1M cap, hoặc amount<=0
 *     bypass zod) defer cho simplicity — đã cover INVALID_INPUT 400 từ
 *     zod (positive int).
 *   - NAME_TAKEN 409 (P2002 unique) defer.
 *   - GET /sect/:id detail (PUBLIC, char optional) defer cho simplicity
 *     — đã cover qua /me post-onboard.
 *   - Leader-leave race (sect.leaderId === char.id → set null) defer.
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
 * @param {() => Promise<void>} fn
 */
async function step(name, fn) {
  process.stdout.write(`[smoke:sect] ${name} ... `);
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
  return `smoke-sect-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `sct_${rand}`;
}

function randomBogusId() {
  const rand = Math.random().toString(36).slice(2, 12);
  return `bogus_${rand}`;
}

/** @returns {Promise<{linhThach: string; tienNgoc: number}>} */
async function fetchCharCurrencies() {
  const r = await http('/api/character/state');
  assertStatus(r, 200, 'GET /character/state snapshot');
  const c = r.body?.data?.character;
  assert(c, 'GET /character/state: missing character');
  return {
    linhThach: String(c.linhThach),
    tienNgoc: Number(c.tienNgoc),
  };
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

async function main() {
  console.log(
    `[smoke:sect] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}`,
  );

  // 1. GET /sect/list (no auth) → 200 sects[] PUBLIC.
  await step('GET /sect/list — 200 PUBLIC (no auth)', async () => {
    const r = await http('/api/sect/list');
    assertStatus(r, 200, 'GET /sect/list public');
    if (!r.body?.ok)
      throw new Error(`GET /sect/list: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const data = r.body?.data;
    assert(Array.isArray(data?.sects), 'GET /sect/list: data.sects not array');
  });

  // 2. GET /sect/me + POST /sect/create (no auth) → 401 × 2.
  await step('GET /sect/me + POST /sect/create — 401 UNAUTHENTICATED × 2 (no auth)', async () => {
    const me = await http('/api/sect/me');
    assertStatus(me, 401, 'GET /sect/me unauth');
    assertErrorCode(me, 'UNAUTHENTICATED', 'GET /sect/me unauth');

    const create = await http('/api/sect/create', {
      method: 'POST',
      body: { name: 'Foo' },
    });
    assertStatus(create, 401, 'POST /sect/create unauth');
    assertErrorCode(create, 'UNAUTHENTICATED', 'POST /sect/create unauth');
  });

  // 3. Register fresh user.
  const email = randomEmail();
  const password = randomPassword();
  await step('register', async () => {
    const r = await http('/api/_auth/register', {
      method: 'POST',
      body: { email, password },
    });
    assertStatus(r, [200, 201], 'register');
    if (!r.body?.ok)
      throw new Error(`register: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.user?.id, 'register: missing user.id');
  });

  // 4. GET /sect/me pre-onboard → 404 NO_CHARACTER.
  await step('GET /sect/me — pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/sect/me');
    assertStatus(r, 404, 'GET /sect/me pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'GET /sect/me pre-onboard');
  });

  // 5. POST /sect/<bogus>/join pre-onboard → 404 NO_CHARACTER (service
  //    char check trước ALREADY_IN_SECT trước sect findUnique).
  await step('POST /sect/<bogus>/join — pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http(`/api/sect/${randomBogusId()}/join`, { method: 'POST' });
    assertStatus(r, 404, 'POST /sect/<bogus>/join pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'POST /sect/<bogus>/join pre-onboard');
  });

  // 6. Onboard character — auto-joins thanh_van sect.
  /** @type {string} */
  let myCharName;
  await step('onboard — create character (auto-join thanh_van)', async () => {
    myCharName = randomCharName();
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: myCharName, sectKey: SECT_KEY },
    });
    assertStatus(r, 200, 'onboard');
    if (!r.body?.ok)
      throw new Error(`onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.character?.id, 'onboard: missing character.id');
  });

  // 7. GET /sect/me post-onboard → 200 sect shape verify.
  /** @type {string} */
  let mySectId = '';
  await step('GET /sect/me — post-onboard 200 sect shape (auto-joined thanh_van)', async () => {
    const r = await http('/api/sect/me');
    assertStatus(r, 200, 'GET /sect/me post-onboard');
    if (!r.body?.ok)
      throw new Error(`GET /sect/me: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const sect = r.body?.data?.sect;
    assert(sect, 'GET /sect/me: post-onboard expect sect != null (auto-joined thanh_van)');
    assert(typeof sect.id === 'string' && sect.id.length > 0, 'sect.id not string');
    assert(typeof sect.name === 'string' && sect.name.length > 0, 'sect.name not string');
    assert(Array.isArray(sect.members), 'sect.members not array');
    mySectId = sect.id;
  });

  // 8. POST /sect/create ({}) → 400 INVALID_INPUT (zod missing name).
  await step('POST /sect/create — ({}) 400 INVALID_INPUT', async () => {
    const r = await http('/api/sect/create', { method: 'POST', body: {} });
    assertStatus(r, 400, 'POST /sect/create ({})');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /sect/create ({})');
  });

  // 9. POST /sect/create ({name:'a'}) → 400 INVALID_INPUT (zod min(2)).
  await step("POST /sect/create — ({name:'a'}) 400 INVALID_INPUT (zod min(2))", async () => {
    const r = await http('/api/sect/create', {
      method: 'POST',
      body: { name: 'a' },
    });
    assertStatus(r, 400, 'POST /sect/create min(2)');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /sect/create min(2)');
  });

  // Snapshot currency BEFORE failed attempts steps 10-14.
  const before = await fetchCharCurrencies();

  // 10. POST /sect/create ({name:'a!b'}) → 400 INVALID_NAME (service
  //     regex `[\p{L}\p{N} _-]` — zod len 3 pass min(2).max(16) → reach
  //     service → regex test reject `!`).
  await step("POST /sect/create — ({name:'a!b'}) post-onboard 400 INVALID_NAME (service regex)", async () => {
    const r = await http('/api/sect/create', {
      method: 'POST',
      body: { name: 'a!b' },
    });
    assertStatus(r, 400, 'POST /sect/create INVALID_NAME');
    assertErrorCode(r, 'INVALID_NAME', 'POST /sect/create INVALID_NAME');
  });

  // 11. POST /sect/<bogus>/join post-onboard (in sect) → 409 ALREADY_IN_SECT.
  //     Service order: char check pass → char.sectId !== null →
  //     ALREADY_IN_SECT FIRES TRƯỚC sect findUnique (line 194 trước 196).
  await step('POST /sect/<bogus>/join — post-onboard in sect 409 ALREADY_IN_SECT', async () => {
    const r = await http(`/api/sect/${randomBogusId()}/join`, { method: 'POST' });
    assertStatus(r, 409, 'POST /sect/<bogus>/join in sect');
    assertErrorCode(r, 'ALREADY_IN_SECT', 'POST /sect/<bogus>/join in sect');
  });

  // 12. POST /sect/contribute ({amount:100}) post-onboard (in sect, 0 LT
  //     fresh char) → 409 INSUFFICIENT_LINH_THACH (service order: amount
  //     cap → char check → sectId pass → linhThach < 100).
  await step('POST /sect/contribute — ({amount:100}) post-onboard in sect (fresh 0 LT) 409 INSUFFICIENT_LINH_THACH', async () => {
    const r = await http('/api/sect/contribute', {
      method: 'POST',
      body: { amount: 100 },
    });
    assertStatus(r, 409, 'POST /sect/contribute in sect 0 LT');
    assertErrorCode(r, 'INSUFFICIENT_LINH_THACH', 'POST /sect/contribute in sect 0 LT');
  });

  // 13. POST /sect/leave (1st) → 200 ok=true; (2nd) → 409 NOT_IN_SECT.
  await step('POST /sect/leave — 1st 200 ok + 2nd 409 NOT_IN_SECT (idempotent guard)', async () => {
    const first = await http('/api/sect/leave', { method: 'POST' });
    assertStatus(first, 200, 'POST /sect/leave 1st');
    if (!first.body?.ok)
      throw new Error(`POST /sect/leave 1st: ok=false body=${JSON.stringify(first.body).slice(0, 200)}`);

    const second = await http('/api/sect/leave', { method: 'POST' });
    assertStatus(second, 409, 'POST /sect/leave 2nd');
    assertErrorCode(second, 'NOT_IN_SECT', 'POST /sect/leave 2nd');
  });

  // 14. POST /sect/<bogus>/join (post-leave) → 404 SECT_NOT_FOUND
  //     (service order: char pass → ALREADY_IN_SECT skip (sectId null
  //     after leave) → sect findUnique → null → SECT_NOT_FOUND).
  //     POST /sect/contribute ({amount:100}, post-leave) → 409
  //     NOT_IN_SECT (service order: amount cap → char pass → sectId null
  //     → NOT_IN_SECT).
  //     anti-FE-self-grant: linhThach/tienNgoc unchanged sau steps 10-14.
  //     logout + GET /sect/me → 401.
  await step('post-leave SECT_NOT_FOUND + NOT_IN_SECT + anti-FE-self-grant + logout + 401', async () => {
    const join = await http(`/api/sect/${randomBogusId()}/join`, { method: 'POST' });
    assertStatus(join, 404, 'POST /sect/<bogus>/join post-leave');
    assertErrorCode(join, 'SECT_NOT_FOUND', 'POST /sect/<bogus>/join post-leave');

    const contribute = await http('/api/sect/contribute', {
      method: 'POST',
      body: { amount: 100 },
    });
    assertStatus(contribute, 409, 'POST /sect/contribute post-leave');
    assertErrorCode(contribute, 'NOT_IN_SECT', 'POST /sect/contribute post-leave');

    const after = await fetchCharCurrencies();
    assert(
      after.linhThach === before.linhThach,
      `linhThach VẪN ${before.linhThach} sau failed attempts, got ${after.linhThach}`,
    );
    assert(
      after.tienNgoc === before.tienNgoc,
      `tienNgoc VẪN ${before.tienNgoc} sau failed attempts, got ${after.tienNgoc}`,
    );

    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const meAfter = await http('/api/sect/me');
    assertStatus(meAfter, 401, 'GET /sect/me post-logout');
    assertErrorCode(meAfter, 'UNAUTHENTICATED', 'GET /sect/me post-logout');
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:sect] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:sect] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:sect] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:sect] unexpected error:', err);
  process.exitCode = 1;
});
