<script setup lang="ts">
/**
 * UI-2.0 — Dashboard (Thiên Cung Tổng Quan).
 *
 * Mobile-first layout (PHẦN 1 task spec):
 *   1. Đạo Thân Card (CultivationHeroCard)
 *   2. Tiến Độ Tu Luyện
 *   3. Hôm Nay Nên Làm (TodayChecklistCard)
 *   4. Hoạt Động Nổi Bật (FeaturedActivitiesCard)
 *   5. Quick Actions (QuickActionGrid)
 *
 * Desktop (>= lg) responsive (PHẦN 2):
 *   Row 1: Đạo Thân (2/3) + Resource panel (1/3)
 *   Row 2: Hôm Nay + Hoạt Động (2 cột)
 *   Row 3: Quick Actions full + Stats secondary
 *
 * Preserves existing test ids (dashboard-modern / dashboard-character /
 * dashboard-counters / dashboard-loading / dashboard-error / dashboard-warnings /
 * dashboard-right-panel / dashboard-right-empty) — see DashboardView.test.ts.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppShell from '@/components/shell/AppShell.vue';
import LoadingState from '@/components/ui/LoadingState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import { fetchDashboard } from '@/api/playerExperience';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import type { DashboardResponse, TodayChecklistItem } from '@xuantoi/shared';
import CultivationHeroCard from '@/components/xianxia/CultivationHeroCard.vue';
import QuickActionGrid, {
  type XianxiaQuickAction,
} from '@/components/xianxia/QuickActionGrid.vue';
import StatCard from '@/components/xianxia/StatCard.vue';
import TodayChecklistCard, {
  type XianxiaChecklistItem,
} from '@/components/xianxia/TodayChecklistCard.vue';
import XianxiaCard from '@/components/xianxia/XianxiaCard.vue';
import FeaturedActivitiesCard, {
  type XianxiaFeaturedItem,
} from '@/components/xianxia/FeaturedActivitiesCard.vue';
import GameIcon from '@/components/xianxia/GameIcon.vue';
import XTIcon from '@/components/xianxia/XTIcon.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTOrnateButton from '@/components/xianxia/XTOrnateButton.vue';
import {
  formatBodyRealmName,
  formatNumberCompact,
  formatRealmName,
} from '@/lib/xianxiaFormat';

const { t, te } = useI18n();
const router = useRouter();

const loading = ref(true);
const errorKey = ref<string | null>(null);
const data = ref<DashboardResponse | null>(null);

/** Default quick actions; backend may override via response in the future. */
const defaultActions: XianxiaQuickAction[] = [
  {
    key: 'cultivation',
    title: 'Tu Luyện',
    description: 'Nhập định, tích lũy linh lực.',
    route: '/cultivation',
    icon: 'cultivation',
    tone: 'jade',
  },
  {
    key: 'inventory',
    title: 'Túi Đồ',
    description: 'Quản lý vật phẩm và trang bị.',
    route: '/inventory',
    icon: 'inventory',
    tone: 'gold',
  },
  {
    key: 'equipment',
    title: 'Trang Bị',
    description: 'Phối hợp pháp khí.',
    route: '/equipment',
    icon: 'equipment',
    tone: 'cyan',
  },
  {
    key: 'pets',
    title: 'Linh Thú',
    description: 'Bạn đồng hành thân thuộc.',
    route: '/pets',
    icon: 'pet',
    tone: 'cyan',
  },
  {
    key: 'sect',
    title: 'Tông Môn',
    description: 'Nhiệm vụ môn phái.',
    route: '/sect',
    icon: 'sect',
    tone: 'violet',
  },
  {
    key: 'market',
    title: 'Chợ',
    description: 'Phường thị, đấu giá.',
    route: '/market',
    icon: 'market',
    tone: 'gold',
  },
  {
    key: 'achievements',
    title: 'Thành Tựu',
    description: 'Vinh dự ghi danh.',
    route: '/achievements',
    icon: 'achievement',
    tone: 'gold',
  },
  {
    key: 'mail',
    title: 'Thư',
    description: 'Quà thư sứ đang chờ.',
    route: '/mail',
    icon: 'mail',
    tone: 'jade',
  },
];

async function load(): Promise<void> {
  loading.value = true;
  errorKey.value = null;
  try {
    data.value = await fetchDashboard();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    errorKey.value = `dashboard.errors.${code}`;
  } finally {
    loading.value = false;
  }
}

function go(route: string | null | undefined): void {
  if (!route) return;
  void router.push(route);
}

function tSafe(key: string): string {
  return te(key) ? t(key) : key;
}

function expProgressPct(value: string | number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(4, Math.min(96, Math.round(numeric % 100)));
}

function checklistIcon(item: TodayChecklistItem): string {
  if (item.key === 'CLAIM_MAIL') return 'mail';
  if (item.key === 'RUN_FARM') return 'farm';
  if (item.key === 'CLEAR_DUNGEON') return 'secretRealm';
  if (item.key === 'CHALLENGE_BOSS') return 'boss';
  if (item.key === 'CRAFT_ALCHEMY') return 'alchemy';
  if (item.key === 'JOIN_SECT_ACTIVITY') return 'sect';
  return 'cultivation';
}

