<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { itemByKey } from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useBodyCultivationStore } from '@/stores/bodyCultivation';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTSealFrame from '@/components/xianxia/XTSealFrame.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';

const auth = useAuthStore();
const body = useBodyCultivationStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const confirmOpen = ref(false);

const status = computed(() => body.status);
const progressPct = computed(() => `${Math.round(body.progress * 100)}%`);
const bodyExpText = computed(() => {
  if (!status.value) return '0 / 0';
  return `${status.value.bodyExp} / ${status.value.bodyExpNext}`;
});
const injuryActive = computed(() => {
  if (!status.value?.bodyInjuryUntil) return false;
  return new Date(status.value.bodyInjuryUntil).getTime() > Date.now();
});
const missingNames = computed(() =>
  (status.value?.missingMaterials ?? []).map((m) => ({
    ...m,
    name: itemByKey(m.itemKey)?.name ?? m.itemKey,
  })),
);
const requirementMaterials = computed(() =>
  (status.value?.breakthroughRequirement?.materials ?? []).map((m) => ({
    ...m,
    name: itemByKey(m.itemKey)?.name ?? m.itemKey,
  })),
);
const requiredPillName = computed(() => {
  const key = status.value?.breakthroughRequirement?.pillItemKey;
  return key ? (itemByKey(key)?.name ?? key) : null;
});

function toastError(prefix: string, code: string | null): void {
  const key = `${prefix}.errors.${code ?? 'UNKNOWN'}`;
  const text = t(key);
  toast.push({ type: 'error', text: text === key ? t(`${prefix}.errors.UNKNOWN`) : text });
}

async function toggleCultivation(): Promise<void> {
  const err = status.value?.bodyCultivating ? await body.stop() : await body.start();
  if (err === null) {
    toast.push({
      type: 'success',
      text: status.value?.bodyCultivating
        ? t('bodyCultivation.toast.started')
        : t('bodyCultivation.toast.stopped'),
    });
  } else {
    toastError('bodyCultivation.action', err);
  }
}

async function doBreakthrough(): Promise<void> {
  confirmOpen.value = false;
  const result = await body.breakthrough();
  if (result.code) {
    toastError('bodyCultivation.breakthrough', result.code);
    return;
  }
  toast.push({
    type: result.success ? 'success' : 'warning',
    text: result.success
      ? t('bodyCultivation.breakthrough.success')
      : t('bodyCultivation.breakthrough.failed'),
  });
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await Promise.all([game.fetchState().catch(() => null), body.fetchState().catch(() => null)]);
  game.bindSocket();
});
</script>

