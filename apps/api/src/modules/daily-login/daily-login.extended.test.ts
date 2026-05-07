/**
 * Mở rộng coverage daily-login sau `daily-login.multi-day.test.ts`:
 *   1. Streak 30 ngày liên tục → balance 3000 LT, 30 ledger row, 30 claim row
 *      (catalog flat 100 LT/ngày, đảm bảo không escalate ngầm theo streak ở tương lai).
 *   2. Race-condition: nhiều `Promise.all` cùng `(userId, now)` → đúng 1 winner
 *      cộng tiền, các loser idempotent (anti FE-fan-out / cluster double-claim).
 *      Cover composite UNIQUE `(characterId, claimDateLocal)` + P2002 fallback path.
 *   3. Controller-level DB-backed smoke: gọi `DailyLoginController.me()` /
 *      `.claim()` với `AuthService` stub trả userId cố định, service thật chạy
 *      qua Postgres → verify envelope `{ ok:true, data }` + state DB sau call.
 *      KHÔNG cần Nest factory full HTTP — đủ để lock controller↔service wire.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import {
  DAILY_LOGIN_LINH_THACH,
  DailyLoginService,
  getLocalDateString,
} from './daily-login.service';
import { DailyLoginController } from './daily-login.controller';
import type { AuthService } from '../auth/auth.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let svc: DailyLoginService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.MISSION_RESET_TZ = 'Asia/Ho_Chi_Minh';
  prisma = new PrismaService();
  svc = new DailyLoginService(prisma, new CurrencyService(prisma));
});

beforeEach(async () => {
  await wipeAll(prisma);
});

/** +24h advance giữ giờ-trong-ngày local cố định → mỗi tick = 1 ngày local mới. */
const DAY_MS = 24 * 60 * 60 * 1000;
/** Anchor: 2026-04-29 12:00 ICT (= 2026-04-29 05:00 UTC). */
const ANCHOR_UTC = new Date('2026-04-29T05:00:00.000Z');

function dayN(n: number): Date {
  return new Date(ANCHOR_UTC.getTime() + n * DAY_MS);
}

describe('DailyLoginService — streak 30 ngày liên tục', () => {
  it('chuỗi 30 ngày → streak monotonic 1→30, +3000 LT, 30 ledger row, 30 claim row', async () => {
    const u = await makeUserChar(prisma, { linhThach: 0n });

    const streaks: number[] = [];
    for (let d = 0; d < 30; d += 1) {
      const r = await svc.claim(u.userId, dayN(d));
      expect(r.claimed).toBe(true);
      expect(r.linhThachDelta).toBe(DAILY_LOGIN_LINH_THACH.toString());
      streaks.push(r.newStreak);
    }

    // Streak monotonic 1..30 — lock-in catalog đang flat 100 LT/ngày.
    // Nếu tương lai catalog escalate (vd ngày 7/14/21/30 bonus), test này sẽ
    // failed có chủ đích → buộc chỉnh test + docs cùng lúc.
    expect(streaks).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));

    const after = await prisma.character.findUniqueOrThrow({
      where: { id: u.characterId },
      select: { linhThach: true },
    });
    expect(after.linhThach).toBe(3000n);

    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: u.characterId, reason: 'DAILY_LOGIN' },
      orderBy: { createdAt: 'asc' },
    });
    expect(ledger).toHaveLength(30);
    expect(ledger.every((row) => row.delta === DAILY_LOGIN_LINH_THACH)).toBe(
      true,
    );
    expect(ledger.every((row) => row.refType === 'DailyLoginClaim')).toBe(true);

    const claims = await prisma.dailyLoginClaim.findMany({
      where: { characterId: u.characterId },
      orderBy: { claimDateLocal: 'asc' },
      select: { streakAtClaim: true, linhThachDelta: true },
    });
    expect(claims).toHaveLength(30);
    expect(claims.map((c) => c.streakAtClaim)).toEqual(streaks);
    expect(
      claims.every((c) => c.linhThachDelta === DAILY_LOGIN_LINH_THACH),
    ).toBe(true);

    // status() ngày 30 → currentStreak=30, canClaimToday=false sau claim.
    const s = await svc.status(u.userId, dayN(29));
    expect(s.canClaimToday).toBe(false);
    expect(s.currentStreak).toBe(30);
  });
});

