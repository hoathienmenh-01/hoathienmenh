# Phase 26.5 — World Content V2 / Farm Maps, Dungeons, Bosses, Sect Content & Trial Towers — Plan

> Tài liệu nội bộ phase. Trạng thái sống cuối cùng nằm trong `docs/AI_HANDOFF_REPORT.md`.

## Mục tiêu

Xây dựng lớp **PvE content dài hạn** cho game tu tiên dạng text: farm map theo khu vực/cảnh giới, auto farm theo thời gian, taxonomy quái mở rộng (NORMAL/ELITE/MINI_BOSS/REGION_BOSS/...), cơ duyên ngẫu nhiên, dungeon V2 chuyên biệt nguyên liệu, boss V2 (region/hourly/world/event/quest/dungeon/sect/hidden/trial), sect content (sect dungeon + sect boss), 3 Trial Tower (Đăng Tiên / Linh Khí / Huyết Thể) sinh tầng vô tận theo formula, world content summary helper, và đầy đủ reward/cap chống lạm phát + chống P2W.

## Phạm vi (in scope)

### Shared (`packages/shared/src/`)

- `farm-maps.ts` — `FarmMapDef`, `FarmMapMonsterEntry`, `FarmSessionResult`, helpers `getFarmMapsByRegion` / `canEnterFarmMap` / `getFarmSessionLimit`.
- `world-dungeons-v2.ts` — `DungeonCategory` (ALCHEMY_MATERIAL / BODY_MATERIAL / METHOD_FRAGMENT / ARTIFACT_MATERIAL / EQUIPMENT_MATERIAL / QI_BREAKTHROUGH / BODY_BREAKTHROUGH / TRIBULATION / STORY / SIDE_QUEST / SECT / EVENT / TOWER / GENERAL), `DungeonV2Def`, helpers.
- `world-bosses-v2.ts` — `BossCategory` (REGION_BOSS / HOURLY_BOSS / WORLD_BOSS / EVENT_BOSS / MAIN_QUEST_BOSS / SIDE_QUEST_BOSS / DUNGEON_BOSS / SECT_BOSS / HIDDEN_BOSS / TRIAL_BOSS), `BossV2Def`, helpers + seed.
- `sect-content.ts` — `SectDungeonDef`, `SectBossDef`, helpers.
- `trial-towers.ts` — `TrialTowerKey` (`DANG_TIEN_THAP` / `LINH_KHI_THAP` / `HUYET_THE_THAP`), `TrialTowerDef`, `TrialFloorReward`, formula `generateFloor(towerKey, floor)` + milestone multipliers + reward formula.
- `opportunities.ts` — `OpportunityEncounterDef`, `OpportunityChoiceDef`, `OpportunityRewardEntry`, daily/weekly cap rules.
- `monster-taxonomy.ts` — `MonsterFamily` (YEU_THU / TA_TU / MA_TU / KHOI_LOI / LINH_THE / QUY_VAT / CO_THU / THU_VE_BI_CANH / DICH_TONG_MON / THIEN_KIEP / TAM_MA / DAO_ANH), extended `MonsterTypeV2`, helpers (drop hint per family).
- `world-content-summary.ts` — `getWorldContentSummary()` trả `totalRegions / totalFarmMaps / totalDungeons / totalStoryDungeons / totalSectDungeons / totalTrialTowers / totalBosses / totalWorldBosses / totalEventBosses / totalSectBosses / totalQuestBosses / totalMonsters / totalEliteMonsters / contentByRegion[]`.

### API (`apps/api/src/modules/world-content/`)

- `world-content.module.ts` — Nest module gom các service mới.
- `farm.service.ts` — start/claim farm session, encounter resolve, daily/weekly cap enforce.
- `dungeon-v2.service.ts` — list / start / claim dungeon V2 (catalog-only read trong phase này; reuse `DungeonRun` cho expedition runtime).
- `boss-v2.service.ts` — list/preview/spawn schedule logic (catalog-only; reuse `WorldBoss` runtime).
- `sect-content.service.ts` — list sect dungeon / sect boss + member daily cap.
- `trial-tower.service.ts` — get progress / generateFloorPreview / attemptFloor / claimMilestone, server-authoritative qua `TrialTowerProgress` + `TrialTowerAttemptLog`.
- `world-content.controller.ts` — gom endpoint `/world/*`.

