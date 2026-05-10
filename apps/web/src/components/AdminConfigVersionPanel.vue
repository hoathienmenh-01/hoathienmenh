<script setup lang="ts">
/**
 * Phase 15.6 — Admin Config Version + Rollback panel.
 *
 * Cho admin xem versioning + rollback 4 entity:
 *   - LIVEOPS_EVENT
 *   - LIVEOPS_ANNOUNCEMENT
 *   - FEATURE_FLAG
 *   - MAINTENANCE_WINDOW
 *
 * Flow:
 *   1. Pick entityType + nhập entityId.
 *   2. Refresh → list versions newest-first.
 *   3. Pick 1 version → "Diff with latest" / "Dry-run rollback".
 *   4. Dry-run trả safety (SAFE / NEED_CONFIRM / BLOCKED + warnings).
 *   5. Apply rollback: SAFE → 1 confirm; NEED_CONFIRM → nhập confirmPhrase
 *      do server trả về; BLOCKED → server reject.
 *
 * Audit chain do server tự ghi (`ADMIN_CONFIG_VERSION_VIEW` /
 * `ADMIN_CONFIG_ROLLBACK_DRY_RUN` / `ADMIN_CONFIG_ROLLBACK` /
 * `ADMIN_CONFIG_ROLLBACK_BLOCKED`). UI chỉ trigger.
 */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  CONFIG_VERSION_ENTITY_TYPES,
  type ConfigRollbackResponse,
  type ConfigVersionEntityType,
} from '@xuantoi/shared';
import {
  adminApplyConfigRollback,
  adminDiffConfigVersions,
  adminDryRunConfigRollback,
  adminListConfigVersions,
  type ConfigVersionDiffResult,
  type ConfigVersionRow,
} from '@/api/configVersion';
import { useToastStore } from '@/stores/toast';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import MButton from '@/components/ui/MButton.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';

const { t, locale } = useI18n();
const toast = useToastStore();

const entityType = ref<ConfigVersionEntityType>('LIVEOPS_EVENT');
const entityId = ref<string>('');
const versions = ref<ConfigVersionRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const selectedId = ref<string | null>(null);
const diff = ref<ConfigVersionDiffResult | null>(null);
const dryRun = ref<ConfigRollbackResponse | null>(null);
const applying = ref(false);
const confirmPhraseInput = ref('');
const reasonInput = ref('');

interface PendingApply {
  versionId: string;
  needConfirm: boolean;
  confirmPhrase: string | null;
}
const pendingApply = ref<PendingApply | null>(null);

const ENTITY_TYPES: ReadonlyArray<ConfigVersionEntityType> =
  CONFIG_VERSION_ENTITY_TYPES;

const sorted = computed(() =>
  [...versions.value].sort((a, b) => b.version - a.version),
);

const latestVersion = computed(() => sorted.value[0] ?? null);

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale.value === 'en' ? 'en-US' : 'vi-VN');
}

function safetyBadgeClass(level: string): string {
  switch (level) {
    case 'SAFE':
      return 'bg-emerald-700/40 text-emerald-100';
    case 'NEED_CONFIRM':
      return 'bg-amber-700/40 text-amber-100';
    case 'BLOCKED':
      return 'bg-rose-700/40 text-rose-100';
    default:
      return 'bg-ink-700/60 text-ink-200';
  }
}

async function refresh(): Promise<void> {
  if (!entityId.value.trim()) {
    error.value = 'CONFIG_VERSION_ENTITY_ID_REQUIRED';
    return;
  }
  loading.value = true;
  error.value = null;
  diff.value = null;
  dryRun.value = null;
  selectedId.value = null;
  try {
    versions.value = await adminListConfigVersions(
      entityType.value,
      entityId.value.trim(),
    );
  } catch (e) {
    error.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    versions.value = [];
  } finally {
    loading.value = false;
  }
}

