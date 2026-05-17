<script setup lang="ts">
/**
 * CoopBossView — `/party/coop-boss` entry surface (PR #629).
 *
 * Hub-style view for the Co-op Boss feature. Shows the player's
 * current active co-op boss run or recent history. Uses the real
 * `coopBoss.ts` API. Does NOT implement combat or contribution
 * recording — that lives in the existing boss/combat flow.
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { getMyCoopBossRun, listMyCoopBossRuns } from '@/api/coopBoss';
import type {
  MyCoopBossRunResponse,
  CoopBossRunListResponse,
} from '@xuantoi/shared';
import AppShell from '@/components/shell/AppShell.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import MButton from '@/components/ui/MButton.vue';

const auth = useAuthStore();
const game = useGameStore();
const router = useRouter();
const { t } = useI18n();

const loading = ref(true);
const currentRun = ref<MyCoopBossRunResponse | null>(null);
const recentRuns = ref<CoopBossRunListResponse | null>(null);

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  try {
    const [current, history] = await Promise.all([
      getMyCoopBossRun().catch(() => null),
      listMyCoopBossRuns(5).catch(() => null),
    ]);
    currentRun.value = current;
    recentRuns.value = history;
  } catch {
    // fail silently
  } finally {
    loading.value = false;
  }
});

function goToPartyHub(): void {
  router.push('/party');
}
</script>

<template>
  <AppShell>
    <XTLuxHero
      eyebrow="CO-OP BOSS"
      label="Co-op Boss"
      :title="t('coopBoss.title', 'Co-op Boss')"
      :subtitle="t('coopBoss.subtitle', 'Hợp lực đánh boss thế giới')"
      tone="seal"
      watermark-letter="B"
      breadcrumb="Co-op Boss"
      test-id="coop-boss-hero"
      class="mb-4"
    >
      <XTPageEyebrow caps="CO-OP BOSS" label="Co-op Boss" class="sr-only" />
    </XTLuxHero>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-8 text-ink-400" data-testid="coop-boss-loading">
      {{ t('common.loading', 'Loading...') }}
    </div>

    <template v-else>
      <!-- Active Run -->
      <section
        v-if="currentRun"
        class="rounded border border-ink-300/40 bg-ink-700/30 p-4 mb-4 space-y-3"
        data-testid="coop-boss-active-run"
      >
        <h3 class="font-bold text-ink-100">
          {{ t('coopBoss.activeRun', 'Trận Đang Diễn Ra') }}
        </h3>
        <pre class="text-xs text-ink-300 whitespace-pre-wrap overflow-auto max-h-48">{{ JSON.stringify(currentRun, null, 2) }}</pre>
      </section>

      <!-- No active run — empty state -->
      <section
        v-if="!currentRun"
        class="text-center py-6 space-y-3 mb-4"
        data-testid="coop-boss-empty"
      >
        <p class="text-ink-300 text-lg">
          {{ t('coopBoss.noRun', 'Không có trận co-op boss nào đang diễn ra') }}
        </p>
        <p class="text-ink-400 text-sm">
          {{ t('coopBoss.hint', 'Tạo phòng từ tổ đội để bắt đầu một trận mới') }}
        </p>
      </section>

      <!-- Recent History -->
      <section
        v-if="recentRuns && recentRuns.runs && recentRuns.runs.length > 0"
        class="rounded border border-ink-300/40 bg-ink-700/30 p-4 mb-4 space-y-2"
        data-testid="coop-boss-history"
      >
        <h4 class="text-sm font-semibold text-ink-200">
          {{ t('coopBoss.history', 'Lịch Sử Gần Đây') }}
        </h4>
        <div
          v-for="run in recentRuns.runs"
          :key="run.id"
          class="text-xs text-ink-300 border-b border-ink-300/20 last:border-0 py-1"
        >
          <span class="font-medium text-ink-200">{{ run.bossKey }}</span>
          —
          <span :class="run.status === 'CLEARED' ? 'text-emerald-300' : 'text-rose-300'">
            {{ run.status }}
          </span>
        </div>
      </section>
    </template>

    <!-- Navigation -->
    <section class="flex flex-wrap gap-3" data-testid="coop-boss-actions">
      <MButton data-testid="coop-boss-back" @click="goToPartyHub">
        {{ t('coopBoss.backToParty', '← Về Tổ Đội') }}
      </MButton>
    </section>
  </AppShell>
</template>
