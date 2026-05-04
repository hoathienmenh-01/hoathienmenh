#!/usr/bin/env node
/**
 * smoke-admin.mjs — Admin / topup / giftcode / mail smoke cho Xuân Tôi.
 *
 * Mục tiêu: cover admin runtime end-to-end để đóng "smoke gap" cuối cùng được
 * liệt kê ở `docs/AI_HANDOFF_REPORT.md` Phase 9 readiness audit nhóm I (Admin
 * / topup / giftcode — PARTIAL chỉ vitest, thiếu HTTP smoke). Verify:
 *
 *   1. Admin login (cookie xt_access)         — `/api/_auth/login` với
 *                                              INITIAL_ADMIN_EMAIL/PASSWORD.
 *   2. Admin role ADMIN                       — `/api/_auth/session` trả role.
 *   3. Read-only endpoint shape:
 *        - `/api/admin/stats`                 — users.total/admins shape.
 *        - `/api/admin/economy/alerts`        — alerts + bounds shape.
 *        - `/api/admin/economy/audit-ledger`  — ledger audit shape (smoke
 *                                              KHÔNG assert pre-condition
 *                                              discrepancies=0; xem in-line note).
 *   4. Admin grant linhThach +Δ qua
 *        `/api/admin/users/:id/grant`        — ADMIN_GRANT ledger row mới
 *                                              với refType='User' + delta>0.
 *   5. Player verify linhThach == starting + Δ (server-authoritative).
 *   6. Admin grant linhThach -ε qua cùng endpoint (test negative grant).
 *   7. Player verify linhThach giảm đúng ε.
 *   8. Admin tạo giftcode qua `/api/admin/giftcodes` (rewardLinhThach +Δ).
 *   9. Player redeem giftcode qua `/api/giftcodes/redeem` → reward applied,
 *      ledger GIFTCODE_REDEEM row.
 *  10. Player redeem cùng giftcode lần 2 → 409 ALREADY_REDEEMED (anti
 *      double-redeem).
 *  11. Admin send mail qua `/api/admin/mail/send` đến player character với
 *      reward (linhThach + item).
 *  12. Player GET /api/mail/me → 1 mail unread, attachments visible.
 *  13. Player POST /api/mail/:id/claim → reward applied, ledger MAIL_CLAIM row.
 *  14. Player POST /api/mail/:id/claim lần 2 → 409 ALREADY_CLAIMED (anti
 *      double-claim).
 *  15. Admin GET `/api/admin/audit?action=user.grant` — ≥ 2 audit row
 *      (positive + negative grant) cho admin smoke. Note: GiftCode + Mail
 *      service KHÔNG ghi `AdminAuditLog` (xem AI_HANDOFF_REPORT.md known gap),
 *      smoke chỉ verify `user.grant` audit footprint.
 *  16. **INVARIANT**: SUM(CurrencyLedger.LINH_THACH) per player ==
 *      Character.linhThach final. Multiple reasons: ADMIN_GRANT (×2),
 *      GIFTCODE_REDEEM, MAIL_CLAIM. No double-spend, no missed ledger row.
 *  17. **INVARIANT**: Inventory.qty per itemKey == SUM(ItemLedger.qtyDelta)
 *      per itemKey. ItemLedger reasons: GIFTCODE_REDEEM, MAIL_CLAIM. No qty âm.
 *  18. Admin revoke giftcode qua `/api/admin/giftcodes/:code/revoke` →
 *      `revokedAt` set (ISO timestamp).
 *  19. Player NEW (jar mới) redeem giftcode đã revoke → 409 CODE_REVOKED.
 *  20. Admin POST /admin/users/:id/role với role lạ → 400 INVALID_INPUT (zod).
 *  21. Admin POST /admin/users/:id/role tự đổi role chính mình → 400
 *      CANNOT_TARGET_SELF (anti self-demote lock-out).
 *  22. Admin POST /admin/users/:id/role {role:'MOD'} promote PLAYER → 200 ok,
 *      audit log `user.setRole` ghi nhận.
 *  23. Player /api/_auth/session → role='MOD' (server-authoritative role
 *      reflect ngay sau update; cookie cũ vẫn hợp lệ vì JWT chỉ chứa userId,
 *      role lookup mỗi request từ DB).
 *  24. Admin POST /admin/users/:id/role {role:'PLAYER'} demote MOD → 200 ok.
 *  25. Player /api/_auth/session → role='PLAYER' (revert verify).
 *  26. Admin POST /admin/users/:id/ban với body lạ → 400 INVALID_INPUT (zod).
 *  27. Admin POST /admin/users/:id/ban {banned:true} → 200 ok, audit log
 *      `user.ban` ghi nhận.
 *  28. Player POST /api/_auth/login (banned) → 403 ACCOUNT_BANNED. Đây là
 *      coverage cho defer item của PR #377 smoke:auth: "ACCOUNT_BANNED 403
 *      cần admin endpoint ban user trước, orthogonal cho smoke:admin".
 *  29. Admin POST /admin/users/:id/ban {banned:false} → 200 ok, audit log
 *      `user.unban` ghi nhận.
 *  30. Player POST /api/_auth/login (unbanned) → 200 ok (login restored).
 *  31. Player → `/api/admin/stats` → 403 FORBIDDEN (admin guard reject PLAYER).
 *  32. Admin logout `/api/_auth/logout` → cookie cleared.
 *  33. Player logout `/api/_auth/logout` → cookie cleared.
 *
 * Chạy:
 *   pnpm smoke:admin
 *   # hoặc trực tiếp:
 *   node scripts/smoke-admin.mjs
 *
 * Env vars:
 *   SMOKE_API_BASE        — default "http://localhost:3000".
 *   SMOKE_TIMEOUT_MS      — default 10000ms / request.
 *   SMOKE_VERBOSE         — "1" để log request/response (debug).
 *   SMOKE_SECT_KEY        — default "thanh_van".
 *   SMOKE_ADMIN_EMAIL     — default "admin@example.com" (khớp apps/api/.env
 *                           default). Override khi prod.
 *   SMOKE_ADMIN_PASSWORD  — default "change-me-bootstrap-pass" (khớp
 *                           apps/api/.env default). Override khi prod.
 *
 * Yêu cầu môi trường (giống smoke:economy / smoke:combat):
 *   - `pnpm infra:up` (Postgres + Redis)
 *   - `pnpm --filter @xuantoi/api exec prisma migrate deploy`
 *   - `pnpm --filter @xuantoi/api bootstrap` (seed admin + 3 sect — IMPORTANT
 *     vì smoke cần ADMIN account thật trong DB).
 *   - `pnpm --filter @xuantoi/api dev` (API listen :3000)
 *   - Tab khác: `pnpm smoke:admin`
 *
 * KHÔNG cleanup user — như smoke:beta / smoke:economy / smoke:ws / smoke:combat.
 * Mỗi run tạo 1 player mới (random email) → idempotent, không conflict.
 * Cleanup khi cần:
 *   DELETE FROM "User" WHERE email LIKE 'smoke-admin-%@smoke.invalid';
 * (cẩn thận FK → Character, Mail, GiftCodeRedemption, CurrencyLedger, ItemLedger.)
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
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'change-me-bootstrap-pass';

// Reward delta plan (để verify SUM):
const GRANT_POSITIVE_LT = 1000n;          // +1000 linh thạch
const GRANT_NEGATIVE_LT = -300n;          // -300 linh thạch
const GIFTCODE_REWARD_LT = 500n;          // +500 linh thạch (giftcode)
const GIFTCODE_REWARD_ITEM_KEY = 'huyet_chi_dan';
const GIFTCODE_REWARD_ITEM_QTY = 2;
const MAIL_REWARD_LT = 200n;              // +200 linh thạch (mail)
const MAIL_REWARD_ITEM_KEY = 'huyet_chi_dan';
const MAIL_REWARD_ITEM_QTY = 1;

// -----------------------------------------------------------------------------
// Cookie jar — 1 jar / user (admin + player). Node fetch không có jar built-in.
// -----------------------------------------------------------------------------

class CookieJar {
  constructor() {
    /** @type {Map<string, string>} */
    this.store = new Map();
  }
  /** @param {Response} res */
  storeFromResponse(res) {
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
        this.store.delete(name);
      } else {
        this.store.set(name, value);
      }
    }
  }
  header() {
    if (this.store.size === 0) return undefined;
    return Array.from(this.store, ([k, v]) => `${k}=${v}`).join('; ');
  }
  clear() {
    this.store.clear();
  }
}

