/**
 * E2E helpers — API-driven seeding cho closed beta core loop.
 *
 * Mục đích: cho phép từng spec bypass phần register/onboard UI khi không phải
 * là feature đang test, để tests deterministic + chạy nhanh hơn (UI auth ~3-5s
 * mỗi test → ~150ms qua API).
 *
 * Tất cả request dùng `page.request` (Playwright `APIRequestContext`) nên
 * cookie set-cookie từ `/api/_auth/register` được lưu trực tiếp vào browser
 * context — request UI tiếp theo (page.goto) tự dùng session đó.
 *
 * KHÔNG đụng admin endpoint, KHÔNG seed currency / item — fresh char chỉ có
 * starting linhThach (= 0 theo schema, hoặc số seed nếu economy patch sau).
 */
import type { Page, APIRequestContext, APIResponse } from '@playwright/test';
import { expect, request as playwrightRequest } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const API_BASE_DEFAULT = 'http://localhost:3000';

/** Path tới API origin. Mặc định trùng `pnpm --filter @xuantoi/api dev`. */
export function apiBase(): string {
  return process.env.E2E_API_BASE ?? API_BASE_DEFAULT;
}

export type SectKey = 'thanh_van' | 'huyen_thuy' | 'tu_la';

export interface OnboardOptions {
  /** Override tên character. Default: random `e2e_<rand>` (3–16 chars, regex an toàn). */
  charName?: string;
  /** Override sect. Default: `thanh_van`. */
  sectKey?: SectKey;
  /** Override email prefix. Default: `e2e_<purpose>`. */
  emailPrefix?: string;
  /** Override password. Default: `Pass1234!`. */
  password?: string;
}

export interface SeedResult {
  email: string;
  password: string;
  charName: string;
  sectKey: SectKey;
  characterId: string;
  userId: string;
}

function randSuffix(len = 8): string {
  return Math.random().toString(36).slice(2, 2 + len);
}

function randCharName(prefix = 'e2e'): string {
  // 3–16 ký tự, regex `^[A-Za-zÀ-ỹ0-9._]+$`. Prefix + 5 random hex = 9 chars.
  return `${prefix}_${randSuffix(5)}`;
}

