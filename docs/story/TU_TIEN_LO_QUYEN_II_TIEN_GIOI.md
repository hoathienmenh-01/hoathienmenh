# Tu Tiên Lộ — Quyển II: Tiên Giới

> **Phase 33.0** — Story Quest Expansion V2. Source: file 1 (`TuTienLo_QuyenII_TienGioi_CotTruyen.docx`) + file 4 (`TuTienLo_Master_QuyenII_IV_AI_Implementation.docx` — ưu tiên khi xung đột). AI/dev mới đọc [`PHASE12_STORY_PROGRESS.md`](./PHASE12_STORY_PROGRESS.md) trước, sau đó đọc file này khi cần lore chi tiết cho Quyển II.

---

## 1. Vai trò & vị trí

Quyển II là "tiên giới đoạn đầu" — tu sĩ vừa vượt Cửu Trọng Thiên Kiếp (Chap 9 — `do_kiep`, realm order 9) phi thăng lên Tiên Giới. Tinh thần Quyển II:

- **Tiên giới không phải thiên đường**: Tiên Đình giam phạm nhân ở Phi Thăng Doanh; tiên thạch là tài nguyên tranh chấp; Hoa Thiên cũ là dị giáo.
- **Foundation Đại La**: kết thúc Quyển II tại Đại La Bất Diệt (Chap 16 — `dai_la_kim_tien`, order 16) — mở Đạo Vực foundation cho Quyển III.
- **Antagonist chính**: Tiên Đình Bạch Đế (luật tiên) + Tịch Thiên Điện (foreshadow vẫn ẩn).

Story bible §9.2 mô tả tổng quan; file 1 chi tiết 8 chương.

---

## 2. Chapter Matrix Quyển II

| # | chapKey | Realm | Theme | Mở khoá | NPC trụ cột |
|---|---|---|---|---|---|
| 9 | `ch09` | `do_kiep` (9) | Cửu Trọng Thiên Kiếp — vượt 9 kiếp; Thiên Kiếp Hóa Thân; mở Tiên Giới + Tiên Thạch + Tiên Khí sơ cấp | Tiên Giới map; danh vọng Phi Thăng Giả foundation | Lăng Vân Sinh, Mộc Thanh Y |
| 10 | `ch10` | `nhan_tien` (10) | Phi Thăng Doanh — lao tù Tiên Đình; route giải phóng phạm nhân | Faction Phi Thăng Giả; shop khởi nguyên; Lục Bình NPC | Lăng Vân Sinh, Lục Bình, Bạch Đế Tử |
| 11 | `ch11` | `dia_tien` (11) | Tiểu Tiên Mạch — tranh tiên thạch + Tiểu Tiên Hội leaderboard | Map Tiểu Tiên Mạch; daily/weekly mỏ tiên thạch | Lăng Vân Sinh, Vạn Kim Nương, Hàn Dạ |
| 12 | `ch12` | `thien_tien` (12) | Thiên Môn Khai Mở — mở Thiên Môn (foundation Đại La); phong ấn lỏng cho Vô Đạo Chung | Foundation portal Thiên Môn; sect rank lên Thiên Tiên Tử | Lăng Vân Sinh, Hoa Thiên Đạo Tổ (tàn ảnh), Tịch Linh Sứ Giả |
| 13 | `ch13` | `huyen_tien` (13) | Sử Sách Bị Niêm Phong — mở thư viện Tiên Sử; tiết lộ Hoa Thiên cổ | Codex Tiên Sử; story flag chân tướng tổ sư | Mộc Thanh Y, Tô Nguyệt Ly, Hoa Thiên Đạo Tổ (tàn ảnh) |
| 14 | `ch14` | `kim_tien` (14) | Kim Thân Lập Vị — đúc Kim Thân tiên gia; Pháp Bảo Đỉnh | Foundation Pháp Bảo Đỉnh; reforging cấp Kim Tiên | Lăng Vân Sinh, Mộc Thanh Y, Vạn Kim Nương |
| 15 | `ch15` | `thai_at_kim_tien` (15) | Thái Ất Tranh Pháp — đại hội tranh pháp tiên giới; leaderboard | Server event Thái Ất Tranh Pháp; rank reward foundation | Lăng Vân Sinh, Hàn Dạ, Vạn Kim Nương |
| 16 | `ch16` | `dai_la_kim_tien` (16) | Đại La Bất Diệt — mở Đại La cảnh; foundation Đạo Vực cho Quyển III | Volume III unlock flag; Đại La passive foundation | Lăng Vân Sinh, Mộc Thanh Y, Tịch Thiên Thánh Sứ |

---

## 3. Quest Catalog Quyển II

Mỗi chương có **11 quest** = 5 main + 3 side + 1 hidden + 1 daily + 1 weekly.

### Quest naming convention

Quest key cố định format `q_chXX_<kind>_NN` với:

- `chXX` = `ch09`..`ch16`.
- `kind` ∈ `{main, side, hidden, daily, weekly}`.
- `NN` = `01`..`05` (main), `01`..`03` (side), `01` (hidden/daily/weekly).

### Quest pattern per chapter

