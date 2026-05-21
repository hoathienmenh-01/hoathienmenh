import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { SectBossService } from './sect-boss.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  nextSuffix,
  wipeAll,
} from '../../test-helpers';

const BOSS_KEY = 'sect_boss_thu_ho_linh_mach'; // requiredSectLevel=1, dailyAttemptsPerMember=1, weeklyAttemptsPerSect=50

let prisma: PrismaService;
let service: SectBossService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const currency = new CurrencyService(prisma);
  service = new SectBossService(prisma, currency);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeSect(leaderUserId: string) {
  const name = `TestSect-${nextSuffix()}`;
  const leaderChar = await prisma.character.findFirstOrThrow({ where: { userId: leaderUserId } });
  return prisma.sect.create({
    data: {
      name,
      description: '',
      level: 1,
      leaderId: leaderChar.id,
    },
  });
}

async function joinSect(characterId: string, sectId: string, role: 'LEADER' | 'ELDER' | 'MEMBER' = 'MEMBER') {
  await prisma.character.update({ where: { id: characterId }, data: { sectId } });
  await prisma.sectMember.upsert({
    where: { characterId },
    create: { characterId, sectId, role, joinedAt: new Date() },
    update: { role },
  });
}

describe('SectBossService.list', () => {
  it('returns boss list with canSpawn=true for ELDER', async () => {
    const u = await makeUserChar(prisma);
    const s = await makeSect(u.userId);
    await joinSect(u.characterId, s.id, 'ELDER');

    const bosses = await service.list(u.userId);
    expect(bosses.length).toBeGreaterThan(0);
    const guardian = bosses.find((b) => b.key === BOSS_KEY);
    expect(guardian).toBeDefined();
    expect(guardian!.canSpawn).toBe(true);
  });

  it('canSpawn=false for MEMBER', async () => {
    const u = await makeUserChar(prisma);
    const s = await makeSect(u.userId);
    await joinSect(u.characterId, s.id, 'MEMBER');

    const bosses = await service.list(u.userId);
    const guardian = bosses.find((b) => b.key === BOSS_KEY);
    expect(guardian!.canSpawn).toBe(false);
  });

  it('throws SECT_REQUIRED when not in sect', async () => {
    const u = await makeUserChar(prisma);
    await expect(service.list(u.userId)).rejects.toMatchObject({ code: 'SECT_REQUIRED' });
  });
});

describe('SectBossService.spawn', () => {
  it('ELDER can spawn boss', async () => {
    const u = await makeUserChar(prisma);
    const s = await makeSect(u.userId);
    await joinSect(u.characterId, s.id, 'ELDER');

    const active = await service.spawn(u.userId, BOSS_KEY);
    expect(active.bossKey).toBe(BOSS_KEY);
    expect(active.currentHp).toBe(active.maxHp);
    expect(active.participants).toHaveLength(0);
  });

  it('LEADER can spawn boss', async () => {
    const u = await makeUserChar(prisma);
    const s = await makeSect(u.userId);
    await joinSect(u.characterId, s.id, 'LEADER');

    const active = await service.spawn(u.userId, BOSS_KEY);
    expect(active.bossKey).toBe(BOSS_KEY);
  });

  it('MEMBER cannot spawn → NOT_ELDER_OR_LEADER', async () => {
    const u = await makeUserChar(prisma);
    const s = await makeSect(u.userId);
    await joinSect(u.characterId, s.id, 'MEMBER');

    await expect(service.spawn(u.userId, BOSS_KEY)).rejects.toMatchObject({
      code: 'NOT_ELDER_OR_LEADER',
    });
  });

  it('unknown bossKey → BOSS_NOT_FOUND', async () => {
    const u = await makeUserChar(prisma);
    const s = await makeSect(u.userId);
    await joinSect(u.characterId, s.id, 'ELDER');

    await expect(service.spawn(u.userId, 'nonexistent_boss')).rejects.toMatchObject({
      code: 'BOSS_NOT_FOUND',
    });
  });

  it('already active boss → BOSS_ALREADY_ACTIVE', async () => {
    const u = await makeUserChar(prisma);
    const s = await makeSect(u.userId);
    await joinSect(u.characterId, s.id, 'ELDER');

    await service.spawn(u.userId, BOSS_KEY);
    await expect(service.spawn(u.userId, BOSS_KEY)).rejects.toMatchObject({
      code: 'BOSS_ALREADY_ACTIVE',
    });
  });

  it('sect level too low → SECT_LEVEL_TOO_LOW', async () => {
    const u = await makeUserChar(prisma);
    // Create sect with level 0 (below requiredSectLevel=1)
    const leaderChar = await prisma.character.findFirstOrThrow({ where: { userId: u.userId } });
    const s = await prisma.sect.create({
      data: {
        name: `LowSect-${nextSuffix()}`,
        description: '',
        level: 0,
        leaderId: leaderChar.id,
      },
    });
    await joinSect(u.characterId, s.id, 'ELDER');

    await expect(service.spawn(u.userId, BOSS_KEY)).rejects.toMatchObject({
      code: 'SECT_LEVEL_TOO_LOW',
    });
  });
});

