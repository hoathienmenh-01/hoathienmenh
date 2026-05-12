import type { ItemBonus, Quality } from './items';
import {
  PHAP_BAO_ACTIVE_COOLDOWN_FLOOR_SEC,
  PHAP_BAO_AWAKEN_MAX,
  PHAP_BAO_AWAKEN_POWER_PER_STAGE,
  PHAP_BAO_POWER_MULTIPLIER_CAP,
  PHAP_BAO_REFINE_COST_MULTIPLIER,
  PHAP_BAO_REFINE_POWER_PER_LEVEL,
  PHAP_BAO_STAR_COOLDOWN_REDUCTION_CAP,
  PHAP_BAO_STAR_COOLDOWN_REDUCTION_PER_STAR,
  PHAP_BAO_STAR_MAX,
  PHAP_BAO_STAR_POWER_PER_LEVEL,
  computePhapBaoActiveSkillPreview,
  getPhapBaoAwakenCost as getLegacyPhapBaoAwakenCost,
  getPhapBaoByKey,
  getPhapBaoStarUpCost as getLegacyPhapBaoStarUpCost,
  getPhapBaoUpgradeCost,
  type PhapBaoDef,
  type PhapBaoInstance,
  type PhapBaoUpgradeCost,
} from './phap-bao';
import type { EquipmentTierNumber } from './equipment-progression';

export type PhapBaoProgressionCost = PhapBaoUpgradeCost & {
  protectionKey?: string;
  protectionQty?: number;
};

export interface PhapBaoProgressionInput extends PhapBaoInstance {
  realmOrder: number;
}

export interface PhapBaoUpgradeValidationInput {
  artifactKey: string;
  starLevel: number;
  refineLevel: number;
  awakenStage: number;
  realmOrder: number;
  locked?: boolean;
}

export interface PhapBaoStarUpInput extends PhapBaoUpgradeValidationInput {
  materialQty: number;
  shardQty: number;
  linhThach: number | bigint;
}

export interface PhapBaoAwakenInput extends PhapBaoUpgradeValidationInput {
  materialQty: number;
  awakenStoneQty: number;
  linhThach: number | bigint;
}

export interface PhapBaoRefineInput extends PhapBaoUpgradeValidationInput {
  materialQty: number;
  linhThach: number | bigint;
}

export interface PhapBaoProgressionValidationResult {
  ok: boolean;
  errors: string[];
}

export function getMaxPhapBaoStar(artifact: PhapBaoDef): number {
  return Math.min(artifact.starCap, PHAP_BAO_STAR_MAX);
}

export function getMaxAwakenStage(artifact: PhapBaoDef): number {
  return Math.min(artifact.awakenCap, PHAP_BAO_AWAKEN_MAX);
}

export function getPhapBaoStarUpCost(input: {
  artifact: PhapBaoDef;
  currentStarLevel: number;
}): PhapBaoProgressionCost {
  return getLegacyPhapBaoStarUpCost({
    tier: input.artifact.artifactTier,
    currentStarLevel: input.currentStarLevel,
    starCap: input.artifact.starCap,
    quality: input.artifact.quality,
  });
}

export function getPhapBaoAwakenCost(input: {
  artifact: PhapBaoDef;
  currentAwakenStage: number;
}): PhapBaoProgressionCost {
  return getLegacyPhapBaoAwakenCost({
    tier: input.artifact.artifactTier,
    currentAwakenStage: input.currentAwakenStage,
    awakenCap: input.artifact.awakenCap,
    quality: input.artifact.quality,
  });
}

export function getPhapBaoRefineCost(input: {
  artifact: PhapBaoDef;
  currentRefineLevel: number;
}): PhapBaoProgressionCost {
  const cost = getPhapBaoUpgradeCost({
    tier: input.artifact.artifactTier,
    currentRefineLevel: input.currentRefineLevel,
    refineCap: input.artifact.refineCap,
    quality: input.artifact.quality,
  });
  if (input.currentRefineLevel + 1 >= Math.max(4, input.artifact.refineCap - 2)) {
    return {
      ...cost,
      protectionKey: 'refine_protection_charm',
      protectionQty: 1,
    };
  }
  return cost;
}

