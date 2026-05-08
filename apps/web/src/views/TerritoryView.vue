<script setup lang="ts">
/**
 * Phase 14.0.A — Sect Territory Influence Foundation view.
 *
 * Render 3 section:
 *   1. Region list (overview): tổng influence + top sect snapshot per region.
 *   2. Per-region leaderboard: chọn region từ list → fetch top 10 sect.
 *   3. My sect rank: per-region rank/points của sect user (nếu có).
 *
 * FE read-only — server-authoritative. Influence ghi điểm xảy ra ở
 * server qua hook fail-soft (dungeon claim, boss reward).
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useTerritoryStore } from '@/stores/territory';
import AppShell from '@/components/shell/AppShell.vue';

type TerritoryTab = 'overview' | 'leaderboard' | 'me';
const ALL_TABS: ReadonlyArray<TerritoryTab> = [
  'overview',
  'leaderboard',
  'me',
];

const auth = useAuthStore();
const territory = useTerritoryStore();
const router = useRouter();
const route = useRoute();
const { t, locale } = useI18n();

const queryTab = (route.query.tab as string | undefined) ?? '';
const initialTab: TerritoryTab = (ALL_TABS as ReadonlyArray<string>).includes(
  queryTab,
)
  ? (queryTab as TerritoryTab)
  : 'overview';
const tab = ref<TerritoryTab>(initialTab);

/**
 * Region đang được chọn cho leaderboard tab. Default region đầu tiên
 * trong list (theo `sortOrder`).
 */
const selectedRegionKey = ref<string | null>(
  (route.query.region as string | undefined) ?? null,
);

function setTab(next: TerritoryTab): void {
  tab.value = next;
  router.replace({ query: { ...route.query, tab: next } }).catch(() => null);
}

function setRegion(regionKey: string): void {
  selectedRegionKey.value = regionKey;
  router
    .replace({ query: { ...route.query, region: regionKey } })
    .catch(() => null);
}

function regionName(r: { nameVi: string; nameEn: string }): string {
  return locale.value === 'en' ? r.nameEn : r.nameVi;
}

const sortedRegions = computed(() =>
  [...(territory.regions?.regions ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  ),
);

const selectedLeaderboard = computed(() => {
  const key = selectedRegionKey.value;
  if (!key) return null;
  return territory.leaderboards[key] ?? null;
});

const selectedRegionView = computed(() => {
  const key = selectedRegionKey.value;
  if (!key) return null;
  return sortedRegions.value.find((r) => r.regionKey === key) ?? null;
});

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  // Fetch song song: regions + me. Leaderboard fetch chỉ khi user vào tab.
  await Promise.all([territory.fetchRegions(), territory.fetchMe()]);
  // Auto-select region đầu tiên nếu chưa có (deep-link query.region đã set).
  if (!selectedRegionKey.value && sortedRegions.value.length > 0) {
    selectedRegionKey.value = sortedRegions.value[0].regionKey;
  }
});

// Khi user chuyển sang leaderboard tab hoặc đổi region → fetch leaderboard
// nếu cache miss. Cache theo regionKey trong store nên chuyển lại tab/region
// đã visit không trigger fetch lặp.
watch(
  [tab, selectedRegionKey],
  async ([t, region]) => {
    if (t !== 'leaderboard' || !region) return;
    if (territory.leaderboards[region]) return;
    await territory.fetchLeaderboard(region);
  },
  { immediate: true },
);

const myRegionRows = computed(() => territory.me?.regions ?? []);
</script>

