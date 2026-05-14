# Phase 34.0 — 7-Day Onboarding Questline

> Plan source: `docs/phase-34-campaign-plan.md` §1 (Priority P1).

## Overview

Phase 34.0 wires a **7-day onboarding journey** for new cultivators, teaching the
6 core systems of Xuân Toái:

1. Character & stats (Day 1).
2. Cultivation / Pháp công (Day 2).
3. Equipment & inventory (Day 3).
4. Main story (Day 4).
5. Social — sect, chat, mail (Day 5).
6. Artifact (pháp bảo) & 5-element / ngũ hành (Day 6).
7. Tổng kết — wrap-up + cosmetic title (Day 7).

Each day contains **3-5 tasks** (26 total) with linh thạch + exp rewards,
totaling **≤ 4500 linh thạch + ≤ 2000 exp** for the entire 7-day journey.

## Day → Task layout

| Day | Theme | Tasks |
|-----|-------|-------|
| 1   | Nhân Vật (Character) | 5 |
| 2   | Pháp Công (Cultivation) | 4 |
| 3   | Vũ Khí / Trang Bị (Equipment) | 4 |
| 4   | Câu Chuyện Chính (Main Story) | 4 |
| 5   | Xã Hội (Social) | 3 |
| 6   | Pháp Bảo / Ngũ Hành (Artifact + 5-Element) | 3 |
| 7   | Tổng Kết (Wrap-up) | 3 |

See `packages/shared/src/onboarding-7-day.ts` for the complete catalog.

## API endpoints

All routes mounted under `/onboarding-quest/v1/*`. Cookie auth via `xt_access`
(same as Phase 12 / Phase 33). All responses follow the standard envelope
`{ ok: boolean; data?: T; error?: { code, message } }`.

| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/progress` | Full 7-day overview + per-task status |
| GET    | `/days/:dayNumber` | Single day detail (`:dayNumber` ∈ 1..7) |
| POST   | `/tasks/:taskKey/accept` | Mark day IN_PROGRESS (cosmetic — tasks are AVAILABLE by default) |
| POST   | `/tasks/:taskKey/complete` | CAS guard `AVAILABLE → COMPLETED` |
| POST   | `/tasks/:taskKey/claim` | CAS guard `COMPLETED → CLAIMED` + grant reward atomic |
| POST   | `/recompute` | Admin/debug: re-evaluate day status (idempotent) |

### Error codes

| HTTP | Code | Meaning |
|------|------|---------|
| 401 | `UNAUTHENTICATED` | Missing/expired `xt_access` cookie |
| 400 | `INVALID_INPUT` | Bad path param (e.g. dayNumber > 7) |
| 404 | `NO_CHARACTER` | User has no Character yet |
| 404 | `ONBOARDING_TASK_UNKNOWN` | `taskKey` not in catalog |
| 404 | `ONBOARDING_DAY_UNKNOWN` | `dayNumber` not in `1..7` |
| 409 | `ONBOARDING_TASK_LOCKED` | Day still locked (previous day not finished) |
| 409 | `ONBOARDING_TASK_NOT_COMPLETED` | Player tried claim before `complete` |
| 409 | `ONBOARDING_TASK_ALREADY_CLAIMED` | (reserved — claim is idempotent, returns `claimed:false`) |

## Reward guardrails (verbatim from Phase 34 spec)

- ✅ Reward **only via** `CurrencyService.applyTx({ reason: 'ONBOARDING_TASK_CLAIM' })`.
- ✅ **NO** direct `Character.linhThach += …` mutation anywhere.
- ✅ **NO** Tiên Ngọc minted (catalog enforces `linhThach > 0, tienNgoc = 0`).
- ✅ **NO** endgame item grant (no inventory mutation in Phase 34.0).
- ✅ Cap: per-task `linhThach ∈ [50, 500]`, total cap **≤ 4500 linh thạch +
  2000 exp** for all 26 tasks.
- ✅ Cosmetic title on Day 7 final task (`d7_complete_onboarding`) — returned
  in claim response, **not** persisted to `CharacterTitleUnlock` (defer to a
  future PR if catalog integration is needed).
- ✅ Idempotent claim — CAS via `updateMany({status:'COMPLETED'}) →
  {status:'CLAIMED'}`. Re-claim returns `{ claimed: false, linhThachGranted:0 }`.
- ✅ Day unlock — Day N (N ≥ 2) unlocks when **all tasks of Day N-1** are in
  status `COMPLETED` or `CLAIMED`.

## Data model

Two new additive Prisma tables (no `ALTER` to existing tables):

```prisma
model CharacterOnboardingProgress {
  id          String    @id @default(cuid())
  characterId String
  character   Character @relation(...)
  dayNumber   Int
  // LOCKED | AVAILABLE | IN_PROGRESS | COMPLETED
  status      String    @default("LOCKED")
  unlockedAt  DateTime?
  completedAt DateTime?

  @@unique([characterId, dayNumber])
  @@index([characterId, status])
}

