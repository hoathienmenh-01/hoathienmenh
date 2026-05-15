# XT Mobile-First UI Guide (UI-2.0)

UI-2.0 đổi định hướng từ "admin dashboard nhiều cột chật chữ" sang **mobile-first
fantasy app** — gọn, dễ bấm trên điện thoại nhưng vẫn rộng rãi, cao cấp khi mở
trên desktop. Tài liệu này mô tả layout, navigation, theme, route mapping và
test coverage của UI-2.0.

## Quick reference

| | Mobile (default, < lg) | Desktop (≥ lg / 1024px+) |
| --- | --- | --- |
| Top bar | `XTMobileTopBar` cao 60px, có resource chips cuộn ngang | Sidebar trái 232px (`--xt-desktop-sidebar-w`) + topbar legacy |
| Nav chính | `XTBottomNav` cố định 5 mục | Sidebar nhiều nhóm |
| Menu phụ | `XTMenuDrawer` (bottom sheet) | Sidebar đã chứa đầy đủ |
| Content | 1 cột, padding-bottom 96px tránh che bởi bottom nav | `max-w-7xl`, có right rail xl+ |
| Touch target | ≥ 40–44px | ≥ 36px |

## Layout shell

`AppShell.vue` là root layout cho mọi route. Có hai nhánh render song song:

- **Mobile (<lg)**: `XTMobileTopBar` (sticky, h-15) + `slot` (`pt-3 pb-24`) +
  `XTBottomNav` (fixed, h-16) + `XTMenuDrawer` (bottom sheet teleport `body`).
- **Desktop (≥lg)**: sidebar `[var(--xt-desktop-sidebar-w)]` + `main` với
  `max-w-7xl`. Sidebar dùng cùng `XT_NAV_GROUPS` (xem dưới) để hiển thị các
  nhóm chức năng.

Các `data-testid` cũ vẫn giữ để tương thích AppShell tests:
`shell-mobile-toggle`, `shell-mobile-backdrop`, `shell-sidebar`,
`shell-resource-chips`, `shell-equipped-title`. Toggle bây giờ điều khiển
drawer (không còn slide sidebar trên mobile).

## Navigation data source

`apps/web/src/lib/xtNav.ts` là **single source of truth** cho cả bottom nav,
menu drawer và sidebar. Bao gồm:

- `XT_BOTTOM_NAV: XTBottomNavEntry[]` — đúng **5 items**:
  1. `home` → `/home`
  2. `cultivation` → `/cultivation`
  3. `inventory` → `/inventory`
  4. `activity` → `/world`
  5. `menu` → `null` (pseudo-action mở drawer)
- `XT_NAV_GROUPS: XTNavGroup[]` — 8 nhóm (`core`, `cultivation`, `activity`,
  `inventory`, `social`, `market`, `longTerm`, `system`), mỗi nhóm có `accent`
  riêng (jade/cultivation/combat/secret/inventory/alchemy/sect/market/admin).
- `flattenNav()` — dùng cho tests và quick action mapping.

Mỗi item `XTNavItem` có thể đính kèm `badge` (`breakthrough` | `boss` |
`mission` | `mail` | `topup` | `notification`) — store badges/game cung cấp
giá trị count, drawer/sidebar render badge tự động.

## Mobile shell components

- `XTMobileTopBar.vue` — logo XT, character name + realm chip, resource chips
  (`linhThach`, `tienNgoc`, `power`), icon mail/notification/settings. Cuộn
  ngang khi quá nhiều resource (touch ≥ 32px chip, padding-right an toàn).
- `XTBottomNav.vue` — 5 mục từ `XT_BOTTOM_NAV`. Item active đánh dấu bằng
  `aria-current="page"` + ring emerald + amber dot top-right. Tap mục `menu`
  emit `open-menu`.
- `XTMenuDrawer.vue` — bottom sheet (teleport `body`), render tất cả
  `XT_NAV_GROUPS` (filter `staffOnly` theo role). Item click → `router.push`
  + emit `close`. ESC đóng. Backdrop emerald-950/35 + blur nhẹ.
- `XTBackButton.vue` — `window.history.length > 1 ? router.back() : push('/dashboard')`.
- `XTPageHeader.vue` — header cho function pages (Inventory, Cultivation, Sect,
  …). Hiển thị back button (trừ khi `hideBack`), title, subtitle, action slot.

## Icon system

`XTIcon.vue` chứa ICON_PATHS map ~60 icon line (style lucide), không cần
external dep:

- core: `home`, `dashboard`, `menu`, `close`, `chevronLeft`, `chevronRight`,
  `refresh`, `settings`, `mail`, `bell`, `search`.
- cultivation: `cultivation`, `breakthrough`, `bodyCultivation`, `method`,
  `spiritualRoot`, `skillBook`, `alchemy`.
- inventory: `inventory`, `equipment`, `artifact`, `material`, `gem`.
- combat/activity: `boss`, `secretRealm`, `farm`, `tower`, `roguelike`,
  `missions`, `event`.
- social/market: `sect`, `social`, `mentor`, `market`, `auction`, `shop`,
  `topup`.
- long-term: `achievement`, `title`, `reputation`, `season`, `leaderboard`.
- resources: `linhThach`, `tienNgoc`, `power`, `pet`.

Sizes: `xs / sm / md / lg / xl`. Tones: `jade / gold / cyan / violet / danger
/ muted / inherit`. Sources từ static map nên `v-html` an toàn (eslint-disable
local).

## Dashboard layout (mobile-first)

`DashboardView.vue`:

