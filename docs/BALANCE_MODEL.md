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
- **Method × Linh căn element affinity (Phase 11.1.E DONE)**: 1.00..1.10× cultivation rate (`METHOD_ELEMENT_PRIMARY_BONUS=0.10` primary match / `METHOD_ELEMENT_SECONDARY_BONUS=0.05` secondary match / 0 vô hệ method hoặc khác hệ). Pure helper `computeMethodElementAffinityBonus` trong `packages/shared/src/cultivation-methods.ts`.
- Sect aura: 1.0..1.2× cultivation rate (Phase 13).
- Pill `tu_vi_dan`: 1.5× cultivation rate trong 1h.

**Stack rule**: multiplicative cap 3.0× tổng (dial — bumped từ 2.5× để cover tien × tien hiếm-but-allowed; than × than × affinity 1.10 = 1.8 × 1.8 × 1.1 = 3.564 → cap 3.0). Vượt → cap.

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

**Phase 22.1 build-depth envelope**:
- Shared rule helpers in `elemental.ts` expose named APIs for generation/counter lookup, damage/resistance modifiers, and structured matchup classification. They reuse the shipped matrix above; no hidden second tuning table.
- Build recommendation (`elemental-build.ts`) reads primary/secondary linh căn, boss/dungeon target profile, skills and equipment affinity to return `mainElement`, `secondaryElement`, `recommendedSkills`, `recommendedStats`, `counterTips`, `warnings`, and `equipmentElement`.
- Skill synergy (`elemental-synergy.ts`) is intentionally modest: same-element `1.05`, generating combo `1.08`, counter combo `1.10`, hybrid reverse-generation `1.04`, validator range `1.00..1.15`. These are recommendation/metadata hooks, not a combat rewrite.
- Boss/dungeon resistance helper (`elemental-resistance.ts`) caps final preview damage through existing `0.5..1.6` elemental envelope so weakness gives advantage but never auto-win.
- Equipment affinity hook (`ItemDef.equipmentElement?`) is additive metadata for recommendations; full gem/socket/set-bonus loop remains Phase 23.1.

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

### 2.9.3 Phase 14.2.A — Elemental combat foundation dials (DONE this PR)

Phase 14.2.A bổ sung **lớp foundation** cho Ngũ Hành combat — giữ nguyên Phase 11.3.B chain (skill element vs character primary/secondary spirit-root) đồng thời thêm hai layer dữ liệu optional cho monster + equipment. Pipeline pure-function `applyElementalCombatAdjustment` (`packages/shared/src/elemental.ts`) compose 3 layer + clamp envelope:

```
base = elementalMultiplier(skillElement, defenderElement)
     + (skillElement === attackerPrimary ? CHARACTER_PRIMARY_BONUS : 0)
     + (skillElement ∈ attackerSecondary ? CHARACTER_SECONDARY_BONUS : 0)
mResist  = composeMonsterElementalResist(monster.elementalResist, skillElement)   // ≥ FLOOR (0.7)
eqBonus  = composeEquipmentElementalAtkBonus(equipment.elementalAtkBonus[], skill)   // ≤ TOTAL_CEIL (0.20)
final    = clamp(base × mResist × (1 + eqBonus), ADJUSTMENT_FLOOR, ADJUSTMENT_CEIL)
```

| Constant (`elemental.ts`) | Value | Áp lên | Ý nghĩa |
| --- | --- | --- | --- |
| `ELEMENT_MONSTER_RESIST_FLOOR` | **0.70** | `composeMonsterElementalResist` | Sàn cho monster.elementalResist[skillElement] — chống data sai làm gear-check 0× |
| `ELEMENT_EQUIPMENT_ATK_BONUS_CEIL` | **0.10** | per-item `elementalAtkBonus[skillElement]` | Trần 1 món trang bị, chống outlier item dữ liệu |
| `ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL` | **0.20** | tổng equipped slot `elementalAtkBonus[skillElement]` | Trần tổng stack 6 slot trang bị (additive), chống full-set roll cùng hệ |
| `ELEMENT_COMBAT_ADJUSTMENT_FLOOR` | **0.50** | `applyElementalCombatAdjustment` final | Sàn tổng pipeline (base × mResist × (1+eqBonus)) — guard runtime vs invalid data |
| `ELEMENT_COMBAT_ADJUSTMENT_CEIL` | **1.60** | `applyElementalCombatAdjustment` final | Trần tổng — counter (1.30) + primary (0.10) + secondary (0.05) + eqBonus (0.20) ≈ 1.65 (theoretical) → clamp 1.60 = headroom 0.05 |

**Note design intent**:
- `ELEMENT_MONSTER_RESIST_FLOOR=0.7` chọn nhẹ — không phá Phase 11.3.B counter `1.30×`. Một boss data `elementalResist[hoa]=0.5` (data sai) sẽ cap về 0.7, vẫn cho phép player damage normally.
- `ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL=0.20` ≈ +20% damage một hệ — tương đương 1 grade spiritual-root (Huyền Linh Căn statBonus 10%), nhưng chỉ 1 hệ (hệ khác = 0 stack).
- Final clamp `[0.5, 1.6]` rộng hơn `validateElementalModifier` envelope `[0.6, 1.5]` của Phase 11 nâng cao §3 (vì bao gồm equipment layer mới, có thể đẩy lên 1.65 lý thuyết).

