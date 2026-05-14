# Phase 36.0 — Động Phủ, Linh Điền, Dược Viên & Resource Production V1

## Scope

Phase 36.0 adds a player-owned **Động Phủ** foundation:

- 1 homestead per character, lazy-created by `GET /homestead`.
- **Linh Điền** field slots for time-gated herb production.
- **Dược Viên** garden slots for auxiliary alchemy material production.
- Offline spiritual-energy regeneration with hard cap.
- Server-authoritative harvest/claim through inventory ledger and daily caps.

This phase is intentionally conservative: no premium bypass, no direct admin grants, no client-trusted timers, and no uncapped resource mint.

## Catalog & Balance

Shared catalog lives in `packages/shared/src/homestead.ts`.

### Homestead levels

| Level | Slots | Garden | Storage | Max crop/garden tier | Realm gate |
|---:|---:|---:|---:|---:|---|
| 1 | 2 | 1 | 120 | 1 / 1 | — |
| 2 | 3 | 1 | 180 | 2 / 1 | `luyenkhi` |
| 3 | 4 | 2 | 260 | 2 / 2 | `truc_co` |
| 4 | 5 | 2 | 360 | 3 / 2 | `kim_dan` |
| 5 | 6 | 3 | 500 | 4 / 3 | `nguyen_anh` |
| 6 | 8 | 4 | 680 | 5 / 4 | `hoa_than` |

### Anti-inflation caps

- Spiritual energy regenerates at `10/hour`, capped to `8` offline hours and `storageCap`.
- Plant/start consumes spiritual energy up front.
- Harvest/claim is capped by `WorldCapService.consumeDailyTx`.
- Caps are per character + output item:
  - `homestead:field:${outputItemKey}`
  - `homestead:garden:${outputItemKey}`
- Higher-tier and rare materials have lower daily caps (e.g. tier 5 crop cap `1/day`, rare garden cap `1–2/day`).
- Tier access requires both homestead level and realm tier (`canUseHomesteadTier` + realm requirement).

Remote balance key `homestead_balance` can tune multipliers:

```json
{
  "energyRegenPerHourMultiplier": 1,
  "fieldGrowthMinutesMultiplier": 1,
  "gardenDurationMinutesMultiplier": 1,
  "dailyCapMultiplier": 1,
  "upgradeCostMultiplier": 1
}
```

Use existing Remote Config admin/audit flow for edits; Phase 36 does not add a new grant surface.

## Data Model

Migration: `apps/api/prisma/migrations/20360101000000_phase_36_homestead_resource_production/migration.sql`.

Models:

- `Homestead` — 1:1 `Character`, level, spiritual energy, regen timestamp.
- `HomesteadField` — unique `(homesteadId, slotIndex)`, crop snapshot, `readyAt`, `harvestedAt`.
- `HomesteadGardenPlot` — unique `(homesteadId, slotIndex)`, production snapshot, `readyAt`, `claimedAt`.

Slot uniqueness plus `updateMany(... harvestedAt/claimedAt: null, readyAt <= now)` provides CAS-style duplicate protection.

## API

All routes require auth cookie + character.

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/homestead` | — | Full overview: homestead, upgrade preview, fields, garden, catalogs. |
| POST | `/homestead/upgrade` | `{}` | Upgrade by 1 level; consumes `LINH_THACH` via `CurrencyService`. |
| GET | `/homestead/fields` | — | Field slots + crop catalog. |
| POST | `/homestead/fields/plant` | `{ slotIndex, cropKey }` | Plant crop in unlocked empty slot. |
| POST | `/homestead/fields/harvest` | `{ slotIndex }` | Harvest ready crop once; grants item through `InventoryService.grantTx`. |
| GET | `/homestead/garden` | — | Garden slots + production catalog. |
| POST | `/homestead/garden/start` | `{ slotIndex, productionKey }` | Start garden production in unlocked empty slot. |
| POST | `/homestead/garden/claim` | `{ slotIndex }` | Claim ready production once; grants item through `InventoryService.grantTx`. |

Common error codes: `INVALID_INPUT`, `UNAUTHENTICATED`, `NO_CHARACTER`, `MAX_LEVEL`, `REALM_TOO_LOW`, `HOMESTEAD_LEVEL_TOO_LOW`, `INSUFFICIENT_FUNDS`, `INSUFFICIENT_SPIRITUAL_ENERGY`, `SLOT_LOCKED`, `SLOT_OCCUPIED`, `NOT_READY`, `ALREADY_CLAIMED`, `DAILY_CAP_REACHED`.

## Economy Audit Trail

- Upgrade linh thạch sink: `CurrencyLedger.reason = HOMESTEAD_UPGRADE`.
- Field/garden item sources:
  - `ItemLedger.reason = HOMESTEAD_FIELD_HARVEST`
  - `ItemLedger.reason = HOMESTEAD_GARDEN_CLAIM`
- Daily cap rows use `DailyRewardCap` through `WorldCapService`.

## Frontend

UI route: `/homestead`.

Files:

- `apps/web/src/api/homestead.ts`
- `apps/web/src/stores/homestead.ts`
- `apps/web/src/views/HomesteadView.vue`
- shell nav entry `shell.nav.homestead`
- i18n in `apps/web/src/i18n/vi.json` and `en.json`

The page includes loading/error/empty states, upgrade preview, Linh Điền tab, Dược Viên tab, remaining-time labels, disabled CTAs for locked/not-ready/in-flight actions, and localized VI/EN labels.

## Tests

Focused tests:

- `packages/shared/src/homestead.test.ts`
- `apps/api/src/modules/homestead/homestead.service.test.ts`
- `apps/web/src/views/__tests__/HomesteadView.test.ts`

Coverage includes catalog integrity, default homestead creation, upgrade prerequisites, plant success, harvest not-ready guard, one-time harvest, spam harvest no duplicate, daily cap, storage/offline cap, tier gating, garden claim, and UI render/action paths.
