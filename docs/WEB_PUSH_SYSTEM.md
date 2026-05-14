# Web Push System

> **Status**: Phase 44.1 (PR #591) — trigger thật wire vào gameplay.
> Phase 38.x đã có foundation (subscription / preference / dispatcher /
> dedupe log). Phase 44.1 nối trigger cho boss spawn / mail mới /
> daily reminder (stamina full vẫn TODO Phase 44.2 — cần stamina state
> machine wire).

## 1. Modules

| File | Vai trò |
|---|---|
| `apps/api/src/modules/web-push/web-push.service.ts` | Low-level: subscribe / unsubscribe / preference / send (qua VAPID) / dedupe log. |
| `apps/api/src/modules/web-push/web-push-trigger.service.ts` | **Phase 44.1** — high-level composer: `notifyBossSpawn` / `notifyMailNew` / `notifyStaminaFull` / `runDailyReminder`. |
| `apps/api/src/modules/web-push/web-push-daily-reminder.scheduler.ts` | **Phase 44.1** — cron `runOnce(nowMs?)` chỉ fire khi `getUTCHours() === WEB_PUSH_DAILY_REMINDER_HOUR_UTC`. In-memory `lastDispatchedDateKey` guard. |
| `apps/api/src/modules/web-push/web-push.controller.ts` | Player endpoint `/web-push/subscribe`, `/web-push/preferences`, `/web-push/test`. |

## 2. Preferences

Mặc định OFF cho mọi trigger trừ `MAIL_ENABLED` (xem
`DEFAULT_WEB_PUSH_PREFERENCES`):

| Field | Default | Mục đích |
|---|---|---|
| `bossSpawnEnabled` | `false` | World boss spawn. |
| `mailEnabled` | `true` | Mail mới (system gift, GM gift, quest reward). |
| `staminaFullEnabled` | `false` | Stamina (thể lực) hồi đầy. **TODO Phase 44.2** — chưa wire vào stamina runtime. |
| `dailyReminderEnabled` | `false` | Daily reminder cron `runOnce` ngày. |
| `quietHoursStart` / `quietHoursEnd` | `null` | UTC giờ-phút mute window. |

Player set qua `PATCH /web-push/preferences`. Service áp dụng:

- Validate flag (`pushEnabled` env) — tắt → mọi trigger short-circuit.
- Check `quietHours` — nếu rơi vào quiet window → skip + log `QUIET_HOURS`.

## 3. Dedupe & cooldown

**Bảng `WebPushSendLog`**:

| Column | Index | Mục đích |
|---|---|---|
| `userId` | `(userId, type)` UNIQUE | 1 user × 1 trigger type ↦ 1 row. |
| `type` | `WebPushSendType` enum | `BOSS_SPAWN` / `MAIL_NEW` / `STAMINA_FULL` / `DAILY_REMINDER`. |
| `dedupeKey` | — | `boss:{bossId}` / `mail:{mailId}` / `daily-reminder:{dateKey}`. Match → no-op. |
| `lastSentAt` | — | Cooldown check (per type, e.g. `BOSS_SPAWN` ≥ 30s gap). |
| `lastStatus` | — | `SENT` / `FAILED` / `DISABLED` / `QUIET_HOURS` / `DRY_RUN`. |

**Cooldown** (per user × per type):

| Type | Min gap | Note |
|---|---|---|
| `BOSS_SPAWN` | 30s | Tránh spam khi cron auto-spawn nhiều boss liền. |
| `MAIL_NEW` | 5s | Hạn chế burst (mail hệ thống bulk send). |
| `STAMINA_FULL` | — | Chưa wire — sẽ cần 1h tối thiểu. |
| `DAILY_REMINDER` | 1 ngày | In-scheduler guard + dedupeKey. |

## 4. Triggers (Phase 44.1)

### 4.1. Boss spawn

`BossService.spawnBoss(bossDef)` → `WebPushTriggerService.notifyBossSpawn({id,
bossKey, name, level, regionKey})` →

1. Query users có `bossSpawnEnabled = true` + subscription active.
2. Per user: check dedupe (`boss:{bossId}`) + cooldown → skip nếu trùng.
3. Send `{title: 'Boss {name} xuất hiện!', body: 'Level {level} tại
   {regionVi}'}` qua `sendToUser()`.
4. Update `WebPushSendLog (userId, type=BOSS_SPAWN)` qua `upsert`.

**Fail-soft**: `Optional inject` ở `BossService` — test bootstrap không
phải bind `WebPushTriggerService`. Push fail → log warning, không
crash spawn.

### 4.2. Mail new

`MailService.sendMail({userId, mail})` → `WebPushTriggerService.notifyMailNew({userId,
mailId, subject, senderName})` →

1. Check preference `mailEnabled = true`.
2. Dedupe `mail:{mailId}`.
3. Send `{title: 'Bạn có mail từ {senderName}', body: '{subject}'}`.

**Fail-soft**: same pattern.

### 4.3. Daily reminder cron

`WebPushDailyReminderScheduler.runOnce(nowMs?)` →

1. `getUTCHours(nowMs) === WEB_PUSH_DAILY_REMINDER_HOUR_UTC` (default `12`)
   → tiếp tục, ngược lại → `{skipped: true, reason: 'HOUR_GATE'}`.
2. In-memory `lastDispatchedDateKey === todayKey` → `{skipped: true,
   reason: 'ALREADY_DISPATCHED'}`.
3. Gọi `WebPushTriggerService.runDailyReminder({dateKey: todayKey})` →
   query users `dailyReminderEnabled = true` + dedupe `daily-reminder:{dateKey}`.
4. Update `lastDispatchedDateKey` sau khi send xong.

**Cron schedule**: gắn qua NestJS `@Cron('0 * * * *')` (hourly) — scheduler
tự skip nếu ngoài target hour.

### 4.4. Stamina full (TODO Phase 44.2)

Adapter `WebPushTriggerService.notifyStaminaFull({userId})` đã có nhưng
stamina runtime CHƯA emit event này. Cần wire vào stamina tick state
machine ở Phase 44.2.

## 5. Tests

| # | Test | Where |
|---|---|---|
| 1 | Boss spawn opt-in user nhận push | `web-push-trigger.service.test.ts` |
| 2 | Boss spawn opt-out user KHÔNG nhận | `web-push-trigger.service.test.ts` |
| 3 | Boss dedupe — cùng bossId lần 2 → 0 send | `web-push-trigger.service.test.ts` |
| 4 | Mail opt-in nhận push + dedupe `mail:{mailId}` | `web-push-trigger.service.test.ts` |
| 5 | Daily reminder cron cùng `dateKey` → lần 2 0 send | `web-push-trigger.service.test.ts` |
| + | `pushEnabled = false` → notifyBossSpawn không crash | (fail-soft) |
| + | Scheduler `runOnce` skip ngoài target hour | (hour-gate) |
| + | Scheduler `runOnce` 2× cùng ngày → lần 2 skipped | (in-memory guard) |

## 6. Risks & follow-ups

- **VAPID key**: production cần `WEB_PUSH_VAPID_PUBLIC_KEY` /
  `WEB_PUSH_VAPID_PRIVATE_KEY` / `WEB_PUSH_VAPID_SUBJECT`. Thiếu →
  service throw, controller fail-soft return `DISABLED`.
- **Gateway retry**: hiện tại không retry, fail → log + `lastStatus =
  FAILED`. Phase 44.2 có thể thêm exponential backoff.
- **Stamina trigger**: TODO wire vào stamina state machine.
- **In-memory guard mất khi restart**: `lastDispatchedDateKey` chỉ
  in-memory — nếu API restart đúng target hour có thể fire lại. DedupeKey
  `daily-reminder:{dateKey}` vẫn cover ở `WebPushSendLog` layer.
