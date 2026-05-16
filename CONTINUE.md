# CONTINUE — Cửu Thiên Mộng (PR2–PR9)

Branch: `devin/1778830998-cuu-thien-mong-views`
PR (draft): xem link cuối — nối tiếp PR #600 (PR1 đã merge).

---

## ĐÃ XONG TRONG COMMIT NÀY

1. **PR3 — Equipment art (80 ảnh):**
   - Resize 80 ảnh từ `photos/tier{1..10}/{slot}{tier}.jpeg` → `apps/web/public/equipment/sm/{slot}{tier}.webp` (256px, ~85% quality) + `md/` (512px, ~88% quality). Tổng 5.4MB.
   - Util `getEquipmentImage()` trong `packages/shared/src/equipment-images.ts` + 11 unit test xanh.
   - Slot mapping **theo đúng yêu cầu user**: kiem→WEAPON, ao→ARMOR, mu→HAT, giay→BOOTS, dai→BELT, daychuyen→TRAM, phapbao→ARTIFACT_1/2/3, nhan→loose (dùng `artName='nhan'`).
   - Component `EquipmentArtCell.vue` (gold rim + jade glow khi equipped, tier badge).
   - `ItemAuraFrame.vue` render `<img>` khi có slot+tier.
   - Đã wire vào `InventoryView.vue` (cả equipped slot list + unequipped grid), `LoadoutView.vue` (mỗi slot preset có preview), `PhapBaoPanel.vue` (mỗi pháp bảo có ảnh).

2. **Dark theme sweep:**
   - 27 component/view xoá toàn bộ class light-mode còn sót (`text-emerald-950`, `bg-white/55|65|70`, `bg-emerald-50`, `border-emerald-200|300/30|35|45|60`, `text-emerald-700|900`) → map sang token `var(--xt-text-primary|muted|subtle|jade|gold)` / `var(--xt-bg-surface|glass)` / `var(--xt-border-jade|gold)` / `var(--xt-jade-soft)`.
   - Files: DashboardView, TopupView, SeasonsView, TerritoryView, ReputationView, XianxiaPlaceholderView, FeaturedActivitiesCard, TodayChecklistCard, XTPageHeader, XTBackButton, GameIcon, XTIcon, BossPhaseBadge, CraftingResultEffect, TribulationBattleStatus, BossSchedulePanel, LiveOpsTodayPanel, SocialPanel, PublicPlayerProfileModal, SectSeasonPanel, plus 7 Admin panels.

3. **Verify:**
   - `pnpm -C packages/shared test -- equipment-images` → 11/11 pass.
   - `pnpm -C apps/web lint` → clean (đã fix `slot` prop conflict bằng cách rename → `equipSlot` / `equip-slot`).
   - `pnpm -C apps/web typecheck` → clean.
   - `pnpm -C apps/web build` → success.
   - Test suite chưa run đầy đủ trong session này (user yêu cầu push gấp) — CI sẽ tự chạy.

---

## CÒN THIẾU (todo cho người tiếp theo)

### A. Visual effects (PR2 trong roadmap cũ) — ĐÃ XONG
- [x] `BreakthroughView.vue` / `BreakthroughBanner.vue` — thiên kiếp sấm sét full-screen (CSS-only, tôn trọng `visualEffectLevel` + `prefers-reduced-motion`).
- [x] `BossView.vue` — hiệu ứng "mực rơi" shutter khi boss phase change (HP cross 75/50/25%).
- [x] `RareDropPopup.vue` — portrait card cuộn lụa khi drop MYTHIC / IMMORTAL / LEGENDARY.
- [x] `FloatingCombatText.vue` — typeface cổ phong (Noto Serif SC / LXGW WenKai TC) + element-tinted text-shadow.

### B. Hero views polish (PR4–PR6)
- [x] `DashboardView.vue` — eyebrow Hán/Việt (`九天梦境 · Cửu Thiên Mộng`) qua `XTHeroEyebrow` (PR3).
- [x] `HomeView.vue` — character summary card wrap trong `XTSealFrame` jade tone + eyebrow `道身仙骨 · Đạo Thân Tiên Cốt` (PR3).
- [x] `CultivationHeroCard.vue` (dùng trên Dashboard) — eyebrow `道身仙骨` + `XTSealFrame` gold tone với 4 góc `真修丹道` + watermark `天` (PR3).
- [ ] `CultivationMethodV2View.vue`, `BodyCultivationView.vue`, `SpiritualRootView.vue`.
- [ ] Combat: `BossView`, `BossHubView`, `PvpView`, `ArenaView`, `TribulationView`, `DungeonHubV2View`, `DungeonRunView`, `SecretRealmView`, `RoguelikeView`, `TrialTowerView`, `TerritoryView`, `SectWarView`.
- [ ] Social: `SectView`, `SectContentView`, `MarketV2View`, `MarketView`, `SocialView`, `MailView`, `NpcView`, `StoryV2View`, `StoryDungeonView`.

