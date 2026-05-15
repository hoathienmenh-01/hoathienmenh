<script setup lang="ts">
/**
 * Phase 19.2 — AdminChatModerationPanel.
 *
 * Render:
 *   - Summary cards: openReports / acknowledged / resolvedToday /
 *     mutedUsers / hiddenMessages / lockedGroups.
 *   - Filter (status / reason / messageType / target/reporter userId).
 *   - Table reports với Ack + Resolve (RESOLVED / REJECTED + note).
 *   - Table mutes active filter scope + Revoke.
 *   - Inline actions: Hide message / Unhide / Lock/Unlock group /
 *     Dissolve group — chỉ admin (BE đã `@RequireAdmin()`; MOD bị 403
 *     khi mutate, FE chỉ surface error).
 *
 * Server-authoritative invariants (xem `ChatModerationService`):
 *   - Mọi mutation ghi AdminAuditLog (`ADMIN_CHAT_MODERATION_*`).
 *   - Mute scope ALL_CHAT cover mọi target scope.
 *   - Soft-hide message (không hard-delete) — preserve audit trail.
 *   - Group lock = cấm send; dissolve = soft-delete.
 *
 * Detection-only? KHÔNG — đây là enforcement panel (mute / hide /
 * lock / dissolve thay đổi state). Detection (report list) là 1 phần,
 * còn lại là action.
 *
 * Gate: role=ADMIN (parent AdminView guard). MOD chỉ thấy read; BE
 * reject mutation với 403 — FE surface qua toast.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  adminAckChatReport,
  adminChatModerationSummary,
  adminCreateChatMute,
  adminDissolveChatGroup,
  adminHideChatMessage,
  adminListChatMutes,
  adminListChatReports,
  adminLockChatGroup,
  adminResolveChatReport,
  adminRevokeChatMute,
  adminUnhideChatMessage,
  adminUnlockChatGroup,
} from '@/api/chatModeration';
import {
  CHAT_MESSAGE_REPORT_REASONS,
  CHAT_MESSAGE_REPORT_STATUSES,
  CHAT_MESSAGE_REPORT_TYPES,
  CHAT_MUTE_SCOPES,
  type AdminChatModerationSummary,
  type AdminChatReportListItem,
  type ChatMessageReportReason,
  type ChatMessageReportStatus,
  type ChatMessageReportType,
  type ChatMuteRow,
  type ChatMuteScope,
} from '@xuantoi/shared';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const { t } = useI18n();
const toast = useToastStore();

// ---------- summary ----------
const summary = ref<AdminChatModerationSummary | null>(null);
const loadingSummary = ref(true);
const errorSummary = ref<string | null>(null);

// ---------- reports ----------
const reports = ref<AdminChatReportListItem[]>([]);
const reportTotal = ref(0);
const loadingReports = ref(false);
const errorReports = ref<string | null>(null);

const filters = ref<{
  status: ChatMessageReportStatus | '';
  reason: ChatMessageReportReason | '';
  messageType: ChatMessageReportType | '';
  reporterUserId: string;
  targetUserId: string;
}>({
  status: 'OPEN',
  reason: '',
  messageType: '',
  reporterUserId: '',
  targetUserId: '',
});

// ---------- mutes ----------
const mutes = ref<ChatMuteRow[]>([]);
const muteTotal = ref(0);
const loadingMutes = ref(false);
const errorMutes = ref<string | null>(null);

const muteFilters = ref<{
  userId: string;
  scope: ChatMuteScope | '';
  activeOnly: boolean;
}>({
  userId: '',
  scope: '',
  activeOnly: true,
});

// ---------- create-mute form ----------
const muteFormUserId = ref('');
const muteFormScope = ref<ChatMuteScope>('ALL_CHAT');
const muteFormReason = ref('');
const muteFormExpiresAt = ref('');
const muteFormSubmitting = ref(false);

// ---------- enums ----------
const STATUSES = CHAT_MESSAGE_REPORT_STATUSES;
const REASONS = CHAT_MESSAGE_REPORT_REASONS;
const TYPES = CHAT_MESSAGE_REPORT_TYPES;
const SCOPES = CHAT_MUTE_SCOPES;

onMounted(async () => {
  await Promise.all([refreshSummary(), refreshReports(), refreshMutes()]);
});

async function refreshSummary(): Promise<void> {
  loadingSummary.value = true;
  errorSummary.value = null;
  try {
    summary.value = await adminChatModerationSummary();
  } catch (e) {
    errorSummary.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loadingSummary.value = false;
  }
}

async function refreshReports(): Promise<void> {
  loadingReports.value = true;
  errorReports.value = null;
  try {
    const r = await adminListChatReports({
      status: filters.value.status || undefined,
      reason: filters.value.reason || undefined,
      messageType: filters.value.messageType || undefined,
      reporterUserId: filters.value.reporterUserId.trim() || undefined,
      targetUserId: filters.value.targetUserId.trim() || undefined,
      limit: 50,
    });
    reports.value = r.items;
    reportTotal.value = r.total;
  } catch (e) {
    errorReports.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loadingReports.value = false;
  }
}

async function refreshMutes(): Promise<void> {
  loadingMutes.value = true;
  errorMutes.value = null;
  try {
    const r = await adminListChatMutes({
      userId: muteFilters.value.userId.trim() || undefined,
      scope: muteFilters.value.scope || undefined,
      activeOnly: muteFilters.value.activeOnly,
      limit: 50,
    });
    mutes.value = r.items;
    muteTotal.value = r.total;
  } catch (e) {
    errorMutes.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loadingMutes.value = false;
  }
}

function tShortError(code: string): string {
  const key = `admin.chatModeration.errors.${code}`;
  const v = t(key, '__missing__');
  return v === '__missing__'
    ? t('admin.chatModeration.errors.UNKNOWN')
    : v;
}

function notifyErr(e: unknown): void {
  const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  toast.push({ type: 'error', text: tShortError(code) });
}

async function ackReport(id: string): Promise<void> {
  if (!confirm(t('admin.chatModeration.confirm.ack'))) return;
  try {
    await adminAckChatReport(id);
    toast.push({ type: 'success', text: t('admin.chatModeration.toast.ack') });
    await Promise.all([refreshSummary(), refreshReports()]);
  } catch (e) {
    notifyErr(e);
  }
}

async function resolveReport(
  id: string,
  status: 'RESOLVED' | 'REJECTED',
): Promise<void> {
  const confirmKey =
    status === 'RESOLVED'
      ? 'admin.chatModeration.confirm.resolve'
      : 'admin.chatModeration.confirm.reject';
  if (!confirm(t(confirmKey))) return;
  const noteRaw = window.prompt(t('admin.chatModeration.prompt.note'));
  if (noteRaw === null) return; // user huỷ
  try {
    await adminResolveChatReport(id, status, noteRaw.trim() || null);
    toast.push({
      type: 'success',
      text:
        status === 'RESOLVED'
          ? t('admin.chatModeration.toast.resolve')
          : t('admin.chatModeration.toast.reject'),
    });
    await Promise.all([refreshSummary(), refreshReports()]);
  } catch (e) {
    notifyErr(e);
  }
}

async function hideMessage(item: AdminChatReportListItem): Promise<void> {
  if (!confirm(t('admin.chatModeration.confirm.hide'))) return;
  const reasonRaw = window.prompt(t('admin.chatModeration.prompt.hideReason'));
  if (reasonRaw === null) return;
  const messageId =
    item.messageType === 'PRIVATE'
      ? item.privateMessageId
      : item.groupMessageId;
  if (!messageId) {
    toast.push({
      type: 'error',
      text: tShortError('NOT_FOUND'),
    });
    return;
  }
  try {
    await adminHideChatMessage(
      item.messageType,
      messageId,
      reasonRaw.trim() || null,
    );
    toast.push({ type: 'success', text: t('admin.chatModeration.toast.hide') });
    await Promise.all([refreshSummary(), refreshReports()]);
  } catch (e) {
    notifyErr(e);
  }
}

async function unhideMessage(item: AdminChatReportListItem): Promise<void> {
  if (!confirm(t('admin.chatModeration.confirm.unhide'))) return;
  const messageId =
    item.messageType === 'PRIVATE'
      ? item.privateMessageId
      : item.groupMessageId;
  if (!messageId) return;
  try {
    await adminUnhideChatMessage(item.messageType, messageId);
    toast.push({
      type: 'success',
      text: t('admin.chatModeration.toast.unhide'),
    });
    await Promise.all([refreshSummary(), refreshReports()]);
  } catch (e) {
    notifyErr(e);
  }
}

async function lockGroup(groupId: string): Promise<void> {
  if (!confirm(t('admin.chatModeration.confirm.lock'))) return;
  const reasonRaw = window.prompt(
    t('admin.chatModeration.prompt.lockReason'),
  );
  if (reasonRaw === null) return;
  try {
    await adminLockChatGroup(groupId, reasonRaw.trim() || null);
    toast.push({ type: 'success', text: t('admin.chatModeration.toast.lock') });
    await Promise.all([refreshSummary(), refreshReports()]);
  } catch (e) {
    notifyErr(e);
  }
}

async function unlockGroup(groupId: string): Promise<void> {
  if (!confirm(t('admin.chatModeration.confirm.unlock'))) return;
  try {
    await adminUnlockChatGroup(groupId);
    toast.push({
      type: 'success',
      text: t('admin.chatModeration.toast.unlock'),
    });
    await Promise.all([refreshSummary(), refreshReports()]);
  } catch (e) {
    notifyErr(e);
  }
}

async function dissolveGroup(groupId: string): Promise<void> {
  if (!confirm(t('admin.chatModeration.confirm.dissolve'))) return;
  const reasonRaw = window.prompt(
    t('admin.chatModeration.prompt.dissolveReason'),
  );
  if (reasonRaw === null) return;
  try {
    await adminDissolveChatGroup(groupId, reasonRaw.trim() || null);
    toast.push({
      type: 'success',
      text: t('admin.chatModeration.toast.dissolve'),
    });
    await Promise.all([refreshSummary(), refreshReports()]);
  } catch (e) {
    notifyErr(e);
  }
}

async function submitMute(): Promise<void> {
  const userId = muteFormUserId.value.trim();
  const reason = muteFormReason.value.trim();
  if (!userId || !reason) return;
  if (!confirm(t('admin.chatModeration.confirm.mute'))) return;
  muteFormSubmitting.value = true;
  try {
    await adminCreateChatMute({
      userId,
      scope: muteFormScope.value,
      reason,
      expiresAt: muteFormExpiresAt.value
        ? new Date(muteFormExpiresAt.value).toISOString()
        : null,
    });
    toast.push({ type: 'success', text: t('admin.chatModeration.toast.mute') });
    muteFormUserId.value = '';
    muteFormReason.value = '';
    muteFormExpiresAt.value = '';
    await Promise.all([refreshSummary(), refreshMutes()]);
  } catch (e) {
    notifyErr(e);
  } finally {
    muteFormSubmitting.value = false;
  }
}

async function revokeMute(muteId: string): Promise<void> {
  if (!confirm(t('admin.chatModeration.confirm.revokeMute'))) return;
  try {
    await adminRevokeChatMute(muteId);
    toast.push({
      type: 'success',
      text: t('admin.chatModeration.toast.revokeMute'),
    });
    await Promise.all([refreshSummary(), refreshMutes()]);
  } catch (e) {
    notifyErr(e);
  }
}

function statusClass(s: string): string {
  if (s === 'OPEN') return 'text-rose-300';
  if (s === 'ACKNOWLEDGED') return 'text-amber-300';
  if (s === 'RESOLVED') return 'text-emerald-300';
  if (s === 'REJECTED') return 'text-ink-300';
  return 'text-ink-300';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

const showReportsEmpty = computed(
  () =>
    !loadingReports.value &&
    !errorReports.value &&
    reports.value.length === 0,
);
const showMutesEmpty = computed(
  () => !loadingMutes.value && !errorMutes.value && mutes.value.length === 0,
);
</script>

<template>
  <div class="space-y-4" data-testid="admin-chat-moderation-panel">
    <!-- Header + summary -->
    <section class="border border-ink-300/30 rounded p-3 space-y-2">
      <header>
        <h3 class="text-lg font-bold">
          {{ t('admin.chatModeration.title') }}
        </h3>
        <p class="text-xs text-ink-300">
          {{ t('admin.chatModeration.subtitle') }}
        </p>
      </header>

      <p v-if="loadingSummary" class="text-sm text-ink-300">
        {{ t('common.loading') }}
      </p>
      <p
        v-else-if="errorSummary"
        class="text-sm text-rose-300"
        data-testid="admin-chat-moderation-summary-error"
      >
        {{ tShortError(errorSummary) }}
      </p>
      <div
        v-else-if="summary"
        class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2"
        data-testid="admin-chat-moderation-summary"
      >
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-[10px] uppercase tracking-widest text-ink-300">
            {{ t('admin.chatModeration.summary.openReports') }}
          </div>
          <div class="text-lg font-bold text-rose-300">
            {{ summary.openReports }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-[10px] uppercase tracking-widest text-ink-300">
            {{ t('admin.chatModeration.summary.acknowledgedReports') }}
          </div>
          <div class="text-lg font-bold text-amber-300">
            {{ summary.acknowledgedReports }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-[10px] uppercase tracking-widest text-ink-300">
            {{ t('admin.chatModeration.summary.resolvedToday') }}
          </div>
          <div class="text-lg font-bold text-emerald-300">
            {{ summary.resolvedToday }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-[10px] uppercase tracking-widest text-ink-300">
            {{ t('admin.chatModeration.summary.mutedUsers') }}
          </div>
          <div class="text-lg font-bold">
            {{ summary.mutedUsers }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-[10px] uppercase tracking-widest text-ink-300">
            {{ t('admin.chatModeration.summary.hiddenMessages') }}
          </div>
          <div class="text-lg font-bold">
            {{ summary.hiddenMessages }}
          </div>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-2">
          <div class="text-[10px] uppercase tracking-widest text-ink-300">
            {{ t('admin.chatModeration.summary.lockedGroups') }}
          </div>
          <div class="text-lg font-bold">
            {{ summary.lockedGroups }}
          </div>
        </div>
      </div>
    </section>

    <!-- Reports table -->
    <section class="border border-ink-300/30 rounded p-3 space-y-2">
      <header class="flex flex-wrap items-end gap-2">
        <div>
          <h4 class="text-sm font-semibold">
            {{ t('admin.chatModeration.reports.title') }}
          </h4>
          <p class="text-[10px] text-ink-300">
            {{ t('admin.chatModeration.reports.subtitle') }}
          </p>
        </div>
        <div class="flex flex-wrap items-end gap-2 ml-auto">
          <label class="text-[10px] uppercase tracking-widest text-ink-300">
            {{ t('admin.chatModeration.filters.status') }}
            <select
              v-model="filters.status"
              class="block mt-1 rounded border border-ink-300/40 bg-ink-800/60 px-2 py-1 text-xs"
              data-testid="admin-chat-moderation-filter-status"
            >
              <option value="">{{ t('admin.chatModeration.filters.any') }}</option>
              <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>
          <label class="text-[10px] uppercase tracking-widest text-ink-300">
            {{ t('admin.chatModeration.filters.reason') }}
            <select
              v-model="filters.reason"
              class="block mt-1 rounded border border-ink-300/40 bg-ink-800/60 px-2 py-1 text-xs"
              data-testid="admin-chat-moderation-filter-reason"
            >
              <option value="">{{ t('admin.chatModeration.filters.any') }}</option>
              <option v-for="r in REASONS" :key="r" :value="r">{{ r }}</option>
            </select>
          </label>
          <label class="text-[10px] uppercase tracking-widest text-ink-300">
            {{ t('admin.chatModeration.filters.messageType') }}
            <select
              v-model="filters.messageType"
              class="block mt-1 rounded border border-ink-300/40 bg-ink-800/60 px-2 py-1 text-xs"
              data-testid="admin-chat-moderation-filter-messageType"
            >
              <option value="">{{ t('admin.chatModeration.filters.any') }}</option>
              <option v-for="t2 in TYPES" :key="t2" :value="t2">{{ t2 }}</option>
            </select>
          </label>
          <label class="text-[10px] uppercase tracking-widest text-ink-300">
            {{ t('admin.chatModeration.filters.reporterUserId') }}
            <input
              v-model="filters.reporterUserId"
              type="text"
              maxlength="64"
              class="block mt-1 rounded border border-ink-300/40 bg-ink-800/60 px-2 py-1 text-xs"
              data-testid="admin-chat-moderation-filter-reporter"
            />
          </label>
          <label class="text-[10px] uppercase tracking-widest text-ink-300">
            {{ t('admin.chatModeration.filters.targetUserId') }}
            <input
              v-model="filters.targetUserId"
              type="text"
              maxlength="64"
              class="block mt-1 rounded border border-ink-300/40 bg-ink-800/60 px-2 py-1 text-xs"
              data-testid="admin-chat-moderation-filter-target"
            />
          </label>
          <button
            class="rounded border border-amber-400/60 px-3 py-1 text-xs uppercase tracking-widest text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
            :disabled="loadingReports"
            data-testid="admin-chat-moderation-refresh-reports"
            @click="refreshReports"
          >
            {{ t('admin.chatModeration.actions.refresh') }}
          </button>
        </div>
      </header>

      <p v-if="loadingReports" class="text-sm text-ink-300">
        {{ t('common.loading') }}
      </p>
      <p
        v-else-if="errorReports"
        class="text-sm text-rose-300"
        data-testid="admin-chat-moderation-reports-error"
      >
        {{ tShortError(errorReports) }}
      </p>
      <p
        v-else-if="showReportsEmpty"
        class="text-sm text-ink-300/70"
        data-testid="admin-chat-moderation-reports-empty"
      >
        {{ t('admin.chatModeration.reports.empty') }}
      </p>
      <div
        v-else
        class="overflow-x-auto"
        data-testid="admin-chat-moderation-reports-table"
      >
        <table class="w-full text-xs">
          <thead class="text-ink-300 text-left">
            <tr>
              <th class="px-2 py-1">{{ t('admin.chatModeration.table.createdAt') }}</th>
              <th class="px-2 py-1">{{ t('admin.chatModeration.table.type') }}</th>
              <th class="px-2 py-1">{{ t('admin.chatModeration.table.reason') }}</th>
              <th class="px-2 py-1">{{ t('admin.chatModeration.table.status') }}</th>
              <th class="px-2 py-1">{{ t('admin.chatModeration.table.reporter') }}</th>
              <th class="px-2 py-1">{{ t('admin.chatModeration.table.target') }}</th>
              <th class="px-2 py-1">{{ t('admin.chatModeration.table.preview') }}</th>
              <th class="px-2 py-1">{{ t('admin.chatModeration.table.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in reports"
              :key="r.id"
              class="border-t border-ink-300/20 align-top"
              data-testid="admin-chat-moderation-report-row"
            >
              <td class="px-2 py-1 whitespace-nowrap">{{ fmtDate(r.createdAt) }}</td>
              <td class="px-2 py-1">{{ r.messageType }}</td>
              <td class="px-2 py-1">{{ r.reason }}</td>
              <td class="px-2 py-1" :class="statusClass(r.status)">{{ r.status }}</td>
              <td class="px-2 py-1">
                <div>{{ r.reporterDisplayName ?? '—' }}</div>
                <div class="text-[10px] text-ink-300/60">{{ r.reporterUserId }}</div>
              </td>
              <td class="px-2 py-1">
                <div>{{ r.targetDisplayName ?? '—' }}</div>
                <div class="text-[10px] text-ink-300/60">{{ r.targetUserId ?? '—' }}</div>
              </td>
              <td class="px-2 py-1 max-w-[260px]">
                <div
                  v-if="r.messagePreview"
                  class="whitespace-pre-wrap break-words"
                >
                  {{ r.messagePreview }}
                </div>
                <div v-else class="text-ink-300/60">—</div>
                <div v-if="r.messageHiddenAt" class="text-[10px] text-rose-300">
                  {{ t('admin.chatModeration.table.hiddenAt', { at: fmtDate(r.messageHiddenAt) }) }}
                </div>
                <div v-if="r.detailsText" class="mt-1 text-[10px] text-ink-300/80">
                  “{{ r.detailsText }}”
                </div>
              </td>
              <td class="px-2 py-1 whitespace-nowrap">
                <div class="flex flex-wrap gap-1">
                  <button
                    v-if="r.status === 'OPEN'"
                    class="rounded border border-amber-400/60 px-2 py-0.5 text-[10px] uppercase tracking-widest text-amber-200 hover:bg-amber-500/10"
                    data-testid="admin-chat-moderation-ack-btn"
                    @click="ackReport(r.id)"
                  >
                    {{ t('admin.chatModeration.actions.ack') }}
                  </button>
                  <button
                    v-if="r.status === 'OPEN' || r.status === 'ACKNOWLEDGED'"
                    class="rounded border border-emerald-400/60 px-2 py-0.5 text-[10px] uppercase tracking-widest text-emerald-200 hover:bg-[var(--xt-jade-soft)]"
                    data-testid="admin-chat-moderation-resolve-btn"
                    @click="resolveReport(r.id, 'RESOLVED')"
                  >
                    {{ t('admin.chatModeration.actions.resolve') }}
                  </button>
                  <button
                    v-if="r.status === 'OPEN' || r.status === 'ACKNOWLEDGED'"
                    class="rounded border border-ink-300/40 px-2 py-0.5 text-[10px] uppercase tracking-widest text-ink-200 hover:bg-ink-300/10"
                    data-testid="admin-chat-moderation-reject-btn"
                    @click="resolveReport(r.id, 'REJECTED')"
                  >
                    {{ t('admin.chatModeration.actions.reject') }}
                  </button>
                  <button
                    v-if="!r.messageHiddenAt"
                    class="rounded border border-rose-400/60 px-2 py-0.5 text-[10px] uppercase tracking-widest text-rose-200 hover:bg-rose-500/10"
                    data-testid="admin-chat-moderation-hide-btn"
                    @click="hideMessage(r)"
                  >
                    {{ t('admin.chatModeration.actions.hide') }}
                  </button>
                  <button
                    v-else
                    class="rounded border border-ink-300/40 px-2 py-0.5 text-[10px] uppercase tracking-widest text-ink-200 hover:bg-ink-300/10"
                    data-testid="admin-chat-moderation-unhide-btn"
                    @click="unhideMessage(r)"
                  >
                    {{ t('admin.chatModeration.actions.unhide') }}
                  </button>
                  <template v-if="r.messageType === 'GROUP' && r.groupId">
                    <button
                      class="rounded border border-amber-400/60 px-2 py-0.5 text-[10px] uppercase tracking-widest text-amber-200 hover:bg-amber-500/10"
                      data-testid="admin-chat-moderation-lock-group-btn"
                      @click="lockGroup(r.groupId!)"
                    >
                      {{ t('admin.chatModeration.actions.lockGroup') }}
                    </button>
                    <button
                      class="rounded border border-ink-300/40 px-2 py-0.5 text-[10px] uppercase tracking-widest text-ink-200 hover:bg-ink-300/10"
                      data-testid="admin-chat-moderation-unlock-group-btn"
                      @click="unlockGroup(r.groupId!)"
                    >
                      {{ t('admin.chatModeration.actions.unlockGroup') }}
                    </button>
                    <button
                      class="rounded border border-rose-400/60 px-2 py-0.5 text-[10px] uppercase tracking-widest text-rose-200 hover:bg-rose-500/10"
                      data-testid="admin-chat-moderation-dissolve-group-btn"
                      @click="dissolveGroup(r.groupId!)"
                    >
                      {{ t('admin.chatModeration.actions.dissolveGroup') }}
                    </button>
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Mutes panel -->
    <section class="border border-ink-300/30 rounded p-3 space-y-3">
      <header>
        <h4 class="text-sm font-semibold">
          {{ t('admin.chatModeration.mutes.title') }}
        </h4>
        <p class="text-[10px] text-ink-300">
          {{ t('admin.chatModeration.mutes.subtitle') }}
        </p>
      </header>

      <!-- Create mute form -->
      <form
        class="flex flex-wrap items-end gap-2"
        data-testid="admin-chat-moderation-mute-form"
        @submit.prevent="submitMute"
      >
        <label class="text-[10px] uppercase tracking-widest text-ink-300">
          {{ t('admin.chatModeration.mutes.userId') }}
          <input
            v-model="muteFormUserId"
            type="text"
            maxlength="64"
            class="block mt-1 rounded border border-ink-300/40 bg-ink-800/60 px-2 py-1 text-xs"
            data-testid="admin-chat-moderation-mute-userId"
          />
        </label>
        <label class="text-[10px] uppercase tracking-widest text-ink-300">
          {{ t('admin.chatModeration.mutes.scope') }}
          <select
            v-model="muteFormScope"
            class="block mt-1 rounded border border-ink-300/40 bg-ink-800/60 px-2 py-1 text-xs"
            data-testid="admin-chat-moderation-mute-scope"
          >
            <option v-for="s in SCOPES" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <label class="text-[10px] uppercase tracking-widest text-ink-300">
          {{ t('admin.chatModeration.mutes.reason') }}
          <input
            v-model="muteFormReason"
            type="text"
            maxlength="200"
            class="block mt-1 rounded border border-ink-300/40 bg-ink-800/60 px-2 py-1 text-xs w-[260px]"
            data-testid="admin-chat-moderation-mute-reason"
          />
        </label>
        <label class="text-[10px] uppercase tracking-widest text-ink-300">
          {{ t('admin.chatModeration.mutes.expiresAt') }}
          <input
            v-model="muteFormExpiresAt"
            type="datetime-local"
            class="block mt-1 rounded border border-ink-300/40 bg-ink-800/60 px-2 py-1 text-xs"
            data-testid="admin-chat-moderation-mute-expiresAt"
          />
        </label>
        <button
          type="submit"
          class="rounded border border-amber-400/60 px-3 py-1 text-xs uppercase tracking-widest text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
          :disabled="
            muteFormSubmitting ||
              !muteFormUserId.trim() ||
              !muteFormReason.trim()
          "
          data-testid="admin-chat-moderation-mute-submit"
        >
          {{ t('admin.chatModeration.mutes.submit') }}
        </button>
      </form>

      <!-- Mutes filter row -->
      <div class="flex flex-wrap items-end gap-2 pt-2 border-t border-ink-300/20">
        <label class="text-[10px] uppercase tracking-widest text-ink-300">
          {{ t('admin.chatModeration.filters.userId') }}
          <input
            v-model="muteFilters.userId"
            type="text"
            maxlength="64"
            class="block mt-1 rounded border border-ink-300/40 bg-ink-800/60 px-2 py-1 text-xs"
            data-testid="admin-chat-moderation-mute-filter-userId"
          />
        </label>
        <label class="text-[10px] uppercase tracking-widest text-ink-300">
          {{ t('admin.chatModeration.filters.scope') }}
          <select
            v-model="muteFilters.scope"
            class="block mt-1 rounded border border-ink-300/40 bg-ink-800/60 px-2 py-1 text-xs"
            data-testid="admin-chat-moderation-mute-filter-scope"
          >
            <option value="">{{ t('admin.chatModeration.filters.any') }}</option>
            <option v-for="s in SCOPES" :key="s" :value="s">{{ s }}</option>
          </select>
        </label>
        <label class="flex items-center gap-1 text-[10px] uppercase tracking-widest text-ink-300">
          <input
            v-model="muteFilters.activeOnly"
            type="checkbox"
            data-testid="admin-chat-moderation-mute-filter-active"
          />
          {{ t('admin.chatModeration.filters.activeOnly') }}
        </label>
        <button
          class="rounded border border-amber-400/60 px-3 py-1 text-xs uppercase tracking-widest text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
          :disabled="loadingMutes"
          data-testid="admin-chat-moderation-refresh-mutes"
          @click="refreshMutes"
        >
          {{ t('admin.chatModeration.actions.refresh') }}
        </button>
      </div>

      <!-- Mutes table -->
      <p v-if="loadingMutes" class="text-sm text-ink-300">
        {{ t('common.loading') }}
      </p>
      <p
        v-else-if="errorMutes"
        class="text-sm text-rose-300"
        data-testid="admin-chat-moderation-mutes-error"
      >
        {{ tShortError(errorMutes) }}
      </p>
      <p
        v-else-if="showMutesEmpty"
        class="text-sm text-ink-300/70"
        data-testid="admin-chat-moderation-mutes-empty"
      >
        {{ t('admin.chatModeration.mutes.empty') }}
      </p>
      <div
        v-else
        class="overflow-x-auto"
        data-testid="admin-chat-moderation-mutes-table"
      >
        <table class="w-full text-xs">
          <thead class="text-ink-300 text-left">
            <tr>
              <th class="px-2 py-1">{{ t('admin.chatModeration.table.createdAt') }}</th>
              <th class="px-2 py-1">{{ t('admin.chatModeration.table.userId') }}</th>
              <th class="px-2 py-1">{{ t('admin.chatModeration.table.scope') }}</th>
              <th class="px-2 py-1">{{ t('admin.chatModeration.table.reason') }}</th>
              <th class="px-2 py-1">{{ t('admin.chatModeration.table.expiresAt') }}</th>
              <th class="px-2 py-1">{{ t('admin.chatModeration.table.status') }}</th>
              <th class="px-2 py-1">{{ t('admin.chatModeration.table.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="m in mutes"
              :key="m.id"
              class="border-t border-ink-300/20 align-top"
              data-testid="admin-chat-moderation-mute-row"
            >
              <td class="px-2 py-1 whitespace-nowrap">{{ fmtDate(m.createdAt) }}</td>
              <td class="px-2 py-1">{{ m.userId }}</td>
              <td class="px-2 py-1">{{ m.scope }}</td>
              <td class="px-2 py-1 max-w-[260px] break-words">{{ m.reason }}</td>
              <td class="px-2 py-1 whitespace-nowrap">{{ fmtDate(m.expiresAt) }}</td>
              <td
                class="px-2 py-1"
                :class="m.isActive ? 'text-rose-300' : 'text-emerald-300'"
              >
                {{ m.isActive
                  ? t('admin.chatModeration.mutes.active')
                  : t('admin.chatModeration.mutes.inactive') }}
              </td>
              <td class="px-2 py-1 whitespace-nowrap">
                <button
                  v-if="m.isActive"
                  class="rounded border border-emerald-400/60 px-2 py-0.5 text-[10px] uppercase tracking-widest text-emerald-200 hover:bg-[var(--xt-jade-soft)]"
                  data-testid="admin-chat-moderation-mute-revoke-btn"
                  @click="revokeMute(m.id)"
                >
                  {{ t('admin.chatModeration.actions.revokeMute') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
