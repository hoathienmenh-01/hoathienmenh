<script setup lang="ts">
/**
 * Phase 14.2.D — BossElementTooltip.
 *
 * Hiển thị element identity của boss: weakness (hệ khắc boss), resist
 * elements (hệ boss kháng), reward hint flavor. Dùng trong BossView
 * header dưới dòng region badge.
 *
 * Props:
 *   - `element`: ElementKey | null — hệ của boss.
 *   - `weaknessElement`: ElementKey | null — hệ khắc boss (player nên
 *     dùng).
 *   - `resistElements`: readonly ElementKey[] — list hệ boss kháng.
 *   - `rewardElementHint`: ElementKey | null — flavor reward.
 *   - `playerPrimaryElement`: ElementKey | null | undefined — để show
 *     warning nếu player bị boss khắc.
 *   - `testIdPrefix`: string — `data-testid` prefix.
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
    element?: ElementKey | null;
    weaknessElement?: ElementKey | null;
    resistElements?: readonly ElementKey[];
    rewardElementHint?: ElementKey | null;
    playerPrimaryElement?: ElementKey | null;
    testIdPrefix?: string;
  }>(),
  {
    element: null,
    weaknessElement: null,
    resistElements: () => [],
    rewardElementHint: null,
    playerPrimaryElement: null,
    testIdPrefix: 'boss',
  },
);

const { t } = useI18n();

const warning = computed<PlayerElementWarning>(() =>
  computePlayerElementWarning(
    props.playerPrimaryElement ?? null,
    props.element ?? null,
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

const elementTestId = computed(() => `${props.testIdPrefix}-element`);
const weaknessTestId = computed(() => `${props.testIdPrefix}-weakness`);
const resistsTestId = computed(() => `${props.testIdPrefix}-resists`);
const rewardHintTestId = computed(() => `${props.testIdPrefix}-reward-hint`);
const warningTestId = computed(() => `${props.testIdPrefix}-element-warning`);

const showResists = computed(() => props.resistElements.length > 0);
</script>

<template>
  <div class="flex flex-col gap-1 text-xs">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-ink-300">{{ t('elementIdentity.dominantLabel') }}</span>
      <ElementBadge
        :element="element"
        :show-neutral="true"
        size="sm"
        :data-testid="elementTestId"
      />
      <template v-if="weaknessElement">
        <span class="text-ink-300 ml-2">{{
          t('elementIdentity.weaknessLabel')
        }}</span>
        <ElementBadge
          :element="weaknessElement"
          size="sm"
          :data-testid="weaknessTestId"
        />
      </template>
    </div>
    <div
      v-if="showResists"
      class="flex flex-wrap items-center gap-2"
      :data-testid="resistsTestId"
    >
      <span class="text-ink-300">{{ t('elementIdentity.resistsLabel') }}</span>
      <ElementBadge
        v-for="el in resistElements"
        :key="el"
        :element="el"
        size="sm"
        :data-testid="`${testIdPrefix}-resist-${el}`"
      />
    </div>
    <div v-if="rewardElementHint" class="flex flex-wrap items-center gap-2">
      <span class="text-ink-300">{{ t('elementIdentity.rewardHintLabel') }}</span>
      <ElementBadge
        :element="rewardElementHint"
        size="sm"
        :data-testid="rewardHintTestId"
      />
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
