import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { SectService } from './sect.service';
import {
  TEST_DATABASE_URL,
  makeMissionService,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let sect: SectService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const missions = makeMissionService(prisma);
  sect = new SectService(prisma, realtime, chars, currency, missions);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('SectService', () => {
  it('create: tạo sect, đặt leaderId, gán sectId cho character', async () => {
    const u = await makeUserChar(prisma);
    const detail = await sect.create(u.userId, `S-${nextSuffix()}`, 'Tan môn phái');
    expect(detail.isMyLeader).toBe(true);
    expect(detail.isMyMember).toBe(true);
    const c = await prisma.character.findUniqueOrThrow({ where: { id: u.characterId } });
    expect(c.sectId).toBe(detail.id);
  });

  it('create: trùng tên → NAME_TAKEN', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const name = `S-${nextSuffix()}`;
    await sect.create(a.userId, name, '');
    await expect(sect.create(b.userId, name, '')).rejects.toMatchObject({
      code: 'NAME_TAKEN',
    });
  });

  it('create: user đã có sect → ALREADY_IN_SECT', async () => {
    const u = await makeUserChar(prisma);
    await sect.create(u.userId, `S-${nextSuffix()}`, '');
    await expect(sect.create(u.userId, `S-${nextSuffix()}`, '')).rejects.toMatchObject({
      code: 'ALREADY_IN_SECT',
    });
  });

  it('join + leave: gán/bỏ sectId, leave 2 lần liên tiếp → NOT_IN_SECT', async () => {
    const leader = await makeUserChar(prisma);
    const member = await makeUserChar(prisma);
    const s = await sect.create(leader.userId, `S-${nextSuffix()}`, '');

    await sect.join(member.userId, s.id);
    let m = await prisma.character.findUniqueOrThrow({ where: { id: member.characterId } });
    expect(m.sectId).toBe(s.id);

    await sect.leave(member.userId);
    m = await prisma.character.findUniqueOrThrow({ where: { id: member.characterId } });
    expect(m.sectId).toBeNull();

    await expect(sect.leave(member.userId)).rejects.toMatchObject({
      code: 'NOT_IN_SECT',
    });
  });

  it('contribute: trừ linh thạch + tăng treasury + tăng cống hiến + ghi ledger SECT_CONTRIBUTE', async () => {
    const leader = await makeUserChar(prisma, { linhThach: 1000n });
    const detail = await sect.create(leader.userId, `S-${nextSuffix()}`, '');
    await sect.contribute(leader.userId, 200n);

    const c = await prisma.character.findUniqueOrThrow({ where: { id: leader.characterId } });
    expect(c.linhThach).toBe(800n);
    expect(c.congHien).toBe(200);

    const s = await prisma.sect.findUniqueOrThrow({ where: { id: detail.id } });
    expect(s.treasuryLinhThach).toBe(200n);

    const ledger = await prisma.currencyLedger.findFirstOrThrow({
      where: { characterId: leader.characterId, reason: 'SECT_CONTRIBUTE' },
    });
    expect(ledger.delta).toBe(-200n);
    expect(ledger.refType).toBe('Sect');
    expect(ledger.refId).toBe(detail.id);
  });

  it('contribute: thiếu linh thạch → INSUFFICIENT_LINH_THACH, không trừ + không ghi ledger', async () => {
    const leader = await makeUserChar(prisma, { linhThach: 50n });
    await sect.create(leader.userId, `S-${nextSuffix()}`, '');
    await expect(sect.contribute(leader.userId, 200n)).rejects.toMatchObject({
      code: 'INSUFFICIENT_LINH_THACH',
    });
    const c = await prisma.character.findUniqueOrThrow({ where: { id: leader.characterId } });
    expect(c.linhThach).toBe(50n);
    expect(c.congHien).toBe(0);
    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: leader.characterId },
    });
    expect(ledger).toHaveLength(0);
  });

  it('contribute: chưa vào sect → NOT_IN_SECT', async () => {
    const u = await makeUserChar(prisma, { linhThach: 1000n });
    await expect(sect.contribute(u.userId, 100n)).rejects.toMatchObject({
      code: 'NOT_IN_SECT',
    });
  });

  it('create: SectMember row created with role LEADER', async () => {
    const u = await makeUserChar(prisma);
    const detail = await sect.create(u.userId, `S-${nextSuffix()}`, '');
    const member = await prisma.sectMember.findUniqueOrThrow({
      where: { characterId: u.characterId },
    });
    expect(member.sectId).toBe(detail.id);
    expect(member.role).toBe('LEADER');
    expect(detail.members[0].role).toBe('LEADER');
    expect(detail.members[0].isLeader).toBe(true);
  });

  it('join: SectMember row created with role MEMBER', async () => {
    const leader = await makeUserChar(prisma);
    const member = await makeUserChar(prisma);
    const s = await sect.create(leader.userId, `S-${nextSuffix()}`, '');
    await sect.join(member.userId, s.id);

    const row = await prisma.sectMember.findUniqueOrThrow({
      where: { characterId: member.characterId },
    });
    expect(row.sectId).toBe(s.id);
    expect(row.role).toBe('MEMBER');
  });

  it('leave: SectMember row deleted', async () => {
    const leader = await makeUserChar(prisma);
    const member = await makeUserChar(prisma);
    const s = await sect.create(leader.userId, `S-${nextSuffix()}`, '');
    await sect.join(member.userId, s.id);

    // Verify row exists before leave.
    expect(await prisma.sectMember.findUnique({ where: { characterId: member.characterId } })).not.toBeNull();

    await sect.leave(member.userId);
    expect(await prisma.sectMember.findUnique({ where: { characterId: member.characterId } })).toBeNull();
  });

  it('leave leader: SectMember row deleted + leaderId set to null', async () => {
    const leader = await makeUserChar(prisma);
    const s = await sect.create(leader.userId, `S-${nextSuffix()}`, '');
    expect(await prisma.sectMember.findUnique({ where: { characterId: leader.characterId } })).not.toBeNull();

    await sect.leave(leader.userId);
    expect(await prisma.sectMember.findUnique({ where: { characterId: leader.characterId } })).toBeNull();
    const sectRow = await prisma.sect.findUniqueOrThrow({ where: { id: s.id } });
    expect(sectRow.leaderId).toBeNull();
  });

  it('detail: members show correct role from SectMember', async () => {
    const leader = await makeUserChar(prisma);
    const member = await makeUserChar(prisma);
    const s = await sect.create(leader.userId, `S-${nextSuffix()}`, '');
    await sect.join(member.userId, s.id);

    const detail = await sect.detail(s.id, leader.characterId);
    expect(detail.members).toHaveLength(2);
    const leaderView = detail.members.find((m) => m.id === leader.characterId)!;
    const memberView = detail.members.find((m) => m.id === member.characterId)!;
    expect(leaderView.role).toBe('LEADER');
    expect(leaderView.isLeader).toBe(true);
    expect(memberView.role).toBe('MEMBER');
    expect(memberView.isLeader).toBe(false);
  });

  it('promote: LEADER promotes MEMBER → ELDER', async () => {
    const leader = await makeUserChar(prisma);
    const member = await makeUserChar(prisma);
    const s = await sect.create(leader.userId, `S-${nextSuffix()}`, '');
    await sect.join(member.userId, s.id);

    await sect.promote(leader.userId, member.characterId);
    const row = await prisma.sectMember.findUniqueOrThrow({ where: { characterId: member.characterId } });
    expect(row.role).toBe('ELDER');
  });

  it('promote: LEADER promotes ELDER → LEADER (old leader becomes ELDER)', async () => {
    const leader = await makeUserChar(prisma);
    const elder = await makeUserChar(prisma);
    const s = await sect.create(leader.userId, `S-${nextSuffix()}`, '');
    await sect.join(elder.userId, s.id);
    await sect.promote(leader.userId, elder.characterId); // MEMBER → ELDER

    await sect.promote(leader.userId, elder.characterId); // ELDER → LEADER
    const elderRow = await prisma.sectMember.findUniqueOrThrow({ where: { characterId: elder.characterId } });
    const leaderRow = await prisma.sectMember.findUniqueOrThrow({ where: { characterId: leader.characterId } });
    expect(elderRow.role).toBe('LEADER');
    expect(leaderRow.role).toBe('ELDER');
    const sectRow = await prisma.sect.findUniqueOrThrow({ where: { id: s.id } });
    expect(sectRow.leaderId).toBe(elder.characterId);
  });

  it('promote: MEMBER cannot promote → NOT_LEADER', async () => {
    const leader = await makeUserChar(prisma);
    const member1 = await makeUserChar(prisma);
    const member2 = await makeUserChar(prisma);
    const s = await sect.create(leader.userId, `S-${nextSuffix()}`, '');
    await sect.join(member1.userId, s.id);
    await sect.join(member2.userId, s.id);

    await expect(sect.promote(member1.userId, member2.characterId)).rejects.toMatchObject({
      code: 'NOT_LEADER',
    });
  });

  it('demote: LEADER demotes ELDER → MEMBER', async () => {
    const leader = await makeUserChar(prisma);
    const member = await makeUserChar(prisma);
    const s = await sect.create(leader.userId, `S-${nextSuffix()}`, '');
    await sect.join(member.userId, s.id);
    await sect.promote(leader.userId, member.characterId); // → ELDER

    await sect.demote(leader.userId, member.characterId);
    const row = await prisma.sectMember.findUniqueOrThrow({ where: { characterId: member.characterId } });
    expect(row.role).toBe('MEMBER');
  });

  it('demote: MEMBER cannot demote → NOT_LEADER', async () => {
    const leader = await makeUserChar(prisma);
    const member = await makeUserChar(prisma);
    const s = await sect.create(leader.userId, `S-${nextSuffix()}`, '');
    await sect.join(member.userId, s.id);

    await expect(sect.demote(member.userId, leader.characterId)).rejects.toMatchObject({
      code: 'NOT_LEADER',
    });
  });

  it('kick: LEADER kicks MEMBER', async () => {
    const leader = await makeUserChar(prisma);
    const member = await makeUserChar(prisma);
    const s = await sect.create(leader.userId, `S-${nextSuffix()}`, '');
    await sect.join(member.userId, s.id);

    await sect.kick(leader.userId, member.characterId);
    expect(await prisma.sectMember.findUnique({ where: { characterId: member.characterId } })).toBeNull();
    const c = await prisma.character.findUniqueOrThrow({ where: { id: member.characterId } });
    expect(c.sectId).toBeNull();
  });

  it('kick: ELDER kicks MEMBER', async () => {
    const leader = await makeUserChar(prisma);
    const elder = await makeUserChar(prisma);
    const member = await makeUserChar(prisma);
    const s = await sect.create(leader.userId, `S-${nextSuffix()}`, '');
    await sect.join(elder.userId, s.id);
    await sect.join(member.userId, s.id);
    await sect.promote(leader.userId, elder.characterId); // → ELDER

    await sect.kick(elder.userId, member.characterId);
    expect(await prisma.sectMember.findUnique({ where: { characterId: member.characterId } })).toBeNull();
  });

  it('kick: ELDER cannot kick ELDER → CANNOT_KICK_HIGHER_ROLE', async () => {
    const leader = await makeUserChar(prisma);
    const elder1 = await makeUserChar(prisma);
    const elder2 = await makeUserChar(prisma);
    const s = await sect.create(leader.userId, `S-${nextSuffix()}`, '');
    await sect.join(elder1.userId, s.id);
    await sect.join(elder2.userId, s.id);
    await sect.promote(leader.userId, elder1.characterId);
    await sect.promote(leader.userId, elder2.characterId);

    await expect(sect.kick(elder1.userId, elder2.characterId)).rejects.toMatchObject({
      code: 'CANNOT_KICK_HIGHER_ROLE',
    });
  });

  it('kick: MEMBER cannot kick → NOT_ELDER_OR_LEADER', async () => {
    const leader = await makeUserChar(prisma);
    const member1 = await makeUserChar(prisma);
    const member2 = await makeUserChar(prisma);
    const s = await sect.create(leader.userId, `S-${nextSuffix()}`, '');
    await sect.join(member1.userId, s.id);
    await sect.join(member2.userId, s.id);

    await expect(sect.kick(member1.userId, member2.characterId)).rejects.toMatchObject({
      code: 'NOT_ELDER_OR_LEADER',
    });
  });

  it('kick: cannot kick self → CANNOT_KICK_SELF', async () => {
    const leader = await makeUserChar(prisma);
    await sect.create(leader.userId, `S-${nextSuffix()}`, '');

    await expect(sect.kick(leader.userId, leader.characterId)).rejects.toMatchObject({
      code: 'CANNOT_KICK_SELF',
    });
  });

  it('leave: audit log created', async () => {
    const leader = await makeUserChar(prisma);
    const member = await makeUserChar(prisma);
    const s = await sect.create(leader.userId, `S-${nextSuffix()}`, '');
    await sect.join(member.userId, s.id);

    await sect.leave(member.userId);
    const log = await prisma.sectAuditLog.findFirst({
      where: { sectId: s.id, action: 'LEAVE', targetCharId: member.characterId },
    });
    expect(log).not.toBeNull();
    expect(log!.actorCharId).toBe(member.characterId);
    expect(log!.fromRole).toBe('MEMBER');
  });
});
