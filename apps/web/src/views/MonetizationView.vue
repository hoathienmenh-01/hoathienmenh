<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import MButton from '@/components/ui/MButton.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import {
  claimAllBattlePass,
  claimBattlePass,
  claimMonthlyCard,
  getBattlePass,
  getMonthlyCard,
  getVip,
  type BattlePassState,
  type MonetizationReward,
  type MonthlyCardState,
  type VipState,
} from '@/api/monetization';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

type TabKey = 'battlePass' | 'monthlyCard' | 'vip';

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const { locale, t } = useI18n();

const activeTab = ref<TabKey>('battlePass');
const battlePass = ref<BattlePassState | null>(null);
const monthlyCard = ref<MonthlyCardState | null>(null);
const vip = ref<VipState | null>(null);
const loading = ref(true);
const submitting = ref<string | null>(null);

const tabs: TabKey[] = ['battlePass', 'monthlyCard', 'vip'];

const seasonName = computed(() => {
  const season = battlePass.value?.season;
  if (!season) return '—';
  return locale.value === 'en' ? season.nameEn : season.nameVi;
});

const battlePassXpPct = computed(() => {
  const state = battlePass.value;
  if (!state) return 0;
  const currentLevelXp = state.progress.level * state.season.xpPerLevel;
  const nextLevelXp = (state.progress.level + 1) * state.season.xpPerLevel;
  const span = Math.max(1, nextLevelXp - currentLevelXp);
  return Math.min(100, Math.round(((state.progress.xp - currentLevelXp) / span) * 100));
});

const claimAllDisabled = computed(() => {
  const state = battlePass.value;
  if (!state) return true;
  return !state.season.rewards.some(
    (entry) =>
      canClaim(entry.level, 'free') ||
      canClaim(entry.level, 'premium'),
  );
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const [bp, mc, vipState] = await Promise.all([
      getBattlePass(),
      getMonthlyCard(),
      getVip(),
    ]);
    battlePass.value = bp;
    monthlyCard.value = mc;
    vip.value = vipState;
  } catch {
    toast.push({ type: 'error', text: t('monetization.errors.loadFail') });
  } finally {
    loading.value = false;
  }
}

function canClaim(level: number, track: 'free' | 'premium'): boolean {
  const state = battlePass.value;
  if (!state) return false;
  if (state.progress.level < level) return false;
  if (track === 'premium' && !state.progress.premiumUnlocked) return false;
  const claimed =
    track === 'free'
      ? state.progress.claimedFreeLevels
      : state.progress.claimedPremiumLevels;
  return !claimed.includes(level);
}

function isClaimed(level: number, track: 'free' | 'premium'): boolean {
  const state = battlePass.value;
  if (!state) return false;
  const claimed =
    track === 'free'
      ? state.progress.claimedFreeLevels
      : state.progress.claimedPremiumLevels;
  return claimed.includes(level);
}

async function claimBp(level: number, track: 'free' | 'premium'): Promise<void> {
  if (!canClaim(level, track) || submitting.value) return;
  submitting.value = `bp:${track}:${level}`;
  try {
    battlePass.value = await claimBattlePass(level, track);
    toast.push({ type: 'success', text: t('monetization.claimOk') });
    await game.fetchState().catch(() => null);
  } catch (err) {
    showError(err);
  } finally {
    submitting.value = null;
  }
}

async function claimBpAll(): Promise<void> {
  if (claimAllDisabled.value || submitting.value) return;
  submitting.value = 'bp:all';
  try {
    battlePass.value = await claimAllBattlePass();
    toast.push({ type: 'success', text: t('monetization.claimAllOk') });
    await game.fetchState().catch(() => null);
  } catch (err) {
    showError(err);
  } finally {
    submitting.value = null;
  }
}

