import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PLAYER_REPORT_LIMITS,
  type AdminPlayerReportPatchInput,
  type PlayerReportListResponse,
  type PlayerReportRow,
  type PlayerReportStatus,
  validateAdminPlayerReportPatch,
  validatePlayerReportInput,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 41.0 — Player Report service (player → player) foundation.
 *
 * KHÔNG auto-ban. KHÔNG modify victim/target balance. Chỉ ghi DB +
 * cho phép MOD/ADMIN review.
 *
 * Anti-spam: cap mỗi reporter
 *   - `USER_OPEN_CAP_TOTAL` NEW report cùng lúc.
 *   - `USER_OPEN_CAP_PER_TARGET` NEW report cùng target.
 *
 * Reporter không được report chính mình.
 */
const ACTIVE_STATUSES = ['NEW', 'REVIEWING'] as const;

export class PlayerReportError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'REPORT_NOT_FOUND'
      | 'REPORT_VALIDATION_FAILED'
      | 'REPORT_RATE_LIMITED'
      | 'REPORT_TARGET_NOT_FOUND'
      | 'REPORT_SELF_NOT_ALLOWED'
      | 'SUPPORT_PERMISSION_DENIED',
    public detail?: readonly string[],
  ) {
    super(code);
  }
}

interface ListParams {
  cursor?: string | null;
  limit?: number;
  status?: PlayerReportStatus | null;
  targetCharacterId?: string | null;
}

@Injectable()
export class PlayerReportService {
  constructor(private readonly prisma: PrismaService) {}

