# Xuân Tôi — Security

Tóm tắt các kiểm soát an ninh đang có và các điểm còn cần cải thiện. Đối tượng: admin/dev đánh giá threat model trước khi cho closed beta + người contribute code mới biết invariant cần giữ.

> Companion: [`docs/PRODUCTION_CHECKLIST.md`](./PRODUCTION_CHECKLIST.md) — env list bắt buộc + smoke check sau deploy + CSP troubleshooting (Phase R1). Implementation: <ref_file file="apps/api/src/bootstrap-config.ts" /> + lock-in test <ref_file file="apps/api/src/bootstrap-config.test.ts" /> + <ref_file file="apps/api/src/security-secret-leak.test.ts" />.

## 1. Authentication

- **Password hash**: argon2id (`argon2@^0.41`). Tham số: `memoryCost = 64 MiB`, `timeCost = 3`, `parallelism = 1`. Tham số được hard-code 1 chỗ tại `auth.service.ts` + `scripts/bootstrap.ts`.
- **JWT**:
  - `xt_access` 15 phút (configurable `JWT_ACCESS_TTL`).
  - `xt_refresh` 30 ngày (configurable `JWT_REFRESH_TTL`).
  - Cả 2 đều `httpOnly`, `SameSite=Lax`. Production cross-origin cần đổi sang `None + Secure` (xem `docs/DEPLOY.md` §7).
- **Refresh rotation**: mỗi `/auth/refresh` cấp jti mới, revoke jti cũ. Lưu `argon2(refreshJWT)` ở `RefreshToken.hashedToken` chứ không lưu plaintext.
- **Reuse detection**: nếu một refresh token cũ đã revoke được present lại → **revoke toàn bộ chain refresh token của user đó** (assume kẻ tấn công đã copy token → kill mọi phiên).
- **Password change**: `passwordVersion` tăng mỗi lần đổi password → guard sẽ reject access token có `passwordVersion` cũ + revoke mọi refresh token.
- **Rate limit login**: 5 fail / 15 phút / (IP + email) qua `LoginAttempt` table. Banned user bị reject ở đăng nhập + revoke refresh.
- **Logout-all (POST `/api/_auth/logout-all`)**: revoke mọi refresh token còn active của user (`updateMany where revokedAt IS NULL → revokedAt = now()`). **Không bump `passwordVersion`** vì password chưa đổi → access tokens hiện hành (15 phút TTL) vẫn valid trên các thiết bị khác cho tới khi hết hạn. Sau đó các device đó cần refresh → fail vì refresh đã revoke → buộc re-login. Nếu cần force-kill session ngay lập tức (ví dụ token bị compromise trước khi hết 15 phút): phải đổi password hoặc bump `JWT_ACCESS_SECRET` rồi redeploy. Behavior intentional để tránh vô tình invalidate toàn bộ access token khi user chỉ muốn đăng xuất các device khác sau reset session.

> Không có email verification / forgot password tự động → out of scope cho closed beta. Reset password phải qua admin (xoá user, viết script reset thủ công, hoặc đổi `passwordHash` qua `prisma studio`).

## 2. Secret management

