#!/usr/bin/env node
/**
 * smoke-boss.mjs — Boss endpoints smoke cho Xuân Tôi.
 *
 * Negative-path-focused. Positive attack path (POST /boss/attack với
 * skillKey hợp lệ + active boss đang spawn → service success → atomic
 * cooldown set + mp/stamina/hp deduct + BossDamage upsert + ledger)
 * defer cho future smoke với deterministic boss-spawn harness (admin
 * spawn endpoint cần admin auth) hoặc full E2E gameplay automation.
 *
 * Mục tiêu: cover 2 boss endpoints qua HTTP (`apps/api/src/modules/boss`):
 *   - `GET  /api/boss/current` — lấy boss đang ACTIVE (PUBLIC, không
 *                                require auth, viewer null vẫn 200 với
 *                                myDamage/myRank=null).
 *   - `POST /api/boss/attack`  — đánh boss (auth + zod skillKey
 *                                max 64 + service order char → buff
 *                                control → cooldown → boss → skill
 *                                sect → mp/stamina/hp).
 *
 * Service order (`boss.service.ts`):
 *   1. char findUnique → NO_CHARACTER (404)
 *   2. buffMods.controlTurnsMax > 0 → CONTROLLED (409)
 *   3. buffMods.cultivationBlocked → CULTIVATION_BLOCKED (409)
 *   4. cooldown < BOSS_ATTACK_COOLDOWN_MS → COOLDOWN (429)
 *   5. worldBoss findFirst ACTIVE → NO_ACTIVE_BOSS (404)
 *   6. bossByKey lookup → NO_ACTIVE_BOSS (404)
 *   7. skill.sect mismatch → SKILL_NOT_USABLE (400)
 *   8. mp/stamina/hp checks → MP_LOW/STAMINA_LOW/HP_LOW (409)
 *
 * Critical observation — `GET /boss/current` PUBLIC:
 *   - getViewer() trả viewer null nếu không có auth cookie, KHÔNG throw
 *     UNAUTHENTICATED. Service trả BossView với myDamage/myRank=null.
 *   - Endpoint này expose để anonymous user xem boss đang spawn (UI
 *     landing/marketing) — KHÔNG phải auth gap.
 *
 * Critical observation — service char check TRƯỚC mọi thứ:
 *   - Pre-onboard auth → POST /boss/attack ({}) → service first throw
 *     NO_CHARACTER 404 trước khi touch buff/cooldown/boss state.
 *   - Pre-onboard auth → POST /boss/attack ({skillKey:'basic_attack'})
 *     → vẫn NO_CHARACTER 404 (skillKey valid nhưng char gate fires
 *     first).
 *
 * 14-step:
 *   1.  `GET  /api/boss/current` (no auth) → 200 ok=true (PUBLIC,
 *                                            shape verify nếu boss
 *                                            non-null: id/bossKey/
 *                                            level/maxHp/currentHp/
 *                                            status='ACTIVE'/spawnedAt/
 *                                            expiresAt/leaderboard
 *                                            array/myDamage=null/
 *                                            myRank=null/participants/
 *                                            cooldownUntil=null/
 *                                            topDropPool array/
 *                                            midDropPool array).
 *   2.  `POST /api/boss/attack` (no auth) → 401 UNAUTHENTICATED.
 *   3.  `POST /api/_auth/register` — fresh user.
 *   4.  `GET  /api/boss/current` (auth pre-onboard) → 200 ok=true
 *                                            (boss có thể null hoặc
 *                                            non-null tùy heartbeat
 *                                            state — pre-onboard viewer
 *                                            cũng có characterId=null
 *                                            nên myDamage/myRank vẫn
 *                                            null nếu boss active).
 *   5.  `POST /api/boss/attack` ({skillKey: 'a'.repeat(65)}) → 400
 *                                            INVALID_INPUT (zod max(64)
 *                                            controller-level TRƯỚC
 *                                            service).
 *   6.  `POST /api/boss/attack` ({}) pre-onboard → 404 NO_CHARACTER
 *                                            (service first check char
 *                                            findUnique null → throw
 *                                            BossError trước buff/
 *                                            cooldown/boss).
 *   7.  `POST /api/boss/attack` ({skillKey:'basic_attack'}) pre-onboard
 *                                            → 404 NO_CHARACTER (service
 *                                            char gate fires first
 *                                            bất kể skillKey valid).
 *   8.  `POST /api/character/onboard` — fresh char (sectKey:'thanh_van',
 *                                       0 LT, 0 TN, mp=50 baseline,
 *                                       hp=100 baseline).
 *   9.  `POST /api/boss/attack` ({skillKey: 'a'.repeat(65)}) post-onboard
 *                                            → 400 INVALID_INPUT (zod
 *                                            controller-level vẫn fires
 *                                            trước service bất kể có
 *                                            char hay không).
 *  10.  `POST /api/boss/attack` ({skillKey: 12345}) post-onboard → 400
 *                                            INVALID_INPUT (zod
 *                                            optional string reject
 *                                            non-string type).
 *  11.  `GET  /api/boss/current` (auth post-onboard) → 200 ok=true
 *                                            (shape contract giống
 *                                            step 1 nhưng có viewer
 *                                            characterId).
 *  12.  Anti-FE-self-grant snapshot: `GET /api/character/state`
 *                                    snapshot hp/mp/stamina/linhThach
 *                                    BEFORE attempts trên (post-onboard
 *                                    fresh char chưa attack) → đối
 *                                    chiếu sau 4xx attempts đảm bảo
 *                                    KHÔNG có frontend tự cộng/trừ
 *                                    (server-authoritative).
 *  13.  `POST /api/_auth/logout` — clear access cookie.
 *  14.  `GET  /api/boss/current` (post-logout) → 200 ok=true (PUBLIC
 *                                            endpoint, no auth required
 *                                            — verify endpoint vẫn
 *                                            hoạt động sau logout).
 *  15.  `POST /api/boss/attack` (post-logout) → 401 UNAUTHENTICATED
 *                                            (mutation endpoint vẫn
 *                                            require auth post-logout).
 *
 * Chạy:
 *   pnpm smoke:boss
 *   # hoặc trực tiếp:
 *   node scripts/smoke-boss.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE   — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS — default 10000ms / request.
 *   SMOKE_VERBOSE    — "1" để log request/response (debug).
 *
 * Yêu cầu môi trường:
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:boss`
 *
 * Mutation footprint:
 *   - 1 fresh user + 1 fresh character + auto-joined thanh_van sect
 *     (KHÔNG đánh boss thành công, KHÔNG đụng cooldown/mp/stamina/hp,
 *     KHÔNG đụng BossDamage/inventory/ledger).
 *
 * Defer:
 *   - Positive attack path (admin spawn boss → POST /boss/attack với
 *     basic_attack → service success → cooldown set + mp/stamina deduct
 *     + BossDamage upsert) yêu cầu admin auth + admin spawn endpoint
 *     POST /api/boss/admin/spawn → defer.
 *   - SKILL_NOT_USABLE 400 từ service (skillKey thuộc sect khác — vd
 *     huyet_te_chi_thuat sect 'tu_la' khi char thanh_van) requires
 *     active boss to reach skill check sau boss gate → non-deterministic
 *     vì phụ thuộc heartbeat state → defer.
 *   - COOLDOWN/STAMINA_LOW/MP_LOW/HP_LOW negative paths cũng cần state
 *     mutation hoặc admin grant → defer.
 *   - BOSS_ALREADY_ACTIVE từ adminSpawn requires admin auth → defer.
 *   - INVALID_BOSS_KEY/INVALID_LEVEL từ adminSpawn requires admin auth
 *     → defer.
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
  process.stdout.write(`[smoke:boss] ${name} ... `);
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
// Helpers — verify boss view shape (cùng dạng dù viewer null hay non-null).
// -----------------------------------------------------------------------------

/**
 * @param {any} boss
 * @param {string} label
 * @param {{ viewerAuthed: boolean }} ctx
 */
