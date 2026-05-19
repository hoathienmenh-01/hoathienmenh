<script setup lang="ts">
/**
 * Phase 15.8 — Admin Hall of Fame view.
 *
 * Hiển thị (ADMIN-only — AdminGuard server-side, EmptyState forbidden cho
 * non-admin):
 *   - List mọi season đã finalize (sort newest first) gồm:
 *     champion sect + sect score, MVP user + MVP points,
 *     reward status (CHAMPION/MVP grant counts + last-granted),
 *     champion snapshot meta (memberCount, snapshot createdAt).
 *   - Aggregate Hall of Fame: top sect theo championships + top member
 *     theo MVP qua mọi season.
 *
 * Filter (client-side, list bounded bởi snapshot count):
 *   - Season key contains
 *   - Sect name contains (match champion hoặc MVP latestSectName)
 *   - MVP character name contains
 *
 * KHÔNG mutate, KHÔNG expose memberCharacterIds. Theme luxury nhưng gọn —
 * tái dụng border ink + grid pattern của AdminSystemStatusView.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import LoadingState from '@/components/ui/LoadingState.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import { useAuthStore } from '@/stores/auth';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import {
  getAdminSectSeasonHallOfFame,
  type AdminSectSeasonHallOfFameView,
  type AdminSectSeasonSummary,
} from '@/api/adminSectSeason';

const { t } = useI18n();
const auth = useAuthStore();

const loading = ref(true);
const errorKey = ref<string | null>(null);
const view = ref<AdminSectSeasonHallOfFameView | null>(null);

const filterSeason = ref('');
const filterSect = ref('');
const filterMvp = ref('');

const isAdmin = computed(() => auth.user?.role === 'ADMIN');

const filteredSeasons = computed<ReadonlyArray<AdminSectSeasonSummary>>(() => {
  const rows = view.value?.seasons ?? [];
  const fSeason = filterSeason.value.trim().toLowerCase();
  const fSect = filterSect.value.trim().toLowerCase();
  const fMvp = filterMvp.value.trim().toLowerCase();
  if (!fSeason && !fSect && !fMvp) return rows;
  return rows.filter((r) => {
    if (fSeason && !r.seasonKey.toLowerCase().includes(fSeason)) return false;
    if (fSect) {
      const championName = r.champion?.sectName?.toLowerCase() ?? '';
      const mvpSectName = r.mvp?.sectName?.toLowerCase() ?? '';
      if (!championName.includes(fSect) && !mvpSectName.includes(fSect)) return false;
    }
    if (fMvp) {
      const mvpName = r.mvp?.characterName?.toLowerCase() ?? '';
      if (!mvpName.includes(fMvp)) return false;
    }
    return true;
  });
});

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function seasonLabel(seasonKey: string): string {
  const parts = seasonKey.split('_');
  const suffix = parts[parts.length - 1] ?? seasonKey;
  return t(
    `sectSeason.season.names.${suffix}`,
    t('sectSeason.season.fallbackLabel', { k: seasonKey }),
  );
}

function clearFilters(): void {
  filterSeason.value = '';
  filterSect.value = '';
  filterMvp.value = '';
}

async function load(): Promise<void> {
  loading.value = true;
  errorKey.value = null;
  try {
    view.value = await getAdminSectSeasonHallOfFame();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    errorKey.value = `adminHallOfFame.errors.${code}`;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await auth.hydrate();
  if (isAdmin.value) void load();
  else loading.value = false;
});
</script>

<template>
  <AppShell>
    <div class="max-w-6xl mx-auto space-y-4">
      <header>
        <XTPageEyebrow caps="TONG MON TUONG VINH" :label="t('adminHallOfFame.eyebrow')" />
        <h1 class="text-2xl tracking-widest font-bold mt-1">
          {{ t('adminHallOfFame.title') }}
        </h1>
        <p class="text-xs text-ink-300 mt-1">
          {{ t('adminHallOfFame.subtitle') }}
        </p>
      </header>

      <EmptyState
        v-if="!isAdmin"
        title-key="adminHallOfFame.notAdminTitle"
        description-key="adminHallOfFame.notAdminDescription"
        data-testid="admin-hof-forbidden"
      />

      <template v-else>
        <LoadingState v-if="loading" data-testid="admin-hof-loading" />

        <ErrorState
          v-else-if="errorKey"
          :error-key="errorKey"
          test-id="admin-hof-error"
          @retry="load()"
        />

        <EmptyState
          v-else-if="!view || view.seasons.length === 0"
          title-key="adminHallOfFame.emptyTitle"
          description-key="adminHallOfFame.emptyDescription"
          data-testid="admin-hof-empty"
        />

        <template v-else>
          <section
            class="border border-ink-300/30 rounded p-4 space-y-3"
            data-testid="admin-hof-filters"
          >
            <h2 class="text-sm uppercase tracking-widest text-ink-300">
              {{ t('adminHallOfFame.filters.title') }}
            </h2>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <label class="flex flex-col gap-1">
                <span class="text-ink-300">{{ t('adminHallOfFame.filters.season') }}</span>
                <input
                  v-model="filterSeason"
                  type="text"
                  class="bg-ink-900/60 border border-ink-300/30 rounded px-2 py-1 font-mono"
                  data-testid="admin-hof-filter-season"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-ink-300">{{ t('adminHallOfFame.filters.sect') }}</span>
                <input
                  v-model="filterSect"
                  type="text"
                  class="bg-ink-900/60 border border-ink-300/30 rounded px-2 py-1 font-mono"
                  data-testid="admin-hof-filter-sect"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-ink-300">{{ t('adminHallOfFame.filters.mvp') }}</span>
                <input
                  v-model="filterMvp"
                  type="text"
                  class="bg-ink-900/60 border border-ink-300/30 rounded px-2 py-1 font-mono"
                  data-testid="admin-hof-filter-mvp"
                />
              </label>
            </div>
            <div class="flex items-center gap-2 text-xs">
              <button
                type="button"
                class="px-3 py-1 border border-ink-300/40 rounded hover:bg-ink-800"
                data-testid="admin-hof-filter-clear"
                @click="clearFilters"
              >
                {{ t('adminHallOfFame.filters.clear') }}
              </button>
              <span class="text-ink-300" data-testid="admin-hof-filter-count">
                {{
                  t('adminHallOfFame.filters.count', {
                    visible: filteredSeasons.length,
                    total: view.seasons.length,
                  })
                }}
              </span>
              <span class="text-ink-300 ml-auto">
                {{ t('adminHallOfFame.checkedAt') }}: {{ fmtDate(view.checkedAt) }}
              </span>
            </div>
          </section>

          <section
            class="border border-ink-300/30 rounded p-4 space-y-3"
            data-testid="admin-hof-seasons"
          >
            <h2 class="text-sm uppercase tracking-widest text-ink-300">
              {{ t('adminHallOfFame.seasons.title') }}
            </h2>
            <p v-if="filteredSeasons.length === 0" class="text-xs text-ink-300">
              {{ t('adminHallOfFame.seasons.filteredEmpty') }}
            </p>
            <ul v-else class="space-y-2">
              <li
                v-for="row in filteredSeasons"
                :key="row.seasonKey"
                class="border border-ink-300/20 rounded p-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 text-xs"
                :data-testid="`admin-hof-season-${row.seasonKey}`"
              >
                <div class="space-y-1">
                  <div class="text-ink-300 uppercase tracking-widest">
                    {{ t('adminHallOfFame.seasons.season') }}
                  </div>
                  <div class="font-mono text-sm">{{ row.seasonKey }}</div>
                  <div class="text-ink-300">{{ seasonLabel(row.seasonKey) }}</div>
                  <div class="text-ink-300">
                    {{ t('adminHallOfFame.seasons.finalizedAt') }}:
                    {{ fmtDate(row.finalizedAt) }}
                  </div>
                </div>
                <div class="space-y-1">
                  <div class="text-ink-300 uppercase tracking-widest">
                    {{ t('adminHallOfFame.seasons.champion') }}
                  </div>
                  <div v-if="row.champion" class="font-mono">
                    {{ row.champion.sectName }}
                  </div>
                  <div v-else class="text-ink-300">—</div>
                  <div v-if="row.champion" class="text-ink-300">
                    {{ t('adminHallOfFame.seasons.score') }}:
                    <span class="font-mono">{{ row.champion.points }}</span>
                  </div>
                  <div class="text-ink-300">
                    {{ t('adminHallOfFame.seasons.totals') }}:
                    <span class="font-mono">{{ row.totalSects }}</span>
                    /
                    <span class="font-mono">{{ row.totalContributors }}</span>
                    /
                    <span class="font-mono">{{ row.totalPoints }}</span>
                  </div>
                </div>
                <div class="space-y-1">
                  <div class="text-ink-300 uppercase tracking-widest">
                    {{ t('adminHallOfFame.seasons.mvp') }}
                  </div>
                  <div v-if="row.mvp" class="font-mono">{{ row.mvp.characterName }}</div>
                  <div v-else class="text-ink-300">—</div>
                  <div v-if="row.mvp" class="text-ink-300">
                    {{ t('adminHallOfFame.seasons.mvpSect') }}:
                    <span class="font-mono">{{ row.mvp.sectName ?? '—' }}</span>
                  </div>
                  <div v-if="row.mvp" class="text-ink-300">
                    {{ t('adminHallOfFame.seasons.points') }}:
                    <span class="font-mono">{{ row.mvp.points }}</span>
                  </div>
                </div>
                <div class="space-y-1">
                  <div class="text-ink-300 uppercase tracking-widest">
                    {{ t('adminHallOfFame.seasons.rewardStatus') }}
                  </div>
                  <div class="text-ink-300">
                    {{ t('adminHallOfFame.seasons.championGrants') }}:
                    <span class="font-mono">{{ row.rewardStatus.championGrants }}</span>
                  </div>
                  <div class="text-ink-300">
                    {{ t('adminHallOfFame.seasons.mvpGrants') }}:
                    <span class="font-mono">{{ row.rewardStatus.mvpGrants }}</span>
                  </div>
                  <div class="text-ink-300">
                    {{ t('adminHallOfFame.seasons.lastChampionGrantAt') }}:
                    <span class="font-mono">{{ fmtDate(row.rewardStatus.lastChampionGrantAt) }}</span>
                  </div>
                  <div class="text-ink-300">
                    {{ t('adminHallOfFame.seasons.lastMvpGrantAt') }}:
                    <span class="font-mono">{{ fmtDate(row.rewardStatus.lastMvpGrantAt) }}</span>
                  </div>
                  <div v-if="row.championSnapshot" class="text-ink-300">
                    {{ t('adminHallOfFame.seasons.snapshotMembers') }}:
                    <span class="font-mono">{{ row.championSnapshot.memberCount }}</span>
                  </div>
                  <div v-else class="text-amber-300">
                    {{ t('adminHallOfFame.seasons.snapshotMissing') }}
                  </div>
                </div>
              </li>
            </ul>
          </section>

          <section
            class="border border-ink-300/30 rounded p-4 space-y-3"
            data-testid="admin-hof-aggregate"
          >
            <h2 class="text-sm uppercase tracking-widest text-ink-300">
              {{ t('adminHallOfFame.aggregate.title') }}
            </h2>
            <p class="text-xs text-ink-300">
              {{
                t('adminHallOfFame.aggregate.totalSeasons', {
                  n: view.hallOfFame.totalSeasonsFinalized,
                })
              }}
            </p>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <h3 class="text-xs uppercase tracking-widest text-ink-300 mb-1">
                  {{ t('adminHallOfFame.aggregate.topSects') }}
                </h3>
                <p
                  v-if="view.hallOfFame.sects.length === 0"
                  class="text-xs text-ink-300"
                  data-testid="admin-hof-top-sects-empty"
                >
                  {{ t('adminHallOfFame.aggregate.topSectsEmpty') }}
                </p>
                <ul v-else class="text-xs space-y-1" data-testid="admin-hof-top-sects">
                  <li
                    v-for="s in view.hallOfFame.sects"
                    :key="s.sectId"
                    class="border border-ink-300/20 rounded px-2 py-1 grid grid-cols-6 gap-2"
                  >
                    <span class="col-span-2 font-mono">{{ s.sectName }}</span>
                    <span class="text-ink-300">
                      {{ t('adminHallOfFame.aggregate.col.championships') }}:
                      <span class="font-mono">{{ s.championships }}</span>
                    </span>
                    <span class="text-ink-300">
                      {{ t('adminHallOfFame.aggregate.col.podiums') }}:
                      <span class="font-mono">{{ s.podiums }}</span>
                    </span>
                    <span class="text-ink-300">
                      {{ t('adminHallOfFame.aggregate.col.appearances') }}:
                      <span class="font-mono">{{ s.appearances }}</span>
                    </span>
                    <span class="text-ink-300">
                      {{ t('adminHallOfFame.aggregate.col.bestRank') }}:
                      <span class="font-mono">{{ s.bestRank }}</span>
                    </span>
                  </li>
                </ul>
              </div>
              <div>
                <h3 class="text-xs uppercase tracking-widest text-ink-300 mb-1">
                  {{ t('adminHallOfFame.aggregate.topMembers') }}
                </h3>
                <p
                  v-if="view.hallOfFame.members.length === 0"
                  class="text-xs text-ink-300"
                  data-testid="admin-hof-top-members-empty"
                >
                  {{ t('adminHallOfFame.aggregate.topMembersEmpty') }}
                </p>
                <ul v-else class="text-xs space-y-1" data-testid="admin-hof-top-members">
                  <li
                    v-for="m in view.hallOfFame.members"
                    :key="m.characterId"
                    class="border border-ink-300/20 rounded px-2 py-1 grid grid-cols-6 gap-2"
                  >
                    <span class="col-span-2 font-mono">{{ m.characterName }}</span>
                    <span class="text-ink-300">
                      {{ t('adminHallOfFame.aggregate.col.mvps') }}:
                      <span class="font-mono">{{ m.mvps }}</span>
                    </span>
                    <span class="text-ink-300">
                      {{ t('adminHallOfFame.aggregate.col.podiums') }}:
                      <span class="font-mono">{{ m.podiums }}</span>
                    </span>
                    <span class="text-ink-300">
                      {{ t('adminHallOfFame.aggregate.col.appearances') }}:
                      <span class="font-mono">{{ m.appearances }}</span>
                    </span>
                    <span class="text-ink-300">
                      {{ t('adminHallOfFame.aggregate.col.bestRank') }}:
                      <span class="font-mono">{{ m.bestRank }}</span>
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </section>
        </template>
      </template>
    </div>
  </AppShell>
</template>
