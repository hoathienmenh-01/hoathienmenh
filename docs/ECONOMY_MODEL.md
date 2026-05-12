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


### 2.1.1 Phase 21 story content sources

Phase 21 adds static quest/mission catalogs only; it does not add a direct currency mutation path. Main/side/branch/hidden quest rewards and daily/weekly templates must continue to claim through existing quest/mission services and ledger/idempotency paths. Integrity tests cap Phase 21 daily/weekly templates and compare side/branch/hidden rewards against main quest baseline to avoid making optional content the dominant soft-currency source.


#### Sources

| Source | Endpoint / Service | Reason | Idempotency |
|---|---|---|---|
| Cultivation tick | `cultivation.processor.ts` | `CULTIVATION_TICK` | Per-tick (job already idempotent via BullMQ) — KHÔNG ghi ledger từng tick (chỉ ghi exp). **Note**: hiện tu luyện grant EXP, không grant linhThach. linhThach drop từ dungeon. |
| Dungeon monster kill | `combat.service.ts` `applyMonsterDrop` | `DUNGEON_DROP` | Per-encounter (Encounter.id) |
| Boss damage reward | `boss.service.ts` `distributeRewards` | `BOSS_REWARD` | Per `(bossId, characterId)` — verify với `BossDamage` row |
| Mission claim | `mission.service.ts` `claimReward` | `MISSION_CLAIM` | `MissionProgress.claimed` flag |
| Mail claim | `mail.service.ts` `claimMail` | `MAIL_CLAIM` | `Mail.claimedAt` not null |
| Territory owner reward (Phase 14.0.E) | `territory-reward.service.ts` `grantWeeklyOwnerRewardMail` → `mail.service.ts` `sendToCharacter` | `MAIL_CLAIM` (khi member claim mail) | `TerritoryOwnerRewardGrant` UNIQUE `(periodKey, regionKey, characterId)` — gọi lại cùng `periodKey` KHÔNG tạo mail mới |
| Sect Season Champion reward (Phase 15.7 → 15.8 snapshot rule) | `sect-season-reward.service.ts` `grantChampionForSeason` (cron + admin manual). Phase 15.8 — prefer `SectSeasonChampionSnapshot` membership; fallback current membership nếu snapshot missing (legacy pre-15.8) | `MAIL_CLAIM` (khi member claim mail) | `SectSeasonRewardGrant` UNIQUE `(seasonKey, 'CHAMPION', characterId)` — cap 100 member/sect/season theo characterId ASC; cron retry KHÔNG double; Phase 15.8 — member rời sect SAU snapshot vẫn nhận (audit-perfect) |
| Sect Season MVP reward (Phase 15.7) | `sect-season-reward.service.ts` `grantMvpForSeason` (cron + admin manual) | `MAIL_CLAIM` (khi MVP claim mail) | `SectSeasonRewardGrant` UNIQUE `(seasonKey, 'MVP', characterId)` — 1 character/season; cron retry KHÔNG double |
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
| **Equipment Reforge (Phase 15.0.A)** | `equipment.service.ts` `reforge` | `EQUIPMENT_REFORGE` |
| **Equipment Enchant (Phase 15.0.A)** | `equipment.service.ts` `enchant` | `EQUIPMENT_ENCHANT` |
| **Equipment Merge cost (Phase 23.4)** | `equipment-economy.service.ts` `mergeEquipment` | `EQUIPMENT_MERGE` |
| **Equipment Dismantle (Phase 23.4, refund only)** | `equipment-economy.service.ts` `dismantleEquipment` | `EQUIPMENT_DISMANTLE` (delta > 0) |
| **Gem Socket cost (Phase 23.4)** | `gem.service.ts` `socketGem` | `GEM_SOCKET_COST` |
| **Gem Unsocket cost (Phase 23.4)** | `gem.service.ts` `unsocketGem` | `GEM_UNSOCKET_COST` |
| Admin revoke | `admin.service.ts` `grantCurrency` (negative) | `ADMIN_REVOKE` |

##### Phase 15.0.A — Equipment Reforge / Enchant cost table (linhThach sink)

Cost ladder cho 2 sink mới — server compute deterministic qua `getReforgeCost(quality)` + `getEnchantCost(quality, currentLevel)`. Foundation phase TUNE để tổng linhThach ~ 2-3× shop NPC equivalent đã có (avoid soft-launch shock cho late-game player).

