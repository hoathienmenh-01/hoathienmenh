# AI Handoff Report — Xuân Tôi

> 👉 **AI/dev mới: ĐỌC [`docs/START_HERE.md`](./START_HERE.md) TRƯỚC.** File đó định tuyến tới đúng doc theo task type (state / vision / roadmap / economy / content / balance / live ops / story).
>
> **Cấu trúc**: file này chỉ chứa **trạng thái live hiện tại** (Executive Summary + Recent Changes + Phase Status + Known Issues + Tests/CI/Smoke + Next Roadmap). **Toàn bộ lịch sử PR cũ** (Snapshots PR #33→#396, Recent Changes Legacy, Completed Features, Project Reference đầy đủ Tech Stack / Architecture / DB / Gameplay / Run Locally / Rules, Old Recommended Next Roadmap, Exact PR Plan, smoke detail table per module) tách ra [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md). **AI mới CHỈ cần đọc file này** — `ARCHIVE_HANDOFF.md` chỉ tra cứu khi cần.
>
> **Cap**: ≤ 250 dòng (HANDOFF REPORT STRUCTURE RULE — xem [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md)). Vượt cap → bắt buộc compact + đẩy entry cũ xuống ARCHIVE.

---

## 1. Current Executive Summary

- **Current `main` commit**: post PR #441 merged (`docs(handoff): sync post PR #440 merged state`) + PR #440 (Phase 12 Story discoverability QuestView dungeon hint) + PR #439 (Story Foundation Late-game encounter wire) + PR #438 (Phase 12.4 per-monster MonsterDef.lootTable polish) + PR #437 (DungeonRun listForUser activeRun fallback + E2E spec #22) + PR #436 (Phase 12.3 DungeonRun per-encounter loot wire) + PR #435 (Phase 12.2.C DungeonRun FE UI) + PR #434 (Phase 12.2.B DungeonTemplate + DungeonRun runtime) + PR #433 (Phase 12 Story Foundation Late-game wire) + PR #432 (Phase 12 Story PR-6 Combat kill hook → quest track). Story design source live tại [`docs/story/`](./story/).
- **Current phase**: Phase 10 **CLOSED** ✅. Phase 11 Progression Depth **COMPLETE** ✅. Phase 11 nâng cao **CLOSED** ✅. Phase 12 World Map & Dungeon **OPEN** — Phase 12.1 catalog **CLOSED** (#397), Phase 12.2.A `DungeonDef.dailyLimit` **CLOSED** ✅ (#421), Phase 12 Story PR-1→PR-6 + Foundation Extension + Late-game wire all **CLOSED** ✅ (#425–#433), **Phase 12.2.B/C/12.3** **CLOSED** ✅ (#434–#436), **E2E spec #22 + listForUser fallback** **CLOSED** ✅ (#437), **Phase 12.4 per-monster MonsterDef.lootTable polish** **CLOSED** ✅ (#438), **Story Foundation Late-game encounter wire** **CLOSED** ✅ (#439), **Phase 12 Story discoverability — QuestView dungeon hint cho kill+monster step** **CLOSED** ✅ (#440), **docs handoff sync post #440** **CLOSED** ✅ (#441), **Phase 12.5 dungeon balance tuning** **CLOSED** ✅ (this PR). Next mở: Concurrency tests phase 2 remainder.
- **In-flight**: this PR (Phase 12.5 dungeon balance tuning).
- **Test baseline (post Phase 12.5 PR)**: api **1975**, shared **1370** (+11 từ Phase 12.5 dungeon-balance test block: 11 invariant cho 8 late-game placeholder), web **1163**, total **4508 vitest**. E2E golden-path **22 spec**. Smoke scripts **28 module**. API/web test count carryover unchanged (shared catalog only — no API/UI runtime change).
- **Top priority next session**: (1) Concurrency tests phase 2 remainder (Cultivation multi-instance lock / Inventory `revoke()` race / Realtime ban during connection); (2) Shop daily limit + rate-limit per user (M10); (3) CSP production verify khi deploy (M7); (4) Phase 12 Story dialogue branch / DungeonTemplate story-instance (optional). Detail §6.
- **Open Critical/High issues**: none. Live medium issues: M7 (CSP production verify khi deploy), M10 (Shop daily limit + rate-limit per user). Detail §4.
- **Blocker**: none.

---

## 2. Recent Changes

10 PR gần nhất merged trên main (newest đầu, mỗi entry 1 dòng). PR cũ hơn → [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Snapshots.

| PR | Title | Type |
|---|---|---|
| this PR | `balance(shared): Phase 12.5 tune late-game story dungeon monsters — stat tuning HP/ATK/DEF/SPD/level + monsterType promotion (HUMANOID→ELITE tich_thien_sat_thu, SPIRIT→ELITE tam_ma_nguyen_anh, HUMANOID→BOSS huyet_anh) + 3 lootTable override Phase 12.4 convention (kim/tho themed equipment + skill_book pity + linh_can_dan rare pity cho huyet_anh BOSS endgame) + 11 invariant test dungeons-balance.test (level range / monsterType / lootTable convention / hp/atk > 0 / SPIRIT def ≤ peer); ky_uc_meo giữ nguyên là story-hard intentional tier gap (Nguyên Anh stat trong Trúc Cơ dungeon moc_huyen_lam, document ở BALANCE_MODEL §5.5)` | medium shared catalog + tests, no API change, no Prisma migration, no UI change |
| [#441](https://github.com/hoathienmenh-01/xuantoi/pull/441) | `docs(handoff): sync post PR #440 merged state — AI_HANDOFF_REPORT.md current main = post PR #440 merged + PHASE12_STORY_PROGRESS QuestView dungeon hint CLOSED ✅ + Recommended Next Roadmap reorder (Phase 12.5 → Concurrency phase 2 → Shop daily limit → CSP)` | docs-only sync |
| [#440](https://github.com/hoathienmenh-01/xuantoi/pull/440) | `feat(shared,web): Phase 12 Story discoverability — QuestView dungeon hint cho kill+monster step (shared helper findDungeonsForQuestPlaceholder resolve dungeon qua direct key match + MonsterDef.questTargetIds alias dedupe theo dungeon.key + FE QuestView.vue render line "📍 Tìm tại: {names}" inline dưới step + i18n vi/en parity quest.stepHint.foundIn + 5 shared test + 4 FE test); UX gap close: player giờ thấy ngay dungeon đi cho mỗi kill+monster step (8 late-game placeholder + 7 PR-6 critical-path) — KHÔNG cần tự tra catalog` | small shared+FE feature + tests, no API change, no Prisma migration |
| [#439](https://github.com/hoathienmenh-01/xuantoi/pull/439) | `feat(shared): Story Foundation Late-game encounter wire — wire 8 placeholder Trúc Cơ/Kim Đan/Nguyên Anh vào 4 dungeon monsters[] (hac_lam +tich_linh_anh/tam_ma_anh, moc_huyen_lam +tich_linh_quy/ky_uc_meo, kim_son_mach +tich_thien_sat_thu, hoang_tho_huyet +tam_ma_nguyen_anh/chap_niem_anh/huyet_anh) + 1 invariant test reachable trong DUNGEONS.monsters[]` | small shared catalog + 1 test, no API/FE change, no Prisma migration |
| [#438](https://github.com/hoathienmenh-01/xuantoi/pull/438) | `feat(shared,api): Phase 12.4 per-monster MonsterDef.lootTable polish — MonsterDef.lootTable?: readonly LootEntry[] (optional override) + rollMonsterLoot(monsterKey, n) helper + DungeonRunService.nextEncounter + CombatService WON paths ưu tiên monster.lootTable trước fallback rollDungeonLoot(dungeon.key, n); seed 5 boss/elite override (1 ELITE kim_dieu_thuong_phong + 4 BOSS thuy_thanh_long_vuong/chu_tuoc_huyet_dieu/tho_dia_lao_tu/cuu_la_huyen_quan) + 13 shared test items-monster-loot + 2 API integration test` | medium shared+api, **no Prisma migration**, **no FE change** |
| [#437](https://github.com/hoathienmenh-01/xuantoi/pull/437) | `fix(api,web): DungeonRun listForUser activeRun fallback COMPLETED+claimedAt=null + E2E spec #22 dungeon-run flow — fix bug FE mất claim button sau khi run COMPLETED (listForUser ưu tiên ACTIVE, fallback COMPLETED unclaimed; CLAIMED/ABANDONED ẩn) + Playwright son_coc start → next×3 → claim verify Phase 12.3 kill log loot span (gate E2E_FULL=1) + 1 BE test` | medium full-stack bugfix + e2e spec, no Prisma migration |
| [#436](https://github.com/hoathienmenh-01/xuantoi/pull/436) | `feat(api,web): Phase 12.3 DungeonRun per-encounter loot wire — wire rollDungeonLoot vào DungeonRunService.nextEncounter (snapshot vào killedEntry.loot + grant fail-soft qua InventoryService.grant reason DUNGEON_LOOT refType DungeonRun) + ItemLedgerReason 'DUNGEON_LOOT' + DungeonRunKilledEntry export + FE formatLoot() resolve itemByKey + i18n dungeonRun.lootedItem + 5 new test (BE 3 + FE 2)` | medium full-stack feature + tests, no Prisma migration |
| [#435](https://github.com/hoathienmenh-01/xuantoi/pull/435) | `feat(web): Phase 12.2.C DungeonRun FE UI — DungeonRunView.vue catalog grid + active run card + claim modal (Pinia store useDungeonRunStore + 4 typed API wrappers + router /dungeon-run + nav AppShell + i18n vi/en parity dungeonRun.* + 31 new test) consume PR #434 endpoints, server-authoritative (FE chỉ render, KHÔNG tự cộng EXP/tiền/item)` | medium FE feature + tests, no BE change, no Prisma migration |
| [#434](https://github.com/hoathienmenh-01/xuantoi/pull/434) | `feat(api,shared): Phase 12.2.B DungeonTemplate + DungeonRun runtime — Prisma DungeonRun model + 4 endpoint (list/start/next/claim) + realm gate + daily limit + ownership + idempotent claim qua CurrencyService.applyTx/InventoryService.grantTx reason DUNGEON_RUN_REWARD + QuestService.track auto-wire khi nextEncounter + 44 unit/controller test + smoke 16 step` | large full-stack feature + Prisma migration `20260521000000_phase_12_2_b_dungeon_run` |
| [#433](https://github.com/hoathienmenh-01/xuantoi/pull/433) | `feat(shared): Phase 12 Story Foundation Late-game wire — 8 monster catalog cho Trúc Cơ/Kim Đan/Nguyên Anh story placeholder + 2 invariant test` | medium shared catalog + tests |
| [#432](https://github.com/hoathienmenh-01/xuantoi/pull/432) | `fix(api,shared): Phase 12 Story PR-6 — Combat kill hook → quest track auto-wire (fix monster.key mismatch with quest placeholder targetId, add MonsterDef.questTargetIds + 7 mappings + 5 integration tests)` | medium full-stack fix + tests, no Prisma migration, no new endpoint, no FE change |



**Phase summary tables (PR #1 → #396) + smoke detail per-module + PR #414/#415 + PR #430 entries**: tách sang [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Phase Summary Migrated 2026-05-05 + § Smoke Detail Migrated 2026-05-05.

---

## 3. Current Phase Status

| Phase | Title | Status | Note |
|---|---|---|---|
| 0–8 | Foundation: schema + auth + core gameplay | **Done** ✅ | Full feature catalog ở [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Completed Features. |
| 9 | Beta readiness (Phase 9.A→9.E sub-phases polish) | **11/15 Done, 3 Partial** | Detail [`BETA_CHECKLIST.md`](./BETA_CHECKLIST.md). Mail UI gap closed by PR #391. |
| 10 | Content scale | **5/5 CLOSED** ✅ | All sub-tracks merged. |
| 11 | Progression Depth | **catalog 11/11 + runtime 10/10 + UI merged** | Phase 11 nâng cao (§2/§3/§5/§6 + 11.6.C/D/E + 11.1.E) tất cả CLOSED. |
| 11.X | UI E2E smoke Playwright | **DONE** | Spec #19 talent learn→cast→cooldown + #20 breakthrough flow merged via #394/#420. |
| 12 | World Map & Dungeon | **OPEN** | 12.1 catalog CLOSED (#397). 12.2.A `dailyLimit` enforcement CLOSED (#421). Story PR-1→PR-6 + Foundation Extension + Late-game wire CLOSED (#425–#433). **12.2.B/C + 12.3** CLOSED ✅ (#434–#436). **E2E spec #22 dungeon-run flow** CLOSED ✅ (#437). **12.4 per-monster `MonsterDef.lootTable` polish** CLOSED ✅ (#438). **Story Foundation Late-game encounter wire** CLOSED ✅ (#439). **Story discoverability — QuestView dungeon hint cho kill+monster step** CLOSED ✅ (#440). **docs handoff sync** CLOSED ✅ (#441). **12.5 dungeon balance tuning — 8 late-game story monster stat + lootTable** CLOSED ✅ (this PR). Next: optional dialogue branch / DungeonTemplate story-instance. |
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

### Vitest baseline (post PR #440 merged)

| Workspace | Test count | Notes |
|---|---|---|
| `apps/api` | **1975** | Carryover từ PR #438 (Phase 12.5 shared catalog only — không thay đổi api test). |
| `packages/shared` | **1370** | +11 từ Phase 12.5 (`dungeons-balance.test` block "Phase 12.5 late-game story monster balance" — invariant level range / monsterType / lootTable convention / hp/atk > 0 / SPIRIT def ≤ peer / huyet_anh BOSS hardest / sat_thu burst-glass). +5 carryover từ #440. |
| `apps/web` | **1163** | Carryover từ PR #440 (Phase 12.5 shared catalog only — không thay đổi UI test). |
| **Total** | **4508 vitest** | All green local. **GitHub CI runners**: verify khi PR push. |

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

1. **Concurrency tests phase 2** — Small-Medium PR, Template B per scenario. Inventory `use()` race FIXED via PR #422. Còn lại: Cultivation multi-instance lock (Redis lease — BullMQ Worker đã handle nhưng cần test backstop), Chat Redis failover branch, Boss spawn cron auto, Realtime ban during connection, Inventory `revoke()` similar JS-capture race (admin-only — `findMany` → for-loop delete không có atomic guard giữa 2 admin call song song). Mỗi scenario ~50-150 LOC test.

2. **Shop daily limit + rate-limit per user** (M10) — Medium PR, Template C. Add `dailyLimit` config trong shop catalog + rate-limit redis key. Defer post-beta. **Note**: `startOfLocalDay` helper từ PR #421 đã reusable — shop có thể import lại thay vì duplicate.

3. **CSP production verify** (M7) — Hotfix khi deploy production. Test `script-src` / `connect-src` với CDN domain khác.

4. **Phase 12 Story dialogue branch / DungeonTemplate story-instance** (optional, Medium-Large PR) — 8 placeholder kill milestone hiện có stat tuned (Phase 12.5) nhưng không có dialogue branch sau kill; hoặc tạo `DungeonTemplate` story-instance tách biệt từ farm dungeon (instance riêng → boss-rush single-shot). Defer tới khi Story PR-7 plan.

### Phase 12 Story chain status

Design source ở [`docs/story/TU_TIEN_LO_STORY_BIBLE.md`](./story/TU_TIEN_LO_STORY_BIBLE.md) + [`docs/story/PHASE12_STORY_PROGRESS.md`](./story/PHASE12_STORY_PROGRESS.md). 5-PR core roadmap + Foundation Late-game wire + encounter wire + discoverability hint **all CLOSED** ✅:

- **PR-1** → **PR-6** — Catalog foundation, Quest runtime, Claim, NPC dialogue UI, Chapter 1 playable, Combat kill hook. **CLOSED** ✅ (#425–#432).
- **Foundation Late-game wire** — 8 monster catalog (`tich_linh_anh`, `tam_ma_anh`, `tich_linh_quy`, `tich_thien_sat_thu`, `tam_ma_nguyen_anh`, `chap_niem_anh`, `ky_uc_meo`, `huyet_anh`). **CLOSED** ✅ (#433).
- **Foundation Late-game encounter wire** — wire 8 placeholder vào 4 dungeon `monsters[]`. **CLOSED** ✅ (#439).
- **QuestView dungeon hint** — close discoverability gap. **CLOSED** ✅ (#440).
- **Phase 12.5 dungeon balance tuning** — stat HP/ATK/DEF/SPD/level + monsterType promotion (3 ELITE/BOSS) + 3 lootTable override + 11 invariant test. **CLOSED** ✅ (this PR).

Next nâng cao Phase 12 Story (optional, nếu cần): thêm dialogue branch cho 8 placeholder kill milestone HOẶC tạo `DungeonTemplate` story-instance tách biệt từ farm dungeon (instance riêng → boss-rush single-shot). Sau mỗi PR Phase 12 Story merged, AI **bắt buộc** cập nhật `docs/story/PHASE12_STORY_PROGRESS.md` trong cùng PR (DOCS UPDATE RULE).

### Backlog (low priority)

- **Doc compaction maintenance**: khi Recent Changes vượt 10 entry → đẩy entry cũ nhất xuống ARCHIVE § Recent Changes Legacy. Khi `AI_HANDOFF_REPORT.md` vượt **250 dòng** → compact ngay theo HANDOFF REPORT STRUCTURE RULE (cap mới 2026-05-05).
- **Concurrency tests phase 2 (low priority remainder)**: Inventory `revoke()` similar JS-capture race (admin-only).

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
