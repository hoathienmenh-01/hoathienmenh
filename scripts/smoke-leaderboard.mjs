#!/usr/bin/env node
/**
 * smoke-leaderboard.mjs — Leaderboard ranking endpoints smoke cho Xuân Tôi.
 *
 * Mục tiêu: cover 3 leaderboard endpoints qua HTTP — `apps/api/src/modules/
 * leaderboard`. Verify shape contract (rank/characterId/name/realmKey/
 * realmStage/power/level/sectKey | rank/sectId/sectKey/name/level/
 * treasuryLinhThach/memberCount/leaderName), sort order (power: realmOrder
 * desc → realmStage desc → power desc → level desc; sect: treasuryLinhThach
 * desc → level desc → createdAt asc), `clampLimit` boundary (limit ≥ 1 →
 * MAX_LIMIT 100, limit < 1 → 1, limit invalid/missing → DEFAULT_LIMIT 50),
 * và rank sequential 1..N invariant.
 *
 *   1. `GET /api/leaderboard/power` (no auth)         → 401.
 *   2. `GET /api/leaderboard/topup` (no auth)         → 401.
 *   3. `GET /api/leaderboard/sect`  (no auth)         → 401.
 *   4. `POST /api/_auth/register`                     — fresh user.
 *   5. `POST /api/character/onboard`                  — fresh char (xuất
 *                                                      hiện trong power
 *                                                      LB).
 *   6. `GET /api/leaderboard/power`                   → 200, rows array
 *                                                      (≥1 — chứa user
 *                                                      mới onboard).
 *                                                      Verify shape
 *                                                      cho row[0]
 *                                                      (rank=1,
 *                                                      characterId
 *                                                      uuid-shape,
 *                                                      name string,
 *                                                      realmKey string,
 *                                                      realmStage
 *                                                      number, power
 *                                                      number, level
 *                                                      number, sectKey
 *                                                      'thanh_van' /
 *                                                      'huyen_thuy' /
 *                                                      'tu_la' /
 *                                                      null). Verify
 *                                                      ranks sequential
 *                                                      (rank[i]=i+1).
 *                                                      Verify sort
 *                                                      desc theo
 *                                                      realmOrder /
 *                                                      realmStage /
 *                                                      power / level
 *                                                      tie-break.
 *   7. `GET /api/leaderboard/power?limit=5`           → 200, rows.length
 *                                                      ≤ 5 (clamp).
 *   8. `GET /api/leaderboard/power?limit=999`         → 200, rows.length
 *                                                      ≤ 100 (MAX_LIMIT
 *                                                      clamp).
 *   9. `GET /api/leaderboard/power?limit=0`           → 200, rows.length
 *                                                      ≥ 1 (MIN clamp;
 *                                                      controller
 *                                                      `limit ?
 *                                                      Number(limit) :
 *                                                      undefined` —
 *                                                      string '0'
 *                                                      truthy → n=0
 *                                                      → clampLimit
 *                                                      max(1,0)=1).
 *  10. `GET /api/leaderboard/topup`                   → 200, rows array
 *                                                      (empty cho
 *                                                      fresh stack
 *                                                      v\u00ec ch\u01b0a
 *                                                      có APPROVED
 *                                                      topup order
 *                                                      n\u00e0o).
 *                                                      Verify shape
 *                                                      n\u1ebfu non
 *                                                      -empty.
 *  11. `GET /api/leaderboard/sect`                    → 200, rows.length
 *                                                      ≥ 1 (sẽ có
 *                                                      ít nhất sect
 *                                                      mà user mới
 *                                                      onboard ở step
 *                                                      5 — sect
 *                                                      được lazy
 *                                                      upsert qua
 *                                                      `character
 *                                                      .service.ts`).
 *                                                      Verify shape
 *                                                      (rank,
 *                                                      sectId, sectKey,
 *                                                      name,
 *                                                      level,
 *                                                      treasuryLinhThach
 *                                                      string,
 *                                                      memberCount,
 *                                                      leaderName).
 *                                                      Verify ranks
 *                                                      sequential.
 *                                                      Verify sort
 *                                                      desc theo
 *                                                      treasuryLinhThach
 *                                                      (BigInt
 *                                                      compare) /
 *                                                      level /
 *                                                      createdAt asc.
 *  12. `GET /api/leaderboard/sect?limit=2`            → 200, rows.length
 *                                                      ≤ 2 (clamp).
 *  13. `POST /api/_auth/logout` + GET power           → 401.
 *
 * Read-only endpoint, không anti-FE-self-grant invariant (no mutation),
 * nhưng có verify clampLimit boundary + sort/rank invariant.
 *
 * Chạy:
 *   pnpm smoke:leaderboard
 *   # hoặc trực tiếp:
 *   node scripts/smoke-leaderboard.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE     — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS   — default 10000ms / request.
 *   SMOKE_VERBOSE      — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY     — default "thanh_van".
 *
 * Yêu cầu môi trường (giống smoke:next-action):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:leaderboard`
 *
 * Lưu ý: 3 sect (`thanh_van` / `huyen_thuy` / `tu_la`) KHÔNG được seed
 * sẵn — sect được lazy upsert qua `character.service.ts:onboard` lần đầu
 * có user chọn sect đó. Smoke này chỉ verify rows.length ≥ 1 (sect của
 * user mới onboard) chứ không assume cả 3 đã tồn tại.
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
const MAX_LIMIT = 100;
const VALID_SECT_KEYS = new Set(['thanh_van', 'huyen_thuy', 'tu_la']);

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
  process.stdout.write(`[smoke:leaderboard] ${name} ... `);
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
  return `smoke-leaderboard-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `lb_${rand}`;
}

/**
 * Verify ranks sequential (rank[i] === i + 1).
 * @param {any[]} rows
 * @param {string} label
 */
