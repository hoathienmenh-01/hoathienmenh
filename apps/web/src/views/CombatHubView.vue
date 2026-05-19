<script setup lang="ts">
/**
 * CombatHubView — `/combat` unified entry surface (PR #631).
 *
 * Hub page that guides players to all available combat surfaces:
 *   - Turn-based Combat (personal dungeon encounters)
 *   - Dungeon Run (solo farm expedition, multi-encounter auto-resolve)
 *   - World Boss (multi-region, realtime HP tracking)
 *   - Co-op Boss (party-based contribution tracking)
 *   - Party Dungeon (co-op PvE with ready check)
 *
 * Each surface card shows:
 *   - Name + brief description
 *   - Availability/eligibility status
 *   - Quick-link to the dedicated view
 *   - Visual cue for daily attempts remaining or active sessions
 *
 * Does NOT implement combat — delegates to existing views. Purely a
 * navigation + overview surface for discoverability.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useDungeonRunStore } from '@/stores/dungeonRun';
import AppShell from '@/components/shell/AppShell.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import MButton from '@/components/ui/MButton.vue';

const auth = useAuthStore();
const game = useGameStore();
const dungeonRunStore = useDungeonRunStore();
const router = useRouter();
const { t } = useI18n();

const ready = ref(false);
const noCharacter = ref(false);

const hasActiveEncounter = ref(false);
const activeBossCount = ref(0);
const hasParty = ref(true); // Assume has party; panels handle no-party error internally

// Dungeon run state computed from store
const dungeonStartable = computed(() => dungeonRunStore.startableCount);
const dungeonActiveRun = computed(() => dungeonRunStore.hasActiveRun);

interface RecommendedAction {
  key: string;
  title: string;
  description: string;
  route: string;
  tone: string;
  icon: string;
}

const recommended = computed<RecommendedAction | null>(() => {
  if (hasActiveEncounter.value) {
    return {
      key: 'continue-encounter',
      title: t('combatHub.recommend.continueEncounter.title', 'Đang chiến đấu!'),
      description: t('combatHub.recommend.continueEncounter.description', 'Bạn có trận chiến đang dở. Tiếp tục để hoàn thành bí cảnh.'),
      route: '/dungeon',
      tone: 'amber',
      icon: '⚔',
    };
  }
  if (activeBossCount.value > 0) {
    return {
      key: 'fight-boss',
      title: t('combatHub.recommend.fightBoss.title', 'Boss đang xuất hiện!'),
      description: t('combatHub.recommend.fightBoss.description', { n: activeBossCount.value }),
      route: '/boss',
      tone: 'rose',
      icon: '☠',
    };
  }
  if (dungeonActiveRun.value) {
    return {
      key: 'continue-run',
      title: t('combatHub.recommend.continueRun.title', 'Bí cảnh đang chạy'),
      description: t('combatHub.recommend.continueRun.description', 'Tiếp tục expedition để nhận thưởng.'),
      route: '/dungeon-run',
      tone: 'emerald',
      icon: '🏔',
    };
  }
  if (dungeonStartable.value > 0) {
    return {
      key: 'start-run',
      title: t('combatHub.recommend.startRun.title', 'Bắt đầu Bí Cảnh Lưu Phát'),
      description: t('combatHub.recommend.startRun.description', { n: dungeonStartable.value }),
      route: '/dungeon-run',
      tone: 'emerald',
      icon: '🏔',
    };
  }
  return {
    key: 'explore-dungeon',
    title: t('combatHub.recommend.exploreDungeon.title', 'Thám hiểm Bí Cảnh'),
    description: t('combatHub.recommend.exploreDungeon.description', 'Chiến đấu turn-based qua từng quái để nhận EXP và vật phẩm.'),
    route: '/dungeon',
    tone: 'amber',
    icon: '⚔',
  };
});

interface CombatSurface {
  key: string;
  title: string;
  description: string;
  route: string;
  tone: string;
  icon: string;
  available: boolean;
  badge: string | null;
  requiresParty: boolean;
}

const surfaces = computed<CombatSurface[]>(() => [
  {
    key: 'dungeon',
    title: t('combatHub.surfaces.dungeon.title', 'Bí Cảnh Thám Tra'),
    description: t('combatHub.surfaces.dungeon.description', 'Chiến đấu turn-based qua từng quái. Chọn kỹ năng, sử dụng thiên phú.'),
    route: '/dungeon',
    tone: 'amber',
    icon: '⚔',
    available: true,
    badge: hasActiveEncounter.value
      ? t('combatHub.badge.inProgress', 'Đang chiến đấu')
      : null,
    requiresParty: false,
  },
  {
    key: 'dungeon-run',
    title: t('combatHub.surfaces.dungeonRun.title', 'Bí Cảnh Lưu Phát'),
    description: t('combatHub.surfaces.dungeonRun.description', 'Farm expedition tự động qua nhiều quái. Nhanh, hiệu quả, có giới hạn hàng ngày.'),
    route: '/dungeon-run',
    tone: 'emerald',
    icon: '🏔',
    available: true,
    badge: dungeonActiveRun.value
      ? t('combatHub.badge.activeRun', 'Có run đang chạy')
      : dungeonStartable.value > 0
        ? t('combatHub.badge.startable', { n: dungeonStartable.value })
        : null,
    requiresParty: false,
  },
  {
    key: 'boss',
    title: t('combatHub.surfaces.boss.title', 'Truy Sát Ma Vương'),
    description: t('combatHub.surfaces.boss.description', 'World Boss đa khu vực. Gây sát thương, leo bảng xếp hạng, nhận thưởng theo thứ hạng.'),
    route: '/boss',
    tone: 'rose',
    icon: '☠',
    available: true,
    badge: activeBossCount.value > 0
      ? t('combatHub.badge.bossActive', { n: activeBossCount.value })
      : t('combatHub.badge.bossNone', 'Chờ spawn'),
    requiresParty: false,
  },
  {
    key: 'coop-boss',
    title: t('combatHub.surfaces.coopBoss.title', 'Co-op Boss'),
    description: t('combatHub.surfaces.coopBoss.description', 'Hợp lực đánh boss cùng tổ đội. Phần thưởng phân theo đóng góp.'),
    route: '/party/coop-boss',
    tone: 'violet',
    icon: '🤝',
    available: hasParty.value,
    badge: !hasParty.value
      ? t('combatHub.badge.needParty', 'Cần tổ đội')
      : null,
    requiresParty: true,
  },
  {
    key: 'party-dungeon',
    title: t('combatHub.surfaces.partyDungeon.title', 'Party Dungeon'),
    description: t('combatHub.surfaces.partyDungeon.description', 'Dungeon co-op PvE. Cùng tổ đội vào phòng, sẵn sàng, và chiến đấu.'),
    route: '/party/dungeon',
    tone: 'teal',
    icon: '🏛',
    available: hasParty.value,
    badge: !hasParty.value
      ? t('combatHub.badge.needParty', 'Cần tổ đội')
      : null,
    requiresParty: true,
  },
]);

function toneClass(tone: string): string {
  const map: Record<string, string> = {
    amber: 'border-amber-400/40 hover:border-amber-400/70',
    emerald: 'border-emerald-400/40 hover:border-emerald-400/70',
    rose: 'border-rose-400/40 hover:border-rose-400/70',
    violet: 'border-violet-400/40 hover:border-violet-400/70',
    teal: 'border-teal-400/40 hover:border-teal-400/70',
  };
  return map[tone] ?? 'border-ink-300/40';
}

function badgeClass(tone: string): string {
  const map: Record<string, string> = {
    amber: 'bg-amber-900/40 text-amber-200',
    emerald: 'bg-emerald-900/40 text-emerald-200',
    rose: 'bg-rose-900/40 text-rose-200',
    violet: 'bg-violet-900/40 text-violet-200',
    teal: 'bg-teal-900/40 text-teal-200',
  };
  return map[tone] ?? 'bg-ink-700/40 text-ink-200';
}

function navigateTo(surface: CombatSurface): void {
  router.push(surface.route);
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  if (!game.character) {
    noCharacter.value = true;
    ready.value = true;
    return;
  }

  // Load dungeon run state for badge
  await dungeonRunStore.load().catch(() => null);

  // Check boss count (quick fetch)
  try {
    const { getActiveBosses } = await import('@/api/boss');
    const bosses = await getActiveBosses();
    activeBossCount.value = bosses.length;
  } catch {
    activeBossCount.value = 0;
  }

  // Check active encounter
  try {
    const { getActiveEncounter } = await import('@/api/combat');
    const enc = await getActiveEncounter();
    hasActiveEncounter.value = enc !== null && enc.status === 'ACTIVE';
  } catch {
    hasActiveEncounter.value = false;
  }

  ready.value = true;
});
</script>

<template>
  <AppShell>
    <XTLuxHero
      :eyebrow="t('combatHub.eyebrow', 'CHIẾN TRƯỜNG')"
      :label="t('combatHub.label', 'Chiến Trường')"
      :title="t('combatHub.title', 'Chiến Trường Tổng Quan')"
      :subtitle="t('combatHub.subtitle', 'Chọn nội dung chiến đấu phù hợp với bạn hôm nay')"
      tone="seal"
      watermark-letter="C"
      :breadcrumb="t('combatHub.breadcrumb', 'Chiến Trường')"
      test-id="combat-hub-hero"
      class="mb-6"
    >
      <XTPageEyebrow caps="CHIẾN TRƯỜNG" label="Chiến Trường" class="sr-only" />
    </XTLuxHero>

    <!-- Role hint -->
    <p class="text-sm text-gray-400 px-1" data-testid="combat-hub-role-hint">
      {{ t('combatHub.roleHint') }}
    </p>

    <!-- Cross-navigation -->
    <nav class="flex gap-2 text-xs mb-2" data-testid="combat-hub-cross-nav">
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
        data-testid="cross-nav-dungeon"
        @click="$router.push('/dungeon')"
      >
        <span>{{ t('combatHub.crossNav.dungeon') }}</span>
        <span class="text-gray-500 hidden sm:inline">{{ t('combatHub.crossNav.dungeonDesc') }}</span>
      </button>
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
        data-testid="cross-nav-boss"
        @click="$router.push('/boss')"
      >
        <span>{{ t('combatHub.crossNav.boss') }}</span>
        <span class="text-gray-500 hidden sm:inline">{{ t('combatHub.crossNav.bossDesc') }}</span>
      </button>
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
        data-testid="cross-nav-arena"
        @click="$router.push('/arena')"
      >
        <span>{{ t('combatHub.crossNav.arena') }}</span>
        <span class="text-gray-500 hidden sm:inline">{{ t('combatHub.crossNav.arenaDesc') }}</span>
      </button>
    </nav>

    <!-- Loading -->
    <div
      v-if="!ready"
      class="text-center py-12 text-ink-400"
      data-testid="combat-hub-loading"
    >
      {{ t('common.loading', 'Đang tải...') }}
    </div>

    <!-- No character -->
    <section
      v-else-if="noCharacter"
      class="text-center py-12 space-y-3"
      data-testid="combat-hub-no-character"
    >
      <p class="text-ink-300 text-lg">
        {{ t('combatHub.noCharacter', 'Bạn cần tạo nhân vật để tham gia chiến đấu.') }}
      </p>
      <MButton data-testid="combat-hub-create-char" @click="router.push('/onboarding')">
        {{ t('combatHub.createCharacter', 'Tạo Nhân Vật') }}
      </MButton>
    </section>

    <!-- Recommended action + Grid (only when ready and has character) -->
    <template v-else>
      <!-- Recommended action -->
      <section
        v-if="recommended"
        class="mb-6 rounded-lg border-2 p-4 space-y-2 cursor-pointer transition-all hover:brightness-110"
        :class="{
          'border-amber-400/60 bg-amber-900/20': recommended.tone === 'amber',
          'border-rose-400/60 bg-rose-900/20': recommended.tone === 'rose',
          'border-emerald-400/60 bg-emerald-900/20': recommended.tone === 'emerald',
        }"
        data-testid="combat-hub-recommend"
        role="button"
        tabindex="0"
        @click="router.push(recommended.route)"
        @keydown.enter="router.push(recommended.route)"
      >
        <div class="flex items-center gap-2">
          <span class="text-xs uppercase tracking-widest text-amber-200/80" data-testid="combat-hub-recommend-label">
            {{ t('combatHub.recommend.label', 'Nên làm') }}
          </span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-3xl" aria-hidden="true">{{ recommended.icon }}</span>
          <div class="flex-1 min-w-0">
            <h3 class="text-base font-bold text-ink-100" data-testid="combat-hub-recommend-title">
              {{ recommended.title }}
            </h3>
            <p class="text-sm text-ink-300" data-testid="combat-hub-recommend-desc">
              {{ recommended.description }}
            </p>
          </div>
          <span class="text-ink-300/60 text-xl">→</span>
        </div>
      </section>

      <!-- Combat surface grid -->
      <div
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        data-testid="combat-hub-grid"
      >
        <article
          v-for="surface in surfaces"
          :key="surface.key"
          class="rounded-lg border bg-ink-700/30 p-4 space-y-3 cursor-pointer transition-all hover:bg-ink-700/50"
          :class="[
            toneClass(surface.tone),
            { 'opacity-60': !surface.available },
          ]"
          :data-testid="`combat-hub-card-${surface.key}`"
          role="button"
          :tabindex="surface.available ? 0 : -1"
          @click="surface.available && navigateTo(surface)"
          @keydown.enter="surface.available && navigateTo(surface)"
        >
          <header class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="text-2xl" aria-hidden="true">{{ surface.icon }}</span>
              <h3 class="text-sm font-bold tracking-wide text-ink-100">
                {{ surface.title }}
              </h3>
            </div>
            <span
              v-if="surface.badge"
              class="shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest"
              :class="badgeClass(surface.tone)"
              :data-testid="`combat-hub-badge-${surface.key}`"
            >
              {{ surface.badge }}
            </span>
          </header>

          <p class="text-xs text-ink-300 leading-relaxed">
            {{ surface.description }}
          </p>

          <footer class="flex items-center justify-between">
            <span
              v-if="!surface.available && surface.requiresParty"
              class="text-[10px] text-amber-300/80"
            >
              {{ t('combatHub.requiresParty', 'Yêu cầu tổ đội') }}
            </span>
            <span v-else class="text-[10px] text-ink-300/60">
              {{ t('combatHub.tapToEnter', 'Nhấn để vào') }}
            </span>
            <span class="text-ink-300/40 text-sm">→</span>
          </footer>
        </article>
      </div>

      <!-- Daily tip -->
      <section
        class="mt-8 rounded border border-ink-300/20 bg-ink-700/20 p-4 space-y-2"
        data-testid="combat-hub-daily-tip"
      >
        <h4 class="text-xs uppercase tracking-widest text-amber-200/80">
          {{ t('combatHub.dailyTip.title', 'Mẹo Hàng Ngày') }}
        </h4>
        <p class="text-xs text-ink-300">
          {{ t('combatHub.dailyTip.body', 'Hoàn thành Bí Cảnh Lưu Phát hàng ngày để tối đa hoá EXP và Linh Thạch. Kết hợp đánh World Boss khi spawn để nhận vật phẩm hiếm. Tham gia Co-op Boss cùng tổ đội để nhận thưởng cấp MVP.') }}
        </p>
      </section>
    </template>
  </AppShell>
</template>
