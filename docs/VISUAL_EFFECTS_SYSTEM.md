# Visual Effects, Combat Feedback, Item Aura & Presentation System (Phase 42.0)

> **Trạng thái:** V1 — chỉ là **lớp trình diễn**. Không can thiệp combat
> formula, drop rate, balance, P2W, hoặc gameplay.

## 1. Mục tiêu

Phase 42 cung cấp tầng trình diễn cho:
- Damage popup nổi (FloatingCombatText)
- Timeline combat feedback (CombatFeedbackTimeline)
- Status effect bar (StatusEffectBadge / StatusEffectBar)
- Aura quanh trang bị (ItemAuraFrame)
- Popup rớt đồ hiếm (RareDropPopup / RareDropQueueHost)
- Cảnh báo boss (BossWarningBanner / BossPhaseBadge)
- Banner đột phá (BreakthroughBanner)
- Banner kết quả luyện chế (CraftingResultEffect)
- Generic queue host (EffectQueueHost)
- Settings (EffectSettingsPanel) + Preview lab (EffectPreviewPanel)

Tất cả component đều **đọc props presentation-only**. Không có logic
thay đổi dữ liệu trên server.

## 2. Shared catalog

`packages/shared/src/visual-effects.ts` chứa:

- **Enums**: `VISUAL_EFFECT_TYPES`, `VISUAL_EFFECT_ELEMENTS`,
  `VISUAL_EFFECT_INTENSITIES`, `VISUAL_EFFECT_MOTION_LEVELS` (`OFF`,
  `LOW`, `MEDIUM`, `HIGH`), `VISUAL_EFFECT_RARITIES`,
  `VISUAL_EFFECT_QUALITIES`.
- **Catalog**: gần 80 `VisualEffectDef` (damage / heal / crit / miss /
  block / dot / element / boss / breakthrough / item aura / rare drop /
  alchemy / craft / artifact awaken). Mỗi entry có
  `reducedMotionFallback` (đệ quy về `EFFECT_NONE`).
- **Helpers**: `getEffectByDamageType`, `getEffectByRarity`,
  `getElementalEffect`, `getItemAuraEffect`, `getBossEffect`,
  `getCraftEffect`, `getReducedMotionEffect`,
  `resolveEffectiveMotionLevel`.
- **Validators**: `validateVisualEffectDef`, `validateSafetyConstraints`.
- **Status effect catalog**: `STATUS_EFFECT_TYPES` + helper
  `getStatusEffectByKey` / `getAllStatusEffects` (BURN, POISON, FREEZE,
  STUN, BLEED, WEAKEN, ARMOR_BREAK, SILENCE, SHIELD, COUNTER,
  ATTACK_UP, DEFENSE_UP, SPEED_UP, SPEED_DOWN, REGEN, CLEANSE, CURSE,
  LIFESTEAL, REFLECT, IMMUNE).

Tất cả phần này được lock bằng 31 unit test trong
`packages/shared/src/visual-effects.test.ts`.

## 3. Motion level + reduced motion

`resolveEffectiveMotionLevel({ reduceMotion, visualEffectLevel })`:
- Nếu `reduceMotion=true` → trả về `min(visualEffectLevel, LOW)`.
- Còn lại trả về `visualEffectLevel`.

CSS layer `apps/web/src/style/visual-effects.css`:
- Mọi animation đều có class `.ve-anim-*` (float-up, fade-in,
  pulse-soft, glow-subtle, aura-ring, shimmer-light, shake-small,
  boss-warning-pulse, rare-drop-pop, breakthrough-glow).
- `@media (prefers-reduced-motion: reduce)` + class `.reduced-motion`
  disable toàn bộ keyframe.

Các component dùng helper `effectiveLevel` để tự gating animation:
- `OFF` → không animation, có thể không render.
- `LOW` → chỉ animation rất nhẹ.
- `MEDIUM` → bỏ animation `LEGENDARY`/`IMMORTAL`.
- `HIGH` → render đầy đủ.

## 4. Item aura policy

`getItemAuraEffect({ tier, rarity, element? })`:
- Map rarity → aura key (`COMMON`→`ITEM_AURA_NONE`,
  `UNCOMMON`→`ITEM_AURA_LOW`, …, `MYTHIC`→`ITEM_AURA_IMMORTAL`).
- Tier `>= 9` có thể **bump** aura **lên** (`bumpAura()`), nhưng
  **không bao giờ hạ** aura rarity.
- Element chỉ ảnh hưởng `cssClass` tint, không thay aura intensity.

## 5. Frontend components

Toàn bộ trong `apps/web/src/components/visual-effects/`:

