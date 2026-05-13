<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import {
  listAdminMailLogs,
  sendBulk,
  sendGlobal,
  sendOne,
  type AdminMailLogRow,
  type SystemGiftTargetRule,
} from '@/api/adminMail';
import type { MailType } from '@/api/mail';
import AppShell from '@/components/shell/AppShell.vue';
import MButton from '@/components/ui/MButton.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const auth = useAuthStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

type Tab = 'sendOne' | 'sendBulk' | 'sendGlobal' | 'logs';
const tab = ref<Tab>('sendOne');
const logs = ref<AdminMailLogRow[]>([]);
const loadingLogs = ref(false);
const busy = ref(false);

const mailType = ref<MailType>('ADMIN');
const subject = ref('');
const body = ref('');
const reason = ref('');
const linhThach = ref('0');
const expiresAt = ref('');

// SEND_ONE state.
const recipientId = ref('');
// SEND_BULK state.
const recipientsCsv = ref('');
// SEND_GLOBAL state.
const targetType = ref<SystemGiftTargetRule['type']>('ALL_PLAYERS');
const previewOnly = ref(true);

const mailTypes: MailType[] = [
  'SYSTEM',
  'ADMIN',
  'REWARD',
  'EVENT',
  'MAINTENANCE',
  'PURCHASE',
  'SECT',
  'FRIEND',
  'RETURNER',
];
const targetTypes: SystemGiftTargetRule['type'][] = [
  'ALL_PLAYERS',
  'REALM_RANGE',
  'CREATED_BEFORE',
  'ACTIVE_IN_LAST_DAYS',
];

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await loadLogs();
});

async function loadLogs(): Promise<void> {
  loadingLogs.value = true;
  try {
    logs.value = await listAdminMailLogs({ limit: 50 });
  } catch (e) {
    handleErr(e);
  } finally {
    loadingLogs.value = false;
  }
}

function rewardObj() {
  return {
    linhThach: linhThach.value || '0',
    tienNgoc: 0,
    exp: '0',
    items: [],
  };
}

async function onSubmit(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    let r;
    const base = {
      mailType: mailType.value,
      subject: subject.value,
      body: body.value,
      reward: rewardObj(),
      expiresAt: expiresAt.value || null,
      reason: reason.value,
    };
    if (tab.value === 'sendOne') {
      r = await sendOne({ ...base, recipientCharacterId: recipientId.value });
    } else if (tab.value === 'sendBulk') {
      const ids = recipientsCsv.value
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      r = await sendBulk({ ...base, recipientCharacterIds: ids });
    } else {
      r = await sendGlobal({
        ...base,
        targetRule: { type: targetType.value },
        previewOnly: previewOnly.value,
      });
    }
    if (tab.value === 'sendGlobal' && previewOnly.value) {
      toast.push({
        type: 'info',
        text: t('adminMail.toast.preview', { count: r.targetCount }),
      });
    } else {
      toast.push({
        type: 'success',
        text: t('adminMail.toast.sent', { count: r.mailCount }),
      });
    }
    await loadLogs();
  } catch (e) {
    handleErr(e);
  } finally {
    busy.value = false;
  }
}

function handleErr(e: unknown): void {
  const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  toast.push({ type: 'error', text: t(`adminMail.error.${code}`, code) });
}
</script>

