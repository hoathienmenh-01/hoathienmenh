/**
 * Buff / Debuff catalog foundation — Phase 11.8.A
 *
 * Pure data + deterministic helpers. KHÔNG runtime/schema/migration.
 *
 * Design intent (P11-8):
 * - Buff/Debuff system catalog cho duration-based effect áp lên character/monster.
 * - Source: pill (alchemy), sect aura, event, equipment, talent (active utility),
 *   skill (DOT/CC), boss attack (debuff), tribulation Tâm Ma.
 * - Effect kind: stat_mod, regen, damage_bonus, damage_reduction, control,
 *   dot, shield, taunt, invuln, cultivation_block.
 * - Stackable convention: chỉ buff có `stackable: true` mới stack tới `maxStacks`;
 *   các buff cùng key non-stackable thì refresh duration (không double effect).
 * - Phase 11.8.B runtime sẽ thêm Prisma `CharacterBuff { id, characterId, buffKey,
 *   stacks, source, expiresAt, createdAt }` + service `applyBuff` / `removeBuff`
 *   / `pruneBuffs` (cron) + wire `composeBuffMods(activeBuffs)` vào
 *   `CharacterStatService.computeStats` + DOT tick task + control flag enforce.
 *
 * Convention:
 * - `durationSec` = baseline duration (server có thể scale theo skill level / pill quality).
 * - `polarity` distinct với `kind`: 1 effect kind có thể là buff hoặc debuff
 *   (vd `damage_bonus` element-target cho cả buff Kim atk vs Mộc và debuff
 *   anti-Kim). Server filter UI theo polarity.
 *
 * Curve (18 buff/debuff tổng):
 * - 10 BUFF (pill 4 + sect_aura 3 + event 2 + talent_utility 1).
 * - 8 DEBUFF (skill control 4 + skill dot 2 + boss debuff 1 + tribulation tâm ma 1).
 * - 5 element coverage (kim/moc/thuy/hoa/tho) trên ít nhất 1 buff + 1 debuff;
 *   neutral cho effect không gắn hệ.
 */

import {
  BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC,
  BREAKTHROUGH_FAIL_DEBUFF_RATE_PENALTY,
} from './balance-dials';
import type { ElementKey } from './combat';
import { itemByKey } from './items';
import type { StatTarget } from './talents';

export type BuffPolarity = 'buff' | 'debuff';

/**
 * Sub-kind cho buff/debuff effect.
 *
 * - `stat_mod`: × multiplier vào atk/def/hpMax/mpMax/spirit (vd 1.10 = +10%).
 * - `regen`: + flat hp/mp regen mỗi tick (sec hoặc combat turn — runtime decide).
 * - `damage_bonus`: × multiplier khi attack target có element X (vd Kim aura
 *    ×1.05 vs Mộc).
 * - `damage_reduction`: × multiplier giảm damage nhận từ element X (1 / value).
 * - `control`: block player action (root/stun/silence) — runtime block input.
 * - `dot`: damage over time mỗi tick (value = damage flat hoặc % spirit).
 * - `shield`: absorb damage (value = % hpMax — runtime convert thành flat shield).
 * - `taunt`: force enemy AI nhắm target này (PvE only).
 * - `invuln`: ignore all damage (rất hiếm — ngắn duration).
 * - `cultivation_block`: block cultivation gain (Tâm Ma debuff).
 * - `cultivation_rate_mul`: × multiplier vào cultivation rate (vd 0.7 = -30%
 *    EXP gain). Phân biệt với `cultivation_block` (binary): rate_mul giảm
 *    nhẹ, vẫn cho phép tu luyện (Tâm Ma "light" sau breakthrough fail).
 *    Compose multiplicative per stack — wire vào `CultivationProcessor`
 *    qua `BuffMods.cultivationRateMul` (Phase 11 nâng cao §5 PR2 wire).
 */
export type BuffEffectKind =
  | 'stat_mod'
  | 'regen'
  | 'damage_bonus'
  | 'damage_reduction'
  | 'control'
  | 'dot'
  | 'shield'
  | 'taunt'
  | 'invuln'
  | 'cultivation_block'
  | 'cultivation_rate_mul';

export type BuffSource =
  | 'pill'
  | 'skill'
  | 'sect_aura'
  | 'sect_season'
  | 'event'
  | 'gear'
  | 'talent'
  | 'boss_skill'
  | 'tribulation'
  | 'breakthrough';

