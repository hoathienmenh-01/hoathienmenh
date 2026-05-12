import { REALMS } from './realms';
import type { EquipSlot, Quality } from './enums';

export type EquipmentTierNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type EquipmentGradeWithinTier = 'I' | 'II' | 'III';

export interface EquipmentTierDef {
  tier: EquipmentTierNumber;
  name: string;
  minRealmOrder: number;
  maxRealmOrder: number;
  basePower: number;
}

export type EquipmentSlotLike =
  | EquipSlot
  | 'weapon'
  | 'armor'
  | 'chest'
  | 'helmet'
  | 'hat'
  | 'boots'
  | 'ring'
  | 'amulet'
  | 'belt'
  | 'offhand'
  | 'artifact'
  | 'tram';

export interface EquipmentPowerInput {
  equipmentTier?: number;
  equipmentGradeWithinTier?: EquipmentGradeWithinTier | null;
  requiredRealmOrder?: number;
  quality: Quality;
  slot: EquipmentSlotLike;
  enhanceLevel?: number;
  gemBonusRatio?: number;
  setBonusRatio?: number;
}

export interface EquipmentProgressionItem extends Partial<EquipmentPowerInput> {
  key?: string;
  powerBudget?: number;
  computedPowerScore?: number;
  maxEnhanceLevel?: number;
  maxSocketCount?: number;
}

export interface DeriveEquipmentProgressionInput {
  key?: string;
  quality: Quality;
  slot?: EquipmentSlotLike;
  equipmentTier?: number;
  equipmentGradeWithinTier?: EquipmentGradeWithinTier | null;
  requiredRealmOrder?: number;
  requiredRealmKey?: string;
  enhanceLevel?: number;
  gemBonusRatio?: number;
  setBonusRatio?: number;
}

export interface EquipmentProgressionMetadata {
  equipmentTier: EquipmentTierNumber;
  equipmentTierName: string;
  equipmentGradeWithinTier: EquipmentGradeWithinTier | null;
  requiredRealmOrder: number;
  requiredRealmKey?: string;
  powerBudget: number;
  computedPowerScore: number;
  maxEnhanceLevel: number;
  maxSocketCount: number;
}

export interface EquipmentProgressionValidationResult {
  ok: boolean;
  errors: string[];
  metadata: EquipmentProgressionMetadata | null;
}

export const EQUIPMENT_TIERS: readonly EquipmentTierDef[] = [
  { tier: 1, name: 'Phàm Khí', minRealmOrder: 1, maxRealmOrder: 3, basePower: 100 },
  { tier: 2, name: 'Linh Khí', minRealmOrder: 4, maxRealmOrder: 6, basePower: 260 },
  { tier: 3, name: 'Huyền Khí', minRealmOrder: 7, maxRealmOrder: 9, basePower: 680 },
  { tier: 4, name: 'Địa Khí', minRealmOrder: 10, maxRealmOrder: 12, basePower: 1_750 },
  { tier: 5, name: 'Thiên Khí', minRealmOrder: 13, maxRealmOrder: 15, basePower: 4_500 },
  { tier: 6, name: 'Tiên Khí', minRealmOrder: 16, maxRealmOrder: 18, basePower: 11_500 },
  { tier: 7, name: 'Thánh Khí', minRealmOrder: 19, maxRealmOrder: 21, basePower: 29_000 },
  { tier: 8, name: 'Đạo Khí', minRealmOrder: 22, maxRealmOrder: 24, basePower: 72_000 },
  {
    tier: 9,
    name: 'Bản Nguyên Chí Bảo',
    minRealmOrder: 25,
    maxRealmOrder: 27,
    basePower: 175_000,
  },
  {
    tier: 10,
    name: 'Hư Không Chí Bảo',
    minRealmOrder: 28,
    maxRealmOrder: 28,
    basePower: 420_000,
  },
] as const;

const QUALITY_MULTIPLIERS: Readonly<Record<Quality, number>> = {
  PHAM: 1,
  LINH: 1.15,
  HUYEN: 1.35,
  TIEN: 1.6,
  THAN: 1.9,
};

const ENHANCE_CAP_BY_TIER: Readonly<Record<EquipmentTierNumber, number>> = {
  1: 5,
  2: 7,
  3: 9,
  4: 11,
  5: 13,
  6: 15,
  7: 17,
  8: 19,
  9: 21,
  10: 23,
};

const QUALITY_SOCKET_CAP: Readonly<Record<Quality, number>> = {
  PHAM: 0,
  LINH: 1,
  HUYEN: 1,
  TIEN: 2,
  THAN: 3,
};

const GRADE_POWER_MULTIPLIER: Readonly<Record<EquipmentGradeWithinTier, number>> = {
  I: 1,
  II: 1.08,
  III: 1.16,
};

