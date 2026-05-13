<script setup lang="ts">
/**
 * Phase 26.5 — Boss Hub V2 view.
 *
 * List boss V2 (`GET /world/bosses`) — region / hourly / world / event /
 * sect / quest / hidden / trial. Hỗ trợ filter category. Bao trùm 4
 * state UI MODULE RULE: loading / error+reload / empty / list.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWorldContentStore } from '@/stores/worldContent';
import type { BossV2View } from '@/api/worldContent';
import AppShell from '@/components/shell/AppShell.vue';

const { t, locale } = useI18n();
const store = useWorldContentStore();

const isLoaded = computed(() => store.loaded['bosses'] === true);
const bosses = computed(() => store.bosses);
const reloadFailed = ref(false);

const categoryFilter = ref<'ALL' | string>('ALL');
const categories = computed<string[]>(() => {
  const set = new Set<string>();
  for (const b of bosses.value) set.add(b.category);
  return Array.from(set).sort();
});
const filtered = computed<BossV2View[]>(() =>
  categoryFilter.value === 'ALL'
    ? bosses.value
    : bosses.value.filter((b) => b.category === categoryFilter.value),
);

function pickName(b: BossV2View): string {
  return locale.value === 'en' ? b.nameEn : b.nameVi;
}

async function refresh(): Promise<void> {
  reloadFailed.value = false;
  const err = await store.fetchBosses();
  if (err) reloadFailed.value = true;
}

onMounted(() => {
  if (!isLoaded.value) refresh();
});
</script>

<template>
  <AppShell>
    <section class="boss-hub" data-testid="boss-hub-view">
      <header>
        <h1>{{ t('worldContent.boss.title') }}</h1>
        <p>{{ t('worldContent.boss.subtitle') }}</p>
      </header>

      <div
        v-if="reloadFailed && bosses.length === 0"
        class="boss-hub__state boss-hub__state--error"
        data-testid="boss-hub-error"
      >
        <p>{{ t('worldContent.reloadError') }}</p>
        <button @click="refresh">{{ t('worldContent.reload') }}</button>
      </div>

      <div
        v-else-if="bosses.length === 0 && !isLoaded"
        class="boss-hub__state"
        data-testid="boss-hub-loading"
      >
        {{ t('worldContent.boss.loading') }}
      </div>

      <div
        v-else-if="bosses.length === 0"
        class="boss-hub__state"
        data-testid="boss-hub-empty"
      >
        {{ t('worldContent.boss.empty') }}
      </div>

      <template v-else>
        <label class="boss-hub__filter">
          {{ t('worldContent.boss.category') }}:
          <select v-model="categoryFilter" data-testid="boss-hub-filter">
            <option value="ALL">{{ t('worldContent.boss.all') }}</option>
            <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>

        <ul class="boss-hub__list" data-testid="boss-hub-list">
          <li
            v-for="b in filtered"
            :key="b.key"
            class="boss-hub__item"
            :data-testid="`boss-hub-item-${b.key}`"
          >
            <div class="boss-hub__item-head">
              <h2>{{ pickName(b) }}</h2>
              <span class="boss-hub__chip">{{ b.category }}</span>
            </div>
            <dl>
              <div>
                <dt>{{ t('worldContent.boss.family') }}</dt>
                <dd>{{ b.family }}</dd>
              </div>
              <div>
                <dt>{{ t('worldContent.boss.element') }}</dt>
                <dd>{{ b.element }}</dd>
              </div>
              <div>
                <dt>{{ t('worldContent.boss.region') }}</dt>
                <dd>{{ b.regionKey ?? '—' }}</dd>
              </div>
              <div>
                <dt>{{ t('worldContent.boss.sourceTier') }}</dt>
                <dd>{{ b.sourceTier }}</dd>
              </div>
              <div>
                <dt>{{ t('worldContent.boss.realm') }}</dt>
                <dd>{{ b.recommendedRealmOrder }}</dd>
              </div>
              <div>
                <dt>{{ t('worldContent.boss.dailyCap') }}</dt>
                <dd>{{ b.dailyRewardCap ?? '—' }}</dd>
              </div>
              <div>
                <dt>{{ t('worldContent.boss.weeklyCap') }}</dt>
                <dd>{{ b.weeklyRewardCap ?? '—' }}</dd>
              </div>
              <div v-if="b.manualOnly">
                <dt>{{ t('worldContent.boss.manualOnly') }}</dt>
                <dd>✓</dd>
              </div>
            </dl>
          </li>
        </ul>
      </template>
    </section>
  </AppShell>
</template>

<style scoped>
.boss-hub {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}
.boss-hub__state {
  padding: 24px;
  background: var(--surface, #1c1f24);
  border-radius: 8px;
  text-align: center;
}
.boss-hub__state--error {
  border: 1px solid var(--danger, #b94343);
}
.boss-hub__filter {
  display: flex;
  gap: 8px;
  align-items: center;
}
.boss-hub__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}
.boss-hub__item {
  background: var(--surface, #1c1f24);
  padding: 12px;
  border-radius: 8px;
}
.boss-hub__item-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.boss-hub__chip {
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--muted-bg, #2c3038);
  font-size: 0.75em;
}
.boss-hub__item dl {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 6px;
  margin: 0;
}
.boss-hub__item dt {
  font-size: 0.75em;
  color: var(--muted, #8a90a0);
}
.boss-hub__item dd {
  margin: 0;
  font-weight: 600;
}
</style>