async function diffWithLatest(id: string): Promise<void> {
  if (!latestVersion.value) return;
  selectedId.value = id;
  diff.value = null;
  dryRun.value = null;
  try {
    diff.value = await adminDiffConfigVersions(id, latestVersion.value.id);
  } catch (e) {
    toast.push({
      type: 'error',
      text: t('adminConfigVersion.errors.' + extractApiErrorCodeOrDefault(e, 'UNKNOWN'), {
        default: t('adminConfigVersion.errors.UNKNOWN'),
      }),
    });
  }
}

async function startDryRun(id: string): Promise<void> {
  selectedId.value = id;
  diff.value = null;
  dryRun.value = null;
  try {
    dryRun.value = await adminDryRunConfigRollback(id);
  } catch (e) {
    toast.push({
      type: 'error',
      text: t('adminConfigVersion.errors.' + extractApiErrorCodeOrDefault(e, 'UNKNOWN'), {
        default: t('adminConfigVersion.errors.UNKNOWN'),
      }),
    });
  }
}

function requestApply(): void {
  if (!dryRun.value || !selectedId.value) return;
  if (dryRun.value.safetyLevel === 'BLOCKED') {
    toast.push({
      type: 'error',
      text: t('adminConfigVersion.toast.blocked'),
    });
    return;
  }
  pendingApply.value = {
    versionId: selectedId.value,
    needConfirm: dryRun.value.requiresConfirm,
    confirmPhrase: dryRun.value.confirmPhrase,
  };
  confirmPhraseInput.value = '';
  reasonInput.value = '';
}

async function confirmApply(): Promise<void> {
  const p = pendingApply.value;
  if (!p) return;
  if (p.needConfirm && p.confirmPhrase) {
    if (confirmPhraseInput.value.trim() !== p.confirmPhrase) {
      toast.push({
        type: 'error',
        text: t('adminConfigVersion.errors.CONFIG_ROLLBACK_CONFIRM_MISMATCH'),
      });
      return;
    }
  }
  applying.value = true;
  try {
    const result = await adminApplyConfigRollback(p.versionId, {
      reason: reasonInput.value.trim() || undefined,
      confirmPhrase: p.needConfirm ? confirmPhraseInput.value.trim() : undefined,
    });
    toast.push({
      type: 'success',
      text: t('adminConfigVersion.toast.applied', {
        from: result.fromVersion,
        to: result.targetVersion,
        applied: result.appliedVersion ?? '?',
      }),
    });
    pendingApply.value = null;
    dryRun.value = null;
    diff.value = null;
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t('adminConfigVersion.errors.' + code, {
        default: t('adminConfigVersion.errors.UNKNOWN'),
      }),
    });
  } finally {
    applying.value = false;
  }
}

function cancelApply(): void {
  pendingApply.value = null;
  confirmPhraseInput.value = '';
  reasonInput.value = '';
}
</script>