| Secret | Production yêu cầu | Hành vi nếu thiếu/yếu |
|---|---|---|
| `JWT_ACCESS_SECRET` | ≥ 32 ký tự, không phải `change-me-*` / `dev-*` | Server `assertProductionSecrets()` throw → refuse start. |
| `JWT_REFRESH_SECRET` | Tương tự, khác `JWT_ACCESS_SECRET` | Tương tự. |
| `CORS_ORIGINS` | csv list domain HTTPS | Production refuse start nếu không set. |
| `DATABASE_URL` | TLS (`sslmode=require`) | Postgres connect fail. |
| `REDIS_URL` | `rediss://` cho TLS | Tự động fallback in-memory cho rate limit chat (PR #24) — vẫn hoạt động nhưng mất tính multi-instance. |

Không commit `.env` thật. Repo chỉ có `.env.example` với placeholder.

## 3. Authorization

- 3 role: `PLAYER`, `MOD`, `ADMIN`. Hiện `MOD` được treat gần như `ADMIN` (xem H/M8 trong handoff — backlog tách quyền).
- Mọi endpoint admin gắn `@AdminGuard` → check `role IN (ADMIN, MOD)`. Body request validate qua Zod ở controller layer.
- Không có RBAC fine-grained (per-feature). Khi muốn beta → chấp nhận; sau beta cần split (MOD chỉ ban/audit, ADMIN mới grant currency / approve topup).

## 4. Input validation

- Body request validate qua Zod schema ở `packages/shared/src/api-contracts.ts` + helper guard ở controller. Ví dụ `auth.controller.ts` dùng `zodPipe(EmailLoginSchema)`.
- Tránh raw SQL. Mọi truy vấn qua Prisma → tham số an toàn (no SQL injection).
- Số tiền (`linhThach`, `tienNgoc`) lưu BigInt / Int. **Tất cả** mutation qua `CurrencyService.applyTx` → 1 điểm duy nhất ghi `CurrencyLedger`. Bỏ qua = bug.

## 5. Money / economy invariants

| Rule | Cơ chế |
|---|---|
| Mỗi delta tiền có ledger row | Code chỉ mutate `linhThach`/`tienNgoc` qua `CurrencyService.applyTx` (xác nhận bằng grep — xem handoff §11). |
| Không double-credit topup | Approve check `status === 'PENDING'` rồi `updateMany` guard. |
| Market buy atomic | `updateMany` guard `status='OPEN'` + transaction trừ buyer + cộng seller − fee. |
| Boss reward 1 lần | Distribute khi `DEFEATED`, không redo. |
| Mission/Mail claim 1 lần | Guard `claimedAt IS NULL`. |
| Gift code redeem 1 lần / user | `@@unique(giftCodeId, userId)`. |

Risk: chưa có hard cap cho admin grant — admin có thể cộng nhiều tuỳ ý. Audit log có ghi nhưng không tự rollback.

## 6. WebSocket

- `/ws` (Socket.io) auth qua cookie `xt_access` ưu tiên, fallback `handshake.auth.token`. Verify JWT + check `passwordVersion` + `banned`.
- Auto-join room `world` + `sect:<id>` (nếu có).
- Không trust client event payload — server side dispatch (chat, mail, boss attack đều đi qua REST controller, WS chỉ push).
- Rate limit chat 8 msg / 30s / player (Redis sliding window, fallback in-memory).

## 7. CSP / Security headers

- Production: helmet với CSP chặt:
  - `default-src 'self'`, `script-src 'self'`, `connect-src 'self'` (cần relax khi web khác domain).
  - `frame-ancestors 'none'`, `object-src 'none'`.
  - HSTS 180 ngày + includeSubDomains.
- Dev (`NODE_ENV !== 'production'`): tắt CSP để Vite dev server inline script / HMR / eval không bị chặn.

## 8. Cookies

| Cookie | TTL | flags |
|---|---|---|
| `xt_access` | 15 phút | httpOnly, SameSite=Lax. Production multi-origin cần `None + Secure`. |
| `xt_refresh` | 30 ngày | tương tự. |
| Không có session cookie thường | — | — |

Set qua `apps/api/src/common/auth-cookies.ts`. Domain qua `SESSION_COOKIE_DOMAIN`.

## 9. Audit

- `AdminAuditLog` lưu mọi action admin: ban/unban, role change, grant, topup approve/reject, mail send, gift code create/revoke. Indexed `(actorUserId, createdAt)` + `(action, createdAt)`.
- `CurrencyLedger` lưu mọi delta tiền của character (refType + refId + reason).
- Hiện chưa có `ItemLedger` (audit grant/consume item) — backlog (PR I trong handoff §21).

## 10. Known risks (tóm tắt §16 handoff)

| # | Risk | Status | Action |
|---|---|---|---|
| H1 | Chưa smoke E2E sau merge mission/mail/giftcode | Open | Trong roadmap PR Playwright. |
| H2 | Chưa có script seed admin | **Done** (PR #33). | — |
| H3 | Chưa seed sect | **Done** (PR #33). | — |
| H4 | Inventory không có test | **Done** (PR #34). | — |
| M2 | Boss spawn manual nhưng chưa có endpoint admin | Open | PR riêng. |
| M5 | `CurrencyLedger.actorUserId` chưa index | Open | Migration ADD INDEX. |
| M8 | MOD quyền quá rộng | Open | Tách permission post-beta. |
| L2 | Market fee 5% hard-code | Open | Đưa ra env config. |

## 11. Threat model (rút gọn)

| Vector | Mitigation hiện có | Còn thiếu |
|---|---|---|
| Brute force login | Rate limit 5/15p IP+email | Captcha sau N fail. |
| Token theft (XSS) | httpOnly cookie | CSP đã chặt. App không render HTML. |
| Token theft (network) | TLS bắt buộc + Secure flag (cross-origin) | Đảm bảo HTTPS only ở reverse proxy. |
| Token theft (replay) | Refresh rotation + reuse detect | — |
| SQL injection | Prisma parameterized | — |
| Privilege escalation | AdminGuard + role check | Tách MOD/ADMIN. |
| Money duplication | Single CurrencyService + transaction guard | Hard cap admin grant. |
| Item duplication | Inventory $transaction equip/use, market bilateral lock | ItemLedger audit (backlog). |
| Bot farming chat/cultivation | Chat rate limit, cultivation tick = server cron (không trust client) | Captcha onboarding nếu spam tăng. |
| Self-demote admin cuối | Audit log | UI/BE chưa block — Rule 9. |

## 12. Rate Limit + Abuse Block (Phase 18.1)

Bổ sung lớp **defense-in-depth** chống abuse (brute force / bot / scrape / spam claim) trên top của argon2 / refresh rotation / admin guard. KHÔNG thay thế WAF/CDN/anti-cheat.

### 12.1. Policy catalog

Source-of-truth ở <ref_file file="packages/shared/src/security-rate-limit.ts" /> (16 policy key, pure constant). Mỗi policy = `{ windowSec, maxRequests, blockSec, scope, severity, sensitive }`. Catalog test (`security-rate-limit.test.ts`) lock-in tham số để regression không quên — vd `AUTH_LOGIN` không thể bị bump lên 1000 req/phút mà không sửa test.

| Group | Policy | Scope | Limit | Block sau threshold |
|---|---|---|---|---|
| Auth | `AUTH_LOGIN` | IP_USER | 10 / 15p | 15p (HIGH 5/15p escalate) |
| Auth | `AUTH_REGISTER` | IP | 5 / 15p | 30p (HIGH) |
| Auth | `AUTH_REFRESH` | IP_USER | 30 / 60s | 5p (MEDIUM) |
| Auth | `AUTH_PASSWORD_RESET` | IP | 3 / 15p | 30p (HIGH) |
| Economy | `SHOP_BUY` / `SECT_SHOP_BUY` | USER | 30 / 60s | 10p (MEDIUM) |
| Economy | `MARKET_CREATE_LISTING` | CHARACTER | 10 / 60s | 10p |
| Economy | `MARKET_BUY` / `DUNGEON_CLAIM` | CHARACTER | 30 / 60s | 10p |
| Economy | `DAILY_LOGIN_CLAIM` | USER | 5 / 60s | 10p |
| Economy | `LIVEOPS_GIFT_CLAIM` | USER | 15 / 60s | 10p |
| Economy | `TOPUP_CREATE_ORDER` | USER | 10 / 60min | 60min (HIGH) |
| Admin | `ADMIN_MUTATION` | USER | 60 / 60s | 5p |
| Admin | `ADMIN_REPORT_VIEW` | USER | 120 / 60s | — (throttle only, no block) |
| Public | `PUBLIC_READ` / `DEFAULT_API` | IP / IP_USER | 300 / 60s, 120 / 60s | — |

### 12.2. Backend behavior

- **`RateLimitService`** (`apps/api/src/modules/security/rate-limit.service.ts`): Redis sliding window qua `ZSET`. Fail-soft → in-memory fallback khi Redis throw (env `RATE_LIMIT_FAIL_OPEN=true` default). Master toggle `RATE_LIMIT_ENABLED` (default `true`).
- **`RateLimitGuard`** (`APP_GUARD`): opt-in qua `@RateLimitPolicy(...)`. Bypass qua `@SkipRateLimit()` cho healthcheck/readyz/version/admin metrics/liveops public read.
- **`SecurityAbuseService`**: persist `SecurityEvent` + `SecurityBlock` (Prisma). Đếm abuse signal theo severity window (HIGH 5/15p, MEDIUM 10/15p, LOW vô hiệu) → `createBlock` IP/USER. `LOGIN_FAILED` threshold riêng 10/15p → block 30p. Fail-safe: DB throw → log warn + skip persistence (không crash caller).
- **`IpHashService`**: `sha256(SECURITY_IP_HASH_SALT || ':' || ip)`. Raw IP KHÔNG bao giờ persist. Salt rotate = kill switch lookup table cũ.

### 12.3. Response contract

- Headers `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` set trên mọi response của route có policy.
- 429 body: `{ ok: false, error: { code: 'RATE_LIMITED' | 'ABUSE_BLOCKED', retryAfterSec, resetAt | expiresAt, policy? } }`. Header `Retry-After` set khi 429.

### 12.4. Admin tooling

Endpoint `/admin/security/*` (xem [`API.md`](./API.md) §AdminSecurityController). FE panel `AdminSecurityPanel.vue` (tab "Bảo mật / Lạm dụng" trong AdminView). Audit `ADMIN_SECURITY_BLOCK_LIFT` mỗi lần admin lift. PLAYER/MOD bị reject 403 `ADMIN_ONLY` cho lift (chỉ ADMIN có).

### 12.5. Privacy invariants

- KHÔNG lưu raw IP — chỉ `ipHash`.
- KHÔNG lưu password / token / cookie / refresh JWT trong `SecurityEvent.detailJson`. `LOGIN_FAILED` chỉ lưu `email` (đã là public identifier ở user-facing).
- `AdminSecurityController` chỉ trả `ipHash` cho admin — không reverse được.
- Rotate `SECURITY_IP_HASH_SALT` invalidate toàn bộ lookup IP cũ → block hiện tại sẽ vẫn match request mới (vì server hash request IP với salt mới) nhưng lịch sử event cũ trở thành orphan hash.

### 12.6. KHÔNG làm

- KHÔNG auto-ban vĩnh viễn — chỉ block 5-30 phút theo severity.
- KHÔNG block healthcheck / readyz / version / admin metrics — set `@SkipRateLimit()` cho mọi route monitoring mới.
- KHÔNG log raw password / token / cookie vào `SecurityEvent.detailJson`.
- KHÔNG dùng `RATE_LIMIT_ENABLED=false` cho production trừ incident P0 (mất Redis + DB cùng lúc); set kèm post-mortem.
- KHÔNG dùng `RATE_LIMIT_FAIL_OPEN=false` ở closed beta (Redis blip → block oan user thật).

## 13. Khi phát hiện sự cố

1. Ngắt traffic (reverse proxy 503 hoặc scale 0 instance).
2. Thu log + dump `/admin/audit` + `CurrencyLedger` quanh thời điểm xảy ra.
3. Nếu liên quan password / token: bump `JWT_ACCESS_SECRET` (sẽ kill toàn bộ phiên), redeploy.
4. Nếu liên quan tiền: lock topup queue (set `MAINTENANCE=true` future flag), điều tra ledger, viết script `grant -delta` hoàn trả nếu cần.
5. Báo cáo lên admin tổ chức + viết postmortem.