| Quality | Reforge linhThach (per reroll) | Enchant base (level 0→1) | Enchant max-level cost (level 4→5) | Material per op |
|---|---:|---:|---:|---|
| PHAM  | 80    | 100   | 500    | 1× `tinh_thiet` |
| LINH  | 240   | 320   | 1 600  | 2× `tinh_thiet` |
| HUYEN | 720   | 960   | 4 800  | 1× `yeu_dan` |
| TIEN  | 2 400 | 3 000 | 15 000 | 2-3× `yeu_dan` (reforge 2× / enchant 3×) |
| THAN  | 7 200 | 9 000 | 45 000 | 1× `han_ngoc` |

**Geometric step**: `enchantCost(level) = base × (level+1)` — level 0→1 = base, level 4→5 = 5× base. Late-level cảm thấy đắt nhưng KHÔNG vô lý (5× scale chấp nhận được vì cap level 5).

**Material economy**:
- `tinh_thiet` (`Tinh Thiết`) — drop từ low-tier dungeon ORE (Phase 11.4.B). PHAM/LINH-tier sink.
- `yeu_dan` (`Yêu Đan`) — drop từ HUYEN-tier dungeon + boss yêu thú. HUYEN/TIEN-tier sink.
- `han_ngoc` (`Hàn Ngọc`) — drop từ THAN-tier dungeon + world boss yêu thú. THAN-tier sink.

**Ledger reason mapping**:
- `CurrencyLedger.reason = 'EQUIPMENT_REFORGE' | 'EQUIPMENT_ENCHANT'` (kind=`linhThach`, delta < 0).
- `ItemLedger.reason = 'EQUIPMENT_REFORGE_COST' | 'EQUIPMENT_ENCHANT_COST'` (qtyDelta < 0, refType=`InventoryItem`, refId=`<inventoryItemId>`).
- 2 audit table song song: `EquipmentReforgeHistory` + `EquipmentEnchantHistory` lưu `beforeJson`/`afterJson`/`costJson` để admin replay nếu cần.

**Race protection**:
- Material: `prisma.inventoryItem.updateMany({ where: { id, qty: { gte: materialQty } }, data: { qty: { decrement: materialQty } } })` — count=0 → throw `INSUFFICIENT_MATERIAL`, tx rollback.
- Currency: `CurrencyService.applyTx(tx, characterId, kind, delta, ...)` đã có internal `gte` guard — race fail → throw `INSUFFICIENT_FUNDS`, tx rollback.
- 2 thread reforge cùng item song song → 1 thread thắng (1 history row), thread kia rollback hoàn toàn → KHÔNG double spend / KHÔNG double history audit.

##### Phase 23.2 — Equipment progression as long-term retention loop

The equipment economy uses realm-scaled tiers as the retention spine:
- 28 cultivation realms map to 10 equipment tiers; each tier/grade has `requiredRealmOrder`, so high-tier drops are aspirational until the character reaches the matching realm.
- Quality (`PHAM/LINH/HUYEN/TIEN/THAN`) is rarity within a tier, not the global power ladder. This prevents low-realm THAN gear from replacing higher-realm progression.
- Enhancement, sockets/gems, set bonuses, reforge, enchant, and Ngũ Hành affinity are sinks/build-depth systems. They must remain capped by item power budget and cannot bypass tier gates.
- Gem bonus envelope is ≤20% item power. Set bonus envelope is 2pc 3–5%, 4pc 6–10%, 6pc 10–15%/capped special. These percentages keep multi-item farming meaningful without invalidating realm progression.
- Server equip validation is authoritative (`EQUIPMENT_REALM_LOCKED`), so marketplace/trade/drop luck cannot let a low-realm character wear future-tier gear.

##### Phase 23.4 — Equipment Upgrade Economy / Resource Sink (linhThach sinks + material flows)

Phase 23.4 adds two new mutation sinks (merge / dismantle) and folds linhThach cost into gem socket / unsocket flows. All curves come from `packages/shared/src/equipment-upgrade-economy.ts`; the runtime services never hard-code costs.

