# Phase 17.5 — Load Test Baseline (k6)

Thư mục chứa k6 script chuẩn bị closed beta. **Không** chạy load test nặng trong CI / production khi chưa có phép.

## Yêu cầu

- [k6 >=0.50](https://grafana.com/docs/k6/latest/get-started/installation/) cài local hoặc trong runner staging.
- API target đã chạy (default `http://localhost:3000`).
- Test account đã onboard character (cho `k6-api-baseline.js` / `k6-ws-baseline.js`). Smoke chỉ hit health, không cần auth.

> k6 KHÔNG được install sẵn trong CI. Pipeline chỉ chạy unit/integration test; load test do team chạy thủ công.

## Scripts

### 1. `k6-smoke.js` — sanity check (1 VU × 10s)

Verify API alive, dùng trước khi chạy baseline.

```bash
k6 run scripts/load/k6-smoke.js
# Hoặc qua pnpm:
pnpm load:smoke

# Custom target:
BASE_URL=https://staging.xuantoi.example k6 run scripts/load/k6-smoke.js
```

Threshold:

- `http_req_failed` < 1%.
- `http_req_duration` p95 < 800ms.

### 2. `k6-api-baseline.js` — full user flow (3 VUs × 30s)

Mô phỏng login → state → daily-login → mission → dungeon → territory.

```bash
BASE_URL=http://localhost:3000 \
TEST_EMAIL=loadtest@example.com \
TEST_PASSWORD=ChangeMe!123 \
k6 run scripts/load/k6-api-baseline.js

# Custom VU/duration:
VUS=10 DURATION=2m k6 run scripts/load/k6-api-baseline.js

# Hoặc dùng pre-generated AUTH_TOKEN (giá trị cookie `xt_access`):
BASE_URL=http://localhost:3000 \
AUTH_TOKEN=eyJhbGciOi... \
k6 run scripts/load/k6-api-baseline.js
```

Threshold gợi ý closed beta:

- `http_req_failed` < 5%.
- `http_req_duration` p95 < 1500ms.
- `xt_login_failures` count < 10.
- `xt_flow_success_rate` > 90%.

### 3. `k6-ws-baseline.js` — WebSocket connect/auth/disconnect (5 VUs × 20s)

Verify Socket.IO `/ws` gateway accept connection + auth cookie.

```bash
BASE_URL=http://localhost:3000 \
TEST_EMAIL=loadtest@example.com \
TEST_PASSWORD=ChangeMe!123 \
k6 run scripts/load/k6-ws-baseline.js
```

Threshold gợi ý closed beta:

- `xt_ws_connect_success_rate` > 95%.
- `xt_ws_connect_failures` count < 20.

> Note: k6 dùng raw WebSocket transport vào engine.io endpoint `/ws/?EIO=4&transport=websocket`. Đủ verify handshake + auth, nhưng không gửi/nhận event business logic. Full E2E protocol test cần Artillery hoặc node-based runner.

## Env biến hệ thống

| Env | Default | Mô tả |
|-----|---------|------|
| `BASE_URL` | `http://localhost:3000` | API root, KHÔNG trailing slash. |
| `WS_URL` | derive từ `BASE_URL` (http→ws, https→wss) | WebSocket root. |
| `TEST_EMAIL` | — | Email tài khoản test, required nếu không có `AUTH_TOKEN`. |
| `TEST_PASSWORD` | — | Password tài khoản test. |
| `AUTH_TOKEN` | — | JWT cookie `xt_access` value, skip login flow. |
| `VUS` | smoke=1, api=3, ws=5 | Số VU đồng thời. |
| `DURATION` | smoke=10s, api=30s, ws=20s | k6 duration string (`30s`, `2m`, `1h`...). |

## Đọc kết quả

k6 in tổng kết cuối run, ví dụ:

```
http_req_duration..............: avg=120ms min=30ms med=95ms max=2.1s p(95)=350ms p(99)=850ms
http_req_failed................: 0.42% ✓ 5    ✗ 1180
xt_flow_success_rate...........: 99.50% ✓ 199  ✗ 1
```

Field quan trọng:

- **`http_req_duration` p(95)** — thời gian xử lý request cho 95% case. Closed-beta target < 1500ms.
- **`http_req_failed` rate** — tỉ lệ HTTP 4xx/5xx. < 5% chấp nhận; > 10% phải điều tra.
- **`xt_flow_success_rate`** — tỉ lệ flow user complete đầy đủ.
- **`vus_max` + `iterations`** — kiểm tra có đạt VU/iteration target không (nếu dropping → server quá tải).

Combine với `/api/admin/metrics` để xem WS online count + queue depth + CPU/RSS sau load:

```bash
curl -b cookies.txt http://localhost:3000/api/admin/metrics | jq .data.system.memory
```

## SECURITY

- **KHÔNG** hardcode email/password/token vào script. Dùng env.
- **KHÔNG** commit token thật. Repo CI có gitleaks scan.
- **KHÔNG** chạy script vào production khi chưa có phép — rate-limit có thể trigger account lock, BAN_RISK audit, hoặc làm gián đoạn người chơi thật.
- Default chỉ chạy local / staging.
- Tài khoản test phải tạo riêng, có note `loadtest`, KHÔNG dùng tài khoản admin / GM / staff.
