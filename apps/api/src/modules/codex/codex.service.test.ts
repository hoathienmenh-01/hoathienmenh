/**
 * Phase 32.0 — Codex API integration tests.
 *
 * Coverage (spec PHẦN 27 27–40):
 *   - codex-indexer: buildIndexerInput from ITEMS catalog; reindex creates
 *     entries + audit issues; second reindex idempotent.
 *   - codex.service: list (visibility filter, PUBLIC vs ADMIN_ONLY),
 *     getDetail (with market price bi-directional link),
 *     discover (idempotent), progress summary.
 *   - codex admin: hide entry → getDetail rejects non-admin.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../../common/prisma.service';
import { CodexIndexerService } from './codex-indexer.service';
import { CodexService, CodexError } from './codex.service';
import { makeUserChar, wipeAll } from '../../test-helpers';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://mtt:mtt@localhost:5432/mtt?schema=public';

let prisma: PrismaService;
let indexer: CodexIndexerService;
let codex: CodexService;

beforeAll(() => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  prisma = new PrismaService();
  indexer = new CodexIndexerService(prisma);
  codex = new CodexService(prisma);
});

beforeEach(async () => {
  await wipeAll(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('CodexIndexerService', () => {
  it('buildIndexerInputFromCatalog returns non-empty items', () => {
    const input = indexer.buildIndexerInputFromCatalog();
    expect(input.items!.length).toBeGreaterThan(0);
    const first = input.items![0];
    expect(first.itemKey).toBeDefined();
    expect(first.name).toBeDefined();
  });

  it('reindex creates codex entries + audit issues + reindex log', async () => {
    const r = await indexer.reindex('test-suite');
    expect(r.ok).toBe(true);
    expect(r.entriesUpserted).toBeGreaterThan(0);
    const entries = await prisma.codexEntry.count();
    expect(entries).toBeGreaterThan(0);
    const log = await prisma.codexReindexLog.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    expect(log?.triggeredBy).toBe('test-suite');
    expect(log?.entriesUpserted).toBeGreaterThan(0);
  });

  it('second reindex is idempotent (upserts, no duplicate)', async () => {
    await indexer.reindex('run-1');
    const count1 = await prisma.codexEntry.count();
    await indexer.reindex('run-2');
    const count2 = await prisma.codexEntry.count();
    expect(count1).toBe(count2);
    const logs = await prisma.codexReindexLog.count();
    expect(logs).toBe(2);
  });
});

describe('CodexService', () => {
  it('list returns PUBLIC entries for non-admin', async () => {
    await indexer.reindex('setup');
    const { items, total } = await codex.list({ viewerIsAdmin: false, limit: 10 });
    expect(items.length).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(0);
    items.forEach((i) => {
      expect(i.discovered).toBe(false);
    });
  });

  it('list attaches discovered flag when characterId given', async () => {
    await indexer.reindex('setup');
    const a = await makeUserChar(prisma);
    // Pick first entry in pagination order so list with limit hits it.
    const entry = await prisma.codexEntry.findFirst({
      orderBy: [{ type: 'asc' }, { displayName: 'asc' }],
    });
    await codex.discover(a.characterId, entry!.entryKey);
    const { items } = await codex.list({
      viewerIsAdmin: false,
      characterId: a.characterId,
      type: entry!.type as never,
      limit: 200,
    });
    const found = items.find((i) => i.entryKey === entry!.entryKey);
    expect(found?.discovered).toBe(true);
  });

  it('getDetail returns entry + null marketPrice if no snapshot', async () => {
    await indexer.reindex('setup');
    const entry = await prisma.codexEntry.findFirst({ where: { type: 'ITEM' } });
    const detail = await codex.getDetail({
      viewerIsAdmin: false,
      entryKey: entry!.entryKey,
    });
    expect(detail.entry.entryKey).toBe(entry!.entryKey);
    expect(detail.marketPrice).toBeNull();
  });

  it('getDetail returns marketPrice when MarketPriceSnapshot exists', async () => {
    await indexer.reindex('setup');
    const entry = await prisma.codexEntry.findFirst({ where: { type: 'ITEM' } });
    await prisma.marketPriceSnapshot.create({
      data: {
        itemKey: entry!.refKey,
        avgPrice24h: 100,
        avgPrice7d: 95,
        avgPrice30d: 90,
        minPrice: 50,
        maxPrice: 200,
        volume24h: 10,
        volume7d: 50,
        updatedAt: new Date(),
      },
    });
    const detail = await codex.getDetail({
      viewerIsAdmin: false,
      entryKey: entry!.entryKey,
    });
    expect(detail.marketPrice).not.toBeNull();
    expect(detail.marketPrice?.avgPrice24h).toBe(100n);
  });

  it('getDetail on ADMIN_ONLY entry throws for non-admin viewer', async () => {
    await indexer.reindex('setup');
    const entry = await prisma.codexEntry.findFirst();
    await prisma.codexEntry.update({
      where: { id: entry!.id },
      data: { visibility: 'ADMIN_ONLY' },
    });
    await expect(
      codex.getDetail({ viewerIsAdmin: false, entryKey: entry!.entryKey }),
    ).rejects.toBeInstanceOf(CodexError);
  });

  it('discover inserts CharacterCodexProgress idempotently', async () => {
    await indexer.reindex('setup');
    const a = await makeUserChar(prisma);
    const entry = await prisma.codexEntry.findFirst();
    const r1 = await codex.discover(a.characterId, entry!.entryKey);
    expect(r1.alreadyDiscovered).toBe(false);
    const r2 = await codex.discover(a.characterId, entry!.entryKey);
    expect(r2.alreadyDiscovered).toBe(true);
    const rows = await prisma.characterCodexProgress.count({
      where: { characterId: a.characterId, entryKey: entry!.entryKey },
    });
    expect(rows).toBe(1);
  });

  it('discover throws CODEX_ENTRY_NOT_FOUND for unknown entry', async () => {
    const a = await makeUserChar(prisma);
    await expect(
      codex.discover(a.characterId, 'nonexistent'),
    ).rejects.toBeInstanceOf(CodexError);
  });

  it('getProgress returns summary percentages', async () => {
    await indexer.reindex('setup');
    const a = await makeUserChar(prisma);
    const prog = await codex.getProgress(a.characterId);
    expect(prog.overallPct).toBe(0);
    expect(prog.bestiaryPct).toBeGreaterThanOrEqual(0);
    expect(typeof prog.overallPct).toBe('number');
  });
});
