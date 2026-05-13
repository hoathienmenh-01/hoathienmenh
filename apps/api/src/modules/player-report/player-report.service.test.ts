import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { PlayerReportError, PlayerReportService } from './player-report.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let svc: PlayerReportService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new PlayerReportService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

const validInput = {
  reportType: 'HARASSMENT' as const,
  description:
    'Reported player keeps spamming offensive remarks in world chat after repeated warnings.',
};

describe('PlayerReportService — Phase 41.0', () => {
  it('creates a report successfully', async () => {
    const u1 = await makeUserChar(prisma);
    const u2 = await makeUserChar(prisma);
    const r = await svc.create(u1.userId, {
      ...validInput,
      targetCharacterId: u2.characterId,
    });
    expect(r.targetCharacterId).toBe(u2.characterId);
    expect(r.status).toBe('NEW');
  });

  it('rejects when target does not exist', async () => {
    const u = await makeUserChar(prisma);
    await expect(
      svc.create(u.userId, { ...validInput, targetCharacterId: 'char-missing' }),
    ).rejects.toMatchObject({ code: 'REPORT_TARGET_NOT_FOUND' });
  });

  it('rejects self report', async () => {
    const u = await makeUserChar(prisma);
    await expect(
      svc.create(u.userId, { ...validInput, targetCharacterId: u.characterId }),
    ).rejects.toMatchObject({ code: 'REPORT_SELF_NOT_ALLOWED' });
  });

  it('does not auto-ban the target', async () => {
    const u1 = await makeUserChar(prisma);
    const u2 = await makeUserChar(prisma);
    await svc.create(u1.userId, {
      ...validInput,
      targetCharacterId: u2.characterId,
    });
    const target = await prisma.user.findUnique({ where: { id: u2.userId } });
    expect(target?.banned).toBe(false);
  });

  it('admin can update report status', async () => {
    const u1 = await makeUserChar(prisma);
    const u2 = await makeUserChar(prisma);
    const r = await svc.create(u1.userId, {
      ...validInput,
      targetCharacterId: u2.characterId,
    });
    const updated = await svc.adminPatch(r.id, { status: 'REVIEWING' });
    expect(updated.status).toBe('REVIEWING');
  });

  it('rejects creation when reporter has no character', async () => {
    const target = await makeUserChar(prisma);
    const user = await prisma.user.create({
      data: { email: `noc-${Date.now()}@xt.local`, passwordHash: 'x' },
    });
    await expect(
      svc.create(user.id, {
        ...validInput,
        targetCharacterId: target.characterId,
      }),
    ).rejects.toBeInstanceOf(PlayerReportError);
  });
});
