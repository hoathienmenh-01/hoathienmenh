<script setup lang="ts">
/**
 * PartyDungeonView — `/party/dungeon` entry surface (PR #631).
 *
 * Full polished view for the Party Dungeon co-op feature. Delegates
 * all room lifecycle interaction to PartyDungeonPanel.
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
import PartyDungeonPanel from '@/components/PartyDungeonPanel.vue';

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

function goToDungeonRun(): void {
  router.push('/dungeon-run');
}

function goToCombatHub(): void {
  router.push('/combat');
}
</script>

<template>
  <AppShell>
    <XTLuxHero
      eyebrow="PARTY DUNGEON"
      label="Party Dungeon"
      :title="t('partyDungeon.title', 'Party Dungeon')"
      :subtitle="t('partyDungeon.subtitle', 'Dungeon Co-op PvE cùng tổ đội')"
      tone="jade"
      watermark-letter="D"
      breadcrumb="Party Dungeon"
      test-id="party-dungeon-hero"
      class="mb-4"
    >
      <XTPageEyebrow caps="PARTY DUNGEON" label="Party Dungeon" class="sr-only" />
    </XTLuxHero>

    <!-- Loading -->
    <div v-if="!ready" class="text-center py-8 text-ink-400" data-testid="party-dungeon-loading">
      {{ t('common.loading', 'Đang tải...') }}
    </div>

    <!-- No character -->
    <section
      v-else-if="noCharacter"
      class="text-center py-8 space-y-3"
      data-testid="party-dungeon-no-character"
    >
      <p class="text-ink-300 text-lg">
        {{ t('partyDungeon.noCharacter', 'Bạn cần tạo nhân vật trước khi tham gia Party Dungeon') }}
      </p>
      <MButton data-testid="party-dungeon-create-char" @click="router.push('/onboarding')">
        {{ t('partyDungeon.createCharacter', 'Tạo Nhân Vật') }}
      </MButton>
    </section>

    <!-- Content: delegates to PartyDungeonPanel which handles party/no-party internally -->
    <template v-else>
      <!-- Main panel -->
      <PartyDungeonPanel data-testid="party-dungeon-panel-mount" />

      <!-- Info: how party dungeon works -->
      <section
        class="mt-6 rounded border border-ink-300/20 bg-ink-700/20 p-4 space-y-2"
        data-testid="party-dungeon-info"
      >
        <h4 class="text-xs uppercase tracking-widest text-ink-200">
          {{ t('partyDungeon.info.title', 'Cách Thức Hoạt Động') }}
        </h4>
        <ul class="text-xs text-ink-300 space-y-1 list-disc list-inside">
          <li>{{ t('partyDungeon.info.step1', 'Leader chọn dungeon và tạo phòng.') }}</li>
          <li>{{ t('partyDungeon.info.step2', 'Thành viên tổ đội tham gia và bấm Sẵn Sàng.') }}</li>
          <li>{{ t('partyDungeon.info.step3', 'Leader bấm Bắt Đầu khi đủ người sẵn sàng.') }}</li>
          <li>{{ t('partyDungeon.info.step4', 'Dungeon tự động xử lý — kết quả hiện ngay.') }}</li>
          <li>{{ t('partyDungeon.info.step5', 'Mỗi thành viên nhận thưởng riêng — bấm Nhận Thưởng.') }}</li>
        </ul>
      </section>
    </template>

    <!-- Navigation -->
    <section class="flex flex-wrap gap-3 mt-6" data-testid="party-dungeon-actions">
      <MButton data-testid="party-dungeon-back" @click="goToPartyHub">
        {{ t('partyDungeon.backToParty', '← Về Tổ Đội') }}
      </MButton>
      <MButton data-testid="party-dungeon-to-solo" @click="goToDungeonRun">
        {{ t('partyDungeon.goToSolo', '🏔 Bí Cảnh Solo') }}
      </MButton>
      <MButton data-testid="party-dungeon-to-combat" @click="goToCombatHub">
        {{ t('partyDungeon.goToCombat', '🗺 Chiến Trường') }}
      </MButton>
    </section>
  </AppShell>
</template>