const checklistItems = computed<XianxiaChecklistItem[]>(() => {
  if (!data.value) return [];
  return data.value.todayChecklist.map((item) => ({
    key: item.key,
    title: tSafe(item.titleKey),
    description: tSafe(item.descriptionKey),
    route: item.route,
    done: item.status === 'DONE',
    progressText: item.progressText,
    icon: checklistIcon(item),
  }));
});

const statCards = computed(() => {
  const d = data.value;
  if (!d) return [];
  return [
    {
      icon: 'power',
      label: t('dashboard.stat.power'),
      value: formatNumberCompact(d.character.power),
      description: t('dashboard.stat.powerDesc'),
      tone: 'gold' as const,
    },
    {
      icon: 'cultivation',
      label: t('dashboard.stat.spirit'),
      value: formatNumberCompact(d.character.spirit),
      description: t('dashboard.stat.spiritDesc'),
      tone: 'cyan' as const,
    },
    {
      icon: 'realmBadge',
      label: t('dashboard.stat.realm'),
      value: formatRealmName(d.character.realmKey, d.character.realmStage),
      description: t('dashboard.stat.realmDesc'),
      tone: 'violet' as const,
    },
    {
      icon: 'bodyCultivation',
      label: t('dashboard.stat.body'),
      value: formatBodyRealmName(d.character.bodyRealmKey, d.character.bodyStage),
      description: t('dashboard.stat.bodyDesc'),
      tone: 'jade' as const,
    },
  ];
});

/** Featured activities — derived from response counters + warnings. */
const featuredItems = computed<XianxiaFeaturedItem[]>(() => {
  const d = data.value;
  if (!d) return [];
  const items: XianxiaFeaturedItem[] = [];
  const bossWarning = d.warnings.find(
    (w) => w.severity === 'CRITICAL' || (w.route ?? '').startsWith('/boss'),
  );
  items.push({
    key: 'boss',
    title: t('shell.nav.boss'),
    description: bossWarning
      ? tSafe(bossWarning.key)
      : 'Boss thế giới — thử thách hằng ngày.',
    icon: 'boss',
    status: bossWarning ? 'Đang mở' : 'Chờ kích hoạt',
    rewards: ['Linh Thạch', 'Pháp Bảo', 'EXP'],
    tone: 'combat',
    route: '/boss',
  });
  items.push({
    key: 'secretRealm',
    title: t('shell.nav.secretRealms'),
    description: 'Bí cảnh, săn cơ duyên và pháp khí.',
    icon: 'secretRealm',
    status: d.todayChecklist.some(
      (i) => i.key === 'CLEAR_DUNGEON' && i.status !== 'DONE',
    )
      ? 'Còn lượt'
      : 'Đã hết lượt hôm nay',
    rewards: ['Linh Thạch', 'Đan Dược'],
    tone: 'secret',
    route: '/secret-realm',
  });
  items.push({
    key: 'tower',
    title: t('shell.nav.tower'),
    description: 'Đăng Tiên Tháp — leo tầng săn thưởng.',
    icon: 'tower',
    status: 'Đang mở',
    rewards: ['Danh Hiệu', 'Linh Thạch'],
    tone: 'gold',
    route: '/tower',
  });
  if (d.counters.unreadNotification > 0) {
    items.push({
      key: 'events',
      title: t('shell.nav.events'),
      description: 'Sự kiện giới hạn thời gian đang mở.',
      icon: 'event',
      status: `${d.counters.unreadNotification} sự kiện`,
      tone: 'event',
      route: '/events',
    });
  }
  return items;
});

const rightPanelItems = computed(() => [
  {
    icon: 'event',
    title: t('dashboard.right.events'),
    route: '/events',
    count: data.value?.counters.unreadNotification ?? 0,
  },
  {
    icon: 'boss',
    title: t('dashboard.right.boss'),
    route: '/boss',
    count:
      data.value?.warnings.filter((w) => w.severity === 'CRITICAL').length ?? 0,
  },
  {
    icon: 'secretRealm',
    title: t('dashboard.right.realms'),
    route: '/secret-realm',
    count:
      data.value?.todayChecklist.filter(
        (i) => i.key === 'CLEAR_DUNGEON' && i.status !== 'DONE',
      ).length ?? 0,
  },
  {
    icon: 'equipment',
    title: t('dashboard.right.equipment'),
    route: '/inventory',
    count: 0,
  },
  {
    icon: 'mail',
    title: t('dashboard.right.mail'),
    route: '/mail',
    count: data.value?.counters.unreadMail ?? 0,
  },
]);

onMounted(() => {
  void load();
});
</script>

