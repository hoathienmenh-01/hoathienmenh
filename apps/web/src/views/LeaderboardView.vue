<script setup lang="ts">
/**
 * Smart beta feature §9 — basic leaderboard.
 * 3 tab consume PR #94 BE:
 *   - power : GET /leaderboard/power → top N (mặc định 50) sort theo cảnh giới + power.
 *   - topup : GET /leaderboard/topup → top nạp Tiên Ngọc tổng (APPROVED).
 *   - sect  : GET /leaderboard/sect → top tông môn theo treasuryLinhThach.
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { realmByKey, fullRealmName } from '@xuantoi/shared';
import AppShell from '@/components/shell/AppShell.vue';
import XTPullRefresh from '@/components/xianxia/XTPullRefresh.vue';
import SkeletonTable from '@/components/ui/SkeletonTable.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import {
  fetchLeaderboardPower,
  fetchLeaderboardTopup,
  fetchLeaderboardSect,
  type LeaderboardRow,
  type LeaderboardTopupRow,
  type LeaderboardSectRow,
} from '@/api/leaderboard';

type Tab = 'power' | 'topup' | 'sect';
type SectKey = LeaderboardRow['sectKey'];

const { t } = useI18n();
const tab = ref<Tab>('power');

const powerRows = ref<LeaderboardRow[]>([]);
const topupRows = ref<LeaderboardTopupRow[]>([]);
const sectRows = ref<LeaderboardSectRow[]>([]);

const loading = ref(false);
const error = ref<string | null>(null);

async function refresh(): Promise<void> {
  await load(tab.value);
}

async function load(target: Tab = tab.value): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    if (target === 'power') {
      powerRows.value = await fetchLeaderboardPower(50);
    } else if (target === 'topup') {
      topupRows.value = await fetchLeaderboardTopup(50);
    } else {
      sectRows.value = await fetchLeaderboardSect(50);
    }
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    error.value = code;
  } finally {
    loading.value = false;
  }
}

async function switchTab(next: Tab): Promise<void> {
  if (tab.value === next) return;
  tab.value = next;
  await load(next);
}

function realmDisplay(realmKey: string, stage: number): string {
  const def = realmByKey(realmKey);
  if (!def) return realmKey;
  return fullRealmName(def, stage);
}

function sectName(key: SectKey): string {
  if (!key) return '—';
  return t(`shell.sect.${key}`);
}

/** Hiển thị `treasuryLinhThach` BigInt-string với phân cách hàng nghìn. */
function formatBigIntString(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

onMounted(() => {
  void load('power');
  // Smart onboarding: đánh dấu user đã ghé bảng xếp hạng (step 5).
  void import('@/lib/onboardingVisits').then((m) => m.markVisited('leaderboard'));
});
</script>

<template>
  <AppShell>
    <section class="rounded border border-ink-300/40 bg-ink-700/30 p-5">
      <header class="mb-4 flex items-baseline justify-between gap-3">
        <h2 class="text-2xl tracking-widest">{{ t('leaderboard.title') }}</h2>
        <span class="text-xs text-ink-300">{{
          t(`leaderboard.subtitle.${tab}`)
        }}</span>
      </header>

      <!-- Role hint -->
      <p class="text-sm text-gray-400 px-1 mb-2" data-testid="leaderboard-role-hint">
        {{ t('leaderboard.roleHint') }}
      </p>

      <!-- Cross-navigation -->
      <nav class="flex gap-2 text-xs mb-3" data-testid="leaderboard-cross-nav">
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-arena"
          @click="$router.push('/arena')"
        >
          <span class="text-amber-400">&#9876;</span>
          <span>{{ t('leaderboard.crossNav.arena') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('leaderboard.crossNav.arenaDesc') }}</span>
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-achievements"
          @click="$router.push('/achievements')"
        >
          <span class="text-emerald-400">&#127942;</span>
          <span>{{ t('leaderboard.crossNav.achievements') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('leaderboard.crossNav.achievementsDesc') }}</span>
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-sect"
          @click="$router.push('/sect')"
        >
          <span class="text-rose-400">&#9962;</span>
          <span>{{ t('leaderboard.crossNav.sect') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('leaderboard.crossNav.sectDesc') }}</span>
        </button>
      </nav>

      <nav
        class="mb-4 flex flex-wrap gap-2"
        role="tablist"
        aria-label="leaderboard tabs"
      >
        <button
          v-for="t0 in (['power', 'topup', 'sect'] as Tab[])"
          :key="t0"
          type="button"
          role="tab"
          :aria-selected="tab === t0"
          :data-testid="`leaderboard-tab-${t0}`"
          class="rounded border px-3 py-1 text-xs uppercase tracking-widest transition"
          :class="
            tab === t0
              ? 'border-amber-400/60 bg-amber-500/10 text-amber-100'
              : 'border-ink-300/40 text-ink-200 hover:bg-ink-700/50'
          "
          @click="switchTab(t0)"
        >
          {{ t(`leaderboard.tab.${t0}`) }}
        </button>
      </nav>

      <XTPullRefresh
        :on-refresh="refresh"
        test-id="leaderboard-pull-refresh"
        :pull-label="t('common.pullToRefresh')"
        :release-label="t('common.releaseToRefresh')"
        :refreshing-label="t('common.refreshing')"
      >
        <SkeletonTable
          v-if="loading"
          :rows="10"
          :cols="5"
          test-id="leaderboard-skeleton"
        />
        <div v-else-if="error" class="py-8 text-center text-sm text-red-400">
          {{ t('leaderboard.error') }}
          <button
            type="button"
            class="ml-2 rounded border border-ink-300/40 px-2 py-0.5 text-[11px] uppercase tracking-widest hover:bg-ink-700/60"
            @click="load()"
          >
            {{ t('leaderboard.retry') }}
          </button>
        </div>

        <!-- POWER tab -->
        <template v-else-if="tab === 'power'">
          <div
            v-if="powerRows.length === 0"
            class="py-8 text-center text-sm text-ink-300"
          >
            {{ t('leaderboard.empty') }}
          </div>
          <table
            v-else
            class="w-full text-sm"
            data-testid="leaderboard-table"
          >
            <thead class="text-xs uppercase tracking-widest text-ink-300">
              <tr>
                <th class="py-2 pr-2 text-left w-12">#</th>
                <th class="py-2 pr-2 text-left">
                  {{ t('leaderboard.col.name') }}
                </th>
                <th class="py-2 pr-2 text-left">
                  {{ t('leaderboard.col.realm') }}
                </th>
                <th class="py-2 pr-2 text-left">
                  {{ t('leaderboard.col.sect') }}
                </th>
                <th class="py-2 pr-2 text-right">
                  {{ t('leaderboard.col.power') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in powerRows"
                :key="r.characterId"
                class="border-t border-ink-300/10 hover:bg-ink-700/40"
              >
                <td class="py-1.5 pr-2 font-mono">
                  <span
                    v-if="r.rank <= 3"
                    class="inline-block rounded bg-amber-500/20 px-1.5 text-amber-200"
                  >{{ r.rank }}</span>
                  <span v-else>{{ r.rank }}</span>
                </td>
                <td class="py-1.5 pr-2 text-ink-50">{{ r.name }}</td>
                <td class="py-1.5 pr-2 text-ink-200">
                  {{ realmDisplay(r.realmKey, r.realmStage) }}
                </td>
                <td class="py-1.5 pr-2 text-ink-300">
                  {{ sectName(r.sectKey) }}
                </td>
                <td class="py-1.5 pr-2 text-right font-mono text-ink-50">
                  {{ r.power.toLocaleString() }}
                </td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- TOPUP tab -->
        <template v-else-if="tab === 'topup'">
          <div
            v-if="topupRows.length === 0"
            class="py-8 text-center text-sm text-ink-300"
          >
            {{ t('leaderboard.empty') }}
          </div>
          <table
            v-else
            class="w-full text-sm"
            data-testid="leaderboard-topup-table"
          >
            <thead class="text-xs uppercase tracking-widest text-ink-300">
              <tr>
                <th class="py-2 pr-2 text-left w-12">#</th>
                <th class="py-2 pr-2 text-left">
                  {{ t('leaderboard.col.name') }}
                </th>
                <th class="py-2 pr-2 text-left">
                  {{ t('leaderboard.col.realm') }}
                </th>
                <th class="py-2 pr-2 text-left">
                  {{ t('leaderboard.col.sect') }}
                </th>
                <th class="py-2 pr-2 text-right">
                  {{ t('leaderboard.col.totalTienNgoc') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in topupRows"
                :key="r.characterId"
                class="border-t border-ink-300/10 hover:bg-ink-700/40"
              >
                <td class="py-1.5 pr-2 font-mono">
                  <span
                    v-if="r.rank <= 3"
                    class="inline-block rounded bg-amber-500/20 px-1.5 text-amber-200"
                  >{{ r.rank }}</span>
                  <span v-else>{{ r.rank }}</span>
                </td>
                <td class="py-1.5 pr-2 text-ink-50">{{ r.name }}</td>
                <td class="py-1.5 pr-2 text-ink-200">
                  {{ realmDisplay(r.realmKey, r.realmStage) }}
                </td>
                <td class="py-1.5 pr-2 text-ink-300">
                  {{ sectName(r.sectKey) }}
                </td>
                <td class="py-1.5 pr-2 text-right font-mono text-amber-200">
                  {{ r.totalTienNgoc.toLocaleString() }}
                </td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- SECT tab -->
        <template v-else>
          <div
            v-if="sectRows.length === 0"
            class="py-8 text-center text-sm text-ink-300"
          >
            {{ t('leaderboard.empty') }}
          </div>
          <table
            v-else
            class="w-full text-sm"
            data-testid="leaderboard-sect-table"
          >
            <thead class="text-xs uppercase tracking-widest text-ink-300">
              <tr>
                <th class="py-2 pr-2 text-left w-12">#</th>
                <th class="py-2 pr-2 text-left">
                  {{ t('leaderboard.col.sectName') }}
                </th>
                <th class="py-2 pr-2 text-left">
                  {{ t('leaderboard.col.leader') }}
                </th>
                <th class="py-2 pr-2 text-right">
                  {{ t('leaderboard.col.level') }}
                </th>
                <th class="py-2 pr-2 text-right">
                  {{ t('leaderboard.col.members') }}
                </th>
                <th class="py-2 pr-2 text-right">
                  {{ t('leaderboard.col.treasury') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in sectRows"
                :key="r.sectId"
                class="border-t border-ink-300/10 hover:bg-ink-700/40"
              >
                <td class="py-1.5 pr-2 font-mono">
                  <span
                    v-if="r.rank <= 3"
                    class="inline-block rounded bg-amber-500/20 px-1.5 text-amber-200"
                  >{{ r.rank }}</span>
                  <span v-else>{{ r.rank }}</span>
                </td>
                <td class="py-1.5 pr-2 text-ink-50">
                  {{ r.sectKey ? sectName(r.sectKey) : r.name }}
                </td>
                <td class="py-1.5 pr-2 text-ink-200">
                  {{ r.leaderName ?? '—' }}
                </td>
                <td class="py-1.5 pr-2 text-right font-mono text-ink-50">
                  {{ r.level }}
                </td>
                <td class="py-1.5 pr-2 text-right font-mono text-ink-200">
                  {{ r.memberCount }}
                </td>
                <td class="py-1.5 pr-2 text-right font-mono text-amber-200">
                  {{ formatBigIntString(r.treasuryLinhThach) }}
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </XTPullRefresh>
    </section>
  </AppShell>
</template>
