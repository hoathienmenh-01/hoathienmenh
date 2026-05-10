# Xuân Tôi — Economy Model

> **Status**: Long-term economy blueprint. Source of truth cho **invariants** + **source/sink** + **anti-abuse**.
> Code on `main` is source of truth cho hành vi runtime hiện tại.
> Sister docs: [`GAME_DESIGN_BIBLE.md`](./GAME_DESIGN_BIBLE.md), [`BALANCE_MODEL.md`](./BALANCE_MODEL.md), [`CONTENT_PIPELINE.md`](./CONTENT_PIPELINE.md).

Mục tiêu: economy KHÔNG vỡ trong 12-24 tháng vận hành, kể cả khi:

- Số người chơi 10× hiện tại.
- Có cheat/exploit attempt.
- Admin compromised (1 admin tài khoản bị hack).
- Server reset (rollback DB) — phải có recovery path.

---

## 1. CURRENCY TYPES

### 1.1 Hiện trạng (theo `prisma/schema.prisma:Character`)

| Field | Type | Đơn vị / Vai trò | Source chính | Sink chính | Trade? |
|---|---|---|---|---|---|
| `linhThach` | `BigInt` | **Tiền chính** soft currency | tu luyện, dungeon drop (+5% bonus nếu sect sở hữu region của dungeon — Phase 14.0.C `territory_hac_lam_drop` `LINH_THACH_BONUS`), mission, mail | market buy, equip refine (future), donate sect | Yes (qua market) |
| `tienNgoc` | `Int` | **Premium** hard currency | topup admin approve, gift code | premium shop, cosmetic, refine speed-up (future) | No (server-side) |
| `tienNgocKhoa` | `Int` | **Locked premium** | event/login bonus | sub-set sink của tienNgoc; spend trước tienNgoc unlocked | No |
| `tienTe` | `Int` | **Reserved** | (chưa dùng — nguyên thuỷ ý định cho NPC trade) | (chưa dùng) | TBD |
| `nguyenThach` | `Int` | **Refine material** | ore drop dungeon | refine, alchemy (phase 11) | TBD (probably yes via market) |
| `congHien` | `Int` | **Sect contribution** | sect mission, sect donate (phase 13) | sect shop | No (sect-internal) |
| `congDuc` | `Int` | **Reserved (đạo đức)** | (chưa dùng — nguyên thuỷ cho karma system) | (chưa dùng) | TBD |
| `chienCongTongMon` | `Int` | **Sect war point** | sect war kill (phase 13) | season reward | No |

> Phase 13.1.A note: điểm Tông Môn Chiến tuần KHÔNG lưu vào `chienCongTongMon` — Phase 13.1.A dùng `SectWarContribution` row (per-week, per-source) làm source of truth. `chienCongTongMon` reserve cho Sect Shop currency dài hạn (Phase 13.1.B). Phase 13.1.A chỉ source weekly leaderboard rank → Linh Thạch / Tiên Ngọc / Title qua `POST /sect-war/claim`.

### 1.2 Long-term: thêm currency type

| Currency | Khi nào | Lý do |
|---|---|---|
| `eventToken_{eventKey}` (dynamic, lưu trong `EventProgress.progressJson`) | Phase 15 | Event-scoped consumable, reset cuối event |
| `arenaPoint` | Phase 14 | Sub-set season currency, mua reward arena |
| `seasonHonor` | Phase 14 | Cosmetic / title trade-in |

**Nguyên tắc thêm currency mới**:

1. Phải mở rộng `CurrencyKind` enum (Prisma).
2. Phải có ledger path qua `CurrencyService` (KHÔNG để service khác update trực tiếp).
3. Phải có ít nhất 1 source + 1 sink rõ ràng (tránh "deadweight currency").
4. Phải document trong file này (table 1.1 hoặc 1.2).
5. Migration phải có rollback plan.

### 1.3 BigInt vs Int

- `BigInt`: dùng cho currency có thể đạt > 2^31 trong late-game (linhThach: tu luyện late-game cộng triệu đơn vị/h → vài tỷ trong 1 tháng).
- `Int`: dùng cho premium (tienNgoc: nạp tay, không tự sinh nhanh) và sub-counters.

**Quy tắc**: nếu currency có thể inflate > 1 tỷ đơn vị → dùng `BigInt`. Khi serialize JSON → string (xem `apps/api/src/modules/admin/ledger-audit-json.test.ts`).

---

## 2. SOURCE / SINK MAP

### 2.1 linhThach (soft currency chính)