async function claimMonthly(): Promise<void> {
  if (!monthlyCard.value?.canClaimToday || submitting.value) return;
  submitting.value = 'monthly';
  try {
    monthlyCard.value = await claimMonthlyCard();
    toast.push({ type: 'success', text: t('monetization.claimOk') });
    await game.fetchState().catch(() => null);
  } catch (err) {
    showError(err);
  } finally {
    submitting.value = null;
  }
}

function rewardText(reward: MonetizationReward): string {
  const key = `monetization.reward.${reward.key}`;
  const label = t(key, reward.key);
  return reward.kind === 'cosmetic' ? label : `${label} ×${reward.qty}`;
}

function showError(err: unknown): void {
  const code = extractApiErrorCodeOrDefault(err, 'UNKNOWN');
  toast.push({
    type: 'error',
    text: t(`monetization.errors.${code}`, t('monetization.errors.UNKNOWN')),
  });
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  await refresh();
});
</script>

<template>
  <AppShell>
    <div class="max-w-6xl mx-auto space-y-4">
      <XTLuxHero
        eyebrow="TIÊN LỘ PHÚC LỄ"
        label="Tiên Lộ Phúc Lễ"
        :title="t('monetization.title')"
        :subtitle="t('monetization.subtitle')"
        tone="gold"
        watermark-letter="T"
        breadcrumb="Kho Báu · Phúc Lễ"
        test-id="monetization-view-hero"
      >
        <XTPageEyebrow caps="TIÊN LỘ PHÚC LỄ" label="Tiên Lộ Phúc Lễ" class="sr-only" />
      </XTLuxHero>

      <nav class="flex flex-wrap gap-2" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab"
          type="button"
          class="px-3 py-2 rounded border text-sm"
          :class="activeTab === tab ? 'bg-amber-500/20 border-amber-300 text-amber-100' : 'border-ink-300/30 text-ink-300 hover:bg-ink-700/40'"
          @click="activeTab = tab"
        >
          {{ t(`monetization.tabs.${tab}`) }}
        </button>
      </nav>

      <div v-if="loading" class="text-ink-300 text-sm">{{ t('common.loading') }}</div>

      <section
        v-else-if="activeTab === 'battlePass' && battlePass"
        class="space-y-4"
        data-testid="battle-pass-panel"
      >
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-xl font-bold">{{ seasonName }}</h2>
              <p class="text-xs text-ink-300">
                {{ t('monetization.battlePass.endsAt', { date: new Date(battlePass.season.endAt).toLocaleDateString() }) }}
              </p>
            </div>
            <MButton
              :loading="submitting === 'bp:all'"
              :disabled="claimAllDisabled"
              @click="claimBpAll"
            >
              {{ t('monetization.battlePass.claimAll') }}
            </MButton>
          </div>
          <div class="space-y-1">
            <div class="flex justify-between text-xs text-ink-300">
              <span>{{ t('monetization.battlePass.level', { level: battlePass.progress.level, max: battlePass.season.maxLevel }) }}</span>
              <span>{{ battlePass.progress.xp }} XP</span>
            </div>
            <div class="h-2 rounded bg-ink-900 overflow-hidden">
              <div class="h-full bg-amber-400" :style="{ width: battlePassXpPct + '%' }" />
            </div>
          </div>
          <p class="text-xs text-ink-300">
            {{ battlePass.progress.premiumUnlocked ? t('monetization.battlePass.premiumUnlocked') : t('monetization.battlePass.premiumLocked') }}
          </p>
        </div>

        <div class="grid gap-3">
          <article
            v-for="entry in battlePass.season.rewards"
            :key="entry.level"
            class="grid gap-3 md:grid-cols-[5rem_1fr_1fr] bg-ink-700/20 border border-ink-300/20 rounded p-3"
          >
            <div class="font-bold text-amber-100">
              {{ t('monetization.battlePass.levelShort', { level: entry.level }) }}
            </div>
            <div class="space-y-2">
              <h3 class="text-sm font-bold">{{ t('monetization.battlePass.freeTrack') }}</h3>
              <ul class="text-xs text-ink-300 list-disc list-inside">
                <li v-for="reward in entry.free" :key="reward.kind + reward.key">
                  {{ rewardText(reward) }}
                </li>
              </ul>
              <MButton
                :loading="submitting === `bp:free:${entry.level}`"
                :disabled="!canClaim(entry.level, 'free')"
                @click="claimBp(entry.level, 'free')"
              >
                {{ isClaimed(entry.level, 'free') ? t('monetization.claimed') : t('monetization.claim') }}
              </MButton>
            </div>
            <div class="space-y-2">
              <h3 class="text-sm font-bold">{{ t('monetization.battlePass.premiumTrack') }}</h3>
              <ul class="text-xs text-ink-300 list-disc list-inside">
                <li v-for="reward in entry.premium" :key="reward.kind + reward.key">
                  {{ rewardText(reward) }}
                </li>
              </ul>
              <MButton
                :loading="submitting === `bp:premium:${entry.level}`"
                :disabled="!canClaim(entry.level, 'premium')"
                @click="claimBp(entry.level, 'premium')"
              >
                {{ isClaimed(entry.level, 'premium') ? t('monetization.claimed') : t('monetization.claim') }}
              </MButton>
            </div>
          </article>
        </div>
      </section>

      <section
        v-else-if="activeTab === 'monthlyCard' && monthlyCard"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-4"
        data-testid="monthly-card-panel"
      >
        <div>
          <h2 class="text-xl font-bold">{{ t('monetization.monthlyCard.title') }}</h2>
          <p class="text-sm text-ink-300">
            {{ monthlyCard.active ? t('monetization.monthlyCard.active', { days: monthlyCard.daysRemaining }) : t('monetization.monthlyCard.inactive') }}
          </p>
        </div>
        <div>
          <h3 class="font-bold">{{ t('monetization.monthlyCard.todayReward') }}</h3>
          <ul class="text-sm text-ink-300 list-disc list-inside">
            <li v-for="reward in monthlyCard.todayReward" :key="reward.kind + reward.key">
              {{ rewardText(reward) }}
            </li>
          </ul>
        </div>
        <MButton
          :loading="submitting === 'monthly'"
          :disabled="!monthlyCard.canClaimToday"
          @click="claimMonthly"
        >
          {{ monthlyCard.canClaimToday ? t('monetization.claim') : t('monetization.monthlyCard.claimedToday') }}
        </MButton>
      </section>

      <section
        v-else-if="activeTab === 'vip' && vip"
        class="grid gap-4 md:grid-cols-[16rem_1fr]"
        data-testid="vip-panel"
      >
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-4">
          <h2 class="text-xl font-bold">{{ t('monetization.vip.title') }}</h2>
          <p class="text-amber-200 text-3xl font-bold">VIP {{ vip.profile.vipLevel }}</p>
          <p class="text-xs text-ink-300">
            {{ vip.nextLevel === null ? t('monetization.vip.max') : t('monetization.vip.next', { level: vip.nextLevel }) }}
          </p>
        </div>
        <div class="bg-ink-700/30 border border-ink-300/20 rounded p-4">
          <h3 class="font-bold mb-2">{{ t('monetization.vip.perks') }}</h3>
          <ul class="grid gap-2 text-sm text-ink-200">
            <li>{{ t('monetization.vip.autoSweep', { n: vip.perks.autoSweepBonus }) }}</li>
            <li>{{ t('monetization.vip.inventory', { n: vip.perks.inventorySlotBonus }) }}</li>
            <li>{{ t('monetization.vip.unsocketDiscount', { n: vip.perks.gemUnsocketFeeDiscountPct }) }}</li>
            <li>{{ t('monetization.vip.reforgeDiscount', { n: vip.perks.reforgeFeeDiscountPct }) }}</li>
            <li>{{ t('monetization.vip.dungeonBonus', { n: vip.perks.dungeonEntryBonusDaily }) }}</li>
          </ul>
        </div>
      </section>
    </div>
  </AppShell>
</template>
