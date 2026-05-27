# Shared Contracts Memory

> **Last updated:** 2026-05-27

## Role
`packages/shared/` — Pure TS catalog/balance/types/contracts shared between web and api.

## Stack
- **Pure TypeScript** — no runtime dependencies
- **Build:** tsup (dual ESM/CJS)
- **Exports:** Catalog data, balance formulas, type definitions, validators

## Common commands
```bash
pnpm --filter @xuantoi/shared build    # MUST build first before web/api
pnpm --filter @xuantoi/shared test     # Vitest unit tests
```

## Key patterns
- **Catalog files:** Items, skills, monsters, bosses, dungeons, missions, quests, NPCs, etc.
- **Balance files:** Formulas, curves, stat budgets, drop weights, reward caps
- **Type definitions:** Shared interfaces, enums, constants
- **Validators:** Zod schemas, integrity checks, audit functions

## Guardrails
- **Shared changes affect both web and api** — run both workspace tests when touching shared.
- **Build shared first** — `pnpm --filter @xuantoi/shared build` before building web/api.
- **Check imports/contracts carefully** — breaking changes cascade to both frontends.
- **Catalog changes** should follow `docs/CONTENT_PIPELINE.md` process.
- **Balance changes** should follow `docs/BALANCE_MODEL.md` guidelines.

## Common catalog files
- `src/items.ts` — item catalog
- `src/combat.ts` — skills, monsters, combat formulas
- `src/missions.ts` — mission catalog
- `src/boss.ts` — boss catalog
- `src/farm-maps.ts` — farm map catalog
- `src/world-dungeons-v2.ts` — dungeon catalog
- `src/npcs.ts` — NPC catalog
- `src/story-*.ts` — story/quest catalogs

## Source docs
- `CLAUDE.md` — quality gates
- `docs/CONTENT_PIPELINE.md` — content addition process (33k chars)
- `docs/BALANCE_MODEL.md` — balance formulas (242k chars — use `rg` to find sections)