<template>
  <div data-testid="admin-config-version-panel" class="space-y-3">
    <header class="flex items-center justify-between">
      <h2 class="text-lg text-amber-200">
        {{ t('adminConfigVersion.title') }}
      </h2>
    </header>
    <p class="text-xs text-ink-300">
      {{ t('adminConfigVersion.hint') }}
    </p>

    <!-- Filter row -->
    <div
      class="flex flex-wrap items-end gap-2 bg-ink-700/30 border border-ink-300/20 rounded p-2"
    >
      <label class="block">
        <span class="text-xs text-ink-300">{{
          t('adminConfigVersion.entityType')
        }}</span>
        <select
          v-model="entityType"
          class="block bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 text-sm mt-1"
          data-testid="admin-config-version-entity-type"
        >
          <option v-for="et in ENTITY_TYPES" :key="et" :value="et">
            {{ t(`adminConfigVersion.entityTypeLabel.${et}`) }}
          </option>
        </select>
      </label>
      <label class="block flex-1 min-w-[12rem]">
        <span class="text-xs text-ink-300">{{
          t('adminConfigVersion.entityId')
        }}</span>
        <input
          v-model="entityId"
          class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 text-sm mt-1"
          data-testid="admin-config-version-entity-id"
          :placeholder="t('adminConfigVersion.entityIdPlaceholder')"
          @keydown.enter="refresh()"
        />
      </label>
      <MButton
        data-testid="admin-config-version-refresh"
        :disabled="loading"
        @click="refresh()"
      >
        {{ loading ? t('adminConfigVersion.loading') : t('adminConfigVersion.refresh') }}
      </MButton>
    </div>

    <p
      v-if="error"
      class="text-xs text-rose-300"
      data-testid="admin-config-version-error"
    >
      {{ t(`adminConfigVersion.errors.${error}`, { default: t('adminConfigVersion.errors.UNKNOWN') }) }}
    </p>

    <!-- Versions table -->
    <div
      v-if="!loading && versions.length === 0 && !error"
      class="text-xs text-ink-300 italic"
      data-testid="admin-config-version-empty"
    >
      {{ t('adminConfigVersion.empty') }}
    </div>

    <table
      v-if="versions.length > 0"
      class="w-full text-sm border-collapse"
      data-testid="admin-config-version-table"
    >
      <thead>
        <tr class="text-left text-xs text-ink-300 border-b border-ink-300/20">
          <th class="py-1 px-2">v</th>
          <th class="py-1 px-2">{{ t('adminConfigVersion.col.action') }}</th>
          <th class="py-1 px-2">{{ t('adminConfigVersion.col.changedAt') }}</th>
          <th class="py-1 px-2">{{ t('adminConfigVersion.col.reason') }}</th>
          <th class="py-1 px-2 text-right">
            {{ t('adminConfigVersion.col.actions') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in sorted"
          :key="row.id"
          class="border-b border-ink-300/10 align-top"
          :class="selectedId === row.id ? 'bg-amber-900/20' : ''"
          :data-testid="`admin-config-version-row-${row.version}`"
        >
          <td class="py-1 px-2 text-amber-200 font-mono">{{ row.version }}</td>
          <td class="py-1 px-2 text-xs">{{ row.action }}</td>
          <td class="py-1 px-2 text-xs text-ink-300">
            {{ fmtDate(row.createdAt) }}
          </td>
          <td class="py-1 px-2 text-xs text-ink-200">
            {{ row.reason ?? '—' }}
          </td>
          <td class="py-1 px-2 text-right">
            <MButton
              v-if="latestVersion && latestVersion.id !== row.id"
              :data-testid="`admin-config-version-diff-${row.version}`"
              @click="diffWithLatest(row.id)"
            >
              {{ t('adminConfigVersion.diff') }}
            </MButton>
            <MButton
              v-if="latestVersion && latestVersion.id !== row.id"
              class="ml-1"
              :data-testid="`admin-config-version-dry-run-${row.version}`"
              @click="startDryRun(row.id)"
            >
              {{ t('adminConfigVersion.dryRun') }}
            </MButton>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Diff result -->
    <section
      v-if="diff"
      class="bg-ink-700/30 border border-ink-300/20 rounded p-2 text-xs"
      data-testid="admin-config-version-diff-section"
    >
      <h3 class="text-sm text-amber-200 mb-1">
        {{
          t('adminConfigVersion.diffTitle', {
            from: diff.fromVersion.version,
            to: diff.toVersion.version,
          })
        }}
      </h3>
      <div v-if="diff.changedFields.length === 0" class="text-ink-300 italic">
        {{ t('adminConfigVersion.noChanges') }}
      </div>
      <ul v-else class="space-y-1">
        <li
          v-for="field in diff.changedFields"
          :key="field"
          class="font-mono"
        >
          <span class="text-amber-200">{{ field }}</span>:
          <span class="text-rose-300">{{
            JSON.stringify(diff.diff[field]?.before)
          }}</span>
          →
          <span class="text-emerald-300">{{
            JSON.stringify(diff.diff[field]?.after)
          }}</span>
        </li>
      </ul>
    </section>

    <!-- Dry-run result -->
    <section
      v-if="dryRun"
      class="bg-ink-700/30 border border-ink-300/20 rounded p-2 space-y-2"
      data-testid="admin-config-version-dry-run-section"
    >
      <header class="flex items-center gap-2">
        <h3 class="text-sm text-amber-200">
          {{
            t('adminConfigVersion.dryRunTitle', {
              from: dryRun.fromVersion,
              to: dryRun.targetVersion,
            })
          }}
        </h3>
        <span
          class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded"
          :class="safetyBadgeClass(dryRun.safetyLevel)"
          data-testid="admin-config-version-safety-badge"
        >
          {{ dryRun.safetyLevel }}
        </span>
      </header>
      <div v-if="dryRun.warnings.length > 0" class="text-xs space-y-0.5">
        <p class="text-ink-300">
          {{ t('adminConfigVersion.warningsLabel') }}:
        </p>
        <ul class="list-disc list-inside text-amber-200">
          <li v-for="w in dryRun.warnings" :key="w">{{ w }}</li>
        </ul>
      </div>
      <p
        v-if="dryRun.changedFields.length === 0"
        class="text-xs text-ink-300 italic"
      >
        {{ t('adminConfigVersion.noChanges') }}
      </p>
      <p v-else class="text-xs text-ink-200">
        {{
          t('adminConfigVersion.changedFields', {
            count: dryRun.changedFields.length,
          })
        }}:
        <span class="font-mono">{{ dryRun.changedFields.join(', ') }}</span>
      </p>
      <MButton
        v-if="dryRun.safetyLevel !== 'BLOCKED'"
        data-testid="admin-config-version-apply"
        :disabled="applying"
        @click="requestApply"
      >
        {{ t('adminConfigVersion.applyRollback') }}
      </MButton>
      <p v-else class="text-xs text-rose-300">
        {{ t('adminConfigVersion.blockedNotice') }}
      </p>
    </section>

    <!-- Confirm modal for apply -->
    <ConfirmModal
      :open="!!pendingApply"
      test-id="admin-config-version-confirm-modal"
      :title="t('adminConfigVersion.confirmTitle')"
      :message="
        pendingApply && pendingApply.needConfirm
          ? t('adminConfigVersion.confirmDescriptionNeedConfirm', {
            phrase: pendingApply.confirmPhrase ?? 'CONFIRM_ROLLBACK',
          })
          : t('adminConfigVersion.confirmDescriptionSafe')
      "
      :confirm-text="t('adminConfigVersion.applyRollback')"
      :cancel-text="t('common.cancel')"
      :loading="applying"
      danger
      @confirm="confirmApply"
      @cancel="cancelApply"
    >
      <div v-if="pendingApply" class="space-y-2 text-xs">
        <label class="block">
          <span class="text-ink-300">{{
            t('adminConfigVersion.reasonLabel')
          }}</span>
          <input
            v-model="reasonInput"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1"
            :placeholder="t('adminConfigVersion.reasonPlaceholder')"
            data-testid="admin-config-version-reason-input"
            maxlength="500"
          />
        </label>
        <label v-if="pendingApply.needConfirm" class="block">
          <span class="text-ink-300">{{
            t('adminConfigVersion.confirmPhraseLabel', {
              phrase: pendingApply.confirmPhrase ?? 'CONFIRM_ROLLBACK',
            })
          }}</span>
          <input
            v-model="confirmPhraseInput"
            class="w-full bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1 mt-1 font-mono"
            :placeholder="pendingApply.confirmPhrase ?? 'CONFIRM_ROLLBACK'"
            data-testid="admin-config-version-confirm-phrase-input"
            maxlength="200"
          />
        </label>
      </div>
    </ConfirmModal>
  </div>
</template>
