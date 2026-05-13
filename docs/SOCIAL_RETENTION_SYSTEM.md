# Social & Retention System — Phase 31.0 Foundation V1

> Hệ Social & Retention foundation cho game text Xuân Tôi. Phase 31.0 ships **4 module mới đứng độc lập** + mở rộng MailService — KHÔNG đụng Phase 29 (combat/pvp/arena/sect-war/territory).

---

## Tổng quan

| Module | Mục đích | Trạng thái Phase 31 |
| --- | --- | --- |
| **Friend system** | Bạn bè / lời mời / block | Phase 19.x (đã có) |
| **Block list** | Chặn tương tác xã hội | Phase 19.x (đã có) |
| **Notification center** | Thông báo hệ thống | Phase 19.x (đã có) |
| **Mail system** | Thư + claim attachment idempotent | Phase 19.x + Phase 31 extend (mailType, soft-delete, claim-all) |
| **AdminMail** | Admin gửi thư cá nhân/bulk/global + audit | Phase 31.0 NEW |
| **SystemGift** | Quà bảo trì / mốc / compensation | Phase 31.0 NEW |
| **ReturnerSupport** | Người chơi quay lại được hỗ trợ tier-capped | Phase 31.0 NEW |
| **Mentor / Sư đồ** | Foundation register / request / accept | Phase 31.0 NEW |

---

## 1. Mail extension

### Enum mới

```ts
type MailType =
  | 'SYSTEM' | 'ADMIN' | 'REWARD' | 'EVENT' | 'MAINTENANCE'
  | 'PURCHASE' | 'SECT' | 'FRIEND' | 'RETURNER' | 'PVP';

type MailStatus = 'UNREAD' | 'READ' | 'CLAIMED' | 'EXPIRED' | 'DELETED';
```

### Method mới

- `MailService.sendToCharacter(...)` — atomic create với idempotency key (giữ nguyên Phase 19.x semantic).
- `MailService.getById(userId, mailId)` — fetch 1 mail.
- `MailService.softDelete(userId, mailId)` — set `deletedAt`, KHÔNG xóa thật.
- `MailService.claimAll(userId)` — CAS via `updateMany({claimedAt:null,deletedAt:null,expiresAt<now})` — bulk claim không duplicate reward.

### Idempotency rules (giữ nguyên Phase 19.x)

1. Claim reward via CAS — `updateMany({id, claimedAt:null})` — nếu count=0 throw `ALREADY_CLAIMED`.
2. `MailAttachmentClaim` UNIQUE `(mailId, characterId)` chống double-claim ledger.
3. Expired mail (`expiresAt < now`) không claim được.
4. Inventory đầy → throw `INVENTORY_FULL` — KHÔNG mất reward, mail vẫn unclaimed.

---

## 2. AdminMail

### Service / API

`AdminMailService.send(adminUserId, input)` dispatch theo `kind`:

- **SEND_ONE**: 1 character. Verify character exists trước.
- **SEND_BULK**: ≤500 character. De-dup ids trước verify.
- **SEND_GLOBAL**: target rule (xem SystemGift). Hỗ trợ `previewOnly=true` chỉ count, không gửi.

Mỗi call ghi 1 `AdminMailLog`:
- `kind` (SEND_ONE/SEND_BULK/SEND_GLOBAL)
- `reason` (≥4 ký tự — bắt buộc audit)
- `recipientsSnapshot.slice(0,50)` — cap kích thước log
- `targetRuleSnapshot` (chỉ cho SEND_GLOBAL)
- `mailCount` / `targetCount`

### Permission

- Tất cả endpoint dưới `@RequireAdmin()` (back-compat với Phase 27.6 role guard).
- `tienNgoc=0` validated server-side cho mọi reward — admin KHÔNG mint Tiên Ngọc.

### Endpoint

```
GET    /admin/mail                  → list audit logs
GET    /admin/mail/:id/logs         → 1 audit log
POST   /admin/mail/send-one         → AdminMailSendResult
POST   /admin/mail/send-bulk        → AdminMailSendResult
POST   /admin/mail/send-global      → AdminMailSendResult (preview-capable)
```

---

## 3. SystemGift

### Target rules (6 loại)

| Type | Args | Mô tả |
| --- | --- | --- |
| `ALL_PLAYERS` | — | Tất cả character |
| `REALM_RANGE` | `realmTierMin, realmTierMax` | Tier window |
| `CREATED_BEFORE` | `createdBefore` (ISO) | Character cũ |
| `ACTIVE_IN_LAST_DAYS` | `activeInLastDays` | Active gần đây |
| `SECT_MEMBERS` | `sectId` | Tông môn cụ thể |
| `EVENT_PARTICIPANTS` | `eventDefId` | Phase 28 event tham gia |

Hard cap: **50,000 targets** per resolve.

### Idempotency

`SystemGiftClaim` UNIQUE `(giftKey, characterId)` — distribute lần 2 cùng giftKey skip những character đã có claim row. `skippedAlreadyClaimedCount` được report.

