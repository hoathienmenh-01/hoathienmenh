<script setup lang="ts">
/**
 * Phase 19.1 — Private chat 1-1 panel.
 *
 * Render:
 *   - List threads (peer + online dot + last activity).
 *   - Khung message của thread đang select (desc → reverse render asc).
 *   - Form gửi message (validate empty + 500 char cap, khớp server).
 *   - Form mở thread mới bằng peer userId.
 *
 * Server-authoritative enforce (ChatPrivateService): chỉ 2 thành viên
 * thread đọc; block 2 chiều reject `BLOCKED`; non-member trả 404 mask.
 * FE chỉ surface error code → i18n message qua toast.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  listPrivateMessages,
  listPrivateThreads,
  openPrivateThread,
  sendPrivateMessage,
} from '@/api/chatPrivate';
import type {
  PrivateChatMessageRow,
  PrivateChatThreadRow,
} from '@xuantoi/shared';
import { SOCIAL_LIMITS } from '@xuantoi/shared';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const { t } = useI18n();
const toast = useToastStore();

const threads = ref<PrivateChatThreadRow[]>([]);
const messagesByThread = ref<Record<string, PrivateChatMessageRow[]>>({});
const activeThreadId = ref<string | null>(null);
const loadingThreads = ref(true);
const loadingMessages = ref(false);
const error = ref<string>('');

const openPeerId = ref('');
const openInFlight = ref(false);
const draft = ref('');
const sending = ref(false);

const activeThread = computed<PrivateChatThreadRow | null>(() =>
  activeThreadId.value
    ? threads.value.find((t) => t.id === activeThreadId.value) ?? null
    : null,
);

const activeMessages = computed<PrivateChatMessageRow[]>(() => {
  const id = activeThreadId.value;
  if (!id) return [];
  return messagesByThread.value[id] ?? [];
});

const draftLength = computed(() => draft.value.trim().length);
const draftOverLimit = computed(
  () => draftLength.value > SOCIAL_LIMITS.PRIVATE_MESSAGE_MAX,
);
const canSend = computed(
  () =>
    !!activeThreadId.value &&
    !sending.value &&
    draftLength.value > 0 &&
    !draftOverLimit.value,
);

defineExpose({ refresh: refreshThreads, selectThread });

onMounted(refreshThreads);

watch(activeThreadId, (id) => {
  if (id) void loadMessages(id);
});

function tShortError(code: string): string {
  const key = `chatPrivate.errors.${code}`;
  const v = t(key, '__missing__');
  return v === '__missing__' ? t('chatPrivate.errors.UNKNOWN') : v;
}

async function refreshThreads(): Promise<void> {
  loadingThreads.value = true;
  error.value = '';
  try {
    const res = await listPrivateThreads();
    threads.value = [...res.threads];
    if (
      activeThreadId.value &&
      !threads.value.some((th) => th.id === activeThreadId.value)
    ) {
      activeThreadId.value = null;
    }
  } catch (e) {
    error.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loadingThreads.value = false;
  }
}

async function selectThread(id: string): Promise<void> {
  activeThreadId.value = id;
}

async function loadMessages(id: string): Promise<void> {
  loadingMessages.value = true;
  try {
    const res = await listPrivateMessages(id, 50);
    // Server trả desc theo createdAt → đảo lại để hiển thị chronological.
    messagesByThread.value[id] = [...res.messages].reverse();
    await nextTick();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    loadingMessages.value = false;
  }
}

async function onOpenThread(): Promise<void> {
  const peer = openPeerId.value.trim();
  if (!peer) return;
  openInFlight.value = true;
  try {
    const t = await openPrivateThread(peer);
    if (!threads.value.some((x) => x.id === t.id)) {
      threads.value = [t, ...threads.value];
    }
    activeThreadId.value = t.id;
    openPeerId.value = '';
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    openInFlight.value = false;
  }
}

async function onSend(): Promise<void> {
  const id = activeThreadId.value;
  if (!id) return;
  const body = draft.value.trim();
  if (!body || draftOverLimit.value) return;
  sending.value = true;
  try {
    const msg = await sendPrivateMessage(id, body);
    const arr = messagesByThread.value[id] ?? [];
    messagesByThread.value[id] = [...arr, msg];
    draft.value = '';
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    sending.value = false;
  }
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<template>
  <section
    class="border border-ink-300/40 rounded grid md:grid-cols-[200px_1fr] gap-0"
    data-testid="private-chat-panel"
  >
    <!-- Threads list -->
    <aside class="border-r border-ink-300/30">
      <div
        class="px-3 py-2 text-xs uppercase tracking-widest text-ink-300 border-b border-ink-300/30"
      >
        {{ t('chatPrivate.threads.header') }}
      </div>
      <form
        class="p-2 flex flex-col gap-1"
        data-testid="private-chat-open-form"
        @submit.prevent="onOpenThread"
      >
        <input
          v-model="openPeerId"
          type="text"
          maxlength="64"
          class="w-full rounded border border-ink-300/40 bg-ink-800/60 px-2 py-1 text-xs"
          :placeholder="t('chatPrivate.threads.openPlaceholder')"
          data-testid="private-chat-open-peer"
        />
        <button
          type="submit"
          class="rounded border border-amber-400/60 px-2 py-1 text-[10px] uppercase tracking-widest text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
          :disabled="openInFlight || !openPeerId.trim()"
          data-testid="private-chat-open-submit"
        >
          {{ t('chatPrivate.threads.openSubmit') }}
        </button>
      </form>
      <div v-if="loadingThreads" class="p-2 text-xs text-ink-300" data-testid="private-chat-threads-loading">
        {{ t('common.loading') }}
      </div>
      <div v-else-if="error" class="p-2 text-xs text-rose-300" data-testid="private-chat-threads-error">
        {{ tShortError(error) }}
      </div>
      <div
        v-else-if="threads.length === 0"
        class="p-2 text-xs text-ink-300/70"
        data-testid="private-chat-threads-empty"
      >
        {{ t('chatPrivate.threads.empty') }}
      </div>
      <ul v-else class="divide-y divide-ink-300/20" data-testid="private-chat-threads-list">
        <li
          v-for="th in threads"
          :key="th.id"
          class="px-3 py-2 cursor-pointer text-xs hover:bg-ink-300/10"
          :class="th.id === activeThreadId ? 'bg-ink-300/15' : ''"
          data-testid="private-chat-thread-row"
          @click="selectThread(th.id)"
        >
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="inline-block w-2 h-2 rounded-full"
              :class="th.peerOnline ? 'bg-emerald-400' : 'bg-ink-300/40'"
              :title="th.peerOnline ? t('social.online') : t('social.offline')"
            />
            <span class="truncate flex-1">
              {{ th.peerDisplayName ?? th.peerUserId }}
            </span>
          </div>
          <div class="text-[10px] text-ink-300/60 truncate">
            {{ th.peerUserId }}
          </div>
        </li>
      </ul>
    </aside>

    <!-- Active thread -->
    <div class="flex flex-col min-h-[300px]">
      <div
        v-if="!activeThread"
        class="flex-1 flex items-center justify-center text-sm text-ink-300/70"
        data-testid="private-chat-thread-none"
      >
        {{ t('chatPrivate.thread.none') }}
      </div>
      <template v-else>
        <div
          class="px-3 py-2 border-b border-ink-300/30 text-sm flex items-center gap-2"
        >
          <span
            class="inline-block w-2 h-2 rounded-full"
            :class="activeThread.peerOnline ? 'bg-emerald-400' : 'bg-ink-300/40'"
          />
          <span class="font-medium">
            {{ activeThread.peerDisplayName ?? activeThread.peerUserId }}
          </span>
          <span class="text-[10px] text-ink-300/60">{{ activeThread.peerUserId }}</span>
        </div>
        <div
          class="flex-1 overflow-y-auto px-3 py-2 space-y-1 text-sm"
          data-testid="private-chat-messages"
        >
          <div
            v-if="loadingMessages"
            class="text-xs text-ink-300"
            data-testid="private-chat-messages-loading"
          >
            {{ t('common.loading') }}
          </div>
          <div
            v-else-if="activeMessages.length === 0"
            class="text-xs text-ink-300/70"
            data-testid="private-chat-messages-empty"
          >
            {{ t('chatPrivate.thread.empty') }}
          </div>
          <div
            v-for="msg in activeMessages"
            v-else
            :key="msg.id"
            class="flex flex-col"
            data-testid="private-chat-message-row"
          >
            <div class="text-[10px] text-ink-300/60">
              {{ msg.senderDisplayName ?? msg.senderUserId }} ·
              {{ fmtTime(msg.createdAt) }}
            </div>
            <div class="break-words whitespace-pre-wrap">{{ msg.body }}</div>
          </div>
        </div>
        <form
          class="border-t border-ink-300/30 p-2 flex gap-2"
          data-testid="private-chat-send-form"
          @submit.prevent="onSend"
        >
          <input
            v-model="draft"
            type="text"
            :maxlength="SOCIAL_LIMITS.PRIVATE_MESSAGE_MAX + 50"
            class="flex-1 rounded border border-ink-300/40 bg-ink-800/60 px-3 py-2 text-sm"
            :placeholder="t('chatPrivate.thread.placeholder')"
            data-testid="private-chat-send-body"
          />
          <button
            type="submit"
            class="rounded border border-amber-400/60 px-4 py-2 text-xs uppercase tracking-widest text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
            :disabled="!canSend"
            data-testid="private-chat-send-submit"
          >
            {{ t('chatPrivate.thread.send') }}
          </button>
          <span
            v-if="draftLength > 0"
            class="text-[10px] text-ink-300/70 self-center"
            :class="draftOverLimit ? 'text-rose-300' : ''"
          >
            {{ draftLength }}/{{ SOCIAL_LIMITS.PRIVATE_MESSAGE_MAX }}
          </span>
        </form>
      </template>
    </div>
  </section>
</template>
