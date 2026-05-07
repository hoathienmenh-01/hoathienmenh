/**
 * Multi-day smoke positive cho `DailyLoginService.claim(userId, now)`.
 *
 * Tại sao:
 *   `daily-login.service.test.ts` đã cover single-day claim, idempotent
 *   re-claim, streak=2 (yesterday→today), missed-day reset (gap 2 ngày).
 *   File này extend coverage cho:
 *     1. Chuỗi 7 ngày liên tục → streak tiến đúng 1→7.
 *     2. Reward ngày 7 đúng catalog thật (`DAILY_LOGIN_LINH_THACH` flat 100 LT/ngày).
 *     3. Tổng linhThach += 700 sau 7 claim, ledger 7 rows reason `DAILY_LOGIN`,
 *        claim 7 rows tăng streak monotonic.
 *     4. Double-claim cùng ngày giữa chuỗi → balance không cộng 2 lần,
 *        streak/canClaimToday preserved (anti-FE-self-grant).
 *     5. Missed day giữa chuỗi (skip ngày 4) → streak reset về 1 ở ngày 5.
 *     6. Timezone boundary VN: 16:30 UTC vs 17:30 UTC = ngày khác local
 *        (00:30 ICT là ngày sau 17:00 UTC ngày trước).
 *
 * Service signature đã hỗ trợ test-clock injection qua param thứ 2 `now: Date`
 * (default `new Date()`). KHÔNG cần thêm endpoint dev-only — drive day-by-day
 * bằng cách truyền `now` advance 24h mỗi lần.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import {
  DAILY_LOGIN_LINH_THACH,
  DailyLoginService,
  addDaysLocal,
  getLocalDateString,
} from './daily-login.service';
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

/** Anchor: 2026-04-29 12:00 ICT (= 2026-04-29 05:00 UTC). +24h advance giữ
 *  giờ-trong-ngày local cố định (12:00 ICT) → mỗi tick = 1 ngày local mới. */
const DAY_MS = 24 * 60 * 60 * 1000;
const ANCHOR_UTC = new Date('2026-04-29T05:00:00.000Z');

function dayN(n: number): Date {
  return new Date(ANCHOR_UTC.getTime() + n * DAY_MS);
}

