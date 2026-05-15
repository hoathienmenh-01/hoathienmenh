<script setup lang="ts">
/**
 * Phase 26.5 — World Content V2 summary dashboard.
 *
 * Hiển thị tổng quan content (`GET /world/summary`):
 *   - tổng số region · farm map · dungeon · boss · sect dungeon · sect boss
 *     · trial tower · monster · elite · opportunity · world boss · event
 *     boss · quest boss.
 *   - bảng `contentByRegion` (số map / dungeon / boss / opportunity).
 *
 * Bao trùm 4 state UI MODULE RULE: loading / error+reload / empty / list.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useWorldContentStore } from '@/stores/worldContent';
import AppShell from '@/components/shell/AppShell.vue';
import XTHeroEyebrow from '@/components/xianxia/XTHeroEyebrow.vue';

const { t } = useI18n();
const router = useRouter();
const store = useWorldContentStore();

const summary = computed(() => store.summary);
const isLoaded = computed(() => store.loaded['summary'] === true);
const reloadFailed = ref(false);

async function refresh(): Promise<void> {
  reloadFailed.value = false;
  const err = await store.fetchSummary();
  if (err) reloadFailed.value = true;
}

onMounted(() => {
  if (!isLoaded.value) refresh();
});

function goto(name: string): void {
  router.push({ name });
}
</script>

<template>
  <AppShell>
    <section class="world-content" data-testid="world-content-view">
      <header class="world-content__header">
        <XTHeroEyebrow han="千仙世界" label="Thiên Tiên Thế Giới" />
        <h1 class="mt-1">{{ t('worldContent.title') }}</h1>
        <p>{{ t('worldContent.subtitle') }}</p>
      </header>

      <nav class="world-content__tabs">
        <button @click="goto('world-farm-maps')">
          {{ t('worldContent.tabs.farm') }}
        </button>
        <button @click="goto('world-dungeons-v2')">
          {{ t('worldContent.tabs.dungeon') }}
        </button>
        <button @click="goto('world-bosses-v2')">
          {{ t('worldContent.tabs.boss') }}
        </button>
        <button @click="goto('world-sect')">
          {{ t('worldContent.tabs.sect') }}
        </button>
        <button @click="goto('world-trial-tower')">
          {{ t('worldContent.tabs.tower') }}
        </button>
      </nav>

      <div
        v-if="reloadFailed && !summary"
        class="world-content__state world-content__state--error"
        data-testid="world-content-error"
      >
        <p>{{ t('worldContent.reloadError') }}</p>
        <button @click="refresh">{{ t('worldContent.reload') }}</button>
      </div>

      <div
        v-else-if="!summary"
        class="world-content__state"
        data-testid="world-content-loading"
      >
        {{ t(isLoaded ? 'worldContent.empty' : 'worldContent.loading') }}
      </div>

      <div v-else class="world-content__body" data-testid="world-content-list">
        <ul class="world-content__stats">
          <li><strong>{{ summary.totalRegions }}</strong><span>{{ t('worldContent.summary.totalRegions') }}</span></li>
          <li><strong>{{ summary.totalFarmMaps }}</strong><span>{{ t('worldContent.summary.totalFarmMaps') }}</span></li>
          <li><strong>{{ summary.totalDungeons }}</strong><span>{{ t('worldContent.summary.totalDungeons') }}</span></li>
          <li><strong>{{ summary.totalBosses }}</strong><span>{{ t('worldContent.summary.totalBosses') }}</span></li>
          <li><strong>{{ summary.totalWorldBosses }}</strong><span>{{ t('worldContent.summary.totalWorldBosses') }}</span></li>
          <li><strong>{{ summary.totalEventBosses }}</strong><span>{{ t('worldContent.summary.totalEventBosses') }}</span></li>
          <li><strong>{{ summary.totalSectBosses }}</strong><span>{{ t('worldContent.summary.totalSectBosses') }}</span></li>
          <li><strong>{{ summary.totalQuestBosses }}</strong><span>{{ t('worldContent.summary.totalQuestBosses') }}</span></li>
          <li><strong>{{ summary.totalTrialTowers }}</strong><span>{{ t('worldContent.summary.totalTrialTowers') }}</span></li>
          <li><strong>{{ summary.totalMonsters }}</strong><span>{{ t('worldContent.summary.totalMonsters') }}</span></li>
          <li><strong>{{ summary.totalEliteMonsters }}</strong><span>{{ t('worldContent.summary.totalEliteMonsters') }}</span></li>
          <li><strong>{{ summary.totalOpportunities }}</strong><span>{{ t('worldContent.summary.totalOpportunities') }}</span></li>
        </ul>

        <h2>{{ t('worldContent.summary.byRegion') }}</h2>
        <table class="world-content__regions" data-testid="world-content-region-table">
          <thead>
            <tr>
              <th>{{ t('worldContent.summary.region') }}</th>
              <th>{{ t('worldContent.summary.farmMaps') }}</th>
              <th>{{ t('worldContent.summary.dungeons') }}</th>
              <th>{{ t('worldContent.summary.bosses') }}</th>
              <th>{{ t('worldContent.summary.opportunities') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in summary.contentByRegion" :key="row.regionKey">
              <td>{{ row.regionKey }}</td>
              <td>{{ row.farmMaps }}</td>
              <td>{{ row.dungeons }}</td>
              <td>{{ row.bosses }}</td>
              <td>{{ row.opportunities }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </AppShell>
</template>

<style scoped>
.world-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}
.world-content__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.world-content__tabs button {
  padding: 6px 12px;
  background: var(--surface, #1c1f24);
  color: var(--fg, #e7e9ee);
  border: 1px solid var(--border, #2c3038);
  border-radius: 6px;
  cursor: pointer;
}
.world-content__state {
  padding: 24px;
  background: var(--surface, #1c1f24);
  border-radius: 8px;
  text-align: center;
}
.world-content__state--error {
  border: 1px solid var(--danger, #b94343);
}
.world-content__stats {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}
.world-content__stats li {
  background: var(--surface, #1c1f24);
  padding: 12px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.world-content__stats strong {
  font-size: 1.4em;
}
.world-content__stats span {
  font-size: 0.85em;
  color: var(--muted, #8a90a0);
}
.world-content__regions {
  width: 100%;
  border-collapse: collapse;
}
.world-content__regions th,
.world-content__regions td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border, #2c3038);
  text-align: left;
}
</style>
