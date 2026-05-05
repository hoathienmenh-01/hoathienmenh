/**
 * Công pháp / Cultivation Method — Phase 11.1 catalog + runtime wire.
 *
 * Hệ thống Công pháp:
 * - Mỗi nhân vật học (`learn`) công pháp tu luyện — multiplier `expGain` +
 *   stat bonus baseline + element affinity bonus.
 * - Phải drop từ dungeon / boss / sect-shop để có (KHÔNG free starter
 *   trừ "khai thiên quyết" base method).
 * - Có thể đổi method (re-equip) nhưng có cooldown 24h chống thrashing.
 * - Cùng sect mới học được method sect-locked (e.g. "Thanh Vân Tâm Pháp"
 *   chỉ Thanh Vân học).
 *
 * Runtime wire:
 *   - Phase 11.1.B — `learn`/`equip` service + onboard starter grant.
 *   - Phase 11.1.B — `methodExpMultiplierFor` wire vào
 *     `CultivationProcessor` EXP gain.
 *   - Phase 11.1.D — `methodStatBonusFor` wire vào `CombatService.action`
 *     atk/def multipliers.
 *   - Phase 11.1.E — `computeMethodElementAffinityBonus` wire vào
 *     `CultivationProcessor` cùng compose để Linh căn × Method element
 *     match cộng bonus EXP gain (primary +10%, secondary +5%).
 *
 * Source of truth:
 *   - `docs/GAME_DESIGN_BIBLE.md` §C.5 Công pháp / Skill / Thần thông.
 *   - `docs/BALANCE_MODEL.md` §4.4 Cultivation rate.
 *   - `docs/LONG_TERM_ROADMAP.md` Phase 11 PR 11.1 CultivationMethod model.
 *
 * Phase 11.0 `spiritual-root.ts` đã wire `elementMultiplier` helper.
 * CultivationMethod catalog này dùng cùng `ElementKey` từ `combat.ts` —
 * runtime compose:
 *
 *   effectiveExpRate = baseExpRate
 *                    * spiritualRoot.cultivationMultiplier
 *                    * cultivationMethod.expMultiplier
 *                    * (1 + matchingElementBonus)   ← Phase 11.1.E
 *                    * talent.expMul
 */

import {
  METHOD_ELEMENT_PRIMARY_BONUS,
  METHOD_ELEMENT_SECONDARY_BONUS,
} from './balance-dials';
import type { ElementKey, SectKey } from './combat';

/**
 * 4-tier method grade — rarity giảm dần. KHÔNG trùng `SpiritualRootGrade`
 * (root 5-tier có `linh`, method chỉ có `pham/huyen/tien/than` để đơn
 * giản hoá drop table phase 11.3).
 */
export type CultivationMethodGrade = 'pham' | 'huyen' | 'tien' | 'than';

/**
 * Source where the method comes from. UI render + drop table runtime sau
 * này sẽ dùng để filter.
 */
export type CultivationMethodSource =
  | 'starter' // Khai thiên quyết — auto-grant character mới
  | 'sect_shop' // Mua từ sect treasury
  | 'dungeon_drop' // Drop từ dungeon boss
  | 'boss_drop' // Drop từ world boss
  | 'event' // Event reward (nice-to-have phase 14)
  | 'quest_milestone'; // Quest reward (phase 11.4 alchemy quest e.g.)

/**
 * Stat bonus structure cho method — % tăng baseline (KHÔNG flat). Phase
 * 11.3 wire vào `CharacterStatService.computeStats`:
 *
 *   final.hpMax = baseHpMax * (1 + spiritualRoot.statBonus + method.statBonus.hpMax)
 */
export interface CultivationMethodStatBonus {
  hpMaxPercent: number;
  mpMaxPercent: number;
  atkPercent: number;
  defPercent: number;
}

