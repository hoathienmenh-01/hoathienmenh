#!/usr/bin/env node
/**
 * smoke-story-dungeon.mjs — Phase 12.8.E Story Dungeon end-to-end smoke.
 * Covers `apps/api/src/modules/story-dungeon/` HTTP surface từ góc nhìn player
 * (auth gates + quest gating + start → advance → clear → claim flow + một số
 * negative path quan trọng).
 *
 * Target template: `story_dgn_phamnhan_back_mountain` — entry point easiest
 * trong catalog (minRealmKey=null, requiredQuestKey=phamnhan_realm_01,
 * requiredQuestStep=step_01 explore, oneTime=true). 3 monster: son_thu_lon,
 * da_quan, huyet_lang. Reward: 80 LT + 150 EXP + 1 linh_lo_dan.
 *
 * Steps (28):
 *   1. GET  /api/story/dungeons                     (no auth)              → 401.
 *   2. GET  /api/story/dungeons/<key>               (no auth)              → 401.
 *   3. POST /api/story/dungeons/<key>/start         (no auth)              → 401.
 *   4. POST /api/story/dungeons/run-stub/advance    (no auth)              → 401.
 *   5. POST /api/story/dungeons/run-stub/clear      (no auth)              → 401.
 *   6. POST /api/story/dungeons/run-stub/claim      (no auth)              → 401.
 *   7. POST /api/_auth/register (player1)                                  — fresh user.
 *   8. GET  /api/story/dungeons (pre-onboard)                              → 404 NO_CHARACTER.
 *   9. POST /api/character/onboard (player1)                               — fresh char.
 *  10. GET  /api/story/dungeons (post-onboard)                             → 200 list, target locked.
 *  11. POST /api/story/dungeons/<key>/start (pre-quest)                    → 403 DUNGEON_LOCKED.
 *  12. Drive `phamnhan_main_01` → COMPLETED:
 *       a. POST /api/quests/accept questKey=phamnhan_main_01               → 200 ACCEPTED.
 *       b. POST /api/quests/progress step_01 talk npc_lang_van_sinh        → 200.
 *       c. POST /api/quests/progress step_02 talk npc_moc_thanh_y          → 200.
 *       d. Admin: POST /api/admin/users/:id/quest-track kill son_thu × 3   → quest auto COMPLETED.
 *  13. POST /api/quests/accept phamnhan_realm_01                           → 200 ACCEPTED.
 *  14. POST /api/quests/progress step_01 explore hoa_thien_hau_son         → 200.
 *  15. GET  /api/story/dungeons → target now status=available.
 *  16. POST /api/story/dungeons/<key>/start                                → 200 ACTIVE run, currentStep=0.
 *  17. POST /api/story/dungeons/<key>/start (idempotent retry)             → 200 same runId.
 *  18. POST /api/story/dungeons/{runId}/clear (premature)                  → 409 RUN_STEP_INVALID.
 *  19. POST /api/story/dungeons/{runId}/advance × 3 → currentStep=3, killedMonsters.length=3.
 *  20. POST /api/story/dungeons/{runId}/advance (out of range)             → 409 RUN_STEP_INVALID.
 *  21. POST /api/story/dungeons/{runId}/clear                              → 200 CLEARED.
 *  22. POST /api/story/dungeons/{runId}/clear (re-clear)                   → 409 RUN_NOT_ACTIVE.
 *  23. GET  /api/quests/me → phamnhan_realm_01 still ACCEPTED, step_01 progress=1
 *      (no regression sau dungeon clear path).
 *  24. POST /api/story/dungeons/{runId}/claim                              → 200 granted reward
 *      (linhThach=80, exp=150, items=[{linh_lo_dan, qty=1}]).
 *  25. POST /api/story/dungeons/{runId}/claim (double)                     → 409 RUN_ALREADY_CLAIMED.
 *  26. POST /api/story/dungeons/<key>/start (oneTime + already claimed)    → 409 DUNGEON_ALREADY_CLEARED.
 *  27. Player2 onboard + try advance/claim player1's runId                 → 403 RUN_NOT_OWNED.
 *  28. GET /api/story/dungeons (player2) → activeRun=null, target locked
 *      (data isolation invariant).
 *
 * Env vars:
 *   SMOKE_API_BASE        — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS      — default 10000ms / request.
 *   SMOKE_VERBOSE         — "1" để log request/response.
 *   SMOKE_SECT_KEY        — default "thanh_van".
 *   SMOKE_ADMIN_EMAIL     — default INITIAL_ADMIN_EMAIL = "admin@example.com".
 *   SMOKE_ADMIN_PASSWORD  — default "change-me-bootstrap-pass" (apps/api/.env.example).
 *
 * Yêu cầu:
 *   - `pnpm infra:up`
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api bootstrap` (tạo admin user)
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:story-dungeon`
 *
 * Exit code:
 *   0 — toàn bộ invariant OK.
 *   1 — ít nhất 1 invariant fail.
 */

