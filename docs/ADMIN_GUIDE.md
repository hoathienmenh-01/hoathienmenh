# Xuân Tôi — Admin Guide

Tài liệu cho admin/MOD vận hành Xuân Tôi runtime. Mọi thao tác admin đều ghi `AdminAuditLog` (xem `/admin/audit`).

## 1. Cách trở thành admin

| Tình huống | Cách làm |
|---|---|
| Cài đặt mới, chưa có admin nào | Set `INITIAL_ADMIN_EMAIL` + `INITIAL_ADMIN_PASSWORD` trong `apps/api/.env`, chạy `pnpm --filter @xuantoi/api bootstrap`. |
| Đã có 1 admin, muốn cấp cho người khác | Admin hiện tại vào `/admin` → Users → tìm email → nút "Set role: ADMIN". |
| Server chỉ có shell access (chưa có UI admin) | `pnpm --filter @xuantoi/api exec ts-node scripts/promote-admin.ts user@email.local`. |
| SQL trực tiếp (last resort) | `UPDATE "User" SET role = 'ADMIN' WHERE email = 'user@email.local';` |

> **Rule 9** (xem AGENTS / handoff): không bao giờ tự demote admin cuối cùng. FE hiện chưa chặn — cẩn thận khi thao tác.
>
> **PR #48 (H8 split)**: `MOD` chỉ ban được `PLAYER`, không ban/role được `ADMIN` hoặc `MOD`. Endpoint `/admin/users/:id/role` chỉ ADMIN mới gọi được — guard qua `@RequireAdmin()` decorator (PR E).

## 2. Cấu trúc role

