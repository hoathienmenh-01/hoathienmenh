# Phase 12 — Story / NPC / Quest Progress Tracker

> **Source of truth** cho phần cốt truyện trong Phase 12. AI/dev mới làm story/NPC/quest **đọc file này TRƯỚC**, sau đó đọc [`TU_TIEN_LO_STORY_BIBLE.md`](./TU_TIEN_LO_STORY_BIBLE.md) nếu cần chi tiết. **KHÔNG đọc DOCX gốc mỗi session** — DOCX chỉ là archive/source reference.
>
> **Rule (bắt buộc)**: sau mỗi PR story / quest / NPC merged, AI cập nhật file này **trong cùng PR** để ghi đã code đến đâu (DOCS UPDATE RULE — xem [`../AI_WORKFLOW_RULES.md`](../AI_WORKFLOW_RULES.md)). Đây là điều kiện reviewer accept PR.

---

## 1. Story source

| Source | Path | Vai trò |
|---|---|---|
| DOCX gốc | [`../archive/original-docx/TuTienLo_Story_Bible.docx`](../archive/original-docx/TuTienLo_Story_Bible.docx) | Archive / reference. **KHÔNG đọc mỗi session.** Không phải runtime source. |
| Markdown bible | [`./TU_TIEN_LO_STORY_BIBLE.md`](./TU_TIEN_LO_STORY_BIBLE.md) | Design source duy nhất cho cốt truyện / NPC / quest. AI đọc khi cần lore/narrative. |
| Progress tracker | `./PHASE12_STORY_PROGRESS.md` (file này) | Source of truth cho tiến độ implementation. **AI đọc trước khi code Phase 12 story.** |

Khi story design conflict với code, ưu tiên: code trên `main` > [`../AI_HANDOFF_REPORT.md`](../AI_HANDOFF_REPORT.md) > markdown bible > DOCX gốc.

## 2. Current status

**Catalog foundation + quest runtime persistence + quest claim reward DONE.** Quest UI / NPC dialogue UI (PR-4 / PR-5) chưa có.