| Operation | linhThach delta | Material delta | Item delta | Ledger row(s) |
| --- | --- | --- | --- | --- |
| Merge (3 same-quality → 1 next-quality) | `-200/-600/-1800/-6000 × tier` | `-2/-4 tinh_thiet × tier` (PHAM/LINH) / `-2 yeu_dan × tier` (HUYEN) / `-1 han_ngoc × tier` (TIEN) | delete 3 source rows, grant 1 output row | `CurrencyLedger.reason=EQUIPMENT_MERGE` + `ItemLedger.reason=EQUIPMENT_MERGE_{CONSUME,GRANT,COST}` |
| Dismantle | `+10/+30/+100/+300/+1000 × tier` | quality-scaled material yield | delete item row, return any socketed gems to inventory | `CurrencyLedger.reason=EQUIPMENT_DISMANTLE` (delta > 0) + `ItemLedger.reason=EQUIPMENT_DISMANTLE_{CONSUME,YIELD,RETURN_GEM}` |
| Gem socket | `-round(50 × tier × (1 + currentSocketCount × 0.5))` | none | mutate `InventoryItem.socketsJson` | `CurrencyLedger.reason=GEM_SOCKET_COST` + `ItemLedger.reason=GEM_SOCKET_COST_MATERIAL` if material consumed |
| Gem unsocket | `-round(100 × tier × (1 + currentSocketCount × 0.5))` | `-1 tach_ngoc_phu` | mutate `InventoryItem.socketsJson`, grant gem back | `CurrencyLedger.reason=GEM_UNSOCKET_COST` + `ItemLedger.reason=GEM_UNSOCKET_COST_MATERIAL` |
| Reforge (Phase 23.4 cap polish on Phase 15.0.A) | `-baseReforgeCost(quality) × 1.15 ^ min(reforgeCount, 20)` | unchanged from 15.0.A | unchanged | unchanged + `REFORGE_CAP_REACHED` throw when `reforgeCount ≥ maxReforgeCount(quality)` |

**Anti-infinite-sink invariant** (test-enforced): for any quality and tier, `dismantleYield × 3 < mergeCost` of the same input quality at the same tier. The economy strictly burns linhThach + material across a merge → dismantle round trip. The dismantle yield is **partial refund**, never net positive.

**Idempotency**: `mergeEquipment` / `dismantleEquipment` accept an optional `idempotencyKey` and record it on `ItemLedger.meta.idempotencyKey` and `CurrencyLedger.meta.idempotencyKey`. On retry with the same key, the service replays the prior ledger row instead of producing a second output / second refund. Mirror of the Phase 12 `QUEST_CLAIM` and Phase 13.1.A `SECT_WAR_REWARD` CAS pattern, but done through ledger meta (no schema migration needed).

**Race protection**: all mutations run inside `prisma.$transaction`. Source-item locking uses `updateMany({ where: { id, characterId, equippedSlot: null }, data: ... })` so a concurrent equip-during-merge produces a zero-row result and aborts the transaction without committing any partial ledger row.

**Feature flags**: `EQUIPMENT_MERGE_ENABLED` / `EQUIPMENT_DISMANTLE_ENABLED` allow ops to disable the new sinks instantly without redeploying if abuse is detected.

##### Phase 23.5 / 23.7 — Pháp Bảo Advanced Artifact progression

Phase 23.5 shipped catalog + preview for the Pháp Bảo (advanced artifact) slot. Phase 23.7 persists `phapBaoStarLevel`, `refineLevel`, and `phapBaoAwakenStage` on `InventoryItem` and moves star-up/awaken/refine into the dedicated server-authoritative Pháp Bảo mutation path. Equip still reuses `/inventory/equip` (Phase 23.2 realm gate enforces `requiredRealmOrder`).

| Operation | linhThach delta | Material delta | Mutation path | Status |
| --- | --- | --- | --- | --- |
| Equip pháp bảo (realm-gated) | 0 | 0 | `POST /inventory/equip` (existing) | DONE — reuse Phase 23.2 gate |
| Unequip pháp bảo | 0 | 0 | `POST /inventory/unequip` (existing) | DONE — no gate |
| Refine pháp bảo (luyện khí) | `-round(refineBase[tier] × qualityMultiplier × 1.4^level × PHAP_BAO_REFINE_COST_MULTIPLIER)` | tier material × `round(tier × (1 + level × 0.2))`; high level may require `refine_protection_charm` | `POST /character/phap-bao/:inventoryItemId/refine` | DONE Phase 23.7 — persisted `refineLevel`, ledger reason `PHAP_BAO_REFINE` |
| Star-up pháp bảo (thăng sao) | `-round(STAR_BASE_COST_BY_TIER[tier] × qualityMultiplier × (starLevel+1)^2)` | tier material × `round(tier × (starLevel+1) × 1.5)` + `phap_bao_shard` `5/10/20/40/80` | `POST /character/phap-bao/:inventoryItemId/star-up` | DONE Phase 23.7 — persisted `phapBaoStarLevel`, `starUpEnabled: true` |
| Awaken pháp bảo (thức tỉnh) | `-round(refineBase[tier] × qualityMultiplier × 5 × 2^awakenStage)` | tier material × `round(tier × (stage+1) × 2)` + `awaken_stone` × `(stage+1)×2` | `POST /character/phap-bao/:inventoryItemId/awaken` | DONE Phase 23.7 — persisted `phapBaoAwakenStage`, quality TIEN/THAN + tier ≥5 + star/refine/realm gated |

