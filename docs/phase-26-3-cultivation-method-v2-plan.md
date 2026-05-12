# Phase 26.3 — Cultivation Method V2 / Công Pháp Progression Plan

> Working plan cho PR `phase-26-3-cultivation-method-v2`. File này sẽ
> được prune ở commit cuối khi hệ V2 đã ổn định và `AI_HANDOFF_REPORT.md`
> + `BALANCE_MODEL.md` đã có entry chính thức.

## Mục tiêu

Mở rộng hệ công pháp hiện tại (Phase 11.1 — equip-only, không có
progression) thành một hệ build nhân vật dài hạn:

- 9 phẩm cấp `PHAM → CHI_TON` (kế thừa khái niệm 9 tier như equipment /
  alchemy / drop economy).
- 6 nhóm `QI / BODY / HYBRID / ELEMENTAL / SECT / FORBIDDEN / SPECIAL`.
- 9 hệ `KIM / MOC / THUY / HOA / THO / NONE / MIXED / HUYEN / HON_NGUYEN`.
- Mỗi công pháp có `level / star / exp`, baseline + per-level / per-star
  stat, passive effects, fragment recipe.
- Mảnh công pháp (`method_fragment_*`) drop từ Drop Economy V2:
  - quái thường chỉ rơi mảnh tier thấp, rất thấp;
  - boss / dungeon là nguồn chính cho mảnh tier trung;
  - world boss / event là nguồn công pháp hiếm.

## Mapping với code hiện có

| Phase 11.1 (cũ) | Phase 26.3 (V2) |
|---|---|
| `CULTIVATION_METHODS` (12 method, `expMultiplier`/`statBonus` cố định, không level) | `CULTIVATION_METHODS_V2` (catalog 9 tier, có `level`/`star`/`fragmentsRequired`) |
| `Character.equippedCultivationMethodKey` (1 slot duy nhất) | Slot V2: `QI_MAIN / BODY_MAIN / SUPPORT / SECT / SPECIAL` (lưu ở `CharacterCultivationMethod.equippedSlot`). Vẫn mirror slot `QI_MAIN` vào `Character.equippedCultivationMethodKey` để giữ backward-compat cultivation/combat. |
| `CharacterCultivationMethod` (id, characterId, methodKey, source, learnedAt) | Mở rộng thêm `level / star / methodExp / equippedSlot`. KHÔNG tạo bảng trùng. |
| `methodExpMultiplierFor` / `methodStatBonusFor` (pure helper) | Giữ nguyên cho legacy + thêm `computeMethodV2Bonuses(equippedRows)` cho stat compose runtime. |

## Quy tắc anti-P2W

- Công pháp **không bán bằng tiền nạp**; cao cấp chỉ qua mảnh boss /
  event / sect contribution.
- Stat cap:
  - QI method: `qiExpMul` cap × 2.0 (sau cộng với root + talent vẫn ≤ ~4×).
  - BODY method: `bodyExpMul` cap × 1.8.
  - Tổng `atkMul/defMul/hpMaxMul/mpMaxMul` cap +40% mỗi loại.
- Endgame `THAN/DAO/CHI_TON` không drop nguyên quyển từ quái thường —
  chỉ FRAGMENT_COMBINE / event / world boss.
- Mỗi fragment item có `materialTier` rõ ràng + `sourceHint` rõ ràng —
  Drop Economy V2 tự sinh rule, KHÔNG cần catalog drop riêng.

## Thứ tự triển khai

1. **Audit** — xong, ghi chú ở file này.
2. **Shared V2** — `cultivation-methods-v2.ts` (enum + catalog + helper),
   thêm fragment items vào `items.ts`.
3. **Prisma** — additive cột `level / star / methodExp / equippedSlot`
   vào `CharacterCultivationMethod`; bảng mới `MethodUpgradeLog`.
4. **Backend** — service `CultivationMethodV2Service` (unlock/equip/
   upgrade/star-up) + endpoint `/character/cultivation-methods/*`.
5. **Wire** — bổ sung V2 bonus vào cultivation processor (qi/body) +
   combat snapshot.
6. **Drop integration** — fragment items có sẵn `materialTier / sourceHint`
   → Drop Economy V2 auto-derive rule (không cần touch drop-economy.ts
   trừ khi cần thêm category mới).
7. **UI** — mở rộng `CultivationMethodView.vue` (panel V2 song song
   panel V1 legacy hoặc thay thế nếu data đầy đủ).
8. **Tests** — shared catalog validate, API unlock/equip/upgrade/star-up,
   web smoke.
9. **Docs** — `AI_HANDOFF_REPORT.md`, `BALANCE_MODEL.md`, `API.md`.
10. **CI** — `pnpm typecheck/lint/test/build` pass trước khi mark ready.

## Trạng thái hiện tại

- [x] Branch `phase-26-3-cultivation-method-v2` đẩy lên remote.
- [x] Draft PR mở sớm (file này là commit khởi tạo).
- [ ] Shared V2 catalog.
- [ ] Fragment items.
- [ ] Prisma migration.
- [ ] Backend service.
- [ ] Wire stat.
- [ ] UI.
- [ ] Tests.
- [ ] Docs.
