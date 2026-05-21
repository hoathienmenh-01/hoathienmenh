import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { SectWarContributionService } from './sect-war-contribution.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let service: SectWarContributionService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  service = new SectWarContributionService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeSectWithMembers() {
  const leader = await makeUserChar(prisma);
  const elder = await makeUserChar(prisma);
  const member = await makeUserChar(prisma);

  const sect = await prisma.sect.create({
    data: {
      name: `Sect-${nextSuffix()}`,
      description: '',
      level: 1,
      leaderId: leader.characterId,
    },
  });

  for (const [charId, role] of [
    [leader.characterId, 'LEADER'],
    [elder.characterId, 'ELDER'],
    [member.characterId, 'MEMBER'],
  ] as const) {
    await prisma.character.update({ where: { id: charId }, data: { sectId: sect.id } });
    await prisma.sectMember.upsert({
      where: { characterId: charId },
      create: { characterId: charId, sectId: sect.id, role, joinedAt: new Date() },
      update: { role },
    });
  }

  return { sect, leader, elder, member };
}

async function addContribution(
  characterId: string,
  sectId: string,
  weekKey: string,
  points: number,
  activityKey = 'BOSS_KILL',
) {
  await prisma.sectWarContribution.create({
    data: { characterId, sectId, weekKey, points, activityKey, sourceType: 'SectBoss' },
  });
}

describe('SectWarContributionService.getSummary', () => {
  it('returns empty summary when no contributions', async () => {
    const { sect } = await makeSectWithMembers();
    const summary = await service.getSummary(sect.id, '2026-W21');
    expect(summary.totalPoints).toBe(0);
    expect(summary.byRole).toHaveLength(0);
    expect(summary.topContributors).toHaveLength(0);
  });

  it('aggregates contributions by role', async () => {
    const { sect, leader, elder, member } = await makeSectWithMembers();
    const weekKey = '2026-W21';

    await addContribution(leader.characterId, sect.id, weekKey, 100);
    await addContribution(elder.characterId, sect.id, weekKey, 80);
    await addContribution(member.characterId, sect.id, weekKey, 50);

    const summary = await service.getSummary(sect.id, weekKey);
    expect(summary.totalPoints).toBe(230);
    expect(summary.byRole.length).toBeGreaterThanOrEqual(3);

    const leaderRole = summary.byRole.find((r) => r.role === 'LEADER');
    expect(leaderRole?.totalPoints).toBe(100);

    const elderRole = summary.byRole.find((r) => r.role === 'ELDER');
    expect(elderRole?.totalPoints).toBe(80);

    const memberRole = summary.byRole.find((r) => r.role === 'MEMBER');
    expect(memberRole?.totalPoints).toBe(50);
  });

  it('top contributors sorted by points descending', async () => {
    const { sect, leader, elder, member } = await makeSectWithMembers();
    const weekKey = '2026-W21';

    await addContribution(member.characterId, sect.id, weekKey, 200);
    await addContribution(leader.characterId, sect.id, weekKey, 100);
    await addContribution(elder.characterId, sect.id, weekKey, 50);

    const summary = await service.getSummary(sect.id, weekKey);
    expect(summary.topContributors[0].characterId).toBe(member.characterId);
    expect(summary.topContributors[0].points).toBe(200);
  });

  it('role order: LEADER before ELDER before MEMBER', async () => {
    const { sect, leader, elder, member } = await makeSectWithMembers();
    const weekKey = '2026-W21';

    await addContribution(member.characterId, sect.id, weekKey, 10);
    await addContribution(elder.characterId, sect.id, weekKey, 10);
    await addContribution(leader.characterId, sect.id, weekKey, 10);

    const summary = await service.getSummary(sect.id, weekKey);
    const roles = summary.byRole.map((r) => r.role);
    expect(roles.indexOf('LEADER')).toBeLessThan(roles.indexOf('ELDER'));
    expect(roles.indexOf('ELDER')).toBeLessThan(roles.indexOf('MEMBER'));
  });
});

describe('SectWarContributionService.getPersonalContribution', () => {
  it('returns zero for character with no contributions', async () => {
    const { member } = await makeSectWithMembers();
    const result = await service.getPersonalContribution(member.characterId, '2026-W21');
    expect(result.totalPoints).toBe(0);
    expect(result.rank).toBeNull();
  });

  it('returns correct total and rank', async () => {
    const { sect, leader, member } = await makeSectWithMembers();
    const weekKey = '2026-W21';

    await addContribution(leader.characterId, sect.id, weekKey, 200);
    await addContribution(member.characterId, sect.id, weekKey, 100);

    const result = await service.getPersonalContribution(member.characterId, weekKey);
    expect(result.totalPoints).toBe(100);
    expect(result.rank).toBe(2); // leader has more points
  });

  it('breakdown groups by activityKey', async () => {
    const { sect, member } = await makeSectWithMembers();
    const weekKey = '2026-W21';

    await addContribution(member.characterId, sect.id, weekKey, 50, 'BOSS_KILL');
    await addContribution(member.characterId, sect.id, weekKey, 30, 'BOSS_KILL');
    await addContribution(member.characterId, sect.id, weekKey, 20, 'MISSION_COMPLETE');

    const result = await service.getPersonalContribution(member.characterId, weekKey);
    expect(result.totalPoints).toBe(100);

    const bossEntry = result.breakdown.find((b) => b.activityKey === 'BOSS_KILL');
    expect(bossEntry?.points).toBe(80);
    expect(bossEntry?.count).toBe(2);

    const missionEntry = result.breakdown.find((b) => b.activityKey === 'MISSION_COMPLETE');
    expect(missionEntry?.points).toBe(20);
  });
});

describe('SectWarContributionService.getSectLeaderboard', () => {
  it('returns empty leaderboard when no contributions', async () => {
    const { sect } = await makeSectWithMembers();
    const lb = await service.getSectLeaderboard(sect.id, '2026-W21');
    expect(lb).toHaveLength(0);
  });

  it('returns ranked leaderboard with role annotations', async () => {
    const { sect, leader, elder, member } = await makeSectWithMembers();
    const weekKey = '2026-W21';

    await addContribution(member.characterId, sect.id, weekKey, 300);
    await addContribution(leader.characterId, sect.id, weekKey, 200);
    await addContribution(elder.characterId, sect.id, weekKey, 100);

    const lb = await service.getSectLeaderboard(sect.id, weekKey);
    expect(lb).toHaveLength(3);
    expect(lb[0].rank).toBe(1);
    expect(lb[0].characterId).toBe(member.characterId);
    expect(lb[0].points).toBe(300);
    expect(lb[1].rank).toBe(2);
    expect(lb[2].rank).toBe(3);

    // All entries have role annotations
    for (const entry of lb) {
      expect(['LEADER', 'ELDER', 'MEMBER']).toContain(entry.role);
    }
  });

  it('respects limit parameter', async () => {
    const { sect, leader, elder, member } = await makeSectWithMembers();
    const weekKey = '2026-W21';

    await addContribution(leader.characterId, sect.id, weekKey, 100);
    await addContribution(elder.characterId, sect.id, weekKey, 80);
    await addContribution(member.characterId, sect.id, weekKey, 60);

    const lb = await service.getSectLeaderboard(sect.id, weekKey, 2);
    expect(lb).toHaveLength(2);
  });
});