describe('DailyLoginService — race-condition concurrent claim', () => {
  it('Promise.all 5 claim cùng (userId, now) → 1 winner +100 LT, 4 loser idempotent', async () => {
    const u = await makeUserChar(prisma, { linhThach: 0n });
    const now = dayN(0);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => svc.claim(u.userId, now)),
    );

    const winners = results.filter((r) => r.claimed);
    const losers = results.filter((r) => !r.claimed);
    // Composite UNIQUE `(characterId, claimDateLocal)` + P2002 fallback đảm
    // bảo đúng 1 winner. Race window không thể bypass — KHÔNG bao giờ cộng
    // tiền 2 lần.
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(4);

    expect(winners[0]?.linhThachDelta).toBe(DAILY_LOGIN_LINH_THACH.toString());
    expect(winners[0]?.newStreak).toBe(1);
    for (const l of losers) {
      expect(l.linhThachDelta).toBe('0');
      // Loser thấy newStreak từ row đã commit (=1) hoặc fallback chính nó (=1)
      // → cả 2 case đều là 1, không phụ thuộc thread order.
      expect(l.newStreak).toBe(1);
      expect(l.claimDateLocal).toBe(winners[0]?.claimDateLocal);
    }

    // Server-authoritative balance: chỉ 1 grant.
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: u.characterId },
      select: { linhThach: true },
    });
    expect(after.linhThach).toBe(100n);

    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: u.characterId, reason: 'DAILY_LOGIN' },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.delta).toBe(DAILY_LOGIN_LINH_THACH);

    const claims = await prisma.dailyLoginClaim.findMany({
      where: { characterId: u.characterId },
    });
    expect(claims).toHaveLength(1);
  });

  it('Promise.all 10 claim trên 2 ngày liên tiếp → 2 winner, 8 loser, balance=200, streak monotonic', async () => {
    const u = await makeUserChar(prisma, { linhThach: 0n });

    // Day 1: 5 concurrent claim.
    const r1 = await Promise.all(
      Array.from({ length: 5 }, () => svc.claim(u.userId, dayN(0))),
    );
    expect(r1.filter((r) => r.claimed)).toHaveLength(1);

    // Day 2: 5 concurrent claim.
    const r2 = await Promise.all(
      Array.from({ length: 5 }, () => svc.claim(u.userId, dayN(1))),
    );
    const day2Winners = r2.filter((r) => r.claimed);
    expect(day2Winners).toHaveLength(1);
    // Streak từ winner day-2 phải =2 (sau 1 winner day-1 đã commit).
    expect(day2Winners[0]?.newStreak).toBe(2);

    const after = await prisma.character.findUniqueOrThrow({
      where: { id: u.characterId },
      select: { linhThach: true },
    });
    expect(after.linhThach).toBe(200n);

    const claims = await prisma.dailyLoginClaim.findMany({
      where: { characterId: u.characterId },
      orderBy: { claimDateLocal: 'asc' },
      select: { streakAtClaim: true, claimDateLocal: true },
    });
    expect(claims).toHaveLength(2);
    expect(claims.map((c) => c.streakAtClaim)).toEqual([1, 2]);
  });
});

describe('DailyLoginController — DB-backed smoke', () => {
  /** Stub `AuthService` chỉ map cookie → userId, KHÔNG đụng JWT/Redis. */
  function makeAuthStub(userId: string): AuthService {
    return {
      userIdFromAccess: async (token: string | undefined) =>
        token ? userId : null,
    } as unknown as AuthService;
  }

  function makeReq(token: string | undefined): Request {
    return { cookies: token ? { xt_access: token } : {} } as unknown as Request;
  }

  it('GET /daily-login/me + POST /daily-login/claim flow → envelope đúng + state DB đồng nhất', async () => {
    const u = await makeUserChar(prisma, { linhThach: 0n });
    const ctrl = new DailyLoginController(svc, makeAuthStub(u.userId));

    // 1) GET /me trước claim → canClaimToday=true, currentStreak=0.
    const me1 = await ctrl.me(makeReq('valid-cookie'));
    expect(me1.ok).toBe(true);
    expect(me1.data.canClaimToday).toBe(true);
    expect(me1.data.currentStreak).toBe(0);
    expect(me1.data.nextRewardLinhThach).toBe(
      DAILY_LOGIN_LINH_THACH.toString(),
    );

    // 2) POST /claim → claimed=true, +100 LT.
    const c1 = await ctrl.claim(makeReq('valid-cookie'));
    expect(c1.ok).toBe(true);
    expect(c1.data.claimed).toBe(true);
    expect(c1.data.linhThachDelta).toBe(DAILY_LOGIN_LINH_THACH.toString());
    expect(c1.data.newStreak).toBe(1);

    // 3) GET /me lại → canClaimToday=false, currentStreak=1.
    const me2 = await ctrl.me(makeReq('valid-cookie'));
    expect(me2.data.canClaimToday).toBe(false);
    expect(me2.data.currentStreak).toBe(1);

    // 4) POST /claim lần 2 cùng ngày → idempotent (claimed=false, delta="0").
    const c2 = await ctrl.claim(makeReq('valid-cookie'));
    expect(c2.data.claimed).toBe(false);
    expect(c2.data.linhThachDelta).toBe('0');
    expect(c2.data.newStreak).toBe(1);

    // 5) DB state: balance = 100 (1 grant), 1 ledger row, 1 claim row.
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: u.characterId },
      select: { linhThach: true },
    });
    expect(after.linhThach).toBe(100n);

    const tz = 'Asia/Ho_Chi_Minh';
    const today = getLocalDateString(new Date(), tz);
    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: u.characterId, reason: 'DAILY_LOGIN' },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.refType).toBe('DailyLoginClaim');
    expect(ledger[0]?.refId).toBe(today);

    const claims = await prisma.dailyLoginClaim.findMany({
      where: { characterId: u.characterId },
    });
    expect(claims).toHaveLength(1);
    expect(claims[0]?.claimDateLocal).toBe(today);
  });

  it('GET /me + POST /claim không cookie → throw HttpException 401', async () => {
    const u = await makeUserChar(prisma);
    const ctrl = new DailyLoginController(svc, makeAuthStub(u.userId));

    await expect(ctrl.me(makeReq(undefined))).rejects.toMatchObject({
      status: 401,
    });
    await expect(ctrl.claim(makeReq(undefined))).rejects.toMatchObject({
      status: 401,
    });
  });

  it('POST /claim cho user không có character → throw 404 NO_CHARACTER (mapping)', async () => {
    // Tạo user trần KHÔNG có character.
    const fake = await prisma.user.create({
      data: { email: 'no-char-extended@xt.local', passwordHash: 'x' },
    });
    const ctrl = new DailyLoginController(svc, makeAuthStub(fake.id));

    await expect(ctrl.claim(makeReq('valid-cookie'))).rejects.toMatchObject({
      status: 404,
    });
    // Không có claim/ledger row tạo cho user này.
    const claims = await prisma.dailyLoginClaim.findMany({});
    expect(claims).toHaveLength(0);
  });
});
