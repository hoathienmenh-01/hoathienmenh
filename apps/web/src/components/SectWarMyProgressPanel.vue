<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { SectWarMyStatus } from '@/api/sectWar';

interface Props {
  me: SectWarMyStatus;
}
const props = defineProps<Props>();
const { t } = useI18n();

function activityLabel(key: string): string {
  return t(`sectWar.activity.${key}.label`, key);
}
</script>

<template>
  <section
    class="border border-ink-300/40 rounded p-4 bg-ink-700/30"
    data-test="sect-war-my-progress"
  >
    <header class="flex items-baseline justify-between mb-3">
      <h3 class="text-sm tracking-widest uppercase text-ink-300">
        {{ t('sectWar.myProgress.title') }}
      </h3>
      <span class="text-xs text-ink-300">{{ t('sectWar.weekKey', { wk: props.me.weekKey }) }}</span>
    </header>

    <div v-if="!props.me.hasSect" class="text-sm text-ink-300" data-test="sect-war-no-sect">
      {{ t('sectWar.myProgress.noSect') }}
    </div>
    <template v-else>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <div class="text-xs text-ink-300">{{ t('sectWar.myProgress.sect') }}</div>
          <div class="text-ink-50">{{ props.me.sectName ?? '—' }}</div>
        </div>
        <div>
          <div class="text-xs text-ink-300">{{ t('sectWar.myProgress.sectRank') }}</div>
          <div class="text-amber-300">
            <template v-if="props.me.sectRank !== null">#{{ props.me.sectRank }}</template>
            <template v-else>—</template>
          </div>
        </div>
        <div>
          <div class="text-xs text-ink-300">{{ t('sectWar.myProgress.sectPoints') }}</div>
          <div>{{ props.me.sectPoints ?? 0 }}</div>
        </div>
        <div>
          <div class="text-xs text-ink-300">{{ t('sectWar.myProgress.personalPoints') }}</div>
          <div class="text-ink-50">{{ props.me.personalPoints }}</div>
        </div>
      </div>

      <div class="mt-4">
        <div class="text-xs text-ink-300 mb-1">{{ t('sectWar.myProgress.breakdown') }}</div>
        <div v-if="props.me.breakdown.length === 0" class="text-sm text-ink-300/70">
          {{ t('sectWar.myProgress.noContrib') }}
        </div>
        <ul v-else class="text-sm space-y-1">
          <li
            v-for="b in props.me.breakdown"
            :key="b.activityKey"
            class="flex justify-between"
          >
            <span class="text-ink-200">{{ activityLabel(b.activityKey) }}</span>
            <span class="text-amber-300">{{ b.points }} ({{ b.count }})</span>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>
