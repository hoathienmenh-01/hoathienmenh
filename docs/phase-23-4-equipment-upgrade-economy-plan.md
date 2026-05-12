# Phase 23.4 — Equipment Upgrade Economy / Resource Sink Plan

## Goal

Sau Phase 23.2 (tier ladder + `requiredRealmOrder` + `powerBudget`) và Phase 23.3 (set bonus 2/4/6 + gear resonance Ngũ Hành), Phase 23.4 đóng vai trò **economy / resource sink** cho trang bị: chuẩn hoá cost của các thao tác nâng cấp đã có (refine / reforge / enchant / gem socket) và thêm 2 sink mới (**merge / ghép phẩm** và **dismantle / phân giải**) để:

1. Giảm độ phẳng inventory: đồ phẩm thấp có đường ra qua merge hoặc dismantle thay vì rác.
2. Cho người chơi cảm giác "đầu tư" trang bị cuối tier trước khi đẩy lên tier kế tiếp.
3. Mở hook **bảo hộ phù / protection charm** monetization-safe cho Phase 25.1 (Battle Pass / Monthly Card / VIP Light) mà không ép thêm failure system phức tạp ngay bây giờ.

Không phá vỡ Phase 23.2 / 23.3 progression, không bypass economy/ledger, không mở rộng Book II–V.

## Scope

### Shared (`packages/shared/src/equipment-upgrade-economy.ts`)

Helper deterministic, không IO. Cost dựa trên `equipmentTier`, `quality`, `slot`, `currentEnhanceLevel`, `socketCount`, `reforgeCount`, item power score (Phase 23.2 `computedPowerScore`):

- `getEquipmentEnhanceCost(input)` — chuẩn hoá curve cường hóa (refine) trên nền `REFINE_LEVELS` + tier weight + quality multiplier + slot weight.
- `getEquipmentMergeCost(input)` — cost ghép 3 món cùng tier/slot/quality/item family → 1 món quality cao hơn. Bao gồm linhThach + tinh thiết (LINH) / yêu đan (HUYEN) / hàn ngọc (TIEN) tuỳ tier.
- `getEquipmentDismantleYield(input)` — yield phân giải theo tier × quality × slot. Tổng yield **luôn < cost tạo cùng item** (anti-infinite sink).
- `getGemSocketCost(input)` — cost khảm gem (linhThach scale theo `equipmentTier` × `socketCount`).
- `getGemUnsocketCost(input)` — cost tháo gem (linhThach + optional `tach_ngoc_phu`).
- `getReforgeCost(input)` — wrap legacy `getReforgeCost(quality)` cộng thêm `reforgeCount` growth (cap theo tier/quality).
- `getProtectionCharmRequirement(input)` — quyết định mốc cường hóa nào cần protection charm (mặc định stage `extreme` của refine, optional cho `risky` high-tier).
- `validateEquipmentUpgradeRequest(input)` — check cap `maxEnhanceLevel`, ownership flags (equipped/locked), tier match.
- `validateEquipmentMergeRequest(items)` — check 3-món cùng tier/slot/quality/family, không equipped, không locked, không vượt cap THAN, không cross-tier.
- `validateDismantleRequest(input)` — check không equipped, không locked, không vượt limit/transaction.

### API runtime

- Thêm `EquipmentEconomyService` (`apps/api/src/modules/character/equipment-economy.service.ts`) cung cấp 4 method server-authoritative:
  - `mergeEquipment(characterId, inventoryItemIds[], idempotencyKey?)` — atomic transaction: lock 3 source items qua `updateMany` guard, consume material/currency qua `CurrencyService.applyTx` + `ItemLedger`, delete 3 source rows, grant 1 output row.
  - `dismantleEquipment(characterId, inventoryItemId, idempotencyKey?)` — atomic transaction: detach gems (return to inventory) → delete item row → grant material yield + linhThach yield → ghi ledger.
  - `mergePreview(characterId, inventoryItemIds[])` — read-only.
  - `dismantlePreview(characterId, inventoryItemId)` — read-only.
