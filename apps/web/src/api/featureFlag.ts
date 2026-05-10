/**
 * Phase 15.4 — Feature Flag API client.
 *
 * Exposes:
 *   - `getPublicFeatureFlags()` — `GET /feature-flags/public`. Trả mảng
 *     `{ key, enabled }` cho whitelist public. Anonymous-safe (no auth).
 *     Fail-soft: trả `[]` nếu API lỗi → FE coi như flag default-on.
 *   - `adminListFeatureFlags()` — `GET /admin/feature-flags`. Trả full
 *     metadata cho admin panel.
 *   - `adminUpdateFeatureFlag(key, enabled)` — `PATCH /admin/feature-flags/:key`.
 *   - `adminRefreshFeatureFlagDefaults()` — `POST /admin/feature-flags/refresh-defaults`.
 *   - `adminClearFeatureFlagCache()` — `POST /admin/feature-flags/clear-cache`.
 *
 * Type tái sử dụng từ `@xuantoi/shared` để đồng bộ FE+BE.
 */
import { apiClient } from './client';
import type {
  FeatureFlagAdminView,
  FeatureFlagKey,
  FeatureFlagPublicView,
} from '@xuantoi/shared';

export type {
  FeatureFlagAdminView,
  FeatureFlagKey,
  FeatureFlagPublicView,
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

export async function getPublicFeatureFlags(): Promise<
  FeatureFlagPublicView[]
> {
  try {
    const { data } = await apiClient.get<
      Envelope<{ flags: FeatureFlagPublicView[] }>
    >('/feature-flags/public');
    if (!data.ok || !data.data) return [];
    return data.data.flags;
  } catch {
    return [];
  }
}

export async function adminListFeatureFlags(): Promise<
  FeatureFlagAdminView[]
> {
  const { data } = await apiClient.get<
    Envelope<{ flags: FeatureFlagAdminView[] }>
  >('/admin/feature-flags');
  return unwrap(data).flags;
}

export async function adminUpdateFeatureFlag(
  key: FeatureFlagKey,
  enabled: boolean,
): Promise<FeatureFlagAdminView> {
  const { data } = await apiClient.patch<Envelope<FeatureFlagAdminView>>(
    `/admin/feature-flags/${encodeURIComponent(key)}`,
    { enabled },
  );
  return unwrap(data);
}

export async function adminRefreshFeatureFlagDefaults(): Promise<{
  created: number;
  existing: number;
}> {
  const { data } = await apiClient.post<
    Envelope<{ created: number; existing: number }>
  >('/admin/feature-flags/refresh-defaults', {});
  return unwrap(data);
}

export async function adminClearFeatureFlagCache(): Promise<{
  cleared: true;
}> {
  const { data } = await apiClient.post<Envelope<{ cleared: true }>>(
    '/admin/feature-flags/clear-cache',
    {},
  );
  return unwrap(data);
}
