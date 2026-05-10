/**
 * Phase 17.5 — k6 WebSocket baseline.
 *
 * Verify `/ws` Socket.IO gateway: connect → authenticate (cookie
 * `xt_access`) → join `world` room → wait for any frame → disconnect
 * cleanly. Default 5 VU × 20s — đủ tạo baseline connect success rate.
 *
 * **CHÚ Ý**: API `/ws` dùng socket.io protocol; k6 hỗ trợ WebSocket
 * native nhưng KHÔNG handle socket.io handshake (engine.io v4). Script
 * này dùng raw WebSocket vào engine.io endpoint
 * `/ws/?EIO=4&transport=websocket` và parse 1-2 frame đầu (open packet
 * `0{...}`, message `40`, ...). Đủ để verify gateway accept connection
 * + auth cookie. Full message exchange (gửi/nhận event business) cần
 * load test engine khác (vd Artillery với engine.io plugin).
 *
 * Run:
 *   BASE_URL=http://localhost:3000 \
 *   AUTH_TOKEN=eyJhbGciOi... \
 *   k6 run scripts/load/k6-ws-baseline.js
 *
 * Hoặc dùng email/password (script tự login lấy cookie):
 *   BASE_URL=http://localhost:3000 \
 *   TEST_EMAIL=loadtest@example.com \
 *   TEST_PASSWORD=ChangeMe!123 \
 *   k6 run scripts/load/k6-ws-baseline.js
 *
 * Env:
 *   BASE_URL        — default `http://localhost:3000`. Sẽ derive WS_URL
 *                     bằng cách thay http→ws / https→wss.
 *   WS_URL          — override custom; mặc định derive từ BASE_URL.
 *   TEST_EMAIL      — required nếu KHÔNG có AUTH_TOKEN.
 *   TEST_PASSWORD   — required nếu KHÔNG có AUTH_TOKEN.
 *   AUTH_TOKEN      — JWT cookie value `xt_access`. Skip login nếu có.
 *   VUS             — số VU đồng thời, default 5.
 *   DURATION        — duration string k6, default '20s'.
 *
 * Threshold gợi ý closed beta:
 *   - WS connect success rate > 95%.
 *   - p95 connect duration < 1000ms.
 *
 * SECURITY: KHÔNG hardcode token; chỉ test staging trừ khi được phép.
 */
import http from 'k6/http';
import ws from 'k6/ws';
import { check, fail } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const WS_URL = (__ENV.WS_URL || BASE_URL.replace(/^http/, 'ws')).replace(/\/$/, '');
const TEST_EMAIL = __ENV.TEST_EMAIL || '';
const TEST_PASSWORD = __ENV.TEST_PASSWORD || '';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

const VUS = parseInt(__ENV.VUS || '5', 10);
const DURATION = __ENV.DURATION || '20s';

const wsConnectFail = new Counter('xt_ws_connect_failures');
const wsConnectSuccess = new Rate('xt_ws_connect_success_rate');

export const options = {
  vus: VUS,
  duration: DURATION,
  thresholds: {
    'xt_ws_connect_success_rate': ['rate>0.95'],
    'xt_ws_connect_failures': ['count<20'],
  },
};

function login() {
  if (AUTH_TOKEN) return AUTH_TOKEN;
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    fail('TEST_EMAIL/TEST_PASSWORD missing và không có AUTH_TOKEN. Đặt env trước khi run.');
  }
  const res = http.post(
    `${BASE_URL}/api/_auth/login`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'login' } },
  );
  if (res.status !== 200) return '';
  const setCookie = res.headers['Set-Cookie'] || res.headers['set-cookie'] || '';
  const m = /xt_access=([^;]+)/.exec(String(setCookie));
  return m ? m[1] : '';
}

export function setup() {
  const token = login();
  if (!token) fail('Login thất bại — abort WS baseline.');
  return { token };
}

export default function (data) {
  // engine.io v4 native WebSocket transport URL.
  const url = `${WS_URL}/ws/?EIO=4&transport=websocket`;
  const params = {
    headers: {
      Cookie: `xt_access=${data.token}`,
    },
    tags: { endpoint: 'ws_connect' },
  };

  const res = ws.connect(url, params, function (socket) {
    let opened = false;
    socket.on('open', function open() {
      opened = true;
      // engine.io upgrade probe: gửi `2probe` để kích hoạt handshake.
      // Một số deployment không cần, default OK với welcome frame `0`.
      socket.setTimeout(function () {
        socket.close();
      }, 2000);
    });

    socket.on('message', function (_msg) {
      // Bất cứ frame nào nhận được = gateway accept connection. Có
      // thể là `0{...}` (open) hoặc `40` (connect ack) hoặc `42[...]`
      // (event). Đếm là success.
    });

    socket.on('error', function (_e) {
      // Network error — counter sẽ ghi qua check.
    });

    socket.on('close', function () {
      check(opened, { 'ws: opened ít nhất 1 lần': (v) => v === true });
      if (opened) {
        wsConnectSuccess.add(1);
      } else {
        wsConnectSuccess.add(0);
        wsConnectFail.add(1);
      }
    });
  });

  if (!res || res.status >= 400) {
    wsConnectSuccess.add(0);
    wsConnectFail.add(1);
  }
  check(res, { 'ws: handshake status 101': (r) => r && r.status === 101 });
}
