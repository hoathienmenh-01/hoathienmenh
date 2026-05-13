# Tu Tiên Lộ — Quyển III: Thánh Đạo Vạn Thiên

> **Phase 33.0** — Story Quest Expansion V2. Source: file 2 (`TuTienLo_QuyenIII_ThanhDaoVanThien_CotTruyen.docx`) + file 4 (`TuTienLo_Master_QuyenII_IV_AI_Implementation.docx` — ưu tiên). AI/dev mới đọc [`PHASE12_STORY_PROGRESS.md`](./PHASE12_STORY_PROGRESS.md) trước.

---

## 1. Vai trò & vị trí

Quyển III là "lập đạo cá nhân giữa vạn linh" — tu sĩ vượt khỏi tiên giới, trảm tam niệm, lập đạo riêng, mở Đạo Vực Hoa Thiên, đối đầu Thiên Đạo Bản Ngã.

- **Trọng tâm**: 3 chương đầu (Ch17 Trảm Tam Niệm → Ch19 Hỗn Nguyên) hoàn thiện chính mình; 2 chương cuối (Ch20 Đạo Vực → Ch21 Thiên Đạo) mở thế giới mở rộng.
- **Antagonist chính**: Thiên Đạo Bản Ngã (Ch21) — Tịch Thiên Thánh Sứ (Ch21 antagonist chính, phục bút Ch16).
- **Foundation**: kết thúc Quyển III tại Ch21 — mở Quyển IV Bản Nguyên.

---

## 2. Chapter Matrix Quyển III

| # | chapKey | Realm | Theme | Mở khoá | NPC trụ cột |
|---|---|---|---|---|---|
| 17 | `ch17` | `chuan_thanh` (17) | Trảm Tam Niệm — Trảm Quá Khứ / Hiện Tại / Vị Lai niệm | Foundation Thánh; cảnh giới Chuẩn Thánh | Lăng Vân Sinh, Mộc Thanh Y, Hoa Thiên Đạo Tổ |
| 18 | `ch18` | `thanh_nhan` (18) | Lập Đạo — Đạo hiệu + Tín Ngưỡng + Thánh Kiếp | Foundation Đạo hiệu; foundation Tín ngưỡng | Lăng Vân Sinh, Tịch Thiên Đạo Chủ, Tịch Thiên Thánh Sứ |
| 19 | `ch19` | `hon_nguyen` (19) | Hỗn Nguyên Quy Nhất — Hỗn Nguyên Chi Hải + hợp pháp tắc | Hỗn Nguyên storyline; rule unify | Mộc Thanh Y, Đạo Vực Chi Tâm, Tô Nguyệt Ly |
| 20 | `ch20` | `dao_quan` (20) | Một Đạo Vực, Vạn Sinh Linh — mở Đạo Vực Hoa Thiên + chọn luật mềm/sắt | Foundation Đạo Vực Hoa Thiên; legal route fork | Lăng Vân Sinh, Đạo Vực Chi Tâm, Vạn Kim Nương |
| 21 | `ch21` | `thien_dao` (21) | Ta Là Trời Hay Trời Là Ta — đối đầu Thiên Đạo Bản Ngã + Tịch Thiên Thánh Sứ | Quyển IV unlock + Bản Nguyên Hải hint | Lăng Vân Sinh, Tịch Thiên Thánh Sứ (boss), Hoa Thiên Đạo Tổ |

---

## 3. Quest Catalog Quyển III

Cấu trúc 11 quest/chap như Quyển II nhưng reward cap nâng lên (Thánh tier):

- main ≤ 7 500 LT, side ≤ 3 200 LT, hidden ≤ 4 500 LT.
- daily ≤ 600 LT, weekly ≤ 2 800 LT.
- exp ≤ 8 500 / quest.

### Reward cap policy Quyển III (`reward_policy_quyen_iii`)

Áp dụng cho `ch17`..`ch21`. Tổng 55 quest (25 main + 15 side + 5 hidden + 5 daily + 5 weekly).

### Climax flags Quyển III

- `flag_ch17_cleared`, `flag_ch18_cleared`, `flag_ch19_cleared`, `flag_ch20_cleared`, `flag_ch21_cleared`.
- `flag_volume_iii_cleared` được set bởi `q_ch21_main_05` khi clear Ch21.
- `flag_volume_iv_unlocked` cũng do `q_ch21_main_05` → mở Quyển IV.

---

## 4. Boss & Dungeon References

| Chap | Climax boss | Story dungeon |
|---|---|---|
| Ch17 | `boss_tam_niem_chap_tam` | `ch17_truong_tam_niem` |
| Ch18 | `boss_tich_thien_phap_tuong` | `ch18_thanh_kiep_dau_truong` |
| Ch19 | `boss_hon_nguyen_phap_tac_loan` | `ch19_hon_nguyen_chi_hai` |
| Ch20 | `boss_dao_quan_doi_lap` | `ch20_dao_vuc_hoa_thien_foundation` |
| Ch21 | `boss_tich_thien_thanh_su_chan_than` | `ch21_thien_dao_ban_nga_chien_truong` |

---

## 5. Route forks chính

- **Ch20** `route_ch20_luat_mem` vs `route_ch20_luat_sat` — quyết định cách Đạo Vực Hoa Thiên hoạt động. Hidden quest `q_ch20_hidden_01` chỉ unlock sau khi chọn `route_ch20_luat_mem` + affinity `npc_dao_vuc_chi_tam` ≥ 60.
- **Ch21** `route_ch21_thien_dao_chap_nhan` vs `route_ch21_thien_dao_phan_khang` — quyết định cách player hoà giải với Thiên Đạo Bản Ngã. Cả 2 đều set `flag_volume_iv_unlocked`, nhưng narrative ending Ch26 sẽ phân nhánh theo lựa chọn này.

---

## 6. Tham chiếu

- Source: `~/attachments/dfc0b4e8-2ff9-4be0-96c0-c96063876edf/TuTienLo_QuyenIII_ThanhDaoVanThien_CotTruyen.docx`, file 4 Master.
- Implementation plan: [`./TU_TIEN_LO_QUYEN_II_IV_IMPLEMENTATION_PLAN.md`](./TU_TIEN_LO_QUYEN_II_IV_IMPLEMENTATION_PLAN.md).
- Catalog code: `packages/shared/src/story-chapters-quyen-ii-iv.ts`, `packages/shared/src/story-quest-expansion.ts`.
