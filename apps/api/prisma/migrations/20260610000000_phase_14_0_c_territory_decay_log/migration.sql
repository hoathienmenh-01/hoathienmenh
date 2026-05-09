-- Phase 14.0.C — Territory Influence Decay Log.
--
-- Một bảng mới (independent, no FK ngoài):
--   - `SectTerritoryDecayLog`: 1 row / periodKey, lưu decayBps + delta
--     pointsBefore/pointsAfter snapshot (audit trail). UNIQUE periodKey
--     cho idempotency — admin gọi `POST /admin/territory/decay?periodKey=...`
--     nhiều lần cùng period chỉ ghi 1 row (P2002 swallow → trả `skipped: true`).
--
-- Rollback: DROP bảng — không ảnh hưởng influence rows (Phase 14.0.A).
-- Decay đã chạy KHÔNG được rollback bằng bảng này (tăng điểm lại sai
-- audit) — caller phải cleanup manual nếu cần unwind.

CREATE TABLE "SectTerritoryDecayLog" (
  "id"           TEXT         NOT NULL,
  "periodKey"    TEXT         NOT NULL,
  "decayBps"     INTEGER      NOT NULL,
  "rowsAffected" INTEGER      NOT NULL DEFAULT 0,
  "pointsBefore" INTEGER      NOT NULL DEFAULT 0,
  "pointsAfter"  INTEGER      NOT NULL DEFAULT 0,
  "triggeredBy"  TEXT,
  "triggeredAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SectTerritoryDecayLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SectTerritoryDecayLog_periodKey_key"
  ON "SectTerritoryDecayLog" ("periodKey");

CREATE INDEX "SectTerritoryDecayLog_triggeredAt_idx"
  ON "SectTerritoryDecayLog" ("triggeredAt");
