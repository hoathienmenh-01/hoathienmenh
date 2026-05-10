/**
 * Phase 17.5 — Metrics service (aggregator).
 *
 * Mỗi `collect*` method **fail-soft** — bắt mọi exception, trả default
 * empty + push entry vào `errors[]`. KHÔNG được phép throw ra ngoài
 * `collectAll()` để tránh phá toàn bộ payload `/admin/metrics` khi 1
 * dependency lỗi (vd Redis down, Prisma timeout, RealtimeService chưa
 * bind).
 *
 * Bounded scope:
 *   - System: process.uptime / memoryUsage / cpuUsage (sync, no I/O).
 *   - API: snapshot từ `request-metrics.middleware` (sync, no I/O).
 *   - WS: `RealtimeService.countOnline()` (sync) + `isBound`.
 *   - Queue: scan BullMQ key qua Redis `llen` / `zcard` cho 7 queue đã
 *     khai báo. KHÔNG throw nếu Redis down → trả `available=false`.
 *   - Cron: query Prisma `findFirst` cho 4 model có `lastRunAt` shape:
 *       EconomyLedgerCheckRun (ledger check)
 *       SectTerritorySettlementSnapshot (territory settle)
 *       SectTerritoryDecayLog (territory decay)
 *       SectSeasonSnapshot (sect season snapshot)
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CONNECTION } from '../../common/redis.module';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { readRequestMetricsSnapshot } from './request-metrics.middleware';
import type {
  ApiMetrics,
  CronMetrics,
  CronRunInfo,
  MetricsSnapshot,
  QueueDepth,
  QueueMetrics,
  SystemMetrics,
  WsMetrics,
} from './metrics.types';

const PROCESS_START_MS = Date.now();

/**
 * Danh sách queue BullMQ được khai báo trong codebase. Liệt kê cứng để
 * metrics service KHÔNG cần inject toàn bộ Queue (tránh circular import +
 * khóa lifecycle). Nếu repo thêm queue mới, append vào đây.
 *
 * BullMQ default prefix `bull:`. Fail-soft nếu queue chưa init / Redis
 * trống → mọi count = 0.
 */
const KNOWN_QUEUES = [
  'cultivation',
  'ops',
  'mission-reset',
  'territory-cron',
  'sect-season-cron',
  'ledger-checker-cron',
  'anomaly-scanner-cron',
] as const;

