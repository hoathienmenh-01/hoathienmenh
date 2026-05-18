# CLAUDE.md — Xuân Tôi

> Game tu tiên MUD cổ phong (clone Mộng Tu Tiên). Monorepo pnpm.

---

## Stack

| Layer | Tech |
|---|---|
| **Frontend** | `apps/web` — Vue 3 + Vite + Pinia + TailwindCSS + Socket.io-client + vue-i18n (VI/EN) + Sentry + PWA (Workbox) |
| **Backend** | `apps/api` — NestJS + Prisma (Postgres 16) + Redis 7 + BullMQ + Socket.io + Argon2 + JWT (cookie) + Pino + Sentry |
| **Shared** | `packages/shared` — Pure TS catalog/balance/types (tsup, ESM+CJS). Consumed via `@xuantoi/shared` workspace. |
| **Infra** | `infra/docker-compose.dev.yml` — Postgres, Redis, MinIO (S3), MailHog |

Node >= 20, pnpm >= 9 (pinned 9.15.1).

---

## Commands

### Setup

```bash
pnpm install                                  # install deps
pnpm infra:up                                 # start Docker: Postgres:5432, Redis:6379, MinIO:9000/9001, MailHog:1025/8025
cp apps/api/.env.example apps/api/.env        # create env files
cp apps/web/.env.example apps/web/.env
pnpm --filter @xuantoi/api prisma:generate    # generate Prisma client
pnpm --filter @xuantoi/api prisma:migrate     # run migrations
pnpm --filter @xuantoi/api bootstrap          # seed admin + 3 sects
```

### Dev

```bash
pnpm dev                                      # run web + api in parallel
pnpm --filter @xuantoi/api dev                # api only (Nest watch mode)
pnpm --filter @xuantoi/web dev                # web only (Vite HMR)
pnpm --filter @xuantoi/shared dev             # shared watch mode
```

### Quality gates (run BEFORE every commit)

```bash
pnpm --filter @xuantoi/shared build           # shared MUST build first
pnpm typecheck                                # all workspaces
pnpm lint                                     # eslint all
pnpm --filter @xuantoi/api test               # API tests (needs Postgres + Redis)
pnpm --filter @xuantoi/web test               # Web tests (Vitest + happy-dom)
pnpm --filter @xuantoi/shared test            # Shared tests
pnpm build                                    # all workspaces
pnpm test:balance                             # fast balance dial check (~2s)
```

### Smoke tests (after `pnpm dev` is running)

```bash
pnpm smoke:all                                # run all smoke tests
pnpm smoke:beta                               # gameplay flow (~2min)
pnpm smoke:economy                            # ledger/reward safety (~5min)
pnpm smoke:ws                                 # WebSocket (~30s)
pnpm smoke:combat                             # combat e2e (~1min)
pnpm smoke:admin                              # admin RBAC (~2min)
```

### DB management

```bash
pnpm --filter @xuantoi/api exec prisma studio         # visual DB browser
pnpm --filter @xuantoi/api exec prisma migrate reset   # reset DB (dev only!)
pnpm --filter @xuantoi/api bootstrap                   # re-seed admin + sects
pnpm backup:db                                          # backup Postgres
```

---

## Rules

### NEVER push to `main`

All work goes through feature branches + PRs. `main` is protected.

### NEVER commit secrets

- `.env`, `.env.local`, `*.local` are gitignored.
- `.env.example` files are committed (no real secrets).
- Never hardcode JWT secrets, passwords, or API keys.
- Backup dumps (`backups/*.sql.gz`) contain real data — never commit.

### Run quality gates before committing

```
shared build → typecheck → lint → test → build
```

At minimum: `pnpm --filter @xuantoi/shared build && pnpm typecheck && pnpm lint && pnpm build`.

### Branch & PR workflow

1. Create feature branch from `main` (e.g. `feat/xxx`, `fix/xxx`, `docs/xxx`).
2. Commit incrementally — don't hold code locally.
3. Push branch to GitHub before writing code (per project convention).
4. One PR per feature/module — don't split a UI view into micro-PRs (see `docs/AI_WORKFLOW_RULES.md` UI Module Rule).
5. Update `docs/AI_HANDOFF_REPORT.md` in every PR.
6. PR requires: typecheck clean, lint 0 warnings, tests pass, Han gate `[一-鿿]` = 0 matches in `apps/web/src`.

### Economy invariants (CRITICAL)

- All currency mutations go through `CurrencyService` + ledger row.
- All item mutations go through `ItemService` + ledger row.
- All reward sources have idempotency key `(characterId, sourceType, sourceKey)` UNIQUE.
- Admin CANNOT mint Tiên Ngọc via bypass.
- See `docs/ECONOMY_MODEL.md` — violating invariants = data corruption.

### i18n

- All user-facing strings in `vi.json` + `en.json` parity.
- No Chinese characters (`[一-鿿]`) in `apps/web/src` — enforced by Han gate.

