<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { useSecretRealmStore } from '@/stores/secretRealm';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import type { SecretRealmListEntry } from '@/api/secretRealm';

/**
 * Phase 34.2 — Secret Realm / Bí Cảnh runtime view.
 *
 * Layout:
 *   - Realm list (cards) with status badge.
 *   - Active run panel: objective progress bars + complete + claim CTA.
 */

const auth = useAuthStore();
const store = useSecretRealmStore();
const toast = useToastStore();
const { t, locale } = useI18n();

const isVi = computed(() => locale.value === 'vi');
const selectedRealm = ref<string | null>(null);

function pickLocale(vi: string, en: string): string {
  return isVi.value ? vi : en;
}

function errText(code: string | null): string {
  if (!code) return '';
  const key = `secretRealm.error.${code}`;
  const text = t(key);
  return text === key ? t('secretRealm.error.UNKNOWN_ERROR') : text;
}

async function refresh(): Promise<void> {
  await store.loadAll();
  if (store.lastError)
    toast.push({ type: 'error', text: errText(store.lastError) });
}

async function onEnter(r: SecretRealmListEntry): Promise<void> {
  if (r.status !== 'AVAILABLE') return;
  selectedRealm.value = r.key;
  await store.enter(r.key);
  if (store.lastError)
    toast.push({ type: 'error', text: errText(store.lastError) });
}

async function onProgress(objKey: string, target: number): Promise<void> {
  if (!store.activeRun) return;
  await store.progress(store.activeRun.id, objKey, target);
  if (store.lastError)
    toast.push({ type: 'error', text: errText(store.lastError) });
}

async function onComplete(): Promise<void> {
  if (!store.activeRun) return;
  await store.complete(store.activeRun.id);
  if (store.lastError)
    toast.push({ type: 'error', text: errText(store.lastError) });
}

async function onClaim(): Promise<void> {
  if (!store.activeRun) return;
  await store.claim(store.activeRun.id);
  if (store.lastError) {
    toast.push({ type: 'error', text: errText(store.lastError) });
    return;
  }
  const last = store.lastClaim;
  if (last?.claimed) {
    toast.push({
      type: 'success',
      text: t('secretRealm.claimToast', {
        linhThach: last.linhThachGranted,
        exp: last.expGranted,
      }),
    });
  }
}

const activeRealmDef = computed(() => {
  if (!store.activeRun) return null;
  return (
    store.realms.find((r) => r.key === store.activeRun!.secretRealmKey) ?? null
  );
});

watch(
  () => auth.user,
  async (u) => {
    if (u) await refresh();
  },
);

onMounted(async () => {
  if (auth.user) await refresh();
});
</script>

