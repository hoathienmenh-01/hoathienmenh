# Phase 23.7 — Pháp Bảo Star-up + Awaken Persistence Plan

## 0. Preconditions / branch policy

- Branch: `feat/phase-23-7-phap-bao-star-awaken`.
- Base: latest `main` after Phase 23.5 + Phase 23.6 quality-power follow-up were pulled into this branch.
- Delivery rule: create Draft PR early, push every checkpoint, never push `main`, never disable CI/tests, never fake green.
- Scope: Pháp Bảo progression persistence/runtime/UI only. No Battle Pass/VIP, no direct sale of max artifact, no Book II–V story expansion.

## 1. Current state audit

- Catalog/shared foundation lives in `packages/shared/src/phap-bao.ts`.
- Runtime list/preview lives in `apps/api/src/modules/character/phap-bao.service.ts`.
- UI lives in `apps/web/src/components/PhapBaoPanel.vue`.
- Pháp Bảo instances currently reuse `InventoryItem` rows whose `itemKey` belongs to `PHAP_BAO_CATALOG`.
- `InventoryItem.refineLevel` already persists true refine level.
- `starLevel` and `awakenStage` currently default to `0` in service preview/list and are not persisted.

## 2. Persistence / schema plan

Use the existing `InventoryItem` instance model instead of adding a parallel artifact table, because:

- Ownership, quantity, equipped slot, createdAt, and `refineLevel` already exist there.
- Equip/unequip already uses `InventoryItem.equippedSlot`.
- Keeping one source of truth avoids sync bugs between artifact and inventory rows.

Add an additive Prisma migration:

- `InventoryItem.phapBaoStarLevel Int @default(1)`
- `InventoryItem.phapBaoAwakenStage Int @default(0)`
- `InventoryItem.locked Boolean @default(false)` if no lock field/pattern exists and runtime needs a server lock.
- `updatedAt DateTime @updatedAt` if current pattern allows it; otherwise avoid touching broad row timestamp behavior.

Rules:

- Existing non-artifact items keep default values but services only read/write these fields when `itemKey ∈ PHAP_BAO_CATALOG`.
- No destructive migration.
- No deletion or rewrite of existing inventory data.
- `refineLevel` remains the true persisted refine field.

## 3. Shared helper plan

Add `packages/shared/src/phap-bao-progression.ts`, exporting deterministic helpers:

- `getMaxPhapBaoStar(artifact)` → `artifact.starCap` capped by `PHAP_BAO_STAR_MAX`.
- `getMaxAwakenStage(artifact)` → `artifact.awakenCap` capped by `PHAP_BAO_AWAKEN_MAX`.
- `getPhapBaoStarUpCost(input)`
- `getPhapBaoAwakenCost(input)`
- `getPhapBaoRefineCost(input)` → artifact refine cost = equipment refine baseline × artifact premium.
- `canStarUpPhapBao(input)`
- `canAwakenPhapBao(input)`
- `computePhapBaoPowerScore(instance)`
- `computePhapBaoEffect(instance)`
- `validatePhapBaoProgression(instance)`
- `validatePhapBaoUpgradeCost(input)`

Cost inputs include artifact tier, quality, current star/refine/awaken, element, and required realm order.

Material plan:

- Same-artifact shard: item key convention `phap_bao_shard:<artifactKey>` or catalog-backed key if existing item catalog has material keys.
- `linh_tinh`
- `hon_khi`
- element stone by element: `ngu_hanh_tinh_thach_<element>` or neutral fallback.
- `linhThach`
- high milestones: `refine_protection_charm` / protection charm.

If item catalog lacks these material keys, add MISC items in `packages/shared/src/items.ts` rather than using magic strings only in API.

## 4. Star-up runtime plan

Star levels:

- Persisted range: 1 → 5.
- Star 1: base passive.
- Star 2: steady stat increase.
- Star 3: active skill unlock/upgrade.
- Star 4: cooldown/effect improvement.
- Star 5: capped stronger bonus.

Server endpoint:

- `POST /character/phap-bao/:inventoryItemId/star-up`

Server checks:

- Character owns the inventory item.
- Item is a Pháp Bảo catalog item.
- Character realm order meets `requiredRealmOrder`.
- Current star < max star.
- Required material/currency balances are sufficient.
- Duplicate concurrent request cannot spend twice.
- Transaction writes item ledger/currency ledger and increments star exactly once.

## 5. Awaken runtime plan

Awaken stages:

- Persisted range: 0 → 3 for Phase 23.7.
- Stage 1: passive bump.
- Stage 2: secondary effect.
- Stage 3: aura/active improvement with cooldown cap.

Server endpoint:

- `POST /character/phap-bao/:inventoryItemId/awaken`

Server checks:

- Ownership and catalog membership.
- Realm gate remains hard.
- Required star/refine/quality are met.
- Current awaken < max awaken.
- Material/currency balances are sufficient.
- Transaction writes item ledger/currency ledger and increments awaken exactly once.

## 6. Refine persistence plan

Current `InventoryItem.refineLevel` is already true persisted state.

Phase 23.7 will audit and, if needed, route Pháp Bảo refine through artifact-specific cost/cap:

