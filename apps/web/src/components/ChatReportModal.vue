<script setup lang="ts">
/**
 * Phase 19.2 — ChatReportModal.
 *
 * User-facing modal cho phép report 1 message private/group vi phạm.
 * Hiển thị:
 *   - Reason dropdown (i18n key `chatReport.reason.<KEY>`) — bắt buộc.
 *   - Details textarea (optional, max 500 ký tự).
 *   - Submit / Cancel.
 *
 * Server-authoritative invariants (xem `ChatModerationService`):
 *   - User chỉ report được message mình có quyền nhìn thấy (member
 *     thread/group). Non-member → 404 mask.
 *   - Duplicate report → 409 DUPLICATE_REPORT.
 *   - Reason invalid → 400 INVALID_INPUT.
 *   - Details quá dài → server tự sanitize/truncate (cap 500).
 *
 * Rate limit: `CHAT_REPORT_SUBMIT` (10/h user, block 10 min). FE chỉ
 * surface code → toast i18n; KHÔNG tự rate-limit.
 *
 * FE chỉ surface error code → toast i18n; KHÔNG hard-code literal status
 * hay reason string.
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import { submitChatReport } from '@/api/chatModeration';
import {
  CHAT_MESSAGE_REPORT_REASONS,
  CHAT_MODERATION_LIMITS,
  type ChatMessageReportReason,
  type ChatMessageReportType,
} from '@xuantoi/shared';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

interface Props {
  open: boolean;
  /** PRIVATE | GROUP — quyết định payload field nào sẽ được set. */
  messageType: ChatMessageReportType;
  /** Required khi messageType=PRIVATE. */
  privateMessageId?: string | null;
  /** Required khi messageType=GROUP. */
  groupMessageId?: string | null;
  /** Optional preview text hiển thị xác nhận trong modal. */
  messagePreview?: string | null;
}

const props = withDefaults(defineProps<Props>(), {
  privateMessageId: null,
  groupMessageId: null,
  messagePreview: null,
});

const emit = defineEmits<{
  (e: 'submitted'): void;
  (e: 'cancel'): void;
}>();

const { t } = useI18n();
const toast = useToastStore();

const reason = ref<ChatMessageReportReason>('SPAM');
const details = ref('');
const submitting = ref(false);

const detailsMax = CHAT_MODERATION_LIMITS.REPORT_DETAILS_MAX;
const reasons = CHAT_MESSAGE_REPORT_REASONS;

const detailsLen = computed(() => details.value.length);
const detailsOverLimit = computed(() => detailsLen.value > detailsMax);
const canSubmit = computed(
  () => !submitting.value && !detailsOverLimit.value,
);

watch(
  () => props.open,
  (open) => {
    if (open) {
      // Reset form mỗi lần mở modal — tránh leak state report cũ.
      reason.value = 'SPAM';
      details.value = '';
      submitting.value = false;
    }
  },
);

function tShortError(code: string): string {
  const key = `chatReport.errors.${code}`;
  const v = t(key, '__missing__');
  return v === '__missing__' ? t('chatReport.errors.UNKNOWN') : v;
}

async function onSubmit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    await submitChatReport({
      messageType: props.messageType,
      privateMessageId:
        props.messageType === 'PRIVATE' ? props.privateMessageId : null,
      groupMessageId:
        props.messageType === 'GROUP' ? props.groupMessageId : null,
      reason: reason.value,
      detailsText: details.value.trim() || null,
    });
    toast.push({
      type: 'success',
      text: t('chatReport.toast.submitted'),
    });
    emit('submitted');
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: tShortError(code) });
  } finally {
    submitting.value = false;
  }
}

function onCancel(): void {
  if (submitting.value) return;
  emit('cancel');
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="chat-report-modal"
      @click.self="onCancel"
    >
      <div
        role="dialog"
        aria-modal="true"
        class="bg-ink-700 border border-ink-300/30 rounded-lg shadow-2xl max-w-md w-[90vw] p-5 space-y-4"
      >
        <header>
          <h2 class="text-lg font-semibold text-amber-200">
            {{ t('chatReport.title') }}
          </h2>
          <p class="text-xs text-ink-300/80 mt-1">
            {{ t('chatReport.subtitle') }}
          </p>
        </header>

        <div
          v-if="messagePreview"
          class="rounded border border-ink-300/30 bg-ink-800/60 px-3 py-2 text-xs whitespace-pre-wrap break-words"
          data-testid="chat-report-message-preview"
        >
          {{ messagePreview }}
        </div>

        <form class="space-y-3" @submit.prevent="onSubmit">
          <label class="block text-xs uppercase tracking-widest text-ink-300">
            {{ t('chatReport.field.reason') }}
            <select
              v-model="reason"
              class="mt-1 w-full rounded border border-ink-300/40 bg-ink-800/60 px-2 py-1 text-sm"
              data-testid="chat-report-reason"
              :disabled="submitting"
            >
              <option v-for="r in reasons" :key="r" :value="r">
                {{ t(`chatReport.reason.${r}`) }}
              </option>
            </select>
          </label>

          <label class="block text-xs uppercase tracking-widest text-ink-300">
            {{ t('chatReport.field.details') }}
            <textarea
              v-model="details"
              rows="3"
              :maxlength="detailsMax + 50"
              class="mt-1 w-full rounded border border-ink-300/40 bg-ink-800/60 px-2 py-1 text-sm"
              :placeholder="t('chatReport.field.detailsPlaceholder')"
              data-testid="chat-report-details"
              :disabled="submitting"
            />
            <div class="flex justify-end mt-1">
              <span
                class="text-[10px]"
                :class="detailsOverLimit ? 'text-rose-300' : 'text-ink-300/70'"
                data-testid="chat-report-details-counter"
              >
                {{ detailsLen }}/{{ detailsMax }}
              </span>
            </div>
          </label>

          <div class="flex justify-end gap-2 pt-2">
            <button
              type="button"
              class="rounded border border-ink-300/40 px-3 py-1 text-xs uppercase tracking-widest text-ink-200 hover:bg-ink-300/10 disabled:opacity-50"
              :disabled="submitting"
              data-testid="chat-report-cancel"
              @click="onCancel"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              type="submit"
              class="rounded border border-amber-400/60 px-4 py-1 text-xs uppercase tracking-widest text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
              :disabled="!canSubmit"
              data-testid="chat-report-submit"
            >
              {{ t('chatReport.submit') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
