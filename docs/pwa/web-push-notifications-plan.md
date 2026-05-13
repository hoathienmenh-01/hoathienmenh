# PWA-1 — PWA Web Push Notifications (plan)

## Mục tiêu

Cho phép người chơi nhận thông báo PWA / Web Push khi đóng tab cho 4 sự kiện:

1. **Boss spawn** — boss thế giới hồi sinh trong khu của character.
2. **Stamina full** — thể lực hồi đầy (sau cooldown).
3. **Mail mới** — admin / hệ thống gửi mail có reward.
4. **Daily login reminder** — nhắc 1 lần / ngày nếu user chưa login hôm nay.

Phải có **opt-in rõ ràng**, **per-type toggle**, **anti-spam dedupe + cooldown**,
**invalid subscription cleanup**, **dry-run mode** cho local. **KHÔNG** gắn story
quest notification (theo §QUY TẮC AN TOÀN — chừa Story Runtime / QuestService).

## Scope (PR PWA-1)

### Shared (`packages/shared/src/web-push.ts`)

- Catalog `WEB_PUSH_NOTIFICATION_TYPES` = 4 type literals.
- Catalog `WEB_PUSH_LIMITS`: cooldown / day-cap / endpoint length cap.
- DTO: `WebPushSubscriptionView`, `WebPushPreferencesView`, `WebPushPayload`.
- Pure-function helpers:
  - `validatePushSubscriptionInput(...)` — endpoint scheme `https?`, p256dh/auth length, sanitize UA.
  - `parsePushPreferencesPatch(...)` — clamp boolean + quietHours `00:00` / `23:59`.
  - `shouldSendPushNotification(prefs, type, now, lastSentAt?, dedupeKey?)` — anti-spam check.
- Vitest pure-function tests (~25–30 cases).

### Backend (`apps/api/src/modules/web-push`)

#### Prisma — 2 models

```prisma
model WebPushSubscription {
  id           String    @id @default(cuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  endpoint     String    @unique
  p256dh       String
  auth         String
  userAgent    String?
  enabled      Boolean   @default(true)
  failureCount Int       @default(0)
  lastUsedAt   DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@index([userId, enabled])
}

model UserPushPreferences {
  userId               String   @id
  user                 User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  bossSpawnEnabled     Boolean  @default(true)
  staminaFullEnabled   Boolean  @default(true)
  mailEnabled          Boolean  @default(true)
  dailyReminderEnabled Boolean  @default(false)
  quietHoursStart      String?  // "HH:mm" or null
  quietHoursEnd        String?
  timezone             String?  // IANA tz
  updatedAt            DateTime @updatedAt
}
```

Plus `User.webPushSubscriptions` backref + `User.pushPreferences` backref.

#### Service `WebPushService`

- `getPublicKey()` → string từ env `VAPID_PUBLIC_KEY`.
- `subscribe(userId, raw)` → upsert by endpoint, sanitize UA, enable.
- `unsubscribe(userId, endpoint)` → soft-disable.
- `listSubscriptions(userId)` → enabled rows.
- `getPreferences(userId)` → ensure row + return.
- `updatePreferences(userId, patch)` → parse + persist.
- `sendToUser(userId, type, payload)`:
  - `PUSH_ENABLED` env gate.
  - Load prefs + `shouldSendPushNotification`.
  - Foreach enabled subscription: dynamic-import `web-push`, sign + POST.
  - 410 / 404 / 403 → mark `enabled=false` + bump `failureCount`.
  - `PUSH_DRY_RUN` env → just log, no network.
- `cleanupStaleSubscriptions()` → admin/cron.

#### Controller — REST + Zod

- `GET /push/vapid-public-key`
- `POST /push/subscribe`
- `POST /push/unsubscribe`
- `GET /push/preferences`
- `PATCH /push/preferences`

All require `xt_access` cookie (pattern same as NotificationController).

#### Triggers (best-effort, fail-soft)

