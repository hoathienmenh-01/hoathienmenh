# Phase 23.5 — Pháp Bảo Advanced Artifact System (Plan)

> Foundation-only PR. Lớp pháp bảo dòng cao cấp riêng, không chiếm 8 slot trang bị chính của Phase 23.2/23.3/23.4. Phase này KHÔNG mở monetization, KHÔNG bán pháp bảo top trực tiếp, KHÔNG cho pháp bảo phá `requiredRealmOrder` / tier ladder.

## 1. Mục tiêu

- Thiết kế pháp bảo như **slot riêng** (artifact / `ARTIFACT_1..3`) — đã có sẵn trong `EQUIP_SLOTS`, không thuộc 8 slot chính (weapon/armor/helmet/boots/belt/ring/amulet/talisman).
- Pháp bảo là dòng "cao cấp khó kiếm", có **passive + active skill** riêng, **star / refine / awaken** riêng, **build identity** chứ không phải auto-win.
- Khoá theo `requiredRealmOrder` và `equipmentTier` của Phase 23.2 — không cho dùng pháp bảo tier cao khi chưa đủ cảnh giới.
- Người chơi chay: pháp bảo cơ bản từ quest / dungeon / boss (`source = quest/boss/dungeon/craft/event`).
- Người nạp (Phase 25.1): có thể tăng tốc / nhận pháp bảo tốt hơn trong cùng tier / nhận mảnh / bảo hộ luyện khí. **Không vượt cảnh giới**.

## 2. Scope chốt (foundation only)

- ✅ Shared catalog `packages/shared/src/phap-bao.ts` với ≥ 10 pháp bảo mẫu phủ PHAM..THAN × tier 1..10.
- ✅ Shared helpers deterministic + tests (`canEquip`, cost curves cho refine/star/awaken, passive bonus compose, active skill preview).
- ✅ API runtime:
  - `GET /character/phap-bao/list` — list pháp bảo sở hữu + metadata catalog hợp nhất.
  - `GET /character/phap-bao/:inventoryItemId/preview` — passive bonus / active skill / cost refine-star-awaken kế tiếp.
  - Equip / unequip pháp bảo **dùng nguyên `/inventory/equip` + `/inventory/unequip`** đã có (server đã realm-gate qua `EQUIPMENT_REALM_LOCKED`).
  - Refine pháp bảo **dùng `RefineService.refineEquipment`** đã có (Phase 11.5.B) — `InventoryItem.refineLevel` đã tồn tại, không cần migration.
- ✅ UI `apps/web/src/components/PhapBaoPanel.vue` + tab Pháp Bảo trong `InventoryView`.
- ✅ Docs (plan / handoff / balance / economy / game-design / api / changelog).
- ❌ **Star / Awaken persistence** — DEFER: cost helper + validation có, nhưng endpoint mutate state chưa wire vì cần `artifactProgressJson` column mới. Foundation phase này chỉ surface cost preview qua UI và đánh dấu "coming soon" trên nút thao tác. Phase tiếp theo (Phase 23.6 hoặc Phase 25.1) sẽ add migration + endpoint.
- ❌ Không thêm Battle Pass / Monthly Card / VIP Light → Phase 25.1.
- ❌ Không cho pháp bảo bán shop tier cao / cho free vượt cảnh giới → giữ chặt server authority.

## 3. Catalog design

Cấu trúc `PhapBaoDef`:

```ts
export interface PhapBaoDef {
  artifactKey: string;             // unique snake_case, match ItemDef.key
  itemKey: string;                 // alias = artifactKey, dùng để equip qua InventoryItem
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  artifactTier: EquipmentTierNumber;          // 1..10 — share tier ladder Phase 23.2
  requiredRealmOrder: number;                 // 1..28
  quality: Quality;                           // PHAM..THAN
  elementAffinity: ElementKey | 'NEUTRAL';
  role: PhapBaoRole;                          // burst|sustain|control|defense|support|farming
  passiveBonus: ItemBonus;                    // cộng vào equipBonus aggregator, capped theo ITEM_STAT_BUDGET_BY_QUALITY
  activeSkill: ArtifactActiveSkill | null;    // optional — nếu null thì pháp bảo chỉ có passive
  starCap: number;                            // ≤ 5
  refineCap: number;                          // ≤ getEnhanceCapForTier(artifactTier)
  awakenCap: number;                          // 0..3 (foundation), 0..5 (future)
  source: PhapBaoSource;                      // quest|boss|dungeon|craft|event|premium_hook
  powerBudget: number;                        // derive deterministic từ tier × quality × slotWeight artifact
}

export interface ArtifactActiveSkill {
  key: string;
  nameVi: string;
  nameEn: string;
  cooldownSeconds: number;          // ≥ 30 ở early/mid, ≥ 60 ở late
  effect: ArtifactActiveEffect;     // damage/heal/shield/debuff/buff
  unlockStar: number;               // 1..5 — chỉ usable khi starLevel ≥ unlockStar
}
```

