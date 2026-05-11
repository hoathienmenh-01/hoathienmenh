#!/usr/bin/env node
/**
 * smoke-coop.mjs — Co-op (party + party-dungeon + co-op boss + reward cap)
 * smoke cho Xuân Tôi (Phase 24.1).
 *
 * Cover golden path / contract Phase 19.4 + 20.1 + 20.2 + 20.3:
 *
 *   - `GET    /api/party/me`                          — current party.
 *   - `POST   /api/party`                             — create party.
 *   - `POST   /api/party/invites`                     — invite user.
 *   - `GET    /api/party/invites/incoming`            — list incoming invites.
 *   - `GET    /api/party/invites/outgoing`            — list outgoing invites.
 *   - `POST   /api/party/invites/:id/accept`          — accept invite.
 *   - `POST   /api/party/leave`                       — leave party.
 *   - `POST   /api/party/disband`                     — disband party.
 *   - `GET    /api/coop/rewards/status`               — daily/weekly cap status.
 *   - `GET    /api/coop/rewards/weekly-leaderboard`   — current week leaderboard.
 *
 * Mục tiêu: closed-beta regression check — golden path party (create →
 * invite → accept → leave → disband) + read-only coop reward cap +
 * weekly leaderboard contract (200 + shape).
 *
 * KHÔNG cover party-dungeon `/start` (cần full character stamina + party
 * size ≥ 2 ready + stamina entry + DB seeds — defer cho e2e-full), KHÔNG
 * cover coop-boss `createRun`/`finishRun` (cần boss key valid + party
 * size + reward grant flow — defer cho deep targeted smoke).
 *
 * Chạy:
 *   pnpm smoke:coop
 *   # hoặc trực tiếp:
 *   node scripts/smoke-coop.mjs
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
 *   - Tab khác: `pnpm smoke:coop`.
 *
 * Graceful skip: nếu `/api/healthz` không reachable → exit 0 với
 * `SKIP — infra unavailable` thay vì fail PR CI.
 *
 * Exit code:
 *   0 — toàn bộ step PASS (hoặc SKIP do infra unavailable).
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
// Cookie jar per-user.
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
// HTTP helper.
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
  process.stdout.write(`[smoke:coop] ${name} ... `);
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
// User helper.
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
 *   leader?: { jar: CookieJar; email: string; userId: string; characterId: string };
 *   member?: { jar: CookieJar; email: string; userId: string; characterId: string };
 *   partyId?: string;
 *   inviteId?: string;
 * }}
 */
const state = {};

