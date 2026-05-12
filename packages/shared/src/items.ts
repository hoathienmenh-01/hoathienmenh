/**
 * Catalog item & drop table — Phase 4.
 *
 * Item là dữ liệu tĩnh (key cố định). Inventory của character chỉ lưu
 * `itemKey + qty + equippedSlot`, server lookup ItemDef bằng key này.
 */

import type { ElementKey, LootEntry, RolledLoot } from './combat';
import { monsterByKey } from './combat';
import {
  CULTIVATION_METHODS_V2,
  type MethodSource,
} from './cultivation-methods-v2';
import type { EquipSlot, Quality } from './enums';
import {
  deriveEquipmentProgressionMetadata,
  type EquipmentGradeWithinTier,
} from './equipment-progression';

export type ItemKind =
  | 'WEAPON'
  | 'ARMOR'
  | 'BELT'
  | 'BOOTS'
  | 'HAT'
  | 'TRAM'
  | 'ARTIFACT'
  | 'PILL_HP'
  | 'PILL_MP'
  | 'PILL_EXP'
  | 'ORE'
  /**
   * Phase 11.2.D — bí kíp/thư trục dùng để học skill mới. Consume 1 stack
   * qua `POST /character/skill/learn-from-book` → `CharacterSkillService.
   * learnFromBook` sẽ validate `unlocks` của template, tạo
   * `CharacterSkill { masteryLevel: 1, source: 'item_consume' }` và ghi
   * `ItemLedger { qtyDelta: -1, reason: 'SKILL_LEARN' }` atomic. Item phải
   * khai báo `skillBook: { skillKey: '...' }` trỏ tới `SkillTemplate.key`.
   */
  | 'SKILL_BOOK'
  | 'MISC';

export type PillCategory =
  | 'HEAL_HP'
  | 'HEAL_MP'
  | 'HEAL_STAMINA'
  | 'QI_EXP'
  | 'BODY_EXP'
  | 'QI_BREAKTHROUGH'
  | 'BODY_BREAKTHROUGH'
  | 'COMBAT_BUFF'
  | 'TRIBULATION_SUPPORT'
  | 'INJURY_CURE'
  | 'MIXED_RECOVERY'
  | 'SPECIAL';

export type PillGrade =
  | 'HA_PHAM'
  | 'TRUNG_PHAM'
  | 'THUONG_PHAM'
  | 'CUC_PHAM'
  | 'DAN_VAN';

export type MaterialCategory =
  | 'ALCHEMY_QI'
  | 'ALCHEMY_BODY'
  | 'QI_BREAKTHROUGH'
  | 'BODY_BREAKTHROUGH'
  | 'TRIBULATION'
  | 'COMBAT_BUFF'
  | 'EQUIPMENT_CRAFT'
  | 'ARTIFACT_CRAFT'
  | 'FURNACE_UPGRADE'
  /**
   * Phase 26.3 — Cultivation Method V2 fragment items. Mỗi method V2 có
   * 1 fragment item `method_fragment_<methodKey>` với `materialTier` =
   * method.tier; Drop Economy V2 auto-derive rule rơi dựa trên
   * `sourceHint`. Multiplier `0.45` ở `drop-economy.ts` — chậm hơn nguyên
   * liệu thường, nhanh hơn artifact craft, tránh lạm phát.
   */
  | 'METHOD_FRAGMENT'
  | 'GENERAL';

export type SourceHint =
  | 'NORMAL_MONSTER'
  | 'ELITE'
  | 'BOSS'
  | 'WORLD_BOSS'
  | 'DUNGEON'
  | 'BODY_DUNGEON'
  | 'QUEST'
  | 'MAIN_QUEST'
  | 'DAILY_QUEST'
  | 'EVENT'
  | 'SECT_SHOP'
  | 'NPC_SHOP'
  | 'MARKET'
  | 'AUCTION'
  | 'ADMIN_ONLY';

export interface ItemBonus {
  atk?: number;
  def?: number;
  hpMax?: number;
  mpMax?: number;
  spirit?: number;
  /**
   * Phase 11.6.E — element-keyed multiplier (< 1) áp lên damage taken từ wave
   * hệ tương ứng trong tribulation. Compose multiplicatively bởi
   * {@link composeEquippedItemElementResist} ở runtime equipment aggregator.
   *
   * Convention:
   * - Empty / undefined map = identity (no resist contribution).
   * - Multiplier value < 1 = giảm damage taken (0.95 = giảm 5%).
   * - Stack qua `multiplier(item) × ...` per element key trong map.
   *
   * Wire điểm: `InventoryService.equipElementResistMods(characterId)` →
   * `TribulationService.attemptTribulation` `elementResistFn`. Compose order:
   *   `effective = computeSpiritualRootTribulationResist(...)
   *              × computePassiveTalentTribulationResist(...)
   *              × computeEquipmentTribulationResist(...)`
   * Tổng resist clamp envelope qua `[ELEMENT_MODIFIER_ABSOLUTE_FLOOR,
   * ELEMENT_MODIFIER_ABSOLUTE_CEIL]` (`0.6..1.5`).
   *
   * KHÔNG dùng cho combat damage (combat dùng `damageBonus` matrix riêng
   * trong `combat.ts` — Phase 11 nâng cao §3 Elemental Combat MVP).
   */
  elementResist?: Partial<Record<ElementKey, number>>;
  /**
   * **Phase 14.2.A** — element-keyed bonus damage `≥ 0` (additive %) áp lên
   * sát thương gây ra **trong combat** khi cast skill cùng hệ. Khác với
   * `elementResist` (kháng kiếp tribulation) — `elementalAtkBonus` là
   * **bonus tấn công** vs target có element relation phù hợp.
   *
   * Convention:
   * - Empty / undefined map = no bonus (legacy default).
   * - Value `0.05` = +5% damage khi cast skill cùng hệ.
   * - Stack additive qua `composeEquipmentElementalAtkBonus()` (sum bonuses
   *   từ tất cả trang bị đeo, cap per-item + total).
   *
   * Cap per-item `ELEMENT_EQUIPMENT_ATK_BONUS_CEIL=0.10` + tổng additive
   * `ELEMENT_EQUIPMENT_ATK_BONUS_TOTAL_CEIL=0.20` ở `elemental.ts` để Phase
   * 14.2.A foundation không phá tier progression. Combat runtime đọc qua
   * `applyElementalCombatAdjustment` pipeline trong `CombatService`.
   *
   * Không define = không bonus (legacy + foundation default — fallback 0).
   */
  elementalAtkBonus?: Partial<Record<ElementKey, number>>;
  /**
   * **Phase 14.3.B** — additive bonus to tribulation success chance khi item
   * này được trong inventory (consumable hỗ trợ vượt kiếp) hoặc đang đeo
   * (equipment hỗ trợ vượt kiếp). Convention positive value (e.g. `0.05` =
   * +5% success chance).
   *
   * - PILL kind (consumable hỗ trợ vượt kiếp): preview KHÔNG consume; entry
   *   chỉ surface trong supports list nếu inventory có ít nhất 1 stack.
   *   Hậu kỳ Phase 14.3.B-W (ngoài scope) sẽ wire consume khi player
   *   confirm attempt.
   * - EQUIPMENT kind (item đang đeo có hộ phù): entry surface trong supports
   *   nếu `equippedSlot != null`. Không cap per-item ngoài
   *   `TRIBULATION_SUPPORT_PER_ENTRY_CEIL` (`0.1`) ở
   *   {@link composeTribulationSupports}.
   *
   * Cap composition: foundation per-entry/total cap (`0.1` / `0.3`) đảm bảo
   * stack rộng vẫn không lật tỉ lệ vượt kiếp khỏi tier progression.
   *
   * Không define = no support (default — legacy items).
   */
  tribulationSupport?: number;
}

export interface ItemEffect {
  hp?: number;
  mp?: number;
  stamina?: number;
  exp?: number;
  bodyExp?: number;
  /**
   * Phase 11.10.E — pill/elixir consume → apply BuffDef key cùng tx với
   * decrement inventory (`InventoryService.use()` wire `BuffService.applyBuffTx`).
   * Idempotent qua `CharacterBuff` composite UNIQUE: non-stackable refresh
   * `expiresAt`, stackable +1 stack cap `maxStacks`.
   *
   * Cross-ref guard: `buffForItem(itemKey)` lookup khỏi catalog drift / typo.
   */
  buffKey?: string;
  qiBreakthroughBonus?: number;
  bodyBreakthroughBonus?: number;
  tribulationSupport?: number;
  bodyInjuryReductionMinutes?: number;
  taoMaReductionMinutes?: number;
  cultivationRateBonusPct?: number;
  bodyCultivationRateBonusPct?: number;
  bossDamageReductionPct?: number;
  elementalResistBonus?: Partial<Record<ElementKey, number>>;
}

/**
 * Phase 11.2.D — metadata cho item kind = 'SKILL_BOOK' liên kết tới
 * `SkillTemplate.key`. Khi player consume, server gọi
 * `CharacterSkillService.learnFromBook(...)` → validate `unlocks` →
 * `learn(skillKey, source='item_consume')`. Idempotent qua
 * `@@unique([characterId, skillKey])` (P2002 → ALREADY_LEARNED).
 */
export interface SkillBookMeta {
  /** `SkillTemplate.key` ↔ `SkillDef.key`. Phải tồn tại trong catalog. */
  skillKey: string;
}

export interface ItemDef {
  key: string;
  name: string;
  description: string;
  kind: ItemKind;
  quality: Quality;
  /** Có thể chồng nhiều cái 1 ô (dùng cho đan dược / quặng). */
  stackable: boolean;
  /** Nếu trang bị được, slot tương ứng. */
  slot?: EquipSlot;
  /** Phase 22.1 — optional equipment affinity hook for build recommendation. */
  equipmentElement?: ElementKey | null;
  /** Phase 23.2 — realm-scaled equipment progression metadata. */
  equipmentTier?: number;
  equipmentTierName?: string;
  equipmentGradeWithinTier?: EquipmentGradeWithinTier | null;
  requiredRealmOrder?: number;
  requiredRealmKey?: string;
  powerBudget?: number;
  computedPowerScore?: number;
  maxEnhanceLevel?: number;
  maxSocketCount?: number;
  bonuses?: ItemBonus;
  effect?: ItemEffect;
  pillCategory?: PillCategory;
  pillGrade?: PillGrade;
  materialTier?: number;
  materialCategory?: MaterialCategory;
  materialElement?: ElementKey | null;
  sourceHint?: SourceHint[];
  targetRealmOrder?: number;
  recipeTier?: number;
  bindOnCraft?: boolean;
  bindOnPickup?: boolean;
  marketTradeable?: boolean;
  /** Phase 11.2.D — chỉ set khi `kind === 'SKILL_BOOK'`. */
  skillBook?: SkillBookMeta;
  /** Giá tham khảo (linh thạch). */
  price: number;
}