export interface CultivationMethodDef {
  key: string;
  name: string;
  description: string;
  grade: CultivationMethodGrade;
  /**
   * Ngũ Hành affinity của method. `null` = vô hệ (không bonus element).
   * Phase 11.3 sẽ compose:
   *   matchingElementBonus = 0.10 nếu primaryElement === method.element
   *                        else 0.05 nếu method.element ∈ secondaryElements
   *                        else 0
   * (Khác với `characterSkillElementBonus` — method bonus apply expGain,
   * skill bonus apply damage.)
   */
  element: ElementKey | null;
  /**
   * Expansion multiplier cho EXP gain — 1.0× pham starter → 2.0× than
   * endgame. Phase 11.3 wire vào `CultivationService.tickExp`:
   *   expGained = baseTickExp * spiritualRoot.cultivationMultiplier
   *             * method.expMultiplier
   */
  expMultiplier: number;
  /**
   * Stat bonus baseline khi equip method. Phase 11.3 wire vào
   * `CharacterStatService.computeStats`.
   */
  statBonus: CultivationMethodStatBonus;
  /**
   * Realm key tối thiểu để học. Character ở realm thấp hơn KHÔNG learn
   * được method này (validation runtime phase 11.3).
   */
  unlockRealm: string;
  /**
   * Sect-locked method — `null` = ai cũng học được, set sect → chỉ sect
   * đó học. Phase 11.3 service `learnCultivationMethod` reject if sect
   * mismatch.
   */
  requiredSect: SectKey | null;
  /**
   * Source where method drops / unlocks — UI filter + drop table
   * reference.
   */
  source: CultivationMethodSource;
  /**
   * **Forward-compat phase 11.2/11.3** — passive skill keys grant khi
   * equip method (e.g. "Cửu Cực Kim Cương Quyết" grant `passive_def_aura`).
   * Hiện chỉ metadata, runtime KHÔNG đọc — phase 11.2 SkillTemplate +
   * CharacterSkill DB sẽ wire.
   */
  passiveSkillKeys?: readonly string[];
  /**
   * **Forward-compat phase 11.3** — element conflict. Character có
   * `primaryElement` ∈ `forbiddenElements` KHÔNG learn được method (e.g.
   * "Bắc Minh Thần Công" thuần thuỷ KHÔNG dành cho Hoả linh căn).
   * Empty/undefined = không conflict.
   */
  forbiddenElements?: readonly ElementKey[];
}

/**
 * Static catalog — Phase 11.1 baseline 12 method:
 *   - 1 starter pham (auto-grant character mới).
 *   - 5 huyen-grade method, mỗi Ngũ Hành 1 method.
 *   - 3 tien-grade method, sect-locked (Thanh Vân kiếm / Huyền Thuỷ thuỷ
 *     trị / Tu La huyết tế).
 *   - 3 than-grade method, endgame drop (cross-element / vô hệ neutral).
 *
 * Balance:
 *   pham starter   expMul 1.00, stat +0%   - baseline.
 *   huyen          expMul 1.20..1.30, stat +5..+10%  - mid.
 *   tien sect      expMul 1.40, stat +15% (with sect lock).
 *   than endgame   expMul 1.60..1.80, stat +20..+25%.
 *
 * Theo `BALANCE_MODEL.md` §4.4 cultivation rate: total method × root
 * stack ≤ ~3.0× (root than 1.8 × method than 1.8 = 3.24, slight overflow
 * accept vì than × than rất hiếm).
 */
