# Beta Launch Checklist

Checklist để promote beta (closed 50 users → open). Tick khi xong.

## ✅ Đã hoàn thành

### Phase 0-1 — Hạ tầng + Auth
- [x] Monorepo pnpm workspace (`apps/api`, `apps/web`, `packages/shared`)
- [x] `@xuantoi/shared` dual ESM/CJS export (tsup)
- [x] Prisma migration baseline Phase 0-8
- [x] NestJS + Vite + Pinia + Vue 3 boot
- [x] Auth đầy đủ: register / login / logout / session / refresh / change-password
- [x] argon2id + JWT access 15m + refresh 30d httpOnly
- [x] Refresh token rotation + reuse-detection revoke all
- [x] Rate limit login 5/15m qua `LoginAttempt`
- [x] `passwordVersion` check ở JWT guard (đổi mật khẩu kill mọi phiên)
- [x] `helmet`, CORS env-based
- [x] Production assert JWT secrets
- [x] `AllExceptionsFilter` envelope `{ ok, data | error }`
- [x] `AuthErrorCode` chuẩn hoá
- [x] **Logout-all với confirm modal `ConfirmModal.vue`** (PR #83 L6) — replace `window.confirm`
- [x] **Cross-tab 401 redirect** (`apps/web/src/api/client.ts` interceptor)

### Phase 2 — Nhập Định + WebSocket
- [x] BullMQ cron tu luyện (30s tick)
- [x] RealtimeGateway `/ws` cookie auth
- [x] Live `cultivate:tick` + `chat:msg` + `mission:progress` (PR #63) push
- [x] **WS `mission:progress`** real-time mission progress update

### Phase 3-8 — Modules
- [x] Combat PvE (Luyện Khí Đường + 3 dungeon + 9 monster)
- [x] Inventory + Equipment (9 slots) + revoke action (PR #66 admin)
- [x] Market P2P Phường Thị (listing + buy + escrow + 5% fee)
- [x] Sect + Chat thế giới + scope rate-limit (Redis)
- [x] World Boss + spawn endpoint (PR #36 admin) + distribute rewards
- [x] Admin panel (grant/ban/set realm) + Topup tiên ngọc
  - 7 tab: Overview (alerts PR #54), Users (filter q/role/banned + revoke), Topups (filter q/status/from/to PR #67), Audit (filter action/q), GiftCodes (filter q/status PR #81 + CODE_EXISTS PR #84), Mail, Boss
  - Role split MOD vs ADMIN (PR #48 H8) — `@RequireAdmin()` decorator trên 9 action endpoints
- [x] `CurrencyService` + `CurrencyLedger` + `ItemLedger` audit trail
- [x] **`pnpm audit:ledger`** script (`apps/api/scripts/audit-ledger.ts`) — verify ledger consistency

### Smart beta gameplay
- [x] **Daily Login Reward** (PR #80 M9) — `apps/api/src/modules/daily-login/`, FE `DailyLoginCard.vue`, idempotent claim, reset theo `Asia/Ho_Chi_Minh`
- [x] **Leaderboard Top-50 power** (PR #59) — `/api/leaderboard/power`, `LeaderboardView.vue`
- [x] **Public profile** `/profile/:id` với rate-limit (PR #59 derivative)
- [x] **NextActionPanel** suggestion engine (smart onboarding §1) — `apps/api/src/modules/next-action/`, `NextActionPanel.vue`
- [x] **A Linh** NPC guide (smart onboarding) — `apps/web/src/components/onboarding/`
- [x] **Mission system** (Daily/Weekly/Once) — gameplay + claim API + WS progress
- [x] **Mail system** (admin gửi mail + claim reward) — `MailView.vue`, badge unread, `MailModule` + `pruneExpired` cron
- [x] **Gift code** (admin tạo/revoke + player redeem) — `GiftCodeView.vue` + admin filter (PR #81 G22) + duplicate `CODE_EXISTS` (PR #84 G23)
- [x] **NPC Shop** (`ShopView.vue`) — buy/sell với pricelist
- [x] **Self audit log** `GET /logs/me` (PR #88 M6) — keyset paginated CurrencyLedger + ItemLedger
- [x] **`/activity` tab** FE consumer M6 (PR #91) — currency/item toggle, signed delta, i18n reason

### Hardening + ops
- [x] **LoginAttempt prune cron** (`apps/api/src/modules/ops/ops.processor.ts`) — BullMQ repeatable
- [x] **RefreshToken cleanup cron** (cùng processor)
- [x] **Mail expired prune** (`mail.service.ts` `pruneExpired`)
- [x] **Redis rate limit chat** (`apps/api/src/modules/chat/chat.module.ts` `chatRateLimiterProvider`)
- [x] **Health check endpoints** `/api/healthz` + `/api/readyz` + `/api/version` (`apps/api/src/modules/health/`)
- [x] **CSP production** policy chặt, dev `false` (`apps/api/src/main.ts` `helmetConfig`) — chỉ cần review CDN khi prod deploy

### Testing
- [x] **api 1133** + **web 2605** + **shared 950** = **4688+ vitest** (web baseline 2605 as of 2026-05-19; shared 950; api 1133+). Stale snapshot cũ "557 test" của session 9d đã bị thay; mỗi PR mới phải verify số này không giảm.
- [x] Real Postgres integration (CI `postgres` service, schema `mtt`)
- [x] WS integration test (real socket.io-client)
- [x] CI postgres + redis service xanh
- [x] **vitest integration cho SettingsView logout-all** (PR #85 L6b — 7 test)
- [x] **Idempotency test cho Daily Login claim** (PR #80)
- [x] **Cursor invalid + isolation test cho `/logs/me`** (PR #88, 20 test)

### UX / i18n / PWA
- [x] vue-i18n VI + EN (16+ view) — bao gồm `activity.*` (PR #91)
- [x] Locale switcher + persist localStorage
- [x] PWA manifest + PNG icons 192/512/maskable + apple-touch-icon
- [x] Workbox precache
- [x] Skeleton loader (LeaderboardView, ProfileView, ActivityView, MarketView)
- [x] Toast unified `MToast.vue`
- [x] Mission/Mail/Boss/Topup badge sidebar
- [x] **Loading splash proverbs corpus 64 câu** (PR #87 L3) — 4 chủ đề × 16 câu

### Content / Balance
- [x] 28 cảnh giới × 9 trọng (`packages/shared/src/realms.ts`)
- [x] `cultivationRateForRealm` scale 1.45^order — property test ≤24h/stage 1
- [x] **87 item** cover 9 EquipSlot + pill (HP/MP/EXP) + ore + artifact + misc (was 31 → 81 PR-1, +6 yêu phù Phase 10 PR-3, see `packages/shared/src/items.ts`).
- [x] **25 skill** tổ chức theo Ngũ Hành Kim/Mộc/Thuỷ/Hoả/Thổ × ≥1 active + ≥1 passive + 1 vô hệ early (was 10; +15 từ Phase 10 PR-2 Skill Pack 1, see `packages/shared/src/combat.ts` SKILLS).
- [x] **29 monster** (was 9; +20 từ Phase 10 PR-3 Monster Pack 1) × Ngũ Hành element + MonsterType (BEAST/HUMANOID/SPIRIT/ELITE/BOSS), 8 region (3 legacy + 5 element-thematic kim_son_mach/moc_huyen_lam/thuy_long_uyen/hoa_diem_son/hoang_tho_huyet).
- [x] **9 dungeon** (was 3; +6 từ Phase 10 PR-3 Dungeon Pack 1) × element thematic + recommendedRealm luyenkhi→nguyen_anh + DUNGEON_LOOT cover all dungeon (no orphan).
- [x] **66 mission** (was 12; +54 từ Phase 10 PR-4 Mission Pack 1) × DAILY/WEEKLY/ONCE × realmTier (luyenkhi/truc_co/kim_dan/nguyen_anh/hoa_than) + Ngũ Hành element-themed weekly + 6 chain quest (`tu_tien_progression` 4 step + `{kim,moc,thuy,hoa,tho}_chronicle` 2 step each + `endgame` 2 step). MissionDef forward-compat extend (`element`/`regionKey`/`storyChainKey`/`realmTier`) cho phase 11+ chain quest UI + element bonus reward — runtime mission service KHÔNG đổi (track theo `goalKind`). Reward budget tuân `BALANCE_MODEL.md` §7.1 enforce bằng `missions-balance.test.ts` (27 vitest).

### Docs
- [x] `docs/AI_HANDOFF_REPORT.md` (1800+ line, living handoff document)
- [x] `docs/API.md` refresh (PR #89) — endpoint sync + global prefix `/api/` note + WS event
- [x] `docs/QA_CHECKLIST.md` refresh (PR #90) — Daily Login + Leaderboard + Audit log self-view + WS
- [x] `docs/ADMIN_GUIDE.md` refresh (PR #90) — 7 tab + filter + MOD role split + boss spawn endpoint
- [x] `docs/TROUBLESHOOTING.md` (171 line)
- [x] `docs/RUN_LOCAL.md`
- [x] `docs/DEPLOY.md`
- [x] `docs/SECURITY.md`
- [x] `docs/SEEDING.md` catalog + cách thêm mới
- [x] `docs/BALANCE.md` formula + bảng tra
- [x] `docs/BETA_CHECKLIST.md` (file này)

## 🔲 Chưa làm — roadmap beta

### Gameplay features (post-beta nice-to-have)
- [ ] **M10 — Shop daily limit + per-item rate-limit**: tránh exploit unlimited buy/sell. Hiện shop không có giới hạn ngày.
- [ ] **Buff system**: item buff + sect buff + event rate (×N) nhân vào `cultivationRateForRealm`. Đã có model field, chưa có gameplay flow.
- [ ] **Equipment reforge / enchant**: upgrade bonuses trên item. Hậu beta.
- [ ] **PvP cốc đấu**: Phase 9 (ngoài scope beta).
- [ ] **Achievement system**: thành tựu mốc tiến độ. Có ledger reason `ACHIEVEMENT` placeholder, chưa có gameplay flow.

### Hardening + ops (cho production beta)
- [ ] **M7 — CSP production review**: helmet CSP đã có policy, nhưng cần review CDN list (img-src, script-src) khi prod deploy thật. Hiện dev `contentSecurityPolicy: false`.
- [ ] **Sentry / error tracking**: wire DSN vào BE + FE.
- [ ] **Structured logs** (pino) + log shipping (Loki / CloudWatch).
- [ ] **Metrics**: Prometheus endpoint / Grafana dashboard cho cultivation tick, combat, WS conn.
- [ ] **Backup DB daily** + test restore script. Hiện chỉ có `pnpm infra:up` cho dev, chưa có script backup prod.
- [ ] **Refresh token revoke chain logging**: đã có reuse-detection, nhưng chưa expose admin tab xem chain (debug user complaint).

### Nội dung (post-beta polish)
- [ ] Balance 28 realm EXP/drop dựa feedback playtest thực.
- [ ] Thêm dungeon tier cao (`hoa_than`, `luyen_hu`, `hop_the`, `dai_thua`, `do_kiep`). Hiện chỉ 3 dungeon `luyen_khi`/`truc_co`/`kim_dan`.
- [ ] Skill cho realm >= `nhan_tien` (hiện skills chỉ sect-based, chưa realm-based).
- [ ] Full boss list seed theo tier (hiện model + spawn endpoint có, chưa có seed boss-by-tier ngoài runtime admin spawn).
- [ ] 60+ xưng hiệu mốc (`titles.json` doc 05 — chưa wire DB).
- [ ] i18n EN gap audit: grep `t(` keys không có trong `en.json` (`apps/web/src/i18n/en.json`).

### QA + Launch
- [ ] **Runtime smoke tích hợp**: execute `docs/QA_CHECKLIST.md` 13 section trên local hoặc staging (15 phút).
- [x] **Playwright E2E** golden path closed beta core loop (session 9q-7 → 9q-8 → 9r-1, gated CI): **16/16 spec** pass trong ~22–25s — register → 4-step onboarding → /home → cultivate ON/OFF → daily login claim → mission tabs → shop browse disabled-buy → inventory empty → chat WORLD → leaderboard → profile → logout → **shop buy LINH_THACH** (UI) → **inventory equip** (UI) → **mail empty state** → **dungeon list + entry enabled** → **settings page load**. Xem [`QA_CHECKLIST.md`](./QA_CHECKLIST.md) §12. **Defer** (ghi rõ): cultivation breakthrough end-to-end, dungeon enter+clear+loot end-to-end (combat RNG → flaky, defer `smoke:combat`), mail claim attachment (cần admin send → defer `smoke:admin`), inventory use HP pill (fresh char hp full → no observable change), giftcode redeem (cần admin → defer `smoke:admin`). **CI integration (session 9r-1)**: workflow `.github/workflows/e2e-full.yml` chạy gated trên `pull_request` + `push` to main (path filter `apps/web/**` / `apps/api/**` / `packages/shared/**` / `pnpm-lock.yaml` / `package.json`) + `workflow_dispatch` manual. PR docs-only → workflow skip. KHÔNG required mọi PR — workflow chính `ci.yml` (build + e2e-smoke) vẫn là CI bắt buộc; `e2e-full.yml` là layer 2 closed beta regression. Roadmap: sau 2–3 tuần stable → đánh giá upgrade thành required check trong branch protection rules.
- [ ] **Load test** 1000 socket + 500 RPS (k6 / Artillery) — verify BullMQ tick scaling.
- [ ] **A Linh onboarding** bilingual full text (placeholder hiện tại).
- [ ] Terms of Service + Privacy Policy (legal).
- [ ] Discord / community channel.
- [ ] Closed beta 50 user recruitment.
- [ ] Feedback survey form (Google Form / Discord embed).
- [ ] Bug bounty / log channel.

## Phase 9 readiness audit

> Bảng này là **single source of truth** cho trạng thái sẵn sàng closed beta theo từng nhóm gameplay/infra. Update mỗi khi merge PR đụng tới các nhóm tương ứng. Last refresh: session 9r-2 (1/5, after PR #212 merge).
>
> **Status legend**: **DONE** = có ≥ 2 layer test (vitest + (smoke | golden | integration)) hoặc 1 layer + manual smoke gần đây. **PARTIAL** = có vitest nhưng thiếu runtime end-to-end smoke; defer rationale ghi rõ ô "Defer / Risk". **NEEDS RUNTIME SMOKE** = chỉ có vitest, runtime smoke chưa viết, blocker khi Phase 10 expand content liên quan. **NEEDS PROD REVIEW** = chưa wire production-only (Sentry / CSP review / metrics). **BLOCKED** = có P0/P1 issue open.

| # | Nhóm | Status | Vitest | Smoke / Golden / Integration | Defer / Risk |
|---|---|---|---|---|---|
| A | Auth / session / onboarding | **DONE** | `auth.service.test.ts`, `auth.controller.test.ts`, `auth.refresh.test.ts`, `auth.password.test.ts` | smoke:beta step 2-4, golden #2 register UI → 4-step → /home, smoke:ws step 2-3 (cookie auth + setup user) | — |
| B | Character / home | **DONE** | `character.service.test.ts`, `character.controller.test.ts` | smoke:beta step 5-7, golden #3 cultivate toggle ON/OFF (UI label flip + API state cross-check) | — |
| C | Cultivation start / tick / breakthrough | **PARTIAL** | `cultivation.service.test.ts`, `cultivation.processor.test.ts` (BullMQ tick) | start ✅ golden #3, tick ✅ smoke:ws step 16 gated `SMOKE_WAIT_TICK_MS=40000` | **breakthrough**: chỉ vitest. Runtime smoke yêu cầu exp ≥ realm 9 cost (impractical < 30s smoke). Defer `smoke:cultivation` với DB-direct exp inject Phase 9.5 — KHÔNG block Phase 10. |
| D | Dungeon / combat / loot | **DONE** (session 9r-6) | `combat.service.test.ts`, `combat.controller.test.ts` (RNG seeded) | dungeon list ✅ golden #15 (3 dungeon visible + Sơn Cốc enter button enabled, stamina ≥ 10), **`smoke:combat` 18-step session 9r-6** (`scripts/smoke-combat.mjs`) — register → onboard → dungeons list ≥9 → start son_coc → action loop → reward shape WON → INVARIANT SUM(CurrencyLedger) == Character.linhThach + Inventory.qty == SUM(ItemLedger.qtyDelta) per itemKey + COMBAT_LOOT refType=Encounter + character exp/stamina/hp/mp final bound | — |
| E | Inventory / equipment / use item | **DONE** | `inventory.service.test.ts`, `inventory.controller.test.ts` | golden #7 inventory empty state, golden #13 equip UI → equippedSlot WEAPON, smoke:economy step 17 inventory qty == SUM(ItemLedger) | use item HP pill: fresh char hp full → no observable change; defer hoặc test với damaged char. |
| F | Shop / economy / ledger | **DONE** | `shop.service.test.ts`, `currency.service.test.ts`, `logs.controller.test.ts`, `audit-ledger.test.ts` | smoke:economy 20-step `done: 20 pass / 0 fail`, golden #6 browse + #12 buy LINH_THACH UI, audit-ledger.ts read-only verify | — |
| G | Mail / claim attachment | **DONE (HTTP smoke; UI claim — partial)** (session 9r-7) | `mail.service.test.ts` (`Mail.claimedAt IS NULL` invariant) | page load + empty state ✅ golden #14, **`smoke:admin` step 18-22** (`scripts/smoke-admin.mjs`) — admin send mail → player /mail/me → claim attachment (LT +200 + 1× huyet_chi_dan) → MAIL_CLAIM ledger row → duplicate claim → 409 ALREADY_CLAIMED. | UI claim flow trong Playwright golden chưa cover (cần admin send trước thì có mail để click). Defer cho golden #17 hoặc `smoke:admin` v2. |
| H | Mission / daily / weekly | **PARTIAL** | `mission.service.test.ts`, `daily-login.service.test.ts`, `mission-ws.emitter.test.ts` | golden #5 mission tabs render + ≥1 mission visible, golden #4 daily login claim (claimable → claimed transition), smoke:ws step 11-12 mission:progress throttle | **claim mission end-to-end**: chỉ vitest + smoke:ws WS push. Cần wait cultivate ≥ 30s để mission complete → defer hoặc smoke long-mode. KHÔNG block Phase 10. |
| I | Leaderboard / profile / settings | **DONE** | `leaderboard.service.test.ts`, `leaderboard.controller.test.ts`, `next-action.service.test.ts` | golden #9 leaderboard tabs Power/Topup/Sect, #10 profile/:ownId, #16 settings page load | — |
| J | Admin / topup / giftcode | **DONE (giftcode + mail + grant smoke; topup approve/reject — partial)** (session 9r-7) | `admin.service.test.ts`, `admin.controller.test.ts`, `topup.service.test.ts`, `giftcode.service.test.ts`, `giftcode-race.test.ts` (concurrency) | **`smoke:admin` 30-step session 9r-7** (`scripts/smoke-admin.mjs`) — admin login (INITIAL_ADMIN_EMAIL/PASSWORD) → read-only stats/economy/audit-ledger shape → grant +1000/-300 LT → giftcode create + redeem + duplicate-reject → mail send + claim + duplicate-reject → INVARIANT SUM(CurrencyLedger.LINH_THACH ADMIN_GRANT/GIFTCODE_REDEEM/MAIL_CLAIM) == Character.linhThach + Inventory.qty per itemKey == SUM(ItemLedger.qtyDelta) + audit ≥2 user.grant row + giftcode revoke + REVOKED list visible + RBAC player→/admin/* 403. Multi-jar pattern (admin + player jar parallel). | Topup approve/reject smoke flow (cli pay client + topup order create) chưa cover — defer `smoke:topup` hoặc gom vào `smoke:admin` v2. |
| K | WebSocket realtime | **DONE** | `realtime.gateway.test.ts` (14 case unit), `mission-ws.emitter.test.ts` | smoke:ws 19-step (state isolation, broadcast, throttle, reconnect, logout), golden #8 chat WORLD send → render in feed | — |
| L | Playwright full-stack CI | **DONE** | — | workflow `.github/workflows/e2e-full.yml` (PR #212), gated `pull_request`/`push` path-filter + `workflow_dispatch`. **Verified GREEN trên main HEAD `6fd1120`**: run 25203605650, 1m35s tổng, Playwright step 20s với browsers cache hit, 16/16 spec pass | KHÔNG required mọi PR (path-filter gating). Sau 2-3 tuần stable → đánh giá required check. |
| M | Smoke scripts | **DONE** | — | smoke:beta 16-step (`scripts/smoke-beta.mjs`), smoke:economy 20-step (`scripts/smoke-economy.mjs`), smoke:ws 19-step (`scripts/smoke-ws.mjs`), **smoke:combat 18-step (`scripts/smoke-combat.mjs`, session 9r-6)**, **smoke:admin 30-step (`scripts/smoke-admin.mjs`, session 9r-7)**. All gated/manual, KHÔNG vào CI vì cần API + DB + Redis live cùng process (smoke:admin thêm yêu cầu `pnpm --filter @xuantoi/api bootstrap` seed admin trước). | — |
| N | i18n / mobile / PWA | **DONE** | `LocaleSwitcher.test.ts` + 60+ component test có i18n key assertion | vue-i18n VI/EN 16+ view (incl. `activity.*` PR #91), PWA manifest + Workbox precache 47 entries 765 KiB, mobile responsive layout | i18n EN gap audit (grep `t(` keys không có trong `en.json`) deferred — không block beta vì VI default. |
| O | Security / production readiness | **NEEDS PROD REVIEW** | `auth.service.test.ts` JWT prod assert, `auth.refresh.test.ts` reuse-detect, rate-limit Redis cover ở `chat.service.test.ts` + `auth.service.test.ts` | argon2id, JWT prod assert (`apps/api/src/main.ts`), rate-limit register/login Redis, refresh rotation reuse-detect, helmet CSP prod (dev `false`) | **Sentry DSN chưa wire**, structured logs pino chưa wire, Prometheus metrics chưa expose, backup DB daily script chưa có. Listed ở "Recommended trước beta open" — KHÔNG block closed beta 50 user; BẮT BUỘC trước beta open. |

### Phase 10 content scale gate

✅ **ĐỦ điều kiện mở Phase 10 PR-1..5** (items / skills / monsters / missions / boss pack) — verified session 9r-2.

**Phase 10 progress** (session 9r-5):
- **PR-1 Item Pack 1 (DONE — merged #214)**: catalog 31 → 81 item (+50). Stat budget tuân thủ `BALANCE_MODEL.md` §3.3, bound bằng `items-balance.test.ts` (+21 vitest). Pre-gate baseline + post-code re-run trùng khớp.
- **PR-2 Skill Pack 1 (DONE — merged #215)**: catalog 10 → 25 skill (+15) tổ chức theo Ngũ Hành (Kim/Mộc/Thuỷ/Hoả/Thổ × ≥1 active + ≥1 passive) + 1 vô hệ early. SkillDef extend forward-compat (`element`/`type`/`role`/`unlockRealm`/`cooldownTurns`) cho Phase 11 Spiritual Root + Elemental Combat — combat runtime KHÔNG đổi (`element` chỉ là metadata; phase 11.3 sẽ wire `elementMultiplier`). Stat budget tuân thủ `BALANCE_MODEL.md` §4, bound bằng `skills-balance.test.ts` (+26 vitest). FE picker thêm helper `activeSkillsForSect` để loại passive khỏi dropdown.
- **PR-3 Monster & Dungeon Pack 1 (DONE — merged #216)**: monster catalog 9 → 29 (+20) × Ngũ Hành element + MonsterType (BEAST/HUMANOID/SPIRIT/ELITE/BOSS), dungeon catalog 3 → 9 (+6 element-thematic + 1 single-boss endgame `cuu_la_dien`), DUNGEON_LOOT 3 → 9 entries (no orphan), ITEMS 81 → 87 (+6 yêu phù mới wire stable key). MonsterDef + DungeonDef extend forward-compat (`element`/`monsterType`/`regionKey`/`dailyLimit`) cho phase 11.3 elementMultiplier + phase 11.5 DungeonRun service. Stat curve tuân thủ `BALANCE_MODEL.md` §5.1 (hp ≤ 200×level, atk ≤ 25×level, def ≤ 8×level, stamina luyenkhi ≤ 15 / truc_co ≤ 30 / kim_dan ≤ 40 / nguyen_anh ≤ 65), bound bằng `monsters-balance.test.ts` (+23 vitest) + `dungeons-balance.test.ts` (+22 vitest). 4 helper mới: `monstersByElement` / `dungeonsByElement` / `monstersByRegion` / `dungeonsByRegion`.
- **PR-4 Mission Pack 1 (Pending merge — #217)**: mission catalog 12 → 66 (+54) × Ngũ Hành element bonus + chain quest, MissionDef forward-compat (`element`/`regionKey`/`storyChainKey`/`realmTier`). Bound bằng `missions-balance.test.ts` (+27 vitest). CI GREEN.
- **PR-5 Boss Pack 1 (this PR)**: boss catalog 2 → 12 (+10 named boss) × Ngũ Hành (kim/moc/thuy/hoa/tho ≥ 2 boss/element + 1 cross-element endgame `hon_nguyen_yeu_to`) × realm tier kim_dan → nguyen_anh → hoa_than → luyen_hu → hop_the. BossDef extend forward-compat (`level`/`element`/`regionKey`/`monsterType: 'BOSS'`/`lowDropPool`) cho phase 11.3 elementMultiplier + phase 12 BossRewardService pity / share-ratio. Combat / boss runtime KHÔNG đổi (`element` chỉ metadata). Stat budget tuân thủ `BALANCE_MODEL.md` §6.1 (hp ∈ [100k, 5M], atk ∈ [hp/8000, hp/1000], def ≤ atk, baseRewardLinhThach ∈ [hp/8, hp/2]), bound bằng `boss-balance.test.ts` (+28 vitest). Element của boss khớp element của region (consistency với MonsterDef/DungeonDef Phase 10 PR-3). 3 helper mới: `bossesByElement` / `bossesByRegion` / `bossesByRealm`. **Phase 10 Content Scale CLOSE → Phase 11 gate review**.

**Justification**:
1. Mỗi gameplay flow core có ≥ 1 layer test (vitest unit / integration / smoke / golden path).
2. 5 nhóm Partial chỉ thiếu **runtime smoke** chứ KHÔNG thiếu **logic test** (vitest đã cover invariant: ledger SUM, idempotency, double-claim, RNG seeded combat outcome).
3. Không có P0/P1 issue open (`gh issue list --state all` empty 1/5).
4. Baseline **2051 test** stable (+45 từ monsters-balance + dungeons-balance.test.ts session 9r-4 PR-3, +26 từ skills-balance.test.ts session 9r-4 PR-2, +21 items-balance.test.ts session 9r-3 PR-1).
5. CI integration verified GREEN (PR #212 + #214 + #215 5/5 checks pass).

**Pre-gate BẮT BUỘC trước khi mở Phase 10 PR-1**: paste 3 output sau vào PR-1 body để pin baseline:

```bash
pnpm smoke:economy              # expect: done: 20 pass / 0 fail / 20 total
pnpm smoke:ws                   # expect: done: 19 pass / 0 fail / 19 total
E2E_FULL=1 pnpm --filter @xuantoi/web e2e  # expect: 16 passed
```

Nếu bất kỳ smoke nào fail → DỪNG Phase 10, mở PR fix root cause trước.

### Optional Phase 9.5 polish (nice-to-have, không block)

- `smoke:cultivation` — DB-direct exp inject + verify breakthrough event + state:update WS frame.
- ~~`smoke:combat`~~ — DONE session 9r-6 (`scripts/smoke-combat.mjs` 18-step, basic attack RNG end-to-end + ledger invariant + character bound). Future polish: gated long-mode `SMOKE_DUNGEON=hac_lam` cho mid-tier dungeon, hoặc skill-pick loop cho từng Ngũ Hành element.
- ~~`smoke:admin`~~ — DONE session 9r-7 (`scripts/smoke-admin.mjs` 30-step, admin login + grant LT + giftcode create+redeem + mail send+claim + RBAC + ledger invariant). Future polish: thêm `smoke:topup` (cli pay client → topup order create → admin approve/reject) và `smoke:admin` v2 cover MOD role + mail broadcast.

## Cut-line cho closed beta

**Đã đủ điều kiện** (29/4 session 9d):
- [x] Auth/Mission/Mail/Gift code/Daily Login/Leaderboard/Boss/Shop — 100% gameplay loop
- [x] Logs self-view + admin audit
- [x] Backup cron pruning login/refresh/mail
- [x] Rate limit chat + login
- [x] Health check + version endpoint
- [x] Test coverage 557 (api 369 + web 133 + shared 55)

**Recommended trước beta open** (post-closed-beta):
- [ ] M7 CSP review (production deploy)
- [ ] Sentry + structured logs (production observability)
- [ ] Backup DB daily script + restore test
- [x] Playwright E2E golden path closed beta core loop (regression safety net) — gated CI workflow `.github/workflows/e2e-full.yml` (path-filtered + workflow_dispatch manual)
- [ ] Runtime smoke tích hợp 13 section QA_CHECKLIST

**Có thể defer đến sau beta**:
- M10 Shop daily limit (low risk — manual ban nếu lạm dụng)
- PvP cốc đấu
- Reforge/enchant
- Realm-based skills
- Buff/debuff mở rộng
- Higher-tier dungeons
- Achievement system

---

_Last updated: 2026-05-19 — Beta Polish Pack PR (tasks #7-#10)_  
_Cập nhật file này mỗi khi đóng PR lớn liên quan beta readiness._
