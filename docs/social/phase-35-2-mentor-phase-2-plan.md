# Phase 35.2 — Mentor Phase 2 / Sư Đồ Milestone Plan

Branch: `feat/phase-35-2-mentor-phase-2`
Status: in-progress (extends Phase 31.0 Mentor foundation already merged to main).

## Goal

Mở rộng hệ thống Sư Đồ Phase 31.0 (`MentorProfile` + `MentorRelation`, đã merge) với:
- Milestone catalog theo cảnh giới (Trúc Cơ → Đại Thừa) — share catalog ở `packages/shared/src/mentor-milestone.ts`.
- Track tiến độ milestone đệ tử: `MentorMilestoneProgress` (LOCKED → AVAILABLE → CLAIMED).
- Claim reward đôi bên (mentor + disciple) qua **mail** (`MailService.sendToCharacter` + `mailType = SYSTEM`) — KHÔNG mint trực tiếp currency/item.
- Audit `MentorRewardClaim` UNIQUE `(relationId, milestoneKey, role)` chống double-claim.
- Web UI tab Sư Đồ milestone (mentor + disciple panel).

## Audit Phase 31.0 (existing)

- Prisma `MentorProfile`, `MentorRelation` đã có (xem `apps/api/prisma/schema.prisma:5859..5896`). Lifecycle PENDING → ACTIVE | DECLINED; ACTIVE → ENDED. Soft-ref user IDs.
- Service `apps/api/src/modules/mentor/mentor.service.ts` (347 dòng) cung cấp `register/request/respond/end/listStudents/getStudentContext` + rule guards (SELF, TIER_TOO_LOW/HIGH/GAP, capacity 5 student/mentor).
- Shared `packages/shared/src/mentor.ts` định nghĩa `MENTOR_LIMITS` (MIN_MENTOR_TIER=9, MAX_STUDENT_TIER=6, MIN_GAP=3, STUDENT_MAX=5).
- Mail `MailService.sendToCharacter(MailSendInput { mailType?, recipientCharacterId, subject, body, rewardLinhThach?, rewardItems?, ... })` — reuse trực tiếp.
- Mail attachment claim ledger `MailAttachmentClaim` đã có (audit / idempotency layer).
- Realms: 28 cấp, order 0..27. Catalog `packages/shared/src/realms.ts`.

## Catalog (shared)

`packages/shared/src/mentor-milestone.ts` — read-only catalog của milestone không quá dày, không gây inflation. Milestone gate qua **disciple `realmKey`** (order ≥ ngưỡng), bind reward.

Milestones (8, mỗi cái dùng realmKey thật từ `realms.ts`):

| Key | Realm | Order | Mentor reward (linh thạch) | Disciple reward (linh thạch) |
|---|---|---|---|---|
| `mentor_milestone_truc_co` | Trúc Cơ | 2 | 5_000 | 8_000 |
| `mentor_milestone_kim_dan` | Kim Đan | 3 | 10_000 | 15_000 |
| `mentor_milestone_nguyen_anh` | Nguyên Anh | 4 | 20_000 | 30_000 |
| `mentor_milestone_hoa_than` | Hoá Thần | 5 | 40_000 | 60_000 |
| `mentor_milestone_luyen_hu` | Luyện Hư | 6 | 80_000 | 120_000 |
| `mentor_milestone_hop_the` | Hợp Thể | 7 | 150_000 | 220_000 |
| `mentor_milestone_dai_thua` | Đại Thừa | 8 | 250_000 | 350_000 |
| `mentor_milestone_do_kiep` | Độ Kiếp | 9 | 400_000 | 600_000 |

**Rules**:
- Mentor reward < Disciple reward (mentor passive bonus).
- Linh thạch only — **KHÔNG** mint Tiên Ngọc / EXP / item endgame.
- Cumulative cap (mentor): ≤ 955k linh thạch / disciple, span ≥ 6 realms (Trúc Cơ→Độ Kiếp). Disciple cumulative cap ≤ 1.4M.
- Anti-abuse: disciple phải đạt realm order **tự thân** (mentor không bán hộ tài khoản).

## Prisma additive (no foreign keys to MentorRelation — soft-ref by id)

`apps/api/prisma/migrations/20300401000000_phase_35_2_mentor_milestone/migration.sql`:

```prisma
model MentorMilestoneProgress {
  id              String   @id @default(cuid())
  mentorRelationId String  // soft-ref to MentorRelation.id
  mentorUserId    String
  studentUserId   String
  milestoneKey    String   // shared catalog key
  status          String   @default("LOCKED")  // LOCKED | AVAILABLE | CLAIMED
  reachedAt       DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([mentorRelationId, milestoneKey])
  @@index([studentUserId, status])
  @@index([mentorUserId, status])
}

model MentorRewardClaim {
  id              String   @id @default(cuid())
  mentorRelationId String
  milestoneKey    String
  claimerUserId   String
  role            String   // 'MENTOR' | 'DISCIPLE'
  mailId          String?
  rewardSnapshotJson Json  @default("{}")
  claimedAt       DateTime @default(now())
  @@unique([mentorRelationId, milestoneKey, role])
  @@index([claimerUserId, claimedAt])
}
```

