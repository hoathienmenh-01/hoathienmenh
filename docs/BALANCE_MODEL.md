# Xuân Tôi — Balance Model

> **Status**: Long-term balance blueprint (curve, dial, formula).
> Source of truth cho **runtime số liệu hiện tại** là code @ `packages/shared/src/*.ts` + `apps/api/src/modules/*/{*.service,*.processor}.ts` + `docs/BALANCE.md`.
> File này = blueprint dài hạn + tuning rationale; file `BALANCE.md` = bảng tra hiện tại theo code.
> Sister docs: [`GAME_DESIGN_BIBLE.md`](./GAME_DESIGN_BIBLE.md), [`ECONOMY_MODEL.md`](./ECONOMY_MODEL.md), [`CONTENT_PIPELINE.md`](./CONTENT_PIPELINE.md).

Mục tiêu: bất kỳ ai (dev, AI, designer) trước khi chỉnh số (item bonus, skill scale, drop weight, EXP cost, …) phải đọc file này để biết **curve** + **constraint** + **lý do tại sao số đó là số đó**.

---

## 1. NGUYÊN TẮC CHỈNH SỐ

### 1.1 Số liệu = data, không phải code

- Mọi "magic number" balance phải là `const` trong file dedicated, không scatter trong service.
- Nếu nhiều magic number bị lặp → consolidate vào `packages/shared/src/balance-dials.ts` (phase 11).

### 1.2 Tuning theo curve, không theo cảm giác

- Mỗi chỉnh số phải reference 1 curve hoặc 1 invariant.
- Ví dụ tốt: "Tăng `expDrop` của `son_thu_lon` từ 12 → 15 vì thời gian D1 lên `luyenkhi-3` đang chậm 30% so với target 45 phút."
- Ví dụ xấu: "Cảm giác monster này weak quá, tăng HP."

### 1.3 Curve không vỡ retroactive

- Tăng power item LINH-tier → phải verify TIEN/THAN không bị vô nghĩa.
- Giảm cost dungeon → phải verify economy `linhThach` không lạm phát.

### 1.4 Trước khi merge

- Update bảng tra trong `docs/BALANCE.md` (auto-generated TODO phase 11) hoặc `BALANCE_MODEL.md` §3-§7.
- Add 1 unit test với invariant curve check (xem §10 test pattern).

---

## 2. CULTIVATION CURVE

### 2.1 Tick + EXP/tick

Code: `apps/api/src/modules/cultivation/cultivation.processor.ts` + `packages/shared/src/realms.ts` `cultivationRateForRealm`.

```
CULTIVATION_TICK_MS = 30_000  // 30s/tick
CULTIVATION_TICK_BASE_EXP = 5
gain = max(base, round(base * 1.45^order)) + floor(spirit / 4)
```

`order` ∈ [0..27] cho 28 realm.

### 2.2 EXP cost (cap)

```
expCost(order) = round(1000 * 1.6^order)        // stage 1 cap
expCostForStage(realm, stage) = round(expCost(realm.order) * 1.4^(stage - 1))
```

### 2.3 Time-to-realm target (D1 active 1h liên tục)

| Realm | Stage 1 cap | EXP/h (default spirit=8) | Time-to-stage 1 |
|---|---:|---:|---:|
| phamnhan | 1,000 | ~840 | 1.2 h |
| luyenkhi | 1,600 | ~960 | 1.7 h |
| truc_co | ~2,560 | ~1,440 | 1.8 h |
| kim_dan | ~4,096 | ~2,040 | 2.0 h |
| nguyen_anh | ~6,554 | ~2,880 | 2.3 h |
| hoa_than | ~10,486 | ~4,080 | 2.6 h |

Target curve: time-to-realm tăng dần nhưng không quá 4× giữa 2 realm liền kề.

### 2.4 Tunable dial (long-term)

| Dial | File | Hiện tại | Range tunable |
|---|---|---|---|
| `CULTIVATION_TICK_MS` | env / code | 30_000 | 10_000..60_000 (tick frequency) |
| `CULTIVATION_TICK_BASE_EXP` | code | 5 | 3..10 (early game speed) |
| Realm rate scale `1.45^order` | `realms.ts` | 1.45 | 1.3..1.6 (steepness) |
| Cap formula `1000 * 1.6^order` | `realms.ts` | 1.6 | 1.4..1.8 (late-game grind) |

**KHÔNG được** hardcode override 1 realm cụ thể (e.g. "luyenkhi rate × 2") — phá monotonic curve.

### 2.5 Buff multiplier (phase 11)

**Phase 11.1.A catalog đã có (session 9r-9 PR — `packages/shared/src/cultivation-methods.ts`)**:

| Method grade | expMultiplier | Stat sum (% hp+mp+atk+def) | Source |
|---|---|---|---|
| pham starter (Khai Thiên Quyết) | 1.00 | 0 | starter (auto-grant) |
| huyen Ngũ Hành (5 method) | 1.15..1.30 | -5..+30 | dungeon_drop / sect_shop |
| tien sect-locked (3 method) | 1.40 | +30..+50 | sect_shop |
| than endgame (3 method) | 1.60..1.80 | +60..+105 | boss_drop / event |

Khi thêm runtime (Phase 11.1.B + 11.3):

- Linh căn (Phase 11.0 catalog): 1.0..1.8× cultivation rate (`SPIRITUAL_ROOT_GRADE_DEFS[].cultivationMultiplier`).
- Cultivation method (Phase 11.1.A catalog): 1.0..1.8× cultivation rate (`CULTIVATION_METHODS[].expMultiplier`).
- Sect aura: 1.0..1.2× cultivation rate (Phase 13).
- Pill `tu_vi_dan`: 1.5× cultivation rate trong 1h.

**Stack rule**: multiplicative cap 3.0× tổng (dial — bumped từ 2.5× để cover tien × tien hiếm-but-allowed; than × than = 1.8 × 1.8 = 3.24 → cap 3.0). Vượt → cap.

### 2.6 Skill mastery curve (phase 11.2.A)

**Phase 11.2.A catalog đã có (session 9r-10 PR — `packages/shared/src/skill-templates.ts`)**:

| SkillTier | maxMastery | atkScaleBonus / level | mpReduction / level | cooldownReduction every | LinhThach base / multiplier | Shard base / multiplier | Has evolution |
|---|---|---|---|---|---|---|---|
| basic | 5 | +5% | -5% | none | 100 / ×2.0 | 0 / - | no |
| intermediate | 7 | +5% | -4% | every 4 levels | 200 / ×2.0 | 1 / ×1.5 | no |
| advanced | 8 | +6% | -4% | every 4 levels | 500 / ×2.0 | 2 / ×1.6 | no |
| master | 10 | +6% | -4% | every 4 levels | 1000 / ×2.0 | 4 / ×1.6 | no |
| legendary | 10 | +7% | -5% | every 3 levels | 2000 / ×2.1 | 8 / ×1.7 | yes (2 branches) |

**Stack cap (skill mastery)**:

- Per-skill max atkScaleBonus = `atkScaleBonusPerLevel × maxMastery` ≤ +100% (anti power-creep — vitest enforce).
- Per-skill max mpCostReduction ≤ 60% (skill luôn còn cost — vitest enforce).
- `EffectiveSkill.atkScale = baseSkill.atkScale × (1 + masteryLevel × atkScaleBonusPerLevel)` (round 2 decimals).
- `EffectiveSkill.mpCost = max(0, round(baseSkill.mpCost × (1 - masteryLevel × mpCostReductionPerLevel)))`.
- `EffectiveSkill.cooldownTurns = max(0, baseSkill.cooldownTurns - floor(masteryLevel / cooldownReductionEveryNLevels))`.

**Phase 11.2.B runtime (this PR)**:

- `CombatService.action()` inject `@Optional() CharacterSkillService`. Replace direct `skill.atkScale`/`skill.mpCost` đọc baseline → `effective = await characterSkill.getEffectiveSkillFor(char.id, baseSkill)` (gọi `applyMasteryEffect(template, masteryLevel, baseSkill)`). `dmgBase = rollDamage(effPower, monster.def, effective.atkScale)` + `charMp -= effective.mpCost`. Fallback `baselineEffective(baseSkill)` nếu service không inject (legacy test, optional DI). Legacy character (no `CharacterSkill` row) → `masteryLevel=0` → no bonus → backward-compat preserved.
- Stack với cultivation method `expMultiplier` (Phase 11.1.B): độc lập axis (skill mastery áp lên `atkScale` damage; cultivation method áp lên `cultivationRate` EXP). Không stack chung cap. Stack với linh căn `statBonusPercent` (Phase 11.3.C): cùng damage axis nhưng compose multiplicative — `effPower = (char.power + equip.atk) × statMul` qua linh căn (1.0..1.30), rồi `dmg = effPower × effective.atkScale` qua mastery (1.0..1.70 endgame legendary). Stack với Ngũ Hành element multiplier (Phase 11.3.B): cùng damage axis multiplicative cuối — `dmg × characterSkillElementBonus` (0.7..1.40).
- **Combat baseline numbers** (player power=100, son_thu_lon def=2, variance=1.0): `kiem_khi_chem` (basic atkScale=1.7) L0 → 169 dmg, L3 → 194 dmg (+15%), L5 → 220 dmg (+30%). MP cost L0=12 → L5=10 (basic mpCostReductionPerLevel=0.05 × 5 = 25%). Endgame ceiling: legendary L10 (atkScale 1.70× of base, mpCost 0.50× of base) — `van_kiem_quy_tong` base 3.8 atkScale → effective 6.46 atkScale → ~640+ dmg per cast at endgame stats.
- `CharacterSkillService.upgradeMastery` atomic transaction qua `prisma.$transaction()`: deduct `linhThachCost` (template.masteryLevels[lv].linhThachCost) qua `CurrencyService.applyTx({ reason: 'SKILL_UPGRADE' })` — server-authoritative, không double-spend, throw `INSUFFICIENT_FUNDS` trước khi increment masteryLevel.
- Skill book item drop từ dungeon/boss → consume → ItemLedger thành skillShard → `upgradeMastery` deduct **(deferred Phase 11.2.C — kind='item' SkillUnlockRequirement)**.

