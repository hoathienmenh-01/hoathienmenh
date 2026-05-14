<script setup lang="ts">
/**
 * Phase 45.0 — Admin Remote Config panel.
 *
 * Liệt kê toàn bộ remote-config từ catalog (cả config chưa có DB row,
 * hiển thị default). Cho phép admin:
 *   - Edit value (PATCH /admin/remote-config/:key) — yêu cầu lý do >= 3 ký tự.
 *   - Refresh defaults (POST /admin/remote-config/refresh-defaults).
 *   - Clear cache (POST /admin/remote-config/clear-cache).
 *
 * UI tách input theo type (string / number / boolean / json) + validation
 * tại FE (giúp UX). Server validate lại (RemoteConfigValidationError 422).
 * I18n VI/EN parity qua `adminRemoteConfig.*`.
 *
 * Server vẫn audit log (`ADMIN_REMOTE_CONFIG_*`) — UI chỉ trigger.
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  RemoteConfigAdminView,
  RemoteConfigKey,
} from '@xuantoi/shared';
import { useToastStore } from '@/stores/toast';
import {
  adminClearRemoteConfigCache,
  adminListRemoteConfigs,
  adminRefreshRemoteConfigDefaults,
  adminUpdateRemoteConfig,
} from '@/api/remoteConfig';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import MButton from '@/components/ui/MButton.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';

const { t } = useI18n();
const toast = useToastStore();

const configs = ref<RemoteConfigAdminView[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const refreshingDefaults = ref(false);
const clearingCache = ref(false);
const search = ref('');

interface DraftState {
  raw: string;
  /** Edit-mode active (input visible) */
  active: boolean;
  saving: boolean;
}
/** key → draft */
const drafts = reactive<Record<string, DraftState>>({});

const reasonByKey = reactive<Record<string, string>>({});

interface PendingSave {
  key: RemoteConfigKey;
  parsedValue: unknown;
  rawDisplay: string;
  reason: string;
}
const pendingSave = ref<PendingSave | null>(null);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return configs.value;
  return configs.value.filter(
    (c) =>
      c.key.toLowerCase().includes(q) ||
      c.descriptionVi.toLowerCase().includes(q) ||
      c.descriptionEn.toLowerCase().includes(q),
  );
});

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    configs.value = await adminListRemoteConfigs();
    // Init drafts from current values
    for (const c of configs.value) {
      if (!drafts[c.key]) {
        drafts[c.key] = { raw: formatValue(c.value), active: false, saving: false };
      }
    }
  } catch (e) {
    error.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void refresh();
});

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function startEdit(c: RemoteConfigAdminView): void {
  drafts[c.key] = {
    raw: formatValue(c.value),
    active: true,
    saving: false,
  };
}

function cancelEdit(key: string): void {
  const c = configs.value.find((x) => x.key === key);
  drafts[key] = {
    raw: formatValue(c?.value),
    active: false,
    saving: false,
  };
  delete reasonByKey[key];
}

interface ParseResult {
  ok: boolean;
  value?: unknown;
  errorCode?: string;
}

function parseDraft(c: RemoteConfigAdminView, raw: string): ParseResult {
  const trimmed = raw.trim();
  if (c.valueType === 'string') {
    return { ok: true, value: raw };
  }
  if (c.valueType === 'number') {
    if (trimmed === '') return { ok: false, errorCode: 'PARSE_NUMBER' };
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return { ok: false, errorCode: 'PARSE_NUMBER' };
    return { ok: true, value: n };
  }
  if (c.valueType === 'boolean') {
    if (trimmed === 'true') return { ok: true, value: true };
    if (trimmed === 'false') return { ok: true, value: false };
    return { ok: false, errorCode: 'PARSE_BOOLEAN' };
  }
  // json
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false, errorCode: 'PARSE_JSON' };
  }
}

function requestSave(c: RemoteConfigAdminView): void {
  const d = drafts[c.key];
  if (!d || d.saving) return;
  const reason = (reasonByKey[c.key] ?? '').trim();
  if (reason.length < 3) {
    toast.push({
      type: 'error',
      text: t('adminRemoteConfig.errors.REASON_REQUIRED'),
    });
    return;
  }
  const parsed = parseDraft(c, d.raw);
  if (!parsed.ok) {
    toast.push({
      type: 'error',
      text: t(`adminRemoteConfig.errors.${parsed.errorCode}`, { defaultValue: parsed.errorCode! }),
    });
    return;
  }
  pendingSave.value = {
    key: c.key,
    parsedValue: parsed.value,
    rawDisplay: formatValue(parsed.value),
    reason,
  };
}

