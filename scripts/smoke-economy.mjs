#!/usr/bin/env node
/**
 * smoke-economy.mjs — Economy / ledger / reward safety smoke cho Xuân Tôi.
 *
 * Mục tiêu: trước khi mở rộng Phase 10 content scale, có 1 script "tự bay" 5
 * phút verify các invariant kinh tế cốt lõi (xem `docs/ECONOMY_MODEL.md` §3):
 *
 *   1. Single mutation point         — mọi thay đổi linhThach phải qua
 *                                       CurrencyService → CurrencyLedger.
 *   2. Atomic transaction            — currency spend + item grant đi cùng tx.
 *   3. Ledger row contract           — delta có dấu, reason uppercase snake.
 *   4. Idempotency (anti double-claim) — daily login claim 2 lần cùng ngày
 *                                       chỉ ghi 1 ledger row, balance không đổi.
 *   5. Anti double-spend (insufficient funds) — buy quá tay không tạo ledger
 *                                       nhưng character.linhThach không bị trừ.
 *
 * Cộng thêm cross-check tổng (đồng dạng `pnpm --filter @xuantoi/api audit:ledger`):
 *   - SUM(CurrencyLedger.delta WHERE LINH_THACH) == Character.linhThach.
 *   - SUM(ItemLedger.qtyDelta) == SUM(InventoryItem.qty) per (character, itemKey).
 *   - Không currency âm, không inventory qty âm.
 *
 * Chạy:
 *   pnpm smoke:economy
 *   # hoặc trực tiếp:
 *   node scripts/smoke-economy.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE   — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS — default 10000ms / request.
 *   SMOKE_VERBOSE    — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY   — default "thanh_van"; có thể "huyen_thuy" / "tu_la".
 *   SMOKE_BUY_ITEM   — default "huyet_chi_dan" (25 LT, stackable, LINH_THACH).
 *
 * Yêu cầu môi trường (giống smoke:beta):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api bootstrap` (seed 3 sect)
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:economy`
 *
 * Smoke này KHÔNG yêu cầu admin login — chỉ dùng `/api/_auth/*`,
 * `/api/character/*`, `/api/daily-login/*`, `/api/shop/*`, `/api/inventory`,
 * `/api/logs/me?type=currency|item`. Tất cả đều là endpoint hiện có (PR #88
 * thêm `/logs/me` chính là để self-audit kiểu này).
 *
 * KHÔNG đụng payment thật, KHÔNG dùng secret thật, KHÔNG mutate DB ngoài user
 * mới do chính smoke tạo (random email + character name).
 *
 * Exit code:
 *   0 — toàn bộ invariant OK.
 *   1 — ít nhất 1 invariant fail (stderr in chi tiết step + body diagnostic).
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
const BUY_ITEM = process.env.SMOKE_BUY_ITEM ?? 'huyet_chi_dan';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'change-me-bootstrap-pass';
// Mail reward amount for ledger chain test (small, safe).
const MAIL_REWARD_LT = 50;

// Kỳ vọng từ catalog: huyet_chi_dan giá 25 LT (xem packages/shared/src/items.ts).
// Daily login grant 100 LT (xem apps/api/src/modules/daily-login/daily-login.service.ts).
// Smoke đọc ngược từ API thay vì hard-code → script vẫn đúng nếu balance đổi.

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

function snapshotCookies() {
  return new Map(cookieJar);
}

function restoreCookies(snapshot) {
  cookieJar.clear();
  for (const [k, v] of snapshot) cookieJar.set(k, v);
}

// -----------------------------------------------------------------------------
// HTTP helper với timeout + cookie persistence.
// -----------------------------------------------------------------------------

/**
 * @param {string} path   — path dạng `/api/xxx` (có slash đầu).
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
  process.stdout.write(`[smoke:economy] ${name} ... `);
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
  return `smoke-econ-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `econ_${rand}`;
}

// -----------------------------------------------------------------------------
// Ledger helpers (paginate /logs/me).
// -----------------------------------------------------------------------------

/**
 * Fetch toàn bộ ledger entries của user hiện tại qua /logs/me, paginate
 * `nextCursor`. Smoke chỉ tạo ~5 row/user nên 1 page (limit=50) là đủ — vẫn
 * paginate để future-proof khi script mở rộng.
 *
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

/** Tổng signed qtyDelta cho 1 itemKey. */
function sumQtyDeltaForItem(entries, itemKey) {
  let s = 0;
  for (const e of entries) {
    if (e.itemKey === itemKey) s += Number(e.qtyDelta);
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
 *   startingLinhThach?: bigint;
 *   afterDailyLinhThach?: bigint;
 *   afterBuyLinhThach?: bigint;
 *   dailyClaimDelta?: bigint;
 *   buyTotalPrice?: number;
 *   buyQty?: number;
 * }}
 */
