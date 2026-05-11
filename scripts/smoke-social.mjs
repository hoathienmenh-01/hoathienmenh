#!/usr/bin/env node
/**
 * smoke-social.mjs — Social system smoke cho Xuân Tôi (Phase 24.1).
 *
 * Cover Phase 19.1 Social Foundation endpoints qua HTTP
 * (`apps/api/src/modules/social/social.controller.ts`):
 *
 *   - `GET    /api/social/friends`                     — list friends.
 *   - `GET    /api/social/friend-requests/incoming`    — list incoming.
 *   - `GET    /api/social/friend-requests/outgoing`    — list outgoing.
 *   - `GET    /api/social/profile/:userId`             — public profile.
 *   - `POST   /api/social/friend-requests`             — send friend request.
 *   - `POST   /api/social/friend-requests/:id/accept`  — accept.
 *   - `POST   /api/social/friend-requests/:id/decline` — decline.
 *   - `DELETE /api/social/friend-requests/:id`         — cancel.
 *   - `DELETE /api/social/friends/:friendUserId`       — remove friend.
 *   - `GET    /api/social/blocks`                      — list blocked players.
 *   - `POST   /api/social/block`                       — block a user.
 *   - `DELETE /api/social/block/:userId`               — unblock a user.
 *
 * Mục tiêu: closed-beta regression check — golden path đầy đủ flow friend
 * (send → accept → remove) + block flow (block → unblock) + self-protect
 * contract (SELF_NOT_ALLOWED).
 *
 * KHÔNG cover deep invariant (rate-limit, abuse block, presence) — defer
 * cho future targeted smoke / unit test. Smoke này nặng về 200/4xx
 * contract chứ không invariant.
 *
 * Chạy:
 *   pnpm smoke:social
 *   # hoặc trực tiếp:
 *   node scripts/smoke-social.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE   — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS — default 10000ms / request.
 *   SMOKE_VERBOSE    — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY   — default "thanh_van".
 *
 * Yêu cầu môi trường:
 *   - `pnpm infra:up` (Postgres + Redis).
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`.
 *   - `pnpm --filter @xuantoi/api bootstrap` (seed 3 sect).
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000).
 *   - Tab khác: `pnpm smoke:social`.
 *
 * Graceful skip: nếu `/api/healthz` không reachable → exit 0 với
 * `SKIP — infra unavailable` thay vì fail PR CI. Closed-beta CI env có
 * thể không bring up full stack, nên smoke phải tolerant.
 *
 * Exit code:
 *   0 — toàn bộ step PASS (hoặc SKIP do infra unavailable ngay từ healthz).
 *   1 — ít nhất 1 step fail sau khi healthz đã PASS.
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
// Cookie jar per-user — smoke này dùng 2 user nên cần 2 jar tách biệt.
// -----------------------------------------------------------------------------

/** @typedef {Map<string,string>} CookieJar */

/** @returns {CookieJar} */
function newJar() {
  return new Map();
}

/**
 * @param {CookieJar} jar
 * @param {Response} res
 */
function storeSetCookie(jar, res) {
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
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
}

/** @param {CookieJar} jar */
function cookieHeader(jar) {
  if (jar.size === 0) return undefined;
  return Array.from(jar, ([k, v]) => `${k}=${v}`).join('; ');
}

// -----------------------------------------------------------------------------
// HTTP helper với cookie jar per-user.
// -----------------------------------------------------------------------------

/**
 * @param {CookieJar} jar
 * @param {string} path
 * @param {{ method?: string; body?: unknown }} [opts]
 * @returns {Promise<{ status: number; body: any }>}
 */
