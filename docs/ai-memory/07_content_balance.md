# Content & Balance Memory

> **Last updated:** 2026-05-27

## Scope
Items, skills, missions, monsters, bosses, rewards, realms, balance tables.

## Content Types
- **Items** — equipment, pills, materials, artifacts, skill books
- **Skills** — combat skills, passive skills, cultivation methods
- **Missions** — daily missions (65+), weekly missions, event missions
- **Monsters** — farm monsters, dungeon monsters, elite monsters
- **Bosses** — region bosses, world bosses, sect bosses, event bosses
- **Dungeons** — story dungeons, world dungeons, sect dungeons, trial towers
- **Quests** — main quests, side quests, hidden quests, daily/weekly quests
- **NPCs** — story NPCs, shop NPCs, quest givers
- **Realms** — 28 cultivation realms (Luyện Khí → Hư Không Chí Tôn)

## Balance Concepts
- **Stat budgets** — power budget per realm tier
- **Drop weights** — loot table probabilities
- **Reward caps** — daily/weekly/event caps per content type
- **Curves** — EXP curves, power curves, cost curves
- **Dials** — tunable parameters (drop rates, costs, rewards)

## Guardrails
- **Keep seeds/catalogs consistent.**
- **Test shared catalog changes** — run `pnpm --filter @xuantoi/shared test`.
- **Do not invent new progression unless task requires.**
- **Follow content pipeline** — see `docs/CONTENT_PIPELINE.md` for process.
- **Document balance changes** — update decision log in `docs/BALANCE_MODEL.md`.

## Common Catalog Files
- `packages/shared/src/items.ts` — item catalog
- `packages/shared/src/combat.ts` — skills + monsters
- `packages/shared/src/missions.ts` — mission catalog (65+ missions)
- `packages/shared/src/boss.ts` — boss catalog
- `packages/shared/src/farm-maps.ts` — farm map catalog (27 maps, 9 regions)
- `packages/shared/src/world-dungeons-v2.ts` — dungeon catalog
- `packages/shared/src/story-quest-expansion.ts` — quest catalog (209 quests)

## Recent Content Additions
- 2026-05-20: Farm map expansion (12 new maps for Khu 4-9)
- 2026-05-20: Cửu La Điện monsters (4 Hoá Thần-tier monsters)
- Phase 33: Story quest expansion Quyển II-IV (19 chapters, 209 quests)

## Source docs
- `docs/CONTENT_PIPELINE.md` — content addition process (33k chars)
- `docs/BALANCE_MODEL.md` — balance formulas (242k chars — use `rg` to find sections)
- `docs/story/TU_TIEN_LO_STORY_BIBLE.md` — story design source
