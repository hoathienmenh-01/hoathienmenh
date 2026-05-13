# Phase 35.0 — Pet / Linh Thú System Plan

Branch: `feat/phase-35-0-pet-linh-thu-system`
PR: stacked commits (35.0A → 35.0E) trên một campaign branch (do session credit hạn).

## 0. Audit (đã đọc / dùng để bám)

| Module hiện có | Vị trí | Vai trò trong Phase 35 |
|---|---|---|
| `InventoryService.grantTx` / `consumeManyByItemKeyTx` | `apps/api/src/modules/inventory/inventory.service.ts` | Grant pet shard / consume thảo dược, đan, thú hồn thạch. |
| `CurrencyService.applyTx` + `CurrencyLedger` | `apps/api/src/modules/character/currency.service.ts` | Trừ `tienNgoc` / `tienNgocKhoa` / `eventToken` khi mở hộp. Mở rộng `LedgerReason` thêm `PET_*` reasons. |
| `AdminAuditWriter` + `AdminControlCenterModule` | `apps/api/src/modules/admin-control-center/` | Audit admin grant / box adjust + permission gating. |
| `MarketV2` / `Codex` module pattern | `apps/api/src/modules/market-v2/`, `apps/api/src/modules/codex/` | Mẫu cho `modules/pet/`: service + player ctrl + admin ctrl + module file. |
| Catalog pattern | `packages/shared/src/codex.ts`, `packages/shared/src/items.ts` | Mẫu cho `packages/shared/src/pets.ts` (catalog + validators + helpers). |
| Combat snapshot | `packages/shared/src/combat-snapshot.ts` | Không sửa core; thay vào đó tạo `PetSnapshotService` adapter (mark follow-up wire sâu). |
| Loadout | KHÔNG có loadout module riêng; equip pet đi qua `CharacterPet.isEquipped` + `equippedSlot`. |
| Reward source modules | secret-realm, dungeon, boss, event… | Không inject sâu PR này; Phase 35.0D ghi catalog sources và mark `runtimeStatus: UNWIRED` cho adapter wire ở PR sau. |

Không có module `pet`/`linh-thu` hiện hữu → toàn bộ Phase 35 là greenfield.

## 1. PR strategy
1 campaign branch, commit theo từng nhóm milestone:

- **35.0A — Pet Foundation**: catalog (30+ pet, đủ hệ Ngũ Hành & phẩm), Prisma models (`CharacterPet`, `CharacterPetShard`), API equip/unequip/lock/rename, snapshot adapter, tests.
- **35.0B — Pet Box / Egg / Pity**: hộp catalog + rate đề xuất + pity gợi ý + open API + duplicate→shard + open log + admin xem log/rate. Tests.
- **35.0C — Upgrade / Evolution**: feed exp, star-up bằng shard, breakthrough mốc level, evolve, skill upgrade. Tests.
- **35.0D — Sources / Drops**: catalog static `PET_SOURCES` (FREE/EVENT/DUNGEON/BOSS/SECRET_REALM/ACHIEVEMENT/TRIAL_TOWER). `runtimeStatus: WIRED|UNWIRED` per source. GET `/pets/sources/:petKey`, `/pets/materials/sources/:itemKey`.
- **35.0E — UI / Admin / QA / Docs**: PetView (Collection / Box / Upgrade / Sources / Detail) + AdminPetView + i18n VI/EN + docs (PET_LINHTHU_SYSTEM.md, BALANCE_MODEL update, ECONOMY_MODEL update, API.md update, AI_HANDOFF_REPORT update).

## 2. Forbidden invariants (đã hiểu)
- KHÔNG bypass `InventoryService` / `CurrencyService` / ledger.
- KHÔNG direct insert `InventoryItem` / direct `Character.tienNgoc += n`.
- KHÔNG cho client gửi `cost` / `rate` / `pity` — tất cả server-authoritative.
- KHÔNG box thiếu rate/pity/log.
- KHÔNG pet PvE >12% sức mạnh / PvP >5% damage contribution.
- KHÔNG drop pet THẦN phẩm nguyên con dễ; pet hiếm đi qua shard dài hạn.
- KHÔNG bán "boss-killer" pet phá game.
- KHÔNG xóa/sửa migration cũ.
- KHÔNG skip / fake test / push main / force push.