<template>
  <AppShell>
    <section class="space-y-4 p-4">
      <XTLuxHero
        :eyebrow="t('luxHero.secretRealm.eyebrow')"
        :label="t('luxHero.secretRealm.label')"
        :title="t('secretRealm.title')"
        :subtitle="t('secretRealm.subtitle')"
        tone="seal"
        watermark-letter="B"
        :breadcrumb="t('luxHero.secretRealm.breadcrumb')"
        test-id="secret-realm-hero"
      >
        <XTPageEyebrow caps="BÍ CẢNH THỬ LUYỆN" label="Bí Cảnh Thử Luyện" class="sr-only" />
      </XTLuxHero>

      <p
        v-if="store.loading"
        class="rounded border border-gray-800 bg-gray-900 p-4 text-center text-gray-400"
      >
        {{ t('secretRealm.loading') }}
      </p>

      <!-- Realm list -->
      <div
        v-else
        class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3"
        data-testid="secret-realm-list"
      >
        <article
          v-for="r in store.realms"
          :key="r.key"
          class="rounded-lg border bg-gray-900 p-3"
          :class="
            r.status === 'AVAILABLE'
              ? 'border-amber-700 hover:border-amber-400'
              : 'border-gray-800 opacity-50'
          "
          :data-testid="`secret-realm-card-${r.key}`"
        >
          <div class="flex items-center justify-between text-xs uppercase">
            <span class="rounded bg-gray-800 px-2 py-0.5">
              {{ t(`secretRealm.gate.${r.status}`) }}
            </span>
            <span class="text-gray-400">
              {{ t('secretRealm.requiredRealm', { n: r.requiredRealmOrder }) }}
            </span>
          </div>
          <h2 class="mt-2 text-base font-semibold">
            {{ pickLocale(r.nameVi, r.nameEn) }}
          </h2>
          <p class="mt-1 text-xs text-gray-300">
            {{ pickLocale(r.descriptionVi, r.descriptionEn) }}
          </p>
          <div class="mt-2 flex flex-wrap gap-2 text-xs">
            <span class="rounded bg-amber-900/40 px-2 py-0.5 text-amber-200">
              +{{ r.rewardProfile.linhThach }}
              {{ t('secretRealm.reward.linhThach') }}
            </span>
            <span class="rounded bg-blue-900/40 px-2 py-0.5 text-blue-200">
              +{{ r.rewardProfile.exp }}
              {{ t('secretRealm.reward.exp') }}
            </span>
          </div>
          <button
            type="button"
            class="mt-3 rounded bg-amber-700 px-3 py-1 text-sm hover:bg-amber-600 disabled:opacity-50"
            :disabled="r.status !== 'AVAILABLE' || !!store.submitting"
            :data-testid="`secret-realm-enter-${r.key}`"
            @click="onEnter(r)"
          >
            {{ t('secretRealm.enter') }}
          </button>
        </article>
      </div>

      <!-- Active run -->
      <section
        v-if="store.activeRun && activeRealmDef"
        class="rounded-lg border border-emerald-700 bg-gray-900 p-4"
        data-testid="secret-realm-active-run"
      >
        <h2 class="text-lg font-semibold">
          {{ pickLocale(activeRealmDef.nameVi, activeRealmDef.nameEn) }}
          —
          {{ t(`secretRealm.status.${store.activeRun.status}`) }}
        </h2>
        <ul class="mt-3 space-y-2">
          <li
            v-for="obj in activeRealmDef.objectives"
            :key="obj.key"
            class="rounded border border-gray-800 bg-gray-950 p-2"
            :data-testid="`secret-realm-objective-${obj.key}`"
          >
            <div class="flex items-center justify-between text-sm">
              <span>{{ pickLocale(obj.titleVi, obj.titleEn) }}</span>
              <span class="text-xs text-gray-400">
                {{ store.activeRun.objectiveProgress[obj.key] ?? 0 }} /
                {{ obj.target }}
              </span>
            </div>
            <button
              v-if="
                (store.activeRun.objectiveProgress[obj.key] ?? 0) < obj.target
              "
              type="button"
              class="mt-2 rounded bg-emerald-700 px-2 py-0.5 text-xs hover:bg-emerald-600 disabled:opacity-50"
              :disabled="!!store.submitting"
              :data-testid="`secret-realm-progress-${obj.key}`"
              @click="onProgress(obj.key, obj.target)"
            >
              {{ t('secretRealm.markObjective') }}
            </button>
          </li>
        </ul>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            v-if="store.activeRun.status === 'ENTERED'"
            type="button"
            class="rounded bg-amber-700 px-3 py-1 text-sm hover:bg-amber-600 disabled:opacity-50"
            :disabled="!!store.submitting"
            data-testid="secret-realm-complete"
            @click="onComplete"
          >
            {{ t('secretRealm.complete') }}
          </button>
          <button
            v-if="store.activeRun.status === 'CLEARED'"
            type="button"
            class="rounded bg-yellow-600 px-3 py-1 text-sm hover:bg-yellow-500 disabled:opacity-50"
            :disabled="!!store.submitting"
            data-testid="secret-realm-claim"
            @click="onClaim"
          >
            {{ t('secretRealm.claim') }}
          </button>
        </div>
      </section>
    </section>
  </AppShell>
</template>
