# AI Handoff Report — Xuân Tôi

> 👉 **AI/dev mới: ĐỌC [`docs/START_HERE.md`](./START_HERE.md) TRƯỚC.** File đó định tuyến tới đúng doc theo task type (state / vision / roadmap / economy / content / balance / live ops / story).
>
> **Cấu trúc**: file này chỉ chứa **trạng thái live hiện tại** (Executive Summary + Recent Changes + Phase Status + Known Issues + Tests/CI/Smoke + Next Roadmap). **Toàn bộ lịch sử PR cũ** (Snapshots PR #33→#396, Recent Changes Legacy, Completed Features, Project Reference đầy đủ Tech Stack / Architecture / DB / Gameplay / Run Locally / Rules, Old Recommended Next Roadmap, Exact PR Plan, smoke detail table per module) tách ra [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md). **AI mới CHỈ cần đọc file này** — `ARCHIVE_HANDOFF.md` chỉ tra cứu khi cần.
>
> **Cap**: ≤ 250 dòng (HANDOFF REPORT STRUCTURE RULE — xem [`AI_WORKFLOW_RULES.md`](./AI_WORKFLOW_RULES.md)). Vượt cap → bắt buộc compact + đẩy entry cũ xuống ARCHIVE.

---

## 1. Current Executive Summary

- **Current `main` commit**: post PR #436 merged (`feat(api,web): Phase 12.3 DungeonRun per-encounter loot wire` — wire `rollDungeonLoot` vào `nextEncounter` + ItemLedgerReason `DUNGEON_LOOT` + FE kill log loot render + 5 test) + PR #435 (Phase 12.2.C DungeonRun FE UI) + PR #434 (Phase 12.2.B DungeonTemplate + DungeonRun runtime) + PR #433 (Phase 12 Story Foundation Late-game wire) + PR #432 (Phase 12 Story PR-6 Combat kill hook → quest track) + PR #431 (Phase 12 Story PR-5 Chapter 1 playable) + PR #430 (Phase 12 Story Runtime MVP QuestView UI) + PR #429 (Foundation Extension Kim Đan + Nguyên Anh catalog) + PR #428 (PR-4 NPC dialogue UI) + PR #427 (PR-3 Quest claim) + PR #426 (PR-2 Quest runtime persistence). Story design source live tại [`docs/story/`](./story/).
- **Current phase**: Phase 10 **CLOSED** ✅. Phase 11 Progression Depth **COMPLETE** ✅. Phase 11 nâng cao **CLOSED** ✅. Phase 12 World Map & Dungeon **OPEN** — Phase 12.1 catalog **CLOSED** (#397), Phase 12.2.A `DungeonDef.dailyLimit` **CLOSED** ✅ (#421), Phase 12 Story PR-1→PR-6 + Foundation Extension + Late-game wire all **CLOSED** ✅ (#425–#433), **Phase 12.2.B DungeonTemplate + DungeonRun runtime** **CLOSED** ✅ (#434), **Phase 12.2.C DungeonRun FE UI** **CLOSED** ✅ (#435), **Phase 12.3 DungeonRun per-encounter loot wire** **CLOSED** ✅ (#436). **E2E spec #22 dungeon-run flow** (this PR) **OPEN**.
- **In-flight**: this PR = E2E spec #22 dungeon-run flow + BE bugfix `listForUser` activeRun fallback COMPLETED (Medium). **Context**: PR #436 đã wire per-encounter loot drop BE + FE render. Khi append Playwright spec #22 để verify full flow từ UI (start → next×3 → claim) thì lộ ra bug ngầm: `DungeonRunService.listForUser` chỉ filter `status: ACTIVE` → sau next() cuối cùng flips run sang COMPLETED → store `load()` reload list → `activeRun = null` → kill log + claim button biến mất khỏi UI → player KHÔNG thể click claim qua FE (chỉ reward được nếu gọi API trực tiếp). Phase 12.2.C unit test bypass listForUser nên không catch lỗi này; spec #22 E2E full-stack mới catch ra. **Fix**: `listForUser` priority ACTIVE → fallback COMPLETED + `claimedAt = null`; CLAIMED/ABANDONED runs vẫn KHÔNG return (đã đóng vòng đời). FE/store/UI code KHÔNG đổi — chỉ BE response shape mở rộng. **E2E spec**: Playwright golden-path: register → onboard → navigate `/dungeon-run` → click `dungeon-run-start-son_coc` → next×3 (verify kill log loot span hiển thị) → status COMPLETED → click `dungeon-run-claim` → modal hiển thị reward (linhThach 50 + exp 100 + huyet_chi_dan ×1) → cross-check `/api/character/me` linhThach delta = 50 + `/api/inventory` huyet_chi_dan qty ≥ 1. Verify Phase 12.3 invariant: kill log loot span data-testid `dungeon-run-killed-{i}-loot` chỉ hiển thị sau next() khi `killedEntry.loot.length > 0`. Spec gate `E2E_FULL=1`.
- **Test baseline (post #22 spec + listForUser fix)**: api **1973** (+1 từ 1972 — listForUser COMPLETED fallback test), shared **1340** unchanged, web **1159** unchanged, total **4472 vitest**. E2E golden-path **22 spec** (+1 từ 21). Smoke scripts **28 module** unchanged. Local verification PASS (api typecheck + lint + dungeon-run.service.test 25/25).
- **Top priority next session**: (1) Phase 12.4 — Per-monster `MonsterDef.lootTable` polish (override `DUNGEON_LOOT[dungeon.key]` cho boss/elite mới); (2) Sửa GitHub Actions runners (infrastructure) — wire `E2E_FULL=1` matrix sau khi CI runners healthy; (3) smoke:daily-login multi-day positive (Small). Detail §6.
- **Open Critical/High issues**: none. Live medium issues: M7 (CSP production verify khi deploy), M10 (Shop daily limit + rate-limit per user). Detail §4.
- **Blocker**: none.

---

## 2. Recent Changes

10 PR gần nhất merged trên main (newest đầu, mỗi entry 1 dòng). PR cũ hơn → [`ARCHIVE_HANDOFF.md`](./ARCHIVE_HANDOFF.md) § Snapshots.

| PR | Title | Type |
|---|---|---|
| **this PR** | `fix(api,web): DungeonRun listForUser activeRun fallback COMPLETED+claimedAt=null + E2E spec #22 dungeon-run flow — fix bug FE mất claim button sau khi run COMPLETED (listForUser ưu tiên ACTIVE, fallback COMPLETED unclaimed; CLAIMED/ABANDONED ẩn) + Playwright son_coc start → next×3 → claim verify Phase 12.3 kill log loot span (gate E2E_FULL=1) + 1 BE test` | medium full-stack bugfix + e2e spec, **no Prisma migration** |
| [#436](https://github.com/hoathienmenh-01/xuantoi/pull/436) | `feat(api,web): Phase 12.3 DungeonRun per-encounter loot wire — wire rollDungeonLoot vào DungeonRunService.nextEncounter (snapshot vào killedEntry.loot + grant fail-soft qua InventoryService.grant reason DUNGEON_LOOT refType DungeonRun) + ItemLedgerReason 'DUNGEON_LOOT' + DungeonRunKilledEntry export + FE formatLoot() resolve itemByKey + i18n dungeonRun.lootedItem + 5 new test (BE 3 + FE 2)` | medium full-stack feature + tests, no Prisma migration |
| [#435](https://github.com/hoathienmenh-01/xuantoi/pull/435) | `feat(web): Phase 12.2.C DungeonRun FE UI — DungeonRunView.vue catalog grid + active run card + claim modal (Pinia store useDungeonRunStore + 4 typed API wrappers + router /dungeon-run + nav AppShell + i18n vi/en parity dungeonRun.* + 31 new test) consume PR #434 endpoints, server-authoritative (FE chỉ render, KHÔNG tự cộng EXP/tiền/item)` | medium FE feature + tests, no BE change, no Prisma migration |
| [#434](https://github.com/hoathienmenh-01/xuantoi/pull/434) | `feat(api,shared): Phase 12.2.B DungeonTemplate + DungeonRun runtime — Prisma DungeonRun model + 4 endpoint (list/start/next/claim) + realm gate + daily limit + ownership + idempotent claim qua CurrencyService.applyTx/InventoryService.grantTx reason DUNGEON_RUN_REWARD + QuestService.track auto-wire khi nextEncounter + 44 unit/controller test + smoke 16 step` | large full-stack feature + Prisma migration `20260521000000_phase_12_2_b_dungeon_run` |
| [#433](https://github.com/hoathienmenh-01/xuantoi/pull/433) | `feat(shared): Phase 12 Story Foundation Late-game wire — 8 monster catalog cho Trúc Cơ/Kim Đan/Nguyên Anh story placeholder + 2 invariant test` | medium shared catalog + tests |
| [#432](https://github.com/hoathienmenh-01/xuantoi/pull/432) | `fix(api,shared): Phase 12 Story PR-6 — Combat kill hook → quest track auto-wire (fix monster.key mismatch with quest placeholder targetId, add MonsterDef.questTargetIds + 7 mappings + 5 integration tests)` | medium full-stack fix + tests, no Prisma migration, no new endpoint, no FE change |
| [#431](https://github.com/hoathienmenh-01/xuantoi/pull/431) | `feat(api,web): Phase 12 Story PR-5 — Main storyline Chapter 1 playable (phamnhan_main_01 end-to-end accept → progress → claim, admin quest-track endpoint + E2E golden-path)` | medium full-stack feature + tests, **no Prisma migration**, **no new player endpoint** |
| [#430](https://github.com/hoathienmenh-01/xuantoi/pull/430) | `feat(web): Phase 12 Story Runtime MVP — QuestView.vue list + filter + accept/claim UI (Pinia store useQuestStore + 3 typed API wrappers + router /quests + nav AppShell + i18n vi/en parity + 25 new test) consume PR-2/3 endpoints, server-authoritative` | medium FE feature + tests |
| [#429](https://github.com/hoathienmenh-01/xuantoi/pull/429) | `feat(shared): Phase 12 Story Foundation Extension — Kim Đan + Nguyên Anh catalog (+10 quest + 1 NPC Huyết La Sát + 5 dialogue line + integrity test for chain hoa_thien_main 5 cảnh giới + moc_thanh_y_arc 3 step + huyet_la_sat_arc mới + main exp scaling)` | small shared catalog + tests, KHÔNG runtime change |
| [#428](https://github.com/hoathienmenh-01/xuantoi/pull/428) | `feat(web,api): Phase 12 PR-4 — NPC dialogue UI (NpcModule server-authoritative branch picker realm_min + quest_status + faction_member placeholder + choice quest status annotation; FE NpcView + NpcDialogueModal + Pinia store + i18n vi/en + smoke:npc 11 step + 45 new test)` | medium FE+BE feature + tests |



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
| 12 | World Map & Dungeon | **OPEN** | 12.1 catalog CLOSED (#397). 12.2.A `dailyLimit` enforcement CLOSED (#421). Story PR-1→PR-6 + Foundation Extension + Late-game wire CLOSED (#425–#433). **12.2.B DungeonTemplate + DungeonRun runtime** CLOSED ✅ (#434 — 4 endpoint + 44 test + smoke 16 step). **12.2.C DungeonRun FE UI** CLOSED ✅ (#435 — `DungeonRunView.vue` + Pinia store + i18n + 31 test). **12.3 DungeonRun per-encounter loot wire** CLOSED ✅ (#436 — wire `rollDungeonLoot` + `ItemLedgerReason 'DUNGEON_LOOT'` + FE kill log loot render + 5 test). **E2E spec #22 dungeon-run flow** OPEN (this PR — Playwright son_coc start→next×3→claim, gate `E2E_FULL=1`). Next: 12.4 per-monster `lootTable` polish. |
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

### Vitest baseline (post E2E spec #22)

| Workspace | Test count | Notes |
|---|---|---|
| `apps/api` | **1973** | +1 từ listForUser COMPLETED fallback test (this PR). |
| `packages/shared` | **1340** | Carryover từ PR #433. |
| `apps/web` | **1159** | Carryover từ PR #436. E2E spec thêm ngoài vitest matrix (Playwright). |
| **Total** | **4472 vitest** | All green local. **GitHub CI runners**: verify khi PR push. |

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

1. **E2E spec #22 dungeon-run flow + BE bugfix listForUser** **CLOSED** ✅ (this PR). Playwright spec append vào `golden.spec.ts` — son_coc start → next×3 (verify Phase 12.3 kill log loot span `dungeon-run-killed-{i}-loot`) → COMPLETED → claim modal → reward delta cross-check (linhThach +50, inventory huyet_chi_dan qty ≥ 1). Spec catch ra bug `DungeonRunService.listForUser` chỉ return ACTIVE runs → sau next() cuối flips COMPLETED → FE mất claim button. Fix BE: priority ACTIVE → fallback COMPLETED+claimedAt=null. Server-authoritative — KHÔNG self-grant. Gate `E2E_FULL=1`.

   **Phase 12.4 — Next** (Medium BE): Per-monster `MonsterDef.lootTable` polish — cho phép override `DUNGEON_LOOT[dungeon.key]` per monster (boss/elite có lootTable riêng). Implement: `MonsterDef.lootTable?: LootEntry[]` (optional override) + `rollMonsterLoot(monsterKey, n)` helper trong `packages/shared/src/items.ts` + `nextEncounter` phải kiểm tra `monster.lootTable` trước `dungeon.key` fallback. Balance review per region trong [`docs/BALANCE_MODEL.md`](./BALANCE_MODEL.md).

2. **Phase 12 Story chain** — design source ở [`docs/story/TU_TIEN_LO_STORY_BIBLE.md`](./story/TU_TIEN_LO_STORY_BIBLE.md) + [`docs/story/PHASE12_STORY_PROGRESS.md`](./story/PHASE12_STORY_PROGRESS.md). 5-PR core roadmap **CLOSED** ✅, hỗ trợ Foundation Late-game wire continues:
   - **PR-1** — Story/NPC/Quest catalog foundation (15 quest + 4 NPC + 6 dialogue cho 3 cảnh giới đầu). **CLOSED** ✅ (#425).
   - **PR-2** — Quest runtime persistence (Prisma `QuestProgress` + `Character.storyChapter` + `QuestService.list/accept/progress/track` + 3 endpoints + CombatService kill hook). **CLOSED** ✅ (#426).
   - **PR-3** — Quest claim / reward idempotency (`QuestService.claim` qua `CurrencyService.applyTx` + `InventoryService.grantTx` + CAS guard `QuestProgress.claimedAt` + concurrency test). **CLOSED** ✅ (#427).
   - **PR-4** — NPC dialogue UI (`NpcModule` 2 endpoint + server-authoritative branch picker + `NpcView.vue` + `NpcDialogueModal.vue` + Pinia store + i18n + 45 test + smoke:npc). **CLOSED** ✅ (#428).
   - **PR-5** — Main storyline Chapter 1 playable (`phamnhan_main_01` end-to-end + `QuestView.vue` list + E2E spec golden-path). **CLOSED** ✅ (#431).
   - **PR-6** — Combat kill hook → quest track auto-wire (`MonsterDef.questTargetIds` alias + 7 monster mapping critical-path). **CLOSED** ✅ (#432).
   - **Foundation Late-game wire** — 8 monster catalog (`tich_linh_anh` / `tam_ma_anh` / `tich_linh_quy` / `tich_thien_sat_thu` / `tam_ma_nguyen_anh` / `chap_niem_anh` / `ky_uc_meo` / `huyet_anh`) cho Trúc Cơ/Kim Đan/Nguyên Anh story placeholder + 2 invariant test (orphan-free + late-game key-match). **CLOSED** ✅ (#433).

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
