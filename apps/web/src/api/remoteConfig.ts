/**
 * Phase 45.0 — Remote Config API client.
 *
 * Exposes:
 *   - `getPublicRemoteConfigs()` — `GET /remote-config/public`. Trả mảng
 *     `{ key, value }` cho whitelist public. Anonymous-safe (no auth).
 *     Fail-soft: trả `[]` nếu API lỗi → FE coi như value = default catalog.
 *   - `getPublicConfigBundle()` — `GET /config/public`. Trả combined
 *     `{ flags, configs }` để FE boot có 1 round-trip duy nhất.
 *   - `adminListRemoteConfigs()` — `GET /admin/remote-config`.
 *   - `adminUpdateRemoteConfig(key, value, reason)` —
 *     `PATCH /admin/remote-config/:key`.
 *   - `adminRefreshRemoteConfigDefaults()` —
 *     `POST /admin/remote-config/refresh-defaults`.
 *   - `adminClearRemoteConfigCache()` —
 *     `POST /admin/remote-config/clear-cache`.
 *
 * Type tái sử dụng từ `@xuantoi/shared`.
 */
import { apiClient } from './client';
import type {
  FeatureFlagPublicView,
  RemoteConfigAdminView,
  RemoteConfigKey,
  RemoteConfigPublicView,
} from '@xuantoi/shared';

export type {
  RemoteConfigAdminView,
  RemoteConfigKey,
  RemoteConfigPublicView,
} from '@xuantoi/shared';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env.ok || !env.data) {
    const err = env.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), {
      code: err.code,
      details: err.details,
    });
  }
  return env.data;
}

export async function getPublicRemoteConfigs(): Promise<
  RemoteConfigPublicView[]
> {
  try {
    const { data } = await apiClient.get<
      Envelope<{ configs: RemoteConfigPublicView[] }>
    >('/remote-config/public');
    if (!data.ok || !data.data) return [];
    return data.data.configs;
  } catch {
    return [];
  }
}

export async function getPublicConfigBundle(): Promise<{
  flags: FeatureFlagPublicView[];
  configs: RemoteConfigPublicView[];
}> {
  try {
    const { data } = await apiClient.get<
      Envelope<{
        flags: FeatureFlagPublicView[];
        configs: RemoteConfigPublicView[];
      }>
    >('/config/public');
    if (!data.ok || !data.data) return { flags: [], configs: [] };
    return data.data;
  } catch {
    return { flags: [], configs: [] };
  }
}

export async function adminListRemoteConfigs(): Promise<
  RemoteConfigAdminView[]
> {
  const { data } = await apiClient.get<
    Envelope<{ configs: RemoteConfigAdminView[] }>
  >('/admin/remote-config');
  return unwrap(data).configs;
}

export async function adminUpdateRemoteConfig(
  key: RemoteConfigKey,
  value: unknown,
  reason: string,
): Promise<RemoteConfigAdminView> {
  const { data } = await apiClient.patch<Envelope<RemoteConfigAdminView>>(
    `/admin/remote-config/${encodeURIComponent(key)}`,
    { value, reason },
  );
  return unwrap(data);
}

export async function adminRefreshRemoteConfigDefaults(): Promise<{
  created: number;
  existing: number;
}> {
  const { data } = await apiClient.post<
    Envelope<{ created: number; existing: number }>
  >('/admin/remote-config/refresh-defaults', {});
  return unwrap(data);
}

export async function adminClearRemoteConfigCache(): Promise<{
  cleared: true;
}> {
  const { data } = await apiClient.post<Envelope<{ cleared: true }>>(
    '/admin/remote-config/clear-cache',
    {},
  );
  return unwrap(data);
}