### Prisma (`apps/api/prisma/`)

Additive migration mới (không alter table có data thật):

- `FarmSession` — characterId / farmMapKey / startedAt / endedAt / minutesProcessed / status / rewardsJson / encountersJson.
- `FarmEncounter` — characterId / farmSessionId / encounterKey / encounterType / status / expiresAt / rewardPreviewJson / resolvedAt.
- `DailyContentCap` — characterId / capKey / source / date / usedCount / usedQty (extends existing `DailyMaterialCap` namespace, không conflict).
- `WeeklyContentCap` — characterId / capKey / source / weekKey / usedCount / usedQty.
- `TrialTowerProgress` — characterId / towerKey / highestFloorCleared / seasonHighestFloor / claimedMilestonesJson.
- `TrialTowerAttemptLog` — characterId / towerKey / floor / success / battlePowerSnapshotJson / clearTimeSeconds / rewardJson.
- `SectBossAttemptLog` — sectId / characterId / bossKey / damage / rewardJson.

### Web (`apps/web/src/`)

- `views/WorldContentView.vue` — summary dashboard (đếm map/boss/dungeon/tower theo region).
- `views/FarmMapView.vue` — list farm map theo region + start session + claim + encounter resolve.
- `views/DungeonHubV2View.vue` — list dungeon V2 theo category + sourceTier filter + preview.
- `views/BossHubView.vue` — list boss V2 theo category + schedule + reward preview.
- `views/SectContentView.vue` — sect dungeon + sect boss tab.
- `views/TrialTowerView.vue` — 3 tower tab + floor preview + attempt + milestone claim + ranking placeholder.
- `api/worldContent.ts` — typed client.
- `stores/worldContent.ts` — Pinia store.
- `router/index.ts` — thêm 6 route.
- `i18n/vi.json` + `i18n/en.json` — bổ sung key.

### Tests

- Shared: `farm-maps.test.ts`, `world-dungeons-v2.test.ts`, `world-bosses-v2.test.ts`, `sect-content.test.ts`, `trial-towers.test.ts`, `opportunities.test.ts`, `monster-taxonomy.test.ts`, `world-content-summary.test.ts` — catalog invariants, cap monotonicity, formula determinism, cross-ref (regionKey/monsterKey/itemKey orphan-free), reward bounds.
- API service tests (Postgres integration): farm session lifecycle, encounter manual vs auto, cap enforce, trial tower attempt + milestone idempotency, sect boss attempt log.
- Web tests: render `FarmMapView` / `DungeonHubV2View` / `BossHubView` / `SectContentView` / `TrialTowerView` / `WorldContentView` loading/empty/error/list.

### Docs

- `docs/phase-26-5-world-content-v2-plan.md` — file này.
- `docs/AI_HANDOFF_REPORT.md` — Executive Summary + Recent Changes block 1 cho phase 26.5.
- `docs/API.md` — endpoints mới.
- `docs/BALANCE_MODEL.md` — section Trial Tower formula + Farm session limit + daily/weekly cap.
- `docs/ECONOMY_MODEL.md` — section World Content reward source + cap matrix + anti-P2W.
- `docs/CONTENT_PIPELINE.md` — region content target + auto-gen approach.

## Phạm vi (out of scope)

- KHÔNG xoá / rewrite hệ `MONSTERS` / `DUNGEONS` / `BOSSES` cũ — V2 sống song song, V1 vẫn dùng cho story chain + legacy farm.
- KHÔNG đụng monetization / payment / subscription thật. `getFarmSessionLimit(character, entitlements)` chỉ hook tham chiếu `MonthlyCardSubscription` / `VipProfile` đã có; KHÔNG tạo SKU mới, KHÔNG cho bỏ cap.
- KHÔNG seed đủ 9 khu cùng độ sâu — phase 26.5 seed sâu 3 khu (Sơn Cốc / Hắc Lâm / Kim Sơn Mạch) + 6 khu còn lại có ít nhất 1 farm map + 1 region boss + 1 dungeon đại diện qua catalog (không placeholder rỗng).
- KHÔNG mở Battle Pass / Season ranking thật trong PR này — Trial Tower có `seasonHighestFloor` field forward-compat nhưng season reward grant dời sang phase sau.
- KHÔNG mở World Boss runtime mới (Coop Boss đã có) — chỉ thêm `BossV2Def` metadata + schedule preview; runtime reuse existing.
- KHÔNG tạo PvP / arena content mới.

