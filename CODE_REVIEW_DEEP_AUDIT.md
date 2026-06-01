# Code Review Sâu — Logic, Lạm Phát, Cấu Trúc, Thiếu Sót

> **Ngày:** 2026-05-31
> **Scope:** Toàn bộ gameplay loop backend + shared catalogs
> **Phương pháp:** Review từng service flow, cross-reference catalog, check invariants

---

## 1. BUG LOGIC

### 1.1 ✅ ĐÃ FIX: Talent Defense Parity (combat.service.ts)
- `actionViaActiveTalent()` monster reply thiếu stat mods → FIXED

### 1.2 ✅ ĐÃ FIX: Reward Cap Bypass (combat.service.ts)
- `updateChar.exp` set trước transaction → FIXED (moved inside tx)

### 1.3 ⚠️ Cultivation Auto-Breakthrough Stage Boundary
**File:** `cultivation.processor.ts` L296-302
```typescript
while (stageCost !== null && exp >= stageCost && realmStage < 9) {
  exp -= stageCost;
  realmStage += 1;
  brokeThrough = true;
  stageCost = expCostForStage(realmKey, realmStage);
}
```
**Vấn đề:** Khi `realmStage = 9`, loop dừng. Nhưng `expCostForStage(realmKey, 9)` trả về cost cho stage 9→10 transition. Character ở stage 9 với đủ EXP sẽ KHÔNG auto-advance sang realm mới (cần manual `breakthrough()` hoặc tribulation).
**Đánh giá:** Đây là DESIGN INTENT — stage 9 là peak, cần manual breakthrough. Không phải bug.

### 1.4 ⚠️ Boss HP Negative trong DB
**File:** `boss.service.ts` — ĐÃ FIX thêm clamp. Nhưng Prisma `decrement` không clamp atomic → có window nhỏ HP âm trong DB.

### 1.5 ⚠️ Combat `actionViaActiveTalent` Không Apply Pet Bonus
**File:** `combat.service.ts` talent path
- Skill path có `petCombatMul` (L572-585)
- Talent path KHÔNG có pet bonus
**Hậu quả:** Player dùng talent active bị thiệt DPS so với skill thường khi có pet.
**Severity:** MEDIUM — cần fix parity.

---

## 2. LẠM PHÁT KINH TẾ

### 2.1 Source/Sink Analysis

| Source (tiền vào) | Sink (tiền ra) | Cân bằng? |
|---|---|---|
| Combat monster kill (EXP + linhThach) | Skill upgrade | ✅ Small amounts |
| DungeonRun claim (linhThach + tienNgoc + items) | Alchemy craft (linhThach + materials) | ✅ Balanced |
| Boss reward (rank-based linhThach) | Equipment refine/reforge | ✅ Balanced |
| Mission claim (linhThach + tienNgoc) | Cultivation method unlock/upgrade | ✅ Balanced |
| Daily login (linhThach) | Shop buy (linhThach/tienNgoc) | ✅ Balanced |
| Quest claim (linhThach + items) | Gem socket/unsocket | ✅ Balanced |
| Achievement claim (linhThach + tienNgoc) | Artifact V2 craft/upgrade | ✅ Balanced |
| Sect contribution | Pet upgrade/evolution | ✅ Balanced |
| **Admin grant (ADMIN_GRANT)** | **All sinks** | ⚠️ Admin cannot mint Tiên Ngọc (ECONOMY_INVARIANT) |

### 2.2 Reward Cap Coverage

| Source | RewardCapService? | Status |
|---|---|---|
| Cultivation tick | ✅ `CULTIVATION` source | OK |
| DungeonRun claim | ✅ `DUNGEON` source | OK |
| Mission claim | ✅ `MISSION` source | OK |
| **Combat encounter** | ✅ `DUNGEON` source | ✅ ĐÃ FIX |
| **Boss reward** | ❌ Không có | ⚠️ MISSING |
| Daily login | ❌ Không có | ℹ️ Design (small amount) |
| Quest claim | ❌ Không có | ℹ️ Design (one-time) |

**Phát hiện:** Boss reward KHÔNG có reward cap. Nếu boss bị defeat nhiều lần/ngày (multi-region), player có thể farm unlimited linhThach từ boss ranking.
**Severity:** MEDIUM — boss rewards lớn hơn combat, cần cap.

### 2.3 Anti-Inflation Guards

| Guard | Present? | Effective? |
|---|---|---|
| CurrencyService CAS (gte delta) | ✅ | ✅ Chống overdraft |
| Idempotency keys (sourceType+sourceKey) | ✅ | ✅ Chống double-claim |
| Daily reward cap | ✅ (partially) | ⚠️ Thiếu boss source |
| Rate limiter (shop, alchemy) | ✅ | ✅ |
| Admin cannot mint Tiên Ngọc | ✅ | ✅ |

---

## 3. SAI CẤU TRÚC

### 3.1 ✅ ĐÃ FIX: Daily Limit Double-Count
- Combat đếm `Encounter` table, DungeonRun đếm `DungeonRun` table → FIXED (unified count)