const BASE_ITEMS: readonly ItemDef[] = [
  // ----- Vũ khí -----
  {
    key: 'so_kiem',
    name: 'Sơ Kiếm',
    description: 'Một thanh kiếm sắt phàm phẩm, hợp với người mới luyện khí.',
    kind: 'WEAPON',
    quality: 'PHAM',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 5 },
    price: 30,
  },
  {
    key: 'huyen_kiem',
    name: 'Huyền Kiếm',
    description: 'Hắc thiết tinh luyện, thích hợp với trúc cơ kỳ.',
    kind: 'WEAPON',
    quality: 'LINH',
    stackable: false,
    slot: 'WEAPON',
    // Phase 14.2.B — hắc thiết kim phẩm → nhẹ +3% damage skill hệ Kim.
    bonuses: { atk: 12, spirit: 2, elementalAtkBonus: { kim: 0.03 } },
    price: 180,
  },
  {
    key: 'diem_phong_dao',
    name: 'Điểm Phong Đao',
    description: 'Yêu đao tia chớp, mỗi đường chém đều có gió rít.',
    kind: 'WEAPON',
    quality: 'HUYEN',
    stackable: false,
    slot: 'WEAPON',
    // Phase 14.2.B — huyền đao gió rít → +5% damage skill hệ Kim.
    bonuses: { atk: 25, hpMax: 30, elementalAtkBonus: { kim: 0.05 } },
    price: 720,
  },

  // ----- Áo / Giáp -----
  {
    key: 'pham_giap',
    name: 'Phàm Giáp',
    description: 'Áo da thú thông thường, có thể đỡ vài đòn yêu thú nhỏ.',
    kind: 'ARMOR',
    quality: 'PHAM',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 4 },
    price: 30,
  },
  {
    key: 'linh_giap',
    name: 'Linh Giáp',
    description: 'Linh giáp dệt từ tơ nhện linh, mềm dẻo và bền.',
    kind: 'ARMOR',
    quality: 'LINH',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 10, hpMax: 25 },
    price: 180,
  },
  {
    key: 'huyet_phach_giap',
    name: 'Huyết Phách Giáp',
    description: 'Giáp đỏ đúc bằng huyết tinh, càng đánh càng mạnh.',
    kind: 'ARMOR',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 22, hpMax: 60 },
    price: 720,
  },

  // ----- Đan dược -----
  {
    key: 'huyet_chi_dan',
    name: 'Huyết Chỉ Đan',
    description: 'Hồi 60 HP tức thì.',
    kind: 'PILL_HP',
    quality: 'PHAM',
    stackable: true,
    effect: { hp: 60 },
    price: 25,
  },
  {
    key: 'thanh_lam_dan',
    name: 'Thanh Lam Đan',
    description: 'Hồi 200 HP, vị mát lạnh hơi đắng.',
    kind: 'PILL_HP',
    quality: 'LINH',
    stackable: true,
    effect: { hp: 200 },
    price: 80,
  },
  {
    key: 'linh_lo_dan',
    name: 'Linh Lộ Đan',
    description: 'Hồi 80 MP, tinh khí ngưng tụ.',
    kind: 'PILL_MP',
    quality: 'PHAM',
    stackable: true,
    effect: { mp: 80 },
    price: 35,
  },
  {
    key: 'co_thien_dan',
    name: 'Cổ Thiên Đan',
    description: 'Tăng 500 EXP tu vi.',
    kind: 'PILL_EXP',
    quality: 'LINH',
    stackable: true,
    effect: { exp: 500 },
    price: 250,
  },
  {
    key: 'khi_huyet_dan_t1',
    name: 'Khí Huyết Đan',
    description: 'Đan Luyện Thể sơ cấp, bổ khí huyết và tăng nhẹ bodyExp.',
    kind: 'PILL_EXP',
    quality: 'PHAM',
    stackable: true,
    effect: { bodyExp: 120 },
    pillCategory: 'BODY_EXP',
    recipeTier: 1,
    targetRealmOrder: 1,
    price: 90,
  },
  {
    key: 'cuong_cot_dan_t2',
    name: 'Cường Cốt Đan',
    description: 'Đan Luyện Thể trung cấp, cường hóa gân cốt và tăng bodyExp vừa.',
    kind: 'PILL_EXP',
    quality: 'LINH',
    stackable: true,
    effect: { bodyExp: 360 },
    pillCategory: 'BODY_EXP',
    recipeTier: 2,
    targetRealmOrder: 2,
    price: 240,
  },
  {
    key: 'tay_tuy_dan_t3',
    name: 'Tẩy Tủy Đan',
    description: 'Đan hỗ trợ đột phá Tẩy Tủy, dùng trong Luyện Thể.',
    kind: 'PILL_EXP',
    quality: 'HUYEN',
    stackable: true,
    effect: { bodyBreakthroughBonus: 0.05, bodyExp: 800 },
    pillCategory: 'BODY_BREAKTHROUGH',
    recipeTier: 3,
    targetRealmOrder: 3,
    price: 700,
  },
  {
    key: 'kim_than_dan_t4',
    name: 'Kim Thân Đan',
    description: 'Đan hỗ trợ đột phá Kim Cương Thân, thân thể bền như kim thiết.',
    kind: 'PILL_EXP',
    quality: 'TIEN',
    stackable: true,
    effect: { bodyBreakthroughBonus: 0.07, bodyExp: 1600 },
    pillCategory: 'BODY_BREAKTHROUGH',
    recipeTier: 4,
    targetRealmOrder: 4,
    price: 1800,
  },
  {
    key: 'bat_hoai_dan_t5',
    name: 'Bất Hoại Đan',
    description: 'Đan hỗ trợ đột phá Bất Hoại Pháp Thân, cực hiếm và khó luyện.',
    kind: 'PILL_EXP',
    quality: 'THAN',
    stackable: true,
    effect: { bodyBreakthroughBonus: 0.08 },
    pillCategory: 'BODY_BREAKTHROUGH',
    recipeTier: 5,
    targetRealmOrder: 6,
    price: 4200,
  },
  {
    key: 'huyet_tinh',
    name: 'Huyết Tinh',
    description: 'Tinh huyết yêu thú, nguyên liệu luyện đan.',
    kind: 'ORE',
    quality: 'LINH',
    stackable: true,
    price: 60,
  },

  // ----- Drop hiếm boss đại hội (Phase 7) -----
  {
    key: 'tien_huyen_kiem',
    name: 'Tiên Huyền Kiếm',
    description: 'Cổ kiếm rớt từ tay Yêu Vương, sát khí ngút trời.',
    kind: 'WEAPON',
    quality: 'TIEN',
    stackable: false,
    slot: 'WEAPON',
    // Phase 14.2.B — tiên phẩm hắc thép → +6% damage skill hệ Kim.
    bonuses: { atk: 60, hpMax: 120, spirit: 6, elementalAtkBonus: { kim: 0.06 } },
    price: 9000,
  },
  {
    key: 'tien_huyen_giap',
    name: 'Tiên Huyền Giáp',
    description: 'Giáp Tiên phẩm, chống đỡ vạn pháp.',
    kind: 'ARMOR',
    quality: 'TIEN',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 55, hpMax: 250 },
    price: 9000,
  },
  {
    key: 'than_dan',
    name: 'Thần Dược Thượng Đan',
    description: 'Đan Thần phẩm, hồi 1500 HP và 600 EXP cùng lúc.',
    kind: 'PILL_HP',
    quality: 'THAN',
    stackable: true,
    effect: { hp: 1500, exp: 600 },
    price: 4000,
  },

  // ----- Thắt lưng (BELT) -----
  {
    key: 'pham_thuc_dai',
    name: 'Phàm Thúc Đái',
    description: 'Thắt lưng da thuộc, gia tăng sức chịu đựng.',
    kind: 'BELT',
    quality: 'PHAM',
    stackable: false,
    slot: 'BELT',
    bonuses: { hpMax: 20 },
    price: 35,
  },
  {
    key: 'linh_thuc_dai',
    name: 'Linh Thúc Đái',
    description: 'Thúc đái bện bằng linh ti, ôn nhuận khí huyết.',
    kind: 'BELT',
    quality: 'LINH',
    stackable: false,
    slot: 'BELT',
    bonuses: { hpMax: 45, def: 3 },
    price: 200,
  },
  {
    key: 'huyen_long_dai',
    name: 'Huyền Long Đái',
    description: 'Thúc đái khảm vảy huyền long, vững như núi non.',
    kind: 'BELT',
    quality: 'HUYEN',
    stackable: false,
    slot: 'BELT',
    bonuses: { hpMax: 120, def: 10 },
    price: 850,
  },

  // ----- Giày (BOOTS) -----
  {
    key: 'pham_hai',
    name: 'Phàm Hài',
    description: 'Giày vải phàm phẩm, thoải mái đi đường.',
    kind: 'BOOTS',
    quality: 'PHAM',
    stackable: false,
    slot: 'BOOTS',
    bonuses: { def: 2 },
    price: 28,
  },
  {
    key: 'vu_linh_hai',
    name: 'Vũ Linh Hài',
    description: 'Giày linh dệt bằng lông phượng, bước đi nhẹ như gió.',
    kind: 'BOOTS',
    quality: 'LINH',
    stackable: false,
    slot: 'BOOTS',
    bonuses: { def: 6, spirit: 2 },
    price: 190,
  },
  {
    key: 'tien_phong_hai',
    name: 'Tiên Phong Hài',
    description: 'Lưu phong hoá hài, tốc độ vô song.',
    kind: 'BOOTS',
    quality: 'HUYEN',
    stackable: false,
    slot: 'BOOTS',
    bonuses: { def: 14, spirit: 5 },
    price: 820,
  },

  // ----- Mũ (HAT) -----
  {
    key: 'pham_quan',
    name: 'Phàm Quan',
    description: 'Mũ vải phàm phẩm.',
    kind: 'HAT',
    quality: 'PHAM',
    stackable: false,
    slot: 'HAT',
    bonuses: { def: 2, mpMax: 10 },
    price: 30,
  },
  {
    key: 'tu_ngoc_quan',
    name: 'Tử Ngọc Quan',
    description: 'Mũ khảm tử ngọc, khai minh linh đài.',
    kind: 'HAT',
    quality: 'LINH',
    stackable: false,
    slot: 'HAT',
    bonuses: { def: 6, mpMax: 35, spirit: 2 },
    price: 220,
  },
  {
    key: 'huyen_thien_quan',
    name: 'Huyền Thiên Quan',
    description: 'Bảo quan thượng cổ, tâm linh thông thấu huyền thiên.',
    kind: 'HAT',
    quality: 'HUYEN',
    stackable: false,
    slot: 'HAT',
    bonuses: { def: 15, mpMax: 90, spirit: 6 },
    price: 900,
  },

  // ----- Trâm (TRAM) -----
  {
    key: 'ngoc_tram',
    name: 'Ngọc Trâm',
    description: 'Trâm ngọc khảm hoa, tinh tế an thần.',
    kind: 'TRAM',
    quality: 'LINH',
    stackable: false,
    slot: 'TRAM',
    bonuses: { mpMax: 25, spirit: 3 },
    price: 180,
  },
  {
    key: 'cuu_diep_linh_tram',
    name: 'Cửu Diệp Linh Trâm',
    description: 'Trâm chín cánh, hút linh khí thiên địa.',
    kind: 'TRAM',
    quality: 'HUYEN',
    stackable: false,
    slot: 'TRAM',
    bonuses: { mpMax: 70, spirit: 8 },
    price: 780,
  },

  // ----- Pháp bảo (ARTIFACT) -----
  {
    key: 'luyen_khi_phu',
    name: 'Luyện Khí Phù',
    description: 'Phù thuật sơ cấp, cộng sức công nhẹ.',
    kind: 'ARTIFACT',
    quality: 'PHAM',
    stackable: false,
    slot: 'ARTIFACT_1',
    bonuses: { atk: 4 },
    price: 80,
  },
  {
    key: 'bat_huyet_linh_bai',
    name: 'Bát Huyết Linh Bài',
    description: 'Linh bài tế huyết, bảo vệ chủ nhân khỏi ma khí.',
    kind: 'ARTIFACT',
    quality: 'LINH',
    stackable: false,
    slot: 'ARTIFACT_1',
    bonuses: { def: 8, hpMax: 60 },
    price: 420,
  },
  {
    key: 'huyen_kim_toa',
    name: 'Huyền Kim Toạ',
    description: 'Bảo toạ trường sinh, tăng nguyên khí.',
    kind: 'ARTIFACT',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARTIFACT_2',
    // Phase 14.2.B — huyền kim toạ → +4% damage skill hệ Thổ (hậu thổ tinh).
    bonuses: { hpMax: 150, mpMax: 80, spirit: 5, elementalAtkBonus: { tho: 0.04 } },
    price: 1200,
  },
  {
    key: 'thien_linh_ngoc',
    name: 'Thiên Linh Ngọc',
    description: 'Ngọc trời vô giá, khai mở thiên mệnh.',
    kind: 'ARTIFACT',
    quality: 'TIEN',
    stackable: false,
    slot: 'ARTIFACT_3',
    bonuses: { atk: 30, hpMax: 200, spirit: 12 },
    price: 6500,
  },

  // ----- Đan dược bổ sung -----
  {
    key: 'hoi_nguyen_dan',
    name: 'Hồi Nguyên Đan',
    description: 'Hồi 400 MP, dùng trong đánh phó bản dài.',
    kind: 'PILL_MP',
    quality: 'LINH',
    stackable: true,
    effect: { mp: 400 },
    price: 150,
  },
  {
    key: 'van_linh_dan',
    name: 'Vạn Linh Đan',
    description: 'Tăng 2500 EXP tu vi, hiếm và đắt.',
    kind: 'PILL_EXP',
    quality: 'HUYEN',
    stackable: true,
    effect: { exp: 2500 },
    price: 1200,
  },
  {
    // Phase 11.3.D — Linh căn reroll consumable. Dùng qua endpoint
    // `POST /character/spiritual-root/reroll` (không tự kích hoạt khi inventory
    // use). Server-authoritative consume 1 stack qua `ItemLedger` reason
    // `SPIRITUAL_ROOT_REROLL`. Drop endgame (boss tier ≥ THAN, dungeon hậu kỳ).
    key: 'linh_can_dan',
    name: 'Linh Căn Đan',
    description: 'Tiên đan tái khai linh căn, dùng để gieo lại linh căn ngẫu nhiên một lần.',
    kind: 'MISC',
    quality: 'TIEN',
    stackable: true,
    price: 5000,
  },

  // Phase 11.10.E — Pill buff đan dược. Use sẽ apply BuffDef tương ứng qua
  // `InventoryService.use()` → `BuffService.applyBuffTx`. 4 pill này pair
  // 1-1 với 4 buff `pill_*_buff_t1` đã có trong `buffs.ts` (description
  // catalog buff đã reference tên đan: "Sau khi uống Cương Lực Đan...").
  {
    key: 'cuong_luc_dan',
    name: 'Cương Lực Đan',
    description: 'Đan dược cương kim, +12% công kích trong 60 giây sau khi uống.',
    kind: 'PILL_HP',
    quality: 'LINH',
    stackable: true,
    effect: { buffKey: 'pill_atk_buff_t1' },
    price: 200,
  },
  {
    key: 'thiet_bich_dan',
    name: 'Thiết Bích Đan',
    description: 'Đan dược kiên cố, +15% phòng ngự trong 60 giây sau khi uống.',
    kind: 'PILL_HP',
    quality: 'LINH',
    stackable: true,
    effect: { buffKey: 'pill_def_buff_t1' },
    price: 200,
  },
  {
    key: 'sinh_co_dan',
    name: 'Sinh Cơ Đan',
    description: 'Đan dược tái sinh, hồi 5 HP/giây trong 30 giây sau khi uống.',
    kind: 'PILL_HP',
    quality: 'LINH',
    stackable: true,
    effect: { buffKey: 'pill_hp_regen_t1' },
    price: 180,
  },
  {
    key: 'linh_tam_dan',
    name: 'Linh Tâm Đan',
    description: 'Đan dược thông linh, +18% spirit trong 90 giây sau khi uống.',
    kind: 'PILL_HP',
    quality: 'LINH',
    stackable: true,
    effect: { buffKey: 'pill_spirit_buff_t1' },
    price: 250,
  },

  // ===================================================================
  // Phase 10 PR-1 — Item Pack 1 (+50 item)
  //
  // Mục tiêu: lấp các khoảng trống early→mid của catalog và chuẩn bị
  // pool drop/equip cho các bản patch sau (skill / dungeon / boss /
  // mission). Stat budget tuân thủ docs/BALANCE_MODEL.md §3.3:
  //   PHAM  ≤ atk 10 / def 8 / hpMax 30 / spirit 5
  //   LINH  ≤ atk 25 / def 20 / hpMax 80 / spirit 12
  //   HUYEN ≤ atk 60 / def 50 / hpMax 200 / spirit 30
  //   TIEN  ≤ atk 200 / def 160 / hpMax 800 / spirit 100
  //   THAN  ≤ atk 800 / def 600 / hpMax 3000 / spirit 350
  // Test bound trong `items-balance.test.ts` (deterministic guard).
  // ===================================================================

  // ----- Vũ khí mới (đa chủng: kiếm / đao / thương / pháp trượng) -----
  {
    key: 'tu_la_dao',
    name: 'Tu La Đao',
    description: 'Yêu đao tế bằng huyết tinh, hợp đệ tử Tu La Tông sơ nhập đạo.',
    kind: 'WEAPON',
    quality: 'PHAM',
    stackable: false,
    slot: 'WEAPON',
    // Phase 14.2.B — huyết đao sơ cấp → +3% damage skill hệ Hoả.
    bonuses: { atk: 6, elementalAtkBonus: { hoa: 0.03 } },
    price: 38,
  },
  {
    key: 'thanh_van_thuong',
    name: 'Thanh Vân Thương',
    description: 'Trường thương luyện khí, mũi nhọn chỉ thẳng tâm địch.',
    kind: 'WEAPON',
    quality: 'PHAM',
    stackable: false,
    slot: 'WEAPON',
    bonuses: { atk: 7, hpMax: 10 },
    price: 42,
  },
  {
    key: 'truc_co_truong',
    name: 'Trúc Cơ Trượng',
    description: 'Pháp trượng gỗ trúc khắc văn, dẫn linh khí hộ thân.',
    kind: 'WEAPON',
    quality: 'PHAM',
    stackable: false,
    slot: 'WEAPON',
    // Phase 14.2.B — trượng trúc sơ cấp → +3% damage skill hệ Mộc.
    bonuses: { atk: 5, mpMax: 20, spirit: 2, elementalAtkBonus: { moc: 0.03 } },
    price: 50,
  },
  {
    key: 'lanh_phong_kiem',
    name: 'Lãnh Phong Kiếm',
    description: 'Kiếm gió lạnh, vung lên thanh âm như tuyết rơi.',
    kind: 'WEAPON',
    quality: 'LINH',
    stackable: false,
    slot: 'WEAPON',
    // Phase 14.2.B — lãnh phong kiếm → +4% damage skill hệ Kim.
    bonuses: { atk: 18, spirit: 3, elementalAtkBonus: { kim: 0.04 } },
    price: 200,
  },
  {
    key: 'xich_huyet_dao',
    name: 'Xích Huyết Đao',
    description: 'Đao tế huyết, càng giết càng sắc, càng dùng càng khát.',
    kind: 'WEAPON',
    quality: 'LINH',
    stackable: false,
    slot: 'WEAPON',
    // Phase 14.2.B — đao tế huyết → +4% damage skill hệ Hoả.
    bonuses: { atk: 22, def: 4, elementalAtkBonus: { hoa: 0.04 } },
    price: 220,
  },
  {
    key: 'lien_hoa_truong',
    name: 'Liên Hoa Trượng',
    description: 'Pháp trượng khắc hoa sen, ổn định linh đài người dùng.',
    kind: 'WEAPON',
    quality: 'LINH',
    stackable: false,
    slot: 'WEAPON',
    // Phase 14.2.B — pháp trượng linh phẩm sen → +5% damage skill hệ Mộc.
    bonuses: { atk: 14, mpMax: 40, spirit: 6, elementalAtkBonus: { moc: 0.05 } },
    price: 230,
  },
  {
    key: 'cuu_u_bi_thuong',
    name: 'Cửu U Bi Thương',
    description: 'Thương u minh, hơi lạnh thấm xương, thích hợp Trúc Cơ hậu kỳ.',
    kind: 'WEAPON',
    quality: 'HUYEN',
    stackable: false,
    slot: 'WEAPON',
    // Phase 14.2.B — huyền thương u minh → +6% damage skill hệ Thuỷ.
    bonuses: { atk: 38, hpMax: 60, spirit: 8, elementalAtkBonus: { thuy: 0.06 } },
    price: 850,
  },
  {
    key: 'than_phong_kiem',
    name: 'Thần Phong Kiếm',
    description: 'Kiếm tiên phẩm rút từ thần phong, một chiêu vạn lý.',
    kind: 'WEAPON',
    quality: 'TIEN',
    stackable: false,
    slot: 'WEAPON',
    // Phase 14.2.B — tiên phẩm thần phong → +8% damage skill hệ Kim (cap dưới 0.10).
    bonuses: { atk: 130, hpMax: 150, spirit: 20, elementalAtkBonus: { kim: 0.08 } },
    price: 7500,
  },

  // ----- Áo / Giáp mở rộng -----
  {
    key: 'yeu_phach_giap',
    name: 'Yêu Phách Giáp',
    description: 'Giáp da yêu thú sơ cấp, đủ chống vài đòn vuốt sắc.',
    kind: 'ARMOR',
    quality: 'PHAM',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 6, hpMax: 18 },
    price: 38,
  },
  {
    key: 'truc_co_bao',
    name: 'Trúc Cơ Bào',
    description: 'Trường bào dệt linh ti, tăng mp tự hồi nhẹ.',
    kind: 'ARMOR',
    quality: 'PHAM',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 7, mpMax: 12 },
    price: 40,
  },
  {
    key: 'cuu_la_giap',
    name: 'Cửu La Giáp',
    description: 'Giáp Linh phẩm khắc cửu la văn, cân bằng công thủ.',
    kind: 'ARMOR',
    quality: 'LINH',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 14, hpMax: 50, spirit: 4 },
    price: 230,
  },
  {
    key: 'han_thiet_giap',
    name: 'Hàn Thiết Giáp',
    description: 'Giáp luyện từ hàn thiết ngàn năm, lạnh thấu xương.',
    kind: 'ARMOR',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARMOR',
    // Phase 14.2.B — hàn thiết giáp → +4% damage skill hệ Thuỷ (giáp ngoại lệ
    // dành cho tu sĩ hệ băng — ngoài Huyền Giáp Phong Thuỷ elementResist).
    bonuses: { def: 32, hpMax: 110, elementalAtkBonus: { thuy: 0.04 } },
    price: 750,
  },
  {
    key: 'linh_van_bao',
    name: 'Linh Vân Bào',
    description: 'Pháp bào dệt mây linh, hợp Kim Đan tu sĩ pháp tu.',
    kind: 'ARMOR',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 28, mpMax: 80, spirit: 10 },
    price: 800,
  },
  {
    key: 'than_lan_giap',
    name: 'Thần Lân Giáp',
    description: 'Giáp Thần phẩm, vảy thần long phản đòn vạn pháp.',
    kind: 'ARMOR',
    quality: 'THAN',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 220, hpMax: 1100, spirit: 60 },
    price: 32000,
  },

  // ----- Phase 11.6.E — Giáp phòng kiếp Ngũ Hành (HUYEN, elementResist 5%) -----
  // Giáp Huyền phẩm khắc phù chuyên giảm sát thương kiếp hệ tương ứng.
  // `elementResist[<elem>] = 0.95` (= EQUIPMENT_ELEMENT_RESIST_VALUE) — wire vào
  // `InventoryService.equipElementResistMods` → `TribulationService` element
  // resist composition. Stat budget thấp hơn raw HUYEN armor (han_thiet_giap
  // def=32/hpMax=110) — đánh đổi resist niche cho stat tổng. 5-element coverage
  // mirror talent `talent_<elem>_thien_giap` (Phase 11.6.D).
  {
    key: 'huyen_giap_phong_kim',
    name: 'Kim Phong Giáp',
    description:
      'Giáp Huyền phẩm khắc phù chế ngự khí kiếp hệ Kim, giảm 5% sát thương kim kiếp.',
    kind: 'ARMOR',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 22, hpMax: 80, elementResist: { kim: 0.95 } },
    price: 900,
  },
  {
    key: 'huyen_giap_phong_moc',
    name: 'Mộc Phong Giáp',
    description:
      'Giáp Huyền phẩm dệt linh ti chế ngự khí kiếp hệ Mộc, giảm 5% sát thương mộc kiếp.',
    kind: 'ARMOR',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 22, hpMax: 80, elementResist: { moc: 0.95 } },
    price: 900,
  },
  {
    key: 'huyen_giap_phong_thuy',
    name: 'Thuỷ Phong Giáp',
    description:
      'Giáp Huyền phẩm khắc băng văn chế ngự khí kiếp hệ Thuỷ, giảm 5% sát thương thuỷ kiếp.',
    kind: 'ARMOR',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 22, hpMax: 80, elementResist: { thuy: 0.95 } },
    price: 900,
  },
  {
    key: 'huyen_giap_phong_hoa',
    name: 'Hoả Phong Giáp',
    description:
      'Giáp Huyền phẩm tôi luyện trong hoả lò chế ngự khí kiếp hệ Hoả, giảm 5% sát thương hoả kiếp.',
    kind: 'ARMOR',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 22, hpMax: 80, elementResist: { hoa: 0.95 } },
    price: 900,
  },
  {
    key: 'huyen_giap_phong_tho',
    name: 'Thổ Phong Giáp',
    description:
      'Giáp Huyền phẩm khảm hậu thổ tinh chế ngự khí kiếp hệ Thổ, giảm 5% sát thương thổ kiếp.',
    kind: 'ARMOR',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARMOR',
    bonuses: { def: 22, hpMax: 80, elementResist: { tho: 0.95 } },
    price: 900,
  },

  // ----- Thắt lưng (BELT) — bổ sung HUYEN/TIEN/THAN -----
  {
    key: 'mau_huyet_dai',
    name: 'Mâu Huyết Đái',
    description: 'Thắt lưng tế huyết, ôn nhuận khí huyết tu sĩ chiến đấu.',
    kind: 'BELT',
    quality: 'HUYEN',
    stackable: false,
    slot: 'BELT',
    bonuses: { hpMax: 150, def: 12 },
    price: 900,
  },
  {
    key: 'tien_van_dai',
    name: 'Tiên Vân Đái',
    description: 'Thắt lưng dệt vân tiên, gia trì khí cơ phòng thủ.',
    kind: 'BELT',
    quality: 'TIEN',
    stackable: false,
    slot: 'BELT',
    bonuses: { hpMax: 500, def: 80, spirit: 30 },
    price: 6500,
  },
  {
    key: 'than_loi_dai',
    name: 'Thần Lôi Đái',
    description: 'Thúc đái Thần phẩm, sấm sét quanh thân hộ chủ.',
    kind: 'BELT',
    quality: 'THAN',
    stackable: false,
    slot: 'BELT',
    bonuses: { hpMax: 1500, def: 250, spirit: 120 },
    price: 28000,
  },

  // ----- Giày (BOOTS) — bổ sung LINH biến thể + TIEN -----
  {
    key: 'linh_van_hai',
    name: 'Linh Vân Hài',
    description: 'Giày đạp linh vân, bước nhẹ tựa hạc.',
    kind: 'BOOTS',
    quality: 'LINH',
    stackable: false,
    slot: 'BOOTS',
    bonuses: { def: 5, hpMax: 25, spirit: 3 },
    price: 195,
  },
  {
    key: 'cuu_thien_hai',
    name: 'Cửu Thiên Hài',
    description: 'Giày Huyền phẩm, vạn lý đăng tiêu chỉ trong nháy mắt.',
    kind: 'BOOTS',
    quality: 'HUYEN',
    stackable: false,
    slot: 'BOOTS',
    bonuses: { def: 18, spirit: 8 },
    price: 850,
  },
  {
    key: 'tien_van_hai',
    name: 'Tiên Vân Hài',
    description: 'Hài Tiên phẩm, đạp vân tiên du, tốc độ vô song.',
    kind: 'BOOTS',
    quality: 'TIEN',
    stackable: false,
    slot: 'BOOTS',
    bonuses: { def: 90, hpMax: 200, spirit: 30 },
    price: 6800,
  },

  // ----- Mũ (HAT) — bổ sung PHAM + TIEN/THAN -----
  {
    key: 'truc_co_quan',
    name: 'Trúc Cơ Quan',
    description: 'Mũ trúc cơ luyện khí, ổn định linh đài người mới.',
    kind: 'HAT',
    quality: 'PHAM',
    stackable: false,
    slot: 'HAT',
    bonuses: { def: 3, mpMax: 15, spirit: 1 },
    price: 35,
  },
  {
    key: 'cuu_diep_quan',
    name: 'Cửu Diệp Quan',
    description: 'Mũ Tiên phẩm khảm cửu diệp linh hoa, khai mở tâm thức.',
    kind: 'HAT',
    quality: 'TIEN',
    stackable: false,
    slot: 'HAT',
    bonuses: { def: 90, mpMax: 320, spirit: 50 },
    price: 7000,
  },
  {
    key: 'than_minh_quan',
    name: 'Thần Minh Quan',
    description: 'Bảo quan Thần phẩm, hào quang thần minh che chở.',
    kind: 'HAT',
    quality: 'THAN',
    stackable: false,
    slot: 'HAT',
    bonuses: { def: 280, mpMax: 1100, spirit: 180 },
    price: 30000,
  },

  // ----- Trâm (TRAM) — bổ sung PHAM + TIEN/THAN -----
  {
    key: 'moc_tram',
    name: 'Mộc Trâm',
    description: 'Trâm gỗ đào tránh tà, vật khởi đầu của nữ tu.',
    kind: 'TRAM',
    quality: 'PHAM',
    stackable: false,
    slot: 'TRAM',
    bonuses: { mpMax: 8, spirit: 1 },
    price: 30,
  },
  {
    key: 'cuu_diep_linh_tram_tien',
    name: 'Cửu Diệp Linh Trâm — Tiên phẩm',
    description: 'Trâm Tiên phẩm chín cánh hoa, hút linh khí thiên địa.',
    kind: 'TRAM',
    quality: 'TIEN',
    stackable: false,
    slot: 'TRAM',
    bonuses: { mpMax: 300, spirit: 50, hpMax: 150 },
    price: 6500,
  },
  {
    key: 'than_linh_tram',
    name: 'Thần Linh Trâm',
    description: 'Trâm Thần phẩm, mỗi lá đều khắc một thiên đạo văn.',
    kind: 'TRAM',
    quality: 'THAN',
    stackable: false,
    slot: 'TRAM',
    bonuses: { mpMax: 1100, spirit: 200 },
    price: 27000,
  },

  // ----- Pháp bảo (ARTIFACT) — bổ sung biến thể -----
  {
    key: 'linh_phu_thuong',
    name: 'Linh Phù Thượng',
    description: 'Phù bảo Linh phẩm cấp cao, tăng công + thủ nhẹ.',
    kind: 'ARTIFACT',
    quality: 'LINH',
    stackable: false,
    slot: 'ARTIFACT_2',
    bonuses: { atk: 8, def: 3 },
    price: 220,
  },
  {
    key: 'huyen_an_phu',
    name: 'Huyền Ấn Phù',
    description: 'Ấn phù Huyền phẩm, tăng thủ + máu cho tu sĩ phòng thủ.',
    kind: 'ARTIFACT',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARTIFACT_3',
    // Phase 14.2.B — huyền ấn phù → +4% damage skill hệ Thổ.
    bonuses: { def: 35, hpMax: 130, elementalAtkBonus: { tho: 0.04 } },
    price: 900,
  },
  {
    key: 'tu_la_huyet_phach',
    name: 'Tu La Huyết Phách',
    description: 'Pháp bảo Tu La Tông, tế huyết khắc cốt, công sát kinh người.',
    kind: 'ARTIFACT',
    quality: 'TIEN',
    stackable: false,
    slot: 'ARTIFACT_2',
    // Phase 14.2.B — pháp bảo tiên phẩm huyết tinh → +5% damage skill hệ Hoả.
    bonuses: { atk: 90, hpMax: 350, spirit: 25, elementalAtkBonus: { hoa: 0.05 } },
    price: 6800,
  },
  {
    key: 'than_phach_chau',
    name: 'Thần Phách Châu',
    description: 'Châu Thần phẩm, hồn châu vạn cổ, gia trì toàn diện.',
    kind: 'ARTIFACT',
    quality: 'THAN',
    stackable: false,
    slot: 'ARTIFACT_2',
    bonuses: { atk: 280, hpMax: 1200, spirit: 100 },
    price: 30000,
  },

  // ----- Đan HP bổ sung -----
  {
    key: 'tieu_phuc_dan',
    name: 'Tiểu Phục Đan',
    description: 'Hồi 35 HP, đan phàm phẩm tân thủ.',
    kind: 'PILL_HP',
    quality: 'PHAM',
    stackable: true,
    effect: { hp: 35 },
    price: 18,
  },
  {
    key: 'cuu_huyen_dan',
    name: 'Cửu Huyền Đan',
    description: 'Hồi 600 HP, đan Huyền phẩm cho phó bản dài.',
    kind: 'PILL_HP',
    quality: 'HUYEN',
    stackable: true,
    effect: { hp: 600 },
    price: 380,
  },
  {
    key: 'tien_phach_dan',
    name: 'Tiên Phách Đan',
    description: 'Hồi 2500 HP, đan Tiên phẩm cứu mạng giữa thiên kiếp.',
    kind: 'PILL_HP',
    quality: 'TIEN',
    stackable: true,
    effect: { hp: 2500 },
    price: 1800,
  },

  // ----- Đan MP bổ sung -----
  {
    key: 'linh_tinh_dan',
    name: 'Linh Tinh Đan',
    description: 'Hồi 30 MP, đan phàm phẩm dùng hằng ngày.',
    kind: 'PILL_MP',
    quality: 'PHAM',
    stackable: true,
    effect: { mp: 30 },
    price: 18,
  },
  {
    key: 'ngoc_lien_dan',
    name: 'Ngọc Liên Đan',
    description: 'Hồi 800 MP, hương sen tinh khiết, an thần.',
    kind: 'PILL_MP',
    quality: 'HUYEN',
    stackable: true,
    effect: { mp: 800 },
    price: 380,
  },
  {
    key: 'tien_van_dan',
    name: 'Tiên Vân Đan',
    description: 'Hồi 2500 MP, đan Tiên phẩm, hương vân tiên dịu nhẹ.',
    kind: 'PILL_MP',
    quality: 'TIEN',
    stackable: true,
    effect: { mp: 2500 },
    price: 1800,
  },

  // ----- Đan EXP bổ sung -----
  {
    key: 'so_huyen_dan',
    name: 'Sơ Huyền Đan',
    description: 'Tăng 200 EXP tu vi, dùng cho tân thủ luyện khí.',
    kind: 'PILL_EXP',
    quality: 'PHAM',
    stackable: true,
    effect: { exp: 200 },
    price: 80,
  },
  {
    key: 'cuu_thien_dan',
    name: 'Cửu Thiên Đan',
    description: 'Tăng 6000 EXP, đan Tiên phẩm cho mid-late game.',
    kind: 'PILL_EXP',
    quality: 'TIEN',
    stackable: true,
    effect: { exp: 6000 },
    price: 3500,
  },
  {
    key: 'nhan_tien_dan',
    name: 'Nhân Tiên Đan',
    description: 'Tăng 18000 EXP, đan Thần phẩm, hỗ trợ phá quan.',
    kind: 'PILL_EXP',
    quality: 'THAN',
    stackable: true,
    effect: { exp: 18000 },
    price: 9000,
  },

  // ----- Phase 14.3.B — Đan dược hỗ trợ vượt kiếp -----
  // Inventory items có `tribulationSupport` > 0 → surface trong supports[]
  // của tribulation preview (read-only). Chưa wire consume — Phase 14.3.B-W
  // sẽ thêm consume khi player confirm attempt. Cap per-entry cộng thêm
  // `0.10` (per-entry ceil) đảm bảo single pill không bypass tỉ lệ vượt kiếp.
  {
    key: 'thuan_kiep_dan',
    name: 'Thuận Kiếp Đan',
    description:
      'Đan dược hộ thân khi vượt kiếp — tăng 5% tỉ lệ thành công thiên kiếp. ' +
      'Ngậm trong miệng trước khi phi thăng, hương đan dịu nhẹ trợ tâm cảnh.',
    kind: 'PILL_HP',
    quality: 'HUYEN',
    stackable: true,
    bonuses: { tribulationSupport: 0.05 },
    effect: { hp: 200, buffKey: 'thuan_kiep_dan_aura' },
    price: 1500,
  },
  {
    key: 'tu_kiep_dan',
    name: 'Tử Kiếp Đan',
    description:
      'Đan dược tiên phẩm cứu mạng giữa thiên kiếp — tăng 8% tỉ lệ thành công ' +
      'thiên kiếp. Linh hồn hộ phù, vô cùng quý hiếm.',
    kind: 'PILL_HP',
    quality: 'TIEN',
    stackable: true,
    bonuses: { tribulationSupport: 0.08 },
    effect: { hp: 800 },
    price: 6000,
  },
  // ----- Phase 14.3.B — Hộ phù equipment hỗ trợ vượt kiếp -----
  // Equipment items có `tribulationSupport` (đeo ARTIFACT_2 slot) → surface
  // trong supports[] của tribulation preview nếu equippedSlot != null.
  {
    key: 'ho_kiep_phu',
    name: 'Hộ Kiếp Phù',
    description:
      'Phù lục cổ Tiên phẩm khắc trên ngọc lam, đeo bên hông trợ tâm cảnh ' +
      'vượt kiếp — tăng 6% tỉ lệ thành công thiên kiếp khi mang theo.',
    kind: 'ARTIFACT',
    quality: 'TIEN',
    stackable: false,
    slot: 'ARTIFACT_2',
    bonuses: { spirit: 12, tribulationSupport: 0.06 },
    price: 8500,
  },

  // ----- Nguyên liệu (ORE/herb/material) -----
  {
    key: 'linh_thao',
    name: 'Linh Thảo',
    description: 'Linh thảo trên dược điền, nguyên liệu sơ cấp luyện đan.',
    kind: 'ORE',
    quality: 'LINH',
    stackable: true,
    price: 35,
  },
  {
    key: 'tinh_thiet',
    name: 'Tinh Thiết',
    description: 'Khoáng tinh thiết nguyên cấp, nguyên liệu rèn vũ khí Linh phẩm.',
    kind: 'ORE',
    quality: 'LINH',
    stackable: true,
    price: 80,
  },
  {
    key: 'yeu_dan',
    name: 'Yêu Đan',
    description: 'Đan tinh hạch của yêu thú trung cấp, nguyên liệu Huyền phẩm.',
    kind: 'ORE',
    quality: 'HUYEN',
    stackable: true,
    price: 250,
  },
  {
    key: 'phu_van_ngoc',
    name: 'Phù Văn Ngọc',
    description: 'Ngọc khắc phù văn cổ, nguyên liệu chế phù lục Huyền phẩm.',
    kind: 'ORE',
    quality: 'HUYEN',
    stackable: true,
    price: 280,
  },
  {
    key: 'han_ngoc',
    name: 'Hàn Ngọc',
    description: 'Ngọc lạnh ngàn năm, nguyên liệu hiếm Tiên phẩm.',
    kind: 'ORE',
    quality: 'TIEN',
    stackable: true,
    price: 1200,
  },
  {
    key: 'tien_kim_sa',
    name: 'Tiên Kim Sa',
    description: 'Cát kim Tiên giới, nguyên liệu rèn Tiên khí.',
    kind: 'ORE',
    quality: 'TIEN',
    stackable: true,
    price: 1600,
  },
  {
    key: 'khi_huyet_thao',
    name: 'Khí Huyết Thảo',
    description: 'Linh thảo đỏ dùng luyện đan và đột phá Luyện Thể sơ cấp.',
    kind: 'ORE',
    quality: 'PHAM',
    stackable: true,
    price: 45,
  },
  {
    key: 'yeu_thu_huyet_tinh',
    name: 'Yêu Thú Huyết Tinh',
    description: 'Tinh huyết cô đặc của yêu thú, nguyên liệu Luyện Thể ổn định.',
    kind: 'ORE',
    quality: 'LINH',
    stackable: true,
    price: 120,
  },
  {
    key: 'doan_cot_thach',
    name: 'Đoán Cốt Thạch',
    description: 'Khoáng thạch tôi cốt, dùng cho cảnh Đoán Cốt và đan luyện thể.',
    kind: 'ORE',
    quality: 'LINH',
    stackable: true,
    price: 160,
  },
  {
    key: 'tay_tuy_dich',
    name: 'Tẩy Tủy Dịch',
    description: 'Linh dịch rửa tủy, nguyên liệu chủ đạo khi phá quan Tẩy Tủy.',
    kind: 'ORE',
    quality: 'HUYEN',
    stackable: true,
    price: 420,
  },
  {
    key: 'kim_than_tinh',
    name: 'Kim Thân Tinh',
    description: 'Tinh kim luyện thân, hỗ trợ đột phá Kim Cương Thân.',
    kind: 'ORE',
    quality: 'TIEN',
    stackable: true,
    price: 1100,
  },
  {
    key: 'bat_hoai_hon_thach',
    name: 'Bất Hoại Hồn Thạch',
    description: 'Hồn thạch tôi pháp thân, nguyên liệu quý cho Bất Hoại Pháp Thân.',
    kind: 'ORE',
    quality: 'THAN',
    stackable: true,
    price: 2600,
  },

  // ----- Phase 23.5 — Pháp Bảo Catalog (Advanced Artifact System) -----
  // Pháp bảo là slot riêng (ARTIFACT_1..3), không thuộc 8 trang bị chính.
  // Catalog metadata chi tiết (element/role/active/star/awaken) ở
  // `packages/shared/src/phap-bao.ts` (PHAP_BAO_CATALOG). Item entries dưới
  // đây cho phép pipeline equip / refine / shop / drop dùng nguyên
  // InventoryItem + RefineService đã có (Phase 11.5.B). Stat caps đã qua
  // `validatePhapBaoDefinition` và `validateItemBudget`.
  {
    key: 'ngu_hanh_linh_chau',
    name: 'Ngũ Hành Linh Châu',
    description:
      'Pháp bảo Linh phẩm dạng châu ngũ hành, dung hòa khí cơ — tăng tinh ' +
      'khí và sinh lực căn bản, hỗ trợ hồi phục theo thời gian.',
    kind: 'ARTIFACT',
    quality: 'LINH',
    stackable: false,
    slot: 'ARTIFACT_1',
    equipmentTier: 2,
    bonuses: { hpMax: 60, mpMax: 60, spirit: 8 },
    price: 480,
  },
  {
    key: 'thanh_lien_kiem_an',
    name: 'Thanh Liên Kiếm Ấn',
    description:
      'Ấn kiếm Huyền phẩm khắc thanh liên, kết tinh sát khí Kim hệ — kích ' +
      'hoạt một kiếm ý chém xuyên giáp địch.',
    kind: 'ARTIFACT',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARTIFACT_1',
    equipmentTier: 3,
    bonuses: { atk: 30, spirit: 12, elementalAtkBonus: { kim: 0.05 } },
    price: 1_400,
  },
  {
    key: 'huyen_thien_kinh',
    name: 'Huyền Thiên Kính',
    description:
      'Cổ kính Huyền phẩm phản chiếu thiên cơ, ngưng kết hàn khí Thủy hệ ' +
      '— đóng băng mục tiêu trong khoảnh khắc.',
    kind: 'ARTIFACT',
    quality: 'HUYEN',
    stackable: false,
    slot: 'ARTIFACT_2',
    equipmentTier: 4,
    bonuses: { def: 35, hpMax: 130, spirit: 18, elementalAtkBonus: { thuy: 0.04 } },
    price: 2_400,
  },
  {
    key: 'huyet_nguyet_ho_lo',
    name: 'Huyết Nguyệt Hồ Lô',
    description:
      'Hồ lô đỏ máu Tiên phẩm, ngưng tụ Hỏa khí ma đạo — gieo độc lửa ' +
      'thiêu đốt kẻ địch nhiều giây.',
    kind: 'ARTIFACT',
    quality: 'TIEN',
    stackable: false,
    slot: 'ARTIFACT_2',
    equipmentTier: 5,
    bonuses: { atk: 80, hpMax: 240, spirit: 30, elementalAtkBonus: { hoa: 0.06 } },
    price: 7_200,
  },
  {
    key: 'tho_linh_son_an',
    name: 'Thổ Linh Sơn Ấn',
    description:
      'Ấn núi Tiên phẩm khắc linh văn Thổ hệ, kết khiên đất kiên cố hấp ' +
      'thụ sát thương lớn trong vài giây.',
    kind: 'ARTIFACT',
    quality: 'TIEN',
    stackable: false,
    slot: 'ARTIFACT_3',
    equipmentTier: 5,
    bonuses: { def: 110, hpMax: 320, elementalAtkBonus: { tho: 0.05 } },
    price: 7_200,
  },
  {
    key: 'cuu_diem_phien',
    name: 'Cửu Diễm Phiến',
    description:
      'Quạt chín ngọn lửa cổ Tiên phẩm, tung quạt thiêu rụi diện rộng — ' +
      'một đòn bộc phát quét hàng quân yêu.',
    kind: 'ARTIFACT',
    quality: 'TIEN',
    stackable: false,
    slot: 'ARTIFACT_1',
    equipmentTier: 6,
    bonuses: { atk: 130, hpMax: 200, spirit: 40, elementalAtkBonus: { hoa: 0.07 } },
    price: 11_500,
  },
  {
    key: 'moc_linh_binh',
    name: 'Mộc Linh Bình',
    description:
      'Bình ngọc Tiên phẩm Mộc hệ chứa linh dịch, rưới nước cam lồ trị ' +
      'thương — hồi máu lớn và kéo dài hồi phục.',
    kind: 'ARTIFACT',
    quality: 'TIEN',
    stackable: false,
    slot: 'ARTIFACT_3',
    equipmentTier: 6,
    bonuses: { hpMax: 400, mpMax: 200, spirit: 35, elementalAtkBonus: { moc: 0.06 } },
    price: 11_500,
  },
  {
    key: 'bang_tam_ngoc_kinh',
    name: 'Băng Tâm Ngọc Kính',
    description:
      'Cổ kính ngọc lạnh Tiên phẩm Thủy hệ, soi ra hàn ảnh — làm chậm ' +
      'địch khu vực, thích hợp control mass mob.',
    kind: 'ARTIFACT',
    quality: 'TIEN',
    stackable: false,
    slot: 'ARTIFACT_2',
    equipmentTier: 7,
    bonuses: { def: 120, hpMax: 380, spirit: 55, elementalAtkBonus: { thuy: 0.07 } },
    price: 18_500,
  },
  {
    key: 'kim_quang_bao_luan',
    name: 'Kim Quang Bảo Luân',
    description:
      'Bánh xe vàng Thần phẩm xoay vần Kim quang — mở cửa sổ chí mạng + ' +
      'xuyên giáp ngắn nhưng cực mạnh.',
    kind: 'ARTIFACT',
    quality: 'THAN',
    stackable: false,
    slot: 'ARTIFACT_1',
    equipmentTier: 8,
    bonuses: { atk: 320, hpMax: 800, spirit: 110, elementalAtkBonus: { kim: 0.08 } },
    price: 36_000,
  },
  {
    key: 'hau_tho_tran_hon_an',
    name: 'Hậu Thổ Trấn Hồn Ấn',
    description:
      'Đại ấn Hậu Thổ cổ xưa Thần phẩm — phản đòn sát thương trong vài ' +
      'giây, áp chế kẻ phá hoại bằng kim cương cổ.',
    kind: 'ARTIFACT',
    quality: 'THAN',
    stackable: false,
    slot: 'ARTIFACT_3',
    equipmentTier: 10,
    bonuses: { def: 480, hpMax: 2400, spirit: 180, elementalAtkBonus: { tho: 0.08 } },
    price: 120_000,
  },

  // ----- Phase 23.5 — Pháp Bảo material (mảnh + thạch thức tỉnh) -----
  // Drop từ daily / event / boss; được tiêu hao ở `getPhapBaoStarUpCost`
  // và `getPhapBaoAwakenCost`. Phase 25.1 sẽ wire vào Battle Pass / Monthly
  // Card shop. **KHÔNG** bán mảnh max tier trực tiếp ở phase này.
  {
    key: 'phap_bao_shard',
    name: 'Mảnh Pháp Bảo',
    description:
      'Mảnh vỡ pháp bảo cổ chứa linh văn — nguyên liệu thăng sao pháp bảo. ' +
      'Drop từ daily / event / boss.',
    kind: 'ORE',
    quality: 'HUYEN',
    stackable: true,
    price: 600,
  },
  {
    key: 'awaken_stone',
    name: 'Thức Tỉnh Thạch',
    description:
      'Linh thạch chứa khí cơ thức tỉnh — nguyên liệu hiếm khai mở tiềm ' +
      'năng pháp bảo Tiên/Thần phẩm.',
    kind: 'ORE',
    quality: 'TIEN',
    stackable: true,
    price: 3_500,
  },

  // ----- Vật phẩm đặc biệt (MISC) -----
  // Lưu ý: MISC chưa có runtime hook (key dungeon, transport scroll
  // sẽ được wire ở Phase 10 PR-3 dungeon pack hoặc PR-4 mission pack).
  // Hiện tại stub catalog để pre-allocate stable key.
  {
    key: 'son_coc_yeu_phu',
    name: 'Sơn Cốc Yêu Phù',
    description: 'Phù lệnh vào Sơn Cốc bí cảnh — bản thử nghiệm closed beta.',
    kind: 'MISC',
    quality: 'PHAM',
    stackable: true,
    price: 100,
  },
  {
    key: 'hac_lam_yeu_phu',
    name: 'Hắc Lâm Yêu Phù',
    description: 'Phù lệnh vào Hắc Lâm bí cảnh, dành cho Trúc Cơ tu sĩ.',
    kind: 'MISC',
    quality: 'LINH',
    stackable: true,
    price: 250,
  },
  {
    key: 'yeu_thu_dong_phu',
    name: 'Yêu Thú Động Phù',
    description: 'Phù lệnh vào Yêu Thú Động, bí cảnh Kim Đan kỳ.',
    kind: 'MISC',
    quality: 'HUYEN',
    stackable: true,
    price: 600,
  },
  {
    key: 'tho_dia_phu',
    name: 'Thổ Địa Phù',
    description: 'Phù truyền tống về tông môn, hết khoá sau 1 lần dùng.',
    kind: 'MISC',
    quality: 'PHAM',
    stackable: true,
    price: 80,
  },
  {
    key: 'bao_an_phu',
    name: 'Bảo An Phù',
    description: 'Phù bảo hộ, miễn 1 lần sát thương trí mạng (planned hook).',
    kind: 'MISC',
    quality: 'LINH',
    stackable: true,
    price: 200,
  },

  // ----- Phase 10 PR-3 — Yêu phù cho dungeon Ngũ Hành mới -----
  // Stable key, stub PHẢI matching DUNGEONS.key (xem combat.ts). Hiện chưa wire
  // runtime check (DungeonRun service phase 11.5 sẽ enforce); catalog only.
  {
    key: 'kim_son_mach_phu',
    name: 'Kim Sơn Mạch Phù',
    description: 'Phù lệnh vào mỏ kim cổ — kim đan kỳ tu sĩ kiếm tinh thiết và kim ngọc.',
    kind: 'MISC',
    quality: 'HUYEN',
    stackable: true,
    price: 700,
  },
  {
    key: 'moc_huyen_lam_phu',
    name: 'Mộc Huyền Lâm Phù',
    description: 'Phù lệnh vào rừng cổ Mộc Huyền Lâm, dành cho Trúc Cơ tu sĩ luyện linh thảo.',
    kind: 'MISC',
    quality: 'LINH',
    stackable: true,
    price: 320,
  },
  {
    key: 'thuy_long_uyen_phu',
    name: 'Thuỷ Long Uyên Phù',
    description: 'Phù lệnh vào hồ sâu Thuỷ Long Uyên — Kim Đan kỳ luyện băng tinh và thuỷ ngọc.',
    kind: 'MISC',
    quality: 'HUYEN',
    stackable: true,
    price: 720,
  },
  {
    key: 'hoa_diem_son_phu',
    name: 'Hoả Diệm Sơn Phù',
    description: 'Phù lệnh vào núi lửa Hoả Diệm Sơn — Nguyên Anh kỳ luyện hoả tinh và Chu Tước trắc nghiệm.',
    kind: 'MISC',
    quality: 'TIEN',
    stackable: true,
    price: 1500,
  },
  {
    key: 'hoang_tho_huyet_phu',
    name: 'Hoàng Thổ Huyệt Phù',
    description: 'Phù lệnh vào huyệt thổ ngàn năm — Nguyên Anh kỳ luyện thổ ngọc và Thạch Long.',
    kind: 'MISC',
    quality: 'TIEN',
    stackable: true,
    price: 1450,
  },
  {
    key: 'cuu_la_dien_phu',
    name: 'Cửu La Điện Phù',
    description: 'Phù lệnh vào điện ma đạo Cửu La — Nguyên Anh đỉnh thử nghiệm tâm cảnh, hiếm.',
    kind: 'MISC',
    quality: 'THAN',
    stackable: true,
    price: 3200,
  },

  // ----- Phase 11.5.B Refine MVP runtime — protection charm -----
  // Consume khi refine fail ở stage `risky` / `extreme` (no-break path) để
  // ngăn level-loss. KHÔNG cứu được break ở extreme stage. Server-authoritative
  // qua `RefineService.refineEquipment(useProtection=true)`.
  {
    key: 'refine_protection_charm',
    name: 'Hộ Khí Phù',
    description: 'Phù bảo hộ luyện khí — miễn 1 lần rớt cấp khi refine fail. Không cứu được break ở extreme stage.',
    kind: 'MISC',
    quality: 'HUYEN',
    stackable: true,
    price: 500,
  },

  // ─────────────────────────────────────────────────────────────────────
  // Phase 11.2.D — Skill Book Pack 1 (Ngũ Hành sơ cấp, +5 entries)
  //
  // Mục tiêu: cho player nguồn rare để học 5 skill basic-tier theo Ngũ
  // Hành (Kim/Mộc/Thủy/Hỏa/Thổ) thay vì chỉ tự học khi đủ realm.
  // Mỗi book trỏ tới đúng 1 `SkillTemplate.key`. Quality LINH (price 1500
  // LT) — thấp hơn `linh_can_dan` (TIEN, 5000 LT) vì skill basic re-roll
  // ít quan trọng hơn linh căn.
  //
  // Server-authoritative consume: `POST /character/skill/learn-from-book
  // { inventoryItemId }` → `CharacterSkillService.learnFromBook` validate
  // unlocks (realm/sect/method) → `learn(skillKey, source='item_consume')`
  // idempotent qua P2002 → ALREADY_LEARNED. ItemLedger `SKILL_LEARN`
  // qtyDelta=-1 atomic cùng InventoryItem decrement.
  //
  // Drop sourcing (Phase 11.2.D+++ wired catalog only):
  //   - DUNGEON_LOOT 5 dungeon Ngũ Hành (kim_son_mach / moc_huyen_lam /
  //     thuy_long_uyen / hoa_diem_son / hoang_tho_huyet) match element,
  //     weight 3 (rare ~5% per default 2-roll run).
  //   - boss.lowDropPool tier ≥ Trúc Cơ match element (kim/moc/thuy/hoa/tho)
  //     + cross-element world boss endgame có cả 5 book (Phase 12 pity).
  // Lưu ý: DUNGEON_LOOT chưa wire vào reward path runtime (Phase 11.3.D+++
  // sẽ wire qua DungeonRunService); lowDropPool catalog metadata thuần
  // (Phase 12 BossRewardService sẽ wire share-ratio).
  // ─────────────────────────────────────────────────────────────────────
  {
    key: 'skill_book_kim_quang_tram',
    name: 'Bí Kíp: Kim Quang Trảm',
    description: 'Trục giấy linh ghi lại tâm pháp Kim Quang Trảm — đọc xong tan biến. Hệ Kim, sơ cấp.',
    kind: 'SKILL_BOOK',
    quality: 'LINH',
    stackable: true,
    skillBook: { skillKey: 'kim_quang_tram' },
    price: 1500,
  },
  {
    key: 'skill_book_moc_linh_truong_dieu',
    name: 'Bí Kíp: Mộc Linh Trượng Diệu',
    description: 'Trục gỗ thanh môn ghi pháp tiêu Mộc Linh Trượng Diệu — đọc xong tan biến. Hệ Mộc, sơ cấp.',
    kind: 'SKILL_BOOK',
    quality: 'LINH',
    stackable: true,
    skillBook: { skillKey: 'moc_linh_truong_dieu' },
    price: 1500,
  },
  {
    key: 'skill_book_thuy_kinh_phong_an',
    name: 'Bí Kíp: Thủy Kính Phong Ấn',
    description: 'Quyển ngọc băng thấu ghi tâm pháp Thủy Kính Phong Ấn — đọc xong tan biến. Hệ Thủy, sơ cấp.',
    kind: 'SKILL_BOOK',
    quality: 'LINH',
    stackable: true,
    skillBook: { skillKey: 'thuy_kinh_phong_an' },
    price: 1500,
  },
  {
    key: 'skill_book_hoa_xa_phun_diem',
    name: 'Bí Kíp: Hỏa Xà Phun Diệm',
    description: 'Trục đồng đỏ ghi pháp quyết Hỏa Xà Phun Diệm — đọc xong tan biến. Hệ Hỏa, sơ cấp.',
    kind: 'SKILL_BOOK',
    quality: 'LINH',
    stackable: true,
    skillBook: { skillKey: 'hoa_xa_phun_diem' },
    price: 1500,
  },
  {
    key: 'skill_book_thach_giap_ho_than',
    name: 'Bí Kíp: Thạch Giáp Hộ Thân',
    description: 'Trục đá thổ ghi pháp môn phòng ngự Thạch Giáp Hộ Thân — đọc xong tan biến. Hệ Thổ, sơ cấp.',
    kind: 'SKILL_BOOK',
    quality: 'LINH',
    stackable: true,
    skillBook: { skillKey: 'thach_giap_ho_than' },
    price: 1500,
  },
];

