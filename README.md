# XuânTôi — Tu Tiên Web MUD Game

> A mobile-first web MUD game with cultivation, combat, sects, and a rich xianxia world.

[![CI](https://github.com/hoathienmenh-01/xuantoi/actions/workflows/ci.yml/badge.svg)](https://github.com/hoathienmenh-01/xuantoi/actions/workflows/ci.yml)

## Overview

XuânTôi is a browser-based tu tiên (cultivation) game built with NestJS + Vue 3 + Prisma. Players cultivate their character through realms, fight monsters in dungeons, challenge world bosses, join sects, trade in auctions, and progress through a rich story system.

### Key Features

| Feature | Description |
|---------|-------------|
| 🧘 **Cultivation** | Tick-based auto cultivation with spiritual root, method, talent, buff multipliers |
| ⚔️ **Combat** | Turn-based elemental combat with skill system, DOT/SHIELD tags, pet bonuses |
| 🏰 **Dungeon Run** | Multi-encounter expeditions with per-encounter loot and daily limits |
| 🐉 **Boss** | Multi-region world bosses with rank-based rewards and heartbeat auto-spawn |
| 🎲 **Roguelike** | Floor-based roguelike with buff/debuff choices and weekly reward caps |
| 🐾 **Pet / Linh Thú** | 35+ pets with pity box system, evolve, star-up, skill upgrade |
| 🏯 **Sect** | Roles, permissions, sect boss, war contribution, territory influence |
| 🏪 **Market V2** | Auction house with bid escrow, anomaly detection, 5% tax sink |
| 🧪 **Alchemy** | Craft pills with furnace upgrade, daily caps, rate limiting |
| 📖 **Story V2** | 19 chapters, 209 quests, NPC affinity, dialogue system |
| 💰 **Monetization** | Wallet, battle pass, monthly card, growth fund, limited shop |
| 🎯 **Events** | 11 event types, 9-tier brackets, admin event builder |
| 🏠 **Homestead** | Energy sync, garden production, CAS upgrade |
| 🗺️ **Territory** | Influence tracking, settlement, region buffs, weekly war |

### Stats

- **~97 views** (76 player-facing, 13 admin, 8 utility)
- **70+ backend modules** (NestJS)
- **~9,200+ unit tests** (vitest)
- **44 smoke scripts** (24 in default suite)
- **50/50 tracker tasks** DONE
- **i18n** Vietnamese + English (7,243 keys parity)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | NestJS 10, Prisma 5, PostgreSQL 16, Redis 7, BullMQ |
| Frontend | Vue 3, Vite, Pinia, Tailwind CSS, PWA |
| Shared | TypeScript monorepo (pnpm workspaces) |
| Infra | Docker Compose, Grafana, Loki, Promtail, MinIO |
| Testing | Vitest (unit), Playwright (E2E), smoke scripts |
| CI | GitHub Actions (build + E2E smoke) |

## Quick Start

```bash
# Install dependencies
pnpm install

# Start infrastructure (Postgres + Redis + monitoring)
pnpm infra:up

# Database sync
pnpm --filter @xuantoi/api exec prisma db push

# Seed data (admin + sects)
pnpm --filter @xuantoi/api run bootstrap

# Start dev servers (API + Web)
pnpm dev

# API: http://localhost:3000
# Web: http://localhost:5173
# Grafana: http://localhost:3001
```

## Project Structure

```
xuantoi/
├── apps/
│   ├── api/          # NestJS backend (70+ modules)
│   │   ├── src/modules/
│   │   │   ├── auth/           # Authentication
│   │   │   ├── character/      # Character, skills, talents, alchemy
│   │   │   ├── combat/         # Turn-based combat
│   │   │   ├── cultivation/    # Tick-based cultivation
│   │   │   ├── dungeon-run/    # Multi-encounter expeditions
│   │   │   ├── boss/           # World boss system
│   │   │   ├── roguelike/      # Roguelike dungeon
│   │   │   ├── pet/            # Pet/Linh Thú system
│   │   │   ├── market-v2/      # Auction house
│   │   │   ├── sect/           # Sect management
│   │   │   ├── territory/      # Territory influence
│   │   │   ├── story-v2/       # Story quest system
│   │   │   ├── monetization/   # Wallet, shop, battle pass
│   │   │   └── ...             # 50+ more modules
│   │   └── prisma/             # Database schema + migrations
│   └── web/          # Vue 3 SPA/PWA (97 views)
│       └── src/
│           ├── views/          # Page components
│           ├── components/     # Reusable components
│           ├── api/            # API client layer
│           ├── stores/         # Pinia stores
│           └── i18n/           # vi.json + en.json
├── packages/
│   ├── shared/       # Shared catalogs, validators, types
│   └── logger/       # Unified logging (@xuantoi/logger)
├── infra/            # Docker Compose + monitoring config
├── scripts/          # Smoke tests, backup, integrity checks
└── docs/             # 60+ documentation files
```

## Development

### Quality Gates

```bash
# Type check (all workspaces)
pnpm typecheck

# Lint + i18n parity
pnpm lint

# Build all
pnpm build

# Web tests
pnpm --filter @xuantoi/web test

# API tests (requires Postgres + Redis)
pnpm --filter @xuantoi/api test

# Smoke tests (requires running API)
pnpm smoke:all
```

### Key Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start API + Web dev servers |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | TypeScript check all workspaces |
| `pnpm lint` | ESLint + i18n parity check |
| `pnpm smoke:all` | Run 24 smoke test suites |
| `pnpm smoke:health` | Health check smoke |
| `pnpm smoke:flush-rate-limits` | Flush rate limit Redis keys |
| `pnpm --filter @xuantoi/api test` | API unit tests |
| `pnpm --filter @xuantoi/web test` | Web unit tests |
| `pnpm --filter @xuantoi/api exec prisma db push` | Sync database schema |
| `pnpm --filter @xuantoi/api run bootstrap` | Seed admin + sects |

## Architecture

### Backend Patterns

- **CAS Guards**: `updateMany` with balance/status checks for race-safe mutations
- **Atomic Transactions**: `prisma.$transaction` for all multi-step operations
- **Fail-Soft Design**: Non-critical side effects wrapped in try/catch
- **Idempotency Keys**: UNIQUE constraints prevent double-claims
- **Audit Trails**: CurrencyLedger + ItemLedger for every mutation
- **Cross-Guard**: Combat↔DungeonRun↔Boss↔Roguelike bidirectional activity checks
- **Reward Caps**: Daily EXP/linhThach caps via RewardCapService
- **Rate Limiting**: Sliding window rate limiters on sensitive endpoints

### Frontend Patterns

- **XTLuxHero**: Consistent page hero with tone/watermark/breadcrumb
- **Role Hint + Cross-Nav**: Every player view has role description + navigation links
- **i18n Parity**: Vietnamese + English keys enforced by lint
- **PWA**: Installable, offline-capable, push notifications
- **Mobile-First**: Responsive design verified at 375px+

## Documentation

| Doc | Description |
|-----|-------------|
| [START_HERE.md](docs/START_HERE.md) | Entry point for new developers |
| [AI_HANDOFF_REPORT.md](docs/AI_HANDOFF_REPORT.md) | Current state + recent changes |
| [FEATURE_PROGRESS_TRACKER.md](docs/FEATURE_PROGRESS_TRACKER.md) | Task tracker (50/50 DONE) |
| [FEATURE_AUDIT_AND_ROADMAP.md](docs/FEATURE_AUDIT_AND_ROADMAP.md) | Feature status matrix |
| [GAME_DESIGN_BIBLE.md](docs/GAME_DESIGN_BIBLE.md) | Game design document |
| [BALANCE_MODEL.md](docs/BALANCE_MODEL.md) | Economy & balance model |
| [API.md](docs/API.md) | API documentation |
| [DEPLOY.md](docs/DEPLOY.md) | Deployment guide |
| [RUN_LOCAL.md](docs/RUN_LOCAL.md) | Local development setup |
| [SECURITY.md](docs/SECURITY.md) | Security policies |
| [BETA_CHECKLIST.md](docs/BETA_CHECKLIST.md) | Beta readiness checklist |

## Beta Status

**v1.0 Beta Ready** ✅

- 22/22 core systems DONE
- 12/12 advanced systems PARTIAL (sufficient for beta)
- 76/76 player views polished
- ~9,200+ unit tests passing
- PR #702: 17 code review issues fixed

## License

Private — All rights reserved.