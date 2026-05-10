<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  TribulationBattleActionKey,
  TribulationMiniBattleView,
} from '@/api/tribulation';

/**
 * Phase 14.3.E.2 — Tribulation Mini-Battle Actions panel.
 *
 * 5 action button: ATTACK / DEFEND / FOCUS / CLEANSE / CHANNEL.
 * Disabled khi:
 *   - `actionLoading` (đang submit action — chống double-click).
 *   - `disabled` prop (battle terminal hoặc external block).
 *
 * Note: client KHÔNG validate `validateTribulationBattleAction` ở đây —
 * server authoritative reject `MINI_BATTLE_INVALID_ACTION` nếu phase
 * sai. UI chỉ hiển thị 5 button + tooltip ngắn.
 */
const props = defineProps<{
  battle: TribulationMiniBattleView;
  actionLoading: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'submit', action: TribulationBattleActionKey): void;
}>();

const { t } = useI18n();

const actions: readonly TribulationBattleActionKey[] = [
  'ATTACK',
  'DEFEND',
  'FOCUS',
  'CLEANSE',
  'CHANNEL',
];

const buttonsDisabled = computed<boolean>(() => {
  if (props.actionLoading) return true;
  if (props.disabled) return true;
  if (
    props.battle.state !== 'PENDING' &&
    props.battle.state !== 'ACTIVE'
  ) {
    return true;
  }
  return false;
});

function actionClass(action: TribulationBattleActionKey): string {
  switch (action) {
    case 'ATTACK':
      return 'bg-rose-700 text-rose-50 hover:bg-rose-600';
    case 'DEFEND':
      return 'bg-sky-700 text-sky-50 hover:bg-sky-600';
    case 'FOCUS':
      return 'bg-amber-700 text-amber-50 hover:bg-amber-600';
    case 'CLEANSE':
      return 'bg-emerald-700 text-emerald-50 hover:bg-emerald-600';
    case 'CHANNEL':
      return 'bg-violet-700 text-violet-50 hover:bg-violet-600';
    default:
      return 'bg-ink-700 text-ink-50 hover:bg-ink-600';
  }
}

function onClick(action: TribulationBattleActionKey): void {
  if (buttonsDisabled.value) return;
  emit('submit', action);
}
</script>

<template>
  <section
    class="space-y-2"
    data-testid="tribulation-mini-battle-actions"
  >
    <header class="text-xs text-ink-300">
      {{ t('tribulation.miniBattle.actions.title') }}
    </header>
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
      <button
        v-for="action in actions"
        :key="action"
        type="button"
        :disabled="buttonsDisabled"
        :data-testid="`tribulation-mini-battle-action-${action.toLowerCase()}`"
        :title="t(`tribulation.miniBattle.actions.${action}.hint`)"
        class="px-3 py-2 text-sm rounded transition disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
        :class="actionClass(action)"
        @click="onClick(action)"
      >
        <span class="block font-semibold">
          {{ t(`tribulation.miniBattle.actions.${action}.label`) }}
        </span>
        <span class="block text-[10px] opacity-80">
          {{ t(`tribulation.miniBattle.actions.${action}.short`) }}
        </span>
      </button>
    </div>
    <p
      v-if="actionLoading"
      class="text-xs text-ink-300"
      data-testid="tribulation-mini-battle-action-loading"
    >
      {{ t('tribulation.miniBattle.actions.loading') }}
    </p>
  </section>
</template>
