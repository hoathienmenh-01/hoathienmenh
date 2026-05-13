# Xuân Tôi — Monetization Model

> **Status**: Live design contract for Phase 27.0 (Foundation) + Phase 27.1–27.5 (Systems V1).
> Source of truth cho **runtime hành vi** là code @ `packages/shared/src/monetization-foundation.ts` + `packages/shared/src/monetization-systems.ts` + `apps/api/src/modules/monetization/*.service.ts`.
> Sister docs: [`BALANCE_MODEL.md`](./BALANCE_MODEL.md), [`ECONOMY_MODEL.md`](./ECONOMY_MODEL.md), [`API.md`](./API.md).

Mục tiêu: bất kỳ ai trước khi thêm sản phẩm premium / entitlement / shop item phải đọc file này để biết **anti-P2W invariant** + **server-authoritative flow** + **caps**.

---

## 1. NGUYÊN TẮC LỚN

### 1.1 Triết lý monetization

Game Xuân Tôi là game tu tiên dạng text. Người chơi trả tiền vì:

- Tiết kiệm thời gian.
- Giảm thao tác lặp lại.
- Thêm lượt có giới hạn.
- Nhận quà mỗi ngày (login retention).
- Tiến trình dài hạn (growth fund theo cảnh giới, battle pass theo mùa).
- Tiện ích kho/túi/chợ/hàng chờ luyện đan.
- Pass mùa + danh vọng.

**TUYỆT ĐỐI KHÔNG**:

- Mua thắng trực tiếp.
- Mua pháp bảo top hoàn chỉnh.
- Mua công pháp Chí Tôn hoàn chỉnh.
- Mua nguyên liệu endgame số lượng vô hạn.
- Bỏ toàn bộ giới hạn farm.
- Premium tăng rare drop không giới hạn.
- VIP/nạp tiền tăng damage/drop rate trực tiếp.

### 1.2 Anti-P2W invariant

- `ENTITLEMENT_VALUE_CAPS` (`packages/shared/src/monetization-foundation.ts`) khoá giá trị tối đa cho mỗi entitlement key — premium chỉ extend convenience trong giới hạn này, KHÔNG bypass cap drop hay cap reward.
- `MONETIZATION_ITEM_REWARD_MAX_QTY` (`packages/shared/src/monetization-systems.ts`) khoá số lượng item tối đa trong 1 reward để chống lạm phát.
- `FORBIDDEN_REWARD_ITEM_KEYS` block danh sách endgame item (pháp bảo top, công pháp chí tôn hoàn chỉnh, đan vân endgame) khỏi reward catalog.
- `validateMonetizationSystemsCatalog()` chạy trong test khoá invariant — fail nếu catalog leak endgame item.
- Battle pass paid track / growth fund / limited shop reward đều đi qua validator.

### 1.3 Server-authoritative + ledger

- Mọi purchase / claim / reward grant chạy trong `$transaction` Serializable.
- Mọi cộng trừ tiền tệ qua `CurrencyService.applyTx` + ledger row (`linhThachLedger`, `tienNgocLedger`, …).
- Mọi grant item qua `InventoryService.grantTx` với `ItemLedgerReason` enum (`MONETIZATION_SHOP_BUY` / `MONETIZATION_MONTHLY_CARD_BUY` / `MONETIZATION_GROWTH_FUND_CLAIM` / `MONETIZATION_BATTLE_PASS_CLAIM` / `MONETIZATION_LIMITED_SHOP_BUY`).
- Idempotent: `BattlePassMissionProgress` UNIQUE `(characterId, seasonId, missionKey, scopeBucket)` chống double claim per period bucket. `LimitedShopPurchase` UNIQUE `(characterId, shopKey, itemKey, periodKey)` chống double-spend per period.

---

## 2. WALLET CURRENCIES (Phase 27.0)

Định nghĩa: `packages/shared/src/monetization-foundation.ts` → `WalletCurrencyKey`.