#### Sources

| Source | Endpoint / Service | Reason | Idempotency |
|---|---|---|---|
| Cultivation tick | `cultivation.processor.ts` | `CULTIVATION_TICK` | Per-tick (job already idempotent via BullMQ) — KHÔNG ghi ledger từng tick (chỉ ghi exp). **Note**: hiện tu luyện grant EXP, không grant linhThach. linhThach drop từ dungeon. |
| Dungeon monster kill | `combat.service.ts` `applyMonsterDrop` | `DUNGEON_DROP` | Per-encounter (Encounter.id) |
| Boss damage reward | `boss.service.ts` `distributeRewards` | `BOSS_REWARD` | Per `(bossId, characterId)` — verify với `BossDamage` row |
| Mission claim | `mission.service.ts` `claimReward` | `MISSION_CLAIM` | `MissionProgress.claimed` flag |
| Mail claim | `mail.service.ts` `claimMail` | `MAIL_CLAIM` | `Mail.claimedAt` not null |
| Territory owner reward (Phase 14.0.E) | `territory-reward.service.ts` `grantWeeklyOwnerRewardMail` → `mail.service.ts` `sendToCharacter` | `MAIL_CLAIM` (khi member claim mail) | `TerritoryOwnerRewardGrant` UNIQUE `(periodKey, regionKey, characterId)` — gọi lại cùng `periodKey` KHÔNG tạo mail mới |
| Gift code redeem | `giftcode.service.ts` `redeem` | `GIFT_CODE_REDEEM` | `GiftCodeRedemption` unique |
| Daily login claim | `daily-login.service.ts` `claim` | `DAILY_LOGIN` | `DailyLoginClaim` unique `(characterId, claimDateLocal)` |
| Market sell (income) | `market.service.ts` `buy` | `MARKET_SELL` | Per `Listing.id` |
| Admin grant | `admin.service.ts` `grantCurrency` | `ADMIN_GRANT` | Manual-by-admin, ghi `actorUserId` |

#### Sinks

| Sink | Endpoint / Service | Reason |
|---|---|---|
| Market buy (cost) | `market.service.ts` `buy` | `MARKET_BUY` |
| Shop NPC buy | `shop.service.ts` `buy` | `SHOP_BUY` |
| NPC Affinity Shop buy (Phase 12.10.C) | `npc-affinity-shop.service.ts` `buy` | `NPC_SHOP_BUY` |
| Sect donate (phase 13) | `sect.service.ts` `donateTreasury` | `SECT_DONATE` |
| Refine cost (phase 11) | `refinery.service.ts` (future) | `REFINE_COST` |
| Alchemy cost (phase 11) | `alchemy.service.ts` (future) | `ALCHEMY_COST` |
| Repair durability (phase 12) | `inventory.service.ts` (future) | `REPAIR_COST` |
| Admin revoke | `admin.service.ts` `grantCurrency` (negative) | `ADMIN_REVOKE` |

### 2.2 tienNgoc (premium hard currency)

#### Sources

| Source | Service | Reason | Idempotency |
|---|---|---|---|
| Topup approve | `topup.service.ts` `approve` | `ADMIN_TOPUP_APPROVE` | `TopupOrder.status = APPROVED` (state machine) |
| Gift code redeem (premium reward) | `giftcode.service.ts` | `GIFT_CODE_REDEEM` | `GiftCodeRedemption` unique |
| Mail (premium reward) | `mail.service.ts` | `MAIL_CLAIM` | `Mail.claimedAt` |
| Admin grant | `admin.service.ts` | `ADMIN_GRANT` | Manual |
| Event reward (phase 15) | `event.service.ts` (future) | `EVENT_REWARD` | `EventRewardClaim` unique |

#### Sinks

| Sink | Service | Reason |
|---|---|---|
| Premium shop | `shop.service.ts` (future tab) | `PREMIUM_SHOP_BUY` |
| NPC Affinity Shop premium buy (Phase 12.10.C) | `npc-affinity-shop.service.ts` `buy` | `NPC_SHOP_BUY` |
| Refine speed-up (phase 11) | `refinery.service.ts` (future) | `REFINE_SPEEDUP` |
| Cosmetic / title (phase 11+) | static catalog | `COSMETIC_BUY` |
| Battle pass tier (phase 15, gated) | `battle-pass.service.ts` (future) | `BATTLEPASS_TIER` |
| Admin revoke | `admin.service.ts` | `ADMIN_REVOKE` |

### 2.3 nguyenThach (refine material)