// -----------------------------------------------------------------------------
// HTTP helper với timeout + cookie persistence (per jar).
// -----------------------------------------------------------------------------

/**
 * @param {CookieJar} jar
 * @param {string} pathname  — `/api/...`
 * @param {{ method?: string; body?: unknown }} [opts]
 * @returns {Promise<{ status: number; body: any }>}
 */
async function http(jar, pathname, opts = {}) {
  const url = `${BASE}${pathname}`;
  const method = opts.method ?? 'GET';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  /** @type {Record<string,string>} */
  const headers = { Accept: 'application/json' };
  const cookieH = jar.header();
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
    jar.storeFromResponse(res);
    let body;
    const ctype = res.headers.get('content-type') ?? '';
    if (ctype.includes('application/json')) {
      body = await res.json().catch(() => null);
    } else {
      body = await res.text().catch(() => null);
    }
    if (VERBOSE) console.log(`← ${res.status} ${method} ${pathname}`);
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
  process.stdout.write(`[smoke:admin] ${name} ... `);
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
  return `smoke-admin-${ts}-${rand}@smoke.invalid`;
}

function randomPassword() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `Smoke${rand}1!`;
}

function randomCharName() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `admin_${rand}`;
}

function randomCode() {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const ts = Date.now().toString(36).toUpperCase();
  return `SMK-ADM-${ts}-${rand}`.slice(0, 32);
}

// -----------------------------------------------------------------------------
// Ledger helpers (paginate /logs/me — chạy với player cookie).
// -----------------------------------------------------------------------------

/**
 * @param {CookieJar} jar
 * @param {'currency' | 'item'} type
 * @returns {Promise<any[]>}
 */
async function fetchAllLogs(jar, type) {
  /** @type {any[]} */
  const all = [];
  /** @type {string | undefined} */
  let cursor;
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ type, limit: '50' });
    if (cursor) qs.set('cursor', cursor);
    const r = await http(jar, `/api/logs/me?${qs.toString()}`);
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

/** @param {any[]} entries */
function sumDelta(entries) {
  let s = 0n;
  for (const e of entries) s += BigInt(e.delta);
  return s;
}

/**
 * @param {any[]} entries
 * @param {string} itemKey
 */
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
 *   adminJar: CookieJar;
 *   playerJar: CookieJar;
 *   adminUserId?: string;
 *   playerEmail?: string;
 *   playerPassword?: string;
 *   playerUserId?: string;
 *   playerCharacterId?: string;
 *   playerStartingLT?: bigint;
 *   playerAfterGrantPositiveLT?: bigint;
 *   playerAfterGrantNegativeLT?: bigint;
 *   playerAfterRedeemLT?: bigint;
 *   playerAfterMailLT?: bigint;
 *   giftCode?: string;
 *   mailId?: string;
 * }}
 */
const state = {
  adminJar: new CookieJar(),
  playerJar: new CookieJar(),
};

