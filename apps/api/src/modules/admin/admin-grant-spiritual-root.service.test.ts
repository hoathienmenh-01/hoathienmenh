import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { TopupService } from '../topup/topup.service';
import { InventoryService } from '../inventory/inventory.service';
import { QuestService } from '../quest/quest.service';
import { AdminService } from './admin.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let admin: AdminService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  const chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const topup = new TopupService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  const quests = new QuestService(prisma, currency, inventory);
  admin = new AdminService(prisma, chars, topup, realtime, currency, inventory, quests);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('AdminService.grantSpiritualRoot', () => {
  it('grant grade=than primary=kim (auto-derive secondary 4 phần tử) → Character update + log', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma); // legacy null spiritualRootGrade

    await admin.grantSpiritualRoot(adminU.userId, 'ADMIN', player.userId, {
      grade: 'than',
      primaryElement: 'kim',
      reason: 'smoke combat seed',
    });

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.spiritualRootGrade).toBe('than');
    expect(c?.primaryElement).toBe('kim');
    expect(c?.secondaryElements).toEqual(['moc', 'thuy', 'hoa', 'tho']);
    expect(c?.rootPurity).toBe(100);

    const logs = await prisma.spiritualRootRollLog.findMany({
      where: { characterId: player.characterId, source: 'admin_grant' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].previousGrade).toBeNull();
    expect(logs[0].newGrade).toBe('than');
    expect(logs[0].previousElement).toBeNull();
    expect(logs[0].newElement).toBe('kim');
    expect(logs[0].newPurity).toBe(100);

    const audits = await prisma.adminAuditLog.findMany({
      where: { actorUserId: adminU.userId, action: 'admin.spiritualRoot.grant' },
    });
    expect(audits).toHaveLength(1);
    const meta = audits[0].meta as Record<string, unknown>;
    expect(meta.grade).toBe('than');
    expect(meta.primaryElement).toBe('kim');
    expect(meta.purity).toBe(100);
  });

  it('grant grade=pham (secondaryCount=0) → secondary [] + purity custom', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await admin.grantSpiritualRoot(adminU.userId, 'ADMIN', player.userId, {
      grade: 'pham',
      primaryElement: 'thuy',
      purity: 1,
      reason: '',
    });

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.spiritualRootGrade).toBe('pham');
    expect(c?.primaryElement).toBe('thuy');
    expect(c?.secondaryElements).toEqual([]);
    expect(c?.rootPurity).toBe(1);
  });

  it('grant với secondaryElements truyền tay → match grade tier', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await admin.grantSpiritualRoot(adminU.userId, 'ADMIN', player.userId, {
      grade: 'huyen', // count=2
      primaryElement: 'kim',
      secondaryElements: ['hoa', 'tho'],
      reason: '',
    });

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.secondaryElements).toEqual(['hoa', 'tho']);
  });

  it('override 2 lần liên tiếp → log row source=admin_grant tăng + Character giữ giá trị mới nhất', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await admin.grantSpiritualRoot(adminU.userId, 'ADMIN', player.userId, {
      grade: 'pham',
      primaryElement: 'kim',
      reason: 'first',
    });
    await admin.grantSpiritualRoot(adminU.userId, 'ADMIN', player.userId, {
      grade: 'tien', // count=3
      primaryElement: 'thuy',
      reason: 'second',
    });

    const c = await prisma.character.findUnique({ where: { id: player.characterId } });
    expect(c?.spiritualRootGrade).toBe('tien');
    expect(c?.primaryElement).toBe('thuy');

    const logs = await prisma.spiritualRootRollLog.findMany({
      where: { characterId: player.characterId, source: 'admin_grant' },
      orderBy: { rolledAt: 'asc' },
    });
    expect(logs).toHaveLength(2);
    // Lần 2: previous = 'pham' (lần 1 đã set), new = 'tien'.
    expect(logs[1].previousGrade).toBe('pham');
    expect(logs[1].newGrade).toBe('tien');
    expect(logs[1].previousElement).toBe('kim');
  });

  it('grade invalid → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await expect(
      admin.grantSpiritualRoot(adminU.userId, 'ADMIN', player.userId, {
        // @ts-expect-error testing runtime guard
        grade: 'fake',
        primaryElement: 'kim',
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('primaryElement invalid → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await expect(
      admin.grantSpiritualRoot(adminU.userId, 'ADMIN', player.userId, {
        grade: 'pham',
        // @ts-expect-error testing runtime guard
        primaryElement: 'air',
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('secondary truyền tay nhưng count sai grade tier → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await expect(
      admin.grantSpiritualRoot(adminU.userId, 'ADMIN', player.userId, {
        grade: 'huyen', // count=2
        primaryElement: 'kim',
        secondaryElements: ['hoa'], // chỉ 1 → fail
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('secondary chứa primary → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await expect(
      admin.grantSpiritualRoot(adminU.userId, 'ADMIN', player.userId, {
        grade: 'linh', // count=1
        primaryElement: 'kim',
        secondaryElements: ['kim'], // duplicate primary
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('secondary có duplicate → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await expect(
      admin.grantSpiritualRoot(adminU.userId, 'ADMIN', player.userId, {
        grade: 'huyen',
        primaryElement: 'kim',
        secondaryElements: ['hoa', 'hoa'],
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('purity < 1 → INVALID_INPUT', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });
    const player = await makeUserChar(prisma);

    await expect(
      admin.grantSpiritualRoot(adminU.userId, 'ADMIN', player.userId, {
        grade: 'pham',
        primaryElement: 'kim',
        purity: 0,
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('actor = target → CANNOT_TARGET_SELF', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });

    await expect(
      admin.grantSpiritualRoot(adminU.userId, 'ADMIN', adminU.userId, {
        grade: 'pham',
        primaryElement: 'kim',
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'CANNOT_TARGET_SELF' });
  });

  it('MOD grant cho MOD → FORBIDDEN (MOD chỉ override PLAYER)', async () => {
    const modA = await makeUserChar(prisma, { role: 'MOD' });
    const modB = await makeUserChar(prisma, { role: 'MOD' });

    await expect(
      admin.grantSpiritualRoot(modA.userId, 'MOD', modB.userId, {
        grade: 'pham',
        primaryElement: 'kim',
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('target không tồn tại → NOT_FOUND', async () => {
    const adminU = await makeUserChar(prisma, { role: 'ADMIN' });

    await expect(
      admin.grantSpiritualRoot(adminU.userId, 'ADMIN', 'no-such-user', {
        grade: 'pham',
        primaryElement: 'kim',
        reason: '',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
