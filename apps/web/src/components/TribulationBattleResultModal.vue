<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import type { TribulationOutcomeView } from '@/api/tribulation';

/**
 * Phase 14.3.E.2 — Tribulation Mini-Battle Result modal.
 *
 * Hiển thị outcome sau resolve battle. Server-authoritative (mirror
 * `lastOutcome` / encounter outcome).
 *
 * CTA:
 *   - Win: "Quay lại tu luyện" (cultivation).
 *   - Lose: "Thử lại" (retry — caller mở lại MiniBattlePanel + start battle
 *     mới nếu backend cho phép — server check cooldown).
 *
 * Esc / backdrop / Close button đều đóng modal.
 */
const props = defineProps<{
  outcome: TribulationOutcomeView | null;
  open: boolean;
  retryAvailable?: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'retry'): void;
  (e: 'returnCultivation'): void;
}>();

const { t } = useI18n();

const isOpen = computed<boolean>(() => props.open && props.outcome !== null);
const success = computed<boolean>(() => props.outcome?.success === true);

function fmtNum(n: number | string): string {
  const v = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(v)) return String(n);
  return v.toLocaleString('vi-VN');
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isOpen.value) {
    e.preventDefault();
    emit('close');
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen && outcome"
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-40 p-4"
      data-testid="tribulation-mini-battle-result-modal"
      role="dialog"
      aria-modal="true"
      @click.self="emit('close')"
    >
      <div
        class="rounded p-5 max-w-md w-full space-y-3 border bg-ink-800"
        :class="
          success
            ? 'border-emerald-400/40'
            : 'border-rose-400/40'
        "
      >
        <h2
          class="text-lg font-bold"
          :class="success ? 'text-emerald-100' : 'text-rose-100'"
        >
          <template v-if="success">
            {{ t('tribulation.miniBattle.result.winTitle') }}
          </template>
          <template v-else>
            {{ t('tribulation.miniBattle.result.loseTitle') }}
          </template>
        </h2>

        <p class="text-sm text-ink-200" data-testid="tribulation-mini-battle-result-transition">
          {{
            t('tribulation.miniBattle.result.transition', {
              from: outcome.fromRealmKey,
              to: outcome.toRealmKey,
            })
          }}
        </p>

        <ul class="text-sm space-y-1">
          <li data-testid="tribulation-mini-battle-result-attempt">
            {{ t('tribulation.miniBattle.result.attemptIndex', { n: outcome.attemptIndex }) }}
          </li>
          <li
            v-if="outcome.wavesCompleted > 0"
            data-testid="tribulation-mini-battle-result-waves"
          >
            {{ t('tribulation.miniBattle.result.wavesCompleted', { n: outcome.wavesCompleted }) }}
          </li>
          <li
            v-if="success && outcome.reward"
            class="text-emerald-200"
            data-testid="tribulation-mini-battle-result-reward"
          >
            {{
              t('tribulation.miniBattle.result.reward', {
                linhThach: fmtNum(outcome.reward.linhThach),
                expBonus: fmtNum(outcome.reward.expBonus),
              })
            }}
          </li>
          <li
            v-if="success && outcome.reward?.titleKey"
            class="text-amber-200"
            data-testid="tribulation-mini-battle-result-title"
          >
            {{ t('tribulation.miniBattle.result.titleAwarded', { key: outcome.reward.titleKey }) }}
          </li>
          <li
            v-if="!success && outcome.penalty"
            class="text-rose-200"
            data-testid="tribulation-mini-battle-result-penalty"
          >
            {{
              t('tribulation.miniBattle.result.penalty', {
                expLoss: fmtNum(outcome.penalty.expLoss),
              })
            }}
          </li>
          <li
            v-if="!success && outcome.penalty?.cooldownAt"
            class="text-rose-200"
            data-testid="tribulation-mini-battle-result-cooldown"
          >
            {{
              t('tribulation.miniBattle.result.cooldownAt', {
                ts: fmtDate(outcome.penalty?.cooldownAt ?? null),
              })
            }}
          </li>
          <li
            v-if="!success && outcome.penalty?.taoMaActive"
            class="text-violet-200"
            data-testid="tribulation-mini-battle-result-tao-ma"
          >
            {{
              t('tribulation.miniBattle.result.taoMaUntil', {
                ts: fmtDate(outcome.penalty?.taoMaExpiresAt ?? null),
              })
            }}
          </li>
        </ul>

        <div class="flex flex-col sm:flex-row justify-end gap-2 pt-1">
          <button
            v-if="success"
            type="button"
            class="px-3 py-1.5 rounded border border-emerald-400/50 bg-emerald-700/40 text-emerald-100 hover:bg-emerald-700/60 transition text-sm"
            data-testid="tribulation-mini-battle-result-return-cultivation"
            @click="emit('returnCultivation')"
          >
            {{ t('tribulation.miniBattle.result.cta.returnCultivation') }}
          </button>
          <button
            v-if="!success && retryAvailable"
            type="button"
            class="px-3 py-1.5 rounded border border-amber-400/50 bg-amber-700/40 text-amber-100 hover:bg-amber-700/60 transition text-sm"
            data-testid="tribulation-mini-battle-result-retry"
            @click="emit('retry')"
          >
            {{ t('tribulation.miniBattle.result.cta.retry') }}
          </button>
          <button
            type="button"
            class="px-3 py-1.5 rounded border border-ink-300/40 bg-ink-700/40 text-ink-100 hover:bg-ink-700/60 transition text-sm"
            data-testid="tribulation-mini-battle-result-close"
            @click="emit('close')"
          >
            {{ t('tribulation.miniBattle.result.cta.close') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
