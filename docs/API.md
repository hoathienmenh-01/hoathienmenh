# Xuân Tôi — API Inventory

Tóm tắt mọi endpoint REST + WebSocket event đang có ở `@xuantoi/api`. Mọi response REST bọc trong `{ ok: boolean, data?: T, error?: { code, message } }` trừ `/healthz` / `/readyz` / `/version`.

**Global prefix**: tất cả route REST đều có prefix `/api/` (set trong `apps/api/src/main.ts` qua `app.setGlobalPrefix('api')`). Các path bên dưới ghi tương đối — ví dụ `/character/me` thực tế là `/api/character/me`.

## Auth cookie

- `xt_access` (JWT, 15 phút, httpOnly, SameSite=Lax)
- `xt_refresh` (JWT, 30 ngày, httpOnly, SameSite=Lax)

Đổi mật khẩu / logout-all → `passwordVersion`++ → access token cũ bị reject ở guard. Logout đơn lẻ chỉ revoke refresh row hiện tại + clear cookie (không bump `passwordVersion` — intentional trade-off, xem `docs/SECURITY.md`).

## Health & Metadata

| Method | Path       | Auth | Mô tả |
|--------|------------|------|-------|
| GET    | `/healthz` | —    | Liveness. 200 luôn nếu process chạy; trả `{ ok, uptimeMs, ts }`. |
| GET    | `/readyz`  | —    | Readiness. Check DB + Redis. 200 ok, 503 khi fail. |
| GET    | `/version` | —    | `{ name, version, commit, node, ts }`. |

## Auth — `AuthController` (prefix `_auth`)

