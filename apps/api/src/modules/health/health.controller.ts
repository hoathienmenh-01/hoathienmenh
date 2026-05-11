import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../common/prisma.service';
import { REDIS_CONNECTION } from '../../common/redis.module';
import { SkipRateLimit } from '../security/rate-limit-policy.decorator';

const START_TIME = Date.now();

interface ReadyResult {
  ok: boolean;
  checks: {
    db: { ok: boolean; latencyMs?: number; error?: string };
    redis: { ok: boolean; latencyMs?: number; error?: string };
  };
}

/**
 * Phase 18.1 — Healthcheck/readiness/version BẮT BUỘC bypass RateLimitGuard.
 * Nếu LB/monitoring spam ping → không được trả 429, không tạo
 * SecurityEvent. `@SkipRateLimit()` ở class-level apply cho tất cả
 * handler.
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
}