const ALCHEMY_TIER_QUALITY: Record<number, Quality> = {
  1: 'PHAM',
  2: 'LINH',
  3: 'HUYEN',
  4: 'TIEN',
  5: 'THAN',
  6: 'THAN',
  7: 'THAN',
  8: 'THAN',
  9: 'THAN',
};

const ALCHEMY_PILL_SPECS: Array<{
  key: string;
  name: string;
  tier: number;
  category: PillCategory;
  effect: ItemEffect;
  targetRealmOrder?: number;
  price: number;
  marketTradeable?: boolean;
}> = [
  { key: 'tieu_phuc_dan_t1', name: 'Tiểu Phục Đan', tier: 1, category: 'HEAL_HP', effect: { hp: 35 }, targetRealmOrder: 1, price: 25 },
  { key: 'linh_tinh_dan_t1', name: 'Linh Tinh Đan', tier: 1, category: 'HEAL_MP', effect: { mp: 30 }, targetRealmOrder: 1, price: 25 },
  { key: 'so_huyen_dan_t1', name: 'Sơ Huyền Đan', tier: 1, category: 'QI_EXP', effect: { exp: 180 }, targetRealmOrder: 1, price: 70 },
  { key: 'khi_huyet_dan_t1', name: 'Khí Huyết Đan', tier: 1, category: 'BODY_EXP', effect: { bodyExp: 90 }, targetRealmOrder: 1, price: 90 },
  { key: 'cuong_gan_dan_t1', name: 'Cường Gân Đan', tier: 1, category: 'HEAL_STAMINA', effect: { stamina: 18, bodyExp: 50 }, targetRealmOrder: 1, price: 80 },
  { key: 'duong_than_tan_t1', name: 'Dưỡng Thân Tán', tier: 1, category: 'INJURY_CURE', effect: { bodyInjuryReductionMinutes: 10 }, targetRealmOrder: 1, price: 90 },
  { key: 'tu_khi_dan_t1', name: 'Tụ Khí Đan', tier: 1, category: 'QI_EXP', effect: { exp: 120, cultivationRateBonusPct: 3 }, targetRealmOrder: 1, price: 85 },
  { key: 'thanh_lam_dan_t2', name: 'Thanh Lam Đan', tier: 2, category: 'HEAL_HP', effect: { hp: 200 }, targetRealmOrder: 2, price: 160 },
  { key: 'hoi_nguyen_dan_t2', name: 'Hồi Nguyên Đan', tier: 2, category: 'HEAL_MP', effect: { mp: 220 }, targetRealmOrder: 2, price: 180 },
  { key: 'co_thien_dan_t2', name: 'Cổ Thiên Đan', tier: 2, category: 'QI_EXP', effect: { exp: 450 }, targetRealmOrder: 2, price: 250 },
  { key: 'cuong_cot_dan_t2', name: 'Cường Cốt Đan', tier: 2, category: 'BODY_EXP', effect: { bodyExp: 280 }, targetRealmOrder: 2, price: 240 },
  { key: 'truc_co_ho_mach_dan_t2', name: 'Trúc Cơ Hộ Mạch Đan', tier: 2, category: 'QI_BREAKTHROUGH', effect: { qiBreakthroughBonus: 0.04 }, targetRealmOrder: 2, price: 420, marketTradeable: false },
  { key: 'doan_cot_pha_quan_dan_t2', name: 'Đoán Cốt Phá Quan Đan', tier: 2, category: 'BODY_BREAKTHROUGH', effect: { bodyBreakthroughBonus: 0.04 }, targetRealmOrder: 2, price: 520, marketTradeable: false },
  { key: 'huyet_luc_dan_t2', name: 'Huyết Lực Đan', tier: 2, category: 'COMBAT_BUFF', effect: { buffKey: 'buff_pill_huyet_luc' }, targetRealmOrder: 2, price: 350 },
  { key: 'cuu_huyen_dan_t3', name: 'Cửu Huyền Đan', tier: 3, category: 'HEAL_HP', effect: { hp: 600 }, targetRealmOrder: 3, price: 700 },
  { key: 'ngoc_lien_dan_t3', name: 'Ngọc Liên Đan', tier: 3, category: 'HEAL_MP', effect: { mp: 800 }, targetRealmOrder: 3, price: 760 },
  { key: 'van_linh_dan_t3', name: 'Vạn Linh Đan', tier: 3, category: 'QI_EXP', effect: { exp: 1400 }, targetRealmOrder: 3, price: 1200 },
  { key: 'tay_tuy_dan_t3', name: 'Tẩy Tủy Đan', tier: 3, category: 'BODY_BREAKTHROUGH', effect: { bodyBreakthroughBonus: 0.06 }, targetRealmOrder: 3, price: 900, marketTradeable: false },
  { key: 'kim_tuy_dan_t3', name: 'Kim Tủy Đan', tier: 3, category: 'BODY_EXP', effect: { bodyExp: 800 }, targetRealmOrder: 3, price: 900 },
  { key: 'kim_dan_ho_tam_dan_t3', name: 'Kim Đan Hộ Tâm Đan', tier: 3, category: 'QI_BREAKTHROUGH', effect: { qiBreakthroughBonus: 0.06 }, targetRealmOrder: 3, price: 1500, marketTradeable: false },
  { key: 'thanh_tam_dan_t3', name: 'Thanh Tâm Đan', tier: 3, category: 'INJURY_CURE', effect: { taoMaReductionMinutes: 20, bodyInjuryReductionMinutes: 15 }, targetRealmOrder: 3, price: 1000 },
  { key: 'anh_nguyen_dan_t4', name: 'Anh Nguyên Đan', tier: 4, category: 'QI_EXP', effect: { exp: 3000 }, targetRealmOrder: 4, price: 3200 },
  { key: 'huyen_menh_dan_t4', name: 'Huyền Mệnh Đan', tier: 4, category: 'MIXED_RECOVERY', effect: { hp: 900, mp: 650, stamina: 35 }, targetRealmOrder: 4, price: 2800 },
  { key: 'kim_than_dan_t4', name: 'Kim Thân Đan', tier: 4, category: 'BODY_BREAKTHROUGH', effect: { bodyBreakthroughBonus: 0.07 }, targetRealmOrder: 4, price: 1800, marketTradeable: false },
  { key: 'ngoc_cot_dan_t4', name: 'Ngọc Cốt Đan', tier: 4, category: 'BODY_EXP', effect: { bodyExp: 1600 }, targetRealmOrder: 4, price: 2300 },
  { key: 'nguyen_anh_ho_than_dan_t4', name: 'Nguyên Anh Hộ Thần Đan', tier: 4, category: 'QI_BREAKTHROUGH', effect: { qiBreakthroughBonus: 0.07 }, targetRealmOrder: 4, price: 3800, marketTradeable: false },
  { key: 'kim_cuong_ho_the_dan_t4', name: 'Kim Cương Hộ Thể Đan', tier: 4, category: 'INJURY_CURE', effect: { bodyBreakthroughBonus: 0.05, bodyInjuryReductionMinutes: 30 }, targetRealmOrder: 4, price: 3400, marketTradeable: false },
  { key: 'than_niem_dan_t4', name: 'Thần Niệm Đan', tier: 4, category: 'COMBAT_BUFF', effect: { buffKey: 'buff_pill_than_niem' }, targetRealmOrder: 4, price: 3200 },
  { key: 'hu_linh_dan_t5', name: 'Hư Linh Đan', tier: 5, category: 'QI_EXP', effect: { exp: 6500 }, targetRealmOrder: 6, price: 9000 },
  { key: 'can_khon_dan_t5', name: 'Càn Khôn Đan', tier: 5, category: 'COMBAT_BUFF', effect: { buffKey: 'buff_pill_can_khon' }, targetRealmOrder: 6, price: 10500 },
  { key: 'bat_hoai_dan_t5', name: 'Bất Hoại Đan', tier: 5, category: 'BODY_BREAKTHROUGH', effect: { bodyBreakthroughBonus: 0.08 }, targetRealmOrder: 6, price: 12000, marketTradeable: false },
  { key: 'long_huyet_dan_t5', name: 'Long Huyết Đan', tier: 5, category: 'BODY_EXP', effect: { bodyExp: 3600 }, targetRealmOrder: 6, price: 10000 },
  { key: 'dai_thua_ho_dao_dan_t5', name: 'Đại Thừa Hộ Đạo Đan', tier: 5, category: 'QI_BREAKTHROUGH', effect: { qiBreakthroughBonus: 0.08 }, targetRealmOrder: 8, price: 14000, marketTradeable: false },
  { key: 'bat_hoai_ho_mach_dan_t5', name: 'Bất Hoại Hộ Mạch Đan', tier: 5, category: 'INJURY_CURE', effect: { bodyBreakthroughBonus: 0.05, bodyInjuryReductionMinutes: 45 }, targetRealmOrder: 6, price: 13000, marketTradeable: false },
  { key: 'tinh_hon_dan_t5', name: 'Tĩnh Hồn Đan', tier: 5, category: 'INJURY_CURE', effect: { taoMaReductionMinutes: 45 }, targetRealmOrder: 7, price: 9500 },
  { key: 'nhan_tien_dan_t6', name: 'Nhân Tiên Đan', tier: 6, category: 'QI_EXP', effect: { exp: 12000 }, targetRealmOrder: 10, price: 22000 },
  { key: 'kiep_loi_ho_menh_dan_t6', name: 'Kiếp Lôi Hộ Mệnh Đan', tier: 6, category: 'TRIBULATION_SUPPORT', effect: { tribulationSupport: 0.06 }, targetRealmOrder: 9, price: 28000, marketTradeable: false },
  { key: 'tien_phach_dan_t6', name: 'Tiên Phách Đan', tier: 6, category: 'HEAL_HP', effect: { hp: 2500 }, targetRealmOrder: 10, price: 16000 },
  { key: 'tien_van_dan_t6', name: 'Tiên Vân Đan', tier: 6, category: 'HEAL_MP', effect: { mp: 2500 }, targetRealmOrder: 10, price: 16000 },
  { key: 'long_tuong_dan_t6', name: 'Long Tượng Đan', tier: 6, category: 'BODY_EXP', effect: { bodyExp: 7600 }, targetRealmOrder: 10, price: 24000 },
  { key: 'tien_cot_dan_t6', name: 'Tiên Cốt Đan', tier: 6, category: 'BODY_BREAKTHROUGH', effect: { bodyBreakthroughBonus: 0.09 }, targetRealmOrder: 10, price: 30000, marketTradeable: false },
  { key: 'niet_ban_dan_t6', name: 'Niết Bàn Đan', tier: 6, category: 'SPECIAL', effect: { bodyInjuryReductionMinutes: 60, taoMaReductionMinutes: 60 }, targetRealmOrder: 10, price: 34000, marketTradeable: false },
  { key: 'huyen_tien_dao_dan_t7', name: 'Huyền Tiên Đạo Đan', tier: 7, category: 'QI_EXP', effect: { exp: 26000 }, targetRealmOrder: 13, price: 52000 },
  { key: 'kim_tien_ngoc_dich_t7', name: 'Kim Tiên Ngọc Dịch', tier: 7, category: 'MIXED_RECOVERY', effect: { hp: 4200, mp: 4200, stamina: 70 }, targetRealmOrder: 14, price: 48000 },
  { key: 'thai_at_tu_linh_dan_t7', name: 'Thái Ất Tụ Linh Đan', tier: 7, category: 'QI_EXP', effect: { exp: 22000, cultivationRateBonusPct: 5 }, targetRealmOrder: 15, price: 56000 },
  { key: 'dai_la_kim_than_dan_t7', name: 'Đại La Kim Thân Đan', tier: 7, category: 'BODY_EXP', effect: { bodyExp: 15000 }, targetRealmOrder: 16, price: 58000 },
  { key: 'hon_nguyen_the_dan_t7', name: 'Hỗn Nguyên Thể Đan', tier: 7, category: 'BODY_BREAKTHROUGH', effect: { bodyBreakthroughBonus: 0.1 }, targetRealmOrder: 16, price: 70000, marketTradeable: false },
  { key: 'kim_tien_ho_dao_dan_t7', name: 'Kim Tiên Hộ Đạo Đan', tier: 7, category: 'QI_BREAKTHROUGH', effect: { qiBreakthroughBonus: 0.1 }, targetRealmOrder: 14, price: 76000, marketTradeable: false },
  { key: 'ngu_hanh_quy_nguyen_dan_t7', name: 'Ngũ Hành Quy Nguyên Đan', tier: 7, category: 'COMBAT_BUFF', effect: { elementalResistBonus: { kim: 0.03, moc: 0.03, thuy: 0.03, hoa: 0.03, tho: 0.03 } }, targetRealmOrder: 15, price: 72000 },
  { key: 'chuan_thanh_dao_dan_t8', name: 'Chuẩn Thánh Đạo Đan', tier: 8, category: 'QI_EXP', effect: { exp: 54000 }, targetRealmOrder: 17, price: 130000 },
  { key: 'thanh_nhan_huyet_dan_t8', name: 'Thánh Nhân Huyết Đan', tier: 8, category: 'BODY_EXP', effect: { bodyExp: 32000 }, targetRealmOrder: 18, price: 150000 },
  { key: 'dao_quan_tu_nguyen_dan_t8', name: 'Đạo Quân Tụ Nguyên Đan', tier: 8, category: 'QI_EXP', effect: { exp: 46000, cultivationRateBonusPct: 6 }, targetRealmOrder: 20, price: 160000 },
  { key: 'hon_nguyen_bat_diet_dan_t8', name: 'Hỗn Nguyên Bất Diệt Đan', tier: 8, category: 'BODY_BREAKTHROUGH', effect: { bodyBreakthroughBonus: 0.11 }, targetRealmOrder: 19, price: 190000, marketTradeable: false },
  { key: 'thien_dao_ho_than_dan_t8', name: 'Thiên Đạo Hộ Thân Đan', tier: 8, category: 'TRIBULATION_SUPPORT', effect: { tribulationSupport: 0.08 }, targetRealmOrder: 21, price: 180000, marketTradeable: false },
  { key: 'van_phap_thanh_tam_dan_t8', name: 'Vạn Pháp Thanh Tâm Đan', tier: 8, category: 'INJURY_CURE', effect: { taoMaReductionMinutes: 90, bodyInjuryReductionMinutes: 90 }, targetRealmOrder: 18, price: 170000 },
  { key: 'dao_van_dan_t8', name: 'Đạo Văn Đan', tier: 8, category: 'SPECIAL', effect: { buffKey: 'buff_pill_dao_van' }, targetRealmOrder: 20, price: 220000, marketTradeable: false },
  { key: 'thien_dao_dan_t9', name: 'Thiên Đạo Đan', tier: 9, category: 'QI_EXP', effect: { exp: 120000 }, targetRealmOrder: 21, price: 360000, marketTradeable: false },
  { key: 'ban_nguyen_dan_t9', name: 'Bản Nguyên Đan', tier: 9, category: 'QI_BREAKTHROUGH', effect: { qiBreakthroughBonus: 0.12 }, targetRealmOrder: 22, price: 420000, marketTradeable: false },
  { key: 'vo_thuy_dao_dan_t9', name: 'Vô Thủy Đạo Đan', tier: 9, category: 'QI_EXP', effect: { exp: 100000, cultivationRateBonusPct: 7 }, targetRealmOrder: 24, price: 460000, marketTradeable: false },
  { key: 'vo_chung_bat_diet_dan_t9', name: 'Vô Chung Bất Diệt Đan', tier: 9, category: 'BODY_EXP', effect: { bodyExp: 76000 }, targetRealmOrder: 25, price: 480000, marketTradeable: false },
  { key: 'vinh_hang_chan_than_dan_t9', name: 'Vĩnh Hằng Chân Thân Đan', tier: 9, category: 'BODY_BREAKTHROUGH', effect: { bodyBreakthroughBonus: 0.12 }, targetRealmOrder: 26, price: 560000, marketTradeable: false },
  { key: 'hu_khong_chi_ton_dan_t9', name: 'Hư Không Chí Tôn Đan', tier: 9, category: 'SPECIAL', effect: { qiBreakthroughBonus: 0.08, tribulationSupport: 0.08 }, targetRealmOrder: 27, price: 620000, marketTradeable: false },
  { key: 'dai_dao_niet_ban_dan_t9', name: 'Đại Đạo Niết Bàn Đan', tier: 9, category: 'SPECIAL', effect: { bodyInjuryReductionMinutes: 120, taoMaReductionMinutes: 120 }, targetRealmOrder: 27, price: 680000, marketTradeable: false },
];