export function canStarUpPhapBao(
  input: PhapBaoStarUpInput,
): PhapBaoProgressionValidationResult {
  const artifact = getPhapBaoByKey(input.artifactKey);
  if (!artifact) return fail('PHAP_BAO_NOT_FOUND');
  const errors = validatePhapBaoProgression(input).errors;
  if (input.realmOrder < artifact.requiredRealmOrder) errors.push('REALM_TOO_LOW');
  if (input.starLevel >= getMaxPhapBaoStar(artifact)) errors.push('MAX_STAR_REACHED');
  if (input.locked === true) errors.push('LOCKED');
  try {
    const cost = getPhapBaoStarUpCost({
      artifact,
      currentStarLevel: input.starLevel,
    });
    if (toBig(input.linhThach) < BigInt(cost.linhThachCost)) {
      errors.push('INSUFFICIENT_FUNDS');
    }
    if (input.materialQty < cost.materialQty) errors.push('INSUFFICIENT_MATERIAL');
    if ((cost.shardQty ?? 0) > 0 && input.shardQty < (cost.shardQty ?? 0)) {
      errors.push('INSUFFICIENT_SHARD');
    }
  } catch {
    errors.push('INVALID_STAR_COST');
  }
  return { ok: errors.length === 0, errors };
}

export function canAwakenPhapBao(
  input: PhapBaoAwakenInput,
): PhapBaoProgressionValidationResult {
  const artifact = getPhapBaoByKey(input.artifactKey);
  if (!artifact) return fail('PHAP_BAO_NOT_FOUND');
  const errors = validatePhapBaoProgression(input).errors;
  if (input.realmOrder < artifact.requiredRealmOrder) errors.push('REALM_TOO_LOW');
  if (input.awakenStage >= getMaxAwakenStage(artifact)) {
    errors.push('MAX_AWAKEN_REACHED');
  }
  if (artifact.quality !== 'TIEN' && artifact.quality !== 'THAN') {
    errors.push('QUALITY_TOO_LOW');
  }
  if (input.starLevel < requiredStarForAwaken(input.awakenStage)) {
    errors.push('STAR_TOO_LOW');
  }
  if (input.refineLevel < requiredRefineForAwaken(artifact, input.awakenStage)) {
    errors.push('REFINE_TOO_LOW');
  }
  try {
    const cost = getPhapBaoAwakenCost({
      artifact,
      currentAwakenStage: input.awakenStage,
    });
    if (toBig(input.linhThach) < BigInt(cost.linhThachCost)) {
      errors.push('INSUFFICIENT_FUNDS');
    }
    if (input.materialQty < cost.materialQty) errors.push('INSUFFICIENT_MATERIAL');
    if (
      (cost.awakenStoneQty ?? 0) > 0 &&
      input.awakenStoneQty < (cost.awakenStoneQty ?? 0)
    ) {
      errors.push('INSUFFICIENT_AWAKEN_STONE');
    }
  } catch {
    errors.push('INVALID_AWAKEN_COST');
  }
  return { ok: errors.length === 0, errors };
}

export function computePhapBaoPowerScore(input: PhapBaoInstance): number {
  const artifact = getPhapBaoByKey(input.artifactKey);
  if (!artifact) throw new RangeError(`pháp bảo not found: ${input.artifactKey}`);
  const starLevel = clampInt(input.starLevel, 1, getMaxPhapBaoStar(artifact));
  const refineLevel = clampInt(input.refineLevel, 0, artifact.refineCap);
  const awakenStage = clampInt(input.awakenStage, 0, getMaxAwakenStage(artifact));
  const rawMultiplier =
    1 +
    starLevel * PHAP_BAO_STAR_POWER_PER_LEVEL +
    refineLevel * PHAP_BAO_REFINE_POWER_PER_LEVEL +
    awakenStage * PHAP_BAO_AWAKEN_POWER_PER_STAGE;
  return Math.round(
    artifact.powerBudget * Math.min(rawMultiplier, PHAP_BAO_POWER_MULTIPLIER_CAP),
  );
}

export function computePhapBaoEffect(input: PhapBaoInstance): {
  passiveMultiplier: number;
  activeSkill: ReturnType<typeof computePhapBaoActiveSkillPreview>;
  bonus: ItemBonus;
} {
  const artifact = getPhapBaoByKey(input.artifactKey);
  if (!artifact) throw new RangeError(`pháp bảo not found: ${input.artifactKey}`);
  const starLevel = clampInt(input.starLevel, 1, getMaxPhapBaoStar(artifact));
  const refineLevel = clampInt(input.refineLevel, 0, artifact.refineCap);
  const awakenStage = clampInt(input.awakenStage, 0, getMaxAwakenStage(artifact));
  const passiveMultiplier = Math.min(
    1 +
      starLevel * PHAP_BAO_STAR_POWER_PER_LEVEL +
      refineLevel * PHAP_BAO_REFINE_POWER_PER_LEVEL +
      awakenStage * PHAP_BAO_AWAKEN_POWER_PER_STAGE,
    PHAP_BAO_POWER_MULTIPLIER_CAP,
  );
  const bonus = scaleBonus(artifact.passiveBonus, passiveMultiplier);
  return {
    passiveMultiplier,
    activeSkill: computePhapBaoActiveSkillPreview({
      artifactKey: artifact.artifactKey,
      starLevel,
      refineLevel,
      awakenStage,
    }),
    bonus,
  };
}