### 2.7 Buff / Debuff curve (phase 11.8.A)

**Phase 11.8.A catalog đã có (session 9r-11 PR — `packages/shared/src/buffs.ts`)**:

| Source | Buff count | Debuff count | Duration baseline | Stack rule |
|---|---|---|---|---|
| pill | 4 (atk/def/regen/spirit) | 0 | 30..90s | non-stackable, refresh duration |
| sect_aura | 3 (kim/thuy/hoa) | 0 | 600s | non-stackable, non-dispellable |
| event | 2 (double_exp/double_drop) | 0 | 3600s | non-stackable, non-dispellable |
| talent | 1 (shield_phong) | 0 | 10s | non-stackable, dispellable |
| skill (control) | 0 | 4 (root/stun/silence/taunt) | 3..9s (1..3 turns) | non-stackable |
| skill (DOT) | 0 | 2 (burn/poison) | 15..24s (5..8 turns) | stackable max 3 |
| boss_skill | 0 | 1 (atk_down) | 30s | non-stackable |
| tribulation | 0 | 1 (taoma — atk + cultivation_block) | 3600s | non-stackable, non-dispellable |

**Effect balance dial**:

| Effect kind | Buff range | Debuff range | Phase 11.8.B compose semantics |
|---|---|---|---|
| `stat_mod` | atk +12..+18%, def +15%, hpMax +0%, mpMax +0%, spirit +18% | atk -10..-18%, others 0 | multiplicative `value^stacks` per stack |
| `regen` | hp +5/s, mp +4/s | — | additive `value*stacks` |
| `damage_bonus` element | +5..+6% (sect aura) | — | multiplicative `value^stacks` per element-target |
| `damage_reduction` element | (reserved Phase 11.8.B) | — | multiplicative |
| `control` | — | 1..3 turns | max ccTurns trong list |
| `dot` | — | 6..8 dmg/turn × stacks | additive flat tổng dmg/tick |
| `shield` | 30% hpMax | — | additive ratio cap 1.0 hpMax |
| `taunt` | — | 1 (boolean) | OR flag |
| `cultivation_block` | — | 1 (boolean) | OR flag (Tâm Ma) |

**Stack cap rule** (anti power-creep):

- Stat_mod: per-buff `maxStacks=1` ngoại trừ DOT (max 3) → tổng atkMul không vượt ×1.5 từ buff alone (pill 1.12 × sect 1.05 × event 2.0 = 2.35 nhưng event_double_exp áp `spirit` chứ không `atk` → atk effective ≤ 1.18 từ buff stack thực tế).
- Combined với cultivation method (×1.8 max) + linh căn (×1.8 max) + buff (×1.5 max) → grand total cap 3.0× theo §2.5 (multiplicative).
- DOT max 24 dmg/tick (8 × 3 stacks burn) + 18 dmg/tick (6 × 3 poison) = 42 dmg/tick total — tuân `BALANCE_MODEL.md` §4 (HP cap luyenkhi 200 → DOT giết trong 5 turn ⇒ tỉ lệ chết hợp lý).
- Shield cap 1.0 hpMax tổng (multi-shield không vượt full HP).

Khi thêm runtime (Phase 11.8.B):

- `CharacterStatService.computeStats` call `composeBuffMods(activeBuffs)` → áp multiplicative cho atk/def/hpMax/mpMax/spirit + additive cho regen + element damage_bonus/reduction.
- `CombatService.attack` consume `controlTurnsMax` trước khi cho phép action. `tauntActive` → AI nhắm target.
- Cron `pruneBuffs` chạy 60s/lần xóa expired buff.
- DOT tick (1s wall hoặc combat turn) gọi `dotPerTickFlat` damage qua `CombatService.applyDamage`.
- `cultivationBlocked` → `CultivationService.tick` skip exp gain (Tâm Ma).

### 2.8 Title (Danh hiệu) curve (phase 11.9.A)

**Phase 11.9.A catalog đã có (session 9r-11 PR — `packages/shared/src/titles.ts`)**:

| Rarity | Count | flavorStatBonus cap | Source mix |
|---|---|---|---|
| common | 5 | 0 hoặc ≤ 1.02 | realm low, achievement, sect initiate |
| rare | 5 | ≤ 1.03 | realm mid, achievement boss, sect inner, event |
| epic | 8 | ≤ 1.05 | realm high, element mastery (×5), sect elder |
| legendary | 3 | ≤ 1.10 | realm very high, donation |
| mythic | 1 | ≤ 1.15 | realm hu_khong_chi_ton (đỉnh phong) |
| **TOTAL** | **24** | — | — |

**Stack cap rule (Phase 11.9.B runtime)**:

- `Character.title` String? = single equipped title slot. Multi-slot reserved cho future "title page" feature.
- `composeTitleMods([Character.title])` áp multiplicative cho atk/def/hpMax/mpMax/spirit (mỗi title bonus ≤ 1.15).
- Combined với cultivation method (×1.8 max) + linh căn (×1.8 max) + buff (×1.5 max) + title (×1.15 max) → grand total cap 3.5× theo §2.5 (multiplicative — bumped từ 3.0× để cover mythic title × 1.15 hiếm-but-allowed). Vượt → cap.
- Title cosmetic-first; flavor stat bonus không thể exceed equipment/skill mastery curve (vitest enforce per-rarity cap).

Khi thêm runtime (Phase 11.9.B):

- `CharacterTitleUnlock` table idempotent unique on `[characterId, titleKey]`.
- Auto-grant trên realm breakthrough event call `titleForRealmMilestone(newRealmKey)` → `unlockTitle`.
- Auto-grant trên achievement complete event (Phase 11.10) call `titleForAchievement(achievementKey)` → `unlockTitle`.
- Auto-grant trên sect role change event call `titleForSectRole(role)` → `unlockTitle`.
- `equipTitle` validate ownership trước khi set `Character.title`.
- Wire `composeTitleMods([Character.title])` vào `CharacterStatService.computeStats`.

### 2.9 Spiritual Root (Linh căn) runtime distribution (phase 11.3.A)

Phase 11.3.A runtime onboard auto-roll Linh căn server-authoritative khi tạo character. Distribution lần đầu (immutable cho đến khi reroll bằng `linh_can_dan`):

| Grade  | Tier name            | rollWeight | P(grade) | secondaryElementCount | cultivationMultiplier | statBonusPercent |
| ------ | -------------------- | ---------- | -------- | --------------------- | --------------------- | ---------------- |
| pham   | Phàm linh căn        | 60         | 60.0%    | 0                     | 1.00×                 | 0%               |
| linh   | Linh căn             | 25         | 25.0%    | 1                     | 1.20×                 | +5%              |
| huyen  | Huyền linh căn       | 10         | 10.0%    | 2                     | 1.50×                 | +12%             |
| tien   | Tiên linh căn        | 4          | 4.0%     | 3                     | 1.80×                 | +25%             |
| than   | Thần linh căn        | 1          | 1.0%     | 4                     | 2.50×                 | +50%             |

- Primary element uniform distribution 5 hệ (kim/moc/thuy/hoa/tho) — 20% per hệ.
- Secondary elements Fisher-Yates pick `secondaryElementCount` từ 4 hệ còn lại (no duplicate, no primary).
- Purity uniform integer [80, 100] lần đầu roll. Future Phase 11.3.B: `linh_can_dan` reroll → seed mới + có thể purity > 100 nếu refine catalog support.
- Vitest enforce: 10000 sample grade distribution ±5 percentage point của weight; 5000 sample primary element ±7 percentage point của 20% uniform.
- Combined với cultivation method (×1.8 max) + linh căn (×2.5 max) + buff (×1.5 max) + title (×1.15 max) → grand total cap **5.0× theo §2.5** (multiplicative — bumped từ 3.5× để cover Thần linh căn × 2.5 hiếm-but-allowed). Vượt → cap.

### 2.9.1 Phase 11.3.B wire điểm — Element multiplier vào CombatService (DONE this PR; Phase 11 nâng cao §3 polish)

`CombatService.action()` wire `characterSkillElementBonus(character, skill.element, monster.element)`. **Phase 11 nâng cao §3 (DONE)** — centralize matrix vào `balance-dials.ts`, replace generic log "tương khắc/sinh" bằng breakdown text "Kim khắc Mộc" via `describeElementMatch()`:

```
playerElementMul = elementMultiplier(skill.element, monster.element)  // base
                 + (skill.element === character.primaryElement ? ELEMENT_CHARACTER_PRIMARY_BONUS : 0)
                 + (character.secondaryElements.includes(skill.element) ? ELEMENT_CHARACTER_SECONDARY_BONUS : 0)

elementMultiplier(attacker, defender):  // delegate sang describeElementMatch()
  null vs * | * vs null  → ELEMENT_NEUTRAL_MULTIPLIER         (vô hệ)
  attacker === defender  → ELEMENT_SAME_ELEMENT_MULTIPLIER    (cùng hệ)
  attacker overcomes def → ELEMENT_COUNTER_MULTIPLIER         (tương khắc)
  attacker generates def → ELEMENT_GENERATE_MULTIPLIER        (tương sinh)
  defender overcomes atk → ELEMENT_COUNTERED_MULTIPLIER       (bị khắc)
  defender generates atk → ELEMENT_GENERATED_MULTIPLIER       (bị sinh)
```

