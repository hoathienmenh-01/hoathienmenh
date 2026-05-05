# Tu Tiên Lộ — Story Bible (Hoa Thiên Khai Đạo)

> **Source**: chuyển hoá từ `docs/archive/original-docx/TuTienLo_Story_Bible.docx` (Story Bible + Quest Design + NPC System + Reward Economy).
>
> **Trạng thái**: design source duy nhất cho cốt truyện / NPC / quest. AI/dev mới làm Phase 12 Story/NPC/Quest **đọc file này + [`PHASE12_STORY_PROGRESS.md`](./PHASE12_STORY_PROGRESS.md)**, KHÔNG cần mở DOCX gốc mỗi session. DOCX chỉ là archive/source reference.
>
> **Runtime**: chưa có gì được code. File này thuần lore/design. Không phải nguồn sự thật runtime — `prisma/schema.prisma` + code trên `main` mới là nguồn sự thật khi đã build.

---

## 1. Tầm nhìn cốt truyện

- **Tên game**: Tu Tiên Lộ — *con đường tu tiên* từ Phàm Nhân → Hư Không Chí Tôn. Không phải hành trình một ngày thành tiên, mà là hành trình dài: càng lên cao thấy thế giới càng lớn, luật chơi càng sâu, lựa chọn càng nặng.
- **Trung tâm cảm xúc**: **Hoa Thiên Môn** — tông môn cổ đã suy tàn nhưng giữ truyền thừa "vá thiên đạo". Người chơi không chỉ tăng cảnh giới mà liên tục có lý do quay lại: cứu tông môn, mở bí cảnh, trả nợ nhân quả, theo đuổi công pháp, nâng pháp bảo, tham chiến, vượt thiên kiếp, mở rộng đạo thống.
- **Phản diện chính**: **Tịch Thiên Điện** — muốn khoá đường tu tiên của chúng sinh để độc chiếm đại đạo. Đây là conflict triết học, không chỉ thiện-ác.
- **Endgame**: **Vô Đạo Chủng** ăn mòn đại đạo từ Hư Không Ngoại Vực — chiến trường server, mùa mới, vũ trụ mới.

## 2. Nguyên tắc thiết kế bắt buộc

Đây là invariant cho mọi PR Phase 12 đụng quest/reward/NPC. Vi phạm = phá economy hoặc phá vibe game.

1. **Mỗi nhiệm vụ phải có lý do trong thế giới.** Không "đánh 10 con quái".
2. **Reward phụ tuyến vừa phải** — mục tiêu là dẫn người chơi vào vòng cày, không thay thế cày chính.
3. **Reward chính tuyến tốt hơn** nhưng KHÔNG được bán phá economy (xem [`../ECONOMY_MODEL.md`](../ECONOMY_MODEL.md) §3 invariants).
4. **Cơ duyên (kỳ ngộ) phải có điều kiện, giới hạn, log, cooldown** — không random vô tội vạ.
5. **Nạp tiền** = tiện lợi / định hướng build / bảo hộ rủi ro / mở thêm lượt hợp lý. KHÔNG bán thẳng cảnh giới, đồ top, ngọc max, công pháp tối thượng.
6. **Mọi reward (currency/item) đi qua ledger** + idempotency key `(characterId, sourceType, sourceKey)` unique (xem [`../ECONOMY_MODEL.md`](../ECONOMY_MODEL.md)).

## 3. Bối cảnh thế giới — Tam Thiên Đạo Vực

| Tầng thế giới | Cảnh giới chính | Vai trò cốt truyện | Gameplay chính |
|---|---|---|---|
| Nhân Gian Giới | Phàm Nhân → Độ Kiếp | Nơi bắt đầu. Linh khí mỏng, tài nguyên hạn chế, tông môn tranh đấu, ma tu ẩn mình. | Luyện cấp, dungeon, tông môn, boss, thiên kiếp đầu. |
| Tiên Giới | Nhân Tiên → Đại La Kim Tiên | Không phải thiên đường. Người phi thăng bị thế lực tiên giới bóc lột và kiểm soát. | Tiên thạch, tiên khí, tiên phủ, tiên vực chiến. |
| Hỗn Nguyên Thiên | Chuẩn Thánh → Thiên Đạo | Pháp tắc trở thành tài nguyên tranh đoạt; Thánh Nhân lập đạo, Đạo Quân cai quản đạo vực. | Pháp tắc, tín ngưỡng, đạo vực, thánh chiến. |
| Bản Nguyên Hải | Bản Nguyên → Vô Chung | Nguồn gốc của linh khí, thời gian, không gian, sinh tử, nhân quả. | Bản nguyên khí, thời gian dungeon, endgame crafting. |
| Hư Không Ngoại Vực | Vĩnh Hằng → Hư Không Chí Tôn | Bên ngoài mọi thế giới, nơi Vô Đạo Chủng ăn mòn đại đạo. | Season endgame, server boss, vũ trụ mới. |

## 4. Tóm tắt cốt truyện lớn

Người chơi bắt đầu là **phàm nhân được Hoa Thiên Môn thu nhận làm ngoại môn đệ tử**. Hoa Thiên Môn từng là đại đạo thống đứng giữa nhân gian và thiên đạo, nhưng bị **Tịch Thiên Điện** phản bội trong **Thượng Cổ Đại Kiếp**. Tịch Thiên Điện muốn khoá đường tu tiên của chúng sinh để độc chiếm đại đạo.

Người chơi từ một đệ tử bình thường từng bước:

1. Tu luyện qua các cảnh giới Nhân Gian, khôi phục linh mạch, tìm lại truyền thừa Hoa Thiên.
2. Kết giao NPC, lựa chọn **chính đạo / ma đạo / trung lập** → karma branch.
3. Phi thăng tiên giới, tranh pháp tắc, đối đầu Tiên Đình Bạch Đế (cánh tay Tịch Thiên trong Tiên Giới).
4. Lập đạo, thành Thánh, cai quản đạo vực.
5. Bước vào Bản Nguyên Hải tìm nguồn gốc đại đạo.
6. Quyết định vận mệnh **Tam Thiên Đạo Vực** trước Vô Đạo Chủng.

