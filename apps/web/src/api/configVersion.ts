/**
 * Phase 15.6 — Config Version + Rollback admin API client.
 *
 * 5 endpoint admin (AdminGuard):
 *   - `GET    /admin/config-versions`
 *   - `GET    /admin/config-versions/:id`
 *   - `GET    /admin/config-versions/diff`
 *   - `POST   /admin/config-versions/:id/dry-run-rollback`
 *   - `POST   /admin/config-versions/:id/rollback`
 *
 * Type tái sử dụng từ `@xuantoi/shared` — đồng bộ FE+BE.
 */
import { apiClient } from './client';
import type {
  ConfigRollbackResponse,
  ConfigSnapshotDiffEntry,
  ConfigVersionAction,
  ConfigVersionEntityType,
  ConfigVersionSnapshot,
} from '@xuantoi/shared';

export type {
  ConfigRollbackResponse,
  ConfigRollbackSafetyLevel,
  ConfigSnapshotDiffEntry,
  ConfigVersionAction,
  ConfigVersionEntityType,
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

/** Row trả về từ list / get. Mirror `ConfigVersionView` ở API service. */
export interface ConfigVersionRow {
  id: string;
  entityType: ConfigVersionEntityType;
  entityId: string;
  version: number;
  action: ConfigVersionAction;
  beforeJson: ConfigVersionSnapshot | null;
  afterJson: ConfigVersionSnapshot;
  changedByAdminId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface ConfigVersionDiffResult {
  fromVersion: ConfigVersionRow;
  toVersion: ConfigVersionRow;
  changedFields: string[];
  diff: Record<string, ConfigSnapshotDiffEntry>;
}

export async function adminListConfigVersions(
  entityType: ConfigVersionEntityType,
  entityId: string,
  limit = 100,
): Promise<ConfigVersionRow[]> {
  const { data } = await apiClient.get<
    Envelope<{ versions: ConfigVersionRow[] }>
  >('/admin/config-versions', {
    params: { entityType, entityId, limit },
  });
  return unwrap(data).versions;
}

export async function adminGetConfigVersion(
  id: string,
): Promise<ConfigVersionRow> {
  const { data } = await apiClient.get<Envelope<ConfigVersionRow>>(
    `/admin/config-versions/${encodeURIComponent(id)}`,
  );
  return unwrap(data);
}

export async function adminDiffConfigVersions(
  fromVersionId: string,
  toVersionId: string,
): Promise<ConfigVersionDiffResult> {
  const { data } = await apiClient.get<Envelope<ConfigVersionDiffResult>>(
    '/admin/config-versions/diff',
    { params: { fromVersionId, toVersionId } },
  );
  return unwrap(data);
}

export async function adminDryRunConfigRollback(
  id: string,
  reason?: string,
): Promise<ConfigRollbackResponse> {
  const body = reason ? { reason } : {};
  const { data } = await apiClient.post<Envelope<ConfigRollbackResponse>>(
    `/admin/config-versions/${encodeURIComponent(id)}/dry-run-rollback`,
    body,
  );
  return unwrap(data);
}

export async function adminApplyConfigRollback(
  id: string,
  input: { reason?: string; confirmPhrase?: string } = {},
): Promise<ConfigRollbackResponse> {
  const { data } = await apiClient.post<Envelope<ConfigRollbackResponse>>(
    `/admin/config-versions/${encodeURIComponent(id)}/rollback`,
    input,
  );
  return unwrap(data);
}
