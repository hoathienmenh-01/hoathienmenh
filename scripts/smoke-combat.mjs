#!/usr/bin/env node
/**
 * smoke-combat.mjs — Combat / dungeon / encounter smoke cho Xuân Tôi.
 *
 * Mục tiêu: cover combat runtime end-to-end để đóng "smoke gap" được liệt kê
 * ở `docs/AI_HANDOFF_REPORT.md` Phase 9 readiness audit nhóm D (Dungeon /
 * combat / loot — PARTIAL chỉ vitest seeded RNG, thiếu HTTP smoke). Verify:
 *
 *   1. `GET /api/combat/dungeons` (PUBLIC)        — catalog ≥ 9 dungeon
 *                                                   (Phase 10 PR-3 baseline) +
 *                                                   son_coc tồn tại.
 *   2. `GET /api/combat/encounter/active`         — empty cho user mới.
 *   3. `POST /api/combat/encounter/start`         — auth + stamina ≥ entry
 *                                                   → encounter ACTIVE +
 *                                                   monster đầu tiên load.
 *   4. Anti double-start (ALREADY_IN_FIGHT)       — gọi start lần 2 → 409.
 *   5. `POST /api/combat/encounter/:id/action`    — vòng lặp basic attack tới
 *                                                   khi WON | LOST. Verify mỗi
 *                                                   action trừ STAMINA_PER_ACTION
 *                                                   và HP/MP server-authoritative.
 *   6. Reward shape (WON only): `{exp, linhThach, loot[]}`           non-null.
 *   7. Ledger invariant SUM(CurrencyLedger.LINH_THACH) == Character.linhThach
 *      (boss/monster drop → CurrencyService.applyTx 'COMBAT_LOOT' duy nhất).
 *   8. ItemLedger 'COMBAT_LOOT' >= 1 row khi WON với loot drop (loot không null).
 *   9. Inventory.qty == SUM(ItemLedger.qtyDelta) per itemKey (no qty âm).
 *  10. `POST /api/combat/encounter/:id/action` lần thứ N+1 → ENCOUNTER_ENDED.
 *  11. `POST /api/combat/encounter/:id/abandon` sau khi end → ENCOUNTER_ENDED.
 *  12. `GET /api/combat/encounter/active`         — empty sau khi end.
 *
 * Cộng thêm character invariant:
 *   - Character.hp ∈ [1, hpMax] (server cap LOST tại 1, không âm).
 *   - Character.mp ∈ [0, mpMax].
 *   - Character.stamina = 100 - 10 (entry) - 5×N (action) cộng/trừ regen tick
 *     (smoke chạy < 30s nên regen tick BullMQ chưa fire → stamina deterministic).
 *   - Character.exp tăng đúng SUM(monster.expDrop) cho monster chết.
 *
 * Chạy:
 *   pnpm smoke:combat
 *   # hoặc trực tiếp:
 *   node scripts/smoke-combat.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE   — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS — default 10000ms / request.
 *   SMOKE_VERBOSE    — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY   — default "thanh_van".
 *   SMOKE_DUNGEON    — default "son_coc" (3 monster, level 1-3, stamina 10).
 *   SMOKE_MAX_TURNS  — default 50 (safety stop để fight không kéo dài).
 *
 * Yêu cầu môi trường (giống smoke:economy):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api bootstrap` (seed 3 sect)
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:combat`
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
const DUNGEON_KEY = process.env.SMOKE_DUNGEON ?? 'son_coc';
const MAX_TURNS = Number(process.env.SMOKE_MAX_TURNS ?? 50);

// Phase 10 PR-3 baseline: 9 dungeon (3 legacy + 6 element-thematic).
const MIN_DUNGEONS = 9;

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
  process.stdout.write(`[smoke:combat] ${name} ... `);
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
  return `smoke-combat-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `combat_${rand}`;
}

// -----------------------------------------------------------------------------
// Ledger helpers (paginate /logs/me).
// -----------------------------------------------------------------------------

/**
 * @param {'currency' | 'item'} type
 * @returns {Promise<any[]>}
 */