export interface BuffEffect {
  readonly kind: BuffEffectKind;
  /**
   * Multiplier (1.10 = +10%) cho stat_mod / damage_bonus / damage_reduction;
   * flat value (regen / dot / shield %) cho các kind khác.
   */
  readonly value: number;
  /** Stat target cho `stat_mod` / `regen`. */
  readonly statTarget: StatTarget | null;
  /** Element target cho `damage_bonus` / `damage_reduction` (vs enemy element). */
  readonly elementTarget: ElementKey | null;
}

export interface BuffDef {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly polarity: BuffPolarity;
  /** Element của buff (null = neutral). */
  readonly element: ElementKey | null;
  /** Source mà buff/debuff này có thể đến từ. */
  readonly source: BuffSource;
  /** Duration baseline (server có thể scale). */
  readonly durationSec: number;
  /** True = nhiều stack cùng key. False = refresh duration only. */
  readonly stackable: boolean;
  /** Max stack (1 nếu non-stackable). */
  readonly maxStacks: number;
  /** Có thể bị dispel không (cleanse skill / aura). */
  readonly dispellable: boolean;
  /** Effects (1+). Server compose multiplicative cho stat_mod / damage_bonus, additive cho regen / shield. */
  readonly effects: readonly BuffEffect[];
}

/**
 * 18 buff/debuff baseline cover: pill + sect_aura + event + talent_utility +
 * skill control/dot + boss debuff + tribulation Tâm Ma.
 *
 * Stable order: BUFF trước (theo source) → DEBUFF sau (theo source).
 */
