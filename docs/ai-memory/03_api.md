# API Memory

> **Last updated:** 2026-05-27

## Role
`apps/api/` — NestJS backend for Xuân Tôi game. Server-authoritative gameplay.

## Stack
- **Framework:** NestJS
- **Database:** Prisma + Postgres 16
- **Cache:** Redis 7
- **Queue:** BullMQ
- **WebSocket:** Socket.io
- **Auth:** JWT (cookie-based)
- **Logging:** Pino (via @xuantoi/logger package)

## Common commands
```bash
pnpm --filter @xuantoi/api test                    # Vitest (needs Postgres + Redis)
pnpm --filter @xuantoi/api build                   # nest build
pnpm --filter @xuantoi/api prisma:migrate          # run migrations
pnpm --filter @xuantoi/api bootstrap               # seed admin + 3 sects
```

## Key patterns
- **Modules:** Domain-driven modules (auth, character, cultivation, combat, economy, etc.)
- **Services:** Business logic layer
- **Controllers:** REST endpoints + WebSocket gateways
- **Guards:** Auth guards, admin guards, permission guards
- **Prisma:** ORM for database access
- **BullMQ:** Background jobs (cultivation ticks, boss spawns, etc.)

## Guardrails
- **Admin endpoints** need `@RequireAdmin()` + `@RequireAdminPermission(...)` guards.
- **Service boundaries** matter — use dependency injection properly.
- **Do not change Prisma schema** without explicit task — all schema changes MUST be additive.
- **Economy mutations** must go through `CurrencyService`/`ItemService` + ledger row (see `05_economy_ledger.md`).
- **Run API tests** when touching services/controllers.

## Known issues
- API build has 1228 pre-existing Prisma type errors (documented, separate fix needed).
- These errors are NOT related to recent logger package changes.

## Source docs
- `CLAUDE.md` — quality gates
- `docs/TASK_CONTEXT_MAP.md` — when to read API docs
- `docs/API.md` — REST + WS endpoint reference (225k chars — use `rg` to find sections)
