/**
 * Phase 17.5 — k6 API baseline.
 *
 * Mô phỏng 1 user flow đầy đủ: login → state → daily login → mission
 * → dungeon list → territory status. Default 3 VUs × 30s — đủ tạo
 * baseline p95 latency cho closed beta. KHÔNG chạy trong CI.
 *
 * Run:
 *   BASE_URL=http://localhost:3000 \
 *   TEST_EMAIL=loadtest@example.com \
 *   TEST_PASSWORD=ChangeMe!123 \
 *   k6 run scripts/load/k6-api-baseline.js
 *
 * Hoặc dùng pre-generated AUTH_TOKEN (cookie value `xt_access`):
 *   BASE_URL=http://localhost:3000 \
 *   AUTH_TOKEN=eyJhbGciOi... \
 *   k6 run scripts/load/k6-api-baseline.js
 *
 * Env:
 *   BASE_URL        — default `http://localhost:3000`.
 *   TEST_EMAIL      — required nếu KHÔNG có AUTH_TOKEN.
 *   TEST_PASSWORD   — required nếu KHÔNG có AUTH_TOKEN.
 *   AUTH_TOKEN      — optional; nếu set, bỏ qua login flow.
 *   VUS             — số VU đồng thời, default 3.
 *   DURATION        — duration string k6, default '30s'.
 *
 * Threshold gợi ý closed beta:
 *   - p95 < 1500ms.
 *   - Error rate < 5%.
 *   - Không 5xx (server error rate = 0).
 *
 * SECURITY:
 *   - KHÔNG hardcode email/password vào file.
 *   - KHÔNG chạy script vào production khi chưa được phép (rate-limit
 *     trigger, BAN_RISK, account lock). Default chỉ test staging.
 */
import http from 'k6/http';
import { check, fail, group, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const TEST_EMAIL = __ENV.TEST_EMAIL || '';
const TEST_PASSWORD = __ENV.TEST_PASSWORD || '';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

const VUS = parseInt(__ENV.VUS || '3', 10);
const DURATION = __ENV.DURATION || '30s';

const loginFailures = new Counter('xt_login_failures');
const flowFailures = new Counter('xt_flow_failures');
const flowSuccesses = new Rate('xt_flow_success_rate');

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1500'],
    'xt_login_failures': ['count<10'],
    'xt_flow_success_rate': ['rate>0.9'],
  },
};

function buildAuthCookieHeader(token) {
  return `xt_access=${token}`;
}

/**
 * Login qua POST /api/_auth/login. Trả token từ Set-Cookie hoặc
 * empty string nếu fail. KHÔNG throw — caller decide retry.
 */
function login() {
  if (AUTH_TOKEN) return AUTH_TOKEN;
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    fail('TEST_EMAIL/TEST_PASSWORD missing và không có AUTH_TOKEN. Đặt env trước khi run.');
  }

  const res = http.post(
    `${BASE_URL}/api/_auth/login`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'login' },
    },
  );

  if (res.status !== 200) {
    loginFailures.add(1);
    return '';
  }

  // Cookie có format `xt_access=<jwt>; Path=/; HttpOnly; ...`
  const setCookie = res.headers['Set-Cookie'] || res.headers['set-cookie'] || '';
  const m = /xt_access=([^;]+)/.exec(String(setCookie));
  return m ? m[1] : '';
}

export function setup() {
  const token = login();
  if (!token) {
    fail('Login thất bại — abort baseline. Kiểm tra TEST_EMAIL/PASSWORD hoặc API up.');
  }
  return { token };
}

export default function (data) {
  const cookieHeader = buildAuthCookieHeader(data.token);
  const headers = { Cookie: cookieHeader };
  let success = true;

  group('health', function () {
    const r = http.get(`${BASE_URL}/api/healthz`, { tags: { endpoint: 'healthz' } });
    if (!check(r, { 'healthz 200': (rr) => rr.status === 200 })) success = false;
  });

  group('character/state', function () {
    const r = http.get(`${BASE_URL}/api/character/state`, {
      headers,
      tags: { endpoint: 'character_state' },
    });
    if (!check(r, { 'character/state 200': (rr) => rr.status === 200 })) success = false;
  });

  group('daily-login/me', function () {
    const r = http.get(`${BASE_URL}/api/daily-login/me`, {
      headers,
      tags: { endpoint: 'daily_login_me' },
    });
    // 200 hoặc 401 (chưa onboard / cookie hết hạn).
    if (!check(r, { 'daily-login/me reachable': (rr) => rr.status < 500 })) success = false;
  });

  group('missions', function () {
    const r = http.get(`${BASE_URL}/api/missions/me`, {
      headers,
      tags: { endpoint: 'missions_me' },
    });
    if (!check(r, { 'missions/me reachable': (rr) => rr.status < 500 })) success = false;
  });

  group('dungeons', function () {
    const r = http.get(`${BASE_URL}/api/dungeons/me`, {
      headers,
      tags: { endpoint: 'dungeons_me' },
    });
    if (!check(r, { 'dungeons/me reachable': (rr) => rr.status < 500 })) success = false;
  });

  group('territory', function () {
    const r = http.get(`${BASE_URL}/api/territory/regions`, {
      headers,
      tags: { endpoint: 'territory_regions' },
    });
    if (!check(r, { 'territory/regions reachable': (rr) => rr.status < 500 })) success = false;
  });

  if (success) {
    flowSuccesses.add(1);
  } else {
    flowFailures.add(1);
    flowSuccesses.add(0);
  }

  sleep(1);
}
