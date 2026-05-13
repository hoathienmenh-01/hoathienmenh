# Phase 35.1 — Đạo Hữu / Friend + Hợp Luyện / Co-Cultivation — Plan + Audit

Branch: `feat/phase-35-1-friend-co-cultivation`
Status: Draft → in progress

## 0. Spec scope (recap)

- Đạo Hữu / Friend system.
- Block / unblock.
- Friend request flow.
- Co-cultivation khi cả 2 online → buff nhẹ + daily cap + idempotent.
- API + Web UI + tests + docs.

**Forbidden:**
- KHÔNG sửa StoryV2 / QuestService story.
- KHÔNG sửa Secret Realm runtime.
- KHÔNG sửa Loadout preset.
- KHÔNG sửa combat formula lớn.
- KHÔNG sửa RewardService core nếu không bắt buộc.
- KHÔNG direct cộng currency/item — phải đi qua ledger/mail/reward service.
- KHÔNG tạo reward lạm phát.
- KHÔNG cho clone account farm buff.

## 1. Audit hiện trạng (existing)

| Spec ask | Trạng thái repo | Quyết định |
| -------- | --------------- | ---------- |
| Friend system | **ĐÃ CÓ** Phase 19.1 (`apps/api/src/modules/social/`, model `FriendRequest`/`Friendship`/`PlayerBlock`, user-based) | REUSE — không tạo lại. |
| Block player | **ĐÃ CÓ** Phase 19.1 (`PlayerBlock` + `social.blockUser/unblockUser`) | REUSE. |
| Online status / presence | **ĐÃ CÓ** Phase 19.3 (`PresenceService`, `RealtimeService.isOnline`) | REUSE — query `isOnline(userId)`. |
| Cultivation tick processor | **ĐÃ CÓ** (`cultivation.processor.ts`, multiplier compose chain) | KHÔNG sửa trực tiếp — bonus EXP áp ở session-complete qua `RewardCapService`. |
| RewardCap service | **ĐÃ CÓ** (Phase 16.5, `RewardCapService.applyCapTx`, source `CULTIVATION`) | REUSE — bonus EXP đi qua bucket `CULTIVATION` (share budget tránh dual-farm). |
| Mentor relation | **ĐÃ CÓ** Phase 31.0 (`MentorProfile`, `MentorRelation`) | Phase 35.2 sẽ mở rộng — ngoài scope PR A. |
| Co-cultivation session | **CHƯA CÓ** | Tạo mới — `CoCultivationSession` + `CoCultivationDailyUsage`. |
| Daily cap | **CHƯA CÓ** cho co-cultivation | Tạo mới + per-day bucket. |

## 2. Scope thực tế của PR A

Vì Friend đã có đầy đủ, PR A tập trung vào **Co-Cultivation V1** + bộ test/docs phụ trợ:

1. Schema additive:
   - `CoCultivationSession` (soft-ref user-based, mirror Phase 19.1 social pattern).
   - `CoCultivationDailyUsage` (per-user per-day usage tracking).
2. Backend module `CoCultivationModule`:
   - Service rule engine: request / accept / cancel / complete / status / history.
   - Bonus EXP áp **một lần** tại `complete`, đi qua `RewardCapService.applyCapTx` (source `CULTIVATION`), audit refType `CoCultivationComplete`.
   - Daily cap server-authoritative: 3 session/ngày, tổng ≤ 1800s buff/ngày.
   - Anti-abuse: friendship required, không self, không khi block, idempotent complete (`rewardApplied` flag).
3. Frontend `CoCultivationPanel.vue` gắn vào `SocialView` tab mới `coCultivation`.
4. Tests API ≥ 18 case (rule cover) + smoke surface.
5. Docs cập nhật: API.md + AI_HANDOFF_REPORT + plan này.