describe('SectBossService.fight', () => {
  it('member can fight active boss and deal damage', async () => {
    const leader = await makeUserChar(prisma);
    const member = await makeUserChar(prisma);
    const s = await makeSect(leader.userId);
    await joinSect(leader.characterId, s.id, 'LEADER');
    await joinSect(member.characterId, s.id, 'MEMBER');

    await service.spawn(leader.userId, BOSS_KEY);
    const result = await service.fight(member.userId);

    expect(result.bossKey).toBe(BOSS_KEY);
    expect(result.damage).toBeGreaterThan(0);
    expect(result.currentHp).toBeLessThan(result.maxHp);
  });

  it('fight when no active boss → NO_ACTIVE_BOSS', async () => {
    const u = await makeUserChar(prisma);
    const s = await makeSect(u.userId);
    await joinSect(u.characterId, s.id, 'MEMBER');

    await expect(service.fight(u.userId)).rejects.toMatchObject({ code: 'NO_ACTIVE_BOSS' });
  });

  it('daily attempt cap → DAILY_ATTEMPTS_EXCEEDED', async () => {
    const leader = await makeUserChar(prisma);
    const member = await makeUserChar(prisma);
    const s = await makeSect(leader.userId);
    await joinSect(leader.characterId, s.id, 'LEADER');
    await joinSect(member.characterId, s.id, 'MEMBER');

    await service.spawn(leader.userId, BOSS_KEY);
    await service.fight(member.userId); // first attempt (dailyAttemptsPerMember=1)

    await expect(service.fight(member.userId)).rejects.toMatchObject({
      code: 'DAILY_ATTEMPTS_EXCEEDED',
    });
  });

  it('boss HP reaches 0 → defeated=true', async () => {
    const leader = await makeUserChar(prisma);
    const s = await makeSect(leader.userId);
    await joinSect(leader.characterId, s.id, 'LEADER');

    await service.spawn(leader.userId, BOSS_KEY);

    // Force boss HP to 1 so next fight defeats it
    const instance = await prisma.sectBossInstance.findFirstOrThrow({
      where: { sectId: s.id, defeated: false },
    });
    await prisma.sectBossInstance.update({
      where: { id: instance.id },
      data: { currentHp: 1 },
    });

    // Give leader enough power to deal ≥1 damage
    await prisma.character.update({
      where: { id: leader.characterId },
      data: { power: 100 },
    });

    const result = await service.fight(leader.userId);
    expect(result.defeated).toBe(true);
    expect(result.currentHp).toBe(0);
  });
});

describe('SectBossService.claim', () => {
  it('participant can claim reward after boss defeated', async () => {
    const leader = await makeUserChar(prisma);
    const s = await makeSect(leader.userId);
    await joinSect(leader.characterId, s.id, 'LEADER');

    await service.spawn(leader.userId, BOSS_KEY);

    // Force HP to 1 and defeat
    const instance = await prisma.sectBossInstance.findFirstOrThrow({
      where: { sectId: s.id, defeated: false },
    });
    await prisma.sectBossInstance.update({
      where: { id: instance.id },
      data: { currentHp: 1 },
    });
    await prisma.character.update({ where: { id: leader.characterId }, data: { power: 100 } });
    await service.fight(leader.userId);

    const claim = await service.claim(leader.userId);
    expect(claim.bossKey).toBe(BOSS_KEY);
    expect(claim.contributionGained).toBeGreaterThan(0);
  });

  it('double claim → ALREADY_CLAIMED', async () => {
    const leader = await makeUserChar(prisma);
    const s = await makeSect(leader.userId);
    await joinSect(leader.characterId, s.id, 'LEADER');

    await service.spawn(leader.userId, BOSS_KEY);
    const instance = await prisma.sectBossInstance.findFirstOrThrow({
      where: { sectId: s.id, defeated: false },
    });
    await prisma.sectBossInstance.update({ where: { id: instance.id }, data: { currentHp: 1 } });
    await prisma.character.update({ where: { id: leader.characterId }, data: { power: 100 } });
    await service.fight(leader.userId);

    await service.claim(leader.userId);
    await expect(service.claim(leader.userId)).rejects.toMatchObject({ code: 'ALREADY_CLAIMED' });
  });

  it('non-participant cannot claim → BOSS_NOT_DEFEATED', async () => {
    const leader = await makeUserChar(prisma);
    const bystander = await makeUserChar(prisma);
    const s = await makeSect(leader.userId);
    await joinSect(leader.characterId, s.id, 'LEADER');
    await joinSect(bystander.characterId, s.id, 'MEMBER');

    await service.spawn(leader.userId, BOSS_KEY);
    const instance = await prisma.sectBossInstance.findFirstOrThrow({
      where: { sectId: s.id, defeated: false },
    });
    await prisma.sectBossInstance.update({ where: { id: instance.id }, data: { currentHp: 1 } });
    await prisma.character.update({ where: { id: leader.characterId }, data: { power: 100 } });
    await service.fight(leader.userId);

    // bystander never fought → no participant row
    await expect(service.claim(bystander.userId)).rejects.toMatchObject({
      code: 'BOSS_NOT_DEFEATED',
    });
  });
});
