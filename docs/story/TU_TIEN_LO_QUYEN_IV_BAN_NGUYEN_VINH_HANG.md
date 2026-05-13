# Tu Tiên Lộ — Quyển IV: Bản Nguyên Vĩnh Hằng

> **Phase 33.0** — Story Quest Expansion V2. Source: file 3 (`TuTienLo_QuyenIV_BanNguyenVinhHang_CotTruyen.docx`) + file 4 (`TuTienLo_Master_QuyenII_IV_AI_Implementation.docx` — ưu tiên). AI/dev mới đọc [`PHASE12_STORY_PROGRESS.md`](./PHASE12_STORY_PROGRESS.md) trước.

---

## 1. Vai trò & vị trí

Quyển IV là endgame — tu sĩ chạm đến **Bản Nguyên Vĩnh Hằng**, mở 6 chương cuối cùng:
- Chap 22–23: Bản Nguyên Hải + Huyền Huyền Cổ Bi — tự vấn đạo.
- Chap 24–25: Vô Thủy / Vô Chung — khởi đầu và kết thúc của chính nhân vật.
- Chap 26–27: Vĩnh Hằng + Hư Không — endgame ending flags.

**Phản diện cuối**: Tịch Thiên Thánh Sứ (tương lai biến chất) ở Chap 25; nội tâm player ở Chap 26-27.

---

## 2. Chapter Matrix Quyển IV

| # | chapKey | Realm | Theme | Mở khoá | NPC trụ cột |
|---|---|---|---|---|---|
| 22 | `ch22` | `ban_nguyen` (22) | Vào Bản Nguyên Hải — Nguyên Linh Nữ + Đạo Liên Hoa Thiên evo | Foundation Bản Nguyên Hải; Đạo Liên Hoa Thiên item evo | Lăng Vân Sinh, Mộc Thanh Y, Nguyên Linh Nữ |
| 23 | `ch23` | `huyen_huyen` (23) | Huyền Huyền Đối Vấn — Huyền Huyền Cổ Bi + chất vấn đạo | Foundation Huyền Huyền Cổ Bi codex | Mộc Thanh Y, Huyền Huyền Giám Quan, Tô Nguyệt Ly |
| 24 | `ch24` | `vo_thuy` (24) | Vô Thủy Vọng Khởi — Thời Gian Luân Hải + khởi đầu thật | Hint origin character; foundation tang flag | Lăng Vân Sinh, Vô Thủy Lão Nhân, Tô Nguyệt Ly |
| 25 | `ch25` | `vo_chung` (25) | Vô Chung Chiến Trường — Vô Chung Chi Môn + thư tương lai | Pre-ending flag prep | Lăng Vân Sinh, Vô Chung Đồng Tử, Tịch Thiên Thánh Sứ (tương lai) |
| 26 | `ch26` | `vinh_hang` (26) | Vĩnh Hằng Khắc Tự — Bia Vĩnh Hằng + ending flags | Endgame ending V branch ban đầu | Lăng Vân Sinh, Mộc Thanh Y, Hoa Thiên Đạo Tổ |
| 27 | `ch27` | `hu_khong_chi_ton` (27) | Hoa Thiên Nở Trong Hư Không — Hư Không Ngoại Vực + endgame routes | `flag_endgame_routes_unlocked` + 5 ending route | Lăng Vân Sinh, Mộc Thanh Y, Hoa Thiên Đạo Tổ |

---

## 3. Quest Catalog Quyển IV

Cấu trúc 11 quest/chap, reward cap cao nhất (endgame ban đầu):

- main ≤ 12 000 LT, side ≤ 5 500 LT, hidden ≤ 7 500 LT.
- daily ≤ 1 000 LT, weekly ≤ 4 500 LT.
- exp ≤ 14 000 / quest.

Tổng 66 quest (30 main + 18 side + 6 hidden + 6 daily + 6 weekly).

### Hidden quest unlocks chính

- `q_ch22_hidden_01` Đạo Liên Hoa Thiên evolved — affinity `npc_nguyen_linh_nu` ≥ 70.
- `q_ch24_hidden_01` Tổ tiên thực sự — flag `flag_ch13_tien_su_revealed` + affinity `npc_to_nguyet_ly` ≥ 60.
- `q_ch25_hidden_01` Lá thư tương lai — affinity `npc_vo_chung_dong_tu` ≥ 80 + flag `flag_ch21_route_phan_khang`.

### Ending flag convention

Chỉ Ch26 và Ch27 mới được set ending flag. Ch26 emit `flag_volume_iv_cleared`. Ch27 emit:

- `ending_hoa_thien_phuc_hung` — route hồi sinh Hoa Thiên Môn cổ.
- `ending_dao_vuc_dien_xuong` — route hậu Đạo Vực biến.
- `ending_phan_nguyen` — route "ngươi-tương-lai" đảo chiều.
- `ending_vo_uu` — route giải thoát siêu nhiên.
- `ending_endgame_main` — default ending nếu không trigger các route trên.
- `flag_endgame_routes_unlocked` — gate chung mở 5 route trên.

---

## 4. Boss & Dungeon References

| Chap | Climax boss | Story dungeon |
|---|---|---|
| Ch22 | `boss_ban_nguyen_lien_canh` | `ch22_ban_nguyen_hai_canh` |
| Ch23 | `boss_huyen_huyen_co_bi_hon` | `ch23_huyen_huyen_co_bi_thuc_dia` |
| Ch24 | `boss_vo_thuy_ngo_co` | `ch24_thoi_gian_luan_hai` |
| Ch25 | `boss_vo_chung_tich_thien_thanh_su_tuong_lai` | `ch25_vo_chung_chi_mon` |
| Ch26 | `boss_vinh_hang_dao_tam_chinh_minh` | `ch26_bia_vinh_hang_dao_tran` |
| Ch27 | `boss_hu_khong_ban_nga_cuoi_cung` | `ch27_hu_khong_ngoai_vuc_chien_truong` |

---

## 5. Tham chiếu

- Source: `~/attachments/3219f456-8a0e-4ad1-9a45-8284cbc3a0ae/TuTienLo_QuyenIV_BanNguyenVinhHang_CotTruyen.docx`, file 4 Master.
- Implementation plan: [`./TU_TIEN_LO_QUYEN_II_IV_IMPLEMENTATION_PLAN.md`](./TU_TIEN_LO_QUYEN_II_IV_IMPLEMENTATION_PLAN.md).
- Catalog code: `packages/shared/src/story-chapters-quyen-ii-iv.ts`, `packages/shared/src/story-quest-expansion.ts`.
