<script setup lang="ts">
/**
 * CoopBossView — `/party/coop-boss` entry surface (PR #631).
 *
 * Full polished view for the Co-op Boss feature. Delegates all run
 * lifecycle interaction to CoopBossPanel (create/join/leave/contribute/
 * finish/claim). Adds proper auth gating, loading state, error handling,
 * and navigation context.
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import AppShell from '@/components/shell/AppShell.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import MButton from '@/components/ui/MButton.vue';
import CoopBossPanel from '@/components/CoopBossPanel.vue';

const auth = useAuthStore();
const game = useGameStore();
const router = useRouter();
const { t } = useI18n();

const ready = ref(false);
const noCharacter = ref(false);

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  if (!game.character) {
    noCharacter.value = true;
    ready.value = true;
    return;
  }
  ready.value = true;
});

function goToPartyHub(): void {
  router.push('/party');
}

function goToBoss(): void {
  router.push('/boss');
}

function goToCombatHub(): void {
  router.push('/combat');
}
</script>

<template>
  <AppShell>
    <XTLuxHero
      eyebrow="CO-OP BOSS"
      label="Co-op Boss"
      :title="t('coopBoss.title', 'Co-op Boss')"
      :subtitle="t('coopBoss.subtitle', 'Hợp lực đánh boss thế giới cùng tổ đội')"
      tone="seal"
      watermark-letter="B"
      breadcrumb="Co-op Boss"
      test-id="coop-boss-hero"
      class="mb-4"
    >
      <XTPageEyebrow caps="CO-OP BOSS" label="Co-op Boss" class="sr-only" />
    </XTLuxHero>

    <!-- Loading -->
    <div v-if="!ready" class="text-center py-8 text-ink-400" data-testid="coop-boss-loading">
      {{ t('common.loading', 'Đang tải...') }}
    </div>

    <!-- No character -->
    <section
      v-else-if="noCharacter"
      class="text-center py-8 space-y-3"
      data-testid="coop-boss-no-character"
    >
      <p class="text-ink-300 text-lg">
        {{ t('coopBoss.noCharacter', 'Bạn cần tạo nhân vật trước khi tham gia Co-op Boss') }}
      </p>
      <MButton data-testid="coop-boss-create-char" @click="router.push('/onboarding')">
        {{ t('coopBoss.createCharacter', 'Tạo Nhân Vật') }}
      </MButton>
    </section>

    <!-- Content: delegates to CoopBossPanel which handles party/no-party internally -->
    <template v-else>
      <!-- Main panel (delegates to CoopBossPanel) -->
      <CoopBossPanel data-testid="coop-boss-panel-mount" />

      <!-- Info: how co-op boss works -->
      <section
        class="mt-6 rounded border border-ink-300/20 bg-ink-700/20 p-4 space-y-2"
        data-testid="coop-boss-info"
      >
        <h4 class="text-xs uppercase tracking-widest text-ink-200">
          {{ t('coopBoss.info.title', 'Cách Thức Hoạt Động') }}
        </h4>
        <ul class="text-xs text-ink-300 space-y-1 list-disc list-inside">
          <li>{{ t('coopBoss.info.step1', 'Leader tổ đội chọn boss và tạo trận.') }}</li>
          <li>{{ t('coopBoss.info.step2', 'Thành viên tham gia và ghi nhận sát thương.') }}</li>
          <li>{{ t('coopBoss.info.step3', 'Leader kết thúc trận khi boss bị hạ.') }}</li>
          <li>{{ t('coopBoss.info.step4', 'Phần thưởng phân theo mức đóng góp (MVP/HIGH/NORMAL/LOW).') }}</li>
          <li>{{ t('coopBoss.info.step5', 'Nhấn Nhận Thưởng để nhận — server xác minh 1 lần duy nhất.') }}</li>
        </ul>
      </section>
    </template>

    <!-- Navigation -->
    <section class="flex flex-wrap gap-3 mt-6" data-testid="coop-boss-actions">
      <MButton data-testid="coop-boss-back" @click="goToPartyHub">
        {{ t('coopBoss.backToParty', '← Về Tổ Đội') }}
      </MButton>
      <MButton data-testid="coop-boss-to-boss" @click="goToBoss">
        {{ t('coopBoss.goToBoss', '⚔ World Boss') }}
      </MButton>
      <MButton data-testid="coop-boss-to-combat" @click="goToCombatHub">
        {{ t('coopBoss.goToCombat', '🗺 Chiến Trường') }}
      </MButton>
    </section>
  </AppShell>
</template>
