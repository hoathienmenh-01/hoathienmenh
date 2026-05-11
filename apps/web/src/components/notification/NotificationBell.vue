<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type NotificationCreatedBroadcastPayload,
  type NotificationUnreadCountBroadcastPayload,
  type WsFrame,
} from '@xuantoi/shared';
import { on as wsOn } from '@/ws/client';
import { useNotificationsStore } from '@/stores/notifications';
import NotificationDropdown from './NotificationDropdown.vue';

const { t } = useI18n();
const store = useNotificationsStore();

const open = ref(false);
const bellRef = ref<HTMLDivElement | null>(null);
const unsubFns: Array<() => void> = [];

const badgeLabel = computed(() => store.badgeLabel);
const hasUnread = computed(() => store.hasUnread);

function toggleOpen(): void {
  open.value = !open.value;
  if (open.value) {
    void store.refresh();
  }
}

function closeDropdown(): void {
  open.value = false;
}

function handleDocClick(e: MouseEvent): void {
  if (!bellRef.value) return;
  const target = e.target;
  if (target instanceof Node && !bellRef.value.contains(target)) {
    open.value = false;
  }
}

onMounted(() => {
  store.start();

  unsubFns.push(
    wsOn<NotificationCreatedBroadcastPayload>(
      'notification:new',
      (frame: WsFrame<NotificationCreatedBroadcastPayload>) => {
        store.pushIncoming(frame.payload.notification);
        store.setUnreadCount(frame.payload.unreadCount);
      },
    ),
    wsOn<NotificationUnreadCountBroadcastPayload>(
      'notification:unread-count',
      (frame: WsFrame<NotificationUnreadCountBroadcastPayload>) => {
        store.setUnreadCount(frame.payload.unreadCount);
      },
    ),
  );

  document.addEventListener('click', handleDocClick, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocClick, true);
  store.stop();
  for (const fn of unsubFns) {
    try {
      fn();
    } catch {
      // ignore unsub failures
    }
  }
});
</script>

<template>
  <div ref="bellRef" class="relative">
    <button
      type="button"
      class="relative text-ink-100 hover:text-amber-200 px-2 py-1"
      :aria-label="t('notification.bell')"
      :aria-expanded="open"
      :aria-haspopup="true"
      data-testid="notification-bell"
      @click="toggleOpen"
    >
      <span aria-hidden="true" class="text-lg">🔔</span>
      <span
        v-if="hasUnread"
        class="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-amber-500 text-ink-900 text-[10px] leading-[1.1rem] font-bold text-center"
        data-testid="notification-bell-badge"
      >{{ badgeLabel }}</span
      >
    </button>
    <NotificationDropdown :open="open" @close="closeDropdown" />
  </div>
</template>
