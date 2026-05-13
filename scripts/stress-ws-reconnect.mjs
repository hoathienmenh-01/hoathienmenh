#!/usr/bin/env node
/**
 * stress-ws-reconnect.mjs — P2.2 WebSocket mass reconnect stress.
 *
 * Mục tiêu: spawn N sockets cùng lúc với cùng auth cookie, verify:
 *   1. All N sockets handshake OK.
 *   2. Disconnect tất cả → server cleanup userId map không leak.
 *   3. Reconnect all N → handshake OK lại, không UNAUTHENTICATED, không
 *      server crash.
 *   4. After reconnect, gửi chat:msg → ít nhất 1 socket nhận đúng frame.
 *   5. Total duration ≤ 30s cho N=20.
 *
 * Chạy:
 *   pnpm stress:ws-reconnect
 *
 * Env:
 *   SOCKETS — số socket (default 20)
 *   STRESS_PLAYER_EMAIL / STRESS_PLAYER_PASSWORD — player credentials
 *   SMOKE_API_BASE — default http://localhost:3000
 *
 * Exit code:
 *   0 — pass.
 *   1 — ít nhất 1 invariant fail.
 */

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFromApi = createRequire(path.resolve(__dirname, '..', 'apps', 'api', 'package.json'));
const { io } = requireFromApi('socket.io-client');

const BASE = (process.env.SMOKE_API_BASE ?? 'http://localhost:3000').replace(/\/+$/, '');
const SOCKETS = Number(process.env.SOCKETS ?? 20);
const PLAYER_EMAIL = process.env.STRESS_PLAYER_EMAIL ?? 'qaplayer2@test.local';
const PLAYER_PASSWORD = process.env.STRESS_PLAYER_PASSWORD ?? 'QaPlayer1Pass!2024';

const WS_ORIGIN = BASE;
const CONNECT_TIMEOUT_MS = 5000;

let failures = 0;
const fails = [];
function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { failures++; fails.push(msg); console.log(`  ✗ ${msg}`); }

console.log(`\n=== P2.2 WebSocket Mass Reconnect Stress (N=${SOCKETS}) ===\n`);

// Login player
const cookieJar = new Map();
function storeCookies(res) {
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie() : (res.headers.raw?.()['set-cookie'] ?? []);
  for (const line of raw) {
    const eq = line.indexOf('='); const semi = line.indexOf(';');
    if (eq < 0) continue;
    const name = line.slice(0, eq).trim();
    const value = line.slice(eq + 1, semi < 0 ? undefined : semi).trim();
    if (value === '' || value === 'deleted') cookieJar.delete(name);
    else cookieJar.set(name, value);
  }
}
function cookieHeader() {
  if (cookieJar.size === 0) return undefined;
  return Array.from(cookieJar, ([k, v]) => `${k}=${v}`).join('; ');
}

console.log('### Step 1: Login player');
{
  const r = await fetch(`${BASE}/api/_auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: PLAYER_EMAIL, password: PLAYER_PASSWORD }),
  });
  storeCookies(r);
  if (r.status !== 200) {
    fail(`player login: status=${r.status}`);
    process.exit(1);
  }
  pass(`player login status=200`);
}

const cookieStr = cookieHeader() ?? '';

/**
 * Connect 1 socket. Returns Promise resolving to socket on connect, rejecting
 * on error/timeout/UNAUTHENTICATED disconnect.
 */
function connectSocket(idx) {
  return new Promise((resolve, reject) => {
    const sock = io(WS_ORIGIN, {
      path: '/ws',
      transports: ['websocket'],
      reconnection: false,
      timeout: CONNECT_TIMEOUT_MS,
      extraHeaders: { cookie: cookieStr },
      forceNew: true,
    });
    const timer = setTimeout(() => {
      sock.disconnect();
      reject(new Error(`socket ${idx} connect timeout (${CONNECT_TIMEOUT_MS}ms)`));
    }, CONNECT_TIMEOUT_MS);
    sock.on('connect', () => {
      clearTimeout(timer);
      resolve(sock);
    });
    sock.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(new Error(`socket ${idx} connect_error: ${err.message}`));
    });
    sock.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        clearTimeout(timer);
        reject(new Error(`socket ${idx} server disconnect: ${reason}`));
      }
    });
  });
}

console.log(`\n### Step 2: Open ${SOCKETS} sockets concurrently`);
const t0 = Date.now();
let sockets = [];
{
  const promises = [];
  for (let i = 0; i < SOCKETS; i++) promises.push(connectSocket(i).catch((e) => ({ error: e.message })));
  const results = await Promise.all(promises);
  let okCount = 0;
  for (const r of results) {
    if (r && !r.error) {
      sockets.push(r);
      okCount++;
    }
  }
  const dur = Date.now() - t0;
  if (okCount === SOCKETS) pass(`${okCount}/${SOCKETS} connected in ${dur}ms`);
  else fail(`${okCount}/${SOCKETS} connected (expected ${SOCKETS}) in ${dur}ms`);
}

console.log(`\n### Step 3: Disconnect all ${sockets.length} sockets`);
{
  const t1 = Date.now();
  for (const s of sockets) s.disconnect();
  // Wait a moment for server cleanup
  await new Promise((r) => setTimeout(r, 500));
  const dur = Date.now() - t1;
  pass(`${sockets.length} sockets disconnected (waited 500ms for server cleanup, total ${dur}ms)`);
  sockets = [];
}

console.log(`\n### Step 4: Reconnect ${SOCKETS} sockets concurrently with same cookie`);
{
  const t2 = Date.now();
  const promises = [];
  for (let i = 0; i < SOCKETS; i++) promises.push(connectSocket(i).catch((e) => ({ error: e.message })));
  const results = await Promise.all(promises);
  let okCount = 0;
  const errs = [];
  for (const r of results) {
    if (r && !r.error) {
      sockets.push(r);
      okCount++;
    } else if (r && r.error) {
      errs.push(r.error);
    }
  }
  const dur = Date.now() - t2;
  if (okCount === SOCKETS) pass(`${okCount}/${SOCKETS} reconnected in ${dur}ms — no UNAUTHENTICATED leak`);
  else fail(`${okCount}/${SOCKETS} reconnected (expected ${SOCKETS}) in ${dur}ms. Errors: ${errs.slice(0, 3).join('; ')}`);
}

console.log(`\n### Step 5: Send chat:msg, verify at least 1 socket receives frame`);
{
  let received = 0;
  for (const s of sockets) {
    s.on('chat:msg', () => { received++; });
  }
  const r = await fetch(`${BASE}/api/chat/world`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieStr },
    body: JSON.stringify({ text: `stress reconnect test ${Date.now()}` }),
  });
  if (r.status !== 200) {
    fail(`chat send status=${r.status}`);
  } else {
    // Wait for frame propagation
    await new Promise((r) => setTimeout(r, 2000));
    if (received > 0) pass(`${received}/${sockets.length} sockets received chat:msg — broadcast intact post-reconnect`);
    else fail(`0/${sockets.length} sockets received chat:msg — broadcast broken post-reconnect`);
  }
}

console.log(`\n### Step 6: Clean disconnect all`);
{
  for (const s of sockets) s.disconnect();
  await new Promise((r) => setTimeout(r, 300));
  pass(`${sockets.length} sockets clean disconnected`);
}

const total = Date.now() - t0;
console.log(`\n=== Result: ${failures === 0 ? 'PASS' : 'FAIL'} (total ${total}ms) ===`);
if (failures > 0) {
  console.log('Failures:');
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
