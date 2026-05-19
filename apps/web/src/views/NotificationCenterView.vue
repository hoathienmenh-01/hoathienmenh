<script setup lang="ts">
/**
 * Phase 15.16 (PR #628) — Notification Center View.
 *
 * Aggregates real data from:
 *   - Notification store (social: friend requests, messages, security alerts)
 *   - Mail API (system rewards, events, sect updates, purchases/trading)
 *
 * Filters: All | System | Rewards | Sect | Trading | Combat | Mission | Social
 *
 * Empty states shown per-filter when no matching data exists. Does NOT
 * invent fake notifications — only surfaces data that actually exists
 * in the backend.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import OnlineFriendsWidget from '@/components/OnlineFriendsWidget.vue';
import { useNotificationsStore } from '@/stores/notifications';
import { listMail, type MailView, type MailType } from '@/api/mail';
import type { NotificationRow } from '@xuantoi/shared';

// ---------------------------------------------------------------------------
// Unified notification item
// ---------------------------------------------------------------------------

export type NotifFilterCategory =
  | 'all'
  | 'system'
  | 'rewards'
  | 'sect'
  | 'trading'
  | 'combat'
  | 'mission'
  | 'social';

interface UnifiedNotifItem {
  id: string;
  source: 'notification' | 'mail';
  category: NotifFilterCategory;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  /** For navigation on click */
  routeTo: { path: string; query?: Record<string, string> } | null;
}

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

const { t } = useI18n();
const router = useRouter();
const notifStore = useNotificationsStore();

const activeFilter = ref<NotifFilterCategory>('all');
const mailItems = ref<MailView[]>([]);
const mailLoading = ref(false);
const mailError = ref<string | null>(null);

const filters: NotifFilterCategory[] = [
  'all',
  'system',
  'rewards',
  'sect',
  'trading',
  'combat',
  'mission',
  'social',
];

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

onMounted(async () => {
  // Ensure notification store is fresh
  await notifStore.refresh();
  await fetchMail();
});

