# Frontend Route Mapping

UI rule: every clickable shell/dashboard item routes to a real view, a redirect alias, or a safe placeholder with “Chức năng đang được phát triển”.

| Feature | Label | Route | Status |
|---|---|---:|---|
| Dashboard | Thiên Cung Tổng Quan | `/dashboard` | real |
| Home | Trang Chủ | `/home` | real |
| Character | Nhân Vật | `/character` | safe placeholder |
| Cultivation | Tu Luyện | `/cultivation` | safe placeholder |
| Breakthrough | Đột Phá | `/breakthrough` | real |
| Body Cultivation | Luyện Thể | `/body-cultivation` | real |
| Cultivation Method | Công Pháp | `/cultivation-method` | real |
| Cultivation Method alias | Công Pháp | `/methods`, `/cultivation-methods` | redirect |
| Spiritual Root | Linh Căn | `/spiritual-root` | real |
| Spiritual Root alias | Linh Căn | `/spiritual-roots` | redirect |
| Skill Book | Pháp Quyển | `/skill-book` | real |
| Skill alias | Pháp Quyển | `/skills` | redirect |
| Alchemy | Luyện Đan | `/alchemy` | real |
| Inventory | Linh Bảo Các | `/inventory` | real |
| Equipment | Trang Bị | `/equipment` | redirect to `/inventory` |
| Pets | Linh Thú | `/pets` | real |
| Pets alias | Linh Thú | `/spirit-pets` | redirect |
| Secret Realm | Bí Cảnh | `/secret-realm` | real |
| Secret Realms alias | Bí Cảnh | `/secret-realms` | redirect |
| Dungeon Run | Bí Cảnh Hành | `/dungeon-run` | real |
| Roguelike | Roguelike Bí Cảnh | `/roguelike` | real |
| Farm Maps | Linh Sơn Farm | `/world/farm-maps` | real |
| Boss | Boss Đại Hội | `/boss` | real |
| Missions | Nhiệm Vụ | `/missions` | real |
| Tower | Đăng Tiên Tháp | `/tower` | redirect to `/world/towers` |
| Sect | Tông Môn | `/sect` | real |
| Market | Phường Thị | `/market` | real |
| Auction | Đấu Giá | `/auction` | redirect to `/market` |
| Events | Sự Kiện | `/events` | real |
| Achievements | Thành Tựu | `/achievements` | real |
| Mail | Thư Sứ | `/mail` | real |
| Notifications | Thông Báo | `/notification-settings` | real settings |
| Notifications center | Thông Báo | `/notifications` | safe placeholder |
| Settings | Cài Đặt | `/settings` | real |
| Admin | Quản Trị | `/admin` | staff-only real |

## Placeholder behavior

`XianxiaPlaceholderView.vue` reads route meta (`title`, `description`, `icon`) and renders:

- icon badge,
- Vietnamese placeholder title/description,
- “Quay lại Dashboard” button to `/dashboard`.

Use placeholders only when a function has no complete view yet. Prefer an existing real route or redirect if one exists.