- Wire vào `CharacterController`:
  - `POST /character/equipment/merge` (+ feature flag `EQUIPMENT_MERGE_ENABLED`).
  - `POST /character/equipment/dismantle` (+ feature flag `EQUIPMENT_DISMANTLE_ENABLED`).
  - `POST /character/equipment/merge-preview`.
  - `POST /character/equipment/dismantle-preview`.
- Cập nhật `GemService.socketGem` / `unsocketGem` để **trừ thêm linhThach cost** qua `CurrencyService.applyTx` + ghi `CurrencyLedger` reason `GEM_SOCKET_COST` / `GEM_UNSOCKET_COST`. Vẫn giữ atomic transaction cũ.
- Cập nhật `EquipmentService.reforge` để track `reforgeCount` qua `EquipmentReforgeHistory` (count theo `inventoryItemId`) — cap theo `getReforgeCost(input).maxReforgeCount`. Nếu vượt → throw `REFORGE_CAP_REACHED`.

Idempotency:

- Merge / dismantle accept optional `idempotencyKey` (string) đầu input. Nếu present, ghi vào `ItemLedger.meta.idempotencyKey` + `CurrencyLedger.meta.idempotencyKey`. Trước khi mutate, check `ItemLedger.findFirst({ reason: 'EQUIPMENT_MERGE'|'EQUIPMENT_DISMANTLE', meta_path['idempotencyKey'] = key })` → nếu đã có thì return previous result thay vì mutate lần 2.
- Pattern mirror Phase 12 `QUEST_CLAIM` / Phase 13.1.A `SECT_WAR_REWARD` CAS guard nhưng dùng ledger meta thay vì dedicated table (giữ Prisma schema không migration trong PR này).

Ledger / reasons (mở rộng `ItemLedgerReason` + `LedgerReason`):

- ItemLedgerReason: `EQUIPMENT_MERGE_CONSUME`, `EQUIPMENT_MERGE_GRANT`, `EQUIPMENT_MERGE_COST`, `EQUIPMENT_DISMANTLE_CONSUME`, `EQUIPMENT_DISMANTLE_YIELD`, `EQUIPMENT_DISMANTLE_RETURN_GEM`, `GEM_SOCKET_COST_MATERIAL`, `GEM_UNSOCKET_COST_MATERIAL`.
- LedgerReason (`CurrencyLedger`): `EQUIPMENT_MERGE`, `EQUIPMENT_DISMANTLE`, `GEM_SOCKET_COST`, `GEM_UNSOCKET_COST`.

### UI

- `apps/web/src/views/InventoryView.vue` — thêm nút **Ghép phẩm** + **Phân giải** ở item detail panel, hiển thị cost + nguyên liệu thiếu + confirm modal cho dismantle phẩm cao (TIEN+) / merge.
- `apps/web/src/components/EquipmentEconomyPanel.vue` (mới) — read-only preview: enhance cost / merge cost / dismantle yield của item đang chọn.
- i18n vi/en parity (`inventory.economy.*`).
- Loading / empty / error states (UI MODULE RULE).
- Mobile responsive.

### Tests

Shared (`packages/shared/src/equipment-upgrade-economy.test.ts`):

- `getEquipmentEnhanceCost`: cost tăng theo `currentEnhanceLevel` + tier + quality + slot weight.
- `getEquipmentMergeCost`: cost tăng theo tier; reject khác tier; reject `THAN → ???`.
- `getEquipmentDismantleYield`: yield không vượt cost tạo cùng item.
- `getGemSocketCost` / `getGemUnsocketCost`: scale theo tier × socketCount.
- `getReforgeCost`: cost tăng theo `reforgeCount`, cap theo tier × quality.
- `getProtectionCharmRequirement`: chỉ trigger khi enhance ≥ stage `risky` high-tier hoặc `extreme`.
- `validateEquipmentMergeRequest`: chấp nhận 3 món cùng (tier, slot, quality, family), không equipped/locked, không vượt THAN cap.
- `validateDismantleRequest`: chặn equipped / locked / unknown item.

API (`apps/api/src/modules/character/equipment-economy.service.test.ts`):

