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

### DB migrate reset (dev only!)

`prisma migrate reset` xóa toàn bộ data + reapply all migrations. **KHÔNG BAO GIỜ chạy ở production.**

Sau khi migrate reset, BẮT BUỘC chạy lại:
```bash
pnpm --filter @xuantoi/api bootstrap    # re-create admin + 3 sects
```

Nếu chỉ schema thay đổi (additive), dùng `prisma:migrate` thay vì reset.

### Deploy production

```bash
pnpm --filter @xuantoi/shared build           # build shared first
pnpm --filter @xuantoi/api exec prisma migrate deploy   # apply migrations (not dev mode)
pnpm --filter @xuantoi/api start              # or: node dist/main.js
pnpm --filter @xuantoi/web build              # static output in apps/web/dist
```

Seed data: catalog là static trong `packages/shared/src/*.ts`, không cần DB seed script. Chỉ cần `prisma migrate deploy` + `bootstrap` cho admin.

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

### DO-NOT-BUILD-YET (deferred features)

These features are explicitly deferred. Do NOT build unless PM explicitly requests + dependencies are ready:

| Feature | Reason |
|---|---|
| Real-time PvP | Infra-heavy, async PvP not validated yet |
| Pet/Companion gacha | Legal risk (loot box), needs policy review |
| Voice chat | Out of scope, may never build |
| Mobile native app | PWA sufficient, native = costly rebuild |
| NFT / blockchain | Never |
| Real-money market/trade | Legal — not allowed in VN |
| Multi-region sharding | Too expensive for ROI, needs DAU > 10k |

---

## Env vars

### API (`apps/api/.env`)

| Var | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection | `postgresql://mtt:mtt@localhost:5432/mtt` |
| `REDIS_URL` | Redis connection | `redis://localhost:6379` |
| `JWT_ACCESS_SECRET` | JWT access token secret (≥32 chars in prod) | `change-me-access-secret` |
| `JWT_REFRESH_SECRET` | JWT refresh token secret (≥32 chars in prod) | `change-me-refresh-secret` |
| `INITIAL_ADMIN_EMAIL` | Bootstrap admin email | — |
| `INITIAL_ADMIN_PASSWORD` | Bootstrap admin password (≥8 chars) | — |
| `MISSION_RESET_TZ` | Timezone for daily/weekly reset | `Asia/Ho_Chi_Minh` |
| `MARKET_FEE_PCT` | Market transaction fee [0, 0.5] | `0.05` |
| `SENTRY_ENABLED` | Enable Sentry | `false` |
| `PUSH_ENABLED` | Enable web push notifications | `false` |

### Web (`apps/web/.env`)

| Var | Purpose | Default |
|---|---|---|
| `VITE_API_BASE` | API base path | `/api` |
| `VITE_WS_URL` | WebSocket URL (empty = same origin) | — |
| `VITE_SENTRY_ENABLED` | Enable Sentry frontend | `false` |

---

## Architecture

### WebSocket

- Endpoint: `ws://localhost:3000/ws`
- Auth: cookie-based (same as REST JWT)
- Events: cultivation tick, chat messages, combat updates, notifications
- Client: `socket.io-client` in `apps/web`
- Server: `@nestjs/platform-socket.io` in `apps/api`

### BullMQ job queues

API uses Redis-backed BullMQ for async jobs:
- `cultivation` — cultivation tick (every 30s)
- `body-cultivation` — body cultivation tick
- `liveops-cron` — weekly/daily cycle jobs
- Other module-specific queues

Workers run in-process with the NestJS app.

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

### Static catalog system

Content (items, skills, monsters, dungeons, missions, realms, bosses) lives in `packages/shared/src/*.ts` as static TypeScript — NOT in the database. This means:
- No `prisma db seed` needed for catalog data
- Frontend and backend share the same typed source
- Adding content = editing TS files + building shared + running tests
- DB only stores references (string keys) + runtime state (inventory qty, progress)
- See `docs/CONTENT_PIPELINE.md` for the full process

---

## Common local issues

