# Architecture Memory

> **Last updated:** 2026-05-27

## Repo structure
- `apps/web/` — Vue 3 frontend (Vite + Pinia + TailwindCSS + vue-i18n VI/EN + Sentry + PWA)
- `apps/api/` — NestJS backend (Prisma + Postgres 16 + Redis 7 + BullMQ + Socket.io + JWT cookie)
- `packages/shared/` — Pure TS catalog/balance/types/contracts (build first: `pnpm --filter @xuantoi/shared build`)
- `packages/logger/` — Unified logging package (Pino backend, Console frontend)
- `docs/` — Handoff, specs, workflow, design docs
- `scripts/` — Automation/smoke/check scripts
- `infra/` — Docker compose for local dev (Postgres, Redis, MinIO, MailHog, Loki, Grafana, Promtail)

## Stack
- **Node:** >= 20
- **pnpm:** >= 9 (pinned 9.15.1)
- **Frontend:** Vue 3 + Vite + Pinia + TailwindCSS + vue-i18n (VI/EN) + Sentry + PWA
- **Backend:** NestJS + Prisma (Postgres 16) + Redis 7 + BullMQ + Socket.io + JWT (cookie)
- **Shared:** Pure TS catalog/balance/types
- **Logging:** Pino (backend), Console (frontend), Loki + Grafana (aggregation)

## Key boundaries
- **Shared contracts should remain stable** — changes affect both web and api.
- **Backend is server-authoritative** — all gameplay/economy mutations happen server-side.
- **Frontend uses shared types** — import from `@xuantoi/shared` where appropriate.
- **Avoid schema/economy changes** unless task requires — see `05_economy_ledger.md`.
- **All schema changes MUST be additive** — no field deletion, only deprecation.

## Build order
1. `pnpm --filter @xuantoi/shared build` — MUST build first
2. `pnpm typecheck` — all workspaces
3. `pnpm lint` — eslint all
4. `pnpm build` — all workspaces

## Source docs
- `CLAUDE.md` — hard rules + quality gates
- `docs/04_TECH_STACK_VA_DATA_MODEL.md` — historical blueprint (Phase 0-8 historical, §P9 long-term)
- `docs/ARCHIVE_HANDOFF.md` — full tech stack reference in archive