async function main() {
  console.log(`[smoke:coop] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms`);

  // 0. Health check — graceful skip nếu API không lên.
  try {
    const r = await http(newJar(), '/api/healthz');
    if (r.status !== 200) {
      console.log(`[smoke:coop] SKIP — /api/healthz status=${r.status}, infra unavailable`);
      skippedAll = true;
    }
  } catch (e) {
    console.log(`[smoke:coop] SKIP — /api/healthz unreachable (${e?.message ?? e})`);
    skippedAll = true;
  }
  if (skippedAll) {
    results.push({ name: 'healthz', ok: true, note: 'SKIP infra unavailable' });
    return;
  }
  results.push({ name: 'healthz', ok: true });

  // 1. Register + onboard 2 users.
  await step('register+onboard Leader', async () => {
    state.leader = await registerAndOnboard('leader');
  });
  await step('register+onboard Member', async () => {
    state.member = await registerAndOnboard('member');
  });
  if (!state.leader || !state.member) return;

  // 2. Auth check — unauth GET /party/me → 401.
  await step('GET /party/me (no auth) → 401', async () => {
    const r = await http(newJar(), '/api/party/me');
    assertStatus(r, 401, 'no-auth party/me');
  });

  // 3. Leader: party/me fresh user → null.
  await step('GET /party/me — Leader has no party initially', async () => {
    const r = await http(state.leader.jar, '/api/party/me');
    assertStatus(r, 200, 'party/me Leader');
    const party = r.body?.data?.party;
    assert(party === null || party === undefined, 'fresh user phải có party=null');
  });

  // 4. Leader creates party.
  await step('POST /party — Leader create', async () => {
    const r = await http(state.leader.jar, '/api/party', {
      method: 'POST',
      body: { name: 'smoke-party' },
    });
    assertStatus(r, [200, 201], 'create party');
    const party = r.body?.data?.party;
    assert(party && typeof party.id === 'string', 'create party: missing party.id');
    state.partyId = party.id;
  });

  // 5. Party member list contains Leader.
  await step('GET /party/me — after create has Leader', async () => {
    const r = await http(state.leader.jar, '/api/party/me');
    assertStatus(r, 200, 'party/me after create');
    const party = r.body?.data?.party;
    assert(party && party.id === state.partyId, `party.id mismatch ${party?.id} vs ${state.partyId}`);
  });

  // 6. Leader invites Member.
  await step('POST /party/invites — Leader invites Member', async () => {
    const r = await http(state.leader.jar, '/api/party/invites', {
      method: 'POST',
      body: { inviteeUserId: state.member.userId },
    });
    assertStatus(r, [200, 201], 'invite');
    const invite = r.body?.data?.invite;
    assert(invite && typeof invite.id === 'string', 'invite: missing id');
    state.inviteId = invite.id;
  });

  // 7. Member sees incoming invite.
  await step('GET /party/invites/incoming — Member has 1', async () => {
    const r = await http(state.member.jar, '/api/party/invites/incoming');
    assertStatus(r, 200, 'invites/incoming');
    const invites = r.body?.data?.invites;
    assert(Array.isArray(invites), 'invites phải array');
    const found = invites.find((x) => x.id === state.inviteId);
    assert(found, `Member incoming KHÔNG chứa invite id=${state.inviteId}`);
  });

  // 8. Member accepts.
  await step('POST /party/invites/:id/accept — Member accept', async () => {
    const r = await http(
      state.member.jar,
      `/api/party/invites/${encodeURIComponent(state.inviteId)}/accept`,
      { method: 'POST' },
    );
    assertStatus(r, 200, 'accept invite');
    assert(r.body?.ok, `accept: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
  });

  // 9. Member's party/me now points to same partyId.
  await step('GET /party/me — Member now in party', async () => {
    const r = await http(state.member.jar, '/api/party/me');
    assertStatus(r, 200, 'party/me Member after accept');
    const party = r.body?.data?.party;
    assert(party && party.id === state.partyId, `Member party.id mismatch ${party?.id} vs ${state.partyId}`);
  });

  // 10. Party members list contains both.
  await step('GET /party/members — has Leader + Member', async () => {
    const r = await http(state.leader.jar, '/api/party/members');
    assertStatus(r, 200, 'party/members');
    const members = r.body?.data?.members;
    assert(Array.isArray(members), 'members phải array');
    assert(members.length >= 2, `expect >= 2 members, got ${members.length}`);
    const hasLeader = members.find((m) => m.userId === state.leader.userId);
    const hasMember = members.find((m) => m.userId === state.member.userId);
    assert(hasLeader, 'members KHÔNG chứa Leader');
    assert(hasMember, 'members KHÔNG chứa Member');
  });

  // 11. Member leaves.
  await step('POST /party/leave — Member leave', async () => {
    const r = await http(state.member.jar, '/api/party/leave', { method: 'POST' });
    assertStatus(r, 200, 'leave');
    assert(r.body?.ok, `leave: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
  });

  await step('GET /party/me — Member no party after leave', async () => {
    const r = await http(state.member.jar, '/api/party/me');
    assertStatus(r, 200, 'party/me Member after leave');
    const party = r.body?.data?.party;
    assert(!party, `Member VẪN có party sau leave: ${JSON.stringify(party).slice(0, 100)}`);
  });

  // 12. Leader disbands.
  await step('POST /party/disband — Leader disband', async () => {
    const r = await http(state.leader.jar, '/api/party/disband', { method: 'POST' });
    assertStatus(r, 200, 'disband');
    assert(r.body?.ok, `disband: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
  });

  await step('GET /party/me — Leader no party after disband', async () => {
    const r = await http(state.leader.jar, '/api/party/me');
    assertStatus(r, 200, 'party/me Leader after disband');
    const party = r.body?.data?.party;
    assert(!party, `Leader VẪN có party sau disband: ${JSON.stringify(party).slice(0, 100)}`);
  });

  // 13. Coop reward cap status (Phase 20.3) read-only.
  await step('GET /coop/rewards/status — Leader read-only', async () => {
    const r = await http(state.leader.jar, '/api/coop/rewards/status');
    assertStatus(r, 200, 'coop/rewards/status');
    const data = r.body?.data;
    assert(data && typeof data === 'object', 'status: missing data');
  });

  // 14. Coop weekly leaderboard (Phase 20.3) read-only.
  await step('GET /coop/rewards/weekly-leaderboard — read-only', async () => {
    const r = await http(state.leader.jar, '/api/coop/rewards/weekly-leaderboard');
    // 200 với leaderboard có thể empty ngoài season hoặc fresh user.
    // 404 cũng OK nếu season chưa mở (closed-beta env).
    assertStatus(r, [200, 404], 'coop/rewards/weekly-leaderboard');
    if (r.status === 200) {
      const data = r.body?.data;
      assert(data && typeof data === 'object', 'leaderboard: missing data');
    }
  });

  // 15. Logout cleanup.
  await step('logout Leader', async () => {
    const r = await http(state.leader.jar, '/api/_auth/logout', { method: 'POST' });
    assertStatus(r, [200, 201], 'logout Leader');
  });
  await step('logout Member', async () => {
    const r = await http(state.member.jar, '/api/_auth/logout', { method: 'POST' });
    assertStatus(r, [200, 201], 'logout Member');
  });
}

// -----------------------------------------------------------------------------
// Entrypoint.
// -----------------------------------------------------------------------------

const startedAt = Date.now();
main()
  .catch((err) => {
    console.error('[smoke:coop] FATAL:', err);
    results.push({ name: 'fatal', ok: false, note: String(err) });
  })
  .finally(() => {
    const elapsed = Date.now() - startedAt;
    const pass = results.filter((r) => r.ok).length;
    const fail = results.filter((r) => !r.ok).length;
    const skip = results.filter((r) => r.ok && (r.note ?? '').startsWith('SKIP')).length;
    console.log(
      `\n[smoke:coop] done: ${pass} pass (${skip} skip) / ${fail} fail / ${results.length} total in ${elapsed}ms`,
    );
    if (fail > 0) {
      console.error('[smoke:coop] failed steps:');
      for (const r of results.filter((x) => !x.ok)) {
        console.error(`  - ${r.name}: ${r.note}`);
      }
      process.exit(1);
    }
    process.exit(0);
  });
