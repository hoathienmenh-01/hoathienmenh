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
        eyebrow="NHẬT KÝ HUÝ KỶ"
        label="Nhật Ký Huý Kỷ"
        :title="t('playerLogs.title')"
        :subtitle="t('playerLogs.subtitle')"
        tone="gold"
        watermark-letter="N"
        breadcrumb="Hỗ Trợ · Nhật Ký"
        test-id="player-logs-view-hero"
      >
        <XTPageEyebrow caps="NHẬT KÝ HUÝ KỶ" label="Nhật Ký Huý Kỷ" class="sr-only" />
      </XTLuxHero>
      <EmptyState
        title-key="playerLogs.emptyTitle"
        description-key="playerLogs.emptyDescription"
        data-testid="player-logs-empty"
      />
    </div>
  </AppShell>
</template>
