# XT Celestial Jade Theme Guide

## Palette

| Token | Hex | Usage |
|---|---:|---|
| White Jade | `#F7FBF8` | page background |
| Pale Jade | `#CDEFE3` | active nav, primary buttons, soft surfaces |
| Mist Blue | `#DCECF5` | secondary activity/accent areas |
| Smoke Lam | `#8FB3C9` | muted blue borders/icons |
| Soft Gold | `#D8B76A` | premium highlights, active borders, key CTAs |
| Ink Green | `#244C45` | primary body text |
| Deep Jade Text | `#183C36` | headings and high contrast text |
| Warm Paper | `#FFF8EA` | inventory/market/paper panels |
| Palace Cream | `#F8F1DF` | gold-tinted surfaces |

## Functional variants

- Dashboard/Home: white jade + pale jade + light gold.
- Character/Cultivation: white jade + jade + mist blue.
- Missions/Combat/Farm: moss/jade + paper cream.
- Boss/Combat: pale red + bronze gold + smoke purple, bright but not harsh.
- Secret Realms/Tower: mist blue + smoke purple + silver jade.
- Inventory/Equipment/Artifacts: paper cream + gold + pale jade.
- Alchemy/Crafting: herb green + paper cream + furnace gold.
- Pets/Companions: forest jade + warm gold + cloud white.
- Sect/Social: dark jade text + gold + palace white + mist blue.
- Market/Trading: gold + paper cream + pale jade.
- Events/Seasons: seasonal banners over white jade.
- Admin: white/gray jade + steel blue + warning gold.

## Component rules

- Cards use translucent white/jade surfaces, thin jade/gold borders, rounded corners, and soft shadows.
- Primary buttons use jade gradients; important actions use gold; ghost actions use white with jade border.
- Disabled states must be visibly muted and not look clickable.
- Ambient qi/mist/rune effects must be CSS-only and must not obscure text.
- Respect `reducedMotion=true`, `visualEffectLevel=OFF`, and `prefers-reduced-motion`.

## Typography rules

- Headings: `font-black`/700–900, ink green, subtle tracking.
- Body: readable ink green or muted jade; avoid gray-on-gray and dark-on-dark.
- Labels must be Vietnamese; never display raw enums/keys to players.
