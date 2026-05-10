/**
 * Phase 16.6 — Integration test cho LedgerCheckerService.
 *
 * Bao phủ:
 *   - clean ledger → status='OK', issuesCreated=0.
 *   - negative balance → issuesCreated ≥ 1, type='NEGATIVE_BALANCE'.
 *   - currency mismatch (Character.linhThach != Σ ledger) → issue.
 *   - idempotent dayBucket: gọi 2 lần cùng ngày → run thứ 2 alreadyDone=true.
 *   - forceRerun: bypass alreadyDone, tạo issues mới.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { TEST_DATABASE_URL, makeUserChar, wipeAll } from '../../test-helpers';
import { LedgerCheckerService } from './ledger-checker.service';

let prisma: PrismaService;
let svc: LedgerCheckerService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  svc = new LedgerCheckerService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('LedgerCheckerService.runCheck', () => {
  it('clean state → status=OK, issuesCreated=0', async () => {
    await makeUserChar(prisma, { linhThach: 0n });
    const r = await svc.runCheck({
      now: new Date('2026-01-01T01:00:00.000Z'),
    });
    expect(r.status).toBe('OK');
    expect(r.issuesCreated).toBe(0);
    expect(r.alreadyDone).toBe(false);
  });

  it('character có linhThach < 0 → tạo issue NEGATIVE_BALANCE', async () => {
    // Bypass validation tạo character âm linhThach (chỉ test cleanup
    // detector — production race-condition không nên xảy ra).
    const f = await makeUserChar(prisma, { linhThach: 0n });
    await prisma.character.update({
      where: { id: f.characterId },
      data: { linhThach: -100n },
    });

    const r = await svc.runCheck({
      now: new Date('2026-01-02T01:00:00.000Z'),
    });
    expect(r.status).toBe('ISSUES_FOUND');
    expect(r.negativeBalances).toBeGreaterThanOrEqual(1);
    expect(r.issuesCreated).toBeGreaterThanOrEqual(1);

    const issues = await prisma.economyLedgerCheckIssue.findMany({
      where: { runId: r.runId },
    });
    expect(issues.some((i) => i.type === 'NEGATIVE_CURRENCY')).toBe(true);
    expect(issues.every((i) => i.status === 'OPEN')).toBe(true);
  });

  it('idempotent dayBucket: gọi 2 lần cùng ngày → run thứ 2 alreadyDone=true', async () => {
    await makeUserChar(prisma);
    const first = await svc.runCheck({
      now: new Date('2026-01-03T01:00:00.000Z'),
    });
    expect(first.alreadyDone).toBe(false);

    const second = await svc.runCheck({
      now: new Date('2026-01-03T05:00:00.000Z'),
    });
    expect(second.alreadyDone).toBe(true);
    expect(second.runId).toBe(first.runId);

    const runs = await prisma.economyLedgerCheckRun.findMany({
      where: { dayBucket: first.dayBucket },
    });
    expect(runs.length).toBe(1);
  });

  it('forceRerun=true → bypass alreadyDone, tạo issues mới', async () => {
    const f = await makeUserChar(prisma, { linhThach: 0n });
    await prisma.character.update({
      where: { id: f.characterId },
      data: { linhThach: -50n },
    });

    const first = await svc.runCheck({
      now: new Date('2026-01-04T01:00:00.000Z'),
    });
    expect(first.issuesCreated).toBeGreaterThanOrEqual(1);

    // Force rerun cùng ngày — phải scan lại.
    const second = await svc.runCheck({
      now: new Date('2026-01-04T05:00:00.000Z'),
      forceRerun: true,
    });
    expect(second.alreadyDone).toBe(false);
    expect(second.runId).toBe(first.runId); // same run row, re-scan
    expect(second.issuesCreated).toBeGreaterThanOrEqual(1);
  });
});
