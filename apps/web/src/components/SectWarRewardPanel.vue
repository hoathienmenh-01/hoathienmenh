<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SectWarMyStatus, SectWarRewardTier } from '@/api/sectWar';

interface Props {
  tiers: ReadonlyArray<SectWarRewardTier>;
  me: SectWarMyStatus;
  submitting?: boolean;
}
const props = defineProps<Props>();
const emit = defineEmits<{ (e: 'claim'): void }>();
const { t } = useI18n();

function tierLabel(tier: SectWarRewardTier): string {
  return t(`sectWar.tier.${tier.key}.label`, tier.key);
}

function rankRange(tier: SectWarRewardTier): string {
  // Server gửi Number.POSITIVE_INFINITY → JSON null → render "từ rank trở xuống".
  if (tier.maxRank === null || !Number.isFinite(tier.maxRank)) {
    return t('sectWar.tier.rankFromOnly', { from: tier.minRank });
  }
  if (tier.minRank === tier.maxRank) {
    return t('sectWar.tier.rankSingle', { rank: tier.minRank });
  }
  return t('sectWar.tier.rankRange', { from: tier.minRank, to: tier.maxRank });
}

const eligibleTier = computed(() => {
  if (!props.me.eligibleTierKey) return null;
  return props.tiers.find((t) => t.key === props.me.eligibleTierKey) ?? null;
});

function rewardSummary(tier: SectWarRewardTier): string {
  const parts: string[] = [];
  if (tier.reward.linhThach) {
    parts.push(t('sectWar.reward.linhThach', { n: tier.reward.linhThach }));
  }
  if (tier.reward.tienNgoc) {
    parts.push(t('sectWar.reward.tienNgoc', { n: tier.reward.tienNgoc }));
  }
  if (tier.reward.titleKey) {
    parts.push(t('sectWar.reward.titleAward', { k: tier.reward.titleKey }));
  }
  if (tier.reward.buffKey) {
    parts.push(t('sectWar.reward.buff', { k: tier.reward.buffKey }));
  }
  if (tier.reward.items && tier.reward.items.length > 0) {
    parts.push(t('sectWar.reward.items', { n: tier.reward.items.length }));
  }
  return parts.join(' · ') || '—';
}
</script>

<template>
  <section class="border border-ink-300/40 rounded">
    <div
      class="px-4 py-2 text-xs uppercase tracking-widest text-ink-300 border-b border-ink-300/30"
    >
      {{ t('sectWar.reward.title') }}
    </div>
    <table class="w-full text-sm">
      <thead class="text-xs text-ink-300/70">
        <tr>
          <th class="text-left px-3 py-1">{{ t('sectWar.reward.col.tier') }}</th>
          <th class="text-left px-3 py-1">{{ t('sectWar.reward.col.rankRange') }}</th>
          <th class="text-left px-3 py-1">{{ t('sectWar.reward.col.reward') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="tier in props.tiers"
          :key="tier.key"
          :class="props.me.eligibleTierKey === tier.key ? 'bg-ink-700/30' : ''"
          data-test="sect-war-reward-row"
        >
          <td class="px-3 py-1">{{ tierLabel(tier) }}</td>
          <td class="px-3 py-1 text-ink-300">{{ rankRange(tier) }}</td>
          <td class="px-3 py-1">{{ rewardSummary(tier) }}</td>
        </tr>
      </tbody>
    </table>

    <div class="px-4 py-3 border-t border-ink-300/30 flex items-center justify-between">
      <div class="text-xs text-ink-300">
        <template v-if="props.me.alreadyClaimed">
          {{ t('sectWar.reward.alreadyClaimed') }}
        </template>
        <template v-else-if="!props.me.hasSect">
          {{ t('sectWar.reward.requireSect') }}
        </template>
        <template v-else-if="!eligibleTier">
          {{ t('sectWar.reward.notEligible') }}
        </template>
        <template v-else>
          {{ t('sectWar.reward.eligibleHint', { tier: tierLabel(eligibleTier) }) }}
        </template>
      </div>
      <button
        type="button"
        class="px-3 py-1 rounded border border-amber-300/40 text-amber-200 disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="!props.me.canClaim || props.submitting"
        data-test="sect-war-claim-button"
        @click="emit('claim')"
      >
        {{ t('sectWar.reward.claimBtn') }}
      </button>
    </div>
  </section>
</template>