- Higher cost than normal equipment.
- Cap by artifact tier and catalog refine cap.
- Server-authoritative cost check.
- Ledger records every material/currency spend.
- Transaction rollback on mid-operation failure.

If existing `/character/refine` already covers artifacts safely, keep endpoint reuse and add tests/caps rather than duplicating runtime.

## 7. API / authority / anti-abuse plan

Extend `PhapBaoService` and controller routes:

- `GET /character/phap-bao/list`
- `GET /character/phap-bao/:inventoryItemId/preview`
- `POST /character/phap-bao/:inventoryItemId/star-up`
- `POST /character/phap-bao/:inventoryItemId/awaken`
- `POST /character/phap-bao/:inventoryItemId/refine` for artifact-specific persisted refine cost/cap.

Authority rules:

- DB transaction for every mutation.
- Atomic guarded `updateMany` on current level to prevent double increment.
- Spend resources in the same transaction as progression update.
- Use existing `CurrencyLedger` and `ItemLedger` patterns; add new reason strings if needed.
- Failed validation spends nothing.
- Unequip is not realm-gated; equip remains realm-gated.

## 8. UI plan

Update `PhapBaoPanel.vue`:

- Render `starLevel`, `awakenStage`, `refineLevel`.
- Render current passive/active effects.
- Render next-level preview for star-up, awaken, and refine.
- Render costs and missing materials.
- Add star-up button and awaken button.
- Disable buttons with explicit reason when missing condition/resource.
- Confirm modal for costly star/awaken operations.
- Loading/error/empty states retained.
- Mobile responsive layout retained.
- vi/en i18n parity.

## 9. Balance rules

- Pháp Bảo is stronger than one normal item but weaker than a full set.
- Star-up increases power steadily at about 5–8% per star.
- Awaken increases by about 6–10% per stage or adds a capped cooldown effect.
- Total Pháp Bảo contribution target stays around 5–20% depending on progression stage.
- Tier-low artifact cannot remain endgame dominant.
- Premium future phases may accelerate but cannot exceed hard caps.
- Free players must have a farming path for shards/materials.

## 10. Tests

Shared:

- Cost increases by star/tier.
- Awaken cost increases by stage/tier.
- Cannot star-up above max.
- Cannot awaken without required star/refine/quality.
- Power increases after star-up.
- Power increases after awaken but respects cap.
- Strong effect has cooldown/cap.
- Realm gate remains hard.

API:

- Cannot upgrade artifact not owned.
- Cannot star-up without materials.
- Star-up with enough materials succeeds.
- Duplicate star-up does not double spend.
- Awaken missing condition fails.
- Awaken with enough conditions/materials succeeds.
- Refine missing cost fails.
- Ledger entries are written correctly.
- Transaction rollback leaves progression/resources unchanged.
- Equip above realm fails.
- Unequip is not realm-gated.

UI:

- Renders star level.
- Renders awaken stage.
- Renders refine level and costs.
- Renders missing material reason.
- Buttons disabled when conditions fail.
- vi/en key parity.

## 11. Docs/handoff

Update:

- `docs/phase-23-7-phap-bao-star-awaken-plan.md`
- `docs/GAME_DESIGN_BIBLE.md`
- `docs/BALANCE_MODEL.md`
- `docs/ECONOMY_MODEL.md`
- `docs/API.md`
- `docs/AI_HANDOFF_REPORT.md`
- `docs/CHANGELOG.md`

Docs must explicitly state:

- Star/refine/awaken are true persisted progression.
- Star-up consumes same-artifact shards and materials.
- Awaken requires star/refine/quality/realm/materials.
- Free players can farm progression materials.
- Phase 25.1 may add monetization accelerators, but no direct max artifact sales.

## 12. Verification commands

- `pnpm --filter @xuantoi/api prisma:generate`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

If API tests require local services:

- `pnpm infra:up`
- `DATABASE_URL="postgresql://mtt:mtt@localhost:5432/mtt" REDIS_URL="redis://localhost:6379" pnpm --filter @xuantoi/api exec prisma migrate deploy`
- `DATABASE_URL="postgresql://mtt:mtt@localhost:5432/mtt" REDIS_URL="redis://localhost:6379" pnpm test`


## 13. Implementation snapshot

- Schema migration `20260512123700_phase_23_7_phap_bao_progression` added the additive `InventoryItem` fields in §2.
- Shared helper implementation landed in `packages/shared/src/phap-bao-progression.ts` and is exported from `packages/shared/src/index.ts`.
- Runtime implementation landed in `PhapBaoService` + `CharacterController` with dedicated star-up/awaken/refine endpoints.
- UI implementation landed in `PhapBaoPanel.vue`, `InventoryView.vue`, `apps/web/src/api/phapBao.ts`, and vi/en i18n.
- Tests added/updated in shared `phap-bao.test.ts`, API `phap-bao.service.test.ts`, and web `PhapBaoPanel.test.ts`.
- Docs updated in `GAME_DESIGN_BIBLE`, `BALANCE_MODEL`, `ECONOMY_MODEL`, `API`, `AI_HANDOFF_REPORT`, and `CHANGELOG`.
