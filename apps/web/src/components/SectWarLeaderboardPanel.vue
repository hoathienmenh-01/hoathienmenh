<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SectWarLeaderboardRow } from '@/api/sectWar';

interface Props {
  rows: ReadonlyArray<SectWarLeaderboardRow>;
  mySectId?: string | null;
}
const props = defineProps<Props>();
const { t } = useI18n();

const visibleRows = computed(() => props.rows ?? []);
</script>

<template>
  <section class="border border-ink-300/40 rounded">
    <div
      class="px-4 py-2 text-xs uppercase tracking-widest text-ink-300 border-b border-ink-300/30"
    >
      {{ t('sectWar.leaderboard.title') }}
    </div>
    <div v-if="visibleRows.length === 0" class="px-4 py-3 text-sm text-ink-300">
      {{ t('sectWar.leaderboard.empty') }}
    </div>
    <table v-else class="w-full text-sm">
      <thead class="text-xs text-ink-300/70">
        <tr>
          <th class="text-left px-3 py-1 w-10">{{ t('sectWar.leaderboard.col.rank') }}</th>
          <th class="text-left px-3 py-1">{{ t('sectWar.leaderboard.col.sect') }}</th>
          <th class="text-right px-3 py-1">{{ t('sectWar.leaderboard.col.points') }}</th>
          <th class="text-right px-3 py-1">{{ t('sectWar.leaderboard.col.contributors') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in visibleRows"
          :key="row.sectId"
          :class="row.sectId === props.mySectId ? 'bg-ink-700/30' : ''"
          data-test="sect-war-leaderboard-row"
        >
          <td class="px-3 py-1 text-amber-300">{{ row.rank }}</td>
          <td class="px-3 py-1">
            <span :class="row.rank === 1 ? 'text-amber-300 font-bold' : ''">{{ row.sectName }}</span>
            <span v-if="row.sectId === props.mySectId" class="ml-2 text-xs text-ink-300/70">
              {{ t('sectWar.leaderboard.youTag') }}
            </span>
          </td>
          <td class="px-3 py-1 text-right">{{ row.points }}</td>
          <td class="px-3 py-1 text-right text-ink-300">{{ row.contributors }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
