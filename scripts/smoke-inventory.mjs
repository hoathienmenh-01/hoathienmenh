#!/usr/bin/env node
/**
 * smoke-inventory.mjs — Inventory endpoints smoke cho Xuân Tôi.
 *
 * Negative-path-focused. Positive equip / unequip / use paths
 * (admin grant 1× equipment / pill → POST /inventory/equip → atomic
 * EquipSlot set + EquipBonusSummary update; POST /inventory/unequip →
 * EquipSlot null; POST /inventory/use → InventoryItem qty decrement +
 * effect apply + ItemLedger reason='USE') defer cho future smoke với
 * admin grant harness hoặc full E2E gameplay automation.
 *
 * Mục tiêu: cover 4 inventory endpoints qua HTTP
 * (`apps/api/src/modules/inventory`):
 *   - `GET  /api/inventory`          — list inventory rows (auth + char
 *                                      gate ở controller).
 *   - `POST /api/inventory/equip`    — equip item (auth + char gate
 *                                      controller-level → zod
 *                                      inventoryItemId min(1) → service
 *                                      ownership / catalog / slot).
 *   - `POST /api/inventory/unequip`  — unequip slot (auth + char →
 *                                      zod EquipSlot enum 9 values →
 *                                      service findFirst-by-slot).
 *   - `POST /api/inventory/use`      — use consumable (auth + char →
 *                                      zod inventoryItemId min(1) →
 *                                      service ownership / catalog /
 *                                      effect).
 *
 * Critical observation — controller `requireCharacter` order:
 *   - `requireCharacter(req)` chạy TRƯỚC zod parse trong ALL 4
 *     endpoint. Pre-onboard auth (userId tồn tại nhưng character null)
 *     → controller throw NO_CHARACTER 404 BEFORE chạm zod, bất kể body
 *     có hợp lệ hay không.
 *   - Post-onboard auth (cả userId + char tồn tại) → controller pass
 *     requireCharacter → zod parse → service.
 *
 * Service order (`inventory.service.ts`):
 *   - equip(userId, inventoryItemId):
 *     1. char findUnique → NO_CHARACTER (404)  [redundant với controller
 *                                               nhưng giữ defense-in-depth]
 *     2. inventoryItem findUnique + ownership → INVENTORY_ITEM_NOT_FOUND
 *        (404)
 *     3. itemByKey catalog → ITEM_NOT_FOUND (404)
 *     4. def.slot null → NOT_EQUIPPABLE (409)
 *   - unequip(userId, slot):
 *     1. char gate
 *     2. findFirst({characterId, equippedSlot: slot}) → INVENTORY_ITEM_NOT_FOUND
 *        (404) nếu fresh char chưa equip slot đó.
 *   - use(userId, inventoryItemId):
 *     1. char gate
 *     2. ownership check → INVENTORY_ITEM_NOT_FOUND (404)
 *     3. itemByKey → ITEM_NOT_FOUND (404)
 *     4. def.effect null → NOT_USABLE (409)
 *
 * 14-step:
 *   1.  `GET  /api/inventory` (no auth) → 401 UNAUTHENTICATED.
 *   2.  `POST /api/inventory/equip` (no auth) → 401 UNAUTHENTICATED.
 *   3.  `POST /api/inventory/unequip` (no auth) → 401 UNAUTHENTICATED.
 *   4.  `POST /api/inventory/use` (no auth) → 401 UNAUTHENTICATED.
 *   5.  `POST /api/_auth/register` — fresh user.
 *   6.  `GET  /api/inventory` (auth pre-onboard) → 404 NO_CHARACTER
 *                                            (controller gate).
 *   7.  `POST /api/inventory/equip` ({}) (auth pre-onboard) → 404
 *                                            NO_CHARACTER (controller
 *                                            requireCharacter TRƯỚC
 *                                            zod parse — verify gate
 *                                            order).
 *   8.  `POST /api/inventory/unequip` ({}) (auth pre-onboard) → 404
 *                                            NO_CHARACTER.
 *   9.  `POST /api/inventory/use` ({}) (auth pre-onboard) → 404
 *                                            NO_CHARACTER.
 *  10.  `POST /api/character/onboard` — fresh char (sectKey:'thanh_van',
 *                                       0 LT, 0 TN, inventory empty).
 *  11.  `GET  /api/inventory` (auth post-onboard) → 200 items=[]
 *                                            (fresh char has empty
 *                                            inventory — verify shape).
 *  12.  `POST /api/inventory/equip` ({}) post-onboard → 400
 *                                            INVALID_INPUT (zod missing
 *                                            inventoryItemId).
 *  13.  `POST /api/inventory/equip` ({inventoryItemId:''}) post-onboard
 *                                            → 400 INVALID_INPUT (zod
 *                                            min(1)).
 *  14.  `POST /api/inventory/unequip` ({slot:'INVALID'}) post-onboard
 *                                            → 400 INVALID_INPUT (zod
 *                                            enum reject).
 *  15.  `POST /api/inventory/unequip` ({}) post-onboard → 400
 *                                            INVALID_INPUT (zod missing
 *                                            slot).
 *  16.  `POST /api/inventory/use` ({}) post-onboard → 400 INVALID_INPUT.
 *  17.  `POST /api/inventory/equip` ({inventoryItemId:'bogus_id'})
 *                                            post-onboard → 404
 *                                            INVENTORY_ITEM_NOT_FOUND
 *                                            (service ownership check
 *                                            findUnique returns null).
 *  18.  `POST /api/inventory/unequip` ({slot:'WEAPON'}) post-onboard
 *                                            fresh → 404
 *                                            INVENTORY_ITEM_NOT_FOUND
 *                                            (service findFirst
 *                                            equippedSlot=WEAPON returns
 *                                            null).
 *  19.  `POST /api/inventory/use` ({inventoryItemId:'bogus_id'})
 *                                            post-onboard → 404
 *                                            INVENTORY_ITEM_NOT_FOUND.
 *  20.  Anti-FE-self-grant snapshot: `GET /api/inventory` items=[]
 *                                    + `GET /api/character/state`
 *                                    hp/mp/linhThach unchanged sau
 *                                    19 attempts (server-authoritative).
 *  21.  `POST /api/_auth/logout` + `GET /api/inventory` → 401.
 *
 * Chạy:
 *   pnpm smoke:inventory
 *   # hoặc trực tiếp:
 *   node scripts/smoke-inventory.mjs
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
 *   - Tab khác: `pnpm smoke:inventory`
 *
 * Mutation footprint:
 *   - 1 fresh user + 1 fresh character + auto-joined thanh_van sect
 *     (KHÔNG equip/unequip/use thành công, KHÔNG thay đổi InventoryItem
 *     row, KHÔNG ghi ItemLedger).
 *
 * Defer:
 *   - Positive equip path (admin grant `so_kiem` (WEAPON slot) → POST
 *     /inventory/equip → atomic update equippedSlot=WEAPON + return
 *     items[]) yêu cầu admin grant harness → defer.
 *   - Positive unequip path (sau equip thành công) → defer.
 *   - Positive use path (admin grant `huyet_chi_dan` pill → POST
 *     /inventory/use → atomic qty-- + effect apply + ledger USE entry)
 *     → defer.
 *   - NOT_EQUIPPABLE 409 (equip non-equipment item như pill — hpHeal
 *     effect, def.slot=null) yêu cầu admin grant pill trước → defer.
 *   - NOT_USABLE 409 (use non-effect item như weapon) yêu cầu admin
 *     grant weapon trước → defer.
 *   - WRONG_SLOT 409 (deprecated branch, slot mismatch không tồn tại
 *     trong service hiện tại — slot derive từ def.slot tự động).
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
  process.stdout.write(`[smoke:inventory] ${name} ... `);
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

// -----------------------------------------------------------------------------
// Helpers random.
// -----------------------------------------------------------------------------

function randomEmail() {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `smoke-inv-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `inv_${rand}`;
}

function randomBogusId() {
  const rand = Math.random().toString(36).slice(2, 12);
  return `bogus_inv_${rand}`;
}

/** @returns {Promise<{hp: number; mp: number; linhThach: string; tienNgoc: number}>} */
async function fetchCharSnapshot() {
  const r = await http('/api/character/state');
  assertStatus(r, 200, 'GET /character/state snapshot');
  const c = r.body?.data?.character;
  assert(c, 'GET /character/state: missing character');
  return {
    hp: Number(c.hp),
    mp: Number(c.mp),
    linhThach: String(c.linhThach),
    tienNgoc: Number(c.tienNgoc),
  };
}

