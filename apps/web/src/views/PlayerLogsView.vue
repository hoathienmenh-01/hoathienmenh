<script setup lang="ts">
/**
 * Phase 41.0 — Player Logs viewer (placeholder shell V1).
 *
 * Phase 41.0 chỉ provide AppShell + empty/loading state. Backend logs
 * pipeline (Phase 19.x audit log surface) sẽ bind sau ở Phase 41.1+.
 */
import { useI18n } from 'vue-i18n';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import EmptyState from '@/components/ui/EmptyState.vue';

const { t } = useI18n();
</script>

<template>
  <AppShell>
    <div class="max-w-3xl mx-auto space-y-4">
      <XTLuxHero
        :eyebrow="t('luxHero.playerLogs.eyebrow')"
        :label="t('luxHero.playerLogs.label')"
        :title="t('playerLogs.title')"
        :subtitle="t('playerLogs.subtitle')"
        tone="gold"
        watermark-letter="N"
        :breadcrumb="t('luxHero.playerLogs.breadcrumb')"
        test-id="player-logs-view-hero"
      >
        <XTPageEyebrow caps="NHẬT KÝ HUÝ KỶ" label="Nhật Ký Huý Kỷ" class="sr-only" />
      </XTLuxHero>

      <!-- Role hint -->
      <p class="text-sm text-gray-400 px-1" data-testid="player-logs-role-hint">
        {{ t('playerLogs.roleHint') }}
      </p>

      <!-- Cross-navigation -->
      <nav class="flex gap-2 text-xs mb-2" data-testid="player-logs-cross-nav">
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-settings"
          @click="$router.push('/settings')"
        >
          <span>{{ t('playerLogs.crossNav.settings') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('playerLogs.crossNav.settingsDesc') }}</span>
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-profile"
          @click="$router.push('/character')"
        >
          <span>{{ t('playerLogs.crossNav.profile') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('playerLogs.crossNav.profileDesc') }}</span>
        </button>
      </nav>
      <EmptyState
        title-key="playerLogs.emptyTitle"
        description-key="playerLogs.emptyDescription"
        data-testid="player-logs-empty"
      />
    </div>
  </AppShell>
</template>
