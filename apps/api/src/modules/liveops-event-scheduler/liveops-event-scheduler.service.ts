import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LIVEOPS_EVENT_TYPE_CAPS,
  clampLiveOpsMultiplier,
  isLiveOpsEventActiveAt,
  isValidLiveOpsScheduledEventStatus,
  isValidLiveOpsScheduledEventType,
  nextLiveOpsScheduledEventStatus,
  pickActiveLiveOpsMultiplier,
  validateLiveOpsScheduledEventInput,
  type LiveOpsRuntimeModifier,
  type LiveOpsScheduledEventInput,
  type LiveOpsScheduledEventStatus,
  type LiveOpsScheduledEventType,
  type LiveOpsScheduledEventValidationCode,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 15.1–15.2 — LiveOps Event Scheduler runtime service.
 *
 * Server-authoritative CRUD + status machine + runtime modifier query cho
 * `LiveOpsScheduledEvent`. Khác `AdminLiveOpsService` (override catalog
 * tĩnh `LIVE_OPS_EVENTS`), service này quản event row động fully-defined-in-DB.
 *
 * Design:
 *   - `createEvent` / `updateEvent` validate qua shared
 *     `validateLiveOpsScheduledEventInput` (cap multiplier + window + key).
 *   - `disableEvent` set `status='DISABLED'` (kill switch — không tự recover).
 *   - `recomputeStatuses` idempotent: SCHEDULED→ACTIVE / ACTIVE→ENDED dựa
 *     trên `now`. Gọi nhiều lần cho cùng `now` không gây side-effect khác.
 *   - `getActiveModifiers` / `getRuntimeModifiers` query rows
 *     `status='ACTIVE'` AND `now ∈ [startsAt, endsAt)`. Compose qua
 *     `pickActiveLiveOpsMultiplier` (max-only, không stack).
 *
 * Audit trail (admin endpoint controller layer ghi `AdminAuditLog` với
 * action `ADMIN_LIVEOPS_EVENT_*`). Service này KHÔNG tự ghi audit để
 * tránh duplicate (controller đã ghi).
 */

export type LiveOpsEventSchedulerErrorCode =
  | 'EVENT_NOT_FOUND'
  | 'EVENT_KEY_DUPLICATE'
  | LiveOpsScheduledEventValidationCode;

export class LiveOpsEventSchedulerError extends Error {
  readonly code: LiveOpsEventSchedulerErrorCode;
  constructor(code: LiveOpsEventSchedulerErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'LiveOpsEventSchedulerError';
    this.code = code;
  }
}

