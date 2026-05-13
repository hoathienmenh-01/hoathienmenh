/**
 * Phase 43 — System Status admin service.
 *
 * Read-only aggregator cho `/admin/system/*` endpoints. KHÔNG tạo bảng
 * mới — reuse:
 *   - `HealthController.probeDb/probeRedis` (Phase 43 health alias).
 *   - `SecurityEvent` (Phase 18.1) — nguồn duy nhất cho "recent errors"
 *     thay vì tạo `SystemErrorLog` riêng.
 *   - `AdminAuditLog` (Phase 18.x) — đếm số admin action gần đây.
 *
 * Tất cả method fail-soft: bắt mọi exception trả default empty thay vì
 * throw — `/admin/system/status` phải luôn trả 200 cho admin xem state
 * ngay cả khi DB / Redis lỗi.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../common/prisma.service';
import { REDIS_CONNECTION } from '../../common/redis.module';
import {
  DependencyCheck,
  HealthStatus,
  probeDb,
  probeRedis,
} from '../health/health.controller';

/** Redis key prefix cho artefact ghi bởi `scripts/integrity-check.mjs`. */
export const INTEGRITY_LAST_RUN_REDIS_KEY = 'xt:system-status:integrity:last-run';

const SYSTEM_PROCESS_START = Date.now();

const RECENT_ERRORS_WINDOW_MS = 24 * 60 * 60 * 1_000;
const RECENT_ERRORS_DEFAULT_LIMIT = 20;
const RECENT_ERRORS_MAX_LIMIT = 100;

const ERROR_SEVERITIES = ['INFO', 'WARN', 'ERROR', 'FATAL'] as const;
export type SystemErrorSeverity = (typeof ERROR_SEVERITIES)[number];

export interface SystemStatusSnapshot {
  status: HealthStatus;
  serviceName: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  version: string;
  buildCommit: string;
  node: string;
  checks: {
    api: { status: HealthStatus };
    db: DependencyCheck;
    redis: DependencyCheck;
  };
  recentErrors: {
    last24h: number;
    bySeverity: Record<SystemErrorSeverity, number>;
  };
  adminActivity: {
    last24h: number;
  };
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
  /** detailJson scrubbed (KHÔNG bao giờ chứa token / password / cookie raw). */
  detailJson: Record<string, unknown>;
}

export interface SystemErrorListResult {
  rows: SystemErrorRow[];
  total: number;
}

export interface SystemErrorListOptions {
  limit?: number;
  severity?: SystemErrorSeverity;
  type?: string;
  /** ISO string. */
  since?: string;
}

export interface SystemIntegrityIssue {
  scope: string;
  severity: SystemErrorSeverity;
  /** Short human-readable message. */
  message: string;
  /** Optional count (vd: 3 ledger row với delta âm). */
  count?: number;
}

export interface SystemIntegrityLastRun {
  runAt: string;
  status: 'CLEAN' | 'ISSUES';
  scopes: string[];
  issueCount: number;
  /** Bounded to 50 to avoid Redis bloat. */
  issues: SystemIntegrityIssue[];
}

/**
 * Detail field allow-list. SecurityEvent.detailJson đã được Phase 18.1
 * sanitize, nhưng /admin/system/errors có thể được consume bởi admin
 * UI / log aggregator → defensive: chỉ pass-through các key safe đã
 * biết. Bất kỳ key khác → drop.
 */
const ALLOWED_DETAIL_KEYS: ReadonlySet<string> = new Set([
  'reason',
  'code',
  'route',
  'method',
  'statusCode',
  'durationMs',
  'requestId',
  'count',
  'window',
  'policy',
  'event',
  'source',
  'stage',
  'kind',
  'note',
]);

