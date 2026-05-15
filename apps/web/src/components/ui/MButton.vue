<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { playSfxClick, playSfxConfirm } from '@/lib/sfx';

/**
 * Cửu Thiên Mộng — `MButton` (Phase 3 polish).
 *
 * Thêm `sfx` opt-in prop: khi user click, gọi sfx tương ứng trước khi emit
 * native click event. Mặc định `null` → giữ nguyên hành vi cũ (không sfx).
 */
const props = defineProps<{
  type?: 'button' | 'submit' | 'reset';
  loading?: boolean;
  disabled?: boolean;
  /** Opt-in inline sfx played on pointer click. */
  sfx?: 'click' | 'confirm' | null;
}>();

const { t } = useI18n();

function onClick(): void {
  if (props.disabled || props.loading) return;
  if (props.sfx === 'click') playSfxClick();
  else if (props.sfx === 'confirm') playSfxConfirm();
}
</script>

<template>
  <button
    :type="type ?? 'button'"
    :disabled="disabled || loading"
    class="px-5 py-2 rounded border border-ink-300 bg-ink-700/40 text-ink-50 hover:bg-ink-700/70 disabled:opacity-50 disabled:cursor-not-allowed transition"
    @click="onClick"
  >
    <slot v-if="!loading" />
    <span v-else>{{ t('common.loading') }}</span>
  </button>
</template>
