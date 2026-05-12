# Phase 23.2 — Realm-scaled Equipment Progression Plan

## Goal

Restructure equipment progression so gear scales with the full 28-realm cultivation ladder without letting `quality` become the only power axis. Equipment progression is server-authoritative: every equippable item must have or derive a realm gate (`requiredRealmOrder`) and a tier/grade budget.

## Scope

- Map 28 realms into 10 equipment tiers.
- Add shared deterministic helpers for tier lookup, grade lookup, quality/slot multipliers, enhancement/socket caps, power budget, equip gating, and progression validation.
- Add or derive progression metadata for equipment catalog items.
- Enforce `requiredRealmOrder` on the server when equipping inventory items.
- Surface tier, grade, realm requirement, power score, max enhancement, and socket cap in inventory/equipment UI.
- Add shared/API/UI tests and update balance/economy/handoff docs.

## Out of scope

- No Book II–V story expansion.
- No Battle Pass/VIP/monetization changes.
- No destructive Prisma migration.
- No full inventory/equipment rewrite.
- No manual stat seeding that bypasses power budget.
- No gem/set/enhance path that replaces realm/tier progression.

## Equipment tier mapping

| Tier | Name | Realm orders | Grade mapping |
|---:|---|---|---|
| 1 | Phàm Khí | 1–3 | I/II/III |
| 2 | Linh Khí | 4–6 | I/II/III |
| 3 | Huyền Khí | 7–9 | I/II/III |
| 4 | Địa Khí | 10–12 | I/II/III |
| 5 | Thiên Khí | 13–15 | I/II/III |
| 6 | Tiên Khí | 16–18 | I/II/III |
| 7 | Thánh Khí | 19–21 | I/II/III |
| 8 | Đạo Khí | 22–24 | I/II/III |
| 9 | Bản Nguyên Chí Bảo | 25–27 | I/II/III |
| 10 | Hư Không Chí Bảo | 28 | no internal grade |

`realmOrder` in this plan is 1-based for player-facing equipment gates. Shared realm catalog `REALMS.order` is 0-based, so helpers must normalize carefully.

## Balance rules

### Tier base power

| Tier | Base power |
|---:|---:|
| 1 | 100 |
| 2 | 260 |
| 3 | 680 |
| 4 | 1,750 |
| 5 | 4,500 |
| 6 | 11,500 |
| 7 | 29,000 |
| 8 | 72,000 |
| 9 | 175,000 |
| 10 | 420,000 |

### Quality multipliers

| Quality | Multiplier | Meaning |
|---|---:|---|
| PHAM | 1.00 | common within the same tier/grade |
| LINH | 1.15 | uncommon within the same tier/grade |
| HUYEN | 1.35 | rare within the same tier/grade |
| TIEN | 1.60 | epic within the same tier/grade |
| THAN | 1.90 | mythic within the same tier/grade |

### Slot weights

| Slot family | Weight |
|---|---:|
| weapon | 1.00 |
| armor/chest | 0.85 |
| helmet/hat/trâm | 0.55 |
| boots | 0.45 |
| ring/amulet | 0.40 |
| belt | 0.35 |
| offhand/artifact | 0.70 |

### Enhancement and socket caps

- Enhancement caps by tier: +5, +7, +9, +11, +13, +15, +17, +19, +21, +23.
- Enhancement multiplier: `1 + enhanceLevel * 0.03`, clamped by the tier cap.
- Socket quality caps: PHAM 0, LINH 0–1, HUYEN 1, TIEN 2, THAN 2–3.
- Socket tier caps: tier 1 max 1, tiers 2–3 max 2, tiers 4–5 max 3, tiers 6–10 max 4.
- Gem bonus total must stay ≤ 20% of item power.
- Set bonus envelope: 2-piece 3–5%, 4-piece 6–10%, 6-piece 10–15% or capped cooldown effect.

## Implementation checkpoints

1. Plan doc and early Draft PR.
2. Shared `packages/shared/src/equipment-progression.ts` helpers.
3. Equipment item metadata/derivation in catalog and inventory view models.
4. Server realm-gated equip validation in inventory equip flow.
5. Inventory/equipment UI tier and lock display with vi/en parity.
6. Shared/API/UI tests and local `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
7. Docs/handoff/changelog/API updates and final PR body.

## Testing matrix

- `EQUIPMENT_TIERS` covers realm orders 1–28 exactly once.
- Every realm order maps to the correct tier and I/II/III grade.
- Tier ranges, base powers, quality multipliers, slot weights, enhancement caps, and socket caps match this plan.
- `canEquipItemAtRealm` rejects low-realm characters and accepts eligible characters.
- `computeEquipmentPowerScore` is deterministic and rejects enhancement/gem/set over-cap scenarios.
- `validateEquipmentProgression` rejects missing realm gates and over-budget power.
- Existing equipment items validate through derived metadata.
- API equip high-tier item at low realm fails with `EQUIPMENT_REALM_LOCKED`.
- API equip item at required realm succeeds.
- Unequip and consumable use are unaffected.
