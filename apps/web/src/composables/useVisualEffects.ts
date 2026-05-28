/**
 * Phase 45.1 — Visual effects composable with feature flag gate.
 *
 * Returns the effective visual effect level, respecting VISUAL_EFFECTS_ENABLED
 * flag. When the flag is disabled, forces 'OFF' regardless of player settings.
 */
import { computed } from 'vue';
import type { VisualEffectLevel } from '@xuantoi/shared';
import { useFeatureFlagsStore } from '@/stores/featureFlags';

export function useVisualEffects(getLevel: () => VisualEffectLevel) {
  const flags = useFeatureFlagsStore();

  const effectiveLevel = computed<VisualEffectLevel>(() => {
    if (flags.isDisabled('VISUAL_EFFECTS_ENABLED')) return 'OFF';
    return getLevel();
  });

  return { effectiveLevel };
}