function assertRanksSequential(rows, label) {
  for (let i = 0; i < rows.length; i++) {
    const expected = i + 1;
    const got = rows[i]?.rank;
    if (got !== expected) {
      throw new Error(`${label}: rank[${i}]=${got}, expect ${expected} (sequential 1..N)`);
    }
  }
}

/**
 * Verify each row sorted desc theo composite key (compareFn).
 * `compareFn(prev, cur)` should return positive if prev > cur (sorted desc).
 * @param {any[]} rows
 * @param {(a: any, b: any) => number} compareFn
 * @param {string} label
 */
function assertSortedDesc(rows, compareFn, label) {
  for (let i = 1; i < rows.length; i++) {
    const cmp = compareFn(rows[i - 1], rows[i]);
    if (cmp < 0) {
      throw new Error(
        `${label}: row[${i - 1}] (${JSON.stringify(rows[i - 1]).slice(0, 120)}) < row[${i}] (${JSON.stringify(rows[i]).slice(0, 120)}) — phải sorted desc`,
      );
    }
  }
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

async function main() {
  console.log(
    `[smoke:leaderboard] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, sect = ${SECT_KEY}`,
  );

  // 1. GET /power chưa auth → 401.
  await step('GET /leaderboard/power — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/leaderboard/power');
    assertStatus(r, 401, 'GET /power unauth');
    assert(
      r.body?.error?.code === 'UNAUTHENTICATED',
      `GET /power unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`,
    );
  });

  // 2. GET /topup chưa auth → 401.
  await step('GET /leaderboard/topup — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/leaderboard/topup');
    assertStatus(r, 401, 'GET /topup unauth');
    assert(
      r.body?.error?.code === 'UNAUTHENTICATED',
      `GET /topup unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`,
    );
  });

  // 3. GET /sect chưa auth → 401.
  await step('GET /leaderboard/sect — 401 UNAUTHENTICATED', async () => {
    const r = await http('/api/leaderboard/sect');
    assertStatus(r, 401, 'GET /sect unauth');
    assert(
      r.body?.error?.code === 'UNAUTHENTICATED',
      `GET /sect unauth: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`,
    );
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

  // 5. Onboard character — đảm bảo có ≥ 1 row trong power LB.
  /** @type {string} */
  let myCharId;
  /** @type {string} */
  let myCharName;
  await step('onboard — create character', async () => {
    myCharName = randomCharName();
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: myCharName, sectKey: SECT_KEY },
    });
    assertStatus(r, 200, 'onboard');
    if (!r.body?.ok)
      throw new Error(`onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const c = r.body?.data?.character;
    assert(c?.id, 'onboard: missing character.id');
    myCharId = c.id;
  });

  // 6. GET /power → 200, rows ≥ 1, shape verify, ranks sequential, sorted desc.
  await step('GET /leaderboard/power — shape + ranks sequential + sort desc', async () => {
    const r = await http('/api/leaderboard/power');
    assertStatus(r, 200, 'GET /power');
    if (!r.body?.ok)
      throw new Error(`GET /power: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const rows = r.body?.data?.rows;
    assert(Array.isArray(rows), 'GET /power: rows phải array');
    assert(rows.length >= 1, `GET /power: rows.length >= 1 (chứa user mới onboard), got ${rows.length}`);

    // Shape verify cho mỗi row.
    for (const row of rows) {
      assert(typeof row.rank === 'number' && row.rank >= 1, `GET /power: rank phải số >= 1, got ${row.rank}`);
      assert(typeof row.characterId === 'string' && row.characterId.length > 0, `GET /power: characterId phải string non-empty, got ${typeof row.characterId}`);
      assert(typeof row.name === 'string' && row.name.length > 0, `GET /power: name phải string non-empty`);
      assert(typeof row.realmKey === 'string' && row.realmKey.length > 0, `GET /power: realmKey phải string non-empty`);
      assert(typeof row.realmStage === 'number' && row.realmStage >= 1 && row.realmStage <= 9, `GET /power: realmStage phải 1..9, got ${row.realmStage}`);
      assert(typeof row.power === 'number', `GET /power: power phải number`);
      assert(typeof row.level === 'number', `GET /power: level phải number`);
      assert(row.sectKey === null || VALID_SECT_KEYS.has(row.sectKey), `GET /power: sectKey phải null|thanh_van|huyen_thuy|tu_la, got ${row.sectKey}`);
    }

    // Ranks sequential.
    assertRanksSequential(rows, 'GET /power');

    // Sort desc — composite: realmStage desc → power desc → level desc.
    // (realmKey order comes from realmByKey().order — không expose qua API,
    //  nhưng characters tier 0 (Phàm Nhân) có realmStage=1..9 và sort theo
    //  realmStage trong cùng tier sẽ work cho fresh chars nếu cùng realmKey.)
    assertSortedDesc(
      rows,
      (a, b) => {
        // Cùng realmKey → so realmStage → power → level desc.
        if (a.realmKey === b.realmKey) {
          if (a.realmStage !== b.realmStage) return a.realmStage - b.realmStage;
          if (a.power !== b.power) return a.power - b.power;
          return a.level - b.level;
        }
        // Khác realmKey → KHÔNG verify (cần realmByKey().order — không expose).
        return 1; // skip pair compare across realm.
      },
      'GET /power sort',
    );

    // User mới onboard phải xuất hiện trong rows.
    const myRow = rows.find((r) => r.characterId === myCharId);
    assert(myRow, `GET /power: character mới onboard (${myCharId}) phải xuất hiện trong rows`);
    assert(myRow.name === myCharName, `GET /power: my row name expect '${myCharName}', got '${myRow.name}'`);
    assert(myRow.sectKey === SECT_KEY, `GET /power: my row sectKey expect '${SECT_KEY}', got '${myRow.sectKey}'`);
  });

  // 7. GET /power?limit=5 → rows.length ≤ 5.
  await step('GET /leaderboard/power?limit=5 — clamp ≤ 5', async () => {
    const r = await http('/api/leaderboard/power?limit=5');
    assertStatus(r, 200, 'GET /power?limit=5');
    const rows = r.body?.data?.rows;
    assert(Array.isArray(rows), 'GET /power?limit=5: rows phải array');
    assert(rows.length <= 5, `GET /power?limit=5: rows.length <= 5 expected, got ${rows.length}`);
    assertRanksSequential(rows, 'GET /power?limit=5');
  });

  // 8. GET /power?limit=999 → rows.length ≤ MAX_LIMIT (100).
  await step('GET /leaderboard/power?limit=999 — clamp MAX_LIMIT 100', async () => {
    const r = await http('/api/leaderboard/power?limit=999');
    assertStatus(r, 200, 'GET /power?limit=999');
    const rows = r.body?.data?.rows;
    assert(Array.isArray(rows), 'GET /power?limit=999: rows phải array');
    assert(rows.length <= MAX_LIMIT, `GET /power?limit=999: rows.length <= ${MAX_LIMIT} clamp expected, got ${rows.length}`);
    assertRanksSequential(rows, 'GET /power?limit=999');
  });

  // 9. GET /power?limit=0 → rows.length >= 1 (clamp MIN: clampLimit(0) → 1).
  await step('GET /leaderboard/power?limit=0 — clamp MIN 1', async () => {
    const r = await http('/api/leaderboard/power?limit=0');
    assertStatus(r, 200, 'GET /power?limit=0');
    const rows = r.body?.data?.rows;
    assert(Array.isArray(rows), 'GET /power?limit=0: rows phải array');
    // Note: controller `limit ? Number(limit) : undefined` — '0' truthy →
    // n=0 → clampLimit(0) → Math.max(1, 0)=1 → take 1 row.
    assert(rows.length >= 1, `GET /power?limit=0: rows.length >= 1 (clamp MIN), got ${rows.length}`);
    assert(rows.length === 1, `GET /power?limit=0: rows.length === 1 (clamp tới MIN), got ${rows.length}`);
  });

  // 10. GET /topup → 200, rows array (empty cho fresh stack — chưa có
  //     APPROVED topup order). Verify shape nếu non-empty.
  await step('GET /leaderboard/topup — empty cho fresh stack', async () => {
    const r = await http('/api/leaderboard/topup');
    assertStatus(r, 200, 'GET /topup');
    if (!r.body?.ok)
      throw new Error(`GET /topup: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const rows = r.body?.data?.rows;
    assert(Array.isArray(rows), 'GET /topup: rows phải array');
    // Fresh stack — KHÔNG có APPROVED topup order → rows=[]. KHÔNG hard
    // assert empty (test có thể chạy sau session khác seed pendingTopup),
    // chỉ verify shape nếu có row.
    for (const row of rows) {
      assert(typeof row.rank === 'number' && row.rank >= 1, `GET /topup: rank phải số >= 1, got ${row.rank}`);
      assert(typeof row.characterId === 'string', 'GET /topup: characterId phải string');
      assert(typeof row.name === 'string', 'GET /topup: name phải string');
      assert(typeof row.realmKey === 'string', 'GET /topup: realmKey phải string');
      assert(typeof row.realmStage === 'number', 'GET /topup: realmStage phải number');
      assert(typeof row.totalTienNgoc === 'number' && row.totalTienNgoc > 0, `GET /topup: totalTienNgoc phải số > 0 (loại 0/negative), got ${row.totalTienNgoc}`);
      assert(row.sectKey === null || VALID_SECT_KEYS.has(row.sectKey), `GET /topup: sectKey hợp lệ, got ${row.sectKey}`);
    }
    assertRanksSequential(rows, 'GET /topup');
  });

  // 11. GET /sect → 200, rows ≥ 1 (sect của user mới onboard). Shape +
  //     sort + ranks.
  await step('GET /leaderboard/sect — shape + sort + ranks', async () => {
    const r = await http('/api/leaderboard/sect');
    assertStatus(r, 200, 'GET /sect');
    if (!r.body?.ok)
      throw new Error(`GET /sect: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const rows = r.body?.data?.rows;
    assert(Array.isArray(rows), 'GET /sect: rows phải array');
    assert(rows.length >= 1, `GET /sect: rows.length >= 1 (sect của user mới onboard), got ${rows.length}`);

    // Shape verify mỗi row.
    for (const row of rows) {
      assert(typeof row.rank === 'number' && row.rank >= 1, `GET /sect: rank phải số >= 1`);
      assert(typeof row.sectId === 'string' && row.sectId.length > 0, 'GET /sect: sectId phải string non-empty');
      assert(row.sectKey === null || VALID_SECT_KEYS.has(row.sectKey), `GET /sect: sectKey null|thanh_van|huyen_thuy|tu_la, got ${row.sectKey}`);
      assert(typeof row.name === 'string' && row.name.length > 0, 'GET /sect: name phải string non-empty');
      assert(typeof row.level === 'number' && row.level >= 1, `GET /sect: level phải số >= 1, got ${row.level}`);
      assert(typeof row.treasuryLinhThach === 'string', `GET /sect: treasuryLinhThach phải string (BigInt stringified), got ${typeof row.treasuryLinhThach}`);
      assert(/^-?\d+$/.test(row.treasuryLinhThach), `GET /sect: treasuryLinhThach phải khớp regex digits, got '${row.treasuryLinhThach}'`);
      assert(typeof row.memberCount === 'number' && row.memberCount >= 0, `GET /sect: memberCount phải số >= 0, got ${row.memberCount}`);
      assert(row.leaderName === null || typeof row.leaderName === 'string', `GET /sect: leaderName phải null|string, got ${typeof row.leaderName}`);
    }

    // Ranks sequential 1..N.
    assertRanksSequential(rows, 'GET /sect');

    // Sort desc theo treasuryLinhThach (BigInt) → level (number) → createdAt
    // asc (không expose qua API, không verify ở đây).
    assertSortedDesc(
      rows,
      (a, b) => {
        const tA = BigInt(a.treasuryLinhThach);
        const tB = BigInt(b.treasuryLinhThach);
        if (tA !== tB) return tA > tB ? 1 : -1;
        return a.level - b.level;
      },
      'GET /sect sort',
    );

    // Sect của user mới onboard phải xuất hiện (sect lazy upsert
    // qua `character.service.ts:onboard` — KHÔNG seed sẵn 3 sect).
    // 3 sect (thanh_van/huyen_thuy/tu_la) chỉ xuất hiện nếu đã có
    // user onboard vào mỗi sect.
    const sectKeys = rows.map((r) => r.sectKey).filter((k) => k !== null);
    assert(
      sectKeys.includes(SECT_KEY),
      `GET /sect: sect ${SECT_KEY} (user mới onboard) phải xuất hiện, got sectKeys=${JSON.stringify(sectKeys)}`,
    );

    // User mới onboard vào sect SECT_KEY → memberCount của sect đó >= 1.
    const mySect = rows.find((r) => r.sectKey === SECT_KEY);
    assert(mySect, `GET /sect: sect ${SECT_KEY} phải xuất hiện`);
    assert(mySect.memberCount >= 1, `GET /sect: sect ${SECT_KEY} memberCount >= 1 (user mới onboard), got ${mySect.memberCount}`);
  });

  // 12. GET /sect?limit=2 → rows.length ≤ 2.
  await step('GET /leaderboard/sect?limit=2 — clamp ≤ 2', async () => {
    const r = await http('/api/leaderboard/sect?limit=2');
    assertStatus(r, 200, 'GET /sect?limit=2');
    const rows = r.body?.data?.rows;
    assert(Array.isArray(rows), 'GET /sect?limit=2: rows phải array');
    assert(rows.length <= 2, `GET /sect?limit=2: rows.length <= 2 expected, got ${rows.length}`);
    assertRanksSequential(rows, 'GET /sect?limit=2');
  });

  // 13. logout + GET /power → 401 UNAUTHENTICATED.
  await step('logout + GET /leaderboard/power — 401 UNAUTHENTICATED', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const r = await http('/api/leaderboard/power');
    assertStatus(r, 401, 'GET /power post-logout');
    assert(
      r.body?.error?.code === 'UNAUTHENTICATED',
      `GET /power post-logout: expect code UNAUTHENTICATED, got ${r.body?.error?.code}`,
    );
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:leaderboard] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:leaderboard] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:leaderboard] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:leaderboard] unexpected error:', err);
  process.exitCode = 1;
});
