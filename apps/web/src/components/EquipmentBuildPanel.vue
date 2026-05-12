<!--
  Phase 23.3 — Equipment Build Panel.
  Hiển thị tổng kết Set Bonus + Gear Resonance + Ngũ Hành.
  Loading / empty / error state; mobile responsive.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  getEquipmentBuild,
  type EquipmentBuildSummaryDto,
} from '@/api/inventory';
import type { ElementKey } from '@xuantoi/shared';

const props = defineProps<{ /** Refresh trigger từ parent: tăng key → reload. */ refreshKey?: number }>();

const { t } = useI18n();
const summary = ref<EquipmentBuildSummaryDto | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    summary.value = await getEquipmentBuild();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'LOAD_FAIL';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(
  () => props.refreshKey,
  () => load(),
);

function elementLabel(k: ElementKey | null): string {
  if (!k) return t('inventory.build.noMainElement');
  return t(`inventory.build.element.${k}`);
}

function pct(ratio: number | undefined): number {
  if (!ratio) return 0;
  return Math.round(ratio * 1000) / 10;
}

const totalBonusPercent = computed(() => {
  const r = summary.value?.totalBonusRatio;
  if (!r) return 0;
  const sum =
    (r.atkRatio ?? 0) +
    (r.defRatio ?? 0) +
    (r.hpMaxRatio ?? 0) +
    (r.mpMaxRatio ?? 0) +
    (r.spiritRatio ?? 0);
  return Math.round(sum * 1000) / 10;
});
</script>

<template>
  <section
    class="rounded border border-amber-300/40 bg-ink-700/40 p-4 space-y-3"
    data-testid="equipment-build-panel"
  >
    <header class="flex items-center justify-between gap-2 flex-wrap">
      <div>
        <h3 class="text-base font-bold tracking-wider">{{ t('inventory.build.title') }}</h3>
        <p class="text-xs text-ink-300 mt-0.5">{{ t('inventory.build.subtitle') }}</p>
      </div>
      <span
        class="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded bg-amber-500/20 text-amber-200"
      >{{ t('inventory.build.phaseBadge') }}</span>
    </header>

    <div v-if="loading" class="text-sm text-ink-300 italic" data-testid="build-loading">…</div>
    <div v-else-if="error" class="text-sm text-red-300" data-testid="build-error">
      {{ error }}
    </div>
    <div v-else-if="!summary" class="text-sm text-ink-300 italic" data-testid="build-empty">
      {{ t('inventory.build.empty') }}
    </div>
    <div v-else class="space-y-4" data-testid="build-content">
      <!-- Tóm tắt header -->
      <dl
        class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs"
        data-testid="build-summary-grid"
      >
        <div class="rounded bg-ink-800/60 p-2">
          <dt class="text-ink-300">{{ t('inventory.build.mainElement') }}</dt>
          <dd class="font-bold" data-testid="build-main-element">
            {{ elementLabel(summary.mainElement) }}
          </dd>
        </div>
        <div class="rounded bg-ink-800/60 p-2">
          <dt class="text-ink-300">{{ t('inventory.build.pieceCount') }}</dt>
          <dd class="font-bold" data-testid="build-piece-count">{{ summary.pieceCount }}</dd>
        </div>
        <div class="rounded bg-ink-800/60 p-2">
          <dt class="text-ink-300">{{ t('inventory.build.activeSetCount') }}</dt>
          <dd class="font-bold" data-testid="build-active-set-count">
            {{ summary.activeSetCount }}
          </dd>
        </div>
        <div class="rounded bg-ink-800/60 p-2">
          <dt class="text-ink-300">{{ t('inventory.build.resonanceTier') }}</dt>
          <dd class="font-bold text-amber-200" data-testid="build-resonance-tier">
            {{ t(`inventory.build.tier.${summary.resonanceTier}`) }}
          </dd>
        </div>
      </dl>

      <div class="text-xs text-emerald-200" data-testid="build-total-bonus">
        {{ t('inventory.build.totalBonus') }}:
        {{ t('inventory.build.totalBonusFormat', { percent: totalBonusPercent }) }}
      </div>

      <!-- Set Bonus list -->
      <section data-testid="build-set-section">
        <h4 class="text-sm font-semibold tracking-wide mb-2">
          {{ t('inventory.build.sectionSets') }}
        </h4>
        <div
          v-if="summary.activeSets.length === 0"
          class="text-xs text-ink-300 italic"
          data-testid="build-set-empty"
        >
          {{ t('inventory.build.noSet') }}
        </div>
        <ul v-else class="space-y-2">
          <li
            v-for="setEntry in summary.activeSets"
            :key="setEntry.setKey"
            class="rounded border border-ink-300/30 bg-ink-800/40 p-2 text-xs"
            data-testid="build-set-row"
          >
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <span class="font-bold" :data-set-key="setEntry.setKey">
                {{ setEntry.set.nameVi ?? setEntry.set.name }}
              </span>
              <span class="text-[10px] text-cyan-200">
                {{ t('inventory.build.tierPieces', { pieces: setEntry.pieceCount }) }} /
                {{ elementLabel(setEntry.set.elementAffinity) }}
              </span>
            </div>
            <div
              v-if="setEntry.missingSlots.length > 0"
              class="text-[10px] text-amber-200 mt-1"
            >
              {{ t('inventory.build.missingSlots', { count: setEntry.missingSlots.length }) }}
            </div>
            <ul class="mt-1 space-y-0.5">
              <li
                v-for="tier in setEntry.activeTiers"
                :key="tier.pieces"
                class="text-emerald-300"
                data-testid="build-set-tier"
              >
                {{ t('inventory.build.tierPieces', { pieces: tier.pieces }) }}:
                {{ tier.descriptionVi ?? tier.description }}
              </li>
            </ul>
          </li>
        </ul>
      </section>

      <!-- Resonance list -->
      <section data-testid="build-resonance-section">
        <h4 class="text-sm font-semibold tracking-wide mb-2">
          {{ t('inventory.build.sectionResonance') }}
        </h4>
        <div
          v-if="summary.resonance.active.length === 0"
          class="text-xs text-ink-300 italic"
          data-testid="build-resonance-empty"
        >
          {{ t('inventory.build.noResonance') }}
        </div>
        <ul v-else class="space-y-1">
          <li
            v-for="effect in summary.resonance.active"
            :key="effect.key"
            class="rounded border border-ink-300/30 bg-ink-800/40 p-2 text-xs flex items-center justify-between gap-2 flex-wrap"
            data-testid="build-resonance-row"
          >
            <span class="font-bold text-cyan-200">
              [{{ t(`inventory.build.resonanceKind.${effect.kind}`) }}]
              {{ effect.descriptionVi ?? effect.description }}
            </span>
            <span class="text-[10px] text-emerald-200">
              +{{ pct((effect.ratio.atkRatio ?? 0) + (effect.ratio.defRatio ?? 0)
                  + (effect.ratio.hpMaxRatio ?? 0) + (effect.ratio.mpMaxRatio ?? 0)
                  + (effect.ratio.spiritRatio ?? 0)) }}%
            </span>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>
