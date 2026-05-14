# Reward Policy — Xuân Tôi

> Phase 44.0 — Economy Integrity, Reward Safety & Anti-Duplicate Claim Audit V1.
>
> Tài liệu này là **source of truth** cho các caps và rule chống lạm phát
> kinh tế / anti-P2W / anti-duplicate claim. Mọi reward grant trong runtime
> **NÊN** validate qua `packages/shared/src/reward-policy.ts`.

---

## 1. Mục tiêu

1. **Không nhận thưởng trùng.** Mọi flow claim (mail / event / onboarding /
   daily encounter / secret realm / mentor / pet pity / gift code / quest /
   dungeon) phải có 1 trong 2 đảm bảo:
   - **UNIQUE constraint DB** trên cặp `(claimer, source)`.
   - **CAS update** trên cờ `claimedAt`/`status` (vd
     `mail.updateMany({ where: { id, claimedAt: null } })`).
2. **Không tạo currency âm / item âm.** `CurrencyService.applyTx` + chuỗi
   `InventoryService.consume*` phải dùng `updateMany` với `where: { gte: -delta }`
   để hard-block âm balance.
3. **Không grant Tiên Ngọc bừa.** Tiên Ngọc là currency premium — chỉ
   được mint qua admin top-up đã audit (Phase 22) hoặc qua `monetization`
   service. Không cho game loop tự sinh.
4. **Không phát endgame item vô hạn.** Item endgame (xem
   `isEndgameItemKey`) chỉ được drop từ source có cap (boss tier cao /
   secret realm cleared) hoặc qua admin grant có audit trail.
5. **Admin grant phải có reason + audit log.** Mọi `ADMIN_GRANT` ghi
   `CurrencyLedger` với `meta.reason` ≥ 3 ký tự, `actorUserId` set.
6. **Drop rate hợp lý.** Quái thường: rare drop < 5% (per drop table
   entry). Boss/dungeon/secret realm: theo daily cap đã có
   (`DailyMaterialCap`, `DailyContentCap`, `RewardCapEvent`).

## 2. Caps & Limits

Constants chính (xem `packages/shared/src/reward-policy.ts` để code-truth):

| Constant | Giá trị | Áp dụng |
|---|---|---|
| `MAX_ADMIN_GRANT_LINH_THACH` | `1_000_000_000n` (1 tỷ) | Per `admin.grant` call |
| `MAX_ADMIN_GRANT_TIEN_NGOC` | `1_000_000` (1 triệu) | Per `admin.grant` call |
| `MAX_ADMIN_GRANT_EXP` | `10n ** 18n` | Per admin EXP grant |
| `MAX_ADMIN_GRANT_ITEM_QTY` | `999` | Per item per admin grant |
| `MAX_BROADCAST_LINH_THACH` | `10_000_000n` (10 triệu) | Per system gift broadcast |
| `MAX_BROADCAST_TIEN_NGOC` | `10_000` | Per system gift broadcast |
| `MAX_BROADCAST_EXP` | `10n ** 15n` | Per system gift broadcast |
| `MAX_MAIL_LINH_THACH` | `100_000_000n` (100 triệu) | Per mail attachment |
| `MAX_MAIL_TIEN_NGOC` | `100_000` | Per mail attachment |
| `MAX_MAIL_EXP` | `10n ** 16n` | Per mail attachment |
| `MIN_REASON_LENGTH` | `3` ký tự | Mọi `meta.reason` |

Lưu ý:
- Broadcast caps **luôn nhỏ hơn admin caps** (đã có invariant test).
- Mail caps lớn hơn broadcast nhưng nhỏ hơn admin caps (mail = single-target).
- Admin runtime hiện đang dùng caps **strict hơn** trong
  `apps/api/src/modules/admin/admin.service.ts` (`MAX_GRANT_LINH_THACH`,
  `MAX_GRANT_TIEN_NGOC`, `MAX_GRANT_EXP`, `MAX_GRANT_QTY`); chính sách
  Phase 44.0 đặt cap **tổng lớn nhất hợp lệ** trong shared để audit có
  một mức quy chiếu hard-stop chung. Không nới cap runtime.

## 3. Endgame Item Heuristic

`isEndgameItemKey(key)` phát hiện item endgame qua prefix/substring:
- `endgame_*`
- `mythic_*`, `tien_*`, `chi_ton_*`, `hong_mong_*`, `nguyen_thuy_*`
- chứa `legendary_` (chừa chỗ cho catalog mở rộng)

Quy tắc Phase 44.0:
- Reward shape **mặc định** không được chứa endgame item.
- Cần bật flag rõ ràng `validateRewardShape(reward, ctx, { allowEndgameItems: true })`
  — chỉ dùng cho admin grant đặc biệt / event high-tier có duyệt.

