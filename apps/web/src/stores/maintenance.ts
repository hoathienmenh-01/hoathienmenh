/**
 * Phase 15.5 — Maintenance Window pinia store.
 *
 * - `start()` / `stop()` — bắt đầu / dừng poll `/maintenance/status` mỗi
 *   30s (best-effort; lỗi mạng = giữ giá trị cũ). Rerender component
 *   subscribed.
 * - `markBlockedByApi(payload)` — gọi từ axios interceptor khi request
 *   bị server trả 503 + `MAINTENANCE_ACTIVE`. Kích `blocked=true` để FE
 *   render overlay ngay (không cần đợi tick polling tiếp theo).
 * - `dismissBlockedToast()` — admin được phép tiếp tục dùng app (admin
 *   bypass), chỉ hiển thị banner thay vì overlay full-screen.
 * - `applyMaintenanceBroadcast(payload)` — Phase 15.8: nhận WS event
 *   `maintenance:status` và update store tức thì. Không cần đợi tick
 *   polling kế tiếp.
 *
 * Read-only ở phía FE — chỉnh sửa qua `/admin/maintenance-windows/*`.
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { MaintenanceBroadcastPayload } from '@xuantoi/shared';
import {
  getMaintenanceStatus,
  type MaintenanceWindowPublicView,
} from '@/api/maintenance';

const POLL_INTERVAL_MS = 30_000;

export interface MaintenanceBlockMeta {
  severity: string;
  target: string;
  titleVi: string;
  titleEn: string | null;
  messageVi: string;
  messageEn: string | null;
  endsAt: string;
  serverTime: string;
}

export const useMaintenanceStore = defineStore('maintenance', () => {
  const status = ref<MaintenanceWindowPublicView | null>(null);
  const blockedByApi = ref(false);
  const blockedMeta = ref<MaintenanceBlockMeta | null>(null);
  const lastFetchAt = ref<number | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  const active = computed<boolean>(() => status.value?.active === true);

  /**
   * `severity` được dùng để chọn style banner / overlay. Trả về `null`
   * khi không có maintenance ACTIVE.
   */
  const severity = computed<string | null>(() => status.value?.severity ?? null);

  async function refresh(): Promise<void> {
    const view = await getMaintenanceStatus();
    if (view) {
      status.value = view;
      lastFetchAt.value = Date.now();
      // Nếu maintenance đã hết (active=false) thì gỡ blockedByApi để
      // overlay biến mất ngay sau tick.
      if (!view.active) {
        blockedByApi.value = false;
        blockedMeta.value = null;
      }
    }
  }

  function start(): void {
    if (timer != null) return;
    void refresh();
    timer = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
  }

  function stop(): void {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function markBlockedByApi(meta: MaintenanceBlockMeta): void {
    blockedByApi.value = true;
    blockedMeta.value = meta;
    // Mirror vào status để overlay/ banner có dữ liệu mà không cần đợi
    // poll xong tick tiếp theo.
    status.value = {
      active: true,
      severity: meta.severity as MaintenanceWindowPublicView['severity'],
      target: meta.target as MaintenanceWindowPublicView['target'],
      titleVi: meta.titleVi,
      titleEn: meta.titleEn,
      messageVi: meta.messageVi,
      messageEn: meta.messageEn,
      startsAt: status.value?.startsAt ?? null,
      endsAt: meta.endsAt,
      serverTime: meta.serverTime,
      allowAdminBypass: status.value?.allowAdminBypass ?? true,
    };
  }

  function reset(): void {
    blockedByApi.value = false;
    blockedMeta.value = null;
  }

  /**
   * Phase 15.8 — apply WS `maintenance:status` broadcast payload tức thì.
   *
   * Rules:
   *   - `MAINTENANCE_ACTIVE` → set `status.active = true` cùng các field
   *     payload public-safe; reset `blockedByApi` để overlay hiển thị
   *     ngay (axios interceptor sẽ tự re-mark khi request kế tiếp 503).
   *   - `MAINTENANCE_ENDED` / `MAINTENANCE_DISABLED` → set
   *     `status.active = false`, clear `blockedByApi`/`blockedMeta` —
   *     overlay biến mất ngay.
   *
   * Idempotent: nhiều broadcast cùng key sẽ overwrite cùng trạng thái.
   * Không lấy dữ liệu cũ làm fallback — payload public-safe đã có đủ.
   */
  function applyMaintenanceBroadcast(
    payload: MaintenanceBroadcastPayload,
  ): void {
    lastFetchAt.value = Date.now();
    if (payload.type === 'MAINTENANCE_ACTIVE') {
      status.value = {
        active: true,
        severity: payload.severity,
        target: payload.target,
        titleVi: payload.titleVi,
        titleEn: payload.titleEn,
        messageVi: payload.messageVi,
        messageEn: payload.messageEn,
        startsAt: payload.startsAt,
        endsAt: payload.endsAt,
        serverTime: payload.serverTime,
        allowAdminBypass: payload.allowAdminBypass,
      };
      return;
    }
    // ENDED / DISABLED → clear active flag + clear blockedByApi.
    status.value = {
      active: false,
      severity: payload.severity,
      target: payload.target,
      titleVi: payload.titleVi,
      titleEn: payload.titleEn,
      messageVi: payload.messageVi,
      messageEn: payload.messageEn,
      startsAt: payload.startsAt,
      endsAt: payload.endsAt,
      serverTime: payload.serverTime,
      allowAdminBypass: payload.allowAdminBypass,
    };
    blockedByApi.value = false;
    blockedMeta.value = null;
  }

  return {
    status,
    blockedByApi,
    blockedMeta,
    lastFetchAt,
    active,
    severity,
    refresh,
    start,
    stop,
    markBlockedByApi,
    reset,
    applyMaintenanceBroadcast,
  };
});
