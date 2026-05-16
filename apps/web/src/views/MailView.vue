<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import { claimMail, listMail, readMail, type MailView } from '@/api/mail';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTListStagger from '@/components/xianxia/XTListStagger.vue';
import MButton from '@/components/ui/MButton.vue';
import { formatItemRewardList } from '@/lib/itemName';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const mails = ref<MailView[]>([]);
const loading = ref(false);
const claiming = ref<string | null>(null);
const selectedId = ref<string | null>(null);
const selected = computed(() =>
  mails.value.find((m) => m.id === selectedId.value) ?? null,
);

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  game.clearMailBadge();
  // Smart onboarding: đánh dấu user đã kiểm tra thư (step 6).
  void import('@/lib/onboardingVisits').then((m) => m.markVisited('mail'));
  await refresh();
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    mails.value = await listMail();
  } catch (e) {
    handleErr(e);
  } finally {
    loading.value = false;
  }
}

async function select(m: MailView): Promise<void> {
  selectedId.value = m.id;
  if (m.readAt) return;
  try {
    const updated = await readMail(m.id);
    mails.value = mails.value.map((x) => (x.id === updated.id ? updated : x));
  } catch {
    // silent: không block việc đọc nội dung khi mark-read fail.
  }
}

async function onClaim(m: MailView): Promise<void> {
  if (claiming.value) return;
  claiming.value = m.id;
  try {
    const updated = await claimMail(m.id);
    mails.value = mails.value.map((x) => (x.id === updated.id ? updated : x));
    toast.push({
      type: 'success',
      text: t('mail.claimToast', { subject: m.subject }),
    });
    await game.fetchState().catch(() => null);
  } catch (e) {
    handleErr(e);
  } finally {
    claiming.value = null;
  }
}

function handleErr(e: unknown): void {
  const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  const text = t(`mail.errors.${code}`, '__missing__');
  toast.push({
    type: 'error',
    text: text === '__missing__' ? t('mail.errors.UNKNOWN') : text,
  });
}

const unread = computed(() => mails.value.filter((m) => !m.readAt).length);

function hasAnyReward(m: MailView): boolean {
  return (
    m.rewardLinhThach !== '0' ||
    m.rewardTienNgoc > 0 ||
    m.rewardExp !== '0' ||
    m.rewardItems.length > 0
  );
}

function rewardSummary(m: MailView): string {
  const parts: string[] = [];
  if (m.rewardLinhThach !== '0')
    parts.push(`${m.rewardLinhThach} ${t('mail.reward.linhThach')}`);
  if (m.rewardTienNgoc > 0)
    parts.push(`${m.rewardTienNgoc} ${t('mail.reward.tienNgoc')}`);
  if (m.rewardExp !== '0')
    parts.push(`${m.rewardExp} ${t('mail.reward.exp')}`);
  if (m.rewardItems.length) {
    parts.push(formatItemRewardList(m.rewardItems, t));
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
</script>

<template>
  <AppShell>
    <XTLuxHero
      :eyebrow="t('luxHero.mail.eyebrow')"
      :label="t('luxHero.mail.label')"
      :title="t('mail.title')"
      :subtitle="t('mail.subtitle', '')"
      tone="gold"
      watermark-letter="P"
      :breadcrumb="t('luxHero.mail.breadcrumb')"
      test-id="mail-view-hero"
      class="mb-4"
    >
      <XTPageEyebrow caps="PHI CÁP TRUYỀN THƯ" label="Phi Cáp Truyền Thư" class="sr-only" />
      <div class="flex items-center gap-3 flex-wrap mt-3">
        <span
          v-if="unread > 0"
          class="text-[11px] px-1.5 py-0.5 rounded bg-amber-700/40 text-amber-200"
        >
          {{ t('mail.unreadBadge', { n: unread }) }}
        </span>
        <MButton class="ml-auto" :disabled="loading" @click="refresh">
          {{ t('common.reload') }}
        </MButton>
      </div>
    </XTLuxHero>

    <div class="grid grid-cols-1 md:grid-cols-[16rem_minmax(0,1fr)] gap-4">
      <aside class="border border-ink-300/40 rounded bg-ink-700/30 p-2 max-h-[70vh] overflow-y-auto">
        <div v-if="loading && mails.length === 0" class="text-ink-300 text-sm p-2">
          {{ t('common.loadingData') }}
        </div>
        <div v-else-if="mails.length === 0" class="text-ink-300 text-sm p-2">
          {{ t('mail.empty') }}
        </div>
        <XTListStagger v-else tag="ul" class="space-y-1">
          <li
            v-for="(m, idx) in mails"
            :key="m.id"
            class="cursor-pointer rounded p-2 text-sm hover:bg-ink-900/60"
            :class="selectedId === m.id ? 'bg-ink-900/60' : ''"
            :style="{ '--xt-list-index': idx }"
            @click="select(m)"
          >
            <div class="flex items-center gap-2">
              <span
                v-if="!m.readAt"
                class="w-1.5 h-1.5 rounded-full bg-amber-400"
                :aria-label="t('mail.unread')"
              />
              <span class="flex-1 truncate" :class="m.readAt ? 'text-ink-300' : 'text-ink-50'">
                {{ m.subject }}
              </span>
              <span
                v-if="m.claimable"
                class="text-[10px] px-1 py-0.5 rounded bg-amber-700/40 text-amber-200"
              >
                {{ t('mail.rewardBadge') }}
              </span>
            </div>
            <div class="text-[10px] text-ink-300 mt-0.5">
              {{ m.senderName }} · {{ formatDate(m.createdAt) }}
            </div>
          </li>
        </XTListStagger>
      </aside>

      <section class="border border-ink-300/40 rounded bg-ink-700/30 p-4 min-h-[50vh]">
        <div v-if="!selected" class="text-ink-300 text-sm">
          {{ t('mail.selectHint') }}
        </div>
        <div v-else>
          <div class="flex items-start gap-3 flex-wrap">
            <div class="flex-1 min-w-0">
              <div class="text-lg text-ink-50 font-bold break-words">
                {{ selected.subject }}
              </div>
              <div class="text-xs text-ink-300 mt-1">
                {{ t('mail.from') }}: {{ selected.senderName }} ·
                {{ formatDate(selected.createdAt) }}
              </div>
              <div
                v-if="selected.expiresAt"
                class="text-[11px] text-amber-200 mt-1"
              >
                {{ t('mail.expiresAt') }}: {{ formatDate(selected.expiresAt) }}
              </div>
            </div>
            <div v-if="selected.claimable" class="shrink-0">
              <MButton
                :disabled="claiming === selected.id"
                @click="onClaim(selected)"
              >
                {{ claiming === selected.id ? t('common.loading') : t('mail.claim') }}
              </MButton>
            </div>
            <div
              v-else-if="selected.claimedAt"
              class="shrink-0 text-[11px] px-2 py-1 rounded bg-emerald-700/40 text-emerald-200"
            >
              {{ t('mail.status.claimed') }}
            </div>
          </div>

          <div
            v-if="hasAnyReward(selected)"
            class="mt-3 text-[12px] text-ink-200 border border-ink-300/30 rounded p-2"
          >
            {{ t('mail.reward.label') }}: {{ rewardSummary(selected) }}
          </div>

          <div class="mt-4 whitespace-pre-wrap text-sm text-ink-100">
            {{ selected.body }}
          </div>
        </div>
      </section>
    </div>
  </AppShell>
</template>
