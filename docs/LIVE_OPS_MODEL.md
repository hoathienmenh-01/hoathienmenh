# Xuân Tôi — Live Ops Model

> **Status**: Long-term live-ops blueprint. Source of truth cho **runtime config** + **event scheduler** + **maintenance** + **feature flag** + **announcement**.
> Code on `main` là source of truth cho hành vi runtime hiện tại.
> Sister docs: [`GAME_DESIGN_BIBLE.md`](./GAME_DESIGN_BIBLE.md), [`LONG_TERM_ROADMAP.md`](./LONG_TERM_ROADMAP.md), [`ECONOMY_MODEL.md`](./ECONOMY_MODEL.md).

Mục tiêu: admin có thể vận hành event, ra thông báo, bật/tắt feature, bảo trì server **mà không cần deploy code**.

---

## 1. WHY LIVE OPS?

Game live-service phải thay đổi liên tục theo **mùa thực + mùa game + sự kiện**:

- Tết, Trung Thu, Lễ Vu Lan → event flavor cổ phong.
- Reset season arena cuối tháng.
- Bảo trì gấp khi phát hiện bug.
- A/B test chỉnh dial balance.
- Rollback config nhanh khi phát hiện exploit.

Nếu mọi thay đổi cần deploy → cycle quá chậm + risk cao. Live ops giải quyết bằng cách **separate config from code**.

---

## 2. CURRENT STATE (hiện trạng)

| Thành phần | Có / Không |
|---|---|
| EventConfig DB-backed | ❌ |
| Announcement WS broadcast | ❌ |
| Maintenance window | ❌ |
| FeatureFlag | ❌ |
| Admin scheduler UI | ❌ |
| Mail batch send | Manual 1-by-1 |
| GiftCode | ✅ (admin tạo, player redeem) |
| Topup approve manual | ✅ |
| Cron (BullMQ) | ✅ (cultivation tick + cleanup + mission reset) |
| Admin audit log | ✅ |

Phase 15 sẽ thêm phần lớn live-ops infra ở table trên.

---

## 3. EVENT SCHEDULER

### 3.1 EventConfig model (phase 15)

```prisma
enum EventKind {
  DAILY_LOGIN_BOOST
  DOUBLE_DROP_DUNGEON
  REDUCED_REFINE_FAIL
  TAX_FREE_MARKET
  LOGIN_REWARD_PACK
  CULTIVATION_BOOST
  BOSS_HUNT_FESTIVAL
  CUSTOM
}

enum EventStatus {
  DRAFT
  SCHEDULED
  ACTIVE
  ENDED
  CANCELLED
}

model EventConfig {
  id              String       @id @default(cuid())
  key             String       @unique
  nameVi          String
  nameEn          String
  descriptionVi   String       @default("")
  descriptionEn   String       @default("")
  kind            EventKind
  /// JSON: tunable per kind. E.g. DAILY_LOGIN_BOOST → { multiplier: 2 }.
  configJson      Json         @default("{}")
  status          EventStatus  @default(DRAFT)
  startsAt        DateTime
  endsAt          DateTime
  createdByAdminId String
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  cancelledByAdminId String?
  cancelledAt     DateTime?

  progress        EventProgress[]
  rewardClaims    EventRewardClaim[]

  @@index([status, startsAt, endsAt])
  @@index([kind, status])
}

model EventProgress {
  id           String       @id @default(cuid())
  eventId      String
  event        EventConfig  @relation(fields: [eventId], references: [id], onDelete: Cascade)
  characterId  String
  /// JSON: progress per kind.
  progressJson Json         @default("{}")
  updatedAt    DateTime     @updatedAt

  @@unique([eventId, characterId])
  @@index([characterId, eventId])
}

model EventRewardClaim {
  id          String   @id @default(cuid())
  eventId     String
  characterId String
  /// Tier of reward claimed (e.g. 1..N) hoặc 'COMPLETE'.
  tier        String
  claimedAt   DateTime @default(now())

  @@unique([eventId, characterId, tier])
  @@index([characterId, claimedAt])
}
```

