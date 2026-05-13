import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  FEEDBACK_LIMITS,
  type AdminFeedbackPatchInput,
  type FeedbackListResponse,
  type FeedbackStatus,
  type PlayerFeedbackRow,
  validateAdminFeedbackPatch,
  validateFeedbackInput,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 41.0 — Player Feedback service.
 *
 * Player flow:
 *   - POST /support/feedback           — tạo feedback (rate-limited soft).
 *   - GET  /support/feedback/my        — feedback của requester.
 *   - GET  /support/feedback/:id       — chi tiết feedback (own only).
 *
 * Admin flow (`AdminGuard`, MOD/ADMIN):
 *   - GET   /admin/support/feedback
 *   - GET   /admin/support/feedback/:id
 *   - PATCH /admin/support/feedback/:id
 *   - POST  /admin/support/feedback/:id/resolve   (status=RESOLVED)
 *   - POST  /admin/support/feedback/:id/close     (status=CLOSED)
 *
 * Anti-spam: cap `USER_OPEN_CAP` feedback ACTIVE (NEW/TRIAGE/IN_PROGRESS)
 * mỗi character. Vượt cap → `FEEDBACK_RATE_LIMITED`.
 *
 * KHÔNG mint reward / auto-ban / send mail. Resolve = set status thôi.
 */
const ACTIVE_STATUSES = ['NEW', 'TRIAGE', 'IN_PROGRESS'] as const;

export class FeedbackError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'FEEDBACK_NOT_FOUND'
      | 'FEEDBACK_VALIDATION_FAILED'
      | 'FEEDBACK_RATE_LIMITED'
      | 'SUPPORT_PERMISSION_DENIED',
    public detail?: readonly string[],
  ) {
    super(code);
  }
}

interface ListParams {
  cursor?: string | null;
  limit?: number;
  status?: FeedbackStatus | null;
  type?: string | null;
}