| Key | Loại | Premium? | Nguồn | Ledger |
|---|---|---|---|---|
| `TIEN_NGOC` | Premium hard | ✅ Real money | Mock purchase (dev) / IAP (future) | `tienNgocLedger` |
| `TIEN_NGOC_KHOA` | Premium bound | ✅ | Battle pass / event / monthly card / quest | `tienNgocLedger` (bound flag) |
| `LINH_THACH` | Soft | ❌ | Farm / dungeon / boss / quest | `linhThachLedger` |
| `CONG_HIEN_TONG_MON` | Soft (sect) | ❌ | Sect missions / sect contribution | `Character.congHienTongMon` |
| `TRIAL_POINT` | Soft (tower) | ❌ | Trial tower clear / milestone | `Character.trialPoint` |
| `EVENT_TOKEN` | Soft (event) | ❌ | Event participation | `Character.eventToken` |

Note: `TIEN_NGOC_KHOA` ("Tiên Ngọc khoá") là premium currency bound — không trade được, chỉ dùng trong shop premium. Tách bạch giữa "earned premium" (khoá) vs "purchased premium" (`TIEN_NGOC`) để cân bằng.

---

## 3. ENTITLEMENTS (Phase 27.0)

9 entitlement keys, mỗi key có `ENTITLEMENT_VALUE_CAPS` ràng buộc runtime:

| Key | Cap | Wire vào |
|---|---|---|
| `AUTO_FARM_EXTENDED` | 24*60 minutes | `FarmService.startSession` |
| `AUTO_FARM_AUTO_CONTINUE` | boolean | `FarmService` resume logic |
| `DAILY_FARM_EXTRA_ATTEMPT` | +2 / day | `WorldCapService` |
| `DUNGEON_EXTRA_ATTEMPT` | +2 / day | `DungeonRunService` |
| `PERSONAL_BOSS_EXTRA_ATTEMPT` | +1 / day | `BossService` |
| `SWEEP_TICKET_DAILY` | +2 / day | `SweepTicketService` daily grant |
| `ALCHEMY_QUEUE_SLOT_BONUS` | +1 slot | `AlchemyService` queue |
| `INVENTORY_SLOT_BONUS` | +20 slot | `InventoryService` capacity |
| `MARKET_FEE_REDUCTION` | -10% (floor 5%) | `MarketService` fee compute |

Storage: `PremiumEntitlement` table — UNIQUE `(characterId, entitlementKey)`, `valueJson`, `expiresAt` (NULL = permanent, timestamp = thẻ tháng 30 ngày).

**Quy tắc**: entitlement chỉ ADD bonus, KHÔNG thay đổi base cap. Cap luôn enforce SAU khi cộng bonus.

---

## 4. MONTHLY CARDS

Định nghĩa: `MONTHLY_CARD_VARIANTS` (`monetization-foundation.ts`).

| Variant | Tên | Giá | Thời hạn | Daily claim | Entitlement chính |
|---|---|---|---|---|---|
| `tieu_nguyet_tap` | Tiểu Nguyệt Tạp | 99 TIEN_NGOC | 30 ngày | `TIEN_NGOC_KHOA` x30 | `AUTO_FARM_EXTENDED` 8h, `DAILY_FARM_EXTRA_ATTEMPT` +1, `SWEEP_TICKET_DAILY` +1, `ALCHEMY_QUEUE_SLOT_BONUS` +1 |
| `dai_nguyet_tap` | Đại Nguyệt Tạp | 199 TIEN_NGOC | 30 ngày | `TIEN_NGOC_KHOA` x80 | `AUTO_FARM_EXTENDED` 24h, `DUNGEON_EXTRA_ATTEMPT` +1, `PERSONAL_BOSS_EXTRA_ATTEMPT` +1, `SWEEP_TICKET_DAILY` +2, `INVENTORY_SLOT_BONUS` +20, `MARKET_FEE_REDUCTION` -10% |

