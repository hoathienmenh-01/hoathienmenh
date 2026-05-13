#!/usr/bin/env node
/**
 * stress-concurrent-claim.mjs — P2.1 Concurrency stress: mail claim race.
 *
 * Mục tiêu: spawn N parallel `POST /mail/:id/claim` for cùng mail ID, verify
 * race-safe CAS (`Mail.updateMany { claimedAt: null }`) chỉ cho phép EXACTLY
 * 1 claim thành công + N-1 trả về ALREADY_CLAIMED. KHÔNG được double-grant.
 *
 *   1. Login admin.
 *   2. POST /admin/mail/send → tạo mail với reward (LT 1000) tới qaplayer2.
 *   3. Logout admin → login qaplayer2.
 *   4. GET /mail/me → confirm mailId.
 *   5. Snapshot character.linhThach trước claim.
 *   6. Promise.all(20 × POST /mail/:id/claim) — fire all at once.
 *   7. Verify EXACTLY 1 status=200, 19 status=409 (ALREADY_CLAIMED).
 *   8. GET /character → linhThach delta = +1000 (chính xác 1× grant).
 *
 * Chạy:
 *   pnpm stress:concurrent-claim
 *
 * Env:
 *   PARALLELISM — số request concurrent (default 20)
 *   STRESS_ADMIN_EMAIL / STRESS_ADMIN_PASSWORD — admin credentials
 *   STRESS_PLAYER_EMAIL / STRESS_PLAYER_PASSWORD — player (default qaplayer2)
 *   STRESS_PLAYER_CHARACTER_ID — recipient (default qaplayer2 character id)
 *
 * Exit code:
 *   0 — pass (exactly 1 success / N-1 reject / linhThach +reward × 1).
 *   1 — fail.
 */

const BASE = (process.env.SMOKE_API_BASE ?? 'http://localhost:3000').replace(/\/+$/, '');
const PARALLELISM = Number(process.env.PARALLELISM ?? 20);
const ADMIN_EMAIL = process.env.STRESS_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.STRESS_ADMIN_PASSWORD ?? 'change-me-bootstrap-pass';
const PLAYER_EMAIL = process.env.STRESS_PLAYER_EMAIL ?? 'qaplayer2@test.local';
const PLAYER_PASSWORD = process.env.STRESS_PLAYER_PASSWORD ?? 'QaPlayer1Pass!2024';
const REWARD_LT = '1000';

let failures = 0;
const fails = [];

function fail(msg) {
  failures++;
  fails.push(msg);
  console.log(`  ✗ ${msg}`);
}

function pass(msg) {
  console.log(`  ✓ ${msg}`);
}

// Cookie jar — per-context to allow swapping between admin/player sessions.
function mkCookieJar() {
  const jar = new Map();
  return {
    store(res) {
      const raw = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : (res.headers.raw?.()['set-cookie'] ?? []);
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
    },
    header() {
      if (jar.size === 0) return undefined;
      return Array.from(jar, ([k, v]) => `${k}=${v}`).join('; ');
    },
    snapshot() {
      return new Map(jar);
    },
    clear() {
      jar.clear();
    },
  };
}

async function http(jar, path, opts = {}) {
  const url = `${BASE}${path}`;
  const method = opts.method ?? 'GET';
  const headers = { Accept: 'application/json' };
  const cookieH = jar.header();
  if (cookieH) headers.Cookie = cookieH;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  jar.store(res);
  let body;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) body = await res.json().catch(() => null);
  else body = await res.text().catch(() => null);
  return { status: res.status, body };
}

// HTTP call that uses a static Cookie header (no jar mutation) — useful for
// concurrent claim where each request must share the same auth but no state
// race on cookie writes.
async function httpStatic(cookieStr, path, opts = {}) {
  const url = `${BASE}${path}`;
  const method = opts.method ?? 'GET';
  const headers = { Accept: 'application/json' };
  if (cookieStr) headers.Cookie = cookieStr;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let body;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) body = await res.json().catch(() => null);
  else body = await res.text().catch(() => null);
  return { status: res.status, body };
}

console.log(`\n=== P2.1 Concurrency Stress: Mail Claim Race (N=${PARALLELISM}) ===\n`);

const adminJar = mkCookieJar();
const playerJar = mkCookieJar();

// 1. Admin login
console.log('### Step 1: Admin login');
{
  const r = await http(adminJar, '/api/_auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (r.status !== 200) {
    fail(`admin login: status=${r.status}, body=${JSON.stringify(r.body).slice(0, 200)}`);
    process.exit(1);
  }
  pass(`admin login status=200, role=${r.body?.data?.user?.role}`);
}

// 2. Player login (need player character ID — extract from /character)
console.log('\n### Step 2: Player login + fetch character');
let characterId = process.env.STRESS_PLAYER_CHARACTER_ID;
{
  const r = await http(playerJar, '/api/_auth/login', {
    method: 'POST',
    body: { email: PLAYER_EMAIL, password: PLAYER_PASSWORD },
  });
  if (r.status !== 200) {
    fail(`player login: status=${r.status}, body=${JSON.stringify(r.body).slice(0, 200)}`);
    process.exit(1);
  }
  pass(`player login status=200`);
  if (!characterId) {
    const ch = await http(playerJar, '/api/character/me');
    if (ch.status !== 200) {
      fail(`GET /character: status=${ch.status}, body=${JSON.stringify(ch.body).slice(0, 200)}`);
      process.exit(1);
    }
    characterId = ch.body?.data?.character?.id ?? ch.body?.data?.id ?? null;
    if (!characterId) {
      fail(`GET /character: missing character.id, body=${JSON.stringify(ch.body).slice(0, 200)}`);
      process.exit(1);
    }
  }
  pass(`character.id=${characterId}`);
}

