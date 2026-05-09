<script setup lang="ts">
/**
 * Phase 14.2.D — ElementIdentityPanel.
 *
 * Dùng cho dungeon list cards + boss header. Hiển thị Ngũ Hành identity
 * nhỏ gọn:
 *   - Dominant element badge (qua ElementBadge).
 *   - Recommended counter element badge + label "khuyến nghị dùng hệ".
 *   - Optional warning text khi player primary element bị countered.
 *
 * Props:
 *   - `dominantElement`: ElementKey | null — hệ chính của target.
 *   - `recommendedCounterElement`: ElementKey | null — hệ khuyến nghị
 *     player dùng (counter).
 *   - `playerPrimaryElement`: ElementKey | null | undefined — primary
 *     linh căn của player. Nếu set + countered → render warning.
 *   - `testIdPrefix`: string — prefix cho data-testid (vd 'dungeon-d1' /
 *     'boss-bk1').
 *
 * Slot: nothing (atomic). Boss tooltip với weakness/resist dùng
 * BossElementTooltip component (composite).
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  computePlayerElementWarning,
  type ElementKey,
  type PlayerElementWarning,
} from '@xuantoi/shared';
import ElementBadge from './ElementBadge.vue';

const props = withDefaults(
  defineProps<{
    dominantElement?: ElementKey | null;
    recommendedCounterElement?: ElementKey | null;
    playerPrimaryElement?: ElementKey | null;
    testIdPrefix?: string;
  }>(),
  {
    dominantElement: null,
    recommendedCounterElement: null,
    playerPrimaryElement: null,
    testIdPrefix: 'identity',
  },
);

const { t } = useI18n();

const warning = computed<PlayerElementWarning>(() =>
  computePlayerElementWarning(
    props.playerPrimaryElement ?? null,
    props.dominantElement ?? null,
  ),
);

const warningClass = computed(() => {
  switch (warning.value) {
    case 'recommended':
      return 'text-emerald-300';
    case 'warning':
      return 'text-rose-300';
    case 'caution':
      return 'text-amber-300';
    default:
      return 'hidden';
  }
});

const warningText = computed(() => {
  if (warning.value === 'none') return '';
  return t(`elementIdentity.warning.${warning.value}`);
});

const dominantTestId = computed(
  () => `${props.testIdPrefix}-dominant-element`,
);
const recommendedTestId = computed(
  () => `${props.testIdPrefix}-recommended-counter`,
);
const warningTestId = computed(
  () => `${props.testIdPrefix}-element-warning`,
);
</script>

<template>
  <div class="flex flex-col gap-1 text-xs">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-ink-300">{{ t('elementIdentity.dominantLabel') }}</span>
      <ElementBadge
        :element="dominantElement"
        :show-neutral="true"
        size="sm"
        :data-testid="dominantTestId"
      />
      <template v-if="recommendedCounterElement">
        <span class="text-ink-300 ml-2">
          {{ t('elementIdentity.recommendedCounterLabel') }}
        </span>
        <ElementBadge
          :element="recommendedCounterElement"
          size="sm"
          :data-testid="recommendedTestId"
        />
      </template>
    </div>
    <div
      v-if="warning !== 'none'"
      :class="['italic', warningClass]"
      :data-testid="warningTestId"
      :data-warning="warning"
    >
      {{ warningText }}
    </div>
  </div>
</template>
