#!/usr/bin/env node
/**
 * smoke-npc.mjs — NPC dialogue endpoints smoke cho Xuân Tôi.
 * Phase 12 Story PR-4 — covers `apps/api/src/modules/npc/`.
 *
 * Steps:
 *  1. GET  /api/npcs/me                                    (no auth) → 401.
 *  2. GET  /api/npcs/npc_lang_van_sinh/dialogue            (no auth) → 401.
 *  3. POST /api/_auth/register                              — fresh user.
 *  4. GET  /api/npcs/me                                    (pre-onboard) → 404.
 *  5. POST /api/character/onboard                           — fresh char (default sect, luyenkhi 1).
 *  6. GET  /api/npcs/me                                    (post-onboard) → 200 array.
 *  7. GET  /api/npcs/me                                     — verify shape (key/name/dialogue/choices).
 *  8. GET  /api/npcs/invalid_format/dialogue               → 400 INVALID_INPUT.
 *  9. GET  /api/npcs/npc_xxx_unknown/dialogue              → 404 NPC_UNKNOWN.
 * 10. GET  /api/npcs/npc_to_nguyet_ly/dialogue             → 403 NPC_LOCKED_REALM
 *                                                            (truc_co gate, fresh char luyenkhi).
 * 11. GET  /api/npcs/npc_lang_van_sinh/dialogue            → 200 dialogue + choices.
 *
 * Env vars:
 *   SMOKE_API_BASE     — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS   — default 10000ms / request.
 *   SMOKE_VERBOSE      — "1" để log request/response.
 *   SMOKE_SECT_KEY     — default "thanh_van".
 *
 * Yêu cầu:
 *   - `pnpm infra:up`
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:npc`
 *
 * Exit code:
 *   0 — toàn bộ invariant OK.
 *   1 — ít nhất 1 invariant fail.
 */

const BASE = (process.env.SMOKE_API_BASE ?? 'http://localhost:3000').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);
const VERBOSE = process.env.SMOKE_VERBOSE === '1';
const SECT_KEY = process.env.SMOKE_SECT_KEY ?? 'thanh_van';

/** @type {Map<string, string>} */
const cookieJar = new Map();