export const EQUIPMENT_ENHANCE_MULTIPLIER_PER_LEVEL = 0.03;
export const EQUIPMENT_GEM_BONUS_RATIO_CAP = 0.2;
export const EQUIPMENT_SET_BONUS_CAPS = {
  twoPiece: { min: 0.03, max: 0.05 },
  fourPiece: { min: 0.06, max: 0.1 },
  sixPiece: { min: 0.1, max: 0.15 },
} as const;

export function getEquipmentTierForRealmOrder(realmOrder: number): EquipmentTierDef {
  assertRealmOrder(realmOrder);
  const tier = EQUIPMENT_TIERS.find(
    (t) => realmOrder >= t.minRealmOrder && realmOrder <= t.maxRealmOrder,
  );
  if (!tier) throw new RangeError(`No equipment tier for realmOrder ${realmOrder}`);
  return tier;
}

export function getEquipmentGradeWithinTier(
  realmOrder: number,
): EquipmentGradeWithinTier | null {
  const tier = getEquipmentTierForRealmOrder(realmOrder);
  if (tier.tier === 10) return null;
  const index = realmOrder - tier.minRealmOrder;
  return (['I', 'II', 'III'] as const)[index];
}

export function getRequiredRealmOrderForTierGrade(
  tier: number,
  grade: EquipmentGradeWithinTier | null = 'I',
): number {
  const tierDef = getTierDef(tier);
  if (tierDef.tier === 10) return 28;
  if (grade === null) {
    throw new RangeError('Tier 1-9 equipment requires grade I, II, or III');
  }
  return tierDef.minRealmOrder + (grade === 'I' ? 0 : grade === 'II' ? 1 : 2);
}

export function getQualityMultiplier(quality: Quality): number {
  return QUALITY_MULTIPLIERS[quality];
}

export function getSlotWeight(slot: EquipmentSlotLike): number {
  switch (normalizeSlot(slot)) {
    case 'WEAPON':
      return 1;
    case 'ARMOR':
      return 0.85;
    case 'HAT':
    case 'TRAM':
      return 0.55;
    case 'BOOTS':
      return 0.45;
    case 'BELT':
      return 0.35;
    case 'ARTIFACT':
      return 0.7;
    case 'RING':
    case 'AMULET':
      return 0.4;
    case 'OFFHAND':
      return 0.7;
  }
}

export function getTierBasePower(tier: number): number {
  return getTierDef(tier).basePower;
}

export function getEnhanceCapForTier(tier: number): number {
  return ENHANCE_CAP_BY_TIER[getTierDef(tier).tier];
}

export function getSocketCapForTierAndQuality(tier: number, quality: Quality): number {
  const tierCap = getTierSocketCap(getTierDef(tier).tier);
  return Math.min(tierCap, QUALITY_SOCKET_CAP[quality]);
}

export function getSetBonusCapForPieceCount(pieceCount: number): number {
  if (pieceCount >= 6) return EQUIPMENT_SET_BONUS_CAPS.sixPiece.max;
  if (pieceCount >= 4) return EQUIPMENT_SET_BONUS_CAPS.fourPiece.max;
  if (pieceCount >= 2) return EQUIPMENT_SET_BONUS_CAPS.twoPiece.max;
  return 0;
}

export function computeEquipmentPowerBudget(input: EquipmentPowerInput): number {
  const requiredRealmOrder =
    input.requiredRealmOrder ??
    getRequiredRealmOrderForTierGrade(
      requireEquipmentTierNumber(input.equipmentTier),
      input.equipmentGradeWithinTier ?? 'I',
    );
  const tier = input.equipmentTier
    ? getTierDef(input.equipmentTier)
    : getEquipmentTierForRealmOrder(requiredRealmOrder);
  const grade =
    input.equipmentGradeWithinTier ?? getEquipmentGradeWithinTier(requiredRealmOrder);
  const gradeMultiplier = grade === null ? 1 : GRADE_POWER_MULTIPLIER[grade];
  return Math.round(
    tier.basePower *
      gradeMultiplier *
      getQualityMultiplier(input.quality) *
      getSlotWeight(input.slot),
  );
}