@Injectable()
export class PlayerFeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  private async characterIdOf(userId: string): Promise<string> {
    const c = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!c) throw new FeedbackError('NO_CHARACTER');
    return c.id;
  }

  async create(userId: string, input: unknown): Promise<PlayerFeedbackRow> {
    const characterId = await this.characterIdOf(userId);
    const v = validateFeedbackInput(input);
    if (!v.ok || !v.sanitized) {
      throw new FeedbackError('FEEDBACK_VALIDATION_FAILED', v.errors);
    }
    const activeCount = await this.prisma.playerFeedback.count({
      where: {
        reporterCharacterId: characterId,
        status: { in: ACTIVE_STATUSES as unknown as string[] },
      },
    });
    if (activeCount >= FEEDBACK_LIMITS.USER_OPEN_CAP) {
      throw new FeedbackError('FEEDBACK_RATE_LIMITED');
    }
    const created = await this.prisma.playerFeedback.create({
      data: {
        reporterCharacterId: characterId,
        type: v.sanitized.type,
        title: v.sanitized.title,
        description: v.sanitized.description,
        severity: v.sanitized.severity ?? 'MEDIUM',
        relatedFeature: v.sanitized.relatedFeature ?? null,
        relatedEntityType: v.sanitized.relatedEntityType ?? null,
        relatedEntityId: v.sanitized.relatedEntityId ?? null,
        targetCharacterId: v.sanitized.targetCharacterId ?? null,
      },
    });
    return this.toRow(created, { reporterName: await this.nameOf(characterId) });
  }

  async listForUser(
    userId: string,
    params: ListParams,
  ): Promise<FeedbackListResponse> {
    const characterId = await this.characterIdOf(userId);
    return this.listInternal({ reporterCharacterId: characterId }, params);
  }

  async getForUser(userId: string, id: string): Promise<PlayerFeedbackRow> {
    const characterId = await this.characterIdOf(userId);
    const row = await this.prisma.playerFeedback.findUnique({
      where: { id },
    });
    if (!row) throw new FeedbackError('FEEDBACK_NOT_FOUND');
    if (row.reporterCharacterId !== characterId) {
      throw new FeedbackError('SUPPORT_PERMISSION_DENIED');
    }
    return this.toRow(row, { reporterName: await this.nameOf(characterId) });
  }

  async adminList(params: ListParams): Promise<FeedbackListResponse> {
    return this.listInternal({}, params);
  }

  async adminGet(id: string): Promise<PlayerFeedbackRow> {
    const row = await this.prisma.playerFeedback.findUnique({
      where: { id },
    });
    if (!row) throw new FeedbackError('FEEDBACK_NOT_FOUND');
    return this.toRow(row, {
      reporterName: await this.nameOf(row.reporterCharacterId),
    });
  }

  async adminPatch(
    id: string,
    patch: unknown,
  ): Promise<PlayerFeedbackRow> {
    const v = validateAdminFeedbackPatch(patch);
    if (!v.ok) throw new FeedbackError('FEEDBACK_VALIDATION_FAILED', v.errors);
    const row = await this.prisma.playerFeedback.findUnique({ where: { id } });
    if (!row) throw new FeedbackError('FEEDBACK_NOT_FOUND');

    const update: Prisma.PlayerFeedbackUpdateInput = {};
    const sanitized = v.sanitized as AdminFeedbackPatchInput;
    if (sanitized.status !== undefined) {
      update.status = sanitized.status;
      if (sanitized.status === 'RESOLVED' && !row.resolvedAt) {
        update.resolvedAt = new Date();
      }
      if (sanitized.status === 'CLOSED' && !row.resolvedAt) {
        update.resolvedAt = new Date();
      }
    }
    if (sanitized.severity !== undefined) update.severity = sanitized.severity;
    if (sanitized.adminNote !== undefined) update.adminNote = sanitized.adminNote;

    const updated = await this.prisma.playerFeedback.update({
      where: { id },
      data: update,
    });
    return this.toRow(updated, {
      reporterName: await this.nameOf(updated.reporterCharacterId),
    });
  }

  async adminResolve(id: string): Promise<PlayerFeedbackRow> {
    return this.adminPatch(id, { status: 'RESOLVED' });
  }

  async adminClose(id: string): Promise<PlayerFeedbackRow> {
    return this.adminPatch(id, { status: 'CLOSED' });
  }

  private async listInternal(
    extraWhere: Prisma.PlayerFeedbackWhereInput,
    params: ListParams,
  ): Promise<FeedbackListResponse> {
    const limit = Math.min(
      Math.max(params.limit ?? FEEDBACK_LIMITS.LIST_PAGE_DEFAULT, 1),
      FEEDBACK_LIMITS.LIST_PAGE_MAX,
    );
    const where: Prisma.PlayerFeedbackWhereInput = { ...extraWhere };
    if (params.status) where.status = params.status;
    if (params.type) where.type = params.type;
    if (params.cursor) {
      const cursorDate = new Date(params.cursor);
      if (!Number.isNaN(cursorDate.getTime())) {
        where.createdAt = { lt: cursorDate };
      }
    }
    const rows = await this.prisma.playerFeedback.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const sliced = rows.slice(0, limit);
    const total = await this.prisma.playerFeedback.count({ where: extraWhere });
    const reporterIds = Array.from(new Set(sliced.map((r) => r.reporterCharacterId)));
    const nameMap = await this.namesOf(reporterIds);
    return {
      feedback: sliced.map((r) =>
        this.toRow(r, { reporterName: nameMap.get(r.reporterCharacterId) ?? null }),
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
      type: string;
      title: string;
      description: string;
      severity: string;
      status: string;
      relatedFeature: string | null;
      relatedEntityType: string | null;
      relatedEntityId: string | null;
      targetCharacterId: string | null;
      adminNote: string | null;
      createdAt: Date;
      updatedAt: Date;
      resolvedAt: Date | null;
    },
    opt: { reporterName: string | null },
  ): PlayerFeedbackRow {
    return {
      id: row.id,
      reporterCharacterId: row.reporterCharacterId,
      reporterDisplayName: opt.reporterName,
      type: row.type as PlayerFeedbackRow['type'],
      title: row.title,
      description: row.description,
      severity: row.severity as PlayerFeedbackRow['severity'],
      status: row.status as FeedbackStatus,
      relatedFeature: row.relatedFeature,
      relatedEntityType: row.relatedEntityType,
      relatedEntityId: row.relatedEntityId,
      targetCharacterId: row.targetCharacterId,
      adminNote: row.adminNote,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    };
  }
}
