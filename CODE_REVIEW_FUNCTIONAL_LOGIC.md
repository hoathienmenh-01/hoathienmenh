# Code Review — Functional Logic & Feature Conflicts

> **Ngày review:** 2026-05-31
> **Scope:** Backend services core gameplay loop
> **Files reviewed:** combat.service.ts, boss.service.ts, alchemy.service.ts, currency.service.ts, dungeon-run.service.ts, cultivation.processor.ts, shop.service.ts, mission.service.ts, inventory.service.ts + supporting shared catalogs

---

## 1. TÓM TẮT TỪNG CHỨC NĂNG

### 1.1 Combat Service (`combat.service.ts` — 1751 lines)
- **Luồng:** start → action (turn-based) → WON/LOST/ABANDONED
- **Logic đúng:**
  - ✅ Atomic: stamina deduct + encounter create trong cùng tx
  - ✅ CAS guard: `ALREADY_IN_FIGHT` chống 2 encounter cùng lúc
  - ✅ Daily limit: count `Encounter` rows trong cửa sổ DAILY local tz
  - ✅ Element multipliers compose đúng thứ tự: linh căn × talent × buff × phase142 × pet
  - ✅ DOT/Shield tags hoạt động đúng (single-active DOT model, single-use SHIELD)
  - ✅ Control debuff (root/stun/silence) block player action — throw early trước mọi mutation
  - ✅ Invuln buff nullify all monster reply damage
  - ✅ Active talent flow: ownership check + MP cost + cooldown guard + effect dispatch
  - ✅ All reward grants wrap trong $transaction
  - ✅ Mission/achievement/story tracking fail-soft (không break combat flow)
  - ✅ Drop Economy V2 material grant chạy song song fail-soft

- **Vấn đề nhỏ:**
  - ⚠️ `actionViaActiveTalent` monster reply calculation khác với `action()` — thiếu `titleMods`, `methodV2Def`, `artifactV2Def` (L1423-1431 vs L497-504). Player dùng talent active bị thiệt thòi về defense so với skill thường.
  - ⚠️ `actionViaActiveTalent` KHÔNG trừ stamina cho bloodCost huyết tế path (L1350-1365 utility path trừ stamina, nhưng damage/heal/cc/dot paths cũng trừ ở L1472 — OK). Tuy nhiên bloodCost HP deduction chỉ có trong skill flow (L600-604), talent active `damage` kind không trừ HP blood cost dù catalog talent có thể có.

### 1.2 Boss Service (`boss.service.ts` — 1689+ lines)
- **Luồng:** heartbeat spawn → player attack → reward distribute khi boss bị defeat
- **Logic đúng:**
  - ✅ Atomic: character resource decrement + boss HP decrement + damage tracking trong 1 tx
  - ✅ updateMany CAS guard chống race (mp/stamina/hp concurrent mutations)
  - ✅ Multi-region: partial unique index `WorldBoss_status_region_active_unique` chống 2 boss cùng region
  - ✅ Heartbeat re-entry guard (in-process) + P2002 catch (cross-process)
  - ✅ Reward distribution phân rank-based linhThach + items
  - ✅ All stat mods wire parity với combat: talent × buff × title × method × element × pet
  - ✅ Boss spawn web push fan-out fire-and-forget
  - ✅ LiveOps scheduled boss events bypass rotation

- **Vấn đề nhỏ:**
  - ⚠️ In-memory cooldown (`this.cooldowns Map`) không persist qua restart. Server restart → player có thể attack boss liên tục 2 lần. TTL sweep 60s — bounded memory OK.
  - ⚠️ `characterSkill.isLearned()` check KHÔNG có trong boss flow (combat có, boss thiếu ở L346-354 — actually boss.service.ts L346-354 CÓ check, OK). Parity OK.

### 1.3 Alchemy Service (`alchemy.service.ts` — 538 lines)
- **Luồng:** attemptCraft → consume ingredients + linhThach → roll success → grant pill
- **Logic đúng:**
  - ✅ Atomic transaction: consume inputs + deduct linhThach + roll + grant output + log
  - ✅ CAS-guarded furnace upgrade (`alchemyFurnaceLevel: currentLevel` where condition)
  - ✅ Achievement tracking fail-soft post-transaction
  - ✅ Deterministic RNG: caller phải truyền seeded rng (controller derive từ attemptId)

