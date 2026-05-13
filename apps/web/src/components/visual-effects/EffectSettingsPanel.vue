<script setup lang="ts">
/**
 * Phase 42.0 — Effect settings panel (embed trong SettingsView).
 *
 * Dumb component: emit từng patch lên parent để parent gọi PATCH
 * /player/settings. KHÔNG tự fetch / lưu.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  VISUAL_EFFECT_LEVEL_VALUES,
  type PlayerSettings,
  type VisualEffectLevel,
} from '@xuantoi/shared';

const props = defineProps<{
  settings: PlayerSettings;
  loading?: boolean;
  saving?: boolean;
  testId?: string;
}>();

const emit = defineEmits<{
  (e: 'patch', patch: Partial<PlayerSettings>): void;
}>();

const { t } = useI18n();

const isOff = computed(() => props.settings.visualEffectLevel === 'OFF');

function onLevelChange(ev: Event): void {
  const v = (ev.target as HTMLSelectElement).value as VisualEffectLevel;
  if (!VISUAL_EFFECT_LEVEL_VALUES.includes(v)) return;
  emit('patch', { visualEffectLevel: v });
}

function onToggle(key: keyof PlayerSettings, ev: Event): void {
  const checked = (ev.target as HTMLInputElement).checked;
  emit('patch', { [key]: checked } as Partial<PlayerSettings>);
}

const testId = computed(() => props.testId ?? 'effect-settings-panel');
</script>

<template>
  <section
    class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-3 text-sm"
    :data-testid="testId"
    :data-loading="props.loading ? 'true' : 'false'"
  >
    <header>
      <h2 class="text-amber-200 text-base">{{ t('visualEffects.title') }}</h2>
      <p class="text-xs text-ink-300">{{ t('visualEffects.subtitle') }}</p>
    </header>

    <label class="flex items-center gap-3">
      <span class="min-w-[10rem]">{{ t('playerSettings.fields.visualEffectLevel') }}</span>
      <select
        :value="props.settings.visualEffectLevel"
        :disabled="props.saving"
        class="bg-ink-900/40 border border-ink-300/30 rounded px-2 py-1"
        data-testid="effect-settings-level"
        @change="onLevelChange"
      >
        <option v-for="lv in VISUAL_EFFECT_LEVEL_VALUES" :key="lv" :value="lv">
          {{ t(`visualEffects.level.${lv}`) }}
        </option>
      </select>
    </label>

    <p v-if="props.settings.reduceMotion" class="text-xs text-amber-200/80">
      {{ t('visualEffects.reducedMotionHint') }}
    </p>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-2" :class="{ 'opacity-60': isOff }">
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          :checked="props.settings.showFloatingCombatText"
          :disabled="isOff || props.saving"
          data-testid="effect-settings-floating-text"
          @change="onToggle('showFloatingCombatText', $event)"
        />
        <span>{{ t('playerSettings.fields.showFloatingCombatText') }}</span>
      </label>
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          :checked="props.settings.showRareDropPopup"
          :disabled="isOff || props.saving"
          data-testid="effect-settings-rare-drop"
          @change="onToggle('showRareDropPopup', $event)"
        />
        <span>{{ t('playerSettings.fields.showRareDropPopup') }}</span>
      </label>
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          :checked="props.settings.showBossWarning"
          :disabled="isOff || props.saving"
          data-testid="effect-settings-boss-warning"
          @change="onToggle('showBossWarning', $event)"
        />
        <span>{{ t('playerSettings.fields.showBossWarning') }}</span>
      </label>
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          :checked="props.settings.showBreakthroughEffect"
          :disabled="isOff || props.saving"
          data-testid="effect-settings-breakthrough"
          @change="onToggle('showBreakthroughEffect', $event)"
        />
        <span>{{ t('playerSettings.fields.showBreakthroughEffect') }}</span>
      </label>
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          :checked="props.settings.showCraftingEffect"
          :disabled="isOff || props.saving"
          data-testid="effect-settings-crafting"
          @change="onToggle('showCraftingEffect', $event)"
        />
        <span>{{ t('playerSettings.fields.showCraftingEffect') }}</span>
      </label>
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          :checked="props.settings.showItemAura"
          :disabled="isOff || props.saving"
          data-testid="effect-settings-item-aura"
          @change="onToggle('showItemAura', $event)"
        />
        <span>{{ t('playerSettings.fields.showItemAura') }}</span>
      </label>
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          :checked="props.settings.showStatusEffectBar"
          :disabled="isOff || props.saving"
          data-testid="effect-settings-status-bar"
          @change="onToggle('showStatusEffectBar', $event)"
        />
        <span>{{ t('playerSettings.fields.showStatusEffectBar') }}</span>
      </label>
    </div>
  </section>
</template>
