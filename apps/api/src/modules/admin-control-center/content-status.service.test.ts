import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { ContentStatusService } from './content-status.service';

let prisma: PrismaService;
let contentStatus: ContentStatusService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  contentStatus = new ContentStatusService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ContentStatusService.list', () => {
  it('returns empty list for fresh database', async () => {
    const list = await contentStatus.list();
    expect(list).toEqual([]);
  });

  it('returns upserted entries', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    await contentStatus.upsert(
      {
        contentType: 'FARM_MAP',
        contentKey: 'farm_test',
        enabled: true,
        paused: false,
        disableReward: false,
        disableClaim: false,
      },
      admin.userId,
    );
    const list = await contentStatus.list();
    expect(list).toHaveLength(1);
    expect(list[0].contentKey).toBe('farm_test');
  });
});

describe('ContentStatusService.findByKey', () => {
  it('returns null for nonexistent key', async () => {
    const result = await contentStatus.findByKey('FARM_MAP', 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns spec for existing key', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    await contentStatus.upsert(
      {
        contentType: 'DUNGEON',
        contentKey: 'dungeon_test',
        enabled: true,
        paused: false,
        disableReward: false,
        disableClaim: false,
      },
      admin.userId,
    );
    const result = await contentStatus.findByKey('DUNGEON', 'dungeon_test');
    expect(result).not.toBeNull();
    expect(result!.contentType).toBe('DUNGEON');
    expect(result!.contentKey).toBe('dungeon_test');
  });
});

describe('ContentStatusService.upsert', () => {
  it('creates new content status', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    const result = await contentStatus.upsert(
      {
        contentType: 'FARM_MAP',
        contentKey: 'farm_new',
        enabled: true,
        paused: false,
        disableReward: false,
        disableClaim: false,
        message: 'Test message',
      },
      admin.userId,
    );
    expect(result.contentType).toBe('FARM_MAP');
    expect(result.contentKey).toBe('farm_new');
    expect(result.enabled).toBe(true);
    expect(result.message).toBe('Test message');
  });

  it('updates existing content status', async () => {
    const admin = await makeUserChar(prisma, { role: 'ADMIN' });
    await contentStatus.upsert(
      {
        contentType: 'FARM_MAP',
        contentKey: 'farm_update',
        enabled: true,
        paused: false,
        disableReward: false,
        disableClaim: false,
      },
      admin.userId,
    );
    const updated = await contentStatus.upsert(
      {
        contentType: 'FARM_MAP',
        contentKey: 'farm_update',
        enabled: true,
        paused: true,
        disableReward: true,
        disableClaim: false,
      },
      admin.userId,
    );
    expect(updated.enabled).toBe(true);
    expect(updated.paused).toBe(true);
    expect(updated.disableReward).toBe(true);
    // Verify only 1 row exists
    const count = await prisma.contentStatus.count({
      where: { contentType: 'FARM_MAP', contentKey: 'farm_update' },
    });
    expect(count).toBe(1);
  });
});
