# Pet / Linh Thú System (Phase 35.0)

> Spec: `xuantoi_phase35_pet_linhthu_full_prompt.docx` — non-gacha-only Pet
> & Linh Thú with monetization boxes, Ngũ Hành element, server-authoritative
> snapshot, idempotent box opens.

## 1. Goals

- Long-tail collectible system that **does not require gacha for power**.
- Premium box monetization with **pity** (10/50/100/300) + **free-path**
  guarantee (every non-premium pet has ≥1 free source).
- Combat participation via **snapshot** — server clamps PvE / PvP / Boss
  contributions to caps (12% / 5% / 8% respectively).
- Ledger-first economy — all currency/item ops via `CurrencyService.applyTx`
  / `InventoryService.grantTx`.

## 2. Subphases

- **35.0A — Foundation**: shared `pets.ts` catalog (35+ pets, 15+ skills,
  validators), 4 Prisma models (`CharacterPet`, `CharacterPetShard`,
  `CharacterPetBoxPityCounter`, `PetBoxOpenLog`), `AdminControlCenter`
  permissions + 16 action types.
- **35.0B — Boxes / Pity / Open flow**: 5 boxes (standard / premium /
  element / event / ticket), idempotent open via `requestId`, pity
  counters with `reset-on-trigger`, atomic open transaction.
- **35.0C — Upgrade / Evolution**: feed (EXP item), star-up (shard
  consume), breakthrough (gate level), evolve (material), skill upgrade.
- **35.0D — Sources**: auto-generated catalog (~100 entries), free-path
  validator audit, source lookup by petKey / itemKey.
- **35.0E — UI / Admin / QA**: `/pets` (Vue 3 tabs collection/catalog/box/
  upgrade/sources/logs), `/admin/pets` (audit/character/logs/grant), i18n
  VI/EN parity, 24 service tests + smoke web tests.

## 3. Data Model Summary

```
CharacterPet                 — instance state (level/star/quality/...).
CharacterPetShard            — per-pet shard balance (consumed by star-up).
CharacterPetBoxPityCounter   — pity per (character, box, pool).
PetBoxOpenLog                — append-only audit log of opens.
```

All four FK-cascade to `Character.id` so a deletion sweeps the pet tree.

Snapshot fields (`rarity`, `quality`, `element`, `sourceType`) are taken at
obtain time so catalog rate-version updates do not break instances.

## 4. API Endpoints

### Player (`/api/pets/*`)

| Method | Path                                          | Notes                              |
| ------ | --------------------------------------------- | ---------------------------------- |
| GET    | `/catalog`                                    | filter type/element/rarity        |
| GET    | `/catalog/:petKey`                            | catalog row                        |
| GET    | `/skills`                                     | all pet skills                     |
| GET    | `/caps`                                       | PvE/PvP/Boss contribution caps     |
| GET    | `/collection`                                 | owned pets                         |
| GET    | `/shards`                                     | shard balances                     |
| GET    | `/snapshot/:context`                          | computed snapshot (PVE/PVP/BOSS/…) |
| GET    | `/boxes`                                      | all visible boxes                  |
| GET    | `/boxes/:boxKey`                              | one box                            |
| GET    | `/boxes/:boxKey/pity`                         | pity counter                       |
| GET    | `/boxes/logs`                                 | recent opens                       |
| POST   | `/boxes/:boxKey/open`                         | idempotent via `requestId`         |
| GET    | `/sources/:petKey`                            | sources for a pet                  |
| GET    | `/materials/sources/:itemKey`                 | sources for a material             |
| GET    | `/:characterPetId`                            | one pet                            |
| POST   | `/:characterPetId/equip`                      | swap-equip                         |
| POST   | `/:characterPetId/unequip`                    |                                    |
| POST   | `/:characterPetId/lock`                       |                                    |
| POST   | `/:characterPetId/unlock`                     |                                    |
| POST   | `/:characterPetId/rename`                     | length 3..40                       |
| POST   | `/:characterPetId/feed`                       | exp-item only                      |
| POST   | `/:characterPetId/star-up`                    | shard consume                      |
| POST   | `/:characterPetId/breakthrough`               | gate check                         |
| POST   | `/:characterPetId/evolve`                     | material consume                   |
| POST   | `/:characterPetId/skills/:skillKey/upgrade`   |                                    |

### Admin (`/api/admin/pets/*` — requires `ADMIN_MANAGE_PETS`)

`GET catalog` · `GET boxes` · `GET sources/audit` ·
`GET character/:id` · `GET :characterId/shards` ·
`GET :characterId/box-logs` ·
`POST grant` · `POST shard/grant` · `POST :characterPetId/revoke` ·
`POST :characterPetId/adjust` ·
`POST character/:characterId/pity-reset`.