**Ledger / anti-duplicate**: every mutation runs in `prisma.$transaction`, consumes materials through `ItemLedger`, consumes linh thạch through `CurrencyLedger`, then mutates the source artifact with guarded `updateMany` including `id`, `characterId`, `phapBaoStarLevel`, `phapBaoAwakenStage`, `refineLevel`, and `locked=false`. If a duplicate/race changes state between cost consume and source update, `CONCURRENT_UPGRADE` aborts the transaction so no partial spend remains.

**Monetization-safe boundary (Phase 25.1 hook)**: premium drops may grant pháp bảo **within the same tier** as the player's current cảnh giới (never above `requiredRealmOrder`), mảnh / nguyên liệu luyện khí, and bảo hộ phù for refine stages ≥ risky. Premium **cannot** sell:
- Pháp bảo of higher `artifactTier` than allowed by character `realmOrder` (server enforces `canEquipPhapBao`).
- Max-star or max-awaken pháp bảo directly (must come from gameplay progression).
- Top-tier pháp bảo (`THAN` quality, tier 9–10) — these are gameplay-only drops in Phase 25.1 plan.

**Free-player path**: every pháp bảo in the catalog is obtainable through `source ∈ { quest, boss, dungeon, craft, event }` (premium_hook reserved for Phase 25.1 cosmetic skins / shard packages). Free players progress through refine on gameplay material; premium accelerates but cannot bypass realm gates or tier caps.

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
| Battle Pass | `BattlePassProgress.claimedFreeLevels` / `claimedPremiumLevels` per season/track/level; transaction grant after claim update |
| Monthly Card | `MonthlyCardSubscription.lastClaimAt < startOfUtcDay(now)` CAS via `updateMany`; 1 claim / UTC day |
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

### 3.7 Phase 25.1 monetization sources

Battle Pass, Monthly Card, and VIP Light are light monetization sources. They must preserve the same ledger/idempotency invariants as farmed rewards:

| Source | Reward path | Ledger reason | Ref |
|---|---|---|---|
| Battle Pass free/premium claim | `MonetizationService.claimBattlePassReward` / `claimAllBattlePassRewards` | `BATTLE_PASS_REWARD` | `BattlePassProgress`, refId `<seasonId>:<track>:<level>` |
| Monthly Card upfront/daily | admin grant + `claimMonthlyCard` | `MONTHLY_CARD_REWARD` | `MonthlyCardSubscription`, refId `<subscriptionId>:upfront:<ts>` or `<subscriptionId>:<day>` |
| Shop Pack purchase (tienNgoc sink) | `ShopPacksService.purchase` | `SHOP_PACK_PURCHASE` | `ShopPackPurchase`, UNIQUE `(characterId, packId, purchaseWindowKey)` + optional `idempotencyKey` |
| Shop Pack reward grant (linhThach/item source) | `ShopPacksService.purchase` / `adminGrantPack` | `SHOP_PACK_REWARD` | `ShopPackPurchase`, refId `<packId>:<windowKey>` |
| VIP Light grant | admin/test profile grant only; perks are derived read-only | `AdminAuditLog action=admin.vip.grant` | `VipProfile` |

Economy constraints:
- Reward grants go through `CurrencyService.applyTx` for `linhThach`, direct locked-premium ledger rows for `tienNgocKhoa`, and `InventoryService.grantTx` for items.
- Premium rewards are capped acceleration/convenience/cosmetic only; no direct top-tier equipment, no max-state pháp bảo, no realm/tier bypass.
- Monthly Card uses UTC day buckets explicitly; duplicate daily request returns `MONTHLY_CARD_ALREADY_CLAIMED` without extra ledger rows.
- Battle Pass duplicate level/track claims return `ALREADY_CLAIMED` without extra ledger/item rows.

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

### 4.7.A Phase 16.3 — Gameplay Anti-cheat Deep Detection (detection-only)

Anti-abuse layer bổ sung cho Phase 16.6 Economy Anti-cheat (`EconomyAnomaly`) bằng cách quan sát **per-module gameplay behavior**:

- Catalog: `packages/shared/src/gameplay-anticheat.ts` (`GAMEPLAY_ANOMALY_RULES`).
- Threshold + rationale: `docs/BALANCE_MODEL.md` §11.27.
- Service: `apps/api/src/modules/admin-anticheat/gameplay-anticheat.service.ts` — `scanAll({ now?, windowKey?, windowMs? })`.
- Bảng riêng `GameplayAnomaly` (migration `20260701000000_phase_16_3_gameplay_anomaly`) — KHÔNG gộp với `EconomyAnomaly`.
- Admin workflow: `docs/RUNBOOK.md` §2.33. API: `docs/API.md` §Admin Anti-cheat Gameplay.