export const BUFFS: readonly BuffDef[] = [
  // ===== BUFFS =====
  // ----- PILL (alchemy) — 4 -----
  {
    key: 'pill_atk_buff_t1',
    name: 'Cương Lực Đan Ấn',
    description: 'Sau khi uống Cương Lực Đan, công kích +12% trong 60 giây.',
    polarity: 'buff',
    element: null,
    source: 'pill',
    durationSec: 60,
    stackable: false,
    maxStacks: 1,
    dispellable: true,
    effects: [
      {
        kind: 'stat_mod',
        value: 1.12,
        statTarget: 'atk',
        elementTarget: null,
      },
    ],
  },
  {
    key: 'pill_def_buff_t1',
    name: 'Thiết Bích Đan Ấn',
    description: 'Sau khi uống Thiết Bích Đan, phòng ngự +15% trong 60 giây.',
    polarity: 'buff',
    element: null,
    source: 'pill',
    durationSec: 60,
    stackable: false,
    maxStacks: 1,
    dispellable: true,
    effects: [
      {
        kind: 'stat_mod',
        value: 1.15,
        statTarget: 'def',
        elementTarget: null,
      },
    ],
  },
  {
    key: 'pill_hp_regen_t1',
    name: 'Sinh Cơ Đan Ấn',
    description: 'Hồi 5 HP mỗi giây trong 30 giây.',
    polarity: 'buff',
    element: null,
    source: 'pill',
    durationSec: 30,
    stackable: false,
    maxStacks: 1,
    dispellable: true,
    effects: [
      {
        kind: 'regen',
        value: 5,
        statTarget: 'hpMax',
        elementTarget: null,
      },
    ],
  },
  {
    key: 'pill_spirit_buff_t1',
    name: 'Linh Tâm Đan Ấn',
    description: 'Linh lực và spirit +18% trong 90 giây.',
    polarity: 'buff',
    element: null,
    source: 'pill',
    durationSec: 90,
    stackable: false,
    maxStacks: 1,
    dispellable: true,
    effects: [
      {
        kind: 'stat_mod',
        value: 1.18,
        statTarget: 'spirit',
        elementTarget: null,
      },
    ],
  },
  // ----- SECT AURA — 3 -----
  {
    key: 'sect_aura_kim',
    name: 'Kim Sát Trận',
    description: 'Tông môn Kim hệ aura: +6% sát thương lên kẻ địch hệ Mộc.',
    polarity: 'buff',
    element: 'kim',
    source: 'sect_aura',
    durationSec: 600,
    stackable: false,
    maxStacks: 1,
    dispellable: false,
    effects: [
      {
        kind: 'damage_bonus',
        value: 1.06,
        statTarget: null,
        elementTarget: 'moc',
      },
    ],
  },
  {
    key: 'sect_aura_thuy',
    name: 'Thuỷ Linh Trận',
    description: 'Tông môn Thuỷ hệ aura: hồi 4 MP/giây trong tu luyện.',
    polarity: 'buff',
    element: 'thuy',
    source: 'sect_aura',
    durationSec: 600,
    stackable: false,
    maxStacks: 1,
    dispellable: false,
    effects: [
      {
        kind: 'regen',
        value: 4,
        statTarget: 'mpMax',
        elementTarget: null,
      },
    ],
  },
  {
    key: 'sect_aura_hoa',
    name: 'Hoả Diễm Trận',
    description: 'Tông môn Hoả hệ aura: tất cả sát thương +5%.',
    polarity: 'buff',
    element: 'hoa',
    source: 'sect_aura',
    durationSec: 600,
    stackable: false,
    maxStacks: 1,
    dispellable: false,
    effects: [
      {
        kind: 'stat_mod',
        value: 1.05,
        statTarget: 'atk',
        elementTarget: null,
      },
    ],
  },
  // ----- EVENT — 2 -----
  {
    key: 'event_double_exp',
    name: 'Song Thiên Tu Vận',
    description: 'Sự kiện: nhận EXP ×2 trong 1 giờ.',
    polarity: 'buff',
    element: null,
    source: 'event',
    durationSec: 3600,
    stackable: false,
    maxStacks: 1,
    dispellable: false,
    effects: [
      {
        kind: 'stat_mod',
        value: 2.0,
        statTarget: 'spirit',
        elementTarget: null,
      },
    ],
  },
  {
    key: 'event_double_drop',
    name: 'Tài Phú Thiên Hạ',
    description: 'Sự kiện: drop loot rate ×2 trong 1 giờ.',
    polarity: 'buff',
    element: null,
    source: 'event',
    durationSec: 3600,
    stackable: false,
    maxStacks: 1,
    dispellable: false,
    effects: [
      {
        kind: 'damage_bonus',
        value: 2.0,
        statTarget: null,
        elementTarget: null,
      },
    ],
  },
  // ----- TALENT (utility) — 1 -----
  {
    key: 'talent_shield_phong',
    name: 'Phong Hộ Thuẫn',
    description:
      'Talent Phong Lui kích hoạt: tạo khiên hấp thu 30% HP tối đa trong 10 giây.',
    polarity: 'buff',
    element: null,
    source: 'talent',
    durationSec: 10,
    stackable: false,
    maxStacks: 1,
    dispellable: true,
    effects: [
      {
        kind: 'shield',
        value: 0.3,
        statTarget: 'hpMax',
        elementTarget: null,
      },
    ],
  },

  // ===== DEBUFFS =====
  // ----- SKILL CONTROL — 4 -----
  {
    key: 'debuff_root_thuy',
    name: 'Thuỷ Yến Ngục',
    description: 'Thuỷ pháp giam giữ — không thể di chuyển hoặc chạy trốn 3 lượt.',
    polarity: 'debuff',
    element: 'thuy',
    source: 'skill',
    durationSec: 9,
    stackable: false,
    maxStacks: 1,
    dispellable: true,
    effects: [
      {
        kind: 'control',
        value: 3,
        statTarget: null,
        elementTarget: null,
      },
    ],
  },
  {
    key: 'debuff_stun_tho',
    name: 'Thổ Địa Chấn',
    description: 'Bị choáng váng vì địa chấn — không thể hành động 1 lượt.',
    polarity: 'debuff',
    element: 'tho',
    source: 'skill',
    durationSec: 3,
    stackable: false,
    maxStacks: 1,
    dispellable: true,
    effects: [
      {
        kind: 'control',
        value: 1,
        statTarget: null,
        elementTarget: null,
      },
    ],
  },
  {
    key: 'debuff_silence_kim',
    name: 'Kim Khẩu Phong',
    description: 'Kim khí phong tỏa kinh mạch — không thể niệm chú 2 lượt.',
    polarity: 'debuff',
    element: 'kim',
    source: 'skill',
    durationSec: 6,
    stackable: false,
    maxStacks: 1,
    dispellable: true,
    effects: [
      {
        kind: 'control',
        value: 2,
        statTarget: null,
        elementTarget: null,
      },
    ],
  },
  {
    key: 'debuff_taunt_moc',
    name: 'Mộc Linh Khiêu Khích',
    description: 'Mộc linh chú khiến địch tập trung tấn công người niệm — 5 giây.',
    polarity: 'debuff',
    element: 'moc',
    source: 'skill',
    durationSec: 5,
    stackable: false,
    maxStacks: 1,
    dispellable: true,
    effects: [
      {
        kind: 'taunt',
        value: 1,
        statTarget: null,
        elementTarget: null,
      },
    ],
  },
  // ----- SKILL DOT — 2 -----
  {
    key: 'debuff_burn_hoa',
    name: 'Hoả Long Phún',
    description:
      'Bị bỏng — chịu 8 sát thương mỗi lượt trong 5 lượt; rồng lửa không tắt.',
    polarity: 'debuff',
    element: 'hoa',
    source: 'skill',
    durationSec: 15,
    stackable: true,
    maxStacks: 3,
    dispellable: true,
    effects: [
      {
        kind: 'dot',
        value: 8,
        statTarget: null,
        elementTarget: null,
      },
    ],
  },
  {
    key: 'debuff_poison_moc',
    name: 'Mộc Độc Trầm Cốt',
    description: 'Trúng độc — chịu 6 sát thương mỗi lượt trong 8 lượt.',
    polarity: 'debuff',
    element: 'moc',
    source: 'skill',
    durationSec: 24,
    stackable: true,
    maxStacks: 3,
    dispellable: true,
    effects: [
      {
        kind: 'dot',
        value: 6,
        statTarget: null,
        elementTarget: null,
      },
    ],
  },
  // ----- BOSS DEBUFF — 1 -----
  {
    key: 'debuff_boss_atk_down',
    name: 'Bá Vương Áp',
    description:
      'Boss áp lực vô hình — công kích bị giảm 18% trong 30 giây (boss skill).',
    polarity: 'debuff',
    element: null,
    source: 'boss_skill',
    durationSec: 30,
    stackable: false,
    maxStacks: 1,
    dispellable: true,
    effects: [
      {
        kind: 'stat_mod',
        value: 0.82,
        statTarget: 'atk',
        elementTarget: null,
      },
    ],
  },
  // ----- TRIBULATION TÂM MA — 1 -----
  {
    key: 'debuff_taoma',
    name: 'Tâm Ma Triền Thân',
    description:
      'Sau khi vượt kiếp thất bại — Tâm Ma quấy nhiễu: công kích -10% và không thể tu luyện.',
    polarity: 'debuff',
    element: null,
    source: 'tribulation',
    durationSec: 3600,
    stackable: false,
    maxStacks: 1,
    dispellable: false,
    effects: [
      {
        kind: 'stat_mod',
        value: 0.9,
        statTarget: 'atk',
        elementTarget: null,
      },
      {
        kind: 'cultivation_block',
        value: 1,
        statTarget: null,
        elementTarget: null,
      },
    ],
  },
  // ----- BREAKTHROUGH TÂM MA NHẸ (Phase 11 nâng cao §5 PR2 prep) — 1 -----
  // Forward-compat: catalog only. Runtime wire (apply trên breakthrough fail
  // + consume cultivationRateMul trong CultivationProcessor) sẽ ở PR2 wire.
  // Khác `debuff_taoma` (full): duration 5min vs 60min, rate × 0.7 vs full
  // block, source=`breakthrough` vs `tribulation`. Match dial
  // `BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC` + `BREAKTHROUGH_FAIL_DEBUFF_RATE_PENALTY`.
  {
    key: 'tam_ma_light',
    name: 'Tâm Ma Nhẹ',
    description:
      'Sau khi đột phá thất bại — Tâm Ma nhiễu loạn nhẹ: tốc độ tu luyện ' +
      '× 0.7 trong 5 phút. Tự hết, không cần dispel.',
    polarity: 'debuff',
    element: null,
    source: 'breakthrough',
    durationSec: BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC,
    stackable: false,
    maxStacks: 1,
    dispellable: false,
    effects: [
      {
        kind: 'cultivation_rate_mul',
        value: BREAKTHROUGH_FAIL_DEBUFF_RATE_PENALTY,
        statTarget: null,
        elementTarget: null,
      },
    ],
  },
];

