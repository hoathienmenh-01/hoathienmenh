# Changelog — Xuân Tôi

Tóm tắt **người chơi / vận hành / dev** dễ đọc, theo PR đã merge vào `main`. Định dạng cảm hứng từ [Keep a Changelog](https://keepachangelog.com/) + [Semantic Versioning](https://semver.org/lang/vi/) nhưng adapt cho closed-beta:

- **Closed beta chưa release public** → versioning tạm bằng "session khoảng PR".
- Chi tiết kỹ thuật từng PR (file/path/test) nằm trong `docs/AI_HANDOFF_REPORT.md` mục "Recent Changes". File này chỉ tóm tắt **thay đổi quan trọng cho người dùng/admin**.
- Quy ước section: **Added** / **Changed** / **Fixed** / **Security** / **Docs** / **Internal**.

---

## [Unreleased]

> Pending merge: docs CHANGELOG catch-up session 9r-28 — PR #279 (achievement catalog cross-ref test) + PR #280 (Phase 11.9.C breakthrough title wire) + PR #281 (Phase 11.9.C-2 tribulation title wire).

### TZ Hotfix — unify sectWarWeekKey + Territory periodKey to one TZ-aware helper (this PR)

**Scope**: Pre-Phase-15.7 hotfix. Hợp nhất toàn bộ weekly-period helpers (Sect War, Sect Mission, Territory) về **một single source of truth TZ-aware** dùng `Asia/Ho_Chi_Minh` (ICT) làm timezone mặc định. Trước hotfix có 3 implementation khác nhau:

1. `sectWarWeekKey()` shared — TZ-aware ICT (đúng).
2. `startOfWeek()` cục bộ trong `sect-mission.service.ts` — **UTC-based với `void tz`** (ignore timezone). Gây boundary mismatch cho weekly mission progress query khi `now` nằm gần Mon 00:00 ICT (= Sun 17:00 UTC).
3. `territoryPeriodKeyForDate()` / `previousTerritoryPeriodKey()` / `nextTerritoryResetAt()` / `territoryPeriodWindow()` — **pure UTC arithmetic** (`Date.UTC()`, `getUTCDay()`, `setUTCDate()`). Comment cũ nói "nhất quán với sect war week key format" nhưng CHỈ giống format `YYYY-Www`; **semantics khác hoàn toàn** (UTC Monday vs ICT Monday, lệch 7 giờ).

Bug-class thực tế: cron Monday 00:05 ICT (= Sun 17:05 UTC). Cơ chế cũ `now - 7d` UTC tính ra Sun 17:05 UTC tuần trước → `territoryPeriodKeyForDate(.)` chấm năm vào tuần cũ hơn 1 tuần ICT. Settle/reward ghi nhầm period key, nguy cơ double-reward hoặc skip tuần sau retry.

#### Fixed — TZ Hotfix

- **Shared (`packages/shared/src/sect-war.ts`)**: thêm `startOfSectWarWeek(now, timezone)` — single source of truth cho Monday 00:00 local-tz, dùng cùng helper `localPartsInTz`/`utcDateForLocal` như `sectWarWeekKey()`/`currentSectWarSeason()`. Đảm bảo invariant `sectWarWeekKey(startOfSectWarWeek(now, tz), tz) === sectWarWeekKey(now, tz)` + idempotent.
- **Shared (`packages/shared/src/sect-war.ts`)** — `sectWarWeekKey`: fix off-by-one cho year boundary khi Jan 1 = Fri/Sat/Sun. Trước fix, `firstThursday = jan1 + (4 - dow)` trỏ Thursday tuần W53 năm trước → weekNum +1. Sau fix, clamp offset ≥ 0 bằng cộng +7 ngày khi `(4 - dow) < 0`, đảm bảo `firstThursday` luôn nằm trong `weekYear`. Bug nay từng ẩn vì test cũ chỉ cover năm Jan 1 = Mon..Thu.
- **Shared (`packages/shared/src/territory.ts`)** — `territoryPeriodKeyForDate` / `currentTerritoryPeriodKey` / `previousTerritoryPeriodKey` / `nextTerritoryResetAt` / `territoryPeriodWindow` **chuyển sang TZ-aware ICT mặc định**. Delegate hoàn toàn về `sectWarWeekKey` / `startOfSectWarWeek` cho week key; `nextTerritoryResetAt` dùng `startOfSectWarWeek + 7 day local-tz` qua `utcDateForLocal`; `territoryPeriodWindow` trả `startsAt`/`endsAt` = Mon 00:00 ICT của tuần (= Sun 17:00 UTC). Mỗi helper accept tham số `timezone` (default `SECT_WAR_DEFAULT_TZ` = `Asia/Ho_Chi_Minh`); caller cũ không truyền tz vẫn auto-correct.
- **API (`apps/api/src/modules/sect/sect-mission.service.ts`)**: thay `startOfWeek()` helper local (UTC-based) bằng `startOfSectWarWeek()` từ shared. Weekly mission progress query (`createdAt >= startOfSectWarWeek(now, tz)`) bây giờ align đúng với weekKey ICT — không còn miss/double-count khi `now` rơi vào dải Sunday 17:00 UTC..Monday 00:00 UTC (= Monday ICT).
- **API tests (`apps/api/src/modules/sect/sect-mission.service.test.ts`)**: thêm regression test `Mon 00:30 ICT log + now Mon 09:00 ICT`. Trước fix: log bị MISS (since UTC = Mon 00:00 UTC > log 17:30 UTC) → `MISSION_NOT_READY`. Sau fix: log INCLUDED (since ICT = Sun 17:00 UTC < log 17:30 UTC) → claim succeed. Giữ test Sunday 22:00 ICT (works under both implementations).
- **Shared tests (`packages/shared/src/sect-war.test.ts`)**: 6 vitest mới cho `startOfSectWarWeek` (Monday-of-week stability, week-rollover, consistency với `sectWarWeekKey`, idempotent, UTC tz, cross-year `2025-W52→2026-W01`) + 3 vitest mới cho Jan 1 = Fri/Sat/Sun year boundary regression (2027-W01, 2022-W01, 2023-W01).
- **Shared tests (`packages/shared/src/territory.test.ts` + `territory-war.test.ts`)**: refactor toàn bộ assertions sang ICT semantics (`Mon 00:00 ICT = Sun 17:00 UTC`). Thêm 5 bug-demo cases: cron Mon 00:05 ICT (off-by-one), cron Mon 00:00 đúng giây reset, Sun 23:59 ICT trước reset, Mon 00:00 ICT boundary chuyển tuần (W01→W02), tz='UTC' override cho legacy compat. Roundtrip `territoryPeriodKeyForDate(territoryPeriodWindow(pk).startsAt) === pk` được khẳng định cho W01..W53 + cross-year.

#### Migration note — Territory periodKey TZ semantics

- Trong DB hiện tại, các `TerritoryPeriodSettlement.periodKey` / `TerritoryRewardRun.periodKey` đã ghi đều có format `YYYY-Www` và ISO week year giống nhau cho hầu hết các điểm thời gian — **CHỈ KHÁC** ở dải biên Mon 00:00 ICT..07:00 ICT (= Sun 17:00 UTC..Mon 00:00 UTC). Đa số region settle ngoài dải này, nên audit log lịch sử trước hotfix vẫn correct.
- Sau hotfix: cron settle Monday 00:05 ICT (sẽ deploy ở Phase 15.7) sẽ chấm đúng tuần ICT vừa kết thúc. UNIQUE composite key `(periodKey, regionKey)` của bảng settlement đảm bảo không double-settle ngay cả nếu cron retry across boundary.
- Không cần migration data. Idempotency UNIQUE keys + helper TZ-aware đã đủ.

### Phase 15.6 — Config Version + Rollback

**Scope**: Hệ versioning + rollback an toàn cho 4 entity vận hành: LiveOps Scheduled Event, LiveOps Announcement, Feature Flag, Maintenance Window. Mỗi mutation từ admin (CREATE/UPDATE/DISABLE/ENABLE/STATUS_RECOMPUTE) ghi `ConfigVersion` snapshot before/after. Admin xem list/diff/dry-run/rollback với 3 mức safety (`SAFE`/`NEED_CONFIRM`/`BLOCKED`) + audit log đầy đủ.

#### Added — Phase 15.6

- **Shared (`packages/shared/src/config-version.ts`)**: types + validators (`isConfigVersionEntityType` / `isConfigVersionAction` / `isConfigRollbackSafetyLevel` / `isConfigRollbackStatus`) + `sanitizeSnapshot` (strip secret-like keys defense-in-depth) + `computeRollbackSafety` (4 entity-specific rule branches) + `diffSnapshots` (JSON-level diff). 30 vitest.
- **Prisma migration `20260624000000_phase_15_6_config_version_rollback`**: model `ConfigVersion` (entityType/entityId/version UNIQUE composite/action/beforeJson/afterJson/changedByAdminId/reason/createdAt + 3 index) + `ConfigRollbackRun` (entityType/entityId/fromVersion/targetVersion/status/safetyLevel/warnings/reason/adminUserId/targetVersionId/newVersionId/createdAt + 2 index). Additive — không sửa bảng cũ.
- **API service (`apps/api/src/modules/config-version/`)**: `ConfigVersionService.recordVersion / listVersions / getVersion / getLatestVersion / diffVersions / recordRollbackRun`. Version auto-increment per `(entityType, entityId)` với P2002 retry. Sanitize via shared `sanitizeSnapshot`. Skip no-op (before deep-equal after). 11 vitest.
- **API admin module (`apps/api/src/modules/config-version-admin/`)**: `ConfigRollbackService.dryRun / apply` (safety check → orchestrate mutate entity → record version + rollback run). `ConfigRollbackOrchestratorService` dispatch theo entityType (LiveOps Event `updateMany` + Announcement `updateMany` + Feature Flag `setFlag` + Maintenance Window `updateMany`). `AdminConfigVersionController` 5 endpoint: `GET /admin/config-versions` + `GET /admin/config-versions/:id` + `GET /admin/config-versions/diff` + `POST /admin/config-versions/:id/dry-run-rollback` + `POST /admin/config-versions/:id/rollback`. Audit: `ADMIN_CONFIG_VERSION_VIEW` / `ADMIN_CONFIG_ROLLBACK_DRY_RUN` / `ADMIN_CONFIG_ROLLBACK` / `ADMIN_CONFIG_ROLLBACK_BLOCKED`.
- **Wiring vào 4 module**: Feature Flag / LiveOps Event Scheduler / LiveOps Announcement / Maintenance Window service đều gọi `ConfigVersionService.recordVersion` trên mọi mutation (CREATE/UPDATE/DISABLE/ENABLE/STATUS_RECOMPUTE). Fail-soft try/catch + log — không phá flow admin gốc.
- **FE Admin Panel** (`AdminConfigVersionPanel.vue`): tab mới Config Version trong AdminView. Entity type picker + entity ID input → list versions newest-first → diff-vs-latest → dry-run rollback (safety badge SAFE/NEED_CONFIRM/BLOCKED + warnings) → apply rollback (confirm modal + confirm phrase input cho NEED_CONFIRM). 5 vitest.
- **FE API client** (`api/configVersion.ts`): 5 endpoint wrapper (`adminListConfigVersions / adminGetConfigVersion / adminDiffConfigVersions / adminDryRunConfigRollback / adminApplyConfigRollback`).
- **i18n**: namespace `adminConfigVersion.*` (title/hint/entityType labels/entity ID/col headers/diff/dry-run/apply/confirm/toast/errors). VI/EN parity.

#### Tests — Phase 15.6

- **Shared**: 30 vitest (validator 8 + sanitize 4 + diff 3 + computeRollbackSafety 15 = LIVEOPS_EVENT 6 + FEATURE_FLAG 3 + LIVEOPS_ANNOUNCEMENT 2 + MAINTENANCE_WINDOW 5 — covering SAFE/NEED_CONFIRM/BLOCKED edge cases).
- **API**: 11 vitest (config-version.service: recordVersion 6 + list/get 2 + diff 1 + rollbackRun 2).
- **Web**: 5 vitest (AdminConfigVersionPanel: render list + empty state + dry-run SAFE badge/apply + dry-run BLOCKED no-apply + NEED_CONFIRM confirm phrase flow).

---

### Phase 15.5 — Maintenance Window

**Scope**: Hệ Maintenance Window cho phép admin lập lịch hoặc bật khẩn cấp cửa sổ bảo trì để chặn traffic player trong khi vẫn cho admin / health / metrics / `/maintenance/status` đi qua. Catalog severity (`INFO`/`WARNING`/`CRITICAL`) + target (`ALL_PLAYERS`/`NON_ADMIN_USERS`/`API_WRITE_ONLY`/`FULL_LOCKDOWN`) + status state machine (`DRAFT`/`SCHEDULED`/`ACTIVE`/`ENDED`/`DISABLED`). Middleware `MaintenanceWindowGuardMiddleware` chạy trước Nest pipeline với 9 bypass rule (`/maintenance/status` luôn pass, `/health*`/`/metrics*` theo flag, `/_auth/*`, ADMIN/MOD bypass theo `allowAdminBypass` + `target`, `API_WRITE_ONLY` chỉ block non-GET, `NON_ADMIN_USERS`/`ALL_PLAYERS` block player + anonymous, fail-closed default). Cache L1 in-memory TTL 10s per pod. Recompute `SCHEDULED→ACTIVE`/`ACTIVE→ENDED` chạy idempotent piggy-back trên `LiveOpsEventSchedulerCronProcessor` mỗi 5 phút (reuse — không thêm queue/lease mới). FE poll `/maintenance/status` 30s + axios interceptor 503 `MAINTENANCE_ACTIVE` → set blocked state. Server-authoritative — FE chỉ render overlay/banner.

#### Added — Phase 15.5

- **Shared (`packages/shared/src/maintenance-window.ts`)**: `MaintenanceWindowStatus` (5 status) + `MaintenanceSeverity` (3) + `MaintenanceTarget` (4) + `MaintenanceWindowInput`/`MaintenanceWindowAdminView`/`MaintenanceWindowPublicView` types + `validateMaintenanceWindowInput` (key pattern, severity/target enum, title/message bound + safe text, locale parity vi/en, window `startsAt < endsAt`, min 60s, max 30 ngày) + `nextMaintenanceWindowStatus` state machine + `MAINTENANCE_ACTIVE_ERROR_CODE`.
- **Prisma migration `20260623000000_phase_15_5_maintenance_window`**: model `MaintenanceWindow` (id/key UNIQUE/severity/target/status/titleVi/titleEn nullable/messageVi/messageEn nullable/startsAt/endsAt/allowAdminBypass/allowHealthcheck/allowMetrics/createdByAdminId nullable/createdAt/updatedAt/disabledAt nullable + 3 index). Reuse `AdminAuditLog` cho `ADMIN_MAINTENANCE_*`.
- **API service (`apps/api/src/modules/maintenance-window/`)**: `MaintenanceWindowService.listWindows / getWindow / getActiveWindow / createWindow / updateWindow / disableWindow / recomputeStatuses / isMaintenanceActiveForRequest` với cache L1 in-memory TTL 10s; idempotent recompute qua `updateMany` CAS guard status + window.
- **API middleware (`maintenance-window.middleware.ts`)**: `MaintenanceWindowGuardMiddleware` resolve role từ cookie `xt_access` (banned/missing → ANONYMOUS, fail-open nếu service throw), 9 bypass rule, render envelope `{ ok: false, error: { code: 'MAINTENANCE_ACTIVE', meta: { severity, target, titleVi/En, messageVi/En, endsAt, serverTime } } }` + `Retry-After` header.
- **API admin endpoints (`maintenance-window-admin/admin-maintenance-window.controller.ts`)**: `GET /admin/maintenance-windows` + `POST /admin/maintenance-windows` (audit `ADMIN_MAINTENANCE_CREATE`, reject `MAINTENANCE_KEY_DUPLICATE` 409 / validator codes 400) + `PATCH /admin/maintenance-windows/:id` (audit `ADMIN_MAINTENANCE_UPDATE`, block khi status đã ACTIVE/ENDED/DISABLED) + `POST /admin/maintenance-windows/:id/disable` (audit `ADMIN_MAINTENANCE_DISABLE`, idempotent) + `POST /admin/maintenance-windows/recompute-status` (audit `ADMIN_MAINTENANCE_RECOMPUTE`, idempotent). ADMIN-only.
- **API public endpoint (`maintenance-window-public.controller.ts`)**: `GET /maintenance/status` — anonymous-safe, trả `MaintenanceWindowPublicView` (không leak `id`/`createdByAdminId`/`disabledAt`/internal flags). Endpoint luôn được phép truy cập kể cả khi maintenance ACTIVE.
- **Cron transition**: `LiveOpsEventSchedulerCronProcessor` piggy-back recompute maintenance status mỗi tick 5 phút sau khi đã recompute LiveOps event + announcement; idempotent — không thêm queue/lease riêng.
- **FE Player UI** (`MaintenanceOverlay.vue` + `MaintenanceBanner.vue`): overlay full-screen render khi store `isBlocked` → severity badge + title/message theo locale + countdown tới `endsAt` + nút "Thử lại"; banner admin-only trong `AppShell` cho biết admin đang bypass maintenance window đang ACTIVE.
- **FE Admin Panel** (`AdminMaintenancePanel.vue`): tab mới trong `AdminView`, list windows + create form (severity/target/title/message/start/end/allowAdminBypass/allowHealthcheck/allowMetrics/initialStatus) + recompute button + disable button với confirm modal cho action major (FULL_LOCKDOWN / disable đang ACTIVE).
- **FE Store** (`stores/maintenance.ts`): Pinia store poll `/maintenance/status` 30s, expose `active`/`severity`/`target`/`titleVi/En`/`messageVi/En`/`endsAt`/`serverTime`. Axios interceptor 503 `MAINTENANCE_ACTIVE` → `markBlockedByApi(error.payload)` để overlay render ngay không cần đợi poll.
- **i18n**: namespace mới `maintenance.*` (overlay/banner/admin panel — title/severity/target/status/form/actions/confirm/toast/errors). VI/EN parity.

#### Tests — Phase 15.5

- **Shared**: 12 validator test (key pattern, severity/target enum, title/message bound + unsafe HTML, locale parity, window time, min 60s, max 30 ngày) + state machine tests.
- **API**: 53 test pass — 33 service (CRUD + active resolution + recompute idempotent + cache TTL + duplicate key + status transition guard) + 12 admin controller (audit + http status mapping cho duplicate/not-found/validator/transition reject) + 2 public controller (active/inactive shape) + 6 middleware (bypass status/health/metrics/auth path + admin bypass + FULL_LOCKDOWN/API_WRITE_ONLY/NON_ADMIN/ALL_PLAYERS gating + fail-open). Không regress 447 admin / 79 auth / 13 health.
- **Web**: 17 test pass — 5 overlay (render khi blocked + countdown + locale fallback + retry button) + 2 banner (admin only render) + 6 admin panel (form submit + recompute + disable confirm + list refresh + error toast) + 4 store (poll TTL 30s + axios interceptor markBlockedByApi + reset + locale fallback). I18n parity 10 test pass.

---

### Phase 15.4 — Feature Flag DB-backed

**Scope**: Hệ Feature Flag DB-backed cho phép admin bật/tắt nhanh các hệ thống lõi (Arena, Tribulation Mini-Battle, Equipment Reforge/Enchant, LiveOps Events, Festival Gift, LiveOps Announcements, Territory War, Market, Shop/Sect Shop discount runtime) **mà không cần deploy code**. Catalog 11 flag hardcoded trong `packages/shared/src/feature-flags.ts` chia 5 category (`GAMEPLAY`/`ECONOMY`/`LIVEOPS`/`ADMIN`/`SAFETY`). Cache 2-tier (L1 in-memory TTL 30s + L2 Redis TTL 30s) với Redis fail-soft. Server-authoritative qua `FEATURE_DISABLED` 503 — FE chỉ hint UX.

#### Added — Phase 15.4

- **Shared (`packages/shared/src/feature-flags.ts`)**: 11 flag catalog (`ARENA_ENABLED`, `TRIBULATION_MINI_BATTLE_ENABLED`, `EQUIPMENT_REFORGE_ENABLED`, `EQUIPMENT_ENCHANT_ENABLED`, `LIVEOPS_EVENTS_ENABLED`, `LIVEOPS_FESTIVAL_GIFT_ENABLED`, `LIVEOPS_ANNOUNCEMENTS_ENABLED`, `TERRITORY_WAR_ENABLED`, `MARKET_ENABLED`, `SHOP_DISCOUNT_EVENTS_ENABLED`, `SECT_SHOP_DISCOUNT_EVENTS_ENABLED`) + helper `getFeatureFlagDef()` / `getDefaultFeatureFlagEnabled()` / `isPublicFeatureFlag()` + types `FeatureFlagAdminView` / `FeatureFlagPublicView` + `FEATURE_DISABLED_ERROR_CODE`.
- **Prisma migration `20260622000000_phase_15_4_feature_flag`**: model `FeatureFlag` (id/key UNIQUE/enabled/category/descriptionVi/descriptionEn nullable/updatedByAdminId nullable/createdAt/updatedAt + index). Reuse `AdminAuditLog` cho `ADMIN_FEATURE_FLAG_*`.
- **API service (`apps/api/src/modules/feature-flag/`)**: `FeatureFlagService.isEnabled / getFlag / listFlags / setFlag / ensureDefaultFlags / clearCache` với cache 2-tier (L1 Map + L2 Redis), Redis fail-soft, `assertFeatureEnabled(key)` throw `FeatureFlagDisabledError` → controller layer map 503 `FEATURE_DISABLED` payload `{ flag, message }`.
- **API admin endpoints (`feature-flag-admin/admin-feature-flag.controller.ts` — extracted module để tránh circular dep)**: `GET /admin/feature-flags` (full catalog + DB row state) + `PATCH /admin/feature-flags/:key` (audit `ADMIN_FEATURE_FLAG_UPDATE`, reject `FEATURE_FLAG_KEY_INVALID`) + `POST /admin/feature-flags/refresh-defaults` (idempotent seed) + `POST /admin/feature-flags/clear-cache`. ADMIN-only.
- **API public endpoint**: `GET /feature-flags/public` — anonymous-safe, whitelist subset (chỉ flag FE cần biết để ẩn UI), KHÔNG trả flag SAFETY/ADMIN.
- **Runtime gates**: `ARENA_ENABLED` (`POST /arena/matches`), `TRIBULATION_MINI_BATTLE_ENABLED` (mini-battle start), `EQUIPMENT_REFORGE_ENABLED`/`EQUIPMENT_ENCHANT_ENABLED` (`POST /character/equipment/{reforge,enchant}`), `LIVEOPS_EVENTS_ENABLED` (runtime modifier không apply), `LIVEOPS_FESTIVAL_GIFT_ENABLED` (`POST /liveops/events/:key/claim`), `LIVEOPS_ANNOUNCEMENTS_ENABLED` (public list empty), `TERRITORY_WAR_ENABLED`, `MARKET_ENABLED`, `SHOP_DISCOUNT_EVENTS_ENABLED`, `SECT_SHOP_DISCOUNT_EVENTS_ENABLED`. Tất cả trả `FEATURE_DISABLED` 503 khi flag off.
- **FE Admin panel** (`AdminFeatureFlagsPanel.vue`): tab mới trong `AdminView`, list catalog + filter category + search + toggle, confirm modal cho flag "lớn" (`ARENA_ENABLED`/`MARKET_ENABLED`/`LIVEOPS_EVENTS_ENABLED`/`TERRITORY_WAR_ENABLED`/`LIVEOPS_FESTIVAL_GIFT_ENABLED`) khi tắt, refresh defaults + clear cache action.
- **FE Public store** (`stores/featureFlags.ts`): Pinia store fetch `/feature-flags/public` cache 30s TTL, fail-open (undefined / chưa load → `isEnabled` trả true → tránh ẩn UI khi BE tạm gián đoạn). Server vẫn gate cuối cùng.
- **FE disable banner** (`FeatureDisabledBanner.vue`): reusable banner i18n "Tính năng đang tạm tắt để bảo trì". Wire vào `ArenaView` (banner + disable challenge button), `EquipmentUpgradePanel` (Reforge/Enchant button + banner), `LiveOpsActiveEventsPanel` (FESTIVAL_GIFT claim button).
- **i18n**: namespace mới `adminFeatureFlags.*` (title/hint/loading/empty/filter/category/row/actions/confirm/toast/errors), `featureFlags.disabled.*` (title/message generic), `arena.disabled.message`, `inventory.upgrade.{reforge,enchant}.disabledMessage`, `liveopsActiveEvents.disabled.festivalGiftMessage`, `admin.tab.featureFlags`. VI/EN parity.

#### Tests — Phase 15.4

- **Shared**: catalog tests (key unique, default valid, category valid, public whitelist valid).
- **API**: feature flag service (cache fallback Redis-down, ensureDefaultFlags idempotent, setFlag clear cache + audit), admin controller (list/update/refresh/clear-cache + admin guard reject PLAYER + invalid key reject), runtime gates (arena/tribulation/reforge/enchant/festival-gift/market/liveops-events flag off → 503), public endpoint whitelist.
- **Web**: `AdminFeatureFlagsPanel` (render list + filter + toggle non-major + confirm modal cho major flag + refresh-defaults + clear-cache), `FeatureDisabledBanner` (default + messageKey override + fallback + testId), `useFeatureFlagsStore` (ensureLoaded fetch+map, TTL 30s không refetch, refresh force, fail-open semantics, reset). I18n parity VI/EN.

---

### Phase 15.3.B — LiveOps Announcement + WS Broadcast / Marquee (this PR)

**Scope**: Bổ sung hệ thống thông báo realtime cho người chơi. Admin tạo `LiveOpsAnnouncement` với severity (`INFO`/`EVENT`/`WARNING`/`MAINTENANCE`), target (`ALL`/`AUTHENTICATED`/`ADMIN_ONLY`) và time window. Cron 5-phút (piggy-back trên LiveOps event recompute) tự động chuyển status `DRAFT→SCHEDULED→ACTIVE→ENDED` idempotent + broadcast WS `liveops:announcement` (`ANNOUNCEMENT_ACTIVE`/`ANNOUNCEMENT_ENDED`) + `liveops:event` (`LIVEOPS_EVENT_ACTIVE`/`LIVEOPS_EVENT_ENDED`/`LIVEOPS_EVENT_UPDATED`). Player thấy banner/marquee trên `HomeView` (severity color/badge + countdown + dismiss local). Public payload đã strip admin metadata. **KHÔNG** spam broadcast mỗi tick (chỉ khi status thật transition), **KHÔNG** gửi raw configJson, **KHÔNG** cho HTML/script injection.

#### Added — Phase 15.3.B

- **Shared (`packages/shared/src/liveops-announcement.ts` + `ws-events.ts`)**: `LIVEOPS_ANNOUNCEMENT_SEVERITIES`/`STATUSES`/`TARGETS` enum + catalog, `LIVEOPS_BROADCAST_EVENT_TYPES`, `validateLiveOpsAnnouncementInput` (cap title 120 / message 500, vi/en parity, HTML/script reject, `startsAt < endsAt`), `nextLiveOpsAnnouncementStatus` state machine, `LiveOpsAnnouncementBroadcastPayload`/`LiveOpsEventBroadcastPayload` types, `LiveOpsAnnouncementPublicView` (strip `id`/`adminId`/`disabledAt`/timestamps).
- **Prisma migration `20260621000000_phase_15_3_b_liveops_announcement`**: model `LiveOpsAnnouncement` (id/key UNIQUE/severity/status/target/titleVi/titleEn nullable/messageVi/messageEn nullable/startsAt/endsAt/createdByAdminId nullable/createdAt/updatedAt/disabledAt nullable + 3 index). Reuse `AdminAuditLog`.
- **API admin endpoints (`apps/api/src/modules/liveops-announcement/`)**: `GET /admin/liveops/announcements`, `POST /admin/liveops/announcements`, `PATCH /admin/liveops/announcements/:id`, `POST /admin/liveops/announcements/:id/disable`, `POST /admin/liveops/announcements/recompute-status`. ADMIN-only, audit `ADMIN_LIVEOPS_ANNOUNCEMENT_*`.
- **API public endpoint**: `GET /liveops/announcements/active` — chỉ trả `ACTIVE`, public-safe payload, exclude `ADMIN_ONLY` target.
- **WS broadcast**: `LiveOpsBroadcastService` reuse `RealtimeService.io.emit` với 2 channel `liveops:announcement` + `liveops:event`. Fail-safe try/catch (status transition vẫn commit nếu WS lỗi). Cron + admin recompute đều broadcast khi và chỉ khi status thật transition (anti-spam).
- **FE marquee**: `LiveOpsAnnouncementMarquee.vue` + Pinia store `stores/liveopsAnnouncements.ts` (visibility filter ACTIVE+window+!dismissed, WS handler, `lastEventBroadcastAt` bump, auto refresh 60s). Gắn vào `HomeView` cho cả anonymous viewer.
- **FE admin**: `AdminLiveOpsAnnouncementsPanel.vue` (form create + list + disable + recompute, status/severity badge, time window).
- **FE event panel refresh**: `LiveOpsActiveEventsPanel` watch `lastEventBroadcastAt` → refetch khi event transition.
- **i18n**: `liveopsAnnouncementMarquee.*` (severity vi/en, dismiss aria, countdown, toast) + `adminLiveOpsAnnouncements.*` (form fields, errors `ANNOUNCEMENT_*`, actions). VI/EN parity.

#### Tests — Phase 15.3.B

- **Shared**: 16 cases (validator reject HTML/script + overlong + invalid window + locale parity, status transition idempotent).
- **API**: 32 cases (service CRUD, idempotent recompute, race-safe `updateMany`, admin guard reject PLAYER, public list exclude DISABLED/ENDED/ADMIN_ONLY, broadcast called once on transition + payload strip admin field).
- **Web**: 11 cases (marquee empty/render/dismiss/WS announcement upsert/WS event refresh + admin panel CRUD + i18n parity VI/EN).

---

### Phase 15.3.A — LiveOps Runtime Expansion + Festival Gift Claim (this PR)

**Scope**: Mở rộng runtime cho 5/7 event type chỉ có enum/storage trong Phase 15.1–15.2 — `SHOP_DISCOUNT`, `SECT_SHOP_DISCOUNT`, `DAILY_LOGIN_BONUS`, `BOSS_REWARD_BOOST`, `FESTIVAL_GIFT`. Sau merge: 7/7 event type đã wire runtime thật. Thêm public API `GET /liveops/events/active` + `POST /liveops/events/:eventKey/claim` (idempotent FESTIVAL_GIFT one-time claim qua UNIQUE `(eventId, characterId)` đã có sẵn từ Phase 15.1–15.2). Compose policy max-only giữ nguyên — nhiều event cùng type ACTIVE → chọn multiplier tốt nhất, không stack. Caps không đổi (drop/exp ≤ 2.0, discount ≤ 0.5, FESTIVAL_GIFT reward `linhThach` ≤ 1000 / `tienNgoc` ≤ 50 / ≤ 10 items × qty ≤ 50). **KHÔNG** battle pass, **KHÔNG** gacha/pet/wife, **KHÔNG** rewrite scheduler core, **KHÔNG** bypass Daily Reward Cap.

#### Added — Phase 15.3.A

- **Shared (`packages/shared/src/liveops-event-scheduler.ts`)**: thêm `LIVEOPS_RUNTIME_SUPPORTED_TYPES` (Record per-type → boolean), `LIVEOPS_FESTIVAL_GIFT_REWARD_CAPS` (linhThach ≤ 1000, tienNgoc ≤ 50, maxItems = 10, qty ≤ 50), `validateLiveOpsEventRewardJson(rewardJson)` (per-field/per-cap validate cho FESTIVAL_GIFT), `parseLiveOpsEventReward(rewardJson)` (defensive parser cho legacy/loose rows), `LiveOpsEventReward` type. Validator cũ `validateLiveOpsScheduledEventInput` extend gọi `validateLiveOpsEventRewardJson` khi `type='FESTIVAL_GIFT'`.
- **API runtime wiring**:
  - **`SHOP_DISCOUNT`**: `ShopService.buyFromShop` query `getActiveMultiplier('SHOP_DISCOUNT')` → áp `finalPrice = ceil(originalPrice × (1 − mul))`, ghi `meta.shop.liveOpsDiscount` + `liveOpsEventKey`. CurrencyLedger ghi đúng `finalPrice` thực chi.
  - **`SECT_SHOP_DISCOUNT`**: `SectShopService.buyFromSectShop` áp tương tự cho cost contribution + linh thạch. KHÔNG bypass daily/weekly limit + contribution requirement.
  - **`DAILY_LOGIN_BONUS`**: `DailyLoginService.claimToday` áp multiplier vào reward sau khi qua Daily Reward Cap. Idempotent (UNIQUE `(characterId, dateLocal)` từ Phase trước).
  - **`BOSS_REWARD_BOOST`**: `BossRewardService.distributeRewards` áp multiplier vào reward attribution rank. Mail metadata ghi `liveOpsBoostMultiplier` + `liveOpsEventKey`. Cap reward không đổi.
  - **`FESTIVAL_GIFT`**: `LiveOpsEventSchedulerService.claimEventReward(characterId, eventKey)` idempotent qua UNIQUE `(eventId, characterId)`. Reject nếu event không ACTIVE / type ≠ FESTIVAL_GIFT / reward config invalid. Ghi `LiveOpsEventRewardClaim` + grant CurrencyLedger/ItemLedger atomically trong 1 transaction.
- **API public endpoints (`liveops-events.controller.ts`)**:
  - `GET /liveops/events/active` — list ACTIVE event public-safe (không leak `createdByAdminId`/internal id). Mỗi entry chứa `claimable` (đúng nếu type=FESTIVAL_GIFT + character chưa claim) + `runtimeSupported` (chỉ FE hint, BE vẫn validate).
  - `POST /liveops/events/:eventKey/claim` — claim FESTIVAL_GIFT một lần. Trả `{ eventKey, claimedAt, granted }`.
- **FE (`apps/web/src/components/LiveOpsActiveEventsPanel.vue` mới + `AdminLiveOpsEventsPanel.vue` enhanced)**:
  - Player panel render ACTIVE event + countdown đến `endsAt` + multiplier label (`x1.5` cho BOOST, `30% off` cho DISCOUNT) + reward summary cho FESTIVAL_GIFT + nút "Nhận quà" (confirm prompt → POST API → toast). Auto-refresh 60s. Loading/empty/error states + i18n.
  - Admin panel: thêm runtime support badge per row + dropdown ("runtime ✓" / "chưa wire") + cap-aware multiplier input (FE clamp theo `LIVEOPS_EVENT_TYPE_CAPS`) + helper text reward JSON + FE-side `validateLiveOpsEventRewardJson` defense-in-depth (BE re-validate).
  - Mount `LiveOpsActiveEventsPanel` vào `HomeView` (chỉ render khi đã có character).
- **i18n VI/EN**: namespace mới `liveopsActiveEvents.*` (label/toast/error code mapping). Bổ sung keys `adminLiveOpsEvents.runtime{Legend,Wired,NotWired}`, `adminLiveOpsEvents.form.{multiplierWithCap,rewardJsonHelp,runtimeNotWiredWarn}` + 7 error code mới (`EVENT_REWARD_*`). Parity test pass.
- **Tests added — Phase 15.3.A**:
  - **Shared**: `validateLiveOpsEventRewardJson` (empty / over-cap / invalid item / wrong currency / extra field reject), `LIVEOPS_RUNTIME_SUPPORTED_TYPES` true/false invariant.
  - **API**: shop discount apply + ledger reflects `finalPrice`; sect shop discount + daily/weekly limit guard; daily login bonus với reward cap interaction; boss reward boost mail metadata; festival claim happy path + double-claim idempotent reject + non-active reject + wrong type reject + invalid reward config reject (admin create-time).
  - **Web**: `LiveOpsActiveEventsPanel` 6 cases (loading / empty / error / boost+discount label / claim button visibility / claim API success+error). `AdminLiveOpsEventsPanel` 3 case mới (runtime badge per row / FE rewardJson empty reject / FE multiplier > cap reject). API client `getActiveLiveOpsEvents` (fail-soft `[]` on reject/`{ ok: false }`) + `claimLiveOpsEventReward` (URL encoding + envelope error throw).

#### Known limitations — Phase 15.3.A

- **Mỗi reward grant qua engine sẵn có** (CurrencyLedger / ItemLedger / Mail). Festival gift KHÔNG bypass Daily Reward Cap nếu cap có wired ở `CurrencyLedgerService.grantWithCap` cho reason tương ứng — `granted` trong response phản ánh số thực sau cap.
- **Realtime broadcast**: chưa có websocket "event vừa start/end" hoặc marquee — defer Phase 15.3.B (next task).
- **Admin-side reward editor** vẫn là raw JSON textarea + FE validate. Form picker (item picker / amount slider) defer phase sau.

#### Next task recommendation — sau 15.3.A

- **Phase 15.3.B Announcement + WS Broadcast / Marquee** — push realtime "event đang mở / sắp end" vào WS channel, FE marquee + toast banner.

### Phase 15.1–15.2 — LiveOps Event Scheduler Core (this PR)

**Scope**: Admin-driven event scheduler để vận hành sự kiện theo thời gian KHÔNG cần deploy code. 7 event type (`DOUBLE_DUNGEON_DROP`, `CULTIVATION_EXP_BOOST`, `SHOP_DISCOUNT`, `SECT_SHOP_DISCOUNT`, `DAILY_LOGIN_BONUS`, `BOSS_REWARD_BOOST`, `FESTIVAL_GIFT`). Status machine `DRAFT → SCHEDULED → ACTIVE → ENDED` (+ `DISABLED` kill switch). Cron 5-phút auto-transition theo `startsAt` / `endsAt`. Multiplier capped server-side: drop/exp ≤ 2.0, discount ≤ 0.5 — vượt cap reject ngay từ shared validator. Wire runtime tối thiểu: dungeon `DOUBLE_DUNGEON_DROP` + cultivation `CULTIVATION_EXP_BOOST` (compose max-only, không stack). **KHÔNG** battle pass, **KHÔNG** gacha/pet/wife, **KHÔNG** rewrite LiveOps cũ.

#### Added — Phase 15.1–15.2

- **Shared (`packages/shared/src/liveops-event-scheduler.ts`)**: `LIVEOPS_EVENT_TYPES` + `LIVEOPS_EVENT_STATUSES` enum, `LIVEOPS_EVENT_TYPE_CAPS` (per-type cap + kind BOOST/DISCOUNT), `LIVEOPS_EVENT_KEY_PATTERN` (kebab/snake-case 3-64 chars), `LIVEOPS_EVENT_RECOMPUTE_CRON='*/5 * * * *'`. Helpers: `validateLiveOpsScheduledEventInput` (key/window/multiplier cap), `clampLiveOpsMultiplier(type, raw)` (defense-in-depth), `pickActiveLiveOpsMultiplier(modifiers, type)` (max-only, no-stack), `nextLiveOpsScheduledEventStatus(status, start, end, now)` (state machine), `isLiveOpsEventActiveAt(start, end, now)`. 78 shared tests cover invariant + boundary.
- **Prisma migration `20260620000000_phase_15_1_liveops_event_scheduler`**: 2 model additive `LiveOpsScheduledEvent` (id/key UNIQUE/type/title/description/status/startsAt/endsAt/configJson JSONB/createdByAdminId nullable/createdAt/updatedAt + 3 index `(status, startsAt)`/`(status, endsAt)`/`type`) và `LiveOpsEventRewardClaim` (id/eventId FK/characterId FK/claimedAt/rewardJson + UNIQUE `(eventId, characterId)` cho FESTIVAL_GIFT one-time claim). KHÔNG drop/đổi schema cũ.
- **API runtime (`apps/api/src/modules/liveops-event-scheduler/`)**: `LiveOpsEventSchedulerService` với `listEvents` / `getEventById` / `getEventByKey` / `getActiveEvents(now)` / `getRuntimeModifiers(now)` / `getActiveMultiplier(type, now)` / `createEvent(adminId, input)` / `updateEvent(id, input)` / `disableEvent(id)` / `recomputeStatuses(now)`. Recompute idempotent: `updateMany` với guard `status='SCHEDULED' AND startsAt<=now AND endsAt>now` → ACTIVE; `status='ACTIVE' AND endsAt<=now` → ENDED. Race-safe multi-instance: 2 worker cùng tick → đúng 1 winner per row qua DB-level CAS.
- **API admin endpoints (`admin-liveops-events.controller.ts`)**: `GET /admin/liveops/events`, `POST /admin/liveops/events`, `PATCH /admin/liveops/events/:id`, `POST /admin/liveops/events/:id/disable`, `POST /admin/liveops/events/recompute-status`. Tất cả `RequireAdmin` (MOD reject `ADMIN_ONLY` 403). Audit log `ADMIN_LIVEOPS_EVENT_CREATE/UPDATE/DISABLE/RECOMPUTE` ghi vào `AdminAuditLog`. Body validate qua zod `.strict()` (extra key reject `INVALID_INPUT`).
- **Cron BullMQ (`liveops-event-scheduler.cron.{config,scheduler,processor}.ts`)**: queue `liveops-event-scheduler-cron` + repeatable job `recompute-status` chạy `*/5 * * * *` (UTC default, override `LIVEOPS_EVENT_SCHEDULER_CRON_TZ`). Redis lease `xt:liveops-event-scheduler:recompute` (60s TTL) + DB-level `updateMany` CAS guard ngăn double transition. Disabled by default — bật qua env `LIVEOPS_EVENT_SCHEDULER_CRON_ENABLED=true` (gradual rollout an toàn).
- **Runtime integration**: `DungeonRunService.claimRun` query `getActiveMultiplier('DOUBLE_DUNGEON_DROP')` (fail-soft → 1.0) → áp `floor(linhThach × mul)` + `max(1, floor(itemQty × mul))` cho mỗi loot. `meta.dungeon` ghi `liveOpsDropMultiplier` + `liveOpsLinhThachBonus` cho audit replay. `CultivationProcessor.process` query `getActiveMultiplier('CULTIVATION_EXP_BOOST')` 1 lần per tick → compose vào `requestedGain` cuối cùng (sau realm rate / method mul / talent mul / buff mul). Cả 2 wrap try-catch fallback 1.0 nếu service unavailable.
- **FE (`apps/web/src/components/AdminLiveOpsEventsPanel.vue`)**: panel mới gắn vào AdminView tab `liveops`. Render danh sách event (key/type/status badge color-coded DRAFT/SCHEDULED/ACTIVE/ENDED/DISABLED/window/configJson preview) + form tạo event (key/type select/title/description/startsAt/endsAt datetime-local/multiplier 0–2 / `rewardJson` cho FESTIVAL_GIFT/initialStatus DRAFT|SCHEDULED) + nút Disable + nút Recompute manual. Confirm prompt mọi mutation. i18n VI/EN keys `adminLiveOpsEvents.*` (parity test passed).
- **Tests**:
  - **Shared (78 existing pass)** — invariant, validator, status machine, boundary checks.
  - **API service (16 tests)** — create success/duplicate-key/cap-reject/window-invalid, update success + manual ACTIVE/ENDED rejection, disable, recompute SCHEDULED→ACTIVE, ACTIVE→ENDED, SCHEDULED→ENDED khi quá hạn, idempotent (2 lần liên tiếp), race-safe (`Promise.all` → tổng count=1), runtime modifier query, max-only multiplier compose, defense-in-depth clamp, DISABLED filter.
  - **API admin controller (10 tests)** — list OK, create OK + audit, INVALID_INPUT khi body malformed/extra key, error code mapping (404/409/400), update + audit, disable + audit, recompute + audit.
  - **API runtime integration (7 tests)** — dungeon DOUBLE_DUNGEON_DROP áp 1.5× linh thạch + items qty, no-event base nguyên xi, cap clamp khi DB lưu 5.0 → runtime ≤ 2.0; cultivation ENDED/DISABLED → multiplier 1.0.
  - **Web (5 tests)** — render table + status badge, empty state, disable button gọi API, recompute button gọi API, create form submit với multiplier config.

#### Known limitations — Phase 15.1–15.2

- **Cron disabled by default**: BullMQ worker chỉ register khi env `LIVEOPS_EVENT_SCHEDULER_CRON_ENABLED=true`. Gradual rollout an toàn — admin force-run qua endpoint `POST /admin/liveops/events/recompute-status` đến khi sẵn sàng bật cron tự động.
- **Manual ACTIVE/ENDED transition reject**: `PATCH /admin/liveops/events/:id` chấp nhận `status=DRAFT|SCHEDULED|DISABLED` thôi. ACTIVE/ENDED chỉ qua cron để tránh inconsistent với window — nếu admin cần force, gọi `recompute-status`.
- **Wire runtime hạn chế**: chỉ `DOUBLE_DUNGEON_DROP` (dungeon claim) + `CULTIVATION_EXP_BOOST` (cultivation tick). `SHOP_DISCOUNT`, `SECT_SHOP_DISCOUNT`, `DAILY_LOGIN_BONUS`, `BOSS_REWARD_BOOST`, `FESTIVAL_GIFT` enum + storage hỗ trợ nhưng chưa wire — defer Phase 15.3+.
- **Reward claim**: `LiveOpsEventRewardClaim` schema sẵn cho FESTIVAL_GIFT one-time claim nhưng API `POST /event/:key/claim` chưa làm — defer Phase 15.3.

### Phase 15.0.A — Equipment Reforge / Enchant Foundation (this PR)

**Scope**: 2 sink mới tối ưu trang bị late-game, song song refine (Phase 11.5) và gem (Phase 11.4). **Reforge** (`tẩy luyện`): re-roll substat phụ trong `ALLOWED_SUBSTAT_KINDS = atk/def/hpMax/mpMax/spirit`, slot count + value range theo quality (PHAM 1 / LINH 2 / HUYEN 3 / TIEN 3 / THAN 4). **Enchant** (`phụ ma`): gắn 1 hệ Ngũ Hành (`kim/moc/thuy/hoa/tho`) lên trang bị, level 0..5 (`MAX_ENCHANT_LEVEL=5`), mỗi level cộng bonus nhỏ theo identity hệ (Mộc → +12 hpMax/level, Hỏa → +2 atk/level, Thổ → +2 def/level, Kim → +1 atk/level, Thủy → +6 mpMax/level). Cost linhThach + material (`tinh_thiet`/`yeu_dan`/`han_ngoc`) tăng theo quality + level. **KHÔNG** gacha, **KHÔNG** phá hủy trang bị, **KHÔNG** auction house, **KHÔNG** rewrite inventory.

#### Added — Phase 15.0.A

- **Shared (`packages/shared/src/equipment-upgrade.ts`)**: `EQUIPMENT_REFORGE_CONFIG` (per-quality slots + ranges + cost + material), `EQUIPMENT_ENCHANT_CONFIG` (per-quality baseLinhThachCost + material), `ELEMENTAL_ENCHANT_EFFECTS` (per-element statKind + bonusPerLevel + i18n labels), `MAX_ENCHANT_LEVEL=5`, `ALLOWED_SUBSTAT_KINDS`. Helpers `getReforgeCost`, `getEnchantCost(quality, currentLevel)` (geometric `base × (level+1)`), `rollReforgedSubstats(quality, rng)`, `composeSubstatBonus`, `composeEnchantBonus(element, level)` (cap defensively ở `MAX_ENCHANT_LEVEL`), `parseEnchantElement`, `isUpgradableItemKind` (chỉ WEAPON/ARMOR/BELT/BOOTS/HAT/TRAM/ARTIFACT — pill/ore/skill book reject).
- **Prisma migration `20260619000000_phase_15_0_a_equipment_reforge_enchant`**: `InventoryItem` thêm 3 cột `substatsJson` JSONB default `[]`, `enchantElement` TEXT NULL, `enchantLevel` INT default 0; tạo `EquipmentReforgeHistory` + `EquipmentEnchantHistory` audit table với FK `Character(id)` ON DELETE CASCADE + 4 index `(characterId, createdAt DESC)` / `(inventoryItemId, createdAt DESC)`. Forward-compat — không drop column / không đổi schema cũ.
- **API runtime (`apps/api/src/modules/character/equipment.service.ts` + `character.controller.ts`)**: `EquipmentService.reforge / enchant / upgradePreview` + 3 endpoint POST `/character/equipment/{reforge,enchant,upgrade-preview}`. Atomic `prisma.$transaction`: verify ownership → consume material qua `updateMany gte` guard → consume linhThach qua `CurrencyService.applyTx` (gte guard) → mutate `InventoryItem` → ghi history audit row. Error codes: `EQUIPMENT_NOT_FOUND/INVALID_EQUIPMENT/INSUFFICIENT_FUNDS/INSUFFICIENT_MATERIAL/MAX_ENCHANT_REACHED/INVALID_ELEMENT/ELEMENT_LOCKED`.
- **Combat integration (`InventoryService.equipBonus`)**: cộng substat (`composeSubstatBonus`) + enchant (`composeEnchantBonus`) vào `equipBonus` map → `CombatService.derivedStats` tự include qua pipeline cũ (additive với `ItemDef.bonuses` base). Arena snapshot Phase 14.1.B capture `equipBonus` đã tính reforge + enchant tại match time.
- **Ledger reason mới**: `CurrencyLedger.reason = 'EQUIPMENT_REFORGE' | 'EQUIPMENT_ENCHANT'`; `ItemLedger.reason = 'EQUIPMENT_REFORGE_COST' | 'EQUIPMENT_ENCHANT_COST'`. `refType=InventoryItem`, `refId=<inventoryItemId>` cho audit replay.
- **FE (`apps/web/src/components/EquipmentUpgradePanel.vue`)**: panel mới gắn vào equipment detail, render reforge cost preview + Reforge button (overwrite confirm modal) + 5 element chip (lock khi đã enchant + level ≥ 1) + Enchant button (confirm modal, disabled ở MAX). Toast success / error theo error code. KHÔNG crash khi item không có substat / chưa enchant. i18n VI/EN keys `equipment.upgrade.*` (title, costLabel, reforgeButton, enchantButton, confirm, errors).
- **Tests**: shared `equipment-upgrade.test.ts` (25 tests — config validity, cost positive, slot/range bounds, RNG determinism, compose bonus correctness, element parser, upgradable kind guard); API `equipment.service.test.ts` (20 tests — reforge success/race/insufficient/non-owner, enchant success/level-up/element-lock/max-cap/insufficient/non-owner, equipBonus integration, upgradePreview); web `EquipmentUpgradePanel.test.ts` (13 tests — render section title, empty placeholder, substat row, cost preview, confirm modal flow, reforge/enchant API success + reject, element lock state, MAX state, error state).

#### Known limitations — Phase 15.0.A

- **Element switching**: foundation phase chưa hỗ trợ chuyển hệ enchant. Khi `enchantLevel >= 1` thì element bị lock — request element khác → `ELEMENT_LOCKED`. Future PR (Phase 15.0.B) sẽ thêm "phế hệ" item để reset enchant về null.
- **Protection charm**: reforge luôn overwrite toàn bộ substats. UI chặn bằng confirm modal nhưng player vẫn có thể mất stat tốt vì roll xấu. Future PR có thể thêm "linh phù bảo hộ" (giữ slot tốt nhất) — defer balance review.
- **Main stat reroll**: chỉ reroll substat phụ. Main stat (`ItemDef.bonuses`) vẫn đến từ catalog cố định — design intentional để không phá tier progression.
- **Power cap**: tổng power foundation (substats + enchant) cố ý < +20% baseline tier để không lật meta Arena/PvE. Xem `docs/BALANCE_MODEL.md §15.0.A`.
- **Next task recommendation**: **Phase 15.1–15.2 LiveOps Event Scheduler Core** — cron-driven event window (double drop / discount sect-shop / festival reward) reuse pattern Phase 13 LiveOps trigger.

### Content Scale 2 — High-Realm Skills Pack (this PR)

**Scope**: bổ sung 25 skill cảnh giới cao cho late-game player có power fantasy rõ ràng. Phủ Nhân Tiên / Tiên Giới / Hỗn Nguyên / Vĩnh Hằng + neutral, mỗi tier có đầy đủ 5 hệ Ngũ Hành (Kim/Mộc/Thuỷ/Hoả/Thổ) với role identity riêng. **KHÔNG** rewrite skill system, **KHÔNG** thêm gacha, **KHÔNG** schema/migration mới, **KHÔNG** thay endpoint — reuse pattern Phase 11.

#### Added — Content Scale 2

- **Shared (`packages/shared/src/combat.ts`)**: 25 `SkillDef` mới chia 5 tier × 5 element. Mỗi skill có `key` unique, name/description tiếng Việt, `mpCost` 70-80 (bậc cao), `atkScale` 0.6-4.5 (trong hard cap 5), `cooldownTurns` 0-6, `selfHealRatio` ≤ 0.5, `selfBloodCost` ≤ 0.3, `element` rõ ràng, `unlockRealm` khớp với realm key, `tags` (HEAL/DOT/BURST/SHIELD/CRIT/CONTROL) phù hợp role.
- **Shared (`packages/shared/src/skill-templates.ts`)**: 25 `SkillTemplate` với `tier='master'` (matching pattern Phase 11 ULT — `legendary` reserved cho Hoá Thần+ với evolution branches), `unlocks: [{kind:'realm', ref:<realm_key>}]` enforce realm gating. 25 key thêm vào `TIER_OVERRIDE_ALLOWED` (damage ULT có `atkScale ≥ 3.5` → `inferExpectedTier='legendary'` mismatch là intentional design).
- **Realm coverage**: `nhan_tien` (order 10) × 5, `huyen_tien` (Tiên Giới, order 13) × 5, `thanh_nhan` (Hỗn Nguyên, order 18) × 5, `vo_chung` (Vĩnh Hằng, order 25) × 5, `dao_quan` (special, order 23) × 5.
- **Element coverage**: mỗi tier có đủ 5 hệ Ngũ Hành — Mộc (sustain/heal/poison-cleanse), Hoả (burst/DOT), Thổ (shield/endurance), Kim (crit/armor pierce), Thuỷ (control/recovery/slow).
- **API runtime**: KHÔNG đổi endpoint. Reuse `CharacterSkillService.learn` flow + `validateUnlocks` AND-condition + `realmByKey().order` so sánh — high-realm skill được gate đúng (character chưa đủ realm → `REALM_TOO_LOW`). Idempotent learn (2× call = 1 row, source unchanged).
- **Combat/Arena**: skill mới chạy native qua `resolveCombatWithSnapshot()` deterministic resolver (mulberry32 seeded RNG). Snapshot lexicographic-sort skill keys vẫn ổn định. Arena `buildArenaActorSnapshot` không crash với high-realm character (skillKeys vẫn `['atk_thuong']` placeholder Phase 14.1.B — equipped rotation defer Phase 14.1.C extension).
- **FE (`apps/web/src/views/SkillBookView.vue`)**: thêm panel "Pháp Quyển Cảnh Giới Cao" — render full 25 skill catalog với badge **Khoá / Mở / Đã học** dựa trên `character.realmKey` so với `unlockRealm`. Filter realm (5 tier) + element (Ngũ Hành + neutral). Tooltip "Cần đạt {realm}" khi locked. Không crash khi character thấp realm hoặc null.
- **i18n**: VI/EN parity cho `skillBook.highRealm.*` (title, subtitle, summary, filter, realm name, badge label, lockTooltip).

#### Tests added — Content Scale 2

- Shared: `content-scale-2-skills.test.ts` (16 tests — catalog presence, balance caps, realm/element coverage, role distribution, element identity tags, no one-shot) + `content-scale-2-combat.test.ts` (6 tests — same-seed determinism, hashSeed, snapshot lexicographic sort, both-side high-realm, 100× resolve RNG isolation).
- API: `character-skill.high-realm.service.test.ts` (10 tests — REALM_TOO_LOW reject ở mỗi boundary, happy path mỗi tier, idempotent learn, 20 element-realm coverage probe, getEffectiveSkillFor mastery 0) + `arena-content-scale-2.service.test.ts` (3 tests — createMatch deterministic, mismatch element không crash, snapshot build với high-realm character).
- Web: `SkillBookView.high-realm.test.ts` (9 tests — section render, mỗi tier có card, locked khi realm thấp, unlocked khi realm đủ, learned badge, filter realm, filter element, character null không crash, i18n parity).

#### Known limitations — Content Scale 2

- **Skill book item drop/consume**: defer Phase 11.2.D (item ledger flow). Hiện tại high-realm skill chỉ có thể `learn` qua admin grant hoặc future skill book item.
- **Arena equipped skill rotation**: defer Phase 14.1.C extension. `buildArenaActorSnapshot` vẫn dùng `['atk_thuong']` placeholder (Phase 14.1.B reference resolver). High-realm character đánh Arena vẫn chỉ dùng basic attack — UI catalog chỉ là power-fantasy preview.
- **Drop source automatic**: KHÔNG có monster/boss drop source; KHÔNG có quest reward source. Tất cả learning routes phải đi qua admin grant hoặc skill book item (Phase 11.2.D).

### Phase 14.1.D — Arena Anti-Wintrade Detection

**Scope**: detection-only anti-cheat layer cho Arena. Phát hiện 5 pattern bất thường (đánh qua lại cùng cặp, swap thắng-thua hai chiều, rating gain spike, farm cùng defender, season suspicious actor) → tạo `ArenaWintradeAlert` cho admin review. **KHÔNG** tự ban, **KHÔNG** tự rollback reward, **KHÔNG** xóa ArenaMatch, **KHÔNG** chặn người chơi đánh tiếp khi mới WARN.

#### Added — Phase 14.1.D

- **Shared (`packages/shared/src/arena-anti-wintrade.ts`)**: `ARENA_ANTI_WINTRADE_RULES` config (5 thresholds + critical escalations) + severity ladder `INFO < WARN < CRITICAL` + helpers (`severityForCount`, `arenaWintradeWindowKey`, `arenaWintradePairKey`, `arenaWintradePeriodKey`, `assertArenaAntiWintradeRulesValid`). Threshold conservative để tránh false-positive (ví dụ same-pair WARN ≥ 5 trận / 24h, CRITICAL ≥ 12).
- **Prisma (`apps/api/prisma/schema.prisma`)**: model `ArenaWintradeAlert { id, seasonId?, attackerCharacterId?, defenderCharacterId?, relatedCharacterIdsJson, severity, type, status, windowKey, detailsJson, createdAt, updatedAt @@unique([type, windowKey, attackerCharacterId, defenderCharacterId]) }`. Migration `20260618000000_phase_14_1_d_arena_anti_wintrade`. Không reuse `EconomyAnomaly` để giữ Arena module decoupled khỏi economy framework.
- **API runtime (`apps/api/src/modules/arena/arena-anti-wintrade.service.ts`)**: `ArenaAntiWintradeService` với 5 scan method (`scanRepeatedOpponentPairs`, `scanReciprocalWinLossPattern`, `scanRatingGainSpike`, `scanRewardFarmPattern`, `scanSeasonSuspiciousActors`) + `scanAll()` aggregate + `quickCheckPair()` lightweight cho hook post-match. Idempotent qua UNIQUE constraint + fail-soft try-catch (`P2002` skip → `alertsSkippedDuplicate`). Env override (`ARENA_ANTI_WINTRADE_REPEATED_WARN`, …) cho ops fine-tune.
- **Runtime hook**: `ArenaService.createMatch` chain `quickCheckPair` sau khi commit transaction (fire-and-forget, fail-soft — không lật ngược kết quả nếu scanner throw).
- **Admin API (`apps/api/src/modules/arena-anti-wintrade-admin/arena-anti-wintrade.admin.controller.ts`)** — module riêng để tránh cycle với `AdminModule`. 4 endpoints, tất cả `@RequireAdmin()` (PLAYER + MOD reject 403), POST log `AdminAuditLog`:
  - `POST /admin/arena/anti-wintrade/scan` — chạy full scan, trả `AntiWintradeScanSummary`.
  - `GET /admin/arena/anti-wintrade/alerts?severity&status&type&seasonId&limit` — list alerts.
  - `POST /admin/arena/anti-wintrade/alerts/:id/ack` — `OPEN → ACKNOWLEDGED`.
  - `POST /admin/arena/anti-wintrade/alerts/:id/resolve` — `OPEN | ACKNOWLEDGED → RESOLVED`.
- **Admin FE (`apps/web/src/components/AdminArenaAntiWintradePanel.vue` + tab `arenaAntiWintrade` trong `AdminView.vue`)**: alerts table với filter (severity / status / type) + run-scan button + last-scan summary card + ack/resolve buttons + loading/empty/error states + i18n VI/EN parity.

#### Tests added — Phase 14.1.D

- Shared: `arena-anti-wintrade.test.ts` — 26 tests (rules valid, threshold positive, severity ordering, helper deterministic).
- API: `arena-anti-wintrade.service.test.ts` — 12 tests (5 rule scans + idempotency + normal activity + quickCheckPair + env override).
- API: `arena-anti-wintrade.admin.controller.test.ts` — 9 unit tests (scan + audit + filter + ack/resolve + 404).
- Web: `AdminArenaAntiWintradePanel.test.ts` — 7 tests (empty / render rows / scan / ack / resolve / error / cancel confirm).

#### Known limitations — Phase 14.1.D

1. **Detection only** — không tự ban, không tự rollback. Admin xử lý thủ công qua panel.
2. `SEASON_SUSPICIOUS_ACTOR` hiện scan theo cửa sổ 24h thay vì season-wide — đủ bắt pattern bất thường gần real-time. Full season scope là TODO.
3. Lightweight check trong `createMatch` chỉ chạy 1 rule (`REPEATED_OPPONENT_PAIR`) — full multi-rule scan để admin / cron force.
4. `rewardEligibility` flag (NORMAL / REVIEW_REQUIRED) đã định nghĩa ở shared nhưng chưa wire vào settle reward flow (giữ chính sách "alert trước, xử lý thủ công sau").
5. Cron auto-scan chưa wire (`ARENA_ANTI_WINTRADE_CRON_*` env reserved). Admin force-run qua endpoint là đủ cho launch.

#### Risk / Rollback — Phase 14.1.D

🟡 **Medium**. Migration thêm 1 table mới (additive thuần, không drop / không alter cũ). `quickCheckPair` chạy sau commit (fail-soft, không ảnh hưởng kết quả match). Admin endpoints riêng module → không đụng admin.controller hiện tại. Rollback = revert PR + `DROP TABLE "ArenaWintradeAlert";` (1 statement).

---

### Phase 14.1.C — Arena Season + ELO + Reward (this PR)

**Scope**: mở rộng Phase 14.1.B Async Arena Foundation thành PvP **season system** đầy đủ. Người chơi có Arena Season hiện tại (lazy-create, weekly cadence Asia/Ho_Chi_Minh, Monday 00:00), ELO rating cập nhật mỗi match, leaderboard theo season, reward preview 5 tier (Bronze..Immortal), end-season reward mail, admin endpoint settle (idempotent). Không làm anti-wintrade phức tạp (defer Phase 14.1.D), realtime PvP, cross-server, battle pass, season-end title.

#### Added — Phase 14.1.C

- **Shared Arena Season catalog** (`packages/shared/src/arena-season.ts`):
  - `ARENA_SEASON_CONFIG` — cadence `'weekly'`, timezone `'Asia/Ho_Chi_Minh'`, season key format `arena_<ISO_year>-W<ISO_week>`.
  - `ARENA_ELO_CONFIG` — `K_FACTOR=32`, `BASE_RATING=400`, `DEFENDER_SCALE=0.6`, floor `0`, ceiling `5000`.
  - `ARENA_SEASON_REWARD_TABLE` — 5 tier (BRONZE/SILVER/GOLD/DIAMOND/IMMORTAL) với `linhThach`, `tienNgoc`, `exp`, `items[]`. Modest reward (200..5000 LT) — không phá economy.
  - Tier dictionary `ARENA_RANK_TIERS` — breakpoints `BRONZE 0..999 / SILVER 1000..1199 / GOLD 1200..1499 / DIAMOND 1500..1799 / IMMORTAL 1800+`.
  - Helpers: `arenaCurrentSeasonKey`, `arenaCurrentSeasonRange`, `arenaEloRatingDelta`, `arenaSeasonTierFor`.
- **Prisma models** (`apps/api/prisma/schema.prisma`):
  - `ArenaSeason { id, seasonKey @unique, status: ACTIVE/SETTLED/ARCHIVED, startsAt, endsAt, settledAt? }`.
  - `ArenaStanding { seasonId, characterId, rating, wins, losses, rank?, tier, @@unique([seasonId, characterId]), @@index([seasonId, rating(desc), wins(desc)]) }`.
  - `ArenaSeasonRewardGrant { seasonId, characterId, rank, tier, rewardJson, mailId?, grantedAt, @@unique([seasonId, characterId]) }` — UNIQUE = idempotent settle.
  - Migration `20260617000000_phase_14_1_c_arena_season`.
- **API endpoints**:
  - Player: `GET /arena/season/current`, `GET /arena/leaderboard?seasonKey?&limit?&offset?`, `GET /arena/season/standing?seasonKey?`, `GET /arena/season/rewards?seasonKey?`.
  - Admin (ADMIN guard): `POST /admin/arena/season/settle` body `{ seasonKey? }`, `POST /admin/arena/season/create-next`.
- **ELO runtime hook** — `arena.service.ts` mở rộng match resolve TX để cập nhật `ArenaStanding` của cả attacker + defender. Lazy-create season + standing khi chưa có. Vẫn giữ legacy 14.1.B rating delta (backward compat) — `ArenaProfile.rating` được update bằng cùng ELO delta.
- **Settlement service** (`arena-season.service.ts`):
  - Chốt rank theo `rating DESC, wins DESC, losses ASC, characterId ASC`.
  - Tính tier từ `arenaSeasonTierFor(rating)`.
  - Upsert `ArenaSeasonRewardGrant` (UNIQUE `seasonId+characterId`) — chỉ tạo mail mới khi grant lần đầu.
  - Gửi mail qua `MailService.sendToCharacter` với reward JSON (linhThach/tienNgoc/exp/items).
  - Set `season.status = SETTLED`, `settledAt = now()`.
  - **Idempotent**: gọi `settleSeason` lần 2 → upsert no-op → KHÔNG gửi mail trùng.
- **Frontend**:
  - `ArenaView.vue` thêm 3 panel mới: season banner + my-standing card, leaderboard table, reward preview grid; history rows hiện rating delta.
  - Pinia store thêm 12 state ref + 4 action (`fetchSeason / fetchMyStanding / fetchLeaderboard / fetchRewardPreview`).
  - i18n VI/EN: `arena.season.*`, `arena.leaderboard.*`, `arena.rewardPreview.*`, 4 error fallback codes mới.
- **Tests added: 78** (shared 28 + api 20 + web 30):
  - Shared: ELO at-equal rating, clamp, tier mapping, season range, reward table valid + itemKey exists.
  - API: lazy-create season idempotent, standing lazy create, match auto-update standing, leaderboard order + tiebreak, my-standing rank live, reward preview 5 tier, settle creates mail, double-settle no duplicate, no-participant safe, createNextSeason, admin endpoint reject PLAYER + accept ADMIN.
  - Web: API client query encoding, store action success + error fallback, view loading/error/empty + render seasonKey/status/standing/leaderboard rows/reward tiles/rating delta.

#### Internal — Phase 14.1.C

- `ArenaModule` import `MailModule`; `AdminModule` import `ArenaModule` (avoid reverse cycle).
- `wipeAll(prisma)` extend cleanup cho 3 model mới.
- Optional `ArenaSeasonService` injection vào `ArenaService` (`@Optional()`) — existing test/code paths không cần season.

### Phase 14.1.B — Async Arena Foundation (this PR)

**Scope**: PvP bất đồng bộ — wire `CombatSimulationSnapshot` Phase 14.1.A
vào REST endpoints + UI. Người chơi có Arena Profile (rating mặc định
1000, W/L/D, attacks today), tìm đối thủ, đánh trận PvP async deterministic
qua snapshot+seed, xem lịch sử trận. Không làm season/ELO/reward lớn,
realtime PvP, cross-server, anti-wintrade phức tạp (defer Phase 14.1.C).

#### Added — Phase 14.1.B

- **Shared Arena types & config** (`packages/shared/src/arena.ts`):
  - Enums: `ArenaMatchStatus` (PENDING/RESOLVED/CANCELLED),
    `ArenaMatchOutcome` (ATTACKER_WIN/DEFENDER_WIN/DRAW),
    `ArenaErrorCode` (NO_CHARACTER/DEFENDER_NOT_FOUND/CANNOT_ATTACK_SELF/
    INVALID_INPUT/DAILY_LIMIT_REACHED).
  - Config: `ARENA_RATING_DEFAULT=1000`, floor `0`, ceiling `5000`,
    `ARENA_RATING_WIN_DELTA=10`, `ARENA_RATING_LOSE_DELTA=-5`,
    daily limit default 10 (`Asia/Ho_Chi_Minh`).
  - Types: `ArenaProfileSummary`, `ArenaOpponentSummary`,
    `ArenaMatchResult`, `ArenaBattleLogLine`, `ArenaRatingDelta`.
  - Helpers: `arenaRatingDeltaFor(outcome)`, `clampArenaRating`,
    `arenaDayBucket(now, tz)`, `arenaRankTierFor(rating)` (placeholder
    `'unranked'` Phase 14.1.B; 5 slot reserved cho 14.1.C).

- **Prisma models** (`apps/api/prisma/schema.prisma`):
  - `ArenaProfile { id, characterId @unique, rating @default(1000),
    wins, losses, draws, attacksToday, lastAttackDayBucket,
    defenseSnapshotJson?, createdAt, updatedAt }`.
  - `ArenaMatch { id, attackerCharacterId, defenderCharacterId, status,
    result?, winnerCharacterId?, attackerSnapshotJson, defenderSnapshotJson,
    seed, battleLogJson, ratingDeltaJson?, createdAt, resolvedAt? }`.
  - Indexes: rating + updatedAt + per-side-createdAt + status-createdAt.
  - Migration `20260616000000_phase_14_1_b_arena_foundation`.

- **Arena API endpoints** (`apps/api/src/modules/arena/`):
  - `GET /arena/profile` — lazy-create / return profile.
  - `GET /arena/opponents?limit=N` — rating ±200 + fallback random,
    loại trừ self.
  - `POST /arena/matches` — body `{ defenderCharacterId, seed? }`:
    build snapshot → `resolveCombatWithSnapshot` (Phase 14.1.A) → tx
    update profile + match. Sync trong cùng request.
  - `GET /arena/matches/history?limit=N&side=all|attacker|defender`.
  - Auth + character required. Errors: 401/404/400/429.
  - Env `ARENA_DAILY_LIMIT_PER_DAY` (default 10, 0=unlimited).

- **Arena Frontend** (`apps/web/src/views/ArenaView.vue` + route `/arena`):
  - Profile card: rating + tier + W/L/D + attacks today.
  - Last result banner: outcome (win/lose/draw) + damage summary +
    battle log condensed + dismiss.
  - Opponents list: name + rating + realm/stage + sect + Challenge
    button (disabled khi in-flight).
  - Match history list: outcome highlight + counterpart name + rounds.
  - Loading / empty / error states cho mỗi panel.
  - Pinia store + API client mirrors existing patterns.
  - i18n VI/EN parity (`arena.*` + `common.dismiss` + `apiFallback.arena*`).

- **Tests added: 76**:
  - `packages/shared/src/arena.test.ts` (16): rating delta, clamp,
    day bucket, enum guards, tier placeholder.
  - `apps/api/src/modules/arena/arena.service.test.ts` (19): profile
    lazy-create, opponents excludes self + fallback, match create,
    snapshots/seed/log/delta persistence, **deterministic replay**,
    counters, daily limit, history filter.
  - `apps/web/src/views/__tests__/ArenaView.test.ts` (22): all panels.
  - `apps/web/src/api/__tests__/arena.test.ts` (8): client.
  - `apps/web/src/stores/__tests__/arena.test.ts` (8): store actions.
  - i18n parity: PASS (vi/en arena.* keys).

#### Determinism contract — Phase 14.1.B

Mỗi `ArenaMatch` row chứa `attackerSnapshotJson` + `defenderSnapshotJson`
+ `seed` đầy đủ → load row + call `resolveCombatWithSnapshot` lại bất kỳ
lúc nào → outcome + damage + battle log **bit-exact identical**. Verified
qua test "same snapshots + seed → deterministic result". Defender stat
lock-in tại match-create time → defender breakthrough/equipment change
sau đó KHÔNG ảnh hưởng kết quả.

#### Known limitations — Phase 14.1.B

- **KHÔNG** season cycle, ELO progression, end-season mail reward,
  Hall of Fame.
- **KHÔNG** anti-wintrade phức tạp — chỉ no-self-attack + daily limit.
  Cùng cặp attack lặp lại không có cooldown. IP/device fingerprint chưa
  có. Min-level/realm gate chưa có.
- **KHÔNG** defense AI snapshot khi player offline — Phase 14.1.B dùng
  live stat row tại thời điểm match created.
- **KHÔNG** realtime PvP, cross-server, party arena.
- Defer toàn bộ sang **Phase 14.1.C — Arena Season + ELO + Reward**.

#### Risk / Rollback — Phase 14.1.B

- **Migration risk**: 2 table mới (`ArenaProfile`, `ArenaMatch`), không
  phá schema cũ. Rollback bằng prisma migrate down (drop 2 table) — không
  có dữ liệu live (bảng mới).
- **API risk**: 4 endpoint mới prefix `/arena/*` — không touch endpoint
  cũ. Rollback bằng remove `ArenaModule` khỏi `app.module.ts`.
- **FE risk**: route `/arena` mới + view mới — không touch view cũ.
  Rollback bằng remove route + view + i18n keys.

---

### Phase 14.1.A — Combat Determinism Audit for Arena

**Scope**: chuẩn bị nền cho Arena PvP bất đồng bộ. Audit toàn bộ
combat critical path — đảm bảo cùng `attacker snapshot` + `defender
snapshot` + `seed` → cùng kết quả combat. Không làm Arena match,
leaderboard, ELO hay PvP reward (defer Phase 14.1.B Async Arena
Foundation). Không đổi balance, không rewrite combat system.

#### Added — Phase 14.1.A

- **Shared seeded RNG helper** (`packages/shared/src/combat-rng.ts` mới):
  - `createSeededRng(seed)` — mulberry32 (đồng thuật toán với
    `tribulation-mini-battle.mulberry32` Phase 14.3.E.1).
  - `.next()` / `.nextFloat()` — float `[0, 1)`.
  - `.nextInt(min, max)` — integer inclusive.
  - `.chance(probability)` — bernoulli sample.
  - `.pick<T>(items)` — array pick.
  - `hashSeed(input)` — FNV-1a 32-bit, string → numeric seed (cho
    Arena match UUID hoặc bất kỳ string-based seed).
  - `composeSeed(seed, salt)` — sub-seed cho per-actor / per-round.
  - Stable cross-run + cross-module + không runtime/browser dep.
- **Combat simulation snapshot** (`packages/shared/src/combat-snapshot.ts`
  mới):
  - `CombatActorSnapshot` — `characterId` nullable + `realmKey` +
    `stage` + `baseStats` + `equipmentStats` (+`elementalAtkBonus` per
    element key + `elementalResist` per element key) +
    `skillKeys` + `buffKeys` + `elementalAffinity` +
    `derivedStats`.
  - `CombatSimulationSnapshot` — `attacker` + `defender` + `seed` +
    `context` (`source` ∈ DUNGEON/BOSS/TRIBULATION/ARENA_PREP +
    `regionKey` nullable + `elementContext` nullable).
  - `buildCombatActorSnapshot()` — fill default cho mọi field nullable.
  - `normalizeCombatSnapshot()` — sort `skillKeys`/`buffKeys` ASC để
    serialize stable + freeze immutable.
  - `resolveCombatWithSnapshot(snapshot)` — pure deterministic 1v1
    reference resolver: turn-order theo `speed` + seeded tie-break,
    `elementMultiplier` (ngũ hành), equipment elemental atk bonus,
    elemental resist (đa phần ≤ 1), variance `[0.85, 1.15]`,
    `maxRounds` cap → `winner | 'draw'`. Output `rounds[]`,
    `damageSummary`, `appliedSkillSummary`, `elementMultiplierSummary`,
    echo `seed` + `context` để replay.
- **RNG injection** vào legacy helpers (backward-compat — optional
  `rng` param mặc định `Math.random`):
  - `combat.ts:rollDamage(atk, def, scale, rng?)`.
  - `items.ts:rollLootTable(table, count, rng?)` /
    `rollDungeonLoot(dungeonKey, count?, rng?)` /
    `rollMonsterLoot(monsterKey, count?, rng?)`.
  - `boss.service.ts:pickRandom(arr, rng?)`.
  - Tất cả call site cũ KHÔNG đổi behavior.
- **Determinism tests**:
  - `packages/shared/src/combat-rng.test.ts` — 25 case (sequence
    stability cross-run + cross-module với mulberry32, integer bounds,
    bernoulli, pick, hashSeed deterministic, composeSeed sub-seed).
  - `packages/shared/src/combat-snapshot.test.ts` — 24 case (same
    snapshot+seed → same result, different seed → variance, element
    multiplier, equipment elemental atk bonus, resist, RNG tie-break
    cho equal speed, draw khi `maxRounds`, `buildCombatActorSnapshot`
    default fill, `normalizeCombatSnapshot` sort + immutability).
  - `packages/shared/src/combat-determinism.test.ts` — 15 case
    (rollDamage seeded, rollDungeonLoot/rollMonsterLoot seeded,
    elementMultiplier pure, variance bounds, fallback Math.random).
  - `apps/api/src/modules/combat/combat-determinism.test.ts` — 7 case
    (cùng test ở API runtime context — verify import path
    `@xuantoi/shared` resolve đúng + reference resolver reproducible
    từ API context).

#### Changed — Phase 14.1.A

- `combat.ts:rollDamage` signature thêm optional `rng` param cuối
  (default `Math.random`). JSDoc giải thích Phase 14.1.A RNG injection.
- `items.ts:rollLootTable` (internal) + `rollDungeonLoot` +
  `rollMonsterLoot` signature thêm optional `rng` param cuối.
- `boss.service.ts:pickRandom` signature thêm optional `rng` param.

#### Internal — Phase 14.1.A

- `packages/shared/src/index.ts` export `combat-rng` + `combat-snapshot`
  để consumer ngoài shared (api, web) import được.

#### Verification — Phase 14.1.A

- `pnpm --filter @xuantoi/shared typecheck`: 0 errors.
- `pnpm --filter @xuantoi/shared test -- --run combat`: 116 PASS
  (combat 52 + combat-rng 25 + combat-snapshot 24 + combat-determinism 15).
- `pnpm --filter @xuantoi/shared test -- --run elemental`: 152 PASS.
- `pnpm --filter @xuantoi/api typecheck`: 0 errors.
- `pnpm --filter @xuantoi/api test -- --run combat`: 144 PASS (cần PG
  dev container up).
- `pnpm --filter @xuantoi/api test -- --run boss`: 124 PASS.
- `pnpm --filter @xuantoi/api test -- --run dungeon`: 88 PASS.
- `pnpm --filter @xuantoi/api test -- --run tribulation`: 128 PASS.
- `pnpm --filter @xuantoi/web typecheck`: 0 errors.
- `pnpm build`: OK.

#### Risk / Rollback — Phase 14.1.A

- Risk: thấp 🟢. Tất cả thay đổi optional/additive — không call site
  hiện hữu nào đổi behavior. RNG default vẫn `Math.random`, snapshot
  resolver mới hoàn toàn (chưa wire vào dungeon/boss/tribulation
  service nào — chỉ exported sẵn cho Phase 14.1.B).
- Rollback: revert PR (no migration, no schema change, no env var).

#### Next task — Phase 14.1.A

- **Phase 14.1.B Async Arena Foundation** (Medium PR) — tận dụng
  `CombatSimulationSnapshot` + `resolveCombatWithSnapshot` để wire
  Arena queue + match build (lưu attacker/defender snapshot vào DB),
  điểm/season chỉ làm sau khi resolver wire xong. Sau Phase 14.1.B
  mới đến Phase 14.1.C Arena Match Resolve + Phase 14.1.D Arena
  Leaderboard / ELO.

---

### Phase 14.3.E.2 — Tribulation Mini-Battle Frontend (this PR)

**Scope**: FE wire cho mini-battle Thiên Kiếp — sau khi backend Phase
14.3.E.1 đã ship 4 endpoint state-machine, người chơi có thể tương tác
thực sự với từng phase: chọn 1 trong 5 action mỗi lượt, theo dõi HP /
shield / DOT / focus / phase progress, xem battle log + result modal.
**Không** đụng backend logic; FE thuần orchestrator + render. Khi backend
trả 501 `TRIBULATION_MINI_BATTLE_UNAVAILABLE`, panel ẩn → fallback hoàn
toàn về flow encounter resolve Phase 14.3.D.

#### Added — Phase 14.3.E.2

- **API client (`apps/web/src/api/tribulation.ts`)**: thêm 4 function
  (`fetchCurrentTribulationBattle`, `startTribulationBattle`,
  `submitTribulationBattleAction`, `resolveTribulationBattle`) + view
  types (`TribulationMiniBattleView`, `TribulationMiniBattleStateView`,
  `TribulationBattleActionKey`, `TribulationMiniBattleEffectTypeView`,
  `TribulationBattleEventView`, `TribulationMiniBattleSummaryView`).
- **Pinia store extend (`apps/web/src/stores/tribulation.ts`)**:
  - State: `miniBattle`, `miniBattleLoading`, `miniBattleStarting`,
    `miniBattleActionLoading`, `miniBattleResolving`, `miniBattleError`,
    `miniBattleAvailable`, `miniBattleLastResult`.
  - Computed: `miniBattleCanAct`, `miniBattleIsTerminal`.
  - Actions: `fetchCurrentBattle`, `startBattle`, `submitBattleAction`,
    `resolveBattle`, `resetMiniBattleError`, `clearMiniBattle`.
  - Race-safety: in-flight guard mỗi action; `clientNonce` per submit
    để server idempotent dedupe.
  - Feature flag fallback: 501 `TRIBULATION_MINI_BATTLE_UNAVAILABLE` →
    `miniBattleAvailable=false` (không raise UI error).
- **5 Vue components** (`apps/web/src/components/`):
  - `TribulationMiniBattlePanel.vue` — orchestrator (start / action /
    auto-resolve khi terminal / dismiss modal).
  - `TribulationBattleStatus.vue` — realm/element/effect badge + state
    + phase progress bar + HP/shield/DOT/focus chip.
  - `TribulationBattleActions.vue` — 5 action button + double-click
    guard + per-action tooltip hint.
  - `TribulationBattleLog.vue` — event log render (damage/shield/heal/
    DOT/crit chip + i18n message lookup).
  - `TribulationBattleResultModal.vue` — win/lose modal + CTA
    "Quay lại tu luyện" / "Thử lại" / Esc-to-close.
- **TribulationView integration** (`apps/web/src/views/TribulationView.vue`):
  - Conditional render: `miniBattlePanelVisible` chỉ true khi
    `miniBattleAvailable === true` + `atPeak` + có encounter.
  - Backward compat: `miniBattleAvailable === null` (initial) hoặc
    `false` (501) → giữ nguyên encounter resolve UI Phase 14.3.D.
  - `onMounted` gọi `fetchCurrentBattle` để hydrate snapshot.
  - Handlers: `onMiniBattleErrored` (toast i18n), `onMiniBattleReturnCultivation`
    (refetch state/history/preview/encounter rồi `router.push('/cultivation')`).
- **i18n VI/EN parity**: thêm namespace `tribulation.miniBattle.*` với
  ~70 key (title/subtitle, action labels + short + hints, state labels,
  log labels + 11 message keys, result modal labels + 3 CTAs, 5
  effect-type hint) + 7 error code mới (`MINI_BATTLE_DISABLED`,
  `MINI_BATTLE_NOT_FOUND`, `MINI_BATTLE_ALREADY_ACTIVE`,
  `MINI_BATTLE_TERMINAL`, `MINI_BATTLE_NOT_TERMINAL`,
  `MINI_BATTLE_INVALID_ACTION`, `TRIBULATION_MINI_BATTLE_UNAVAILABLE`).

#### Tests added — Phase 14.3.E.2

- `apps/web/src/api/__tests__/tribulation.test.ts` — 11 mini-battle
  endpoint test (current null/snapshot/501, start with/without support
  + 409 ALREADY_ACTIVE, action with/without nonce + 400 INVALID,
  resolve success + 400 NOT_TERMINAL).
- `apps/web/src/stores/__tests__/tribulation.test.ts` — 15 store
  action test (in-flight guard, terminal short-circuit,
  fetchCurrentBattle 501 fallback, error/reset/clear).
- `apps/web/src/components/__tests__/TribulationMiniBattlePanel.test.ts`
  — 11 component test (no battle / start / active / action / loading
  disable / log / win modal / lose modal / API error / fallback / i18n
  parity).
- `apps/web/src/views/__tests__/TribulationView.test.ts` — 4 view
  integration test cho gate (`miniBattleAvailable=null/true/false` +
  onMounted hydrate).
- i18n parity test (existing) — pass cho 70+ key mới.

#### Internal — Phase 14.3.E.2

- Total: ~1900 LOC FE code thêm + ~1260 LOC test.
- 1656/1656 web test pass; web typecheck + api typecheck + monorepo
  build green.
- Server-authoritative: FE không simulate logic; mỗi action POST →
  server trả snapshot; FE chỉ render + relay clientNonce.
- Type-safe: shared `view` types (qua `apps/web/src/api/tribulation.ts`)
  thay vì re-import shared package types để giữ FE bundle gọn.

---

### Phase 14.3.E.1 — Tribulation Mini-Battle Backend

**Scope**: backend mini-battle cho Thiên Kiếp — biến `attempt → resolve` từ
RNG snapshot thành state machine có phase/turn, 5 effectType khác biệt rõ
ràng, event log, idempotency, race-safety. **Không** đụng FE (deferred Phase
14.3.E.2). Bật/tắt bằng feature flag `TRIBULATION_MINI_BATTLE_ENABLED` —
default OFF, flow legacy Phase 14.3.D vẫn nguyên.

#### Added — Phase 14.3.E.1

- **Shared catalog** (`packages/shared/src/tribulation-mini-battle.ts` 980
  LOC):
  - Enums: `TribulationMiniBattleState` (PENDING/ACTIVE/RESOLVED/FAILED/
    EXPIRED), `TribulationBattleAction` (ATTACK/DEFEND/FOCUS/CLEANSE/
    CHANNEL), `TribulationMiniBattleEffectType` (BURST/SUSTAIN/
    POISON_RECOVERY/ARMOR_CRIT/DEFENSE_ENDURANCE).
  - Pure helpers: `computeTribulationPhaseResult`, `applyTribulationEffectType`,
    `validateTribulationBattleAction`, `summarizeTribulationBattleResult`,
    `makeInitialMiniBattleSnapshot`, `computeTribulationBattlePower`.
  - Deterministic seeded RNG `mulberry32` + `composeBattlePhaseSeed`
    (KHÔNG dùng `Math.random` trong core calc).
  - Anti-cheat caps: `HP_MAX=100k`, `DAMAGE_MAX=50k`, `HEAL_MAX=50k`,
    `SHIELD_MAX=50k`, `DOT_STACKS_MAX=20`.
- **API endpoints** dưới `/character/tribulation/battle`:
  - `GET /current` — return active battle (or null).
  - `POST /start` — body `{selectedSupportItemKeys?: string[]}`.
  - `POST /action` — body `{battleId, action, clientNonce?}` (action ∈
    ATTACK/DEFEND/FOCUS/CLEANSE/CHANNEL). Idempotent re-call cùng
    `clientNonce`.
  - `POST /resolve` — body `{battleId}`. Idempotent re-call.
- **API service** `tribulation-mini-battle.service.ts` — wire vào
  `CharacterController` qua `CharacterModule`.
- **TribulationService extend**: `runAttemptInTxWithForcedOutcome(tx, ..., outcome)`
  — wrapper public của `runAttemptInTx` với `simOverride={success, finalHp}`,
  reuse pipeline realm advance + reward + consume support + penalty 1:1
  với `attemptTribulation`.
- **Prisma model** `TribulationMiniBattle` (`id/characterId/encounterId/
  tribulationKey/realmKey/effectType/element/difficulty/state/currentPhase/
  phaseCount/playerHp[Max]/tribulationHp[Max]/shield/dotStacks/focusCharge/
  seed/actionLogJson/resultJson/lastClientNonce/startedAt/resolvedAt/
  createdAt/updatedAt`) + 3 index `@@index([characterId, state])` /
  `(characterId, startedAt)` / `(encounterId)` + Character relation Cascade.
- **Migration** `20260615000000_phase_14_3_e_1_tribulation_mini_battle`.
- **Feature flag** `TRIBULATION_MINI_BATTLE_ENABLED` (default OFF).
  Disabled → 4 endpoint trả 501 `MINI_BATTLE_DISABLED` cho FE fallback
  flow Phase 14.3.D.
- **Metrics** singleton `MINI_BATTLE_METRICS{started,resolved,failed}`
  (mirror Phase 17.5 request-metrics middleware pattern), read-only export
  `readTribulationMiniBattleMetrics()`. Logger structured:
  `tribulation_battle_started/resolved/failed` battleId+characterId+
  realmKey+result.

#### Idempotency / race-safety — Phase 14.3.E.1

- **start**: tx-level `findFirst({state in [PENDING, ACTIVE]})` guard →
  tránh tạo 2 battle cùng lúc. Reuse encounter row Phase 14.3.D nếu pending
  cùng `tribulationKey`.
- **action**: optimistic `updateMany({where: {id, state, currentPhase}})`
  — concurrent caller advance phase → `count=0` → throw
  `MINI_BATTLE_INVALID_ACTION`. `clientNonce` dedupe identical re-call.
- **resolve**: `resultJson.attemptLogId` đóng vai trò "applied marker" —
  2nd resolve reconstruct outcome từ `TribulationAttemptLog` row sẵn có.
  KHÔNG double reward / KHÔNG double consume support / KHÔNG double
  realm-advance.

#### Tests — Phase 14.3.E.1

- **Shared** (`packages/shared/src/tribulation-mini-battle.test.ts`):
  41 tests — RNG determinism cùng seed, 5 effectType mechanics
  (BURST crit scale, SUSTAIN heal, POISON DOT cap, ARMOR pierce,
  DEFENSE_ENDURANCE shield+heal), caps enforcement, state machine terminal
  block, phase overflow, power ratio.
- **API integration**
  (`apps/api/src/modules/character/tribulation-mini-battle.service.test.ts`):
  23 tests — feature flag enabled/disabled fallback, start guards
  (NOT_AT_PEAK/ALREADY_ACTIVE/CHARACTER_NOT_FOUND), getCurrent null/active,
  action validation (NOT_FOUND/INVALID_ACTION) + clientNonce idempotent +
  terminal block, resolve (NOT_TERMINAL/NOT_FOUND/win path realm advance/
  lose path cooldown/idempotent re-resolve), effectType wiring.
- **Total**: 64 tests mới, 0 regression (existing 105 tribulation API tests
  + 161 shared tribulation tests vẫn pass).
- `wipeAll()` thêm `prisma.tribulationMiniBattle.deleteMany({})` cho test
  cleanup.

### Phase 17.5 — Metrics + Load Test Baseline (PR #502)

**Scope**: chuẩn bị closed beta. Endpoint metrics admin-only + 5 collector
fail-soft (system / api / ws / queue / cron) + k6 load test scaffold (smoke /
api baseline / ws baseline) + docs threshold gợi ý closed beta. **Không**
chạy load test nặng trong CI, **không** expose metrics public.

#### Added — Phase 17.5

- **API endpoint**: `GET /api/admin/metrics` (`MetricsController` —
  `@UseGuards(AdminGuard)` + `@RequireAdmin()`). Trả JSON snapshot
  shape `MetricsSnapshot` (schema=1) gồm system / api / ws / queue /
  cron + `errors[]` fail-soft. PLAYER + MOD đều bị reject 403.
- **API service** (`apps/api/src/modules/metrics/metrics.service.ts`):
  - `collectSystemMetrics()` — uptime, memory (rss/heap), cpu user+sys,
    pid, appVersion, node version/platform.
  - `collectApiMetrics()` — singleton in-memory snapshot từ
    `request-metrics.middleware` (totalRequests, totalDurationMs,
    avgDurationMs, byMethod, byStatusBucket, inFlight). Bounded set
    method/status — **không** track per-path để tránh memory leak.
  - `collectWsMetrics()` — `RealtimeService.countOnline()` + serverBound.
  - `collectQueueMetrics()` — BullMQ key (`bull:<queue>:wait/active/
    delayed/completed/failed`) qua Redis `llen` / `zcard` cho 7 queue:
    cultivation, ops, mission-reset, territory-cron, sect-season-cron,
    ledger-checker-cron, anomaly-scanner-cron. Fail-soft: Redis down →
    `available=false`.
  - `collectCronMetrics()` — last-run state qua Prisma `findFirst` cho
    4 model: EconomyLedgerCheckRun, SectTerritorySettlementSnapshot,
    SectTerritoryDecayLog, SectSeasonSnapshot. Mỗi job query
    independent — 1 fail không block job khác.
  - `collectAll()` aggregate: gom errors stage thành `errors[]`,
    KHÔNG throw 500.
- **Request middleware** (`request-metrics.middleware.ts`): singleton
  counter cập nhật `res.on('finish'|'close')`; idempotent record;
  skip default `/api/healthz`, `/api/readyz`, `/api/admin/metrics`.
  Wire trong `main.ts` SAU request-logger.
- **Load test scripts** (`scripts/load/`):
  - `k6-smoke.js` — 1 VU × 10s health/readyz/version.
  - `k6-api-baseline.js` — 3 VUs × 30s full flow login → state →
    daily-login → mission → dungeon → territory.
  - `k6-ws-baseline.js` — 5 VUs × 20s engine.io v4 raw WebSocket
    connect/wait-frame/disconnect.
  - `README.md` — hướng dẫn chạy + threshold closed beta gợi ý.
- **Package scripts**: `load:smoke` / `load:api` / `load:ws`
  (delegate `k6 run`).

#### Security — Phase 17.5

- Payload `/admin/metrics` chỉ chứa số / boolean / string ngắn —
  KHÔNG có env / cookie / token / userId / characterId / email / PII.
  Test scan substring `cookie/password/jwt/refreshToken/userId/
  characterId/email`.
- KHÔNG audit log endpoint metrics (poll cao tần — sẽ ngập DB).
- k6 script không hardcode token — env-only (`AUTH_TOKEN`,
  `TEST_EMAIL`, `TEST_PASSWORD`). README cảnh báo không chạy
  production khi chưa có phép.

#### Tests — Phase 17.5

31 test mới (`apps/api/src/modules/metrics/`):
- `metrics.service.test.ts` (11) — pure-unit mock collector.
- `metrics.controller.test.ts` (3) — bypass guard, security scan.
- `metrics.service.integration.test.ts` (6) — real Redis/Prisma
  contract: BullMQ key prefix, cron last-run, end-to-end collectAll.
- `request-metrics.middleware.test.ts` (11) — singleton counter,
  bucket method/status, inFlight, skip prefix, reset.

#### Docs — Phase 17.5

- `docs/API.md` thêm section Metrics endpoint.
- `docs/DEPLOY.md` thêm env vars load test.
- `docs/RUNBOOK.md` thêm cách chạy k6 + đọc kết quả + threshold.
- `docs/CHANGELOG.md` (file này) entry Phase 17.5.
- `docs/AI_HANDOFF_REPORT.md` Recent Changes + Executive Summary.
- `scripts/load/README.md` (mới) chi tiết script + env + threshold.

### Phase 16.6 — Economy Anti-cheat Suite (this PR)

**Scope**: anti-cheat layer chuẩn bị closed beta — daily auto invariant
ledger check + windowed economy anomaly scan + market price band enforcement
+ admin grant alert hook + admin FE Economy Safety panel. **Detection +
reporting only** — KHÔNG auto-ban, KHÔNG rollback, KHÔNG public notify.

#### Added — Phase 16.6 Economy Anti-cheat Suite

- **Shared (`packages/shared/src/economy-anomaly.ts` + `market-price-band.ts`)**:
  catalog `ECONOMY_ANOMALY_RULES` (5 source × WARN/CRITICAL threshold),
  enums `EconomyAnomalySeverity` / `EconomyAnomalySource` /
  `EconomyIssueStatus`, helpers `getEconomyAnomalyRule`,
  `isEconomyAnomalySource`, `isEconomyAnomalySeverity`, `compareSeverity`,
  `deriveSeverityForValue`, plus market band catalog
  `DEFAULT_PRICE_BAND_BY_QUALITY` + `MARKET_PRICE_BAND_BY_ITEM` overrides
  + helper `getMarketPriceBandForItem(itemKey)` + `checkListingPriceBand`.
- **Prisma models** (migration
  `20260614000000_phase_16_6_economy_anti_cheat`):
  `EconomyLedgerCheckRun` (UNIQUE `dayBucket`), `EconomyLedgerCheckIssue`
  (FK runId, severity/type/status), `EconomyAnomaly`
  (`@@unique([source, characterId, windowKey])` race-safe).
- **API** — `LedgerCheckerService` (5 invariant checks: currency
  consistency, item consistency, reward-cap consistency, negative
  balances, suspicious 24h delta) + `EconomyAnomalyScannerService`
  (scanTopCurrencyDelta24h / scanRareItemGain / scanRewardCapBypass /
  scanMarketOutlier + real-time hook `scanAdminGrantOverLimit`).
- **API endpoints** (`/admin/economy/...`) — 8 admin route gắn
  `@RequireAdmin()` cho run/list/ack/resolve issue + anomaly. Audit
  `ADMIN_ECONOMY_*` action codes. Idempotent qua DB UNIQUE.
- **API cron** (`apps/api/src/modules/admin-economy-safety/`) —
  `EconomyAnticheatCronScheduler` BullMQ register Ledger Checker (default
  01:00 UTC) + Anomaly Scanner (default 02:00 UTC). **Default disabled**;
  bật qua env `LEDGER_CHECKER_CRON_ENABLED=true` /
  `ECONOMY_ANOMALY_CRON_ENABLED=true`.
- **API hook** — `AdminService.grantCurrency` gọi
  `scanAdminGrantOverLimit` khi delta vượt warn/critical threshold;
  fail-soft (không block grant).
- **API market** — `MarketService.postListing` enforce
  `getMarketPriceBandForItem(itemKey)` band, reject với code
  `PRICE_TOO_LOW` / `PRICE_TOO_HIGH` (HTTP 409). Existing ACTIVE
  listings KHÔNG mutate.
- **Web** — `AdminEconomySafetyPanel.vue` tab mới trong AdminView (chỉ
  ADMIN, role-gated): xem latest run, list issues + anomalies với filter
  severity/status/source, button Run / Scan / Ack / Resolve, gọi qua
  `apps/web/src/api/admin.ts`. `MarketView.vue` thêm
  `[data-testid="market-price-band-hint"]` hiển thị suggested
  min/max khi user chọn item bán; toast lỗi `PRICE_TOO_LOW` /
  `PRICE_TOO_HIGH` từ i18n.
- **Tests added** — shared 27 (economy-anomaly 15 + market-price-band 12);
  api 75+ (ledger checker 4 + economy anomaly scanner 6 + market price
  band integration + admin economy safety controller 14); web 6
  (AdminEconomySafetyPanel 4 + MarketView price band 2).
- **Env vars** — `LEDGER_CHECKER_CRON_ENABLED`,
  `LEDGER_CHECKER_CRON_SCHEDULE` (`0 1 * * *`),
  `ECONOMY_ANOMALY_CRON_ENABLED`, `ECONOMY_ANOMALY_CRON_SCHEDULE`
  (`0 2 * * *`), `ECONOMY_ANTICHEAT_CRON_TZ` (`UTC`). Xem `DEPLOY.md`.

#### Policy

- **KHÔNG auto-ban user** — anomaly chỉ tạo entry trong DB. Admin xem
  panel + quyết định.
- **KHÔNG auto-rollback / sửa data** — issue/anomaly không có endpoint
  fix. Admin dùng endpoint khác (revoke inventory / refund / ban) đã có.
- **KHÔNG public notification** — anomaly không gửi mail / chat / WS
  cho người chơi. Chỉ ghi DB + admin panel.
- **Idempotent cron** — gọi lại cùng `dayBucket` / `windowKey` không
  tạo issue/anomaly trùng (qua DB UNIQUE constraint, P2002 swallow).
- **Default cron disabled** — production opt-in, local/test KHÔNG auto
  register cron job.

#### Known limitations

- Anomaly threshold tunings (`adminGrantWarnThreshold`,
  `adminGrantCriticalThreshold`, etc.) là conservative initial values —
  cần observe data closed beta để re-tune.
- Per-item market price band overrides (`MARKET_PRICE_BAND_BY_ITEM`)
  chưa fill — fallback rarity band cho mọi item. Sẽ thêm specific items
  sau khi observe market trade pattern.
- Không có cron lease lock — nếu deploy multi-node + cùng bật cron,
  sẽ rely on DB UNIQUE để dedupe (không đẹp như liveops-cron lease
  pattern). Acceptable: cron daily, không hot-loop.

#### Risk / rollback

- Migration là additive (3 model mới + 1 column). Rollback an toàn
  qua `prisma migrate resolve --rolled-back`. Không drop existing data.
- Market price band reject là behavior mới; nếu band quá strict, listing
  user post bị fail. Mitigation: rarity band đã set rộng (PHAM 10–1000,
  THAN 5000–5_000_000 LT/unit). Có thể disable bằng cách comment out
  `checkListingPriceBand` ở `market.service.ts` (1 line revert).
- Cron disabled by default — bật cũng chỉ tạo entry DB, không mutate
  ledger/inventory.

#### Next task recommendation

- **Phase 17.5 Metrics + Load Test Baseline** — closed beta cần
  Prometheus/StatsD metric export + load test baseline để biết server
  endure bao nhiêu concurrent player. Anti-cheat data từ Phase 16.6
  có thể feed thẳng vào dashboard.
- **Phase 14.3.E Tribulation Mini-Battle Backend** — Phase 14.3.D đã
  có encounter foundation, cần backend mini-battle thực thi tribulation
  combat (HP / skill / phase).

### Phase Audit-1 — Post-5 Integration Regression Audit (PR #500)

**Scope**: KHÔNG thêm gameplay mới. Audit + sửa bug nhỏ + đồng bộ docs để đảm
bảo 5 chức năng vừa merge (Phase 14.0.E territory reward mail / Phase 13.2.D +
14.0.F territory + sect-season cron / Phase 16.5 daily reward cap / Phase 17.3
Sentry+Pino / Phase 17.4 backup-restore + RUNBOOK) không tạo lỗi ngầm: không
double reward, không double mail, không double cron, không lệch docs/API,
không crash FE, không phá economy, không log secret, không có script
backup/restore nguy hiểm.

#### Fixed

- `apps/api/src/test-helpers.ts` — `wipeAll()` thiếu
  `prisma.sectTerritoryDecayLog.deleteMany({})`. Trước fix:
  `liveops-cron.service.test.ts > settle previous period → decay → grant
  reward mail trong 1 cycle` flake (decay log từ run trước làm
  `decaySkipped=true`). Sau fix: chạy isolated 100% pass.
- `docs/API.md` + `docs/CHANGELOG.md` (PR #496 entry) + `docs/LIVE_OPS_MODEL.md`
  ghi sai audit action codes — cron territory/sect-season actually ghi
  `ADMIN_TERRITORY_CRON_RUN` / `ADMIN_SECT_SEASON_CRON_RUN` (xem
  `apps/api/src/modules/liveops-cron/admin-liveops-cron.controller.ts`),
  KHÔNG phải `ADMIN_LIVEOPS_TERRITORY_CRON_RUN` /
  `ADMIN_LIVEOPS_SECT_SEASON_CRON_RUN` như docs ghi. BI/SIEM filter theo
  string sẽ miss audit row → fix docs cho đúng.

#### Docs

- `docs/DEPLOY.md`: bổ sung 3 env var đã có ở `apps/api/.env.example` nhưng
  bảng DEPLOY chưa list — `MISSION_RESET_TZ` (default `Asia/Ho_Chi_Minh` cho
  daily/weekly mission reset), `DAILY_REWARD_CAP_TZ` (default
  `Asia/Ho_Chi_Minh` cho `dayBucket` reset của Phase 16.5), `MARKET_FEE_PCT`
  (default 0.05, range `[0, 0.5]`).
- `docs/AI_HANDOFF_REPORT.md`: prepend Recent Changes entry cho PR audit này
  (drop 3 entry oldest #480/#481/#482 để giữ cap 10 entries).

#### Tests

- `apps/api/src/modules/liveops-cron/admin-liveops-cron.controller.test.ts`:
  +3 audit-codes contract tests lock action string vào audit log
  (`runWeeklyCycle` → `ADMIN_LIVEOPS_RUN_WEEKLY_CYCLE`, `runTerritoryNow` →
  `ADMIN_TERRITORY_CRON_RUN`, `runSectSeasonNow` → `ADMIN_SECT_SEASON_CRON_RUN`).
  Test catch docs lệch sớm thay vì để escape vào production audit log.

#### Verified

- typecheck shared / api / web — all green.
- test shared 2006 / api 2648 / web 1609 — all green.
- `bash -n scripts/backup-db.sh` / `bash -n scripts/restore-db.sh` /
  `bash -n scripts/verify-restore.sh` — all green.
- `pnpm build` — all packages built.

#### Audit findings (no code change required)

- **Phase 14.0.E Territory Reward Mail**: idempotent qua UNIQUE
  `(periodKey, regionKey, characterId)` ở `TerritoryOwnerRewardGrant`,
  `dryRun=true` no-op (KHÔNG insert grant row, KHÔNG tạo mail), admin-only
  qua `@RequireAdmin()` ở `admin-territory.controller.ts`. Test
  `territory-reward.service.test.ts` 13 case passed.
- **Phase 13.2.D + 14.0.F Cron**: settle → decay → reward fail-soft (errors[]
  KHÔNG block stage còn lại), Redis lease optimistic + DB UNIQUE final
  barrier, bypassLease admin-only. `TERRITORY_CRON_ENABLED` /
  `SECT_SEASON_CRON_ENABLED` default `false` ở local/test.
- **Phase 16.5 Daily Reward Cap**: wire 3 nguồn (cultivation / dungeon /
  mission), race-safe qua Postgres `INSERT ... ON CONFLICT DO UPDATE`
  (atomic row-lock), ledger ghi grant THỰC. Day bucket reset
  `DAILY_REWARD_CAP_TZ` (default `Asia/Ho_Chi_Minh`). FE optional chaining
  bảo đảm pre-16.5 không crash.
- **Phase 17.3 Sentry + Pino**: disabled-safe khi thiếu DSN
  (`enabledFlag` guards mọi capture* call), redaction bao toàn bộ secret
  fields theo task spec (authorization / cookie / password / token /
  refreshToken / accessToken / apiKey / secret / set-cookie / x-api-key /
  session / creditCard / cardNumber / cvv).
- **Phase 17.4 Backup/Restore + RUNBOOK**: 3 script pass `bash -n`,
  restore CHẶN production (`NODE_ENV=production` + thiếu
  `ALLOW_PRODUCTION_RESTORE=YES` → exit 9), confirm gate (`CONFIRM_RESTORE=YES`
  / `ASSUME_YES=1`), không leak password trong stderr (mask `***`).
  RUNBOOK 8+ playbook (Postgres down, Redis down, WebSocket realtime, cron
  double-run, reward mail double-send, player currency loss, backup/restore,
  deploy rollback).

#### Rollback

PR audit-only (1 fix `wipeAll`, +3 contract tests, +3 docs entry/env var) —
KHÔNG migration, KHÔNG runtime change. Revert PR là rollback hoàn toàn.

#### Next task

Phase 16.6.A Ledger Checker Cron — periodic job verify
`CurrencyLedger`/`ItemLedger` invariant không có row mồ côi / amount mismatch
(catch silent corruption từ logic bug hoặc concurrent retry chưa đúng).

### Added — Phase 16.5 Daily Reward Cap (this PR)

- **`packages/shared/src/daily-reward-cap.ts`**: catalog
  `DAILY_REWARD_CAP_BY_REALM_AND_SOURCE` (`expCap` + `linhThachCap` per realm
  per source — `CULTIVATION` / `DUNGEON` / `MISSION`), helper
  `dailyRewardCapFor(realmKey, source)`, type-guard `isRewardSource`, pure
  decision math `computeCapDecision(accum, cap, requested)`. Cap scale theo
  realm tier (phamnhan/luyenkhi/truc_co ×1, kim_dan/nguyen_anh/hoa_than ×3,
  luyen_hu+ ×8). Invariant test cap tăng dần theo realm order.
- **Prisma model `CharacterDailyRewardBucket`** (per-character, per-day,
  per-source accum của EXP + linhThạch — UNIQUE
  `(characterId, dayBucket, source)`) + **`RewardCapEvent`** (audit log chỉ
  ghi khi `wasCapped=true` để giữ table sạch). Migration
  `20260613000000_phase_16_5_daily_reward_cap`.
- **`apps/api/src/modules/economy/reward-cap.service.ts`**: service
  `RewardCapService.applyCapTx(tx, input)` — gọi INSIDE 1 `$transaction`
  của caller, race-safe qua Postgres `INSERT ... ON CONFLICT DO UPDATE`
  (atomic row-lock acquisition — không cần CAS retry, không livelock dưới
  high contention). Trả `{ grantedExp, grantedLinhThach, cappedExp,
  cappedLinhThach, wasCapped, remainingExp, remainingLinhThach, dayBucket }`.
  Audit log auto-insert nếu `wasCapped=true`. Day bucket reset Asia/Ho_Chi_Minh
  (override env `DAILY_REWARD_CAP_TZ`).
- **Wire vào 3 nguồn reward chính**:
  - `MissionService.claim` — gọi `applyCapTx` trước currency grant + ledger
    ghi `delta = cap.grantedLinhThach` (KHÔNG ghi requested). Trả
    `MissionClaimResult` với `{ capped, cappedAmount?, dailyCapRemaining }`.
  - `DungeonRunService.claimRun` — tương tự; `DungeonClaimResult` thêm
    `{ capped, cappedAmount?, dailyCapRemaining }`.
  - `CultivationProcessor.process` (tick) — wrap cap apply + character CAS
    update trong 1 `$transaction`. Tick KHÔNG grant linhThach (chỉ EXP) →
    `requestedLinhThach=0n`; outcome 'capped'/'cas_miss' → skip side effects
    (mission track, realtime emit) để không double-count.
- **API tests** (`reward-cap.service.test.ts`, 17 tests): under-cap, over-cap,
  exhausted, multiple grants accumulate, per-source isolation, day bucket
  reset, higher realm cap, audit log granted/capped đúng (KHÔNG ghi
  requested), 5 concurrent grants không vượt cap, negative coerce → 0n,
  zero request không tạo bucket dư, `getDailyRewardCapTz` env override,
  `dayBucketFor` Asia/Ho_Chi_Minh boundary 17:00 UTC.
- **FE graceful toast** (`MissionView.vue`, `DungeonRunView.vue`): khi
  `claim.capped=true` push toast `info` "Hôm nay bạn đã đạt giới hạn nhận
  thưởng nguồn này." — optional chaining bảo đảm pre-16.5 server (server
  chưa update) KHÔNG crash FE. Cấu trúc `claimMission` API contract đổi
  từ `Promise<MissionProgressView[]>` → `Promise<{ missions, claim? }>`.
- **Env `apps/api/.env.example`**: thêm `DAILY_REWARD_CAP_TZ=Asia/Ho_Chi_Minh`
  (override timezone cho dev/test reproducible).
- **Anti-abuse**: vì cap PER SOURCE, người chơi farm 1 nguồn không ăn vào
  nguồn khác (vd hết DUNGEON cap thì MISSION vẫn full). Cap exp tier-1
  (CULTIVATION 6000, DUNGEON 2400, MISSION 1500) đủ cho ~4–6 hour casual
  play / day, không gây retention loss.
- **KHÔNG cap admin grant** (admin path không gọi `applyCapTx`). Audit
  trong `docs/ECONOMY_MODEL.md`. KHÔNG làm anomaly scanner / market price
  band / admin alert (out of scope, follow-up Phase 16.6+).

### Added — Phase 17.4 Backup/Restore Automation + RUNBOOK (this PR)

- **`scripts/backup-db.sh` Phase 17.4 update**: filename
  `xuantoi-<YYYYMMDD-HHMMSS>.sql.gz`, `BACKUP_RETENTION_DAYS` auto-prune
  glob `xuantoi-*.sql.gz` cũ hơn N ngày sau backup thành công, `DRY_RUN=1`
  in plan không chạy `pg_dump`, mask password trong stdout, fail-fast khi
  thiếu env / thiếu tooling. Exit codes 0/2/3/4/5 cho từng failure mode.
- **`scripts/restore-db.sh` Phase 17.4 update**: gate `CONFIRM_RESTORE=YES`
  (alias legacy `ASSUME_YES=1` vẫn còn), production guard
  `ALLOW_PRODUCTION_RESTORE=YES` ép phải set tường minh khi
  `NODE_ENV=production` (mặc định CHẶN với exit 9), optional
  `RUN_PRISMA_MIGRATE=1` chạy `prisma migrate deploy` ngay sau restore,
  terminate active sessions trước DROP DATABASE, validate gzip integrity
  trước khi destructive operation.
- **`scripts/verify-restore.sh` MỚI**: connect probe `SELECT 1`, kiểm
  schema có ≥ 21 table public, count critical tables (`User`, `Character`,
  `Sect`, `CurrencyLedger`, `ItemLedger`, `InventoryItem`, `Mail`,
  `TopupOrder`, `AdminAuditLog`, `_prisma_migrations`), latest applied
  prisma migration, optional API healthcheck via `API_HEALTHCHECK_URL`.
  `STRICT=1` ép fail nếu `User`/`Character` rỗng (DB rỗng sau restore).
- **`docs/RUNBOOK.md` MỚI**: incident severity ladder P0–P3, playbook
  Postgres down / Redis down / WS không realtime / cron chạy trùng /
  reward mail trùng / player mất currency / topup lỗi / JWT secret leak /
  deploy rollback / backup restore disaster recovery / contact escalation.
  Cron daily backup mẫu (`BACKUP_RETENTION_DAYS=7`), production restore
  procedure với sign-off + maintenance window. KHÔNG đưa secret/DSN thật.
- **Tests**: `apps/api/scripts/ops-scripts.test.ts` MỚI — bash-n syntax
  check + restore-db production guard + missing-arg + non-existent file +
  password mask + DRY_RUN backup + naming pattern guard + RUNBOOK.md
  presence + npm script presence (15 case).
- **Docs**: `apps/api/.env.example` thêm `BACKUP_DIR` /
  `BACKUP_RETENTION_DAYS` / `CONFIRM_RESTORE` / `ALLOW_PRODUCTION_RESTORE`
  / `RUN_PRISMA_MIGRATE` placeholder. `docs/DEPLOY.md` §9.1 bảng env mới.
  `docs/BACKUP_RESTORE.md` sync naming + new flags + verify section.
  `docs/TROUBLESHOOTING.md` cross-link RUNBOOK ở header. `docs/CHANGELOG.md`
  + `docs/AI_HANDOFF_REPORT.md` sync.
- **npm scripts root**: `verify:restore` mới (`backup:db` / `restore:db`
  đã có từ trước).

### Added — Phase 17.3 Sentry + Pino Structured Logs

- **Backend Sentry error tracking** (`@sentry/node`). Disabled mặc định;
  bật qua `SENTRY_ENABLED=true` + `SENTRY_DSN_API`. Capture unhandled
  exceptions trong `AllExceptionsFilter` (chỉ 5xx + non-Http error).
  Tag `requestId` + user context. `sendDefaultPii: false` —
  KHÔNG gửi IP/cookie/header.
- **Frontend Sentry Vue** (`@sentry/vue`). Disabled mặc định; bật qua
  `VITE_SENTRY_ENABLED=true` + `VITE_SENTRY_DSN_WEB`. Init sau
  `createApp` + trước `mount`. Router integration optional cho
  performance traces.
- **Pino structured logs** + adapter `PinoNestLogger` route mọi
  `Logger` call của NestJS xuống Pino. JSON 1-line/event ra stdout.
  Schema có `service`, `env`, `requestId`, `method`, `path`,
  `statusCode`, `durationMs`, `userId`, `characterId`, `msg`.
- **Request middleware** `createRequestLoggerMiddleware()` — gán
  UUID `requestId` mỗi request (hoặc tôn trọng upstream
  `x-request-id` shape an toàn `[A-Za-z0-9._-]{1..64}`), set response
  header để FE Sentry attach. Skip log path `/api/healthz`,
  `/api/readyz`. Strip query string khỏi log (tránh leak query token).
- **Redact policy** — Pino tự `[REDACTED]` mọi field/path:
  `req.headers.authorization|cookie|x-api-key`,
  `res.headers["set-cookie"]`, top-level + `*.<field>` (1-level)
  `password`, `passwordHash`, `token`, `accessToken`, `refreshToken`,
  `apiKey`, `secret`, `authorization`, `cookie`, `session`,
  `creditCard`, `cardNumber`, `cvv`.
- **LOG_LEVEL** env (`trace|debug|info|warn|error|fatal`). Default
  `info` (production), `debug` (dev), `warn` (test).
- **Tests**: +71 (43 obs API: logger redact 16 + sentry 16 + request
  middleware 11; +12 web sentry; +16 web full suite passing).
- **Docs**: `apps/api/.env.example`, `apps/web/.env.example`,
  `docs/DEPLOY.md §12` (3 sub-sections: Pino logs, Sentry, audit),
  `docs/TROUBLESHOOTING.md §17` (3 triệu chứng: Sentry trống,
  thiếu requestId, raw token leak), `docs/AI_HANDOFF_REPORT.md`,
  `docs/CHANGELOG.md`.

### Added — Phase 13.2.D + 14.0.F Season/Territory Automation Cron

- **Cron tuần tự động hóa weekly cycle** — territory tự settle tuần
  trước, tự decay influence sau settle, tự gọi reward mail service
  (Phase 14.0.E). Sect Season tự snapshot mọi season đã hết hạn (history
  + Hall of Fame). KHÔNG còn phụ thuộc admin bấm tay (vẫn giữ override).
- **Schedule mặc định** (cấu hình qua env, default disabled cho local/test):
  - Territory weekly cycle: `5 0 * * 1` (Mon 00:05 UTC) —
    `TERRITORY_WEEKLY_SETTLE_CRON`.
  - Sect Season snapshot: `15 0 * * *` (00:15 UTC daily) —
    `SECT_SEASON_SNAPSHOT_CRON`. Chỉ snapshot season nào đã `endsAtIso ≤
    now`, idempotent qua UNIQUE `seasonKey`.
- **Race-safety + idempotency**:
  - Optimistic Redis lease (`SET NX EX` + Lua compare-and-delete) ngăn
    2 node cùng leader chạy. Lease fail-open nếu Redis vắng — DB
    UNIQUE guard mới là final barrier.
  - Settlement, decay log, reward grant, season snapshot đều có DB
    UNIQUE → P2002 catch graceful → trả existing → fail-soft errors[].
- **Admin force-run endpoints** (ADMIN-only via `AdminGuard` +
  `@RequireAdmin()`):
  - `POST /admin/liveops/run-weekly-cycle` — chạy combo
    territory + sect season; body `{ periodKey?, bypassLease? }`.
  - `POST /admin/territory/cron/run-now` — chỉ chạy phần territory.
  - `POST /admin/sect-season/cron/run-now` — chỉ chạy phần sect season.
  - Response gồm `territorySettled`, `territorySkipped`,
    `territoryDecaySkipped`, `territoryDecayDelta`, `rewardMailsCreated`,
    `rewardSkippedAlreadyGranted`, `seasonSnapshotsCreated`,
    `seasonSnapshotsSkipped`, `errors`. Audit ghi
    `ADMIN_LIVEOPS_RUN_WEEKLY_CYCLE` /
    `ADMIN_TERRITORY_CRON_RUN` /
    `ADMIN_SECT_SEASON_CRON_RUN` (no secret in meta).
- **FE admin panel**: AdminLiveOpsPanel thêm section "Chu kỳ tuần
  (Cron)" (role-gated ADMIN) — input `periodKey` optional, checkbox
  `bypassLease`, button "Chạy chu kỳ tuần" + summary line + fail-soft
  errors list.
- **Env vars mới** (`docs/DEPLOY.md` §LiveOps Cron):
  `TERRITORY_CRON_ENABLED`, `TERRITORY_CRON_TZ`,
  `TERRITORY_WEEKLY_SETTLE_CRON`, `SECT_SEASON_CRON_ENABLED`,
  `SECT_SEASON_SNAPSHOT_CRON`, `LIVEOPS_CRON_LEASE_TTL_SEC`. Default
  cron disabled — explicit opt-in production.
- **Reward distribution cho sect season**: defer (TODO trong
  `liveops-cron.service.ts`) — cần design pass riêng để align với
  Currency/Title/Buff service. Snapshot history + Hall of Fame đã đủ
  để FE render bảng vinh danh.

### Added — Phase 14.0.E Territory Owner Reward Mail Service (this PR)

- **Tông Môn chiếm Lãnh Địa được nhận thưởng tuần** — sect thắng/rank 1
  từng region (theo `SectTerritorySettlementSnapshot`) được gửi mail
  reward cho TẤT CẢ thành viên hiện tại tại thời điểm trigger. Reward
  weekly-safe gồm `linhThach` (200..800) + `exp` (100..400) + 1–2
  `itemRewards` low-tier per region; tổng cap nếu 1 sect chiếm cả 9
  region ≈ 4500 linthach + 2400 exp + 12 item / tuần — thấp hơn mission
  daily/dungeon mid-tier rất nhiều, KHÔNG phá economy.
- **Idempotency + race-safe**: composite UNIQUE
  `(periodKey, regionKey, characterId)` ở
  `TerritoryOwnerRewardGrant` đảm bảo gọi lại cùng `periodKey` KHÔNG gửi
  mail trùng. Concurrent admin trigger → chỉ 1 winner ghi grant row +
  tạo mail (P2002 swallow → trả `existed`).
- **Snapshot rule**: nhận thưởng theo MEMBER HIỆN TẠI tại thời điểm
  grant. Member rời sect trước trigger → KHÔNG nhận; member join sau
  settlement (trước trigger) → NHẬN. Rule đơn giản này tránh phải lưu
  member-snapshot riêng khi settle (tradeoff đã ghi rõ ở
  `BALANCE_MODEL.md` §11.20).
- **Admin endpoint**: `POST /admin/territory/rewards/grant-weekly`
  body `{ periodKey?, dryRun? }` (ADMIN-only, MOD reject với
  `ADMIN_ONLY` 403). `dryRun` đếm "would create" KHÔNG mutate
  state. Default `periodKey = previousTerritoryPeriodKey()`.
- **FE admin panel**: TerritoryView tab "Tranh Đoạt" thêm nút
  "Gửi Thưởng Lãnh Địa Tuần" (role-gated ADMIN), render summary
  (regionsProcessed / mailsCreated / skip*).
- **NO cron tự động trong PR này** — chỉ admin trigger để verify.
  Cron handoff: Phase 13.2.D + 14.0.F Season/Territory Automation.

### Internal — Post Phase 14 / 12.10 Integration Audit + Smoke Hardening (this PR)

- **Audit-only PR**, KHÔNG feature mới — hardening sau 8 PR liên tiếp
  (#486 Region Buff/Decay, #487 Territory War, #488 Tribulation Item
  Consume, #489 Tribulation Encounter, #490 Elemental Skills, #491
  Elemental Dungeon/Boss, #492 NPC Shop, #493 NPC Relationship Chains).
- **Docs reconciliation**: `AI_HANDOFF_REPORT.md` cập nhật PR # đầy đủ
  thay placeholder `(PR #?)`, Phase Status table thêm 8 entry mới, Recent
  Changes prepend audit row, Roadmap thay (`13.2.D Cron Automation`/
  `14.0.E Reward Mail`/`14.3.E Mini-Battle Mechanics`).
- **API.md**: bổ sung 2 endpoint thiếu — `GET /admin/territory/decay/history?limit=`
  (clamp 1..100, default 20) + `GET /character/tribulation/log?limit=`
  (clamp 1..100, default 20, response `{ ok, data: { rows, limit } }`).
- **Tests +6**: SkillBookView element/tag filter smoke (4 case F.6 audit
  checklist) + i18n parity test cho `TERRITORY_REGION_BUFFS.labelI18nKey`
  /`descriptionI18nKey` ⊆ vi+en (2 case).
- **Verification**: shared 1972 PASS / web `--run Skill` 59 PASS
  (+4 filter) / web `--run i18n` 10 PASS (+2 territory parity).
- **KHÔNG migration / KHÔNG runtime change**.

### Added — Phase 12.10.D NPC Relationship Quest Chain (PR #493)

- **Tuyến nhiệm vụ duyên phận** — NPC quan trọng giờ có chuỗi quest gắn
  với mức độ thân tình (`affinity tier`). Quest unlock dần theo tier; sau
  khi hoàn thành toàn bộ chain, player nhận reward riêng (affinity bonus
  + linh thạch / EXP / item nhỏ) + flag `relchain_*_claimed` ghi vào
  `Character.storyFlags` để các nhánh dialogue / cutscene future có thể
  reference. Một chain có thể `hidden` — chỉ xuất hiện trong panel khi
  tier đã đủ (preserve mystery của bí cảnh / bloodline reveal).
- **Shared (`packages/shared/src/npc-relationship-quest-chains.ts` mới)**:
  - `NpcRelationshipQuestChainDef` — `chainKey`, `npcKey`,
    `requiredAffinityTier`, `questKeys[]`, `dialogueNodeKeys[]`,
    `rewardHint` (affinity/linhThach/tienNgoc/exp/items), `endingFlags`
    (story flag dict), `hidden?`, `title(Vi/En)`, `description(Vi/En)`.
  - 3 chain mẫu khác arc: `relchain_moc_thanh_y_sect_path` (NPC tông môn,
    `quen_biet` tier, 3 quest realm-gated), `relchain_han_da_truce` (rival
    NPC, `quen_biet`, 1 quest có dialogue choice), `relchain_to_nguyet_ly_lineage`
    (`ban_huu`, `hidden=true`, 1 quest bloodline secret).
  - Helper: `npcRelationshipChainByKey()`, `npcRelationshipChainsForNpc()`,
    `chainClaimedFlagKey()` (`relchain_<key>_claimed`).
  - `validateNpcRelationshipChainsCatalog()` invariants — `npcKey` ref
    `NPC_AFFINITY`, `questKeys[]` ref `QUESTS[]`, `dialogueNodeKeys[]` ref
    `STORY_DIALOGUE_NODES`, tier ref `AFFINITY_TIERS`, reward cap
    (affinity ≤40, linhThach ≤500, tienNgoc ≤10, exp ≤600, items ≤3 entry,
    qty ≤5), unique `chainKey`, không duplicate `questKey` cross chain.
- **API (`apps/api/src/modules/npc-affinity/npc-relationship-chain.service.ts`
  mới)**:
  - `listForCharacter(characterId, npcKey)` — derive chain view fully từ
    `CharacterNpcAffinity.score` (lazy fallback `initialScore`),
    `QuestProgress` (filter `chain.questKeys`), `Character.storyFlags`
    (claim flag + ending flags). Hidden chain `visible=false` khi tier
    chưa đủ.
  - `claimChain(input)` — atomic transaction: tier gate → quest CLAIMED
    gate → JSON-path CAS guard via raw SQL `("storyFlags" ->> $key) IS
    DISTINCT FROM '1'` (race-safe; 2 concurrent claim, đúng 1 winner) →
    grant reward (affinity via `NpcAffinityService.addAffinityTx`,
    currency via `CurrencyService.applyTx`, items via
    `InventoryService.grantTx`, ledger reason
    `NPC_RELATIONSHIP_CHAIN_REWARD`) → ghi merged flags (claim + ending)
    vào `storyFlags`.
  - Errors: `CHAIN_UNKNOWN`, `CHAIN_LOCKED_TIER`, `CHAIN_NOT_COMPLETABLE`,
    `CHAIN_ALREADY_CLAIMED`, `CHAIN_NPC_MISMATCH`.
- **API endpoints (`apps/api/src/modules/npc-affinity/npc-affinity.controller.ts`)**:
  - `GET /story/npc-affinity/:npcKey/quest-chain` — list chain view + state.
  - `POST /story/npc-affinity/:npcKey/quest-chain/:chainKey/claim` —
    idempotent claim. Locked tier reject 403; quest chưa xong reject 409;
    retry sau success reject 409 `CHAIN_ALREADY_CLAIMED` (no double-grant).
- **Web (`apps/web/src/components/NpcAffinityPanel.vue` updated +
  `apps/web/src/views/QuestView.vue` updated)**:
  - NpcAffinityPanel thêm tab **"Tuyến nhiệm vụ duyên phận"** collapse-by-default
    per NPC. List chain với progress bar (claimed/total), per-quest status
    (LOCKED/AVAILABLE/ACCEPTED/COMPLETED/CLAIMED), `RouterLink` CTA tới
    `/quests?focus=<questKey>`, reward preview (affinity/LT/TN/EXP/items),
    locked-tier hint, claim button. Hidden chain ẩn cho tới khi visible.
  - QuestView render badge **"Duyên phận"** (rose-200) cho quest thuộc
    catalog chain — player thấy ngay quest nào gắn với một tuyến NPC.
  - Pinia store `npcAffinity` thêm action `loadChains(npcKey)` +
    `claimChain(npcKey, chainKey)` — cập nhật in-place chain entry +
    affinity score sau success, không cần full reload.
- **i18n (`apps/web/src/i18n/{vi,en}.json`)**:
  - `npcAffinity.chains.*` — title, empty, state labels (Locked /
    Claimable / In progress / Claimed), questStatus map, reward preview
    label, claim button, error messages.
- **Tests**:
  - Shared: 12 catalog invariant + helper tests
    (`npc-relationship-quest-chains.test.ts`).
  - API: 11 integration tests
    (`npc-relationship-chain.service.test.ts`) — list state, locked tier
    reject, not-completable reject, success grant, idempotent retry,
    parallel race-safe (Promise.all 2 claim, 1 winner + 1 ledger row),
    hidden visibility logic.
  - Web: 12 component tests cho NpcAffinityPanel chain section + 1
    QuestView test cho chain tag — toggle, locked, progress, reward,
    RouterLink CTA, claim disabled/enabled states, error rendering,
    hidden chain visibility, empty state.

### Added — Phase 12.10.C NPC Shop and Hidden Unlocks (this PR)

- **NPC Affinity tier mở khoá nội dung** — Phase 12.10.C biến quan hệ NPC
  thành cổng mở khoá thật: shop của NPC chỉ bán item theo tier cụ thể
  (tier càng cao càng đắt + giới hạn càng thấp), và một số dialogue/quest
  chỉ xuất hiện khi tier đủ. Player có lý do giữ quan hệ thay vì tặng quà
  một lần rồi quên.
- **Shared (`packages/shared/src/npc-affinity-shop.ts` mới + `npc-hidden-unlocks.ts` mới)**:
  - `NpcAffinityShopItemDef` — `npcKey`, `itemKey`, `requiredAffinityTier`,
    `cost` (LINH_THACH/TIEN_NGOC), `stockType` (`unlimited|daily|weekly`),
    `dailyLimit?`/`weeklyLimit?`, `unlockHint(Vi/En)`.
  - `NPC_AFFINITY_SHOPS` catalog — 15 entry trên 5 NPC chính. Mỗi NPC có
    vài item nhỏ, tier cao mới mở item hiếm với limit thấp.
  - Helper: `npcShopForAffinity(npcKey, tier)` (filter unlocked tier-aware),
    `npcAffinityShopItem(npcKey, itemKey)`, `toNpcAffinityShopItemView()`.
  - `validateNpcAffinityShopCatalog()` invariants — item ref tồn tại trong
    `ITEMS`, NPC ref trong `NPC_AFFINITY`, tier ref trong `AFFINITY_TIERS`,
    cost positive integer, stockType ↔ daily/weekly limit consistent,
    per-NPC daily limit sum ≤30 (anti-grind cap), tier cost cap
    (xa_la/quen_biet ≤250 LT, ban_huu ≤1500 LT, tri_giao/tri_ky ≤2500 LT).
  - `NpcHiddenDialogueUnlockDef` / `NpcHiddenQuestUnlockDef` —
    `requiredAffinityTier` + `unlockReason(Vi/En)`. Catalog gắn dialogue
    `story_dlg_lang_van_sinh_inner_secret` (ban_huu) + một số quest tier
    cao. Helper `npcHiddenUnlocksForAffinity(npcKey, tier)` trả combined
    list, marked `unlocked` flag, sort locked-first theo tier order.
- **API (`apps/api/src/modules/npc-affinity/npc-affinity-shop.service.ts` mới)**:
  - `GET /story/npc-affinity/:npcKey/shop` — list entry với
    `currentTier`/`unlocked`/`purchased`/`remaining`/`limitReached` state.
    Daily/weekly window count từ `ItemLedger` (`reason='NPC_SHOP_BUY'` +
    `refId='${npcKey}:${itemKey}'`).
  - `POST /story/npc-affinity/:npcKey/shop/buy` — atomic Prisma
    `$transaction`: re-check tier, count purchased trong window, verify
    `dailyLimit`/`weeklyLimit`, spend currency qua `CurrencyService.applyTx`
    (negative delta), grant item qua `InventoryService.grantTx`, ledger row
    `reason='NPC_SHOP_BUY'` + `refType='NpcAffinityShop'`.
  - `GET /story/npc-affinity/:npcKey/unlocks` — combined dialogue/quest
    hidden unlock list với `unlocked` flag.
  - Error codes: `INSUFFICIENT_AFFINITY_TIER` (403), `INSUFFICIENT_FUNDS`
    (400), `DAILY_LIMIT_REACHED`/`WEEKLY_LIMIT_REACHED` (429),
    `ITEM_NOT_IN_SHOP`/`NPC_AFFINITY_UNKNOWN` (404), `INVALID_QTY`/
    `NON_STACKABLE_QTY_GT_1` (400).
  - `CurrencyLedgerReason` + `ItemLedgerReason` thêm `'NPC_SHOP_BUY'`.
- **Web (`apps/web/src/components/NpcAffinityPanel.vue` extend +
  `apps/web/src/api/npcAffinity.ts` extend + `apps/web/src/stores/npcAffinity.ts` extend)**:
  - Mỗi NPC card có toggle "Cửa hàng & ưu đãi đặc biệt" (collapsed default).
    Lazy load shop + unlocks khi mở.
  - Item entry: tên + cost + currency, lock badge với required tier label
    cho item chưa unlock, daily/weekly stock indicator (`Hôm nay 1/5`,
    `Tuần này 0/1`), buy button disabled khi locked/limit/loading.
  - Hidden unlocks list dưới shop — dialogue/quest entry với tier label +
    unlock reason + ✓ marker khi unlocked.
  - Error states: shop load error, buy error (insufficient tier/funds/limit).
  - i18n keys mới `npcAffinity.shop.*`, `npcAffinity.shopErrors.*`,
    `npcAffinity.unlocks.*` (vi + en parity).
- **Tests** (Phase 12.10.C backstop):
  - **Shared**: `npc-affinity-shop.test.ts` (validate catalog + tier monoto
    nicity + view conversion + i18n non-empty + per-NPC daily-limit cap),
    `npc-hidden-unlocks.test.ts` (validate refs + helper unlocked logic).
  - **API**: `npc-affinity-shop.service.test.ts` (17 test) — list shop tier
    filter, buy success path (currency spend + inventory grant + ledger
    `NPC_SHOP_BUY`), `INSUFFICIENT_AFFINITY_TIER`, `INSUFFICIENT_FUNDS`,
    `DAILY_LIMIT_REACHED`, `WEEKLY_LIMIT_REACHED`, `ITEM_NOT_IN_SHOP`,
    `NPC_AFFINITY_UNKNOWN`, item grant once, listUnlocks tier-aware,
    `startOfLocalWeek` Monday-start helper.
  - **Web**: `NpcAffinityPanel.test.ts` (7 test mới) — toggle collapsed
    default, click toggle loads shop+unlocks, locked items dimmed +
    disabled buy, click buy calls API, buy error state, hidden unlocks
    list, daily/weekly stock indicators.

### Added — Phase 14.2.D Elemental Dungeon and Boss Identity

- **Dungeon/boss có bản sắc Ngũ Hành** — Phase 14.2.D thêm element identity metadata cho dungeon + boss. Player thấy "dungeon hệ Hoả → khuyến nghị dùng skill Thuỷ", "boss này khắc bởi Mộc và kháng Thuỷ", "loot hợp với hệ Kim". Combat damage **KHÔNG đổi** — vẫn dùng `elementalMultiplier` (Phase 11.3.B) + `composeMonsterElementalResist` (Phase 14.2.B). Field mới chỉ là UI hint.
- **Shared (`packages/shared/src/elemental-identity.ts` mới + extend `combat.ts`/`boss.ts`)**:
  - `DungeonDef`: thêm `dominantElement?` / `recommendedCounterElement?` / `rewardElementHint?` (tất cả optional, derive từ `element` legacy nếu không set).
  - `BossDef`: thêm `weaknessElement?` / `resistElements?` / `rewardElementHint?` (UI hint thuần — combat damage **không đọc**, vẫn qua `elementalMultiplier` + `composeMonsterElementalResist`).
  - Helper `getDungeonElementProfile()` / `getBossElementProfile()` derive đầy đủ profile từ catalog (override > legacy fallback > null).
  - Helper `computePlayerElementWarning(playerElement, targetElement)` → `'recommended' | 'warning' | 'caution' | 'none'` cho FE warning UI.
  - Validator `validateDungeonElementProfile()` + `validateBossElementProfile()` để catalog test invariant.
- **API (`apps/api/src/modules/combat/combat.service.ts`, `apps/api/src/modules/boss/boss.service.ts`)**:
  - `combat.listDungeons()` trả mỗi entry kèm `elementProfile` (dominant + recommendedCounter + rewardHint).
  - `BossView` (boss response) thêm `elementProfile` (element + weakness + resistElements + rewardHint). Boss legacy không catalog → all-null sentinel.
  - **No-double-multiplier invariant** test backstop: response không expose multiplier numeric. FE compute warning qua relation logic (counter/sinh), không nhận formula từ server.
- **Web (`apps/web/src/components/ElementIdentityPanel.vue`, `BossElementTooltip.vue` mới)**:
  - DungeonView card: hiển thị dominant element badge + recommended counter badge + warning text khi player primary element bị dungeon hệ khắc.
  - BossView header: dòng tooltip render element + weakness + resist list + reward hint + warning badge.
  - i18n keys mới `elementIdentity.*` cho 4 trạng thái warning (recommended/warning/caution/none) + 5 nhãn (dominant/recommendedCounter/weakness/resists/rewardHint).
  - SpiritualRoot store fire-and-forget hydrate trong onMounted để compute warning reactive (không block list load).
- **Tests** (Phase 14.2.D backstop):
  - **Shared**: `elemental-identity.test.ts` (32 test) — element relation matrix, getDungeonElementProfile/getBossElementProfile derive + override, computePlayerElementWarning, catalog invariant (mọi element có ≥ 1 dungeon/boss, weakness === counter(element), resistElements ⊆ elementalResist keys), no-double-multiplier shape.
  - **API**: `combat.service.element-identity.test.ts` (5 test) + `boss.service.element-identity.test.ts` (7 test) — response shape includes elementProfile, derive consistent, no multiplier numeric exposed.
  - **Web**: `ElementIdentityPanel.test.ts` (9 test) + `BossElementTooltip.test.ts` (8 test) — dominant badge / counter badge / weakness / resists / reward hint render, warning state theo player primary element, data-testid stable.
  - Existing dungeon/boss tests vẫn pass (no regression — chỉ thêm fixture `elementProfile` cho `BossView` stubs).

### Added — Phase 14.2.C Elemental Skill Tree Expansion

- **Skill có hệ rõ ràng và identity riêng** — Phase 14.2.A đã ship Elemental Combat Foundation, 14.2.B đã ship monster resist + equipment elementalAtkBonus. Phase 14.2.C biến Ngũ Hành từ damage/resist multiplier thành **hệ kỹ năng có hướng chơi riêng**: Mộc = hồi phục/độc, Hỏa = burst damage/burn, Thổ = shield/khống, Kim = xuyên giáp/chí mạng, Thủy = control/hồi linh.
- **Shared (`packages/shared/src/combat.ts` + `elemental-skills.ts` mới)**:
  - `SkillDef.tags?: SkillTag[]` — optional metadata field, backward-compat (legacy skill thiếu tags vẫn pass mọi check).
  - `SkillTag` enum 6 giá trị: `HEAL` / `DOT` / `BURST` / `SHIELD` / `CRIT` / `CONTROL`. Hằng `SKILL_TAGS` để FE dropdown / catalog test.
  - **11 signature skill mới Phase 14.2.C** (2-3 skill mỗi hệ): Mộc (`moc_xuan_phong_phuc_sinh` HEAL, `moc_doc_van_truong` DOT, `moc_thien_sinh_chu` HEAL), Hỏa (`hoa_phen_diem_kiep` BURST, `hoa_thieu_diem_phap` DOT), Thổ (`tho_kim_son_ho_phap` SHIELD, `tho_huyen_thach_trong_giap` SHIELD), Kim (`kim_xuyen_giap_thien_thich` CRIT, `kim_phong_nhan_quyet` CRIT), Thủy (`thuy_lam_dieu_quyet` CONTROL, `thuy_lam_quy_thuy_tam` HEAL). Skill cũ `tho_huyen_son_phong_an` backfill tag `CONTROL`.
  - `SKILL_ELEMENT_IDENTITY` catalog: 5 entry, mỗi hệ có `name`, `theme`, `playstyle`, `primaryTags`, `secondaryTags`. Helper `getSkillElementIdentity` / `describeSkillElementIdentity` / `validateSkillTag` / `findElementIdentityCoverageGaps`.
  - Tag side-effect dial: `SKILL_TAG_DOT_DAMAGE_RATIO=0.15`, `SKILL_TAG_DOT_TURNS=3`, `SKILL_TAG_SHIELD_HP_RATIO=0.10` — tổng DOT 3 lượt ≈ 45% sát thương 1-shot, shield ≈ 10% HP max (anti-cheese, anti-runaway).
  - `computeSkillAffinityDelta` / `computeSkillElementBonus` thin wrapper kiểm tra delta primary/secondary affinity (đã wire ở 14.2.A).
- **API (`apps/api/src/modules/combat/combat.service.ts`)**:
  - `EncounterMonsterDot` interface mới + `EncounterState.monsterDot?` optional field — DOT persist multi-turn trên monster, decrement mỗi player action, clear khi monster chết / encounter WON / LOST.
  - Skill cast block thêm tag dispatch: `DOT` → set `monsterDot` state với `perTurnDamage = floor(dmg × 0.15)` × 3 lượt; `SHIELD` → compute `skillShieldAbsorb = floor(hpMax × 0.10)`, áp same-turn TRƯỚC buff shield (compose tuần tự skill → buff → remaining damage). SHIELD không persist sang turn sau (single-use). Log line mới: "DOT N sát thương / lượt × 3 lượt", "Khiên \<element\> hấp thu N sát thương phản kích".
  - **KHÔNG đổi**: combat damage formula (vẫn dùng `playerElementMul × talentElementMul × buffElementMul × phase142Mul` từ 14.2.A/B), character affinity bonus, monster resist, equipment elementalAtkBonus.
- **Web (`apps/web/src/components/SkillTagBadge.vue` mới + `views/SkillBookView.vue`)**:
  - `SkillTagBadge` component: render tag badge với Wuxia palette (HEAL=emerald, DOT=lime, BURST=rose, SHIELD=amber, CRIT=fuchsia, CONTROL=sky), tooltip via `title` attr, i18n via `skillTagBadge.tag.<KEY>` + `.tooltip.<KEY>`.
  - SkillBookView: thêm filter "Loại pháp" (tag dropdown), render tag badges trên skill card, render element identity tooltip trên ElementBadge wrapper, add italic identity description line bên dưới skill description.
- **Tests**:
  - shared `elemental-skills.test.ts` 48 PASS (catalog invariant, signature skills, validateSkillTag, computeSkillAffinityDelta, skillsForTag, side-effect dial range).
  - api `combat.service.test.ts` +6 Phase 14.2.C tests (DOT cast + persist, DOT tick decrement, DOT clear on monster killed, SHIELD log, SHIELD non-persist, legacy skill identity no-op) — 102 PASS tổng.
  - web `SkillTagBadge.test.ts` 17 PASS (label vi/en, tooltip, data-testid, color class, size).
- **Out of scope**: passive `BURST` skill, multi-DOT stacking (single active monsterDot, overwrite policy), shield carry-over multi-turn, gacha, skill tree visual UI (defer Phase 14.3+).



### Added — Phase 14.3.D Tribulation Encounter System (this PR)

- **Biến Thiên Kiếp thành mini-encounter có gameplay** — Phase 14.3.A đã ship preview snapshot, 14.3.B đã ship support providers + redirect, 14.3.C đã ship item consumption. Phase 14.3.D thêm encounter layer: mỗi tribulation transition giờ có 1 encounter spec (element + effectType) gắn flavor gameplay (Hỏa = burst / Thủy = sustain / Mộc = poison-recovery / Kim = armor-crit / Thổ = defense-endurance), 2-phase flow `start → resolve` thay cho 1-shot attempt.
- **Shared (`packages/shared/src/tribulation-encounter.ts`)**: `TribulationEncounterDef` interface (element / effectType / phaseCount / successThreshold / failPenaltyMultiplier / rewardHintMultiplier), `TRIBULATION_ENCOUNTER_DEFS` 5-entry catalog (kim/moc/thuy/hoa/tho), helpers (`getTribulationEncounterDefByElement`, `dominantTribulationWaveElement`, `resolveTribulationEncounterDef`, `computeTribulationEncounterPhaseCount`, `computeTribulationEncounterPowerHint`, `describeTribulationEncounterAdvantage`), validators (`validateTribulationEncounterDef`, `validateTribulationEncounterCatalog`). Element advantage semantics: +2 đồng hệ, +1 player counter encounter / encounter sinh player, 0 trung tính, -1 player sinh encounter, -2 encounter counter player.
- **API (`apps/api/src/modules/character/tribulation.service.ts`)**: 3 endpoints mới giữ nguyên server-authoritative pattern Phase 14.3.A-C — `GET /character/tribulation/encounter/current` (snapshot spec + pending row + cooldown + taoMa), `POST /character/tribulation/encounter/start` (validate at-peak + create pending row, idempotent re-call cùng tribulationKey trả pending hiện có), `POST /character/tribulation/encounter/resolve` (atomic resolve via `runAttemptInTx` extracted helper, double-resolve trả cached outcome từ `TribulationAttemptLog` — KHÔNG double breakthrough / consume / reward).
- **Prisma**: `TribulationEncounter` model mới (state machine `pending → resolved`) với fields `id / characterId / tribulationKey / encounterKey / effectType / element / difficulty / selectedSupportItemKeys[] / state / startedAt / resolvedAt / resolvedAttemptLogId` + indexes. Migration `20260611000000_phase_14_3_d_tribulation_encounter`.
- **Error codes mới**: `NO_PENDING_ENCOUNTER` (404, gọi resolve khi không có pending), `ENCOUNTER_ALREADY_PENDING` (409, start khi đã có pending khác). Tái dùng codes cũ `NOT_AT_PEAK / NO_NEXT_REALM / NO_TRIBULATION_FOR_TRANSITION / COOLDOWN_ACTIVE / SUPPORT_ITEM_MISSING / TOO_MANY_SUPPORT_ITEMS / DUPLICATE_SUPPORT_ITEM / INVALID_SUPPORT_ITEM`.
- **FE (`apps/web/src/views/TribulationView.vue`)**: Encounter panel mới — element badge + effectType badge + advantage badge (đồng hệ / khắc kiếp / trung tính / bị sinh kiếp / bị khắc kiếp), pending state badge, phase count + difficulty + power hint + success chance, start/resolve button (mutually exclusive theo `encounterPending` flag), CTA "Quay lại tu luyện" sau success. Store `useTribulationStore` extend với `encounter / encounterLoading / encounterError / encounterStarting / encounterResolving / encounterPending` + 3 actions `fetchEncounter / startEncounter / resolveEncounter`. API client thêm types `TribulationEncounterRowView / SpecView / CurrentView` + 3 functions.
- **i18n**: 28 keys vi/en parity (`encounter.name.{element}` 5, `encounter.element.{element}` 5, `encounter.effectType.{type}` 5, `encounter.advantage.{level}` 5, `encounter.statePending`, `encounter.startedToast`, `encounter.field.{phaseCount,difficulty,powerHint}` 3, `encounter.button.{start,starting,resolve,resolving}` 4, `encounter.cta.returnCultivation`) + 2 error keys (`NO_PENDING_ENCOUNTER`, `ENCOUNTER_ALREADY_PENDING`).
- **Tests +69**:
  - shared `--run tribulation` 161 PASS (+36 tribulation-encounter: catalog structure / 5 element mapping / validator / advantage calc full grid / lookup by key / lookup by element / phase count / power hint / dominant wave element / resolve from def).
  - api `--run tribulation` 105 PASS (+15 encounter: getCurrentEncounter null mortal / spec at peak / pending row / advantage matrix / startEncounter not-at-peak reject / pending row create / idempotent / SUPPORT_ITEM_MISSING reject / resolveEncounter NO_PENDING reject / SUCCESS path advance+reward+log link / FAIL path penalty no-advance / idempotent double-resolve no double breakthrough/consume/reward / support affects chance).
  - web `--run Tribulation` 180 PASS (+15 encounter UI: render panel / element + effect + advantage + pending badges / phase count + power hint render / start button when not pending / resolve button when pending / start click → store call + success toast / resolve click → success toast + lastOutcome populated / resolve fail → warning toast / resolve error → i18n error toast / CTA cultivation visible after success → router.push / start API client + body shape / resolve API client + error throw / store fetchEncounter populate + null handling / store reset clear encounter state).
- **Verification**: shared typecheck + `--run tribulation` 161 PASS / api typecheck + `--run tribulation` 105 PASS + `--run cultivation` 95 PASS + `--run combat` 30 PASS / web typecheck + `--run Tribulation` 180 PASS / pnpm build ✅.
- **Out of scope (defer)**:
  - Realtime combat trong encounter (multi-wave button-based skill rotation, animation, cutscene).
  - Item support mới (chỉ tái dùng catalog Phase 14.3.C).
  - Penalty nặng làm mất nhân vật (chỉ giữ Phase 14.3.A penalty: expLoss + cooldown + taoMa).
  - Multi-encounter chain (mỗi transition vẫn 1 encounter).
- **Risk / rollback**: Encounter là layer view-only over deterministic simulation hiện có — `runAttemptInTx` extracted private helper KHÔNG thay đổi simulation logic. Legacy `POST /character/tribulation` endpoint giữ nguyên (FE legacy attempt button vẫn hoạt động). Rollback bằng cách disable 3 routes mới + drop `TribulationEncounter` table (no character data loss; resolved encounters chỉ trỏ tới `TribulationAttemptLog` — log vẫn nguyên).

### Added — Phase 14.3.C Tribulation Support Item Consumption

- **Đóng vòng chơi Thiên Kiếp** — Phase 14.3.A đã ship preview snapshot, 14.3.B đã ship 4 support providers + redirect UX. Phase 14.3.C đóng vòng cuối: player **chọn item hỗ trợ** trước khi attempt → server verify ownership + **consume item** trong cùng transaction với attempt → server **recalc** support bonus từ 4 nguồn (selected items + equipment + buffs + talents) → **không tin** FE bonus value.
- **Shared (`packages/shared/src/tribulation-support-validate.ts`)**: `TRIBULATION_MAX_SELECTED_SUPPORT_ITEMS = 3`, `isTribulationSupportConsumable()` (PILL_HP / PILL_MP / PILL_EXP / MISC, KHÔNG equipment), `listTribulationSupportConsumables()`, `validateTribulationSupportSelection()`, `buildSelectedSupportItemEntries()`, `TribulationSupportSelectionError` enum (`INVALID_INPUT` / `TOO_MANY_SELECTED` / `DUPLICATE_SELECTED` / `INVALID_SUPPORT_ITEM`).
- **API (`POST /character/tribulation`)**: body mới `{ selectedSupportItemKeys?: string[] }` (≤ 3 keys). Server verify ownership in tx → consume in tx (atomic) → recalc bonus server-side từ 4 nguồn (composedSupports cho FE display KHÔNG bị double-count với talent's elementResistFn; damageSupports cho damage multiplier exclude talents). Ledger reason `TRIBULATION_SUPPORT_CONSUME` với `refType=TribulationAttemptLog`. Cả success path + fail path đều consume item (no free retry). Idempotent: pre-check ownership → consume fail → throw `SUPPORT_ITEM_MISSING` → tx rollback → KHÔNG mất EXP.
- **API endpoint mở rộng**:
  - `GET /character/tribulation/preview` (read-only, KHÔNG mutate inventory) thêm fields: `availableSupportItems[]` (server-resolved từ catalog × inventory qty), `maxSelectedSupportItems` (= 3).
  - `POST /character/tribulation` body chấp nhận `selectedSupportItemKeys?`. Outcome thêm: `consumedSupportItems[]` (label resolved server-side), `supportTotalBonus`, `successChance` (breakdown đầy đủ).
- **FE (`apps/web/src/views/TribulationView.vue`)**: Selection panel với checkbox multi-select (cap = preview.maxSelectedSupportItems = 3), label + qty + bonus per item, predicted total bonus, "items consumed regardless of outcome" hint. Outcome banner thêm consumed items list (success + fail path). Sau attempt: clear selection + refetch preview để sync inventory.
- **i18n**: 11 keys vi/en parity (`selectionTitle/selectionHint/selectionEmpty/selectionLimitReached/selectionPredictedTotal/selectionItemQty/selectionItemBonus/consumedTitle/consumedItem/consumedNone`) + 6 error keys (`INVALID_SUPPORT_SELECTION/TOO_MANY_SUPPORT_ITEMS/DUPLICATE_SUPPORT_ITEM/INVALID_SUPPORT_ITEM/SUPPORT_ITEM_MISSING/INVENTORY_UNAVAILABLE`).
- **Tests +60**:
  - shared `--run tribulation` 124 PASS (+24 tribulation-support-validate: catalog isConsumable / listConsumables / validate selection / build entries / cap rejection / duplicate rejection / unknown item / non-consumable / max items / type narrowing).
  - api `--run tribulation` 90 PASS (+12 Phase 14.3.C: empty selection no consume / valid consume + recalc / invalid item reject / missing item reject / cap enforcement / preview availableSupportItems / preview no mutate / fail path consume / idempotency / ledger written / no double consume).
  - web `--run Tribulation` 157 PASS (+10 selection UI: render panel / list with label/qty/bonus / empty hint / predicted bonus update / attempt sends selected keys / empty selection sends [] / outcome consumed display / consumed empty hint / error toast / clear after attempt).
- **Verification**: shared typecheck + `--run tribulation` 124 PASS / api typecheck + `--run tribulation` 90 PASS + `--run cultivation` 95 PASS + `--run inventory` 91 PASS / web typecheck + `--run Tribulation` 157 PASS + `--run Breakthrough` 49 PASS / pnpm build ✅.
- **Out of scope (defer)**:
  - Combat thiên kiếp phức tạp (multi-wave skill UI).
  - Encounter system (NPC tương tác trong kiếp).
  - Auto-buy missing item nếu inventory không đủ.
  - Refund mechanic khi attempt bị server reject sau khi consume (hiện tại pre-check ownership → reject TRƯỚC khi consume, nên không cần refund).

### Added — Phase 14.0.D Territory Weekly War Loop

- **Lãnh Địa — vòng chơi cạnh tranh theo tuần** — Phase 14.0.A đã ship influence, 14.0.B đã ship settlement + ownership, 14.0.C đã ship region buff + decay. Phase 14.0.D đóng vòng chơi: thêm period tuần, countdown, region standings, settlement history, admin trigger chốt sớm.
- **Period rule (deterministic UTC ISO week)**: tuần bắt đầu Thứ Hai 00:00 UTC, kết thúc Thứ Hai 00:00 UTC kế tiếp; `periodKey = YYYY-Www`. Helpers shared `currentTerritoryPeriodKey()`, `previousTerritoryPeriodKey()`, `nextTerritoryResetAt()`, `territoryPeriodWindow()`, `isTerritoryPeriodKey()` — tất cả pure, fake-date testable, KHÔNG phụ thuộc timezone máy.
- **API runtime mới (`apps/api/src/modules/territory/territory-war.service.ts`)**:
  - `getCurrentTerritoryWarState()` — period hiện tại + 9 region với top 3 standings + countdown `timeRemainingMs` (server-authoritative).
  - `getRegionWarStatus(regionKey)` — top 10 standings + 5 settlement gần nhất + owner snapshot.
  - `getWarHistory(limit?)` — entries DESC `settledAt`, group theo `periodKey`, cap 32 (default 8).
  - `settleCurrentPeriod({settledBy?})` — chốt period hiện tại; idempotent qua UNIQUE `(regionKey, periodKey)` race-safe; **no-influence rule** = sticky owner (region không có sect có điểm > 0 → KHÔNG ghi snapshot, KHÔNG đổi `SectTerritoryRegionState`); tie-break deterministic `sectId.localeCompare()` ASC; trả `ownersAfter` cho FE refresh không round-trip.
- **API endpoints mới**:
  - `GET /territory/war/current` (public) → `TerritoryWarStateView`.
  - `GET /territory/war/regions/:regionKey` (public) → `TerritoryRegionWarStatusView`.
  - `GET /territory/war/history?limit=` (public) → `TerritoryWarHistoryView`.
  - `POST /admin/territory/war/settle-current` (admin-only via `@RequireAdmin()` + `AdminGuard`) → `TerritoryWarSettleCurrentResult`. Audit `settledBy = req.userId`. Errors: 401 `UNAUTHENTICATED`, 403 `ADMIN_ONLY`, 400 `PERIOD_INVALID` (defensive).
- **FE (`apps/web/src/views/TerritoryView.vue`)**:
  - Tab mới `war` với countdown panel (1000ms ticker `nowMs`, `onBeforeUnmount(clearInterval)` tránh leak; server `endsAt` source of truth; format `Xd HH:MM:SS`).
  - Period header: `periodKey` + `startsAt → endsAt` (UTC) + badge `previousPeriodKey`.
  - 9 region cards: contested badge (≥ 2 sect tranh), owner (kỳ trước), top 3 standings (`#rank sectName — points`, leader tag, contributors hint), lead margin, empty state khi không có sect.
  - History panel: entries DESC, mỗi period 1 row, expand để xem `entry.snapshots[]`.
  - Admin settle button role-gated `auth.user.role === 'ADMIN'` với loading + result render (`adminLastResult`).
  - Lazy fetch qua `watch(tab)` chỉ khi vào tab `war` (cache aware via pinia store).
- **i18n**: `territory.tab.war` + `territory.war.*` 20 key parity vi/en (title/subtitle/countdownLabel/currentPeriod/previousPeriod/windowFmt/regionContestedBadge/regionOwner/regionLeadMargin/regionNoContenders/standingsTitle/standingsRow/leaderTag/contributorsHint/historyTitle/historyEmpty/historyRow/adminTitle/adminSubtitle/adminSettleButton/adminSettleRunning/adminLastResult).
- **Tests +35**:
  - shared `--run territory` 79 PASS (territory 23 + territory-buffs 32 + territory-war 24 — period key boundary + window + previous + isTerritoryPeriodKey + types invariant).
  - api `--run territory` 83 PASS (+14 territory-war.service: empty/2-sect-tie ASC sectId/DESC-points/owner-snapshot/REGION_INVALID/recent-settlements/history-DESC/idempotent-snapshot-id/no-influence-skipped/settledBy-audit/limit-cap).
  - api `--run admin` 359 PASS (+3 admin-territory war/settle-current: settledBy passthrough/PERIOD_INVALID 400/error rethrow).
  - web `--run Territory` 30 PASS (+6 weekly war tab: tab clickable / content render / 9 cards + standings / history empty / role gate / admin click → API + history refresh).
- **Verification**: shared typecheck + `--run territory` 79 PASS / api typecheck + `--run territory` 83 PASS + `--run admin` 359 PASS / web typecheck + `--run Territory` 30 PASS / pnpm build ✅.
- **Out of scope (defer)**:
  - **Cron auto-settle**: KHÔNG ship cron tự động cuối tuần — cần Redis lease / DB guard race-safe (defer Phase 14.0.E). Hiện tại admin trigger qua `POST /admin/territory/war/settle-current` cho test/fast-forward.
  - **Reward / mail cho owner sect**: defer 14.0.E.
  - **Decay tự động trước/sau settle**: tách Phase 14.0.C admin trigger riêng (`POST /admin/territory/decay`).
  - KHÔNG siege / KHÔNG diplomacy / KHÔNG PvP realtime / KHÔNG auction / KHÔNG rewrite Territory foundation.

### Added — Phase 14.0.C Sect Territory Region Buff and Influence Decay (PR #485)

- **Lãnh Địa Tông Môn — buff vùng + decay** — Phase 14.0.B đã ship Settlement & Region Ownership (top sect chiếm vùng theo period). Phase 14.0.C biến quyền sở hữu thành lợi ích gameplay thật + chống một sect giữ vùng vĩnh viễn.
- **Shared (`packages/shared/src/territory-buffs.ts` mới)**:
  - `TerritoryRegionBuffDef` interface + `TERRITORY_REGION_BUFFS` catalog 5 buff (`buffKey/buffType/value/cap/labelI18nKey/descriptionI18nKey/appliesTo/element?`).
  - 5 buff catalog ship: `son_coc` `EXP_BONUS` 5% (DUNGEON_REWARD), `hac_lam` `LINH_THACH_BONUS` 5% (DUNGEON_REWARD), `moc_huyen_lam` `ELEMENTAL_DAMAGE` 5% (COMBAT, ELEMENTAL, element=`moc`), `kim_son_mach` `ELEMENTAL_DAMAGE` 5% (COMBAT, ELEMENTAL, element=`kim`), `hoang_tho_huyet` `DEFENSE_BONUS` 5% (COMBAT).
  - Helpers pure: `territoryRegionBuffsForRegion(regionKey)`, `territoryRegionBuffForOwner(regionKey)`, `activeTerritoryBuffsForSect(sectId, ownerStateMap)`, `validateTerritoryBuffCatalog()`, `computeTerritoryDecay(currentPoints, decayBps)` (deterministic floor, không bao giờ âm).
  - Envelope: `TERRITORY_BUFF_VALUE_MAX=0.10` (10% cap value invariant), `TERRITORY_DECAY_DEFAULT_BPS=2500` (25%), `TERRITORY_DECAY_MAX_BPS=5000` (50%, KHÔNG nới).
  - 32 unit test PASS (catalog UNIQUE buffKey toàn cục + regionKey ∈ MAP_REGIONS + value ≤ cap ≤ MAX + decay deterministic floor + helper coverage).
- **Prisma + Migration `20260610000000_phase_14_0_c_territory_decay_log`**: model `SectTerritoryDecayLog` (`id, periodKey UNIQUE, decayBps, rowsAffected, pointsBefore, pointsAfter, delta, triggeredAt, triggeredBy?`) — race-safe + idempotent qua UNIQUE `(periodKey)`. KHÔNG đụng `SectTerritoryInfluence` / `SectTerritoryRegionState` / `SectTerritorySettlementSnapshot`.
- **API runtime mới (`apps/api/src/modules/territory/territory-decay.service.ts`)**:
  - `runDecay({periodKey?, decayBps?, triggeredBy?})` — `periodKey` default `previousTerritoryPeriodKey()` nếu không truyền; `decayBps` default `TERRITORY_DECAY_DEFAULT_BPS=2500`, validate range `1..5000` reject `DECAY_BPS_INVALID`.
  - Idempotency qua `SectTerritoryDecayLog.periodKey` UNIQUE: insert log, P2002 → fetch row tồn tại → trả `{skipped: true, ...existingLog}`. Concurrent admin trigger cùng `periodKey` → 1 winner ghi log, các caller khác đọc lại log đã tồn tại.
  - Decay aggregate qua `computeTerritoryDecay` (floor không âm): per-row update `SectTerritoryInfluence.points`. Log row `pointsBefore/pointsAfter/delta/rowsAffected` để admin review.
  - 17 test PASS (default decay 25% / custom bps / cap reject / idempotent same period skipped / race P2002 retry / no-points zero-state / aggregate correctness / cross-period independence / triggeredBy).
- **API integration `DungeonRunService.claimRun()`**:
  - Sau territory influence hook gọi `applyTerritoryDungeonRewardBuffs(rewards, regionKey, ownerSectId, characterSectId)` qua catalog `territoryRegionBuffsForRegion` filter `appliesTo` ⊇ `DUNGEON_REWARD`.
  - Owner-only (sect của character === `ownerSectId`); non-owner / no-sect / world region → KHÔNG cộng buff.
  - `EXP_BONUS` cộng % vào `expGained` (`Math.floor`); `LINH_THACH_BONUS` cộng % vào `linhThachGained` (`Math.floor`). Reward bonus tính trên reward gốc, KHÔNG double-apply khi retry claim (idempotent qua existing CAS guard).
  - Fail-soft: bất kỳ exception nào trong helper → swallow + warn log; reward chính KHÔNG fail.
  - 6 test mới `dungeon-run.service.test.ts` (no region key / no character sect / non-owner sect / owner EXP_BONUS apply / owner LINH_THACH_BONUS apply / double claim no double apply).
- **API endpoints mới/extend**:
  - **Mới** `POST /admin/territory/decay` (admin-only via `@RequireAdmin()` + `AdminGuard`). Body `{ periodKey?: string, decayBps?: number }`. Response `TerritoryDecayResult { periodKey, decayBps, skipped, rowsAffected, pointsBefore, pointsAfter, delta, triggeredAt }`. Errors: 403 `ADMIN_ONLY`, 400 `PERIOD_INVALID`, 400 `DECAY_BPS_INVALID`.
  - **Extend** `GET /territory/regions` thêm `buffs: TerritoryRegionBuffPreviewLite[]` per region (luôn render catalog) + `ownerBuffActive: boolean` + top-level `currentPeriodKey/previousPeriodKey`.
  - **Extend** `GET /territory/me` thêm `activeBuffs: TerritoryRegionBuffPreviewLite[]` (buff đang được áp dụng vì sect của user đang sở hữu region tương ứng) + `currentPeriodKey`.
- **FE**:
  - `apps/web/src/api/territory.ts` thêm `TerritoryRegionBuffPreviewLite` + `TerritoryDecayResult` interface + `adminTerritoryDecay` fetcher.
  - `apps/web/src/stores/territory.ts` thêm state `decayLoading/decayError/lastDecayResult` + method `adminDecay({periodKey, decayBps})` invalidate leaderboard cache + refetch regions/me.
  - `TerritoryView.vue` overview tab: render region buff list per region với active (sect đang sở hữu) / inactive badge + currentPeriodKey hint; me tab: render `activeBuffs` panel với empty placeholder; admin: decay panel role-gated với `decayBpsInput` (default 2500) + skipped/error/result render.
  - i18n vi/en parity full `territory.overview.{currentPeriod,buffSectionTitle,buffNone,buffActiveBadge,buffInactiveBadge,buffOwnerHint}`, `territory.buff.{appliesTo,type,territory_*}`, `territory.myBuffs.{title,empty,noSect}`, `territory.admin.{decayTitle,decaySubtitle,decayBpsLabel,decayRun,decayRunning,decayLastResult,decaySkipped}`, `territory.errors.DECAY_BPS_INVALID`.
  - 9 test mới `TerritoryView.test.ts` (15→24): overview render buff list owner/non-owner badge / no-buff empty / me tab activeBuffs render / me tab empty / PLAYER no decay panel / ADMIN run decay với input / ADMIN run decay không input → undefined opts / decay skipped state / decay error DECAY_BPS_INVALID.
- **Verification**: shared typecheck + `--run territory` 55 PASS (32 buffs + 23 existing) / api typecheck + `--run territory` 66 PASS + `--run dungeon` 88 PASS + `--run combat` 126 PASS / web typecheck + `--run Territory` 24 PASS / pnpm build ✅.
- **Out of scope**: cron auto-decay (defer 14.0.D Territory Weekly War Loop); `BOSS_REWARD` buff wire (catalog ship sẵn nhưng chỉ wire `DUNGEON_REWARD` trong PR này); `COMBAT/ELEMENTAL/DEFENSE` runtime wire (giữ Phase 14.2.x envelope `[0.5, 1.6]`, defer); region siege / PvP realtime / diplomacy (defer 14.0.D+).
- **Risk / rollback**: migration thuần thêm 1 table mới (`SectTerritoryDecayLog`) — rollback = revert PR + drop table. Decay aggregate qua tính lại points (KHÔNG xóa influence cũ). Catalog buff value cap 10% nhỏ-có-kiểm-soát; idempotent qua UNIQUE đảm bảo retry an toàn. Fail-soft buff hook không phá dungeon claim flow.

### Added — Phase 14.3.B Tribulation Support Providers and Breakthrough Redirect UX (this PR)

- **Hoàn thiện vòng chơi Thiên Kiếp** — Phase 14.3.A đã ship `previewTribulation()` + endpoint `GET /character/tribulation/preview` nhưng `supports[]` luôn empty và FE BreakthroughView chỉ toast lỗi `TRIBULATION_REQUIRED` khô khan khi player ấn "Đột phá" ở realm cao. Phase 14.3.B làm 2 việc song song: (1) ship 4 provider thực tế nạp `supports[]` từ catalog, (2) FE bắt 409 → toast info + redirect `/tribulation` để player thấy preview success chance + supports + nút "Vượt kiếp".
- **Shared providers (`packages/shared/src/tribulation-support-providers.ts`)** — pure read-only helper KHÔNG mutate state:
  - `collectItemTribulationSupports(inventoryEntries[])` — đọc `ItemDef.tribulationSupport.bonus` từ catalog cho item player đang có (qty>0). Item bonus áp dụng raw (KHÔNG consume preview).
  - `collectBuffTribulationSupports(activeBuffEntries[])` — đọc `BuffDef.tribulationSupport.bonus` từ buff đang active. Stack across nhiều buff khác nhau cùng key (1 entry/buff key).
  - `collectEquipmentTribulationSupports(equippedItems[])` — đọc `ItemDef.tribulationSupport.bonus` cho equipment đang đeo (slot map). Mỗi equipment 1 entry/key, dedup theo (slot, itemKey).
  - `collectTalentTribulationSupports(talents[], waveElements[])` — talent có `talentDef.tribulationResist?.element` match với BẤT KỲ wave element nào trong tribulation thì 1 entry. Multi-wave: dedup theo talent key, surface 1 entry/talent.
  - 23 unit test (catalog seed verify + zero-state + multi-source compose).
- **API (`TribulationService`)** — wire 4 provider vào `previewTribulation()`:
  - Inject `InventoryService?`/`BuffService?`/`TalentService?` qua constructor (Optional, fallback empty array khi missing — backward compat với legacy test).
  - `previewTribulation(characterId)` collect supports từ inventory entries + active buffs + equipment + talents, compose vào `successChance.supportBonus` (clamp tổng) + `supports[]` chi tiết per source. **KHÔNG** consume item / KHÔNG decrement buff / KHÔNG mutate state.
  - 8 test mới: preview supports populated từ item/buff/equipment/talent / multi-source compose / talent multi-wave dedup / no-mutation verify (snapshot inventory + buff trước/sau) / low-tier breakthrough vẫn null. Tổng 78 tribulation test PASS / 503 character module test PASS (no regression).
- **Catalog seed** — thêm `tribulationSupport` cho 1 item + 1 buff để gameplay path không trống:
  - `lei_kiep_phu` (item — Lôi Kiếp Phù): `tribulationSupport: { bonus: 0.05, element: 'kim' }`.
  - `thien_lei_phu` (buff — Thiên Lôi Phù): `tribulationSupport: { bonus: 0.05 }`.
- **FE — BreakthroughView (`apps/web/src/views/BreakthroughView.vue`)**: thêm catch `TRIBULATION_REQUIRED` trong `onAttempt()` → toast info `breakthrough.errors.TRIBULATION_REQUIRED` + `router.push('/tribulation')` thay cho toast warning lỗi khô khan. Low-tier breakthrough flow KHÔNG bị ảnh hưởng (path cũ vẫn chạy với toast warning cho NOT_AT_PEAK / IN_FLIGHT / etc.). 1 test mới phủ TRIBULATION_REQUIRED → toast info + router push.
- **FE — TribulationView preview panel (`apps/web/src/views/TribulationView.vue`)**:
  - Update field name (Phase 14.3.A → 14.3.B): `successChance.affinity` → `elementAdjustment`, `successChance.supports` → `supportBonus`. Thêm `raw` / `floorHit` / `ceilHit` cho cap warning.
  - Render mỗi support entry với badge source (`tribulation.supportSource.{item|buff|equipment|talent|spirit_root}`) + label catalog name + element indicator nếu có + bonus % round.
  - Cap warning: render `tribulation.field.capWarningCeil` khi `ceilHit=true` ("Đã chạm trần bonus tối đa") hoặc `capWarningFloor` khi `floorHit=true`.
  - 4 test mới: support label + element badge / supportBonus row / ceil warning / floor warning. Tổng 76 TribulationView test PASS.
- **i18n parity vi/en** — `tribulation.field.supportBonus`, `capWarningCeil`, `capWarningFloor`, `tribulation.supportSource.*` (5 key), `tribulation.element.*` (5 key Ngũ Hành), `breakthrough.errors.TRIBULATION_REQUIRED`.
- **Verification**: shared typecheck + 23 provider test PASS / api typecheck + `--run tribulation` 78 PASS + `--run character` 503 PASS / web typecheck + `--run Tribulation` 147 PASS + `--run Breakthrough` 49 PASS / pnpm build ✅. **KHÔNG migration / KHÔNG schema** — chỉ thêm provider helper + wire constructor + catalog seed + FE template/test/i18n.

### Added — Phase 14.2.B Elemental Combat Data and Balance (this PR)

- **Ngũ Hành combat đi vào dữ liệu thật** — Phase 14.2.A foundation pipeline (compose 3 layer: skill element vs character primary/secondary + monster `elementalResist` + equipment `elementalAtkBonus`) đã wire trong combat service runtime nhưng **dữ liệu trống**: tất cả monster/boss `elementalResist` undefined, mọi equipment `bonuses.elementalAtkBonus` undefined → foundation pipeline noop. Phase 14.2.B ship data **thật** vào catalog + invariant test ép data tuân envelope đã chốt ở §2.9.3 BALANCE_MODEL.
- **Shared catalog data ship**:
  - `packages/shared/src/boss.ts` — thêm `elementalResist` cho 6 boss world/region (giữ floor `ELEMENT_MONSTER_RESIST_FLOOR=0.70` per §2.9.3): mỗi boss resist 1–2 hệ counter của hệ chính boss (e.g. boss hệ Hỏa resist hệ Thủy `0.7` + hệ Mộc `0.85`).
  - `packages/shared/src/monsters.ts` — thêm `elementalResist` cho 8 monster mid/late game tại các region đặc thù (`hoa_diem_son`, `kim_son_mach`, `thuy_long_uyen`, `moc_huyen_lam`, `hoang_tho_huyet`).
  - `packages/shared/src/items.ts` — thêm `bonuses.elementalAtkBonus` cho 6 equipment (3 weapon kim/moc/hoa + 3 amulet thuy/tho/kim) — per-item `[0.05, 0.10]` giữ ceil `ELEMENT_EQUIPMENT_ATK_BONUS_CEIL=0.10` per §2.9.3.
- **Shared invariant tests** (`packages/shared/src/__tests__/elemental-data.test.ts` — 35 case):
  - Catalog vs floor/ceil: ép mọi `BossDef.elementalResist[*]` ≥ `0.70` + mọi `ItemBonus.elementalAtkBonus[*]` ≤ `0.10` (catch outlier data từ designer trong tương lai).
  - Gear-stack 6-slot worst case: simulate player full-set 6 món cùng hệ → `composeEquipmentElementalAtkBonus` clamp ≤ `ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL=0.20`.
  - Anti-power-creep envelope: countered case + max bonus + min monster resist worst-case combo player thua vẫn `< 1.0×` (concretely `0.70 × 0.7 × 1.2 = 0.588×`) — KHÔNG có cách nào để player bypass counter loss bằng farm gear cùng hệ.
- **API combat integration tests** (`apps/api/src/modules/combat/combat.service.test.ts` Phase 14.2.B suite +5 case):
  - **Baseline** — counter skill (kim) vs monster vô resist + char không equip elementalAtkBonus → KHÔNG log "kháng hệ" / "Trang bị tăng" (foundation noop, threshold guard `resist < 0.95` hoặc `bonus ≥ 0.05` mới fire log).
  - **Equipment bonus** — char equip weapon `diem_phong_dao` (kim 0.05) → damage tăng + log "Trang bị tăng 5% sát thương hệ kim".
  - **Monster resist** — boss `kim_giap_la_ha` có resist hệ Thủy 0.85 → damage giảm vs skill thủy + log "kháng hệ thủy ×0.85".
  - **No double-apply** (deterministic `Math.random=0.5`, `tien` grade statBonusPercent 18%, weapon `diem_phong_dao` kim 0.05 vs `thanh_mang_xa` moc no resist) → expected `dmg = round(448 × 1.40 × 1.0 × 1.0 × 1.05) = 659` integer match. Verify pipeline KHÔNG re-apply base counter ×1.30 lần 2.
  - **Null-element skill** (e.g. talent vô element) → foundation pipeline noop (resist/bonus không áp dụng), KHÔNG fire log thừa.
- **FE polish** — `apps/web/src/views/InventoryView.vue`:
  - Thêm tooltip line "+X% sát thương skill hệ {Element}" cho equipment có `bonuses.elementalAtkBonus` (song song với `elementResist` đã có từ Phase 11.6.E pattern).
  - i18n vi/en parity key mới `inventory.bonus.elementalAtkBonus`.
  - +3 InventoryView test (single bonus / multi-element / KHÔNG bonus → KHÔNG render line).
- **Verification**: shared typecheck + 1685+ PASS (catalog floor/ceil invariant) / api typecheck + `--run combat` PASS (Phase 14.2.B suite +5) / web typecheck + `--run InventoryView` 57 PASS / pnpm build ✅. **KHÔNG migration / KHÔNG schema / KHÔNG đụng combat pipeline runtime** (Phase 14.2.A đã wire) — chỉ thêm data + test integration + 1 FE tooltip line.
- **KHÔNG nới dial Phase 14.2.A** — `ELEMENT_MONSTER_RESIST_FLOOR=0.70`, `ELEMENT_EQUIPMENT_ATK_BONUS_CEIL=0.10`, `ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL=0.20`, `ELEMENT_COMBAT_ADJUSTMENT_FLOOR=0.50`, `ELEMENT_COMBAT_ADJUSTMENT_CEIL=1.60` giữ nguyên. Phase 14.2.C tương lai có thể tune theo metric thực tế khi player base lớn.

### Added — Phase 14.0.B Sect Territory Settlement and Region Ownership (PR #481)

- **Lãnh Địa Tông Môn — chiếm vùng thật** — Influence Leaderboard từ Phase 14.0.A giờ có thể được **kết toán (settlement)** thành quyền sở hữu vùng đất. Mỗi region có 1 `ownerSectId` hiện tại, kèm `periodKey` (ISO week hoặc admin-manual) và `settledAt`. Tông top influence trong vùng tại thời điểm settle sẽ chiếm vùng — nếu không có Tông nào ghi điểm thì vùng được skip (không có chủ).
- **Shared (`packages/shared/src/territory.ts`)** — extend layer 14.0.A:
  - Thêm 4 type DTO mới: `TerritorySettlementSnapshotView`, `TerritoryRegionHistoryView`, `TerritorySettlementRunResult`, `TerritoryRegionOwnerLite`. Extend `TerritoryRegionView` với `ownerSectId/ownerSectName/ownerPeriodKey/ownerSettledAt`.
  - 2 regex period validator: `TERRITORY_PERIOD_ISO_WEEK_RE` (`^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$`) + `TERRITORY_PERIOD_MANUAL_RE` (`^manual_[a-z0-9_-]{1,40}$`).
  - 3 helper pure: `isTerritoryPeriodKey(key)`, `territoryPeriodKeyForDate(date)` ISO 8601 week format `YYYY-Www` (handle year boundary), `previousTerritoryPeriodKey(now?)`. 6 unit test mới phủ catalog edge case + boundary.
- **Prisma model + migration**:
  - `SectTerritoryRegionState` (1 row / region): `regionKey @id`, `ownerSectId? FK SET NULL`, `ownerSectName?` denormalized, `periodKey?`, `settledAt`, `updatedAt`. Cho FE/runtime O(1) lookup chủ vùng hiện tại.
  - `SectTerritorySettlementSnapshot` (history per period): `id`, `regionKey`, `periodKey`, winner+runner-up denormalized id+name+points, `totalSects`, `totalPoints`, `settledAt`, `settledBy?` (admin/cron). UNIQUE `(regionKey, periodKey)` đảm bảo race-safe + idempotent.
  - Migration `20260608000000_phase_14_0_b_territory_settlement` thuần thêm 2 table mới — KHÔNG đụng `SectTerritoryInfluence` (giữ nguyên Phase 14.0.A data).
- **API runtime mới (`apps/api/src/modules/territory/territory-settlement.service.ts`)**:
  - `settleRegion(regionKey, periodKey, opts?)` — entry point chính. Idempotent qua UNIQUE: gọi 2 lần cùng `(regionKey, periodKey)` luôn return cùng snapshot id, KỂ CẢ KHI influence tăng giữa 2 call. Race-safe: 2 call đồng thời cùng key → 1 winner ghi, loser fetch lại row đã ghi (catch P2002). Skip empty regions: region không có influence → `skipped=true`, KHÔNG ghi snapshot/state. Tie-break deterministic: sect cùng điểm → `sectId.localeCompare` ASC chọn winner.
  - `settleAllRegions(periodKey)` — settle 9 region tuần tự, trả `TerritorySettlementRunResult { periodKey, settledAt, snapshots[], skippedRegions[] }`.
  - `getRegionHistory(regionKey, limit?)` — DESC theo `settledAt`, limit clamp 1..100 default 20. Throw `REGION_INVALID`.
  - `getOwnerStateMap()` — O(1) Map<regionKey, RegionState> cho enrichment + foundation cho region buff Phase 14.0.C.
- **API routes mới**:
  - `GET /territory/regions` extend trả `ownerSectId/ownerSectName/ownerPeriodKey/ownerSettledAt` per region.
  - `GET /territory/regions/:regionKey/history` (auth) — 404 `REGION_INVALID`.
  - `POST /admin/territory/settle?periodKey=…` (admin-only via `@RequireAdmin()` + `AdminGuard`) — fallback `previousTerritoryPeriodKey()` nếu không truyền `periodKey`. Non-admin → 403 `ADMIN_ONLY`. Validate `periodKey` qua `isTerritoryPeriodKey` trước khi gọi service.
  - `POST /admin/territory/regions/:regionKey/settle` (admin-only) — manual settle 1 region (dùng cho tie-break debug hoặc admin override).
- **FE layer**:
  - `apps/web/src/api/territory.ts` extend với 3 type + 3 fetcher: `getTerritoryRegionHistory(regionKey)`, `adminTerritorySettleAll(periodKey?)`, `adminTerritorySettleRegion(regionKey, periodKey?)`.
  - `apps/web/src/stores/territory.ts` extend với history cache (`Record<regionKey, TerritoryRegionHistoryView>`), `historyLoading/historyError` per-region, `settleLoading/settleError/lastSettleResult` admin state. `fetchHistory(regionKey, opts?)`/`adminSettleAll(periodKey?)`/`adminSettleRegion(regionKey, periodKey?)` race-protected (IN_FLIGHT guard).
  - `TerritoryView.vue`:
    - **Overview tab**: mỗi region row giờ có badge "Đang chiếm giữ" (chỉ render khi `ownerSectId`) + dòng "Chủ: {name} · Kết toán: {period}" / fallback "Chưa có chủ".
    - **Leaderboard tab**: thêm history panel hiển thị current owner header + DESC snapshots (winner / runner-up / points / period) + empty state + loading/error placeholder.
    - **Admin panel** (chỉ render khi `auth.user?.role === 'ADMIN'`): period text input (ISO week hoặc `manual_*`) + "Settle all" button + "Settle region" button (chỉ khi đã chọn region) + result summary "{period}: {wins} wins · {skip} skip" + error display.
  - i18n vi/en parity full key `territory.overview.{owner,noOwner,ownerSettled,ownerBadge}` + `territory.history.{title,empty,current,currentNone,row,rowNoRunner}` + `territory.admin.{title,subtitle,periodLabel,settleAll,settleRegion,running,lastResult}`.
- **Tests +56**:
  - Shared `--run territory` 23 PASS (+6 mới: ISO week regex match/reject, manual_xxx regex, isTerritoryPeriodKey, territoryPeriodKeyForDate ISO 8601, year-boundary 2025-12-29 → 2026-W01, previousTerritoryPeriodKey).
  - API `--run territory` 49 PASS — `territory-settlement.service.test.ts` +21 (empty skip, snapshot ghi + region state upsert, idempotent qua UNIQUE, idempotent kể cả khi influence tăng giữa 2 call, tie-break `localeCompare` ASC, điểm cao thắng + runner-up theo điểm, REGION_INVALID/PERIOD_INVALID throw, manual_xx accept, 2 period parallel update region state, settleAllRegions 1 winner + 8 skipped, idempotent settleAll, getRegionHistory DESC + empty + REGION_INVALID, getOwnerStateMap empty/match, TerritoryService.getRegions owner enrichment null/match) + `admin-territory.controller.test.ts` +12 (settleAll OK + fallback `previousTerritoryPeriodKey`, PERIOD_INVALID 400 trước khi gọi service, settleOne OK + skipped, REGION_INVALID 404, manual_xx accept, settledBy=req.userId, rethrow service errors).
  - API `--run admin` 356 PASS (admin guard non-admin reject covered cross-controller).
  - Web `--run Territory` 15 PASS (+8 mới: owner null không render badge, owner set → badge + "Chủ: {name}" + "Kết toán: {period}", history panel fetch on tab + DESC snapshots + empty state, admin panel hidden cho PLAYER, visible cho ADMIN, settle all → API call + result display, settle region → API call + history refresh, ADMIN_ONLY error fallback).
- **Verification**: shared typecheck + 1685 PASS / api typecheck + territory 49 + admin 356 PASS / web typecheck + Territory 15 PASS / lint clean / pnpm build ✅. KHÔNG xóa influence cũ trong PR này (rủi ro cao). Foundation cho region buff Phase 14.0.C: `getOwnerStateMap()` ready để combat layer query owner và apply buff.

### Added — Phase 14.0.A Sect Territory Influence Foundation (this PR)

- **Lãnh Địa Tông Môn — lớp ảnh hưởng vùng đất foundation** — Mỗi region (`MAP_REGIONS` 9 entry: son_coc, hac_lam, yeu_thu_dong, kim_son_mach, moc_huyen_lam, thuy_long_uyen, hoa_diem_son, hoang_tho_huyet, cuu_la_dien) giờ có **Sect Influence Leaderboard** riêng. Boss/dungeon trong region tự cộng điểm cho Tông của character clear/tham chiến — Tông nào hoạt động nhiều nhất sẽ rank cao trong vùng. **KHÔNG** có settlement capture / siege / region-wide buff / decay — defer Phase 14.0.B+ (cần cap thực tế + season reset thì cycling mới có ý nghĩa).
- **Shared (`packages/shared/src/territory.ts`)** — module mới chuyên trách lớp 14.0.A:
  - `TerritoryInfluenceSourceDef` (3 entry): `dungeon_clear` 8 pts (dailyCap 60, weeklyCap 420), `boss_participation` 12 pts (weeklyCap 96), `boss_top_damage` 20 pts (weeklyCap 80). Soft envelope tổng / character / region / week ≈ 596 pts.
  - `TerritoryRegionDef` parity 1-1 với `MAP_REGIONS`. `influenceCap = +Infinity` ở Phase 14.0.A (no enforcement).
  - Helpers: `territorySourceByKey()`, `territoryRegionByKey()`, `isTerritoryInfluenceSourceKey()`, `validateTerritoryCatalog()`, `territoryMaxPersonalPointsPerWeek()`. Pure, deterministic.
  - DTO interfaces cho 3 read endpoint: `TerritoryRegionView` / `TerritoryRegionsView` / `TerritoryLeaderboardRow` / `TerritoryLeaderboardView` / `TerritoryMyRegionRow` / `TerritoryMyView`. Re-export qua `packages/shared/src/index.ts`.
  - 16 unit test bao phủ catalog parity + region/source lookup + cap dial validation + envelope formula.
- **Prisma model + migration**:
  - `SectTerritoryInfluence` ledger row mới — `(regionKey, sectId, characterId, sourceKey, sourceType, sourceId, points, createdAt)`. Composite UNIQUE `(regionKey, characterId, sourceKey, sourceType, sourceId)` cho idempotency runtime hook. Index `(regionKey, sectId)` cho leaderboard groupBy + `(characterId, regionKey)` cho personal view.
  - Migration `20260607000000_phase_14_0_a_sect_territory_influence` thêm 1 table mới — KHÔNG đụng schema cũ. `wipeAll(prisma)` test helper cleanup row trước Character/Sect.
- **API mới (`apps/api/src/modules/territory`)**:
  - `TerritoryService.addInfluenceTx(tx, params)` — entry point duy nhất cho gameplay hook. Tx-aware (atomic với dungeon claim / boss reward parent flow). Idempotent qua composite UNIQUE — caller retry an toàn. Cap enforcement (daily/weekly) compute trước insert; reject = return null (no-op, gameplay flow vẫn thành công). Character không có sect → no-op skip. Region/source key invalid → no-op. **KHÔNG throw** — gameplay path không phá nếu territory ghi điểm fail.
  - `TerritoryService.getRegions()` → list 9 region + total influence + top sect snapshot. Region không có influence vẫn xuất hiện với `totalPoints=0`, `topSect=null`. Sort theo `MapRegionDef.sortOrder`.
  - `TerritoryService.getRegionLeaderboard(regionKey)` → top 10 sect trong region, descending điểm, tie-break sectId asc. Throw `REGION_INVALID` nếu key không hợp lệ.
  - `TerritoryService.getMyTerritory(userId)` → personal view: per-region rank/points của sect user + personal contribution. Character không có sect → `hasSect=false`, regions list đầy đủ với `sectPoints=0`, `sectRank=null`, `personalPoints` cá nhân. Throw `NO_CHARACTER` nếu user chưa onboard.
  - **`GET /territory/regions`** (auth) — wrap `getRegions`.
  - **`GET /territory/regions/:regionKey/leaderboard`** (auth) — wrap `getRegionLeaderboard`. 404 `REGION_INVALID`.
  - **`GET /territory/me`** (auth) — wrap `getMyTerritory`. 404 `NO_CHARACTER`.
  - 16 test mới (idempotency, cap enforcement, leaderboard correctness, personal view, no-sect handling, cross-region isolation).
- **Integration hooks (fail-soft pattern, mirror sect-war)**:
  - `DungeonRunService.claimRun()` — sau sect-war hook, gọi `territory.addInfluenceTx()` với `regionKey` từ `dungeonByKey(template).regionKey`. Legacy/non-region dungeon (no `regionKey`) skip. SourceId = `run.id` → composite UNIQUE đảm bảo claim retry không double điểm. `try/catch` swallow.
  - `BossService.distributeRewards()` — mọi participant rank 1+ gọi `boss_participation` hook; rank 1 thêm `boss_top_damage` bonus hook. RegionKey = `boss.regionKey` (legacy `'world'` skip vì không phải `MAP_REGIONS` region). SourceId = `${bossId}:${characterId}` → composite UNIQUE đảm bảo retry không double. `try/catch` swallow + warn log.
  - **KHÔNG** hook sect-mission — mission không gắn region (defer Phase 14.0.B+ nếu cần).
- **FE layer**:
  - `apps/web/src/api/territory.ts` — 6 interface mirror server DTO + 3 fetcher (`getTerritoryRegions`, `getTerritoryRegionLeaderboard(regionKey)`, `getTerritoryMe`). Read-only.
  - `apps/web/src/stores/territory.ts` — Pinia store `useTerritoryStore` với 3 fetcher race-protected (`IN_FLIGHT` guard) + leaderboard cache theo `regionKey` (chuyển tab giữa region không refetch).
  - `apps/web/src/views/TerritoryView.vue` — view mới với 3 tab: **overview** (region list + total influence + top sect), **leaderboard** (region picker + top 10 table với highlight my-sect row), **me** (per-region rank table cho sect user, fallback no-sect). Auth gate redirect `/auth`. Deep-link query `?tab=…&region=…`. `data-testid` đầy đủ.
  - Route `/territory` đăng ký trong `router/index.ts`.
  - i18n vi/en parity: `territory.title/subtitle/loading/tab/overview/leaderboard/me/source/errors`.
  - 7 FE test mới (auth gate / overview render / leaderboard fetch / region pick switch / me rank table / no-sect fallback / load error fallback).
- **Docs**: entry này + AI_HANDOFF_REPORT (phần "Recent Changes" dự kiến updater sau khi PR merge) + BALANCE_MODEL (territory dial table) + API.md (3 endpoint mới + breakthrough hook integration note).
- **Out of scope (Phase 14.0.A)**:
  - Decay theo thời gian / season reset persistence (defer 14.0.B+).
  - Settlement capture / siege flow / region-wide buff khi Tông giữ region (defer 14.x).
  - Region-buff khi Tông ở rank 1 (defer 14.0.C+).
  - Sect mission hook — mission không gắn region (defer cần thiết kế lại sect mission scope).
  - Admin tooling cho territory (recalc, audit snapshot).
- **Risk / rollback**: thấp. Lớp foundation thuần wrap với fail-soft hook; KHÔNG đụng dungeon/boss/sect-war reward path. Migration thuần thêm table mới, không sửa table cũ. Rollback = revert PR + drop bảng `SectTerritoryInfluence`.
- **Verification**: shared `--run territory` 16 PASS ✅ / api `--run territory` 16 PASS ✅ / api `--run dungeon-run` 50 PASS ✅ / api `--run boss` 117 PASS ✅ / api `--run sect` 146 PASS ✅ / web `--run Territory` 7 PASS ✅. Web `typecheck` PASS ✅.

### Added — Phase 14.3.A Breakthrough Tribulation Foundation (this PR)

- **Đột phá cảnh giới giờ có lớp Thiên Kiếp gating chính thức** — Phase 11.6.A đã ship catalog `TribulationDef` (8 entry: kim_dan→nguyen_anh, nguyen_anh→hoa_than, hoa_than→luyen_hu, luyen_hu→hop_the, hop_the→dai_thua, dai_thua→do_kiep, do_kiep→nhan_tien, chuan_thanh→thanh_nhan) + Phase 11.6.B đã ship runtime `attemptTribulation()` (8 wave deterministic + reward + Tâm Ma penalty). Phase 14.3.A bổ sung **lớp foundation** mỏng để: (1) UI biết trước cảnh giới kế tiếp có cần kiếp không; (2) UI ước lượng % thành công trước khi vượt; (3) breakthrough endpoint từ chối bypass khi realm yêu cầu kiếp. KHÔNG rewrite Phase 11.6.B — chỉ wrap thêm helpers + 1 endpoint preview + 1 gate.
- **Shared (`packages/shared/src/tribulation-foundation.ts`)** — module mới chuyên trách lớp 14.3.A:
  - `tribulationRequiredForBreakthrough(fromRealmKey, toRealmKey)` → boolean. Lookup `TRIBULATIONS` catalog; trả `true` ↔ catalog có entry `(fromRealmKey, toRealmKey)`. Pure, deterministic.
  - `composeTribulationSupports(entries)` → `{ entries[], totalBonus }`. Additive bonus từ items/buffs/talents/equipment. Per-entry cap `TRIBULATION_SUPPORT_PER_ENTRY_CEIL=0.10`, total cap `TRIBULATION_SUPPORT_TOTAL_CEIL=0.30` — chống stack vô hạn.
  - `computeTribulationSuccessChance({ def, primaryElement, supportTotalBonus })` → `{ base, affinity, supports, final }`. Base theo `severity` (`minor=0.75 / major=0.55 / heavenly=0.35 / saint=0.20`). Affinity ±0.05 nếu primary spirit-root khắc/bị khắc kiep element (dùng `elementalAdvantage` từ Phase 14.2.A). Final clamp envelope `[TRIBULATION_SUCCESS_CHANCE_FLOOR=0.05, TRIBULATION_SUCCESS_CHANCE_CEIL=0.95]` — giữ tension, KHÔNG cho 0%/100%.
  - `summarizeTribulationRewardHint(def)` / `summarizeTribulationPenaltyHint(def)` — pure shape compactor cho FE preview panel (không snapshot RNG).
  - Re-export qua `packages/shared/src/index.ts`. 25 unit test bao phủ catalog detection / cap clamp / chance envelope / element affinity / hint shape.
- **API mới (`apps/api/src/modules/character`)**:
  - `TribulationService.previewTribulation(characterId)` → `TribulationPreview | null`. Read-only deterministic snapshot — KHÔNG roll RNG, KHÔNG ghi `TribulationAttemptLog`. Fetch character → tính `nextRealmKey` từ `realms.ts` ladder → nếu transition không có catalog entry (low-tier hoặc realm cuối) trả `null`. Có entry → compose supports (Phase 14.3.A: empty list — defer per-source provider) → compute success chance → trả `{ requirement: true, fromRealmKey, toRealmKey, atPeak, def, successChance, supports[], supportTotalBonus, rewardHint, penaltyHint, cooldownAt, taoMaUntil }`.
  - **`GET /character/tribulation/preview`** (auth) — wrap `previewTribulation`. Idempotent. Server-authoritative.
  - **`CharacterService.breakthrough()` add `TRIBULATION_REQUIRED` gate** — trước khi cấp realm mới, check `tribulationRequiredForBreakthrough(currentRealm, nextRealm)`. Nếu `true` → throw `TRIBULATION_REQUIRED` (FE catch và redirect tới `/tribulation`). Low-tier transition (luyenkhi→truc_co, truc_co→kim_dan) tiếp tục dùng breakthrough thường. Phase 14.3.A KHÔNG đụng pipeline cũ — chỉ thêm 1 guard sớm.
  - 18 test mới (13 tribulation preview + 5 character service gate). Tổng 114 character/tribulation test pass.
- **FE layer**:
  - `apps/web/src/api/tribulation.ts` — bổ sung 7 interface mirror server preview shape (`TribulationPreviewView` + 5 sub-shape) + `fetchTribulationPreview()` client. BigInt-safe (`expBonus` là string).
  - `apps/web/src/stores/tribulation.ts` — thêm `preview: TribulationPreviewView | null | undefined` (3-state: chưa fetch / không cần kiếp / có kiếp), `previewLoading`, `previewError`, action `fetchPreview()` race-protected (`IN_FLIGHT` guard). `reset()` clear preview state.
  - `apps/web/src/views/TribulationView.vue` — `onMounted` gọi `fetchPreview()` song song `fetchHistory()`. Bổ sung **preview panel** trong upcoming card hiển thị `final %` (round), affinity badge ±5% (chỉ render khi affinity ≠ 0), supports list (foundation phase rỗng → empty hint), `data-testid` đầy đủ.
  - i18n vi/en parity: `tribulation.field.previewTitle` / `successChance` / `affinity` / `supports` / `supportsEmpty`.
  - 16 FE test mới (7 store fetchPreview + 9 view preview panel). Tổng 143 tribulation FE test pass.
- **Docs**: entry này + AI_HANDOFF_REPORT + BALANCE_MODEL (dial table) + API.md (preview endpoint).
- **Out of scope (Phase 14.3.A)**: per-source support provider (item/buff/talent/equipment registry), preview cooldown auto-refresh khi state thay đổi, multi-character support, advanced tribulation UI (countdown / element pictogram lớn).
- **Risk / rollback**: thấp. Lớp foundation thuần wrap; không migration; không đụng RNG/log path. Rollback = revert PR. Đã verify breakthrough cũ vẫn work (low-tier `truc_co → kim_dan` không bị block).
- **Verification**: shared `--run tribulation-foundation` 25 PASS ✅ / api `--run tribulation` 70 PASS ✅ / api `--run character.service` 44 PASS ✅ / web `--run tribulation` 143 PASS ✅.

### Added — Phase 14.2.A Elemental Combat Foundation (PR #477)

- **Ngũ Hành đi vào combat** — Skill / monster / equipment vốn đã có `element` (Phase 10/11) giờ thực sự ảnh hưởng damage qua một lớp "foundation" mỏng: skill cùng hệ với spirit-root nhân nhẹ (đã có Phase 11), thêm monster có `elementalResist` cản skill nhất định, trang bị có `elementalAtkBonus` cộng nhẹ % sát thương cho 1 hệ. Toàn bộ pipeline clamp envelope `[0.5×, 1.6×]` — KHÔNG phá balance hiện tại; monster/equipment chưa khai báo dữ liệu sẽ rơi về neutral 1.0×.
- **Shared (`packages/shared/src/elemental.ts`)** — module mới chuyên trách lớp 14.2.A:
  - `ElementType` (`WOOD/FIRE/EARTH/METAL/WATER`) alias English bổ sung cho `ElementKey` (`kim/moc/thuy/hoa/tho`) Vietnamese sẵn có; converter `elementTypeToKey` / `elementKeyToType` round-trip; `parseElementType` permissive (chấp nhận lowercase/null/undefined/garbage → null an toàn).
  - `elementalAdvantage(attacker, defender)` trả về `'counter' | 'generate' | 'countered' | 'generated' | 'same' | 'neutral'` mô tả chu trình tương sinh / tương khắc.
  - `elementalMultiplier(attacker, defender)` → number, neutral 1.0 nếu thiếu element, counter 1.5×, countered 0.7×, generate 1.1×, generated 0.9× (giữ envelope nhẹ, nằm trong `[0.6, 1.5]`).
  - `composeMonsterElementalResist(resist, skillElement)` — null/empty/skill vô hệ → 1.0×; clamp floor `ELEMENT_MONSTER_RESIST_FLOOR=0.7` chống gear-check đơ.
  - `composeEquipmentElementalAtkBonus(bonuses[], skillElement)` — additive stack giữa nhiều món, per-item cap `ELEMENT_EQUIPMENT_ATK_BONUS_CEIL=0.10`, total cap `ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL=0.20`.
  - `applyElementalCombatAdjustment({ skillElement, attackerPrimary, attackerSecondary, defenderElement, monsterResist, equipmentBonuses })` — pipeline 3 lớp: (1) base advantage × character spirit-root bonus, (2) × monster resist, (3) × `(1 + equipBonus)`; clamp final `[ELEMENT_COMBAT_ADJUSTMENT_FLOOR=0.5, ELEMENT_COMBAT_ADJUSTMENT_CEIL=1.6]` + return metadata `{ multiplier, advantage, monsterResistMul, equipBonus }` cho combat log.
  - 51 unit test bao phủ converter round-trip / parser permissive / cycle Ngũ Hành / clamp / cap / dial sanity.
- **Shared types**:
  - `MonsterDef.elementalResist?: Partial<Record<ElementKey, number>>` — multiplier `≤ 1` cho từng skill element. Khác với `MonsterDef.element` (affinity của chính monster) — `elementalResist` là **kháng** vs incoming skill element. Vd boss băng `huyen_bang_kiep_lang` có `element='thuy'` + `elementalResist={ hoa: 0.85 }` (kháng 15% sát thương Hoả). Floor đã clamp sẵn nên data sai cũng không phá game.
  - `ItemBonus.elementalAtkBonus?: ElementalAtkBonus` — record `Partial<Record<ElementKey, number>>` cộng % atk cho hệ tương ứng. Thiết kế: dùng cho ngọc/pháp khí buff hệ, không phải atk gốc — KHÔNG đụng các bonus vốn có (atk/def/hpMax/...).
  - `ELEMENTS` constant array (`['kim','moc','thuy','hoa','tho']`) export thêm cho FE iterate.
- **API combat (`apps/api/src/modules/combat/combat.service.ts`)** — wire `applyElementalCombatAdjustment` vào damage flow trong `action()` (skill path) và `actionViaActiveTalent()` (talent path) với parity. Pipeline: (a) lấy `skillElement` / `talentElementKey` từ catalog, (b) lấy character primary/secondary spirit-root từ `getOrCreateSpiritRootSet`, (c) lấy `monster.elementalResist`, (d) gọi `inventory.equipElementalAtkBonus(characterId, element)` → tổng cap'd, (e) compose qua `applyElementalCombatAdjustment` → multiplier × `Math.max(1, atk - def)`. Bảo toàn nhân `characterSkillElementBonus` (Phase 11) — KHÔNG double-apply.
- **API combat log** — non-trivial event mới (skip khi neutral 1.0×):
  - `monsterResistMul < 0.95` → `"<monster> kháng hệ <element> ×0.85."`
  - `equipBonus ≥ 0.05` → `"Trang bị tăng 8% sát thương hệ <element>."`
- **API inventory (`apps/api/src/modules/inventory/inventory.service.ts`)** — thêm `equipElementalAtkBonus(characterId, skillElement)` đọc các slot equipped, gom `bonuses.elementalAtkBonus` của từng item, gọi `composeEquipmentElementalAtkBonus` (cap'd) → trả về số cộng additive cho combat.
- **FE component `apps/web/src/components/ElementBadge.vue`** — atom hiển thị Ngũ Hành affinity:
  - Props: `element` (ElementKey | ElementType | string | null, permissive), `showNeutral` (default `false`), `size` (`sm`/`md`).
  - i18n namespace `elementBadge.element.<key>` + `elementBadge.neutral` (vi/en parity).
  - Color coding: kim → ink-200, moc → emerald-300, thuy → sky-300, hoa → rose-300, tho → amber-300; neutral → ink-300.
  - `data-testid="element-badge-<key>"` + `data-element` attribute cho test stable.
  - 26 test bao phủ render rules / parse permissive / color class / size variant.
- **FE views integration**:
  - `SkillBookView.vue` — replace inline element span bằng `<ElementBadge>` (giữ nguyên `data-testid="skill-book-element-<key>"`, hiện neutral khi skill vô hệ).
  - `DungeonView.vue` — thêm badge cạnh tên monster (chỉ render khi monster có element, no badge cho monster vô hệ — giữ UI compact).
- **Docs**:
  - `docs/BALANCE_MODEL.md` — bổ sung mục "Phase 14.2.A — Elemental combat foundation dials" liệt kê 5 dial mới + envelope final clamp + ý nghĩa.
  - `docs/AI_HANDOFF_REPORT.md` — entry "Phase 14.2.A".
  - `docs/CHANGELOG.md` — entry này.
- **Out of scope (Phase 14.2.A)**: rewrite combat pipeline, Spiritual Root runtime mở rộng (vẫn dùng Phase 11), data populate `elementalResist` cho toàn bộ monster catalog, populate `elementalAtkBonus` cho item catalog (data PR sau, foundation đã sẵn), large UI refactor.

### Added — Phase 12.10.B NPC Gift and Quest Affinity Rewards (this PR)

- **Tặng quà NPC + nhiệm vụ tăng affinity** — Mở rộng Phase 12.10.A: bây giờ player có thể tặng item từ inventory cho NPC để tăng `affinity` (giới hạn `dailyLimit` per NPC/character/day), và một số quest reward chính tuyến cộng thẳng affinity cho NPC liên quan. Cả 2 path đều atomic + idempotent + respect cap Phase 12.10.A (`AFFINITY_DELTA_CAP_PER_QUEST_REWARD = 40`).
- **Shared catalog** (`packages/shared/src/npc-gift.ts` mới):
  - `NpcGiftPreferenceDef { npcKey, dailyLimit, acceptedItems[], loreNote, loreNoteEn }` — mỗi NPC có 3–4 item tương xứng theo personality (Lăng Vân Sinh nhận đan dược chính phái + sách kiếm phổ; Mộc Thanh Y nhận thảo dược; Tô Nguyệt Ly nhận ngọc; v.v.).
  - `NpcAcceptedGiftItem { itemKey, affinityMin, affinityMax, flavor, flavorEn }` — affinity range per item (vd Lăng Vân Sinh nhận `linh_lo_dan` cho `[5..8]`); service runtime random uniform trong khoảng đó.
  - 5 NPC catalog parity với Phase 12.10.A (Lăng Vân Sinh / Mộc Thanh Y / Hàn Dạ / Tô Nguyệt Ly / Huyết La Sát) — mỗi NPC `dailyLimit ∈ [3..5]`, totalDailyMaxAffinity ≤ `NPC_GIFT_AFFINITY_DELTA_CAP_PER_GIFT × dailyLimit = 8 × 5 = 40` ≤ Phase 12.10.A daily ceiling.
  - Constant `NPC_GIFT_AFFINITY_DELTA_CAP_PER_GIFT = 8` + `NPC_GIFT_DAILY_LIMIT_CAP = 5` — ép catalog không drift.
  - Helpers `npcGiftPreferenceForKey` / `validateNpcGiftCatalog` / `acceptedGiftItemFor` — pure read-only.
- **Quest reward affinity** (`packages/shared/src/quests.ts`):
  - `QuestRewardDef.affinity?: QuestAffinityRewardDef[]` — array entry `{ npcKey, delta }`. Validate `|delta| ≤ AFFINITY_DELTA_CAP_PER_QUEST_REWARD` + `npcKey ∈ NPC_AFFINITY`.
  - 6 quest sample mỗi realm có affinity rewards (`phamnhan_main_01` +5 Lăng Vân Sinh / +3 Mộc Thanh Y, `tutien_main_01` thêm Tô Nguyệt Ly, v.v.) — minh hoạ flow + làm seed cho narrative designer mở rộng sau.
- **Prisma migration `20260609000000_phase_12_10_b_character_npc_gift_log`**: thêm 1 table `CharacterNpcGiftLog` (`id` PK / `characterId` FK cascade / `npcKey` / `itemKey` / `affinityDelta` / `dayBucket` `YYYY-MM-DD` UTC / `sequence` Int / `createdAt`) + composite UNIQUE `(characterId, npcKey, dayBucket, sequence)` chống race-double-insert + index `(characterId, dayBucket)` cho daily count query. Additive — KHÔNG đụng `CharacterNpcAffinity` (Phase 12.10.A) / `Inventory*` runtime model.
- **API mới**:
  - `NpcAffinityService.giftNpc({ characterId, npcKey, itemKey, now? })` — atomic transaction:
    1. Validate NPC ∈ `NPC_AFFINITY` + có gift catalog (`NPC_GIFT_NOT_CONFIGURED` nếu thiếu).
    2. Validate `itemKey ∈ acceptedItems[npcKey]` (`ITEM_NOT_ACCEPTED`).
    3. Count `CharacterNpcGiftLog` hôm nay (UTC bucket) — `DAILY_LIMIT_REACHED` nếu đạt `dailyLimit`.
    4. Inventory `consume(characterId, itemKey, qty=1, reason='NPC_GIFT')` — throw `ITEM_NOT_IN_INVENTORY` nếu không đủ.
    5. Compute random `affinityDelta` ∈ `[affinityMin, affinityMax]`, clamp ≤ `NPC_GIFT_AFFINITY_DELTA_CAP_PER_GIFT`.
    6. `addAffinityTx(tx, { characterId, npcKey, delta, source: 'NPC_GIFT' })` — apply qua Phase 12.10.A path.
    7. Insert `CharacterNpcGiftLog` row với `sequence = count + 1`. P2002 (race) → retry 1 lần với count mới.
    8. Return view `{ npcKey, itemKey, affinityDelta, previousScore, newScore, tierChanged, dayBucket, sequence, remainingToday, dailyLimit }`.
  - `NpcAffinityService.getDailyGiftCounts(characterId, now?)` — Map<npcKey, { used, limit, remaining }> cho FE locked state badge.
  - `NpcAffinityService.dayBucketFor(date)` static helper UTC `YYYY-MM-DD`.
  - **`POST /story/npc-affinity/:npcKey/gift`** (auth) → body `{ itemKey }`, response `{ affinity: NpcAffinityView, gift: NpcGiftResultView }`. Status 4xx mã: `NPC_GIFT_NOT_CONFIGURED` / `ITEM_NOT_ACCEPTED` / `ITEM_NOT_IN_INVENTORY` / `DAILY_LIMIT_REACHED` / `INVALID_INPUT`.
  - **`GET /story/npc-affinity/gift/daily`** (auth) → list daily counts cho TẤT CẢ NPC trong catalog; FE dùng để render `usedToday/dailyLimit` indicator + lock button khi `remaining = 0`.
- **Quest claim affinity reward** (`apps/api/src/modules/quest/quest.service.ts`):
  - `claim()` sau CAS guard (status `COMPLETED` → `CLAIMED` + `claimedAt` set) đi qua nhánh mới: nếu `def.rewards.affinity?.length > 0` → loop apply `npcAffinity.addAffinityTx(tx, { characterId, npcKey, delta, source: 'QUEST_REWARD:<key>' })`. CAS guard đảm bảo idempotent — call lần 2 → `QUEST_ALREADY_CLAIMED`, KHÔNG double-grant affinity (verified bằng concurrency test 2 parallel claim → 1 fulfilled / 1 rejected, score chỉ +delta đúng 1 lần).
  - `QuestService.claim()` constructor inject `NpcAffinityService`. `QuestModule` providers append, `test-helpers.makeQuestService` wire production-shape.
  - Response `claimQuest()` thêm field `granted.affinity[]` cho FE toast tier-up sau claim.
- **FE gift action**:
  - `apps/web/src/components/NpcAffinityPanel.vue` — section gift mới ở mỗi card NPC: select item dropdown (label = item name + range `(N–M)`) + button "Trao quà" + daily indicator "Hôm nay X/Y" + lore note italic (per-NPC tone). Toast `+N thân tình` (auto-dismiss 3.5s) + tier-up badge khi `tierChanged=true`. Locked state khi `remainingToday = 0` → button disabled label "Hết lượt (X/Y)". Inline error code-mapped (`ITEM_NOT_IN_INVENTORY` / `DAILY_LIMIT_REACHED` / etc.) khi reject.
  - `apps/web/src/api/npcAffinity.ts` thêm `giftNpc` / `fetchNpcGiftDaily` + types `NpcGiftResultView` / `NpcGiftDailyCount`.
  - `apps/web/src/stores/npcAffinity.ts` thêm `dailyCounts` map + `dailyLoaded` flag + `giftLoading` (npcKey đang gift) + `giftError` + `lastGift` + `loadDaily()` / `giftNpc(npcKey, itemKey)` / `clearLastGift()` / `dailyFor(npcKey, fallbackLimit)`. Sau success: in-place update affinity row + dailyCounts row — KHÔNG full reload.
  - i18n vi/en parity: `npcAffinity.giftLabel/giftButton/giftLocked/giftDaily/giftSuccess/giftTierUp/giftErrors.*` (8 code error mapping).
- **Tests +27**:
  - **Shared** (`packages/shared/src/npc-gift.test.ts` mới, +9 case): catalog invariant (acceptedItems unique / item key ∈ ITEMS / affinityMin ≤ affinityMax / dailyLimit ≤ cap / npcKey ∈ NPC_AFFINITY); `validateNpcGiftCatalog` reject duplicate / invalid item / over-cap delta; `npcGiftPreferenceForKey` happy + miss; `acceptedGiftItemFor` happy + miss.
  - **API** (`apps/api/src/modules/npc-affinity/npc-affinity.service.test.ts` extend, +8 case): gift success consume 1 stack + add affinity + log row + ItemLedger `NPC_GIFT` + view fields; reject `ITEM_NOT_IN_INVENTORY` (no leak log/affinity); reject `ITEM_NOT_ACCEPTED` (no consume); reject `NPC_GIFT_NOT_CONFIGURED`; reject `DAILY_LIMIT_REACHED` sau `dailyLimit` lần thành công; daily reset (dayBucket khác → sequence reset); `getDailyGiftCounts` used/limit/remaining; `dayBucketFor` UTC ISO boundary.
  - **API** (`apps/api/src/modules/quest/quest.service.test.ts` extend, +4 case): claim trả `granted.affinity` + lazy-create row CharacterNpcAffinity; claim lần 2 throws `QUEST_ALREADY_CLAIMED` + KHÔNG double-grant; concurrency 2 parallel claim → 1 fulfilled + score +delta đúng 1 lần (CAS guard); quest không có `rewards.affinity` → `granted.affinity = []`.
  - **FE** (`apps/web/src/components/__tests__/NpcAffinityPanel.test.ts` extend, +6 case): render gift section (button + select + daily indicator); click gift button → store.giftNpc + toast "+N" + daily indicator update + score in-place; toast tier-up khi `tierChanged=true`; locked state khi `remainingToday=0` (button disabled + "Hết lượt"); inline error `ITEM_NOT_IN_INVENTORY` không toast / không daily update; autoLoad gọi `loadDaily()` mount.
- **Verification**: shared typecheck + 9 catalog test PASS / api typecheck + `--run npc-affinity` 25 PASS + `--run quest` 73 PASS / web typecheck + `--run NpcAffinity` 18 PASS / pnpm build ✅.
- **Out of scope (Phase 12.10.B)**: NPC gift shop UI (catalog browse trong panel), gift refund/un-gift, gift cooldown ngoài daily (e.g. weekly tier-gate), affinity decay per-day, NPC counter-gift (NPC tặng lại player), audit dashboard cho gift abuse.

### Added — Phase 12.10.A NPC Affinity & Relationship Foundation (this PR)

- **NPC giờ có điểm thân tình (affinity) riêng** — Mở nền móng quan hệ NPC: mỗi (character, NPC) có 1 điểm số từ `minScore..maxScore` (per-NPC catalog), tăng/giảm qua dialogue choice + future quest reward, vượt mốc `AFFINITY_TIERS` (Xa Lạ → Quen Biết → Bằng Hữu → Tri Giao → Tri Kỷ) sẽ unlock dialogue/quest mới. Phase 12.10.A KHÔNG ship gift/shop NPC — chỉ foundation runtime + FE relationship panel + dialogue change_affinity hook.
- **Shared catalog** (`packages/shared/src/npc-affinity.ts`):
  - `AffinityTierDef` 5 tier universal `xa_la`(-1000) / `quen_biet`(10) / `ban_huu`(30) / `tri_giao`(60) / `tri_ky`(100), `order` 0..4 stable, label vi/en parity.
  - `NpcAffinityDef` per-NPC: `initialScore` / `minScore` / `maxScore` / `unlockHints[]` (mỗi hint gắn `tierKey` + i18n description). Catalog 5 NPC trụ cột (Lăng Vân Sinh / Mộc Thanh Y / Hàn Dạ / Tô Nguyệt Ly / Huyết La Sát) với cap min/max khác nhau theo bản chất (đồng môn ≤ 200, rival ≤ 150, ma tu ≤ 100; floor -50 đến -100).
  - Helpers `affinityTierForScore` / `nextAffinityTierForScore` / `npcAffinityDefForKey` / `clampAffinityScore` / `validateNpcAffinityCatalog` — pure, KHÔNG đụng runtime.
  - Hard cap `AFFINITY_DELTA_CAP_PER_CHOICE = 20` + `AFFINITY_DELTA_CAP_PER_QUEST_REWARD = 40` — validator + service runtime double-check chống farm.
  - Dialogue effect mới `change_affinity { npcKey, delta }` + condition mới `affinity_min { npcKey, score }` (trong `story-dialogues.ts`); validator catalog kiểm tra `delta` trong cap + npcKey ∈ catalog.
  - Test catalog Hàn Dạ +2 node (`story_dlg_han_da_friendly_chat` với choice `+10` warm / `-5` cold, `story_dlg_han_da_inner_secret` gate `affinity_min:han_da≥30`) — minh hoạ full flow.
- **Prisma migration `20260606000000_phase_12_10_a_character_npc_affinity`**: thêm 1 table `CharacterNpcAffinity` (`id` PK / `characterId` FK cascade / `npcKey` / `score` Int / `createdAt` / `updatedAt`) + composite UNIQUE `(characterId, npcKey)` + index `(characterId)` cho list view + `(npcKey)` cho admin audit. Additive — KHÔNG đụng `Character` / `StoryDialogue` runtime model.
- **API mới**:
  - `NpcAffinityService.addAffinityTx(tx, { characterId, npcKey, delta, source })` — atomic upsert + clamp `[minScore, maxScore]` + return tier diff (`previousTier` / `newTier` / `tierChanged`). Caller chịu trách nhiệm idempotency guard.
  - `NpcAffinityService.addAffinity(...)` — convenience wrapper mở `$transaction` mới (admin/test path).
  - `NpcAffinityService.listForCharacter(characterId)` / `getForNpc(characterId, npcKey)` / `loadScoreMap(characterId)` — read view, lazy fallback `initialScore`.
  - **`GET /story/npc-affinity`** (auth) → list affinity cho TẤT CẢ NPC trong catalog `NPC_AFFINITY` (lazy fallback `initialScore` khi chưa có row), kèm `caps: { perChoice, perQuestReward }`.
  - **`GET /story/npc-affinity/:npcKey`** (auth) → get single NPC affinity view (`score` / `currentTier` / `nextTier` + `pointsToReach` / `unlocks[]` với `reached` flag).
- **Story dialogue integration** (`apps/api/src/modules/story-dialogue/story-dialogue.service.ts`):
  - `evaluateCondition` handle `affinity_min` (lookup `CharCtx.affinityByNpc`).
  - `applyChoice` apply `change_affinity` effect bên trong cùng `$transaction` với `give_reward` / `set_flag` / `mark_seen` — atomic. Pre-flight cap check `|delta| ≤ AFFINITY_DELTA_CAP_PER_CHOICE`.
  - **Idempotency**: dialogue choice retry KHÔNG double-grant — `change_affinity` được kê vào `hasGrantEffect` nhánh, `seen.includes(node.id)` → throw `ALREADY_APPLIED` mirror pattern `give_reward`.
  - `loadCtx` load affinity score map qua `NpcAffinityService.loadScoreMap`.
  - Response `StoryDialogueChoiceResult.affinityChanges[]` (1 entry / `change_affinity` effect đã apply): `{ npcKey, delta, previousScore, newScore, tierChanged, previousTierKey, newTierKey, newTierLabel }` cho FE toast + tier-up badge.
- **FE relationship panel + dialogue affinity feedback**:
  - `apps/web/src/components/NpcAffinityPanel.vue` mới — list 5 NPC từ catalog với name + score progress bar (`(score - min) / (max - min)` × 100%) + current tier label + next tier hint ("Còn X điểm để lên Y") + unlock list (per tier; `reached` ✓ marker) + max-tier reached state. `data-testid` đầy đủ cho test.
  - `apps/web/src/api/npcAffinity.ts` API client (`fetchNpcAffinities` / `fetchNpcAffinity`) + `apps/web/src/stores/npcAffinity.ts` Pinia store (`load` / `refresh` / `findByNpcKey` / `reset`).
  - `NpcView.vue` mount `NpcAffinityPanel` + auto-refresh sau dialogue effect apply.
  - `StoryDialogueModal.vue` show toast `+N thân thiện` + tier-up toast khi `tierChanged=true`.
  - i18n vi/en parity: `npcAffinity.title/subtitle/empty/nextTierHint/maxTierReached/errors.*` + `storyDialogue.affinityDelta/tierUp`.
- **Tests +43**:
  - **Shared** (`packages/shared/src/npc-affinity.test.ts` mới + `story-dialogues.test.ts` extend, +18+5=23 case): catalog invariant (5 NPC ∈ NPCS / unique / min<max / initialScore in bounds / unlockHints tier valid); tier ladder integrity (order 0..4 / strict ascending minScore); `affinityTierForScore` boundary (xa_la / quen_biet / ban_huu / tri_giao / tri_ky); `nextAffinityTierForScore` (max → null); `clampAffinityScore`; story-dialogue validator cover `change_affinity` cap + `affinity_min` npcKey ∈ catalog.
  - **API** (`apps/api/src/modules/npc-affinity/npc-affinity.service.test.ts` mới + `story-dialogue.service.test.ts` extend): service add lazy-create + positive/negative delta + clamp min/max + INVALID_DELTA + CAP_EXCEEDED + NPC_AFFINITY_UNKNOWN + tierChanged detection + listForCharacter fallback initialScore + getForNpc fallback + loadScoreMap + resolveScore static helper; dialogue affinity integration `+10` warm choice persisted, `-5` cold choice persisted, retry `ALREADY_APPLIED` no double-grant, `affinity_min` gate hide locked node + reject `INVALID_CHOICE` reason `affinity_min`, seed score ≥30 unlock node + apply effects, tier-cross detection `xa_la → quen_biet`.
  - **FE** (`apps/web/src/components/__tests__/NpcAffinityPanel.test.ts` mới, +12 case): empty/loading/error state; render NPC name+score+tier+next-hint+unlocks; max-tier render; progress bar width math; refresh button; autoLoad mount; store load/error/findByNpcKey/reset.
- **Risk / rollback**: thấp. 1 migration mới (additive table), KHÔNG đụng `Character` / `StoryDialogue` schema. Rollback = revert PR + drop `CharacterNpcAffinity`. Story dialogue integration backward-compatible — choice không có `change_affinity` / node không có `affinity_min` → 0 effect.
- **Out of scope** (defer Phase 12.10.B): NPC gift system, NPC shop, quest reward `change_affinity` (quest catalog chưa support `affinityRewards`), affinity ledger truy vết granular, admin grant endpoint.
- **Verification**: shared typecheck ✅ / shared 1580 PASS ✅ / api typecheck ✅ / web typecheck ✅ / web `--run NpcAffinity StoryDialogue` 26 PASS ✅ / pnpm build (pending CI).

### Added — Phase 13.2.B Sect Season Milestones + Rewards (this PR)

- **Sect Season giờ có claim thưởng thật** — Phase 13.2.A đã ship foundation read-only (13 mùa × 4 tuần, 5 tier milestone catalog). Phase 13.2.B mở claim runtime: player đạt milestone (bronze 100pt → silver 500pt → gold 1500pt → platinum 3500pt → diamond 7500pt) bấm nút **Nhận thưởng** để nhận `linhThach` / `tienNgoc` / item / title / buff. **Idempotent + race-safe**: 1 milestone = 1 claim/character (CAS guard qua `SectSeasonClaim` UNIQUE `(characterId, seasonKey, milestoneKey)`).
- **Prisma migration** `20260605000000_phase_13_2_b_sect_season_claim`: 1 table mới `SectSeasonClaim` (`id` / `characterId` FK cascade / `seasonKey` / `milestoneKey` / `pointsAtClaim` / `rewardSnapshot` Json / `claimedAt` default now()) + composite UNIQUE `(characterId, seasonKey, milestoneKey)` → P2002 fallback path khi 2 request concurrent + 2 index `(characterId, seasonKey)` cho FE list view + `(seasonKey, milestoneKey)` cho admin audit.
- **API mới**:
  - `GET /sect-season/milestones` (public) — catalog snapshot 5 milestone tier kèm reward (linhThach/items/titleKey/buffKey).
  - `POST /sect-season/milestones/:milestoneKey/claim?seasonKey=...` (auth required) — atomic Prisma `$transaction`: (1) verify season + milestone tồn tại; (2) verify character tồn tại; (3) aggregate `personalPoints` qua `sectSeasonWeekKeys(season)` từ `SectWarContribution`; (4) reject nếu `< requiredPoints` (`SECT_SEASON_NOT_ELIGIBLE`); (5) cheap pre-check `findUnique` claim row → `SECT_SEASON_ALREADY_CLAIMED`; (6) `tx.sectSeasonClaim.create` (P2002 → `SECT_SEASON_ALREADY_CLAIMED`); (7) reward grant qua `CurrencyService.applyTx` (linhThach/tienNgoc + ledger reason `SECT_SEASON_REWARD`) + `InventoryService.grantTx` (items + reason `SECT_SEASON_REWARD`) + `TitleService.unlockTitleTx` (`source='sect_season'`) + `BuffService.applyBuffTx`. Race: 2 concurrent claim → 1 winner success + 1 reject `SECT_SEASON_ALREADY_CLAIMED`, ledger total chỉ +1×reward (không double grant).
  - `GET /sect-season/me?seasonKey?` extend (Phase 13.2.A → B): response thêm `claimedMilestoneKeys` (đã claim, từ DB) + `claimableMilestoneKeys = achieved \ claimed` (FE bật claim button cho mọi key trong list).
- **Server-authoritative**: FE KHÔNG self-derive achieved/claimable — server tính `claimedMilestoneKeys` từ `SectSeasonClaim` table + `claimableMilestoneKeys` từ catalog cross `personalPoints`. Sau claim thành công, FE gọi `refresh()` để reload state, claim button bị thay bởi badge **"Đã nhận"**.
- **FE nâng cấp** (`apps/web/src/components/SectSeasonPanel.vue`):
  - Mỗi milestone row có 4 state: **claimable** (button "Nhận thưởng" enable) → **claiming** (button text "Đang nhận…" disable) → **claimed** (badge xanh "Đã nhận") → **locked** (label "Chưa đạt").
  - Sau claim success: result toast hiển thị reward summary (linhThach/tienNgoc/items count/title/buff) + button "Đóng" dismiss.
  - Sau claim fail: error toast i18n theo error code (`SECT_SEASON_NOT_ELIGIBLE` / `SECT_SEASON_ALREADY_CLAIMED` / `SEASON_NOT_FOUND` / `NO_CHARACTER` / fallback `UNKNOWN`) + button "Đóng" dismiss.
  - i18n vi/en parity: thêm `sectSeason.dismiss` / `sectSeason.milestone.{claim,claiming,claimed}` / `sectSeason.claimResult.title` + 3 error code mới (`SECT_SEASON_MILESTONE_NOT_FOUND` / `SECT_SEASON_NOT_ELIGIBLE` / `SECT_SEASON_ALREADY_CLAIMED`).
- **Tests +27**:
  - **Shared** (`packages/shared/src/sect-season.test.ts` extend): `sectSeasonMilestoneByKey` lookup; `validateSectSeasonMilestone` invariant + monotonic ascending requiredPoints.
  - **API service** (`apps/api/src/modules/sect-season/sect-season.service.test.ts` extend): `listMilestones` snapshot; `getMyStatus` claim view (claimedKeys empty + claimableKeys = achieved); `getMyStatus` after claim (claimedKeys reflect + claimableKeys excluded); `claimMilestone` 4 error case (milestone not found, season not found, no character, not eligible); `claimMilestone` success grant currency + claim row + ledger row reason `SECT_SEASON_REWARD` + refId `{seasonKey}:{milestoneKey}`; `claimMilestone` double claim reject `SECT_SEASON_ALREADY_CLAIMED`; `claimMilestone` multiple tiers separate refIds; `claimMilestone` concurrent race (`Promise.allSettled` 2x) → 1 winner success.
  - **API controller** (`apps/api/src/modules/sect-season/sect-season.controller.test.ts` mới, +19 case): auth requirements (401 `UNAUTHENTICATED` cho `/current` + `/me` + `/claim`); public endpoints (`/leaderboard` + `/milestones` no auth); error mapping (404 cho `NO_CHARACTER`/`SEASON_NOT_FOUND`/`SECT_SEASON_MILESTONE_NOT_FOUND`, 400 cho `SECT_SEASON_NOT_ELIGIBLE`/`SEASON_KEY_REQUIRED`, 409 cho `SECT_SEASON_ALREADY_CLAIMED`); param + query passing.
  - **FE** (`apps/web/src/components/__tests__/SectSeasonPanel.test.ts` extend +4 case): claim button render cho `claimableMilestoneKeys`; claim success → result toast + reload state + badge "Đã nhận" thay button; claim error → i18n toast (`SECT_SEASON_ALREADY_CLAIMED`); claimed milestone render badge thay vì button.
- **Risk / rollback**: thấp. 1 migration mới (additive table), KHÔNG đụng `SectWarContribution` / `SectSeasonClaim` chưa có row trên prod → rollback = revert PR + drop table.
- **Out of scope** (theo scope user request): KHÔNG làm PvP realtime / auction / diplomacy / sect-wide milestone (chỉ personal milestone Phase 13.2.B), KHÔNG phá Sect War hiện có.
- **Verification**: shared typecheck ✅ / shared `--run sect-season` ✅ / api typecheck ✅ / api `--run sect-season` 46 PASS ✅ (27 service + 19 controller) / api `--run sect-war` PASS ✅ (zero regression) / web typecheck ✅ / web `--run SectSeason` 11 PASS ✅ / pnpm build ✅.

### Added — Phase R1 Production Readiness — CSP, env, healthcheck, deploy docs (PR #473)

### Added — Phase 13.2.C Sect Season History + Hall of Fame (PR #474)

- **Tông Môn giờ có lịch sử mùa giải + bảng vinh danh tích lũy** — Phase 13.2.A đã ship Sect Season Foundation (mùa giải 4 tuần × 13 mùa, leaderboard live + milestone progression read-only). Phase 13.2.C ship **snapshot mùa kết thúc** + **Hall of Fame** tích lũy quán quân/MVP qua các mùa, tạo nền cho Phase 13.2.B+ season settlement runtime sau này. Vẫn read-only end-user (KHÔNG grant reward, KHÔNG title award), nhưng **có Prisma migration** cho 3 bảng snapshot.
- **Shared types mới** (`packages/shared/src/sect-season.ts`):
  - **`SECT_SEASON_TOP_MEMBERS = 10`** — top 10 individual contributors lưu mỗi mùa.
  - **`SectSeasonHistorySectEntry`** — `{ rank, sectId, sectName, points, contributors, weeksContributed }` (parity field với leaderboard live + audit-correct sectName tại finalize).
  - **`SectSeasonHistoryMemberEntry`** — `{ rank, characterId, characterName, sectId|null, sectName|null, points }` (member có thể không thuộc Sect tại lúc finalize).
  - **`SectSeasonHistorySummary`** — `{ seasonKey, finalizedAt, totalSects, totalContributors, totalPoints, champion: SectSeasonHistorySectEntry|null, mvp: SectSeasonHistoryMemberEntry|null }` cho list view nhanh không JOIN.
  - **`SectSeasonHistoryView`** — `{ seasonKey, finalizedAt, totalSects, totalContributors, totalPoints, sects: SectSeasonHistorySectEntry[], topMembers: SectSeasonHistoryMemberEntry[] }` cho detail view.
  - **`SectSeasonHistoryListView`** — `{ seasons: SectSeasonHistorySummary[] }` (newest first by `finalizedAt desc`).
  - **`SectHallOfFameSectEntry`** — `{ sectId, sectName, championships, podiums, appearances, bestRank, totalPoints, latestSeasonKey }`.
  - **`SectHallOfFameMemberEntry`** — `{ characterId, characterName, mvps, podiums, appearances, bestRank, totalPoints, latestSeasonKey, latestSectName: string|null }`.
  - **`SectHallOfFameView`** — `{ sects, members, totalSeasonsFinalized }` cho aggregate cumulative.
- **Prisma migration `20260605000000_phase_13_2_c_sect_season_history`**:
  - `SectSeasonSnapshot { id PK, seasonKey UNIQUE, finalizedAt, totalSects, totalContributors, totalPoints, championSectId?, championSectName?, championPoints?, mvpCharacterId?, mvpCharacterName?, mvpSectId?, mvpSectName?, mvpPoints? }` — denormalized champion/MVP cho list không JOIN. `seasonKey` UNIQUE = guard double-snapshot ở DB level.
  - `SectSeasonSectRank { id PK, seasonId FK, rank, sectId, sectName, points, contributors, weeksContributed }` + composite UNIQUE `(seasonId, rank)` + `(seasonId, sectId)`.
  - `SectSeasonTopMember { id PK, seasonId FK, rank, characterId, characterName, sectId?, sectName?, points }` + composite UNIQUE `(seasonId, rank)` + `(seasonId, characterId)`.
  - `Character` nhận `sectSeasonTopMembers SectSeasonTopMember[]` reverse relation (no schema impact, chỉ là query helper).
  - **Migration KHÔNG đụng `SectWarContribution`/`SectWarRewardClaim`/`Character`/`Sect` schema hiện có** — chỉ thêm 3 bảng mới.
- **API mới** (read-only player-facing):
  - **`GET /sect-season/history`** (no auth) → list tất cả mùa đã chốt newest first; mỗi entry có `champion`/`mvp` denormalized cho list view nhanh; empty array khi chưa có mùa nào finalized.
  - **`GET /sect-season/history/:seasonKey`** (no auth) → detail snapshot 1 mùa (full sect leaderboard `rank asc` + top 10 member `rank asc`); 404 `SNAPSHOT_NOT_FOUND` khi mùa chưa finalize / 404 `SEASON_NOT_FOUND` khi `seasonKey` ∉ catalog.
  - **`GET /sect-season/hall-of-fame`** (no auth) → aggregate cumulative qua tất cả snapshot. Sect ordering: `championships desc → podiums desc → totalPoints desc → sectId asc`. Member ordering: `mvps desc → podiums desc → totalPoints desc → characterId asc`. `bestRank` = min rank đã đạt; `latestSeasonKey` = mùa gần nhất tham gia.
- **Verification**: shared typecheck ✅ / api typecheck ✅ + `--run sect-season` 31 PASS ✅ + `--run sect-war` 15 PASS ✅ / web typecheck ✅ + `--run SectSeason` 14 PASS ✅ / pnpm build ✅.

- **API ready hơn cho staging/production deploy** — Trước PR này, `apps/api/src/main.ts` đã có CSP + healthcheck + secret guard nhưng logic mix trong `bootstrap()`, **không có unit test** cho các nhánh production. PR R1: extract pure helper sang `bootstrap-config.ts` (testable, không cần boot Nest), thêm 26 lock-in test cho CSP/CORS/secret + 6 lock-in test chống commit `.env` thật, doc hóa env list + deploy smoke checklist + CSP troubleshooting. **KHÔNG đụng gameplay**, **KHÔNG migration**, **KHÔNG đổi runtime LiveOps/SectWar/Phase 13.2.x**.
- **Pure config helpers** (`apps/api/src/bootstrap-config.ts`):
  - **`assertProductionSecrets(env=process.env)`** — no-op khi `NODE_ENV !== 'production'`. Trong prod: throw nếu thiếu `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`, throw nếu giá trị thuộc `INSECURE_DEFAULTS = { 'change-me-access-secret', 'change-me-refresh-secret', 'dev-access-secret', 'dev-refresh-secret' }`. Message tiếng Việt rõ ràng (`[xuantoi/api] Production phải có env: ...` / `[xuantoi/api] Production không được dùng giá trị mặc định cho ...`).
  - **`corsConfig(env=process.env)`** — prod: throw nếu thiếu `CORS_ORIGINS`, csv parse trim+filter, return `{ origin: string[], credentials: true }`. Dev: dùng `CORS_ORIGINS` nếu có, fallback `['http://localhost:5173']` (Vite default).
  - **`helmetConfig(env=process.env)`** — dev: `{ contentSecurityPolicy: false }` (tắt để Vite HMR/inline script). Prod: 11 directive `defaultSrc/scriptSrc/styleSrc 'self'`, `imgSrc 'self' data:`, `connectSrc 'self'`, `fontSrc 'self' data:`, `objectSrc 'none'`, `baseUri 'self'`, `formAction 'self'`, `frameAncestors 'none'`, `upgradeInsecureRequests` + HSTS 180 ngày `includeSubDomains`, `referrerPolicy no-referrer`, `crossOriginResourcePolicy same-site`, `crossOriginEmbedderPolicy false`. KHÔNG `'unsafe-inline'`/`'unsafe-eval'`/wildcard `*`.
  - `main.ts` simplified: import 3 helper, `bootstrap()` call `assertProductionSecrets()` rồi `NestFactory.create(AppModule, { cors: corsConfig() })` + `app.use(helmet(helmetConfig()))`.
- **Healthcheck** (đã ship trước, audit-only — KHÔNG đổi):
  - `GET /api/healthz` → 200 `{ ok, uptimeMs, ts }` liveness.
  - `GET /api/readyz` → 200 `{ ok, checks: { db: { ok, latencyMs }, redis: { ok, latencyMs } } }` hoặc 503 nếu DB/Redis fail (load balancer rotate instance ra).
  - `GET /api/version` → meta `{ name, version, gitSha, ts }` (commit SHA cho deploy verify).
- **Tests mới**:
  - `apps/api/src/bootstrap-config.test.ts` (+26 case): `assertProductionSecrets` 8 case (dev no-op × 3, missing JWT_ACCESS/REFRESH, both insecure default × 4 cho ACCESS/REFRESH, length-only validation cho prod minimum); `corsConfig` 6 case (dev fallback, dev csv parse, dev empty, prod missing throw, prod csv parse, prod single origin); `helmetConfig` 12 case (dev tắt CSP, prod CSP đủ 11 directive, KHÔNG unsafe-inline/eval/wildcard, HSTS 15552000 includeSubDomains preload=false, referrer-policy no-referrer, CORP same-site, COEP false, object-src + frame-ancestors none).
  - `apps/api/src/security-secret-leak.test.ts` (+6 case): `apps/api/.env.example` chỉ chứa placeholder (length < 32 hoặc trong `ALLOWED_PLACEHOLDERS`); `apps/web/.env.example` không có key match `SECRET|PASSWORD|TOKEN|PRIVATE_KEY` không-prefix `VITE_`; `apps/api/.env` + `apps/web/.env` được `git check-ignore` reject; root `.gitignore` có rule `.env` + whitelist `!.env.example`.
- **Docs mới**:
  - `docs/PRODUCTION_CHECKLIST.md` — 5 section: env list bắt buộc/khuyến nghị/anti-pattern; deploy smoke checklist (health probe, CSP header `curl -I`, auth+session, core gameplay loop, admin+audit, cleanup); CSP troubleshooting (inline script, WebSocket cross-domain, CDN style/font, image data: URI, iframe embed, verify CSP nhanh local); lock-in test inventory; rollback nguyên tắc.
  - `docs/DEPLOY.md` + `docs/SECURITY.md` — companion banner cross-link tới `PRODUCTION_CHECKLIST.md`.
- **Risk / rollback**: thấp. R1 **append-only** + 1 file refactor (`main.ts` chỉ extract helper sang file mới — behavior identical). KHÔNG migration, KHÔNG schema, KHÔNG đụng module/controller nào ngoài `main.ts`. Rollback = revert PR.
- **Out of scope** (theo scope user request): KHÔNG sửa gameplay, KHÔNG làm Phase 13.2.B+, KHÔNG đổi secret thật, KHÔNG commit `.env` thật, KHÔNG deploy prod thật trong session này (chỉ verify config).
- **Verification**: api typecheck ✅ / api `--run health` 13 PASS ✅ (10 unit + 3 integration) / api `--run security-secret-leak` 6 PASS ✅ / api `--run bootstrap-config` 26 PASS ✅ / api lint ✅ / pnpm build ✅.
- **Next roadmap**: (1) env-driven CSP `connectSrc` cho FE khác domain (hiện hard-code `'self'`); (2) Phase 13.2.B Sect Season Reward Claim (deferred to gameplay PR); (3) Dockerfile + `docker-compose.prod.yml` để có image deploy cho VPS / fly.io / k8s; (4) preview deploy trên Vercel/Netlify cho staging E2E test.

### Added — Phase 13.2.A Sect Season Foundation (PR #472)

- **Tông Môn giờ có mùa giải dài hạn** — Phase 13.1.A/B/C/D đã ship Sect War tuần (`SectWarContribution`, `SectWarRewardClaim`, leaderboard tuần, missions, shop, admin LiveOps preview/dry-run). Phase 13.2.A mở foundation cho **Sect Season** — chuỗi mùa giải 4 tuần × 13 mùa (≈ 1 năm) phủ `2026-03-30 → 2027-03-28 ICT`, derive điểm season từ weekly contribution **read-only** (KHÔNG mutate, KHÔNG migration, KHÔNG reward claim) + 1 tab UI Season trong `/sect-war` cho player xem milestone progression + leaderboard mùa.
- **Shared catalog mới** (`packages/shared/src/sect-season.ts`):
  - **`SectSeasonDef`** — `{ key: 's1'..'s13', startsAtIso, endsAtIso, durationWeeks: 4, timezone: 'Asia/Ho_Chi_Minh', labelI18nKey, descriptionI18nKey }`. **`SECT_SEASONS`** — 13 mùa liên tiếp Monday 00:00 ICT (UTC+07), mỗi mùa = 4 tuần ISO.
  - **`SectSeasonMilestoneDef`** — `{ key, requiredPoints, reward: SectSeasonRewardGrant, labelI18nKey, descriptionI18nKey }`. **`SECT_SEASON_MILESTONES`** — 5 cột mốc monotonic increasing: `bronze` 100pt, `silver` 500pt, `gold` 2000pt, `platinum` 5000pt, `diamond` 7500pt. `SectSeasonRewardGrant` = optional `{ linhThach, tienNgoc, items[], titleKey, buffKey }` — Phase 13.2.A KHÔNG grant; chỉ display preview.
  - **Helpers**: `sectSeasonByKey(key)`, `sectSeasonMilestoneByKey(key)`, `currentSectSeason(now=Date)` (resolve theo Monday ICT, return `null` khi out-of-range), `sectSeasonWeekKeys(season)` (return ISO week keys `YYYY-Www` × `durationWeeks` để aggregate), `sectSeasonAchievedMilestones(points)`, `sectSeasonNextMilestone(points)`.
  - **Validators**: `validateSectSeason(s)`, `validateSectSeasonMilestone(m)`, `validateSectSeasonMilestonesMonotonic(list)` — fail-fast invariant key/duration/points strictly increasing.
- **API mới** (no migration, read-only aggregation):
  - **`GET /sect-season/current`** — auth required, return `{ seasonKey, season, milestones, leaderboard, me }`. Resolve season qua `currentSectSeason(now)`; nếu out-of-range trả `seasonKey=null`/`season=null`.
  - **`GET /sect-season/leaderboard?seasonKey?`** — public, return `{ seasonKey, rows: ReadonlyArray<{ rank, sectId, sectName, points, contributors, weeksContributed }> }`. Top 10 sect tổng hợp qua `sectSeasonWeekKeys(season)` × `SectWarContribution`. Tie-break: total points desc → sectId asc (deterministic).
  - **`GET /sect-season/me?seasonKey?`** — auth, return `{ seasonKey, hasSect, sectId, sectName, personalPoints, weeksContributed, achievedMilestoneKeys[], nextMilestoneKey }` hoặc `null` khi out-of-season.
  - **`SectSeasonService`** read-only: `groupBy SectWarContribution where weekKey IN (sectSeasonWeekKeys)`, không INSERT/UPDATE bất kỳ row nào — Phase 13.2.A là pure aggregation. **`SECT_SEASON_LEADERBOARD_TOP = 10`** constant. `SectSeasonError { code: 'NO_CHARACTER' | 'SEASON_NOT_FOUND' }`.
- **FE Season tab** (`apps/web/src/views/SectWarView.vue` + new `SectSeasonPanel.vue`):
  - Thêm tab `season` vào `SectWarTab` union (`overview/leaderboard/missions/shop/rewards/season`). Click tab Season → mount `SectSeasonPanel` truyền `mySectId` từ `state.me.sectId`.
  - Panel render: header season label + countdown (`{d}d {h}h {m}m`, refresh 30s); personal progress (points, weeks contributed, sect name, next milestone hint với `requiredPoints - personalPoints`); milestone list 5 row với achieved/locked icon `✓`/`·` + progress bar % theo `personalPoints / requiredPoints` clamped 0..100 + reward summary (linhThach/tienNgoc/items/titleKey/buffKey); leaderboard top 10 row highlight `mySectId`. Out-of-season fallback (banner). KHÔNG có claim button — Phase 13.2.A read-only.
  - **API client** (`apps/web/src/api/sectSeason.ts`): `getSectSeasonCurrent()`, `getSectSeasonLeaderboard(seasonKey?)`, `getSectSeasonMe(seasonKey?)` — envelope unwrap pattern.
- **i18n vi/en parity**: namespace `sectSeason.*` (loading/outOfRange/season.{label,fallbackLabel,keyLabel,range,remaining,ended,names.s1..s13,namesDesc.s1..s13}/myProgress.{title,noData,sect,noSect,personalPoints,weeksContributed,weeksOf,nextHint}/milestone.{title,achieved,locked,required,names.{bronze..diamond},namesDesc.{bronze..diamond}}/leaderboard.{title,empty,youTag,col.{rank,sect,points,contributors,weeks}}/reward.{linhThach,tienNgoc,items,titleAward,buff}/errors.{NO_CHARACTER,SEASON_NOT_FOUND,UNKNOWN}).
- **Risk / rollback**: thấp. Phase 13.2.A **append-only**: 1 file shared catalog mới, 3 file API (controller/service/module), 2 file FE (api client + panel), 1 tab insert vào `SectWarView.vue`, i18n diff. **KHÔNG migration**, **KHÔNG schema change**, **KHÔNG đụng `SectWarService`/`SectMissionService`/`SectShopService`**. Read-only `SectWarContribution.groupBy` — không INSERT/UPDATE. Rollback = revert PR.
- **Out of scope** (theo scope user request): KHÔNG PvP realtime, KHÔNG auction, KHÔNG diplomacy, KHÔNG season reward **claim** (chỉ display preview milestone), KHÔNG Phase 13.2.B+ cross-sect tournament, KHÔNG đụng Sect War tuần / Mission / Shop hiện có.
- **Tests**: shared +44 case `sect-season.test.ts` (catalog invariant key/format/dates/durationWeeks/monotonic; helper `sectSeasonByKey`/`sectSeasonMilestoneByKey`/`currentSectSeason` boundary Monday 00:00 ICT/`sectSeasonWeekKeys` length+alignment/`sectSeasonAchievedMilestones`/`sectSeasonNextMilestone`); api +16 case `sect-season.service.test.ts` (resolveSeason key/fallback/getLeaderboard ordering+contributors+weeksContributed/getMyStatus personal+achieved+next milestone+hasSect=false fallback+NO_CHARACTER/getCurrent full+out-of-range/listSeasons); web +7 case `SectSeasonPanel.test.ts` (header+countdown render/personal progress/milestone status achieved/locked/leaderboard mySectId highlight/out-of-range fallback/error i18n/loading) + `SectWarView.test.ts` +1 case (tab=season slot mount).
- **Verification**: shared typecheck ✅ + `pnpm --filter @xuantoi/shared test` 44 PASS ✅ / api typecheck ✅ + `--run sect-season` 16 PASS ✅ + `--run sect-war` 15 PASS ✅ (zero regression) / web typecheck ✅ + `--run SectSeason SectWar` 16 PASS ✅ + `--run i18n` 8 PASS ✅ / pnpm build ✅.
- **Next roadmap**: (1) Phase 13.2.B Sect Season Reward Claim (UI + idempotent grant + audit + ledger entry); (2) Phase 13.2.C Cross-sect tournament (PvP bracket head-to-head); (3) admin season preview (force resolve / freeze leaderboard).

### Added — Phase 13.1.D Admin LiveOps Schedule Preview & Dry-run (PR #471)

- **Admin LiveOps giờ có schedule preview + dry-run** — Phase 13.1.B/C đã ship status snapshot + override toggle + sect-war recalc/snapshot + force-spawn boss; Phase 13.1.D thêm 2 endpoint admin (read-only schedule preview + simulated event/boss dry-run) và 2 panel FE để admin xem trước lịch event/boss/sect war và kiểm thử kết quả reward giả lập trước khi bật event hoặc spawn boss thật. **KHÔNG mutate**: dry-run chỉ ghi 1 audit `ADMIN_LIVEOPS_DRY_RUN`, không grant reward, không spawn `WorldBoss`, không upsert `LiveOpsEventOverride`.
- **API mới**:
  - `GET /admin/liveops/schedule-preview` (ADMIN/MOD, no audit) — trả `{ tz, nowIso, activeEvents[], upcomingEvents[], bossScheduleToday[], bossScheduleWeek[], sectWar: { season, status }, overrides[] }`. `activeEvents` overlay `LiveOpsEventOverride` (chỉ event có `effectiveEnabled=true`); `upcomingEvents` top N slot/event (≤5) trong 7 ngày kế kèm `catalogEnabled`/`effectiveEnabled`/`slotStartIso`/`slotEndIso`; `bossScheduleToday`/`bossScheduleWeek` group theo `localDate` (status `upcoming`/`active`/`completed`); `sectWar.season` = `currentSectWarSeason(now)`, `sectWar.status` = `getSectWarStatus(weekKey)`; `overrides[]` rows order `updatedAt desc`.
  - `POST /admin/liveops/dry-run` (ADMIN-only `@RequireAdmin()`, audit `ADMIN_LIVEOPS_DRY_RUN`) — body `{ kind: 'event'|'boss', key: string≤80, regionKey?: string≤80, level?: 1..99, reason?: string≤200 }`. `kind='event'` → reuse `LIVE_OPS_EVENTS` catalog + override DB row, trả `{ catalogEnabled, effectiveEnabled, override, nextSlotStartIso, nextSlotEndIso, regionKey?, bossKey?, simulated:true }`; `kind='boss'` → reuse `bossByKey` + level clamp 1..99, trả `{ simulatedMaxHp: bigint string, simulatedReward: { baseLinhThach, topDropPool[], midDropPool[], lowDropPool[] }, recommendedRealm }`. Audit `meta { kind, targetType: 'LiveOpsEvent'|'Boss', targetId, regionKey?, level?, reason: string|null }`.
- **FE Admin LiveOps tab**: 2 panel mới `AdminLiveOpsSchedulePreviewPanel.vue` (read-only, refresh button + retry on error, render active/upcoming/boss-today/boss-week/sect-war/overrides sections) + `AdminLiveOpsDryRunPanel.vue` (form 5 field kind/key/regionKey/level/reason, conditional render boss-only fields, submit gọi `adminLiveOpsDryRun()` + render result section event/boss). Wire vào `AdminView.vue` LiveOps tab dưới panel 13.1.B/C hiện có. KHÔNG đụng `AdminLiveOpsPanel.vue` 13.1.B (zero-regression Phase 13.1.B/C tests).
- **i18n vi/en parity**: namespace `adminLiveOpsPreview.*` (title/loading/refresh/retry/active/upcoming/boss/sectWar/overrides headers + empty placeholders + error codes UNAUTHORIZED/UNKNOWN) + `adminLiveOpsDryRun.*` (kind/key/region/level/reason labels + submit + result headers + error codes ADMIN_ONLY/EVENT_NOT_FOUND/BOSS_NOT_FOUND/INVALID_INPUT/KEY_REQUIRED/UNKNOWN).
- **Risk / rollback**: thấp. Phase 13.1.D **append-only**: 2 endpoint mới (KHÔNG đổi `/admin/liveops` legacy), 2 service method mới (`schedulePreview`/`dryRun`), 2 panel mới — KHÔNG migration, KHÔNG sửa runtime LiveOps/Boss/SectWar core. Rollback = revert 4 file FE mới + 2 service method + 2 controller endpoint + 1 audit action name + diff i18n vi/en + diff API.md.
- **Out of scope**: KHÔNG event CMS (drag-drop editor, schedule cron editor), KHÔNG grant reward thật trong dry-run (BE explicit `simulated:true`), KHÔNG spawn `WorldBoss` thật trong dry-run, KHÔNG đụng Phase 13.1.B `/admin/liveops` legacy hoặc Phase 13.1.C force-spawn boss / sect-war snapshot — Phase 13.1.D độc lập.
- **Tests**: api +9 case `admin-liveops.service.test.ts` (3 schedulePreview + 3 dryRun event + 3 dryRun boss với clamp/EVENT_NOT_FOUND/BOSS_NOT_FOUND/audit no-mutation verify); web +8 case (`AdminLiveOpsSchedulePreviewPanel.test.ts` 4 + `AdminLiveOpsDryRunPanel.test.ts` 4: render full preview + error retry + refresh + empty placeholders + submit event/boss + empty key reject + EVENT_NOT_FOUND error). Không đổi schema, không migration, không snapshot test.
- **Verification**: api typecheck ✅ / api `--run admin` 344 PASS ✅ / api `--run liveops` 32 PASS ✅ / web typecheck ✅ / web `--run AdminLiveOps` 18 PASS ✅ / web `--run Admin` 82 PASS ✅ / pnpm build ✅.
- **Next roadmap**: (1) Phase 13.2 Cross-sect seasonal expansion; (2) CSP production verify khi deploy (M7); (3) Admin LiveOps event CMS / drag-drop schedule editor (deferred — Phase 13.1.D chỉ preview/dry-run); (4) Phase 12.10 Story dialogue smoke + Playwright E2E.

### Added — Phase 12.9 Story Dialogue Branch Advanced (PR #470)

- **NPC giờ nhớ lựa chọn cũ + đối thoại phân nhánh nhiều bước** — Phase 12 Story Dialogue Foundation (PR #464) đã ship single-step branching với `flag_equals` / `quest_status` / `seen` / `realm_min`. Phase 12.9 nâng cấp thành multi-step branching tree: NPC nhớ choice cũ qua `Character.storyDialogueChoices` (Json map nodeId → choiceKey, last-write-wins per node) + render followup node khác nhau theo path đã đi. Player apologize khi chọn nhầm path "rival" → flag được clear → narrative revert sang "neutral". KHÔNG đụng dungeon runtime, KHÔNG cutscene lớn, KHÔNG rewrite quest system.
- **2 type mới**:
  - **Condition `choice_made { nodeId, choiceKey }`** — match khi `storyDialogueChoices[nodeId] === choiceKey`. Specificity = 5 (cùng band `quest_status`) → server pick followup node trước fallback intro. Validator two-pass verify nodeId + choiceKey ref đúng trong catalog.
  - **Effect `clear_flag { flagKey }`** — xoá entry khỏi `storyFlags` (no-op nếu chưa set). Cho plot reversal / apology arc — không động chạm flag khác. `storyDialogueAllFlagKeys()` cover cả `set_flag` + `clear_flag` để invariant validate flag set consistency.
- **Hàn Dạ multi-step tree** (4 node minh hoạ — tổng catalog Phase 12.9 thêm 3 node mới ngoài `first_meet` đã có):
  - `story_dlg_han_da_first_meet` — root. 2 choice: `rival` set `han_da_relation = rival` + mark seen; `neutral` set `han_da_relation = neutral` + mark seen.
  - `story_dlg_han_da_followup_rival` — gate `choice_made(first_meet, rival)` + `not_seen` self. 2 choice: `spar` set `han_da_spar_arranged = true` + mark seen; `decline` mark seen.
  - `story_dlg_han_da_followup_neutral` — gate `choice_made(first_meet, neutral)` + `not_seen` self. Choice friendly chat → mark seen.
  - `story_dlg_han_da_resolution_apology` — gate `seen(followup_rival)` + `flag_equals(han_da_relation, rival)` + `not_seen` self. Choice `apologize` carries `clear_flag(han_da_relation)` (revert sang neutral path) + mark seen — KHÔNG đụng `han_da_spar_arranged` để giữ lịch sử spar.
- **Prisma migration** `20260604000000_phase_12_9_story_dialogue_branch_advanced` — thêm `Character.storyDialogueChoices Json @default('{}')` (nodeId → choiceKey, last-write-wins per node). Backwards-compatible: existing players default `{}` không break flow.
- **API runtime extend** (`StoryDialogueService`):
  - `CharCtx.choices: Readonly<Record<string,string>>` thêm vào context cùng `flags` / `seen` / `questStatus`.
  - `loadCtx()` đọc `Character.storyDialogueChoices` qua helper `readJsonChoiceMap` (ignore non-string values).
  - `evaluateCondition()` handle `choice_made` (return `ctx.choices[nodeId] === choiceKey`).
  - `summarizeConditionForReason()` thêm shape `'choice_made:nodeId=key'` cho FE debug `unavailableReason`.
  - `applyChoice()` ghi `choices[node.id] = choice.key` last-write-wins TRƯỚC khi handle effects (nên `choice_made` ở node tiếp theo thấy ngay) + handle `clear_flag` (delete entry khỏi flags map) + persist `storyDialogueChoices` cùng `storyDialogueSeen` / `storyFlags`.
- **Response shape** (extend, backwards-compatible):
  - `StoryDialogueChoiceView.previouslyChosen: boolean` — `storyDialogueChoices[parentNodeId] === key`. KHÔNG disable button — chỉ hint cho FE.
  - `StoryDialogueNodeView.previousChoiceKey: string \| null` — last-pick at this node.
  - `StoryDialogueChoiceResult.choices: Readonly<Record<string,string>>` — snapshot map post-apply, để FE store sync cho `choice_made` render đúng ở node tiếp theo.
- **FE polish** (`StoryDialogueModal.vue`):
  - Thêm v-else-if branch render badge "Đã chọn lần trước" khi `c.previouslyChosen=true && c.available=true && !c.alreadyApplied`. `data-testid="story-dialogue-last-{key}"`. Amber-300 italic hint, KHÔNG disable button.
  - Hover/border màu khác (`border-amber-300/40`) khi previously chosen — visual cue nhẹ.
  - `alreadyApplied` v-else-if vẫn precedence (chain v-if > v-else-if) — KHÔNG double-render hint.
- **i18n vi/en parity**: `storyDialogue.lastChosen` (vi: "Đã chọn lần trước", en: "Picked last time").
- **Tests**: +14 case (shared +5 / api +7 / web +2):
  - **Shared** (`packages/shared/src/story-dialogues.test.ts`): `storyDialogueNodeSpecificity` rank `choice_made` same band `quest_status`; catalog ≥ 1 node per implemented effect kind (mark_seen/advance_quest_step/give_reward/set_flag/clear_flag); validator reject orphan `choice_made(nodeId, key)` ref; `storyDialogueAllFlagKeys()` cover `clear_flag`; Hàn Dạ multi-step tree round-trip resolution.
  - **API** (`apps/api/src/modules/story-dialogue/story-dialogue.service.test.ts`): pick rival → server pick `followup_rival` (specificity); pick neutral → server pick `followup_neutral`; followup_rival visibility fail INVALID_CHOICE nếu chưa pick rival; clear_flag xoá han_da_relation + persist + giữ han_da_spar_arranged; clear_flag no-op khi flag chưa set (idempotent semantic); previouslyChosen wiring true sau pick + reset seen; storyDialogueChoices last-write-wins multi-pick.
  - **Web** (`apps/web/src/components/__tests__/StoryDialogueModal.test.ts`): previouslyChosen=true render badge + giữ button enable; alreadyApplied precedence trên previouslyChosen — KHÔNG render last-chosen badge khi alreadyApplied=true.
- **Anti-feature-creep** (theo scope user request): KHÔNG rewrite quest system, KHÔNG cutscene lớn, KHÔNG dungeon runtime mới, KHÔNG PvP/pet/gacha/auction, KHÔNG Phase 13.2.
- **Risk / rollback**: low — migration thêm column với default empty `{}` (backwards-compatible), API extend response shape (FE optional field consume); rollback = revert PR + `prisma migrate resolve --rolled-back 20260604000000_phase_12_9_story_dialogue_branch_advanced`.
- **Verification**: shared typecheck ✅ + test (catalog + branching invariant) PASS / api typecheck ✅ + `--run story` PASS + `--run dialogue` PASS / web typecheck ✅ + `--run Dialogue` PASS / pnpm build ✅.
- **Next roadmap**: (1) Phase 12.10 Story dialogue smoke + Playwright E2E (Node smoke `pnpm smoke:story-dialogue` cover branching pick + previously-chosen revisit + locked reject + Playwright spec navigation); (2) mở rộng Hàn Dạ tree với give_reward gắn theo path; (3) thêm dialogue branch cho 8 placeholder kill milestone Phase 12 Foundation Late-game; (4) Phase 13.2 Cross-sect seasonal expansion.

### Added — Phase 12.8.E Story Dungeon Smoke Coverage (PR #469)

- **Story Dungeon giờ có smoke/E2E coverage end-to-end** — Phase 12.8.A/B/C/D đã ship catalog + runtime + FE + UI test coverage, nhưng chưa có smoke chạy real HTTP end-to-end. Phase 12.8.E thêm `scripts/smoke-story-dungeon.mjs` 35-step Node script chạy fetch-based vs API local cover full player flow từ register → onboard → quest gating → start → advance → clear → claim → verify quest progress + double-claim/non-owner reject + data isolation. **Test-only PR, no runtime change** — KHÔNG đụng component code, KHÔNG sửa runtime, KHÔNG migration.
- **Smoke flow covered** (35 step):
  - **Auth gates (6 step)**: GET /story/dungeons, GET /story/dungeons/:key, POST /story/dungeons/:key/start, POST /story/dungeons/:runId/advance, POST /story/dungeons/:runId/clear, POST /story/dungeons/:runId/claim → all 401 khi không cookie.
  - **Pre-onboard (1 step)**: GET /story/dungeons → 404 NO_CHARACTER.
  - **Onboard player1 (1 step)**: register + onboard với phamnhan default sect.
  - **Quest gating prep (5 step)**: GET /story/dungeons post-onboard → list với target locked, POST /story/dungeons/:key/start pre-quest → 403 DUNGEON_LOCKED, drive `phamnhan_main_01` to COMPLETED via /quests/accept + /quests/progress (talk×2 step_01/step_02) + admin login + admin /api/admin/users/:id/quest-track (kill son_thu ×3 step_03), GET /quests/me → phamnhan_main_01 COMPLETED.
  - **Story quest accept + progress (2 step)**: POST /quests/accept phamnhan_realm_01 → 200 ACCEPTED, POST /quests/progress phamnhan_realm_01 step_01 explore → 200.
  - **Start ACTIVE (3 step)**: GET /story/dungeons → target now status=available, POST /story/dungeons/story_dgn_phamnhan_back_mountain/start → 200 ACTIVE, idempotent retry → same runId.
  - **Advance + clear (5 step)**: premature clear 409 RUN_STEP_INVALID, advance×3 → currentStep=3, advance out-of-range 409 RUN_STEP_INVALID, clear → 200 CLEARED, re-clear 409 RUN_NOT_ACTIVE.
  - **Verify quest progress (1 step)**: GET /quests/me → phamnhan_realm_01 ACCEPTED step_01 progress=1 (không regression).
  - **Claim reward (3 step)**: claim → 200 granted reward (80 LT + 150 EXP + 1 linh_lo_dan), double-claim 409 RUN_ALREADY_CLAIMED, oneTime re-start 409 DUNGEON_ALREADY_CLEARED.
  - **Player2 non-owner + isolation (4 step)**: register + onboard player2 → POST /story/dungeons/:runId/advance non-owner 403 RUN_NOT_OWNED, claim non-owner 403 RUN_NOT_OWNED, GET /story/dungeons (player2) → activeRun=null target locked.
- **package.json wire**: thêm `"smoke:story-dungeon": "node scripts/smoke-story-dungeon.mjs"` vào root scripts (29 smoke total).
- **Env vars** (override default): `SMOKE_API_BASE` (default `http://localhost:3000`), `SMOKE_TIMEOUT_MS` (default 10000), `SMOKE_VERBOSE` (default off), `SMOKE_SECT_KEY` (default `thanh_van`), `SMOKE_ADMIN_EMAIL` (default `admin@example.com`), `SMOKE_ADMIN_PASSWORD` (default `change-me-bootstrap-pass`).
- **Local stack required**: `pnpm infra:up` (Postgres + Redis) + `pnpm --filter @xuantoi/api exec prisma migrate deploy` + `pnpm --filter @xuantoi/api bootstrap` (admin seed) + `pnpm --filter @xuantoi/api dev`.
- **Bugs found**: 0. Smoke 35/35 step PASS local trên main (không phát sinh fix runtime).
- **Risk / rollback**: tối thiểu — test-only PR, không đụng runtime/component code/i18n/migration. Rollback = revert `scripts/smoke-story-dungeon.mjs` + 1 line `package.json` + docs delta.
- **Out of scope**: KHÔNG rewrite Story Dungeon runtime; KHÔNG thêm story dungeon mới; KHÔNG dialogue branch nâng cao; KHÔNG Phase 13.2; KHÔNG PvP/pet/gacha/auction.
- **Verification**: api typecheck ✅ / api `--run story` 59 PASS ✅ / api `--run dungeon` 82 PASS ✅ / web typecheck ✅ / web `--run StoryDungeon` 74 PASS ✅ / web `--run Quest` 36 PASS ✅ / pnpm build ✅ / `pnpm smoke:story-dungeon` 35/35 PASS local.
- **Next roadmap**: (1) Phase 12 Story Dialogue Branch advanced (multi-step branching tree + flag effects + give_reward expansion); (2) Phase 13.2 Cross-sect seasonal expansion; (3) CSP production verify khi deploy (M7); (4) Admin LiveOps advanced controls schedule editor / event preview / dry-run mode.

### Added — Phase 12.8.D Story Dungeon UI Test Coverage (PR #468)

- **Story Dungeon FE giờ có test coverage đầy đủ §F gap** — Phase 12.8.C (PR #467 merged on main) đã ship full FE wire (4 component + Quest/Home CTA + i18n + store) nhưng chỉ có 16 store-level test trong `stores/__tests__/storyDungeon.test.ts`. Phase 12.8.D fill **§F web test coverage gap**: 4 component test file mới + extend 2 view test với CTA cases. **Test-only PR, no runtime change** — KHÔNG đụng component code, KHÔNG sửa runtime, KHÔNG migration.
- **4 component test file mới**:
  - `apps/web/src/views/__tests__/StoryDungeonView.test.ts` — **13 case**: render list + 3 status badge (locked/available/cleared) + counter, start button calls API + toast success, filter logic, activeRun panel render, claim flow (API call + reward modal + toast), advance flow, error handling (envelope `{ ok: false, error }` + unknown thrown error), empty state + loading state.
  - `apps/web/src/components/__tests__/StoryDungeonRunPanel.test.ts` — **23 case**: render title/status/progress/monster info/boss preview/killed monsters list/reward hint/realm badge, advance/clear/claim button state logic (based on status `ACTIVE`/`CLEARED`/`CLAIMED` + currentStep vs encounterSteps), disabled states based on `submittingKey`, dialogue button emits `open-dialogue` với `kind`, emit verification cho 4 button.
  - `apps/web/src/components/__tests__/StoryDungeonDialoguePanel.test.ts` — **11 case**: render khi `nodeId` set, Esc/backdrop/button close emits `close`, render NPC name + dialogue text từ `STORY_DIALOGUES` catalog, locale switching vi/en.
  - `apps/web/src/components/__tests__/StoryDungeonRewardModal.test.ts` — **11 case**: render khi `result` set, display linhThach/tienNgoc/exp/items chips conditional khi >0, close emits (button/backdrop/Esc), item fallback to raw key khi không tìm thấy item def.
- **Extend 2 view test**:
  - `apps/web/src/views/__tests__/QuestView.test.ts` **+7 case** Story Dungeon CTA: quest ACCEPTED/AVAILABLE + dungeon match → render CTA, LOCKED/CLAIMED + match → KHÔNG render, ACCEPTED + no match → KHÔNG render, `storyDungeonStore.load` fail → fail-soft (no crash, no CTA), click CTA → `router.push('/story-dungeons')`.
  - `apps/web/src/views/__tests__/HomeView.test.ts` **+8 case** Home CTA: `loaded=true` + `hasAnyAvailable=true` → render CTA + label desc available với count, `loaded=true` + `hasActiveRun=true` (no available) → render CTA + label desc active, `loaded=false` → KHÔNG render (chưa fetch), cả `hasAnyAvailable` + `hasActiveRun` = false → KHÔNG render, no character → KHÔNG render dù `loaded=true`, click CTA → `router.push('/story-dungeons')`, `storyDungeonStore.load` throw → home vẫn render bình thường (fail-soft), `onMounted` gọi `storyDungeonStore.load()` sau khi character loaded.
- **Test patterns**: Mock `@/api/storyDungeon` + `@/stores/auth/game/toast/storyDungeon` + vue-router; Pinia store integration; factory functions `buildDungeon`/`buildRun`/`buildTemplate`; Teleport-to-body via `attachTo: document.body`; i18n setup matching component keys.
- **Risk / rollback**: tối thiểu — test-only PR, không đụng runtime/component code/i18n. Rollback = revert 4 test file mới + diff QuestView.test.ts/HomeView.test.ts.
- **Out of scope**: KHÔNG dialogue branch advanced; KHÔNG dungeon mới; KHÔNG rewrite backend runtime; KHÔNG Phase 13.2; KHÔNG PvP/pet/gacha/auction/diplomacy.
- **Tests**: web full **1372** PASS ✅ (+73 case từ 4 component test mới + 7 QuestView CTA + 8 HomeView CTA, lên trên 1299 baseline post-PR-#467).
- **Verification**: shared typecheck/test 1504 PASS ✅ / web typecheck ✅ / web `--run StoryDungeon` 74 PASS ✅ / web `--run Quest` 36 PASS ✅ / web full **1372** PASS ✅ / api typecheck ✅ / api `--run story` 59 PASS ✅ / api `--run dungeon` 82 PASS ✅ / api `--run quest` 69 PASS ✅ / api full **2188** PASS ✅ / pnpm build ✅.
- **Next roadmap**: (1) Phase 12 Story Dialogue Branch advanced (multi-step branching tree + flag effects + give_reward expansion); (2) Phase 13.2 Cross-sect seasonal expansion (multi-sect tournament + cross-server leaderboard); (3) CSP production verify khi deploy (M7); (4) Admin LiveOps advanced controls schedule editor / event preview / dry-run mode.

### Added — Phase 12.8.C Story Dungeon FE + Dialogue/Reward Polish (PR #467)

- **Story Dungeon trở thành playable FE** — Phase 12.8.B chỉ có backend runtime; Phase 12.8.C wire toàn bộ FE map view + run panel + dialogue modal + reward modal + Quest/Home CTA. Player giờ có thể vào `/story-dungeons`, xem danh sách story dungeon với status `available/locked/cleared`, start/advance/clear/claim từ UI, đọc NPC dialogue trước/sau dungeon, thấy reward đã claim — KHÔNG còn phải gọi API thủ công.
- **Web API client mới** (`apps/web/src/api/storyDungeon.ts`) — 6 axios function envelope-based với `fallbackError`: `fetchStoryDungeonList`, `fetchStoryDungeon(key)`, `startStoryDungeon(key)`, `advanceStoryDungeon(runId)`, `clearStoryDungeon(runId)`, `claimStoryDungeon(runId)`. Type definitions: `StoryDungeonAvailabilityStatus`, `StoryDungeonView`, `StoryDungeonRunView`, `StoryDungeonListView`, `StoryDungeonClaimResult`. Mirror `dungeonRun.ts` pattern.
- **Pinia store** (`apps/web/src/stores/storyDungeon.ts`) — state `dungeons[]/activeRun?/loaded/loading/lastError/submittingKey/submittingError/lastClaimResult` + computed `totalCount/availableCount/lockedCount/clearedCount/hasActiveRun/isRunCleared/isRunClaimable/isRunActive/hasAnyAvailable` + actions `load()/start(templateKey)/advance()/clear()/claim()/findDungeon(key)/findDungeonForQuest(questKey)`. Server-authoritative — store chỉ mirror BE state.
- **UI Components** — `StoryDungeonView.vue` (main list view: header counters + filter all/available/locked/cleared + dungeon cards với region/realm/required quest/monsters/boss/reward hint + start/resume button + active run panel inline + dialogue/reward modal mounted on demand); `StoryDungeonRunPanel.vue` (active run với title + step progress + current monster + killed monsters list + advance/clear/claim button + loading/error states); `StoryDungeonDialoguePanel.vue` (light modal với Teleport + Esc/backdrop close — read-only NPC dialogue trước/sau dungeon, KHÔNG branching); `StoryDungeonRewardModal.vue` (reward grant display sau claim: linhThach / tienNgoc / exp / items với item name lookup).
- **Integration**: `QuestView.vue` (CTA "Vào bí cảnh cốt truyện" hiển thị khi quest đang ACCEPTED có `storyDungeonsForQuest()` available, helper `shouldShowStoryDungeonCta(q)` + `gotoStoryDungeons()` route push); `HomeView.vue` (CTA card optional khi `storyDungeonStore.hasAnyAvailable` hoặc `hasActiveRun` — mô tả số dungeon available + button "Mở bí cảnh"); `AppShell.vue` (nav link "Bí Cảnh Cốt Truyện" → `/story-dungeons`); router thêm route `/story-dungeons` lazy-load `StoryDungeonView`. Quest/Home `storyDungeonStore.load().catch(() => null)` fail-soft — request fail → silent (KHÔNG break Quest/Home view).
- **i18n vi/en parity full**: thêm `common.apiFallback.storyDungeon` ("Thao tác bí cảnh cốt truyện thất bại" / "Story dungeon action failed"), `shell.nav.storyDungeons`, `home.storyDungeon.{title,descAvailable,descActive,openBtn}`, `quest.storyDungeonCta`, và **90+ key** trong `storyDungeon.*` namespace (title/heading/loading/error/empty/filter labels/status badge/region/realm/required quest/start/advance/clear/claim button/dialogue/reward/error code mapping). KHÔNG raw key render.
- **Risk / rollback**: thấp. Phase 12.8.C chỉ FE + 2 light backend polish (controller `activeRun?: StoryDungeonRunView` enrich từ list response + service `findActiveRunForCharacter` helper) — KHÔNG sửa runtime/migration. Rollback = revert 8 file FE mới + 2 file BE polish + i18n key + nav link + route + Quest/Home CTA hooks. Không phá `DungeonRun` flow / story dungeon backend runtime.
- **Out of scope**: KHÔNG dialogue branch advanced (chỉ light modal read-only); KHÔNG cutscene/event; KHÔNG PvP/pet/gacha; KHÔNG rewrite story dungeon backend runtime; KHÔNG add new story dungeon (12.8.A catalog kept 4 entries).
- **Tests**: web full **1299** PASS ✅ (+16 case `stores/__tests__/storyDungeon.test.ts`: load happy path / load error sets lastError / start success → activeRun + reload list / start error sets submittingError / advance updates step / clear sets cleared status / claim returns lastClaimResult + clears activeRun / claim error preserves cleared run / findDungeon match / findDungeonForQuest filter available + cleared / reset() / clearLastClaimResult()). QuestView tests: 29/29 PASS (17 view + 12 store). i18n parity test PASS.
- **Verification**: shared build ✅ / web typecheck ✅ / `--run StoryDungeon` 16 PASS ✅ / `--run Quest` 29 PASS ✅ / web test full **1299** PASS ✅ / api typecheck ✅ / api `--run story` 59 PASS ✅ / pnpm build ✅.
- **Phase 12 Story Dungeon Instance Suite COMPLETED** ✅ — Phase 12.8.A (catalog + GET API) + 12.8.B (Prisma runtime + 4 mutation endpoint + quest integration) + 12.8.C (FE map view + run panel + dialogue/reward modal + Quest/Home CTA) all CLOSED.
- **Next roadmap**: (1) Phase 12 Story Dialogue Branch advanced (multi-step branching tree + flag effects + give_reward expansion); (2) Phase 13.2 Cross-sect seasonal expansion (multi-sect tournament + cross-server leaderboard); (3) CSP production verify khi deploy (M7); (4) Admin LiveOps advanced controls nếu còn thiếu (schedule editor / event preview / dry-run mode).

### Added — Phase 12.8.B Story Dungeon Runtime + Quest Integration (PR #466)

- **Story Dungeon trở thành playable runtime** — Phase 12.8.A chỉ có catalog read-only; Phase 12.8.B wire mutation pipeline server-authoritative cho start/advance/clear/claim. **Design**: chọn **Option B (new `StoryDungeonRun` model)** thay vì reuse `DungeonRun` vì story dungeon có lifecycle khác hẳn farm dungeon (one-time + auto-advance quest step + entry/clear dialogue trigger + reward differentiation `STORY_DUNGEON_REWARD`); reuse sẽ phải nhồi nhiều flag conditional vào `DungeonRun.start/claim` paths gây regression risk.
- **Prisma migration `20260603000000_phase_12_8_b_story_dungeon_runtime`**: enum `StoryDungeonRunStatus { ACTIVE, CLEARED, CLAIMED, FAILED }` + table `StoryDungeonRun` (`id` cuid + `characterId` FK cascade + `templateKey` + `status` default ACTIVE + `currentStep` Int default 0 + `killedMonsters` Json default `[]` + `startedAt`/`clearedAt?`/`claimedAt?`/`updatedAt`). 3 index: `(characterId, status)` cho list active runs / `(characterId, templateKey, status)` cho one-time guard / `(characterId, startedAt)` cho audit. Additive — KHÔNG sửa table cũ.
- **Endpoints mới**: `POST /story/dungeons/:key/start` (Zod template key snake_case → start ACTIVE run với `currentStep=0`; reject `DUNGEON_LOCKED` khi quest chưa accepted/step chưa tới hoặc realm chưa đủ; reject `DUNGEON_ALREADY_CLEARED` cho `oneTime=true` khi đã có row `CLAIMED`; idempotent: nếu đã có ACTIVE run cùng character+template → return run đó); `POST /story/dungeons/:runId/advance` (ownership check + `RUN_NOT_ACTIVE` reject CLEARED/CLAIMED/FAILED + `RUN_STEP_INVALID` reject step out-of-range; track `killedMonsters[]` Json); `POST /story/dungeons/:runId/clear` (ownership check + verify `currentStep === monsters.length` + boss optional + CAS guard `updateMany({where: {id, status: ACTIVE}, data: {status: CLEARED, clearedAt: now}})` count=0 → idempotent return existing CLEARED state; clear hook fires `applyQuestStepAdvance(characterId, template.requiredQuestKey, template.requiredQuestStep)` fail-soft); `POST /story/dungeons/:runId/claim` (ownership check + verify status=CLEARED + CAS guard `updateMany({where: {id, status: CLEARED}, data: {status: CLAIMED, claimedAt: now}})` race-safe → exactly 1 winner; reward grant atomic qua `CurrencyService.applyTx` reason `STORY_DUNGEON_REWARD` cho linhThach/tienNgoc/exp + `InventoryService.grantTx` reason `STORY_DUNGEON_REWARD` cho items theo `template.rewardHint`).
- **Quest integration**: clear hook gọi `QuestService.advanceStep(charId, questKey, stepId)` chỉ khi `QuestProgress.status === ACCEPTED` + `stepProgress[stepId] < requiredCount` — fail-soft try-catch (quest already COMPLETED hoặc CLAIMED → no-op, KHÔNG throw 500). Retry clear (CAS guard return existing) → KHÔNG double quest progress. Khi quest yêu cầu `clear:storyDungeonKey` thì step mark complete + auto-COMPLETED nếu đó là last step.
- **Anti-abuse / Race**: (1) **start idempotency** qua composite-aware lookup ACTIVE run + return existing; (2) **claim idempotency** qua CAS `updateMany status: CLEARED → CLAIMED`; (3) **concurrent claim race** 2 request cùng `runId` → exactly 1 winner (count=1) + 1 loser (count=0 throws `RUN_NOT_CLAIMABLE`); (4) **no double reward** — reward grant nằm SAU CAS guard (winner-only path); (5) **no double quest progress** vì retry clear/claim cả 2 hit existing status; (6) **locked dungeon reject** `DUNGEON_LOCKED` khi `computeStoryDungeonStatus !== 'available'`; (7) **non-owner run reject** `RUN_NOT_FOUND` khi `run.characterId !== currentCharacterId`.
- **New ledger reasons**: `STORY_DUNGEON_REWARD` thêm vào `CurrencyService.LedgerReason` union + `InventoryService.ItemLedgerReason` union — phân biệt với `DUNGEON_RUN_REWARD` (farm dungeon) cho audit clarity.
- **Risk / rollback**: thấp-trung bình. Migration additive (1 enum + 1 table + 3 index, KHÔNG sửa table cũ) → rollback = `DROP TABLE StoryDungeonRun; DROP TYPE StoryDungeonRunStatus;` (data loss chỉ active runs đang dở, KHÔNG ảnh hưởng character/quest/inventory). Endpoint mới module riêng → disable bằng cách comment 4 route. Quest integration fail-soft (try-catch) nên revert chỉ cần rollback service → quest tự không được auto-advance. Không phá `DungeonRun` flow.
- **Out of scope**: KHÔNG FE map view (Phase 12.8.C), KHÔNG dialogue branch UI lớn, KHÔNG event/cutscene, KHÔNG PvP/pet/gacha, KHÔNG rewrite `DungeonRun` system.
- **Tests** (+15 runtime cases trong `story-dungeon.service.test.ts`): list available story dungeon / locked dungeon cannot start / start success + idempotent / one-time cannot start again after clear/claim / advance step success / invalid advance reject (RUN_NOT_ACTIVE + RUN_NOT_FOUND + RUN_STEP_INVALID) / clear success + invalid clear / clear updates quest progress (full + partial) / claim reward success / double claim reject (no double reward verified via ledger sum) / concurrent claim race only one success (Promise.all 2x) / non-owner cannot advance/clear/claim run / retry clear does not double quest progress / fail-soft quest service throw không phá clear flow.
- **Verification**: shared typecheck ✅ + test 1504 PASS ✅ / api typecheck ✅ + `--run story` 59 PASS ✅ / `--run dungeon` 82 PASS ✅ / `--run quest` 69 PASS ✅ / api test full **2188** PASS ✅ / pnpm build ✅.
- **Next**: Phase 12.8.C Story Dungeon FE + Dialogue/Reward Polish — FE map view consume `/story/dungeons` + `/story/dungeons/:key/start` + advance/clear/claim flow + reward modal + entry/clear dialogue trigger; touch-up i18n.

### Added — Phase 12.8.A Story Dungeon Catalog + API Foundation (PR #465)

- **Story Dungeon Instance riêng cho main quest** — tách khỏi dungeon farm chung (`combat.ts:DUNGEONS` / `dungeon-run` runtime). Thêm shared catalog `STORY_DUNGEONS` (`packages/shared/src/story-dungeons.ts`) với type `StoryDungeonTemplateDef` (key + i18n title/desc + `requiredQuestKey` + `requiredQuestStep?` + `regionKey: RegionKey` + `recommendedRealm` + `minRealmKey?` + `monsterKeys[]` + `bossKey?` + `entryDialogueKey?` + `clearDialogueKey?` + `rewardHint?` + `oneTime` + `enabled`) + `StoryDungeonRewardHint` (linhThach / tienNgoc / exp / items[]). 4 catalog seed gắn 4 main quest đầu tiên: Phàm Nhân Hậu Sơn Linh Tuyền Động (`phamnhan_realm_01:step_01` — son_coc), Luyện Khí Hắc Lâm Tâm Thử (`luyenkhi_main_01:step_02` — hac_lam, minRealm=luyenkhi), Trúc Cơ Mộc Huyền Lâm Ký Ức Cổ Thụ (`truc_co_main_01:step_03` — moc_huyen_lam, minRealm=truc_co), Kim Đan Kim Sơn Thiên Lò Lệnh (`kim_dan_main_01:step_02` — kim_son_mach, minRealm=kim_dan). Reuse 14 monster + 4 region + 4 dialogue node hiện có → zero orphan.
- **Helpers pure**: `storyDungeonByKey()`, `storyDungeonsForQuest()`, `computeStoryDungeonStatus(template, input)` returns `'locked'/'available'/'cleared'`, `availableStoryDungeonsForQuestState()`. Invariant validator `validateStoryDungeonCatalog()` check key uniqueness + snake_case + quest/step resolve qua `QUESTS` + region resolve qua `RegionKey` union + realm resolve qua `realmByKey` + monster/boss resolve qua catalog + dialogue resolve qua `STORY_DIALOGUES` + reward hint integer ≥ 0.
- **Endpoints mới**: `GET /story/dungeons` (list catalog `enabled=true` + status compute từ `Character.realmKey` + `QuestProgress.stepProgress`); `GET /story/dungeons/:key` (single template view). Response shape `StoryDungeonView { key, title*, description*, requiredQuestKey, requiredQuestStep, regionKey, recommendedRealm, minRealmKey, monsters[{ key, name, element, level }], boss?, rewardHint?, oneTime, status }`. Read-only — KHÔNG mutation, KHÔNG `RewardLedger` (Phase 12.8.B sẽ wire runtime).
- **Module riêng** `StoryDungeonModule` (`apps/api/src/modules/story-dungeon/`) — chỉ depend `AuthModule` + `PrismaService`. KHÔNG re-enter `QuestService` / `DungeonRunService` / `CurrencyService` (đọc thuần `Character` + `QuestProgress`). Register cuối cùng trong `app.module.ts` cùng nhóm story.
- **Server-authoritative**: status compute thuần dựa trên `QuestProgress.status` + `stepProgress` JSON + `realmByKey(char.realmKey).order` — FE chỉ render. `enabled=false` filter trước → admin toggle catalog không cần migration.
- **Risk / rollback**: zero — KHÔNG Prisma migration, KHÔNG mutation endpoint, KHÔNG ảnh hưởng `dungeon-run` runtime hiện có. Revert = xoá `packages/shared/src/story-dungeons.ts` + `apps/api/src/modules/story-dungeon/` + 1 dòng `app.module.ts` + 1 dòng `index.ts`. Nếu Phase 12.8.B chưa wire runtime, FE vẫn đọc được catalog cho UI map view (status sai sẽ chỉ gây render visual — KHÔNG ảnh hưởng economy).
- **Out of scope**: KHÔNG full `StoryDungeonRun` Prisma + start/advance/claim runtime, KHÔNG reward grant qua `RewardLedger`, KHÔNG FE map view, KHÔNG dialogue branch lớn, KHÔNG PvP/pet/gacha/auction, KHÔNG rewrite `DungeonRun` system. Phase 12.8.B sẽ wire `StoryDungeonRun` model + 4 endpoint runtime + reward atomic + auto-advance quest step khi clear.
- **Tests** (+36): shared **+25** (`story-dungeons.test.ts`: catalog ≥ 4 entries / key unique snake_case / `storyDungeonByKey` resolve / titleVi+descriptionVi non-empty + i18n key prefix / requiredQuestKey ∈ QUESTS / requiredQuestStep ∈ QuestDef.steps / regionKey ∈ RegionKey union / recommendedRealm + minRealmKey resolve qua realmByKey / monsterKeys không rỗng + zero orphan / bossKey resolve + region match / dialogue keys ∈ STORY_DIALOGUES / rewardHint integer ≥ 0 + qty > 0 / oneTime + enabled boolean / quest coverage ≥ 3 / `validateStoryDungeonCatalog` returns `[]` / `storyDungeonsForQuest` filter / `computeStoryDungeonStatus` x6 (locked / available / step-progress-short locked / COMPLETED → available / CLAIMED → cleared / minRealm gate locked) / `availableStoryDungeonsForQuestState` empty + cleared+available filter); api **+11** (`story-dungeon.service.test.ts`: NO_CHARACTER / Phàm Nhân baseline mọi entry locked / quest accepted + step done → available / quest accepted + step short → locked / quest CLAIMED → cleared / quest COMPLETED → available / Phàm Nhân không đủ minRealm Kim Đan → locked dù quest accepted / view shape monster+boss+rewardHint hydrated / `getByKey` template + status / `getByKey` DUNGEON_NOT_FOUND / `getByKey` reflects mutation between calls).
- **Verification**: shared typecheck ✅ + `pnpm --filter @xuantoi/shared test -- --run story-dungeons` 25 PASS ✅ / api typecheck ✅ + `pnpm --filter @xuantoi/api test -- --run story` 38 PASS ✅ / `pnpm --filter @xuantoi/api test -- --run dungeon` (cần verify) / pnpm build (cần verify trước khi PR).
- **Next**: Phase 12.8.B Story Dungeon Runtime + Quest Integration — Prisma `StoryDungeonRun` model + 4 endpoint (`POST /story/dungeons/:key/start` / `POST /story/dungeon-runs/:runId/next` / `POST /story/dungeon-runs/:runId/claim` / `POST /story/dungeon-runs/:runId/abandon`) + reward grant atomic qua `CurrencyService.applyTx` reason `STORY_DUNGEON_REWARD` + `InventoryService.grantTx` + auto-advance quest step khi clear (`QuestService.track` cho `kill+monster` step) + entry/clear dialogue trigger.

### Added — Phase 12 Story Dialogue Foundation (PR #464)

- **Branching NPC dialogue cho main quest** — story giờ không còn chỉ là quest kill/claim. Thêm shared catalog `STORY_DIALOGUES` (`packages/shared/src/story-dialogues.ts`) với type `DialogueNodeDef` + `DialogueChoiceDef` + 4 condition kind (`quest_status` / `flag` / `seen_node` / `realm_min`) + 4 effect kind (`mark_seen` / `set_flag` / `give_reward` / `advance_quest_step`). Helpers `findStoryDialogueNode` / `getStoryDialogueRoot` / `evaluateChoiceConditions` resolve server-authoritative.
- **Endpoints mới**: `GET /story/dialogue/:npcKey` (filter conditions theo character ctx → `StoryDialogueNodeView` với choices kèm `available` / `unavailableReason`); `POST /story/dialogue/:npcKey/choice` (Zod `{nodeId, choiceKey}`, atomic `prisma.$transaction` apply effects: mark_seen → set_flag → give_reward qua `CurrencyService.applyTx` reason `STORY_DIALOGUE_CHOICE` (composite UNIQUE `(characterId, refType, refId)` chống double-grant) → advance_quest_step qua `QuestService.track` chỉ khi quest ACCEPTED + step matches).
- **Prisma migration `20260602000000_phase_12_story_dialogue_foundation`**: thêm 2 cột Json trên `Character`: `storyDialogueSeen` (default `[]`) + `storyFlags` (default `{}`). Server-only state; FE refetch qua `GET /character/state`.
- **FE**: `apps/web/src/api/storyDialogue.ts` (axios client) + `stores/storyDialogue.ts` (Pinia open / pickChoice / close + navigate `nextNode`) + `components/StoryDialogueModal.vue` (Teleport modal song song với `NpcDialogueModal.vue` quick-accept; render text + choices + disabled state với `alreadyApplied` / `unavailableReason` hint + reward toast + Esc/backdrop close). Integrate `NpcView.vue` parallel với existing quick-accept flow — KHÔNG rewrite legacy dialogue UI.
- **i18n vi/en parity** (`storyDialogue.{title, talk, alreadyChosen, locked, empty, linhThach, tienNgoc, errors.*}` mapped tới error code server).
- **Server-authoritative**: FE chỉ render. Conditions / effects evaluate server-side; client KHÔNG bypass. Reward grant idempotent qua composite UNIQUE — race-safe (P2002 → return existing ledger entry).
- **Anti-abuse**: `give_reward` capped catalog-only; `advance_quest_step` chỉ chạy nếu quest ACCEPTED + step matches (không skip locked step). Catalog invariant test ngăn drift `nextNodeId` reference / orphan node / duplicate `(npcKey, nodeId)`.
- **Risk / rollback**: thấp — Prisma migration thêm 2 cột Json default-value (additive, không phá row hiện có). Endpoint mới module riêng `StoryDialogueModule` register sau cùng trong `app.module.ts` — disable bằng cách remove import. FE modal là parallel component với existing `NpcDialogueModal.vue`; revert = xoá file diff. Reward grant qua existing `CurrencyService.applyTx` (Phase 11 ledger), không thêm reason value mới conflict.
- **Out of scope**: KHÔNG full story dungeon instance, KHÔNG cutscene lớn, KHÔNG rewrite quest system, KHÔNG PvP/pet/gacha. Catalog seed ban đầu chỉ 5 dialogue node cho 3 NPC chính (Lăng Vân Sinh phamnhan + Mộc Thanh Y luyenkhi + Huyết La Sát kim_dan); mở rộng tách ra PR sau.
- **Tests** (+33): shared +5 (catalog invariant + helper resolve + 4 condition kind), api +16 (story-dialogue.service: GET success / locked / missing-NPC, POST mark_seen / set_flag / give_reward idempotent + double-claim guard / advance_quest_step success + QUEST_STEP_LOCKED / CHOICE_LOCKED / CHOICE_ALREADY_APPLIED / NODE_NOT_FOUND / atomic rollback), web +12 (StoryDialogueModal render / choice disable / pickChoice click / error i18n / Esc close / loading + store open/pickChoice/close).
- **Verification**: shared typecheck ✅ + test ✅ / api typecheck ✅ + test ✅ / web typecheck ✅ + `pnpm --filter @xuantoi/web test -- --run StoryDialogue` 12 PASS ✅ / `pnpm build` ✅.

### Added — Admin LiveOps Advanced Controls (PR #463)

- **Mở rộng admin tooling sau Phase 13.1.B**: nâng `BossService.adminSpawn()` thành dual-audit (legacy `BOSS_SPAWN` + Phase 13.1.C `ADMIN_FORCE_BOSS_SCHEDULE`) ghi cùng `meta {bossKey, regionKey, level, bossId}` + `reason?` (trim, ≤200 chars; whitespace-only → `null`); thêm `AdminLiveOpsService.snapshotSectWarStatus(actorId, weekKey, reason?)` read-after-audit (gọi `getSectWarStatus(weekKey)` rồi ghi 1 audit `ADMIN_SECT_WAR_STATUS` với `meta {targetType:'SectWarWeek', targetId:weekKey, summary:{totalSects,totalContributors,totalContributions,topSectIds:string[≤3]}, reason}` — **KHÔNG mutate** contribution rows).
- **Endpoints mới / mở rộng**: `POST /admin/sect-war/snapshot` (Zod `{weekKey?:'YYYY-Www', reason?:string≤200}` → fallback computed week nếu thiếu; non-admin reject qua `AdminGuard`); `POST /boss/admin/spawn` body mở rộng `{ bossKey?, regionKey?, level? (1..3), reason? (≤200) }` — service vẫn return `regionKey` trong result + audit cả 2 row.
- **FE Admin panel** (`apps/web/src/components/AdminLiveOpsPanel.vue`): thêm section "Force Boss Spawn" (region select dựa trên `LIVE_OPS_EVENTS[].regionKey` distinct + bossKey/level/force/reason form) gọi `adminSpawnBoss()`; thêm button "Snapshot week" gọi `adminSectWarSnapshot()` refresh sectWar view + toast success/error; i18n vi/en parity (`adminLiveOps.boss.*` + `adminLiveOps.sectWar.snapshotBtn`). Error mapping: `BOSS_ALREADY_ACTIVE` → toast i18n; `BOSS_DEFINITION_NOT_FOUND` → toast i18n; missing region → client-side guard (KHÔNG fan-out request).
- **Audit log entries (Phase 13.1.C confirmed)**: `ADMIN_LIVEOPS_OVERRIDE` (toggle event, từ Phase 13.1.B), `ADMIN_FORCE_BOSS_SCHEDULE` (force-spawn boss, dual với `BOSS_SPAWN`), `ADMIN_SECT_WAR_STATUS` (snapshot read-after-audit). Mọi audit có `actorUserId`, `meta`, `reason?` (trim), backwards-compatible với existing `BOSS_SPAWN` consumers.
- **Risk / rollback**: thấp — KHÔNG Prisma migration mới (reuse `AdminAuditLog` + `LiveOpsEventOverride`). KHÔNG sửa contribution rows hoặc claim rows. Revert = drop file diff (boss.service `adminSpawn` legacy 1-row audit, admin-liveops.service xoá `snapshotSectWarStatus`, admin.controller xoá `sectWarSnapshot` route, FE panel revert). Audit consumers đọc cả `BOSS_SPAWN` lẫn `ADMIN_FORCE_BOSS_SCHEDULE` → tương thích với data history.
- **Tests** (+27): api `boss.service.region.test.ts` +3 (dual audit ADMIN_FORCE_BOSS_SCHEDULE meta + reason / no reason → null / whitespace → null), `admin-liveops.service.test.ts` +4 (empty week snapshot / data summary topSectIds order / 2-snapshot separate audit / whitespace reason → null), `admin.controller.test.ts` +4 (snapshot route 200 / weekKey fallback / weekKey invalid format → 400 / reason >200 → 400), web `AdminLiveOpsPanel.test.ts` +6 (region select render / spawn submit / region missing guard / spawn API error mapping / snapshot click refresh / snapshot API error). Test baseline: api **2140** (+6 từ Phase 13.1.C dual-audit + snapshot service + controller route từ trước cộng 23 case), web **1271** (+6).
- **Verification**: shared typecheck ✅ / api typecheck ✅ / web typecheck ✅ / `pnpm --filter @xuantoi/api test -- --run admin-liveops` 14 PASS ✅ / `pnpm --filter @xuantoi/api test -- --run boss.service.region` 11 PASS ✅ / `pnpm --filter @xuantoi/api test -- --run admin.controller` 101 PASS ✅ / `pnpm --filter @xuantoi/web test -- --run AdminLiveOpsPanel` 10 PASS ✅ / api test full **2140** ✅ / pnpm build ✅.

### Internal — Daily-login extended coverage (PR #462)

- **Mở rộng `daily-login` test sau PR #460**: `apps/api/src/modules/daily-login/daily-login.extended.test.ts` (+6 vitest) lock thêm 3 nhóm scenario quan trọng:
  1. **Streak 30 ngày liên tục** → streak monotonic 1→30, balance += 3000 LT, 30 row `CurrencyLedger` reason `DAILY_LOGIN`, 30 row `DailyLoginClaim` với `streakAtClaim` đồng nhất. Locks catalog flat 100 LT/ngày — nếu tương lai catalog escalate (vd ngày 7/14/21/30 bonus) thì test failed có chủ đích để buộc chỉnh sync test+docs cùng PR đó.
  2. **Race-condition `Promise.all`**: 5 claim concurrent cùng `(userId, now)` → đúng 1 winner +100 LT, 4 loser idempotent (`claimed=false`, `linhThachDelta='0'`, balance KHÔNG cộng 2 lần). Cover composite UNIQUE `(characterId, claimDateLocal)` + P2002 fallback path. Thêm 10 claim trên 2 ngày liên tiếp (5+5 race) → 2 winner, streak monotonic 1→2 sau race.
  3. **Controller-level DB-backed smoke** qua `DailyLoginController.me()`/`.claim()` với `AuthService` stub (KHÔNG đụng JWT/Redis): flow 4 step (status pre-claim → claim → status post-claim → reclaim idempotent) verify envelope `{ ok:true, data }` + state DB đồng nhất. Bonus: 401 khi không cookie, 404 mapping cho user không có character.
- **Risk / rollback**: zero — pure test file, KHÔNG sửa service / controller / endpoint / Prisma schema. Revert = xoá file. Không ảnh hưởng test baseline khác. Chạy được trên local (PG up) + GitHub CI (PG service container).
- **Verification**: api typecheck ✅ / `pnpm --filter @xuantoi/api test -- --run daily-login` 34 PASS ✅ / `pnpm --filter @xuantoi/api test -- --run daily` 34 PASS ✅ / api test full **2129** (+6) ✅ / pnpm build ✅.

### Internal — Daily-login multi-day smoke positive (PR #460)

- **Multi-day integration test** `apps/api/src/modules/daily-login/daily-login.multi-day.test.ts` (5 case, +5 vitest) cho `DailyLoginService.claim(userId, now)` qua test-clock injection — service signature đã hỗ trợ `now: Date` param từ Phase 11 nên KHÔNG mở endpoint dev mới. Cover:
  1. Chuỗi 7 ngày liên tục → streak monotonic 1→7, +700 LT, 7 row `CurrencyLedger` reason `DAILY_LOGIN`, 7 row `DailyLoginClaim` với `claimDateLocal` monotonic +1.
  2. Reward ngày 7 = `DAILY_LOGIN_LINH_THACH` flat catalog (100 LT/ngày, không escalate — closed beta lock).
  3. Double-claim cùng ngày giữa chuỗi 7 ngày → idempotent (`claimed=false`, `linhThachDelta='0'`, streak preserved, không cộng tiền 2 lần).
  4. Missed day giữa chuỗi → streak reset về 1 ở ngày sau (anti free-streak), tổng LT đúng theo số ngày thực claim.
  5. Timezone boundary VN ICT: 16:30 UTC vs 17:30 UTC = khác local date (cross VN midnight 17:00 UTC); và cùng ngày VN nhưng 22h UTC sau → idempotent (anti tz-shift double-claim).
- **Risk / rollback**: zero — pure test file, KHÔNG sửa service / controller / endpoint / Prisma schema. Revert = xoá file. Không ảnh hưởng test baseline khác.
- **Verification**: api typecheck ✅ / api test full **2123** (+5) ✅ / pnpm build ✅. Pre-existing flaky `chat.service.test.ts` rate-limit pass on retry, không liên quan.

### Added — Phase 13.1.B Sect Missions, Sect Shop & Admin LiveOps Controls (PR #459)

- **Sect Mission system** — daily/weekly mission Tông Môn cộng `congHien` (= `Character.contribBalance`). 5 entry catalog: 3 DAILY (`sect_daily_dungeon_3` +30, `sect_daily_boss_participate` +40, `sect_daily_boss_damage` +35) + 2 WEEKLY (`sect_weekly_quest_5` +150 contrib +500 LT, `sect_weekly_breakthrough_1` +200 contrib +800 LT). Active player ~1085 contribution/tuần. Reset DAILY 00:00 ICT, WEEKLY ISO week (Mon 00:00 → Sun 23:59 ICT), reuse `MISSION_RESET_TZ`.
- **Sect Shop** — spend `congHien` đổi 5 entry: huyết chỉ đan (50/lần, 5/ngày), thanh lam đan (250/lần, 3/ngày), cổ thiên đan (200/lần, 3/tuần), huyết tinh (80/lần, 10/tuần), thần đan (5000/lần, 1/tuần). Daily/weekly limit aggregate qua `SectShopPurchase.qty` window, max spend ~13,800 contrib/tuần.
- **API mới** (8 endpoints): `GET /sect/missions`, `POST /sect/missions/:key/claim`, `GET /sect/shop`, `POST /sect/shop/buy`, `GET /admin/liveops`, `POST /admin/liveops/event/toggle`, `GET /admin/sect-war/status`, `POST /admin/sect-war/recalculate`.
- **Race-safety / atomicity**: claim mission idempotent qua composite UNIQUE `(characterId, missionKey, periodKey)` (P2002 → `MISSION_ALREADY_CLAIMED`). Buy shop entry atomic CAS `Character.updateMany({ where: { id, contribBalance: { gte: cost*qty } } })` — count=0 → reject `INSUFFICIENT_CONTRIB` không trừ tiền không grant item. Toàn bộ side-effect (decrement balance + ledger + InventoryService.grantTx + SectShopPurchase row + reward currency) chạy trong cùng `prisma.$transaction` → rollback toàn bộ nếu fail giữa chừng. Rate limit 30 req/60s per user (Redis primary + in-memory fallback) → `RATE_LIMITED` 429 ngoài transaction.
- **Admin LiveOps controls** — `/admin/liveops` (status snapshot, override status), `/admin/liveops/event/toggle` (upsert `LiveOpsEventOverride` + audit `ADMIN_LIVEOPS_OVERRIDE`), `/admin/sect-war/status` (read-only diagnostic), `/admin/sect-war/recalculate` (no-op audit, future-proof). Mọi endpoint `AdminGuard` (role=ADMIN).
- **Web UI** — `SectWarView` mở rộng thành tab system 5 tab (overview / leaderboard / missions / shop / rewards) qua `useRoute().query.tab`. Mới: `SectMissionPanel.vue` (mission list + progress + claim), `SectShopPanel.vue` (shop catalog + balance + buy + limit badge), `AdminLiveOpsPanel.vue` (event toggle + audit). Home/Sect/Admin integration + i18n vi/en đầy đủ.
- **Prisma migration `20260601000000_phase_13_1_b_sect_missions_shop_liveops`**: 3 table mới `SectMissionClaim` (composite UNIQUE `(characterId, missionKey, periodKey)`), `SectShopPurchase` (per-buy audit, dùng cho daily/weekly limit aggregate), `LiveOpsEventOverride` (admin override flag). 2 cột mới trên `Character`: `contribBalance` (Int default 0, ≥ 0 invariant qua CAS) + `contribLifetime` (Int default 0, audit-only). 2 enum mới: `CurrencyLedgerReason.SECT_MISSION_CLAIM`, `ItemLedgerReason.SECT_SHOP_BUY`. 1 audit action mới `ADMIN_LIVEOPS_OVERRIDE`. **Rollback risk**: thấp — drop 3 table + 2 cột không ảnh hưởng module khác. Ledger entry với reason mới sẽ ở lại nhưng không gây side-effect.
- **Anti-abuse**: mission claim idempotent + cap derive từ contribution rows server-side, shop daily/weekly limit, NON_STACKABLE guard, item grant rollback (InventoryService fail → tx rollback → contribBalance không trừ), rate limit, `SECT_REQUIRED` guard mọi endpoint sect-side.
- **Tests** (+56 mới): api `sect-shop.service.test.ts` 12 cases (buy success/insufficient/daily-limit/weekly-limit/NON_STACKABLE/RATE_LIMITED/concurrent CAS/grant rollback/ledger), `admin-liveops.service.test.ts` 10 cases (status/toggle/audit/sect-war status/recalc/non-admin reject), web `SectMissionPanel.test.ts` 5, `SectShopPanel.test.ts` 7, `AdminLiveOpsPanel.test.ts` 4, fix `SectWarView.test.ts` 8 (tab system migration). Test baseline: shared 1463, api 2118, web 1265.

### Fixed — Post Phase 13.1.A Sect War hardening audit (PR #458)

- **`SectWarService.addContributionTx` daily cap drift +7h**: query daily-cap window dùng `setUTCHours(0,0,0,0)` (= 07:00 ICT) thay vì `startOfLocalDay(now, MISSION_RESET_TZ)` (= 00:00 ICT). Hệ quả: cap reset không đồng nhất với dungeon dailyLimit / mission DAILY / daily-login streak. Trên closed beta `Asia/Ho_Chi_Minh`, player có thể lách `dungeon_clear` cap 50/ngày bằng cách clear trước 07:00 ICT — rows hôm trước @ 23:00 ICT (= 16:00 UTC) vẫn cùng ISO week (weekKey filter pass) nhưng bị nhóm sai vào "hôm nay" theo cửa sổ UTC. **Fix**: import `startOfLocalDay` từ `combat.service` + `getMissionResetTz` từ `mission.service`, dùng cùng pattern với các module daily/weekly khác. **+1 regression test** `sect-war.service.test.ts` reproduce: pre-insert 5 dungeon_clear contributions @ Mon 23:00 ICT (cap exact), call addContributionTx với now=Tue 01:00 ICT (cùng ISO week 20) — pre-fix cap hit reject; post-fix cap reset accept.
- **`docs/API.md` composite UNIQUE order**: ghi sai `(weekKey, sourceType, sourceId, characterId)` (thiếu `activityKey`). Fix: `(weekKey, characterId, activityKey, sourceType, sourceId)` match Prisma schema. Cập nhật doc cũng thêm note daily cap window theo `MISSION_RESET_TZ`.

### Added — Phase 13.1.A Sect War Core, Contribution, Leaderboard & Weekly Reward (PR #457)

- **Tông Môn Chiến tuần lễ** — bảng xếp hạng tông môn theo tuần (`weekKey = ISO 'YYYY-Www'`, timezone `Asia/Ho_Chi_Minh`, season chạy Thứ Hai 00:00 → Chủ Nhật 23:59 ICT).
- **5 nguồn điểm gameplay** (server-authoritative, idempotent qua `(weekKey, characterId, activityKey, sourceType, sourceId)` UNIQUE):
  - Daily login claim → +5 điểm/ngày (cap 7/tuần).
  - Dungeon clear (claim DungeonRun) → +10 điểm/lần (cap 50/ngày).
  - Boss participation (≥1 đòn đánh, distributeRewards) → +15 điểm (cap 120/tuần).
  - Boss top damage rank-1 → +25 bonus (cap 100/tuần).
  - Quest claim → +8 điểm (cap 80/tuần).
- **Reward tier tuần** (claim qua `POST /sect-war/claim`, `(weekKey, characterId)` UNIQUE chống double claim):
  - Rank 1 → 5,000 LT + 200 TN + title `sect_war_champion`.
  - Rank 2-3 → 2,500 LT + 100 TN.
  - Rank 4-10 → 1,000 LT + 50 TN.
  - Participation (cá nhân ≥ 50 điểm, không cần rank) → 200 LT.
- **API mới**: `GET /sect-war/current` (snapshot tuần), `GET /sect-war/leaderboard` (top sect), `GET /sect-war/me` (status cá nhân + breakdown), `POST /sect-war/claim` (atomic CAS qua composite UNIQUE — race-safe, 1 claim duy nhất khi 2 request concurrent).
- **Hook gameplay** (defensive try-catch trong tx — title/buff fail KHÔNG rollback economy reward chính): DungeonRunService.claim, BossService.distributeRewards (participation + topDamage), DailyLoginService.claim, QuestService.claim. Character không có sect → no-op (return null, không ghi row).
- **Web UI** `/sect-war` — countdown tuần, my progress + breakdown, leaderboard top sect (highlight tông của tôi), bảng activity rules + reward tier, claim button gating (`canClaim` = hasSect + eligibleTier + !alreadyClaimed). HomeView LiveOps panel thêm CTA "Tông Môn Chiến". i18n vi/en đầy đủ.
- **Prisma migration `20260524000000_phase_13_1_a_sect_war_core`**: `SectWarContribution` + `SectWarWeeklyRewardClaim` table mới với composite UNIQUE chống double-add và double-claim. Rollback risk: thấp — drop 2 table không ảnh hưởng module khác.
- **Anti-abuse**: dailyCap/weeklyCap enforce trong service (KHÔNG thể bypass qua FE), contribution KHÔNG thể tự thêm (mọi nguồn đi qua hook server-side), claim chống race qua composite UNIQUE + transaction.

### Fixed — Phase 13.0 audit pass #4: TitleService + BuffService P2002 race (PR #455)

- **`TitleService.unlockTitleTx()` race**: pattern `findUnique → if not exists → create` KHÔNG atomic. 2 boss reward hook concurrent cùng `(characterId, titleKey)` (vd participant tham gia 2 boss defeat sát nhau, hoặc 2 cluster pod chạy heartbeat song song) → cả 2 thấy không tồn tại → cả 2 gọi `tx.characterTitleUnlock.create` → race loser hits Prisma `P2002` (unique constraint) → Postgres aborts entire `$transaction`. Boss reward hook có `try/catch` swallow log warn nhưng tx outer đã aborted → **subsequent currency + inventory grant cũng fail** (tx rollback) → **player mất reward kinh tế**. **Fix**: refactor sang `tx.characterTitleUnlock.createMany({ data: [...], skipDuplicates: true })` — Prisma dịch sang Postgres `INSERT … ON CONFLICT DO NOTHING`, đúng atomic, không bao giờ throw P2002. (Prisma's `upsert` KHÔNG atomic — nó là find-then-update/create — đã thử và fail race test.)
- **`BuffService.applyBuffTx()` race**: cùng pattern. Concurrent top-1 boss reward → race loser P2002 → boss reward tx aborted → mất reward. **Fix**: `createMany skipDuplicates` cho insert path (atomic), nếu count=0 (existing row) thì UPDATE với newStacks computed pre-call. Stacks count race window vẫn tồn tại nhưng nhỏ + không phá tx outer (UPDATE không throw P2002). Non-stackable buff không bị ảnh hưởng (newStacks = existing.stacks).
- **2 regression test mới** (`title.service.test.ts`, `buff.service.test.ts`): `Promise.all` 2 wrapper concurrent cùng key — pre-fix throw P2002, post-fix cả 2 commit + chỉ 1 row composite UNIQUE. Cover boss reward hook race scenario.

### Fixed — Phase 13.0 audit pass #3: i18n key catalog mismatch + BALANCE schedule stale

- **i18n vi/en bị lệch catalog event keys** (`liveops.event.*`): catalog có 4 key (`daily_exp_rush_morning` 07:00 60min, `daily_dungeon_rush_evening` 20:00 60min, `weekly_sect_aura_sunday` Chủ Nhật 06:00 720min, `limited_lunar_new_year_2027` Feb 2027 7-day disabled) nhưng i18n chỉ có 2 orphan key (`event_daily_exp_rush`, `event_weekly_dungeon_double_drop`) còn lại từ phiên bản trước của Phase 13.0. **Hệ quả**: khi 1 trong 4 event này active (vd 07:00-08:00 ICT exp rush), `LiveOpsTodayPanel` render `liveops.event.daily_exp_rush_morning.title` literal thay vì "Triêu Quang Lộ Khí". **Fix**: thêm 4 entry mới + xoá 2 orphan trong vi.json/en.json, viết lại nội dung match catalog dailyTime/durationMinutes; thêm 2 parity test trong `apps/web/src/i18n/__tests__/parity.test.ts` walk `LIVE_OPS_EVENTS` assert `titleI18nKey` + `descriptionI18nKey` tồn tại trong cả vi và en (regression guard cho mọi catalog rename tương lai).
- **`docs/BALANCE_MODEL.md` §6.4 schedule table stale**: 2 row buff event ghi sai key cũ + sai dailyTime/durationMinutes (`event_daily_exp_rush 18:00 180min`, `event_weekly_dungeon_double_drop 00:00 1440min`). **Fix**: viết lại 4 row đúng với catalog hiện tại (3 daily 60min + 1 weekly Sunday 720min + 1 LIMITED disabled). Schedule reasoning rationale giữ nguyên (không phá economy).
- **Test fixture `LiveOpsTodayPanel.test.ts`**: `event_daily_exp_rush` key trong fixture cũng được chuẩn hoá sang `daily_exp_rush_morning` cho consistency với catalog (test logic không đổi).

### Added — Phase 13.0 LiveOps & Retention Suite (PR #452)

- **LiveOps Event Calendar (shared)**: catalog mới `LIVE_OPS_EVENTS` định nghĩa 5 sự kiện scheduled: 3 boss daily (12:00 / 19:00 / 22:00 ICT) + 1 boss tuần Huyết Nguyệt (Thứ Bảy 21:00 ICT) + 2 buff event (`event_daily_exp_rush` 18:00-21:00, `event_weekly_dungeon_double_drop` Chủ Nhật cả ngày). Helpers `liveOpsEventsForToday()`, `activeLiveOpsEvents()`, `nextLiveOpsEvent()`, `bossScheduleForToday()`, `liveOpsEventForBossSpawn()` deterministic, timezone mặc định `Asia/Ho_Chi_Minh` reuse `MISSION_RESET_TZ`.
- **Scheduled Boss Spawn**: `BossService.tickHeartbeat()` mở rộng đọc schedule, mỗi region check active slot. Spawn nếu slot active + region không có ACTIVE boss + chưa spawn `(regionKey, bossKey, spawnedAt >= slotStart)` (slot dedup query-based, idempotent qua parallel heartbeat). Cuối tuần Thứ Bảy 21:00 → Cửu La Thiên Đế xuất thế ở Cửu La Điện. Giữ nguyên adminSpawn + boss-by-region unique guard + attack/reward.
- **Reward Hooks (Title + Buff)**: khi boss bị hạ và distribute reward — mọi participant unlock title `achievement_first_boss` (idempotent), top-1 damage rank apply buff `event_double_drop` (1h), nếu boss spawn từ slot Huyết Nguyệt → mọi participant unlock title mới `event_huyet_nguyet_2026` (epic, +3% atk flavor stat). Tx-safe defensive try-catch — nếu title/buff fail, gameplay reward (linh thạch/item) vẫn rollback đúng.
- **`/liveops/today` API**: endpoint pure compute (no auth) trả retention dashboard snapshot — `nowIso`, `timezone`, `todayEvents`, `activeEvents`, `nextEvent` (countdown), `bossSchedule` (3-4 slot status upcoming/active/completed), `suggestedActivities` (priority-sorted CTA hints). Chi tiết shape ở `docs/API.md`.
- **FE Today Activity Panel** (`HomeView`): "Hoạt Động Hôm Nay" — danh sách suggested CTA, sự kiện đang mở, lịch boss hôm nay với status badge. CTA buttons "Đi Boss" / "Vào Bí Cảnh" / "Xem Nhiệm Vụ". i18n vi/en cho 5 event + 4 boss + 4 region. API error → fallback message, không crash.
- **FE BossView Schedule UI**: section "Lịch Boss hôm nay" trên đầu BossView — hiển thị giờ + boss + region + status (active/upcoming/completed) + countdown nếu sắp tới. Không phá active boss tabs hiện có.
- **FE Notification**: `LiveOpsNotice` component renderless, poll `/liveops/today` mỗi 60s — push toast warning khi có boss upcoming ≤ 15 phút. Anti-spam: per-slot flag persistent qua sessionStorage (mỗi slot chỉ 1 toast / session); toast store cũng có anti-spam riêng theo (type+text) 1200ms.
- **Catalog**: title +1 (`event_huyet_nguyet_2026` epic event-source). Buff catalog không thay đổi.
- KHÔNG Prisma migration. KHÔNG ảnh hưởng economy chính (chi tiết balance ở `docs/BALANCE_MODEL.md` §6.4).

### Added — Phase 11.10.E Title/Buff gameplay reward hooks — Pill → Buff wire (PR #451)

- **Pill → Buff apply**: 4 đan dược mới (Cương Lực Đan, Thiết Bích Đan, Sinh Cơ Đan, Linh Tâm Đan) khi `use()` sẽ apply BuffDef tương ứng (`pill_atk_buff_t1` +12% atk 60s, `pill_def_buff_t1` +15% def 60s, `pill_hp_regen_t1` hồi 5 HP/s 30s, `pill_spirit_buff_t1` +18% spirit 90s). Catalog buff đã có sẵn từ Phase 11.8.A nhưng **chưa được apply qua gameplay** — PR này wire 4 pill items qua `effect.buffKey` field mới + `InventoryService.use()` gọi `BuffService.applyBuffTx()` cùng tx (atomic — fail tx → buff KHÔNG insert + pill KHÔNG decrement).
- **NPC shop**: 4 pill mới có sẵn ở NPC shop (Linh Thạch, dailyLimit 5/người/ngày — tránh stack buff abuse vào PvP/boss event).
- **Audit Phase 11.10.E gameplay reward sources** — xác nhận 4/5 hook đã wire trước đó (realm breakthrough → realm milestone title via `character.service.ts:227,309,585`; achievement claim → title via `achievement.service.ts:425-435`; boss kill → title gián tiếp qua achievement `first_boss_kill`; dungeon clear → title gián tiếp qua achievement `first_dungeon_clear`; tribulation/breakthrough FAIL → tam_ma debuff). Pill → buff là gap thực sự duy nhất.
- **Catalog cross-ref guard**: helper `buffForItem(itemKey)` shared package + 9 test cases drift guard (mọi item có `effect.buffKey` phải lookup được buff; mọi pill_*_buff_t1 phải có ≥ 1 item link tới — no orphan buff).
- **Idempotent + race-safe**: `CharacterBuff` composite UNIQUE `(characterId, buffKey)` đảm bảo non-stackable refresh `expiresAt`, stackable +1 stack cap `maxStacks`. Pre-tx catalog drift guard (item declared `buffKey` nhưng buff không tồn tại → throw KHÔNG decrement).
- Backward-compat: `InventoryService` 4th param `buffs?` optional — legacy bootstrap (test fixtures không inject) tiếp tục work, skip buff apply silently.

### Added — M10 Shop daily purchase limit + per-user rate limit (PR #450)

- **Per-item daily purchase cap**: mỗi entry trong NPC shop có thể đặt `dailyLimit` (opt-in). Player vượt cap → toast "Vượt hạn mức mua hôm nay. Thử lại sau khi reset". Reset 00:00 theo `MISSION_RESET_TZ` (mặc định `Asia/Ho_Chi_Minh`) — cùng mốc reset với daily mission / daily-login / dungeon `dailyLimit`. Mặc định cho closed beta: pills HP/MP = 20/ngày, đan exp + ore = 10/ngày, equipment phàm phẩm = 5/ngày.
- **Per-user rate limit**: 30 lần `POST /shop/buy` trong 60 giây mỗi user. Vượt → 429 + toast "Mua quá nhanh — vui lòng chậm lại và thử lại sau". Chặn script abuse / race exploit. Limit theo `userId` (không phải IP) → 1 acc share IP với người khác không liên đới.
- **Anti-economy abuse**: cả 2 tầng pre-check trước transaction — KHÔNG trừ tiền khi reject. Rate limit dùng Redis sliding window (cross-instance) với `FailoverRateLimiter` wrapper → Redis down runtime fallback in-memory, KHÔNG bao giờ 500.
- **FE shop**: mỗi entry hiện badge "Hạn mức hôm nay: N" khi có `dailyLimit`. i18n vi + en cho 2 error code mới.
- Backend-only architecture: KHÔNG migration mới — daily count derive từ `ItemLedger` reason='SHOP_BUY' với index `(reason, createdAt)` đã có sẵn.

### Added — Phase 11.8.D Buff HUD + 11.9.C Title catalog/equip — FE wire (PR #449)

- **Title catalog UI** (`/titles`): xem 26 danh hiệu trong game (5 rarity × 6 source × 5 element), filter theo source/rarity/status, **trang bị** danh hiệu đã unlock (single-slot), **gỡ bỏ** equipped title. Topbar (lg+ screens) hiển thị tên danh hiệu đang trang bị màu vàng (`amber-200`) bên dưới tên nhân vật.
- **Buff HUD** (topbar): hiển thị các buff/debuff đang active dưới dạng pill (xanh lá = buff, hồng = debuff) với countdown timer auto-update mỗi giây và tự động fetch lại khi có buff hết hạn. Format thời gian: `<60s = "30s"`, `<60m = "5m30s"`, `≥1h = "1h05m"`. Stacks > 1 hiển thị `×N`.
- **i18n**: vi + en đầy đủ cho menu sidebar (`號 Danh Hiệu`), TitleView, BuffBar HUD, 9 error code (`TITLE_NOT_FOUND`, `TITLE_NOT_OWNED`, `ALREADY_EQUIPPED`, `NOT_EQUIPPED`, `IN_FLIGHT`, ...).
- Backend đã có 4 endpoint trên main; PR này chỉ wire FE (không Prisma migration).

---

## [session 9r-28 — Title auto-unlock trilogy (breakthrough + tribulation + onboard) + docs catch-up — PR #279 → #281, merged 2/5 2026]

### Internal — Phase 11.9.C trilogy: Title auto-unlock realm milestone wire

Sau Phase 11.9.B PR #245 đã có `TitleService.unlockTitle()` + `unlockTitleTx()` runtime persistence + `CharacterTitleUnlock` Prisma model với composite UNIQUE `(characterId, titleKey)`, **trilogy 11.9.C** wire helper `titleForRealmMilestone(realmKey)` từ shared catalog vào 3 character life-cycle event sites:

- **Breakthrough low-tier title wire** (PR #280 / Phase 11.9.C): `apps/api/src/modules/character/character.service.ts` — import `Logger` + `titleForRealmMilestone` + `TitleService`. Constructor add `titles?: TitleService` 6th positional optional (NestJS DI auto-resolve). Sau `prisma.character.update` trong `breakthrough()` thành công, gate `if (this.titles && next)` rồi lookup `titleForRealmMilestone(newRealm)` → call `titles.unlockTitle(charId, def.key, 'realm_milestone')` trong try/catch. Fail-soft: title unlock lỗi KHÔNG fail breakthrough core path. Idempotent qua composite UNIQUE. 4 vitest mới (1441 → 1445 api).

- **Tribulation high-tier title wire** (PR #281 / Phase 11.9.C-2): `apps/api/src/modules/character/tribulation.service.ts` — import `Logger` + `titleForRealmMilestone` + `TitleService`. Constructor add `titles?: TitleService` 3rd positional optional. Sau `currency.applyTx` trong SUCCESS branch (cùng `prisma.$transaction` đã có), gate `if (this.titles)` rồi lookup `titleForRealmMilestone(next.key)` → call `titles.unlockTitleTx(tx, charId, def.key, 'realm_milestone')` — TX-AWARE variant (KHÔNG mở tx mới). **Khác Phase 11.9.C low-tier**: KHÔNG fail-soft DB error (rollback toàn bộ tx) — chỉ catch `TITLE_NOT_FOUND` (catalog drift) → `Logger.warn`. Tribulation success path tx-atomic — nếu title unlock fail vì DB constraint thật, rollback better than partial state. 5 vitest mới (1445 → 1450 api).

### Internal — Phase 11.10.G test hardening (no catalog change)

- **Achievement catalog cross-ref invariants** (PR #279 / Phase 11.10.G): `packages/shared/src/achievements.test.ts` — add 2 vitest invariant: (1) `mọi reward.items[*].itemKey PHẢI tồn tại trong ITEMS catalog`, (2) `mọi rewardTitleKey PHẢI tồn tại trong TITLES catalog`. Bảo vệ Phase 11.10.D `claimReward` items grant path từ catalog drift (vd ai đó đổi item key trong items.ts mà quên update achievements.ts → test sẽ fail trước CI merge). Test-only, no runtime change.

### Player-facing impact (post-merge)

- **Auto-unlock title milestone sau breakthrough thành công** (PR #280): khi nhân vật đột phá thành công lên realm mới có milestone title (vd luyenkhi 9/9 → truc_co 1 → unlock `realm_truc_co_pillar` "Trúc Cơ Trụ Đạo"). 9/28 realm có title trong catalog (luyenkhi/truc_co/kim_dan/nguyen_anh/hoa_than/do_kiep/thien_tien/thanh_nhan/hu_khong_chi_ton). UI surfacing chưa có scope (Phase 11.9.D defer).

- **Auto-unlock title milestone sau vượt kiếp thành công** (PR #281): khi nhân vật vượt kiếp thành công lên realm cao hơn có milestone title (vd kim_dan 9/9 → nguyen_anh 1 → unlock `realm_nguyen_anh_master` "Nguyên Anh Đại Sư"). Atomic-trong-tx: nếu kiếp success nhưng DB lỗi unlock title (không phải catalog drift), rollback toàn bộ — KHÔNG bao giờ realm advance mà thiếu title.

- **Zero observable change cho realm transition không có title** (PR #280, #281): hoa_than → luyen_hu, luyen_hu → hop_the, hop_the → dai_thua, do_kiep → nhan_tien (4/7 tribulation transitions) không có milestone title trong catalog → wire skip, KHÔNG insert row. Future catalog mở rộng có thể bù.

### Risk / rollback

- 🟢 **PR #279**: zero runtime impact (test-only). Nếu fail trong tương lai, fix catalog references rồi commit lại.
- 🟢 **PR #280**: low — fail-soft try/catch quanh `unlockTitle`. Backward-compat test confirm `chars` không inject titles vẫn breakthrough bình thường. Idempotent qua composite UNIQUE.
- 🟢 **PR #281**: low — atomic guarantee qua tx, idempotent qua composite UNIQUE. Backward-compat test confirm. Tribulation high-tier transitions có 2/7 với title (kim_dan→nguyen_anh, nguyen_anh→hoa_than, dai_thua→do_kiep) → wire chỉ active 3 path; còn 4/7 transition không có title → skip silently.

### Tests / CI

- **PR #279**: 956 shared vitest (954 baseline + 2 invariant). CI 5/5 GREEN.
- **PR #280**: 1445 api vitest (1441 baseline + 4 breakthrough title test). CI 5/5 GREEN.
- **PR #281**: 1450 api vitest (1445 baseline + 5 tribulation title test). CI 5/5 GREEN.
- Total monorepo baseline post-PR-#281: **2994 vitest** = shared 956 + api 1450 + web 588.

---

## [session 9r-27 part 5 — Achievement item rewards wire + docs catch-up — PR #276 → #277, merged 2/5 2026]

### Internal — Phase 11.10.D Achievement item rewards (no catalog change)

**Compose-and-fail-soft pattern** mở rộng cho `AchievementService.claimReward` — wire grant `def.reward.items` non-empty qua `InventoryService.grantTx` reason `'ACHIEVEMENT_REWARD'` (`ItemLedger` audit). Phase 11.10.C-1 (PR #248) đã defer items với `throw AchievementError('ITEMS_NOT_SUPPORTED')` để tránh circular dep `CharacterModule ↔ InventoryModule` (InventoryModule imports CharacterModule cho `CharacterService`/`CurrencyService`). Phase 11.10.D giải quyết bằng `forwardRef` chuẩn NestJS pattern:

- **Achievement item rewards via InventoryService.grantTx** (PR #277 / Phase 11.10.D): `apps/api/src/modules/inventory/inventory.service.ts` — add `'ACHIEVEMENT_REWARD'` vào `ItemLedgerReason` union (parallel với `CurrencyLedger.reason='ACHIEVEMENT_REWARD'` đã wire ở Phase 11.10.C-1). `apps/api/src/modules/character/achievement.service.ts` — import `forwardRef`, `Inject`, `InventoryService`. Constructor add 4th param `@Inject(forwardRef(() => InventoryService)) inventory: InventoryService`. `claimReward`: remove `throw AchievementError('ITEMS_NOT_SUPPORTED')` defensive guard. Inside transaction sau title unlock: nếu `def.reward.items` non-empty → `await this.inventory.grantTx(tx, characterId, [{itemKey, qty}…], { reason: 'ACHIEVEMENT_REWARD', refType: 'Achievement', refId: achievementKey })`. Update return type `granted.items: Array<{ itemKey: string; qty: number }>`. Remove `'ITEMS_NOT_SUPPORTED'` khỏi `AchievementErrorCode` union. `apps/api/src/modules/character/character.module.ts` — wrap `InventoryModule` import với `forwardRef`. `apps/api/src/modules/inventory/inventory.module.ts` — wrap `CharacterModule` import với `forwardRef` để break circular cycle. `apps/api/src/modules/character/character.controller.ts` — remove `case 'ITEMS_NOT_SUPPORTED'` từ `mapAchievementErrorStatus`. Identity hiện tại: 32 baseline catalog không có achievement với `def.reward.items` non-empty (chỉ linhThach/tienNgoc/exp/title) → runtime path identity → no-op. Future-proof khi catalog thêm. 3 vitest mới với `vi.spyOn(shared, 'getAchievementDef').mockReturnValue` fake def reward.items → grant InventoryItem + ItemLedger entry; identity path empty items; double-claim prevention CAS guard.

### Docs — audit/catch-up

- **CHANGELOG catch-up session 9r-27 PR #272 → #275** (PR #276): append section [session 9r-27 — combat passive wire batch + docs catch-up — PR #272 → #275] mô tả 4 PR (Phase 11.X.U talent spiritMul, Phase 11.X.V buff invuln, CHANGELOG catch-up 9r-26 part 5, audit refresh post #271). Pure docs, no code change. CI 5/5 GREEN.

### Player-facing impact (post-merge)

- **Zero observable gameplay change** (PR #277): identity hiện tại — 32 baseline catalog không có achievement với `reward.items` non-empty. Player với current achievement progress không thấy khác biệt.
- **Future-proof catalog mở rộng** (PR #277): khi Phase 11.10.F catalog thêm achievement với `reward.items` (vd milestone collection achievements grant đan dược/material), claim sẽ grant items qua `InventoryItem` upsert + `ItemLedger` audit, idempotent qua CAS `claimedAt: null` guard.
- **Closer wire parity** (PR #277): `AchievementService.claimReward` giờ wire toàn bộ reward channels — `linhThach`/`tienNgoc` (CurrencyService), `exp` (PrismaService), `title` (TitleService), `items` (InventoryService). Tất cả 4 reward types unified pattern: ledger entry với `reason='ACHIEVEMENT_REWARD'`, `refType='Achievement'`, `refId=achievementKey` cho audit/idempotency.

### Risk / rollback

- 🟢 zero balance impact — identity path (no current catalog producer with items).
- Backward-compat 100% với existing claims (linhThach/tienNgoc/exp/title vẫn hoạt động). Module DI restructure dùng `forwardRef` chuẩn NestJS — không phá runtime DI graph (verified qua full api test 1441 ✓).
- API contract change: `'ITEMS_NOT_SUPPORTED'` (HTTP 501) error code removed — không ai reachable trong production vì current catalog không trigger.
- Rollback: revert PR (8 file change). Module DI revert về `CharacterModule` không import `InventoryModule` + `AchievementService` 3-arg constructor + throw `ITEMS_NOT_SUPPORTED`. Không cần DB migration revert (DB schema không đổi).

### CI status

- PR #276: 5/5 GREEN ✓
- PR #277: 5/5 GREEN ✓ (+3 new vitest tổng 2983)

---

## [session 9r-27 — combat passive wire batch + docs catch-up — PR #272 → #275, merged 2/5 2026]

### Internal — Phase 11 combat passive wires (no catalog change)

**Compose-and-fail-soft pattern** tiếp tục cho monster reply branch. 2 PR runtime wire mới fix gap pattern coverage:

- **Talent spiritMul wire vào CombatService.action() effSpirit defense calc** (PR #274 / Phase 11.X.U): wire `talentMods.spiritMul × effSpirit` ở monster reply branch (`combat.service.ts:386-390`). `composePassiveTalentMods` đã produce `spiritMul` (kind=stat_mod, statTarget=spirit) trong package shared, nhưng catalog hiện tại không có talent với `statTarget=spirit` (talent_kim_thien_co=atk, talent_thuy_long_an=hpMax, talent_tho_son_tuong=def, talent_moc_linh_quy=regen, talent_hoa_tam_dao=damage_bonus, talent_thien_di=drop, talent_ngo_dao=exp). Identity 1.0 → zero balance impact. Wire để pattern coverage nhất quán với `atkMul/defMul/damageBonusByElement/dropMul/expMul` đã wire (#251) + future-proof cho talent spirit producer (vd `talent_huyen_thuy_tam` future +50% spirit). 3 vitest mới với `vi.spyOn(TalentService.prototype, 'getMods')` để cover wire path. `combat.service.ts` + `combat.service.test.ts` + `AI_HANDOFF_REPORT.md`.
- **Buff invuln wire vào CombatService.action() override damage** (PR #275 / Phase 11.X.V): wire `buffMods.invulnActive` (kind=invuln) PRE-shield gate trong reply branch (`combat.service.ts:404-438`) + DOT branch (line 449). Spec `invuln`: ignore all damage (rất hiếm — ngắn duration), nên wire skip cả monster reply (PRE-shield) lẫn DOT (end-of-turn). `composeBuffMods` đã produce `invulnActive` trong package shared, nhưng catalog hiện tại không có buff với `kind=invuln` (talent_shield_phong=shield, debuff_burn_hoa=dot, debuff_root_thuy=control, debuff_taoma=cultivation_block). Identity false → zero balance impact. Pattern coverage nhất quán với cultivationBlocked (#270) + control (#264) — boolean buff state gates damage path. Future-proof cho buff invuln producer trong catalog tương lai (vd `buff_kim_than_shield` ngắn duration). 4 vitest mới với `vi.spyOn(BuffService.prototype, 'getMods')` invulnActive=true cover reply nullified + DOT cũng skip + identity baselines. `combat.service.ts` + `combat.service.test.ts` + `AI_HANDOFF_REPORT.md`.

### Docs — audit/catch-up

- **CHANGELOG catch-up session 9r-26 part 5** (PR #272): append section cho PR #267 (Phase 11.7.E talent regen) + #268 (Phase 11.X.Q boss control) + #270 (Phase 11.X.R boss cultivationBlocked) + #271 (Phase 11.4.E boss equip atk). Pure docs, no code change. CI 4/4 GREEN.
- **AI_HANDOFF_REPORT refresh post PR #271 merged + PR #272 open** (PR #273): bump main pointer `df52a1d` → audit refresh; promote PR #271 → "Latest merged PR", demote PR #270 → "Previous merged PR"; update Open PRs line; add session 9r-27 snapshot. Pure docs, no code change. CI 4/4 GREEN.

### Player-facing impact (post-merge)

- **Zero observable gameplay change** (PR #274, #275): cả hai wire đều identity hiện tại (catalog không có producer cho `talent.spiritMul` hoặc `buff.invulnActive`). Player với current builds không thấy khác biệt. Future-proof cho catalog mở rộng — khi thêm talent spirit producer hoặc buff invuln, runtime sẽ activate đúng pattern.
- **Closer pattern parity** (PR #274, #275): combat reply branch giờ wire toàn bộ talent/buff/title stat multipliers (atk/def/spirit/damageElement) + boolean gates (control/cultivationBlocked/invuln). Phù hợp với combat compose-and-fail-soft design — tất cả passive mods compute-but-not-consumed gap đã đóng cho `CombatService.action()` reply path.

### Risk / rollback

- 🟢 zero balance impact — identity multipliers/booleans (no current catalog producer).
- Backward-compat 100% với character không có talent/buff matching wire / TalentService/BuffService không inject (compose-and-fail-soft).
- Rollback: revert PR scope (combat.service.ts + test). Wire chỉ thêm 1-2 multiply factor hoặc 1 boolean guard — không có data migration.

### CI status

- PR #272: 4/4 GREEN ✓
- PR #273: 4/4 GREEN ✓
- PR #274: 5/5 GREEN ✓
- PR #275: 5/5 GREEN ✓

---

## [session 9r-26 part 5 — boss wire batch — PR #267 → #271, merged 2/5 2026]

### Internal — Phase 11 boss/cultivation passive wires (no catalog change)

**Compose-and-fail-soft pattern** tiếp tục. 4 PR runtime wire mới fix gap real:

- **Talent hp/mpRegenFlat wire vào CultivationProcessor** (PR #267 / Phase 11.7.E): `talentMods.hpRegenFlat` / `mpRegenFlat` cộng additively với `buffMods.hpRegenFlat` / `mpRegenFlat` ở cultivation tick regen branch. Catalog `talent_moc_linh_quy` (Mộc Linh Quy passive 5 HP regen mỗi tick) trước đó compute trong `composePassiveTalentMods` nhưng KHÔNG consume runtime — `cultivation.processor.ts` chỉ wire `buffMods.hpRegenFlat`, talent regen de facto no-op. Refactor `talentMods` fetch ONCE per character per tick, share giữa expMul (Phase 11.7.D) và regen (Phase 11.7.E). 5 vitest mới: lone talent (5/sec × 30s = 150 HP), talent + buff additive (10/sec × 30s = 300 HP), no-talent identity, no-service identity, debuff_taoma block. `cultivation.processor.ts` + `cultivation.processor.test.ts` + `AI_HANDOFF_REPORT.md`.
- **Buff control wire vào BossService.attack()** (PR #268 / Phase 11.X.Q): parallel to Phase 11.X.O combat wire (PR #264). `buffMods.controlTurnsMax > 0` → throw `BossError('CONTROLLED')` BEFORE state mutation (cooldown set, mp/stamina/hp deduct, ledger). Catalog producer giống combat: `debuff_root_thuy` (3t), `debuff_stun_tho` (1t), `debuff_silence_kim` (2t). Inject `@Optional() buffs?: BuffService` vào BossService DI. Map `CONTROLLED` → HTTP 409 CONFLICT trong `BossController.handleErr`. 5 vitest mới: stun + state-unchanged, root, silence, no-debuff identity, no-service identity. `boss.service.ts` + `boss.controller.ts` + `boss.service.test.ts`.
- **Buff cultivationBlocked wire vào BossService.attack()** (PR #270 / Phase 11.X.R; PR #269 v1 auto-closed do chained base deleted khi PR #268 merge → recreated): `buffMods.cultivationBlocked` (Tâm Ma `debuff_taoma`) → throw `BossError('CULTIVATION_BLOCKED')` BEFORE state mutation. Tâm Ma'd char đã bị block tu luyện EXP (Phase 11.8.D wire ở `CultivationProcessor`) giờ cũng bị block boss attack — semantically nhất quán. Cùng lần `getMods` với Phase 11.X.Q control check (consolidate single buff fetch). Map `CULTIVATION_BLOCKED` → HTTP 409. 3 vitest mới: taoma throw + state unchanged, no debuff identity, no service identity. `boss.service.ts` + `boss.controller.ts` + `boss.service.test.ts`.
- **Equipment atk/spirit bonus wire vào BossService.attack()** (PR #271 / Phase 11.4.E): wire `inventory.equipBonus().atk` cộng vào `charAtk` + `equipBonus().spiritBonus` cộng vào `char.spirit` cho atkScale > 1 skill. Trước đây boss attack chỉ dùng `char.power`/`char.spirit` raw, hoàn toàn bỏ qua equip bonus (atk + sockets từ Phase 11.4.B + refine từ Phase 11.5.B). Player full equip có DPS boss thấp hơn nhiều so với combat (combat đã wire `equipBonus` + `statMul` + `talentMods` + `buffMods` + `titleMods` + element). Subset của Phase 11.X.S full stat wire — chỉ wire equip (low-risk balance), KHÔNG wire talent/buff/title atkMul (defer). 3 vitest mới với `vi.spyOn(Math, 'random').mockReturnValue(0.5)` deterministic: so_kiem +5 atk → damage cao hơn baseline, no-equip identity, huyen_kiem +12 atk +2 spirit. `boss.service.ts` + `boss.service.test.ts`.

### Player-facing impact (post-merge)

- **Tu luyện talent regen thực sự cộng HP/MP** (PR #267): player với `talent_moc_linh_quy` (Mộc Linh Quy) học được trong sect-tree giờ ăn 5 HP regen mỗi tick cultivation (~150 HP / 30s). Trước đó học talent này không có hiệu quả runtime nào. Stack additive với buff regen (potion / formation).
- **Player bị control debuff không thể tấn công boss** (PR #268). Trước đó `debuff_root_thuy` / `debuff_stun_tho` / `debuff_silence_kim` chỉ block combat (Phase 11.X.O), boss vẫn cho phép → semantically inconsistent. Giờ throw `BossError('CONTROLLED')` HTTP 409, frontend hiển thị "Đang bị khống chế, không thể tấn công boss". State (cooldown / mp / stamina / hp) KHÔNG mutate khi throw.
- **Player Tâm Ma không thể tấn công boss** (PR #270). Trước đó `debuff_taoma` chỉ block tu luyện EXP (Phase 11.8.D), boss vẫn cho phép. Giờ throw `BossError('CULTIVATION_BLOCKED')` HTTP 409. Semantically Tâm Ma'd char không tập trung được nên không tu luyện ↔ không boss-attack.
- **Player full bộ equip có DPS boss tăng** (PR #271). Trước đó equip atk/spiritBonus + sockets + refine hoàn toàn bị bỏ qua trong boss damage formula — player không equip và player full equip có DPS boss bằng nhau, FIX gap real. Giờ equip atk cộng vào `charAtk`, equip spiritBonus cộng vào `char.spirit` cho skill atkScale > 1.

### Tests baseline progression

- Pre-PR-#267: API 1415 vitest (post-PR-#266).
- Post-PR-#267: API 1420 vitest (+5 talent regen wire tests).
- Post-PR-#268: API 1425 vitest (+5 boss control wire tests).
- Post-PR-#270: API 1428 vitest (+3 boss cultivationBlocked wire tests).
- Post-PR-#271: API 1431 vitest (+3 boss equip atk wire tests).
- Total full suite post-PR-#271: API 1431 + shared 954 + web 588 = **2973 vitest**.

### Risks / migrations

- **None breaking schema/catalog**: pure consume wire, no schema/migration/catalog changes.
- PR #268/#270 wire throws BEFORE state mutation → cooldown / character / ledger an toàn.
- PR #271 balance impact: boss DPS tăng cho player có equip — đúng với expectation, fix gap thật. Damage tăng tỷ lệ với equip bonus existing trong DB (player chưa có equip không đổi).
- PR #267 talent regen catalog hiện chỉ có 1 producer (`talent_moc_linh_quy` 5 HP/tick) → balance impact low, có thể nerf catalog `value` nếu cần.

---

## [session 9r-26 wire batch — PR #263 → #265, merged 2/5 2026]

### Internal — Phase 11 buff consume runtime wire (no catalog/balance change)

**Compose-and-fail-soft pattern** continued. 3 PR mới: 1 docs/audit + 2 buff runtime wire (control + shield) — fix gap nhận diện sau session 9r-25: control debuff (root/stun/silence) và shield buff (`talent_shield_phong`) đều compute mods nhưng KHÔNG consume runtime → de facto no-op trước PR này.

- **Docs audit refresh post-PR-#262** (PR #263): pure docs/audit refresh sau khi PR #262 (Phase 11.X.M DOT) merged. Bump main pointer `ec29c2f` → `a70c733`, mark PR #262 MERGED, list 3 next-task candidates pre-analyzed (Phase 11.X.K hpMaxMul / 11.X.N shield / 11.X.O control). `docs/AI_HANDOFF_REPORT.md`.
- **Buff control wire vào CombatService.action()** (PR #264 / Phase 11.X.O): `buffMods.controlTurnsMax > 0` → throw `CombatError('CONTROLLED')` ngay sau khi compose buffMods, TRƯỚC mọi state mutation (encounter status / character HP/MP/stamina / ledger không đụng tới khi throw). Catalog `debuff_root_thuy` (3 turns), `debuff_stun_tho` (1 turn), `debuff_silence_kim` (2 turns). 5 vitest mới: stun throw, root throw, DOT no-throw (kind != control), no buff identity, BuffService not injected identity. `combat.service.ts` + `combat.service.test.ts` + `AI_HANDOFF_REPORT.md`.
- **Buff shield wire vào CombatService.action()** (PR #265 / Phase 11.X.N): `buffMods.shieldHpMaxRatio` damage absorb monster reply trước khi `charHp -= reply`. Per-turn refresh aura model: `shieldAbsorb = floor(char.hpMax × shieldHpMaxRatio)` recompute mỗi turn buff active. Catalog `talent_shield_phong` (kind=shield value=0.3 hpMax, source=talent, durationSec=10). 5 vitest mới: full absorb, shield > reply, no-shield identity, no-service identity, shield + DOT isolation. `combat.service.ts` + `combat.service.test.ts` + `AI_HANDOFF_REPORT.md`.

### Player-facing impact (post-merge)

- **Control debuffs (root/stun/silence) thực sự block player action** (PR #264). Trước đó character bị `debuff_stun_tho` etc trong DB nhưng vẫn act bình thường trong combat. Giờ nhận `CombatError('CONTROLLED')` → frontend hiển thị "Đang bị khống chế, không thể hành động" → player phải chờ debuff hết hạn. Encounter / HP / MP / stamina / ledger an toàn (throw EARLY, không mutate state).
- **Shield buff (`talent_shield_phong` Phong Hộ Thuẫn) thực sự hấp thu damage** (PR #265). Trước đó player ăn full damage dù có "khiên" trong DB. Giờ shield absorb monster reply theo per-turn refresh model: 30% × hpMax mỗi turn buff active (~3 turns trong 10s duration). Combat log show "Khiên hấp thu N sát thương." Shield + DOT: shield không chống độc/bỏng (semantic kim bất khả phá độc).

### Tests baseline progression

- Pre-PR-#263: API 1405 vitest (post-PR-#262).
- Post-PR-#263: API 1405 vitest (docs-only).
- Post-PR-#264: API 1410 vitest (+5 control wire tests).
- Post-PR-#265: API 1415 vitest (+5 shield wire tests).
- Total full suite post-PR-#265: API 1415 + shared 954 + web 588 = **2957 vitest**.

### Risks / migrations

- **None breaking**: pure consume wire, no catalog/schema/migration changes.
- Control wire throws BEFORE state mutation → encounter / character / ledger an toàn.
- Shield per-turn refresh model = generous (90% over 10s duration with current catalog 30% × ~3 turns), nhưng catalog hiện chỉ có 1 producer (`talent_shield_phong`) → không break balance. Có thể nerf catalog `value` nếu cần điều chỉnh.

---

## [session 9r-25 part 3 wire batch — PR #261 → #262, merged 2/5 2026]

### Internal — Phase 11 buff consume runtime wire (no catalog/balance change)

**Compose-and-fail-soft pattern** continued from session 9r-25 part 2. 2 PR mới: 1 docs/audit + 1 buff runtime wire (DOT) — fix gap DOT debuff (`debuff_burn_hoa` / `debuff_poison_moc`) đã compute `dotPerTickFlat` nhưng KHÔNG consume runtime → de facto no-op trước PR này.

- **Docs audit refresh session 9r-25 part 2 close-out** (PR #261): pure docs/audit refresh sau khi PR #258/#259 merged. Bump main pointer `b47686f` → `7244e6f`, finalize session 9r-25 part 2 audit. `docs/AI_HANDOFF_REPORT.md`.
- **Buff DOT wire vào CombatService.action()** (PR #262 / Phase 11.X.M): `buffMods.dotPerTickFlat` (đã tính theo stack ở composeBuffMods: `value × stacks`) cộng damage cuối lượt cho encounter còn ACTIVE (đã không WON/LOST). Catalog `debuff_burn_hoa` (8 dmg × stack, hoa skill, maxStacks=3) + `debuff_poison_moc` (6 dmg × stack, moc skill, maxStacks=3). End-of-turn semantics (không phải start-of-turn) — combat turn-based, DOT ticks "cuối lượt" tương đương "đầu lượt tiếp theo". Nếu charHp ≤ 0 sau DOT → status LOST + clamp HP=1 (giống monster reply LOST handling). 5 vitest mới: 1 stack 8 dmg, 2 stack 16 dmg, dot kill (LOST + clamp), no debuff identity, no service inject identity. `combat.service.ts` + `combat.service.test.ts`.

### Player-facing impact (post-merge)

- **DOT debuffs (Hoả/Độc) thực sự apply runtime damage** (PR #262). Trước đó character bị `debuff_burn_hoa` 1 stack hay 3 stack đều ăn 0 DOT damage. Giờ end-of-turn trừ HP theo `value × stacks`. Combat log show "Độc/bỏng phát tác — chịu N sát thương DOT." Nếu DOT đủ kill → "hôn mê do độc/bỏng — chiến đấu thất bại."

### Tests baseline progression

- Pre-PR-#261: API 1400 vitest (post 9r-25 part 2).
- Post-PR-#261: API 1400 vitest (docs-only).
- Post-PR-#262: API 1405 vitest (+5 DOT wire tests).
- Total full suite post-PR-#262: API 1405 + shared 954 + web 588 = **2947 vitest**.

### Risks / migrations

- **None breaking**: pure consume wire, no catalog/schema/migration changes.
- DOT ticks AFTER monster reply branch — không double-apply trong cùng turn.
- DOT respect encounter status: WON / LOST không apply (cuộc chiến đã kết thúc).

---

## [session 9r-25 part 2 wire batch — PR #258 → #259, merged 2/5 2026]

### Internal — Phase 11 passive consume runtime wire (no catalog/balance change)

**Compose-and-fail-soft pattern** continued from session 9r-25 part 1 (PR #251–#256). 2 PR mới wire 2 gap còn lại nhận diện trong session: equip.spiritBonus runtime consume + talents.dropMul boss reward.

- **Equip spiritBonus wire vào CombatService.action()** (PR #258 / Phase 11.4.D): `inventory.equipBonus.spiritBonus` (item base spirit + gem spirit socket bonus + refine multiplier — đã compute Phase 11.4.B/11.5.B) cộng additive vào `effSpirit` defense calc trong combat reply branch. Trước đó equip.spiritBonus chỉ được compute nhưng KHÔNG consume runtime — gem moc/thuy/tho spirit bonus de facto no-op cho monster reply defense. Pattern same as atk wire `(base + flat) × multipliers`. 2 vitest. `combat.service.ts` + `combat.service.test.ts`.
- **Talent dropMul wire vào BossService reward distribution** (PR #259 / Phase 11.X.G): `talents.getMods().dropMul` × linhThach reward trong `distributeRewards`. Catalog `talent_thien_di` (passive `drop_bonus` +20%) v.v. trước đó CHỈ wire vào CombatService monster drop (PR #251). Boss world reward distribution không có wire — `talent_thien_di` de facto no-op cho boss reward. Apply BEFORE `currency.applyTx` ledger write, BigInt × float Number floor (range safe ~10M within 2^53). CurrencyLedger reflects boosted delta — single source of truth audit. 3 vitest. `boss.service.ts` + `boss.service.test.ts`.

### Player-facing impact (post-merge)

- **Gem spirit bonus runtime applies cho combat reply defense** (PR #258). Trước đó gem mộc/thuỷ/thổ spirit bonus chỉ display ở character profile, không ảnh hưởng combat damage taken.
- **Talent Thiên Di "+20% drop rate" giờ apply cho world boss reward** (PR #259). Trước đó chỉ apply monster combat drop. Top1 share 50% × 1.2 = 60%, top2-3 15% × 1.2 = 18%, top4-10 2% × 1.2 = 2.4%. CurrencyLedger reflects actual granted (not base) for audit accuracy.

### Tests baseline progression

- Pre-PR-#258: API 1395 vitest (post 9r-25 part 1).
- Post-PR-#258: API 1397 vitest (+2 spirit bonus tests).
- Post-PR-#259: API 1398 vitest. Boss test file `boss.service.test.ts` 19/19 (16 baseline + 3 new dropMul cases).
- Total full suite post-PR-#259: API 1398 + shared 954 + web 588 = **2940 vitest**.

### Risks / migrations

- **None breaking**: pure consume wire, no catalog/schema/migration changes.
- BOSS_REWARD ledger.delta now reflects boosted amount — audit-accurate. Existing pre-wire ledger rows preserved (immutable history).

---

## [session 9r-25 wire batch — PR #251 → #256, merged 1/5–2/5 2026]

### Internal — Phase 11 passive systems runtime wire (no catalog/balance change)

**Compose-and-fail-soft pattern**: mỗi PR inject `@Optional()` service vào consumer (CombatService / CultivationProcessor), gọi `service.getMods()` returning multiplier object, compose multiplicatively với identity fallback (`1.0` nếu service không inject hoặc character chưa có resource active). Đặc điểm chung: pure logic + vitest cover bonus path + identity baseline + DI fallback. **Không** đổi catalog (buff/talent/title), **không** đổi schema/migration, **không** đổi ledger semantic.

- **Talent passive wire vào CombatService** (PR #251 / Phase 11.7.C): `talents.getMods()` × CombatService.action() — atkMul × effPower, defMul × effDef, damageBonusByElement × dmg, expMul × monster expDrop, dropMul × linhThachDrop. 4 vitest. `apps/api/src/modules/combat/combat.service.ts` + `combat.service.test.ts`.
- **Buff passive wire vào CombatService** (PR #252 / Phase 11.8.C): `buffs.getMods()` × CombatService.action() — atkMul × effPower, defMul × effDef, spiritMul × spirit defense, damageBonusByElement × dmg, damageReductionByElement × incoming reply. 5 vitest. `combat.service.ts` + `combat.service.test.ts`.
- **Title flavor wire vào CombatService** (PR #253 / Phase 11.9.C): `titles.getMods()` × CombatService.action() — atkMul × effPower, defMul × effDef, spiritMul × spirit defense. 5 vitest. `combat.service.ts` + `combat.service.test.ts`.
- **Talent expMul wire vào CultivationProcessor** (PR #254 / Phase 11.7.D): `talents.getMods().expMul` × cultivation tick gain. Catalog `talent_ngo_dao` "+15% EXP tu vi mỗi lần tu luyện" giờ thực sự apply cho cả cultivation EXP, không chỉ monster EXP drop. Compose multiplicatively với cultivationMul (Linh căn) × methodMul (Công pháp): `gain = max(1, round(baseGain × cultivationMul × methodMul × talentExpMul))`. 4 vitest. `cultivation.processor.ts` + `cultivation.processor.test.ts`.
- **Buff cultivationBlocked (Tâm Ma) wire vào CultivationProcessor** (PR #255 / Phase 11.8.D): `buffs.getMods().cultivationBlocked` flag check ở đầu loop iter — character có debuff `debuff_taoma` (Tâm Ma Triền Thân, 1h duration sau khi vượt kiếp FAIL) → tick skip toàn bộ EXP gain + mission/achievement track + realtime emit. Stamina regen ở top vẫn áp dụng. 4 vitest. `cultivation.processor.ts` + `cultivation.processor.test.ts`.
- **Buff hp/mpRegenFlat wire vào CultivationProcessor** (PR #256 / Phase 11.8.E): `buffs.getMods().hpRegenFlat` / `mpRegenFlat` (per-second values) × tickSeconds (30s) → raw SQL `LEAST("hpMax", hp + delta)` cap update. Catalog `pill_hp_regen_t1` (5 HP/s) + `sect_aura_thuy` (4 MP/s) etc giờ thực sự hồi HP/MP per cultivation tick. Refactor: buffMods fetch ONCE per character per tick (reuse cho cultivationBlocked check + regen). 6 vitest covering cap clamp + Tâm Ma priority + DI fallback. `cultivation.processor.ts` + `cultivation.processor.test.ts`.

### Player-facing impact (post-merge)

- **Tâm Ma debuff giờ thực sự block tu luyện** runtime (PR #255). Trước đó là design intent only.
- **Talent Ngộ Đạo +15% EXP tu vi giờ áp dụng cho cultivation tick** (PR #254). Trước đó chỉ áp dụng monster EXP drop (PR #251).
- **Sect aura Thuỷ (sect_aura_thuy) "+4 MP/s trong tu luyện" giờ thực sự hồi MP** mỗi tick (PR #256). Trước đó chỉ là metadata.
- **Pill hồi HP/MP buffs giờ áp dụng trong cultivation context** (PR #256). Combat HP/MP regen chưa wire (defer).

### Tests baseline progression

- Post-PR-#250 (session 9r-22 base): API 1376 vitest.
- Post-PR-#256: API 1395 vitest (+19 across 6 PRs). Shared 954 vitest (no change). Web 588 vitest (no change). **Total 2937 vitest**.
- All CI 5/5 GREEN at merge time (PR #254 had typecheck regression caught by CI on first push, fixed in same PR commit `62a269f`).

---

## [session 9p — PR #190 → #192, merged 30/4 18:13→18:58 UTC]

### Internal — API pure-unit test coverage push (no runtime change)

- **HealthController.readyz failure paths** (PR #190): +10 vitest (mocked PrismaService.$queryRaw + Redis.ping). Lock-in 503 envelope shape khi DB hoặc Redis fail / Redis trả non-PONG; happy path không gọi `res.status`; error stringify fallback (Error vs non-Error); `version` env override + default. `apps/api/src/modules/health/health.controller.unit.test.ts`. API baseline 619 → 629.
- **admin/ledger-audit `auditResultToJson` JSON serializer** (PR #191): +12 vitest pure-unit cho serializer dùng bởi admin endpoint `GET /admin/economy/audit-ledger`. Lock-in BigInt→string preserve precision khi vượt `Number.MAX_SAFE_INTEGER` (chính lý do tồn tại serializer); negative diff giữ dấu; zero giữ "0"; inventoryDiscrepancies (number) passthrough; JSON.stringify roundtrip safety; no input mutation. `apps/api/src/modules/admin/ledger-audit-json.test.ts`. API baseline 629 → 641.
- **Scheduler ghost-cleanup invariant** (PR #192): +12 vitest pure-unit cho `OpsService.scheduleRecurring` + `MissionScheduler.onModuleInit` (mocked BullMQ Queue). Lock-in: trước add lại job repeatable, MỌI job tên match cũ phải bị `removeRepeatableByKey` (tránh ghost duplication khi hot-reload / interval change); non-match name không xoá nhầm; `add()` 1 lần với `repeat.every` từ constant + `removeOnComplete/removeOnFail` cap 10; constant interval lock (`OPS_PRUNE_INTERVAL_MS === 24h`, `MISSION_RESET_INTERVAL_MS === 10min`). `apps/api/src/modules/ops/ops.service.test.ts` + `apps/api/src/modules/mission/mission.scheduler.test.ts`. API baseline 641 → 653.

### Docs

- **AI_HANDOFF_REPORT** liên tục bumped sau mỗi PR (snapshot, Recent Changes, §21 Session 9p table).

---

## [session 9o — PR #184 → #189, merged 30/4 17:30→17:52 UTC]

### Internal — API service WS / queue test coverage push

- **chat.service WS + history** (PR #186): +11 vitest cho `ChatService` — emit events, room join/leave, history pagination, anti-spam moderation paths. `apps/api/src/modules/chat/chat.service.ws-history.test.ts`. API baseline 597 → 608.
- **mission.processor reset** (PR #187): +8 vitest cho `MissionResetProcessor` — DAILY/WEEKLY window reset, idempotent, không throw khi reset rỗng. `apps/api/src/modules/mission/mission.processor.test.ts`. API baseline 608 → 616.
- **cultivation processor + service** (PR #188): +14 vitest cho `CultivationProcessor` (tick/breakthrough job paths) + `CultivationService` (start/stop/snapshot). Lock-in EXP accumulation, breakthroughReady invariant, ledger atomicity. API baseline 616 → 619.

### Docs

- **Audit refresh session 9o kickoff + progress** (PR #184 / #189): bump snapshot + close-out cascade.

---

## [session 9n+ tail — PR #172 → #179, merged 30/4 13:15→17:00 UTC]

### Added — Tests-only PRs (lock-in coverage, no runtime change)

- **shared catalogs** (PR #173 +40 / #174 +18 / #175 +shared core types): combat formulas, mission templates, item/realm catalog Zod schemas. Shared baseline 96 → 220 vitest.
- **mail WS prune** (PR #176): MailService prune-on-claim invariant.
- **realtime.service** (PR #177): WS service emit + room mapping unit tests.
- **AllExceptionsFilter** (PR #178): error envelope shape lock-in (HTTP code + i18n message key + stack masking).
- **ws/client (web) `resolveWsOrigin`** (PR #179): +15 vitest pure-unit. Web baseline 532 → 547.

### Docs

- **CHANGELOG session 9n catch-up** (PR #172): backfill session 9n entries.

---

## [session 9n — PR #165 → #171, merged 30/4 12:13→13:15 UTC]

### Added

- **Smart audit-ledger CLI** mở rộng `--json` flag (PR #166): `pnpm --filter @xuantoi/api audit:ledger -- --json` cho cron / pipeline parse machine-readable. +13 vitest unit (parseArgs 4 + formatResult 5 + formatResultJson 4) cho pure logic. Doc ở `ADMIN_GUIDE §11`.
- **Smart admin economy alerts thresholds env-tunable** (PR #167): `ECONOMY_ALERTS_DEFAULT_STALE_HOURS` / `_MIN_STALE_HOURS` / `_MAX_STALE_HOURS` env override (mặc định 24h, range 1h..720h). Endpoint `GET /admin/economy/alerts` + UI `apps/web/src/api/admin.ts` adminEconomyAlerts(staleHours?). +22 vitest. Doc `ADMIN_GUIDE §11.3` + `apps/api/.env.example`.
- **Smart economy-alerts CLI** parallel với `audit:ledger` (PR #169): `pnpm --filter @xuantoi/api alerts:economy` + `--json` flag + `--stale-hours=N` flag (override 24h default). Read-only, exit 0/1/2. Extract pure `queryEconomyAlerts()` từ AdminService cho reusability. +18 vitest unit. Doc `ADMIN_GUIDE §11.3`.

### Fixed

- **i18n parity — toast titles** (PR #170): `apps/web/src/stores/toast.ts` Pinia store trước hard-code VN titles (`'Tin tức' / 'Cảnh báo' / 'Lỗi' / 'Thành công' / 'Thiên Đạo Sứ Giả'`) → giờ dùng `i18n.global.t('toast.title.<type>')` (key đã có sẵn ở `vi.json` + `en.json`). User switch sang en thì toast title cũng dịch. +4 vitest cho locale switch (vi/en).
- **i18n parity — api fallback errors** (PR #171): `apps/web/src/api/{auth,shop,character}.ts` trước hard-code VN `new Error('Đăng ký thất bại' / 'Đăng nhập thất bại' / ...)` fallback (9 chỗ) khi BE envelope thiếu `data.error` → giờ dùng helper `fallbackError(op)` wrap `i18n.global.t('common.apiFallback.<op>')`. Added i18n keys `common.apiFallback.{register,login,changePassword,forgotPassword,resetPassword,logoutAll,shopLoad,shopBuy,onboard}` ở vi.json + en.json. +19 vitest cho cả 2 locale + BE error precedence. Web vitest baseline 513 → 532.

### Docs

- **Audit refresh session 9n kickoff** (PR #165): bump snapshot `f103485 → d332a18` post session 9m close-out (PR #160..#164 merged).
- **TROUBLESHOOTING runbook** (PR #168): §15 ledger drift (audit-ledger CLI exit code 1 → diagnose currency vs character balance, item ledger vs InventoryItem.qty); §16 topup stale alerts flood (ECONOMY_ALERTS_*_STALE_HOURS tuning + payment provider integration audit).

### Internal

- Loop autonomous session 9n hoàn tất 7/7 PR merge cascade vào main mà không cần user confirmation cho mỗi task (task A→G). Snapshot `d332a18 → c02573a` (post PR #171).

---

## [session 9m — PR #160 → #164, merged 30/4 11:30→11:51 UTC]

### Docs

- **Audit refresh session 9m kickoff** (PR #160): bump snapshot post session 9l close-out.
- **CHANGELOG catch-up sessions 9g/9h/9i/9j/9l** (PR #161): backfill changelog cho các session đã merge nhưng thiếu trong file này.

### Internal

- **API service test coverage push** (PR #162/#163/#164): +36 vitest economy/auth safety:
  - `topup.service.test.ts` +17 vitest (PR #162): payment confirm idempotency, ledger atomicity, currency conversion.
  - `email.service.test.ts` +14 vitest unit (PR #163): no-DB pure transformer tests cho mail formatting.
  - `giftcode-race.test.ts` +5 vitest concurrent (PR #164): double-grant prevention via DB unique constraint + Promise.allSettled stress test.

---

## [session 9l — PR #156 → #159, merged 30/4 10:30→11:00 UTC]

### Docs

- **Audit refresh session 9l kickoff** (PR #156): bump snapshot `2e54a1e → 739b10a`, session 9k 7/7 PR close-out, session 9l backlog + roadmap.
- **RELEASE_NOTES + CHANGELOG session 9k close-out** (PR #157): mark "Đã hoàn thành trong session 9k" 5 item, chuyển M9 sang "Đã giải quyết", thêm CHANGELOG section session 9k.
- **Handoff M9 Resolved** (PR #158): mark M9 (logout-all passwordVersion) Resolved trong §16 Known Issues.

### Internal

- **UI primitive render tests** (PR #159): ConfirmModal 17 + SkeletonBlock 4 + SkeletonTable 4 vitest. Web baseline `484 → 509` (51 → 54 file).

---

## [session 9k — PR #149 → #155, merged 30/4 09:00→09:35 UTC]

### Added

- **Playwright `E2E_FULL=1` golden smoke expand** (PR #153): +3 best-effort test trong `apps/web/e2e/golden.spec.ts` — `shop buy → inventory reflect new item`, `mail inbox open → read → claim nếu có reward`, `profile /profile/:id public view`. CI mặc định không chạy (giữ nguyên AuthView smoke only); ops bật local qua `E2E_FULL=1 pnpm --filter @xuantoi/web e2e` khi muốn verify pre-release.
- **AdminView render-level smoke tests** (PR #150): 18 vitest bao phủ onMounted role guard (unauth / PLAYER / ADMIN+MOD), tab badge rendering (alertsCount / pendingTopup / activeGiftcode), tab switch fetch (Users / Audit), Export CSV flow (success / truncated warning / UNAUTHENTICATED), Giftcode revoke ConfirmModal wiring (modal open/cancel/confirm, CODE_REVOKED error, REVOKED/EXPIRED state hide). Baseline web `466 → 484` (50 → 51 file).
- **`pnpm smoke:beta` zero-dep ESM CLI** (PR #152): `scripts/smoke-beta.mjs` chạy 16-step HTTP smoke (healthz → register → session → onboard → character/me → cultivate start/stop → daily-login → missions → shop → inventory → mail → leaderboard → logout). Exit 0 khi pass, exit 1 với diagnostic khi fail. Dùng cho CI gate trước release + manual smoke.
- **Regression test — `logoutAll` preserves `passwordVersion`** (PR #155): integration test trong `apps/api/src/modules/auth/auth.service.test.ts` lock-in documented behavior (M9).

### Docs

- **`docs/PRIVACY.md` + `docs/TOS.md`** closed-beta tester agreement (PR #151): data retention (account / login logs / chat 30d / currency ledger / item ledger / topup history), delete-my-data flow, analytics scope, 3rd-party services (chỉ Postgres/Redis); closed-beta tester TOS (scope "beta thử nghiệm", no payment, account revocable, no harassment, report-bugs SLA best-effort, liability limited, data backup).
- **`docs/SECURITY.md §1 Authentication`** (PR #154): thêm bullet document behavior `POST /api/_auth/logout-all` revoke refresh tokens nhưng KHÔNG bump `passwordVersion` → access tokens 15-phút TTL vẫn valid trên device khác cho tới khi hết hạn. Force-kill ngay phải đổi password hoặc bump `JWT_ACCESS_SECRET` (backlog M9 close-out).
- **`docs/QA_CHECKLIST.md §9`** thêm hướng dẫn chạy `pnpm smoke:beta` cho QA.
- **`docs/AI_HANDOFF_REPORT.md`** audit refresh kickoff session 9k (PR #149): bump snapshot `2ed8c29 → e342513`, mark PR #134..#148 tất cả Merged, sync baseline web `302 → 466` (35 → 50 file) + shared `55 → 96` (3 → 6 file), sửa PR #136 status (merged stale branch, replay qua #138).

### Internal

- Loop autonomous session 9k hoàn tất 7/7 PR merge cascade vào main mà không cần user confirmation cho mỗi task (task A→G).

---

## [session 9j — PR #134 → #148, merged 30/4 07:20→08:55 UTC]

### Fixed

- **Critical typecheck fix C-TSNARROW-RESOLVEFN** (PR #134): vue-tsc 2.0+ (TS 5.x) narrow `let` variable capture-by-closure thành `never` trong Promise executor. Fix: đổi `resolveHolder: { current }` object-property pattern. Unblock toàn bộ typecheck pipeline.

### Internal

- **Massive view test coverage push** (PR #135 → #148): 15 PR autonomous loop thêm vitest cho mọi view + shared catalog integrity. Web baseline `207 → 466` (30 → 50 file). Chi tiết:
  - TopupView 10 + MailView 14 vitest (PR #135)
  - ShopView 19 vitest (PR #137)
  - InventoryView 15 vitest (PR #138, replay from stale-base PR #136)
  - AuthView 14 vitest (PR #139)
  - OnboardingView 16 vitest (PR #140)
  - DungeonView 13 vitest (PR #141)
  - SectView 12 vitest (PR #142)
  - NotFoundView + router manifest lockdown 8 vitest (PR #143)
  - BossView 12 vitest (PR #144)
  - ChatPanel + LocaleSwitcher 17 vitest (PR #145)
  - MButton + MToast UI primitive 14 vitest (PR #146)
  - Shared shop + topup catalog integrity 19 vitest (PR #147)
  - Shared BOSSES catalog integrity 22 vitest (PR #148)

---

## [session 9i — PR #119 → #133, merged 30/4 06:21→07:50 UTC]

### Added

- **`docs/RELEASE_NOTES.md` bootstrap** (PR #120): closed beta press kit — feature list, known issues, roadmap lộ trình.
- **Smart admin giftcode active badge** (PR #121): `countActiveUnused()` helper + AdminView nav badge cyan-500 cho active giftcodes. +7 vitest.
- **Smart UX — toast duration policy by severity** (PR #122): `resolveToastDuration()` + `TOAST_DURATION_MS` policy (info 3s / success 3.5s / warning 5s / error 6s). +9 vitest.
- **Admin user export CSV** (PR #123): `GET /admin/users.csv` RFC 4180 format + audit `user.exportCsv` + FE download button. +15 vitest.
- **Smart admin giftcode revoke UI flow** (PR #127 + #129): `computeGiftcodeRevokeImpact()` + ConfirmModal danger style (impact preview: usage/expiry/warning) + error mapping. +12 vitest + 5 i18n key.
- **`extractApiErrorCode` pure error extractor** (PR #128): centralized error code extraction từ mọi error shape (direct/axios/ES2022 cause/legacy). +17 vitest. Adopted trong AdminView + AuthView (PR #133 migration 14 view còn lại).

### Internal

- **HomeView smoke tests** (PR #124): 9 vitest cover onMounted routing branches + render + cultivate/breakthrough. Web baseline `207 → 236`.
- **AppShell skeleton tests** (PR #126): 15 vitest cover mobile nav toggle + sidebar badges + staff-only/cultivating/WS/logout.
- **GiftCodeView tests** (PR #131): render + redeem flow + error mapping vitest.
- **ProfileView tests** (PR #132): render + fetch + error + badges vitest.
- **Adopt `extractApiErrorCode`** (PR #133): migration refactor 14 view để dùng centralized error extractor.

---

## [session 9h — PR #111 → #118, merged 30/4 04:25→06:18 UTC]

### Added

- **Admin audit-ledger endpoint + UI** (PR #112): `GET /admin/economy/audit-ledger` on-demand verify CurrencyLedger consistency. `ledger-audit.ts` pure logic + AdminView panel violet-500. +6 BE vitest + 3 FE vitest.
- **Playwright golden expand** (PR #113): +95 line daily login + leaderboard tabs gated `E2E_FULL=1`. `docs/QA_CHECKLIST.md` how-to thêm.
- **Smart onboarding expand 4→6 step** (PR #114): Leaderboard + Mail visit tracking localStorage helper + `OnboardingChecklist.vue` 6 step. +6 vitest.
- **Smart admin economy report — top 10 whales + circulation** (PR #115): `GET /admin/economy/report` 5 stat cards + top whales table. +6 BE + 3 FE vitest + 13 i18n key.
- **Smart admin users filter expand** (PR #116): currency range + realmKey filter cho `GET /admin/users`. +5 BE + 5 FE vitest + 6 i18n key.
- **Smart admin recent activity widget** (PR #117): Stats tab inline last 5 audit entries panel violet-500. +9 i18n key.
- **Smart admin pending topup badge** (PR #118): `pendingTopupCount` ref + 60s poll + badge amber-500 nav "Nạp Tiên Ngọc". +1 i18n key.

### Docs

- Audit refresh session 9h (PR #111).

---

## [session 9g — PR #105 → #110, merged 29/4 19:00→19:55 UTC]

### Added

- **FE Admin Inventory Revoke UI** (PR #106): nút "Thu hồi item" + modal AdminView Users tab + `adminRevokeInventory()` helper. +7 vitest + i18n vi/en.
- **Smart UX — sidebar breakthrough indicator + i18n parity guard** (PR #107): violet-400 dot khi sắp đột phá + 6 vitest enforce vi/en symmetric + ICU placeholder parity. Web vitest `168 → 174`.
- **Smart admin economy alerts badge** (PR #109): `countEconomyAlerts` helper + red dot badge nav Stats + auto-poll 60s. +13 vitest. Web vitest `174 → 187`.

### Fixed

- **`.env.example` SMTP_FROM quote fix** (PR #110): sửa syntax quote trong file env mẫu.

### Docs

- **Runtime smoke report session 9d→9g** (PR #108): 41 endpoint flow verified, 0 Critical/High bugs. Evidence in `docs/RUNTIME_SMOKE_9G.md`.
- Audit refresh session 9g (PR #105).

---

## [session 9f — PR #98 → #103, merged 29/4 17:18→18:50 UTC]

### Added

- **Self-service forgot/reset password** (PR #101 BE + PR #102 FE, merged @ `6f3faf4`): user có thể tự đặt lại mật khẩu qua email link 30 phút thay vì phải nhờ admin DB. Anti-spam rate-limit 3 yêu cầu/IP/15 phút. Email transactional gửi qua SMTP (dev: Mailhog `localhost:1025/8025`, prod: SMTP thật) hoặc fallback console log nếu chưa cấu hình. Reset thành công sẽ tự revoke mọi phiên đăng nhập của user (bump `passwordVersion` + revoke refresh tokens).
- **Trang FE mới**: `/auth/forgot-password` + `/auth/reset-password` (public, không cần đăng nhập). Tab Login có link "Quên huyền pháp?". Devloper-mode panel hiển thị token cho non-prod để E2E test mà không cần Mailhog UI.
- **Bảng xếp hạng đa tab** (PR #99): tab "Sức Mạnh" (giữ nguyên), thêm tab "Nạp Top" (xếp theo tổng tiên ngọc nạp APPROVED) và tab "Tông Môn" (xếp theo treasury linh thạch + level + tuổi). Lazy-fetch theo tab.

### Security

- Forgot-password endpoint **silent ok cho mọi email** (kể cả không tồn tại) → chống user enumeration.
- **Token format `<id>.<secret>`** (PR #101 in-flight Devin Review fix r3163113344): plaintext token gồm `tokenId.secret` — `tokenId` là PK row (non-secret), `secret` là 32-byte base64url. DB lookup O(1) bằng `findUnique({ id: tokenId })` thay vì scan loop (chống DOS by token-flood).
- **Timing parity** (PR #103 post-merge Devin Review fix r3163261711): nhánh `forgotPassword` cho user-không-tồn-tại/banned thêm `argon2.hash` giả ~100ms để response time tương đương path-có-user → chống enum bằng đo network latency.
- Token reset là plaintext 32-byte URL-safe random; DB chỉ lưu argon2id hash của `secret`. One-shot consume; reset thành công revoke mọi token reset khác của user.

### Changed

- **Admin self-protection** (PR #100): admin/mod không thể tự hạ vai trò của chính mình hoặc tự ban chính mình ở trang `/admin`. UI disable nút + badge "Bạn", BE lock-in qua check `actor.id === target.id`. Loại trừ rủi ro lockout vô tình.

### Docs

- (PR #98) Audit refresh `AI_HANDOFF_REPORT.md`: mark PR #92→#97 đã merged, bump snapshot commit, thêm session 9f roadmap A-D.
- (PR #104) Bootstrap `docs/CHANGELOG.md` (file này) — Keep-a-Changelog format adapted closed-beta.

---

## [session 9e — PR #92 → #97, merged 29/4 16:00→17:18 UTC]

### Added

- **Backup/restore script Postgres** (PR #95 + PR #96): `pnpm backup:db` (custom format gzipped) + `pnpm restore:db` (drop-recreate-restore). Verify bằng `pg_restore --list` SIGPIPE-safe. `pg_terminate_backend` trước DROP. Doc `BACKUP_RESTORE.md` (TL;DR + cron mẫu + disaster recovery checklist).
- **Leaderboard topup + sect endpoints** BE (PR #94): `GET /api/leaderboard/topup` + `GET /api/leaderboard/sect` (BE only, FE consume ở PR #99).

### Changed

- **Mobile responsive iPhone SE 375×667** (PR #97): AppShell sidebar chuyển thành drawer overlay khi `md:hidden`, hamburger toggle, watch route auto-close. AdminView 4 table wrap `overflow-x-auto`.

### Docs

- (PR #92) BETA_CHECKLIST refresh; (PR #93) Audit refresh session 9e.

---

## [session 9d — PR #80 → #91, merged 29/4 10:25→14:55 UTC]

### Added

- **Daily login reward** (PR #80): `DailyLoginCard` ở Home, `RewardClaimLog`-backed idempotent claim; +100 LT + streak count.
- **Admin giftcode FE panel** (PR #81): `/admin` giftcode tab với filter q/status, create + revoke (audit logged).
- **`/activity` — sổ hoạt động** (PR #88 BE + PR #91 FE): user xem `CurrencyLedger` + `ItemLedger` của bản thân với keyset pagination, tab switch currency/item, reason i18n đầy đủ. API `GET /logs/me?type=...&limit=...&cursor=...`.
- **Proverbs corpus mở rộng** (PR #87): màn hình tải mở rộng từ 7 → 64 câu chia 4 chủ đề.
- **Logout-all confirm modal** (PR #83 + PR #85): thay `window.confirm()` bằng modal `ConfirmModal` reusable.

### Fixed

- **Giftcode duplicate code** (PR #84): trả error `CODE_EXISTS` thay vì 500.

### Docs

- (PR #89) `API.md` refresh; (PR #90) `QA_CHECKLIST.md` + `ADMIN_GUIDE.md` + `TROUBLESHOOTING.md` refresh; (PR #86) Audit refresh session 9d.

---

## [Earlier — PR #33 → #79]

> Chi tiết theo PR có trong `docs/AI_HANDOFF_REPORT.md` mục "Recent Changes". Highlight chính:

### Foundation (PR #33 → #45)

- **Bootstrap admin/sect seed** (PR #33), **InventoryService 19 vitest** (PR #34), **Boss admin spawn** (PR #36), **Settings page (đổi password + logout-all)** (PR #37), **Profile page** (PR #38), **Shop page (NPC 11 entry, LT only)** (PR #39), **`ItemLedger` audit table** (PR #40), **Mission reset timezone `Asia/Ho_Chi_Minh`** (PR #42), **Currency/Item ledger actor index** (PR #43).

### Frontend hardening (PR #46 → #59)

- Vitest scaffold (PR #47/#53), Vue tests cho store/auth/toast/badges/NextActionPanel/OnboardingChecklist/itemName/Leaderboard (PR #55→#59).

### Stability + ops (PR #60 → #79)

- Register rate-limit 5/IP/15min (PR #60), Profile rate-limit 120/IP/15min (PR #62), WS `mission:progress` push (PR #63 + #65), Playwright e2e-smoke CI matrix (PR #64), Admin inventory revoke + `ADMIN_REVOKE` ledger (PR #66), Skeleton loaders (PR #67/#68/#77), Market fee env var (PR #69), Admin guard ADMIN-only decorator (PR M8), Mobile responsive AppShell partial (PR #74-77).

---

## Format guideline cho future PR

Khi merge PR, **tự bổ sung 1 dòng** vào section "Unreleased" tương ứng:

```markdown
- **<Tên feature người dùng-facing>** (PR #N): <1 câu mô tả tác động cho user/admin>.
```

Nếu PR thuần internal (refactor/test/CI/docs nhỏ) → ghi vào **Internal** thay vì Added/Changed.

Khi đóng release / milestone → di chuyển nguyên section "Unreleased" thành section có ngày + label session, mở section "Unreleased" mới ở trên cùng.