export const CULTIVATION_METHODS: readonly CultivationMethodDef[] = [
  // ─────────────────────────────────────────────────────────────────────
  // pham starter — auto-grant khi tạo character (phase 11.3 onboarding).
  // ─────────────────────────────────────────────────────────────────────
  {
    key: 'khai_thien_quyet',
    name: 'Khai Thiên Quyết',
    description:
      'Công pháp khai môn cơ bản — học cách dẫn linh khí vào kinh mạch. Mọi tu sĩ phàm phẩm đều bắt đầu từ đây.',
    grade: 'pham',
    element: null,
    expMultiplier: 1.0,
    statBonus: { hpMaxPercent: 0, mpMaxPercent: 0, atkPercent: 0, defPercent: 0 },
    unlockRealm: 'phamnhan',
    requiredSect: null,
    source: 'starter',
  },
  // ─────────────────────────────────────────────────────────────────────
  // huyen-grade — mỗi Ngũ Hành 1 method (5 element × 1 = 5). Drop từ
  // dungeon truc_co / kim_dan tier.
  // ─────────────────────────────────────────────────────────────────────
  {
    key: 'cuu_cuc_kim_cuong_quyet',
    name: 'Cửu Cực Kim Cương Quyết',
    description:
      'Công pháp Kim hệ — luyện da thịt cứng như kim loại, phòng ngự cao. Không hợp với linh căn Mộc.',
    grade: 'huyen',
    element: 'kim',
    expMultiplier: 1.2,
    statBonus: { hpMaxPercent: 8, mpMaxPercent: 0, atkPercent: 5, defPercent: 12 },
    unlockRealm: 'truc_co',
    requiredSect: null,
    source: 'dungeon_drop',
    forbiddenElements: ['moc'],
  },
  {
    key: 'thanh_moc_dao_kinh',
    name: 'Thanh Mộc Đạo Kinh',
    description:
      'Công pháp Mộc hệ — gia tốc tự nhiên hồi phục. Tăng HP regen + MP regen baseline. Không hợp Kim.',
    grade: 'huyen',
    element: 'moc',
    expMultiplier: 1.25,
    statBonus: { hpMaxPercent: 10, mpMaxPercent: 8, atkPercent: 0, defPercent: 5 },
    unlockRealm: 'truc_co',
    requiredSect: null,
    source: 'sect_shop',
    forbiddenElements: ['kim'],
  },
  {
    key: 'thuy_long_ngam',
    name: 'Thuỷ Long Ngâm',
    description:
      'Công pháp Thuỷ hệ — tinh thần dòng chảy, MP gain mạnh. Không hợp linh căn Thổ.',
    grade: 'huyen',
    element: 'thuy',
    expMultiplier: 1.3,
    statBonus: { hpMaxPercent: 5, mpMaxPercent: 15, atkPercent: 5, defPercent: 5 },
    unlockRealm: 'truc_co',
    requiredSect: null,
    source: 'dungeon_drop',
    forbiddenElements: ['tho'],
  },
  {
    key: 'liet_hoa_phap',
    name: 'Liệt Hoả Pháp',
    description:
      'Công pháp Hoả hệ — sát phát mãnh liệt, atk cao. Không hợp linh căn Thuỷ.',
    grade: 'huyen',
    element: 'hoa',
    expMultiplier: 1.2,
    statBonus: { hpMaxPercent: 5, mpMaxPercent: 5, atkPercent: 12, defPercent: 0 },
    unlockRealm: 'truc_co',
    requiredSect: null,
    source: 'dungeon_drop',
    forbiddenElements: ['thuy'],
  },
  {
    key: 'thuong_tho_chan_kinh',
    name: 'Thượng Thổ Chân Kinh',
    description:
      'Công pháp Thổ hệ — kiên cố như đá núi. HP cao, def trung bình. Không hợp Mộc.',
    grade: 'huyen',
    element: 'tho',
    expMultiplier: 1.15,
    statBonus: { hpMaxPercent: 15, mpMaxPercent: 0, atkPercent: 0, defPercent: 10 },
    unlockRealm: 'truc_co',
    requiredSect: null,
    source: 'sect_shop',
    forbiddenElements: ['moc'],
  },
  // ─────────────────────────────────────────────────────────────────────
  // tien-grade — sect-locked. Mỗi sect 1 signature method.
  // ─────────────────────────────────────────────────────────────────────
  {
    key: 'thanh_van_tam_phap',
    name: 'Thanh Vân Tâm Pháp',
    description:
      'Tâm pháp truyền thừa Thanh Vân Môn — kiếm khí thuần khiết. Sát thương kiếm + tốc độ ra chiêu.',
    grade: 'tien',
    element: 'kim',
    expMultiplier: 1.4,
    statBonus: { hpMaxPercent: 10, mpMaxPercent: 5, atkPercent: 18, defPercent: 8 },
    unlockRealm: 'kim_dan',
    requiredSect: 'thanh_van',
    source: 'sect_shop',
    passiveSkillKeys: ['passive_thanh_van_kiem_khi'],
    forbiddenElements: ['moc'],
  },
  {
    key: 'huyen_thuy_chan_kinh',
    name: 'Huyền Thuỷ Chân Kinh',
    description:
      'Chân kinh Huyền Thuỷ Cốc — vận khí nước, MP regen + thuỷ skill bonus.',
    grade: 'tien',
    element: 'thuy',
    expMultiplier: 1.4,
    statBonus: { hpMaxPercent: 8, mpMaxPercent: 20, atkPercent: 10, defPercent: 8 },
    unlockRealm: 'kim_dan',
    requiredSect: 'huyen_thuy',
    source: 'sect_shop',
    passiveSkillKeys: ['passive_huyen_thuy_mp_regen'],
    forbiddenElements: ['tho'],
  },
  {
    key: 'tu_la_huyet_kinh',
    name: 'Tu La Huyết Kinh',
    description:
      'Huyết kinh Tu La Tông — tăng atk khi HP thấp. Tâm ma cao — risk vào nhan_tien dễ trigger.',
    grade: 'tien',
    element: 'hoa',
    expMultiplier: 1.4,
    statBonus: { hpMaxPercent: -5, mpMaxPercent: 0, atkPercent: 25, defPercent: -5 },
    unlockRealm: 'kim_dan',
    requiredSect: 'tu_la',
    source: 'sect_shop',
    passiveSkillKeys: ['passive_tu_la_blood_rage'],
    forbiddenElements: ['thuy'],
  },
  // ─────────────────────────────────────────────────────────────────────
  // than-grade — endgame drop từ world boss / hop_the+ dungeon. Cross-
  // element / vô hệ.
  // ─────────────────────────────────────────────────────────────────────
  {
    key: 'thai_hu_chan_kinh',
    name: 'Thái Hư Chân Kinh',
    description:
      'Chân kinh thượng cổ vô hệ — không thiên vị Ngũ Hành nào. Phù hợp mọi linh căn, không có forbid.',
    grade: 'than',
    element: null,
    expMultiplier: 1.6,
    statBonus: { hpMaxPercent: 18, mpMaxPercent: 18, atkPercent: 18, defPercent: 18 },
    unlockRealm: 'hoa_than',
    requiredSect: null,
    source: 'boss_drop',
  },
  {
    key: 'hon_doan_quy_nguyen',
    name: 'Hỗn Đoán Quy Nguyên',
    description:
      'Tuyệt phẩm than-grade — gọi gọn ngũ hành về một thân. Chỉ Tiên/Thần linh căn vận hành tối đa được.',
    grade: 'than',
    element: null,
    expMultiplier: 1.8,
    statBonus: { hpMaxPercent: 25, mpMaxPercent: 25, atkPercent: 22, defPercent: 22 },
    unlockRealm: 'luyen_hu',
    requiredSect: null,
    source: 'boss_drop',
    passiveSkillKeys: ['passive_hon_doan_element_pierce'],
  },
  {
    key: 'cuu_chuyen_huyen_cong',
    name: 'Cửu Chuyển Huyền Công',
    description:
      'Truyền thuyết huyền công 9 chuyển — chữa lành kinh mạch tổn thương, đồng thời gia tăng tuổi thọ. Drop từ event.',
    grade: 'than',
    element: null,
    expMultiplier: 1.7,
    statBonus: { hpMaxPercent: 30, mpMaxPercent: 15, atkPercent: 10, defPercent: 25 },
    unlockRealm: 'luyen_hu',
    requiredSect: null,
    source: 'event',
  },
];

