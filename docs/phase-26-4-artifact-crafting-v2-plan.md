# Phase 26.4 — Artifact / Pháp Bảo Crafting V2 — Plan

> Tài liệu nội bộ phase. Trạng thái sống cuối cùng nằm trong `docs/AI_HANDOFF_REPORT.md`.

## Mục tiêu

Mở rộng hệ Pháp Bảo hiện có (Phase 23.5 + 23.7) thành **crafting full V2**: phôi → bản vẽ → nguyên liệu → craft → grade → element → 4 hướng nâng cấp → 5 slot mới → wire vào combat / cultivation / alchemy với cap chống P2W, drop có cap, audit log, transaction-safe.

## Phạm vi (in scope)

- Shared types/helpers `artifacts-v2.ts` (ArtifactType / ArtifactGrade / ArtifactElement / ArtifactTierDef / ArtifactBlueprintDef / ArtifactDef + balance helpers + catalog 36+ pháp bảo phủ tier 1..9).
- Auto-generated items (`phoi_phap_bao_t*`, `ban_ve_phap_bao_t*`, `boss_core_t*`, `refine_stone_t*`, `awaken_core_t*`, `spirit_essence_t*`, `ngu_hanh_tinh_hoa_t*`) wire vào `MaterialCategory='ARTIFACT_CRAFT'`.
- Prisma additive: `CharacterArtifactV2`, `ArtifactCraftAttemptLog`, `ArtifactUpgradeLogV2` + migration tay.
- API service `ArtifactV2Service` (`craft`, `equip`, `unequip`, `upgrade` level, `starUp`, `refine`, `awaken`) — server-authoritative, transaction-safe, full audit log.
- 5 slot mới: `MAIN_ARTIFACT_V2`, `DEFENSE_ARTIFACT_V2`, `SUPPORT_ARTIFACT_V2`, `ALCHEMY_ARTIFACT_V2`, `SPECIAL_ARTIFACT_V2` (chứa key trong `CharacterArtifactV2.equippedSlot`).
- Combat snapshot wire: artifact V2 cộng vào atk/def/hpMax/mpMax/spirit/speed/crit/elementalAtkBonus/bossDamageReductionPct/cultivationRateBonusPct/bodyCultivationRateBonusPct/alchemySuccessRateBonusPct với cap tổng.
- Drop Economy V2: nguyên liệu pháp bảo dùng `MaterialCategory='ARTIFACT_CRAFT'` đã có multiplier `0.05` — daily/weekly cap đã sẵn sàng.
- Web view `/artifacts-v2` (PhapBaoV2View) — list + craft + upgrade/star/refine/awaken + filter + i18n vi/en.
- Tests shared/API/web + docs update.

## Ngoài phạm vi (out of scope)

- KHÔNG xóa hệ Phase 23.5/23.7 (`PhapBao*`). Hệ cũ tiếp tục chạy song song trên slot `ARTIFACT_1..3` qua `InventoryItem`.
- KHÔNG rewrite combat / inventory / drop-economy core.
- KHÔNG bán artifact V2 thành phẩm bằng tiền nạp; chỉ hook gói nguyên liệu cấp thấp có cap.
- KHÔNG mở Battle Pass / thẻ tháng / shop top-up trong phase này.

## Kiến trúc cao cấp

```
shared/artifacts-v2.ts ──┐
                          ├─► items.ts (auto-gen materials + blueprints)
                          ├─► drop-economy.ts (auto-derive rules từ ARTIFACT_CRAFT)
                          ├─► combat-snapshot.ts (artifact V2 bonus, capped)
                          └─► API ArtifactV2Service ──► character.controller endpoints
                                          │
                                          └─► Prisma CharacterArtifactV2 + logs
```

Hệ Phase 23.5/23.7 vẫn còn nguyên — V2 sống cạnh, có thể migrate dần.

## Anti-P2W invariants

1. Không bán artifact V2 thành phẩm top tier qua bất kỳ shop nào.
2. Không bán nguyên liệu endgame (`*_t8`, `*_t9`) vô hạn.
3. Daily/weekly cap (ARTIFACT_CRAFT category đã = 0 cho NORMAL/ELITE; WORLD_BOSS daily 2, weekly 6 - tier).
4. Artifact V2 cultivationRate / alchemySuccess / luck bonus tổng cap nhỏ.
5. Craft success rate cap ≤ 0.95.
6. Grade `DAO_VAN` rate cap ≤ 0.02 trên blueprint Tier ≤ 7; Tier 8–9 cap ≤ 0.05 dù có bonus.
7. Tier cao hơn cảnh giới >1 yêu cầu blueprint đặc biệt + boss core hiếm.
