import { Inject, Injectable, Optional } from '@nestjs/common';
import { CurrencyKind } from '@prisma/client';
import {
  ALCHEMY_FURNACE_MAX_LEVEL,
  ALCHEMY_LEVEL_NAMES,
  canCraftAlchemyRecipe,
  computeAlchemyExpReward,
  computeAlchemySuccessRate,
  getAlchemyFurnaceUpgradeDef,
  getAlchemyLevelExpRequirement,
  getAlchemyRecipeDef,
  itemByKey,
  possiblePillGrades,
  realmByKey,
  resolveAlchemyLevelAfter,
  rollPillGrade,
  simulateAlchemyAttempt,
  ALCHEMY_RECIPES,
  type AlchemyFurnaceUpgradeDef,
  type MaterialCategory,
  type PillGrade,
  type SourceHint,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from './currency.service';
import { AchievementService } from './achievement.service';
import {
  InMemorySlidingWindowRateLimiter,
  type RateLimiter,
} from '../../common/rate-limiter';

/**
 * Phase 11.11.B Alchemy (Luyện Đan) MVP runtime.
 *
 * Server-authoritative:
 *   - Verify recipe exists via catalog `getAlchemyRecipeDef`.
 *   - Verify character exists + furnaceLevel >= recipe.furnaceLevel.
 *   - Verify realm requirement if recipe.realmRequirement != null.
 *   - Verify all input ingredients qty available (unequipped stacks).
 *   - Verify linhThach >= recipe.linhThachCost.
 *   - Atomic $transaction:
 *     1. Consume each input ingredient (inventoryItem update/delete + ItemLedger 'ALCHEMY_INPUT').
 *     2. Deduct linhThach via CurrencyService.applyTx (reason 'ALCHEMY_COST').
 *     3. Roll deterministic via `simulateAlchemyAttempt(recipe, rng)`.
 *     4. If success: grant output pill (inventoryItem upsert + ItemLedger 'ALCHEMY_OUTPUT').
 *   - Input + linhThach ALWAYS consumed (even on fail — balance intent).
 *
 * Idempotency: KHÔNG có natural idempotency key — caller phải debounce. Mỗi
 * attempt = 1 set of ledger entries mới.
 *
 * Phase 11.11.C sẽ thêm: upgradeFurnace (cost linhThach + material),
 * mastery bonus vào successRate, attempt log analytics.
 *
 * Phase 11.11.E: post-success fail-soft `AchievementService.trackEvent` cho
 * goalKind `ALCHEMY_CRAFT` (apprentice 10 / master 100). KHÔNG track khi
 * outcome.success === false. KHÔNG throw nếu achievement service lỗi.
 */
/**
 * Rate limit cho alchemy attempts. 60 req/phút — đủ cho player thật
 * craft liên tục, nhưng chặn script abuse spam hàng trăm lần/giây.
 */
export const ALCHEMY_RATE_LIMIT_WINDOW_MS = 60_000;
export const ALCHEMY_RATE_LIMIT_MAX = 60;
export const ALCHEMY_RATE_LIMITER = Symbol('ALCHEMY_RATE_LIMITER');

@Injectable()
export class AlchemyService {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    @Optional() private readonly achievements?: AchievementService,
    @Optional() @Inject(ALCHEMY_RATE_LIMITER) limiter?: RateLimiter,
  ) {
    this.limiter =
      limiter ??
      new InMemorySlidingWindowRateLimiter(
        ALCHEMY_RATE_LIMIT_WINDOW_MS,
        ALCHEMY_RATE_LIMIT_MAX,
      );
  }

  /**
   * Attempt 1 lần luyện đan.
   *
   * @param characterId character thực hiện
   * @param recipeKey recipe từ catalog
   * @param rng deterministic RNG [0,1) — caller PHẢI truyền seeded RNG,
   *   KHÔNG dùng Math.random() (non-deterministic, không audit-able).
   *   Controller nên derive từ attemptId: seedrandom(attemptId).
   */
  async attemptCraft(
    characterId: string,
    recipeKey: string,
    rng: () => number,
  ): Promise<AlchemyCraftOutcome> {
    const recipe = getAlchemyRecipeDef(recipeKey);
    if (!recipe) throw new AlchemyError('RECIPE_NOT_FOUND');

    // Rate limit check — chạy trước DB lookup để giảm tải khi bị spam.
    const rl = await this.limiter.check(characterId);
    if (!rl.allowed) throw new AlchemyError('RATE_LIMITED');

    return this.prisma.$transaction(async (tx) => {
      const character = await tx.character.findUnique({
        where: { id: characterId },
        select: {
          id: true,
          realmKey: true,
          linhThach: true,
          alchemyFurnaceLevel: true,
          alchemyLevel: true,
          alchemyExp: true,
          alchemyMastery: true,
        },
      });
      if (!character) throw new AlchemyError('CHARACTER_NOT_FOUND');

      if (recipe.furnaceLevel > character.alchemyFurnaceLevel) {
        throw new AlchemyError('FURNACE_LEVEL_TOO_LOW');
      }

      if (recipe.realmRequirement) {
        const charRealm = realmByKey(character.realmKey);
        const reqRealm = realmByKey(recipe.realmRequirement);
        if (!charRealm || !reqRealm || charRealm.order < reqRealm.order) {
          throw new AlchemyError('REALM_REQUIREMENT_NOT_MET');
        }
      }

      if (recipe.recipeTier > character.alchemyLevel || recipe.requiredAlchemyLevel > character.alchemyLevel) {
        throw new AlchemyError('ALCHEMY_LEVEL_TOO_LOW');
      }

      if (character.linhThach < BigInt(recipe.linhThachCost)) {
        throw new AlchemyError('INSUFFICIENT_FUNDS');
      }

      const successRate = computeAlchemySuccessRate(recipe, {
        alchemyLevel: character.alchemyLevel,
        furnaceLevel: character.alchemyFurnaceLevel,
        alchemyMastery: character.alchemyMastery,
      });
      const alchemyLevelBefore = character.alchemyLevel;

      for (const ing of recipe.inputs) {
        const row = await tx.inventoryItem.findFirst({
          where: { characterId, itemKey: ing.itemKey, equippedSlot: null },
        });
        if (!row || row.qty < ing.qty) {
          throw new AlchemyError('INSUFFICIENT_INGREDIENTS');
        }
        if (row.qty === ing.qty) {
          await tx.inventoryItem.delete({ where: { id: row.id } });
        } else {
          await tx.inventoryItem.update({
            where: { id: row.id },
            data: { qty: row.qty - ing.qty },
          });
        }
        await tx.itemLedger.create({
          data: {
            characterId,
            itemKey: ing.itemKey,
            qtyDelta: -ing.qty,
            reason: 'ALCHEMY_INPUT',
            refType: 'AlchemyRecipe',
            refId: recipeKey,
          },
        });
      }

      await this.currency.applyTx(tx, {
        characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: BigInt(-recipe.linhThachCost),
        reason: 'ALCHEMY_COST',
        refType: 'AlchemyRecipe',
        refId: recipeKey,
      });

      const roll = rng();
      const result = simulateAlchemyAttempt({ ...recipe, successRate }, roll);
      const pillGrade = result.success
        ? rollPillGrade(
            recipe,
            {
              alchemyLevel: character.alchemyLevel,
              furnaceLevel: character.alchemyFurnaceLevel,
              alchemyMastery: character.alchemyMastery,
            },
            rng,
          )
        : null;
      const alchemyExpGained = computeAlchemyExpReward(recipe, result.success, pillGrade ?? undefined);
      const alchemyAfter = resolveAlchemyLevelAfter(
        character.alchemyLevel,
        character.alchemyExp,
        alchemyExpGained,
      );

      if (result.success) {
        const outputDef = itemByKey(recipe.outputItem);
        const stackable = outputDef?.stackable ?? true;
        if (stackable) {
          const existing = await tx.inventoryItem.findFirst({
            where: { characterId, itemKey: recipe.outputItem, equippedSlot: null },
          });
          if (existing) {
            await tx.inventoryItem.update({
              where: { id: existing.id },
              data: { qty: { increment: result.outputQty } },
            });
          } else {
            await tx.inventoryItem.create({
              data: { characterId, itemKey: recipe.outputItem, qty: result.outputQty },
            });
          }
        } else {
          for (let i = 0; i < result.outputQty; i += 1) {
            await tx.inventoryItem.create({
              data: { characterId, itemKey: recipe.outputItem, qty: 1 },
            });
          }
        }
        await tx.itemLedger.create({
          data: {
            characterId,
            itemKey: recipe.outputItem,
            qtyDelta: result.outputQty,
            reason: 'ALCHEMY_OUTPUT',
            refType: 'AlchemyRecipe',
            refId: recipeKey,
          },
        });
      }

      await tx.character.update({
        where: { id: characterId },
        data: {
          alchemyLevel: alchemyAfter.level,
          alchemyExp: alchemyAfter.exp,
          alchemyMastery: { increment: result.success ? 2 : 1 },
        },
      });

      await tx.alchemyAttemptLog.create({
        data: {
          characterId,
          recipeKey,
          recipeTier: recipe.recipeTier,
          recipeCategory: recipe.recipeCategory,
          success: result.success,
          successRate,
          rollValue: roll,
          pillGrade,
          outputItem: result.outputItem,
          outputQty: result.outputQty,
          inputsJson: recipe.inputs.map((ing) => ({ itemKey: ing.itemKey, qty: ing.qty })),
          linhThachConsumed: recipe.linhThachCost,
          alchemyExpGained,
        },
      });

      return {
        recipeKey,
        success: result.success,
        rollValue: result.rollValue,
        outputItem: result.outputItem,
        outputQty: result.outputQty,
        pillGrade,
        successRate,
        alchemyExpGained: alchemyExpGained.toString(),
        alchemyLevelBefore,
        alchemyLevelAfter: alchemyAfter.level,
        linhThachConsumed: recipe.linhThachCost,
        inputsConsumed: recipe.inputs.map((i) => ({ itemKey: i.itemKey, qty: i.qty })),
      };
    }).then(async (outcome) => {
      if (outcome.success && this.achievements) {
        try {
          await this.achievements.trackEvent(characterId, 'ALCHEMY_CRAFT', 1);
        } catch {
          // fail-soft by design
        }
      }
      return outcome;
    });
  }

  /** Read furnace level for character. */
  async getFurnaceLevel(characterId: string): Promise<number> {
    const char = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { alchemyFurnaceLevel: true },
    });
    if (!char) throw new AlchemyError('CHARACTER_NOT_FOUND');
    return char.alchemyFurnaceLevel;
  }

  async getAlchemyProfile(characterId: string): Promise<AlchemyProfile> {
    const char = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: {
        alchemyLevel: true,
        alchemyExp: true,
        alchemyMastery: true,
        alchemyFurnaceLevel: true,
      },
    });
    if (!char) throw new AlchemyError('CHARACTER_NOT_FOUND');
    return {
      alchemyLevel: char.alchemyLevel,
      alchemyLevelName: ALCHEMY_LEVEL_NAMES[char.alchemyLevel - 1] ?? ALCHEMY_LEVEL_NAMES[0],
      alchemyExp: char.alchemyExp.toString(),
      alchemyExpNext: getAlchemyLevelExpRequirement(char.alchemyLevel).toString(),
      alchemyMastery: char.alchemyMastery,
      furnaceLevel: char.alchemyFurnaceLevel,
    };
  }

  /** List recipes available at character's current furnace level. */
  async listAvailableRecipes(
    characterId: string,
  ): Promise<AlchemyRecipeView[]> {
    const char = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: {
        alchemyFurnaceLevel: true,
        alchemyLevel: true,
        alchemyMastery: true,
        realmKey: true,
      },
    });
    if (!char) throw new AlchemyError('CHARACTER_NOT_FOUND');
    const inventory = await this.prisma.inventoryItem.findMany({
      where: { characterId, equippedSlot: null },
      select: { itemKey: true, qty: true },
    });
    const qtyByKey = new Map(inventory.map((item) => [item.itemKey, item.qty]));
    // Trả về TẤT CẢ recipes — locked nếu lò/thấp cấp quá, unlocked nếu đủ điều kiện.
    // FE hiển thị locked state để player biết cần upgrade gì.
    return [...ALCHEMY_RECIPES].map((recipe) => {
      const missingInputs = recipe.inputs
        .filter((input) => (qtyByKey.get(input.itemKey) ?? 0) < input.qty)
        .map((input) => {
          // Phase 26.2 — surface materialTier/materialCategory/sourceHint
          // ngay trong missing entry để FE Alchemy recipe card render
          // "farm ở đâu" mà KHÔNG cần fetch thêm /items/<key>.
          const def = itemByKey(input.itemKey);
          return {
            itemKey: input.itemKey,
            requiredQty: input.qty,
            ownedQty: qtyByKey.get(input.itemKey) ?? 0,
            itemName: def?.name,
            materialTier: def?.materialTier,
            materialCategory: def?.materialCategory as MaterialCategory | undefined,
            sourceHint: def?.sourceHint as readonly SourceHint[] | undefined,
          };
        });
      const gate = canCraftAlchemyRecipe(char, recipe);
      return {
        ...recipe,
        successRateBase: recipe.successRate,
        successRateFinal: computeAlchemySuccessRate(recipe, {
          alchemyLevel: char.alchemyLevel,
          furnaceLevel: char.alchemyFurnaceLevel,
          alchemyMastery: char.alchemyMastery,
        }),
        possibleGrades: possiblePillGrades(recipe),
        missingInputs,
        canCraft: gate.canCraft && missingInputs.length === 0,
        failureReason: gate.failureReason ?? (missingInputs.length > 0 ? 'INSUFFICIENT_INGREDIENTS' : null),
      };
    });
  }

  /**
   * Phase 11.11.D-2 — Preview next furnace upgrade option.
   * @returns null nếu character đã ở MAX_LEVEL, ngược lại trả về upgrade def
   *   cho `currentLevel + 1`.
   */
  async getFurnaceUpgradePreview(
    characterId: string,
  ): Promise<AlchemyFurnaceUpgradeDef | null> {
    const currentLevel = await this.getFurnaceLevel(characterId);
    if (currentLevel >= ALCHEMY_FURNACE_MAX_LEVEL) return null;
    return getAlchemyFurnaceUpgradeDef(currentLevel + 1) ?? null;
  }

  /**
   * Phase 11.11.D-2 — Upgrade lò đan từ `currentLevel` lên `currentLevel + 1`.
   *
   * Server-authoritative:
   *   - Verify character exists.
   *   - Verify currentLevel < MAX_LEVEL (FURNACE_LEVEL_MAX).
   *   - Lookup upgrade def cho `currentLevel + 1`. Nếu không tồn tại → FURNACE_LEVEL_MAX.
   *   - Verify realm requirement nếu def.realmRequirement != null.
   *   - Verify linhThach >= def.linhThachCost.
   *   - Atomic $transaction:
   *     1. Deduct linhThach via CurrencyService.applyTx (reason 'ALCHEMY_FURNACE_UPGRADE').
   *     2. Increment alchemyFurnaceLevel by 1 via CAS guard
   *        `where { id, alchemyFurnaceLevel: currentLevel }` (chống race nếu user
   *        gọi 2 upgrade song song).
   *
   * @returns thông tin upgrade và level mới.
   */
  async upgradeFurnace(characterId: string): Promise<AlchemyUpgradeOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const character = await tx.character.findUnique({
        where: { id: characterId },
        select: {
          id: true,
          realmKey: true,
          linhThach: true,
          alchemyFurnaceLevel: true,
        },
      });
      if (!character) throw new AlchemyError('CHARACTER_NOT_FOUND');

      const currentLevel = character.alchemyFurnaceLevel;
      if (currentLevel >= ALCHEMY_FURNACE_MAX_LEVEL) {
        throw new AlchemyError('FURNACE_LEVEL_MAX');
      }

      const targetLevel = currentLevel + 1;
      const upgradeDef = getAlchemyFurnaceUpgradeDef(targetLevel);
      if (!upgradeDef) {
        // Defensive: catalog không có entry cho targetLevel.
        throw new AlchemyError('FURNACE_LEVEL_MAX');
      }

      if (upgradeDef.realmRequirement) {
        const charRealm = realmByKey(character.realmKey);
        const reqRealm = realmByKey(upgradeDef.realmRequirement);
        if (!charRealm || !reqRealm || charRealm.order < reqRealm.order) {
          throw new AlchemyError('REALM_REQUIREMENT_NOT_MET');
        }
      }

      if (character.linhThach < BigInt(upgradeDef.linhThachCost)) {
        throw new AlchemyError('INSUFFICIENT_FUNDS');
      }

      // Deduct linhThach via ledger.
      await this.currency.applyTx(tx, {
        characterId,
        currency: CurrencyKind.LINH_THACH,
        delta: BigInt(-upgradeDef.linhThachCost),
        reason: 'ALCHEMY_FURNACE_UPGRADE',
        refType: 'AlchemyFurnaceUpgrade',
        refId: `L${currentLevel}->L${targetLevel}`,
      });

      // CAS-guarded level bump (chống race).
      const updated = await tx.character.updateMany({
        where: { id: characterId, alchemyFurnaceLevel: currentLevel },
        data: { alchemyFurnaceLevel: targetLevel },
      });
      if (updated.count !== 1) {
        // Race với upgrade song song khác — abort transaction.
        throw new AlchemyError('FURNACE_RACE');
      }

      return {
        fromLevel: currentLevel,
        toLevel: targetLevel,
        linhThachConsumed: upgradeDef.linhThachCost,
      };
    });
  }
}