const BUFFS_BY_KEY = new Map<string, BuffDef>(
  BUFFS.map((b) => [b.key, b])
);

/**
 * Lookup buff by key.
 */
export function getBuffDef(key: string): BuffDef | undefined {
  return BUFFS_BY_KEY.get(key);
}

/**
 * Filter theo polarity.
 */
export function buffsByPolarity(
  polarity: BuffPolarity
): readonly BuffDef[] {
  return BUFFS.filter((b) => b.polarity === polarity);
}

/**
 * Filter theo element (null = neutral).
 */
export function buffsByElement(
  element: ElementKey | null
): readonly BuffDef[] {
  return BUFFS.filter((b) => b.element === element);
}

/**
 * Filter theo source.
 */
export function buffsBySource(source: BuffSource): readonly BuffDef[] {
  return BUFFS.filter((b) => b.source === source);
}

/**
 * Phase 11.10.E — cross-ref helper: tìm BuffDef sẽ apply khi player consume
 * 1 item (pill/elixir). Dùng cho `InventoryService.use()` post-decrement +
 * catalog cross-ref tests guard against drift.
 *
 * Trả về `undefined` nếu:
 *   - itemKey không có trong catalog (`itemByKey` miss).
 *   - item def không có `effect.buffKey` set.
 *   - `effect.buffKey` trỏ tới buff không tồn tại (catalog drift).
 */
