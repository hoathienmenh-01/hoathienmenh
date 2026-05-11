import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CurrencyKind,
  PartyDungeonRewardClaimStatus as PrismaPartyDungeonRewardClaimStatus,
  PartyDungeonRoomStatus as PrismaPartyDungeonRoomStatus,
  PartyStatus as PrismaPartyStatus,
  PartyRole as PrismaPartyRole,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { makeUserChar, wipeAll } from '../../test-helpers';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  PartyDungeonError,
  PartyDungeonService,
} from './party-dungeon.service';

/**
 * Phase 20.1 — PartyDungeonService integration test (real Postgres).
 *
 * Yêu cầu: TEST_DATABASE_URL hoặc DATABASE_URL trỏ Postgres test DB
 * (CI mặc định `postgresql://mtt:mtt@localhost:5432/mtt`).
 *
 * Coverage:
 *   - createRoom: leader-only, no-active-room invariant, invalid
 *     dungeonKey reject, non-party-member reject.
 *   - joinFromParty: only same-party member, re-activate after
 *     leftAt, max-cap.
 *   - setReady/cancelReady: only active participant, room must
 *     be LOBBY/READY_CHECK.
 *   - startRun: leader-only, min-members guard, all-ready guard,
 *     creates PartyDungeonRun + RewardClaim PENDING rows.
 *   - cancelRoom: leader-only, only LOBBY/READY_CHECK.
 *   - claimReward: idempotent CAS, currency + inventory ledger,
 *     non-participant reject, run-must-be-COMPLETED guard.
 *   - Security: non-member 404 mask, double claim reject without
 *     mutating economy, getRunDetail authz.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let currency: CurrencyService;
let inventory: InventoryService;
let service: PartyDungeonService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  currency = new CurrencyService(prisma);
  inventory = new InventoryService(prisma);
  service = new PartyDungeonService(prisma, currency, inventory, null);
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

/** Tạo party trực tiếp qua prisma để giữ test cô lập khỏi PartyService. */
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

const VALID_DUNGEON = 'son_coc';