function assertBossViewShape(boss, label, ctx) {
  if (boss === null) return; // boss có thể null nếu chưa heartbeat spawn.
  assert(typeof boss === 'object', `${label}: boss not object`);
  assert(typeof boss.id === 'string' && boss.id.length > 0, `${label}: boss.id invalid`);
  assert(typeof boss.bossKey === 'string' && boss.bossKey.length > 0, `${label}: boss.bossKey invalid`);
  assert(typeof boss.name === 'string', `${label}: boss.name not string`);
  assert(typeof boss.description === 'string', `${label}: boss.description not string`);
  assert(typeof boss.level === 'number' && boss.level >= 1, `${label}: boss.level invalid`);
  assert(typeof boss.maxHp === 'string', `${label}: boss.maxHp not string (BigInt-stringified)`);
  assert(typeof boss.currentHp === 'string', `${label}: boss.currentHp not string`);
  assert(boss.status === 'ACTIVE', `${label}: boss.status expect ACTIVE got ${boss.status}`);
  assert(typeof boss.spawnedAt === 'string', `${label}: boss.spawnedAt not ISO string`);
  assert(typeof boss.expiresAt === 'string', `${label}: boss.expiresAt not ISO string`);
  assert(Array.isArray(boss.leaderboard), `${label}: boss.leaderboard not array`);
  assert(typeof boss.participants === 'number', `${label}: boss.participants not number`);
  assert(Array.isArray(boss.topDropPool), `${label}: boss.topDropPool not array`);
  assert(Array.isArray(boss.midDropPool), `${label}: boss.midDropPool not array`);
  // Viewer-specific (myDamage / myRank / cooldownUntil): null nếu viewer
  // không có character (anonymous hoặc pre-onboard). Fresh post-onboard
  // chưa attack cũng vẫn null cho myDamage/myRank (chưa lưu BossDamage).
  if (!ctx.viewerAuthed) {
    assert(boss.myDamage === null, `${label}: anonymous viewer myDamage expect null got ${boss.myDamage}`);
    assert(boss.myRank === null, `${label}: anonymous viewer myRank expect null got ${boss.myRank}`);
    assert(boss.cooldownUntil === null, `${label}: anonymous viewer cooldownUntil expect null got ${boss.cooldownUntil}`);
  } else {
    // viewerAuthed: myDamage/myRank string|number|null tùy state, KHÔNG
    // assert giá trị cụ thể vì heartbeat + BossDamage state runtime.
    // cooldownUntil cũng có thể null (chưa attack) hoặc ISO string (đã
    // attack). Chỉ assert kiểu hợp lệ.
    assert(
      boss.myDamage === null || typeof boss.myDamage === 'string',
      `${label}: viewer myDamage type invalid: ${typeof boss.myDamage}`,
    );
    assert(
      boss.myRank === null || typeof boss.myRank === 'number',
      `${label}: viewer myRank type invalid: ${typeof boss.myRank}`,
    );
    assert(
      boss.cooldownUntil === null || typeof boss.cooldownUntil === 'string',
      `${label}: viewer cooldownUntil type invalid: ${typeof boss.cooldownUntil}`,
    );
  }
}

