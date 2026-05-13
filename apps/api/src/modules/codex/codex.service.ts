/**
 * Phase 32.0 — Codex Service.
 *
 * Player-facing read: list entries (filter type / quality / tier),
 * detail entry (with discovery state + market price reference),
 * discover entry (idempotent insert into `CharacterCodexProgress`).
 *
 * Bi-directional link với Market V2: detail kèm `marketPrice` từ
 * `MarketPriceSnapshot` (nullable).
 */
import { Injectable } from '@nestjs/common';
import { isEntryVisible, summarizeCodexProgress, type CodexEntryType } from '@xuantoi/shared';

import { PrismaService } from '../../common/prisma.service';

export class CodexError extends Error {
  constructor(public code: 'CODEX_ENTRY_NOT_FOUND' | 'CODEX_ENTRY_NOT_VISIBLE') {
    super(code);
  }
}

@Injectable()
export class CodexService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List entries cho player (filter by visibility). Admin caller có
   * thể bypass bằng cách set `viewerIsAdmin=true`.
   */
  async list(opts: {
    viewerIsAdmin: boolean;
    characterId?: string;
    type?: CodexEntryType;
    limit?: number;
    offset?: number;
  }) {
    const where: {
      type?: CodexEntryType;
      visibility?: { in: string[] };
    } = {};
    if (opts.type) where.type = opts.type;
    if (!opts.viewerIsAdmin) {
      where.visibility = { in: ['PUBLIC', 'DISCOVERED_ONLY', 'HIDDEN_UNTIL_DISCOVERED'] };
    }
    const limit = Math.min(opts.limit ?? 50, 200);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.codexEntry.findMany({
        where,
        orderBy: [{ type: 'asc' }, { displayName: 'asc' }],
        take: limit,
        skip: opts.offset ?? 0,
      }),
      this.prisma.codexEntry.count({ where }),
    ]);

    // If a characterId provided, attach discovered flag.
    let discoveredKeys = new Set<string>();
    if (opts.characterId) {
      const progress = await this.prisma.characterCodexProgress.findMany({
        where: {
          characterId: opts.characterId,
          entryKey: { in: rows.map((r) => r.entryKey) },
        },
        select: { entryKey: true },
      });
      discoveredKeys = new Set(progress.map((p) => p.entryKey));
    }
    return {
      items: rows
        .map((r) => ({
          ...r,
          discovered: discoveredKeys.has(r.entryKey),
        }))
        .filter((r) =>
          isEntryVisible(
            {
              entryKey: r.entryKey,
              type: r.type as CodexEntryType,
              refKey: r.refKey,
              displayName: r.displayName,
              visibility: r.visibility as never,
            },
            { viewerIsAdmin: opts.viewerIsAdmin, discovered: r.discovered },
          ),
        ),
      total,
    };
  }

  /**
   * Detail entry kèm market price reference (bi-directional linking).
   */
  async getDetail(opts: {
    viewerIsAdmin: boolean;
    characterId?: string;
    entryKey: string;
  }) {
    const entry = await this.prisma.codexEntry.findUnique({
      where: { entryKey: opts.entryKey },
    });
    if (!entry) throw new CodexError('CODEX_ENTRY_NOT_FOUND');

    let discovered = false;
    if (opts.characterId) {
      const progress = await this.prisma.characterCodexProgress.findUnique({
        where: {
          characterId_entryKey: {
            characterId: opts.characterId,
            entryKey: opts.entryKey,
          },
        },
      });
      discovered = !!progress;
    }
    if (
      !isEntryVisible(
        {
          entryKey: entry.entryKey,
          type: entry.type as CodexEntryType,
          refKey: entry.refKey,
          displayName: entry.displayName,
          visibility: entry.visibility as never,
        },
        { viewerIsAdmin: opts.viewerIsAdmin, discovered },
      )
    ) {
      throw new CodexError('CODEX_ENTRY_NOT_VISIBLE');
    }

    // Market price reference (only for ITEM-like entries).
    let marketPrice = null;
    if (
      ['ITEM', 'MATERIAL', 'PILL', 'EQUIPMENT', 'ARTIFACT'].includes(entry.type)
    ) {
      marketPrice = await this.prisma.marketPriceSnapshot.findUnique({
        where: { itemKey: entry.refKey },
      });
    }

    return { entry: { ...entry, discovered }, marketPrice };
  }

  /**
   * Idempotent discover. KHÔNG generate reward — chỉ insert progress.
   */
  async discover(characterId: string, entryKey: string, context?: string) {
    const entry = await this.prisma.codexEntry.findUnique({ where: { entryKey } });
    if (!entry) throw new CodexError('CODEX_ENTRY_NOT_FOUND');
    try {
      await this.prisma.characterCodexProgress.create({
        data: { characterId, entryKey, context },
      });
      return { discovered: true, alreadyDiscovered: false };
    } catch {
      return { discovered: true, alreadyDiscovered: true };
    }
  }

  async getProgress(characterId: string) {
    const [totalEntries, discoveredEntries, totalBestiary, discoveredBestiary] =
      await this.prisma.$transaction([
        this.prisma.codexEntry.count({
          where: { visibility: { in: ['PUBLIC', 'DISCOVERED_ONLY', 'HIDDEN_UNTIL_DISCOVERED'] } },
        }),
        this.prisma.characterCodexProgress.count({ where: { characterId } }),
        this.prisma.codexEntry.count({
          where: {
            type: {
              in: [
                'MONSTER',
                'ELITE_MONSTER',
                'BOSS',
                'WORLD_BOSS',
                'EVENT_BOSS',
                'SECT_BOSS',
              ],
            },
            visibility: { in: ['PUBLIC', 'DISCOVERED_ONLY', 'HIDDEN_UNTIL_DISCOVERED'] },
          },
        }),
        this.prisma.characterCodexProgress.count({
          where: {
            characterId,
            entryKey: { startsWith: 'monster:' },
          },
        }),
      ]);
    return summarizeCodexProgress({
      totalEntries,
      discoveredEntries,
      totalBestiary,
      discoveredBestiary,
    });
  }
}