export interface LiveOpsScheduledEventView {
  readonly id: string;
  readonly key: string;
  readonly type: LiveOpsScheduledEventType;
  readonly title: string;
  readonly description: string;
  readonly status: LiveOpsScheduledEventStatus;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly configJson: Readonly<Record<string, unknown>>;
  readonly createdByAdminId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RecomputeSummary {
  readonly scannedAt: string;
  readonly toActivated: number;
  readonly toEnded: number;
}

interface CreateEventInput extends LiveOpsScheduledEventInput {
  /** Initial status — default `SCHEDULED`. Chỉ admin có thể set `DRAFT`. */
  readonly initialStatus?: 'DRAFT' | 'SCHEDULED';
}

interface UpdateEventInput {
  readonly title?: string;
  readonly description?: string;
  readonly startsAt?: Date;
  readonly endsAt?: Date;
  readonly configJson?: LiveOpsScheduledEventInput['configJson'];
  readonly status?: LiveOpsScheduledEventStatus;
}

@Injectable()
export class LiveOpsEventSchedulerService {
  private readonly logger = new Logger(LiveOpsEventSchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async listEvents(): Promise<LiveOpsScheduledEventView[]> {
    const rows = await this.prisma.liveOpsScheduledEvent.findMany({
      orderBy: [{ status: 'asc' }, { startsAt: 'asc' }],
    });
    return rows.map(toView);
  }

  async getEventById(id: string): Promise<LiveOpsScheduledEventView | null> {
    const row = await this.prisma.liveOpsScheduledEvent.findUnique({
      where: { id },
    });
    return row ? toView(row) : null;
  }

  async getEventByKey(key: string): Promise<LiveOpsScheduledEventView | null> {
    const row = await this.prisma.liveOpsScheduledEvent.findUnique({
      where: { key },
    });
    return row ? toView(row) : null;
  }

  /**
   * Trả về tất cả event `status='ACTIVE'` AND `now ∈ [startsAt, endsAt)`.
   * Runtime caller (dungeon, cultivation, shop) gọi để compose modifier.
   *
   * Defense-in-depth: filter cả status + window dù cron đã transition. Nếu
   * cron chưa kịp run (vd 5-min lag), event vừa tới `startsAt` mà status
   * vẫn `SCHEDULED` → KHÔNG return (an toàn — không apply boost sớm/muộn).
   */
  async getActiveEvents(now: Date = new Date()): Promise<LiveOpsScheduledEventView[]> {
    const rows = await this.prisma.liveOpsScheduledEvent.findMany({
      where: {
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map(toView);
  }

  async getRuntimeModifiers(
    now: Date = new Date(),
  ): Promise<LiveOpsRuntimeModifier[]> {
    const events = await this.getActiveEvents(now);
    const out: LiveOpsRuntimeModifier[] = [];
    for (const e of events) {
      if (!isValidLiveOpsScheduledEventType(e.type)) continue;
      // Defense-in-depth: re-check window (race với clock skew).
      if (!isLiveOpsEventActiveAt(new Date(e.startsAt), new Date(e.endsAt), now)) {
        continue;
      }
      const cap = LIVEOPS_EVENT_TYPE_CAPS[e.type];
      const cfg = e.configJson as { multiplier?: number; rewardJson?: Record<string, unknown> };
      const rawMul = typeof cfg.multiplier === 'number'
        ? cfg.multiplier
        : cap.kind === 'DISCOUNT'
          ? 0
          : 1.0;
      const multiplier = clampLiveOpsMultiplier(e.type, rawMul);
      out.push({
        eventKey: e.key,
        type: e.type,
        multiplier,
        rewardJson: cfg.rewardJson,
        startsAt: new Date(e.startsAt),
        endsAt: new Date(e.endsAt),
      });
    }
    return out;
  }

  /**
   * Helper: pick max multiplier of `type` từ active modifiers (no stack).
   * Caller dungeon/cultivation gọi để biết "apply nhân mấy?".
   */
  async getActiveMultiplier(
    type: LiveOpsScheduledEventType,
    now: Date = new Date(),
  ): Promise<number> {
    const mods = await this.getRuntimeModifiers(now);
    return pickActiveLiveOpsMultiplier(mods, type);
  }

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  async createEvent(
    adminUserId: string,
    input: CreateEventInput,
  ): Promise<LiveOpsScheduledEventView> {
    const code = validateLiveOpsScheduledEventInput(input);
    if (code) throw new LiveOpsEventSchedulerError(code);

    const status: LiveOpsScheduledEventStatus =
      input.initialStatus ?? 'SCHEDULED';

    try {
      const created = await this.prisma.liveOpsScheduledEvent.create({
        data: {
          key: input.key,
          type: input.type,
          title: input.title.trim(),
          description: input.description?.trim() ?? '',
          status,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          configJson: input.configJson as Prisma.InputJsonValue,
          createdByAdminId: adminUserId,
        },
      });
      return toView(created);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new LiveOpsEventSchedulerError('EVENT_KEY_DUPLICATE');
      }
      throw e;
    }
  }

  /**
   * Update event row. Validate full shape (type không đổi — nếu admin gửi
   * type khác sẽ bị reject ngầm bằng cách giữ row.type).
   *
   * Status transition cho phép thủ công:
   *   - DRAFT → SCHEDULED (admin kích hoạt schedule).
   *   - bất kỳ → DISABLED (kill switch — set ở `disableEvent` thay vì gọi update).
   *   - DISABLED → SCHEDULED (admin re-enable).
   *
   * KHÔNG cho phép thủ công SCHEDULED → ACTIVE / ACTIVE → ENDED — phải qua
   * cron `recomputeStatuses` để tránh inconsistent với window.
   */
  async updateEvent(
    eventId: string,
    input: UpdateEventInput,
  ): Promise<LiveOpsScheduledEventView> {
    const existing = await this.prisma.liveOpsScheduledEvent.findUnique({
      where: { id: eventId },
    });
    if (!existing) throw new LiveOpsEventSchedulerError('EVENT_NOT_FOUND');

    if (!isValidLiveOpsScheduledEventType(existing.type)) {
      throw new LiveOpsEventSchedulerError('EVENT_TYPE_INVALID');
    }

    const startsAt = input.startsAt ?? existing.startsAt;
    const endsAt = input.endsAt ?? existing.endsAt;
    const merged = {
      key: existing.key,
      type: existing.type,
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      startsAt,
      endsAt,
      configJson:
        input.configJson ??
        (existing.configJson as { multiplier?: number; rewardJson?: Record<string, unknown> }),
    } satisfies LiveOpsScheduledEventInput;
    const code = validateLiveOpsScheduledEventInput(merged);
    if (code) throw new LiveOpsEventSchedulerError(code);

    const data: Prisma.LiveOpsScheduledEventUpdateInput = {
      title: merged.title,
      description: merged.description ?? '',
      startsAt: merged.startsAt,
      endsAt: merged.endsAt,
      configJson: merged.configJson as Prisma.InputJsonValue,
    };

    if (input.status) {
      if (!isValidLiveOpsScheduledEventStatus(input.status)) {
        throw new LiveOpsEventSchedulerError('EVENT_TYPE_INVALID');
      }
      // Reject auto-transition status manually (must go via cron).
      if (input.status === 'ACTIVE' || input.status === 'ENDED') {
        throw new LiveOpsEventSchedulerError(
          'EVENT_TYPE_INVALID',
          'Cannot manually set ACTIVE/ENDED — use cron recompute',
        );
      }
      data.status = input.status;
    }

    const updated = await this.prisma.liveOpsScheduledEvent.update({
      where: { id: eventId },
      data,
    });
    return toView(updated);
  }

  async disableEvent(eventId: string): Promise<LiveOpsScheduledEventView> {
    const existing = await this.prisma.liveOpsScheduledEvent.findUnique({
      where: { id: eventId },
    });
    if (!existing) throw new LiveOpsEventSchedulerError('EVENT_NOT_FOUND');
    const updated = await this.prisma.liveOpsScheduledEvent.update({
      where: { id: eventId },
      data: { status: 'DISABLED' },
    });
    return toView(updated);
  }

  // -------------------------------------------------------------------------
  // Cron recompute
  // -------------------------------------------------------------------------

  /**
   * Idempotent status transition cho cron 5-phút. Gọi nhiều lần cùng `now`
   * không gây thêm side-effect — sau lần đầu, `updateMany` sẽ count=0.
   *
   * Race-safety multi-instance: 2 worker cùng tick → cả 2 đọc cùng set
   * SCHEDULED, cả 2 update WHERE status='SCHEDULED'. Worker thắng update
   * `count=N`, worker thua `count=0` (status đã là 'ACTIVE'). KHÔNG double
   * transition.
   *
   * Dùng `updateMany` với guard status="SCHEDULED"/"ACTIVE" + window:
   *   - SCHEDULED → ACTIVE: status="SCHEDULED" AND startsAt <= now AND endsAt > now.
   *   - SCHEDULED → ENDED:  status="SCHEDULED" AND endsAt <= now (skip past start).
   *   - ACTIVE    → ENDED:  status="ACTIVE"    AND endsAt <= now.
   */
  async recomputeStatuses(now: Date = new Date()): Promise<RecomputeSummary> {
    // SCHEDULED → ACTIVE.
    const activated = await this.prisma.liveOpsScheduledEvent.updateMany({
      where: {
        status: 'SCHEDULED',
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      data: { status: 'ACTIVE' },
    });
    // SCHEDULED → ENDED (event đã quá hạn nhưng chưa từng activate — vd
    // schedule quá khứ).
    const skippedToEnded = await this.prisma.liveOpsScheduledEvent.updateMany({
      where: {
        status: 'SCHEDULED',
        endsAt: { lte: now },
      },
      data: { status: 'ENDED' },
    });
    // ACTIVE → ENDED.
    const ended = await this.prisma.liveOpsScheduledEvent.updateMany({
      where: {
        status: 'ACTIVE',
        endsAt: { lte: now },
      },
      data: { status: 'ENDED' },
    });
    const summary: RecomputeSummary = {
      scannedAt: now.toISOString(),
      toActivated: activated.count,
      toEnded: skippedToEnded.count + ended.count,
    };
    if (summary.toActivated > 0 || summary.toEnded > 0) {
      this.logger.log(
        `recompute: activated=${summary.toActivated} ended=${summary.toEnded}`,
      );
    }
    return summary;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toView(row: {
  id: string;
  key: string;
  type: string;
  title: string;
  description: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  configJson: Prisma.JsonValue;
  createdByAdminId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): LiveOpsScheduledEventView {
  return {
    id: row.id,
    key: row.key,
    type: isValidLiveOpsScheduledEventType(row.type)
      ? row.type
      : (row.type as LiveOpsScheduledEventType),
    title: row.title,
    description: row.description,
    status: isValidLiveOpsScheduledEventStatus(row.status)
      ? row.status
      : (row.status as LiveOpsScheduledEventStatus),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    configJson:
      row.configJson && typeof row.configJson === 'object' && !Array.isArray(row.configJson)
        ? (row.configJson as Record<string, unknown>)
        : {},
    createdByAdminId: row.createdByAdminId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export { nextLiveOpsScheduledEventStatus };
