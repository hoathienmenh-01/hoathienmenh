<script setup lang="ts">
/**
 * Phase 15.5 — Maintenance banner.
 *
 * Hiển thị thanh thông báo phía trên `AppShell` khi:
 *   - `status.active === true` và user là ADMIN/MOD (admin bypass) → admin
 *     biết game đang maintenance dù vẫn dùng được.
 *   - `status` có maintenance SCHEDULED gần (FE poll public status —
 *     chỉ trả ACTIVE hiện tại, nên chuỗi SCHEDULED hiển thị trong admin
 *     panel, không ở banner).
 *
 * Player không phải admin sẽ thấy `MaintenanceOverlay` (full-screen) thay
 * vì banner.
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
    return props.status.titleEn || props.status.titleVi || t('maintenance.banner.title');
  }
  return props.status.titleVi || t('maintenance.banner.title');
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
      return 'bg-rose-900/40 border-rose-400/40 text-rose-100';
    case 'WARNING':
      return 'bg-amber-900/40 border-amber-400/40 text-amber-100';
    default:
      return 'bg-ink-700/60 border-ink-300/40 text-ink-100';
  }
});
</script>

<template>
  <div
    class="border-b px-4 py-2 text-sm flex items-center gap-3"
    :class="severityClass"
    role="status"
    data-testid="maintenance-banner"
  >
    <span aria-hidden="true" class="text-lg">🛠️</span>
    <span class="font-bold" data-testid="maintenance-banner-title">{{ title }}</span>
    <span
      v-if="endsAt"
      class="text-xs opacity-90"
      data-testid="maintenance-banner-endsAt"
    >
      {{ t('maintenance.banner.endsAt', { at: endsAt }) }}
    </span>
    <span class="ml-auto text-[10px] uppercase tracking-widest opacity-75">
      {{ status.severity }}
    </span>
  </div>
</template>