| Constant (`balance-dials.ts`) | Value | Cặp | Ý nghĩa |
| --- | --- | --- | --- |
| `ELEMENT_COUNTER_MULTIPLIER` | **1.30** | Kim → Mộc, Mộc → Thổ, Thổ → Thuỷ, Thuỷ → Hoả, Hoả → Kim | Tương khắc, sát thương khuếch đại |
| `ELEMENT_GENERATE_MULTIPLIER` | **1.20** | Kim → Thuỷ, Thuỷ → Mộc, Mộc → Hoả, Hoả → Thổ, Thổ → Kim | Tương sinh, sát thương khuếch đại nhẹ |
| `ELEMENT_COUNTERED_MULTIPLIER` | **0.70** | nghịch của tương khắc | Bị defender khắc, sát thương suy giảm |
| `ELEMENT_GENERATED_MULTIPLIER` | **0.85** | nghịch của tương sinh | Bị defender sinh, defender hấp thụ năng lượng |
| `ELEMENT_SAME_ELEMENT_MULTIPLIER` | **0.90** | Kim vs Kim, Mộc vs Mộc... | Cùng hệ, triệt tiêu một phần |
| `ELEMENT_NEUTRAL_MULTIPLIER` | **1.00** | null vs * hoặc * vs null | Vô hệ (basic attack vs untyped monster) |
| `ELEMENT_CHARACTER_PRIMARY_BONUS` | **+0.10** | skill cùng `character.primaryElement` | Linh căn primary affinity |
| `ELEMENT_CHARACTER_SECONDARY_BONUS` | **+0.05** | skill ∈ `character.secondaryElements` | Linh căn secondary affinity |
| `ELEMENT_LOG_AMPLIFY_THRESHOLD` | **≥ 1.15** | trigger log "khuếch đại" | UX hint |
| `ELEMENT_LOG_DAMPEN_THRESHOLD` | **≤ 0.90** | trigger log "suy giảm" | UX hint |
| `ELEMENT_MODIFIER_ABSOLUTE_FLOOR` | **0.60** | envelope cho `validateElementalModifier` | Sàn tổng modifier sau compose tất cả layer |
| `ELEMENT_MODIFIER_ABSOLUTE_CEIL` | **1.50** | envelope cho `validateElementalModifier` | Trần tổng modifier (counter 1.30 + primary 0.10 + secondary 0.05 + headroom) |

**Note design intent**: `XuanToi_Phase11_NangCao_Report.docx` §3 đề xuất MVP "khắc hệ +10-15%, bị khắc -10%, tương sinh +5%" (gentler). Implementation Phase 11.3.B chọn aggressive hơn (counter +30%, sinh +20%, bị khắc -30%) — đã shipped + tested. Phase 11 nâng cao §3 KHÔNG re-tune values (rationale: avoid combat behavior shift), chỉ centralize hằng số + breakdown logging. Soft envelope (gentler doc spec) chuyển sang `validateElementalModifier()` validator dùng cho future talent/buff stacking.

**Cycles** (5 element):
- Tương khắc: `kim → moc → tho → thuy → hoa → kim` (Kim khắc Mộc, Mộc khắc Thổ, ...)
- Tương sinh: `kim → thuy → moc → hoa → tho → kim` (Kim sinh Thuỷ, Thuỷ sinh Mộc, ...)

**Wire điểm**:
- Player damage (skill flow): `dmg = max(1, round(dmgBase * playerElementMul * talentElementMul * buffElementMul))`.
- Player damage (talent active flow): same compose, parity với skill flow + breakdown log.
- Monster counter: `reply = max(1, round(replyBase * elementMultiplier(monster.element, char.primaryElement) * buffDmgReduction))`.
- Legacy character (`spiritualRootGrade=null`) → `charElementState=null` → bypass character bonus, chỉ áp `elementMultiplier` base → backward-compat preserved.
- Log line trigger: `playerElementMul ≥ ELEMENT_LOG_AMPLIFY_THRESHOLD (1.15)` → `Ngũ Hành Kim khắc Mộc — sát thương khuếch đại ×1.40`. `≤ ELEMENT_LOG_DAMPEN_THRESHOLD (0.90)` → `Ngũ Hành Kim cùng hệ Kim — sát thương suy giảm ×0.90`. Generic fallback `tương khắc/sinh` / `lệch hệ` chỉ kích hoạt khi `describeElementMatch.vi=null` (cả hai side đều null — không xảy ra runtime vì block đã guard `playerElementMul ≠ 1.0`).

### 2.9.2 Phase 11.3.C wire điểm — Cultivation + Stat bonus (DONE this PR)

`CultivationProcessor.process()` apply `cultivationMultiplier` vào exp gain:

```
baseGain = cultivationRateForRealm(realm) + floor(spirit/4)
mul = isValidSpiritualRootGrade(grade) ? getSpiritualRootGradeDef(grade).cultivationMultiplier : 1.0
gain = BigInt(max(1, round(baseGain * mul)))
```

`CombatService.action()` apply `statBonusPercent` vào atk/def:

```
statMul = isValidSpiritualRootGrade(grade) ? 1 + def.statBonusPercent / 100 : 1.0
effPower = (char.power + equip.atk) * statMul
effDef = equip.def * statMul
```

Curve table (đã có sẵn trong `packages/shared/src/spiritual-root.ts`):

| Grade | tier | cultivationMul | statBonus% | rollWeight |
| --- | --- | --- | --- | --- |
| Phàm Linh Căn | 0 | 1.00 | 0% | 60 |
| Linh Căn | 1 | 1.15 | 5% | 25 |
| Huyền Linh Căn | 2 | 1.30 | 10% | 10 |
| Tiên Linh Căn | 3 | 1.50 | 18% | 4 |
| Thần Linh Căn | 4 | 1.80 | 30% | 1 |

- Legacy character (`spiritualRootGrade=null`) → multiplier 1.0 → backward-compat preserved.
- Stat bonus applied **trước** rollDamage → max impact tại Thần linh căn (×1.30 power, ×1.30 def).
- Combined với element multiplier (1.40 max) + cultivation method (×1.8 max) + buff (×1.5 max) + title (×1.15 max) → grand total cap **5.0× theo §2.5** (multiplicative). Vượt → cap.

### 2.9.3 Phase 11.3.D wire điểm (Pending)

- UI character profile display Linh căn.
- Reroll service consume `linh_can_dan` ItemLedger + insert log `source='reroll'` + `rootRerollCount++`.

### 2.9.4 Phase 11.1.B wire điểm — Cultivation Method (Công pháp) compose (DONE this PR)

`CultivationProcessor.process()` compose method `expMultiplier` thêm vào gain công thức:

```
baseGain    = cultivationRateForRealm(realm) + floor(spirit/4)
cultivMul   = isValidSpiritualRootGrade(grade) ? def.cultivationMultiplier : 1.0
methodMul   = methodExpMultiplierFor(equippedCultivationMethodKey)  // 1.0 nếu null
gain        = BigInt(max(1, round(baseGain * cultivMul * methodMul)))
```

Curve table (đã có sẵn trong `packages/shared/src/cultivation-methods.ts`):

| Grade | Tier name | expMultiplier (range) | Source |
| --- | --- | --- | --- |
| pham (starter) | `khai_thien_quyet` | 1.00 | starter (auto-grant onboard) |
| huyen | 5 method (Ngũ Hành: kim/moc/thuy/hoa/tho) | 1.20–1.30 | dungeon_drop |
| tien | 3 method (sect-locked: thanh_van/huyen_thuy/tu_la) | 1.40–1.50 | sect_shop |
| than | 3 method (cross-element / vô hệ) | 1.60–1.80 | boss_drop / event |

**Compose example (worst → best)**:

| Linh căn | Method | Total mul | Note |
| --- | --- | --- | --- |
| pham (1.0) | starter (1.0) | **1.00×** | new player baseline |
| huyen (1.30) | huyen-grade (1.20) | **1.56×** | mid-game expected |
| tien (1.50) | tien sect (1.50) | **2.25×** | end-of-mid scale |
| than (1.80) | than (1.80) | **3.24×** | endgame ceiling |

- Legacy character (`equippedCultivationMethodKey=null`) → methodMul 1.0 → backward-compat preserved.
- Onboard auto-grant + auto-equip starter `khai_thien_quyet` (`source='starter'`) → mọi character mới có baseline 1.0×.
- Idempotent qua `@@unique([characterId, methodKey])` (P2002 catch trong service `learn`).
- Validation tại service: `realmByKey(c.realmKey).order ≥ realmByKey(method.unlockRealm).order` + sect lock (qua `SECT_NAME_TO_KEY`) + `forbiddenElements ∌ c.primaryElement`.
- `equip()` re-validate (e.g. character đổi linh căn vào forbidden → throw `FORBIDDEN_ELEMENT`).
- KHÔNG cooldown 24h re-equip trong MVP — future enhancement.

### 2.9.5 Phase 11.1.C wire điểm (Pending)

- UI character profile display equipped method (icon + grade + multiplier tooltip).
- Modal "Công pháp" list learned methods + button equip.
- Optional 24h cooldown anti-spam re-equip.

---

## 3. POWER CURVE

### 3.1 Power formula

Hiện trạng (gần đúng):

```
power = base.power + sum(equip.bonuses.atk)
```

Phase 11 chuẩn hoá:

```
power = base.power
       + spirit * 0.5
       + sum(equip.bonuses.atk)
       + cultivationMethod.atkBonus
       + skill.atkBonus            // passive bonus
       + title.atkBonus            // 0 vì cosmetic-only
realmTierMultiplier = 1.0 + (RealmTier.indexOf(realm.tier)) * 0.15
finalPower = round(power * realmTierMultiplier)
```

### 3.2 Power band per realm

