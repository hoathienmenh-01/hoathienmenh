/**
 * Phase 15.8 — Maintenance Window WS broadcast adapter.
 *
 * Tách broadcast logic khỏi `MaintenanceWindowService` để:
 *   1. Test isolation — service core test pure-DB transitions, broadcast
 *      wiring test riêng.
 *   2. Fail-safe — nếu Realtime service crash / chưa bind, broadcast catch
 *      Error + log warn và return. KHÔNG kéo theo DB transition rollback.
 *   3. Single source of truth payload — chỉ adapter này biết channel
 *      `maintenance:status` + event type `MAINTENANCE_ACTIVE/ENDED/DISABLED`.
 *
 * Anti-spam guard: caller chỉ truyền payload khi status thực sự transition
 * (xem `MaintenanceWindowService.recomputeStatuses` / `disableWindow`).
 * Service này KHÔNG tự dedupe — phụ thuộc caller idempotent layer.
 *
 * Public-safe: caller phải dùng `buildMaintenanceBroadcastPayload()` từ
 * shared để strip admin metadata (`createdByAdminId`, `disabledAt`, etc.)
 * TRƯỚC khi gọi `broadcast()`.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  MAINTENANCE_WS_CHANNEL,
  type MaintenanceBroadcastPayload,
} from '@xuantoi/shared';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class MaintenanceBroadcastService {
  private readonly logger = new Logger(MaintenanceBroadcastService.name);

  constructor(
    @Optional() private readonly realtime: RealtimeService | null = null,
  ) {}

  /**
   * Broadcast maintenance status transition payload qua WS. Fail-safe:
   * realtime null hoặc throw → catch log warn, KHÔNG rethrow để DB
   * transition không bị rollback.
   */
  broadcast(payload: MaintenanceBroadcastPayload): void {
    try {
      if (!this.realtime) {
        this.logger.warn(
          `realtime service not wired — drop maintenance broadcast key=${payload.key} type=${payload.type}`,
        );
        return;
      }
      this.realtime.broadcast(MAINTENANCE_WS_CHANNEL, payload);
    } catch (e) {
      this.logger.warn(
        `maintenance broadcast failed key=${payload.key} type=${payload.type} err=${
          (e as Error).message
        }`,
      );
    }
  }
}
