# Kế Hoạch Fix — Code Review Functional Logic

> **Ngày tạo:** 2026-05-31
> **Source:** `CODE_REVIEW_FUNCTIONAL_LOGIC.md`
> **Branch naming convention:** `fix/<issue-id>-<short-desc>`

---

## PR 1: Cross-guard ACTIVE State (Issues #2.1 + #2.2 + #2.3)

**Branch:** `fix/cross-guard-active-state`
**Priority:** P0
**Scope:** 3 issues gộp 1 PR vì cùng pattern fix

### Thay đổi

#### 1a. CombatService.start() — Cross-check DungeonRun ACTIVE
**File:** `apps/api/src/modules/combat/combat.service.ts`

Sau dòng `if (existing) throw new CombatError('ALREADY_IN_FIGHT');` (L303), thêm:

```typescript
// Cross-guard: player đang chạy DungeonRun → không cho start combat
const activeDungeonRun = await this.prisma.dungeonRun.findFirst({
  where: { characterId: char.id, status: 'ACTIVE' },
  select: { id: true },
});
if (activeDungeonRun) throw new CombatError('ALREADY_IN_FIGHT');
```

#### 1b. DungeonRunService.startRun() — Cross-check Encounter ACTIVE
**File:** `apps/api/src/modules/dungeon-run/dungeon-run.service.ts`

Sau dòng `if (existingActive) throw new DungeonRunError('ALREADY_IN_RUN');` (L389), thêm:

```typescript
// Cross-guard: player đang trong combat encounter → không cho start dungeon run
const activeEncounter = await this.prisma.encounter.findFirst({
  where: { characterId: char.id, status: 'ACTIVE' },
  select: { id: true },
});
if (activeEncounter) throw new DungeonRunError('ALREADY_IN_RUN');
```

#### 1c. BossService.attack() — Cross-check Encounter + DungeonRun ACTIVE
**File:** `apps/api/src/modules/boss/boss.service.ts`

Sau dòng `if (char.stamina < BOSS_STAMINA_PER_HIT) throw new BossError('STAMINA_LOW');` (L356), thêm:

```typescript
// Cross-guard: player đang trong combat encounter hoặc dungeon run
const activeCombat = await this.prisma.encounter.findFirst({
  where: { characterId: char.id, status: 'ACTIVE' },
  select: { id: true },
});
if (activeCombat) throw new BossError('CONTROLLED'); // reuse CONTROLLED hoặc tạo code mới
const activeRun = await this.prisma.dungeonRun.findFirst({
  where: { characterId: char.id, status: 'ACTIVE' },
  select: { id: true },
});
if (activeRun) throw new BossError('CONTROLLED');
```

> **Note:** Cần thêm error code mới `ALREADY_IN_COMBAT` hoặc `ACTIVITY_IN_PROGRESS` thay vì reuse `CONTROLLED` (vì CONTROLLED dành cho debuff). Tạo:
> - CombatError: thêm `'ACTIVITY_IN_PROGRESS'`
> - DungeonRunError: thêm `'ACTIVITY_IN_PROGRESS'`
> - BossError: thêm `'ACTIVITY_IN_PROGRESS'`

#### 1d. Daily Limit Unified Count (Issue #2.1)
**File:** `apps/api/src/modules/combat/combat.service.ts`

Thay vì chỉ count `Encounter`, count cả 2 bảng:

```typescript
// Unified daily count: Encounter + DungeonRun
const [encounterCount, dungeonRunCount] = await Promise.all([
  this.prisma.encounter.count({
    where: {
      characterId: char.id,
      dungeonKey,
      createdAt: { gte: dayStart },
    },
  }),
  this.prisma.dungeonRun.count({
    where: {
      characterId: char.id,
      templateKey: dungeonKey,
      startedAt: { gte: dayStart },
    },
  }),
]);
const todayCount = encounterCount + dungeonRunCount;
```

**File:** `apps/api/src/modules/dungeon-run/dungeon-run.service.ts`

Tương tự cho `startRun()`:

```typescript
const [encounterCount, dungeonRunCount] = await Promise.all([
  this.prisma.encounter.count({
    where: {
      characterId: char.id,
      dungeonKey: templateKey,
      createdAt: { gte: dayStart },
    },
  }),
  this.prisma.dungeonRun.count({
    where: {
      characterId: char.id,
      templateKey,
      startedAt: { gte: dayStart },
    },
  }),
]);
const todayCount = encounterCount + dungeonRunCount;
```