/** @returns {Promise<any[]>} */
async function fetchInventoryItems() {
  const r = await http('/api/inventory');
  assertStatus(r, 200, 'GET /inventory snapshot');
  const items = r.body?.data?.items;
  assert(Array.isArray(items), 'GET /inventory: items not array');
  return items;
}

// -----------------------------------------------------------------------------
// Main flow.
// -----------------------------------------------------------------------------

async function main() {
  console.log(`[smoke:inventory] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms`);

  // 1. GET /inventory (no auth) → 401.
  await step('GET /inventory — 401 UNAUTHENTICATED (no auth)', async () => {
    const r = await http('/api/inventory');
    assertStatus(r, 401, 'GET /inventory unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'GET /inventory unauth');
  });

  // 2. POST /inventory/equip (no auth) → 401.
  await step('POST /inventory/equip — 401 UNAUTHENTICATED (no auth)', async () => {
    const r = await http('/api/inventory/equip', {
      method: 'POST',
      body: { inventoryItemId: 'whatever' },
    });
    assertStatus(r, 401, 'POST /inventory/equip unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'POST /inventory/equip unauth');
  });

  // 3. POST /inventory/unequip (no auth) → 401.
  await step('POST /inventory/unequip — 401 UNAUTHENTICATED (no auth)', async () => {
    const r = await http('/api/inventory/unequip', {
      method: 'POST',
      body: { slot: 'WEAPON' },
    });
    assertStatus(r, 401, 'POST /inventory/unequip unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'POST /inventory/unequip unauth');
  });

  // 4. POST /inventory/use (no auth) → 401.
  await step('POST /inventory/use — 401 UNAUTHENTICATED (no auth)', async () => {
    const r = await http('/api/inventory/use', {
      method: 'POST',
      body: { inventoryItemId: 'whatever' },
    });
    assertStatus(r, 401, 'POST /inventory/use unauth');
    assertErrorCode(r, 'UNAUTHENTICATED', 'POST /inventory/use unauth');
  });

  // 5. Register fresh user.
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

  // 6. GET /inventory pre-onboard → 404 NO_CHARACTER (controller gate).
  await step('GET /inventory — auth pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/inventory');
    assertStatus(r, 404, 'GET /inventory pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'GET /inventory pre-onboard');
  });

  // 7. POST /inventory/equip ({}) pre-onboard → 404 NO_CHARACTER (controller
  //    requireCharacter TRƯỚC zod parse — body invalid không matter).
  await step('POST /inventory/equip — ({}) pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/inventory/equip', { method: 'POST', body: {} });
    assertStatus(r, 404, 'POST /inventory/equip ({}) pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'POST /inventory/equip ({}) pre-onboard');
  });

  // 8. POST /inventory/unequip ({}) pre-onboard → 404 NO_CHARACTER.
  await step('POST /inventory/unequip — ({}) pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/inventory/unequip', { method: 'POST', body: {} });
    assertStatus(r, 404, 'POST /inventory/unequip ({}) pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'POST /inventory/unequip ({}) pre-onboard');
  });

  // 9. POST /inventory/use ({}) pre-onboard → 404 NO_CHARACTER.
  await step('POST /inventory/use — ({}) pre-onboard 404 NO_CHARACTER', async () => {
    const r = await http('/api/inventory/use', { method: 'POST', body: {} });
    assertStatus(r, 404, 'POST /inventory/use ({}) pre-onboard');
    assertErrorCode(r, 'NO_CHARACTER', 'POST /inventory/use ({}) pre-onboard');
  });

  // 10. Onboard fresh char (thanh_van).
  await step('onboard — create character (sectKey:thanh_van)', async () => {
    const r = await http('/api/character/onboard', {
      method: 'POST',
      body: { name: randomCharName(), sectKey: 'thanh_van' },
    });
    assertStatus(r, 200, 'onboard');
    if (!r.body?.ok)
      throw new Error(`onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body?.data?.character?.id, 'onboard: missing character.id');
  });

  // 11. GET /inventory post-onboard → 200 items=[] (fresh char empty).
  await step('GET /inventory — auth post-onboard 200 items=[] (fresh empty)', async () => {
    const r = await http('/api/inventory');
    assertStatus(r, 200, 'GET /inventory post-onboard');
    if (!r.body?.ok)
      throw new Error(`GET /inventory post-onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const items = r.body?.data?.items;
    assert(Array.isArray(items), 'GET /inventory: items not array');
    assert(items.length === 0, `GET /inventory: fresh char expect items=[], got length=${items.length}`);
  });

  // Snapshot inventory + currencies BEFORE failed equip/unequip/use steps
  // — anti-FE-self-grant baseline.
  const beforeItems = await fetchInventoryItems();
  const beforeChar = await fetchCharSnapshot();

  // 12. POST /inventory/equip ({}) post-onboard → 400 INVALID_INPUT (zod
  //     missing inventoryItemId — char gate đã pass nên zod fires).
  await step('POST /inventory/equip — ({}) post-onboard 400 INVALID_INPUT', async () => {
    const r = await http('/api/inventory/equip', { method: 'POST', body: {} });
    assertStatus(r, 400, 'POST /inventory/equip ({}) post-onboard');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /inventory/equip ({}) post-onboard');
  });

  // 13. POST /inventory/equip ({inventoryItemId:''}) post-onboard → 400
  //     INVALID_INPUT (zod min(1)).
  await step('POST /inventory/equip — (empty id) post-onboard 400 INVALID_INPUT', async () => {
    const r = await http('/api/inventory/equip', {
      method: 'POST',
      body: { inventoryItemId: '' },
    });
    assertStatus(r, 400, 'POST /inventory/equip empty id');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /inventory/equip empty id');
  });

  // 14. POST /inventory/unequip ({slot:'INVALID'}) post-onboard → 400
  //     INVALID_INPUT (zod enum reject — không thuộc 9 EquipSlot).
  await step('POST /inventory/unequip — (slot:INVALID) post-onboard 400 INVALID_INPUT', async () => {
    const r = await http('/api/inventory/unequip', {
      method: 'POST',
      body: { slot: 'INVALID' },
    });
    assertStatus(r, 400, 'POST /inventory/unequip slot:INVALID');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /inventory/unequip slot:INVALID');
  });

  // 15. POST /inventory/unequip ({}) post-onboard → 400 INVALID_INPUT
  //     (zod missing slot).
  await step('POST /inventory/unequip — ({}) post-onboard 400 INVALID_INPUT', async () => {
    const r = await http('/api/inventory/unequip', { method: 'POST', body: {} });
    assertStatus(r, 400, 'POST /inventory/unequip ({})');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /inventory/unequip ({})');
  });

  // 16. POST /inventory/use ({}) post-onboard → 400 INVALID_INPUT.
  await step('POST /inventory/use — ({}) post-onboard 400 INVALID_INPUT', async () => {
    const r = await http('/api/inventory/use', { method: 'POST', body: {} });
    assertStatus(r, 400, 'POST /inventory/use ({})');
    assertErrorCode(r, 'INVALID_INPUT', 'POST /inventory/use ({})');
  });

  // 17. POST /inventory/equip ({inventoryItemId:'bogus'}) post-onboard →
  //     404 INVENTORY_ITEM_NOT_FOUND (service ownership findUnique null).
  await step('POST /inventory/equip — (bogus id) post-onboard 404 INVENTORY_ITEM_NOT_FOUND', async () => {
    const r = await http('/api/inventory/equip', {
      method: 'POST',
      body: { inventoryItemId: randomBogusId() },
    });
    assertStatus(r, 404, 'POST /inventory/equip bogus id');
    assertErrorCode(r, 'INVENTORY_ITEM_NOT_FOUND', 'POST /inventory/equip bogus id');
  });

  // 18. POST /inventory/unequip ({slot:'WEAPON'}) post-onboard fresh →
  //     404 INVENTORY_ITEM_NOT_FOUND (service findFirst null — chưa equip
  //     slot này bao giờ).
  await step('POST /inventory/unequip — (slot:WEAPON) fresh char 404 INVENTORY_ITEM_NOT_FOUND', async () => {
    const r = await http('/api/inventory/unequip', {
      method: 'POST',
      body: { slot: 'WEAPON' },
    });
    assertStatus(r, 404, 'POST /inventory/unequip slot:WEAPON fresh');
    assertErrorCode(r, 'INVENTORY_ITEM_NOT_FOUND', 'POST /inventory/unequip slot:WEAPON fresh');
  });

  // 19. POST /inventory/use ({inventoryItemId:'bogus'}) post-onboard →
  //     404 INVENTORY_ITEM_NOT_FOUND.
  await step('POST /inventory/use — (bogus id) post-onboard 404 INVENTORY_ITEM_NOT_FOUND', async () => {
    const r = await http('/api/inventory/use', {
      method: 'POST',
      body: { inventoryItemId: randomBogusId() },
    });
    assertStatus(r, 404, 'POST /inventory/use bogus id');
    assertErrorCode(r, 'INVENTORY_ITEM_NOT_FOUND', 'POST /inventory/use bogus id');
  });

  // 20. Anti-FE-self-grant invariant — verify inventory + currencies +
  //     hp/mp KHÔNG đổi sau toàn bộ 4xx attempts (server-authoritative,
  //     không có ngả nào đẩy state lên server thông qua 4xx fail).
  await step('anti-FE-self-grant — inventory + hp/mp/linhThach unchanged after 4xx attempts', async () => {
    const afterItems = await fetchInventoryItems();
    assert(
      afterItems.length === beforeItems.length,
      `inventory length đổi: ${beforeItems.length} → ${afterItems.length}`,
    );
    assert(afterItems.length === 0, `inventory expect vẫn empty got ${afterItems.length}`);
    const afterChar = await fetchCharSnapshot();
    assert(afterChar.hp === beforeChar.hp, `hp đổi: ${beforeChar.hp} → ${afterChar.hp}`);
    assert(afterChar.mp === beforeChar.mp, `mp đổi: ${beforeChar.mp} → ${afterChar.mp}`);
    assert(
      afterChar.linhThach === beforeChar.linhThach,
      `linhThach đổi: ${beforeChar.linhThach} → ${afterChar.linhThach}`,
    );
    assert(
      afterChar.tienNgoc === beforeChar.tienNgoc,
      `tienNgoc đổi: ${beforeChar.tienNgoc} → ${afterChar.tienNgoc}`,
    );
  });

  // 21. Logout + GET /inventory → 401.
  await step('logout + GET /inventory 401 UNAUTHENTICATED', async () => {
    const logout = await http('/api/_auth/logout', { method: 'POST' });
    assertStatus(logout, [200, 204], 'logout');
    const after = await http('/api/inventory');
    assertStatus(after, 401, 'GET /inventory post-logout');
    assertErrorCode(after, 'UNAUTHENTICATED', 'GET /inventory post-logout');
  });

  // -----------------------------------------------------------------------------
  // Summary.
  // -----------------------------------------------------------------------------

  const failed = results.filter((x) => !x.ok);
  console.log('');
  console.log(`[smoke:inventory] ${results.length - failed.length}/${results.length} steps OK`);
  if (failed.length > 0) {
    console.log('');
    console.log(`[smoke:inventory] FAILED:`);
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.note ?? ''}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`[smoke:inventory] all OK`);
  }
}

main().catch((err) => {
  console.error('[smoke:inventory] unexpected error:', err);
  process.exitCode = 1;
});
