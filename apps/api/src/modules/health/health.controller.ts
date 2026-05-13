import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../common/prisma.service';
import { REDIS_CONNECTION } from '../../common/redis.module';
import { SkipRateLimit } from '../security/rate-limit-policy.decorator';

const START_TIME = Date.now();

/** Hard upper bound cho mỗi dependency probe trong `/health/full`. */
const HEALTH_PROBE_TIMEOUT_MS = 2_000;

interface ReadyResult {
  ok: boolean;
  checks: {
    db: { ok: boolean; latencyMs?: number; error?: string };
    redis: { ok: boolean; latencyMs?: number; error?: string };
  };
}

/**
 * Phase 43 — Health status enum aliasing.
 *
 *   - `ok`        — dependency reachable + healthy.
 *   - `degraded`  — phản hồi chậm bất thường hoặc một dep optional fail.
 *   - `down`      — dependency critical fail / timeout.
 */
export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface DependencyCheck {
  status: HealthStatus;
  latencyMs?: number;
  error?: string;
}

export interface HealthFullResponse {
  status: HealthStatus;
  serviceName: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  version: string;
  buildCommit: string;
  node: string;
  checks: {
    db: DependencyCheck;
    redis: DependencyCheck;
  };
}

/**
 * Phase 18.1 — Healthcheck/readiness/version BẮT BUỘC bypass RateLimitGuard.
 * Nếu LB/monitoring spam ping → không được trả 429, không tạo
 * SecurityEvent. `@SkipRateLimit()` ở class-level apply cho tất cả
 * handler.
 *
 * Phase 43 — Bổ sung alias `/health/*` (`/health`, `/health/db`,
 * `/health/redis`, `/health/version`, `/health/full`) bên cạnh
 * `/healthz` / `/readyz` / `/version` cũ. Endpoint mới timeout-safe
 * (mọi DB / Redis probe đều có hard upper bound) + KHÔNG bao giờ leak
 * connection string / secret / env value ra response.
 */