## 5. Thế lực / phe phái / tông môn

| Thế lực | Mô tả | Tài nguyên / truyền thừa | Vai trò gameplay |
|---|---|---|---|
| **Hoa Thiên Môn** | Tông môn trung tâm của người chơi. Bề ngoài suy tàn, bên trong giữ truyền thừa vá thiên đạo. | Tàng Kinh Các, Linh Điền, Hộ Sơn Đại Trận, Phi Thăng Đài, Hoa Thiên Sơn phong ấn. | Càng góp sức → mở thêm nhiệm vụ, công pháp, buff, bí cảnh. |
| **Tịch Thiên Điện** | Phản diện chính. Muốn phong toả đường tu tiên để độc chiếm đại đạo. | Nội gián, Tịch Linh Chủng, Tịch Thiên Ấn, quân đoàn ma ảnh. | Tạo boss, world event, thiên kiếp biến dị, các tuyến phản bội. |
| **Huyền Kiếm Tông** | Đại tông kiếm tu, vừa đối thủ vừa đồng minh tiềm năng. | Kiếm đạo, đấu pháp, danh dự; rivalry với Hàn Dạ. | Đấu trường, liên minh, tông môn chiến. |
| **Vạn Bảo Thương Hội** | Thế lực kinh tế trung lập. Không tuyệt đối thiện, chỉ theo lợi ích. | Market, auction, caravan, price control. | Hộ tống, đấu giá, trade, event merchant. |
| **Huyết Hà Ma Tông** | Ma đạo trung kỳ. Có kẻ ác thật, cũng có người bị chính đạo ruồng bỏ. | Huyết pháp, nghiệp lực, truy nã, chợ đen. | Mở tuyến ma đạo, boss, black market. |
| **Tiên Đình Bạch Đế** | Thế lực thống trị một phần tiên giới. Bề ngoài trật tự, bên trong liên quan Tịch Thiên. | Phi thăng doanh, tiên quan, tiên luật. | Tiên giới conflict, faction reputation. |

## 6. Dàn NPC trụ cột

| NPC | Vai trò | Tính cách | Bí mật / xung đột | Công dụng gameplay |
|---|---|---|---|---|
| **Lăng Vân Sinh** | Chưởng môn Hoa Thiên Môn | Hiền, nghèo, thâm sâu | Giữ mảnh truyền thừa cuối; có thể hy sinh để mở Hoa Thiên Sơn | Main quest, sect quest, breakthrough guidance |
| **Mộc Thanh Y** | Đại sư tỷ | Nghiêm khắc, ấm áp | Bị Tịch Linh Chủng ăn mòn, cần người chơi cứu | Tutorial, Mộc hệ, healing, alchemy |
| **Hàn Dạ** | Rival Huyền Kiếm Tông | Lạnh, kiêu ngạo, trọng danh dự | Có thể là bạn / đối thủ / kẻ thù tuỳ lựa chọn | Arena, duel, sword quests |
| **Tô Nguyệt Ly** | Hậu nhân nhánh Hoa Thiên lưu đày | Bí ẩn, thông minh | Biết vị trí truyền thừa Hoa Thiên bị xoá khỏi lịch sử | Hidden quest, ancient relics |
| **Huyết La Sát** | Ma tu bị ruồng bỏ | Tàn nhẫn nhưng có nỗi đau | Từng là đệ tử Hoa Thiên; mở sự thật về mặt tối chính đạo | Moral choice, ma path |
| **Vạn Kim Nương** | Chủ sự Vạn Bảo Thương Hội | Thực tế, sắc bén | Biết nhiều bí mật qua giao dịch | Market, auction, escort |
| **Bạch Đế Tử** | Tiên nhân tiếp dẫn | Cao quý giả tạo | Người của Tịch Thiên Điện trong Tiên Giới | Tiên giới antagonist |
| **Hoa Thiên Đạo Tổ** | Tổ sư cổ xưa | Từ bi nhưng quyết liệt | Không chết, hoá thành phong ấn ngăn Vô Đạo Chủng | Endgame inheritance |
| **Tịch Thiên Đạo Chủ** | Phản diện tối cao | Lý trí cực đoan | Muốn khoá đại đạo vì tin chúng sinh sẽ tự huỷ | Final antagonist / philosophical conflict |

## 7. Hệ thống nhiệm vụ — phân loại

| Loại nhiệm vụ | Mục đích | Quy tắc reward |
|---|---|---|
| **Chính tuyến** | Đẩy cốt truyện lớn, mở map / cảnh giới / cơ chế mới. | EXP cao, linh thạch, công pháp, vật phẩm mở khoá. Không spam lặp lại. |
| **Cảnh giới** | Bắt buộc/khuyến nghị để đột phá mốc lớn. | Nguyên liệu đột phá, giảm rủi ro thiên kiếp. Vẫn cần cày EXP + tài nguyên. |
| **Tông môn** | Xây Hoa Thiên Môn, tăng cống hiến, mở công trình. | Cống hiến, nguyên liệu, buff tông môn. Vừa phải nhưng đều. |
| **NPC cá nhân** | Tăng quan hệ NPC, mở tuyến ẩn. | Đạo cụ, danh vọng, công pháp nhánh, hỗ trợ thiên kiếp. |
| **Kỳ ngộ (cơ duyên)** | Nhiệm vụ ẩn / ngẫu nhiên có điều kiện linh căn / nhân quả / map / thời gian. | Reward độc đáo có **giới hạn, log, cooldown**. KHÔNG phá cân bằng. |
| **Cày lặp** | Daily / weekly farm tài nguyên. | EXP, linh thạch, nguyên liệu, battle pass points. Có cap. |
| **Sự kiện mùa** | Live ops theo tuần / tháng / server. | Cosmetic, tài nguyên nâng cấp vừa phải, danh hiệu, vé bí cảnh. |

## 8. Nguyên tắc reward & cày/nạp

