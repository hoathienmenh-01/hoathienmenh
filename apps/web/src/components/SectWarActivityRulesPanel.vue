<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { SectWarActivityRule } from '@/api/sectWar';

interface Props {
  activities: ReadonlyArray<SectWarActivityRule>;
}
const props = defineProps<Props>();
const { t } = useI18n();

function activityLabel(key: string): string {
  return t(`sectWar.activity.${key}.label`, key);
}
</script>

<template>
  <section class="border border-ink-300/40 rounded">
    <div
      class="px-4 py-2 text-xs uppercase tracking-widest text-ink-300 border-b border-ink-300/30"
    >
      {{ t('sectWar.rules.title') }}
    </div>
    <table class="w-full text-sm">
      <thead class="text-xs text-ink-300/70">
        <tr>
          <th class="text-left px-3 py-1">{{ t('sectWar.rules.col.activity') }}</th>
          <th class="text-right px-3 py-1">{{ t('sectWar.rules.col.points') }}</th>
          <th class="text-right px-3 py-1">{{ t('sectWar.rules.col.dailyCap') }}</th>
          <th class="text-right px-3 py-1">{{ t('sectWar.rules.col.weeklyCap') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="a in props.activities"
          :key="a.key"
          data-test="sect-war-activity-row"
        >
          <td class="px-3 py-1">{{ activityLabel(a.key) }}</td>
          <td class="px-3 py-1 text-right text-amber-300">+{{ a.points }}</td>
          <td class="px-3 py-1 text-right text-ink-300">
            <template v-if="a.dailyCap !== undefined">{{ a.dailyCap }}</template>
            <template v-else>—</template>
          </td>
          <td class="px-3 py-1 text-right text-ink-300">
            <template v-if="a.weeklyCap !== undefined">{{ a.weeklyCap }}</template>
            <template v-else>—</template>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