Có thể mua song song. Daily claim 1 lần / UTC day. Missed claim **không bù**.

---

## 5. SWEEP TICKETS

Items: `sweep_ticket_common` / `sweep_ticket_dungeon` / `sweep_ticket_daily_farm` / `sweep_ticket_personal_boss`.

**Dùng cho**: dungeon đã clear, daily farm map đã clear, personal boss đã từng thắng. Quét vẫn tốn lượt + cap.

**KHÔNG dùng cho**: world boss, hourly boss, event ranking, tầng tháp chưa vượt, boss quest lần đầu.

Server check: `SweepTicketService.useTicket` validate `SWEEPABLE_CONTENT_TYPES` + content cleared state.

---

## 6. EXTRA ATTEMPTS

`ExtraAttemptDef` (foundation): per content type, có `maxDailyPurchase`. Daily cap CAS qua `PaidLimitPurchase` UNIQUE `(characterId, limitKey, periodKey)`.

Default:
- Daily farm: max +2/day premium TIEN_NGOC_KHOA.
- Dungeon thường: max +2/day.
- Personal boss: max +1/day.
- **World/hourly/event boss**: KHÔNG cho mua thêm reward chính.

---

## 7. BATTLE PASS V2 (Phase 27.1–27.5)

`BATTLE_PASS_MISSIONS_V1` (`monetization-systems.ts`) — 11 missions:

| Scope | Count | Exp range |
|---|---|---|
| DAILY | 4 | 20–50 |
| WEEKLY | 4 | 100–200 |
| SEASON | 3 | 300–500 |

Free track + paid track (unlock 99 TIEN_NGOC / season). Paid track reward: `TIEN_NGOC_KHOA`, vé quét, đan hỗ trợ tier cap, mảnh công pháp/công thức trung, rương luyện thể/pháp bảo cấp thấp/trung. **KHÔNG bán**: pháp bảo top, công pháp chí tôn hoàn chỉnh, đan vân endgame.

Storage: `BattlePassMissionProgress` UNIQUE `(characterId, seasonId, missionKey, scopeBucket)`. `scopeBucket` = `periodKey(now, 'DAILY' | 'WEEKLY')` hoặc `seasonId` (SEASON). Claim 1 lần per bucket.

API: `BattlePassV2Service.listMissions / addProgress / unlockPaidTrack`.

---

## 8. GROWTH FUND V2 (Phase 27.1–27.5)

`GROWTH_FUND_V2_VARIANTS` (`monetization-systems.ts`) — variant `tien`:

5 milestones theo realmOrder Luyện Hư → Nhân Tiên. Mua 1 lần (`GrowthFundState.purchased=true`), claim khi đạt mỗi cảnh giới.

**KHÔNG cho claim**: pháp bảo top hoàn chỉnh, công pháp chí tôn, nguyên liệu endgame số lượng lớn. Tất cả reward đi qua `validateMonetizationSystemsCatalog()`.

API: `GrowthFundService.getFund / claimMilestone` (Serializable, gate realmOrder, idempotent qua `claimedMilestonesJson`).

---

## 9. LIMITED PERIODIC SHOP V1 (Phase 27.1–27.5)

`LIMITED_SHOP_ITEMS` (`monetization-systems.ts`) — 9 items × 3 shops:

| Shop | Period | Items |
|---|---|---|
| `daily_shop` | DAILY | 3 items (sweep ticket common, đan hồi phục cấp thấp, mảnh công pháp cơ bản) |
| `weekly_shop` | WEEKLY | 3 items (rương nguyên liệu tier trung capped, đá luyện pháp bảo cấp thấp, mảnh công thức trung) |
| `monthly_shop` | MONTHLY | 3 items (vé quét dungeon, lượt bí cảnh extra, danh hiệu mùa cosmetic) |