export function buffForItem(itemKey: string): BuffDef | undefined {
  const item = itemByKey(itemKey);
  if (!item || !item.effect?.buffKey) return undefined;
  return getBuffDef(item.effect.buffKey);
}

/**
 * Filter theo effect kind (across both buff/debuff polarity).
 *
 * Useful cho tìm "tất cả buff làm tăng atk" hoặc "tất cả DOT debuff".
 */
export function buffsByEffectKind(
  kind: BuffEffectKind
): readonly BuffDef[] {
  return BUFFS.filter((b) => b.effects.some((e) => e.kind === kind));
}

/**
 * Composed mods after applying một list buff/debuff đang active.
 *
 * Convention:
 * - `stat_mod` × multiplicative.
 * - `regen` + additive.
 * - `damage_bonus` element-keyed × multiplicative theo element.
 * - `damage_reduction` element-keyed × multiplicative theo element (giảm damage nhận).
 * - `control` flags: max ccTurns còn lại trong list (root/stun/silence/taunt).
 * - `dot` flat damage tổng cộng / tick.
 * - `shield` % hpMax tổng cộng (cap 1.0).
 * - `cultivationBlocked`: true nếu có buff với cultivation_block.
 * - `invuln`: true nếu có invuln effect.
 *
 * Stack handling: nếu buff stackable, multiplier áp `value^stacks` (vd
 * burn 8 dmg × 2 stacks = 16 dmg/tick).
 */
export interface BuffMods {
  readonly atkMul: number;
  readonly defMul: number;
  readonly hpMaxMul: number;
  readonly mpMaxMul: number;
  readonly spiritMul: number;
  readonly hpRegenFlat: number;
  readonly mpRegenFlat: number;
  readonly damageBonusByElement: ReadonlyMap<ElementKey, number>;
  readonly damageReductionByElement: ReadonlyMap<ElementKey, number>;
  readonly dotPerTickFlat: number;
  readonly shieldHpMaxRatio: number;
  readonly controlTurnsMax: number;
  readonly tauntActive: boolean;
  readonly invulnActive: boolean;
  readonly cultivationBlocked: boolean;
  /**
   * Multiplier áp lên cultivation rate (EXP/tick). Default 1 = không đổi.
   * Compose multiplicative per stack qua `cultivation_rate_mul` effect.
   * Forward-compat: `CultivationProcessor` chưa consume — sẽ wire ở Phase
   * 11 nâng cao §5 PR2 wire (Tâm Ma debuff áp 0.7 sau breakthrough fail).
   */
  readonly cultivationRateMul: number;
}

export interface ActiveBuff {
  readonly buffKey: string;
  readonly stacks: number;
}

