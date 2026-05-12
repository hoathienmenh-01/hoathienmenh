# Phase 25.1 — Battle Pass / Monthly Card / VIP Light Plan

## Goals

- Add light monetization foundations for Tiên Lộ Lệnh, Nguyệt Tạp, and VIP Light.
- Keep all reward claims server-authoritative, transactional, ledgered, and duplicate-safe.
- Preserve Phase 23.2–23.7 equipment/pháp bảo fairness: no paid bypass of `requiredRealmOrder`, no direct top-tier equipment, no max-star/max-awaken pháp bảo sale, no uncapped materials or dungeon tickets.

## Preconditions verified

- PR #545 (Phase 23.7 Pháp Bảo Star-up + Awaken Persistence) is merged to `main`.
- Latest PR #545 CI checks are green.
- No open PRs existed before this Phase 25.1 branch.
- `docs/AI_HANDOFF_REPORT.md` already references Phase 23.7 at the top of Current Executive Summary.

## Shared config and balance

- Add shared monetization config in `packages/shared/src/monetization.ts`.
- Define:
  - `BATTLE_PASS_SEASONS`
  - `getBattlePassLevelForXp`
  - `getBattlePassReward`
  - `canClaimBattlePassReward`
  - `validateBattlePassReward`
  - `MONTHLY_CARD_CONFIG`
  - `canClaimMonthlyCard`
  - `getMonthlyCardDailyReward`
  - `VIP_LIGHT_CONFIG`
  - `getVipLevelFromTopup`
  - `getVipPerks`
  - `validateVipPerks`
- Rewards are intentionally small acceleration/cosmetic/convenience rewards:
  - soft currency with caps
  - low/mid upgrade materials
  - protection / unsocket / reforge tokens
  - limited dungeon tickets
  - same-tier pháp bảo shards
  - title/aura/frame-style cosmetic keys
- Shared validation rejects forbidden direct-power rewards:
  - no tier 9/10 direct equipment
  - no direct THAN top pháp bảo
  - no max star / max awaken grant
  - no uncapped material/ticket grants
  - no direct hard-cap bypass.

## Database

Add additive Prisma models:

- `BattlePassSeason`
  - season metadata mirrored from shared config for runtime lookup/audit.
- `BattlePassProgress`
  - `characterId`, `seasonId`, `xp`, `level`, `premiumUnlocked`, claimed free/premium level arrays, timestamps.
- `MonthlyCardSubscription`
  - `characterId`, `activeUntil`, `lastClaimAt`, `totalClaimedDays`, timestamps.
- `VipProfile`
  - `characterId`, `vipLevel`, `lifetimeTopupAmount`, `grantedByAdmin`, timestamps.

No destructive migration. Claim arrays will use JSON/int-array pattern only if compatible with existing Prisma/Postgres style; otherwise use child claim rows with unique constraints.

## API/runtime

Add a `monetization` API module with:

### Battle Pass

- `GET /monetization/battle-pass/current`
- `GET /monetization/battle-pass/progress`
- `POST /monetization/battle-pass/claim`
- `POST /monetization/battle-pass/claim-all`
- Admin grant: `POST /admin/battle-pass/grant-premium`

Server checks:

- authenticated character ownership
- active season
- sufficient level
- unclaimed level/track
- premium unlock for premium track
- shared reward validation
- transaction-safe grant through currency/inventory services
- ledger reasons/ref ids scoped to season/level/track.

### Monthly Card

- `GET /monetization/monthly-card`
- `POST /monetization/monthly-card/claim`
- Admin grant: `POST /admin/monthly-card/grant`

Server checks:

- active subscription window
- UTC day once-only claim
- no missed-day auto-claim
- transaction-safe reward grant
- ledger reason/ref id for each daily claim.

### VIP Light

- `GET /monetization/vip`
- Admin grant: `POST /admin/vip/grant`

Server checks:

- role-protected admin grant
- VIP tiers 0–5 only
- perks from shared config only
- no direct combat-damage spike, realm bypass, tier bypass, or max-upgrade grant.

## UI

Add a monetization view/panel with three tabs:

- Battle Pass / Tiên Lộ Lệnh
  - season name/time remaining
  - level/xp progress
  - free/premium track reward preview
  - per-level claim and claim-all
  - premium locked state.
- Monthly Card / Nguyệt Tạp
  - active/inactive state
  - days remaining
  - today claimable state
  - today reward preview
  - claim action.
- VIP Light
  - current VIP level
  - next-level progress/foundation
  - unlocked/locked perk list
  - fairness copy avoiding pay-to-win messaging.

Add vi/en i18n parity and render tests for key states.

## Tests

Run and keep passing:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

Coverage:

- shared XP/level, claimability, reward validation, monthly-card day gate, VIP mapping/perk validation
- API battle-pass success/duplicate/premium-locked/level-too-low/claim-all, monthly-card success/double-claim, VIP endpoint/admin role checks, ledger/reward writes
- UI battle-pass progress/rewards/disabled states, premium locked state, monthly card claim state, VIP perk list, vi/en parity.

## Docs and handoff

Update:

- `docs/GAME_DESIGN_BIBLE.md`
- `docs/BALANCE_MODEL.md`
- `docs/ECONOMY_MODEL.md`
- `docs/API.md`
- `docs/AI_HANDOFF_REPORT.md`
- `docs/CHANGELOG.md`
- `docs/ADMIN_RUNBOOK.md` if admin grant behavior changes.

Docs will explicitly state:

- Phase 25.1 is light monetization, not paid auto-win.
- Free players retain complete farming paths.
- Premium accelerates roughly 20–40% within the same tier/realm and adds convenience/cosmetics.
- Claims are ledgered and duplicate-safe.
- Paid rewards never bypass `requiredRealmOrder` or equipment/pháp bảo tier caps.

## Risk and rollback

- Risk: duplicate claim or partial reward grant. Mitigation: DB transaction, unique claim representation/CAS update, tests.
- Risk: overpowered premium reward. Mitigation: shared reward validator and docs balance caps.
- Risk: UI exposes action before runtime gate. Mitigation: server-authoritative checks; UI only reflects returned state.
- Rollback: disable active season/monthly grant/admin grant routes by config or revert additive migration-backed runtime without destructive data loss.

## Known follow-ups

- Phase 25.2: Shop Packs / Limited Weekly Resource Packs.
- Phase 25.3: Cosmetic Store / Aura / Title / Frame.
- Phase 21B/21C: Story Book II–V Expansion.
- Phase 24.2/24.3: Closed Beta QA / Polish.