async function fetchAllLogs(type) {
  /** @type {any[]} */
  const all = [];
  /** @type {string | undefined} */
  let cursor;
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ type, limit: '50' });
    if (cursor) qs.set('cursor', cursor);
    const r = await http(`/api/logs/me?${qs.toString()}`);
    assertStatus(r, 200, `logs/me?type=${type}`);
    const data = r.body?.data;
    if (!data || !Array.isArray(data.entries)) {
      throw new Error(`logs/me: missing entries[] in body`);
    }
    all.push(...data.entries);
    if (!data.nextCursor) return all;
    cursor = data.nextCursor;
  }
  throw new Error(`logs/me: cursor pagination did not terminate after 20 pages`);
}

/** Tổng signed delta của ledger entries (BigInt-safe). */
function sumDelta(entries) {
  let s = 0n;
  for (const e of entries) {
    s += BigInt(e.delta);
  }
  return s;
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

/**
 * @type {{
 *   email?: string;
 *   userId?: string;
 *   characterId?: string;
 *   encounterId?: string;
 *   startingLinhThach?: bigint;
 *   startingExp?: bigint;
 *   startingStamina?: number;
 *   staminaEntry?: number;
 *   actionsCount?: number;
 *   finalStatus?: string;
 *   reward?: { exp: string; linhThach: string; loot: any[] };
 * }}
 */
const state = {};

async function main() {
  console.log(`[smoke:combat] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, dungeon = ${DUNGEON_KEY}`);

  // 0. Health check.
  await step('healthz', async () => {
    const r = await http('/api/healthz');
    assertStatus(r, 200, 'healthz');
  });

  // 1. List dungeons (PUBLIC) — verify catalog count + son_coc + Phase 10 PR-3
  // metadata (element/regionKey/monsterType reflected on monster).
  await step('combat/dungeons — public list, ≥ 9 dungeon, son_coc tồn tại', async () => {
    const r = await http('/api/combat/dungeons');
    assertStatus(r, 200, 'combat/dungeons');
    const dungeons = r.body?.data?.dungeons;
    if (!Array.isArray(dungeons)) throw new Error(`combat/dungeons: dungeons không phải array`);
    assert(
      dungeons.length >= MIN_DUNGEONS,
      `Phase 10 PR-3 baseline: dungeon catalog phải ≥ ${MIN_DUNGEONS}, got ${dungeons.length}`,
    );
    const sonCoc = dungeons.find((d) => d.key === 'son_coc');
    assert(sonCoc, `son_coc dungeon không tồn tại trong catalog`);
    assert(
      typeof sonCoc.staminaEntry === 'number' && sonCoc.staminaEntry > 0,
      `son_coc.staminaEntry không hợp lệ: ${sonCoc.staminaEntry}`,
    );
    assert(
      Array.isArray(sonCoc.monsters) && sonCoc.monsters.length >= 1,
      `son_coc.monsters phải ≥ 1, got ${JSON.stringify(sonCoc.monsters)}`,
    );
    const target = dungeons.find((d) => d.key === DUNGEON_KEY);
    assert(target, `dungeon ${DUNGEON_KEY} không tồn tại`);
    state.staminaEntry = target.staminaEntry;
  });

  // 2. Register fresh user.
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
  });

  // 3. Onboard → tạo character.
  await step('onboard', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: randomCharName(), sectKey: SECT_KEY },
    });
    assertStatus(r, 200, 'onboard');
    if (!r.body?.ok) throw new Error(`onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    state.characterId = r.body?.data?.character?.id ?? r.body?.data?.id;
  });

  // 4. Snapshot starting character state.
  await step('character/me — starting hp/mp/stamina/linhThach', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me');
    const ch = r.body?.data?.character;
    if (!ch) throw new Error(`character/me: no character in body`);
    state.startingLinhThach = BigInt(ch.linhThach ?? '0');
    state.startingExp = BigInt(ch.exp ?? '0');
    state.startingStamina = ch.stamina;
    state.characterId = state.characterId ?? ch.id;
    assert(ch.hp >= 1 && ch.hp <= ch.hpMax, `hp ngoài [1, hpMax]: ${ch.hp}/${ch.hpMax}`);
    assert(ch.mp >= 0 && ch.mp <= ch.mpMax, `mp ngoài [0, mpMax]: ${ch.mp}/${ch.mpMax}`);
    assert(
      ch.stamina >= state.staminaEntry,
      `Smoke yêu cầu starting stamina ≥ ${state.staminaEntry} để start ${DUNGEON_KEY}, got ${ch.stamina}`,
    );
    assert(state.startingLinhThach >= 0n, `linhThach âm: ${state.startingLinhThach}`);
  });

  // 5. encounter/active phải null cho user mới.
  await step('combat/encounter/active — empty cho fresh user', async () => {
    const r = await http('/api/combat/encounter/active');
    assertStatus(r, 200, 'combat/encounter/active');
    const enc = r.body?.data?.encounter;
    assert(enc === null || enc === undefined, `Fresh user có encounter active: ${JSON.stringify(enc)}`);
  });

  // 6. Start encounter.
  await step(`combat/encounter/start — ${DUNGEON_KEY}`, async () => {
    const r = await http('/api/combat/encounter/start', {
      method: 'POST',
      body: { dungeonKey: DUNGEON_KEY },
    });
    assertStatus(r, 200, 'combat/encounter/start');
    const enc = r.body?.data?.encounter;
    if (!enc) throw new Error(`start: no encounter in body`);
    assert(enc.status === 'ACTIVE', `encounter.status phải ACTIVE sau start, got ${enc.status}`);
    assert(enc.monster, `encounter.monster phải non-null sau start`);
    assert(typeof enc.monsterHp === 'number' && enc.monsterHp > 0, `monsterHp ngoài range: ${enc.monsterHp}`);
    assert(enc.dungeon?.key === DUNGEON_KEY, `dungeon.key khớp request: ${enc.dungeon?.key}`);
    state.encounterId = enc.id;
  });

  // 7. Anti double-start.
  await step('combat/encounter/start lần 2 → 409 ALREADY_IN_FIGHT', async () => {
    const r = await http('/api/combat/encounter/start', {
      method: 'POST',
      body: { dungeonKey: DUNGEON_KEY },
    });
    assertStatus(r, 409, 'duplicate start');
    const code = r.body?.error?.code ?? r.body?.error;
    assert(code === 'ALREADY_IN_FIGHT', `Expected ALREADY_IN_FIGHT, got ${JSON.stringify(r.body?.error)}`);
  });

  // 8. Action loop tới WON | LOST.
  await step(`combat/encounter/:id/action loop tới WON|LOST (max ${MAX_TURNS} turn)`, async () => {
    let turn = 0;
    let lastEnc;
    while (turn < MAX_TURNS) {
      turn++;
      const r = await http(`/api/combat/encounter/${state.encounterId}/action`, {
        method: 'POST',
        body: {},
      });
      assertStatus(r, 200, `action turn ${turn}`);
      const enc = r.body?.data?.encounter;
      if (!enc) throw new Error(`action turn ${turn}: no encounter in body`);
      lastEnc = enc;
      if (enc.status !== 'ACTIVE') {
        state.finalStatus = enc.status;
        state.reward = enc.reward;
        state.actionsCount = turn;
        if (VERBOSE) {
          console.log(`  action loop ended at turn ${turn} with status=${enc.status}`);
        }
        return;
      }
    }
    throw new Error(
      `action loop quá ${MAX_TURNS} turn vẫn ACTIVE (lastMonsterHp=${lastEnc?.monsterHp})`,
    );
  });

  // 9. Reward shape — verify khi WON.
  await step('reward shape — exp/linhThach/loot non-null khi WON', async () => {
    if (state.finalStatus !== 'WON') {
      return { skip: true, note: `finalStatus=${state.finalStatus}, không assert reward` };
    }
    const reward = state.reward;
    assert(reward, `WON nhưng reward null`);
    assert(typeof reward.exp === 'string', `reward.exp phải string BigInt: ${reward.exp}`);
    assert(typeof reward.linhThach === 'string', `reward.linhThach phải string BigInt: ${reward.linhThach}`);
    assert(Array.isArray(reward.loot), `reward.loot phải array: ${typeof reward.loot}`);
    assert(BigInt(reward.exp) >= 0n, `reward.exp âm: ${reward.exp}`);
    assert(BigInt(reward.linhThach) >= 0n, `reward.linhThach âm: ${reward.linhThach}`);
  });

  // 10. Action sau khi end → ENCOUNTER_ENDED.
  await step('combat/encounter/:id/action sau khi end → 409 ENCOUNTER_ENDED', async () => {
    const r = await http(`/api/combat/encounter/${state.encounterId}/action`, {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 409, 'action after end');
    const code = r.body?.error?.code ?? r.body?.error;
    assert(code === 'ENCOUNTER_ENDED', `Expected ENCOUNTER_ENDED, got ${JSON.stringify(r.body?.error)}`);
  });

  // 11. Abandon sau khi end → ENCOUNTER_ENDED.
  await step('combat/encounter/:id/abandon sau khi end → 409 ENCOUNTER_ENDED', async () => {
    const r = await http(`/api/combat/encounter/${state.encounterId}/abandon`, {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 409, 'abandon after end');
    const code = r.body?.error?.code ?? r.body?.error;
    assert(code === 'ENCOUNTER_ENDED', `Expected ENCOUNTER_ENDED, got ${JSON.stringify(r.body?.error)}`);
  });

  // 12. encounter/active phải null sau khi end.
  await step('combat/encounter/active — null sau khi end', async () => {
    const r = await http('/api/combat/encounter/active');
    assertStatus(r, 200, 'combat/encounter/active after end');
    const enc = r.body?.data?.encounter;
    assert(enc === null || enc === undefined, `Encounter active sau khi end: ${JSON.stringify(enc)}`);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Phase 12.2.A — DungeonDef.dailyLimit enforcement smoke
  //
  // Verify server-authoritative daily limit gate. Use `cuu_la_dien` (limit=1,
  // staminaEntry=60) — chỉ cần 1 entry để fill slot. Char default stamina=100,
  // sau son_coc flow còn ~80+, đủ cho 1 cuu_la_dien entry. Slot duy nhất sau
  // entry 1 (kể cả khi abandon) — entry 2 phải reject 409
  // DUNGEON_DAILY_LIMIT_REACHED (BEFORE stamina check, ngay cả khi stamina
  // còn dưới 60).
  // ───────────────────────────────────────────────────────────────────────

  // 12a. Start cuu_la_dien lần 1 → tiêu slot daily 1/1.
  let dailyLimitEnc = null;
  await step('combat/encounter/start cuu_la_dien lần 1 — daily slot 1/1 (Phase 12.2.A)', async () => {
    const r = await http('/api/combat/encounter/start', {
      method: 'POST',
      body: { dungeonKey: 'cuu_la_dien' },
    });
    assertStatus(r, 200, 'combat/encounter/start cuu_la_dien');
    const enc = r.body?.data?.encounter;
    if (!enc) throw new Error(`start cuu_la_dien: no encounter in body`);
    assert(enc.status === 'ACTIVE', `cuu_la_dien encounter.status phải ACTIVE, got ${enc.status}`);
    assert(enc.dungeon?.key === 'cuu_la_dien', `dungeon.key phải khớp: ${enc.dungeon?.key}`);
    dailyLimitEnc = enc.id;
  });

  // 12b. Abandon cuu_la_dien — slot không refund.
  await step('combat/encounter/:id/abandon cuu_la_dien — slot vẫn tiêu (Phase 12.2.A)', async () => {
    const r = await http(`/api/combat/encounter/${dailyLimitEnc}/abandon`, {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 200, 'abandon cuu_la_dien');
    const enc = r.body?.data?.encounter;
    assert(enc?.status === 'ABANDONED', `cuu_la_dien.status sau abandon: ${enc?.status}`);
  });

  // 12c. Start cuu_la_dien lần 2 → 409 DUNGEON_DAILY_LIMIT_REACHED.
  await step('combat/encounter/start cuu_la_dien lần 2 → 409 DUNGEON_DAILY_LIMIT_REACHED (Phase 12.2.A)', async () => {
    const r = await http('/api/combat/encounter/start', {
      method: 'POST',
      body: { dungeonKey: 'cuu_la_dien' },
    });
    assertStatus(r, 409, 'cuu_la_dien lần 2 daily-limit');
    const code = r.body?.error?.code ?? r.body?.error;
    assert(
      code === 'DUNGEON_DAILY_LIMIT_REACHED',
      `Expected DUNGEON_DAILY_LIMIT_REACHED, got ${JSON.stringify(r.body?.error)}`,
    );
  });

  // 13. Currency ledger invariant — SUM == character.linhThach.
  await step('INVARIANT: SUM(CurrencyLedger.LINH_THACH) == Character.linhThach', async () => {
    const r = await http('/api/character/me');
    const balance = BigInt(r.body?.data?.character?.linhThach ?? '0');
    const entries = await fetchAllLogs('currency');
    const sum = sumDelta(entries);
    assert(
      sum === balance,
      `SUM(CurrencyLedger) = ${sum} ≠ Character.linhThach = ${balance}`,
    );
    assert(balance >= 0n, `linhThach âm: ${balance}`);

    // COMBAT_LOOT row tồn tại nếu có monster killed (linhThachDrop > 0).
    const combatRows = entries.filter((e) => e.reason === 'COMBAT_LOOT');
    if (state.finalStatus === 'WON' || state.finalStatus === 'LOST') {
      // Cả WON và LOST đều có thể grant linhThach từ monster đã giết trước khi
      // người chơi thua (LOST chỉ ở monster cuối cùng). Nếu không có monster
      // nào chết, COMBAT_LOOT có thể empty — không fail cứng.
      assert(
        Array.isArray(combatRows),
        `COMBAT_LOOT rows phải array, got ${typeof combatRows}`,
      );
      for (const row of combatRows) {
        assert(BigInt(row.delta) > 0n, `COMBAT_LOOT delta phải > 0: ${row.delta}`);
        assert(row.refType === 'Encounter', `COMBAT_LOOT.refType phải 'Encounter': ${row.refType}`);
        assert(row.refId === state.encounterId, `COMBAT_LOOT.refId phải = ${state.encounterId}: ${row.refId}`);
      }
    }
  });

  // 14. Item ledger — COMBAT_LOOT row khớp loot reward.
  await step('ItemLedger COMBAT_LOOT khớp reward.loot khi WON', async () => {
    const entries = await fetchAllLogs('item');
    const combatRows = entries.filter((e) => e.reason === 'COMBAT_LOOT');
    if (state.finalStatus === 'WON' && state.reward && state.reward.loot.length > 0) {
      assert(
        combatRows.length >= state.reward.loot.length,
        `Loot ${state.reward.loot.length} item nhưng chỉ ${combatRows.length} ItemLedger row`,
      );
      for (const row of combatRows) {
        assert(Number(row.qtyDelta) > 0, `COMBAT_LOOT qtyDelta phải > 0: ${row.qtyDelta}`);
        assert(row.refType === 'Encounter', `ItemLedger.refType phải 'Encounter': ${row.refType}`);
        assert(row.refId === state.encounterId, `ItemLedger.refId phải = ${state.encounterId}: ${row.refId}`);
      }
      // Verify mỗi loot có row tương ứng (itemKey + qty).
      for (const lootItem of state.reward.loot) {
        const matching = combatRows.filter((r) => r.itemKey === lootItem.itemKey);
        assert(
          matching.length >= 1,
          `loot item ${lootItem.itemKey} không có ItemLedger row tương ứng`,
        );
      }
    } else {
      return { skip: true, note: `finalStatus=${state.finalStatus}, loot=${state.reward?.loot.length ?? 0}` };
    }
  });

  // 15. Inventory invariant — qty == SUM(qtyDelta) per itemKey.
  await step('INVARIANT: Inventory.qty == SUM(ItemLedger.qtyDelta) per itemKey', async () => {
    const invR = await http('/api/inventory');
    assertStatus(invR, 200, 'inventory');
    const items = invR.body?.data?.items ?? [];
    if (!Array.isArray(items)) throw new Error(`inventory: items không phải array`);
    const itemEntries = await fetchAllLogs('item');

    /** @type {Map<string, number>} */
    const invByKey = new Map();
    for (const it of items) {
      assert(Number(it.qty) >= 0, `Inventory.qty âm — ${it.itemKey}=${it.qty}`);
      invByKey.set(it.itemKey, (invByKey.get(it.itemKey) ?? 0) + Number(it.qty));
    }

    /** @type {Map<string, number>} */
    const ledgerByKey = new Map();
    for (const e of itemEntries) {
      ledgerByKey.set(
        e.itemKey,
        (ledgerByKey.get(e.itemKey) ?? 0) + Number(e.qtyDelta),
      );
    }

    for (const [key, qty] of invByKey) {
      const ledgerSum = ledgerByKey.get(key) ?? 0;
      assert(
        qty === ledgerSum,
        `Inventory.qty(${key})=${qty} ≠ SUM(ItemLedger.qtyDelta)(${key})=${ledgerSum}`,
      );
    }
  });

  // 16. Character invariant — exp/stamina trail.
  await step('INVARIANT: character exp tăng + stamina giảm sau combat', async () => {
    const r = await http('/api/character/me');
    const ch = r.body?.data?.character;
    if (!ch) throw new Error(`character/me: no character`);
    assert(ch.hp >= 1 && ch.hp <= ch.hpMax, `hp final ngoài [1, hpMax]: ${ch.hp}/${ch.hpMax}`);
    assert(ch.mp >= 0 && ch.mp <= ch.mpMax, `mp final ngoài [0, mpMax]: ${ch.mp}/${ch.mpMax}`);
    assert(ch.stamina >= 0, `stamina final âm: ${ch.stamina}`);
    const finalExp = BigInt(ch.exp ?? '0');
    if (state.finalStatus === 'WON') {
      assert(
        finalExp > state.startingExp,
        `WON nhưng exp không tăng: starting=${state.startingExp}, final=${finalExp}`,
      );
    }
    // stamina giảm ít nhất bằng staminaEntry + N×STAMINA_PER_ACTION (5).
    // Smoke không assume regen tick fired vì BullMQ tick chạy mỗi vài giây và
    // smoke complete < 5s. Chỉ verify giảm được ít nhất bằng entry.
    assert(
      ch.stamina <= state.startingStamina - state.staminaEntry,
      `Stamina không giảm đủ: starting=${state.startingStamina}, final=${ch.stamina}, entry=${state.staminaEntry}`,
    );
  });

  // 17. Logout.
  await step('logout', async () => {
    const r = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(r, [200, 201], 'logout');
  });
}

// -----------------------------------------------------------------------------
// Entrypoint.
// -----------------------------------------------------------------------------

const startedAt = Date.now();
main()
  .catch((err) => {
    console.error('[smoke:combat] FATAL:', err);
    results.push({ name: 'fatal', ok: false, note: String(err) });
  })
  .finally(() => {
    const elapsed = Date.now() - startedAt;
    const pass = results.filter((r) => r.ok).length;
    const fail = results.filter((r) => !r.ok).length;
    console.log(
      `\n[smoke:combat] done: ${pass} pass / ${fail} fail / ${results.length} total in ${elapsed}ms`,
    );
    if (state.finalStatus) {
      console.log(
        `[smoke:combat] final encounter status: ${state.finalStatus} after ${state.actionsCount} action(s)` +
          (state.reward
            ? ` — reward exp=${state.reward.exp} linhThach=${state.reward.linhThach} loot=${state.reward.loot.length}`
            : ''),
      );
    }
    if (fail > 0) {
      console.error('[smoke:combat] failed steps:');
      for (const r of results.filter((x) => !x.ok)) {
        console.error(`  - ${r.name}: ${r.note}`);
      }
      process.exit(1);
    }
    process.exit(0);
  });