/**
 * Starter method key — auto-grant + auto-equip khi onboard character mới
 * (Phase 11.1.B). Mọi character bắt đầu equip method này trừ khi họ học +
 * equip method khác.
 */
export const STARTER_CULTIVATION_METHOD_KEY = 'khai_thien_quyet';

/**
 * Lookup method by key. Returns undefined nếu invalid (catalog level —
 * runtime sẽ wrap = throw nếu cần strict).
 */
export function getCultivationMethodDef(key: string): CultivationMethodDef | undefined {
  return CULTIVATION_METHODS.find((m) => m.key === key);
}

/**
 * Filter methods by element (include `null` neutral methods nếu
 * `includeNeutral` true). Phase 11.3 onboarding sẽ dùng để gợi ý method
 * theo `primaryElement` của character.
 */
export function methodsByElement(
  element: ElementKey,
  options: { includeNeutral?: boolean } = {},
): CultivationMethodDef[] {
  const includeNeutral = options.includeNeutral ?? true;
  return CULTIVATION_METHODS.filter((m) => {
    if (m.element === element) return true;
    if (includeNeutral && m.element === null) return true;
    return false;
  });
}

/**
 * Filter methods learnable by sect (include `null` open-method nếu
 * `includeOpen` true).
 */
export function methodsForSect(
  sect: SectKey | null,
  options: { includeOpen?: boolean } = {},
): CultivationMethodDef[] {
  const includeOpen = options.includeOpen ?? true;
  return CULTIVATION_METHODS.filter((m) => {
    if (m.requiredSect === sect && sect !== null) return true;
    if (includeOpen && m.requiredSect === null) return true;
    return false;
  });
}

