# Roguelike Bí Cảnh — Phase 38.0

Foundation cho random adventure nhiều tầng, chơi được qua `/roguelike`.

## Gameplay

- Mỗi run có `seed`, `realmKey`, `currentFloor`, HP/resource tạm, score, reward multiplier và buff/debuff tạm.
- Status: `ACTIVE`, `COMPLETED`, `FAILED`, `ABANDONED`, `CLAIMED`.
- Một character chỉ có 1 run `ACTIVE` cùng lúc.
- Floor type mở rộng: `COMBAT`, `ELITE`, `MINI_BOSS`, `TRAP`, `TREASURE`, `MERCHANT`, `EVENT`, `REST`, `INHERITANCE`.
- Mỗi tầng sinh 1–3 lựa chọn từ seed; choice có outcome rõ ràng, HP/resource/score/reward/buff/debuff.
- Buff/debuff chỉ lưu trong JSON của `RoguelikeRun`, giảm duration theo tầng và hết hiệu lực khi run kết thúc.

## Balance & limits

- Shared catalog: `packages/shared/src/roguelike.ts`.
- Feature flag: `ROGUELIKE_ENABLED`.
- Remote config: `roguelike_balance` (`enabled`, `dailyEntryLimit`, `weeklyRewardClaimLimit`, `rewardMultiplier`, `maxCompletionFloor`).
- Daily entry cap qua `WorldCapService.consumeDailyTx`.
- Weekly claim cap qua `WorldCapService.consumeWeeklyTx`.
- Reward cap source `ROGUELIKE`: `7000 EXP` + `2400 Linh Thạch`.
- Không mint `tienNgoc`; rare/endgame drops không nằm trong Phase 38 catalog.

## Reward invariants

- Reward preview là server-authoritative.
- Claim chỉ chạy khi run `COMPLETED`.
- Idempotency: CAS `updateMany({ id, status: COMPLETED, claimedAt: null })` → `CLAIMED`.
- Currency grant qua `CurrencyService.applyTx`:
  - `ROGUELIKE_FLOOR_REWARD`
  - `ROGUELIKE_MILESTONE_REWARD`
- Item grant qua `InventoryService.grantTx` reason `ROGUELIKE_FLOOR_REWARD`.
- Ledger ref: `refType='RoguelikeRun'`, `refId=run.id`.

## API

Xem `docs/API.md` § `RoguelikeController`.

Các endpoint chính:

- `GET /roguelike-realms`
- `POST /roguelike-realms/:realmKey/start`
- `GET /roguelike-runs/current`
- `GET /roguelike-runs/:id`
- `POST /roguelike-runs/:id/choose`
- `POST /roguelike-runs/:id/abandon`
- `POST /roguelike-runs/:id/claim`
- `GET /roguelike-runs/leaderboard`

## UI

- Route: `/roguelike`.
- Hiển thị realm list, active run, HP/resource/score, buff/debuff, choice cards, log tầng, reward preview, claim modal, leaderboard.
- Loading/empty/error states + i18n VI/EN.

## Tests

- Backend: `apps/api/src/modules/roguelike/roguelike.service.test.ts`
  - start seed + active guard
  - daily limit
  - floor progress/history + buff JSON scope
  - completion leaderboard
  - idempotent claim ledger
  - weekly cap
- Web: `apps/web/src/views/__tests__/RoguelikeView.test.ts`
  - render page sections
  - choice + claim interactions
