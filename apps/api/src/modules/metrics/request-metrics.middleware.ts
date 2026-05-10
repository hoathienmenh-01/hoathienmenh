/**
 * Phase 17.5 — Request metrics middleware (memory-bounded counter).
 *
 * Singleton in-memory counter cập nhật mỗi request. Chỉ track field
 * không-PII:
 *   - total request count + cumulative duration (cho avg).
 *   - count theo HTTP method (bounded set 8 entry).
 *   - count theo status bucket (1xx..5xx + other — 6 entry).
 *   - inFlight (gauge — tăng start, giảm finish).
 *
 * KHÔNG track per-path / per-user / per-IP để tránh memory leak (path
 * cardinality unbounded khi route param). Per-path histogram để
 * follow-up Phase 17.6.
 *
 * KHÔNG log body / header / cookie — middleware Pino đã có xử lý đó.
 *
 * Reuse `requestId` đã được `request-logger.middleware.ts` (Phase 17.3)
 * gắn lên `req.requestId`. Nếu chưa có (vd test mock), middleware này
 * KHÔNG sinh mới — không phải vai trò của nó.
 *
 * Pattern singleton state thay vì DI service: middleware Express phải
 * gọi được trong `app.use(...)` trước Nest scope, không có sẵn injector.
 */
import type { NextFunction, Request, Response } from 'express';

const KNOWN_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
]);

interface RequestMetricsState {
  totalRequests: number;
  totalDurationMs: number;
  byMethod: Record<string, number>;
  byStatusBucket: Record<string, number>;
  inFlight: number;
  lastResetAt: string | null;
}

function makeEmptyState(): RequestMetricsState {
  return {
    totalRequests: 0,
    totalDurationMs: 0,
    byMethod: {},
    byStatusBucket: {},
    inFlight: 0,
    lastResetAt: null,
  };
}

let STATE: RequestMetricsState = makeEmptyState();

/** Trả snapshot hiện tại. Caller (MetricsService) có thể gọi mỗi request không lo race. */
export function readRequestMetricsSnapshot(): RequestMetricsState & {
  avgDurationMs: number;
} {
  const avg =
    STATE.totalRequests > 0
      ? STATE.totalDurationMs / STATE.totalRequests
      : 0;
  return {
    totalRequests: STATE.totalRequests,
    totalDurationMs: STATE.totalDurationMs,
    avgDurationMs: avg,
    byMethod: { ...STATE.byMethod },
    byStatusBucket: { ...STATE.byStatusBucket },
    inFlight: STATE.inFlight,
    lastResetAt: STATE.lastResetAt,
  };
}

/** Reset toàn bộ state — dùng cho test, KHÔNG expose qua endpoint. */
export function resetRequestMetrics(): void {
  STATE = makeEmptyState();
  STATE.lastResetAt = new Date().toISOString();
}

/** Bucket status thành 1xx/2xx/3xx/4xx/5xx/other. */
function bucketStatus(status: number): string {
  if (status >= 100 && status < 200) return '1xx';
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'other';
}

function bucketMethod(method: string | undefined): string {
  if (!method) return 'OTHER';
  const m = method.toUpperCase();
  return KNOWN_METHODS.has(m) ? m : 'OTHER';
}

export interface RequestMetricsOptions {
  /** Path prefixes bị skip (vd healthz/readyz spam). */
  skipPathPrefixes?: string[];
}

/**
 * Tạo Express middleware. Gắn AFTER request-logger middleware (đã sinh
 * `requestId`) và TRƯỚC global prefix Nest router.
 */
export function createRequestMetricsMiddleware(
  options: RequestMetricsOptions = {},
): (req: Request, res: Response, next: NextFunction) => void {
  const skipPrefixes = options.skipPathPrefixes ?? [
    '/api/healthz',
    '/api/readyz',
    '/api/admin/metrics',
  ];

  return function requestMetrics(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const path = req.path ?? req.url ?? '';
    if (skipPrefixes.some((p) => path.startsWith(p))) {
      next();
      return;
    }

    const startedAt = Date.now();
    STATE.inFlight += 1;

    let recorded = false;
    const record = (): void => {
      if (recorded) return;
      recorded = true;
      const durationMs = Date.now() - startedAt;
      STATE.totalRequests += 1;
      STATE.totalDurationMs += durationMs;
      const m = bucketMethod(req.method);
      STATE.byMethod[m] = (STATE.byMethod[m] ?? 0) + 1;
      const s = bucketStatus(res.statusCode ?? 0);
      STATE.byStatusBucket[s] = (STATE.byStatusBucket[s] ?? 0) + 1;
      STATE.inFlight = Math.max(0, STATE.inFlight - 1);
    };

    res.on('finish', record);
    // `close` cho client abort trước finish — vẫn đếm để inFlight không leak.
    res.on('close', record);
    next();
  };
}