const ALCHEMY_MATERIAL_SPECS: Array<{
  key: string;
  name: string;
  tier: number;
  category: MaterialCategory;
  sourceHint: SourceHint[];
  element?: ElementKey | null;
  price: number;
}> = [
  ['linh_thao_t1', 'Linh Thảo', 1, 'ALCHEMY_QI', ['NORMAL_MONSTER', 'DUNGEON'], null, 18],
  ['tinh_thuy_lo_t1', 'Tinh Thủy Lộ', 1, 'ALCHEMY_QI', ['NORMAL_MONSTER', 'DUNGEON'], 'thuy', 22],
  ['khi_huyet_thao_t1', 'Khí Huyết Thảo', 1, 'ALCHEMY_BODY', ['NORMAL_MONSTER', 'BODY_DUNGEON'], null, 32],
  ['huyet_tinh_nho_t1', 'Huyết Tinh Nhỏ', 1, 'ALCHEMY_BODY', ['ELITE', 'BODY_DUNGEON'], null, 45],
  ['thu_gan_vun_t1', 'Thú Gân Vụn', 1, 'ALCHEMY_BODY', ['NORMAL_MONSTER', 'ELITE'], null, 35],
  ['bot_dan_sa_t1', 'Bột Đan Sa', 1, 'GENERAL', ['NPC_SHOP', 'DUNGEON'], 'hoa', 28],
  ['truc_tam_thao_t2', 'Trúc Tâm Thảo', 2, 'ALCHEMY_QI', ['ELITE', 'DUNGEON'], 'moc', 90],
  ['han_lo_hoa_t2', 'Hàn Lộ Hoa', 2, 'ALCHEMY_QI', ['DUNGEON', 'BOSS'], 'thuy', 110],
  ['yeu_dan_non_t2', 'Yêu Đan Non', 2, 'QI_BREAKTHROUGH', ['ELITE', 'BOSS'], null, 180],
  ['doan_cot_thach_t2', 'Đoán Cốt Thạch', 2, 'BODY_BREAKTHROUGH', ['BODY_DUNGEON', 'BOSS'], 'tho', 220],
  ['yeu_thu_huyet_tinh_t2', 'Yêu Thú Huyết Tinh', 2, 'ALCHEMY_BODY', ['ELITE', 'BODY_DUNGEON'], null, 170],
  ['huyet_tuy_t2', 'Huyết Tủy', 2, 'ALCHEMY_BODY', ['BOSS', 'BODY_DUNGEON'], null, 240],
  ['moc_linh_qua_t2', 'Mộc Linh Quả', 2, 'ALCHEMY_QI', ['DUNGEON', 'QUEST'], 'moc', 150],
  ['kim_lien_tu_t3', 'Kim Liên Tử', 3, 'ALCHEMY_QI', ['DUNGEON', 'BOSS'], 'kim', 420],
  ['yeu_dan_t3', 'Yêu Đan', 3, 'QI_BREAKTHROUGH', ['BOSS', 'DUNGEON'], null, 520],
  ['ngoc_lien_tu_t3', 'Ngọc Liên Tử', 3, 'ALCHEMY_QI', ['DUNGEON'], 'thuy', 430],
  ['tinh_thiet_t3', 'Tinh Thiết', 3, 'EQUIPMENT_CRAFT', ['ELITE', 'DUNGEON'], 'kim', 360],
  ['tay_tuy_dich_t3', 'Tẩy Tủy Dịch', 3, 'BODY_BREAKTHROUGH', ['BODY_DUNGEON', 'BOSS'], null, 650],
  ['kim_tuy_dich_t3', 'Kim Tủy Dịch', 3, 'ALCHEMY_BODY', ['BODY_DUNGEON', 'BOSS'], 'kim', 700],
  ['hon_tinh_nho_t3', 'Hồn Tinh Nhỏ', 3, 'TRIBULATION', ['BOSS', 'DUNGEON'], null, 720],
  ['thanh_tam_thao_t3', 'Thanh Tâm Thảo', 3, 'TRIBULATION', ['DUNGEON', 'QUEST'], 'moc', 500],
  ['anh_nguyen_hoa_t4', 'Anh Nguyên Hoa', 4, 'ALCHEMY_QI', ['BOSS', 'DUNGEON'], 'hoa', 1200],
  ['hon_tinh_t4', 'Hồn Tinh', 4, 'TRIBULATION', ['BOSS', 'DUNGEON'], null, 1500],
  ['huyen_bang_ngoc_t4', 'Huyền Băng Ngọc', 4, 'ALCHEMY_QI', ['DUNGEON', 'BOSS'], 'thuy', 1350],
  ['huyet_tuy_t4', 'Huyết Tủy', 4, 'ALCHEMY_BODY', ['BODY_DUNGEON', 'BOSS'], null, 1600],
  ['kim_than_tinh_t4', 'Kim Thân Tinh', 4, 'BODY_BREAKTHROUGH', ['BODY_DUNGEON', 'BOSS'], 'kim', 1800],
  ['ngoc_cot_phan_t4', 'Ngọc Cốt Phấn', 4, 'ALCHEMY_BODY', ['BODY_DUNGEON'], 'tho', 1500],
  ['linh_chi_t4', 'Linh Chi', 4, 'ALCHEMY_QI', ['DUNGEON', 'QUEST'], 'moc', 1100],
  ['hu_khong_sa_t5', 'Hư Không Sa', 5, 'ALCHEMY_QI', ['BOSS', 'DUNGEON'], null, 3000],
  ['linh_hon_sa_t5', 'Linh Hồn Sa', 5, 'TRIBULATION', ['BOSS'], null, 3600],
  ['can_khon_tuy_t5', 'Càn Khôn Tủy', 5, 'COMBAT_BUFF', ['BOSS', 'DUNGEON'], null, 3900],
  ['ngu_hanh_tinh_phan_t5', 'Ngũ Hành Tinh Phấn', 5, 'ARTIFACT_CRAFT', ['BOSS'], null, 5200],
  ['bat_hoai_hon_thach_t5', 'Bất Hoại Hồn Thạch', 5, 'BODY_BREAKTHROUGH', ['BODY_DUNGEON', 'BOSS'], null, 5200],
  ['kim_than_tinh_t5', 'Kim Thân Tinh', 5, 'ALCHEMY_BODY', ['BODY_DUNGEON'], 'kim', 4200],
  ['long_huyet_tinh_t5', 'Long Huyết Tinh', 5, 'ALCHEMY_BODY', ['BOSS', 'WORLD_BOSS'], null, 6200],
  ['yeu_dan_cao_cap_t5', 'Yêu Đan Cao Cấp', 5, 'QI_BREAKTHROUGH', ['BOSS'], null, 5600],
  ['bo_de_diep_t5', 'Bồ Đề Diệp', 5, 'ALCHEMY_QI', ['QUEST', 'DUNGEON'], 'moc', 4400],
  ['dao_van_thach_t5', 'Đạo Văn Thạch', 5, 'ARTIFACT_CRAFT', ['BOSS', 'WORLD_BOSS'], null, 9000],
  ['tien_linh_tuy_t6', 'Tiên Linh Tủy', 6, 'ALCHEMY_QI', ['BOSS', 'DUNGEON'], null, 9000],
  ['han_ngoc_t6', 'Hàn Ngọc', 6, 'ALCHEMY_QI', ['DUNGEON', 'BOSS'], 'thuy', 8000],
  ['kiep_loi_tinh_t6', 'Kiếp Lôi Tinh', 6, 'TRIBULATION', ['BOSS', 'WORLD_BOSS'], null, 13000],
  ['thien_dao_tan_phien_t6', 'Thiên Đạo Tàn Phiến', 6, 'ARTIFACT_CRAFT', ['WORLD_BOSS'], null, 18000],
  ['tien_phach_hoa_t6', 'Tiên Phách Hoa', 6, 'ALCHEMY_QI', ['DUNGEON', 'BOSS'], 'hoa', 9000],
  ['tien_van_lo_t6', 'Tiên Vân Lộ', 6, 'ALCHEMY_QI', ['DUNGEON'], 'thuy', 8800],
  ['tien_kim_sa_t6', 'Tiên Kim Sa', 6, 'EQUIPMENT_CRAFT', ['DUNGEON', 'BOSS'], 'kim', 9400],
  ['long_cot_t6', 'Long Cốt', 6, 'ALCHEMY_BODY', ['BOSS', 'BODY_DUNGEON'], null, 12500],
  ['tien_cot_phan_t6', 'Tiên Cốt Phấn', 6, 'BODY_BREAKTHROUGH', ['BODY_DUNGEON', 'BOSS'], null, 14000],
  ['niet_ban_huyet_t6', 'Niết Bàn Huyết', 6, 'TRIBULATION', ['WORLD_BOSS', 'EVENT'], null, 20000],
  ['huyen_tien_dao_hoa_t7', 'Huyền Tiên Đạo Hoa', 7, 'ALCHEMY_QI', ['BOSS', 'DUNGEON'], null, 26000],
  ['kim_tien_ngoc_dich_t7_material', 'Kim Tiên Ngọc Dịch', 7, 'ALCHEMY_QI', ['DUNGEON', 'BOSS'], 'thuy', 28000],
  ['thai_at_linh_tuy_t7', 'Thái Ất Linh Tủy', 7, 'QI_BREAKTHROUGH', ['BOSS'], null, 34000],
  ['dai_la_kim_tuy_t7', 'Đại La Kim Tủy', 7, 'ALCHEMY_BODY', ['BODY_DUNGEON', 'BOSS'], 'kim', 36000],
  ['long_tuong_huyet_t7', 'Long Tượng Huyết', 7, 'ALCHEMY_BODY', ['BOSS', 'WORLD_BOSS'], null, 42000],
  ['hon_nguyen_linh_chau_t7', 'Hỗn Nguyên Linh Châu', 7, 'BODY_BREAKTHROUGH', ['WORLD_BOSS', 'BOSS'], null, 52000],
  ['kim_tien_dao_van_t7', 'Kim Tiên Đạo Văn', 7, 'QI_BREAKTHROUGH', ['BOSS'], 'kim', 46000],
  ['ngu_hanh_tinh_phan_t7', 'Ngũ Hành Tinh Phấn', 7, 'ARTIFACT_CRAFT', ['WORLD_BOSS'], null, 70000],
  ['chuan_thanh_dao_qua_t8', 'Chuẩn Thánh Đạo Quả', 8, 'ALCHEMY_QI', ['WORLD_BOSS', 'DUNGEON'], null, 90000],
  ['thanh_huyet_tinh_t8', 'Thánh Huyết Tinh', 8, 'ALCHEMY_BODY', ['WORLD_BOSS', 'BODY_DUNGEON'], null, 105000],
  ['dao_quan_nguyen_tuy_t8', 'Đạo Quân Nguyên Tủy', 8, 'QI_BREAKTHROUGH', ['WORLD_BOSS'], null, 120000],
  ['hon_nguyen_linh_chau_t8', 'Hỗn Nguyên Linh Châu', 8, 'BODY_BREAKTHROUGH', ['WORLD_BOSS'], null, 140000],
  ['thien_dao_tan_phien_t8', 'Thiên Đạo Tàn Phiến', 8, 'ARTIFACT_CRAFT', ['WORLD_BOSS'], null, 180000],
  ['van_phap_thanh_lien_t8', 'Vạn Pháp Thanh Liên', 8, 'TRIBULATION', ['DUNGEON', 'EVENT'], 'moc', 110000],
  ['dao_van_thach_t8', 'Đạo Văn Thạch', 8, 'ARTIFACT_CRAFT', ['WORLD_BOSS'], null, 220000],
  ['thien_dao_tan_phien_t9', 'Thiên Đạo Tàn Phiến', 9, 'ARTIFACT_CRAFT', ['WORLD_BOSS', 'EVENT'], null, 360000],
  ['ban_nguyen_tuy_t9', 'Bản Nguyên Tủy', 9, 'QI_BREAKTHROUGH', ['WORLD_BOSS'], null, 420000],
  ['ban_nguyen_thanh_thai_tinh_t9', 'Bản Nguyên Thánh Thai Tinh', 9, 'BODY_BREAKTHROUGH', ['WORLD_BOSS'], null, 460000],
  ['vo_thuy_dao_tuc_t9', 'Vô Thủy Đạo Tức', 9, 'ALCHEMY_QI', ['WORLD_BOSS'], null, 500000],
  ['vo_chung_huyet_tuy_t9', 'Vô Chung Huyết Tủy', 9, 'ALCHEMY_BODY', ['WORLD_BOSS'], null, 520000],
  ['vinh_hang_tuy_t9', 'Vĩnh Hằng Tủy', 9, 'BODY_BREAKTHROUGH', ['WORLD_BOSS'], null, 600000],
  ['hu_khong_nguyen_tinh_t9', 'Hư Không Nguyên Tinh', 9, 'ARTIFACT_CRAFT', ['WORLD_BOSS'], null, 720000],
  ['dai_dao_tan_hoa_t9', 'Đại Đạo Tàn Hỏa', 9, 'TRIBULATION', ['WORLD_BOSS', 'EVENT'], 'hoa', 680000],
  ['niet_ban_huyet_t9', 'Niết Bàn Huyết', 9, 'TRIBULATION', ['WORLD_BOSS', 'EVENT'], null, 760000],
].map(([key, name, tier, category, sourceHint, element, price]) => ({
  key,
  name,
  tier,
  category,
  sourceHint,
  element,
  price,
})) as Array<{
  key: string;
  name: string;
  tier: number;
  category: MaterialCategory;
  sourceHint: SourceHint[];
  element?: ElementKey | null;
  price: number;
}>;

