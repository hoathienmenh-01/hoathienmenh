<script setup lang="ts">
/**
 * Phase 17.2 — Admin Backup panel.
 *
 * Hiển thị cho admin:
 *   - Health badge cho backup cron (OK / STALE / FAILED / DISABLED).
 *   - Health badge cho verify cron (OK / STALE / FAILED / DISABLED).
 *   - Metadata backup gần nhất (fileName, size, storage, triggeredBy).
 *   - Metadata verify gần nhất (checkedTables, latestMigration).
 *   - Nút "Run backup now" + "Run verify now" (mỗi nút có confirm modal).
 *
 * Restore production:
 *   - **KHÔNG** expose nút restore — destructive ops làm tay theo
 *     `docs/RUNBOOK.md`. Panel chỉ render trạng thái + 2 nút an toàn.
 *
 * Health mapping:
 *   - DEGRADED (BE compute từ `computeLiveOpsCronHealth`) → FAILED ở UI
 *     vì admin chỉ cần biết "có gì hư không". Detail vẫn xem được qua
 *     `staleReason` + `errorMessage`.
 *
 * i18n parity: `adminBackup.*` vi/en. Loading/empty/error riêng để admin
 * thấy section nào lỗi mà không che mất toàn bộ panel.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  BackupStatusEntry,
  BackupStatusResponse,
} from '@xuantoi/shared';
import { useToastStore } from '@/stores/toast';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import MButton from '@/components/ui/MButton.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';
import {
  adminGetBackupStatus,
  adminRunBackup,
  adminRunBackupVerify,
} from '@/api/adminBackup';

const { t } = useI18n();
const toast = useToastStore();

const status = ref<BackupStatusResponse | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

/** Đang chờ user confirm chạy backup. */
const pendingRunBackup = ref(false);
const runningBackup = ref(false);

/** Đang chờ user confirm chạy verify. */
const pendingRunVerify = ref(false);
const runningVerify = ref(false);

type BadgeLevel = 'OK' | 'STALE' | 'FAILED' | 'DISABLED';

/** Map raw cron health → 4-bucket badge mà UI hiển thị. */
function toBadgeLevel(entry: BackupStatusEntry): BadgeLevel {
  if (!entry.enabled) return 'DISABLED';
  if (entry.status === 'OK') return 'OK';
  if (entry.status === 'STALE') return 'STALE';
  // DEGRADED ở BE = có lastErrorAt hoặc mismatch → FAILED ở UI.
  return 'FAILED';
}

const backupBadge = computed<BadgeLevel | null>(() =>
  status.value ? toBadgeLevel(status.value.backup) : null,
);
const verifyBadge = computed<BadgeLevel | null>(() =>
  status.value ? toBadgeLevel(status.value.verify) : null,
);

const errorText = computed(() => {
  if (!error.value) return '';
  const code = error.value;
  const key = `adminBackup.errors.${code}`;
  const fallback = `adminBackup.errors.UNKNOWN`;
  const resolved = t(key, '__missing__');
  return resolved === '__missing__' ? t(fallback) : resolved;
});

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    status.value = await adminGetBackupStatus();
  } catch (e) {
    error.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.value = false;
  }
}

function openRunBackupConfirm(): void {
  pendingRunBackup.value = true;
}

function openRunVerifyConfirm(): void {
  pendingRunVerify.value = true;
}

async function confirmRunBackup(): Promise<void> {
  pendingRunBackup.value = false;
  runningBackup.value = true;
  try {
    const row = await adminRunBackup();
    toast.push({
      type: 'success',
      text: t('adminBackup.actions.runBackupSuccess', {
        file: row.fileName ?? '—',
      }),
    });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text:
        t(`adminBackup.errors.${code}`, '__missing__') !== '__missing__'
          ? t(`adminBackup.errors.${code}`)
          : t('adminBackup.errors.UNKNOWN'),
    });
    // Vẫn refresh để row FAILED hiện ra.
    await refresh();
  } finally {
    runningBackup.value = false;
  }
}

