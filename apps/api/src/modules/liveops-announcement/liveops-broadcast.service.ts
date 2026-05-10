/**
 * Phase 15.3.B — LiveOps WS broadcast adapter.
 *
 * Tách broadcast logic khỏi `LiveOpsAnnouncementService` /
 * `LiveOpsEventSchedulerService` cho 3 lý do:
 *   1. Test isolation — service core test pure-DB transitions,
 *      broadcast wiring test riêng.
 *   2. Fail-safe — nếu WS service crash / chưa bind, broadcast catch
 *      Error log warn và return — KHÔNG kéo theo status transition fail.
 *   3. Single source of truth payload — chỉ method này biết phải emit
 *      WS event type nào, channel nào.
 *
 * Channels:
 *   - `liveops:announcement` → cho `ANNOUNCEMENT_ACTIVE` /
 *     `ANNOUNCEMENT_ENDED`.
 *   - `liveops:event`        → cho `LIVEOPS_EVENT_ACTIVE` /
 *     `LIVEOPS_EVENT_ENDED` / `LIVEOPS_EVENT_UPDATED`.
 *
 * Anti-spam guard: caller chỉ truyền payload khi status thực sự
 * transition (xem `LiveOpsAnnouncementService.recomputeStatuses` /
 * `LiveOpsEventSchedulerService.recomputeStatuses`). Service này KHÔNG
 * tự dedupe — phụ thuộc caller.
 *
 * Target awareness: announcement có `target=ADMIN_ONLY` — KHÔNG broadcast
 * ra public room; emit qua `emitToRoom('admin')` thay thế. Phase 15.3.B
 * chưa wire admin room (cần JWT role check ở gateway), tạm thời
 * `ADMIN_ONLY` skip broadcast và rely vào polling `GET /admin/liveops/announcements`.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import type {
  LiveOpsAnnouncementBroadcastPayload,
  LiveOpsEventBroadcastPayload,
} from '@xuantoi/shared';
import {
  LIVEOPS_WS_CHANNEL_ANNOUNCEMENT,
  LIVEOPS_WS_CHANNEL_EVENT,
} from '@xuantoi/shared';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class LiveOpsBroadcastService {
  private readonly logger = new Logger(LiveOpsBroadcastService.name);

  constructor(
    @Optional() private readonly realtime: RealtimeService | null = null,
  ) {}

  /**
   * Broadcast announcement payload qua WS. `ADMIN_ONLY` target skip — rely
   * vào polling admin panel. Catch + log warn nếu realtime not wired.
   */
  broadcastAnnouncement(payload: LiveOpsAnnouncementBroadcastPayload): void {
    if (payload.target === 'ADMIN_ONLY') {
      // skip public broadcast — admin polling pattern.
      return;
    }
    try {
      if (!this.realtime) {
        this.logger.warn(
          `realtime service not wired — drop announcement broadcast key=${payload.key}`,
        );
        return;
      }
      this.realtime.broadcast(
        LIVEOPS_WS_CHANNEL_ANNOUNCEMENT,
        payload,
      );
    } catch (e) {
      // Fail-safe — không bao giờ throw lên caller.
      this.logger.warn(
        `announcement broadcast failed key=${payload.key} err=${(e as Error).message}`,
      );
    }
  }

  /**
   * Broadcast LiveOps event transition (Phase 15.1–15.2 →15.3.B integration).
   * Payload public-safe — caller phải tự strip configJson trước khi gọi.
   */
  broadcastEvent(payload: LiveOpsEventBroadcastPayload): void {
    try {
      if (!this.realtime) {
        this.logger.warn(
          `realtime service not wired — drop event broadcast key=${payload.eventKey}`,
        );
        return;
      }
      this.realtime.broadcast(LIVEOPS_WS_CHANNEL_EVENT, payload);
    } catch (e) {
      this.logger.warn(
        `event broadcast failed key=${payload.eventKey} err=${(e as Error).message}`,
      );
    }
  }
}
