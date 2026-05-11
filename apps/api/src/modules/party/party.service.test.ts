import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PARTY_LIMITS } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { makeUserChar, wipeAll } from '../../test-helpers';
import { SocialService } from '../social/social.service';
import { PartyService } from './party.service';

/**
 * Phase 19.4 — PartyService integration test (real Postgres).
 *
 * Yêu cầu: TEST_DATABASE_URL hoặc DATABASE_URL trỏ Postgres test DB
 * (CI mặc định `postgresql://mtt:mtt@localhost:5432/mtt`).
 *
 * Coverage:
 *   - createParty: success, validate name, no second active party.
 *   - invite: leader-only, not self, not blocked, not duplicate
 *     pending, not invitee-in-other-party, capacity, caps.
 *   - accept: idempotent (race-safe via unique constraint + tx),
 *     expired reject, capacity, cancel sibling invites.
 *   - decline/cancel: state transition.
 *   - leave: auto-disband when last, auto-transfer leader to
 *     longest-tenured member.
 *   - kick: leader-only, not self, target must be member.
 *   - transferLeader: leader-only, target must be member.
 *   - disband: leader-only, all members marked left.
 *   - list endpoints.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let social: SocialService;
let party: PartyService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  social = new SocialService(prisma);
  party = new PartyService(prisma, social);
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

async function makeParty(leaderUserId: string) {
  return party.createParty(leaderUserId, null);
}

describe('Phase 19.4 — createParty', () => {
  it('tạo party đầu tiên thành công + caller là LEADER', async () => {
    const u = await makePlayer();
    const res = await makeParty(u.userId);
    expect(res.party.leaderUserId).toBe(u.userId);
    expect(res.party.status).toBe('ACTIVE');
    expect(res.party.memberCount).toBe(1);
    expect(res.members).toHaveLength(1);
    expect(res.members[0].role).toBe('LEADER');
    expect(res.members[0].userId).toBe(u.userId);
  });

  it('reject ALREADY_IN_PARTY khi đã ở party active', async () => {
    const u = await makePlayer();
    await makeParty(u.userId);
    await expect(makeParty(u.userId)).rejects.toMatchObject({
      code: 'ALREADY_IN_PARTY',
    });
  });

  it('cho phép tạo party mới sau khi đã rời party cũ', async () => {
    const u = await makePlayer();
    await makeParty(u.userId);
    await party.leaveParty(u.userId);
    const again = await makeParty(u.userId);
    expect(again.party.status).toBe('ACTIVE');
  });

  it('name nhỏ hơn min → INVALID_INPUT', async () => {
    const u = await makePlayer();
    await expect(makeParty(u.userId).then(() => 'ok')).resolves.toBe('ok');
    // Reset
    await party.leaveParty(u.userId);
    await expect(party.createParty(u.userId, 'ab')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('null/empty name OK; trim hợp lệ', async () => {
    const u = await makePlayer();
    const a = await party.createParty(u.userId, null);
    expect(a.party.name).toBeNull();
    await party.leaveParty(u.userId);
    const b = await party.createParty(u.userId, '  team Tiên  ');
    expect(b.party.name).toBe('team Tiên');
  });
});

describe('Phase 19.4 — invite', () => {
  it('chỉ leader được invite', async () => {
    const leader = await makePlayer();
    const member = await makePlayer();
    const third = await makePlayer();
    await makeParty(leader.userId);
    const invite = await party.inviteToParty(leader.userId, member.userId);
    await party.acceptInvite(member.userId, invite.id);
    // member (không phải leader) invite -> NOT_AUTHORIZED
    await expect(
      party.inviteToParty(member.userId, third.userId),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
  });

  it('không cho invite chính mình', async () => {
    const u = await makePlayer();
    await makeParty(u.userId);
    await expect(party.inviteToParty(u.userId, u.userId)).rejects.toMatchObject(
      { code: 'SELF_NOT_ALLOWED' },
    );
  });

  it('không cho invite user đang ở party khác', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await makeParty(a.userId);
    await makeParty(b.userId); // b ở party riêng
    await expect(party.inviteToParty(a.userId, b.userId)).rejects.toMatchObject(
      { code: 'INVITEE_IN_OTHER_PARTY' },
    );
  });

  it('không cho invite blocked user (2 chiều)', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await makeParty(a.userId);
    await social.blockUser(a.userId, b.userId);
    await expect(party.inviteToParty(a.userId, b.userId)).rejects.toMatchObject(
      { code: 'BLOCKED' },
    );
  });

  it('không cho invite duplicate PENDING', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await makeParty(a.userId);
    await party.inviteToParty(a.userId, b.userId);
    await expect(party.inviteToParty(a.userId, b.userId)).rejects.toMatchObject(
      { code: 'DUPLICATE_INVITE' },
    );
  });

  it('PARTY_FULL khi đạt maxMembers', async () => {
    const leader = await makePlayer();
    await makeParty(leader.userId);
    const cap = PARTY_LIMITS.maxMembers;
    const recruits: Array<{ userId: string }> = [];
    for (let i = 0; i < cap - 1; i++) {
      const p = await makePlayer();
      recruits.push(p);
      const inv = await party.inviteToParty(leader.userId, p.userId);
      await party.acceptInvite(p.userId, inv.id);
    }
    // Now full. Next invite must reject.
    const extra = await makePlayer();
    await expect(
      party.inviteToParty(leader.userId, extra.userId),
    ).rejects.toMatchObject({ code: 'PARTY_FULL' });
  });
});

describe('Phase 19.4 — accept/decline/cancel invite', () => {
  it('accept invite join party + invite ACCEPTED', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await makeParty(a.userId);
    const inv = await party.inviteToParty(a.userId, b.userId);
    const res = await party.acceptInvite(b.userId, inv.id);
    expect(res.party.memberCount).toBe(2);
    expect(res.members.find((m) => m.userId === b.userId)?.role).toBe('MEMBER');
    const my = await party.getMyParty(b.userId);
    expect(my.party?.id).toBe(res.party.id);
  });

  it('expired invite không accept được', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await makeParty(a.userId);
    const inv = await party.inviteToParty(a.userId, b.userId);
    // Force expire by manually pushing expiresAt into past + leave PENDING
    await prisma.partyInvite.update({
      where: { id: inv.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await expect(
      party.acceptInvite(b.userId, inv.id),
    ).rejects.toMatchObject({ code: 'INVITE_EXPIRED' });
  });

  it('decline đúng + invite chuyển DECLINED', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await makeParty(a.userId);
    const inv = await party.inviteToParty(a.userId, b.userId);
    const out = await party.declineInvite(b.userId, inv.id);
    expect(out.status).toBe('DECLINED');
  });

  it('cancel đúng + chỉ inviter/leader được cancel', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const stranger = await makePlayer();
    await makeParty(a.userId);
    const inv = await party.inviteToParty(a.userId, b.userId);
    await expect(
      party.cancelInvite(stranger.userId, inv.id),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    const out = await party.cancelInvite(a.userId, inv.id);
    expect(out.status).toBe('CANCELED');
  });

  it('race accept không tạo double member (idempotent / unique)', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await makeParty(a.userId);
    const inv = await party.inviteToParty(a.userId, b.userId);
    const first = party.acceptInvite(b.userId, inv.id);
    const second = party.acceptInvite(b.userId, inv.id);
    const settled = await Promise.allSettled([first, second]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const my = await party.getMyParty(b.userId);
    expect(my.members.filter((m) => m.userId === b.userId)).toHaveLength(1);
  });

  it('accept invite hủy các invite PENDING khác của cùng invitee', async () => {
    const a = await makePlayer();
    const c = await makePlayer();
    const b = await makePlayer();
    await makeParty(a.userId);
    await makeParty(c.userId);
    const inv1 = await party.inviteToParty(a.userId, b.userId);
    const inv2 = await party.inviteToParty(c.userId, b.userId);
    await party.acceptInvite(b.userId, inv1.id);
    const inv2After = await prisma.partyInvite.findUnique({
      where: { id: inv2.id },
    });
    expect(inv2After?.status).toBe('CANCELED');
  });
});

describe('Phase 19.4 — leave / kick / transfer / disband', () => {
  it('leave non-leader chỉ giảm thành viên', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await makeParty(a.userId);
    const inv = await party.inviteToParty(a.userId, b.userId);
    await party.acceptInvite(b.userId, inv.id);
    const res = await party.leaveParty(b.userId);
    expect(res.members.find((m) => m.userId === b.userId)).toBeUndefined();
    expect(res.party?.memberCount).toBe(1);
  });

  it('leader rời party 2-người → auto-transfer cho member còn lại', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await makeParty(a.userId);
    const inv = await party.inviteToParty(a.userId, b.userId);
    await party.acceptInvite(b.userId, inv.id);
    const res = await party.leaveParty(a.userId);
    expect(res.party?.leaderUserId).toBe(b.userId);
    expect(res.members[0].role).toBe('LEADER');
  });

  it('leader rời party 1-người → auto-disband', async () => {
    const a = await makePlayer();
    await makeParty(a.userId);
    const res = await party.leaveParty(a.userId);
    expect(res.party).toBeNull();
    const my = await party.getMyParty(a.userId);
    expect(my.party).toBeNull();
  });

  it('kick: chỉ leader; không kick chính mình; target phải là member', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const c = await makePlayer();
    await makeParty(a.userId);
    const inv = await party.inviteToParty(a.userId, b.userId);
    await party.acceptInvite(b.userId, inv.id);
    // self-kick
    await expect(party.kickMember(a.userId, a.userId)).rejects.toMatchObject({
      code: 'SELF_NOT_ALLOWED',
    });
    // non-leader
    await expect(party.kickMember(b.userId, a.userId)).rejects.toMatchObject({
      code: 'NOT_AUTHORIZED',
    });
    // not member
    await expect(party.kickMember(a.userId, c.userId)).rejects.toMatchObject({
      code: 'TARGET_NOT_MEMBER',
    });
    // happy path
    const res = await party.kickMember(a.userId, b.userId);
    expect(res.members.find((m) => m.userId === b.userId)).toBeUndefined();
  });

  it('transferLeader: chỉ leader; target phải là member; success đổi role', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const c = await makePlayer();
    await makeParty(a.userId);
    const inv = await party.inviteToParty(a.userId, b.userId);
    await party.acceptInvite(b.userId, inv.id);
    // not leader
    await expect(
      party.transferLeader(b.userId, a.userId),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' });
    // self
    await expect(
      party.transferLeader(a.userId, a.userId),
    ).rejects.toMatchObject({ code: 'SELF_NOT_ALLOWED' });
    // target not member
    await expect(
      party.transferLeader(a.userId, c.userId),
    ).rejects.toMatchObject({ code: 'TARGET_NOT_MEMBER' });
    // happy
    const res = await party.transferLeader(a.userId, b.userId);
    expect(res.party.leaderUserId).toBe(b.userId);
    expect(res.members.find((m) => m.userId === b.userId)?.role).toBe('LEADER');
    expect(res.members.find((m) => m.userId === a.userId)?.role).toBe('MEMBER');
  });

  it('disband: chỉ leader; all members marked left', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await makeParty(a.userId);
    const inv = await party.inviteToParty(a.userId, b.userId);
    await party.acceptInvite(b.userId, inv.id);
    await expect(party.disbandParty(b.userId)).rejects.toMatchObject({
      code: 'NOT_AUTHORIZED',
    });
    const res = await party.disbandParty(a.userId);
    expect(res.partyId).toBeDefined();
    const my1 = await party.getMyParty(a.userId);
    const my2 = await party.getMyParty(b.userId);
    expect(my1.party).toBeNull();
    expect(my2.party).toBeNull();
  });
});

describe('Phase 19.4 — list endpoints', () => {
  it('listIncomingInvites + listOutgoingInvites filter đúng user', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await makeParty(a.userId);
    const inv = await party.inviteToParty(a.userId, b.userId);
    const incoming = await party.listIncomingInvites(b.userId);
    const outgoing = await party.listOutgoingInvites(a.userId);
    expect(incoming.map((x) => x.id)).toContain(inv.id);
    expect(outgoing.map((x) => x.id)).toContain(inv.id);
  });

  it('listMembers trả về thành viên của caller', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await makeParty(a.userId);
    const inv = await party.inviteToParty(a.userId, b.userId);
    await party.acceptInvite(b.userId, inv.id);
    const members = await party.listMembers(a.userId);
    expect(members).toHaveLength(2);
  });

  it('listMembers không có party → array rỗng', async () => {
    const a = await makePlayer();
    const members = await party.listMembers(a.userId);
    expect(members).toEqual([]);
  });
});
