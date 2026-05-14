# XT Modern Xianxia UI Guide

## Scope

UI-1.4 keeps the XT shell usable and route-first while moving the visual system to **Celestial Jade Palace**: light jade, paper cream, mist blue, smoke lam, soft gold, and ink green. This PR intentionally touches only web UI/routing/docs/tests; no gameplay, combat, economy, or backend behavior changes.

## Route mapping

See [`FRONTEND_ROUTE_MAPPING.md`](./FRONTEND_ROUTE_MAPPING.md) for the full route table. Navigation rules:

- Every sidebar/dashboard/menu action must route to a real page, a redirect alias, or a safe placeholder.
- Placeholders use `XianxiaPlaceholderView.vue` with “Chức năng đang được phát triển” and a “Quay lại Dashboard” CTA.
- Back fallback is `/dashboard` when browser history is absent.

## Components

Shared UI lives under `apps/web/src/components/xianxia/`:

- `GameIcon.vue` — compact icon mapping with fallback dot; includes dashboard, cultivation, pet, realm, boss, market, notification, resources, etc.
- `SpiritualAmbientLayer.vue` — CSS-only qi particles/mist/cloud-like ambient layer.
- `XianxiaBackButton.vue` — `router.back()` or `/dashboard` fallback.
- `XianxiaCard.vue`, `XianxiaButton.vue`, `ResourceChip.vue`, `RealmBadge.vue`, `ProgressRuneBar.vue`, `StatCard.vue`.
- Dashboard sections: `CultivationHeroCard.vue`, `TodayChecklistCard.vue`, `QuickActionGrid.vue`.

## Theme tokens

`apps/web/src/design/tokens.css` defines Celestial Jade tokens:

- Base: `--xt-bg-primary #F7FBF8`, `--xt-bg-paper #FFF8EA`, `--xt-bg-palace #F8F1DF`.
- Accents: jade `#CDEFE3`, mist blue `#DCECF5`, smoke lam `#8FB3C9`, gold `#D8B76A`.
- Text: ink green `#183C36` / muted `#5F7F78`.
- Utility classes in `apps/web/src/style.css`: `.xt-page-gradient`, `.xt-card`, `.xt-button`, resource chip tones, rune circle.

## Typography and labels

- Prefer Vietnamese UI labels. Do not show raw route/enum keys such as `pets`, `luyenkhi 1`, or `pham_than 1`.
- Use helpers in `apps/web/src/lib/xianxiaFormat.ts`:
  - `formatRealmName('luyenkhi', 1)` → `Luyện Khí · Tầng 1`
  - `formatFeatureLabel('pets')` → `Linh Thú`
  - `formatNumberCompact(12345)` → compact vi-VN output
- `dashboard.title` is “Thiên Cung Tổng Quan”.

## Animation and reduced-motion rules

Effects are CSS/Tailwind only: no canvas, no WebGL, no heavy images. `SpiritualAmbientLayer` renders particles only when `reducedMotion=false` and `visualEffectLevel !== 'OFF'`; CSS also disables motion under `prefers-reduced-motion: reduce` and `.reduced-motion`.

## Open/exit/back mechanics

- Mobile sidebar opens with `shell-mobile-toggle`, closes by backdrop, Escape, route change, or explicit close button labeled “Thoát menu”.
- Dashboard quick actions/checklist/right-panel cards call `router.push(route)`.
- Resource chips remain readable and non-wrapping; content uses `min-w-0` and responsive grids to avoid horizontal overflow.