function alchemyPillKind(category: PillCategory, effect: ItemEffect): ItemKind {
  if (category === 'HEAL_MP') return 'PILL_MP';
  if (category === 'QI_EXP' || category === 'BODY_EXP') return 'PILL_EXP';
  if (effect.mp && !effect.hp) return 'PILL_MP';
  return effect.exp || effect.bodyExp ? 'PILL_EXP' : 'PILL_HP';
}

function pillDescription(spec: (typeof ALCHEMY_PILL_SPECS)[number]): string {
  return `${spec.name} cấp ${spec.tier}, đan ${spec.category} có dược tính ổn định, không sinh tiền/ngọc.`;
}

function materialDescription(spec: (typeof ALCHEMY_MATERIAL_SPECS)[number]): string {
  return `${spec.name} cấp ${spec.tier}, nguyên liệu ${spec.category} cho Đan Đạo; nguồn: ${spec.sourceHint.join(', ')}.`;
}

export const ALCHEMY_V2_ITEMS: readonly ItemDef[] = [
  ...ALCHEMY_PILL_SPECS.map((spec) => ({
    key: spec.key,
    name: spec.name,
    description: pillDescription(spec),
    kind: alchemyPillKind(spec.category, spec.effect),
    quality: ALCHEMY_TIER_QUALITY[spec.tier] ?? 'THAN',
    stackable: true,
    effect: spec.effect,
    pillCategory: spec.category,
    pillGrade: 'TRUNG_PHAM' as PillGrade,
    recipeTier: spec.tier,
    targetRealmOrder: spec.targetRealmOrder,
    bindOnCraft: spec.marketTradeable === false,
    marketTradeable: spec.marketTradeable ?? true,
    price: spec.price,
  })),
  ...ALCHEMY_MATERIAL_SPECS.map((spec) => ({
    key: spec.key,
    name: spec.name,
    description: materialDescription(spec),
    kind: 'ORE' as ItemKind,
    quality: ALCHEMY_TIER_QUALITY[spec.tier] ?? 'THAN',
    stackable: true,
    materialTier: spec.tier,
    materialCategory: spec.category,
    materialElement: spec.element ?? null,
    sourceHint: spec.sourceHint,
    marketTradeable: true,
    price: spec.price,
  })),
];

