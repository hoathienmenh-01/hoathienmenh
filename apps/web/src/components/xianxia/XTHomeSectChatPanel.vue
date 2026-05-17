<script setup lang="ts">
/**
 * Cửu Thiên Mộng — `XTHomeSectChatPanel` (UI-3.2 sect + chat panel).
 *
 * Panel "Tông môn & Đạo hữu":
 *   - header: tên tông + cấp tông + thành viên + nút "Vào tông môn".
 *   - chat messages preview của kênh SECT (load real history qua
 *     `chatHistory('SECT')`, subscribe WS `chat:msg` cho live update).
 *   - ô nhập + nút "Gửi": gửi qua `chatSendSect`.
 *   - Khi player chưa gia nhập tông môn → input disabled + empty state
 *     "Chưa thuộc tông môn nào", **không** dùng mock chat trong player Home.
 *   - Loading / error state nhẹ nhàng (toast cho error qua `useToastStore`).
 *
 * Pattern reference: `apps/web/src/components/shell/ChatPanel.vue` (đã wire
 * world + sect chat full pipeline). Panel này là biến thể compact dành cho
 * Home dashboard.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import {
  chatHistory,
  chatSendSect,
  type ChatMessageView,
} from '@/api/chat';
import { on } from '@/ws/client';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

interface SectPanelInfo {
  title: string;
  sectName: string;
  sectLevel: number | string;
  members: string;
}

const props = withDefaults(
  defineProps<{
    info?: SectPanelInfo;
    /**
     * Override messages (dev/demo preview). Khi không truyền (default),
     * panel tự load real chat history qua `chatHistory('SECT')` + WS.
     */
    messages?: ChatMessageView[] | null;
    compact?: boolean;
    testId?: string;
  }>(),
  {
    info: () => ({
      title: 'Tông môn & Đạo hữu',
      sectName: 'Chưa gia nhập tông môn',
      sectLevel: 0,
      members: '0',
    }),
    messages: null,
    compact: false,
    testId: 'home-sect-chat-panel',
  },
);

const router = useRouter();
const { t } = useI18n();
const game = useGameStore();
const toast = useToastStore();

const inSect = computed(() => !!game.character?.sectId);
const currentSectId = computed(() => game.character?.sectId ?? null);

const liveMessages = ref<ChatMessageView[]>([]);
const loading = ref(false);
const sending = ref(false);
const draft = ref('');

/**
 * Khi `messages` prop được truyền (dev/demo) → render preview override.
 * Mặc định → dùng `liveMessages` đọc từ API + WS.
 */
const visibleMessages = computed<ChatMessageView[]>(() => {
  if (props.messages && props.messages.length > 0) return props.messages;
  return liveMessages.value;
});

let unbindMsg: (() => void) | null = null;

