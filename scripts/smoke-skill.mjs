#!/usr/bin/env node
/**
 * smoke-skill.mjs — Skill (Kỹ năng) state machine smoke cho Xuân Tôi.
 *
 * Mục tiêu: cover skill endpoints qua HTTP để đóng smoke gap còn lại cho
 * character module sau khi #359 cover cultivate, #361 cover breakthrough,
 * #362 cover spiritual-root, #363 cover cultivation-method. Verify
 * auto-grant + auto-equip starter `basic_attack` qua onboard, equip/unequip
 * idempotency, body validation, NOT_LEARNED cho skill chưa học, SKILL_NOT_FOUND
 * cho key catalog không có, INSUFFICIENT_FUNDS cho upgrade-mastery (fresh char
 * 0 LinhThach < 100 cost), anti-FE-self-grant invariant (failed equip/unequip
 * /upgrade KHÔNG đụng learned[]/maxEquipped/equippedKeys/masteryLevels).
 *
 * Phase 11.2.D positive-path EXTENSION (PR session post-#387): cover
 * `POST /character/skill/learn-from-book` qua admin seed grant-item
 * `skill_book_kim_quang_tram` (re-use admin grant-item endpoint từ PR #383
 * + cookie-jar swap pattern từ PR #384 / #386). Verify ItemLedger qty=-1
 * reason='SKILL_LEARN' atomic với CharacterSkill create source='item_consume',
 * inventory row delete khi qty=0, /skill/equip + /skill/unequip happy-path,
 * và idempotent re-equip không-no-op (kim_quang_tram qua DB update —
 * khác basic_attack ngoại lệ).
 *
 * Phase 11.2.B upgrade-mastery positive-path EXTENSION (PR session post-#389):
 * cover `POST /character/skill/upgrade-mastery` qua admin seed grant-currency
 * `LINH_THACH 200` (re-use admin grant-currency endpoint từ PR #389 +
 * cookie-jar swap). Verify CurrencyLedger reason='SKILL_UPGRADE' delta=-200
 * atomic với masteryLevel L1→L2 bump trên kim_quang_tram (basic tier
 * baseLinhThachCost=100, multiplier=2.0 → masteryLevels[1].linhThachCost
 * = 100 * 2^(2-1) = 200 LT). Retry sau spend (balance=0) → 402
 * INSUFFICIENT_FUNDS cho L2→L3 (cost 400) — atomic rollback giữ
 * masteryLevel=2 (anti-FE-self-grant invariant).
 *
 *   1. `GET  /api/character/skill` (no auth)                     → 401.
 *   2. `POST /api/character/skill/equip` (no auth)               → 401.
 *   3. `POST /api/character/skill/upgrade-mastery` (no auth)     → 401.
 *   4. `POST /api/_auth/register`                                — fresh user.
 *   5. `GET  /api/character/skill` (no char)                     → 404
 *                                                                  NO_CHARACTER.
 *   6. `POST /api/character/skill/equip` (no char)               → 404
 *                                                                  NO_CHARACTER.
 *   7. `POST /api/character/onboard`                             — fresh char.
 *   8. `GET  /api/character/skill`                               → 200,
 *                                                                  maxEquipped
 *                                                                  =4,
 *                                                                  learned[]
 *                                                                  contains
 *                                                                  basic_attack
 *                                                                  isEquipped
 *                                                                  =true,
 *                                                                  source=
 *                                                                  'starter',
 *                                                                  masteryLevel
 *                                                                  =1.
 *                                                                  Snapshot
 *                                                                  {maxEquipped,
 *                                                                  learnedKeys,
 *                                                                  equippedKeys,
 *                                                                  masteryLevels}.
 *   9. `POST .../equip` body {}                                  → 400
 *                                                                  INVALID_INPUT.
 *  10. `POST .../equip` body {skillKey:'kiem_khi_chem'}          → 409
 *                                                                  NOT_LEARNED
 *                                                                  (sect skill
 *                                                                  KHÔNG
 *                                                                  auto-grant
 *                                                                  qua
 *                                                                  onboard).
 *  11. `POST .../upgrade-mastery` body {skillKey:'fake_xyz'}     → 404
 *                                                                  SKILL_NOT_FOUND
 *                                                                  (template
 *                                                                  miss).
 *  12. `POST .../upgrade-mastery` body {skillKey:'basic_attack'} → 402
 *                                                                  INSUFFICIENT
 *                                                                  _FUNDS
 *                                                                  (fresh
 *                                                                  char 0
 *                                                                  LinhThach,
 *                                                                  level 1→2
 *                                                                  cost 100).
 *  13. `POST .../unequip` body {skillKey:'kiem_khi_chem'}        → 409
 *                                                                  NOT_LEARNED.
 *  14. `GET  /api/character/skill`                               → state
 *                                                                  KHÔNG đổi
 *                                                                  qua 5
 *                                                                  failed
 *                                                                  attempts
 *                                                                  (anti-FE-
 *                                                                  grant).
 *  15. `POST .../equip` body {skillKey:'basic_attack'}           → 200
 *                                                                  idempotent
 *                                                                  (basic_attack
 *                                                                  no-op
 *                                                                  branch),
 *                                                                  state vẫn
 *                                                                  giống
 *                                                                  snapshot.
 *
 *  // Positive-path Phase 11.2.D — admin grant skill_book → learn → equip
 *  16. admin login + swap cookie jar (snapshot player → admin).
 *  17. `POST /api/admin/users/:id/grant-item`                     → 200,
 *                                                                  itemKey:
 *                                                                  'skill_book
 *                                                                  _kim_quang
 *                                                                  _tram',
 *                                                                  qty:1.
 *  18. admin logout + restore player cookies.
 *  19. `GET  /api/inventory`                                      → 200,
 *                                                                  find
 *                                                                  inventoryItem
 *                                                                  Id của
 *                                                                  skill_book
 *                                                                  qty=1.
 *  20. `POST /api/character/skill/learn-from-book`                → 200,
 *                                                                  learn.skillKey
 *                                                                  ='kim_quang
 *                                                                  _tram',
 *                                                                  consumed
 *                                                                  ItemKey
 *                                                                  ='skill_book
 *                                                                  _kim_quang
 *                                                                  _tram',
 *                                                                  state.learned
 *                                                                  contains
 *                                                                  kim_quang
 *                                                                  _tram
 *                                                                  source=
 *                                                                  'item_consume',
 *                                                                  isEquipped
 *                                                                  =false,
 *                                                                  masteryLevel
 *                                                                  =1.
 *  21. `GET  /api/inventory`                                      → 200,
 *                                                                  skill_book
 *                                                                  row đã
 *                                                                  removed
 *                                                                  (qty 1→0
 *                                                                  → row
 *                                                                  delete).
 *  22. `POST .../skill/equip` body                                → 200,
 *      {skillKey:'kim_quang_tram'}                                   kim_quang
 *                                                                  _tram.
 *                                                                  isEquipped
 *                                                                  =true.
 *  23. `POST .../skill/unequip` body                              → 200,
 *      {skillKey:'kim_quang_tram'}                                   kim_quang
 *                                                                  _tram.
 *                                                                  isEquipped
 *                                                                  =false.
 *  24. `POST .../skill/equip` body                                → 200
 *      {skillKey:'kim_quang_tram'}                                   idempotent
 *                                                                  re-equip,
 *                                                                  isEquipped
 *                                                                  =true.
 *  25. `POST .../skill/learn-from-book` cùng inventoryItemId      → 404
 *                                                                  INVENTORY
 *                                                                  _ITEM_NOT
 *                                                                  _FOUND
 *                                                                  (đã consume,
 *                                                                  row delete).
 *
 *  // Positive-path Phase 11.2.B — admin grant-currency → upgrade-mastery
 *  26. admin login + grant-currency LINH_THACH 200 + admin logout/restore.
 *  27. `GET  /api/character/me`                                  → 200,
 *                                                                  linhThach
 *                                                                  =200
 *                                                                  (verify
 *                                                                  grant
 *                                                                  cộng đúng).
 *  28. `POST /api/character/skill/upgrade-mastery`               → 200,
 *      body {skillKey:'kim_quang_tram'}                             upgrade
 *                                                                  .previousLevel
 *                                                                  =1, newLevel
 *                                                                  =2,
 *                                                                  linhThachSpent
 *                                                                  =200.
 *  29. `GET  /api/character/skill`                               → 200,
 *                                                                  kim_quang
 *                                                                  _tram.
 *                                                                  masteryLevel
 *                                                                  =2 (state
 *                                                                  update
 *                                                                  server-auth).
 *  30. `GET  /api/character/me`                                  → 200,
 *                                                                  linhThach
 *                                                                  =0
 *                                                                  (200 grant
 *                                                                  - 200
 *                                                                  spend,
 *                                                                  atomic).
 *  31. `POST /api/character/skill/upgrade-mastery` retry         → 402
 *      body {skillKey:'kim_quang_tram'}                             INSUFFICIENT
 *                                                                  _FUNDS
 *                                                                  (cần 400
 *                                                                  cho L2→L3,
 *                                                                  balance=0).
 *  32. `GET  /api/character/skill`                               → 200,
 *                                                                  kim_quang
 *                                                                  _tram.
 *                                                                  masteryLevel
 *                                                                  =2 KHÔNG
 *                                                                  đổi qua
 *                                                                  failed
 *                                                                  retry
 *                                                                  (atomic
 *                                                                  rollback).
 *
 *  33. `POST /api/_auth/logout` + GET /skill                      → 401.
 *
 * Anti-FE-self-grant invariant (per Luật bắt buộc — KHÔNG để frontend tự cộng
 * skill / mastery / equip slot qua failed attempts):
 *   - `learnedKeys` (sorted joined) KHÔNG đổi qua failed equip/unequip/upgrade.
 *   - `equippedKeys` (sorted joined) KHÔNG đổi.
 *   - `masteryLevels` (joined per skill) KHÔNG đổi qua failed upgrade-mastery.
 *
 * Positive-path invariant:
 *   - `learn-from-book` server-authoritative — chỉ tăng learned[] khi consume
 *     SKILL_BOOK item qua ItemLedger atomic. UI KHÔNG tự cộng row.
 *   - Re-call `learn-from-book` cùng inventoryItemId sau consume → 404
 *     INVENTORY_ITEM_NOT_FOUND (anti double-grant).
 *   - `upgrade-mastery` server-authoritative — chỉ bump masteryLevel khi
 *     CurrencyLedger SKILL_UPGRADE delta ghi atomic. INSUFFICIENT_FUNDS
 *     rollback masteryLevel KHÔNG đổi (anti FE-self-grant).
 *
 * Chạy:
 *   pnpm smoke:skill
 *   # hoặc trực tiếp:
 *   node scripts/smoke-skill.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE        — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS      — default 10000ms / request.
 *   SMOKE_VERBOSE         — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY        — default "thanh_van".
 *   SMOKE_ADMIN_EMAIL     — default "admin@example.com" (bootstrap admin).
 *   SMOKE_ADMIN_PASSWORD  — default "change-me-bootstrap-pass".
 *   SMOKE_LEARN_ITEM_KEY  — default "skill_book_kim_quang_tram" (luyenkhi).
 *   SMOKE_LEARN_SKILL_KEY — default "kim_quang_tram" (target skill).
 *
 * Yêu cầu môi trường (giống smoke:cultivation-method):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api bootstrap` (seed 3 sect)
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:skill`
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
const STARTER_SKILL_KEY = 'basic_attack';
const SECT_SKILL_NOT_LEARNED = 'kiem_khi_chem'; // Thanh Vân sect skill — KHÔNG auto-grant qua onboard.
const FAKE_SKILL_KEY = 'fake_xyz_unknown_skill_key';

// Phase 11.2.D positive-path — admin grant skill_book → learn-from-book.
// kim_quang_tram = basic tier, unlocks=[{kind:'realm',ref:'luyenkhi'}] →
// fresh char (luyenkhi/thanh_van) học được không cần advance realm/sect.
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'change-me-bootstrap-pass';
const LEARN_ITEM_KEY = process.env.SMOKE_LEARN_ITEM_KEY ?? 'skill_book_kim_quang_tram';
const LEARN_SKILL_KEY = process.env.SMOKE_LEARN_SKILL_KEY ?? 'kim_quang_tram';

/** State giữa các step (giống smoke:spiritual-root cookie-jar swap pattern). */
const state = {
  /** @type {string | null} */
  userId: null,
  /** @type {string | null} */
  inventoryItemId: null,
};

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
  process.stdout.write(`[smoke:skill] ${name} ... `);
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
  return `smoke-skill-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `sk_${rand}`;
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

/**
 * Helper: extract immutable skill state cho anti-FE-grant compare.
 * @param {any} sk
 */
function snapshotSkill(sk) {
  const learned = Array.isArray(sk?.learned) ? sk.learned : [];
  const learnedKeys = [...learned.map((/** @type {any} */ row) => String(row?.skillKey ?? ''))]
    .sort()
    .join(',');
  const equippedKeys = [
    ...learned
      .filter((/** @type {any} */ row) => row?.isEquipped === true)
      .map((/** @type {any} */ row) => String(row?.skillKey ?? '')),
  ]
    .sort()
    .join(',');
  const masteryLevels = [
    ...learned.map(
      (/** @type {any} */ row) => `${String(row?.skillKey ?? '')}=${Number(row?.masteryLevel ?? -1)}`,
    ),
  ]
    .sort()
    .join(',');
  return {
    maxEquipped: typeof sk?.maxEquipped === 'number' ? sk.maxEquipped : null,
    learnedCount: learned.length,
    learnedKeys,
    equippedKeys,
    masteryLevels,
  };
}

/**
 * @param {ReturnType<typeof snapshotSkill>} before
 * @param {ReturnType<typeof snapshotSkill>} after
 * @param {string} label
 */
function assertSkillImmutable(before, after, label) {
  for (const key of /** @type {const} */ ([
    'maxEquipped',
    'learnedCount',
    'learnedKeys',
    'equippedKeys',
    'masteryLevels',
  ])) {
    if (before[key] !== after[key]) {
      throw new Error(
        `${label}: field ${key} thay đổi qua failed action (anti-FE-self-grant): before=${before[key]} after=${after[key]}`,
      );
    }
  }
}

async function main() {
  console.log(`[smoke:skill] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}, starter = ${STARTER_SKILL_KEY}, not-learned-test = ${SECT_SKILL_NOT_LEARNED}`);

  // 1. GET /skill chưa auth → 401.
  await step('GET /skill — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/character/skill');
    assertStatus(r, 401, 'GET unauth');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `GET unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 2. POST /skill/equip chưa auth → 401.
  await step('POST /skill/equip — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/character/skill/equip', {
      method: 'POST',
      body: { skillKey: STARTER_SKILL_KEY },
    });
    assertStatus(r, 401, 'POST equip unauth');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `POST equip unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 3. POST /skill/upgrade-mastery chưa auth → 401.
  await step('POST /skill/upgrade-mastery — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/character/skill/upgrade-mastery', {
      method: 'POST',
      body: { skillKey: STARTER_SKILL_KEY },
    });
    assertStatus(r, 401, 'POST upgrade unauth');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `POST upgrade unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 4. Register fresh user.
  const email = randomEmail();
  const password = randomPassword();
  await step('register', async () => {
    const r = await http('/api/_auth/register', {
      method: 'POST',
      body: { email, password },
    });
    assertStatus(r, [200, 201], 'register');
    if (!r.body?.ok) throw new Error(`register: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const userId = r.body?.data?.user?.id;
    assert(userId, 'register: missing user.id');
    state.userId = userId;
  });

  // 5. GET /skill khi chưa onboard → 404 NO_CHARACTER.
  await step('GET /skill — 404 NO_CHARACTER khi chưa onboard', async () => {
    const r = await http('/api/character/skill');
    assertStatus(r, 404, 'GET no-char');
    assert(r.body?.error?.code === 'NO_CHARACTER', `GET no-char: expect code NO_CHARACTER, got ${r.body?.error?.code}`);
  });

  // 6. POST /skill/equip khi chưa onboard → 404 NO_CHARACTER.
  await step('POST /skill/equip — 404 NO_CHARACTER khi chưa onboard', async () => {
    const r = await http('/api/character/skill/equip', {
      method: 'POST',
      body: { skillKey: STARTER_SKILL_KEY },
    });
    assertStatus(r, 404, 'POST equip no-char');
    assert(r.body?.error?.code === 'NO_CHARACTER', `POST equip no-char: expect code NO_CHARACTER, got ${r.body?.error?.code}`);
  });

  // 7. Onboard character.
  await step('onboard — create character', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: randomCharName(), sectKey: SECT_KEY },
    });
    assertStatus(r, 200, 'onboard');
    if (!r.body?.ok) throw new Error(`onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.character, 'onboard: missing character');
  });

  // 8. GET /skill → 200, fresh char đã được auto-grant + auto-equip starter
  //    qua onboard. Snapshot state.
  /** @type {ReturnType<typeof snapshotSkill>} */
  let initialSkill;
  await step('GET /skill — fresh char auto-equipped basic_attack + verify shape', async () => {
    const r = await http('/api/character/skill');
    assertStatus(r, 200, 'GET first');
    if (!r.body?.ok) throw new Error(`GET first: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const sk = r.body?.data?.skill;
    assert(sk, 'GET first: missing data.skill');
    assert(sk.maxEquipped === 4, `GET first: expect maxEquipped=4, got ${sk.maxEquipped}`);
    assert(Array.isArray(sk.learned), 'GET first: learned phải là array');
    assert(sk.learned.length >= 1, `GET first: learned phải có ≥ 1 row, got ${sk.learned.length}`);
    const starter = sk.learned.find((/** @type {any} */ row) => row.skillKey === STARTER_SKILL_KEY);
    assert(starter, `GET first: learned phải chứa skillKey=${STARTER_SKILL_KEY}`);
    assert(starter.isEquipped === true, `GET first: ${STARTER_SKILL_KEY}.isEquipped phải true, got ${starter.isEquipped}`);
    assert(starter.source === 'starter', `GET first: ${STARTER_SKILL_KEY}.source phải = 'starter', got ${starter.source}`);
    assert(starter.masteryLevel === 1, `GET first: ${STARTER_SKILL_KEY}.masteryLevel phải = 1, got ${starter.masteryLevel}`);
    assert(starter.tier === 'basic', `GET first: ${STARTER_SKILL_KEY}.tier phải = 'basic', got ${starter.tier}`);
    assert(typeof starter.maxMastery === 'number' && starter.maxMastery >= 1, `GET first: ${STARTER_SKILL_KEY}.maxMastery phải số ≥ 1, got ${starter.maxMastery}`);
    assert(typeof starter.learnedAt === 'string', `GET first: ${STARTER_SKILL_KEY}.learnedAt phải ISO string, got ${typeof starter.learnedAt}`);
    initialSkill = snapshotSkill(sk);
  });

  // 9. POST /equip body {} → 400 INVALID_INPUT (Zod fail missing skillKey).
  await step('POST /equip — 400 INVALID_INPUT body {}', async () => {
    const r = await http('/api/character/skill/equip', {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 400, 'POST equip body-empty');
    assert(r.body?.error?.code === 'INVALID_INPUT', `POST equip body-empty: expect code INVALID_INPUT, got ${r.body?.error?.code}`);
  });

  // 10. POST /equip skillKey='kiem_khi_chem' (sect skill chưa học) → 409
  //     NOT_LEARNED (basic_attack ngoại lệ no-op; mọi skillKey khác mà
  //     character chưa có row → NOT_LEARNED).
  await step('POST /equip — 409 NOT_LEARNED cho sect skill chưa học', async () => {
    const r = await http('/api/character/skill/equip', {
      method: 'POST',
      body: { skillKey: SECT_SKILL_NOT_LEARNED },
    });
    assertStatus(r, 409, 'POST equip not-learned');
    assert(r.body?.error?.code === 'NOT_LEARNED', `POST equip not-learned: expect code NOT_LEARNED, got ${r.body?.error?.code}`);
  });

  // 11. POST /upgrade-mastery skillKey='fake_xyz' → 404 SKILL_NOT_FOUND
  //     (template miss BEFORE NOT_LEARNED).
  await step('POST /upgrade-mastery — 404 SKILL_NOT_FOUND cho skillKey lạ', async () => {
    const r = await http('/api/character/skill/upgrade-mastery', {
      method: 'POST',
      body: { skillKey: FAKE_SKILL_KEY },
    });
    assertStatus(r, 404, 'POST upgrade skill-not-found');
    assert(r.body?.error?.code === 'SKILL_NOT_FOUND', `POST upgrade skill-not-found: expect code SKILL_NOT_FOUND, got ${r.body?.error?.code}`);
  });

  // 12. POST /upgrade-mastery skillKey='basic_attack' → 402 INSUFFICIENT_FUNDS
  //     (fresh char 0 LinhThach, basic tier level 1→2 cost = 100 LinhThach
  //     theo SKILL_TIER_DEFS.basic.baseLinhThachCost).
  await step('POST /upgrade-mastery — 402 INSUFFICIENT_FUNDS (fresh char 0 LinhThach)', async () => {
    const r = await http('/api/character/skill/upgrade-mastery', {
      method: 'POST',
      body: { skillKey: STARTER_SKILL_KEY },
    });
    assertStatus(r, 402, 'POST upgrade insufficient-funds');
    assert(r.body?.error?.code === 'INSUFFICIENT_FUNDS', `POST upgrade insufficient-funds: expect code INSUFFICIENT_FUNDS, got ${r.body?.error?.code}`);
  });

  // 13. POST /unequip skillKey='kiem_khi_chem' → 409 NOT_LEARNED.
  await step('POST /unequip — 409 NOT_LEARNED cho sect skill chưa học', async () => {
    const r = await http('/api/character/skill/unequip', {
      method: 'POST',
      body: { skillKey: SECT_SKILL_NOT_LEARNED },
    });
    assertStatus(r, 409, 'POST unequip not-learned');
    assert(r.body?.error?.code === 'NOT_LEARNED', `POST unequip not-learned: expect code NOT_LEARNED, got ${r.body?.error?.code}`);
  });

  // 14. GET /skill → state KHÔNG đổi qua 5 failed attempts (anti-FE-self-grant
  //     invariant — cover failed equip body{} + equip not-learned + upgrade
  //     skill-not-found + upgrade insufficient-funds + unequip not-learned).
  await step('GET /skill — anti-FE-self-grant: state KHÔNG đổi sau 5 failed attempts', async () => {
    const r = await http('/api/character/skill');
    assertStatus(r, 200, 'GET post-fail');
    const sk = r.body?.data?.skill;
    const after = snapshotSkill(sk);
    assertSkillImmutable(initialSkill, after, 'GET post-fail');
  });

  // 15. POST /equip skillKey='basic_attack' → 200 idempotent (basic_attack
  //     ngoại lệ — service returns getState() trực tiếp không update DB).
  //     State vẫn match snapshot (no duplicate learned row, no slot mutate).
  await step('POST /equip — 200 idempotent re-equip basic_attack (no-op branch)', async () => {
    const r = await http('/api/character/skill/equip', {
      method: 'POST',
      body: { skillKey: STARTER_SKILL_KEY },
    });
    assertStatus(r, 200, 'POST equip-starter');
    if (!r.body?.ok) throw new Error(`POST equip-starter: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const sk = r.body?.data?.skill;
    const after = snapshotSkill(sk);
    assertSkillImmutable(initialSkill, after, 'POST equip-starter idempotent');
  });

  // -----------------------------------------------------------------------------
  // POSITIVE PATH — admin seed grant-item skill_book → POST /skill/learn-from-book
  // → /equip → /unequip → idempotent re-equip + ItemLedger consume verify.
  //
  // Foundation từ PR #383 admin grant-item + PR #384 / #386 cookie-jar swap.
  // Service learnFromBook: pre-check INVENTORY_ITEM_NOT_FOUND/NOT_SKILL_BOOK/
  // ALREADY_LEARNED → tx atomic CharacterSkill.create (source='item_consume',
  // masteryLevel=1, isEquipped=false) + InventoryItem decrement/delete +
  // ItemLedger qtyDelta=-1 reason='SKILL_LEARN' refType='InventoryItem'
  // refId=inventoryItem.id meta.skillKey=skillKey. Re-call sau consume →
  // 404 INVENTORY_ITEM_NOT_FOUND (anti double-grant).
  // -----------------------------------------------------------------------------

  /** @type {Map<string,string>} */
  let playerCookieSnap;

  // 16. Snapshot player cookies + admin login → swap jar.
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

  // 17. Admin POST /admin/users/:id/grant-item skill_book qty=1 → 200.
  await step(`admin POST /admin/users/:id/grant-item {itemKey:'${LEARN_ITEM_KEY}',qty:1} → 200 ok (seed learn-from-book)`, async () => {
    if (!state.userId) throw new Error('state.userId missing — register chưa chạy');
    const r = await http(`/api/admin/users/${state.userId}/grant-item`, {
      method: 'POST',
      body: { itemKey: LEARN_ITEM_KEY, qty: 1, reason: 'smoke skill learn-from-book seed' },
    });
    assertStatus(r, 200, 'admin grant-item skill_book');
    assert(
      r.body?.ok === true && r.body?.data?.ok === true,
      `grant-item 200: shape mismatch, got ${JSON.stringify(r.body)}`,
    );
  });

  // 18. Admin logout → restore player cookies.
  await step('admin logout + restore player cookies', async () => {
    const r = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(r, [200, 204], 'admin logout');
    cookieJar.clear();
    restoreCookies(playerCookieSnap);
  });

  // 19. GET /inventory → 1 stack skill_book qty=1 → capture inventoryItemId.
  await step(`GET /inventory — verify ${LEARN_ITEM_KEY} qty=1 + capture inventoryItemId`, async () => {
    const r = await http('/api/inventory');
    assertStatus(r, 200, 'GET /inventory post-grant');
    const items = r.body?.data?.items ?? [];
    const stack = items.find((/** @type {any} */ it) => it.itemKey === LEARN_ITEM_KEY);
    assert(stack, `inventory: thiếu ${LEARN_ITEM_KEY} stack post-grant`);
    assert(stack.qty === 1, `${LEARN_ITEM_KEY} qty post-grant: expect 1, got ${stack.qty}`);
    assert(typeof stack.id === 'string' && stack.id.length > 0, `${LEARN_ITEM_KEY}: missing id`);
    state.inventoryItemId = stack.id;
  });

  // 20. POST /skill/learn-from-book {inventoryItemId} → 200 + skill learned.
  await step(`POST /skill/learn-from-book → 200 learn.skillKey=${LEARN_SKILL_KEY} (consume + create CharacterSkill)`, async () => {
    if (!state.inventoryItemId) throw new Error('state.inventoryItemId missing — GET /inventory chưa chạy');
    const r = await http('/api/character/skill/learn-from-book', {
      method: 'POST',
      body: { inventoryItemId: state.inventoryItemId },
    });
    assertStatus(r, 200, 'POST learn-from-book');
    if (!r.body?.ok) throw new Error(`learn-from-book: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const out = r.body?.data?.learn;
    assert(out?.skillKey === LEARN_SKILL_KEY, `learn.skillKey: expect ${LEARN_SKILL_KEY}, got ${out?.skillKey}`);
    assert(out?.consumedItemKey === LEARN_ITEM_KEY, `learn.consumedItemKey: expect ${LEARN_ITEM_KEY}, got ${out?.consumedItemKey}`);
    const sk = out?.state;
    assert(sk, 'learn.state: missing');
    const learned = (sk.learned ?? []).find((/** @type {any} */ row) => row.skillKey === LEARN_SKILL_KEY);
    assert(learned, `learn.state.learned: thiếu skill ${LEARN_SKILL_KEY}`);
    assert(learned.source === 'item_consume', `learn.source: expect 'item_consume', got ${learned.source}`);
    assert(learned.masteryLevel === 1, `learn.masteryLevel: expect 1, got ${learned.masteryLevel}`);
    assert(learned.isEquipped === false, `learn.isEquipped: expect false (chưa equip), got ${learned.isEquipped}`);
  });

  // 21. GET /inventory → skill_book row removed (qty 1→0 → row delete per service).
  await step(`GET /inventory — ${LEARN_ITEM_KEY} row deleted (qty 1→0)`, async () => {
    const r = await http('/api/inventory');
    assertStatus(r, 200, 'GET /inventory post-learn');
    const items = r.body?.data?.items ?? [];
    const stack = items.find((/** @type {any} */ it) => it.itemKey === LEARN_ITEM_KEY);
    assert(!stack, `inventory: ${LEARN_ITEM_KEY} row vẫn tồn tại (qty 0 phải delete per consume service)`);
  });

  // 22. POST /skill/equip {skillKey:LEARN_SKILL_KEY} → 200 + isEquipped=true.
  await step(`POST /skill/equip {skillKey:${LEARN_SKILL_KEY}} → 200 isEquipped=true`, async () => {
    const r = await http('/api/character/skill/equip', {
      method: 'POST',
      body: { skillKey: LEARN_SKILL_KEY },
    });
    assertStatus(r, 200, 'POST equip kim_quang_tram');
    if (!r.body?.ok) throw new Error(`equip: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const sk = r.body?.data?.skill;
    const learned = (sk?.learned ?? []).find((/** @type {any} */ row) => row.skillKey === LEARN_SKILL_KEY);
    assert(learned?.isEquipped === true, `${LEARN_SKILL_KEY}.isEquipped: expect true post-equip, got ${learned?.isEquipped}`);
  });

  // 23. POST /skill/unequip {skillKey:LEARN_SKILL_KEY} → 200 + isEquipped=false.
  await step(`POST /skill/unequip {skillKey:${LEARN_SKILL_KEY}} → 200 isEquipped=false`, async () => {
    const r = await http('/api/character/skill/unequip', {
      method: 'POST',
      body: { skillKey: LEARN_SKILL_KEY },
    });
    assertStatus(r, 200, 'POST unequip kim_quang_tram');
    if (!r.body?.ok) throw new Error(`unequip: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const sk = r.body?.data?.skill;
    const learned = (sk?.learned ?? []).find((/** @type {any} */ row) => row.skillKey === LEARN_SKILL_KEY);
    assert(learned?.isEquipped === false, `${LEARN_SKILL_KEY}.isEquipped: expect false post-unequip, got ${learned?.isEquipped}`);
  });

  // 24. POST /skill/equip lan 2 → 200 idempotent (DB update isEquipped=true again).
  await step(`POST /skill/equip {skillKey:${LEARN_SKILL_KEY}} lần 2 → 200 idempotent re-equip`, async () => {
    const r = await http('/api/character/skill/equip', {
      method: 'POST',
      body: { skillKey: LEARN_SKILL_KEY },
    });
    assertStatus(r, 200, 'POST equip-idem kim_quang_tram');
    const sk = r.body?.data?.skill;
    const learned = (sk?.learned ?? []).find((/** @type {any} */ row) => row.skillKey === LEARN_SKILL_KEY);
    assert(learned?.isEquipped === true, `${LEARN_SKILL_KEY}.isEquipped: expect true post-re-equip, got ${learned?.isEquipped}`);
  });

  // 25. POST /skill/learn-from-book cùng inventoryItemId → 404 INVENTORY_ITEM_NOT_FOUND.
  await step('POST /skill/learn-from-book cùng inventoryItemId → 404 INVENTORY_ITEM_NOT_FOUND (anti double-grant)', async () => {
    if (!state.inventoryItemId) throw new Error('state.inventoryItemId missing');
    const r = await http('/api/character/skill/learn-from-book', {
      method: 'POST',
      body: { inventoryItemId: state.inventoryItemId },
    });
    assertStatus(r, 404, 'POST learn-from-book consumed');
    assert(
      r.body?.error?.code === 'INVENTORY_ITEM_NOT_FOUND',
      `learn-from-book consumed: expect INVENTORY_ITEM_NOT_FOUND, got ${r.body?.error?.code}`,
    );
  });

  // ---------------------------------------------------------------------------
  // POSITIVE PATH — admin grant-currency LinhThach 200 → POST /skill/upgrade-mastery
  // → verify CurrencyLedger SKILL_UPGRADE atomic + masteryLevel L1→L2 +
  // INSUFFICIENT_FUNDS retry (post-spend, không đủ cho L2→L3 cost 400).
  //
  // Foundation từ PR #389 admin grant-currency endpoint (LinhThach BigInt-as-
  // string + reuse `currency.applyTx({ reason:'ADMIN_GRANT' })` + audit
  // `admin.currency.grant`). Service `CharacterSkillService.upgradeMastery`
  // atomic tx: read row → check max → `currency.applyTx({ delta:-cost,
  // reason:'SKILL_UPGRADE' })` → bump masteryLevel +1.
  //
  // Cost curve basic tier (skill kim_quang_tram): baseLinhThachCost=100,
  // multiplier=2.0 → masteryLevels[newLevel-1].linhThachCost. L1→L2 cần
  // masteryLevels[1].linhThachCost = 100 * 2^(2-1) = 200 LT. L2→L3 cần
  // masteryLevels[2].linhThachCost = 100 * 2^(3-1) = 400 LT.
  // ---------------------------------------------------------------------------

  // 26. Snapshot player cookies + admin login → swap → grant-currency 200 LT.
  await step('admin login + grant-currency LINH_THACH 200 (seed upgrade-mastery cost L1→L2)', async () => {
    if (!state.userId) throw new Error('state.userId missing — register chưa chạy');
    playerCookieSnap = snapshotCookies();
    cookieJar.clear();
    const login = await http('/api/_auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assertStatus(login, 200, 'admin login (upgrade-mastery seed)');
    const u = login.body?.data?.user;
    assert(u?.role === 'ADMIN', `admin login: role phải ADMIN, got ${u?.role}`);

    const grant = await http(`/api/admin/users/${state.userId}/grant-currency`, {
      method: 'POST',
      body: {
        currency: 'LINH_THACH',
        delta: '200',
        reason: 'smoke skill upgrade-mastery seed',
      },
    });
    assertStatus(grant, 200, 'admin grant-currency 200 LT');
    assert(
      grant.body?.ok === true && grant.body?.data?.ok === true,
      `grant-currency 200 LT: shape mismatch, got ${JSON.stringify(grant.body)}`,
    );

    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'admin logout (upgrade-mastery seed)');
    cookieJar.clear();
    restoreCookies(playerCookieSnap);
  });

  // 27. GET /character/me → linhThach=200 (verify grant cộng đúng).
  await step('GET /character/me — linhThach=200 post-grant (admin → player ledger)', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'GET /character/me post-grant LT');
    const ch = r.body?.data?.character;
    assert(ch, 'GET /character/me post-grant LT: missing character');
    const lt = BigInt(ch.linhThach ?? '0');
    assert(
      lt === 200n,
      `linhThach post-grant: expect 200, got ${lt}`,
    );
  });

  // 28. POST /skill/upgrade-mastery → 200 previousLevel=1 newLevel=2 spent=200.
  await step(`POST /skill/upgrade-mastery {skillKey:${LEARN_SKILL_KEY}} → 200 L1→L2 spent=200 LT`, async () => {
    const r = await http('/api/character/skill/upgrade-mastery', {
      method: 'POST',
      body: { skillKey: LEARN_SKILL_KEY },
    });
    assertStatus(r, 200, 'POST upgrade-mastery L1→L2');
    if (!r.body?.ok) throw new Error(`upgrade-mastery: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const out = r.body?.data?.upgrade;
    assert(out, 'upgrade-mastery: missing data.upgrade');
    assert(out.skillKey === LEARN_SKILL_KEY, `upgrade.skillKey: expect ${LEARN_SKILL_KEY}, got ${out.skillKey}`);
    assert(out.previousLevel === 1, `upgrade.previousLevel: expect 1, got ${out.previousLevel}`);
    assert(out.newLevel === 2, `upgrade.newLevel: expect 2, got ${out.newLevel}`);
    assert(out.linhThachSpent === 200, `upgrade.linhThachSpent: expect 200, got ${out.linhThachSpent}`);
  });

  // 29. GET /skill → kim_quang_tram.masteryLevel=2 (state update server-auth).
  await step(`GET /skill — ${LEARN_SKILL_KEY}.masteryLevel=2 post-upgrade (server-authoritative)`, async () => {
    const r = await http('/api/character/skill');
    assertStatus(r, 200, 'GET /skill post-upgrade');
    const sk = r.body?.data?.skill;
    const learned = (sk?.learned ?? []).find((/** @type {any} */ row) => row.skillKey === LEARN_SKILL_KEY);
    assert(learned, `GET /skill: thiếu ${LEARN_SKILL_KEY}`);
    assert(
      learned.masteryLevel === 2,
      `${LEARN_SKILL_KEY}.masteryLevel: expect 2 post-upgrade, got ${learned.masteryLevel}`,
    );
  });

  // 30. GET /character/me → linhThach=0 post-spend (200 - 200 = 0).
  await step('GET /character/me — linhThach=0 post-upgrade (200 LT - 200 LT)', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'GET /character/me post-upgrade');
    const ch = r.body?.data?.character;
    const lt = BigInt(ch?.linhThach ?? '0');
    assert(
      lt === 0n,
      `linhThach post-upgrade: expect 0 (200 grant - 200 spend), got ${lt}`,
    );
  });

  // 31. POST /skill/upgrade-mastery lần 2 → 402 INSUFFICIENT_FUNDS (cần 400 cho
  //     L2→L3, balance=0). Service throw INSUFFICIENT_FUNDS từ CurrencyError.
  await step(
    `POST /skill/upgrade-mastery ${LEARN_SKILL_KEY} retry → 402 INSUFFICIENT_FUNDS (cần 400 LT cho L2→L3, balance=0)`,
    async () => {
      const r = await http('/api/character/skill/upgrade-mastery', {
        method: 'POST',
        body: { skillKey: LEARN_SKILL_KEY },
      });
      assertStatus(r, 402, 'POST upgrade-mastery retry');
      assert(
        r.body?.error?.code === 'INSUFFICIENT_FUNDS',
        `upgrade-mastery retry: expect INSUFFICIENT_FUNDS, got ${r.body?.error?.code}`,
      );
    },
  );

  // 32. GET /skill — masteryLevel=2 KHÔNG đổi qua failed upgrade
  //     (anti-FE-self-grant invariant — atomic rollback khi INSUFFICIENT_FUNDS).
  await step(`GET /skill — ${LEARN_SKILL_KEY}.masteryLevel=2 vẫn giữ qua failed retry (atomic rollback)`, async () => {
    const r = await http('/api/character/skill');
    assertStatus(r, 200, 'GET /skill post-failed-upgrade');
    const sk = r.body?.data?.skill;
    const learned = (sk?.learned ?? []).find((/** @type {any} */ row) => row.skillKey === LEARN_SKILL_KEY);
    assert(
      learned?.masteryLevel === 2,
      `${LEARN_SKILL_KEY}.masteryLevel post-failed-upgrade: expect 2 (no change), got ${learned?.masteryLevel}`,
    );
  });

  // 33. logout + GET /skill → 401 UNAUTHENTICATED.
  await step('logout + GET /skill — 401 UNAUTHENTICATED', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const r = await http('/api/character/skill');
    assertStatus(r, 401, 'GET post-logout');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `GET post-logout: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:skill] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:skill] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:skill] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:skill] unexpected error:', err);
  process.exitCode = 1;
});