All admin mutations require `reason` (≥5 chars) and write via
`AdminAuditWriter` with the matching `AdminActionType` (`PET_GRANT`,
`PET_REVOKE`, `PET_ADJUST_STATS`, `PET_PITY_RESET`, etc.).

## 5. Monetization Rules

- Premium boxes (`pet_box_premium`, `pet_box_event_*`) cost `TIEN_NGOC`.
- Standard boxes (`pet_box_standard`, `pet_box_element_*`) cost
  `LINH_THACH` or accept `pet_ticket_standard` / `pet_ticket_element`
  account-bound tickets.
- Every non-premium pet has ≥1 free source (DUNGEON / BOSS / ACHIEVEMENT /
  TRIAL_TOWER / FREE / SECRET_REALM). Validator
  `auditFreePathCoverage()` will refuse to start the API if a pet is
  premium-only without being flagged `isPremiumVisualOnly` or
  `isEventLimited`.

## 6. Box Rates / Pity

| Box                  | RARE | EPIC | LEGEND. | MYTHIC | Pity (R/E/L/M) |
| -------------------- | ---- | ---- | ------- | ------ | -------------- |
| Standard             | 12   | 3    | 0.5     | 0.05   | 10/50/100/300  |
| Premium              | 18   | 6    | 1.2     | 0.15   | 8/40/80/250    |
| Element              | 12   | 4    | 0.8     | 0.08   | 10/50/100/300  |
| Event (rotating)     | 15   | 5    | 1.0     | 0.10   | 10/50/100/300  |
| Ticket (free path)   | 10   | 1    | 0.1     | 0      | 10/50/100/—    |

Pity rules follow the spec rule §5: counter increments on every open, and
**resets per-tier on its own trigger**. Result is upgraded to the pity
tier and `pityTriggered=true` is logged.

## 7. Upgrade / Evolution

- **Level**: capped by `maxLevelByQuality[quality]` (e.g. PHAM 30 → THAN 100).
- **Star**: cap `starLimit` (typical 6); consumes shards per `starUpCost`.
- **Breakthrough**: at gate-level (`5/10/20/40/60/80`), level resumes.
- **Evolve**: consumes material (`pet_mat_yeu_dan` / `…tinh_tuy` etc.)
  per `evolutionStages`.
- **Skill**: independent levels per skillKey, capped by `maxLevel`.

## 8. Combat Snapshot

`PetSnapshotService.snapshotForContext(characterId, ctx)`:

1. Find equipped pet (returns null if none).
2. Compute base stats from `pets.ts.computePetSnapshot(petKey, lvl, star,
   evolution)`.
3. Apply context clamps:
   - **PVE / DUNGEON / SECRET_REALM**: `contributionCapPercent = 12`.
   - **PVP**: `damageContributionCapPercent = 5`,
     `effectMultiplier = pvpEffectivenessMultiplier (≤ 0.4)`.
   - **BOSS**: `damageContributionCapPercent = 8`.
4. Return `{ petKey, contributionCap…, finalStats, skillsActive, context }`.

Combat services (`CombatService`, `BossService`, `PvpService`) consume the
snapshot read-only — they never mutate the pet record themselves.

## 9. Admin Tools

- Audit panel: shows validator issues from
  `auditPetCatalog()` / `auditPetBoxes()` / `auditFreePathCoverage()` so
  ops can see broken refs before they ship.
- Character viewer: per-character pet list + shard balances + opens log.
- Grant/Revoke/Adjust/Pity-reset: full audit trail with required `reason`.

## 10. Tests

- `packages/shared/src/pets.test.ts` — 40 catalog tests.
- `apps/api/src/modules/pet/pet.service.test.ts` — 24 integration tests:
  - catalog read, ownership CRUD, equip swap, lock guard, rename validate.
  - snapshot context clamps (PvE 12%, PvP 5%).
  - shard balance + insufficient guard.
  - box open: cost consume + pity + result grant + idempotency.
  - upgrade: star-up shard consumption, breakthrough gate, shard guard.
- `apps/web` smoke: typecheck + lint clean, 2187/2187 tests green.

## 11. Migration Notes

- Migration `20350101000000_phase_35_0_pet_linh_thu_system/migration.sql`
  is additive: 4 new tables, 1 enum-free schema (uses string fields), all
  FK cascades to `Character`.
- Safe to run on existing DBs; no destructive drops.

## 12. Risks & Rollback

- Rollback: drop the four pet tables; remove ledger reasons / action types
  from enum union types (catalog code remains harmless dead code).
- Risk: power creep. Mitigated by per-context `contributionCap` and the
  shared `auditPetCatalog()` invariants (`pvpEffectivenessMultiplier ≤ 0.4`
  for tier > LEGENDARY).

## 13. Known Follow-ups

- Combat wire for `LinhThuSkill` active casts (currently snapshot only).
- Sect / Co-op modes integration (Phase 35.x).
- Pet trade listing on Auction House V2 (currently bind-on-pickup tickets).
