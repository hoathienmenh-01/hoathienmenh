# Achievement, Title, Reputation & Long-term Goals

Phase 46.0 extends the Phase 11.9/11.10 achievement/title foundation. It keeps rewards safe, cosmetic-first, and server-authoritative; it does **not** deeply wire story/market/PvP/combat.

## Catalogs

- `packages/shared/src/achievements.ts`: achievement catalog with unique `key`, `category`, `tier`, `goalKind`, `goalAmount`, small reward, optional `hidden`, optional `rewardTitleKey`.
- `packages/shared/src/titles.ts`: title catalog. Achievement titles use `source='achievement'` and `unlockAchievementKey`.
- `packages/shared/src/reputation-goals.ts`: Phase 46 catalog for:
  - Reputation groups: `TIEN_DAO`, `DAN_DAO`, `CHIEN_DAU`, `BI_CANH`, `TONG_MON`, `XA_HOI`, `SU_KIEN`, `THUONG_HOI`.
  - Long-term goals by category: `realm`, `body`, `pet`, `dungeon`, `boss`, `sect`.

## Runtime models

- `CharacterAchievement`: per-character progress, `completedAt`, `claimedAt`.
- `CharacterTitleUnlock`: title ownership.
- `Character.title`: single equipped title key.
- `CharacterReputation`: per-character reputation score + daily cap accounting (`dailyGain`, `dailyKey`, `lastGainedAt`).
- `CharacterLongTermGoal`: per-character long-term goal progress + `completedAt`.

## Safety rules

- Achievement claim is one-time and race-safe via `claimedAt = null` CAS.
- Currency/item rewards are granted through existing ledger/inventory services (`CurrencyLedger`, `ItemLedger`) with reason `ACHIEVEMENT_REWARD`.
- Titles are cosmetic; equip/unequip only writes the single title slot.
- Reputation gains are capped per day per group; Phase 46 exposes read UI and service foundation without high-power rewards.
- Hidden achievements stay out of the catalog UI until progress exists.

## APIs

- Player:
  - `GET /character/achievements`
  - `POST /character/achievement/claim`
  - `GET /character/titles`
  - `POST /character/title/equip`
  - `POST /character/title/unequip`
  - `GET /character/reputation/me`
  - `GET /character/long-term-goals/me`
- Admin/read-only:
  - `GET /admin/achievement-reputation/catalog`
  - `GET /admin/users/:id/achievement-reputation`

## UI

- `/achievements`: achievement progress, filters, claim status.
- `/titles`: title catalog, owned/locked/equipped states.
- `/reputation`: reputation cards + long-term goals panel.
- `/admin/achievements-reputation` and Admin tab `achievementReputation`: catalog + player progress lookup.

## Tests

- Shared catalog invariants: `achievements.test.ts`, `titles.test.ts`, `reputation-goals.test.ts`.
- API/service coverage: `achievement.service.test.ts`, `title.service.test.ts`, admin guard/controller/service tests.
- UI smoke: `AchievementView.test.ts`, `TitleView.test.ts`, `ReputationView.test.ts`.
