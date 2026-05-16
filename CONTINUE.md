# CONTINUE — Cửu Thiên Mộng luxury UI roadmap (PR #615)

Branch: `devin/20260516-091257-cuu-thien-mong-lux-ui-complete`
PR: https://github.com/hoathienmenh-01/xuantoi/pull/615
Base: `main` của `hoathienmenh-01/xuantoi`.

Tiếp nối PR #613 (Thuần Việt foundation) + PR #614 (Luxury primitives + 12 top-tier view).
PR #615 hoàn thiện đầy đủ 11 phase của roadmap luxury UI.

---

## TỔNG QUAN

PR #615 = 9 commit theo đúng thứ tự phase, không tạo branch mới, không tách PR. Mỗi phase chạy lint / typecheck / test / han-gate trước khi commit.

Han gate cuối: `rg '[\x{4e00}-\x{9fff}]' apps/web/src` → 0 match.

---

## PHASE LOG

### Phase 1 — Audit primitives (no code)
Audit `apps/web/src/components/xianxia/*` cho hiện trạng 12 view top-tier đã polish ở PR #614. Output: danh sách view còn dùng layout cũ (~40 view: Combat / Social / Quest / Misc / Admin), card thiếu corner accent, stat tile rời rạc, transition không nhất quán.

### Phase 2 — `XTLuxHero` cho ~40 view
Commit `feat(web): expand XTLuxHero across remaining player views`. Phổ cập `<XTLuxHero>` (eyebrow + title + subtitle + actions) cho toàn bộ view còn dùng layout cũ. Giữ test id cũ, không đụng business logic.

### Phase 3 — `XTStatTile` + `XTLuxSection`
Commit `feat(web): adopt luxury stat tiles and sections`. Dashboard / Profile / Sect / Wallet chuyển từ raw grid sang `<XTLuxSection>` (ornate corner) + `<XTStatTile>` (jade/gold tone, glyph slot, delta animation hook).

### Phase 4 — `XianxiaCard` upgrade
Commit `feat(web): add luxury treatment to cards and item states`. Thêm 4 corner accent SVG + props `accent` (jade/gold/seal/danger), `corners` (boolean, default true), `tight` (giảm padding cho list item). Alias `seal` ↔ `danger` để tương thích.

### Phase 5 — State primitives polish
Commit `feat(web): polish loading empty error and toast states`. `SkeletonBlock` (shimmer + tone variant), `EmptyState` (glyph + tone), `ErrorState` (ornate seal frame), `MToast` (luxury restyle gold/jade/seal/warning + glyph + `aria-live`). Test cũ rewrite assertion → verify tone class mới, KHÔNG xoá / skip case.

### Phase 6 — Page transitions & micro animations
Commit `feat(web): add global luxury transitions and micro animations`. Tổng quát silk-curtain (tham khảo BossView) → global app transition; `XTListStagger` cho list appear (fade + slight Y translate, prefers-reduced-motion aware); `XTCounter` + composable `useCountUp` cho EXP / currency / power delta. Hover-lift card chuẩn hoá. Không thêm dependency.

### Phase 7 — `GameIcon` library expansion
Commit `feat(web): expand xianxia game icon library`. Mở rộng `GameIcon` từ ~20 lên đầy đủ icon cho cultivation / combat / pvp / boss / dungeon / sect / market / mail / social / quest / achievement / codex / mentor / encounter / farm / wallet / shop / gift / title / notification / feedback / admin. `RealmBadge` thêm sigil theo cảnh giới group. Tất cả inline SVG, không thêm icon library lớn.

### Phase 8 — `XTBottomSheet` + sect accent
Commit `feat(web): add ornate bottom sheet and sect accent theming`. Primitive `XTBottomSheet` (ornate top handle + overlay + close button accessible + Escape close + mobile-first; desktop fallback dùng tự nhiên qua viewport). Áp dụng nhẹ ở Inventory filter/sort. Thêm CSS var `--xt-accent-sect` — nếu `sect.color` có thì tint subtle border / tiny glow / badge, KHÔNG tint background lớn, KHÔNG đổi store shape.

### Phase 9 — Typography, day audit, i18n, a11y
Commit `feat(web): improve typography day theme i18n and accessibility`.
- Typography: thêm utility token `text-display-xl / text-display-md / text-body-sm`, giảm `text-2xl font-bold tracking-widest` rải rác, fix line-height ratio.
- Day theme audit: mở rộng `[data-theme="day"]` block cho depth shadow / mesh gradient / ambient canvas overlay / luxury card bg / section glow. Contrast text AA.
- i18n: hardcoded VN strings từ phase 2–5 migrate vào `i18n/vi.ts` (`SectView` mine badge, MonetizationShopView labels, WalletView toasts…). Bổ sung 2 view thiếu `useI18n()` setup.
- A11y: ARIA label cho `XTLuxHero` / `XTOrnateButton` / `XTGlyphBadge` / `XTBottomSheet` / Toast, focus ring, Escape close cho bottom sheet, `prefers-reduced-motion`.

