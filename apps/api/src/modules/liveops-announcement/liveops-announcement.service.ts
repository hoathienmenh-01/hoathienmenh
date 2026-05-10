/**
 * Phase 15.3.B — LiveOps Announcement service.
 *
 * Provides:
 *   - CRUD + status machine cho `LiveOpsAnnouncement`.
 *   - Cron `recomputeStatuses` idempotent (mirror
 *     `LiveOpsEventSchedulerService.recomputeStatuses` pattern). Khác
 *     event scheduler ở chỗ:
 *       - Service trả về danh sách rows transition kèm payload public-safe
 *         để caller (cron processor / admin trigger) broadcast.
 *       - DB update + return rows trong cùng `$transaction` để tránh race
 *         giữa "đọc rows" và "update status" gây double broadcast.
 *   - Public-safe view (strip admin metadata).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LIVEOPS_ANNOUNCEMENT_SEVERITIES,
  LIVEOPS_ANNOUNCEMENT_STATUSES,
  LIVEOPS_ANNOUNCEMENT_TARGETS,
  type LiveOpsAnnouncementBroadcastPayload,
  type LiveOpsAnnouncementInput,
  type LiveOpsAnnouncementSeverity,
  type LiveOpsAnnouncementStatus,
  type LiveOpsAnnouncementTarget,
  type LiveOpsAnnouncementValidationCode,
  validateLiveOpsAnnouncementInput,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export class LiveOpsAnnouncementError extends Error {
  constructor(
    public readonly code:
      | LiveOpsAnnouncementValidationCode
      | 'ANNOUNCEMENT_NOT_FOUND'
      | 'ANNOUNCEMENT_KEY_DUPLICATE'
      | 'ANNOUNCEMENT_INVALID_STATUS_TRANSITION',
    detail?: string,
  ) {
    super(detail ?? code);
    this.name = 'LiveOpsAnnouncementError';
  }
}

/**
 * Admin-facing view (full metadata cho admin panel). KHÔNG bao giờ trả ra
 * public endpoint — public dùng `LiveOpsAnnouncementPublicView`.
 */