- **Chính tuyến**: EXP lớn theo mốc, linh thạch vừa phải, vật phẩm mở khoá, công pháp / pháp bảo có giới hạn. Không cho currency tự do quá nhiều.
- **Phụ tuyến**: EXP nhỏ-vừa, nguyên liệu, danh vọng NPC, cống hiến, vật phẩm tiêu hao.
- **Cày lặp**: ổn định, tính được, có **giới hạn ngày/tuần**.
- **Nạp tiền**: vé tháng, battle pass, đá bảo hộ refine, tẩy linh dịch, lượt bí cảnh phụ, túi/kho, skin, hiệu ứng pháp bảo. KHÔNG bán cảnh giới / EXP khổng lồ / đồ top server / ngọc max / công pháp tối thượng.
- **Pity / bảo hiểm**: refine / gem / reroll linh căn nên có pity hoặc bảo hộ. Nạp giúp giảm rủi ro, không thay thế nỗ lực.

## 9. Cốt truyện theo cảnh giới (28 stages)

> **Mã nhiệm vụ chuẩn**: `<realm_code>_<type>_<seq>`. Type: `main` / `realm` / `sect` / `npc` / `grind`.
> Ví dụ: `phamnhan_main_01`, `luyenkhi_grind_01`, `truc_co_npc_01`.
> **Catalog naming convention** xem [`../CONTENT_PIPELINE.md`](../CONTENT_PIPELINE.md). Realm code khớp `packages/shared` REALMS const.

### 9.1 Bảng tổng (28 cảnh giới)

| # | Realm code | Tên | Tier | Trọng | Main quest tuyến | Tóm tắt cốt truyện | Cơ duyên / mở khoá gameplay |
|---|---|---|---|---|---|---|---|
| 0 | `phamnhan` | Phàm Nhân | pham | 1 | Hoa Thiên Tuyển Đồ | Gia nhập Hoa Thiên Môn, bị coi thường vì căn cơ yếu nhưng được Lăng Vân Sinh nhận vào ngoại môn. | Hạt Giống Vô Danh trong hậu sơn. Onboarding, linh căn, túi đồ, daily quest. |
| 1 | `luyenkhi` | Luyện Khí | pham | 9 | Linh Khí Nhập Thể | Học hấp thu linh khí, mở 9 trọng Luyện Khí, lần đầu gặp dấu vết Tịch Linh khí. | Linh Tuyền Động (mở theo ngày, có giới hạn lượt). Skill hệ đầu, dungeon Sơn Cốc, trang bị Phàm/Linh. |
| 2 | `truc_co` | Trúc Cơ | pham | 9 | Trúc Đạo Cơ | Người chơi xây nền đạo cơ, chọn hướng tu luyện đầu tiên. | Trúc Cơ Đan, nội môn, công pháp sơ cấp, linh điền. |
| 3 | `kim_dan` | Kim Đan | pham | 9 | Kết Đan Phong Ba | Người chơi kết Kim Đan và bị Tịch Thiên Điện để ý. | Kim Đan dị tượng, pháp bảo đầu, bí cảnh. |
| 4 | `nguyen_anh` | Nguyên Anh | pham | 9 | Nguyên Anh Vấn Tâm | Người chơi đối mặt tâm ma và quan hệ NPC quá khứ. | Tâm cảnh, đạo tâm, thanh tâm đan. |
| 5 | `hoa_than` | Hoá Thần | pham | 9 | Thần Niệm Xuất Khiếu | Người chơi mở phong ấn Hoa Thiên Sơn tầng đầu. | Thần niệm, trận pháp, động phủ. |
| 6 | `luyen_hu` | Luyện Hư | pham | 9 | Hư Không Liệt Ngân | Người chơi đóng khe nứt hư không quanh Thanh Châu. | World boss, hư không tinh, pháp bảo nâng bậc. |
| 7 | `hop_the` | Hợp Thể | pham | 9 | Hoa Thiên Phục Mạch | Người chơi giành lại linh mạch cũ của Hoa Thiên Môn. | Tông môn 2.0, sect boss, công trình. |
| 8 | `dai_thua` | Đại Thừa | pham | 9 | Đại Thừa Tranh Thiên | Người chơi chọn phe trong đại chiến nhân gian. | Đạo chủng, auction, đại chiến tông môn. |
| 9 | `do_kiep` | Độ Kiếp | pham | 9 | Cửu Trọng Thiên Kiếp | Người chơi giải quyết nhân quả rồi phi thăng. | Thiên kiếp, hộ kiếp đan, phi thăng đài. |
| 10 | `nhan_tien` | Nhân Tiên | nhan_tien | 9 | Tiên Giới Không Phải Thiên Đường | Người chơi sống sót ở Phi Thăng Doanh. | Tiên thạch, tiên khí, tiên giới reputation. |
| 11 | `dia_tien` | Địa Tiên | nhan_tien | 9 | Lập Căn Tiên Giới | Người chơi chiếm tiểu tiên mạch cho Hoa Thiên. | Tiên phủ, tiên mạch, phân điện tiên giới. |
| 12 | `thien_tien` | Thiên Tiên | nhan_tien | 9 | Thiên Môn Thí Luyện | Người chơi vượt Thiên Môn do Tiên Đình kiểm soát. | Tiên thuật, tiên đình faction. |
| 13 | `huyen_tien` | Huyền Tiên | tien_gioi | 9 | Huyền Cơ Hoa Thiên | Người chơi tìm Hoa Thiên Tiên Vực bị xoá sử. | Di tích tiên vực, cổ truyền thừa. |
| 14 | `kim_tien` | Kim Tiên | tien_gioi | 9 | Kim Thân Bất Hủ | Người chơi luyện Kim Tiên thân và đối đầu tiên quan. | Kim thân, tiên khí cao. |
| 15 | `thai_at_kim_tien` | Thái Ất Kim Tiên | tien_gioi | 9 | Thái Ất Tranh Pháp | Người chơi tranh pháp tắc nhỏ với thế lực tiên giới. | Pháp tắc sơ cấp, set tiên khí. |
| 16 | `dai_la_kim_tien` | Đại La Kim Tiên | tien_gioi | 9 | Đại La Bất Diệt | Người chơi đánh Bạch Đế Tử, mở đường vào Thánh cảnh. | Đạo quả, Đại La chiến trường. |
| 17 | `chuan_thanh` | Chuẩn Thánh | tien_gioi | 9 | Trảm Tam Niệm | Người chơi trảm tham, sợ hoặc chấp để chuẩn bị thành thánh. | Tam niệm, thánh khí mảnh. |
| 18 | `thanh_nhan` | Thánh Nhân | hon_nguyen | 9 | Lập Đạo Thành Thánh | Người chơi chọn đại đạo chính và nhận Thánh vị. | Lập đạo, tín ngưỡng, Thánh vị. |
| 19 | `hon_nguyen` | Hỗn Nguyên Đại La | hon_nguyen | 9 | Hỗn Nguyên Quy Nhất | Người chơi hợp nhất nhiều pháp tắc thành đạo riêng. | Hỗn nguyên khí, thánh chiến. |
| 20 | `dao_quan` | Đạo Quân | hon_nguyen | 9 | Chưởng Một Đạo Vực | Người chơi quản lý hoặc chinh phục một đạo vực. | Đạo vực, quân đoàn, tông môn vũ trụ. |
| 21 | `thien_dao` | Thiên Đạo | hon_nguyen | 9 | Vấn Thiên | Người chơi trở thành thiên đạo của một thế giới hoặc giải phóng nó. | Thiên đạo quyền năng, thế giới chi tâm. |
| 22 | `ban_nguyen` | Bản Nguyên | ban_nguyen | 9 | Trở Về Nơi Sinh Ra Đạo | Người chơi vào Bản Nguyên Hải tìm nguồn gốc đại đạo. | Bản nguyên khí, đạo chủng trưởng thành. |
| 23 | `huyen_huyen` | Huyền Huyền | ban_nguyen | 9 | Đạo Ngoài Đạo | Người chơi gặp quy luật ngoài thiên đạo. | Ngoại đạo pháp tắc, cổ bi. |
| 24 | `vo_thuy` | Vô Thuỷ | ban_nguyen | 9 | Không Có Khởi Đầu | Người chơi vào vùng thời gian bị xoá. | Thời gian dungeon, luân bàn. |
| 25 | `vo_chung` | Vô Chung | vinh_hang | 9 | Không Có Kết Thúc | Người chơi đối mặt tương lai bị phong đạo. | Tương lai chiến trường, server progression. |
| 26 | `vinh_hang` | Vĩnh Hằng | vinh_hang | 9 | Vĩnh Hằng Không Phải Bất Tử | Người chơi đối đầu Tịch Thiên Đạo Chủ. | Chí bảo, Hoa Thiên Đạo Ấn. |
| 27 | `hu_khong_chi_ton` | Hư Không Chí Tôn | vinh_hang | 1 | Ngoài Đạo Còn Đường | Người chơi mở hư không và đối đầu Vô Đạo Chủng. | Season universe, chí tôn đạo ấn. |