| Issue | Fix |
|---|---|
| `Failed to resolve entry for package "@xuantoi/shared"` | Run `pnpm --filter @xuantoi/shared build` first |
| `Cannot find module '@xuantoi/shared'` | Build shared: `pnpm --filter @xuantoi/shared build` |
| Postgres connection refused | `pnpm infra:up`, check `docker ps` |
| Redis connection refused | `pnpm infra:up`, check `docker ps` |
| Test timeout / prisma migration lock | Kill other API/test processes, or use `TEST_DATABASE_URL` with separate DB |
| `prisma already running migrations` | Kill stale process, or `SELECT pid FROM pg_stat_activity WHERE datname='mtt'` then kill |
| `relation already exists` on migrate | Check `_prisma_migrations` table, `prisma migrate resolve --applied <name>` |
| CORS error in production | Set `CORS_ORIGINS` env to comma-separated origins |
| Cookie not sent (different origin) | Deploy web + api behind same reverse proxy, or set `SameSite=None; Secure` |
| Login 401 after role change | Logout + login again (old token has stale role) |
| WS not connecting / no tick events | Check cookie validity, DevTools WS status, Redis `bull:cultivation:active` queue |
| PWA stale assets | Hard refresh `Ctrl+Shift+R`, unregister service worker |
| Sentry not sending events | Set `SENTRY_ENABLED=true` + `SENTRY_DSN_API` in API env |
| `INITIAL_ADMIN_PASSWORD chưa được set` | Run via `pnpm --filter @xuantoi/api bootstrap` (reads `.env` automatically) |
| `pnpm install` peer dep error | `corepack enable && corepack prepare pnpm@9.15.1 --activate` |

See `docs/TROUBLESHOOTING.md` for full list.

---

## CI/CD

GitHub Actions workflows:

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | PR / push to `main` | `pnpm install` → shared build → typecheck → lint → test (api + web + shared) → build |
| `e2e-full.yml` | PR touching `apps/**` / `packages/**` / `pnpm-lock.yaml` | Playwright 16-spec E2E on Postgres + Redis service containers |

### PR checklist

Before opening PR:
1. `pnpm --filter @xuantoi/shared build` — shared MUST build
2. `pnpm typecheck` — 0 errors
3. `pnpm lint` — 0 warnings
4. `pnpm --filter @xuantoi/api test` — pass
5. `pnpm --filter @xuantoi/web test` — pass
6. `pnpm build` — clean
7. Han gate: `grep -rP '[\x{4e00}-\x{9fff}]' apps/web/src` returns 0 matches

---

## Security notes

- JWT secrets MUST be ≥32 chars in production (generate: `openssl rand -base64 48`)
- Cookie `SameSite=Lax` in dev; production behind same-origin reverse proxy
- Admin guard: `@RequireAdmin()` + `@RequireAdminPermission(...)` decorators
- CSP headers configurable via env (`CSP_EXTRA_*` vars)
- Rate limiting: `@nestjs/throttler` on auth endpoints
- Password: Argon2id hashing
- All admin actions logged to `AdminAuditLog`
- Backup dumps contain real data — never commit (`backups/` gitignored)
- Sentry disabled by default — enable via `SENTRY_ENABLED=true`

---

## Playable core loop status

The core gameplay loop is **fully real** (end-to-end wired to DB + WS). No mock/stub in the critical path.

### REAL — fully wired (API → DB → WS → UI)

