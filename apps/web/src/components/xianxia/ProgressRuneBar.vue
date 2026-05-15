<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    value: number;
    label: string;
    tone?: 'jade' | 'gold' | 'seal' | 'mist';
  }>(),
  {
    value: 0,
    tone: 'jade',
  },
);

function clamp(v: number): number {
  return Math.min(Math.max(v, 0), 100);
}
</script>

<template>
  <div class="xt-progress-rune space-y-1" data-testid="progress-rune-bar">
    <div class="xt-progress-rune__head flex items-center justify-between text-xs font-semibold">
      <span>{{ label }}</span>
      <span class="xt-progress-rune__pct">{{ clamp(props.value) }}%</span>
    </div>
    <div class="xt-progress-rune__track h-3 overflow-hidden rounded-full">
      <div
        class="xt-progress-rune__fill h-full rounded-full transition-all"
        :class="`xt-progress-rune__fill--${tone}`"
        :style="{ width: `${clamp(props.value)}%` }"
      />
    </div>
  </div>
</template>

<style scoped>
.xt-progress-rune__head {
  color: var(--xt-text-muted);
}

.xt-progress-rune__pct {
  color: var(--xt-gold-bright);
  font-family: var(--xt-font-display);
}

.xt-progress-rune__track {
  border: 1px solid var(--xt-border-gold);
  background:
    linear-gradient(180deg, rgba(8, 9, 11, 0.85) 0%, rgba(20, 28, 38, 0.85) 100%);
  box-shadow: inset 0 1px 0 rgba(0, 0, 0, 0.6);
}

.xt-progress-rune__fill--jade {
  background: linear-gradient(90deg, var(--xt-jade-deep) 0%, var(--xt-jade) 60%, var(--xt-jade-bright) 100%);
  box-shadow:
    0 0 18px rgba(95, 227, 198, 0.55),
    inset 0 1px 0 rgba(255, 246, 224, 0.18);
}

.xt-progress-rune__fill--gold {
  background: linear-gradient(90deg, var(--xt-gold-deep) 0%, var(--xt-gold) 60%, var(--xt-gold-bright) 100%);
  box-shadow:
    0 0 18px rgba(242, 215, 137, 0.55),
    inset 0 1px 0 rgba(255, 246, 224, 0.22);
}

.xt-progress-rune__fill--seal {
  background: linear-gradient(90deg, var(--xt-seal-deep) 0%, var(--xt-seal) 60%, var(--xt-seal-bright) 100%);
  box-shadow:
    0 0 18px rgba(208, 79, 79, 0.55),
    inset 0 1px 0 rgba(255, 246, 224, 0.22);
}

.xt-progress-rune__fill--mist {
  background: linear-gradient(90deg, var(--xt-mist-deep) 0%, var(--xt-mist) 60%, var(--xt-mist-bright) 100%);
  box-shadow:
    0 0 18px rgba(185, 214, 232, 0.55),
    inset 0 1px 0 rgba(255, 246, 224, 0.22);
}
</style>