| Role | Quyền chính |
|---|---|
| `PLAYER` | User bình thường, chơi game. |
| `MOD` | Quyền giới hạn: chỉ ban/unban được PLAYER (không tác động ADMIN/MOD), xem audit, không grant currency, không tạo giftcode (PR #48 H8 split — `@RequireAdmin()` decorator). |
| `ADMIN` | Toàn quyền — user, topup, gift code, mail, stats, audit. |

Cờ `banned: true` block đăng nhập + revoke refresh token. Đặt qua `/admin/users/:id/ban`.

## 3. Tab admin & việc thường dùng

| Tab UI | Endpoint chính | Filter / chú thích |
|---|---|---|
| Overview | `GET /admin/stats` + `GET /admin/economy/alerts` (PR #54) | Xem nhanh số user, character, topup approved, ledger total + alert nếu có currency âm / ledger inconsistent. |
| Users | `GET /admin/users?role=&banned=&q=` | Tìm user theo email/id, filter `role` (ALL/PLAYER/MOD/ADMIN) + `banned` (true/false). Thao tác: ban / unban, đổi role, grant currency, **revoke item** (PR #66 — `POST /admin/users/:id/inventory/revoke`). |
| Topups | `GET /admin/topups?q=&status=&from=&to=` (PR #67) | Filter email + status + date range. Duyệt / từ chối đơn nạp. |
| Monetization | `/admin/battle-pass/*`, `/admin/monthly-card/*`, `/admin/vip/*` | Phase 25.1 manual/test grants for Tiên Lộ Lệnh premium, Nguyệt Tạp, and VIP Light. ADMIN-only; all mutations audit. |
| Audit | `GET /admin/audit?action=&q=` | Filter theo `action` (e.g. `TOPUP_APPROVE`, `USER_ROLE_CHANGE`) + `q` (actor email). |
| GiftCodes | `GET /admin/giftcodes?q=&status=` (PR #81 G22) | Filter `q` (code search) + `status` (ALL/ACTIVE/REVOKED/EXPIRED). Tạo / list / revoke. Trùng `code` → error `CODE_EXISTS` (PR #84 G23). |
| Mail | `POST /admin/mail/{send,broadcast}` | Gửi 1 character hoặc broadcast toàn server. |
| Boss | `POST /boss/admin/spawn` (PR #36) | Spawn boss mới (chỉ ADMIN). Hiện chỉ 1 boss active 1 lúc. |

Đầy đủ endpoint xem `docs/API.md`.

## 4. Quy trình duyệt nạp (topup)

1. Player tạo đơn `POST /topup` → status `PENDING`. Server sinh `transferCode`.
2. Player chuyển khoản với nội dung = `transferCode`.
3. Admin đối soát bank → vào `/admin` → Topups → duyệt:
   - **Approve**: `POST /admin/topups/:id/approve` body `{ note }` → `CurrencyService.applyTx` cộng `tienNgoc` + ghi `CurrencyLedger reason=TOPUP_APPROVED` + audit log. Atomic.
   - **Reject**: `POST /admin/topups/:id/reject` body `{ note }` → status `REJECTED`, không tạo ledger.
4. Đơn `APPROVED` không thể approve lại (idempotent guard).

> Audit log luôn ghi `actorUserId` (= admin) + meta `{ orderId, tienNgoc, note }`. Không có rollback tự động — nếu approve nhầm phải `grant -tienNgoc` thủ công.

## 5. Grant currency

Endpoint `POST /admin/users/:id/grant` body `{ linhThach?, tienNgoc?, reason }`.

- Cộng (delta dương) hoặc trừ (delta âm) qua `CurrencyService.applyTx` → ghi ledger.
- `reason` bắt buộc → search được trong `/admin/audit` + `CurrencyLedger`.
- **Cảnh báo**: chưa có hard cap. Admin có thể cộng 10^18 linhThach → ledger có thể overflow downstream nếu không cẩn thận. **Khuyến nghị** quy ước: 1 lần grant ≤ 10^9 linhThach hoặc 10^7 tienNgoc.

### 5.1 Phase 25.1 monetization grants

Manual grants are for testing/support until real payment wiring exists:

| Action | Endpoint | Audit / ledger |
|---|---|---|
| Unlock Battle Pass premium | `POST /admin/battle-pass/users/:id/grant-premium` | `AdminAuditLog action=admin.battle_pass.grant_premium` |
| Grant 30-day Monthly Card | `POST /admin/monthly-card/users/:id/grant` | `AdminAuditLog action=admin.monthly_card.grant` + upfront `MONTHLY_CARD_REWARD` ledger |
| Grant VIP Light | `POST /admin/vip/users/:id/grant` body `{ level, lifetimeTopupAmount? }` | `AdminAuditLog action=admin.vip.grant` |

Rules:
- Only grant to an existing user with a character; `NO_CHARACTER` means the user must create a character first.
- Do not use these endpoints to compensate by selling top-tier equipment, max-star/max-awaken pháp bảo, or realm/tier bypasses. Phase 25.1 rewards are capped convenience/acceleration only.
- If a grant was wrong, investigate `/admin/audit` plus `CurrencyLedger`/`ItemLedger` by `reason` before issuing a manual reversal.

## 6. Gift code

| Trường | Ý nghĩa |
|---|---|
| `code` | Mã hiển thị (uppercase, 4–32 ký tự, unique). |
| `maxRedemptions` | Số lần redeem tối đa toàn server. `null` = không giới hạn. |
| `expiresAt` | Hết hạn tuyệt đối. |
| `rewards` | JSON `{ linhThach, tienNgoc, items: [{itemKey, qty}] }`. |
| `revoked` | `true` → không cho redeem mới. |

Tạo: `POST /admin/giftcodes`. Revoke: `POST /admin/giftcodes/:code/revoke`. Mỗi user chỉ redeem 1 lần / 1 code (`@@unique(giftCodeId, userId)`).

> **Trùng code khi tạo** (PR #84 G23): server trả error code `CODE_EXISTS` (HTTP 409). FE admin panel sẽ hiện toast tiếng Việt rõ ràng — không cần tự decode error message.

## 7. Mail

- `POST /admin/mail/send` `{ characterId, subject, body, rewards? }` — gửi 1 character.
- `POST /admin/mail/broadcast` `{ subject, body, rewards? }` — gửi tất cả character (heavy: insert N row, async qua queue khuyến nghị nhưng hiện sync).
- Player `POST /mail/:id/claim` để nhận reward (CAS chống double-claim).
- Cron prune mail đã claim > 90 ngày (`OpsService` recurring).

## 8. Boss

- Hiện chỉ có 1 boss active 1 lúc. Không có cron auto spawn → cần spawn thủ công khi muốn mở event qua `POST /boss/admin/spawn` (PR #36, ADMIN-only) hoặc tab Boss của `/admin`.
- Khi boss DEFEATED: distribute reward theo rank top 1 / top 2-3 / top 4-10 (xem `BossService.distributeRewards`). Không thể redo.

## 9. Audit log

`GET /admin/audit?page=N&action=&q=` — list desc theo `createdAt`, mỗi entry gồm `actorUserId`, `action`, `meta` (JSON). Index `(actorUserId, createdAt)` + `(action, createdAt)` để filter nhanh. Tab UI hỗ trợ filter `action` (dropdown) + `q` (actor email search).

> **User self audit log** (PR #88 M6): user thường có thể tự xem ledger của mình qua `GET /logs/me?type=currency|item` (read-only, character-isolated). Khi user thắc mắc "sao tôi mất 500 LT?" — gợi ý họ check tab "Hoạt động" trước, admin chỉ tra DB khi thực sự cần.

## 10. Hành động nguy hiểm — checklist trước khi làm

- [ ] **Set role**: chắc chắn email đúng. Không tự demote bản thân nếu là admin duy nhất.
- [ ] **Grant tienNgoc**: chắc chắn delta hợp lý, có `reason` rõ.
- [ ] **Broadcast mail with reward**: 1 lần broadcast = N entry; không thể unsend → phải đọc kỹ subject/body.
- [ ] **Revoke gift code**: redemption đã thành công không bị huỷ — chỉ chặn redeem mới.
- [ ] **Ban**: có ghi audit; user đăng nhập sẽ bị reject + revoke refresh.
- [ ] **Approve topup**: đã đối soát bank? Hợp đồng số tiền và transferCode? Approve không thể rollback tự động.

## 11. Smart economy safety — audit ledger CLI

Khi cần kiểm tra ledger consistency on-demand (vd nghi ngờ double-grant, double-spend, hoặc bug ledger không sync với `Character.linhThach`/`tienNgoc` hoặc `InventoryItem.qty`), có 2 đường:

### 11.1 Admin endpoint (UI)

`GET /admin/economy/audit-ledger` — admin/MOD đọc được. AdminView Stats tab có nút "Kiểm tra ledger" hiển thị discrepancy live trên trình duyệt. Read-only, không mutate DB.

### 11.2 CLI script (cron / CI / monitoring)

```bash
# Human-readable output (default)
pnpm --filter @xuantoi/api audit:ledger

# Machine-parseable JSON output (cho cron/Datadog/Sentry pipeline)
pnpm --filter @xuantoi/api audit:ledger -- --json
```

**Exit codes**:
- `0` — clean (không có discrepancy)
- `1` — discrepancy found (currency hoặc inventory drift)
- `2` — runtime error (DB connect fail, query crash, ...)

**JSON output shape** (`--json`):
```json
{
  "summary": {
    "charactersScanned": 1234,
    "itemKeysScanned": 5678,
    "currencyDiscrepancies": 0,
    "inventoryDiscrepancies": 0,
    "totalDiscrepancies": 0,
    "ok": true
  },
  "charactersScanned": 1234,
  "itemKeysScanned": 5678,
  "currencyDiscrepancies": [],
  "inventoryDiscrepancies": []
}
```

`CharacterDiscrepancy.ledgerSum` / `characterValue` / `diff` là `bigint` trong code, được serialize sang `string` trong JSON để giữ chính xác (Linh Thạch có thể vượt `Number.MAX_SAFE_INTEGER`). Consumer cần `BigInt(parsed.currencyDiscrepancies[0].ledgerSum)` nếu muốn arithmetic.

**Cron monitoring example** (chạy mỗi sáng 06:00):
```cron
0 6 * * * cd /opt/xuantoi && pnpm --filter @xuantoi/api audit:ledger -- --json > /var/log/xuantoi/audit-$(date +\%Y-\%m-\%d).json 2>&1 || echo "Ledger drift detected — see log"
```

Read-only — an toàn chạy production không ảnh hưởng player.

### 11.3 Economy alerts CLI — `alerts:economy`

Tương tự `audit:ledger`: chạy admin endpoint `GET /admin/economy/alerts` ở dạng CLI để cron / pipeline kiểm tra read-only.

```bash
# Human-readable (mặc định)
pnpm --filter @xuantoi/api alerts:economy

# Machine-parseable JSON
pnpm --filter @xuantoi/api alerts:economy -- --json

# Override stale-hours (default 24h)
pnpm --filter @xuantoi/api alerts:economy -- --stale-hours=48
pnpm --filter @xuantoi/api alerts:economy -- --json --stale-hours=72
```

**Exit codes**:
- `0` — clean (no alerts)
- `1` — alerts found
- `2` — runtime error (DB connect, query crash, invalid arg)

**JSON shape**:
```json
{
  "summary": {
    "negativeCurrency": 0,
    "negativeInventory": 0,
    "stalePendingTopups": 0,
    "total": 0,
    "ok": true
  },
  "negativeCurrency": [...],
  "negativeInventory": [...],
  "stalePendingTopups": [...],
  "staleHours": 24,
  "generatedAt": "..."
}
```

**Cron monitoring** (chạy mỗi giờ):
```cron
0 * * * * cd /opt/xuantoi && pnpm --filter @xuantoi/api alerts:economy -- --json > /var/log/xuantoi/alerts-$(date +\%Y-\%m-\%d-\%H).json 2>&1 || (cat /var/log/xuantoi/alerts-$(date +\%Y-\%m-\%d-\%H).json | jq '.summary' && curl -X POST $SLACK_WEBHOOK -d "Economy alerts!")
```

Khi cron exit code `1` (alerts có), dispatch Slack/PagerDuty notification dựa vào count: low (1..2), medium (3..9), high (>=10).

`linhThach` là `BigInt` ở DB → JSON serialize sang string, không cast về `number` (có thể vượt `Number.MAX_SAFE_INTEGER`).

### 11.4 Economy alerts — ops-tunable thresholds

`GET /admin/economy/alerts?staleHours=<N>` query range mặc định `[1..720]` giờ với default `24`. Ops có thể override qua env:

| Env var | Default | Ý nghĩa |
|---|---|---|
| `ECONOMY_ALERTS_DEFAULT_STALE_HOURS` | `24` | Hours mặc định khi query param missing. |
| `ECONOMY_ALERTS_MIN_STALE_HOURS` | `1` | Lower bound clamp cho query param. |
| `ECONOMY_ALERTS_MAX_STALE_HOURS` | `720` (30 ngày) | Upper bound clamp cho query param. |

Ví dụ: muốn chạy closed-beta soft-launch 48h auto-approve topup và audit dài 90 ngày:

```bash
ECONOMY_ALERTS_DEFAULT_STALE_HOURS=48
ECONOMY_ALERTS_MAX_STALE_HOURS=2160  # 90 * 24
```

Invariant tự clamp: nếu `max < min` → max = min; nếu `default` out of `[min, max]` → clamp to range. Ops set sai log warn `[economy-alerts] ...` trong Nest Logger, endpoint vẫn serve (không brick). Response payload giờ trả thêm `data.bounds: { defaultHours, minHours, maxHours }` để FE show range hint nếu muốn.

## 12. Reset môi trường staging

- DB: `prisma migrate reset --force --skip-seed` rồi `pnpm --filter @xuantoi/api bootstrap` (xem `docs/RUN_LOCAL.md`).
- Redis: `redis-cli FLUSHDB` (chỉ với redis dev/staging, **không bao giờ** với production khi còn rate-limit live).
- MinIO: xoá bucket qua console.

## 13. Liên kết

- Vận hành / chạy local: `docs/RUN_LOCAL.md`.
- Deploy production: `docs/DEPLOY.md`.
- Bảo mật: `docs/SECURITY.md`.
- Lỗi thường gặp: `docs/TROUBLESHOOTING.md`.
- Catalog seed: `docs/SEEDING.md`, `docs/BALANCE.md`.
