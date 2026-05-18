# CLAUDE.md — Xuân Tôi (slim)

> Game tu tiên MUD. Monorepo pnpm. Full reference: `docs/ai/CLAUDE_FULL_REFERENCE.md`

## Stack

| Layer | Tech |
|---|---|
| Frontend | `apps/web` — Vue 3 + Vite + Pinia + TailwindCSS + vue-i18n (VI/EN) + Sentry + PWA |
| Backend | `apps/api` — NestJS + Prisma (Postgres 16) + Redis 7 + BullMQ + Socket.io + JWT (cookie) |
| Shared | `packages/shared` — Pure TS catalog/balance/types. Build first: `pnpm --filter @xuantoi/shared build` |

Node >= 20, pnpm >= 9 (pinned 9.15.1).

## Hard Rules

- **NEVER push to `main`** — feature branches + PRs only.
- **NEVER commit secrets** — `.env` gitignored, `.env.example` committed.
- **Run quality gates before every commit** (see below).
- **No Chinese characters** `[一-鿿]` in `apps/web/src` — enforced by Han gate.
- **All schema changes MUST be additive** — no field deletion, only deprecation.
- **Admin guard**: `@RequireAdmin()` + `@RequireAdminPermission(...)` on all admin endpoints.

## Economy Invariants (CRITICAL)

- All currency/item mutations go through `CurrencyService`/`ItemService` + ledger row.
- Reward sources have idempotency key `(characterId, sourceType, sourceKey)` UNIQUE.
- Admin CANNOT mint Tiên Ngọc via bypass.
- Violating invariants = data corruption. See `docs/ECONOMY_MODEL.md`.

## Quality Gates

Run BEFORE every commit:

```bash
pnpm --filter @xuantoi/shared build    # shared MUST build first
pnpm typecheck                          # all workspaces
pnpm lint                               # eslint all
pnpm build                              # all workspaces
```

Tests (when touching that workspace):

```bash
pnpm --filter @xuantoi/api test        # needs Postgres + Redis
pnpm --filter @xuantoi/web test        # Vitest + happy-dom
pnpm --filter @xuantoi/shared test
```

## Commands

```bash
pnpm install                            # install deps
pnpm infra:up                           # Docker: Postgres, Redis, MinIO, MailHog
pnpm dev                                # web + api parallel
pnpm --filter @xuantoi/api prisma:migrate
pnpm --filter @xuantoi/api bootstrap    # seed admin + 3 sects
```

## Branch & PR Workflow

1. Create feature branch from `main` (`feat/xxx`, `fix/xxx`).
2. Push branch early, commit incrementally.
3. One PR per feature/module.
4. Update `docs/AI_HANDOFF_REPORT.md` in every PR.
5. PR requires: typecheck clean, lint 0 warnings, tests pass, Han gate = 0.

## i18n

- All user-facing strings in `vi.json` + `en.json` parity.
- No Chinese characters in `apps/web/src`.

## Deferred Features (DO NOT BUILD)

Real-time PvP, Pet gacha, Voice chat, Mobile native app, NFT/blockchain, Real-money trade, Multi-region sharding.

## Docs Index

| Need | Read |
|---|---|
| Full reference | `docs/ai/CLAUDE_FULL_REFERENCE.md` |
| Delivery rules | `docs/AI_WORKFLOW_RULES.md` |
| Current state | `docs/AI_HANDOFF_REPORT.md` |
| Roadmap | `docs/LONG_TERM_ROADMAP.md` |
| Economy | `docs/ECONOMY_MODEL.md` |
| Balance | `docs/BALANCE_MODEL.md` |
| Deploy | `docs/DEPLOY.md` |
| Troubleshooting | `docs/TROUBLESHOOTING.md` |

## Common Issues

| Issue | Fix |
|---|---|
| `Cannot find module @xuantoi/shared` | `pnpm --filter @xuantoi/shared build` |
| Postgres/Redis refused | `pnpm infra:up`, check `docker ps` |
| Test timeout | Kill other API/test processes |
| Login 401 after role change | Logout + login again |
