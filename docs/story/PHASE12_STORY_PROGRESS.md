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

**Catalog foundation DONE.** Phase 12 Story/NPC/Quest runtime = 0% (vẫn chưa wire DB).

Hiện tại Phase 12 đã có:
- **Phase 12.1** (catalog `MapDef` / `EncounterDef` / `DungeonDef`) — CLOSED ✅ (PR #397).
- **Phase 12.2.A** (`DungeonDef.dailyLimit` server-side enforcement) — CLOSED ✅ (PR #421).
- **Phase 12.2.B** (`DungeonTemplate` + `DungeonRun` multi-encounter runtime) — open (Prisma migration risk; xem [`../AI_HANDOFF_REPORT.md`](../AI_HANDOFF_REPORT.md) §1 immediate next task).
- **Phase 12 Story PR-1** (Story / NPC / Quest catalog foundation) — CLOSED ✅ (PR docs(story+catalog): Phase 12 PR-1 Story/NPC/Quest catalog foundation).

**Story / NPC / Quest catalog**: 4 NPC + 15 quest + 6 dialogue line (3 cảnh giới đầu Phàm Nhân + Luyện Khí + Trúc Cơ). Runtime persistence chưa có — Phase 12 PR-2 sẽ thêm `QuestProgress` Prisma migration.

## 3. Implemented chapters

> Format: `<#> <realm_code>` — main quest + bao nhiêu side quest đã code, NPC giao quest, ngày + PR merge.

| # | Realm code | Main quest | Side quest catalog | Side quest runtime | NPC giao | Ngày | PR |
|---|---|---|---|---|---|---|---|
| 0 | `phamnhan` | `phamnhan_main_01` Hoa Thiên Tuyển Đồ | 4/4 (realm/sect/grind/npc) | 0/4 | Lăng Vân Sinh, Mộc Thanh Y | 2026-05-05 | PR-1 |
| 1 | `luyenkhi` | `luyenkhi_main_01` Linh Khí Nhập Thể | 4/4 | 0/4 | Lăng Vân Sinh, Mộc Thanh Y, Hàn Dạ | 2026-05-05 | PR-1 |
| 2 | `truc_co` | `truc_co_main_01` Trúc Đạo Cơ | 4/4 | 0/4 | Lăng Vân Sinh, Mộc Thanh Y, Tô Nguyệt Ly | 2026-05-05 | PR-1 |

**Runtime status**: catalog only ở PR-1 — Phase 12 PR-2 sẽ wire `QuestService.list/accept/progress/complete` với `QuestProgress` Prisma model. Side quest runtime cũng chờ PR-2.

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
| `hoa_thien_main` | phamnhan → truc_co | Lăng Vân Sinh | 5 (3 main + 2 realm) | ✅ | Missing | Missing | Missing |
| `moc_thanh_y_arc` | truc_co | Lăng Vân Sinh + Mộc Thanh Y | 1 (`truc_co_sect_01` Cứu Đại Sư Tỷ) | ✅ | Missing | Missing | Missing |
| `han_da_rivalry` | luyenkhi+ | Hàn Dạ | 1 (`luyenkhi_npc_01` Lời Thách Đấu) | ✅ | Missing | Missing | Missing |
| `to_nguyet_ly_hidden` | truc_co+ | Tô Nguyệt Ly | 1 (`truc_co_npc_01` Bóng Trong Sương) | ✅ | Missing | Missing | Missing |

Standalone quest (no chain): 6 quest (3 sect + 3 grind).

**Status**: catalog only — runtime wiring chờ Phase 12 PR-2, claim chờ PR-3, UI chờ PR-4 + PR-5.

(27 chuỗi quest cốt truyện đã design — danh sách đầy đủ ở [`./TU_TIEN_LO_STORY_BIBLE.md`](./TU_TIEN_LO_STORY_BIBLE.md) §11.)

## 6. Missing runtime modules

Để build được Phase 12 Story/NPC/Quest, các module sau cần code (theo thứ tự dependency):

| Module | Status | Ghi chú |
|---|---|---|
| **Quest catalog** (`QuestDef` + `QuestStepDef` + `QuestRewardDef`) | **Done** ✅ | Static ở `packages/shared/src/quests.ts` (15 quest). 5 step kind: kill / collect / talk / explore / choice. PR-1 merged 2026-05-05. |
| **NPC catalog** (`NpcDef`) | **Done** ✅ | Static ở `packages/shared/src/npcs.ts` (4 NPC). PR-1 merged 2026-05-05. |
| **Dialogue catalog skeleton** (`DialogueLineDef` + `DialogueChoiceDef` + `DialogueBranchCondition`) | **Done** ✅ | Static ở `packages/shared/src/dialogues.ts` (6 line, branch `always` / `realm_min` / `quest_status` / `faction_member`). `pickDialogueForNpc()` helper PR-1 (chỉ implement `always` + `realm_min`; `quest_status` + `faction_member` chờ runtime PR-4). |
| **QuestProgress** (per-character) | **Missing** | Prisma model với unique `(characterId, questKey)`. Trạng thái: `locked / available / accepted / completed / claimed`. **Cần Prisma migration**. Phase 12 PR-2. |
| **Quest service** (`QuestService.list / accept / progress / complete`) | **Missing** | `apps/api/src/modules/quest/`. Server-authoritative validation: realm gate, prerequisite, faction (faction wire ở PR-4+). Phase 12 PR-2. |
| **Story chapter tracking** | **Missing** | `Character.storyChapter` field hoặc `CharacterFlag` table. **Cần Prisma migration** (audit `apps/api/prisma/schema.prisma` trước). Phase 12 PR-2 hoặc PR-5. |
| **Reward claim** (`QuestService.claim`) | **Missing** | Đi qua `CurrencyService` / `ItemService` + `RewardLedger` + idempotency key `(characterId, QUEST_CLAIM, questKey)`. KHÔNG xây ledger riêng. Phase 12 PR-3. |
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

### PR-2 — Quest runtime persistence (Medium, BE)

- Prisma migration: `QuestProgress` (unique `(characterId, questId)`, status enum).
- Prisma migration: `Character.storyChapter` field hoặc `CharacterFlag` (audit schema trước).
- Service: `QuestService.list` (theo character) / `accept` / `progress` / `complete`. Server-authoritative validation: realm gate, prerequisite, faction.
- Controller + REST API (xem [`../API.md`](../API.md) cập nhật).
- Unit test + smoke script (`pnpm smoke:quest`).
- KHÔNG claim reward yet (PR-3).
- Update progress tracker.

### PR-3 — Quest claim / reward idempotency (Small, BE)

- Service: `QuestService.claim` — đi qua `CurrencyService` / `ItemService` + ghi `RewardLedger` row với idempotency key `(characterId, QUEST_CLAIM, questId)`.
- Test concurrency: 2 parallel `claim()` cùng `questId` → chỉ 1 ledger row.
- Tuân [`../ECONOMY_MODEL.md`](../ECONOMY_MODEL.md) §3 invariants.
- Smoke +N step.
- Update progress tracker.

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