async function expectOk(res: APIResponse, label: string): Promise<unknown> {
  const status = res.status();
  const body = await res.json().catch(() => null);
  if (status >= 400 || !body || (body as { ok?: boolean }).ok === false) {
    throw new Error(
      `[e2e helpers] ${label} failed: status=${status} body=${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  return (body as { data?: unknown }).data;
}

/**
 * Register fresh user + onboard character. Cookie `xt_access` + `xt_refresh`
 * được set vào browser context của `page` qua `page.request`.
 *
 * Sau khi gọi, caller có thể `await page.goto('/home')` và sẽ thấy session
 * đã đăng nhập, character đã tạo.
 */
export async function registerAndOnboard(page: Page, opts: OnboardOptions = {}): Promise<SeedResult> {
  const email = `${opts.emailPrefix ?? 'e2e_seed'}_${Date.now()}_${randSuffix()}@local.test`;
  const password = opts.password ?? 'Pass1234!';
  const charName = opts.charName ?? randCharName();
  const sectKey: SectKey = opts.sectKey ?? 'thanh_van';

  const base = apiBase();

  const regRes = await page.request.post(`${base}/api/_auth/register`, {
    data: { email, password },
  });
  const regData = (await expectOk(regRes, 'register')) as { user?: { id?: string } } | undefined;
  const userId = regData?.user?.id ?? '';

  const onbRes = await page.request.post(`${base}/api/character/onboard`, {
    data: { name: charName, sectKey },
  });
  const onbData = (await expectOk(onbRes, 'onboard')) as
    | { character?: { id?: string } }
    | undefined;
  const characterId = onbData?.character?.id ?? '';

  if (!userId || !characterId) {
    throw new Error(
      `[e2e helpers] seed missing ids: userId=${userId} characterId=${characterId}`,
    );
  }

  return { email, password, charName, sectKey, characterId, userId };
}

/**
 * Lấy character snapshot qua `/api/character/me`. Dùng để cross-check UI state
 * (vd `cultivating` flag, `linhThach`, `level`).
 */
export async function getCharacterMe(page: Page): Promise<Record<string, unknown>> {
  const base = apiBase();
  const res = await page.request.get(`${base}/api/character/me`);
  const data = (await expectOk(res, 'character/me')) as { character?: Record<string, unknown> };
  if (!data?.character) throw new Error('[e2e helpers] character/me: no character');
  return data.character;
}

/**
 * Wait cho `expectFn` predicate trả `true` qua polling `/api/character/me`.
 * Default 8s, poll mỗi 250ms. Throws nếu timeout.
 */
export async function waitCharacter(
  page: Page,
  expectFn: (char: Record<string, unknown>) => boolean,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<Record<string, unknown>> {
  const timeout = opts.timeoutMs ?? 8000;
  const interval = opts.intervalMs ?? 250;
  const label = opts.label ?? 'waitCharacter';
  const deadline = Date.now() + timeout;
  let lastChar: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    lastChar = await getCharacterMe(page);
    if (expectFn(lastChar)) return lastChar;
    await page.waitForTimeout(interval);
  }
  throw new Error(`[e2e helpers] ${label}: timeout sau ${timeout}ms. Last char=${JSON.stringify(lastChar).slice(0, 300)}`);
}

/**
 * Flush các Redis key rate-limit auth (register / login / forgot-password) để
 * suite tạo > 5 user/IP/15min không bị 429 RATE_LIMITED. Best-effort: nếu
 * Redis unreachable, log warn + return (suite có thể fail nếu > 5 register).
 *
 * Gọi:
 *   - `globalSetup` (1 lần trước toàn suite, để clear state cũ).
 *   - `test.beforeEach` (cover case suite > 5 register/IP/15min).
 */
const RATE_LIMIT_PATTERNS = ['rl:register:*', 'rl:login:*', 'rl:forgot-password:*'];

export async function flushAuthRateLimits(): Promise<void> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const apiPkg = path.resolve(__dirname, '../../api/package.json');
  const requireFromApi = createRequire(apiPkg);
  type IORedisCtor = typeof import('ioredis').default;
  type IORedis = import('ioredis').default;
  const RedisMod = requireFromApi('ioredis') as { default: IORedisCtor };
  const Redis: IORedisCtor =
    RedisMod.default ?? (RedisMod as unknown as IORedisCtor);

  const redis: IORedis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  try {
    await redis.connect();
  } catch (err) {
    console.warn(
      `[e2e helpers] Redis ${redisUrl} unreachable (${(err as Error).message}). ` +
        `Skipping rate-limit flush — > 5 register/IP/15min sẽ fail 429.`,
    );
    redis.disconnect();
    return;
  }

  try {
    for (const pattern of RATE_LIMIT_PATTERNS) {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== '0');
    }
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

/**
 * Claim daily-login qua API. Fresh char: claim đầu tiên trong ngày → +100 LT
 * (DAILY_LOGIN_LINH_THACH).
 *
 * Trả về `{ claimed, linhThachDelta }`. `claimed=true` nếu vừa claim, `false`
 * nếu hôm nay đã claim rồi (idempotent).
 */
export async function claimDailyLogin(
  page: Page,
): Promise<{ claimed: boolean; linhThachDelta: string }> {
  const base = apiBase();
  const res = await page.request.post(`${base}/api/daily-login/claim`, { data: {} });
  const data = (await expectOk(res, 'daily-login/claim')) as
    | { claimed?: boolean; linhThachDelta?: string }
    | undefined;
  return {
    claimed: Boolean(data?.claimed),
    linhThachDelta: data?.linhThachDelta ?? '0',
  };
}

/**
 * Buy 1 item từ NPC shop qua API. Throw nếu insufficient funds / not in shop.
 *
 * Trả về `{ qty, totalPrice }` — verify post-buy invariants ở caller.
 */
export async function buyShopItem(
  page: Page,
  itemKey: string,
  qty = 1,
): Promise<{ qty: number; totalPrice: number; currency: string }> {
  const base = apiBase();
  const res = await page.request.post(`${base}/api/shop/buy`, {
    data: { itemKey, qty },
  });
  const data = (await expectOk(res, `shop/buy ${itemKey}×${qty}`)) as
    | { qty?: number; totalPrice?: number; currency?: string }
    | undefined;
  if (!data || typeof data.qty !== 'number') {
    throw new Error(`[e2e helpers] shop/buy ${itemKey} returned no qty`);
  }
  return {
    qty: data.qty,
    totalPrice: Number(data.totalPrice ?? 0),
    currency: String(data.currency ?? 'LINH_THACH'),
  };
}

/**
 * List inventory qua API. Trả về raw items array (mỗi entry gồm `id`,
 * `item.key`, `qty`, `equippedSlot` …).
 */
export async function listInventoryApi(
  page: Page,
): Promise<Array<Record<string, unknown>>> {
  const base = apiBase();
  const res = await page.request.get(`${base}/api/inventory`);
  const data = (await expectOk(res, 'inventory')) as { items?: Array<Record<string, unknown>> };
  return data?.items ?? [];
}

const ADMIN_EMAIL_DEFAULT = 'admin@example.com';
const ADMIN_PASSWORD_DEFAULT = 'change-me-bootstrap-pass';

export interface AdminSeedTalentOptions {
  /** Realm key cho `set-realm`. Default `kim_dan` (đủ để học active talent kim_quang_tram). */
  realmKey?: string;
  /** Realm stage 1..9. Default `1`. */
  realmStage?: number;
  /** Số talent point grant. Default `5` (đủ học 1-2 talent + dư). */
  talentPoints?: number;
}

/**
 * Phase 11.X UI E2E seed harness — admin login (separate `APIRequestContext`)
 * gọi `set-realm` + `grant-talent-point` cho `targetUserId`, không đụng cookie
 * jar của `page` (để player session không bị logout). Reuse PR #389 admin
 * seed harness extension endpoints.
 *
 * Bootstrap requirement: `pnpm --filter @xuantoi/api bootstrap` phải tạo
 * `admin@example.com` (hoặc env `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` override).
 *
 * Throws nếu admin login fail (vd chưa bootstrap), `set-realm`/`grant-talent-point`
 * fail (vd backend chưa migrate Phase 11.X.AS endpoint).
 */
export async function adminSeedTalent(
  targetUserId: string,
  opts: AdminSeedTalentOptions = {},
): Promise<void> {
  const realmKey = opts.realmKey ?? 'kim_dan';
  const realmStage = opts.realmStage ?? 1;
  const talentPoints = opts.talentPoints ?? 5;
  const email = process.env.E2E_ADMIN_EMAIL ?? ADMIN_EMAIL_DEFAULT;
  const password = process.env.E2E_ADMIN_PASSWORD ?? ADMIN_PASSWORD_DEFAULT;
  const base = apiBase();

  // Separate APIRequestContext — admin cookie jar tách biệt khỏi `page` để
  // không invalidate player session mid-test.
  const ctx: APIRequestContext = await playwrightRequest.newContext({ baseURL: base });
  try {
    const loginRes = await ctx.post(`${base}/api/_auth/login`, { data: { email, password } });
    const loginBody = await loginRes.json().catch(() => null);
    if (
      loginRes.status() !== 200 ||
      !loginBody?.ok ||
      loginBody?.data?.user?.role !== 'ADMIN'
    ) {
      throw new Error(
        `[e2e helpers] adminSeedTalent: admin login failed (status=${loginRes.status()}, ` +
          `role=${loginBody?.data?.user?.role}). Bootstrap admin@example.com? ` +
          `body=${JSON.stringify(loginBody).slice(0, 200)}`,
      );
    }

    const setRealmRes = await ctx.post(`${base}/api/admin/users/${targetUserId}/set-realm`, {
      data: { realmKey, realmStage, reason: 'e2e Phase 11.X UI talent seed' },
    });
    await expectOk(setRealmRes, `admin/users/${targetUserId}/set-realm`);

    const grantTpRes = await ctx.post(
      `${base}/api/admin/users/${targetUserId}/grant-talent-point`,
      {
        data: { delta: talentPoints, reason: 'e2e Phase 11.X UI talent seed' },
      },
    );
    await expectOk(grantTpRes, `admin/users/${targetUserId}/grant-talent-point`);
  } finally {
    await ctx.dispose().catch(() => undefined);
  }
}

/**
 * Phase 11.X UI E2E talent cast harness — start son_coc encounter + 1 action
 * dùng `skillKey=talentKey` (combat.service detect talent qua `getTalentDef`).
 * Sau call này server set `cooldownTurnsRemaining = talent.activeEffect.cooldownTurns`
 * cho `talentKey`. Trả về encounter status (`ACTIVE` / `WON` / `LOST`) + monster
 * count để spec assert downstream.
 *
 * Helper KHÔNG abandon encounter sau cast — caller phải `abandonEncounter` hoặc
 * fight tiếp nếu cần clean state. Cooldown persist server-side bất kể encounter
 * status nên `/talents` reload vẫn thấy badge.
 */
export async function castTalentViaCombat(
  page: Page,
  dungeonKey: string,
  talentKey: string,
): Promise<{ encounterId: string; status: string }> {
  const base = apiBase();
  const startRes = await page.request.post(`${base}/api/combat/encounter/start`, {
    data: { dungeonKey },
  });
  const startData = (await expectOk(startRes, `combat/encounter/start ${dungeonKey}`)) as
    | { encounter?: { id?: string; status?: string } }
    | undefined;
  const encounterId = startData?.encounter?.id ?? '';
  if (!encounterId) {
    throw new Error('[e2e helpers] castTalentViaCombat: no encounter.id from start');
  }

  const actionRes = await page.request.post(
    `${base}/api/combat/encounter/${encounterId}/action`,
    { data: { skillKey: talentKey } },
  );
  const actionData = (await expectOk(actionRes, `combat/encounter/${encounterId}/action`)) as
    | { encounter?: { status?: string } }
    | undefined;
  return { encounterId, status: actionData?.encounter?.status ?? 'UNKNOWN' };
}

/** Re-export expect để spec dùng cùng instance. */
export { expect };