### Test

- Thêm test: start combat khi có DungeonRun ACTIVE → `ALREADY_IN_FIGHT`
- Thêm test: start dungeon run khi có Encounter ACTIVE → `ALREADY_IN_RUN`
- Thêm test: boss attack khi có Encounter ACTIVE → `ACTIVITY_IN_PROGRESS`
- Thêm test: daily limit count = encounterCount + dungeonRunCount
- Chạy: `pnpm --filter @xuantoi/api test`

### Files touched
- `apps/api/src/modules/combat/combat.service.ts`
- `apps/api/src/modules/combat/combat.service.test.ts`
- `apps/api/src/modules/dungeon-run/dungeon-run.service.ts`
- `apps/api/src/modules/dungeon-run/dungeon-run.service.test.ts`
- `apps/api/src/modules/boss/boss.service.ts`
- `apps/api/src/modules/boss/boss.service.test.ts`

---

## PR 2: Combat Talent Defense Parity (Issue #3.1)

**Branch:** `fix/combat-talent-defense-parity`
**Priority:** P1
**Scope:** Copy full stat compose từ `action()` vào `actionViaActiveTalent()` monster reply

### Thay đổi

**File:** `apps/api/src/modules/combat/combat.service.ts`

Trong `actionViaActiveTalent()`, monster reply branch (L1413-1460), thay thế:

```typescript
// TRƯỚC (thiếu stat mods):
const effDef =
  (equip.def + bodyBonus.def) *
  (talentMods?.defMul ?? 1) *
  (buffMods?.defMul ?? 1);
```

Bằng:

```typescript
// SAU (parity với action()):
const statMul = isValidSpiritualRootGrade(char.spiritualRootGrade)
  ? 1 + getSpiritualRootGradeDef(char.spiritualRootGrade).statBonusPercent / 100
  : 1.0;
const titleMods: TitleMods = this.titles
  ? await this.titles.getMods(char.id)
  : composeTitleMods([]);
const methodStat = methodStatBonusFor(char.equippedCultivationMethodKey);
let methodV2Atk = 1.0;
let methodV2Def = 1.0;
if (this.cultivationMethodV2) {
  try {
    const snapshot = await this.cultivationMethodV2.getEquippedSnapshot(char.id);
    const v2 = aggregateEquippedMethods(snapshot);
    methodV2Atk = 1 + v2.atkPercent / 100;
    methodV2Def = 1 + v2.defPercent / 100;
  } catch { /* identity */ }
}
let artifactV2Def = 0;
if (this.artifactV2) {
  try {
    const snap = await this.artifactV2.getEquippedSnapshot(char.id);
    artifactV2Def = snap.def;
  } catch { /* identity */ }
}
const effDef =
  (equip.def + bodyBonus.def + artifactV2Def) *
  statMul *
  (talentMods?.defMul ?? 1) *
  (buffMods?.defMul ?? 1) *
  (titleMods?.defMul ?? 1) *
  methodStat.defMul *
  methodV2Def;
```

### Test

- Thêm test: talent active damage path → monster reply def = parity với skill path
- Chạy: `pnpm --filter @xuantoi/api test`

### Files touched
- `apps/api/src/modules/combat/combat.service.ts`
- `apps/api/src/modules/combat/combat.service.test.ts`

---

## PR 3: Boss HP Negative Fix (Issue #3.3)

**Branch:** `fix/boss-hp-negative-clamp`
**Priority:** P3 (nhưng fix nhanh, low risk)
**Scope:** Clamp boss HP trong DB về 0 khi defeat

### Thay đổi

**File:** `apps/api/src/modules/boss/boss.service.ts`

Sau dòng `if (flip.count > 0)` (L605), đảm bảo set `currentHp: 0n` đã có (L602 — đã có OK). Nhưng nếu `flip.count === 0` (race khác đã flip), bossHpAfter vẫn có thể âm.

Thêm clamp ngay sau L615:

```typescript
// Clamp negative HP to 0 in DB (Prisma decrement doesn't clamp)
if (bossHpAfter < 0n) {
  bossHpAfter = 0n;
  await this.prisma.worldBoss.updateMany({
    where: { id: boss.id, currentHp: { lt: 0n } },
    data: { currentHp: 0n },
  }).catch(() => {/* best-effort */});
}
```