**Wire điểm** (`apps/api/src/modules/combat/combat.service.ts`):
- `action()` (skill flow) + `actionViaActiveTalent()` (talent flow) parity: cùng compose qua `applyElementalCombatAdjustment` + cùng cấu trúc log.
- `inventory.service.ts` exposes `equipElementalAtkBonus(characterId, skillElement)` — đọc các slot equipped, gom `bonuses.elementalAtkBonus`, gọi `composeEquipmentElementalAtkBonus` (cap'd) → trả về số cộng additive cho combat.
- Combat log non-trivial events:
  - `monsterResistMul < 0.95` → `"<monster> kháng hệ <element> ×<x.xx>."`
  - `equipBonus ≥ 0.05` → `"Trang bị tăng <yy>% sát thương hệ <element>."`
  - Skip log khi neutral 1.0× → log impact thấp khi data chưa populate.

**Tương tác với Phase 11.3.B**: `characterSkillElementBonus` (Phase 11) vẫn áp **trước** Phase 14.2.A pipeline trong combat service damage flow. KHÔNG double-apply: 14.2.A pipeline lấy `skillElement` + `attackerPrimary`/`attackerSecondary` riêng từ `getOrCreateSpiritRootSet`, compose `base` qua `elementalMultiplier` + character bonus chỉ 1 lần. Phase 11.3.B `characterSkillElementBonus` chỉ phản ánh primary/secondary linh căn — Phase 14.2.A `base` đã bao gồm phần đó nên 2 layer là 2 wire điểm độc lập, không cộng dồn.

### 2.9.3.1 Phase 14.2.B — Elemental combat data + balance (DONE this PR)

Phase 14.2.B nâng cấp Phase 14.2.A từ pure-function pipeline trống dữ liệu thành **gameplay thật**. KHÔNG đụng dial constant ở §2.9.3 (envelope giữ nguyên), chỉ ship data + invariant test verify catalog tuân envelope.

**Catalog data ship**:

| Catalog file | Field | Số entry | Range chọn |
| --- | --- | --- | --- |
| `packages/shared/src/boss.ts` | `BossDef.elementalResist` | 6 boss | resist `[0.7, 0.92]` cho 1–2 hệ counter (giữ floor `0.70`) |
| `packages/shared/src/monsters.ts` | `MonsterDef.elementalResist` | 8 monster mid/late | resist `[0.7, 0.95]` cho 1 hệ counter |
| `packages/shared/src/items.ts` | `ItemBonus.elementalAtkBonus` | 6 equipment (3 weapon + 3 amulet) | per-item `[0.05, 0.10]` cho 1 hệ (giữ ceil `0.10`) |

**Tuning rationale**:

- **Resist 0.70 floor (KHÔNG nới)**: counter ×1.30 vs resist 0.7 → effective `1.30 × 0.7 = 0.91×` — dưới neutral 1.0× nhẹ. Player vẫn hơn neutral khi đánh bằng skill counter lên boss có resist, nhưng không spike như khi vô resist (1.30×). Nếu nới floor xuống 0.5 thì counter `1.30 × 0.5 = 0.65×` — player counter sẽ damage **kém hơn** neutral skill, phá design intent của Phase 11.3.B.
- **Per-item ceil 0.10 (KHÔNG nới)**: 1 weapon `+10%` skill kim ≈ ½ counter advantage. Stack 2 món cùng hệ kim (weapon + amulet) `+0.05+0.10 = +0.15` → cap về `0.20` total ceil chỉ đạt được khi farm full bộ. Anti-power-creep: player không thể stack 6 món cùng hệ → cap. Test invariant `composeEquipmentElementalAtkBonus` 6-slot worst-case verify clamp đúng.
- **Anti-power-creep guardrail invariant**: test `packages/shared/src/__tests__/elemental-data.test.ts` ép foundation pipeline ở **countered case + max bonus + min monster resist** (worst-case combo player thua) vẫn ở dưới `1.0×` — KHÔNG có cách nào để equipment bonus + linh-căn primary biến counter loss thành win. Concretely: countered ×0.70 × resist 0.7 (defender resist hệ player) × (1 + 0.20) eqBonus = `0.70 × 0.7 × 1.2 = 0.588×` — vẫn loss zone, KHÔNG vượt `1.0×`.

**Invariant tests** (`packages/shared/src/__tests__/elemental-data.test.ts` — 35 case):
- Catalog vs floor: ép mọi `BossDef.elementalResist[*]` ≥ `ELEMENT_MONSTER_RESIST_FLOOR=0.70` (catch data sai từ designer).
- Catalog vs ceil: ép mọi `ItemBonus.elementalAtkBonus[*]` ≤ `ELEMENT_EQUIPMENT_ATK_BONUS_CEIL=0.10` (catch outlier item).
- Gear-stack 6-slot worst case: simulate full-set 6 món cùng hệ + cap `composeEquipmentElementalAtkBonus` ≤ `ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL=0.20`.
- Anti-power-creep envelope: countered + max bonus + min resist `< 1.0×` (player KHÔNG bypass counter loss bằng farm).

**API integration tests** (`apps/api/src/modules/combat/combat.service.test.ts` Phase 14.2.B suite +5 case): xem §1 Executive Summary trên — verify foundation pipeline KHÔNG re-apply Phase 11.3.B base multiplier (deterministic test với `Math.random=0.5` + `tien` grade `statBonusPercent=0.18` → expected `dmg=659` integer match).

**KHÔNG nới dial Phase 14.2.A** — pipeline foundation, floor, ceil giữ nguyên. Phase 14.2.C tương lai có thể tune `ELEMENT_COUNTER_MULTIPLIER` / `ELEMENT_GENERATE_MULTIPLIER` theo metric thực tế khi player base lớn.

### 2.9.3.1B Phase 23.2 — Realm-scaled Equipment Progression

Equipment power now has an explicit realm/tier axis instead of relying on quality color alone.

| Equipment tier | Name | Realm orders | Base power |
|---:|---|---:|---:|
| 1 | Phàm Khí | 1–3 | 100 |
| 2 | Linh Khí | 4–6 | 260 |
| 3 | Huyền Khí | 7–9 | 680 |
| 4 | Địa Khí | 10–12 | 1,750 |
| 5 | Thiên Khí | 13–15 | 4,500 |
| 6 | Tiên Khí | 16–18 | 11,500 |
| 7 | Thánh Khí | 19–21 | 29,000 |
| 8 | Đạo Khí | 22–24 | 72,000 |
| 9 | Bản Nguyên Chí Bảo | 25–27 | 175,000 |
| 10 | Hư Không Chí Bảo | 28 | 420,000 |

**Rules / invariants**:
- Tier 1–9 have internal grades I/II/III matching the first/second/third realm in the tier; tier 10 is final-only.
- `requiredRealmOrder` is the authoritative equip gate. API equip throws `EQUIPMENT_REALM_LOCKED` when character realm order is lower; unequip and consumables are unaffected.
- Quality multipliers stay within tier: PHAM 1.00, LINH 1.15, HUYEN 1.35, TIEN 1.60, THAN 1.90. Quality is rarity, not the whole progression ladder.
- Slot weights: weapon 1.00, armor 0.85, helmet/trâm 0.55, boots 0.45, belt 0.35, artifact/offhand 0.70, ring/amulet 0.40.
- Enhance caps are tier-bound (+5, +7, …, +23) with multiplier `1 + enhanceLevel × 0.03`; enhancement cannot replace realm/tier progression.
- Socket caps are bounded by quality and tier; gem bonus total is capped at 20% item power. Set bonus envelope: 2pc 3–5%, 4pc 6–10%, 6pc 10–15% or cooldown/cap special effect.

Primary code: `packages/shared/src/equipment-progression.ts`. Tests enforce tier coverage, grade mapping, caps, deterministic power score, progression validation, existing item metadata derivation, and API realm gate behavior.

### 2.9.3.1C Phase 23.3 — Set Bonus + Gear Resonance

Phase 23.3 layers a **set bonus** (2/4/6 pieces) and a **gear resonance** system on top of the Phase 23.2 realm-scaled equipment progression without replacing tier/quality balance. All bonuses are **ratio-only** on the **raw `item.bonuses` baseline** — they never re-amplify socket / refine / substat / enchant amplified totals, so progression layers do not double-count.

**Set Bonus catalog** (`packages/shared/src/equipment-set-bonus.ts`): 10 sets across the 5 Ngũ Hành elements, with a mid-tier (tier 4) + endgame (tier 8) entry per element. Each set has `setKey`, vi/en name, `elementAffinity`, `allowedTiers`, `requiredRealmOrder`, `requiredSlots`, 2/4/6 bonus envelopes, and a `bonusCap`. Pieces are deduped by `inventoryItemId` and by `slot`, so a duplicate item or slot never doubles a bonus tier.

| Set tier | Bonus envelope ratios |
| --- | --- |
| 2 pieces | total ≤ 5% (target 3–5%) |
| 4 pieces | total ≤ 10% (target 6–10%) |
| 6 pieces | total ≤ 15% (target 10–15%) |
| Per-set bonus cap | hard ceiling per `set.bonusCap`, currently 0.15 |

**Gear Resonance** (`packages/shared/src/equipment-resonance.ts`): 5 kinds, all ratio-only, balanced across ATK/DEF/HP/MP/spirit.

| Kind | Activation | Ratio total |
| --- | --- | --- |
| Same-Tier | 6/6 pieces ≥ shared min tier | ~3% balanced |
| Enhance | 6/6 pieces ≥ +5, +8, +12, +15 (per mốc) | each 2–3%, total ≤ 10% (`RESONANCE_ENHANCE_TOTAL_CAP`) |
| Quality | 6/6 pieces ≥ HUYEN / TIEN / THAN | 2–4% balanced |
| Elemental | 4/6 same element → 4%; 6/6 → 6% role-tuned (Kim=ATK, Mộc=HP/MP, Thuỷ=DEF/spirit, Hoả=ATK, Thổ=DEF/HP) |
| Hybrid | tương sinh pair (Mộc→Hoả, Hoả→Thổ, Thổ→Kim, Kim→Thuỷ, Thuỷ→Mộc), ≥ 2 each + ≥ 4 total | 3% balanced (mixed) |

**Orchestrator + global cap** (`packages/shared/src/equipment-build.ts`):

- `summarizeEquipmentBuild()` is pure and deterministic: groups pieces by `setKey`, computes active set tiers + envelope cap, computes resonance effects, then sums into a single `totalBonusRatio` clamped by `EQUIPMENT_BUILD_TOTAL_BONUS_CAP = 0.30` (proportional scale-down preserves cross-stat ratios).
- `applyBuildBonusRatio(baseline, ratio)` multiplies the **raw** `item.bonuses` baseline only. Sockets / refine / substats / enchants pass through their own caps and are NOT re-amplified.
- `EquipmentBuildSummary.resonanceTier`: NONE / BASIC / TUNED / HARMONIZED / ASCENDANT — used by UI badges, no gameplay effect on its own.

**Anti-abuse invariants** (tests under `packages/shared/src/equipment-{set-bonus,resonance,build}.test.ts`, 60+ cases):

- `setKey` unique across catalog.
- `validateSetBonusDefinition` rejects sets with required slots ⊄ allowed slots, 2/4/6 ratio above tier cap, 6-piece ratio over `bonusCap`, requiredRealmOrder out of tier-realm window.
- Dedup by `inventoryItemId` AND by `slot` — duplicate item or two items in the same slot cannot trigger an extra bonus tier.
- Set bonus only counts pieces that actually match `allowedTiers` + (optionally) `elementAffinity`, so a low-tier piece cannot keep a high-tier set active.
- Resonance `validateResonanceDefinition` enforces enhance total cap and refuses negative ratios.
- Build orchestrator caps the **sum of all ratios** (set + resonance) at 30%, so even fully outfitted endgame players cannot stack to a power spike.

**API + UI surface**:

- `GET /inventory/build` returns the build summary serialized for the current logged-in character (or `summary: null` if no Phase 23.2 piece is equipped).
- `InventoryService.equipBonus()` applies the build ratio inside the same loop that aggregates socket / refine / substat / enchant bonuses, but only on baseline ATK/DEF/HP/MP/spirit captured before amplification.
- Inventory view ships an `EquipmentBuildPanel` (vi/en parity) showing main element, piece count, active set count + missing slots, active set tier descriptions, resonance tier, gear resonance effects, and total bonus percent.

**Follow-ups**: Phase 23.4 (upgrade economy / resource sink for set completion), Phase 25.1 (Battle Pass / VIP Light), Phase 24.2 (final QA tuning of caps if needed).

### 2.9.3.1D Phase 23.4 — Equipment Upgrade Economy / Resource Sink (DONE this PR)

Phase 23.4 standardises the **cost / yield curves** for every equipment mutation introduced by Phase 23.2 (tier ladder + `requiredRealmOrder` + `powerBudget`) and Phase 23.3 (set bonus + gear resonance). All numbers are emitted by deterministic shared helpers in `packages/shared/src/equipment-upgrade-economy.ts`; runtime services consume the helpers and never hard-code costs.

**Enhance cost** — `getEquipmentEnhanceCost`:
- `linhThachCost = round(BASE_TIER_COST × slotWeight × qualityMultiplier × 1.25 ^ currentEnhanceLevel)`.
- `BASE_TIER_COST = 50 × equipmentTier` (linh thạch).
- `slotWeight` — `WEAPON`/`ARMOR` = 1.0; `HAT`/`BOOTS`/`BELT` = 0.7; `TRAM`/`ARTIFACT` = 0.5.
- `qualityMultiplier` — `PHAM` = 1.0, `LINH` = 1.3, `HUYEN` = 1.7, `TIEN` = 2.2, `THAN` = 3.0.
- `protectionRecommended` flips `true` at `currentEnhanceLevel ≥ 6` (stage `risky`) for `HUYEN+`; `protectionRequired` flips at `currentEnhanceLevel ≥ 11` (stage `extreme`) for `HUYEN+`. The legacy `RefineService` is back-compat — protection is **advisory**, not enforced; monetization wire deferred to Phase 25.1.

**Merge cost** — `getEquipmentMergeCost`:

| Source quality | Output quality | Linh thạch (per tier) | Material |
| --- | --- | --- | --- |
| `PHAM` ×3 | `LINH` ×1 | 200 × tier | `tinh_thiet` ×(2 × tier) |
| `LINH` ×3 | `HUYEN` ×1 | 600 × tier | `tinh_thiet` ×(4 × tier) |
| `HUYEN` ×3 | `TIEN` ×1 | 1800 × tier | `yeu_dan` ×(2 × tier) |
| `TIEN` ×3 | `THAN` ×1 | 6000 × tier | `han_ngoc` ×(1 × tier) |
| `THAN` ×3 | — | rejected | `MERGE_CAP_REACHED` |

Merge always operates on **3 items of the same `equipmentTier`, slot, quality, and item family**. Cross-tier merges, cross-slot merges, or rolling `THAN` upward are rejected by `validateEquipmentMergeRequest` before any ledger row is written. `findEquipmentMergeRecipe(itemKey)` returns the canonical output item key (e.g. `kim_phong_kiem` `PHAM` × 3 → `kim_phong_kiem` `LINH`).

**Dismantle yield** — `getEquipmentDismantleYield`:

| Quality | Linh thạch yield | Material yield |
| --- | --- | --- |
| `PHAM` | 10 × tier | `tinh_thiet` ×1 |
| `LINH` | 30 × tier | `tinh_thiet` ×2 (+ `spirit_dust` ×1 if tier ≥ 3) |
| `HUYEN` | 100 × tier | `yeu_dan` ×1 + `huyen_manh_pham` ×1 |
| `TIEN` | 300 × tier | `yeu_dan` ×2 + `han_ngoc` ×1 |
| `THAN` | 1000 × tier | `han_ngoc` ×2 + `than_tinh` ×1 (rare) |

**Anti-infinite-sink invariant** (test enforced): for every quality and tier, `dismantleYield × 3 < mergeCost` for the same input quality at the same tier. A merge cannot be unwound by dismantling the output for a net gain; the economy always burns resources.

**Gem socket / unsocket cost** — `getGemSocketCost` / `getGemUnsocketCost`:
- `socketCost = round(50 × equipmentTier × (1 + currentSocketCount × 0.5))` linh thạch.
- `unsocketCost = round(100 × equipmentTier × (1 + currentSocketCount × 0.5))` linh thạch + 1 `tach_ngoc_phu`.
- Socket cap remains the Phase 23.2 `socketCap(tier, quality)` value. Gem bonus stays capped at 20% per slot.

**Reforge cap** — `getReforgeCost`:
- `cost = baseReforgeCost(quality) × 1.15 ^ min(reforgeCount, 20)`.
- `maxReforgeCount` per quality: `PHAM`=5, `LINH`=8, `HUYEN`=12, `TIEN`=16, `THAN`=20. Exceeding the cap throws `REFORGE_CAP_REACHED` in `EquipmentService.reforge`.

**Anti-abuse invariants** (tests under `packages/shared/src/equipment-upgrade-economy.test.ts` + `apps/api/src/modules/character/equipment-economy.service.test.ts`):
- All cost helpers are **deterministic** — same input → identical output.
- Merge rejects: not 3 items, duplicate ids, mixed `itemKey`, equipped item, non-owned item, missing catalog recipe, insufficient linh thạch, insufficient material.
- Dismantle rejects: equipped, non-owned.
- Idempotency: `mergeEquipment(characterId, ids, idempotencyKey)` retried with the same key replays the original ledger row instead of double-spending. Same pattern for `dismantleEquipment`.
- Server authority: all mutations run inside `prisma.$transaction` with `updateMany` race guards; partial failure rolls back every ledger row and currency adjustment.

**Follow-ups**: Phase 25.1 wires `refine_protection_charm` into Battle Pass / Monthly Card / VIP Light shops; Phase 23.5 split out Pháp Bảo (advanced artifact) economy (DONE — xem §2.9.3.1E); Phase 24.2 final QA pass on protection thresholds.

### 2.9.3.1E Phase 23.5 — Pháp Bảo Advanced Artifact Foundation (DONE this PR)

Phase 23.5 thêm hệ **Pháp Bảo** là slot riêng (`ARTIFACT_1/2/3` đã có trong `EquipSlot`, hiện active `ARTIFACT_1`), ngoài 8 trang bị chính. Catalog + helpers nằm trong `packages/shared/src/phap-bao.ts`; runtime service `apps/api/src/modules/character/phap-bao.service.ts` read-only (luyện khí reuse `/character/refine`, equip reuse `/inventory/equip`).

**Tier ladder** — `getPhapBaoTierForRealmOrder` map 28 cảnh giới → 10 tier giống equipment (1–3 → tier 1, 4–6 → 2, …, 28 → 10). Pháp bảo `requiredRealmOrder` server-authoritative (Phase 23.2 path đã enforce ở `InventoryService.equip`).

**Catalog foundation** (10 pháp bảo) — `artifactTier × quality × element × role`:

| Artifact | Tier | Realm gate | Quality | Element | Role |
| --- | --- | --- | --- | --- | --- |
| Ngũ Hành Linh Châu | 2 | 4 | LINH | NEUTRAL | support |
| Thanh Liên Kiếm Ấn | 3 | 7 | HUYEN | kim | burst |
| Huyền Thiên Kính | 4 | 10 | HUYEN | thuy | control |
| Huyết Nguyệt Hồ Lô | 5 | 13 | TIEN | hoa | sustain |
| Thổ Linh Sơn Ấn | 5 | 13 | TIEN | tho | defense |
| Cửu Diễm Phiến | 6 | 16 | TIEN | hoa | burst |
| Mộc Linh Bình | 6 | 16 | TIEN | moc | sustain |
| Băng Tâm Ngọc Kính | 7 | 19 | TIEN | thuy | control |
| Kim Quang Bảo Luân | 8 | 22 | THAN | kim | burst |
| Hậu Thổ Trấn Hồn Ấn | 9 | 25 | THAN | tho | defense |

**Passive bonus** — `computePhapBaoPassiveBonus` = `baseEffect × refineLevel + starLevel × starBonus`, clamp tổng ≤ 50% `powerBudget`. Pháp bảo contribution vào power score ≈ 10–18% baseline (`computePhapBaoPowerScore` × tier curve).

**Active skill** — `computePhapBaoActiveSkillPreview`:
- Unlock khi `starLevel >= def.activeSkill.unlockStar` (foundation `starLevel=0` → active LOCKED đến Phase 23.6).
- Cooldown floor 30s; mỗi sao giảm 5s cooldown (clamp `baseCooldownSec → cooldownFloorSec`).
- Active skill không quyết định 100% trận đấu (effect baseline ≤ atk 12 / heal 10% HP).

**Refine cost** — `getPhapBaoUpgradeCost`:
- `linhThachCost = round(750 × refineLevel × tier × qualityMultiplier × 1.4 ^ refineLevel)`.
- Material `<artifactKey>_essence` ×(2 × refineLevel × tier).
- Refine cap `def.refineCap` (typically 8–10 theo tier). Pháp bảo refine cost **cao hơn ~50%** so với equipment thường (build identity sink).

**Star-up cost** (preview only Phase 23.5):
- `linhThachCost = round(1200 × (starLevel + 1) × tier × qualityMultiplier × 1.5 ^ starLevel)`.
- Material `<artifactKey>_shard` ×(5 × (starLevel + 1) × tier).
- Star cap `def.starCap` (3–5 tuỳ pháp bảo).
- `starUpEnabled = false` → button disabled, preview cost chỉ để FE render tooltip.

**Awaken cost** (preview only Phase 23.5):
- Chỉ available khi quality ≥ `TIEN` && `def.artifactTier >= 5` && `starLevel >= 1` && `def.awakenCap > 0`.
- `linhThachCost = round(5000 × (awakenStage + 1) × tier × qualityMultiplier × 1.8 ^ awakenStage)` + `awaken_stone` ×(1 + awakenStage) + material chính ×(10 × tier).
- `awakenEnabled = false` → tương tự star.

**Anti-abuse invariants** (`packages/shared/src/phap-bao.test.ts` 45 cases):
- Catalog `artifactKey` unique; tier ∈ [1, 10]; `requiredRealmOrder` ∈ [1, 28].
- `canEquipPhapBao(characterRealmOrder, def)` true iff `characterRealmOrder >= def.requiredRealmOrder` — không thể equip vượt cảnh giới.
- Power score deterministic theo `(refineLevel, starLevel, awakenStage, tier, quality)`.
- Passive bonus tổng `≤ powerBudget × 0.5` cho mọi `(refineLevel, starLevel, awakenStage)` trong cap.
- Active skill cooldown floor `>= 30s` cho mọi pháp bảo có damage tier ≥ medium.
- Upgrade cost monotonic — `refineLevel n → n+1` có `linhThachCost(n+1) > linhThachCost(n)`. Same cho star + awaken.
- `validatePhapBaoDefinition` fail khi: thiếu `requiredRealmOrder` / `artifactTier`; tier mismatch realm map; effect vượt cap; active skill thiếu cooldown.

**Free vs premium-safe**: foundation chỉ surface refine path; thăng sao + thức tỉnh persist defer Phase 23.6/25.1. Phase 25.1 sẽ thêm:
- Premium-safe drop pháp bảo trong cùng tier (không vượt cảnh giới).
- Premium-safe mảnh pháp bảo + nguyên liệu luyện khí.
- Bảo hộ luyện pháp bảo (giảm risk fail khi refine high stage).
- Lựa chọn pháp bảo từ Battle Pass / event.

**Follow-ups**: Phase 23.6 enable star-up + awaken persistence + visual rarity FX; Phase 25.1 monetization-safe hook (premium drop trong tier, không bán pháp bảo top tier hoặc max sao trực tiếp); Phase 24.2/24.3 final QA polish.

### 2.9.3.2 Phase 14.2.C — Elemental skill tree expansion (DONE this PR)

Phase 14.2.C biến Ngũ Hành từ damage/resist multiplier thành **hệ kỹ năng có hướng chơi riêng**: Mộc = hồi/độc, Hỏa = burst/thiêu, Thổ = khiên/khống, Kim = xuyên/chí, Thủy = control/hồi linh. KHÔNG đụng damage formula, KHÔNG đụng dial 14.2.A, chỉ thêm tag side-effect dial.

**Skill tag side-effect dial** (`packages/shared/src/elemental-skills.ts`):

| Const | Value | Áp dụng | Mục tiêu balance |
| --- | --- | --- | --- |
| `SKILL_TAG_DOT_DAMAGE_RATIO` | **0.15** | DOT perTurn damage = `floor(skillDmg × 0.15)` | DOT 1 lượt ≈ 15% sát thương 1-shot — sub-linear vs raw skill, anti-cheese |
| `SKILL_TAG_DOT_TURNS` | **3** | DOT persist 3 lượt | Tổng DOT = `~45%` sát thương 1-shot extra trong 3 lượt → tier sát thương ngang skill cùng level nhưng trải dài |
| `SKILL_TAG_SHIELD_HP_RATIO` | **0.10** | Shield absorb = `floor(hpMax × 0.10)` | Shield ≈ 10% hpMax — đủ chặn 1 reply trung bình monster, không phá tank build |

**Tuning rationale**:

- **DOT 0.15 × 3 = 0.45 (KHÔNG nới)**: Tổng DOT sub-linear vs raw skill (vd Mộc Độc Vạn Trường atkScale 1.5 vs Mộc Sinh Trượng atkScale 1.7). Player chọn DOT là chọn **trade upfront damage cho damage trải lượt** + áp lực kill timer. Nếu nới ratio 0.20 → tổng 60% → DOT skill out-DPS skill non-DOT cùng atkScale → meta lệch về DOT only. Hold 0.15.
- **DOT 3 lượt (KHÔNG nới dài hơn)**: 3 lượt đủ để nhìn thấy effect (UX cảm nhận được DOT) nhưng không quá dài (4-5 lượt sẽ khoá monster hp chỉ qua 1 cast → bypass cooldown). Single-active model (overwrite policy) — re-cast DOT sẽ refresh nhưng không stack — anti-DOT-stacking abuse.
- **SHIELD 0.10 hpMax (KHÔNG nới)**: Vào lượt cast monster reply trung bình ≈ 5-15% hpMax. Shield 10% chặn 1 reply trung bình + lower bound. Single-use, KHÔNG persist sang lượt sau → player phải chọn cast shield có timing (reactive vs predictive). Nếu nới 0.15 → 1 shield = 1.5 reply → shield = on-demand invuln, phá design intent.
- **Anti-burst-cheese**: SHIELD áp **TRƯỚC** buff shield (compose tuần tự skill → buff → remaining damage). Skill shield single-cast 10% + buff shield (Phase 11.8.A đã có) compose → tổng < `0.30` (skill 0.10 + buff cap ~0.20) đủ chặn burst nhưng KHÔNG phá thang reply progression.

**Skill catalog invariant** (`packages/shared/src/elemental-skills.test.ts` — 48 case):

- Mỗi `ElementKey` có ≥ 2 skill (5 hệ × 2 = ≥10) — `findElementIdentityCoverageGaps` ép mọi `primaryTags` của hệ có ít nhất 1 skill match.
- `validateSkillTag(skill, tag)`: invalid tag → reject; DOT/SHIELD/CONTROL **YÊU CẦU** `skill.element != null` (passive vô hệ không thể tag side-effect).
- `computeSkillAffinityDelta`: primary `+0.10`, secondary `+0.05`, không match `0.0` — match Phase 11.3.B `characterSkillElementBonus` semantics.
- Side-effect dial range: `0 < SKILL_TAG_DOT_DAMAGE_RATIO ≤ 0.20`, `1 ≤ SKILL_TAG_DOT_TURNS ≤ 5`, `0 < SKILL_TAG_SHIELD_HP_RATIO ≤ 0.15` — sentinel để future tune không vượt anti-cheese threshold.

**API integration tests** (`apps/api/src/modules/combat/combat.service.test.ts` Phase 14.2.C suite +6 case): DOT cast → `monsterDot` persist với `turnsLeft=3`; DOT tick → log "chịu N sát thương DOT" + decrement; DOT clear khi monster killed (chuyển monster mới); SHIELD cast → log "Khiên \<element\> hấp thu N sát thương phản kích"; SHIELD KHÔNG persist sang turn 2 (state không lưu `playerShield`); legacy skill (`kim_quang_tram`, không tags) → KHÔNG set monsterDot, KHÔNG log shield.

**KHÔNG đổi**: Damage formula, character affinity bonus (Phase 11.3.B `characterSkillElementBonus` 0.7..1.40), monster resist (Phase 14.2.B 0.7 floor), equipment elementalAtkBonus (Phase 14.2.B 0.10/0.20 cap). Tag side-effect chỉ thêm **side-channel** (DOT damage post-skill, Shield absorb post-cast), KHÔNG re-multiply skill damage.

### 2.9.3 Phase 11.3.D wire điểm (Pending)

- UI character profile display Linh căn.
- Reroll service consume `linh_can_dan` ItemLedger + insert log `source='reroll'` + `rootRerollCount++`.

### 2.9.4 Phase 11.1.B wire điểm — Cultivation Method (Công pháp) compose (DONE)

`CultivationProcessor.process()` compose method `expMultiplier` thêm vào gain công thức:

```
baseGain    = cultivationRateForRealm(realm) + floor(spirit/4)
cultivMul   = isValidSpiritualRootGrade(grade) ? def.cultivationMultiplier : 1.0
methodMul   = methodExpMultiplierFor(equippedCultivationMethodKey)  // 1.0 nếu null
affMul      = 1 + computeMethodElementAffinityForCharacter(             // Phase 11.1.E
                primaryElement,
                secondaryElements,
                equippedCultivationMethodKey
              )                                                         // 1.00 / 1.05 / 1.10
gain        = BigInt(max(1, round(baseGain * cultivMul * methodMul * affMul)))
```

> Phase 11.1.E (this PR) thêm `affMul` factor — Linh căn × Cultivation Method
> element affinity bonus. Multiplicative compose. Source-of-truth dial:
> `METHOD_ELEMENT_PRIMARY_BONUS = 0.10` + `METHOD_ELEMENT_SECONDARY_BONUS = 0.05`
> trong `packages/shared/src/balance-dials.ts`. Pure helper logic:
> primary === method.element → +10%; method.element ∈ secondaryElements → +5%;
> vô hệ method (element=null) hoặc legacy character (primaryElement=null) → 0.

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

### 2.9.3.3 Phase 14.2.D — Elemental dungeon and boss identity (DONE this PR)

Phase 14.2.D thêm **identity metadata** cho dungeon/boss để player biết "dungeon hệ X → khuyến nghị skill hệ Y", "boss hệ X bị khắc bởi Y". KHÔNG đụng damage formula, KHÔNG nới resist floor, KHÔNG thêm multiplier mới — chỉ là UI hint.

**Field mới (UI hint thuần)**:
- `DungeonDef.dominantElement?` / `recommendedCounterElement?` / `rewardElementHint?` — derive từ `element` (legacy Phase 10 PR-3) nếu không set.
- `BossDef.weaknessElement?` / `resistElements?` / `rewardElementHint?` — derive từ `element` (Phase 14.2.B) + `elementalResist` keys (resist `< 1.0`) nếu không set.

**Anti-double-multiplier guarantee**: combat damage **không đọc** field mới. Damage vẫn tính qua `elementalMultiplier(skillElement, monster.element)` (Phase 11.3.B) + `composeMonsterElementalResist(monster.elementalResist, skillElement)` (Phase 14.2.B). Test `combat.service.element-identity.test.ts` lock-in: response không expose multiplier numeric. Validator `validateBossElementProfile()` ép `weaknessElement === counter(element)` để hint match thực tế (FE recommendation = damage actual).

**Catalog invariant** (test backstop):
- Mỗi Ngũ Hành có ≥ 1 dungeon `dominantElement === <element>` (coverage: 9 dungeons spread 5 elements).
- Mỗi Ngũ Hành có ≥ 1 boss `element === <element>` (coverage: 12 bosses spread 5 elements).
- `weaknessElement` luôn === `elementCounter(element)` khi cả 2 set (boss).
- `resistElements ⊆ Object.keys(elementalResist where v < 1.0)` (boss) — UI hint không mâu thuẫn với combat resist.

**KHÔNG nới dial Phase 14.2.A/B** — pipeline foundation, floor `0.70`, ceil `0.50` giữ nguyên. Phase 14.2.D pure UI/data — designer thêm flavor/recommendation cho content existing, không thay đổi power-curve.

### 2.9.6 Phase 12.10.C — NPC Affinity Shop balance (DONE this PR)

Phase 12.10.C thêm **NPC affinity shop** mở khoá theo tier. Mỗi NPC chính có 2–3 item nhỏ; tier càng cao item càng đắt + giới hạn càng thấp. Tránh phá economy (cap cost theo tier, cap daily-purchase per NPC).

**Cost cap theo tier (LINH_THACH)** — validator enforce:

| Tier            | Min score | Max cost (LT) |
|-----------------|-----------|---------------|
| `xa_la`         | 0         | ≤ 250         |
| `quen_biet`     | 10        | ≤ 250         |
| `ban_huu`       | 30        | ≤ 1500        |
| `tri_giao`      | 60        | ≤ 2500        |
| `tri_ky`        | 100       | ≤ 2500        |

**TIEN_NGOC items**: chỉ mở từ `tri_giao` trở lên, cost ≤ 50 TN per item. Mỗi NPC chỉ có ≤ 1 item TN, weekly limit ≤ 1.

**Stock cap (anti-grind)** — validator enforce:
- `stockType === 'daily'`: `dailyLimit ∈ [1, 10]`
- `stockType === 'weekly'`: `weeklyLimit ∈ [1, 5]`
- `stockType === 'unlimited'`: rare item KHÔNG được dùng, low-cost consumable only.
- Sum daily-limit của tất cả item per NPC ≤ 30 (giả sử player chăm 1 NPC vẫn không kéo > 30 item/day → tránh tự nuôi inventory rare-pill).

**No double-grant guarantee**: buy flow là Prisma `$transaction` atomic — re-check tier + window count trước spend, nếu fail rollback toàn bộ. ItemLedger row (`reason='NPC_SHOP_BUY'`) tạo sau grant nên window count luôn nhất quán với inventory.

**KHÔNG bán item phá economy**: catalog không có S+ tier weapon/armor/skillbook power-creep — chỉ có rare consumable (pill, food, focus item) + skillbook elemental basic (đã có trong base catalog) + cosmetic-flavor item. Designer thêm item mới phải qua review balance.

### 2.9.7 Phase 12.10.D — NPC Relationship Quest Chain reward cap (DONE this PR)

Phase 12.10.D thêm **NPC relationship quest chain** — chuỗi quest gắn theo `affinity tier`. Sau khi player hoàn thành toàn chain, claim 1 reward gói (one-shot, idempotent). Reward designed nhỏ — chain là **content gate** chứ không phải **power source**, để tránh meta "chăm NPC để gear-up nhanh".

**Reward cap per chain** — `validateNpcRelationshipChainsCatalog()` enforce:

| Field            | Cap per chain |
|------------------|---------------|
| `affinity`       | ≤ 40          |
| `linhThach`      | ≤ 500         |
| `tienNgoc`       | ≤ 10          |
| `exp`            | ≤ 600         |
| `items[].length` | ≤ 3 entry     |
| `items[].qty`    | ≤ 5           |

**Logic cap**:
- `affinity ≤ 40`: ngang vài lần gift quà chuẩn (gift = 5–8/lần, daily limit 3 = 15–24/ngày). Player chăm gift vẫn nhanh hơn farm chain → chain reward mang tính kỷ niệm/celebration, không phải shortcut.
- `linhThach ≤ 500`: ngang reward 1 quest realm-tier mid (so với daily quest grant ~100–200 LT mỗi quest). Chain có 1–3 quest → tổng reward bao gồm cả quest claim + chain bonus, nhưng chain bonus chỉ là extra layer.
- `tienNgoc ≤ 10`: cực kỳ hiếm — chỉ chain hidden tier cao (`ban_huu`+) mới có TN reward, và max 10 TN ngang 1 daily login bonus đủ ngày. Chain TN không thay thế gacha/topup.
- `exp ≤ 600`: ngang reward 1 quest realm-tier mid. Không bypass cultivation curve.
- `items ≤ 3 entry × ≤ 5 qty`: chain có thể grant 1 rare consumable + 1–2 small consumable. KHÔNG grant skillbook/weapon/equipment — chain reward chỉ flavor item + buff potion. Designer thêm item mới phải qua review.

**KHÔNG double-grant guarantee**: claim flow là `prisma.$transaction` với JSON-path CAS guard trên `Character.storyFlags` — `("storyFlags" ->> '${chainKey}_claimed') IS DISTINCT FROM '1'`. Race condition (Promise.all 2 claim concurrent) → đúng 1 winner; loser nhận `CHAIN_ALREADY_CLAIMED` 409. Test `npc-relationship-chain.service.test.ts` verify race + retry idempotent. Ledger row (`reason='NPC_RELATIONSHIP_CHAIN_REWARD'` + `refType='NpcRelationshipChain'` + `refId='${chainKey}'`) đảm bảo audit trail.

**Tier gate**: chain `requiredAffinityTier` enforce thực tế trong claim — không có cách nào "claim trước rồi tier sau". Hidden chain (`hidden=true`) không xuất hiện trong panel UI cho tới khi tier đủ → preserve mystery cho bí cảnh / bloodline reveal arcs (e.g. `relchain_to_nguyet_ly_lineage` chỉ visible từ `ban_huu`).

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

### 3.5 Phase 15.0.A — Reforge / Enchant power budget

**Nguyên tắc**: 2 sink mới (reforge substat phụ + enchant Ngũ Hành) đóng góp **additive** vào `equipBonus` qua `InventoryService.equipBonus`, KHÔNG nhân với refine multiplier (Phase 11.5) → tổng power foundation phase < +20% so với baseline `ItemDef.bonuses`. Mục tiêu: cho late-game player có sink tiêu thụ linhThach + material mà KHÔNG lật meta Arena/PvE tier.

#### 3.5.1 Reforge substat slots + value range (`EQUIPMENT_REFORGE_CONFIG`)

| Quality | Slots | atk range | def range | hpMax range | mpMax range | spirit range |
|---|:---:|---:|---:|---:|---:|---:|
| PHAM  | 1 | 1..2  | 1..2  | 5..12  | 3..8   | 1..1 |
| LINH  | 2 | 1..3  | 1..3  | 8..20  | 5..12  | 1..2 |
| HUYEN | 3 | 2..5  | 2..5  | 15..35 | 8..20  | 1..3 |
| TIEN  | 3 | 3..7  | 3..7  | 25..55 | 15..30 | 2..4 |
| THAN  | 4 | 4..10 | 4..10 | 40..80 | 20..45 | 3..6 |

**Worst-case totals** (tất cả slot roll max cùng kind):
- PHAM: 1 × atk_max=2 → +2 atk (≈ 20% base atk PHAM weapon = 10) → trong budget +20%.
- LINH: 2 × atk_max=3 → +6 atk (24% base 25) → trong budget +25% (allow extra cho late-game progression).
- HUYEN: 3 × atk_max=5 → +15 atk (25% base 60).
- TIEN: 3 × atk_max=7 → +21 atk (10.5% base 200) — buffer rộng cho future tuning.
- THAN: 4 × atk_max=10 → +40 atk (5% base 800) — endgame budget tighten để giữ tier gap.

#### 3.5.2 Enchant per-level bonus + cap (`ELEMENTAL_ENCHANT_EFFECTS` × `MAX_ENCHANT_LEVEL=5`)

| Element | Identity | Stat kind | Bonus per level | Max bonus (level 5) |
|---|---|---|---:|---:|
| Mộc (`moc`)  | Sustain / heal       | hpMax | +12 | +60  |
| Hỏa (`hoa`)  | Burst                | atk   | +2  | +10  |
| Thổ (`tho`)  | Defense / shield     | def   | +2  | +10  |
| Kim (`kim`)  | Crit / armor pierce  | atk   | +1  | +5   |
| Thủy (`thuy`)| Control / recovery   | mpMax | +6  | +30  |

**Element identity**: Mộc cao nhất hpMax (sustain), Hỏa cao nhất atk per level (burst), Kim atk thấp hơn Hỏa nhưng reserve cho future crit/pierce effect (chưa wire ở foundation), Thuỷ mpMax cho mana economy. Bonus deliberately nhỏ — tổng max enchant level 5 < 1 tier item bonus base (vd. Hỏa max +10 atk ≈ tier LINH bonus.atk).

**Element lock**: enchant level ≥ 1 thì element bị khoá (`ELEMENT_LOCKED` reject request element khác). Player cần level lên cùng hệ — tránh swap hệ liên tục để săn meta. Foundation phase chưa có "phế hệ" item.

#### 3.5.3 Combat / Arena impact

`InventoryService.equipBonus` cộng substats + enchant qua:

```typescript
equipBonus = {
  atk: ItemDef.bonuses.atk + composeSubstatBonus(substats).atk + composeEnchantBonus(element, level).atk,
  def: ...,
  hpMax: ...,
  mpMax: ...,
  spirit: ...,
}
```

→ `CombatService.derivedStats` tự include qua pipeline cũ. Arena snapshot Phase 14.1.B capture `equipBonus` đã tính reforge + enchant tại match time → matchmaking ELO không skew. Combat determinism không bị phá (substat values là JSON snapshot, không có RNG runtime).

#### 3.5.4 Anti-power-creep guard

- **Foundation budget**: max total reforge + enchant ≤ +20% baseline tier per item. Nếu sau telemetry thấy player late-game cảm thấy "underpower", future PR có thể nâng `bonusPerLevel` (×1.2..×1.5) HOẶC nâng `MAX_ENCHANT_LEVEL` (5 → 7) — KHÔNG nâng cả hai cùng lúc.
- **No multiplicative scaling**: substat + enchant cộng additive với `ItemDef.bonuses`, KHÔNG nhân với refine multiplier (Phase 11.5) → max stack power growth = baseline + refine_multi + reforge + enchant additive, không có loop nhân vô hạn.
- **No cross-element synergy**: enchant 1 hệ chỉ apply 1 statKind. Future PR có thể thêm "ngũ hành chu thiên" (5 trang bị 5 hệ → set bonus) — defer balance review.
- **Validation gate**: tests `equipment-upgrade.test.ts` (shared) + `equipment.service.test.ts` (API) verify range/cap/cost positive. Unit test fail → CI block merge.

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

### 4.7 Phase 14.1.A — Combat determinism audit (DONE this PR)

**Mục tiêu**: chuẩn bị nền cho Arena PvP bất đồng bộ — đảm bảo
combat critical path có thể replay với cùng seed → cùng kết quả.
**KHÔNG đổi balance**, **KHÔNG rewrite combat system**.

**Determinism contract**:

```
result = resolveCombatWithSnapshot({
  attacker: CombatActorSnapshot,
  defender: CombatActorSnapshot,
  seed: number,
  context: { source, regionKey?, elementContext? },
})
```

→ Cùng input → cùng output, mọi lần, mọi máy. Pure function:
không IO, không DB, không `Date.now`, không `Math.random` trực tiếp
trong critical path.

**Ngũ hành runtime ở reference resolver** (`combat-snapshot.ts`):

```
incomingDamageMul = elementMultiplier(attackerEl, defenderEl)
                  * (1 + sum(equipmentElementalAtkBonus[attackerEl]))
                  * resistMul
variance = 0.85 + rng() * 0.30   // [0.85, 1.15]
finalDamage = max(1, base * incomingDamageMul * variance)
```

`resistMul = clamp(equipmentElementalResist[attackerEl] ?? 1, 0, 1)`.
Resist chỉ giảm damage (giá trị ≤ 1) — không khuếch đại.

**Tie-break thứ tự lượt** (turn order) khi attacker.speed ===
defender.speed: dùng `seededRng.next() < 0.5` để chọn — KHÔNG dùng
`Math.random` để giữ deterministic.

**RNG injection** vào legacy helper (`combat.ts:rollDamage`,
`items.ts:rollDungeonLoot/rollMonsterLoot`,
`boss.service.ts:pickRandom`): optional `rng` param cuối, default
`Math.random` — call site cũ KHÔNG đổi balance / behavior. Khi cần
deterministic (Arena replay, regression test), inject
`createSeededRng(seed).next`.

**Helper / RNG**: `createSeededRng(seed)` (mulberry32, đồng thuật toán
với `tribulation-mini-battle.mulberry32` Phase 14.3.E.1 — verified
cross-module agreement qua test). `hashSeed(string)` dùng FNV-1a 32-bit
để derive numeric seed từ Arena match UUID. `composeSeed(seed, salt)`
cho per-actor / per-round sub-seed.

**Variance band giữ nguyên** `[0.85, 1.15]` cho phù hợp §4.1 / §4.2.
Tổng `incomingDamageMul` post-element + post-equipment đa phần nằm
trong `[0.49, 1.69]` (worst: `0.7 * 0.7 = 0.49` defender khắc + resist
0.7; best: `1.30 * 1.30 = 1.69` tương khắc + +30% atk bonus). Variance
chỉ dao động ±15% cuối — không lệch balance.

**Anti-cheat / non-deterministic source**: KHÔNG đọc DB mutable trong
resolver (snapshot phải đủ). KHÔNG dùng `Date.now` trong critical
calc. Sort skillKeys/buffKeys ASC trước khi serialize để cross-run
JSON identical.

**Test coverage**:

- shared `combat-rng.test.ts` 25 (sequence stability + cross-module +
  integer bounds + bernoulli + pick + hash + compose).
- shared `combat-snapshot.test.ts` 24 (same seed → same result, diff
  seed → variance, element/equipment/resist deterministic, tie-break,
  draw, default fill, normalize sort + immutability).
- shared `combat-determinism.test.ts` 15 (rollDamage / rollDungeonLoot
  / rollMonsterLoot seeded + variance bounds + fallback Math.random).
- api `combat-determinism.test.ts` 7 (cùng helper ở API runtime
  context).

**Phase 14.1.B Async Arena Foundation** sẽ wire snapshot → DB persist
+ Arena queue + match build (Defer: leaderboard, ELO, reward).

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

**Phase 12.4 — Per-monster `MonsterDef.lootTable` override** (xem `items-monster-loot.test.ts`):

`MonsterDef.lootTable?: readonly LootEntry[]` — optional override cho boss/elite. Resolve: `monster.lootTable.length > 0 ? rollMonsterLoot(monster.key, n) : rollDungeonLoot(dungeon.key, n)`.

Convention:
- Chỉ `monsterType ∈ {ELITE, BOSS}` được override (test enforce). BEAST/SPIRIT/HUMANOID dùng dungeon-level fallback.
- Bias toward themed equipment (weight 5-8) + skill_book pity weight 5-6 (cao hơn dungeon-level 2-3).
- Endgame BOSS có thể có pity drop rare (vd `cuu_la_huyen_quan` weight 3 cho `linh_can_dan` vs dungeon weight 1).
- Single entry KHÔNG vượt 80% probability (tránh boss-loot dominate).

Seed Phase 12.4 (5 monsters):
- ELITE `kim_dieu_thuong_phong` (kim_son_mach): `than_phong_kiem`, `tinh_thiet`, `skill_book_kim_quang_tram`, `co_thien_dan`.
- BOSS `thuy_thanh_long_vuong` (thuy_long_uyen): `cuu_u_bi_thuong`, `han_thiet_giap`, `han_ngoc`, `skill_book_thuy_kinh_phong_an`, `co_thien_dan`.
- BOSS `chu_tuoc_huyet_dieu` (hoa_diem_son): `tu_la_dao`, `cuu_la_giap`, `yeu_dan`, `cuu_huyen_dan`, `skill_book_hoa_xa_phun_diem`.
- BOSS `tho_dia_lao_tu` (hoang_tho_huyet final): `than_lan_giap`, `yeu_phach_giap`, `phu_van_ngoc`, `cuu_huyen_dan`, `skill_book_thach_giap_ho_than`.
- BOSS `cuu_la_huyen_quan` (cuu_la_dien endgame): `than_dan`, `tien_huyen_kiem`, `tien_huyen_giap`, `tien_kim_sa`, `cuu_thien_dan`, `linh_can_dan`.

**Phase 12.5 — Late-game story monster tuning** (xem `dungeons-balance.test.ts` describe `Phase 12.5 late-game story monster balance`):

8 placeholder Trúc Cơ → Nguyên Anh story (`tich_linh_anh`, `tam_ma_anh`, `tich_linh_quy`, `tich_thien_sat_thu`, `tam_ma_nguyen_anh`, `chap_niem_anh`, `ky_uc_meo`, `huyet_anh`) đã wire vào dungeon ở PR #439, stat catalog seed minimal. Phase 12.5 verify HP/ATK/DEF/SPD/level + monsterType match realm tier dungeon placement, thêm lootTable override cho ELITE/BOSS theo convention §5.4 trên.

Classification + tuning rationale:

| Monster | Dungeon | Realm tier | Type | Level | HP / ATK / DEF / SPD | Old → New (Phase 12.5) | Reason |
|---|---|---|---|---|---|---|---|
| `tich_linh_anh` | hac_lam | Trúc Cơ early | SPIRIT | 5 | 130 / 20 / 6 / 11 | hp 150→130, def 8→6 | Soften early entry. Killable ~2-3 hit cho Trúc Cơ player (per spec). SPIRIT intangible flavor. |
| `tam_ma_anh` | hac_lam | Trúc Cơ early | SPIRIT | 6 | 215 / 30 / 12 / 10 | hp 195→215, atk 26→30, def 10→12, exp 130→145, lt 42→48 | Match peer `thi_quy` lvl 6 SPIRIT (200/28/12). "Tâm ma story pressure" → khó hơn `tich_linh_anh`. |
| `tich_linh_quy` | moc_huyen_lam | Trúc Cơ mid | SPIRIT | 7 | 250 / 32 / 14 / 10 | (unchanged) | Đã nằm giữa lvl 6 (180) và lvl 8 (320). "Khó vừa". |
| `tich_thien_sat_thu` | kim_son_mach | Kim Đan | **ELITE** | 11 | 480 / 95 / 22 / 17 | **HUMANOID→ELITE**, hp 580→480, atk 75→95, def 24→22, speed 14→17, exp 450→480, lt 130→145 +lootTable | Burst-glass assassin. Speed 17 = max in kim_son_mach (cùng `kim_dieu_thuong_phong`). Promote ELITE để có lootTable override per spec. |
| `tam_ma_nguyen_anh` | hoang_tho_huyet | Nguyên Anh | **ELITE** | 15 | 1100 / 110 / 56 / 11 | **SPIRIT→ELITE**, lvl 14→15, hp 940→1100, def 38→56, exp 740→880, lt 200→235 +lootTable | Tank/pressure flavor. Mid-tier giữa lvl 13 ELITE `hoang_tho_cu_yeu` (880) và lvl 17 BOSS `thach_long_co_giap` (1500). |
| `chap_niem_anh` | hoang_tho_huyet | Nguyên Anh | SPIRIT | 15 | 1050 / 110 / 42 / 12 | (unchanged) | Stat trung-cao SPIRIT. Combat runtime chưa support debuff/control flavor mà placeholder name ngụ ý → chờ Phase 13+ status effect system mới re-tune. |
| `ky_uc_meo` | moc_huyen_lam | (Nguyên Anh stat) | SPIRIT | 14 | 920 / 95 / 36 / 11 | (unchanged) | **STORY-HARD INTENTIONAL TIER GAP**. Nguyên Anh-tier stat trong Trúc Cơ dungeon `moc_huyen_lam`. Quest `nguyen_anh_grind_01` (requiredRealmOrder 4) yêu cầu kill 6 → monster phải Nguyên Anh-tier. Trade-off: Trúc Cơ player vào dungeon sẽ wipe ở encounter cuối (design intentional — không phải farm spot cho realm Trúc Cơ). Nguyên Anh player có thể clear toàn dungeon dễ dàng. |
| `huyet_anh` | hoang_tho_huyet | Nguyên Anh endgame | **BOSS** | 16 | 1700 / 145 / 70 / 14 | **HUMANOID→BOSS**, lvl 15→16, hp 1080→1700, atk 115→145, def 40→70, speed 13→14, exp 880→1350, lt 245→380 +lootTable | "Hardest in 8-pack" per spec. Tank ~10+ hit cho Nguyên Anh player đúng tier. Mid-tier giữa lvl 17 BOSS `thach_long_co_giap` (1500) và lvl 20 BOSS `tho_dia_lao_tu` final (2200). |

Loot override Phase 12.5 (3 monsters mới — total 12 entries):
- ELITE `tich_thien_sat_thu` (kim_son_mach): `than_phong_kiem` w7 / `tinh_thiet` w22 / `co_thien_dan` w14 / `skill_book_kim_quang_tram` w6. Sum 49. Max ratio 22/49 ≈ 45%. Khác `kim_dieu_thuong_phong`: assassin không drop `co_thien_dan` weight cao (giữ thị trường pill ổn định).
- ELITE `tam_ma_nguyen_anh` (hoang_tho_huyet): `yeu_phach_giap` w7 / `phu_van_ngoc` w25 / `cuu_huyen_dan` w16 / `skill_book_thach_giap_ho_than` w6. Sum 54. Max ratio 25/54 ≈ 46%. Khác `tho_dia_lao_tu` BOSS: ELITE không drop `than_lan_giap` (giữ TIEN tho-armor cho BOSS final).
- BOSS `huyet_anh` (hoang_tho_huyet endgame story): `huyet_phach_giap` w5 / `mau_huyet_dai` w5 / `phu_van_ngoc` w24 / `cuu_huyen_dan` w18 / `skill_book_thach_giap_ho_than` w6 / `linh_can_dan` w2. Sum 60. Max ratio 24/60 = 40%. `linh_can_dan` rare pity ~3.3% parity với `cuu_la_huyen_quan` endgame BOSS (~3.2%).

Invariant (xem `dungeons-balance.test.ts` `Phase 12.5 late-game story monster balance`):
- Tất cả 8 key tồn tại + reachable trong dungeon đã map (regression PR #439).
- HP/ATK > 0, def ≥ 0, speed > 0, expDrop/linhThachDrop > 0.
- Level nằm trong range hợp lý theo tier (Trúc Cơ 4-9, Kim Đan 10-13, Nguyên Anh 13-18).
- `monsterType` khớp classification SPIRIT/HUMANOID/ELITE/BOSS.
- ELITE/BOSS có `lootTable` length > 0; SPIRIT/HUMANOID không có (convention §5.4).
- LootTable itemKey resolve qua `itemByKey`, weight > 0, qtyMin ≥ 1, qtyMin ≤ qtyMax.
- `huyet_anh` BOSS hp ≥ tất cả 7 placeholder khác (hardest in pack).
- `tich_thien_sat_thu` burst-glass: atk ≥ peer ELITE `kim_dieu_thuong_phong` − 15, speed ≥ peer, hp < peer.
- 3 SPIRIT Trúc Cơ (`tich_linh_anh`, `tam_ma_anh`, `tich_linh_quy`) def ≤ 1.2 × peer BEAST/HUMANOID cùng level (intangible flavor).

### 5.7 Story Dungeon reward hint (Phase 12.8.A)

`packages/shared/src/story-dungeons.ts` `STORY_DUNGEONS[<key>].rewardHint?: { linhThach?, tienNgoc?, exp?, items?: { itemKey, qty }[] }`. Đây là **hint** UI hiển thị (không phải reward thực) — Phase 12.8.B mới grant atomic qua `CurrencyService.applyTx` reason `STORY_DUNGEON_REWARD` + `InventoryService.grantTx`. `tienNgoc` trong hint vẫn là cap bởi `linh_thach_to_tien_ngoc` ratio để tránh false-promise.

Curve catalog seed Phase 12.8.A (4 entry):

| Story dungeon key | Realm tier | Quest gate | linhThach | tienNgoc | exp | items (qty) | Notes |
|---|---|---:|---:|---:|---:|---|---|
| `story_dgn_phamnhan_back_mountain` | Phàm Nhân | `phamnhan_realm_01:step_01` | 80 | — | 150 | `linh_lo_dan` ×1 | Entry instance — match `phamnhan_grind_01` claim 100 LT + 200 EXP nhưng nhỏ hơn vì story onboarding đã có quest claim parallel. |
| `story_dgn_luyenkhi_hac_lam_trial` | Luyện Khí | `luyenkhi_main_01:step_02` (minRealm) | 200 | — | 480 | `co_thien_dan` ×1 | Match peer `luyenkhi_main_01` claim 250 LT + 600 EXP scaled down 20% vì oneTime + bypass dungeon stamina. |
| `story_dgn_truc_co_co_thu_ky` | Trúc Cơ | `truc_co_main_01:step_03` (minRealm) | 600 | 5 | 1200 | `cuu_huyen_dan` ×1 + `tinh_thiet` ×2 | First story dungeon có `tienNgoc` (premium reward) — tier mid-game justify ratio 5 tien_ngoc ≈ 500 LT. |
| `story_dgn_kim_dan_kim_son_thien_lo` | Kim Đan | `kim_dan_main_01:step_02` (minRealm) | 1500 | 20 | 2800 | `linh_can_dan` ×1 + `phu_van_ngoc` ×3 | Endgame seed — `linh_can_dan` parity với boss endgame (Phase 12.4 §5.4 `cuu_la_huyen_quan` weight 1). |

Convention (Phase 12.8.A):
- `oneTime: true` → reward grant 1 lần / character / template (Phase 12.8.B sẽ enforce qua composite UNIQUE `(characterId, refType, refId)` trên `CurrencyLedger` + `ItemLedger`).
- `linhThach` hint nằm trong band của tier (Phàm Nhân 50-150, Luyện Khí 100-300, Trúc Cơ 400-800, Kim Đan 1k-2k) — match §5.3 dungeon clear range.
- `exp` hint ≈ 2 × `linhThach` (rough heuristic — `LINH_THACH_PER_EXP ≈ 0.5`).
- `items[]` chỉ chọn từ `ITEMS` catalog (invariant `validateStoryDungeonCatalog` reject orphan).
- `qty` ≥ 1; non-stackable items chỉ qty=1 (test enforce).
- KHÔNG grant skill_book hoặc title trong story dungeon hint (Phase 12.8.B mới wire — title qua quest claim, skill_book qua dungeon-run regular).

Invariant (xem `story-dungeons.test.ts` describe `validateStoryDungeonCatalog`):
- Mọi `rewardHint.items[].itemKey` resolve qua `itemByKey`.
- `rewardHint.{linhThach, tienNgoc, exp}` integer ≥ 0.
- `rewardHint.items[].qty` ≥ 1.

### 5.8 Phase 21 quest reward ratio bands

Phase 21 mega story content uses per-chapter main quest reward as the baseline. The intent is progression support, not currency inflation:

| Content type | Resource ratio vs chapter main baseline | Design use |
|---|---:|---|
| Main quest | 100% | Primary story progression: cultivation EXP, moderate Linh Thạch, story item, skill fragment, dungeon/boss/chapter unlock. |
| Side quest | 25–45% | Small help and lore: low EXP/Linh Thạch, common item, small `congHien`, NPC affinity. |
| Branch quest | 35–60% | Choice value: đạo tâm flag, NPC affinity, dialogue/quest unlock, minor title/utility item. |
| Hidden quest | 20–50% resource value | Discovery value: achievement/title/lore fragment first; currency stays low. |
| Daily template | Small fixed cap | Habit loop only; never a main farm source. |
| Weekly template | Moderate weekly cap | Weekly checklist reward below main-story pacing. |

Validator expectations for Phase 21:

- Main quest rewards should be higher than side/branch/hidden rewards in the same chapter unless an exception is documented as a one-time rare discovery.
- Side quests should not exceed 45% of the chapter main baseline for currency/EXP.
- Branch quests should not exceed 60% of the chapter main baseline for currency/EXP.
- Hidden quests should prefer title/achievement/lore/cosmetic-style value and should not exceed 50% resource baseline.
- Daily/weekly quest templates must include cadence/cap metadata or docs must mark runtime follow-up.
- Runtime reward grants still go through existing Quest/Mission reward services and ledgers; no ad-hoc currency/item mutation.

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

### 5.6.1 Tribulation foundation dial (phase 14.3.A)

**Phase 14.3.A** thêm 1 lớp foundation **trên** Phase 11.6.A/B (KHÔNG đụng catalog/wave/runtime cũ). Dial chính ở `packages/shared/src/tribulation-foundation.ts`:

| Dial | Value | Mục đích |
|---|---:|---|
| `TRIBULATION_BASE_SUCCESS_CHANCE.minor` | 0.75 | Floor success chance cho minor kiếp (kim_dan→nguyen_anh, nguyen_anh→hoa_than). |
| `TRIBULATION_BASE_SUCCESS_CHANCE.major` | 0.55 | Major (hoa_than → dai_thua range). |
| `TRIBULATION_BASE_SUCCESS_CHANCE.heavenly` | 0.35 | Heavenly cross-tier (dai_thua→do_kiep, do_kiep→nhan_tien). |
| `TRIBULATION_BASE_SUCCESS_CHANCE.saint` | 0.20 | Saint endgame (chuan_thanh→thanh_nhan). |
| `TRIBULATION_ELEMENT_AFFINITY_BONUS` | +0.05 | Bonus khi spirit-root primary khắc kiep element (e.g. `thuy` vs `hoa` Hoả Kiếp). |
| `TRIBULATION_ELEMENT_AFFINITY_PENALTY` | -0.05 | Penalty khi kiep element khắc primary spirit-root (e.g. `thuy` Băng vs `hoa` primary). |
| `TRIBULATION_SUPPORT_PER_ENTRY_CEIL` | +0.10 | Cap mỗi nguồn (1 item / 1 buff / 1 talent / 1 equip slot). Chống single-source spam. |
| `TRIBULATION_SUPPORT_TOTAL_CEIL` | +0.30 | Cap tổng support stack — giữ tension dù farm full bộ phù. |
| `TRIBULATION_SUCCESS_CHANCE_FLOOR` | 0.05 | Final floor — không bao giờ 0% để player có hope. |
| `TRIBULATION_SUCCESS_CHANCE_CEIL` | 0.95 | Final ceil — không bao giờ 100% để giữ stake; force player vẫn lo về fail. |

**Formula** (deterministic, server-authoritative, KHÔNG roll RNG):

```
final = clamp(base + affinity + supports, FLOOR, CEIL)
```

- `base` = `TRIBULATION_BASE_SUCCESS_CHANCE[def.severity]`.
- `affinity` ∈ {-0.05, 0, +0.05} — dùng `elementalAdvantage(primaryRoot, kiepElement)` từ Phase 14.2.A. `tam` (Tâm Kiếp) null element → affinity = 0.
- `supports` = `min(sum(entry.bonus per entry capped at PER_ENTRY_CEIL), TOTAL_CEIL)`.

**Tuning rationale**: Phase 14.3.A foundation **KHÔNG ship per-source provider** — `supports[]` empty trong runtime đầu. Hậu Phase (14.3.B/C) sẽ wire item `tribulation_support` bonus, buff `kiep_van_phu`, talent `do_kiep_thien_phu`, equipment `tribulation_resist`. Cap envelope đã chọn để khi data ship đầy đủ, player full bộ pháp khí + buff vẫn chỉ tới `0.95` ceil — không bypass kiếp bằng farm.

### 5.6.2 Tribulation support providers (phase 14.3.B)

**Phase 14.3.B** ship 4 provider thật wire vào `previewTribulation()` — `supports[]` không còn empty khi player có data thật. Provider pure read-only, **KHÔNG mutate state** (preview là deterministic snapshot).

| Provider | Source | Catalog field | Dedup |
|---|---|---|---|
| `collectItemTribulationSupports` | inventory entries (qty>0) | `ItemDef.tribulationSupport: { bonus, element? }` | by item key |
| `collectBuffTribulationSupports` | active buffs (non-expired) | `BuffDef.tribulationSupport: { bonus, element? }` | by buff key |
| `collectEquipmentTribulationSupports` | equipped items (slot map) | `ItemDef.tribulationSupport` | by (slot, itemKey) |
| `collectTalentTribulationSupports` | learned talents + tribulation wave elements | `TalentDef.tribulationResist: { element, bonus }` | by talent key (1 entry / talent matching ANY wave element) |

**Cap envelope giữ nguyên Phase 14.3.A** — `TRIBULATION_SUPPORT_PER_ENTRY_CEIL=+0.10`, `TRIBULATION_SUPPORT_TOTAL_CEIL=+0.30`, `TRIBULATION_SUCCESS_CHANCE_CEIL=0.95`. Hash composition: mỗi provider trả `TribulationSupportEntry[]` → tribulation service compose tất cả entries → cap per-entry → sum → cap total → wire vào `successChance.supportBonus`. Player full bộ (item + buff + equipment + talent matching) hiện chỉ tới `min(sum, 0.30)` total ceil — không bypass `0.95` final ceil.

**Catalog seed Phase 14.3.B**: 1 item (`lei_kiep_phu` Lôi Kiếp Phù `+0.05` element `kim`) + 1 buff (`thien_lei_phu` Thiên Lôi Phù `+0.05`) để gameplay path không trống. Designer có thể thêm catalog entry mới mà KHÔNG đụng provider runtime — provider tự pick up `tribulationSupport` field nếu có.

**No-mutation guarantee**: API test verify `inventory.qty` + `buff.stacks` snapshot trước/sau preview match exact. Item bonus áp dụng raw (KHÔNG consume preview); attempt thật (Phase 14.3.C) consume item khi player chủ động chọn — xem §5.6.3.

### 5.6.3 Tribulation support item consumption (phase 14.3.C)

**Phase 14.3.C** đóng vòng chơi Thiên Kiếp: player **chủ động chọn** item hỗ trợ trước khi attempt → server consume in tx → server-side recalc bonus từ 4 nguồn → KHÔNG tin FE bonus value.

**Selection cap (shared `packages/shared/src/tribulation-support-validate.ts`)**:

| Constant | Value | Purpose |
|---|---|---|
| `TRIBULATION_MAX_SELECTED_SUPPORT_ITEMS` | `3` | Player chọn tối đa 3 item per attempt — chống farm UI spam + cap bonus envelope. |
| `TRIBULATION_SUPPORT_PER_ENTRY_CEIL` | `+0.10` | Per-entry cap (Phase 14.3.A giữ nguyên). |
| `TRIBULATION_SUPPORT_TOTAL_CEIL` | `+0.30` | Total cap (Phase 14.3.A giữ nguyên). |

**Catalog rule**: chỉ item có `ItemDef.tribulationSupport` + `kind ∈ {PILL_HP, PILL_MP, PILL_EXP, MISC}` mới consume được. **Equipment KHÔNG consume** — equipment vẫn cộng bonus qua `collectEquipmentTribulationSupports` provider Phase 14.3.B (read-only, không consume).

**Server-side recalc (anti-cheat)**: Phase 14.3.C attempt KHÔNG dùng `previewTribulation()` snapshot bonus. Service tự re-resolve `composedSupports` từ 4 nguồn (selectedItems + equipment + buffs + talents) → cap envelope per-entry/total → tách thành `damageSupports` (exclude talents — talent đã apply qua `elementResistFn`) cho damage multiplier. **Hash composition**: identical với preview math nhưng ràng buộc thêm `selectedItems ∈ inventory(player) ∩ catalog(consumable)`. Item nào không thuộc selection sẽ KHÔNG cộng bonus (item bonus đến từ provider Phase 14.3.B vẫn áp cho item player đang giữ — KHÔNG consume; selectedItems là tập con để consume + bonus).

**Atomicity**: tx flow:

```
BEGIN
  SELECT FOR UPDATE inventory(character, itemKey) WHERE qty>0  -- pre-check ownership
  INSERT TribulationAttemptLog (placeholder)
  FOR EACH selectedKey:
    consumeOneByItemKeyTx(tx, characterId, key, { reason: 'TRIBULATION_SUPPORT_CONSUME', refType: 'TribulationAttemptLog', refId: logId })
  recalc supports → simulate kiếp deterministic
  UPDATE TribulationAttemptLog với outcome + consumedSupportItems[]
COMMIT
```

Pre-check ownership trước khi consume — fail (qty=0 hoặc race với `consumeItem` khác) → throw `SUPPORT_ITEM_MISSING` → tx rollback → KHÔNG mất EXP.

**Dual consumption (success + fail path)**: cả 2 path đều consume item — design choice "no free retry with refund". Nếu fail kiếp + mất EXP, item KHÔNG hoàn về (xem `docs/ECONOMY_MODEL.md` §5.6.3).

**Cap envelope (Phase 14.3.C giữ nguyên Phase 14.3.A/B)**: player chọn 3 item × `+0.10` ceil per-entry = `+0.30` raw → cap total `+0.30` → áp `0.95` final ceil. Stack với equipment (4-5 slot × `+0.10` cap đến tổng `+0.30`) + buff (`+0.05` typical) + talent (varies) → cap total `+0.30` toàn bộ → KHÔNG bypass `0.95`. Selection KHÔNG raise total ceil — chỉ là 1 trong 4 nguồn input.

### 5.6.4 Tribulation encounter system (phase 14.3.D)

**Phase 14.3.D** thêm 1 lớp encounter view-only **trên** Phase 14.3.A/B/C runtime (KHÔNG đổi simulation deterministic, KHÔNG đổi balance dial). Dial chính ở `packages/shared/src/tribulation-encounter.ts`:

| Element | EffectType | Difficulty | PhaseCount | SuccessThreshold | FailPenaltyMultiplier | RewardHintMultiplier |
|:---:|:---:|:---:|---:|---:|---:|---:|
| `hoa` | BURST | minor | 3 | 0.55 | 1.0 | 1.0 |
| `thuy` | SUSTAIN | major | 4 | 0.55 | 1.0 | 1.0 |
| `moc` | POISON_RECOVERY | minor | 3 | 0.55 | 1.0 | 1.0 |
| `kim` | ARMOR_CRIT | major | 4 | 0.55 | 1.0 | 1.0 |
| `tho` | DEFENSE_ENDURANCE | heavenly | 5 | 0.55 | 1.0 | 1.0 |

**Element advantage matrix** (`describeTribulationEncounterAdvantage(playerPrimary, encounterElement)`):

| | enc=kim | enc=moc | enc=thuy | enc=hoa | enc=tho |
|:---:|:---:|:---:|:---:|:---:|:---:|
| `player=kim` | +2 | +1 (kim phá moc) | -1 (kim sinh thuy) | -2 (hoa phá kim) | +1 (tho sinh kim) |
| `player=moc` | -2 | +2 | +1 (thuy sinh moc) | -1 (moc sinh hoa) | +1 (moc phá tho) |
| `player=thuy` | +1 (kim sinh thuy) | -1 (thuy sinh moc) | +2 | +1 (thuy phá hoa) | -2 |
| `player=hoa` | +1 (hoa phá kim) | +1 (moc sinh hoa) | -2 | +2 | -1 (hoa sinh tho) |
| `player=tho` | -1 (tho sinh kim) | -2 | +1 (tho phá thuy) | +1 (hoa sinh tho) | +2 |

Semantics: `+2` = đồng hệ (player primary == encounter element). `+1` = player advantage — player counters encounter (player phá encounter) hoặc encounter generates player (player nhận sinh khí). `0` = trung tính. `-1` = player feeds encounter (player sinh encounter → encounter mạnh thêm). `-2` = encounter counter player (encounter phá player → player yếu nhất).

**Tuning rationale**: Phase 14.3.D KHÔNG ship damage/penalty multiplier khác `1.0` — encounter là layer view-only over `runAttemptInTx` extracted helper. Simulation deterministic giữ nguyên Phase 11.6.A/B math (waves × element-modified damage × hp × support cap). Designer Phase tương lai có thể tune `failPenaltyMultiplier` / `rewardHintMultiplier` per encounter để gameplay flavor đổi mà KHÔNG đụng simulation.

**State machine**: `pending → resolved` (no `cancelled` state). Idempotent re-call `start` cùng `tribulationKey` trả pending hiện có (KHÔNG tạo mới). Idempotent re-call `resolve` sau resolved trả cached outcome reconstructed từ `TribulationAttemptLog` (KHÔNG double breakthrough/consume/reward). Mỗi character chỉ có 1 pending row tại 1 thời điểm.

**Out of scope (defer)**: realtime combat per phase (button-based skill rotation, mp consume per skill), animation/cutscene, multi-encounter chain (mỗi transition 1 encounter), penalty nặng làm mất nhân vật (giữ Phase 14.3.A penalty: expLoss + cooldown + taoMa).

### 5.6.5 Tribulation mini-battle backend (phase 14.3.E.1)

**Phase 14.3.E.1** biến `start → resolve` từ RNG snapshot thành state machine có phase/turn + 5 effectType khác biệt thật sự (KHÔNG thay simulation deterministic Phase 11.6.A/B — chỉ thêm 1 lớp tương tác trên outcome). Dial chính ở `packages/shared/src/tribulation-mini-battle.ts`:

**State machine**: `PENDING → ACTIVE → RESOLVED|FAILED|EXPIRED`. PENDING khi vừa tạo (chưa có action). ACTIVE sau action đầu tiên (transition diễn ra trong cùng `action` call). RESOLVED khi thắng (tribulation HP=0 hoặc completed all phases với HP > 0). FAILED khi player HP=0. EXPIRED reserved cho cleanup cron tương lai (chưa wire).

**EffectType mechanics** (tất cả deterministic seeded — KHÔNG `Math.random` trong core calc):

| EffectType | Tribulation behavior | Player counter | Action design |
|---|---|---|---|
| **BURST** | Damage spike phase X (định lượng `1.5×` base damage), crit rate `0.20` | DEFEND giảm crit `0.50×`, FOCUS tăng next ATTACK damage `+30%` | Burst phase telegraph qua DOT counter — player FOCUS phase trước, DEFEND phase burst |
| **SUSTAIN** | Constant DPS thấp + tribulation regen `+5%/phase` | Cần kéo dài đủ phaseCount, FOCUS tích `focusCharge` heal player `+10%` | Endurance check — không có burst, chỉ là check sống đủ |
| **POISON_RECOVERY** | DOT stacks tăng `+1/phase`, mỗi stack `+5%` damage taken | CLEANSE giảm `dotStacks -2`, DEFEND giảm DOT damage `0.50×` | DOT control loop — phải CLEANSE đúng nhịp, không thì stack overload |
| **ARMOR_CRIT** | Tribulation có shield `+30% HP`, ATTACK thường bị reduce `0.50×` nếu chưa pierce | FOCUS tích pierce `+25%/charge`, charged ATTACK ignore shield | Armor break loop — FOCUS×3 → CHANNEL pierce → ATTACK lúc shield mỏng |
| **DEFENSE_ENDURANCE** | Tribulation giảm damage taken `0.50×`, regen `+3%/phase` | DEFEND tích shield `+15%/phase`, CHANNEL convert shield → heal | Tank-up loop — bồi shield đủ rồi convert → ATTACK pre-cap |

**Caps (anti-cheat)**: `HP_MAX=100_000`, `DAMAGE_MAX=50_000`, `HEAL_MAX=50_000`, `SHIELD_MAX=50_000`, `DOT_STACKS_MAX=20`. Cap apply trong `applyTribulationEffectType` — không có công thức nào output > cap (ngay cả khi player full bộ + element advantage +2).

**Deterministic RNG**: `mulberry32(seed)` + `composeBattlePhaseSeed(baseSeed, phase)` → mỗi phase có 1 seed riêng tổng hợp từ battle seed + phase index. Replay cùng seed + cùng action sequence → cùng output (test invariant).

**Idempotency / race-safety**: 
- **action**: optimistic `updateMany({where: {id, state, currentPhase}})` — nếu concurrent caller advance phase trước → `count=0` → throw `MINI_BATTLE_INVALID_ACTION`. `lastClientNonce` field dedupe identical re-call (return current snapshot, KHÔNG advance).
- **resolve**: `resultJson.attemptLogId` đóng vai trò "applied marker". 2nd resolve reconstruct outcome từ `TribulationAttemptLog` row sẵn có → KHÔNG double reward / KHÔNG double consume support / KHÔNG double realm-advance.

**Tuning rationale**: Phase 14.3.E.1 KHÔNG ship balance dial khác Phase 14.3.D (success threshold / penalty / reward multiplier giữ `1.0`). Outcome `success` field tính từ snapshot final (`tribulationHp=0` → win, `playerHp=0` → lose) → routed qua `TribulationService.runAttemptInTxWithForcedOutcome` để reuse pipeline realm advance + reward + consume support + penalty 1:1 với `attemptTribulation` legacy. Không có path nào bypass cap envelope `successChance ≤ 0.95` (vì success từ HP outcome chứ không phải RNG roll). Penalty Phase 14.3.A giữ nguyên: `expLoss + cooldown + taoMa` — KHÔNG mất nhân vật.

**Feature flag**: `TRIBULATION_MINI_BATTLE_ENABLED` (default OFF). Disabled → 4 endpoint `/character/tribulation/battle/*` trả 501 `MINI_BATTLE_DISABLED` cho FE fallback flow Phase 14.3.D `/character/tribulation/encounter/*`. Enabled → mini-battle endpoints active, encounter endpoints vẫn coexist (FE Phase 14.3.E.2 chọn route).

**Out of scope (defer 14.3.E.2)**: FE TribulationBattleView (Vue UI turn-based + 5 action button), event log component, effectType badge color theme, state-machine HUD (HP/shield/DOT bar), animation framework, cinematic cutscene, mini-battle reward drop table riêng (route qua `runAttemptInTxWithForcedOutcome` vẫn giữ nguyên reward Phase 11.6.B).

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

**Passive talents (7 base + 5 element_resist từ Phase 11.6.D) — always-on khi đã học:**

| Talent | Element | Realm req | Cost (pts) | Effect |
|---|:---:|:---:|---:|---|
| Kim Thiên Cơ | kim | kim_dan | 1 | atk × 1.10 |
| Thuỷ Long Ấn | thuy | kim_dan | 1 | hpMax × 1.10 |
| Mộc Linh Quy | moc | truc_co | 1 | hp regen +5/tick |
| Hoả Tâm Đạo | hoa | kim_dan | 2 | damage × 1.15 vs enemy hệ Kim (counter) |
| Thổ Sơn Tướng | tho | truc_co | 1 | def × 1.10 |
| Thiên Di | — | nguyen_anh | 2 | drop rate × 1.20 |
| Ngộ Đạo | — | hoa_than | 2 | EXP gain × 1.15 |
| Kim Thiên Giáp | kim | kim_dan | 1 | -5% damage taken từ wave hệ Kim trong tribulation (Phase 11.6.D) |
| Mộc Thiên Giáp | moc | kim_dan | 1 | -5% damage taken từ wave hệ Mộc trong tribulation (Phase 11.6.D) |
| Thuỷ Thiên Giáp | thuy | kim_dan | 1 | -5% damage taken từ wave hệ Thuỷ trong tribulation (Phase 11.6.D) |
| Hoả Thiên Giáp | hoa | kim_dan | 1 | -5% damage taken từ wave hệ Hoả trong tribulation (Phase 11.6.D) |
| Thổ Thiên Giáp | tho | kim_dan | 1 | -5% damage taken từ wave hệ Thổ trong tribulation (Phase 11.6.D) |

**Phase 11.6.D dial**: `BALANCE_DIALS.TALENT_ELEMENT_RESIST_VALUE = 0.95` (giá trị multiplier cho mỗi talent `*_thien_giap`). Compose multiplicatively với spiritual root resist trong `TribulationService.attemptTribulation` (`effective = rootResist × talentResist`), clamp envelope `[ELEMENT_MODIFIER_ABSOLUTE_FLOOR=0.6, ELEMENT_MODIFIER_ABSOLUTE_CEIL=1.5]`. Single-talent floor `0.95 × 0.7 = 0.665` vẫn cao hơn floor → safe stack với equipment + buff layer tương lai. Wire qua `composePassiveTalentMods` (kind=`element_resist` build `elementResistByElement: ReadonlyMap<ElementKey, number>` field) + `computePassiveTalentTribulationResist(mods, waveElement)` pure helper.

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

### 6.4 LiveOps Boss Schedule (Phase 13.0)

Static catalog `LIVE_OPS_EVENTS` trong `packages/shared/src/liveops.ts` định nghĩa 5 event scheduled — gồm 4 boss spawn slot daily/weekly + 2 buff event không spawn boss. Schedule reuse `Asia/Ho_Chi_Minh` (UTC+07) qua `MISSION_RESET_TZ` để consistency với mission reset.

**Schedule table:**

| Time (ICT) | Day | Event key | Boss | Region | Slot duration | Lý do |
|---|---|---|---|---|---|---|
| 12:00 | Daily | `boss_daily_noon_hoa_diem_son` | `hoa_long_to_su` | `hoa_diem_son` | 30 min | Mid-day retention check-in (lunch break) |
| 19:00 | Daily | `boss_daily_evening_kim_son_mach` | `kim_phach_long_dieu` | `kim_son_mach` | 30 min | Prime evening engagement window |
| 22:00 | Daily | `boss_daily_night_hoang_tho_huyet` | `yeu_vuong_tho_huyet` | `hoang_tho_huyet` | 30 min | Late-night player retention |
| 21:00 | Saturday | `event_huyet_nguyet_weekend` | `cuu_la_thien_de` | `cuu_la_dien` | 60 min | Weekly highlight raid (Huyết Nguyệt) |
| 07:00 | Daily | `daily_exp_rush_morning` | — (buff event) | — | 60 min | Morning EXP +25% (early-bird retention) |
| 20:00 | Daily | `daily_dungeon_rush_evening` | — (buff event) | — | 60 min | Evening dungeon drops ×2 (prime time engagement) |
| 06:00 | Sunday | `weekly_sect_aura_sunday` | — (buff event) | — | 720 min | Sunday daytime sect aura cultivation boost |
| 2027-02-06 → 2027-02-13 | Limited (disabled) | `limited_lunar_new_year_2027` | — (buff event) | — | 7 days | Lunar New Year 2027 festival placeholder |

**Reward hook table (Phase 13.0 §C):**

| Condition | Reward | Target | Lý do balance |
|---|---|---|---|
| Bất kỳ char damage boss → distribute reward | Title `achievement_first_boss` | Mọi participant | Onboarding hook — khuyến khích lần đầu tham gia boss |
| Top-1 damage rank | Buff `event_double_drop` (1h) | Top damage character | Reward elite raid contribution; buff timed nên không phá farm balance dài hạn |
| Spawn từ slot `event_huyet_nguyet_weekend` | Title `event_huyet_nguyet_2026` (epic) | Mọi participant | Weekly highlight prestige reward — flavor `+3% atk` (cosmetic, không phá power curve) |

**Balance rationale:**
- Schedule không cấp reward "thêm" ngoài standard boss reward — chỉ thêm title (cosmetic + small flavor stat) + 1h buff. KHÔNG ảnh hưởng main economy (linh thạch reward distribute giữ nguyên §6.2).
- Buff `event_double_drop` đã được defined trước trong `BUFFS` catalog — duration 1h chỉ kích hoạt sau boss kill, không stack với daily login buff.
- Title flavor stat bonus cap `+3%` mỗi title — tổng các title cùng equip vẫn dưới power curve cap (§3.4).
- Activity panel (§D `LiveOpsTodayPanel`) **chỉ hiển thị**, KHÔNG cấp reward trực tiếp — pure UX retention layer.
- Notice (§F `LiveOpsNotice`) là client-side toast nhắc trước boss 15 min, không grant gameplay advantage.

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


## 9.8 Phase 21 quest reward ratios

Phase 21 uses main quests as the resource baseline. Side quests target 25–45% of main resource value, branch quests 35–60%, hidden quests 20–50%, and hidden/branch content favors affinity/title/lore unlocks over currency. `packages/shared/src/phase21-content-integrity.test.ts` enforces aggregate side/branch/hidden ratios against the main quest baseline and checks Phase 21 daily/weekly caps.

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
- Phẩm cấp đại diện cho sức mạnh và độ hiếm trong cùng equipmentTier, không chỉ là visual rarity/màu. `computeEquipmentPowerBudget` và `computeEquipmentPowerScore` nhân quality multiplier chuẩn: PHAM 1.00, LINH 1.20, HUYEN 1.50, TIEN 1.90, THAN 2.40.
- TierBase chuẩn cho 10 equipmentTier: 100, 260, 680, 1750, 4500, 11500, 29000, 72000, 175000, 420000. Công thức: `TierBase × QualityMultiplier × SlotWeight × EnhanceMultiplier × GemMultiplierCap × SetBonusCap`.
- Balance guard: THAN tier cũ có thể gần PHAM/LINH tier kế nhưng không vượt HUYEN/TIEN tier kế; enhance/gem/set không được biến tier thấp thành tier cao và không phá `requiredRealmOrder`.
- Tăng thành 7-8 (e.g. thêm "huyền cao", "tiên cao") khi phase 12+ nếu cần.

### 11.5 Tại sao `linhThach` BigInt mà `tienNgoc` Int?

- linhThach: late-game cộng triệu/h → vài tỷ trong 1 tháng → vượt Int32 max (2.1 tỷ).
- tienNgoc: nạp tay, không tự sinh nhanh → Int đủ cho cap thực tế.

---

## 11.13 SECT WAR (Phase 13.1.A)

> Tông Môn Chiến tuần lễ — competitive guild leaderboard với weekly reward source. KHÔNG ảnh hưởng economy chính (LT/TN reward bounded, không stack với daily mission/giftcode pool).

### 11.13.1 Activity points table

| Activity              | Points | Daily cap | Weekly cap | Source idempotency key                        | Reasoning |
|-----------------------|-------:|----------:|-----------:|-----------------------------------------------|-----------|
| `daily_login`         |   5    |     —     |    7×5=35  | `(weekKey, DailyLoginClaim, dayKey, charId)`  | Bám điểm danh đã có; daily-login claim 1 lần/ngày qua schema, weeklyCap = 7 đã tự nhiên. |
| `dungeon_clear`       |  10    |    50     |       —    | `(weekKey, DungeonRun, dungeonRunId, charId)` | DungeonRun.claim đã idempotent qua state UNIQUE; cap 50/ngày = 5 dungeon claim/ngày, đủ cho farm thường, chặn macro. |
| `boss_participation`  |  15    |     —     |   120      | `(weekKey, WorldBoss, bossId+'/p', charId)`   | Boss daily 12/19/22 ICT × 7 ngày ≈ 21 boss + 1 weekly Huyết Nguyệt = 22 lần × 15 = 330 → cap 120 chặn AFK farm dame nhỏ. |
| `boss_top_damage`     |  25    |     —     |   100      | `(weekKey, WorldBoss, bossId+'/top', charId)` | Top-1 thưởng nhẹ; cap 100 = 4 lần top/tuần, tránh 1 tài khoản dominate hoàn toàn. |
| `quest_complete`      |   8    |     —     |    80      | `(weekKey, Quest, questClaimId, charId)`      | Quest claim đã có UNIQUE per claim; cap 80/tuần = 10 quest/tuần, vừa đủ cho main quest line không cản progression. |

**Anti-abuse invariants**:
- Mọi nguồn point đi qua hook server-side trong tx — KHÔNG có endpoint FE để tự thêm point.
- Composite UNIQUE `(weekKey, sourceType, sourceId, characterId)` đảm bảo retry hook (network flap, replay) chỉ ghi 1 lần.
- Cap aggregate trong tx trước insert → atomic (race-safe khi 2 hook concurrent cùng activity).
- Character không có sect → no-op (return null), KHÔNG ghi row → switch sect mid-week không carry điểm cũ.

### 11.13.2 Weekly reward tier

| Rank          | Linh Thạch | Tiên Ngọc | Title                  | Eligibility                       | Balance reasoning |
|---------------|-----------:|----------:|------------------------|-----------------------------------|-------------------|
| 1             |     5,000  |      200  | `sect_war_champion`    | sectRank = 1                      | Top sect: ~52 LT/ngày × 7 + bonus 1.4k → cao hơn daily mission tổng tuần (~3k LT) ×1.7, đủ flex cho leader sect. |
| 2-3           |     2,500  |      100  | —                      | sectRank ∈ [2,3]                  | Á quân: ~50% rank 1, vẫn đáng tham gia. |
| 4-10          |     1,000  |       50  | —                      | sectRank ∈ [4,10]                 | Mid-tier: small reward để khuyến khích sect mới tham gia. |
| Participation |       200  |        0  | —                      | personalPoints ≥ 50 (bất kể rank) | Cá nhân tích cực dù sect yếu — pity prize tránh Pareto-loser. |

**Curve**: tổng max LT phát hành / tuần ≈ (5,000 × 1) + (2,500 × 2) + (1,000 × 7) + (200 × N participation). Với N ~ 100 active sect war player → 200 × 100 = 20,000. Tổng max ≈ 37,000 LT/tuần. Compared với boss reward + dungeon farm + daily mission tổng pool ~500k LT/tuần khi 100 active players → sect war = ~7% additional source. Acceptable inflation.

**Title**: chỉ rank-1 mới có title `sect_war_champion` (epic source=event tương đương `event_huyet_nguyet_2026`). KHÔNG stack với title khác (single equip slot). Tiêu chí prestige.

### 11.13.3 weekKey timezone & race

- `weekKey = ISO 'YYYY-Www'` qua `sectWarWeekKey(now, tz)`. Dùng `MISSION_RESET_TZ` (default `Asia/Ho_Chi_Minh`).
- Season chạy Thứ Hai 00:00 ICT → Chủ Nhật 23:59 ICT. Reset week = activity carry-over reset (contribution row mới weekKey mới, leaderboard mới).
- **Claim race**: 2 request `POST /sect-war/claim` cùng user concurrent → composite UNIQUE `(weekKey, characterId)` trên `SectWarWeeklyRewardClaim` đảm bảo race winner only — race loser hits P2002 → service translate sang `SECT_WAR_ALREADY_CLAIMED` (regression test cover).
- **Cap race**: 2 hook concurrent cùng activity (vd: 2 dungeon claim same second) → service aggregate trong cùng tx + UNIQUE constraint trên contribution row chống cả 2 phía. Test cover trong `sect-war.service.test.ts`.

---

## 11.14 SECT MISSIONS, SECT SHOP & ADMIN LIVEOPS (Phase 13.1.B)

### 11.14.1 Sect Mission catalog

Phase 13.1.B thêm 5 mission Tông Môn (3 daily + 2 weekly) cộng `congHien` (= `Character.contribBalance`) khi claim. Catalog ở [`packages/shared/src/sect-missions.ts`](../packages/shared/src/sect-missions.ts).

| Key                              | Cadence | Goal                  | Target | Reward |
|----------------------------------|---------|-----------------------|-------:|--------|
| `sect_daily_dungeon_3`           | DAILY   | dungeon_clear         |     3  | +30 contribution |
| `sect_daily_boss_participate`    | DAILY   | boss_participate      |     1  | +40 contribution |
| `sect_daily_boss_damage`         | DAILY   | boss_damage proxy     |    25  | +35 contribution |
| `sect_weekly_quest_5`            | WEEKLY  | quest_complete        |     5  | +150 contribution + 500 LT |
| `sect_weekly_breakthrough_1`     | WEEKLY  | breakthrough_success  |     1  | +200 contribution + 800 LT |

**Curve rationale**:
- DAILY tổng = 30 + 40 + 35 = **105 contribution/day** (đạt nhanh trong 1 phiên).
- WEEKLY tổng = 150 + 200 = **350 contribution/week** (yêu cầu multi-session).
- Player active mỗi tuần ≈ 105 × 7 + 350 = **1085 contribution** → đủ mua **5 huyết_chi_đan/ngày + 1 cổ_thiên_đan/tuần** (xem §11.14.2 sect shop).
- **Period reset TZ**: `Asia/Ho_Chi_Minh`. DAILY periodKey = `YYYY-MM-DD`; WEEKLY = ISO `YYYY-Www` (reuse `sectWarWeekKey`).

### 11.14.2 Sect Shop catalog

5 entries dạng "spend `congHien` đổi consumable/material". Catalog ở [`packages/shared/src/sect-shop.ts`](../packages/shared/src/sect-shop.ts).

| Entry key                        | Item             | Cost (contribution) | Daily limit | Weekly limit |
|----------------------------------|------------------|--------------------:|------------:|-------------:|
| `sect_shop_huyet_chi_dan`        | huyet_chi_dan    | 50                  | 5           | —            |
| `sect_shop_thanh_lam_dan`        | thanh_lam_dan    | 250                 | 3           | —            |
| `sect_shop_co_thien_dan`         | co_thien_dan     | 200                 | —           | 3            |
| `sect_shop_huyet_tinh`           | huyet_tinh       | 80                  | —           | 10           |
| `sect_shop_than_dan`             | than_dan         | 5000                | —           | 1            |

**Curve rationale**:
- Pill phổ thông (`huyet_chi_dan` 50, `thanh_lam_dan` 250) — daily cap, hỗ trợ healing/MP recovery hằng ngày.
- Pill mid-tier (`co_thien_dan` 200) — weekly cap 3, exp dan tier vừa.
- Material (`huyet_tinh` 80) — weekly cap 10, dùng craft/refine.
- Endgame (`than_dan` 5000) — weekly cap 1, save-up reward (~5 tuần spend).
- Tổng max spend tuần ≈ 50×35 + 250×21 + 200×3 + 80×10 + 5000×1 ≈ **13,800 contribution/week** — gấp ~13× active player earning, đảm bảo multi-week save-up cho high-tier.

### 11.14.3 Anti-abuse caps

- **Mission claim**: composite UNIQUE `(characterId, missionKey, periodKey)` trong DB chống double-claim. Server reject `MISSION_ALREADY_CLAIMED` khi retry cùng period.
- **Mission progress**: derive từ `SectWarContribution` rows (đã ghi từ gameplay hooks) hoặc `Character` snapshot (breakthrough). Service KHÔNG có endpoint FE để tự thêm progress → KHÔNG có gap exploit.
- **Shop daily/weekly limit**: aggregate `SectShopPurchase.qty` trong period window theo `MISSION_RESET_TZ`. Atomic check trong tx trước khi trừ contribution → chống race-double-spend.
- **Shop CAS**: `Character.contribBalance` decrement qua `updateMany({ where: { id, contribBalance: { gte: cost } } })` → race winner accept, loser get count=0 → `INSUFFICIENT_CONTRIB` (không trừ tiền, không grant item).
- **Shop rate limit**: 30 req/60s per user qua `FailoverRateLimiter` (Redis primary + in-memory fallback). Spam buy → `RATE_LIMITED` 429.
- **NON_STACKABLE_QTY_GT_1 guard**: defensive — items hiện tại đều stackable, nhưng future non-stackable item → reject `qty > 1` ngay tại service trước transaction.
- **Item grant rollback**: `InventoryService.grantTx` chạy trong cùng `prisma.$transaction` với contribution decrement → fail → toàn bộ tx rollback (không phát sinh side-effect).
- **Sect required**: `Character.sectId == null` → reject cả claim mission và buy shop với `SECT_REQUIRED`.

### 11.14.4 Admin LiveOps controls

`/admin/liveops` (status), `/admin/liveops/event/toggle` (override), `/admin/sect-war/{status,recalculate}` chỉ accessible cho `User.role = ADMIN` qua `AdminGuard`. Mọi toggle ghi audit log `ADMIN_LIVEOPS_OVERRIDE` (actor + eventKey + enabled + timestamp). Recalculate hiện là no-op response (read-only audit), KHÔNG phá contribution rows hiện có.

## 11.15 SECT SEASON FOUNDATION (Phase 13.2.A)

### 11.15.1 Season window

Phase 13.2.A mở foundation Sect Season — chuỗi mùa giải dài hạn dành cho Tông Môn, build trên top Sect War tuần (Phase 13.1.A). 13 mùa liên tiếp × **4 tuần ISO/mùa** (tổng ≈ 52 tuần ≈ 1 năm) phủ `2026-03-30 → 2027-03-28 ICT`. Mỗi mùa start **Monday 00:00 ICT** (`MISSION_RESET_TZ` = `Asia/Ho_Chi_Minh`, UTC+07) → đồng nhất với daily-login streak / mission DAILY/WEEKLY reset / Sect War ISO week boundary.

Catalog ở [`packages/shared/src/sect-season.ts`](../packages/shared/src/sect-season.ts):

| Hằng số                        | Giá trị                                  | Ghi chú |
|---------------------------------|------------------------------------------|---------|
| `SECT_SEASONS.length`           | 13                                       | Mỗi mùa key = `s1`..`s13`. |
| `durationWeeks` mỗi mùa         | 4                                        | Đủ ngắn để cảm nhận khác biệt giữa các mùa, đủ dài để player chase milestone. |
| `timezone`                      | `Asia/Ho_Chi_Minh`                       | UTC+07. |
| Window đầu                      | `2026-03-30T17:00:00.000Z` (Mon 2026-W14 ICT) | Mùa khai nguyên `s1`. |
| Window cuối                     | `2027-03-22T17:00:00.000Z` (Mon 2027-W12 ICT) | Mùa tận thế `s13`. |
| `SECT_SEASON_LEADERBOARD_TOP`   | 10                                       | Top 10 sect mỗi mùa (server-cap, FE không tự cap). |

**Aggregation read-only**: `personalPoints` season = sum `SectWarContribution.points` của character qua `weekKey IN sectSeasonWeekKeys(season)` (4 weekKey ISO × season). Hệ quả:
- KHÔNG cần migration mới — Phase 13.2.A reuse `SectWarContribution` table Phase 13.1.A.
- KHÔNG có rate-limit / write path — pure read.
- `weeksContributed` = distinct `weekKey` count cho character/sect đó (tối đa = `durationWeeks` = 4).

### 11.15.2 Personal milestone curve

5 cột mốc cá nhân monotonic increasing — cố ý gap rộng để player có động lực cày qua nhiều tuần thay vì chỉ 1 tuần burst:

| Milestone key | requiredPoints | Phần thưởng (Phase 13.2.A KHÔNG grant — chỉ display) |
|---------------|----------------|------------------------------------------------------|
| `milestone_bronze`   | 100            | 50 linh thạch                                       |
| `milestone_silver`   | 500            | 200 linh thạch + 5 Linh Khí Đan                      |
| `milestone_gold`     | 1 500          | 1 000 linh thạch + 3 Dưỡng Thần Đan                  |
| `milestone_platinum` | 3 500          | 2 500 linh thạch + 1 Bùa Tinh Thần Tập Trung         |
| `milestone_diamond`  | 7 500          | 5 000 linh thạch + 1 Tiên Ngọc + danh hiệu mùa       |

Quy đổi 7 500 điểm trong 4 tuần = **~1 875 điểm/tuần** ≈ 75% Sect War weekly cap player tier hardcore. Tier casual (≈ 500-700 điểm/tuần) sẽ chase được `milestone_silver` (500pt sau 1-2 tuần) và `milestone_gold` (1 500pt sau 3-4 tuần). Tier bot/idle (< 100pt/tuần) thậm chí có thể không qua `milestone_bronze`.

**Validators fail-fast** (`validateSectSeasonMilestonesMonotonic`):
- Key unique trong list.
- `requiredPoints` strictly increasing — không bao giờ có 2 milestone cùng `requiredPoints`.
- Reward phải có ít nhất 1 trường non-empty (`linhThach > 0` hoặc `tienNgoc > 0` hoặc `items.length > 0` hoặc `titleKey != null` hoặc `buffKey != null`).

### 11.15.3 Read-only safety

Phase 13.2.A **KHÔNG có endpoint write**: chỉ 3 endpoint GET (`/sect-season/current`, `/sect-season/leaderboard`, `/sect-season/me`). Hệ quả:
- KHÔNG có audit log Sect Season.
- KHÔNG có ledger entry mới (reward chưa grant).
- KHÔNG có race condition / CAS guard / idempotency key (read-only aggregation).

**Tie-break determinism**: leaderboard tổng hợp top 10 sect tie-break `(points desc, sectId asc)` — giống Sect War tuần Phase 13.1.A pattern. Đảm bảo deterministic ordering khi nhiều sect cùng điểm.

**Out-of-season fallback**: `currentSectSeason(now)` return `null` khi `now` ngoài cả 13 window. API endpoint trả `seasonKey=null` / `season=null` / `me=null` — FE render banner "Hiện không có mùa giải đang chạy" (KHÔNG crash, KHÔNG empty leaderboard mặc định).

### 11.15.4 Roadmap to Phase 13.2.B+

Phase 13.2.A foundation only. Phase 13.2.B+ sẽ thêm:
- **13.2.B**: Reward claim atomic per milestone — composite UNIQUE `(seasonKey, characterId, milestoneKey)` chống double-claim, ledger `SECT_SEASON_MILESTONE_CLAIM`, FE claim button.
- **13.2.C**: Cross-sect tournament bracket — top 4-8 sect cuối mùa head-to-head bracket.
- **Admin season tooling**: force resolve / freeze leaderboard / hot-swap milestone catalog.

---

## 11.16 SECT TERRITORY INFLUENCE FOUNDATION (Phase 14.0.A)

Phase 14.0.A mở foundation cho **Lãnh Địa Tông Môn** — mỗi region trong `MAP_REGIONS` (9 region: son_coc, hac_lam, yeu_thu_dong, kim_son_mach, moc_huyen_lam, thuy_long_uyen, hoa_diem_son, hoang_tho_huyet, cuu_la_dien) có Sect Influence Leaderboard riêng. Boss/dungeon trong region tự cộng điểm cho Tông của character clear/tham chiến → Tông nào hoạt động nhiều nhất sẽ rank cao trong vùng. **KHÔNG** có settlement capture / siege / region-wide buff / decay — defer Phase 14.0.B+.

### 11.16.1 Influence source dial

3 source = 3 hook gameplay đã có. Caller đảm bảo idempotent qua `sourceId` (run.id / boss×character).

| Source key             | Points / hit | Daily cap | Weekly cap | Trigger                                                                                       |
|------------------------|--------------|-----------|------------|-----------------------------------------------------------------------------------------------|
| `dungeon_clear`        | 8            | 60        | 420        | `DungeonRunService.claimRun()` khi dungeon template có `regionKey ∈ MAP_REGIONS`. Source = `runId`. |
| `boss_participation`   | 12           | —         | 96         | `BossService.distributeRewards()` cho mọi participant rank ≥ 1 với boss có `regionKey ∈ MAP_REGIONS`. Source = `${bossId}:${characterId}`. |
| `boss_top_damage`      | 20           | —         | 80         | Cộng thêm cho rank-1 participant khi boss có `regionKey ∈ MAP_REGIONS`. Source = `${bossId}:${characterId}` (sourceKey khác → row riêng). |

**Soft envelope tổng / character / region / week**: `60 × 7 + 96 + 80 = 596` pts. Đây là cap lý thuyết "siêu hardcore farm 7 ngày/region" — thực tế tier mainstream sẽ < 200 pts/region/week.

Quy đổi sang sect influence: 30 thành viên active → ~10k-15k pts/region/week trên top sect. Sect ít active → vẫn lên bảng nhưng sẽ trail xa.

### 11.16.2 Cap enforcement

Cap compute trước insert ở `TerritoryService.addInfluenceTx`:
- **Daily window**: row `createdAt` trong cùng calendar-day theo `MISSION_RESET_TZ` (Asia/Ho_Chi_Minh, UTC+07).
- **Weekly window**: row `createdAt` trong cùng ISO week (Mon-Sun) theo cùng timezone.

Reject = no-op (return `null`); KHÔNG throw, KHÔNG ghi row. Hook ở gameplay flow chạy `try/catch` swallow → cap reach KHÔNG fail dungeon claim / boss reward.

### 11.16.3 Idempotency

Composite UNIQUE `(regionKey, characterId, sourceKey, sourceType, sourceId)` ở table `SectTerritoryInfluence` — caller retry an toàn (gameplay tx commit retry / claim retry không double điểm). Sect đổi (kick/leave/join) sau khi điểm đã ghi → row giữ `sectId` snapshot tại lúc ghi (KHÔNG migrate sang sect mới).

### 11.16.4 Read API surface

| Endpoint                                          | Purpose                                                                 |
|---------------------------------------------------|-------------------------------------------------------------------------|
| `GET /territory/regions`                          | List 9 region + total influence + top sect.                             |
| `GET /territory/regions/:regionKey/leaderboard`   | Top 10 sect trong region (`points` desc, tie-break `sectId` asc).       |
| `GET /territory/me`                               | Personal view: per-region rank/points của sect user + personal contribution. |

Read-only — server-authoritative; FE KHÔNG mutate trực tiếp. Mọi điểm chỉ vào qua hook.

### 11.16.5 Out of scope (Phase 14.0.A)

- **Decay theo thời gian / season reset** (defer 14.0.B+).
- **Sect mission hook** — mission không gắn region (defer cần thiết kế lại sect mission scope).
- **Admin tooling** (recalc influence, audit snapshot).

### 11.16.6 Roadmap to Phase 14.0.B+

- **14.0.B** ✅ (this PR): Settlement & Region Ownership — kết toán theo period (ISO week hoặc admin manual), top sect chiếm vùng, snapshot history, FE owner badge.
- **14.0.C**: Region-wide buff khi Tông sở hữu region (tăng cultivation rate / drop rate cho member trong khu vực đó). Foundation ready qua `getOwnerStateMap()`.
- **14.0.D**: Settlement node trong region — sect chiếm giữ → siege phase với attackers / defenders.
- **14.0.E**: Decay (linear/season reset) + reward redistribute end-of-week (sect rank 1-3 lấy buff/title slot).

---

## 11.17 SECT TERRITORY SETTLEMENT (Phase 14.0.B)

Phase 14.0.B biến influence leaderboard (14.0.A) thành **chiếm vùng thật**. Cuối tuần (cron — chưa wire trong PR này) hoặc admin trigger settlement, top sect theo influence chiếm region trong period đó.

### 11.17.1 Period key

- **ISO 8601 week**: `YYYY-Www` (vd `2026-W19`). Compute qua `territoryPeriodKeyForDate(date)` shared helper. Boundary handle: `2025-12-29` thuộc về `2026-W01` (ISO 8601 spec).
- **Admin manual**: `manual_*` (vd `manual_test_2026_05_08`). Regex `^manual_[a-z0-9_-]{1,40}$`. Dùng cho admin override / debug / hotfix.
- **Validate**: `isTerritoryPeriodKey(key)` — guard input từ user/admin trước khi insert.
- **Default**: nếu admin endpoint không truyền `periodKey`, fallback `previousTerritoryPeriodKey()` (tuần trước theo Asia/Ho_Chi_Minh).

### 11.17.2 Settlement algorithm

```
settleRegion(regionKey, periodKey, opts?):
  1. validate regionKey (REGION_INVALID throw nếu sai)
  2. validate periodKey (PERIOD_INVALID throw nếu sai)
  3. findUnique SectTerritorySettlementSnapshot WHERE (regionKey, periodKey)
     → nếu tồn tại: return existing (idempotent path, KHÔNG overwrite)
  4. groupBy SectTerritoryInfluence WHERE regionKey
     SELECT sectId, SUM(points) GROUP BY sectId
  5. nếu rỗng: return { skipped: true } (KHÔNG ghi snapshot/state)
  6. sort: points DESC, sectId.localeCompare ASC (deterministic tie-break)
  7. resolve sect names cho winner + runner-up (qua Sect.findMany)
  8. transaction:
     a. snapshot = create SectTerritorySettlementSnapshot { ... } (catch P2002 → return existing)
     b. upsert SectTerritoryRegionState { regionKey, ownerSectId, ownerSectName, periodKey, settledAt }
        — lưu ý: chỉ overwrite state nếu period mới >= state.periodKey (compare ISO string lexicographic)
  9. return snapshot
```

**Tie-break invariant**: 2 sect cùng điểm trong region → sect có `sectId` nhỏ hơn theo `localeCompare` thắng. Deterministic, KHÔNG random.

**Idempotency invariant**: `settleRegion(r, p)` gọi 2 lần luôn return cùng snapshot id, KỂ CẢ KHI influence tăng giữa 2 call (do step 3 short-circuit trước groupBy).

**Race-safety invariant**: 2 `settleRegion(r, p)` đồng thời → UNIQUE `(regionKey, periodKey)` đảm bảo chỉ 1 row. Loser catch P2002 → fetch lại row đã ghi → return.

**Skip empty regions**: region không có row trong `SectTerritoryInfluence` (filter theo `regionKey`) → `skipped: true`, KHÔNG ghi snapshot/state. Region không có chủ vẫn render trên FE với `ownerSectId = null`.

### 11.17.3 Region state (current owner)

`SectTerritoryRegionState` (1 row / region) dùng cho FE/runtime O(1) lookup chủ vùng hiện tại — KHÔNG join từ snapshot table mỗi lần render.

- `regionKey @id` — primary key.
- `ownerSectId? FK Sect SET NULL` — nếu sect bị delete, owner clear (KHÔNG cascade history snapshot).
- `ownerSectName?` — denormalized snapshot tại lúc settle. KHÔNG sync khi sect đổi tên (history).
- `periodKey?` — period chiến thắng. Cho FE hiển thị "Kết toán: {period}".
- `settledAt`, `updatedAt`.

### 11.17.4 Snapshot history

`SectTerritorySettlementSnapshot` lưu mọi lần settle (1 row / region / period). Audit + history view + future season reward.

- UNIQUE `(regionKey, periodKey)` — race-safe + idempotent.
- Denormalized: `winnerSectId/Name/Points`, `runnerUpSectId/Name/Points` (nullable nếu chỉ có 1 sect).
- `totalSects`, `totalPoints` — tổng influence trong region tại lúc settle.
- `settledBy?` — nullable. Cron settle → null. Admin endpoint settle → `req.userId`.

### 11.17.5 Out of scope (Phase 14.0.B)

- **Decay theo thời gian** — period sau KHÔNG reset điểm influence (defer 14.0.E).
- **Influence cleanup** — KHÔNG xóa row `SectTerritoryInfluence` cũ (defer + cần audit log trước).
- **Region-wide buff** — owner chiếm vùng nhưng KHÔNG tự cộng buff (defer 14.0.C).
- **Cron weekly job** — chỉ admin trigger trong PR này; cron schedule wire trong phase sau.
- **Settlement notification** (in-game/discord) — defer.
- **Siege / contestable region** — defer 14.0.D.

---

## 11.18 SECT TERRITORY REGION BUFF + INFLUENCE DECAY (Phase 14.0.C)

Phase 14.0.C biến quyền sở hữu vùng (Phase 14.0.B) thành lợi ích gameplay thật + chống một sect giữ vùng vĩnh viễn.

### 11.18.1 Region buff catalog

Mỗi region có 0..N buff config trong `packages/shared/src/territory-buffs.ts` (`TERRITORY_REGION_BUFFS`). Buff CHỈ áp dụng cho character thuộc Tông đang sở hữu region đó (`SectTerritoryRegionState.ownerSectId === character.sectId`). KHÔNG owner = KHÔNG buff.

| Region | Buff key | Type | Value | AppliesTo |
|---|---|---|---|---|
| `son_coc` | `territory_son_coc_exp` | `EXP_BONUS` | +5% | `DUNGEON_REWARD` |
| `hac_lam` | `territory_hac_lam_drop` | `LINH_THACH_BONUS` | +5% | `DUNGEON_REWARD` |
| `moc_huyen_lam` | `territory_moc_huyen_lam_dmg` | `ELEMENTAL_DAMAGE` | +5% (element=`moc`) | `COMBAT`, `ELEMENTAL` |
| `kim_son_mach` | `territory_kim_son_mach_dmg` | `ELEMENTAL_DAMAGE` | +5% (element=`kim`) | `COMBAT`, `ELEMENTAL` |
| `hoang_tho_huyet` | `territory_hoang_tho_huyet_def` | `DEFENSE_BONUS` | +5% | `COMBAT` |

### 11.18.2 Envelope ép catalog

- `TERRITORY_BUFF_VALUE_MAX = 0.10` (10%) — `validateTerritoryBuffCatalog()` ép mọi `value` ≤ cap (mặc định cap entry = `TERRITORY_BUFF_VALUE_MAX` nếu không khai). Buff nhỏ-có-kiểm-soát; KHÔNG cộng dồn cho thiết kế Phase 14.0.C (1 region → 1 sect-owner → 1 buff stack scope).
- Catalog UNIQUE `buffKey` toàn cục + `regionKey` phải tồn tại trong `MAP_REGIONS`.
- Test invariant `packages/shared/src/territory-buffs.test.ts` 32 test ép catalog tuân envelope + helper deterministic.

### 11.18.3 Runtime integration (Phase 14.0.C)

Phase 14.0.C wire buff vào **dungeon reward claim** — điểm an toàn nhất, idempotent, không double-apply khi retry:

- `DungeonRunService.claimRun()` sau territory hook gọi `applyTerritoryDungeonRewardBuffs(rewards, regionKey, ownerSectId, characterSectId)` → nếu owner-of-region và buff `appliesTo` chứa `DUNGEON_REWARD` thì cộng phần trăm cho `expGained` (`EXP_BONUS`) hoặc `linhThachGained` (`LINH_THACH_BONUS`).
- `Math.floor` round bonus về integer; KHÔNG cộng nếu `value=0`. Reward bonus tính trên reward gốc, KHÔNG tính trên reward đã cộng buff khác (anti-stack double).
- Fail-soft: bất kỳ exception nào trong helper → swallow + warn log; reward chính KHÔNG fail.
- Boss/dungeon other reward + combat elemental: defer (catalog đã ship; wire runtime kết hợp Phase 14.2.x điều chỉnh để không vỡ counter envelope `[0.5, 1.6]`).

### 11.18.4 Influence decay

Mỗi period (ISO week hoặc manual key) admin có thể trigger decay để giảm điểm influence cũ → ngăn 1 sect chiếm vùng vĩnh viễn.

- **Mặc định** `TERRITORY_DECAY_DEFAULT_BPS = 2500` (25% / period).
- **Cap** `TERRITORY_DECAY_MAX_BPS = 5000` (50% / period — không nới).
- **Range** `1 ≤ bps ≤ 5000`. Invalid → reject `DECAY_BPS_INVALID`.
- **Helper** `computeTerritoryDecay(currentPoints, decayBps)` deterministic floor — return `{ before, after, delta }`, không bao giờ âm.
- **Idempotency** qua `SectTerritoryDecayLog` UNIQUE `(periodKey)` — gọi cùng `periodKey` 2 lần trả `{ skipped: true }` lần thứ 2.
- **Race safety**: P2002 retry / lock — concurrent admin trigger cùng `periodKey` → 1 winner ghi log, các caller khác đọc lại log đã tồn tại.

### 11.18.5 Out of scope (Phase 14.0.C)

- **Auto cron decay** — chỉ admin trigger trong PR này; cron weekly schedule defer Phase 14.0.D Territory Weekly War Loop.
- **Boss/dungeon reward bonus** — chỉ EXP/Linh Thạch trong dungeon claim; defer `BOSS_REWARD` / extended source.
- **Combat elemental buff runtime** — catalog ship sẵn `ELEMENTAL_DAMAGE` cho moc/kim, defer wire vào combat pipeline để giữ Phase 14.2.x envelope.
- **Region siege / PvP realtime / diplomacy** — defer 14.0.D+.

### 11.18.6 Roadmap to Phase 14.0.D+

- **14.0.E**: Cron auto-settle + reward mail — Redis lease / DB guard race-safe; owner reward (linh thach + contrib + sect title); Hall of Fame archive.
- **14.0.F**: Region siege node — defenders / attackers timeline, soft PvP.

---

## 11.19 SECT TERRITORY WEEKLY WAR LOOP (Phase 14.0.D)

Phase 14.0.A đã ship influence (`SectTerritoryInfluence`), 14.0.B đã ship settlement + ownership (`SectTerritoryRegionState`/`SectTerritorySettlementSnapshot`), 14.0.C đã ship region buff + decay. Phase 14.0.D đóng vòng chơi cạnh tranh theo tuần — period key, countdown, region standings, history, admin trigger.

### 11.19.1 Period rule (deterministic ISO week, UTC)

- **Period key format**: `YYYY-Www` (ISO 8601 week, e.g., `2026-W23`). KHÔNG dùng calendar week (Sun-Sat) — dùng **ISO week** (Mon-Sun) để align với phần lớn server gameplay quốc tế.
- **Boundary**:
  - `startsAt = Monday 00:00:00.000 UTC` của tuần.
  - `endsAt = Monday 00:00:00.000 UTC` của tuần kế tiếp (= `nextResetAt`).
  - Cửa sổ là `[startsAt, endsAt)` (left-closed, right-open) — đảm bảo không trùng.
- **Helpers shared (`packages/shared/src/territory-period.ts`)** đều **pure** (nhận `now: Date` optional, default `new Date()`) — fake-date testable:
  - `currentTerritoryPeriodKey(now?)` → string.
  - `previousTerritoryPeriodKey(now?)` → string (đã có từ 14.0.B/C).
  - `nextTerritoryResetAt(now?)` → Date (= `endsAt` của period hiện tại).
  - `territoryPeriodWindow(periodKey)` → `{ startsAt: Date, endsAt: Date }` (throw `PERIOD_INVALID` nếu key không hợp lệ).
  - `isTerritoryPeriodKey(key)` → boolean.
- **Timezone rationale**: UTC là nguồn duy nhất — KHÔNG hỗ trợ timezone client/admin local. Lý do: tránh DST + race khi nhiều admin ở múi giờ khác trigger settle. Client hiển thị qua `toLocaleString()` ở FE, KHÔNG round-trip.

### 11.19.2 Settlement algorithm cho war loop

- **Endpoint admin trigger**: `POST /admin/territory/war/settle-current` (khác `/admin/territory/settle` của 14.0.B vốn settle previous period). War endpoint chốt **period hiện tại** — phục vụ admin/test cắt sớm tuần. Production thực tế (Phase 14.0.E) sẽ có cron auto-settle previous period vào Monday 00:00 UTC.
- **Idempotent + race-safe** qua UNIQUE `(regionKey, periodKey)` của `SectTerritorySettlementSnapshot` — gọi 2 lần cùng `periodKey` → cùng snapshot id (snapshot row đã tồn tại, KHÔNG ghi đè).
- **No-influence rule** (sticky owner):
  - Region không có sect đủ điểm (`SectTerritoryInfluence.points` ≤ 0 cho periodKey đang chốt) → **KHÔNG ghi snapshot**, **KHÔNG đổi** `SectTerritoryRegionState`. Region đã có owner kỳ trước → giữ owner. Region chưa từng có owner → giữ trạng thái no-owner.
  - Liệt kê trong `result.skippedRegions[]`.
  - Lý do: owner cần "duy trì điểm" mới giữ vùng — nếu sect chiếm xong rồi bỏ chơi, người khác có thể giành kỳ kế. NHƯNG nếu KHÔNG ai có điểm → KHÔNG cướp được vùng từ sect cũ (nếu họ chưa quay lại vẫn giữ). Tránh "vacuum churn" làm region nhảy random qua các tuần ít người.
- **Tie-break**: deterministic `sectId.localeCompare()` ASC (cùng quy tắc 14.0.B). Reproducible giữa các lần gọi và môi trường.
- **`ownersAfter`**: result trả về **9 region** snapshot owner sau settle để FE refresh state không cần round-trip thêm. Region skip → `ownerSectId/Name = null` (giữ trạng thái cũ — FE đọc thêm từ `getRegionsView` nếu cần verify).

### 11.19.3 Read API surface (war panel)

- `GET /territory/war/current` → state cho countdown panel + 9 region card với top 3 standings.
- `GET /territory/war/regions/:regionKey` → region detail (top 10 + 5 settlement gần nhất).
- `GET /territory/war/history?limit=` → entries DESC settledAt, group periodKey (default 8, cap 32).
- Tất cả **public** — không cần auth (đồng bộ với `/territory/regions` Phase 14.0.B/C).

### 11.19.4 Out of scope (Phase 14.0.D)

- **Cron tự động cuối tuần**: defer Phase 14.0.E. Hiện tại **admin trigger only** qua endpoint mới — production cần Redis lease (e.g., `SET NX PX`) + DB guard (settled snapshot UNIQUE) trước khi enable cron để tránh race khi 2 worker chạy cùng lúc.
- **Reward / mail cho owner sect**: defer 14.0.E. Hiện tại owner chỉ hưởng region buff (Phase 14.0.C wire dungeon reward fail-soft) — chưa có thưởng linh thach / contrib / item / mail.
- **Decay tự động trước/sau settle**: tách Phase 14.0.C admin trigger riêng (`POST /admin/territory/decay`). Admin có thể chạy decay rồi mới settle (hoặc ngược lại) — không bind vào pipeline tự động.
- **Siege / diplomacy / PvP realtime / auction**: out of phase.
- **Hall of Fame archive cũ**: defer 14.0.E (snapshot history vẫn nằm trong `SectTerritorySettlementSnapshot`, chưa có UI Hall of Fame).

### 11.19.5 Roadmap to Phase 14.0.E+

- **14.0.E**: Reward mail cho owner sect (admin trigger). **DONE this PR**.
  - Cron auto-settle defer Phase 14.0.F (cần Redis lease lock 5 phút + idempotent recheck via UNIQUE).
  - Hall of Fame archive snapshot > 16 tuần qua bảng riêng — defer Phase 14.0.G.
- **14.0.F**: Cron Season/Territory Automation — auto-trigger `grantWeeklyOwnerRewardMail(previousTerritoryPeriodKey())` sau settlement.
- **14.0.G**: Region siege node — defenders / attackers timeline, soft PvP.

---

## 11.20 SECT TERRITORY OWNER REWARD MAIL (Phase 14.0.E)

Phase 14.0.D đã có settlement weekly + region ownership state. Phase 14.0.E ship **reward mail** cho member sect chiếm region — đóng vòng "earn ⇒ chiếm ⇒ nhận thưởng".

### 11.20.1 Reward catalog (`packages/shared/src/territory-owner-reward.ts`)

`TERRITORY_OWNER_REWARDS` 1-1 parity với `MAP_REGIONS` (9 entries). Reward tier scale theo `unlockRealmKey` của region (early-game region nhận ít hơn late-game region để cân bằng effort).

| Region | LinhThạch | EXP | Items |
|---|---|---|---|
| `son_coc` | 200 | 100 | 2× `huyet_chi_dan` |
| `hac_lam` | 250 | 120 | 2× `linh_lo_dan` |
| `moc_huyen_lam` | 300 | 150 | 2× `thanh_lam_dan` |
| `yeu_thu_dong` | 400 | 200 | 2× `huyet_chi_dan`, 1× `linh_lo_dan` |
| `kim_son_mach` | 400 | 200 | 1× `linh_lo_dan`, 2× `huyet_tinh` |
| `thuy_long_uyen` | 400 | 200 | 2× `linh_lo_dan`, 1× `thanh_lam_dan` |
| `hoa_diem_son` | 500 | 250 | 2× `linh_lo_dan`, 1× `co_thien_dan` |
| `hoang_tho_huyet` | 500 | 250 | 2× `linh_lo_dan`, 1× `co_thien_dan` |
| `cuu_la_dien` | 800 | 400 | 1× `co_thien_dan`, 2× `huyet_tinh` |

**Caps** (validated bằng `validateTerritoryOwnerRewardCatalog()`): `linhThach ≤ 1000`, `exp ≤ 600`, `itemRewards.length ≤ 3`, `qty ≤ 5`. Mọi reward đều ≥ 0.

### 11.20.2 Economy budget worst-case

Nếu 1 sect độc chiếm cả 9 region (extreme — chưa từng quan sát trong test):
- `linhThach`: 200+250+300+400+400+400+500+500+800 = **3 750/tuần** chia cho N member.
- `exp`: 100+120+150+200+200+200+250+250+400 = **1 870/tuần** mỗi member (mail dạng EXP claim, KHÔNG cộng dồn theo member).
- Item: ~16 entries × ≤2 qty = ≤32 item nhỏ.

So sánh với mission daily ~500-1000 linthach/ngày × 7 = 3500-7000 linthach/tuần → reward territory ≈ 50-100% mission income, KHÔNG phá economy. Realistic 1-3 region/sect → 600-1500 linthach/tuần.

### 11.20.3 Idempotency model

Bảng `TerritoryOwnerRewardGrant` UNIQUE `(periodKey, regionKey, characterId)`:
- Gọi `grantWeeklyOwnerRewardMail(periodKey)` lần thứ 2 cùng `periodKey` → 0 mail mới (toàn bộ skipped, count vào `skippedAlreadyGranted`).
- Concurrent admin trigger → P2002 unique violation → loser swallow trả `existed`. Chỉ 1 mail tạo per (period, region, character).
- Transaction wrap: `INSERT grant → INSERT mail → UPDATE grant.mailId`. P2002 ở step 1 → rollback toàn bộ tx (mail chưa kịp tạo).

### 11.20.4 Member snapshot rule

**Quyết định**: nhận thưởng theo MEMBER HIỆN TẠI tại thời điểm trigger (`Character.sectId === winnerSectId` lúc query). KHÔNG snapshot member tại thời điểm settlement.

Tradeoff:
- **Pro (chosen)**: Đơn giản, không cần bảng `TerritorySettlementMemberSnapshot` riêng. Member rời sect trước trigger → KHÔNG nhận (hợp lý — họ rời thì không nên ăn thưởng).
- **Pro 2**: Member join sau settlement (trước trigger) → NHẬN. Sect mới recruit có incentive.
- **Con**: Sect có thể "mass invite + grant + kick" trong 1 phiên admin trigger để gaming. Mitigation: admin trigger có audit (`triggeredBy`) + grant row giữ lịch sử.
- Alternative bị reject: snapshot member tại thời điểm settle → cần bảng riêng + logic xử lý member-không-còn-trong-sect (mail vẫn gửi?). Phức tạp không cần thiết cho closed-beta.

### 11.20.5 Out of scope (Phase 14.0.E)

- **Cron tự động** trigger: defer Phase 13.2.D + 14.0.F (Season/Territory Automation Cron).
- **Reward title/buff runtime**: chỉ mail-based reward. Title/buff dài hạn defer phase sau (cần thêm pattern title catalog clean trước).
- **Diff reward theo rank** (chỉ rank 1 nhận, không có reward cho runner-up). Có thể thêm tier 2 nếu data telemetry cho thấy cần balance.
- **Ledger entry runtime**: `linhThach` / `exp` / `items` đi qua mail (`recipientId`, claim qua `MAIL_CLAIM` ledger reason đã có). Audit trail riêng ở `TerritoryOwnerRewardGrant.rewardJson` snapshot.

---

## 11.21 ASYNC ARENA FOUNDATION (Phase 14.1.B)

### Mục tiêu balance
- Cung cấp PvP loop **bất đồng bộ** (không cần đối thủ online) — đáp ứng casual + competitive lite.
- **Determinism guarantee**: cùng snapshot + seed → cùng kết quả → có thể replay/audit/cheat-detect.
- Rating đơn giản đầu (Phase 14.1.B), thay bằng ELO progression curve ở Phase 14.1.C khi có telemetry.
- Daily limit chống farm rating abuse + chống auto-grind 24/7.

### Catalog source
- `packages/shared/src/arena.ts` — enums + config + helpers (`arenaRatingDeltaFor`, `clampArenaRating`, `arenaDayBucket`, `arenaRankTierFor`).
- Migration `apps/api/prisma/migrations/20260616000000_phase_14_1_b_arena_foundation`.

### Rating model (placeholder Phase 14.1.B)
- **Default rating**: `1000` (`ARENA_RATING_DEFAULT`). Floor `0`, ceiling `5000`.
- **Delta cố định** (KHÔNG ELO):
  - `ATTACKER_WIN`: attacker `+10`, defender `-5`.
  - `DEFENDER_WIN`: attacker `-5`, defender `+10`.
  - `DRAW`: cả 2 = 0.
- Defender magnitude = ½ attacker (chống punishment quá mức người bị tấn công offline).
- Clamp về `[0, 5000]` mỗi lần update — KHÔNG cho rating âm/quá cao.
- **Lý do delta nhỏ**: với 10 trận/ngày (limit), tối đa rating change ±100/ngày — tránh swing đột ngột vì chưa có anti-wintrade. Phase 14.1.C sẽ thay bằng ELO Elo K-factor scale theo rating diff.

### Daily limit (anti-grind)
- Default `ARENA_DAILY_LIMIT_PER_DAY=10` attacks/character/day.
- `0` = unlimited (dùng cho test / smoke / dev).
- Day bucket: `Asia/Ho_Chi_Minh` (`ARENA_TIMEZONE`), reset 00:00 ICT.
- Server tự rollover `attacksToday=0` lazy ở `getOrCreateProfile` (so sánh với `lastAttackDayBucket`).
- KHÔNG limit số lần BỊ tấn công (defender). Nếu Phase 14.1.C cần: thêm `defendsToday` counter.

### Opponent matching
- Default rating window ±200 (sortBy abs diff ASC).
- Limit default 10, max 50.
- **Fallback random** khi sparse (< limit người trong window): mở rộng dần ra entire pool, **loại trừ self**.
- KHÔNG match cùng sect (defer Phase 14.1.C anti-collusion).
- KHÔNG match repeat trong N giờ (defer Phase 14.1.C anti-wintrade).

### Match resolution flow
1. POST `/arena/matches { defenderCharacterId, seed? }`.
2. Validate (auth + character + no-self + daily limit).
3. **Tx**:
   - Build `attackerSnapshot` + `defenderSnapshot` từ Character row hiện tại (qua `buildArenaActorSnapshot` → `buildCombatActorSnapshot` Phase 14.1.A).
   - INSERT `ArenaMatch { status: PENDING, seed: 0, ... }` để get matchId.
   - Derive seed: `seed ?? hashSeed("arena-match:<matchId>")`.
   - `resolveCombatWithSnapshot({ attacker, defender, seed, context: { source: 'ARENA_PREP' } })`.
   - Determine outcome từ `sim.winner`.
   - UPDATE match → `RESOLVED` (kèm result, winnerCharacterId?, seed, battleLogJson, ratingDeltaJson).
   - UPDATE attacker `ArenaProfile`: rating + delta (clamp), wins/losses/draws++, `attacksToday++`.
   - UPDATE defender `ArenaProfile`: rating + delta (clamp).
4. Return `ArenaMatchResult` với `outcome`, `ratingDelta`, `attackerRatingAfter`, `defenderRatingAfter`, `totalAttackerDamage`, `totalDefenderDamage`, `rounds`, `battleLog[]`.

**KHÔNG queue/job runtime** — sync trong cùng request. Latency ~10–50ms (resolver pure deterministic, không I/O).

### Snapshot lock-in
- `attackerSnapshotJson` + `defenderSnapshotJson` immutable sau khi RESOLVED.
- `seed` lưu cùng row → replay bit-exact qua `resolveCombatWithSnapshot`.
- Defender stat lock-in tại thời điểm match created → defender breakthrough/changed equipment sau đó KHÔNG ảnh hưởng kết quả trận.

### Tier (placeholder Phase 14.1.B)
- `arenaRankTierFor(rating)` chỉ trả `'unranked'` Phase 14.1.B.
- 5 slot reserved cho Phase 14.1.C (bronze/silver/gold/platinum/diamond) — tránh re-migration.

### Anti-cheat / Limitations Phase 14.1.B
- `CANNOT_ATTACK_SELF` enforced.
- `DAILY_LIMIT_REACHED` enforced (env-config).
- KHÔNG: cooldown giữa cùng cặp (anti-wintrade), IP/device fingerprint, min-level/realm gate (defender quá yếu vẫn cho), anti-throw (defender intentional lose), gear-check anti-naked (defender cố tình unequip).
- Defer toàn bộ sang Phase 14.1.C Arena Season + ELO + Reward.

### Tests
- `packages/shared/src/arena.test.ts` (16 tests): rating delta branch, clamp floor/ceiling, day bucket ICT/UTC, enum guards, tier placeholder.
- `apps/api/src/modules/arena/arena.service.test.ts` (19 tests): profile lazy-create + idempotent + NO_CHARACTER, opponents excludes self + fallback when sparse, match create rejects self/unknown/invalid, persists snapshots/seed/log/delta, **deterministic replay** (load row → resolve again → bit-exact), counters, daily limit + 0=unlimited, history DESC + side filter + limit.
- `apps/web/src/views/__tests__/ArenaView.test.ts` (22): profile/opponents/result/history loading/error/render, challenge button calls API + toast, dismiss banner, refresh, mount triggers.
- `apps/web/src/api/__tests__/arena.test.ts` (8): envelope parsing, query string, error throw.
- `apps/web/src/stores/__tests__/arena.test.ts` (8): fetchProfile/Opponents success+error, challenge IN_FLIGHT guard, clearLastResult.

### Defer / Out of scope Phase 14.1.B
- Season cycle (weekly/monthly snapshot).
- ELO progression curves.
- End-season mail reward + Hall of Fame.
- Anti-wintrade phức tạp (cooldown + fingerprint + min-level gate).
- Defense AI snapshot khi player offline (Phase 14.1.B dùng live stat tại thời điểm match).
- Realtime PvP / cross-server / party arena.

## 11.22 ARENA SEASON + ELO + REWARD (Phase 14.1.C)

### Mục tiêu balance
- Cho người chơi mục tiêu trung hạn (weekly season + tier progression) thay cho lifetime rating cô đọng của 14.1.B.
- ELO mean-reverting → giúp matchmaking công bằng hơn theo thời gian.
- Reward modest theo tier — không cho người top farm vô hạn currency phá economy.
- Idempotent settle → admin có thể safely re-run mà không gây double-grant.

### Catalog source
- `packages/shared/src/arena-season.ts` — `ARENA_SEASON_CONFIG`, `ARENA_ELO_CONFIG`, `ARENA_SEASON_REWARD_TABLE`, `ARENA_RANK_TIERS`, helpers (`arenaCurrentSeasonKey`, `arenaCurrentSeasonRange`, `arenaEloRatingDelta`, `arenaSeasonTierFor`).
- Migration `apps/api/prisma/migrations/20260617000000_phase_14_1_c_arena_season`.

### Season cadence
- **Weekly** (`cadence: 'weekly'`), timezone `Asia/Ho_Chi_Minh`.
- Season start = Monday 00:00 ICT, end = next Monday 00:00 ICT (exclusive).
- Season key format: `arena_<ISO_year>-W<ISO_week>` (ISO week — ổn định cross-year boundary).
- 1 ACTIVE season tại 1 thời điểm. Lazy-create khi:
  - `GET /arena/season/current` lần đầu trong tuần, hoặc
  - Match đầu tiên trong tuần resolve (qua `getOrCreateActiveSeason`).
- Status FSM: `ACTIVE` → `SETTLED` (admin) → `ARCHIVED` (manual / future cron).

### ELO formula
```
K = 32
expectedA = 1 / (1 + 10 ^ ((ratingB - ratingA) / 400))
deltaA    = round(K * (scoreA - expectedA))   // win=1, draw=0.5, lose=0
defenderDelta = round(deltaA * -1 * 0.6)       // 60% scale
```

- **K-factor 32**: vừa phải — top tier cần ~10–15 trận để chuyển tier; bottom tier nhanh hơn.
- **Defender 60% scale**: defender mất ít hơn vì offline, không control trận; cũng ngăn punishment quá nặng so với 14.1.B (50%).
- **Floor 0, ceiling 5000**: chống integer overflow + tránh rating runaway.
- Tại rating bằng nhau (1000 vs 1000): ATTACKER_WIN ⇒ attacker `+16`, defender `-10`.
- Tại rating khác nhau: underdog win → delta lớn (vd. 800 vs 1200 ⇒ underdog win → +29 / -17), favorite win → delta nhỏ (+3 / -2). Tránh top farm bottom.

### Tier breakpoints
| Tier | Rating range | % player ước tính (default 1000) |
|------|--------------|-----:|
| BRONZE   | 0..999      | ~50% (start tier nếu thua first matches) |
| SILVER   | 1000..1199  | ~30% |
| GOLD     | 1200..1499  | ~12% |
| DIAMOND  | 1500..1799  | ~6% |
| IMMORTAL | 1800+       | ~2% |

Breakpoint đặt rộng hơn ở mid-tier (200 width) và hẹp hơn ở high-tier (300 width) — theo distribution ELO chuẩn bell curve.

### Reward table
| Tier | Linh Thạch | Tiên Ngọc | Items | Notes |
|------|-----------:|----------:|-------|-------|
| BRONZE   | 200  | — | — | Participation reward |
| SILVER   | 500  | — | huyet_chi_dan ×5 | Active player |
| GOLD     | 1000 | — | huyet_chi_dan ×10 | Skilled |
| DIAMOND  | 2000 | 20 | linh_lo_dan ×5 | Top performer |
| IMMORTAL | 5000 | 50 | linh_lo_dan ×10 | Elite |

- **Linh Thạch tổng/season**: cap ~5000 (nếu IMMORTAL) — tương đương ~2-3 ngày cap tier-3 cultivation reward (Phase 16.5). Không phá economy.
- **Tiên Ngọc** (premium): chỉ DIAMOND+ — ≤50/season (so với topup base 100 TN/$1) → KHÔNG cạnh tranh trực tiếp với topup revenue.
- **Items** (`huyet_chi_dan`, `linh_lo_dan`) — đã verify tồn tại ở inventory catalog Phase trước. Đều consumable mid-game item.

### Match resolution flow (Phase 14.1.C extension)
1. POST `/arena/matches` (Phase 14.1.B) flow giữ nguyên.
2. Extra step trong cùng TX: `arenaSeasonService.applyMatchToStandings(seasonId, attackerId, defenderId, eloDelta)`.
3. Lazy-create:
   - Season nếu chưa có ACTIVE (qua `getOrCreateActiveSeason`).
   - Standing cho mỗi participant nếu chưa có (qua `getOrCreateStanding`).
4. Update rating + W/L + tier.
5. **Backward compat**: legacy `ArenaProfile.rating` (Phase 14.1.B) cũng được sync với cùng ELO delta.

### Settlement flow
1. ADMIN gọi `POST /admin/arena/season/settle { seasonKey? }` (default current ACTIVE).
2. Service load standings ORDER BY `rating DESC, wins DESC, losses ASC, characterId ASC`.
3. Loop: rank = position, tier = `arenaSeasonTierFor(rating)`, lookup reward bracket.
4. **Upsert** `ArenaSeasonRewardGrant { seasonId, characterId, rank, tier, rewardJson, mailId? }` qua `@@unique([seasonId, characterId])`.
5. Khi grant **mới** (chưa có row) → `mail.sendToCharacter(...)` → ghi `mailId` vào grant.
6. Set `season.status = SETTLED, settledAt = now()`.
7. **Idempotent**: gọi lần 2 → upsert no-op (UNIQUE đã match) → KHÔNG gửi mail trùng.

### Anti-cheat / Limitations Phase 14.1.C
- Vẫn dùng `CANNOT_ATTACK_SELF` + `DAILY_LIMIT_REACHED` (Phase 14.1.B).
- ELO 60% defender scale + ceiling 5000 → soft cap rating.
- KHÔNG có: cooldown giữa cùng cặp (anti-wintrade), IP/device fingerprint, min-level/realm gate, anti-throw, gear-check.
- Defer toàn bộ sang Phase 14.1.D Arena Anti-Wintrade Detection.
- Đã chuẩn bị data: `ratingDeltaJson` per-match + `defenseSnapshotJson` lock-in → 14.1.D có thể audit pattern.

### Tests
- `packages/shared/src/arena-season.test.ts` (28): config valid, helpers deterministic, ELO at-equal-rating + clamp, tier mapping, season range Monday 00:00 ICT, reward table valid + itemKey exists.
- `apps/api/src/modules/arena/arena-season.service.test.ts` (16): lazy-create season + idempotent, lazy-create standing, match auto-update standing, leaderboard order + tiebreak, my-standing rank live, reward preview 5 tier, settle creates mail, **double-settle no duplicate** (count check), no-participant safe, createNextSeason.
- `apps/api/src/modules/admin/admin.controller.test.ts` (+4): arenaSeasonSettle với/không key, invalid key format, arenaSeasonCreateNext, ADMIN-guard reject PLAYER.
- `apps/web/src/views/__tests__/ArenaView.test.ts` (+15): season banner loading/error/render, my standing card + dash khi rank null, leaderboard rows, reward preview 5 tile, history rating delta sign + color.
- `apps/web/src/stores/__tests__/arena.test.ts` (+8): 4 fetch action × success + error fallback.
- `apps/web/src/api/__tests__/arena.test.ts` (+7): query encoding cho 4 endpoint, null standing handling.

### Defer / Out of scope Phase 14.1.C
- Anti-wintrade detection (cooldown giữa cùng cặp, IP fingerprint, min-realm gate, throw detection, gear-check).
- Cross-server leaderboard.
- Realtime PvP / party arena.
- Battle pass tier reward (mid-season milestone).
- Title / cosmetic reward (đợi pattern title clean — Phase 11.9.C).
- Season-end Hall of Fame public page.
- Cron tự động create-next + settle (admin manual cho Phase 14.1.C).

## 11.23 CONTENT SCALE 2 — HIGH-REALM SKILLS PACK (this PR)

### Goal

Sau khi PvP Arena chain (14.1.A → 14.1.D) hoàn thành, late-game player (Nhân Tiên+) cần **power fantasy rõ ràng** — skill catalog hiện tại trải dài luyenkhi → nguyen_anh nhưng từ Hoá Thần / Nhân Tiên trở lên gần như trống. Content Scale 2 bổ sung 25 skill cảnh giới cao mỗi tier × mỗi hệ Ngũ Hành.

### Distribution

| Realm tier | Realm key (anchor) | Order | Số skill | Element coverage |
|---|---|---|---|---|
| Nhân Tiên | `nhan_tien` | 10 | 5 ACTIVE | Kim/Mộc/Thuỷ/Hoả/Thổ |
| Tiên Giới (Huyền Tiên+) | `huyen_tien` | 13 | 5 ACTIVE | Kim/Mộc/Thuỷ/Hoả/Thổ |
| Hỗn Nguyên (Thánh Nhân+) | `thanh_nhan` | 18 | 5 ACTIVE | Kim/Mộc/Thuỷ/Hoả/Thổ |
| Vĩnh Hằng (Vô Chung+) | `vo_chung` | 25 | 5 ACTIVE | Kim/Mộc/Thuỷ/Hoả/Thổ |
| Special / Đạo Quân | `dao_quan` | 23 | 5 ACTIVE/PASSIVE | Kim/Mộc/Thuỷ/Hoả/Thổ |
| **Tổng** | | | **25** | **5 element × 5 tier** |

### Stat budget per tier

Tuân thủ hard cap (`SKILL_ATK_SCALE_HARD_CAP=5`, `MP_COST_HARD_CAP=80`, `COOLDOWN_HARD_CAP=6`, `SELF_HEAL_HARD_CAP=0.5`, `SELF_BLOOD_HARD_CAP=0.3`).

| Tier | atkScale damage ULT | mpCost | cooldown | self-heal / shield ratio | bloodCost |
|---|---|---|---|---|---|
| nhan_tien | 3.5–4.2 | 70–78 | 4–5 | ≤ 0.30 | ≤ 0.10 |
| huyen_tien | 3.8–4.4 | 72–80 | 4–5 | ≤ 0.35 | ≤ 0.15 |
| thanh_nhan | 4.0–4.5 | 75–80 | 5–6 | ≤ 0.40 | ≤ 0.20 |
| vo_chung | 4.2–4.5 | 76–80 | 5–6 | ≤ 0.45 | ≤ 0.30 |
| dao_quan | 0.6–4.5 (variable) | 24–78 | 0–6 | ≤ 0.50 | ≤ 0.30 |

**No one-shot rule**: damage ULT atkScale ≤ 4.5 đảm bảo Arena không chết trong 1 turn từ HP đầy (`HP_ENDURANCE_FLOOR_CHECK` audit). Test `content-scale-2-skills.test.ts > no one-shot` enforce.

### Tier mapping (SkillTemplate)

Tất cả 25 entry dùng `tier: 'master'` matching Phase 11 ULT pattern (`kim_quang_dao_thien` v.v.). `legendary` reserved cho `hoa_than`+ ULT có evolution branches (Phase 12 scope, `hasEvolution=true` invariant). Damage ULT có `atkScale ≥ 3.5` → `inferExpectedTier='legendary'` mismatch là intentional → 25 key thêm vào `TIER_OVERRIDE_ALLOWED` trong `skill-templates.ts`.

### Element identity per tier

Mỗi element giữ identity nhất quán:
- **Mộc**: sustain / heal / poison-cleanse (tag `HEAL`).
- **Hoả**: burst / DOT (tag `BURST` + `DOT`).
- **Thổ**: shield / endurance (tag `SHIELD`).
- **Kim**: armor pierce / crit (tag `CRIT`).
- **Thuỷ**: control / recovery / slow (tag `CONTROL`).

### Combat compatibility

- KHÔNG đụng combat resolver — skill mới chạy native qua `resolveCombatWithSnapshot()` (Phase 14.1.A determinism contract).
- Snapshot normalize sort skill keys lexicographic — verified bit-exact với 25 key mới (`content-scale-2-combat.test.ts > snapshot lex sort`).
- Arena `buildArenaActorSnapshot` không crash với high-realm character (Phase 14.1.B placeholder `['atk_thuong']` vẫn dùng — equipped skill rotation defer Phase 14.1.C extension).

### Test invariants

`content-scale-2-skills.test.ts` (16 tests):
- Catalog presence + balance hard cap conformance.
- Realm coverage (5 tier × 5 element = 25 slots filled).
- Element identity tags match Ngũ Hành identity.
- No one-shot ULT.
- Self-blood-cost ≤ 0.3.

### Known limitations
- **Skill book item drop/consume**: defer Phase 11.2.D.
- **Arena equipped skill rotation**: defer Phase 14.1.C extension.
- **Drop source automatic**: KHÔNG có monster/boss drop / quest reward — admin grant route only.

## 11.24 LIVEOPS EVENT SCHEDULER MULTIPLIER CAPS (Phase 15.1–15.2)

### Goal
Admin có thể tạo / schedule event runtime KHÔNG cần deploy code, NHƯNG cap multiplier server-side để
KHÔNG ai (admin nhầm hay attacker compromise admin) có thể đẩy economy lệch quá xa.

### Catalog (`packages/shared/src/liveops-event-scheduler.ts`)

```ts
LIVEOPS_EVENT_TYPE_CAPS = {
  DOUBLE_DUNGEON_DROP:    { kind: 'BOOST',    cap: 2.0 },
  CULTIVATION_EXP_BOOST:  { kind: 'BOOST',    cap: 2.0 },
  BOSS_REWARD_BOOST:      { kind: 'BOOST',    cap: 2.0 },
  DAILY_LOGIN_BONUS:      { kind: 'BOOST',    cap: 2.0 },
  SHOP_DISCOUNT:          { kind: 'DISCOUNT', cap: 0.5 },  // ≤ 50% off
  SECT_SHOP_DISCOUNT:     { kind: 'DISCOUNT', cap: 0.5 },  // ≤ 50% off
  FESTIVAL_GIFT:          { kind: 'REWARD' },               // rewardJson, no multiplier
}
```

### Validation layers (defense-in-depth)
1. **Shared validator** (`validateLiveOpsScheduledEventInput`): admin POST/PATCH → reject `EVENT_MULTIPLIER_OVER_CAP` nếu `multiplier > cap`.
2. **Runtime clamp** (`clampLiveOpsMultiplier(type, raw)`): khi runtime đọc DB → vẫn clamp để dù DB lưu sai (vd seed bypass / migration cũ) thì hiệu ứng cuối ≤ cap.
3. **Compose policy** (`pickActiveLiveOpsMultiplier`): 2 event cùng type ACTIVE → lấy **MAX**, KHÔNG stack. Vd 2 event cùng `DOUBLE_DUNGEON_DROP` 1.5× và 1.8× → áp 1.8×, KHÔNG phải 1.5 × 1.8 = 2.7×.

### Why these caps
- **2.0× boost cap**: theo BALANCE 11.18 territory buff cap ~1.10× và Phase 14.0.B sect identity bonus ~1.05×, chuỗi compose tối đa với event = `1.10 × 1.05 × 2.0 ≈ 2.31×`. An toàn cho realm-low (mỗi tier daily reward cap ở `DAILY_REWARD_CAP_BY_REALM_AND_SOURCE` đã hấp thụ).
- **0.5 discount cap**: shop discount ≤ 50% off — đảm bảo player chưa bao giờ mua dưới 50% giá list. Dưới mức này gameplay lose-rate trở thành cash sink, không còn currency sink. Defer Phase 15.3 (chưa wire).
- **NO multiplicative stacking**: max-only compose tránh combo `event A 2.0 × event B 2.0 = 4.0×` mà admin không nhận ra.

### Runtime wiring (this PR)
- `DungeonRunService.claimRun`: query `getActiveMultiplier('DOUBLE_DUNGEON_DROP')` → `floor(linhThach × mul)` + `max(1, floor(itemQty × mul))`. Audit `meta.dungeon.liveOpsDropMultiplier` + `liveOpsLinhThachBonus` cho replay.
- `CultivationProcessor.process`: query `getActiveMultiplier('CULTIVATION_EXP_BOOST')` 1× per tick → compose **cuối cùng** sau realm rate / method mul / talent mul / buff cultivation rate mul.

### Cron
- BullMQ repeatable `*/5 * * * *` UTC → SCHEDULED→ACTIVE / ACTIVE→ENDED idempotent qua `updateMany` CAS.
- Disabled by default (env `LIVEOPS_EVENT_SCHEDULER_CRON_ENABLED=true` để bật).
- Race-safe multi-instance: Redis lease 60s TTL + DB CAS guard.

### Known limitations — Phase 15.1–15.2
- 5/7 type chưa wire runtime (`SHOP_DISCOUNT`, `SECT_SHOP_DISCOUNT`, `DAILY_LOGIN_BONUS`, `BOSS_REWARD_BOOST`, `FESTIVAL_GIFT`) — defer Phase 15.3+.
- FESTIVAL_GIFT reward claim API chưa làm (`LiveOpsEventRewardClaim` schema sẵn).

## 11.25 LIVEOPS RUNTIME EXPANSION + FESTIVAL GIFT REWARD CAPS (Phase 15.3.A)

### Goal
Hoàn thiện 5 event type còn lại để 7/7 wire runtime thật, thêm `FESTIVAL_GIFT` one-time reward
với cap nhỏ tránh admin nhầm lì xì 9999 linh thạch / 9999 tiên ngọc.

### FESTIVAL_GIFT reward caps (`LIVEOPS_FESTIVAL_GIFT_REWARD_CAPS`)

```ts
{
  linhThach: { max: 1000 },     // ≤ 1 ngày farm bí cảnh top tier
  tienNgoc:  { max: 50 },       // ≤ ½ daily mission tien_ngoc payout
  items:     { maxEntries: 10, qtyMax: 50 },  // ≤ 10 item type × ≤ 50 qty/each
}
```

### Why these caps
- **`linhThach ≤ 1000`**: 1k linh thạch ≈ 1 phiên dungeon top tier (PHAM/LINH realm) — đủ để festival cảm thấy đáng nhận, KHÔNG phá tier-up curve mà player phải farm 30+ ngày để leo.
- **`tienNgoc ≤ 50`**: tien_ngoc là premium currency — 50 tien_ngoc ≈ 1 daily mission tier hoàn chỉnh. Cap nhỏ tránh festival biến thành "free topup loophole".
- **`items ≤ 10 entries × qtyMax 50`**: tránh attacker (qua compromise admin) đẩy 9999 phế khoáng / 9999 đan dược cho 1k user × 1 event = 1B item phá market price.

### Validation layers (defense-in-depth — Phase 15.3.A)
1. **Shared validator** (`validateLiveOpsEventRewardJson`): per-field check linhThach/tienNgoc/items, reject extra field, validate `itemKey` non-empty + `qty > 0` integer + per-cap. Codes mới: `EVENT_REWARD_JSON_REQUIRED/INVALID/EMPTY/OVER_CAP/ITEM_INVALID/QTY_INVALID/CURRENCY_INVALID`.
2. **Admin create-time** (`AdminLiveOpsEventsController.create`): gọi shared validator → reject 400 nếu rewardJson invalid (ngay khi create event, KHÔNG đợi đến lúc claim).
3. **Claim-time** (`LiveOpsEventSchedulerService.claimEventReward`): re-validate rewardJson **lần nữa** trước khi grant — phòng trường hợp DB row bị corrupted / admin update sau (race) → vẫn safe.
4. **FE clamp** (`AdminLiveOpsEventsPanel.vue` + `LiveOpsActiveEventsPanel.vue`): UI hint multiplier range theo `LIVEOPS_EVENT_TYPE_CAPS`, gọi `validateLiveOpsEventRewardJson` trước submit. UX-only — BE vẫn re-validate.

### Runtime wiring (Phase 15.3.A — full 5/5)
- **`SHOP_DISCOUNT` (≤ 0.5)**: `ShopService.buyFromShop` áp `finalPrice = ceil(originalPrice × (1 − mul))`. Currency ledger ghi `finalPrice` thực chi (KHÔNG ghi originalPrice ở reason). Nếu nhiều SHOP_DISCOUNT ACTIVE → max-only compose.
- **`SECT_SHOP_DISCOUNT` (≤ 0.5)**: `SectShopService.buyFromSectShop` áp tương tự. **KHÔNG bypass** daily/weekly limit + contribution requirement.
- **`DAILY_LOGIN_BONUS` (≤ 2.0)**: `DailyLoginService.claimToday` áp multiplier vào reward. Bonus **đi qua** Daily Reward Cap (cap thắng — nếu cap = 100 và event x2.0 trên reward 80, total cấp = `min(160, cap_remaining)`). One-claim-per-day giữ nguyên qua UNIQUE `(characterId, dateLocal)`.
- **`BOSS_REWARD_BOOST` (≤ 2.0)**: `BossRewardService.distributeRewards` áp multiplier vào reward attribution rank. Mail metadata ghi `liveOpsBoostMultiplier` + `liveOpsEventKey`. KHÔNG phá rank cap reward (rank cap thắng).
- **`FESTIVAL_GIFT` (one-time claim)**: idempotent qua UNIQUE `(eventId, characterId)` — retry sau success → 409 `EVENT_ALREADY_CLAIMED`, KHÔNG double reward. Granted reward ghi atomically `LiveOpsEventRewardClaim` + CurrencyLedger/ItemLedger trong 1 `$transaction`.

### Compose policy reminder
- **Max-only no-stack** giữ nguyên từ Phase 15.1–15.2.
- **Fail-soft**: nếu LiveOps service unavailable → runtime trả `1.0` (BOOST) hoặc `0` (DISCOUNT) → no-op cho gameplay flow, KHÔNG block player.

## 11.26 SECT SEASON CHAMPION + MVP REWARD CAPS (Phase 15.7)

### Goal

Phase 15.7 wire reward distribution cuối Sect Season (top sect + top cá nhân) qua mail (KHÔNG direct currency grant — preserve audit trail). Catalog reward đặt ở `packages/shared/src/sect-season-rewards.ts`.

### Catalog values

```ts
// SECT_SEASON_CHAMPION_REWARD — gửi cho mọi member sect rank-1 (cap 100/season).
export const SECT_SEASON_CHAMPION_REWARD: SectSeasonRewardDef = {
  linhThach: 5_000,
  exp: 2_000,
  itemRewards: [{ itemKey: 'linh_lo_dan', qty: 2 }],
  subjectVi: 'Vinh Quang Tông Môn — Phần Thưởng Mùa',
  bodyVi: 'Tông môn của bạn đứng đầu mùa giải vừa qua! Mỗi đệ tử nhận được phần thưởng vinh danh.',
};

// SECT_SEASON_MVP_REWARD — gửi cho top-1 contributor cá nhân (1 mail/season).
export const SECT_SEASON_MVP_REWARD: SectSeasonRewardDef = {
  linhThach: 15_000,
  exp: 6_000,
  itemRewards: [{ itemKey: 'co_thien_dan', qty: 1 }],
  subjectVi: 'Cá Nhân Xuất Sắc Nhất Mùa — Phần Thưởng MVP',
  bodyVi: 'Bạn là người đóng góp xuất sắc nhất mùa giải vừa qua! Phần thưởng vinh danh dành riêng cho bạn.',
};

// Caps (validate qua `validateSectSeasonRewardDef()`):
export const SECT_SEASON_CHAMPION_LINH_THACH_CAP = 5000;
export const SECT_SEASON_CHAMPION_EXP_CAP = 2500;
export const SECT_SEASON_MVP_LINH_THACH_CAP = 15000;
export const SECT_SEASON_MVP_EXP_CAP = 7500;

// Cap số member nhận champion reward / sect / season — deterministic theo
// characterId ASC (sect lớn hơn 100 → 100 đầu nhận, còn lại bị skip).
export const SECT_SEASON_CHAMPION_MEMBER_CAP = 100;
```

### Why these caps

- **Champion 5,000 LT × 100 cap = max 500,000 LT/season/sect**. Mùa Sect Season = 4 tuần → trung bình 1,250 LT/tuần/member — dưới Sect War tier-1 weekly reward (~5k LT/tuần). Không phá income chính.
- **MVP 15,000 LT × 1 character = 15,000 LT/season**. Per-season cap 15,000 LT ≈ 3,750 LT/tuần — vẫn dưới full weekly SectWar grand prize. Không issue tienNgoc.
- **Daily reward cap KHÔNG áp dụng** cho mail-based reward (`MAIL_REWARD_CLAIM` reason không trong `DAILY_REWARD_CAP_BY_REALM_AND_SOURCE`). Tradeoff: season reward tích lũy 1 lần/season — không lặp daily, không cần cap daily.
- **EXP**: Champion 2,000 = ~early-game tier increment; MVP 6,000 ≈ mid-game tier increment. Thấp để không skew progression.
- **Items**: Champion `linh_lo_dan` x2 (mid-tier consumable, neutral economy); MVP `co_thien_dan` x1 (high-tier consumable, marker of MVP status). KHÔNG drop equip cao cấp, KHÔNG title runtime.

### Idempotency invariant

- Bảng `SectSeasonRewardGrant` UNIQUE `(seasonKey, rewardType, characterId)` — 1 character + 1 type + 1 season = 1 row tối đa.
- Cron retry hoặc multi-instance đua → chỉ 1 mail/character/season (P2002 swallow).
- Test: `apps/api/src/modules/sect-season/sect-season-reward.service.test.ts` — 11 case (idempotent 2x, race Promise.all 3, dryRun, error path, membership rule, cap).

### Membership snapshot rule (updated Phase 15.8)

- **Champion (Phase 15.8 audit-perfect)**: theo **membership snapshot tại thời điểm `snapshotSeason()` finalize** lưu trong bảng `SectSeasonChampionSnapshot` (UNIQUE `(seasonKey, sectId, rank)`, cap 100 theo `characterId` ASC). Member rời sect SAU snapshot, TRƯỚC grant → **VẪN** nhận champion reward (audit-perfect). Member join sect SAU snapshot → KHÔNG nhận champion.
- **Champion (legacy pre-15.8 fallback)**: nếu snapshot row không tồn tại (season trước 15.8 hoặc test fixture skip snapshot), service fallback **current membership tại grant time** + log warning. `SectSeasonRewardGrantSummary.championUsedSnapshot` flag phân biệt 2 path.
- **MVP**: theo `mvpCharacterId` ghi vào `SectSeasonSnapshot` (snapshot tại thời điểm finalize). Không phụ thuộc current sect membership. Không đổi ở Phase 15.8.

### Reward editor caps (Phase 15.8)

Phase 15.8 thêm FE form picker cho LiveOps reward editor. Cap validate client-side (server validator vẫn là source of truth):

- `REWARD_CAPS.linhThachMax` — cap số `linhThach` 1 reward.
- `REWARD_CAPS.tienNgocMax` — cap số `tienNgoc` 1 reward.
- `REWARD_CAPS.itemCountMax` — cap số dòng item rewards (tránh reward bloat UI).
- `REWARD_CAPS.itemQtyMax` — cap qty per item row.

Caps đặt trong `packages/shared/src/reward-form.ts`. Toggle Advanced Raw JSON cho power user bypass form picker (server vẫn validate).

### Known limitations — Phase 15.7 + 15.8

- **MVP top-1 only**: không cấp MVP cho top-2/top-3. Tradeoff: tránh inflation (top-3 sect lớn cộng lại có thể vượt 50,000 LT/season → reward cap ngầm hiện ~30,000 LT).
- **Champion cap 100**: theo characterId ASC. Sect đông member > 100 → 100 đầu (theo characterId thấp nhất → tendency older account) nhận; còn lại không có UI feedback. Chấp nhận tradeoff để tránh runaway reward cost. Phase 15.8 cap chỉ apply ở SNAPSHOT TIME (`snapshotSeason()`), không tái-evaluate ở grant time.
- **Reward picker form coverage**: Phase 15.8 cover linhThach / tienNgoc / item rewards. Buff/title/cosmetic reward type vẫn dùng Raw JSON path.

## 11.27 GAMEPLAY ANTI-CHEAT DETECTION THRESHOLDS (Phase 16.3)

Detection-only thresholds for `GameplayAntiCheatService` (`apps/api/src/modules/admin-anticheat/gameplay-anticheat.service.ts`). Source-of-truth catalog: `packages/shared/src/gameplay-anticheat.ts` (`GAMEPLAY_ANOMALY_RULES`).

**Tách bạch với Phase 16.6 Economy Anti-cheat** (`packages/shared/src/economy-anomaly.ts`):
- Phase 16.6 = **dòng tiền tổng thể** (Σ |delta| LinhThạch 24h, RewardCap bypass count, market price band, admin grant). Bảng `EconomyAnomaly`.
- Phase 16.3 = **hành vi farm bất thường per-module** (dungeon / boss / mission / arena / territory) + EXP/item/currency gain spike + combat result mismatch + reward-cap bypass count. Bảng `GameplayAnomaly` riêng.

### Threshold catalog (Phase 16.3)

| Type | Source | Window | WARN | CRITICAL | Rationale |
|---|---|---|---|---|---|
| `EXP_GAIN_SPIKE` | CHARACTER (heuristic `RewardCapEvent.grantedExp`) | 1h | 50_000 | 500_000 | Cultivation auto-tu chỉ vài chục → vài trăm EXP/phút theo realm + method. Spike 50k+/h = farm dungeon liên tục bất thường. CRITICAL 500k/h gần như không thể legit. |
| `CURRENCY_GAIN_SPIKE` | CURRENCY_LEDGER (Σ delta dương `linhThach`) | 1h | 200_000 | 1_000_000 | Player F2P farm dày vẫn rơi 30-80k/h. 200k/h = nghi vấn cao. CRITICAL 1M/h. |
| `ITEM_GAIN_SPIKE` | ITEM_LEDGER (Σ qtyDelta dương) | 1h | 100 | 500 | Boss/dungeon thường drop 1-3 item/encounter. 100+ trong 1h = farm bất thường. CRITICAL 500. |
| `DUNGEON_REWARD_FARM` | DUNGEON_RUN (`status='CLAIMED'`) | 24h | 20 | 50 | Player cày dày cũng chỉ 5-10/ngày (stamina + dailyLimit gate). 20+ = nghi vấn. CRITICAL 50. |
| `BOSS_REWARD_FARM` | CURRENCY_LEDGER (`reason='BOSS_REWARD'`) | 24h | 15 | 40 | Boss spawn rate hạn chế (multi-region 1 boss/region/window). 15+ = abuse spawn / multi-account. CRITICAL 40. |
| `MISSION_REWARD_FARM` | MISSION (`MissionProgress.claimed=true`) | 24h | 30 | 80 | Daily 8-10 + weekly 4-5 + ONCE chain ~ 20/ngày max. 30+ = exploit reset. CRITICAL 80. |
| `ARENA_REWARD_FARM` | ARENA (`ArenaMatch.winnerCharacterId`) | 24h | 30 | 80 | Daily challenge limit + season rank gate thường 5-10 win/ngày. 30+ = wintrade. CRITICAL 80. Phase 14.1.D có anti-wintrade pair-level riêng; Phase 16.3 bổ sung count-level. |
| `TERRITORY_REWARD_SPIKE` | TERRITORY (`TerritoryOwnerRewardGrant`) | 7d | 10 | 30 | Region weekly cycle thường 1-2/region. 10+ trong 7d = multi-region abuse. CRITICAL 30. |
| `COMBAT_RESULT_MISMATCH` | COMBAT | 1h | 1 | 5 | Không có baseline legitimate cho mismatch — >0 đã flag. Reserved hook Phase 16.3, scanner để admin tạo tay nếu cần. CRITICAL 5. |
| `REWARD_CAP_BYPASS_ATTEMPT` | REWARD_CAP (`RewardCapEvent`) | 1h | 5 | 20 | Player cày dày chạm cap 1-2 lần/ngày — 5+/h là farm bot. Bổ sung cảnh báo real-time cho Phase 16.6 daily detection. CRITICAL 20. |

### Tuning principles

- **Conservative initial** — false-positive chấp nhận được (admin xem lại tay); false-negative tệ hơn (player abuse lọt). Re-tune sau closed beta data.
- **Per-realm override** — KHÔNG có ở Phase 16.3 (tinh chỉnh sau closed beta nếu cần).
- **Severity ladder** — `criticalThreshold >= warnThreshold` luôn (test enforce). Severity `INFO` reserved (chưa rule nào emit ở Phase 16.3 — để mở khi cần signal yếu).
- **Window cap** — Body `POST /admin/anticheat/gameplay/scan` cho phép `windowMs` ≤ 30 ngày để admin sweep batch cũ, mặc định lấy `windowMs` từ rule (1h / 24h / 7d).

### Detection-only policy (Phase 16.3)

- Scan KHÔNG mutate `Character.linhThach` / `Character.expCurrent` / `InventoryItem.qty`.
- Scan KHÔNG mutate `User.bannedAt` / KHÔNG revoke session / KHÔNG khoá tài khoản.
- KHÔNG auto-rollback transaction, KHÔNG auto-refund currency, KHÔNG auto-deduct.
- Worst-case false-positive → admin xem `AdminGameplayAntiCheatPanel` + `Resolve` với note. KHÔNG public notify.
- Test enforce policy: `gameplay-anticheat.service.test.ts` assert post-scan Character state untouched.

## 11.28 MARKET TRADE ABUSE DETECTION THRESHOLDS (Phase 16.4)

Detection-only thresholds for `MarketTradeAbuseService` (`apps/api/src/modules/admin-market-abuse/market-trade-abuse.service.ts`). Source-of-truth catalog: `packages/shared/src/market-trade-abuse.ts`.

**Tách bạch với các layer khác**:
- Phase 16.6 Market Price Band (`packages/shared/src/market-price-band.ts`) = **listing post reject** (HTTP 409 `PRICE_TOO_LOW`/`PRICE_TOO_HIGH`), trade flow refuse hẳn. Áp ở **input gate**.
- Phase 16.6 Economy Anti-cheat (`economy-anomaly.ts`) = dòng tiền 24h + market median outlier per-listing single-shot. Bảng `EconomyAnomaly`.
- Phase 16.3 Gameplay Anti-cheat (`gameplay-anticheat.ts`) = per-module gameplay behavior (dungeon/boss/mission/arena/territory). Bảng `GameplayAnomaly`.
- Phase 16.4 = **market trade pattern** (price extreme within band, pair funnel, listing spam, volume spike, unknown reference). Bảng `MarketTradeAnomaly`. **Detection-first, guard-light** — KHÔNG block giao dịch ngay cả khi WARN/CRITICAL.

### Threshold catalog (Phase 16.4)

| Type | Source | Window | WARN | CRITICAL | Rationale |
|---|---|---|---|---|---|
| `PRICE_EXTREME_LOW` | LISTING_CREATE / LISTING_BUY / SCAN_BATCH | per-listing | `unitPrice ≤ 0.2 × ref` | `unitPrice ≤ 0.05 × ref` | Listing trong band rarity (Phase 16.6 không reject) nhưng lệch xa median geomean → có thể là dump farm hoặc RMT dump cheap-list. Conservative threshold; floor `<=20%` reference đã rất bất thường vs market organic noise. |
| `PRICE_EXTREME_HIGH` | LISTING_CREATE / LISTING_BUY / SCAN_BATCH | per-listing | `unitPrice ≥ 5 × ref` | `unitPrice ≥ 20 × ref` | Cao bất thường → alt-account funnel (1 alt mua giá cao của main → dồn vốn về main). Phase 16.6 reject `pricePerUnit > maxPrice` rarity nên ratio `≥5×` chỉ xảy ra với item rarity low + reference geomean thấp; vẫn flag. |
| `REPEATED_BUYER_SELLER_PAIR` (24h) | LISTING_BUY / SCAN_BATCH | 24h | 3 trade | 10 trade | Bạn bè giúp ledge trade 1-2 lần/ngày là legit. ≥3/24h cùng cặp = friendly trade frequent hoặc alt funnel; ≥10 = pattern bất thường rõ. |
| `REPEATED_BUYER_SELLER_PAIR` (7d) | SCAN_BATCH | 7d | 10 trade | 30 trade | Window dài để bắt slow-drip funnel mà 24h window không thấy. |
| `LISTING_SPAM` | LISTING_CREATE / SCAN_BATCH | 1h | 30 listing | 80 listing | Bot farm tạo loạt listing để market-mảnh hoặc shadow-price. Player legit khó vượt 30 listing/h. CRITICAL 80 = chắc chắn automation. |
| `MARKET_VOLUME_SPIKE` | LISTING_BUY / SCAN_BATCH | 24h | Σ ≥ 500_000 LT | Σ ≥ 5_000_000 LT | Whale legit có thể 100-300k LT/ngày. ≥500k/ngày = nghi vấn cao; CRITICAL 5M là volume RMT cấp service. Σ tính cả seller-side hoặc buyer-side (max của 2 vai). |
| `UNKNOWN_REFERENCE_PRICE` | LISTING_CREATE / LISTING_BUY | per-listing | — | — (INFO) | Item không có `ItemDef` hợp lệ (catalog drift) hoặc reference geomean band không tính được. INFO flag để admin biết catalog đang lệch — KHÔNG block listing. |

### Tuning principles

- **Conservative initial** — closed beta data chưa đủ tune chính xác. Re-tune sau khi có 30-day market trade history. False-positive admin chỉ cần `Resolve` với note.
- **Per-rarity override** — KHÔNG có ở Phase 16.4 (ref price đã tính theo rarity geomean → ratio cùng phổ).
- **Reference price source** — Phase 16.4 KHÔNG đọc DB live median. `estimateItemReferencePrice(itemKey)` lấy **geometric mean** của `DEFAULT_PRICE_BAND_BY_QUALITY[quality]` (deterministic). Service runtime có thể override bằng 7-day rolling median nếu có data đủ; fallback band-geomean khi DB rỗng.
- **Severity ladder** — `CRITICAL` strictly bao hàm `WARN` (test enforce ở `market-trade-abuse.test.ts`). INFO reserved cho `UNKNOWN_REFERENCE_PRICE`.
- **Window key** — `buildMarketAbuseWindowKey(span, now)` → bucket `1h:YYYY-MM-DDTHH` / `24h:YYYY-MM-DD` / `7d:YYYY-Www` (ISO-8601 week, UTC). Idempotent multi-instance qua `@@unique([type, listingId, windowKey])`.

### Detection-only policy (Phase 16.4)

- Scan + hook KHÔNG mutate `Listing` / `MarketTrade` / `CurrencyLedger` / `ItemLedger` / `Character` / `User`.
- Hook `recordListingCreate` / `recordListingBuy` chạy **post-mutation** (sau khi listing/trade đã commit thành công ở `MarketService`). Wrap try/catch ở caller — detection throw KHÔNG rollback trade.
- KHÔNG auto-ban, KHÔNG auto-rollback, KHÔNG auto-refund, KHÔNG auto-deduct. KHÔNG block giao dịch tiếp theo của cùng character / cùng pair / cùng item.
- Worst-case false-positive → admin xem `AdminMarketAbusePanel` + `Resolve` với note. KHÔNG public notify (player không thấy).
- Test enforce policy: `market-trade-abuse.service.test.ts` assert post-scan `Listing` / `MarketTrade` / `CurrencyLedger` / `ItemLedger` rows untouched.

## 12. CHANGELOG

- **2026-04-30** — Initial creation. Author: Devin AI session 9q.
- **2026-05-07** — Phase 13.1.B Sect Missions + Sect Shop + Admin LiveOps section added (§11.14).
- **2026-05-08** — Phase 13.2.A Sect Season Foundation section added (§11.15) — 13 mùa × 4 tuần, 5 milestone bronze→diamond, read-only aggregation từ `SectWarContribution`.
- **2026-05-08** — Phase 14.0.A Sect Territory Influence Foundation section added (§11.16) — 9 region influence leaderboard, 3 source (dungeon_clear/boss_participation/boss_top_damage) với daily/weekly cap, idempotent composite UNIQUE.
- **2026-05-08** — Phase 14.0.B Sect Territory Settlement & Region Ownership section added (§11.17) — period key (ISO week + manual_*), idempotent + race-safe settleRegion, deterministic tie-break, skip empty regions, snapshot history với UNIQUE (regionKey, periodKey), region state denormalized cho O(1) owner lookup.
- **2026-05-09** — Phase 14.0.C Sect Territory Region Buff + Influence Decay section added (§11.18) — 5 buff catalog (EXP/LinhThạch/Element/Defense, value cap 10%, runtime wire dungeon reward owner-only fail-soft), influence decay default 25%/period cap 50%, idempotent UNIQUE `(periodKey)` admin trigger.
- **2026-05-09** — Phase 14.0.D Territory Weekly War Loop section added (§11.19) — period key UTC ISO week + helpers, settle-current admin endpoint với no-influence sticky owner rule + deterministic tie-break, war state/region/history read API, FE countdown + 9 region card + history + admin button. KHÔNG cron tự động (defer 14.0.E).
- **2026-05-09** — Phase 16.5 Daily Reward Cap dial — anti-abuse layer. Per-source cap (CULTIVATION / DUNGEON / MISSION) scale theo realm tier ×1/×3/×8 (tier-1 phamnhan đến tier-3 luyen_hu+). Cap exp tier-1: CULTIVATION 6000 / DUNGEON 2400 / MISSION 1500 — đủ ~4–6h casual play/ngày. Cap linhThach tier-1: DUNGEON 600 + MISSION 500 = 1100/ngày (vd. mua 1 đan low-tier 200–500 linh, 2–3 đan/ngày). Cao realm cap cao tỉ lệ. Catalog ở `packages/shared/src/daily-reward-cap.ts` (`DAILY_REWARD_CAP_BY_REALM_AND_SOURCE`). KHÔNG wire territory/daily login/season/topup (defer Phase 16.9 nếu telemetry cần). KHÔNG cap admin grant (admin path không gọi service).
- **2026-05-11** — Phase 16.4 Market Trade Abuse Hardening thresholds section added (§11.28) — 6 anomaly type với WARN/CRITICAL threshold rõ ràng: `PRICE_EXTREME_LOW` ratio ≤0.2 / ≤0.05 vs band-geomean reference, `PRICE_EXTREME_HIGH` ratio ≥5 / ≥20, `REPEATED_BUYER_SELLER_PAIR` 24h 3/10 + 7d 10/30 trade, `LISTING_SPAM` 1h 30/80 listing, `MARKET_VOLUME_SPIKE` 24h Σ ≥500k / 5M LT, `UNKNOWN_REFERENCE_PRICE` INFO (catalog drift signal). Catalog `packages/shared/src/market-trade-abuse.ts` + `MarketTradeAbuseService` scan/hook dispatcher + bảng `MarketTradeAnomaly` riêng (tách khỏi `EconomyAnomaly` Phase 16.6 + `GameplayAnomaly` Phase 16.3). **Detection-first, guard-light** (test enforced): scan + hook post-mutation KHÔNG block trade ngay cả khi CRITICAL; KHÔNG mutate Listing/MarketTrade/CurrencyLedger/ItemLedger; KHÔNG auto-ban / KHÔNG auto-rollback / KHÔNG auto-refund. Admin xem qua `AdminMarketAbusePanel` + ack/resolve thủ công. Conservative initial — re-tune sau closed beta market trade data.
- **2026-05-11** — Phase 16.3 Gameplay Anti-cheat Deep Detection thresholds section added (§11.27) — 10 anomaly type với WARN/CRITICAL threshold rõ ràng: `EXP_GAIN_SPIKE` 50k/500k EXP 1h, `CURRENCY_GAIN_SPIKE` 200k/1M LT 1h, `ITEM_GAIN_SPIKE` 100/500 qty 1h, `DUNGEON_REWARD_FARM` 20/50 claim 24h, `BOSS_REWARD_FARM` 15/40 24h, `MISSION_REWARD_FARM` 30/80 24h, `ARENA_REWARD_FARM` 30/80 WIN 24h, `TERRITORY_REWARD_SPIKE` 10/30 7d, `COMBAT_RESULT_MISMATCH` 1/5 (reserved hook), `REWARD_CAP_BYPASS_ATTEMPT` 5/20 1h. Catalog `packages/shared/src/gameplay-anticheat.ts` `GAMEPLAY_ANOMALY_RULES` + `GameplayAntiCheatService` scan dispatcher + bảng `GameplayAnomaly` riêng (tách khỏi `EconomyAnomaly` Phase 16.6 để admin filter theo domain). **Detection-only policy** (test enforced): scan KHÔNG mutate Character/Inventory/User; KHÔNG auto-ban / KHÔNG rollback / KHÔNG khoá tài khoản. Admin xem qua `AdminGameplayAntiCheatPanel` + ack/resolve thủ công. Conservative initial — re-tune sau closed beta data.
- **2026-05-10** — Phase 16.6 Economy Anti-cheat Suite dial — detection layer chuẩn bị closed beta. **Anomaly threshold catalog** (`packages/shared/src/economy-anomaly.ts` `ECONOMY_ANOMALY_RULES`): 5 source × WARN/CRITICAL: `CURRENCY_DELTA_24H` 100k/1M LT, `RARE_ITEM_GAIN_24H` (HUYEN+ count) 5/20 / 24h, `REWARD_CAP_BYPASS` 1/3 cap event / day, `ADMIN_GRANT_OVER_LIMIT` 50k/500k LT / single grant, `MARKET_OUTLIER` (deviation từ 7-day median) 5×/10×. Conservative initial — re-tune sau closed beta data. **Market Price Band catalog** (`packages/shared/src/market-price-band.ts` `MARKET_PRICE_BAND_BY_ITEM` + `DEFAULT_PRICE_BAND_BY_QUALITY`): rarity band PHAM 10–1000, LINH 50–5000, HUYEN 200–50_000, TIEN 1000–500_000, THAN 5000–5_000_000 LT/unit. Per-item override empty (Phase 16.6 chưa fill — sẽ thêm sau khi observe data). Listing ngoài band reject `PRICE_TOO_LOW`/`PRICE_TOO_HIGH` (HTTP 409). Existing ACTIVE listing KHÔNG bị mutate (chỉ áp dụng listing mới). **Detection-only policy**: KHÔNG auto-ban / KHÔNG auto-rollback / KHÔNG public notify; admin xem qua `AdminEconomySafetyPanel` panel + quyết định manual.
- **2026-05-10** — Phase 14.1.B Async Arena Foundation section added (§11.21) — async PvP loop với deterministic match resolution. Rating default 1000, win +10/lose -5 attacker, defender ½ magnitude, clamp [0, 5000]. Daily limit 10/day Asia/Ho_Chi_Minh (env `ARENA_DAILY_LIMIT_PER_DAY`, 0=unlimited). Match resolve sync trong POST request (NOT queue): build snapshot → `resolveCombatWithSnapshot` (Phase 14.1.A) → tx update profile + match. Snapshot lock-in: `attackerSnapshotJson` + `defenderSnapshotJson` + `seed` immutable sau RESOLVED → replay bit-exact. Anti-cheat Phase 14.1.B: chỉ no-self + daily limit. KHÔNG: ELO, season cycle, end-season reward, anti-wintrade phức tạp, defense AI snapshot. 5 tier slot reserved cho Phase 14.1.C.
- **2026-05-10** — Phase 14.1.D Arena Anti-Wintrade Detection dial — detection-only anti-cheat layer cho Arena. **Anti-wintrade rules catalog** (`packages/shared/src/arena-anti-wintrade.ts` `ARENA_ANTI_WINTRADE_RULES`): 5 detection type × WARN/CRITICAL threshold conservative để tránh false-positive với player legit cày Arena chăm. `REPEATED_OPPONENT_PAIR` cùng directional pair attacker→defender ≥ 5 / 12 trận / 24h. `RECIPROCAL_WIN_LOSS` 2 chars trade win-loss ≥ 4 / 8 / 24h (sort lex pair key). `RATING_GAIN_SPIKE` Δrating ≥ 200 / 400 / 6h. `REWARD_FARM_PATTERN` attacker ≥ 8 trận với distinct opponents < 3 (CRITICAL khi opponents ≤ 1) / 24h. `SEASON_SUSPICIOUS_ACTOR` ≥ 12 trận, win-rate ≥ 0.95, opponents < 5 / 24h (TODO upgrade season-wide scope). Severity ladder INFO < WARN < CRITICAL. **Detection-only policy**: KHÔNG auto-ban / KHÔNG auto-rollback reward / KHÔNG xóa match / KHÔNG block player on WARN; admin review thủ công qua `AdminArenaAntiWintradePanel`. Idempotent qua composite UNIQUE `(type, windowKey, attackerCharacterId, defenderCharacterId)` — chạy lại scan trên cùng cửa sổ không tạo duplicate. Env override `ARENA_ANTI_WINTRADE_*` cho ops fine-tune sau closed beta data.