async function loadHistory(): Promise<void> {
  if (!inSect.value) {
    liveMessages.value = [];
    return;
  }
  loading.value = true;
  try {
    liveMessages.value = await chatHistory('SECT');
  } catch {
    // silent — UI sẽ hiện empty state thay vì crash
  } finally {
    loading.value = false;
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

async function onSubmit(e: Event): Promise<void> {
  e.preventDefault();
  const msg = draft.value.trim();
  if (!msg || sending.value || !inSect.value) return;
  sending.value = true;
  try {
    await chatSendSect(msg);
    draft.value = '';
    // Không append local — chờ WS `chat:msg` echo về để giữ thứ tự server.
  } catch (err) {
    handleErr(err);
  } finally {
    sending.value = false;
  }
}

function openSect(): void {
  router.push('/sect').catch(() => null);
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

onMounted(() => {
  void loadHistory();
  unbindMsg = on<ChatMessageView>('chat:msg', (frame) => {
    const m = frame.payload;
    if (m.channel !== 'SECT') return;
    if (currentSectId.value && m.scopeKey !== currentSectId.value) return;
    liveMessages.value = [...liveMessages.value, m].slice(-200);
  });
});

onUnmounted(() => {
  unbindMsg?.();
});
</script>

<template>
  <section
    class="xt-home-sect"
    :class="{ 'xt-home-sect--compact': compact }"
    :data-testid="testId"
    role="region"
    aria-label="Tông môn và chat"
  >
    <header class="xt-home-sect__header">
      <p class="xt-home-sect__eyebrow">Tông môn</p>
      <h2 class="xt-home-sect__title">{{ info.title }}</h2>
      <button
        type="button"
        class="xt-home-sect__cta"
        :data-testid="`${testId}-cta`"
        @click="openSect"
      >
        Vào tông môn <span aria-hidden="true">→</span>
      </button>
    </header>

    <div class="xt-home-sect__info">
      <div class="xt-home-sect__seal" aria-hidden="true">
        <span>⛩</span>
      </div>
      <dl class="xt-home-sect__meta">
        <div class="xt-home-sect__meta-row">
          <dt>Tông môn</dt>
          <dd>{{ info.sectName }}</dd>
        </div>
        <div class="xt-home-sect__meta-row">
          <dt>Cấp tông</dt>
          <dd>{{ info.sectLevel }}</dd>
        </div>
        <div class="xt-home-sect__meta-row">
          <dt>Thành viên</dt>
          <dd>{{ info.members }}</dd>
        </div>
      </dl>
    </div>

    <ul
      v-if="inSect && visibleMessages.length > 0"
      class="xt-home-sect__messages"
      :data-testid="`${testId}-messages`"
    >
      <li
        v-for="msg in visibleMessages"
        :key="msg.id"
        class="xt-home-sect__msg"
        :data-testid="`${testId}-msg-${msg.id}`"
      >
        <span class="xt-home-sect__avatar" aria-hidden="true">☯</span>
        <div class="xt-home-sect__msg-body">
          <div class="xt-home-sect__msg-meta">
            <span class="xt-home-sect__msg-author">{{ msg.senderName }}</span>
            <span class="xt-home-sect__msg-time">{{ fmtTime(msg.createdAt) }}</span>
          </div>
          <p class="xt-home-sect__msg-text">{{ msg.text }}</p>
        </div>
      </li>
    </ul>
    <div
      v-else
      class="xt-home-sect__empty"
      :data-testid="`${testId}-empty`"
    >
      <p v-if="loading">{{ t('chat.empty') }}</p>
      <p v-else-if="!inSect">{{ t('chat.noSectShort') }}</p>
      <p v-else>{{ t('chat.empty') }}</p>
    </div>

    <form class="xt-home-sect__form" @submit="onSubmit">
      <label class="sr-only" :for="`${testId}-input`">{{ t('chat.placeholder.sect') }}</label>
      <input
        :id="`${testId}-input`"
        v-model="draft"
        type="text"
        maxlength="200"
        class="xt-home-sect__input"
        :placeholder="t('chat.placeholder.sect')"
        autocomplete="off"
        :disabled="!inSect || sending"
        :data-testid="`${testId}-input`"
      />
      <button
        type="submit"
        class="xt-home-sect__send"
        :data-testid="`${testId}-send`"
        :disabled="!inSect || !draft.trim() || sending"
        :aria-label="t('chat.sendSect', 'Gửi tông môn')"
      >{{ t('chat.send') }}</button>
    </form>
  </section>
</template>

<style scoped>
.xt-home-sect {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(20, 28, 38, 0.86) 0%, rgba(8, 9, 11, 0.96) 100%);
  border: 1px solid rgba(242, 215, 137, 0.32);
  box-shadow: 0 18px 32px rgba(0, 0, 0, 0.42);
  color: var(--xt-text-primary, #f0e6cc);
  min-width: 0;
}

.xt-home-sect::before {
  content: '';
  position: absolute;
  inset: 6px;
  border-radius: 14px;
  border: 1px solid rgba(242, 215, 137, 0.1);
  pointer-events: none;
}

.xt-home-sect__header {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 4px 12px;
}

.xt-home-sect__eyebrow {
  grid-column: 1 / 2;
  margin: 0;
  font-family: var(--xt-font-decorative), serif;
  font-size: 10px;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--xt-jade-bright, #5fe3c6);
}

.xt-home-sect__title {
  grid-column: 1 / 2;
  margin: 0;
  font-family: var(--xt-font-display), serif;
  font-size: 18px;
  letter-spacing: 0.06em;
  background: linear-gradient(180deg, #fff6e0 0%, var(--xt-gold-bright, #f2d789) 100%);
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}

.xt-home-sect__cta {
  grid-column: 2 / 3;
  grid-row: 1 / 3;
  align-self: end;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid rgba(95, 227, 198, 0.55);
  background: linear-gradient(180deg, rgba(27, 59, 52, 0.85) 0%, rgba(12, 30, 26, 0.95) 100%);
  color: var(--xt-jade-bright, #5fe3c6);
  font-family: var(--xt-font-body);
  font-size: 11px;
  letter-spacing: 0.12em;
  cursor: pointer;
}

.xt-home-sect__cta:hover {
  border-color: rgba(95, 227, 198, 0.9);
  box-shadow: 0 0 14px rgba(95, 227, 198, 0.32);
}

.xt-home-sect__cta:focus-visible {
  outline: 2px solid rgba(95, 227, 198, 0.6);
  outline-offset: 2px;
}

.xt-home-sect__info {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 12px;
  padding: 10px;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(28, 36, 46, 0.82) 0%, rgba(12, 16, 20, 0.92) 100%);
  border: 1px solid rgba(95, 227, 198, 0.32);
  align-items: center;
}

.xt-home-sect__seal {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 50% 30%, rgba(95, 227, 198, 0.4) 0%, rgba(8, 9, 11, 0.95) 70%);
  border: 1px solid rgba(95, 227, 198, 0.55);
  color: var(--xt-jade-bright, #5fe3c6);
  font-size: 22px;
  box-shadow: inset 0 0 8px rgba(95, 227, 198, 0.18);
}

.xt-home-sect__meta {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px 12px;
}

.xt-home-sect__meta-row {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}

.xt-home-sect__meta-row dt {
  margin: 0;
  font-size: 9px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.68));
}

.xt-home-sect__meta-row dd {
  margin: 1px 0 0;
  font-family: var(--xt-font-decorative), serif;
  font-size: 13px;
  letter-spacing: 0.05em;
  color: var(--xt-gold-bright, #f2d789);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.xt-home-sect__messages {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 auto;
  overflow-y: auto;
  max-height: 180px;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color: rgba(242, 215, 137, 0.3) transparent;
}

.xt-home-sect__messages::-webkit-scrollbar { width: 4px; }
.xt-home-sect__messages::-webkit-scrollbar-thumb {
  background: rgba(242, 215, 137, 0.3);
  border-radius: 4px;
}

.xt-home-sect__msg {
  display: grid;
  grid-template-columns: 32px 1fr;
  gap: 8px;
  padding: 8px;
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(28, 36, 46, 0.7) 0%, rgba(12, 16, 20, 0.85) 100%);
  border: 1px solid rgba(242, 215, 137, 0.18);
}

.xt-home-sect__avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: radial-gradient(circle at 30% 30%, rgba(95, 227, 198, 0.3), rgba(8, 9, 11, 0.95));
  border: 1px solid rgba(242, 215, 137, 0.45);
  color: var(--xt-jade-bright, #5fe3c6);
  font-size: 14px;
}

.xt-home-sect__msg-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.xt-home-sect__msg-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: baseline;
}

.xt-home-sect__msg-author {
  font-family: var(--xt-font-display), serif;
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--xt-gold-bright, #f2d789);
}

.xt-home-sect__msg-time {
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.65));
  font-variant-numeric: tabular-nums;
}