#### Sources

- Dungeon ore drop (item kind `ORE` với chuyển đổi → `nguyenThach` qua "use ore item" hoặc trực tiếp drop currency).

#### Sinks

- Refine equipment (phase 11).
- Alchemy recipe (phase 11).

> **Quyết định thiết kế**: hiện `nguyenThach` lưu thành `Character.nguyenThach: Int` field. Cân nhắc migrate sang `CurrencyKind.NGUYEN_THACH` để uniform. **Default phase 11**: thêm enum + ledger path; không xoá field.

### 2.4 congHien / chienCongTongMon (sect)

#### 2.4.1 congHien (Phase 13.1.B — DONE)

`congHien` = `Character.contribBalance` (Int, ≥ 0). Lifetime tổng = `Character.contribLifetime` (audit-only, không spend được).

#### Sources

- `SectMissionService.claim()` — Phase 13.1.B daily/weekly mission catalog ([`packages/shared/src/sect-missions.ts`](../packages/shared/src/sect-missions.ts)). Reason `SECT_MISSION_CLAIM`. Idempotent qua composite UNIQUE `SectMissionClaim(characterId, missionKey, periodKey)` — DAILY periodKey `YYYY-MM-DD`, WEEKLY periodKey `YYYY-Www` (ICT).
- (Future) Donate Sect resources — phase 13.2.

#### Sinks

- `SectShopService.buy()` — Phase 13.1.B 5-entry shop catalog ([`packages/shared/src/sect-shop.ts`](../packages/shared/src/sect-shop.ts)). Reason `SECT_SHOP_BUY`. Atomic CAS spend qua `prisma.character.updateMany({ where: { id, contribBalance: { gte: cost } } })` — count=0 → throw `INSUFFICIENT_CONTRIB` không trừ tiền không grant item.

#### Race protection (Phase 13.1.B)

- **Atomic transaction**: claim mission + buy shop entry chạy trong `prisma.$transaction(async (tx) => { ... })`. Mọi side-effect (decrement balance + ItemLedger + InventoryService.grantTx + SectShopPurchase row + CurrencyLedger reward) nằm cùng tx → fail giữa chừng → rollback toàn bộ.
- **No negative balance**: CAS guard `contribBalance: { gte: cost*qty }` ép DB invariant. Race 2 buy concurrent → loser get count=0 → reject. Test cover trong `sect-shop.service.test.ts`.
- **Idempotency claim**: composite UNIQUE `(characterId, missionKey, periodKey)` → P2002 → translate `MISSION_ALREADY_CLAIMED` HTTP 409. Retry hook không double-grant.
- **Idempotency buy**: KHÔNG idempotent (mỗi buy là 1 user-intent transaction). Nhưng daily/weekly limit aggregate `SectShopPurchase.qty` trong period → cap ép race-double-spend.
- **Rate limit**: 30 req/60s per user qua `FailoverRateLimiter` (Redis primary + in-memory fallback). Spam → `RATE_LIMITED` 429, KHÔNG enter transaction.
- **NON_STACKABLE_QTY_GT_1 guard**: items hiện tại đều stackable, nhưng defensive check trước transaction → reject `qty > 1` cho item non-stackable mà không trừ tiền.
- **Item grant rollback**: `InventoryService.grantTx` lỗi (P2002 unique slot, max stack overflow, etc) → toàn bộ tx rollback → contribBalance không bị trừ. Ledger `SECT_SHOP_BUY` chỉ được ghi khi tx commit.
- **Sect required**: `Character.sectId == null` → reject mọi mission claim + buy shop với `SECT_REQUIRED`.

#### 2.4.2 chienCongTongMon (Phase 13.1.A)

`chienCongTongMon`: gain qua sect war kill. Spend qua season reward (xem ECONOMY_MODEL §11.13.2 ở BALANCE_MODEL.md).

---

## 3. CURRENCY SERVICE — INVARIANTS

> **HARD INVARIANTS**: vi phạm = bug critical. Bắt đầu từ MVP đã thiết kế đúng (xem `apps/api/src/modules/currency/currency.service.ts`). KHÔNG được nới lỏng.

### 3.1 Single mutation point

```ts
// CHỈ DÙNG:
await currencyService.mutate({
  characterId,
  currency: CurrencyKind.LINH_THACH,
  delta: BigInt(100),
  reason: 'DUNGEON_DROP',
  refType: 'Encounter',
  refId: encounterId,
  meta: { dungeonKey },
  actorUserId: null,  // hoặc adminUserId
});
```

