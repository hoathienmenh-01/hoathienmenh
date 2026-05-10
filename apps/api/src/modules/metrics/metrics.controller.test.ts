/**
 * Phase 17.5 — pure-unit tests cho `MetricsController`.
 *
 * Test bypass guard bằng cách instantiate trực tiếp (pattern khớp
 * `admin.controller.test.ts`). Guard logic test riêng ở
 * `admin.guard.test.ts`.
 *
 * Lock-in:
 *   - GET /admin/metrics → `{ ok: true, data: <MetricsSnapshot> }`.
 *   - Service collectAll error swallow ở đâu? — service đã fail-soft,
 *     controller nhận snapshot luôn có shape; KHÔNG throw 500 ngẫu nhiên.
 *   - SECURITY: response body KHÔNG chứa env/secret/cookie/token.
 */
import { describe, expect, it } from 'vitest';
import { MetricsController } from './metrics.controller';
import type { MetricsService } from './metrics.service';
import type { MetricsSnapshot } from './metrics.types';

function makeStubService(snapshot: MetricsSnapshot): MetricsService {
  return {
    collectAll: async () => snapshot,
  } as unknown as MetricsService;
}

const SAMPLE: MetricsSnapshot = {
  schema: 1,
  generatedAt: '2026-05-09T12:00:00.000Z',
  system: {
    uptimeMs: 12345,
    node: { version: 'v20.10.0', platform: 'linux' },
    memory: {
      rssBytes: 100,
      heapUsedBytes: 50,
      heapTotalBytes: 80,
      externalBytes: 10,
    },
    cpu: { userMicros: 1000, systemMicros: 500 },
    pid: 42,
    appVersion: '0.0.1',
    collectedAt: '2026-05-09T12:00:00.000Z',
  },
  api: {
    request: {
      totalRequests: 100,
      totalDurationMs: 5000,
      avgDurationMs: 50,
      byMethod: { GET: 80, POST: 20 },
      byStatusBucket: { '2xx': 95, '4xx': 5 },
      inFlight: 0,
      lastResetAt: null,
    },
  },
  ws: { onlineUsers: 3, serverBound: true },
  queue: {
    available: true,
    queues: [
      { name: 'cultivation', waiting: 0, active: 1, delayed: 0, completed: 5, failed: 0 },
    ],
  },
  cron: {
    available: true,
    jobs: [
      {
        job: 'economy-ledger-check',
        lastRunAt: '2026-05-09T01:00:00.000Z',
        lastStatus: 'OK',
        contextKey: '2026-05-09',
      },
    ],
  },
  errors: [],
};

describe('MetricsController.getMetrics', () => {
  it('trả ok=true + data shape đúng', async () => {
    const ctrl = new MetricsController(makeStubService(SAMPLE));
    const r = await ctrl.getMetrics();
    expect(r.ok).toBe(true);
    expect(r.data.schema).toBe(1);
    expect(r.data.system.uptimeMs).toBe(12345);
    expect(r.data.api.request.totalRequests).toBe(100);
    expect(r.data.ws?.onlineUsers).toBe(3);
    expect(r.data.queue?.queues[0]?.name).toBe('cultivation');
    expect(r.data.cron?.jobs[0]?.job).toBe('economy-ledger-check');
  });

  it('SECURITY: response KHÔNG có field nhạy cảm dù service trả nguyên snapshot', async () => {
    const ctrl = new MetricsController(makeStubService(SAMPLE));
    const r = await ctrl.getMetrics();
    const json = JSON.stringify(r);
    expect(/"cookie"\s*:/i.test(json)).toBe(false);
    expect(/"password"\s*:/i.test(json)).toBe(false);
    expect(/"jwt"\s*:/i.test(json)).toBe(false);
    expect(/"refreshToken"\s*:/i.test(json)).toBe(false);
    expect(/"userId"\s*:/i.test(json)).toBe(false);
    // characterId / email chỉ KHÔNG được có ở payload metrics chuẩn — sample này không có.
    expect(/"email"\s*:/i.test(json)).toBe(false);
    expect(/"characterId"\s*:/i.test(json)).toBe(false);
  });

  it('snapshot có errors[] vẫn trả ok=true (fail-soft, không 500)', async () => {
    const withErrors: MetricsSnapshot = {
      ...SAMPLE,
      errors: [
        { stage: 'queue', message: 'redis down' },
        { stage: 'cron', message: 'db timeout' },
      ],
      queue: null,
      cron: null,
    };
    const ctrl = new MetricsController(makeStubService(withErrors));
    const r = await ctrl.getMetrics();
    expect(r.ok).toBe(true);
    expect(r.data.errors).toHaveLength(2);
    expect(r.data.queue).toBeNull();
    expect(r.data.cron).toBeNull();
  });
});
