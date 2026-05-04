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
 * Smoke này KHÔNG cần admin seed → chỉ cover lazy auto-grant idempotent +
 * negative paths. Full positive path (upgrade-mastery với character có ≥100
 * LinhThach + equip skill khác sau khi học qua dungeon drop / sect grant /
 * skill book consume) yêu cầu admin seed `Character.linhThach` HOẶC
 * `CharacterSkill` row source='dungeon_drop'/'admin'/'skill_book' — defer cho
 * future smoke với admin secret.
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
 *  16. `POST /api/_auth/logout` + GET /skill                     → 401.
 *
 * Anti-FE-self-grant invariant (per Luật bắt buộc — KHÔNG để frontend tự cộng
 * skill / mastery / equip slot qua failed attempts):
 *   - `learnedKeys` (sorted joined) KHÔNG đổi qua failed equip/unequip/upgrade.
 *   - `equippedKeys` (sorted joined) KHÔNG đổi.
 *   - `masteryLevels` (joined per skill) KHÔNG đổi qua failed upgrade-mastery.
 *
 * Chạy:
 *   pnpm smoke:skill
 *   # hoặc trực tiếp:
 *   node scripts/smoke-skill.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE     — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS   — default 10000ms / request.
 *   SMOKE_VERBOSE      — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY     — default "thanh_van".
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
    assert(r.body?.data?.user?.id, 'register: missing user.id');
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

  // 16. logout + GET /skill → 401 UNAUTHENTICATED.
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
