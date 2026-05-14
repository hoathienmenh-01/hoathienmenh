<script setup lang="ts">
import { useRouter } from 'vue-router';

const props = withDefaults(
  defineProps<{
    to?: string;
    variant?: 'primary' | 'secondary' | 'ghost';
    disabled?: boolean;
  }>(),
  {
    to: '',
    variant: 'primary',
    disabled: false,
  },
);

const router = useRouter();

function onClick(): void {
  if (props.disabled || !props.to) return;
  void router.push(props.to);
}
</script>

<template>
  <button
    type="button"
    class="xt-button"
    :class="`xt-button--${variant}`"
    :disabled="disabled"
    @click="onClick"
  >
    <slot />
  </button>
</template>