## 3. Power cap & PvP scaling
- `petPvECapPercent`: pet đóng góp ≤ 12% (clamp trong snapshot).
- `petPvPDamageCapPercent`: pet damage contribution ≤ 5% (clamp riêng).
- `petBossSoloForbidden`: pet không thể solo boss → PetSnapshotService trả `damageSharePercent` clamp.
- Mỗi pet định nghĩa `powerBudgetTier` để Bestiary/admin báo nếu vượt budget.

## 4. Box rate / pity (đề xuất, server-side, được công bố qua `/pets/boxes/:boxKey/rates`)
- COMMON 55% / UNCOMMON 28% / RARE 12% / EPIC 4% / LEGENDARY 0.9% / MYTHIC 0.1%.
- Pity: 10 mở → ít nhất RARE; 50 → EPIC; 100 → LEGENDARY hoặc selector shard; 300 → guaranteed LEGENDARY+ selector.
- Pity counter theo `(characterId, boxKey, poolKey)`.

## 5. Upgrade cost (server-authoritative)
- Star: 1→2: 20 shard, 2→3: 40, 3→4: 80, 4→5: 150, 5→6: 300.
- Breakthrough: mốc level 20/40/60/70; tốn `THU_HON_THACH` + `YEU_DAN` cùng hệ + linhThach.
- Evolution: mốc level + star + `HUYET_MACH_TINH_HOA` (S1) / `BAN_MENH_LINH_CHAU` (S2).
- Skill upgrade: `NGU_HANH_TINH_TUY` cùng hệ.

## 6. Schema mới (Prisma migration `20350101000000_phase_35_0_pet_linh_thu_system`)
- `CharacterPet` — id, characterId, petKey, customName?, level, exp, star, quality (snapshot), rarity (snapshot), element (snapshot), evolutionStage, isLocked, isEquipped, equippedSlot?, skillLevels Json, sourceType (snapshot), obtainedAt, timestamps. Indexes: characterId, petKey, isEquipped.
- `CharacterPetShard` — id, characterId, petKey, amount, timestamps. Unique(characterId, petKey).
- `CharacterPetBoxPityCounter` — id, characterId, boxKey, poolKey, totalOpens, opensSinceRare, opensSinceEpic, opensSinceLegendary, opensSinceMythic, lastResetAt, updatedAt. Unique(characterId, boxKey, poolKey).
- `PetBoxOpenLog` — id, characterId, boxKey, poolKey, costType, costAmount (BigInt), resultType, resultKey, resultRarity, resultQuality, pityTriggered, rateVersion, createdAt. Indexes: characterId+createdAt, boxKey+createdAt.

Backrefs Character: `pets`, `petShards`, `petBoxPityCounters`, `petBoxOpenLogs`.

## 7. AdminControlCenter
- New permission: `ADMIN_MANAGE_PETS` (mirror `ADMIN_MANAGE_MARKET`/`ADMIN_MANAGE_CODEX`).
- New AdminActionType (15+): `PET_GRANT`, `PET_REVOKE`, `PET_LEVEL_ADJUST`, `PET_STAR_ADJUST`, `PET_EVOLUTION_ADJUST`, `PET_BOX_RATE_VIEW`, `PET_BOX_RATE_AUDIT`, `PET_BOX_LOG_VIEW`, `PET_SHARD_ADJUST`, `PET_PITY_RESET`, `PET_LOCK_FORCE`, `PET_UNLOCK_FORCE`, `PET_RENAME_FORCE`, `PET_EQUIP_FORCE`, `PET_UNEQUIP_FORCE`.

