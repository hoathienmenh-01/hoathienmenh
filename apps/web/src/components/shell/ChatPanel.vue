<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { getCosmeticById } from '@xuantoi/shared';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import {
  chatHistory,
  chatSendSect,
  chatSendWorld,
  type ChatChannel,
  type ChatMessageView,
} from '@/api/chat';
import {
  fetchCosmeticProfile,
  type CosmeticLoadoutView,
} from '@/api/cosmetics';
import { on } from '@/ws/client';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const game = useGameStore();
const toast = useToastStore();
const { t } = useI18n();

const tab = ref<ChatChannel>('WORLD');
const worldMsgs = ref<ChatMessageView[]>([]);
const sectMsgs = ref<ChatMessageView[]>([]);
const text = ref('');
const sending = ref(false);
const scrollRoot = ref<HTMLElement | null>(null);

const inSect = computed(() => !!game.character?.sectId);
const currentSectId = computed(() => game.character?.sectId ?? null);

const visibleMsgs = computed(() =>
  tab.value === 'WORLD' ? worldMsgs.value : sectMsgs.value,
);

// Phase 25.3 — lazy cache of senderId → cosmetic loadout for chat badges
// + title rendering. Sender IDs in chat are character IDs (see chat.service.ts).
// We dedup fetches with an in-flight Map; loadouts never carry power, so it
// is safe to render without affecting combat data.
const cosmeticByCharacterId = reactive(new Map<string, CosmeticLoadoutView>());
const cosmeticFetching = new Set<string>();

function senderTitle(senderId: string) {
  const loadout = cosmeticByCharacterId.get(senderId);
  if (!loadout?.activeTitleId) return null;
  return getCosmeticById(loadout.activeTitleId);
}

function senderBadge(senderId: string) {
  const loadout = cosmeticByCharacterId.get(senderId);
  if (!loadout?.activeChatBadgeId) return null;
  return getCosmeticById(loadout.activeChatBadgeId);
}

async function ensureSenderCosmetics(senderId: string): Promise<void> {
  if (!senderId) return;
  if (cosmeticByCharacterId.has(senderId)) return;
  if (cosmeticFetching.has(senderId)) return;
  cosmeticFetching.add(senderId);
  try {
    const res = await fetchCosmeticProfile(senderId);
    cosmeticByCharacterId.set(senderId, res.loadout);
  } catch (e) {
    void e;
  } finally {
    cosmeticFetching.delete(senderId);
  }
}

function refreshSenderCosmetics(messages: readonly ChatMessageView[]): void {
  const unique = new Set<string>();
  for (const m of messages) unique.add(m.senderId);
  for (const id of unique) void ensureSenderCosmetics(id);
}

let unbindMsg: (() => void) | null = null;

async function loadHistory(channel: ChatChannel): Promise<void> {
  try {
    if (channel === 'WORLD') {
      worldMsgs.value = await chatHistory('WORLD');
      refreshSenderCosmetics(worldMsgs.value);
    } else if (currentSectId.value) {
      sectMsgs.value = await chatHistory('SECT');
      refreshSenderCosmetics(sectMsgs.value);
    }
    await scrollToBottom();
  } catch {
    /* im lặng */
  }
}

async function scrollToBottom(): Promise<void> {
  await nextTick();
  if (scrollRoot.value) scrollRoot.value.scrollTop = scrollRoot.value.scrollHeight;
}

async function send(): Promise<void> {
  const msg = text.value.trim();
  if (!msg || sending.value) return;
  sending.value = true;
  try {
    if (tab.value === 'WORLD') {
      await chatSendWorld(msg);
    } else if (inSect.value) {
      await chatSendSect(msg);
    }
    text.value = '';
  } catch (e) {
    handleErr(e);
  } finally {
    sending.value = false;
  }
}

