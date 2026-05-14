# Gameplay Follow-up Integration Sweep — Phase 44.1

> **Status**: Phase 44.1 (PR #591) — Web Push triggers + Pet preview/cap +
> Onboarding auto-track + Daily Encounter cap/dedupe + Secret Realm
> cooldown/daily-limit/active-run guard. **Không** thêm hệ mới — chỉ
> nối sâu các module đã có nền sẵn (Phase 35.0 / 37.x / 38.x / 40.x).

## 1. Goals

Phase 44.1 đóng vai trò "integration sweep" — quét lại các module đã build
nhưng chưa nối sâu vào gameplay thật, và nối trigger / cap / guard cần
thiết để các hệ này hoạt động đúng spec mà KHÔNG mở thêm bề mặt mới:

- **Web Push**: trigger thật từ boss spawn / mail mới / stamina full /
  daily reminder cron — chống spam, dedupe, fail-soft.
- **Pet / Linh Thú**: preview adapter cho UI + cap đóng góp (PvE/PvP/Boss)
  + audit rare drop policy. **KHÔNG** sửa formula combat.
- **Onboarding 7 ngày**: auto-track từ hành động thật thay vì "bấm báo
  cáo" — Day 7 unlock title qua `TitleService` thật.
- **Daily Encounter / Kỳ Ngộ**: reward cap, ledger entry, chống spam
  claim song song, daily cap (1 encounter / UTC day).
- **Secret Realm / Bí Cảnh**: cooldown / daily limit / active-run guard /
  reward cap / claim idempotent / chống spam enter+claim song song.

## 2. Subsystems

### 2.1. Web Push triggers

**Module**: `apps/api/src/modules/web-push/`

- `WebPushTriggerService` (mới Phase 44.1) — composer cấp cao gom các
  trigger gameplay (boss/mail/stamina/daily) thành 1 surface duy nhất.
- `WebPushService` (đã có) — lower-level send + preference + dedupe log
  (`WebPushSendLog`).
- `WebPushDailyReminderScheduler` (Phase 44.1) — cron-style scheduler;
  `runOnce(nowMs?)` chỉ fire khi `Date.now().getUTCHours() ===
  WEB_PUSH_DAILY_REMINDER_HOUR_UTC` (default `12`). In-memory `lastDispatchedDateKey`
  guard tránh re-fire cùng ngày.

**Wire vào gameplay**:

- `BossService.spawnBoss()` → `webPushTrigger?.notifyBossSpawn({...})` —
  broadcast cho mọi user `bossSpawnEnabled = true`. Optional inject để
  test bootstrap không phải bind.
- `MailService.sendMail()` → `webPushTrigger?.notifyMailNew({userId,
  mailId, ...})` — gửi cho riêng user nhận mail nếu `mailEnabled = true`.
- `WebPushDailyReminderScheduler` — gắn vào NestJS schedule
  registry; fire hourly, skip nếu ngoài target hour hoặc đã fire hôm nay.

**Dedupe**:

- `WebPushSendLog (userId, type) UNIQUE` — mỗi user×type ↦ 1 row.
- `dedupeKey` per event (`boss:{bossId}`, `mail:{mailId}`,
  `daily-reminder:{dateKey}`) so sánh trước khi gửi — duplicate → no-op.

**Fail-soft**:

- `pushEnabled` env gate. Tắt → mọi trigger short-circuit, không crash.
- Push gateway throws → log warning, không bắn lên caller.
- Validation lỗi (endpoint/key) → đánh dấu `lastStatus = FAILED`, không
  retry.

### 2.2. Pet / Linh Thú deep wiring

**Module**: `apps/api/src/modules/pet/`

- `PetSnapshotService.getEquippedPetSnapshot(characterId, context)` —
  trả snapshot pet đã clamp theo context (PVE / PVP / BOSS / DUNGEON /
  SECRET_REALM).
- `PetSnapshotService.getCombatBonus(characterId, context)` — Phase 44.1
  adapter trả `PetCombatBonus` (flat % values cho combat tick / preview
  consumer). Hiện consumer DUY NHẤT là FE preview — combat backend
  KHÔNG bị thay đổi.
- `PetSnapshotService.getPreviewForAllContexts(characterId)` — Phase 44.1
  preview helper render bảng "Pet giúp gì ở chỗ nào" trên profile UI.

**Caps** (xem `packages/shared/src/pets.ts`):

| Context        | Damage cap | Pet stat contribution cap | Notes                              |
|----------------|------------|---------------------------|------------------------------------|
| PVE            | 12%        | 12%                       | Mặc định                          |
| PVP            | 5%         | 5%                        | + skill effect × `0.4` multiplier  |
| BOSS           | 8%         | 8%                        | World boss                         |
| DUNGEON        | 10%        | 10%                       |                                    |
| SECRET_REALM   | 10%        | 10%                       |                                    |

**Rare drop policy** (audit qua `auditPetSources()`):

- Rare pets (`LEGENDARY` / `MYTHIC` / `IMMORTAL`) KHÔNG được có `FREE` /
  `ACHIEVEMENT` source path — bắt buộc qua paywall nặng (BOSS / SECRET_REALM
  / BOX / EVENT / TRIAL_TOWER).
- Mọi rare source `estDropRatePct ≤ PET_RARE_MAX_DROP_RATE_PCT` (5%).
- Audit fail-soft — không block runtime, chỉ raise issue cho QA.

### 2.3. Onboarding 7-day auto-track

**Module**: `apps/api/src/modules/onboarding-quest/`

- `OnboardingQuestService.recordAction(characterId, actionType)` —
  Phase 44.1 surface mới. Map `OnboardingActionType` → `taskKey[]` (xem
  `ONBOARDING_ACTION_TO_TASKS`), flip task `AVAILABLE → COMPLETED` qua
  `updateMany` CAS (race-safe). Trả về list `taskKey` đã flip — caller
  có thể notify UI.
- `OnboardingQuestService.notifyAction(...)` — fire-and-forget wrapper
  wrap `recordAction()`, không throw.

**Action types** (UPPERCASE_SNAKE_CASE):

`DAILY_LOGIN_CLAIM` / `INVENTORY_OPEN` / `CULTIVATION_START` /
`CULTIVATION_TICK` / `QUEST_VIEW` / `QUEST_COMPLETE_TUTORIAL` /
`REALM_VIEW` / `EQUIP_WEAPON` / `SPIRITUAL_ROOT_VIEW` / `COMBAT_WIN` /
`DUNGEON_ENTER` / `DUNGEON_CLEAR` / `LOOT_COLLECT` / `STORY_VIEW` /
`STORY_PROGRESS` / `NPC_TALK` / `SECT_VIEW` / `CHAT_OPEN` / `MAIL_OPEN` /
`ARTIFACT_VIEW` / `ELEMENTAL_VIEW` / `MATERIAL_COLLECT` / `DASHBOARD_VIEW`
/ `NEXT_ACTION_VIEW` / `PROFILE_OPEN`.

**Day gating**: LOCKED tasks KHÔNG bị flip — chỉ `AVAILABLE` mới được
auto-track. Sau khi tất cả task của Day N COMPLETED, Day N+1 unlock
qua `recompute()` (gọi nội bộ).

**Day 7 title**:

- Final task `d7_become_novice` → claim trả `titleKey =
  'onboarding_novice_cultivator'`.
- Wire qua `TitleService.unlockTitle()` (Phase 13.0 LiveOps Title catalog
  đã có). Fail-soft — nếu Title service không inject, claim vẫn thành
  công, chỉ skip unlock.

### 2.4. Daily Encounter / Kỳ Ngộ

**Module**: `apps/api/src/modules/daily-encounter/`

- `DailyEncounterService.today(userId)` — lazy-create 1 encounter / UTC
  day / character. Same day → same encounter row (deterministic).
- `accept` / `complete` / `skip` / `choose` / `claim` — lifecycle state
  machine `AVAILABLE → ACCEPTED → COMPLETED → CLAIMED` (hoặc `SKIPPED`).
- Reward cap `DAILY_ENCOUNTER_REWARD_CAPS` (xem
  `packages/shared/src/daily-encounter.ts`) — clamp `linhThachMax` /
  `expMax`.
- Claim CAS qua `updateMany({status: 'COMPLETED'} → {status: 'CLAIMED'})`
  — parallel claim 5× chỉ 1 winner, ledger chỉ 1 entry.
- Daily cap — sau `CLAIMED`, `today()` trả về row CLAIMED cũ (không tạo
  encounter mới).

**Notification**:

- Encounter `rarity ≥ RARE` (nếu trường có) — `realtime.broadcastToUser()`
  + (Phase 44.1) push trigger nếu opt-in. Hiện tại fail-soft via Optional
  inject.

### 2.5. Secret Realm / Bí Cảnh runtime

**Module**: `apps/api/src/modules/secret-realm-runtime/`

- `SecretRealmRuntimeService.list(userId)` — trả catalog + status
  (LOCKED / AVAILABLE / COOLDOWN / ACTIVE / CLAIMED) + `cooldownRemainingMs`
  cho UI.
- `enter(userId, realmKey)` — Phase 44.1 hardening:
  1. `SECRET_REALM_NOT_FOUND` nếu key sai.
  2. `SECRET_REALM_REALM_LOCKED` nếu chưa đạt cảnh giới.
  3. `SECRET_REALM_COOLDOWN` nếu lần claim/cleared gần nhất chưa qua
     cooldownHours.
  4. `SECRET_REALM_RUN_ACTIVE` nếu đã có run ENTERED/CLEARED.
  5. `SECRET_REALM_DAILY_LIMIT` nếu vượt `dailyRunsPerRealm` (1/UTC day).
- `progress(userId, runId, objKey, delta)` — clamp to target. Throw
  `SECRET_REALM_OBJECTIVE_INVALID` nếu key sai.
- `complete(userId, runId)` — chỉ chạy khi tất cả objective ≥ target.
- `claim(userId, runId)` — CAS `status: 'CLEARED' → 'CLAIMED'`. Idempotent
  (gọi 2 lần — lần 2 no-op, không double grant). Reward clamp
  `SECRET_REALM_REWARD_CAPS.linhThachMax / expMax`.

**Race window**: `enter()` dùng `findFirst` + `create` không có composite
UNIQUE → race window vài ms cho 2 enter song song. Test
`Promise.allSettled` cover trường hợp serial — race window được
document là known issue, hardening hoàn toàn cần `(characterId,
secretRealmKey) WHERE status IN ('ENTERED','CLEARED')` partial unique
index (TODO Phase 44.2).

## 3. Tests (Phase 44.1 — 16 tests)

| # | Test                                                                              | File                                                  |
|---|-----------------------------------------------------------------------------------|-------------------------------------------------------|
| 1 | Boss spawn gửi push cho user opt-in `bossSpawnEnabled`                            | `web-push-trigger.service.test.ts`                    |
| 2 | KHÔNG gửi nếu user tắt `bossSpawnEnabled`                                         | `web-push-trigger.service.test.ts`                    |
| 3 | Dedupe cùng `bossId` → lần 2 không gửi                                            | `web-push-trigger.service.test.ts`                    |
| 4 | Mail mới push nếu opt-in `mailEnabled`                                            | `web-push-trigger.service.test.ts`                    |
| 5 | Daily reminder cron chỉ gửi 1 lần / `dateKey`                                     | `web-push-trigger.service.test.ts`                    |
| 6 | Pet preview adapter — `getCombatBonus` / `getPreviewForAllContexts`               | `pet.service.test.ts`                                 |
| 7 | Pet contribution cap PvE/PvP/BOSS                                                 | `pet.service.test.ts`                                 |
| 8 | Pet rare drop policy — `PET_RARE_HAS_EASY_PATH` / `PET_RARE_DROP_RATE_TOO_HIGH`   | `pet.service.test.ts`                                 |
| 9 | Onboarding auto-track `recordAction(CULTIVATION_START → d1_first_cultivation)`    | `onboarding-quest.service.test.ts`                    |
|10 | Onboarding reward không claim trùng                                               | `onboarding-quest.service.test.ts`                    |
|11 | Day 7 title nối Title system qua `TitleService.unlockTitle`                       | `onboarding-quest.service.test.ts`                    |
|12 | Daily Encounter reward cap `DAILY_ENCOUNTER_REWARD_CAPS`                          | `daily-encounter.service.test.ts`                     |
|13 | Daily Encounter parallel claim 5× — chỉ 1 winner + ledger 1 entry                 | `daily-encounter.service.test.ts`                     |
|14 | Secret Realm active-run guard — parallel enter không tạo nhiều run                | `secret-realm-runtime.service.test.ts`                |
|15 | Secret Realm cooldown + daily-limit guard                                         | `secret-realm-runtime.service.test.ts`                |
|16 | Secret Realm claim 2 lần idempotent — không double grant                          | `secret-realm-runtime.service.test.ts`                |

## 4. Known risks & follow-ups

- **Web Push gateway**: hiện tại dùng `PUSH_DRY_RUN=true` trong test. Production
  cần wire `web-push` lib + VAPID key + retry policy. Fail-soft cover trường hợp
  gateway throw.
- **Pet combat tick**: `getCombatBonus()` adapter có sẵn nhưng combat backend
  CHƯA wire — chỉ FE preview tiêu thụ. Phase 44.2 cần `combat.service.ts`
  consume bonus sau balance approval.
- **Secret Realm race window**: enter() không có composite UNIQUE — race
  window vài ms. Hardening cần partial unique index (TODO Phase 44.2).
- **Onboarding action coverage**: `ONBOARDING_ACTION_TO_TASKS` chưa cover
  100% task — vài task vẫn cần manual `completeTask` (e.g., social /
  alchemy nếu chưa wire runtime). Theo dõi qua audit.
- **Daily Encounter battle**: encounter dạng "battle" mới có adapter nhẹ
  — chưa wire combat thật. Phase 44.2 cần hookup `CombatService.battle()`.

## 5. Cross-references

- `docs/WEB_PUSH_SYSTEM.md` — chi tiết Web Push wire/dedupe/cooldown.
- `docs/SECRET_REALM_SYSTEM.md` — Secret Realm guards / reward cap chi tiết.
- `docs/PET_LINH_THU_SYSTEM.md` — Pet Phase 35.0 system gốc + Phase 44.1
  preview adapter section.
- `docs/onboarding-7-day.md` — Onboarding catalog + auto-track action map.
- `docs/pwa/web-push-notifications-plan.md` — original Web Push plan
  (Phase 38.x).