### 3.2 Validation rules

- `startsAt < endsAt`.
- 2 event cùng `kind` không overlap (e.g. không 2 DOUBLE_DROP_DUNGEON cùng lúc).
- Event `ACTIVE` không edit `kind`/`startsAt` — phải cancel + create lại.
- Admin scheduler UI enforce + service-side validate.

### 3.3 Lifecycle

```
DRAFT → SCHEDULED → ACTIVE → ENDED
          ↓             ↓
       CANCELLED    CANCELLED
```

- DRAFT: admin đang soạn, không ảnh hưởng game.
- SCHEDULED: chờ `startsAt`. Cron `event-lifecycle-job` chuyển sang ACTIVE khi tới giờ.
- ACTIVE: hiển thị game, ảnh hưởng player.
- ENDED: cron chuyển khi `endsAt` qua. Reward claim window mở thêm 7 ngày.
- CANCELLED: admin tắt giữa chừng. Reward claim window đóng.

### 3.4 Apply mechanism

Event impact game qua "modifier" tại runtime:

```ts
// pseudocode
const activeEvents = await getActiveEvents();
const dropMultiplier = activeEvents
  .filter(e => e.kind === 'DOUBLE_DROP_DUNGEON')
  .reduce((acc, e) => acc * (e.configJson.multiplier ?? 2), 1);

const drops = rollDungeonLoot(dungeonKey).map(d => ({
  ...d,
  qty: Math.round(d.qty * dropMultiplier),
}));
```

Cache `getActiveEvents()` trong Redis 30s TTL.

### 3.5 Reward claim

Player tham gia event:
1. Progress tích luỹ (e.g. boss hunt festival → kill 3 boss).
2. Endpoint `POST /api/events/:eventId/claim/:tier` → check `EventRewardClaim` chưa exist → grant reward → ghi ledger + claim row.
3. Idempotent qua unique `(eventId, characterId, tier)`.

### 3.6 Common event recipes

| Recipe | Kind | Config | Use case |
|---|---|---|---|
| Tết — bao lì xì | LOGIN_REWARD_PACK | `{ pack: [{ tier: 1, item: 'li_xi_xuan' }, ...] }` | Tết âm lịch |
| Trung thu — săn yêu | BOSS_HUNT_FESTIVAL | `{ requiredKills: 5, rewardKey: 'trung_thu_2026' }` | Trung thu |
| Cuối tuần boost | CULTIVATION_BOOST | `{ multiplier: 1.5 }` | Mỗi cuối tuần |
| Phường thị khai hội | TAX_FREE_MARKET | `{ taxOverride: 0 }` | 24h promo |
| Đôi sự kiện | DOUBLE_DROP_DUNGEON | `{ multiplier: 2, dungeonKeys: ['son_coc', 'hac_lam'] }` | Promo |

---

## 4. ANNOUNCEMENT

### 4.1 Model

```prisma
enum AnnouncementLevel {
  INFO
  WARN
  CRITICAL
}

model Announcement {
  id              String              @id @default(cuid())
  messageVi       String
  messageEn       String
  level           AnnouncementLevel   @default(INFO)
  startsAt        DateTime            @default(now())
  endsAt          DateTime
  createdByAdminId String
  createdAt       DateTime            @default(now())

  @@index([startsAt, endsAt])
}
```

### 4.2 Delivery

- WS event `announcement:show` push tới mọi online user khi `startsAt` đến.
- HTTP fallback: `GET /api/announcements/active` cho user mới connect.
- FE: marquee bar top hoặc toast persistent.

### 4.3 Use case

- Maintenance warning (15p trước khi maintenance).
- World boss spawn marquee.
- Event start/end notify.
- Critical bug warning.

### 4.4 Rate limit

- Admin tạo ≤ 5 announcement/giờ (ngăn spam tự gây ra).
- Announcement CRITICAL level cần 2 admin co-sign (phase 16 — dùng `AdminAuditLog` 2-step).

