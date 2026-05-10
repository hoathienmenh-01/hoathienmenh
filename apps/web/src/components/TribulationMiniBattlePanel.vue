<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTribulationStore } from '@/stores/tribulation';
import type {
  TribulationBattleActionKey,
  TribulationMiniBattleEffectTypeView,
} from '@/api/tribulation';
import TribulationBattleStatus from './TribulationBattleStatus.vue';
import TribulationBattleActions from './TribulationBattleActions.vue';
import TribulationBattleLog from './TribulationBattleLog.vue';
import TribulationBattleResultModal from './TribulationBattleResultModal.vue';

/**
 * Phase 14.3.E.2 — Tribulation Mini-Battle orchestrator.
 *
 * Wire 4 children (Status / Actions / Log / ResultModal) với store. Quản lý:
 *   - Hiển thị nút "Bắt đầu mini-battle" khi chưa có row.
 *   - Render battle UI khi PENDING/ACTIVE.
 *   - Auto-show result modal khi battle terminal + đã resolve.
 *   - Effect-type hint (5 effect types: BURST/SUSTAIN/...) — UX clarity.
 *
 * Store-driven: KHÔNG simulate logic ở client; mọi state machine transition
 * do server xử lý. Component pass action click → store.submitBattleAction
 * → server reply snapshot → render lại.
 */
const props = withDefaults(
  defineProps<{
    /**
     * Optional — `selectedSupportItemKeys` từ parent (TribulationView) để
     * forward sang server start endpoint. Snapshot vào DB row encounter.
     * Server consume sau khi resolve thành công/thất bại (mirror flow
     * Phase 14.3.D encounter).
     */
    selectedSupportItemKeys?: readonly string[];
    /** Disable nút Start (e.g. cooldown active, không at peak). */
    startDisabled?: boolean;
  }>(),
  {
    selectedSupportItemKeys: () => [],
    startDisabled: false,
  },
);

const emit = defineEmits<{
  (e: 'returnCultivation'): void;
  (e: 'errored', code: string): void;
}>();

const tribulation = useTribulationStore();
const { t, te } = useI18n();

const showResultModal = ref<boolean>(false);

const battle = computed(() => tribulation.miniBattle ?? null);

const hasBattle = computed<boolean>(() => battle.value !== null);

const startLabel = computed<string>(() => {
  if (tribulation.miniBattleStarting) return t('tribulation.miniBattle.button.starting');
  return t('tribulation.miniBattle.button.start');
});

const startButtonDisabled = computed<boolean>(() => {
  if (tribulation.miniBattleStarting) return true;
  if (props.startDisabled) return true;
  return false;
});

const resolveButtonDisabled = computed<boolean>(() => {
  if (!tribulation.miniBattleIsTerminal) return true;
  if (tribulation.miniBattleResolving) return true;
  return false;
});

const effectTypeKey = computed<TribulationMiniBattleEffectTypeView | null>(() =>
  battle.value?.effectType ?? null,
);

function effectTypeHintLabel(
  effect: TribulationMiniBattleEffectTypeView | null,
): string {
  if (effect === null) return '';
  return t(`tribulation.miniBattle.effectHint.${effect}`);
}

async function onStart(): Promise<void> {
  if (startButtonDisabled.value) return;
  const code = await tribulation.startBattle(props.selectedSupportItemKeys);
  if (code !== null) emit('errored', code);
}

