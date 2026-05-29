import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { WalletService } from './wallet.service';
import { SweepTicketService, ExtraAttemptService } from './sweep-attempt.service';

let prisma: PrismaService;
let sweepTicket: SweepTicketService;
let extraAttempt: ExtraAttemptService;

const NOW = new Date('2026-05-29T12:00:00.000Z');

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  const currency = new CurrencyService(prisma);
  const wallet = new WalletService(prisma, currency);
  sweepTicket = new SweepTicketService(prisma, wallet);
  extraAttempt = new ExtraAttemptService(prisma, wallet);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('SweepTicketService.useTicket', () => {
  it('throws INVALID_INPUT for non-sweepable content type', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      sweepTicket.useTicket({
        characterId: f.characterId,
        ticketKey: 'sweep_ticket',
        contentType: 'INVALID_TYPE',
        contentKey: 'some_key',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('throws CONTENT_NOT_CLEARED when content not cleared', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      sweepTicket.useTicket({
        characterId: f.characterId,
        ticketKey: 'sweep_ticket',
        contentType: 'DUNGEON',
        contentKey: 'nonexistent_dungeon',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'CONTENT_NOT_CLEARED' });
  });

  it('throws INSUFFICIENT_CURRENCY when not enough tienNgocKhoa', async () => {
    const f = await makeUserChar(prisma);
    // Create a completed dungeon run so isContentCleared passes
    await prisma.dungeonRun.create({
      data: {
        characterId: f.characterId,
        templateKey: 'test_dungeon',
        status: 'COMPLETED',
        startedAt: NOW,
      },
    });
    // Character has 0 tienNgocKhoa — should fail
    await expect(
      sweepTicket.useTicket({
        characterId: f.characterId,
        ticketKey: 'sweep_ticket',
        contentType: 'DUNGEON',
        contentKey: 'test_dungeon',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CURRENCY' });
  });
});

describe('ExtraAttemptService.buyExtraAttempt', () => {
  it('throws INVALID_INPUT for unknown limit key', async () => {
    const f = await makeUserChar(prisma);
    await expect(
      extraAttempt.buyExtraAttempt({
        characterId: f.characterId,
        limitKey: 'nonexistent_limit_xyz',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('throws INSUFFICIENT_CURRENCY when not enough tienNgocKhoa', async () => {
    const f = await makeUserChar(prisma);
    // Find a valid limit key from shared catalog
    const { EXTRA_ATTEMPT_LIMITS } = await import('@xuantoi/shared');
    const def = EXTRA_ATTEMPT_LIMITS[0];
    if (!def) return; // skip if no limits configured

    // Character has 0 tienNgocKhoa — should fail
    await expect(
      extraAttempt.buyExtraAttempt({
        characterId: f.characterId,
        limitKey: def.key,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_CURRENCY' });
  });
});

describe('ExtraAttemptService.getState', () => {
  it('returns empty state for fresh character', async () => {
    const f = await makeUserChar(prisma);
    const state = await extraAttempt.getState(f.characterId, NOW);
    expect(Array.isArray(state)).toBe(true);
    // All entries should have usedCount = 0
    for (const entry of state) {
      expect(entry.usedCount).toBe(0);
      expect(entry.remaining).toBe(entry.maxCount);
    }
  });
});
