# Changelog — Xuân Tôi

Tóm tắt **người chơi / vận hành / dev** dễ đọc, theo PR đã merge vào `main`. Định dạng cảm hứng từ [Keep a Changelog](https://keepachangelog.com/) + [Semantic Versioning](https://semver.org/lang/vi/) nhưng adapt cho closed-beta:

- **Closed beta chưa release public** → versioning tạm bằng "session khoảng PR".
- Chi tiết kỹ thuật từng PR (file/path/test) nằm trong `docs/AI_HANDOFF_REPORT.md` mục "Recent Changes". File này chỉ tóm tắt **thay đổi quan trọng cho người dùng/admin**.
- Quy ước section: **Added** / **Changed** / **Fixed** / **Security** / **Docs** / **Internal**.

---

## [Unreleased]

> Pending merge: docs CHANGELOG catch-up session 9r-28 — PR #279 (achievement catalog cross-ref test) + PR #280 (Phase 11.9.C breakthrough title wire) + PR #281 (Phase 11.9.C-2 tribulation title wire).

### Added — Phase 14.0.B Sect Territory Settlement and Region Ownership (this PR)

- **Lãnh Địa Tông Môn — chiếm vùng thật** — Influence Leaderboard từ Phase 14.0.A giờ có thể được **kết toán (settlement)** thành quyền sở hữu vùng đất. Mỗi region có 1 `ownerSectId` hiện tại, kèm `periodKey` (ISO week hoặc admin-manual) và `settledAt`. Tông top influence trong vùng tại thời điểm settle sẽ chiếm vùng — nếu không có Tông nào ghi điểm thì vùng được skip (không có chủ).
- **Shared (`packages/shared/src/territory.ts`)** — extend layer 14.0.A:
  - Thêm 4 type DTO mới: `TerritorySettlementSnapshotView`, `TerritoryRegionHistoryView`, `TerritorySettlementRunResult`, `TerritoryRegionOwnerLite`. Extend `TerritoryRegionView` với `ownerSectId/ownerSectName/ownerPeriodKey/ownerSettledAt`.
  - 2 regex period validator: `TERRITORY_PERIOD_ISO_WEEK_RE` (`^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$`) + `TERRITORY_PERIOD_MANUAL_RE` (`^manual_[a-z0-9_-]{1,40}$`).
  - 3 helper pure: `isTerritoryPeriodKey(key)`, `territoryPeriodKeyForDate(date)` ISO 8601 week format `YYYY-Www` (handle year boundary), `previousTerritoryPeriodKey(now?)`. 6 unit test mới phủ catalog edge case + boundary.
- **Prisma model + migration**:
  - `SectTerritoryRegionState` (1 row / region): `regionKey @id`, `ownerSectId? FK SET NULL`, `ownerSectName?` denormalized, `periodKey?`, `settledAt`, `updatedAt`. Cho FE/runtime O(1) lookup chủ vùng hiện tại.
  - `SectTerritorySettlementSnapshot` (history per period): `id`, `regionKey`, `periodKey`, winner+runner-up denormalized id+name+points, `totalSects`, `totalPoints`, `settledAt`, `settledBy?` (admin/cron). UNIQUE `(regionKey, periodKey)` đảm bảo race-safe + idempotent.
  - Migration `20260608000000_phase_14_0_b_territory_settlement` thuần thêm 2 table mới — KHÔNG đụng `SectTerritoryInfluence` (giữ nguyên Phase 14.0.A data).
- **API runtime mới (`apps/api/src/modules/territory/territory-settlement.service.ts`)**:
  - `settleRegion(regionKey, periodKey, opts?)` — entry point chính. Idempotent qua UNIQUE: gọi 2 lần cùng `(regionKey, periodKey)` luôn return cùng snapshot id, KỂ CẢ KHI influence tăng giữa 2 call. Race-safe: 2 call đồng thời cùng key → 1 winner ghi, loser fetch lại row đã ghi (catch P2002). Skip empty regions: region không có influence → `skipped=true`, KHÔNG ghi snapshot/state. Tie-break deterministic: sect cùng điểm → `sectId.localeCompare` ASC chọn winner.
  - `settleAllRegions(periodKey)` — settle 9 region tuần tự, trả `TerritorySettlementRunResult { periodKey, settledAt, snapshots[], skippedRegions[] }`.
  - `getRegionHistory(regionKey, limit?)` — DESC theo `settledAt`, limit clamp 1..100 default 20. Throw `REGION_INVALID`.
  - `getOwnerStateMap()` — O(1) Map<regionKey, RegionState> cho enrichment + foundation cho region buff Phase 14.0.C.
- **API routes mới**:
  - `GET /territory/regions` extend trả `ownerSectId/ownerSectName/ownerPeriodKey/ownerSettledAt` per region.
  - `GET /territory/regions/:regionKey/history` (auth) — 404 `REGION_INVALID`.
  - `POST /admin/territory/settle?periodKey=…` (admin-only via `@RequireAdmin()` + `AdminGuard`) — fallback `previousTerritoryPeriodKey()` nếu không truyền `periodKey`. Non-admin → 403 `ADMIN_ONLY`. Validate `periodKey` qua `isTerritoryPeriodKey` trước khi gọi service.
  - `POST /admin/territory/regions/:regionKey/settle` (admin-only) — manual settle 1 region (dùng cho tie-break debug hoặc admin override).
- **FE layer**:
  - `apps/web/src/api/territory.ts` extend với 3 type + 3 fetcher: `getTerritoryRegionHistory(regionKey)`, `adminTerritorySettleAll(periodKey?)`, `adminTerritorySettleRegion(regionKey, periodKey?)`.
  - `apps/web/src/stores/territory.ts` extend với history cache (`Record<regionKey, TerritoryRegionHistoryView>`), `historyLoading/historyError` per-region, `settleLoading/settleError/lastSettleResult` admin state. `fetchHistory(regionKey, opts?)`/`adminSettleAll(periodKey?)`/`adminSettleRegion(regionKey, periodKey?)` race-protected (IN_FLIGHT guard).
  - `TerritoryView.vue`:
    - **Overview tab**: mỗi region row giờ có badge "Đang chiếm giữ" (chỉ render khi `ownerSectId`) + dòng "Chủ: {name} · Kết toán: {period}" / fallback "Chưa có chủ".
    - **Leaderboard tab**: thêm history panel hiển thị current owner header + DESC snapshots (winner / runner-up / points / period) + empty state + loading/error placeholder.
    - **Admin panel** (chỉ render khi `auth.user?.role === 'ADMIN'`): period text input (ISO week hoặc `manual_*`) + "Settle all" button + "Settle region" button (chỉ khi đã chọn region) + result summary "{period}: {wins} wins · {skip} skip" + error display.
  - i18n vi/en parity full key `territory.overview.{owner,noOwner,ownerSettled,ownerBadge}` + `territory.history.{title,empty,current,currentNone,row,rowNoRunner}` + `territory.admin.{title,subtitle,periodLabel,settleAll,settleRegion,running,lastResult}`.
- **Tests +56**:
  - Shared `--run territory` 23 PASS (+6 mới: ISO week regex match/reject, manual_xxx regex, isTerritoryPeriodKey, territoryPeriodKeyForDate ISO 8601, year-boundary 2025-12-29 → 2026-W01, previousTerritoryPeriodKey).
  - API `--run territory` 49 PASS — `territory-settlement.service.test.ts` +21 (empty skip, snapshot ghi + region state upsert, idempotent qua UNIQUE, idempotent kể cả khi influence tăng giữa 2 call, tie-break `localeCompare` ASC, điểm cao thắng + runner-up theo điểm, REGION_INVALID/PERIOD_INVALID throw, manual_xx accept, 2 period parallel update region state, settleAllRegions 1 winner + 8 skipped, idempotent settleAll, getRegionHistory DESC + empty + REGION_INVALID, getOwnerStateMap empty/match, TerritoryService.getRegions owner enrichment null/match) + `admin-territory.controller.test.ts` +12 (settleAll OK + fallback `previousTerritoryPeriodKey`, PERIOD_INVALID 400 trước khi gọi service, settleOne OK + skipped, REGION_INVALID 404, manual_xx accept, settledBy=req.userId, rethrow service errors).
  - API `--run admin` 356 PASS (admin guard non-admin reject covered cross-controller).
  - Web `--run Territory` 15 PASS (+8 mới: owner null không render badge, owner set → badge + "Chủ: {name}" + "Kết toán: {period}", history panel fetch on tab + DESC snapshots + empty state, admin panel hidden cho PLAYER, visible cho ADMIN, settle all → API call + result display, settle region → API call + history refresh, ADMIN_ONLY error fallback).
- **Verification**: shared typecheck + 1685 PASS / api typecheck + territory 49 + admin 356 PASS / web typecheck + Territory 15 PASS / lint clean / pnpm build ✅. KHÔNG xóa influence cũ trong PR này (rủi ro cao). Foundation cho region buff Phase 14.0.C: `getOwnerStateMap()` ready để combat layer query owner và apply buff.

### Added — Phase 14.0.A Sect Territory Influence Foundation (this PR)

- **Lãnh Địa Tông Môn — lớp ảnh hưởng vùng đất foundation** — Mỗi region (`MAP_REGIONS` 9 entry: son_coc, hac_lam, yeu_thu_dong, kim_son_mach, moc_huyen_lam, thuy_long_uyen, hoa_diem_son, hoang_tho_huyet, cuu_la_dien) giờ có **Sect Influence Leaderboard** riêng. Boss/dungeon trong region tự cộng điểm cho Tông của character clear/tham chiến — Tông nào hoạt động nhiều nhất sẽ rank cao trong vùng. **KHÔNG** có settlement capture / siege / region-wide buff / decay — defer Phase 14.0.B+ (cần cap thực tế + season reset thì cycling mới có ý nghĩa).
- **Shared (`packages/shared/src/territory.ts`)** — module mới chuyên trách lớp 14.0.A:
  - `TerritoryInfluenceSourceDef` (3 entry): `dungeon_clear` 8 pts (dailyCap 60, weeklyCap 420), `boss_participation` 12 pts (weeklyCap 96), `boss_top_damage` 20 pts (weeklyCap 80). Soft envelope tổng / character / region / week ≈ 596 pts.
  - `TerritoryRegionDef` parity 1-1 với `MAP_REGIONS`. `influenceCap = +Infinity` ở Phase 14.0.A (no enforcement).
  - Helpers: `territorySourceByKey()`, `territoryRegionByKey()`, `isTerritoryInfluenceSourceKey()`, `validateTerritoryCatalog()`, `territoryMaxPersonalPointsPerWeek()`. Pure, deterministic.
  - DTO interfaces cho 3 read endpoint: `TerritoryRegionView` / `TerritoryRegionsView` / `TerritoryLeaderboardRow` / `TerritoryLeaderboardView` / `TerritoryMyRegionRow` / `TerritoryMyView`. Re-export qua `packages/shared/src/index.ts`.
  - 16 unit test bao phủ catalog parity + region/source lookup + cap dial validation + envelope formula.
- **Prisma model + migration**:
  - `SectTerritoryInfluence` ledger row mới — `(regionKey, sectId, characterId, sourceKey, sourceType, sourceId, points, createdAt)`. Composite UNIQUE `(regionKey, characterId, sourceKey, sourceType, sourceId)` cho idempotency runtime hook. Index `(regionKey, sectId)` cho leaderboard groupBy + `(characterId, regionKey)` cho personal view.
  - Migration `20260607000000_phase_14_0_a_sect_territory_influence` thêm 1 table mới — KHÔNG đụng schema cũ. `wipeAll(prisma)` test helper cleanup row trước Character/Sect.
- **API mới (`apps/api/src/modules/territory`)**:
  - `TerritoryService.addInfluenceTx(tx, params)` — entry point duy nhất cho gameplay hook. Tx-aware (atomic với dungeon claim / boss reward parent flow). Idempotent qua composite UNIQUE — caller retry an toàn. Cap enforcement (daily/weekly) compute trước insert; reject = return null (no-op, gameplay flow vẫn thành công). Character không có sect → no-op skip. Region/source key invalid → no-op. **KHÔNG throw** — gameplay path không phá nếu territory ghi điểm fail.
  - `TerritoryService.getRegions()` → list 9 region + total influence + top sect snapshot. Region không có influence vẫn xuất hiện với `totalPoints=0`, `topSect=null`. Sort theo `MapRegionDef.sortOrder`.
  - `TerritoryService.getRegionLeaderboard(regionKey)` → top 10 sect trong region, descending điểm, tie-break sectId asc. Throw `REGION_INVALID` nếu key không hợp lệ.
  - `TerritoryService.getMyTerritory(userId)` → personal view: per-region rank/points của sect user + personal contribution. Character không có sect → `hasSect=false`, regions list đầy đủ với `sectPoints=0`, `sectRank=null`, `personalPoints` cá nhân. Throw `NO_CHARACTER` nếu user chưa onboard.
  - **`GET /territory/regions`** (auth) — wrap `getRegions`.
  - **`GET /territory/regions/:regionKey/leaderboard`** (auth) — wrap `getRegionLeaderboard`. 404 `REGION_INVALID`.
  - **`GET /territory/me`** (auth) — wrap `getMyTerritory`. 404 `NO_CHARACTER`.
  - 16 test mới (idempotency, cap enforcement, leaderboard correctness, personal view, no-sect handling, cross-region isolation).
- **Integration hooks (fail-soft pattern, mirror sect-war)**:
  - `DungeonRunService.claimRun()` — sau sect-war hook, gọi `territory.addInfluenceTx()` với `regionKey` từ `dungeonByKey(template).regionKey`. Legacy/non-region dungeon (no `regionKey`) skip. SourceId = `run.id` → composite UNIQUE đảm bảo claim retry không double điểm. `try/catch` swallow.
  - `BossService.distributeRewards()` — mọi participant rank 1+ gọi `boss_participation` hook; rank 1 thêm `boss_top_damage` bonus hook. RegionKey = `boss.regionKey` (legacy `'world'` skip vì không phải `MAP_REGIONS` region). SourceId = `${bossId}:${characterId}` → composite UNIQUE đảm bảo retry không double. `try/catch` swallow + warn log.
  - **KHÔNG** hook sect-mission — mission không gắn region (defer Phase 14.0.B+ nếu cần).
- **FE layer**:
  - `apps/web/src/api/territory.ts` — 6 interface mirror server DTO + 3 fetcher (`getTerritoryRegions`, `getTerritoryRegionLeaderboard(regionKey)`, `getTerritoryMe`). Read-only.
  - `apps/web/src/stores/territory.ts` — Pinia store `useTerritoryStore` với 3 fetcher race-protected (`IN_FLIGHT` guard) + leaderboard cache theo `regionKey` (chuyển tab giữa region không refetch).
  - `apps/web/src/views/TerritoryView.vue` — view mới với 3 tab: **overview** (region list + total influence + top sect), **leaderboard** (region picker + top 10 table với highlight my-sect row), **me** (per-region rank table cho sect user, fallback no-sect). Auth gate redirect `/auth`. Deep-link query `?tab=…&region=…`. `data-testid` đầy đủ.
  - Route `/territory` đăng ký trong `router/index.ts`.
  - i18n vi/en parity: `territory.title/subtitle/loading/tab/overview/leaderboard/me/source/errors`.
  - 7 FE test mới (auth gate / overview render / leaderboard fetch / region pick switch / me rank table / no-sect fallback / load error fallback).
- **Docs**: entry này + AI_HANDOFF_REPORT (phần "Recent Changes" dự kiến updater sau khi PR merge) + BALANCE_MODEL (territory dial table) + API.md (3 endpoint mới + breakthrough hook integration note).
- **Out of scope (Phase 14.0.A)**:
  - Decay theo thời gian / season reset persistence (defer 14.0.B+).
  - Settlement capture / siege flow / region-wide buff khi Tông giữ region (defer 14.x).
  - Region-buff khi Tông ở rank 1 (defer 14.0.C+).
  - Sect mission hook — mission không gắn region (defer cần thiết kế lại sect mission scope).
  - Admin tooling cho territory (recalc, audit snapshot).
- **Risk / rollback**: thấp. Lớp foundation thuần wrap với fail-soft hook; KHÔNG đụng dungeon/boss/sect-war reward path. Migration thuần thêm table mới, không sửa table cũ. Rollback = revert PR + drop bảng `SectTerritoryInfluence`.
- **Verification**: shared `--run territory` 16 PASS ✅ / api `--run territory` 16 PASS ✅ / api `--run dungeon-run` 50 PASS ✅ / api `--run boss` 117 PASS ✅ / api `--run sect` 146 PASS ✅ / web `--run Territory` 7 PASS ✅. Web `typecheck` PASS ✅.

### Added — Phase 14.3.A Breakthrough Tribulation Foundation (this PR)

- **Đột phá cảnh giới giờ có lớp Thiên Kiếp gating chính thức** — Phase 11.6.A đã ship catalog `TribulationDef` (8 entry: kim_dan→nguyen_anh, nguyen_anh→hoa_than, hoa_than→luyen_hu, luyen_hu→hop_the, hop_the→dai_thua, dai_thua→do_kiep, do_kiep→nhan_tien, chuan_thanh→thanh_nhan) + Phase 11.6.B đã ship runtime `attemptTribulation()` (8 wave deterministic + reward + Tâm Ma penalty). Phase 14.3.A bổ sung **lớp foundation** mỏng để: (1) UI biết trước cảnh giới kế tiếp có cần kiếp không; (2) UI ước lượng % thành công trước khi vượt; (3) breakthrough endpoint từ chối bypass khi realm yêu cầu kiếp. KHÔNG rewrite Phase 11.6.B — chỉ wrap thêm helpers + 1 endpoint preview + 1 gate.
- **Shared (`packages/shared/src/tribulation-foundation.ts`)** — module mới chuyên trách lớp 14.3.A:
  - `tribulationRequiredForBreakthrough(fromRealmKey, toRealmKey)` → boolean. Lookup `TRIBULATIONS` catalog; trả `true` ↔ catalog có entry `(fromRealmKey, toRealmKey)`. Pure, deterministic.
  - `composeTribulationSupports(entries)` → `{ entries[], totalBonus }`. Additive bonus từ items/buffs/talents/equipment. Per-entry cap `TRIBULATION_SUPPORT_PER_ENTRY_CEIL=0.10`, total cap `TRIBULATION_SUPPORT_TOTAL_CEIL=0.30` — chống stack vô hạn.
  - `computeTribulationSuccessChance({ def, primaryElement, supportTotalBonus })` → `{ base, affinity, supports, final }`. Base theo `severity` (`minor=0.75 / major=0.55 / heavenly=0.35 / saint=0.20`). Affinity ±0.05 nếu primary spirit-root khắc/bị khắc kiep element (dùng `elementalAdvantage` từ Phase 14.2.A). Final clamp envelope `[TRIBULATION_SUCCESS_CHANCE_FLOOR=0.05, TRIBULATION_SUCCESS_CHANCE_CEIL=0.95]` — giữ tension, KHÔNG cho 0%/100%.
  - `summarizeTribulationRewardHint(def)` / `summarizeTribulationPenaltyHint(def)` — pure shape compactor cho FE preview panel (không snapshot RNG).
  - Re-export qua `packages/shared/src/index.ts`. 25 unit test bao phủ catalog detection / cap clamp / chance envelope / element affinity / hint shape.
- **API mới (`apps/api/src/modules/character`)**:
  - `TribulationService.previewTribulation(characterId)` → `TribulationPreview | null`. Read-only deterministic snapshot — KHÔNG roll RNG, KHÔNG ghi `TribulationAttemptLog`. Fetch character → tính `nextRealmKey` từ `realms.ts` ladder → nếu transition không có catalog entry (low-tier hoặc realm cuối) trả `null`. Có entry → compose supports (Phase 14.3.A: empty list — defer per-source provider) → compute success chance → trả `{ requirement: true, fromRealmKey, toRealmKey, atPeak, def, successChance, supports[], supportTotalBonus, rewardHint, penaltyHint, cooldownAt, taoMaUntil }`.
  - **`GET /character/tribulation/preview`** (auth) — wrap `previewTribulation`. Idempotent. Server-authoritative.
  - **`CharacterService.breakthrough()` add `TRIBULATION_REQUIRED` gate** — trước khi cấp realm mới, check `tribulationRequiredForBreakthrough(currentRealm, nextRealm)`. Nếu `true` → throw `TRIBULATION_REQUIRED` (FE catch và redirect tới `/tribulation`). Low-tier transition (luyenkhi→truc_co, truc_co→kim_dan) tiếp tục dùng breakthrough thường. Phase 14.3.A KHÔNG đụng pipeline cũ — chỉ thêm 1 guard sớm.
  - 18 test mới (13 tribulation preview + 5 character service gate). Tổng 114 character/tribulation test pass.
- **FE layer**:
  - `apps/web/src/api/tribulation.ts` — bổ sung 7 interface mirror server preview shape (`TribulationPreviewView` + 5 sub-shape) + `fetchTribulationPreview()` client. BigInt-safe (`expBonus` là string).
  - `apps/web/src/stores/tribulation.ts` — thêm `preview: TribulationPreviewView | null | undefined` (3-state: chưa fetch / không cần kiếp / có kiếp), `previewLoading`, `previewError`, action `fetchPreview()` race-protected (`IN_FLIGHT` guard). `reset()` clear preview state.
  - `apps/web/src/views/TribulationView.vue` — `onMounted` gọi `fetchPreview()` song song `fetchHistory()`. Bổ sung **preview panel** trong upcoming card hiển thị `final %` (round), affinity badge ±5% (chỉ render khi affinity ≠ 0), supports list (foundation phase rỗng → empty hint), `data-testid` đầy đủ.
  - i18n vi/en parity: `tribulation.field.previewTitle` / `successChance` / `affinity` / `supports` / `supportsEmpty`.
  - 16 FE test mới (7 store fetchPreview + 9 view preview panel). Tổng 143 tribulation FE test pass.
- **Docs**: entry này + AI_HANDOFF_REPORT + BALANCE_MODEL (dial table) + API.md (preview endpoint).
- **Out of scope (Phase 14.3.A)**: per-source support provider (item/buff/talent/equipment registry), preview cooldown auto-refresh khi state thay đổi, multi-character support, advanced tribulation UI (countdown / element pictogram lớn).
- **Risk / rollback**: thấp. Lớp foundation thuần wrap; không migration; không đụng RNG/log path. Rollback = revert PR. Đã verify breakthrough cũ vẫn work (low-tier `truc_co → kim_dan` không bị block).
- **Verification**: shared `--run tribulation-foundation` 25 PASS ✅ / api `--run tribulation` 70 PASS ✅ / api `--run character.service` 44 PASS ✅ / web `--run tribulation` 143 PASS ✅.

### Added — Phase 14.2.A Elemental Combat Foundation (PR #477)

- **Ngũ Hành đi vào combat** — Skill / monster / equipment vốn đã có `element` (Phase 10/11) giờ thực sự ảnh hưởng damage qua một lớp "foundation" mỏng: skill cùng hệ với spirit-root nhân nhẹ (đã có Phase 11), thêm monster có `elementalResist` cản skill nhất định, trang bị có `elementalAtkBonus` cộng nhẹ % sát thương cho 1 hệ. Toàn bộ pipeline clamp envelope `[0.5×, 1.6×]` — KHÔNG phá balance hiện tại; monster/equipment chưa khai báo dữ liệu sẽ rơi về neutral 1.0×.
- **Shared (`packages/shared/src/elemental.ts`)** — module mới chuyên trách lớp 14.2.A:
  - `ElementType` (`WOOD/FIRE/EARTH/METAL/WATER`) alias English bổ sung cho `ElementKey` (`kim/moc/thuy/hoa/tho`) Vietnamese sẵn có; converter `elementTypeToKey` / `elementKeyToType` round-trip; `parseElementType` permissive (chấp nhận lowercase/null/undefined/garbage → null an toàn).
  - `elementalAdvantage(attacker, defender)` trả về `'counter' | 'generate' | 'countered' | 'generated' | 'same' | 'neutral'` mô tả chu trình tương sinh / tương khắc.
  - `elementalMultiplier(attacker, defender)` → number, neutral 1.0 nếu thiếu element, counter 1.5×, countered 0.7×, generate 1.1×, generated 0.9× (giữ envelope nhẹ, nằm trong `[0.6, 1.5]`).
  - `composeMonsterElementalResist(resist, skillElement)` — null/empty/skill vô hệ → 1.0×; clamp floor `ELEMENT_MONSTER_RESIST_FLOOR=0.7` chống gear-check đơ.
  - `composeEquipmentElementalAtkBonus(bonuses[], skillElement)` — additive stack giữa nhiều món, per-item cap `ELEMENT_EQUIPMENT_ATK_BONUS_CEIL=0.10`, total cap `ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL=0.20`.
  - `applyElementalCombatAdjustment({ skillElement, attackerPrimary, attackerSecondary, defenderElement, monsterResist, equipmentBonuses })` — pipeline 3 lớp: (1) base advantage × character spirit-root bonus, (2) × monster resist, (3) × `(1 + equipBonus)`; clamp final `[ELEMENT_COMBAT_ADJUSTMENT_FLOOR=0.5, ELEMENT_COMBAT_ADJUSTMENT_CEIL=1.6]` + return metadata `{ multiplier, advantage, monsterResistMul, equipBonus }` cho combat log.
  - 51 unit test bao phủ converter round-trip / parser permissive / cycle Ngũ Hành / clamp / cap / dial sanity.
- **Shared types**:
  - `MonsterDef.elementalResist?: Partial<Record<ElementKey, number>>` — multiplier `≤ 1` cho từng skill element. Khác với `MonsterDef.element` (affinity của chính monster) — `elementalResist` là **kháng** vs incoming skill element. Vd boss băng `huyen_bang_kiep_lang` có `element='thuy'` + `elementalResist={ hoa: 0.85 }` (kháng 15% sát thương Hoả). Floor đã clamp sẵn nên data sai cũng không phá game.
  - `ItemBonus.elementalAtkBonus?: ElementalAtkBonus` — record `Partial<Record<ElementKey, number>>` cộng % atk cho hệ tương ứng. Thiết kế: dùng cho ngọc/pháp khí buff hệ, không phải atk gốc — KHÔNG đụng các bonus vốn có (atk/def/hpMax/...).
  - `ELEMENTS` constant array (`['kim','moc','thuy','hoa','tho']`) export thêm cho FE iterate.
- **API combat (`apps/api/src/modules/combat/combat.service.ts`)** — wire `applyElementalCombatAdjustment` vào damage flow trong `action()` (skill path) và `actionViaActiveTalent()` (talent path) với parity. Pipeline: (a) lấy `skillElement` / `talentElementKey` từ catalog, (b) lấy character primary/secondary spirit-root từ `getOrCreateSpiritRootSet`, (c) lấy `monster.elementalResist`, (d) gọi `inventory.equipElementalAtkBonus(characterId, element)` → tổng cap'd, (e) compose qua `applyElementalCombatAdjustment` → multiplier × `Math.max(1, atk - def)`. Bảo toàn nhân `characterSkillElementBonus` (Phase 11) — KHÔNG double-apply.
- **API combat log** — non-trivial event mới (skip khi neutral 1.0×):
  - `monsterResistMul < 0.95` → `"<monster> kháng hệ <element> ×0.85."`
  - `equipBonus ≥ 0.05` → `"Trang bị tăng 8% sát thương hệ <element>."`
- **API inventory (`apps/api/src/modules/inventory/inventory.service.ts`)** — thêm `equipElementalAtkBonus(characterId, skillElement)` đọc các slot equipped, gom `bonuses.elementalAtkBonus` của từng item, gọi `composeEquipmentElementalAtkBonus` (cap'd) → trả về số cộng additive cho combat.
- **FE component `apps/web/src/components/ElementBadge.vue`** — atom hiển thị Ngũ Hành affinity:
  - Props: `element` (ElementKey | ElementType | string | null, permissive), `showNeutral` (default `false`), `size` (`sm`/`md`).
  - i18n namespace `elementBadge.element.<key>` + `elementBadge.neutral` (vi/en parity).
  - Color coding: kim → ink-200, moc → emerald-300, thuy → sky-300, hoa → rose-300, tho → amber-300; neutral → ink-300.
  - `data-testid="element-badge-<key>"` + `data-element` attribute cho test stable.
  - 26 test bao phủ render rules / parse permissive / color class / size variant.
- **FE views integration**:
  - `SkillBookView.vue` — replace inline element span bằng `<ElementBadge>` (giữ nguyên `data-testid="skill-book-element-<key>"`, hiện neutral khi skill vô hệ).
  - `DungeonView.vue` — thêm badge cạnh tên monster (chỉ render khi monster có element, no badge cho monster vô hệ — giữ UI compact).
- **Docs**:
  - `docs/BALANCE_MODEL.md` — bổ sung mục "Phase 14.2.A — Elemental combat foundation dials" liệt kê 5 dial mới + envelope final clamp + ý nghĩa.
  - `docs/AI_HANDOFF_REPORT.md` — entry "Phase 14.2.A".
  - `docs/CHANGELOG.md` — entry này.
- **Out of scope (Phase 14.2.A)**: rewrite combat pipeline, Spiritual Root runtime mở rộng (vẫn dùng Phase 11), data populate `elementalResist` cho toàn bộ monster catalog, populate `elementalAtkBonus` cho item catalog (data PR sau, foundation đã sẵn), large UI refactor.

### Added — Phase 12.10.A NPC Affinity & Relationship Foundation (this PR)

- **NPC giờ có điểm thân tình (affinity) riêng** — Mở nền móng quan hệ NPC: mỗi (character, NPC) có 1 điểm số từ `minScore..maxScore` (per-NPC catalog), tăng/giảm qua dialogue choice + future quest reward, vượt mốc `AFFINITY_TIERS` (Xa Lạ → Quen Biết → Bằng Hữu → Tri Giao → Tri Kỷ) sẽ unlock dialogue/quest mới. Phase 12.10.A KHÔNG ship gift/shop NPC — chỉ foundation runtime + FE relationship panel + dialogue change_affinity hook.
- **Shared catalog** (`packages/shared/src/npc-affinity.ts`):
  - `AffinityTierDef` 5 tier universal `xa_la`(-1000) / `quen_biet`(10) / `ban_huu`(30) / `tri_giao`(60) / `tri_ky`(100), `order` 0..4 stable, label vi/en parity.
  - `NpcAffinityDef` per-NPC: `initialScore` / `minScore` / `maxScore` / `unlockHints[]` (mỗi hint gắn `tierKey` + i18n description). Catalog 5 NPC trụ cột (Lăng Vân Sinh / Mộc Thanh Y / Hàn Dạ / Tô Nguyệt Ly / Huyết La Sát) với cap min/max khác nhau theo bản chất (đồng môn ≤ 200, rival ≤ 150, ma tu ≤ 100; floor -50 đến -100).
  - Helpers `affinityTierForScore` / `nextAffinityTierForScore` / `npcAffinityDefForKey` / `clampAffinityScore` / `validateNpcAffinityCatalog` — pure, KHÔNG đụng runtime.
  - Hard cap `AFFINITY_DELTA_CAP_PER_CHOICE = 20` + `AFFINITY_DELTA_CAP_PER_QUEST_REWARD = 40` — validator + service runtime double-check chống farm.
  - Dialogue effect mới `change_affinity { npcKey, delta }` + condition mới `affinity_min { npcKey, score }` (trong `story-dialogues.ts`); validator catalog kiểm tra `delta` trong cap + npcKey ∈ catalog.
  - Test catalog Hàn Dạ +2 node (`story_dlg_han_da_friendly_chat` với choice `+10` warm / `-5` cold, `story_dlg_han_da_inner_secret` gate `affinity_min:han_da≥30`) — minh hoạ full flow.
- **Prisma migration `20260606000000_phase_12_10_a_character_npc_affinity`**: thêm 1 table `CharacterNpcAffinity` (`id` PK / `characterId` FK cascade / `npcKey` / `score` Int / `createdAt` / `updatedAt`) + composite UNIQUE `(characterId, npcKey)` + index `(characterId)` cho list view + `(npcKey)` cho admin audit. Additive — KHÔNG đụng `Character` / `StoryDialogue` runtime model.
- **API mới**:
  - `NpcAffinityService.addAffinityTx(tx, { characterId, npcKey, delta, source })` — atomic upsert + clamp `[minScore, maxScore]` + return tier diff (`previousTier` / `newTier` / `tierChanged`). Caller chịu trách nhiệm idempotency guard.
  - `NpcAffinityService.addAffinity(...)` — convenience wrapper mở `$transaction` mới (admin/test path).
  - `NpcAffinityService.listForCharacter(characterId)` / `getForNpc(characterId, npcKey)` / `loadScoreMap(characterId)` — read view, lazy fallback `initialScore`.
  - **`GET /story/npc-affinity`** (auth) → list affinity cho TẤT CẢ NPC trong catalog `NPC_AFFINITY` (lazy fallback `initialScore` khi chưa có row), kèm `caps: { perChoice, perQuestReward }`.
  - **`GET /story/npc-affinity/:npcKey`** (auth) → get single NPC affinity view (`score` / `currentTier` / `nextTier` + `pointsToReach` / `unlocks[]` với `reached` flag).
- **Story dialogue integration** (`apps/api/src/modules/story-dialogue/story-dialogue.service.ts`):
  - `evaluateCondition` handle `affinity_min` (lookup `CharCtx.affinityByNpc`).
  - `applyChoice` apply `change_affinity` effect bên trong cùng `$transaction` với `give_reward` / `set_flag` / `mark_seen` — atomic. Pre-flight cap check `|delta| ≤ AFFINITY_DELTA_CAP_PER_CHOICE`.
  - **Idempotency**: dialogue choice retry KHÔNG double-grant — `change_affinity` được kê vào `hasGrantEffect` nhánh, `seen.includes(node.id)` → throw `ALREADY_APPLIED` mirror pattern `give_reward`.
  - `loadCtx` load affinity score map qua `NpcAffinityService.loadScoreMap`.
  - Response `StoryDialogueChoiceResult.affinityChanges[]` (1 entry / `change_affinity` effect đã apply): `{ npcKey, delta, previousScore, newScore, tierChanged, previousTierKey, newTierKey, newTierLabel }` cho FE toast + tier-up badge.
- **FE relationship panel + dialogue affinity feedback**:
  - `apps/web/src/components/NpcAffinityPanel.vue` mới — list 5 NPC từ catalog với name + score progress bar (`(score - min) / (max - min)` × 100%) + current tier label + next tier hint ("Còn X điểm để lên Y") + unlock list (per tier; `reached` ✓ marker) + max-tier reached state. `data-testid` đầy đủ cho test.
  - `apps/web/src/api/npcAffinity.ts` API client (`fetchNpcAffinities` / `fetchNpcAffinity`) + `apps/web/src/stores/npcAffinity.ts` Pinia store (`load` / `refresh` / `findByNpcKey` / `reset`).
  - `NpcView.vue` mount `NpcAffinityPanel` + auto-refresh sau dialogue effect apply.
  - `StoryDialogueModal.vue` show toast `+N thân thiện` + tier-up toast khi `tierChanged=true`.
  - i18n vi/en parity: `npcAffinity.title/subtitle/empty/nextTierHint/maxTierReached/errors.*` + `storyDialogue.affinityDelta/tierUp`.
- **Tests +43**:
  - **Shared** (`packages/shared/src/npc-affinity.test.ts` mới + `story-dialogues.test.ts` extend, +18+5=23 case): catalog invariant (5 NPC ∈ NPCS / unique / min<max / initialScore in bounds / unlockHints tier valid); tier ladder integrity (order 0..4 / strict ascending minScore); `affinityTierForScore` boundary (xa_la / quen_biet / ban_huu / tri_giao / tri_ky); `nextAffinityTierForScore` (max → null); `clampAffinityScore`; story-dialogue validator cover `change_affinity` cap + `affinity_min` npcKey ∈ catalog.
  - **API** (`apps/api/src/modules/npc-affinity/npc-affinity.service.test.ts` mới + `story-dialogue.service.test.ts` extend): service add lazy-create + positive/negative delta + clamp min/max + INVALID_DELTA + CAP_EXCEEDED + NPC_AFFINITY_UNKNOWN + tierChanged detection + listForCharacter fallback initialScore + getForNpc fallback + loadScoreMap + resolveScore static helper; dialogue affinity integration `+10` warm choice persisted, `-5` cold choice persisted, retry `ALREADY_APPLIED` no double-grant, `affinity_min` gate hide locked node + reject `INVALID_CHOICE` reason `affinity_min`, seed score ≥30 unlock node + apply effects, tier-cross detection `xa_la → quen_biet`.
  - **FE** (`apps/web/src/components/__tests__/NpcAffinityPanel.test.ts` mới, +12 case): empty/loading/error state; render NPC name+score+tier+next-hint+unlocks; max-tier render; progress bar width math; refresh button; autoLoad mount; store load/error/findByNpcKey/reset.
- **Risk / rollback**: thấp. 1 migration mới (additive table), KHÔNG đụng `Character` / `StoryDialogue` schema. Rollback = revert PR + drop `CharacterNpcAffinity`. Story dialogue integration backward-compatible — choice không có `change_affinity` / node không có `affinity_min` → 0 effect.
- **Out of scope** (defer Phase 12.10.B): NPC gift system, NPC shop, quest reward `change_affinity` (quest catalog chưa support `affinityRewards`), affinity ledger truy vết granular, admin grant endpoint.
- **Verification**: shared typecheck ✅ / shared 1580 PASS ✅ / api typecheck ✅ / web typecheck ✅ / web `--run NpcAffinity StoryDialogue` 26 PASS ✅ / pnpm build (pending CI).

### Added — Phase 13.2.B Sect Season Milestones + Rewards (this PR)

- **Sect Season giờ có claim thưởng thật** — Phase 13.2.A đã ship foundation read-only (13 mùa × 4 tuần, 5 tier milestone catalog). Phase 13.2.B mở claim runtime: player đạt milestone (bronze 100pt → silver 500pt → gold 1500pt → platinum 3500pt → diamond 7500pt) bấm nút **Nhận thưởng** để nhận `linhThach` / `tienNgoc` / item / title / buff. **Idempotent + race-safe**: 1 milestone = 1 claim/character (CAS guard qua `SectSeasonClaim` UNIQUE `(characterId, seasonKey, milestoneKey)`).
- **Prisma migration** `20260605000000_phase_13_2_b_sect_season_claim`: 1 table mới `SectSeasonClaim` (`id` / `characterId` FK cascade / `seasonKey` / `milestoneKey` / `pointsAtClaim` / `rewardSnapshot` Json / `claimedAt` default now()) + composite UNIQUE `(characterId, seasonKey, milestoneKey)` → P2002 fallback path khi 2 request concurrent + 2 index `(characterId, seasonKey)` cho FE list view + `(seasonKey, milestoneKey)` cho admin audit.
- **API mới**:
  - `GET /sect-season/milestones` (public) — catalog snapshot 5 milestone tier kèm reward (linhThach/items/titleKey/buffKey).
  - `POST /sect-season/milestones/:milestoneKey/claim?seasonKey=...` (auth required) — atomic Prisma `$transaction`: (1) verify season + milestone tồn tại; (2) verify character tồn tại; (3) aggregate `personalPoints` qua `sectSeasonWeekKeys(season)` từ `SectWarContribution`; (4) reject nếu `< requiredPoints` (`SECT_SEASON_NOT_ELIGIBLE`); (5) cheap pre-check `findUnique` claim row → `SECT_SEASON_ALREADY_CLAIMED`; (6) `tx.sectSeasonClaim.create` (P2002 → `SECT_SEASON_ALREADY_CLAIMED`); (7) reward grant qua `CurrencyService.applyTx` (linhThach/tienNgoc + ledger reason `SECT_SEASON_REWARD`) + `InventoryService.grantTx` (items + reason `SECT_SEASON_REWARD`) + `TitleService.unlockTitleTx` (`source='sect_season'`) + `BuffService.applyBuffTx`. Race: 2 concurrent claim → 1 winner success + 1 reject `SECT_SEASON_ALREADY_CLAIMED`, ledger total chỉ +1×reward (không double grant).
  - `GET /sect-season/me?seasonKey?` extend (Phase 13.2.A → B): response thêm `claimedMilestoneKeys` (đã claim, từ DB) + `claimableMilestoneKeys = achieved \ claimed` (FE bật claim button cho mọi key trong list).
- **Server-authoritative**: FE KHÔNG self-derive achieved/claimable — server tính `claimedMilestoneKeys` từ `SectSeasonClaim` table + `claimableMilestoneKeys` từ catalog cross `personalPoints`. Sau claim thành công, FE gọi `refresh()` để reload state, claim button bị thay bởi badge **"Đã nhận"**.
- **FE nâng cấp** (`apps/web/src/components/SectSeasonPanel.vue`):
  - Mỗi milestone row có 4 state: **claimable** (button "Nhận thưởng" enable) → **claiming** (button text "Đang nhận…" disable) → **claimed** (badge xanh "Đã nhận") → **locked** (label "Chưa đạt").
  - Sau claim success: result toast hiển thị reward summary (linhThach/tienNgoc/items count/title/buff) + button "Đóng" dismiss.
  - Sau claim fail: error toast i18n theo error code (`SECT_SEASON_NOT_ELIGIBLE` / `SECT_SEASON_ALREADY_CLAIMED` / `SEASON_NOT_FOUND` / `NO_CHARACTER` / fallback `UNKNOWN`) + button "Đóng" dismiss.
  - i18n vi/en parity: thêm `sectSeason.dismiss` / `sectSeason.milestone.{claim,claiming,claimed}` / `sectSeason.claimResult.title` + 3 error code mới (`SECT_SEASON_MILESTONE_NOT_FOUND` / `SECT_SEASON_NOT_ELIGIBLE` / `SECT_SEASON_ALREADY_CLAIMED`).
- **Tests +27**:
  - **Shared** (`packages/shared/src/sect-season.test.ts` extend): `sectSeasonMilestoneByKey` lookup; `validateSectSeasonMilestone` invariant + monotonic ascending requiredPoints.
  - **API service** (`apps/api/src/modules/sect-season/sect-season.service.test.ts` extend): `listMilestones` snapshot; `getMyStatus` claim view (claimedKeys empty + claimableKeys = achieved); `getMyStatus` after claim (claimedKeys reflect + claimableKeys excluded); `claimMilestone` 4 error case (milestone not found, season not found, no character, not eligible); `claimMilestone` success grant currency + claim row + ledger row reason `SECT_SEASON_REWARD` + refId `{seasonKey}:{milestoneKey}`; `claimMilestone` double claim reject `SECT_SEASON_ALREADY_CLAIMED`; `claimMilestone` multiple tiers separate refIds; `claimMilestone` concurrent race (`Promise.allSettled` 2x) → 1 winner success.
  - **API controller** (`apps/api/src/modules/sect-season/sect-season.controller.test.ts` mới, +19 case): auth requirements (401 `UNAUTHENTICATED` cho `/current` + `/me` + `/claim`); public endpoints (`/leaderboard` + `/milestones` no auth); error mapping (404 cho `NO_CHARACTER`/`SEASON_NOT_FOUND`/`SECT_SEASON_MILESTONE_NOT_FOUND`, 400 cho `SECT_SEASON_NOT_ELIGIBLE`/`SEASON_KEY_REQUIRED`, 409 cho `SECT_SEASON_ALREADY_CLAIMED`); param + query passing.
  - **FE** (`apps/web/src/components/__tests__/SectSeasonPanel.test.ts` extend +4 case): claim button render cho `claimableMilestoneKeys`; claim success → result toast + reload state + badge "Đã nhận" thay button; claim error → i18n toast (`SECT_SEASON_ALREADY_CLAIMED`); claimed milestone render badge thay vì button.
- **Risk / rollback**: thấp. 1 migration mới (additive table), KHÔNG đụng `SectWarContribution` / `SectSeasonClaim` chưa có row trên prod → rollback = revert PR + drop table.
- **Out of scope** (theo scope user request): KHÔNG làm PvP realtime / auction / diplomacy / sect-wide milestone (chỉ personal milestone Phase 13.2.B), KHÔNG phá Sect War hiện có.
- **Verification**: shared typecheck ✅ / shared `--run sect-season` ✅ / api typecheck ✅ / api `--run sect-season` 46 PASS ✅ (27 service + 19 controller) / api `--run sect-war` PASS ✅ (zero regression) / web typecheck ✅ / web `--run SectSeason` 11 PASS ✅ / pnpm build ✅.

### Added — Phase R1 Production Readiness — CSP, env, healthcheck, deploy docs (PR #473)

### Added — Phase 13.2.C Sect Season History + Hall of Fame (PR #474)

- **Tông Môn giờ có lịch sử mùa giải + bảng vinh danh tích lũy** — Phase 13.2.A đã ship Sect Season Foundation (mùa giải 4 tuần × 13 mùa, leaderboard live + milestone progression read-only). Phase 13.2.C ship **snapshot mùa kết thúc** + **Hall of Fame** tích lũy quán quân/MVP qua các mùa, tạo nền cho Phase 13.2.B+ season settlement runtime sau này. Vẫn read-only end-user (KHÔNG grant reward, KHÔNG title award), nhưng **có Prisma migration** cho 3 bảng snapshot.
- **Shared types mới** (`packages/shared/src/sect-season.ts`):
  - **`SECT_SEASON_TOP_MEMBERS = 10`** — top 10 individual contributors lưu mỗi mùa.
  - **`SectSeasonHistorySectEntry`** — `{ rank, sectId, sectName, points, contributors, weeksContributed }` (parity field với leaderboard live + audit-correct sectName tại finalize).
  - **`SectSeasonHistoryMemberEntry`** — `{ rank, characterId, characterName, sectId|null, sectName|null, points }` (member có thể không thuộc Sect tại lúc finalize).
  - **`SectSeasonHistorySummary`** — `{ seasonKey, finalizedAt, totalSects, totalContributors, totalPoints, champion: SectSeasonHistorySectEntry|null, mvp: SectSeasonHistoryMemberEntry|null }` cho list view nhanh không JOIN.
  - **`SectSeasonHistoryView`** — `{ seasonKey, finalizedAt, totalSects, totalContributors, totalPoints, sects: SectSeasonHistorySectEntry[], topMembers: SectSeasonHistoryMemberEntry[] }` cho detail view.
  - **`SectSeasonHistoryListView`** — `{ seasons: SectSeasonHistorySummary[] }` (newest first by `finalizedAt desc`).
  - **`SectHallOfFameSectEntry`** — `{ sectId, sectName, championships, podiums, appearances, bestRank, totalPoints, latestSeasonKey }`.
  - **`SectHallOfFameMemberEntry`** — `{ characterId, characterName, mvps, podiums, appearances, bestRank, totalPoints, latestSeasonKey, latestSectName: string|null }`.
  - **`SectHallOfFameView`** — `{ sects, members, totalSeasonsFinalized }` cho aggregate cumulative.
- **Prisma migration `20260605000000_phase_13_2_c_sect_season_history`**:
  - `SectSeasonSnapshot { id PK, seasonKey UNIQUE, finalizedAt, totalSects, totalContributors, totalPoints, championSectId?, championSectName?, championPoints?, mvpCharacterId?, mvpCharacterName?, mvpSectId?, mvpSectName?, mvpPoints? }` — denormalized champion/MVP cho list không JOIN. `seasonKey` UNIQUE = guard double-snapshot ở DB level.
  - `SectSeasonSectRank { id PK, seasonId FK, rank, sectId, sectName, points, contributors, weeksContributed }` + composite UNIQUE `(seasonId, rank)` + `(seasonId, sectId)`.
  - `SectSeasonTopMember { id PK, seasonId FK, rank, characterId, characterName, sectId?, sectName?, points }` + composite UNIQUE `(seasonId, rank)` + `(seasonId, characterId)`.
  - `Character` nhận `sectSeasonTopMembers SectSeasonTopMember[]` reverse relation (no schema impact, chỉ là query helper).
  - **Migration KHÔNG đụng `SectWarContribution`/`SectWarRewardClaim`/`Character`/`Sect` schema hiện có** — chỉ thêm 3 bảng mới.
- **API mới** (read-only player-facing):
  - **`GET /sect-season/history`** (no auth) → list tất cả mùa đã chốt newest first; mỗi entry có `champion`/`mvp` denormalized cho list view nhanh; empty array khi chưa có mùa nào finalized.
  - **`GET /sect-season/history/:seasonKey`** (no auth) → detail snapshot 1 mùa (full sect leaderboard `rank asc` + top 10 member `rank asc`); 404 `SNAPSHOT_NOT_FOUND` khi mùa chưa finalize / 404 `SEASON_NOT_FOUND` khi `seasonKey` ∉ catalog.
  - **`GET /sect-season/hall-of-fame`** (no auth) → aggregate cumulative qua tất cả snapshot. Sect ordering: `championships desc → podiums desc → totalPoints desc → sectId asc`. Member ordering: `mvps desc → podiums desc → totalPoints desc → characterId asc`. `bestRank` = min rank đã đạt; `latestSeasonKey` = mùa gần nhất tham gia.
- **Verification**: shared typecheck ✅ / api typecheck ✅ + `--run sect-season` 31 PASS ✅ + `--run sect-war` 15 PASS ✅ / web typecheck ✅ + `--run SectSeason` 14 PASS ✅ / pnpm build ✅.

- **API ready hơn cho staging/production deploy** — Trước PR này, `apps/api/src/main.ts` đã có CSP + healthcheck + secret guard nhưng logic mix trong `bootstrap()`, **không có unit test** cho các nhánh production. PR R1: extract pure helper sang `bootstrap-config.ts` (testable, không cần boot Nest), thêm 26 lock-in test cho CSP/CORS/secret + 6 lock-in test chống commit `.env` thật, doc hóa env list + deploy smoke checklist + CSP troubleshooting. **KHÔNG đụng gameplay**, **KHÔNG migration**, **KHÔNG đổi runtime LiveOps/SectWar/Phase 13.2.x**.
- **Pure config helpers** (`apps/api/src/bootstrap-config.ts`):
  - **`assertProductionSecrets(env=process.env)`** — no-op khi `NODE_ENV !== 'production'`. Trong prod: throw nếu thiếu `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`, throw nếu giá trị thuộc `INSECURE_DEFAULTS = { 'change-me-access-secret', 'change-me-refresh-secret', 'dev-access-secret', 'dev-refresh-secret' }`. Message tiếng Việt rõ ràng (`[xuantoi/api] Production phải có env: ...` / `[xuantoi/api] Production không được dùng giá trị mặc định cho ...`).
  - **`corsConfig(env=process.env)`** — prod: throw nếu thiếu `CORS_ORIGINS`, csv parse trim+filter, return `{ origin: string[], credentials: true }`. Dev: dùng `CORS_ORIGINS` nếu có, fallback `['http://localhost:5173']` (Vite default).
  - **`helmetConfig(env=process.env)`** — dev: `{ contentSecurityPolicy: false }` (tắt để Vite HMR/inline script). Prod: 11 directive `defaultSrc/scriptSrc/styleSrc 'self'`, `imgSrc 'self' data:`, `connectSrc 'self'`, `fontSrc 'self' data:`, `objectSrc 'none'`, `baseUri 'self'`, `formAction 'self'`, `frameAncestors 'none'`, `upgradeInsecureRequests` + HSTS 180 ngày `includeSubDomains`, `referrerPolicy no-referrer`, `crossOriginResourcePolicy same-site`, `crossOriginEmbedderPolicy false`. KHÔNG `'unsafe-inline'`/`'unsafe-eval'`/wildcard `*`.
  - `main.ts` simplified: import 3 helper, `bootstrap()` call `assertProductionSecrets()` rồi `NestFactory.create(AppModule, { cors: corsConfig() })` + `app.use(helmet(helmetConfig()))`.
- **Healthcheck** (đã ship trước, audit-only — KHÔNG đổi):
  - `GET /api/healthz` → 200 `{ ok, uptimeMs, ts }` liveness.
  - `GET /api/readyz` → 200 `{ ok, checks: { db: { ok, latencyMs }, redis: { ok, latencyMs } } }` hoặc 503 nếu DB/Redis fail (load balancer rotate instance ra).
  - `GET /api/version` → meta `{ name, version, gitSha, ts }` (commit SHA cho deploy verify).
- **Tests mới**:
  - `apps/api/src/bootstrap-config.test.ts` (+26 case): `assertProductionSecrets` 8 case (dev no-op × 3, missing JWT_ACCESS/REFRESH, both insecure default × 4 cho ACCESS/REFRESH, length-only validation cho prod minimum); `corsConfig` 6 case (dev fallback, dev csv parse, dev empty, prod missing throw, prod csv parse, prod single origin); `helmetConfig` 12 case (dev tắt CSP, prod CSP đủ 11 directive, KHÔNG unsafe-inline/eval/wildcard, HSTS 15552000 includeSubDomains preload=false, referrer-policy no-referrer, CORP same-site, COEP false, object-src + frame-ancestors none).
  - `apps/api/src/security-secret-leak.test.ts` (+6 case): `apps/api/.env.example` chỉ chứa placeholder (length < 32 hoặc trong `ALLOWED_PLACEHOLDERS`); `apps/web/.env.example` không có key match `SECRET|PASSWORD|TOKEN|PRIVATE_KEY` không-prefix `VITE_`; `apps/api/.env` + `apps/web/.env` được `git check-ignore` reject; root `.gitignore` có rule `.env` + whitelist `!.env.example`.
- **Docs mới**:
  - `docs/PRODUCTION_CHECKLIST.md` — 5 section: env list bắt buộc/khuyến nghị/anti-pattern; deploy smoke checklist (health probe, CSP header `curl -I`, auth+session, core gameplay loop, admin+audit, cleanup); CSP troubleshooting (inline script, WebSocket cross-domain, CDN style/font, image data: URI, iframe embed, verify CSP nhanh local); lock-in test inventory; rollback nguyên tắc.
  - `docs/DEPLOY.md` + `docs/SECURITY.md` — companion banner cross-link tới `PRODUCTION_CHECKLIST.md`.
- **Risk / rollback**: thấp. R1 **append-only** + 1 file refactor (`main.ts` chỉ extract helper sang file mới — behavior identical). KHÔNG migration, KHÔNG schema, KHÔNG đụng module/controller nào ngoài `main.ts`. Rollback = revert PR.
- **Out of scope** (theo scope user request): KHÔNG sửa gameplay, KHÔNG làm Phase 13.2.B+, KHÔNG đổi secret thật, KHÔNG commit `.env` thật, KHÔNG deploy prod thật trong session này (chỉ verify config).
- **Verification**: api typecheck ✅ / api `--run health` 13 PASS ✅ (10 unit + 3 integration) / api `--run security-secret-leak` 6 PASS ✅ / api `--run bootstrap-config` 26 PASS ✅ / api lint ✅ / pnpm build ✅.
- **Next roadmap**: (1) env-driven CSP `connectSrc` cho FE khác domain (hiện hard-code `'self'`); (2) Phase 13.2.B Sect Season Reward Claim (deferred to gameplay PR); (3) Dockerfile + `docker-compose.prod.yml` để có image deploy cho VPS / fly.io / k8s; (4) preview deploy trên Vercel/Netlify cho staging E2E test.

### Added — Phase 13.2.A Sect Season Foundation (PR #472)

- **Tông Môn giờ có mùa giải dài hạn** — Phase 13.1.A/B/C/D đã ship Sect War tuần (`SectWarContribution`, `SectWarRewardClaim`, leaderboard tuần, missions, shop, admin LiveOps preview/dry-run). Phase 13.2.A mở foundation cho **Sect Season** — chuỗi mùa giải 4 tuần × 13 mùa (≈ 1 năm) phủ `2026-03-30 → 2027-03-28 ICT`, derive điểm season từ weekly contribution **read-only** (KHÔNG mutate, KHÔNG migration, KHÔNG reward claim) + 1 tab UI Season trong `/sect-war` cho player xem milestone progression + leaderboard mùa.
- **Shared catalog mới** (`packages/shared/src/sect-season.ts`):
  - **`SectSeasonDef`** — `{ key: 's1'..'s13', startsAtIso, endsAtIso, durationWeeks: 4, timezone: 'Asia/Ho_Chi_Minh', labelI18nKey, descriptionI18nKey }`. **`SECT_SEASONS`** — 13 mùa liên tiếp Monday 00:00 ICT (UTC+07), mỗi mùa = 4 tuần ISO.
  - **`SectSeasonMilestoneDef`** — `{ key, requiredPoints, reward: SectSeasonRewardGrant, labelI18nKey, descriptionI18nKey }`. **`SECT_SEASON_MILESTONES`** — 5 cột mốc monotonic increasing: `bronze` 100pt, `silver` 500pt, `gold` 2000pt, `platinum` 5000pt, `diamond` 7500pt. `SectSeasonRewardGrant` = optional `{ linhThach, tienNgoc, items[], titleKey, buffKey }` — Phase 13.2.A KHÔNG grant; chỉ display preview.
  - **Helpers**: `sectSeasonByKey(key)`, `sectSeasonMilestoneByKey(key)`, `currentSectSeason(now=Date)` (resolve theo Monday ICT, return `null` khi out-of-range), `sectSeasonWeekKeys(season)` (return ISO week keys `YYYY-Www` × `durationWeeks` để aggregate), `sectSeasonAchievedMilestones(points)`, `sectSeasonNextMilestone(points)`.
  - **Validators**: `validateSectSeason(s)`, `validateSectSeasonMilestone(m)`, `validateSectSeasonMilestonesMonotonic(list)` — fail-fast invariant key/duration/points strictly increasing.
- **API mới** (no migration, read-only aggregation):
  - **`GET /sect-season/current`** — auth required, return `{ seasonKey, season, milestones, leaderboard, me }`. Resolve season qua `currentSectSeason(now)`; nếu out-of-range trả `seasonKey=null`/`season=null`.
  - **`GET /sect-season/leaderboard?seasonKey?`** — public, return `{ seasonKey, rows: ReadonlyArray<{ rank, sectId, sectName, points, contributors, weeksContributed }> }`. Top 10 sect tổng hợp qua `sectSeasonWeekKeys(season)` × `SectWarContribution`. Tie-break: total points desc → sectId asc (deterministic).
  - **`GET /sect-season/me?seasonKey?`** — auth, return `{ seasonKey, hasSect, sectId, sectName, personalPoints, weeksContributed, achievedMilestoneKeys[], nextMilestoneKey }` hoặc `null` khi out-of-season.
  - **`SectSeasonService`** read-only: `groupBy SectWarContribution where weekKey IN (sectSeasonWeekKeys)`, không INSERT/UPDATE bất kỳ row nào — Phase 13.2.A là pure aggregation. **`SECT_SEASON_LEADERBOARD_TOP = 10`** constant. `SectSeasonError { code: 'NO_CHARACTER' | 'SEASON_NOT_FOUND' }`.
- **FE Season tab** (`apps/web/src/views/SectWarView.vue` + new `SectSeasonPanel.vue`):
  - Thêm tab `season` vào `SectWarTab` union (`overview/leaderboard/missions/shop/rewards/season`). Click tab Season → mount `SectSeasonPanel` truyền `mySectId` từ `state.me.sectId`.
  - Panel render: header season label + countdown (`{d}d {h}h {m}m`, refresh 30s); personal progress (points, weeks contributed, sect name, next milestone hint với `requiredPoints - personalPoints`); milestone list 5 row với achieved/locked icon `✓`/`·` + progress bar % theo `personalPoints / requiredPoints` clamped 0..100 + reward summary (linhThach/tienNgoc/items/titleKey/buffKey); leaderboard top 10 row highlight `mySectId`. Out-of-season fallback (banner). KHÔNG có claim button — Phase 13.2.A read-only.
  - **API client** (`apps/web/src/api/sectSeason.ts`): `getSectSeasonCurrent()`, `getSectSeasonLeaderboard(seasonKey?)`, `getSectSeasonMe(seasonKey?)` — envelope unwrap pattern.
- **i18n vi/en parity**: namespace `sectSeason.*` (loading/outOfRange/season.{label,fallbackLabel,keyLabel,range,remaining,ended,names.s1..s13,namesDesc.s1..s13}/myProgress.{title,noData,sect,noSect,personalPoints,weeksContributed,weeksOf,nextHint}/milestone.{title,achieved,locked,required,names.{bronze..diamond},namesDesc.{bronze..diamond}}/leaderboard.{title,empty,youTag,col.{rank,sect,points,contributors,weeks}}/reward.{linhThach,tienNgoc,items,titleAward,buff}/errors.{NO_CHARACTER,SEASON_NOT_FOUND,UNKNOWN}).
- **Risk / rollback**: thấp. Phase 13.2.A **append-only**: 1 file shared catalog mới, 3 file API (controller/service/module), 2 file FE (api client + panel), 1 tab insert vào `SectWarView.vue`, i18n diff. **KHÔNG migration**, **KHÔNG schema change**, **KHÔNG đụng `SectWarService`/`SectMissionService`/`SectShopService`**. Read-only `SectWarContribution.groupBy` — không INSERT/UPDATE. Rollback = revert PR.
- **Out of scope** (theo scope user request): KHÔNG PvP realtime, KHÔNG auction, KHÔNG diplomacy, KHÔNG season reward **claim** (chỉ display preview milestone), KHÔNG Phase 13.2.B+ cross-sect tournament, KHÔNG đụng Sect War tuần / Mission / Shop hiện có.
- **Tests**: shared +44 case `sect-season.test.ts` (catalog invariant key/format/dates/durationWeeks/monotonic; helper `sectSeasonByKey`/`sectSeasonMilestoneByKey`/`currentSectSeason` boundary Monday 00:00 ICT/`sectSeasonWeekKeys` length+alignment/`sectSeasonAchievedMilestones`/`sectSeasonNextMilestone`); api +16 case `sect-season.service.test.ts` (resolveSeason key/fallback/getLeaderboard ordering+contributors+weeksContributed/getMyStatus personal+achieved+next milestone+hasSect=false fallback+NO_CHARACTER/getCurrent full+out-of-range/listSeasons); web +7 case `SectSeasonPanel.test.ts` (header+countdown render/personal progress/milestone status achieved/locked/leaderboard mySectId highlight/out-of-range fallback/error i18n/loading) + `SectWarView.test.ts` +1 case (tab=season slot mount).
- **Verification**: shared typecheck ✅ + `pnpm --filter @xuantoi/shared test` 44 PASS ✅ / api typecheck ✅ + `--run sect-season` 16 PASS ✅ + `--run sect-war` 15 PASS ✅ (zero regression) / web typecheck ✅ + `--run SectSeason SectWar` 16 PASS ✅ + `--run i18n` 8 PASS ✅ / pnpm build ✅.
- **Next roadmap**: (1) Phase 13.2.B Sect Season Reward Claim (UI + idempotent grant + audit + ledger entry); (2) Phase 13.2.C Cross-sect tournament (PvP bracket head-to-head); (3) admin season preview (force resolve / freeze leaderboard).

### Added — Phase 13.1.D Admin LiveOps Schedule Preview & Dry-run (PR #471)

- **Admin LiveOps giờ có schedule preview + dry-run** — Phase 13.1.B/C đã ship status snapshot + override toggle + sect-war recalc/snapshot + force-spawn boss; Phase 13.1.D thêm 2 endpoint admin (read-only schedule preview + simulated event/boss dry-run) và 2 panel FE để admin xem trước lịch event/boss/sect war và kiểm thử kết quả reward giả lập trước khi bật event hoặc spawn boss thật. **KHÔNG mutate**: dry-run chỉ ghi 1 audit `ADMIN_LIVEOPS_DRY_RUN`, không grant reward, không spawn `WorldBoss`, không upsert `LiveOpsEventOverride`.
- **API mới**:
  - `GET /admin/liveops/schedule-preview` (ADMIN/MOD, no audit) — trả `{ tz, nowIso, activeEvents[], upcomingEvents[], bossScheduleToday[], bossScheduleWeek[], sectWar: { season, status }, overrides[] }`. `activeEvents` overlay `LiveOpsEventOverride` (chỉ event có `effectiveEnabled=true`); `upcomingEvents` top N slot/event (≤5) trong 7 ngày kế kèm `catalogEnabled`/`effectiveEnabled`/`slotStartIso`/`slotEndIso`; `bossScheduleToday`/`bossScheduleWeek` group theo `localDate` (status `upcoming`/`active`/`completed`); `sectWar.season` = `currentSectWarSeason(now)`, `sectWar.status` = `getSectWarStatus(weekKey)`; `overrides[]` rows order `updatedAt desc`.
  - `POST /admin/liveops/dry-run` (ADMIN-only `@RequireAdmin()`, audit `ADMIN_LIVEOPS_DRY_RUN`) — body `{ kind: 'event'|'boss', key: string≤80, regionKey?: string≤80, level?: 1..99, reason?: string≤200 }`. `kind='event'` → reuse `LIVE_OPS_EVENTS` catalog + override DB row, trả `{ catalogEnabled, effectiveEnabled, override, nextSlotStartIso, nextSlotEndIso, regionKey?, bossKey?, simulated:true }`; `kind='boss'` → reuse `bossByKey` + level clamp 1..99, trả `{ simulatedMaxHp: bigint string, simulatedReward: { baseLinhThach, topDropPool[], midDropPool[], lowDropPool[] }, recommendedRealm }`. Audit `meta { kind, targetType: 'LiveOpsEvent'|'Boss', targetId, regionKey?, level?, reason: string|null }`.
- **FE Admin LiveOps tab**: 2 panel mới `AdminLiveOpsSchedulePreviewPanel.vue` (read-only, refresh button + retry on error, render active/upcoming/boss-today/boss-week/sect-war/overrides sections) + `AdminLiveOpsDryRunPanel.vue` (form 5 field kind/key/regionKey/level/reason, conditional render boss-only fields, submit gọi `adminLiveOpsDryRun()` + render result section event/boss). Wire vào `AdminView.vue` LiveOps tab dưới panel 13.1.B/C hiện có. KHÔNG đụng `AdminLiveOpsPanel.vue` 13.1.B (zero-regression Phase 13.1.B/C tests).
- **i18n vi/en parity**: namespace `adminLiveOpsPreview.*` (title/loading/refresh/retry/active/upcoming/boss/sectWar/overrides headers + empty placeholders + error codes UNAUTHORIZED/UNKNOWN) + `adminLiveOpsDryRun.*` (kind/key/region/level/reason labels + submit + result headers + error codes ADMIN_ONLY/EVENT_NOT_FOUND/BOSS_NOT_FOUND/INVALID_INPUT/KEY_REQUIRED/UNKNOWN).
- **Risk / rollback**: thấp. Phase 13.1.D **append-only**: 2 endpoint mới (KHÔNG đổi `/admin/liveops` legacy), 2 service method mới (`schedulePreview`/`dryRun`), 2 panel mới — KHÔNG migration, KHÔNG sửa runtime LiveOps/Boss/SectWar core. Rollback = revert 4 file FE mới + 2 service method + 2 controller endpoint + 1 audit action name + diff i18n vi/en + diff API.md.
- **Out of scope**: KHÔNG event CMS (drag-drop editor, schedule cron editor), KHÔNG grant reward thật trong dry-run (BE explicit `simulated:true`), KHÔNG spawn `WorldBoss` thật trong dry-run, KHÔNG đụng Phase 13.1.B `/admin/liveops` legacy hoặc Phase 13.1.C force-spawn boss / sect-war snapshot — Phase 13.1.D độc lập.
- **Tests**: api +9 case `admin-liveops.service.test.ts` (3 schedulePreview + 3 dryRun event + 3 dryRun boss với clamp/EVENT_NOT_FOUND/BOSS_NOT_FOUND/audit no-mutation verify); web +8 case (`AdminLiveOpsSchedulePreviewPanel.test.ts` 4 + `AdminLiveOpsDryRunPanel.test.ts` 4: render full preview + error retry + refresh + empty placeholders + submit event/boss + empty key reject + EVENT_NOT_FOUND error). Không đổi schema, không migration, không snapshot test.
- **Verification**: api typecheck ✅ / api `--run admin` 344 PASS ✅ / api `--run liveops` 32 PASS ✅ / web typecheck ✅ / web `--run AdminLiveOps` 18 PASS ✅ / web `--run Admin` 82 PASS ✅ / pnpm build ✅.
- **Next roadmap**: (1) Phase 13.2 Cross-sect seasonal expansion; (2) CSP production verify khi deploy (M7); (3) Admin LiveOps event CMS / drag-drop schedule editor (deferred — Phase 13.1.D chỉ preview/dry-run); (4) Phase 12.10 Story dialogue smoke + Playwright E2E.

### Added — Phase 12.9 Story Dialogue Branch Advanced (PR #470)

- **NPC giờ nhớ lựa chọn cũ + đối thoại phân nhánh nhiều bước** — Phase 12 Story Dialogue Foundation (PR #464) đã ship single-step branching với `flag_equals` / `quest_status` / `seen` / `realm_min`. Phase 12.9 nâng cấp thành multi-step branching tree: NPC nhớ choice cũ qua `Character.storyDialogueChoices` (Json map nodeId → choiceKey, last-write-wins per node) + render followup node khác nhau theo path đã đi. Player apologize khi chọn nhầm path "rival" → flag được clear → narrative revert sang "neutral". KHÔNG đụng dungeon runtime, KHÔNG cutscene lớn, KHÔNG rewrite quest system.
- **2 type mới**:
  - **Condition `choice_made { nodeId, choiceKey }`** — match khi `storyDialogueChoices[nodeId] === choiceKey`. Specificity = 5 (cùng band `quest_status`) → server pick followup node trước fallback intro. Validator two-pass verify nodeId + choiceKey ref đúng trong catalog.
  - **Effect `clear_flag { flagKey }`** — xoá entry khỏi `storyFlags` (no-op nếu chưa set). Cho plot reversal / apology arc — không động chạm flag khác. `storyDialogueAllFlagKeys()` cover cả `set_flag` + `clear_flag` để invariant validate flag set consistency.
- **Hàn Dạ multi-step tree** (4 node minh hoạ — tổng catalog Phase 12.9 thêm 3 node mới ngoài `first_meet` đã có):
  - `story_dlg_han_da_first_meet` — root. 2 choice: `rival` set `han_da_relation = rival` + mark seen; `neutral` set `han_da_relation = neutral` + mark seen.
  - `story_dlg_han_da_followup_rival` — gate `choice_made(first_meet, rival)` + `not_seen` self. 2 choice: `spar` set `han_da_spar_arranged = true` + mark seen; `decline` mark seen.
  - `story_dlg_han_da_followup_neutral` — gate `choice_made(first_meet, neutral)` + `not_seen` self. Choice friendly chat → mark seen.
  - `story_dlg_han_da_resolution_apology` — gate `seen(followup_rival)` + `flag_equals(han_da_relation, rival)` + `not_seen` self. Choice `apologize` carries `clear_flag(han_da_relation)` (revert sang neutral path) + mark seen — KHÔNG đụng `han_da_spar_arranged` để giữ lịch sử spar.
- **Prisma migration** `20260604000000_phase_12_9_story_dialogue_branch_advanced` — thêm `Character.storyDialogueChoices Json @default('{}')` (nodeId → choiceKey, last-write-wins per node). Backwards-compatible: existing players default `{}` không break flow.
- **API runtime extend** (`StoryDialogueService`):
  - `CharCtx.choices: Readonly<Record<string,string>>` thêm vào context cùng `flags` / `seen` / `questStatus`.
  - `loadCtx()` đọc `Character.storyDialogueChoices` qua helper `readJsonChoiceMap` (ignore non-string values).
  - `evaluateCondition()` handle `choice_made` (return `ctx.choices[nodeId] === choiceKey`).
  - `summarizeConditionForReason()` thêm shape `'choice_made:nodeId=key'` cho FE debug `unavailableReason`.
  - `applyChoice()` ghi `choices[node.id] = choice.key` last-write-wins TRƯỚC khi handle effects (nên `choice_made` ở node tiếp theo thấy ngay) + handle `clear_flag` (delete entry khỏi flags map) + persist `storyDialogueChoices` cùng `storyDialogueSeen` / `storyFlags`.
- **Response shape** (extend, backwards-compatible):
  - `StoryDialogueChoiceView.previouslyChosen: boolean` — `storyDialogueChoices[parentNodeId] === key`. KHÔNG disable button — chỉ hint cho FE.
  - `StoryDialogueNodeView.previousChoiceKey: string \| null` — last-pick at this node.
  - `StoryDialogueChoiceResult.choices: Readonly<Record<string,string>>` — snapshot map post-apply, để FE store sync cho `choice_made` render đúng ở node tiếp theo.
- **FE polish** (`StoryDialogueModal.vue`):
  - Thêm v-else-if branch render badge "Đã chọn lần trước" khi `c.previouslyChosen=true && c.available=true && !c.alreadyApplied`. `data-testid="story-dialogue-last-{key}"`. Amber-300 italic hint, KHÔNG disable button.
  - Hover/border màu khác (`border-amber-300/40`) khi previously chosen — visual cue nhẹ.
  - `alreadyApplied` v-else-if vẫn precedence (chain v-if > v-else-if) — KHÔNG double-render hint.
- **i18n vi/en parity**: `storyDialogue.lastChosen` (vi: "Đã chọn lần trước", en: "Picked last time").
- **Tests**: +14 case (shared +5 / api +7 / web +2):
  - **Shared** (`packages/shared/src/story-dialogues.test.ts`): `storyDialogueNodeSpecificity` rank `choice_made` same band `quest_status`; catalog ≥ 1 node per implemented effect kind (mark_seen/advance_quest_step/give_reward/set_flag/clear_flag); validator reject orphan `choice_made(nodeId, key)` ref; `storyDialogueAllFlagKeys()` cover `clear_flag`; Hàn Dạ multi-step tree round-trip resolution.
  - **API** (`apps/api/src/modules/story-dialogue/story-dialogue.service.test.ts`): pick rival → server pick `followup_rival` (specificity); pick neutral → server pick `followup_neutral`; followup_rival visibility fail INVALID_CHOICE nếu chưa pick rival; clear_flag xoá han_da_relation + persist + giữ han_da_spar_arranged; clear_flag no-op khi flag chưa set (idempotent semantic); previouslyChosen wiring true sau pick + reset seen; storyDialogueChoices last-write-wins multi-pick.
  - **Web** (`apps/web/src/components/__tests__/StoryDialogueModal.test.ts`): previouslyChosen=true render badge + giữ button enable; alreadyApplied precedence trên previouslyChosen — KHÔNG render last-chosen badge khi alreadyApplied=true.
- **Anti-feature-creep** (theo scope user request): KHÔNG rewrite quest system, KHÔNG cutscene lớn, KHÔNG dungeon runtime mới, KHÔNG PvP/pet/gacha/auction, KHÔNG Phase 13.2.
- **Risk / rollback**: low — migration thêm column với default empty `{}` (backwards-compatible), API extend response shape (FE optional field consume); rollback = revert PR + `prisma migrate resolve --rolled-back 20260604000000_phase_12_9_story_dialogue_branch_advanced`.
- **Verification**: shared typecheck ✅ + test (catalog + branching invariant) PASS / api typecheck ✅ + `--run story` PASS + `--run dialogue` PASS / web typecheck ✅ + `--run Dialogue` PASS / pnpm build ✅.
- **Next roadmap**: (1) Phase 12.10 Story dialogue smoke + Playwright E2E (Node smoke `pnpm smoke:story-dialogue` cover branching pick + previously-chosen revisit + locked reject + Playwright spec navigation); (2) mở rộng Hàn Dạ tree với give_reward gắn theo path; (3) thêm dialogue branch cho 8 placeholder kill milestone Phase 12 Foundation Late-game; (4) Phase 13.2 Cross-sect seasonal expansion.

### Added — Phase 12.8.E Story Dungeon Smoke Coverage (PR #469)

- **Story Dungeon giờ có smoke/E2E coverage end-to-end** — Phase 12.8.A/B/C/D đã ship catalog + runtime + FE + UI test coverage, nhưng chưa có smoke chạy real HTTP end-to-end. Phase 12.8.E thêm `scripts/smoke-story-dungeon.mjs` 35-step Node script chạy fetch-based vs API local cover full player flow từ register → onboard → quest gating → start → advance → clear → claim → verify quest progress + double-claim/non-owner reject + data isolation. **Test-only PR, no runtime change** — KHÔNG đụng component code, KHÔNG sửa runtime, KHÔNG migration.
- **Smoke flow covered** (35 step):
  - **Auth gates (6 step)**: GET /story/dungeons, GET /story/dungeons/:key, POST /story/dungeons/:key/start, POST /story/dungeons/:runId/advance, POST /story/dungeons/:runId/clear, POST /story/dungeons/:runId/claim → all 401 khi không cookie.
  - **Pre-onboard (1 step)**: GET /story/dungeons → 404 NO_CHARACTER.
  - **Onboard player1 (1 step)**: register + onboard với phamnhan default sect.
  - **Quest gating prep (5 step)**: GET /story/dungeons post-onboard → list với target locked, POST /story/dungeons/:key/start pre-quest → 403 DUNGEON_LOCKED, drive `phamnhan_main_01` to COMPLETED via /quests/accept + /quests/progress (talk×2 step_01/step_02) + admin login + admin /api/admin/users/:id/quest-track (kill son_thu ×3 step_03), GET /quests/me → phamnhan_main_01 COMPLETED.
  - **Story quest accept + progress (2 step)**: POST /quests/accept phamnhan_realm_01 → 200 ACCEPTED, POST /quests/progress phamnhan_realm_01 step_01 explore → 200.
  - **Start ACTIVE (3 step)**: GET /story/dungeons → target now status=available, POST /story/dungeons/story_dgn_phamnhan_back_mountain/start → 200 ACTIVE, idempotent retry → same runId.
  - **Advance + clear (5 step)**: premature clear 409 RUN_STEP_INVALID, advance×3 → currentStep=3, advance out-of-range 409 RUN_STEP_INVALID, clear → 200 CLEARED, re-clear 409 RUN_NOT_ACTIVE.
  - **Verify quest progress (1 step)**: GET /quests/me → phamnhan_realm_01 ACCEPTED step_01 progress=1 (không regression).
  - **Claim reward (3 step)**: claim → 200 granted reward (80 LT + 150 EXP + 1 linh_lo_dan), double-claim 409 RUN_ALREADY_CLAIMED, oneTime re-start 409 DUNGEON_ALREADY_CLEARED.
  - **Player2 non-owner + isolation (4 step)**: register + onboard player2 → POST /story/dungeons/:runId/advance non-owner 403 RUN_NOT_OWNED, claim non-owner 403 RUN_NOT_OWNED, GET /story/dungeons (player2) → activeRun=null target locked.
- **package.json wire**: thêm `"smoke:story-dungeon": "node scripts/smoke-story-dungeon.mjs"` vào root scripts (29 smoke total).
- **Env vars** (override default): `SMOKE_API_BASE` (default `http://localhost:3000`), `SMOKE_TIMEOUT_MS` (default 10000), `SMOKE_VERBOSE` (default off), `SMOKE_SECT_KEY` (default `thanh_van`), `SMOKE_ADMIN_EMAIL` (default `admin@example.com`), `SMOKE_ADMIN_PASSWORD` (default `change-me-bootstrap-pass`).
- **Local stack required**: `pnpm infra:up` (Postgres + Redis) + `pnpm --filter @xuantoi/api exec prisma migrate deploy` + `pnpm --filter @xuantoi/api bootstrap` (admin seed) + `pnpm --filter @xuantoi/api dev`.
- **Bugs found**: 0. Smoke 35/35 step PASS local trên main (không phát sinh fix runtime).
- **Risk / rollback**: tối thiểu — test-only PR, không đụng runtime/component code/i18n/migration. Rollback = revert `scripts/smoke-story-dungeon.mjs` + 1 line `package.json` + docs delta.
- **Out of scope**: KHÔNG rewrite Story Dungeon runtime; KHÔNG thêm story dungeon mới; KHÔNG dialogue branch nâng cao; KHÔNG Phase 13.2; KHÔNG PvP/pet/gacha/auction.
- **Verification**: api typecheck ✅ / api `--run story` 59 PASS ✅ / api `--run dungeon` 82 PASS ✅ / web typecheck ✅ / web `--run StoryDungeon` 74 PASS ✅ / web `--run Quest` 36 PASS ✅ / pnpm build ✅ / `pnpm smoke:story-dungeon` 35/35 PASS local.
- **Next roadmap**: (1) Phase 12 Story Dialogue Branch advanced (multi-step branching tree + flag effects + give_reward expansion); (2) Phase 13.2 Cross-sect seasonal expansion; (3) CSP production verify khi deploy (M7); (4) Admin LiveOps advanced controls schedule editor / event preview / dry-run mode.

### Added — Phase 12.8.D Story Dungeon UI Test Coverage (PR #468)

- **Story Dungeon FE giờ có test coverage đầy đủ §F gap** — Phase 12.8.C (PR #467 merged on main) đã ship full FE wire (4 component + Quest/Home CTA + i18n + store) nhưng chỉ có 16 store-level test trong `stores/__tests__/storyDungeon.test.ts`. Phase 12.8.D fill **§F web test coverage gap**: 4 component test file mới + extend 2 view test với CTA cases. **Test-only PR, no runtime change** — KHÔNG đụng component code, KHÔNG sửa runtime, KHÔNG migration.
- **4 component test file mới**:
  - `apps/web/src/views/__tests__/StoryDungeonView.test.ts` — **13 case**: render list + 3 status badge (locked/available/cleared) + counter, start button calls API + toast success, filter logic, activeRun panel render, claim flow (API call + reward modal + toast), advance flow, error handling (envelope `{ ok: false, error }` + unknown thrown error), empty state + loading state.
  - `apps/web/src/components/__tests__/StoryDungeonRunPanel.test.ts` — **23 case**: render title/status/progress/monster info/boss preview/killed monsters list/reward hint/realm badge, advance/clear/claim button state logic (based on status `ACTIVE`/`CLEARED`/`CLAIMED` + currentStep vs encounterSteps), disabled states based on `submittingKey`, dialogue button emits `open-dialogue` với `kind`, emit verification cho 4 button.
  - `apps/web/src/components/__tests__/StoryDungeonDialoguePanel.test.ts` — **11 case**: render khi `nodeId` set, Esc/backdrop/button close emits `close`, render NPC name + dialogue text từ `STORY_DIALOGUES` catalog, locale switching vi/en.
  - `apps/web/src/components/__tests__/StoryDungeonRewardModal.test.ts` — **11 case**: render khi `result` set, display linhThach/tienNgoc/exp/items chips conditional khi >0, close emits (button/backdrop/Esc), item fallback to raw key khi không tìm thấy item def.
- **Extend 2 view test**:
  - `apps/web/src/views/__tests__/QuestView.test.ts` **+7 case** Story Dungeon CTA: quest ACCEPTED/AVAILABLE + dungeon match → render CTA, LOCKED/CLAIMED + match → KHÔNG render, ACCEPTED + no match → KHÔNG render, `storyDungeonStore.load` fail → fail-soft (no crash, no CTA), click CTA → `router.push('/story-dungeons')`.
  - `apps/web/src/views/__tests__/HomeView.test.ts` **+8 case** Home CTA: `loaded=true` + `hasAnyAvailable=true` → render CTA + label desc available với count, `loaded=true` + `hasActiveRun=true` (no available) → render CTA + label desc active, `loaded=false` → KHÔNG render (chưa fetch), cả `hasAnyAvailable` + `hasActiveRun` = false → KHÔNG render, no character → KHÔNG render dù `loaded=true`, click CTA → `router.push('/story-dungeons')`, `storyDungeonStore.load` throw → home vẫn render bình thường (fail-soft), `onMounted` gọi `storyDungeonStore.load()` sau khi character loaded.
- **Test patterns**: Mock `@/api/storyDungeon` + `@/stores/auth/game/toast/storyDungeon` + vue-router; Pinia store integration; factory functions `buildDungeon`/`buildRun`/`buildTemplate`; Teleport-to-body via `attachTo: document.body`; i18n setup matching component keys.
- **Risk / rollback**: tối thiểu — test-only PR, không đụng runtime/component code/i18n. Rollback = revert 4 test file mới + diff QuestView.test.ts/HomeView.test.ts.
- **Out of scope**: KHÔNG dialogue branch advanced; KHÔNG dungeon mới; KHÔNG rewrite backend runtime; KHÔNG Phase 13.2; KHÔNG PvP/pet/gacha/auction/diplomacy.
- **Tests**: web full **1372** PASS ✅ (+73 case từ 4 component test mới + 7 QuestView CTA + 8 HomeView CTA, lên trên 1299 baseline post-PR-#467).
- **Verification**: shared typecheck/test 1504 PASS ✅ / web typecheck ✅ / web `--run StoryDungeon` 74 PASS ✅ / web `--run Quest` 36 PASS ✅ / web full **1372** PASS ✅ / api typecheck ✅ / api `--run story` 59 PASS ✅ / api `--run dungeon` 82 PASS ✅ / api `--run quest` 69 PASS ✅ / api full **2188** PASS ✅ / pnpm build ✅.
- **Next roadmap**: (1) Phase 12 Story Dialogue Branch advanced (multi-step branching tree + flag effects + give_reward expansion); (2) Phase 13.2 Cross-sect seasonal expansion (multi-sect tournament + cross-server leaderboard); (3) CSP production verify khi deploy (M7); (4) Admin LiveOps advanced controls schedule editor / event preview / dry-run mode.

### Added — Phase 12.8.C Story Dungeon FE + Dialogue/Reward Polish (PR #467)

- **Story Dungeon trở thành playable FE** — Phase 12.8.B chỉ có backend runtime; Phase 12.8.C wire toàn bộ FE map view + run panel + dialogue modal + reward modal + Quest/Home CTA. Player giờ có thể vào `/story-dungeons`, xem danh sách story dungeon với status `available/locked/cleared`, start/advance/clear/claim từ UI, đọc NPC dialogue trước/sau dungeon, thấy reward đã claim — KHÔNG còn phải gọi API thủ công.
- **Web API client mới** (`apps/web/src/api/storyDungeon.ts`) — 6 axios function envelope-based với `fallbackError`: `fetchStoryDungeonList`, `fetchStoryDungeon(key)`, `startStoryDungeon(key)`, `advanceStoryDungeon(runId)`, `clearStoryDungeon(runId)`, `claimStoryDungeon(runId)`. Type definitions: `StoryDungeonAvailabilityStatus`, `StoryDungeonView`, `StoryDungeonRunView`, `StoryDungeonListView`, `StoryDungeonClaimResult`. Mirror `dungeonRun.ts` pattern.
- **Pinia store** (`apps/web/src/stores/storyDungeon.ts`) — state `dungeons[]/activeRun?/loaded/loading/lastError/submittingKey/submittingError/lastClaimResult` + computed `totalCount/availableCount/lockedCount/clearedCount/hasActiveRun/isRunCleared/isRunClaimable/isRunActive/hasAnyAvailable` + actions `load()/start(templateKey)/advance()/clear()/claim()/findDungeon(key)/findDungeonForQuest(questKey)`. Server-authoritative — store chỉ mirror BE state.
- **UI Components** — `StoryDungeonView.vue` (main list view: header counters + filter all/available/locked/cleared + dungeon cards với region/realm/required quest/monsters/boss/reward hint + start/resume button + active run panel inline + dialogue/reward modal mounted on demand); `StoryDungeonRunPanel.vue` (active run với title + step progress + current monster + killed monsters list + advance/clear/claim button + loading/error states); `StoryDungeonDialoguePanel.vue` (light modal với Teleport + Esc/backdrop close — read-only NPC dialogue trước/sau dungeon, KHÔNG branching); `StoryDungeonRewardModal.vue` (reward grant display sau claim: linhThach / tienNgoc / exp / items với item name lookup).
- **Integration**: `QuestView.vue` (CTA "Vào bí cảnh cốt truyện" hiển thị khi quest đang ACCEPTED có `storyDungeonsForQuest()` available, helper `shouldShowStoryDungeonCta(q)` + `gotoStoryDungeons()` route push); `HomeView.vue` (CTA card optional khi `storyDungeonStore.hasAnyAvailable` hoặc `hasActiveRun` — mô tả số dungeon available + button "Mở bí cảnh"); `AppShell.vue` (nav link "Bí Cảnh Cốt Truyện" → `/story-dungeons`); router thêm route `/story-dungeons` lazy-load `StoryDungeonView`. Quest/Home `storyDungeonStore.load().catch(() => null)` fail-soft — request fail → silent (KHÔNG break Quest/Home view).
- **i18n vi/en parity full**: thêm `common.apiFallback.storyDungeon` ("Thao tác bí cảnh cốt truyện thất bại" / "Story dungeon action failed"), `shell.nav.storyDungeons`, `home.storyDungeon.{title,descAvailable,descActive,openBtn}`, `quest.storyDungeonCta`, và **90+ key** trong `storyDungeon.*` namespace (title/heading/loading/error/empty/filter labels/status badge/region/realm/required quest/start/advance/clear/claim button/dialogue/reward/error code mapping). KHÔNG raw key render.
- **Risk / rollback**: thấp. Phase 12.8.C chỉ FE + 2 light backend polish (controller `activeRun?: StoryDungeonRunView` enrich từ list response + service `findActiveRunForCharacter` helper) — KHÔNG sửa runtime/migration. Rollback = revert 8 file FE mới + 2 file BE polish + i18n key + nav link + route + Quest/Home CTA hooks. Không phá `DungeonRun` flow / story dungeon backend runtime.
- **Out of scope**: KHÔNG dialogue branch advanced (chỉ light modal read-only); KHÔNG cutscene/event; KHÔNG PvP/pet/gacha; KHÔNG rewrite story dungeon backend runtime; KHÔNG add new story dungeon (12.8.A catalog kept 4 entries).
- **Tests**: web full **1299** PASS ✅ (+16 case `stores/__tests__/storyDungeon.test.ts`: load happy path / load error sets lastError / start success → activeRun + reload list / start error sets submittingError / advance updates step / clear sets cleared status / claim returns lastClaimResult + clears activeRun / claim error preserves cleared run / findDungeon match / findDungeonForQuest filter available + cleared / reset() / clearLastClaimResult()). QuestView tests: 29/29 PASS (17 view + 12 store). i18n parity test PASS.
- **Verification**: shared build ✅ / web typecheck ✅ / `--run StoryDungeon` 16 PASS ✅ / `--run Quest` 29 PASS ✅ / web test full **1299** PASS ✅ / api typecheck ✅ / api `--run story` 59 PASS ✅ / pnpm build ✅.
- **Phase 12 Story Dungeon Instance Suite COMPLETED** ✅ — Phase 12.8.A (catalog + GET API) + 12.8.B (Prisma runtime + 4 mutation endpoint + quest integration) + 12.8.C (FE map view + run panel + dialogue/reward modal + Quest/Home CTA) all CLOSED.
- **Next roadmap**: (1) Phase 12 Story Dialogue Branch advanced (multi-step branching tree + flag effects + give_reward expansion); (2) Phase 13.2 Cross-sect seasonal expansion (multi-sect tournament + cross-server leaderboard); (3) CSP production verify khi deploy (M7); (4) Admin LiveOps advanced controls nếu còn thiếu (schedule editor / event preview / dry-run mode).

### Added — Phase 12.8.B Story Dungeon Runtime + Quest Integration (PR #466)

- **Story Dungeon trở thành playable runtime** — Phase 12.8.A chỉ có catalog read-only; Phase 12.8.B wire mutation pipeline server-authoritative cho start/advance/clear/claim. **Design**: chọn **Option B (new `StoryDungeonRun` model)** thay vì reuse `DungeonRun` vì story dungeon có lifecycle khác hẳn farm dungeon (one-time + auto-advance quest step + entry/clear dialogue trigger + reward differentiation `STORY_DUNGEON_REWARD`); reuse sẽ phải nhồi nhiều flag conditional vào `DungeonRun.start/claim` paths gây regression risk.
- **Prisma migration `20260603000000_phase_12_8_b_story_dungeon_runtime`**: enum `StoryDungeonRunStatus { ACTIVE, CLEARED, CLAIMED, FAILED }` + table `StoryDungeonRun` (`id` cuid + `characterId` FK cascade + `templateKey` + `status` default ACTIVE + `currentStep` Int default 0 + `killedMonsters` Json default `[]` + `startedAt`/`clearedAt?`/`claimedAt?`/`updatedAt`). 3 index: `(characterId, status)` cho list active runs / `(characterId, templateKey, status)` cho one-time guard / `(characterId, startedAt)` cho audit. Additive — KHÔNG sửa table cũ.
- **Endpoints mới**: `POST /story/dungeons/:key/start` (Zod template key snake_case → start ACTIVE run với `currentStep=0`; reject `DUNGEON_LOCKED` khi quest chưa accepted/step chưa tới hoặc realm chưa đủ; reject `DUNGEON_ALREADY_CLEARED` cho `oneTime=true` khi đã có row `CLAIMED`; idempotent: nếu đã có ACTIVE run cùng character+template → return run đó); `POST /story/dungeons/:runId/advance` (ownership check + `RUN_NOT_ACTIVE` reject CLEARED/CLAIMED/FAILED + `RUN_STEP_INVALID` reject step out-of-range; track `killedMonsters[]` Json); `POST /story/dungeons/:runId/clear` (ownership check + verify `currentStep === monsters.length` + boss optional + CAS guard `updateMany({where: {id, status: ACTIVE}, data: {status: CLEARED, clearedAt: now}})` count=0 → idempotent return existing CLEARED state; clear hook fires `applyQuestStepAdvance(characterId, template.requiredQuestKey, template.requiredQuestStep)` fail-soft); `POST /story/dungeons/:runId/claim` (ownership check + verify status=CLEARED + CAS guard `updateMany({where: {id, status: CLEARED}, data: {status: CLAIMED, claimedAt: now}})` race-safe → exactly 1 winner; reward grant atomic qua `CurrencyService.applyTx` reason `STORY_DUNGEON_REWARD` cho linhThach/tienNgoc/exp + `InventoryService.grantTx` reason `STORY_DUNGEON_REWARD` cho items theo `template.rewardHint`).
- **Quest integration**: clear hook gọi `QuestService.advanceStep(charId, questKey, stepId)` chỉ khi `QuestProgress.status === ACCEPTED` + `stepProgress[stepId] < requiredCount` — fail-soft try-catch (quest already COMPLETED hoặc CLAIMED → no-op, KHÔNG throw 500). Retry clear (CAS guard return existing) → KHÔNG double quest progress. Khi quest yêu cầu `clear:storyDungeonKey` thì step mark complete + auto-COMPLETED nếu đó là last step.
- **Anti-abuse / Race**: (1) **start idempotency** qua composite-aware lookup ACTIVE run + return existing; (2) **claim idempotency** qua CAS `updateMany status: CLEARED → CLAIMED`; (3) **concurrent claim race** 2 request cùng `runId` → exactly 1 winner (count=1) + 1 loser (count=0 throws `RUN_NOT_CLAIMABLE`); (4) **no double reward** — reward grant nằm SAU CAS guard (winner-only path); (5) **no double quest progress** vì retry clear/claim cả 2 hit existing status; (6) **locked dungeon reject** `DUNGEON_LOCKED` khi `computeStoryDungeonStatus !== 'available'`; (7) **non-owner run reject** `RUN_NOT_FOUND` khi `run.characterId !== currentCharacterId`.
- **New ledger reasons**: `STORY_DUNGEON_REWARD` thêm vào `CurrencyService.LedgerReason` union + `InventoryService.ItemLedgerReason` union — phân biệt với `DUNGEON_RUN_REWARD` (farm dungeon) cho audit clarity.
- **Risk / rollback**: thấp-trung bình. Migration additive (1 enum + 1 table + 3 index, KHÔNG sửa table cũ) → rollback = `DROP TABLE StoryDungeonRun; DROP TYPE StoryDungeonRunStatus;` (data loss chỉ active runs đang dở, KHÔNG ảnh hưởng character/quest/inventory). Endpoint mới module riêng → disable bằng cách comment 4 route. Quest integration fail-soft (try-catch) nên revert chỉ cần rollback service → quest tự không được auto-advance. Không phá `DungeonRun` flow.
- **Out of scope**: KHÔNG FE map view (Phase 12.8.C), KHÔNG dialogue branch UI lớn, KHÔNG event/cutscene, KHÔNG PvP/pet/gacha, KHÔNG rewrite `DungeonRun` system.
- **Tests** (+15 runtime cases trong `story-dungeon.service.test.ts`): list available story dungeon / locked dungeon cannot start / start success + idempotent / one-time cannot start again after clear/claim / advance step success / invalid advance reject (RUN_NOT_ACTIVE + RUN_NOT_FOUND + RUN_STEP_INVALID) / clear success + invalid clear / clear updates quest progress (full + partial) / claim reward success / double claim reject (no double reward verified via ledger sum) / concurrent claim race only one success (Promise.all 2x) / non-owner cannot advance/clear/claim run / retry clear does not double quest progress / fail-soft quest service throw không phá clear flow.
- **Verification**: shared typecheck ✅ + test 1504 PASS ✅ / api typecheck ✅ + `--run story` 59 PASS ✅ / `--run dungeon` 82 PASS ✅ / `--run quest` 69 PASS ✅ / api test full **2188** PASS ✅ / pnpm build ✅.
- **Next**: Phase 12.8.C Story Dungeon FE + Dialogue/Reward Polish — FE map view consume `/story/dungeons` + `/story/dungeons/:key/start` + advance/clear/claim flow + reward modal + entry/clear dialogue trigger; touch-up i18n.

### Added — Phase 12.8.A Story Dungeon Catalog + API Foundation (PR #465)

- **Story Dungeon Instance riêng cho main quest** — tách khỏi dungeon farm chung (`combat.ts:DUNGEONS` / `dungeon-run` runtime). Thêm shared catalog `STORY_DUNGEONS` (`packages/shared/src/story-dungeons.ts`) với type `StoryDungeonTemplateDef` (key + i18n title/desc + `requiredQuestKey` + `requiredQuestStep?` + `regionKey: RegionKey` + `recommendedRealm` + `minRealmKey?` + `monsterKeys[]` + `bossKey?` + `entryDialogueKey?` + `clearDialogueKey?` + `rewardHint?` + `oneTime` + `enabled`) + `StoryDungeonRewardHint` (linhThach / tienNgoc / exp / items[]). 4 catalog seed gắn 4 main quest đầu tiên: Phàm Nhân Hậu Sơn Linh Tuyền Động (`phamnhan_realm_01:step_01` — son_coc), Luyện Khí Hắc Lâm Tâm Thử (`luyenkhi_main_01:step_02` — hac_lam, minRealm=luyenkhi), Trúc Cơ Mộc Huyền Lâm Ký Ức Cổ Thụ (`truc_co_main_01:step_03` — moc_huyen_lam, minRealm=truc_co), Kim Đan Kim Sơn Thiên Lò Lệnh (`kim_dan_main_01:step_02` — kim_son_mach, minRealm=kim_dan). Reuse 14 monster + 4 region + 4 dialogue node hiện có → zero orphan.
- **Helpers pure**: `storyDungeonByKey()`, `storyDungeonsForQuest()`, `computeStoryDungeonStatus(template, input)` returns `'locked'/'available'/'cleared'`, `availableStoryDungeonsForQuestState()`. Invariant validator `validateStoryDungeonCatalog()` check key uniqueness + snake_case + quest/step resolve qua `QUESTS` + region resolve qua `RegionKey` union + realm resolve qua `realmByKey` + monster/boss resolve qua catalog + dialogue resolve qua `STORY_DIALOGUES` + reward hint integer ≥ 0.
- **Endpoints mới**: `GET /story/dungeons` (list catalog `enabled=true` + status compute từ `Character.realmKey` + `QuestProgress.stepProgress`); `GET /story/dungeons/:key` (single template view). Response shape `StoryDungeonView { key, title*, description*, requiredQuestKey, requiredQuestStep, regionKey, recommendedRealm, minRealmKey, monsters[{ key, name, element, level }], boss?, rewardHint?, oneTime, status }`. Read-only — KHÔNG mutation, KHÔNG `RewardLedger` (Phase 12.8.B sẽ wire runtime).
- **Module riêng** `StoryDungeonModule` (`apps/api/src/modules/story-dungeon/`) — chỉ depend `AuthModule` + `PrismaService`. KHÔNG re-enter `QuestService` / `DungeonRunService` / `CurrencyService` (đọc thuần `Character` + `QuestProgress`). Register cuối cùng trong `app.module.ts` cùng nhóm story.
- **Server-authoritative**: status compute thuần dựa trên `QuestProgress.status` + `stepProgress` JSON + `realmByKey(char.realmKey).order` — FE chỉ render. `enabled=false` filter trước → admin toggle catalog không cần migration.
- **Risk / rollback**: zero — KHÔNG Prisma migration, KHÔNG mutation endpoint, KHÔNG ảnh hưởng `dungeon-run` runtime hiện có. Revert = xoá `packages/shared/src/story-dungeons.ts` + `apps/api/src/modules/story-dungeon/` + 1 dòng `app.module.ts` + 1 dòng `index.ts`. Nếu Phase 12.8.B chưa wire runtime, FE vẫn đọc được catalog cho UI map view (status sai sẽ chỉ gây render visual — KHÔNG ảnh hưởng economy).
- **Out of scope**: KHÔNG full `StoryDungeonRun` Prisma + start/advance/claim runtime, KHÔNG reward grant qua `RewardLedger`, KHÔNG FE map view, KHÔNG dialogue branch lớn, KHÔNG PvP/pet/gacha/auction, KHÔNG rewrite `DungeonRun` system. Phase 12.8.B sẽ wire `StoryDungeonRun` model + 4 endpoint runtime + reward atomic + auto-advance quest step khi clear.
- **Tests** (+36): shared **+25** (`story-dungeons.test.ts`: catalog ≥ 4 entries / key unique snake_case / `storyDungeonByKey` resolve / titleVi+descriptionVi non-empty + i18n key prefix / requiredQuestKey ∈ QUESTS / requiredQuestStep ∈ QuestDef.steps / regionKey ∈ RegionKey union / recommendedRealm + minRealmKey resolve qua realmByKey / monsterKeys không rỗng + zero orphan / bossKey resolve + region match / dialogue keys ∈ STORY_DIALOGUES / rewardHint integer ≥ 0 + qty > 0 / oneTime + enabled boolean / quest coverage ≥ 3 / `validateStoryDungeonCatalog` returns `[]` / `storyDungeonsForQuest` filter / `computeStoryDungeonStatus` x6 (locked / available / step-progress-short locked / COMPLETED → available / CLAIMED → cleared / minRealm gate locked) / `availableStoryDungeonsForQuestState` empty + cleared+available filter); api **+11** (`story-dungeon.service.test.ts`: NO_CHARACTER / Phàm Nhân baseline mọi entry locked / quest accepted + step done → available / quest accepted + step short → locked / quest CLAIMED → cleared / quest COMPLETED → available / Phàm Nhân không đủ minRealm Kim Đan → locked dù quest accepted / view shape monster+boss+rewardHint hydrated / `getByKey` template + status / `getByKey` DUNGEON_NOT_FOUND / `getByKey` reflects mutation between calls).
- **Verification**: shared typecheck ✅ + `pnpm --filter @xuantoi/shared test -- --run story-dungeons` 25 PASS ✅ / api typecheck ✅ + `pnpm --filter @xuantoi/api test -- --run story` 38 PASS ✅ / `pnpm --filter @xuantoi/api test -- --run dungeon` (cần verify) / pnpm build (cần verify trước khi PR).
- **Next**: Phase 12.8.B Story Dungeon Runtime + Quest Integration — Prisma `StoryDungeonRun` model + 4 endpoint (`POST /story/dungeons/:key/start` / `POST /story/dungeon-runs/:runId/next` / `POST /story/dungeon-runs/:runId/claim` / `POST /story/dungeon-runs/:runId/abandon`) + reward grant atomic qua `CurrencyService.applyTx` reason `STORY_DUNGEON_REWARD` + `InventoryService.grantTx` + auto-advance quest step khi clear (`QuestService.track` cho `kill+monster` step) + entry/clear dialogue trigger.

### Added — Phase 12 Story Dialogue Foundation (PR #464)

- **Branching NPC dialogue cho main quest** — story giờ không còn chỉ là quest kill/claim. Thêm shared catalog `STORY_DIALOGUES` (`packages/shared/src/story-dialogues.ts`) với type `DialogueNodeDef` + `DialogueChoiceDef` + 4 condition kind (`quest_status` / `flag` / `seen_node` / `realm_min`) + 4 effect kind (`mark_seen` / `set_flag` / `give_reward` / `advance_quest_step`). Helpers `findStoryDialogueNode` / `getStoryDialogueRoot` / `evaluateChoiceConditions` resolve server-authoritative.
- **Endpoints mới**: `GET /story/dialogue/:npcKey` (filter conditions theo character ctx → `StoryDialogueNodeView` với choices kèm `available` / `unavailableReason`); `POST /story/dialogue/:npcKey/choice` (Zod `{nodeId, choiceKey}`, atomic `prisma.$transaction` apply effects: mark_seen → set_flag → give_reward qua `CurrencyService.applyTx` reason `STORY_DIALOGUE_CHOICE` (composite UNIQUE `(characterId, refType, refId)` chống double-grant) → advance_quest_step qua `QuestService.track` chỉ khi quest ACCEPTED + step matches).
- **Prisma migration `20260602000000_phase_12_story_dialogue_foundation`**: thêm 2 cột Json trên `Character`: `storyDialogueSeen` (default `[]`) + `storyFlags` (default `{}`). Server-only state; FE refetch qua `GET /character/state`.
- **FE**: `apps/web/src/api/storyDialogue.ts` (axios client) + `stores/storyDialogue.ts` (Pinia open / pickChoice / close + navigate `nextNode`) + `components/StoryDialogueModal.vue` (Teleport modal song song với `NpcDialogueModal.vue` quick-accept; render text + choices + disabled state với `alreadyApplied` / `unavailableReason` hint + reward toast + Esc/backdrop close). Integrate `NpcView.vue` parallel với existing quick-accept flow — KHÔNG rewrite legacy dialogue UI.
- **i18n vi/en parity** (`storyDialogue.{title, talk, alreadyChosen, locked, empty, linhThach, tienNgoc, errors.*}` mapped tới error code server).
- **Server-authoritative**: FE chỉ render. Conditions / effects evaluate server-side; client KHÔNG bypass. Reward grant idempotent qua composite UNIQUE — race-safe (P2002 → return existing ledger entry).
- **Anti-abuse**: `give_reward` capped catalog-only; `advance_quest_step` chỉ chạy nếu quest ACCEPTED + step matches (không skip locked step). Catalog invariant test ngăn drift `nextNodeId` reference / orphan node / duplicate `(npcKey, nodeId)`.
- **Risk / rollback**: thấp — Prisma migration thêm 2 cột Json default-value (additive, không phá row hiện có). Endpoint mới module riêng `StoryDialogueModule` register sau cùng trong `app.module.ts` — disable bằng cách remove import. FE modal là parallel component với existing `NpcDialogueModal.vue`; revert = xoá file diff. Reward grant qua existing `CurrencyService.applyTx` (Phase 11 ledger), không thêm reason value mới conflict.
- **Out of scope**: KHÔNG full story dungeon instance, KHÔNG cutscene lớn, KHÔNG rewrite quest system, KHÔNG PvP/pet/gacha. Catalog seed ban đầu chỉ 5 dialogue node cho 3 NPC chính (Lăng Vân Sinh phamnhan + Mộc Thanh Y luyenkhi + Huyết La Sát kim_dan); mở rộng tách ra PR sau.
- **Tests** (+33): shared +5 (catalog invariant + helper resolve + 4 condition kind), api +16 (story-dialogue.service: GET success / locked / missing-NPC, POST mark_seen / set_flag / give_reward idempotent + double-claim guard / advance_quest_step success + QUEST_STEP_LOCKED / CHOICE_LOCKED / CHOICE_ALREADY_APPLIED / NODE_NOT_FOUND / atomic rollback), web +12 (StoryDialogueModal render / choice disable / pickChoice click / error i18n / Esc close / loading + store open/pickChoice/close).
- **Verification**: shared typecheck ✅ + test ✅ / api typecheck ✅ + test ✅ / web typecheck ✅ + `pnpm --filter @xuantoi/web test -- --run StoryDialogue` 12 PASS ✅ / `pnpm build` ✅.

### Added — Admin LiveOps Advanced Controls (PR #463)

- **Mở rộng admin tooling sau Phase 13.1.B**: nâng `BossService.adminSpawn()` thành dual-audit (legacy `BOSS_SPAWN` + Phase 13.1.C `ADMIN_FORCE_BOSS_SCHEDULE`) ghi cùng `meta {bossKey, regionKey, level, bossId}` + `reason?` (trim, ≤200 chars; whitespace-only → `null`); thêm `AdminLiveOpsService.snapshotSectWarStatus(actorId, weekKey, reason?)` read-after-audit (gọi `getSectWarStatus(weekKey)` rồi ghi 1 audit `ADMIN_SECT_WAR_STATUS` với `meta {targetType:'SectWarWeek', targetId:weekKey, summary:{totalSects,totalContributors,totalContributions,topSectIds:string[≤3]}, reason}` — **KHÔNG mutate** contribution rows).
- **Endpoints mới / mở rộng**: `POST /admin/sect-war/snapshot` (Zod `{weekKey?:'YYYY-Www', reason?:string≤200}` → fallback computed week nếu thiếu; non-admin reject qua `AdminGuard`); `POST /boss/admin/spawn` body mở rộng `{ bossKey?, regionKey?, level? (1..3), reason? (≤200) }` — service vẫn return `regionKey` trong result + audit cả 2 row.
- **FE Admin panel** (`apps/web/src/components/AdminLiveOpsPanel.vue`): thêm section "Force Boss Spawn" (region select dựa trên `LIVE_OPS_EVENTS[].regionKey` distinct + bossKey/level/force/reason form) gọi `adminSpawnBoss()`; thêm button "Snapshot week" gọi `adminSectWarSnapshot()` refresh sectWar view + toast success/error; i18n vi/en parity (`adminLiveOps.boss.*` + `adminLiveOps.sectWar.snapshotBtn`). Error mapping: `BOSS_ALREADY_ACTIVE` → toast i18n; `BOSS_DEFINITION_NOT_FOUND` → toast i18n; missing region → client-side guard (KHÔNG fan-out request).
- **Audit log entries (Phase 13.1.C confirmed)**: `ADMIN_LIVEOPS_OVERRIDE` (toggle event, từ Phase 13.1.B), `ADMIN_FORCE_BOSS_SCHEDULE` (force-spawn boss, dual với `BOSS_SPAWN`), `ADMIN_SECT_WAR_STATUS` (snapshot read-after-audit). Mọi audit có `actorUserId`, `meta`, `reason?` (trim), backwards-compatible với existing `BOSS_SPAWN` consumers.
- **Risk / rollback**: thấp — KHÔNG Prisma migration mới (reuse `AdminAuditLog` + `LiveOpsEventOverride`). KHÔNG sửa contribution rows hoặc claim rows. Revert = drop file diff (boss.service `adminSpawn` legacy 1-row audit, admin-liveops.service xoá `snapshotSectWarStatus`, admin.controller xoá `sectWarSnapshot` route, FE panel revert). Audit consumers đọc cả `BOSS_SPAWN` lẫn `ADMIN_FORCE_BOSS_SCHEDULE` → tương thích với data history.
- **Tests** (+27): api `boss.service.region.test.ts` +3 (dual audit ADMIN_FORCE_BOSS_SCHEDULE meta + reason / no reason → null / whitespace → null), `admin-liveops.service.test.ts` +4 (empty week snapshot / data summary topSectIds order / 2-snapshot separate audit / whitespace reason → null), `admin.controller.test.ts` +4 (snapshot route 200 / weekKey fallback / weekKey invalid format → 400 / reason >200 → 400), web `AdminLiveOpsPanel.test.ts` +6 (region select render / spawn submit / region missing guard / spawn API error mapping / snapshot click refresh / snapshot API error). Test baseline: api **2140** (+6 từ Phase 13.1.C dual-audit + snapshot service + controller route từ trước cộng 23 case), web **1271** (+6).
- **Verification**: shared typecheck ✅ / api typecheck ✅ / web typecheck ✅ / `pnpm --filter @xuantoi/api test -- --run admin-liveops` 14 PASS ✅ / `pnpm --filter @xuantoi/api test -- --run boss.service.region` 11 PASS ✅ / `pnpm --filter @xuantoi/api test -- --run admin.controller` 101 PASS ✅ / `pnpm --filter @xuantoi/web test -- --run AdminLiveOpsPanel` 10 PASS ✅ / api test full **2140** ✅ / pnpm build ✅.

### Internal — Daily-login extended coverage (PR #462)

- **Mở rộng `daily-login` test sau PR #460**: `apps/api/src/modules/daily-login/daily-login.extended.test.ts` (+6 vitest) lock thêm 3 nhóm scenario quan trọng:
  1. **Streak 30 ngày liên tục** → streak monotonic 1→30, balance += 3000 LT, 30 row `CurrencyLedger` reason `DAILY_LOGIN`, 30 row `DailyLoginClaim` với `streakAtClaim` đồng nhất. Locks catalog flat 100 LT/ngày — nếu tương lai catalog escalate (vd ngày 7/14/21/30 bonus) thì test failed có chủ đích để buộc chỉnh sync test+docs cùng PR đó.
  2. **Race-condition `Promise.all`**: 5 claim concurrent cùng `(userId, now)` → đúng 1 winner +100 LT, 4 loser idempotent (`claimed=false`, `linhThachDelta='0'`, balance KHÔNG cộng 2 lần). Cover composite UNIQUE `(characterId, claimDateLocal)` + P2002 fallback path. Thêm 10 claim trên 2 ngày liên tiếp (5+5 race) → 2 winner, streak monotonic 1→2 sau race.
  3. **Controller-level DB-backed smoke** qua `DailyLoginController.me()`/`.claim()` với `AuthService` stub (KHÔNG đụng JWT/Redis): flow 4 step (status pre-claim → claim → status post-claim → reclaim idempotent) verify envelope `{ ok:true, data }` + state DB đồng nhất. Bonus: 401 khi không cookie, 404 mapping cho user không có character.
- **Risk / rollback**: zero — pure test file, KHÔNG sửa service / controller / endpoint / Prisma schema. Revert = xoá file. Không ảnh hưởng test baseline khác. Chạy được trên local (PG up) + GitHub CI (PG service container).
- **Verification**: api typecheck ✅ / `pnpm --filter @xuantoi/api test -- --run daily-login` 34 PASS ✅ / `pnpm --filter @xuantoi/api test -- --run daily` 34 PASS ✅ / api test full **2129** (+6) ✅ / pnpm build ✅.

### Internal — Daily-login multi-day smoke positive (PR #460)

- **Multi-day integration test** `apps/api/src/modules/daily-login/daily-login.multi-day.test.ts` (5 case, +5 vitest) cho `DailyLoginService.claim(userId, now)` qua test-clock injection — service signature đã hỗ trợ `now: Date` param từ Phase 11 nên KHÔNG mở endpoint dev mới. Cover:
  1. Chuỗi 7 ngày liên tục → streak monotonic 1→7, +700 LT, 7 row `CurrencyLedger` reason `DAILY_LOGIN`, 7 row `DailyLoginClaim` với `claimDateLocal` monotonic +1.
  2. Reward ngày 7 = `DAILY_LOGIN_LINH_THACH` flat catalog (100 LT/ngày, không escalate — closed beta lock).
  3. Double-claim cùng ngày giữa chuỗi 7 ngày → idempotent (`claimed=false`, `linhThachDelta='0'`, streak preserved, không cộng tiền 2 lần).
  4. Missed day giữa chuỗi → streak reset về 1 ở ngày sau (anti free-streak), tổng LT đúng theo số ngày thực claim.
  5. Timezone boundary VN ICT: 16:30 UTC vs 17:30 UTC = khác local date (cross VN midnight 17:00 UTC); và cùng ngày VN nhưng 22h UTC sau → idempotent (anti tz-shift double-claim).
- **Risk / rollback**: zero — pure test file, KHÔNG sửa service / controller / endpoint / Prisma schema. Revert = xoá file. Không ảnh hưởng test baseline khác.
- **Verification**: api typecheck ✅ / api test full **2123** (+5) ✅ / pnpm build ✅. Pre-existing flaky `chat.service.test.ts` rate-limit pass on retry, không liên quan.

### Added — Phase 13.1.B Sect Missions, Sect Shop & Admin LiveOps Controls (PR #459)

- **Sect Mission system** — daily/weekly mission Tông Môn cộng `congHien` (= `Character.contribBalance`). 5 entry catalog: 3 DAILY (`sect_daily_dungeon_3` +30, `sect_daily_boss_participate` +40, `sect_daily_boss_damage` +35) + 2 WEEKLY (`sect_weekly_quest_5` +150 contrib +500 LT, `sect_weekly_breakthrough_1` +200 contrib +800 LT). Active player ~1085 contribution/tuần. Reset DAILY 00:00 ICT, WEEKLY ISO week (Mon 00:00 → Sun 23:59 ICT), reuse `MISSION_RESET_TZ`.
- **Sect Shop** — spend `congHien` đổi 5 entry: huyết chỉ đan (50/lần, 5/ngày), thanh lam đan (250/lần, 3/ngày), cổ thiên đan (200/lần, 3/tuần), huyết tinh (80/lần, 10/tuần), thần đan (5000/lần, 1/tuần). Daily/weekly limit aggregate qua `SectShopPurchase.qty` window, max spend ~13,800 contrib/tuần.
- **API mới** (8 endpoints): `GET /sect/missions`, `POST /sect/missions/:key/claim`, `GET /sect/shop`, `POST /sect/shop/buy`, `GET /admin/liveops`, `POST /admin/liveops/event/toggle`, `GET /admin/sect-war/status`, `POST /admin/sect-war/recalculate`.
- **Race-safety / atomicity**: claim mission idempotent qua composite UNIQUE `(characterId, missionKey, periodKey)` (P2002 → `MISSION_ALREADY_CLAIMED`). Buy shop entry atomic CAS `Character.updateMany({ where: { id, contribBalance: { gte: cost*qty } } })` — count=0 → reject `INSUFFICIENT_CONTRIB` không trừ tiền không grant item. Toàn bộ side-effect (decrement balance + ledger + InventoryService.grantTx + SectShopPurchase row + reward currency) chạy trong cùng `prisma.$transaction` → rollback toàn bộ nếu fail giữa chừng. Rate limit 30 req/60s per user (Redis primary + in-memory fallback) → `RATE_LIMITED` 429 ngoài transaction.
- **Admin LiveOps controls** — `/admin/liveops` (status snapshot, override status), `/admin/liveops/event/toggle` (upsert `LiveOpsEventOverride` + audit `ADMIN_LIVEOPS_OVERRIDE`), `/admin/sect-war/status` (read-only diagnostic), `/admin/sect-war/recalculate` (no-op audit, future-proof). Mọi endpoint `AdminGuard` (role=ADMIN).
- **Web UI** — `SectWarView` mở rộng thành tab system 5 tab (overview / leaderboard / missions / shop / rewards) qua `useRoute().query.tab`. Mới: `SectMissionPanel.vue` (mission list + progress + claim), `SectShopPanel.vue` (shop catalog + balance + buy + limit badge), `AdminLiveOpsPanel.vue` (event toggle + audit). Home/Sect/Admin integration + i18n vi/en đầy đủ.
- **Prisma migration `20260601000000_phase_13_1_b_sect_missions_shop_liveops`**: 3 table mới `SectMissionClaim` (composite UNIQUE `(characterId, missionKey, periodKey)`), `SectShopPurchase` (per-buy audit, dùng cho daily/weekly limit aggregate), `LiveOpsEventOverride` (admin override flag). 2 cột mới trên `Character`: `contribBalance` (Int default 0, ≥ 0 invariant qua CAS) + `contribLifetime` (Int default 0, audit-only). 2 enum mới: `CurrencyLedgerReason.SECT_MISSION_CLAIM`, `ItemLedgerReason.SECT_SHOP_BUY`. 1 audit action mới `ADMIN_LIVEOPS_OVERRIDE`. **Rollback risk**: thấp — drop 3 table + 2 cột không ảnh hưởng module khác. Ledger entry với reason mới sẽ ở lại nhưng không gây side-effect.
- **Anti-abuse**: mission claim idempotent + cap derive từ contribution rows server-side, shop daily/weekly limit, NON_STACKABLE guard, item grant rollback (InventoryService fail → tx rollback → contribBalance không trừ), rate limit, `SECT_REQUIRED` guard mọi endpoint sect-side.
- **Tests** (+56 mới): api `sect-shop.service.test.ts` 12 cases (buy success/insufficient/daily-limit/weekly-limit/NON_STACKABLE/RATE_LIMITED/concurrent CAS/grant rollback/ledger), `admin-liveops.service.test.ts` 10 cases (status/toggle/audit/sect-war status/recalc/non-admin reject), web `SectMissionPanel.test.ts` 5, `SectShopPanel.test.ts` 7, `AdminLiveOpsPanel.test.ts` 4, fix `SectWarView.test.ts` 8 (tab system migration). Test baseline: shared 1463, api 2118, web 1265.

### Fixed — Post Phase 13.1.A Sect War hardening audit (PR #458)

- **`SectWarService.addContributionTx` daily cap drift +7h**: query daily-cap window dùng `setUTCHours(0,0,0,0)` (= 07:00 ICT) thay vì `startOfLocalDay(now, MISSION_RESET_TZ)` (= 00:00 ICT). Hệ quả: cap reset không đồng nhất với dungeon dailyLimit / mission DAILY / daily-login streak. Trên closed beta `Asia/Ho_Chi_Minh`, player có thể lách `dungeon_clear` cap 50/ngày bằng cách clear trước 07:00 ICT — rows hôm trước @ 23:00 ICT (= 16:00 UTC) vẫn cùng ISO week (weekKey filter pass) nhưng bị nhóm sai vào "hôm nay" theo cửa sổ UTC. **Fix**: import `startOfLocalDay` từ `combat.service` + `getMissionResetTz` từ `mission.service`, dùng cùng pattern với các module daily/weekly khác. **+1 regression test** `sect-war.service.test.ts` reproduce: pre-insert 5 dungeon_clear contributions @ Mon 23:00 ICT (cap exact), call addContributionTx với now=Tue 01:00 ICT (cùng ISO week 20) — pre-fix cap hit reject; post-fix cap reset accept.
- **`docs/API.md` composite UNIQUE order**: ghi sai `(weekKey, sourceType, sourceId, characterId)` (thiếu `activityKey`). Fix: `(weekKey, characterId, activityKey, sourceType, sourceId)` match Prisma schema. Cập nhật doc cũng thêm note daily cap window theo `MISSION_RESET_TZ`.

### Added — Phase 13.1.A Sect War Core, Contribution, Leaderboard & Weekly Reward (PR #457)

- **Tông Môn Chiến tuần lễ** — bảng xếp hạng tông môn theo tuần (`weekKey = ISO 'YYYY-Www'`, timezone `Asia/Ho_Chi_Minh`, season chạy Thứ Hai 00:00 → Chủ Nhật 23:59 ICT).
- **5 nguồn điểm gameplay** (server-authoritative, idempotent qua `(weekKey, characterId, activityKey, sourceType, sourceId)` UNIQUE):
  - Daily login claim → +5 điểm/ngày (cap 7/tuần).
  - Dungeon clear (claim DungeonRun) → +10 điểm/lần (cap 50/ngày).
  - Boss participation (≥1 đòn đánh, distributeRewards) → +15 điểm (cap 120/tuần).
  - Boss top damage rank-1 → +25 bonus (cap 100/tuần).
  - Quest claim → +8 điểm (cap 80/tuần).
- **Reward tier tuần** (claim qua `POST /sect-war/claim`, `(weekKey, characterId)` UNIQUE chống double claim):
  - Rank 1 → 5,000 LT + 200 TN + title `sect_war_champion`.
  - Rank 2-3 → 2,500 LT + 100 TN.
  - Rank 4-10 → 1,000 LT + 50 TN.
  - Participation (cá nhân ≥ 50 điểm, không cần rank) → 200 LT.
- **API mới**: `GET /sect-war/current` (snapshot tuần), `GET /sect-war/leaderboard` (top sect), `GET /sect-war/me` (status cá nhân + breakdown), `POST /sect-war/claim` (atomic CAS qua composite UNIQUE — race-safe, 1 claim duy nhất khi 2 request concurrent).
- **Hook gameplay** (defensive try-catch trong tx — title/buff fail KHÔNG rollback economy reward chính): DungeonRunService.claim, BossService.distributeRewards (participation + topDamage), DailyLoginService.claim, QuestService.claim. Character không có sect → no-op (return null, không ghi row).
- **Web UI** `/sect-war` — countdown tuần, my progress + breakdown, leaderboard top sect (highlight tông của tôi), bảng activity rules + reward tier, claim button gating (`canClaim` = hasSect + eligibleTier + !alreadyClaimed). HomeView LiveOps panel thêm CTA "Tông Môn Chiến". i18n vi/en đầy đủ.
- **Prisma migration `20260524000000_phase_13_1_a_sect_war_core`**: `SectWarContribution` + `SectWarWeeklyRewardClaim` table mới với composite UNIQUE chống double-add và double-claim. Rollback risk: thấp — drop 2 table không ảnh hưởng module khác.
- **Anti-abuse**: dailyCap/weeklyCap enforce trong service (KHÔNG thể bypass qua FE), contribution KHÔNG thể tự thêm (mọi nguồn đi qua hook server-side), claim chống race qua composite UNIQUE + transaction.

### Fixed — Phase 13.0 audit pass #4: TitleService + BuffService P2002 race (PR #455)

- **`TitleService.unlockTitleTx()` race**: pattern `findUnique → if not exists → create` KHÔNG atomic. 2 boss reward hook concurrent cùng `(characterId, titleKey)` (vd participant tham gia 2 boss defeat sát nhau, hoặc 2 cluster pod chạy heartbeat song song) → cả 2 thấy không tồn tại → cả 2 gọi `tx.characterTitleUnlock.create` → race loser hits Prisma `P2002` (unique constraint) → Postgres aborts entire `$transaction`. Boss reward hook có `try/catch` swallow log warn nhưng tx outer đã aborted → **subsequent currency + inventory grant cũng fail** (tx rollback) → **player mất reward kinh tế**. **Fix**: refactor sang `tx.characterTitleUnlock.createMany({ data: [...], skipDuplicates: true })` — Prisma dịch sang Postgres `INSERT … ON CONFLICT DO NOTHING`, đúng atomic, không bao giờ throw P2002. (Prisma's `upsert` KHÔNG atomic — nó là find-then-update/create — đã thử và fail race test.)
- **`BuffService.applyBuffTx()` race**: cùng pattern. Concurrent top-1 boss reward → race loser P2002 → boss reward tx aborted → mất reward. **Fix**: `createMany skipDuplicates` cho insert path (atomic), nếu count=0 (existing row) thì UPDATE với newStacks computed pre-call. Stacks count race window vẫn tồn tại nhưng nhỏ + không phá tx outer (UPDATE không throw P2002). Non-stackable buff không bị ảnh hưởng (newStacks = existing.stacks).
- **2 regression test mới** (`title.service.test.ts`, `buff.service.test.ts`): `Promise.all` 2 wrapper concurrent cùng key — pre-fix throw P2002, post-fix cả 2 commit + chỉ 1 row composite UNIQUE. Cover boss reward hook race scenario.

### Fixed — Phase 13.0 audit pass #3: i18n key catalog mismatch + BALANCE schedule stale

- **i18n vi/en bị lệch catalog event keys** (`liveops.event.*`): catalog có 4 key (`daily_exp_rush_morning` 07:00 60min, `daily_dungeon_rush_evening` 20:00 60min, `weekly_sect_aura_sunday` Chủ Nhật 06:00 720min, `limited_lunar_new_year_2027` Feb 2027 7-day disabled) nhưng i18n chỉ có 2 orphan key (`event_daily_exp_rush`, `event_weekly_dungeon_double_drop`) còn lại từ phiên bản trước của Phase 13.0. **Hệ quả**: khi 1 trong 4 event này active (vd 07:00-08:00 ICT exp rush), `LiveOpsTodayPanel` render `liveops.event.daily_exp_rush_morning.title` literal thay vì "Triêu Quang Lộ Khí". **Fix**: thêm 4 entry mới + xoá 2 orphan trong vi.json/en.json, viết lại nội dung match catalog dailyTime/durationMinutes; thêm 2 parity test trong `apps/web/src/i18n/__tests__/parity.test.ts` walk `LIVE_OPS_EVENTS` assert `titleI18nKey` + `descriptionI18nKey` tồn tại trong cả vi và en (regression guard cho mọi catalog rename tương lai).
- **`docs/BALANCE_MODEL.md` §6.4 schedule table stale**: 2 row buff event ghi sai key cũ + sai dailyTime/durationMinutes (`event_daily_exp_rush 18:00 180min`, `event_weekly_dungeon_double_drop 00:00 1440min`). **Fix**: viết lại 4 row đúng với catalog hiện tại (3 daily 60min + 1 weekly Sunday 720min + 1 LIMITED disabled). Schedule reasoning rationale giữ nguyên (không phá economy).
- **Test fixture `LiveOpsTodayPanel.test.ts`**: `event_daily_exp_rush` key trong fixture cũng được chuẩn hoá sang `daily_exp_rush_morning` cho consistency với catalog (test logic không đổi).

### Added — Phase 13.0 LiveOps & Retention Suite (PR #452)

- **LiveOps Event Calendar (shared)**: catalog mới `LIVE_OPS_EVENTS` định nghĩa 5 sự kiện scheduled: 3 boss daily (12:00 / 19:00 / 22:00 ICT) + 1 boss tuần Huyết Nguyệt (Thứ Bảy 21:00 ICT) + 2 buff event (`event_daily_exp_rush` 18:00-21:00, `event_weekly_dungeon_double_drop` Chủ Nhật cả ngày). Helpers `liveOpsEventsForToday()`, `activeLiveOpsEvents()`, `nextLiveOpsEvent()`, `bossScheduleForToday()`, `liveOpsEventForBossSpawn()` deterministic, timezone mặc định `Asia/Ho_Chi_Minh` reuse `MISSION_RESET_TZ`.
- **Scheduled Boss Spawn**: `BossService.tickHeartbeat()` mở rộng đọc schedule, mỗi region check active slot. Spawn nếu slot active + region không có ACTIVE boss + chưa spawn `(regionKey, bossKey, spawnedAt >= slotStart)` (slot dedup query-based, idempotent qua parallel heartbeat). Cuối tuần Thứ Bảy 21:00 → Cửu La Thiên Đế xuất thế ở Cửu La Điện. Giữ nguyên adminSpawn + boss-by-region unique guard + attack/reward.
- **Reward Hooks (Title + Buff)**: khi boss bị hạ và distribute reward — mọi participant unlock title `achievement_first_boss` (idempotent), top-1 damage rank apply buff `event_double_drop` (1h), nếu boss spawn từ slot Huyết Nguyệt → mọi participant unlock title mới `event_huyet_nguyet_2026` (epic, +3% atk flavor stat). Tx-safe defensive try-catch — nếu title/buff fail, gameplay reward (linh thạch/item) vẫn rollback đúng.
- **`/liveops/today` API**: endpoint pure compute (no auth) trả retention dashboard snapshot — `nowIso`, `timezone`, `todayEvents`, `activeEvents`, `nextEvent` (countdown), `bossSchedule` (3-4 slot status upcoming/active/completed), `suggestedActivities` (priority-sorted CTA hints). Chi tiết shape ở `docs/API.md`.
- **FE Today Activity Panel** (`HomeView`): "Hoạt Động Hôm Nay" — danh sách suggested CTA, sự kiện đang mở, lịch boss hôm nay với status badge. CTA buttons "Đi Boss" / "Vào Bí Cảnh" / "Xem Nhiệm Vụ". i18n vi/en cho 5 event + 4 boss + 4 region. API error → fallback message, không crash.
- **FE BossView Schedule UI**: section "Lịch Boss hôm nay" trên đầu BossView — hiển thị giờ + boss + region + status (active/upcoming/completed) + countdown nếu sắp tới. Không phá active boss tabs hiện có.
- **FE Notification**: `LiveOpsNotice` component renderless, poll `/liveops/today` mỗi 60s — push toast warning khi có boss upcoming ≤ 15 phút. Anti-spam: per-slot flag persistent qua sessionStorage (mỗi slot chỉ 1 toast / session); toast store cũng có anti-spam riêng theo (type+text) 1200ms.
- **Catalog**: title +1 (`event_huyet_nguyet_2026` epic event-source). Buff catalog không thay đổi.
- KHÔNG Prisma migration. KHÔNG ảnh hưởng economy chính (chi tiết balance ở `docs/BALANCE_MODEL.md` §6.4).

### Added — Phase 11.10.E Title/Buff gameplay reward hooks — Pill → Buff wire (PR #451)

- **Pill → Buff apply**: 4 đan dược mới (Cương Lực Đan, Thiết Bích Đan, Sinh Cơ Đan, Linh Tâm Đan) khi `use()` sẽ apply BuffDef tương ứng (`pill_atk_buff_t1` +12% atk 60s, `pill_def_buff_t1` +15% def 60s, `pill_hp_regen_t1` hồi 5 HP/s 30s, `pill_spirit_buff_t1` +18% spirit 90s). Catalog buff đã có sẵn từ Phase 11.8.A nhưng **chưa được apply qua gameplay** — PR này wire 4 pill items qua `effect.buffKey` field mới + `InventoryService.use()` gọi `BuffService.applyBuffTx()` cùng tx (atomic — fail tx → buff KHÔNG insert + pill KHÔNG decrement).
- **NPC shop**: 4 pill mới có sẵn ở NPC shop (Linh Thạch, dailyLimit 5/người/ngày — tránh stack buff abuse vào PvP/boss event).
- **Audit Phase 11.10.E gameplay reward sources** — xác nhận 4/5 hook đã wire trước đó (realm breakthrough → realm milestone title via `character.service.ts:227,309,585`; achievement claim → title via `achievement.service.ts:425-435`; boss kill → title gián tiếp qua achievement `first_boss_kill`; dungeon clear → title gián tiếp qua achievement `first_dungeon_clear`; tribulation/breakthrough FAIL → tam_ma debuff). Pill → buff là gap thực sự duy nhất.
- **Catalog cross-ref guard**: helper `buffForItem(itemKey)` shared package + 9 test cases drift guard (mọi item có `effect.buffKey` phải lookup được buff; mọi pill_*_buff_t1 phải có ≥ 1 item link tới — no orphan buff).
- **Idempotent + race-safe**: `CharacterBuff` composite UNIQUE `(characterId, buffKey)` đảm bảo non-stackable refresh `expiresAt`, stackable +1 stack cap `maxStacks`. Pre-tx catalog drift guard (item declared `buffKey` nhưng buff không tồn tại → throw KHÔNG decrement).
- Backward-compat: `InventoryService` 4th param `buffs?` optional — legacy bootstrap (test fixtures không inject) tiếp tục work, skip buff apply silently.

### Added — M10 Shop daily purchase limit + per-user rate limit (PR #450)

- **Per-item daily purchase cap**: mỗi entry trong NPC shop có thể đặt `dailyLimit` (opt-in). Player vượt cap → toast "Vượt hạn mức mua hôm nay. Thử lại sau khi reset". Reset 00:00 theo `MISSION_RESET_TZ` (mặc định `Asia/Ho_Chi_Minh`) — cùng mốc reset với daily mission / daily-login / dungeon `dailyLimit`. Mặc định cho closed beta: pills HP/MP = 20/ngày, đan exp + ore = 10/ngày, equipment phàm phẩm = 5/ngày.
- **Per-user rate limit**: 30 lần `POST /shop/buy` trong 60 giây mỗi user. Vượt → 429 + toast "Mua quá nhanh — vui lòng chậm lại và thử lại sau". Chặn script abuse / race exploit. Limit theo `userId` (không phải IP) → 1 acc share IP với người khác không liên đới.
- **Anti-economy abuse**: cả 2 tầng pre-check trước transaction — KHÔNG trừ tiền khi reject. Rate limit dùng Redis sliding window (cross-instance) với `FailoverRateLimiter` wrapper → Redis down runtime fallback in-memory, KHÔNG bao giờ 500.
- **FE shop**: mỗi entry hiện badge "Hạn mức hôm nay: N" khi có `dailyLimit`. i18n vi + en cho 2 error code mới.
- Backend-only architecture: KHÔNG migration mới — daily count derive từ `ItemLedger` reason='SHOP_BUY' với index `(reason, createdAt)` đã có sẵn.

### Added — Phase 11.8.D Buff HUD + 11.9.C Title catalog/equip — FE wire (PR #449)

- **Title catalog UI** (`/titles`): xem 26 danh hiệu trong game (5 rarity × 6 source × 5 element), filter theo source/rarity/status, **trang bị** danh hiệu đã unlock (single-slot), **gỡ bỏ** equipped title. Topbar (lg+ screens) hiển thị tên danh hiệu đang trang bị màu vàng (`amber-200`) bên dưới tên nhân vật.
- **Buff HUD** (topbar): hiển thị các buff/debuff đang active dưới dạng pill (xanh lá = buff, hồng = debuff) với countdown timer auto-update mỗi giây và tự động fetch lại khi có buff hết hạn. Format thời gian: `<60s = "30s"`, `<60m = "5m30s"`, `≥1h = "1h05m"`. Stacks > 1 hiển thị `×N`.
- **i18n**: vi + en đầy đủ cho menu sidebar (`號 Danh Hiệu`), TitleView, BuffBar HUD, 9 error code (`TITLE_NOT_FOUND`, `TITLE_NOT_OWNED`, `ALREADY_EQUIPPED`, `NOT_EQUIPPED`, `IN_FLIGHT`, ...).
- Backend đã có 4 endpoint trên main; PR này chỉ wire FE (không Prisma migration).

---

## [session 9r-28 — Title auto-unlock trilogy (breakthrough + tribulation + onboard) + docs catch-up — PR #279 → #281, merged 2/5 2026]

### Internal — Phase 11.9.C trilogy: Title auto-unlock realm milestone wire

Sau Phase 11.9.B PR #245 đã có `TitleService.unlockTitle()` + `unlockTitleTx()` runtime persistence + `CharacterTitleUnlock` Prisma model với composite UNIQUE `(characterId, titleKey)`, **trilogy 11.9.C** wire helper `titleForRealmMilestone(realmKey)` từ shared catalog vào 3 character life-cycle event sites:

- **Breakthrough low-tier title wire** (PR #280 / Phase 11.9.C): `apps/api/src/modules/character/character.service.ts` — import `Logger` + `titleForRealmMilestone` + `TitleService`. Constructor add `titles?: TitleService` 6th positional optional (NestJS DI auto-resolve). Sau `prisma.character.update` trong `breakthrough()` thành công, gate `if (this.titles && next)` rồi lookup `titleForRealmMilestone(newRealm)` → call `titles.unlockTitle(charId, def.key, 'realm_milestone')` trong try/catch. Fail-soft: title unlock lỗi KHÔNG fail breakthrough core path. Idempotent qua composite UNIQUE. 4 vitest mới (1441 → 1445 api).

- **Tribulation high-tier title wire** (PR #281 / Phase 11.9.C-2): `apps/api/src/modules/character/tribulation.service.ts` — import `Logger` + `titleForRealmMilestone` + `TitleService`. Constructor add `titles?: TitleService` 3rd positional optional. Sau `currency.applyTx` trong SUCCESS branch (cùng `prisma.$transaction` đã có), gate `if (this.titles)` rồi lookup `titleForRealmMilestone(next.key)` → call `titles.unlockTitleTx(tx, charId, def.key, 'realm_milestone')` — TX-AWARE variant (KHÔNG mở tx mới). **Khác Phase 11.9.C low-tier**: KHÔNG fail-soft DB error (rollback toàn bộ tx) — chỉ catch `TITLE_NOT_FOUND` (catalog drift) → `Logger.warn`. Tribulation success path tx-atomic — nếu title unlock fail vì DB constraint thật, rollback better than partial state. 5 vitest mới (1445 → 1450 api).

### Internal — Phase 11.10.G test hardening (no catalog change)

- **Achievement catalog cross-ref invariants** (PR #279 / Phase 11.10.G): `packages/shared/src/achievements.test.ts` — add 2 vitest invariant: (1) `mọi reward.items[*].itemKey PHẢI tồn tại trong ITEMS catalog`, (2) `mọi rewardTitleKey PHẢI tồn tại trong TITLES catalog`. Bảo vệ Phase 11.10.D `claimReward` items grant path từ catalog drift (vd ai đó đổi item key trong items.ts mà quên update achievements.ts → test sẽ fail trước CI merge). Test-only, no runtime change.

### Player-facing impact (post-merge)

- **Auto-unlock title milestone sau breakthrough thành công** (PR #280): khi nhân vật đột phá thành công lên realm mới có milestone title (vd luyenkhi 9/9 → truc_co 1 → unlock `realm_truc_co_pillar` "Trúc Cơ Trụ Đạo"). 9/28 realm có title trong catalog (luyenkhi/truc_co/kim_dan/nguyen_anh/hoa_than/do_kiep/thien_tien/thanh_nhan/hu_khong_chi_ton). UI surfacing chưa có scope (Phase 11.9.D defer).

- **Auto-unlock title milestone sau vượt kiếp thành công** (PR #281): khi nhân vật vượt kiếp thành công lên realm cao hơn có milestone title (vd kim_dan 9/9 → nguyen_anh 1 → unlock `realm_nguyen_anh_master` "Nguyên Anh Đại Sư"). Atomic-trong-tx: nếu kiếp success nhưng DB lỗi unlock title (không phải catalog drift), rollback toàn bộ — KHÔNG bao giờ realm advance mà thiếu title.

- **Zero observable change cho realm transition không có title** (PR #280, #281): hoa_than → luyen_hu, luyen_hu → hop_the, hop_the → dai_thua, do_kiep → nhan_tien (4/7 tribulation transitions) không có milestone title trong catalog → wire skip, KHÔNG insert row. Future catalog mở rộng có thể bù.

### Risk / rollback

- 🟢 **PR #279**: zero runtime impact (test-only). Nếu fail trong tương lai, fix catalog references rồi commit lại.
- 🟢 **PR #280**: low — fail-soft try/catch quanh `unlockTitle`. Backward-compat test confirm `chars` không inject titles vẫn breakthrough bình thường. Idempotent qua composite UNIQUE.
- 🟢 **PR #281**: low — atomic guarantee qua tx, idempotent qua composite UNIQUE. Backward-compat test confirm. Tribulation high-tier transitions có 2/7 với title (kim_dan→nguyen_anh, nguyen_anh→hoa_than, dai_thua→do_kiep) → wire chỉ active 3 path; còn 4/7 transition không có title → skip silently.

### Tests / CI

- **PR #279**: 956 shared vitest (954 baseline + 2 invariant). CI 5/5 GREEN.
- **PR #280**: 1445 api vitest (1441 baseline + 4 breakthrough title test). CI 5/5 GREEN.
- **PR #281**: 1450 api vitest (1445 baseline + 5 tribulation title test). CI 5/5 GREEN.
- Total monorepo baseline post-PR-#281: **2994 vitest** = shared 956 + api 1450 + web 588.

---

## [session 9r-27 part 5 — Achievement item rewards wire + docs catch-up — PR #276 → #277, merged 2/5 2026]

### Internal — Phase 11.10.D Achievement item rewards (no catalog change)

**Compose-and-fail-soft pattern** mở rộng cho `AchievementService.claimReward` — wire grant `def.reward.items` non-empty qua `InventoryService.grantTx` reason `'ACHIEVEMENT_REWARD'` (`ItemLedger` audit). Phase 11.10.C-1 (PR #248) đã defer items với `throw AchievementError('ITEMS_NOT_SUPPORTED')` để tránh circular dep `CharacterModule ↔ InventoryModule` (InventoryModule imports CharacterModule cho `CharacterService`/`CurrencyService`). Phase 11.10.D giải quyết bằng `forwardRef` chuẩn NestJS pattern:

- **Achievement item rewards via InventoryService.grantTx** (PR #277 / Phase 11.10.D): `apps/api/src/modules/inventory/inventory.service.ts` — add `'ACHIEVEMENT_REWARD'` vào `ItemLedgerReason` union (parallel với `CurrencyLedger.reason='ACHIEVEMENT_REWARD'` đã wire ở Phase 11.10.C-1). `apps/api/src/modules/character/achievement.service.ts` — import `forwardRef`, `Inject`, `InventoryService`. Constructor add 4th param `@Inject(forwardRef(() => InventoryService)) inventory: InventoryService`. `claimReward`: remove `throw AchievementError('ITEMS_NOT_SUPPORTED')` defensive guard. Inside transaction sau title unlock: nếu `def.reward.items` non-empty → `await this.inventory.grantTx(tx, characterId, [{itemKey, qty}…], { reason: 'ACHIEVEMENT_REWARD', refType: 'Achievement', refId: achievementKey })`. Update return type `granted.items: Array<{ itemKey: string; qty: number }>`. Remove `'ITEMS_NOT_SUPPORTED'` khỏi `AchievementErrorCode` union. `apps/api/src/modules/character/character.module.ts` — wrap `InventoryModule` import với `forwardRef`. `apps/api/src/modules/inventory/inventory.module.ts` — wrap `CharacterModule` import với `forwardRef` để break circular cycle. `apps/api/src/modules/character/character.controller.ts` — remove `case 'ITEMS_NOT_SUPPORTED'` từ `mapAchievementErrorStatus`. Identity hiện tại: 32 baseline catalog không có achievement với `def.reward.items` non-empty (chỉ linhThach/tienNgoc/exp/title) → runtime path identity → no-op. Future-proof khi catalog thêm. 3 vitest mới với `vi.spyOn(shared, 'getAchievementDef').mockReturnValue` fake def reward.items → grant InventoryItem + ItemLedger entry; identity path empty items; double-claim prevention CAS guard.

### Docs — audit/catch-up

- **CHANGELOG catch-up session 9r-27 PR #272 → #275** (PR #276): append section [session 9r-27 — combat passive wire batch + docs catch-up — PR #272 → #275] mô tả 4 PR (Phase 11.X.U talent spiritMul, Phase 11.X.V buff invuln, CHANGELOG catch-up 9r-26 part 5, audit refresh post #271). Pure docs, no code change. CI 5/5 GREEN.

### Player-facing impact (post-merge)

- **Zero observable gameplay change** (PR #277): identity hiện tại — 32 baseline catalog không có achievement với `reward.items` non-empty. Player với current achievement progress không thấy khác biệt.
- **Future-proof catalog mở rộng** (PR #277): khi Phase 11.10.F catalog thêm achievement với `reward.items` (vd milestone collection achievements grant đan dược/material), claim sẽ grant items qua `InventoryItem` upsert + `ItemLedger` audit, idempotent qua CAS `claimedAt: null` guard.
- **Closer wire parity** (PR #277): `AchievementService.claimReward` giờ wire toàn bộ reward channels — `linhThach`/`tienNgoc` (CurrencyService), `exp` (PrismaService), `title` (TitleService), `items` (InventoryService). Tất cả 4 reward types unified pattern: ledger entry với `reason='ACHIEVEMENT_REWARD'`, `refType='Achievement'`, `refId=achievementKey` cho audit/idempotency.

### Risk / rollback

- 🟢 zero balance impact — identity path (no current catalog producer with items).
- Backward-compat 100% với existing claims (linhThach/tienNgoc/exp/title vẫn hoạt động). Module DI restructure dùng `forwardRef` chuẩn NestJS — không phá runtime DI graph (verified qua full api test 1441 ✓).
- API contract change: `'ITEMS_NOT_SUPPORTED'` (HTTP 501) error code removed — không ai reachable trong production vì current catalog không trigger.
- Rollback: revert PR (8 file change). Module DI revert về `CharacterModule` không import `InventoryModule` + `AchievementService` 3-arg constructor + throw `ITEMS_NOT_SUPPORTED`. Không cần DB migration revert (DB schema không đổi).

### CI status

- PR #276: 5/5 GREEN ✓
- PR #277: 5/5 GREEN ✓ (+3 new vitest tổng 2983)

---

## [session 9r-27 — combat passive wire batch + docs catch-up — PR #272 → #275, merged 2/5 2026]

### Internal — Phase 11 combat passive wires (no catalog change)

**Compose-and-fail-soft pattern** tiếp tục cho monster reply branch. 2 PR runtime wire mới fix gap pattern coverage:

- **Talent spiritMul wire vào CombatService.action() effSpirit defense calc** (PR #274 / Phase 11.X.U): wire `talentMods.spiritMul × effSpirit` ở monster reply branch (`combat.service.ts:386-390`). `composePassiveTalentMods` đã produce `spiritMul` (kind=stat_mod, statTarget=spirit) trong package shared, nhưng catalog hiện tại không có talent với `statTarget=spirit` (talent_kim_thien_co=atk, talent_thuy_long_an=hpMax, talent_tho_son_tuong=def, talent_moc_linh_quy=regen, talent_hoa_tam_dao=damage_bonus, talent_thien_di=drop, talent_ngo_dao=exp). Identity 1.0 → zero balance impact. Wire để pattern coverage nhất quán với `atkMul/defMul/damageBonusByElement/dropMul/expMul` đã wire (#251) + future-proof cho talent spirit producer (vd `talent_huyen_thuy_tam` future +50% spirit). 3 vitest mới với `vi.spyOn(TalentService.prototype, 'getMods')` để cover wire path. `combat.service.ts` + `combat.service.test.ts` + `AI_HANDOFF_REPORT.md`.
- **Buff invuln wire vào CombatService.action() override damage** (PR #275 / Phase 11.X.V): wire `buffMods.invulnActive` (kind=invuln) PRE-shield gate trong reply branch (`combat.service.ts:404-438`) + DOT branch (line 449). Spec `invuln`: ignore all damage (rất hiếm — ngắn duration), nên wire skip cả monster reply (PRE-shield) lẫn DOT (end-of-turn). `composeBuffMods` đã produce `invulnActive` trong package shared, nhưng catalog hiện tại không có buff với `kind=invuln` (talent_shield_phong=shield, debuff_burn_hoa=dot, debuff_root_thuy=control, debuff_taoma=cultivation_block). Identity false → zero balance impact. Pattern coverage nhất quán với cultivationBlocked (#270) + control (#264) — boolean buff state gates damage path. Future-proof cho buff invuln producer trong catalog tương lai (vd `buff_kim_than_shield` ngắn duration). 4 vitest mới với `vi.spyOn(BuffService.prototype, 'getMods')` invulnActive=true cover reply nullified + DOT cũng skip + identity baselines. `combat.service.ts` + `combat.service.test.ts` + `AI_HANDOFF_REPORT.md`.

### Docs — audit/catch-up

- **CHANGELOG catch-up session 9r-26 part 5** (PR #272): append section cho PR #267 (Phase 11.7.E talent regen) + #268 (Phase 11.X.Q boss control) + #270 (Phase 11.X.R boss cultivationBlocked) + #271 (Phase 11.4.E boss equip atk). Pure docs, no code change. CI 4/4 GREEN.
- **AI_HANDOFF_REPORT refresh post PR #271 merged + PR #272 open** (PR #273): bump main pointer `df52a1d` → audit refresh; promote PR #271 → "Latest merged PR", demote PR #270 → "Previous merged PR"; update Open PRs line; add session 9r-27 snapshot. Pure docs, no code change. CI 4/4 GREEN.

### Player-facing impact (post-merge)

- **Zero observable gameplay change** (PR #274, #275): cả hai wire đều identity hiện tại (catalog không có producer cho `talent.spiritMul` hoặc `buff.invulnActive`). Player với current builds không thấy khác biệt. Future-proof cho catalog mở rộng — khi thêm talent spirit producer hoặc buff invuln, runtime sẽ activate đúng pattern.
- **Closer pattern parity** (PR #274, #275): combat reply branch giờ wire toàn bộ talent/buff/title stat multipliers (atk/def/spirit/damageElement) + boolean gates (control/cultivationBlocked/invuln). Phù hợp với combat compose-and-fail-soft design — tất cả passive mods compute-but-not-consumed gap đã đóng cho `CombatService.action()` reply path.

### Risk / rollback

- 🟢 zero balance impact — identity multipliers/booleans (no current catalog producer).
- Backward-compat 100% với character không có talent/buff matching wire / TalentService/BuffService không inject (compose-and-fail-soft).
- Rollback: revert PR scope (combat.service.ts + test). Wire chỉ thêm 1-2 multiply factor hoặc 1 boolean guard — không có data migration.

### CI status

- PR #272: 4/4 GREEN ✓
- PR #273: 4/4 GREEN ✓
- PR #274: 5/5 GREEN ✓
- PR #275: 5/5 GREEN ✓

---

## [session 9r-26 part 5 — boss wire batch — PR #267 → #271, merged 2/5 2026]

### Internal — Phase 11 boss/cultivation passive wires (no catalog change)

**Compose-and-fail-soft pattern** tiếp tục. 4 PR runtime wire mới fix gap real:

- **Talent hp/mpRegenFlat wire vào CultivationProcessor** (PR #267 / Phase 11.7.E): `talentMods.hpRegenFlat` / `mpRegenFlat` cộng additively với `buffMods.hpRegenFlat` / `mpRegenFlat` ở cultivation tick regen branch. Catalog `talent_moc_linh_quy` (Mộc Linh Quy passive 5 HP regen mỗi tick) trước đó compute trong `composePassiveTalentMods` nhưng KHÔNG consume runtime — `cultivation.processor.ts` chỉ wire `buffMods.hpRegenFlat`, talent regen de facto no-op. Refactor `talentMods` fetch ONCE per character per tick, share giữa expMul (Phase 11.7.D) và regen (Phase 11.7.E). 5 vitest mới: lone talent (5/sec × 30s = 150 HP), talent + buff additive (10/sec × 30s = 300 HP), no-talent identity, no-service identity, debuff_taoma block. `cultivation.processor.ts` + `cultivation.processor.test.ts` + `AI_HANDOFF_REPORT.md`.
- **Buff control wire vào BossService.attack()** (PR #268 / Phase 11.X.Q): parallel to Phase 11.X.O combat wire (PR #264). `buffMods.controlTurnsMax > 0` → throw `BossError('CONTROLLED')` BEFORE state mutation (cooldown set, mp/stamina/hp deduct, ledger). Catalog producer giống combat: `debuff_root_thuy` (3t), `debuff_stun_tho` (1t), `debuff_silence_kim` (2t). Inject `@Optional() buffs?: BuffService` vào BossService DI. Map `CONTROLLED` → HTTP 409 CONFLICT trong `BossController.handleErr`. 5 vitest mới: stun + state-unchanged, root, silence, no-debuff identity, no-service identity. `boss.service.ts` + `boss.controller.ts` + `boss.service.test.ts`.
- **Buff cultivationBlocked wire vào BossService.attack()** (PR #270 / Phase 11.X.R; PR #269 v1 auto-closed do chained base deleted khi PR #268 merge → recreated): `buffMods.cultivationBlocked` (Tâm Ma `debuff_taoma`) → throw `BossError('CULTIVATION_BLOCKED')` BEFORE state mutation. Tâm Ma'd char đã bị block tu luyện EXP (Phase 11.8.D wire ở `CultivationProcessor`) giờ cũng bị block boss attack — semantically nhất quán. Cùng lần `getMods` với Phase 11.X.Q control check (consolidate single buff fetch). Map `CULTIVATION_BLOCKED` → HTTP 409. 3 vitest mới: taoma throw + state unchanged, no debuff identity, no service identity. `boss.service.ts` + `boss.controller.ts` + `boss.service.test.ts`.
- **Equipment atk/spirit bonus wire vào BossService.attack()** (PR #271 / Phase 11.4.E): wire `inventory.equipBonus().atk` cộng vào `charAtk` + `equipBonus().spiritBonus` cộng vào `char.spirit` cho atkScale > 1 skill. Trước đây boss attack chỉ dùng `char.power`/`char.spirit` raw, hoàn toàn bỏ qua equip bonus (atk + sockets từ Phase 11.4.B + refine từ Phase 11.5.B). Player full equip có DPS boss thấp hơn nhiều so với combat (combat đã wire `equipBonus` + `statMul` + `talentMods` + `buffMods` + `titleMods` + element). Subset của Phase 11.X.S full stat wire — chỉ wire equip (low-risk balance), KHÔNG wire talent/buff/title atkMul (defer). 3 vitest mới với `vi.spyOn(Math, 'random').mockReturnValue(0.5)` deterministic: so_kiem +5 atk → damage cao hơn baseline, no-equip identity, huyen_kiem +12 atk +2 spirit. `boss.service.ts` + `boss.service.test.ts`.

### Player-facing impact (post-merge)

- **Tu luyện talent regen thực sự cộng HP/MP** (PR #267): player với `talent_moc_linh_quy` (Mộc Linh Quy) học được trong sect-tree giờ ăn 5 HP regen mỗi tick cultivation (~150 HP / 30s). Trước đó học talent này không có hiệu quả runtime nào. Stack additive với buff regen (potion / formation).
- **Player bị control debuff không thể tấn công boss** (PR #268). Trước đó `debuff_root_thuy` / `debuff_stun_tho` / `debuff_silence_kim` chỉ block combat (Phase 11.X.O), boss vẫn cho phép → semantically inconsistent. Giờ throw `BossError('CONTROLLED')` HTTP 409, frontend hiển thị "Đang bị khống chế, không thể tấn công boss". State (cooldown / mp / stamina / hp) KHÔNG mutate khi throw.
- **Player Tâm Ma không thể tấn công boss** (PR #270). Trước đó `debuff_taoma` chỉ block tu luyện EXP (Phase 11.8.D), boss vẫn cho phép. Giờ throw `BossError('CULTIVATION_BLOCKED')` HTTP 409. Semantically Tâm Ma'd char không tập trung được nên không tu luyện ↔ không boss-attack.
- **Player full bộ equip có DPS boss tăng** (PR #271). Trước đó equip atk/spiritBonus + sockets + refine hoàn toàn bị bỏ qua trong boss damage formula — player không equip và player full equip có DPS boss bằng nhau, FIX gap real. Giờ equip atk cộng vào `charAtk`, equip spiritBonus cộng vào `char.spirit` cho skill atkScale > 1.

### Tests baseline progression

- Pre-PR-#267: API 1415 vitest (post-PR-#266).
- Post-PR-#267: API 1420 vitest (+5 talent regen wire tests).
- Post-PR-#268: API 1425 vitest (+5 boss control wire tests).
- Post-PR-#270: API 1428 vitest (+3 boss cultivationBlocked wire tests).
- Post-PR-#271: API 1431 vitest (+3 boss equip atk wire tests).
- Total full suite post-PR-#271: API 1431 + shared 954 + web 588 = **2973 vitest**.

### Risks / migrations

- **None breaking schema/catalog**: pure consume wire, no schema/migration/catalog changes.
- PR #268/#270 wire throws BEFORE state mutation → cooldown / character / ledger an toàn.
- PR #271 balance impact: boss DPS tăng cho player có equip — đúng với expectation, fix gap thật. Damage tăng tỷ lệ với equip bonus existing trong DB (player chưa có equip không đổi).
- PR #267 talent regen catalog hiện chỉ có 1 producer (`talent_moc_linh_quy` 5 HP/tick) → balance impact low, có thể nerf catalog `value` nếu cần.

---

## [session 9r-26 wire batch — PR #263 → #265, merged 2/5 2026]

### Internal — Phase 11 buff consume runtime wire (no catalog/balance change)

**Compose-and-fail-soft pattern** continued. 3 PR mới: 1 docs/audit + 2 buff runtime wire (control + shield) — fix gap nhận diện sau session 9r-25: control debuff (root/stun/silence) và shield buff (`talent_shield_phong`) đều compute mods nhưng KHÔNG consume runtime → de facto no-op trước PR này.

- **Docs audit refresh post-PR-#262** (PR #263): pure docs/audit refresh sau khi PR #262 (Phase 11.X.M DOT) merged. Bump main pointer `ec29c2f` → `a70c733`, mark PR #262 MERGED, list 3 next-task candidates pre-analyzed (Phase 11.X.K hpMaxMul / 11.X.N shield / 11.X.O control). `docs/AI_HANDOFF_REPORT.md`.
- **Buff control wire vào CombatService.action()** (PR #264 / Phase 11.X.O): `buffMods.controlTurnsMax > 0` → throw `CombatError('CONTROLLED')` ngay sau khi compose buffMods, TRƯỚC mọi state mutation (encounter status / character HP/MP/stamina / ledger không đụng tới khi throw). Catalog `debuff_root_thuy` (3 turns), `debuff_stun_tho` (1 turn), `debuff_silence_kim` (2 turns). 5 vitest mới: stun throw, root throw, DOT no-throw (kind != control), no buff identity, BuffService not injected identity. `combat.service.ts` + `combat.service.test.ts` + `AI_HANDOFF_REPORT.md`.
- **Buff shield wire vào CombatService.action()** (PR #265 / Phase 11.X.N): `buffMods.shieldHpMaxRatio` damage absorb monster reply trước khi `charHp -= reply`. Per-turn refresh aura model: `shieldAbsorb = floor(char.hpMax × shieldHpMaxRatio)` recompute mỗi turn buff active. Catalog `talent_shield_phong` (kind=shield value=0.3 hpMax, source=talent, durationSec=10). 5 vitest mới: full absorb, shield > reply, no-shield identity, no-service identity, shield + DOT isolation. `combat.service.ts` + `combat.service.test.ts` + `AI_HANDOFF_REPORT.md`.

### Player-facing impact (post-merge)

- **Control debuffs (root/stun/silence) thực sự block player action** (PR #264). Trước đó character bị `debuff_stun_tho` etc trong DB nhưng vẫn act bình thường trong combat. Giờ nhận `CombatError('CONTROLLED')` → frontend hiển thị "Đang bị khống chế, không thể hành động" → player phải chờ debuff hết hạn. Encounter / HP / MP / stamina / ledger an toàn (throw EARLY, không mutate state).
- **Shield buff (`talent_shield_phong` Phong Hộ Thuẫn) thực sự hấp thu damage** (PR #265). Trước đó player ăn full damage dù có "khiên" trong DB. Giờ shield absorb monster reply theo per-turn refresh model: 30% × hpMax mỗi turn buff active (~3 turns trong 10s duration). Combat log show "Khiên hấp thu N sát thương." Shield + DOT: shield không chống độc/bỏng (semantic kim bất khả phá độc).

### Tests baseline progression

- Pre-PR-#263: API 1405 vitest (post-PR-#262).
- Post-PR-#263: API 1405 vitest (docs-only).
- Post-PR-#264: API 1410 vitest (+5 control wire tests).
- Post-PR-#265: API 1415 vitest (+5 shield wire tests).
- Total full suite post-PR-#265: API 1415 + shared 954 + web 588 = **2957 vitest**.

### Risks / migrations

- **None breaking**: pure consume wire, no catalog/schema/migration changes.
- Control wire throws BEFORE state mutation → encounter / character / ledger an toàn.
- Shield per-turn refresh model = generous (90% over 10s duration with current catalog 30% × ~3 turns), nhưng catalog hiện chỉ có 1 producer (`talent_shield_phong`) → không break balance. Có thể nerf catalog `value` nếu cần điều chỉnh.

---

## [session 9r-25 part 3 wire batch — PR #261 → #262, merged 2/5 2026]

### Internal — Phase 11 buff consume runtime wire (no catalog/balance change)

**Compose-and-fail-soft pattern** continued from session 9r-25 part 2. 2 PR mới: 1 docs/audit + 1 buff runtime wire (DOT) — fix gap DOT debuff (`debuff_burn_hoa` / `debuff_poison_moc`) đã compute `dotPerTickFlat` nhưng KHÔNG consume runtime → de facto no-op trước PR này.

- **Docs audit refresh session 9r-25 part 2 close-out** (PR #261): pure docs/audit refresh sau khi PR #258/#259 merged. Bump main pointer `b47686f` → `7244e6f`, finalize session 9r-25 part 2 audit. `docs/AI_HANDOFF_REPORT.md`.
- **Buff DOT wire vào CombatService.action()** (PR #262 / Phase 11.X.M): `buffMods.dotPerTickFlat` (đã tính theo stack ở composeBuffMods: `value × stacks`) cộng damage cuối lượt cho encounter còn ACTIVE (đã không WON/LOST). Catalog `debuff_burn_hoa` (8 dmg × stack, hoa skill, maxStacks=3) + `debuff_poison_moc` (6 dmg × stack, moc skill, maxStacks=3). End-of-turn semantics (không phải start-of-turn) — combat turn-based, DOT ticks "cuối lượt" tương đương "đầu lượt tiếp theo". Nếu charHp ≤ 0 sau DOT → status LOST + clamp HP=1 (giống monster reply LOST handling). 5 vitest mới: 1 stack 8 dmg, 2 stack 16 dmg, dot kill (LOST + clamp), no debuff identity, no service inject identity. `combat.service.ts` + `combat.service.test.ts`.

### Player-facing impact (post-merge)

- **DOT debuffs (Hoả/Độc) thực sự apply runtime damage** (PR #262). Trước đó character bị `debuff_burn_hoa` 1 stack hay 3 stack đều ăn 0 DOT damage. Giờ end-of-turn trừ HP theo `value × stacks`. Combat log show "Độc/bỏng phát tác — chịu N sát thương DOT." Nếu DOT đủ kill → "hôn mê do độc/bỏng — chiến đấu thất bại."

### Tests baseline progression

- Pre-PR-#261: API 1400 vitest (post 9r-25 part 2).
- Post-PR-#261: API 1400 vitest (docs-only).
- Post-PR-#262: API 1405 vitest (+5 DOT wire tests).
- Total full suite post-PR-#262: API 1405 + shared 954 + web 588 = **2947 vitest**.

### Risks / migrations

- **None breaking**: pure consume wire, no catalog/schema/migration changes.
- DOT ticks AFTER monster reply branch — không double-apply trong cùng turn.
- DOT respect encounter status: WON / LOST không apply (cuộc chiến đã kết thúc).

---

## [session 9r-25 part 2 wire batch — PR #258 → #259, merged 2/5 2026]

### Internal — Phase 11 passive consume runtime wire (no catalog/balance change)

**Compose-and-fail-soft pattern** continued from session 9r-25 part 1 (PR #251–#256). 2 PR mới wire 2 gap còn lại nhận diện trong session: equip.spiritBonus runtime consume + talents.dropMul boss reward.

- **Equip spiritBonus wire vào CombatService.action()** (PR #258 / Phase 11.4.D): `inventory.equipBonus.spiritBonus` (item base spirit + gem spirit socket bonus + refine multiplier — đã compute Phase 11.4.B/11.5.B) cộng additive vào `effSpirit` defense calc trong combat reply branch. Trước đó equip.spiritBonus chỉ được compute nhưng KHÔNG consume runtime — gem moc/thuy/tho spirit bonus de facto no-op cho monster reply defense. Pattern same as atk wire `(base + flat) × multipliers`. 2 vitest. `combat.service.ts` + `combat.service.test.ts`.
- **Talent dropMul wire vào BossService reward distribution** (PR #259 / Phase 11.X.G): `talents.getMods().dropMul` × linhThach reward trong `distributeRewards`. Catalog `talent_thien_di` (passive `drop_bonus` +20%) v.v. trước đó CHỈ wire vào CombatService monster drop (PR #251). Boss world reward distribution không có wire — `talent_thien_di` de facto no-op cho boss reward. Apply BEFORE `currency.applyTx` ledger write, BigInt × float Number floor (range safe ~10M within 2^53). CurrencyLedger reflects boosted delta — single source of truth audit. 3 vitest. `boss.service.ts` + `boss.service.test.ts`.

### Player-facing impact (post-merge)

- **Gem spirit bonus runtime applies cho combat reply defense** (PR #258). Trước đó gem mộc/thuỷ/thổ spirit bonus chỉ display ở character profile, không ảnh hưởng combat damage taken.
- **Talent Thiên Di "+20% drop rate" giờ apply cho world boss reward** (PR #259). Trước đó chỉ apply monster combat drop. Top1 share 50% × 1.2 = 60%, top2-3 15% × 1.2 = 18%, top4-10 2% × 1.2 = 2.4%. CurrencyLedger reflects actual granted (not base) for audit accuracy.

### Tests baseline progression

- Pre-PR-#258: API 1395 vitest (post 9r-25 part 1).
- Post-PR-#258: API 1397 vitest (+2 spirit bonus tests).
- Post-PR-#259: API 1398 vitest. Boss test file `boss.service.test.ts` 19/19 (16 baseline + 3 new dropMul cases).
- Total full suite post-PR-#259: API 1398 + shared 954 + web 588 = **2940 vitest**.

### Risks / migrations

- **None breaking**: pure consume wire, no catalog/schema/migration changes.
- BOSS_REWARD ledger.delta now reflects boosted amount — audit-accurate. Existing pre-wire ledger rows preserved (immutable history).

---

## [session 9r-25 wire batch — PR #251 → #256, merged 1/5–2/5 2026]

### Internal — Phase 11 passive systems runtime wire (no catalog/balance change)

**Compose-and-fail-soft pattern**: mỗi PR inject `@Optional()` service vào consumer (CombatService / CultivationProcessor), gọi `service.getMods()` returning multiplier object, compose multiplicatively với identity fallback (`1.0` nếu service không inject hoặc character chưa có resource active). Đặc điểm chung: pure logic + vitest cover bonus path + identity baseline + DI fallback. **Không** đổi catalog (buff/talent/title), **không** đổi schema/migration, **không** đổi ledger semantic.

- **Talent passive wire vào CombatService** (PR #251 / Phase 11.7.C): `talents.getMods()` × CombatService.action() — atkMul × effPower, defMul × effDef, damageBonusByElement × dmg, expMul × monster expDrop, dropMul × linhThachDrop. 4 vitest. `apps/api/src/modules/combat/combat.service.ts` + `combat.service.test.ts`.
- **Buff passive wire vào CombatService** (PR #252 / Phase 11.8.C): `buffs.getMods()` × CombatService.action() — atkMul × effPower, defMul × effDef, spiritMul × spirit defense, damageBonusByElement × dmg, damageReductionByElement × incoming reply. 5 vitest. `combat.service.ts` + `combat.service.test.ts`.
- **Title flavor wire vào CombatService** (PR #253 / Phase 11.9.C): `titles.getMods()` × CombatService.action() — atkMul × effPower, defMul × effDef, spiritMul × spirit defense. 5 vitest. `combat.service.ts` + `combat.service.test.ts`.
- **Talent expMul wire vào CultivationProcessor** (PR #254 / Phase 11.7.D): `talents.getMods().expMul` × cultivation tick gain. Catalog `talent_ngo_dao` "+15% EXP tu vi mỗi lần tu luyện" giờ thực sự apply cho cả cultivation EXP, không chỉ monster EXP drop. Compose multiplicatively với cultivationMul (Linh căn) × methodMul (Công pháp): `gain = max(1, round(baseGain × cultivationMul × methodMul × talentExpMul))`. 4 vitest. `cultivation.processor.ts` + `cultivation.processor.test.ts`.
- **Buff cultivationBlocked (Tâm Ma) wire vào CultivationProcessor** (PR #255 / Phase 11.8.D): `buffs.getMods().cultivationBlocked` flag check ở đầu loop iter — character có debuff `debuff_taoma` (Tâm Ma Triền Thân, 1h duration sau khi vượt kiếp FAIL) → tick skip toàn bộ EXP gain + mission/achievement track + realtime emit. Stamina regen ở top vẫn áp dụng. 4 vitest. `cultivation.processor.ts` + `cultivation.processor.test.ts`.
- **Buff hp/mpRegenFlat wire vào CultivationProcessor** (PR #256 / Phase 11.8.E): `buffs.getMods().hpRegenFlat` / `mpRegenFlat` (per-second values) × tickSeconds (30s) → raw SQL `LEAST("hpMax", hp + delta)` cap update. Catalog `pill_hp_regen_t1` (5 HP/s) + `sect_aura_thuy` (4 MP/s) etc giờ thực sự hồi HP/MP per cultivation tick. Refactor: buffMods fetch ONCE per character per tick (reuse cho cultivationBlocked check + regen). 6 vitest covering cap clamp + Tâm Ma priority + DI fallback. `cultivation.processor.ts` + `cultivation.processor.test.ts`.

### Player-facing impact (post-merge)

- **Tâm Ma debuff giờ thực sự block tu luyện** runtime (PR #255). Trước đó là design intent only.
- **Talent Ngộ Đạo +15% EXP tu vi giờ áp dụng cho cultivation tick** (PR #254). Trước đó chỉ áp dụng monster EXP drop (PR #251).
- **Sect aura Thuỷ (sect_aura_thuy) "+4 MP/s trong tu luyện" giờ thực sự hồi MP** mỗi tick (PR #256). Trước đó chỉ là metadata.
- **Pill hồi HP/MP buffs giờ áp dụng trong cultivation context** (PR #256). Combat HP/MP regen chưa wire (defer).

### Tests baseline progression

- Post-PR-#250 (session 9r-22 base): API 1376 vitest.
- Post-PR-#256: API 1395 vitest (+19 across 6 PRs). Shared 954 vitest (no change). Web 588 vitest (no change). **Total 2937 vitest**.
- All CI 5/5 GREEN at merge time (PR #254 had typecheck regression caught by CI on first push, fixed in same PR commit `62a269f`).

---

## [session 9p — PR #190 → #192, merged 30/4 18:13→18:58 UTC]

### Internal — API pure-unit test coverage push (no runtime change)

- **HealthController.readyz failure paths** (PR #190): +10 vitest (mocked PrismaService.$queryRaw + Redis.ping). Lock-in 503 envelope shape khi DB hoặc Redis fail / Redis trả non-PONG; happy path không gọi `res.status`; error stringify fallback (Error vs non-Error); `version` env override + default. `apps/api/src/modules/health/health.controller.unit.test.ts`. API baseline 619 → 629.
- **admin/ledger-audit `auditResultToJson` JSON serializer** (PR #191): +12 vitest pure-unit cho serializer dùng bởi admin endpoint `GET /admin/economy/audit-ledger`. Lock-in BigInt→string preserve precision khi vượt `Number.MAX_SAFE_INTEGER` (chính lý do tồn tại serializer); negative diff giữ dấu; zero giữ "0"; inventoryDiscrepancies (number) passthrough; JSON.stringify roundtrip safety; no input mutation. `apps/api/src/modules/admin/ledger-audit-json.test.ts`. API baseline 629 → 641.
- **Scheduler ghost-cleanup invariant** (PR #192): +12 vitest pure-unit cho `OpsService.scheduleRecurring` + `MissionScheduler.onModuleInit` (mocked BullMQ Queue). Lock-in: trước add lại job repeatable, MỌI job tên match cũ phải bị `removeRepeatableByKey` (tránh ghost duplication khi hot-reload / interval change); non-match name không xoá nhầm; `add()` 1 lần với `repeat.every` từ constant + `removeOnComplete/removeOnFail` cap 10; constant interval lock (`OPS_PRUNE_INTERVAL_MS === 24h`, `MISSION_RESET_INTERVAL_MS === 10min`). `apps/api/src/modules/ops/ops.service.test.ts` + `apps/api/src/modules/mission/mission.scheduler.test.ts`. API baseline 641 → 653.

### Docs

- **AI_HANDOFF_REPORT** liên tục bumped sau mỗi PR (snapshot, Recent Changes, §21 Session 9p table).

---

## [session 9o — PR #184 → #189, merged 30/4 17:30→17:52 UTC]

### Internal — API service WS / queue test coverage push

- **chat.service WS + history** (PR #186): +11 vitest cho `ChatService` — emit events, room join/leave, history pagination, anti-spam moderation paths. `apps/api/src/modules/chat/chat.service.ws-history.test.ts`. API baseline 597 → 608.
- **mission.processor reset** (PR #187): +8 vitest cho `MissionResetProcessor` — DAILY/WEEKLY window reset, idempotent, không throw khi reset rỗng. `apps/api/src/modules/mission/mission.processor.test.ts`. API baseline 608 → 616.
- **cultivation processor + service** (PR #188): +14 vitest cho `CultivationProcessor` (tick/breakthrough job paths) + `CultivationService` (start/stop/snapshot). Lock-in EXP accumulation, breakthroughReady invariant, ledger atomicity. API baseline 616 → 619.

### Docs

- **Audit refresh session 9o kickoff + progress** (PR #184 / #189): bump snapshot + close-out cascade.

---

## [session 9n+ tail — PR #172 → #179, merged 30/4 13:15→17:00 UTC]

### Added — Tests-only PRs (lock-in coverage, no runtime change)

- **shared catalogs** (PR #173 +40 / #174 +18 / #175 +shared core types): combat formulas, mission templates, item/realm catalog Zod schemas. Shared baseline 96 → 220 vitest.
- **mail WS prune** (PR #176): MailService prune-on-claim invariant.
- **realtime.service** (PR #177): WS service emit + room mapping unit tests.
- **AllExceptionsFilter** (PR #178): error envelope shape lock-in (HTTP code + i18n message key + stack masking).
- **ws/client (web) `resolveWsOrigin`** (PR #179): +15 vitest pure-unit. Web baseline 532 → 547.

### Docs

- **CHANGELOG session 9n catch-up** (PR #172): backfill session 9n entries.

---

## [session 9n — PR #165 → #171, merged 30/4 12:13→13:15 UTC]

### Added

- **Smart audit-ledger CLI** mở rộng `--json` flag (PR #166): `pnpm --filter @xuantoi/api audit:ledger -- --json` cho cron / pipeline parse machine-readable. +13 vitest unit (parseArgs 4 + formatResult 5 + formatResultJson 4) cho pure logic. Doc ở `ADMIN_GUIDE §11`.
- **Smart admin economy alerts thresholds env-tunable** (PR #167): `ECONOMY_ALERTS_DEFAULT_STALE_HOURS` / `_MIN_STALE_HOURS` / `_MAX_STALE_HOURS` env override (mặc định 24h, range 1h..720h). Endpoint `GET /admin/economy/alerts` + UI `apps/web/src/api/admin.ts` adminEconomyAlerts(staleHours?). +22 vitest. Doc `ADMIN_GUIDE §11.3` + `apps/api/.env.example`.
- **Smart economy-alerts CLI** parallel với `audit:ledger` (PR #169): `pnpm --filter @xuantoi/api alerts:economy` + `--json` flag + `--stale-hours=N` flag (override 24h default). Read-only, exit 0/1/2. Extract pure `queryEconomyAlerts()` từ AdminService cho reusability. +18 vitest unit. Doc `ADMIN_GUIDE §11.3`.

### Fixed

- **i18n parity — toast titles** (PR #170): `apps/web/src/stores/toast.ts` Pinia store trước hard-code VN titles (`'Tin tức' / 'Cảnh báo' / 'Lỗi' / 'Thành công' / 'Thiên Đạo Sứ Giả'`) → giờ dùng `i18n.global.t('toast.title.<type>')` (key đã có sẵn ở `vi.json` + `en.json`). User switch sang en thì toast title cũng dịch. +4 vitest cho locale switch (vi/en).
- **i18n parity — api fallback errors** (PR #171): `apps/web/src/api/{auth,shop,character}.ts` trước hard-code VN `new Error('Đăng ký thất bại' / 'Đăng nhập thất bại' / ...)` fallback (9 chỗ) khi BE envelope thiếu `data.error` → giờ dùng helper `fallbackError(op)` wrap `i18n.global.t('common.apiFallback.<op>')`. Added i18n keys `common.apiFallback.{register,login,changePassword,forgotPassword,resetPassword,logoutAll,shopLoad,shopBuy,onboard}` ở vi.json + en.json. +19 vitest cho cả 2 locale + BE error precedence. Web vitest baseline 513 → 532.

### Docs

- **Audit refresh session 9n kickoff** (PR #165): bump snapshot `f103485 → d332a18` post session 9m close-out (PR #160..#164 merged).
- **TROUBLESHOOTING runbook** (PR #168): §15 ledger drift (audit-ledger CLI exit code 1 → diagnose currency vs character balance, item ledger vs InventoryItem.qty); §16 topup stale alerts flood (ECONOMY_ALERTS_*_STALE_HOURS tuning + payment provider integration audit).

### Internal

- Loop autonomous session 9n hoàn tất 7/7 PR merge cascade vào main mà không cần user confirmation cho mỗi task (task A→G). Snapshot `d332a18 → c02573a` (post PR #171).

---

## [session 9m — PR #160 → #164, merged 30/4 11:30→11:51 UTC]

### Docs

- **Audit refresh session 9m kickoff** (PR #160): bump snapshot post session 9l close-out.
- **CHANGELOG catch-up sessions 9g/9h/9i/9j/9l** (PR #161): backfill changelog cho các session đã merge nhưng thiếu trong file này.

### Internal

- **API service test coverage push** (PR #162/#163/#164): +36 vitest economy/auth safety:
  - `topup.service.test.ts` +17 vitest (PR #162): payment confirm idempotency, ledger atomicity, currency conversion.
  - `email.service.test.ts` +14 vitest unit (PR #163): no-DB pure transformer tests cho mail formatting.
  - `giftcode-race.test.ts` +5 vitest concurrent (PR #164): double-grant prevention via DB unique constraint + Promise.allSettled stress test.

---

## [session 9l — PR #156 → #159, merged 30/4 10:30→11:00 UTC]

### Docs

- **Audit refresh session 9l kickoff** (PR #156): bump snapshot `2e54a1e → 739b10a`, session 9k 7/7 PR close-out, session 9l backlog + roadmap.
- **RELEASE_NOTES + CHANGELOG session 9k close-out** (PR #157): mark "Đã hoàn thành trong session 9k" 5 item, chuyển M9 sang "Đã giải quyết", thêm CHANGELOG section session 9k.
- **Handoff M9 Resolved** (PR #158): mark M9 (logout-all passwordVersion) Resolved trong §16 Known Issues.

### Internal

- **UI primitive render tests** (PR #159): ConfirmModal 17 + SkeletonBlock 4 + SkeletonTable 4 vitest. Web baseline `484 → 509` (51 → 54 file).

---

## [session 9k — PR #149 → #155, merged 30/4 09:00→09:35 UTC]

### Added

- **Playwright `E2E_FULL=1` golden smoke expand** (PR #153): +3 best-effort test trong `apps/web/e2e/golden.spec.ts` — `shop buy → inventory reflect new item`, `mail inbox open → read → claim nếu có reward`, `profile /profile/:id public view`. CI mặc định không chạy (giữ nguyên AuthView smoke only); ops bật local qua `E2E_FULL=1 pnpm --filter @xuantoi/web e2e` khi muốn verify pre-release.
- **AdminView render-level smoke tests** (PR #150): 18 vitest bao phủ onMounted role guard (unauth / PLAYER / ADMIN+MOD), tab badge rendering (alertsCount / pendingTopup / activeGiftcode), tab switch fetch (Users / Audit), Export CSV flow (success / truncated warning / UNAUTHENTICATED), Giftcode revoke ConfirmModal wiring (modal open/cancel/confirm, CODE_REVOKED error, REVOKED/EXPIRED state hide). Baseline web `466 → 484` (50 → 51 file).
- **`pnpm smoke:beta` zero-dep ESM CLI** (PR #152): `scripts/smoke-beta.mjs` chạy 16-step HTTP smoke (healthz → register → session → onboard → character/me → cultivate start/stop → daily-login → missions → shop → inventory → mail → leaderboard → logout). Exit 0 khi pass, exit 1 với diagnostic khi fail. Dùng cho CI gate trước release + manual smoke.
- **Regression test — `logoutAll` preserves `passwordVersion`** (PR #155): integration test trong `apps/api/src/modules/auth/auth.service.test.ts` lock-in documented behavior (M9).

### Docs

- **`docs/PRIVACY.md` + `docs/TOS.md`** closed-beta tester agreement (PR #151): data retention (account / login logs / chat 30d / currency ledger / item ledger / topup history), delete-my-data flow, analytics scope, 3rd-party services (chỉ Postgres/Redis); closed-beta tester TOS (scope "beta thử nghiệm", no payment, account revocable, no harassment, report-bugs SLA best-effort, liability limited, data backup).
- **`docs/SECURITY.md §1 Authentication`** (PR #154): thêm bullet document behavior `POST /api/_auth/logout-all` revoke refresh tokens nhưng KHÔNG bump `passwordVersion` → access tokens 15-phút TTL vẫn valid trên device khác cho tới khi hết hạn. Force-kill ngay phải đổi password hoặc bump `JWT_ACCESS_SECRET` (backlog M9 close-out).
- **`docs/QA_CHECKLIST.md §9`** thêm hướng dẫn chạy `pnpm smoke:beta` cho QA.
- **`docs/AI_HANDOFF_REPORT.md`** audit refresh kickoff session 9k (PR #149): bump snapshot `2ed8c29 → e342513`, mark PR #134..#148 tất cả Merged, sync baseline web `302 → 466` (35 → 50 file) + shared `55 → 96` (3 → 6 file), sửa PR #136 status (merged stale branch, replay qua #138).

### Internal

- Loop autonomous session 9k hoàn tất 7/7 PR merge cascade vào main mà không cần user confirmation cho mỗi task (task A→G).

---

## [session 9j — PR #134 → #148, merged 30/4 07:20→08:55 UTC]

### Fixed

- **Critical typecheck fix C-TSNARROW-RESOLVEFN** (PR #134): vue-tsc 2.0+ (TS 5.x) narrow `let` variable capture-by-closure thành `never` trong Promise executor. Fix: đổi `resolveHolder: { current }` object-property pattern. Unblock toàn bộ typecheck pipeline.

### Internal

- **Massive view test coverage push** (PR #135 → #148): 15 PR autonomous loop thêm vitest cho mọi view + shared catalog integrity. Web baseline `207 → 466` (30 → 50 file). Chi tiết:
  - TopupView 10 + MailView 14 vitest (PR #135)
  - ShopView 19 vitest (PR #137)
  - InventoryView 15 vitest (PR #138, replay from stale-base PR #136)
  - AuthView 14 vitest (PR #139)
  - OnboardingView 16 vitest (PR #140)
  - DungeonView 13 vitest (PR #141)
  - SectView 12 vitest (PR #142)
  - NotFoundView + router manifest lockdown 8 vitest (PR #143)
  - BossView 12 vitest (PR #144)
  - ChatPanel + LocaleSwitcher 17 vitest (PR #145)
  - MButton + MToast UI primitive 14 vitest (PR #146)
  - Shared shop + topup catalog integrity 19 vitest (PR #147)
  - Shared BOSSES catalog integrity 22 vitest (PR #148)

---

## [session 9i — PR #119 → #133, merged 30/4 06:21→07:50 UTC]

### Added

- **`docs/RELEASE_NOTES.md` bootstrap** (PR #120): closed beta press kit — feature list, known issues, roadmap lộ trình.
- **Smart admin giftcode active badge** (PR #121): `countActiveUnused()` helper + AdminView nav badge cyan-500 cho active giftcodes. +7 vitest.
- **Smart UX — toast duration policy by severity** (PR #122): `resolveToastDuration()` + `TOAST_DURATION_MS` policy (info 3s / success 3.5s / warning 5s / error 6s). +9 vitest.
- **Admin user export CSV** (PR #123): `GET /admin/users.csv` RFC 4180 format + audit `user.exportCsv` + FE download button. +15 vitest.
- **Smart admin giftcode revoke UI flow** (PR #127 + #129): `computeGiftcodeRevokeImpact()` + ConfirmModal danger style (impact preview: usage/expiry/warning) + error mapping. +12 vitest + 5 i18n key.
- **`extractApiErrorCode` pure error extractor** (PR #128): centralized error code extraction từ mọi error shape (direct/axios/ES2022 cause/legacy). +17 vitest. Adopted trong AdminView + AuthView (PR #133 migration 14 view còn lại).

### Internal

- **HomeView smoke tests** (PR #124): 9 vitest cover onMounted routing branches + render + cultivate/breakthrough. Web baseline `207 → 236`.
- **AppShell skeleton tests** (PR #126): 15 vitest cover mobile nav toggle + sidebar badges + staff-only/cultivating/WS/logout.
- **GiftCodeView tests** (PR #131): render + redeem flow + error mapping vitest.
- **ProfileView tests** (PR #132): render + fetch + error + badges vitest.
- **Adopt `extractApiErrorCode`** (PR #133): migration refactor 14 view để dùng centralized error extractor.

---

## [session 9h — PR #111 → #118, merged 30/4 04:25→06:18 UTC]

### Added

- **Admin audit-ledger endpoint + UI** (PR #112): `GET /admin/economy/audit-ledger` on-demand verify CurrencyLedger consistency. `ledger-audit.ts` pure logic + AdminView panel violet-500. +6 BE vitest + 3 FE vitest.
- **Playwright golden expand** (PR #113): +95 line daily login + leaderboard tabs gated `E2E_FULL=1`. `docs/QA_CHECKLIST.md` how-to thêm.
- **Smart onboarding expand 4→6 step** (PR #114): Leaderboard + Mail visit tracking localStorage helper + `OnboardingChecklist.vue` 6 step. +6 vitest.
- **Smart admin economy report — top 10 whales + circulation** (PR #115): `GET /admin/economy/report` 5 stat cards + top whales table. +6 BE + 3 FE vitest + 13 i18n key.
- **Smart admin users filter expand** (PR #116): currency range + realmKey filter cho `GET /admin/users`. +5 BE + 5 FE vitest + 6 i18n key.
- **Smart admin recent activity widget** (PR #117): Stats tab inline last 5 audit entries panel violet-500. +9 i18n key.
- **Smart admin pending topup badge** (PR #118): `pendingTopupCount` ref + 60s poll + badge amber-500 nav "Nạp Tiên Ngọc". +1 i18n key.

### Docs

- Audit refresh session 9h (PR #111).

---

## [session 9g — PR #105 → #110, merged 29/4 19:00→19:55 UTC]

### Added

- **FE Admin Inventory Revoke UI** (PR #106): nút "Thu hồi item" + modal AdminView Users tab + `adminRevokeInventory()` helper. +7 vitest + i18n vi/en.
- **Smart UX — sidebar breakthrough indicator + i18n parity guard** (PR #107): violet-400 dot khi sắp đột phá + 6 vitest enforce vi/en symmetric + ICU placeholder parity. Web vitest `168 → 174`.
- **Smart admin economy alerts badge** (PR #109): `countEconomyAlerts` helper + red dot badge nav Stats + auto-poll 60s. +13 vitest. Web vitest `174 → 187`.

### Fixed

- **`.env.example` SMTP_FROM quote fix** (PR #110): sửa syntax quote trong file env mẫu.

### Docs

- **Runtime smoke report session 9d→9g** (PR #108): 41 endpoint flow verified, 0 Critical/High bugs. Evidence in `docs/RUNTIME_SMOKE_9G.md`.
- Audit refresh session 9g (PR #105).

---

## [session 9f — PR #98 → #103, merged 29/4 17:18→18:50 UTC]

### Added

- **Self-service forgot/reset password** (PR #101 BE + PR #102 FE, merged @ `6f3faf4`): user có thể tự đặt lại mật khẩu qua email link 30 phút thay vì phải nhờ admin DB. Anti-spam rate-limit 3 yêu cầu/IP/15 phút. Email transactional gửi qua SMTP (dev: Mailhog `localhost:1025/8025`, prod: SMTP thật) hoặc fallback console log nếu chưa cấu hình. Reset thành công sẽ tự revoke mọi phiên đăng nhập của user (bump `passwordVersion` + revoke refresh tokens).
- **Trang FE mới**: `/auth/forgot-password` + `/auth/reset-password` (public, không cần đăng nhập). Tab Login có link "Quên huyền pháp?". Devloper-mode panel hiển thị token cho non-prod để E2E test mà không cần Mailhog UI.
- **Bảng xếp hạng đa tab** (PR #99): tab "Sức Mạnh" (giữ nguyên), thêm tab "Nạp Top" (xếp theo tổng tiên ngọc nạp APPROVED) và tab "Tông Môn" (xếp theo treasury linh thạch + level + tuổi). Lazy-fetch theo tab.

### Security

- Forgot-password endpoint **silent ok cho mọi email** (kể cả không tồn tại) → chống user enumeration.
- **Token format `<id>.<secret>`** (PR #101 in-flight Devin Review fix r3163113344): plaintext token gồm `tokenId.secret` — `tokenId` là PK row (non-secret), `secret` là 32-byte base64url. DB lookup O(1) bằng `findUnique({ id: tokenId })` thay vì scan loop (chống DOS by token-flood).
- **Timing parity** (PR #103 post-merge Devin Review fix r3163261711): nhánh `forgotPassword` cho user-không-tồn-tại/banned thêm `argon2.hash` giả ~100ms để response time tương đương path-có-user → chống enum bằng đo network latency.
- Token reset là plaintext 32-byte URL-safe random; DB chỉ lưu argon2id hash của `secret`. One-shot consume; reset thành công revoke mọi token reset khác của user.

### Changed

- **Admin self-protection** (PR #100): admin/mod không thể tự hạ vai trò của chính mình hoặc tự ban chính mình ở trang `/admin`. UI disable nút + badge "Bạn", BE lock-in qua check `actor.id === target.id`. Loại trừ rủi ro lockout vô tình.

### Docs

- (PR #98) Audit refresh `AI_HANDOFF_REPORT.md`: mark PR #92→#97 đã merged, bump snapshot commit, thêm session 9f roadmap A-D.
- (PR #104) Bootstrap `docs/CHANGELOG.md` (file này) — Keep-a-Changelog format adapted closed-beta.

---

## [session 9e — PR #92 → #97, merged 29/4 16:00→17:18 UTC]

### Added

- **Backup/restore script Postgres** (PR #95 + PR #96): `pnpm backup:db` (custom format gzipped) + `pnpm restore:db` (drop-recreate-restore). Verify bằng `pg_restore --list` SIGPIPE-safe. `pg_terminate_backend` trước DROP. Doc `BACKUP_RESTORE.md` (TL;DR + cron mẫu + disaster recovery checklist).
- **Leaderboard topup + sect endpoints** BE (PR #94): `GET /api/leaderboard/topup` + `GET /api/leaderboard/sect` (BE only, FE consume ở PR #99).

### Changed

- **Mobile responsive iPhone SE 375×667** (PR #97): AppShell sidebar chuyển thành drawer overlay khi `md:hidden`, hamburger toggle, watch route auto-close. AdminView 4 table wrap `overflow-x-auto`.

### Docs

- (PR #92) BETA_CHECKLIST refresh; (PR #93) Audit refresh session 9e.

---

## [session 9d — PR #80 → #91, merged 29/4 10:25→14:55 UTC]

### Added

- **Daily login reward** (PR #80): `DailyLoginCard` ở Home, `RewardClaimLog`-backed idempotent claim; +100 LT + streak count.
- **Admin giftcode FE panel** (PR #81): `/admin` giftcode tab với filter q/status, create + revoke (audit logged).
- **`/activity` — sổ hoạt động** (PR #88 BE + PR #91 FE): user xem `CurrencyLedger` + `ItemLedger` của bản thân với keyset pagination, tab switch currency/item, reason i18n đầy đủ. API `GET /logs/me?type=...&limit=...&cursor=...`.
- **Proverbs corpus mở rộng** (PR #87): màn hình tải mở rộng từ 7 → 64 câu chia 4 chủ đề.
- **Logout-all confirm modal** (PR #83 + PR #85): thay `window.confirm()` bằng modal `ConfirmModal` reusable.

### Fixed

- **Giftcode duplicate code** (PR #84): trả error `CODE_EXISTS` thay vì 500.

### Docs

- (PR #89) `API.md` refresh; (PR #90) `QA_CHECKLIST.md` + `ADMIN_GUIDE.md` + `TROUBLESHOOTING.md` refresh; (PR #86) Audit refresh session 9d.

---

## [Earlier — PR #33 → #79]

> Chi tiết theo PR có trong `docs/AI_HANDOFF_REPORT.md` mục "Recent Changes". Highlight chính:

### Foundation (PR #33 → #45)

- **Bootstrap admin/sect seed** (PR #33), **InventoryService 19 vitest** (PR #34), **Boss admin spawn** (PR #36), **Settings page (đổi password + logout-all)** (PR #37), **Profile page** (PR #38), **Shop page (NPC 11 entry, LT only)** (PR #39), **`ItemLedger` audit table** (PR #40), **Mission reset timezone `Asia/Ho_Chi_Minh`** (PR #42), **Currency/Item ledger actor index** (PR #43).

### Frontend hardening (PR #46 → #59)

- Vitest scaffold (PR #47/#53), Vue tests cho store/auth/toast/badges/NextActionPanel/OnboardingChecklist/itemName/Leaderboard (PR #55→#59).

### Stability + ops (PR #60 → #79)

- Register rate-limit 5/IP/15min (PR #60), Profile rate-limit 120/IP/15min (PR #62), WS `mission:progress` push (PR #63 + #65), Playwright e2e-smoke CI matrix (PR #64), Admin inventory revoke + `ADMIN_REVOKE` ledger (PR #66), Skeleton loaders (PR #67/#68/#77), Market fee env var (PR #69), Admin guard ADMIN-only decorator (PR M8), Mobile responsive AppShell partial (PR #74-77).

---

## Format guideline cho future PR

Khi merge PR, **tự bổ sung 1 dòng** vào section "Unreleased" tương ứng:

```markdown
- **<Tên feature người dùng-facing>** (PR #N): <1 câu mô tả tác động cho user/admin>.
```

Nếu PR thuần internal (refactor/test/CI/docs nhỏ) → ghi vào **Internal** thay vì Added/Changed.

Khi đóng release / milestone → di chuyển nguyên section "Unreleased" thành section có ngày + label session, mở section "Unreleased" mới ở trên cùng.
