import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CharacterService } from '../character/character.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { MailError, MailService } from './mail.service';
import {
  TEST_DATABASE_URL,
  makeUserChar,
  wipeAll,
} from '../../test-helpers';

/**
 * Phase 44.0 — Anti-Duplicate Claim Audit (mail focus).
 *
 * Bao phủ các kịch bản tấn công mà existing mail.service.test.ts chưa
 * cover sâu:
 *
 *  1. Spam claim song song (Promise.all 10x cùng mailId) → exactly 1 lần
 *     thành công, 9 lần ALREADY_CLAIMED, character chỉ nhận reward 1 lần.
 *  2. claim-all idempotent — 2 lần claim-all liên tiếp không double-grant.
 *  3. Mail expired không claim được kể cả qua spam.
 *  4. Mail deleted không claim được.
 *  5. CurrencyLedger không có dup row sau spam.
 *  6. MailAttachmentClaim chỉ có đúng 1 row sau spam.
 *
 * Sử dụng PostgreSQL test DB (CI service postgres:16-alpine).
 */

let prisma: PrismaService;
let mail: MailService;
let chars: CharacterService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const realtime = new RealtimeService();
  chars = new CharacterService(prisma, realtime);
  const currency = new CurrencyService(prisma);
  const inventory = new InventoryService(prisma, realtime, chars);
  mail = new MailService(prisma, currency, inventory, realtime);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Phase 44.0 — mail anti-duplicate claim', () => {
  it('spam claim song song (10 calls) → exactly 1 success, character nhận đúng 1 lần', async () => {
    const u = await makeUserChar(prisma, { linhThach: 0n, tienNgoc: 0 });
    const sent = await mail.sendToCharacter({
      recipientCharacterId: u.characterId,
      subject: 'Anti-spam reward',
      body: 'Should grant exactly once.',
      rewardLinhThach: 500n,
      rewardTienNgoc: 25,
      rewardItems: [{ itemKey: 'huyet_chi_dan', qty: 2 }],
    });

    // 10 concurrent claim calls trên cùng mailId.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => mail.claim(u.userId, sent.id)),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(9);
    // Mọi lần thất bại đều ALREADY_CLAIMED (CAS thắng exactly 1 thread).
    for (const r of rejected) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(MailError);
      expect((reason as MailError).code).toBe('ALREADY_CLAIMED');
    }

    // Character nhận đúng 1 lần.
    const char = await prisma.character.findUniqueOrThrow({
      where: { id: u.characterId },
    });
    expect(char.linhThach).toBe(500n);
    expect(char.tienNgoc).toBe(25);

    // Inventory đúng 1 stack 2 items.
    const inv = await prisma.inventoryItem.findMany({
      where: { characterId: u.characterId, itemKey: 'huyet_chi_dan' },
    });
    expect(inv.reduce((a, x) => a + x.qty, 0)).toBe(2);

    // CurrencyLedger: 2 row (LT + TN), không có dup.
    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: u.characterId, reason: 'MAIL_CLAIM' },
    });
    expect(ledger.length).toBe(2);

    // MailAttachmentClaim: đúng 1 row.
    const claims = await prisma.mailAttachmentClaim.findMany({
      where: { mailId: sent.id, characterId: u.characterId },
    });
    expect(claims.length).toBe(1);
  });

  it('claim-all idempotent — 2 lần liên tiếp không double-grant', async () => {
    const u = await makeUserChar(prisma, { linhThach: 0n, tienNgoc: 0 });
    // Tạo 3 mail có reward.
    for (let i = 0; i < 3; i++) {
      await mail.sendToCharacter({
        recipientCharacterId: u.characterId,
        subject: `Reward ${i}`,
        body: 'b',
        rewardLinhThach: BigInt(100 * (i + 1)),
      });
    }

    // Lần 1: claim from claim-all (loop từng mail, swallow ALREADY_CLAIMED).
    await claimAllSafely(mail, u.userId);
    // Lần 2: chạy lại → expect không có grant thêm.
    await claimAllSafely(mail, u.userId);

    const char = await prisma.character.findUniqueOrThrow({
      where: { id: u.characterId },
    });
    // Total = 100 + 200 + 300 = 600 — không double.
    expect(char.linhThach).toBe(600n);

    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: u.characterId, reason: 'MAIL_CLAIM' },
    });
    // 3 mail × 1 currency (linhThach) = 3 row, không double.
    expect(ledger.length).toBe(3);
  });

  it('spam claim trên mail expired → tất cả fail với MAIL_EXPIRED', async () => {
    const u = await makeUserChar(prisma);
    const sent = await mail.sendToCharacter({
      recipientCharacterId: u.characterId,
      subject: 'Expired reward',
      body: 'b',
      rewardLinhThach: 999n,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => mail.claim(u.userId, sent.id)),
    );
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    for (const r of results) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(MailError);
      expect((reason as MailError).code).toBe('MAIL_EXPIRED');
    }
    // Không có ledger row.
    const ledger = await prisma.currencyLedger.findMany({
      where: { characterId: u.characterId, reason: 'MAIL_CLAIM' },
    });
    expect(ledger.length).toBe(0);
  });

  it('spam claim trên mail của user khác → tất cả MAIL_NOT_FOUND', async () => {
    const owner = await makeUserChar(prisma);
    const attacker = await makeUserChar(prisma);
    const sent = await mail.sendToCharacter({
      recipientCharacterId: owner.characterId,
      subject: 'Owner reward',
      body: 'b',
      rewardLinhThach: 1000n,
    });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => mail.claim(attacker.userId, sent.id)),
    );
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    for (const r of results) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(MailError);
      expect((reason as MailError).code).toBe('MAIL_NOT_FOUND');
    }
  });

  it('mail soft-deleted → ALREADY_CLAIMED/MAIL_DELETED không grant reward', async () => {
    const u = await makeUserChar(prisma);
    const sent = await mail.sendToCharacter({
      recipientCharacterId: u.characterId,
      subject: 'Doomed',
      body: 'b',
      rewardLinhThach: 100n,
    });
    // Bypass service: soft-delete trực tiếp để giả lập race.
    await prisma.mail.update({
      where: { id: sent.id },
      data: { deletedAt: new Date() },
    });

    await expect(mail.claim(u.userId, sent.id)).rejects.toSatisfy(
      (e) => e instanceof MailError && (e.code === 'MAIL_DELETED' || e.code === 'MAIL_NOT_FOUND'),
    );
  });
});

/**
 * Helper — claim tất cả mail có thể claim, swallow ALREADY_CLAIMED.
 * Mirror behavior của claim-all controller (mỗi mail = 1 service call).
 */
async function claimAllSafely(
  svc: MailService,
  userId: string,
): Promise<void> {
  const inbox = await svc.inbox(userId);
  for (const m of inbox) {
    if (!m.claimable || m.claimedAt) continue;
    try {
      await svc.claim(userId, m.id);
    } catch (e) {
      if (e instanceof MailError && e.code === 'ALREADY_CLAIMED') continue;
      throw e;
    }
  }
}
