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
| POST   | `/character/breakthrough` | Yes | Đột phá cảnh giới khi đủ EXP + đỉnh stage. **Phase 14.3.A**: nếu transition kế tiếp có `TribulationDef` (kim_dan→nguyen_anh trở lên), throw `TRIBULATION_REQUIRED` để FE redirect tới `/tribulation`. Low-tier (luyenkhi→truc_co, truc_co→kim_dan) tiếp tục dùng path cũ. |
| GET    | `/character/tribulation/preview` | Yes | **Phase 14.3.A + 14.3.B** — read-only deterministic preview. Trả `{ preview }` với `preview = null` nếu transition không cần kiếp (low-tier hoặc realm cuối) hoặc `TribulationPreview` shape `{ requirement, fromRealmKey, toRealmKey, atPeak, def, successChance: { base, supportBonus, elementAdjustment, raw, final, floorHit, ceilHit }, supports[], supportTotalBonus, rewardHint, penaltyHint, cooldownAt, taoMaUntil }`. **Phase 14.3.B**: `supports[]` populate từ 4 provider (item / buff / equipment / talent) catalog — mỗi entry `{ source, key, bonus, label?, element? }`; `successChance.supportBonus` là tổng additive đã clamp; `elementAdjustment` (rename từ `affinity`) bonus/penalty Ngũ Hành primary vs kiếp; `raw = base + supportBonus + elementAdjustment` pre-clamp; `floorHit/ceilHit` báo FE render warning khi clamp về `[0.05, 0.95]`. KHÔNG roll RNG, KHÔNG ghi `TribulationAttemptLog`, **KHÔNG consume item / KHÔNG decrement buff** (read-only). |
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

## Territory — `TerritoryController` (Phase 14.0.A + 14.0.B + 14.0.C)

Lớp **Sect Territory Influence + Settlement + Region Buff + Decay** — read views cho Influence Leaderboard theo region + Settlement (chiếm vùng) thật + Region buff khi sở hữu vùng + Influence decay per period.
Server-authoritative; FE KHÔNG mutate. Mọi điểm influence chỉ được cộng qua **gameplay hook** (dungeon clear / boss participation / boss top damage) — KHÔNG có endpoint mutate trực tiếp.
Settlement (Phase 14.0.B) + Decay (Phase 14.0.C) chỉ trigger qua admin endpoint hoặc cron weekly job (chưa wire cron trong PR này).

| Method | Path                                          | Auth   | Mô tả |
|--------|-----------------------------------------------|--------|-------|
| GET    | `/territory/regions`                          | Yes    | List 9 region (`MAP_REGIONS` parity) + `totalPoints` + `contributors` + `topSect` snapshot **+ owner** `ownerSectId? / ownerSectName? / ownerPeriodKey? / ownerSettledAt?` (Phase 14.0.B) **+ buff preview** `buffs: TerritoryRegionBuffPreviewLite[]` (Phase 14.0.C — luôn render catalog, FE phân biệt active qua `ownerBuffActive`) + `ownerBuffActive: boolean` (true khi region có owner). Response top-level cũng có `currentPeriodKey` + `previousPeriodKey` (Phase 14.0.C, ISO 8601 week). Region không có influence vẫn xuất hiện với `totalPoints=0`, `topSect=null`. Sort theo `MapRegionDef.sortOrder`. |
| GET    | `/territory/regions/:regionKey/leaderboard`   | Yes    | Top 10 sect trong region, `points` desc, tie-break `sectId` asc. Throw 404 `REGION_INVALID` nếu key không hợp lệ. |
| GET    | `/territory/regions/:regionKey/history`       | Yes    | (Phase 14.0.B) Settlement history per region — DESC theo `settledAt`, default limit 20 (clamp 1..100 qua `?limit=`). Response `{ regionKey, current: TerritoryRegionOwnerLite \| null, snapshots: TerritorySettlementSnapshotView[] }`. Throw 404 `REGION_INVALID`. |
| GET    | `/territory/me`                               | Yes    | Personal view: per-region rank/points của sect user + `personalPoints` cá nhân **+ active buffs** `activeBuffs: TerritoryRegionBuffPreviewLite[]` (Phase 14.0.C — buff đang được áp dụng vì sect của user đang sở hữu region tương ứng). Character không có sect → `hasSect=false`, `activeBuffs=[]`, `regions[]` đầy đủ với `sectPoints=0`/`sectRank=null`. Throw 404 `NO_CHARACTER` nếu user chưa onboard. |
| POST   | `/admin/territory/settle`                     | ADMIN  | (Phase 14.0.B) Settle **all 9 regions** cho `?periodKey=…`. `periodKey` validate qua `isTerritoryPeriodKey` (ISO week `YYYY-Www` hoặc `manual_*`). Nếu không truyền → fallback `previousTerritoryPeriodKey()` (tuần trước). Response `TerritorySettlementRunResult { periodKey, settledAt, snapshots[], skippedRegions[] }`. Idempotent qua UNIQUE `(regionKey, periodKey)` — gọi lại cùng `periodKey` trả cùng snapshot id. Non-admin → 403 `ADMIN_ONLY`. Invalid `periodKey` → 400 `PERIOD_INVALID`. |
| POST   | `/admin/territory/regions/:regionKey/settle`  | ADMIN  | (Phase 14.0.B) Manual settle 1 region (debug/override). Body/query `periodKey` cùng convention như endpoint trên. Response `{ snapshot: TerritorySettlementSnapshotView \| null, skipped: boolean, regionKey, periodKey }`. 404 `REGION_INVALID`, 400 `PERIOD_INVALID`, 403 `ADMIN_ONLY`. |
| POST   | `/admin/territory/decay`                      | ADMIN  | (Phase 14.0.C) Trigger influence decay cho `periodKey` (default `previousTerritoryPeriodKey()` nếu không truyền). Body `{ periodKey?: string, decayBps?: number }`. `decayBps` mặc định `TERRITORY_DECAY_DEFAULT_BPS=2500` (25%), cap `TERRITORY_DECAY_MAX_BPS=5000` (50%), range `1..5000`. Idempotent qua `SectTerritoryDecayLog` UNIQUE `(periodKey)` — gọi cùng `periodKey` 2 lần → lần 2 trả `{ skipped: true }`. Race-safe (P2002 retry). Response `TerritoryDecayResult { periodKey, decayBps, skipped, rowsAffected, pointsBefore, pointsAfter, delta, triggeredAt }`. Errors: 403 `ADMIN_ONLY`, 400 `PERIOD_INVALID`, 400 `DECAY_BPS_INVALID`. |
| GET    | `/territory/war/current`                      | No     | (Phase 14.0.D) War state cho period **hiện tại**. Response `TerritoryWarStateView { periodKey, previousPeriodKey, startsAt, endsAt, nextResetAt, serverNow, timeRemainingMs, regions: TerritoryRegionWarSummaryView[] }`. `regions[]` luôn 9 phần tử (sort theo `sortOrder`), mỗi entry có `topStandings` top 3 sect (sort `points` DESC, tie-break `sectId.localeCompare()` ASC), `contested` (≥ 2 sect tranh), `currentOwnerSectId/Name/PeriodKey` (kỳ trước). `timeRemainingMs` server-authoritative (FE countdown source of truth). Public — không cần auth. |
| GET    | `/territory/war/regions/:regionKey`           | No     | (Phase 14.0.D) Region detail cho war panel. Response `TerritoryRegionWarStatusView` mở rộng `Summary` với `standings` top 10 (thay vì top 3) + `recentSettlements: TerritorySettlementSnapshotView[]` 5 settlement gần nhất + owner snapshot. Throw 404 `REGION_INVALID` nếu key không hợp lệ. |
| GET    | `/territory/war/history?limit=`               | No     | (Phase 14.0.D) War history grouped by `periodKey`. Response `TerritoryWarHistoryView { entries: TerritoryWarHistoryEntry[] }`. `entries[]` order DESC theo `settledAt` gần nhất; mỗi entry có `periodKey`, `startsAt/endsAt` (null nếu period là `manual_*`), `settledAt` (max settledAt across snapshots), `snapshots[]` 9 region (region nào skip period đó không có entry). `limit` default 8, clamp `1..32`. |
| POST   | `/admin/territory/war/settle-current`         | ADMIN  | (Phase 14.0.D) Settle period **hiện tại** (cắt sớm — admin/test trigger). Khác `/admin/territory/settle` (mặc định settle previous period). Idempotent qua UNIQUE `(regionKey, periodKey)` race-safe; gọi 2 lần → cùng snapshot id. Response `TerritoryWarSettleCurrentResult { periodKey, settledAt, snapshots[], skippedRegions[], ownersAfter: TerritoryRegionOwnerSnapshotView[] }` — `ownersAfter` cho FE refresh không cần round-trip. **No-influence rule**: region không có sect đủ điểm → KHÔNG ghi snapshot, KHÔNG đổi owner state → liệt kê trong `skippedRegions`. Audit `settledBy = req.userId`. Errors: 401 `UNAUTHENTICATED`, 403 `ADMIN_ONLY`, 400 `PERIOD_INVALID` (defensive). |

