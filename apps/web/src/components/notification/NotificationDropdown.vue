<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type { NotificationRow } from '@xuantoi/shared';
import { useNotificationsStore } from '@/stores/notifications';

defineProps<{
  open: boolean;
}>();

const emit = defineEmits<(e: 'close') => void>();

const { t } = useI18n();
const store = useNotificationsStore();
const router = useRouter();

const items = computed(() => store.items);
const loading = computed(() => store.loading);
const errorCode = computed(() => store.errorCode);
const hasUnread = computed(() => store.hasUnread);

/**
 * Phase 19.3 — map notification entity to a FE route. Server gives
 * us `entityType` + `entityId` + `data` — we never trust raw URLs.
 *   - FRIEND_REQUEST → social view + friend requests tab.
 *   - PRIVATE_THREAD → social view + private chat tab (thread id in
 *     query so FE can scroll/open).
 *   - GROUP_CHAT → social view + group chat tab.
 *   - CHAT_REPORT → social view (player-facing summary; admin uses
 *     /admin chat moderation panel separately).
 *   - SECURITY_ALERT / unknown → no navigation (just mark read).
 */
function resolveRoute(row: NotificationRow): {
  path: string;
  query?: Record<string, string>;
} | null {
  switch (row.entityType) {
    case 'FRIEND_REQUEST':
      return { path: '/social', query: { tab: 'requests' } };
    case 'PRIVATE_THREAD':
      return {
        path: '/social',
        query: row.entityId
          ? { tab: 'private', threadId: row.entityId }
          : { tab: 'private' },
      };
    case 'GROUP_CHAT':
      return {
        path: '/social',
        query: row.entityId
          ? { tab: 'groups', groupId: row.entityId }
          : { tab: 'groups' },
      };
    case 'CHAT_REPORT':
      return { path: '/social', query: { tab: 'reports' } };
    case 'SECURITY_ALERT':
    default:
      return null;
  }
}

async function handleClick(row: NotificationRow): Promise<void> {
  if (!row.readAt) await store.markOneRead(row.id);
  const target = resolveRoute(row);
  emit('close');
  if (target) {
    await router.push(target);
  }
}

async function handleMarkAll(): Promise<void> {
  await store.markAll();
}

async function handleRetry(): Promise<void> {
  await store.refresh();
}

function senderLabel(row: NotificationRow): string {
  const data = row.dataJson as Record<string, unknown>;
  const candidates = [
    data?.senderName,
    data?.accepterName,
    data?.addedByName,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return '';
}

function groupLabel(row: NotificationRow): string {
  const data = row.dataJson as Record<string, unknown>;
  const v = data?.groupName;
  return typeof v === 'string' ? v : '';
}

function bodyForRow(row: NotificationRow): string {
  const sender = senderLabel(row);
  const group = groupLabel(row);
  return t(row.bodyKey, { sender, group });
}

function titleForRow(row: NotificationRow): string {
  return t(row.titleKey);
}
</script>

<template>
  <div
    v-if="open"
    class="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto rounded-md border border-ink-300/30 bg-ink-700 shadow-lg z-50"
    data-testid="notification-dropdown"
    role="dialog"
    :aria-label="t('notification.title')"
  >
    <header
      class="flex items-center justify-between px-3 py-2 border-b border-ink-300/30"
    >
      <span class="text-sm font-semibold text-ink-50">{{
        t('notification.title')
      }}</span>
      <button
        v-if="hasUnread"
        type="button"
        class="text-xs text-amber-300 hover:text-amber-200"
        data-testid="notification-mark-all"
        @click="handleMarkAll"
      >
        {{ t('notification.markAllRead') }}
      </button>
    </header>

    <div v-if="loading && items.length === 0" class="px-3 py-4 text-sm text-ink-300" data-testid="notification-loading">
      {{ t('notification.loading') }}
    </div>

    <div
      v-else-if="errorCode"
      class="px-3 py-4 text-sm text-red-300"
      data-testid="notification-error"
    >
      <p class="mb-2">{{ t('notification.errorGeneric') }}</p>
      <button
        type="button"
        class="text-xs underline hover:text-red-200"
        @click="handleRetry"
      >
        {{ t('notification.retry') }}
      </button>
    </div>

    <div
      v-else-if="items.length === 0"
      class="px-3 py-6 text-sm text-ink-300 text-center"
      data-testid="notification-empty"
    >
      {{ t('notification.empty') }}
    </div>

    <ul v-else class="divide-y divide-ink-300/20">
      <li
        v-for="row in items"
        :key="row.id"
        class="px-3 py-2 hover:bg-ink-700/60 cursor-pointer"
        :class="{ 'bg-ink-700/40': !row.readAt }"
        data-testid="notification-item"
        :data-read="!!row.readAt"
        @click="handleClick(row)"
      >
        <div class="flex items-start gap-2">
          <span
            v-if="!row.readAt"
            class="mt-1 h-2 w-2 rounded-full bg-amber-400 shrink-0"
            aria-hidden="true"
          />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-ink-50 truncate">
              {{ titleForRow(row) }}
            </p>
            <p class="text-xs text-ink-300 truncate">{{ bodyForRow(row) }}</p>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
