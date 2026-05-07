# AI Handoff Report — Xuân Tôi

> 👉 **AI/dev mới: ĐỌC [`docs/START_HERE.md`](./START_HERE.md) TRƯỚC.** File đó định tuyến tới đúng doc theo task type (state / vision / roadmap / economy / content / balance / live ops / story).
>
> **Cấu trúc**: file này chỉ chứa **trạng thái live hiện tại** (Executive Summary + Recent Changes + Phase Status + Known Issues + Tests/CI/Smoke + Next Roadmap). **Toàn bộ lịch sử PR cũ** (Snapshots PR #33→#396, Recent Changes Legacy, Completed Features, Project Reference đầy đủ Tech Stack / Architecture / DB / Gameplay / Run Locally / Rules, Old Recommended Next Roadmap, Exact PR Plan, smoke detail table per module) tách ra [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md). **AI mới CHỈ cần đọc file này** — `ARCHIVE_HANDOFF.md` chỉ tra cứu khi cần.
>
> **Cap**: ≤ 250 dòng (HANDOFF REPORT STRUCTURE RULE — xem [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md)). Vượt cap → bắt buộc compact + đẩy entry cũ xuống ARCHIVE.

---

## 1. Current Executive Summary

- **Current `main` commit**: post PR #457 merged (`feat(api,web,shared): Phase 13.1.A sect war core contribution and weekly rewards`) + PR #456 (post-Phase-13.0 audit pass #5) + Phase 13.0 LiveOps & Retention Suite + PR #451 (Phase 11.10.E Pill→Buff) + PR #450 (M10 Shop daily limit) + ... Story design source live tại [`docs/story/`](./story/).
- **Current phase**: Phase 10 **CLOSED** ✅. Phase 11 Progression Depth **COMPLETE** ✅. Phase 11 nâng cao **CLOSED** ✅. Phase 12 World Map & Dungeon **CLOSED** ✅ (#397–#448). Phase 13.0 LiveOps & Retention Suite **CLOSED** ✅ (post #456 audit pass #5). **Phase 13.1.A Sect War Core / Contribution / Leaderboard / Weekly Reward** **CLOSED** ✅ (PR #457 merged). **Post-13.1.A hardening audit hotfix** **OPEN** — this PR (daily cap timezone alignment + doc fix).
- **In-flight**: this PR — **post-Phase-13.1.A hardening audit**. **Bug fix**: `SectWarService.addContributionTx` daily-cap window dùng `setUTCHours(0,0,0,0)` (= 07:00 ICT) thay vì `startOfLocalDay(now, MISSION_RESET_TZ)` (= 00:00 ICT) → cap reset drift +7h, có thể lách `dungeon_clear` cap 50/ngày bằng cách clear trước 07:00 ICT (rows hôm trước @ 23:00 ICT vẫn lọt vào weekKey filter của cùng ISO week). Fix: import `startOfLocalDay` từ `combat.service` + `getMissionResetTz` từ `mission.service`, dùng cùng pattern với dungeon dailyLimit / mission DAILY / daily-login streak. **Doc fix**: `docs/API.md` ghi sai composite UNIQUE order `(weekKey, sourceType, sourceId, characterId)` (thiếu `activityKey`). Fix: `(weekKey, characterId, activityKey, sourceType, sourceId)` match Prisma schema. **+1 regression test** `sect-war.service.test.ts` cover ICT 00:00 boundary case. KHÔNG sửa SectMissions / SectShop / Admin LiveOps (deferred 13.1.B).
- **Test baseline (post this PR)**: shared **1463** (no change vs PR #457). api **+1** sect-war daily-cap regression (post-audit) ⇒ **2078** (6 pre-existing Redis fail). web **1249** (no change). E2E golden-path **22 spec**. Smoke scripts **28 module**.
- **Top priority next session**: (1) **Phase 13.1.B Sect Missions + Sect Shop + Admin LiveOps Controls**; (2) Daily-login multi-day smoke positive; (3) Phase 12 Story dialogue branch / story dungeon instance; (4) CSP production verify khi deploy (M7). Detail §6.
- **Open Critical/High issues**: none. Live medium issues: M7 (CSP production verify khi deploy). Detail §4.
- **Blocker**: none.

---

## 2. Recent Changes

10 PR gần nhất merged trên main (newest đầu, mỗi entry 1 dòng). PR cũ hơn → [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Snapshots.

| PR | Title | Type |
|---|---|---|
| this PR | `fix(api,web,shared): post Phase 13.1.A sect war hardening audit — daily cap window timezone alignment (ICT 00:00 thay vì UTC 00:00) + doc UNIQUE order fix (`docs/API.md`). Audit `SectWarService.addContributionTx` phát hiện daily cap query dùng `setUTCHours(0,0,0,0)` (= 07:00 ICT) thay vì `startOfLocalDay(now, MISSION_RESET_TZ)` (= 00:00 ICT) — drift +7h, không đồng nhất với dungeon dailyLimit / mission DAILY / daily-login streak. Hệ quả: `dungeon_clear` cap 50/ngày có thể lách bằng cách clear trước 07:00 ICT, vì rows hôm trước @ 23:00 ICT (= 16:00 UTC, vẫn cùng ISO week, weekKey filter qua) bị tính nhầm vào hôm nay. Fix: import `startOfLocalDay` từ `combat.service` + `getMissionResetTz` từ `mission.service`. Doc fix: `docs/API.md` ghi sai composite UNIQUE order `(weekKey, sourceType, sourceId, characterId)` (thiếu `activityKey`) — sửa thành `(weekKey, characterId, activityKey, sourceType, sourceId)` match Prisma schema. +1 regression test `sect-war.service.test.ts` reproduce ICT 00:00 boundary: pre-insert 5 dungeon_clear contributions @ Mon 23:00 ICT (cap exact = 50), call addContributionTx với now=Tue 01:00 ICT (cùng ISO week 20) → OLD: cap hit reject; NEW: cap reset accept. Verification: shared 1463 ✅ / web 1249 ✅ / api 2078 ✅ (cũ 2077 +1 regression, 6 pre-existing Redis fail giữ nguyên trên main); typecheck shared/api/web ✅; pnpm build ✅. KHÔNG sửa scope ngoài audit (KHÔNG Sect Missions / Sect Shop / Admin LiveOps Controls / SectWar service rewrite).` | fix |
| #457 | `feat(api,web,shared): Phase 13.1.A Sect War Core — Tông Môn Chiến tuần lễ. Shared `sect-war.ts` catalog: 5 activity (`daily_login` 5pt cap 7/tuần, `dungeon_clear` 10pt cap 50/ngày, `boss_participation` 15pt cap 120/tuần, `boss_top_damage` 25pt cap 100/tuần, `quest_complete` 8pt cap 80/tuần) + 4 reward tier (rank 1 / 2-3 / 4-10 / participation), helpers `sectWarWeekKey()`/`currentSectWarSeason()`/`sectWarActivityByKey()`/`sectWarRewardTierForRank()`; title +1 `sect_war_champion`. Prisma migration `20260524000000_phase_13_1_a_sect_war_core`: 2 table mới `SectWarContribution` (composite UNIQUE `(weekKey, characterId, activityKey, sourceType, sourceId)` chống double-add) + `SectWarWeeklyRewardClaim` (composite UNIQUE `(weekKey, characterId)` chống double-claim). API: `SectWarService` + `SectWarController` + 4 endpoint `/sect-war/{current,leaderboard,me,claim}` (atomic CAS race-safe). 5 hook gameplay defensive try-catch: DungeonRun.claim, Boss.distributeRewards (participation + topDamage), DailyLogin.claim, Quest.claim — character không sect → no-op. FE: `/sect-war` route + 4 panel + Home CTA + i18n vi/en đầy đủ. Tests: shared +38, api +14, web +10. KHÔNG đụng Sect Missions / Sect Shop / Admin LiveOps (deferred 13.1.B).` | feat |
| #451 | `feat(api,shared): Phase 11.10.E Title/Buff gameplay reward hooks — Pill→Buff wire. Audit confirm 4/5 reward source đã wire trước (realm breakthrough → realm milestone title; achievement claim → title; boss kill → title gián tiếp qua achievement; tribulation/breakthrough FAIL → tam_ma debuff). Gap thực sự: Pill use → Buff apply. Shared: extend `ItemEffect` thêm `buffKey?: string`; thêm 4 pill items mới (`cuong_luc_dan`/`thiet_bich_dan`/`sinh_co_dan`/`linh_tam_dan`) wire 1-1 với 4 buff `pill_*_buff_t1` đã có; helper `buffForItem(itemKey)` cross-ref. NPC shop thêm 4 entries dailyLimit=5/người/ngày. API: `InventoryService` constructor 4th param `buffs?: BuffService` optional (forwardRef inject) — `use()` pre-resolve `buffDef = buffForItem(...)` trước tx (catalog drift guard throw KHÔNG decrement) → trong tx sau decrement + character update gọi `buffs.applyBuffTx(tx, charId, buffKey, 'pill')` (atomic rollback nếu tx fail; idempotent qua `CharacterBuff` composite UNIQUE: non-stackable refresh `expiresAt`, stackable +1 stack cap `maxStacks`). Backward-compat: `buffs?` undefined skip silently — legacy bootstrap test fixtures không phải sửa. Tests: +9 shared `buffForItem` (drift guard mọi item.effect.buffKey lookup được; no orphan buff; 4 pill round-trip), +4 inventory service (cuong_luc_dan→pill_atk_buff_t1+decrement, 4 pill distinct rows, 2 use liên tiếp non-stackable refresh `expiresAt` cùng row id, no buffs inject legacy bootstrap). Update 2 catalog test (catalog.test.ts + items-balance.test.ts) accept `buffKey` là valid pill effect. KHÔNG Prisma migration — `CharacterBuff` schema đã có từ Phase 11.8.B. Verification: shared 1389/1389 + api 2039/2039 + web 1216/1216 + typecheck/lint xanh.` | feat |
| #450 | `feat(api,web,shared): M10 Shop daily purchase limit per user/item + per-user rate limit cho /shop/buy. Shared `ShopEntryDef` thêm `dailyLimit?: number` opt-in (closed beta defaults: pills HP/MP=20, exp đan + ore=10, equipment phàm phẩm=5); `ShopEntryView` thêm `dailyLimit: number \| null` cho FE badge. `ShopService.buy()` 2 tầng pre-check trước transaction (KHÔNG trừ tiền khi reject): (1) **per-user rate limit** 30 req/60s qua `RateLimiter` injection (token `SHOP_BUY_RATE_LIMITER`, default `InMemorySlidingWindowRateLimiter`); (2) **per-item daily cap** sum `qtyDelta` ItemLedger reason='SHOP_BUY' + `qtyDelta>0` + `createdAt >= startOfLocalDay(now, MISSION_RESET_TZ)` qua `prisma.itemLedger.aggregate({ _sum })`, throw `SHOP_DAILY_LIMIT` (409) khi `current + qty > dailyLimit`. `shop.module.ts` factory bind `RedisSlidingWindowRateLimiter('rl:shop-buy', 30 req/60s)` wrap `FailoverRateLimiter` (mirror chat.module pattern, Redis disconnect → in-memory fallback, KHÔNG 500). Controller maps `SHOP_DAILY_LIMIT → 409`, `RATE_LIMITED → 429`. FE: `api/shop.ts ShopEntry` thêm `dailyLimit: number \| null`; ShopView render badge "Hạn mức hôm nay: N" khi dailyLimit !== null; i18n vi/en thêm `shop.dailyLimit` + 2 error code (`SHOP_DAILY_LIMIT`, `RATE_LIMITED`). KHÔNG Prisma migration — daily count derive từ ledger với index `(reason, createdAt)` đã có. Tests: +3 shared catalog (`dailyLimit` integer dương / closed beta all entries / `toShopEntryView` map), +11 service-level (limit hit, exact cap pass, per-item isolation, per-character isolation, hôm qua không count, không trừ tiền khi SHOP_DAILY_LIMIT, non-stackable enforce, item-không-có-limit smoke; rate limit hit, per-user isolation, không trừ tiền khi RATE_LIMITED, rate runs trước character lookup), +2 controller (HTTP mapping `SHOP_DAILY_LIMIT 409` + `RATE_LIMITED 429`), +4 ShopView (badge render khi có / không có, SHOP_DAILY_LIMIT toast, RATE_LIMITED toast). Total +20 vitest. Closes M10 backlog "Shop daily limit + rate-limit per user".` | medium-sized api+shared+web feature + 20 tests, no Prisma migration, FE shop UI badge added |
| [#449](https://github.com/hoathienmenh-01/xuantoi/pull/449) | `feat(api,web,shared): Phase 11.8.D Buff HUD + 11.9.C Title catalog/equip — server-authoritative wire. Backend đã có 4 endpoint live trên main: `GET /character/titles` (owned + 26-title catalog + equipped), `POST /character/title/equip` (validate ownership + set `Character.title`, throws `TITLE_NOT_FOUND` 404 / `TITLE_NOT_OWNED` 409), `POST /character/title/unequip` (idempotent), `GET /character/buffs` (auto-prune expired + def metadata). Shared `CharacterStatePayload` thêm `title: string \| null`; `Character.toState()` expose. PR này wire toàn bộ FE: 2 api client modules (`api/titles.ts`, `api/buffs.ts` Envelope+fallbackError), 2 Pinia stores (`stores/titles.ts` 145 LOC server-authoritative race-protected `inFlight` flag + pre-checks `TITLE_NOT_OWNED/ALREADY_EQUIPPED/NOT_EQUIPPED`; `stores/buffs.ts` 59 LOC read-only HUD), `views/TitleView.vue` (full catalog grid với 3 filter source/rarity/status, equipped banner + quick-unequip, equip/unequip toast feedback i18n error code), `components/shell/BuffBar.vue` HUD (auto-refetch 1s loop detect expiry, polarity emerald/rose pill, countdown `<60s/<3600s/≥3600s` format), AppShell topbar wire (equipped title amber-200 text via `getTitleDef(character.title)` + BuffBar `lg+` screens + `/titles` nav link 號 prefix), router lazy-load `/titles`. i18n vi/en đầy đủ (`titles.*` 8 subsection + 9 error code, `buffs.bar.aria`, `shell.nav.titles`, `apiFallback.titles*` / `apiFallback.buffsState`). Test coverage: +12 view test `TitleView` (auth gate, loading, render, filter, equipped banner, equip/unequip click, error toast), +18 controller test `character.controller.title-buff.test.ts` (envelope + ISO date + error→HTTP mapping cho 4 endpoint), +stub fix cho controller constructor positions (4 file: alchemy/skill-book/spiritual-root/talents/tribulation-log/achievements add `undefined, // title` + `undefined, // buff`), +stub fix cho `CharacterStatePayload` test (`ws-events.test.ts` 4 snapshot + `OnboardingChecklist.test.ts` `makeChar()` thêm `title: null`). Không có Prisma migration — dùng `Character.title` field đã có sẵn trong schema. NO breaking change vì backend đã merged trên main và FE chỉ wire UI thiếu.` | medium-large feature: 0 Prisma migration + FE wire 4 endpoint + 2 store + view + HUD + i18n + 30 new test |
| [#448](https://github.com/hoathienmenh-01/xuantoi/pull/448) | `feat(api,web,shared,boss): Phase 12.6 boss-by-region auto-spawn — partial unique per region + heartbeat fan-out + multi-region UI. Prisma migration `20260523000000_phase_12_6_world_boss_region_key` adds `WorldBoss.regionKey TEXT NOT NULL DEFAULT 'world'`, drops the old single-row partial unique `WorldBoss_status_active_unique`, creates `WorldBoss_status_region_active_unique ON (status, regionKey) WHERE status='ACTIVE'` so DB enforces ≤1 ACTIVE per region while allowing each region to spawn in parallel. BossService refactor: `heartbeat()` loops `bossSpawnRegions()` (catalog union of `BossDef.regionKey` ∪ `'world'` for legacy null), per-region `expire+spawn` swallows error per region; `spawnNew({regionKey?})` filters via `bossesByRegion` and rotates per-region; `adminSpawn({regionKey?, bossKey?})` resolves region (explicit → derived from def → `'world'`), validates def↔region mismatch → `INVALID_BOSS_KEY`; new `listActive()` + `getCurrentByRegion()` with backwards-compat `getCurrent()`; `attack(bossId?)` lets multi-region clients disambiguate. New endpoints `GET /boss/active` + `GET /boss/region/:regionKey` (regex validate `^[a-z][a-z0-9_]{0,63}$`). FE `BossView.vue` shows region tab strip when multiple ACTIVE, computed-driven boss view, region badge in header, i18n vi/en (`boss.regionTabsLabel`, `boss.regionBadge`, `boss.region.world`, +6 error codes). +8 region tests `boss.service.region.test.ts` (cross-region race, heartbeat fan-out, per-region skip, admin isolation, def↔region mismatch, listActive sort, getCurrentByRegion filter, schema default backfill); concurrency suite rewritten for per-region invariants; +6 shared tests for `bossSpawnRegions/bossesByRegion/WORLD_BOSS_REGION_KEY`. Closes Phase 12 exit criterion "Auto-spawn boss working with idempotency test".` | large feature: 1 Prisma migration + multi-module api refactor + new endpoints + FE region tabs + i18n + 14 new tests |
| [#447](https://github.com/hoathienmenh-01/xuantoi/pull/447) | `fix(api,boss): spawn cron auto race — partial unique index `WorldBoss_status_active_unique` (Prisma migration `20260522000000_concurrency_boss_active_unique`) enforces ≤1 ACTIVE row at any time; `spawnNew()` catches Prisma `P2002` on the active partial unique index → returns `null` (benign no-op) instead of crashing the heartbeat tick; `adminSpawn(force=true)` race-loses → throws `BOSS_ALREADY_ACTIVE` (KHÔNG ghi audit log nói dối là admin spawned). Plus in-process `heartbeatRunning` re-entry guard (skip overlap nếu previous tick còn distribute reward). Closes Concurrency phase 2 final remainder. +4 concurrency test.` | small-medium api fix + 1 Prisma migration + 4 tests, no UI change |
| [#446](https://github.com/hoathienmenh-01/xuantoi/pull/446) | `feat(api,common,chat): FailoverRateLimiter Redis-down failover + 7 test — ChatService.send() trong production wire `RedisSlidingWindowRateLimiter` ở chat.module factory; nếu Redis sống lúc bind nhưng chết runtime (pod restart, network partition, NOAUTH after rotation), `pipeline.exec()` throw → ChatService propagate 500 → user mất quyền chat. Thêm `FailoverRateLimiter(primary, fallback, logger)` wrapper try-primary-catch-fallback, log warn 1× to avoid spam, in-memory degrade per-instance trong khoảng Redis down, auto-recover khi Redis up. +6 unit + 1 integration real Redis disconnect.` | small-medium api fix + tests, no Prisma migration, no UI change |
| [#445](https://github.com/hoathienmenh-01/xuantoi/pull/445) | `fix(api,cultivation): tick CAS guard + 2 race backstop test — CultivationProcessor.process() trước fix dùng `prisma.character.update({ data: { exp, realmStage } })` ABSOLUTE write của `c.exp + gain` từ snapshot findMany. 2 worker race cùng baseline → CAS-less last-writer-wins prevents double-grant nhưng vẫn double-track mission/achievement/realtime spurious. Sau fix: `updateMany` với CAS guard `where: { id, exp: c.exp, realmStage: c.realmStage, cultivating: true }` — count=0 → continue skip side effects. +2 backstop test.` | small-medium api fix + tests, no Prisma migration, no UI change |
| [#444](https://github.com/hoathienmenh-01/xuantoi/pull/444) | `fix(api,realtime): ban during WS connection + RealtimeService.kickUser — RealtimeGateway.handleConnection thiếu User.banned check sau JWT verify, banned user vẫn connect/nhận state:update/chat:msg/cultivate:tick đến khi access-token TTL ~15min expire. Fix: post-JWT-verify query user.banned → emit error{code:ACCOUNT_BANNED} + disconnect(true). Thêm RealtimeService.kickUser(userId, reason) snapshot+emit+disconnect, idempotent. Wire AdminService.setBanned(banned=true) gọi kickUser. +2 race test gateway + 3 unit test service.kickUser.` | small-medium api fix + tests, no Prisma migration, no UI change |
| [#443](https://github.com/hoathienmenh-01/xuantoi/pull/443) | `fix(api,inventory): atomic revoke() qty decrement + 2 concurrency tests — InventoryService.revoke() JS-capture race (data: { qty: r.qty - take } reads from findMany before tx commit; 2 admin call song song → cả 2 thread cùng update qty=N-take, row leak under-revoke + ledger lệch DB delta). Fix: per-row guarded `updateMany` (where qty: { gte: take }, decrement) + guarded `deleteMany` (where qty: take). count=0 → throw INSUFFICIENT_QTY → tx rollback. Pattern parity với `use()` atomic decrement. +2 race test trong inventory.service.concurrency.test.ts (3.A: 30× Promise.all([revoke 5, revoke 5]) on qty=10 — ledger sum khớp DB delta invariant; 3.B: 30× Promise.all([revoke 7, revoke 7]) over-subscribe — exactly 1 succeed + 1 INSUFFICIENT_QTY). Concurrency phase 2 progress.` | small-medium api fix + tests, no Prisma migration, no UI change |
| [#442](https://github.com/hoathienmenh-01/xuantoi/pull/442) | `balance(shared): Phase 12.5 tune late-game story dungeon monsters — stat tuning HP/ATK/DEF/SPD/level + monsterType promotion (HUMANOID→ELITE tich_thien_sat_thu, SPIRIT→ELITE tam_ma_nguyen_anh, HUMANOID→BOSS huyet_anh) + 3 lootTable override Phase 12.4 convention + 11 invariant test dungeons-balance.test; ky_uc_meo giữ nguyên là story-hard intentional tier gap (Nguyên Anh stat trong Trúc Cơ dungeon moc_huyen_lam, document ở BALANCE_MODEL §5.4 appendix)` | medium shared catalog + tests, no API change, no Prisma migration, no UI change |
| [#441](https://github.com/hoathienmenh-01/xuantoi/pull/441) | `docs(handoff): sync post PR #440 merged state — AI_HANDOFF_REPORT.md current main = post PR #440 merged + PHASE12_STORY_PROGRESS QuestView dungeon hint CLOSED ✅ + Recommended Next Roadmap reorder (Phase 12.5 → Concurrency phase 2 → Shop daily limit → CSP)` | docs-only sync |
| [#440](https://github.com/hoathienmenh-01/xuantoi/pull/440) | `feat(shared,web): Phase 12 Story discoverability — QuestView dungeon hint cho kill+monster step (shared helper findDungeonsForQuestPlaceholder resolve dungeon qua direct key match + MonsterDef.questTargetIds alias dedupe theo dungeon.key + FE QuestView.vue render line "📍 Tìm tại: {names}" inline dưới step + i18n vi/en parity quest.stepHint.foundIn + 5 shared test + 4 FE test); UX gap close: player giờ thấy ngay dungeon đi cho mỗi kill+monster step (8 late-game placeholder + 7 PR-6 critical-path) — KHÔNG cần tự tra catalog` | small shared+FE feature + tests, no API change, no Prisma migration |

**Phase summary tables (PR #1 → #396) + smoke detail per-module + PR #414/#415 + PR #430/#437 entries**: tách sang [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Phase Summary Migrated 2026-05-05 + § Smoke Detail Migrated 2026-05-05.

---

## 3. Current Phase Status

| Phase | Title | Status | Note |
|---|---|---|---|
| 0–8 | Foundation: schema + auth + core gameplay | **Done** ✅ | Full feature catalog ở [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Completed Features. |
| 9 | Beta readiness (Phase 9.A→9.E sub-phases polish) | **11/15 Done, 3 Partial** | Detail [`BETA_CHECKLIST.md`](./BETA_CHECKLIST.md). Mail UI gap closed by PR #391. |
| 10 | Content scale | **5/5 CLOSED** ✅ | All sub-tracks merged. |
| 11 | Progression Depth | **catalog 11/11 + runtime 10/10 + UI merged** | Phase 11 nâng cao (§2/§3/§5/§6 + 11.6.C/D/E + 11.1.E) tất cả CLOSED. |
| 11.X | UI E2E smoke Playwright | **DONE** | Spec #19 talent learn→cast→cooldown + #20 breakthrough flow merged via #394/#420. |
| 12 | World Map & Dungeon | **OPEN** | 12.1 catalog CLOSED (#397). 12.2.A `dailyLimit` enforcement CLOSED (#421). Story PR-1→PR-6 + Foundation Extension + Late-game wire CLOSED (#425–#433). **12.2.B/C + 12.3** CLOSED ✅ (#434–#436). **E2E spec #22 dungeon-run flow** CLOSED ✅ (#437). **12.4 per-monster `MonsterDef.lootTable` polish** CLOSED ✅ (#438). **Story Foundation Late-game encounter wire** CLOSED ✅ (#439). **Story discoverability — QuestView dungeon hint cho kill+monster step** CLOSED ✅ (#440). **docs handoff sync** CLOSED ✅ (#441). **12.5 dungeon balance tuning — 8 late-game story monster stat + lootTable** CLOSED ✅ (#442). **12.6 Boss-by-region auto-spawn — partial unique per `(status, regionKey)` + heartbeat fan-out + multi-region UI** CLOSED ✅ (this PR — closes Phase 12 exit criterion "Auto-spawn boss working with idempotency test"). Next: optional dialogue branch / DungeonTemplate story-instance. |
| Concurrency phase 2 | Race condition fix sweep | **CLOSED** ✅ | All 6 races fixed: Inventory `use()` (#422), Inventory `revoke()` (#443), Realtime ban-during-connection (#444), Cultivation tick CAS (#445), Chat Redis failover (#446), Boss spawn cron auto race (#447). Concurrency phase 2 **DONE**. |
| 13+ | Real-time PvP / pet gacha / voice / streaming | **Not started** | Per [`LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md) §0 — explicitly DO NOT build yet. |

**Smoke coverage**: 28 module (~15 step avg, +`smoke:quest` 20 step PR-3, +`smoke:npc` 11 step PR-4, +`smoke:dungeon-run` 16 step PR #434). 8 module có cả negative + positive path: skill / shop / mail / inventory / spiritual-root / breakthrough / auth / cultivation-method. Defer: daily-login multi-day positive (cần admin advance-day). Full per-module step count + endpoint coverage → [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Smoke Detail Migrated 2026-05-05.

---

## 4. Known Issues / Risks

### Live (Open) — cần action

| # | Severity | Issue | Status / Plan |
|---|---|---|---|
| M7 | Medium | CSP production-ready nhưng chưa test deploy với CDN/asset domain khác. | **Open** — khi deploy production cần review `script-src`, `connect-src`. |
| M10 | Medium | Shop không có rate-limit + stock infinite + không daily limit. | **Open** — closed beta acceptable; sau beta thêm `dailyLimit` config + `rl:shop-buy:<userId>`. |

### Resolved (recent — full list ở ARCHIVE)

- Inventory `use()` JS-capture race → Resolved PR #422 (atomic `updateMany` + post-decrement delete + INVENTORY_ITEM_NOT_FOUND translation + 5 regression test).
- Phase 12.2.A daily limit enforcement → Resolved PR #421.
- M9 Settings logout-all `passwordVersion` → Resolved PR #154/#155 (intentional trade-off documented `docs/SECURITY.md §1`).
- M11 `GET /character/profile/:id` rate-limit → Resolved PR #62 (`PROFILE_RATE_LIMITER` 120 req/IP/15min).
- M8 Admin guard MOD broad quyền → Resolved PR E (`@RequireAdmin()` decorator + reflector AdminGuard).
- M6 LogsModule chưa build → Resolved PR #88 BE + #91 FE (`/logs/me` keyset pagination + ActivityView.vue + 24 ledger reason i18n).

> **Full historical issues** (~50 entries Critical/High/Medium/Low + Resolved) ở [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Section 16 Known Issues / Risks.

---

## 5. Tests / CI / Smoke / E2E

### Vitest baseline (post this PR)

| Workspace | Test count | Notes |
|---|---|---|
| `apps/api` | **2021** | +18 từ Phase 11.8.D / 11.9.C controller test `character.controller.title-buff.test.ts` (titlesState 5 + titleEquip 5 + titleUnequip 3 + buffsState 5 — envelope/ISO date/error→HTTP). Service-level title/buff suite carryover từ branch `b` đã hiện trên main. |
| `packages/shared` | **1376** | Không thay đổi — `CharacterStatePayload.title` field thêm trong branch `c` đã có test snapshot (4 snapshot trong `ws-events.test.ts`). |
| `apps/web` | **1212** | +12 view test `TitleView` (auth gate, loading, render, filter, equipped banner, equip/unequip click, error toast). Carryover api/store/component test trong branch (`api/titles.test.ts` 3, `api/buffs.test.ts` 3, `stores/titles.test.ts` 12, `stores/buffs.test.ts` 4, `components/__tests__/BuffBar.test.ts` 9). |
| **Total** | **4609 vitest** | All green local (Vitest run trên `devin/1778102863-buff-title-hud-wire`, DB up). **GitHub CI runners**: verify khi PR push. |

### CI

- Workflow `.github/workflows/ci.yml`: `build` + `e2e-smoke` jobs (PG+Redis services). Chạy mỗi PR + push (no path filter — docs-only PR vẫn trigger CI). Yêu cầu xanh trước khi merge.
- 5 redis-dependent test (rate-limiter + health controller) cần Redis local — pass khi Redis container up.

### Smoke Scripts (manual, không nằm CI matrix)

28 smoke scripts, ~15 step avg. Yêu cầu local stack: `pnpm infra:up` + `pnpm --filter @xuantoi/api exec prisma migrate deploy` + `pnpm --filter @xuantoi/api run bootstrap` + `pnpm --filter @xuantoi/api dev`. Module list: achievement, admin, auth, beta, boss, breakthrough, chat, combat, cultivation, cultivation-method, daily-login, **dungeon-run** (Phase 12.2.B — 16/16 step, positive flow tới claim + double-claim reject), economy, giftcode, inventory, leaderboard, mail, market, mission, next-action, npc, **quest** (Phase 12 PR-2 — 16/16 step, negative-path heavy), sect, shop, skill, spiritual-root, topup, ws.

**Positive-path coverage** (8 module): skill (PR #388/#390), shop (#390), mail (#391), inventory (#385), spiritual-root (#386), breakthrough (#417), auth (#384), cultivation-method (#394). Còn defer: daily-login multi-day positive — pending admin advance-day endpoint hoặc service helper extension.

**Per-module detail table** (step count, negative/positive flag, notes) → [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Smoke Detail Migrated 2026-05-05.

### E2E (Playwright)

- `apps/web/e2e/golden.spec.ts` — 22 spec golden path (auth smoke + 21 full-stack gated `E2E_FULL=1`). Notable: #19 talent learn→cast→cooldown badge (`golden.spec.ts:759-895`), #20 breakthrough attempt → outcome banner + history reload-persist (`golden.spec.ts:898-981`), #21 Phase 12 Story PR-5 main storyline Chapter 1 playable (`golden.spec.ts:1031-1125`), **#22 Phase 12.3 DungeonRun flow** (`golden.spec.ts:1162-end` — son_coc start→next×3→claim, verify per-encounter loot span + reward delta).
- CI job `e2e-smoke`: chạy spec #1 AuthView smoke mỗi PR (matrix postgres+redis, build api+web, `E2E_SMOKE=1`).
- `E2E_FULL=1` gate cho 19 full-stack spec **chưa wire CI** — runtime manual với `pnpm infra:up` + `pnpm --filter @xuantoi/api dev` + `pnpm --filter @xuantoi/web dev`.

---

## 6. Recommended Next Roadmap

Per [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md) §SESSION PR LIMIT (1-3 PR/session) + §GOM TRƯỚC KHI TÁCH 4b. Ưu tiên Medium PR > Hotfix > Large.

### Top priority — next session

1. **Phase 12 Story dialogue branch / story dungeon instance** (optional, Medium-Large PR) — 8 placeholder kill milestone hiện có stat tuned (Phase 12.5) nhưng không có dialogue branch sau kill; hoặc tạo `DungeonTemplate` story-instance tách biệt từ farm dungeon.

2. **Daily-login multi-day smoke positive** — multi-day streak smoke test cho `daily-login` module (chưa có positive E2E).

3. **CSP production verify** (M7) — Hotfix khi deploy production. Test `script-src` / `connect-src` với CDN domain khác.

4. **Admin LiveOps controls** (Medium PR) — CMS toggle event enable/disable + manual force-spawn boss override. Hiện Phase 13.0 chỉ có static catalog.

5. **Phase 13.1.B Sect Missions + Sect Shop + Admin LiveOps Controls** (Medium-Large PR) — Phase 13.1.A đã wire Sect War core (contribution + leaderboard + weekly reward). Tiếp theo: Sect Missions (daily/weekly task list cho thành viên, reward `congHien`), Sect Shop (consume `congHien` đổi item/title/buff sect-internal), Admin LiveOps Controls (CMS toggle event enable/disable + manual force-spawn boss override).

### Phase 12 Story chain status

Design source ở [`docs/story/TU_TIEN_LO_STORY_BIBLE.md`](./story/TU_TIEN_LO_STORY_BIBLE.md) + [`docs/story/PHASE12_STORY_PROGRESS.md`](./story/PHASE12_STORY_PROGRESS.md). 5-PR core roadmap + Foundation Late-game wire + encounter wire + discoverability hint **all CLOSED** ✅:

- **PR-1** → **PR-6** — Catalog foundation, Quest runtime, Claim, NPC dialogue UI, Chapter 1 playable, Combat kill hook. **CLOSED** ✅ (#425–#432).
- **Foundation Late-game wire** — 8 monster catalog (`tich_linh_anh`, `tam_ma_anh`, `tich_linh_quy`, `tich_thien_sat_thu`, `tam_ma_nguyen_anh`, `chap_niem_anh`, `ky_uc_meo`, `huyet_anh`). **CLOSED** ✅ (#433).
- **Foundation Late-game encounter wire** — wire 8 placeholder vào 4 dungeon `monsters[]`. **CLOSED** ✅ (#439).
- **QuestView dungeon hint** — close discoverability gap. **CLOSED** ✅ (#440).
- **Phase 12.5 dungeon balance tuning** — stat HP/ATK/DEF/SPD/level + monsterType promotion (3 ELITE/BOSS) + 3 lootTable override + 11 invariant test. **CLOSED** ✅ (#442).

Next nâng cao Phase 12 Story (optional, nếu cần): thêm dialogue branch cho 8 placeholder kill milestone HOẶC tạo `DungeonTemplate` story-instance tách biệt từ farm dungeon (instance riêng → boss-rush single-shot). Sau mỗi PR Phase 12 Story merged, AI **bắt buộc** cập nhật `docs/story/PHASE12_STORY_PROGRESS.md` trong cùng PR (DOCS UPDATE RULE).

### Backlog (low priority)

- **Doc compaction maintenance**: khi Recent Changes vượt 10 entry → đẩy entry cũ nhất xuống ARCHIVE § Recent Changes Legacy. Khi `AI_HANDOFF_REPORT.md` vượt **250 dòng** → compact ngay theo HANDOFF REPORT STRUCTURE RULE (cap mới 2026-05-05).
- **Concurrency tests phase 2 (low priority remainder)**: Boss spawn cron auto race.

### Anti-feature-creep (DO NOT BUILD YET)

Per [`LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md) §0:
- Real-time PvP (Phase 14)
- Party / co-op dungeon (Phase 12 — wait Phase 11 ≥ 95%)
- Pet / wife gacha (Phase 16)
- Voice chat
- Video streaming

---

## 7. Archive (đã tách file riêng)

Toàn bộ Archive (Snapshots PR #33→#396, Recent Changes Legacy, Completed Features, Project Reference đầy đủ Tech Stack / Architecture / DB / Gameplay / Run Locally / Rules, Old Recommended Next Roadmap, Exact PR Plan, Phase Summary Migrated 2026-05-05, Smoke Detail Migrated 2026-05-05) đã tách ra file riêng để giảm token cost mỗi session.

Chi tiết: [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md). **AI mới KHÔNG cần đọc file đó mỗi session — chỉ tra cứu khi cần điều tra PR/history cụ thể.**
