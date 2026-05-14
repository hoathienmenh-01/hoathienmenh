# Phase 39.0 — Seasonal Server Progression / Mùa Giải Server Foundation V1

## Scope

- Seasons are server-wide periods (`UPCOMING` → `ACTIVE` → `ENDED` → `ARCHIVED`) with `seasonKey`, name/description, `startAt/endAt`, point config, reward config, and server milestone config.
- Only one `ACTIVE` season is allowed. New seasons perform a **soft reset** by writing progress/leaderboard rows under a new `ServerSeason`; no player asset table is reset.
- Admin mutations use `AdminPermissionGuard`, require reason, and write `AdminAuditLog` action types `SEASON_CREATE`, `SEASON_UPDATE`, `SEASON_ACTIVATE`, `SEASON_END`, `SEASON_ARCHIVE`, `SEASON_REWARD_CONFIG_UPDATE`.

## Data Model

- `ServerSeason`: source of runtime season config and lifecycle state.
- `SeasonProgress`: per-character season points + tracked stats (`bestRoguelikeFloor`, `bossDefeats`, `dungeonClears`, craft/breakthrough counters).
- `SeasonLeaderboardEntry`: per-season leaderboard rows by kind (`POINTS`, `ROGUELIKE_FLOOR`, `BOSS_DEFEATS`, `DUNGEON_CLEARS`).
- `SeasonRewardClaim`: unique `(seasonId, characterId, rewardKey)` idempotency guard.
- `SeasonServerMilestone`: server aggregate progress and unlock timestamp.

## Points

`SeasonsService.addPoints(characterId, source, amount, meta?, now?)` is the integration hook for future modules. Phase 39 wires roguelike completion via `recordRoguelikeCompletion`; other modules can call `addPoints` without deep combat/story/market/PvP edits.

Safety:
- inactive/missing season returns no-op or rejects ended direct mutations;
- daily + weekly caps use `WorldCapService` content cap buckets;
- leaderboard rows are scoped by `seasonId`, so a new season starts clean.

## Rewards

Season rewards are configured per season and granted only through:
- `RewardCapService.applyCapTx(source='SEASON')`
- `CurrencyService.applyTx(reason='SEASON_REWARD_CLAIM')`
- `InventoryService.grantTx(reason='SEASON_REWARD_CLAIM')`
- `SeasonRewardClaim` unique claim guard

Premium currency is not minted by default. Reward config should stay low-to-mid tier; no endgame item should be added unless a later reviewed liveops policy explicitly allows it.

## Server Milestones

Milestones track aggregate metrics such as boss defeats, dungeon clears, craft count, breakthrough count, and roguelike floor progress. Unlocks are small effect keys/events only; player rewards are not automatically mass-granted from milestone unlocks in V1.

## Web UI

`/seasons` renders:
- current season, status, and time remaining;
- personal points, daily/weekly cap usage, and stats;
- reward cards with claim state;
- seasonal leaderboard kind selector;
- server milestones with progress bars;
- loading, empty, and error states;
- VI/EN i18n and shell navigation.

## Tests

Coverage added:
- backend service: single active season guard, inactive season behavior, point/cap path, leaderboard updates, milestone progress, reward one-claim idempotency;
- web store: progress load, leaderboard load, error state;
- web view: full page render and empty active-season state.