### C. Activity / Quest (PR7)
- [ ] `ActivityView`, `QuestView`, `MissionView`, `AchievementView`, `CodexView`, `ReputationView`, `MentorView`, `EncounterView`, `FarmMapView`, `WorldContentView`.

### D. Admin (PR8) — pass nhẹ
- [ ] ~20 admin views: `AdminView`, `AdminAchievementReputationView`, `AdminCodexView`, `AdminControlCenterView`, `AdminEventBuilderView`, `AdminFeedbackView`, `AdminMailView`, `AdminMarketV2View`, `AdminPetsView`, `AdminPvpCenterView`, `AdminReportsView`, `AdminSystemStatusView`.

### E. Misc (PR9)
- [ ] `SettingsView` — thêm toggle day-mode (`data-theme='day'` đã có sẵn token alternate).
- [ ] `ProfileView`, `AuthView`, `ForgotPasswordView`, `ResetPasswordView`, `OnboardingView`, `OnboardingQuestView`, `ReturnerView`.
- [ ] `TopupView`, `MonetizationView`, `MonetizationShopView`, `MonetizationDacQuyenView`, `ShopView`, `ShopPacksView`, `CosmeticView`, `TitleView`, `WalletView`, `GiftCodeView`, `NotificationSettingsView`, `FeedbackView`, `ReportPlayerView`, `PlayerLogsView`, `SeasonsView`.

---

## CÂU LỆNH CONTINUE (copy-paste)

```bash
# 1. Pull branch hiện tại
cd /home/ubuntu/repos/xuantoi
git fetch origin
git checkout devin/1778830998-cuu-thien-mong-views
git pull --ff-only origin devin/1778830998-cuu-thien-mong-views

# 2. Install + build shared (BẮT BUỘC trước khi typecheck/test web)
pnpm install
pnpm --filter @xuantoi/shared build

# 3. Verify clean state
pnpm -C apps/web lint
pnpm -C apps/web typecheck
pnpm -C apps/web test
pnpm -C apps/web build

# 4. (Nếu cần regenerate 80 ảnh) — copy từ photos/ → public/equipment/
SLOTS="kiem ao mu giay nhan daychuyen dai phapbao"
mkdir -p apps/web/public/equipment/sm apps/web/public/equipment/md
for t in 1 2 3 4 5 6 7 8 9 10; do
  for s in $SLOTS; do
    src="photos/tier${t}/${s}${t}.jpeg"
    [ -f "$src" ] || { echo "MISSING $src"; continue; }
    convert "$src" -resize 256x256 -quality 85 "apps/web/public/equipment/sm/${s}${t}.webp"
    convert "$src" -resize 512x512 -quality 88 "apps/web/public/equipment/md/${s}${t}.webp"
  done
done

# 5. Test dev server (chỉ cần verify visual)
pnpm -C apps/web dev
# → http://localhost:5173
```

---

## API ĐỂ NHÚNG ẢNH VÀO VIEW MỚI

```ts
import { getEquipmentImage } from '@xuantoi/shared';

// Cách 1: dùng component (recommended)
import EquipmentArtCell from '@/components/xianxia/EquipmentArtCell.vue';
// <EquipmentArtCell :equip-slot="item.slot" :tier="item.equipmentTier" size="md" show-tier :equipped="isEquipped" />

// Cách 2: gọi util trực tiếp
const img = getEquipmentImage({ slot: 'WEAPON', tier: 5, size: 'md' });
// → { url: '/equipment/md/kiem5.webp', artName: 'kiem', tier: 5, size: 'md' }

// Cách 3: force art name (cho nhẫn / pháp bảo custom)
const img2 = getEquipmentImage({ artName: 'nhan', tier: 7 });
// → { url: '/equipment/sm/nhan7.webp', ... }
```

**Slot mapping (đúng yêu cầu user):**
| File art | Slot (enum) | UI label |
|---|---|---|
| `kiem`      | `WEAPON`              | Kiếm |
| `ao`        | `ARMOR`               | Áo/Giáp |
| `mu`        | `HAT`                 | Mũ |
| `giay`      | `BOOTS`               | Giày |
| `dai`       | `BELT`                | Đai |
| `daychuyen` | `TRAM`                | Ngọc Bội |
| `phapbao`   | `ARTIFACT_1/2/3`      | Pháp Bảo |
| `nhan`      | — (custom `artName`)  | Nhẫn |

---

## NHỚ KHI CONTINUE

- KHÔNG đổi gameplay/balance/backend.
- KHÔNG modify test để fake green — chỉ update snapshot khi đổi UI cố ý.
- KHÔNG force-push hoặc amend (chỉ commit thêm).
- KHÔNG split lại thành nhiều PR — gộp vào branch này.
- Token có sẵn ở `apps/web/src/design/tokens.css` — dùng `var(--xt-...)` thay vì hard-code emerald/amber.
- Light-mode toggle: thêm `data-theme="day"` trên `<html>` → tokens swap về palette sáng (đã có sẵn).
