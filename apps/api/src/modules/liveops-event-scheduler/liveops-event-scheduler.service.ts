import { Injectable, Logger, Optional } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import {
  LIVEOPS_EVENT_TYPE_CAPS,
  clampLiveOpsMultiplier,
  isLiveOpsEventActiveAt,
  isLiveOpsRuntimeSupported,
  isValidLiveOpsScheduledEventStatus,
  isValidLiveOpsScheduledEventType,
  nextLiveOpsScheduledEventStatus,
  parseLiveOpsEventReward,
  pickActiveLiveOpsMultiplier,
  validateLiveOpsEventRewardJson,
  validateLiveOpsScheduledEventInput,
  type LiveOpsEventReward,
  type LiveOpsRuntimeModifier,
  type LiveOpsScheduledEventInput,
  type LiveOpsScheduledEventStatus,
  type LiveOpsScheduledEventType,
  type LiveOpsScheduledEventValidationCode,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';

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
  | 'EVENT_NOT_ACTIVE'
  | 'EVENT_NOT_CLAIMABLE'
  | 'EVENT_ALREADY_CLAIMED'
  | 'NO_CHARACTER'
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

/**
 * Phase 15.3.B — extended recompute summary kèm rows transitioned để
 * caller (cron processor) broadcast WS event public-safe payload. KHÔNG
 * breaking — `recomputeStatuses` legacy vẫn trả `RecomputeSummary` mỏng.
 */
export interface RecomputeWithTransitionsSummary extends RecomputeSummary {
  readonly activated: ReadonlyArray<LiveOpsScheduledEventView>;
  readonly ended: ReadonlyArray<LiveOpsScheduledEventView>;
}

/**
 * Phase 15.3.A — public-safe view of an active event for player UI
 * (`GET /liveops/events/active`). Strips admin-only fields
 * (`createdByAdminId`) and adds `claimable` flag for character-aware
 * FESTIVAL_GIFT pre-flight check.
 */
export interface LiveOpsActiveEventPublicView {
  readonly key: string;
  readonly type: LiveOpsScheduledEventType;
  readonly title: string;
  readonly description: string;
  readonly startsAt: string;
  readonly endsAt: string;
  /**
   * Public subset of `configJson`:
   *   - `multiplier`: effective server-clamped multiplier (after
   *     `clampLiveOpsMultiplier`) — used by FE to display "x2 boss
   *     reward" / "30% off shop" labels.
   *   - `reward`: typed `LiveOpsEventReward` nếu type=FESTIVAL_GIFT,
   *     null cho các type khác.
   */
  readonly publicConfig: {
    readonly multiplier: number | null;
    readonly reward: LiveOpsEventReward | null;
  };
  /** True nếu type=FESTIVAL_GIFT và character này chưa claim. */
  readonly claimable: boolean;
  /** True nếu runtime đã wire (FE có thể hiển thị badge). */
  readonly runtimeSupported: boolean;
}

/**
 * Phase 15.3.A — result of a successful FESTIVAL_GIFT claim.
 * `granted` echoes server-clamped reward (after defense-in-depth caps).
 */
export interface LiveOpsClaimResult {
  readonly eventKey: string;
  readonly claimedAt: string;
  readonly granted: LiveOpsEventReward;
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

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly currency?: CurrencyService,
    @Optional() private readonly inventory?: InventoryService,
  ) {}

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
   * Phase 15.3.A — public-safe list of ACTIVE events for player UI.
   *
   * Strips admin metadata. For type=FESTIVAL_GIFT, includes `claimable`
   * flag (true if `characterId` chưa có row trong `LiveOpsEventRewardClaim`).
   * For non-FESTIVAL_GIFT types, `claimable=false` (no claim semantics).
   *
   * @param characterId - nếu null/undefined, all events `claimable=false`
   *   (anonymous viewer / pre-character-creation).
   */
  async getActiveEventsPublic(
    characterId: string | null,
    now: Date = new Date(),
  ): Promise<LiveOpsActiveEventPublicView[]> {
    const events = await this.getActiveEvents(now);
    if (events.length === 0) return [];

    // Batch-fetch claim rows for FESTIVAL_GIFT events to avoid N+1.
    const festivalEventIds = events
      .filter((e) => e.type === 'FESTIVAL_GIFT')
      .map((e) => e.id);
    const claimedEventIds = new Set<string>();
    if (characterId && festivalEventIds.length > 0) {
      const claims = await this.prisma.liveOpsEventRewardClaim.findMany({
        where: { characterId, eventId: { in: festivalEventIds } },
        select: { eventId: true },
      });
      for (const c of claims) claimedEventIds.add(c.eventId);
    }

    return events.map((e) => {
      const cfg = e.configJson as {
        multiplier?: number;
        rewardJson?: Record<string, unknown>;
      };
      let multiplier: number | null = null;
      if (typeof cfg.multiplier === 'number' && isValidLiveOpsScheduledEventType(e.type)) {
        multiplier = clampLiveOpsMultiplier(e.type, cfg.multiplier);
      }
      let reward: LiveOpsEventReward | null = null;
      if (e.type === 'FESTIVAL_GIFT' && cfg.rewardJson) {
        try {
          reward = parseLiveOpsEventReward(cfg.rewardJson);
        } catch {
          reward = null;
        }
      }
      const claimable =
        e.type === 'FESTIVAL_GIFT' &&
        characterId !== null &&
        characterId !== undefined &&
        !claimedEventIds.has(e.id);
      const runtimeSupported = isValidLiveOpsScheduledEventType(e.type)
        ? isLiveOpsRuntimeSupported(e.type)
        : false;
      return {
        key: e.key,
        type: e.type,
        title: e.title,
        description: e.description,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        publicConfig: { multiplier, reward },
        claimable,
        runtimeSupported,
      };
    });
  }

  /**
   * Phase 15.3.A — claim FESTIVAL_GIFT one-time reward for a character.
   *
   * Validation:
   *   - Event must exist (key = `eventKey`).
   *   - Event status must be `ACTIVE` AND now ∈ [startsAt, endsAt).
   *   - Event type must be `FESTIVAL_GIFT`.
   *   - Event configJson.rewardJson must validate (defense-in-depth even
   *     though admin already validated on create/update).
   *
   * Idempotency:
   *   - `LiveOpsEventRewardClaim` UNIQUE (eventId, characterId) → P2002
   *     on duplicate → throw `EVENT_ALREADY_CLAIMED`. Currency/item grant
   *     transactional with claim row insert — either all happen or none.
   *
   * Caps (defense-in-depth):
   *   - `parseLiveOpsEventReward` clamps oversized values to shared caps
   *     (`FESTIVAL_GIFT_LINH_THACH_CAP=1000`, `FESTIVAL_GIFT_TIEN_NGOC_CAP=50`,
   *     per-item qty ≤ 50, max 10 items).
   *
   * Note: `currency` / `inventory` services injected as `@Optional()` so
   * unit tests can construct service without full DI graph; runtime claim
   * requires them — throws if not wired.
   */
  async claimEventReward(
    characterId: string,
    eventKey: string,
    now: Date = new Date(),
  ): Promise<LiveOpsClaimResult> {
    const event = await this.prisma.liveOpsScheduledEvent.findUnique({
      where: { key: eventKey },
    });
    if (!event) throw new LiveOpsEventSchedulerError('EVENT_NOT_FOUND');

    // Must be ACTIVE + within window (defense-in-depth even if cron lag).
    if (event.status !== 'ACTIVE') {
      throw new LiveOpsEventSchedulerError('EVENT_NOT_ACTIVE');
    }
    if (!isLiveOpsEventActiveAt(event.startsAt, event.endsAt, now)) {
      throw new LiveOpsEventSchedulerError('EVENT_NOT_ACTIVE');
    }
    if (event.type !== 'FESTIVAL_GIFT') {
      throw new LiveOpsEventSchedulerError('EVENT_NOT_CLAIMABLE');
    }

    // Validate + parse reward (clamp to caps).
    const cfg = event.configJson as {
      multiplier?: number;
      rewardJson?: Record<string, unknown>;
    };
    if (!cfg.rewardJson || typeof cfg.rewardJson !== 'object') {
      throw new LiveOpsEventSchedulerError('EVENT_REWARD_EMPTY');
    }
    const rewardCode = validateLiveOpsEventRewardJson(cfg.rewardJson);
    if (rewardCode) {
      throw new LiveOpsEventSchedulerError(rewardCode);
    }
    const reward = parseLiveOpsEventReward(cfg.rewardJson);

    // Verify character exists (FK constraint will catch but pre-check
    // gives clean error code instead of P2003).
    const char = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true },
    });
    if (!char) throw new LiveOpsEventSchedulerError('NO_CHARACTER');

    if (!this.currency || !this.inventory) {
      // Programmer error — module not wired. Surface clearly so the FE
      // controller catches it via 500 rather than silent partial grant.
      throw new Error(
        'LiveOpsEventSchedulerService: claimEventReward requires CurrencyService + InventoryService',
      );
    }

    const eventId = event.id;
    let claimedAt: Date;
    try {
      claimedAt = await this.prisma.$transaction(async (tx) => {
        // Insert claim row first — P2002 on (eventId, characterId)
        // duplicate rolls back currency/item grants.
        const claim = await tx.liveOpsEventRewardClaim.create({
          data: {
            eventId,
            characterId,
            rewardJson: reward as unknown as Prisma.InputJsonValue,
          },
          select: { claimedAt: true },
        });

        // Grant linhThach (if any).
        if (reward.linhThach > 0) {
          await this.currency!.applyTx(tx, {
            characterId,
            currency: CurrencyKind.LINH_THACH,
            delta: BigInt(reward.linhThach),
            reason: 'LIVEOPS_FESTIVAL_GIFT_REWARD',
            refType: 'LiveOpsScheduledEvent',
            refId: eventId,
            meta: {
              eventKey: event.key,
              eventType: 'FESTIVAL_GIFT',
            },
          });
        }
        // Grant tienNgoc (if any).
        if (reward.tienNgoc > 0) {
          await this.currency!.applyTx(tx, {
            characterId,
            currency: CurrencyKind.TIEN_NGOC,
            delta: BigInt(reward.tienNgoc),
            reason: 'LIVEOPS_FESTIVAL_GIFT_REWARD',
            refType: 'LiveOpsScheduledEvent',
            refId: eventId,
            meta: {
              eventKey: event.key,
              eventType: 'FESTIVAL_GIFT',
            },
          });
        }
        // Grant items (if any).
        if (reward.items.length > 0) {
          await this.inventory!.grantTx(
            tx,
            characterId,
            reward.items.map((it) => ({ itemKey: it.itemKey, qty: it.qty })),
            {
              reason: 'LIVEOPS_FESTIVAL_GIFT_REWARD',
              refType: 'LiveOpsScheduledEvent',
              refId: eventId,
              extra: { eventKey: event.key },
            },
          );
        }
        return claim.claimedAt;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new LiveOpsEventSchedulerError('EVENT_ALREADY_CLAIMED');
      }
      throw e;
    }

    return {
      eventKey: event.key,
      claimedAt: claimedAt.toISOString(),
      granted: reward,
    };
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

  /**
   * Phase 15.3.B — recompute giống `recomputeStatuses` nhưng trả về danh
   * sách rows thực sự transition để caller (cron processor / admin
   * recompute trigger) broadcast WS event.
   *
   * Strategy:
   *   1. `findMany` candidates trước khi `updateMany` — lấy ID + metadata.
   *   2. `updateMany WHERE id IN (...) AND status = expected` — atomic
   *      transition; race với worker khác sẽ chỉ count rows worker này
   *      thắng. Idempotent: gọi lại trả `count=0`.
   *   3. Map rows winner → `LiveOpsScheduledEventView` cho broadcast.
   *
   * KHÔNG thay đổi behavior `recomputeStatuses` legacy — guard bằng
   * method mới riêng. Cron processor có thể tuỳ chọn dùng method này
   * khi muốn broadcast.
   */
  async recomputeStatusesWithTransitions(
    now: Date = new Date(),
  ): Promise<RecomputeWithTransitionsSummary> {
    // SCHEDULED → ACTIVE
    const activatedCandidates =
      await this.prisma.liveOpsScheduledEvent.findMany({
        where: {
          status: 'SCHEDULED',
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
      });
    let activatedCount = 0;
    let activatedViews: LiveOpsScheduledEventView[] = [];
    if (activatedCandidates.length > 0) {
      const upd = await this.prisma.liveOpsScheduledEvent.updateMany({
        where: {
          id: { in: activatedCandidates.map((r) => r.id) },
          status: 'SCHEDULED',
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
        data: { status: 'ACTIVE' },
      });
      activatedCount = upd.count;
      if (upd.count > 0) {
        const winners = activatedCandidates.slice(0, upd.count);
        activatedViews = winners.map((r) =>
          toView({ ...r, status: 'ACTIVE' }),
        );
      }
    }

    // SCHEDULED past endsAt → ENDED (skip-to-ended) — KHÔNG broadcast
    // ANNOUNCEMENT_ENDED-equivalent vì chưa từng ACTIVE.
    let skippedCount = 0;
    const skippedCandidates =
      await this.prisma.liveOpsScheduledEvent.findMany({
        where: {
          status: 'SCHEDULED',
          endsAt: { lte: now },
        },
      });
    if (skippedCandidates.length > 0) {
      const upd = await this.prisma.liveOpsScheduledEvent.updateMany({
        where: {
          id: { in: skippedCandidates.map((r) => r.id) },
          status: 'SCHEDULED',
          endsAt: { lte: now },
        },
        data: { status: 'ENDED' },
      });
      skippedCount = upd.count;
    }

    // ACTIVE → ENDED
    const endedCandidates = await this.prisma.liveOpsScheduledEvent.findMany({
      where: {
        status: 'ACTIVE',
        endsAt: { lte: now },
      },
    });
    let endedCount = 0;
    let endedViews: LiveOpsScheduledEventView[] = [];
    if (endedCandidates.length > 0) {
      const upd = await this.prisma.liveOpsScheduledEvent.updateMany({
        where: {
          id: { in: endedCandidates.map((r) => r.id) },
          status: 'ACTIVE',
          endsAt: { lte: now },
        },
        data: { status: 'ENDED' },
      });
      endedCount = upd.count;
      if (upd.count > 0) {
        const winners = endedCandidates.slice(0, upd.count);
        endedViews = winners.map((r) => toView({ ...r, status: 'ENDED' }));
      }
    }

    const summary: RecomputeWithTransitionsSummary = {
      scannedAt: now.toISOString(),
      toActivated: activatedCount,
      toEnded: skippedCount + endedCount,
      activated: activatedViews,
      ended: endedViews,
    };
    if (summary.toActivated > 0 || summary.toEnded > 0) {
      this.logger.log(
        `recompute(+broadcast): activated=${summary.toActivated} ended=${summary.toEnded}`,
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

/**
 * Phase 15.3.B — Map `LiveOpsScheduledEventView` → public-safe broadcast
 * payload (`LiveOpsEventBroadcastPayload`). Strip `configJson` /
 * `createdByAdminId` — chỉ expose key/type/title/description/window/
 * runtimeSupported. FE refetch detail qua `GET /liveops/events/active`
 * nếu cần multiplier / reward.
 */
export function toLiveOpsEventBroadcastPayload(
  view: LiveOpsScheduledEventView,
  type: 'LIVEOPS_EVENT_ACTIVE' | 'LIVEOPS_EVENT_ENDED' | 'LIVEOPS_EVENT_UPDATED',
): import('@xuantoi/shared').LiveOpsEventBroadcastPayload {
  const runtimeSupported = isValidLiveOpsScheduledEventType(view.type)
    ? isLiveOpsRuntimeSupported(view.type)
    : false;
  return {
    type,
    eventKey: view.key,
    eventType: view.type,
    title: view.title,
    description: view.description,
    startsAt: view.startsAt,
    endsAt: view.endsAt,
    runtimeSupported,
  };
}