<template>
  <AppShell>
    <section class="admin-mail-view" data-testid="admin-mail-view">
      <h1>{{ t('adminMail.title') }}</h1>
      <p class="muted">{{ t('adminMail.subtitle') }}</p>

      <nav class="tabs" data-testid="admin-mail-tabs">
        <button
          v-for="tk in (['sendOne', 'sendBulk', 'sendGlobal', 'logs'] as const)"
          :key="tk"
          :class="{ active: tab === tk }"
          :data-testid="`admin-mail-tab-${tk}`"
          @click="tab = tk"
        >
          {{ t(`adminMail.tabs.${tk}`) }}
        </button>
      </nav>

      <article v-if="tab !== 'logs'" class="panel form">
        <label class="field">
          <span>{{ t('adminMail.form.mailType') }}</span>
          <select v-model="mailType" data-testid="admin-mail-type">
            <option v-for="m in mailTypes" :key="m" :value="m">{{ m }}</option>
          </select>
        </label>
        <label class="field">
          <span>{{ t('adminMail.form.subject') }}</span>
          <input v-model="subject" data-testid="admin-mail-subject" />
        </label>
        <label class="field">
          <span>{{ t('adminMail.form.body') }}</span>
          <textarea v-model="body" data-testid="admin-mail-body" />
        </label>
        <label class="field">
          <span>{{ t('adminMail.form.reason') }}</span>
          <input v-model="reason" minlength="4" data-testid="admin-mail-reason" />
        </label>
        <label class="field">
          <span>Linh Thạch</span>
          <input v-model="linhThach" data-testid="admin-mail-linhthach" />
        </label>
        <label class="field">
          <span>{{ t('adminMail.form.expiresAt') }}</span>
          <input v-model="expiresAt" placeholder="2026-12-31T23:59:59Z" />
        </label>

        <template v-if="tab === 'sendOne'">
          <label class="field">
            <span>{{ t('adminMail.form.recipient') }}</span>
            <input v-model="recipientId" data-testid="admin-mail-recipient" />
          </label>
        </template>
        <template v-else-if="tab === 'sendBulk'">
          <label class="field">
            <span>{{ t('adminMail.form.recipients') }}</span>
            <textarea v-model="recipientsCsv" data-testid="admin-mail-recipients" />
          </label>
        </template>
        <template v-else>
          <label class="field">
            <span>{{ t('adminMail.form.targetType') }}</span>
            <select v-model="targetType" data-testid="admin-mail-target-type">
              <option v-for="t2 in targetTypes" :key="t2" :value="t2">{{ t2 }}</option>
            </select>
          </label>
          <label class="field-row">
            <input v-model="previewOnly" type="checkbox" data-testid="admin-mail-preview" />
            <span>{{ t('adminMail.form.previewOnly') }}</span>
          </label>
        </template>

        <MButton
          :disabled="busy || !subject || !body || !reason"
          data-testid="admin-mail-submit"
          @click="onSubmit"
        >
          {{ t('adminMail.form.submit') }}
        </MButton>
      </article>

      <article v-else class="panel">
        <h2>{{ t('adminMail.tabs.logs') }}</h2>
        <p v-if="loadingLogs">{{ t('common.loading') }}</p>
        <table v-else data-testid="admin-mail-logs">
          <thead>
            <tr>
              <th>{{ t('adminMail.logs.createdAt') }}</th>
              <th>{{ t('adminMail.logs.kind') }}</th>
              <th>{{ t('adminMail.logs.subject') }}</th>
              <th>{{ t('adminMail.logs.mailCount') }}</th>
              <th>{{ t('adminMail.logs.reason') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in logs" :key="l.id">
              <td>{{ l.createdAt }}</td>
              <td>{{ l.kind }}</td>
              <td>{{ l.subject }}</td>
              <td>{{ l.mailCount }}</td>
              <td>{{ l.reason }}</td>
            </tr>
          </tbody>
        </table>
      </article>
    </section>
  </AppShell>
</template>

<style scoped>
.admin-mail-view {
  padding: 1rem;
}
.tabs {
  display: flex;
  gap: 0.25rem;
  margin: 1rem 0;
}
.tabs button {
  padding: 0.5rem 1rem;
  border: 1px solid var(--border-color, #444);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.tabs button.active {
  background: var(--bg-accent, #335);
}
.panel {
  border: 1px solid var(--border-color, #444);
  border-radius: 8px;
  padding: 1rem;
}
.field,
.field-row {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0.5rem 0;
  max-width: 480px;
}
.field-row {
  flex-direction: row;
  align-items: center;
}
input,
textarea,
select {
  background: var(--bg-input, #222);
  color: var(--text-primary, #eee);
  border: 1px solid var(--border-color, #444);
  border-radius: 4px;
  padding: 0.25rem 0.5rem;
}
textarea {
  min-height: 60px;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid var(--border-color, #333);
  text-align: left;
}
.muted {
  opacity: 0.7;
}
</style>
