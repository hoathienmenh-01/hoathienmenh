# AI Handoff Report — Xuân Tôi

> 👉 **AI/dev mới: ĐỌC [`docs/START_HERE.md`](./START_HERE.md) TRƯỚC.** File đó định tuyến tới đúng doc theo task type (state / vision / roadmap / economy / content / balance / live ops / story).
>
> **Cấu trúc**: file này chỉ chứa **trạng thái live hiện tại** (Executive Summary + Recent Changes + Phase Status + Known Issues + Tests/CI/Smoke + Next Roadmap). **Toàn bộ lịch sử PR cũ** (Snapshots PR #33→#396, Recent Changes Legacy, Completed Features, Project Reference đầy đủ Tech Stack / Architecture / DB / Gameplay / Run Locally / Rules, Old Recommended Next Roadmap, Exact PR Plan, smoke detail table per module) tách ra [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md). **AI mới CHỈ cần đọc file này** — `ARCHIVE_HANDOFF.md` chỉ tra cứu khi cần.
>
> **Cap**: ≤ 250 dòng (HANDOFF REPORT STRUCTURE RULE — xem [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md)). Vượt cap → bắt buộc compact + đẩy entry cũ xuống ARCHIVE.

---

## 1. Current Executive Summary

- **Current `main` commit**: post PR #432 merged (`fix(api,shared): Phase 12 Story PR-6 — Combat kill hook → quest track auto-wire`) + PR #431 (Phase 12 Story PR-5 Main storyline Chapter 1 playable) + PR #430 (Phase 12 Story Runtime MVP QuestView UI) + PR #429 (Phase 12 Story Foundation Extension Kim Đan + Nguyên Anh catalog) + PR #428 (Phase 12 PR-4 NPC dialogue UI) + PR #427 (Phase 12 PR-3 Quest claim) + PR #426 (Phase 12 PR-2 Quest runtime persistence) + PR #425 (Phase 12 PR-1 catalog foundation). Story design source live tại [`docs/story/`](./story/).
- **Current phase**: Phase 10 **CLOSED** ✅. Phase 11 Progression Depth **COMPLETE** ✅. Phase 11 nâng cao **CLOSED** ✅. Phase 12 World Map & Dungeon **OPEN** — Phase 12.1 catalog **CLOSED** (#397), Phase 12.2.A `DungeonDef.dailyLimit` **CLOSED** ✅ (#421), **Phase 12 Story PR-1** catalog **CLOSED** ✅ (#425), **Phase 12 Story PR-2** Quest runtime persistence **CLOSED** ✅ (#426), **Phase 12 Story PR-3** Quest claim/reward idempotency **CLOSED** ✅ (#427), **Phase 12 Story PR-4** NPC dialogue UI **CLOSED** ✅ (#428), **Phase 12 Story Foundation Extension** Kim Đan + Nguyên Anh catalog **CLOSED** ✅ (#429), **Phase 12 Story Runtime MVP** Quest UI **CLOSED** ✅ (#430), **Phase 12 Story PR-5 Main storyline Chapter 1 playable** **CLOSED** ✅ (#431), **Phase 12 Story PR-6 Combat kill hook → quest auto-track** **CLOSED** ✅ (#432). **Phase 12 Story Foundation Late-game wire** (8 placeholder Trúc Cơ/Kim Đan/Nguyên Anh main+sect+realm+npc quest → MonsterDef.key match) **OPEN** via this PR.
- **In-flight**: this PR = Phase 12 Story Foundation Late-game wire. **Context**: PR-6 wire 7 critical-path placeholder qua `MonsterDef.questTargetIds` alias trên monster đã có sẵn. 8 placeholder còn lại (`tich_linh_anh`, `tam_ma_anh`, `tich_linh_quy`, `tich_thien_sat_thu`, `tam_ma_nguyen_anh`, `chap_niem_anh`, `ky_uc_meo`, `huyet_anh`) là **entity riêng** (linh ảnh / tâm ma / sát thủ tâm cảnh) — không có monster đã có sẵn để alias. **Shared**: thêm 8 `MonsterDef` mới (`MONSTERS.length` 36 → 44) với `key` match thẳng placeholder + stat curve theo SPIRIT/HUMANOID tier mid (BALANCE_MODEL §5.1: Trúc Cơ lvl 5-7 / Kim Đan lvl 11 / Nguyên Anh lvl 14-15) + region map (`hac_lam` × 2, `moc_huyen_lam` × 2, `kim_son_mach` × 1, `hoang_tho_huyet` × 3) + 2 invariant test mới (orphan-free `kill+monster` step + late-game key-match shape) + cập nhật critical-path test scope từ 7 → 15 placeholder. **API**: KHÔNG đổi runtime — kill hook PR-6 đã đúng pattern (loop `[monster.key, ...questTargetIds]`), chỉ thêm catalog đủ để `monster.key === placeholder` resolve trực tiếp. **No Prisma migration**, **no new endpoint**, **no FE change**.
- **Test baseline (post Story Foundation Late-game wire)**: api **1925** (unchanged — runtime không đổi), shared **1335** (+2 invariant orphan-free + late-game key-match), web **1126**, total **4386 vitest**. E2E golden-path **21/21 spec** unchanged. Smoke scripts **27 module**. CI expected GREEN.
- **Top priority next session**: (1) Phase 12.2.B DungeonTemplate + DungeonRun runtime (Medium-Large, **Prisma**); (2) Add 8 late-game monster vào dungeon/encounter để player thực tế có thể kill (Small-Medium catalog — extend `son_coc`/`hac_lam`/`moc_huyen_lam`/`kim_son_mach`/`hoang_tho_huyet` monsters[] với boss/elite mới hoặc thêm dungeon mới); (3) smoke:daily-login multi-day positive (Small); (4) Concurrency tests phase 2 backlog. Detail §6.
- **Open Critical/High issues**: none. Live medium issues: M7 (CSP production verify khi deploy), M10 (Shop daily limit + rate-limit per user). Detail §4.
- **Blocker**: none.

---

## 2. Recent Changes

10 PR gần nhất merged trên main (newest đầu, mỗi entry 1 dòng). PR cũ hơn → [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Snapshots.

| PR | Title | Type |
|---|---|---|
| **this PR** | `feat(shared): Phase 12 Story Foundation Late-game wire — 8 monster catalog entries cho Trúc Cơ/Kim Đan/Nguyên Anh story placeholder (tich_linh_anh / tam_ma_anh / tich_linh_quy / tich_thien_sat_thu / tam_ma_nguyen_anh / chap_niem_anh / ky_uc_meo / huyet_anh) + 2 invariant test (orphan-free + late-game key-match) + critical-path test scope 7→15` | medium shared catalog + tests, **no runtime change**, **no Prisma migration**, **no FE change** |
| [#432](https://github.com/hoathienmenh-01/xuantoi/pull/432) | `fix(api,shared): Phase 12 Story PR-6 — Combat kill hook → quest track auto-wire (fix monster.key mismatch with quest placeholder targetId, add MonsterDef.questTargetIds + 7 mappings + 5 integration tests)` | medium full-stack fix + tests, no Prisma migration, no new endpoint, no FE change |
| [#431](https://github.com/hoathienmenh-01/xuantoi/pull/431) | `feat(api,web): Phase 12 Story PR-5 — Main storyline Chapter 1 playable (phamnhan_main_01 end-to-end accept → progress → claim, admin quest-track endpoint + E2E golden-path)` | medium full-stack feature + tests, **no Prisma migration**, **no new player endpoint** |
| [#430](https://github.com/hoathienmenh-01/xuantoi/pull/430) | `feat(web): Phase 12 Story Runtime MVP — QuestView.vue list + filter + accept/claim UI (Pinia store useQuestStore + 3 typed API wrappers + router /quests + nav AppShell + i18n vi/en parity + 25 new test) consume PR-2/3 endpoints, server-authoritative` | medium FE feature + tests |
| [#429](https://github.com/hoathienmenh-01/xuantoi/pull/429) | `feat(shared): Phase 12 Story Foundation Extension — Kim Đan + Nguyên Anh catalog (+10 quest + 1 NPC Huyết La Sát + 5 dialogue line + integrity test for chain hoa_thien_main 5 cảnh giới + moc_thanh_y_arc 3 step + huyet_la_sat_arc mới + main exp scaling)` | small shared catalog + tests, KHÔNG runtime change |
| [#428](https://github.com/hoathienmenh-01/xuantoi/pull/428) | `feat(web,api): Phase 12 PR-4 — NPC dialogue UI (NpcModule server-authoritative branch picker realm_min + quest_status + faction_member placeholder + choice quest status annotation; FE NpcView + NpcDialogueModal + Pinia store + i18n vi/en + smoke:npc 11 step + 45 new test)` | medium FE+BE feature + tests |
| [#427](https://github.com/hoathienmenh-01/xuantoi/pull/427) | `feat(api): Phase 12 PR-3 — Quest claim / reward idempotency (QuestService.claim qua CurrencyService.applyTx + InventoryService.grantTx + CAS guard claimedAt + concurrency test 2 parallel claim → 1 winner + smoke +4 step + 15 new test)` | medium BE feature + tests |
| [#426](https://github.com/hoathienmenh-01/xuantoi/pull/426) | `feat(api): Phase 12 PR-2 — Quest runtime persistence (QuestProgress Prisma + QuestService list/accept/progress/track + 3 endpoints + CombatService kill hook + 41 unit/controller test + smoke:quest 16 step)` | medium BE feature + Prisma migration |
| [#425](https://github.com/hoathienmenh-01/xuantoi/pull/425) | `feat(shared): Phase 12 PR-1 — Story/NPC/Quest catalog foundation (15 quest + 4 NPC + 6 dialogue + 45 integrity test cho 3 cảnh giới đầu)` | medium shared catalog + tests |
| [#424](https://github.com/hoathienmenh-01/xuantoi/pull/424) | `docs(ai): compact handoff and add task-based docs navigation` — `AI_HANDOFF_REPORT.md` 217→159 + START_HERE 3-tier nav + cap 250 dòng + DOCS-ONLY PR EXCEPTION clause | docs only |



**Phase summary tables (PR #1 → #396) + smoke detail per-module + PR #414/#415**: tách sang [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Phase Summary Migrated 2026-05-05 + § Smoke Detail Migrated 2026-05-05.

---

## 3. Current Phase Status

| Phase | Title | Status | Note |
|---|---|---|---|
| 0–8 | Foundation: schema + auth + core gameplay | **Done** ✅ | Full feature catalog ở [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Completed Features. |
| 9 | Beta readiness (Phase 9.A→9.E sub-phases polish) | **11/15 Done, 3 Partial** | Detail [`BETA_CHECKLIST.md`](./BETA_CHECKLIST.md). Mail UI gap closed by PR #391. |
| 10 | Content scale | **5/5 CLOSED** ✅ | All sub-tracks merged. |
| 11 | Progression Depth | **catalog 11/11 + runtime 10/10 + UI merged** | Phase 11 nâng cao (§2/§3/§5/§6 + 11.6.C/D/E + 11.1.E) tất cả CLOSED. |
| 11.X | UI E2E smoke Playwright | **DONE** | Spec #19 talent learn→cast→cooldown + #20 breakthrough flow merged via #394/#420. |
| 12 | World Map & Dungeon | **OPEN** | 12.1 catalog CLOSED (#397). 12.2.A `dailyLimit` enforcement CLOSED (#421). 12.2.B DungeonTemplate runtime is next. Story design source archived (#423). Story PR-1 catalog (#425) + PR-2 runtime (#426) + PR-3 claim (#427) + PR-4 NPC UI (#428) + Foundation Extension (#429) + Runtime MVP UI (#430) + PR-5 Chapter 1 playable (#431) + PR-6 Combat kill hook → quest auto-track (#432) CLOSED. **Story Foundation Late-game wire** OPEN (this PR — 8 monster catalog cho 8 placeholder Trúc Cơ/Kim Đan/Nguyên Anh story chưa wire qua PR-6 alias; key match thẳng + 2 invariant test). Phase 12.2.B DungeonTemplate runtime next priority. |
| 13+ | Real-time PvP / pet gacha / voice / streaming | **Not started** | Per [`LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md) §0 — explicitly DO NOT build yet. |

**Smoke coverage**: 27 module (~15 step avg, +`smoke:quest` 20 step PR-3, +`smoke:npc` 11 step PR-4). 8 module có cả negative + positive path: skill / shop / mail / inventory / spiritual-root / breakthrough / auth / cultivation-method. Defer: daily-login multi-day positive (cần admin advance-day). Full per-module step count + endpoint coverage → [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Smoke Detail Migrated 2026-05-05.

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

### Vitest baseline (post Phase 12 PR-2 merged)

| Workspace | Test count | Notes |
|---|---|---|
| `apps/api` | **1866** | +41 từ Phase 12 PR-2 (`quest.service.test.ts` 22 + `quest.controller.test.ts` 19). 1 flaky pre-existing chat rate-limit timing test (50ms sliding window) passes on retry. |
| `packages/shared` | **1321** | Carryover từ PR #425 (Phase 12 PR-1). |
| `apps/web` | **1082** | Carryover từ PR #419. |
| **Total** | **4269 vitest** | All green trên main. |

### CI

- Workflow `.github/workflows/ci.yml`: `build` + `e2e-smoke` jobs (PG+Redis services). Chạy mỗi PR + push (no path filter — docs-only PR vẫn trigger CI). Yêu cầu xanh trước khi merge.
- 5 redis-dependent test (rate-limiter + health controller) cần Redis local — pass khi Redis container up.

### Smoke Scripts (manual, không nằm CI matrix)

26 smoke scripts, ~15 step avg. Yêu cầu local stack: `pnpm infra:up` + `pnpm --filter @xuantoi/api exec prisma migrate deploy` + `pnpm --filter @xuantoi/api run bootstrap` + `pnpm --filter @xuantoi/api dev`. Module list: achievement, admin, auth, beta, boss, breakthrough, chat, combat, cultivation, cultivation-method, daily-login, economy, giftcode, inventory, leaderboard, mail, market, mission, next-action, **quest** (Phase 12 PR-2 — 16/16 step, negative-path heavy), sect, shop, skill, spiritual-root, topup, ws.

**Positive-path coverage** (8 module): skill (PR #388/#390), shop (#390), mail (#391), inventory (#385), spiritual-root (#386), breakthrough (#417), auth (#384), cultivation-method (#394). Còn defer: daily-login multi-day positive — pending admin advance-day endpoint hoặc service helper extension.

**Per-module detail table** (step count, negative/positive flag, notes) → [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Smoke Detail Migrated 2026-05-05.

### E2E (Playwright)

- `apps/web/e2e/golden.spec.ts` — 20 spec golden path (auth smoke + 19 full-stack gated `E2E_FULL=1`). Notable: #19 talent learn→cast→cooldown badge (`golden.spec.ts:756-845`), #20 breakthrough attempt → outcome banner + history reload-persist (`golden.spec.ts:895-981`).
- CI job `e2e-smoke`: chạy spec #1 AuthView smoke mỗi PR (matrix postgres+redis, build api+web, `E2E_SMOKE=1`).
- `E2E_FULL=1` gate cho 19 full-stack spec **chưa wire CI** — runtime manual với `pnpm infra:up` + `pnpm --filter @xuantoi/api dev` + `pnpm --filter @xuantoi/web dev`.

---

## 6. Recommended Next Roadmap

Per [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md) §SESSION PR LIMIT (1-3 PR/session) + §GOM TRƯỚC KHI TÁCH 4b. Ưu tiên Medium PR > Hotfix > Large.

### Top priority — next session

1. **Phase 12.2.B DungeonTemplate + DungeonRun runtime** — Medium-Large PR, Template C (Prisma + service). Prisma model `DungeonTemplate` + `DungeonRun` + service `startRun` / `nextEncounter` / `claimRun` happy-path + Prisma migration. **Risk**: Prisma migration + new module — yêu cầu pre-migration backup snapshot + smoke:dungeon-template extend ≥ 12 step. Phase 12.2.A daily limit enforcement đã land qua PR #421 — `dailyLimit` invariant sẽ apply cho `DungeonRun.startRun()` reuse cùng `startOfLocalDay` helper.

2. **Phase 12 Story chain** — design source ở [`docs/story/TU_TIEN_LO_STORY_BIBLE.md`](./story/TU_TIEN_LO_STORY_BIBLE.md) + [`docs/story/PHASE12_STORY_PROGRESS.md`](./story/PHASE12_STORY_PROGRESS.md). 5-PR core roadmap **CLOSED** ✅, hỗ trợ Foundation Late-game wire continues:
   - **PR-1** — Story/NPC/Quest catalog foundation (15 quest + 4 NPC + 6 dialogue cho 3 cảnh giới đầu). **CLOSED** ✅ (#425).
   - **PR-2** — Quest runtime persistence (Prisma `QuestProgress` + `Character.storyChapter` + `QuestService.list/accept/progress/track` + 3 endpoints + CombatService kill hook). **CLOSED** ✅ (#426).
   - **PR-3** — Quest claim / reward idempotency (`QuestService.claim` qua `CurrencyService.applyTx` + `InventoryService.grantTx` + CAS guard `QuestProgress.claimedAt` + concurrency test). **CLOSED** ✅ (#427).
   - **PR-4** — NPC dialogue UI (`NpcModule` 2 endpoint + server-authoritative branch picker + `NpcView.vue` + `NpcDialogueModal.vue` + Pinia store + i18n + 45 test + smoke:npc). **CLOSED** ✅ (#428).
   - **PR-5** — Main storyline Chapter 1 playable (`phamnhan_main_01` end-to-end + `QuestView.vue` list + E2E spec golden-path). **CLOSED** ✅ (#431).
   - **PR-6** — Combat kill hook → quest track auto-wire (`MonsterDef.questTargetIds` alias + 7 monster mapping critical-path). **CLOSED** ✅ (#432).
   - **Foundation Late-game wire** — 8 monster catalog (`tich_linh_anh` / `tam_ma_anh` / `tich_linh_quy` / `tich_thien_sat_thu` / `tam_ma_nguyen_anh` / `chap_niem_anh` / `ky_uc_meo` / `huyet_anh`) cho Trúc Cơ/Kim Đan/Nguyên Anh story placeholder + 2 invariant test (orphan-free + late-game key-match). **OPEN** (this PR).

   Next sau Foundation Late-game wire merged: thêm 8 monster mới vào dungeon/encounter để player thực tế kill được (story-driven encounter spawn hoặc `son_coc`/`hac_lam`/`moc_huyen_lam`/`kim_son_mach`/`hoang_tho_huyet` extension). Sau mỗi PR Phase 12 Story merged, AI **bắt buộc** cập nhật `docs/story/PHASE12_STORY_PROGRESS.md` trong cùng PR (DOCS UPDATE RULE).

3. **smoke:daily-login multi-day positive** — Small PR, Template B. Cần admin advance-day hoặc set-streak (Prisma migration nhỏ thêm field hoặc service helper). Verify streak=7 reward = 100 LT delta + ledger DAILY_LOGIN_CLAIM.

4. **Concurrency tests phase 2** — Small-Medium PR, Template B per scenario. Inventory `use()` race FIXED via PR #422. Còn lại: Cultivation multi-instance lock (Redis lease), Chat Redis failover branch, Boss spawn cron auto, Realtime ban during connection, Inventory `revoke()` similar JS-capture race (admin-only, low). Mỗi scenario ~50-150 LOC test.

5. **CSP production verify** (M7) — Hotfix khi deploy production. Test `script-src` / `connect-src` với CDN domain khác.

6. **Shop daily limit + rate-limit per user** (M10) — Medium PR, Template C. Add `dailyLimit` config trong shop catalog + rate-limit redis key. Defer post-beta. **Note**: `startOfLocalDay` helper từ PR #421 đã reusable — shop có thể import lại thay vì duplicate.

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
