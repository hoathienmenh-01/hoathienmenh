<script setup lang="ts">
/**
 * Phase 32.0 — Admin Codex View.
 *
 * - Reindex trigger với reason → audit.
 * - Audit issues list.
 * - Hide/Show entry (visibility change → audit).
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import {
  adminReindexCodex,
  adminListCodexIssues,
  adminHideCodex,
  adminShowCodex,
} from '@/api/codex';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import MButton from '@/components/ui/MButton.vue';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();

const loading = ref(false);
const issues = ref<Array<{
  id: string;
  issueKey: string;
  entryKey: string;
  type: string;
  severity: string;
  message: string;
  resolved: boolean;
}>>([]);
const reindexReason = ref('');
const hideForm = ref({ entryKey: '', reason: '' });
const showForm = ref({ entryKey: '', reason: '' });

async function refresh() {
  loading.value = true;
  try {
    issues.value = await adminListCodexIssues({ resolved: false });
  } catch (e) {
    toast.push({ type: 'error', text: extractApiErrorCodeOrDefault(e, t('common.error')) });
  } finally {
    loading.value = false;
  }
}

async function doReindex() {
  if (reindexReason.value.length < 3) {
    toast.push({ type: 'error', text: t('adminCodex.reasonRequired') });
    return;
  }
  try {
    const r = await adminReindexCodex(reindexReason.value);
    toast.push({ type: 'success', text: t('adminCodex.reindexSuccess', { upserted: r.entriesUpserted, removed: r.entriesRemoved, issues: r.issuesFound }) });
    reindexReason.value = '';
    await refresh();
  } catch (e) {
    toast.push({ type: 'error', text: extractApiErrorCodeOrDefault(e, t('common.error')) });
  }
}

async function doHide() {
  try {
    await adminHideCodex(hideForm.value.entryKey, hideForm.value.reason);
    toast.push({ type: 'success', text: t('adminCodex.hideSuccess') });
    hideForm.value = { entryKey: '', reason: '' };
  } catch (e) {
    toast.push({ type: 'error', text: extractApiErrorCodeOrDefault(e, t('common.error')) });
  }
}

async function doShow() {
  try {
    await adminShowCodex(showForm.value.entryKey, showForm.value.reason);
    toast.push({ type: 'success', text: t('adminCodex.showSuccess') });
    showForm.value = { entryKey: '', reason: '' };
  } catch (e) {
    toast.push({ type: 'error', text: extractApiErrorCodeOrDefault(e, t('common.error')) });
  }
}

onMounted(async () => {
  await auth.hydrate();
  void refresh();
});
</script>

<template>
  <AppShell>
    <div class="space-y-4 p-4">
      <XTPageEyebrow caps="THIÊN TỊCH TỔNG BÁC" label="Thiên Tịch Tổng Bác" />
      <h1 class="text-xl font-bold mt-1">{{ t('adminCodex.title') }}</h1>

      <!-- Reindex -->
      <div class="bg-gray-800 rounded p-3 space-y-2">
        <h2 class="font-semibold">{{ t('adminCodex.reindexTitle') }}</h2>
        <div class="flex gap-2">
          <input
            v-model="reindexReason"
            :placeholder="t('adminCodex.reasonPlaceholder')"
            class="flex-1 bg-gray-900 rounded px-2 py-1"
          />
          <MButton @click="doReindex">{{ t('adminCodex.reindex') }}</MButton>
        </div>
      </div>

      <!-- Hide -->
      <div class="bg-gray-800 rounded p-3 space-y-2">
        <h2 class="font-semibold">{{ t('adminCodex.hideTitle') }}</h2>
        <div class="grid grid-cols-2 gap-2">
          <input v-model="hideForm.entryKey" :placeholder="t('adminCodex.entryKey')" class="bg-gray-900 rounded px-2 py-1" />
          <input v-model="hideForm.reason" :placeholder="t('adminCodex.reason')" class="bg-gray-900 rounded px-2 py-1" />
        </div>
        <MButton variant="secondary" @click="doHide">{{ t('adminCodex.hide') }}</MButton>
      </div>

      <!-- Show -->
      <div class="bg-gray-800 rounded p-3 space-y-2">
        <h2 class="font-semibold">{{ t('adminCodex.showTitle') }}</h2>
        <div class="grid grid-cols-2 gap-2">
          <input v-model="showForm.entryKey" :placeholder="t('adminCodex.entryKey')" class="bg-gray-900 rounded px-2 py-1" />
          <input v-model="showForm.reason" :placeholder="t('adminCodex.reason')" class="bg-gray-900 rounded px-2 py-1" />
        </div>
        <MButton @click="doShow">{{ t('adminCodex.show') }}</MButton>
      </div>

      <!-- Audit issues -->
      <div class="space-y-2">
        <h2 class="font-semibold">{{ t('adminCodex.issuesTitle') }}</h2>
        <div v-if="loading" class="text-gray-400">{{ t('common.loading') }}</div>
        <table v-else class="w-full text-sm">
          <thead>
            <tr class="text-left text-gray-400">
              <th>{{ t('adminCodex.entryKey') }}</th>
              <th>{{ t('adminCodex.issueType') }}</th>
              <th>{{ t('adminCodex.severity') }}</th>
              <th>{{ t('adminCodex.message') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in issues" :key="i.id" class="border-t border-gray-700">
              <td class="py-1 font-mono text-xs">{{ i.entryKey }}</td>
              <td>{{ i.type }}</td>
              <td>{{ i.severity }}</td>
              <td class="text-gray-300">{{ i.message }}</td>
            </tr>
            <tr v-if="issues.length === 0">
              <td colspan="4" class="text-gray-500 text-center py-4">{{ t('adminCodex.noIssues') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppShell>
</template>
