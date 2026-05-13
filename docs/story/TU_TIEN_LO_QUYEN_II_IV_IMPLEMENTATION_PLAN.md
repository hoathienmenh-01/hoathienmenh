# Tu Tiên Lộ — Quyển II–IV Implementation Plan

> **Phase 33.0** — Story Quest Expansion V2. AI/dev mới đọc [`PHASE12_STORY_PROGRESS.md`](./PHASE12_STORY_PROGRESS.md) trước, sau đó đọc file này để biết Phase 33 chia thành các sub-PR như thế nào.

---

## 1. Mục tiêu Phase 33

Phase 33 expand cốt truyện game từ chương 9 đến 27 (19 chương) thuộc 3 Quyển:

- **Quyển II — Tiên Giới** (Chap 9 → 16, realm order 9..16): tu sĩ vừa vượt Cửu Trọng Thiên Kiếp, phi thăng tiên giới.
- **Quyển III — Thánh Đạo Vạn Thiên** (Chap 17 → 21, order 17..21): trảm tam niệm, lập đạo riêng, đối đầu Thiên Đạo Bản Ngã.
- **Quyển IV — Bản Nguyên Vĩnh Hằng** (Chap 22 → 27, order 22..27): chạm Bản Nguyên Hải, mở 5 endgame route.

Tổng: 19 chương × 11 quest = 209 quest mới + 7 NPC mới + 19 boss climax + 19 story dungeon.

---

## 2. Source of truth

| File | Vai trò |
|---|---|
| File 5 `Cau_lenh_Phase_33_Story_Quest_Expansion_Quyen_II_IV.docx` | Spec chính (catalog scope, tests, PR plan, forbidden actions). |
| File 4 `TuTienLo_Master_QuyenII_IV_AI_Implementation.docx` | **Source ưu tiên cao nhất** khi xung đột narrative. |
| File 1 `TuTienLo_QuyenII_TienGioi_CotTruyen.docx` | Cốt truyện chi tiết Quyển II (Chap 9..16). |
| File 2 `TuTienLo_QuyenIII_ThanhDaoVanThien_CotTruyen.docx` | Cốt truyện chi tiết Quyển III (Chap 17..21). |
| File 3 `TuTienLo_QuyenIV_BanNguyenVinhHang_CotTruyen.docx` | Cốt truyện chi tiết Quyển IV (Chap 22..27). |

Khi conflict: file 4 > file 1-3 > existing Phase 12/21 code > markdown bible. KHÔNG bịa cốt truyện ngoài 5 file.

---

## 3. PR plan

Phase 33 chia thành **3 sub-PR** liên tiếp:

### Phase 33.0 — Catalog Foundation (THIS PR)

**Scope**: shared catalog + tests + docs. KHÔNG runtime / migration / web UI.

**Files**:
- `packages/shared/src/story-chapters-quyen-ii-iv.ts` (~1100 dòng).
- `packages/shared/src/story-quest-expansion.ts` (~2600 dòng).
- `packages/shared/src/story-quest-expansion.test.ts` (38 tests).
- `packages/shared/src/npcs.ts` (+7 NPC, lines 304-381).
- `packages/shared/src/dialogues.ts` (+7 default).
- `packages/shared/src/npc-affinity.ts` (+7 config).
- `packages/shared/src/npc-affinity-shop.ts` (+7 minimal seeds).
- `packages/shared/src/npc-gift.ts` (+7 preferences).
- `packages/shared/src/story-dialogues.ts` (+7 phase33 seed).
- `packages/shared/src/index.ts` (+2 exports).
- 4 markdown docs (this file + 3 Quyển docs).
- PHASE12_STORY_PROGRESS.md + AI_HANDOFF_REPORT.md update.

**Acceptance criteria**: 38 new integrity tests + 3657 existing tests pass; typecheck/lint clean; PR template tuân thủ; CI green.

### Phase 33.1 — Runtime Wire (NEXT PR)

**Scope**: API runtime + Prisma migration + service integration.

**Tasks**:
- Wire `phase33QuestsForChapter` vào `QuestService.list`/`accept`/`progress`/`claim` runtime.
- Tạo Prisma migration `additive` cho `StoryProgressionV2` (nếu cần) — track chapter status per character.
- Wire `phase33ChapterByKey` vào `StoryProgressionService` — unlock chapter sau realm hit + previous chapter cleared.
- API endpoint `GET /story/v2/chapters` + `GET /story/v2/chapters/:chapKey/quests`.
- Smoke test Quyển II Chap 9-10 accept/progress/claim end-to-end.

**Tests**: API service test mỗi chapter unlock + claim + idempotency.

### Phase 33.2 — Web UI (NEXT PR sau 33.1)

**Scope**: FE Story V2 view + quest list filter + i18n.

