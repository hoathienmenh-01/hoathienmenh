#!/usr/bin/env node
/**
 * smoke-cultivation.mjs — Cultivate toggle smoke cho Xuân Tôi.
 *
 * Mục tiêu: cover cultivate state machine end-to-end qua HTTP để đóng "smoke
 * gap" được liệt kê ở `docs/AI_HANDOFF_REPORT.md` Recommended Next Roadmap
 * (`smoke:cultivation`). Verify:
 *
 *   1. `POST /api/_auth/register`           — fresh user.
 *   2. `POST /api/character/onboard`        — fresh character (cultivating
 *                                              mặc định false theo schema
 *                                              Character.cultivating Boolean
 *                                              @default(false)).
 *   3. `GET  /api/character/me`             — verify cultivating=false initial,
 *                                              snapshot exp/realm/linhThach.
 *   4. `POST /api/character/cultivate`      — body { cultivating: true } →
 *                                              response state.cultivating=true.
 *   5. `GET  /api/character/me`             — cross-check cultivating=true
 *                                              (server-authoritative — không
 *                                              phải FE tự bật).
 *   6. `POST /api/character/cultivate`      — body { cultivating: true } lần 2
 *                                              (idempotent ON → ON) → vẫn 200
 *                                              + cultivating=true.
 *   7. `POST /api/character/cultivate`      — body { cultivating: false } →
 *                                              cultivating=false.
 *   8. `GET  /api/character/me`             — cross-check cultivating=false.
 *   9. `POST /api/character/cultivate`      — body { cultivating: false } lần
 *                                              2 (idempotent OFF → OFF) → vẫn
 *                                              200 + cultivating=false.
 *  10. `POST /api/character/cultivate`      — body { cultivating: 'invalid' }
 *                                              → 400 INVALID_INPUT (Zod gate).
 *  11. `POST /api/character/cultivate`      — body {} (missing cultivating)
 *                                              → 400 INVALID_INPUT.
 *
 * Cộng thêm character invariant (anti-FE-self-grant per Luật bắt buộc — KHÔNG
 * để frontend tự cộng EXP/tiền/level qua cultivate toggle):
 *   - `exp` không thay đổi giữa các toggle (smoke chạy ~1s, cultivation tick
 *     30s nên BullMQ chưa fire — exp deterministic từ onboard).
 *   - `realmTier`/`level` (hoặc các realm progress field) không thay đổi qua
 *     toggle (chỉ breakthrough endpoint mới đẩy realm).
 *   - `linhThach` không thay đổi qua toggle (chỉ shop/loot/topup mới đẩy LT).
 *
 * Anti-auth invariant:
 *   - Logout → POST /cultivate → 401 UNAUTHENTICATED (cookie cleared).
 *
 * Chạy:
 *   pnpm smoke:cultivation
 *   # hoặc trực tiếp:
 *   node scripts/smoke-cultivation.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE   — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS — default 10000ms / request.
 *   SMOKE_VERBOSE    — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY   — default "thanh_van" (có thể "huyen_thuy" / "tu_la").
 *
 * Yêu cầu môi trường (giống smoke:economy / smoke:combat):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api bootstrap` (seed 3 sect)
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:cultivation`
 *
 * KHÔNG yêu cầu admin login. KHÔNG đụng payment thật. KHÔNG mutate DB ngoài
 * user mới do chính smoke tạo (random email + character name).
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
  process.stdout.write(`[smoke:cultivation] ${name} ... `);
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
  return `smoke-cultivation-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `cult_${rand}`;
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

/**
 * @type {{
 *   email?: string;
 *   userId?: string;
 *   characterId?: string;
 *   startingExp?: string;
 *   startingLinhThach?: string;
 *   startingRealmTier?: number;
 *   startingLevel?: number;
 * }}
 */
const state = {};

/**
 * Helper: extract subset of immutable fields from character row để compare
 * giữa các step (đảm bảo cultivate toggle KHÔNG đụng các field này).
 * @param {any} ch
 */