- `MailService.create*()` → if user has push prefs allow `mailEnabled`, fire `sendToUser('MAIL_NEW')`.
- Boss spawn — kept loosely-coupled: expose `WebPushDispatcher.notifyBossSpawn(...)` helper module; **hook actual boss spawn in follow-up** (avoid touching boss runtime in this PR — KHÔNG đụng combat).
- Stamina full — same pattern: expose `WebPushDispatcher.notifyStaminaFull(...)`. Stamina-tick worker integration follow-up.
- Daily reminder — provide `DailyPushReminderService` with `runDailyReminderSweep()` callable; CI/cron wiring follow-up.

This isolates push **infrastructure** in PR PWA-1 and lets each trigger be wired in tiny, low-risk follow-up PRs that won't touch this PR's scope.

#### Tests

- Service: subscribe upsert idempotent, unsubscribe soft-disable, prefs CRUD, dedupe cooldown, invalid subscription cleanup, `PUSH_DRY_RUN`. ~14 cases.

### Frontend (`apps/web`)

- `apps/web/public/sw.js` *or* extend Workbox custom SW for `push` + `notificationclick` events.
- `apps/web/src/api/webPush.ts` — fetch wrapper (5 calls + base64-url helper).
- `apps/web/src/composables/useWebPush.ts` — permission + subscribe / unsubscribe / status helpers.
- `apps/web/src/views/NotificationSettingsView.vue` — opt-in UI + per-type toggle + permission-denied empty state + mobile-friendly.
- Add nav link `/notification-settings` + i18n (vi/en parity).
- Smoke tests ~5–7 cases (permission denied flow, toggle, subscribe success).

## Anti-spam / safety

- `shouldSendPushNotification` enforces:
  - Per-type `enabled=true` in preferences.
  - Per-type cooldown (`BOSS_SPAWN` 5 min, `STAMINA_FULL` 10 min, `MAIL_NEW` 30 sec, `DAILY_REMINDER` 24h).
  - Quiet hours block (if both `quietHoursStart` + `quietHoursEnd` set).
- Endpoint 410/404/403 ⇒ `enabled=false`. Persistent failure ⇒ delete.
- `PUSH_ENABLED=false` ⇒ short-circuit at service level.
- `PUSH_DRY_RUN=true` ⇒ log payload + no HTTP call.

## Env (.env.example additions)

```dotenv
VAPID_PUBLIC_KEY=<base64url, generated by web-push generate-vapid-keys>
VAPID_PRIVATE_KEY=<secret>
VAPID_SUBJECT=mailto:ops@example.com
PUSH_ENABLED=true
PUSH_DRY_RUN=true
```

## Rủi ro / Rollback

🟢 **Low** — schema additive (2 new tables); not modifying any existing notification/mail/boss tables. Service gates everything on `PUSH_ENABLED` (default false in prod until VAPID keys configured). Rollback = revert PR + `prisma migrate resolve --rolled-back 20300401000000_phase_pwa_1_web_push`.

## Follow-ups

- Wire boss-spawn event into BossSpawnService.
- Wire stamina-full event into BullMQ stamina worker.
- Wire daily reminder into existing scheduler.
- Optional: deep-link click route per push type.
- Optional: rich notification (icon/image/actions).

## KHÔNG được làm trong PR này

- KHÔNG sửa Story Runtime / Quest / RewardService / CurrencyService core.
- KHÔNG break PWA install (existing `vite-plugin-pwa` config still autoUpdate).
- KHÔNG commit VAPID private key thật.
- KHÔNG gửi push khi user chưa opt-in.

## 5-PR campaign tracker (link)

| PR | Branch | Status |
|----|--------|--------|
| OPS-1 | feat/phase-17-2-backup-restore-offsite-s3 | #574 merged |
| OPS-2 | fix/m7-csp-production-cdn-domains | #575 merged |
| QOL-1 | feat/qol-1-inventory-lock-autosort | #578 merged |
| QOL-2 | feat/qol-2-loadout-preset | #584 merged |
| PWA-1 | feat/pwa-web-push-notifications | this PR |