// -----------------------------------------------------------------------------
// Helpers random.
// -----------------------------------------------------------------------------

function randomEmail() {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `smoke-boss-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `bos_${rand}`;
}

/** @returns {Promise<{hp: number; mp: number; stamina: number; linhThach: string; tienNgoc: number}>} */
async function fetchCharSnapshot() {
  const r = await http('/api/character/state');
  assertStatus(r, 200, 'GET /character/state snapshot');
  const c = r.body?.data?.character;
  assert(c, 'GET /character/state: missing character');
  return {
    hp: Number(c.hp),
    mp: Number(c.mp),
    stamina: Number(c.stamina),
    linhThach: String(c.linhThach),
    tienNgoc: Number(c.tienNgoc),
  };
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

async function main() {
  console.log(`[smoke:boss] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms`);

  // 1. GET /boss/current (no auth) → 200 (PUBLIC endpoint).
  await step('GET /boss/current — anonymous 200 (PUBLIC, shape verify)', async () => {
    const r = await http('/api/boss/current');
    assertStatus(r, 200, 'GET /boss/current anonymous');
    if (!r.body?.ok)
      throw new Error(`GET /boss/current anonymous: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const boss = r.body?.data?.boss;
    assertBossViewShape(boss, 'GET /boss/current anonymous', { viewerAuthed: false });
  });

  // 2. POST /boss/attack (no auth) → 401.
  await step('POST /boss/attack — 401 UNAUTHENTICATED (no auth)', async () => {
    const r = await http('/api/boss/attack', { method: 'POST', body: {} });
    assertStatus(r, 401, 'POST /boss/attack unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'POST /boss/attack unauth');
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

  // 4. GET /boss/current auth pre-onboard → 200 (viewer characterId=null).
  await step('GET /boss/current — auth pre-onboard 200', async () => {
    const r = await http('/api/boss/current');
    assertStatus(r, 200, 'GET /boss/current auth pre-onboard');
    if (!r.body?.ok)
      throw new Error(`GET /boss/current pre-onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const boss = r.body?.data?.boss;
    // Pre-onboard: userId set nhưng characterId=null → viewer-specific
    // fields (myDamage/myRank/cooldownUntil) vẫn null.
    assertBossViewShape(boss, 'GET /boss/current auth pre-onboard', { viewerAuthed: false });
  });

  // 5. POST /boss/attack (skillKey > 64) pre-onboard → 400 INVALID_INPUT.
  await step('POST /boss/attack — (skillKey > 64) pre-onboard 400 INVALID_INPUT', async () => {
    const r = await http('/api/boss/attack', {
      method: 'POST',
      body: { skillKey: 'a'.repeat(65) },
    });
    assertStatus(r, 400, 'POST /boss/attack skillKey > 64');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /boss/attack skillKey > 64');
  });

  // 6. POST /boss/attack ({}) pre-onboard → 404 NO_CHARACTER (service order).
  await step('POST /boss/attack — ({}) pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/boss/attack', { method: 'POST', body: {} });
    assertStatus(r, 404, 'POST /boss/attack ({}) pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'POST /boss/attack ({}) pre-onboard');
  });

  // 7. POST /boss/attack ({skillKey:'basic_attack'}) pre-onboard → 404
  //    NO_CHARACTER (service char gate fires TRƯỚC mọi gate khác).
  await step('POST /boss/attack — (basic_attack) pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/boss/attack', {
      method: 'POST',
      body: { skillKey: 'basic_attack' },
    });
    assertStatus(r, 404, 'POST /boss/attack basic_attack pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'POST /boss/attack basic_attack pre-onboard');
  });

  // 8. Onboard fresh char (thanh_van).
  await step('onboard — create character (sectKey:thanh_van)', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: randomCharName(), sectKey: 'thanh_van' },
    });
    assertStatus(r, 200, 'onboard');
    if (!r.body?.ok)
      throw new Error(`onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.character?.id, 'onboard: missing character.id');
  });

  // Snapshot BEFORE failed attack steps 9-10 — anti-FE-self-grant
  // baseline.
  const before = await fetchCharSnapshot();

  // 9. POST /boss/attack ({skillKey > 64}) post-onboard → 400 INVALID_INPUT
  //    (zod controller-level vẫn fires trước service bất kể có char).
  await step('POST /boss/attack — (skillKey > 64) post-onboard 400 INVALID_INPUT', async () => {
    const r = await http('/api/boss/attack', {
      method: 'POST',
      body: { skillKey: 'a'.repeat(65) },
    });
    assertStatus(r, 400, 'POST /boss/attack skillKey > 64 post-onboard');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /boss/attack skillKey > 64 post-onboard');
  });

  // 10. POST /boss/attack ({skillKey: 12345}) post-onboard → 400 INVALID_INPUT
  //     (zod optional string reject non-string type — controller-level).
  await step('POST /boss/attack — (skillKey:non-string) post-onboard 400 INVALID_INPUT', async () => {
    const r = await http('/api/boss/attack', {
      method: 'POST',
      body: { skillKey: 12345 },
    });
    assertStatus(r, 400, 'POST /boss/attack skillKey non-string post-onboard');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /boss/attack skillKey non-string post-onboard');
  });

  // 11. GET /boss/current auth post-onboard → 200 (viewer authed).
  await step('GET /boss/current — auth post-onboard 200', async () => {
    const r = await http('/api/boss/current');
    assertStatus(r, 200, 'GET /boss/current post-onboard');
    if (!r.body?.ok)
      throw new Error(`GET /boss/current post-onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const boss = r.body?.data?.boss;
    assertBossViewShape(boss, 'GET /boss/current post-onboard', { viewerAuthed: true });
  });

  // 12. Anti-FE-self-grant invariant — verify hp/mp/stamina/linhThach
  //     KHÔNG đổi sau các 4xx attempts (server-authoritative).
  await step('anti-FE-self-grant — hp/mp/stamina/linhThach unchanged after 4xx attempts', async () => {
    const after = await fetchCharSnapshot();
    assert(after.hp === before.hp, `hp đổi: ${before.hp} → ${after.hp}`);
    assert(after.mp === before.mp, `mp đổi: ${before.mp} → ${after.mp}`);
    assert(
      after.stamina === before.stamina,
      `stamina đổi: ${before.stamina} → ${after.stamina}`,
    );
    assert(
      after.linhThach === before.linhThach,
      `linhThach đổi: ${before.linhThach} → ${after.linhThach}`,
    );
    assert(
      after.tienNgoc === before.tienNgoc,
      `tienNgoc đổi: ${before.tienNgoc} → ${after.tienNgoc}`,
    );
  });

  // 13. Logout.
  await step('logout', async () => {
    const r = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(r, [200, 204], 'logout');
  });

  // 14. GET /boss/current post-logout → 200 (PUBLIC, no auth required).
  await step('GET /boss/current — post-logout 200 (PUBLIC stays open)', async () => {
    const r = await http('/api/boss/current');
    assertStatus(r, 200, 'GET /boss/current post-logout');
    if (!r.body?.ok)
      throw new Error(`GET /boss/current post-logout: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const boss = r.body?.data?.boss;
    assertBossViewShape(boss, 'GET /boss/current post-logout', { viewerAuthed: false });
  });

  // 15. POST /boss/attack post-logout → 401 (mutation endpoint vẫn gate).
  await step('POST /boss/attack — post-logout 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/boss/attack', { method: 'POST', body: {} });
    assertStatus(r, 401, 'POST /boss/attack post-logout');
    assertErrorCode(r, 'UNAUTHENTICATED', 'POST /boss/attack post-logout');
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:boss] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:boss] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:boss] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:boss] unexpected error:', err);
  process.exitCode = 1;
});