<template>
  <AppShell>
    <div class="max-w-5xl mx-auto space-y-4">
      <XTLuxHero
        eyebrow="LUYỆN THỂ ĐẠO"
        label="Đại Đạo Tu Thể"
        :title="t('bodyCultivation.title')"
        :subtitle="t('bodyCultivation.subtitle')"
        tone="jade"
        watermark-letter="Đ"
        breadcrumb="Tu Tiên Lộ · Luyện Thể"
        test-id="body-cultivation-hero"
      >
        <XTPageEyebrow
          caps="LUYỆN THỂ ĐẠO"
          label="Luyện Thể Đạo"
          class="sr-only"
        />
        <RouterLink to="/home" class="text-xs text-amber-200 hover:text-amber-100">
          {{ t('bodyCultivation.backHome') }}
        </RouterLink>
      </XTLuxHero>

      <section
        v-if="body.loading && !body.loaded"
        class="rounded-2xl border border-ink-600/70 bg-ink-900/70 p-5 text-sm text-ink-300"
      >
        {{ t('bodyCultivation.loading') }}
      </section>

      <section
        v-else-if="!status"
        class="rounded-2xl border border-rose-500/40 bg-rose-950/30 p-5 text-sm text-rose-100"
      >
        {{ t('bodyCultivation.empty') }}
      </section>

      <template v-else>
        <XTSealFrame
          tone="jade"
          corner-ornaments="❖✦❖✦"
          watermark-letter="Đ"
          rounded="xl"
          inset="tight"
          test-id="body-cultivation-seal-frame"
          aria-label="Luyện Thể Đạo hero frame"
        >
          <section class="grid md:grid-cols-3 gap-4">
            <div class="md:col-span-2 rounded-2xl border border-amber-500/30 bg-ink-900/80 p-5">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p class="text-xs uppercase tracking-[0.25em] text-amber-300">
                    {{ t('bodyCultivation.realmLabel') }}
                  </p>
                  <h2 class="text-2xl font-bold mt-1">{{ status.bodyRealmName }}</h2>
                  <p class="text-sm text-ink-300 mt-1">
                    {{ t('bodyCultivation.stage', { stage: status.bodyStage }) }}
                  </p>
                </div>
                <span
                  class="px-3 py-1 rounded-full text-xs border"
                  :class="
                    status.bodyCultivating
                      ? 'border-emerald-400/50 text-emerald-200 bg-emerald-950/30'
                      : 'border-ink-500 text-ink-300 bg-ink-800/70'
                  "
                >
                  {{
                    status.bodyCultivating
                      ? t('bodyCultivation.training.on')
                      : t('bodyCultivation.training.off')
                  }}
                </span>
              </div>

              <div class="mt-5">
                <div class="flex justify-between text-xs text-ink-300 mb-1">
                  <span>{{ t('bodyCultivation.exp') }}</span>
                  <span>{{ bodyExpText }}</span>
                </div>
                <div class="h-3 rounded-full bg-ink-800 overflow-hidden">
                  <div class="h-full bg-amber-400" :style="{ width: progressPct }" />
                </div>
                <p class="text-xs text-ink-400 mt-2">
                  {{ t('bodyCultivation.rate', { rate: status.bodyRate }) }}
                </p>
              </div>

              <div
                v-if="injuryActive"
                class="mt-4 rounded-xl border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-100"
                data-testid="body-injury"
              >
                {{ t('bodyCultivation.injury', { until: status.bodyInjuryUntil }) }}
              </div>

              <div class="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  class="px-4 py-2 rounded-xl bg-amber-500 text-ink-950 font-semibold disabled:opacity-50"
                  :disabled="body.actionLoading"
                  data-testid="body-cultivation-toggle"
                  @click="toggleCultivation"
                >
                  {{
                    status.bodyCultivating
                      ? t('bodyCultivation.stop')
                      : t('bodyCultivation.start')
                  }}
                </button>
                <button
                  type="button"
                  class="px-4 py-2 rounded-xl bg-violet-500 text-white font-semibold disabled:opacity-50"
                  :disabled="body.actionLoading || !status.canBreakthrough"
                  data-testid="body-breakthrough-button"
                  @click="confirmOpen = true"
                >
                  {{ t('bodyCultivation.breakthrough.button') }}
                </button>
              </div>
            </div>

            <aside class="rounded-2xl border border-ink-600/70 bg-ink-900/70 p-5">
              <h3 class="font-semibold text-ink-100">{{ t('bodyCultivation.stats.title') }}</h3>
              <dl class="mt-3 space-y-2 text-sm">
                <div class="flex justify-between">
                  <dt>HP Max</dt>
                  <dd>+{{ status.statBonus.hpMax }}</dd>
                </div>
                <div class="flex justify-between">
                  <dt>Power</dt>
                  <dd>+{{ status.statBonus.power }}</dd>
                </div>
                <div class="flex justify-between">
                  <dt>DEF</dt>
                  <dd>+{{ status.statBonus.def }}</dd>
                </div>
                <div class="flex justify-between">
                  <dt>Stamina</dt>
                  <dd>+{{ status.statBonus.staminaMax }}</dd>
                </div>
                <div class="flex justify-between">
                  <dt>{{ t('bodyCultivation.stats.bossReduction') }}</dt>
                  <dd>{{ Math.round(status.statBonus.bossDamageReduction * 100) }}%</dd>
                </div>
              </dl>
            </aside>
          </section>

          <section class="rounded-2xl border border-ink-600/70 bg-ink-900/70 p-5">
            <h3 class="font-semibold text-ink-100">
              {{ t('bodyCultivation.breakthrough.requirement') }}
            </h3>
            <div v-if="status.breakthroughRequirement" class="mt-3 grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <p class="text-ink-300">
                  {{ t('bodyCultivation.breakthrough.requiredExp') }}:
                  <span class="text-ink-100">{{ status.breakthroughRequirement.bodyExpCost }}</span>
                </p>
                <p v-if="requiredPillName" class="text-ink-300 mt-2">
                  {{ t('bodyCultivation.breakthrough.requiredPill') }}:
                  <span class="text-ink-100">{{ requiredPillName }}</span>
                </p>
              </div>
              <div>
                <p class="text-ink-300">{{ t('bodyCultivation.breakthrough.materials') }}</p>
                <ul class="mt-2 space-y-1">
                  <li v-for="m in requirementMaterials" :key="m.itemKey">
                    {{ m.name }} × {{ m.qty }}
                  </li>
                </ul>
              </div>
            </div>
            <p v-else class="mt-3 text-sm text-ink-300">
              {{ t('bodyCultivation.breakthrough.maxed') }}
            </p>

            <div
              v-if="missingNames.length > 0"
              class="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3"
              data-testid="body-missing-materials"
            >
              <p class="text-sm text-amber-200">{{ t('bodyCultivation.breakthrough.missing') }}</p>
              <ul class="mt-2 text-sm text-ink-200 space-y-1">
                <li v-for="m in missingNames" :key="m.itemKey">
                  {{ m.name }} × {{ m.required }} ({{ m.owned }})
                </li>
              </ul>
            </div>
          </section>
        </XTSealFrame>
      </template>
    </div>

    <div
      v-if="confirmOpen"
      class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      data-testid="body-breakthrough-confirm"
    >
      <div class="max-w-md w-full rounded-2xl border border-violet-400/40 bg-ink-950 p-5">
        <h3 class="text-lg font-bold">{{ t('bodyCultivation.breakthrough.confirmTitle') }}</h3>
        <p class="text-sm text-ink-300 mt-2">{{ t('bodyCultivation.breakthrough.confirmBody') }}</p>
        <div class="mt-5 flex justify-end gap-3">
          <button
            class="px-3 py-2 rounded bg-ink-700"
            data-testid="body-breakthrough-cancel"
            @click="confirmOpen = false"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="px-3 py-2 rounded bg-violet-500 text-white"
            data-testid="body-breakthrough-confirm-submit"
            @click="doBreakthrough"
          >
            {{ t('bodyCultivation.breakthrough.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </AppShell>
</template>
