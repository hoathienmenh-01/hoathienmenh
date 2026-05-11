<script setup lang="ts">
/**
 * Phase 19.1 — Social System Foundation root view.
 *
 * Tabs: Friends / PrivateChat / GroupChat. Mount panel hiện đang chọn để
 * tiết kiệm request đầu tiên (panel khác lazy mount khi user click tab).
 *
 * Route: `/social` (xem `apps/web/src/router/index.ts`). Nav link xuất
 * hiện trong `AppShell.vue` sidebar khi role là PLAYER (mọi player auth).
 */
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import SocialPanel from '@/components/SocialPanel.vue';
import PrivateChatPanel from '@/components/PrivateChatPanel.vue';
import GroupChatPanel from '@/components/GroupChatPanel.vue';
import PartyPanel from '@/components/PartyPanel.vue';
import PartyDungeonPanel from '@/components/PartyDungeonPanel.vue';
import CoopBossPanel from '@/components/CoopBossPanel.vue';
import CoopWeeklyLeaderboardPanel from '@/components/CoopWeeklyLeaderboardPanel.vue';

type Tab =
  | 'friends'
  | 'private'
  | 'group'
  | 'party'
  | 'partyDungeon'
  | 'coopBoss'
  | 'coopWeekly';

const { t } = useI18n();
const tab = ref<Tab>('friends');
</script>

<template>
  <section class="space-y-4" data-testid="social-view">
    <header class="space-y-1">
      <h1 class="text-2xl tracking-widest">{{ t('social.viewTitle') }}</h1>
      <p class="text-xs text-ink-300/80">{{ t('social.viewSubtitle') }}</p>
    </header>

    <nav class="flex flex-wrap gap-2" role="tablist">
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'friends'"
        class="px-3 py-1 text-xs uppercase tracking-widest rounded border"
        :class="
          tab === 'friends'
            ? 'border-amber-400/60 text-amber-200'
            : 'border-ink-300/30 text-ink-300'
        "
        data-testid="social-tab-friends"
        @click="tab = 'friends'"
      >
        {{ t('social.tabs.friends') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'private'"
        class="px-3 py-1 text-xs uppercase tracking-widest rounded border"
        :class="
          tab === 'private'
            ? 'border-amber-400/60 text-amber-200'
            : 'border-ink-300/30 text-ink-300'
        "
        data-testid="social-tab-private"
        @click="tab = 'private'"
      >
        {{ t('social.tabs.private') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'group'"
        class="px-3 py-1 text-xs uppercase tracking-widest rounded border"
        :class="
          tab === 'group'
            ? 'border-amber-400/60 text-amber-200'
            : 'border-ink-300/30 text-ink-300'
        "
        data-testid="social-tab-group"
        @click="tab = 'group'"
      >
        {{ t('social.tabs.group') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'party'"
        class="px-3 py-1 text-xs uppercase tracking-widest rounded border"
        :class="
          tab === 'party'
            ? 'border-amber-400/60 text-amber-200'
            : 'border-ink-300/30 text-ink-300'
        "
        data-testid="social-tab-party"
        @click="tab = 'party'"
      >
        {{ t('party.tab') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'partyDungeon'"
        class="px-3 py-1 text-xs uppercase tracking-widest rounded border"
        :class="
          tab === 'partyDungeon'
            ? 'border-amber-400/60 text-amber-200'
            : 'border-ink-300/30 text-ink-300'
        "
        data-testid="social-tab-party-dungeon"
        @click="tab = 'partyDungeon'"
      >
        {{ t('partyDungeon.title') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'coopBoss'"
        class="px-3 py-1 text-xs uppercase tracking-widest rounded border"
        :class="
          tab === 'coopBoss'
            ? 'border-amber-400/60 text-amber-200'
            : 'border-ink-300/30 text-ink-300'
        "
        data-testid="social-tab-coop-boss"
        @click="tab = 'coopBoss'"
      >
        {{ t('coopBoss.title') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'coopWeekly'"
        class="px-3 py-1 text-xs uppercase tracking-widest rounded border"
        :class="
          tab === 'coopWeekly'
            ? 'border-amber-400/60 text-amber-200'
            : 'border-ink-300/30 text-ink-300'
        "
        data-testid="social-tab-coop-weekly"
        @click="tab = 'coopWeekly'"
      >
        {{ t('coopRewardCap.title') }}
      </button>
    </nav>

    <div role="tabpanel">
      <SocialPanel v-if="tab === 'friends'" />
      <PrivateChatPanel v-else-if="tab === 'private'" />
      <GroupChatPanel v-else-if="tab === 'group'" />
      <PartyPanel v-else-if="tab === 'party'" />
      <PartyDungeonPanel v-else-if="tab === 'partyDungeon'" />
      <CoopBossPanel v-else-if="tab === 'coopBoss'" />
      <CoopWeeklyLeaderboardPanel v-else />
    </div>
  </section>
</template>