/** @param {Response} res */
function storeSetCookie(res) {
  const raw =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : (res.headers.raw?.()['set-cookie'] ?? []);
  for (const line of raw) {
    const eq = line.indexOf('=');
    const semi = line.indexOf(';');
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

/**
 * @param {string} path
 * @param {{ method?: string; body?: unknown }} [opts]
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

  if (VERBOSE) console.log(`→ ${method} ${url}${opts.body ? ' body=' + JSON.stringify(opts.body) : ''}`);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
    storeSetCookie(res);
    const ctype = res.headers.get('content-type') ?? '';
    const body = ctype.includes('application/json') ? await res.json().catch(() => null) : await res.text().catch(() => null);
    if (VERBOSE) console.log(`← ${res.status} ${method} ${path}`);
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/** @type {{ name: string; ok: boolean; note?: string }[]} */
const results = [];

/** @param {string} name @param {() => Promise<void>} fn */
async function step(name, fn) {
  process.stdout.write(`[smoke:npc] ${name} ... `);
  try {
    await fn();
    console.log('OK');
    results.push({ name, ok: true });
  } catch (e) {
    console.log('FAIL');
    results.push({ name, ok: false, note: e instanceof Error ? e.message : String(e) });
    if (VERBOSE && e instanceof Error) console.log(e.stack);
  }
}

/** @param {boolean} cond @param {string} msg */
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function rid() {
  return Math.random().toString(36).slice(2, 10);
}

const email = `smoke-npc-${rid()}@xt.local`;
const password = `Smoke!Npc1${rid()}`;
const charName = `SmkN_${rid()}`;

async function main() {
  // 1.
  await step('GET /npcs/me no auth → 401 UNAUTHENTICATED', async () => {
    cookieJar.clear();
    const r = await http('/api/npcs/me');
    assert(r.status === 401, `expected 401, got ${r.status}`);
    assert(r.body?.ok === false, 'expected ok=false');
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `expected UNAUTHENTICATED, got ${r.body?.error?.code}`);
  });

  // 2.
  await step('GET /npcs/:key/dialogue no auth → 401', async () => {
    const r = await http('/api/npcs/npc_lang_van_sinh/dialogue');
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });

  // 3.
  await step('register fresh user', async () => {
    cookieJar.clear();
    const r = await http('/api/_auth/register', { method: 'POST', body: { email, password } });
    assert(r.status === 200 || r.status === 201, `register expected 200/201, got ${r.status}`);
  });

  // 4.
  await step('GET /npcs/me pre-onboard → 404 NO_CHARACTER', async () => {
    const r = await http('/api/npcs/me');
    assert(r.status === 404, `expected 404, got ${r.status}`);
    assert(r.body?.error?.code === 'NO_CHARACTER', `expected NO_CHARACTER, got ${r.body?.error?.code}`);
  });

  // 5.
  await step('onboard fresh character', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: charName, sectKey: SECT_KEY },
    });
    assert(r.status === 200 || r.status === 201, `onboard expected 200/201, got ${r.status}, body=${JSON.stringify(r.body)}`);
  });

  // 6 + 7. Fetch list + verify shape.
  await step('GET /npcs/me post-onboard → 200 array + shape', async () => {
    const r = await http('/api/npcs/me');
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body?.ok === true, 'expected ok=true');
    assert(Array.isArray(r.body?.data?.npcs), 'expected npcs array');
    const list = r.body.data.npcs;
    assert(list.length > 0, 'expected at least 1 NPC visible');
    const sample = list[0];
    assert(typeof sample.key === 'string' && sample.key.startsWith('npc_'), 'npc.key starts with npc_');
    assert(typeof sample.name === 'string' && sample.name.length > 0, 'npc.name string');
    assert(typeof sample.realmGateOrder === 'number', 'npc.realmGateOrder number');
    assert(sample.dialogue !== null, 'npc.dialogue !== null');
    assert(typeof sample.dialogue.text === 'string', 'dialogue.text string');
    assert(Array.isArray(sample.dialogue.choices), 'dialogue.choices array');
  });

  // 8. zod regex reject (invalid_format không bắt đầu npc_).
  await step('GET /npcs/invalid_format/dialogue → 400 INVALID_INPUT', async () => {
    const r = await http('/api/npcs/invalid_format/dialogue');
    assert(r.status === 400, `expected 400, got ${r.status}, body=${JSON.stringify(r.body)}`);
    assert(r.body?.error?.code === 'INVALID_INPUT', `expected INVALID_INPUT, got ${r.body?.error?.code}`);
  });

  // 9.
  await step('GET /npcs/npc_xxx_unknown/dialogue → 404 NPC_UNKNOWN', async () => {
    const r = await http('/api/npcs/npc_xxx_unknown/dialogue');
    assert(r.status === 404, `expected 404, got ${r.status}`);
    assert(r.body?.error?.code === 'NPC_UNKNOWN', `expected NPC_UNKNOWN, got ${r.body?.error?.code}`);
  });

  // 10. truc_co gate (realmGateOrder=2) — fresh char default luyenkhi (order 1).
  await step('GET /npcs/npc_to_nguyet_ly/dialogue → 403 NPC_LOCKED_REALM', async () => {
    const r = await http('/api/npcs/npc_to_nguyet_ly/dialogue');
    assert(r.status === 403, `expected 403, got ${r.status}, body=${JSON.stringify(r.body)}`);
    assert(r.body?.error?.code === 'NPC_LOCKED_REALM', `expected NPC_LOCKED_REALM, got ${r.body?.error?.code}`);
  });

  // 11. NPC unlocked.
  await step('GET /npcs/npc_lang_van_sinh/dialogue → 200 dialogue + choices', async () => {
    const r = await http('/api/npcs/npc_lang_van_sinh/dialogue');
    assert(r.status === 200, `expected 200, got ${r.status}, body=${JSON.stringify(r.body)}`);
    assert(r.body?.data?.dialogue?.dialogueId, 'expected dialogue.dialogueId');
    assert(typeof r.body?.data?.dialogue?.text === 'string', 'expected dialogue.text');
    assert(Array.isArray(r.body?.data?.dialogue?.choices), 'expected dialogue.choices array');
    assert(r.body.data.dialogue.choices.length > 0, 'expected at least 1 choice');
    const c = r.body.data.dialogue.choices[0];
    assert(typeof c.key === 'string', 'choice.key string');
    assert(typeof c.label === 'string', 'choice.label string');
    assert(typeof c.closeDialogue === 'boolean', 'choice.closeDialogue boolean');
  });

  // Summary.
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n[smoke:npc] ${passed}/${results.length} steps passed.`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.name}: ${r.note}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[smoke:npc] fatal', e);
  process.exit(2);
});