## Kiến trúc cao cấp

```
shared/monster-taxonomy.ts ─┐
                             ├─► farm-maps.ts ────► world-content-summary.ts
                             ├─► world-dungeons-v2.ts ────┐
                             ├─► world-bosses-v2.ts ──────┤
                             ├─► sect-content.ts ─────────┤
                             ├─► trial-towers.ts ─────────┘
                             └─► opportunities.ts

Drop Economy V2 (existing) ── used by all reward grant paths

API world-content module ──► reuses CurrencyService / InventoryService /
                              DungeonRunService / WorldBossService /
                              DropEconomyService / DailyMaterialCap

Web /world/* routes ──► world-content.controller endpoints
```

## Anti-P2W invariants

1. **sourceTier không scale theo player**: `effectiveDropTier = min(playerTier, sourceTier)` — farm map thấp KHÔNG biến thành mỏ endgame.
2. **Auto farm không đánh quái nguy hiểm**: auto chỉ pick monster `type=NORMAL` + `dangerLevel ≤ SAFE` + `realmTier ≤ playerTier`. Elite / Mini-Boss / Boss / Quest boss đều phải manual.
3. **Premium bán tiện lợi, không bán tài nguyên**: monthly card / VIP tăng `sessionMinutes` nhưng KHÔNG bỏ daily/weekly cap, KHÔNG bỏ stamina cap, KHÔNG bỏ rare drop cap.
4. **First-clear reward chỉ 1 lần** cho story dungeon / trial tower floor / trial milestone — re-run reward = nhỏ hoặc 0.
5. **Trial Tower formula monotonic**: floorPower / floorReward / milestoneMultiplier đều monotonic non-decreasing theo floor. Test enforce.
6. **Opportunity cap**: cơ duyên thường ≤ 5/ngày, hiếm ≤ 1/ngày hoặc ≤ 1/tuần. Reward không drop pháp bảo top / công pháp chí tôn / đan vân endgame số lượng lớn.
7. **Sect content cap**: sect dungeon dailyAttemptsPerMember, sect boss weeklyAttempts, sect boss reward không nặng linh thạch / tiên ngọc / pháp bảo hiếm.
8. **Trial currency (TrialPoint) shop có weekly limit**: KHÔNG đổi vô hạn.

## Trial Tower formula

```
floorPower(tower, floor) = basePower(tower) * 1.18^(floor-1) * milestoneMultiplier(floor)
basePower:
  DANG_TIEN_THAP  = 200
  LINH_KHI_THAP   = 180
  HUYET_THE_THAP  = 220

milestoneMultiplier(floor):
  floor % 1000 == 0  → 6.00
  floor % 500  == 0  → 4.00
  floor % 100  == 0  → 2.50
  floor % 50   == 0  → 1.75
  floor % 10   == 0  → 1.25
  else               → 1.00

floorReward.linhThach(floor) = round(50 * 1.12^(floor-1) * milestoneMultiplier(floor))
floorReward.tienNgoc(floor)  = floor % 100 == 0 ? round(2 * milestoneMultiplier(floor)) : 0
floorReward.trialPoint(floor)= round(5 + floor * 0.5)  (* milestoneMultiplier on milestone floors)
floorReward.itemDrop(floor)  = derived from sourceTier(floor)
```

**Tower test enforce**: monotonic floorPower, monotonic floorReward.linhThach (non-decreasing on non-milestone), milestoneMultiplier rule, floor 1..10000 không NaN / Infinity.

## Region content target (per region)

| Loại | Target | PR 26.5 (3 khu sâu) | PR 26.5 (6 khu còn lại) | Mở rộng phase sau |
|---|---|---|---|---|
| Farm map | 3 | 3 / region | 1 / region | +2 / region |
| Dungeon farm | 2 | 2 / region | 1 / region | +1 / region |
| Story dungeon | 1 (nếu có chương) | reuse existing | reuse | — |
| Region boss | 1 | 1 / region | 1 / region | — |
| Mini boss / Tinh anh boss | 1 | 1 / region | 0–1 | +1 |
| Hidden boss / Quest boss | 1 | 1 / region | 0 | +1 / region |
| Monster thường | 6–10 | 6–10 (reuse + add) | reuse existing | — |
| Monster tinh anh | 2–4 | 2–4 | reuse | — |
| Cơ duyên | 3–5 | 3–5 / region | 1–2 / region | +2 / region |