function nextNonce(): string {
  // Browser-safe random nonce (avoid crypto API dependency).
  return `bnonce-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function onSubmitAction(action: TribulationBattleActionKey): Promise<void> {
  if (tribulation.miniBattleActionLoading) return;
  const code = await tribulation.submitBattleAction({
    action,
    clientNonce: nextNonce(),
  });
  if (code !== null) emit('errored', code);
  else if (tribulation.miniBattleIsTerminal) {
    // Battle moved to terminal state after action — auto-resolve to claim
    // outcome / cooldown / consume support items.
    await onResolve();
  }
}

async function onResolve(): Promise<void> {
  if (resolveButtonDisabled.value) return;
  const code = await tribulation.resolveBattle();
  if (code !== null) {
    emit('errored', code);
    return;
  }
  showResultModal.value = true;
}

function onCloseResult(): void {
  showResultModal.value = false;
  // Clear store snapshot after dismiss — caller can fetchCurrent again để
  // chuẩn bị cho lần kiếp tiếp theo.
  tribulation.clearMiniBattle();
}

function onRetry(): void {
  // Lose case + backend cho phép — close modal, reset error, prompt user
  // bấm Start lại. UI không tự động start để user có thể adjust support
  // items / chờ qua cooldown.
  showResultModal.value = false;
  tribulation.clearMiniBattle();
  tribulation.resetMiniBattleError();
}

function onReturnCultivation(): void {
  showResultModal.value = false;
  tribulation.clearMiniBattle();
  emit('returnCultivation');
}

const errorMessage = computed<string>(() => {
  const code = tribulation.miniBattleError;
  if (!code) return '';
  const fullKey = `tribulation.errors.${code}`;
  if (te(fullKey)) return t(fullKey);
  return t('tribulation.errors.UNKNOWN');
});
</script>

<template>
  <section
    class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-3"
    data-testid="tribulation-mini-battle-panel"
  >
    <header class="flex items-baseline justify-between gap-2 flex-wrap">
      <h2 class="text-amber-200 text-lg font-semibold">
        {{ t('tribulation.miniBattle.title') }}
      </h2>
      <p class="text-xs text-ink-300">
        {{ t('tribulation.miniBattle.subtitle') }}
      </p>
    </header>

    <!-- Effect-type hint (5 effects: BURST/SUSTAIN/POISON_RECOVERY/ARMOR_CRIT/DEFENSE_ENDURANCE).
         Render khi đã có battle để user biết strategy ngắn gọn. -->
    <div
      v-if="effectTypeKey"
      class="text-xs text-ink-200 bg-ink-700/40 border border-ink-300/20 rounded px-2 py-1.5"
      data-testid="tribulation-mini-battle-effect-hint"
    >
      <span class="font-semibold mr-1">
        {{ t(`tribulation.encounter.effectType.${effectTypeKey}`) }}:
      </span>
      <span class="text-ink-300">{{ effectTypeHintLabel(effectTypeKey) }}</span>
    </div>

    <!-- No battle yet → show Start button. -->
    <div v-if="!hasBattle" data-testid="tribulation-mini-battle-no-battle">
      <p class="text-xs text-ink-300 mb-2">
        {{ t('tribulation.miniBattle.empty') }}
      </p>
      <button
        type="button"
        :disabled="startButtonDisabled"
        data-testid="tribulation-mini-battle-start-button"
        class="w-full px-3 py-2 text-sm rounded bg-amber-700 text-amber-50 hover:bg-amber-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
        @click="onStart"
      >
        {{ startLabel }}
      </button>
    </div>

    <!-- Has battle → render status + actions/log. -->
    <template v-else-if="battle">
      <TribulationBattleStatus :battle="battle" />

      <TribulationBattleActions
        v-if="tribulation.miniBattleCanAct"
        :battle="battle"
        :action-loading="tribulation.miniBattleActionLoading"
        @submit="onSubmitAction"
      />

      <!-- Terminal but not yet resolved — fallback button (auto-resolve
           normally fires after final action). -->
      <div
        v-else-if="tribulation.miniBattleIsTerminal && !tribulation.miniBattleLastResult"
        class="space-y-1"
        data-testid="tribulation-mini-battle-terminal-resolve"
      >
        <p class="text-xs text-ink-300">
          {{ t('tribulation.miniBattle.terminalHint') }}
        </p>
        <button
          type="button"
          :disabled="resolveButtonDisabled"
          data-testid="tribulation-mini-battle-resolve-button"
          class="w-full px-3 py-2 text-sm rounded bg-rose-700 text-rose-50 hover:bg-rose-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
          @click="onResolve"
        >
          {{
            tribulation.miniBattleResolving
              ? t('tribulation.miniBattle.button.resolving')
              : t('tribulation.miniBattle.button.resolve')
          }}
        </button>
      </div>

      <TribulationBattleLog :battle="battle" />
    </template>

    <p
      v-if="errorMessage"
      class="text-xs text-rose-300"
      data-testid="tribulation-mini-battle-error"
    >
      {{ errorMessage }}
    </p>

    <TribulationBattleResultModal
      :outcome="tribulation.miniBattleLastResult"
      :open="showResultModal"
      :retry-available="!tribulation.miniBattleLastResult?.success"
      @close="onCloseResult"
      @retry="onRetry"
      @return-cultivation="onReturnCultivation"
    />
  </section>
</template>
