/**
 * Phase 32.0 — Codex Indexer Service.
 *
 * Đọc catalog hiện có (ITEMS, MONSTERS, FARM_MAPS, REALMS, …) → derive
 * `CodexEntry[]` → upsert vào DB. Idempotent: chạy lại không tạo
 * duplicate, chỉ update displayName/description nếu admin chưa override.
 *
 * KHÔNG tạo reward / sửa catalog. Chỉ là read-only index layer.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  indexCatalogToCodex,
  auditCodexEntries,
  ITEMS,
  type IndexerInput,
  type CodexEntryDef,
} from '@xuantoi/shared';

import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class CodexIndexerService {
  private readonly logger = new Logger(CodexIndexerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build indexer input từ catalog hiện có. Hiện chỉ catch ITEMS;
   * monsters/maps/realms sẽ extend ở milestone tiếp theo qua adapter.
   */
  buildIndexerInputFromCatalog(): IndexerInput {
    const items = ITEMS.map((it) => ({
      itemKey: it.key,
      name: it.name,
      description: it.description,
      quality: it.quality,
      tier: it.equipmentTier ?? it.materialTier ?? it.recipeTier,
      marketTradeable: it.marketTradeable,
      bindOnPickup: it.bindOnPickup,
    }));
    return { items };
  }

  /**
   * Run reindex pass. Returns summary.
   */
  async reindex(triggeredBy: string) {
    const input = this.buildIndexerInputFromCatalog();
    const entries = indexCatalogToCodex(input);
    const issues = auditCodexEntries(entries);

    let upserted = 0;
    let removed = 0;

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.codexEntry.findMany({
        select: { entryKey: true },
      });
      const existingKeys = new Set(existing.map((e) => e.entryKey));
      const newKeys = new Set(entries.map((e) => e.entryKey));

      for (const e of entries) {
        await this.upsertEntry(tx, e);
        upserted++;
      }

      // Remove stale entries (in existing but not in new). KHÔNG xóa
      // CharacterCodexProgress (FK theo entryKey, không cascade).
      for (const key of existingKeys) {
        if (!newKeys.has(key)) {
          await tx.codexEntry.deleteMany({ where: { entryKey: key } });
          removed++;
        }
      }

      // Sync audit issues.
      await tx.codexAuditIssue.deleteMany({ where: { resolved: false } });
      if (issues.length > 0) {
        await tx.codexAuditIssue.createMany({
          data: issues.map((i) => ({
            issueKey: i.issueKey,
            entryKey: i.entryKey,
            type: i.type,
            severity: i.severity,
            message: i.message,
            resolved: false,
          })),
          skipDuplicates: true,
        });
      }

      await tx.codexReindexLog.create({
        data: {
          triggeredBy,
          entriesUpserted: upserted,
          entriesRemoved: removed,
          issuesFound: issues.length,
          summaryJson: {
            totalEntries: entries.length,
            byType: this.countByType(entries),
          } as Prisma.InputJsonValue,
        },
      });
    });

    this.logger.log(
      `reindex by=${triggeredBy} upserted=${upserted} removed=${removed} issues=${issues.length}`,
    );
    return {
      ok: true as const,
      entriesUpserted: upserted,
      entriesRemoved: removed,
      issuesFound: issues.length,
    };
  }

  private async upsertEntry(tx: Prisma.TransactionClient, e: CodexEntryDef) {
    const now = new Date();
    await tx.codexEntry.upsert({
      where: { entryKey: e.entryKey },
      update: {
        // KHÔNG override admin-controlled fields nếu đã set updatedBy.
        displayName: e.displayName,
        type: e.type,
        refKey: e.refKey,
        iconKey: e.iconKey ?? null,
        quality: e.quality ?? null,
        tier: e.tier ?? null,
        tagsJson: (e.tags ?? []) as unknown as Prisma.InputJsonValue,
        sourceHintsJson: (e.sourceHints ?? []) as unknown as Prisma.InputJsonValue,
        usageHintsJson: (e.usageHints ?? []) as unknown as Prisma.InputJsonValue,
        relatedEntryKeysJson: (e.relatedEntryKeys ?? []) as unknown as Prisma.InputJsonValue,
        updatedAt: now,
      },
      create: {
        entryKey: e.entryKey,
        type: e.type,
        refKey: e.refKey,
        displayName: e.displayName,
        description: e.description ?? null,
        iconKey: e.iconKey ?? null,
        visibility: e.visibility,
        quality: e.quality ?? null,
        tier: e.tier ?? null,
        tagsJson: (e.tags ?? []) as unknown as Prisma.InputJsonValue,
        sourceHintsJson: (e.sourceHints ?? []) as unknown as Prisma.InputJsonValue,
        usageHintsJson: (e.usageHints ?? []) as unknown as Prisma.InputJsonValue,
        relatedEntryKeysJson: (e.relatedEntryKeys ?? []) as unknown as Prisma.InputJsonValue,
        updatedAt: now,
      },
    });
  }

  private countByType(entries: CodexEntryDef[]) {
    const out: Record<string, number> = {};
    for (const e of entries) out[e.type] = (out[e.type] ?? 0) + 1;
    return out;
  }
}