**Không** wire bonus trực tiếp vào `cultivation.processor.ts` ở V1 — vì processor đã có chuỗi multiplier phức tạp (cultivation×method×element×talent×buff×liveOps×methodV2). Áp 1 lần ở complete sạch hơn, dễ test, idempotent qua `rewardApplied` flag. Follow-up tương lai có thể wire processor nếu cần buff "live during tick".

## 3. Prisma model

```prisma
enum CoCultivationStatus {
  PENDING
  ACTIVE
  COMPLETED
  CANCELLED
  EXPIRED
}

model CoCultivationSession {
  id                String              @id @default(cuid())
  /// userId người gửi yêu cầu hợp luyện.
  initiatorUserId   String
  /// userId người nhận yêu cầu hợp luyện.
  partnerUserId     String
  /// initiator characterId snapshot (để audit + cultivation hook tương lai).
  initiatorCharacterId String
  partnerCharacterId   String
  status            CoCultivationStatus @default(PENDING)
  durationSec       Int                 @default(600)
  buffPercent       Int                 @default(3)
  startedAt         DateTime?
  completedAt       DateTime?
  expiresAt         DateTime?
  rewardApplied     Boolean             @default(false)
  /// EXP bonus thực sự được grant (after cap). Tổng cộng cả 2 user.
  bonusExpGranted   BigInt              @default(0)
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt

  @@index([initiatorUserId, status, createdAt])
  @@index([partnerUserId, status, createdAt])
  @@index([status, createdAt])
}

model CoCultivationDailyUsage {
  id                 String   @id @default(cuid())
  userId             String
  /// YYYY-MM-DD theo timezone reward cap (Asia/Ho_Chi_Minh default).
  dateKey            String
  sessionsCompleted  Int      @default(0)
  totalBuffSeconds   Int      @default(0)
  totalBonusExp      BigInt   @default(0)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([userId, dateKey])
  @@index([dateKey])
}
```

## 4. API endpoint

Tất cả gắn vào controller `SocialController` (sub-path `co-cultivation`) hoặc tạo controller riêng `/social/co-cultivation`. Quyết định: controller riêng `CoCultivationController` để tránh file `social.controller.ts` ballooning.

| Method | Path | Body | Mô tả |
| ------ | ---- | ---- | ----- |
| POST | `/social/co-cultivation/sessions` | `{ partnerUserId }` | Khởi tạo session PENDING. Đòi friendship + cả 2 online. |
| POST | `/social/co-cultivation/sessions/:id/accept` | – | Partner accept → ACTIVE + startedAt. |
| POST | `/social/co-cultivation/sessions/:id/cancel` | – | Bất kỳ owner nào hủy session PENDING/ACTIVE. |
| POST | `/social/co-cultivation/sessions/:id/complete` | – | Initiator complete → áp bonus EXP, set COMPLETED. Idempotent. |
| GET | `/social/co-cultivation/status` | – | Active session + today usage cho user hiện tại. |
| GET | `/social/co-cultivation/history` | `?limit=20&before=...` | Paginated history. |

Response shape thống nhất `{ ok: true, data }` cho success, `{ ok: false, error: { code, message } }` cho lỗi (cùng pattern existing).

## 5. Rule engine (server-authoritative)

1. **Friendship required**: `assertFriendship(myUserId, partnerUserId)` (Phase 19.1 `Friendship` table).
2. **Self check**: `partnerUserId !== myUserId`.
3. **Block check**: cả 2 chiều không trong `PlayerBlock`.
4. **Presence check**: `presenceService.isOnline(partnerUserId)` (skip ở test bằng feature flag `CO_CULT_REQUIRE_PRESENCE=0`).
5. **No active session**: mỗi user chỉ có 1 session ACTIVE/PENDING tại 1 thời điểm.
6. **Daily cap**: `sessionsCompleted < 3` AND `totalBuffSeconds < 1800` AND `durationSec` của session mới không vượt quá `1800 - totalBuffSeconds`.
7. **Cooldown**: 60s giữa 2 session completed kế tiếp (chống spam-claim).
8. **Idempotent complete**: `rewardApplied=true` → skip grant lần 2.

