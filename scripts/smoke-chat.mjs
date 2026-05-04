#!/usr/bin/env node
/**
 * smoke-chat.mjs — Chat endpoints smoke cho Xuân Tôi.
 *
 * Negative-path-focused + minimal positive (1 message WORLD + 1 message
 * SECT để verify shape contract của ChatMessageView + history fetch).
 * Rate-limit (429 RATE_LIMITED, 8 msg/30s/character) defer cho future
 * smoke với deterministic timing harness.
 *
 * Mục tiêu: cover 3 chat endpoints qua HTTP (`apps/api/src/modules/chat`):
 *   - `GET  /api/chat/history?channel=WORLD|SECT` — fetch 100 latest
 *                                                    msgs (auth + zod
 *                                                    channel; WORLD
 *                                                    không cần char,
 *                                                    SECT cần char +
 *                                                    sectId).
 *   - `POST /api/chat/world`  — gửi WORLD msg (auth + zod text 1-200 +
 *                                service trim → empty/long check → char
 *                                findUnique → rate limit → create).
 *   - `POST /api/chat/sect`   — gửi SECT msg (auth + zod text 1-200 +
 *                                sendSect: char findUnique TRƯỚC send →
 *                                send: trim → empty/long → char find
 *                                AGAIN → rate limit → create vào
 *                                scopeKey=sectId).
 *
 * Service order observation (`chat.service.ts:124-152`):
 *   `send(userId, channel, scopeKey, text)`:
 *     1. `text.trim()` — strip whitespace.
 *     2. `if (!text)` → throw EMPTY_TEXT.
 *     3. `if (text.length > 200)` → throw TEXT_TOO_LONG.
 *     4. `prisma.character.findUnique({ where: { userId } })` → null
 *        throw NO_CHARACTER.
 *     5. `limiter.check(char.id)` → !allowed throw RATE_LIMITED.
 *     6. `prisma.chatMessage.create({...})`.
 *
 * Critical: text validation TRƯỚC char check — pre-onboard với
 * `{text:'   '}` → 400 EMPTY_TEXT (service trim → empty), KHÔNG 404
 * NO_CHARACTER. Khác với inventory (controller char gate TRƯỚC zod) +
 * khác với shop (catalog gate TRƯỚC char). Mỗi module có service order
 * riêng, smoke document rõ.
 *
 * `sendSect(userId, text)` thêm 1 char findUnique TRƯỚC `send()`:
 *   1. `prisma.character.findUnique({ select: sectId })` → null throw
 *      NO_CHARACTER.
 *   2. `if (!char.sectId)` → throw NO_SECT.
 *   3. → `send(userId, SECT, char.sectId, text)`.
 *
 * Khác với sendWorld (gọi thẳng `send(userId, WORLD, 'world', text)` —
 * `send()` tự check char). Nghĩa là pre-onboard `{text:'   '}` POST
 * /sect → service: char findUnique → null → throw NO_CHARACTER 404
 * (sendSect's char check fires TRƯỚC text trim trong `send()`).
 *
 * GET /history channel=WORLD KHÔNG cần char (controller: chỉ
 * `auth.userIdFromAccess` + zod channel + `chat.historyWorld()`); pre-
 * onboard 200 messages array. GET /history channel=SECT cần char +
 * sectId (`chat.historySect(userId)` → char findUnique → sectId check).
 *
 * 20-step:
 *   1.  `GET  /api/chat/history` (no auth)              → 401 UNAUTHENTICATED.
 *   2.  `POST /api/chat/world`   (no auth)              → 401 UNAUTHENTICATED.
 *   3.  `POST /api/chat/sect`    (no auth)              → 401 UNAUTHENTICATED.
 *   4.  `POST /api/_auth/register` — fresh user.
 *   5.  `GET  /api/chat/history` (no channel)           → 400 INVALID_INPUT
 *                                                          (zod channel missing).
 *   6.  `GET  /api/chat/history?channel=INVALID`        → 400 INVALID_INPUT
 *                                                          (zod enum miss).
 *   7.  `GET  /api/chat/history?channel=WORLD` pre-onboard
 *                                                       → 200 messages[]
 *                                                          (no char check
 *                                                          on WORLD path).
 *   8.  `GET  /api/chat/history?channel=SECT` pre-onboard
 *                                                       → 404 NO_CHARACTER
 *                                                          (historySect
 *                                                          char findUnique
 *                                                          → null).
 *   9.  `POST /api/chat/world` ({})                     → 400 INVALID_INPUT
 *                                                          (zod text missing).
 *  10.  `POST /api/chat/world` ({text:''})              → 400 INVALID_INPUT
 *                                                          (zod min(1)).
 *  11.  `POST /api/chat/world` ({text:'x'×201})         → 400 INVALID_INPUT
 *                                                          (zod max(200)).
 *  12.  `POST /api/chat/world` ({text:'   '}) pre-onboard
 *                                                       → 400 EMPTY_TEXT
 *                                                          (service trim
 *                                                          TRƯỚC char
 *                                                          check —
 *                                                          critical
 *                                                          service
 *                                                          order obs).
 *  13.  `POST /api/chat/world` ({text:'hi'}) pre-onboard
 *                                                       → 404 NO_CHARACTER
 *                                                          (text valid
 *                                                          → char null).
 *  14.  `POST /api/chat/sect`  ({text:'hi'}) pre-onboard
 *                                                       → 404 NO_CHARACTER
 *                                                          (sendSect char
 *                                                          findUnique
 *                                                          TRƯỚC send →
 *                                                          char null).
 *  15.  `POST /api/character/onboard` — fresh char (auto-join thanh_van).
 *  16.  `POST /api/chat/world` ({text:UNIQUE_WORLD})    → 200 message
 *                                                          shape verify
 *                                                          (id, channel
 *                                                          WORLD, scopeKey
 *                                                          'world', sender
 *                                                          *, text,
 *                                                          createdAt
 *                                                          ISO).
 *  17.  `GET  /api/chat/history?channel=WORLD`          → 200 messages[]
 *                                                          contain
 *                                                          UNIQUE_WORLD.
 *  18.  `POST /api/chat/sect` ({text:UNIQUE_SECT})      → 200 message
 *                                                          shape verify
 *                                                          (channel SECT,
 *                                                          scopeKey
 *                                                          length>0 +
 *                                                          KHÁC 'world').
 *  19.  `GET  /api/chat/history?channel=SECT`           → 200 messages[]
 *                                                          contain
 *                                                          UNIQUE_SECT
 *                                                          + scopeKey
 *                                                          không phải
 *                                                          'world'.
 *  20.  Anti-FE-self-grant invariant snapshot + `POST /api/_auth/logout`
 *       + `GET /chat/history?channel=WORLD` → 401.
 *
 * Chạy:
 *   pnpm smoke:chat
 *   # hoặc trực tiếp:
 *   node scripts/smoke-chat.mjs
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
 *   - Tab khác: `pnpm smoke:chat`
 *
 * Mutation footprint:
 *   - 1 fresh user + 1 fresh character + auto-joined thanh_van sect.
 *   - 2 chat messages persisted (1 WORLD + 1 SECT) với prefix
 *     `smoke-chat-<ts>-` để dễ identify trong DB. Chat history pruned
 *     tự động trên 500 entries (`HISTORY_RETENTION` ở chat.service.ts).
 *   - KHÔNG đụng inventory / currency / ledger / mission / achievement.
 *
 * Defer:
 *   - RATE_LIMITED 429 (8 msg/30s/character) defer — cần deterministic
 *     timing harness + reset rate limiter giữa runs.
 *   - NO_SECT 404 explicit defer — onboard auto-join thanh_van nên
 *     post-onboard char luôn có sectId; muốn test cần leave sect
 *     workflow (orthogonal cho smoke:sect).
 *   - TEXT_TOO_LONG 400 (text > 200 sau trim) covered qua zod max(200)
 *     ở step 11 — service-level TEXT_TOO_LONG (text quá dài chỉ fail
 *     sau trim) lý thuyết unreachable vì zod đã chặn TRƯỚC; document
 *     trong note.
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
  process.stdout.write(`[smoke:chat] ${name} ... `);
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

/**
 * Verify ChatMessageView shape contract.
 * @param {any} m
 * @param {string} label
 * @param {{ channel: 'WORLD' | 'SECT'; scopeKeyEquals?: string; scopeKeyNotEquals?: string }} ctx
 */
