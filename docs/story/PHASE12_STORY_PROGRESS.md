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

**Not implemented yet.** Phase 12 Story/NPC/Quest runtime = 0%.

Hiện tại Phase 12 đã có:
- **Phase 12.1** (catalog `MapDef` / `EncounterDef` / `DungeonDef`) — CLOSED ✅ (PR #397).
- **Phase 12.2.A** (`DungeonDef.dailyLimit` server-side enforcement) — CLOSED ✅ (PR #421).
- **Phase 12.2.B** (`DungeonTemplate` + `DungeonRun` multi-encounter runtime) — open (Prisma migration risk; xem [`../AI_HANDOFF_REPORT.md`](../AI_HANDOFF_REPORT.md) §1 immediate next task).

**Story / NPC / Quest catalog**: chưa bắt đầu.

## 3. Implemented chapters

> Format: `<#> <realm_code>` — main quest + bao nhiêu side quest đã code, NPC giao quest, ngày + PR merge.

**none.**

(Chuẩn bị để track 28 cảnh giới Phàm Nhân → Hư Không Chí Tôn — danh sách đầy đủ ở [`./TU_TIEN_LO_STORY_BIBLE.md`](./TU_TIEN_LO_STORY_BIBLE.md) §9.1.)

## 4. Implemented NPCs

> Format: `NPC name` — faction, dialogue catalog status, quest count, ngày + PR merge.

**none.**

(Chuẩn bị để track 9 NPC trụ cột — danh sách ở [`./TU_TIEN_LO_STORY_BIBLE.md`](./TU_TIEN_LO_STORY_BIBLE.md) §6: Lăng Vân Sinh, Mộc Thanh Y, Hàn Dạ, Tô Nguyệt Ly, Huyết La Sát, Vạn Kim Nương, Bạch Đế Tử, Hoa Thiên Đạo Tổ, Tịch Thiên Đạo Chủ.)

## 5. Implemented quest chains

> Format: `<chain name>` — cảnh giới, NPC, số bước, status (catalog / runtime / UI / claim).

**none.**

(27 chuỗi quest cốt truyện đã design — danh sách đầy đủ ở [`./TU_TIEN_LO_STORY_BIBLE.md`](./TU_TIEN_LO_STORY_BIBLE.md) §11.)

## 6. Missing runtime modules

Để build được Phase 12 Story/NPC/Quest, các module sau cần code (theo thứ tự dependency):

| Module | Status | Ghi chú |
|---|---|---|
| **Quest model / service** (`QuestDef` static catalog + `Quest` runtime model nếu cần) | **Missing** | Catalog ở `packages/shared/src/quests.ts`; service ở `apps/api/src/quest/`. |
| **QuestStep** (objective: `kill / collect / talk / explore / choice`) | **Missing** | Mỗi step có `targetType` + `targetId` + `count`. Static trong catalog. |
| **QuestProgress** (per-character) | **Missing** | Prisma model với unique `(characterId, questId)`. Trạng thái: `locked / available / accepted / completed / claimed`. **Cần Prisma migration**. |
| **NPC catalog** (`NpcDef`) | **Missing** | Static ở `packages/shared/src/npcs.ts`: `id`, `name`, `faction`, `realmGate`, `dialogueId`, `quests[]`. |
| **Dialogue catalog** (`DialogueDef` + `DialogueLine[]`) | **Missing** | Static ở `packages/shared/src/dialogues.ts`. Branch theo `karma / faction / quest_flag`. |
| **Story chapter tracking** | **Missing** | `Character.storyChapter` field hoặc `CharacterFlag` table. **Cần Prisma migration** (audit `apps/api/prisma/schema.prisma` trước). |
| **Quest UI** (`QuestView.vue` + Pinia store) | **Missing** | List + filter (chính / phụ / tông môn / NPC / cày) + loading/empty/error + i18n vi/en. Tuân UI MODULE RULE. |
| **NPC dialogue UI** (`NpcDialogueModal.vue`) | **Missing** | Branch text + choice button + portrait. |
| **Reward claim** | Reuse | Đi qua `CurrencyService` / `ItemService` + `RewardLedger` + idempotency key `(characterId, QUEST_CLAIM, questId)`. KHÔNG xây ledger riêng. |
| **Cơ duyên (kỳ ngộ) MVP** | Partial | `EncounterDef` đã có (Phase 12.1). Cần extend cho quest-driven flavor + cooldown log. |

## 7. Recommended Phase 12 PR plan

Tách nhỏ, mỗi PR là 1 layer. Tuân BATCHING RULE + UI MODULE RULE.

### PR-1 — Story / NPC / Quest catalog foundation (Small-Medium, BE + shared)

- Static catalog: `packages/shared/src/quests.ts` (3 cảnh giới đầu: Phàm Nhân + Luyện Khí + Trúc Cơ → 5 quest mỗi cảnh giới = 15 quest), `packages/shared/src/npcs.ts` (4 NPC: Lăng Vân Sinh / Mộc Thanh Y / Hàn Dạ / Tô Nguyệt Ly), `packages/shared/src/dialogues.ts` (skeleton dialogue).
- Type schema (zod) + test key unique (mỗi `quest.id` + `npc.id` không trùng).
- KHÔNG Prisma migration. KHÔNG runtime persistence yet.
- KHÔNG UI yet.
- Update [`PHASE12_STORY_PROGRESS.md`](./PHASE12_STORY_PROGRESS.md) §3-§5.
- Tham khảo [`../CONTENT_PIPELINE.md`](../CONTENT_PIPELINE.md) cho naming + i18n parity.

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
