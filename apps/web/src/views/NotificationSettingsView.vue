<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWebPush } from '@/composables/useWebPush';

const { t } = useI18n();
const push = useWebPush();

const toggleBusy = ref<string | null>(null);

onMounted(async () => {
  await push.refreshStatus();
});

async function onEnable() {
  toggleBusy.value = 'enable';
  await push.enable();
  toggleBusy.value = null;
}

async function onDisable() {
  toggleBusy.value = 'disable';
  await push.disable();
  toggleBusy.value = null;
}

async function togglePref(
  key:
    | 'bossSpawnEnabled'
    | 'staminaFullEnabled'
    | 'mailEnabled'
    | 'dailyReminderEnabled',
) {
  if (!push.prefs.value) return;
  toggleBusy.value = key;
  await push.updatePrefs({ [key]: !push.prefs.value[key] });
  toggleBusy.value = null;
}
</script>

<template>
  <section class="max-w-3xl mx-auto p-4 space-y-4">
    <header class="space-y-1">
      <p class="flex items-center gap-2 text-[10px] uppercase tracking-[0.32em] text-[var(--xt-text-jade)] md:text-xs">
        <span aria-hidden="true" class="inline-block h-px w-6 bg-[var(--xt-border-jade)]" />
        <span aria-hidden="true" style="font-family: 'Ma Shan Zheng', 'Noto Serif SC', serif; font-size: 14px; letter-spacing: 0.16em;">得仪召心</span>
        <span>· Đài Truyền Tin Hiệu</span>
      </p>
      <h1 class="text-xl font-semibold text-ink-50 mt-1">
        {{ t('webPush.title') }}
      </h1>
      <p class="text-sm text-ink-300">{{ t('webPush.subtitle') }}</p>
    </header>

    <div
      v-if="!push.supported.value"
      class="rounded-lg border border-amber-700/40 bg-amber-900/20 p-4 text-sm text-amber-100"
      data-testid="webpush-unsupported"
    >
      {{ t('webPush.unsupported') }}
    </div>

    <div
      v-else-if="push.permission.value === 'denied'"
      class="rounded-lg border border-rose-700/40 bg-rose-900/20 p-4 text-sm text-rose-100"
      data-testid="webpush-denied"
    >
      {{ t('webPush.permissionDenied') }}
    </div>

    <div
      v-else
      class="rounded-lg border border-ink-700/40 bg-ink-800/40 p-4 space-y-3"
      data-testid="webpush-master"
    >
      <div class="flex items-center justify-between">
        <div>
          <p class="text-base text-ink-50">{{ t('webPush.masterTitle') }}</p>
          <p class="text-xs text-ink-300">
            {{ t('webPush.masterDescription') }}
          </p>
        </div>
        <button
          v-if="!push.subscribed.value"
          type="button"
          class="px-3 py-1.5 rounded bg-emerald-700 text-emerald-50 disabled:opacity-50"
          :disabled="push.loading.value"
          data-testid="webpush-enable"
          @click="onEnable"
        >
          {{ t('webPush.enable') }}
        </button>
        <button
          v-else
          type="button"
          class="px-3 py-1.5 rounded bg-rose-700 text-rose-50 disabled:opacity-50"
          :disabled="push.loading.value"
          data-testid="webpush-disable"
          @click="onDisable"
        >
          {{ t('webPush.disable') }}
        </button>
      </div>

      <p
        v-if="push.error.value"
        class="text-xs text-rose-300"
        data-testid="webpush-error"
      >
        {{
          push.error.value
            ? t(`webPush.errors.${push.error.value}`, { code: push.error.value })
            : ''
        }}
      </p>
    </div>

    <div
      v-if="push.subscribed.value && push.prefs.value"
      class="space-y-2"
      data-testid="webpush-prefs"
    >
      <h2 class="text-base font-medium text-ink-100">
        {{ t('webPush.perTypeTitle') }}
      </h2>
      <ul class="space-y-2">
        <li
          v-for="row in [
            { key: 'bossSpawnEnabled' as const, label: 'boss' },
            { key: 'staminaFullEnabled' as const, label: 'stamina' },
            { key: 'mailEnabled' as const, label: 'mail' },
            { key: 'dailyReminderEnabled' as const, label: 'daily' },
          ]"
          :key="row.key"
          class="flex items-center justify-between p-3 rounded bg-ink-800/30 border border-ink-700/30"
        >
          <div>
            <p class="text-sm text-ink-50">
              {{ t(`webPush.type.${row.label}.title`) }}
            </p>
            <p class="text-xs text-ink-300">
              {{ t(`webPush.type.${row.label}.description`) }}
            </p>
          </div>
          <button
            type="button"
            class="px-2 py-1 rounded text-xs"
            :class="
              push.prefs.value && push.prefs.value[row.key]
                ? 'bg-emerald-700 text-emerald-50'
                : 'bg-ink-700 text-ink-200'
            "
            :disabled="toggleBusy === row.key"
            :data-testid="`webpush-toggle-${row.label}`"
            @click="togglePref(row.key)"
          >
            {{
              push.prefs.value && push.prefs.value[row.key]
                ? t('webPush.on')
                : t('webPush.off')
            }}
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
