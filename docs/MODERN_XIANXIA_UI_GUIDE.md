# XT Premium Modern Xianxia UI Guide

## Scope

UI-1 refreshes the web interface into a usable modern xianxia shell. The primary product name in the UI is **XT** and the shell subtitle is **Tu Tiên Lộ**.

## Route mapping

- Core: `/home`, `/dashboard`, `/character` (safe placeholder).
- Cultivation: `/cultivation` (safe placeholder), `/breakthrough`, `/body-cultivation`, `/cultivation-method`, `/spiritual-root`, `/skill-book`, `/alchemy`.
- Activities: `/inventory`, `/equipment` → `/inventory`, `/pets`, `/secret-realms` → `/secret-realm`, `/dungeon-run`, `/roguelike-realms` → `/roguelike`, `/tower` → `/world/towers`, `/boss`, `/missions`.
- Social: `/sect`, `/market`, `/auction` → `/market`, `/events`, `/achievements`, `/mail`, `/social`, `/leaderboard`.
- System: `/settings`, `/notification-settings`, `/activity`, `/giftcode`, `/topup`, `/support/feedback`, `/support/report-player`, `/admin` for staff.

No dead buttons are intentionally left in the shell/dashboard. If a function does not yet have a polished view, route through a safe placeholder or redirect to the closest existing feature.

## Components

New shared UI lives under `apps/web/src/components/xianxia/`:

- `GameIcon.vue` — compact icon mapping with fallback dot.
- `SpiritualAmbientLayer.vue` — CSS-only qi particles/mist layer.
- `XianxiaBackButton.vue` — back action with `/home` fallback when browser history is absent.
- `XianxiaCard.vue`, `XianxiaButton.vue`, `ResourceChip.vue`, `RealmBadge.vue`, `ProgressRuneBar.vue`, `StatCard.vue`.
- Dashboard sections: `CultivationHeroCard.vue`, `TodayChecklistCard.vue`, `QuickActionGrid.vue`.

## Theme tokens

`apps/web/src/design/tokens.css` defines XT dark surface/accent tokens:

- Background: deep navy `--xt-bg-primary` and glass surfaces.
- Accents: jade, cyan, violet, warm gold, boss danger.
- Global CSS utilities in `apps/web/src/style.css`: `.xt-card`, `.xt-button`, resource chip tones, rune circle.

Tailwind still uses the existing `ink` palette and `font-co` serif stack; the new tokens extend visual treatment without replacing gameplay logic.

## Animation and reduce-motion rules

Effects are CSS/Tailwind only: no canvas, no WebGL, no heavy images. `SpiritualAmbientLayer` renders particles only when `reducedMotion=false` and `visualEffectLevel !== 'OFF'`; CSS also disables motion under `prefers-reduced-motion: reduce` and `.reduced-motion`.

## Open/exit/back mechanics

- Mobile sidebar opens with `shell-mobile-toggle`, closes by backdrop, Escape, route change, or explicit close button labeled “Thoát menu”.
- `XianxiaBackButton` calls `router.back()` when history exists; otherwise it pushes `/home`.
- Dashboard cards and checklist buttons call `router.push(route)`.

## Done in UI-1

- XT branding applied in VI/EN i18n.
- Premium AppShell with grouped navigation, active route highlight, mobile drawer, topbar resources, and chat dock.
- Dashboard hero/stat/checklist/quick-action/right-panel refresh.
- Safe route placeholders/redirect aliases for missing navigation targets.
- Focused component/render tests.

## Follow-up polish

Inventory, Pet, SecretRealm, Market/Auction, and dedicated Character/Cultivation pages can receive deeper per-view polish in follow-up PRs. UI-1 intentionally avoids gameplay/backend rewrites.
