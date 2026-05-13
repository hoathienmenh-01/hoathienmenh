<script setup lang="ts">
/**
 * Phase 42.0 — Effect preview panel (admin / developer sandbox).
 *
 * KHÔNG đụng dữ liệu thật; chỉ tạo sample event để demo. Tất cả
 * dependent components (FloatingCombatText, StatusEffectBar, etc.)
 * được render tại đây.
 */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEFAULT_PLAYER_SETTINGS,
  getAllStatusEffects,
  resolveEffectiveMotionLevel,
  type PlayerSettings,
  type StatusEffectType,
  type VisualEffectMotionLevel,
} from '@xuantoi/shared';
import FloatingCombatText from './FloatingCombatText.vue';
import StatusEffectBar from './StatusEffectBar.vue';
import ItemAuraFrame from './ItemAuraFrame.vue';
import RareDropPopup from './RareDropPopup.vue';
import BossWarningBanner from './BossWarningBanner.vue';
import BreakthroughBanner from './BreakthroughBanner.vue';
import CraftingResultEffect from './CraftingResultEffect.vue';
import { useEffectQueue } from '@/composables/useEffectQueue';

const props = withDefaults(
  defineProps<{
    settings?: PlayerSettings;
    testId?: string;
  }>(),
  {
    settings: () => ({ ...DEFAULT_PLAYER_SETTINGS }),
    testId: 'effect-preview-panel',
  },
);

const { t } = useI18n();

const effectiveLevel = computed<VisualEffectMotionLevel>(() => {
  const lv = props.settings.visualEffectLevel;
  const motion: VisualEffectMotionLevel =
    lv === 'OFF' || lv === 'LOW' || lv === 'MEDIUM' || lv === 'HIGH' ? lv : 'MEDIUM';
  return resolveEffectiveMotionLevel({
    reduceMotion: props.settings.reduceMotion,
    visualEffectLevel: motion,
  });
});

const reducedMotion = computed(() => props.settings.reduceMotion);

// Sample status effects
const sampleStatuses = computed<
  Array<{ key: StatusEffectType; stack?: number; durationRemaining?: number }>
>(() => {
  return getAllStatusEffects()
    .slice(0, 6)
    .map((d, i) => ({
      key: d.key,
      stack: 1 + (i % 3),
      durationRemaining: 3 + i,
    }));
});

// Effect queue demo
const queue = useEffectQueue({ maxVisible: 5, motionLevel: effectiveLevel.value });

function pushSampleQueueEvent(): void {
  const types: Array<{ k: string; amount: number; label?: string }> = [
    { k: 'DAMAGE_NORMAL', amount: 123 },
    { k: 'CRIT', amount: 999, label: 'CRIT' },
    { k: 'HEAL', amount: 250 },
    { k: 'MISS', amount: 0, label: 'MISS' },
    { k: 'BLOCK', amount: 80, label: 'BLOCK' },
    { k: 'DOT', amount: 40 },
  ];
  const pick = types[Math.floor(Math.random() * types.length)];
  queue.pushEffect({
    effectKey: pick.k,
    durationMs: 1500,
    payload: { amount: pick.amount, label: pick.label },
    dedupeKey: pick.k,
  });
}

function clearQueue(): void {
  queue.clearEffects();
}

// Rare drop sample
const showRareDrop = ref(true);

// Boss warning sample selection
const bossWarnings = [
  'BOSS_APPEAR',
  'BOSS_CHARGING',
  'BOSS_ENRAGE',
  'BOSS_LOW_HP',
] as const;
const bossWarningIdx = ref(0);
function nextBossWarning(): void {
  bossWarningIdx.value = (bossWarningIdx.value + 1) % bossWarnings.length;
}

// Breakthrough samples
const breakthroughSuccess = ref(true);
const breakthroughType = ref<'CULTIVATION' | 'BODY_CULTIVATION'>('CULTIVATION');

// Crafting samples
const craftResults = [
  'ALCHEMY_SUCCESS',
  'ALCHEMY_HIGH_QUALITY',
  'DAN_VAN_APPEAR',
  'CRAFT_SUCCESS',
  'ARTIFACT_AWAKEN',
  'ALCHEMY_FAIL',
] as const;
const craftIdx = ref(0);
function nextCraftSample(): void {
  craftIdx.value = (craftIdx.value + 1) % craftResults.length;
}
</script>