**Liên quan currency**: 2 rule chạm currency/item ledger trực tiếp:

- `CURRENCY_GAIN_SPIKE` — Σ delta dương `CurrencyLedger` (linhThach) trong 1h ≥ 200k/1M.
- `ITEM_GAIN_SPIKE` — Σ qtyDelta dương `ItemLedger` trong 1h ≥ 100/500.
- `BOSS_REWARD_FARM` — đếm `CurrencyLedger.reason='BOSS_REWARD'` trong 24h ≥ 15/40.
- `REWARD_CAP_BYPASS_ATTEMPT` — đếm `RewardCapEvent` trong 1h ≥ 5/20.

**Detection-only invariants** (test enforced): scan KHÔNG mutate `Character.linhThach` / `Character.expCurrent` / `InventoryItem.qty` / `User.bannedAt`. KHÔNG auto-rollback, KHÔNG auto-refund, KHÔNG auto-deduct. Mọi remediation currency/item (revoke / refund / grant) vẫn phải qua endpoint admin có sẵn theo §3 Currency Service invariants + §4.6 Admin economy report.

### 4.7.B Phase 16.4 — Market Trade Abuse Hardening (detection-only)

Lớp anti-abuse bổ sung cho Phase 16.6 Market Price Band (`market-price-band.ts`). Phase 16.6 reject **listing post** ngoài band rarity (HTTP 409 `PRICE_TOO_LOW`/`PRICE_TOO_HIGH`); Phase 16.4 quan sát **pattern** xuyên flow market sau khi listing/trade đã commit thành công.

- Catalog: `packages/shared/src/market-trade-abuse.ts` — 6 type + classifier helpers + threshold catalog.
- Threshold + rationale: `docs/BALANCE_MODEL.md` §11.28.
- Service: `apps/api/src/modules/admin-market-abuse/market-trade-abuse.service.ts` — `scanAll({ now?, windowKey?, windowMs? })` + hook `recordListingCreate({ listingId })` / `recordListingBuy({ tradeId, listingId })`.
- Bảng riêng `MarketTradeAnomaly` (migration `20260801000000_phase_16_4_market_trade_anomaly`, additive only, KHÔNG backfill row cũ, KHÔNG FK). Idempotency: `@@unique([type, listingId, windowKey])`. Cho rule per-character per-window, `listingId=''` + `windowKey` scope hash.
- Admin workflow: `docs/RUNBOOK.md` §2.34. API: `docs/API.md` §Admin Market Trade Abuse.

**6 anomaly type**:

| Type | Severity ladder | Window | Nguồn data |
|---|---|---|---|
| `PRICE_EXTREME_LOW` | WARN ≤ 0.2 × ref, CRITICAL ≤ 0.05 × ref | per-listing | `Listing.pricePerUnit` vs `estimateItemReferencePrice(itemKey)` band-geomean (override khi DB có 7-day median). |
| `PRICE_EXTREME_HIGH` | WARN ≥ 5 × ref, CRITICAL ≥ 20 × ref | per-listing | như trên. |
| `REPEATED_BUYER_SELLER_PAIR` | WARN 3 / CRITICAL 10 (24h); WARN 10 / CRITICAL 30 (7d) | 24h + 7d | `MarketTrade` (cùng cặp `sellerCharacterId` × `buyerCharacterId`). |
| `LISTING_SPAM` | WARN 30 / CRITICAL 80 | 1h | `Listing.sellerCharacterId` count (ACTIVE/SOLD/CANCELLED). |
| `MARKET_VOLUME_SPIKE` | WARN ≥ 500_000 LT / CRITICAL ≥ 5_000_000 LT | 24h | Σ `MarketTrade.pricePerUnit × qty` của 1 character (cả seller hoặc buyer). |
| `UNKNOWN_REFERENCE_PRICE` | INFO | per-listing | item không có `ItemDef` hoặc reference price không tính được — admin manual review. |

**Hook policy**:
- `MarketService.post()` gọi `recordListingCreate` **post-tx** (sau khi listing đã insert thành công). Try/catch ở `MarketService` — detection throw KHÔNG rollback listing.
- `MarketService.buy()` gọi `recordListingBuy` **post-tx** (sau khi trade commit + currency/item ledger ghi xong). Try/catch fail-soft tương tự.
- Listing đã ACTIVE và buy `unitPrice` extreme: KHÔNG block, chỉ tạo anomaly để admin review.

