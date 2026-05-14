import { CurrencyKind } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import {
  CLAIM_ONLY_LEDGER_REASONS,
  checkAdminGrantPolicy,
  checkMailClaimDuplicates,
  checkRewardLogDuplicates,
  checkSystemGiftDuplicates,
  extractMetaReason,
  runEconomyIntegrityAudit,
} from './economy-integrity-audit';

/**
 * Phase 44.0 — Integration tests cho economy-integrity-audit.ts.
 *
 * Strategy: insert raw rows trực tiếp qua Prisma client để giả lập
 * scenarios duplicate/violation (bypass service-level guards), rồi
 * verify audit phát hiện đúng.
 */

let prisma: PrismaService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('extractMetaReason', () => {
  it('extract reason from valid meta', () => {
    expect(extractMetaReason({ reason: 'test reason' })).toBe('test reason');
  });

  it('return null cho missing / null / array', () => {
    expect(extractMetaReason(null)).toBeNull();
    expect(extractMetaReason(undefined)).toBeNull();
    expect(extractMetaReason([])).toBeNull();
    expect(extractMetaReason({ other: 'x' })).toBeNull();
    expect(extractMetaReason({ reason: 123 })).toBeNull();
  });
});

describe('checkMailClaimDuplicates', () => {
  it('clean DB → no findings', async () => {
    const r = await checkMailClaimDuplicates(prisma);
    expect(r).toEqual([]);
  });
});

describe('checkSystemGiftDuplicates', () => {
  it('clean DB → no findings', async () => {
    const r = await checkSystemGiftDuplicates(prisma);
    expect(r).toEqual([]);
  });
});

