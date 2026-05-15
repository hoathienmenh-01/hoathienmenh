<script setup lang="ts">
/**
 * Phase 11.10.E — Achievement (Thành Tựu) view.
 *
 * Hiển thị tất cả achievement (visible) — server trả về qua
 * `GET /character/achievements` (Phase 11.10.E new endpoint) — kèm
 * progress/completedAt/claimedAt + cho phép claim qua
 * `POST /character/achievement/claim` (Phase 11.10.C-1 endpoint).
 *
 * Server-authoritative:
 *   - Server validate completedAt!=null + claimedAt==null + grant
 *     linhThach/tienNgoc/exp/title/items qua CurrencyLedger + ItemLedger
 *     reason ACHIEVEMENT_REWARD (Phase 11.10.C-1/D đã merge).
 *
 * Filters:
 *   - Category: all | combat | cultivation | exploration | social | economy
 *     | milestone | collection
 *   - Tier: all | bronze | silver | gold | platinum | diamond
 *   - Status: all | completed | unclaimed | inProgress
 *
 * Mỗi achievement card hiển thị:
 *   - Tên + tier badge + category badge + element badge (nếu có) + status
 *     badge (Hoàn thành / Có thể nhận / Đã nhận).
 *   - Description.
 *   - Progress bar (progress/goalAmount).
 *   - Reward: linhThach + tienNgoc + exp + title + items (ẩn dòng 0).
 *   - Nút "Nhận thưởng" (3 trạng thái: claim / claiming / claimed / disabled
 *     nếu chưa complete).
 *
 * KHÔNG đụng schema/seed/runtime — pure FE wire của 2 endpoint backend.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  ACHIEVEMENTS,
  type AchievementCategory,
  type AchievementTier,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useAchievementsStore } from '@/stores/achievements';
import { useToastStore } from '@/stores/toast';
import type { AchievementRow } from '@/api/achievements';
import AppShell from '@/components/shell/AppShell.vue';
import XTHeroEyebrow from '@/components/xianxia/XTHeroEyebrow.vue';

type CategoryFilter = 'all' | AchievementCategory;
type TierFilter = 'all' | AchievementTier;
type StatusFilter = 'all' | 'completed' | 'unclaimed' | 'inProgress';

const auth = useAuthStore();
const game = useGameStore();
const achievements = useAchievementsStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const categoryFilter = ref<CategoryFilter>('all');
const tierFilter = ref<TierFilter>('all');
const statusFilter = ref<StatusFilter>('all');

const filtered = computed<AchievementRow[]>(() => {
  return achievements.rows.filter((r) => {
    if (categoryFilter.value !== 'all' && r.def.category !== categoryFilter.value) {
      return false;
    }
    if (tierFilter.value !== 'all' && r.def.tier !== tierFilter.value) {
      return false;
    }
    if (statusFilter.value === 'completed' && r.completedAt === null) return false;
    if (
      statusFilter.value === 'unclaimed' &&
      (r.completedAt === null || r.claimedAt !== null)
    ) {
      return false;
    }
    if (statusFilter.value === 'inProgress' && r.completedAt !== null) return false;
    return true;
  });
});

const counts = computed(() => ({
  shown: filtered.value.length,
  total: achievements.rows.length,
  catalog: ACHIEVEMENTS.length,
}));

function tierClass(tier: AchievementTier): string {
  switch (tier) {
    case 'bronze':
      return 'bg-amber-900/40 text-amber-200 border-amber-700/50';
    case 'silver':
      return 'bg-stone-600/40 text-stone-100 border-stone-400/50';
    case 'gold':
      return 'bg-yellow-600/40 text-yellow-100 border-yellow-400/50';
    case 'platinum':
      return 'bg-sky-600/40 text-sky-100 border-sky-400/50';
    case 'diamond':
      return 'bg-violet-600/40 text-violet-100 border-violet-400/50';
    default:
      return 'bg-ink-700/40 text-ink-200 border-ink-300/30';
  }
}

function rowStatus(row: AchievementRow): 'inProgress' | 'unclaimed' | 'claimed' {
  if (row.claimedAt !== null) return 'claimed';
  if (row.completedAt !== null) return 'unclaimed';
  return 'inProgress';
}

function statusClass(s: 'inProgress' | 'unclaimed' | 'claimed'): string {
  switch (s) {
    case 'claimed':
      return 'bg-emerald-700/40 text-emerald-200 border-emerald-500/40';
    case 'unclaimed':
      return 'bg-amber-700/40 text-amber-200 border-amber-500/40';
    default:
      return 'bg-ink-700/40 text-ink-300 border-ink-300/30';
  }
}

function progressPct(row: AchievementRow): number {
  const goal = row.def.goalAmount;
  if (goal <= 0) return 0;
  return Math.min(100, Math.round((row.progress / goal) * 100));
}

function claimButtonLabel(row: AchievementRow): string {
  const s = rowStatus(row);
  if (s === 'claimed') return t('achievements.button.claimed');
  if (achievements.isClaiming(row.achievementKey)) {
    return t('achievements.button.claiming');
  }
  if (s === 'unclaimed') return t('achievements.button.claim');
  return t('achievements.button.locked');
}

function claimButtonDisabled(row: AchievementRow): boolean {
  const s = rowStatus(row);
  if (s !== 'unclaimed') return true;
  return achievements.isClaiming(row.achievementKey);
}

async function onClaim(row: AchievementRow): Promise<void> {
  if (claimButtonDisabled(row)) return;
  const errCode = await achievements.claim(row.achievementKey);
  if (errCode === null) {
    toast.push({
      type: 'success',
      text: t('achievements.claim.success', { name: row.def.nameVi }),
    });
  } else {
    const key = `achievements.claim.errors.${errCode}`;
    const text = t(key);
    toast.push({
      type: 'error',
      text: text === key ? t('achievements.claim.errors.UNKNOWN') : text,
    });
  }
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  await achievements.fetchState().catch(() => null);
});
</script>

<template>
  <AppShell>
    <div class="max-w-5xl mx-auto space-y-4">
      <header class="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <XTHeroEyebrow han="纪德碌" label="Kỷ Đức Bi" />
          <h1 class="text-2xl tracking-widest font-bold mt-1">{{ t('achievements.title') }}</h1>
          <p class="text-xs text-ink-300 mt-1">
            {{ t('achievements.subtitle') }}
          </p>
        </div>
        <div
          class="text-xs text-ink-300"
          data-testid="achievements-summary"
        >
          {{
            t('achievements.summary', {
              completed: achievements.completedCount,
              claimable: achievements.claimableCount,
            })
          }}
        </div>
      </header>

      <!--
        Phase 11.10.F — stats summary 4 badge (total/locked/claimable/claimed)
        tính trên FULL `rows` (không phải filtered). Counts không đổi khi user
        toggle category/tier/status filter.
      -->
      <section
        v-if="achievements.loaded && achievements.totalCount > 0"
        class="flex items-center gap-2 flex-wrap text-xs"
        data-testid="achievements-stats"
      >
        <span class="text-ink-300">{{ t('achievements.stats.label') }}</span>
        <span
          class="px-2 py-0.5 rounded border bg-ink-700/30 border-ink-300/30 text-ink-100"
          data-testid="achievements-stats-total"
        >
          {{ t('achievements.stats.total', { count: achievements.totalCount }) }}
        </span>
        <span
          class="px-2 py-0.5 rounded border bg-slate-700/30 border-slate-500/40 text-slate-100"
          data-testid="achievements-stats-locked"
        >
          {{ t('achievements.stats.locked', { count: achievements.lockedCount }) }}
        </span>
        <span
          class="px-2 py-0.5 rounded border bg-amber-700/30 border-amber-500/40 text-amber-100"
          data-testid="achievements-stats-claimable"
        >
          {{ t('achievements.stats.claimable', { count: achievements.claimableCount }) }}
        </span>
        <span
          class="px-2 py-0.5 rounded border bg-emerald-700/30 border-emerald-500/40 text-emerald-100"
          data-testid="achievements-stats-claimed"
        >
          {{ t('achievements.stats.claimed', { count: achievements.claimedCount }) }}
        </span>
      </section>

      <section class="flex flex-wrap gap-3 items-center text-xs">
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('achievements.filter.category') }}</label>
          <select
            v-model="categoryFilter"
            data-testid="achievements-filter-category"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('achievements.filter.all') }}</option>
            <option value="combat">{{ t('achievements.category.combat') }}</option>
            <option value="cultivation">{{ t('achievements.category.cultivation') }}</option>
            <option value="exploration">{{ t('achievements.category.exploration') }}</option>
            <option value="social">{{ t('achievements.category.social') }}</option>
            <option value="economy">{{ t('achievements.category.economy') }}</option>
            <option value="milestone">{{ t('achievements.category.milestone') }}</option>
            <option value="collection">{{ t('achievements.category.collection') }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('achievements.filter.tier') }}</label>
          <select
            v-model="tierFilter"
            data-testid="achievements-filter-tier"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('achievements.filter.all') }}</option>
            <option value="bronze">{{ t('achievements.tier.bronze') }}</option>
            <option value="silver">{{ t('achievements.tier.silver') }}</option>
            <option value="gold">{{ t('achievements.tier.gold') }}</option>
            <option value="platinum">{{ t('achievements.tier.platinum') }}</option>
            <option value="diamond">{{ t('achievements.tier.diamond') }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('achievements.filter.status') }}</label>
          <select
            v-model="statusFilter"
            data-testid="achievements-filter-status"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('achievements.filter.all') }}</option>
            <option value="completed">{{ t('achievements.status.completed') }}</option>
            <option value="unclaimed">{{ t('achievements.status.unclaimed') }}</option>
            <option value="inProgress">{{ t('achievements.status.inProgress') }}</option>
          </select>
        </div>
        <span class="ml-auto text-ink-300" data-testid="achievements-count">
          {{
            t('achievements.filter.shown', {
              shown: counts.shown,
              total: counts.total,
              catalog: counts.catalog,
            })
          }}
        </span>
      </section>

      <section
        v-if="!achievements.loaded"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="achievements-loading"
      >
        {{ t('achievements.loading') }}
      </section>

      <section
        v-else-if="counts.shown === 0"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="achievements-empty"
      >
        {{ t('achievements.empty') }}
      </section>

      <section
        v-else
        class="grid grid-cols-1 md:grid-cols-2 gap-3"
        data-testid="achievements-list"
      >
        <article
          v-for="row in filtered"
          :key="row.achievementKey"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-3 space-y-2"
          :data-testid="`achievements-card-${row.achievementKey}`"
        >
          <header class="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 class="text-amber-200 text-base font-semibold">{{ row.def.nameVi }}</h2>
            <div class="flex items-center gap-1 flex-wrap">
              <span
                :class="[
                  'text-[10px] px-1.5 py-0.5 rounded border',
                  tierClass(row.def.tier),
                ]"
                :data-testid="`achievements-tier-${row.achievementKey}`"
              >
                {{ t(`achievements.tier.${row.def.tier}`) }}
              </span>
              <span
                class="text-[10px] px-1.5 py-0.5 rounded border bg-ink-700/40 text-ink-200 border-ink-300/30"
                :data-testid="`achievements-category-${row.achievementKey}`"
              >
                {{ t(`achievements.category.${row.def.category}`) }}
              </span>
              <span
                v-if="row.def.element"
                class="text-[10px] px-1.5 py-0.5 rounded border bg-ink-700/40 text-ink-200 border-ink-300/30"
                :data-testid="`achievements-element-${row.achievementKey}`"
              >
                {{ t(`achievements.element.${row.def.element}`) }}
              </span>
              <span
                :class="[
                  'text-[10px] px-1.5 py-0.5 rounded border',
                  statusClass(rowStatus(row)),
                ]"
                :data-testid="`achievements-status-${row.achievementKey}`"
              >
                {{ t(`achievements.status.${rowStatus(row)}`) }}
              </span>
            </div>
          </header>

          <p class="text-xs text-ink-300">{{ row.def.description }}</p>

          <div class="text-xs space-y-1">
            <div class="flex items-center gap-2">
              <div
                class="flex-1 h-2 bg-ink-900 rounded overflow-hidden"
                :data-testid="`achievements-progress-bar-${row.achievementKey}`"
              >
                <div
                  class="h-full bg-amber-600"
                  :style="{ width: `${progressPct(row)}%` }"
                />
              </div>
              <span
                class="text-ink-200 text-[11px] tabular-nums"
                :data-testid="`achievements-progress-text-${row.achievementKey}`"
              >
                {{ row.progress }}/{{ row.def.goalAmount }}
              </span>
            </div>

            <div
              v-if="
                (row.def.reward.linhThach && row.def.reward.linhThach > 0) ||
                  (row.def.reward.tienNgoc && row.def.reward.tienNgoc > 0) ||
                  (row.def.reward.exp && row.def.reward.exp > 0) ||
                  row.def.rewardTitleKey ||
                  (row.def.reward.items && row.def.reward.items.length > 0)
              "
              class="flex flex-wrap gap-x-3 gap-y-0.5"
              :data-testid="`achievements-reward-${row.achievementKey}`"
            >
              <span class="text-ink-300">{{ t('achievements.field.reward') }}:</span>
              <span v-if="row.def.reward.linhThach && row.def.reward.linhThach > 0" class="text-emerald-200">
                +{{ row.def.reward.linhThach }} {{ t('achievements.reward.linhThach') }}
              </span>
              <span v-if="row.def.reward.tienNgoc && row.def.reward.tienNgoc > 0" class="text-violet-200">
                +{{ row.def.reward.tienNgoc }} {{ t('achievements.reward.tienNgoc') }}
              </span>
              <span v-if="row.def.reward.exp && row.def.reward.exp > 0" class="text-sky-200">
                +{{ row.def.reward.exp }} {{ t('achievements.reward.exp') }}
              </span>
              <span v-if="row.def.rewardTitleKey" class="text-amber-200">
                {{ t('achievements.reward.title') }}: {{ row.def.rewardTitleKey }}
              </span>
              <span v-if="row.def.reward.items && row.def.reward.items.length > 0" class="text-rose-200">
                {{ t('achievements.reward.items', { count: row.def.reward.items.length }) }}
              </span>
            </div>
          </div>

          <button
            type="button"
            :disabled="claimButtonDisabled(row)"
            :data-testid="`achievements-claim-${row.achievementKey}`"
            class="w-full mt-1 px-3 py-1.5 text-sm rounded bg-amber-700 text-amber-50 hover:bg-amber-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
            @click="onClaim(row)"
          >
            {{ claimButtonLabel(row) }}
          </button>
        </article>
      </section>
    </div>
  </AppShell>
</template>