Power band = expected power **không trang bị TIEN/THAN** ở realm tương ứng.

| Realm tier | Realm range | Expected power band (no rare) |
|---|---|---:|
| pham (1) | luyenkhi 1-9 | 50..200 |
| pham (2) | truc_co | 200..400 |
| pham (3) | kim_dan | 400..800 |
| pham (4) | nguyen_anh | 800..1,500 |
| pham (5) | hoa_than | 1,500..3,000 |
| pham (6) | luyen_hu | 3,000..6,000 |
| pham (7-10) | hop_the → do_kiep | 6k..50k |
| nhan_tien | nhan_tien → thien_tien | 50k..500k |
| tien_gioi | huyen_tien → chuan_thanh | 500k..10M |
| hon_nguyen+ | thanh_nhan+ | 10M..200M+ |

**Item TIEN/THAN equip có thể boost power lên 2-4× band**, nhưng không vượt band của realm tier kế trên.

### 3.3 Item power budget

| Quality | Max bonus.atk per item | Max bonus.def | Max bonus.hpMax | Max bonus.spirit |
|---|---:|---:|---:|---:|
| PHAM | 10 (luyenkhi-tier) | 8 | 30 | 5 |
| LINH | 25 (truc_co/kim_dan) | 20 | 80 | 12 |
| HUYEN | 60 (kim_dan/nguyen_anh) | 50 | 200 | 30 |
| TIEN | 200 (hoa_than/luyen_hu) | 160 | 800 | 100 |
| THAN | 800 (do_kiep+) | 600 | 3000 | 350 |

**Multi-stat item**: tổng power-equiv ≤ Σ(stat × weight) trong đó weight = atk:1, def:0.8, hpMax:0.05, spirit:1.5.

Ví dụ: TIEN weapon `bonus.atk = 200` → OK. TIEN amulet `bonus.atk = 100, def = 80, spirit = 60` → power-equiv = 100 + 80*0.8 + 60*1.5 = 100 + 64 + 90 = 254 → vượt 200 budget? Tuỳ rule. Đề xuất phase 11 áp budget mềm 1.2× cho off-slot, 1.0× cho weapon main slot.

### 3.4 Set bonus (phase 12)

4-piece set: bonus tổng ≤ 30% power band realm tương ứng.
6-piece set: ≤ 60%.
Không chồng nhiều set cùng lúc (1 character chỉ active 1 set).

---

## 4. COMBAT FORMULA

### 4.1 Damage

Hiện trạng:

```
damage = max(1, atk * (1 + skillBonus) - def * 0.5) * rand(0.85..1.15)
```

`skillBonus` = `skill.atkScale - 1` (e.g. atkScale 2.6 → bonus 1.6).

### 4.2 Phase 11 mở rộng

```
damage = max(1, atk * skill.atkScale - def * 0.5)
         * elementMultiplier(skill.element, target.element)  // 0.7..1.3
         * critMultiplier(roll, character.luck)              // 1.0 or 1.5..2.0
         * rand(0.85..1.15)
```

`elementMultiplier`: phase 11 thêm element kim/mộc/thuỷ/hoả/thổ vs hệ thống tu La huyết tế.

**Phase 11.0 catalog foundation (session 9r-8 PR — `packages/shared/src/spiritual-root.ts`)**:

```
elementMultiplier(attacker, defender):
  attacker = null OR defender = null  → 1.00  (neutral / vô hệ skill)
  attacker = defender                  → 0.90  (cùng hệ — triệt một phần)
  attacker khắc defender               → 1.30  (tương khắc, e.g. Kim → Mộc)
  attacker sinh defender               → 1.20  (tương sinh, e.g. Mộc → Hoả)
  defender khắc attacker               → 0.70  (bị khắc, e.g. Mộc → Kim)
  defender sinh attacker               → 0.85  (bị sinh — defender hấp thụ)
```

Chu kỳ tương khắc cổ điển (clockwise): Kim → Mộc → Thổ → Thuỷ → Hoả → Kim.
Chu kỳ tương sinh (clockwise): Kim → Thuỷ → Mộc → Hoả → Thổ → Kim.

Linh căn character bonus (top of base multiplier) — `characterSkillElementBonus`:

```
+ 0.10 nếu skillElement === character.primaryElement
+ 0.05 nếu skillElement ∈ character.secondaryElements
+ 0.00 nếu vô hệ skill (skillElement = null)
```

5 grade Linh căn — `SPIRITUAL_ROOT_GRADE_DEFS`:

| Grade | Cultivation × | Stat % | Secondary | Roll weight |
|---|---|---|---|---|
| pham (Phàm) | 1.00 | +0% | 0 | 60 |
| linh (Linh) | 1.15 | +5% | 1 | 25 |
| huyen (Huyền) | 1.30 | +10% | 2 | 10 |
| tien (Tiên) | 1.50 | +18% | 3 | 4 |
| than (Thần) | 1.80 | +30% | 4 (toàn) | 1 |

Hiện trạng: chỉ catalog metadata + helper. Combat runtime KHÔNG đọc `element`. Phase 11.2 (Elemental Combat MVP) sẽ wire `elementMultiplier` + `characterSkillElementBonus` vào `CombatService.applySkillDamage`. Phase 11.3 (Cultivation Method MVP) sẽ wire `cultivationMultiplier` + `statBonusPercent` vào `CultivationService.tickExp` + `CharacterStatService.computeStats`.

`critMultiplier`: roll 1-100 ≤ critChance(luck) → ×1.5..2.0.

### 4.3 Skill cooldown

Phase 11 thêm `cooldownTurns: Int @default(0)` cho skill. Active skill có cooldown:
- Skill thường: 0-2 turns.
- Skill mạnh: 2-4 turns.
- Tuyệt kỹ: 4-6 turns.

Logic combat: skill in cooldown → reject (combat service raise error).

### 4.4 Skill MP cost

```
mpCost <= floor(0.4 * mpMax)  // không skill nào tốn > 40% mpMax
```

### 4.5 Self-heal & blood-cost

Hiện trạng:
- `selfHealRatio ∈ [0, 0.5]` (heal max 50% HP/lượt).
- `selfBloodCost ∈ [0, 0.30]` (huyết tế tốn max 30% HP/lượt).

Curve giữ nguyên phase 11. Cap không tăng.

### 4.6 SKILLS catalog Ngũ Hành coverage (Phase 11 nâng cao §2 v3 — DONE)

Catalog `packages/shared/src/combat.ts`. Hiện 46 skill (Phase 10 PR-2 v1=29, PR-2 v2 +10=39, Phase 11 nâng cao §2 v3 +10=46). Test invariant: `packages/shared/src/skills-balance.test.ts` (30 test).

**Element coverage matrix** (5 hệ × ACTIVE/PASSIVE × tier):

| Hệ | luyenkhi ACTIVE | truc_co ACTIVE | kim_dan ULT | nguyen_anh ULT | PASSIVE | Roles distinct |
|---|---|---|---|---|---|---|
| KIM | DAMAGE | DAMAGE + HEAL | DAMAGE | DAMAGE | BUFF×2 | DAMAGE/HEAL/BUFF (3) |
| MỘC | HEAL | DEBUFF + DAMAGE | HEAL | HEAL | BUFF/DEBUFF | HEAL/DAMAGE/DEBUFF/BUFF (4) |
| THUỶ | CONTROL | HEAL + DAMAGE | CONTROL | CONTROL | BUFF×2 | CONTROL/HEAL/DAMAGE/BUFF (4) |
| HOẢ | DAMAGE | DAMAGE + BUFF | DAMAGE | DAMAGE | BUFF/DEBUFF | DAMAGE/BUFF/DEBUFF (3) |
| THỔ | BUFF | DAMAGE + CONTROL | DAMAGE | DAMAGE | BUFF×2 | BUFF/DAMAGE/CONTROL (3) |

**Invariants enforced** (`skills-balance.test.ts > Ngũ Hành coverage`):
- Mỗi element ≥ 2 ACTIVE + ≥ 2 PASSIVE.
- Mỗi element ≥ 4 skill (combat picker depth).
- Mỗi element ≥ 1 ACTIVE ở tier `luyenkhi` + `truc_co` + `kim_dan` (3-tier coverage).
- Mỗi element ≥ 1 kim_dan ULT + ≥ 1 nguyen_anh ULT.
- Mỗi element ≥ 3 distinct role (gộp ACTIVE + PASSIVE).
- Catalog ≥ 45 skill.

**Stat budget** (verified per element type, `skills-balance.test.ts > power budget`):
- nguyen_anh ULT: atkScale 3.6–4.0 (≤ `SKILL_ATK_SCALE_HARD_CAP=5`), mpCost 75–80 (≤ 80), cooldown 5–6 (≤ 6), selfHealRatio ≤ 0.30, selfBloodCost ≤ 0.15.
- truc_co tier: atkScale 0.7–2.7, mpCost 24–32, cooldown 3–4.
- Element multiplier wire (Phase 11.3.B + Phase 11 nâng cao §3): tự động áp lên skill mới qua `describeElementMatch()` (xem §2.9.1).

**SkillTemplate parity**: mỗi skill mới có entry tương ứng trong `packages/shared/src/skill-templates.ts` (test `skill-templates.test.ts > coverage vs SKILLS` enforce no orphan). Tier mapping:
- 5 nguyen_anh ULT → `tier: 'master'` (whitelisted ở `TIER_OVERRIDE_ALLOWED` — atkScale 3.5+ thường infer legendary nhưng legendary reserved cho hoa_than+ ULT có evolution branches).
- 5 truc_co role-fill → `tier: 'intermediate'` (theo inference).

---


## 5. DUNGEON & DROP CURVE

### 5.1 Stamina entry