### 9.2 Quest skeleton mỗi cảnh giới

Mỗi cảnh giới có 5 quest mặc định (catalog ID = `<realm_code>_<type>_01`). Đây là khung; gameplay tuyến chính tuyến nên mở rộng thành chuỗi (xem §11).

| Type | NPC phát (gợi ý) | Mục tiêu | Reward gợi ý |
|---|---|---|---|
| `main` | Theo bảng §9.1 (Lăng Vân Sinh / Mộc Thanh Y / Hàn Dạ / Tô Nguyệt Ly / Huyết La Sát / Vạn Kim Nương / Bạch Đế Tử) | Theo cốt truyện main quest cảnh giới đó. | EXP cảnh giới, tài nguyên vừa phải, vật phẩm mở khoá, danh vọng / cống hiến. |
| `realm` | Lăng Vân Sinh | Hoàn thành điều kiện tu vi / trọng số của cảnh giới; thu vật liệu cần để đột phá hoặc mở tầng truyện tiếp. | EXP lớn theo mốc, vật phẩm đột phá, mở map / cơ chế. |
| `sect` | Chấp Sự Hoa Thiên | Góp công xây Hoa Thiên Môn ở giai đoạn đó: tuần tra, góp vật liệu, bảo vệ linh mạch, nâng công trình. | Cống hiến, linh thạch vừa phải, nguyên liệu tông môn. |
| `npc` | NPC cá nhân (xoay vòng theo bảng) | Mở câu chuyện cá nhân; lựa chọn người chơi ảnh hưởng quan hệ / nhân quả / phe phái. | Quan hệ NPC, danh vọng, consumable, cơ duyên nhỏ. |
| `grind` | Bảng Nhiệm Vụ | Clear phụ bản phù hợp cảnh giới, săn boss / thu nguyên liệu theo hệ. Có cap ngày/tuần. | Tài nguyên ổn định, battle pass points, nguyên liệu nâng cấp. |

### 9.3 Nhiệm vụ phụ mẫu (mỗi cảnh giới có 4 sample)

Khung chung: `thu vật liệu chuyên biệt` / `giúp NPC liên quan` / `clear phụ bản theo hệ` / `điều tra dấu vết Tịch Thiên` / `góp tài nguyên cho Hoa Thiên Môn`.

Phàm Nhân:
- Gánh nước linh tuyền.
- Cứu dân làng.
- Thu linh thảo.
- Dọn yêu thú quanh Thanh Khê.

Luyện Khí:
- Săn Thanh Lang.
- Đấu tập ngoại môn.
- Tìm Linh Tuyền Động.
- Tuần tra Sơn Cốc.

Trúc Cơ → Hư Không Chí Tôn: theo khung chung trên (xem chuỗi cốt truyện §11 cho variant cụ thể).

## 10. Mối quan hệ NPC (relation graph)