3 khu seed sâu: `son_coc` (Luyện Khí), `hac_lam` (Trúc Cơ), `kim_son_mach` (Kim Đan).

## Auto farm rule (server-authoritative)

```
canAutoBattle(monster, player) =
  monster.monsterType === 'NORMAL'
  && monster.realmTier <= player.realmTier
  && (monster.dangerLevel ?? 'SAFE') <= 'SAFE'
```

ELITE / MINI_BOSS / REGION_BOSS / DUNGEON_BOSS / WORLD_BOSS / EVENT_BOSS / QUEST_BOSS / SIDE_QUEST_BOSS / SECT_BOSS / HIDDEN_BOSS / TOWER_GUARDIAN → tạo `FarmEncounter` manual với rewardPreview + riskPreview. Hết phiên free (60'/480'/720' tuỳ entitlement) → status=`PENDING_RESUME`, player phải bấm `Tiếp tục farm` để mở phiên mới.

## Reward cap matrix (tổng hợp)

| Cap | Scope | Key | Default |
|---|---|---|---|
| dailyMaterialCap | per character | `material:${tier}:${category}` | tham chiếu `MATERIAL_CATEGORY_MULTIPLIER` |
| dailyFarmSessionMinutes | per character | `farm_minutes` | 60 free / 480 monthlyCard / 720 vip |
| dailyOpportunityCommon | per character | `opportunity_common:${region}` | 5 |
| dailyOpportunityRare | per character | `opportunity_rare:${region}` | 1 |
| dailyDungeonAttempt | per character per dungeon | `dungeon:${dungeonKey}` | `dungeon.dailyAttempts` |
| weeklyWorldBoss | per character | `world_boss:${bossKey}` | 3 |
| weeklyEventBoss | per character | `event_boss:${bossKey}` | 5 |
| dailySectDungeonAttempt | per character per sect dungeon | `sect_dungeon:${key}` | `sectDungeon.dailyAttemptsPerMember` |
| weeklySectBoss | per character per sect boss | `sect_boss:${key}` | 2 |
| towerFloorFirstClear | per character per tower per floor | `tower:${tower}:${floor}` | 1 (unique) |
| towerMilestone | per character per tower per milestone | `tower:${tower}:milestone:${floor}` | 1 (unique) |
| trialPointShop | per character per item | `trial_shop:${itemKey}` | weekly per item limit |

## Rollback

🟡 medium-high — additive migration (7 model mới), không alter table có data. Rollback = revert PR, drop migration `20270101000000_phase_26_5_world_content_v2`. Hệ V1 (`MONSTERS` / `DUNGEONS` / `BOSSES` / `STORY_DUNGEONS` / `CoopBoss`) không bị đụng. Web route mới tách riêng, không phá UI cũ.

## Test scope

- `pnpm --filter @xuantoi/shared test` — shared catalog + helper invariants (mục tiêu: +120 test cho phase 26.5).
- `pnpm --filter @xuantoi/api test` — service Postgres integration (mục tiêu: +35 test).
- `pnpm --filter @xuantoi/web test` — render test 6 view mới (mục tiêu: +30 test).
- `pnpm --filter @xuantoi/web e2e` — smoke `/world/farm` + `/world/towers` golden path.
- `pnpm typecheck` + `pnpm lint` + `pnpm build` toàn workspace.

## PR delivery plan (cụm commit)

1. Plan doc + branch + Draft PR (commit này).
2. Shared: `monster-taxonomy.ts` + `farm-maps.ts` + tests.
3. Shared: `world-dungeons-v2.ts` + `world-bosses-v2.ts` + tests.
4. Shared: `sect-content.ts` + `opportunities.ts` + tests.
5. Shared: `trial-towers.ts` + `world-content-summary.ts` + tests.
6. Prisma migration + schema diff.
7. API services + controller + tests.
8. Web views + i18n + stores + tests.
9. Docs sync (AI_HANDOFF_REPORT, API, BALANCE_MODEL, ECONOMY_MODEL, CONTENT_PIPELINE).
10. Lint/typecheck/build pass + Ready for Review.