async function fetchMail(): Promise<void> {
  mailLoading.value = true;
  mailError.value = null;
  try {
    const mails = await listMail();
    mailItems.value = mails.filter((m) => !m.deleted);
  } catch {
    mailError.value = 'MAIL_LOAD_FAILED';
  } finally {
    mailLoading.value = false;
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

const MAIL_TYPE_TO_CATEGORY: Record<MailType, NotifFilterCategory> = {
  SYSTEM: 'system',
  ADMIN: 'system',
  REWARD: 'rewards',
  EVENT: 'rewards',
  MAINTENANCE: 'system',
  PURCHASE: 'trading',
  SECT: 'sect',
  FRIEND: 'social',
  RETURNER: 'system',
  PVP: 'combat',
};

function mapMailToUnified(mail: MailView): UnifiedNotifItem {
  return {
    id: `mail-${mail.id}`,
    source: 'mail',
    category: MAIL_TYPE_TO_CATEGORY[mail.mailType] ?? 'system',
    title: mail.subject,
    body: mail.body.length > 120 ? mail.body.slice(0, 120) + '...' : mail.body,
    read: mail.readAt !== null,
    createdAt: mail.createdAt,
    routeTo: { path: '/mail' },
  };
}

function mapNotifToUnified(row: NotificationRow): UnifiedNotifItem {
  return {
    id: `notif-${row.id}`,
    source: 'notification',
    category: 'social',
    title: t(row.titleKey),
    body: t(row.bodyKey, row.dataJson as Record<string, unknown>),
    read: row.readAt !== null,
    createdAt: row.createdAt,
    routeTo: resolveNotifRoute(row),
  };
}

function resolveNotifRoute(row: NotificationRow): UnifiedNotifItem['routeTo'] {
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
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Combined + filtered list
// ---------------------------------------------------------------------------

const allItems = computed<UnifiedNotifItem[]>(() => {
  const fromNotifs = notifStore.items.map(mapNotifToUnified);
  const fromMail = mailItems.value.map(mapMailToUnified);
  const combined = [...fromNotifs, ...fromMail];
  combined.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return combined;
});

const filteredItems = computed<UnifiedNotifItem[]>(() => {
  if (activeFilter.value === 'all') return allItems.value;
  return allItems.value.filter((item) => item.category === activeFilter.value);
});

const isLoading = computed(
  () => notifStore.loading && notifStore.items.length === 0 && mailLoading.value,
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function handleMarkAllRead(): Promise<void> {
  await notifStore.markAll();
}

async function handleItemClick(item: UnifiedNotifItem): Promise<void> {
  // Mark notification as read if from notification source
  if (item.source === 'notification') {
    const realId = item.id.replace('notif-', '');
    if (!item.read) await notifStore.markOneRead(realId);
  }
  if (item.routeTo) {
    await router.push(item.routeTo);
  }
}

function filterLabel(f: NotifFilterCategory): string {
  return t(`notificationCenter.filter.${f}`);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return t('notificationCenter.time.justNow');
  if (diffMin < 60)
    return t('notificationCenter.time.minutesAgo', { n: diffMin });
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)
    return t('notificationCenter.time.hoursAgo', { n: diffH });
  const diffD = Math.floor(diffH / 24);
  return t('notificationCenter.time.daysAgo', { n: diffD });
}
</script>

<template>
  <section class="space-y-4" data-testid="notification-center-view">
    <XTLuxHero
      eyebrow="THONG BAO"
      label="Thong Bao"
      :title="t('notificationCenter.viewTitle')"
      :subtitle="t('notificationCenter.viewSubtitle')"
      tone="gold"
      watermark-letter="T"
      breadcrumb="Notification Center"
      test-id="notification-center-hero"
    />

    <!-- Role hint -->
    <p class="text-sm text-gray-400 px-1" data-testid="notification-center-role-hint">
      {{ t('notificationCenter.roleHint') }}
    </p>

    <!-- Cross-navigation -->
    <nav class="flex gap-2 text-xs mb-2" data-testid="notification-center-cross-nav">
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
        data-testid="cross-nav-mail"
        @click="$router.push('/mail')"
      >
        <span>{{ t('notificationCenter.crossNav.mail') }}</span>
        <span class="text-gray-500 hidden sm:inline">{{ t('notificationCenter.crossNav.mailDesc') }}</span>
      </button>
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
        data-testid="cross-nav-social"
        @click="$router.push('/social')"
      >
        <span>{{ t('notificationCenter.crossNav.social') }}</span>
        <span class="text-gray-500 hidden sm:inline">{{ t('notificationCenter.crossNav.socialDesc') }}</span>
      </button>
    </nav>

    <!-- Filter tabs -->
    <nav
      class="flex flex-wrap gap-2"
      role="tablist"
      data-testid="notification-center-filters"
    >
      <button
        v-for="f in filters"
        :key="f"
        type="button"
        role="tab"
        :aria-selected="activeFilter === f"
        class="px-3 py-1 text-xs uppercase tracking-widest rounded border transition-colors"
        :class="
          activeFilter === f
            ? 'border-amber-400/60 text-amber-200 bg-amber-500/10'
            : 'border-ink-300/30 text-ink-300 hover:border-ink-300/50'
        "
        :data-testid="`notification-filter-${f}`"
        @click="activeFilter = f"
      >
        {{ filterLabel(f) }}
      </button>
    </nav>

    <div class="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <!-- Main notification list -->
      <div class="lg:col-span-3">
        <!-- Mark all read header -->
        <div
          v-if="notifStore.hasUnread"
          class="flex justify-end mb-2"
        >
          <button
            type="button"
            class="text-xs text-amber-300 hover:text-amber-200 underline"
            data-testid="notification-center-mark-all"
            @click="handleMarkAllRead"
          >
            {{ t('notification.markAllRead') }}
          </button>
        </div>

        <!-- Loading -->
        <div
          v-if="isLoading"
          class="px-4 py-8 text-center text-sm text-ink-300"
          data-testid="notification-center-loading"
        >
          {{ t('notification.loading') }}
        </div>

        <!-- Error -->
        <div
          v-else-if="notifStore.errorCode && mailError"
          class="px-4 py-8 text-center text-sm text-rose-300"
          data-testid="notification-center-error"
        >
          <p>{{ t('notification.errorGeneric') }}</p>
          <button
            type="button"
            class="mt-2 text-xs underline hover:text-rose-200"
            @click="notifStore.refresh(); fetchMail()"
          >
            {{ t('notification.retry') }}
          </button>
        </div>

        <!-- Empty state -->
        <div
          v-else-if="filteredItems.length === 0"
          class="px-4 py-12 text-center border border-ink-300/20 rounded"
          data-testid="notification-center-empty"
        >
          <p class="text-sm text-ink-300">
            {{ t('notificationCenter.empty') }}
          </p>
          <p class="text-xs text-ink-300/60 mt-1">
            {{ t('notificationCenter.emptyHint') }}
          </p>
        </div>

        <!-- Notification list -->
        <ul
          v-else
          class="space-y-1"
          data-testid="notification-center-list"
        >
          <li
            v-for="item in filteredItems"
            :key="item.id"
            class="flex items-start gap-3 rounded border border-ink-300/20 px-4 py-3 cursor-pointer transition-colors hover:bg-ink-700/40"
            :class="{ 'bg-ink-700/20': !item.read }"
            :data-testid="`notification-center-item-${item.source}`"
            :data-read="item.read"
            @click="handleItemClick(item)"
          >
            <!-- Unread dot -->
            <span
              v-if="!item.read"
              class="mt-1.5 h-2 w-2 rounded-full bg-amber-400 shrink-0"
              aria-hidden="true"
            />
            <span
              v-else
              class="mt-1.5 h-2 w-2 shrink-0"
              aria-hidden="true"
            />

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-medium text-ink-50 truncate">
                  {{ item.title }}
                </p>
                <span class="text-[10px] text-ink-300/60 shrink-0">
                  {{ formatTime(item.createdAt) }}
                </span>
              </div>
              <p class="text-xs text-ink-300 truncate mt-0.5">
                {{ item.body }}
              </p>
              <span
                class="inline-block mt-1 px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded border border-ink-300/20 text-ink-300/70"
              >
                {{ filterLabel(item.category) }}
              </span>
            </div>
          </li>
        </ul>
      </div>

      <!-- Online friends widget sidebar -->
      <aside class="lg:col-span-1">
        <OnlineFriendsWidget />
      </aside>
    </div>
  </section>
</template>