10 pháp bảo foundation (tham khảo gợi ý spec):

| Key | Tier | Realm | Quality | Element | Role | Active | Source |
|---|---|---|---|---|---|---|---|
| `ngu_hanh_linh_chau` | 2 | 4 | LINH | NEUTRAL | support | passive heal/regen ring | quest |
| `thanh_lien_kiem_an` | 3 | 7 | HUYEN | KIM | burst | single-target kim cut, CD 45s | dungeon |
| `huyen_thien_kinh` | 4 | 10 | HUYEN | THUY | control | freeze 1 target 2s, CD 50s | quest |
| `huyet_nguyet_ho_lo` | 5 | 13 | TIEN | HOA | sustain | DoT 5s, CD 40s | boss |
| `tho_linh_son_an` | 5 | 13 | TIEN | THO | defense | shield 30% maxHp 6s, CD 60s | dungeon |
| `cuu_diem_phien` | 6 | 16 | TIEN | HOA | burst | AoE damage 1.5× atk, CD 75s | boss |
| `moc_linh_binh` | 6 | 16 | TIEN | MOC | sustain | heal 20% maxHp + regen 5s, CD 60s | quest |
| `bang_tam_ngoc_kinh` | 7 | 19 | TIEN | THUY | control | slow 2 target 4s, CD 50s | event |
| `kim_quang_bao_luan` | 8 | 22 | THAN | KIM | burst | crit/armor pen window 5s, CD 90s | craft |
| `hau_tho_tran_hon_an` | 10 | 28 | THAN | THO | defense | reflect 30% damage 5s, CD 120s | premium_hook |

(Catalog có thể bổ sung thêm khi expansion. Tier 1 deliberately rỗng để giữ pháp bảo "cao cấp" — người chơi mới dùng artifact thường ItemDef thay vì pháp bảo.)

## 4. Helpers (`packages/shared/src/phap-bao.ts`)

- `PHAP_BAO_CATALOG: readonly PhapBaoDef[]` — frozen.
- `getPhapBaoByKey(key: string): PhapBaoDef | undefined`.
- `getPhapBaoTierForRealmOrder(realmOrder: number): EquipmentTierNumber` — alias `getEquipmentTierForRealmOrder(...).tier`.
- `canEquipPhapBao(characterRealmOrder: number, artifact: PhapBaoDef): boolean` — `realmOrder >= requiredRealmOrder`.
- `computePhapBaoPowerScore(input: { key, starLevel, refineLevel, awakenStage }): number` — base `powerBudget × (1 + 0.05 × starLevel) × (1 + 0.03 × refineLevel) × (1 + 0.08 × awakenStage)`, capped `× 1.5` so artifact total ≤ 50% trên baseline để đảm bảo không vượt set bonus + gear resonance.
- `computePhapBaoPassiveBonus(input): ItemBonus` — multiplier same as power score, áp lên `passiveBonus` của catalog.
- `computePhapBaoActiveSkillPreview(input): { key, nameVi, nameEn, cooldownSeconds, effect, unlocked: boolean, currentCooldownReduction: number }` — `unlocked = starLevel >= unlockStar`, cooldown giảm 5% mỗi star khi unlocked, cap 25%.
- `getPhapBaoUpgradeCost(input: { tier, currentRefineLevel, quality }): { linhThachCost, materialKey, materialQty }` — `baseRefineCost(tier, quality) × 1.4 ^ currentRefineLevel` linh thạch + material `tinh_thiet` / `yeu_dan` / `han_ngoc` theo tier (artifact luyện khí đắt hơn trang bị thường 1.5×).
- `getPhapBaoStarUpCost(input: { tier, currentStarLevel, quality }): { linhThachCost, materialKey, materialQty, requiresShard }` — `baseStarCost(tier) × (currentStarLevel + 1)^2` + `phap_bao_shard` 5/10/20/40/80 cho star 0→1..4→5.
- `getPhapBaoAwakenCost(input: { tier, currentAwakenStage, quality }): { linhThachCost, materialKey, materialQty, requiresAwakenStone }` — bắt buộc `quality === 'TIEN' | 'THAN'` và `tier >= 5`; cost cao gấp 5× luyện khí cùng tier; cần `awaken_stone` × `(currentAwakenStage + 1) × 2`.
- `validatePhapBaoDefinition(artifact: PhapBaoDef): { ok, errors }` — required field, tier 1..10, quality ∈ QUALITIES, requiredRealmOrder ∈ 1..28, passiveBonus ≤ `ITEM_STAT_BUDGET_BY_QUALITY[quality]` × 1.2 (artifact được +20% so cap thường), active cooldown ≥ 30, starCap ≤ 5, refineCap ≤ tier enhance cap, awakenCap ≤ 3.
- `validatePhapBaoUpgradeRequest(input)`: kind ∈ refine|star|awaken; current level < cap; star ≥ 1 mới được awaken; awaken yêu cầu quality TIEN/THAN.