**Detection-only invariants** (test enforced ở `market-trade-abuse.service.test.ts`):
- Scan / hook KHÔNG mutate `Listing` / `MarketTrade` / `CurrencyLedger` / `ItemLedger` / `Character` / `User`. Idempotency qua `@@unique` (P2002 → `totalSkipped++`).
- KHÔNG auto-rollback trade đã commit. KHÔNG tự refund currency / re-deliver item. KHÔNG block giao dịch tiếp theo.
- Mọi remediation (cancel listing, refund currency, ban) qua endpoint admin có sẵn (`/admin/users/:id/grant`, `/admin/users/:id/inventory/revoke`, ban endpoint).

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
- **2026-05-11** — Phase 15.8 LiveOps / Maintenance Polish — Champion reward semantic chuyển từ **current membership tại grant time** sang **membership snapshot tại finalize time** (bảng mới `SectSeasonChampionSnapshot` UNIQUE `(seasonKey, sectId, rank)`, cap 100 theo `characterId` ASC). `SectSeasonRewardService.grantSeasonRewards` query snapshot trước; nếu tồn tại → audit-perfect (member rời sect SAU snapshot vẫn nhận champion mail). Fallback **current membership** + log warning nếu snapshot missing (legacy season pre-15.8). `SectSeasonRewardGrantSummary.championUsedSnapshot` flag cho admin/cron summary. Idempotency unchanged — `SectSeasonRewardGrant` UNIQUE vẫn là single-source-of-truth, snapshot chỉ thay đổi tập member candidate. KHÔNG đổi reward catalog amount, KHÔNG đổi MVP semantic. Cron auto-run Phase 15.7 không đổi. Bảng audit mới `LiveOpsCronRunLog` cho cron health/stale tracking — không phát sinh currency/item.
- **2026-05-10** — Phase 15.7 Sect Season + Territory Auto-Cron + Champion/MVP Reward — thêm 2 source mail-based: `SECT_SEASON_CHAMPION_REWARD` (5000 LT + 2000 EXP + 2× `linh_lo_dan` / member sect rank-1, cap 100 member/season) và `SECT_SEASON_MVP_REWARD` (15000 LT + 6000 EXP + 1× `co_thien_dan` / top-1 cá nhân). Idempotent qua `SectSeasonRewardGrant` UNIQUE `(seasonKey, rewardType, characterId)` — cron retry hoặc multi-instance đua KHÔNG double mail (P2002 swallow). Race-safe (Redis lease optimistic + DB UNIQUE final). Worst-case 1 sect lớn nhận champion = 100 × 5000 LT = 500,000 LT/season ≈ 1,250 LT/tuần/member (dưới Sect War tier-1 weekly reward 5k LT). MVP per-season 15,000 LT ≈ 3,750 LT/tuần — vẫn dưới full weekly SectWar grand prize. Daily reward cap KHÔNG áp dụng (mail-based, không qua `MAIL_REWARD_CLAIM` source). KHÔNG issue tienNgoc/title/buff runtime. Cron auto-run Mon 00:05 ICT (territory) + daily 00:15 ICT (sect season), default OFF dev/test. Admin manual trigger `POST /admin/sect-season/cron/run-now` + `POST /admin/territory/cron/run-now` + combo `POST /admin/liveops/run-weekly-cycle` giữ làm fallback (cùng code path với cron).
- **2026-05-11** — Phase 16.1.B Ledger Checker Daily Cron + Economy Report Admin Endpoint — bổ sung báo cáo economy theo khoảng ngày trên hạ tầng Phase 16.6 đã có. **Shared catalog** `economy-report.ts` định nghĩa 29 source bucket (`EconomyReportSource`: MARKET, SHOP, SECT_SHOP, REFORGE_ENCHANT, ADMIN_GRANT, TOPUP, LIVEOPS_REWARD, DAILY_LOGIN, DUNGEON_REWARD, BOSS_REWARD, TERRITORY_REWARD, SECT_SEASON_REWARD, SECT_WAR_REWARD, MISSION_REWARD, QUEST_REWARD, GIFTCODE_REWARD, MAIL_REWARD, TRIBULATION_REWARD, STORY_REWARD, NPC_REWARD, ACHIEVEMENT_REWARD, COMBAT_LOOT, CULTIVATION, SKILL_SPEND, REFINE_SPEND, ALCHEMY_SPEND, GEM_SPEND, INITIAL, OTHER) + mapping `LEDGER_REASON_TO_SOURCE` (50+ reason → bucket, unknown fail-soft → OTHER). **API endpoint** `GET /admin/economy/range-report?from=&to=` (ADMIN, default last 7d, max 31d UTC) trả: range, bySource (in/out/net + entryCount, sort DESC |net|), totals, top 10 character delta, 11 high-level totals (market volume, shop spend, sect shop spend, reforge-enchant, admin grant, topup, liveops reward, daily login, dungeon reward, boss reward, territory reward, sect season reward), anomaly summary (all-time để admin spot hot anomaly), latest `EconomyLedgerCheckRun`, generatedAt. Audit `ADMIN_ECONOMY_REPORT_VIEW`. **FE panel** `AdminEconomyRangeReportPanel.vue` dưới tab Economy: date range picker, Load Report + Run Ledger Check Now buttons, 5 summary cards + 10 category totals + source/top-delta tables, loading/error/empty states, i18n VI/EN parity. Read-only — KHÔNG mutate DB. KHÔNG đổi cron / Prisma model / threshold Phase 16.6.
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