---

## 5. MAINTENANCE WINDOW

### 5.1 Model

```prisma
enum MaintenanceMode {
  READONLY      // user login OK, không thể mutate (chat, market, claim)
  FULL          // toàn bộ /api/* trả 503 trừ /healthz + /readyz + /admin
}

model MaintenanceWindow {
  id              String           @id @default(cuid())
  mode            MaintenanceMode  @default(FULL)
  messageVi       String
  messageEn       String
  startsAt        DateTime
  endsAt          DateTime
  createdByAdminId String
  createdAt       DateTime         @default(now())
  cancelledAt     DateTime?

  @@index([startsAt, endsAt])
}
```

### 5.2 Middleware

Mỗi request đi qua middleware check:

```ts
const active = await getActiveMaintenance();
if (active) {
  if (req.path.startsWith('/api/healthz')) return next();
  if (req.path.startsWith('/api/readyz')) return next();
  if (req.path.startsWith('/api/admin')) return next();  // admin vẫn login để tắt window
  if (active.mode === 'READONLY' && req.method === 'GET') return next();
  return res.status(503).json({
    ok: false,
    error: { code: 'MAINTENANCE', message: locale === 'vi' ? active.messageVi : active.messageEn },
  });
}
```

### 5.3 FE UX

- Banner đỏ trên top.
- Modal popup khi mode FULL.
- Disable mọi nút mutate (chat, claim, list, ...).

### 5.4 Cron tự kết thúc

Cron `maintenance-lifecycle-job` mỗi 30s check `endsAt` → set `cancelledAt = now()` nếu hết hạn.

### 5.5 Pre-maintenance checklist

Trước khi ENABLE maintenance:
1. Tạo Announcement WARN 15p trước.
2. Pause cron `cultivation-tick` (để không cộng EXP "lỗi" trong window).
3. Snapshot DB backup.
4. Apply migration / fix.
5. Smoke test trên staging.
6. Cancel maintenance window.
7. Tạo Announcement INFO "Bảo trì hoàn tất".

---

## 6. FEATURE FLAG

### 6.1 Model

```prisma
enum FeatureFlagScope {
  GLOBAL
  ROLE
  USER
  CHARACTER
}

model FeatureFlag {
  id              String              @id @default(cuid())
  key             String              @unique
  enabled         Boolean             @default(false)
  scope           FeatureFlagScope    @default(GLOBAL)
  /// JSON: scope-specific. E.g. { roles: ['ADMIN'] } cho ROLE; { userIds: [...] } cho USER.
  scopePayload    Json                @default("{}")
  description     String              @default("")
  createdByAdminId String
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  @@index([key, enabled])
}
```

### 6.2 Service

```ts
interface FlagContext {
  userId?: string;
  characterId?: string;
  role?: 'PLAYER' | 'MOD' | 'ADMIN';
}

async isEnabled(key: string, ctx: FlagContext = {}): Promise<boolean>
```

Cache Redis 30s TTL (key: `ff:<flagKey>`). Invalidate khi admin update.

### 6.3 Use case

- Soft launch module (e.g. arena season chỉ enable cho 10% user trước public).
- Kill switch khẩn cấp (e.g. tắt market khi phát hiện exploit).
- A/B test (chia user theo userId hash).
- Internal alpha test (enable chỉ cho `ADMIN` role).

### 6.4 Naming convention

- snake_case: `feature_arena_season`, `feature_market`, `feature_battle_pass`.
- Module prefix: `module_<name>` cho whole module on/off.
- Experimental prefix: `exp_<name>` cho A/B.

### 6.5 Default behavior

- Flag không tồn tại → `false` (fail-safe).
- Module flag default `true` cho production stable, `false` cho dev/experimental.

---

## 7. CONFIG VERSION

### 7.1 Mục đích

Mọi thay đổi config (FeatureFlag, EventConfig, BalanceDial admin override) snapshot lưu để rollback nhanh.

### 7.2 Model

