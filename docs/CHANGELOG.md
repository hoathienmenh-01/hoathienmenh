# Changelog — Xuân Tôi

Tóm tắt **người chơi / vận hành / dev** dễ đọc, theo PR đã merge vào `main`. Định dạng cảm hứng từ [Keep a Changelog](https://keepachangelog.com/) + [Semantic Versioning](https://semver.org/lang/vi/) nhưng adapt cho closed-beta:

- **Closed beta chưa release public** → versioning tạm bằng "session khoảng PR".
- Chi tiết kỹ thuật từng PR (file/path/test) nằm trong `docs/AI_HANDOFF_REPORT.md` mục "Recent Changes". File này chỉ tóm tắt **thay đổi quan trọng cho người dùng/admin**.
- Quy ước section: **Added** / **Changed** / **Fixed** / **Security** / **Docs** / **Internal**.

---

## [Unreleased]

> Pending merge: docs CHANGELOG catch-up session 9r-28 — PR #279 (achievement catalog cross-ref test) + PR #280 (Phase 11.9.C breakthrough title wire) + PR #281 (Phase 11.9.C-2 tribulation title wire).

### Added — Admin LiveOps Advanced Controls (this PR)

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
