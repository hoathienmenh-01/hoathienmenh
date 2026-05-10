<script setup lang="ts">
/**
 * Phase 15.5 — Maintenance full-screen overlay.
 *
 * Hiển thị khi:
 *   - `useMaintenanceStore().blockedByApi === true` (server trả 503
 *     `MAINTENANCE_ACTIVE` cho request gần nhất), HOẶC
 *   - `status.active === true` và user không phải ADMIN/MOD (admin được
 *     bypass thì chỉ thấy banner thôi).
 *
 * Wrapper logic ở `App.vue` — component này chỉ render UI.
 *
 * I18n: chọn message theo locale hiện tại; fallback `Vi` nếu thiếu.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MaintenanceWindowPublicView } from '@xuantoi/shared';

const props = defineProps<{
  status: MaintenanceWindowPublicView;
}>();

const { t, locale } = useI18n();

const title = computed<string>(() => {
  if (locale.value === 'en') {
    return props.status.titleEn || props.status.titleVi || t('maintenance.overlay.title');
  }
  return props.status.titleVi || t('maintenance.overlay.title');
});

const message = computed<string>(() => {
  if (locale.value === 'en') {
    return props.status.messageEn || props.status.messageVi || '';
  }
  return props.status.messageVi || '';
});

const endsAt = computed<string | null>(() => {
  if (!props.status.endsAt) return null;
  const d = new Date(props.status.endsAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(locale.value === 'en' ? 'en-US' : 'vi-VN');
});

const severityClass = computed<string>(() => {
  switch (props.status.severity) {
    case 'CRITICAL':
      return 'border-rose-400/60 bg-rose-900/20';
    case 'WARNING':
      return 'border-amber-400/60 bg-amber-900/15';
    default:
      return 'border-ink-300/40 bg-ink-700/30';
  }
});
</script>

<template>
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-ink-900/95 backdrop-blur-sm"
    role="alertdialog"
    aria-modal="true"
    :aria-labelledby="'maintenance-overlay-title'"
    data-testid="maintenance-overlay"
  >
    <div
      class="max-w-lg w-[92%] rounded-lg border-2 p-6 shadow-2xl"
      :class="severityClass"
    >
      <div class="flex items-center gap-2 mb-3">
        <span aria-hidden="true" class="text-2xl">🛠️</span>
        <h2
          id="maintenance-overlay-title"
          class="text-xl tracking-widest font-bold text-ink-50"
          data-testid="maintenance-overlay-title"
        >
          {{ title }}
        </h2>
      </div>
      <p
        v-if="message"
        class="text-sm text-ink-100 whitespace-pre-line leading-relaxed"
        data-testid="maintenance-overlay-message"
      >
        {{ message }}
      </p>
      <div
        v-if="endsAt"
        class="text-xs text-ink-300 mt-4"
        data-testid="maintenance-overlay-endsAt"
      >
        {{ t('maintenance.overlay.endsAt', { at: endsAt }) }}
      </div>
      <div
        v-if="status.severity === 'CRITICAL'"
        class="text-[11px] text-rose-200 mt-2"
      >
        {{ t('maintenance.overlay.criticalHint') }}
      </div>
      <div class="text-[10px] text-ink-300 mt-4 text-right">
        {{ t('maintenance.overlay.errorCode') }}: MAINTENANCE_ACTIVE
      </div>
    </div>
  </div>
</template>