## 6. Reward grant flow

```
completeSession(sessionId):
  tx:
    1. find session WHERE status=ACTIVE AND rewardApplied=false (CAS guard).
    2. compute bonusExp = round(baseRate × buffPercent/100 × durationSec / tickSec)
       — baseRate, tickSec từ shared catalog `CULTIVATION_TICK_BASE_EXP`, `CULTIVATION_TICK_MS`.
    3. for each user in [initiator, partner]:
         rewardCap.applyCapTx({ characterId, source: 'CULTIVATION',
                                requestedExp: bonusExp, requestedLinhThach: 0n,
                                refType: 'CoCultivationComplete',
                                refId: sessionId })
         character.exp += grantedExp (CAS guard)
    4. upsert CoCultivationDailyUsage (sessionsCompleted++, totalBuffSeconds += durationSec, totalBonusExp += sum).
    5. update session status=COMPLETED, completedAt=now, rewardApplied=true, bonusExpGranted.
```

Không direct mutate currency/item. Không bypass rewardCap. Không grant linhThach.

## 7. Web UI

`CoCultivationPanel.vue` (mount khi tab=coCultivation trong `SocialView`):
- Section "Hôm nay": sessionsCompleted/3, buffSeconds/1800s.
- Section "Phiên hiện tại" (active/pending): thông tin partner, durationSec, buffPercent, countdown.
- Action: "Mời hợp luyện" (chọn từ friend list online), "Chấp nhận", "Hủy", "Hoàn thành".
- Section "Lịch sử gần đây": 10 phiên gần nhất (status, partner, bonusExpGranted).
- Loading/error/empty states.
- i18n `coCultivation.*` vi/en parity.
- Mobile responsive (max-w-full + grid-cols-1 sm:grid-cols-2).

## 8. Test coverage (target ≥ 18 case)

1. cannot request co-cult với chính mình.
2. cannot request khi partner không friend.
3. cannot request khi block partner.
4. cannot request khi đã có session active.
5. cannot request khi đã đạt daily cap sessions.
6. cannot request khi total buffSeconds đã quá cap.
7. cannot accept session không phải của mình.
8. cannot accept session đã CANCELLED/COMPLETED.
9. cancel chỉ owner mới cancel được.
10. complete áp bonus EXP cho cả 2 character.
11. complete chỉ initiator hoặc partner cancel được.
12. complete twice không double-apply (rewardApplied flag).
13. complete với rewardCap=0 vẫn set COMPLETED, bonusExp=0.
14. daily usage tăng đúng sessionsCompleted + totalBuffSeconds + totalBonusExp.
15. buffPercent ≤ 5 (clamp).
16. buff không áp lên Mission/Topup (vì source = 'CULTIVATION' bucket khác).
17. status API trả về session + today usage đúng.
18. history pagination cap limit ≤ 50.
19. cooldown 60s giữa 2 complete liên tiếp.
20. (smoke) controller wraps service `{ ok: true, data }`.

## 9. Anti-abuse cụ thể

- Friendship phải tồn tại — chống random partner farm.
- Block check 2 chiều — chống harassment.
- Daily cap 3 session/30 phút buff — chống clone-acc farm.
- Cooldown 60s — chống loop request-complete.
- Server-authoritative bonus calc — không nhận từ client.
- `rewardApplied` flag idempotent — không double grant.
- Bonus đi qua `RewardCapService.applyCapTx` source=`CULTIVATION` → share budget với regular tick → tổng EXP ngày vẫn cap.

## 10. Migration

`apps/api/prisma/migrations/<timestamp>_phase_35_1_co_cultivation/migration.sql` chứa 2 model + enum mới. Không sửa table cũ.

## 11. Follow-up (out of scope V1)

- Wire active buff vào `cultivation.processor.ts` để buff "live during tick" thay vì áp 1 lần ở complete.
- Group co-cultivation (≥ 3 người).
- Auto-expire active session khi 1 user offline > X phút.
- Daily cap reset notification push.
