import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { makeUserChar, wipeAll } from '../../test-helpers';
import { RealtimeService } from '../realtime/realtime.service';
import { SocialService } from '../social/social.service';
import { ChatPrivateError, ChatPrivateService } from './chat-private.service';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let realtime: RealtimeService;
let social: SocialService;
let chat: ChatPrivateService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  realtime = new RealtimeService();
  social = new SocialService(prisma);
  chat = new ChatPrivateService(prisma, social, realtime);
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

describe('Phase 19.1 — ChatPrivateService thread lifecycle', () => {
  it('Cấm tạo thread tự gửi tự (self) — SELF_NOT_ALLOWED', async () => {
    const u = await makePlayer();
    await expect(
      chat.getOrCreatePrivateThread(u.userId, u.userId),
    ).rejects.toMatchObject({ code: 'SELF_NOT_ALLOWED' });
  });

  it('Idempotent: gọi 2 lần cùng 1 cặp → cùng 1 threadId', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const t1 = await chat.getOrCreatePrivateThread(a.userId, b.userId);
    const t2 = await chat.getOrCreatePrivateThread(b.userId, a.userId);
    expect(t2.id).toBe(t1.id);
  });

  it('Block 2 chiều reject BLOCKED khi tạo thread', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await social.blockUser(a.userId, b.userId);
    await expect(
      chat.getOrCreatePrivateThread(a.userId, b.userId),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    await expect(
      chat.getOrCreatePrivateThread(b.userId, a.userId),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
  });
});

describe('Phase 19.1 — ChatPrivateService sendPrivateMessage', () => {
  it('Cấm user thứ 3 gửi message vào thread → NOT_FOUND (mask)', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const c = await makePlayer();
    const t = await chat.getOrCreatePrivateThread(a.userId, b.userId);
    await expect(
      chat.sendPrivateMessage(c.userId, t.id, 'hello'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('Cấm gửi nếu user đang block peer → BLOCKED', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const t = await chat.getOrCreatePrivateThread(a.userId, b.userId);
    await social.blockUser(a.userId, b.userId);
    await expect(
      chat.sendPrivateMessage(a.userId, t.id, 'hi'),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    await expect(
      chat.sendPrivateMessage(b.userId, t.id, 'hi'),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
  });

  it('Reject INVALID_INPUT nếu body empty / whitespace / quá 500', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const t = await chat.getOrCreatePrivateThread(a.userId, b.userId);
    await expect(
      chat.sendPrivateMessage(a.userId, t.id, ''),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      chat.sendPrivateMessage(a.userId, t.id, '   '),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      chat.sendPrivateMessage(a.userId, t.id, 'x'.repeat(501)),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('Gửi message hợp lệ → trả về row có senderDisplayName', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const t = await chat.getOrCreatePrivateThread(a.userId, b.userId);
    const m = await chat.sendPrivateMessage(a.userId, t.id, 'hi');
    expect(m.threadId).toBe(t.id);
    expect(m.senderUserId).toBe(a.userId);
    expect(m.senderDisplayName).toBe(a.name);
    expect(m.body).toBe('hi');
  });

  it('Body trim 2 đầu — "  hi  " → "hi"', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const t = await chat.getOrCreatePrivateThread(a.userId, b.userId);
    const m = await chat.sendPrivateMessage(a.userId, t.id, '  hi  ');
    expect(m.body).toBe('hi');
  });
});

describe('Phase 19.1 — ChatPrivateService listPrivateMessages', () => {
  it('Cấm user thứ 3 đọc → NOT_FOUND', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const c = await makePlayer();
    const t = await chat.getOrCreatePrivateThread(a.userId, b.userId);
    await chat.sendPrivateMessage(a.userId, t.id, 'hi');
    await expect(
      chat.listPrivateMessages(c.userId, t.id),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('Trả về thứ tự desc theo createdAt', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const t = await chat.getOrCreatePrivateThread(a.userId, b.userId);
    await chat.sendPrivateMessage(a.userId, t.id, 'm1');
    await new Promise((r) => setTimeout(r, 5));
    await chat.sendPrivateMessage(b.userId, t.id, 'm2');
    const list = await chat.listPrivateMessages(a.userId, t.id);
    expect(list.map((x) => x.body)).toEqual(['m2', 'm1']);
  });

  it('listPrivateThreads chỉ trả thread của caller', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    const c = await makePlayer();
    await chat.getOrCreatePrivateThread(a.userId, b.userId);
    await chat.getOrCreatePrivateThread(a.userId, c.userId);
    const list = await chat.listPrivateThreads(a.userId);
    expect(list).toHaveLength(2);
    const peerIds = list.map((t) => t.peerUserId).sort();
    expect(peerIds).toEqual([b.userId, c.userId].sort());

    const listB = await chat.listPrivateThreads(b.userId);
    expect(listB).toHaveLength(1);
    expect(listB[0].peerUserId).toBe(a.userId);
  });

  it('listPrivateThreads filter thread mà peer đang bị block', async () => {
    const a = await makePlayer();
    const b = await makePlayer();
    await chat.getOrCreatePrivateThread(a.userId, b.userId);
    await social.blockUser(a.userId, b.userId);
    const list = await chat.listPrivateThreads(a.userId);
    expect(list).toEqual([]);
  });

  it('NOT_FOUND nếu threadId không tồn tại', async () => {
    const a = await makePlayer();
    await expect(
      chat.listPrivateMessages(a.userId, 'does-not-exist'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('Phase 19.1 — ChatPrivateError class', () => {
  it('ChatPrivateError carry code', () => {
    const e = new ChatPrivateError('BLOCKED');
    expect(e.code).toBe('BLOCKED');
    expect(e.message).toBe('BLOCKED');
  });
});