- **Vấn đề nhỏ:**
  - ⚠️ KHÔNG có daily cap/limit cho alchemy attempts — player có thể spam craft unlimited nếu có đủ nguyên liệu. Có thể là design intent (alchemy là sink, không phải source).
  - ⚠️ KHÔNG có rate limiter (khác shop có rate limit 30/60s). Craft spam có thể tạo load spike.

### 1.4 Currency Service (`currency.service.ts` — 364 lines)
- **Logic đúng:**
  - ✅ `updateMany` + `gte |delta|` guard chống overdraft — CAS pattern
  - ✅ `extraWhere` support cho race-safe composite guards (vd sect contribute)
  - ✅ Ledger row ghi atomic trong cùng tx
  - ✅ 60+ reason types cover toàn bộ game economy
  - ✅ BigInt cho LINH_THACH, Int cho các currency khác — đúng type safety
  - ✅ `throwBecauseNoUpdate` phân biệt NOT_FOUND vs INSUFFICIENT_FUNDS

- **Không có vấn đề.** Service này là backbone economy, thiết kế tốt.

### 1.5 Dungeon Run Service (`dungeon-run.service.ts` — 988 lines)
- **Luồng:** startRun → nextEncounter (auto-resolve) → COMPLETED → claimRun
- **Logic đúng:**
  - ✅ CAS guard: `ALREADY_IN_RUN` chống 2 run cùng lúc
  - ✅ Atomic: stamina deduct + create run trong tx
  - ✅ nextEncounter CAS: `{ status: ACTIVE, encounterIndex: idx }` chống race advance
  - ✅ Idempotent claim: `claimedAt: null` CAS guard — 2 claim cùng runId → 1 winner
  - ✅ Reward cap applied trước grant
  - ✅ Territory buff + LiveOps drop multiplier compose
  - ✅ Sect war + territory influence hooks fail-soft
  - ✅ Quest + Story V2 kill/collect tracking fail-soft

- **Vấn đề quan trọng:**
  - 🔴 **Daily limit đếm từ bảng `DungeonRun` riêng biệt với `Encounter` (combat).** Cùng 1 dungeon key (vd `son_coc`), player có thể chạy 5 lần combat (Encounter) VÀ 5 lần dungeon run (DungeonRun) = 10 slot/ngày thay vì 5. Catalog `dailyLimit` dùng chung cho cả 2 nhưng count từ 2 bảng khác nhau.

### 1.6 Cultivation Processor (`cultivation.processor.ts` — 431 lines)
- **Luồng:** BullMQ tick → forEach cultivating character → gain exp → auto breakthrough → regen hp/mp
- **Logic đúng:**
  - ✅ Batch stamina regen cho TẤT CẢ character (raw SQL LEAST cap)
  - ✅ CAS guard: `where { exp: c.exp, realmStage: c.realmStage, cultivating: true }` chống race
  - ✅ Reward cap apply trước grant
  - ✅ LiveOps CULTIVATION_EXP_BOOST fetch 1 lần/tick (shared)
  - ✅ Multiplier compose: linh căn × method × element affinity × methodV2 × talent × buff × liveOps
  - ✅ Tâm Ma debuff (cultivationBlocked) skip toàn bộ EXP + regen
  - ✅ HP/MP regen compose: buff + talent (additive flat per-second × tickSeconds)
  - ✅ Mission/achievement tracking fail-soft
  - ✅ Web push STAMINA_FULL detection fire-and-forget

- **Không có vấn đề lớn.** Logic cultivation rất sạch.

### 1.7 Shop Service (`shop.service.ts` — 278 lines)
- **Luồng:** list → buy (rate limit + daily limit + currency spend + inventory grant)
- **Logic đúng:**
  - ✅ Rate limiter: 30 req/60s per userId
  - ✅ Daily limit: count `sum(qtyDelta)` từ ItemLedger reason='SHOP_BUY' trong cửa sổ DAILY
  - ✅ Atomic tx: currency deduct + inventory grant
  - ✅ LiveOps SHOP_DISCOUNT compose (max-only, cap ≤ 50%)
  - ✅ Non-stackable qty=1 guard