## 4. Validators

`packages/shared/src/reward-policy.ts` export 3 pure validator (KHÔNG I/O):

```ts
validateRewardShape(reward, context, opts?): PolicyViolation[]
validateReason(reason): PolicyViolation[]
validateAdminGrant(reward, reason, context, opts?): PolicyViolation[]
```

`context` ∈ `'ADMIN_GRANT' | 'ADMIN_GRANT_ITEM' | 'ADMIN_GRANT_EXP' |
'BROADCAST_GIFT' | 'SYSTEM_GIFT' | 'MAIL' | 'EVENT_REWARD' |
'ONBOARDING' | 'SECRET_REALM' | 'PET_BOX' | 'MENTOR_REWARD' |
'QUEST_REWARD' | 'OTHER'` — cap được chọn theo context.

Trả `ReadonlyArray<PolicyViolation>` rỗng nếu hợp lệ. `PolicyViolation`:
```ts
{ code: string; field: string; message: string; }
```

## 5. Module Status

| Module | Status | Note |
|---|---|---|
| `mail.service.ts` | **DONE** | CAS `claimedAt=null` + `MailAttachmentClaim.create` UNIQUE bảo vệ. 10× Promise.all spam pass test Phase 44.0. |
| `system-gift.service.ts` | **DONE** | `SystemGiftClaim` UNIQUE `(giftKey, characterId)` + service throw `ALREADY_CLAIMED` race-safe. |
| `giftcode.service.ts` | **DONE** | `GiftCodeRedemption` UNIQUE `(giftCodeId, userId)` + service throw race-safe. |
| `mentor-milestone.service.ts` | **DONE** | `MentorRewardClaim` UNIQUE `(relationId, milestoneKey, role)` + atomic claim → mail. |
| `onboarding.service.ts` (7-day) | **DONE** | `CharacterOnboardingTaskProgress` per (character, taskKey) idempotent. |
| `daily-encounter.service.ts` | **DONE** | `CharacterDailyEncounter` per (character, day) — claim 1 lần / ngày. |
| `secret-realm.service.ts` | **DONE** | `CharacterSecretRealmRun` per run + reward CAS. |
| `pet-box.service.ts` | **DONE** | `(characterId, boxKey, requestId)` UNIQUE — open atomic + idempotent + pity counter. |
| `admin.service.ts` | **DONE** | Runtime đã chặn `MAX_GRANT_LINH_THACH` / `MAX_GRANT_TIEN_NGOC` / `MAX_GRANT_EXP` / `MAX_GRANT_QTY` + `reason` required (Phase 22). |
| `co-cultivation.service.ts` | **DONE** | `rewardApplied` CAS guard + daily cap session/buff. |
| `roguelike.service.ts` | **DONE** | Phase 38: 1 active run guard, daily entry cap, weekly claim cap, reward cap source `ROGUELIKE` (`7000 EXP` / `2400 Linh Thạch`), CAS `COMPLETED→CLAIMED`, ledger reasons `ROGUELIKE_FLOOR_REWARD` / `ROGUELIKE_MILESTONE_REWARD`, no `tienNgoc`, no endgame drops. |
| `seasons.service.ts` | **DONE** | Phase 39: `SeasonRewardClaim` UNIQUE `(seasonId, characterId, rewardKey)`, `RewardCapService.applyCapTx(source='SEASON')`, `CurrencyService.applyTx(reason='SEASON_REWARD_CLAIM')`, `InventoryService.grantTx(reason='SEASON_REWARD_CLAIM')`; config stays capped/low-mid tier, no automatic premium currency/endgame distribution in V1. |
| Shared `reward-policy.ts` validators | **PARTIAL** | Validators sẵn sàng nhưng **chưa được wire vào** `admin.service.ts` / `mail.service.ts`. Defer Phase 44.1 sau khi audit chạy clean trên production data. |

**RISK** (chưa cover trong PR này):
- `liveops-event` reward chưa pass qua `validateRewardShape` runtime.
- `quest` reward grant rải rác qua `RewardCapService` — chưa cross-check
  endgame item flag.

## 6. Follow-up

Phase 44.1 (proposed):
1. Wire `validateAdminGrant` vào `admin.service.ts` (defensive layer thứ 2
   ngoài cap số học hiện tại).
2. Wire `validateRewardShape` vào `liveops-event.service.ts` +
   `mail.service.ts` (broadcast path).
3. Admin endpoint `/admin/economy/integrity-audit` đọc
   `runEconomyIntegrityAudit` + UI bảng kết quả + alert webhook.
4. Cron weekly run + persist findings vào `EconomyAnomaly` (đã có model).