.xt-home-sect__msg-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.35;
  color: var(--xt-text-soft, #d8d0bf);
  word-wrap: break-word;
}

.xt-home-sect__empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(8, 9, 11, 0.5);
  border: 1px dashed rgba(242, 215, 137, 0.2);
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.6));
  font-size: 12px;
  text-align: center;
}

.xt-home-sect__empty p {
  margin: 0;
}

.xt-home-sect__form {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px;
}

.xt-home-sect__input {
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(8, 9, 11, 0.85);
  border: 1px solid rgba(242, 215, 137, 0.35);
  color: var(--xt-text-primary, #f0e6cc);
  font-family: var(--xt-font-body);
  font-size: 13px;
}

.xt-home-sect__input::placeholder {
  color: var(--xt-text-muted, rgba(208, 200, 180, 0.5));
}

.xt-home-sect__input:focus-visible {
  outline: 2px solid rgba(95, 227, 198, 0.55);
  outline-offset: 2px;
  border-color: rgba(242, 215, 137, 0.8);
}

.xt-home-sect__input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.xt-home-sect__send {
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid rgba(242, 215, 137, 0.6);
  background: linear-gradient(180deg, var(--xt-gold-bright, #f2d789) 0%, #b8893a 100%);
  color: #1a1208;
  font-family: var(--xt-font-decorative), serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform var(--xt-motion-fast, 140ms) ease,
              box-shadow var(--xt-motion-base, 220ms) ease;
}

.xt-home-sect__send:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 0 14px rgba(242, 215, 137, 0.42);
}

.xt-home-sect__send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 480px) {
  .xt-home-sect__meta {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (prefers-reduced-motion: reduce) {
  .xt-home-sect__send {
    transition: none;
  }
  .xt-home-sect__send:hover:not(:disabled) {
    transform: none;
  }
}
</style>