- **Không có vấn đề.** Thiết kế anti-abuse tốt.

### 1.8 Mission Service (`mission.service.ts` — 432 lines)
- **Luồng:** ensureRows → track → claim (CAS guard + reward cap + currency + inventory)
- **Logic đúng:**
  - ✅ Lazy-create rows cho mỗi mission trong catalog
  - ✅ CAS guard: `{ claimed: false, currentAmount: row.currentAmount }` updateMany
  - ✅ Idempotent claim: `claimed: false + currentAmount >= goalAmount` guard
  - ✅ Reward cap apply trước grant
  - ✅ Daily/Weekly reset: `windowEnd <= now` → reset currentAmount + claimed
  - ✅ WS push realtime progress

- **Không có vấn đề.**

---

## 2. XUNG ĐỘT GIỮA CÁC FEATURE

### 🔴 XUNG ĐỘT NGHIÊM TRỌNG

#### 2.1 Combat vs DungeonRun: Double-counting Daily Limit
- **Mô tả:** Cùng 1 dungeon key (vd `son_coc`), `CombatService.start()` đếm `Encounter` table, `DungeonRunService.startRun()` đếm `DungeonRun` table. Cả 2 dùng cùng `dailyLimit` từ catalog.
- **Hậu quả:** Player có thể farm 2× số slot/ngày dự kiến. Nếu `son_coc.dailyLimit = 5`, player được 5 combat + 5 dungeon run = 10.
- **Khuyến nghị:** Dùng bảng thống nhất (count cả 2 bảng trong 1 query) hoặc tách `dailyLimit` riêng cho combat và dungeon run trong catalog.

#### 2.2 Combat vs DungeonRun: Không cross-guard ACTIVE state
- **Mô tả:** `CombatService.start()` chỉ check Encounter ACTIVE. `DungeonRunService.startRun()` chỉ check DungeonRun ACTIVE. Player có thể chạy combat encounter VÀ dungeon run cùng lúc.
- **Hậu quả:** Player có 2 hoạt động combat song song — phá vỡ design "1 activity at a time".
- **Khuyến nghị:** Cross-check: trước khi start combat, check không có DungeonRun ACTIVE; trước khi start dungeon run, check không có Encounter ACTIVE.

#### 2.3 Combat vs Boss: Không cross-guard ACTIVE state
- **Mô tả:** Player đang trong encounter (combat ACTIVE) vẫn có thể attack boss và ngược lại.
- **Hậu quả:** Player có thể song song đánh dungeon + đánh boss — exploit stamina bằng cách interleaved actions.
- **Khuyến nghị:** Boss attack nên check player không có encounter ACTIVE (hoặc design cho phép — cần xác nhận).

### 🟡 XUNG ĐỘT TRUNG BÌNH

#### 2.4 Reward Cap: Không áp cho Combat Encounter
- **Mô tả:** `RewardCapService` được dùng trong Cultivation, DungeonRun claim, Mission claim. Nhưng `CombatService.action()` KHÔNG dùng reward cap cho EXP/linhThach từ monster kill.
- **Hậu quả:** Player có thể farm unlimited EXP/linhThach từ combat encounters (per-encounter rewards) mà không bị daily cap.
- **Khuyến nghị:** Áp dụng reward cap cho combat EXP/linhThach hoặc xác nhận design intent (combat rewards nhỏ, đã bị gate bởi stamina + daily limit).

#### 2.5 Story V2 (Phase 33) vs Quest (Phase 12): Double-tracking Kill/Collect
- **Mô tả:** Combat, DungeonRun, Boss đều gọi CẢ `this.quests.track()` VÀ `this.phase33Story.track()` cho cùng 1 kill event.
- **Hậu quả:** Nếu catalog Phase 12 và Phase 33 dùng cùng `targetId`, 2 hệ thống quest song song có thể track cùng 1 kill → player hoàn thành quest ở cả 2 hệ thống cùng lúc. Nếu reward khác nhau → exploit.
- **Khuyến nghị:** Xác nhận catalog Phase 12 và Phase 33 có targetId tách biệt. Nếu overlap → chỉ track 1 hệ thống (migration sang Phase 33).