export function computeEquipmentPowerScore(item: EquipmentPowerInput): number {
  const tier = item.equipmentTier
    ? getTierDef(item.equipmentTier)
    : getEquipmentTierForRealmOrder(requiredRealmOrderFor(item));
  const enhanceLevel = item.enhanceLevel ?? 0;
  const gemBonusRatio = item.gemBonusRatio ?? 0;
  const setBonusRatio = item.setBonusRatio ?? 0;
  assertRatio('gemBonusRatio', gemBonusRatio, EQUIPMENT_GEM_BONUS_RATIO_CAP);
  assertRatio('setBonusRatio', setBonusRatio, EQUIPMENT_SET_BONUS_CAPS.sixPiece.max);
  if (!Number.isInteger(enhanceLevel) || enhanceLevel < 0) {
    throw new RangeError(`Invalid enhanceLevel ${enhanceLevel}`);
  }
  const cap = getEnhanceCapForTier(tier.tier);
  if (enhanceLevel > cap) {
    throw new RangeError(`enhanceLevel ${enhanceLevel} exceeds tier ${tier.tier} cap ${cap}`);
  }
  const baseBudget = computeEquipmentPowerBudget(item);
  const enhanceMultiplier = 1 + enhanceLevel * EQUIPMENT_ENHANCE_MULTIPLIER_PER_LEVEL;
  return Math.round(baseBudget * enhanceMultiplier * (1 + gemBonusRatio + setBonusRatio));
}

export function canEquipItemAtRealm(
  item: Pick<EquipmentProgressionItem, 'slot' | 'requiredRealmOrder'>,
  characterRealmOrder: number,
): boolean {
  if (!item.slot) return true;
  if (!Number.isInteger(characterRealmOrder) || characterRealmOrder < 1) return false;
  if (item.requiredRealmOrder === undefined) return false;
  return characterRealmOrder >= item.requiredRealmOrder;
}

export function validateEquipmentProgression(
  item: EquipmentProgressionItem,
): EquipmentProgressionValidationResult {
  const errors: string[] = [];
  if (!item.slot) return { ok: true, errors, metadata: null };
  if (item.requiredRealmOrder === undefined) errors.push('MISSING_REQUIRED_REALM_ORDER');
  if (!item.quality) errors.push('MISSING_QUALITY');
  if (errors.length > 0) return { ok: false, errors, metadata: null };
  try {
    const requiredRealmOrder = requiredRealmOrderFor(item);
    const tier = getEquipmentTierForRealmOrder(requiredRealmOrder);
    const grade = item.equipmentGradeWithinTier ?? getEquipmentGradeWithinTier(requiredRealmOrder);
    if (item.equipmentTier !== undefined && item.equipmentTier !== tier.tier) {
      errors.push('EQUIPMENT_TIER_MISMATCH');
    }
    if (item.equipmentGradeWithinTier !== undefined && item.equipmentGradeWithinTier !== grade) {
      errors.push('EQUIPMENT_GRADE_MISMATCH');
    }
    const maxEnhanceLevel = getEnhanceCapForTier(tier.tier);
    const maxSocketCount = getSocketCapForTierAndQuality(tier.tier, item.quality as Quality);
    if (item.maxEnhanceLevel !== undefined && item.maxEnhanceLevel !== maxEnhanceLevel) {
      errors.push('MAX_ENHANCE_LEVEL_MISMATCH');
    }
    if (item.maxSocketCount !== undefined && item.maxSocketCount > maxSocketCount) {
      errors.push('MAX_SOCKET_COUNT_EXCEEDS_CAP');
    }
    const powerBudget = computeEquipmentPowerBudget({
      requiredRealmOrder,
      equipmentTier: tier.tier,
      equipmentGradeWithinTier: grade,
      quality: item.quality as Quality,
      slot: item.slot,
    });
    const computedPowerScore = computeEquipmentPowerScore({
      requiredRealmOrder,
      equipmentTier: tier.tier,
      equipmentGradeWithinTier: grade,
      quality: item.quality as Quality,
      slot: item.slot,
      enhanceLevel: item.enhanceLevel,
      gemBonusRatio: item.gemBonusRatio,
      setBonusRatio: item.setBonusRatio,
    });
    if (item.powerBudget !== undefined && item.powerBudget > powerBudget) {
      errors.push('POWER_BUDGET_EXCEEDED');
    }
    if (item.computedPowerScore !== undefined && item.computedPowerScore > computedPowerScore) {
      errors.push('POWER_SCORE_EXCEEDED');
    }
    return {
      ok: errors.length === 0,
      errors,
      metadata: {
        equipmentTier: tier.tier,
        equipmentTierName: tier.name,
        equipmentGradeWithinTier: grade,
        requiredRealmOrder,
        powerBudget,
        computedPowerScore,
        maxEnhanceLevel,
        maxSocketCount,
      },
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'INVALID_EQUIPMENT_PROGRESSION');
    return { ok: false, errors, metadata: null };
  }
}