### Phase 10 — Special FX, gestures, performance
Commit `feat(web): add special effects gestures and performance polish`.
- FX hiện hữu (đã có từ PR #614) giữ nguyên: `BreakthroughBanner` particle shower theo realm, `RareDropPopup` viền theo phẩm chất + sigil, `FloatingCombatText` typeface cổ phong, `CombatFeedbackTimeline` critical hit shockwave (đã có `prefers-reduced-motion` fallback). Phase 10 KHÔNG ghi đè FX backend bằng FX mới — đã đủ.
- Mobile gesture: thêm `XTPullRefresh` primitive (touch event, threshold 72px configurable, rubber-banding `dy*0.55`, ornate seal halo spinner, prefers-reduced-motion aware, expose `trigger()`). KHÔNG wrap route con bằng swipe-back vì rủi ro route lớn (theo brief). Long-press menu BỎ QUA vì không có primitive context menu phù hợp & rủi ro vỡ click handler hiện hữu.
- Performance: `XTAmbientCanvas` thêm FPS measurement qua `requestAnimationFrame` (sample 60 frame hoặc 2s, lấy avg) + low-end heuristic (`navigator.deviceMemory ≤ 2GB` hoặc `hardwareConcurrency ≤ 2`) → tự động set `data-quality="reduced"` → dim mesh, dim halo, ẩn motes, dừng animation. Skip đo FPS khi `prefers-reduced-motion: reduce`. Prop `forceQuality?: 'auto' | 'full' | 'reduced'` để override.
- Route-level lazy load: kiểm 80+ route trong `apps/web/src/router/index.ts` — toàn bộ đã dùng `() => import(...)` từ trước, không có view nào cần convert. KHÔNG đụng route names / guards.

### Phase 11 — Final docs + gates + PR finalize (commit này)
Commit `docs(web): update Cửu Thiên Mộng luxury UI completion report`. Update `CONTINUE.md` + `docs/AI_HANDOFF_REPORT.md` với log đầy đủ. Chạy gate cuối (han / lint / typecheck / test / build), đổi PR title thành `feat(web): complete Cửu Thiên Mộng luxury UI roadmap` và flip draft → ready for review.

---

## NHỮNG THỨ BỎ QUA VÌ RỦI RO (ghi rõ theo brief)

1. **Swipe-back trên route con** (Phase 10.B): bỏ qua. Vue Router không có gesture primitive tự nhiên, viết tay rủi ro xung đột với scroll vertical + history stack. Brief cho phép bỏ qua nếu rủi ro.
2. **Long-press card → context menu** (Phase 10.B): bỏ qua. App chưa có context menu primitive thống nhất; cài long-press dễ vỡ click handler cũ ở Inventory/Market. Brief cho phép bỏ qua.
3. **Breakthrough / RareDrop / Crit FX riêng cho Phase 10.A**: không tạo mới. PR #614 đã ship `BreakthroughBanner`, `RareDropPopup`, `FloatingCombatText`, `CombatFeedbackTimeline` đầy đủ với particle shower / rarity border / shockwave / prefers-reduced-motion fallback. Tạo thêm sẽ trùng lặp.
4. **Sect war banner full-screen**: `SectWarView` đã có announcement đúng thuần Việt từ phase 2 (`XTLuxHero` adopt) — không tạo overlay riêng vì không có trigger event mới ở web, sẽ là FX không bao giờ chạy. Khi backend phát event sect war thực thì wrap bằng `XTLuxSection` + ambient canvas có sẵn.
5. **EXP gain particle bay vào stat**: fallback floating particle đã có trong `XTCounter` (delta animation). Không thêm tracker DOM target vì rủi ro vỡ layout responsive.

Tất cả các bỏ qua đều ghi vì rủi ro, không vì lười, và không đụng business logic / backend / Prisma / shared catalog / auth / market / quest / admin guard / monetization / socket.

---

## GATE CUỐI

```
rg '[\x{4e00}-\x{9fff}]' apps/web/src   # 0 match
pnpm -C apps/web lint                    # pass (max-warnings 0)
pnpm -C apps/web typecheck                # pass
pnpm -C apps/web test                     # 230 file / 2469 test pass
pnpm -C apps/web build                    # pass (xem log phase 11)
```

---

## NHỚ KHI CONTINUE

- KHÔNG tạo branch mới, KHÔNG tách PR. Tiếp tục push vào branch hiện hành nếu cần fix CI.
- KHÔNG đụng backend, Prisma, shared catalog, business logic gameplay, auth, market, quest, admin guard, monetization, socket.
- KHÔNG dùng chữ Hán trong `apps/web/src`. Han gate phải pass.
- KHÔNG xoá `data-testid`. KHÔNG disable test. KHÔNG xoá test để pass.
- Mỗi commit chạy gate trước.