const state = {};

async function main() {
  console.log(`[smoke:economy] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms`);

  // 0. Health check — fail sớm nếu API không lên.
  await step('healthz', async () => {
    const r = await http('/api/healthz');
    assertStatus(r, 200, 'healthz');
  });

  // 1. Register fresh user.
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

  // 2. Onboard → tạo character với linhThach mặc định (= 0 theo schema).
  await step('onboard', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: randomCharName(), sectKey: SECT_KEY },
    });
    assertStatus(r, 200, 'onboard');
    if (!r.body?.ok) throw new Error(`onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    state.characterId = r.body?.data?.character?.id ?? r.body?.data?.id;
  });

  // 3. Snapshot starting linhThach + verify ledger empty.
  await step('character/me — starting balance', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me');
    const ch = r.body?.data?.character;
    if (!ch) throw new Error(`character/me: no character in body`);
    state.startingLinhThach = BigInt(ch.linhThach ?? '0');
    state.characterId = state.characterId ?? ch.id;
    assert(state.startingLinhThach >= 0n, `starting linhThach phải >= 0, got ${state.startingLinhThach}`);
  });

  await step('logs/me?type=currency — empty for fresh user', async () => {
    const entries = await fetchAllLogs('currency');
    // Onboard không grant currency → expect 0 row. Nếu future thêm welcome
    // bonus, expect tổng == startingLinhThach (đã invariant-check ở step sau).
    const sum = sumDelta(entries);
    assert(
      sum === state.startingLinhThach,
      `INVARIANT vi phạm: SUM(CurrencyLedger.LINH_THACH) = ${sum} ≠ Character.linhThach = ${state.startingLinhThach}`,
    );
  });

  await step('logs/me?type=item — empty for fresh user', async () => {
    const entries = await fetchAllLogs('item');
    // Smoke không assume server có welcome item — chỉ verify shape.
    assert(Array.isArray(entries), `logs/me?type=item: entries phải array`);
  });

  // 4. Daily login: status + claim → expect +DAILY_LOGIN_LINH_THACH.
  /** @type {bigint} */
  let nextRewardLT = 0n;
  await step('daily-login/me — status', async () => {
    const r = await http('/api/daily-login/me');
    assertStatus(r, 200, 'daily-login/me');
    const data = r.body?.data;
    if (!data) throw new Error(`daily-login/me: missing data`);
    nextRewardLT = BigInt(data.nextRewardLinhThach ?? '0');
    if (nextRewardLT <= 0n) {
      // Không fail cứng — server có thể tạm tắt daily login. Để smoke biết.
      throw new Error(`daily-login/me: nextRewardLinhThach phải > 0, got ${nextRewardLT}`);
    }
  });

  let dailyClaimedThisRun = false;
  await step('daily-login/claim — first call', async () => {
    const r = await http('/api/daily-login/claim', { method: 'POST' });
    assertStatus(r, 200, 'daily-login/claim');
    const data = r.body?.data;
    if (!data) throw new Error(`daily-login/claim: missing data`);
    if (data.claimed === true) {
      dailyClaimedThisRun = true;
      state.dailyClaimDelta = BigInt(data.linhThachDelta ?? '0');
      assert(
        state.dailyClaimDelta > 0n,
        `daily-login/claim claimed=true nhưng linhThachDelta=${state.dailyClaimDelta} (kỳ vọng > 0)`,
      );
    } else if (data.claimed === false) {
      // User đã claim hôm nay (vd smoke chạy 2 lần trong ngày). Smoke vẫn
      // verify được idempotency invariant ở step double-claim sau.
      state.dailyClaimDelta = 0n;
    } else {
      throw new Error(`daily-login/claim: data.claimed phải boolean, got ${JSON.stringify(data)}`);
    }
  });

  await step('character/me — balance after daily-login', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me');
    const ch = r.body?.data?.character;
    if (!ch) throw new Error(`character/me: no character`);
    state.afterDailyLinhThach = BigInt(ch.linhThach ?? '0');
    if (dailyClaimedThisRun) {
      const expected = state.startingLinhThach + (state.dailyClaimDelta ?? 0n);
      assert(
        state.afterDailyLinhThach === expected,
        `INVARIANT vi phạm: linhThach sau daily-login = ${state.afterDailyLinhThach} ≠ ${state.startingLinhThach} + ${state.dailyClaimDelta}`,
      );
    } else {
      // Idempotent path — balance không đổi.
      assert(
        state.afterDailyLinhThach === state.startingLinhThach,
        `INVARIANT vi phạm: idempotent claim nhưng linhThach đổi từ ${state.startingLinhThach} sang ${state.afterDailyLinhThach}`,
      );
    }
    assert(state.afterDailyLinhThach >= 0n, `linhThach âm sau daily-login: ${state.afterDailyLinhThach}`);
  });

  await step('ledger sum == character balance (after daily)', async () => {
    const entries = await fetchAllLogs('currency');
    const sum = sumDelta(entries);
    assert(
      sum === state.afterDailyLinhThach,
      `INVARIANT vi phạm: SUM(CurrencyLedger.LINH_THACH) = ${sum} ≠ Character.linhThach = ${state.afterDailyLinhThach}`,
    );
    if (dailyClaimedThisRun) {
      const dailyRows = entries.filter((e) => e.reason === 'DAILY_LOGIN');
      assert(
        dailyRows.length >= 1,
        `Expected ≥1 ledger row reason=DAILY_LOGIN, got ${dailyRows.length}`,
      );
      // Latest DAILY_LOGIN row delta phải dương đúng bằng dailyClaimDelta.
      const latest = dailyRows[0];
      assert(
        BigInt(latest.delta) === (state.dailyClaimDelta ?? 0n),
        `DAILY_LOGIN delta sai: ledger=${latest.delta}, expected=${state.dailyClaimDelta}`,
      );
      assert(
        latest.currency === 'LINH_THACH',
        `DAILY_LOGIN currency sai: ${latest.currency}`,
      );
    }
  });

  // 5. Anti double-claim: gọi /daily-login/claim lần 2 → claimed=false, balance unchanged.
  await step('daily-login/claim — second call (idempotency)', async () => {
    const before = state.afterDailyLinhThach;
    const beforeEntries = await fetchAllLogs('currency');

    const r = await http('/api/daily-login/claim', { method: 'POST' });
    assertStatus(r, 200, 'daily-login/claim #2');
    const data = r.body?.data;
    assert(
      data && data.claimed === false,
      `INVARIANT vi phạm: claim lần 2 trong ngày phải claimed=false, got ${JSON.stringify(data)}`,
    );

    const afterRes = await http('/api/character/me');
    const after = BigInt(afterRes.body?.data?.character?.linhThach ?? '0');
    assert(
      after === before,
      `INVARIANT vi phạm: double-claim làm linhThach đổi từ ${before} sang ${after}`,
    );

    const afterEntries = await fetchAllLogs('currency');
    assert(
      afterEntries.length === beforeEntries.length,
      `INVARIANT vi phạm: double-claim ghi thêm ${afterEntries.length - beforeEntries.length} ledger row (kỳ vọng 0)`,
    );
  });

  // 6. Shop buy 1 item bằng LINH_THACH → expect ledger debit + item ledger credit.
  /** @type {{ itemKey: string; price: number; currency: string } | undefined} */
  let buyEntry;
  await step('shop/npc — find buyable LINH_THACH item', async () => {
    const r = await http('/api/shop/npc');
    assertStatus(r, 200, 'shop/npc');
    const entries = r.body?.data?.entries ?? [];
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error(`shop/npc: catalog empty`);
    }
    buyEntry = entries.find(
      /** @param {any} e */
      (e) => e.itemKey === BUY_ITEM && e.currency === 'LINH_THACH',
    );
    if (!buyEntry) {
      // Fallback: rẻ nhất LINH_THACH mà afterDailyLinhThach mua nổi.
      const candidates = entries
        .filter(/** @param {any} e */ (e) => e.currency === 'LINH_THACH')
        .sort(/** @param {any} a @param {any} b */ (a, b) => a.price - b.price);
      buyEntry = candidates.find((e) => BigInt(e.price) <= (state.afterDailyLinhThach ?? 0n));
      if (!buyEntry) {
        throw new Error(
          `shop/npc: không có LINH_THACH item mua nổi với balance ${state.afterDailyLinhThach}`,
        );
      }
    }
  });

  await step(`shop/buy ${BUY_ITEM} — debit + credit`, async () => {
    const e = buyEntry;
    if (!e) throw new Error('no buyEntry resolved');
    if ((state.afterDailyLinhThach ?? 0n) < BigInt(e.price)) {
      throw new Error(
        `insufficient funds for buy: have ${state.afterDailyLinhThach}, need ${e.price}. ` +
          `Daily login đã grant nhưng vẫn không đủ — server config khác kỳ vọng.`,
      );
    }
    state.buyQty = 1;
    state.buyTotalPrice = e.price * state.buyQty;
    const r = await http('/api/shop/buy', {
      method: 'POST',
      body: { itemKey: e.itemKey, qty: state.buyQty },
    });
    assertStatus(r, 200, 'shop/buy');
    if (!r.body?.ok) throw new Error(`shop/buy: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const data = r.body?.data;
    assert(
      data?.itemKey === e.itemKey && data?.qty === state.buyQty && data?.totalPrice === state.buyTotalPrice,
      `shop/buy: response shape mismatch — ${JSON.stringify(data).slice(0, 200)}`,
    );
  });

  await step('character/me — balance after buy', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me');
    const ch = r.body?.data?.character;
    state.afterBuyLinhThach = BigInt(ch?.linhThach ?? '0');
    const expected = (state.afterDailyLinhThach ?? 0n) - BigInt(state.buyTotalPrice ?? 0);
    assert(
      state.afterBuyLinhThach === expected,
      `INVARIANT vi phạm: linhThach sau buy = ${state.afterBuyLinhThach} ≠ ${state.afterDailyLinhThach} - ${state.buyTotalPrice}`,
    );
    assert(state.afterBuyLinhThach >= 0n, `linhThach âm sau buy: ${state.afterBuyLinhThach}`);
  });

  await step('CurrencyLedger SHOP_BUY row — debit', async () => {
    const entries = await fetchAllLogs('currency');
    const sum = sumDelta(entries);
    assert(
      sum === (state.afterBuyLinhThach ?? 0n),
      `INVARIANT vi phạm: SUM(CurrencyLedger) = ${sum} ≠ Character.linhThach = ${state.afterBuyLinhThach}`,
    );
    const shopRows = entries.filter((e) => e.reason === 'SHOP_BUY');
    assert(shopRows.length >= 1, `Expected ≥1 ledger row reason=SHOP_BUY, got ${shopRows.length}`);
    const last = shopRows[0];
    assert(
      BigInt(last.delta) === -BigInt(state.buyTotalPrice ?? 0),
      `SHOP_BUY delta sai: ${last.delta} ≠ -${state.buyTotalPrice}`,
    );
    assert(last.currency === 'LINH_THACH', `SHOP_BUY currency sai: ${last.currency}`);
    assert(
      last.refType === 'NPC_SHOP' && typeof last.refId === 'string',
      `SHOP_BUY refType/refId sai: ${last.refType}/${last.refId}`,
    );
  });

  await step('ItemLedger SHOP_BUY row — credit', async () => {
    const entries = await fetchAllLogs('item');
    const shopRows = entries.filter(
      /** @param {any} e */ (e) => e.reason === 'SHOP_BUY' && e.itemKey === buyEntry?.itemKey,
    );
    assert(
      shopRows.length >= 1,
      `Expected ≥1 ItemLedger row reason=SHOP_BUY itemKey=${buyEntry?.itemKey}, got ${shopRows.length}`,
    );
    const last = shopRows[0];
    assert(
      Number(last.qtyDelta) === Number(state.buyQty ?? 0),
      `SHOP_BUY qtyDelta sai: ${last.qtyDelta} ≠ +${state.buyQty}`,
    );
    assert(
      last.refType === 'NPC_SHOP' && typeof last.refId === 'string',
      `SHOP_BUY ItemLedger refType/refId sai: ${last.refType}/${last.refId}`,
    );
  });

  await step('Inventory.qty == SUM(ItemLedger.qtyDelta) per item', async () => {
    const invR = await http('/api/inventory');
    assertStatus(invR, 200, 'inventory');
    const items = invR.body?.data?.items ?? [];
    if (!Array.isArray(items)) throw new Error(`inventory: items không phải array`);
    const itemEntries = await fetchAllLogs('item');

    // Tổng InventoryItem.qty per itemKey.
    /** @type {Map<string, number>} */
    const invByKey = new Map();
    for (const it of items) {
      assert(Number(it.qty) >= 0, `INVARIANT vi phạm: InventoryItem.qty âm — ${it.itemKey}=${it.qty}`);
      invByKey.set(it.itemKey, (invByKey.get(it.itemKey) ?? 0) + Number(it.qty));
    }

    // Tổng ItemLedger.qtyDelta per itemKey.
    /** @type {Map<string, number>} */
    const ledgerByKey = new Map();
    for (const e of itemEntries) {
      ledgerByKey.set(e.itemKey, (ledgerByKey.get(e.itemKey) ?? 0) + Number(e.qtyDelta));
    }

    // Cross-check: với mỗi itemKey xuất hiện ở 1 trong 2, sum phải bằng nhau.
    /** @type {Set<string>} */
    const allKeys = new Set([...invByKey.keys(), ...ledgerByKey.keys()]);
    /** @type {string[]} */
    const mismatches = [];
    for (const k of allKeys) {
      const inv = invByKey.get(k) ?? 0;
      const led = ledgerByKey.get(k) ?? 0;
      if (inv !== led) mismatches.push(`itemKey=${k} inventory=${inv} ledger=${led}`);
    }
    if (mismatches.length > 0) {
      throw new Error(
        `INVARIANT vi phạm: Inventory ≠ SUM(ItemLedger) cho ${mismatches.length} item: ` +
          mismatches.slice(0, 5).join('; '),
      );
    }

    // Verify item vừa mua có mặt trong inventory với qty đúng.
    const buyKey = buyEntry?.itemKey;
    if (buyKey) {
      const have = invByKey.get(buyKey) ?? 0;
      const ledSum = sumQtyDeltaForItem(itemEntries, buyKey);
      assert(
        have === ledSum && have >= Number(state.buyQty ?? 0),
        `Item bought=${buyKey}: inventory.qty=${have}, ledgerSum=${ledSum}, buyQty=${state.buyQty}`,
      );
    }
  });

  // 7. Anti double-spend: thử buy với qty cao quá → INSUFFICIENT_FUNDS, không tạo ledger row.
  await step('shop/buy — anti double-spend (insufficient funds)', async () => {
    const e = buyEntry;
    if (!e) return { skip: true, note: 'no buyEntry' };
    // qty thật cao để chắc chắn vượt balance hiện tại. Cap 99 (zod max trên controller).
    const tooMuchQty = 99;
    const tooMuchPrice = BigInt(e.price) * BigInt(tooMuchQty);
    if (tooMuchPrice <= (state.afterBuyLinhThach ?? 0n)) {
      // Lý thuyết closed-beta linhThach mới = 75-100 LT, item 25 LT * 99 = 2475 LT
      // → đủ để 1 user mới không mua nổi. Nếu fail check này → balance quá cao.
      return { skip: true, note: `balance ${state.afterBuyLinhThach} đủ trả ${tooMuchPrice}` };
    }

    const beforeBalance = state.afterBuyLinhThach ?? 0n;
    const beforeCurrencyEntries = await fetchAllLogs('currency');
    const beforeItemEntries = await fetchAllLogs('item');

    const r = await http('/api/shop/buy', {
      method: 'POST',
      body: { itemKey: e.itemKey, qty: tooMuchQty },
    });
    // Server trả 409 INSUFFICIENT_FUNDS hoặc 400. Chỉ cần KHÔNG phải 200.
    assert(
      r.status !== 200,
      `INVARIANT vi phạm: buy ${tooMuchQty} ${e.itemKey} với balance ${beforeBalance} mà thành công (status 200)`,
    );

    // Verify balance không đổi.
    const afterRes = await http('/api/character/me');
    const after = BigInt(afterRes.body?.data?.character?.linhThach ?? '0');
    assert(
      after === beforeBalance,
      `INVARIANT vi phạm: buy fail nhưng linhThach đổi từ ${beforeBalance} sang ${after}`,
    );

    // Verify không có ledger row mới.
    const afterCurrencyEntries = await fetchAllLogs('currency');
    const afterItemEntries = await fetchAllLogs('item');
    assert(
      afterCurrencyEntries.length === beforeCurrencyEntries.length,
      `INVARIANT vi phạm: buy fail nhưng ghi thêm ${afterCurrencyEntries.length - beforeCurrencyEntries.length} CurrencyLedger row`,
    );
    assert(
      afterItemEntries.length === beforeItemEntries.length,
      `INVARIANT vi phạm: buy fail nhưng ghi thêm ${afterItemEntries.length - beforeItemEntries.length} ItemLedger row`,
    );
  });

  // 9. Mail-reward ledger chain — admin sends reward mail → player claims → ledger row verified.
  // Pattern: snapshot player cookies → admin login → send mail with LT reward → restore player → claim → verify ledger.
  let playerCookieSnap = null;
  let mailId = null;
  let balanceBeforeMail = 0n;

  await step('mail-reward: snapshot player balance before admin grant', async () => {
    const r = await http('/api/character/me');
    assertStatus(r, 200, 'character/me pre-mail');
    balanceBeforeMail = BigInt(r.body?.data?.character?.linhThach ?? '0');
    assert(balanceBeforeMail >= 0n, `balance trước mail phải >= 0, got ${balanceBeforeMail}`);
  });

  await step('mail-reward: admin login — swap cookie jar (player → admin)', async () => {
    playerCookieSnap = snapshotCookies();
    const r = await http('/api/_auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assertStatus(r, 200, 'admin login');
    const u = r.body?.data?.user;
    assert(u?.role === 'ADMIN', `admin login: role phải ADMIN, got ${u?.role}. Cần bootstrap admin@example.com trước.`);
  });

  await step('mail-reward: admin search player + send reward mail', async () => {
    const search = await http(`/api/admin/users?q=${encodeURIComponent(state.email)}`);
    assertStatus(search, 200, 'admin search');
    const target = search.body?.data?.users?.find((u) => u.email === state.email);
    assert(target, `admin search: user ${state.email} not found`);
    const targetCharId = target.characterId ?? target.character?.id;
    assert(targetCharId, `admin search: characterId not found for ${state.email}`);

    const r = await http('/api/admin/mail/send', {
      method: 'POST',
      body: {
        recipientCharacterId: targetCharId,
        subject: 'Smoke Economy Test Reward',
        body: 'Ledger chain verification mail.',
        senderName: 'Smoke',
        rewardLinhThach: MAIL_REWARD_LT,
        rewardTienNgoc: 0,
        rewardExp: 0,
        rewardItems: [],
      },
    });
    assertStatus(r, 200, 'admin mail/send');
    mailId = r.body?.data?.mail?.id;
    assert(mailId, `admin mail/send: missing mail.id`);
  });

  await step('mail-reward: restore player cookies', async () => {
    restoreCookies(playerCookieSnap);
  });

  await step('mail-reward: player claims reward mail → ledger row + balance increase', async () => {
    assert(mailId, 'mailId phải có từ step admin send');
    const r = await http(`/api/mail/${mailId}/claim`, { method: 'POST' });
    assertStatus(r, 200, 'mail claim');
    assert(r.body?.ok, `mail claim: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);

    // Verify balance increased by MAIL_REWARD_LT.
    const me = await http('/api/character/me');
    assertStatus(me, 200, 'character/me post-mail-claim');
    const balanceAfter = BigInt(me.body?.data?.character?.linhThach ?? '0');
    assert(
      balanceAfter === balanceBeforeMail + BigInt(MAIL_REWARD_LT),
      `mail claim: balance kỳ vọng ${balanceBeforeMail + BigInt(MAIL_REWARD_LT)}, got ${balanceAfter}`,
    );

    // Verify ledger row exists with reason MAIL_CLAIM.
    const entries = await fetchAllLogs('currency');
    const mailRows = entries.filter((e) => e.reason === 'MAIL_CLAIM' || e.reason === 'MAIL_ATTACHMENT_CLAIM');
    assert(mailRows.length >= 1, `Expected ≥1 ledger row reason=MAIL_CLAIM/MAIL_ATTACHMENT_CLAIM, got ${mailRows.length}`);
    const mailRow = mailRows[mailRows.length - 1];
    assert(
      BigInt(mailRow.delta) === BigInt(MAIL_REWARD_LT),
      `mail ledger delta kỳ vọng ${MAIL_REWARD_LT}, got ${mailRow.delta}`,
    );
  });

  await step('mail-reward: double-claim → 409 ALREADY_CLAIMED', async () => {
    assert(mailId, 'mailId phải có');
    const r = await http(`/api/mail/${mailId}/claim`, { method: 'POST' });
    assertStatus(r, 409, 'mail double-claim phải 409');
  });

  await step('mail-reward: final ledger sum == character balance (post mail chain)', async () => {
    const r = await http('/api/character/me');
    const balance = BigInt(r.body?.data?.character?.linhThach ?? '0');
    const entries = await fetchAllLogs('currency');
    const sum = sumDelta(entries);
    assert(
      sum === balance,
      `INVARIANT post-mail: SUM(CurrencyLedger) = ${sum} ≠ Character.linhThach = ${balance}`,
    );
  });

  // 10. Final invariants — re-check toàn bộ ledger consistency cho user vừa tạo.
  await step('final: ledger sum == character balance', async () => {
    const r = await http('/api/character/me');
    const balance = BigInt(r.body?.data?.character?.linhThach ?? '0');
    const entries = await fetchAllLogs('currency');
    const sum = sumDelta(entries);
    assert(
      sum === balance,
      `INVARIANT cuối: SUM(CurrencyLedger) = ${sum} ≠ Character.linhThach = ${balance}`,
    );
    assert(balance >= 0n, `linhThach âm cuối smoke: ${balance}`);
  });

  // 9. Logout — cleanup phiên smoke.
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
    console.error('[smoke:economy] FATAL:', err);
    results.push({ name: 'fatal', ok: false, note: String(err) });
  })
  .finally(() => {
    const elapsed = Date.now() - startedAt;
    const pass = results.filter((r) => r.ok).length;
    const fail = results.filter((r) => !r.ok).length;
    console.log(
      `\n[smoke:economy] done: ${pass} pass / ${fail} fail / ${results.length} total in ${elapsed}ms`,
    );
    if (fail > 0) {
      console.error('[smoke:economy] failed steps:');
      for (const r of results.filter((x) => !x.ok)) {
        console.error(`  - ${r.name}: ${r.note}`);
      }
      process.exit(1);
    }
    process.exit(0);
  });