@Injectable()
export class SystemStatusService {
  private readonly logger = new Logger('SystemStatusService');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
  ) {}

  /** Aggregate snapshot. Mọi nhánh fail-soft. */
  async getStatus(): Promise<SystemStatusSnapshot> {
    const [db, redis, recent, adminCount, integrity] = await Promise.all([
      probeDb(this.prisma).catch(() => fallbackDown('db probe threw')),
      probeRedis(this.redis).catch(() => fallbackDown('redis probe threw')),
      this.countRecentErrors().catch(() => emptyRecent()),
      this.countRecentAdminActivity().catch(() => 0),
      this.getIntegrityLastRun().catch(() => null),
    ]);

    let status: HealthStatus = 'ok';
    if (db.status === 'down' || db.status === 'degraded') {
      status = db.status === 'down' ? 'down' : 'degraded';
    } else if (redis.status !== 'ok') {
      status = 'degraded';
    }

    return {
      status,
      serviceName: 'xuantoi-api',
      environment: safeEnvLabel(),
      uptimeSeconds: Math.max(
        0,
        Math.floor((Date.now() - SYSTEM_PROCESS_START) / 1_000),
      ),
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION ?? '0.0.1',
      buildCommit: process.env.GIT_SHA ?? 'unknown',
      node: process.version,
      checks: {
        api: { status: 'ok' },
        db,
        redis,
      },
      recentErrors: recent,
      adminActivity: { last24h: adminCount },
      integrity,
    };
  }

  /**
   * List recent error events. Read-only — không xoá, không sửa.
   *
   * Source: `SecurityEvent`. Đã được Phase 18.1 sanitize detailJson;
   * service vẫn thêm 1 lớp allow-list để đề phòng caller mới ghi key
   * nhạy cảm vô tình.
   */
  async listErrors(
    opts: SystemErrorListOptions = {},
  ): Promise<SystemErrorListResult> {
    const limit = clampLimit(
      opts.limit,
      RECENT_ERRORS_DEFAULT_LIMIT,
      RECENT_ERRORS_MAX_LIMIT,
    );

    const where: {
      severity?: SystemErrorSeverity;
      type?: string;
      createdAt?: { gte: Date };
    } = {};
    if (opts.severity && ERROR_SEVERITIES.includes(opts.severity)) {
      where.severity = opts.severity;
    }
    if (typeof opts.type === 'string' && opts.type.length > 0) {
      where.type = opts.type.slice(0, 64);
    }
    const sinceParsed = parseIsoOrNull(opts.since);
    if (sinceParsed) {
      where.createdAt = { gte: sinceParsed };
    }

    const [rows, total] = await Promise.all([
      this.prisma.securityEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          type: true,
          severity: true,
          policy: true,
          userId: true,
          characterId: true,
          createdAt: true,
          detailJson: true,
        },
      }),
      this.prisma.securityEvent.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        type: r.type,
        severity: r.severity,
        policy: r.policy,
        userId: r.userId,
        characterId: r.characterId,
        createdAt: r.createdAt.toISOString(),
        detailJson: scrubDetail(r.detailJson),
      })),
      total,
    };
  }

  /**
   * Đọc artefact integrity last-run từ Redis. Ghi bởi
   * `scripts/integrity-check.mjs` với TTL 7 ngày. Trả `null` nếu chưa
   * có run nào.
   */
  async getIntegrityLastRun(): Promise<SystemIntegrityLastRun | null> {
    try {
      const raw = await this.redis.get(INTEGRITY_LAST_RUN_REDIS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      return validateIntegrityRun(parsed);
    } catch (e) {
      this.logger.warn(
        `getIntegrityLastRun failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return null;
    }
  }

  private async countRecentErrors(): Promise<
    SystemStatusSnapshot['recentErrors']
  > {
    const since = new Date(Date.now() - RECENT_ERRORS_WINDOW_MS);
    const grouped = await this.prisma.securityEvent.groupBy({
      by: ['severity'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    const bySeverity: Record<SystemErrorSeverity, number> = {
      INFO: 0,
      WARN: 0,
      ERROR: 0,
      FATAL: 0,
    };
    let last24h = 0;
    for (const g of grouped) {
      const sev = g.severity as SystemErrorSeverity;
      const count = g._count?._all ?? 0;
      if (ERROR_SEVERITIES.includes(sev)) {
        bySeverity[sev] = count;
      }
      last24h += count;
    }
    return { last24h, bySeverity };
  }

  private async countRecentAdminActivity(): Promise<number> {
    const since = new Date(Date.now() - RECENT_ERRORS_WINDOW_MS);
    return this.prisma.adminAuditLog.count({
      where: { createdAt: { gte: since } },
    });
  }
}

function fallbackDown(error: string): DependencyCheck {
  return { status: 'down', error };
}

function emptyRecent(): SystemStatusSnapshot['recentErrors'] {
  return {
    last24h: 0,
    bySeverity: { INFO: 0, WARN: 0, ERROR: 0, FATAL: 0 },
  };
}

function clampLimit(
  raw: number | undefined,
  fallback: number,
  max: number,
): number {
  if (typeof raw !== 'number' || Number.isNaN(raw)) return fallback;
  if (raw < 1) return 1;
  if (raw > max) return max;
  return Math.floor(raw);
}

function parseIsoOrNull(s: string | undefined): Date | null {
  if (!s || typeof s !== 'string') return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function scrubDetail(detail: unknown): Record<string, unknown> {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail as Record<string, unknown>)) {
    if (!ALLOWED_DETAIL_KEYS.has(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    // drop other types (object/array/null) — không cần cho UI status panel
  }
  return out;
}

function validateIntegrityRun(raw: unknown): SystemIntegrityLastRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<SystemIntegrityLastRun>;
  if (typeof obj.runAt !== 'string') return null;
  if (obj.status !== 'CLEAN' && obj.status !== 'ISSUES') return null;
  const scopes = Array.isArray(obj.scopes)
    ? obj.scopes.filter((s): s is string => typeof s === 'string').slice(0, 20)
    : [];
  const issueCount = typeof obj.issueCount === 'number' ? obj.issueCount : 0;
  const issues = Array.isArray(obj.issues)
    ? obj.issues
        .filter((i): i is SystemIntegrityIssue => isValidIssue(i))
        .slice(0, 50)
    : [];
  return {
    runAt: obj.runAt,
    status: obj.status,
    scopes,
    issueCount,
    issues,
  };
}

function isValidIssue(i: unknown): boolean {
  if (!i || typeof i !== 'object') return false;
  const obj = i as Partial<SystemIntegrityIssue>;
  return (
    typeof obj.scope === 'string' &&
    typeof obj.message === 'string' &&
    typeof obj.severity === 'string' &&
    ERROR_SEVERITIES.includes(obj.severity as SystemErrorSeverity)
  );
}

function safeEnvLabel(): string {
  const env = (process.env.NODE_ENV ?? 'development').toLowerCase();
  if (env === 'production' || env === 'staging') return env;
  if (env === 'test') return 'test';
  return 'development';
}
