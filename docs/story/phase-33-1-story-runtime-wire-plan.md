# Phase 33.1 — Story V2 Runtime Wire Plan (PR B của chuỗi Phase 33)

> PR B: wire runtime cho Phase 33 catalog (`STORY_QUEST_EXPANSION`) + dialogue
> (`STORY_QUEST_DIALOGUES`) đã ship trong PR A (#567). KHÔNG đụng UI.

## Mục tiêu

Cung cấp runtime API cho client query catalog + theo dõi tiến độ quest Phase 33
(accept / progress / complete / claim / list dialogues). Reward grant đi qua
ledger an toàn (mirror `QuestService.claim` Phase 12 PR-3).

Phase 33.2 (PR C) sẽ wire web UI `StoryV2View.vue` vào các endpoint này.

## Scope (catalog → runtime)

### Tables (additive, prefix `CharacterStoryV2*`)

3 model mới, chỉ ADD, **không ALTER table cũ**:

1. **`CharacterStoryV2ChapterProgress`** — per-character-per-chapter:
   - `id` (cuid PK)
   - `characterId` (FK Cascade)
   - `chapKey` (`ch09`..`ch27`)
   - `status` (`LOCKED|AVAILABLE|IN_PROGRESS|COMPLETED`)
   - `mainQuestsCompletedCount` (Int)
   - `unlockedAt`, `completedAt` (DateTime?)
   - `storyFlags` (Json default `[]`)
   - `@@unique([characterId, chapKey])`
   - `@@index([characterId, status])`

2. **`CharacterStoryV2QuestProgress`** — per-character-per-quest:
   - `id`, `characterId`, `questKey`
   - `chapKey` (denormalized for index)
   - `status` (`LOCKED|AVAILABLE|ACCEPTED|COMPLETED|CLAIMED`)
   - `stepProgress` (Json default `{}`) — `{ <stepId>: <currentCount> }`
   - `acceptedAt`, `completedAt`, `claimedAt` (DateTime?)
   - `@@unique([characterId, questKey])`
   - `@@index([characterId, chapKey, status])`
   - `@@index([status, completedAt])`

3. **`CharacterStoryV2RewardClaim`** — idempotent claim ledger:
   - `id`, `characterId`, `questKey` (unique pair)
   - `linhThachGranted` (BigInt), `tienNgocGranted` (Int), `expGranted` (BigInt), `congHienGranted` (Int)
   - `itemsGranted` (Json `[{itemKey, qty}]`)
   - `affinityGranted` (Json `[{npcKey, delta}]`)
   - `claimedAt`
   - `@@unique([characterId, questKey])`

### Service `Phase33StoryService`

File: `apps/api/src/modules/story-v2/story-v2.service.ts`

Public methods:
- `listChaptersForUser(userId)` → trả về toàn bộ chapter visible + per-chap progress + quest stats.
- `listQuestsForChapter(userId, chapKey)` → trả về toàn bộ quest visible của chapter (`AVAILABLE|ACCEPTED|COMPLETED|CLAIMED`).
- `listDialoguesForQuest(userId, questKey)` → trả về dialogue list catalog (filter theo phase nếu có query).
- `acceptQuest(userId, questKey)` — CAS guard `where status: AVAILABLE`.
- `progressQuest(userId, { questKey, stepId, amount? })` — talk/explore/choice/flag_set increment counter; chuyển COMPLETED khi all-done.
- `completeQuest(userId, questKey)` — explicit move ACCEPTED→COMPLETED nếu all steps done (fallback nếu progress() chưa flip).
- `claimReward(userId, questKey)` — atomic `$transaction` mirror Phase 12 PR-3:
  - CAS guard `updateMany({ status: 'COMPLETED', claimedAt: null })` → 1 winner.
  - Grant linhThach/tienNgoc qua `CurrencyService.applyTx` với `reason='STORY_V2_CLAIM'`, `refType='Phase33Quest'`, `refId=questKey`.
  - Grant exp/congHien qua `tx.character.update`.
  - Grant items qua `InventoryService.grantTx` với cùng reason.
  - Grant affinity qua `NpcAffinityService.addAffinityTx`.
  - Tạo row `CharacterStoryV2RewardClaim` (audit).

Lazy-create AVAILABLE row tương tự `QuestService.listForUser` — quest nào thoả gate (realm + prereq + storyFlags + affinity) mà chưa có row thì insert AVAILABLE.

### Controller `Phase33StoryController`

File: `apps/api/src/modules/story-v2/story-v2.controller.ts`

Endpoints (auth required qua `xt_access` cookie):
- `GET /story/v2/chapters` — list chapters + progress
- `GET /story/v2/chapters/:chapKey/quests` — list quests for chapter
- `GET /story/v2/quests/:questKey/dialogues?phase=` — dialogue catalog
- `POST /story/v2/quests/accept` body `{ questKey }`
- `POST /story/v2/quests/progress` body `{ questKey, stepId, amount? }`
- `POST /story/v2/quests/complete` body `{ questKey }`
- `POST /story/v2/quests/claim` body `{ questKey }`

Zod validate + error mapping qua `Phase33StoryError` class.

## Reward / ledger pattern

Reuse `CurrencyService.applyTx` + `InventoryService.grantTx` + `NpcAffinityService.addAffinityTx` đã ổn từ Phase 12 PR-3 (xem `apps/api/src/modules/quest/quest.service.ts` lines 459-630). Tham số khác:
- `reason='STORY_V2_CLAIM'` (string mới — server vẫn accept, ledger reason là free-form trong schema hiện tại).
- `refType='Phase33Quest'`, `refId=questKey`.

CAS guard tránh double-claim mirror Phase 12 PR-3:
```ts
const upd = await tx.characterStoryV2QuestProgress.updateMany({
  where: { id, status: 'COMPLETED', claimedAt: null },
  data: { status: 'CLAIMED', claimedAt },
});
if (upd.count !== 1) throw new Phase33StoryError('STORY_V2_ALREADY_CLAIMED');
```

## Forbidden trong PR B

- Không sửa Phase 12 `QuestProgress` table / service / controller.
- Không sửa Phase 33 catalog (read-only consume).
- Không expose admin endpoint (defer Phase 33.3 nếu cần).
- Không wire vào kill/collect world event (defer PR D — Phase 33.3 World Objective Deep Wire).
- Không tạo schedule daily reset / weekly reset cho daily/weekly Phase 33 quests trong PR B (defer follow-up — vẫn để player accept/claim 1 lần đầu cho test).
- Không gate UI / web view (PR C riêng).

## Tests (mới, ≥ 25 case)

`apps/api/src/modules/story-v2/story-v2.service.test.ts` (target 25+ test):
- listChaptersForUser: realm gate ẩn chapter chưa unlock, return progress for ch9 với fresh character.
- listQuestsForChapter: AVAILABLE lazy-create, prereq gate, affinity gate.
- acceptQuest: happy path, idempotent (accept 2 lần → 1 row ACCEPTED), CAS error khi LOCKED.
- progressQuest: talk/explore/choice step increment, auto-flip COMPLETED, idempotent.
- completeQuest: explicit move ACCEPTED→COMPLETED, error nếu chưa all-done.
- claimReward: grant currency/exp/item/affinity, ledger ghi đúng, idempotent double-claim throw.
- listDialoguesForQuest: filter theo phase, không leak khi quest chưa unlock.

`apps/api/src/modules/story-v2/story-v2.controller.test.ts` (target 12+ test):
- Auth: 401 khi không có cookie.
- Validate: 400 khi body sai.
- Error mapping: 404 unknown, 403 locked, 409 already-claimed/not-completed.
- Happy path: accept/progress/complete/claim trả về response đúng shape.

## Tests cũ untouched

Phase 12 `quest.service.test.ts` / `quest.controller.test.ts` không sửa. Phase 33 catalog tests không sửa. Phase 33.1 chỉ thêm tests mới ở module `story-v2`.

## Docs cập nhật

- `docs/AI_HANDOFF_REPORT.md` — (this) row Phase 33.1 runtime wire.
- `docs/story/phase-33-1-story-runtime-wire-plan.md` — file này.
- `docs/API.md` (nếu có) — thêm 7 endpoint `/story/v2/*`.

## Checkpoint strategy

Commit mỗi step:
1. **C1** — plan doc + branch.
2. **C2** — Prisma schema + migration SQL.
3. **C3** — Service skeleton + acceptQuest/listChaptersForUser.
4. **C4** — progressQuest + completeQuest + claimReward.
5. **C5** — Controller + module wire + AppModule.
6. **C6** — Service tests.
7. **C7** — Controller tests.
8. **C8** — Docs + handoff update.
9. **C9** — Open PR, wait for CI.

## Stacked PR plan reminder

PR B (this) phải xanh + merged trước khi start PR C (Phase 33.2 web UI). PR D opt (Phase 33.3 World Objective Deep Wire — kill/collect step + boss_defeat hookup vào dungeon/world boss flow) chỉ làm nếu spec yêu cầu sau khi PR C merged.
