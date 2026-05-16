<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import {
  getReturnerState,
  triggerReturnerCheck,
  type ReturnerStateView,
} from '@/api/returner';
import AppShell from '@/components/shell/AppShell.vue';
import MButton from '@/components/ui/MButton.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const auth = useAuthStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const state = ref<ReturnerStateView | null>(null);
const loading = ref(false);
const busy = ref(false);

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await refresh();
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    state.value = await getReturnerState();
  } catch (e) {
    handleErr(e);
  } finally {
    loading.value = false;
  }
}

async function onCheck(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const r = await triggerReturnerCheck();
    if (r.mailId) {
      toast.push({ type: 'success', text: t('returner.checkSuccess') });
    } else {
      toast.push({ type: 'info', text: t('returner.checkNoop') });
    }
    await refresh();
  } catch (e) {
    handleErr(e);
  } finally {
    busy.value = false;
  }
}

function handleErr(e: unknown): void {
  const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  toast.push({ type: 'error', text: code });
}
</script>

<template>
  <AppShell>
    <section class="returner-view" data-testid="returner-view">
      <XTLuxHero
        eyebrow="CỐ NHÂN QUY HOÀN"
        label="Cố Nhân Quy Hoàn"
        :title="t('returner.title')"
        :subtitle="t('returner.subtitle')"
        tone="gold"
        watermark-letter="C"
        breadcrumb="Sự Kiện · Hồi Quy"
        test-id="returner-view-hero"
      >
        <XTPageEyebrow caps="CỐ NHÂN QUY HOÀN" label="Cố Nhân Quy Hoàn" class="sr-only" />
      </XTLuxHero>

      <div v-if="loading" data-testid="returner-loading">{{ t('common.loading') }}</div>

      <div v-else class="panel" data-testid="returner-panel">
        <p v-if="!state" class="muted">{{ t('returner.noState') }}</p>
        <template v-else>
          <p>{{ t('returner.inactiveDays', { days: state.inactiveDays }) }}</p>
          <p v-if="state.currentTier">
            {{ t('returner.currentTier', { tier: state.currentTier }) }}
          </p>
          <p v-else class="muted">{{ t('returner.noTier') }}</p>
          <MButton :disabled="busy" data-testid="returner-check-btn" @click="onCheck">
            {{ t('returner.check') }}
          </MButton>
        </template>
      </div>
    </section>
  </AppShell>
</template>

<style scoped>
.returner-view {
  padding: 1rem;
}
.panel {
  border: 1px solid var(--border-color, #444);
  border-radius: 8px;
  padding: 1rem;
  max-width: 480px;
}
.muted {
  opacity: 0.7;
}
</style>