**Buff catalog (Phase 14.0.C)** — `packages/shared/src/territory-buffs.ts` `TERRITORY_REGION_BUFFS`:

| Region | Buff key | Type | Value | AppliesTo | Element |
|---|---|---|---|---|---|
| `son_coc` | `territory_son_coc_exp` | `EXP_BONUS` | 0.05 | `DUNGEON_REWARD` | — |
| `hac_lam` | `territory_hac_lam_drop` | `LINH_THACH_BONUS` | 0.05 | `DUNGEON_REWARD` | — |
| `moc_huyen_lam` | `territory_moc_huyen_lam_dmg` | `ELEMENTAL_DAMAGE` | 0.05 | `COMBAT`,`ELEMENTAL` | `moc` |
| `kim_son_mach` | `territory_kim_son_mach_dmg` | `ELEMENTAL_DAMAGE` | 0.05 | `COMBAT`,`ELEMENTAL` | `kim` |
| `hoang_tho_huyet` | `territory_hoang_tho_huyet_def` | `DEFENSE_BONUS` | 0.05 | `COMBAT` | — |

Buff CHỈ áp dụng nếu character thuộc Tông sở hữu region (`character.sectId === ownerSectId`). Phase 14.0.C wire `DUNGEON_REWARD` (EXP_BONUS / LINH_THACH_BONUS) trong `DungeonRunService.claimRun()` fail-soft owner-only — KHÔNG double-apply khi retry. `COMBAT/ELEMENTAL/DEFENSE` catalog ship sẵn, defer wire vào combat pipeline phase sau.

**Influence sources (Phase 14.0.A)** — chỉ ghi điểm qua hook chạy trong tx của gameplay flow:

| Source key             | Points | Daily cap | Weekly cap | Trigger |
|------------------------|--------|-----------|------------|---------|
| `dungeon_clear`        | 8      | 60        | 420        | `DungeonRunService.claimRun()` khi dungeon template có `regionKey`. SourceId = `runId`. |
| `boss_participation`   | 12     | —         | 96         | `BossService.distributeRewards()` cho mọi participant rank ≥ 1 với boss có `regionKey ∈ MAP_REGIONS`. SourceId = `${bossId}:${characterId}`. |
| `boss_top_damage`      | 20     | —         | 80         | Cộng thêm cho rank-1 participant khi boss có `regionKey ∈ MAP_REGIONS`. SourceId = `${bossId}:${characterId}` (sourceKey khác → composite UNIQUE riêng row). |

Idempotency qua composite UNIQUE `(regionKey, characterId, sourceKey, sourceType, sourceId)` ở table `SectTerritoryInfluence` — caller retry an toàn, KHÔNG ghi double điểm.

Cap enforcement compute trước insert; reject = no-op (return `null` từ `addInfluenceTx`). Hook chạy trong `try/catch` swallow → gameplay flow KHÔNG fail nếu territory ghi điểm fail.