### Reward filter

Reward đi qua `validateSystemGiftDef`:
- `tienNgoc = 0` (Phase 31 cap).
- Forbidden items (endgame: `tien_huyen_kiem`, `tien_huyen_giap`, `than_dan`, `hau_tho_tran_hon_an`, `ban_nguyen_chi_bao`, `hu_khong_chi_bao`).
- Item qty ≤ `SYSTEM_GIFT_MAX_ITEM_QTY` per type.

---

## 4. Returner Support

### Tier resolver

```ts
inactiveDays >= 30 → 'LONG'
inactiveDays >= 14 → 'MEDIUM'
inactiveDays >= 7  → 'SHORT'
else               → null  // không kích hoạt
```

### Idempotency

`cycleKey = userId:tier:YYYY-MM-DD` (UTC). CAS via `updateMany({OR:[lastCycleKey:null, NOT:cycleKey]})` — cùng cycleKey trong cùng UTC day chỉ trigger 1 lần.

### Reward cap

- `tienNgoc = 0` (Phase 31 cap).
- Linh Thạch: SHORT=10k / MEDIUM=30k / LONG=100k.
- Item filter forbidden + clamp by player realm tier (< 4 → strip `_medium`/`_major` suffix items).

### Hook

`ReturnerService.onLogin(userId, now?)` được gọi bởi AuthService sau khi access cookie verify thành công — recalculate inactiveDays + maybe trigger mail. Manual trigger `POST /returner/check` cho FE / testing.

---

## 5. Mentor / Sư đồ Foundation

### Tier rules

- Mentor: `realmTier ≥ MIN_MENTOR_REALM_TIER = 9` (Độ Kiếp).
- Student: `realmTier ≤ MAX_STUDENT_REALM_TIER = 6` (Luyện Hư).
- Gap: `(mentorTier - studentTier) ≥ MENTOR_STUDENT_TIER_GAP = 3`.
- Cap: `MAX_STUDENTS_PER_MENTOR = 5` active.

### State machine

```
PENDING ─accept─▶ ACTIVE ─end─▶ ENDED
   │
   └─decline─▶ DECLINED
```

CAS via `updateMany({id, status:'PENDING'})` — race-safe accept (nếu 2 admin concurrent accept cùng request thì 1 thắng, 1 throw `INVALID_TRANSITION`).

### Anti-exploit

- Cap 5 active students per mentor — chống farm referral.
- Reward sư đồ KHÔNG ship Phase 31 — daily/weekly cap design ở phase sau.
- Tier gap ≥3 chặn acc phụ same-realm bái sư farm.

### Endpoint

```
GET   /mentor/profile                  → MentorProfileRow | null
POST  /mentor/register                 → MentorProfileRow
POST  /mentor/request                  → MentorRelationRow (PENDING)
POST  /mentor/accept/:relationId       → MentorRelationRow (ACTIVE/DECLINED)
GET   /mentor/students                 → { students, pending }
GET   /mentor/student-context          → { mentor, pending } (cho student)
```

---

## 6. Conflict note với Phase 29

- Phase 31.0 KHÔNG modify: `combat/`, `pvp/`, `arena/`, `sect-war/`, `territory/` modules.
- Phase 31.0 KHÔNG share schema với Phase 29 — chỉ thêm tables mới + extend Mail.
- `MailType.PVP` được reserve trong enum cho Phase 29 nhưng Phase 31 KHÔNG tự gửi PVP mail.
- `Notification.PVP_NOTICE` enum cũng reserve sẵn.

---

## 7. Tests

| Suite | Count | Mô tả |
| --- | --- | --- |
| `mentor.service.test.ts` | 13 | Tier caps / transitions / idempotency / capacity |
| `system-gift.service.test.ts` | 8 | Validate / distribute idempotent / target rules |
| `returner.service.test.ts` | 5 | Tier resolution / cycle key / hard caps |
| `admin-mail.service.test.ts` | 8 | send-one/bulk/global / audit / recipient validation |
| `MentorView.test.ts` | 3 | UI dispatch & state render |
| `ReturnerView.test.ts` | 3 | UI dispatch & state render |
| `AdminMailView.test.ts` | 3 | UI tabs + form dispatch |

**Total Phase 31 new tests: 43**

---

## 8. Known risks

- Returner reward grant logic depends on `MailService.sendToCharacter()` — nếu Mail claim thất bại do inventory full, reward KHÔNG mất (vẫn ở mail unclaimed). Player có thể claim sau khi free slot.
- `SystemGift.resolveTargets()` đối với 50k character có thể chậm — UI nên hiện loading state khi preview SEND_GLOBAL.
- Mentor request rate limit không có ở Phase 31 — phase sau cần add rate limit (vd 10 requests/day) để chống spam bái sư.
- `claim-all` không return reward breakdown từng mail (chỉ tổng) — FE phải refetch state.