async function confirmRunVerify(): Promise<void> {
  pendingRunVerify.value = false;
  runningVerify.value = true;
  try {
    const row = await adminRunBackupVerify();
    toast.push({
      type: 'success',
      text: t('adminBackup.actions.runVerifySuccess', {
        tables: row.checkedTables ?? 0,
      }),
    });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text:
        t(`adminBackup.errors.${code}`, '__missing__') !== '__missing__'
          ? t(`adminBackup.errors.${code}`)
          : t('adminBackup.errors.UNKNOWN'),
    });
    await refresh();
  } finally {
    runningVerify.value = false;
  }
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function badgeClass(level: BadgeLevel | null): string {
  switch (level) {
    case 'OK':
      return 'bg-emerald-700/40 text-emerald-200 border-emerald-400/40';
    case 'STALE':
      return 'bg-amber-700/40 text-amber-200 border-amber-400/40';
    case 'FAILED':
      return 'bg-rose-700/40 text-rose-200 border-rose-400/40';
    case 'DISABLED':
      return 'bg-ink-700/40 text-ink-300 border-ink-300/30';
    default:
      return 'bg-ink-700/40 text-ink-300 border-ink-300/30';
  }
}

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div class="space-y-4" data-testid="admin-backup-panel">
    <header class="space-y-1">
      <h2 class="text-lg text-amber-200">{{ t('adminBackup.title') }}</h2>
      <p class="text-xs text-ink-300">{{ t('adminBackup.subtitle') }}</p>
    </header>

    <!-- LOADING -->
    <div
      v-if="loading"
      class="text-xs text-ink-300"
      data-testid="admin-backup-loading"
    >
      {{ t('adminBackup.loading') }}
    </div>

    <!-- ERROR -->
    <div
      v-else-if="error"
      class="bg-rose-900/30 border border-rose-400/40 rounded p-3 text-sm text-rose-100 space-y-2"
      data-testid="admin-backup-error"
    >
      <div>{{ errorText }}</div>
      <MButton data-testid="admin-backup-error-retry" @click="refresh">
        {{ t('adminBackup.retry') }}
      </MButton>
    </div>

    <!-- EMPTY: status fetched OK but no rows yet -->
    <template v-else-if="status">
      <!-- SUMMARY: 2 health badges + 2 action buttons -->
      <section
        class="grid grid-cols-1 md:grid-cols-2 gap-3"
        data-testid="admin-backup-summary"
      >
        <!-- BACKUP CARD -->
        <div
          class="bg-ink-700/30 border border-ink-300/20 rounded p-3 space-y-2"
          data-testid="admin-backup-card"
        >
          <div class="flex items-center justify-between">
            <h3 class="text-sm text-amber-200">
              {{ t('adminBackup.sections.backup') }}
            </h3>
            <span
              class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border"
              :class="badgeClass(backupBadge)"
              data-testid="admin-backup-badge"
            >
              {{ t(`adminBackup.badge.${backupBadge}`) }}
            </span>
          </div>
          <dl class="text-xs text-ink-200 space-y-1">
            <div class="flex justify-between gap-2">
              <dt class="text-ink-300">{{ t('adminBackup.fields.cron') }}</dt>
              <dd class="font-mono">
                {{ status.backup.cronExpression }}
                <span class="text-ink-300"> ({{ status.backup.timezone }})</span>
              </dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-ink-300">
                {{ t('adminBackup.fields.lastRunAt') }}
              </dt>
              <dd>{{ fmtDate(status.backup.lastRunAt) }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-ink-300">
                {{ t('adminBackup.fields.lastSuccessAt') }}
              </dt>
              <dd>{{ fmtDate(status.backup.lastSuccessAt) }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-ink-300">
                {{ t('adminBackup.fields.lastErrorAt') }}
              </dt>
              <dd>{{ fmtDate(status.backup.lastErrorAt) }}</dd>
            </div>
            <div
              v-if="status.backup.staleReason"
              class="text-amber-300"
              data-testid="admin-backup-stale-reason"
            >
              {{ status.backup.staleReason }}
            </div>
          </dl>
          <div
            v-if="status.latestBackup"
            class="text-xs text-ink-200 border-t border-ink-300/20 pt-2 space-y-1"
            data-testid="admin-backup-latest"
          >
            <div class="flex justify-between gap-2">
              <span class="text-ink-300">{{
                t('adminBackup.fields.fileName')
              }}</span>
              <span class="font-mono truncate" :title="status.latestBackup.fileName ?? ''">{{
                status.latestBackup.fileName ?? '—'
              }}</span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-ink-300">{{
                t('adminBackup.fields.fileSize')
              }}</span>
              <span>{{ fmtSize(status.latestBackup.fileSizeBytes) }}</span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-ink-300">{{
                t('adminBackup.fields.storage')
              }}</span>
              <span>{{ status.latestBackup.storage }}</span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-ink-300">{{
                t('adminBackup.fields.triggeredBy')
              }}</span>
              <span>{{ status.latestBackup.triggeredBy }}</span>
            </div>
            <div
              v-if="status.latestBackup.errorMessage"
              class="text-rose-200 text-[11px]"
              data-testid="admin-backup-latest-error"
            >
              {{ status.latestBackup.errorMessage }}
            </div>
          </div>
          <div
            v-else
            class="text-xs text-ink-300 italic"
            data-testid="admin-backup-latest-empty"
          >
            {{ t('adminBackup.empty.backup') }}
          </div>
          <MButton
            data-testid="admin-backup-run-btn"
            :disabled="runningBackup"
            @click="openRunBackupConfirm"
          >
            {{
              runningBackup
                ? t('adminBackup.actions.running')
                : t('adminBackup.actions.runBackup')
            }}
          </MButton>
        </div>

        <!-- VERIFY CARD -->
        <div
          class="bg-ink-700/30 border border-ink-300/20 rounded p-3 space-y-2"
          data-testid="admin-verify-card"
        >
          <div class="flex items-center justify-between">
            <h3 class="text-sm text-amber-200">
              {{ t('adminBackup.sections.verify') }}
            </h3>
            <span
              class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border"
              :class="badgeClass(verifyBadge)"
              data-testid="admin-verify-badge"
            >
              {{ t(`adminBackup.badge.${verifyBadge}`) }}
            </span>
          </div>
          <dl class="text-xs text-ink-200 space-y-1">
            <div class="flex justify-between gap-2">
              <dt class="text-ink-300">{{ t('adminBackup.fields.cron') }}</dt>
              <dd class="font-mono">
                {{ status.verify.cronExpression }}
                <span class="text-ink-300"> ({{ status.verify.timezone }})</span>
              </dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-ink-300">
                {{ t('adminBackup.fields.lastRunAt') }}
              </dt>
              <dd>{{ fmtDate(status.verify.lastRunAt) }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-ink-300">
                {{ t('adminBackup.fields.lastSuccessAt') }}
              </dt>
              <dd>{{ fmtDate(status.verify.lastSuccessAt) }}</dd>
            </div>
            <div class="flex justify-between gap-2">
              <dt class="text-ink-300">
                {{ t('adminBackup.fields.lastErrorAt') }}
              </dt>
              <dd>{{ fmtDate(status.verify.lastErrorAt) }}</dd>
            </div>
            <div
              v-if="status.verify.staleReason"
              class="text-amber-300"
              data-testid="admin-verify-stale-reason"
            >
              {{ status.verify.staleReason }}
            </div>
          </dl>
          <div
            v-if="status.latestVerify"
            class="text-xs text-ink-200 border-t border-ink-300/20 pt-2 space-y-1"
            data-testid="admin-verify-latest"
          >
            <div class="flex justify-between gap-2">
              <span class="text-ink-300">{{
                t('adminBackup.fields.checkedTables')
              }}</span>
              <span>{{ status.latestVerify.checkedTables ?? '—' }}</span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-ink-300">{{
                t('adminBackup.fields.latestMigration')
              }}</span>
              <span class="font-mono truncate" :title="status.latestVerify.latestMigration ?? ''">
                {{ status.latestVerify.latestMigration ?? '—' }}
              </span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-ink-300">{{
                t('adminBackup.fields.triggeredBy')
              }}</span>
              <span>{{ status.latestVerify.triggeredBy }}</span>
            </div>
            <div
              v-if="status.latestVerify.errorMessage"
              class="text-rose-200 text-[11px]"
              data-testid="admin-verify-latest-error"
            >
              {{ status.latestVerify.errorMessage }}
            </div>
          </div>
          <div
            v-else
            class="text-xs text-ink-300 italic"
            data-testid="admin-verify-latest-empty"
          >
            {{ t('adminBackup.empty.verify') }}
          </div>
          <MButton
            data-testid="admin-verify-run-btn"
            :disabled="runningVerify"
            @click="openRunVerifyConfirm"
          >
            {{
              runningVerify
                ? t('adminBackup.actions.running')
                : t('adminBackup.actions.runVerify')
            }}
          </MButton>
        </div>
      </section>

      <p class="text-[11px] text-ink-300" data-testid="admin-backup-generated-at">
        {{
          t('adminBackup.generatedAt', { at: fmtDate(status.generatedAt) })
        }}
      </p>
      <p class="text-[11px] text-ink-300">
        {{ t('adminBackup.restoreNotice') }}
      </p>
    </template>

    <!-- CONFIRM MODALS -->
    <ConfirmModal
      :open="pendingRunBackup"
      test-id="admin-backup-run-confirm"
      :title="t('adminBackup.confirm.runBackupTitle')"
      :message="t('adminBackup.confirm.runBackupMessage')"
      :confirm-text="t('adminBackup.actions.runBackup')"
      :loading="runningBackup"
      @confirm="confirmRunBackup"
      @cancel="pendingRunBackup = false"
    />
    <ConfirmModal
      :open="pendingRunVerify"
      test-id="admin-verify-run-confirm"
      :title="t('adminBackup.confirm.runVerifyTitle')"
      :message="t('adminBackup.confirm.runVerifyMessage')"
      :confirm-text="t('adminBackup.actions.runVerify')"
      :loading="runningVerify"
      @confirm="confirmRunVerify"
      @cancel="pendingRunVerify = false"
    />
  </div>
</template>