1. **Đạo Thân Card** (`CultivationHeroCard`) — full width.
2. **Stats grid** (`StatCard` × 4) — 2 cột mobile, 4 cột desktop.
3. **Warnings** — nếu có.
4. **Today + Featured** — `grid-cols-1` mobile, `xl:grid-cols-2`.
5. **Quick Actions** — 8 quick actions chính (Tu Luyện, Túi Đồ, Trang Bị,
   Linh Thú, Tông Môn, Chợ, Thành Tựu, Thư).
6. **Right rail** — chỉ render `xl:block`, chứa Sự Kiện / Boss / Bí Cảnh /
   Trang Bị / Thư với badge count, empty state khi mọi count = 0.

Test ids đã ổn định: `dashboard-modern`, `dashboard-character`,
`dashboard-counters`, `dashboard-loading`, `dashboard-error`,
`dashboard-warnings`, `dashboard-featured`, `dashboard-featured-empty`,
`dashboard-right-panel`, `dashboard-right-empty`.

## Featured activities

`FeaturedActivitiesCard.vue` hiển thị 2–4 hoạt động nổi bật. Mỗi item có
`status`, `cooldown`, `rewards` (max 3 chip), `tone` (`jade/combat/secret/
gold/event`), `route`. Empty state hiển thị khi mảng items rỗng. Button
"Tham Gia" disabled khi `route = null`.

## Theme tokens (mobile shell additions)

`apps/web/src/design/tokens.css` được mở rộng:

- Shell heights: `--xt-mobile-topbar-h: 60px`, `--xt-mobile-bottomnav-h: 66px`,
  `--xt-desktop-sidebar-w: 232px`, `--xt-desktop-max-w: 1280px`.
- Z-index: content(1) / topbar(30) / bottom-nav(40) / drawer(60) / modal(70)
  / toast(80).
- Motion: `--xt-motion-fast/base/slow` (140/220/360ms); tự thay 0 khi
  `prefers-reduced-motion: reduce`.
- Per-group accents: `--xt-accent-jade/cultivation/combat/secret/inventory/
  alchemy/pet/sect/market/admin`. Component chọn class tone theo group.

## Route audit & wiring

Tất cả menu/quick-action/bottom-nav đều route tới view thực hoặc
`XianxiaPlaceholderView`. Mapping chính:

| Item | Route | Trạng thái |
| --- | --- | --- |
| Trang Chủ | `/home` | View thực (`HomeView`) |
| Dashboard | `/dashboard` | View thực |
| Tu Luyện | `/cultivation` | Placeholder |
| Đột Phá | `/breakthrough` | View thực |
| Luyện Thể | `/body-cultivation` | View thực |
| Công Pháp | `/cultivation-method` | View thực |
| Linh Căn | `/spiritual-root` | View thực |
| Luyện Đan | `/alchemy` | View thực |
| Farm | `/world/farm-maps` | View thực |
| Boss | `/boss` | View thực |
| Bí Cảnh | `/secret-realm` | View thực |
| Tháp | `/tower` | View thực |
| Roguelike | `/roguelike` | View thực |
| Túi Đồ | `/inventory` | View thực |
| Trang Bị | `/equipment` | View thực |
| Pháp Bảo | `/artifact-v2` | View thực |
| Linh Thú | `/pets` | View thực |
| Tông Môn | `/sect` | View thực |
| Mentor | `/mentor` | View thực |
| Thư | `/mail` | View thực |
| Thông Báo | `/notification-settings` | View thực |
| Chợ | `/market` | View thực |
| Đấu Giá | `/auction` | View thực |
| Linh Bảo Các | `/shop` | View thực |
| Nạp | `/topup` | View thực |
| Thành Tựu | `/achievements` | View thực |
| Danh Hiệu | `/titles` | View thực |
| Uy Danh | `/reputation` | View thực |
| Mùa Giải | `/seasons` | View thực |
| BXH | `/leaderboard` | View thực |
| Cài Đặt | `/settings` | View thực |
| Hỗ Trợ | `/support/feedback` | View thực |
| Tố Cáo | `/support/report-player` | View thực |

Không có nút "chết" — placeholder nào chưa có UI vẫn render
`XianxiaPlaceholderView` với back button và CTA Dashboard.

## Reduced motion / visualEffectLevel

Tokens motion tự về 0ms khi `prefers-reduced-motion: reduce`. Body class
`.reduced-motion` (đặt bởi settings store) cũng triggers cùng quy tắc. Hiệu
ứng linh khí / rune / shimmer trong `SpiritualAmbientLayer` và lớp ambient
khác đã honor flag — tham khảo `MODERN_XIANXIA_UI_GUIDE.md`.

## Tests

Web suite hiện 212 test files / 2256 tests xanh. UI-2.0 thêm:

- `XTShell.test.ts` (17): bottom nav, menu drawer, back button, page header,
  XTIcon, xtNav config.
- `FeaturedActivitiesCard.test.ts` (4): empty / render / navigate / disabled.

Test ids ổn định cho future tests:
`xt-bottomnav-{home|cultivation|inventory|activity|menu}`,
`xt-menu-drawer`, `xt-menu-close`, `xt-menu-group-*`, `xt-menu-item-*`,
`xt-back-button`, `xt-page-header`, `xt-icon`,
`dashboard-featured`, `dashboard-featured-empty`, `featured-*`,
`featured-*-go`.

## Open follow-up

- Có thể mở rộng `XTMobileTopBar` để hiển thị stamina/spirit bar (hiện chỉ
  resource chips).
- Empty state cho các page chức năng phụ (Sect, Mentor, ...) còn dùng UI cũ
  — sẽ chuẩn hoá dần khi rảnh.
- Recipe pattern cho function page chuẩn: `AppShell` + `XTPageHeader` +
  content list. Áp dụng dần cho mọi `XianxiaPlaceholderView` đã có view thực.
