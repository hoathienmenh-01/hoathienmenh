<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  TribulationBattleEventView,
  TribulationMiniBattleView,
} from '@/api/tribulation';

/**
 * Phase 14.3.E.2 — Tribulation Mini-Battle Log.
 *
 * Render `actionLog[]` server-authoritative theo phase order. Mỗi entry:
 *   - phase index.
 *   - action label (ATTACK/DEFEND/...).
 *   - dmg / shield / heal chips (chỉ render nếu > 0).
 *   - DOT add chip nếu `dot > 0`.
 *   - crit badge nếu `crit === true`.
 *   - result badge: ongoing / win / lose.
 *   - messageKey i18n lookup (fallback raw key).
 */
const props = defineProps<{
  battle: TribulationMiniBattleView;
}>();

const { t, te } = useI18n();

const events = computed<readonly TribulationBattleEventView[]>(
  () => props.battle.actionLog ?? [],
);

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return Math.round(n).toLocaleString('vi-VN');
}

function resultClass(result: TribulationBattleEventView['result']): string {
  switch (result) {
    case 'win':
      return 'bg-emerald-700/40 text-emerald-100 border-emerald-500/40';
    case 'lose':
      return 'bg-rose-700/40 text-rose-100 border-rose-500/40';
    default:
      return 'bg-stone-700/40 text-stone-200 border-stone-500/40';
  }
}

function actionClass(action: string): string {
  switch (action) {
    case 'ATTACK':
      return 'text-rose-200';
    case 'DEFEND':
      return 'text-sky-200';
    case 'FOCUS':
      return 'text-amber-200';
    case 'CLEANSE':
      return 'text-emerald-200';
    case 'CHANNEL':
      return 'text-violet-200';
    default:
      return 'text-ink-200';
  }
}

/**
 * Resolve server messageKey (e.g. `tribulation.miniBattle.message.attack_hit`)
 * sang text. Fallback raw key nếu chưa có i18n entry — caller có thể bổ sung
 * sau (server thường ship message key, FE chỉ render).
 */
function fmtMessage(messageKey: string): string {
  if (!messageKey) return '';
  const full = `tribulation.miniBattle.log.message.${messageKey}`;
  if (te(full)) return t(full);
  return messageKey;
}
</script>

<template>
  <section
    class="space-y-2"
    data-testid="tribulation-mini-battle-log"
  >
    <header class="text-xs text-ink-300">
      {{ t('tribulation.miniBattle.log.title') }}
    </header>
    <div
      v-if="events.length === 0"
      class="text-xs text-ink-300/70 italic"
      data-testid="tribulation-mini-battle-log-empty"
    >
      {{ t('tribulation.miniBattle.log.empty') }}
    </div>
    <ul
      v-else
      class="space-y-1 max-h-60 overflow-y-auto text-xs"
      data-testid="tribulation-mini-battle-log-list"
    >
      <li
        v-for="(ev, idx) in events"
        :key="`${ev.phase}-${idx}`"
        class="rounded border border-ink-300/20 bg-ink-700/30 px-2 py-1.5 flex items-center gap-2 flex-wrap"
        :data-testid="`tribulation-mini-battle-log-entry-${idx}`"
      >
        <span class="text-ink-300 tabular-nums">
          {{ t('tribulation.miniBattle.log.phase', { n: ev.phase }) }}
        </span>
        <span class="font-semibold" :class="actionClass(ev.action)">
          {{ t(`tribulation.miniBattle.actions.${ev.action}.label`) }}
        </span>
        <span
          v-if="ev.damage > 0"
          class="px-1.5 py-0.5 rounded bg-rose-700/30 text-rose-200 text-[10px]"
        >
          {{ t('tribulation.miniBattle.log.damage', { n: fmtNum(ev.damage) }) }}
        </span>
        <span
          v-if="ev.shield > 0"
          class="px-1.5 py-0.5 rounded bg-sky-700/30 text-sky-200 text-[10px]"
        >
          {{ t('tribulation.miniBattle.log.shield', { n: fmtNum(ev.shield) }) }}
        </span>
        <span
          v-if="ev.heal > 0"
          class="px-1.5 py-0.5 rounded bg-emerald-700/30 text-emerald-200 text-[10px]"
        >
          {{ t('tribulation.miniBattle.log.heal', { n: fmtNum(ev.heal) }) }}
        </span>
        <span
          v-if="ev.dot > 0"
          class="px-1.5 py-0.5 rounded bg-violet-700/30 text-violet-200 text-[10px]"
        >
          {{ t('tribulation.miniBattle.log.dot', { n: ev.dot }) }}
        </span>
        <span
          v-if="ev.crit"
          class="px-1.5 py-0.5 rounded bg-amber-700/30 text-amber-200 text-[10px] font-semibold"
        >
          {{ t('tribulation.miniBattle.log.crit') }}
        </span>
        <span
          class="px-1.5 py-0.5 rounded text-[10px] border"
          :class="resultClass(ev.result)"
        >
          {{ t(`tribulation.miniBattle.log.result.${ev.result}`) }}
        </span>
        <span class="basis-full text-ink-300/80 mt-0.5">
          {{ fmtMessage(ev.messageKey) }}
        </span>
      </li>
    </ul>
  </section>
</template>