const BULL_PREFIX = 'bull';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @Inject(REDIS_CONNECTION) private readonly redis: Redis,
  ) {}

  // ---------- System ----------

  collectSystemMetrics(): SystemMetrics {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    return {
      uptimeMs: Date.now() - PROCESS_START_MS,
      node: {
        version: process.version,
        platform: process.platform,
      },
      memory: {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        externalBytes: mem.external,
      },
      cpu: {
        userMicros: cpu.user,
        systemMicros: cpu.system,
      },
      pid: process.pid,
      appVersion: process.env.APP_VERSION ?? '0.0.1',
      collectedAt: new Date().toISOString(),
    };
  }

  // ---------- API request ----------

  collectApiMetrics(): ApiMetrics {
    const snap = readRequestMetricsSnapshot();
    return {
      request: {
        totalRequests: snap.totalRequests,
        totalDurationMs: snap.totalDurationMs,
        avgDurationMs: snap.avgDurationMs,
        byMethod: snap.byMethod,
        byStatusBucket: snap.byStatusBucket,
        inFlight: snap.inFlight,
        lastResetAt: snap.lastResetAt,
      },
    };
  }

  // ---------- WebSocket ----------

  collectWsMetrics(): WsMetrics {
    // RealtimeService methods không throw — tự safe.
    return {
      onlineUsers: this.realtime.countOnline(),
      // RealtimeService chỉ bind khi có ít nhất 1 connection — proxy
      // qua presence: nếu countOnline > 0 thì server chắc chắn đã bind.
      // Edge case 0 user: vẫn trả true vì gateway đã start (Nest đã
      // boot xong nếu metrics endpoint reachable).
      serverBound: true,
    };
  }

  // ---------- BullMQ queue depth ----------

  /**
   * Scan key BullMQ qua Redis để đếm depth. Fail-soft:
   *   - Redis lỗi → return `{ available: false, queues: [] }`.
   *   - Queue key chưa tồn tại → count = 0 (empty queue).
   */
  async collectQueueMetrics(): Promise<QueueMetrics> {
    try {
      const queues: QueueDepth[] = [];
      for (const name of KNOWN_QUEUES) {
        const depth = await this.queueDepth(name);
        queues.push(depth);
      }
      return { available: true, queues };
    } catch (e) {
      // Redis disconnect / pipeline crash. KHÔNG throw — caller fail-soft.
      this.logger.warn(
        `collectQueueMetrics fail-soft: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { available: false, queues: [] };
    }
  }

  private async queueDepth(name: string): Promise<QueueDepth> {
    const k = (suffix: string): string => `${BULL_PREFIX}:${name}:${suffix}`;
    // Multi-call parallel — fail-soft từng key.
    const [waiting, active, delayed, completed, failed] = await Promise.all([
      this.safeLen(k('wait'), 'list'),
      this.safeLen(k('active'), 'list'),
      this.safeLen(k('delayed'), 'zset'),
      this.safeLen(k('completed'), 'zset'),
      this.safeLen(k('failed'), 'zset'),
    ]);
    return { name, waiting, active, delayed, completed, failed };
  }

  private async safeLen(
    key: string,
    kind: 'list' | 'zset',
  ): Promise<number> {
    try {
      if (kind === 'list') {
        const n = await this.redis.llen(key);
        return Number.isFinite(n) ? n : 0;
      }
      const n = await this.redis.zcard(key);
      return Number.isFinite(n) ? n : 0;
    } catch {
      // Wrong type / disconnect — coi như 0, KHÔNG escalate.
      return 0;
    }
  }

  // ---------- Cron last-run ----------

  /**
   * Query DB cho last-run state. Mỗi job 1 query independent — 1 fail
   * KHÔNG block job khác.
   */
  async collectCronMetrics(): Promise<CronMetrics> {
    const jobs: CronRunInfo[] = [];

    jobs.push(
      await this.cronInfo('economy-ledger-check', async () => {
        const row = await this.prisma.economyLedgerCheckRun.findFirst({
          orderBy: { startedAt: 'desc' },
          select: {
            startedAt: true,
            status: true,
            dayBucket: true,
          },
        });
        if (!row) return { lastRunAt: null, lastStatus: null, contextKey: null };
        return {
          lastRunAt: row.startedAt.toISOString(),
          lastStatus: row.status,
          contextKey: row.dayBucket,
        };
      }),
    );

    jobs.push(
      await this.cronInfo('territory-settle', async () => {
        const row = await this.prisma.sectTerritorySettlementSnapshot.findFirst({
          orderBy: { settledAt: 'desc' },
          select: { settledAt: true, periodKey: true },
        });
        if (!row) return { lastRunAt: null, lastStatus: null, contextKey: null };
        return {
          lastRunAt: row.settledAt.toISOString(),
          lastStatus: 'OK',
          contextKey: row.periodKey,
        };
      }),
    );

    jobs.push(
      await this.cronInfo('territory-decay', async () => {
        const row = await this.prisma.sectTerritoryDecayLog.findFirst({
          orderBy: { triggeredAt: 'desc' },
          select: { triggeredAt: true, periodKey: true },
        });
        if (!row) return { lastRunAt: null, lastStatus: null, contextKey: null };
        return {
          lastRunAt: row.triggeredAt.toISOString(),
          lastStatus: 'OK',
          contextKey: row.periodKey,
        };
      }),
    );

    jobs.push(
      await this.cronInfo('sect-season-snapshot', async () => {
        const row = await this.prisma.sectSeasonSnapshot.findFirst({
          orderBy: { finalizedAt: 'desc' },
          select: { finalizedAt: true, seasonKey: true },
        });
        if (!row) return { lastRunAt: null, lastStatus: null, contextKey: null };
        return {
          lastRunAt: row.finalizedAt.toISOString(),
          lastStatus: 'OK',
          contextKey: row.seasonKey,
        };
      }),
    );

    return { available: true, jobs };
  }

  private async cronInfo(
    job: string,
    fetch: () => Promise<{
      lastRunAt: string | null;
      lastStatus: string | null;
      contextKey: string | null;
    }>,
  ): Promise<CronRunInfo> {
    try {
      const r = await fetch();
      return {
        job,
        lastRunAt: r.lastRunAt,
        lastStatus: r.lastStatus,
        contextKey: r.contextKey,
      };
    } catch (e) {
      this.logger.warn(
        `cronInfo[${job}] fail-soft: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { job, lastRunAt: null, lastStatus: null, contextKey: null };
    }
  }

  // ---------- Aggregate ----------

  async collectAll(): Promise<MetricsSnapshot> {
    const errors: { stage: string; message: string }[] = [];

    // System / API là sync — không thể throw async, nhưng vẫn try/catch
    // để future-proof.
    let system: SystemMetrics;
    try {
      system = this.collectSystemMetrics();
    } catch (e) {
      errors.push({ stage: 'system', message: msg(e) });
      system = emptySystem();
    }

    let api: ApiMetrics;
    try {
      api = this.collectApiMetrics();
    } catch (e) {
      errors.push({ stage: 'api', message: msg(e) });
      api = emptyApi();
    }

    let ws: WsMetrics | null = null;
    try {
      ws = this.collectWsMetrics();
    } catch (e) {
      errors.push({ stage: 'ws', message: msg(e) });
    }

    let queue: QueueMetrics | null = null;
    try {
      queue = await this.collectQueueMetrics();
    } catch (e) {
      errors.push({ stage: 'queue', message: msg(e) });
    }

    let cron: CronMetrics | null = null;
    try {
      cron = await this.collectCronMetrics();
    } catch (e) {
      errors.push({ stage: 'cron', message: msg(e) });
    }

    return {
      schema: 1,
      generatedAt: new Date().toISOString(),
      system,
      api,
      ws,
      queue,
      cron,
      errors,
    };
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function emptySystem(): SystemMetrics {
  return {
    uptimeMs: 0,
    node: { version: process.version, platform: process.platform },
    memory: {
      rssBytes: 0,
      heapUsedBytes: 0,
      heapTotalBytes: 0,
      externalBytes: 0,
    },
    cpu: { userMicros: 0, systemMicros: 0 },
    pid: process.pid,
    appVersion: process.env.APP_VERSION ?? '0.0.1',
    collectedAt: new Date().toISOString(),
  };
}

function emptyApi(): ApiMetrics {
  return {
    request: {
      totalRequests: 0,
      totalDurationMs: 0,
      avgDurationMs: 0,
      byMethod: {},
      byStatusBucket: {},
      inFlight: 0,
      lastResetAt: null,
    },
  };
}