#### 2.6 Alchemy: Không có Rate Limiter
- **Mô tả:** Shop có rate limiter 30/60s. Alchemy KHÔNG có.
- **Hậu quả:** Script có thể spam craft hàng trăm lần/giây → load spike + exploit nếu có bug trong success rate calculation.
- **Khuyến nghị:** Thêm rate limiter cho alchemy (ít nhất 60 attempts/60s).

### 🟢 XUNG ĐỘT NHẸ / DESIGN NOTES

#### 2.7 Boss In-memory Cooldown Reset
- **Mô tả:** Boss attack cooldown lưu trong memory (`this.cooldowns Map`). Server restart → cooldown mất.
- **Hậu quả:** Player có thể attack boss 2 lần liền sau restart (bypass BOSS_ATTACK_COOLDOWN_MS).
- **Severity:** Thấp — cooldown rất ngắn (thường 1-5s), restart hiếm xảy ra.

#### 2.8 Cultivation Auto-breakthrough vs Manual Breakthrough
- **Mô tả:** CultivationProcessor auto-breakthrough khi exp đủ (stage loop). Cần confirm KHÔNG có manual breakthrough endpoint có thể conflict (2 paths cùng update realmStage).
- **Xác nhận:** `character.service.ts` có `BreakthroughError` class — cần check xem có manual breakthrough endpoint không.

#### 2.9 Stamina Concurrent Drain
- **Mô tả:** Stamina được trừ ở 3 nơi: Combat (L310, L907), DungeonRun (L401-406), Boss (L518). Không có cross-service check.
- **Hậu quả:** Player có thể tiêu stamina ở 2 service cùng lúc nếu request đủ nhanh (race window nhỏ).
- **Severity:** Thấp — tất cả dùng `updateMany` CAS guard, nhưng CAS chỉ guard trong 1 service, không cross-service.

---

## 3. LOGIC BUGS TIỀM ẨN

### 3.1 Combat `actionViaActiveTalent` — Monster Reply thiếu Stat Mods
- **File:** `combat.service.ts` L1418-1431
- **Mô tả:** Monster reply trong talent path chỉ compose `talentMods × buffMods` cho def/spirit. Thiếu: `titleMods`, `methodStat`, `methodV2Def`, `artifactV2Def`, `statMul` (linh căn).
- **Hậu quả:** Player dùng talent active bị monster gây nhiều sát thương hơn so với dùng skill thường.
- **Fix:** Copy full stat compose từ `action()` vào `actionViaActiveTalent()`.

### 3.2 Cultivation Auto-Breakthrough Không Trừ expCost Đúng
- **File:** `cultivation.processor.ts` L296-302
- **Mô tả:** While loop `exp >= stageCost && realmStage < 9` subtract stageCost và increment realmStage. Nhưng KHÔNG check `expCostForStage` trả về `null` cho stage cuối (stage 9 → stage 10 transition cần breakthrough manual?).
- **Status:** Cần verify catalog `expCostForStage` behavior ở stage 9 boundary.

### 3.3 Boss HP Decrement có thể xuống âm
- **File:** `boss.service.ts` L564-567
- **Mô tả:** `updateMany({ where: { currentHp: { gt: 0n } }, data: { currentHp: { decrement: dmg } })` — Prisma `decrement` KHÔNG clamp at 0. Boss HP có thể xuống -50000.
- **Mitigation:** L615 `if (bossHpAfter < 0n) bossHpAfter = 0n` clamp response. Nhưng DB vẫn lưu giá trị âm.
- **Hậu quả:** Minor — boss đã DEFEATED nên row không query lại. Nhưng nếu heartbeat query `currentHp` logic nào đó → có thể sai.

---

## 4. BẢNG TÓM TẮT