const ALCHEMY_V2_ITEM_BY_KEY = new Map(ALCHEMY_V2_ITEMS.map((i) => [i.key, i]));

// ─────────────────────────────────────────────────────────────────────
// Phase 26.3 — Cultivation Method V2 fragment items.
//
// Mỗi V2 method có 1 fragment item `method_fragment_<methodKey>`. Item
// được auto-generate từ catalog V2 với:
//   - materialTier = method.tier (1..9)
//   - materialCategory = 'METHOD_FRAGMENT'
//   - sourceHint: derive từ `MethodSource[]` (STARTER/MAIN_QUEST/...) sang
//     wire `SourceHint` runtime (NORMAL_MONSTER/ELITE/BOSS/...).
//
// Drop Economy V2 (`drop-economy.ts`) tự sinh `MaterialDropRule` cho
// fragment items qua `buildDropRuleCatalog(ITEMS)` (đã wire vì items có
// đầy đủ metadata).
// ─────────────────────────────────────────────────────────────────────
function methodSourceToItemSourceHints(sources: readonly MethodSource[]): SourceHint[] {
  const out = new Set<SourceHint>();
  for (const s of sources) {
    switch (s) {
      case 'STARTER':
        // Starter — skip drop economy entirely; auto-grant via service.
        break;
      case 'MAIN_QUEST':
        out.add('MAIN_QUEST');
        break;
      case 'SIDE_QUEST':
      case 'NPC_SHOP':
        out.add('NPC_SHOP');
        out.add('NORMAL_MONSTER');
        break;
      case 'SECT_SHOP':
        out.add('SECT_SHOP');
        break;
      case 'DUNGEON_DROP':
        out.add('DUNGEON');
        out.add('ELITE');
        break;
      case 'BOSS_DROP':
        out.add('BOSS');
        out.add('DUNGEON');
        break;
      case 'WORLD_BOSS':
        out.add('WORLD_BOSS');
        break;
      case 'EVENT':
        out.add('EVENT');
        break;
      case 'MARKET':
        out.add('MARKET');
        break;
      case 'FRAGMENT_COMBINE':
        // Fragment_combine implies fragments come from other sources too;
        // no extra hint.
        break;
      case 'ADMIN_ONLY':
        out.add('ADMIN_ONLY');
        break;
      default:
        break;
    }
  }
  return Array.from(out);
}