**Tasks**:
- `apps/web/src/views/StoryV2View.vue` — list 19 chapter card với progress.
- `apps/web/src/views/StoryV2ChapterView.vue` — chapter detail (5 main + 3 side + 1 hidden + 1 daily + 1 weekly).
- Reuse `QuestView.vue` pattern cho quest list filter (kind/chapKey/status).
- i18n VI/EN keys `storyV2.*` parity.
- Loading/empty/error states (UI MODULE RULE).
- Web tests cho component coverage.

---

## 4. Constraints

Tuân thủ spec file 5 + Phase 12 conventions:

- **Reward cap**: theo Quyển (xem doc per-Quyển §3) — KHÔNG endgame freebie.
- **Realm gate**: mỗi chapter có `requiredRealmKey/Order`; quest cũng có `requiredRealmOrder`. KHÔNG bypass.
- **Reward path**: tất cả reward đi qua `CurrencyLedger`/`ItemLedger`/`AffinityLedger` service. KHÔNG raw SQL.
- **Idempotency**: dùng `RewardLedger.requestKey` pattern existing.
- **No Phase 21 collision**: 209 quest mới phải có key prefix `q_chXX_` (XX 09..27) — phân biệt với Phase 21 keys `phase21_chXX_*`.
- **Forbidden actions** (spec §58-68): KHÔNG push main, KHÔNG reset Phase 12/21 system, KHÔNG skip tests, KHÔNG bypass ledger, KHÔNG duplicate reward, KHÔNG grant endgame items, KHÔNG bịa cốt truyện.

---

## 5. Testing strategy

Phase 33.0 (this PR) test scope:

- `story-quest-expansion.test.ts` (38 tests):
  - 13 test chapter catalog (count, realm gate, volume range, ending flag).
  - 17 test quest catalog (kind counts, unique key, NPC giver resolves, reward cap, hidden gate, no forbidden item, story flag convention).
  - 5 test progression chain Ch9→Ch27 (Ch16 unlock III, Ch21 unlock IV, Ch27 ending flags).
  - 3 test Phase 21 untouched (120 main quest + ≥160 side preserved).
- `npcs.test.ts` update: NPCS length 19, faction counts hoa_thien_mon=5/tich_thien_dien=3/wandering=5.
- Existing tests (`dialogues.test.ts`, `npc-affinity*.test.ts`, `npc-gift.test.ts`, `story-dialogues.test.ts`) all green sau khi add minimal seeds cho 7 NPC mới.

Total: 3657 shared tests pass after Phase 33.0 merge.

Phase 33.1 (next PR) sẽ thêm API service test + smoke test catalog flow.

Phase 33.2 (next PR) sẽ thêm web test.

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Reward inflation từ 209 quest mới | Reward cap policy per Quyển (file 5 §169-179); validator test trong story-quest-expansion.test.ts. |
| Endgame item freebie | Forbidden regex list (file 5 §178-188); `_tien_ngoc_nap`/`_top_tier_freebie`/etc rejected. |
| Phase 21 collision | Key namespace tách biệt `q_chXX_*` vs `phase21_chXX_*`; test backstop. |
| Boss/dungeon orphan | `phase33ReferencedBossKeys`/`phase33ReferencedDungeonKeys` validate ở test. Catalog reference only — runtime spawn ở Phase 33.1. |
| Story flag bloat | 4 namespace fixed: `flag_chXX_*`/`route_chXX_*`/`flag_volume_*_unlocked|cleared`/`ending_*`. |
| Player bypass realm gate | `requiredRealmOrder` enforce ở runtime (Phase 33.1). Catalog dòng đầu là gate. |

---

## 7. Tham chiếu

- Phase 12 foundation: [`./PHASE12_STORY_PROGRESS.md`](./PHASE12_STORY_PROGRESS.md).
- Story bible: [`./TU_TIEN_LO_STORY_BIBLE.md`](./TU_TIEN_LO_STORY_BIBLE.md).
- Quyển II detail: [`./TU_TIEN_LO_QUYEN_II_TIEN_GIOI.md`](./TU_TIEN_LO_QUYEN_II_TIEN_GIOI.md).
- Quyển III detail: [`./TU_TIEN_LO_QUYEN_III_THANH_DAO_VAN_THIEN.md`](./TU_TIEN_LO_QUYEN_III_THANH_DAO_VAN_THIEN.md).
- Quyển IV detail: [`./TU_TIEN_LO_QUYEN_IV_BAN_NGUYEN_VINH_HANG.md`](./TU_TIEN_LO_QUYEN_IV_BAN_NGUYEN_VINH_HANG.md).
- Workflow rules: [`../AI_WORKFLOW_RULES.md`](../AI_WORKFLOW_RULES.md).
- Balance model: [`../BALANCE_MODEL.md`](../BALANCE_MODEL.md).