async function confirmPendingSave(): Promise<void> {
  const p = pendingSave.value;
  if (!p) return;
  pendingSave.value = null;
  await doSave(p.key, p.parsedValue, p.reason);
}

function cancelPendingSave(): void {
  pendingSave.value = null;
}

async function doSave(
  key: RemoteConfigKey,
  value: unknown,
  reason: string,
): Promise<void> {
  drafts[key].saving = true;
  try {
    const view = await adminUpdateRemoteConfig(key, value, reason);
    const idx = configs.value.findIndex((x) => x.key === key);
    if (idx >= 0) configs.value[idx] = view;
    drafts[key] = {
      raw: formatValue(view.value),
      active: false,
      saving: false,
    };
    delete reasonByKey[key];
    toast.push({
      type: 'success',
      text: t('adminRemoteConfig.toast.saved', { key }),
    });
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text:
        t(`adminRemoteConfig.errors.${code}`, '__missing__') === '__missing__'
          ? t('adminRemoteConfig.errors.UNKNOWN')
          : t(`adminRemoteConfig.errors.${code}`),
    });
    drafts[key].saving = false;
  }
}

async function refreshDefaults(): Promise<void> {
  if (refreshingDefaults.value) return;
  refreshingDefaults.value = true;
  try {
    const result = await adminRefreshRemoteConfigDefaults();
    toast.push({
      type: 'success',
      text: t('adminRemoteConfig.toast.refreshedDefaults', {
        created: result.created,
        existing: result.existing,
      }),
    });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text:
        t(`adminRemoteConfig.errors.${code}`, '__missing__') === '__missing__'
          ? t('adminRemoteConfig.errors.UNKNOWN')
          : t(`adminRemoteConfig.errors.${code}`),
    });
  } finally {
    refreshingDefaults.value = false;
  }
}

async function clearCache(): Promise<void> {
  if (clearingCache.value) return;
  clearingCache.value = true;
  try {
    await adminClearRemoteConfigCache();
    toast.push({
      type: 'success',
      text: t('adminRemoteConfig.toast.cacheCleared'),
    });
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text:
        t(`adminRemoteConfig.errors.${code}`, '__missing__') === '__missing__'
          ? t('adminRemoteConfig.errors.UNKNOWN')
          : t(`adminRemoteConfig.errors.${code}`),
    });
  } finally {
    clearingCache.value = false;
  }
}