## Arena anti-wintrade detection — Phase 14.1.D

Lớp detection-only chống wintrade trong Arena. Phát hiện 5 pattern bất thường, tạo `ArenaWintradeAlert` cho admin review. **KHÔNG** auto-ban, **KHÔNG** auto-rollback reward — alert trước, xử lý thủ công sau.

**Tích hợp với reward flow**:

- Reward eligibility flag `NORMAL` / `REVIEW_REQUIRED` đã định nghĩa ở `arena-anti-wintrade.ts` nhưng chưa wire vào `ArenaSeasonService.settleSeason` (Phase 14.1.D scope giới hạn). Khi player có alert CRITICAL OPEN tại lúc settle, admin có thể manual gate reward thông qua panel trước khi gọi settle.
- Reward đã settle (đã gửi mail) khi phát hiện abuse → revoke thủ công qua `POST /admin/users/:id/grant` với delta âm (mục 2.15 RUNBOOK + reference alert ID + match IDs).
- KHÔNG có path tự động unmail / un-grant trong Phase 14.1.D — quá rủi ro nếu detect sai. Admin xác minh tay rồi mới revoke.

**Policy tóm tắt**:

| Severity | Auto-action | Admin action mong đợi |
|---|---|---|
| INFO | none | observe trên panel, không cần touch |
| WARN | none | review match history; resolve nếu legit, ack nếu cần theo dõi |
| CRITICAL | none | review chi tiết, link account check; quyết định ban + reward revoke thủ công |

**TODO Phase 14.1.E hoặc sau**:
- Wire `rewardEligibility = REVIEW_REQUIRED` vào settle pipeline (auto-skip mail nếu alert CRITICAL OPEN trên character).
- Cron auto-scan (`ARENA_ANTI_WINTRADE_CRON_*` env reserved sẵn).
- Full season-wide scope cho `SEASON_SUSPICIOUS_ACTOR` (hiện 24h rolling).

## LiveOps Event Scheduler — Phase 15.1–15.2

Admin tạo / schedule event runtime KHÔNG cần deploy code. Lớp này phải tôn trọng economy invariants:

- **Multiplier cap server-side**: drop/exp ≤ 2.0, discount ≤ 0.5 — vượt cap reject (`EVENT_MULTIPLIER_OVER_CAP`) ở shared validator. Defense-in-depth: runtime cũng clamp khi reload (vd seed bypass / migration cũ).
- **Compose policy**: 2 event cùng type ACTIVE → max-only, KHÔNG stack multiplicative. Vd 2 event `DOUBLE_DUNGEON_DROP` 1.5× và 1.8× → áp 1.8× (không 2.7×).
- **Daily reward cap (Phase 16.5) vẫn ràng buộc**: event boost chỉ áp pre-cap. Sau khi compose `liveOpsDropMultiplier`, ledger insert đi qua `RewardCapService.consumeQuota` → vẫn bị cắt theo per-source cap. Vd dungeon claim base 200 LT × 1.5 (event) = 300 LT, nhưng nếu tier-1 player còn 100/2400 daily quota → grant 100 LT, cap còn lại 0.
- **Audit ledger**: `meta.dungeon.liveOpsDropMultiplier` + `liveOpsLinhThachBonus` ghi vào `CurrencyLedger.meta.dungeon` để replay/forensics. Cultivation tick chưa ghi (gain trộn vào `CULTIVATION_TICK` reason — defer Phase 15.3 nếu cần).
- **Admin audit**: mọi mutation event qua `AdminAuditLog` (`ADMIN_LIVEOPS_EVENT_CREATE/UPDATE/DISABLE/RECOMPUTE`) — không có path bypass.