<template>
  <div
    class="space-y-6"
    :data-testid="props.testId"
    :data-level="effectiveLevel"
    :data-reduced-motion="reducedMotion ? 'true' : 'false'"
  >
    <header class="space-y-1">
      <h1 class="text-amber-200 text-lg">{{ t('visualEffects.preview.title') }}</h1>
      <p class="text-xs text-ink-300">{{ t('visualEffects.preview.subtitle') }}</p>
      <p class="text-xs text-ink-200">
        {{
          t('visualEffects.preview.settingsHint', {
            level: t(`visualEffects.level.${effectiveLevel}`),
            reduce: reducedMotion ? 'on' : 'off',
          })
        }}
      </p>
    </header>

    <!-- Floating combat text section -->
    <section
      class="border border-ink-300/20 rounded p-3 space-y-2"
      data-testid="preview-floating-text"
    >
      <h2 class="text-amber-200 text-sm">
        {{ t('visualEffects.preview.sections.floatingText') }}
      </h2>
      <div class="flex flex-wrap gap-3 items-center">
        <FloatingCombatText
          type="normal"
          :amount="123"
          :visual-effect-level="effectiveLevel"
          :reduced-motion="reducedMotion"
        />
        <FloatingCombatText
          type="crit"
          :amount="999"
          label="CRIT"
          :visual-effect-level="effectiveLevel"
          :reduced-motion="reducedMotion"
        />
        <FloatingCombatText
          type="miss"
          label="MISS"
          :visual-effect-level="effectiveLevel"
          :reduced-motion="reducedMotion"
        />
        <FloatingCombatText
          type="heal"
          :amount="250"
          :visual-effect-level="effectiveLevel"
          :reduced-motion="reducedMotion"
        />
        <FloatingCombatText
          type="block"
          :amount="80"
          label="BLOCK"
          :visual-effect-level="effectiveLevel"
          :reduced-motion="reducedMotion"
        />
        <FloatingCombatText
          type="dot"
          :amount="40"
          element="WOOD"
          :visual-effect-level="effectiveLevel"
          :reduced-motion="reducedMotion"
        />
      </div>
    </section>

    <!-- Status effects -->
    <section
      class="border border-ink-300/20 rounded p-3 space-y-2"
      data-testid="preview-status-effects"
    >
      <h2 class="text-amber-200 text-sm">
        {{ t('visualEffects.preview.sections.statusEffects') }}
      </h2>
      <StatusEffectBar
        :statuses="sampleStatuses"
        :visual-effect-level="effectiveLevel"
        :reduced-motion="reducedMotion"
      />
    </section>

    <!-- Item aura -->
    <section
      class="border border-ink-300/20 rounded p-3 space-y-2"
      data-testid="preview-item-aura"
    >
      <h2 class="text-amber-200 text-sm">
        {{ t('visualEffects.preview.sections.itemAura') }}
      </h2>
      <div class="flex gap-3 items-center flex-wrap">
        <ItemAuraFrame
          item-name="Common item"
          :tier="1"
          rarity="COMMON"
          :visual-effect-level="effectiveLevel"
          :reduced-motion="reducedMotion"
        >
          <span class="inline-block px-3 py-2 bg-ink-700/40 rounded text-xs">T1 COMMON</span>
        </ItemAuraFrame>
        <ItemAuraFrame
          item-name="Rare item"
          :tier="5"
          rarity="RARE"
          element="FIRE"
          :visual-effect-level="effectiveLevel"
          :reduced-motion="reducedMotion"
        >
          <span class="inline-block px-3 py-2 bg-ink-700/40 rounded text-xs">T5 RARE FIRE</span>
        </ItemAuraFrame>
        <ItemAuraFrame
          item-name="Legendary item"
          :tier="9"
          rarity="LEGENDARY"
          :visual-effect-level="effectiveLevel"
          :reduced-motion="reducedMotion"
        >
          <span class="inline-block px-3 py-2 bg-ink-700/40 rounded text-xs">T9 LEGENDARY</span>
        </ItemAuraFrame>
        <ItemAuraFrame
          item-name="Mythic item"
          :tier="10"
          rarity="MYTHIC"
          :visual-effect-level="effectiveLevel"
          :reduced-motion="reducedMotion"
        >
          <span class="inline-block px-3 py-2 bg-ink-700/40 rounded text-xs">T10 MYTHIC</span>
        </ItemAuraFrame>
      </div>
    </section>

    <!-- Rare drop -->
    <section
      class="border border-ink-300/20 rounded p-3 space-y-2"
      data-testid="preview-rare-drop"
    >
      <h2 class="text-amber-200 text-sm flex items-center gap-2">
        {{ t('visualEffects.preview.sections.rareDrop') }}
        <button
          class="text-xs border border-ink-300/40 rounded px-2 py-0.5"
          data-testid="preview-rare-drop-toggle"
          @click="showRareDrop = !showRareDrop"
        >
          {{ showRareDrop ? t('visualEffects.preview.clear') : t('visualEffects.preview.playSample') }}
        </button>
      </h2>
      <RareDropPopup
        v-if="showRareDrop"
        item-name="Thiên Vô Tận Đan"
        rarity="LEGENDARY"
        source="Trial Tower 7"
        :tier="9"
        :visual-effect-level="effectiveLevel"
        :reduced-motion="reducedMotion"
      />
    </section>

    <!-- Boss warning -->
    <section
      class="border border-ink-300/20 rounded p-3 space-y-2"
      data-testid="preview-boss"
    >
      <h2 class="text-amber-200 text-sm flex items-center gap-2">
        {{ t('visualEffects.preview.sections.boss') }}
        <button
          class="text-xs border border-ink-300/40 rounded px-2 py-0.5"
          data-testid="preview-boss-cycle"
          @click="nextBossWarning"
        >
          {{ t('visualEffects.preview.playSample') }}
        </button>
      </h2>
      <BossWarningBanner
        :boss-name="'Hắc Lân Yêu Tướng'"
        :warning-type="bossWarnings[bossWarningIdx]"
        :severity="bossWarnings[bossWarningIdx] === 'BOSS_ENRAGE' ? 'DANGER' : 'WARNING'"
        :turns-remaining="3"
        :hp-percent="0.18"
        :visual-effect-level="effectiveLevel"
        :reduced-motion="reducedMotion"
      />
    </section>

    <!-- Breakthrough -->
    <section
      class="border border-ink-300/20 rounded p-3 space-y-2"
      data-testid="preview-breakthrough"
    >
      <h2 class="text-amber-200 text-sm flex items-center gap-2">
        {{ t('visualEffects.preview.sections.breakthrough') }}
        <label class="text-xs flex items-center gap-1">
          <input v-model="breakthroughSuccess" type="checkbox" data-testid="preview-breakthrough-success" />
          success
        </label>
        <label class="text-xs flex items-center gap-1">
          <input v-model="breakthroughType" type="radio" value="CULTIVATION" />
          luyện khí
        </label>
        <label class="text-xs flex items-center gap-1">
          <input v-model="breakthroughType" type="radio" value="BODY_CULTIVATION" />
          luyện thể
        </label>
      </h2>
      <BreakthroughBanner
        :success="breakthroughSuccess"
        :breakthrough-type="breakthroughType"
        character-name="Đạo Hữu"
        from-realm="Luyện Khí 9"
        to-realm="Trúc Cơ 1"
        :visual-effect-level="effectiveLevel"
        :reduced-motion="reducedMotion"
      />
    </section>

    <!-- Crafting -->
    <section
      class="border border-ink-300/20 rounded p-3 space-y-2"
      data-testid="preview-crafting"
    >
      <h2 class="text-amber-200 text-sm flex items-center gap-2">
        {{ t('visualEffects.preview.sections.crafting') }}
        <button
          class="text-xs border border-ink-300/40 rounded px-2 py-0.5"
          data-testid="preview-crafting-cycle"
          @click="nextCraftSample"
        >
          {{ t('visualEffects.preview.playSample') }}
        </button>
      </h2>
      <CraftingResultEffect
        :result-type="craftResults[craftIdx]"
        item-name="Đan Hoàng Đan"
        quality="TIEN"
        :visual-effect-level="effectiveLevel"
        :reduced-motion="reducedMotion"
      />
    </section>

    <!-- Queue manager -->
    <section
      class="border border-ink-300/20 rounded p-3 space-y-2"
      data-testid="preview-queue"
    >
      <h2 class="text-amber-200 text-sm flex items-center gap-2">
        {{ t('visualEffects.preview.sections.queue') }}
        <button
          class="text-xs border border-ink-300/40 rounded px-2 py-0.5"
          data-testid="preview-queue-push"
          @click="pushSampleQueueEvent"
        >
          {{ t('visualEffects.preview.playSample') }}
        </button>
        <button
          class="text-xs border border-ink-300/40 rounded px-2 py-0.5"
          data-testid="preview-queue-clear"
          @click="clearQueue"
        >
          {{ t('visualEffects.preview.clear') }}
        </button>
      </h2>
      <p class="text-xs text-ink-300" data-testid="preview-queue-state">
        {{ t('visualEffects.preview.queueState') }}: size={{ queue.size.value }}, visible={{
          queue.visibleEffects.value.length
        }}
      </p>
      <div class="flex flex-wrap gap-3">
        <FloatingCombatText
          v-for="entry in queue.visibleEffects.value"
          :key="entry.id"
          :type="
            entry.effectKey === 'CRIT'
              ? 'crit'
              : entry.effectKey === 'HEAL'
                ? 'heal'
                : entry.effectKey === 'MISS'
                  ? 'miss'
                  : entry.effectKey === 'BLOCK'
                    ? 'block'
                    : entry.effectKey === 'DOT'
                      ? 'dot'
                      : 'normal'
          "
          :amount="typeof entry.payload?.amount === 'number' ? (entry.payload.amount as number) : null"
          :label="typeof entry.payload?.label === 'string' ? (entry.payload.label as string) : undefined"
          :visual-effect-level="effectiveLevel"
          :reduced-motion="reducedMotion"
        />
      </div>
    </section>
  </div>
</template>