Character không có sect → `addInfluenceTx` skip silent (không ghi row, không throw).

## Boss — `BossController`

| Method | Path                | Auth  | Mô tả |
|--------|---------------------|-------|-------|
| GET    | `/boss/current`     | Yes   | Boss đang active + top 10 damage. |
| POST   | `/boss/:id/attack`  | Yes   | Đánh boss; khi HP ≤ 0 → distribute reward theo rank (top 1 = 50%). Phase 13.0 §C: reward hooks unlock title `achievement_first_boss` (mọi participant), apply buff `event_double_drop` (top-1, 1h), unlock title `event_huyet_nguyet_2026` nếu spawn từ Huyết Nguyệt slot. |
| POST   | `/boss/admin/spawn` | ADMIN | Spawn boss thủ công. Body `{ bossKey?: string, regionKey?: BossRegionKey, level?: 1\|2\|3, reason?: string≤200 }`. Audit kép: legacy `BOSS_SPAWN` (backwards-compatible) **+** Phase 13.1.C `ADMIN_FORCE_BOSS_SCHEDULE` cùng meta `{ bossKey, regionKey, level, bossId, scheduledEventKey?: string\|null, reason: string\|null }`. `reason` trim; whitespace-only → `null`. Response `{ id, bossKey, name, level, regionKey, currentHp, maxHp }`. |

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

## Sect Season — `SectSeasonController` (prefix `/sect-season`, Phase 13.2.A)

> Phase 13.2.A — mùa giải dài hạn cho Tông Môn. Catalog ở [`packages/shared/src/sect-season.ts`](../packages/shared/src/sect-season.ts). 13 mùa × 4 tuần ISO (≈ 1 năm) phủ `2026-03-30 → 2027-03-28 ICT`, mỗi mùa start Monday 00:00 ICT (`MISSION_RESET_TZ` = `Asia/Ho_Chi_Minh`). 5 milestone cá nhân monotonic increasing (bronze 100pt → silver 500pt → gold 2000pt → platinum 5000pt → diamond 7500pt). **Read-only Phase 13.2.A** — KHÔNG migration, KHÔNG INSERT/UPDATE; service derive điểm season qua `groupBy SectWarContribution where weekKey IN sectSeasonWeekKeys(season)` aggregation. **KHÔNG có claim endpoint** — Phase 13.2.A chỉ display preview milestone; claim sẽ ở Phase 13.2.B+.

| Method | Path                                  | Auth | Mô tả |
|--------|---------------------------------------|------|-------|
| GET    | `/sect-season/current`                | Yes  | Snapshot full state mùa hiện tại: `{ seasonKey, season{key,startsAtIso,endsAtIso,durationWeeks,timezone,labelI18nKey,descriptionI18nKey}, milestones[], leaderboard[], me }`. `season` server snapshot từ catalog (FE không cần import shared). Khi out-of-season (out of all 13 windows): `seasonKey=null`, `season=null`, `milestones=[]`, `leaderboard=[]`, `me=null`. |
| GET    | `/sect-season/leaderboard?seasonKey=` | No   | Top 10 sect tổng hợp theo season: `{ seasonKey, rows: [{ rank, sectId, sectName, points, contributors, weeksContributed }] }`. `seasonKey` query optional (default `currentSectSeason(now).key`). Aggregation: `prisma.sectWarContribution.groupBy by characterId/sectId where weekKey IN sectSeasonWeekKeys(season)` → sum points → top 10 tie-break `(points desc, sectId asc)`. `weeksContributed` = distinct weekKey count cho sect đó. |
| GET    | `/sect-season/me?seasonKey=`          | Yes  | Personal status mùa: `{ seasonKey, hasSect, sectId, sectName, personalPoints, weeksContributed, achievedMilestoneKeys[], nextMilestoneKey }` hoặc `null` khi out-of-season. `personalPoints` = sum `SectWarContribution.points` của character qua `weekKey IN sectSeasonWeekKeys(season)`. `achievedMilestoneKeys[]` = derive từ `sectSeasonAchievedMilestones(personalPoints)`; `nextMilestoneKey` = `sectSeasonNextMilestone(personalPoints)?.key ?? null`. `hasSect=false` khi `Character.sectId == null` — vẫn trả `personalPoints` để player thấy lịch sử trước khi join sect. |

### Phase 13.2.C — Sect Season History + Hall of Fame

> Phase 13.2.C — lưu kết quả mùa giải đã chốt + bảng vinh danh tích lũy. Migration `20260605000000_phase_13_2_c_sect_season_history` thêm 3 bảng mới: `SectSeasonSnapshot { seasonKey unique, finalizedAt, totalSects, totalContributors, totalPoints, championSectId?, championSectName?, championPoints?, mvpCharacterId?, mvpCharacterName?, mvpSectId?, mvpSectName?, mvpPoints? }` (denormalized champion/MVP để list view không cần JOIN), `SectSeasonSectRank { seasonId FK, rank, sectId, sectName, points, contributors, weeksContributed }` (composite UNIQUE `(seasonId, rank)` + `(seasonId, sectId)`), `SectSeasonTopMember { seasonId FK, rank, characterId, characterName, sectId?, sectName?, points }` (composite UNIQUE `(seasonId, rank)` + `(seasonId, characterId)`). Snapshot capture tên Sect/Character tại thời điểm finalize → audit-correct, không follow rename. **`SECT_SEASON_TOP_MEMBERS = 10`** constant — top 10 individual contributors. Snapshot creation **idempotent**: `snapshotSeason(seasonKey)` check `findUnique({ seasonKey })` trước → return existing nếu đã có (no double snapshot). Phase 13.2.C **chưa có endpoint trigger snapshot từ player** — tạo qua test/dev script hoặc Phase 13.2.B+ settlement runtime.