export function composeBuffMods(
  activeBuffs: readonly ActiveBuff[]
): BuffMods {
  let atkMul = 1;
  let defMul = 1;
  let hpMaxMul = 1;
  let mpMaxMul = 1;
  let spiritMul = 1;
  let hpRegenFlat = 0;
  let mpRegenFlat = 0;
  let dotPerTickFlat = 0;
  let shieldHpMaxRatio = 0;
  let controlTurnsMax = 0;
  let tauntActive = false;
  let invulnActive = false;
  let cultivationBlocked = false;
  let cultivationRateMul = 1;
  const damageBonusByElement = new Map<ElementKey, number>();
  const damageReductionByElement = new Map<ElementKey, number>();

  for (const ab of activeBuffs) {
    const def = BUFFS_BY_KEY.get(ab.buffKey);
    if (!def) continue;
    if (!Number.isFinite(ab.stacks) || ab.stacks < 1) continue;
    const stacks = Math.min(Math.floor(ab.stacks), def.maxStacks);

    for (const eff of def.effects) {
      switch (eff.kind) {
        case 'stat_mod': {
          // Multiplicative per stack. Vd 1.10 × 2 stacks = 1.21.
          const mulStacked = Math.pow(eff.value, stacks);
          if (eff.statTarget === 'atk') atkMul *= mulStacked;
          else if (eff.statTarget === 'def') defMul *= mulStacked;
          else if (eff.statTarget === 'hpMax') hpMaxMul *= mulStacked;
          else if (eff.statTarget === 'mpMax') mpMaxMul *= mulStacked;
          else if (eff.statTarget === 'spirit') spiritMul *= mulStacked;
          break;
        }
        case 'regen': {
          // Additive per stack.
          const flat = eff.value * stacks;
          if (eff.statTarget === 'hpMax') hpRegenFlat += flat;
          else if (eff.statTarget === 'mpMax') mpRegenFlat += flat;
          break;
        }
        case 'damage_bonus': {
          if (eff.elementTarget) {
            const cur = damageBonusByElement.get(eff.elementTarget) ?? 1;
            damageBonusByElement.set(
              eff.elementTarget,
              cur * Math.pow(eff.value, stacks)
            );
          } else {
            // No element target = global damage_bonus → áp tất cả 5 element.
            for (const elem of [
              'kim',
              'moc',
              'thuy',
              'hoa',
              'tho',
            ] as const) {
              const cur = damageBonusByElement.get(elem) ?? 1;
              damageBonusByElement.set(
                elem,
                cur * Math.pow(eff.value, stacks)
              );
            }
          }
          break;
        }
        case 'damage_reduction': {
          if (eff.elementTarget) {
            const cur = damageReductionByElement.get(eff.elementTarget) ?? 1;
            damageReductionByElement.set(
              eff.elementTarget,
              cur * Math.pow(eff.value, stacks)
            );
          }
          break;
        }
        case 'control': {
          const turns = Math.floor(eff.value);
          if (turns > controlTurnsMax) controlTurnsMax = turns;
          break;
        }
        case 'dot': {
          dotPerTickFlat += eff.value * stacks;
          break;
        }
        case 'shield': {
          // Additive shield ratio, cap 1.0 hpMax.
          shieldHpMaxRatio = Math.min(1.0, shieldHpMaxRatio + eff.value * stacks);
          break;
        }
        case 'taunt': {
          tauntActive = true;
          break;
        }
        case 'invuln': {
          invulnActive = true;
          break;
        }
        case 'cultivation_block': {
          cultivationBlocked = true;
          break;
        }
        case 'cultivation_rate_mul': {
          // Multiplicative per stack — chained với mọi rate_mul effect khác
          // (vd nhiều debuff cộng dồn). 1 = identity, < 1 = penalty.
          cultivationRateMul *= Math.pow(eff.value, stacks);
          break;
        }
      }
    }
  }

  return {
    atkMul,
    defMul,
    hpMaxMul,
    mpMaxMul,
    spiritMul,
    hpRegenFlat,
    mpRegenFlat,
    damageBonusByElement,
    damageReductionByElement,
    dotPerTickFlat,
    shieldHpMaxRatio,
    controlTurnsMax,
    tauntActive,
    invulnActive,
    cultivationBlocked,
    cultivationRateMul,
  };
}

/**
 * Tính `expiresAt` cho buff mới apply.
 *
 * @param now Date gốc (server time).
 * @param def Buff def.
 * @param overrideDurationSec Optional override (vd skill level scale).
 * @returns Expiration `Date`.
 */
export function computeBuffExpiresAt(
  now: Date,
  def: BuffDef,
  overrideDurationSec?: number
): Date {
  const duration = overrideDurationSec ?? def.durationSec;
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(
      `duration must be non-negative finite, got ${duration}`
    );
  }
  return new Date(now.getTime() + duration * 1000);
}

/**
 * Check buff đã expire?
 *
 * @param now Server time hiện tại.
 * @param expiresAt Buff expire time.
 */
export function isBuffExpired(now: Date, expiresAt: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}