```prisma
enum ConfigKind {
  FEATURE_FLAG
  EVENT_CONFIG
  BALANCE_DIAL
  MARKET_PRICE_BAND
  ECONOMY_DIAL
}

model ConfigVersion {
  id              String      @id @default(cuid())
  kind            ConfigKind
  /// Reference key (e.g. flagKey, eventKey, dialKey).
  refKey          String
  /// Full payload at this version.
  payloadJson     Json
  createdByAdminId String
  createdAt       DateTime    @default(now())

  @@index([kind, refKey, createdAt])
}
```

### 7.3 Workflow

- Mỗi update config → service tạo `ConfigVersion` row trước khi apply.
- Admin UI có "Rollback to previous version" nút.
- Rollback = đọc `ConfigVersion` cũ + apply lại + tạo `ConfigVersion` mới với note "rollback from X".

---

## 8. ADMIN OPS DASHBOARD

### 8.1 Tabs hiện tại (Phase 8)

- Overview (alerts).
- Users (filter q/role/banned).
- Topups (filter q/status/from/to).
- Audit (filter action/q).
- GiftCodes.
- Mail.
- Boss.

### 8.2 Tabs phase 15+ (live ops)

- **Events**: list + create + edit + cancel.
- **Announcements**: list + create + cancel.
- **Maintenance**: schedule + active + cancel.
- **Feature Flags**: list + toggle + edit scope.
- **Config Versions**: rollback.
- **Economy**: report + anomaly review (phase 16).
- **Sect**: sect war season management (phase 13).
- **Arena**: arena season management (phase 14).

### 8.3 Permission

| Tab | MOD | ADMIN | Super-admin |
|---|---|---|---|
| Overview | ✅ | ✅ | ✅ |
| Users (view) | ✅ | ✅ | ✅ |
| Users (ban/grant) | ❌ | ✅ | ✅ |
| Topups (review) | ✅ | ✅ | ✅ |
| Topups (approve) | ❌ | ✅ | ✅ |
| Audit | ✅ | ✅ | ✅ |
| GiftCodes (create) | ❌ | ✅ | ✅ |
| Mail (batch send) | ❌ | ✅ | ✅ |
| Boss (spawn) | ❌ | ✅ | ✅ |
| Events | ❌ | ✅ | ✅ |
| Announcements (INFO/WARN) | ❌ | ✅ | ✅ |
| Announcements (CRITICAL) | ❌ | (need 2-co-sign) | ✅ |
| Maintenance | ❌ | ✅ | ✅ |
| Feature Flags | ❌ | ✅ | ✅ |
| Config rollback | ❌ | ✅ | ✅ |
| Economy report | ❌ | ✅ | ✅ |
| Economy anomaly resolve | ❌ | ✅ | ✅ |
| Super-admin only (compromised admin alert mute) | ❌ | ❌ | ✅ |

Phase 16: thêm `SUPER_ADMIN` role hoặc 2-of-N co-sign cho hành động cao rủi ro.

---

## 9. WS EVENT TAXONOMY

### 9.1 Hiện tại

- `cultivate:tick` — push EXP gain mỗi tick.
- `chat:msg` — push chat message.
- `mission:progress` — push mission progress update.

### 9.2 Phase 15+

- `announcement:show` — broadcast announcement.
- `event:start` — event chuyển sang ACTIVE.
- `event:end` — event chuyển sang ENDED.
- `boss:spawn` — boss xuất hiện.
- `boss:hp_update` — HP update (throttle 1/sec).
- `boss:defeated` — boss đã defeat.
- `mail:unread` — mail mới.
- `market:listing_update` — listing mới hoặc bán (rate-limit broadcast).
- `sect:update` — sect-internal event (member join/leave/promote — phase 13).
- `season:start` / `season:end` — season lifecycle.
- `admin:alert` — alert tới admin online (e.g. anomaly detected — phase 16).
- `maintenance:notice` — maintenance window upcoming/active.

### 9.3 Naming convention