| Method | Path                                  | Auth | Mô tả |
|--------|---------------------------------------|------|-------|
| GET    | `/sect-season/history`                | No   | List tất cả mùa đã chốt (newest first by `finalizedAt desc`). Response `{ seasons: [{ seasonKey, finalizedAt, totalSects, totalContributors, totalPoints, champion: { rank:1, sectId, sectName, points, contributors:0, weeksContributed:0 }\|null, mvp: { rank:1, characterId, characterName, sectId\|null, sectName\|null, points }\|null }] }`. `champion`/`mvp` = denormalized header từ snapshot, dùng cho list view nhanh không JOIN. Empty array khi chưa có mùa nào finalized. |
| GET    | `/sect-season/history/:seasonKey`     | No   | Detail snapshot 1 mùa. Response `{ seasonKey, finalizedAt, totalSects, totalContributors, totalPoints, sects: SectSeasonSectRank[] (rank asc), topMembers: SectSeasonTopMember[] (rank asc, top 10) }`. 404 `SNAPSHOT_NOT_FOUND` khi `seasonKey` chưa được snapshot; 404 `SEASON_NOT_FOUND` khi `seasonKey` ∉ catalog. |
| GET    | `/sect-season/hall-of-fame`           | No   | Bảng vinh danh tích lũy qua tất cả mùa đã chốt. Response `{ totalSeasonsFinalized, sects: [{ sectId, sectName, championships, podiums, appearances, bestRank, totalPoints, latestSeasonKey }], members: [{ characterId, characterName, mvps, podiums, appearances, bestRank, totalPoints, latestSeasonKey, latestSectName\|null }] }`. Sect ordering: `championships desc → podiums desc → totalPoints desc → sectId asc`. Member ordering: `mvps desc → podiums desc → totalPoints desc → characterId asc`. `bestRank` = min rank đã đạt qua các mùa. `latestSeasonKey` = `finalizedAt desc` mùa tham gia gần nhất. |

**Sect Season History error codes**:

- `SNAPSHOT_NOT_FOUND` — `seasonKey` chưa được finalize/snapshot.
- `SEASON_NOT_FOUND` — `seasonKey` không có trong catalog.

**Idempotency** snapshot: `snapshotSeason(seasonKey)` query `findUnique({ seasonKey })` trước. Nếu đã có row → return existing snapshot (no-op). Nếu chưa → tạo trong 1 transaction: derive sects + topMembers từ `SectWarContribution` qua `sectSeasonWeekKeys(season)` aggregation (giống logic leaderboard live), rồi `prisma.sectSeasonSnapshot.create({ data: { ..., sects: { create: [...] }, topMembers: { create: [...] } } })` nested write atomic. Composite UNIQUE `seasonKey` enforce no-double-snapshot ở DB level.

**Sect Season error codes**:
- `NO_CHARACTER` — chưa có nhân vật (chỉ áp dụng cho `/current` + `/me`).
- `SEASON_NOT_FOUND` — `seasonKey` query không có trong catalog.

**Idempotency** read-only: KHÔNG có write path. Aggregation đọc trực tiếp từ `SectWarContribution` (Phase 13.1.A composite UNIQUE đã chống double-add gameplay hooks). `currentSectSeason(now)` resolve theo `MISSION_RESET_TZ` Monday 00:00 ICT — đồng nhất với Sect War tuần / mission DAILY/WEEKLY / daily-login streak / Sect Season window.

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

## Story Dungeon — `StoryDungeonController` (prefix `/story/dungeons`, Phase 12.8.A + 12.8.B)

