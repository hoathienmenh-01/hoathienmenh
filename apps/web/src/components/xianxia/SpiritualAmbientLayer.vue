<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    reducedMotion?: boolean;
    visualEffectLevel?: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
  }>(),
  {
    reducedMotion: false,
    visualEffectLevel: 'MEDIUM',
  },
);

const active = computed(
  () => !props.reducedMotion && props.visualEffectLevel !== 'OFF',
);
const particleCount = computed(() => (props.visualEffectLevel === 'HIGH' ? 18 : 10));
</script>

<template>
  <div
    class="xt-ambient-layer pointer-events-none absolute inset-0 overflow-hidden"
    :class="{ 'xt-ambient-layer--static': !active }"
    aria-hidden="true"
    data-testid="spiritual-ambient-layer"
  >
    <div class="xt-mist xt-mist-one" />
    <div class="xt-mist xt-mist-two" />
    <template v-if="active">
      <span
        v-for="n in particleCount"
        :key="n"
        class="xt-qi-particle"
        :style="{ '--qi-index': `${n}` }"
        data-testid="qi-particle"
      />
    </template>
  </div>
</template>
