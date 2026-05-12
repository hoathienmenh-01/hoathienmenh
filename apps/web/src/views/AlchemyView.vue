<script setup lang="ts">
/**
 * Phase 11.11.D — Alchemy (Luyện Đan) view.
 *
 * Hiển thị recipes server trả về (đã filter theo furnace level của char) +
 * cho phép craft 1 lần. Server-authoritative:
 *  - GET /character/alchemy/recipes → load `furnaceLevel` + recipes[].
 *  - POST /character/alchemy/craft { recipeKey } → craft (consume input/cost
 *    + roll RNG); outcome có thể success=true (granted output qty) hoặc
 *    success=false (vẫn consume linh thạch + ingredients, roll fail).
 *
 * Filters:
 *  - Quality: all | PHAM | LINH | HUYEN | TIEN | THAN
 *
 * Mỗi recipe card hiển thị:
 *  - Tên + quality badge + furnace requirement badge
 *  - Description (lore)
 *  - Output: 1 dòng Item × qty
 *  - Inputs: list itemKey × qty (frontend không có tên item ở đây, chỉ key —
 *    InventoryView mới có item lookup; alchemy view chỉ show key vì server
 *    truyền key, không truyền localized name. UI nâng cao hơn defer Phase
 *    11.11.D-2)
 *  - Cost: linh thạch + success rate %
 *  - Nút Luyện đan (disable nếu in-flight)
 *
 * KHÔNG đụng schema/seed/runtime — pure FE wire của 2 endpoint Phase 11.11.C.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useAlchemyStore } from '@/stores/alchemy';
import { useToastStore } from '@/stores/toast';
import type { AlchemyRecipeView } from '@/api/alchemy';
import AppShell from '@/components/shell/AppShell.vue';

type QualityFilter =
  | 'all'
  | 'PHAM'
  | 'LINH'
  | 'HUYEN'
  | 'TIEN'
  | 'THAN';
type PillCategoryFilter = 'all' | string;
type TierFilter = 'all' | number;

const auth = useAuthStore();
const game = useGameStore();
const alchemy = useAlchemyStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const qualityFilter = ref<QualityFilter>('all');
const categoryFilter = ref<PillCategoryFilter>('all');
const tierFilter = ref<TierFilter>('all');

const filtered = computed<AlchemyRecipeView[]>(() => {
  return alchemy.recipes.filter((r) => {
    if (qualityFilter.value !== 'all' && r.outputQuality !== qualityFilter.value) return false;
    if (categoryFilter.value !== 'all' && r.recipeCategory !== categoryFilter.value) return false;
    if (tierFilter.value !== 'all' && r.recipeTier !== tierFilter.value) return false;
    return true;
  });
});

const categoryOptions = computed(() => Array.from(new Set(alchemy.recipes.map((r) => r.recipeCategory))).sort());
const tierOptions = computed(() => Array.from(new Set(alchemy.recipes.map((r) => r.recipeTier))).sort((a, b) => a - b));

const counts = computed(() => ({
  total: alchemy.recipes.length,
  filtered: filtered.value.length,
}));

function qualityClass(q: AlchemyRecipeView['outputQuality']): string {
  switch (q) {
    case 'PHAM':
      return 'bg-stone-700/40 text-stone-200 border-stone-500/40';
    case 'LINH':
      return 'bg-emerald-700/40 text-emerald-200 border-emerald-500/40';
    case 'HUYEN':
      return 'bg-sky-700/40 text-sky-200 border-sky-500/40';
    case 'TIEN':
      return 'bg-violet-700/40 text-violet-200 border-violet-500/40';
    case 'THAN':
      return 'bg-amber-700/40 text-amber-200 border-amber-500/40';
    default:
      return 'bg-ink-700/40 text-ink-200 border-ink-300/30';
  }
}

function craftButtonLabel(recipe: AlchemyRecipeView): string {
  if (alchemy.isCrafting(recipe.key)) return t('alchemy.button.crafting');
  return t('alchemy.button.craft');
}

function craftButtonDisabled(recipe: AlchemyRecipeView): boolean {
  return alchemy.isCrafting(recipe.key) || !recipe.canCraft;
}

function upgradeButtonDisabled(): boolean {
  return alchemy.upgradeInFlight || alchemy.nextUpgrade === null;
}

function upgradeButtonLabel(): string {
  if (alchemy.upgradeInFlight) return t('alchemy.upgrade.button.upgrading');
  if (alchemy.nextUpgrade === null) return t('alchemy.upgrade.button.maxLevel');
  return t('alchemy.upgrade.button.upgrade', {
    level: alchemy.nextUpgrade.toLevel,
  });
}

async function onUpgradeFurnace(): Promise<void> {
  if (upgradeButtonDisabled()) return;
  const errCode = await alchemy.upgradeFurnace();
  if (errCode === null) {
    const outcome = alchemy.lastUpgradeOutcome;
    if (outcome) {
      toast.push({
        type: 'success',
        text: t('alchemy.upgrade.success', {
          fromLevel: outcome.fromLevel,
          toLevel: outcome.toLevel,
        }),
      });
    }
    // Refetch recipes (level cao hơn có thể unlock recipe mới).
    await alchemy.fetchState().catch(() => null);
    // Refresh game state để cập nhật linh thạch hiển thị header.
    await game.fetchState().catch(() => null);
  } else {
    const key = `alchemy.upgrade.errors.${errCode}`;
    const text = t(key);
    toast.push({
      type: 'error',
      text: text === key ? t('alchemy.upgrade.errors.UNKNOWN') : text,
    });
  }
}

async function onCraft(recipe: AlchemyRecipeView): Promise<void> {
  if (craftButtonDisabled(recipe)) return;
  const errCode = await alchemy.craft(recipe.key);
  if (errCode === null) {
    const outcome = alchemy.lastOutcome;
    if (outcome && outcome.success) {
      toast.push({
        type: 'success',
        text: t('alchemy.craft.success', {
          name: recipe.name,
          qty: outcome.outputQty,
          grade: outcome.pillGrade ? t(`alchemy.grade.${outcome.pillGrade}`) : '',
          exp: outcome.alchemyExpGained,
        }),
      });
    } else {
      toast.push({
        type: 'warning',
        text: t('alchemy.craft.fail', { name: recipe.name, exp: outcome?.alchemyExpGained ?? '0' }),
      });
    }
    // Re-fetch state để cập nhật furnaceLevel + recipes (defensive — service
    // hiện không thay đổi furnaceLevel sau craft, nhưng nếu Phase 11.11.D-2
    // unlock furnace upgrade thì cần)
    await alchemy.fetchState().catch(() => null);
  } else {
    const key = `alchemy.craft.errors.${errCode}`;
    const text = t(key);
    toast.push({
      type: 'error',
      text: text === key ? t('alchemy.craft.errors.UNKNOWN') : text,
    });
  }
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  await alchemy.fetchState().catch(() => null);
});
</script>

<template>
  <AppShell>
    <div class="max-w-5xl mx-auto space-y-4">
      <header class="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 class="text-2xl tracking-widest font-bold">{{ t('alchemy.title') }}</h1>
          <p class="text-xs text-ink-300 mt-1">
            {{ t('alchemy.subtitle') }}
          </p>
        </div>
        <div class="text-xs text-ink-300 text-right space-y-0.5">
          <div data-testid="alchemy-furnace-level">
            {{ t('alchemy.furnaceLevel', { level: alchemy.furnaceLevel }) }}
          </div>
          <div data-testid="alchemy-master-level" class="text-amber-200">
            {{ t('alchemy.alchemyLevel', { level: alchemy.alchemyLevel, name: alchemy.alchemyLevelName }) }}
          </div>
          <div data-testid="alchemy-master-exp">
            {{ t('alchemy.alchemyExp', { exp: alchemy.alchemyExp, next: alchemy.alchemyExpNext }) }}
          </div>
        </div>
      </header>

      <section
        v-if="alchemy.loaded"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-3 flex flex-wrap items-center gap-3 text-xs"
        data-testid="alchemy-furnace-upgrade"
      >
        <div class="flex flex-col gap-0.5">
          <span class="text-ink-300">
            {{ t('alchemy.upgrade.title') }}
          </span>
          <span
            v-if="alchemy.nextUpgrade"
            class="text-ink-100"
            data-testid="alchemy-upgrade-preview"
          >
            <span class="text-amber-200">{{ alchemy.nextUpgrade.toLevel }}</span>
            <span class="text-ink-300 mx-1">|</span>
            <span class="text-amber-200">
              {{ alchemy.nextUpgrade.linhThachCost }}
            </span>
            <span class="text-ink-300 ml-1">{{ t('alchemy.field.linhThach') }}</span>
            <template v-if="alchemy.nextUpgrade.realmRequirement">
              <span class="text-ink-300 mx-1">|</span>
              <span class="text-violet-200">
                {{ t('alchemy.upgrade.realmReq', { realm: alchemy.nextUpgrade.realmRequirement }) }}
              </span>
            </template>
          </span>
          <span
            v-else
            class="text-ink-300"
            data-testid="alchemy-upgrade-max"
          >
            {{ t('alchemy.upgrade.maxNotice') }}
          </span>
        </div>
        <button
          type="button"
          :disabled="upgradeButtonDisabled()"
          data-testid="alchemy-upgrade-btn"
          class="ml-auto px-3 py-1.5 rounded bg-violet-700 text-violet-50 hover:bg-violet-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
          @click="onUpgradeFurnace()"
        >
          {{ upgradeButtonLabel() }}
        </button>
      </section>

      <section class="bg-ink-700/30 border border-ink-300/20 rounded p-3 flex flex-wrap items-center gap-3 text-xs">
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('alchemy.filter.quality') }}</label>
          <select
            v-model="qualityFilter"
            data-testid="alchemy-filter-quality"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('alchemy.filter.all') }}</option>
            <option value="PHAM">{{ t('alchemy.quality.PHAM') }}</option>
            <option value="LINH">{{ t('alchemy.quality.LINH') }}</option>
            <option value="HUYEN">{{ t('alchemy.quality.HUYEN') }}</option>
            <option value="TIEN">{{ t('alchemy.quality.TIEN') }}</option>
            <option value="THAN">{{ t('alchemy.quality.THAN') }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('alchemy.filter.category') }}</label>
          <select
            v-model="categoryFilter"
            data-testid="alchemy-filter-category"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('alchemy.filter.all') }}</option>
            <option v-for="category in categoryOptions" :key="category" :value="category">
              {{ t(`alchemy.category.${category}`) }}
            </option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('alchemy.filter.tier') }}</label>
          <select
            v-model="tierFilter"
            data-testid="alchemy-filter-tier"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('alchemy.filter.all') }}</option>
            <option v-for="tier in tierOptions" :key="tier" :value="tier">
              {{ t('alchemy.recipeTier', { tier }) }}
            </option>
          </select>
        </div>
        <span class="ml-auto text-ink-300" data-testid="alchemy-result-count">
          {{ t('alchemy.filter.shown', { shown: counts.filtered, total: counts.total }) }}
        </span>
      </section>

      <section
        v-if="!alchemy.loaded"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="alchemy-loading"
      >
        {{ t('alchemy.loading') }}
      </section>

      <section
        v-else-if="counts.filtered === 0"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="alchemy-empty"
      >
        {{ t('alchemy.empty') }}
      </section>

      <section v-else class="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="alchemy-list">
        <article
          v-for="recipe in filtered"
          :key="recipe.key"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-3 space-y-2"
          :data-testid="`alchemy-card-${recipe.key}`"
        >
          <header class="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 class="text-amber-200 text-base font-semibold">{{ recipe.name }}</h2>
            <div class="flex items-center gap-1">
              <span
                :class="['text-[10px] px-1.5 py-0.5 rounded border', qualityClass(recipe.outputQuality)]"
                :data-testid="`alchemy-quality-${recipe.key}`"
              >
                {{ t(`alchemy.quality.${recipe.outputQuality}`) }}
              </span>
              <span
                class="text-[10px] px-1.5 py-0.5 rounded border bg-ink-700/40 text-ink-200 border-ink-300/30"
                :data-testid="`alchemy-furnace-${recipe.key}`"
              >
                {{ t('alchemy.furnaceReq', { level: recipe.furnaceLevel }) }}
              </span>
              <span class="text-[10px] px-1.5 py-0.5 rounded border bg-amber-700/30 text-amber-100 border-amber-500/30">
                {{ t('alchemy.recipeTier', { tier: recipe.recipeTier }) }}
              </span>
            </div>
          </header>

          <p class="text-xs text-ink-300">{{ recipe.description }}</p>

          <div class="text-xs space-y-1">
            <div>
              <span class="text-ink-300">{{ t('alchemy.field.category') }}:</span>
              <span class="text-violet-200 ml-1">{{ t(`alchemy.category.${recipe.recipeCategory}`) }}</span>
              <span class="text-ink-300 mx-2">|</span>
              <span class="text-ink-300">{{ t('alchemy.field.requiredAlchemy') }}:</span>
              <span class="text-amber-200 ml-1">{{ recipe.requiredAlchemyLevel }}</span>
            </div>
            <div>
              <span class="text-ink-300">{{ t('alchemy.field.output') }}:</span>
              <span class="text-emerald-200 ml-1" :data-testid="`alchemy-output-${recipe.key}`">
                {{ recipe.outputItem }} × {{ recipe.outputQty }}
              </span>
            </div>
            <div>
              <span class="text-ink-300">{{ t('alchemy.field.inputs') }}:</span>
              <span class="text-ink-100 ml-1" :data-testid="`alchemy-inputs-${recipe.key}`">
                <template v-for="(input, idx) in recipe.inputs" :key="input.itemKey">
                  <span v-if="idx > 0">, </span>
                  <span>{{ input.itemKey }} × {{ input.qty }}</span>
                </template>
              </span>
            </div>
            <div v-if="recipe.sourceHint?.length">
              <span class="text-ink-300">{{ t('alchemy.field.sourceHint') }}:</span>
              <span class="text-ink-100 ml-1">{{ recipe.sourceHint.join(', ') }}</span>
            </div>
            <div v-if="recipe.missingInputs.length > 0">
              <span class="text-rose-300">{{ t('alchemy.field.missingInputs') }}:</span>
              <span class="text-rose-200 ml-1">
                <template v-for="(input, idx) in recipe.missingInputs" :key="input.itemKey">
                  <span v-if="idx > 0">, </span>
                  <span>{{ input.itemKey }} {{ input.ownedQty }}/{{ input.requiredQty }}</span>
                </template>
              </span>
            </div>
            <div class="flex flex-wrap gap-x-3">
              <span>
                <span class="text-ink-300">{{ t('alchemy.field.cost') }}:</span>
                <span class="text-amber-200 ml-1" :data-testid="`alchemy-cost-${recipe.key}`">
                  {{ recipe.linhThachCost }}
                  {{ t('alchemy.field.linhThach') }}
                </span>
              </span>
              <span>
                <span class="text-ink-300">{{ t('alchemy.field.successRate') }}:</span>
                <span class="text-sky-200 ml-1" :data-testid="`alchemy-rate-${recipe.key}`">
                  {{ Math.round(recipe.successRateFinal * 100) }}%
                  <span class="text-ink-400">({{ Math.round(recipe.successRateBase * 100) }}%)</span>
                </span>
              </span>
              <span>
                <span class="text-ink-300">{{ t('alchemy.field.possibleGrades') }}:</span>
                <span class="text-emerald-200 ml-1">{{ recipe.possibleGrades.map((g) => t(`alchemy.grade.${g}`)).join(', ') }}</span>
              </span>
              <span v-if="recipe.maxOutputGrade">
                <span class="text-ink-300">{{ t('alchemy.field.maxGrade') }}:</span>
                <span class="text-amber-200 ml-1">{{ t(`alchemy.grade.${recipe.maxOutputGrade}`) }}</span>
              </span>
            </div>
            <div v-if="!recipe.canCraft && recipe.failureReason" class="text-rose-300">
              {{ t(`alchemy.craft.errors.${recipe.failureReason}`) }}
            </div>
          </div>

          <button
            type="button"
            :disabled="craftButtonDisabled(recipe)"
            :data-testid="`alchemy-craft-${recipe.key}`"
            class="w-full mt-1 px-3 py-1.5 text-sm rounded bg-amber-700 text-amber-50 hover:bg-amber-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
            @click="onCraft(recipe)"
          >
            {{ craftButtonLabel(recipe) }}
          </button>
        </article>
      </section>
    </div>
  </AppShell>
</template>
