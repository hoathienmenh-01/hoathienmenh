# Phase 23.3 — Set Bonus + Gear Resonance Plan

## Goal

Bổ sung lớp **Set Bonus** (cộng hưởng theo bộ 2/4/6 món) và **Gear Resonance**
(cộng hưởng toàn bộ trang bị theo tier / enhance / quality / Ngũ Hành) trên
nền Phase 23.2 (`equipmentTier`, `requiredRealmOrder`, `powerBudget`,
`computedPowerScore`, enhancement/socket cap). Mục tiêu là khuyến khích người
chơi nâng đều cả bộ thay vì chỉ đầu tư vào vũ khí, và mở thêm chiều sâu
build theo Ngũ Hành mà KHÔNG phá Phase 23.2 progression hoặc Phase 22.1
elemental build.

## Scope

- Catalog `SET_BONUSES` theo Ngũ Hành (Kim / Mộc / Thuỷ / Hoả / Thổ) — mỗi hệ
  có set early/mid + set late/endgame, gắn `equipmentTier` / `allowedTiers`,
  `requiredRealmOrder`, `elementAffinity`, `requiredSlots`, bonuses
  `2/4/6-piece`, `bonusCap`, optional `cooldown`, `tags`.
- Catalog `GEAR_RESONANCES` cho:
  - Same-tier resonance (mặc đủ 6 món cùng tier hoặc cao hơn).
  - Enhance resonance (toàn bộ 6 món đạt +5 / +8 / +12 / +15).
  - Quality resonance (toàn bộ 6 món ≥ HUYEN / ≥ TIEN / THAN).
  - Elemental resonance (4/6 cùng hệ — bonus nhỏ; 6/6 cùng hệ — bonus đặc
    biệt nhẹ).
  - Hybrid resonance (tương sinh: Mộc+Hoả, Hoả+Thổ, Thổ+Kim, Kim+Thuỷ,
    Thuỷ+Mộc) — bonus nhỏ cho build lai.
- Shared helpers thuần (deterministic, không IO):
  - `getEquippedSetPieces(equippedItems)`
  - `computeActiveSetBonuses(equippedItems)`
  - `computeGearResonance(equippedItems)`
  - `computeElementalResonance(equippedItems)`
  - `validateSetBonusDefinition(set)` + `validateResonanceDefinition(resonance)`
  - `getMissingSetSlots(equippedItems, setKey)`
  - `summarizeEquipmentBuild(equippedItems)` (tổng kết build: main element,
    active set count, resonance tier, power score).
- Server runtime hookup: tính lại set/resonance khi list inventory; integrate
  set/resonance ratio vào aggregate stat (`equipBonus`) đi qua envelope cap.
- UI:
  - Bổ sung `EquipmentBuildPanel.vue` trên `InventoryView` hiển thị active
    sets (2/4/6 + slot còn thiếu), gear resonance (same tier / enhance /
    quality / elemental / hybrid), main element, power score.
  - Tooltip set + element cho từng item.
  - i18n vi/en parity.
- Tests (shared + render):
  - setKey unique, required pieces hợp lệ, active 2/4/6 đúng, không active
    khi thiếu món, không duplicate item, set tier thấp không vượt cap, set
    bonus đúng hệ, gear resonance active/inactive theo điều kiện, enhance
    /quality/elemental/hybrid đúng mốc, tổng bonus không vượt cap, stat
    aggregation không double count, render set/resonance trên UI.

## Out of scope

- Không Battle Pass / VIP / Monthly Card (Phase 25.1).
- Không Equipment Upgrade Economy / resource sink (Phase 23.4).
- Không mở rộng Book II–V story.
- Không thay đổi Prisma schema (Set/Resonance compute on demand, no cache).
- Không sửa enhancement / socket / refine / reforge runtime.

## Catalog design (Ngũ Hành)

| Hệ | Set Mid | Set Endgame | Vai trò |
|---|---|---|---|
| KIM | `kim_phong_set` (tier 4, realm 10) | `kim_quang_sat_set` (tier 8, realm 22) | crit, xuyên giáp, burst chính xác |
| MOC | `thanh_diep_tu_sinh_set` (tier 4, realm 10) | `van_moc_tham_lam_set` (tier 8, realm 22) | hồi phục, regen, sustain dài hơi |
| THUY | `han_thuy_han_tam_set` (tier 4, realm 10) | `bich_hai_linh_toa_set` (tier 8, realm 22) | né tránh, khống chế, debuff |
| HOA | `lieu_hoa_phon_set` (tier 4, realm 10) | `cuu_u_diem_hoa_set` (tier 8, realm 22) | burn, burst, DoT |
| THO | `hau_tho_hu_vien_set` (tier 4, realm 10) | `bat_quai_cuong_ngoa_set` (tier 8, realm 22) | giáp, shield, phản đòn |