const BASE = (process.env.SMOKE_API_BASE ?? 'http://localhost:3000').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 10_000);
const VERBOSE = process.env.SMOKE_VERBOSE === '1';
const SECT_KEY = process.env.SMOKE_SECT_KEY ?? 'thanh_van';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'change-me-bootstrap-pass';

const STORY_KEY = 'story_dgn_phamnhan_back_mountain';
const QUEST_MAIN = 'phamnhan_main_01';
const QUEST_REALM = 'phamnhan_realm_01';

/**
 * Tách 3 cookie jar:
 *  - jar1 — player1 (target dungeon owner).
 *  - jar2 — player2 (non-owner negative path).
 *  - jarAdmin — admin (quest-track seed kill step).
 */
function makeJar() {
  return new Map();
}
const jar1 = makeJar();
const jar2 = makeJar();
const jarAdmin = makeJar();

/** @param {Map<string,string>} jar @param {Response} res */
function storeSetCookie(jar, res) {
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
    if (value === '' || value === 'deleted') jar.delete(name);
    else jar.set(name, value);
  }
}

/** @param {Map<string,string>} jar */
function cookieHeader(jar) {
  if (jar.size === 0) return undefined;
  return Array.from(jar, ([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * @param {Map<string,string>|null} jar — null => no auth (cookie-less request).
 * @param {string} path
 * @param {{ method?: string; body?: unknown }} [opts]
 */
async function http(jar, path, opts = {}) {
  const url = `${BASE}${path}`;
  const method = opts.method ?? 'GET';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  /** @type {Record<string,string>} */
  const headers = { Accept: 'application/json' };
  if (jar) {
    const c = cookieHeader(jar);
    if (c) headers.Cookie = c;
  }
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
    if (jar) storeSetCookie(jar, res);
    const ctype = res.headers.get('content-type') ?? '';
    const body = ctype.includes('application/json')
      ? await res.json().catch(() => null)
      : await res.text().catch(() => null);
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
  process.stdout.write(`[smoke:story-dungeon] ${name} ... `);
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

const email1 = `smoke-stdgn-${rid()}@xt.local`;
const password1 = `Smoke!StD1${rid()}`;
const charName1 = `SmkStD_${rid()}`;
let userId1 = '';

const email2 = `smoke-stdgn2-${rid()}@xt.local`;
const password2 = `Smoke!StD2${rid()}`;
const charName2 = `SmkStD2_${rid()}`;

let runId = '';

async function main() {
  // 1.
  await step('GET /story/dungeons no auth → 401', async () => {
    const r = await http(null, '/api/story/dungeons');
    assert(r.status === 401, `expected 401, got ${r.status}`);
    assert(r.body?.error?.code === 'UNAUTHENTICATED', `code=${r.body?.error?.code}`);
  });

  // 2.
  await step('GET /story/dungeons/:key no auth → 401', async () => {
    const r = await http(null, `/api/story/dungeons/${STORY_KEY}`);
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });

  // 3.
  await step('POST /story/dungeons/:key/start no auth → 401', async () => {
    const r = await http(null, `/api/story/dungeons/${STORY_KEY}/start`, {
      method: 'POST',
      body: {},
    });
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });

  // 4–6. NestJS route resolves :key vs :runId qua regex param. Stub runId
  // (cuid `^c[a-z0-9]+$`) để khớp `:runId/advance` route đúng — dùng
  // 'cstubsmoke12345' (đủ regex) thay vì 'run-stub' (không match).
  const stubRunId = 'cstub00000000smokeqz';
  await step('POST /story/dungeons/:runId/advance no auth → 401', async () => {
    const r = await http(null, `/api/story/dungeons/${stubRunId}/advance`, {
      method: 'POST',
      body: {},
    });
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });

  // 5.
  await step('POST /story/dungeons/:runId/clear no auth → 401', async () => {
    const r = await http(null, `/api/story/dungeons/${stubRunId}/clear`, {
      method: 'POST',
      body: {},
    });
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });

  // 6.
  await step('POST /story/dungeons/:runId/claim no auth → 401', async () => {
    const r = await http(null, `/api/story/dungeons/${stubRunId}/claim`, {
      method: 'POST',
      body: {},
    });
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });

  // 7.
  await step('register player1', async () => {
    jar1.clear();
    const r = await http(jar1, '/api/_auth/register', {
      method: 'POST',
      body: { email: email1, password: password1 },
    });
    assert(r.status === 200 || r.status === 201, `register status=${r.status}`);
    userId1 = r.body?.data?.user?.id;
    assert(typeof userId1 === 'string' && userId1.length > 0, 'userId1 missing');
  });

  // 8.
  await step('GET /story/dungeons pre-onboard → 404 NO_CHARACTER', async () => {
    const r = await http(jar1, '/api/story/dungeons');
    assert(r.status === 404, `expected 404, got ${r.status}`);
    assert(
      r.body?.error?.code === 'NO_CHARACTER',
      `expected NO_CHARACTER, got ${r.body?.error?.code}`,
    );
  });

  // 9.
  await step('onboard player1 (phamnhan default)', async () => {
    const r = await http(jar1, '/api/character/onboard', {
      method: 'POST',
      body: { name: charName1, sectKey: SECT_KEY },
    });
    assert(
      r.status === 200 || r.status === 201,
      `onboard status=${r.status}, body=${JSON.stringify(r.body)}`,
    );
  });

  // 10.
  await step('GET /story/dungeons post-onboard → list with target locked', async () => {
    const r = await http(jar1, '/api/story/dungeons');
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(Array.isArray(r.body?.data?.dungeons), 'expected dungeons array');
    const target = r.body.data.dungeons.find((d) => d.key === STORY_KEY);
    assert(target, `target ${STORY_KEY} not in list`);
    assert(target.status === 'locked', `expected locked, got ${target.status}`);
    assert(r.body?.data?.activeRun === null, 'expected activeRun=null');
  });

  // 11.
  await step('POST /story/dungeons/:key/start pre-quest → 403 DUNGEON_LOCKED', async () => {
    const r = await http(jar1, `/api/story/dungeons/${STORY_KEY}/start`, {
      method: 'POST',
      body: {},
    });
    assert(r.status === 403, `expected 403, got ${r.status}, body=${JSON.stringify(r.body)}`);
    assert(
      r.body?.error?.code === 'DUNGEON_LOCKED',
      `expected DUNGEON_LOCKED, got ${r.body?.error?.code}`,
    );
  });

  // 12a.
  await step(`POST /quests/accept ${QUEST_MAIN} → 200 ACCEPTED`, async () => {
    const r = await http(jar1, '/api/quests/accept', {
      method: 'POST',
      body: { questKey: QUEST_MAIN },
    });
    assert(r.status === 200, `expected 200, got ${r.status}, body=${JSON.stringify(r.body)}`);
    assert(
      r.body?.data?.quest?.status === 'ACCEPTED',
      `quest status=${r.body?.data?.quest?.status}`,
    );
  });

  // 12b.
  await step('POST /quests/progress phamnhan_main_01 step_01 talk → 200', async () => {
    const r = await http(jar1, '/api/quests/progress', {
      method: 'POST',
      body: {
        questKey: QUEST_MAIN,
        stepId: 'step_01',
        targetType: 'npc',
        targetId: 'npc_lang_van_sinh',
        amount: 1,
      },
    });
    assert(r.status === 200, `expected 200, got ${r.status}, body=${JSON.stringify(r.body)}`);
  });

  // 12c.
  await step('POST /quests/progress phamnhan_main_01 step_02 talk → 200', async () => {
    const r = await http(jar1, '/api/quests/progress', {
      method: 'POST',
      body: {
        questKey: QUEST_MAIN,
        stepId: 'step_02',
        targetType: 'npc',
        targetId: 'npc_moc_thanh_y',
        amount: 1,
      },
    });
    assert(r.status === 200, `expected 200, got ${r.status}, body=${JSON.stringify(r.body)}`);
  });

  // 12d. Admin login + quest-track kill son_thu × 3.
  await step('admin login', async () => {
    jarAdmin.clear();
    const r = await http(jarAdmin, '/api/_auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assert(
      r.status === 200 && r.body?.data?.user?.role === 'ADMIN',
      `admin login fail: status=${r.status}, role=${r.body?.data?.user?.role}, ` +
        `body=${JSON.stringify(r.body).slice(0, 200)}. ` +
        `Bootstrap admin? Run \`pnpm --filter @xuantoi/api bootstrap\`.`,
    );
  });

  await step(`admin quest-track kill son_thu ×3 (player1 phamnhan_main_01 step_03)`, async () => {
    const r = await http(jarAdmin, `/api/admin/users/${userId1}/quest-track`, {
      method: 'POST',
      body: {
        kind: 'kill',
        targetType: 'monster',
        targetId: 'son_thu',
        amount: 3,
        reason: 'smoke:story-dungeon seed phamnhan_main_01 step_03',
      },
    });
    assert(r.status === 200, `expected 200, got ${r.status}, body=${JSON.stringify(r.body)}`);
  });

  // Verify phamnhan_main_01 now COMPLETED.
  await step('GET /quests/me → phamnhan_main_01 COMPLETED', async () => {
    const r = await http(jar1, '/api/quests/me');
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const main = r.body?.data?.quests?.find((q) => q.key === QUEST_MAIN);
    assert(main, `${QUEST_MAIN} missing`);
    assert(
      main.status === 'COMPLETED',
      `expected COMPLETED, got ${main.status}, steps=${JSON.stringify(main.steps)}`,
    );
  });

  // 13.
  await step(`POST /quests/accept ${QUEST_REALM} → 200 ACCEPTED`, async () => {
    const r = await http(jar1, '/api/quests/accept', {
      method: 'POST',
      body: { questKey: QUEST_REALM },
    });
    assert(r.status === 200, `expected 200, got ${r.status}, body=${JSON.stringify(r.body)}`);
    assert(r.body?.data?.quest?.status === 'ACCEPTED', `status=${r.body?.data?.quest?.status}`);
  });

  // 14.
  await step('POST /quests/progress phamnhan_realm_01 step_01 explore → 200', async () => {
    const r = await http(jar1, '/api/quests/progress', {
      method: 'POST',
      body: {
        questKey: QUEST_REALM,
        stepId: 'step_01',
        targetType: 'region',
        targetId: 'hoa_thien_hau_son',
        amount: 1,
      },
    });
    assert(r.status === 200, `expected 200, got ${r.status}, body=${JSON.stringify(r.body)}`);
  });

  // 15.
  await step('GET /story/dungeons → target now status=available', async () => {
    const r = await http(jar1, '/api/story/dungeons');
    assert(r.status === 200, `expected 200, got ${r.status}`);
    const target = r.body.data.dungeons.find((d) => d.key === STORY_KEY);
    assert(target, `target ${STORY_KEY} missing`);
    assert(
      target.status === 'available',
      `expected available, got ${target.status}, ` +
        `quest=${QUEST_REALM} should be ACCEPTED with step_01 progress=1`,
    );
  });

  // 16.
  await step(`POST /story/dungeons/${STORY_KEY}/start → 200 ACTIVE`, async () => {
    const r = await http(jar1, `/api/story/dungeons/${STORY_KEY}/start`, {
      method: 'POST',
      body: {},
    });
    assert(r.status === 200, `expected 200, got ${r.status}, body=${JSON.stringify(r.body)}`);
    const run = r.body?.data?.run;
    assert(run?.id, 'run.id missing');
    assert(run?.status === 'ACTIVE', `status=${run?.status}`);
    assert(run?.currentStep === 0, `currentStep=${run?.currentStep}`);
    assert(run?.totalSteps === 3, `totalSteps=${run?.totalSteps}`);
    assert(run?.currentMonster?.key === 'son_thu_lon', `currentMonster=${run?.currentMonster?.key}`);
    assert(Array.isArray(run?.killedMonsters) && run.killedMonsters.length === 0, 'killed=[]');
    assert(run?.clearedAt === null && run?.claimedAt === null, 'cleared/claimed should be null');
    runId = run.id;
  });

  // 17.
  await step('POST /story/dungeons/:key/start (idempotent retry) → same runId', async () => {
    const r = await http(jar1, `/api/story/dungeons/${STORY_KEY}/start`, {
      method: 'POST',
      body: {},
    });
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(
      r.body?.data?.run?.id === runId,
      `expected idempotent runId=${runId}, got ${r.body?.data?.run?.id}`,
    );
  });

  // 18.
  await step('POST /story/dungeons/:runId/clear premature → 409 RUN_STEP_INVALID', async () => {
    const r = await http(jar1, `/api/story/dungeons/${runId}/clear`, {
      method: 'POST',
      body: {},
    });
    assert(r.status === 409, `expected 409, got ${r.status}, body=${JSON.stringify(r.body)}`);
    assert(
      r.body?.error?.code === 'RUN_STEP_INVALID',
      `expected RUN_STEP_INVALID, got ${r.body?.error?.code}`,
    );
  });

  // 19.
  await step('POST /story/dungeons/:runId/advance × 3 → currentStep=3', async () => {
    let lastRun = null;
    for (let i = 0; i < 3; i++) {
      const r = await http(jar1, `/api/story/dungeons/${runId}/advance`, {
        method: 'POST',
        body: {},
      });
      assert(
        r.status === 200,
        `advance ${i + 1} expected 200, got ${r.status}, body=${JSON.stringify(r.body)}`,
      );
      lastRun = r.body?.data?.run;
    }
    assert(lastRun?.currentStep === 3, `final currentStep=${lastRun?.currentStep}`);
    assert(lastRun?.killedMonsters?.length === 3, `killed.length=${lastRun?.killedMonsters?.length}`);
    assert(lastRun?.currentMonster === null, 'currentMonster should be null after last advance');
  });

  // 20.
  await step('POST /story/dungeons/:runId/advance out of range → 409 RUN_STEP_INVALID', async () => {
    const r = await http(jar1, `/api/story/dungeons/${runId}/advance`, {
      method: 'POST',
      body: {},
    });
    assert(r.status === 409, `expected 409, got ${r.status}`);
    assert(
      r.body?.error?.code === 'RUN_STEP_INVALID',
      `expected RUN_STEP_INVALID, got ${r.body?.error?.code}`,
    );
  });

  // 21.
  await step('POST /story/dungeons/:runId/clear → 200 CLEARED', async () => {
    const r = await http(jar1, `/api/story/dungeons/${runId}/clear`, {
      method: 'POST',
      body: {},
    });
    assert(r.status === 200, `expected 200, got ${r.status}, body=${JSON.stringify(r.body)}`);
    const run = r.body?.data?.run;
    assert(run?.status === 'CLEARED', `status=${run?.status}`);
    assert(run?.clearedAt, 'clearedAt should be set');
    assert(run?.claimedAt === null, 'claimedAt should still be null');
  });

  // 22.
  await step('POST /story/dungeons/:runId/clear re-clear → 409 RUN_NOT_ACTIVE', async () => {
    const r = await http(jar1, `/api/story/dungeons/${runId}/clear`, {
      method: 'POST',
      body: {},
    });
    assert(r.status === 409, `expected 409, got ${r.status}`);
    assert(
      r.body?.error?.code === 'RUN_NOT_ACTIVE',
      `expected RUN_NOT_ACTIVE, got ${r.body?.error?.code}`,
    );
  });

  // 23.
  await step(
    'GET /quests/me → phamnhan_realm_01 ACCEPTED, step_01 progress=1 (no regression)',
    async () => {
      const r = await http(jar1, '/api/quests/me');
      assert(r.status === 200, `expected 200, got ${r.status}`);
      const realm = r.body?.data?.quests?.find((q) => q.key === QUEST_REALM);
      assert(realm, `${QUEST_REALM} missing`);
      assert(realm.status === 'ACCEPTED', `expected ACCEPTED, got ${realm.status}`);
      const step01 = realm.steps?.find((s) => s.id === 'step_01');
      assert(step01, 'step_01 missing');
      assert(step01.currentCount === 1, `step_01 currentCount=${step01.currentCount}`);
      assert(step01.done === true, `step_01 done=${step01.done}`);
    },
  );

  // 24.
  await step('POST /story/dungeons/:runId/claim → 200 granted reward', async () => {
    const r = await http(jar1, `/api/story/dungeons/${runId}/claim`, {
      method: 'POST',
      body: {},
    });
    assert(r.status === 200, `expected 200, got ${r.status}, body=${JSON.stringify(r.body)}`);
    const data = r.body?.data;
    assert(data?.runId === runId, `runId mismatch`);
    assert(data?.templateKey === STORY_KEY, `templateKey=${data?.templateKey}`);
    assert(data?.granted?.linhThach === 80, `linhThach=${data?.granted?.linhThach}`);
    assert(data?.granted?.exp === 150, `exp=${data?.granted?.exp}`);
    assert(Array.isArray(data?.granted?.items), 'items array');
    const item = data.granted.items.find((it) => it.itemKey === 'linh_lo_dan');
    assert(item && item.qty === 1, `linh_lo_dan qty=${item?.qty}`);
  });

  // 25.
  await step('POST /story/dungeons/:runId/claim double → 409 RUN_ALREADY_CLAIMED', async () => {
    const r = await http(jar1, `/api/story/dungeons/${runId}/claim`, {
      method: 'POST',
      body: {},
    });
    assert(r.status === 409, `expected 409, got ${r.status}`);
    assert(
      r.body?.error?.code === 'RUN_ALREADY_CLAIMED',
      `expected RUN_ALREADY_CLAIMED, got ${r.body?.error?.code}`,
    );
  });

  // 26.
  await step(
    `POST /story/dungeons/:key/start oneTime + already claimed → 409 DUNGEON_ALREADY_CLEARED`,
    async () => {
      const r = await http(jar1, `/api/story/dungeons/${STORY_KEY}/start`, {
        method: 'POST',
        body: {},
      });
      assert(r.status === 409, `expected 409, got ${r.status}, body=${JSON.stringify(r.body)}`);
      assert(
        r.body?.error?.code === 'DUNGEON_ALREADY_CLEARED',
        `expected DUNGEON_ALREADY_CLEARED, got ${r.body?.error?.code}`,
      );
    },
  );

  // 27. Player2 — non-owner negative path.
  await step('register + onboard player2', async () => {
    jar2.clear();
    const reg = await http(jar2, '/api/_auth/register', {
      method: 'POST',
      body: { email: email2, password: password2 },
    });
    assert(reg.status === 200 || reg.status === 201, `register2 status=${reg.status}`);
    const onb = await http(jar2, '/api/character/onboard', {
      method: 'POST',
      body: { name: charName2, sectKey: SECT_KEY },
    });
    assert(
      onb.status === 200 || onb.status === 201,
      `onboard2 status=${onb.status}, body=${JSON.stringify(onb.body)}`,
    );
  });

  await step('POST /story/dungeons/:runId/advance (player2 non-owner) → 403 RUN_NOT_OWNED', async () => {
    const r = await http(jar2, `/api/story/dungeons/${runId}/advance`, {
      method: 'POST',
      body: {},
    });
    assert(r.status === 403, `expected 403, got ${r.status}, body=${JSON.stringify(r.body)}`);
    assert(
      r.body?.error?.code === 'RUN_NOT_OWNED',
      `expected RUN_NOT_OWNED, got ${r.body?.error?.code}`,
    );
  });

  await step('POST /story/dungeons/:runId/claim (player2 non-owner) → 403 RUN_NOT_OWNED', async () => {
    const r = await http(jar2, `/api/story/dungeons/${runId}/claim`, {
      method: 'POST',
      body: {},
    });
    assert(r.status === 403, `expected 403, got ${r.status}`);
    assert(
      r.body?.error?.code === 'RUN_NOT_OWNED',
      `expected RUN_NOT_OWNED, got ${r.body?.error?.code}`,
    );
  });

  // 28.
  await step('GET /story/dungeons (player2 isolation) → activeRun=null, target locked', async () => {
    const r = await http(jar2, '/api/story/dungeons');
    assert(r.status === 200, `expected 200, got ${r.status}`);
    assert(r.body?.data?.activeRun === null, 'activeRun should be null for player2');
    const target = r.body.data.dungeons.find((d) => d.key === STORY_KEY);
    assert(target, `target missing`);
    assert(
      target.status === 'locked',
      `expected locked for fresh player2, got ${target.status}`,
    );
  });

  // Summary.
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n[smoke:story-dungeon] ${passed}/${results.length} steps passed.`);
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
  console.error('[smoke:story-dungeon] fatal', e);
  process.exit(2);
});