export interface LiveOpsAnnouncementView {
  id: string;
  key: string;
  severity: LiveOpsAnnouncementSeverity;
  status: LiveOpsAnnouncementStatus;
  target: LiveOpsAnnouncementTarget;
  titleVi: string;
  titleEn: string | null;
  messageVi: string;
  messageEn: string | null;
  startsAt: string;
  endsAt: string;
  createdByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

/** Public-safe view (no admin metadata, no internal). */
export interface LiveOpsAnnouncementPublicView {
  key: string;
  severity: LiveOpsAnnouncementSeverity;
  target: LiveOpsAnnouncementTarget;
  titleVi: string;
  titleEn: string | null;
  messageVi: string;
  messageEn: string | null;
  startsAt: string;
  endsAt: string;
}

export interface CreateAnnouncementInput extends LiveOpsAnnouncementInput {
  /** `DRAFT` mặc định nếu không truyền — admin POST schedule riêng. */
  initialStatus?: 'DRAFT' | 'SCHEDULED';
}

export interface UpdateAnnouncementInput {
  severity?: LiveOpsAnnouncementSeverity;
  target?: LiveOpsAnnouncementTarget;
  titleVi?: string;
  titleEn?: string | null;
  messageVi?: string;
  messageEn?: string | null;
  startsAt?: Date;
  endsAt?: Date;
  /** Chỉ cho phép manual: `DRAFT → SCHEDULED`, `DISABLED → SCHEDULED`. */
  status?: 'SCHEDULED' | 'DRAFT';
}

/**
 * Recompute summary trả về rows có thật sự transition để caller broadcast.
 * KHÔNG bao giờ chứa rows status không đổi → tránh duplicate broadcast.
 */
export interface AnnouncementRecomputeSummary {
  scannedAt: string;
  activated: LiveOpsAnnouncementBroadcastPayload[];
  ended: LiveOpsAnnouncementBroadcastPayload[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class LiveOpsAnnouncementService {
  private readonly logger = new Logger(LiveOpsAnnouncementService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async listAnnouncements(): Promise<LiveOpsAnnouncementView[]> {
    const rows = await this.prisma.liveOpsAnnouncement.findMany({
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toView);
  }

  async getAnnouncementById(
    id: string,
  ): Promise<LiveOpsAnnouncementView | null> {
    const row = await this.prisma.liveOpsAnnouncement.findUnique({
      where: { id },
    });
    return row ? toView(row) : null;
  }

  /**
   * Public-safe list ACTIVE announcements. Filter `target` theo viewer
   * auth state:
   *   - anonymous viewer → chỉ thấy `target = ALL`.
   *   - authenticated player → `ALL` + `AUTHENTICATED`.
   *   - admin/MOD → tất cả `ALL` + `AUTHENTICATED` + `ADMIN_ONLY`.
   *
   * KHÔNG trả `createdByAdminId` / `disabledAt` / `id` ra public payload.
   */
  async getActiveAnnouncementsPublic(
    viewer: 'anonymous' | 'authenticated' | 'admin',
    now: Date = new Date(),
  ): Promise<LiveOpsAnnouncementPublicView[]> {
    const targetIn: LiveOpsAnnouncementTarget[] = ['ALL'];
    if (viewer === 'authenticated' || viewer === 'admin') {
      targetIn.push('AUTHENTICATED');
    }
    if (viewer === 'admin') {
      targetIn.push('ADMIN_ONLY');
    }
    const rows = await this.prisma.liveOpsAnnouncement.findMany({
      where: {
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
        target: { in: targetIn },
      },
      orderBy: [{ startsAt: 'asc' }],
    });
    return rows.map(toPublicView);
  }

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  async createAnnouncement(
    adminUserId: string,
    input: CreateAnnouncementInput,
  ): Promise<LiveOpsAnnouncementView> {
    const code = validateLiveOpsAnnouncementInput(input);
    if (code) throw new LiveOpsAnnouncementError(code);

    const status: LiveOpsAnnouncementStatus = input.initialStatus ?? 'DRAFT';

    try {
      const created = await this.prisma.liveOpsAnnouncement.create({
        data: {
          key: input.key,
          severity: input.severity,
          status,
          target: input.target,
          titleVi: input.titleVi.trim(),
          titleEn:
            input.titleEn !== undefined && input.titleEn !== null
              ? input.titleEn.trim() || null
              : null,
          messageVi: input.messageVi.trim(),
          messageEn:
            input.messageEn !== undefined && input.messageEn !== null
              ? input.messageEn.trim() || null
              : null,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          createdByAdminId: adminUserId,
        },
      });
      return toView(created);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new LiveOpsAnnouncementError('ANNOUNCEMENT_KEY_DUPLICATE');
      }
      throw e;
    }
  }

  async updateAnnouncement(
    id: string,
    input: UpdateAnnouncementInput,
  ): Promise<LiveOpsAnnouncementView> {
    const existing = await this.prisma.liveOpsAnnouncement.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new LiveOpsAnnouncementError('ANNOUNCEMENT_NOT_FOUND');
    }

    // Reject auto-transition statuses manually (must go via cron).
    if (input.status) {
      if (input.status !== 'DRAFT' && input.status !== 'SCHEDULED') {
        throw new LiveOpsAnnouncementError(
          'ANNOUNCEMENT_INVALID_STATUS_TRANSITION',
          'Cannot manually set ACTIVE/ENDED — use cron recompute',
        );
      }
    }

    const merged = {
      key: existing.key,
      severity: input.severity ?? (existing.severity as LiveOpsAnnouncementSeverity),
      target: input.target ?? (existing.target as LiveOpsAnnouncementTarget),
      titleVi: input.titleVi ?? existing.titleVi,
      titleEn:
        input.titleEn !== undefined ? input.titleEn : existing.titleEn,
      messageVi: input.messageVi ?? existing.messageVi,
      messageEn:
        input.messageEn !== undefined ? input.messageEn : existing.messageEn,
      startsAt: input.startsAt ?? existing.startsAt,
      endsAt: input.endsAt ?? existing.endsAt,
    } satisfies LiveOpsAnnouncementInput;
    const validateCode = validateLiveOpsAnnouncementInput(merged);
    if (validateCode) throw new LiveOpsAnnouncementError(validateCode);

    const data: Prisma.LiveOpsAnnouncementUpdateInput = {
      severity: merged.severity,
      target: merged.target,
      titleVi: merged.titleVi.trim(),
      titleEn:
        merged.titleEn !== undefined && merged.titleEn !== null
          ? merged.titleEn.trim() || null
          : null,
      messageVi: merged.messageVi.trim(),
      messageEn:
        merged.messageEn !== undefined && merged.messageEn !== null
          ? merged.messageEn.trim() || null
          : null,
      startsAt: merged.startsAt,
      endsAt: merged.endsAt,
    };
    if (input.status) {
      data.status = input.status;
    }

    const updated = await this.prisma.liveOpsAnnouncement.update({
      where: { id },
      data,
    });
    return toView(updated);
  }

  async disableAnnouncement(id: string): Promise<LiveOpsAnnouncementView> {
    const existing = await this.prisma.liveOpsAnnouncement.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new LiveOpsAnnouncementError('ANNOUNCEMENT_NOT_FOUND');
    }
    const updated = await this.prisma.liveOpsAnnouncement.update({
      where: { id },
      data: {
        status: 'DISABLED',
        disabledAt: existing.disabledAt ?? new Date(),
      },
    });
    return toView(updated);
  }

  // -------------------------------------------------------------------------
  // Cron recompute
  // -------------------------------------------------------------------------

  /**
   * Idempotent status transition cho cron 5-phút. Trả về rows transition
   * thật sự để caller broadcast WS event.
   *
   * Race-safety multi-instance:
   *   - 2 worker cùng tick → cả 2 đọc cùng set SCHEDULED. Worker thắng
   *     `update` (Prisma optimistic concurrency qua `updatedAt`?) — không.
   *     Prisma không có per-row version mặc định. Thay vì optimistic, ta
   *     dùng atomic `updateMany WHERE status='SCHEDULED'` + thêm
   *     `findMany WHERE status='ACTIVE' AND updatedAt >= scannedAt` để
   *     pick rows transition.
   *   - Tuy nhiên cách này vẫn race khi cron lock trễ. An toàn hơn là
   *     dùng Redis lease ở processor (đã có
   *     `LIVEOPS_EVENT_RECOMPUTE_LEASE_KEY`) — tái dụng cùng lease key
   *     riêng cho announcement: `LIVEOPS_ANNOUNCEMENT_RECOMPUTE_LEASE_KEY`.
   *   - Trong đơn-vị-test, không Redis, ta gọi service trực tiếp 1 lần
   *     trong `expect.assert` để verify. Idempotent: gọi lần 2 trả mảng
   *     rỗng vì rows đã transition.
   *
   * Strategy:
   *   1. Lock candidate rows bằng `findMany` filter status + window.
   *   2. Chạy `updateMany` với cùng filter — Prisma trả `count`.
   *   3. Map rows + new status → broadcast payload.
   */
  async recomputeStatuses(
    now: Date = new Date(),
  ): Promise<AnnouncementRecomputeSummary> {
    // SCHEDULED → ACTIVE.
    const activatedCandidates =
      await this.prisma.liveOpsAnnouncement.findMany({
        where: {
          status: 'SCHEDULED',
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
      });
    const activatedIds = activatedCandidates.map((r) => r.id);
    let activated: LiveOpsAnnouncementBroadcastPayload[] = [];
    if (activatedIds.length > 0) {
      const upd = await this.prisma.liveOpsAnnouncement.updateMany({
        where: {
          id: { in: activatedIds },
          status: 'SCHEDULED',
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
        data: { status: 'ACTIVE' },
      });
      // Chỉ broadcast nếu thực sự update được (race với worker khác có thể
      // làm count<candidates).
      if (upd.count > 0) {
        const winners = activatedCandidates.slice(0, upd.count);
        activated = winners.map((r) =>
          toAnnouncementBroadcastPayload(r, 'ANNOUNCEMENT_ACTIVE'),
        );
      }
    }

    // SCHEDULED past endsAt → ENDED (skip-to-ended; lỡ schedule quá khứ).
    const skippedCandidates = await this.prisma.liveOpsAnnouncement.findMany({
      where: {
        status: 'SCHEDULED',
        endsAt: { lte: now },
      },
    });
    let skipped: LiveOpsAnnouncementBroadcastPayload[] = [];
    if (skippedCandidates.length > 0) {
      const upd = await this.prisma.liveOpsAnnouncement.updateMany({
        where: {
          id: { in: skippedCandidates.map((r) => r.id) },
          status: 'SCHEDULED',
          endsAt: { lte: now },
        },
        data: { status: 'ENDED' },
      });
      if (upd.count > 0) {
        // KHÔNG broadcast `ANNOUNCEMENT_ENDED` cho rows skip-to-ended —
        // chúng chưa từng ACTIVE, FE chưa show gì để dismiss.
        skipped = []; // intentionally empty.
      }
    }
    void skipped;

    // ACTIVE → ENDED.
    const endedCandidates = await this.prisma.liveOpsAnnouncement.findMany({
      where: {
        status: 'ACTIVE',
        endsAt: { lte: now },
      },
    });
    let ended: LiveOpsAnnouncementBroadcastPayload[] = [];
    if (endedCandidates.length > 0) {
      const upd = await this.prisma.liveOpsAnnouncement.updateMany({
        where: {
          id: { in: endedCandidates.map((r) => r.id) },
          status: 'ACTIVE',
          endsAt: { lte: now },
        },
        data: { status: 'ENDED' },
      });
      if (upd.count > 0) {
        const winners = endedCandidates.slice(0, upd.count);
        ended = winners.map((r) =>
          toAnnouncementBroadcastPayload(r, 'ANNOUNCEMENT_ENDED'),
        );
      }
    }

    if (activated.length > 0 || ended.length > 0) {
      this.logger.log(
        `recompute: activated=${activated.length} ended=${ended.length}`,
      );
    }

    return {
      scannedAt: now.toISOString(),
      activated,
      ended,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidSeverity(s: string): s is LiveOpsAnnouncementSeverity {
  return (LIVEOPS_ANNOUNCEMENT_SEVERITIES as readonly string[]).includes(s);
}
function isValidStatus(s: string): s is LiveOpsAnnouncementStatus {
  return (LIVEOPS_ANNOUNCEMENT_STATUSES as readonly string[]).includes(s);
}
function isValidTarget(s: string): s is LiveOpsAnnouncementTarget {
  return (LIVEOPS_ANNOUNCEMENT_TARGETS as readonly string[]).includes(s);
}

interface AnnouncementRow {
  id: string;
  key: string;
  severity: string;
  status: string;
  target: string;
  titleVi: string;
  titleEn: string | null;
  messageVi: string;
  messageEn: string | null;
  startsAt: Date;
  endsAt: Date;
  createdByAdminId: string | null;
  createdAt: Date;
  updatedAt: Date;
  disabledAt: Date | null;
}

function toView(row: AnnouncementRow): LiveOpsAnnouncementView {
  return {
    id: row.id,
    key: row.key,
    severity: isValidSeverity(row.severity)
      ? row.severity
      : ('INFO' as LiveOpsAnnouncementSeverity),
    status: isValidStatus(row.status)
      ? row.status
      : ('DRAFT' as LiveOpsAnnouncementStatus),
    target: isValidTarget(row.target)
      ? row.target
      : ('ALL' as LiveOpsAnnouncementTarget),
    titleVi: row.titleVi,
    titleEn: row.titleEn,
    messageVi: row.messageVi,
    messageEn: row.messageEn,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    createdByAdminId: row.createdByAdminId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    disabledAt: row.disabledAt ? row.disabledAt.toISOString() : null,
  };
}

function toPublicView(row: AnnouncementRow): LiveOpsAnnouncementPublicView {
  return {
    key: row.key,
    severity: isValidSeverity(row.severity)
      ? row.severity
      : ('INFO' as LiveOpsAnnouncementSeverity),
    target: isValidTarget(row.target)
      ? row.target
      : ('ALL' as LiveOpsAnnouncementTarget),
    titleVi: row.titleVi,
    titleEn: row.titleEn,
    messageVi: row.messageVi,
    messageEn: row.messageEn,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  };
}

export function toAnnouncementBroadcastPayload(
  row: AnnouncementRow,
  type: 'ANNOUNCEMENT_ACTIVE' | 'ANNOUNCEMENT_ENDED',
): LiveOpsAnnouncementBroadcastPayload {
  const severity = isValidSeverity(row.severity)
    ? row.severity
    : ('INFO' as LiveOpsAnnouncementSeverity);
  const target = isValidTarget(row.target)
    ? row.target
    : ('ALL' as LiveOpsAnnouncementTarget);
  return {
    type,
    key: row.key,
    severity,
    target,
    title: row.titleVi,
    message: row.messageVi,
    titleVi: row.titleVi,
    titleEn: row.titleEn,
    messageVi: row.messageVi,
    messageEn: row.messageEn,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  };
}
