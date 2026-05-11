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

> **Source of truth**: [`apps/api/src/config/env.schema.ts`](../apps/api/src/config/env.schema.ts) (Phase 17.1) — strict zod schema cho production. `parseEnv(process.env)` + `assertProductionEnv()` được gọi trong `main.ts` ngay sau legacy `assertProductionSecrets()` (defense-in-depth). Schema aggregate mọi env issue thành 1 message → ops không phải redeploy nhiều lần để fix từng env một. `pnpm verify:deploy` smoke gate này TRƯỚC khi cutover (xem `docs/DEPLOY.md` §10.A).

| Secret | Production yêu cầu | Hành vi nếu thiếu/yếu |
|---|---|---|
| `JWT_ACCESS_SECRET` | ≥ 32 ký tự, không phải `change-me-*` / `dev-*-secret` | Schema throw → refuse start. |
| `JWT_REFRESH_SECRET` | ≥ 32 ký tự, khác `JWT_ACCESS_SECRET` | Tương tự. Reject access==refresh để rotate độc lập. |
| `CORS_ORIGINS` | csv list domain HTTPS ≥ 1 origin | Production refuse start nếu trống. |
| `DATABASE_URL` | scheme `postgres://` / `postgresql://` (TLS `sslmode=require`) | Schema reject scheme khác; Postgres connect fail nếu host sai. |
| `REDIS_URL` | scheme `redis://` / `rediss://` (TLS) | Schema reject scheme khác; tự fallback in-memory cho rate limit chat nếu Redis down runtime (PR #24) — vẫn hoạt động nhưng mất tính multi-instance. |
| `SESSION_COOKIE_DOMAIN` | non-empty (vd `.xt.example.com`) | Schema refuse start nếu trống. |
| `SECURITY_IP_HASH_SALT` | ≥ 32 ký tự, không phải `xuantoi-default-ip-salt` (Phase 17.1 + 18.1) | Schema refuse start. Rotate salt = mất khả năng cross-ref hash IP cũ. |
| `PORT` (optional) | 1..65535, default 3000 | Schema reject non-numeric / out-of-range. |

Lock-in invariants: [`apps/api/src/config/env.schema.test.ts`](../apps/api/src/config/env.schema.test.ts) — 32 test (dev permissive 4, prod missing-critical 8, placeholder reject 7, length/format 7, happy path 3, assertProductionEnv 3).

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
| Social | `SOCIAL_FRIEND_REQUEST` | USER | 10 / 60s | 5p (MEDIUM) |
| Social | `SOCIAL_BLOCK_TOGGLE` | USER | 30 / 10p | 10p (MEDIUM) |
| Social | `CHAT_PRIVATE_SEND` | USER | 30 / 60s | 5p (MEDIUM) |
| Social | `CHAT_GROUP_SEND` | USER | 30 / 60s | 5p (MEDIUM) |
| Social | `CHAT_GROUP_CREATE` | USER | 10 / 60min | 30p (MEDIUM) |
| Social | `CHAT_GROUP_MEMBER_ADD` | USER | 30 / 10p | 10p (MEDIUM) |
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

## 13. Session Management (Phase 18.2)

Server-authoritative tracking phiên đăng nhập của user, bổ sung cho cookie + refresh token rotation đã có ở Phase R1.

### Mục tiêu

- Mỗi lần login/register thành công tạo **1 `UserSession` row** đại diện cho 1 device/browser family.
- Mọi `RefreshToken` rotate trong family đó link về **cùng `sessionId`** (tham chiếu lỏng `SET NULL` để rotation log không bị xoá khi session bị `DELETE`).
- Trên refresh: rotate token cũ + cấp token mới + `touchSession(lastSeenAt)` cùng `sessionId` (không tạo session mới).
- Trên reuse: nếu một `RefreshToken.revokedAt != null` được present lại với mật khẩu khớp `argon2.verify` → **revoke cả session family** + emit `SecurityEvent` `REFRESH_TOKEN_REUSED` (CRITICAL) + trả `SESSION_EXPIRED` cho attacker và victim cùng lúc.

### Models

- `UserSession` (`apps/api/prisma/schema.prisma`): `id`, `userId`, `ipHash`, `userAgent` (sanitized + capped 256ch), `createdAt`, `lastSeenAt`, `expiresAt`, `revokedAt`, `revokedReason`, `revokedById`, `suspicious`.
- `RefreshToken.sessionId`: nullable FK → `UserSession.id`. Onboard cũ: `sessionId=null` cho refresh token tạo trước phase 18.2 — vẫn refresh được, KHÔNG bị treat as orphan; chỉ session-aware check (revoke/expired) khi `sessionId != null`.

### Revoke reasons

- `USER_LOGOUT` — user logout / revoke session của mình.
- `ADMIN_REVOKE` — admin revoke từ panel.
- `REFRESH_REUSED` — defensive revoke khi detect reuse.
- `PASSWORD_CHANGED` — change-password hoặc reset-password.
- `EXPIRED` — reserved cho cleanup cron (chưa wire ở 18.2).
- `SUSPICIOUS` — reserved cho heuristic future phase.

### Events

| Type | Severity | Khi nào |
|------|----------|---------|
| `SESSION_CREATED` | INFO | login / register tạo session. |
| `SESSION_REVOKED` | INFO | revoke session (user/admin/password). |
| `REFRESH_TOKEN_REUSED` | **CRITICAL** | refresh token đã rotate được present lại. |
| `SESSION_SUSPICIOUS` | WARN | reserved (chưa enforce, để future heuristic). |

`SecurityEvent.detailJson` chỉ chứa `sessionId`, `userId`, `revokedReason` — KHÔNG bao giờ chứa `hashedToken`, `jti`, `refreshToken` raw.

### API surface

- User-facing (require access cookie):
  - `GET /_auth/sessions?includeRevoked=true|false` → list session của chính user; flag `current=true` cho session khớp refresh cookie hiện tại.
  - `DELETE /_auth/sessions/:id` → revoke self session. Self-ownership guard mask `SESSION_NOT_FOUND 404` nếu session không thuộc user (chống enumeration). Nếu revoke chính session hiện tại → clear cookies, FE phải redirect login.
- Admin (`@RequireAdmin`):
  - `GET /admin/security/sessions?userId=&status=ACTIVE|REVOKED|EXPIRED|ALL` → list paginate, audit `ADMIN_SECURITY_SESSIONS_VIEW`.
  - `POST /admin/security/sessions/:id/revoke` → reason `ADMIN_REVOKE`, audit `ADMIN_SECURITY_SESSION_REVOKE` / `_FAILED`.

### Invariants

- KHÔNG bao giờ trả `hashedToken` / `jti` raw / `refreshToken` body trong API response — chỉ session summary (`UserSessionSummary`).
- KHÔNG log raw IP — chỉ `ipHash` qua `IpHashService` (sha256 + `SECURITY_IP_HASH_SALT`).
- `userAgent` sanitize (strip control char + trim + cap 256ch) qua `sanitizeUserAgent` trong `@xuantoi/shared`.
- `changePassword` / `resetPassword` revoke **toàn bộ** `UserSession` của user (reason `PASSWORD_CHANGED`) + bump `passwordVersion` (refresh JWT cũ bị reject).
- `logoutAll` revoke toàn bộ session (`USER_LOGOUT`) nhưng **KHÔNG** bump `passwordVersion` (giữ behavior Phase R1).
- Admin revoke ghi `revokedById = adminUserId`; user revoke ghi `revokedById = userId`.

### Migrations / rollback

- Additive only: `prisma/migrations/20260629000000_phase_18_2_user_session/` tạo `UserSession` + thêm `RefreshToken.sessionId` nullable. Không backfill IP/UA raw từ row cũ.
- Rollback: drop `UserSession` + nullable column an toàn vì không có column nào require `sessionId`. Refresh token cũ vẫn rotate đúng.

### Test coverage

- `apps/api/src/modules/auth/session.service.test.ts` (14 tests): createSession, touch, revoke (cascade RefreshToken con), idempotent revoke, reuse detection, listForUser current flag, listForAdmin filter status/userId, pagination, privacy.
- `apps/api/src/modules/auth/auth.service.test.ts` (Phase 18.2 block — 9 tests): register → session, rotate continue family, reuse → CRITICAL + revoke, revoked/expired session → SESSION_EXPIRED, logout 1 device, logoutAll all-sessions, changePassword revoke all, response không leak hashedToken/jti.
- `apps/api/src/modules/auth/auth.controller.test.ts` (Phase 18.2 block — 8 tests): list (UNAUTHENTICATED / current flag / includeRevoked forward); delete (UNAUTHENTICATED / 404 missing / 404 mask cross-user / non-current keeps cookies / current clears cookies).
- `apps/api/src/modules/security/admin-security.controller.test.ts` (Phase 18.2 block — 6 tests): admin list + audit, invalid status, userId forward; admin revoke success + audit meta, 404 + audit `_FAILED`, INVALID_INPUT.

## 14. Security Audit / Alert Polish (Phase 18.3)

### Mục tiêu

Tách lớp **operational alert workflow** ra khỏi `SecurityEvent` audit log (immutable). `SecurityEvent` vẫn là source-of-truth raw event; `SecurityAlert` là lớp **mutable** cho admin ack/resolve, lưu workflow status (`OPEN` / `ACKNOWLEDGED` / `RESOLVED`) + ghi chú xử lý.

### Bảng `SecurityAlert`

Cột chính:

| Cột | Mục đích |
| --- | --- |
| `id` (cuid) | PK |
| `type` | Phân loại nghiệp vụ (xem map bên dưới) |
| `severity` | `INFO` / `WARN` / `CRITICAL` |
| `status` | `OPEN` → `ACKNOWLEDGED` → `RESOLVED` |
| `source` | `RATE_LIMIT` / `AUTH` / `SESSION` / `ADMIN` / `BLOCK` / `OTHER` |
| `eventId` | FK-ish đến `SecurityEvent.id` (nullable cho alert direct) |
| `relatedUserId`, `relatedCharacterId`, `relatedSessionId` | optional |
| `detailsJson` | Snapshot detail sanitized (KHÔNG có raw IP/token/cookie/secret) |
| `createdAt`, `acknowledgedAt[ByAdminId]`, `resolvedAt[ByAdminId]`, `resolutionNote` | Audit cột |

Index: `(status, severity, createdAt desc)`, `(source, createdAt desc)`, `(type, createdAt desc)`, `(relatedUserId, createdAt desc)`, `eventId`, `createdAt desc` — đủ cho admin filter / dashboard.

### Mapping event → alert

`classifySecurityEventForAlert(eventType, eventSeverity)` (file `packages/shared/src/security-alerts.ts`) map sang `{ alertType, severity, source }`. Bảng:

| SecurityEvent type | alertType | source |
| --- | --- | --- |
| `RATE_LIMIT_VIOLATION` | `RATE_LIMIT_ABUSE` | `RATE_LIMIT` |
| `LOGIN_FAILED` | `LOGIN_ABUSE` | `AUTH` |
| `INVALID_TOKEN` | `INVALID_TOKEN` | `AUTH` |
| `ADMIN_FORBIDDEN` | `ADMIN_FORBIDDEN` | `ADMIN` |
| `SUBJECT_BLOCKED` | `SUBJECT_BLOCKED` | `BLOCK` |
| `BLOCK_LIFTED` | `BLOCK_LIFTED` | `ADMIN` |
| `SESSION_CREATED` | `SESSION_CREATED` | `SESSION` |
| `SESSION_REVOKED` | `SESSION_REVOKED` | `SESSION` |
| `REFRESH_TOKEN_REUSED` | `REFRESH_TOKEN_REUSED` | `SESSION` |
| `SESSION_SUSPICIOUS_ACTIVITY` | `SESSION_SUSPICIOUS` | `SESSION` |
| _unknown_ | `OTHER` (severity = `INFO`) | `OTHER` |

`shouldCreateAlertForClassification()` filter ra `INFO` → KHÔNG tạo alert (tránh spam). Chỉ `WARN` / `CRITICAL` raise alert.

### Fan-out (fail-soft)

`SecurityAbuseService.maybeCreateAlert()` + `SessionService.emitEvent()` gọi `SecurityAlertService.createFromEvent()` ngay sau khi `SecurityEvent` đã `create()`. **Mọi exception trong fan-out chỉ log warn — KHÔNG propagate** (alert là lớp phụ trợ, không được kéo theo crash login / rate-limit / session flow). Idempotent theo `eventId`.

### Admin workflow

- `GET /admin/security/alerts?status=&severity=&type=&source=&from=&to=&userId=&limit=&cursor=` — list cursor pagination, audit `ADMIN_SECURITY_ALERTS_VIEW`.
- `GET /admin/security/summary` — `{ openCritical, openWarn, blockedSubjects, tokenReuseLast24h, suspiciousSessionsLast24h, rateLimitHitsLast24h, latestCriticalEvents[] }`. Mỗi count fail-soft riêng — 1 lỗi không kéo cả summary fail. Audit `ADMIN_SECURITY_SUMMARY_VIEW`.
- `POST /admin/security/alerts/:id/ack` — ADMIN-only. Idempotent: ack 1 alert đã ACK → no-op. Reject `ALERT_ALREADY_RESOLVED` (409). Audit `ADMIN_SECURITY_ALERT_ACK` / `_FAILED`.
- `POST /admin/security/alerts/:id/resolve` body `{ note }` — ADMIN-only. Sanitize note (strip control char, max 1000 char). Reject `INVALID_NOTE` (400), `ALERT_ALREADY_RESOLVED` (409). Skip-ack path: `OPEN` → `RESOLVED` trực tiếp cũng set `acknowledgedAt` đồng thời. Audit `ADMIN_SECURITY_ALERT_RESOLVE` / `_FAILED`.

### Cấm

- **KHÔNG auto-ban vĩnh viễn**: alert chỉ là dashboard. Ban vĩnh viễn vẫn phải qua admin action explicit (Phase 18.2 revoke / Phase 18.1 lift).
- **KHÔNG tự rollback economy / player data** dựa trên alert.
- **KHÔNG tự revoke session** dựa trên alert (admin phải bấm Phase 18.2 revoke).
- KHÔNG store raw IP — chỉ `ipHash` từ `SecurityEvent`.

### Test

- `packages/shared/src/security-alerts.test.ts` (34 tests): enum guard, classify map đủ 16 event type, fail-soft unknown → OTHER/INFO, sanitize note.
- `apps/api/src/modules/security/security-alert.service.test.ts` (28 tests): createFromEvent idempotent + skip INFO + DB fail-soft, createDirect, listAlerts filter cursor, ack idempotent + reject RESOLVED, resolve skip-ack + sanitize note + reject empty, getSummary count + fail-soft per-query.
- `apps/api/src/modules/security/admin-security.controller.test.ts` (Phase 18.3 block — 9 tests): list + audit + filter forward + INVALID_STATUS; summary; ack success + 404 + 409; resolve success + INVALID_NOTE + 409.
- `apps/web/src/components/__tests__/SecurityAlertPanel.test.ts` (9 tests): render summary + table; empty / loading / error state; filter apply forward; ack cancel/confirm; resolve note rỗng/non-empty; i18n vi/en parity.

## 16. Gameplay Anti-cheat Deep Detection (Phase 16.3)

Detection-only lớp phát hiện hành vi gameplay đáng ngờ — bổ sung cho Phase 16.6 Economy Anti-cheat (dòng tiền tổng thể) bằng cách quan sát **từng module gameplay** (dungeon / boss / mission / arena / territory) + EXP/item/currency gain spike + reward-cap bypass count.

### Mục tiêu

- Sớm flag hành vi nghi vấn (farm bot, exploit dungeon reset, wintrade arena, multi-account territory reward) để admin review.
- KHÔNG thay thế WAF / rate-limit (Phase 18.1) / session hardening (Phase 18.2) / security audit alert (Phase 18.3).
- KHÔNG thay thế Phase 16.6 Economy Anti-cheat — hai layer chạy song song, mỗi layer view domain riêng.

### Models

- `GameplayAnomaly` (`apps/api/prisma/schema.prisma`): `id`, `type` (10-enum), `severity` (`INFO`/`WARN`/`CRITICAL`), `status` (`OPEN`/`ACKNOWLEDGED`/`RESOLVED`), `source` (11-enum module), `characterId?`, `userId?`, `windowKey`, `detailsJson` (sanitized — KHÔNG raw IP / token / cookie), ack/resolve metadata.
- Migration `20260701000000_phase_16_3_gameplay_anomaly` (additive, không backfill row cũ).
- Index: `@@unique([type, characterId, windowKey])` đảm bảo idempotency multi-instance race-safe; 5 secondary index cho admin filter.

### Detection types

Catalog ở `packages/shared/src/gameplay-anticheat.ts` (`GAMEPLAY_ANOMALY_RULES`). Threshold rationale + bảng cụ thể: xem [`BALANCE_MODEL.md`](./BALANCE_MODEL.md) §11.27.

10 type: `EXP_GAIN_SPIKE`, `CURRENCY_GAIN_SPIKE`, `ITEM_GAIN_SPIKE`, `DUNGEON_REWARD_FARM`, `BOSS_REWARD_FARM`, `MISSION_REWARD_FARM`, `ARENA_REWARD_FARM`, `TERRITORY_REWARD_SPIKE`, `COMBAT_RESULT_MISMATCH` (reserved hook), `REWARD_CAP_BYPASS_ATTEMPT`.

### Service contract

`GameplayAntiCheatService` (`apps/api/src/modules/admin-anticheat/gameplay-anticheat.service.ts`):

- `scanAll({ now?, windowKey?, windowMs? })` dispatch 10 rule. Mỗi rule wrap try/catch — 1 rule fail KHÔNG phá rule khác (fail-soft per-rule).
- `upsertAnomaly` bắt P2002 (`@@unique([type, characterId, windowKey])`) → `skipped` count (multi-instance race-safe).
- Summary: `{ totalCreated, totalSkipped, totalErrored, byType, windowKeysByType }`.

### Admin API surface

Tất cả gắn `@RequireAdmin()` (PLAYER + MOD 403 `ADMIN_ONLY`) + `@RateLimitPolicy('ADMIN_MUTATION')`:

- `GET /admin/anticheat/gameplay/summary`
- `POST /admin/anticheat/gameplay/scan` + audit `ADMIN_ANTICHEAT_GAMEPLAY_SCAN`
- `GET /admin/anticheat/gameplay/anomalies?severity=&status=&type=&source=&characterId=&from=&to=&limit=`
- `POST /admin/anticheat/gameplay/anomalies/:id/ack` + audit `ADMIN_ANTICHEAT_GAMEPLAY_ACK`
- `POST /admin/anticheat/gameplay/anomalies/:id/resolve` (note ≤1000ch) + audit `ADMIN_ANTICHEAT_GAMEPLAY_RESOLVE`

Chi tiết request/response: [`API.md`](./API.md) §Admin Anti-cheat Gameplay.

Admin operations playbook (run scan / ack / resolve / handle CRITICAL): [`RUNBOOK.md`](./RUNBOOK.md) §2.33.

### Invariants (test-enforced — `gameplay-anticheat.service.test.ts`)

- Scan KHÔNG mutate `Character.linhThach` / `Character.expCurrent` / `InventoryItem.qty`.
- Scan KHÔNG mutate `User.bannedAt` / KHÔNG revoke session / KHÔNG khoá tài khoản.
- KHÔNG auto-rollback transaction, KHÔNG auto-refund currency, KHÔNG auto-deduct.
- `detailsJson` đã sanitize ở caller — KHÔNG raw IP / token / cookie / refresh hash.
- `AdminAuditLog` ghi mọi mutation (scan / ack / resolve) — KHÔNG silent fail.

### Cấm

- **KHÔNG auto-ban** dựa trên anomaly. Anomaly là **signal**, không phải bằng chứng. Ban vĩnh viễn vẫn qua admin action explicit (endpoint admin có sẵn).
- **KHÔNG tự rollback** EXP / item / currency dựa trên anomaly.
- **KHÔNG tự khoá tài khoản** / KHÔNG revoke session.
- **KHÔNG public notify** (mail / chat / WS) — admin team xử lý nội bộ.
- **KHÔNG gộp Phase 16.6 EconomyAnomaly** vào cùng bảng — hai domain phân biệt rõ (economy money flow vs per-module gameplay behavior).

### Test coverage

- `packages/shared/src/gameplay-anticheat.test.ts` (23 tests): catalog completeness, severity classifier, windowKey builder, type/source/severity/status guards, fail-soft unknown.
- `apps/api/src/modules/admin-anticheat/gameplay-anticheat.service.test.ts` (18 tests): 10-rule dispatch, fail-soft per-rule, P2002 idempotency, detection-only Character invariant.
- `apps/api/src/modules/admin-anticheat/admin-gameplay-anticheat.controller.test.ts` (17 tests): RBAC ADMIN/MOD/PLAYER, audit log, filter validation, limit clamp ≤200, note cap 1000ch, idempotent ack/resolve.
- `apps/web/src/components/__tests__/AdminGameplayAntiCheatPanel.test.ts` (9 tests): summary cards, filter, run scan confirm, ack/resolve confirm + note, loading/empty/error, i18n vi/en parity.

## 16.B Market Trade Abuse Hardening (Phase 16.4)

Detection-first, guard-light lớp anti-abuse cho market trade flow. Bổ sung cho Phase 16.6 Market Price Band (input gate reject listing post ngoài rarity band) bằng cách quan sát **pattern** sau khi listing/trade commit thành công: price extreme within-band, repeated buyer/seller pair, listing spam, market volume spike, unknown reference price.

### Mục tiêu

- Sớm flag hành vi nghi vấn market (RMT dump farm cheap-list, alt-account funnel, bot listing spam, slow-drip whale funnel) để admin review.
- KHÔNG thay thế Phase 16.6 Price Band (vẫn áp ở input gate). KHÔNG thay thế Phase 16.3 Gameplay Anti-cheat (per-module gameplay) hay Phase 16.6 Economy Anti-cheat (dòng tiền tổng thể).
- KHÔNG block giao dịch bình thường ngay cả khi WARN/CRITICAL — đặc thù market, false-positive cao hơn cheating; người dùng vẫn được mua/bán, admin xem panel xử lý sau.

### Models

- `MarketTradeAnomaly` (`apps/api/prisma/schema.prisma`): `id`, `type` (6-enum), `severity` (`INFO`/`WARN`/`CRITICAL`), `status` (`OPEN`/`ACKNOWLEDGED`/`RESOLVED`), `source` (4-enum `LISTING_CREATE`/`LISTING_BUY`/`SCAN_BATCH`/`OTHER`), `listingId` (`''` cho per-character per-window rule), `sellerCharacterId?`, `buyerCharacterId?`, `itemKey?`, `quantity?`, `unitPrice?` (Decimal), `referencePrice?` (Decimal), `deviationRatio?` (Float), `windowKey`, `detailsJson` (sanitized — KHÔNG raw IP / token / cookie), ack/resolve metadata.
- Migration `20260801000000_phase_16_4_market_trade_anomaly` (additive only, KHÔNG backfill row cũ, KHÔNG FK — fail-soft trên listing đã xoá).
- Index: `@@unique([type, listingId, windowKey])` đảm bảo idempotency multi-instance race-safe; 5 secondary index cho admin filter (`severity`, `status`, `type`, `source`, `createdAt`).

### Detection types

Catalog ở `packages/shared/src/market-trade-abuse.ts`. Threshold rationale + bảng cụ thể: xem [`BALANCE_MODEL.md`](./BALANCE_MODEL.md) §11.28.

6 type: `PRICE_EXTREME_LOW`, `PRICE_EXTREME_HIGH`, `REPEATED_BUYER_SELLER_PAIR`, `LISTING_SPAM`, `MARKET_VOLUME_SPIKE`, `UNKNOWN_REFERENCE_PRICE` (INFO).

### Service contract

`MarketTradeAbuseService` (`apps/api/src/modules/admin-market-abuse/market-trade-abuse.service.ts`):

- `scanAll({ now?, windowKey?, windowMs? })` dispatch 6 rule (PRICE_EXTREME_* duyệt listing ACTIVE/SOLD trong window, REPEATED_PAIR + VOLUME duyệt MarketTrade, LISTING_SPAM duyệt Listing per-seller, UNKNOWN_REFERENCE duyệt listing thiếu ItemDef). Mỗi rule wrap try/catch — 1 rule fail KHÔNG phá rule khác (fail-soft per-rule).
- `recordListingCreate({ listingId })` — hook **post-tx** từ `MarketService.post()`. Classify price band + emit `PRICE_EXTREME_*` / `UNKNOWN_REFERENCE_PRICE` real-time.
- `recordListingBuy({ tradeId, listingId })` — hook **post-tx** từ `MarketService.buy()`. Classify price band + check REPEATED_PAIR + VOLUME single-trade level.
- Tất cả hook + scan wrap try/catch ở `MarketService` — detection throw KHÔNG rollback listing/trade.
- `upsertAnomaly` bắt P2002 (`@@unique([type, listingId, windowKey])`) → `skipped` count (multi-instance race-safe).
- Summary: `{ totalCreated, totalSkipped, totalErrored, rules[], windowKeysByType, scannedAt }`.

### Admin API surface

Tất cả gắn `@RequireAdmin()` (PLAYER + MOD 403 `ADMIN_ONLY`) + `@RateLimitPolicy('ADMIN_MUTATION')`:

- `GET /admin/market/abuse/summary`
- `POST /admin/market/abuse/scan` + audit `ADMIN_MARKET_ABUSE_SCAN`
- `GET /admin/market/abuse/anomalies?severity=&status=&type=&source=&sellerCharacterId=&buyerCharacterId=&itemKey=&from=&to=&limit=`
- `POST /admin/market/abuse/anomalies/:id/ack` + audit `ADMIN_MARKET_ABUSE_ACK`
- `POST /admin/market/abuse/anomalies/:id/resolve` (note ≤1000ch) + audit `ADMIN_MARKET_ABUSE_RESOLVE`

Chi tiết request/response: [`API.md`](./API.md) §Admin Market Trade Abuse.

Admin operations playbook (run scan / ack / resolve / handle CRITICAL): [`RUNBOOK.md`](./RUNBOOK.md) §2.34.

### Invariants (test-enforced — `market-trade-abuse.service.test.ts`)

- Scan + hook KHÔNG mutate `Listing` / `MarketTrade` / `CurrencyLedger` / `ItemLedger` / `Character` / `User`. Test assert post-scan rows untouched.
- Hook `recordListingCreate` / `recordListingBuy` chạy **post-mutation** — `MarketService.post()` + `MarketService.buy()` đã commit transaction trước khi gọi hook. Hook throw KHÔNG ảnh hưởng trade.
- KHÔNG auto-rollback trade đã commit. KHÔNG auto-refund currency / re-deliver item. KHÔNG block trade tiếp theo.
- `detailsJson` đã sanitize ở caller — KHÔNG raw IP / token / cookie / refresh hash.
- `AdminAuditLog` ghi mọi mutation (scan / ack / resolve) — KHÔNG silent fail.

### Cấm

- **KHÔNG auto-ban** dựa trên anomaly. Anomaly là **signal**, không phải bằng chứng. Ban vĩnh viễn vẫn qua admin action explicit.
- **KHÔNG tự cancel listing / rollback trade / refund** dựa trên anomaly.
- **KHÔNG tự khoá tài khoản** seller/buyer dựa trên anomaly.
- **KHÔNG public notify** (mail / chat / WS) — admin team xử lý nội bộ.
- **KHÔNG gộp** với `EconomyAnomaly` (Phase 16.6 — money flow) hay `GameplayAnomaly` (Phase 16.3 — per-module gameplay) — ba domain phân biệt rõ.

### Test coverage

- `packages/shared/src/market-trade-abuse.test.ts` (26 tests): enum guard (severity/status/type/source/window-span), classify price band 4 ladder, classify count/volume, build windowKey 3 span (1h/24h/7d ISO), estimateItemReferencePrice fallback null + geomean correctness, fail-soft unknown source.
- `apps/api/src/modules/admin-market-abuse/market-trade-abuse.service.test.ts` (16 tests): empty scan, price band normal/WARN/CRITICAL low+high, repeated pair 24h+7d, listing spam, volume spike, unknown reference, idempotency P2002, detection-only invariants (Listing/CurrencyLedger/ItemLedger untouched), hook real-time vs scanAll consistency.
- `apps/api/src/modules/admin-market-abuse/admin-market-abuse.controller.test.ts` (18 tests): RBAC ADMIN-only, audit log fan-out, filter validation + limit clamp ≤200, note cap 1000ch, idempotent ack/resolve 404 `ANOMALY_NOT_FOUND_OR_NOT_OPEN` / `ANOMALY_NOT_FOUND_OR_RESOLVED`.

## 19. Social System (Phase 19.1)

> Foundation cho friend / private chat / group chat. **Server-authoritative** — mọi invariant enforce ở service layer (SocialService / ChatPrivateService / ChatGroupService), **KHÔNG** dựa vào DB constraint (soft-ref pattern, không FK).

### Đe doạ & mitigation

| Threat | Mitigation |
|---|---|
| Self-targeting (gửi friend cho mình, block mình, mở thread mình) | Service throw `SELF_NOT_ALLOWED` trước khi insert. |
| Block bypass (sender bị block vẫn nhắn tin được) | `sendPrivateMessage` + `sendFriendRequest` check `isBlockedBetween(a,b)` (2 chiều) ở entry; reject `BLOCKED`. |
| Thread existence leak qua 403 | Non-member → `NOT_FOUND` (404 mask), KHÔNG 403 — attacker không thể distinguish "thread tồn tại nhưng tôi không có quyền" vs "không có thread". |
| Group existence leak | Tương tự: `requireMemberGroup` throw `NOT_FOUND` cho non-member khi GET/POST messages. |
| Duplicate FriendRequest spam | DB unique `(senderUserId, receiverUserId, status=PENDING)` + service reject `ALREADY_PENDING` trước insert. |
| Message flood / oversize | Server-side `validateChatMessageBody`: empty/whitespace → `INVALID_INPUT`; length >500ch → `INVALID_INPUT`. FE counter chỉ là visual aid. |
| Group membership flooding | `GROUP_MEMBER_MAX=30` cap enforce ở `addGroupMember`. Owner-only ops chống random user add người ngoài. |
| Owner takes hostage (không thể rời) | Owner KHÔNG self-remove qua API hiện tại — phải gọi follow-up `deleteGroup` (Phase 19.2). |
| Block bypass qua group | Khi `addGroupMember`, check `isBlockedBetween(owner, target)` 2 chiều. Tuy nhiên trong cùng group đang có sẵn, không tự kick — moderation responsibility của owner. |
| Audit log message content | Phase 19.1 KHÔNG log full message body vào audit (chỉ tạo Message row). Admin moderation cần dùng query trực tiếp `PrivateChatMessage` / `GroupChatMessage`. |
| Token / secret in message body | KHÔNG có filter ở Phase 19.1 — Phase 19.2 sẽ thêm regex hook `MARKETPLACE_TOKEN`/`PASSWORD` warn. Hiện tại operator phải nhắc player trong TOS. |

### Detection-first principles

- Block KHÔNG xoá historical message (preserve audit trail). Chỉ chặn send tương lai.
- Unblock KHÔNG tự khôi phục FriendRequest cũ (status đã chuyển CANCELLED).
- Realtime fanout fail-soft: WS down → DB insert vẫn commit. Player offline khi nhận lại sẽ poll qua REST.

### Rate-limit (Phase 19.1.B — closed)

- Phase 19.1.B đã gắn `@RateLimitPolicy()` (Phase 18.1 infra) vào toàn bộ mutation endpoint social/chat của Phase 19.1. Catalog ở <ref_file file="packages/shared/src/security-rate-limit.ts" /> (group `SOCIAL`, tất cả `scope='USER'`, `sensitive=true`, severity `MEDIUM`):
  - `SOCIAL_FRIEND_REQUEST` — 10 req / 60s / user, block 5p.
  - `SOCIAL_BLOCK_TOGGLE` — 30 toggle / 10p / user, block 10p (chống abuse block storm trên cả `POST /social/block` lẫn `DELETE /social/block/:userId`).
  - `CHAT_PRIVATE_SEND` — 30 msg / 60s / user, block 5p.
  - `CHAT_GROUP_SEND` — 30 msg / 60s / user, block 5p.
  - `CHAT_GROUP_CREATE` — 10 group / 60min / user, block 30p (chống flood group spam).
  - `CHAT_GROUP_MEMBER_ADD` — 30 invite / 10p / user, block 10p.
- Read-only GET endpoint (list friends / requests / blocks / threads / messages / groups / members) KHÔNG gắn policy — fall through `DEFAULT_API` (120/60s IP_USER).
- State-machine endpoint `POST /social/friend-requests/:id/{accept,decline}` + `DELETE /social/friend-requests/:id` + `DELETE /social/friends/:friendUserId` KHÔNG gắn policy — spam-risk thấp (idempotent + giới hạn bởi pending-request hiện có) và đã có business-logic guard.
- Vượt policy → `RateLimitGuard` (Phase 18.1) throw 429 với `code='RATE_LIMITED'` hoặc `code='ABUSE_BLOCKED'` (fail2ban-style temporary block). FE bắt code → toast i18n thân thiện (`{social,chatPrivate,chatGroup}.errors.{RATE_LIMITED,ABUSE_BLOCKED}` ở `apps/web/src/i18n/{vi,en}.json`), KHÔNG auto-retry.
- Bảo toàn invariants Phase 19.1: KHÔNG auto-ban, KHÔNG xoá message cũ, KHÔNG modify WORLD/SECT chat. Rollback = revert PR → endpoint quay về business-logic-only check.

### Test coverage

- `apps/api/src/modules/social/social.service.spec.ts` (31 tests): friend lifecycle full state machine, block invariants 2 chiều, list helpers, duplicate-rejection idempotency, self-ops cấm.
- `apps/api/src/modules/chat-private/chat-private.service.spec.ts` (16 tests): thread create idempotent low<high, send-after-block reject, length cap, 404 mask non-member, list DESC + limit cap.
- `apps/api/src/modules/chat-group/chat-group.service.spec.ts` (14 tests): owner create, member CRUD, GROUP_MEMBER_MAX cap, owner-only ops, 404 mask, length cap.
- FE `apps/web/src/components/__tests__/SocialPanel.test.ts` (5 tests): loading/empty, accept-request flow, send-request reset, block confirm modal cancel=false KHÔNG call API, error toast.

## 19.2. Chat Moderation & Report System (Phase 19.2)

**Mục đích**: User-driven moderation. Cho player report tin nhắn vi phạm, admin xử lý qua dashboard. Server-authoritative — KHÔNG để FE skip mute/hide/lock. Ưu tiên **soft-hide** (giữ body cho audit/appeal) thay vì hard-delete.

### Invariants

- **Mute scope ma trận**: `ChatModerationService.findActiveMuteForSend(userId, channelScope)` check `muteScopeCoversChannel(activeMuteScope, targetScope)` — scope `ALL_CHAT` cover mọi channel; scope cụ thể chỉ cover channel target. Mute đã `revokedAt` hoặc `expiresAt < now` KHÔNG enforce. Wired fail-fast trước business logic ở `ChatPrivateService.sendPrivateMessage` (`PRIVATE_CHAT`) + `ChatGroupService.sendGroupMessage` (`GROUP_CHAT`) + `ChatService.sendWorldChat`/`sendSectChat` (`WORLD_SECT_CHAT`).
- **Report duplicate** chống idempotently: unique `(reporterUserId, messageType, privateMessageId|groupMessageId)`. Cùng người report cùng message 2 lần → `DUPLICATE_REPORT 409` (KHÔNG tạo row mới, KHÔNG ghi audit thêm). Validator KHÔNG cho phép `messageType=PRIVATE` đi kèm `groupMessageId` (và ngược lại) → `INVALID_INPUT`.
- **State machine report**: chỉ `OPEN → ACKNOWLEDGED → RESOLVED|REJECTED` (hoặc `OPEN → RESOLVED|REJECTED` skip ack). Transition khác → `INVALID_TRANSITION`. Idempotent — cùng status đích KHÔNG đổi row.
- **Soft-hide**: `adminHideMessage` set `hiddenAt` / `hiddenByAdminId` / `hideReason`. Body KHÔNG bị xoá. `listMessages*` cho user thường vẫn trả row với `isHidden=true` + body cleared ở FE (placeholder `chatModeration.hiddenMessage`). Admin endpoint trả full body. Unhide clear cols, KHÔNG audit duplicate nếu đã clear sẵn.
- **Group lock/dissolve**: set cols trên `GroupChat`. Send trong group lock → `GROUP_LOCKED`. Send trong group dissolve → `GROUP_DISSOLVED`. KHÔNG xoá member/message — giữ cho audit/restore.
- **AdminAuditLog mandatory**: tất cả admin mutation (ack/resolve/reject/mute-create/mute-revoke/hide/unhide/lock/unlock/dissolve) ghi row `AdminAuditLog` action `ADMIN_CHAT_MODERATION_*` + meta JSON kèm target id. Read-only endpoint (list/summary) KHÔNG ghi audit.

### Rate-limit

- `CHAT_REPORT_SUBMIT` — 10 report / 60min / user, block 10p. Scope `USER`, sensitive=true. Catalog ở `packages/shared/src/security-rate-limit.ts` (Phase 19.2).
- Admin mutation: rate-limit `ADMIN_MUTATION` (catalog Phase 18.1) — fall-through chung với mọi admin endpoint khác.

### Privacy

- Body tin nhắn KHÔNG log vào audit (chỉ id) — tránh leak nội dung user nếu audit DB bị compromise. Admin muốn xem body phải gọi endpoint admin-list (lookup theo id).
- `targetDisplayName` / `reporterDisplayName` resolved server-side từ `Character.name` — KHÔNG trả userId raw nếu admin filter theo display name (filter chỉ chấp nhận userId exact).

### Threat model

| Threat | Mitigation |
|---|---|
| Spam report (false-flag) | `CHAT_REPORT_SUBMIT` 10/h cap + duplicate-report idempotent. Admin reject + audit. Phase 21+ sẽ có "false-flag count" leaderboard. |
| Mute bypass qua reconnect WS | Mute check ở SEND service path, KHÔNG ở connect path. Reconnect KHÔNG bypass — mọi message vẫn check. |
| Mute bypass qua scope khác | `muteScopeCoversChannel` ma trận server-enforced. FE KHÔNG biết scope nào active — cứ try send, server reject `MUTED`. |
| Admin tự ý hide message của user không vi phạm | Mọi hide ghi `AdminAuditLog` với reason + actor. Operator review weekly (RUNBOOK §2.36). Hide reversible qua `unhide`. |
| Hard-delete data loss | KHÔNG hard-delete — chỉ soft-hide. Restore = `unhide`. |
| Group owner abuse | Admin lock/dissolve qua endpoint admin. Owner KHÔNG block được admin op. |

### Test coverage

- `packages/shared/src/chat-moderation.test.ts` (34 tests): enum validity, validator edge case, `muteScopeCoversChannel` 4x4 matrix.
- `apps/api/src/modules/chat-moderation/chat-moderation.service.test.ts` (31 tests): submit happy/dup/invalid; ack/resolve state machine + idempotent; mute create/list active filter + revoke + `findActiveMuteForSend` scope matrix; hide/unhide idempotent; lock/unlock/dissolve; AdminAuditLog action+meta per path.
- FE `apps/web/src/components/__tests__/ChatReportModal.test.ts` (7) + `AdminChatModerationPanel.test.ts` (7): UI/UX layer.

## 15. Khi phát hiện sự cố

1. Ngắt traffic (reverse proxy 503 hoặc scale 0 instance).
2. Thu log + dump `/admin/audit` + `CurrencyLedger` quanh thời điểm xảy ra.
3. Nếu liên quan password / token: bump `JWT_ACCESS_SECRET` (sẽ kill toàn bộ phiên), redeploy.
4. Nếu liên quan tiền: lock topup queue (set `MAINTENANCE=true` future flag), điều tra ledger, viết script `grant -delta` hoàn trả nếu cần.
5. Báo cáo lên admin tổ chức + viết postmortem.
