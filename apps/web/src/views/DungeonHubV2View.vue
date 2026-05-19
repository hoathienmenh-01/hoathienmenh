<script setup lang="ts">
/**
 * Phase 26.5 — Dungeon Hub V2 view.
 *
 * List bí cảnh V2 (`GET /world/dungeons`) chia theo category — server
 * static catalog `DUNGEONS_V2`. Hỗ trợ filter category (ALL +
 * `DungeonCategoryV2`). Bao trùm 4 state UI MODULE RULE: loading /
 * error+reload / empty / list.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWorldContentStore } from '@/stores/worldContent';
import type { DungeonV2View } from '@/api/worldContent';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';

const { t, locale } = useI18n();
const store = useWorldContentStore();

const isLoaded = computed(() => store.loaded['dungeons'] === true);
const dungeons = computed(() => store.dungeons);
const reloadFailed = ref(false);

const categoryFilter = ref<'ALL' | string>('ALL');

const categories = computed<string[]>(() => {
  const set = new Set<string>();
  for (const d of dungeons.value) set.add(d.category);
  return Array.from(set).sort();
});

const filtered = computed<DungeonV2View[]>(() => {
  if (categoryFilter.value === 'ALL') return dungeons.value;
  return dungeons.value.filter((d) => d.category === categoryFilter.value);
});

function pickName(d: DungeonV2View): string {
  return locale.value === 'en' ? d.nameEn : d.nameVi;
}
function pickDesc(d: DungeonV2View): string {
  return locale.value === 'en' ? d.descriptionEn : d.descriptionVi;
}

async function refresh(): Promise<void> {
  reloadFailed.value = false;
  const err = await store.fetchDungeons();
  if (err) reloadFailed.value = true;
}

onMounted(() => {
  if (!isLoaded.value) refresh();
});
</script>

<template>
  <AppShell>
    <section class="dungeon-hub" data-testid="dungeon-hub-v2-view">
      <XTLuxHero
        :eyebrow="t('luxHero.dungeonHubV2.eyebrow')"
        :label="t('luxHero.dungeonHubV2.label')"
        :title="t('worldContent.dungeon.title')"
        :subtitle="t('worldContent.dungeon.subtitle')"
        tone="seal"
        watermark-letter="T"
        :breadcrumb="t('luxHero.dungeonHubV2.breadcrumb')"
        test-id="dungeon-hub-v2-hero"
      >
        <XTPageEyebrow caps="TIÊN HẠCH TỔNG TRẠM" label="Tiên Hạch Tổng Trạm" class="sr-only" />
      </XTLuxHero>

      <!-- Role hint -->
      <p class="text-sm text-gray-400 px-1" data-testid="dungeon-hub-v2-role-hint">
        {{ t('dungeonHubV2.roleHint') }}
      </p>

      <!-- Cross-navigation -->
      <nav class="flex gap-2 text-xs mb-2" data-testid="dungeon-hub-v2-cross-nav">
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-dungeon"
          @click="$router.push('/dungeon')"
        >
          <span>{{ t('dungeonHubV2.crossNav.dungeon') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('dungeonHubV2.crossNav.dungeonDesc') }}</span>
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-combat"
          @click="$router.push('/combat')"
        >
          <span>{{ t('dungeonHubV2.crossNav.combat') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('dungeonHubV2.crossNav.combatDesc') }}</span>
        </button>
      </nav>

      <div
        v-if="reloadFailed && dungeons.length === 0"
        class="dungeon-hub__state dungeon-hub__state--error"
        data-testid="dungeon-hub-error"
      >
        <p>{{ t('worldContent.reloadError') }}</p>
        <button @click="refresh">{{ t('worldContent.reload') }}</button>
      </div>

      <div
        v-else-if="dungeons.length === 0 && !isLoaded"
        class="dungeon-hub__state"
        data-testid="dungeon-hub-loading"
      >
        {{ t('worldContent.dungeon.loading') }}
      </div>

      <div
        v-else-if="dungeons.length === 0"
        class="dungeon-hub__state"
        data-testid="dungeon-hub-empty"
      >
        {{ t('worldContent.dungeon.empty') }}
      </div>

      <template v-else>
        <label class="dungeon-hub__filter">
          {{ t('worldContent.dungeon.category') }}:
          <select v-model="categoryFilter" data-testid="dungeon-hub-filter">
            <option value="ALL">{{ t('worldContent.dungeon.all') }}</option>
            <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>

        <ul class="dungeon-hub__list" data-testid="dungeon-hub-list">
          <li
            v-for="d in filtered"
            :key="d.key"
            class="dungeon-hub__item"
            :data-testid="`dungeon-hub-item-${d.key}`"
          >
            <div class="dungeon-hub__item-head">
              <h2>{{ pickName(d) }}</h2>
              <span class="dungeon-hub__chip">{{ d.category }}</span>
            </div>
            <p class="dungeon-hub__desc">{{ pickDesc(d) }}</p>
            <dl>
              <div>
                <dt>{{ t('worldContent.dungeon.region') }}</dt>
                <dd>{{ d.regionKey }}</dd>
              </div>
              <div>
                <dt>{{ t('worldContent.dungeon.sourceTier') }}</dt>
                <dd>{{ d.sourceTier }}</dd>
              </div>
              <div>
                <dt>{{ t('worldContent.dungeon.dungeonTier') }}</dt>
                <dd>{{ d.dungeonTier }}</dd>
              </div>
              <div>
                <dt>{{ t('worldContent.dungeon.realm') }}</dt>
                <dd>{{ d.unlockRealmOrder }}</dd>
              </div>
              <div>
                <dt>{{ t('worldContent.dungeon.dailyAttempts') }}</dt>
                <dd>{{ d.dailyAttempts }}</dd>
              </div>
            </dl>
          </li>
        </ul>
      </template>
    </section>
  </AppShell>
</template>

<style scoped>
.dungeon-hub {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}
.dungeon-hub__state {
  padding: 24px;
  background: var(--surface, #1c1f24);
  border-radius: 8px;
  text-align: center;
}
.dungeon-hub__state--error {
  border: 1px solid var(--danger, #b94343);
}
.dungeon-hub__filter {
  display: flex;
  gap: 8px;
  align-items: center;
}
.dungeon-hub__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.dungeon-hub__item {
  background: var(--surface, #1c1f24);
  padding: 12px;
  border-radius: 8px;
}
.dungeon-hub__item-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.dungeon-hub__chip {
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--muted-bg, #2c3038);
  font-size: 0.75em;
}
.dungeon-hub__desc {
  margin: 8px 0;
  font-size: 0.9em;
  color: var(--muted, #8a90a0);
}
.dungeon-hub__item dl {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 6px;
  margin: 0;
}
.dungeon-hub__item dt {
  font-size: 0.75em;
  color: var(--muted, #8a90a0);
}
.dungeon-hub__item dd {
  margin: 0;
  font-weight: 600;
}
</style>
