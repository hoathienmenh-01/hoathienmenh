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
 *
 * Read-only ở phía FE — chỉnh sửa qua `/admin/maintenance-windows/*`.
 */
import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
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
  };
});