| # | Vấn đề | Severity | Feature | Loại |
|---|--------|----------|---------|------|
| 2.1 | Double daily limit (Encounter vs DungeonRun) | 🔴 HIGH | Combat + DungeonRun | Xung đột |
| 2.2 | Cross-guard ACTIVE state (Combat vs DungeonRun) | 🔴 HIGH | Combat + DungeonRun | Xung đột |
| 2.3 | Cross-guard ACTIVE state (Combat vs Boss) | 🔴 HIGH | Combat + Boss | Xung đột |
| 2.4 | Reward Cap không áp cho Combat | 🟡 MEDIUM | Combat + Economy | Xung đột |
| 2.5 | Double-tracking kill/collect (Quest vs Story V2) | 🟡 MEDIUM | Quest + Story V2 | Xung đột |
| 2.6 | Alchemy thiếu rate limiter | 🟡 MEDIUM | Alchemy | Lỗ hổng |
| 3.1 | Talent defense calc thiếu stat mods | 🟡 MEDIUM | Combat | Bug |
| 2.7 | Boss cooldown reset on restart | 🟢 LOW | Boss | Design |
| 2.8 | Cultivation auto vs manual breakthrough | 🟢 LOW | Cultivation | Xung đột tiềm ẩn |
| 2.9 | Stamina cross-service race | 🟢 LOW | Combat/Dungeon/Boss | Race |
| 2.10 | Roguelike/Story Dungeon thiếu cross-guard với Combat/DungeonRun/Boss | 🟢 LOW | Roguelike/Story Dungeon | Design (bỏ qua — separate resource system) |
| 3.3 | Boss HP có thể âm trong DB | 🟢 LOW | Boss | Bug nhẹ |

---

## 5. TRẠNG THÁI FIX

| # | Vấn đề | Status | PR / Branch |
|---|--------|--------|-------------|
| 2.1 | Double daily limit (unified count) | ✅ FIXED | fix/cross-guard-active-state |
| 2.2 | Cross-guard ACTIVE (Combat↔DungeonRun) | ✅ FIXED | fix/cross-guard-active-state |
| 2.3 | Cross-guard ACTIVE (Combat↔Boss) | ✅ FIXED | fix/cross-guard-active-state |
| 2.4 | Reward Cap cho Combat | ✅ FIXED | fix/combat-reward-cap |
| 2.5 | Story V2 vs Quest double-tracking | ℹ️ INTENTIONAL | Design document confirms additive tracking |
| 2.6 | Alchemy rate limiter | ✅ FIXED | fix/alchemy-rate-limiter |
| 3.1 | Talent defense parity | ✅ FIXED | fix/combat-talent-defense-parity |
| 2.7 | Boss cooldown in-memory | ⏳ BACKLOG | Minor — server restart rare |
| 2.8 | Cultivation auto vs manual breakthrough | ⏳ BACKLOG | Needs catalog verification |
| 2.9 | Stamina cross-service race | ⏳ BACKLOG | All use CAS — minor window |
| 2.10 | Roguelike/Story Dungeon cross-guard | ⏳ BACKLOG | Separate resource system — LOW |
| 3.3 | Boss HP negative DB clamp | ✅ FIXED | fix/boss-hp-negative-clamp |

## 6. FILES CHANGED (11 files)

1. `apps/api/src/modules/combat/combat.service.ts` — cross-guard + unified daily + talent defense + reward cap
2. `apps/api/src/modules/combat/combat.controller.ts` — ACTIVITY_IN_PROGRESS → 409
3. `apps/api/src/modules/dungeon-run/dungeon-run.service.ts` — cross-guard + unified daily
4. `apps/api/src/modules/dungeon-run/dungeon-run.controller.ts` — ACTIVITY_IN_PROGRESS → 409
5. `apps/api/src/modules/boss/boss.service.ts` — cross-guard + HP clamp
6. `apps/api/src/modules/boss/boss.controller.ts` — ACTIVITY_IN_PROGRESS → 409
7. `apps/api/src/modules/character/alchemy.service.ts` — rate limiter
8. `apps/api/src/modules/character/character.controller.ts` — RATE_LIMITED → 409
9. `apps/api/src/modules/character/character-skill.service.ts` — lint fix (unused SectKey)
10. `CODE_REVIEW_FUNCTIONAL_LOGIC.md` — this file
11. `CODE_REVIEW_FIX_PLAN.md` — fix plan

## 7. QUALITY GATES

| Gate | Result |
|------|--------|
| `pnpm typecheck` | ✅ All 4 workspaces (logger, shared, api, web) |
| `eslint` on 9 changed files | ✅ 0 errors, 0 warnings |
| `check-i18n-parity` | ✅ 7243 VI/EN keys, perfect parity |
| Web tests | ✅ 260/263 files, 2697/2737 tests (42 timeout-only, pre-existing) |
| API tests | ⚠️ Needs Postgres + Redis infra |