Soft-ref `mentorRelationId` mirror Phase 31.0 / 35.1 style (no FK cascade) — service-level guard.

## API (extension on `MentorController`)

Add 3 endpoint dưới `mentor.controller.ts`:

```
GET  /mentor/milestones                          - liệt kê milestone progress của relation ACTIVE của user (mentor view + disciple view)
POST /mentor/milestones/:milestoneKey/claim      - claim reward cho mentor HOẶC disciple role (server resolves role from user)
POST /mentor/milestones/recompute                - manual recompute progress dựa trên realmKey hiện tại (idempotent)
```

`MentorService` thêm 4 method:
- `recomputeMilestones(userId, relationId)`: lazy-create row + flip LOCKED→AVAILABLE nếu disciple đã đạt realmOrder.
- `listMilestones(userId)`: trả về progress cho mọi relation ACTIVE (mentor lẫn disciple view).
- `claimMilestoneReward(userId, milestoneKey)`: atomic `$transaction`: CAS status AVAILABLE→CLAIMED + insert `MentorRewardClaim` + `MailService.sendToCharacter` mail SYSTEM với reward.
- `internalHookOnRealmUp(userId, newRealmKey)`: hook gọi trong CharacterService sau breakthrough — fail-soft `recompute` cho relation ACTIVE của disciple. **Optional, có thể defer nếu chưa hookable**.

Error codes thêm: `MILESTONE_NOT_FOUND`, `MILESTONE_LOCKED`, `MILESTONE_ALREADY_CLAIMED`, `NOT_IN_ACTIVE_RELATION`.

## Web UI

Mở rộng (hoặc tạo) `apps/web/src/components/MentorPanel.vue` + section milestone trong `SocialView.vue` tab Sư Đồ:
- Hiển thị realm hiện tại disciple (mentor view) hoặc của bản thân (disciple view).
- Bảng milestone: realm name | reward mentor | reward disciple | status (LOCKED/AVAILABLE/CLAIMED) | nút Claim (nếu AVAILABLE và chưa claim).
- Toast on claim success / error.
- i18n VI/EN parity `mentorMilestone.*`.

## Tests (≥ 15)

API service tests `mentor.milestone.service.test.ts`:
1. recompute lazy-creates row LOCKED khi disciple chưa đạt.
2. recompute flip LOCKED→AVAILABLE khi disciple đạt order requiredOrder.
3. recompute idempotent (chạy 2 lần không double-create).
4. listMilestones trả về cho cả mentor và disciple.
5. claim AVAILABLE → CLAIMED + tạo mail reward.
6. claim LOCKED → throw `MILESTONE_LOCKED`.
7. claim duplicate cùng role → throw `MILESTONE_ALREADY_CLAIMED`.
8. mentor + disciple claim độc lập (mentor claim không lock disciple).
9. invalid milestoneKey → throw `MILESTONE_NOT_FOUND`.
10. user không ở ACTIVE relation → throw `NOT_IN_ACTIVE_RELATION`.
11. claim không mint Tiên Ngọc (mail row có `rewardTienNgoc = 0`).
12. relation ENDED không cho claim nữa.
13. mentor reward < disciple reward (snapshot reward đúng catalog).
14. recompute không flip nếu disciple downgrade (defensive — không xảy ra nhưng test rule).
15. anti-abuse: SELF_NOT_ALLOWED test giữ nguyên (inherit Phase 31.0).

Controller test `mentor.milestone.controller.test.ts`:
- 3 endpoint mapping error → HTTP status (`MILESTONE_LOCKED` → 409, `NOT_IN_ACTIVE_RELATION` → 400).

Shared test `mentor-milestone.test.ts`:
- Catalog audit: 8 milestone, requiredOrder strictly increasing, mentor reward ≤ disciple reward, no `rewardTienNgoc`, no item endgame.

Web smoke test `MentorMilestonePanel.test.ts` (3-4 case):
- Mount + list render.
- Claim button hidden khi LOCKED.
- Claim emits toast + refresh.

## Docs

- `docs/social/phase-35-2-mentor-phase-2-plan.md` (this file).
- `docs/API.md` — section "Mentor Milestone (Phase 35.2)" với 3 endpoint.
- `docs/AI_HANDOFF_REPORT.md` — Executive Summary + Recent Changes.

## KHÔNG đụng

- Phase 34 (Onboarding / Random Encounter / Secret Realm / Inventory autosort / Loadout preset).
- StoryV2, Combat formula, Reward core, Market, Codex, Phase 42 VFX.
- Cultivation processor (server-side milestone reward đi qua mail, không hook vào tick).
- KHÔNG modify `mentor.service.ts` Phase 31.0 logic gốc — chỉ thêm method mới hoặc tách thành sub-service `MentorMilestoneService`.

## Verification

```
pnpm typecheck
pnpm lint
pnpm --filter @xuantoi/shared test    # mentor-milestone catalog
pnpm --filter @xuantoi/api test       # service + controller
pnpm --filter @xuantoi/web test       # smoke
pnpm build
```
