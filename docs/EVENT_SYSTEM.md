# Event System V2 — Phase 28.0

> **Trạng thái**: PR2 (`phase-28-0-event-builder-tier-balanced-liveops`, PR #559).
> **Scope**: runtime-configurable event scheduler, tier-balanced brackets, anti-P2W validators, mission/shop/ranking/boss/personal milestone subsystems.

---

## 1. Lifecycle & Status Machine

`EventStatus` (`packages/shared/src/events.ts` §EventStatus) có 9 trạng thái với transition map server-authoritative trong `EventService.transition()`:

```
DRAFT ──► SCHEDULED ──► ACTIVE ──► PAUSED ──┐
                          │     │           │
                          │     ▼           │
                          │   REWARD_LOCKED │
                          │     │           ▼
                          ▼     ▼          ENDED ──► FINALIZED ──► ARCHIVED
                          ────────────────► ENDED
                          
DRAFT/SCHEDULED ──► CANCELLED (admin only, HIGH risk)
```

- **DRAFT**: admin biên tập, KHÔNG hiện cho player.
- **SCHEDULED**: đã có `startsAt`/`endsAt` hợp lệ, KHÔNG mở mission/shop.
- **ACTIVE**: player có thể nhận mission, claim reward, mua shop, submit score ranking.
- **PAUSED**: tạm dừng (vd hotfix economy). Mission progress giữ nguyên, shop khoá.
- **REWARD_LOCKED**: ngừng grant reward mới nhưng vẫn đếm score (finalize sắp diễn ra).
- **ENDED**: hết `endsAt`. Mission/shop khoá hoàn toàn. Chờ finalize.
- **FINALIZED**: ranking đã chốt + reward đã grant theo bracket. Read-only.
- **ARCHIVED**: ẩn khỏi UI nhưng giữ data để audit.
- **CANCELLED**: huỷ chính thức, KHÔNG grant reward.

Transition map enforced bởi `STATUS_TRANSITIONS` trong `event.service.ts` — admin KHÔNG thể nhảy bước (vd ACTIVE→FINALIZED phải qua ENDED).

---

## 2. Bracket-Based Tier Isolation

### 2.1 Realm tier bracket

`realmTierForEventBracket(realmOrder)` trong shared chia 9 cảnh giới gốc thành 9-tier bracket (T1 cho Luyện Khí → T9 cho Đại Năng). Admin tạo bracket cho event với:

- `bracketTier`: 1..9
- `minRealmOrder` / `maxRealmOrder`: phạm vi realm gán vào bracket
- `name` / `description` / `tokenMultiplier` (giảm điểm dụ thấp đua bậc thấp)

### 2.2 `computePlayerContext`

`BracketService.computePlayerContext(eventKey, realmOrder, playerTier)` resolve runtime context cho từng player:

```ts
{
  bracket: EventBracketDef | null;
  bracketTier: number | null;
  rewardTier: min(playerTier, bracketTier, eventMaxTier);
  tokenMultiplier: number;     // áp dụng cho event token grant
  rankingEligible: boolean;    // false nếu high-tier rơi vào low-bracket
}
```

**Core invariant**: `rewardTier = min(playerTier, bracketTier, eventMaxTier)`. Tier cap ngăn:

1. High-tier rớt vào low-bracket → reward bị clamp xuống bracketTier.
2. Low-tier participate event high-tier → reward bị clamp xuống playerTier (chứ không phải eventMaxTier).
3. Admin tạo event sourceTier T1 nhưng đặt rewardTier T9 → blocked bởi `validateEventDef`.

### 2.3 `BracketMode`

- `REALM_TIER`: tự gán theo realmOrder (default).
- `MANUAL`: admin set thủ công trên player (vd guild event, sect event).
- `OPEN`: KHÔNG bracket — chỉ dùng cho event one-shot không có ranking.

---

## 3. Mission, Shop, Boss, Ranking, Personal

### 3.1 Mission (EventMissionDef)

3 `EventMissionResetType`:

- **DAILY**: cycleId = `UTC YYYYMMDD`.
- **WEEKLY**: cycleId = ISO week (year-week).
- **EVENT_ONCE**: cycleId = `static` — claim 1 lần duy nhất.

`EventMissionService.increment(missionKey, characterId, delta)` cập nhật `progressValue` theo cycleId hiện tại. `.claim()` idempotent (CAS `claimedAt`).

### 3.2 Shop (EventShopDef + EventShopItemDef)

Token currency tự định nghĩa per event (`tokenCurrencyKey`). Item có 3 cap:

- `purchaseLimitDaily` (period bucket UTC YYYYMMDD)
- `purchaseLimitWeekly` (ISO week)
- `purchaseLimitEvent` (per characterId per event lifetime)

`EventShopService.purchase` enforce:

1. Event phải ACTIVE.
2. Bracket guard: nếu item có `requiredBracketKey`, player phải thuộc bracket đó.
3. Realm guard: `minRealmOrder` ≤ player.realmOrder ≤ `maxRealmOrder`.
4. Token balance đủ.
5. Cap check qua `EventShopPurchase` model (UNIQUE per period).

### 3.3 Boss (EventBossDef)

7 `EventBossType`: `DAILY_BOSS`, `WEEKLY_BOSS`, `OPEN_WORLD`, `INSTANCED`, `SECT_BOSS`, `COOP_RAID`, `WORLD_BOSS`.

`EventBossService` PR1 ships skeleton; full combat wire ở PR sau (tích hợp với existing `BossService` + `combat.service`).

### 3.4 Ranking (EventRankingDef)

5 `EventRankingType`: `DAMAGE`, `KILL_COUNT`, `MISSION_SCORE`, `WEALTH_GAINED`, `PROGRESS_SCORE`.

`EventRankingService`:

- `.submitScore(rankingKey, characterId, score, bracketKey)` — incremental update.
- `.leaderboard(rankingKey, { bracketKey, limit })` — top N per bracket.
- `.finalize(rankingKey)` — idempotent, compute rank, set `finalized=true`. Reward distribute qua existing `RewardProfile` per bracket.

### 3.5 Personal Milestone (PersonalMilestoneEventDef)

5 `PersonalEventTriggerType`: `REALM_REACHED`, `LEVEL_REACHED`, `SECT_RANK_REACHED`, `EQUIP_TIER_REACHED`, `FIRST_TIME_CLEAR`.

`EventPersonalMilestoneService.trigger(characterId, triggerType, triggerValue)` idempotent — chỉ insert nếu chưa có active row. Auto-expire sau `durationDays`. `.claim()` enforce `completedAt != null && claimedAt == null`.

---

## 4. Anti-P2W Validators (Forbidden Actions)

Áp dụng từ spec PHẦN 18:

1. **KHÔNG** tích hợp thanh toán thật mới nếu chưa có yêu cầu rõ ràng. Event token mua qua existing wallet currencies.
2. **KHÔNG** event tạo runtime code. Admin nhập JSON config — server validate qua `validateEventDef`/`validateEventReward`.
3. **KHÔNG** cho admin nhập SQL/script. UI chỉ render text input → zod validate → Prisma upsert.
4. **KHÔNG** cho event reward bypass ledger. Mọi grant đi qua `RewardProfile` + audit log.
5. **KHÔNG** bán công pháp/pháp bảo top vô hạn. Forbidden item list trong `EVENT_FORBIDDEN_ITEMS`.
6. **KHÔNG** cho ranking chung raw damage làm reward chính (vì high-tier dominate). Score normalization qua `EventBalancePolicy.rankingNormalizationKey`.
7. **KHÔNG** tạo token farm vô hạn. Token issuance gated by mission cap + bracket multiplier.
8. **KHÔNG** bỏ cap cho premium. Premium chỉ unlock extra slots/lượt convenience, KHÔNG bypass cap event.

---

## 5. Audit & Permissions

- 18 `EVENT_*` AdminActionType trong `admin-control-center.ts` (xem `ADMIN_ACTION_TYPES`).
- Risk levels: CREATE/UPDATE = MEDIUM, DELETE/ACTIVATE/LOCK_REWARDS/FINALIZE/CANCEL = HIGH, ARCHIVE = LOW.
- Tất cả admin endpoint gated bởi `@RequireAdminPermission(ADMIN_MANAGE_EVENTS)`.
- Audit ghi qua `AdminAuditWriter.write({ actionType, targetType: 'EVENT', targetId: key, riskLevel, reason, beforeJson, afterJson })`.

---

## 6. API Endpoints

### 6.1 Admin (`/admin/events/*`)

```
GET    /admin/events/catalog
GET    /admin/events/templates
GET    /admin/events/templates/:templateKey
GET    /admin/events
GET    /admin/events/:key
POST   /admin/events                       (create)
POST   /admin/events/validate
POST   /admin/events/:key                  (update)
DELETE /admin/events/:key
POST   /admin/events/:key/transition

GET    /admin/events/:key/brackets
POST   /admin/events/:key/brackets
GET    /admin/events/:key/policy
POST   /admin/events/:key/policy

GET    /admin/events/:key/missions
POST   /admin/events/:key/missions
GET    /admin/events/:key/shops
POST   /admin/events/:key/shops
POST   /admin/events/shop-items
GET    /admin/events/:key/bosses
POST   /admin/events/:key/bosses
GET    /admin/events/:key/rankings
POST   /admin/events/:key/rankings
POST   /admin/events/rankings/:rankingKey/finalize

GET    /admin/events/items
POST   /admin/events/items
```

### 6.2 Player (`/events/*`)

```
GET    /events                              (list public events, bracket-filtered)
GET    /events/:key                         (detail + playerCtx)
GET    /events/:key/missions                (mission defs + progress)
POST   /events/:key/missions/claim          (idempotent claim)
GET    /events/:key/shops                   (shop list)
GET    /events/shops/:shopKey/items         (item list)
POST   /events/shops/purchase               (purchase with token + limit check)
GET    /events/rankings/:rankingKey/leaderboard  (top per bracket)
GET    /events/personal/list                (active personal events)
POST   /events/personal/:rowId/claim        (idempotent personal claim)
```

---

## 7. Pending PRs

- **Form editor admin đầy đủ**: editor UI cho từng tab (bracket / balance / mission / shop / boss / ranking / item / personal) thay vì read-only list hiện tại.
- **Seed script preset**: thêm `apps/api/prisma/seed-events.ts` để admin chạy `pnpm prisma db seed` tạo 5 event mẫu sẵn (login 7 ngày, sect war event, double drop daily, personal milestone Trúc Cơ, world boss event).
- **WS broadcast event status**: phát frame `event:status` khi admin transition để client refresh real-time.
- **Combat wire boss**: tích hợp `EventBoss` với `BossService.startEncounter` để player đánh boss event.
- **Reward grant runtime**: implement `EventRewardGrantService` tích hợp `RewardProfileService.applyReward()` với clamp `rewardTier`.

---

## 8. References

- Spec gốc: `Cau_lenh_Phase_28_0_Event_Builder_Tier_Balanced_LiveOps.docx` (user attachment).
- Shared types: `packages/shared/src/events.ts`.
- Tests: `packages/shared/src/events.test.ts` (85 test).
- Migration: `apps/api/prisma/migrations/20280101000000_phase_28_0_event_builder/migration.sql`.
- API: `apps/api/src/modules/event-builder/`.
- Web: `apps/web/src/views/{AdminEventBuilderView,EventsView}.vue`.
- Admin perms: `packages/shared/src/admin-control-center.ts` (look for `EVENT_*` action types).
- Live ops doc: `docs/LIVE_OPS_MODEL.md` (sẽ extend với section 28.0 ở PR docs riêng).