describe('checkRewardLogDuplicates — clean & duplicate cases', () => {
  it('clean: 1 MAIL_CLAIM row / (char,currency,refType,refId) → no findings', async () => {
    const u = await makeUserChar(prisma);
    await prisma.currencyLedger.create({
      data: {
        characterId: u.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 100n,
        reason: 'MAIL_CLAIM',
        refType: 'MAIL',
        refId: 'mail_clean_1',
      },
    });
    const r = await checkRewardLogDuplicates(prisma);
    expect(r).toEqual([]);
  });

  it('flag duplicate MAIL_CLAIM trên cùng (refType,refId,currency)', async () => {
    const u = await makeUserChar(prisma);
    // Bypass service: tạo 2 row trùng để giả lập invariant break.
    await prisma.currencyLedger.create({
      data: {
        characterId: u.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 100n,
        reason: 'MAIL_CLAIM',
        refType: 'MAIL',
        refId: 'mail_dup_1',
      },
    });
    await prisma.currencyLedger.create({
      data: {
        characterId: u.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 100n,
        reason: 'MAIL_CLAIM',
        refType: 'MAIL',
        refId: 'mail_dup_1',
      },
    });
    const r = await checkRewardLogDuplicates(prisma);
    expect(r.length).toBe(1);
    expect(r[0].code).toBe('REWARD_LOG_DUPLICATE');
    expect(r[0].severity).toBe('ERROR');
    expect((r[0].count ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('không flag MAIL_CLAIM với refType/refId NULL (sanity)', async () => {
    const u = await makeUserChar(prisma);
    await prisma.currencyLedger.create({
      data: {
        characterId: u.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 1n,
        reason: 'MAIL_CLAIM',
      },
    });
    await prisma.currencyLedger.create({
      data: {
        characterId: u.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 1n,
        reason: 'MAIL_CLAIM',
      },
    });
    const r = await checkRewardLogDuplicates(prisma);
    expect(r).toEqual([]);
  });

  it('cùng refId nhưng khác currency → KHÔNG flag (mail có cả linh thạch + tiên ngọc)', async () => {
    const u = await makeUserChar(prisma);
    await prisma.currencyLedger.create({
      data: {
        characterId: u.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 100n,
        reason: 'MAIL_CLAIM',
        refType: 'MAIL',
        refId: 'mail_mixed_1',
      },
    });
    await prisma.currencyLedger.create({
      data: {
        characterId: u.characterId,
        currency: CurrencyKind.TIEN_NGOC,
        delta: 50n,
        reason: 'MAIL_CLAIM',
        refType: 'MAIL',
        refId: 'mail_mixed_1',
      },
    });
    const r = await checkRewardLogDuplicates(prisma);
    expect(r).toEqual([]);
  });

  it('flag duplicate cho mọi CLAIM_ONLY reason', async () => {
    const u = await makeUserChar(prisma);
    // Chỉ test 1 reason đại diện, không lặp 14 lần — config-driven scope.
    expect(CLAIM_ONLY_LEDGER_REASONS).toContain('QUEST_CLAIM');
    await prisma.currencyLedger.create({
      data: {
        characterId: u.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 50n,
        reason: 'QUEST_CLAIM',
        refType: 'Quest',
        refId: 'quest_dup_1',
      },
    });
    await prisma.currencyLedger.create({
      data: {
        characterId: u.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 50n,
        reason: 'QUEST_CLAIM',
        refType: 'Quest',
        refId: 'quest_dup_1',
      },
    });
    const r = await checkRewardLogDuplicates(prisma);
    expect(r.length).toBe(1);
    expect(r[0].code).toBe('REWARD_LOG_DUPLICATE');
  });
});

describe('checkAdminGrantPolicy', () => {
  it('clean: grant với reason hợp lệ → no findings', async () => {
    const u = await makeUserChar(prisma);
    await prisma.currencyLedger.create({
      data: {
        characterId: u.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 100n,
        reason: 'ADMIN_GRANT',
        refType: 'User',
        refId: u.userId,
        actorUserId: u.userId,
        meta: { reason: 'Hoàn tiền bug Phase 32' },
      },
    });
    const r = await checkAdminGrantPolicy(prisma);
    expect(r).toEqual([]);
  });

  it('flag admin grant với meta.reason rỗng (empty string)', async () => {
    const u = await makeUserChar(prisma);
    await prisma.currencyLedger.create({
      data: {
        characterId: u.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 100n,
        reason: 'ADMIN_GRANT',
        meta: { reason: '' },
        actorUserId: u.userId,
      },
    });
    const r = await checkAdminGrantPolicy(prisma);
    expect(r.length).toBeGreaterThan(0);
    expect(r.some((f) => f.code === 'ADMIN_GRANT_REASON_MISSING_OR_SHORT')).toBe(true);
  });

  it('flag admin grant với meta missing reason field', async () => {
    const u = await makeUserChar(prisma);
    await prisma.currencyLedger.create({
      data: {
        characterId: u.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 100n,
        reason: 'ADMIN_GRANT',
        meta: {},
        actorUserId: u.userId,
      },
    });
    const r = await checkAdminGrantPolicy(prisma);
    expect(r.some((f) => f.code === 'ADMIN_GRANT_REASON_MISSING_OR_SHORT')).toBe(true);
  });

  it('flag admin grant với linhThach vượt cap (defensive)', async () => {
    const u = await makeUserChar(prisma);
    // Bypass admin service: insert raw row vượt cap để verify audit catch.
    await prisma.currencyLedger.create({
      data: {
        characterId: u.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 2_000_000_000n, // 2 tỷ > 1 tỷ cap
        reason: 'ADMIN_GRANT',
        meta: { reason: 'compromised admin?' },
        actorUserId: u.userId,
      },
    });
    const r = await checkAdminGrantPolicy(prisma);
    expect(r.some((f) => f.code === 'ADMIN_GRANT_LINH_THACH_OVER_POLICY')).toBe(true);
  });

  it('flag admin grant với tienNgoc vượt cap (defensive)', async () => {
    const u = await makeUserChar(prisma);
    await prisma.currencyLedger.create({
      data: {
        characterId: u.characterId,
        currency: CurrencyKind.TIEN_NGOC,
        delta: 5_000_000n, // > 1 triệu cap
        reason: 'ADMIN_GRANT',
        meta: { reason: 'compromised admin?' },
        actorUserId: u.userId,
      },
    });
    const r = await checkAdminGrantPolicy(prisma);
    expect(r.some((f) => f.code === 'ADMIN_GRANT_TIEN_NGOC_OVER_POLICY')).toBe(true);
  });

  it('respect sinceDays window (default 90)', async () => {
    const u = await makeUserChar(prisma);
    // Insert old row vi phạm cap, override createdAt qua updateMany sau.
    const row = await prisma.currencyLedger.create({
      data: {
        characterId: u.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 2_000_000_000n,
        reason: 'ADMIN_GRANT',
        meta: { reason: 'ancient violation' },
        actorUserId: u.userId,
      },
    });
    // Backdate beyond 90d window.
    await prisma.currencyLedger.update({
      where: { id: row.id },
      data: { createdAt: new Date(Date.now() - 200 * 24 * 3600 * 1000) },
    });
    const r = await checkAdminGrantPolicy(prisma, { sinceDays: 30 });
    expect(r).toEqual([]);
  });
});

describe('runEconomyIntegrityAudit — aggregate', () => {
  it('clean DB → totalIssueCount=0', async () => {
    const r = await runEconomyIntegrityAudit(prisma);
    expect(r.findings).toEqual([]);
    expect(r.totalIssueCount).toBe(0);
    expect(typeof r.runAt).toBe('string');
  });

  it('gộp nhiều issue từ scopes khác nhau', async () => {
    const u = await makeUserChar(prisma);
    // Bad admin grant + duplicate reward log
    await prisma.currencyLedger.create({
      data: {
        characterId: u.characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: 100n,
        reason: 'ADMIN_GRANT',
        meta: { reason: '' },
        actorUserId: u.userId,
      },
    });
    await prisma.currencyLedger.createMany({
      data: [
        {
          characterId: u.characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: 50n,
          reason: 'MAIL_CLAIM',
          refType: 'MAIL',
          refId: 'mail_agg_dup',
        },
        {
          characterId: u.characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: 50n,
          reason: 'MAIL_CLAIM',
          refType: 'MAIL',
          refId: 'mail_agg_dup',
        },
      ],
    });
    const r = await runEconomyIntegrityAudit(prisma);
    expect(r.findings.length).toBeGreaterThanOrEqual(2);
    const codes = r.findings.map((f) => f.code);
    expect(codes).toContain('ADMIN_GRANT_REASON_MISSING_OR_SHORT');
    expect(codes).toContain('REWARD_LOG_DUPLICATE');
    expect(r.totalIssueCount).toBeGreaterThanOrEqual(2);
  });
});