| Realm tier (gợi ý) | staminaEntry |
|---|---:|
| pham early (luyenkhi) | 10 |
| pham mid (truc_co/kim_dan) | 20-30 |
| pham late (nguyen_anh+) | 40-60 |
| nhan_tien | 60-80 |
| tien_gioi+ | 80-100 (cap, vì staminaMax = 100 default) |

**Long-term**: staminaMax có thể grow theo physique/realm. Phase 12 evaluate.

### 5.2 Dungeon clear time

Target:
- Early: 2-5 phút (3-5 monster, mỗi monster 5-8 turn).
- Mid: 5-10 phút (5-8 monster).
- Late: 10-20 phút (boss-encounter mid-dungeon).

Nếu clear time vượt target → giảm HP monster hoặc thêm pill HP/MP drop.

### 5.3 Drop curve

Per dungeon clear (full 100% kill chain):

| Tier | Linh thạch drop range | Item drop xác suất |
|---|---:|---|
| Early (son_coc, luyenkhi) | 50-150 | 70% PHAM, 25% LINH, 5% HUYEN |
| Mid (hac_lam, truc_co) | 200-600 | 50% PHAM, 35% LINH, 14% HUYEN, 1% TIEN |
| Mid-late (yeu_thu_dong, kim_dan) | 600-1,500 | 30% PHAM, 40% LINH, 25% HUYEN, 4.5% TIEN, 0.5% THAN |
| Late (phase 10 mới) | 2k..10k | 20% PHAM, 30% LINH, 35% HUYEN, 14% TIEN, 1% THAN |

### 5.4 Drop weight registry

`packages/shared/src/combat.ts` `DUNGEON_LOOT[<key>] = [{ itemKey, weight, qtyMin, qtyMax }, ...]`.

Sum of `weight` không cần = 100; helper `rollDungeonLoot` tự normalize.

Verify pattern (xem `items-dungeon-loot.test.ts`):
- Mỗi entry tham chiếu itemKey hợp lệ.
- Không weight = 0.
- qtyMin ≤ qtyMax.

### 5.4 Gem socket budget (phase 11.4.A)

**Phase 11.4.A catalog đã có (session 9r-10 PR — `packages/shared/src/gems.ts`)**:

| Element | Bonus type per gem | PHAM scale | LINH scale | HUYEN scale | TIEN scale | THAN scale |
|---|---|---:|---:|---:|---:|---:|
| Kim | atk + spirit | atk 3 / sp 1 | atk 5 / sp 2 | atk 8 / sp 3 | atk 13 / sp 4 | atk 20 / sp 7 |
| Mộc | hpMax + spirit | hp 15 / sp 1 | hp 24 / sp 2 | hp 39 / sp 3 | hp 63 / sp 4 | hp 102 / sp 7 |
| Thuỷ | mpMax + spirit | mp 12 / sp 1 | mp 19 / sp 2 | mp 31 / sp 3 | mp 50 / sp 4 | mp 82 / sp 7 |
| Hoả | atk - def trade-off | atk 4 / def -1 | atk 6 / def -2 | atk 10 / def -3 | atk 17 / def -4 | atk 27 / def -7 |
| Thổ | def + hpMax | def 3 / hp 8 | def 5 / hp 13 | def 8 / hp 21 | def 13 / hp 34 | def 20 / hp 54 |

**Combine recipe (sink, không pure upgrade)**: 3× cùng key → 1× next-tier; geometric `gemUpgradePathCost` = `3^N` gem `from` cho 1 gem `to` (PHAM→THAN cost 81 PHAM gem).

**Combine sink rule (vitest enforce)**: `3 × bonus_pham > bonus_linh` cho mọi element (e.g. Kim: 3×3 = 9 atk > 5 atk LINH; Mộc: 3×15 = 45 hp > 24 hp LINH). Mục tiêu: combine = sink linh thạch chứ không pure upgrade — real upgrade comes from drop high-tier.

**Compatible slot per element**: Kim → WEAPON; Mộc → ARMOR/HAT; Thuỷ → ARTIFACT/TRAM; Hoả → WEAPON/ARTIFACT; Thổ → ARMOR/BELT/BOOTS. Phase 11.4.B `socketGem` runtime sẽ verify `canSocketGem(gemKey, slot)` trước khi push vào `Equipment.sockets[]`.

**Stack budget cap (phase 11.4.B runtime)**: per-equipment `Equipment.sockets[]` cap = 3 slot (PHAM equipment 0 slot, LINH 1, HUYEN 2, TIEN/THAN 3). Per-character total gem-bonus cap = 50% baseline equipment bonus (cap enforced ở `CharacterStatService.computeStats` Phase 11.4.B). Không cap per-stat (atk/def/hp/mp), chỉ cap total contribution.

### 5.5 Refine curve (phase 11.5.A)

**Phase 11.5.A catalog đã có (session 9r-10 PR — `packages/shared/src/refine.ts`)**:

| Level | Stage | Success rate | LinhThach cost | Material (qty) | Stat multiplier | Failure behavior | Break chance |
|---:|:---:|---:|---:|---|---:|:---|---:|
| 1 | safe | 0.95 | 100 | tinh_thiet (1) | 1.10 | no_loss | 0 |
| 2 | safe | 0.90 | 160 | tinh_thiet (1) | 1.20 | no_loss | 0 |
| 3 | safe | 0.85 | 256 | tinh_thiet (1) | 1.30 | no_loss | 0 |
| 4 | safe | 0.80 | 410 | tinh_thiet (1) | 1.40 | no_loss | 0 |
| 5 | safe | 0.75 | 655 | tinh_thiet (1) | 1.50 | no_loss | 0 |
| 6 | risky | 0.60 | 1049 | yeu_dan (2) | 1.65 | level_minus_one | 0 |
| 7 | risky | 0.525 | 1678 | yeu_dan (2) | 1.80 | level_minus_one | 0 |
| 8 | risky | 0.45 | 2684 | yeu_dan (2) | 1.95 | level_minus_one | 0 |
| 9 | risky | 0.375 | 4295 | yeu_dan (2) | 2.10 | level_minus_one | 0 |
| 10 | risky | 0.30 | 6872 | yeu_dan (2) | 2.25 | level_minus_one | 0 |
| 11 | extreme | 0.20 | 10995 | han_ngoc (3) | 2.45 | level_minus_one_or_break | 0.10 |
| 12 | extreme | 0.1625 | 17592 | han_ngoc (3) | 2.65 | level_minus_one_or_break | 0.15 |
| 13 | extreme | 0.125 | 28147 | han_ngoc (3) | 2.85 | level_minus_one_or_break | 0.20 |
| 14 | extreme | 0.0875 | 45036 | han_ngoc (3) | 3.05 | level_minus_one_or_break | 0.30 |
| 15 | extreme | 0.05 | 72057 | han_ngoc (3) | 3.25 | level_minus_one_or_break | 0.40 |

**Stage rule**:
- `safe` (L1..L5): fail = no_loss (mất material thôi); statMultiplier +0.10/level.
- `risky` (L6..L10): fail = level -1 unless protection; statMultiplier +0.15/level.
- `extreme` (L11..L15): fail = level -1 OR break (`extremeBreakChance` quyết định); statMultiplier +0.20/level. Protection cứu level-loss nhưng KHÔNG cứu break (intent: high-risk-high-reward, F2P-friendly cho L1..L10).

**Material curve (3-tier ore)**: safe → `tinh_thiet` (LINH ore, dungeon LINH drop, qty 1); risky → `yeu_dan` (HUYEN ore, dungeon HUYEN drop, qty 2); extreme → `han_ngoc` (TIEN ore, dungeon TIEN drop, qty 3). `getRefinePathCostMin(0, 15)` = `{ linhThach: 191k, materials: { tinh_thiet: 5, yeu_dan: 10, han_ngoc: 15 } }` best-case (no fail).

**EV expectation (Phase 11.5.B runtime)**:
- L0→L5 (safe stage): expected attempts ~5.6 (avg success 0.85), ~600 LinhThach total → low-friction.
- L5→L10 (risky stage): expected attempts ~10.5 (avg success 0.45), need protection charm × ~5 + 21 ore + ~30k LinhThach.
- L10→L15 (extreme stage): expected attempts ~50+ (avg success 0.12), break risk ~25% per fail → endgame whaling.

**Stack interaction with gem (Phase 11.4 + 11.5)**: refine multiplier áp dụng lên `bonuses` của ItemDef trước khi compose socket bonus. `final_stat = (item.bonuses × refineMultiplier) + composeSocketBonus(equipment.sockets[])`. Cap tổng (refine + gem) chưa enforce ở Phase 11.5.A — sẽ tune Phase 11.4.B/11.5.B runtime.

### 5.6 Tribulation curve (phase 11.6.A)

**Phase 11.6.A catalog đã có (session 9r-10 PR — `packages/shared/src/tribulation.ts`)**:

| Trigger (from→to realm) | Type | Severity | Waves | Wave 1 dmg | Wave N dmg | Reward LinhThach | Reward EXP | Fail expLoss | Cooldown | TâmMa% |
|---|:---:|:---:|---:|---:|---:|---:|---:|---:|---:|---:|
| kim_dan→nguyen_anh | lei | minor | 3 | 800 | 1458 | 5,000 | 1,000 | 10% | 30m | 5% |
| nguyen_anh→hoa_than | lei | minor | 3 | 800 | 1458 | 5,000 | 1,000 | 10% | 30m | 5% |
| hoa_than→luyen_hu | hoa | major | 5 | 4,000 | 13,294 | 25,000 | 10,000 | 20% | 60m | 10% |
| luyen_hu→hop_the | bang | major | 5 | 4,000 | 13,294 | 25,000 | 10,000 | 20% | 60m | 10% |
| hop_the→dai_thua | phong | major | 5 | 4,000 | 13,294 | 25,000 | 10,000 | 20% | 60m | 10% |
| dai_thua→do_kiep | lei | heavenly | 7 | 25,000 | 151,648 | 150,000 | 100,000 | 35% | 120m | 20% |
| **do_kiep→nhan_tien** | **tam** | **heavenly** | **7** | **25,000** | **151,648** | **150,000** | **100,000** | **35%** | **120m** | **20%** |
| chuan_thanh→thanh_nhan | lei | saint | 9 | 200,000 | 2,209,140 | 1,000,000 | 1,000,000 | 50% | 240m | 30% |

