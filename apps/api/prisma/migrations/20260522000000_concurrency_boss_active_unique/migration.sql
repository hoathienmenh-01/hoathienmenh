-- Phase 12.X concurrency phase 2 — Boss spawn cron auto race fix
--
-- Without this partial unique index, two concurrent
-- `BossService.heartbeat()` ticks (multi-pod deployment, or a single pod
-- whose previous tick is still in-flight) can each pass the
-- `findFirst({status: ACTIVE}) === null` check and both succeed at
-- `worldBoss.create()`. Result: 2 ACTIVE WorldBoss rows simultaneously,
-- which splits leaderboard / damage tracking and corrupts ledger if
-- players hit the "wrong" boss.
--
-- A partial unique index restricts uniqueness to rows where
-- `status = 'ACTIVE'`. This makes the second concurrent `create()` fail
-- with Postgres unique violation (Prisma error code `P2002`), which the
-- application catches and turns into a benign no-op (heartbeat path) or
-- a `BOSS_ALREADY_ACTIVE` error (admin force-spawn path).
--
-- Note: Prisma 5.22 does NOT model partial unique indexes in
-- `schema.prisma`. This migration is the source of truth — keep it
-- manually if migrations are ever re-baselined.
CREATE UNIQUE INDEX "WorldBoss_status_active_unique"
  ON "WorldBoss"("status")
  WHERE "status" = 'ACTIVE';
