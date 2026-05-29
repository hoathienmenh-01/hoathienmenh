import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { EventService } from './event.service';

let prisma: PrismaService;
let events: EventService;
let adminUserId: string;

const NOW = new Date('2026-05-29T12:00:00.000Z');
const FUTURE = new Date('2026-06-30T12:00:00.000Z');

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  events = new EventService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
  const admin = await makeUserChar(prisma, { role: 'ADMIN' });
  adminUserId = admin.userId;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function validEventInput(key: string) {
  return {
    key,
    name: `Test Event ${key}`,
    eventType: 'LOGIN_EVENT' as const,
    startsAt: NOW,
    endsAt: FUTURE,
  };
}

describe('EventService.create', () => {
  it('creates event with valid input', async () => {
    const result = await events.create(validEventInput('test_event_1'), adminUserId);
    expect(result.key).toBe('test_event_1');
    expect(result.status).toBe('DRAFT');
    expect(result.name).toBe('Test Event test_event_1');
  });

  it('creates event with all optional fields', async () => {
    const result = await events.create(
      {
        ...validEventInput('test_event_full'),
        description: 'Full event',
        bannerUrl: 'https://example.com/banner.png',
        iconUrl: 'https://example.com/icon.png',
        adminNote: 'Admin note',
        playerNotice: 'Player notice',
        bracketMode: 'NONE',
      },
      adminUserId,
    );
    expect(result.description).toBe('Full event');
    expect(result.bannerUrl).toBe('https://example.com/banner.png');
  });
});

describe('EventService.list', () => {
  it('returns empty list for fresh database', async () => {
    const list = await events.list();
    expect(list).toEqual([]);
  });

  it('returns created events', async () => {
    await events.create(validEventInput('event_a'), adminUserId);
    await events.create(validEventInput('event_b'), adminUserId);
    const list = await events.list();
    expect(list).toHaveLength(2);
  });

  it('filters by status', async () => {
    await events.create(validEventInput('event_draft'), adminUserId);
    await events.create(validEventInput('event_draft_2'), adminUserId);
    const list = await events.list({ status: 'DRAFT' });
    expect(list).toHaveLength(2);
  });
});

describe('EventService.findByKey', () => {
  it('returns null for nonexistent key', async () => {
    const result = await events.findByKey('nonexistent');
    expect(result).toBeNull();
  });

  it('returns event for existing key', async () => {
    await events.create(validEventInput('find_me'), adminUserId);
    const result = await events.findByKey('find_me');
    expect(result).not.toBeNull();
    expect(result!.key).toBe('find_me');
  });
});

describe('EventService.update', () => {
  it('updates event name', async () => {
    await events.create(validEventInput('update_me'), adminUserId);
    const updated = await events.update('update_me', { name: 'Updated Name' }, adminUserId);
    expect(updated.name).toBe('Updated Name');
  });

  it('throws for nonexistent key', async () => {
    await expect(events.update('nonexistent', { name: 'X' }, adminUserId)).rejects.toThrow();
  });
});

describe('EventService.delete', () => {
  it('deletes DRAFT event', async () => {
    await events.create(validEventInput('delete_me'), adminUserId);
    const result = await events.delete('delete_me');
    expect(result.deleted).toBe(true);
    const found = await events.findByKey('delete_me');
    expect(found).toBeNull();
  });
});

describe('EventService.transition', () => {
  it('transitions DRAFT → SCHEDULED', async () => {
    await events.create(validEventInput('trans_1'), adminUserId);
    const result = await events.transition('trans_1', 'SCHEDULED', adminUserId);
    expect(result.status).toBe('SCHEDULED');
  });

  it('rejects invalid transition DRAFT → ACTIVE', async () => {
    await events.create(validEventInput('trans_2'), adminUserId);
    await expect(events.transition('trans_2', 'ACTIVE', adminUserId)).rejects.toThrow();
  });

  it('transitions DRAFT → SCHEDULED → ACTIVE', async () => {
    await events.create(validEventInput('trans_3'), adminUserId);
    await events.transition('trans_3', 'SCHEDULED', adminUserId);
    // ACTIVE requires an enabled balance policy
    await prisma.eventBalancePolicy.create({
      data: { eventKey: 'trans_3', enabled: true, maxTokenPerDay: 1000, maxTokenPerWeek: 5000, maxTokenPerEvent: 10000 },
    });
    const result = await events.transition('trans_3', 'ACTIVE', adminUserId);
    expect(result.status).toBe('ACTIVE');
  });
});
