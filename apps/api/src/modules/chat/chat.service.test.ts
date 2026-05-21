import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  CHAT_RATE_LIMIT_MAX,
  ChatError,
  ChatService,
} from './chat.service';
import { InMemorySlidingWindowRateLimiter } from '../../common/rate-limiter';
import { MissionService } from '../mission/mission.service';
import {
  TEST_DATABASE_URL,
  makeMissionService,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';

let prisma: PrismaService;
let realtime: RealtimeService;
let missions: MissionService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  realtime = new RealtimeService();
  missions = makeMissionService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

function svcWithFreshLimiter(windowMs = 30_000, max = CHAT_RATE_LIMIT_MAX) {
  const limiter = new InMemorySlidingWindowRateLimiter(windowMs, max);
  const svc = new ChatService(prisma, realtime, missions, limiter);
  return { svc, limiter };
}

describe('ChatService.sendWorld - validation', () => {
  it('EMPTY_TEXT khi text rỗng hoặc whitespace', async () => {
    const u = await makeUserChar(prisma);
    const { svc } = svcWithFreshLimiter();
    await expect(svc.sendWorld(u.userId, '')).rejects.toMatchObject({
      code: 'EMPTY_TEXT',
    });
    await expect(svc.sendWorld(u.userId, '   ')).rejects.toMatchObject({
      code: 'EMPTY_TEXT',
    });
  });

  it('TEXT_TOO_LONG khi text vượt 200 kí tự', async () => {
    const u = await makeUserChar(prisma);
    const { svc } = svcWithFreshLimiter();
    const long = 'a'.repeat(201);
    await expect(svc.sendWorld(u.userId, long)).rejects.toBeInstanceOf(
      ChatError,
    );
    await expect(svc.sendWorld(u.userId, long)).rejects.toMatchObject({
      code: 'TEXT_TOO_LONG',
    });
  });

  it('NO_CHARACTER nếu user chưa tạo character', async () => {
    const user = await prisma.user.create({
      data: { email: 'noc@xt.local', passwordHash: 'x' },
    });
    const { svc } = svcWithFreshLimiter();
    await expect(svc.sendWorld(user.id, 'hi')).rejects.toMatchObject({
      code: 'NO_CHARACTER',
    });
  });
});

describe('ChatService rate limit (8 tin / 30s / player)', () => {
  it('cho phép đủ 8 tin trong window, tin thứ 9 bị RATE_LIMITED', async () => {
    const u = await makeUserChar(prisma);
    const { svc } = svcWithFreshLimiter();
    for (let i = 0; i < CHAT_RATE_LIMIT_MAX; i++) {
      await svc.sendWorld(u.userId, `msg ${i + 1}`);
    }
    await expect(svc.sendWorld(u.userId, 'too many')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('rate limit dùng chung giữa kênh WORLD và SECT (không bypass bằng đổi kênh)', async () => {
    const sect = await prisma.sect.create({
      data: { name: 'RLTest', leaderId: 'placeholder' },
    });
    const u = await makeUserChar(prisma, { sectId: sect.id });
    await prisma.sect.update({
      where: { id: sect.id },
      data: { leaderId: u.characterId },
    });
    const { svc } = svcWithFreshLimiter();
    // 4 tin WORLD + 4 tin SECT = 8 → vẫn OK; tin thứ 9 fail.
    for (let i = 0; i < 4; i++) await svc.sendWorld(u.userId, `w${i}`);
    for (let i = 0; i < 4; i++) await svc.sendSect(u.userId, `s${i}`);
    await expect(svc.sendWorld(u.userId, 'overflow')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    await expect(svc.sendSect(u.userId, 'overflow')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('player A bị limit không làm ảnh hưởng player B', async () => {
    const a = await makeUserChar(prisma);
    const b = await makeUserChar(prisma);
    const { svc } = svcWithFreshLimiter();
    for (let i = 0; i < CHAT_RATE_LIMIT_MAX; i++) {
      await svc.sendWorld(a.userId, `a-${i}`);
    }
    await expect(svc.sendWorld(a.userId, 'over')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    // B vẫn gửi được full quota riêng.
    for (let i = 0; i < CHAT_RATE_LIMIT_MAX; i++) {
      const view = await svc.sendWorld(b.userId, `b-${i}`);
      expect(view.text).toBe(`b-${i}`);
    }
  });

  it('window trượt: sau khi window hết, lại gửi được', async () => {
    vi.useFakeTimers();
    try {
      const u = await makeUserChar(prisma);
      // Window 200ms, max = 2. Advance time past window before 4th send.
      const { svc } = svcWithFreshLimiter(200, 2);
      await svc.sendWorld(u.userId, '1');
      await svc.sendWorld(u.userId, '2');
      await expect(svc.sendWorld(u.userId, '3')).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
      // Advance fake clock past window — no real sleep needed.
      vi.advanceTimersByTime(300);
      const view = await svc.sendWorld(u.userId, 'after-window');
      expect(view.text).toBe('after-window');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ChatService.sendSect - scope', () => {
  it('NO_SECT khi character chưa vào sect', async () => {
    const u = await makeUserChar(prisma);
    const { svc } = svcWithFreshLimiter();
    await expect(svc.sendSect(u.userId, 'hi sect')).rejects.toMatchObject({
      code: 'NO_SECT',
    });
  });

  it('sendSect lưu message với scopeKey = sectId', async () => {
    const sect = await prisma.sect.create({
      data: { name: 'ScopeTest', leaderId: 'placeholder' },
    });
    const u = await makeUserChar(prisma, { sectId: sect.id });
    await prisma.sect.update({
      where: { id: sect.id },
      data: { leaderId: u.characterId },
    });
    const { svc } = svcWithFreshLimiter();
    const view = await svc.sendSect(u.userId, 'trong tông');
    expect(view.channel).toBe('SECT');
    expect(view.scopeKey).toBe(sect.id);
    expect(view.text).toBe('trong tông');
  });
});
