/**
 * Phase 15.5 — Maintenance Window API client.
 *
 * Public:
 *   - `getMaintenanceStatus()` — `GET /maintenance/status`. Anonymous-safe
 *     (route bypass cả khi maintenance ACTIVE). Fail-soft: trả `null` nếu
 *     API lỗi → FE coi như chưa biết, hiển thị bình thường.
 *
 * Admin:
 *   - `adminListMaintenanceWindows()` — `GET /admin/maintenance-windows`
 *   - `adminCreateMaintenanceWindow(input)` — `POST /admin/maintenance-windows`
 *   - `adminUpdateMaintenanceWindow(id, input)` — `PATCH /admin/maintenance-windows/:id`
 *   - `adminDisableMaintenanceWindow(id)` — `POST /admin/maintenance-windows/:id/disable`
 *   - `adminRecomputeMaintenanceStatus()` — `POST /admin/maintenance-windows/recompute-status`
 *
 * Type tái sử dụng từ `@xuantoi/shared` — đồng bộ FE+BE.
 */
import { apiClient } from './client';
import type {
  MaintenanceWindowAdminView,
  MaintenanceWindowPublicView,
  MaintenanceSeverity,
  MaintenanceTarget,
} from '@xuantoi/shared';

export type {
  MaintenanceWindowAdminView,
  MaintenanceWindowPublicView,
  MaintenanceSeverity,
  MaintenanceTarget,
} from '@xuantoi/shared';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env.ok || !env.data) {
    const err = env.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  return env.data;
}

export interface MaintenanceCreateInput {
  key: string;
  severity: MaintenanceSeverity;
  target: MaintenanceTarget;
  titleVi: string;
  titleEn?: string | null;
  messageVi: string;
  messageEn?: string | null;
  startsAt: string;
  endsAt: string;
  allowAdminBypass?: boolean;
  allowHealthcheck?: boolean;
  allowMetrics?: boolean;
  initialStatus?: 'DRAFT' | 'SCHEDULED';
}

export interface MaintenanceUpdateInput {
  severity?: MaintenanceSeverity;
  target?: MaintenanceTarget;
  titleVi?: string;
  titleEn?: string | null;
  messageVi?: string;
  messageEn?: string | null;
  startsAt?: string;
  endsAt?: string;
  allowAdminBypass?: boolean;
  allowHealthcheck?: boolean;
  allowMetrics?: boolean;
  status?: 'DRAFT' | 'SCHEDULED';
}

export async function getMaintenanceStatus(): Promise<MaintenanceWindowPublicView | null> {
  try {
    const { data } = await apiClient.get<
      Envelope<MaintenanceWindowPublicView>
    >('/maintenance/status');
    if (!data.ok || !data.data) return null;
    return data.data;
  } catch {
    return null;
  }
}

export async function adminListMaintenanceWindows(): Promise<
  MaintenanceWindowAdminView[]
> {
  const { data } = await apiClient.get<
    Envelope<{ windows: MaintenanceWindowAdminView[] }>
  >('/admin/maintenance-windows');
  return unwrap(data).windows;
}

export async function adminCreateMaintenanceWindow(
  input: MaintenanceCreateInput,
): Promise<MaintenanceWindowAdminView> {
  const { data } = await apiClient.post<
    Envelope<MaintenanceWindowAdminView>
  >('/admin/maintenance-windows', input);
  return unwrap(data);
}

export async function adminUpdateMaintenanceWindow(
  id: string,
  input: MaintenanceUpdateInput,
): Promise<MaintenanceWindowAdminView> {
  const { data } = await apiClient.patch<
    Envelope<MaintenanceWindowAdminView>
  >(`/admin/maintenance-windows/${encodeURIComponent(id)}`, input);
  return unwrap(data);
}

export async function adminDisableMaintenanceWindow(
  id: string,
): Promise<MaintenanceWindowAdminView> {
  const { data } = await apiClient.post<
    Envelope<MaintenanceWindowAdminView>
  >(`/admin/maintenance-windows/${encodeURIComponent(id)}/disable`, {});
  return unwrap(data);
}

export async function adminRecomputeMaintenanceStatus(): Promise<{
  scannedAt: string;
  activatedKeys: string[];
  endedKeys: string[];
}> {
  const { data } = await apiClient.post<
    Envelope<{
      scannedAt: string;
      activatedKeys: string[];
      endedKeys: string[];
    }>
  >('/admin/maintenance-windows/recompute-status', {});
  return unwrap(data);
}