## 5. API runtime (`apps/api/src/modules/character/phap-bao.service.ts`)

| Method / endpoint | Behavior |
|---|---|
| `GET /character/phap-bao/list` | List `InventoryItem` của character có `itemKey ∈ PHAP_BAO_CATALOG` — trả `{ inventoryItemId, artifact: PhapBaoDef, equippedSlot, refineLevel, starLevel (0 foundation), awakenStage (0 foundation), powerScore, canEquip, requiredRealmOrder }`. |
| `GET /character/phap-bao/:inventoryItemId/preview` | Read-only — passive bonus / active skill preview / cost refine|star|awaken kế tiếp. |
| `POST /character/phap-bao/:inventoryItemId/refine` | Thin wrapper qua `RefineService.refineEquipment` (Phase 11.5.B). KHÔNG persist star/awaken. |
| Equip / Unequip | Dùng nguyên `/inventory/equip` (đã realm-gate) — KHÔNG thêm endpoint mới. |

Server authority đã có sẵn:
- `EQUIPMENT_REALM_LOCKED` enforce ở `InventoryService.equip` qua `canEquipItemAtRealm(def, realmOrder)`.
- Ownership: `inv.characterId !== char.id → INVENTORY_ITEM_NOT_FOUND`.
- Cost / material: `RefineService.refineEquipment` đã `$transaction` + `updateMany` `gte` guard.
- Idempotency: refine không idempotent (mỗi reroll = 1 row), star/awaken sẽ idempotent qua ledger meta khi wire ở Phase tiếp.

Star / Awaken endpoint **defer**: `POST /character/phap-bao/:inventoryItemId/star-up` và `/awaken` chưa enable trong PR này (feature flag `PHAP_BAO_STAR_UP_ENABLED = false`, `PHAP_BAO_AWAKEN_ENABLED = false`). UI hiển thị cost preview và disable button với tooltip "Sẽ mở ở Phase tiếp theo".

## 6. UI (`apps/web/src/components/PhapBaoPanel.vue`)

- Tab "Pháp Bảo" trong `InventoryView`.
- Danh sách pháp bảo sở hữu (grid card với frame riêng + aura element).
- Khi click 1 card → modal hiển thị:
  - Quality / tier / requiredRealmOrder
  - Element + Role badge
  - Passive bonus (with refine/star multiplier applied)
  - Active skill (name + cooldown + unlock star) — disabled label nếu starLevel < unlockStar
  - Nút "Equip" / "Unequip" (dùng existing endpoint).
  - Nút "Luyện khí" → confirm modal cost + material → call `RefineService.refineEquipment`.
  - Nút "Thăng sao" + "Thức tỉnh" — disabled với tooltip "Coming soon — Phase 23.6/25.1".
- Loading / empty / error states.
- i18n vi/en parity ở `inventory.phapBao.*`.
- Mobile responsive.

