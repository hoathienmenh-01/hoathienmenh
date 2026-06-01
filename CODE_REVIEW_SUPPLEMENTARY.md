# Code Review Bổ Sung — Market V2, Pet, Daily Login

> **Ngày:** 2026-05-31
> **Scope:** Market V2 (auction + claim box), Pet (box/upgrade/evolve), Daily Login

---

## 1. MARKET V2 (auction.service.ts — 494 lines)

### Logic đúng:
- ✅ **Atomic transactions** cho create, bid, cancel, finalize
- ✅ **CAS guard** (`updateMany` with `status: 'ACTIVE'`) chống race finalize
- ✅ **Bid escrow pattern** — trừ tiền buyer ngay khi bid, refund vào claim box khi outbid
- ✅ **Self-bid blocked** qua `validateBid` shared validator
- ✅ **Anti-abuse anomalies**: PRICE_TOO_LOW, PRICE_TOO_HIGH, LARGE_VALUE_TRANSFER, EXCESSIVE_CANCEL_RELIST, RAPID_RESALE
- ✅ **5% tax** on seller payout — proper economy sink
- ✅ **Idempotency** via `requestId` on box opens
- ✅ **Currency cấm TIEN_NGOC** (nạp) — chỉ cho phép LINH_THACH, SECT_CONTRIBUTION, EVENT_TOKEN, TIEN_NGOC_KHOA

### Vấn đề:

#### 🟡 Item Ledger refId='pending' (L122)
```typescript
await tx.itemLedger.create({
  data: {
    characterId: input.sellerCharacterId,
    itemKey: input.itemKey,
    qtyDelta: -input.quantity,
    reason: 'MARKET_AUCTION_LIST',
    refType: 'MarketAuction',
    refId: 'pending',  // ← Không bao giờ update thành auction.id
  },
});
```
**Vấn đề:** `refId='pending'` không link back đến auction ID. Sau khi auction create, ledger row vẫn ghi `'pending'` thay vì auction ID thực tế. Điều này làm mất audit trail — không thể trace item đã auction nào.
**Fix:** Update ledger row sau khi auction create, hoặc dùng 2-phase (create auction → update ledger refId).
**Severity:** LOW — audit trail incomplete nhưng không ảnh hưởng gameplay.

#### 🟢 Finalize pagination
```typescript
const due = await this.prisma.marketAuction.findMany({
  where: { status: 'ACTIVE', endsAt: { lte: now } },
  take: 100,
});
```
**Đánh giá:** `take: 100` limit mỗi lần finalize. Nếu > 100 auctions hết hạn cùng lúc (unlikely), sẽ cần nhiều cron tick. Acceptable design.

---

## 2. PET SYSTEM (pet-box.service.ts — 421 lines)

### Logic đúng:
- ✅ **Idempotency** qua `requestId` — duplicate request trả kết quả cũ
- ✅ **Pity system** — counters persist, auto-upgrade rarity khi đủ pity
- ✅ **Deterministic RNG** từ `requestId` (reproducible)
- ✅ **All costs qua InventoryService / CurrencyService** — không bypass
- ✅ **Result types limited**: PET / SHARD / MATERIAL / TICKET_REFUND only
- ✅ **PetBoxOpenLog** unique constraint `(characterId, boxKey, requestId)`

### Không có vấn đề lớn. Pet box system thiết kế tốt với proper idempotency và pity mechanics.

---

## 3. DAILY LOGIN

### Logic đúng (từ scan):
- ✅ Streak-based rewards
- ✅ Reward cap không cần (small amounts: 50-200 linhThach)
- ✅ Mission tracking cho daily login

### Không có vấn đề.

---

## 4. TỔNG HỢP

| System | Rating | Issues |
|--------|--------|--------|
| Market V2 | ⭐⭐⭐⭐ | 1 minor audit trail issue (refId='pending') |
| Pet System | ⭐⭐⭐⭐⭐ | Clean design, proper idempotency + pity |
| Daily Login | ⭐⭐⭐⭐ | Clean, no issues |

### Tổng kết toàn bộ review session

**Tổng issues phát hiện:** 12
- 🔴 HIGH: 3 (all fixed)
- 🟡 MEDIUM: 5 (4 fixed, 1 intentional)
- 🟢 LOW: 4 (2 fixed, 2 backlog)
- 🟢 MINOR: 1 (Market V2 audit trail — backlog)

**Tổng files changed:** 12 source files + 4 docs
**Quality gates:** typecheck ✅, lint ✅, i18n-parity ✅, web tests ✅