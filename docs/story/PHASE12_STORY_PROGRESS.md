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

**Catalog foundation + quest runtime persistence + quest claim reward + NPC dialogue UI + Story Foundation Extension (Kim Đan + Nguyên Anh catalog) + Story Runtime MVP (Quest UI list + accept/claim) + Story PR-5 Main storyline Chapter 1 playable + Story PR-6 Combat kill hook → quest auto-track + Story Foundation Late-game wire + Phase 12.2.B DungeonTemplate + DungeonRun runtime + Phase 12.3 Inventory grant wire + Phase 12.4 per-monster `MonsterDef.lootTable` polish + Story Foundation Late-game encounter wire + Story discoverability QuestView dungeon hint DONE (post PR #440 merged).**

Hiện tại Phase 12 đã có:
- **Phase 12.1** (catalog `MapDef` / `EncounterDef` / `DungeonDef`) — CLOSED ✅ (PR #397).
- **Phase 12.2.A** (`DungeonDef.dailyLimit` server-side enforcement) — CLOSED ✅ (PR #421).
- **Phase 12.2.B** (`DungeonTemplate` + `DungeonRun` multi-encounter runtime) — CLOSED ✅ (PR #434): Prisma `DungeonRun` model + `DungeonRunStatus` enum + 4 endpoint server-authoritative (`GET /dungeons/me`, `POST /dungeons/:templateKey/start`, `POST /dungeon-runs/:runId/next`, `POST /dungeon-runs/:runId/claim`) + realm gate + daily limit + ownership + idempotent claim qua `CurrencyService.applyTx` (reason `DUNGEON_RUN_REWARD`) + `InventoryService.grantTx` + CAS guard `claimedAt: null` + `QuestService.track('kill','monster',[monster.key, ...questTargetIds])` auto-wire khi `nextEncounter` (fail-soft) + 44 unit/controller test (21 service + 23 controller) + smoke `scripts/smoke-dungeon-run.mjs` 16 step (auth/no-char/onboard/list/start/invalid/realm-lock/start/next×N/COMPLETED/RUN_NOT_ACTIVE/claim/double-claim — local PASS).
- **Phase 12 Story PR-1** (Story / NPC / Quest catalog foundation) — CLOSED ✅ (PR #425).
- **Phase 12 Story PR-2** (Quest runtime persistence) — CLOSED ✅ (PR #426).
- **Phase 12 Story PR-3** (Quest claim / reward idempotency) — CLOSED ✅ (`QuestService.claim` qua `CurrencyService.applyTx` + `InventoryService.grantTx` + CAS guard trên `QuestProgress.claimedAt` + concurrency test + smoke +4 step).
- **Phase 12 Story PR-4** (NPC dialogue UI) — CLOSED ✅ (PR #428).
- **Phase 12 Story Foundation Extension** (Kim Đan + Nguyên Anh catalog: +10 quest + 1 NPC + 5 dialogue line + integrity test) — CLOSED ✅ (PR #429).
- **Phase 12 Story Runtime MVP** (QuestView.vue list + filter + accept/claim UI consume PR-2/3 endpoints, server-authoritative) — CLOSED ✅ (PR #430).
- **Phase 12 Story PR-5 Main storyline Chapter 1 playable** (`phamnhan_main_01` end-to-end via UI + admin quest-track seed harness `POST /admin/users/:id/quest-track` wrap `QuestService.track()` cho kind kill/collect + 13 unit test + E2E golden-path §21 phamnhan_main_01 accept → progress talk×2 → admin track kill 3 son_thu → claim → ledger verify) — CLOSED ✅ (PR #431).
- **Phase 12 Story PR-6 Combat kill hook → quest auto-track** (fix `monster.key` mismatch với quest placeholder targetId: thêm `MonsterDef.questTargetIds?: string[]` + map 7 monster sơn cốc/hắc lâm/kim sơn mạch/hoàng thổ huyết → quest placeholder + 5 integrity test + 5 integration test combat→quest progress→COMPLETED) — CLOSED ✅ (PR #432).
- **Phase 12 Story Foundation Late-game wire** (8 monster catalog mới cho 8 placeholder Trúc Cơ/Kim Đan/Nguyên Anh story còn lại từ PR-6: `tich_linh_anh`, `tam_ma_anh`, `tich_linh_quy`, `tich_thien_sat_thu`, `tam_ma_nguyen_anh`, `chap_niem_anh`, `ky_uc_meo`, `huyet_anh` — `MonsterDef.key` match thẳng placeholder thay vì `questTargetIds` alias vì các placeholder này là entity riêng (linh ảnh / tâm ma / sát thủ tâm cảnh) chứ không phải tên trừu tượng cho monster đã có; stat curve theo SPIRIT/HUMANOID tier mid + region map vào hac_lam/moc_huyen_lam/kim_son_mach/hoang_tho_huyet) + 2 invariant test mới (orphan-free `kill+monster` step + late-game key-match shape) + cập nhật critical-path test scope từ 7 → 15 placeholder — CLOSED ✅ (PR #433).
- **Story Foundation Late-game encounter wire** — wire 8 placeholder vào dungeon `monsters[]`: `hac_lam` + `tich_linh_anh`/`tam_ma_anh` (5 encounter), `moc_huyen_lam` + `tich_linh_quy`/`ky_uc_meo` (6 encounter), `kim_son_mach` + `tich_thien_sat_thu` (5 encounter), `hoang_tho_huyet` + `tam_ma_nguyen_anh`/`chap_niem_anh`/`huyet_anh` (7 encounter). 8 placeholder reachable qua `DungeonRunService.nextEncounter` runtime → quest auto-track via key match; **KHÔNG cần admin harness** `POST /admin/users/:id/quest-track` cho late-game (vẫn còn fallback). +1 invariant test `dungeons-balance.test.ts > 8 placeholder reachable trong DUNGEONS.monsters[]` ngăn drift — CLOSED ✅ (PR #439).
- **Story discoverability — QuestView dungeon hint cho kill+monster step** — CLOSED ✅ (PR #440). Thêm shared helper `findDungeonsForQuestPlaceholder(placeholderId): DungeonDef[]` resolve dungeon list qua direct key match HOẶC `MonsterDef.questTargetIds` alias (dedupe theo `dungeon.key`) + FE `QuestView.vue` render line "📍 Tìm tại: {dungeon names}" inline dưới mỗi `kill+monster` step (có `data-testid="quest-step-hint-{questKey}-{stepId}"`) + i18n `quest.stepHint.foundIn` vi/en parity + 5 shared test (4 success + 1 orphan defensive `[]`) + 4 FE test (direct match `tich_linh_anh→Hắc Lâm` + alias resolve `son_thu→...` + orphan no-render + non-kill no-render). UX gap close: player giờ thấy ngay dungeon đi cho mỗi quest step (8 late-game placeholder + 7 PR-6 critical-path) — KHÔNG cần tự tra catalog. Server-authoritative (FE chỉ render từ shared catalog data, KHÔNG suy luận). KHÔNG Prisma migration, KHÔNG endpoint mới, KHÔNG API change.

**Story / NPC / Quest runtime**: 5 NPC + 25 quest + 11 dialogue line (5 cảnh giới đầu: Phàm Nhân + Luyện Khí + Trúc Cơ + Kim Đan + Nguyên Anh). `QuestProgress` Prisma model live; `QuestService` server-authoritative validation (realm gate + prereq + CAS guard); kill step auto-tracked qua `CombatService` fail-soft hook; reward claim atomic qua ledger (`reason='QUEST_CLAIM'`, `refType='Quest'`, `refId=questKey`) đảm bảo idempotent (race-safe 1 winner / questKey).

**Story Foundation Extension** chỉ mở rộng catalog static cho cảnh giới 3-4 — KHÔNG tác động runtime (không Prisma migration, không API mới, không UI mới). Quest mới gate bởi `requiredRealmOrder>=3` (Kim Đan) và `>=4` (Nguyên Anh) nên không ảnh hưởng player đang ở 3 cảnh giới đầu; `QuestService` hiện tại (PR-2/3) đã dùng catalog dynamically nên tự động pick up quest mới sau khi merge.

**PR-5** thêm admin seed harness `POST /admin/users/:id/quest-track` wrap `QuestService.track()` cho kind kill/collect (RBAC ADMIN/MOD, validate `kind/targetType/targetId/amount`, audit `admin.quest.track`, realtime `state:update` push). Endpoint chuẩn bị cho E2E golden-path (`phamnhan_main_01` end-to-end accept → progress talk×2 → admin track kill 3 son_thu → claim) và future smoke positive-path. Anti-abuse: KHÔNG seed talk/explore/choice (gameplay-driven only); CANNOT_TARGET_SELF; tối đa `amount=999/lan goi`. KHÔNG Prisma migration, KHÔNG endpoint cho player.

**PR-6 (PR #432)** — **Discovery + Fix**: kill hook đã tồn tại từ PR-2 tại `apps/api/src/modules/combat/combat.service.ts:716` và `:1126` nhưng gọi `QuestService.track(charId, 'kill', 'monster', monster.key, 1)` với `monster.key` (vd `son_thu_lon`) trong khi quest catalog dùng placeholder `targetId='son_thu'` — mismatch silent fail-soft, **không quest nào thực sự progress** trong production. Admin harness PR-5 chỉ là workaround cho E2E. PR-6 fix bằng cách thêm `MonsterDef.questTargetIds?: string[]` vào shared catalog + map 7 monster vào quest placeholder (son_thu_lon→son_thu, da_quan→son_tac_dau_muc, huyet_lang→bac_lang_quan, hac_yeu_xa→hac_moc_yeu, kim_quang_thach_giap→kim_son_yeu, kim_dieu_thuong_phong→kim_dan_yeu_thu, hoang_tho_cu_yeu→hoang_tho_quy). Kill hook (2 call-site) loop `track(charId, 'kill', 'monster', id, 1)` cho `id ∈ [monster.key, ...questTargetIds]` (Set dedupe chống double-count). 5 integration test verify kill encounter → `phamnhan_grind_01` step_01 progress + `phamnhan_main_01` step_03 progress → quest auto-COMPLETED. KHÔNG Prisma migration, KHÔNG endpoint mới, KHÔNG FE change.

**Late-game placeholder wire status (post Foundation Late-game wire)**: 8 placeholder Trúc Cơ/Kim Đan/Nguyên Anh story (`chap_niem_anh`, `huyet_anh`, `ky_uc_meo`, `tam_ma_anh`, `tam_ma_nguyen_anh`, `tich_linh_anh`, `tich_linh_quy`, `tich_thien_sat_thu`) đã có monster catalog tương ứng (PR #433 — `MonsterDef.key === placeholder`, không qua `questTargetIds` alias). Combat kill hook PR-6 sẽ auto-track quest progress khi monster bị kill — KHÔNG cần thay đổi runtime.

**Late-game encounter integration**: **DONE** ✅ (PR #439 — Story Foundation Late-game encounter wire). 8 placeholder đã được đặt vào dungeon `monsters[]` theo region map từ Foundation Late-game wire #433:
- `hac_lam` (truc_co tier): + `tich_linh_anh` (lvl 5) + `tam_ma_anh` (lvl 6) → 5 encounter
- `moc_huyen_lam` (truc_co tier): + `tich_linh_quy` (lvl 7 truc_co) + `ky_uc_meo` (lvl 14 nguyen_anh, đặt cuối list cho story-driven hard-encounter — narrative-driven, không grind farm) → 6 encounter
- `kim_son_mach` (kim_dan tier): + `tich_thien_sat_thu` (lvl 11 HUMANOID) → 5 encounter
- `hoang_tho_huyet` (nguyen_anh tier): + `tam_ma_nguyen_anh` (lvl 14) + `chap_niem_anh` (lvl 15) + `huyet_anh` (lvl 15) → 7 encounter

Player giờ có thể kill placeholder qua `DungeonRunService.nextEncounter` (`POST /dungeon-runs/:runId/next`) — quest auto-track via key match, **KHÔNG cần admin harness** `POST /admin/users/:id/quest-track` nữa cho late-game (admin harness vẫn còn như fallback). Test backstop: `dungeons-balance.test.ts > 8 placeholder reachable trong DUNGEONS.monsters[]` ngăn drift.

**QuestView dungeon hint discoverability**: **DONE** ✅ (PR #440 — Story discoverability QuestView dungeon hint). Shared helper `findDungeonsForQuestPlaceholder(placeholderId): DungeonDef[]` resolve dungeon list qua direct key match (8 late-game placeholder Phase 12) HOẶC `MonsterDef.questTargetIds` alias (7 PR-6 critical-path placeholder), dedupe theo `dungeon.key`. FE `QuestView.vue` render line "📍 Tìm tại: {dungeon names}" inline dưới mỗi `kill+monster` step. UX gap close: player giờ thấy ngay dungeon đi cho mỗi quest step, KHÔNG cần tự tra catalog. Test backstop: 5 shared test (verify 8 late-game + 7 alias placeholder resolve ≥ 1 dungeon, dedupe parity, orphan defensive `[]`, region match concrete) + 4 FE test (direct match `tich_linh_anh→Hắc Lâm` + alias resolve + orphan no-render + non-kill no-render).

## 3. Implemented chapters

> Format: `<#> <realm_code>` — main quest + bao nhiêu side quest đã code, NPC giao quest, ngày + PR merge.

| # | Realm code | Main quest | Side quest catalog | Side quest runtime | NPC giao | Ngày | PR |
|---|---|---|---|---|---|---|---|
| 0 | `phamnhan` | `phamnhan_main_01` Hoa Thiên Tuyển Đồ | 4/4 (realm/sect/grind/npc) | 4/4 (accept/progress/track + storyChapter bump khi COMPLETED) | Lăng Vân Sinh, Mộc Thanh Y | 2026-05-05 | PR-1 + PR-2 |
| 1 | `luyenkhi` | `luyenkhi_main_01` Linh Khí Nhập Thể | 4/4 | 4/4 | Lăng Vân Sinh, Mộc Thanh Y, Hàn Dạ | 2026-05-05 | PR-1 + PR-2 |
| 2 | `truc_co` | `truc_co_main_01` Trúc Đạo Cơ | 4/4 | 4/4 | Lăng Vân Sinh, Mộc Thanh Y, Tô Nguyệt Ly | 2026-05-05 | PR-1 + PR-2 |
| 3 | `kim_dan` | `kim_dan_main_01` Kết Đan Phong Ba | 4/4 (realm/sect/grind/npc) | catalog-only (PR-2/3 runtime auto-pick) | Lăng Vân Sinh, Mộc Thanh Y, Huyết La Sát | 2026-05-05 | Story Foundation Extension |
| 4 | `nguyen_anh` | `nguyen_anh_main_01` Nguyên Anh Vấn Tâm | 4/4 | catalog-only (PR-2/3 runtime auto-pick) | Lăng Vân Sinh, Mộc Thanh Y, Huyết La Sát | 2026-05-05 | Story Foundation Extension |

**Runtime status**: catalog (PR-1 #425) + persistence (PR-2 #426 — `QuestProgress` Prisma + `QuestService.list/accept/progress/track`) + claim (PR-3 — `QuestService.claim` + `CurrencyLedger`/`ItemLedger` rows) DONE.

(Chuẩn bị để track 28 cảnh giới Phàm Nhân → Hư Không Chí Tôn — danh sách đầy đủ ở [`./TU_TIEN_LO_STORY_BIBLE.md`](./TU_TIEN_LO_STORY_BIBLE.md) §9.1.)

## 4. Implemented NPCs

> Format: `NPC name` — faction, dialogue catalog status, quest count, ngày + PR merge.

| NPC | Faction | Realm gate | Dialogue catalog | Dialogue UI | Quest giver count | Ngày | PR |
|---|---|---|---|---|---|---|---|
| Lăng Vân Sinh | hoa_thien_mon | 0 (phamnhan) | 4 line (default + truc_co + kim_dan + nguyen_anh) | Done ✅ (PR-4) | 10 quest (5 main + 4 realm + 1 sect) | 2026-05-05 | PR-1 + PR-4 + Extension |
| Mộc Thanh Y | hoa_thien_mon | 0 (phamnhan) | 4 line (default + luyen_khi + kim_dan + nguyen_anh) | Done ✅ (PR-4) | 11 quest (4 sect + 5 grind + 1 npc + 1 realm) | 2026-05-05 | PR-1 + PR-4 + Extension |
| Hàn Dạ | huyen_kiem_tong | 1 (luyenkhi) | 1 line (default rivalry) | Done ✅ (PR-4) | 1 quest (`luyenkhi_npc_01`) | 2026-05-05 | PR-1 + PR-4 |
| Tô Nguyệt Ly | null (lưu đày) | 2 (truc_co) | 1 line (default hidden) | Done ✅ (PR-4) | 1 quest (`truc_co_npc_01`) | 2026-05-05 | PR-1 + PR-4 |
| Huyết La Sát | huyet_ha_ma_tong | 3 (kim_dan) | 1 line (default ma đạo) | catalog-only (auto-pick UI sau merge) | 2 quest (`kim_dan_npc_01` + `nguyen_anh_npc_01`) | 2026-05-05 | Story Foundation Extension |

**Dialogue UI**: 4 NPC đều có `NpcDialogueModal.vue` server-authoritative (Phase 12 PR-4). Branch picker server-side filter theo realm + quest status; choice annotate sẵn `acceptQuestStatus` cho FE để disable quest đã accept/claimed.

(Chuẩn bị để track 4 NPC còn lại — Vạn Kim Nương, Bạch Đế Tử, Hoa Thiên Đạo Tổ, Tịch Thiên Đạo Chủ — sẽ thêm khi cảnh giới tương ứng được code.)

## 5. Implemented quest chains

> Format: `<chain name>` — cảnh giới, NPC, số bước, status (catalog / runtime / UI / claim).

| Chain key | Realm range | NPC chính | Quest count | Catalog | Runtime | UI | Claim |
|---|---|---|---|---|---|---|---|
| `hoa_thien_main` | phamnhan → nguyen_anh | Lăng Vân Sinh | 9 (5 main + 4 realm; +4 từ extension) | ✅ | ✅ (PR-2) | Missing | ✅ (PR-3) |
| `moc_thanh_y_arc` | truc_co → nguyen_anh | Lăng Vân Sinh + Mộc Thanh Y | 3 (`truc_co_sect_01` + `kim_dan_sect_01` + `nguyen_anh_sect_01`; +2 từ extension) | ✅ | ✅ (PR-2) | Missing | ✅ (PR-3) |
| `han_da_rivalry` | luyenkhi+ | Hàn Dạ | 1 (`luyenkhi_npc_01` Lời Thách Đấu) | ✅ | ✅ (PR-2) | Missing | ✅ (PR-3) |
| `to_nguyet_ly_hidden` | truc_co+ | Tô Nguyệt Ly | 1 (`truc_co_npc_01` Bóng Trong Sương) | ✅ | ✅ (PR-2) | Missing | ✅ (PR-3) |
| `huyet_la_sat_arc` | kim_dan → nguyen_anh | Huyết La Sát | 2 (`kim_dan_npc_01` Máu Trên Thềm Đá + `nguyen_anh_npc_01` Đêm Trảm Niệm) | ✅ (Extension) | ✅ (PR-2 auto-pick) | Missing | ✅ (PR-3 auto-pick) |

Standalone quest (no chain): 8 quest (5 sect + 3 grind — Trúc Cơ sect rời vào `moc_thanh_y_arc`; Kim Đan + Nguyên Anh grind standalone).

**Status**: catalog (PR-1) + runtime persistence (PR-2 — accept / progress / track / auto-COMPLETED) + claim (PR-3 — `QuestService.claim` ledger atomic) DONE. UI chờ PR-4 + PR-5.

(27 chuỗi quest cốt truyện đã design — danh sách đầy đủ ở [`./TU_TIEN_LO_STORY_BIBLE.md`](./TU_TIEN_LO_STORY_BIBLE.md) §11.)

## 6. Missing runtime modules

Để build được Phase 12 Story/NPC/Quest, các module sau cần code (theo thứ tự dependency):

| Module | Status | Ghi chú |
|---|---|---|
| **Quest catalog** (`QuestDef` + `QuestStepDef` + `QuestRewardDef`) | **Done** ✅ | Static ở `packages/shared/src/quests.ts` (25 quest — 5 cảnh giới đầu). 5 step kind: kill / collect / talk / explore / choice. PR-1 #425 merged 15 quest (3 cảnh giới); Story Foundation Extension thêm 10 quest cho Kim Đan + Nguyên Anh. |
| **NPC catalog** (`NpcDef`) | **Done** ✅ | Static ở `packages/shared/src/npcs.ts` (5 NPC — 5 cảnh giới đầu). PR-1 #425 merged 4 NPC; Story Foundation Extension thêm Huyết La Sát. |
| **Dialogue catalog skeleton** (`DialogueLineDef` + `DialogueChoiceDef` + `DialogueBranchCondition`) | **Done** ✅ | Static ở `packages/shared/src/dialogues.ts` (11 line, branch `always` / `realm_min` / `quest_status` / `faction_member`). `pickDialogueForNpc()` helper PR-1 (chỉ implement `always` + `realm_min`; `quest_status` + `faction_member` vẫn chỉ runtime PR-4). PR-1 #425 merged 8 line (default + 4 branch); Story Foundation Extension thêm 5 line (LVS kim_dan/nguyen_anh + MTY kim_dan/nguyen_anh + Huyết La Sát default). |
| **QuestProgress** (per-character) | **Done** ✅ | Prisma model với unique `(characterId, questKey)` + status enum (`LOCKED / AVAILABLE / ACCEPTED / COMPLETED / CLAIMED`) + JSON `stepProgress` counters + timestamps. Migration `20260520000000_phase_12_pr2_quest_runtime`. PR-2 merged. |
| **Quest service** (`QuestService.list / accept / progress / track`) | **Done** ✅ | `apps/api/src/modules/quest/`. Server-authoritative validation: realm gate (`Character.realmStage` order >= `QuestDef.requiredRealmOrder`), prerequisite quest, CAS guards (`where {id, status: OLD}`), fail-soft `track()` hook from `CombatService` kill events. PR-2 merged. |
| **Story chapter tracking** | **Done** ✅ | `Character.storyChapter` Int field bumped khi main quest `COMPLETED` (chapter index = `realmOrder + 1`). PR-2 merged. |
| **Reward claim** (`QuestService.claim`) | **Done** ✅ | `apps/api/src/modules/quest/quest.service.ts:claim()`. CAS guard `updateMany({where:{id, status:'COMPLETED', claimedAt:null}})` → `status='CLAIMED'`. Grant linhThach/tienNgoc qua `CurrencyService.applyTx` (`reason='QUEST_CLAIM'`, `refType='Quest'`, `refId=questKey`); exp/congHien qua `tx.character.update`; items qua `InventoryService.grantTx`. Idempotency: race-safe 1 winner / questKey (concurrency test xác nhận 2 parallel claim → đúng 1 ledger row). PR-3 merged. |
| **Quest UI** (`QuestView.vue` + Pinia store) | **Done** ✅ (Story Runtime MVP PR #430) | List 25 quest + filter (main/realm/sect/npc/grind) + status badge (LOCKED/AVAILABLE/ACCEPTED/COMPLETED/CLAIMED) + accept/claim button gated by status (server-authoritative) + toggle expand step + reward + loading/empty/error + i18n vi/en parity. Pinia store `useQuestStore` mirror server `GET /quests/me` + dispatch `POST /quests/accept` + `POST /quests/claim` rồi reload list. Tuân UI MODULE RULE: 1 view = 1 PR. Phase 12 Story Runtime MVP. |
| **NPC dialogue UI** (`NpcDialogueModal.vue` + `NpcView.vue`) | **Done** ✅ | Server endpoint `GET /npcs/me` (list visible) + `GET /npcs/:npcKey/dialogue` (refetch sau accept). Server-authoritative branch picker (`always` / `realm_min` / `quest_status` / `faction_member` placeholder) + sort specificity (highest first). Choice với `acceptQuestKey` annotate `acceptQuestStatus` (NOT_STARTED / AVAILABLE / ACCEPTED / COMPLETED / CLAIMED / LOCKED) — FE disable button đã accept. Pinia store cache dialogue trong list, force refetch sau quest accept. Phase 12 PR-4. |
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

### PR-4 — NPC dialogue UI (Medium, FE + BE wiring) — **CLOSED** ✅ (PR #428)

- **BE module** `apps/api/src/modules/npc/`:
  - `NpcModule` (read-only — imports `AuthModule` only; không phụ thuộc `CharacterModule` / `InventoryModule` vì không mutate).
  - `NpcService.listForUser(userId)` — load `Character.realmKey` + `QuestProgress[]` snapshot, filter NPC visible bằng `realmGateOrder <= character.realmOrder`, build `NpcView[]` kèm dialogue đã pick branch.
  - `NpcService.getDialogueForNpc(userId, npcKey)` — validate NPC unlock + pick dialogue line; throw `NpcError` (NO_CHARACTER 404 / NPC_UNKNOWN 404 / NPC_LOCKED_REALM 403 / NO_DIALOGUE 404).
  - `pickDialogue(npc, ctx)` — sort `DialogueLineDef` candidates theo `specificityScore` (`quest_status=4 > realm_min{order}+3 > faction_member=2 > always=1`) rồi return first match. `lineMatches()` cho `realm_min` so với `ctx.realmOrder`; cho `quest_status` so với `ctx.questStatus.get(questKey)`; cho `faction_member` placeholder (chưa có `Character.faction`).
  - `annotateChoice(c, ctx)` — annotate `acceptQuestStatus` cho choice với `acceptQuestKey`: NOT_STARTED nếu QuestProgress chưa có row; còn lại return status từ DB. FE đọc field này để disable choice đã ACCEPTED/COMPLETED/CLAIMED/LOCKED.
- **BE controller** `NpcController`:
  - `GET /npcs/me` — auth gate + list. Envelope `{ok: true, data: {npcs}}`.
  - `GET /npcs/:npcKey/dialogue` — auth gate + zod regex (`/^npc_[a-z0-9_]+$/`). Envelope `{ok: true, data: {dialogue}}`. Refresh dialogue sau quest accept (vì `quest_status` condition có thể đã đổi).
  - `NpcModule` đã wire vào `app.module.ts`.
- **FE module**:
  - `apps/web/src/api/npc.ts` (typed client) + `apps/web/src/api/quest.ts` (minimal `acceptQuest()` cho dialogue choice — PR-5 expand).
  - `apps/web/src/stores/npc.ts` (Pinia) — `npcs` / `loaded` / `loading` / `lastError` + `activeNpcKey` / `activeDialogue` / `dialogueLoading` / `dialogueError`. `openDialogue(key, {force})` ưu tiên cache trong list; `refreshActiveDialogue()` force fetch sau quest accept.
  - `apps/web/src/views/NpcView.vue` (list visible NPC + click → mở modal) + `apps/web/src/components/NpcDialogueModal.vue` (Teleport overlay, render text + choices, click choice với `acceptQuestKey` → call `POST /quests/accept` → reload list + refetch dialogue + emit `questAccepted`).
  - Router `/npcs` + nav `AppShell.vue` (人 Đạo Hữu / NPCs).
  - i18n `npc.title / .subtitle / .talk / .empty / .visibleCount / .questCount / .faction.* / .errors.* / .dialogue.empty / .dialogue.acceptOk / .dialogue.questStatus.* / .dialogue.errors.*` cả VI và EN (parity test pass).
- **Test**: 26 BE test (`npc.service.test.ts` 14 + `npc.controller.test.ts` 12) cover NO_CHARACTER / NPC_UNKNOWN / NPC_LOCKED_REALM / branch filter (default vs truc_co realm_min) / choice annotation (NOT_STARTED → ACCEPTED) / catalog integrity. 19 FE test (`NpcDialogueModal.test.ts` 10 + `stores/npc.test.ts` 9) cover render / loading / error / accept-quest happy + error path / disable-when-accepted / Esc + backdrop close / cache vs force refetch / reset.
- **Smoke** `scripts/smoke-npc.mjs` 11 step: auth gate (401) cả 2 endpoint, register fresh user, NO_CHARACTER pre-onboard (404), onboard, list shape, INVALID_INPUT zod (400), NPC_UNKNOWN (404), NPC_LOCKED_REALM (403, truc_co gate vs luyenkhi char), positive dialogue (200) shape.
- **Tuân** UI MODULE RULE: server-authoritative dialogue + quest status; FE chỉ render. KHÔNG có mutation endpoint mới — quest accept tái dùng `POST /quests/accept` (PR-2 #426).
- Update §2 / §4 / §6 / §7 progress tracker.

### PR-5 — Main storyline Chapter 1 playable — **CLOSED** ✅ (PR #431)

- **Scope**: wire `phamnhan_main_01` (Hoa Thiên Tuyển Đồ) end-to-end UI flow + admin seed harness cho E2E.
  - `apps/api/src/modules/admin/admin.service.ts` — `grantQuestTrack(actorId, actorRole, targetUserId, input)` wrap `QuestService.track(charId, kind, targetType, targetId, amount)`. Validate `kind∈{kill,collect}` + `targetType∈{monster,item}` + `amount∈[1,999]` + `CANNOT_TARGET_SELF` + RBAC ADMIN/MOD + audit `admin.quest.track` + realtime `state:update`.
  - `apps/api/src/modules/admin/admin.controller.ts` — `POST /admin/users/:id/quest-track` zod validate + `RequireAdmin` guard + delegate to `AdminService.grantQuestTrack`.
  - `apps/api/src/modules/admin/admin.module.ts` — import `QuestModule` để inject `QuestService`.
  - `apps/api/src/modules/admin/admin-grant-quest-track.service.test.ts` — 13 unit test (positive single-shot, partial multi-call, validation kind/targetType/targetId/amount, RBAC, audit, fail-soft no-op khi không có ACCEPTED quest match, KHÔNG trùng monster mismatch).
  - 13 admin test files cập nhật constructor add `quests: QuestService` (`new AdminService(prisma, chars, topup, realtime, currency, inventory, quests)`).
  - `apps/web/e2e/helpers.ts` — `adminQuestTrack(targetUserId, input)` helper mirror `adminSeedTalent` pattern (separate `APIRequestContext` cho admin cookie jar không đụng player session).
  - `apps/web/e2e/golden.spec.ts` §21 spec mới: onboard fresh char (luyenkhi/1 unlock phamnhan_main_01) → `/quests` row visible + AVAILABLE → click accept button → ACCEPTED → POST `/quests/progress` step_01+step_02 (talk×2) → `adminQuestTrack(seed.userId, {kind:'kill', targetType:'monster', targetId:'son_thu', amount:3})` → reload `/quests` COMPLETED → click claim → CLAIMED + `getCharacterMe()` linhThach +100 + exp delta + `listInventoryApi()` so_kiem qty ≥ 1.
- **Test**: api 1907 → **1920** (+13 admin grant-quest-track), shared 1328 unchanged, web 1126 unchanged. E2E golden-path **20 → 21 spec**. Total **4361 → 4374 vitest**. Smoke `smoke-quest.mjs` doc cross-link tới E2E spec (positive flow đã cover qua E2E thay vì smoke vì smoke chưa có admin session helper).
- **Server-authoritative**: KHÔNG endpoint mới cho player (admin endpoint guarded ADMIN/MOD). KHÔNG Prisma migration. KHÔNG FE state mutation. Tất cả ledger row do server tạo (PR-3 atomic claim).
- **Anti-FE-self-grant**: spec KHÔNG fake ledger / KHÔNG bypass server. Tất cả mutation round-trip qua endpoint.
- **Anti-abuse**: admin endpoint không seed talk/explore/choice (gameplay-driven only); CANNOT_TARGET_SELF; max amount 999.

### Story Foundation Extension — Kim Đan + Nguyên Anh catalog — **CLOSED** ✅ (2026-05-05)

- Catalog-only extension: 15 quest → 25 (5 Kim Đan + 5 Nguyên Anh), 4 NPC → 5 (+ Huyết La Sát realm 3), 6 dialogue → 11.
- Chain mới: `huyet_la_sat_arc` (2 step kim_dan → nguyen_anh) + extend `hoa_thien_main` (3 → 5 step) + `moc_thanh_y_arc` (1 → 3 step).
- Integrity test: shared 1321 → 1328 (+7), regex `VALID_KIND_REGEX` thêm `kim_dan|nguyen_anh`, chain assertion mới (sequential prereq cross-realm), main exp scaling (1500→3500→8000→12500→22000).
- KHÔNG Prisma migration ✅, KHÔNG runtime ✅, KHÔNG UI ✅.
- `QuestService.list()` runtime hiện tại tự động pick up quest mới sau merge — gate `requiredRealmOrder>=3/4` không phá player ở 3 cảnh giới đầu.

### Story Runtime MVP (Phase 12 PR-5 stub) — Quest UI list + accept + claim — **DONE** ✅ (PR #430)

- **Scope (UI MODULE RULE — 1 view = 1 PR)**:
  - `apps/web/src/views/QuestView.vue` — list 25 quest + filter (main/realm/sect/npc/grind) + status badge LOCKED/AVAILABLE/ACCEPTED/COMPLETED/CLAIMED + accept button (gated `status===AVAILABLE`) + claim button (gated `status===COMPLETED`) + toggle expand step + reward + loading/empty/error.
  - `apps/web/src/stores/quest.ts` — Pinia store mirror server `GET /quests/me`. Action `accept(key)` / `claim(key)` reload list từ server. Computed `filteredQuests` / `activeCount` / `claimableCount` cho badge.
  - `apps/web/src/api/quest.ts` — typed wrapper `fetchQuests` / `acceptQuest` / `claimQuest`. Re-export PR-4 acceptQuest signature giữ nguyên backward compat.
  - Router `/quests` (name `quests`, auth-required), nav AppShell (sau `/npcs`).
  - i18n vi/en parity (test pass): `quest.title / .subtitle / .totalCount / .empty / .emptyFiltered / .accept / .claim / .acceptOk / .claimOk / .acceptedHint / .claimedHint / .lockedHint / .filter.all / .kind.* / .stepKind.* / .status.* / .reward.* / .errors.*`.
- **Server-authoritative**: tất cả mutation đi qua `POST /quests/accept` (PR-2 #426) + `POST /quests/claim` (PR-3 #427). FE KHÔNG tự cộng EXP/linhThach/item; chỉ render server response.
- **Test**: `apps/web/src/stores/__tests__/quest.test.ts` (15 case) cover load happy/error/unknown / kindFilter / activeCount / claimableCount / accept happy/fail / claim happy/fail / reset. `apps/web/src/views/__tests__/QuestView.test.ts` (13 case) cover render list + status badge + loading + error + empty filtered / filter main+all toggle / accept button enable/disable theo status + toast / claim button gated COMPLETED + reload sau success / toggle expand chi tiết step+reward.
- **Build/typecheck/lint**: web 1126/1126 PASS, repo typecheck PASS, repo lint PASS.
- **KHÔNG Prisma migration**, **KHÔNG service mới**, **KHÔNG endpoint mới** — chỉ UI consume PR-2/3 sẵn có.
- Update §6 Quest UI Done + §7 (this section).

### PR-6 — Combat kill hook → quest track auto-wire — **CLOSED** ✅ (PR #432)

- **Discovery**: kill hook đã tồn tại từ PR-2 tại `apps/api/src/modules/combat/combat.service.ts:716` và `:1126` nhưng gọi `QuestService.track(charId, 'kill', 'monster', monster.key, 1)` với `monster.key` (vd `son_thu_lon`) trong khi quest catalog dùng placeholder `targetId='son_thu'` — mismatch silent fail-soft, **không quest nào thực sự progress** trong production.
- **Shared**: `MonsterDef.questTargetIds?: string[]` alias field + map 7 monster sơn cốc/hắc lâm/kim sơn mạch/hoàng thổ huyết → quest placeholder (`son_thu_lon→son_thu`, `da_quan→son_tac_dau_muc`, `huyet_lang→bac_lang_quan`, `hac_yeu_xa→hac_moc_yeu`, `kim_quang_thach_giap→kim_son_yeu`, `kim_dieu_thuong_phong→kim_dan_yeu_thu`, `hoang_tho_cu_yeu→hoang_tho_quy`) + 5 integrity test.
- **API**: kill hook (2 call-site) loop `track(charId, 'kill', 'monster', id, 1)` cho `id ∈ [monster.key, ...questTargetIds]` (Set dedupe chống double-count) + 5 integration test combat encounter → quest progress → COMPLETED.
- **KHÔNG** Prisma migration, **KHÔNG** endpoint mới, **KHÔNG** FE change. Test baseline: api 1925 (+5 integration), shared 1333 (+5 invariants), web 1126.

### Story Foundation Late-game wire — 8 monster catalog cho Trúc Cơ/Kim Đan/Nguyên Anh story placeholder — **CLOSED** ✅ (PR #433)

- **Context**: PR-6 wire 7 critical-path placeholder qua `MonsterDef.questTargetIds` alias trên monster đã có. 8 placeholder còn lại (`tich_linh_anh`, `tam_ma_anh`, `tich_linh_quy`, `tich_thien_sat_thu`, `tam_ma_nguyen_anh`, `chap_niem_anh`, `ky_uc_meo`, `huyet_anh`) là entity riêng (linh ảnh / tâm ma / sát thủ tâm cảnh) — không có monster đã có để alias.
- **Shared**: thêm 8 `MonsterDef` mới vào `packages/shared/src/combat.ts` (`MONSTERS.length` 36 → 44) với `key` match thẳng placeholder (vd `tich_linh_anh` → `MonsterDef{key:'tich_linh_anh'}` không cần alias).
- **Stat curve** theo SPIRIT/HUMANOID tier mid (`docs/BALANCE_MODEL.md` §5.1):
  - Trúc Cơ realm 2 (level 5-7): `tich_linh_anh` lvl 5 (hp 150 / atk 20 / exp 100), `tam_ma_anh` lvl 6 (hp 195 / atk 26 / exp 130), `tich_linh_quy` lvl 7 (hp 250 / atk 32 / exp 175).
  - Kim Đan realm 3 (level 11): `tich_thien_sat_thu` lvl 11 (hp 580 / atk 75 / exp 450, HUMANOID kim đan, regionKey `kim_son_mach`).
  - Nguyên Anh realm 4 (level 14-15): `tam_ma_nguyen_anh` lvl 14 (hp 940 / atk 100 / exp 740), `chap_niem_anh` lvl 15 (hp 1050 / atk 110 / exp 850), `ky_uc_meo` lvl 14 (hp 920 / atk 95 / exp 720, element moc), `huyet_anh` lvl 15 (hp 1080 / atk 115 / exp 880, HUMANOID).
- **Region map**: `hac_lam` × 2 (`tich_linh_anh` + `tam_ma_anh`), `moc_huyen_lam` × 2 (`tich_linh_quy` + `ky_uc_meo`), `kim_son_mach` × 1 (`tich_thien_sat_thu`), `hoang_tho_huyet` × 3 (`tam_ma_nguyen_anh` + `chap_niem_anh` + `huyet_anh`).
- **Test**: `packages/shared/src/combat.test.ts`:
  - Mở rộng critical-path test scope `phamnhan/luyen_khi/truc_co/kim_dan/nguyen_anh` từ 7 → 15 placeholder (cover cả 8 mới).
  - **Invariant orphan-free** mới: scan toàn bộ `QUESTS` catalog tìm step `kind:'kill', targetType:'monster'`, đảm bảo `targetId` resolve đến ≥ 1 `MonsterDef` qua `key === X` HOẶC `questTargetIds.includes(X)`. Test này backstop mọi PR catalog tương lai (ngăn drift trở lại trạng thái pre-PR-6).
  - **Late-game key-match test** mới: 8 placeholder mới resolve qua `MonsterDef.key` match thẳng (không qua `questTargetIds` alias) — verify `monsterByKey(placeholder)` defined + `questTargetIds === undefined`.
- **Runtime KHÔNG đổi**: kill hook PR-6 đã đúng pattern (loop `[monster.key, ...questTargetIds]`). 8 monster mới resolve trực tiếp qua `monster.key === placeholder`. Catalog đủ để combat kill hook auto-track quest progress khi monster bị spawn qua admin harness hoặc encounter/dungeon mới.
- **KHÔNG** Prisma migration, **KHÔNG** endpoint mới, **KHÔNG** FE change. Test baseline: api 1925 (unchanged — runtime không đổi), shared **1335** (+2 invariant), web 1126.
- **Pending follow-up**: 8 monster mới chưa được đặt vào dungeon `monsters[]` array hoặc encounter spawn list — player chưa thực tế kill được qua combat flow. Phase 12.2.B `DungeonTemplate` runtime hoặc story-driven encounter sẽ wire thêm. Hiện tại admin harness `POST /admin/users/:id/quest-track` (PR-5) vẫn là cách verify late-game quest progression. **Follow-up đã đóng** ✅ — placeholder vào dungeon `monsters[]` qua **PR #439** (Story Foundation Late-game encounter wire).
- Update §2 / §3 / §6 (catalog status) / §7 (this section).

### Story Foundation Late-game encounter wire — wire 8 placeholder vào dungeon `monsters[]` — **CLOSED** ✅ (PR #439)

- Wire 8 placeholder Trúc Cơ/Kim Đan/Nguyên Anh vào 4 dungeon `monsters[]`: `hac_lam` + `tich_linh_anh`/`tam_ma_anh` (5 encounter), `moc_huyen_lam` + `tich_linh_quy`/`ky_uc_meo` (6 encounter), `kim_son_mach` + `tich_thien_sat_thu` (5 encounter), `hoang_tho_huyet` + `tam_ma_nguyen_anh`/`chap_niem_anh`/`huyet_anh` (7 encounter).
- 8 placeholder reachable qua `DungeonRunService.nextEncounter` runtime → quest auto-track via key match. **KHÔNG cần admin harness** `POST /admin/users/:id/quest-track` cho late-game (admin harness vẫn còn như fallback).
- Test backstop: +1 invariant `dungeons-balance.test.ts > 8 placeholder reachable trong DUNGEONS.monsters[]` ngăn drift catalog.
- **KHÔNG** Prisma migration, **KHÔNG** endpoint mới, **KHÔNG** FE change.

### Story discoverability — QuestView dungeon hint cho kill+monster step — **CLOSED** ✅ (PR #440)

- **Shared**: thêm helper `findDungeonsForQuestPlaceholder(placeholderId): DungeonDef[]` (`packages/shared/src/combat.ts`) resolve dungeon list qua direct key match HOẶC `MonsterDef.questTargetIds` alias (dedupe theo `dungeon.key`).
- **FE**: `QuestView.vue` render line "📍 Tìm tại: {dungeon names}" inline dưới mỗi `kill+monster` step (có `data-testid="quest-step-hint-{questKey}-{stepId}"`). Server-authoritative — FE chỉ render từ shared catalog data, KHÔNG suy luận.
- **i18n**: `quest.stepHint.foundIn` vi/en parity (test pass).
- **Test**: 5 shared test (4 success path: 8 late-game direct match + 7 PR-6 alias resolve + dedupe parity + region match concrete; 1 orphan defensive `[]`) + 4 FE test (direct match `tich_linh_anh→Hắc Lâm` + alias resolve `son_thu→...` + orphan no-render + non-kill no-render).
- **UX gap close**: player giờ thấy ngay dungeon đi cho mỗi `kill+monster` quest step (8 late-game placeholder + 7 PR-6 critical-path) — KHÔNG cần tự tra catalog.
- **KHÔNG** Prisma migration, **KHÔNG** endpoint mới, **KHÔNG** API change. Test baseline: shared **1359** (+5), web **1163** (+4), api 1975 unchanged.

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