function fragmentQuality(tier: number): Quality {
  // Reuse ALCHEMY_TIER_QUALITY (tier → quality) — phẩm cấp fragment khớp
  // method.tier.
  return ALCHEMY_TIER_QUALITY[tier] ?? 'THAN';
}

function fragmentPrice(tier: number): number {
  // Fragment không listing được trên market thông qua price field; chỉ
  // để hiển thị. Endgame fragment cao hơn, nhưng `marketTradeable=false`
  // ngăn list thật.
  return Math.round(40 * Math.pow(2.2, tier - 1));
}

const METHOD_FRAGMENT_ITEMS: ItemDef[] = CULTIVATION_METHODS_V2.map((m) => {
  const hints = methodSourceToItemSourceHints(m.sourceHint);
  const sourceHint: SourceHint[] = hints.length > 0 ? hints : ['ADMIN_ONLY'];
  return {
    key: m.fragmentItemKey,
    name: `Mảnh ${m.name}`,
    description: `Mảnh công pháp ${m.name} (Tier ${m.tier} - ${m.grade}). Thu thập đủ ${m.fragmentsRequired} mảnh để mở công pháp.`,
    kind: 'ORE' as ItemKind,
    quality: fragmentQuality(m.tier),
    stackable: true,
    materialTier: m.tier,
    materialCategory: 'METHOD_FRAGMENT' as MaterialCategory,
    materialElement: null,
    sourceHint,
    marketTradeable: m.tradeable,
    bindOnPickup: m.bindOnUnlock,
    price: fragmentPrice(m.tier),
  };
});

const METHOD_FRAGMENT_ITEM_BY_KEY = new Map(
  METHOD_FRAGMENT_ITEMS.map((i) => [i.key, i]),
);

export const ITEMS: readonly ItemDef[] = [
  ...BASE_ITEMS.filter(
    (item) =>
      !ALCHEMY_V2_ITEM_BY_KEY.has(item.key) &&
      !METHOD_FRAGMENT_ITEM_BY_KEY.has(item.key),
  ),
  ...ALCHEMY_V2_ITEMS,
  ...METHOD_FRAGMENT_ITEMS,
];

export function itemByKey(key: string): ItemDef | undefined {
  return (
    ALCHEMY_V2_ITEM_BY_KEY.get(key) ??
    METHOD_FRAGMENT_ITEM_BY_KEY.get(key) ??
    BASE_ITEMS.find((i) => i.key === key)
  );
}

export function itemWithProgression(item: ItemDef): ItemDef {
  if (!item.slot) return item;
  const metadata = deriveEquipmentProgressionMetadata(item);
  if (!metadata) return item;
  return { ...item, ...metadata };
}

export function itemByKeyWithProgression(key: string): ItemDef | undefined {
  const item = itemByKey(key);
  return item ? itemWithProgression(item) : undefined;
}

// LootEntry + RolledLoot types live in combat.ts (Phase 12.4 — avoid circular
// import since MonsterDef.lootTable needs LootEntry). Re-export for backward
// compat with external consumers that import from '@xuantoi/shared'.
export type { LootEntry, RolledLoot } from './combat';

