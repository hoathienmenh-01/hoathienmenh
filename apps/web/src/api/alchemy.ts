import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 11.11.D — Alchemy (Luyện Đan) API client.
 *
 * Wire `GET /character/alchemy/recipes` + `POST /character/alchemy/craft`
 * (Phase 11.11.C server endpoints, PR #319) cho Pinia `useAlchemyStore` + UI
 * `AlchemyView.vue` (Luyện Đan tab).
 *
 * Server-authoritative: client chỉ gửi `recipeKey`, server resolve character +
 * RNG + ItemLedger + CurrencyLedger nguyên tử qua `prisma.$transaction`.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(op: string): Error {
  return new Error(i18n.global.t(`common.apiFallback.${op}`));
}

export interface AlchemyRecipeIngredient {
  itemKey: string;
  qty: number;
}

export interface AlchemyMissingInput {
  itemKey: string;
  requiredQty: number;
  ownedQty: number;
  /** Phase 26.2 — surfaced metadata. Optional khi item legacy chưa migrate. */
  itemName?: string;
  materialTier?: number;
  materialCategory?: string;
  sourceHint?: string[];
}

export interface AlchemyRecipeView {
  key: string;
  name: string;
  description: string;
  outputItem: string;
  outputQty: number;
  outputQuality: 'PHAM' | 'LINH' | 'HUYEN' | 'TIEN' | 'THAN';
  recipeTier: number;
  recipeCategory: string;
  requiredAlchemyLevel: number;
  inputs: AlchemyRecipeIngredient[];
  furnaceLevel: number;
  realmRequirement: string | null;
  targetRealmOrder?: number;
  maxOutputGrade?: string;
  linhThachCost: number;
  successRate: number;
  successRateBase: number;
  successRateFinal: number;
  possibleGrades: string[];
  sourceHint?: string[];
  unlockSource?: string;
  missingInputs: AlchemyMissingInput[];
  canCraft: boolean;
  failureReason: string | null;
}

export interface AlchemyFurnaceUpgradeView {
  toLevel: number;
  linhThachCost: number;
  realmRequirement: string | null;
}

export interface AlchemyState {
  furnaceLevel: number;
  alchemyLevel: number;
  alchemyLevelName: string;
  alchemyExp: string;
  alchemyExpNext: string;
  alchemyMastery: number;
  recipes: AlchemyRecipeView[];
  /** Phase 11.11.D-2 — next upgrade preview, null khi furnaceLevel = MAX. */
  nextUpgrade: AlchemyFurnaceUpgradeView | null;
}

export interface AlchemyUpgradeOutcomeView {
  fromLevel: number;
  toLevel: number;
  linhThachConsumed: number;
}

export interface AlchemyUpgradeResult {
  furnaceLevel: number;
  outcome: AlchemyUpgradeOutcomeView;
  nextUpgrade: AlchemyFurnaceUpgradeView | null;
}

export interface AlchemyOutcomeView {
  recipeKey: string;
  success: boolean;
  rollValue: number;
  outputItem: string | null;
  outputQty: number;
  pillGrade: string | null;
  successRate: number;
  alchemyExpGained: string;
  alchemyLevelBefore: number;
  alchemyLevelAfter: number;
  linhThachConsumed: number;
  inputsConsumed: AlchemyRecipeIngredient[];
}

export interface AlchemyCraftResult {
  furnaceLevel: number;
  outcome: AlchemyOutcomeView;
}

export async function getAlchemyRecipes(): Promise<AlchemyState> {
  const { data } =
    await apiClient.get<Envelope<{ alchemy: AlchemyState }>>(
      '/character/alchemy/recipes',
    );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('alchemyState');
  return data.data.alchemy;
}

export async function craftAlchemyRecipe(
  recipeKey: string,
): Promise<AlchemyCraftResult> {
  const { data } = await apiClient.post<Envelope<{ alchemy: AlchemyCraftResult }>>(
    '/character/alchemy/craft',
    { recipeKey },
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('alchemyCraft');
  return data.data.alchemy;
}

/**
 * Phase 11.11.D-2 — Upgrade lò đan, server-authoritative.
 *
 * No body: target = currentLevel + 1, server quyết định + atomic deduct
 * linhThach via `CurrencyLedger`.
 */
export async function upgradeAlchemyFurnace(): Promise<AlchemyUpgradeResult> {
  const { data } = await apiClient.post<Envelope<{ alchemy: AlchemyUpgradeResult }>>(
    '/character/alchemy/upgrade-furnace',
    {},
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('alchemyUpgradeFurnace');
  return data.data.alchemy;
}