## 7. Economy / balance

- Pháp bảo contribute 5–15% total power early/mid, 10–20% late (vẫn ≤ 1 món trang bị chính).
- Active skill không quyết định 100% trận đấu; cooldown ≥ 30s; effect mạnh phải có condition / unlock star.
- Passive bonus capped `ITEM_STAT_BUDGET_BY_QUALITY[quality] × 1.2` (slot artifact đã có off-slot soft-cap 1.2× cho multi-stat).
- Free path: quest / dungeon / boss drop có catalog đầy đủ; mảnh `phap_bao_shard` có drop từ daily/event.
- Premium hook (Phase 25.1): có thể bán `phap_bao_shard`, `refine_protection_charm`, `awaken_stone` qua Battle Pass / Monthly Card / VIP Light shop. **Không bán pháp bảo top tier / max sao / max awaken trực tiếp**.

## 8. Tests

Shared (`packages/shared/src/phap-bao.test.ts`):
- catalog artifactKey unique
- artifactTier ∈ 1..10
- requiredRealmOrder map đúng với `getEquipmentTierForRealmOrder(realmOrder).tier ≥ artifactTier`
- `canEquipPhapBao` false khi `realmOrder < requiredRealmOrder`, true khi `>=`
- `computePhapBaoPowerScore` deterministic + monotonic theo star/refine/awaken
- `computePhapBaoPassiveBonus` không vượt cap × 1.2
- `getPhapBaoUpgradeCost / StarUpCost / AwakenCost` tăng theo level / star / awaken
- `validatePhapBaoDefinition` fail nếu thiếu requiredRealmOrder, fail nếu passiveBonus vượt cap, fail nếu cooldown < 30
- `validatePhapBaoUpgradeRequest` fail nếu vượt cap, fail nếu awaken khi quality PHAM/LINH, fail nếu starLevel < 1 và awaken

API (`apps/api/src/modules/character/phap-bao.service.test.ts`):
- list trả pháp bảo của character + filter theo catalog
- preview trả cost + passive + active skill
- không thấy pháp bảo của character khác
- refine wrapper call thành công cập nhật `InventoryItem.refineLevel`
- star-up endpoint trả `PHAP_BAO_STAR_UP_DISABLED` khi feature flag off

UI (`apps/web/src/components/PhapBaoPanel.test.ts`):
- render danh sách pháp bảo
- empty state khi chưa có
- lock state khi `canEquip = false`
- disable nút star-up/awaken khi feature flag off
- vi/en parity

## 9. Docs cập nhật

- `docs/AI_HANDOFF_REPORT.md` — Executive Summary + snapshot mới + Recent Changes Phase 23.5.
- `docs/GAME_DESIGN_BIBLE.md` — §C.6 thêm "Pháp Bảo system" subrow.
- `docs/BALANCE_MODEL.md` — section 2.9.3.1E cost curves + passive cap × 1.2.
- `docs/ECONOMY_MODEL.md` — pháp bảo material flows (`phap_bao_shard`, `awaken_stone`) + refine sink reuse.
- `docs/API.md` — 3 endpoints mới + feature flags.
- `docs/CHANGELOG.md` — Unreleased / Phase 23.5 entry.

## 10. Forbidden (giữ nguyên rule chung)

- Không Battle Pass / VIP chính thức trong PR này (Phase 25.1).
- Không bán pháp bảo top trực tiếp.
- Không cho pháp bảo vượt `requiredRealmOrder` / phá tier.
- Không Story Book II–V.
- Không destructive migration.
- Không bypass economy / ledger.
- Không duplicate upgrade khi retry (idempotency cho refine đã có qua `RefineService`).
- Không tắt CI / skip test / fake green.
- Không push main / force push branch người khác.

## 11. Follow-ups

- Phase 23.6 — Equipment visual rarity effects (tier glow, aura, slot frame upgrade).
- Phase 25.1 — Battle Pass / Monthly Card / VIP Light + wire star-up + awaken persistence (cần migration `artifactProgressJson`).
- Phase 21B/21C — Story Book II–V expansion (drop pháp bảo cốt truyện boss).
- Phase 24.2/24.3 — Final QA / Polish (rebalance pháp bảo theo telemetry sau soft-launch).