**Severity rule**:
- `minor` (3 wave): kim_dan/nguyen_anh threshold, low-friction breakthrough.
- `major` (5 wave): hoa_than..dai_thua threshold, force player wear gear hệ-specific.
- `heavenly` (7 wave): cross-tier breakthrough (pham→nhan_tien), endgame milestone.
- `saint` (9 wave): chuan_thanh+ saint-tier kiếp, top-end whaling content.

**Type rule (Ngũ Hành + Tâm)**:
- `lei` (Lôi Kiếp): hoa+kim alternating element — iconic "9 lôi kiếp" — yêu cầu kháng cả 2 hệ.
- `phong` (Phong Kiếp): kim only — gió kim cắt thân thể — ưu tiên kháng Kim.
- `bang` (Băng Kiếp): thuy only — ưu tiên kháng Thuỷ.
- `hoa` (Hoả Kiếp): hoa only — ưu tiên kháng Hoả.
- `tam` (Tâm Kiếp / Tâm Ma): null element — không dùng được trang bị Ngũ Hành; phải dùng spirit/cultivationMethod để chống đỡ. Cross-tier kiếp (`do_kiep→nhan_tien`) intent: gating phàm thành tiên.

**Wave damage curve**: geometric growth `severityBase × 1.35^waveIdx`. Wave cuối ~ 1.8x wave đầu cho minor, 2.6x cho saint. Wave 1 baseline scale với tier:
- minor wave 1 = 800 ~ kim_dan player atk × 5 ticks combat (force defensive build).
- saint wave 1 = 200k ~ chuan_thanh atk × 100 ticks (endgame need stack power).

**Failure penalty curve**: expLossRatio + cooldown geometric. Tâm Ma debuff Phase 11.6.B sẽ block tu luyện 15-120 phút + atk -10% combat (intent: punish + force RP "tâm ma cản đường"). Protection Phase 11.6.B: charm hoặc support skill có thể giảm chance Tâm Ma trigger.

**Reward curve (success)**: linhThach + expBonus + titleKey cosmetic + optional unique drop (heavenly = `kiep_van_thach`, saint = `thanh_kiep_tinh`). EV expectation Phase 11.6.B runtime: dùng `simulateTribulation(def, character.hpMax × cultivationMethod.hpScale, computeElementResist)` deterministic — KHÔNG có RNG → server replay-able + audit-able.

**Stack interaction with all systems (Phase 11.4 + 11.5 + 11.6)**: tribulation `effectiveDamage = wave.baseDamage × elementResist(character)`, where `elementResist = 1.0 - resistPercentage`. ResistPercentage tính từ: spiritualRoot.affinity + equipment elemental gear + cultivationMethod.elementBonus. Player muốn pass kiếp phải stack toàn bộ system: linh căn + công pháp + trang bị + refine + gem cùng hệ.

### 5.7 Alchemy curve (phase 11.X.A)

**Phase 11.X.A catalog đã có (session 9r-10 PR — `packages/shared/src/alchemy.ts`)**:

| Recipe key | Output pill | Tier | Furnace | Realm req | Inputs (qty) | Cost LinhThach | Success | E[attempts] |
|---|---|:---:|---:|:---:|---|---:|---:|---:|
| recipe_tieu_phuc_dan | tieu_phuc_dan (HP 35) | PHAM | L1 | — | linh_thao×2 | 50 | 0.95 | 1.05 |
| recipe_huyet_chi_dan | huyet_chi_dan (HP 60) | PHAM | L1 | — | linh_thao×1 + huyet_tinh×1 | 100 | 0.92 | 1.09 |
| recipe_linh_tinh_dan | linh_tinh_dan (MP 30) | PHAM | L1 | — | linh_thao×2 | 50 | 0.95 | 1.05 |
| recipe_linh_lo_dan | linh_lo_dan (MP 80) | PHAM | L1 | — | linh_thao×3 + huyet_tinh×1 | 120 | 0.90 | 1.11 |
| recipe_so_huyen_dan | so_huyen_dan (EXP 200) | PHAM | L1 | — | linh_thao×4 | 180 | 0.92 | 1.09 |
| recipe_thanh_lam_dan | thanh_lam_dan (HP 200) | LINH | L3 | truc_co | huyet_tinh×3 + linh_thao×5 | 400 | 0.85 | 1.18 |
| recipe_co_thien_dan | co_thien_dan (EXP 500) | LINH | L3 | truc_co | yeu_dan×1 + linh_thao×4 | 500 | 0.80 | 1.25 |
| recipe_cuu_huyen_dan | cuu_huyen_dan (HP 600) | HUYEN | L5 | kim_dan | yeu_dan×2 + huyet_tinh×3 | 1500 | 0.65 | 1.54 |
| recipe_ngoc_lien_dan | ngoc_lien_dan (MP 800) | HUYEN | L5 | kim_dan | yeu_dan×2 + tinh_thiet×3 | 1500 | 0.65 | 1.54 |
| recipe_tien_phach_dan | tien_phach_dan (HP 2500) | TIEN | L7 | hoa_than | han_ngoc×2 + yeu_dan×3 + huyet_tinh×5 | 8000 | 0.40 | 2.50 |
| recipe_tien_van_dan | tien_van_dan (MP 2500) | TIEN | L7 | hoa_than | han_ngoc×2 + tien_kim_sa×3 | 8000 | 0.40 | 2.50 |
| recipe_cuu_thien_dan | cuu_thien_dan (EXP 6000) | TIEN | L7 | hoa_than | tien_kim_sa×3 + yeu_dan×4 + linh_thao×8 | 12000 | 0.35 | 2.86 |
| recipe_nhan_tien_dan | nhan_tien_dan (EXP 18000) | THAN | L9 | do_kiep | han_ngoc×3 + tien_kim_sa×4 + yeu_dan×6 | 30000 | 0.20 | 5.00 |

**Curve rule**:
- **PHAM tier (L1)**: success ≥ 0.90, cost 50-180 LT — tân thủ luyện đan, low-friction.
- **LINH tier (L3 + truc_co req)**: success 0.80-0.85, cost 400-500 LT — mid-early game.
- **HUYEN tier (L5 + kim_dan req)**: success 0.65, cost 1500 LT — yêu cầu yêu đan từ săn yêu thú.
- **TIEN tier (L7 + hoa_than req)**: success 0.35-0.40, cost 8k-12k LT + nguyên liệu hiếm Tiên (hàn ngọc/tiên kim sa) → endgame whaling.
- **THAN tier (L9 + do_kiep req)**: success 0.20, cost 30k LT — tổng E[cost] cho 1 nhân tiên đan ≈ 150k LT (5× expected attempts).

**Input balance**:
- Convention: **input + linhThach LUÔN bị consume dù fail** (intent: anti-spam, force player invest before retry).
- Material chain: `linh_thao` PHAM/LINH (cheap herb), `huyet_tinh` LINH (yêu thú blood mid), `tinh_thiet` LINH (metal mid), `yeu_dan` HUYEN (yêu đan rare drop), `han_ngoc` TIEN (cold ore endgame), `tien_kim_sa` TIEN (gold sand endgame).
- Recipe gating: realmRequirement + furnaceLevel cùng nhau enforce ý "phải tu hành đủ + đúc lò đủ mới luyện được đan cao tier".

**Stack interaction with progression**:
- Phase 11.X.B sẽ thêm `Character.alchemyFurnaceLevel Int @default(1)`. Upgrade lò qua sect contribution / recipe quest / item rare.
- Phase 11.X.B success roll: `seedrandom(attemptId)` deterministic — server replay-able + audit-able. KHÔNG dùng Math.random(), tránh server-frontend desync.
- E[attempts] table giúp player budget linhThach + nguyên liệu trước khi luyện. UI Phase 11.X.B sẽ render expected cost dựa trên `getExpectedAlchemyAttempts(recipe)`.

### 5.8 Talent / Thần Thông curve (phase 11.7.A)

**Phase 11.7.A catalog đã có (session 9r-10 PR — `packages/shared/src/talents.ts`)**:

**Passive talents (7) — always-on khi đã học:**

| Talent | Element | Realm req | Cost (pts) | Effect |
|---|:---:|:---:|---:|---|
| Kim Thiên Cơ | kim | kim_dan | 1 | atk × 1.10 |
| Thuỷ Long Ấn | thuy | kim_dan | 1 | hpMax × 1.10 |
| Mộc Linh Quy | moc | truc_co | 1 | hp regen +5/tick |
| Hoả Tâm Đạo | hoa | kim_dan | 2 | damage × 1.15 vs enemy hệ Kim (counter) |
| Thổ Sơn Tướng | tho | truc_co | 1 | def × 1.10 |
| Thiên Di | — | nguyen_anh | 2 | drop rate × 1.20 |
| Ngộ Đạo | — | hoa_than | 2 | EXP gain × 1.15 |

**Active talents / Thần Thông (7) — cooldown + mp cost:**