describe('DailyLoginService — multi-day smoke positive', () => {
  it('chuỗi 7 ngày liên tục → streak 1→7, +700 LT, 7 ledger row, 7 claim row', async () => {
    const u = await makeUserChar(prisma, { linhThach: 0n });
    const tz = 'Asia/Ho_Chi_Minh';

    /** Track day-by-day để lock-in streak monotonic + delta đúng theo catalog. */
    const seen: Array<{
      day: number;
      claimed: boolean;
      newStreak: number;
      claimDateLocal: string;
      delta: string;
    }> = [];

    for (let d = 0; d < 7; d += 1) {
      const now = dayN(d);
      const r = await svc.claim(u.userId, now);
      seen.push({
        day: d + 1,
        claimed: r.claimed,
        newStreak: r.newStreak,
        claimDateLocal: r.claimDateLocal,
        delta: r.linhThachDelta,
      });
    }

    // 1) mọi claim đều thành công (không idempotent reject).
    expect(seen.every((s) => s.claimed)).toBe(true);

    // 2) streak monotonic 1..7 — locked-in catalog truth.
    expect(seen.map((s) => s.newStreak)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    // 3) reward ngày 7 = DAILY_LOGIN_LINH_THACH flat (catalog thật, không escalate).
    expect(seen[6]?.delta).toBe(DAILY_LOGIN_LINH_THACH.toString());

    // 4) mọi claimDateLocal khác nhau, format YYYY-MM-DD, monotonic +1 ngày local.
    for (let i = 0; i < 7; i += 1) {
      expect(seen[i]?.claimDateLocal).toBe(getLocalDateString(dayN(i), tz));
      if (i > 0) {
        expect(seen[i]?.claimDateLocal).toBe(
          addDaysLocal(seen[i - 1]!.claimDateLocal, 1),
        );
      }
    }

    // 5) character.linhThach += 7 * 100 = 700 (server-authoritative balance).
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: u.characterId },
      select: { linhThach: true },
    });
    expect(after.linhThach).toBe(700n);

    // 6) ledger có đúng 7 row reason='DAILY_LOGIN', mỗi row delta=100, refType=DailyLoginClaim.
    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: u.characterId, reason: 'DAILY_LOGIN' },
      orderBy: { createdAt: 'asc' },
    });
    expect(ledger).toHaveLength(7);
    for (const row of ledger) {
      expect(row.delta).toBe(DAILY_LOGIN_LINH_THACH);
      expect(row.refType).toBe('DailyLoginClaim');
    }

    // 7) DailyLoginClaim row 7 unique date, streakAtClaim 1..7 monotonic.
    const claims = await prisma.dailyLoginClaim.findMany({
      where: { characterId: u.characterId },
      orderBy: { claimDateLocal: 'asc' },
      select: { claimDateLocal: true, streakAtClaim: true, linhThachDelta: true },
    });
    expect(claims).toHaveLength(7);
    expect(claims.map((c) => c.streakAtClaim)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(claims.every((c) => c.linhThachDelta === DAILY_LOGIN_LINH_THACH)).toBe(
      true,
    );

    // 8) status() ngày 7 → canClaimToday=false sau claim, currentStreak=7.
    const s = await svc.status(u.userId, dayN(6));
    expect(s.canClaimToday).toBe(false);
    expect(s.currentStreak).toBe(7);
  });

  it('double-claim cùng ngày giữa chuỗi 7 ngày → balance không cộng 2 lần, streak preserved', async () => {
    const u = await makeUserChar(prisma, { linhThach: 0n });

    // Day 1, 2, 3 claim đúng.
    for (let d = 0; d < 3; d += 1) {
      const r = await svc.claim(u.userId, dayN(d));
      expect(r.claimed).toBe(true);
      expect(r.newStreak).toBe(d + 1);
    }

    // Day 3 spam re-claim 5 lần — toàn bộ phải idempotent.
    for (let i = 0; i < 5; i += 1) {
      const r = await svc.claim(u.userId, dayN(2));
      expect(r.claimed).toBe(false);
      expect(r.linhThachDelta).toBe('0');
      expect(r.newStreak).toBe(3);
    }

    // Day 4 tiếp tục đúng → streak = 4 (không bị spam phá chain).
    const r4 = await svc.claim(u.userId, dayN(3));
    expect(r4.claimed).toBe(true);
    expect(r4.newStreak).toBe(4);

    // Tổng balance = 4 * 100 (4 ngày), KHÔNG cộng spam.
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: u.characterId },
      select: { linhThach: true },
    });
    expect(after.linhThach).toBe(400n);

    // Ledger 4 row, claim row 4.
    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: u.characterId, reason: 'DAILY_LOGIN' },
    });
    expect(ledger).toHaveLength(4);
    const claims = await prisma.dailyLoginClaim.findMany({
      where: { characterId: u.characterId },
    });
    expect(claims).toHaveLength(4);
  });

  it('missed day giữa chuỗi → streak reset về 1, tổng LT đúng (anti free-streak)', async () => {
    const u = await makeUserChar(prisma, { linhThach: 0n });

    // Day 1, 2, 3 claim → streak 1, 2, 3.
    for (let d = 0; d < 3; d += 1) {
      const r = await svc.claim(u.userId, dayN(d));
      expect(r.newStreak).toBe(d + 1);
    }

    // Skip day 4 (no claim).

    // Day 5 claim → streak reset về 1 (yesterday = day 4 không có claim).
    const r5 = await svc.claim(u.userId, dayN(4));
    expect(r5.claimed).toBe(true);
    expect(r5.newStreak).toBe(1);

    // Day 6 claim → streak 2.
    const r6 = await svc.claim(u.userId, dayN(5));
    expect(r6.newStreak).toBe(2);

    // Day 7 claim → streak 3 (KHÔNG nhảy về 7 — anti free-streak).
    const r7 = await svc.claim(u.userId, dayN(6));
    expect(r7.newStreak).toBe(3);

    // Tổng balance = 6 ngày (3 + 3), không có ngày 4.
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: u.characterId },
      select: { linhThach: true },
    });
    expect(after.linhThach).toBe(600n);

    const claims = await prisma.dailyLoginClaim.findMany({
      where: { characterId: u.characterId },
      orderBy: { claimDateLocal: 'asc' },
      select: { claimDateLocal: true, streakAtClaim: true },
    });
    expect(claims).toHaveLength(6);
    expect(claims.map((c) => c.streakAtClaim)).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it('timezone boundary VN: 16:30 UTC vs 17:30 UTC cùng UTC date → khác VN local date', async () => {
    const u = await makeUserChar(prisma, { linhThach: 0n });
    const tz = 'Asia/Ho_Chi_Minh';

    // 2026-04-29 16:30 UTC = 2026-04-29 23:30 ICT (cuối ngày VN).
    const beforeVnMidnight = new Date('2026-04-29T16:30:00.000Z');
    // 2026-04-29 17:30 UTC = 2026-04-30 00:30 ICT (đã sang ngày VN mới).
    const afterVnMidnight = new Date('2026-04-29T17:30:00.000Z');

    expect(getLocalDateString(beforeVnMidnight, tz)).toBe('2026-04-29');
    expect(getLocalDateString(afterVnMidnight, tz)).toBe('2026-04-30');

    // Claim 1 lúc 23:30 ICT ngày 29.
    const r1 = await svc.claim(u.userId, beforeVnMidnight);
    expect(r1.claimed).toBe(true);
    expect(r1.claimDateLocal).toBe('2026-04-29');
    expect(r1.newStreak).toBe(1);

    // Claim 2 lúc 00:30 ICT ngày 30 (chỉ 1 giờ sau UTC) → ngày VN mới, streak +1.
    const r2 = await svc.claim(u.userId, afterVnMidnight);
    expect(r2.claimed).toBe(true);
    expect(r2.claimDateLocal).toBe('2026-04-30');
    expect(r2.newStreak).toBe(2);

    // Tổng LT = 200, 2 ledger row, 2 claim row khác claimDateLocal.
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: u.characterId },
      select: { linhThach: true },
    });
    expect(after.linhThach).toBe(200n);
  });

  it('timezone boundary: 2 lần claim cùng ngày VN nhưng 2 UTC instant → idempotent (anti tz double)', async () => {
    const u = await makeUserChar(prisma, { linhThach: 0n });
    const tz = 'Asia/Ho_Chi_Minh';

    // 2026-04-29 18:00 UTC = 2026-04-30 01:00 ICT.
    const earlyVnDay = new Date('2026-04-29T18:00:00.000Z');
    // 2026-04-30 16:00 UTC = 2026-04-30 23:00 ICT (vẫn ngày VN 30).
    const lateVnDay = new Date('2026-04-30T16:00:00.000Z');

    expect(getLocalDateString(earlyVnDay, tz)).toBe('2026-04-30');
    expect(getLocalDateString(lateVnDay, tz)).toBe('2026-04-30');

    const r1 = await svc.claim(u.userId, earlyVnDay);
    expect(r1.claimed).toBe(true);
    expect(r1.claimDateLocal).toBe('2026-04-30');
    expect(r1.newStreak).toBe(1);

    // Claim lần 2 cùng ngày VN nhưng 22h UTC sau → idempotent (anti
    // FE/tz-shift double-claim).
    const r2 = await svc.claim(u.userId, lateVnDay);
    expect(r2.claimed).toBe(false);
    expect(r2.linhThachDelta).toBe('0');
    expect(r2.newStreak).toBe(1);

    const after = await prisma.character.findUniqueOrThrow({
      where: { id: u.characterId },
      select: { linhThach: true },
    });
    expect(after.linhThach).toBe(100n);
  });
});