function handleErr(e: unknown): void {
  const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  const key = `chat.errors.${code}`;
  const text = t(key, '__missing__');
  toast.push({
    type: 'error',
    text: text === '__missing__' ? t('chat.errors.UNKNOWN') : text,
  });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

onMounted(() => {
  void loadHistory('WORLD');
  unbindMsg = on<ChatMessageView>('chat:msg', (frame) => {
    const m = frame.payload;
    if (m.channel === 'WORLD') {
      worldMsgs.value = [...worldMsgs.value, m].slice(-200);
    } else if (m.channel === 'SECT' && m.scopeKey === currentSectId.value) {
      sectMsgs.value = [...sectMsgs.value, m].slice(-200);
    }
    void ensureSenderCosmetics(m.senderId);
    if (
      (m.channel === 'WORLD' && tab.value === 'WORLD') ||
      (m.channel === 'SECT' && tab.value === 'SECT')
    ) {
      void scrollToBottom();
    }
  });
});

onUnmounted(() => {
  unbindMsg?.();
});

watch(tab, async (v) => {
  if (v === 'SECT' && inSect.value && sectMsgs.value.length === 0) {
    await loadHistory('SECT');
  } else {
    await scrollToBottom();
  }
});

watch(currentSectId, async (id, prev) => {
  if (id !== prev) {
    sectMsgs.value = [];
    if (id && tab.value === 'SECT') await loadHistory('SECT');
  }
});
</script>

<template>
  <div class="flex flex-col h-full">
    <h3 class="text-xs uppercase tracking-widest text-ink-300 mb-2">{{ t('chat.title') }}</h3>
    <div class="flex gap-1 mb-2 text-xs">
      <button
        class="px-2 py-1 rounded"
        :class="tab === 'WORLD' ? 'bg-ink-50 text-ink-900' : 'bg-ink-700/60 text-ink-200'"
        @click="tab = 'WORLD'"
      >
        {{ t('chat.tab.world') }}
      </button>
      <button
        class="px-2 py-1 rounded"
        :class="tab === 'SECT' ? 'bg-ink-50 text-ink-900' : 'bg-ink-700/60 text-ink-200'"
        :disabled="!inSect"
        :title="inSect ? '' : t('chat.noSect')"
        @click="tab = 'SECT'"
      >
        {{ t('chat.tab.sect') }}
      </button>
    </div>
    <div
      ref="scrollRoot"
      class="flex-1 overflow-y-auto bg-ink-900/40 rounded p-2 text-xs space-y-1 min-h-[10rem]"
    >
      <div v-if="visibleMsgs.length === 0" class="text-ink-300/60 text-center py-4">
        <span v-if="tab === 'SECT' && !inSect">{{ t('chat.noSectShort') }}</span>
        <span v-else>{{ t('chat.empty') }}</span>
      </div>
      <div v-for="m in visibleMsgs" :key="m.id" class="leading-tight">
        <span class="text-ink-300/70">[{{ fmtTime(m.createdAt) }}]</span>
        <span
          v-if="senderBadge(m.senderId)"
          :class="senderBadge(m.senderId)!.cssClass"
          :data-testid="`chat-badge-${m.senderId}`"
        >{{ senderBadge(m.senderId)!.nameVi }}</span>
        <span
          v-if="senderTitle(m.senderId)"
          :class="senderTitle(m.senderId)!.cssClass"
          :data-testid="`chat-title-${m.senderId}`"
        >{{ senderTitle(m.senderId)!.nameVi }}</span>
        <span class="text-amber-300 mx-1">{{ m.senderName }}:</span>
        <span>{{ m.text }}</span>
      </div>
    </div>
    <form class="mt-2 flex gap-1" @submit.prevent="send">
      <input
        v-model="text"
        type="text"
        maxlength="200"
        class="flex-1 bg-ink-900/70 border border-ink-300/30 rounded px-2 py-1 text-xs"
        :placeholder="tab === 'WORLD' ? t('chat.placeholder.world') : t('chat.placeholder.sect')"
        :disabled="sending || (tab === 'SECT' && !inSect)"
      />
      <button
        type="submit"
        class="px-2 py-1 rounded bg-ink-50 text-ink-900 text-xs disabled:opacity-50"
        :disabled="sending || !text.trim() || (tab === 'SECT' && !inSect)"
      >
        {{ t('chat.send') }}
      </button>
    </form>
  </div>
</template>