**KHÔNG có** Phase 15.1–15.2:
- KHÔNG auto-ban / auto-rollback nếu admin disable event giữa chừng (linh thạch đã cấp = giữ).
- KHÔNG wire runtime cho `SHOP_DISCOUNT`/`SECT_SHOP_DISCOUNT`/`DAILY_LOGIN_BONUS`/`BOSS_REWARD_BOOST`/`FESTIVAL_GIFT` — defer Phase 15.3+.
- KHÔNG event reward over-power: cap 2.0× boost đảm bảo không phá curve, cap 0.5 discount đảm bảo currency sink vẫn dương.

## LiveOps Runtime Expansion + Festival Gift — Phase 15.3.A

Phase 15.3.A hoàn thiện 5/7 event type còn lại để 7/7 wire runtime thật. Reward
caps + invariants:

- **`SHOP_DISCOUNT`** (≤ 0.5): `ShopService.buyFromShop` áp `finalPrice = ceil(originalPrice × (1 − mul))`. CurrencyLedger ghi `finalPrice` thực chi (KHÔNG ghi `originalPrice` ở reason). Audit `meta.shop.liveOpsDiscount` + `liveOpsEventKey` cho replay. Discount KHÔNG cho phép giá xuống 0 nếu balance design không cho phép — `Math.max(1, finalPrice)` floor 1 LT để vẫn còn currency sink.
- **`SECT_SHOP_DISCOUNT`** (≤ 0.5): `SectShopService.buyFromSectShop` áp tương tự cho cost contribution + linh thạch sect shop. **KHÔNG bypass** daily/weekly limit + contribution requirement (kiểm tra trước discount, sau discount có thể vẫn `INSUFFICIENT_CONTRIBUTION` nếu player < cost final).
- **`DAILY_LOGIN_BONUS`** (≤ 2.0): `DailyLoginService.claimToday` áp multiplier vào reward. **Daily Reward Cap (Phase 16.5) thắng** — bonus đi qua `RewardCapService.consumeQuota`. Vd cap còn 100, event x2.0 trên reward 80 → grant `min(160, 100) = 100`. Idempotent qua UNIQUE `(characterId, dateLocal)` — retry trong cùng ngày → 200 với `claimed=false` (KHÔNG double).
- **`BOSS_REWARD_BOOST`** (≤ 2.0): `BossRewardService.distributeRewards` áp multiplier vào reward attribution rank. Mail metadata `liveOpsBoostMultiplier` + `liveOpsEventKey`. Boss attribution (Top damage / participation rank) cap KHÔNG đổi — event chỉ scale grant cuối cùng.
- **`FESTIVAL_GIFT`** (one-time claim): UNIQUE `(eventId, characterId)` cho idempotency. Reward atomically `LiveOpsEventRewardClaim` + CurrencyLedger (`reason='LIVEOPS_EVENT_FESTIVAL_GIFT'`) + ItemLedger trong 1 `$transaction`. Reward caps server-side:
  - `linhThach ≤ 1000`
  - `tienNgoc ≤ 50`
  - `items ≤ 10 entries × qty ≤ 50`

  Validate cả admin create-time + claim-time (defense-in-depth — nếu DB row corrupted hay admin update sau create → vẫn safe). Codes: `EVENT_REWARD_JSON_REQUIRED/INVALID/EMPTY/OVER_CAP/ITEM_INVALID/QTY_INVALID/CURRENCY_INVALID`.

**Compose policy**: max-only (giữ nguyên Phase 15.1–15.2). Multi-event cùng
type ACTIVE → multiplier tốt nhất, KHÔNG stack multiplicative.

**Fail-soft**: nếu LiveOps service unavailable → runtime fallback `1.0` (BOOST)
hoặc `0` (DISCOUNT) → no-op cho gameplay flow, KHÔNG block player.

**Audit replay**: festival claim ghi `LiveOpsEventRewardClaim.rewardJson`
snapshot → có thể replay grant nếu cần forensics. Currency/Item ledger entries
liên kết qua `meta.liveOps.eventKey` + `meta.liveOps.claimId`.

**KHÔNG có** Phase 15.3.A:
- KHÔNG bypass Daily Reward Cap (cap thắng cho mọi BOOST event).
- KHÔNG cho festival gift cấp item market-disrupting (cap 50 qty/entry × 10 entries giới hạn tổng giá trị).
- KHÔNG auto-rollback grant đã cấp nếu admin disable event sau (audit-only).
