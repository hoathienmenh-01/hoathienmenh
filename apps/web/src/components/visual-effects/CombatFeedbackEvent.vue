<script setup lang="ts">
/**
 * Phase 42.0 — Single combat feedback event row.
 */
import { computed } from 'vue';
import { getEffectOrFallback, type StatusEffectType, type VisualEffectElement } from '@xuantoi/shared';
import StatusEffectBadge from './StatusEffectBadge.vue';

export type CombatFeedbackEventType =
  | 'ATTACK'
  | 'SKILL'
  | 'CRIT'
  | 'MISS'
  | 'BLOCK'
  | 'HEAL'
  | 'BUFF'
  | 'DEBUFF'
  | 'DOT'
  | 'SHIELD'
  | 'BOSS_ACTION'
  | 'PLAYER_ACTION'
  | 'SYSTEM';

export interface CombatFeedbackEventInput {
  id: string;
  type: CombatFeedbackEventType;
  actorName?: string | null;
  targetName?: string | null;
  message: string;
  amount?: number | null;
  element?: VisualEffectElement | null;
  effectKey?: string | null;
  statusEffects?: readonly StatusEffectType[];
  timestamp?: number | null;
  order?: number | null;
  severity?: 'INFO' | 'WARNING' | 'DANGER';
}

const props = withDefaults(
  defineProps<{
    event: CombatFeedbackEventInput;
    compactMode?: boolean;
    visualEffectLevel?: 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
    reducedMotion?: boolean;
  }>(),
  {
    compactMode: false,
    visualEffectLevel: 'MEDIUM',
    reducedMotion: false,
  },
);

const def = computed(() =>
  props.event.effectKey ? getEffectOrFallback(props.event.effectKey) : null,
);

const typeClass = computed(() => {
  switch (props.event.type) {
    case 'CRIT':
      return 'text-amber-300';
    case 'MISS':
      return 'text-ink-300';
    case 'BLOCK':
      return 'text-blue-200';
    case 'HEAL':
      return 'text-emerald-200';
    case 'DOT':
      return 'text-red-300';
    case 'SHIELD':
      return 'text-yellow-200';
    case 'BUFF':
      return 'text-emerald-100';
    case 'DEBUFF':
      return 'text-fuchsia-200';
    case 'BOSS_ACTION':
      return 'text-rose-200';
    case 'PLAYER_ACTION':
      return 'text-ink-50';
    default:
      return 'text-ink-100';
  }
});

const rowClass = computed(() => {
  const parts: string[] = ['flex items-baseline gap-2 px-2 py-1 rounded'];
  if (!props.compactMode) parts.push('border border-ink-300/15 bg-ink-700/20');
  if (props.event.element && props.event.element !== 'NONE') {
    parts.push(`ve-element-${props.event.element.toLowerCase()}`);
  }
  return parts.join(' ');
});
</script>

<template>
  <div
    :class="rowClass"
    :data-testid="`combat-feedback-event-${props.event.id}`"
    :data-event-type="props.event.type"
    :data-effect-key="def?.key ?? ''"
    role="listitem"
  >
    <span class="text-xs uppercase tracking-wide opacity-70 min-w-[3rem]">
      {{ props.event.type }}
    </span>
    <span :class="['flex-1', typeClass]">{{ props.event.message }}</span>
    <span
      v-if="props.event.amount != null"
      class="tabular-nums font-semibold"
    >
      {{ props.event.amount }}
    </span>
    <span v-if="props.event.statusEffects && props.event.statusEffects.length" class="flex gap-1">
      <StatusEffectBadge
        v-for="key in props.event.statusEffects"
        :key="`${props.event.id}-${key}`"
        :status-key="key"
        :reduced-motion="props.reducedMotion"
        :visual-effect-level="props.visualEffectLevel"
      />
    </span>
  </div>
</template>