Mỗi item có `purchaseLimitCount` per period. Storage: `LimitedShopPurchase` UNIQUE `(characterId, shopKey, itemKey, periodKey)`. `periodKey` từ `periodKey(now, period)` đồng bộ server+client UTC.

Server check: `LimitedShopService.purchase` chạy Serializable, lookup count hiện tại, validate < limit, debit wallet, grant reward, upsert log.

**KHÔNG bán**: pháp bảo top, công pháp chí tôn hoàn chỉnh, nguyên liệu endgame vô hạn, đan vân endgame, boss drop hiếm không cap.

---

## 10. MONETIZATION OVERVIEW (Phase 27.1–27.5)

`MonetizationOverviewService.overview(characterId, now)` — read-only aggregator trả snapshot UI:

- `wallet` — 6 currency balance.
- `entitlements` — active list.
- `monthlyCards` — active list + còn bao nhiêu ngày + daily claim status.
- `sweepTickets` — count theo loại.
- `extraAttempts` — count đã mua per content type per day.
- `battlePass` — current season + level + exp + missions summary.
- `growthFunds` — list variant + purchased + claimedMilestones.
- `limitedShops` — list shop + items + purchaseCount + purchaseLimit.

API: `GET /monetization/overview`.

---

## 11. PURCHASE FLOW (Mock / Dev)

Hiện tại CHƯA tích hợp payment gateway thật. Dev / admin có thể grant entitlement qua admin endpoint hoặc seed. Production phải block `mock-purchase` endpoint qua env flag.

Khi tích hợp real IAP (Apple App Store / Google Play / Stripe):
1. Validate receipt server-side.
2. Map productKey → entitlement / reward.
3. Chạy purchase flow giống `MonetizationShopService.purchase` (Serializable, debit, grant, ledger).
4. Idempotent qua `externalOrderId` UNIQUE.

---

## 12. ANTI-P2W TEST GUARDRAIL

Test bắt buộc (`packages/shared/src/monetization-systems.test.ts` + `monetization-foundation.test.ts`):

- `validateMonetizationCatalog` pass.
- `ENTITLEMENT_VALUE_CAPS` không có entry > runtime cap.
- `LIMITED_SHOP_ITEMS` / `BATTLE_PASS_MISSIONS_V1` reward không chứa `FORBIDDEN_REWARD_ITEM_KEYS`.
- Mỗi item reward qty ≤ `MONETIZATION_ITEM_REWARD_MAX_QTY`.
- Growth fund milestone realmOrder monotonic tăng.
- Shop period mapping (daily → DAILY, weekly → WEEKLY, monthly → MONTHLY).
- Battle pass paid unlock cost > 0.
- Sweep ticket key ∈ `SWEEP_TICKET_KEYS`.

Service test (Postgres integration):

- `BattlePassV2.addProgress` cùng `scopeBucket` 2 lần → exp chỉ cộng 1 lần.
- `LimitedShop.purchase` quá `purchaseLimitCount` → trả `PURCHASE_LIMIT_REACHED`.
- `GrowthFund.tien.claim` chưa đạt realm → trả `MILESTONE_LOCKED`.
- `MonetizationOverview` trả đủ field.

---

## 13. ROADMAP / FUTURE

- **Phase 27.6**: Real payment gateway integration (Stripe test mode → IAP).
- **Phase 27.7**: Event pass + seasonal collaboration pass.
- **Phase 27.8**: Marketplace fee dial (admin-tuned).
- **Phase 28**: Auction house (chưa phase này — defer).

---

## 14. KHÔNG LÀM TRONG MONETIZATION PR

- Không thêm sản phẩm bán pháp bảo top / công pháp chí tôn hoàn chỉnh / nguyên liệu endgame vô hạn.
- Không cho premium farm vô hạn reward.
- Không cho VIP tăng damage/drop rare trực tiếp.
- Không bypass `RewardCapService` / `WorldCapService`.
- Không hard-code price/reward — phải catalog định nghĩa shared.
- Không tắt anti-P2W test.
