# Xuân Tôi — Content Pipeline

> **Status**: Long-term content pipeline. Source of truth cho **process** thêm content (item, skill, monster, dungeon, mission, boss, quest, event, title, achievement).
> Code on `main` + `packages/shared/src/*.ts` là source of truth cho **catalog hiện tại**.
> Sister docs: [`GAME_DESIGN_BIBLE.md`](./GAME_DESIGN_BIBLE.md), [`BALANCE_MODEL.md`](./BALANCE_MODEL.md), [`SEEDING.md`](./SEEDING.md).

Mục tiêu: thêm content **không phá CI**, **không lệch curve**, **không miss i18n**, **không quên ledger path**.

---

## 1. CONTENT INVENTORY (hiện trạng)

| Loại | File | Số lượng hiện tại | Phase mở rộng |
|---|---|---|---|
| Realm | `packages/shared/src/realms.ts` | 28 đại cảnh giới | Static, ít thay đổi |
| Proverb | `packages/shared/src/proverbs.ts` | 7 câu | Có thể thêm dần |
| Item | `packages/shared/src/items.ts` | 81 item (Phase 10 PR-1 +50) | Phase 10: → 80-100 ✅ |
| Skill | `packages/shared/src/combat.ts` `SKILLS` | 36 skill (Phase 10 PR-2 +15 Ngũ Hành + PR-2 v2 +10 kim_dan ULT/role-gap passive) | Phase 10-11: → 25-40 ✅ |
| Monster | `packages/shared/src/combat.ts` `MONSTERS` | 29 monster (Phase 10 PR-3 +20 Ngũ Hành × MonsterType BEAST/HUMANOID/SPIRIT/ELITE/BOSS) | Phase 10: → 30 ✅ |
| Dungeon | `packages/shared/src/combat.ts` `DUNGEONS` + `DUNGEON_LOOT` | 9 dungeon (Phase 10 PR-3 +6 element-thematic) | Phase 10: → 8-10 ✅ |
| Mission | `packages/shared/src/missions.ts` | 66 mission (PR #217 Phase 10 PR-4 +54: tier daily/weekly + element chronicle + tu-tien-progression chain) | Phase 10: → 65+ ✅ |
| Boss | `packages/shared/src/boss.ts` | 12 boss (Phase 10 PR-5 +10 named × Ngũ Hành × realm tier kim_dan → hop_the) | Phase 10: → 10 named ✅ |
| Buff/Debuff | `packages/shared/src/buffs.ts` | 18 buff/debuff (Phase 11.8.A — merged #229: 10 buff + 8 debuff × 5 element + 8 source pill/skill/sect_aura/event/talent/boss/tribulation) | Phase 11: → 18+ ✅ catalog-only |
| Title (Danh hiệu) | `packages/shared/src/titles.ts` | 24 title (Phase 11.9.A — merged #230: 9 realm + 5 element + 4 achievement + 3 sect + 2 event + 1 donation × 5 rarity common/rare/epic/legendary/mythic) | Phase 11: → 24+ ✅ catalog-only |
| Achievement (Thành tựu) | `packages/shared/src/achievements.ts` | 32 achievement (Phase 11.10.A — this PR open: 8 combat + 6 cultivation + 5 exploration + 4 social + 4 economy + 3 milestone + 2 collection × 5 tier bronze/silver/gold/platinum/diamond, reuse MissionGoalKind enum, link với titles.ts qua rewardTitleKey) | Phase 11: → 30+ ✅ catalog-only |
| Topup pack | `packages/shared/src/topup.ts` | (đã có) | Tunable theo monetization |
| Shop pack | `packages/shared/src/shop.ts` | (đã có) | Tunable |
| **Quest chain** | (chưa có) | 0 | Phase 11 — DB-backed |
| **Story chapter** | (chưa có) | 0 | Phase 11 — DB-backed |
| **Map region** | `packages/shared/src/map-regions.ts` | 9 region (Phase 12.1 catalog foundation: son_coc, hac_lam, moc_huyen_lam, yeu_thu_dong, kim_son_mach, thuy_long_uyen, hoa_diem_son, hoang_tho_huyet, cuu_la_dien) | Phase 12.1: ✅ static catalog (formalize regionKey đã dùng trong MONSTERS/DUNGEONS/BOSSES/MISSIONS); DB migration defer (admin tune-live không cần ngay — region geography lore-stable) |
| **DungeonTemplate** | (chưa có, dùng static `DungeonDef`) | — | Phase 12 — migrate sang DB |
| **Title (legacy row)** | (replaced by `packages/shared/src/titles.ts` Phase 11.9.A) | (see Title row above) | (resolved) |
| **Achievement (legacy row)** | (replaced by `packages/shared/src/achievements.ts` Phase 11.10.A) | (see Achievement row above) | (resolved) |
| **EventConfig** | (chưa có) | 0 | Phase 15 — DB-backed |

---

## 2. STATIC vs DB CATALOG

### 2.1 Khi nào static (TS file)

- Content thay đổi **thấp tần** (1-2 tuần / lần) hoặc **không thay đổi sau release**.
- Cần FE + BE share cùng key + type-safe (TypeScript).
- Không cần admin tune live.

Example: **realm**, **item**, **skill**, **monster**, **dungeon**, **mission**, **proverb**, **title** (cosmetic), **achievement**, **map region** (Phase 12.1 — region geography lore-stable, không cần admin tune live).

### 2.2 Khi nào DB

- Content cần **admin tune live** (e.g. event reward, drop weight).
- Content có **runtime state** per character (e.g. quest progress, achievement progress).
- Content có **lifecycle** (start/end, status).

Example: **EventConfig**, **DungeonTemplate** (instances qua `DungeonRun`), **Quest**+`QuestProgress`, **StoryChapter**+`NpcDialogue`, **MarketPriceBand`. (Phase 12.1: **MapRegion** đã làm static — DB migration defer trừ khi cần admin tune-live unlock threshold / sortOrder.)

### 2.3 Hybrid

Một số catalog có thể **static define** + **DB override per environment**:

- `MARKET_PRICE_BAND` static default; admin có thể override per item qua DB row.
- `ECONOMY_DIALS` (xem `ECONOMY_MODEL.md` §6.3) — static default, env override, admin UI override (phase 15).

---

## 3. CONTENT FIELD CONTRACT

Mỗi content type có 1 contract chung:

### 3.1 Required fields

| Field | Type | Mô tả |
|---|---|---|
| `key` | `string` (snake_case) | Unique trong loại đó. **Immutable sau release** đầu tiên. |
| `nameVi` | `string` | Tên VI hiển thị. (Hiện một số catalog dùng `name` cho VI default — chuẩn hoá phase 10.) |
| `nameEn` | `string` | Tên EN hiển thị. (Hiện một số chưa có — bổ sung phase 10.) |
| `description` | `string` | VI flavor + mechanics summary. |
| `descriptionEn` | `string` | EN. |
| `tier` / `quality` | enum | PHAM/LINH/HUYEN/TIEN/THAN nếu áp dụng. |

### 3.2 Optional fields tuỳ loại

| Loại | Fields đặc trưng |
|---|---|
| Item | `kind`, `slot?`, `bonuses?`, `effect?`, `stackable`, `priceLinhThach?` |
| Skill | `sect?`, `atkScale`, `mpCost`, `cooldownTurns?`, `selfHealRatio?`, `selfBloodCost?`, `element?` (kim/moc/thuy/hoa/tho/null), `type?` (ACTIVE/PASSIVE), `role?` (DAMAGE/HEAL/BUFF/DEBUFF/CONTROL/UTILITY), `unlockRealm?` (REALMS key) |
| Monster | `level`, `hp`, `atk`, `def`, `speed`, `expDrop`, `linhThachDrop` |
| Dungeon | `recommendedRealm`, `monsters[]`, `staminaEntry` |
| Mission | `period`, `goalKind`, `goalAmount`, `rewards`, `requiredRealmOrder?`, `element?` (Ngũ Hành), `regionKey?`, `storyChainKey?` (Phase 11+ chain quest UI), `realmTier?` (REALMS key) |
| Boss | `level`, `maxHp`, `atk`, `def`, `rewardLinhThach`, `rewardItems[]`, `spawnIntervalMin?` |
| Quest (phase 11+) | `chainKey`, `stepIndex`, `requiredQuestKey?`, `chapterKey?`, `previousQuestKey?`, `nextQuestKey?`, `rewards`, `dialogueKey?`, source label (`CANON_FROM_STORY_BIBLE` / `AI_EXPANDED_LORE` in docs if the catalog has no field) |
| Story chapter (Phase 21+) | `chapterKey`, `order`, `mainQuestKeys`, `unlockGate` (`requiredRealmKey`, `requiredMainQuestKey`, optional battle power / dungeon / boss / sect / elemental gates), reward caps |
| Event (phase 15) | `kind`, `configJson`, `startsAt`, `endsAt`, `rewardTiers[]` |

### 3.3 Audit fields (không bao giờ để FE input)

- `createdAt: DateTime` — auto.
- `createdByAdminId: String?` — set bởi server từ JWT.
- `updatedAt: DateTime` — auto.

---

## 4. PROCESS THÊM CONTENT MỚI

### 4.1 Item

**Step-by-step**:

1. Mở `packages/shared/src/items.ts`.
2. Append entry vào `ITEMS` array. `key` snake_case unique.
3. Set `kind`, `quality`, `stackable`, `slot` (nếu equip), `bonuses` (nếu equip), `effect` (nếu pill), `priceLinhThach` (gợi ý vendor sell).
4. Thêm tên EN ở i18n catalog (phase 10 sẽ tách `nameVi`/`nameEn` thành field).
5. Nếu là drop từ dungeon → thêm vào `DUNGEON_LOOT[<dungeon-key>]` với `weight`, `qtyMin`, `qtyMax`.
6. Add balance note (comment) — tại sao chọn power level này.
7. Run:
   ```bash
   pnpm --filter @xuantoi/shared build
   pnpm --filter @xuantoi/shared test
   ```
8. PR title: `feat(shared): item pack <name> (+N item)`.

**Quality gate**:

- `catalog.test.ts` pass: key uniqueness, slot coverage.
- Power không vượt curve (xem `BALANCE_MODEL.md` §3 power-by-realm).

### 4.0 Phase 21 story/quest mega-content gate

Before adding large quest batches:

1. Confirm chapter gates exist before expanding quest counts. A chapter must not unlock only from a previous quest; it needs story + strength gates.
2. Use the reward ratio bands in `BALANCE_MODEL.md` §5.8.
3. Label lore origin in docs/handoff:
   - `CANON_FROM_STORY_BIBLE` for core canon beats and NPC roles.
   - `AI_EXPANDED_LORE` for minor branch/hidden/side expansions that do not alter canon.
4. Add integrity tests for:
   - duplicate keys,
   - chapter order,
   - quest links,
   - chapter gate presence,
   - side/branch/hidden reward caps,
   - hidden triggers,
   - branch hooks,
   - daily/weekly cadence caps,
   - i18n parity where catalog fields have vi/en.
- i18n: VI + EN.

### 4.2 Skill

1. Mở `packages/shared/src/combat.ts`.
2. Append vào `SKILLS` với `sect: 'thanh_van' | 'huyen_thuy' | 'tu_la' | null`.
3. Set `atkScale`, `mpCost`, `cooldownTurns` (BALANCE_MODEL §4.3 band), `selfHealRatio`, `selfBloodCost`.
4. **Phase 10 PR-2 forward-compat fields** (optional nhưng khuyến khích đặt cho mọi skill mới): `element` (`'kim' | 'moc' | 'thuy' | 'hoa' | 'tho' | null`) — Ngũ Hành affinity; `type` (`'ACTIVE' | 'PASSIVE'`) — default ACTIVE, PASSIVE không xuất hiện ở picker FE (xem `activeSkillsForSect`); `role` (`'DAMAGE' | 'HEAL' | 'BUFF' | 'DEBUFF' | 'CONTROL' | 'UTILITY'`) — UI/AI moveset compose; `unlockRealm` (REALMS key e.g. `'luyenkhi'`/`'truc_co'`/`'kim_dan'`) — phase 11.2 sẽ enforce.
5. Mỗi hệ Ngũ Hành nên có ≥ 2 ACTIVE + ≥ 2 PASSIVE (test `skills-balance.test.ts` enforce sau Phase 10 PR-2 v2 expansion). Coverage đảm bảo mỗi hệ ≥1 ULT tier `kim_dan` (endgame layer).
6. Tên EN.
7. Test pass: `pnpm --filter @xuantoi/shared test` — verify `combat.test.ts` (legacy invariant) + `skills-balance.test.ts` (Ngũ Hành coverage + stat budget) cả hai green.
8. PR title: `feat(shared): skill pack <name> (+N skill)`.

**Quality gate**:
- `skills-balance.test.ts` pass: unique key, atkScale ≤ 5, mpCost ≤ 80, selfHeal ≤ 0.5, selfBlood ≤ 0.3, cooldown ≤ 6, element/type/role/unlockRealm hợp lệ.
- Mỗi Ngũ Hành có ≥ 2 ACTIVE + ≥ 2 PASSIVE + ≥ 1 ULT tier `kim_dan` (Phase 10 PR-2 v2 enforce, depth tối thiểu ≥4 skill/element).
- PASSIVE skill: atkScale = 0, mpCost = 0, cooldown = 0 (catalog only — runtime áp dụng phase 11.8 buff system).
- Tương thích với `skill-templates.ts` — mỗi `SkillDef` phải có `SkillTemplate` tương ứng (`SKILL_TEMPLATES` cardinality phase 11.2.B); `inferExpectedTier()` (atkScale ≥ 3.5 → legendary) — ULT kim_dan dùng atkScale 3.4 cận cap để phân loại `advanced` thay vì `legendary`.

### 4.3 Monster + Dungeon

1. Append `MONSTERS` (nếu cần monster mới):
   - **Required**: `key` (snake_case stable), `name` (VN tu tiên), `level` ∈ [1,40], `hp/atk/def/speed` ≥ 1, `expDrop/linhThachDrop` ≥ 0.
   - **Forward-compat (Phase 10 PR-3+, optional, recommended)**: `element: 'kim'|'moc'|'thuy'|'hoa'|'tho'|null` (Ngũ Hành, null = vô hệ early-game), `monsterType: 'BEAST'|'HUMANOID'|'SPIRIT'|'ELITE'|'BOSS'` (compose AI moveset phase 11.3), `regionKey: string | null` (group monsters theo region để map UI phase 11+).
   - **Stat budget** (`BALANCE_MODEL.md` §5.1): `hp ≤ 200×level`, `atk ≤ 25×level`, `def ≤ 8×level`, `speed ∈ [3, 25]`. Bound bằng `monsters-balance.test.ts`.
2. Append `DUNGEONS` (nếu cần dungeon mới):
   - **Required**: `key`, `name`, `description` (≥ 20 ký tự), `recommendedRealm` (REALMS key), `monsters: string[]` (≥ 1; ≥ 3 nếu multi-encounter), `staminaEntry`.
   - **Forward-compat (Phase 10 PR-3+, optional, recommended)**: `element: ElementKey | null` (Ngũ Hành theme), `regionKey: string | null` (link với monster region), `dailyLimit: number` ∈ [1,10] (phase 11.5 sẽ enforce qua `DungeonRun` service).
   - **Stamina budget** (`BALANCE_MODEL.md` §5.1): luyenkhi ≤ 15, truc_co ≤ 30, kim_dan ≤ 40, nguyen_anh ≤ 65. Bound bằng `dungeons-balance.test.ts`.
3. Append `DUNGEON_LOOT[<key>]` với weight + qty range. Mọi `itemKey` phải resolve qua `itemByKey`. Mỗi loot table cần ≥ 3 entries (variety guarantee). Phải có entry cho mọi dungeon (no orphan parity).
4. **Phase 12.4 — Per-monster `MonsterDef.lootTable` override** (optional, recommended cho BOSS/ELITE):
   - Define `lootTable: readonly LootEntry[]` trực tiếp trên `MonsterDef` để override `DUNGEON_LOOT[dungeon.key]`. `DungeonRunService.nextEncounter` + `CombatService` WON path sẽ ưu tiên `monster.lootTable` (nếu defined + non-empty) trước fallback `rollDungeonLoot(dungeon.key, n)`.
   - Convention: chỉ `monsterType ∈ {ELITE, BOSS}` (test `items-monster-loot.test.ts` enforce). BEAST/SPIRIT/HUMANOID dùng dungeon-level fallback.
   - Mỗi entry: `weight > 0`, `qtyMin ≥ 1`, `qtyMin ≤ qtyMax`, `itemKey` resolve qua `itemByKey` (no orphan).
   - Single entry KHÔNG vượt 80% probability (anti-domination). Bias toward themed equipment (weight 5-8) + skill_book pity weight 5-6 (cao hơn dungeon-level 2-3).
   - Pattern: `lootTable: [{ itemKey: 'than_phong_kiem', weight: 8, qtyMin: 1, qtyMax: 1 }, ...]`.
5. Test pass: `monsters-balance.test.ts` (catalog integrity, element coverage ≥ 1 BOSS/ELITE / element, region coverage ≥ 2 monster / region) + `dungeons-balance.test.ts` (recommendedRealm valid, monster ref valid, stamina budget, element coverage ≥ 1 dungeon / element, DUNGEON_LOOT parity) + `items-monster-loot.test.ts` (Phase 12.4 override integrity + roll behavior).
6. **Combat runtime KHÔNG đọc `element`/`monsterType`/`regionKey`/`dailyLimit`** ở phase 10 (catalog only). Phase 11.3 sẽ wire `elementMultiplier(skill.element, target.element)` qua `BALANCE_MODEL.md §4.2`. Phase 11.5 sẽ wire `dailyLimit` enforce.
7. **Helpers** (Phase 10 PR-3+): `monstersByElement(elem)` / `dungeonsByElement(elem)` / `monstersByRegion(regionKey)` / `dungeonsByRegion(regionKey)` cho phase 11+ AI/UI compose. Phase 12.4: `rollMonsterLoot(monsterKey, count)` (returns `[]` nếu monster không tồn tại / không có lootTable).
8. PR title: `feat(shared): monster & dungeon pack N (+M monster, +K dungeon, ngũ hành)`.

### 4.4 Mission

1. Mở `packages/shared/src/missions.ts`.
2. Append `MISSIONS` array. `key` snake_case unique.
3. Reward `items[]` phải tham chiếu `itemKey` đã tồn tại trong ITEMS catalog (verify bằng `itemByKey()`).
4. `goalKind` phải nằm trong `MissionGoalKind` enum (xem code: `LOGIN_DAILY` / `CULTIVATE_SECONDS` / `KILL_MONSTER` / `CLEAR_DUNGEON` / `BREAKTHROUGH` / `MARKET_BUY` / `MARKET_SELL` / `SECT_DONATE` / `BOSS_HIT` / `CHAT_SEND` / `GAIN_EXP` / etc).
5. **Phase 10 PR-4 forward-compat fields** (optional nhưng khuyến khích đặt cho mọi mission mới có theme):
   - `element` (`'kim' | 'moc' | 'thuy' | 'hoa' | 'tho' | null`) — Ngũ Hành affinity, phase 11+ wire element bonus reward.
   - `regionKey` (`string | null`) — tham chiếu region monster/dungeon hoặc dungeon key cụ thể (kim_son_mach/moc_huyen_lam/thuy_long_uyen/hoa_diem_son/hoang_tho_huyet/cuu_la_dien). Phase 11+ wire region gating + minimap.
   - `storyChainKey` (`string | null`) — group ONCE mission thành narrative arc cho FE Phase 11+ quest chain UI. Ví dụ: `tu_tien_progression` (4 step breakthrough), `kim_chronicle`/`moc_chronicle`/`thuy_chronicle`/`hoa_chronicle`/`tho_chronicle` (≥ 2 step element chronicle), `endgame` (cuu_la_dien). Helper `missionsByStoryChain()` trả mission sorted by `goalAmount` asc — chain progression order.
   - `realmTier` (`string | null`) — REALMS key (`luyenkhi`/`truc_co`/`kim_dan`/`nguyen_anh`/`hoa_than`) để FE bucket UI; **distinct từ `requiredRealmOrder`** runtime gate (cái sau enforce ở mission.service backend).
6. **Reward budget bound** (BALANCE_MODEL §7.1, enforce bằng `missions-balance.test.ts`):
   - Daily LT cap theo realm tier: luyenkhi 800 / truc_co 2300 / kim_dan 6000 / nguyen_anh 15000 (50% buffer trên baseline 500/1500/4000/10000).
   - Weekly LT cap: 5× daily tier.
   - Once LT cap tuyệt đối: 200000 (prevent runaway endgame mission).
   - tienNgoc cap: 100 / mission.
   - Tất cả reward number > 0 (không định nghĩa reward 0).
7. **Story chain coverage** (test enforce): `tu_tien_progression` ≥ 4 BREAKTHROUGH mission; mỗi `{element}_chronicle` ≥ 2 ONCE mission; `endgame` chain ≥ 1 mission link `cuu_la_dien` region.
8. **Lưu ý mission gameplay hook**: catalog hiện đã có gameplay hook qua `mission.service.ts` (track theo `goalKind` string); Phase 10 forward-compat fields (`element`/`regionKey`/`storyChainKey`/`realmTier`) là **metadata only** — runtime KHÔNG đọc, mission claim hoạt động bình thường theo `goalKind` matching. Mission không có `goalKind` hỗ trợ runtime hiện tại sẽ greyed UI cho đến khi hook thêm vào.
9. Test pass: `pnpm --filter @xuantoi/shared test` — verify `missions.test.ts` (legacy invariant) + `missions-balance.test.ts` (Ngũ Hành coverage + budget bound + chain structure) cả hai green.
10. PR title: `feat(shared): mission pack <theme> (+N mission)`.

**Quality gate Phase 10+**:
- `missions-balance.test.ts` pass: unique key, reward budget per tier, element/region/storyChain/realmTier validity.
- Mỗi Ngũ Hành element có ≥ 1 mission tham chiếu.
- Mọi reward.itemKey resolve qua `itemByKey()`.
- Story chain mission cùng chain có cùng (element, regionKey) family hoặc shared null (consistency).

### 4.5 Boss

**Schema hiện tại** (Phase 10 PR-5 — `packages/shared/src/boss.ts`):

```ts
import type { ElementKey, MonsterType } from './combat';

export interface BossDef {
  key: string;
  name: string;
  description: string;
  /** Mức cảnh giới khuyến nghị (REALMS key). */
  recommendedRealm: string;
  baseMaxHp: number;
  atk: number;
  def: number;
  baseRewardLinhThach: number;
  /** Top-1 chắc chắn nhận 1 item từ list này (random). */
  topDropPool: readonly string[];
  /** Top 2-3 nhận. */
  midDropPool: readonly string[];
  // Forward-compat phase 10 PR-5 (optional):
  level?: number;
  element?: ElementKey | null;            // Ngũ Hành affinity
  regionKey?: string | null;              // align với MonsterDef/DungeonDef
  monsterType?: Extract<MonsterType, 'BOSS'>;
  lowDropPool?: readonly string[];        // top 4-10 reward (phase 12 pity)
}
```

**Steps**:

1. Mở `packages/shared/src/boss.ts` (mở rộng).
2. Append vào `BOSSES` theo monotonic power scaling (test enforce: `baseMaxHp` / `atk` / `baseRewardLinhThach` non-decreasing).
3. Stat budget bound (BALANCE_MODEL.md §6.1):
   - `baseMaxHp` ∈ [100k, 5M] (phase 10 cap).
   - `atk` ∈ [hp/8000, hp/1000] (early burst → late raid).
   - `def ≤ atk` (boss thiên tấn công, không pure tank).
   - `baseRewardLinhThach` ∈ [hp/8, hp/2] (boss reward > dungeon).
4. Forward-compat field (optional nhưng **khuyến nghị set** cho boss mới):
   - `element`: 1 trong 5 Ngũ Hành (`'kim'|'moc'|'thuy'|'hoa'|'tho'`) hoặc `null` cho cross-element endgame.
   - `regionKey`: match với MonsterDef/DungeonDef.regionKey để FE map view phase 12 group được. Element của boss phải khớp element của region (test enforce).
   - `level`: monotonic non-decreasing, dùng cho AI moveset compose phase 11.3.
   - `monsterType`: luôn `'BOSS'`.
   - `lowDropPool`: ≥ 1 entry cho boss mới (forward-compat phase 12 pity).
5. Drop pool requirement:
   - `topDropPool` có ≥ 1 entry quality `HUYEN/TIEN/THAN` (signature reward).
   - Mọi item ref phải tồn tại trong `ITEMS`.
   - 3 pool không trùng lặp internal.
6. Helper sẵn có: `bossesByElement(el)` / `bossesByRegion(key)` / `bossesByRealm(key)`.
7. Test pass: `boss.test.ts` (22 test) + `boss-balance.test.ts` (28 test).
8. PR title: `feat(shared): boss pack <theme> (+N named boss, ngũ hành)`.

### 4.6 Quest chain (phase 11+)

DB-backed. Process khác:

1. Tạo Prisma migration:
   ```prisma
   model Quest { ... }
   model QuestStep { ... }
   model QuestProgress { ... }
   ```
2. Migration phải có rollback note.
3. Seed file mới: `apps/api/prisma/seed-quests.ts` (idempotent).
4. Service: `quest.service.ts` track progress.
5. Test idempotency claim.
6. PR title: `feat(api): quest chain <chain-name> (+N quest +M step)`.

### 4.7 Story chapter / NPC dialogue (phase 11+)

DB-backed.

1. Migration: `StoryChapter`, `NpcDialogue`.
2. Seed file: `apps/api/prisma/seed-story.ts`.
3. NPC dialogue có thể có branching qua `nextDialogueKey` field.
4. PR title: `feat(api): story chapter <chapter-name>`.

### 4.8 Event config (phase 15)

DB-backed.

1. Admin tạo qua UI (không seed code).
2. Schema xem `LIVE_OPS_MODEL.md` §3.
3. PR là cho **infra** (model + service + admin UI), không cho từng event content.
4. Content: admin nhập qua UI.

### 4.9 Title / Achievement (phase 11+)

Static.

1. Tạo `packages/shared/src/titles.ts` + `packages/shared/src/achievements.ts`.
2. Title: `key`, `nameVi`, `nameEn`, `descriptionVi`, `descriptionEn`, `tier`, `unlockHint` (text gợi ý).
3. Achievement: `key`, `nameVi`, `nameEn`, `tier`, `goalKind`, `goalAmount`, `rewardTitle?`, `rewardLinhThach?`.
4. Achievement progress lưu DB `AchievementProgress`.
5. PR title: `feat(shared): title pack <theme>` / `feat(shared): achievement pack <theme>`.

---

## 5. NAMING CONVENTION

### 5.1 Key format

- `snake_case` ASCII only.
- KHÔNG dấu tiếng Việt (e.g. dùng `kim_dan` không `kim_đan`).
- Prefix theo loại nếu cần disambiguate:
  - Item: `<kind>_<flavor>_<tier>` (e.g. `kiem_thanh_van_linh`).
  - Skill: `<sect>_<flavor>` (e.g. `thanh_van_kiem_quyet`).
  - Monster: `<flavor>` (e.g. `huyet_lang`).
  - Dungeon: `<location>` (e.g. `son_coc`).
  - Mission: `<period>_<flavor>` (e.g. `daily_cultivate_5min`).
  - Boss: `<flavor>` (e.g. `huyet_ma_chua`).

### 5.2 VI/EN naming

- VI: Hán Việt thuần (xem `GAME_DESIGN_BIBLE.md` §A.5). Tránh tiếng Anh giữa câu.
- EN: pinyin/phiên âm cho tên riêng (e.g. "Thanh Vân" → "Thanh Van" hoặc "Azure Cloud" — quyết định theo glossary, KHÔNG ad-hoc).
- Glossary: tạo file `packages/shared/i18n-glossary.md` (phase 10) ghi mapping VI ↔ EN cho 50+ thuật ngữ tu tiên thường dùng.

### 5.3 Description style

- 2-3 câu: 1 câu flavor + 1-2 câu mechanics.
- Ví dụ tốt:
  > "Kiếm Thanh Vân — đệ nhất kiếm pháp Thanh Vân Tông. Tăng 30% sát thương kiếm khi đối thủ HP < 50%. Tiêu hao 20 MP."
- Ví dụ xấu (quá dài, không mechanics rõ):
  > "Kiếm Thanh Vân do Tổ Sư Thanh Vân tu luyện ngàn năm tạo nên, ánh sáng xanh biếc khi xuất kiếm…"

---

## 6. BALANCE GATE

Trước khi merge content PR, verify (xem `BALANCE_MODEL.md`):

### 6.1 Item

- Power tổng (atk + def + hp + spirit×0.5) không vượt **band power** cho realm tier mục tiêu (BALANCE_MODEL §3).
- Quality vs power tương xứng (PHAM ≤ 1× base, LINH ≤ 1.5×, HUYEN ≤ 2.5×, TIEN ≤ 4×, THAN ≤ 6×).
- Pill: HP/MP/EXP gain không quá 50% max của realm tương ứng.

### 6.2 Skill

- `atkScale` ≤ 5 (skill cao nhất).
- `mpCost` đủ để skill spam mỗi 2-3 lượt (không mỗi lượt).
- `selfBloodCost` ≤ 0.30 (huyết tế cap 30%).

### 6.3 Monster

- HP/atk theo curve realm: monster cho `luyenkhi-3` không nên có HP của `kim_dan-3`.
- `expDrop` đủ để 30 lần kill = 1 stage break.
- `linhThachDrop` đủ để dungeon clear = 1 dungeon clear ≈ 100 linhThach (early), 1000+ (late).

### 6.4 Dungeon

- `staminaEntry` đề xuất 10-30 (early), 30-60 (mid), 60-100 (late).
- Clear time mục tiêu: 2-5 phút (early), 5-10 phút (mid), 10-20 phút (late).

### 6.5 Mission

- Daily: hoàn thành full set 5 mission = 30-60 phút active.
- Weekly: 1 mission ≈ 1-2h active spread over week.
- Reward proportional: daily 5-10% daily linhThach gain, weekly 30-50%.

### 6.6 Boss

- HP scale theo realm tier (xem `BALANCE_MODEL.md` §6).
- Drop reward đủ để 1 lần kill ≈ 1 ngày dungeon farm.

---

## 7. SEED IDEMPOTENCY

### 7.1 Static catalog

Static = code, không cần seed. Build TS → ESM/CJS → import.

### 7.2 DB content

Mỗi DB content (Quest, Story, EventConfig) cần:

- Seed file `apps/api/prisma/seed-<content-type>.ts`.
- Idempotent: re-run seed không tạo duplicate. Dùng `upsert` với `key` unique.
- CLI: `pnpm --filter @xuantoi/api seed:<content-type>` (e.g. `seed:quests`).

Pattern:

```ts
for (const quest of QUESTS) {
  await prisma.quest.upsert({
    where: { key: quest.key },
    create: quest,
    update: { /* chỉ update mutable fields */ },
  });
}
```

KHÔNG được:

- Xoá row cũ trước seed (mất progress).
- Mutate `key` (immutable).

---

## 8. I18N FLOW

### 8.1 VI/EN parity

Mỗi content có VI + EN. Bắt buộc.

Hiện trạng: `packages/shared/src/items.ts` etc. dùng `name` (VI). Phase 10 sẽ:

1. Rename `name` → `nameVi`.
2. Add `nameEn`.
3. Cùng cho `description` → `descriptionVi` + `descriptionEn`.
4. FE consume qua `useI18n()` với fallback VI nếu EN trống.

### 8.2 Test parity

Phase 10 thêm `i18n-parity.test.ts`:

```ts
for (const item of ITEMS) {
  expect(item.nameVi).toBeTruthy();
  expect(item.nameEn).toBeTruthy();
  expect(item.descriptionVi).toBeTruthy();
  expect(item.descriptionEn).toBeTruthy();
}
```

Pattern lặp lại cho skill, monster, dungeon, mission, boss, title, achievement.

### 8.3 Glossary

`packages/shared/i18n-glossary.md` (phase 10) ghi mapping ổn định cho từ thường dùng:

| VI | EN (chính thức) | Notes |
|---|---|---|
| Tu tiên | Cultivation | — |
| Cảnh giới | Realm | — |
| Trọng (1..9) | Stage | — |
| Đột phá | Breakthrough | — |
| Tông môn | Sect | — |
| Linh thạch | Spirit Stone | — |
| Tiên ngọc | Immortal Jade | — |
| Đan dược | Pill / Elixir | — |
| Phù lục | Talisman | — |
| Trận pháp | Formation | — |
| Bí cảnh | Secret Realm | — |
| Yêu thú | Demon Beast | — |
| Thiên kiếp | Heavenly Tribulation | — |
| Tâm ma | Heart Demon | — |

(Mở rộng dần theo content scale.)

---

## 9. CONTENT REVIEW WORKFLOW

### 9.1 Pre-PR checklist

- [ ] Catalog test pass.
- [ ] Balance check vs `BALANCE_MODEL.md`.
- [ ] i18n VI + EN.
- [ ] Description style đúng.
- [ ] Key snake_case, ASCII, unique.
- [ ] Seed idempotent (nếu DB).
- [ ] Migration rollback note (nếu DB).

### 9.2 Reviewer checklist

- [ ] Power không phá curve.
- [ ] Đặt đúng nơi (static vs DB).
- [ ] Naming consistent với glossary.
- [ ] Drop weight reasonable (không 100% drop hoặc 0.001%).
- [ ] Reward idempotent (nếu có claim path).

### 9.3 Post-merge

- [ ] Cập nhật `docs/CHANGELOG.md`.
- [ ] Cập nhật `docs/AI_HANDOFF_REPORT.md` baseline test count.
- [ ] (Optional) Cập nhật `docs/SEEDING.md` nếu có new helper.

---

## 10. ADMIN CONTENT TOOLS (long-term)

Phase 15+ admin có thể:

- Tạo / chỉnh / kết thúc EventConfig.
- Tạo / revoke GiftCode (đã có).
- Gửi mail (đã có).
- (Phase 12) Override DungeonTemplate weight live.
- (Phase 16) Tune ECONOMY_DIALS qua FeatureFlag config.

KHÔNG có (cố ý):

- Admin chỉnh static catalog (item/skill/monster) live → phải qua deploy code (giữ static = invariant guarantee).
- Admin grant > X linhThach mà không cần 2nd admin approve (phase 16).

---

## 11. CHANGELOG

- **2026-04-30** — Initial creation. Author: Devin AI session 9q.