### Admin guard

- All admin endpoints use `@RequireAdmin()` or `@RequireAdminPermission(...)`.
- FE double-guards: non-admin sees forbidden state, request doesn't fire.
- MOD !== ADMIN for sensitive endpoints.

---

## Architecture

### API modules (80+)

Key modules in `apps/api/src/modules/`:

| Domain | Modules |
|---|---|
| **Auth & User** | `auth`, `security`, `player-settings`, `presence` |
| **Character & Cultivation** | `character`, `cultivation`, `body-cultivation`, `breakthrough` (in character), `spiritual-root` (in character) |
| **Combat & PvE** | `combat`, `boss`, `dungeon-run`, `world-content`, `secret-realm-runtime`, `roguelike`, `trial-tower` (in world-content) |
| **Social** | `social`, `chat`, `chat-group`, `chat-private`, `chat-moderation`, `mentor`, `co-cultivation`, `party`, `party-dungeon`, `coop-boss` |
| **Economy** | `economy`, `shop`, `market`, `market-v2`, `inventory`, `mail`, `topup`, `giftcode`, `monetization`, `shop-packs` |
| **Sect** | `sect`, `sect-season`, `sect-war`, `territory` |
| **LiveOps** | `liveops`, `liveops-cron`, `liveops-event-scheduler`, `liveops-announcement`, `event-builder`, `feature-flag`, `maintenance-window`, `config-version`, `remote-config` |
| **Admin** | `admin`, `admin-control-center`, `admin-economy-safety`, `admin-mail`, `admin-market-abuse`, `admin-anticheat` |
| **Story & Content** | `story-v2`, `story-dungeon`, `story-dialogue`, `npc`, `npc-affinity`, `quest`, `mission`, `onboarding-quest`, `codex` |
| **Ops** | `health`, `system-status`, `backup`, `metrics`, `logs`, `ops`, `web-push` |

### Shared catalog (100+ files)

`packages/shared/src/` — pure TS, no runtime deps except `zod`. Key exports:

- `realms`, `body-cultivation` — cultivation progression
- `combat`, `combat-rng`, `combat-snapshot` — combat engine
- `items`, `skills`, `monsters`, `boss` — content catalogs
- `balance-dials` — all tuning knobs
- `drop-economy` — material drop system
- `economy-anomaly`, `reward-policy` — anti-abuse
- `admin-control-center` — admin roles/permissions/actions
- `events`, `seasons`, `monetization-foundation`, `monetization-systems` — liveops

### Web views (90+)

`apps/web/src/views/` — each is a route-level component. Key views: `HomeView`, `CharacterView`, `CultivationHubView`, `CombatHubView`, `InventoryView`, `SectView`, `AdminView`, `AdminControlCenterView`.

### Database

Prisma schema at `apps/api/prisma/schema.prisma`. ~100+ models. Migrations in `apps/api/prisma/migrations/`. All schema changes MUST be additive (no field deletion, only deprecation).

---

## Common local issues

| Issue | Fix |
|---|---|
| `Failed to resolve entry for package "@xuantoi/shared"` | Run `pnpm --filter @xuantoi/shared build` first |
| Postgres connection refused | `pnpm infra:up`, check `docker ps` |
| Redis connection refused | `pnpm infra:up`, check `docker ps` |
| Test timeout / prisma migration lock | Kill other API/test processes, or use `TEST_DATABASE_URL` with separate DB |
| `Cannot find module '@xuantoi/shared'` | Build shared: `pnpm --filter @xuantoi/shared build` |
| CORS error in production | Set `CORS_ORIGINS` env to comma-separated origins |
| PWA stale assets | Hard refresh `Ctrl+Shift+R`, unregister service worker |

See `docs/TROUBLESHOOTING.md` for full list.

---

## Docs index

| Need | Read |
|---|---|
| Project overview & navigation | `docs/START_HERE.md` |
| Delivery rules (8 laws) | `docs/AI_WORKFLOW_RULES.md` |
| Current state snapshot | `docs/AI_HANDOFF_REPORT.md` |
| Roadmap (Phase 9–17) | `docs/LONG_TERM_ROADMAP.md` |
| Economy invariants | `docs/ECONOMY_MODEL.md` |
| Content pipeline | `docs/CONTENT_PIPELINE.md` |
| Balance model | `docs/BALANCE_MODEL.md` |
| Game design vision | `docs/GAME_DESIGN_BIBLE.md` |
| Live ops model | `docs/LIVE_OPS_MODEL.md` |
| Admin guide | `docs/ADMIN_GUIDE.md` |
| API reference | `docs/API.md` |
| Deploy | `docs/DEPLOY.md` |
| Security | `docs/SECURITY.md` |
| Run local | `docs/RUN_LOCAL.md` |
| Troubleshooting | `docs/TROUBLESHOOTING.md` |