- `<resource>:<verb>` snake_case.
- Verb past tense cho event đã xảy ra (`spawned`, `defeated`).
- Verb present cho live state (`tick`, `show`, `update`).

---

## 10. RUNBOOK INTEGRATION

Khi có incident, runbook (xem `docs/RUNBOOK.md` — phase 17) reference:

| Incident | Live ops action |
|---|---|
| Bug critical phát hiện | FeatureFlag tắt module + Announcement CRITICAL + (optional) Maintenance READONLY |
| Exploit market | FeatureFlag `feature_market = false` + admin investigate + tạo Maintenance window khi sửa |
| Topup payment provider down | Announcement WARN "Tạm thời không nạp được" + log support ticket |
| Cultivation tick chạy lệch | Pause cron qua admin UI + investigate + fix + reseed `cultivating` state |
| World boss event abuse | Cancel boss qua admin (phase 12) + revoke ledger reward (manual recompute) |

---

## 11. SEASON ROADMAP (live ops cadence)

### 11.1 Cadence đề xuất

| Cadence | Activity |
|---|---|
| Daily | Daily login reward (đã có), daily mission reset 04:00 (đã có) |
| Weekly | Weekly mission reset Mon 00:00, sect mission reset (phase 13) |
| Monthly | Arena season reset (phase 14), event "month theme" |
| Quarterly | Sect war season (phase 13), battle pass season (phase 15, gated) |
| Yearly | Tết, Trung thu, Quốc khánh, Lễ Vu Lan special events |

### 11.2 Calendar

Phase 15+ admin có view calendar:

```
[2026-04]
W1: --
W2: Event "Phường thị khai hội" (24h, sat)
W3: Sect war season 1 (start)
W4: Battle pass season 3 (start)

[2026-05]
W1: Lễ Lao Động — login pack
W2: --
W3: Sect war season 1 (end)
W4: --
```

### 11.3 Long event (1 tuần+)

Best practice:
- Soft launch: enable cho 10% user qua FeatureFlag scope USER.
- Watch metric 24h.
- Promote 100% nếu OK.
- Cancel ngay nếu metric anomaly.

---

## 12. METRICS & MONITORING

### 12.1 Per-event metric

Track:

- Số character tham gia (có `EventProgress` row).
- Tổng reward grant (qua `CurrencyLedger` filter `reason = EVENT_REWARD`).
- Drop-off (số character bắt đầu vs claim cuối).
- Anomaly (player progress > X% nhanh hơn median).

### 12.2 Per-day metric

Track:

- DAU online concurrent peak.
- Session length avg.
- Daily linhThach in/out.
- Topup volume.
- Mail batch send count.
- GiftCode redeem.
- Maintenance / event active hours.

### 12.3 Dashboard

Phase 17 integrate Grafana / Datadog hoặc admin dashboard 2.0:

- Live tile: CCU (concurrent), error rate, ledger flow.
- Daily trend.
- Weekly comparison.

---

## 13. NEVER-LIST (live ops)

**KHÔNG được**:

- Apply config thay đổi mà không tạo `ConfigVersion`.
- Bypass admin audit log khi tạo/cancel event.
- Push WS event với payload chứa secret hoặc PII.
- Cancel event đang ACTIVE mà không thông báo trước (trừ critical bug).
- Test FeatureFlag trên prod mà không soft launch (10% trước).
- Tạo battle pass / monetization event mà chưa có policy approval.

---

## 13.A. WEEKLY CYCLE AUTOMATION (Phase 13.2.D + 14.0.F)

### 13.A.1 Why

Trước Phase 13.2.D + 14.0.F, mọi vận hành tuần (territory settle, decay, reward mail, sect season snapshot) đều bấm tay qua admin endpoint. Risk:
- Admin quên trigger → reward không tới tay player → trust issue.
- Admin trigger sai `periodKey` → ledger lệch.
- Không có audit-by-default → hard to debug "tuần này có ai trigger chưa?".

Phase này tự động hóa weekly cycle qua BullMQ cron + giữ admin override (force-run) làm safety net.