function assertChatMessageShape(m, label, ctx) {
  assert(m && typeof m === 'object', `${label}: message not object`);
  assert(typeof m.id === 'string' && m.id.length > 0, `${label}: m.id invalid (${m.id})`);
  assert(m.channel === ctx.channel, `${label}: m.channel expect ${ctx.channel}, got ${m.channel}`);
  assert(typeof m.scopeKey === 'string' && m.scopeKey.length > 0, `${label}: m.scopeKey invalid (${m.scopeKey})`);
  if (ctx.scopeKeyEquals !== undefined) {
    assert(m.scopeKey === ctx.scopeKeyEquals, `${label}: m.scopeKey expect '${ctx.scopeKeyEquals}', got '${m.scopeKey}'`);
  }
  if (ctx.scopeKeyNotEquals !== undefined) {
    assert(m.scopeKey !== ctx.scopeKeyNotEquals, `${label}: m.scopeKey KHÔNG được = '${ctx.scopeKeyNotEquals}', got '${m.scopeKey}'`);
  }
  assert(typeof m.senderId === 'string' && m.senderId.length > 0, `${label}: m.senderId invalid (${m.senderId})`);
  assert(typeof m.senderName === 'string' && m.senderName.length > 0, `${label}: m.senderName invalid (${m.senderName})`);
  assert(typeof m.text === 'string', `${label}: m.text invalid (${m.text})`);
  assert(typeof m.createdAt === 'string', `${label}: m.createdAt invalid (${m.createdAt})`);
  // Verify ISO 8601 parseable.
  const t = Date.parse(m.createdAt);
  assert(Number.isFinite(t), `${label}: m.createdAt KHÔNG parseable ISO (${m.createdAt})`);
}

