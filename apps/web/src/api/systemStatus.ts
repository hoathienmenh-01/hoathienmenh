/**
 * Phase 43 — System Status admin client.
 *
 * Wrap REST endpoints `/admin/system/*` (read-only ops dashboard).
 * KHÔNG depend trên admin-control-center permission types — Phase 43
 * dùng AdminGuard (ADMIN|MOD đều xem được).
 */
import { apiClient } from './client';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; meta?: unknown };
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env.ok || env.data === undefined || env.data === null) {
    const err = env.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), {
      code: err.code,
      meta: err.meta,
    });
  }
  return env.data;
}

export type SystemHealthStatus = 'ok' | 'degraded' | 'down';
export type SystemErrorSeverity = 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface SystemDependencyCheck {
  status: SystemHealthStatus;
  latencyMs?: number;
  error?: string;
}

export interface SystemStatusSnapshot {
  status: SystemHealthStatus;
  serviceName: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  version: string;
  buildCommit: string;
  node: string;
  checks: {
    api: { status: SystemHealthStatus };
    db: SystemDependencyCheck;
    redis: SystemDependencyCheck;
  };
  recentErrors: {
    last24h: number;
    bySeverity: Record<SystemErrorSeverity, number>;
  };
  adminActivity: { last24h: number };
  integrity: SystemIntegrityLastRun | null;
}

export interface SystemErrorRow {
  id: string;
  type: string;
  severity: string;
  policy: string | null;
  userId: string | null;
  characterId: string | null;
  createdAt: string;
  detailJson: Record<string, unknown>;
}

export interface SystemErrorListResult {
  rows: SystemErrorRow[];
  total: number;
}

export interface SystemIntegrityIssue {
  scope: string;
  severity: SystemErrorSeverity;
  message: string;
  count?: number;
}

export interface SystemIntegrityLastRun {
  runAt: string;
  status: 'CLEAN' | 'ISSUES';
  scopes: string[];
  issueCount: number;
  issues: SystemIntegrityIssue[];
}

export async function fetchSystemStatus(): Promise<SystemStatusSnapshot> {
  const { data } = await apiClient.get<Envelope<SystemStatusSnapshot>>(
    '/admin/system/status',
  );
  return unwrap(data);
}

export interface ListSystemErrorsOpts {
  limit?: number;
  severity?: SystemErrorSeverity;
  type?: string;
  since?: string;
}

export async function listSystemErrors(
  opts: ListSystemErrorsOpts = {},
): Promise<SystemErrorListResult> {
  const params: Record<string, string | number> = {};
  if (typeof opts.limit === 'number') params.limit = opts.limit;
  if (opts.severity) params.severity = opts.severity;
  if (opts.type) params.type = opts.type;
  if (opts.since) params.since = opts.since;
  const { data } = await apiClient.get<Envelope<SystemErrorListResult>>(
    '/admin/system/errors',
    { params },
  );
  return unwrap(data);
}

export async function fetchSystemIntegrityLastRun(): Promise<SystemIntegrityLastRun | null> {
  const { data } = await apiClient.get<Envelope<SystemIntegrityLastRun | null>>(
    '/admin/system/integrity/last-run',
  );
  if (!data.ok) {
    const err = data.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  return data.data ?? null;
}