<template>
  <AppShell>
    <div class="space-y-5" data-testid="dashboard-modern">
      <XTLuxHero
        :eyebrow="t('luxHero.dashboard.eyebrow')"
        :label="t('luxHero.dashboard.label')"
        :title="t('dashboard.title')"
        :subtitle="t('dashboard.subtitle')"
        tone="gold"
        watermark-letter="C"
        :breadcrumb="t('luxHero.dashboard.breadcrumb')"
        test-id="dashboard-hero"
      >
        <XTPageEyebrow
          label="Cửu Thiên Mộng"
          test-id="dashboard-hero-eyebrow"
          class="sr-only"
        />
        <XTOrnateButton
          variant="ghost"
          size="md"
          test-id="dashboard-refresh"
          @click="load()"
        >
          <template #icon>
            <XTIcon name="refresh" size="sm" />
          </template>
          {{ t('common.refresh') }}
        </XTOrnateButton>
      </XTLuxHero>

      <LoadingState v-if="loading" data-testid="dashboard-loading" />
      <ErrorState
        v-else-if="errorKey"
        :error-key="errorKey"
        data-testid="dashboard-error"
        @retry="load()"
      />

      <template v-else-if="data">
        <!-- Row 1 — Hero (Đạo Thân) + optional right panel on xl+ -->
        <div class="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <CultivationHeroCard
            :name="data.character.displayName"
            :realm="formatRealmName(data.character.realmKey, data.character.realmStage)"
            :power="data.character.power"
            :cultivation-progress="expProgressPct(data.progression.exp)"
            :body-progress="expProgressPct(data.progression.bodyExp)"
            data-testid="dashboard-character"
          />

          <XianxiaCard accent="gold" data-testid="dashboard-right-panel" class="hidden xl:block">
            <div class="mb-3">
              <h2 class="text-base font-bold text-[var(--xt-text-primary)]">{{ t('dashboard.right.title') }}</h2>
              <p class="text-[11px] text-[var(--xt-text-muted)]">{{ t('dashboard.right.subtitle') }}</p>
            </div>
            <div class="space-y-2">
              <div
                v-if="rightPanelItems.every((item) => item.count === 0)"
                class="rounded-2xl border border-amber-200/45 bg-[var(--xt-bg-surface)] p-3 text-xs text-[var(--xt-text-muted)]"
                data-testid="dashboard-right-empty"
              >
                Chưa có lời nào từ thiên cơ. Sự kiện, boss và bí cảnh sẽ sáng lên khi có dữ liệu mới.
              </div>
              <button
                v-for="item in rightPanelItems"
                :key="item.title"
                type="button"
                class="flex w-full items-center gap-3 rounded-2xl border border-[var(--xt-border-jade)] bg-[var(--xt-bg-surface)] p-2 text-left transition hover:bg-[var(--xt-jade-soft)]"
                @click="go(item.route)"
              >
                <GameIcon :name="item.icon" size="sm" />
                <span class="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--xt-text-primary)]">{{ item.title }}</span>
                <span v-if="item.count > 0" class="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  {{ item.count > 99 ? '99+' : item.count }}
                </span>
              </button>
            </div>
          </XianxiaCard>
        </div>

        <!-- Stats grid — mobile compact, desktop expanded -->
        <section
          class="grid gap-2.5 grid-cols-2 md:grid-cols-3 xl:grid-cols-4"
          data-testid="dashboard-counters"
        >
          <StatCard
            v-for="card in statCards"
            :key="card.label"
            :icon="card.icon"
            :label="card.label"
            :value="card.value"
            :description="card.description"
            :tone="card.tone"
          />
        </section>

        <!-- Warnings -->
        <section v-if="data.warnings.length > 0" class="space-y-2" data-testid="dashboard-warnings">
          <h2 class="text-sm font-semibold text-amber-700 md:text-base">
            {{ t('dashboard.warnings.title') }}
          </h2>
          <button
            v-for="w in data.warnings"
            :key="w.key + (w.route ?? '')"
            type="button"
            :class="[
              'w-full rounded-2xl border p-2.5 text-left text-xs transition hover:-translate-y-0.5 md:p-3 md:text-sm',
              w.severity === 'CRITICAL'
                ? 'border-red-300/60 bg-red-50 text-red-700'
                : w.severity === 'WARNING'
                  ? 'border-[var(--xt-border-gold)] bg-[var(--xt-gold-soft)] text-[var(--xt-text-gold)]'
                  : 'border-[var(--xt-border-jade)] bg-[var(--xt-jade-soft)] text-[var(--xt-text-primary)]',
            ]"
            @click="go(w.route)"
          >
            {{ tSafe(w.key) }}
          </button>
        </section>

        <!-- Row 2 — Hôm Nay + Featured -->
        <div class="grid gap-4 xl:grid-cols-2">
          <TodayChecklistCard :items="checklistItems" @navigate="go" />
          <FeaturedActivitiesCard :items="featuredItems" @navigate="go" />
        </div>

        <!-- Row 3 — Quick actions -->
        <QuickActionGrid :actions="defaultActions" @navigate="go" />
      </template>
    </div>
  </AppShell>
</template>
