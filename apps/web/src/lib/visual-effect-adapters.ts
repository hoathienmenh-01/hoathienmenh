/**
 * Phase 42.0 — Visual effect adapters (pure mapping functions).
 *
 * Đây là layer mỏng map domain objects (combat result row, drop event,
 * boss event, breakthrough result, craft result, item card props) sang
 * presentation props của các effect component / queue entry.
 *
 * Quy tắc:
 *   - Pure functions, không gọi DB / store / network.
 *   - Tolerant với input thiếu / sai kiểu — fallback an toàn.
 *   - KHÔNG sửa gameplay; chỉ đọc + map.
 */
import {
  getBossWarningEffect,
  getEffectByDamageType,
  getEffectByRarity,
  getEffectOrFallback,
  getItemAuraEffect,
  type VisualEffectDef,
  type VisualEffectElement,
  type VisualEffectRarity,
} from '@xuantoi/shared';

/** Combat damage event nhẹ — chỉ cần các field hay xuất hiện trong combat log. */
export interface CombatDamageInput {
  amount?: number | null;
  type?: string | null;
  isCrit?: boolean | null;
  isMiss?: boolean | null;
  isBlocked?: boolean | null;
  shieldAbsorb?: number | null;
  element?: string | null;
  lifesteal?: number | null;
  counter?: boolean | null;
  dot?: boolean | null;
  heal?: number | null;
}

export interface MappedCombatVisualEvent {
  effect: VisualEffectDef;
  label: string;
  amount: number | null;
  /** Có nên hiện floating combat text không (false → chỉ ghi log). */
  surface: boolean;
}

const ELEMENT_ALIAS_TO_VISUAL: Record<string, VisualEffectElement> = {
  KIM: 'METAL',
  MOC: 'WOOD',
  THUY: 'WATER',
  HOA: 'FIRE',
  THO: 'EARTH',
  FIRE: 'FIRE',
  WATER: 'WATER',
  WOOD: 'WOOD',
  METAL: 'METAL',
  EARTH: 'EARTH',
  LIGHTNING: 'LIGHTNING',
  WIND: 'WIND',
  DARK: 'DARK',
  LIGHT: 'LIGHT',
  CHAOS: 'CHAOS',
  VOID: 'VOID',
};

function normalizeElement(input?: string | null): VisualEffectElement | undefined {
  if (!input) return undefined;
  const k = input.toUpperCase();
  return ELEMENT_ALIAS_TO_VISUAL[k];
}

const RARITY_ALIAS: Record<string, VisualEffectRarity> = {
  COMMON: 'COMMON',
  UNCOMMON: 'UNCOMMON',
  RARE: 'RARE',
  EPIC: 'EPIC',
  LEGENDARY: 'LEGENDARY',
  MYTHIC: 'MYTHIC',
  IMMORTAL: 'IMMORTAL',
  // Equipment quality aliases (Quality enum)
  PHAM: 'COMMON',
  LINH: 'UNCOMMON',
  HUYEN: 'RARE',
  TIEN: 'EPIC',
  THAN: 'LEGENDARY',
};

function normalizeRarity(input?: string | null): VisualEffectRarity | undefined {
  if (!input) return undefined;
  return RARITY_ALIAS[input.toUpperCase()];
}

export function mapCombatDamageToVisualEvent(
  input: CombatDamageInput,
): MappedCombatVisualEvent {
  const element = normalizeElement(input.element ?? undefined);

  if (input.isMiss) {
    return {
      effect: getEffectByDamageType('miss'),
      label: 'MISS',
      amount: null,
      surface: true,
    };
  }
  if (input.heal != null && input.heal > 0) {
    return {
      effect: getEffectByDamageType('heal'),
      label: '+HP',
      amount: input.heal,
      surface: true,
    };
  }
  if (input.shieldAbsorb != null && input.shieldAbsorb > 0) {
    return {
      effect: getEffectByDamageType('shield'),
      label: 'SHIELD',
      amount: input.shieldAbsorb,
      surface: true,
    };
  }
  if (input.isBlocked) {
    return {
      effect: getEffectByDamageType('block'),
      label: 'BLOCK',
      amount: input.amount ?? null,
      surface: true,
    };
  }
  if (input.dot) {
    return {
      effect: getEffectByDamageType('dot'),
      label: 'DOT',
      amount: input.amount ?? null,
      surface: true,
    };
  }
  if (input.lifesteal != null && input.lifesteal > 0) {
    return {
      effect: getEffectByDamageType('lifesteal'),
      label: 'Hấp huyết',
      amount: input.lifesteal,
      surface: true,
    };
  }
  if (input.counter) {
    return {
      effect: getEffectByDamageType('counter'),
      label: 'COUNTER',
      amount: input.amount ?? null,
      surface: true,
    };
  }
  if (input.isCrit) {
    return {
      effect: getEffectByDamageType('crit'),
      label: 'CRIT',
      amount: input.amount ?? null,
      surface: true,
    };
  }
  return {
    effect: getEffectByDamageType('normal', element),
    label: 'DMG',
    amount: input.amount ?? null,
    surface: true,
  };
}

