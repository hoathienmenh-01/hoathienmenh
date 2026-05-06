-- Phase 12.6 — Boss-by-region auto-spawn.
--
-- Mở rộng từ "≤1 ACTIVE world boss" (Concurrency phase 2 partial unique từ
-- migration `20260522000000_concurrency_boss_active_unique`) sang "≤1 ACTIVE
-- per region" để phase 12.6 boss-by-region auto-spawn có thể giữ ≥2 boss
-- ACTIVE đồng thời (mỗi region 1 boss). Player chọn boss match cảnh giới
-- mình thay vì chen 1 slot global.
--
-- Schema change:
--   1. `WorldBoss.regionKey` cột mới NOT NULL DEFAULT 'world' — backfill
--      mọi row hiện tại (kể cả ACTIVE) về 'world' (legacy world boss). Sau
--      migration, FE/runtime sẽ dùng region cụ thể (`hac_lam`, `kim_son_mach`,
--      v.v.) cho boss spawn theo `BossDef.regionKey` ở
--      `packages/shared/src/boss.ts`.
--   2. DROP partial unique index `WorldBoss_status_active_unique` (cap cũ 1
--      ACTIVE total).
--   3. CREATE partial unique index `WorldBoss_status_region_active_unique`
--      ON `(status, regionKey) WHERE status='ACTIVE'` — cap mới 1 ACTIVE
--      per region. Postgres NULL semantics N/A vì regionKey NOT NULL.
--   4. CREATE composite index `(regionKey, status)` cho query
--      `findFirst({status: ACTIVE, regionKey})` của heartbeat loop.
--
-- Concurrency phase 2 backstop vẫn giữ:
--   - `BossService.spawnNew(regionKey)` catch P2002 → return null (race
--     loser per region), heartbeat continue.
--   - `BossService.heartbeatRunning` flag intra-process re-entry guard.
--
-- Rollback: revert ALTER TABLE cột (DROP COLUMN regionKey) + revert index
-- swap. Lưu ý: nếu khi rollback có ≥2 ACTIVE rows (do phase 12.6 đã spawn
-- multi-region), cần manual cleanup (flip thừa thành EXPIRED) trước khi
-- restore old unique index. Migration KHÔNG ghi data ngoài DEFAULT
-- backfill (an toàn).
ALTER TABLE "WorldBoss"
  ADD COLUMN "regionKey" TEXT NOT NULL DEFAULT 'world';

DROP INDEX IF EXISTS "WorldBoss_status_active_unique";

CREATE UNIQUE INDEX "WorldBoss_status_region_active_unique"
  ON "WorldBoss"("status", "regionKey")
  WHERE "status" = 'ACTIVE';

CREATE INDEX "WorldBoss_regionKey_status_idx"
  ON "WorldBoss"("regionKey", "status");
