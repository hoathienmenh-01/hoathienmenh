<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TribulationMiniBattleView } from '@/api/tribulation';

/**
 * Phase 14.3.E.2 — Tribulation Mini-Battle Status panel.
 *
 * Server-authoritative read-only snapshot. Hiển thị:
 *   - realmKey / element / effectType label.
 *   - state badge (PENDING/ACTIVE).
 *   - currentPhase / phaseCount progress.
 *   - playerHp / playerHpMax (HP bar).
 *   - tribulationHp / tribulationHpMax (boss HP bar).
 *   - shield (>0).
 *   - dotStacks (>0).
 *   - focusCharge (>0).
 *
 * KHÔNG simulate logic ở client. Mọi field đều từ server snapshot.
 */
const props = defineProps<{
  battle: TribulationMiniBattleView;
}>();

const { t } = useI18n();

const playerHpPct = computed<number>(() => {
  const max = props.battle.playerHpMax;
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (props.battle.playerHp / max) * 100));
});

const tribulationHpPct = computed<number>(() => {
  const max = props.battle.tribulationHpMax;
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (props.battle.tribulationHp / max) * 100));
});

const phaseProgressPct = computed<number>(() => {
  const total = props.battle.phaseCount;
  if (total <= 0) return 0;
  // currentPhase 1-indexed; show progression as (currentPhase-1)/total once
  // first action taken (state ACTIVE) — for PENDING render 0%.
  const denom = Math.max(1, total);
  if (props.battle.state === 'PENDING') return 0;
  return Math.max(
    0,
    Math.min(100, ((props.battle.currentPhase - 1) / denom) * 100),
  );
});

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return Math.round(n).toLocaleString('vi-VN');
}

function stateBadgeClass(state: TribulationMiniBattleView['state']): string {
  switch (state) {
    case 'PENDING':
      return 'bg-stone-700/40 text-stone-200 border-stone-500/40';
    case 'ACTIVE':
      return 'bg-amber-700/40 text-amber-100 border-amber-500/40';
    case 'RESOLVED':
      return 'bg-emerald-700/40 text-emerald-100 border-emerald-500/40';
    case 'FAILED':
      return 'bg-rose-700/40 text-rose-100 border-rose-500/40';
    case 'EXPIRED':
      return 'bg-violet-700/40 text-violet-100 border-violet-500/40';
    default:
      return 'bg-ink-700/40 text-ink-200 border-ink-300/30';
  }
}
</script>

<template>
  <section
    class="space-y-3"
    data-testid="tribulation-mini-battle-status"
  >
    <header class="flex items-center justify-between gap-2 flex-wrap">
      <div class="flex items-center gap-1 flex-wrap">
        <span
          class="text-[10px] px-1.5 py-0.5 rounded border bg-ink-700/40 text-ink-200 border-ink-300/30"
          data-testid="tribulation-mini-battle-element-badge"
        >
          {{ t(`tribulation.encounter.element.${battle.element}`) }}
        </span>
        <span
          class="text-[10px] px-1.5 py-0.5 rounded border bg-ink-700/40 text-ink-200 border-ink-300/30"
          data-testid="tribulation-mini-battle-effect-badge"
        >
          {{ t(`tribulation.encounter.effectType.${battle.effectType}`) }}
        </span>
        <span
          class="text-[10px] px-1.5 py-0.5 rounded border"
          :class="stateBadgeClass(battle.state)"
          data-testid="tribulation-mini-battle-state-badge"
        >
          {{ t(`tribulation.miniBattle.state.${battle.state}`) }}
        </span>
      </div>
      <div
        class="text-xs text-ink-300"
        data-testid="tribulation-mini-battle-phase"
      >
        {{
          t('tribulation.miniBattle.phaseProgress', {
            current: battle.currentPhase,
            total: battle.phaseCount,
          })
        }}
      </div>
    </header>

    <!-- Phase progress bar -->
    <div
      class="h-1.5 rounded bg-ink-700/40 overflow-hidden"
      data-testid="tribulation-mini-battle-phase-bar"
    >
      <div
        class="h-full bg-amber-500/80 transition-all"
        :style="{ width: phaseProgressPct + '%' }"
      />
    </div>

    <!-- Player HP -->
    <div class="space-y-1" data-testid="tribulation-mini-battle-player-hp">
      <div class="flex items-baseline justify-between text-xs">
        <span class="text-ink-300">{{ t('tribulation.miniBattle.playerHp') }}</span>
        <span class="text-emerald-200 tabular-nums">
          {{ fmtNum(battle.playerHp) }} / {{ fmtNum(battle.playerHpMax) }}
        </span>
      </div>
      <div class="h-2 rounded bg-ink-700/40 overflow-hidden">
        <div
          class="h-full bg-emerald-500/80 transition-all"
          :style="{ width: playerHpPct + '%' }"
        />
      </div>
    </div>

    <!-- Tribulation HP -->
    <div class="space-y-1" data-testid="tribulation-mini-battle-tribulation-hp">
      <div class="flex items-baseline justify-between text-xs">
        <span class="text-ink-300">{{ t('tribulation.miniBattle.tribulationHp') }}</span>
        <span class="text-rose-200 tabular-nums">
          {{ fmtNum(battle.tribulationHp) }} / {{ fmtNum(battle.tribulationHpMax) }}
        </span>
      </div>
      <div class="h-2 rounded bg-ink-700/40 overflow-hidden">
        <div
          class="h-full bg-rose-500/80 transition-all"
          :style="{ width: tribulationHpPct + '%' }"
        />
      </div>
    </div>

    <!-- Status chips: shield / dotStacks / focusCharge -->
    <div class="flex items-center gap-2 flex-wrap text-xs">
      <span
        v-if="battle.shield > 0"
        class="px-2 py-0.5 rounded border bg-sky-700/30 text-sky-200 border-sky-500/40"
        data-testid="tribulation-mini-battle-shield"
      >
        {{ t('tribulation.miniBattle.shield', { n: fmtNum(battle.shield) }) }}
      </span>
      <span
        v-if="battle.dotStacks > 0"
        class="px-2 py-0.5 rounded border bg-violet-700/30 text-violet-200 border-violet-500/40"
        data-testid="tribulation-mini-battle-dot"
      >
        {{ t('tribulation.miniBattle.dotStacks', { n: battle.dotStacks }) }}
      </span>
      <span
        v-if="battle.focusCharge > 0"
        class="px-2 py-0.5 rounded border bg-amber-700/30 text-amber-200 border-amber-500/40"
        data-testid="tribulation-mini-battle-focus"
      >
        {{ t('tribulation.miniBattle.focusCharge', { n: battle.focusCharge }) }}
      </span>
    </div>
  </section>
</template>
