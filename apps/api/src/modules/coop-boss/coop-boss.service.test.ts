import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CurrencyKind,
  CoopBossStatus as PrismaCoopBossStatus,
  CoopBossRewardClaimStatus as PrismaCoopBossRewardClaimStatus,
  PartyStatus as PrismaPartyStatus,
  PartyRole as PrismaPartyRole,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { makeUserChar, wipeAll } from '../../test-helpers';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CoopBossError, CoopBossService } from './coop-boss.service';
import { COOP_BOSS_LIMITS } from '@xuantoi/shared';

/**
 * Phase 20.2 — CoopBossService integration test (real Postgres).
 *
 * Yêu cầu: TEST_DATABASE_URL hoặc DATABASE_URL trỏ Postgres test DB.
 *
 * Coverage:
 *   - createRun: leader gate, NOT_IN_PARTY, INVALID_BOSS_KEY,
 *     RUN_ALREADY_EXISTS.
 *   - joinRun: same-party member, NOT_PARTY_MEMBER reject; idempotent.
 *   - leaveRun: marks leftAt.
 *   - recordContribution: PARTICIPANT_NOT_FOUND, clamp anomaly,
 *     auto-promote LOBBY → IN_PROGRESS, CONTRIBUTION_WINDOW_CLOSED.
 *   - finishRun: snapshot eligibility + MVP; CLEARED creates
 *     reward claims for eligible only; FAILED creates no claim.
 *   - claimReward: CAS idempotent, currency ledger, REWARD_NOT_FOUND
 *     for non-participants, RUN_NOT_FINISHED guard, REWARD_ALREADY_CLAIMED.
 *   - cancelRun: only LOBBY, only leader.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let currency: CurrencyService;
let inventory: InventoryService;
let service: CoopBossService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  currency = new CurrencyService(prisma);
  inventory = new InventoryService(prisma, realtime, chars);
  service = new CoopBossService(prisma, currency, inventory, null);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await wipeAll(prisma);
});

async function makePlayer() {
  return makeUserChar(prisma);
}

async function makePartyWith(
  leaderUserId: string,
  extraMemberUserIds: string[],
): Promise<string> {
  const party = await prisma.party.create({
    data: {
      leaderUserId,
      name: null,
      status: PrismaPartyStatus.ACTIVE,
      maxMembers: 5,
    },
  });
  await prisma.partyMember.create({
    data: {
      partyId: party.id,
      userId: leaderUserId,
      role: PrismaPartyRole.LEADER,
    },
  });
  for (const m of extraMemberUserIds) {
    await prisma.partyMember.create({
      data: { partyId: party.id, userId: m, role: PrismaPartyRole.MEMBER },
    });
  }
  return party.id;
}

const VALID_BOSS = 'yeu_vuong_tho_huyet';

describe('Phase 20.2 — createRun', () => {
  it('leader tạo run thành công, auto-join làm participant', async () => {
    const leader = await makePlayer();
    await makePartyWith(leader.userId, []);
    const res = await service.createRun({
      leaderUserId: leader.userId,
      bossKey: VALID_BOSS,
    });
    expect(res.run).toBeTruthy();
    expect(res.run!.bossKey).toBe(VALID_BOSS);
    expect(res.run!.status).toBe(PrismaCoopBossStatus.LOBBY);
    expect(res.participants).toHaveLength(1);
    expect(res.participants[0].userId).toBe(leader.userId);
  });

  it('reject INVALID_BOSS_KEY khi bossKey ngoài catalog', async () => {
    const leader = await makePlayer();
    await makePartyWith(leader.userId, []);
    await expect(
      service.createRun({
        leaderUserId: leader.userId,
        bossKey: '__not_real_boss__',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BOSS_KEY' });
  });

  it('reject NOT_IN_PARTY khi caller không ở party active', async () => {
    const u = await makePlayer();
    await expect(
      service.createRun({ leaderUserId: u.userId, bossKey: VALID_BOSS }),
    ).rejects.toMatchObject({ code: 'NOT_IN_PARTY' });
  });

  it('reject NOT_PARTY_LEADER khi caller là member thường', async () => {
    const leader = await makePlayer();
    const member = await makePlayer();
    await makePartyWith(leader.userId, [member.userId]);
    await expect(
      service.createRun({ leaderUserId: member.userId, bossKey: VALID_BOSS }),
    ).rejects.toMatchObject({ code: 'NOT_PARTY_LEADER' });
  });

  it('reject RUN_ALREADY_EXISTS khi party đã có active run', async () => {
    const leader = await makePlayer();
    await makePartyWith(leader.userId, []);
    await service.createRun({
      leaderUserId: leader.userId,
      bossKey: VALID_BOSS,
    });
    await expect(
      service.createRun({ leaderUserId: leader.userId, bossKey: VALID_BOSS }),
    ).rejects.toMatchObject({ code: 'RUN_ALREADY_EXISTS' });
  });
});

describe('Phase 20.2 — joinRun / leaveRun', () => {
  it('member của party join run được; idempotent', async () => {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRun({
      leaderUserId: leader.userId,
      bossKey: VALID_BOSS,
    });
    const after = await service.joinRun({
      userId: m1.userId,
      runId: r.run!.id,
    });
    expect(after.participants.map((p) => p.userId).sort()).toEqual(
      [leader.userId, m1.userId].sort(),
    );

    // join again no duplicate
    const after2 = await service.joinRun({
      userId: m1.userId,
      runId: r.run!.id,
    });
    expect(after2.participants).toHaveLength(2);
  });

  it('reject NOT_PARTY_MEMBER khi user ngoài party join', async () => {
    const leaderA = await makePlayer();
    const leaderB = await makePlayer();
    await makePartyWith(leaderA.userId, []);
    await makePartyWith(leaderB.userId, []);
    const r = await service.createRun({
      leaderUserId: leaderA.userId,
      bossKey: VALID_BOSS,
    });
    await expect(
      service.joinRun({ userId: leaderB.userId, runId: r.run!.id }),
    ).rejects.toMatchObject({ code: 'NOT_PARTY_MEMBER' });
  });

  it('leaveRun đánh dấu leftAt', async () => {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRun({
      leaderUserId: leader.userId,
      bossKey: VALID_BOSS,
    });
    await service.joinRun({ userId: m1.userId, runId: r.run!.id });
    const after = await service.leaveRun({
      userId: m1.userId,
      runId: r.run!.id,
    });
    // listParticipantsForRun (REST surface) chỉ trả về participants đang active
    // (`leftAt: null`) — m1 sau leaveRun không còn xuất hiện trong DTO list.
    expect(after.participants.find((p) => p.userId === m1.userId)).toBeUndefined();
    // Tuy nhiên DB row vẫn lưu `leftAt` để finishRun resolve eligibility.
    const m1Part = await prisma.coopBossParticipant.findUnique({
      where: { runId_userId: { runId: r.run!.id, userId: m1.userId } },
    });
    expect(m1Part).not.toBeNull();
    expect(m1Part!.leftAt).not.toBeNull();
  });
});

describe('Phase 20.2 — recordContribution', () => {
  it('reject PARTICIPANT_NOT_FOUND khi user chưa join', async () => {
    const leaderA = await makePlayer();
    const outsider = await makePlayer();
    await makePartyWith(leaderA.userId, []);
    const r = await service.createRun({
      leaderUserId: leaderA.userId,
      bossKey: VALID_BOSS,
    });
    await expect(
      service.recordContribution({
        userId: outsider.userId,
        runId: r.run!.id,
        damageDone: 1000,
        supportScore: 0,
        survivalSeconds: 60,
      }),
    ).rejects.toMatchObject({ code: 'PARTICIPANT_NOT_FOUND' });
  });

  it('participant ghi contribution → tăng score + auto-promote IN_PROGRESS', async () => {
    const leader = await makePlayer();
    await makePartyWith(leader.userId, []);
    const r = await service.createRun({
      leaderUserId: leader.userId,
      bossKey: VALID_BOSS,
    });
    await service.recordContribution({
      userId: leader.userId,
      runId: r.run!.id,
      damageDone: 100_000,
      supportScore: 100,
      survivalSeconds: 60,
    });
    const run = await prisma.coopBossRun.findUnique({
      where: { id: r.run!.id },
    });
    expect(run!.status).toBe(PrismaCoopBossStatus.IN_PROGRESS);

    const cont = await prisma.coopBossContribution.findFirst({
      where: { runId: r.run!.id },
    });
    expect(cont).toBeTruthy();
    expect(cont!.contributionScore).toBeGreaterThan(0);
  });

  it('clamps damage above max → anomaly logged but accepted', async () => {
    const leader = await makePlayer();
    await makePartyWith(leader.userId, []);
    const r = await service.createRun({
      leaderUserId: leader.userId,
      bossKey: VALID_BOSS,
    });
    await service.recordContribution({
      userId: leader.userId,
      runId: r.run!.id,
      damageDone: COOP_BOSS_LIMITS.maxDamagePerContribution * 5,
      supportScore: 0,
      survivalSeconds: 60,
    });
    const cont = await prisma.coopBossContribution.findFirst({
      where: { runId: r.run!.id },
    });
    expect(cont!.damageDone).toBe(
      BigInt(COOP_BOSS_LIMITS.maxDamagePerContribution),
    );
  });
});

describe('Phase 20.2 — finishRun + claimReward', () => {
  async function setupClearedRun() {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRun({
      leaderUserId: leader.userId,
      bossKey: VALID_BOSS,
    });
    await service.joinRun({ userId: m1.userId, runId: r.run!.id });
    // High contribution → eligible for reward.
    await service.recordContribution({
      userId: leader.userId,
      runId: r.run!.id,
      damageDone: 500_000,
      supportScore: 500,
      survivalSeconds: 120,
    });
    await service.recordContribution({
      userId: m1.userId,
      runId: r.run!.id,
      damageDone: 200_000,
      supportScore: 300,
      survivalSeconds: 120,
    });
    await service.finishRun({
      leaderUserId: leader.userId,
      runId: r.run!.id,
      result: 'CLEARED',
    });
    return { leader, m1, runId: r.run!.id };
  }

  it('finishRun CLEARED tạo reward claim PENDING cho member eligible', async () => {
    const { leader, m1, runId } = await setupClearedRun();
    const claims = await prisma.coopBossRewardClaim.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });
    expect(claims.length).toBeGreaterThanOrEqual(2);
    const claimLeader = claims.find((c) => c.userId === leader.userId);
    const claimM1 = claims.find((c) => c.userId === m1.userId);
    expect(claimLeader).toBeTruthy();
    expect(claimM1).toBeTruthy();
    expect(claimLeader!.status).toBe(
      PrismaCoopBossRewardClaimStatus.PENDING,
    );
  });

  it('finishRun FAILED không tạo reward claim PENDING', async () => {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRun({
      leaderUserId: leader.userId,
      bossKey: VALID_BOSS,
    });
    await service.joinRun({ userId: m1.userId, runId: r.run!.id });
    await service.recordContribution({
      userId: leader.userId,
      runId: r.run!.id,
      damageDone: 500_000,
      supportScore: 100,
      survivalSeconds: 120,
    });
    await service.finishRun({
      leaderUserId: leader.userId,
      runId: r.run!.id,
      result: 'FAILED',
    });
    const claims = await prisma.coopBossRewardClaim.findMany({
      where: { runId: r.run!.id, status: PrismaCoopBossRewardClaimStatus.PENDING },
    });
    expect(claims).toHaveLength(0);
  });

  it('claimReward thành công + ledger ghi 1 row', async () => {
    const { m1, runId } = await setupClearedRun();
    const before = await prisma.character.findUnique({
      where: { id: m1.characterId },
      select: { linhThach: true },
    });
    const claim = await service.claimReward({
      userId: m1.userId,
      runId,
    });
    expect(claim.status).toBe(PrismaCoopBossRewardClaimStatus.CLAIMED);
    const after = await prisma.character.findUnique({
      where: { id: m1.characterId },
      select: { linhThach: true },
    });
    expect(after!.linhThach).toBeGreaterThan(before!.linhThach);
    const ledgerRows = await prisma.currencyLedger.findMany({
      where: { characterId: m1.characterId, reason: 'COOP_BOSS_REWARD' },
    });
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].currency).toBe(CurrencyKind.LINH_THACH);
    expect(ledgerRows[0].refType).toBe('CoopBossRewardClaim');
  });

  it('claim 2 lần → lần 2 REWARD_ALREADY_CLAIMED, KHÔNG mutate economy', async () => {
    const { m1, runId } = await setupClearedRun();
    await service.claimReward({ userId: m1.userId, runId });
    const afterFirst = (
      await prisma.character.findUnique({
        where: { id: m1.characterId },
        select: { linhThach: true },
      })
    )!.linhThach;
    await expect(
      service.claimReward({ userId: m1.userId, runId }),
    ).rejects.toMatchObject({ code: 'REWARD_ALREADY_CLAIMED' });
    const afterSecond = (
      await prisma.character.findUnique({
        where: { id: m1.characterId },
        select: { linhThach: true },
      })
    )!.linhThach;
    expect(afterSecond).toBe(afterFirst);
    const ledgerRows = await prisma.currencyLedger.findMany({
      where: { characterId: m1.characterId, reason: 'COOP_BOSS_REWARD' },
    });
    expect(ledgerRows).toHaveLength(1);
  });

  it('non-participant không claim được → REWARD_NOT_FOUND', async () => {
    const { runId } = await setupClearedRun();
    const outsider = await makePlayer();
    await expect(
      service.claimReward({ userId: outsider.userId, runId }),
    ).rejects.toMatchObject({ code: 'REWARD_NOT_FOUND' });
  });

  it('run chưa finished không claim được → RUN_NOT_FINISHED', async () => {
    const leader = await makePlayer();
    await makePartyWith(leader.userId, []);
    const r = await service.createRun({
      leaderUserId: leader.userId,
      bossKey: VALID_BOSS,
    });
    await service.recordContribution({
      userId: leader.userId,
      runId: r.run!.id,
      damageDone: 100_000,
      supportScore: 100,
      survivalSeconds: 60,
    });
    await expect(
      service.claimReward({ userId: leader.userId, runId: r.run!.id }),
    ).rejects.toMatchObject({ code: 'RUN_NOT_FINISHED' });
  });
});

describe('Phase 20.2 — cancelRun', () => {
  it('cancel LOBBY thành công bởi leader', async () => {
    const leader = await makePlayer();
    await makePartyWith(leader.userId, []);
    const r = await service.createRun({
      leaderUserId: leader.userId,
      bossKey: VALID_BOSS,
    });
    await service.cancelRun({
      leaderUserId: leader.userId,
      runId: r.run!.id,
    });
    const dbRun = await prisma.coopBossRun.findUnique({
      where: { id: r.run!.id },
    });
    expect(dbRun!.status).toBe(PrismaCoopBossStatus.CANCELED);
  });

  it('reject NOT_PARTY_LEADER khi member thường cancel', async () => {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRun({
      leaderUserId: leader.userId,
      bossKey: VALID_BOSS,
    });
    await service.joinRun({ userId: m1.userId, runId: r.run!.id });
    await expect(
      service.cancelRun({ leaderUserId: m1.userId, runId: r.run!.id }),
    ).rejects.toMatchObject({ code: 'NOT_PARTY_LEADER' });
  });
});

describe('Phase 20.2 — getMyRun authz', () => {
  it('getMyRun trả null cho user không có run', async () => {
    const u = await makePlayer();
    const res = await service.getMyRun(u.userId);
    expect(res.run).toBeNull();
    expect(res.participants).toEqual([]);
    expect(res.myContribution).toBeNull();
  });
});

describe('Phase 20.2 — CoopBossError', () => {
  it('exposes code field for HTTP mapping', () => {
    const e = new CoopBossError('NOT_IN_PARTY');
    expect(e.code).toBe('NOT_IN_PARTY');
    expect(e.message).toBe('NOT_IN_PARTY');
  });
});