@Controller()
@SkipRateLimit()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
  ) {}

  /** Liveness — process đang chạy, không check dependency. */
  @Get('healthz')
  health() {
    return {
      ok: true,
      uptimeMs: Date.now() - START_TIME,
      ts: new Date().toISOString(),
    };
  }

  /**
   * Phase 43 — Light health alias. Equivalent với `/healthz` (no dep
   * probe). Trả `status: ok` + uptime — dùng cho load balancer /
   * Kubernetes liveness probe (poll cao tần).
   */
  @Get('health')
  healthLight() {
    return {
      status: 'ok' as HealthStatus,
      serviceName: 'xuantoi-api',
      environment: this.safeEnvLabel(),
      uptimeSeconds: this.uptimeSeconds(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Phase 43 — DB-only probe alias. Timeout 2s, không bao giờ throw —
   * fail-soft trả `status: down` + error message scrub.
   */
  @Get('health/db')
  async healthDb(
    @Res({ passthrough: true }) res: Response,
  ): Promise<DependencyCheck> {
    const out = await probeDb(this.prisma);
    if (out.status !== 'ok') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return out;
  }

  /**
   * Phase 43 — Redis probe alias. Timeout 2s. Nếu Redis client chưa
   * kết nối → trả `status: down` thay vì throw (LB không cần stack
   * trace).
   */
  @Get('health/redis')
  async healthRedis(
    @Res({ passthrough: true }) res: Response,
  ): Promise<DependencyCheck> {
    const out = await probeRedis(this.redis);
    if (out.status !== 'ok') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return out;
  }

  /**
   * Phase 43 — Version alias. Cùng payload với `/version`, không lộ
   * commit message / build path / env value — chỉ name + version +
   * commit SHA + node runtime.
   */
  @Get('health/version')
  healthVersion() {
    return this.version();
  }

  /**
   * Phase 43 — Full health snapshot. Aggregate DB + Redis + version +
   * uptime + env label. Mỗi dep probe có timeout 2s.
   *
   * Status rollup:
   *   - critical DB `down` / `degraded` → top-level `down`.
   *   - Redis `down` nhưng DB `ok` → top-level `degraded` (Redis
   *     optional cho health gating; mất Redis = degraded chứ không
   *     hoàn toàn down).
   *
   * HTTP code: 200 khi `status==='ok'`, 503 cho `degraded` / `down` để
   * monitoring tự động alert.
   */
  @Get('health/full')
  async healthFull(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthFullResponse> {
    const [db, redis] = await Promise.all([
      probeDb(this.prisma),
      probeRedis(this.redis),
    ]);
    let status: HealthStatus = 'ok';
    if (db.status === 'down' || db.status === 'degraded') {
      status = db.status === 'down' ? 'down' : 'degraded';
    } else if (redis.status !== 'ok') {
      status = 'degraded';
    }
    if (status !== 'ok') res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status,
      serviceName: 'xuantoi-api',
      environment: this.safeEnvLabel(),
      uptimeSeconds: this.uptimeSeconds(),
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION ?? '0.0.1',
      buildCommit: process.env.GIT_SHA ?? 'unknown',
      node: process.version,
      checks: { db, redis },
    };
  }

  /** Readiness — check DB + Redis reachable. 200 nếu ok, 503 nếu không. */
  @Get('readyz')
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadyResult> {
    const out: ReadyResult = {
      ok: true,
      checks: { db: { ok: false }, redis: { ok: false } },
    };

    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      out.checks.db = { ok: true, latencyMs: Date.now() - dbStart };
    } catch (e) {
      out.checks.db = {
        ok: false,
        latencyMs: Date.now() - dbStart,
        error: e instanceof Error ? e.message : String(e),
      };
      out.ok = false;
    }

    const redisStart = Date.now();
    try {
      const pong = await this.redis.ping();
      out.checks.redis = {
        ok: pong === 'PONG',
        latencyMs: Date.now() - redisStart,
      };
      if (pong !== 'PONG') out.ok = false;
    } catch (e) {
      out.checks.redis = {
        ok: false,
        latencyMs: Date.now() - redisStart,
        error: e instanceof Error ? e.message : String(e),
      };
      out.ok = false;
    }

    if (!out.ok) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return out;
  }

  /** Version info — commit SHA + app version + runtime. */
  @Get('version')
  version() {
    return {
      name: '@xuantoi/api',
      version: process.env.APP_VERSION ?? '0.0.1',
      commit: process.env.GIT_SHA ?? 'unknown',
      node: process.version,
      ts: new Date().toISOString(),
    };
  }

  private uptimeSeconds(): number {
    return Math.max(0, Math.floor((Date.now() - START_TIME) / 1_000));
  }

  /** Label `production` / `staging` / `development` / `test` — không leak value khác. */
  private safeEnvLabel(): string {
    const env = (process.env.NODE_ENV ?? 'development').toLowerCase();
    if (env === 'production' || env === 'staging') return env;
    if (env === 'test') return 'test';
    return 'development';
  }
}

/**
 * Phase 43 — DB probe pure function (testable). Timeout 2s hard cap.
 *
 * Latency > 1s → `degraded` thay vì `ok` (gợi ý DB chậm).
 */
export async function probeDb(prisma: PrismaService): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, HEALTH_PROBE_TIMEOUT_MS);
    const latencyMs = Date.now() - start;
    return {
      status: latencyMs > 1_000 ? 'degraded' : 'ok',
      latencyMs,
    };
  } catch (e) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: sanitizeError(e),
    };
  }
}

/**
 * Phase 43 — Redis probe pure function. Cùng pattern timeout-safe;
 * latency > 500ms → `degraded`.
 */
export async function probeRedis(redis: Redis): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    const pong = await withTimeout(redis.ping(), HEALTH_PROBE_TIMEOUT_MS);
    if (pong !== 'PONG') {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        error: 'redis ping returned non-PONG',
      };
    }
    const latencyMs = Date.now() - start;
    return {
      status: latencyMs > 500 ? 'degraded' : 'ok',
      latencyMs,
    };
  } catch (e) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: sanitizeError(e),
    };
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`probe timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Scrub potential secret-like strings từ error message. Conservative:
 * cắt prefix `Error:` + trim đến 200 ký tự + redact URL-style password.
 */
function sanitizeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const noUrlPass = raw.replace(
    /:\/\/[^:@/]+:[^@/]+@/g,
    '://[REDACTED]:[REDACTED]@',
  );
  return noUrlPass.slice(0, 200);
}
