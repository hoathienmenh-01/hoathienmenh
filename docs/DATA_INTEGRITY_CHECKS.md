# DATA INTEGRITY CHECKS (Phase 43)

Script `scripts/integrity-check.mjs` scan các invariants dữ liệu nền
**report-only**. KHÔNG auto-fix dữ liệu production.

---

## 1. Sử dụng

```bash
pnpm integrity:check                          # text output
pnpm integrity:check --json                   # JSON output
pnpm integrity:check --scope=currency         # 1 scope
pnpm integrity:check --scope=currency,inventory,giftcode,character
pnpm integrity:check --no-redis               # bỏ ghi artefact Redis
INTEGRITY_STRICT=1 pnpm integrity:check       # exit 1 khi có issue
```

Yêu cầu env:
- `DATABASE_URL` — Prisma client.
- `REDIS_URL` — optional, dùng để ghi artefact last-run (TTL 7 ngày).

Exit code:
- `0` — clean, hoặc có issue ở chế độ report-only (default).
- `1` — có issue + `INTEGRITY_STRICT=1`.
- `2` — script lỗi runtime (DB unreachable, flag sai, …).

---

## 2. Scopes & Checks

### `currency`

- **checkCurrencyNegative**: `Character` có 1 trong các currency âm
  (`linhThach`, `tienNgoc`, `tienNgocKhoa`, `nguyenThach`, `congHien`,
  `congDuc`, `trialPoint`, `eventToken`, `sectContribBalance`).
- Severity: `ERROR`. Hard invariant Phase 9 (currency >= 0). Phát
  hiện → ticket investigate immediately.

### `inventory`

- **checkInventoryNegative**: `InventoryItem.qty < 0`.
  - Severity: `ERROR`. Invariant Phase 9.
- **checkInventoryZeroStale**: `InventoryItem.qty == 0`.
  - Severity: `WARN`. Stale row, không phải corruption — consume flow
    đôi khi để qty=0 thay vì xoá.

### `giftcode`

- **checkGiftcodeDuplicate**: `(giftCodeId, userId)` xuất hiện > 1 lần
  trong `GiftCodeRedemption`.
  - Severity: `FATAL`. UNIQUE constraint bị bypass → DB compromise
    hoặc migration drift.

### `character`

- **checkOrphanCharacter**: `CurrencyLedger` / `ItemLedger` trỏ tới
  `characterId` đã bị xoá (CASCADE delete đảm bảo không có nhưng
  defensive check).
  - Severity: `ERROR`.

---

## 3. Output sample

Text:

```
[integrity] runAt=2025-01-15T08:23:11.123Z
[integrity] scopes=currency,inventory,giftcode,character
[integrity] status=ISSUES issues=2
[integrity] WARN  inventory   12 inventory_item row(s) còn lại với qty=0 ...
[integrity] ERROR currency    1 character(s) có currency âm ...
```

JSON:

```json
{
  "runAt": "2025-01-15T08:23:11.123Z",
  "status": "ISSUES",
  "scopes": ["currency","inventory","giftcode","character"],
  "issueCount": 13,
  "issues": [
    { "scope": "inventory", "severity": "WARN", "message": "12 ...", "count": 12 },
    { "scope": "currency",  "severity": "ERROR","message": "1 ...",  "count": 1 }
  ]
}
```

Issue truncate cap = 50 (tránh Redis bloat).

---

## 4. Redis Artefact

Nếu Redis reachable + không có `--no-redis` → ghi key
`xt:system-status:integrity:last-run` (TTL 7 ngày). Admin UI
`/admin/system-status` đọc artefact này hiển thị.

Manual peek:

```bash
redis-cli -u $REDIS_URL GET xt:system-status:integrity:last-run | jq
```

---

## 5. Cron / Scheduler

Recommend chạy:
- Pre-deploy verify gate (đã có ở `verify-deploy.mjs` — extend nếu
  cần).
- Daily cron 03:00 UTC để admin có snapshot mỗi sáng.
- Sau mỗi event/giftcode đợt lớn (manual trigger).

KHÔNG chạy quá thường xuyên — mỗi run scan table có thể tốn ms tới
giây tùy size DB.

---

## 6. Vì sao không có `--fix`?

Phase 43 = vận hành **safe**. Auto-fix production dữ liệu rủi ro:

- Currency âm có thể là race condition đang được fix ở phase khác →
  reset = mất audit trail.
- Inventory qty=0 stale row có thể là consume flow đúng (đợi
  pagination cleanup).
- Giftcode duplicate FATAL = DB compromise → KHÔNG xoá row, phải
  investigate root cause.

Mọi mutation phải qua admin grant endpoint (audit log + permission).

---

## 7. Mở rộng

Thêm check mới:

1. Implement function `async check<Name>(prisma): Promise<Issue[]>` ở
   `scripts/integrity-check.mjs`.
2. Append vào `SCOPE_FNS[<scope>]`.
3. (Optional) Thêm test ở `apps/api/src/modules/system-status/...test.ts`.
4. Update doc này.

KHÔNG vượt scope: KHÔNG check gameplay formula / boss drop rate /
market price — đó là balance design, không phải integrity.