- Merge: 3 món cùng tier → 1 món tier cao hơn, trừ đúng material/currency, delete đúng 3 row, grant 1 row.
- Merge duplicate idempotency: gọi 2 lần cùng key → 1 output, không nhân.
- Merge khác tier / khác slot → throw `MERGE_INPUT_INVALID`.
- Merge item equipped → throw `EQUIPMENT_EQUIPPED`.
- Merge item locked (TBD: ưu tiên skip nếu hệ chưa có `locked` flag) → throw `EQUIPMENT_LOCKED` hoặc N/A.
- Merge THAN → throw `MERGE_CAP_REACHED`.
- Dismantle item → grant đúng material, delete row, idempotent qua key.
- Dismantle equipped → throw `EQUIPMENT_EQUIPPED`.
- Dismantle item có gem khảm → tự tách gem (cộng về inventory) hoặc throw `EQUIPMENT_HAS_SOCKETS` tuỳ flag input.
- Enhance / refine: thiếu cost → throw, đủ cost → pass.
- Socket / unsocket: trừ đúng linhThach + tinh thiết / tách ngọc phù; vượt cap → throw.
- Reforge: vượt `maxReforgeCount` → throw `REFORGE_CAP_REACHED`.
- Tất cả flow throw giữa chừng → rollback transaction (currency + items không bị half-state).

UI (nếu scope còn fit):

- `EquipmentEconomyPanel.test.ts` — render cost / thiếu nguyên liệu / confirm modal / vi/en key parity.

### Docs

- `docs/phase-23-4-equipment-upgrade-economy-plan.md` (this file).
- `docs/GAME_DESIGN_BIBLE.md` — thêm section §C.6.3 "Equipment Upgrade Economy".
- `docs/BALANCE_MODEL.md` — thêm subsection §2.9.3.1D với cost table merge/dismantle/socket/reforge.
- `docs/ECONOMY_MODEL.md` — thêm subsection trong §2.1 ("Sinks") cho `EQUIPMENT_MERGE`, `EQUIPMENT_DISMANTLE`, `GEM_SOCKET_COST`, `GEM_UNSOCKET_COST`.
- `docs/API.md` — endpoint mới (merge, dismantle, preview).
- `docs/AI_HANDOFF_REPORT.md` — Executive Summary + Recent Changes Phase 23.4.
- `docs/CHANGELOG.md` — Unreleased / Phase 23.4 entry.

## Out of scope

- Không Battle Pass / VIP / Monthly Card (Phase 25.1).
- Không Pháp Bảo / Advanced Artifact System (Phase 23.5 if split).
- Không Book II–V story expansion.
- Không thay đổi Prisma schema trong PR này — dùng ledger meta + history table có sẵn để track idempotency / reforge count.
- Không lifecycle full failure system cho cường hóa (chỉ thêm protection charm hook + metadata).

## Catalog / numeric design

### Merge

| Source quality | Output quality | Linh thạch cost | Material |
|---|---|---|---|
| PHAM ×3 | LINH ×1 | 200 × tier | tinh_thiet ×2 × tier |
| LINH ×3 | HUYEN ×1 | 600 × tier | tinh_thiet ×4 × tier |
| HUYEN ×3 | TIEN ×1 | 1800 × tier | yeu_dan ×2 × tier |
| TIEN ×3 | THAN ×1 | 6000 × tier | han_ngoc ×1 × tier |
| THAN ×3 | — | — | rejected (`MERGE_CAP_REACHED`) |

Output item: cùng `itemKey` family (vd `kim_phong_kiem` PHAM × 3 → `kim_phong_kiem` LINH), cùng slot, quality bump 1 bậc. Nếu catalog không có same key tier cao hơn → throw `MERGE_OUTPUT_UNAVAILABLE`. Caller có thể dùng helper `findMergeOutputItem(items)` để decide.

### Dismantle yield

| Quality | Yield linh thạch | Yield material |
|---|---|---|
| PHAM | 10 × tier | tinh_thiet × 1 |
| LINH | 30 × tier | tinh_thiet × 2 + spirit_dust × 1 (nếu tier ≥ 3) |
| HUYEN | 100 × tier | yeu_dan × 1 + huyen_mảnh_phẩm × 1 |
| TIEN | 300 × tier | yeu_dan × 2 + han_ngoc × 1 |
| THAN | 1000 × tier | han_ngoc × 2 + than_tinh × 1 (rare yield) |

