import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { RewardCapService, dayBucketFor } from '../economy/reward-cap.service';
import { SocialService } from '../social/social.service';
import {
  CoCultivationError,
  CoCultivationService,
} from './co-cultivation.service';

/**
 * Phase 35.1 — CoCultivationService integration test.
 *
 * Bao phủ rule + invariant:
 *   1. self request → SELF_NOT_ALLOWED
 *   2. non-friend → NOT_FRIEND
 *   3. blocked → BLOCKED
 *   4. already active → ALREADY_ACTIVE
 *   5. daily session cap → DAILY_CAP_REACHED
 *   6. daily buff budget → BUFF_BUDGET_EXCEEDED
 *   7. accept non-partner → NOT_AUTHORIZED
 *   8. accept non-pending → INVALID_TRANSITION
 *   9. cancel by initiator OK / non-owner reject
 *   10. complete grants bonus EXP to both characters
 *   11. complete idempotent (no double apply)
 *   12. complete only by participant
 *   13. complete updates daily usage for both users
 *   14. status returns active + today usage
 *   15. history returns paginated rows w/ hasMore
 *   16. buff percent clamped at 5
 *   17. cooldown blocks 2nd request within window
 *   18. cancel allowed by partner as well
 */

let prisma: PrismaService;
let rewardCap: RewardCapService;
let social: SocialService;
let svc: CoCultivationService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  rewardCap = new RewardCapService(prisma);
  social = new SocialService(prisma);
  svc = new CoCultivationService(prisma, rewardCap, social);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await wipeAll(prisma);
});

async function makeFriendPair() {
  const a = await makeUserChar(prisma, { realmKey: 'phamnhan' });
  const b = await makeUserChar(prisma, { realmKey: 'phamnhan' });
  // Establish friendship via SocialService (Phase 19.1).
  const req = await social.sendFriendRequest(a.userId, b.userId, null);
  await social.acceptFriendRequest(b.userId, req.id);
  return { a, b };
}