| Quest | Mục đích | Steps | Reward range (Quyển II cap) |
|---|---|---|---|
| `q_chXX_main_01` | Open the Vein — intro; set `flag_chXX_intro` | talk + flag_set | linhThach ≤ 1 200 |
| `q_chXX_main_02` | Trace the Threads — explore + kill + collect | explore + kill + collect | linhThach ≤ 1 800 |
| `q_chXX_main_03` | Council — talk + choice | talk + choice | linhThach ≤ 2 400 |
| `q_chXX_main_04` | Story Dungeon — `ch{XX}_<dungeon>` | dungeon_clear | linhThach ≤ 3 000 |
| `q_chXX_main_05` | Climax — boss_defeat + flag_set clear flag (+ volume flag on Ch16) | boss_defeat + flag_set | linhThach ≤ 4 000 |
| `q_chXX_side_01` | Errand cho primary NPC | talk + collect | linhThach ≤ 1 800 |
| `q_chXX_side_02` | Counsel với secondary NPC | talk + choice | linhThach ≤ 1 800 |
| `q_chXX_side_03` | Insider với hidden NPC | talk + explore | linhThach ≤ 1 800 |
| `q_chXX_hidden_01` | Cơ duyên (affinity gate 28-50) | explore + collect + choice + flag_set | linhThach ≤ 2 500 |
| `q_chXX_daily_01` | Patrol (cap 1/day) | kill + explore | linhThach ≤ 350 |
| `q_chXX_weekly_01` | Cleanse (cap 1/week, boss weakened replay) | boss_defeat | linhThach ≤ 1 500 |

**Reward cap policy Quyển II (`reward_policy_quyen_ii`)**:
- main ≤ 4 000 LT, side ≤ 1 800 LT, hidden ≤ 2 500 LT, daily ≤ 350 LT, weekly ≤ 1 500 LT.
- exp ≤ 4 500 / quest.
- KHÔNG endgame freebie (forbidden regex `_tien_ngoc_nap`/`_top_tier_freebie`/`_ban_nguyen_khi_raw_huge`/etc).

### Forbidden items (audit)

Tuyệt đối KHÔNG drop trực tiếp từ quest Quyển II:
- Pháp Bảo tier Đại La trở lên (chỉ unlock route, không raw drop).
- Tu Liên Đại Đạo Liễu / Đạo Hoa Mộc / Bản Nguyên Khí raw.
- Tịch Thiên Phong Ấn / Vô Đạo Chung mảnh.

---

## 4. Boss & Dungeon References

| Chap | Climax boss | Story dungeon |
|---|---|---|
| Ch9 | `boss_cuu_trong_thien_kiep` | `ch09_thien_kiep_hoa_than` |
| Ch10 | `boss_phi_thang_doanh_giam_su` | `ch10_phi_thang_doanh_loi` |
| Ch11 | `boss_tieu_tien_hoi_de_nhat` | `ch11_tieu_tien_mach_loi` |
| Ch12 | `boss_tich_linh_thien_mon` | `ch12_thien_mon_phong_an` |
| Ch13 | `boss_tien_su_nguy_kinh` | `ch13_tien_su_dao_ngu` |
| Ch14 | `boss_phap_bao_thien` | `ch14_phap_bao_dinh` |
| Ch15 | `boss_thai_at_tranh_phap_quan_quan` | `ch15_thai_at_phap_tran` |
| Ch16 | `boss_dai_la_thien_di` | `ch16_dai_la_canh_loi` |

Boss/dungeon là **catalog reference only** trong PR này — runtime spawn + balance sẽ wire ở Phase 33.1.

---

## 5. Story Flag Convention

Phase 33 sử dụng 4 namespace flag:

- `flag_chXX_<event>` — per-chapter event flag (e.g. `flag_ch09_intro`, `flag_ch16_cleared`).
- `route_chXX_<route>` — narrative route inside chapter (e.g. `route_ch10_tu_do` vs `route_ch10_tien_dinh`).
- `flag_volume_<vol>_unlocked`/`_cleared` — Volume gate (e.g. `flag_volume_iii_unlocked` sau khi clear Ch16).
- `ending_*` / `flag_endgame_routes_unlocked` — chỉ xuất hiện ở Ch26–27.

---

## 6. Hooks deferred (Phase 33.1+)

- **Đại La Đạo Vực foundation**: catalog đã expose key `flag_volume_ii_cleared`, runtime Đạo Vực service nằm ở Phase 33.1.
- **Faction Phi Thăng Giả**: NPC `npc_luc_binh` + faction `wandering` đã catalog; full faction service deferred.
- **Server event Thái Ất Tranh Pháp**: catalog ref hook `event_thai_at_tranh_phap`; runtime liveops module Phase 33.1.

---

## 7. Tham chiếu

- Source: `~/attachments/3cc5b269-57fd-4677-95d5-46926ce4a93f/TuTienLo_QuyenII_TienGioi_CotTruyen.docx`, `~/attachments/eee2a389-ae21-444a-933c-2cbc0678d150/TuTienLo_Master_QuyenII_IV_AI_Implementation.docx`.
- Implementation plan: [`./TU_TIEN_LO_QUYEN_II_IV_IMPLEMENTATION_PLAN.md`](./TU_TIEN_LO_QUYEN_II_IV_IMPLEMENTATION_PLAN.md).
- Catalog code: `packages/shared/src/story-chapters-quyen-ii-iv.ts`, `packages/shared/src/story-quest-expansion.ts`.
- Tests: `packages/shared/src/story-quest-expansion.test.ts`.