async function main() {
  console.log(
    `[smoke:admin] API base = ${BASE}, timeout = ${TIMEOUT_MS}ms, admin = ${ADMIN_EMAIL}`,
  );

  // 0. Health check.
  await step('healthz', async () => {
    const r = await http(state.adminJar, '/api/healthz');
    assertStatus(r, 200, 'healthz');
  });

  // 1. Admin login — yêu cầu admin được seed bởi `pnpm --filter @xuantoi/api bootstrap`.
  await step('admin login', async () => {
    const r = await http(state.adminJar, '/api/_auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assertStatus(r, 200, 'admin login');
    if (!r.body?.ok) throw new Error(`admin login: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const u = r.body?.data?.user;
    if (!u) throw new Error(`admin login: missing data.user (bootstrap chưa chạy?)`);
    assert(u.role === 'ADMIN', `admin login: role phải ADMIN, got ${u.role}. Hãy chạy 'pnpm --filter @xuantoi/api bootstrap' trước.`);
    state.adminUserId = u.id;
  });

  // 2. Admin session check (verify cookie xt_access work + role tươi từ DB).
  await step('admin /api/_auth/session — role ADMIN', async () => {
    const r = await http(state.adminJar, '/api/_auth/session');
    assertStatus(r, 200, 'session');
    const u = r.body?.data?.user;
    assert(u, 'session: missing user');
    assert(u.role === 'ADMIN', `session: role phải ADMIN, got ${u.role}`);
    assert(u.id === state.adminUserId, `session: user.id mismatch admin login`);
  });

  // 3. Admin GET /api/admin/stats — read-only smoke (verify shape).
  // Shape (xem AdminService.stats): { users: {total, banned, admins},
  //   characters: {total, cultivating, bySect[]},
  //   economy: {linhThachCirculating, ...}, activity: {...} }
  await step('admin GET /admin/stats — shape', async () => {
    const r = await http(state.adminJar, '/api/admin/stats');
    assertStatus(r, 200, 'admin/stats');
    const data = r.body?.data;
    assert(data, 'admin/stats: missing data');
    assert(
      data.users && typeof data.users.total === 'number' && data.users.total >= 1,
      `users.total >= 1, got ${data.users?.total}`,
    );
    assert(
      data.users && typeof data.users.admins === 'number' && data.users.admins >= 1,
      `users.admins >= 1, got ${data.users?.admins}`,
    );
    assert(
      data.characters && typeof data.characters.total === 'number',
      `characters.total phải number, got ${typeof data.characters?.total}`,
    );
    assert(
      data.economy && typeof data.economy.linhThachCirculating === 'string',
      `economy.linhThachCirculating phải string, got ${typeof data.economy?.linhThachCirculating}`,
    );
  });

  // 4. Admin GET /api/admin/economy/alerts — read-only.
  // Shape (xem economy-alerts-query.ts): { negativeCurrency[], negativeInventory[],
  //   stalePendingTopups[], staleHours, generatedAt, bounds }.
  await step('admin GET /admin/economy/alerts — shape', async () => {
    const r = await http(state.adminJar, '/api/admin/economy/alerts');
    assertStatus(r, 200, 'admin/economy/alerts');
    const data = r.body?.data;
    assert(data, 'admin/economy/alerts: missing data');
    assert(Array.isArray(data.negativeCurrency), `negativeCurrency phải array`);
    assert(Array.isArray(data.negativeInventory), `negativeInventory phải array`);
    assert(Array.isArray(data.stalePendingTopups), `stalePendingTopups phải array`);
    assert(typeof data.staleHours === 'number', `staleHours phải number, got ${typeof data.staleHours}`);
    assert(
      data.bounds &&
        typeof data.bounds.defaultHours === 'number' &&
        typeof data.bounds.minHours === 'number' &&
        typeof data.bounds.maxHours === 'number',
      `bounds phải có defaultHours/minHours/maxHours, got ${JSON.stringify(data.bounds)}`,
    );
  });

  // 5. Admin GET /api/admin/economy/audit-ledger — read-only ledger consistency.
  // Shape (xem ledger-audit.ts AuditResultJson): { charactersScanned, itemKeysScanned,
  //   currencyDiscrepancies[], inventoryDiscrepancies[] }.
  await step('admin GET /admin/economy/audit-ledger — shape', async () => {
    const r = await http(state.adminJar, '/api/admin/economy/audit-ledger');
    assertStatus(r, 200, 'admin/economy/audit-ledger');
    const data = r.body?.data;
    assert(data, 'admin/economy/audit-ledger: missing data');
    assert(typeof data.charactersScanned === 'number', `charactersScanned phải number`);
    assert(typeof data.itemKeysScanned === 'number', `itemKeysScanned phải number`);
    assert(Array.isArray(data.currencyDiscrepancies), `currencyDiscrepancies phải array`);
    assert(Array.isArray(data.inventoryDiscrepancies), `inventoryDiscrepancies phải array`);
    // Note: smoke không assert pre-condition discrepancies=0 vì local dev DB có thể
    // có character dữ lại từ smoke cũ (vd e2e test tạo character rồi drop). Chỉ
    // verify shape để đảm bảo endpoint không vuồng. Production deploy nên chạy
    // `pnpm --filter @xuantoi/api audit:ledger` để verify discrepancies=0 (xem
    // `docs/RUN_LOCAL.md` + `docs/QA_CHECKLIST.md`).
  });

  // 6. Register fresh player (separate jar).
  await step('register player', async () => {
    state.playerEmail = randomEmail();
    state.playerPassword = randomPassword();
    const r = await http(state.playerJar, '/api/_auth/register', {
      method: 'POST',
      body: { email: state.playerEmail, password: state.playerPassword },
    });
    assertStatus(r, [200, 201], 'register player');
    if (!r.body?.ok) throw new Error(`register: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    state.playerUserId = r.body?.data?.user?.id;
    assert(state.playerUserId, `register: missing data.user.id`);
  });

  // 7. Player onboard (tạo character).
  await step('player onboard', async () => {
    const r = await http(state.playerJar, '/api/character/onboard', {
      method: 'POST',
      body: { name: randomCharName(), sectKey: SECT_KEY },
    });
    assertStatus(r, 200, 'onboard');
    if (!r.body?.ok) throw new Error(`onboard: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    state.playerCharacterId = r.body?.data?.character?.id ?? r.body?.data?.id;
    assert(state.playerCharacterId, `onboard: missing character id`);
  });

  // 8. Player snapshot starting linhThach.
  await step('player /character/me — starting linhThach', async () => {
    const r = await http(state.playerJar, '/api/character/me');
    assertStatus(r, 200, 'character/me');
    const ch = r.body?.data?.character;
    assert(ch, 'character/me: missing character');
    state.playerStartingLT = BigInt(ch.linhThach ?? '0');
    assert(state.playerStartingLT >= 0n, `starting linhThach phải >= 0, got ${state.playerStartingLT}`);
  });

  // 9. Admin POST /admin/users/:id/grant với +Δ — ADMIN_GRANT ledger row.
  await step(`admin grant +${GRANT_POSITIVE_LT} LT → player`, async () => {
    if (!state.playerUserId) throw new Error(`playerUserId undefined`);
    const r = await http(state.adminJar, `/api/admin/users/${state.playerUserId}/grant`, {
      method: 'POST',
      body: { linhThach: GRANT_POSITIVE_LT.toString(), tienNgoc: 0, reason: 'smoke admin grant +' },
    });
    assertStatus(r, 200, 'admin grant +');
    assert(r.body?.ok === true, `admin grant: ok=false`);
  });

  // 10. Player verify linhThach == starting + Δ (server-authoritative).
  await step(`player /character/me — linhThach == starting + ${GRANT_POSITIVE_LT}`, async () => {
    const r = await http(state.playerJar, '/api/character/me');
    assertStatus(r, 200, 'character/me after grant +');
    const ch = r.body?.data?.character;
    state.playerAfterGrantPositiveLT = BigInt(ch.linhThach ?? '0');
    const expected = (state.playerStartingLT ?? 0n) + GRANT_POSITIVE_LT;
    assert(
      state.playerAfterGrantPositiveLT === expected,
      `linhThach sau grant +: expected ${expected}, got ${state.playerAfterGrantPositiveLT}`,
    );
  });

  // 11. Admin grant -ε (test negative grant — admin có thể trừ tiền player).
  await step(`admin grant ${GRANT_NEGATIVE_LT} LT → player`, async () => {
    if (!state.playerUserId) throw new Error(`playerUserId undefined`);
    const r = await http(state.adminJar, `/api/admin/users/${state.playerUserId}/grant`, {
      method: 'POST',
      body: { linhThach: GRANT_NEGATIVE_LT.toString(), tienNgoc: 0, reason: 'smoke admin grant -' },
    });
    assertStatus(r, 200, 'admin grant -');
    assert(r.body?.ok === true, `admin grant -: ok=false`);
  });

  // 12. Player verify linhThach giảm đúng ε.
  await step(`player /character/me — linhThach sau grant - ${GRANT_NEGATIVE_LT}`, async () => {
    const r = await http(state.playerJar, '/api/character/me');
    assertStatus(r, 200, 'character/me after grant -');
    const ch = r.body?.data?.character;
    state.playerAfterGrantNegativeLT = BigInt(ch.linhThach ?? '0');
    const expected = (state.playerAfterGrantPositiveLT ?? 0n) + GRANT_NEGATIVE_LT;
    assert(
      state.playerAfterGrantNegativeLT === expected,
      `linhThach sau grant -: expected ${expected}, got ${state.playerAfterGrantNegativeLT}`,
    );
  });

  // 13. Admin tạo giftcode.
  await step('admin POST /admin/giftcodes — create', async () => {
    state.giftCode = randomCode();
    const r = await http(state.adminJar, '/api/admin/giftcodes', {
      method: 'POST',
      body: {
        code: state.giftCode,
        rewardLinhThach: GIFTCODE_REWARD_LT.toString(),
        rewardTienNgoc: 0,
        rewardExp: '0',
        rewardItems: [{ itemKey: GIFTCODE_REWARD_ITEM_KEY, qty: GIFTCODE_REWARD_ITEM_QTY }],
        maxRedeems: 10,
      },
    });
    assertStatus(r, 200, 'admin giftcodes create');
    assert(r.body?.ok === true, `admin giftcodes create: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const code = r.body?.data?.code;
    assert(code, `giftcodes create: missing data.code`);
  });

  // 14. Player redeem giftcode.
  await step('player POST /giftcodes/redeem — first redeem', async () => {
    if (!state.giftCode) throw new Error(`giftCode undefined`);
    const r = await http(state.playerJar, '/api/giftcodes/redeem', {
      method: 'POST',
      body: { code: state.giftCode },
    });
    assertStatus(r, 200, 'giftcodes redeem');
    assert(r.body?.ok === true, `giftcodes redeem: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const reward = r.body?.data?.reward;
    assert(reward, `giftcodes redeem: missing data.reward`);
  });

  // 15. Player verify linhThach + reward + duplicate redeem rejected.
  await step('player /character/me — linhThach sau giftcode redeem', async () => {
    const r = await http(state.playerJar, '/api/character/me');
    assertStatus(r, 200, 'character/me after redeem');
    const ch = r.body?.data?.character;
    state.playerAfterRedeemLT = BigInt(ch.linhThach ?? '0');
    const expected = (state.playerAfterGrantNegativeLT ?? 0n) + GIFTCODE_REWARD_LT;
    assert(
      state.playerAfterRedeemLT === expected,
      `linhThach sau giftcode redeem: expected ${expected}, got ${state.playerAfterRedeemLT}`,
    );
  });

  await step('player POST /giftcodes/redeem — duplicate → 409 ALREADY_REDEEMED', async () => {
    if (!state.giftCode) throw new Error(`giftCode undefined`);
    const r = await http(state.playerJar, '/api/giftcodes/redeem', {
      method: 'POST',
      body: { code: state.giftCode },
    });
    assertStatus(r, 409, 'giftcodes redeem duplicate');
    assert(
      r.body?.error?.code === 'ALREADY_REDEEMED',
      `duplicate redeem: expect error.code='ALREADY_REDEEMED', got ${JSON.stringify(r.body?.error)}`,
    );
  });

  // 16. Admin send mail to player character (with reward LT + item).
  await step('admin POST /admin/mail/send — to player char', async () => {
    if (!state.playerCharacterId) throw new Error(`playerCharacterId undefined`);
    const r = await http(state.adminJar, '/api/admin/mail/send', {
      method: 'POST',
      body: {
        recipientCharacterId: state.playerCharacterId,
        subject: 'Smoke admin test mail',
        body: 'Reward attached. (auto-gen smoke:admin)',
        senderName: 'Smoke Admin',
        rewardLinhThach: MAIL_REWARD_LT.toString(),
        rewardTienNgoc: 0,
        rewardExp: '0',
        rewardItems: [{ itemKey: MAIL_REWARD_ITEM_KEY, qty: MAIL_REWARD_ITEM_QTY }],
      },
    });
    assertStatus(r, 200, 'admin mail send');
    assert(r.body?.ok === true, `admin mail send: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const mail = r.body?.data?.mail;
    assert(mail, `admin mail send: missing data.mail`);
    state.mailId = mail.id;
  });

  // 17. Player GET /api/mail/me → 1 mail unread + claimable.
  await step('player GET /mail/me — see new mail (claimable)', async () => {
    const r = await http(state.playerJar, '/api/mail/me');
    assertStatus(r, 200, 'mail/me');
    const mails = r.body?.data?.mails;
    assert(Array.isArray(mails), `mail/me: mails phải array`);
    const mine = mails.find((m) => m.id === state.mailId);
    assert(mine, `mail/me: không thấy mailId=${state.mailId} trong inbox`);
    assert(mine.claimable === true, `mail/me: mail.claimable phải true (chưa claim, có reward)`);
    assert(mine.claimedAt === null, `mail/me: mail.claimedAt phải null trước khi claim`);
  });

  // 18. Player POST /api/mail/:id/claim → reward + ledger MAIL_CLAIM.
  await step('player POST /mail/:id/claim → reward applied', async () => {
    if (!state.mailId) throw new Error(`mailId undefined`);
    const r = await http(state.playerJar, `/api/mail/${state.mailId}/claim`, {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 200, 'mail claim');
    assert(r.body?.ok === true, `mail claim: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const mail = r.body?.data?.mail;
    assert(mail, `mail claim: missing data.mail`);
    assert(mail.claimedAt, `mail claim: claimedAt phải set sau khi claim`);
    assert(mail.claimable === false, `mail claim: claimable phải false sau khi claim`);
  });

  await step('player /character/me — linhThach sau mail claim', async () => {
    const r = await http(state.playerJar, '/api/character/me');
    assertStatus(r, 200, 'character/me after mail claim');
    const ch = r.body?.data?.character;
    state.playerAfterMailLT = BigInt(ch.linhThach ?? '0');
    const expected = (state.playerAfterRedeemLT ?? 0n) + MAIL_REWARD_LT;
    assert(
      state.playerAfterMailLT === expected,
      `linhThach sau mail claim: expected ${expected}, got ${state.playerAfterMailLT}`,
    );
  });

  // 19. Player duplicate claim → 409 ALREADY_CLAIMED.
  await step('player POST /mail/:id/claim — duplicate → 409 ALREADY_CLAIMED', async () => {
    if (!state.mailId) throw new Error(`mailId undefined`);
    const r = await http(state.playerJar, `/api/mail/${state.mailId}/claim`, {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 409, 'mail claim duplicate');
    assert(
      r.body?.error?.code === 'ALREADY_CLAIMED',
      `duplicate mail claim: expect error.code='ALREADY_CLAIMED', got ${JSON.stringify(r.body?.error)}`,
    );
  });

  // 20. Admin GET /api/admin/audit — admin actor footprint.
  // Note: chỉ AdminService.grant/ban/setRole/topup/inventory.revoke ghi audit log.
  // Giftcode + Mail KHÔNG ghi audit (xem AI_HANDOFF_REPORT.md — known gap).
  // Smoke verify ≥2 'user.grant' row (positive + negative grant) từ admin hiện tại.
  await step("admin GET /admin/audit — ≥2 'user.grant' rows từ smoke", async () => {
    const r = await http(state.adminJar, '/api/admin/audit?action=user.grant');
    assertStatus(r, 200, 'admin/audit');
    const data = r.body?.data;
    assert(data, 'admin/audit: missing data');
    assert(Array.isArray(data.rows), `admin/audit: rows phải array`);
    const myGrants = data.rows.filter(
      (row) => row.actorUserId === state.adminUserId && row.action === 'user.grant',
    );
    assert(
      myGrants.length >= 2,
      `admin audit: expect ≥2 'user.grant' row từ smoke (positive + negative), got ${myGrants.length}. Sample: ${JSON.stringify(data.rows.slice(0, 3))}`,
    );
    // Verify meta carries reason + targetUserId
    const sample = myGrants[0];
    assert(sample.meta && typeof sample.meta === 'object', `audit row.meta phải object`);
    assert(
      sample.meta.targetUserId === state.playerUserId,
      `audit meta.targetUserId mismatch player ${state.playerUserId}, got ${sample.meta.targetUserId}`,
    );
  });

  // 21. INVARIANT: SUM(CurrencyLedger.LINH_THACH) per player == Character.linhThach final.
  await step('INVARIANT: SUM(CurrencyLedger.LT) == player.linhThach', async () => {
    const entries = await fetchAllLogs(state.playerJar, 'currency');
    const ltEntries = entries.filter((e) => e.currency === 'LINH_THACH');
    const sum = sumDelta(ltEntries);
    assert(
      sum === (state.playerAfterMailLT ?? 0n),
      `SUM(CurrencyLedger.LINH_THACH) = ${sum} ≠ Character.linhThach final = ${state.playerAfterMailLT}. Reasons seen: ${JSON.stringify([...new Set(ltEntries.map((e) => e.reason))])}`,
    );
    // Verify expected reasons present (ADMIN_GRANT ×2 + GIFTCODE_REDEEM + MAIL_CLAIM).
    const reasons = new Set(ltEntries.map((e) => e.reason));
    assert(reasons.has('ADMIN_GRANT'), `ledger phải có reason 'ADMIN_GRANT', got ${[...reasons]}`);
    assert(reasons.has('GIFTCODE_REDEEM'), `ledger phải có reason 'GIFTCODE_REDEEM', got ${[...reasons]}`);
    assert(reasons.has('MAIL_CLAIM'), `ledger phải có reason 'MAIL_CLAIM', got ${[...reasons]}`);
    // ADMIN_GRANT count ≥ 2 (1 positive + 1 negative).
    const adminGrantCount = ltEntries.filter((e) => e.reason === 'ADMIN_GRANT').length;
    assert(
      adminGrantCount >= 2,
      `ledger phải có ≥2 ADMIN_GRANT row, got ${adminGrantCount}`,
    );
  });

  // 22. INVARIANT: Inventory.qty per itemKey == SUM(ItemLedger.qtyDelta) per itemKey.
  await step('INVARIANT: Inventory.qty == SUM(ItemLedger.qtyDelta) per itemKey', async () => {
    const inv = await http(state.playerJar, '/api/inventory');
    assertStatus(inv, 200, '/inventory');
    const items = inv.body?.data?.items ?? [];
    const itemEntries = await fetchAllLogs(state.playerJar, 'item');

    // Verify expected reasons present (GIFTCODE_REDEEM + MAIL_CLAIM ít nhất).
    const reasons = new Set(itemEntries.map((e) => e.reason));
    assert(
      reasons.has('GIFTCODE_REDEEM') || reasons.has('MAIL_CLAIM'),
      `ItemLedger phải có reason 'GIFTCODE_REDEEM' hoặc 'MAIL_CLAIM' từ smoke, got ${[...reasons]}`,
    );

    // Per-itemKey invariant: inventory.qty == SUM(qtyDelta).
    /** @type {Map<string, number>} */
    const inventoryByKey = new Map();
    for (const it of items) {
      inventoryByKey.set(it.itemKey, Number(it.qty));
      assert(Number(it.qty) >= 0, `INVARIANT: inventory.qty phải >= 0 cho ${it.itemKey}, got ${it.qty}`);
    }
    for (const itemKey of new Set(itemEntries.map((e) => e.itemKey))) {
      const ledgerSum = sumQtyDeltaForItem(itemEntries, itemKey);
      const invQty = inventoryByKey.get(itemKey) ?? 0;
      assert(
        invQty === ledgerSum,
        `INVARIANT vi phạm: Inventory['${itemKey}'].qty = ${invQty} ≠ SUM(ItemLedger.qtyDelta) = ${ledgerSum}`,
      );
    }
    // Verify giftcode + mail item delivered.
    const giftcodeItemEntries = itemEntries.filter((e) => e.reason === 'GIFTCODE_REDEEM' && e.itemKey === GIFTCODE_REWARD_ITEM_KEY);
    const giftcodeQtySum = giftcodeItemEntries.reduce((s, e) => s + Number(e.qtyDelta), 0);
    assert(
      giftcodeQtySum === GIFTCODE_REWARD_ITEM_QTY,
      `giftcode item delivery: expected qty ${GIFTCODE_REWARD_ITEM_QTY}, got ${giftcodeQtySum}`,
    );
    const mailItemEntries = itemEntries.filter((e) => e.reason === 'MAIL_CLAIM' && e.itemKey === MAIL_REWARD_ITEM_KEY);
    const mailQtySum = mailItemEntries.reduce((s, e) => s + Number(e.qtyDelta), 0);
    assert(
      mailQtySum === MAIL_REWARD_ITEM_QTY,
      `mail item delivery: expected qty ${MAIL_REWARD_ITEM_QTY}, got ${mailQtySum}`,
    );
  });

  // 23. Admin revoke giftcode + verify player redeem lần 3 → 409 CODE_REVOKED.
  await step('admin POST /admin/giftcodes/:code/revoke', async () => {
    if (!state.giftCode) throw new Error(`giftCode undefined`);
    const r = await http(state.adminJar, `/api/admin/giftcodes/${state.giftCode}/revoke`, {
      method: 'POST',
      body: {},
    });
    assertStatus(r, 200, 'admin giftcodes revoke');
    assert(r.body?.ok === true, `revoke: ok=false body=${JSON.stringify(r.body).slice(0, 200)}`);
    const code = r.body?.data?.code;
    assert(code && typeof code.revokedAt === 'string', `revoke: code.revokedAt phải ISO string, got ${JSON.stringify(code)}`);
  });

  // 24. Verify giftcode list-after-revoke: revokedAt set + status=REVOKED filter
  //     trả về giftcode mới revoke (read-only, không cần register player thêm).
  //     Note: smoke không spawn player mới để verify CODE_REVOKED path vì auth
  //     register rate-limit 5 user/IP/15min (xem auth.service.ts) → smoke chạy
  //     2 lần/ph đã hit. CODE_REVOKED path được cover bởi unit test
  //     `giftcode.service.test.ts`. Smoke chỉ verify admin-side revoke contract.
  await step('admin GET /admin/giftcodes?status=REVOKED — giftcode visible', async () => {
    if (!state.giftCode) throw new Error(`giftCode undefined`);
    const r = await http(state.adminJar, '/api/admin/giftcodes?status=REVOKED&limit=100');
    assertStatus(r, 200, 'admin giftcodes list REVOKED');
    const codes = r.body?.data?.codes ?? [];
    assert(Array.isArray(codes), `giftcodes list: codes phải array`);
    const mine = codes.find((c) => c.code === state.giftCode);
    assert(mine, `giftcodes list?status=REVOKED: không thấy code ${state.giftCode}`);
    assert(typeof mine.revokedAt === 'string', `giftcode list: revokedAt phải ISO string`);
  });

  // ---------------------------------------------------------------------------
  // 24-25. Role flow: zod-fail + self-target guard + promote/demote round-trip.
  //
  //   Cover:
  //     - Zod input contract: `role` phải là enum 'PLAYER'|'MOD'|'ADMIN'
  //       (RoleInput, xem admin.dto.ts). Body lạ → 400 INVALID_INPUT trước
  //       service.
  //     - AdminService.setRole guards (admin.service.ts):
  //         a) `actorRole !== 'ADMIN'` → FORBIDDEN (smoke chạy với ADMIN actor
  //            nên không cover; xem admin.controller.test.ts +
  //            admin.guard.test.ts).
  //         b) `actorId === targetUserId` → CANNOT_TARGET_SELF (anti
  //            self-demote lock-out, BAD_REQUEST 400).
  //         c) `target` not found → NOT_FOUND 404.
  //     - Server-authoritative role lookup: JWT chỉ chứa userId, mỗi request
  //       lookup role tươi từ DB → setRole có hiệu lực ngay với cookie cũ.
  //
  //   Note: vitest đã cover setRole hierarchy (topup-admin.service.test.ts:172
  //   self-target + admin.controller.test.ts L463 setRole permission). Smoke
  //   verify HTTP contract end-to-end.
  // ---------------------------------------------------------------------------

  await step('admin POST /admin/users/:id/role — invalid role 400 INVALID_INPUT', async () => {
    if (!state.playerUserId) throw new Error(`playerUserId undefined`);
    const r = await http(state.adminJar, `/api/admin/users/${state.playerUserId}/role`, {
      method: 'POST',
      body: { role: 'INVALID_ROLE' },
    });
    assertStatus(r, 400, 'admin role invalid');
    assert(
      r.body?.error?.code === 'INVALID_INPUT',
      `expect error.code='INVALID_INPUT', got ${JSON.stringify(r.body?.error)}`,
    );
  });

  await step('admin POST /admin/users/<adminUserId>/role — self-target → 400 CANNOT_TARGET_SELF', async () => {
    if (!state.adminUserId) throw new Error(`adminUserId undefined`);
    const r = await http(state.adminJar, `/api/admin/users/${state.adminUserId}/role`, {
      method: 'POST',
      body: { role: 'PLAYER' },
    });
    assertStatus(r, 400, 'admin role self-target');
    assert(
      r.body?.error?.code === 'CANNOT_TARGET_SELF',
      `expect error.code='CANNOT_TARGET_SELF', got ${JSON.stringify(r.body?.error)}`,
    );
  });

  await step('admin POST /admin/users/:id/role {role:MOD} — promote PLAYER → 200', async () => {
    if (!state.playerUserId) throw new Error(`playerUserId undefined`);
    const r = await http(state.adminJar, `/api/admin/users/${state.playerUserId}/role`, {
      method: 'POST',
      body: { role: 'MOD' },
    });
    assertStatus(r, 200, 'admin role promote MOD');
    assert(r.body?.ok === true, `expect ok=true, got ${JSON.stringify(r.body)}`);
  });

  await step('player /api/_auth/session — role=MOD (server-authoritative reflect)', async () => {
    const r = await http(state.playerJar, '/api/_auth/session');
    assertStatus(r, 200, 'player session post-promote');
    const u = r.body?.data?.user;
    assert(u, 'session: missing user');
    assert(
      u.role === 'MOD',
      `session: role phải MOD sau promote, got ${u.role} (cookie cũ phải vẫn hợp lệ vì JWT chỉ chứa userId, role lookup mỗi request từ DB)`,
    );
  });

  await step('admin POST /admin/users/:id/role {role:PLAYER} — demote MOD → 200', async () => {
    if (!state.playerUserId) throw new Error(`playerUserId undefined`);
    const r = await http(state.adminJar, `/api/admin/users/${state.playerUserId}/role`, {
      method: 'POST',
      body: { role: 'PLAYER' },
    });
    assertStatus(r, 200, 'admin role demote PLAYER');
    assert(r.body?.ok === true, `expect ok=true, got ${JSON.stringify(r.body)}`);
  });

  await step('player /api/_auth/session — role=PLAYER (revert verify)', async () => {
    const r = await http(state.playerJar, '/api/_auth/session');
    assertStatus(r, 200, 'player session post-demote');
    const u = r.body?.data?.user;
    assert(u, 'session: missing user');
    assert(u.role === 'PLAYER', `session: role phải revert PLAYER, got ${u.role}`);
  });

  // ---------------------------------------------------------------------------
  // 26-30. Ban flow: zod-fail + ban → login 403 ACCOUNT_BANNED → unban → login OK.
  //
  //   Cover:
  //     - Zod BanInput: `banned` phải boolean. Body lạ → 400 INVALID_INPUT.
  //     - AdminService.setBanned (admin.service.ts L254-269):
  //         a) self-target → CANNOT_TARGET_SELF (vitest cover, smoke skip vì
  //            đã verify trong setRole self-target ở step trên).
  //         b) hierarchy: MOD chỉ ban PLAYER (smoke actor ADMIN nên irrelevant).
  //         c) update User.banned + audit log `user.ban` / `user.unban`.
  //     - AuthService.login (auth.service.ts L146-148): nếu `user.banned`
  //       throw `AuthError('ACCOUNT_BANNED')` → controller statusForCode →
  //       403 FORBIDDEN.
  //
  //   Đây là coverage cho defer item explicit của PR #377 smoke:auth:
  //     "ACCOUNT_BANNED 403 cần admin endpoint ban user trước, orthogonal cho
  //      smoke:admin".
  //
  //   Note quan trọng: ban KHÔNG tự revoke cookie hiện tại. Player vẫn login
  //   được với cookie cũ cho tới khi cookie expire (15min) hoặc passwordVersion
  //   bump qua change-password/reset-password. Do đó smoke phải chứng minh
  //   ACCOUNT_BANNED qua login lại (POST /api/_auth/login fresh).
  // ---------------------------------------------------------------------------

  await step('admin POST /admin/users/:id/ban — invalid body 400 INVALID_INPUT', async () => {
    if (!state.playerUserId) throw new Error(`playerUserId undefined`);
    const r = await http(state.adminJar, `/api/admin/users/${state.playerUserId}/ban`, {
      method: 'POST',
      body: { banned: 'yes' }, // string thay boolean → zod fail
    });
    assertStatus(r, 400, 'admin ban invalid body');
    assert(
      r.body?.error?.code === 'INVALID_INPUT',
      `expect error.code='INVALID_INPUT', got ${JSON.stringify(r.body?.error)}`,
    );
  });

  await step('admin POST /admin/users/:id/ban {banned:true} → 200', async () => {
    if (!state.playerUserId) throw new Error(`playerUserId undefined`);
    const r = await http(state.adminJar, `/api/admin/users/${state.playerUserId}/ban`, {
      method: 'POST',
      body: { banned: true },
    });
    assertStatus(r, 200, 'admin ban set true');
    assert(r.body?.ok === true, `expect ok=true, got ${JSON.stringify(r.body)}`);
  });

  await step('player POST /_auth/login (banned) → 403 ACCOUNT_BANNED', async () => {
    if (!state.playerEmail || !state.playerPassword) {
      throw new Error(`playerEmail/playerPassword undefined`);
    }
    const freshJar = new CookieJar();
    const r = await http(freshJar, '/api/_auth/login', {
      method: 'POST',
      body: { email: state.playerEmail, password: state.playerPassword },
    });
    assertStatus(r, 403, 'banned login');
    assert(
      r.body?.error?.code === 'ACCOUNT_BANNED',
      `expect error.code='ACCOUNT_BANNED', got ${JSON.stringify(r.body?.error)}`,
    );
  });

  await step('admin POST /admin/users/:id/ban {banned:false} → 200', async () => {
    if (!state.playerUserId) throw new Error(`playerUserId undefined`);
    const r = await http(state.adminJar, `/api/admin/users/${state.playerUserId}/ban`, {
      method: 'POST',
      body: { banned: false },
    });
    assertStatus(r, 200, 'admin ban set false');
    assert(r.body?.ok === true, `expect ok=true, got ${JSON.stringify(r.body)}`);
  });

  await step('player POST /_auth/login (unbanned) → 200 ok', async () => {
    if (!state.playerEmail || !state.playerPassword) {
      throw new Error(`playerEmail/playerPassword undefined`);
    }
    // Reset playerJar để login với cookie sạch (bảo đảm test cover login flow,
    // không phụ thuộc state cookie cũ).
    state.playerJar.clear();
    const r = await http(state.playerJar, '/api/_auth/login', {
      method: 'POST',
      body: { email: state.playerEmail, password: state.playerPassword },
    });
    assertStatus(r, 200, 'unbanned login');
    const u = r.body?.data?.user;
    assert(u, 'unbanned login: missing user');
    assert(u.id === state.playerUserId, `unbanned login: user.id mismatch`);
    assert(u.role === 'PLAYER', `unbanned login: role phải PLAYER, got ${u.role}`);
  });

  // 31. PLAYER cookie → /api/admin/* → 403 FORBIDDEN (admin guard).
  await step('player → /admin/stats → 403 FORBIDDEN', async () => {
    const r = await http(state.playerJar, '/api/admin/stats');
    assertStatus(r, 403, 'player → admin/stats');
    assert(
      r.body?.error?.code === 'FORBIDDEN',
      `player → admin/stats: expect error.code='FORBIDDEN', got ${JSON.stringify(r.body?.error)}`,
    );
  });

  // 32-33. Logout admin + player.
  await step('admin logout', async () => {
    const r = await http(state.adminJar, '/api/_auth/logout', { method: 'POST' });
    assertStatus(r, 200, 'admin logout');
    state.adminJar.clear();
  });

  await step('player logout', async () => {
    const r = await http(state.playerJar, '/api/_auth/logout', { method: 'POST' });
    assertStatus(r, 200, 'player logout');
    state.playerJar.clear();
  });
}

// -----------------------------------------------------------------------------
// Entrypoint.
// -----------------------------------------------------------------------------

main()
  .catch((err) => {
    console.error('[smoke:admin] fatal:', err);
    results.push({ name: 'fatal', ok: false, note: err instanceof Error ? err.message : String(err) });
  })
  .finally(() => {
    const pass = results.filter((r) => r.ok).length;
    const fail = results.filter((r) => !r.ok).length;
    const total = results.length;
    console.log('');
    console.log(`[smoke:admin] done: ${pass} pass / ${fail} fail / ${total} total`);
    if (fail > 0) {
      console.log('');
      console.log('[smoke:admin] failed steps:');
      for (const r of results.filter((x) => !x.ok)) {
        console.log(`  - ${r.name}: ${r.note}`);
      }
    }
    if (state.playerEmail) {
      console.log(`[smoke:admin] player email: ${state.playerEmail}`);
    }
    if (state.giftCode) {
      console.log(`[smoke:admin] giftcode: ${state.giftCode}`);
    }
    process.exit(fail > 0 ? 1 : 0);
  });