Mỗi set:

- 2-piece: bonus nhỏ thuần stat 3–5% (atk / def / hp / mp / spirit).
- 4-piece: bonus vừa 6–10% cộng hưởng với vai trò.
- 6-piece: bonus đặc biệt 10–15% với điều kiện/cooldown (mô tả semantic, runtime
  chỉ apply phần ratio, hiệu ứng cooldown để Phase 23.4+ wire).

## Balance caps

| Loại | Range |
|---|---|
| Set 2-piece | 3–5% |
| Set 4-piece | 6–10% |
| Set 6-piece | 10–15% (cooldown nếu hiệu ứng đặc biệt) |
| Same-tier resonance | 2–4% |
| Enhance resonance / mốc | 2–5% (tổng các mốc không vượt 10%) |
| Quality resonance | 2–4% / mốc |
| Elemental resonance 4/6 | 3–5% |
| Elemental resonance 6/6 | 5–8% |
| Hybrid resonance (tương sinh) | 2–4% |
| **Tổng set + resonance** | ≤ `EQUIPMENT_BUILD_TOTAL_BONUS_CAP` (= 30%) |

Set tier thấp không được cấp bonus ratio vượt 2-piece cap dù mặc full 6 món
(envelope per-set vẫn enforce). Set bonus + gear resonance đi qua tổng cap
trước khi cộng vào stat aggregation; phần vượt cap bị truncate.

## Implementation checkpoints

1. Plan doc + early Draft PR (this commit).
2. `packages/shared/src/equipment-set-bonus.ts` + `equipment-resonance.ts`
   + `equipment-build.ts` (helpers, catalog, validate, tests).
3. Inventory aggregation tích hợp `set/resonance` ratio vào tổng bonus
   theo cap envelope (`InventoryService.equipBonus`).
4. UI `EquipmentBuildPanel.vue` + i18n vi/en + render test.
5. `pnpm typecheck` / `lint` / `test` / `build` pass.
6. Docs (`AI_HANDOFF_REPORT.md`, `BALANCE_MODEL.md`, `ECONOMY_MODEL.md`,
   `GAME_DESIGN_BIBLE.md`, `CHANGELOG.md`, `API.md` nếu cần) + final PR body.

## Testing matrix

- setKey unique trong `SET_BONUSES`.
- `requiredSlots` chỉ chứa `EQUIP_SLOTS` hợp lệ, không trùng.
- `validateSetBonusDefinition` reject ratio vượt cap 2/4/6.
- Active 2-piece chỉ khi đủ 2 món thuộc set, không stack 2 lần.
- Active 4-piece không kích hoạt khi chỉ có 3 món.
- Active 6-piece không kích hoạt khi chỉ có 5 món; 6-piece include cả ratio
  2 + 4 piece (gộp đúng theo cap).
- Duplicate inventory id (cùng 1 instance) không tính 2 món.
- Set tier 1–3 đeo full không vượt 5% (2-piece envelope).
- Elemental set bonus chỉ active khi item `equipmentElement` hoặc fallback
  match đúng hệ.
- Gear resonance same-tier active khi 6/6 ≥ minTier.
- Enhance resonance từng mốc +5 / +8 / +12 / +15 active đúng — tổng các mốc
  không vượt 10%.
- Quality resonance ≥ HUYEN / ≥ TIEN / THAN active đúng.
- Elemental resonance 4/6 và 6/6 active đúng theo dominant element.
- Hybrid resonance kích hoạt khi 2 nhóm element tương sinh đủ pieces.
- Tổng set + resonance bị clamp về `EQUIPMENT_BUILD_TOTAL_BONUS_CAP`.
- Stat aggregation không double-count (set ratio chỉ apply 1 lần lên baseline
  atk/def/hpMax/mpMax/spirit; không nhân thêm vào socket / refine / substat
  / enchant).
- Equip/unequip thay đổi summary (no cache invalidation issue vì compute on
  demand).
- UI render set/resonance status đúng (active vs missing slot count).

## Follow-up

- Phase 23.4: Equipment Upgrade Economy / Resource Sink (đan / linh thạch /
  vật liệu để nâng).
- Phase 25.1: Battle Pass / Monthly Card / VIP Light (monetization layer).
- Phase 21B/21C: Story Book II–V Expansion (lore).
- Phase 24.2/24.3: Final QA / Polish.