Tổng yield luôn < cost merge cùng quality (anti-infinite resource): vd `LINH × 3 merge → HUYEN` tiêu 600 LT + 4 tinh thiết, dismantle ngược lại HUYEN chỉ trả 100 LT × tier + 1 yêu đan + 1 mảnh phẩm — net thiếu so với cost gốc tạo LINH × 3.

### Gem socket / unsocket cost (mới)

- Socket cost: `50 × equipmentTier × (1 + currentSocketCount × 0.5)` linh thạch.
- Unsocket cost: `100 × equipmentTier × (1 + currentSocketCount × 0.5)` linh thạch + 1 `tach_ngoc_phu` (item key mới sẽ thêm vào shared `items.ts` nếu chưa có).

### Reforge cost (cập nhật)

- Base cost giữ nguyên `getReforgeCost(quality)`.
- Multiplier theo `reforgeCount`: `Math.pow(1.15, Math.min(reforgeCount, 20))`.
- Cap `maxReforgeCount`: 5 (PHAM), 8 (LINH), 12 (HUYEN), 16 (TIEN), 20 (THAN).
- Vượt cap → throw `REFORGE_CAP_REACHED` ở `validateEquipmentUpgradeRequest`.

### Enhance (refine) cost

- Curve giữ `REFINE_LEVELS` legacy. Helper Phase 23.4 chỉ thêm `slotWeight` (1.0 WEAPON, 1.0 ARMOR, 0.7 HAT/BOOTS/BELT, 0.5 TRAM/ARTIFACT) và `tierWeight` (`equipmentTier / 5`) làm multiplier cho mốc `risky` + `extreme`. Mốc `safe` không scale (để giữ ổn định mid-game).
- Mốc `≥ risky` (level 6+) khuyến nghị `useProtection=true` (UI hint), mốc `extreme` (level 11+) **bắt buộc** `useProtection=true` cho phẩm ≥ HUYEN nếu muốn an toàn (validate ở client + server check khi `useProtection=false` chỉ warn, không reject — back-compat).

### Protection charm

- Item key sẵn có: `refine_protection_charm` (Phase 11.5.A).
- Phase 23.4 chỉ thêm metadata hook (`requirement`/`hint`) qua `getProtectionCharmRequirement` để UI cảnh báo, monetization Phase 25.1 wire vào shop / Battle Pass.
- Không bắt buộc consume tại enhance trong PR này (giữ back-compat với `RefineService` cũ).

## Implementation checkpoints

1. Plan doc + early Draft PR (this commit).
2. Shared cost helpers + validators + unit tests.
3. API runtime: `EquipmentEconomyService` + merge/dismantle endpoints + idempotency + ledger reasons.
4. Wire gem socket/unsocket cost + reforge count cap.
5. UI: Inventory + EquipmentEconomyPanel + i18n vi/en + render tests.
6. Docs sync: BALANCE / ECONOMY / GAME_DESIGN / API / HANDOFF / CHANGELOG.
7. `pnpm typecheck` / `lint` / `test` / `build` pass.

## Risk / rollback

🟡 medium — đụng ledger reasons mới + idempotency cho merge/dismantle. Mitigation:

- Toàn bộ mutation qua `prisma.$transaction` + `updateMany` guard (race-safe).
- Idempotency key fallback an toàn (nếu client không gửi key, mỗi request là 1 mutation độc lập — không double-consume nhờ `findFirst` lock + `delete` row pattern).
- Ledger reasons mới chỉ thêm union, không phá legacy.
- Feature flag `EQUIPMENT_MERGE_ENABLED` / `EQUIPMENT_DISMANTLE_ENABLED` cho phép tắt nhanh nếu phát hiện exploit.

Rollback: revert PR — không cần migration rollback (no schema change). Ledger row history giữ nguyên cho audit.

## Known follow-ups

- Phase 25.1 — Battle Pass / Monthly Card / VIP Light (monetization wire `refine_protection_charm`).
- Phase 23.5 — Pháp Bảo / Advanced Artifact System (nếu tách).
- Phase 21B/21C — Book II–V story expansion.
- Phase 24.2/24.3 — Final QA / Polish.
