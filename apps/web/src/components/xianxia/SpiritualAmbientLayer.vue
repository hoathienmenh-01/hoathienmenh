<script setup lang="ts">
import { computed } from 'vue';

/**
 * Cửu Thiên Mộng — ambient layer.
 *
 * `tone` chuyển palette particle/mist theo nhóm route (default / cultivation
 * / boss / secret / sect / market). Khi không truyền, dùng tone "default".
 * Layer này KHÔNG vẽ scene art — phần đó do body[data-scene=*] xử lý.
 */
const props = withDefaults(
  defineProps<{
    reducedMotion?: boolean;
    visualEffectLevel?: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
    tone?:
      | 'default'
      | 'cultivation'
      | 'boss'
      | 'secret'
      | 'sect'
      | 'market';
  }>(),
  {
    reducedMotion: false,
    visualEffectLevel: 'MEDIUM',
    tone: 'default',
  },
);

const active = computed(
  () => !props.reducedMotion && props.visualEffectLevel !== 'OFF',
);
const particleCount = computed(() => {
  if (props.visualEffectLevel === 'LOW') return 8;
  if (props.visualEffectLevel === 'HIGH') return 24;
  return 14;
});
</script>

<template>
  <div
    class="xt-ambient-layer pointer-events-none absolute inset-0 overflow-hidden"
    :class="{ 'xt-ambient-layer--static': !active }"
    :data-tone="tone"
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