  private async characterIdOf(userId: string): Promise<string> {
    const c = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!c) throw new PlayerReportError('NO_CHARACTER');
    return c.id;
  }

  async create(userId: string, input: unknown): Promise<PlayerReportRow> {
    const characterId = await this.characterIdOf(userId);
    const v = validatePlayerReportInput(input);
    if (!v.ok || !v.sanitized) {
      throw new PlayerReportError('REPORT_VALIDATION_FAILED', v.errors);
    }
    if (v.sanitized.targetCharacterId === characterId) {
      throw new PlayerReportError('REPORT_SELF_NOT_ALLOWED');
    }
    const target = await this.prisma.character.findUnique({
      where: { id: v.sanitized.targetCharacterId },
      select: { id: true, name: true },
    });
    if (!target) throw new PlayerReportError('REPORT_TARGET_NOT_FOUND');

    const [openTotal, openVsTarget] = await Promise.all([
      this.prisma.playerReport.count({
        where: {
          reporterCharacterId: characterId,
          status: { in: ACTIVE_STATUSES as unknown as string[] },
        },
      }),
      this.prisma.playerReport.count({
        where: {
          reporterCharacterId: characterId,
          targetCharacterId: target.id,
          status: { in: ACTIVE_STATUSES as unknown as string[] },
        },
      }),
    ]);
    if (openTotal >= PLAYER_REPORT_LIMITS.USER_OPEN_CAP_TOTAL) {
      throw new PlayerReportError('REPORT_RATE_LIMITED');
    }
    if (openVsTarget >= PLAYER_REPORT_LIMITS.USER_OPEN_CAP_PER_TARGET) {
      throw new PlayerReportError('REPORT_RATE_LIMITED');
    }

    const created = await this.prisma.playerReport.create({
      data: {
        reporterCharacterId: characterId,
        targetCharacterId: target.id,
        reportType: v.sanitized.reportType,
        description: v.sanitized.description,
        evidenceJson:
          v.sanitized.evidenceJson === null
            ? Prisma.DbNull
            : (v.sanitized.evidenceJson as unknown as Prisma.InputJsonValue),
      },
    });
    return this.toRow(created, {
      reporterName: await this.nameOf(characterId),
      targetName: target.name,
    });
  }

  async listForUser(
    userId: string,
    params: ListParams,
  ): Promise<PlayerReportListResponse> {
    const characterId = await this.characterIdOf(userId);
    return this.listInternal({ reporterCharacterId: characterId }, params);
  }

  async getForUser(userId: string, id: string): Promise<PlayerReportRow> {
    const characterId = await this.characterIdOf(userId);
    const row = await this.prisma.playerReport.findUnique({ where: { id } });
    if (!row) throw new PlayerReportError('REPORT_NOT_FOUND');
    if (row.reporterCharacterId !== characterId) {
      throw new PlayerReportError('SUPPORT_PERMISSION_DENIED');
    }
    return this.toRow(row, {
      reporterName: await this.nameOf(characterId),
      targetName: await this.nameOf(row.targetCharacterId),
    });
  }

  async adminList(params: ListParams): Promise<PlayerReportListResponse> {
    const where: Prisma.PlayerReportWhereInput = {};
    if (params.targetCharacterId) where.targetCharacterId = params.targetCharacterId;
    return this.listInternal(where, params);
  }

  async adminGet(id: string): Promise<PlayerReportRow> {
    const row = await this.prisma.playerReport.findUnique({ where: { id } });
    if (!row) throw new PlayerReportError('REPORT_NOT_FOUND');
    return this.toRow(row, {
      reporterName: await this.nameOf(row.reporterCharacterId),
      targetName: await this.nameOf(row.targetCharacterId),
    });
  }

  async adminPatch(
    id: string,
    patch: unknown,
  ): Promise<PlayerReportRow> {
    const v = validateAdminPlayerReportPatch(patch);
    if (!v.ok) throw new PlayerReportError('REPORT_VALIDATION_FAILED', v.errors);
    const sanitized = v.sanitized as AdminPlayerReportPatchInput;
    const row = await this.prisma.playerReport.findUnique({ where: { id } });
    if (!row) throw new PlayerReportError('REPORT_NOT_FOUND');
    const update: Prisma.PlayerReportUpdateInput = {};
    if (sanitized.status !== undefined) {
      update.status = sanitized.status;
      if (
        (sanitized.status === 'ACTION_TAKEN' ||
          sanitized.status === 'DISMISSED' ||
          sanitized.status === 'DUPLICATE') &&
        !row.resolvedAt
      ) {
        update.resolvedAt = new Date();
      }
    }
    if (sanitized.adminNote !== undefined) update.adminNote = sanitized.adminNote;
    const updated = await this.prisma.playerReport.update({
      where: { id },
      data: update,
    });
    return this.toRow(updated, {
      reporterName: await this.nameOf(updated.reporterCharacterId),
      targetName: await this.nameOf(updated.targetCharacterId),
    });
  }

  private async listInternal(
    extraWhere: Prisma.PlayerReportWhereInput,
    params: ListParams,
  ): Promise<PlayerReportListResponse> {
    const limit = Math.min(
      Math.max(params.limit ?? PLAYER_REPORT_LIMITS.LIST_PAGE_DEFAULT, 1),
      PLAYER_REPORT_LIMITS.LIST_PAGE_MAX,
    );
    const where: Prisma.PlayerReportWhereInput = { ...extraWhere };
    if (params.status) where.status = params.status;
    if (params.cursor) {
      const cursorDate = new Date(params.cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        where.createdAt = { lt: cursorDate };
      }
    }
    const rows = await this.prisma.playerReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const sliced = rows.slice(0, limit);
    const total = await this.prisma.playerReport.count({ where: extraWhere });
    const ids = new Set<string>();
    sliced.forEach((r) => {
      ids.add(r.reporterCharacterId);
      ids.add(r.targetCharacterId);
    });
    const nameMap = await this.namesOf(Array.from(ids));
    return {
      reports: sliced.map((r) =>
        this.toRow(r, {
          reporterName: nameMap.get(r.reporterCharacterId) ?? null,
          targetName: nameMap.get(r.targetCharacterId) ?? null,
        }),
      ),
      total,
      nextCursor: rows.length > limit ? sliced[sliced.length - 1].createdAt.toISOString() : null,
    };
  }

  private async nameOf(characterId: string): Promise<string | null> {
    const c = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { name: true },
    });
    return c?.name ?? null;
  }

  private async namesOf(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.character.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private toRow(
    row: {
      id: string;
      reporterCharacterId: string;
      targetCharacterId: string;
      reportType: string;
      status: string;
      description: string;
      evidenceJson: Prisma.JsonValue | null;
      adminNote: string | null;
      createdAt: Date;
      updatedAt: Date;
      resolvedAt: Date | null;
    },
    opt: { reporterName: string | null; targetName: string | null },
  ): PlayerReportRow {
    let evidence: Record<string, unknown> | null = null;
    if (
      row.evidenceJson &&
      typeof row.evidenceJson === 'object' &&
      !Array.isArray(row.evidenceJson)
    ) {
      evidence = row.evidenceJson as Record<string, unknown>;
    }
    return {
      id: row.id,
      reporterCharacterId: row.reporterCharacterId,
      reporterDisplayName: opt.reporterName,
      targetCharacterId: row.targetCharacterId,
      targetDisplayName: opt.targetName,
      reportType: row.reportType as PlayerReportRow['reportType'],
      status: row.status as PlayerReportStatus,
      description: row.description,
      evidenceJson: evidence,
      adminNote: row.adminNote,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    };
  }
}