export const DUNGEON_LOOT: Record<string, readonly LootEntry[]> = {
  son_coc: [
    { itemKey: 'so_kiem', weight: 8, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'pham_giap', weight: 8, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'huyet_chi_dan', weight: 30, qtyMin: 1, qtyMax: 3 },
    { itemKey: 'linh_lo_dan', weight: 12, qtyMin: 1, qtyMax: 2 },
  ],
  hac_lam: [
    { itemKey: 'huyen_kiem', weight: 5, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'linh_giap', weight: 5, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'thanh_lam_dan', weight: 20, qtyMin: 1, qtyMax: 2 },
    { itemKey: 'linh_lo_dan', weight: 18, qtyMin: 1, qtyMax: 3 },
    { itemKey: 'co_thien_dan', weight: 6, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'huyet_tinh', weight: 25, qtyMin: 1, qtyMax: 4 },
  ],
  yeu_thu_dong: [
    { itemKey: 'diem_phong_dao', weight: 3, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'huyet_phach_giap', weight: 3, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'co_thien_dan', weight: 15, qtyMin: 1, qtyMax: 3 },
    { itemKey: 'thanh_lam_dan', weight: 22, qtyMin: 1, qtyMax: 4 },
    { itemKey: 'huyet_tinh', weight: 35, qtyMin: 2, qtyMax: 6 },
  ],

  // ─────────────────────────────────────────────────────────────────────
  // Phase 10 PR-3 — Drop tables cho Dungeon Pack 1 (Ngũ Hành dungeons)
  // Loot strategy (BALANCE_MODEL.md §5.3):
  //   - Equipment HUYEN/TIEN drop weight 3-6 (low rate, ~10-15% chance/run)
  //   - Pill thường (HP/MP) weight 18-30 (consumable steady supply)
  //   - Material element-themed (linh_thao, tinh_thiet, han_ngoc, tien_kim_sa)
  //     weight 20-35 (chính nguồn craft material)
  // Phase 11.2.D+++ — skill_book_<element> drop weight 3 (rare, low pool):
  //   ~3 / total ≈ 2.5–2.8% per loot roll, default rollDungeonLoot count=2
  //   → ~5–5.5% per run.
  // Phase 11.3.D+++ — DUNGEON_LOOT đã wire vào runtime reward path:
  //   `apps/api/src/modules/combat/combat.service.ts` (action skill flow ~L576
  //   + active talent flow ~L959) gọi `rollDungeonLoot(dungeon.key, 2)` khi
  //   `EncounterStatus.WON` và grant qua `inventory.grant(loot, { reason:
  //   'COMBAT_LOOT' })` → ItemLedger row + InventoryItem (stackable).
  //   Element match dungeon → book element (kim_son_mach → kim, etc.) đảm
  //   bảo người chơi farm dungeon đúng hệ Linh Căn để học skill cùng hệ.
  // Phase 12.3 — DungeonRunService.nextEncounter cũng gọi `rollDungeonLoot`
  //   reuse cùng table này, grant với reason `DUNGEON_LOOT` + refType
  //   `DungeonRun` (khác `COMBAT_LOOT` ở refType nên ledger phân biệt được
  //   nguồn drop combat module vs dungeon-run module).
  // Lưu ý: chỉ dùng item keys đã có ở `ITEMS`; không tạo orphan reference.
  // ─────────────────────────────────────────────────────────────────────
  kim_son_mach: [
    // Element: kim → drop kim-themed weapon + tinh_thiet (kim material)
    { itemKey: 'lanh_phong_kiem', weight: 4, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'than_phong_kiem', weight: 3, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'tinh_thiet', weight: 30, qtyMin: 2, qtyMax: 5 },
    { itemKey: 'co_thien_dan', weight: 18, qtyMin: 1, qtyMax: 3 },
    { itemKey: 'thanh_lam_dan', weight: 22, qtyMin: 2, qtyMax: 4 },
    { itemKey: 'huyet_tinh', weight: 25, qtyMin: 2, qtyMax: 5 },
    // Phase 11.2.D+++ — skill book hệ Kim, low weight rare
    { itemKey: 'skill_book_kim_quang_tram', weight: 3, qtyMin: 1, qtyMax: 1 },
  ],
  moc_huyen_lam: [
    // Element: moc → linh_thao + lien_hoa_truong (mộc-themed)
    { itemKey: 'lien_hoa_truong', weight: 3, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'truc_co_truong', weight: 5, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'linh_thao', weight: 35, qtyMin: 3, qtyMax: 6 },
    { itemKey: 'thanh_lam_dan', weight: 25, qtyMin: 2, qtyMax: 4 },
    { itemKey: 'linh_lo_dan', weight: 22, qtyMin: 2, qtyMax: 4 },
    { itemKey: 'huyet_chi_dan', weight: 28, qtyMin: 2, qtyMax: 5 },
    // Phase 11.2.D+++ — skill book hệ Mộc, low weight rare
    { itemKey: 'skill_book_moc_linh_truong_dieu', weight: 3, qtyMin: 1, qtyMax: 1 },
  ],
  thuy_long_uyen: [
    // Element: thuy → han_ngoc + băng-themed
    { itemKey: 'han_thiet_giap', weight: 4, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'cuu_u_bi_thuong', weight: 3, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'han_ngoc', weight: 20, qtyMin: 1, qtyMax: 3 },
    { itemKey: 'co_thien_dan', weight: 22, qtyMin: 2, qtyMax: 4 },
    { itemKey: 'tieu_phuc_dan', weight: 18, qtyMin: 1, qtyMax: 3 },
    { itemKey: 'huyet_tinh', weight: 28, qtyMin: 2, qtyMax: 5 },
    // Phase 11.2.D+++ — skill book hệ Thủy, low weight rare
    { itemKey: 'skill_book_thuy_kinh_phong_an', weight: 3, qtyMin: 1, qtyMax: 1 },
  ],
  hoa_diem_son: [
    // Element: hoa → xich_huyet_dao + cuu_la_giap + yeu_dan (hoả material)
    { itemKey: 'xich_huyet_dao', weight: 4, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'cuu_la_giap', weight: 3, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'tu_la_dao', weight: 2, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'yeu_dan', weight: 25, qtyMin: 2, qtyMax: 5 },
    { itemKey: 'cuu_huyen_dan', weight: 12, qtyMin: 1, qtyMax: 2 },
    { itemKey: 'co_thien_dan', weight: 18, qtyMin: 2, qtyMax: 4 },
    // Phase 11.2.D+++ — skill book hệ Hỏa, low weight rare
    { itemKey: 'skill_book_hoa_xa_phun_diem', weight: 3, qtyMin: 1, qtyMax: 1 },
  ],
  hoang_tho_huyet: [
    // Element: tho → than_lan_giap + yeu_phach_giap + phu_van_ngoc (thổ material)
    { itemKey: 'than_lan_giap', weight: 3, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'yeu_phach_giap', weight: 4, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'phu_van_ngoc', weight: 22, qtyMin: 1, qtyMax: 3 },
    { itemKey: 'tinh_thiet', weight: 25, qtyMin: 2, qtyMax: 4 },
    { itemKey: 'cuu_huyen_dan', weight: 14, qtyMin: 1, qtyMax: 3 },
    { itemKey: 'tieu_phuc_dan', weight: 18, qtyMin: 2, qtyMax: 4 },
    // Phase 11.2.D+++ — skill book hệ Thổ, low weight rare
    { itemKey: 'skill_book_thach_giap_ho_than', weight: 3, qtyMin: 1, qtyMax: 1 },
  ],
  cuu_la_dien: [
    // Single-boss endgame instance, drop hiếm THAN + TIEN
    { itemKey: 'than_dan', weight: 1, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'tien_huyen_kiem', weight: 2, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'tien_huyen_giap', weight: 2, qtyMin: 1, qtyMax: 1 },
    { itemKey: 'tien_kim_sa', weight: 8, qtyMin: 1, qtyMax: 2 },
    { itemKey: 'so_huyen_dan', weight: 12, qtyMin: 1, qtyMax: 2 },
    { itemKey: 'cuu_thien_dan', weight: 6, qtyMin: 1, qtyMax: 1 },
    // Phase 11.3.D++ — dungeon hậu kỳ (Cửu La Điện single-boss endgame) drop
    // `linh_can_dan` rare. Weight 1 trong tổng ~31 → ~3.2% per loot roll
    // (rollDungeonLoot mặc định 2 lần → ~6.3% per run). Cùng drop chain với
    // boss world ≥ Hóa Thần, đảm bảo end-game player có dual source.
    { itemKey: 'linh_can_dan', weight: 1, qtyMin: 1, qtyMax: 1 },
  ],
};

/**
 * Generic weighted loot roll. Internal helper shared by `rollDungeonLoot` and
 * `rollMonsterLoot`. `count` times picks 1 entry proportional to `weight`,
 * random qty in `[qtyMin, qtyMax]`.
 *
 * **Phase 14.1.A** — `rng` optional. Default `Math.random` cho backward
 * compat. Inject seeded RNG cho Arena prep / replay verify (xem
 * `combat-rng.ts`).
 */
function rollLootTable(
  table: readonly LootEntry[],
  count: number,
  rng: () => number = Math.random,
): RolledLoot[] {
  if (table.length === 0) return [];
  const total = table.reduce((s, e) => s + e.weight, 0);
  const out: RolledLoot[] = [];
  for (let i = 0; i < count; i++) {
    let r = rng() * total;
    for (const entry of table) {
      r -= entry.weight;
      if (r <= 0) {
        const qty =
          entry.qtyMin + Math.floor(rng() * (entry.qtyMax - entry.qtyMin + 1));
        out.push({ itemKey: entry.itemKey, qty });
        break;
      }
    }
  }
  return out;
}

/**
 * Roll 1-2 entry từ drop table dungeon, áp dụng weight.
 *
 * **Phase 14.1.A** — `rng` optional. Default `Math.random` (legacy
 * runtime). Caller deterministic inject seeded RNG.
 */
export function rollDungeonLoot(
  dungeonKey: string,
  count = 2,
  rng: () => number = Math.random,
): RolledLoot[] {
  const table = DUNGEON_LOOT[dungeonKey];
  if (!table || table.length === 0) return [];
  return rollLootTable(table, count, rng);
}

/**
 * **Phase 12.4** — Roll loot từ `MonsterDef.lootTable` (per-monster override).
 * Trả `[]` nếu monster không tồn tại hoặc không define lootTable.
 *
 * Caller (DungeonRunService.nextEncounter, CombatService WON path) sẽ check
 * `rollMonsterLoot(monsterKey, n)` — nếu empty → fallback `rollDungeonLoot`.
 *
 * **Phase 14.1.A** — `rng` optional. Default `Math.random` (legacy
 * runtime). Caller deterministic inject seeded RNG.
 */
export function rollMonsterLoot(
  monsterKey: string,
  count = 2,
  rng: () => number = Math.random,
): RolledLoot[] {
  const monster = monsterByKey(monsterKey);
  if (!monster?.lootTable || monster.lootTable.length === 0) return [];
  return rollLootTable(monster.lootTable, count, rng);
}

export const QUALITY_COLOR: Record<Quality, string> = {
  PHAM: 'text-ink-200',
  LINH: 'text-blue-300',
  HUYEN: 'text-purple-300',
  TIEN: 'text-amber-300',
  THAN: 'text-red-300',
};

export const QUALITY_LABEL_VI: Record<Quality, string> = {
  PHAM: 'Phàm',
  LINH: 'Linh',
  HUYEN: 'Huyền',
  TIEN: 'Tiên',
  THAN: 'Thần',
};

// ---------------------------------------------------------------------------
// Phase 11.6.E — Equipment elemental tribulation resist composer
// ---------------------------------------------------------------------------
//
// Pure helpers cho compose `ItemBonus.elementResist` từ list trang bị đang đeo
// thành 1 `ReadonlyMap<ElementKey, number>` cho tribulation resist layer.
// Mirror pattern của `composePassiveTalentMods.elementResistByElement` +
// `computePassiveTalentTribulationResist` ở `talents.ts` (Phase 11.6.D).
//
// Wire điểm:
//   `apps/api/src/modules/inventory/inventory.service.ts` →
//   `equipElementResistMods(characterId)` query equipped InventoryItem rows,
//   resolve ItemDef qua `itemByKey(...)`, gọi
//   `composeEquippedItemElementResist(items.map((d) => d.bonuses).filter(...))`.
//
//   `apps/api/src/modules/character/tribulation.service.ts` →
//   `attemptTribulation` `elementResistFn` gọi
//   `computeEquipmentTribulationResist(equipMods, waveElement)` trong compose
//   chain `rootResist × talentResist × equipmentResist`, clamp envelope qua
//   `[ELEMENT_MODIFIER_ABSOLUTE_FLOOR, ELEMENT_MODIFIER_ABSOLUTE_CEIL]`.
//
// Worst-case stack budget: spiritual root best (0.7) × talent 5-stack
// (0.95⁵≈0.7738) × equipment 5-stack (0.95⁵≈0.7738) = 0.4193, vẫn được clamp
// về `ELEMENT_MODIFIER_ABSOLUTE_FLOOR=0.6`. Single-equipment floor 0.95 ×
// spiritual best (0.7) = 0.665 → an toàn trong envelope.

/**
 * Compose `ItemBonus.elementResist` từ list bonus của tất cả trang bị
 * đang đeo. Stack multiplicatively per element key. Thiếu key = identity
 * (không contribute → không xuất hiện trong map output).
 *
 * Pure function — không I/O. Idempotent với input order (multiplication
 * commutative).
 *
 * @param bonuses list `ItemBonus` từ trang bị đang đeo (caller filter ra
 *   item không có bonuses hoặc không đeo).
 * @returns `ReadonlyMap<ElementKey, number>` — value < 1 = resist multiplier.
 *   Empty map nếu không trang bị nào có `elementResist`.
 */
export function composeEquippedItemElementResist(
  bonuses: readonly ItemBonus[],
): ReadonlyMap<ElementKey, number> {
  const out = new Map<ElementKey, number>();
  for (const b of bonuses) {
    if (!b.elementResist) continue;
    for (const [k, v] of Object.entries(b.elementResist)) {
      if (v === undefined || !Number.isFinite(v) || v <= 0) continue;
      const elem = k as ElementKey;
      const cur = out.get(elem) ?? 1;
      out.set(elem, cur * v);
    }
  }
  return out;
}

/**
 * Phase 11.6.E — derive tribulation resist multiplier từ trang bị đã compose
 * cho 1 wave element. Pure deterministic helper (no I/O). Caller compose
 * multiplicatively trên top spiritual root + talent resist:
 *   `effective = computeSpiritualRootTribulationResist(...)
 *              × computePassiveTalentTribulationResist(...)
 *              × computeEquipmentTribulationResist(...)`
 *
 * - `null` element (Tâm Kiếp / vô hệ) → fallback `1.0` (no equipment resist).
 * - Element khớp `equipmentMods` → return stored multiplier (< 1).
 * - Element không khớp → fallback `1.0` (identity, no effect).
 *
 * **KHÔNG** clamp envelope ở đây — caller (TribulationService) sẽ clamp tổng
 * sau khi compose tất cả layer.
 */
export function computeEquipmentTribulationResist(
  equipmentMods: ReadonlyMap<ElementKey, number>,
  waveElement: ElementKey | null,
): number {
  if (waveElement === null) return 1.0;
  return equipmentMods.get(waveElement) ?? 1.0;
}