| Talent | Element | Realm req | Cost (pts) | Effect | MP | CD |
|---|:---:|:---:|---:|---|---:|---:|
| Kim Quang Trảm | kim | kim_dan | 2 | AOE damage 2× atk | 30 | 3 |
| Thuỷ Yên Ngục | thuy | kim_dan | 2 | Single root 3 turns | 25 | 5 |
| Mộc Chu Lâm | moc | truc_co | 1 | Single heal 30% | 40 | 6 |
| Hoả Long Phún | hoa | kim_dan | 2 | Single DOT 5 turns | 35 | 4 |
| Thổ Địa Chấn | tho | nguyen_anh | 2 | AOE stun 1 turn | 45 | 6 |
| Thiên Lôi Trừng Trị | — | hoa_than | 3 | Single true damage 3× spirit | 50 | 7 |
| Phong Lui Pháp Tướng | — | luyen_hu | 3 | Utility escape combat | 60 | 10 |

**Curve rule**:
- **Passive cost balance**: 1 point cho buff cá nhân (atk/def/hp/regen) — 2 points cho counter element / utility (drop/exp/anti-counter).
- **Active cost balance**: 1 point (heal Mộc) → 2 points (damage/cc element-locked) → 3 points (neutral utility/true-damage endgame).
- **Cooldown vs power**: damage AOE 2× atk → 3 turn cd. Single root → 5 cd. Heal → 6 cd. AOE stun → 6 cd. True damage 3× → 7 cd. Escape → 10 cd. Càng mạnh càng cooldown dài.
- **MP cost vs role**: utility/escape (60) > heal (40) > AOE stun (45) ≈ AOE damage (30) ≈ true damage (50) > single (25-35). Heal yêu cầu reserve MP cao hơn để tránh spam.

**Talent point budget**:

| Realm threshold | Order | Budget (= ⌊order/3⌋) | Note |
|---|---:|---:|---|
| phamnhan | 0 | 0 | Tân thủ chưa có ngộ đạo |
| luyenkhi | 1 | 0 | — |
| truc_co | 2 | 0 | — |
| kim_dan | 3 | 1 | First milestone |
| nguyen_anh | 4 | 1 | — |
| hoa_than | 5 | 1 | — |
| luyen_hu | 6 | 2 | Second milestone |
| hop_the | 7 | 2 | — |
| dai_thua | 8 | 2 | — |
| do_kiep | 9 | 3 | Third milestone |
| ... | ... | ... | Mỗi 3 realm = 1 point |
| chuan_thanh (~18) | ~18 | ~6 | Endgame |
| thanh_nhan (~20) | ~20 | ~6 | — |

**Stack interaction (Phase 11.7.B runtime)**:
- Passive `composePassiveTalentMods(learnedTalentKeys)` returns multiplicative stat mods → wire vào `CharacterStatService.computeStats` SAU khi cộng base + cultivation method + spiritual root + equipment + refine + gem (= last layer).
- Active hook qua `simulateActiveTalent(talent, atk, spirit)` deterministic → KHÔNG dùng Math.random(). Combat service apply damage/heal/cc/dot atomically với mp consume + cooldown set.
- Element synergy: linh căn `kim` + Kim talent = double scaling atk vs Mộc enemy (counter). Linh căn primary + Hoả Tâm Đạo = anti-Kim counter strong.
- Build paradigm: 6 budget endgame = ~2 passive (4 points) + 1 active (2 points), HOẶC 1 high-tier active (3 points) + 1 mid passive (2 points) + 1 low passive (1 point). Tradeoff stat boost vs combat power.

---

## 6. BOSS CURVE

### 6.1 Boss HP per tier

**Phase 10 PR-5 catalog cap (BOSSES hiện tại 12 boss)**:

| Tier (recommendedRealm) | baseMaxHp | atk band | reward band |
|---|---:|---:|---:|
| Sect-level (truc_co/kim_dan early) | 100k..500k | hp/8000..hp/1000 | hp/8..hp/2 |
| World pham (kim_dan/nguyen_anh) | 500k..1M | hp/8000..hp/1000 | hp/8..hp/2 |
| World late pham (hoa_than/luyen_hu) | 1M..2M | hp/8000..hp/1000 | hp/8..hp/2 |
| Cross-element endgame (hop_the+) | 2M..5M | hp/8000..hp/1000 | hp/8..hp/2 |

Bound enforce bởi `boss-balance.test.ts` 28 test:
- `baseMaxHp` ∈ [100k, 5M] (phase 10 cap).
- `atk` ∈ [hp/8000, hp/1000] (early burst (~hp/1300) → late raid-style (~hp/4500)).
- `def ≤ atk` (boss thiên về tấn công, không pure tank).
- `baseRewardLinhThach` ∈ [hp/8, hp/2] (boss reward > dungeon — §7.1).
- `level` (forward-compat phase 11.3) monotonic non-decreasing, ≤ 100.

**Phase 12+ scale-up (BigInt)**:

| Tier | maxHp |
|---|---:|
| Sect-level (phase 13) | 100k..500k |
| World pham | 1M..10M |
| World nhan_tien | 10M..100M |
| World tien_gioi | 100M..1B |
| World hon_nguyen+ | 1B+ (BigInt) |

**Element coverage (phase 10 PR-5)**: BOSSES có ≥ 2 boss / element Ngũ Hành (kim/moc/thuy/hoa/tho) + ≥ 1 cross-element endgame (`element=null`). Element của boss phải khớp với element của `regionKey` (consistency với MonsterDef/DungeonDef phase 10 PR-3 region whitelist).

### 6.2 Boss reward distribute

Hiện tại: linhThach distribute theo % damage. Phase 12 mở rộng:

```
shareRatio = damage[char] / sum(damage[*])
linhThachReward = floor(boss.rewardLinhThach * shareRatio)
itemRoll = rollWithWeight(boss.rewardItems, shareRatio)
```

Top 10 damager guarantee 1 item drop. Bottom 90% probabilistic.

### 6.3 Boss spawn cadence (phase 12)

| Boss tier | Spawn interval | Active duration |
|---|---|---|
| Sect boss | 6h | 2h |
| World pham | 3h | 1h |
| World nhan_tien | 6h | 2h |
| World tien_gioi | 12h | 3h |
| World hon_nguyen+ | 24h | 6h |
| Event boss | manual | event duration |

---

## 7. MISSION REWARD CURVE

### 7.1 Daily mission reward target

Target: 1 character D1-D7 hoàn thành full daily set = 50% daily linhThach gain.

| Realm tier | Daily linhThach gain (cultivation+dungeon) | Mission daily reward total | Per mission |
|---|---:|---:|---:|
| luyenkhi | ~5k | ~2.5k | 500/mission × 5 |
| truc_co | ~15k | ~7.5k | 1.5k/mission × 5 |
| kim_dan | ~40k | ~20k | 4k/mission × 5 |
| nguyen_anh | ~100k | ~50k | 10k/mission × 5 |

### 7.2 Weekly mission

Tổng = 2-3× daily total. Distributed over 4-5 mission.

### 7.3 Once mission (story / milestone)

Reward boost lớn (2-5× daily total) vì 1 lần. Set theo milestone.

---

## 8. ECONOMY EQUILIBRIUM (long-term)

### 8.1 Daily linhThach in/out target

Per active player:
- IN: cultivation 30% + dungeon 50% + mission 15% + boss 5%.
- OUT: market buy 30% + refine 25% + repair 5% + alchemy 10% + sect donate 20% + savings 10%.

Nếu 1 source > 60% IN → unhealthy, cần rebalance.

### 8.2 Market price band default

| Item quality | Min price (linhThach/unit) | Max price |
|---|---:|---:|
| PHAM | 10 | 1,000 |
| LINH | 100 | 10,000 |
| HUYEN | 1,000 | 100,000 |
| TIEN | 10,000 | 5,000,000 |
| THAN | 100,000 | 50,000,000 |

Phase 16 áp dụng `MARKET_PRICE_BAND[itemKey]` override per-item.

### 8.3 Topup pack pricing

Hiện tại: `packages/shared/src/topup.ts`. Các dial:
- Pack 1: 10k VND → ? tienNgoc. Ratio tunable theo monetization policy.
- Bonus pack đầu tiên (first-buy bonus) cap 50% gia trị.

**KHÔNG được** dial topup mà không thông qua user/PM (real-money).

---

## 9. BALANCE DIAL REGISTRY (Phase 11 nâng cao §6 — DONE)

File: `packages/shared/src/balance-dials.ts` (đã land — Phase 11 nâng cao §6).
Test invariant: `packages/shared/src/balance-dials.test.ts` (36 test, snapshot stable).

### 9.1 Inventory & Ownership