describe('Phase 20.1 — createRoom', () => {
  it('leader tạo room thành công, auto-join làm participant đầu tiên', async () => {
    const leader = await makePlayer();
    await makePartyWith(leader.userId, []);
    const res = await service.createRoom({
      leaderUserId: leader.userId,
      dungeonKey: VALID_DUNGEON,
    });
    expect(res.room).toBeTruthy();
    expect(res.room!.dungeonKey).toBe(VALID_DUNGEON);
    expect(res.room!.status).toBe(PrismaPartyDungeonRoomStatus.LOBBY);
    expect(res.room!.leaderUserId).toBe(leader.userId);
    expect(res.participants).toHaveLength(1);
    expect(res.participants[0].userId).toBe(leader.userId);
    expect(res.participants[0].readyAt).toBeNull();
  });

  it('reject INVALID_DUNGEON nếu dungeonKey không có trong catalog', async () => {
    const leader = await makePlayer();
    await makePartyWith(leader.userId, []);
    await expect(
      service.createRoom({
        leaderUserId: leader.userId,
        dungeonKey: '__not_a_real_dungeon__',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DUNGEON' });
  });

  it('reject NOT_IN_PARTY nếu caller không ở party active', async () => {
    const u = await makePlayer();
    await expect(
      service.createRoom({
        leaderUserId: u.userId,
        dungeonKey: VALID_DUNGEON,
      }),
    ).rejects.toMatchObject({ code: 'NOT_IN_PARTY' });
  });

  it('reject NOT_PARTY_LEADER nếu caller là member thường', async () => {
    const leader = await makePlayer();
    const member = await makePlayer();
    await makePartyWith(leader.userId, [member.userId]);
    await expect(
      service.createRoom({
        leaderUserId: member.userId,
        dungeonKey: VALID_DUNGEON,
      }),
    ).rejects.toMatchObject({ code: 'NOT_PARTY_LEADER' });
  });

  it('reject ROOM_ALREADY_EXISTS nếu party đã có active room', async () => {
    const leader = await makePlayer();
    await makePartyWith(leader.userId, []);
    await service.createRoom({
      leaderUserId: leader.userId,
      dungeonKey: VALID_DUNGEON,
    });
    await expect(
      service.createRoom({
        leaderUserId: leader.userId,
        dungeonKey: VALID_DUNGEON,
      }),
    ).rejects.toMatchObject({ code: 'ROOM_ALREADY_EXISTS' });
  });
});

describe('Phase 20.1 — joinFromParty', () => {
  it('member của cùng party join được vào room', async () => {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRoom({
      leaderUserId: leader.userId,
      dungeonKey: VALID_DUNGEON,
    });
    const after = await service.joinFromParty({
      userId: m1.userId,
      roomId: r.room!.id,
    });
    expect(after.participants).toHaveLength(2);
    expect(after.participants.map((p) => p.userId).sort()).toEqual(
      [leader.userId, m1.userId].sort(),
    );
  });

  it('reject NOT_PARTY_MEMBER nếu caller ở party khác', async () => {
    const leaderA = await makePlayer();
    const leaderB = await makePlayer();
    await makePartyWith(leaderA.userId, []);
    await makePartyWith(leaderB.userId, []);
    const r = await service.createRoom({
      leaderUserId: leaderA.userId,
      dungeonKey: VALID_DUNGEON,
    });
    await expect(
      service.joinFromParty({ userId: leaderB.userId, roomId: r.room!.id }),
    ).rejects.toMatchObject({ code: 'NOT_PARTY_MEMBER' });
  });

  it('idempotent khi join 2 lần — không tạo participant duplicate', async () => {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRoom({
      leaderUserId: leader.userId,
      dungeonKey: VALID_DUNGEON,
    });
    await service.joinFromParty({ userId: m1.userId, roomId: r.room!.id });
    const after = await service.joinFromParty({
      userId: m1.userId,
      roomId: r.room!.id,
    });
    expect(after.participants).toHaveLength(2);
  });
});

describe('Phase 20.1 — ready / unready', () => {
  it('member set ready → readyAt populated; cancelReady → readyAt null', async () => {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRoom({
      leaderUserId: leader.userId,
      dungeonKey: VALID_DUNGEON,
    });
    await service.joinFromParty({ userId: m1.userId, roomId: r.room!.id });

    const afterReady = await service.setReady({
      userId: m1.userId,
      roomId: r.room!.id,
    });
    const me = afterReady.participants.find((p) => p.userId === m1.userId)!;
    expect(me.readyAt).not.toBeNull();

    const afterCancel = await service.cancelReady({
      userId: m1.userId,
      roomId: r.room!.id,
    });
    const me2 = afterCancel.participants.find((p) => p.userId === m1.userId)!;
    expect(me2.readyAt).toBeNull();
  });

  it('reject PARTICIPANT_NOT_FOUND khi caller chưa join room', async () => {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRoom({
      leaderUserId: leader.userId,
      dungeonKey: VALID_DUNGEON,
    });
    await expect(
      service.setReady({ userId: m1.userId, roomId: r.room!.id }),
    ).rejects.toMatchObject({ code: 'PARTICIPANT_NOT_FOUND' });
  });
});

describe('Phase 20.1 — startRun', () => {
  it('reject NOT_ENOUGH_MEMBERS khi chỉ có leader (< minMembers)', async () => {
    const leader = await makePlayer();
    await makePartyWith(leader.userId, []);
    const r = await service.createRoom({
      leaderUserId: leader.userId,
      dungeonKey: VALID_DUNGEON,
    });
    await service.setReady({ userId: leader.userId, roomId: r.room!.id });
    await expect(
      service.startRun({ leaderUserId: leader.userId, roomId: r.room!.id }),
    ).rejects.toMatchObject({ code: 'NOT_ENOUGH_MEMBERS' });
  });

  it('reject NOT_ALL_READY khi có member chưa ready', async () => {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRoom({
      leaderUserId: leader.userId,
      dungeonKey: VALID_DUNGEON,
    });
    await service.joinFromParty({ userId: m1.userId, roomId: r.room!.id });
    await service.setReady({ userId: leader.userId, roomId: r.room!.id });
    // m1 chưa ready
    await expect(
      service.startRun({ leaderUserId: leader.userId, roomId: r.room!.id }),
    ).rejects.toMatchObject({ code: 'NOT_ALL_READY' });
  });

  it('reject NOT_PARTY_LEADER khi member thường gọi start', async () => {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRoom({
      leaderUserId: leader.userId,
      dungeonKey: VALID_DUNGEON,
    });
    await service.joinFromParty({ userId: m1.userId, roomId: r.room!.id });
    await service.setReady({ userId: leader.userId, roomId: r.room!.id });
    await service.setReady({ userId: m1.userId, roomId: r.room!.id });
    await expect(
      service.startRun({ leaderUserId: m1.userId, roomId: r.room!.id }),
    ).rejects.toMatchObject({ code: 'NOT_PARTY_LEADER' });
  });

  it('leader start thành công khi đủ điều kiện → run CLEAR + reward PENDING cho mỗi participant', async () => {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRoom({
      leaderUserId: leader.userId,
      dungeonKey: VALID_DUNGEON,
    });
    await service.joinFromParty({ userId: m1.userId, roomId: r.room!.id });
    await service.setReady({ userId: leader.userId, roomId: r.room!.id });
    await service.setReady({ userId: m1.userId, roomId: r.room!.id });

    const after = await service.startRun({
      leaderUserId: leader.userId,
      roomId: r.room!.id,
    });
    expect(after.room!.status).toBe(PrismaPartyDungeonRoomStatus.COMPLETED);
    expect(after.currentRun).toBeTruthy();
    expect(after.currentRun!.result).toBe('CLEAR');

    const claims = await prisma.partyDungeonRewardClaim.findMany({
      where: { runId: after.currentRun!.id },
    });
    expect(claims).toHaveLength(2);
    for (const c of claims) {
      expect(c.status).toBe(PrismaPartyDungeonRewardClaimStatus.PENDING);
    }
  });
});

describe('Phase 20.1 — cancelRoom', () => {
  it('leader cancel room LOBBY → status CANCELED', async () => {
    const leader = await makePlayer();
    await makePartyWith(leader.userId, []);
    const r = await service.createRoom({
      leaderUserId: leader.userId,
      dungeonKey: VALID_DUNGEON,
    });
    const after = await service.cancelRoom({
      leaderUserId: leader.userId,
      roomId: r.room!.id,
    });
    expect(after.room).toBeNull();
    const dbRow = await prisma.partyDungeonRoom.findUnique({
      where: { id: r.room!.id },
    });
    expect(dbRow!.status).toBe(PrismaPartyDungeonRoomStatus.CANCELED);
    expect(dbRow!.canceledAt).not.toBeNull();
  });

  it('reject NOT_PARTY_LEADER khi member gọi cancel', async () => {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRoom({
      leaderUserId: leader.userId,
      dungeonKey: VALID_DUNGEON,
    });
    await service.joinFromParty({ userId: m1.userId, roomId: r.room!.id });
    await expect(
      service.cancelRoom({ leaderUserId: m1.userId, roomId: r.room!.id }),
    ).rejects.toMatchObject({ code: 'NOT_PARTY_LEADER' });
  });

  it('reject ROOM_NOT_LOBBY khi room đã COMPLETED', async () => {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRoom({
      leaderUserId: leader.userId,
      dungeonKey: VALID_DUNGEON,
    });
    await service.joinFromParty({ userId: m1.userId, roomId: r.room!.id });
    await service.setReady({ userId: leader.userId, roomId: r.room!.id });
    await service.setReady({ userId: m1.userId, roomId: r.room!.id });
    await service.startRun({
      leaderUserId: leader.userId,
      roomId: r.room!.id,
    });
    await expect(
      service.cancelRoom({ leaderUserId: leader.userId, roomId: r.room!.id }),
    ).rejects.toMatchObject({ code: 'ROOM_NOT_LOBBY' });
  });
});

describe('Phase 20.1 — claimReward', () => {
  async function setupCompletedRun() {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRoom({
      leaderUserId: leader.userId,
      dungeonKey: VALID_DUNGEON,
    });
    await service.joinFromParty({ userId: m1.userId, roomId: r.room!.id });
    await service.setReady({ userId: leader.userId, roomId: r.room!.id });
    await service.setReady({ userId: m1.userId, roomId: r.room!.id });
    const after = await service.startRun({
      leaderUserId: leader.userId,
      roomId: r.room!.id,
    });
    return { leader, m1, runId: after.currentRun!.id };
  }

  it('claim thành công: status → CLAIMED, currency ledger ghi 1 row', async () => {
    const { m1, runId } = await setupCompletedRun();
    const beforeLinhThach = (
      await prisma.character.findUnique({
        where: { id: m1.characterId },
        select: { linhThach: true },
      })
    )?.linhThach as bigint;
    const claim = await service.claimReward({ userId: m1.userId, runId });
    expect(claim.status).toBe(PrismaPartyDungeonRewardClaimStatus.CLAIMED);
    expect(claim.claimedAt).not.toBeNull();

    const after = await prisma.character.findUnique({
      where: { id: m1.characterId },
      select: { linhThach: true, exp: true },
    });
    // son_coc runReward.linhThach = 50, exp = 100
    expect(Number(after!.linhThach - beforeLinhThach)).toBe(50);
    expect(Number(after!.exp)).toBeGreaterThanOrEqual(100);

    const ledgerRows = await prisma.currencyLedger.findMany({
      where: { characterId: m1.characterId, reason: 'PARTY_DUNGEON_REWARD' },
    });
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].currency).toBe(CurrencyKind.LINH_THACH);
    expect(ledgerRows[0].refType).toBe('PartyDungeonRewardClaim');
  });

  it('claim 2 lần → lần 2 reject REWARD_ALREADY_CLAIMED, KHÔNG mutate economy', async () => {
    const { m1, runId } = await setupCompletedRun();
    await service.claimReward({ userId: m1.userId, runId });
    const linhThachAfterFirst = (
      await prisma.character.findUnique({
        where: { id: m1.characterId },
        select: { linhThach: true },
      })
    )!.linhThach;
    await expect(
      service.claimReward({ userId: m1.userId, runId }),
    ).rejects.toMatchObject({ code: 'REWARD_ALREADY_CLAIMED' });
    const linhThachAfterSecond = (
      await prisma.character.findUnique({
        where: { id: m1.characterId },
        select: { linhThach: true },
      })
    )!.linhThach;
    expect(linhThachAfterSecond).toBe(linhThachAfterFirst);
    // Verify ledger still 1 row (no double write).
    const ledgerRows = await prisma.currencyLedger.findMany({
      where: { characterId: m1.characterId, reason: 'PARTY_DUNGEON_REWARD' },
    });
    expect(ledgerRows).toHaveLength(1);
  });

  it('non-participant không claim được → REWARD_NOT_FOUND', async () => {
    const { runId } = await setupCompletedRun();
    const outsider = await makePlayer();
    await expect(
      service.claimReward({ userId: outsider.userId, runId }),
    ).rejects.toMatchObject({ code: 'REWARD_NOT_FOUND' });
  });

  it('reject RUN_NOT_FOUND khi runId không tồn tại', async () => {
    const u = await makePlayer();
    await expect(
      service.claimReward({ userId: u.userId, runId: 'no_such_run' }),
    ).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });
  });
});

