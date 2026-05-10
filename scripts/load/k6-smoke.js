/**
 * Phase 17.5 — k6 smoke test.
 *
 * Quick sanity check (~10 giây, 1 VU). Verify API alive trước khi
 * chạy baseline/load test. KHÔNG chạy trong CI (k6 không cài sẵn).
 *
 * Run:
 *   k6 run scripts/load/k6-smoke.js
 *   BASE_URL=https://staging.xuantoi.example k6 run scripts/load/k6-smoke.js
 *
 * Env:
 *   BASE_URL  — default `http://localhost:3000`. Phải bao gồm scheme.
 *
 * Exit code:
 *   0 — tất cả check pass.
 *   ≠0 — ít nhất 1 check fail / threshold vi phạm.
 *
 * SECURITY: KHÔNG bao giờ chạy script này vào production khi chưa được
 * phép. KHÔNG commit token thật vào repo — token phải đến từ env.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

export const options = {
  vus: 1,
  duration: '10s',
  thresholds: {
    // Closed-beta gợi ý: smoke phải GẦN-ZERO error.
    http_req_failed: ['rate<0.01'],
    // p95 < 800ms cho health endpoint không quá khắt khe.
    http_req_duration: ['p(95)<800'],
  },
};

export default function () {
  const healthz = http.get(`${BASE_URL}/api/healthz`, {
    tags: { endpoint: 'healthz' },
  });
  check(healthz, {
    'healthz: 200': (r) => r.status === 200,
    'healthz: ok=true': (r) => {
      try {
        return r.json('ok') === true;
      } catch (_e) {
        return false;
      }
    },
  });

  const readyz = http.get(`${BASE_URL}/api/readyz`, {
    tags: { endpoint: 'readyz' },
  });
  check(readyz, {
    'readyz: 200 or 503': (r) => r.status === 200 || r.status === 503,
  });

  const version = http.get(`${BASE_URL}/api/version`, {
    tags: { endpoint: 'version' },
  });
  check(version, {
    'version: 200': (r) => r.status === 200,
    'version: has name': (r) => {
      try {
        return typeof r.json('name') === 'string';
      } catch (_e) {
        return false;
      }
    },
  });

  sleep(1);
}