Hiện tại Phase 12 đã có:
- **Phase 12.1** (catalog `MapDef` / `EncounterDef` / `DungeonDef`) — CLOSED ✅ (PR #397).
- **Phase 12.2.A** (`DungeonDef.dailyLimit` server-side enforcement) — CLOSED ✅ (PR #421).
- **Phase 12.2.B** (`DungeonTemplate` + `DungeonRun` multi-encounter runtime) — open (Prisma migration risk; xem [`../AI_HANDOFF_REPORT.md`](../AI_HANDOFF_REPORT.md) §6 backlog).
- **Phase 12 Story PR-1** (Story / NPC / Quest catalog foundation) — CLOSED ✅ (PR #425).
- **Phase 12 Story PR-2** (Quest runtime persistence) — CLOSED ✅ (PR #426).
- **Phase 12 Story PR-3** (Quest claim / reward idempotency) — CLOSED ✅ (`QuestService.claim` qua `CurrencyService.applyTx` + `InventoryService.grantTx` + CAS guard trên `QuestProgress.claimedAt` + concurrency test + smoke +4 step).

**Story / NPC / Quest runtime**: 4 NPC + 15 quest + 6 dialogue line (3 cảnh giới đầu). `QuestProgress` Prisma model live; `QuestService` server-authoritative validation (realm gate + prereq + CAS guard); kill step auto-tracked qua `CombatService` fail-soft hook; reward claim atomic qua ledger (`reason='QUEST_CLAIM'`, `refType='Quest'`, `refId=questKey`) đảm bảo idempotent (race-safe 1 winner / questKey).

## 3. Implemented chapters

> Format: `<#> <realm_code>` — main quest + bao nhiêu side quest đã code, NPC giao quest, ngày + PR merge.

| # | Realm code | Main quest | Side quest catalog | Side quest runtime | NPC giao | Ngày | PR |
|---|---|---|---|---|---|---|---|
| 0 | `phamnhan` | `phamnhan_main_01` Hoa Thiên Tuyển Đồ | 4/4 (realm/sect/grind/npc) | 4/4 (accept/progress/track + storyChapter bump khi COMPLETED) | Lăng Vân Sinh, Mộc Thanh Y | 2026-05-05 | PR-1 + PR-2 |
| 1 | `luyenkhi` | `luyenkhi_main_01` Linh Khí Nhập Thể | 4/4 | 4/4 | Lăng Vân Sinh, Mộc Thanh Y, Hàn Dạ | 2026-05-05 | PR-1 + PR-2 |
| 2 | `truc_co` | `truc_co_main_01` Trúc Đạo Cơ | 4/4 | 4/4 | Lăng Vân Sinh, Mộc Thanh Y, Tô Nguyệt Ly | 2026-05-05 | PR-1 + PR-2 |

**Runtime status**: catalog (PR-1 #425) + persistence (PR-2 #426 — `QuestProgress` Prisma + `QuestService.list/accept/progress/track`) + claim (PR-3 — `QuestService.claim` + `CurrencyLedger`/`ItemLedger` rows) DONE.

(Chuẩn bị để track 28 cảnh giới Phàm Nhân → Hư Không Chí Tôn — danh sách đầy đủ ở [`./TU_TIEN_LO_STORY_BIBLE.md`](./TU_TIEN_LO_STORY_BIBLE.md) §9.1.)

## 4. Implemented NPCs

> Format: `NPC name` — faction, dialogue catalog status, quest count, ngày + PR merge.

| NPC | Faction | Realm gate | Dialogue catalog | Dialogue UI | Quest giver count | Ngày | PR |
|---|---|---|---|---|---|---|---|
| Lăng Vân Sinh | hoa_thien_mon | 0 (phamnhan) | 2 line (default + truc_co branch) | Missing | 6 quest (3 main + realm + sect chain) | 2026-05-05 | PR-1 |
| Mộc Thanh Y | hoa_thien_mon | 0 (phamnhan) | 2 line (default + luyen_khi branch) | Missing | 7 quest (sect/grind/npc + realm) | 2026-05-05 | PR-1 |
| Hàn Dạ | huyen_kiem_tong | 1 (luyenkhi) | 1 line (default rivalry) | Missing | 1 quest (`luyenkhi_npc_01`) | 2026-05-05 | PR-1 |
| Tô Nguyệt Ly | null (lưu đày) | 2 (truc_co) | 1 line (default hidden) | Missing | 1 quest (`truc_co_npc_01`) | 2026-05-05 | PR-1 |

**Dialogue UI**: tất cả 4 NPC chờ Phase 12 PR-4 (`NpcDialogueModal.vue` + `GET /npc/:id/dialogue` endpoint).

(Chuẩn bị để track 5 NPC còn lại — Huyết La Sát, Vạn Kim Nương, Bạch Đế Tử, Hoa Thiên Đạo Tổ, Tịch Thiên Đạo Chủ — sẽ thêm khi cảnh giới tương ứng được code.)

## 5. Implemented quest chains

> Format: `<chain name>` — cảnh giới, NPC, số bước, status (catalog / runtime / UI / claim).

| Chain key | Realm range | NPC chính | Quest count | Catalog | Runtime | UI | Claim |
|---|---|---|---|---|---|---|---|
| `hoa_thien_main` | phamnhan → truc_co | Lăng Vân Sinh | 5 (3 main + 2 realm) | ✅ | ✅ (PR-2) | Missing | ✅ (PR-3) |
| `moc_thanh_y_arc` | truc_co | Lăng Vân Sinh + Mộc Thanh Y | 1 (`truc_co_sect_01` Cứu Đại Sư Tỷ) | ✅ | ✅ (PR-2) | Missing | ✅ (PR-3) |
| `han_da_rivalry` | luyenkhi+ | Hàn Dạ | 1 (`luyenkhi_npc_01` Lời Thách Đấu) | ✅ | ✅ (PR-2) | Missing | ✅ (PR-3) |
| `to_nguyet_ly_hidden` | truc_co+ | Tô Nguyệt Ly | 1 (`truc_co_npc_01` Bóng Trong Sương) | ✅ | ✅ (PR-2) | Missing | ✅ (PR-3) |

Standalone quest (no chain): 6 quest (3 sect + 3 grind).

**Status**: catalog (PR-1) + runtime persistence (PR-2 — accept / progress / track / auto-COMPLETED) + claim (PR-3 — `QuestService.claim` ledger atomic) DONE. UI chờ PR-4 + PR-5.

(27 chuỗi quest cốt truyện đã design — danh sách đầy đủ ở [`./TU_TIEN_LO_STORY_BIBLE.md`](./TU_TIEN_LO_STORY_BIBLE.md) §11.)

## 6. Missing runtime modules

Để build được Phase 12 Story/NPC/Quest, các module sau cần code (theo thứ tự dependency):

| Module | Status | Ghi chú |
|---|---|---|
| **Quest catalog** (`QuestDef` + `QuestStepDef` + `QuestRewardDef`) | **Done** ✅ | Static ở `packages/shared/src/quests.ts` (15 quest). 5 step kind: kill / collect / talk / explore / choice. PR-1 merged 2026-05-05. |
| **NPC catalog** (`NpcDef`) | **Done** ✅ | Static ở `packages/shared/src/npcs.ts` (4 NPC). PR-1 merged 2026-05-05. |
| **Dialogue catalog skeleton** (`DialogueLineDef` + `DialogueChoiceDef` + `DialogueBranchCondition`) | **Done** ✅ | Static ở `packages/shared/src/dialogues.ts` (6 line, branch `always` / `realm_min` / `quest_status` / `faction_member`). `pickDialogueForNpc()` helper PR-1 (chỉ implement `always` + `realm_min`; `quest_status` + `faction_member` chờ runtime PR-4). |
| **QuestProgress** (per-character) | **Done** ✅ | Prisma model với unique `(characterId, questKey)` + status enum (`LOCKED / AVAILABLE / ACCEPTED / COMPLETED / CLAIMED`) + JSON `stepProgress` counters + timestamps. Migration `20260520000000_phase_12_pr2_quest_runtime`. PR-2 merged. |
| **Quest service** (`QuestService.list / accept / progress / track`) | **Done** ✅ | `apps/api/src/modules/quest/`. Server-authoritative validation: realm gate (`Character.realmStage` order >= `QuestDef.requiredRealmOrder`), prerequisite quest, CAS guards (`where {id, status: OLD}`), fail-soft `track()` hook from `CombatService` kill events. PR-2 merged. |
| **Story chapter tracking** | **Done** ✅ | `Character.storyChapter` Int field bumped khi main quest `COMPLETED` (chapter index = `realmOrder + 1`). PR-2 merged. |
| **Reward claim** (`QuestService.claim`) | **Done** ✅ | `apps/api/src/modules/quest/quest.service.ts:claim()`. CAS guard `updateMany({where:{id, status:'COMPLETED', claimedAt:null}})` → `status='CLAIMED'`. Grant linhThach/tienNgoc qua `CurrencyService.applyTx` (`reason='QUEST_CLAIM'`, `refType='Quest'`, `refId=questKey`); exp/congHien qua `tx.character.update`; items qua `InventoryService.grantTx`. Idempotency: race-safe 1 winner / questKey (concurrency test xác nhận 2 parallel claim → đúng 1 ledger row). PR-3 merged. |
| **Quest UI** (`QuestView.vue` + Pinia store) | **Missing** | List + filter (main/realm/sect/npc/grind) + loading/empty/error + i18n vi/en. Tuân UI MODULE RULE. Phase 12 PR-5. |
| **NPC dialogue UI** (`NpcDialogueModal.vue`) | **Missing** | Branch text + choice button + portrait. Server endpoint `GET /npc/:id/dialogue` filter branch theo realm + quest_status. Phase 12 PR-4. |
| **Cơ duyên (kỳ ngộ) MVP** | Partial | `EncounterDef` đã có (Phase 12.1). Cần extend cho quest-driven flavor + cooldown log. Phase 12 sau PR-5. |

## 7. Recommended Phase 12 PR plan

Tách nhỏ, mỗi PR là 1 layer. Tuân BATCHING RULE + UI MODULE RULE.

### PR-1 — Story / NPC / Quest catalog foundation — **CLOSED** ✅ (2026-05-05)

- Static catalog: `packages/shared/src/quests.ts` (15 quest cho Phàm Nhân + Luyện Khí + Trúc Cơ), `packages/shared/src/npcs.ts` (4 NPC: Lăng Vân Sinh / Mộc Thanh Y / Hàn Dạ / Tô Nguyệt Ly), `packages/shared/src/dialogues.ts` (6 skeleton dialogue line).
- TypeScript interface + 45 integrity test (mỗi `quest.key` + `npc.key` + `dlg.id` unique, cross-catalog reference, naming convention).
- KHÔNG Prisma migration ✅.
- KHÔNG runtime persistence ✅.
- KHÔNG UI ✅.
- §3-§5 progress tracker updated (chapters / NPCs / chains).
- Tham khảo [`../CONTENT_PIPELINE.md`](../CONTENT_PIPELINE.md) cho naming + i18n parity (i18n parity sẽ wire ở PR-4 dialogue UI).

### PR-2 — Quest runtime persistence — **CLOSED** ✅ (2026-05-05)

- Prisma migration `20260520000000_phase_12_pr2_quest_runtime`: `QuestProgress` model (unique `(characterId, questKey)`, status enum `LOCKED/AVAILABLE/ACCEPTED/COMPLETED/CLAIMED`, JSON `stepProgress`, timestamps) + `Character.storyChapter` Int field.
- Service `apps/api/src/modules/quest/quest.service.ts`: `list()` lazy-create AVAILABLE rows, `accept()` realm gate + prereq + CAS guard, `progress()` dispatch step kind `talk/explore/choice` với auto-COMPLETED, `track()` fail-soft hook cho `kill/collect` step kind. CAS pattern `where {id, status: OLD_STATUS}` ngăn double-mutation.
- Controller `quest.controller.ts`: `GET /quests/me`, `POST /quests/accept`, `POST /quests/progress`. Zod validators + error mapping (404/403/409).
- `CombatService` wire fail-soft `quests?.track(char.id, 'kill', 'monster', monster.key, 1)` tại 2 kill hook (lính-monster + boss).
- 41 test (`quest.service.test.ts` 22 + `quest.controller.test.ts` 19) covering realm gate / prereq lock / CAS guard / step dispatch / `storyChapter` bump.
- Smoke `scripts/smoke-quest.mjs` 16/16 step (auth gate × 3, zod 400 × 2, NO_CHARACTER, post-onboard list, QUEST_UNKNOWN, QUEST_LOCKED_REALM, QUEST_LOCKED_PREREQUISITE, ACCEPTED, CAS double-accept QUEST_NOT_AVAILABLE, QUEST_STEP_UNKNOWN, QUEST_STEP_KIND_MISMATCH).
- KHÔNG claim reward (PR-3) ✅.

### PR-3 — Quest claim / reward idempotency — **CLOSED** ✅ (2026-05-05)

- Service: `QuestService.claim(userId, questKey)` (`apps/api/src/modules/quest/quest.service.ts`) — atomic `prisma.$transaction`:
  1. CAS guard `updateMany({where:{id, status:'COMPLETED', claimedAt:null}, data:{status:'CLAIMED', claimedAt}})`. `count !== 1` → `QUEST_ALREADY_CLAIMED`.
  2. Grant `linhThach` / `tienNgoc` qua `CurrencyService.applyTx(tx, {reason:'QUEST_CLAIM', refType:'Quest', refId:questKey})` → ghi `CurrencyLedger` row.
  3. Grant `exp` / `congHien` qua `tx.character.update({increment})` (mirror `MissionService` pattern; KHÔNG có ledger riêng cho 2 cột này).
  4. Grant items qua `InventoryService.grantTx(tx, characterId, list, {reason:'QUEST_CLAIM', refType:'Quest', refId:questKey})` → ghi `ItemLedger` rows.
- Controller: `POST /quests/claim` (`quest.controller.ts`) — zod `{questKey}`, error mapping (`QUEST_UNKNOWN` / `QUEST_NOT_FOUND_PROGRESS` 404, `QUEST_NOT_COMPLETED` / `QUEST_ALREADY_CLAIMED` 409). Response envelope `{ok:true, data:{questKey, claimedAt, granted:{linhThach, tienNgoc, exp, congHien, items[]}}}`.
- LedgerReason union: thêm `'QUEST_CLAIM'` vào `apps/api/src/modules/character/currency.service.ts` và `apps/api/src/modules/inventory/inventory.service.ts`.
- Module wiring: `QuestModule` import `CharacterModule` + `InventoryModule` (không cần forwardRef — QuestService không có service khác import ngược vào).
- Test:
  - Service unit + concurrency (`quest.service.test.ts` 30 test tổng — 8 cho `claim`): success path, NO_CHARACTER, QUEST_UNKNOWN, QUEST_NOT_FOUND_PROGRESS, QUEST_NOT_COMPLETED, QUEST_ALREADY_CLAIMED, item grant qua `ItemLedger`, **concurrency 2 parallel claim → 1 winner + 1 ledger row** (`Promise.allSettled`).
  - Controller (`quest.controller.test.ts` 26 test — 7 cho `claim`): auth gate 401, zod 400, error mapping (404/409), envelope shape.
  - Catalog integrity (`packages/shared/src/quests.test.ts`): đảm bảo mọi `reward.items[].itemKey` tồn tại trong `ITEMS` catalog (fix 3 placeholder item: `linh_khi_dan` → `linh_lo_dan`, `truc_co_dan` → `co_thien_dan`, `cong_phap_so_cap` → `co_thien_dan`).
- Smoke `scripts/smoke-quest.mjs` 20/20 step (PR-2 16 step + PR-3 4 step: claim auth gate 401, zod 400, QUEST_UNKNOWN 404, QUEST_NOT_FOUND_PROGRESS 404, QUEST_NOT_COMPLETED 409). Positive flow tới CLAIMED yeu cầu gameplay automation — cover trong concurrency test.
- Tuân [`../ECONOMY_MODEL.md`](../ECONOMY_MODEL.md) §3 invariants: single mutation point qua `CurrencyService.applyTx` / `InventoryService.grantTx`; ledger row contract đầy đủ (`characterId`, `currency`, `delta`, `reason`, `refType`, `refId`, `createdAt`); idempotency qua CAS guard `claimedAt` (§3.5 mẫu `Achievement.claimedAt`).

### PR-4 — NPC dialogue UI (Medium, FE + BE wiring)

- BE endpoint: `GET /npc/:id/dialogue` (server filter branch theo karma/quest flag).
- FE: `NpcDialogueModal.vue` + Pinia store + i18n vi/en + loading/empty/error.
- FE: NPC list view trong Hoa Thiên Môn home (PR-5 expand).
- Test render + Playwright smoke (xem `apps/web/e2e/`).
- Update progress tracker.

### PR-5 — Main storyline Chapter 1 playable (Medium-Large, full stack)

- Wire `phamnhan_main_01` (Hoa Thiên Tuyển Đồ) end-to-end: catalog → runtime → claim → UI list + filter + accept + claim → NPC dialogue.
- Update `Character.storyChapter` khi claim main chapter quest.
- E2E spec (golden-path): accept → progress → complete → claim → check inventory + ledger.
- Smoke `pnpm smoke:quest` extended.
- Update progress tracker §3 (Chapter 1 = `phamnhan` Done).

### After PR-5: Chapter 2..N expansion

- Mỗi cảnh giới mới = 1 PR Medium (catalog + runtime wiring + UI test).
- Hoặc gom 2-3 cảnh giới gần nhau nếu reuse pattern (gợi ý gom theo tier: tier `pham` 0..9 = 10 cảnh giới có thể gom 2-3 PR; tier `nhan_tien` / `tien_gioi` / `hon_nguyen` / `ban_nguyen` / `vinh_hang` để sau).
- Cảnh giới 17+ (Chuẩn Thánh trở lên) là long-term — tham khảo [`../LONG_TERM_ROADMAP.md`](../LONG_TERM_ROADMAP.md) DO-NOT-BUILD-YET list trước khi build.

## 8. Update rule (mandatory)

Sau **mỗi PR** story / quest / NPC merged, AI **bắt buộc** trong cùng PR:

1. Cập nhật §3 Implemented chapters (thêm dòng cảnh giới đã code).
2. Cập nhật §4 Implemented NPCs (thêm NPC đã code dialogue/quest).
3. Cập nhật §5 Implemented quest chains (thêm chuỗi đã playable end-to-end).
4. Cập nhật §6 Missing runtime modules (đánh dấu module chuyển từ Missing → Done).
5. Cập nhật §7 PR plan (đánh dấu PR đã merge, ghi PR #).
6. Cập nhật [`../AI_HANDOFF_REPORT.md`](../AI_HANDOFF_REPORT.md) §2 Recent Changes (DOCS UPDATE RULE).

Reviewer phải reject PR story/quest/NPC nếu file này chưa cập nhật.

## 9. Cross-reference

- [`./TU_TIEN_LO_STORY_BIBLE.md`](./TU_TIEN_LO_STORY_BIBLE.md) — design source (lore / NPC / quest chain).
- [`../START_HERE.md`](../START_HERE.md) — cổng vào docs.
- [`../AI_HANDOFF_REPORT.md`](../AI_HANDOFF_REPORT.md) — snapshot trạng thái thật.
- [`../AI_WORKFLOW_RULES.md`](../AI_WORKFLOW_RULES.md) — UI MODULE RULE / DOCS UPDATE RULE / SAFETY CORRECTION.
- [`../CONTENT_PIPELINE.md`](../CONTENT_PIPELINE.md) — process thêm quest content + naming + i18n.
- [`../ECONOMY_MODEL.md`](../ECONOMY_MODEL.md) — ledger contract cho quest reward.
- [`../BALANCE_MODEL.md`](../BALANCE_MODEL.md) — band reward để không phá balance.
- [`../GAME_DESIGN_BIBLE.md`](../GAME_DESIGN_BIBLE.md) §K — module dependency rule.
- [`../LONG_TERM_ROADMAP.md`](../LONG_TERM_ROADMAP.md) — Phase 9 → 17 + DO-NOT-BUILD-YET list.
- [`../API.md`](../API.md) — cập nhật khi thêm endpoint quest/NPC.