> **Phase 12.8.A** (PR #465) — read-only catalog API cho UI map view (GET endpoints).
> **Phase 12.8.B** (this PR) — runtime mutation API: start/advance/clear/claim qua Prisma `StoryDungeonRun` + auto-advance quest step + reward grant atomic qua `CurrencyService.applyTx` reason `STORY_DUNGEON_REWARD` + `InventoryService.grantTx` reason `STORY_DUNGEON_REWARD`.

| Method | Path                                  | Auth | Mô tả |
|--------|---------------------------------------|------|-------|
| GET    | `/story/dungeons`                     | Yes  | List catalog `enabled=true` + status compute. Service flow: (1) load `Character` (`realmKey`), (2) `realmByKey(realmKey).order` → realmOrder, (3) load `QuestProgress` rows → `Map<questKey, status>` + `Map<questKey, stepProgress>`, (4) for each `STORY_DUNGEONS[].enabled=true`: `computeStoryDungeonStatus(template, ctx)` → `'locked'/'available'/'cleared'`, (5) hydrate `monsterByKey` + optional `bossByKey` cho preview. **Phase 12.8.C** — bundle `activeRun: StoryDungeonRunView \| null` cùng response (run đang ACTIVE / CLEARED chưa claim, ưu tiên `startedAt` mới nhất; `null` nếu không có). Response `{ ok: true, data: { dungeons: StoryDungeonView[]; activeRun: StoryDungeonRunView \| null } }`. |
| GET    | `/story/dungeons/:key`                | Yes  | Single template view + status. `:key` regex `^story_dgn_[a-z0-9_]+$` (zod). 404 `DUNGEON_NOT_FOUND` nếu key không tồn tại HOẶC `enabled=false`. |
| POST   | `/story/dungeons/:key/start`          | Yes  | Phase 12.8.B. Start một `StoryDungeonRun` cho character hiện tại. Idempotent: nếu đã có ACTIVE run cùng `(characterId, templateKey)` → trả lại run đó (không tạo row mới). Reject `DUNGEON_LOCKED` (404) khi `computeStoryDungeonStatus !== 'available'` (quest chưa accepted/step chưa tới HOẶC realm chưa đủ). Reject `DUNGEON_ALREADY_CLEARED` (409) cho `template.oneTime=true` khi đã có row `CLAIMED`. Response `{ ok: true, data: { run: StoryDungeonRunView } }`. |
| POST   | `/story/dungeons/:runId/advance`      | Yes  | Phase 12.8.B. Body `{ monsterKey?: string }` (optional ghi log kill). `:runId` regex `^c[a-z0-9]{20,}$` (cuid). Ownership check: 404 `RUN_NOT_FOUND` nếu `run.characterId !== currentCharacterId`. Reject `RUN_NOT_ACTIVE` (409) khi status ≠ ACTIVE. Reject `RUN_STEP_INVALID` (409) khi `currentStep+1 > monsters.length`. Increment `currentStep` + push `monsterKey` vào `killedMonsters[]` Json. |
| POST   | `/story/dungeons/:runId/clear`        | Yes  | Phase 12.8.B. Verify `currentStep === monsters.length`. CAS guard `updateMany({where: {id, status: ACTIVE}, data: {status: CLEARED, clearedAt: now}})` — count=0 → idempotent return existing CLEARED state. Clear hook fires `applyQuestStepAdvance(characterId, template.requiredQuestKey, template.requiredQuestStep)` qua `QuestService.advanceStep` chỉ khi `QuestProgress.status === ACCEPTED` (no-op nếu COMPLETED/CLAIMED — fail-soft try-catch không throw 500). Errors: 404 `RUN_NOT_FOUND`, 409 `RUN_NOT_CLEARABLE` (status ≠ ACTIVE), 409 `RUN_STEP_INCOMPLETE` (chưa đi hết monster). |
| POST   | `/story/dungeons/:runId/claim`        | Yes  | Phase 12.8.B. Verify status=CLEARED. CAS guard `updateMany({where: {id, status: CLEARED}, data: {status: CLAIMED, claimedAt: now}})` — count=0 → 409 `RUN_NOT_CLAIMABLE` (đã CLAIMED HOẶC chưa CLEARED). Concurrent claim 2 request → exactly 1 winner. Reward grant SAU CAS: `CurrencyService.applyTx` reason `STORY_DUNGEON_REWARD`, refType `StoryDungeonRun`, refId `runId` cho `linhThach`/`tienNgoc`/`exp` + `InventoryService.grantTx` reason `STORY_DUNGEON_REWARD` cho items theo `template.rewardHint`. Composite UNIQUE `(characterId, refType, refId)` chống double-grant. Response `{ ok: true, data: { run, granted: { linhThach, tienNgoc, exp, items[] } } }`. |

**`StoryDungeonView` shape**:
```ts
{
  key: string;                                      // 'story_dgn_phamnhan_back_mountain'
  titleI18nKey: string;                             // 'story_dungeon.<key>.title'
  descriptionI18nKey: string;
  titleVi: string;                                  // hard-coded VN fallback
  descriptionVi: string;
  requiredQuestKey: string;                         // 'phamnhan_realm_01'
  requiredQuestStep: string | null;                 // 'step_01' | null = chỉ cần quest accepted
  regionKey: string;                                // RegionKey ∈ map-regions.ts
  recommendedRealm: string;                         // RealmDef.key (UI hint)
  minRealmKey: string | null;                       // gate; player.realm.order < min → locked
  npcKey: string | null;                            // NpcDef.key
  entryDialogueKey: string | null;                  // STORY_DIALOGUES[].id; Phase 12.8.B sẽ wire trigger
  clearDialogueKey: string | null;
  monsters: { key, name, element, level }[];        // hydrated qua monsterByKey
  boss: { key, name, recommendedRealm, regionKey } | null;
  rewardHint: { linhThach?, tienNgoc?, exp?, items?: { itemKey, qty }[] } | null;
  oneTime: boolean;
  status: 'locked' | 'available' | 'cleared';       // server-authoritative
}
```

**Status compute logic** (`computeStoryDungeonStatus`):
- `template.minRealmKey && realmOrder < min.order` → `locked`.
- `questState[requiredQuestKey] === 'CLAIMED'` → `cleared`.
- `questState[requiredQuestKey]` ∉ `{ACCEPTED, COMPLETED}` → `locked`.
- Có `requiredQuestStep` + state `ACCEPTED` + `stepProgress[step] < step.count` → `locked`.
- `state === 'COMPLETED'` (mọi step coi như đạt) → `available`.
- Else → `available`.

**Catalog seed** (Phase 12.8.A): 4 entries gắn 4 main quest đầu tiên — Phàm Nhân Hậu Sơn Linh Tuyền Động (`phamnhan_realm_01:step_01` — `son_coc`, no minRealm), Luyện Khí Hắc Lâm Tâm Thử (`luyenkhi_main_01:step_02` — `hac_lam`, minRealm=`luyenkhi`), Trúc Cơ Mộc Huyền Lâm Ký Ức Cổ Thụ (`truc_co_main_01:step_03` — `moc_huyen_lam`, minRealm=`truc_co`), Kim Đan Kim Sơn Thiên Lò Lệnh (`kim_dan_main_01:step_02` — `kim_son_mach`, minRealm=`kim_dan`).

**Read-only invariants**: KHÔNG Prisma migration, KHÔNG mutation, KHÔNG `RewardLedger`. Service chỉ đọc `Character.realmKey` + `QuestProgress` qua `PrismaService.findUnique` + `findMany` — KHÔNG re-enter `QuestService` / `DungeonRunService` / `CurrencyService`. Phase 12.8.B sẽ thêm: (1) `StoryDungeonRun` Prisma model với composite UNIQUE `(characterId, templateKey)` cho oneTime guard, (2) 4 endpoint mutation (`POST /story/dungeons/:key/start`, `POST /story/dungeon-runs/:runId/next`, `POST /story/dungeon-runs/:runId/claim`, `POST /story/dungeon-runs/:runId/abandon`), (3) reward grant atomic qua `CurrencyService.applyTx` reason `STORY_DUNGEON_REWARD` + `InventoryService.grantTx` (composite UNIQUE `(characterId, refType, refId)` chống double-grant), (4) auto-advance quest step khi clear (`QuestService.track('kill','monster', ...)` cho mỗi monster trong template hoặc explicit `advance_quest_step` cho narrative step), (5) entry/clear dialogue trigger.

## Story Dialogue — `StoryDialogueController` (prefix `/story/dialogue`, Phase 12 Story PR-7 + Phase 12.9 Branch Advanced)

> Phase 12 Story Dialogue Foundation — branching NPC dialogue catalog cho main quest. Catalog ở [`packages/shared/src/story-dialogues.ts`](../packages/shared/src/story-dialogues.ts) (`STORY_DIALOGUES`, helpers `findStoryDialogueNode`, `getStoryDialogueRoot`). Server-authoritative: FE chỉ render `StoryDialogueNodeView` mà server đã filter theo quest/flag/seen/choice.
>
> **Phase 12.9 Story Dialogue Branch Advanced** nâng cấp foundation: thêm condition `choice_made { nodeId, choiceKey }` (NPC nhớ lựa chọn cũ — server pick followup node theo path đã đi) + effect `clear_flag { flagKey }` (xoá flag, no-op nếu chưa set; cho plot reversal/apology arc) + persistent `Character.storyDialogueChoices` Json map (nodeId → choiceKey, last-write-wins per node). Hàn Dạ multi-step branching tree minh hoạ: `first_meet` rival/neutral → `followup_rival` (gate `choice_made(first_meet, rival)`) | `followup_neutral` → `resolution_apology` (gate `seen(followup_rival)` + `flag_equals(rival)`) choice `apologize` carries `clear_flag(han_da_relation)` revert. Specificity scoring: `choice_made` = 5 (same band quest_status — server pick followup trước fallback intro); `flag_equals` = 4; `seen`/`not_seen` = 3; `realm_min` = 2; always = 1.

| Method | Path                                  | Auth | Mô tả |
|--------|---------------------------------------|------|-------|
| GET    | `/story/dialogue/:npcKey`             | Yes  | Trả node hội thoại story hiện tại cho NPC. Service resolve qua: (1) load `Character` (`realmKey`, `storyFlags`, `storyDialogueSeen`, `storyDialogueChoices`), (2) load `QuestProgress` rows của character, (3) build `CharCtx { realmKey, realmOrder, flags, seen, choices, questStatus }`, (4) filter nodes của NPC qua `evaluateAllConditions(ctx)` rồi pick theo `storyDialogueNodeSpecificity()` cao nhất. Response `StoryDialogueNodeView { nodeId, npcKey, questKey?, text (i18n key hoặc raw), textEn?, seen, previousChoiceKey, choices: StoryDialogueChoiceView[] }`. Mỗi choice gồm `{ key, label, labelEn?, available, unavailableReason, nextNodeId, alreadyApplied, previouslyChosen }`. **Phase 12.9 fields**: `previousChoiceKey: string \| null` (last-pick at this node, từ `storyDialogueChoices[nodeId]`); `previouslyChosen: boolean` per choice (`storyDialogueChoices[nodeId] === key` — KHÔNG disable button, chỉ hint cho FE render badge "đã chọn lần trước"). `unavailableReason` shapes: `'quest_status:foo=accepted'` \| `'flag_equals:bar=baz'` \| `'flag_set:k'` \| `'flag_unset:k'` \| `'seen:nodeId'` \| `'not_seen:nodeId'` \| `'realm_min:order=N'` \| `'choice_made:nodeId=key'` \| `'already_applied'` \| `null`. Choice không pass condition vẫn render với `available=false` để FE explain lý do. |
| POST   | `/story/dialogue/:npcKey/choice`      | Yes  | Body `{ nodeId: string, choiceKey: string }`. Atomic transaction: assert node hợp lệ + choice condition pass + node condition pass + chưa apply (nếu effect grant) + quest step không skip → apply effects theo thứ tự catalog: `set_flag` (set `Character.storyFlags[key]=value`), `clear_flag` (delete `Character.storyFlags[key]`, no-op nếu unset), `advance_quest_step` (chỉ chạy nếu quest ACCEPTED + step hợp lệ + chưa COMPLETED → gọi `QuestService.advanceStep` rollback nếu skip), `give_reward` (gọi `CurrencyService.applyTx` với reason `STORY_DIALOGUE_REWARD`, refType `StoryDialogueNode`, refId `nodeId` — idempotent qua composite UNIQUE chống double-grant; cap linhThach ≤ 100 / tienNgoc ≤ 5 / exp ≤ 200), `mark_seen` implicit (push `nodeId` vào `Character.storyDialogueSeen`). **Phase 12.9 persistence**: ghi `Character.storyDialogueChoices[nodeId] = choiceKey` last-write-wins per node — phục vụ condition `choice_made` cho node tiếp theo. Trả `{ effectsApplied: StoryDialogueEffect[], granted: { linhThach, tienNgoc, exp }, flags: Record<string,string\|number\|boolean>, seen: string[], choices: Readonly<Record<string,string>>, nextNode: StoryDialogueNodeView \| null }`. **Phase 12.9 response field**: `choices` snapshot post-apply để FE store sync (mirror `storyDialogueChoices` cho condition `choice_made` render đúng ở node tiếp theo). `nextNode` resolve qua re-pick highest-specificity node sau khi apply effects (KHÔNG return cùng node để tránh loop nếu đã seen + condition vẫn pass). |

**Choice / node condition kinds** (Phase 12 + 12.9):
- `quest_status` — `{ kind: 'quest_status', questKey, status: 'ACCEPTED'\|'COMPLETED'\|'CLAIMED' }`. Match với `QuestProgress.status` của character.
- `flag_equals` — `{ kind: 'flag_equals', flagKey, value }`. Match `Character.storyFlags[flagKey] === value`.
- `flag_set` — `{ kind: 'flag_set', flagKey }`. Match `flagKey` tồn tại (any value).
- `flag_unset` — `{ kind: 'flag_unset', flagKey }`. Match `flagKey` không tồn tại.
- `seen` — `{ kind: 'seen', nodeId }`. Match `Character.storyDialogueSeen.includes(nodeId)`.
- `not_seen` — `{ kind: 'not_seen', nodeId }`. Match `!Character.storyDialogueSeen.includes(nodeId)`.
- `realm_min` — `{ kind: 'realm_min', minOrder }`. Match `realmOrder(character.realmKey) >= minOrder`.
- **Phase 12.9** `choice_made` — `{ kind: 'choice_made', nodeId, choiceKey }`. Match `Character.storyDialogueChoices[nodeId] === choiceKey`. Specificity 5 (same band quest_status — server pick followup node trước fallback intro). Validator two-pass verify `nodeId` + `choiceKey` ref tồn tại trong catalog.

**Choice effect kinds** (Phase 12 + 12.9):
- `mark_seen` — `{ kind: 'mark_seen' }`. Implicit: server luôn add `nodeId` vào `Character.storyDialogueSeen` khi apply choice (idempotent set semantics).
- `set_flag` — `{ kind: 'set_flag', flagKey, value }`. Set `Character.storyFlags[flagKey] = value` (overwrite).
- **Phase 12.9** `clear_flag` — `{ kind: 'clear_flag', flagKey }`. Delete `Character.storyFlags[flagKey]` (no-op nếu chưa set; cho plot reversal/apology arc, không touch flag khác).
- `advance_quest_step` — `{ kind: 'advance_quest_step', questKey, stepKey, count? }`. Gọi `QuestService.advanceStep` chỉ khi quest ACCEPTED + step hợp lệ + chưa COMPLETED. Reject `QUEST_STEP_LOCKED` nếu skip step (rollback toàn transaction).
- `give_reward` — `{ kind: 'give_reward', linhThach?, tienNgoc?, exp? }`. Gọi `CurrencyService.applyTx` reason `STORY_DIALOGUE_REWARD`, refType `StoryDialogueNode`, refId `nodeId`. Cap: linhThach ≤ 100, tienNgoc ≤ 5, exp ≤ 200. Idempotent qua composite UNIQUE — duplicate apply throws `ALREADY_APPLIED`.

**Story Dialogue error codes**:
- `NPC_NOT_FOUND` — `npcKey` không có trong shared catalog `NPCS`.
- `STORY_DIALOGUE_NOT_AVAILABLE` — NPC không có entry node nào pass condition cho character này (chưa unlock dialog).
- `NODE_NOT_FOUND` — `nodeId` body không tồn tại trong catalog dưới `npcKey` đó.
- `CHOICE_NOT_FOUND` — `choiceKey` body không tồn tại trên node.
- `CHOICE_LOCKED` — choice tồn tại nhưng `available=false` server-side (condition fail giữa GET và POST hoặc client bypass).
- `CHOICE_ALREADY_APPLIED` — choice `oncePerCharacter` đã apply trước đó.
- `QUEST_STEP_LOCKED` — `advance_quest_step` effect chỉ hợp lệ nếu quest ACCEPTED + step matches; nếu sai → reject TOÀN BỘ effects (không partial apply).
- `INVALID_INPUT` — body sai shape (zod).
- `NO_CHARACTER` — chưa có nhân vật.

**Idempotency / atomicity**: toàn bộ effects apply trong cùng `prisma.$transaction`. `give_reward` qua `CurrencyService.applyTx(tx, charId, { linhThach?, tienNgoc?, exp? }, { reason: 'STORY_DIALOGUE_CHOICE', refType: 'StoryDialogueChoice', refId: '${nodeId}:${choiceKey}' })` — composite UNIQUE `(characterId, refType, refId)` chống double-grant nếu retry. `mark_seen` dedupe array client-side trong tx. `set_flag` overwrite key. KHÔNG WebSocket push (FE refetch state qua next `GET /character/state` trong handler).

## Admin LiveOps Controls — `AdminLiveOpsController` (Phase 13.1.B + Phase 13.1.C + Phase 13.1.D)

> Phase 13.1.B — admin override LiveOps event toggles + sect-war status/recalculate. Phase 13.1.C — sect-war read-after-audit snapshot + force-spawn boss (xem `POST /boss/admin/spawn` ở §Boss). Phase 13.1.D — schedule preview (read-only) + dry-run (event/boss giả lập, KHÔNG mutate). Mọi endpoint role `ADMIN`/`MOD` (`AdminGuard`); endpoint mutation đánh dấu `ADMIN-only` qua `@RequireAdmin()`.

| Method | Path                              | Auth  | Mô tả |
|--------|-----------------------------------|-------|-------|
| GET    | `/admin/liveops`                  | ADMIN/MOD | Status snapshot. Response `{ nowIso, timezone, eventsTotal, eventsActive, eventsToday, events: AdminLiveOpsEventStatus[], sectWar: AdminSectWarSummary }`. Mỗi `AdminLiveOpsEventStatus` gồm `{ key, type, titleI18nKey, scheduledEnabled (catalog default), overrideEnabled? (LiveOpsEventOverride.enabled nếu có), effectiveEnabled, lastOverrideAt? (ISO), lastOverrideBy? (User.email) }`. `AdminSectWarSummary` = `{ weekKey, season{startsAtIso,endsAtIso,timezone}, sectsRanked, contributionsThisWeek }`. |
| POST   | `/admin/liveops/event/toggle`     | ADMIN | `{ eventKey: string, enabled: boolean }`. Upsert `LiveOpsEventOverride(eventKey)` → `{ enabled, updatedAt, updatedBy: actorUserId }`. Audit log `ADMIN_LIVEOPS_OVERRIDE` (`{ actor, eventKey, enabled, prev: oldEnabled }`). Trả `{ eventKey, enabled, prev, overrideAt }`. |
| GET    | `/admin/sect-war/status`          | ADMIN/MOD | Read-only sect-war diagnostic. Response `{ weekKey, season{startsAtIso,endsAtIso,timezone}, sectsRanked, contributionsThisWeek, leaderboard[] (top N), claimsThisWeek }`. KHÔNG mutation. |
| POST   | `/admin/sect-war/recalculate`     | ADMIN | No-op điểm contribution (read-only audit response). Trả `{ weekKey, recalculatedAt: ISO, contributionsScanned, leaderboardSize, message: 'recalc_no_op' }`. KHÔNG sửa contribution rows hoặc claim rows hiện có. (Future: nếu thêm logic recompute, vẫn phải atomic + audit). |
| POST   | `/admin/sect-war/snapshot`        | ADMIN | **Phase 13.1.C** — read-after-audit snapshot. Body `{ weekKey?: 'YYYY-Www', reason?: string≤200 }` (weekKey thiếu → fallback computed week hiện tại). Service gọi `getSectWarStatus(weekKey)` rồi ghi 1 audit `ADMIN_SECT_WAR_STATUS` cùng `meta { targetType: 'SectWarWeek', targetId: weekKey, summary: { totalSects, totalContributors, totalContributions, topSectIds: string[≤3] }, reason: string\|null }`. `reason` trim; whitespace-only → `null`. **KHÔNG mutate** contribution rows hoặc claim rows. Response identical với `GET /admin/sect-war/status` cho `weekKey` đó. |
| GET    | `/admin/liveops/schedule-preview` | ADMIN/MOD | **Phase 13.1.D** — read-only snapshot. Response `{ tz, nowIso, activeEvents[], upcomingEvents[], bossScheduleToday[], bossScheduleWeek[], sectWar: { season, status }, overrides[] }`. `activeEvents` overlay `LiveOpsEventOverride` (chỉ event có `effectiveEnabled=true` tại `now`). `upcomingEvents` = top N slot (≤5 / event catalog) trong 7 ngày kế, kèm `catalogEnabled`/`effectiveEnabled`/`slotStartIso`/`slotEndIso`. `bossScheduleToday`/`bossScheduleWeek` (7 ngày) group theo `localDate`, status `upcoming`/`active`/`completed`. `sectWar.season` = `currentSectWarSeason(now)`, `sectWar.status` = `getSectWarStatus(weekKey)`. `overrides[]` = full `LiveOpsEventOverride` rows order by `updatedAt desc`. **KHÔNG mutate**, **KHÔNG audit**. |
| POST   | `/admin/liveops/dry-run`          | ADMIN | **Phase 13.1.D** — giả lập event/boss execution KHÔNG mutate. Body `{ kind: 'event'\|'boss', key: string≤80, regionKey?: string≤80, level?: 1..99, reason?: string≤200 }`. `kind='event'` → trả `{ kind:'event', key, type, titleI18nKey, descriptionI18nKey, catalogEnabled, effectiveEnabled, override (DB row hoặc null), nextSlotStartIso, nextSlotEndIso, regionKey?, bossKey?, simulated:true, reason: string\|null, simulatedAt: ISO }`. `kind='boss'` → trả `{ kind:'boss', bossKey, bossName, regionKey, level (clamp 1..99), simulatedMaxHp: bigint string, simulatedReward: { baseLinhThach, topDropPool[], midDropPool[], lowDropPool[] }, recommendedRealm, simulated:true, reason, simulatedAt }`. **KHÔNG ghi `LedgerEntry` / KHÔNG `prisma.worldBoss.create` / KHÔNG `LiveOpsEventOverride` upsert**; chỉ ghi 1 audit `ADMIN_LIVEOPS_DRY_RUN` với `meta { kind, targetType: 'LiveOpsEvent'\|'Boss', targetId: key, regionKey?, level?, reason: string\|null }`. |

**Admin LiveOps error codes**:
- `FORBIDDEN` — không phải ADMIN/MOD (qua `AdminGuard` chặn trước controller).
- `ADMIN_ONLY` — endpoint `@RequireAdmin()` (toggle/recalculate/snapshot/dry-run) bị MOD gọi.
- `EVENT_NOT_FOUND` — `eventKey` (toggle) hoặc `key` (dry-run kind=event) không có trong catalog `LIVE_OPS_EVENTS`.
- `BOSS_NOT_FOUND` — dry-run `kind='boss'` với `key` không có trong catalog boss (`bossByKey`).
- `INVALID_INPUT` — body sai shape (zod). Áp dụng cho `weekKey` không match `/^\d{4}-W\d{2}$/`, `reason > 200 char`, `eventKey/level/regionKey` invalid, `kind` không thuộc `{event,boss}`.

**Audit log entries (Phase 13.1.C + Phase 13.1.D)**:
- `ADMIN_LIVEOPS_OVERRIDE` — toggle event override (Phase 13.1.B).
- `ADMIN_FORCE_BOSS_SCHEDULE` — force-spawn boss qua `POST /boss/admin/spawn` (cùng meta với legacy `BOSS_SPAWN` audit row, kèm `reason` + optional `scheduledEventKey`). Backwards-compatible: consumers cũ vẫn đọc `BOSS_SPAWN`.
- `ADMIN_SECT_WAR_STATUS` — read-after-audit snapshot qua `POST /admin/sect-war/snapshot`.
- `ADMIN_LIVEOPS_DRY_RUN` — Phase 13.1.D dry-run (event hoặc boss). `meta` luôn có `kind`/`targetType`/`targetId`/`reason`; nếu `kind='boss'` kèm `regionKey`/`level`. Schedule preview (`GET /admin/liveops/schedule-preview`) **KHÔNG ghi audit** (read-only).

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
- **Story Dialogue (Phase 12 Story PR-7)**: `NPC_NOT_FOUND`, `STORY_DIALOGUE_NOT_AVAILABLE`, `NODE_NOT_FOUND`, `CHOICE_NOT_FOUND`, `CHOICE_LOCKED`, `CHOICE_ALREADY_APPLIED`, `QUEST_STEP_LOCKED`, `INVALID_INPUT`, `NO_CHARACTER`.

## Environment

Xem `.env.example`. Production khởi chạy sẽ assert `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` ≥ 32 ký tự; nếu thiếu sẽ refuse start. Các biến quan trọng:
- `MISSION_RESET_TZ` — timezone reset mission/daily login (default `Asia/Ho_Chi_Minh`).
- `MARKET_FEE_PCT` — phí thị trường (number 0..100).
- `ADMIN_BOOTSTRAP_*` — script `pnpm bootstrap:admin` để tạo admin đầu tiên.