### 13.A.2 Cron schedule (default)

| Queue | Job | Pattern (default) | Env var | Mô tả |
|---|---|---|---|---|
| `territory-cron` | `weekly-cycle` | `5 0 * * 1` (Mon 00:05 UTC) | `TERRITORY_WEEKLY_SETTLE_CRON` | Settle previous ISO week → decay influence → grant owner reward mail. |
| `sect-season-cron` | `snapshot-due` | `15 0 * * *` (00:15 UTC daily) | `SECT_SEASON_SNAPSHOT_CRON` | Snapshot mọi `SECT_SEASONS` có `endsAtIso ≤ now`. Daily check rẻ vì hầu hết ngày skip nhanh. |

Bật/tắt qua `TERRITORY_CRON_ENABLED` / `SECT_SEASON_CRON_ENABLED` (default `false` để local/test KHÔNG auto-register). Timezone qua `TERRITORY_CRON_TZ` (default `UTC`).

### 13.A.3 Idempotency + race-safety design

**3-layer guard** (defense in depth):

1. **Optimistic Redis lease** (`LIVEOPS_CRON_LEASE_TTL_SEC`, default 300s):
   - `SET NX EX` để claim leader; Lua compare-and-delete để release.
   - 2 node race → chỉ 1 acquire lease → còn lại trả `skippedAlreadyDone=true` ngay.
   - Fail-open: nếu Redis vắng (test/dev), lease no-op → DB guard quyết.
2. **DB UNIQUE constraints** (final source of truth):
   - `SectTerritorySettlementSnapshot` UNIQUE `(regionKey, periodKey)`.
   - `SectTerritoryDecayLog` UNIQUE `(periodKey)`.
   - `TerritoryOwnerRewardGrant` UNIQUE `(periodKey, regionKey, characterId)`.
   - `SectSeasonSnapshot` UNIQUE `seasonKey`.
   - Tất cả P2002 swallow → trả existing → idempotent.
3. **Fail-soft errors**: stage failure (e.g., decay throw) push vào `errors[]` KHÔNG block stage còn lại. Caller (cron hoặc admin) thấy partial summary để retry phần fail.

### 13.A.4 Admin force-run

Vẫn giữ override để debug/recover:

- `POST /admin/liveops/run-weekly-cycle` — combo (territory + sect season).
- `POST /admin/territory/cron/run-now` — chỉ territory.
- `POST /admin/sect-season/cron/run-now` — chỉ sect season.

Body `{ periodKey?, bypassLease? }`. `bypassLease=true` chỉ admin được dùng (skip Redis lease — chấp nhận double-attempt vì DB UNIQUE bảo vệ). Audit log `ADMIN_LIVEOPS_RUN_WEEKLY_CYCLE` / `ADMIN_TERRITORY_CRON_RUN` / `ADMIN_SECT_SEASON_CRON_RUN` (no secret meta).

FE: AdminLiveOpsPanel có section "Chu kỳ tuần (Cron)" — input `periodKey`, checkbox `bypassLease`, button "Chạy chu kỳ tuần", summary line + fail-soft errors.

### 13.A.5 Observability

Logger format: `runTerritoryCycle done period=<key> settled=N skipped=N decaySkipped=B decayDelta=N mails=N alreadyGranted=N errors=N` — easy grep cho production debug. KHÔNG log secret.

### 13.A.6 Deferred — sect season reward distribution

Snapshot history + Hall of Fame KHÔNG auto-grant reward (currency/title/buff) vì design chưa đủ rõ. TODO comment ở `liveops-cron.service.ts` block `runSectSeasonCycle()`. Phase tiếp theo (Phase 13.2.E?) sẽ wire reward distribution sau khi design pass riêng.

---

## 14. CHANGELOG

- **2026-04-30** — Initial creation. Author: Devin AI session 9q.
- **2026-05-09** — Phase 13.2.D + 14.0.F: weekly cycle automation cron (§13.A). Author: Devin AI.