**KHÔNG được**:

```ts
// ❌ BỊ CẤM
await prisma.character.update({
  where: { id },
  data: { linhThach: { increment: 100n } },
});
```

Lý do: bypass ledger = bug. Mất audit trail = không recover được khi anomaly.

### 3.2 Atomic transaction

Mọi mutation phải transactional:

```ts
await prisma.$transaction(async (tx) => {
  await tx.character.update(...);
  await tx.currencyLedger.create(...);
});
```

Nếu một bước fail → rollback cả 2.

### 3.3 Ledger row contract

Mọi ledger row PHẢI có:

- `characterId` — không null.
- `currency` — enum `CurrencyKind`.
- `delta: BigInt` — có dấu, không zero (zero = no-op, không nên ghi).
- `reason: String` — uppercase snake_case, từ vựng cố định (`DUNGEON_DROP`, `MISSION_CLAIM`, `ADMIN_GRANT`, …).
- `refType + refId` — link tới entity gây ra mutation (e.g. `('Encounter', encounterId)`).
- `meta: Json` — context bổ sung (dungeonKey, missionKey, …).
- `actorUserId` — null nếu hệ thống tự động; userId nếu admin/MOD trigger.
- `createdAt` — auto.

### 3.4 ItemLedger (tương tự)

Mọi mutation `InventoryItem.qty` (kể cả equip/unequip thay đổi qty=0/1) đi qua `InventoryService.mutate` (hoặc tương đương) ghi `ItemLedger`:

- `qtyDelta: Int` (có dấu).
- `reason`, `refType`, `refId`, `meta`, `actorUserId`.

**Exception**: equip/unequip không thay đổi `qty` (chỉ thay đổi `equippedSlot`) → không cần ledger row. Tuy nhiên equip thành công là 1 audit event nên cân nhắc thêm `EquipChangeLog` riêng (phase 11+).

### 3.5 Idempotency

Mỗi reward source phải có cơ chế "claim chỉ 1 lần":

| Source | Idempotency mechanism |
|---|---|
| Daily login | unique `(characterId, claimDateLocal)` |
| Mission claim | `MissionProgress.claimed = true` flag check trước update |
| Mail claim | `Mail.claimedAt IS NULL` check trước update |
| Gift code | `GiftCodeRedemption` unique `(giftCodeId, userId)` |
| Topup approve | state machine: `PENDING → APPROVED` (nếu đã APPROVED, retry no-op) |
| Boss reward | `BossDamage` row tồn tại + 1 lần distribute per boss |
| Dungeon encounter loot | `Encounter.id` ref + status check `WON` |
| Tribulation support consume (Phase 14.3.C) | tx flow: pre-check `inventory(character, itemKey).qty>0` → consume → fail → throw `SUPPORT_ITEM_MISSING` → tx rollback (KHÔNG mất EXP). `ItemLedger` `reason=TRIBULATION_SUPPORT_CONSUME` `refType=TribulationAttemptLog` `refId=logId` để admin trace ra attempt log gốc. |

**Long-term**: cân nhắc thêm `RewardClaimLog(characterId, sourceType, sourceKey, claimedAt)` unique làm single mechanism. Hiện đang phân tán theo từng module — ổn nhưng dễ miss khi thêm source mới. Đề xuất phase 15-16 unify.

### 3.6 Tribulation support item consumption (phase 14.3.C)

**Source/sink contract**: `POST /character/tribulation` body `{ selectedSupportItemKeys?: string[] }` (≤ 3 keys). Mỗi key consume `qty=1` từ `InventoryItem` qua `consumeOneByItemKeyTx(tx, characterId, key, { reason: 'TRIBULATION_SUPPORT_CONSUME', refType: 'TribulationAttemptLog', refId: logId })` — sink path. KHÔNG có source path đối ứng (item không respawn / refund).

**Catalog rule**: chỉ item kind `PILL_HP / PILL_MP / PILL_EXP / MISC` có `ItemDef.tribulationSupport` field mới consume được. Equipment KHÔNG consume — equipment vẫn cộng bonus qua provider Phase 14.3.B (read-only, không sink).

**Dual consumption (success + fail path)**: design choice "no free retry with refund" — cả 2 outcome path đều consume:

- **Success path**: kiếp pass → reward `linhThach` + `expBonus` → consume item (đã consume trong tx trước outcome roll).
- **Fail path**: kiếp fail → mất EXP + cooldown + chance taoMa → consume item KHÔNG hoàn về.