/**
 * Check if character với element `primaryElement` có thể học method này.
 * Phase 11.3 service `learnCultivationMethod` sẽ reject nếu trả false.
 */
export function canLearnMethod(
  method: CultivationMethodDef,
  primaryElement: ElementKey,
): boolean {
  if (!method.forbiddenElements || method.forbiddenElements.length === 0) return true;
  return !method.forbiddenElements.includes(primaryElement);
}

/**
 * Check if character với realm `realmKey` đủ điều kiện học method. Cần
 * realm order >= method.unlockRealm order (validate runtime phase 11.3
 * sẽ inject `realmsByKey`).
 */
export function methodUnlockRealmKey(method: CultivationMethodDef): string {
  return method.unlockRealm;
}

/**
 * Phase 11.1.E — Linh căn × Cultivation Method element affinity bonus.
 *
 * Pure helper trả về fraction bonus (KHÔNG phải multiplier) — caller compose:
 *   effectiveMul = method.expMultiplier × (1 + computeMethodElementAffinityBonus(...))
 *
 * Quy tắc:
 *   - `methodElement === null` (vô hệ — `khai_thien_quyet`,
 *     `thai_hu_chan_kinh`) → bonus = 0 (không thiên vị linh căn nào).
 *   - `primaryElement === methodElement` → bonus = `METHOD_ELEMENT_PRIMARY_BONUS`
 *     (cùng hệ chính, +10%).
 *   - `methodElement ∈ secondaryElements` → bonus = `METHOD_ELEMENT_SECONDARY_BONUS`
 *     (cùng hệ phụ, +5%).
 *   - Khác hệ hoặc legacy character (`primaryElement === null`) → bonus = 0.
 *
 * Backward-compat: legacy character pre-Phase 11.3 có `primaryElement=null` /
 * `secondaryElements=[]` → bonus = 0 → identity (gain × 1.0). Wire trong
 * `cultivation.processor.ts` qua `methodElementAffinityFor` adapter.
 */
export function computeMethodElementAffinityBonus(
  primaryElement: ElementKey | null,
  secondaryElements: readonly ElementKey[],
  methodElement: ElementKey | null,
): number {
  if (methodElement === null) return 0;
  if (primaryElement !== null && primaryElement === methodElement) {
    return METHOD_ELEMENT_PRIMARY_BONUS;
  }
  if (secondaryElements.includes(methodElement)) {
    return METHOD_ELEMENT_SECONDARY_BONUS;
  }
  return 0;
}