- **Lăng Vân Sinh ↔ Hoa Thiên Đạo Tổ**: Lăng giữ mảnh truyền thừa cuối; Đạo Tổ là phong ấn cổ.
- **Mộc Thanh Y ↔ Tịch Thiên Điện**: Mộc bị cấy Tịch Linh Chủng — quest chữa kéo dài Phàm Nhân → Nguyên Anh.
- **Hàn Dạ ↔ Người chơi**: rivalry; karma branch quyết định bạn / thù trong Đại Thừa Tranh Thiên + Cửu Trọng Thiên Kiếp.
- **Huyết La Sát ↔ Hoa Thiên Môn**: từng là đệ tử cũ → ma đạo flag; tha hay giết quyết định tuyến ma.
- **Tô Nguyệt Ly ↔ Hoa Thiên cổ sử**: hậu nhân nhánh lưu đày, biết vị trí truyền thừa bị xoá khỏi sử (Huyền Tiên: Sử sách bị xoá).
- **Vạn Kim Nương ↔ Vạn Bảo Thương Hội**: source nhiệm vụ kinh tế, escort, auction; trung lập theo lợi ích.
- **Bạch Đế Tử ↔ Tịch Thiên Điện**: cánh tay Tịch Thiên trong Tiên Giới (lộ thân phận ở Đại La Kim Tiên: Bạch Đế giả nhân).
- **Tịch Thiên Đạo Chủ ↔ Hoa Thiên Đạo Tổ**: kẻ phản bội Thượng Cổ Đại Kiếp.

## 11. Phụ lục — chuỗi nhiệm vụ có cốt truyện (Quest Chain Bank)

Mỗi chuỗi 3-7 bước (`nhận tin → điều tra → lựa chọn → chiến đấu → báo cáo → nhận thưởng`). Khi triển khai code, mỗi chuỗi → quest catalog với trạng thái `locked / available / accepted / completed / claimed`.

