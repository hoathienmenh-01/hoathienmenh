# Gameplay Systems Memory

> **Last updated:** 2026-05-27

## Scope
Cultivation, combat, missions, sect, boss, skills, items, maps, progression.

## Core Systems
- **Cultivation** — realm progression, breakthrough, tribulation, spiritual root
- **Combat** — turn-based combat, skills, monsters, bosses, dungeons
- **Missions** — daily/weekly missions, quest chains, story quests
- **Sect** — sect membership, roles (LEADER/ELDER/MEMBER), contribution, sect boss, sect war
- **Boss** — world bosses, region bosses, sect bosses, event bosses
- **Skills** — skill learning, skill book drops, skill upgrades
- **Items** — equipment, pills, materials, artifacts
- **Maps** — farm maps, dungeons, regions, trial towers
- **Progression** — realm tiers, level caps, stat budgets

## Key Patterns
- **Server-authoritative** — all gameplay mutations happen server-side.
- **Idempotent rewards** — use `(characterId, sourceType, sourceKey)` UNIQUE.
- **Daily/weekly caps** — use `RewardCapService` or `DailyContentCap`/`WeeklyContentCap` models.
- **Atomic transactions** — use Prisma `$transaction` for multi-step operations.
- **Catalog-driven** — most content defined in `packages/shared/src/*.ts` catalogs.

## Guardrails
- **Do not change balance formulas without task.**
- **Use shared constants/catalogs when possible.**
- **Update tests and docs when gameplay contracts change.**
- **Respect realm gates** — content should be gated by `requiredRealmOrder`.
- **Respect daily/weekly caps** — do not bypass cap enforcement.

## Common Services
- `CultivationService` — cultivation ticks, breakthrough, tribulation
- `CombatService` — combat resolution, monster encounters
- `MissionService` — mission tracking, claim rewards
- `SectService` — sect management, roles, contribution
- `BossService` — boss spawns, attacks, rewards
- `DungeonRunService` — dungeon runs, loot
- `QuestService` — quest progression, story flags

## Source docs
- `docs/GAME_DESIGN_BIBLE.md` — vision + core loop + 13 systems
- `docs/GAMEPLAY_FOLLOWUP_INTEGRATION.md` — integration patterns
- `docs/story/PHASE12_STORY_PROGRESS.md` — story progress tracker