// 3. Snapshot linhThach before claim
console.log('\n### Step 3: Snapshot linhThach pre-claim');
let preClaimLT = '';
{
  const r = await http(playerJar, '/api/character/me');
  preClaimLT = r.body?.data?.character?.linhThach ?? r.body?.data?.linhThach ?? '0';
  pass(`pre-claim linhThach=${preClaimLT}`);
}

// 4. Admin send mail with reward
console.log('\n### Step 4: Admin send mail with reward LT=' + REWARD_LT);
let mailId = '';
{
  const r = await http(adminJar, '/api/admin/mail/send', {
    method: 'POST',
    body: {
      recipientCharacterId: characterId,
      subject: '[Stress] Concurrent claim test',
      body: `Test race condition: ${PARALLELISM} parallel claims.`,
      senderName: 'Stress Tester',
      rewardLinhThach: REWARD_LT,
    },
  });
  if (r.status !== 200 || !r.body?.ok) {
    fail(`admin mail/send: status=${r.status}, body=${JSON.stringify(r.body).slice(0, 300)}`);
    process.exit(1);
  }
  mailId = r.body?.data?.mail?.id;
  pass(`mail sent, mailId=${mailId}, rewardLT=${r.body?.data?.mail?.rewardLinhThach}`);
}

// 5. Fire N parallel claim requests
console.log(`\n### Step 5: Fire ${PARALLELISM} parallel POST /mail/:id/claim`);
const playerCookieStr = playerJar.header();
const t0 = Date.now();
const promises = [];
for (let i = 0; i < PARALLELISM; i++) {
  promises.push(httpStatic(playerCookieStr, `/api/mail/${mailId}/claim`, { method: 'POST' }));
}
const results = await Promise.all(promises);
const dur = Date.now() - t0;

const successes = results.filter((r) => r.status === 200);
const conflicts = results.filter((r) =>
  r.status === 409 ||
  (r.status >= 400 && r.body?.error?.code === 'ALREADY_CLAIMED'),
);
const others = results.filter((r) => !successes.includes(r) && !conflicts.includes(r));

console.log(`  Duration: ${dur}ms`);
console.log(`  Successes: ${successes.length} (status 200)`);
console.log(`  Conflicts: ${conflicts.length} (ALREADY_CLAIMED)`);
console.log(`  Others: ${others.length}`);

if (others.length > 0) {
  console.log('  Other responses:');
  for (const o of others.slice(0, 3)) {
    console.log(`    status=${o.status}, body=${JSON.stringify(o.body).slice(0, 200)}`);
  }
}

if (successes.length !== 1) {
  fail(`Expected EXACTLY 1 success, got ${successes.length}`);
} else {
  pass(`Exactly 1 success — CAS race-safe`);
}
if (conflicts.length !== PARALLELISM - 1) {
  fail(`Expected ${PARALLELISM - 1} ALREADY_CLAIMED, got ${conflicts.length}`);
} else {
  pass(`${PARALLELISM - 1} ALREADY_CLAIMED rejections — no double-grant`);
}

// 6. Verify post-claim linhThach delta
console.log('\n### Step 6: Verify post-claim linhThach delta');
{
  const r = await http(playerJar, '/api/character/me');
  const postLT = r.body?.data?.character?.linhThach ?? r.body?.data?.linhThach ?? '0';
  const delta = BigInt(postLT) - BigInt(preClaimLT);
  const expectedDelta = BigInt(REWARD_LT);
  pass(`pre=${preClaimLT}, post=${postLT}, delta=${delta}, expected=${expectedDelta}`);
  if (delta !== expectedDelta) {
    fail(`linhThach delta=${delta} != expected ${expectedDelta} (double-grant or no-grant)`);
  } else {
    pass(`Exactly 1× grant — no double-grant`);
  }
}

// 7. Verify MailAttachmentClaim ledger has exactly 1 row
console.log('\n### Step 7: Verify single attachment claim ledger row (DB)');
{
  // Indirect verify: re-claim must return ALREADY_CLAIMED.
  const r = await httpStatic(playerCookieStr, `/api/mail/${mailId}/claim`, { method: 'POST' });
  const code = r.body?.error?.code;
  if (r.status === 409 || code === 'ALREADY_CLAIMED') {
    pass(`Re-claim returns ALREADY_CLAIMED (status=${r.status}, code=${code}) — idempotent`);
  } else {
    fail(`Re-claim status=${r.status}, code=${code} (expected ALREADY_CLAIMED)`);
  }
}

console.log(`\n=== Result: ${failures === 0 ? 'PASS' : 'FAIL'} ===`);
if (failures > 0) {
  console.log('Failures:');
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