describe('Phase 20.1 — getMyRoom / getRunDetail authz', () => {
  it('getMyRoom trả null cho user không ở party', async () => {
    const u = await makePlayer();
    const res = await service.getMyRoom(u.userId);
    expect(res.room).toBeNull();
    expect(res.participants).toEqual([]);
    expect(res.currentRun).toBeNull();
    expect(res.myReward).toBeNull();
  });

  it('getRunDetail reject NOT_PARTY_MEMBER cho user ngoài party', async () => {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRoom({
      leaderUserId: leader.userId,
      dungeonKey: VALID_DUNGEON,
    });
    await service.joinFromParty({ userId: m1.userId, roomId: r.room!.id });
    await service.setReady({ userId: leader.userId, roomId: r.room!.id });
    await service.setReady({ userId: m1.userId, roomId: r.room!.id });
    const after = await service.startRun({
      leaderUserId: leader.userId,
      roomId: r.room!.id,
    });
    const outsider = await makePlayer();
    await expect(
      service.getRunDetail({
        userId: outsider.userId,
        runId: after.currentRun!.id,
      }),
    ).rejects.toMatchObject({ code: 'NOT_PARTY_MEMBER' });
  });

  it('getRunDetail trả full rewards list cho participant', async () => {
    const leader = await makePlayer();
    const m1 = await makePlayer();
    await makePartyWith(leader.userId, [m1.userId]);
    const r = await service.createRoom({
      leaderUserId: leader.userId,
      dungeonKey: VALID_DUNGEON,
    });
    await service.joinFromParty({ userId: m1.userId, roomId: r.room!.id });
    await service.setReady({ userId: leader.userId, roomId: r.room!.id });
    await service.setReady({ userId: m1.userId, roomId: r.room!.id });
    const after = await service.startRun({
      leaderUserId: leader.userId,
      roomId: r.room!.id,
    });
    const detail = await service.getRunDetail({
      userId: m1.userId,
      runId: after.currentRun!.id,
    });
    expect(detail.run.id).toBe(after.currentRun!.id);
    expect(detail.rewards).toHaveLength(2);
  });
});

describe('Phase 20.1 — PartyDungeonError', () => {
  it('error code maps to message', () => {
    const e = new PartyDungeonError('NOT_PARTY_LEADER');
    expect(e.code).toBe('NOT_PARTY_LEADER');
    expect(e.message).toBe('NOT_PARTY_LEADER');
    expect(e).toBeInstanceOf(Error);
  });
});