<template>
  <AppShell>
    <header class="mb-4">
      <h2 class="text-xl tracking-widest">{{ t('territory.title') }}</h2>
      <p class="text-xs text-ink-300 mt-1">{{ t('territory.subtitle') }}</p>
    </header>

    <div
      v-if="territory.regionsLoading || territory.meLoading"
      class="text-ink-300 text-sm"
      data-test="territory-loading"
    >
      {{ t('territory.loading') }}
    </div>
    <div
      v-else-if="territory.regionsError || territory.meError"
      class="text-rose-300 text-sm"
      data-test="territory-error"
    >
      {{
        t(
          `territory.errors.${territory.regionsError || territory.meError}`,
          t('territory.errors.UNKNOWN'),
        )
      }}
    </div>
    <div v-else class="space-y-4" data-test="territory-content">
      <nav
        class="flex flex-wrap gap-2 text-xs"
        role="tablist"
        data-test="territory-tabs"
      >
        <button
          v-for="key in ALL_TABS"
          :key="key"
          type="button"
          role="tab"
          :aria-selected="tab === key"
          class="px-3 py-1 rounded border tracking-widest uppercase"
          :class="
            tab === key
              ? 'border-amber-300/70 text-amber-200 bg-ink-700/40'
              : 'border-ink-300/40 text-ink-300 hover:border-amber-300/40'
          "
          :data-test="`territory-tab-${key}`"
          @click="setTab(key)"
        >
          {{ t(`territory.tab.${key}`) }}
        </button>
      </nav>

      <section
        v-if="tab === 'overview'"
        data-test="territory-tab-content-overview"
      >
        <div
          v-if="sortedRegions.length === 0"
          class="text-ink-300 text-sm"
          data-test="territory-overview-empty"
        >
          {{ t('territory.overview.empty') }}
        </div>
        <ul v-else class="space-y-2">
          <li
            v-for="r in sortedRegions"
            :key="r.regionKey"
            class="rounded border border-ink-300/40 bg-ink-700/30 p-3 flex flex-wrap items-center justify-between gap-3"
            data-test="territory-region-row"
            :data-region-key="r.regionKey"
          >
            <div>
              <div class="text-amber-300 text-sm">
                {{ regionName(r) }}
              </div>
              <div class="text-xs text-ink-300/80 mt-1">
                {{
                  t('territory.overview.summary', {
                    pts: r.totalPoints,
                    contributors: r.contributors,
                  })
                }}
              </div>
            </div>
            <div class="text-xs text-ink-300/90">
              <div v-if="r.topSectId">
                {{
                  t('territory.overview.topSect', {
                    name: r.topSectName,
                    pts: r.topSectPoints,
                  })
                }}
              </div>
              <div v-else class="italic">
                {{ t('territory.overview.noTopSect') }}
              </div>
            </div>
          </li>
        </ul>
      </section>

      <section
        v-else-if="tab === 'leaderboard'"
        data-test="territory-tab-content-leaderboard"
      >
        <div class="flex flex-wrap gap-2 mb-3" data-test="territory-region-pick">
          <button
            v-for="r in sortedRegions"
            :key="r.regionKey"
            type="button"
            class="px-2 py-1 rounded border text-xs tracking-widest"
            :class="
              selectedRegionKey === r.regionKey
                ? 'border-amber-300/70 text-amber-200 bg-ink-700/40'
                : 'border-ink-300/40 text-ink-300 hover:border-amber-300/40'
            "
            :data-test="`territory-region-pick-${r.regionKey}`"
            @click="setRegion(r.regionKey)"
          >
            {{ regionName(r) }}
          </button>
        </div>

        <div
          v-if="
            selectedRegionKey &&
            territory.leaderboardLoading[selectedRegionKey]
          "
          class="text-ink-300 text-sm"
          data-test="territory-leaderboard-loading"
        >
          {{ t('territory.loading') }}
        </div>
        <div
          v-else-if="
            selectedRegionKey &&
            territory.leaderboardError[selectedRegionKey]
          "
          class="text-rose-300 text-sm"
          data-test="territory-leaderboard-error"
        >
          {{
            t(
              `territory.errors.${territory.leaderboardError[selectedRegionKey]}`,
              t('territory.errors.UNKNOWN'),
            )
          }}
        </div>
        <div
          v-else-if="selectedLeaderboard"
          data-test="territory-leaderboard-table"
        >
          <div
            v-if="selectedRegionView"
            class="text-xs text-ink-300/80 mb-2"
            data-test="territory-leaderboard-region-name"
          >
            {{ regionName(selectedRegionView) }}
          </div>
          <div
            v-if="selectedLeaderboard.rows.length === 0"
            class="text-ink-300 text-sm"
            data-test="territory-leaderboard-empty"
          >
            {{ t('territory.leaderboard.empty') }}
          </div>
          <table
            v-else
            class="w-full text-xs"
            data-test="territory-leaderboard"
          >
            <thead class="text-ink-300/80">
              <tr>
                <th class="text-left py-1">
                  {{ t('territory.leaderboard.col.rank') }}
                </th>
                <th class="text-left py-1">
                  {{ t('territory.leaderboard.col.sect') }}
                </th>
                <th class="text-right py-1">
                  {{ t('territory.leaderboard.col.points') }}
                </th>
                <th class="text-right py-1">
                  {{ t('territory.leaderboard.col.contributors') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in selectedLeaderboard.rows"
                :key="row.sectId"
                class="border-t border-ink-300/20"
                :class="
                  row.sectId === territory.me?.sectId
                    ? 'bg-amber-300/10 text-amber-200'
                    : ''
                "
                data-test="territory-leaderboard-row"
                :data-sect-id="row.sectId"
              >
                <td class="py-1">#{{ row.rank }}</td>
                <td class="py-1">
                  {{ row.sectName }}
                  <span
                    v-if="row.sectId === territory.me?.sectId"
                    class="ml-1 text-amber-300"
                  >
                    {{ t('territory.leaderboard.youTag') }}
                  </span>
                </td>
                <td class="py-1 text-right">{{ row.points }}</td>
                <td class="py-1 text-right">{{ row.contributors }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          v-else
          class="text-ink-300 text-sm"
          data-test="territory-leaderboard-pick-hint"
        >
          {{ t('territory.leaderboard.pickHint') }}
        </div>
      </section>

      <section v-else-if="tab === 'me'" data-test="territory-tab-content-me">
        <div
          v-if="!territory.me?.hasSect"
          class="text-ink-300 text-sm"
          data-test="territory-me-no-sect"
        >
          {{ t('territory.me.noSect') }}
        </div>
        <div v-else>
          <div class="text-xs text-ink-300 mb-2">
            {{
              t('territory.me.header', {
                sect: territory.me.sectName,
              })
            }}
          </div>
          <table class="w-full text-xs" data-test="territory-me-table">
            <thead class="text-ink-300/80">
              <tr>
                <th class="text-left py-1">
                  {{ t('territory.me.col.region') }}
                </th>
                <th class="text-right py-1">
                  {{ t('territory.me.col.rank') }}
                </th>
                <th class="text-right py-1">
                  {{ t('territory.me.col.sectPoints') }}
                </th>
                <th class="text-right py-1">
                  {{ t('territory.me.col.personalPoints') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in myRegionRows"
                :key="row.regionKey"
                class="border-t border-ink-300/20"
                data-test="territory-me-row"
                :data-region-key="row.regionKey"
              >
                <td class="py-1">{{ regionName(row) }}</td>
                <td class="py-1 text-right">
                  <span v-if="row.sectRank">#{{ row.sectRank }}</span>
                  <span v-else class="text-ink-300/60">—</span>
                </td>
                <td class="py-1 text-right">{{ row.sectPoints }}</td>
                <td class="py-1 text-right">{{ row.personalPoints }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </AppShell>
</template>