### 3.2 ⚠️ Inconsistent Error Codes
- Boss: `CONTROLLED` reused cho cross-guard (nên dùng `ACTIVITY_IN_PROGRESS`)
- ĐÃ FIX: Tất cả 3 services giờ dùng `ACTIVITY_IN_PROGRESS` thống nhất

### 3.3 ⚠️ Missing Controller Error Mapping
- Alchemy `RATE_LIMITED` → ĐÃ FIX (character.controller.ts)
- Boss `ACTIVITY_IN_PROGRESS` → ĐÃ FIX (boss.controller.ts)

---

## 4. THIẾU CHỨC NĂNG

### 4.1 🔴 Boss Reward Missing Reward Cap
**Mô tả:** `BossService.distributeRewards()` không qua `RewardCapService`.
**Hậu quả:** Player farm boss rewards unlimited.
**Fix:** Inject `RewardCapService` vào `BossService`, apply cap cho top-1/top-2-3/top-4-10 linhThach grants.

### 4.2 🟡 Combat Action Via Active Talent Missing Pet Bonus
**Mô tả:** Talent active damage path không apply `petCombatMul`.
**Hậu quả:** Talent DPS thấp hơn skill DPS khi có pet equipped.
**Fix:** Thêm pet bonus calculation vào `actionViaActiveTalent()` damage path.

### 4.3 🟡 No Cross-Service Encounter State Check
**Mô tả:** Roguelike, Story Dungeon, Secret Realm đều có `ALREADY_IN_RUN` nhưng không check Encounter/DungeonRun/Boss ACTIVE.
**Hậu quả:** Player có thể chạy nhiều activity song song (không dùng stamina nhưng vẫn conflict).
**Severity:** LOW — separate resource systems, nhưng phá design "1 activity at a time".

### 4.4 🟢 Missing Breakthrough Achievement Tracking
**Mô tả:** `CultivationProcessor` track `BREAKTHROUGH` mission nhưng KHÔNG track achievement.
**Hậu quả:** Achievement `breakthrough_10` không auto-complete.
**Fix:** Thêm `achievements.trackEvent(charId, 'BREAKTHROUGH', 1)` vào cultivation processor.

### 4.5 🟢 Missing Daily Login Reward Cap
**Mô tả:** Daily login grant linhThach không qua RewardCapService.
**Đánh giá:** Design intent — daily login reward nhỏ (50-200 linhThach), không cần cap.

---

## 5. BẢNG TÓM TẮT

| # | Vấn đề | Severity | Loại | Status |
|---|--------|----------|------|--------|
| 1.1 | Talent defense parity | 🟡 MEDIUM | Bug | ✅ FIXED |
| 1.2 | Reward cap bypass | 🟡 MEDIUM | Bug | ✅ FIXED |
| 1.3 | Cultivation stage boundary | ℹ️ INFO | Design | ✅ OK |
| 1.4 | Boss HP negative | 🟢 LOW | Bug | ✅ FIXED |
| 1.5 | Talent missing pet bonus | 🟡 MEDIUM | Bug | ⚠️ CẦN FIX |
| 2.1 | Source/sink balance | ✅ OK | Economy | ✅ Balanced |
| 2.2 | Boss reward missing cap | 🟡 MEDIUM | Economy | ⚠️ CẦN FIX |
| 2.3 | Anti-inflation guards | ✅ OK | Economy | ✅ Mostly OK |
| 3.1 | Daily limit double-count | 🔴 HIGH | Structure | ✅ FIXED |
| 3.2 | Inconsistent error codes | 🟢 LOW | Structure | ✅ FIXED |
| 3.3 | Missing controller mapping | 🟢 LOW | Structure | ✅ FIXED |
| 4.1 | Boss reward cap | 🟡 MEDIUM | Missing | ⚠️ CẦN FIX |
| 4.2 | Talent pet bonus | 🟡 MEDIUM | Missing | ⚠️ CẦN FIX |
| 4.3 | Cross-service activity check | 🟢 LOW | Missing | ⏳ BACKLOG |
| 4.4 | Breakthrough achievement | 🟢 LOW | Missing | ⏳ BACKLOG |

---

## 6. KHUYẾN NGHỊ TIẾP THEO

### Ưu tiên 1 (P1): Boss Reward Cap
- Inject `RewardCapService` vào `BossService`
- Apply cap cho `distributeRewards()` linhThach grants
- Source = `BOSS` (thêm vào RewardCapService source types)

### Ưu tiên 2 (P1): Talent Pet Bonus Parity
- Thêm `petCombatMul` calculation vào `actionViaActiveTalent()` damage path
- Mirror pattern từ skill path `action()`

### Ưu tiên 3 (P3): Breakthrough Achievement
- Thêm `achievements.trackEvent(charId, 'BREAKTHROUGH', 1)` vào `CultivationProcessor`

### Ưu tiên 4 (Backlog): Cross-Service Activity Guard
- Design decision: cho phép Roguelike/Story Dungeon chạy song song với combat?
- Nếu không: thêm cross-check vào `RoguelikeService.start()` và `StoryDungeonService.startRun()`