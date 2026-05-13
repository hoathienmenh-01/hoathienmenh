<script setup lang="ts">
/**
 * Phase 35.1 — Co-Cultivation / Hợp Luyện panel.
 *
 * Render:
 *   - "Hôm nay": sessionsCompleted / 3, totalBuffSeconds / 1800s, totalBonusExp.
 *   - "Phiên hiện tại" (PENDING / ACTIVE): partner + thời lượng + buff% +
 *     action accept (nếu là partner) / cancel / complete (nếu ACTIVE +
 *     là participant).
 *   - Form mời partner bằng `partnerUserId`.
 *   - "Lịch sử" (≤ 10 phiên gần nhất).
 *   - Loading / empty / error states + i18n.
 *
 * Server-authoritative — không nhận EXP/cap từ client. FE chỉ render
 * shape từ `/social/co-cultivation/*`.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import { CO_CULTIVATION_LIMITS } from '@xuantoi/shared';
import type {
  CoCultivationSessionRow,
  CoCultivationStatusResponse,
} from '@xuantoi/shared';
import {
  acceptCoCultivation,
  cancelCoCultivation,
  completeCoCultivation,
  getCoCultivationHistory,
  getCoCultivationStatus,
  requestCoCultivation,
} from '@/api/coCultivation';
import { useAuthStore } from '@/stores/auth';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const { t } = useI18n();
const toast = useToastStore();
const auth = useAuthStore();

const status = ref<CoCultivationStatusResponse | null>(null);
const history = ref<CoCultivationSessionRow[]>([]);
const loadingStatus = ref(true);
const loadingHistory = ref(true);
const errorMsg = ref('');

const partnerUserId = ref('');
const sending = ref(false);
const busySessionId = ref<string | null>(null);

const meUserId = computed(() => auth.user?.id ?? '');
const active = computed(() => status.value?.active ?? null);
const today = computed(() => status.value?.today ?? null);

const isPartner = computed(
  () => !!active.value && active.value.partnerUserId === meUserId.value,
);
const isInitiator = computed(
  () => !!active.value && active.value.initiatorUserId === meUserId.value,
);

async function refreshAll(): Promise<void> {
  await Promise.all([refreshStatus(), refreshHistory()]);
}

async function refreshStatus(): Promise<void> {
  loadingStatus.value = true;
  try {
    status.value = await getCoCultivationStatus();
    errorMsg.value = '';
  } catch (e) {
    errorMsg.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loadingStatus.value = false;
  }
}

async function refreshHistory(): Promise<void> {
  loadingHistory.value = true;
  try {
    const res = await getCoCultivationHistory({ limit: 10 });
    history.value = [...res.sessions];
  } catch (e) {
    errorMsg.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loadingHistory.value = false;
  }
}

async function send(): Promise<void> {
  const id = partnerUserId.value.trim();
  if (id.length === 0) return;
  sending.value = true;
  try {
    await requestCoCultivation({ partnerUserId: id });
    partnerUserId.value = '';
    toast.push({
      type: 'success',
      text: t('coCultivation.requestSent'),
    });
    await refreshAll();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`coCultivation.errors.${code}`, code),
    });
  } finally {
    sending.value = false;
  }
}

async function accept(id: string): Promise<void> {
  busySessionId.value = id;
  try {
    await acceptCoCultivation(id);
    toast.push({ type: 'success', text: t('coCultivation.accepted') });
    await refreshAll();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`coCultivation.errors.${code}`, code),
    });
  } finally {
    busySessionId.value = null;
  }
}

async function cancel(id: string): Promise<void> {
  busySessionId.value = id;
  try {
    await cancelCoCultivation(id);
    toast.push({ type: 'success', text: t('coCultivation.cancelled') });
    await refreshAll();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`coCultivation.errors.${code}`, code),
    });
  } finally {
    busySessionId.value = null;
  }
}

async function complete(id: string): Promise<void> {
  busySessionId.value = id;
  try {
    await completeCoCultivation(id);
    toast.push({ type: 'success', text: t('coCultivation.completed') });
    await refreshAll();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`coCultivation.errors.${code}`, code),
    });
  } finally {
    busySessionId.value = null;
  }
}

onMounted(refreshAll);

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}
</script>

<template>
  <section class="space-y-4" data-testid="co-cultivation-panel">
    <header class="space-y-1">
      <h2 class="text-lg tracking-widest text-amber-200">
        {{ t('coCultivation.title') }}
      </h2>
      <p class="text-xs text-ink-300/80">
        {{ t('coCultivation.subtitle') }}
      </p>
    </header>

    <!-- Today usage -->
    <div
      class="rounded border border-ink-300/30 p-3 text-xs grid grid-cols-1 sm:grid-cols-3 gap-2"
      data-testid="co-cult-today"
    >
      <div v-if="loadingStatus" class="col-span-full text-ink-300/60">
        {{ t('common.loading') }}…
      </div>
      <template v-else-if="today">
        <div>
          <div class="uppercase text-ink-300/60">
            {{ t('coCultivation.today.sessions') }}
          </div>
          <div class="text-amber-200">
            {{ today.sessionsCompleted }} /
            {{ CO_CULTIVATION_LIMITS.DAILY_SESSIONS_CAP }}
          </div>
        </div>
        <div>
          <div class="uppercase text-ink-300/60">
            {{ t('coCultivation.today.buffSeconds') }}
          </div>
          <div class="text-amber-200">
            {{ today.totalBuffSeconds }} /
            {{ CO_CULTIVATION_LIMITS.DAILY_BUFF_SECONDS_CAP }}s
          </div>
        </div>
        <div>
          <div class="uppercase text-ink-300/60">
            {{ t('coCultivation.today.bonusExp') }}
          </div>
          <div class="text-amber-200">{{ today.totalBonusExp }} EXP</div>
        </div>
      </template>
    </div>

    <!-- Active / pending session -->
    <div
      class="rounded border border-ink-300/30 p-3 text-xs space-y-2"
      data-testid="co-cult-active"
    >
      <div class="uppercase text-ink-300/60">
        {{ t('coCultivation.active.title') }}
      </div>
      <div v-if="loadingStatus" class="text-ink-300/60">
        {{ t('common.loading') }}…
      </div>
      <div v-else-if="!active" class="text-ink-300/60" data-testid="co-cult-empty">
        {{ t('coCultivation.active.empty') }}
      </div>
      <div v-else class="space-y-1">
        <div>
          <span class="text-ink-300/60"
          >{{ t('coCultivation.active.partner') }}:</span
          >
          <span class="ml-1 text-amber-200">{{
            isInitiator ? active.partnerUserId : active.initiatorUserId
          }}</span>
        </div>
        <div>
          <span class="text-ink-300/60"
          >{{ t('coCultivation.active.status') }}:</span
          >
          <span class="ml-1 text-amber-200">{{ active.status }}</span>
        </div>
        <div>
          <span class="text-ink-300/60"
          >{{ t('coCultivation.active.duration') }}:</span
          >
          <span class="ml-1 text-amber-200">{{ active.durationSec }}s</span>
          <span class="ml-2 text-ink-300/60"
          >({{ active.buffPercent }}% buff)</span
          >
        </div>
        <div class="flex flex-wrap gap-2 pt-1">
          <button
            v-if="isPartner && active.status === 'PENDING'"
            type="button"
            class="px-2 py-1 border border-emerald-500/40 text-emerald-300 uppercase tracking-widest"
            :disabled="busySessionId === active.id"
            data-testid="co-cult-accept"
            @click="accept(active.id)"
          >
            {{ t('coCultivation.action.accept') }}
          </button>
          <button
            v-if="active.status === 'ACTIVE'"
            type="button"
            class="px-2 py-1 border border-amber-400/60 text-amber-200 uppercase tracking-widest"
            :disabled="busySessionId === active.id"
            data-testid="co-cult-complete"
            @click="complete(active.id)"
          >
            {{ t('coCultivation.action.complete') }}
          </button>
          <button
            type="button"
            class="px-2 py-1 border border-rose-500/40 text-rose-300 uppercase tracking-widest"
            :disabled="busySessionId === active.id"
            data-testid="co-cult-cancel"
            @click="cancel(active.id)"
          >
            {{ t('coCultivation.action.cancel') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Send form (only when no active session) -->
    <form
      v-if="!active"
      class="rounded border border-ink-300/30 p-3 space-y-2"
      data-testid="co-cult-send-form"
      @submit.prevent="send"
    >
      <label class="block text-xs uppercase text-ink-300/60">
        {{ t('coCultivation.send.partner') }}
      </label>
      <input
        v-model="partnerUserId"
        type="text"
        :placeholder="t('coCultivation.send.placeholder')"
        class="w-full bg-ink-900 border border-ink-300/40 px-2 py-1 text-xs"
        :disabled="sending"
        data-testid="co-cult-partner-input"
      />
      <button
        type="submit"
        class="px-3 py-1 border border-amber-400/60 text-amber-200 text-xs uppercase tracking-widest"
        :disabled="sending || partnerUserId.trim().length === 0"
        data-testid="co-cult-send"
      >
        {{ t('coCultivation.send.action') }}
      </button>
    </form>

    <!-- History -->
    <div
      class="rounded border border-ink-300/30 p-3 text-xs space-y-2"
      data-testid="co-cult-history"
    >
      <div class="uppercase text-ink-300/60">
        {{ t('coCultivation.history.title') }}
      </div>
      <div v-if="loadingHistory" class="text-ink-300/60">
        {{ t('common.loading') }}…
      </div>
      <div
        v-else-if="history.length === 0"
        class="text-ink-300/60"
        data-testid="co-cult-history-empty"
      >
        {{ t('coCultivation.history.empty') }}
      </div>
      <ul v-else class="divide-y divide-ink-300/20">
        <li
          v-for="row in history"
          :key="row.id"
          class="py-1 flex flex-wrap gap-x-3 items-baseline"
        >
          <span class="text-amber-200">{{ row.status }}</span>
          <span class="text-ink-300/70 truncate">
            {{ row.initiatorUserId === meUserId
              ? row.partnerUserId
              : row.initiatorUserId }}
          </span>
          <span class="text-ink-300/50">{{ row.durationSec }}s</span>
          <span class="text-ink-300/50">{{ row.buffPercent }}%</span>
          <span class="text-ink-300/50 ml-auto">{{
            fmtTime(row.completedAt ?? row.createdAt)
          }}</span>
        </li>
      </ul>
    </div>

    <div
      v-if="errorMsg"
      class="text-xs text-rose-300"
      data-testid="co-cult-error"
    >
      {{ errorMsg }}
    </div>
  </section>
</template>