export function validatePhapBaoProgression(
  input: PhapBaoProgressionInput,
): PhapBaoProgressionValidationResult {
  const artifact = getPhapBaoByKey(input.artifactKey);
  if (!artifact) return fail('PHAP_BAO_NOT_FOUND');
  const errors: string[] = [];
  if (!Number.isInteger(input.starLevel) || input.starLevel < 1) {
    errors.push('STAR_LEVEL_OUT_OF_RANGE');
  }
  if (input.starLevel > getMaxPhapBaoStar(artifact)) {
    errors.push('STAR_LEVEL_OUT_OF_RANGE');
  }
  if (!Number.isInteger(input.refineLevel) || input.refineLevel < 0) {
    errors.push('REFINE_LEVEL_OUT_OF_RANGE');
  }
  if (input.refineLevel > artifact.refineCap) {
    errors.push('REFINE_LEVEL_OUT_OF_RANGE');
  }
  if (!Number.isInteger(input.awakenStage) || input.awakenStage < 0) {
    errors.push('AWAKEN_STAGE_OUT_OF_RANGE');
  }
  if (input.awakenStage > getMaxAwakenStage(artifact)) {
    errors.push('AWAKEN_STAGE_OUT_OF_RANGE');
  }
  return { ok: errors.length === 0, errors };
}

export function validatePhapBaoUpgradeCost(input: {
  artifact: PhapBaoDef;
  cost: PhapBaoProgressionCost;
}): PhapBaoProgressionValidationResult {
  const errors: string[] = [];
  if (input.cost.linhThachCost <= 0) errors.push('INVALID_LINH_THACH_COST');
  if (!input.cost.materialKey) errors.push('INVALID_MATERIAL_KEY');
  if (input.cost.materialQty <= 0) errors.push('INVALID_MATERIAL_QTY');
  if (input.cost.shardQty !== undefined && input.cost.shardQty <= 0) {
    errors.push('INVALID_SHARD_QTY');
  }
  if (
    input.cost.awakenStoneQty !== undefined &&
    input.cost.awakenStoneQty <= 0
  ) {
    errors.push('INVALID_AWAKEN_STONE_QTY');
  }
  if (input.artifact.artifactTier < 1 || input.artifact.artifactTier > 10) {
    errors.push('INVALID_ARTIFACT_TIER');
  }
  return { ok: errors.length === 0, errors };
}

export function requiredStarForAwaken(currentAwakenStage: number): number {
  return Math.min(PHAP_BAO_STAR_MAX, 3 + currentAwakenStage);
}

export function requiredRefineForAwaken(
  artifact: PhapBaoDef,
  currentAwakenStage: number,
): number {
  return Math.min(artifact.refineCap, 2 + currentAwakenStage * 2);
}

export function computePhapBaoCooldownSeconds(input: {
  baseCooldownSeconds: number;
  starLevel: number;
}): number {
  const reduction = Math.min(
    input.starLevel * PHAP_BAO_STAR_COOLDOWN_REDUCTION_PER_STAR,
    PHAP_BAO_STAR_COOLDOWN_REDUCTION_CAP,
  );
  return Math.max(
    PHAP_BAO_ACTIVE_COOLDOWN_FLOOR_SEC,
    Math.round(input.baseCooldownSeconds * (1 - reduction)),
  );
}

function fail(error: string): PhapBaoProgressionValidationResult {
  return { ok: false, errors: [error] };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min) return min;
  if (value > max) return max;
  return value;
}

function toBig(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(Math.floor(value));
}

function scaleBonus(base: ItemBonus, multiplier: number): ItemBonus {
  const bonus: ItemBonus = {};
  if (base.atk !== undefined) bonus.atk = Math.round(base.atk * multiplier);
  if (base.def !== undefined) bonus.def = Math.round(base.def * multiplier);
  if (base.hpMax !== undefined) bonus.hpMax = Math.round(base.hpMax * multiplier);
  if (base.mpMax !== undefined) bonus.mpMax = Math.round(base.mpMax * multiplier);
  if (base.spirit !== undefined) bonus.spirit = Math.round(base.spirit * multiplier);
  if (base.tribulationSupport !== undefined) {
    bonus.tribulationSupport = base.tribulationSupport;
  }
  if (base.elementalAtkBonus !== undefined) {
    bonus.elementalAtkBonus = base.elementalAtkBonus;
  }
  if (base.elementResist !== undefined) bonus.elementResist = base.elementResist;
  return bonus;
}

export type { EquipmentTierNumber, Quality };
