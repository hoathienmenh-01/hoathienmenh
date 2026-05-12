#!/usr/bin/env node
/**
 * smoke-body-cultivation.mjs — runtime smoke for Phase 26.0 Luyện Thể.
 *
 * Env:
 *   SMOKE_API_BASE default http://localhost:3000
 *   DATABASE_URL   default postgresql://mtt:mtt@localhost:5432/mtt
 *   SMOKE_SECT_KEY default thanh_van
 */

const { PrismaClient } = await import('../apps/api/node_modules/@prisma/client/index.js');

const BASE = (process.env.SMOKE_API_BASE ?? 'http://localhost:3000').replace(/\/+$/, '');
const SECT_KEY = process.env.SMOKE_SECT_KEY ?? 'thanh_van';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 15_000);
const BODY_TICK_WAIT_MS = Number(process.env.SMOKE_BODY_TICK_WAIT_MS ?? 33_000);

const prisma = new PrismaClient();
const cookieJar = new Map();
const results = [];

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

async function http(path, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = { Accept: 'application/json' };
  const cookie = cookieHeader();
  if (cookie) headers.Cookie = cookie;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
    storeSetCookie(res);
    const contentType = res.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? await res.json().catch(() => null)
      : await res.text().catch(() => null);
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function step(name, fn) {
  process.stdout.write(`[smoke:body-cultivation] ${name} ... `);
  try {
    await fn();
    console.log('OK');
    results.push({ name, ok: true });
  } catch (err) {
    console.log('FAIL');
    const note = err instanceof Error ? err.message : String(err);
    console.error(`  ↳ ${note}`);
    results.push({ name, ok: false, note });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertStatus(r, expected, label) {
  if (r.status !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
  }
}

function randomEmail() {
  return `smoke-body-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@smoke.invalid`;
}

function randomCharName() {
  return `body_${Math.random().toString(36).slice(2, 8)}`;
}

const state = {};

await step('register fresh user', async () => {
  state.email = randomEmail();
  const r = await http('/api/_auth/register', {
    method: 'POST',
    body: { email: state.email, password: 'SmokeBody1!' },
  });
  assertStatus(r, 201, 'register');
  state.userId = r.body?.data?.user?.id;
  assert(state.userId, 'missing userId');
});

await step('onboard character with Phàm Thân body defaults', async () => {
  const r = await http('/api/character/onboard', {
    method: 'POST',
    body: { name: randomCharName(), sectKey: SECT_KEY },
  });
  assertStatus(r, 200, 'onboard');
  const ch = r.body?.data?.character;
  assert(ch?.bodyRealmKey === 'pham_than', `bodyRealmKey=${ch?.bodyRealmKey}`);
  assert(ch?.bodyStage === 1, `bodyStage=${ch?.bodyStage}`);
  assert(ch?.bodyCultivating === false, `bodyCultivating=${ch?.bodyCultivating}`);
});

await step('GET body-cultivation status', async () => {
  const r = await http('/api/character/body-cultivation');
  assertStatus(r, 200, 'status');
  const s = r.body?.data?.bodyCultivation;
  assert(s?.bodyRealmKey === 'pham_than', `status bodyRealmKey=${s?.bodyRealmKey}`);
  assert(s?.bodyExp === '0', `status bodyExp=${s?.bodyExp}`);
  assert(Array.isArray(s?.missingMaterials), 'missingMaterials not array');
});

await step('POST start toggles bodyCultivating=true', async () => {
  const r = await http('/api/character/body-cultivation/start', {
    method: 'POST',
    body: {},
  });
  assertStatus(r, 200, 'start');
  assert(r.body?.data?.bodyCultivation?.bodyCultivating === true, 'not cultivating');
});

await step('body tick grants bodyExp, spends stamina, and writes BODY_CULTIVATION cap', async () => {
  await new Promise((resolve) => setTimeout(resolve, BODY_TICK_WAIT_MS));
  const r = await http('/api/character/body-cultivation');
  assertStatus(r, 200, 'status after tick');
  const s = r.body?.data?.bodyCultivation;
  const c = await prisma.character.findUniqueOrThrow({ where: { userId: state.userId } });
  const bucket = await prisma.characterDailyRewardBucket.findFirst({
    where: { characterId: c.id, source: 'BODY_CULTIVATION' },
  });
  assert(BigInt(s?.bodyExp ?? '0') > 0n, `bodyExp not advanced: ${s?.bodyExp}`);
  assert(c.stamina >= 0, `stamina negative: ${c.stamina}`);
  assert(bucket && bucket.expAccum > 0n, 'BODY_CULTIVATION bucket missing/empty');
  assert(bucket.linhThachAccum === 0n, `body bucket linhThach=${bucket.linhThachAccum}`);
  assert(c.linhThach === 0n, `unexpected linhThach=${c.linhThach}`);
  assert(c.tienNgoc === 0, `unexpected tienNgoc=${c.tienNgoc}`);
});

await step('POST stop toggles bodyCultivating=false', async () => {
  const r = await http('/api/character/body-cultivation/stop', {
    method: 'POST',
    body: {},
  });
  assertStatus(r, 200, 'stop');
  assert(r.body?.data?.bodyCultivation?.bodyCultivating === false, 'still cultivating');
});

await step('breakthrough without enough EXP fails cleanly', async () => {
  const r = await http('/api/character/body-cultivation/breakthrough', {
    method: 'POST',
    body: {},
  });
  assertStatus(r, 409, 'breakthrough insufficient exp');
  assert(r.body?.error?.code === 'INSUFFICIENT_EXP', `code=${r.body?.error?.code}`);
});

await prisma.$disconnect();

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(`[smoke:body-cultivation] ${results.length - failed.length}/${results.length} steps OK`);
for (const r of failed) console.log(`  ✗ ${r.name}: ${r.note ?? 'unknown'}`);
process.exit(failed.length === 0 ? 0 : 1);