/** Drop event → rare drop popup props (hoặc null nếu rarity quá thấp). */
export interface DropToRarePopupInput {
  itemName?: string | null;
  itemKey?: string | null;
  rarity?: string | null;
  tier?: number | null;
  source?: string | null;
  iconUrl?: string | null;
  element?: string | null;
  quantity?: number | null;
}

export interface MappedRareDropPopup {
  effectKey: string;
  rarity: VisualEffectRarity;
  itemName: string;
  source: string;
  tier: number | null;
  element: VisualEffectElement | null;
  quantity: number;
  priority: number;
}

export function mapDropToRareDropPopup(
  input: DropToRarePopupInput,
): MappedRareDropPopup | null {
  const rarity = normalizeRarity(input.rarity ?? undefined);
  if (!rarity) return null;
  const effect = getEffectByRarity(rarity);
  if (!effect) return null;
  return {
    effectKey: effect.key,
    rarity,
    itemName: input.itemName ?? input.itemKey ?? '???',
    source: input.source ?? '',
    tier: input.tier ?? null,
    element: normalizeElement(input.element ?? undefined) ?? null,
    quantity: input.quantity ?? 1,
    priority: effect.priority,
  };
}

/** Item card props → aura effect def (cho ItemAuraFrame). */
export interface ItemToAuraInput {
  tier?: number | null;
  rarity?: string | null;
  quality?: string | null;
  element?: string | null;
  itemType?: string | null;
  equipped?: boolean | null;
}

export interface MappedItemAura {
  effectKey: string;
  cssClass: string;
  elementClass: string;
  intensity: VisualEffectDef['intensity'];
  description: string;
}

export function mapItemToAuraProps(input: ItemToAuraInput): MappedItemAura {
  const tier = typeof input.tier === 'number' && input.tier > 0 ? input.tier : 1;
  const rarity = normalizeRarity(input.rarity ?? undefined) ?? 'COMMON';
  const element = normalizeElement(input.element ?? undefined);
  const effect = getItemAuraEffect(tier, rarity, element);
  return {
    effectKey: effect.key,
    cssClass: auraCssForKey(effect.key),
    elementClass: element ? `ve-element-${element.toLowerCase()}` : '',
    intensity: effect.intensity,
    description: effect.description,
  };
}

function auraCssForKey(key: string): string {
  switch (key) {
    case 'ITEM_AURA_NONE':
      return 've-aura-none';
    case 'ITEM_AURA_LOW':
      return 've-aura-low';
    case 'ITEM_AURA_MEDIUM':
      return 've-aura-medium';
    case 'ITEM_AURA_HIGH':
      return 've-aura-high';
    case 'ITEM_AURA_LEGENDARY':
      return 've-aura-legendary';
    case 'ITEM_AURA_IMMORTAL':
      return 've-aura-immortal';
    default:
      // Elemental aura variants treat as MEDIUM intensity visually.
      return 've-aura-medium';
  }
}

/** Boss event → warning banner props. */
export type BossWarningType =
  | 'BOSS_APPEAR'
  | 'BOSS_WARNING'
  | 'BOSS_CHARGING'
  | 'BOSS_ENRAGE'
  | 'BOSS_SHIELD'
  | 'BOSS_HEALING'
  | 'BOSS_LOW_HP'
  | 'BOSS_DEFEATED';

export interface BossEventInput {
  bossName?: string | null;
  warningType?: BossWarningType | string | null;
  turnsRemaining?: number | null;
  message?: string | null;
  hpPercent?: number | null;
  element?: string | null;
}

export interface MappedBossWarning {
  bossName: string;
  warningType: BossWarningType;
  turnsRemaining: number | null;
  message: string;
  severity: 'INFO' | 'WARNING' | 'DANGER' | 'FATAL';
  effectKey: string;
  hpPercent: number | null;
  element: VisualEffectElement | null;
}