| Loop | API | Service LOC | Web Store | View |
|---|---|---|---|---|
| **Auth** | `POST /auth/register`, `/login`, `/session` | auth.service | `auth.ts` | `AuthView` |
| **Character state** | `GET /character/state` | character.service (831L) | `game.ts` (real API) | `CharacterView`, `HomeView` |
| **Cultivation tick** | BullMQ 30s tick → WS `cultivate:tick` | cultivation.processor (424L) | `game.ts` bindSocket | `CultivationHubView` |
| **Breakthrough** | `POST /character/breakthrough` | character.service | `game.ts` | `BreakthroughView` |
| **Combat (dungeon)** | `POST /combat/encounter/start`, `/action`, `/abandon` | combat.service (1632L) | `dungeonRun.ts` | `DungeonRunView`, `CombatHubView` |
| **Boss** | `GET /world/bosses`, boss encounter | boss.service (1638L) | `worldContent.ts` | `BossHubView` |
| **Inventory** | `GET /inventory`, equip/unequip/use | inventory.service (1237L) | `inventory.ts` | `InventoryView`, `EquipmentView` |
| **Mail** | `GET /mail`, read/claim/delete | mail.service (672L) | (inline API) | `MailView` |
| **Sect** | `POST /sect/join`, `/sect/me`, contribute | sect.service (313L) | (inline API) | `SectView` |
| **Quest/Mission** | `GET /quest`, `/mission`, claim | quest.service (663L), mission.service (432L) | `quest.ts` | `QuestView`, `MissionView` |
| **Spiritual Root** | `GET /character/spiritual-root`, reroll | spiritual-root.service | `spiritualRoot.ts` | `SpiritualRootView` |
| **Cultivation Method** | V1 equip + V2 multi-slot unlock/equip/upgrade | cultivation-method.service, cultivation-method-v2.service | `cultivationMethod.ts`, `cultivationMethodV2.ts` | `CultivationMethodV2View` |
| **Body Cultivation** | `POST /body-cultivation/start`, breakthrough | body-cultivation.service | `bodyCultivation.ts` | `BodyCultivationView` |
| **Tribulation** | `POST /character/tribulation`, encounter/battle | tribulation.service, tribulation-mini-battle.service | `tribulation.ts` | `TribulationView` |
| **Alchemy** | `GET /alchemy/recipes`, `POST /alchemy/craft` | alchemy.service | `alchemy.ts` | `AlchemyView` |
| **Equipment** | reforge/enchant/merge/dismantle/upgrade | equipment.service, equipment-economy.service | (inline) | `EquipmentView` |
| **Artifact V2** | craft/equip/upgrade/star-up/awaken | artifact-v2.service | (inline) | `ArtifactV2View` |
| **Skills** | learn/equip/upgrade-mastery | character-skill.service | `skill.ts` | `SkillBookView` |
| **PvP** | challenge/defense/logs | pvp.service | `pvp.ts` | `PvpView`, `ArenaView` |
| **Notifications** | poll 60s + WS push | notification.service | `notifications.ts` (real API) | `NotificationCenterView` |
| **Daily Login** | claim daily reward | daily-login.service | (inline) | `DailyLoginCard` |
| **Leaderboard** | real rankings | leaderboard.service | (inline) | `LeaderboardView` |
| **Market** | buy/sell with fee | market-v2.service | (inline) | `MarketV2View` |
| **Topup** | request + admin approve | topup.service | (inline) | `TopupView` |
| **Co-Cultivation** | friend session | co-cultivation.service | (inline) | `SocialView` |
| **Party/Coop** | party + dungeon + boss | party.service, party-dungeon.service, coop-boss.service | (inline) | `PartyHubView`, `PartyDungeonView`, `CoopBossView` |
| **Story V2** | story progression | story-v2.service | `storyV2.ts` | `StoryV2View` |
| **Onboarding** | 7-day questline | onboarding-quest.service | `onboardingQuest.ts` | `OnboardingQuestView` |
| **Events** | event lifecycle | event-builder.service | (inline) | `EventsView` |
| **Monetization** | wallet/shop/battle-pass/monthly-card | monetization.service | `monetizationSystems.ts` | `MonetizationDacQuyenView`, `WalletView` |
| **Admin** | full control center (80+ endpoints) | admin-control-center.service | (inline) | `AdminControlCenterView`, `AdminView` |

### Shared catalog completeness

| Catalog | Count | Status |
|---|---|---|
| Realms | 28 (phamnhan → hu_khong_chi_ton) | Complete |
| Items | 202 | Complete |
| Combat (monsters/skills/dungeons) | 135 entries | Complete |
| Missions | 12 (5 daily + 4 weekly + 3 once) | Complete |
| Bosses | 14 definitions | Complete |
| Balance dials | 62 exports | Complete |

### Redirects (aliased routes, not stubs)

All gameplay routes now have real views backed by stores + APIs. These remaining redirects are convenience aliases:

| Route | Redirects to | Note |
|---|---|---|
| `/skills` | `/skill-book` | Alias |
| `/spiritual-roots` | `/spiritual-root` | Alias |
| `/secret-realms` | `/secret-realm` | Alias |
| `/spirit-pets` | `/pets` | Alias |
| `/dungeons` | `/world/dungeons` | Alias |
| `/tower` | `/world/towers` | Alias |
| `/methods` | `/cultivation-method` | Alias |
| `/cultivation-methods` | `/cultivation-method` | Alias |
| `/auction` | `/market` | Feature-gated (`AUCTION_HOUSE_ENABLED`) |

### Home dashboard mock data

`XTHomeDashboard` uses `homeDashboardMock.ts` for dev preview ONLY. Player-facing `/home` uses real store data (character name, realm, linh thạch, tiên ngọc, sect info, mail badge). Sections still reading mock: recent quests (partially wired), equipment slots (defer), feature grid badges (defer).

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