| Chuỗi | Cảnh giới | NPC | Cốt truyện | Bước | Thưởng (cân bằng) |
|---|---|---|---|---|---|
| Ngoại môn còn lửa | Phàm Nhân → Luyện Khí | Lăng Vân Sinh | Hoa Thiên Môn thiếu tài nguyên tuyển đồ; người chơi phải chứng minh không phải gánh nặng. | Gánh nước linh tuyền → sửa trận cũ → cứu đệ tử bị yêu thú vây → báo cáo dấu vết Tịch Linh khí. | EXP đầu, Phàm khí, 100 cống hiến, mở daily ngoại môn. |
| Bóng đen trong Linh Điền | Luyện Khí | Mộc Thanh Y | Linh Điền héo không phải vì thiếu linh khí, mà do Tịch Linh Chủng ăn rễ linh thảo. | Thu mẫu đất → bắt trùng độc → vào hang rễ cây → đánh Độc Trùng Mẫu. | Linh thảo, đan hồi thể lực, quan hệ Mộc Thanh Y. |
| Kiếm khách đến từ Huyền Kiếm | Trúc Cơ | Hàn Dạ | Hàn Dạ đến khiêu chiến, thật ra đang truy kẻ trộm kiếm phổ lẩn vào Hoa Thiên Môn. | Đấu tập → điều tra vết kiếm → chọn tin/nghi Hàn Dạ → bắt nội tặc. | Danh vọng, kiếm kỹ phụ, mở rival flag. |
| Trúc Cơ Đan thiếu một vị | Trúc Cơ | Đan sư Khâu Lão | Đan phòng không đủ nguyên liệu Trúc Cơ Đan, buộc người chơi đi Hắc Mộc Lâm. | Tìm Ngưng Lộ Thảo → thương lượng tán tu → clear bầy yêu ong → mang về luyện đan. | Trúc Cơ Đan mảnh, EXP, công thức đan sơ cấp. |
| Bí cảnh dưới giếng cũ | Trúc Cơ → Kim Đan | Tô Nguyệt Ly | Một cái giếng bỏ hoang trong thôn cũ dẫn đến nhánh truyền thừa Hoa Thiên bị chôn. | Tìm chìa khoá đá → giải câu đố ngũ hành → chọn cứu tàn hồn hay lấy bảo vật. | Công pháp mảnh, karma, vật liệu Kim Đan. |
| Ngày kết Kim Đan | Kim Đan | Lăng Vân Sinh | Khi người chơi kết đan, Hạt Giống Vô Danh cộng hưởng khiến Tịch Thiên Điện phát hiện. | Chuẩn bị đan → hộ pháp → chống sát thủ → chọn Kim Đan dị tượng theo build. | Kim Đan dị tượng, pháp bảo sơ cấp, mở Tịch Thiên tuyến. |
| Máu trên thềm đá | Kim Đan → Nguyên Anh | Huyết La Sát | Một thôn phụ thuộc Hoa Thiên bị diệt; dấu vết cho thấy chính đạo và ma đạo đều có mặt. | Điều tra thi thể → hỏi nhân chứng → truy Huyết La Sát → chọn giết / tha / hợp tác. | Merit/sin, ma đạo flag, boss reward vừa phải. |
| Tâm ma của đại sư tỷ | Nguyên Anh | Mộc Thanh Y | Tịch Linh Chủng trong Mộc Thanh Y thức tỉnh, biến ký ức thành tâm cảnh. | Vào tâm cảnh → đánh ký ức méo → tìm nguyên nhân cấy chủng → chọn hy sinh tài nguyên cứu nhanh hay cày thuốc. | Quan hệ lớn, Mộc hệ buff, Thanh Tâm Đan. |
| Hoa Thiên Sơn tầng một | Hoá Thần | Lăng Vân Sinh | Phong ấn Hoa Thiên Sơn mở tầng đầu, cần thần niệm ổn định để vào. | Thu Thần Niệm Thạch → chỉnh trận → đánh Tịch Linh Pháp Sư → mở Tàng Kinh Các cổ. | Công pháp trung-cao, động phủ, trận pháp. |
| Khe nứt sau mưa sao | Luyện Hư | Vạn Kim Nương | Vạn Bảo thương đội mất tích gần khe nứt hư không; thương hội thuê Hoa Thiên điều tra. | Hộ tống → đóng khe nứt → cứu thương nhân → chọn nhận tiền hay danh vọng. | Hư Không Tinh, market discount, faction thương hội. |
| Linh mạch chọn chủ | Hợp Thể | Chấp Sự Hoa Thiên | Linh mạch cũ Hoa Thiên thức tỉnh; các tông môn tranh chiếm. | Góp tài nguyên → đánh thủ hộ linh → tổ chức sect boss → chọn biến linh mạch thành chính / ma. | Sect building, buff tu luyện, weekly sect quest. |
| Đại chiến Thanh Châu | Đại Thừa | Hàn Dạ / Huyết La Sát | Các phe ép Hoa Thiên chọn chính đạo / ma đạo. | Đàm phán → cứu đồng minh → đánh chiến trường → xử lý phản bội. | Đạo chủng, danh vọng phe, auction unlock. |
| Cửu Trọng Thiên Kiếp | Độ Kiếp | Lăng Vân Sinh | Thiên kiếp xét toàn bộ nhân quả: người từng cứu giúp có thể hộ pháp, kẻ từng hại thành tâm ma. | Chuẩn bị hộ kiếp → giải nhân quả cũ → đánh Thiên Kiếp Hoá Thân → phi thăng. | Phi thăng, tiên giới unlock, tổng kết karma. |
| Phi Thăng Doanh | Nhân Tiên | Tàn hồn Hoa Thiên | Người phi thăng bị Tiên Đình bắt khai thác tiên thạch; người chơi phải sống sót và cứu người cùng giới. | Khai thác → giấu tài nguyên → phá xiềng → đánh giám công. | Tiên thạch, tiên khí sơ cấp, tiên giới reputation. |
| Tiểu tiên mạch đầu tiên | Địa Tiên | Tô Nguyệt Ly | Muốn lập Hoa Thiên phân điện, người chơi cần chiếm một tiểu tiên mạch bị tiên thú giữ. | Khảo sát mạch → thuyết phục tán tiên → đánh Địa Mạch Tiên Thú → lập phân điện. | Tiên phủ, tiên mạch income có cap. |
| Thiên Môn không mở cho kẻ nghèo | Thiên Tiên | Vạn Kim Nương | Thiên Môn thí luyện bị thao túng bằng tiền và quan hệ. | Thu thư giới thiệu → đấu tiên quan → vạch gian lận → vượt Thiên Môn. | Tiên thuật, danh vọng, lựa chọn phe. |
| Sử sách bị xoá | Huyền Tiên | Tô Nguyệt Ly | Hoa Thiên Tiên Vực từng tồn tại nhưng bị xoá khỏi mọi ngọc giản. | Tìm Huyền Cơ Đồ → vào thư khố cấm → ghép ký ức cổ → chống truy binh. | Di tích tiên vực, cổ truyền thừa. |
| Bạch Đế giả nhân | Đại La Kim Tiên | Bạch Đế Tử | Bạch Đế Tử lộ thân phận Tịch Thiên, muốn thu đạo quả người chơi. | Tìm bằng chứng → cứu tù nhân phi thăng → đánh Bạch Đế Tử nhiều pha. | Đạo quả, mở Thánh cảnh. |
| Trảm Tam Niệm | Chuẩn Thánh | Hoa Thiên Đạo Tổ tàn ảnh | Người chơi chọn trảm tham / sợ / chấp; mỗi lựa chọn mở passive khác. | Vào Tam Niệm Đài → đánh ba hoá thân → chọn một niệm để trảm. | Passive đạo tâm, thánh khí mảnh. |
| Lập đạo không quỳ trời | Thánh Nhân | Hoa Thiên Đạo Tổ | Thành Thánh cần lập đạo, nhưng Tịch Thiên Điện ép nhận đạo đã bị chúng kiểm soát. | Thu đạo nguyên → cứu tín đồ → lập đạo riêng → vượt Thành Thánh Kiếp. | Thánh vị, tín ngưỡng, pháp tắc chính. |
| Một đạo vực, vạn sinh linh | Đạo Quân | Đạo Vực Chi Tâm | Quản lý đạo vực không chỉ là chiếm đất: cần cân bằng tài nguyên, chiến tranh, dân sinh. | Chọn luật đạo vực → dẹp phản loạn → bảo vệ linh mạch → xử lý thiên tai. | Đạo vực buff, quân đoàn, server event. |
| Ta là trời hay trời là ta | Thiên Đạo | Thiên Đạo Bản Ngã | Người chơi có thể trở thành thiên đạo của một thế giới, nhưng phải quyết định kiểm soát hay giải phóng chúng sinh. | Thu thế giới chi tâm → xử nhân quả → đánh thiên đạo ăn mòn → chọn kết quả. | Thiên đạo quyền năng, kết cục nhánh. |
| Hoa nở trong Bản Nguyên Hải | Bản Nguyên | Hoa Thiên Đạo Tổ | Hạt Giống Vô Danh trưởng thành thành mầm Hoa Thiên Đạo Liên. | Thu bản nguyên khí → đánh Bản Nguyên Thú → nuôi đạo liên → mở endgame crafting. | Đạo liên, bản nguyên vật liệu. |
| Không có khởi đầu | Vô Thuỷ | Tô Nguyệt Ly | Người chơi vào vùng thời gian bị xoá và thấy nhiều khả năng quá khứ của Hoa Thiên Môn. | Chọn ký ức đáng tin → sửa một nhân quả nhỏ → đánh Thời Gian Tàn Ảnh. | Luân bàn, thời gian shard, dungeon reset. |
| Không có kết thúc | Vô Chung | Hàn Dạ / Huyết La Sát | Một tương lai xấu hiện ra: mọi đạo đều bị Tịch Thiên phong kín. | Cứu đồng minh tương lai → phá Vô Chung Chi Môn → chọn hy sinh một tài nguyên lớn để đổi timeline. | Tương lai mảnh, server progression. |
| Vĩnh hằng không phải sống mãi | Vĩnh Hằng | Tịch Thiên Đạo Chủ | Trận chiến triết lý: tự do hỗn loạn hay trật tự bị khoá. | Đánh nhiều pha → dùng nhân quả/NPC từng cứu → chọn giết / phong ấn / thay thế. | Chí bảo, Hoa Thiên Đạo Ấn, kết cục chính. |
| Hoa Thiên nở trong hư không | Hư Không Chí Tôn | Hoa Thiên Đạo Liên | Vô Đạo Chủng ăn mòn mọi đại đạo, buộc toàn server góp sức mở chiến trường cuối. | Góp hư không tinh hạch → mở cổng → đánh boss server → tái lập vũ trụ mùa mới. | Chí tôn đạo ấn, season universe, cosmetic endgame. |

