<script setup lang="ts">
/**
 * Phase 15.16 (PR #628) — Online Friends Presence Widget.
 *
 * Lightweight sidebar widget that shows online friends using existing
 * social API (`getFriends`) + WS `presence:update` push. Does NOT
 * rewrite the presence backend — only surfaces existing data in a
 * compact read-only widget.
 *
 * Data flow:
 *   - On mount: `getFriends()` → filter `f.online === true`.
 *   - WS `presence:update` → live update online status in-place.
 *   - Click friend name → navigate to `/social` (friends tab).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { getFriends } from '@/api/social';
import type { FriendRow, PresenceUpdateBroadcastPayload, WsFrame } from '@xuantoi/shared';
import { on as wsOn } from '@/ws/client';

const { t } = useI18n();
const router = useRouter();

const friends = ref<FriendRow[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const onlineFriends = computed<FriendRow[]>(() =>
  friends.value.filter((f: FriendRow) => f.online),
);

const offlineFriends = computed<FriendRow[]>(() =>
  friends.value.filter((f: FriendRow) => !f.online).slice(0, 5),
);

const unsubFns: Array<() => void> = [];

onMounted(async () => {
  await refresh();
  // Live presence updates
  unsubFns.push(
    wsOn<PresenceUpdateBroadcastPayload>(
      'presence:update',
      (frame: WsFrame<PresenceUpdateBroadcastPayload>) => {
        const { userId, status } = frame.payload;
        const nextOnline = status === 'ONLINE';
        const idx = friends.value.findIndex((f: FriendRow) => f.friendUserId === userId);
        if (idx < 0) return;
        if (friends.value[idx].online !== nextOnline) {
          friends.value[idx] = { ...friends.value[idx], online: nextOnline };
        }
      },
    ),
  );
});

onBeforeUnmount(() => {
  for (const fn of unsubFns) {
    try { fn(); } catch { /* ignore */ }
  }
  unsubFns.length = 0;
});

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const res = await getFriends();
    friends.value = [...res.friends];
  } catch {
    error.value = 'LOAD_FAILED';
  } finally {
    loading.value = false;
  }
}

function goToSocial(): void {
  void router.push({ path: '/social' });
}

function displayName(f: FriendRow): string {
  return f.friendDisplayName ?? f.friendUserId;
}
</script>

<template>
  <section
    class="border border-ink-300/30 rounded p-3 space-y-3"
    data-testid="online-friends-widget"
  >
    <header class="flex items-center justify-between">
      <h3 class="text-xs uppercase tracking-widest text-ink-300">
        {{ t('onlineFriends.title') }}
      </h3>
      <button
        type="button"
        class="text-[10px] text-amber-300 hover:text-amber-200 underline"
        data-testid="online-friends-view-all"
        @click="goToSocial"
      >
        {{ t('onlineFriends.viewAll') }}
      </button>
    </header>

    <!-- Loading -->
    <div
      v-if="loading"
      class="text-xs text-ink-300"
      data-testid="online-friends-loading"
    >
      {{ t('common.loading') }}
    </div>

    <!-- Error -->
    <div
      v-else-if="error"
      class="text-xs text-rose-300"
      data-testid="online-friends-error"
    >
      {{ t('onlineFriends.error') }}
    </div>

    <!-- Empty (no friends at all) -->
    <div
      v-else-if="friends.length === 0"
      class="text-xs text-ink-300/70"
      data-testid="online-friends-empty"
    >
      {{ t('onlineFriends.noFriends') }}
    </div>

    <!-- Content -->
    <template v-else>
      <!-- Online friends -->
      <div v-if="onlineFriends.length > 0">
        <p class="text-[10px] text-emerald-300 mb-1">
          {{ t('onlineFriends.onlineCount', { n: onlineFriends.length }) }}
        </p>
        <ul class="space-y-1" data-testid="online-friends-list">
          <li
            v-for="f in onlineFriends"
            :key="f.id"
            class="flex items-center gap-2 text-xs"
            data-testid="online-friend-row"
          >
            <span class="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
            <span class="truncate text-ink-100">{{ displayName(f) }}</span>
          </li>
        </ul>
      </div>

      <!-- No one online -->
      <div
        v-else
        class="text-xs text-ink-300/70"
        data-testid="online-friends-none-online"
      >
        {{ t('onlineFriends.noneOnline') }}
      </div>

      <!-- Recently offline (compact, max 5) -->
      <div v-if="offlineFriends.length > 0">
        <p class="text-[10px] text-ink-300/60 mb-1">
          {{ t('onlineFriends.recentlyOffline') }}
        </p>
        <ul class="space-y-0.5" data-testid="offline-friends-list">
          <li
            v-for="f in offlineFriends"
            :key="f.id"
            class="flex items-center gap-2 text-[11px] text-ink-300/50"
            data-testid="offline-friend-row"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-ink-300/40 shrink-0" />
            <span class="truncate">{{ displayName(f) }}</span>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>