model CharacterOnboardingTaskProgress {
  id            String    @id @default(cuid())
  characterId   String
  character     Character @relation(...)
  taskKey       String
  dayNumber     Int       // denormalized index helper
  // LOCKED | AVAILABLE | COMPLETED | CLAIMED
  status        String    @default("AVAILABLE")
  completedAt   DateTime?
  claimedAt     DateTime?
  linhThachGranted Int    @default(0)
  expGranted    Int       @default(0)

  @@unique([characterId, taskKey])
  @@index([characterId, dayNumber, status])
}
```

Migration: `apps/api/prisma/migrations/20300301000000_phase_34_0_onboarding_7_day/`.

## Module wiring

```
apps/api/src/modules/onboarding-quest/
├── onboarding-quest.controller.ts   # 6 endpoints, error mapping
├── onboarding-quest.controller.test.ts  # 22 unit tests
├── onboarding-quest.service.ts      # CAS guards, lazy-create, claim atomic
├── onboarding-quest.service.test.ts # 23 db-backed integration tests
└── onboarding-quest.module.ts       # imports AuthModule + CharacterModule
```

Wired into `apps/api/src/app.module.ts` next to `Phase33StoryModule`.

## Web UI

```
apps/web/src/api/onboardingQuest.ts          # 6 endpoint client
apps/web/src/stores/onboardingQuest.ts        # Pinia store (no optimistic)
apps/web/src/views/OnboardingQuestView.vue    # day grid + task list
apps/web/src/views/__tests__/OnboardingQuestView.test.ts  # 7 smoke tests
```

Route: `/onboarding-quest` (registered in `apps/web/src/router/index.ts`).

i18n keys under `onboardingQuest.*` (both `vi.json` and `en.json`).

## Compliance with Phase 34 Forbidden Actions

| Rule | Status |
|------|--------|
| Không rewrite `/story/v2` API | ✅ Untouched |
| Không phá `QuestService` / `StoryV2 service` | ✅ Separate module |
| Không sửa `StoryV2View` | ✅ Untouched |
| Reward qua ledger/inventory service chuẩn | ✅ `CurrencyService.applyTx` only |
| Không direct update currency | ✅ All currency mutations via `applyTx` |
| Không direct insert inventory | ✅ No `InventoryService.grantTx` in Phase 34.0 (catalog has no item rewards) |
| Không grant premium paid currency | ✅ NO `tienNgoc` minted |
| Không grant item endgame | ✅ No item grants in catalog |
| Reward có cap | ✅ ≤ 4500 LT + 2000 EXP enforced by catalog tests |
| Claim idempotent + anti-double-click | ✅ CAS guard + FE `submittingKey` |
| Không push main, không force push | ✅ Branch `feat/phase-34-0-onboarding-7-day` |
| Không tắt CI, không skip test | ✅ All 10036 tests pass |

## Future follow-ups (NOT in this PR)

- Cross-link from `DailyLoginView` and `QuestView` ("👀 You also have an
  onboarding task there!").

## Phase 44.1 — Auto-track + Day 7 title (PR #591)

Phase 44.1 nối auto-tracking thay vì "bấm báo cáo" và wire Day 7 title
qua `TitleService` thật:

### Auto-tracking

`OnboardingQuestService.recordAction(characterId, actionType)` (Phase 44.1)
— map `OnboardingActionType` (UPPERCASE_SNAKE_CASE) → `taskKey[]` qua
`ONBOARDING_ACTION_TO_TASKS`, flip task `AVAILABLE → COMPLETED` qua
`updateMany` CAS. Trả về list `taskKey` đã flip.

`notifyAction(...)` — fire-and-forget wrapper, không throw nếu fail.

**Day gating respected**: LOCKED tasks KHÔNG bị flip. Sau khi tất cả task
Day N COMPLETED, Day N+1 unlock qua `recompute()`.

**Action types** wire vào hành động thật:
- `CULTIVATION_START` → `d1_first_cultivation`
- `INVENTORY_OPEN` → `d1_open_inventory`
- `EQUIP_WEAPON` → `d2_equip_weapon`
- `DUNGEON_ENTER` → `d3_first_dungeon`
- `STORY_VIEW` → `d4_start_story`
- `NPC_TALK` → `d5_talk_to_npc`
- `MAIL_OPEN` → `d6_open_mail`
- `PROFILE_OPEN` → `d2_check_realm` + `d7_review_dashboard`
- ... (xem `ONBOARDING_ACTION_TO_TASKS` full map)

### Day 7 title

Final task `d7_become_novice` → claim trả `titleKey =
'onboarding_novice_cultivator'`. Wire qua `TitleService.unlockTitle()`
(Phase 13.0 LiveOps Title catalog đã có entry này). Fail-soft — nếu
Title service không inject, claim vẫn thành công, chỉ skip title.

### Tests (#9, #10, #11 trong Phase 44.1)

- `CULTIVATION_START → d1_first_cultivation AVAILABLE → COMPLETED`.
- `recordAction` 2 lần idempotent — không re-flip task đã COMPLETED.
- `PROFILE_OPEN` → flip dual task `d2_check_realm` + `d7_review_dashboard`
  (chỉ task `AVAILABLE` mới flip).
- Onboarding reward claim 2 lần idempotent — ledger chỉ 1 entry.
- Day 7 final claim unlock title qua `CharacterTitleUnlock`.
- Day 7 claim 2 lần — title chỉ unlock 1 row.

### Risks & follow-ups

- `ONBOARDING_ACTION_TO_TASKS` chưa cover 100% task — vài task vẫn cần
  manual `completeTask` nếu runtime emit event chưa wire (e.g., social /
  alchemy).
- Caller phải thêm `recordAction(...)` call ở các service emit hành động
  thật. Phase 44.1 đã wire ở 1 vài chỗ — Phase 44.2 cần audit và wire
  thêm.