function snapshotImmutable(ch) {
  return {
    exp: String(ch.exp ?? ''),
    linhThach: String(ch.linhThach ?? ''),
    realmTier: typeof ch.realmTier === 'number' ? ch.realmTier : null,
    level: typeof ch.level === 'number' ? ch.level : null,
  };
}

/**
 * Helper: assert 2 snapshot bằng nhau hoặc throw.
 * @param {ReturnType<typeof snapshotImmutable>} before
 * @param {ReturnType<typeof snapshotImmutable>} after
 * @param {string} label
 */
function assertImmutable(before, after, label) {
  for (const key of /** @type {const} */ (['exp', 'linhThach', 'realmTier', 'level'])) {
    if (before[key] !== after[key]) {
      throw new Error(
        `${label}: field ${key} thay đổi qua cultivate toggle (anti-FE-self-grant): before=${before[key]} after=${after[key]}`,
      );
    }
  }
}

async function main() {
  console.log(`[smoke:cultivation] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}`);

  // 1. Register fresh user.
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

  // 2. Onboard → tạo character (cultivating mặc định false).
  await step('onboard — create character (cultivating default=false)', async () => {
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
    assert(
      ch.cultivating === false,
      `onboard: cultivating mặc định phải = false (Character schema @default(false)), got ${ch.cultivating}`,
    );
  });

  // 3. Snapshot starting character state (immutable fields cho anti-FE-grant).
  /** @type {ReturnType<typeof snapshotImmutable>} */
  let initialSnapshot;
  await step('character/me — snapshot starting state', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me: no character in body');
    assert(
      ch.cultivating === false,
      `character/me: starting cultivating phải = false, got ${ch.cultivating}`,
    );
    initialSnapshot = snapshotImmutable(ch);
    state.startingExp = initialSnapshot.exp;
    state.startingLinhThach = initialSnapshot.linhThach;
    state.startingRealmTier = initialSnapshot.realmTier ?? undefined;
    state.startingLevel = initialSnapshot.level ?? undefined;
  });

  // 4. POST /cultivate { cultivating: true } → cultivating=true (server-auth).
  await step('cultivate ON — toggle false → true', async () => {
    const r = await http('/api/character/cultivate', {
      method: 'POST',
      body: { cultivating: true },
    });
    assertStatus(r, 200, 'cultivate ON');
    if (!r.body?.ok) throw new Error(`cultivate ON: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const ch = r.body?.data?.character;
    assert(ch, 'cultivate ON: missing character in response');
    assert(
      ch.cultivating === true,
      `cultivate ON: response cultivating phải = true, got ${ch.cultivating}`,
    );
    // Anti FE-self-grant: response không cộng exp/linhThach/realm.
    assertImmutable(initialSnapshot, snapshotImmutable(ch), 'cultivate ON response');
  });

  // 5. character/me — cross-check cultivating=true (server-authoritative).
  await step('character/me — verify cultivating=true post-toggle ON', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me: no character');
    assert(
      ch.cultivating === true,
      `character/me: cultivating phải = true post-toggle ON, got ${ch.cultivating}`,
    );
    assertImmutable(initialSnapshot, snapshotImmutable(ch), 'character/me post-ON');
  });

  // 6. Idempotent toggle ON → ON (vẫn ok, vẫn cultivating=true).
  await step('cultivate ON idempotent — true → true vẫn ok', async () => {
    const r = await http('/api/character/cultivate', {
      method: 'POST',
      body: { cultivating: true },
    });
    assertStatus(r, 200, 'cultivate ON idempotent');
    if (!r.body?.ok) {
      throw new Error(`cultivate ON idempotent: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    }
    const ch = r.body?.data?.character;
    assert(ch, 'cultivate ON idempotent: missing character');
    assert(
      ch.cultivating === true,
      `cultivate ON idempotent: cultivating phải = true, got ${ch.cultivating}`,
    );
    assertImmutable(initialSnapshot, snapshotImmutable(ch), 'cultivate ON idempotent');
  });

  // 7. POST /cultivate { cultivating: false } → cultivating=false.
  await step('cultivate OFF — toggle true → false', async () => {
    const r = await http('/api/character/cultivate', {
      method: 'POST',
      body: { cultivating: false },
    });
    assertStatus(r, 200, 'cultivate OFF');
    if (!r.body?.ok) throw new Error(`cultivate OFF: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const ch = r.body?.data?.character;
    assert(ch, 'cultivate OFF: missing character');
    assert(
      ch.cultivating === false,
      `cultivate OFF: response cultivating phải = false, got ${ch.cultivating}`,
    );
    assertImmutable(initialSnapshot, snapshotImmutable(ch), 'cultivate OFF response');
  });

  // 8. character/me — cross-check cultivating=false post-OFF.
  await step('character/me — verify cultivating=false post-toggle OFF', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me: no character');
    assert(
      ch.cultivating === false,
      `character/me: cultivating phải = false post-toggle OFF, got ${ch.cultivating}`,
    );
    assertImmutable(initialSnapshot, snapshotImmutable(ch), 'character/me post-OFF');
  });

  // 9. Idempotent toggle OFF → OFF.
  await step('cultivate OFF idempotent — false → false vẫn ok', async () => {
    const r = await http('/api/character/cultivate', {
      method: 'POST',
      body: { cultivating: false },
    });
    assertStatus(r, 200, 'cultivate OFF idempotent');
    if (!r.body?.ok) {
      throw new Error(`cultivate OFF idempotent: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    }
    const ch = r.body?.data?.character;
    assert(ch, 'cultivate OFF idempotent: missing character');
    assert(
      ch.cultivating === false,
      `cultivate OFF idempotent: cultivating phải = false, got ${ch.cultivating}`,
    );
    assertImmutable(initialSnapshot, snapshotImmutable(ch), 'cultivate OFF idempotent');
  });

  // 10. Malformed body { cultivating: 'invalid' } → 400 INVALID_INPUT.
  await step('cultivate — body { cultivating: "invalid" } → 400 INVALID_INPUT', async () => {
    const r = await http('/api/character/cultivate', {
      method: 'POST',
      body: { cultivating: 'invalid' },
    });
    assertStatus(r, 400, 'cultivate invalid type');
    const code = r.body?.error?.code;
    assert(
      code === 'INVALID_INPUT',
      `cultivate invalid type: expect error.code=INVALID_INPUT, got ${code}`,
    );
  });

  // 11. Missing cultivating field → 400 INVALID_INPUT.
  await step('cultivate — body {} (missing cultivating) → 400 INVALID_INPUT', async () => {
    const r = await http('/api/character/cultivate', {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 400, 'cultivate missing field');
    const code = r.body?.error?.code;
    assert(
      code === 'INVALID_INPUT',
      `cultivate missing field: expect error.code=INVALID_INPUT, got ${code}`,
    );
  });

  // 12. Logout → cookie cleared → cultivate → 401 UNAUTHENTICATED.
  await step('logout + cultivate without auth → 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(r, 200, 'logout');
    cookieJar.clear();
    const r2 = await http('/api/character/cultivate', {
      method: 'POST',
      body: { cultivating: true },
    });
    assertStatus(r2, 401, 'cultivate post-logout');
    const code = r2.body?.error?.code;
    assert(
      code === 'UNAUTHENTICATED',
      `cultivate post-logout: expect error.code=UNAUTHENTICATED, got ${code}`,
    );
  });
}

// -----------------------------------------------------------------------------
// Run.
// -----------------------------------------------------------------------------

main()
  .catch((err) => {
    console.error(`[smoke:cultivation] fatal: ${err instanceof Error ? err.message : String(err)}`);
    results.push({ name: 'fatal', ok: false, note: String(err) });
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok);
    console.log('');
    console.log(`[smoke:cultivation] ${results.length - failed.length}/${results.length} steps OK`);
    for (const r of failed) {
      console.log(`  ✗ ${r.name}: ${r.note ?? 'unknown'}`);
    }
    process.exit(failed.length === 0 ? 0 : 1);
  });