### Test

- Thêm test: boss HP có thể âm → response trả 0 và DB được clamp
- Chạy: `pnpm --filter @xuantoi/api test`

### Files touched
- `apps/api/src/modules/boss/boss.service.ts`
- `apps/api/src/modules/boss/boss.service.test.ts`

---

## PR 4: Alchemy Rate Limiter (Issue #2.6)

**Branch:** `fix/alchemy-rate-limiter`
**Priority:** P2
**Scope:** Thêm rate limiter cho alchemy attempts

### Thây đổi

**File:** `apps/api/src/modules/character/alchemy.service.ts`

Inject rate limiter (mirror pattern từ ShopService):

```typescript
export const ALCHEMY_RATE_LIMIT_WINDOW_MS = 60_000;
export const ALCHEMY_RATE_LIMIT_MAX = 60; // 60 attempts/phút

@Injectable()
export class AlchemyService {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    @Optional() private readonly achievements?: AchievementService,
    @Optional() @Inject(ALCHEMY_RATE_LIMITER) limiter?: RateLimiter,
  ) {
    this.limiter = limiter ??
      new InMemorySlidingWindowRateLimiter(
        ALCHEMY_RATE_LIMIT_WINDOW_MS,
        ALCHEMY_RATE_LIMIT_MAX,
      );
  }
```

Trong `attemptCraft()`, thêm rate limit check đầu tiên:

```typescript
const rl = await this.limiter.check(characterId);
if (!rl.allowed) throw new AlchemyError('RATE_LIMITED');
```

**File:** `apps/api/src/modules/character/alchemy.controller.ts` — Thêm error mapping cho `RATE_LIMITED` → 429.

### Test

- Thêm test: 61 attempts trong 60s → throw RATE_LIMITED
- Chạy: `pnpm --filter @xuantoi/api test`

### Files touched
- `apps/api/src/modules/character/alchemy.service.ts`
- `apps/api/src/modules/character/alchemy.controller.ts`
- `apps/api/src/modules/character/alchemy.service.test.ts`

---

## PR 5: Reward Cap cho Combat (Issue #2.4) — OPTIONAL

**Branch:** `fix/combat-reward-cap`
**Priority:** P2 (cần xác nhận design intent)

### Phân tích

Combat encounter rewards (EXP + linhThach per monster kill) hiện KHÔNG qua `RewardCapService`. Nếu design intent là "combat đã bị gate bởi stamina + daily limit → không cần cap", thì skip PR này.

Nếu cần fix: inject `RewardCapService` vào `CombatService`, wrap expGain/linhThachGain trong `applyCapTx()` trước khi grant.

### Files touched (nếu fix)
- `apps/api/src/modules/combat/combat.service.ts`
- `apps/api/src/modules/combat/combat.module.ts`
- `apps/api/src/modules/combat/combat.service.test.ts`

---

## PR 6: Story V2 vs Quest Double-tracking (Issue #2.5) — OPTIONAL

**Branch:** `fix/story-v2-quest-dedup`
**Priority:** P2 (cần audit catalog)

### Phân tích

Cần audit catalog Phase 12 quests và Phase 33 story quests để xác nhận `targetId` có overlap không. Nếu KHÔNG overlap → không cần fix (2 hệ thống track khác nhau). Nếu CÓ overlap → cần migration strategy (disable Phase 12 tracking khi Phase 33 đã active cho cùng quest).

---

## Thứ tự thực hiện

| # | PR | Priority | Effort ước tính | Risk |
|---|-----|----------|-----------------|------|
| 1 | Cross-guard + Unified Daily Limit | P0 | 2-3 giờ | Thấp — additive guard checks |
| 2 | Talent Defense Parity | P1 | 1-2 giờ | Thấp — copy pattern từ action() |
| 3 | Boss HP Negative Clamp | P3 | 30 phút | Rất thấp — best-effort update |
| 4 | Alchemy Rate Limiter | P2 | 1-2 giờ | Thấp — mirror ShopService pattern |
| 5 | Combat Reward Cap | P2 | Cần xác nhận | Trung bình — thay đổi reward flow |
| 6 | Story V2 Dedup | P2 | Cần audit | Trung bình — catalog migration |

**Tổng effort (PR 1-4):** ~5-8 giờ

---

## Quality Gates (mỗi PR)

```bash
pnpm --filter @xuantoi/shared build
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @xuantoi/api test