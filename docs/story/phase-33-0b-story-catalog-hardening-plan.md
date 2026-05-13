# Phase 33.0B — Story Catalog Hardening Plan

> **Stacked PR A** thuộc chuỗi Phase 33: `PR A (33.0B catalog hardening) → PR B (33.1 runtime wire) → PR C (33.2 web UI) → PR D opt (33.3 world objective deep wire)`. Doc này chỉ scope cho PR A.

---

## 1. Mục tiêu

Phase 33.0 (PR #564) đã có foundation catalog cho Ch9..Ch27, nhưng quest density còn quá mỏng so với scope endgame. Phase 33.0B hardening để:

1. Tăng quest density mỗi chương lên mức endgame phù hợp.
2. Thêm `branch` quest kind cho các nhánh affinity/lore/hidden phụ.
3. Reward scaling theo `requiredRealmOrder` chứ không chỉ cap theo Quyển.
4. NPC scaling theo realm tier (đảm bảo mỗi chương có ≥ 3 NPC liên quan; ≥ 1 NPC `realmGateOrder` gần `requiredRealmOrder`).
5. Test integrity mở rộng (density, branch, reward tier, NPC gate).

**KHÔNG làm trong PR A**: Prisma migration, API/runtime wire, QuestService runtime, web UI, story progression V2 model. Những phần đó nằm trong PR B / PR C.

---

## 2. Quest density target (per chapter)

| Kind | Trước (Phase 33.0) | Sau (Phase 33.0B) | Δ / chap |
|---|---|---|---|
| MAIN | 5 | **16** (15–20) | +11 |
| SIDE | 3 | **11** (10–15) | +8 |
| BRANCH | 0 | **6** (5–8) | +6 |
| HIDDEN | 1 | **3** (2–4) | +2 |
| DAILY | 1 | **1** | 0 |
| WEEKLY | 1 | **1** | 0 |
| **Tổng / chap** | **11** | **38** | **+27** |

**Tổng catalog**:
- Phase 33.0: 11 × 19 = **209 quest**.
- Phase 33.0B target: 38 × 19 = **722 quest** (trong khoảng 650–850 spec yêu cầu).
- Δ: **+513 quest** mới.

---

## 3. Audit hiện trạng Ch9..Ch27

> **Volume**: II = Quyển II Tiên Giới (`reward_policy_quyen_ii`); III = Quyển III Thánh Đạo Vạn Thiên (`reward_policy_quyen_iii`); IV = Quyển IV Bản Nguyên Vĩnh Hằng (`reward_policy_quyen_iv`).

| Chap | Realm | Vol | Theme | M | S | B | H | D | W | Cần thêm | NPC liên quan (realmGate) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Ch9 | do_kiep (9) | II | Cửu Trọng Thiên Kiếp | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Lăng Vân Sinh (5) · Mộc Thanh Y (7) · Hàn Dạ (5) |
| Ch10 | nhan_tien (10) | II | Phi Thăng Doanh | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Lăng Vân Sinh (5) · Tô Nguyệt Ly (6) · **Lục Bình (9)** |
| Ch11 | dia_tien (11) | II | Tiểu Tiên Mạch | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Lăng Vân Sinh (5) · Mộc Thanh Y (7) · Tô Nguyệt Ly (6) |
| Ch12 | thien_tien (12) | II | Thiên Môn / Tiên Đình | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Lăng Vân Sinh (5) · Hàn Dạ (5) · Vạn Kim Nương (7) |
| Ch13 | huyen_tien (13) | II | Tiên Tổ / Tiên Sư | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Mộc Thanh Y (7) · Tô Nguyệt Ly (6) · Huyết La Sát (8) |
| Ch14 | kim_tien (14) | II | Tiên Cảnh Phong Ấn | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Lăng Vân Sinh (5) · Hàn Dạ (5) · Vạn Kim Nương (7) |
| Ch15 | thai_at (15) | II | Thái Ất Đạo / Đại Năng | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Hoa Thiên Đạo Tổ (12) · Mộc Thanh Y (7) · Lăng Vân Sinh (5) |
| Ch16 | dai_la (16) | II | Đại La Kim Tiên + Volume cleared | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Hoa Thiên Đạo Tổ (12) · **Tịch Thiên Thánh Sứ (16)** · Tịch Thiên Đạo Chủ (15) |
| Ch17 | chuan_thanh (17) | III | Chuẩn Thánh / Thánh Đạo | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Hoa Thiên Đạo Tổ (12) · Lăng Vân Sinh (5) · Mộc Thanh Y (7) |
| Ch18 | thanh_nhan (18) | III | Thánh Nhân Phi Cử | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Hoa Thiên Đạo Tổ (12) · Mộc Thanh Y (7) · Tô Nguyệt Ly (6) |
| Ch19 | dao_vuc (19) | III | Đạo Vực Sơ Khải | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | **Đạo Vực Chi Tâm (19)** · Hoa Thiên Đạo Tổ (12) · Tịch Thiên Đạo Chủ (15) |
| Ch20 | dao_giam (20) | III | Đạo Giám / Tâm Ma Cuối | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Lăng Vân Sinh (5) · Mộc Thanh Y (7) · Tịch Thiên Đạo Chủ (15) |
| Ch21 | thien_dao (21) | III | Thiên Đạo Bản Ngã + Volume cleared | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Hoa Thiên Đạo Tổ (12) · Lăng Vân Sinh (5) · Mộc Thanh Y (7) |
| Ch22 | ban_nguyen (22) | IV | Bản Nguyên Hải | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Lăng Vân Sinh (5) · Mộc Thanh Y (7) · **Nguyên Linh Nữ (22)** |
| Ch23 | huyen_huyen (23) | IV | Huyền Huyền Cổ Bi | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Mộc Thanh Y (7) · **Huyền Huyền Giám Quan (23)** · Tô Nguyệt Ly (6) |
| Ch24 | vo_thuy (24) | IV | Vô Thủy Vọng Khởi | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Lăng Vân Sinh (5) · **Vô Thủy Lão Nhân (24)** · Tô Nguyệt Ly (6) |
| Ch25 | vo_chung (25) | IV | Vô Chung Chiến Trường | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Lăng Vân Sinh (5) · **Vô Chung Đồng Tử (25)** · Tịch Thiên Thánh Sứ (16) |
| Ch26 | vinh_hang (26) | IV | Vĩnh Hằng Khắc Tự | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Lăng Vân Sinh (5) · Mộc Thanh Y (7) · Hoa Thiên Đạo Tổ (12) |
| Ch27 | hu_khong_chi_ton (27) | IV | Hư Không Chí Tôn + endgame | 5 | 3 | 0 | 1 | 1 | 1 | M+11 S+8 B+6 H+2 | Lăng Vân Sinh (5) · Mộc Thanh Y (7) · Tịch Thiên Đạo Chủ (15) |

**Note NPC realm gap**: Chương 17–18, 20–21, 26–27 hiện không có NPC gắn realm gần requiredRealmOrder. Spec không bắt buộc thêm NPC mới nếu primary/secondary NPC chính đã reuse từ Phase 21 (Lăng Vân Sinh / Mộc Thanh Y) đóng vai dẫn dắt. Để giữ scope catalog-only, **không thêm NPC mới** ở PR A; nếu PR B/C cần NPC realm cao hơn để dialogue gating, sẽ bổ sung ở phase sau.

---

## 4. Branch quest kind

**Decision**: Mở rộng `Phase33QuestKind` thêm `'branch'`.

Rationale:
- Lý do thêm union literal: type-safe filter/builder; integrity test `phase33QuestsByKind('branch')` dễ verify.
- Risk: tests cũ assert kind set; sẽ update test thay vì keep static.
- Alternative đã cân nhắc: dùng `kind: 'side'` + `tags: ['branch']`. Bỏ qua vì khó test density.

**Branch quest schema**:
- `questKey: q_chXX_branch_NN` (NN = 01..06).
- `kind: 'branch'`.
- `requiredAffinityNpcKey: <one of secondaryNpc/hiddenNpc>` (mọi branch gate qua affinity).
- `requiredAffinityScore: 18..40` (branch nhẹ hơn hidden, hidden cần 28..95).
- `chainKey: branch_chXX_<theme>` (metadata; có thể nằm trong loreSummary nếu schema không hỗ trợ field mới).
- Reward cap riêng: `branch ≤ 0.8 × side cap` (II ≤ 1440 LT, III ≤ 2560 LT, IV ≤ 4400 LT).
- Không grant top-tier item, không grant flag mở Volume.

---

## 5. Reward scaling theo chapter / realm

**Decision**: Bổ sung helper `getStoryRewardTierForRealmOrder` và mở rộng `phase33RewardCap` để vừa giữ policy per-Volume vừa scale theo realm order trong volume.

**Tier table**:

| Realm order | Tier | Multiplier (vs volume base) | Áp dụng |
|---|---|---|---|
| 9–10 | t1_early | 0.85 | Quyển II early |
| 11–13 | t2_mid | 1.00 | Quyển II mid |
| 14–16 | t3_late | 1.15 | Quyển II late |
| 17–19 | t4_thanh | 1.00 | Quyển III early–mid |
| 20–21 | t5_thien_dao | 1.20 | Quyển III late |
| 22–24 | t6_ban_nguyen | 1.00 | Quyển IV early–mid |
| 25–27 | t7_endgame | 1.20 | Quyển IV late + endgame |

Mỗi quest reward = `volume_cap × tier_multiplier × per_quest_factor`, **clamp** không vượt `volume_cap` (giữ test reward cap hiện tại pass).

**Helper API**:
- `getStoryRewardTierForRealmOrder(order: number): RewardTier` (export type `RewardTier`).
- `getStoryRewardBudgetForChapter(chapKey, kind): number` (linhThach budget).
- `assertQuestRewardWithinChapterTier(quest): void` (used in tests).

---

## 6. Forbidden reward (mở rộng)

Giữ regex hiện tại:

```ts
/(_tien_ngoc_nap|_top_tier_freebie|_ban_nguyen_khi_raw_huge|_vinh_hang_dao_raw|_hu_khong_seal_raw)/i
```

Mở rộng thêm test cover branch + new quest reward items (đảm bảo không có item key vượt tier).

---

## 7. Test integrity bổ sung (PR A)

Trong `story-quest-expansion.test.ts` (file hiện 38 test, sẽ tăng):

- **Density**: mỗi chap ≥ 15 main, ≤ 20 main, ≥ 10 side, ≤ 15 side, ≥ 5 branch, ≤ 8 branch, ≥ 2 hidden, ≤ 4 hidden, = 1 daily, = 1 weekly.
- **Total counts**: 19 × 16 = 304 main expected (asserted as range 285..380 = 15..20 per chap).
- **Branch validity**:
  - Mọi branch có `requiredAffinityNpcKey` (≠ null) và `requiredAffinityScore ≥ 18`.
  - Branch reward `linhThach ≤ side cap × 0.8`.
  - Branch không có endgame item.
- **Reward tier**:
  - `getStoryRewardTierForRealmOrder(9..27)` luôn return tier hợp lệ.
  - Mọi quest reward `linhThach ≤ getStoryRewardBudgetForChapter(chap, kind)`.
- **Side reward < main reward** cùng chapter (sanity check).
- **Hidden reward > side reward** cùng chapter (đặc biệt hơn nhưng không vượt main cap quá mức).
- **NPC giver gate**: giverNpc.realmGateOrder ≤ quest.requiredRealmOrder.
- **Existing tests**: vẫn pass.

---

## 8. Builder strategy

Mở rộng `mainQuestsFor` từ 5 quest → 16 quest using **8 narrative beats × 2 step depth**:

1. **Intro** (mở chương, talk + flag_set) — q_chXX_main_01 (existing q1, kept).
2. **Investigation** (explore + kill + collect) — q_chXX_main_02 (existing q2).
3. **Council** (talk + choice) — q_chXX_main_03 (existing q3).
4. **Dungeon** (dungeon_clear + flag_set) — q_chXX_main_04 (existing q4).
5. **Climax** (boss_defeat + flag_set cleared) — q_chXX_main_05 (existing q5).
6. **Hậu sự** (clean up sau boss, collect + talk).
7. **Tâm ma cá nhân** (choice + flag_set + affinity).
8. **Thử thách đồng đội** (explore + kill + collect + talk).
9. **Sự kiện thế lực phụ** (talk + kill + choice).
10. **Bí mật địa phương** (explore + collect + flag_set).
11. **Pháp bảo / công pháp** (collect + talk).
12. **Trận pháp / Ngũ Hành** (kill + explore + flag_set).
13. **Cứu trợ / điều tra** (talk + explore + choice).
14. **Mở Đạo Tâm / Đạo nội tâm** (choice + flag_set).
15. **Đối thoại tôn sư / NPC chính** (talk + affinity).
16. **Tiền đề chương sau** (talk + flag_set + intro tiếp).

Mỗi beat dùng template với `beatIndex` để generate description/step variety.

Tương tự cho:
- **side**: 11 themes (sect dispute, alchemy, formation, rescue, investigate, Ngũ Hành, beast taming, gathering, treasure, gossip, escort).
- **branch**: 6 chains (affinity primary, affinity hidden, lore phụ, shop unlock, dialogue choice, side palace).
- **hidden**: 3 (existing 1 + 2 new: secret memory, forbidden door).

---

## 9. Checkpoint plan

| Step | Scope | Commit | Push |
|---|---|---|---|
| 1 | Plan doc + Draft PR | `docs(story): add phase 33.0b catalog hardening plan` | ✓ |
| 2 | BRANCH kind + reward tier helpers + test updates | `feat(story): add branch quest kind + reward tier helpers` | ✓ |
| 3 | Expand Ch9–12 (mains 16, sides 11, branch 6, hidden 3) | `feat(story): expand logical quests for chapters 9-12` | ✓ |
| 4 | Expand Ch13–16 | `feat(story): expand logical quests for chapters 13-16` | ✓ |
| 5 | Expand Ch17–20 | `feat(story): expand logical quests for chapters 17-20` | ✓ |
| 6 | Expand Ch21–24 | `feat(story): expand logical quests for chapters 21-24` | ✓ |
| 7 | Expand Ch25–27 | `feat(story): expand logical quests for chapters 25-27` | ✓ |
| 8 | Update tests + run pnpm typecheck/lint/test | `test(story): cover phase 33.0b density + branch + tier` | ✓ |
| 9 | Update AI_HANDOFF + plan complete | `docs(story): finalize phase 33.0b handoff` | ✓ |

Mỗi checkpoint phải pass `pnpm --filter @xuantoi/shared typecheck` (local) trước khi push.

---

## 10. Forbidden actions reminder

- Không Prisma / migration.
- Không API / runtime / service.
- Không web UI.
- Không phá main plot Phase 33.0.
- Không bypass realm gate.
- Không grant endgame item.
- Không skip test/CI/hook.
- Không amend commit / force push main.
- Không commit secret/.env.

---

## 11. Tham chiếu

- Spec: `~/attachments/.../phase_33_story_campaign_devin_prompt.docx` (file người dùng cấp).
- Phase 33.0 baseline: PR #564 (merged main).
- Source narrative: `docs/story/TU_TIEN_LO_QUYEN_II_TIEN_GIOI.md`, `..._QUYEN_III_*.md`, `..._QUYEN_IV_*.md`.
- Phase 12 quest format: `packages/shared/src/quests.ts`.

---

## 12. Phase 33.0C — Quest Dialogue Coverage (gộp vào PR A theo yêu cầu user)

> User quyết định **gộp dialogue coverage vào PR A đang mở** thay vì stack PR A2.
> Scope core: MAIN 5-phase + HIDDEN 4-phase + BRANCH opening/ending + BOSS_PRE/VICTORY.

### Source priority

Theo "Quest Dialogue Writing Rules":

1. File 4 Master Implementation (priority cao nhất).
2. File 1–3 cốt truyện Quyển II/III/IV.
3. AI tự viết khi nguồn chỉ có tóm tắt sự kiện.

5 file docx nguồn **không có dialogue chi tiết per-quest** (chỉ có cốt truyện + tóm tắt sự kiện chương). Do đó tất cả dòng dialogue trong PR A đều **tự viết theo bối cảnh chương**, không bịa main plot / NPC role / boss / kết quả chương. Đối chiếu source path:

- `~/attachments/.../TuTienLo_QuyenII_TienGioi_CotTruyen.docx` → cốt truyện Quyển II.
- `~/attachments/.../TuTienLo_QuyenIII_ThanhDaoVanThien_CotTruyen.docx` → cốt truyện Quyển III.
- `~/attachments/.../TuTienLo_QuyenIV_BanNguyenVinhHang_CotTruyen.docx` → cốt truyện Quyển IV.
- `~/attachments/.../TuTienLo_Master_QuyenII_IV_AI_Implementation.docx` → master plan, không có dialogue.

### Coverage matrix

| Kind | # Quest | Phase / quest | Tổng line |
|---|---|---|---|
| MAIN | 304 | INTRO + ACCEPT + IN_PROGRESS + COMPLETE + CLAIMED | 1520 |
| MAIN boss climax (q05) | 19 | thêm BOSS_PRE + BOSS_VICTORY | +38 |
| HIDDEN | 57 | HIDDEN_HINT + HIDDEN_TRIGGER + COMPLETE + AFTERMATH | 228 |
| BRANCH | 114 | INTRO (opening) + AFTERMATH (ending) | 228 |
| **Tổng** | — | — | **2014** |

SIDE / DAILY / WEEKLY **chưa cover** trong Phase 33.0C core — có thể bổ sung trong stacked PR sau nếu credit cho phép. Side quest đã có `descriptionVi/En` đủ ngữ cảnh nhập vai ngắn.

### Phong cách theo realm tier

- **Ch9–16** (Tiên Giới): gần gũi, dẫn dắt, mentor-style.
- **Ch17–21** (Thánh Đạo Vạn Thiên): trang trọng, dao-doctrine, có khí chất tiên/thánh.
- **Ch22–27** (Bản Nguyên Vĩnh Hằng): cao cấp, cosmic, abstract, hư không / vô thủy.

Mỗi line 1–3 câu, nhúng ít nhất một token chapter-specific (`regionName` / `chapNumber` / `themeVi` / `bossName`) để **không trùng exact text** giữa các chương.

### Test enforcement

`story-quest-dialogues.test.ts` (14 test cases, +0 fail):

- `dialogueId` unique + match regex `^dlg_q_ch\d{2}_(main|hidden|branch)_\d{2}_<PHASE>$`.
- `questKey` resolve trong `STORY_QUEST_EXPANSION`.
- `speakerNpcKey` resolve trong `NPCS`; `realmGateOrder ≤ quest.requiredRealmOrder`.
- `chapterKey` = quest `chapKey`.
- `textVi` / `textEn` đều non-empty, ≥ 10 chars, không placeholder.
- Mọi MAIN có 5 phase chính; MAIN boss có thêm BOSS_PRE/VICTORY.
- Mọi HIDDEN có HINT + TRIGGER + COMPLETE + AFTERMATH.
- Mọi BRANCH có INTRO + AFTERMATH.
- Catalog ≥ 1900 line; mỗi chap ≥ `mainCount × 5` line.
- Không > 50 line VI trùng exact text (anti copy-paste).
- Catalog không mutate story flag / không có `nextDialogueId` (read-only Phase 33.0C — runtime sẽ wire ở PR B).

### File mới

- `packages/shared/src/story-quest-dialogues.ts` — type + catalog + lookup helpers.
- `packages/shared/src/story-quest-dialogues.test.ts` — 14 test.

### Forbidden

- Không thay đổi main plot / NPC role / boss / kết quả chương.
- Không grant endgame item / unlock flag qua dialogue.
- Không tiết lộ hidden quest quá thẳng.
- Không copy-paste rename giữa các chương (đã enforce qua test "≤ 50 identical VI lines").
- Không daily/weekly dialogue trong scope core (deferred).
- Workflow rules: `docs/AI_WORKFLOW_RULES.md`.