// ---------- Return type ----------

export interface AlchemyCraftOutcome {
  recipeKey: string;
  success: boolean;
  rollValue: number;
  outputItem: string | null;
  outputQty: number;
  pillGrade: PillGrade | null;
  successRate: number;
  alchemyExpGained: string;
  alchemyLevelBefore: number;
  alchemyLevelAfter: number;
  linhThachConsumed: number;
  inputsConsumed: Array<{ itemKey: string; qty: number }>;
}

export interface AlchemyProfile {
  alchemyLevel: number;
  alchemyLevelName: string;
  alchemyExp: string;
  alchemyExpNext: string;
  alchemyMastery: number;
  furnaceLevel: number;
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
  furnaceLevel: number;
  realmRequirement: string | null;
  targetRealmOrder?: number;
  maxOutputGrade?: PillGrade;
  inputs: readonly { itemKey: string; qty: number }[];
  linhThachCost: number;
  successRate: number;
  successRateBase: number;
  successRateFinal: number;
  possibleGrades: readonly PillGrade[];
  sourceHint?: readonly string[];
  unlockSource?: string;
  missingInputs: Array<{
    itemKey: string;
    requiredQty: number;
    ownedQty: number;
    /** Phase 26.2 — name + Drop Economy hint surfaced cho FE recipe card. */
    itemName?: string;
    materialTier?: number;
    materialCategory?: MaterialCategory;
    sourceHint?: readonly SourceHint[];
  }>;
  canCraft: boolean;
  failureReason: string | null;
}

export interface AlchemyUpgradeOutcome {
  fromLevel: number;
  toLevel: number;
  linhThachConsumed: number;
}

// ---------- Error ----------

export type AlchemyErrorCode =
  | 'RECIPE_NOT_FOUND'
  | 'CHARACTER_NOT_FOUND'
  | 'FURNACE_LEVEL_TOO_LOW'
  | 'FURNACE_LEVEL_MAX'
  | 'FURNACE_RACE'
  | 'REALM_REQUIREMENT_NOT_MET'
  | 'ALCHEMY_LEVEL_TOO_LOW'
  | 'RECIPE_TIER_TOO_HIGH'
  | 'INSUFFICIENT_INGREDIENTS'
  | 'DAILY_CAP_REACHED'
  | 'INSUFFICIENT_FUNDS'
  | 'RATE_LIMITED';

export class AlchemyError extends Error {
  constructor(public readonly code: AlchemyErrorCode) {
    super(code);
  }
}

export const ALCHEMY_RECIPE_COUNT = ALCHEMY_RECIPES.length;