export function deriveEquipmentProgressionMetadata(
  item: DeriveEquipmentProgressionInput,
): EquipmentProgressionMetadata | null {
  if (!item.slot) return null;
  const requiredRealmOrder =
    item.requiredRealmOrder ?? deriveDefaultRequiredRealmOrder(item);
  const tier = getEquipmentTierForRealmOrder(requiredRealmOrder);
  const grade = item.equipmentGradeWithinTier ?? getEquipmentGradeWithinTier(requiredRealmOrder);
  const powerBudget = computeEquipmentPowerBudget({
    requiredRealmOrder,
    equipmentTier: tier.tier,
    equipmentGradeWithinTier: grade,
    quality: item.quality,
    slot: item.slot,
  });
  return {
    equipmentTier: tier.tier,
    equipmentTierName: tier.name,
    equipmentGradeWithinTier: grade,
    requiredRealmOrder,
    requiredRealmKey: item.requiredRealmKey ?? getRealmKeyForEquipmentRealmOrder(requiredRealmOrder),
    powerBudget,
    computedPowerScore: computeEquipmentPowerScore({
      requiredRealmOrder,
      equipmentTier: tier.tier,
      equipmentGradeWithinTier: grade,
      quality: item.quality,
      slot: item.slot,
      enhanceLevel: item.enhanceLevel,
      gemBonusRatio: item.gemBonusRatio,
      setBonusRatio: item.setBonusRatio,
    }),
    maxEnhanceLevel: getEnhanceCapForTier(tier.tier),
    maxSocketCount: getSocketCapForTierAndQuality(tier.tier, item.quality),
  };
}

export function getRealmKeyForEquipmentRealmOrder(realmOrder: number): string | undefined {
  assertRealmOrder(realmOrder);
  return REALMS[realmOrder - 1]?.key;
}

function getTierDef(tier: number): EquipmentTierDef {
  const found = EQUIPMENT_TIERS.find((t) => t.tier === tier);
  if (!found) throw new RangeError(`Invalid equipment tier ${tier}`);
  return found;
}

function requireEquipmentTierNumber(tier: number | undefined): EquipmentTierNumber {
  if (tier === undefined) throw new RangeError('equipmentTier or requiredRealmOrder is required');
  return getTierDef(tier).tier;
}

function requiredRealmOrderFor(item: Pick<EquipmentPowerInput, 'requiredRealmOrder'>): number {
  if (item.requiredRealmOrder === undefined) {
    throw new RangeError('requiredRealmOrder is required');
  }
  assertRealmOrder(item.requiredRealmOrder);
  return item.requiredRealmOrder;
}

function assertRealmOrder(realmOrder: number): void {
  if (!Number.isInteger(realmOrder) || realmOrder < 1 || realmOrder > 28) {
    throw new RangeError(`realmOrder must be 1..28, got ${realmOrder}`);
  }
}

function assertRatio(name: string, value: number, max: number): void {
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new RangeError(`${name} must be 0..${max}, got ${value}`);
  }
}

function getTierSocketCap(tier: EquipmentTierNumber): number {
  if (tier === 1) return 1;
  if (tier <= 3) return 2;
  if (tier <= 5) return 3;
  return 4;
}

type NormalizedSlot =
  | 'WEAPON'
  | 'ARMOR'
  | 'HAT'
  | 'TRAM'
  | 'BOOTS'
  | 'BELT'
  | 'ARTIFACT'
  | 'RING'
  | 'AMULET'
  | 'OFFHAND';

function normalizeSlot(slot: EquipmentSlotLike): NormalizedSlot {
  switch (slot) {
    case 'WEAPON':
    case 'weapon':
      return 'WEAPON';
    case 'ARMOR':
    case 'armor':
    case 'chest':
      return 'ARMOR';
    case 'HAT':
    case 'hat':
    case 'helmet':
      return 'HAT';
    case 'TRAM':
    case 'tram':
      return 'TRAM';
    case 'BOOTS':
    case 'boots':
      return 'BOOTS';
    case 'BELT':
    case 'belt':
      return 'BELT';
    case 'ARTIFACT_1':
    case 'ARTIFACT_2':
    case 'ARTIFACT_3':
    case 'artifact':
      return 'ARTIFACT';
    case 'ring':
      return 'RING';
    case 'amulet':
      return 'AMULET';
    case 'offhand':
      return 'OFFHAND';
  }
}

function deriveDefaultRequiredRealmOrder(item: DeriveEquipmentProgressionInput): number {
  if (item.equipmentTier !== undefined) {
    return getRequiredRealmOrderForTierGrade(
      item.equipmentTier,
      item.equipmentGradeWithinTier ?? 'I',
    );
  }
  switch (item.quality) {
    case 'PHAM':
      return 1;
    case 'LINH':
      return 2;
    case 'HUYEN':
      return 3;
    case 'TIEN':
      return 4;
    case 'THAN':
      return 5;
  }
}