| Group | Dial | Source-of-truth nơi khác | Owner |
|---|---|---|---|
| Cultivation | `CULTIVATION_TICK_MS` | `ws-events.ts` (re-export) | balance-dials |
| Cultivation | `CULTIVATION_TICK_BASE_EXP` | `ws-events.ts` (re-export) | balance-dials |
| Cultivation | `CULTIVATION_RATE_REALM_MULT` | `realms.ts` (private const ngày trước) | balance-dials |
| Cultivation | `CULTIVATION_BUFF_CAP` | (mới) | balance-dials |
| Realm cost | `REALM_COST_BASE` / `REALM_COST_SCALE` / `STAGE_COST_SCALE` | `realms.ts` `calcExpCost` (formula) | balance-dials |
| Stamina | `STAMINA_REGEN_PER_TICK` | `combat.ts` (re-export) | balance-dials |
| Stamina | `STAMINA_MAX_DEFAULT` | (mới) | balance-dials |
| Combat | `COMBAT_RNG_LOW` / `RNG_HIGH` / `MIN_DAMAGE` / `DEF_FACTOR` | (mới — formalize §4.1) | balance-dials |
| Skill | `SKILL_ATK_SCALE_HARD_CAP`, `SELF_HEAL_HARD_CAP`, `SELF_BLOOD_HARD_CAP`, `COOLDOWN_HARD_CAP`, `MP_COST_HARD_CAP` | trước inline trong `skills-balance.test.ts` | balance-dials |
| Item | `ITEM_STAT_BUDGET_BY_QUALITY`, `OFF_SLOT_SOFT_CAP_MULTIPLIER`, `POWER_EQUIV_WEIGHTS` | trước inline trong `items-balance.test.ts` | balance-dials |
| Mission | `MISSION_DAILY_BUDGET_BY_REALM_TIER`, `WEEKLY_DAILY_MULTIPLIER`, `ONCE_LINHTHACH_HARD_CAP`, `TIENNGOC_HARD_CAP` | trước inline trong `missions-balance.test.ts` | balance-dials |
| Element (Phase 11 nâng cao §3 — DONE production wire) | `ELEMENT_NEUTRAL_MULTIPLIER`, `ELEMENT_COUNTER_MULTIPLIER`, `ELEMENT_GENERATE_MULTIPLIER`, `ELEMENT_COUNTERED_MULTIPLIER`, `ELEMENT_GENERATED_MULTIPLIER`, `ELEMENT_SAME_ELEMENT_MULTIPLIER`, `ELEMENT_CHARACTER_PRIMARY_BONUS`, `ELEMENT_CHARACTER_SECONDARY_BONUS`, `ELEMENT_LOG_AMPLIFY_THRESHOLD`, `ELEMENT_LOG_DAMPEN_THRESHOLD`, `ELEMENT_MODIFIER_ABSOLUTE_FLOOR`, `ELEMENT_MODIFIER_ABSOLUTE_CEIL`. Helpers: `describeElementMatch(a,b) → {multiplier, relation, vi}`, `ELEMENT_MATRIX[a][b]` (frozen 5×5), `validateElementalModifier(input)` | trước hardcode trong `spiritual-root.ts` (1.30/1.20/0.70/0.85/0.90) + log threshold trong `combat.service.ts` (1.15/0.9) | balance-dials |
| Breakthrough (forward-compat — Phase 11 nâng cao §5) | `BREAKTHROUGH_CHANCE_MIN/MAX`, `FAIL_DEBUFF_DURATION_SEC`, `FAIL_DEBUFF_RATE_PENALTY` | (mới — chưa wire BreakthroughService) | balance-dials |
| Economy | `MARKET_TAX_DEFAULT`, `DROP_WEIGHT_MAX_RATIO` | (mới — formalize §8.1 / §5.4) | balance-dials |

### 9.2 Validators (anti-content-creep guard)

`balance-dials.ts` export 4 validator function trả `string[]` (rỗng khi pass):
- `validateSkillBudget(input)` — atkScale / mpCost / selfHealRatio / selfBloodCost / cooldownTurns ≤ cap.
- `validateItemBudget(input)` — single-stat ≤ cap quality + multi-stat power-equiv ≤ soft cap.
- `validateMissionRewardBudget(input)` — linhThach ≤ daily/weekly/once cap, tienNgoc ≤ cap.
- `validateElementalModifier(input)` — finite + ∈ `[ELEMENT_MODIFIER_ABSOLUTE_FLOOR..ELEMENT_MODIFIER_ABSOLUTE_CEIL]` envelope. Dùng cho future stacking (talent damage_bonus_by_element + buff damage_bonus_by_element + linh căn primary bonus) để guard tổng modifier không vượt 1.5× / dưới 0.6×.

Caller dùng:
```ts
const errs = validateSkillBudget(skillInput);
expect(errs, errs.join('\n')).toEqual([]);
```

### 9.3 Reference snapshot (proposed shape — implementation đã có)

```ts
export const BALANCE_DIALS = {
  // Cultivation
  CULTIVATION_TICK_MS: 30_000,
  CULTIVATION_TICK_BASE_EXP: 5,
  CULTIVATION_RATE_SCALE: 1.45,         // realm scale exponent base
  CULTIVATION_BUFF_CAP: 2.5,            // multiplier cap khi stack buff

  // Realm cost
  REALM_COST_BASE: 1000,
  REALM_COST_SCALE: 1.6,
  STAGE_COST_SCALE: 1.4,

  // Combat
  COMBAT_RNG_LOW: 0.85,
  COMBAT_RNG_HIGH: 1.15,
  COMBAT_MIN_DAMAGE: 1,
  COMBAT_DEF_FACTOR: 0.5,

  // Stamina
  STAMINA_REGEN_PER_TICK: 3,
  STAMINA_MAX_DEFAULT: 100,

  // Drop
  DROP_RNG_SEED_MODE: 'time',  // 'time' | 'deterministic' (test mode)

  // Economy
  MARKET_TAX_DEFAULT: 0.05,
  REWARD_CAP_LINH_THACH_DAILY_BY_REALM: {
    luyenkhi: BigInt(50_000),
    truc_co: BigInt(150_000),
    // ...
  },
} as const;
```

Override:
1. Static default (file).
2. Env override (e.g. `XT_CULTIVATION_TICK_MS=20000`).
3. Admin live override (FeatureFlag — phase 15).

**KHÔNG được** chỉnh dial trực tiếp trong service code. Mọi service import từ `BALANCE_DIALS`.

---

## 10. TEST PATTERN

### 10.1 Curve invariant test

```ts
// packages/shared/src/realms.test.ts (mở rộng)
it('cultivation rate is monotonic across realms', () => {
  let prev = 0;
  for (const realm of REALMS) {
    const rate = cultivationRateForRealm(realm.key, 5);
    expect(rate).toBeGreaterThanOrEqual(prev);
    prev = rate;
  }
});

it('expCost(order) is monotonic', () => {
  for (let i = 0; i < REALMS.length - 1; i++) {
    expect(expCost(REALMS[i + 1].order)).toBeGreaterThan(expCost(REALMS[i].order));
  }
});
```

### 10.2 Power band test (phase 11)

```ts
it('item power-equiv stays within quality budget', () => {
  for (const item of ITEMS) {
    const equiv = computePowerEquiv(item);
    expect(equiv).toBeLessThanOrEqual(QUALITY_POWER_BUDGET[item.quality]);
  }
});
```

### 10.3 Drop weight integrity

Đã có `items-dungeon-loot.test.ts`. Mở rộng phase 10:

```ts
it('drop weight produces no entry > 80% probability', () => {
  for (const [dungeonKey, entries] of Object.entries(DUNGEON_LOOT)) {
    const total = sum(entries.map(e => e.weight));
    const maxRatio = max(entries.map(e => e.weight / total));
    expect(maxRatio).toBeLessThanOrEqual(0.8);  // tránh 1 item dominate drop
  }
});
```

### 10.4 Reward gain estimate test (phase 12)

```ts
it('estimated daily linhThach gain per realm is in target band', () => {
  // simulate 24h cultivation + 50 dungeon clear + full daily mission
  const sim = simulateDailyEconomy('kim_dan');
  expect(sim.linhThachIn).toBeGreaterThan(20_000n);
  expect(sim.linhThachIn).toBeLessThan(80_000n);
});
```

### 10.5 `pnpm test:balance` script (Phase 11 nâng cao §6 — DONE)

Root script đã land:

```json
// xuantoi/package.json
"test:balance": "pnpm --filter @xuantoi/shared test:balance"
// packages/shared/package.json
"test:balance": "vitest run balance"
```

Filter pattern `balance` match 7 file: `balance-dials.test.ts` +
`{boss,dungeons,items,missions,monsters,skills}-balance.test.ts` (196 test).

**Run trước mỗi PR content scale** để verify dial chưa drift + content
chưa vượt cap. AI/dev có lệnh kiểm tra nhanh, không cần chạy full
shared test suite (1124 test, ~10s) khi chỉ tune balance.

```bash
$ pnpm test:balance
# 7 test files, 196 tests, ~2s
```

---

## 11. HISTORICAL DECISIONS

### 11.1 Tại sao realm rate scale 1.45^order?

- Realm tier giữa (kim_dan-nguyen_anh) phải mất 2-3 ngày active để break.
- Realm tier cao (do_kiep+) phải mất 1+ tuần để break — điểm đến dài hạn.
- 1.45 cho slope vừa phải. Thử 1.6 → quá steep, người chơi thấy "luyenkhi vô nghĩa".
- Thử 1.3 → quá flat, late-game không có cảm giác mạnh lên.

### 11.2 Tại sao tick 30s thay vì 60s?

- 30s đủ ngắn để cảm giác "cộng EXP đều" nhưng không tạo CPU spike.
- Cron BullMQ chạy mỗi 30s scan tất cả `cultivating: true` character.
- Nếu DAU lớn (>10k) → chuyển sang per-character cron hoặc sharding (phase 17).

### 11.3 Tại sao 9 trọng (stage)?

- "Cửu trọng" là motif tu tiên cổ. Số 9 phù hợp văn hoá.
- 9 stage cho mỗi realm = 9 mốc nhỏ trong 1 mốc lớn → cảm giác progression liên tục.
- Phamnhan + hu_khong_chi_ton: 1 stage vì 2 cái này boundary (vào game / endgame).

### 11.4 Tại sao 5 quality (PHAM..THAN)?

- 5 = đủ phân tier mà không quá nhiều slot UI.
- Tăng thành 7-8 (e.g. thêm "huyền cao", "tiên cao") khi phase 12+ nếu cần.

### 11.5 Tại sao `linhThach` BigInt mà `tienNgoc` Int?

- linhThach: late-game cộng triệu/h → vài tỷ trong 1 tháng → vượt Int32 max (2.1 tỷ).
- tienNgoc: nạp tay, không tự sinh nhanh → Int đủ cho cap thực tế.

---

## 12. CHANGELOG

- **2026-04-30** — Initial creation. Author: Devin AI session 9q.