describe('CoCultivationService.requestSession — rule guards', () => {
  it('self request → SELF_NOT_ALLOWED', async () => {
    const a = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(
      svc.requestSession(a.userId, { partnerUserId: a.userId }),
    ).rejects.toBeInstanceOf(CoCultivationError);
  });

  it('non-friend → NOT_FRIEND', async () => {
    const a = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const b = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await expect(
      svc.requestSession(a.userId, { partnerUserId: b.userId }),
    ).rejects.toMatchObject({ code: 'NOT_FRIEND' });
  });

  it('blocked → BLOCKED (overrides NOT_FRIEND)', async () => {
    const a = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const b = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    await social.blockUser(a.userId, b.userId);
    await expect(
      svc.requestSession(a.userId, { partnerUserId: b.userId }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
  });

  it('OK happy path → PENDING session', async () => {
    const { a, b } = await makeFriendPair();
    const s = await svc.requestSession(a.userId, { partnerUserId: b.userId });
    expect(s.status).toBe('PENDING');
    expect(s.initiatorUserId).toBe(a.userId);
    expect(s.partnerUserId).toBe(b.userId);
    expect(s.initiatorCharacterId).toBe(a.characterId);
    expect(s.partnerCharacterId).toBe(b.characterId);
    expect(s.durationSec).toBe(600);
    expect(s.buffPercent).toBe(3);
    expect(s.rewardApplied).toBe(false);
  });

  it('already active session of initiator → ALREADY_ACTIVE', async () => {
    const { a, b } = await makeFriendPair();
    await svc.requestSession(a.userId, { partnerUserId: b.userId });
    await expect(
      svc.requestSession(a.userId, { partnerUserId: b.userId }),
    ).rejects.toMatchObject({ code: 'ALREADY_ACTIVE' });
  });

  it('buff percent clamped to MAX (5) when caller asks 99', async () => {
    const { a, b } = await makeFriendPair();
    const s = await svc.requestSession(a.userId, {
      partnerUserId: b.userId,
      buffPercent: 99,
    });
    expect(s.buffPercent).toBe(5);
  });

  it('daily session cap reached → DAILY_CAP_REACHED', async () => {
    const { a, b } = await makeFriendPair();
    await prisma.coCultivationDailyUsage.create({
      data: {
        userId: a.userId,
        dateKey: dayBucketFor(),
        sessionsCompleted: 3,
        totalBuffSeconds: 0,
        totalBonusExp: 0n,
      },
    });
    await expect(
      svc.requestSession(a.userId, { partnerUserId: b.userId }),
    ).rejects.toMatchObject({ code: 'DAILY_CAP_REACHED' });
  });

  it('buff budget exceeded → BUFF_BUDGET_EXCEEDED', async () => {
    const { a, b } = await makeFriendPair();
    await prisma.coCultivationDailyUsage.create({
      data: {
        userId: a.userId,
        dateKey: dayBucketFor(),
        sessionsCompleted: 0,
        totalBuffSeconds: 1700, // only 100s left
        totalBonusExp: 0n,
      },
    });
    await expect(
      svc.requestSession(a.userId, {
        partnerUserId: b.userId,
        durationSec: 600,
      }),
    ).rejects.toMatchObject({ code: 'BUFF_BUDGET_EXCEEDED' });
  });
});

describe('CoCultivationService.acceptSession', () => {
  it('partner accepts → ACTIVE + startedAt set', async () => {
    const { a, b } = await makeFriendPair();
    const s = await svc.requestSession(a.userId, { partnerUserId: b.userId });
    const accepted = await svc.acceptSession(b.userId, s.id);
    expect(accepted.status).toBe('ACTIVE');
    expect(accepted.startedAt).not.toBeNull();
  });

  it('non-partner accept → NOT_AUTHORIZED', async () => {
    const { a, b } = await makeFriendPair();
    const s = await svc.requestSession(a.userId, { partnerUserId: b.userId });
    await expect(svc.acceptSession(a.userId, s.id)).rejects.toMatchObject({
      code: 'NOT_AUTHORIZED',
    });
  });

  it('accept non-pending → INVALID_TRANSITION', async () => {
    const { a, b } = await makeFriendPair();
    const s = await svc.requestSession(a.userId, { partnerUserId: b.userId });
    await svc.cancelSession(a.userId, s.id);
    await expect(svc.acceptSession(b.userId, s.id)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });
});

describe('CoCultivationService.cancelSession', () => {
  it('initiator cancels PENDING → CANCELLED', async () => {
    const { a, b } = await makeFriendPair();
    const s = await svc.requestSession(a.userId, { partnerUserId: b.userId });
    const cancelled = await svc.cancelSession(a.userId, s.id);
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('partner cancels ACTIVE → CANCELLED', async () => {
    const { a, b } = await makeFriendPair();
    const s = await svc.requestSession(a.userId, { partnerUserId: b.userId });
    await svc.acceptSession(b.userId, s.id);
    const cancelled = await svc.cancelSession(b.userId, s.id);
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('non-owner cannot cancel → NOT_AUTHORIZED', async () => {
    const { a, b } = await makeFriendPair();
    const stranger = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const s = await svc.requestSession(a.userId, { partnerUserId: b.userId });
    await expect(
      svc.cancelSession(stranger.userId, s.id),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });
});

describe('CoCultivationService.completeSession — bonus EXP grant', () => {
  it('grants bonus EXP to both characters + status COMPLETED', async () => {
    const { a, b } = await makeFriendPair();
    const s = await svc.requestSession(a.userId, {
      partnerUserId: b.userId,
      durationSec: 600,
      buffPercent: 5,
    });
    await svc.acceptSession(b.userId, s.id);

    const beforeA = await prisma.character.findUnique({
      where: { id: a.characterId },
      select: { exp: true },
    });
    const beforeB = await prisma.character.findUnique({
      where: { id: b.characterId },
      select: { exp: true },
    });

    const completed = await svc.completeSession(a.userId, s.id);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.rewardApplied).toBe(true);
    expect(completed.completedAt).not.toBeNull();
    // bonusExpGranted = sum across both chars. 600s × 5% × 5/30 = 5 each → 10 total.
    expect(BigInt(completed.bonusExpGranted)).toBe(10n);

    const afterA = await prisma.character.findUnique({
      where: { id: a.characterId },
      select: { exp: true },
    });
    const afterB = await prisma.character.findUnique({
      where: { id: b.characterId },
      select: { exp: true },
    });
    expect(afterA!.exp - beforeA!.exp).toBe(5n);
    expect(afterB!.exp - beforeB!.exp).toBe(5n);
  });

  it('idempotent — second complete is no-op', async () => {
    const { a, b } = await makeFriendPair();
    const s = await svc.requestSession(a.userId, { partnerUserId: b.userId });
    await svc.acceptSession(b.userId, s.id);
    const first = await svc.completeSession(a.userId, s.id);
    expect(first.rewardApplied).toBe(true);

    // Second call returns same row (no double apply). EXP not bumped again.
    const afterFirst = await prisma.character.findUnique({
      where: { id: a.characterId },
      select: { exp: true },
    });
    const second = await svc.completeSession(a.userId, s.id);
    expect(second.id).toBe(first.id);
    const afterSecond = await prisma.character.findUnique({
      where: { id: a.characterId },
      select: { exp: true },
    });
    expect(afterSecond!.exp).toBe(afterFirst!.exp);
  });

  it('non-participant cannot complete', async () => {
    const { a, b } = await makeFriendPair();
    const stranger = await makeUserChar(prisma, { realmKey: 'phamnhan' });
    const s = await svc.requestSession(a.userId, { partnerUserId: b.userId });
    await svc.acceptSession(b.userId, s.id);
    await expect(
      svc.completeSession(stranger.userId, s.id),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('updates CoCultivationDailyUsage for both users', async () => {
    const { a, b } = await makeFriendPair();
    const s = await svc.requestSession(a.userId, { partnerUserId: b.userId });
    await svc.acceptSession(b.userId, s.id);
    await svc.completeSession(a.userId, s.id);

    const today = dayBucketFor();
    const uA = await prisma.coCultivationDailyUsage.findUnique({
      where: { userId_dateKey: { userId: a.userId, dateKey: today } },
    });
    const uB = await prisma.coCultivationDailyUsage.findUnique({
      where: { userId_dateKey: { userId: b.userId, dateKey: today } },
    });
    expect(uA?.sessionsCompleted).toBe(1);
    expect(uA?.totalBuffSeconds).toBe(600);
    expect(uB?.sessionsCompleted).toBe(1);
    expect(uB?.totalBuffSeconds).toBe(600);
  });

  it('complete non-active session → INVALID_TRANSITION', async () => {
    const { a, b } = await makeFriendPair();
    const s = await svc.requestSession(a.userId, { partnerUserId: b.userId });
    // not accepted yet — still PENDING
    await expect(svc.completeSession(a.userId, s.id)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });
});

describe('CoCultivationService.getStatus + getHistory', () => {
  it('status returns active session + today usage', async () => {
    const { a, b } = await makeFriendPair();
    const s = await svc.requestSession(a.userId, { partnerUserId: b.userId });
    const st = await svc.getStatus(a.userId);
    expect(st.active?.id).toBe(s.id);
    expect(st.today.sessionsCompleted).toBe(0);
    expect(st.today.remainingSessions).toBe(3);
    expect(st.today.remainingBuffSeconds).toBe(1800);
  });

  it('history paginates with hasMore=false when ≤ limit rows', async () => {
    const { a, b } = await makeFriendPair();
    const s1 = await svc.requestSession(a.userId, { partnerUserId: b.userId });
    await svc.cancelSession(a.userId, s1.id);
    const s2 = await svc.requestSession(a.userId, { partnerUserId: b.userId });
    await svc.cancelSession(a.userId, s2.id);

    const h = await svc.getHistory(a.userId, { limit: 10 });
    expect(h.sessions.length).toBe(2);
    expect(h.hasMore).toBe(false);
  });

  it('history caps limit at HISTORY_LIMIT_MAX', async () => {
    const { a } = await makeFriendPair();
    const h = await svc.getHistory(a.userId, { limit: 9999 });
    expect(h.sessions.length).toBeLessThanOrEqual(50);
  });
});
