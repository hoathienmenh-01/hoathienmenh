/**
 * Phase 17.2 — Admin Backup API client.
 *
 * Endpoints:
 *   - `GET  /admin/backup/status`  — health + latest backup/verify metadata.
 *   - `POST /admin/backup/run`     — manual trigger backup (ADMIN only).
 *   - `POST /admin/backup/verify`  — manual trigger verify-restore (ADMIN).
 *
 * KHÔNG có endpoint restore — destructive ops làm tay theo
 * `docs/RUNBOOK.md`. FE chỉ hiển thị status + 2 nút trigger an toàn.
 */
import type {
  BackupRunSummary,
  BackupStatusResponse,
  BackupVerifyRunSummary,
} from '@xuantoi/shared';
import { apiClient } from './client';

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

export async function adminGetBackupStatus(): Promise<BackupStatusResponse> {
  const { data } = await apiClient.get<Envelope<BackupStatusResponse>>(
    '/admin/backup/status',
  );
  return unwrap(data);
}

export async function adminRunBackup(): Promise<BackupRunSummary> {
  const { data } = await apiClient.post<Envelope<BackupRunSummary>>(
    '/admin/backup/run',
  );
  return unwrap(data);
}

export interface RunVerifyParams {
  backupRunId?: string;
}

export async function adminRunBackupVerify(
  params: RunVerifyParams = {},
): Promise<BackupVerifyRunSummary> {
  const body: Record<string, unknown> = {};
  if (params.backupRunId) body.backupRunId = params.backupRunId;
  const { data } = await apiClient.post<Envelope<BackupVerifyRunSummary>>(
    '/admin/backup/verify',
    body,
  );
  return unwrap(data);
}