| Method | Path                      | Auth | Mô tả |
|--------|---------------------------|------|-------|
| POST   | `/_auth/register`         | —    | Body `{ email, password }`. 201 set cookie. **Rate limit per-IP 5 / 15min** (PR #60). |
| POST   | `/_auth/login`            | —    | Rate limit 5 fail / 15p / IP+email qua `LoginAttempt`. |
| POST   | `/_auth/logout`           | Yes  | Revoke refresh row hiện tại + clear cookie. |
| POST   | `/_auth/logout-all`       | Yes  | Revoke toàn bộ refresh token của user (mọi thiết bị). FE confirm modal trước (PR #83/#85). |
| POST   | `/_auth/refresh`          | Yes (xt_refresh) | Rotation + reuse-detection. Sai → revoke cả chain. |
| GET    | `/_auth/session`          | Yes  | Trả `{ user: PublicUser }`. |
| POST   | `/_auth/change-password`  | Yes  | `{ oldPassword, newPassword }`. `passwordVersion`++ → kill mọi phiên. |

## Character — `CharacterController`

| Method | Path                     | Auth | Mô tả |
|--------|--------------------------|------|-------|
| GET    | `/character/me`          | Yes  | Nhân vật của user hoặc `null`. |
| GET    | `/character/profile/:id` | Yes  | Public profile. **Rate limit per-IP 120 / 15min** (PR #62 — anti-scrape). 404 NOT_FOUND nếu không tồn tại. |
| GET    | `/character/state`       | Yes  | Giống `me` + 404 NO_CHARACTER nếu chưa onboard. |
| POST   | `/character/onboard`     | Yes  | Body `{ name, sectKey: 'thanh_van' \| 'huyen_thuy' \| 'tu_la' }`. |
| POST   | `/character/cultivate`   | Yes  | Body `{ cultivating: boolean }`. Bật/tắt Nhập Định (tick qua cron BullMQ). |
| POST   | `/character/breakthrough` | Yes | Đột phá cảnh giới khi đủ EXP + đỉnh stage. |
| GET    | `/character/titles`        | Yes | Phase 11.9.C — `{ owned[], catalog (26 def), equipped }`. `owned[]` sort `unlockedAt asc`. |
| POST   | `/character/title/equip`   | Yes | Phase 11.9.C — `{ titleKey }` → set `Character.title`. 404 `TITLE_NOT_FOUND` khi key ∉ catalog; 409 `TITLE_NOT_OWNED` khi chưa unlock. Idempotent re-equip. |
| POST   | `/character/title/unequip` | Yes | Phase 11.9.C — clear `Character.title = null`. Idempotent (no-op khi đang null). |
| GET    | `/character/buffs`         | Yes | Phase 11.8.D — list `active[]` non-expired, auto-prune trước khi return. Sort `expiresAt asc`. Mỗi entry `{ buffKey, stacks, source, expiresAt (ISO), def }`. |

Tick EXP thực hiện bởi BullMQ processor `cultivation.processor.ts`. WS event `cultivate:tick` emit per-user khi tick xong. `CharacterStatePayload.title: string \| null` (Phase 11.9.C) push qua `state:update` event để FE hiển thị title đang trang bị trong topbar.

## Combat PvE — `CombatController`

| Method | Path              | Auth | Mô tả |
|--------|-------------------|------|-------|
| POST   | `/combat/engage`  | Yes  | `{ dungeonKey }`. Tạo encounter ACTIVE. |
| POST   | `/combat/turn`    | Yes  | Tấn công 1 lượt; kết thúc → loot + linhThach via ledger. |
| GET    | `/combat/current` | Yes  | Encounter đang chạy (nếu có). |

## Inventory — `InventoryController`

| Method | Path                  | Auth | Mô tả |
|--------|-----------------------|------|-------|
| GET    | `/inventory/me`       | Yes  | List item + equipped slot. |
| POST   | `/inventory/equip`    | Yes  | `{ itemId, slot }`. |
| POST   | `/inventory/unequip`  | Yes  | `{ slot }`. |
| POST   | `/inventory/use-pill` | Yes  | Tiêu đan. Ghi `ItemLedger` qtyDelta âm. |

## Market — `MarketController`

| Method | Path                          | Auth | Mô tả |
|--------|-------------------------------|------|-------|
| GET    | `/market/listings`            | Yes  | Browse listings. |
| POST   | `/market/listings`            | Yes  | Đăng bán. |
| POST   | `/market/listings/:id/buy`    | Yes  | Mua — bilateral lock via ledger. Phí `MARKET_FEE_PCT` (env). |
| POST   | `/market/listings/:id/cancel` | Yes  | Huỷ (chỉ chủ listing). |

## Sect & Chat — `SectController`, `ChatController`

| Method | Path                  | Auth | Mô tả |
|--------|-----------------------|------|-------|
| POST   | `/sect/create`        | Yes  | Tạo tông môn. |
| POST   | `/sect/join`          | Yes  | Gia nhập. |
| POST   | `/sect/leave`         | Yes  | Rời. |
| POST   | `/sect/contribute`    | Yes  | Đóng linh thạch → treasury + cống hiến. |
| GET    | `/chat/world?limit=N` | Yes  | Lịch sử world chat. |
| POST   | `/chat/send`          | Yes  | Gửi. Rate limit 8 msg / 30s / player (Redis). |

## Boss — `BossController`

| Method | Path                | Auth  | Mô tả |
|--------|---------------------|-------|-------|
| GET    | `/boss/current`     | Yes   | Boss đang active + top 10 damage. |
| POST   | `/boss/:id/attack`  | Yes   | Đánh boss; khi HP ≤ 0 → distribute reward theo rank (top 1 = 50%). Phase 13.0 §C: reward hooks unlock title `achievement_first_boss` (mọi participant), apply buff `event_double_drop` (top-1, 1h), unlock title `event_huyet_nguyet_2026` nếu spawn từ Huyết Nguyệt slot. |
| POST   | `/boss/admin/spawn` | ADMIN | Spawn boss thủ công. Audit `BOSS_SPAWN`. |

**Phase 13.0 §B — scheduled boss heartbeat**: BossService heartbeat (mỗi N giây) đọc `bossScheduleForToday(now, MISSION_RESET_TZ)` từ shared `LIVE_OPS_EVENTS`, mỗi region check active/upcoming slot. Spawn nếu slot active + region không có `WorldBoss` ACTIVE + chưa có spawn `(regionKey, bossKey, spawnedAt >= slotStart)` (slot dedup, idempotent qua parallel heartbeat). KHÔNG schema migration — slot dedup query-based.

## LiveOps — `LiveOpsController` (Phase 13.0 §D)

| Method | Path             | Auth | Mô tả |
|--------|------------------|------|-------|
| GET    | `/liveops/today` | None | Pure compute (< 1ms) trả retention dashboard snapshot. |

**Response shape** (`200 OK`):

```json
{
  "ok": true,
  "data": {
    "nowIso": "2026-05-09T14:30:00.000Z",
    "timezone": "Asia/Ho_Chi_Minh",
    "todayEvents": [{ "key": "...", "type": "BOSS|DAILY|WEEKLY|LIMITED|STORY", "titleI18nKey": "liveops.event.<key>.title", "descriptionI18nKey": "...", "rewardHintI18nKey?": "...", "bossKey?": "...", "regionKey?": "...", "dailyTime?": "12:00", "daysOfWeek?": [6], "durationMinutes?": 30 }],
    "activeEvents": [/* same shape, filter active at nowIso */],
    "nextEvent": { /* shape + slotStartIso, slotEndIso, secondsUntilStart */ } | null,
    "bossSchedule": [{ "key": "...", "bossKey": "...", "regionKey": "...", "slotStartIso": "...", "slotEndIso": "...", "status": "upcoming|active|completed", "secondsUntilStart": 0 }],
    "suggestedActivities": [{ "key": "...", "kind": "boss|event|daily|weekly", "titleI18nKey": "...", "bossKey?": "...", "regionKey?": "...", "secondsUntilStart?": 0 }]
  }
}
```

Override timezone qua env `LIVEOPS_TZ` (default `Asia/Ho_Chi_Minh` reuse `MISSION_RESET_TZ`). Không cache HTTP — backend pure compute đủ nhanh; FE auto refresh 60s.

## Daily Login — `DailyLoginController` (PR #80, M9)

| Method | Path                 | Auth | Mô tả |
|--------|----------------------|------|-------|
| GET    | `/daily-login/me`    | Yes  | `{ todayDateLocal, canClaimToday, currentStreak, nextRewardLinhThach }`. Tính theo `MISSION_RESET_TZ` (default `Asia/Ho_Chi_Minh`). |
| POST   | `/daily-login/claim` | Yes  | Idempotent: lần đầu trong ngày → +100 LT + ghi `CurrencyLedger reason=DAILY_LOGIN`; gọi lần 2 → `{ claimed: false }`. |

## Leaderboard — `LeaderboardController` (PR #59)

| Method | Path                  | Auth | Mô tả |
|--------|-----------------------|------|-------|
| GET    | `/leaderboard/power?limit=50` | Yes | Top theo `(realm, power)` desc, clamp `1 ≤ limit ≤ 50`. Trả `{ entries: [{ rank, characterId, name, sectKey, realmKey, realmStage, power }] }`. |

## Shop — `ShopController`

| Method | Path        | Auth | Mô tả |
|--------|-------------|------|-------|
| GET    | `/shop/npc` | Yes  | Catalog NPC items. Mỗi entry kèm `dailyLimit: number \| null` (M10) để FE hiển thị badge "X/Y today". |
| POST   | `/shop/buy` | Yes  | `{ itemKey, qty }` → trừ tiền + grant item + ghi `ItemLedger reason=SHOP_BUY`. M10 layered guard: **per-user rate limit** 30 req/60s (Redis sliding window + in-memory failover) → 429 `RATE_LIMITED`; **per-item daily cap** từ `ShopEntryDef.dailyLimit` (sum `qtyDelta` ledger SHOP_BUY trong cửa sổ DAILY local tz `MISSION_RESET_TZ`) → 409 `SHOP_DAILY_LIMIT`. Pre-check trước transaction → KHÔNG trừ tiền khi reject. |

## Mission — `MissionController`

| Method | Path                  | Auth | Mô tả |
|--------|-----------------------|------|-------|
| GET    | `/missions/me`        | Yes  | Progress daily/weekly/once của player + `serverDateLocal`. Reset theo `MISSION_RESET_TZ`. |
| POST   | `/missions/:id/claim` | Yes  | Nhận thưởng khi `progress >= target`. Idempotent qua `claimedAt`. |

WS push: `mission:progress` (PR #63) emit sau `MissionService.track()` qua `MissionWsEmitter` throttle 500ms/user.

## Mail — `MailController`

| Method | Path                | Auth  | Mô tả |
|--------|---------------------|-------|-------|
| GET    | `/mail/me`          | Yes   | Inbox (≤100 mail desc). |
| GET    | `/mail/unread-count`| Yes   | `{ count }`. Hydrate badge sau login (PR #71, M7). |
| POST   | `/mail/:id/read`    | Yes   | Đánh dấu đã đọc. |
| POST   | `/mail/:id/claim`   | Yes   | Nhận thưởng; CAS chống double-claim. |

## Giftcode — `GiftcodeController` + `AdminController`

| Method | Path                              | Auth  | Mô tả |
|--------|-----------------------------------|-------|-------|
| POST   | `/giftcodes/redeem`               | Yes   | `{ code }` → trao reward, 1 user / 1 code. |
| GET    | `/admin/giftcodes?q=&status=&limit=` | ADMIN | List codes + filter (PR #81 G22). Status: `ACTIVE` / `REVOKED` / `EXPIRED` / `EXHAUSTED`. |
| POST   | `/admin/giftcodes`                | ADMIN | Tạo code. Trùng `code` → 409 `CODE_EXISTS` (PR #84 G23). |
| POST   | `/admin/giftcodes/:code/revoke`   | ADMIN | Vô hiệu hoá. |

## Topup & Admin — `TopupController`, `AdminController`

| Method | Path                                  | Auth  | Mô tả |
|--------|---------------------------------------|-------|-------|
| GET    | `/topup/packages`                     | —     | Catalog gói topup. |
| GET    | `/topup/me`                           | Yes   | Lịch sử đơn của user. |
| POST   | `/topup/create`                       | Yes   | `{ packageId, proofMessage }`. |
| GET    | `/admin/users?q=&role=&banned=&page=` | ADMIN | List user + filter (PR earlier — role/banned). |
| POST   | `/admin/users/:id/ban`                | ADMIN | `{ banned }`. |
| POST   | `/admin/users/:id/role`               | ADMIN | `{ role }` — ADMIN-only (M8). |
| POST   | `/admin/users/:id/grant`              | ADMIN | `{ linhThach, tienNgoc, reason }` — qua `CurrencyService` + ghi ledger `ADMIN_GRANT`. |
| POST   | `/admin/users/:id/inventory/revoke`   | ADMIN | `{ itemKey, qty, reason }` (PR #66) — trừ qty + ghi `ItemLedger reason=ADMIN_REVOKE`. |
| GET    | `/admin/topups?status=&q=&from=&to=&page=` | ADMIN | List đơn topup + filter date/email. |
| POST   | `/admin/topups/:id/approve`           | ADMIN | `{ note }` → credit tienNgoc + ledger. |
| POST   | `/admin/topups/:id/reject`            | ADMIN | `{ note }`. |
| GET    | `/admin/audit?action=&q=&page=`       | ADMIN | Audit log + filter action/actor email. |
| GET    | `/admin/stats`                        | ADMIN | Dashboard counters (users/topups pending/economy). |
| GET    | `/admin/economy/alerts`               | ADMIN | Smart alerts: currency âm, item qty âm, ledger discrepancy (PR #54). |
| POST   | `/admin/mail/send`                    | ADMIN | Gửi cho 1 character. |
| POST   | `/admin/mail/broadcast`               | ADMIN | Gửi toàn server. |

## Next Action — `NextActionController` (smart UX)

| Method | Path                | Auth | Mô tả |
|--------|---------------------|------|-------|
| GET    | `/me/next-actions`  | Yes  | Trả list "Nên làm gì tiếp?" — sắp đột phá / mission claim / mail unread / giftcode khả dụng / boss đang mở / daily login. |

## Logs — `LogsController` (PR #88, M6)

| Method | Path                                     | Auth | Mô tả |
|--------|------------------------------------------|------|-------|
| GET    | `/logs/me?type=currency\|item&limit=&cursor=` | Yes | Self audit log của user — query `CurrencyLedger` hoặc `ItemLedger` của character mình. Keyset pagination `(createdAt DESC, id DESC)`. `limit ∈ [1, 50]`, default 20. Cursor opaque base64url `{createdAt.toISOString()}|{id}`. Response `{ entries: LogEntry[], nextCursor }`. Errors: `NO_CHARACTER` (404), `INVALID_CURSOR` (400). BigInt `delta` serialize as string. |

`LogEntry` shape:
- `LogEntryCurrency`: `{ kind: 'CURRENCY', id, createdAt, reason, refType, refId, actorUserId, currency: 'LINH_THACH'|'TIEN_NGOC', delta: string }`
- `LogEntryItem`: `{ kind: 'ITEM', id, createdAt, reason, refType, refId, actorUserId, itemKey, qtyDelta: number }`

## WebSocket — `/ws` (RealtimeGateway)

Auth từ cookie `xt_access` (ưu tiên) hoặc `handshake.auth.token`.

| Event                | Direction      | Payload |
|----------------------|----------------|---------|
| `cultivate:tick`     | server → user  | `{ exp, realm, cultivating }` per tick. |
| `chat:msg`           | server → room  | `{ id, characterName, channel, body, createdAt }`. |
| `boss:update`        | server → all   | HP + top damager sau attack. |
| `market:listing:new` | server → all   | Listing mới. |
| `mission:progress`   | server → user  | `{ characterId, changes: MissionProgressChange[] }` (PR #63 — throttle 500ms). |
| `mail:new`           | server → user  | (kế hoạch) Khi admin gửi mail mới. |

## Sect War — `SectWarController` (prefix `/sect-war`)

> Phase 13.1.A — Tông Môn Chiến theo tuần. weekKey = ISO `YYYY-Www`, timezone reuse `MISSION_RESET_TZ`. Mọi state authoritative ở server; FE chỉ render.

| Method | Path                       | Auth | Mô tả |
|--------|----------------------------|------|-------|
| GET    | `/sect-war/current`        | Yes  | Snapshot tuần hiện tại: `{ weekKey, season{startsAtIso,endsAtIso,timezone}, activities[], rewardTiers[], leaderboard[], me }`. `activities` + `rewardTiers` mirror shared catalog (server snapshot, FE không cần import shared). |
| GET    | `/sect-war/leaderboard?weekKey=` | Yes | `{ weekKey, rows: [{ rank, sectId, sectName, points, contributors }] }`. weekKey query optional (default current). |
| GET    | `/sect-war/me`             | Yes  | `{ weekKey, hasSect, sectId, sectName, personalPoints, breakdown[], sectRank, sectPoints, eligibleTierKey, alreadyClaimed, canClaim }`. |
| POST   | `/sect-war/claim`          | Yes  | Claim weekly reward. Atomic CAS qua composite UNIQUE `(weekKey, characterId)`. Trả `{ weekKey, rewardTierKey, granted{linhThach,tienNgoc}, sectRank, personalPoints }`. |

**Sect War error codes**:
- `SECT_REQUIRED` — character chưa gia nhập tông môn.
- `SECT_WAR_NOT_CLAIMABLE` — sect không có rank đủ điều kiện trong tuần (rank > 10) và personal points < participation threshold.
- `SECT_WAR_ALREADY_CLAIMED` — đã claim tuần này (composite UNIQUE).
- `SECT_WAR_NO_REWARD` — không có tier nào áp dụng (no-op safety).
- `NO_CHARACTER` — chưa có nhân vật.

**Idempotency** contribution: composite UNIQUE `(weekKey, characterId, activityKey, sourceType, sourceId)` trên `SectWarContribution`. Hook gameplay (DungeonRun.claim, Boss.distributeRewards, DailyLogin.claim, Quest.claim) gọi `addContributionTx` trong cùng transaction — retry hook → P2002 silently skipped (return null). Daily cap window theo `MISSION_RESET_TZ` (default `Asia/Ho_Chi_Minh`, 00:00 ICT) — đồng nhất với dungeon dailyLimit / mission DAILY / daily-login streak. Weekly cap qua ISO week (Mon 00:00 ICT → Sun 23:59 ICT).

## Sect Missions — `SectMissionController` (prefix `/sect`, Phase 13.1.B)

> Phase 13.1.B — daily/weekly mission Tông Môn cộng `congHien` (= `Character.contribBalance`). Catalog ở [`packages/shared/src/sect-missions.ts`](../packages/shared/src/sect-missions.ts). Server-authoritative; FE chỉ render.

| Method | Path                          | Auth | Mô tả |
|--------|-------------------------------|------|-------|
| GET    | `/sect/missions`              | Yes  | Snapshot mission list của character. Response `{ contribLifetime, contribBalance, sectId, sectName, missions: SectMissionView[] }`. Mỗi `SectMissionView` gồm `{ key, cadence: 'DAILY'\|'WEEKLY', activityKey, target, rewardContribution, rewardCurrency?, rewardCurrencyAmount?, rewardItemKey?, rewardItemQty?, titleI18nKey, descriptionI18nKey, progress, ready, claimed, periodKey, periodStartIso, periodEndIso }`. `progress` derive từ `SectWarContribution` rows hoặc `Character` snapshot trong period window. `claimed` true nếu đã có row `SectMissionClaim(characterId, missionKey, periodKey)`. |
| POST   | `/sect/missions/:key/claim`   | Yes  | `:key` = mission key (ví dụ `sect_daily_dungeon_3`). Atomic transaction: assert `progress >= target` + insert `SectMissionClaim(characterId, missionKey, periodKey)` (P2002 → `MISSION_ALREADY_CLAIMED`) + cộng `Character.contribBalance` + `contribLifetime` + (optional) cộng `linhThach` qua `CurrencyService` + (optional) grant item qua `InventoryService.grantTx`. Ledger `SECT_MISSION_CLAIM`. Trả `{ missionKey, cadence, periodKey, rewardContribution, contribBalanceAfter, contribLifetimeAfter, rewardLinhThach? }`. |

**Sect Mission error codes**:
- `SECT_REQUIRED` — `Character.sectId == null` (chưa gia nhập tông môn).
- `MISSION_NOT_FOUND` — `:key` không có trong catalog.
- `MISSION_NOT_READY` — `progress < target`.
- `MISSION_ALREADY_CLAIMED` — đã claim cho cùng `(characterId, missionKey, periodKey)`.
- `NO_CHARACTER` — chưa có nhân vật.

## Sect Shop — `SectShopController` (prefix `/sect`, Phase 13.1.B)

> Phase 13.1.B — spend `congHien` đổi consumable/material. 5 entry catalog ở [`packages/shared/src/sect-shop.ts`](../packages/shared/src/sect-shop.ts). Atomic CAS, race-safe, rate-limited.

| Method | Path                | Auth | Mô tả |
|--------|---------------------|------|-------|
| GET    | `/sect/shop`        | Yes  | Snapshot catalog + per-character usage. Response `{ contribBalance, contribLifetime, sectId, sectName, entries: SectShopEntryView[] }`. Mỗi `SectShopEntryView` gồm `{ key, itemKey, contributionCost, dailyLimit?, weeklyLimit?, dailyUsed, weeklyUsed, requiredSectLevel?, labelI18nKey, descriptionI18nKey, stackable, maxStack? }`. `dailyUsed` / `weeklyUsed` aggregate từ `SectShopPurchase.qty` trong period window theo `MISSION_RESET_TZ`. |
| POST   | `/sect/shop/buy`    | Yes  | `{ entryKey: string, qty: number }` (qty >= 1). Pre-checks ngoài transaction: rate-limit (`RATE_LIMITED` 429 nếu vượt 30 req/60s), entry exists (`ENTRY_NOT_FOUND`), sectId (`SECT_REQUIRED`), stackable check (`NON_STACKABLE_QTY_GT_1` nếu qty>1 cho item non-stackable), daily/weekly limit (`SHOP_DAILY_LIMIT_REACHED` / `SHOP_WEEKLY_LIMIT_REACHED`). Transaction: CAS `prisma.character.updateMany({ where: { id, contribBalance: { gte: cost*qty } } })` (count=0 → `INSUFFICIENT_CONTRIB`) + `InventoryService.grantTx(tx, charId, itemKey, qty, 'SECT_SHOP_BUY')` + insert `SectShopPurchase` row. Ledger `SECT_SHOP_BUY`. Trả `{ entryKey, itemKey, qty, totalCost, contribBalanceAfter, dailyUsedAfter, weeklyUsedAfter }`. |

**Sect Shop error codes**:
- `SECT_REQUIRED` — chưa gia nhập tông môn.
- `ENTRY_NOT_FOUND` — `entryKey` không có trong catalog.
- `INSUFFICIENT_CONTRIB` — `contribBalance < cost*qty` (CAS reject — KHÔNG trừ tiền).
- `SHOP_DAILY_LIMIT_REACHED` — `dailyUsed + qty > dailyLimit`.
- `SHOP_WEEKLY_LIMIT_REACHED` — `weeklyUsed + qty > weeklyLimit`.
- `NON_STACKABLE_QTY_GT_1` — defensive guard `qty > 1` cho item non-stackable.
- `RATE_LIMITED` (429) — vượt 30 req/60s per user (Redis primary + in-memory fallback).
- `INVALID_INPUT` — qty < 1 hoặc kiểu sai.
- `NO_CHARACTER` — chưa có nhân vật.

## Admin LiveOps Controls — `AdminLiveOpsController` (Phase 13.1.B)

> Phase 13.1.B — admin override LiveOps event toggles + sect-war status/recalculate. Mọi endpoint role `ADMIN` (`AdminGuard`).

| Method | Path                              | Auth  | Mô tả |
|--------|-----------------------------------|-------|-------|
| GET    | `/admin/liveops`                  | ADMIN | Status snapshot. Response `{ nowIso, timezone, eventsTotal, eventsActive, eventsToday, events: AdminLiveOpsEventStatus[], sectWar: AdminSectWarSummary }`. Mỗi `AdminLiveOpsEventStatus` gồm `{ key, type, titleI18nKey, scheduledEnabled (catalog default), overrideEnabled? (LiveOpsEventOverride.enabled nếu có), effectiveEnabled, lastOverrideAt? (ISO), lastOverrideBy? (User.email) }`. `AdminSectWarSummary` = `{ weekKey, season{startsAtIso,endsAtIso,timezone}, sectsRanked, contributionsThisWeek }`. |
| POST   | `/admin/liveops/event/toggle`     | ADMIN | `{ eventKey: string, enabled: boolean }`. Upsert `LiveOpsEventOverride(eventKey)` → `{ enabled, updatedAt, updatedBy: actorUserId }`. Audit log `ADMIN_LIVEOPS_OVERRIDE` (`{ actor, eventKey, enabled, prev: oldEnabled }`). Trả `{ eventKey, enabled, prev, overrideAt }`. |
| GET    | `/admin/sect-war/status`          | ADMIN | Read-only sect-war diagnostic. Response `{ weekKey, season{startsAtIso,endsAtIso,timezone}, sectsRanked, contributionsThisWeek, leaderboard[] (top N), claimsThisWeek }`. KHÔNG mutation. |
| POST   | `/admin/sect-war/recalculate`     | ADMIN | No-op điểm contribution (read-only audit response). Trả `{ weekKey, recalculatedAt: ISO, contributionsScanned, leaderboardSize, message: 'recalc_no_op' }`. KHÔNG sửa contribution rows hoặc claim rows hiện có. (Future: nếu thêm logic recompute, vẫn phải atomic + audit). |

**Admin LiveOps error codes**:
- `FORBIDDEN` — không phải ADMIN (qua `AdminGuard` chặn trước controller).
- `EVENT_NOT_FOUND` — `eventKey` không có trong catalog `LIVE_OPS_EVENTS`.
- `INVALID_INPUT` — body sai shape (zod).

## Error codes (chuẩn hoá)

- **Auth**: `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `RATE_LIMITED`, `PASSWORD_CHANGED`, `REUSED_REFRESH_TOKEN`, `BANNED`, `INVALID_INPUT`.
- **Character**: `NO_CHARACTER`, `NAME_TAKEN`, `ALREADY_ONBOARDED`, `NOT_ENOUGH_EXP`, `NOT_AT_PEAK`, `NOT_IN_CULTIVATION`, `NOT_FOUND`.
- **Combat**: `IN_COMBAT`, `NO_ENCOUNTER`, `ENCOUNTER_NOT_ACTIVE`.
- **Market**: `ITEM_NOT_FOUND`, `NOT_OWNER`, `NOT_ENOUGH_FUNDS`, `LISTING_SOLD`.
- **Sect**: `ALREADY_IN_SECT`, `NOT_IN_SECT`, `NOT_ENOUGH_FUNDS`.
- **Sect War**: `SECT_REQUIRED`, `SECT_WAR_NOT_CLAIMABLE`, `SECT_WAR_ALREADY_CLAIMED`, `SECT_WAR_NO_REWARD`, `NO_CHARACTER`.
- **Boss**: `NO_ACTIVE_BOSS`, `BOSS_DEAD`, `COOLDOWN`.
- **Topup/Admin**: `TOO_MANY_PENDING`, `ALREADY_PROCESSED`, `FORBIDDEN`, `NOT_FOUND`.
- **Giftcode**: `CODE_NOT_FOUND`, `CODE_EXPIRED`, `CODE_REVOKED`, `CODE_EXHAUSTED`, `ALREADY_REDEEMED`, `CODE_EXISTS` (admin create — PR #84), `NO_CHARACTER`, `INVALID_INPUT`.
- **Mail**: `MAIL_NOT_FOUND`, `MAIL_EXPIRED`, `MAIL_ALREADY_CLAIMED`, `MAIL_NO_REWARD`, `NO_CHARACTER`.
- **Mission**: `MISSION_NOT_FOUND`, `MISSION_ALREADY_CLAIMED`, `MISSION_NOT_READY`.
- **Daily login**: `NO_CHARACTER`.
- **Shop**: `ITEM_NOT_FOUND`, `NOT_ENOUGH_FUNDS`, `INVALID_INPUT`.
- **Logs (M6)**: `NO_CHARACTER`, `INVALID_CURSOR`, `INVALID_INPUT`.

## Environment

Xem `.env.example`. Production khởi chạy sẽ assert `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` ≥ 32 ký tự; nếu thiếu sẽ refuse start. Các biến quan trọng:
- `MISSION_RESET_TZ` — timezone reset mission/daily login (default `Asia/Ho_Chi_Minh`).
- `MARKET_FEE_PCT` — phí thị trường (number 0..100).
- `ADMIN_BOOTSTRAP_*` — script `pnpm bootstrap:admin` để tạo admin đầu tiên.
