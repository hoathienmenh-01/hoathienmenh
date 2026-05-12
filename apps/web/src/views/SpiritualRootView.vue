<script setup lang="ts">
/**
 * Phase 11.3.D — Spiritual Root (Linh Căn) view.
 *
 * Hiển thị state linh căn của character (server-authoritative qua
 * `GET /character/spiritual-root`):
 *   - Grade card: tên + tier + description (tooltip-style block) + style
 *     theo grade.
 *   - Element wheel: 5 ô Ngũ Hành (Kim/Mộc/Thuỷ/Hoả/Thổ); element primary
 *     đánh dấu nổi bật, secondary mờ hơn, còn lại disabled.
 *   - Stats: cultivation multiplier, stat bonus %, purity, secondary count.
 *   - Reroll dialog: confirm consume 1× `linh_can_dan` → POST
 *     `/character/spiritual-root/reroll` (Phase 11.3.D).
 *
 * Server-authoritative: client KHÔNG kiểm số lượng item, KHÔNG tự cộng
 * grade — server validate ownership + atomic consume + roll mới + insert
 * SpiritualRootRollLog source='reroll'.
 *
 * Phase 11.3.A đã wire `GET /character/spiritual-root` (lazy onboard cho
 * legacy character). View này chỉ render state + interaction layer.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  ELEMENTS,
  recommendBuildForCharacter,
  getSpiritualRootGradeDef,
  type ElementKey,
  type SpiritualRootGrade,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useSpiritualRootStore } from '@/stores/spiritualRoot';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';

const auth = useAuthStore();
const game = useGameStore();
const root = useSpiritualRootStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const showConfirm = ref(false);

const gradeKey = computed<SpiritualRootGrade | null>(() => {
  if (!root.state) return null;
  return root.state.grade as SpiritualRootGrade;
});

const gradeDef = computed(() => {
  if (!gradeKey.value) return null;
  // `getSpiritualRootGradeDef` throws on invalid grade. Server đảm bảo grade
  // luôn ∈ SPIRITUAL_ROOT_GRADES, nhưng trap defensive.
  try {
    return getSpiritualRootGradeDef(gradeKey.value);
  } catch {
    return null;
  }
});

const primaryElement = computed<ElementKey | null>(() => {
  if (!root.state) return null;
  return root.state.primaryElement as ElementKey;
});

const secondarySet = computed<Set<ElementKey>>(() => {
  if (!root.state) return new Set();
  return new Set(root.state.secondaryElements as ElementKey[]);
});

const buildRecommendation = computed(() =>
  recommendBuildForCharacter(
    root.state
      ? {
          primaryElement: root.state.primaryElement as ElementKey,
          secondaryElements: root.state.secondaryElements as ElementKey[],
          spiritualRootGrade: root.state.grade as SpiritualRootGrade,
        }
      : null,
  ),
);

function gradeBadgeClass(g: SpiritualRootGrade): string {
  switch (g) {
    case 'pham':
      return 'bg-stone-700/40 text-stone-200 border-stone-500/40';
    case 'linh':
      return 'bg-emerald-700/40 text-emerald-200 border-emerald-500/40';
    case 'huyen':
      return 'bg-sky-700/40 text-sky-200 border-sky-500/40';
    case 'tien':
      return 'bg-violet-700/40 text-violet-200 border-violet-500/40';
    case 'than':
      return 'bg-amber-700/40 text-amber-200 border-amber-500/40';
  }
}

function elementCellClass(elKey: ElementKey): string {
  if (primaryElement.value === elKey) {
    return 'bg-amber-500/30 border-amber-300 text-amber-100 ring-2 ring-amber-300/60 shadow-lg shadow-amber-700/20';
  }
  if (secondarySet.value.has(elKey)) {
    return 'bg-sky-700/30 border-sky-400/60 text-sky-100';
  }
  return 'bg-ink-700/20 border-ink-300/20 text-ink-400';
}

function elementCellRole(elKey: ElementKey): 'primary' | 'secondary' | 'inactive' {
  if (primaryElement.value === elKey) return 'primary';
  if (secondarySet.value.has(elKey)) return 'secondary';
  return 'inactive';
}

function elementLabel(element: ElementKey | null): string {
  return element ? t(`spiritualRoot.element.${element}`) : t('elementBadge.neutral');
}

function openRerollConfirm(): void {
  if (root.rerolling) return;
  showConfirm.value = true;
}

function cancelReroll(): void {
  showConfirm.value = false;
}

async function confirmReroll(): Promise<void> {
  if (root.rerolling) return;
  showConfirm.value = false;
  const errCode = await root.reroll();
  if (errCode === null) {
    toast.push({
      type: 'success',
      text: t('spiritualRoot.reroll.success'),
    });
    return;
  }
  const key = `spiritualRoot.reroll.errors.${errCode}`;
  const text = t(key);
  toast.push({
    type: 'error',
    text: text === key ? t('spiritualRoot.reroll.errors.UNKNOWN') : text,
  });
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  await root.fetchState().catch(() => null);
});
</script>

<template>
  <AppShell>
    <div class="max-w-3xl mx-auto space-y-4">
      <header class="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 class="text-2xl tracking-widest font-bold">{{ t('spiritualRoot.title') }}</h1>
          <p class="text-xs text-ink-300 mt-1">{{ t('spiritualRoot.subtitle') }}</p>
        </div>
        <div
          v-if="root.state"
          class="text-xs text-ink-300"
          data-testid="spiritual-root-reroll-count"
        >
          {{ t('spiritualRoot.rerollCount', { count: root.state.rerollCount }) }}
        </div>
      </header>

      <section
        v-if="!root.loaded"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="spiritual-root-loading"
      >
        {{ t('spiritualRoot.loading') }}
      </section>

      <section
        v-else-if="!root.state || !gradeDef"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="spiritual-root-empty"
      >
        {{ t('spiritualRoot.empty') }}
      </section>

      <template v-else>
        <article
          class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-3"
          data-testid="spiritual-root-grade-card"
        >
          <header class="flex items-baseline justify-between gap-2 flex-wrap">
            <div class="flex items-baseline gap-2">
              <h2 class="text-amber-200 text-lg font-semibold" data-testid="spiritual-root-grade-name">
                {{ gradeDef.name }}
              </h2>
              <span
                :class="['text-[10px] px-1.5 py-0.5 rounded border', gradeBadgeClass(gradeDef.key)]"
                :data-testid="`spiritual-root-grade-badge-${gradeDef.key}`"
              >
                {{ t(`spiritualRoot.grade.${gradeDef.key}`) }}
              </span>
              <span
                class="text-[10px] px-1.5 py-0.5 rounded border bg-ink-700/40 text-ink-200 border-ink-300/30"
                data-testid="spiritual-root-tier"
              >
                {{ t('spiritualRoot.field.tier', { tier: gradeDef.tier }) }}
              </span>
            </div>
            <div class="flex items-center gap-3 text-xs text-ink-300">
              <span data-testid="spiritual-root-purity">
                {{ t('spiritualRoot.field.purity') }}:
                <span class="text-emerald-200 ml-1">{{ root.state.purity }}/100</span>
              </span>
            </div>
          </header>

          <p class="text-xs text-ink-300" data-testid="spiritual-root-grade-description">
            {{ gradeDef.description }}
          </p>

          <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span data-testid="spiritual-root-cultivation-multiplier">
              <span class="text-ink-300">{{ t('spiritualRoot.field.cultivationMultiplier') }}</span>
              <span class="text-amber-200 ml-1">×{{ gradeDef.cultivationMultiplier.toFixed(2) }}</span>
            </span>
            <span data-testid="spiritual-root-stat-bonus">
              <span class="text-ink-300">{{ t('spiritualRoot.field.statBonus') }}</span>
              <span class="text-emerald-200 ml-1">+{{ gradeDef.statBonusPercent }}%</span>
            </span>
            <span data-testid="spiritual-root-secondary-count">
              <span class="text-ink-300">{{ t('spiritualRoot.field.secondaryCount') }}</span>
              <span class="text-ink-100 ml-1">{{ gradeDef.secondaryElementCount }}</span>
            </span>
          </div>
        </article>

        <article
          class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-4"
          data-testid="elemental-build-panel"
        >
          <header class="flex items-baseline justify-between gap-2 flex-wrap">
            <div>
              <h2 class="text-base font-semibold text-ink-100">
                {{ t('spiritualRoot.build.title') }}
              </h2>
              <p class="text-xs text-ink-300 mt-0.5">{{ t('spiritualRoot.build.subtitle') }}</p>
            </div>
            <span class="text-[10px] px-2 py-0.5 rounded border border-amber-400/40 text-amber-100 bg-amber-700/20">
              {{ t('spiritualRoot.build.phaseBadge') }}
            </span>
          </header>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="rounded border border-ink-300/20 bg-ink-900/20 p-3">
              <div class="text-[10px] uppercase tracking-wider text-ink-400">
                {{ t('spiritualRoot.build.mainElement') }}
              </div>
              <div class="mt-1 text-lg font-semibold text-amber-100" data-testid="elemental-build-main">
                {{ elementLabel(buildRecommendation.mainElement) }}
              </div>
              <div class="text-xs text-ink-300">
                {{ t('spiritualRoot.build.secondaryElement') }}:
                <span class="text-sky-200">{{ elementLabel(buildRecommendation.secondaryElement) }}</span>
              </div>
            </div>

            <div class="rounded border border-ink-300/20 bg-ink-900/20 p-3">
              <div class="text-[10px] uppercase tracking-wider text-ink-400">
                {{ t('spiritualRoot.build.equipmentElement') }}
              </div>
              <div class="mt-1 text-lg font-semibold text-emerald-100" data-testid="elemental-build-equipment">
                {{ elementLabel(buildRecommendation.equipmentElement) }}
              </div>
              <div class="text-xs text-ink-300">{{ t('spiritualRoot.build.equipmentHint') }}</div>
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-3">
            <section class="space-y-2">
              <h3 class="text-xs font-semibold text-ink-100">
                {{ t('spiritualRoot.build.statsTitle') }}
              </h3>
              <div class="flex flex-wrap gap-1" data-testid="elemental-build-stats">
                <span
                  v-for="stat in buildRecommendation.recommendedStats"
                  :key="stat"
                  class="text-[10px] rounded border border-ink-300/20 bg-ink-900/30 px-1.5 py-0.5 text-ink-200"
                >
                  {{ stat }}
                </span>
              </div>
            </section>

            <section class="space-y-2">
              <h3 class="text-xs font-semibold text-ink-100">
                {{ t('spiritualRoot.build.skillsTitle') }}
              </h3>
              <ul class="space-y-1 text-xs text-ink-300" data-testid="elemental-build-skills">
                <li
                  v-for="skill in buildRecommendation.recommendedSkills.slice(0, 5)"
                  :key="skill"
                  class="truncate"
                >
                  {{ skill }}
                </li>
              </ul>
            </section>

            <section class="space-y-2">
              <h3 class="text-xs font-semibold text-ink-100">
                {{ t('spiritualRoot.build.counterTitle') }}
              </h3>
              <ul class="space-y-1 text-xs text-ink-300" data-testid="elemental-build-tips">
                <li v-for="tip in buildRecommendation.counterTips" :key="tip">
                  {{ tip }}
                </li>
              </ul>
            </section>
          </div>

          <div
            v-if="buildRecommendation.warnings.length > 0"
            class="rounded border border-amber-400/30 bg-amber-900/20 p-2 text-xs text-amber-100"
            data-testid="elemental-build-warning"
          >
            {{ buildRecommendation.warnings.join(' · ') }}
          </div>
        </article>

        <article
          class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-3"
          data-testid="spiritual-root-elements-card"
        >
          <header class="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 class="text-base font-semibold text-ink-100">{{ t('spiritualRoot.elements.title') }}</h2>
            <p class="text-xs text-ink-300">{{ t('spiritualRoot.elements.legend') }}</p>
          </header>

          <div
            class="grid grid-cols-5 gap-2"
            data-testid="spiritual-root-element-wheel"
          >
            <div
              v-for="el in ELEMENTS"
              :key="el"
              :class="['flex flex-col items-center justify-center rounded border px-2 py-3 transition', elementCellClass(el)]"
              :data-testid="`spiritual-root-element-${el}`"
              :data-role="elementCellRole(el)"
            >
              <span class="text-base font-semibold leading-none">{{ t(`spiritualRoot.element.${el}`) }}</span>
              <span class="text-[10px] mt-1 opacity-80">
                <template v-if="elementCellRole(el) === 'primary'">
                  {{ t('spiritualRoot.element.role.primary') }}
                </template>
                <template v-else-if="elementCellRole(el) === 'secondary'">
                  {{ t('spiritualRoot.element.role.secondary') }}
                </template>
                <template v-else>
                  {{ t('spiritualRoot.element.role.inactive') }}
                </template>
              </span>
            </div>
          </div>

          <div
            v-if="root.state.secondaryElements.length > 0"
            class="text-xs text-ink-300"
            data-testid="spiritual-root-secondary-list"
          >
            {{ t('spiritualRoot.elements.secondaryLabel') }}:
            <span class="text-sky-200 ml-1">
              {{
                root.state.secondaryElements
                  .map((el) => t(`spiritualRoot.element.${el}`))
                  .join(', ')
              }}
            </span>
          </div>
        </article>

        <article
          class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-3"
          data-testid="spiritual-root-reroll-card"
        >
          <header class="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 class="text-base font-semibold text-ink-100">{{ t('spiritualRoot.reroll.title') }}</h2>
          </header>
          <p class="text-xs text-ink-300">{{ t('spiritualRoot.reroll.description') }}</p>
          <p class="text-xs text-amber-200/80">{{ t('spiritualRoot.reroll.warning') }}</p>
          <button
            type="button"
            :disabled="root.rerolling"
            data-testid="spiritual-root-reroll-button"
            class="px-3 py-1.5 text-sm rounded bg-amber-700 text-amber-50 hover:bg-amber-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
            @click="openRerollConfirm"
          >
            {{
              root.rerolling
                ? t('spiritualRoot.reroll.button.inFlight')
                : t('spiritualRoot.reroll.button.idle')
            }}
          </button>
        </article>
      </template>

      <div
        v-if="showConfirm"
        class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
        data-testid="spiritual-root-reroll-confirm"
        role="dialog"
        aria-modal="true"
      >
        <div class="bg-ink-900 border border-ink-300/30 rounded p-4 space-y-3 max-w-md w-full mx-4">
          <h3 class="text-base font-semibold text-amber-200">
            {{ t('spiritualRoot.reroll.confirm.title') }}
          </h3>
          <p class="text-xs text-ink-300">
            {{ t('spiritualRoot.reroll.confirm.body') }}
          </p>
          <p class="text-xs text-amber-200/80">
            {{ t('spiritualRoot.reroll.confirm.cost') }}
          </p>
          <div class="flex justify-end gap-2 pt-1">
            <button
              type="button"
              data-testid="spiritual-root-reroll-cancel"
              class="px-3 py-1.5 text-sm rounded bg-ink-700/40 text-ink-200 hover:bg-ink-700/60"
              @click="cancelReroll"
            >
              {{ t('spiritualRoot.reroll.confirm.cancel') }}
            </button>
            <button
              type="button"
              data-testid="spiritual-root-reroll-accept"
              class="px-3 py-1.5 text-sm rounded bg-amber-700 text-amber-50 hover:bg-amber-600"
              @click="confirmReroll"
            >
              {{ t('spiritualRoot.reroll.confirm.accept') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </AppShell>
</template>