Lý do design: nếu refund khi fail → player abuse high-bonus item kiếp đến khi roll qua → "free farm" item bonus envelope. Dual consumption + cap envelope (xem `BALANCE_MODEL.md` §5.6.3) giữ item là **resource cost thực** — player phải tính toán giá trị item vs success chance, không chỉ stack max.

**Anti-cheat (server-side recalc)**: attempt KHÔNG dùng FE `bonus` value. Server tự re-resolve `composedSupports` từ 4 nguồn (selectedItems + equipment + buffs + talents) → cap envelope per-entry/total → áp damage multiplier. Player không thể cheat bằng cách gửi `selectedSupportItemKeys` rỗng + FE bonus cao — bonus bị recalc về 0 nếu không có item/equipment/buff/talent thật.

**Per-attempt sink ceiling**: tối đa 3 item × `qty=1` = 3 pill per attempt. Cooldown sau attempt (success: realm transition, fail: cooldown phút) giới hạn velocity → KHÔNG abuse spam attempt để đốt item.

---

## 4. ANTI-ABUSE

### 4.1 Anti double-claim

Đã cover ở §3.5. Test bắt buộc:

```ts
// Pseudocode test pattern
it('should not double-grant on retry claim', async () => {
  await service.claim(characterId, sourceKey);
  const afterFirst = await getLinhThach(characterId);
  await service.claim(characterId, sourceKey);
  const afterSecond = await getLinhThach(characterId);
  expect(afterSecond).toEqual(afterFirst);
});
```

### 4.2 Anti double-spend

Khi consume currency hoặc item:

```ts
// CurrencyService.mutate với delta âm phải verify đủ balance
if (currentBalance + delta < 0n) throw new InsufficientFundsError();
```

Phải transactional + lock row (`SELECT FOR UPDATE` hoặc Prisma `$transaction` với row-level read).

### 4.3 Market wash detection

Phase 16. Cron quét `Listing` last 24h:

- Cùng `(itemKey, sellerId, buyerId)` xuất hiện > 3 lần → flag.
- Cùng `sellerId == buyerId` (alt account self-trade) → cần fingerprint user (IP + device — phase 17).

Detection result → `EconomyAnomaly` row + admin alert.

### 4.4 Topup velocity

Phase 16. Per user:

- > X VND/24h → manual review (set `TopupOrder.status = PENDING_REVIEW`, không auto-approve nếu later auto-approval feature).

Hiện tại topup luôn manual approve nên ít rủi ro, nhưng cần track velocity để chuẩn bị auto-approve future.

### 4.5 Daily reward cap

Phase 16. Per character per day:

- Soft source (cultivation+dungeon+mission) tổng linhThach ≤ X (X tunable theo realm).
- Vượt → grant tới X, log + alert.

Lý do: chống AFK farm bot 24/7 + chống cheat tăng tốc tick.

### 4.6 Admin economy report

Phase 16. Endpoint `GET /api/admin/economy-report`:

- Tổng in/out per currency per source per day.
- Top 10 character với delta net lớn nhất.
- Market volume.
- Topup volume.
- So sánh trend ngày trước.

Admin nhìn thấy bất thường (e.g. linhThach in tăng 5×) → manual investigate.

### 4.7 Compromised admin protection

Phase 16. Khi 1 admin grant > X linhThach hoặc > Y tienNgoc trong 1 lần hoặc trong 24h → alert mail tới super-admin (account khác).

Mục đích: ngăn 1 admin compromised tự grant tài sản lớn cho chính họ.

### 4.8 Rate limit endpoint nhạy cảm

| Endpoint | Hiện trạng | Long-term |
|---|---|---|
| `POST /_auth/login` | 5 fail/15p/IP+email | giữ |
| `POST /_auth/register` | 5/15p/IP | giữ |
| `POST /chat/world` | 8/30s | giữ |
| `POST /chat/sect` | 16/30s | giữ |
| `POST /character/breakthrough` | (không) | thêm 5/min |
| `POST /market/list` | (không) | thêm 10/min, daily cap N listing |
| `POST /market/buy` | (không) | thêm 30/min |
| `POST /giftcode/redeem` | (không) | thêm 10/min |
| `POST /topup/order` | (không) | thêm 5/h (tránh spam tạo PENDING) |
| `POST /admin/*` | guard role | thêm rate-limit aggressive nếu cần |

Sử dụng Redis-backed rate limiter (đã có cho chat — pattern reuse).

---

## 5. ECONOMY AUDIT TOOLS