## 8. API endpoints
### Player (`apps/api/src/modules/pet/pet.player.controller.ts`)
- `GET /pets/catalog` — toàn bộ catalog (read-only, đã clamp).
- `GET /pets/collection` — pets của character (kèm shards).
- `GET /pets/:characterPetId` — detail.
- `POST /pets/:characterPetId/equip` — chỉ 1 slot active.
- `POST /pets/:characterPetId/unequip`.
- `POST /pets/:characterPetId/lock` / `/unlock`.
- `POST /pets/:characterPetId/rename` — validate độ dài 1–24, ký tự an toàn.
- `GET /pets/snapshot?context=PVE|PVP|BOSS|DUNGEON|SECRET_REALM` — server clamp.
- `GET /pets/boxes` — danh sách hộp + pity progress + cost.
- `GET /pets/boxes/:boxKey/rates` — rate snapshot.
- `POST /pets/boxes/:boxKey/open` body `{ count: 1|10 }` — server validate cost + roll RNG + grant.
- `GET /pets/boxes/history` — log mở hộp người chơi.
- `POST /pets/:characterPetId/feed` — feed exp item.
- `POST /pets/:characterPetId/star-up`.
- `POST /pets/:characterPetId/breakthrough`.
- `POST /pets/:characterPetId/evolve`.
- `POST /pets/:characterPetId/skills/:skillKey/upgrade`.
- `GET /pets/:characterPetId/upgrade-preview`.
- `GET /pets/sources/:petKey` / `GET /pets/materials/sources/:itemKey`.

### Admin (`apps/api/src/modules/pet/pet.admin.controller.ts`)
- `GET /admin/pets/catalog`.
- `GET /admin/pets/characters/:characterId` — character pet collection.
- `GET /admin/pets/boxes/logs` — pagination.
- `GET /admin/pets/boxes/rate-audit` — rate version diff.
- `POST /admin/pets/grant` body `{ characterId, petKey, reason }` — audit, KHÔNG cho phép cấp THẦN phẩm trừ khi bypassGate flag với role super.
- `POST /admin/pets/shard/adjust` body `{ characterId, petKey, delta, reason }` — audit.
- `POST /admin/pets/pity/reset` body `{ characterId, boxKey, poolKey }` — audit.

Tất cả admin endpoints qua `AdminAuthGuard` + ghi audit qua `AdminAuditWriter.write`.

## 9. Web UI
- Route `/pets` (player) → `PetView.vue` với tabs:
  - Collection (filter element/quality, sort).
  - Detail (stats, skills, sources).
  - Box (rate display, pity progress, open 1x/10x).
  - Upgrade (feed/star/breakthrough/evolve/skill).
  - Sources (where to farm).
- Route `/admin/pets` (admin) → `AdminPetView.vue` với tabs:
  - Catalog, Character lookup, Box logs, Rate audit, Grant tool.
- i18n VI/EN parity (`packages/web ... i18n/{vi,en}.json` add `pet.*` + `adminPet.*` namespaces).

## 10. Tests
- Shared (`packages/shared/src/pets.test.ts`): catalog 30+, key unique, quality/rarity valid, skill refs valid, every pet có ≥1 source, pity sum, rate sum = 100%, validators.
- API tests:
  - `pet.service.test.ts` (foundation): equip/unequip/lock/rename + snapshot clamp.
  - `pet-box.service.test.ts`: pity counter, rate roll (deterministic with seeded RNG), duplicate→shard, cost server-side, idempotency.
  - `pet-upgrade.service.test.ts`: feed/star/breakthrough/evolve/skill + cap.
  - `pet-source.service.test.ts`: source resolve, runtimeStatus.
  - `pet.admin.controller.test.ts`: audit log + permission.
- Web smoke: `PetView.test.ts`, `AdminPetView.test.ts`.

Target: ≥ 30 test cases mới.

## 11. Docs
- `docs/pet/phase-35-0-pet-linh-thu-system-plan.md` (file này).
- `docs/PET_LINHTHU_SYSTEM.md` (mới) — overview, catalog, balance.
- `docs/BALANCE_MODEL.md` — append "Pet power budget" section.
- `docs/ECONOMY_MODEL.md` — append "Pet box monetization / pity / shard sinks".
- `docs/API.md` — append endpoint matrix.
- `docs/AI_HANDOFF_REPORT.md` — append Phase 35 section.

## 12. Pipeline gating (DONE)
- `pnpm --filter @xuantoi/shared exec vitest run` (3819+ → +30 = ~3850).
- `pnpm --filter @xuantoi/api typecheck` + `lint --max-warnings 0` + `test`.
- `pnpm --filter @xuantoi/web typecheck` + `lint` + `test` (smoke).
- `pnpm build` (api + web).