// -----------------------------------------------------------------------------
// Helpers random.
// -----------------------------------------------------------------------------

function randomEmail() {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `smoke-chat-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `cht_${rand}`;
}

function uniqueWorldText() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `smoke-chat-world-${ts}-${rand}`;
}

function uniqueSectText() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `smoke-chat-sect-${ts}-${rand}`;
}

/** @returns {Promise<{ linhThach: string; tienNgoc: number; hp: number; mp: number; stamina: number }>} */
async function fetchCharSnapshot() {
  const r = await http('/api/character/state');
  assertStatus(r, 200, 'GET /character/state snapshot');
  const c = r.body?.data?.character;
  assert(c, 'GET /character/state: missing character');
  return {
    linhThach: String(c.linhThach),
    tienNgoc: Number(c.tienNgoc),
    hp: Number(c.hp),
    mp: Number(c.mp),
    stamina: Number(c.stamina),
  };
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

async function main() {
  console.log(`[smoke:chat] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms`);

  // 1. GET /chat/history (no auth) → 401.
  await step('GET /chat/history — 401 UNAUTHENTICATED (no auth)', async () => {
    const r = await http('/api/chat/history?channel=WORLD');
    assertStatus(r, 401, 'GET /chat/history unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'GET /chat/history unauth');
  });

  // 2. POST /chat/world (no auth) → 401.
  await step('POST /chat/world — 401 UNAUTHENTICATED (no auth)', async () => {
    const r = await http('/api/chat/world', {
      method: 'POST',
      body: { text: 'hi' },
    });
    assertStatus(r, 401, 'POST /chat/world unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'POST /chat/world unauth');
  });

  // 3. POST /chat/sect (no auth) → 401.
  await step('POST /chat/sect — 401 UNAUTHENTICATED (no auth)', async () => {
    const r = await http('/api/chat/sect', {
      method: 'POST',
      body: { text: 'hi' },
    });
    assertStatus(r, 401, 'POST /chat/sect unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'POST /chat/sect unauth');
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
    if (!r.body?.ok)
      throw new Error(`register: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.user?.id, 'register: missing user.id');
  });

  // 5. GET /chat/history (no channel) → 400 INVALID_INPUT.
  await step('GET /chat/history — (no channel) 400 INVALID_INPUT', async () => {
    const r = await http('/api/chat/history');
    assertStatus(r, 400, 'GET /chat/history no channel');
    assertErrorCode(r, 'INVALID_INPUT', 'GET /chat/history no channel');
  });

  // 6. GET /chat/history?channel=INVALID → 400 INVALID_INPUT.
  await step('GET /chat/history — (channel:INVALID) 400 INVALID_INPUT', async () => {
    const r = await http('/api/chat/history?channel=INVALID');
    assertStatus(r, 400, 'GET /chat/history channel:INVALID');
    assertErrorCode(r, 'INVALID_INPUT', 'GET /chat/history channel:INVALID');
  });

  // 7. GET /chat/history?channel=WORLD pre-onboard → 200 messages[].
  //    historyWorld() KHÔNG cần char — chỉ cần userId.
  await step('GET /chat/history — (channel:WORLD) pre-onboard 200 messages[]', async () => {
    const r = await http('/api/chat/history?channel=WORLD');
    assertStatus(r, 200, 'GET /chat/history WORLD pre-onboard');
    if (!r.body?.ok)
      throw new Error(`GET /chat/history WORLD: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const messages = r.body?.data?.messages;
    assert(Array.isArray(messages), 'GET /chat/history WORLD: messages not array');
    // Shape verify any pre-existing world msg (smoke không inject yet).
    for (const m of messages) {
      assertChatMessageShape(m, 'GET /chat/history WORLD pre', { channel: 'WORLD', scopeKeyEquals: 'world' });
    }
  });

  // 8. GET /chat/history?channel=SECT pre-onboard → 404 NO_CHARACTER.
  //    historySect() char findUnique → null → throw NO_CHARACTER.
  await step('GET /chat/history — (channel:SECT) pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/chat/history?channel=SECT');
    assertStatus(r, 404, 'GET /chat/history SECT pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'GET /chat/history SECT pre-onboard');
  });

  // 9. POST /chat/world ({}) → 400 INVALID_INPUT (zod missing text).
  await step('POST /chat/world — ({}) 400 INVALID_INPUT (zod missing)', async () => {
    const r = await http('/api/chat/world', { method: 'POST', body: {} });
    assertStatus(r, 400, 'POST /chat/world ({})');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /chat/world ({})');
  });

  // 10. POST /chat/world ({text:''}) → 400 INVALID_INPUT (zod min(1)).
  await step('POST /chat/world — (text:"") 400 INVALID_INPUT (zod min(1))', async () => {
    const r = await http('/api/chat/world', { method: 'POST', body: { text: '' } });
    assertStatus(r, 400, 'POST /chat/world text:""');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /chat/world text:""');
  });

  // 11. POST /chat/world ({text: 'x'.repeat(201)}) → 400 INVALID_INPUT
  //     (zod max(200)). Service-level TEXT_TOO_LONG unreachable.
  await step('POST /chat/world — (text > 200) 400 INVALID_INPUT (zod max(200))', async () => {
    const r = await http('/api/chat/world', {
      method: 'POST',
      body: { text: 'x'.repeat(201) },
    });
    assertStatus(r, 400, 'POST /chat/world text > 200');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /chat/world text > 200');
  });

  // 12. POST /chat/world ({text:'   '}) pre-onboard → 400 EMPTY_TEXT.
  //     CRITICAL: service order text trim TRƯỚC char findUnique. Zod
  //     accepts 3-char whitespace string (passes min(1) max(200)),
  //     service trim → empty → throw EMPTY_TEXT trước khi đụng char
  //     check. Verify pre-onboard pattern khác inventory (controller
  //     char gate TRƯỚC zod) + khác shop (catalog gate TRƯỚC char).
  await step('POST /chat/world — (text:"   ") pre-onboard 400 EMPTY_TEXT', async () => {
    const r = await http('/api/chat/world', {
      method: 'POST',
      body: { text: '   ' },
    });
    assertStatus(r, 400, 'POST /chat/world text:"   " pre-onboard');
    assertErrorCode(r, 'EMPTY_TEXT', 'POST /chat/world text:"   " pre-onboard');
  });

  // 13. POST /chat/world ({text:'hi'}) pre-onboard → 404 NO_CHARACTER.
  //     Text valid → service: trim pass → empty pass → length pass →
  //     char findUnique null → throw NO_CHARACTER.
  await step('POST /chat/world — (text:"hi") pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/chat/world', {
      method: 'POST',
      body: { text: 'hi' },
    });
    assertStatus(r, 404, 'POST /chat/world text:"hi" pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'POST /chat/world text:"hi" pre-onboard');
  });

  // 14. POST /chat/sect ({text:'hi'}) pre-onboard → 404 NO_CHARACTER.
  //     sendSect: char findUnique TRƯỚC send() → null → throw
  //     NO_CHARACTER. Verify SECT path cũng gate char như WORLD path.
  await step('POST /chat/sect — (text:"hi") pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/chat/sect', {
      method: 'POST',
      body: { text: 'hi' },
    });
    assertStatus(r, 404, 'POST /chat/sect text:"hi" pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'POST /chat/sect text:"hi" pre-onboard');
  });

  // 15. Onboard fresh char (auto-join thanh_van — `onboard` upsert
  //     `thanh_van` sect rồi `character.create` với `sectId: sect.id`).
  await step('onboard — create character (auto-join thanh_van)', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: randomCharName(), sectKey: 'thanh_van' },
    });
    assertStatus(r, 200, 'onboard');
    if (!r.body?.ok)
      throw new Error(`onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.character?.id, 'onboard: missing character.id');
  });

  // Snapshot resources BEFORE positive sends + after-failed-attempts
  // anti-FE-self-grant invariant.
  const before = await fetchCharSnapshot();

  // 16. POST /chat/world post-onboard ({text:UNIQUE}) → 200 message
  //     shape verify (id, channel WORLD, scopeKey 'world', senderId,
  //     senderName, text, createdAt ISO).
  const worldText = uniqueWorldText();
  /** @type {string | undefined} */
  let worldMsgId;
  /** @type {string | undefined} */
  let worldSenderId;
  /** @type {string | undefined} */
  let worldSenderName;
  await step('POST /chat/world — post-onboard 200 message shape', async () => {
    const r = await http('/api/chat/world', {
      method: 'POST',
      body: { text: worldText },
    });
    assertStatus(r, 200, 'POST /chat/world post-onboard');
    if (!r.body?.ok)
      throw new Error(`POST /chat/world post-onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const m = r.body?.data?.message;
    assertChatMessageShape(m, 'POST /chat/world post-onboard', { channel: 'WORLD', scopeKeyEquals: 'world' });
    assert(m.text === worldText, `POST /chat/world: text expect '${worldText}', got '${m.text}'`);
    worldMsgId = m.id;
    worldSenderId = m.senderId;
    worldSenderName = m.senderName;
  });

  // 17. GET /chat/history?channel=WORLD post-send → 200 messages[]
  //     contain UNIQUE_WORLD message + same id + same sender.
  await step('GET /chat/history — (channel:WORLD) post-send contains UNIQUE', async () => {
    const r = await http('/api/chat/history?channel=WORLD');
    assertStatus(r, 200, 'GET /chat/history WORLD post-send');
    const messages = r.body?.data?.messages;
    assert(Array.isArray(messages), 'GET /chat/history WORLD post-send: messages not array');
    const found = messages.find((m) => m.id === worldMsgId);
    assert(found, `GET /chat/history WORLD: missing msg id=${worldMsgId} (history len=${messages.length})`);
    assertChatMessageShape(found, 'GET /chat/history WORLD found', {
      channel: 'WORLD',
      scopeKeyEquals: 'world',
    });
    assert(found.text === worldText, `GET /chat/history WORLD: text mismatch`);
    assert(found.senderId === worldSenderId, `GET /chat/history WORLD: senderId mismatch`);
    assert(found.senderName === worldSenderName, `GET /chat/history WORLD: senderName mismatch`);
  });

  // 18. POST /chat/sect post-onboard ({text:UNIQUE_SECT}) → 200 message
  //     shape verify (channel SECT, scopeKey length>0 + KHÁC 'world').
  //     Onboard auto-joined thanh_van nên char.sectId không null,
  //     sendSect pass cả char + sectId checks.
  const sectText = uniqueSectText();
  /** @type {string | undefined} */
  let sectMsgId;
  /** @type {string | undefined} */
  let sectScopeKey;
  await step('POST /chat/sect — post-onboard 200 message shape', async () => {
    const r = await http('/api/chat/sect', {
      method: 'POST',
      body: { text: sectText },
    });
    assertStatus(r, 200, 'POST /chat/sect post-onboard');
    if (!r.body?.ok)
      throw new Error(`POST /chat/sect post-onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const m = r.body?.data?.message;
    assertChatMessageShape(m, 'POST /chat/sect post-onboard', {
      channel: 'SECT',
      scopeKeyNotEquals: 'world',
    });
    assert(m.text === sectText, `POST /chat/sect: text expect '${sectText}', got '${m.text}'`);
    sectMsgId = m.id;
    sectScopeKey = m.scopeKey;
  });

  // 19. GET /chat/history?channel=SECT post-onboard → 200 messages[]
  //     contain UNIQUE_SECT + same scopeKey (verify isolation: SECT
  //     scope dùng sectId thay vì 'world').
  await step('GET /chat/history — (channel:SECT) post-send contains UNIQUE', async () => {
    const r = await http('/api/chat/history?channel=SECT');
    assertStatus(r, 200, 'GET /chat/history SECT post-send');
    const messages = r.body?.data?.messages;
    assert(Array.isArray(messages), 'GET /chat/history SECT post-send: messages not array');
    const found = messages.find((m) => m.id === sectMsgId);
    assert(found, `GET /chat/history SECT: missing msg id=${sectMsgId} (history len=${messages.length})`);
    assertChatMessageShape(found, 'GET /chat/history SECT found', {
      channel: 'SECT',
      scopeKeyEquals: sectScopeKey,
    });
    assert(found.text === sectText, `GET /chat/history SECT: text mismatch`);
    assert(found.scopeKey !== 'world', `GET /chat/history SECT: scopeKey KHÔNG được = 'world'`);
  });

  // 20. Anti-FE-self-grant invariant + logout + GET /chat/history 401.
  //     Verify: hp/mp/stamina/linhThach/tienNgoc unchanged sau cả
  //     failed steps 12-14 (EMPTY_TEXT + NO_CHARACTER) lẫn happy
  //     steps 16+18 (chat send KHÔNG cộng currency / damage / drops
  //     — chat module không touch character resources).
  await step('anti-FE-self-grant + logout + GET /chat/history 401', async () => {
    const after = await fetchCharSnapshot();
    assert(
      after.linhThach === before.linhThach,
      `linhThach VẪN ${before.linhThach} sau chat sends, got ${after.linhThach}`,
    );
    assert(
      after.tienNgoc === before.tienNgoc,
      `tienNgoc VẪN ${before.tienNgoc} sau chat sends, got ${after.tienNgoc}`,
    );
    assert(
      after.hp === before.hp,
      `hp VẪN ${before.hp} sau chat sends, got ${after.hp}`,
    );
    assert(
      after.mp === before.mp,
      `mp VẪN ${before.mp} sau chat sends, got ${after.mp}`,
    );
    assert(
      after.stamina === before.stamina,
      `stamina VẪN ${before.stamina} sau chat sends, got ${after.stamina}`,
    );

    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const after2 = await http('/api/chat/history?channel=WORLD');
    assertStatus(after2, 401, 'GET /chat/history post-logout');
    assertErrorCode(after2, 'UNAUTHENTICATED', 'GET /chat/history post-logout');
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:chat] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:chat] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:chat] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:chat] unexpected error:', err);
  process.exitCode = 1;
});