async function http(jar, path, opts = {}) {
  const url = `${BASE}${path}`;
  const method = opts.method ?? 'GET';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  /** @type {Record<string,string>} */
  const headers = { Accept: 'application/json' };
  const cookieH = cookieHeader(jar);
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
    storeSetCookie(jar, res);
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
let skippedAll = false;

/**
 * @param {string} name
 * @param {() => Promise<void | { skip: true; note: string }>} fn
 */
async function step(name, fn) {
  if (skippedAll) {
    results.push({ name, ok: true, note: 'SKIP infra unavailable' });
    return;
  }
  process.stdout.write(`[smoke:social] ${name} ... `);
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

function randomEmail(prefix) {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `smoke-${prefix}-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName(prefix) {
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${rand}`;
}

// -----------------------------------------------------------------------------
// User helper: register + onboard.
// -----------------------------------------------------------------------------

/**
 * @param {string} label
 * @returns {Promise<{ jar: CookieJar; email: string; userId: string; characterId: string }>}
 */
async function registerAndOnboard(label) {
  const jar = newJar();
  const email = randomEmail(label);
  const password = randomPassword();
  const r = await http(jar, '/api/_auth/register', {
    method: 'POST',
    body: { email, password },
  });
  assertStatus(r, [200, 201], `register ${label}`);
  assert(r.body?.ok, `register ${label}: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
  const userId = r.body?.data?.user?.id;
  assert(typeof userId === 'string' && userId.length > 0, `register ${label}: missing userId`);

  const r2 = await http(jar, '/api/character/onboard', {
    method: 'POST',
    body: { name: randomCharName(label), sectKey: SECT_KEY },
  });
  assertStatus(r2, [200, 201], `onboard ${label}`);
  assert(r2.body?.ok, `onboard ${label}: ok=false body=${JSON.stringify(r2.body).slice(0, 200)}`);
  const characterId = r2.body?.data?.character?.id ?? r2.body?.data?.id;
  assert(
    typeof characterId === 'string' && characterId.length > 0,
    `onboard ${label}: missing characterId`,
  );
  return { jar, email, userId, characterId };
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

/**
 * @type {{
 *   alice?: { jar: CookieJar; email: string; userId: string; characterId: string };
 *   bob?: { jar: CookieJar; email: string; userId: string; characterId: string };
 *   pendingRequestId?: string;
 * }}
 */
const state = {};

async function main() {
  console.log(`[smoke:social] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms`);

  // 0. Health check — graceful skip nếu API không lên.
  try {
    const r = await http(newJar(), '/api/healthz');
    if (r.status !== 200) {
      console.log(`[smoke:social] SKIP — /api/healthz status=${r.status}, infra unavailable`);
      skippedAll = true;
    }
  } catch (e) {
    console.log(`[smoke:social] SKIP — /api/healthz unreachable (${e?.message ?? e})`);
    skippedAll = true;
  }
  if (skippedAll) {
    results.push({ name: 'healthz', ok: true, note: 'SKIP infra unavailable' });
    return;
  }
  results.push({ name: 'healthz', ok: true });

  // 1. Register + onboard 2 users (Alice = sender, Bob = receiver).
  await step('register+onboard Alice', async () => {
    state.alice = await registerAndOnboard('alice');
  });
  await step('register+onboard Bob', async () => {
    state.bob = await registerAndOnboard('bob');
  });
  if (!state.alice || !state.bob) return;

  // 2. listFriends fresh users — both empty.
  await step('GET /social/friends — Alice empty', async () => {
    const r = await http(state.alice.jar, '/api/social/friends');
    assertStatus(r, 200, 'social/friends Alice');
    const friends = r.body?.data?.friends;
    assert(Array.isArray(friends), 'friends phải array');
    assert(friends.length === 0, `Alice fresh user phải có 0 friend, got ${friends.length}`);
  });

  await step('GET /social/friends — Bob empty', async () => {
    const r = await http(state.bob.jar, '/api/social/friends');
    assertStatus(r, 200, 'social/friends Bob');
    const friends = r.body?.data?.friends;
    assert(Array.isArray(friends), 'friends phải array');
    assert(friends.length === 0, `Bob fresh user phải có 0 friend, got ${friends.length}`);
  });

  // 3. Self-friend reject.
  await step('POST /social/friend-requests — self → SELF_NOT_ALLOWED', async () => {
    const r = await http(state.alice.jar, '/api/social/friend-requests', {
      method: 'POST',
      body: { receiverUserId: state.alice.userId },
    });
    assertStatus(r, 400, 'self friend request');
    assert(
      r.body?.error?.code === 'SELF_NOT_ALLOWED',
      `expect error.code=SELF_NOT_ALLOWED, got ${r.body?.error?.code}`,
    );
  });

  // 4. Alice send friend request to Bob.
  await step('POST /social/friend-requests — Alice → Bob', async () => {
    const r = await http(state.alice.jar, '/api/social/friend-requests', {
      method: 'POST',
      body: { receiverUserId: state.bob.userId, message: 'smoke test' },
    });
    assertStatus(r, 200, 'send friend request');
    const req = r.body?.data?.request;
    assert(req && typeof req.id === 'string', 'friend request: missing id');
    state.pendingRequestId = req.id;
  });

  // 5. Alice outgoing contains the request.
  await step('GET /social/friend-requests/outgoing — Alice has 1', async () => {
    const r = await http(state.alice.jar, '/api/social/friend-requests/outgoing');
    assertStatus(r, 200, 'outgoing');
    const requests = r.body?.data?.requests;
    assert(Array.isArray(requests), 'outgoing.requests phải array');
    assert(requests.length >= 1, `Alice outgoing phải >= 1, got ${requests.length}`);
    const found = requests.find((x) => x.id === state.pendingRequestId);
    assert(found, `outgoing không chứa request id=${state.pendingRequestId}`);
  });

  // 6. Bob incoming contains the request.
  await step('GET /social/friend-requests/incoming — Bob has 1', async () => {
    const r = await http(state.bob.jar, '/api/social/friend-requests/incoming');
    assertStatus(r, 200, 'incoming');
    const requests = r.body?.data?.requests;
    assert(Array.isArray(requests), 'incoming.requests phải array');
    assert(requests.length >= 1, `Bob incoming phải >= 1, got ${requests.length}`);
    const found = requests.find((x) => x.id === state.pendingRequestId);
    assert(found, `incoming không chứa request id=${state.pendingRequestId}`);
  });

  // 7. Bob accept the request.
  await step('POST /social/friend-requests/:id/accept — Bob accept', async () => {
    const r = await http(
      state.bob.jar,
      `/api/social/friend-requests/${encodeURIComponent(state.pendingRequestId)}/accept`,
      { method: 'POST' },
    );
    assertStatus(r, 200, 'accept');
    assert(r.body?.ok, `accept: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const friendUserId = r.body?.data?.friendUserId;
    assert(
      friendUserId === state.alice.userId,
      `accept: friendUserId expect=${state.alice.userId}, got=${friendUserId}`,
    );
  });

  // 8. Both Alice and Bob now have each other as friend.
  await step('GET /social/friends — Alice has Bob', async () => {
    const r = await http(state.alice.jar, '/api/social/friends');
    assertStatus(r, 200, 'friends Alice after accept');
    const friends = r.body?.data?.friends;
    assert(friends.length >= 1, `Alice expect >= 1 friend, got ${friends.length}`);
    const found = friends.find((x) => x.userId === state.bob.userId);
    assert(found, `Alice friends KHÔNG chứa Bob.userId=${state.bob.userId}`);
  });

  await step('GET /social/friends — Bob has Alice', async () => {
    const r = await http(state.bob.jar, '/api/social/friends');
    assertStatus(r, 200, 'friends Bob after accept');
    const friends = r.body?.data?.friends;
    assert(friends.length >= 1, `Bob expect >= 1 friend, got ${friends.length}`);
    const found = friends.find((x) => x.userId === state.alice.userId);
    assert(found, `Bob friends KHÔNG chứa Alice.userId=${state.alice.userId}`);
  });

  // 9. Public profile fetch.
  await step('GET /social/profile/:userId — Alice view Bob', async () => {
    const r = await http(
      state.alice.jar,
      `/api/social/profile/${encodeURIComponent(state.bob.userId)}`,
    );
    assertStatus(r, 200, 'public profile');
    const profile = r.body?.data?.profile;
    assert(profile && typeof profile === 'object', 'public profile: missing profile object');
  });

  // 10. Remove friend.
  await step('DELETE /social/friends/:friendUserId — Alice removes Bob', async () => {
    const r = await http(
      state.alice.jar,
      `/api/social/friends/${encodeURIComponent(state.bob.userId)}`,
      { method: 'DELETE' },
    );
    assertStatus(r, 200, 'remove friend');
    assert(r.body?.ok, `remove friend: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
  });

  await step('GET /social/friends — Alice friend list empty after remove', async () => {
    const r = await http(state.alice.jar, '/api/social/friends');
    assertStatus(r, 200, 'friends Alice after remove');
    const friends = r.body?.data?.friends;
    const found = friends.find((x) => x.userId === state.bob.userId);
    assert(!found, `Alice friends VẪN chứa Bob sau remove, có ${friends.length} friend`);
  });

  // 11. Self-block reject.
  await step('POST /social/block — self → SELF_NOT_ALLOWED', async () => {
    const r = await http(state.alice.jar, '/api/social/block', {
      method: 'POST',
      body: { userId: state.alice.userId },
    });
    assertStatus(r, 400, 'self block');
    assert(
      r.body?.error?.code === 'SELF_NOT_ALLOWED',
      `expect error.code=SELF_NOT_ALLOWED, got ${r.body?.error?.code}`,
    );
  });

  // 12. Block + list + unblock.
  await step('POST /social/block — Alice blocks Bob', async () => {
    const r = await http(state.alice.jar, '/api/social/block', {
      method: 'POST',
      body: { userId: state.bob.userId },
    });
    assertStatus(r, [200, 201], 'block');
    assert(r.body?.ok, `block: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
  });

  await step('GET /social/blocks — Alice blocks list contains Bob', async () => {
    const r = await http(state.alice.jar, '/api/social/blocks');
    assertStatus(r, 200, 'blocks list');
    const blocks = r.body?.data?.blocks;
    assert(Array.isArray(blocks), 'blocks phải array');
    const found = blocks.find((x) => x.userId === state.bob.userId);
    assert(found, `Alice blocks KHÔNG chứa Bob sau block`);
  });

  await step('DELETE /social/block/:userId — Alice unblocks Bob', async () => {
    const r = await http(
      state.alice.jar,
      `/api/social/block/${encodeURIComponent(state.bob.userId)}`,
      { method: 'DELETE' },
    );
    assertStatus(r, 200, 'unblock');
    assert(r.body?.ok, `unblock: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
  });

  await step('GET /social/blocks — Alice blocks list empty after unblock', async () => {
    const r = await http(state.alice.jar, '/api/social/blocks');
    assertStatus(r, 200, 'blocks list after unblock');
    const blocks = r.body?.data?.blocks;
    const found = blocks.find((x) => x.userId === state.bob.userId);
    assert(!found, `Alice blocks VẪN chứa Bob sau unblock`);
  });

  // 13. Auth check — unauth GET /friends → 401.
  await step('GET /social/friends (no auth) → 401', async () => {
    const r = await http(newJar(), '/api/social/friends');
    assertStatus(r, 401, 'no-auth friends');
  });

  // 14. Logout cleanup.
  await step('logout Alice', async () => {
    const r = await http(state.alice.jar, '/api/_auth/logout', { method: 'POST' });
    assertStatus(r, [200, 201], 'logout Alice');
  });
  await step('logout Bob', async () => {
    const r = await http(state.bob.jar, '/api/_auth/logout', { method: 'POST' });
    assertStatus(r, [200, 201], 'logout Bob');
  });
}

// -----------------------------------------------------------------------------
// Entrypoint.
// -----------------------------------------------------------------------------

const startedAt = Date.now();
main()
  .catch((err) => {
    console.error('[smoke:social] FATAL:', err);
    results.push({ name: 'fatal', ok: false, note: String(err) });
  })
  .finally(() => {
    const elapsed = Date.now() - startedAt;
    const pass = results.filter((r) => r.ok).length;
    const fail = results.filter((r) => !r.ok).length;
    const skip = results.filter((r) => r.ok && (r.note ?? '').startsWith('SKIP')).length;
    console.log(
      `\n[smoke:social] done: ${pass} pass (${skip} skip) / ${fail} fail / ${results.length} total in ${elapsed}ms`,
    );
    if (fail > 0) {
      console.error('[smoke:social] failed steps:');
      for (const r of results.filter((x) => !x.ok)) {
        console.error(`  - ${r.name}: ${r.note}`);
      }
      process.exit(1);
    }
    process.exit(0);
  });
