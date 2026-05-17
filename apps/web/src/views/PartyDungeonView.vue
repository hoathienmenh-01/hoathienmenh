<script setup lang="ts">
/**
 * PartyDungeonView — `/party/dungeon` entry surface (PR #629).
 *
 * Hub-style view that shows the player's active party dungeon room
 * status. Uses the real `partyDungeon.ts` API. If no active room,
 * shows an empty state with context. Does NOT implement full dungeon
 * run flow — that requires combat/matchmaking which is out of scope.
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { getMyPartyDungeonRoom } from '@/api/partyDungeon';
import type { MyPartyDungeonRoomResponse } from '@xuantoi/shared';
import AppShell from '@/components/shell/AppShell.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import MButton from '@/components/ui/MButton.vue';

const auth = useAuthStore();
const game = useGameStore();
const router = useRouter();
const { t } = useI18n();

const loading = ref(true);
const room = ref<MyPartyDungeonRoomResponse | null>(null);

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  try {
    room.value = await getMyPartyDungeonRoom();
  } catch {
    room.value = null;
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
    <div v-if="loading" class="text-center py-8 text-ink-400" data-testid="party-dungeon-loading">
      {{ t('common.loading', 'Loading...') }}
    </div>

    <!-- Active Room -->
    <section
      v-else-if="room"
      class="rounded border border-ink-300/40 bg-ink-700/30 p-4 mb-4 space-y-3"
      data-testid="party-dungeon-active-room"
    >
      <h3 class="font-bold text-ink-100">
        {{ t('partyDungeon.activeRoom', 'Phòng Đang Hoạt Động') }}
      </h3>
      <pre class="text-xs text-ink-300 whitespace-pre-wrap overflow-auto max-h-48">{{ JSON.stringify(room, null, 2) }}</pre>
    </section>

    <!-- No active room — empty state -->
    <section
      v-else
      class="text-center py-8 space-y-4"
      data-testid="party-dungeon-empty"
    >
      <p class="text-ink-300 text-lg">
        {{ t('partyDungeon.noRoom', 'Chưa có phòng dungeon nào đang hoạt động') }}
      </p>
      <p class="text-ink-400 text-sm">
        {{ t('partyDungeon.hint', 'Hãy tạo hoặc tham gia phòng từ tổ đội của bạn') }}
      </p>
    </section>

    <!-- Navigation -->
    <section class="flex flex-wrap gap-3" data-testid="party-dungeon-actions">
      <MButton data-testid="party-dungeon-back" @click="goToPartyHub">
        {{ t('partyDungeon.backToParty', '← Về Tổ Đội') }}
      </MButton>
    </section>
  </AppShell>
</template>
