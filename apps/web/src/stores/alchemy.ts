import { ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/alchemy';

/**
 * Phase 11.11.D — server-authoritative alchemy (Luyện Đan) store.
 *
 * State mirror server `GET /character/alchemy/recipes`:
 *   - `furnaceLevel`: Cấp lò luyện hiện tại (default 1).
 *   - `recipes`: Danh sách AlchemyRecipeView snapshot (filtered theo
 *     furnaceLevel ≤ furnace của char) từ server.
 *   - `loaded`: đã hydrate ít nhất 1 lần chưa (skeleton vs empty state).
 *   - `inFlight`: Set<recipeKey> đang craft (race-protect double-click + UI
 *     disable).
 *   - `lastOutcome`: outcome gần nhất từ POST /craft, dùng cho toast/UI.
 *
 * Action `craft(recipeKey)`:
 *   - Optimistic? KHÔNG. Server-authoritative — chờ response, refresh cache.
 *     Tránh state divergence nếu craft fail/insufficient ingredient race.
 *   - Trả về `null` (success) hoặc error code (string). Caller dùng để hiển
 *     thị toast i18n `alchemy.craft.errors.{code}`.
 *   - inFlight set/clear quanh request để UI disable button.
 */
export const useAlchemyStore = defineStore('alchemy', () => {
  const furnaceLevel = ref(1);
  const alchemyLevel = ref(1);
  const alchemyLevelName = ref('');
  const alchemyExp = ref('0');
  const alchemyExpNext = ref('0');
  const alchemyMastery = ref(0);
  const recipes = ref<api.AlchemyRecipeView[]>([]);
  const loaded = ref(false);
  const inFlight = ref<Set<string>>(new Set());
  const lastOutcome = ref<api.AlchemyOutcomeView | null>(null);
  /** Phase 11.11.D-2 — next furnace upgrade preview (null khi furnace ở MAX). */
  const nextUpgrade = ref<api.AlchemyFurnaceUpgradeView | null>(null);
  /** Phase 11.11.D-2 — race-protect upgrade button (true khi POST upgrade-furnace in-flight). */
  const upgradeInFlight = ref(false);
  /** Phase 11.11.D-2 — outcome gần nhất từ POST /upgrade-furnace, dung cho toast. */
  const lastUpgradeOutcome = ref<api.AlchemyUpgradeOutcomeView | null>(null);

  function applyState(state: api.AlchemyState): void {
    furnaceLevel.value = state.furnaceLevel;
    alchemyLevel.value = state.alchemyLevel;
    alchemyLevelName.value = state.alchemyLevelName;
    alchemyExp.value = state.alchemyExp;
    alchemyExpNext.value = state.alchemyExpNext;
    alchemyMastery.value = state.alchemyMastery;
    recipes.value = state.recipes;
    nextUpgrade.value = state.nextUpgrade;
    loaded.value = true;
  }

  async function fetchState(): Promise<void> {
    const state = await api.getAlchemyRecipes();
    applyState(state);
  }

  function isCrafting(recipeKey: string): boolean {
    return inFlight.value.has(recipeKey);
  }

  /**
   * Server-authoritative craft. Returns error code (string) on failure,
   * `null` on success (regardless of outcome.success — fail outcome vẫn được
   * coi là "thành công gọi API", chỉ là RNG roll thất bại). Callers map code
   * → toast i18n key.
   */
  async function craft(recipeKey: string): Promise<string | null> {
    if (inFlight.value.has(recipeKey)) return 'IN_FLIGHT';
    const next = new Set(inFlight.value);
    next.add(recipeKey);
    inFlight.value = next;
    try {
      const result = await api.craftAlchemyRecipe(recipeKey);
      furnaceLevel.value = result.furnaceLevel;
      lastOutcome.value = result.outcome;
      alchemyLevel.value = result.outcome.alchemyLevelAfter;
      return null;
    } catch (e) {
      const code =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
      return code;
    } finally {
      const cleared = new Set(inFlight.value);
      cleared.delete(recipeKey);
      inFlight.value = cleared;
    }
  }

  /**
   * Phase 11.11.D-2 — Server-authoritative furnace upgrade.
   *
   *   - Race-protect via `upgradeInFlight` (chong double-click + chong race
   *     với craft action khác).
   *   - Returns `null` on success, error code string on failure. Caller
   *     dùng để hiển thị toast i18n `alchemy.upgrade.errors.{code}`.
   *   - Pre-check: `MAX_LEVEL` (`nextUpgrade === null`).
   *   - On success: bump `furnaceLevel`, refresh `nextUpgrade` từ response,
   *     lưu `lastUpgradeOutcome` cho toast. Caller nên refetch state để
   *     re-render recipe list (một số recipe mới unlock tại level cao hơn).
   */
  async function upgradeFurnace(): Promise<string | null> {
    if (upgradeInFlight.value) return 'IN_FLIGHT';
    if (nextUpgrade.value === null) return 'MAX_LEVEL';
    upgradeInFlight.value = true;
    try {
      const result = await api.upgradeAlchemyFurnace();
      furnaceLevel.value = result.furnaceLevel;
      nextUpgrade.value = result.nextUpgrade;
      lastUpgradeOutcome.value = result.outcome;
      return null;
    } catch (e) {
      const code =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
      return code;
    } finally {
      upgradeInFlight.value = false;
    }
  }

  function reset(): void {
    furnaceLevel.value = 1;
    alchemyLevel.value = 1;
    alchemyLevelName.value = '';
    alchemyExp.value = '0';
    alchemyExpNext.value = '0';
    alchemyMastery.value = 0;
    recipes.value = [];
    loaded.value = false;
    inFlight.value = new Set();
    lastOutcome.value = null;
    nextUpgrade.value = null;
    upgradeInFlight.value = false;
    lastUpgradeOutcome.value = null;
  }

  return {
    furnaceLevel,
    alchemyLevel,
    alchemyLevelName,
    alchemyExp,
    alchemyExpNext,
    alchemyMastery,
    recipes,
    loaded,
    inFlight,
    lastOutcome,
    nextUpgrade,
    upgradeInFlight,
    lastUpgradeOutcome,
    fetchState,
    isCrafting,
    craft,
    upgradeFurnace,
    reset,
  };
});