function fmtUpdatedAt(iso: string | null): string {
  if (!iso) return t('adminRemoteConfig.row.notUpdated');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
</script>

<template>
  <section
    class="space-y-3 bg-ink-700/30 border border-ink-300/20 rounded p-3"
    data-testid="admin-remote-config-panel"
  >
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-lg text-amber-200">
          {{ t('adminRemoteConfig.title') }}
        </h2>
        <p class="text-xs text-ink-300">
          {{ t('adminRemoteConfig.hint') }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <MButton
          :disabled="loading"
          data-testid="admin-remote-config-refresh"
          @click="refresh"
        >
          {{ t('adminRemoteConfig.actions.refresh') }}
        </MButton>
        <MButton
          :disabled="refreshingDefaults"
          data-testid="admin-remote-config-refresh-defaults"
          @click="refreshDefaults"
        >
          {{ t('adminRemoteConfig.actions.refreshDefaults') }}
        </MButton>
        <MButton
          :disabled="clearingCache"
          data-testid="admin-remote-config-clear-cache"
          @click="clearCache"
        >
          {{ t('adminRemoteConfig.actions.clearCache') }}
        </MButton>
      </div>
    </header>

    <div class="flex flex-wrap items-center gap-2 text-sm">
      <input
        v-model="search"
        type="text"
        :placeholder="t('adminRemoteConfig.filter.searchPlaceholder')"
        class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
        data-testid="admin-remote-config-search"
      />
    </div>

    <div
      v-if="loading"
      class="text-ink-300 text-sm"
      data-testid="admin-remote-config-loading"
    >
      {{ t('adminRemoteConfig.loading') }}
    </div>
    <div
      v-else-if="error"
      class="text-rose-400 text-sm"
      data-testid="admin-remote-config-error"
    >
      {{
        t(`adminRemoteConfig.errors.${error}`, '__missing__') === '__missing__'
          ? t('adminRemoteConfig.errors.UNKNOWN')
          : t(`adminRemoteConfig.errors.${error}`)
      }}
    </div>
    <div
      v-else-if="filtered.length === 0"
      class="text-ink-300 text-sm italic"
      data-testid="admin-remote-config-empty"
    >
      {{ t('adminRemoteConfig.empty') }}
    </div>
    <ul v-else class="space-y-2" data-testid="admin-remote-config-list">
      <li
        v-for="c in filtered"
        :key="c.key"
        class="bg-ink-800/40 border border-ink-300/20 rounded p-3"
        :data-testid="`admin-remote-config-row-${c.key}`"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="space-y-1 min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span
                class="font-mono text-sm text-ink-100"
                :data-testid="`admin-remote-config-key-${c.key}`"
              >{{ c.key }}</span>
              <span
                class="text-[10px] px-1.5 py-0.5 rounded bg-ink-700/40 border border-ink-300/30 text-ink-300"
              >{{ c.valueType }}</span>
              <span
                v-if="c.public"
                class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-200"
                :title="t('adminRemoteConfig.row.publicHint')"
              >{{ t('adminRemoteConfig.row.publicTag') }}</span>
            </div>
            <p class="text-xs text-ink-200">{{ c.descriptionVi }}</p>
            <p class="text-xs text-ink-300">{{ c.descriptionEn }}</p>
            <p class="text-xs text-ink-400">
              {{
                t('adminRemoteConfig.row.default', {
                  value: formatValue(c.defaultValue),
                })
              }}
              ·
              {{
                t('adminRemoteConfig.row.updatedAt', {
                  at: fmtUpdatedAt(c.updatedAt),
                })
              }}
            </p>
            <p
              class="text-xs text-emerald-200 font-mono break-all"
              :data-testid="`admin-remote-config-value-${c.key}`"
            >
              {{
                t('adminRemoteConfig.row.current', {
                  value: formatValue(c.value),
                })
              }}
            </p>
          </div>
          <div class="flex flex-col items-end gap-2 w-full md:w-auto md:min-w-[20rem]">
            <div
              v-if="drafts[c.key]?.active"
              class="w-full space-y-2"
              :data-testid="`admin-remote-config-edit-${c.key}`"
            >
              <textarea
                v-if="c.valueType === 'json' || c.valueType === 'string'"
                v-model="drafts[c.key].raw"
                rows="3"
                class="w-full bg-ink-700/50 border border-ink-300/30 rounded px-2 py-1 text-sm font-mono"
                :data-testid="`admin-remote-config-input-${c.key}`"
              />
              <input
                v-else
                v-model="drafts[c.key].raw"
                type="text"
                class="w-full bg-ink-700/50 border border-ink-300/30 rounded px-2 py-1 text-sm font-mono"
                :placeholder="c.valueType === 'boolean' ? 'true / false' : '0'"
                :data-testid="`admin-remote-config-input-${c.key}`"
              />
              <input
                v-model="reasonByKey[c.key]"
                type="text"
                :placeholder="t('adminRemoteConfig.row.reasonPlaceholder')"
                class="w-full bg-ink-700/50 border border-ink-300/30 rounded px-2 py-1 text-sm"
                maxlength="500"
                :data-testid="`admin-remote-config-reason-${c.key}`"
              />
              <div class="flex justify-end gap-2">
                <MButton
                  :disabled="drafts[c.key].saving"
                  :data-testid="`admin-remote-config-cancel-${c.key}`"
                  @click="cancelEdit(c.key)"
                >
                  {{ t('adminRemoteConfig.actions.cancel') }}
                </MButton>
                <MButton
                  :disabled="drafts[c.key].saving"
                  :data-testid="`admin-remote-config-save-${c.key}`"
                  @click="requestSave(c)"
                >
                  {{
                    drafts[c.key].saving
                      ? t('common.loading')
                      : t('adminRemoteConfig.actions.save')
                  }}
                </MButton>
              </div>
            </div>
            <MButton
              v-else
              :data-testid="`admin-remote-config-edit-btn-${c.key}`"
              @click="startEdit(c)"
            >
              {{ t('adminRemoteConfig.actions.edit') }}
            </MButton>
          </div>
        </div>
      </li>
    </ul>

    <ConfirmModal
      :open="pendingSave !== null"
      :title="t('adminRemoteConfig.confirm.title')"
      :message="
        pendingSave
          ? t('adminRemoteConfig.confirm.message', {
            key: pendingSave.key,
            value: pendingSave.rawDisplay,
            reason: pendingSave.reason,
          })
          : ''
      "
      :confirm-text="t('adminRemoteConfig.actions.save')"
      test-id="admin-remote-config-confirm"
      @confirm="confirmPendingSave"
      @cancel="cancelPendingSave"
    />
  </section>
</template>
