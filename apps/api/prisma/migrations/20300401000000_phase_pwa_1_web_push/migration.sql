-- Phase PWA-1 — PWA Web Push Notifications (additive).
--
-- Adds 3 new tables:
--   * WebPushSubscription   — push gateway endpoint per device.
--   * UserPushPreferences   — per-user per-type preferences + quiet hours.
--   * WebPushSendLog        — per-user per-type cooldown / dedupe state.
--
-- Rollback: DROP TABLE in reverse order. Other tables not touched.

CREATE TABLE "WebPushSubscription" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "endpoint"     TEXT NOT NULL,
  "p256dh"       TEXT NOT NULL,
  "auth"         TEXT NOT NULL,
  "userAgent"    TEXT,
  "enabled"      BOOLEAN NOT NULL DEFAULT true,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt"   TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebPushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebPushSubscription_endpoint_key" ON "WebPushSubscription"("endpoint");
CREATE INDEX "WebPushSubscription_userId_enabled_idx" ON "WebPushSubscription"("userId", "enabled");
CREATE INDEX "WebPushSubscription_enabled_updatedAt_idx" ON "WebPushSubscription"("enabled", "updatedAt");

ALTER TABLE "WebPushSubscription"
  ADD CONSTRAINT "WebPushSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UserPushPreferences" (
  "userId"               TEXT NOT NULL,
  "bossSpawnEnabled"     BOOLEAN NOT NULL DEFAULT true,
  "staminaFullEnabled"   BOOLEAN NOT NULL DEFAULT true,
  "mailEnabled"          BOOLEAN NOT NULL DEFAULT true,
  "dailyReminderEnabled" BOOLEAN NOT NULL DEFAULT false,
  "quietHoursStart"      TEXT,
  "quietHoursEnd"        TEXT,
  "timezone"             TEXT,
  "updatedAt"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserPushPreferences_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "UserPushPreferences"
  ADD CONSTRAINT "UserPushPreferences_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WebPushSendLog" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "type"       TEXT NOT NULL,
  "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dedupeKey"  TEXT,
  "lastStatus" TEXT NOT NULL DEFAULT 'OK',
  "updatedAt"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WebPushSendLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebPushSendLog_userId_type_key" ON "WebPushSendLog"("userId", "type");
CREATE INDEX "WebPushSendLog_userId_lastSentAt_idx" ON "WebPushSendLog"("userId", "lastSentAt" DESC);
