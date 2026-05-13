<script setup lang="ts">
/**
 * Phase 41.0 — Player Logs viewer (placeholder shell V1).
 *
 * Phase 41.0 chỉ provide AppShell + empty/loading state. Backend logs
 * pipeline (Phase 19.x audit log surface) sẽ bind sau ở Phase 41.1+.
 */
import { useI18n } from 'vue-i18n';
import AppShell from '@/components/shell/AppShell.vue';
import EmptyState from '@/components/ui/EmptyState.vue';

const { t } = useI18n();
</script>

<template>
  <AppShell>
    <div class="max-w-3xl mx-auto space-y-4">
      <header>
        <h1 class="text-2xl tracking-widest font-bold">{{ t('playerLogs.title') }}</h1>
        <p class="text-xs text-ink-300 mt-1">{{ t('playerLogs.subtitle') }}</p>
      </header>
      <EmptyState
        title-key="playerLogs.emptyTitle"
        description-key="playerLogs.emptyDescription"
        data-testid="player-logs-empty"
      />
    </div>
  </AppShell>
</template>