## 12. Khu vực bản đồ liên quan (gợi ý)

> Map runtime hiện tại nằm ở `apps/api/prisma/schema.prisma` (Map / Encounter) + `packages/shared` catalog. Khu vực dưới đây là **lore reference** — khi build runtime cần map sang `MapDef` / `DungeonDef` / `Encounter` thật.

| Khu vực | Lore | Cảnh giới phù hợp | Liên quan quest |
|---|---|---|---|
| **Hoa Thiên Sơn** | Tông môn của người chơi; phong ấn cổ. | Phàm Nhân → Hoá Thần (mở dần). | Hoa Thiên Tuyển Đồ; Hoa Thiên Sơn tầng một. |
| **Thanh Khê / Thanh Châu** | Vùng làng quê quanh tông môn. | Phàm Nhân → Đại Thừa. | Side quest dân làng; Đại chiến Thanh Châu. |
| **Sơn Cốc / Hắc Mộc Lâm** | Dungeon early game. | Luyện Khí → Trúc Cơ. | Linh Tuyền Động; Trúc Cơ Đan thiếu một vị. |
| **Linh Điền Hoa Thiên** | Vườn linh thảo của tông môn. | Luyện Khí → Nguyên Anh. | Bóng đen trong Linh Điền. |
| **Tàng Kinh Các / Động phủ Hoa Thiên** | Thư khố và động phủ cổ. | Hoá Thần → Hợp Thể. | Hoa Thiên Sơn tầng một; Hoa Thiên Phục Mạch. |
| **Phi Thăng Đài / Phi Thăng Doanh** | Cửa lên Tiên Giới và trại lao động. | Độ Kiếp → Nhân Tiên. | Cửu Trọng Thiên Kiếp; Phi Thăng Doanh. |
| **Tiên Phủ / Phân điện Hoa Thiên** | Cơ sở ở Tiên Giới. | Địa Tiên → Huyền Tiên. | Tiểu tiên mạch đầu tiên; Sử sách bị xoá. |
| **Thiên Môn** | Cổng thí luyện do Tiên Đình kiểm soát. | Thiên Tiên. | Thiên Môn không mở cho kẻ nghèo. |
| **Đại La Chiến Trường** | Chiến trường tiên giới cấp cao. | Đại La Kim Tiên. | Bạch Đế giả nhân. |
| **Tam Niệm Đài** | Đài trảm tâm. | Chuẩn Thánh. | Trảm Tam Niệm. |
| **Đạo Vực** | Vùng pháp tắc do Đạo Quân cai quản. | Đạo Quân → Thiên Đạo. | Một đạo vực, vạn sinh linh; Vấn Thiên. |
| **Bản Nguyên Hải** | Nguồn gốc đại đạo. | Bản Nguyên → Vô Chung. | Hoa nở trong Bản Nguyên Hải; Không có khởi đầu / kết thúc. |
| **Hư Không Chiến Trường** | Chiến trường server endgame. | Hư Không Chí Tôn. | Hoa Thiên nở trong hư không. |

## 13. Gợi ý chuyển thành gameplay (design → code mapping)

> Đây là gợi ý cho AI/dev khi triển khai Phase 12 runtime. **Không phải spec runtime ràng buộc.** Khi code thật, đối chiếu `prisma/schema.prisma` + [`../GAME_DESIGN_BIBLE.md`](../GAME_DESIGN_BIBLE.md) §K (module dependency rule) + [`../LONG_TERM_ROADMAP.md`](../LONG_TERM_ROADMAP.md) §0 (DO-NOT-BUILD-YET list).

| Lore element | Gameplay map | Ghi chú |
|---|---|---|
| Quest catalog | `packages/shared/src/quests.ts` (static catalog), `QuestDef` model | Naming: `<realm>_<type>_<seq>`. i18n vi/en parity. |
| Quest step | `QuestStep[]` on `QuestDef` | `objective: kill / collect / talk / explore / choice`. |
| Quest progress | `QuestProgress` table — unique `(characterId, questId)` | Trạng thái: `locked / available / accepted / completed / claimed`. |
| NPC catalog | `packages/shared/src/npcs.ts` (static), `NpcDef` model | Trường: `id`, `name`, `faction`, `realmGate`, `dialogueId`. |
| Dialogue | `DialogueDef` + `DialogueLine[]` | Chia branch theo karma / faction / quest flag. |
| Karma / faction | Đã có `Character.karma` (nếu có) hoặc thêm `CharacterFlag` table | Cần audit `prisma/schema.prisma` trước khi thêm. |
| Reward | `CurrencyService` / `ItemService` + `RewardLedger` row | Idempotency `(characterId, sourceType=QUEST_CLAIM, sourceKey=questId)`. |
| Quest UI | `apps/web` view `QuestView.vue` + Pinia store + filter (chính / phụ / tông môn / NPC / cày) + i18n | Tuân UI MODULE RULE (xem [`../AI_WORKFLOW_RULES.md`](../AI_WORKFLOW_RULES.md)). |
| Cơ duyên (kỳ ngộ) | `EncounterDef` (đã có) + cooldown / log | Đã có `Encounter` runtime trong Phase 12.1; cần extend cho quest-driven flavor. |
| Boss đặc trưng cảnh giới | `DungeonDef` / `BossDef` | Reuse Phase 12.2 dungeon runtime đang in-flight. |

