/**
 * Phase 17.5 — Metrics types.
 *
 * Public shape của payload `GET /api/admin/metrics`. Mọi field
 * Prometheus-safe (số / boolean / string ngắn) — KHÔNG chứa secret /
 * env / cookie / token / PII. Mỗi sub-section optional fail-soft: nếu
 * collect lỗi, field đó là `null` (không phá toàn bộ response).
 */

export interface SystemMetrics {
  /** ms từ khi process start. */
  uptimeMs: number;
  node: {
    version: string;
    platform: string;
  };
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
  };
  /** µs cumulative kể từ process start. Snapshot — không trừ delta giữa 2 call. */
  cpu: {
    userMicros: number;
    systemMicros: number;
  };
  pid: number;
  appVersion: string;
  /** ISO timestamp lúc collect. */
  collectedAt: string;
}

export interface ApiRequestSnapshot {
  totalRequests: number;
  totalDurationMs: number;
  /** Trung bình ms / request — 0 nếu chưa có request nào. */
  avgDurationMs: number;
  /** Đếm theo HTTP method. Bounded set: GET/POST/PUT/PATCH/DELETE/OPTIONS/HEAD/OTHER. */
  byMethod: Record<string, number>;
  /** Đếm theo status bucket: 1xx/2xx/3xx/4xx/5xx/other. */
  byStatusBucket: Record<string, number>;
  /** Số request đang in-flight tại thời điểm snapshot. */
  inFlight: number;
  /** Lần reset gần nhất (ISO). Null nếu chưa reset (lifetime). */
  lastResetAt: string | null;
}

export interface ApiMetrics {
  request: ApiRequestSnapshot;
}

export interface WsMetrics {
  /** Số user online (mỗi user có thể có nhiều socket). */
  onlineUsers: number;
  /** True nếu RealtimeService đã `bind(server)` xong. */
  serverBound: boolean;
}

export interface QueueDepth {
  name: string;
  /** Số job chờ xử lý (BullMQ list `bull:<name>:wait`). */
  waiting: number;
  /** Số job đang xử lý. */
  active: number;
  /** Số job delayed. */
  delayed: number;
  /** Số job completed (zset, có TTL retention). */
  completed: number;
  /** Số job failed. */
  failed: number;
}

export interface QueueMetrics {
  /** False nếu Redis unavailable / queue chưa init. */
  available: boolean;
  /** Mỗi queue 1 row, fail-soft 0 nếu key chưa tồn tại. */
  queues: QueueDepth[];
}

export interface CronRunInfo {
  /** Tag ngắn (vd `territory-weekly` / `sect-season-snapshot` / `economy-ledger-check`). */
  job: string;
  /** ISO timestamp run gần nhất. Null nếu chưa run lần nào. */
  lastRunAt: string | null;
  /** OK / ISSUES_FOUND / ERROR / RUNNING / null. */
  lastStatus: string | null;
  /** Optional context key (periodKey / dayBucket / seasonKey). */
  contextKey?: string | null;
}

export interface CronMetrics {
  available: boolean;
  jobs: CronRunInfo[];
}

export interface MetricsSnapshot {
  /** Schema version. Bump khi đổi shape. */
  schema: 1;
  generatedAt: string;
  system: SystemMetrics;
  api: ApiMetrics;
  ws: WsMetrics | null;
  queue: QueueMetrics | null;
  cron: CronMetrics | null;
  /** Errors fail-soft từ các collector — chỉ stage + message, không stack. */
  errors: ReadonlyArray<{ stage: string; message: string }>;
}