| Component | Mục đích |
|---|---|
| `FloatingCombatText` | Số damage / heal / miss / block / crit / dot, animation float-up. |
| `StatusEffectBadge` / `StatusEffectBar` | Buff/debuff icon + stack + duration. |
| `ItemAuraFrame` | Wrapper aura quanh slot trang bị. |
| `RareDropPopup` / `RareDropQueueHost` | Popup rớt đồ hiếm + clamp `maxVisible`. |
| `BossWarningBanner` / `BossPhaseBadge` | Cảnh báo + phase badge. |
| `BreakthroughBanner` | Banner đột phá thành công / thất bại. |
| `CraftingResultEffect` | Banner luyện đan / chế tạo / thức tỉnh. |
| `CombatFeedbackTimeline` / `CombatFeedbackEvent` | Log combat dạng dòng. |
| `EffectQueueHost` | Render generic queue (dùng cho damage popup). |
| `EffectSettingsPanel` | Form điều khiển `visualEffectLevel` + toggles. |
| `EffectPreviewPanel` | Sandbox đọc-only dùng tại `/dev/effects-preview`. |

Mọi component đều có:
- Prop `visualEffectLevel: VisualEffectMotionLevel`.
- Prop `reducedMotion: boolean`.
- `data-testid` ổn định.

## 6. Composable + adapters

**`apps/web/src/composables/useEffectQueue.ts`** — queue manager:
- `pushEffect(e)` → trả về id (hoặc `null` nếu motion filter chặn).
- Dedup theo `dedupeKey` + `dedupeCooldownMs` (sum stack).
- Clamp `maxVisible` (default 8) và `maxQueueSize` (default 64) — quá
  ngưỡng → drop entry priority thấp nhất, cũ nhất.
- Auto-dismiss qua `setTimeout` (cleanup khi unmount).
- Motion gating: `OFF` → reject, `LOW` → substitute fallback,
  `MEDIUM` → drop `LEGENDARY`/`IMMORTAL`.

**`apps/web/src/lib/visual-effect-adapters.ts`** — pure functions
map domain → presentation:
- `mapCombatDamageToVisualEvent`
- `mapDropToRareDropPopup`
- `mapItemToAuraProps`
- `mapBossEventToWarning`
- `mapBreakthroughResultToBanner`
- `mapCraftResultToEffect`

Pure, tolerant của `null/undefined`, không IO, không side-effect.

## 7. Player settings extension

`packages/shared/src/player-experience.ts` thêm vào `PlayerSettings`:
- `visualEffectLevel: VisualEffectLevel` (`OFF` | `LOW` | `MEDIUM` |
  `HIGH`) — default `MEDIUM`.
- 7 toggle boolean (default `true`): `showFloatingCombatText`,
  `showRareDropPopup`, `showBossWarning`, `showBreakthroughEffect`,
  `showCraftingEffect`, `showItemAura`, `showStatusEffectBar`.

Validator `validatePlayerSettings` kiểm tra enum + boolean.
Migration / API không cần thay đổi vì PlayerSettings được Phase 41 lưu
dạng JSON blob.

## 8. Settings UI

`SettingsView` render thêm `EffectSettingsPanel` (sau khi check
`reduceMotion`). Mỗi thay đổi gọi `patchPlayerSettings` qua API
Phase 41. Khi `visualEffectLevel = OFF` panel disable tất cả toggle.

## 9. Preview lab

Route `/dev/effects-preview` (`EffectsPreviewView` →
`EffectPreviewPanel`):
- Hiển thị từng section preview.
- Đọc settings hiện tại → cập nhật motion level realtime.
- Có nút "Play sample" để push thử vào queue.
- Read-only — không gọi bất kỳ API ghi nào.

## 10. i18n

`apps/web/src/i18n/{vi,en}.json` thêm namespace `visualEffects.*`
(level, reducedMotionHint, preview, rareDrop, boss, breakthrough,
crafting, status, accessibility) + bổ sung `playerSettings.fields.*`
cho 8 field mới.

## 11. Performance

- Mọi animation dùng CSS keyframe ngắn (<2.2s).
- Không render particle vô hạn.
- Queue manager clamp `maxVisible` + `maxQueueSize`.
- Cleanup `setTimeout` / event listener khi unmount.
- Không có file media lớn (chỉ CSS + ký tự / icon set sẵn có).

## 12. Test coverage

- 31 unit test shared (`visual-effects.test.ts`).
- 7+ FE component test (FloatingCombatText, StatusEffectBadge,
  ItemAuraFrame, RareDropPopup, BossWarningBanner, BreakthroughBanner,
  CraftingResultEffect, CombatFeedbackTimeline, EffectSettingsPanel,
  EffectPreviewPanel).
- 10 composable test (`useEffectQueue.test.ts`).
- 17 adapter test (`visual-effect-adapters.test.ts`).

## 13. Forbidden

Theo Phase 42 spec section 26, KHÔNG:
- sửa combat formula, drop rate, balance, boss AI, PvP, story quest.
- tạo item / boss / skill / đan / pháp bảo mới.
- effect cộng chỉ số.
- bán effect P2W.
- thêm animation 3D / file media lớn.
- tắt tests hoặc rewrite UI hiện có.