const BOSS_SEVERITY: Record<BossWarningType, 'INFO' | 'WARNING' | 'DANGER' | 'FATAL'> = {
  BOSS_APPEAR: 'INFO',
  BOSS_WARNING: 'WARNING',
  BOSS_CHARGING: 'WARNING',
  BOSS_ENRAGE: 'DANGER',
  BOSS_SHIELD: 'INFO',
  BOSS_HEALING: 'INFO',
  BOSS_LOW_HP: 'WARNING',
  BOSS_DEFEATED: 'INFO',
};

export function mapBossEventToWarning(input: BossEventInput): MappedBossWarning | null {
  const warningType = (input.warningType ?? 'BOSS_WARNING') as BossWarningType;
  if (BOSS_SEVERITY[warningType] === undefined) return null;
  const effect = getBossWarningEffect(warningType);
  return {
    bossName: input.bossName ?? '???',
    warningType,
    turnsRemaining: input.turnsRemaining ?? null,
    message: input.message ?? '',
    severity: BOSS_SEVERITY[warningType],
    effectKey: effect.key,
    hpPercent: input.hpPercent ?? null,
    element: normalizeElement(input.element ?? undefined) ?? null,
  };
}

/** Breakthrough result → banner props. */
export interface BreakthroughInput {
  characterName?: string | null;
  fromRealm?: string | null;
  toRealm?: string | null;
  success?: boolean | null;
  breakthroughType?: 'CULTIVATION' | 'BODY_CULTIVATION' | string | null;
  message?: string | null;
  rewardSummary?: string | null;
}

export interface MappedBreakthroughBanner {
  characterName: string;
  fromRealm: string;
  toRealm: string;
  success: boolean;
  breakthroughType: 'CULTIVATION' | 'BODY_CULTIVATION';
  message: string;
  rewardSummary: string;
  effectKey: string;
}

export function mapBreakthroughResultToBanner(
  input: BreakthroughInput,
): MappedBreakthroughBanner {
  const success = !!input.success;
  const bt = (input.breakthroughType ?? 'CULTIVATION') as
    | 'CULTIVATION'
    | 'BODY_CULTIVATION';
  let effectKey: string;
  if (bt === 'BODY_CULTIVATION') {
    effectKey = 'BODY_BREAKTHROUGH';
  } else {
    effectKey = success ? 'REALM_BREAKTHROUGH' : 'REALM_BREAKTHROUGH_FAILED';
  }
  // Defensive: ensure key exists in catalog
  getEffectOrFallback(effectKey);
  return {
    characterName: input.characterName ?? '',
    fromRealm: input.fromRealm ?? '',
    toRealm: input.toRealm ?? '',
    success,
    breakthroughType: bt,
    message: input.message ?? '',
    rewardSummary: input.rewardSummary ?? '',
    effectKey,
  };
}

/** Alchemy / craft result → effect props. */
export type CraftResultType =
  | 'ALCHEMY_SUCCESS'
  | 'ALCHEMY_FAIL'
  | 'ALCHEMY_HIGH_QUALITY'
  | 'DAN_VAN_APPEAR'
  | 'CRAFT_SUCCESS'
  | 'CRAFT_FAIL'
  | 'ARTIFACT_AWAKEN';

export interface CraftResultInput {
  resultType?: CraftResultType | string | null;
  itemName?: string | null;
  quality?: string | null;
  tier?: number | null;
  rarity?: string | null;
  element?: string | null;
  message?: string | null;
}

export interface MappedCraftingEffect {
  resultType: CraftResultType;
  itemName: string;
  quality: string | null;
  tier: number | null;
  rarity: VisualEffectRarity | null;
  element: VisualEffectElement | null;
  message: string;
  effectKey: string;
  priority: number;
}

const CRAFT_TYPES: readonly CraftResultType[] = [
  'ALCHEMY_SUCCESS',
  'ALCHEMY_FAIL',
  'ALCHEMY_HIGH_QUALITY',
  'DAN_VAN_APPEAR',
  'CRAFT_SUCCESS',
  'CRAFT_FAIL',
  'ARTIFACT_AWAKEN',
] as const;

export function mapCraftResultToEffect(
  input: CraftResultInput,
): MappedCraftingEffect | null {
  const t = (input.resultType ?? '') as CraftResultType;
  if (!CRAFT_TYPES.includes(t)) return null;
  const effect = getEffectOrFallback(t);
  return {
    resultType: t,
    itemName: input.itemName ?? '',
    quality: input.quality ?? null,
    tier: input.tier ?? null,
    rarity: normalizeRarity(input.rarity ?? undefined) ?? null,
    element: normalizeElement(input.element ?? undefined) ?? null,
    message: input.message ?? '',
    effectKey: effect.key,
    priority: effect.priority,
  };
}
