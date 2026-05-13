import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { FeedbackError, PlayerFeedbackService } from './player-feedback.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';

let prisma: PrismaService;
let svc: PlayerFeedbackService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new PlayerFeedbackService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

const validInput = {
  type: 'BUG_REPORT' as const,
  title: 'Combat freeze when summoning pet',
  description:
    'Whenever I summon my pet during combat, the UI freezes for ~3 seconds and skips a turn.',
};

describe('PlayerFeedbackService — Phase 41.0', () => {
  it('creates feedback successfully', async () => {
    const u = await makeUserChar(prisma);
    const fb = await svc.create(u.userId, validInput);
    expect(fb.type).toBe('BUG_REPORT');
    expect(fb.status).toBe('NEW');
    expect(fb.reporterCharacterId).toBe(u.characterId);
  });

  it('rejects feedback missing title', async () => {
    const u = await makeUserChar(prisma);
    await expect(
      svc.create(u.userId, { ...validInput, title: '' }),
    ).rejects.toMatchObject({ code: 'FEEDBACK_VALIDATION_FAILED' });
  });

  it('rejects feedback with description over cap', async () => {
    const u = await makeUserChar(prisma);
    await expect(
      svc.create(u.userId, {
        ...validInput,
        description: 'x'.repeat(5000),
      }),
    ).rejects.toBeInstanceOf(FeedbackError);
  });

  it('sanitizes script tags from description', async () => {
    const u = await makeUserChar(prisma);
    const fb = await svc.create(u.userId, {
      ...validInput,
      description:
        'A real bug <script>alert(1)</script> happens whenever I open inventory.',
    });
    expect(fb.description.includes('<script>')).toBe(false);
  });

  it('user can view own feedback', async () => {
    const u = await makeUserChar(prisma);
    const fb = await svc.create(u.userId, validInput);
    const got = await svc.getForUser(u.userId, fb.id);
    expect(got.id).toBe(fb.id);
  });

  it('user cannot view feedback of another user', async () => {
    const u1 = await makeUserChar(prisma);
    const u2 = await makeUserChar(prisma);
    const fb = await svc.create(u1.userId, validInput);
    await expect(svc.getForUser(u2.userId, fb.id)).rejects.toMatchObject({
      code: 'SUPPORT_PERMISSION_DENIED',
    });
  });

  it('admin can list every feedback in the system', async () => {
    const u1 = await makeUserChar(prisma);
    const u2 = await makeUserChar(prisma);
    await svc.create(u1.userId, validInput);
    await svc.create(u2.userId, validInput);
    const list = await svc.adminList({ limit: 10 });
    expect(list.total).toBe(2);
  });

  it('admin can update status to RESOLVED and set resolvedAt', async () => {
    const u = await makeUserChar(prisma);
    const fb = await svc.create(u.userId, validInput);
    const updated = await svc.adminPatch(fb.id, { status: 'RESOLVED' });
    expect(updated.status).toBe('RESOLVED');
    expect(updated.resolvedAt).not.toBeNull();
  });
});