## 14. Phần CHỈ là lore (chưa code, đừng build vội)

Theo [`../LONG_TERM_ROADMAP.md`](../LONG_TERM_ROADMAP.md) DO-NOT-BUILD-YET list — các phần dưới đây chỉ là lore, **không** triển khai trong Phase 12:

- **Pháp tắc / đạo vực / thánh chiến** (cảnh giới 17-21).
- **Bản Nguyên / thời gian dungeon / luân bàn** (cảnh giới 22-24).
- **Hư Không Chí Tôn / Vô Đạo Chủng / season universe** (cảnh giới 25-27).
- **Lập đạo / tín ngưỡng** (Thánh Nhân).
- **Vũ trụ mới / cosmic endgame**.

→ Các phần này lưu trong story bible làm long-term vision; runtime sẽ build sau khi Phase 12-15 stable.

## 15. Phần CÓ THỂ code ở Phase 12

Theo Phase 12 entry/exit criteria + roadmap §11 trong DOCX gốc:

- **Quest catalog Phàm Nhân + Luyện Khí + Trúc Cơ** (3 cảnh giới đầu) — static catalog ở `packages/shared`.
- **NPC catalog + Dialogue catalog** (Lăng Vân Sinh, Mộc Thanh Y, Hàn Dạ, Tô Nguyệt Ly cơ bản).
- **Quest API**: accept / progress / complete / claim. Server-authoritative. Validate điều kiện realm/level/precondition.
- **Reward qua ledger** — `RewardLedger` row, idempotency key.
- **Quest UI** — list / filter / accept / claim với loading/empty/error theo UI MODULE RULE.
- **Cơ duyên MVP** — kỳ ngộ theo map / linh căn / karma; cooldown + log.
- **Realm quest & breakthrough wiring** — liên kết quest cảnh giới với đột phá hiện có.
- **Story chapter tracking** — `Character.storyChapter` hoặc `CharacterFlag` để track tiến độ.

→ Roadmap PR cụ thể xem [`PHASE12_STORY_PROGRESS.md`](./PHASE12_STORY_PROGRESS.md).

## 16. Checklist chống rối cốt truyện

(Bê nguyên từ DOCX §12 — ghim cho mọi PR Phase 12 đụng story/quest/NPC)

- Mỗi NPC quan trọng phải có vai trò gameplay, không chỉ xuất hiện để nói chuyện.
- Mỗi nhiệm vụ chính tuyến phải mở một thứ: map, cơ chế, NPC, boss, công pháp, pháp bảo hoặc cảnh giới.
- Nhiệm vụ phụ phải có cốt truyện nhỏ: cứu người, điều tra, lựa chọn, trả nợ nhân quả, mở quan hệ.
- Phần thưởng phải đi qua ledger nếu là tiền/item/reward thật.
- Không cho nhiệm vụ phụ thưởng quá mạnh hơn cày chính; không cho chính tuyến phá economy.
- Mỗi cảnh giới phải có ít nhất một boss / cơ duyên / điều kiện đột phá đặc trưng.
- Nạp tiền hỗ trợ tiện lợi và giảm rủi ro, không thay thế hành trình tu luyện.
- Cốt truyện triển khai theo phase, KHÔNG nhét 28 cảnh giới vào một PR.

## 17. Gợi ý biến nhiệm vụ thành hệ thống sống

(DOCX §14)

- Mỗi NPC có lịch phát nhiệm vụ theo ngày/tuần; nhiệm vụ quan trọng chỉ mở khi đủ cảnh giới / quan hệ / nhân quả.
- Mỗi chuỗi quest 3-7 bước: nhận tin → điều tra → lựa chọn → chiến đấu → báo cáo → nhận thưởng.
- NPC nên phản ứng với hành động cũ (tha Huyết La Sát → mở nhiệm vụ ma đạo; cứu Hàn Dạ → có viện quân Đại Thừa).
- Dùng nhiệm vụ tông môn để kéo cày dài hạn (góp tài nguyên, xây công trình, mở bí cảnh, bảo vệ linh mạch). Nạp tăng tốc một phần, vẫn cần cộng đồng / tông môn.
- Chính tuyến chia checkpoint — không ép một chuỗi quá dài; mỗi checkpoint có reward vừa phải + đoạn truyện nhỏ.

---

## Cross-reference

- [`../START_HERE.md`](../START_HERE.md) — cổng vào docs (đọc trước).
- [`PHASE12_STORY_PROGRESS.md`](./PHASE12_STORY_PROGRESS.md) — progress source of truth cho Phase 12 story implementation.
- [`../AI_HANDOFF_REPORT.md`](../AI_HANDOFF_REPORT.md) — snapshot trạng thái thật mỗi PR.
- [`../GAME_DESIGN_BIBLE.md`](../GAME_DESIGN_BIBLE.md) — vision + 13 system + module dependency rule.
- [`../LONG_TERM_ROADMAP.md`](../LONG_TERM_ROADMAP.md) — Phase 9 → 17 + DO-NOT-BUILD-YET list.
- [`../ECONOMY_MODEL.md`](../ECONOMY_MODEL.md) — currency invariants + ledger contract (mọi quest reward bắt buộc qua ledger).
- [`../CONTENT_PIPELINE.md`](../CONTENT_PIPELINE.md) — process thêm content (item / skill / quest / monster) + naming + i18n parity.
- [`../BALANCE_MODEL.md`](../BALANCE_MODEL.md) — band reward / curve EXP để không phá balance.
- [`../AI_WORKFLOW_RULES.md`](../AI_WORKFLOW_RULES.md) — UI MODULE RULE + DOCS UPDATE RULE + SAFETY CORRECTION khi viết PR.
- [`../archive/original-docx/TuTienLo_Story_Bible.docx`](../archive/original-docx/TuTienLo_Story_Bible.docx) — DOCX gốc (archive only, KHÔNG đọc mỗi session).