### 5.1 `pnpm audit:ledger` (đã có)

`apps/api/scripts/audit-ledger.ts`:

- Verify mỗi character: `Character.linhThach == sum(CurrencyLedger.delta where currency=LINH_THACH)`.
- Cùng cho `tienNgoc`.
- Cùng cho `InventoryItem.qty == sum(ItemLedger.qtyDelta where itemKey=X)`.
- Output: pass/fail + diff.

CLI flag (đã có per PR #166):
- `--json` để CI consume.

### 5.2 EconomyAuditSnapshot (phase 16)

Mở rộng: cron daily lưu snapshot tổng economy:

```prisma
model EconomyAuditSnapshot {
  id              String   @id @default(cuid())
  asOf            DateTime @unique  // truncated to day
  totalLinhThach  BigInt
  totalTienNgoc   Int
  totalNguyenThach Int
  characterCount  Int
  metadata        Json     @default("{}")
  createdAt       DateTime @default(now())
}
```

Mục đích: track inflation/deflation theo thời gian.

### 5.3 EconomyAnomaly (phase 16)

```prisma
enum AnomalyKind {
  WASH_TRADE
  ADMIN_LARGE_GRANT
  TOPUP_VELOCITY
  REWARD_CAP_HIT
  LEDGER_MISMATCH
}

enum AnomalyStatus {
  OPEN
  INVESTIGATING
  RESOLVED
  FALSE_POSITIVE
}

model EconomyAnomaly {
  id          String          @id @default(cuid())
  kind        AnomalyKind
  severity    Int             @default(1)  // 1..5
  evidence    Json
  status      AnomalyStatus   @default(OPEN)
  resolvedById String?
  resolvedAt  DateTime?
  createdAt   DateTime        @default(now())

  @@index([kind, status, createdAt])
  @@index([status, severity])
}
```

Cron `economy-anomaly-scanner` insert row khi detect. Admin dashboard tab "Economy → Anomaly" review.

---

## 6. TAX / FEE POLICY

### 6.1 Hiện trạng

- Market: 5% fee on `MARKET_BUY` (deducted from buyer hoặc seller — verify code).
- Topup: không fee server-side; fee tại payment provider.

### 6.2 Long-term

- Market tax tunable per item-quality (e.g. PHAM 5%, LINH 5%, HUYEN 7%, TIEN 10% — chống flip premium item rẻ).
- Event tax 0% trong event "Phường Thị Khai Hội" (24h).
- Tax thu vào "global treasury" (không trao ai cụ thể, sink linhThach).

### 6.3 Tax dial registry

File mới (phase 16): `packages/shared/src/economy-dials.ts`:

```ts
export const ECONOMY_DIALS = {
  MARKET_TAX_DEFAULT: 0.05,
  MARKET_TAX_BY_QUALITY: { PHAM: 0.05, LINH: 0.05, HUYEN: 0.07, TIEN: 0.10, THAN: 0.10 },
  REWARD_CAP_LINH_THACH_DAILY: BigInt(1_000_000),  // tunable per realm
  TOPUP_VELOCITY_24H_VND: 10_000_000,
  ADMIN_LARGE_GRANT_THRESHOLD_LINH_THACH: BigInt(10_000_000),
  ADMIN_LARGE_GRANT_THRESHOLD_TIEN_NGOC: 10_000,
} as const;
```

Override qua env hoặc admin config UI (phase 15+ FeatureFlag).

---

## 7. RECOVERY / DISASTER

### 7.1 Ledger lệch state

Nếu `audit:ledger` báo lệch:

1. Identify character + currency lệch.
2. Check `CurrencyLedger` last 7 days cho character đó.
3. Identify root cause (bug code? cheat? admin error?).
4. Patch root cause trước.
5. Insert reconciliation ledger row với `reason = 'RECONCILE_<reason>'`, `actorUserId = super-admin`, `meta = { auditDiff, originalState }`.
6. KHÔNG sửa `Character.linhThach` trực tiếp — luôn qua `CurrencyService.mutate`.

### 7.2 DB rollback / restore

Nếu phải rollback DB (e.g. corruption):

1. Restore từ backup gần nhất (xem `docs/BACKUP_RESTORE.md`).
2. Replay: nếu có log/journal giữa backup và rollback time → replay event.
3. Mail apology + grant compensation tới ảnh hưởng users (manual, ghi audit).
4. KHÔNG silently rollback — luôn announcement public.

### 7.3 Inflation runaway

Nếu phát hiện inflation:

1. Pause source: feature flag tắt source nguy hiểm (e.g. tạm tắt cultivation tick).
2. Investigate qua `EconomyAuditSnapshot` trend.
3. Patch + drain: tăng sink (event "tu vi đại tăng" tốn linhThach), giảm source.
4. Không "soft reset" currency cho user — chỉ điều chỉnh source/sink curve.

---

## 8. DATA MODEL (đề xuất bổ sung dài hạn)

| Model | Mục đích | Phase nên làm |
|---|---|---|
| `RewardClaimLog` | Single source of truth cho idempotency mọi reward source | 15-16 |
| `EconomyAuditSnapshot` | Track inflation theo ngày | 16 |
| `EconomyAnomaly` | Anomaly tracking | 16 |
| `MarketPriceBand` (catalog) | Min/max price per item | 16 |
| `LedgerArchive` | Move old `CurrencyLedger`/`ItemLedger` row > 90d sang archive table để query main nhanh | 17 |

Mỗi model proposed: xem cụ thể schema trong file [`04_TECH_STACK_VA_DATA_MODEL.md`](./04_TECH_STACK_VA_DATA_MODEL.md) §3.6 (long-term).

---

## 9. TEST CHECKLIST

Mỗi PR động đến currency / item / reward path PHẢI có:

- [ ] Test happy path: grant đúng số lượng, ghi ledger row.
- [ ] Test idempotency: claim 2 lần = 1 lần.
- [ ] Test insufficient: spend > balance → reject với error code chuẩn.
- [ ] Test admin grant: ghi `actorUserId`.
- [ ] Test transaction rollback: nếu service fail giữa chừng, ledger không lệch.
- [ ] Test concurrent: 2 request claim đồng thời → 1 thành công, 1 fail (race condition test).

Xem pattern tham khảo: `apps/api/src/modules/daily-login/daily-login.service.test.ts`.

---

## 10. CHANGELOG

- **2026-04-30** — Initial creation. Author: Devin AI session 9q.
- **2026-05-09** — Phase 14.0.E Territory Owner Reward Mail — thêm source `linhThach`/EXP/item dạng mail từ catalog `TERRITORY_OWNER_REWARDS` cho member sect chiếm region. Idempotent qua `TerritoryOwnerRewardGrant` UNIQUE `(periodKey, regionKey, characterId)`. Worst-case 1 sect cả 9 region ≈ 3750 linhThach + 1870 EXP / member / tuần (≤ 50–100% mission daily income).
- **2026-05-09** — Phase 16.5 Daily Reward Cap — anti-abuse layer cho 3 nguồn chính (CULTIVATION / DUNGEON / MISSION). Per-character, per-day, per-source bucket `CharacterDailyRewardBucket` accum EXP + linhThach grant; cap scale theo realm tier. Service `RewardCapService.applyCapTx(tx, input)` race-safe qua Postgres `INSERT ... ON CONFLICT DO UPDATE` (atomic row-lock). Audit `RewardCapEvent` chỉ ghi khi `wasCapped=true`. Ledger ghi số THỰC grant (KHÔNG ghi requested). Day bucket reset Asia/Ho_Chi_Minh. **KHÔNG cap admin grant** — admin path không gọi service. Cap tier-1 (phamnhan): CULTIVATION 6000 EXP / DUNGEON 2400 EXP + 600 linh / MISSION 1500 EXP + 500 linh — đủ ~4–6h casual play. Tier kim_dan ×3, luyen_hu+ ×8.
- **2026-05-10** — Phase 14.1.C Arena Season + ELO + Reward — thêm source `linhThach` / `tienNgoc` / item `huyet_chi_dan|linh_lo_dan` qua **end-season reward mail** từ catalog `ARENA_SEASON_REWARD_TABLE` (5 tier BRONZE/SILVER/GOLD/DIAMOND/IMMORTAL). Idempotent qua `ArenaSeasonRewardGrant @@unique([seasonId, characterId])` — admin re-settle KHÔNG gây double-grant. **Cap economy/season/character**: max IMMORTAL = `5000 LT + 50 TN + 10 linh_lo_dan`, ~2-3 ngày tier-3 cultivation cap. **Tiên Ngọc** chỉ DIAMOND+ với cap 50 TN/season → KHÔNG cạnh tranh trực tiếp với topup revenue (base 100 TN/$1). Reward gửi qua `MailService.sendToCharacter` (cùng path với LiveOps mail) → ledger entry tự động khi player claim mail (`reason='MAIL_CLAIM'`). Settlement chỉ tạo `ArenaSeasonRewardGrant` row + mail; KHÔNG ghi ledger trực tiếp tại settle time (deferred to claim). Daily reward cap (Phase 16.5) KHÔNG áp cho season reward (one-time grant per season, không phải daily).
- **2026-05-10** — Phase 16.6 Economy Anti-cheat Suite — anti-cheat detection layer chuẩn bị closed beta. **Ledger Checker Cron** (`LedgerCheckerService` 5 invariant scan + cron 01:00 UTC daily, idempotent qua `EconomyLedgerCheckRun.dayBucket` UNIQUE) — 5 check methods: `checkCurrencyLedgerConsistency`, `checkItemLedgerConsistency`, `checkRewardCapConsistency`, `checkNegativeBalances`, `checkSuspiciousDelta24h`. **Economy Anomaly Scanner** (`EconomyAnomalyScannerService` 4 scan methods + cron 02:00 UTC daily/6h, idempotent qua `EconomyAnomaly @@unique([source, characterId, windowKey])`) — `scanTopCurrencyDelta24h`, `scanRareItemGain`, `scanRewardCapBypass`, `scanMarketOutlier`, plus real-time hook `scanAdminGrantOverLimit` từ `AdminService.grantCurrency`. **Market Price Band** — `MARKET_PRICE_BAND_BY_ITEM` + `DEFAULT_PRICE_BAND_BY_QUALITY` (5 rarity band: PHAM 10–1000, LINH 50–5000, HUYEN 200–50_000, TIEN 1000–500_000, THAN 5000–5_000_000 LT/unit), enforce ở `MarketService.postListing` reject với `PRICE_TOO_LOW`/`PRICE_TOO_HIGH`. Existing ACTIVE listings KHÔNG mutate. **Admin FE** — `AdminEconomySafetyPanel` tab mới (ADMIN role-gated), filter severity/status/source, button Run/Scan/Ack/Resolve. **Detection-only**: KHÔNG auto-ban / KHÔNG rollback / KHÔNG public notify. Default cron disabled local/test.

### 10.1 Daily Reward Cap design (Phase 16.5)

**Catalog**: `DAILY_REWARD_CAP_BY_REALM_AND_SOURCE` ở `packages/shared/src/daily-reward-cap.ts`:

```
phamnhan/luyenkhi/truc_co (×1):
  CULTIVATION  exp 6000   linh    0
  DUNGEON      exp 2400   linh  600
  MISSION      exp 1500   linh  500
kim_dan/nguyen_anh/hoa_than (×3):
  CULTIVATION  exp 18000  linh    0
  DUNGEON      exp  7200  linh 1800
  MISSION      exp  4500  linh 1500
luyen_hu/dai_thua/do_kiep (×8):
  CULTIVATION  exp 48000  linh    0
  DUNGEON      exp 19200  linh 4800
  MISSION      exp 12000  linh 4000
```

**Race safety**: dùng Postgres `INSERT ... ON CONFLICT DO UPDATE` thay vì CAS retry — Prisma interactive transaction abort cả tx khi P2002 (UNIQUE violation), nên CAS retry pattern không khả thi. ON CONFLICT DO UPDATE acquires row lock atomically; concurrent calls cùng `(characterId, dayBucket, source)` block chờ lock, sau đó đọc accum đã được commit → tính decision → update.

**Scope**: KHÔNG wire territory / daily login / season / topup (admin) trong PR này. KHÔNG làm anomaly scanner / market price band / admin alert (Phase 16.6+).

**API response shape**: claim endpoints trả thêm `{ capped: boolean, cappedAmount?: { exp, linhThach }, dailyCapRemaining: { exp, linhThach } }`. Pre-16.5 client KHÔNG crash vì FE dùng optional chaining.

### 10.2 Daily Reward Cap follow-ups

- **Phase 16.6 — Ledger Checker + Economy Anomaly Scanner**: scan `CurrencyLedger` daily anomaly, alert admin nếu 1 character vượt baseline (ví dụ: 10× percentile-99). Tận dụng `RewardCapEvent` audit trail.
- **Phase 16.7 — Market Price Band**: catalog min/max per item; auction reject listing ngoài band.
- **Phase 16.8 — Admin Grant Alert**: webhook khi admin grant > threshold (vd 100k linhThach).
- **Phase 16.9 — Territory + Daily Login + Season cap**: wire 3 nguồn còn lại nếu telemetry cho thấy abuse.
