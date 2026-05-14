<script setup lang="ts">
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
import QuickActionGrid, { type XianxiaQuickAction } from '@/components/xianxia/QuickActionGrid.vue';
import StatCard from '@/components/xianxia/StatCard.vue';
import TodayChecklistCard, { type XianxiaChecklistItem } from '@/components/xianxia/TodayChecklistCard.vue';
import XianxiaCard from '@/components/xianxia/XianxiaCard.vue';
import GameIcon from '@/components/xianxia/GameIcon.vue';
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

const defaultActions: XianxiaQuickAction[] = [
  { key: 'cultivation', title: 'Tu Luyện', description: 'Nhập định, tích lũy linh lực.', route: '/cultivation', icon: 'cultivation', tone: 'jade' },
  { key: 'farm', title: 'Linh Sơn Farm', description: 'Càn quét linh sơn kiếm tài nguyên.', route: '/world/farm-maps', icon: 'farm', tone: 'cyan' },
  { key: 'secretRealms', title: 'Bí Cảnh', description: 'Đi bí cảnh, săn cơ duyên.', route: '/secret-realms', icon: 'secretRealm', tone: 'violet' },
  { key: 'boss', title: 'Boss', description: 'Theo dõi boss thế giới.', route: '/boss', icon: 'boss', tone: 'danger' },
  { key: 'inventory', title: 'Túi Đồ', description: 'Quản lý vật phẩm và trang bị.', route: '/inventory', icon: 'inventory', tone: 'gold' },
  { key: 'alchemy', title: 'Luyện Đan', description: 'Luyện đan dược hỗ trợ tu hành.', route: '/alchemy', icon: 'alchemy', tone: 'jade' },
  { key: 'pets', title: 'Linh Thú', description: 'Chăm sóc bạn đồng hành.', route: '/pets', icon: 'pet', tone: 'cyan' },
  { key: 'sect', title: 'Tông Môn', description: 'Nhiệm vụ và hoạt động môn phái.', route: '/sect', icon: 'sect', tone: 'violet' },
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
    { icon: 'power', label: t('dashboard.stat.power'), value: formatNumberCompact(d.character.power), description: t('dashboard.stat.powerDesc'), tone: 'gold' as const },
    { icon: 'cultivation', label: t('dashboard.stat.spirit'), value: formatNumberCompact(d.character.spirit), description: t('dashboard.stat.spiritDesc'), tone: 'cyan' as const },
    { icon: 'realmBadge', label: t('dashboard.stat.realm'), value: formatRealmName(d.character.realmKey, d.character.realmStage), description: t('dashboard.stat.realmDesc'), tone: 'violet' as const },
    { icon: 'bodyCultivation', label: t('dashboard.stat.body'), value: formatBodyRealmName(d.character.bodyRealmKey, d.character.bodyStage), description: t('dashboard.stat.bodyDesc'), tone: 'jade' as const },
    { icon: 'pill', label: t('dashboard.stat.pill'), value: d.quickLinks.some((q) => q.route === '/alchemy') ? 'Sẵn sàng' : 'Mở', description: t('dashboard.stat.pillDesc'), tone: 'jade' as const },
    { icon: 'tower', label: t('dashboard.stat.tower'), value: 'Tháp', description: t('dashboard.stat.towerDesc'), tone: 'danger' as const },
  ];
});

const rightPanelItems = computed(() => [
  { icon: 'event', title: t('dashboard.right.events'), route: '/events', count: data.value?.counters.unreadNotification ?? 0 },
  { icon: 'boss', title: t('dashboard.right.boss'), route: '/boss', count: data.value?.warnings.filter((w) => w.severity === 'CRITICAL').length ?? 0 },
  { icon: 'secretRealm', title: t('dashboard.right.realms'), route: '/secret-realms', count: data.value?.todayChecklist.filter((i) => i.key === 'CLEAR_DUNGEON' && i.status !== 'DONE').length ?? 0 },
  { icon: 'equipment', title: t('dashboard.right.equipment'), route: '/inventory', count: 0 },
  { icon: 'mail', title: t('dashboard.right.mail'), route: '/mail', count: data.value?.counters.unreadMail ?? 0 },
]);

onMounted(() => {
  void load();
});
</script>

<template>
  <AppShell>
    <div class="mx-auto max-w-7xl space-y-6" data-testid="dashboard-modern">
      <header class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p class="text-xs uppercase tracking-[0.32em] text-emerald-700/70">Thiên Cung Giao Diện · XT</p>
          <h1 class="mt-2 text-3xl font-black tracking-wide text-emerald-950 md:text-4xl">
            {{ t('dashboard.title') }}
          </h1>
          <p class="mt-2 text-sm text-emerald-900/65">{{ t('dashboard.subtitle') }}</p>
        </div>
        <button
          type="button"
          class="inline-flex min-h-10 items-center justify-center rounded-2xl border border-emerald-300/30 bg-white/65 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-50"
          @click="load()"
        >
          {{ t('common.refresh') }}
        </button>
      </header>

      <LoadingState v-if="loading" data-testid="dashboard-loading" />
      <ErrorState
        v-else-if="errorKey"
        :error-key="errorKey"
        data-testid="dashboard-error"
        @retry="load()"
      />

      <template v-else-if="data">
        <CultivationHeroCard
          :name="data.character.displayName"
          :realm="formatRealmName(data.character.realmKey, data.character.realmStage)"
          :power="data.character.power"
          :cultivation-progress="expProgressPct(data.progression.exp)"
          :body-progress="expProgressPct(data.progression.bodyExp)"
          data-testid="dashboard-character"
        />

        <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="dashboard-counters">
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

        <section v-if="data.warnings.length > 0" class="space-y-2" data-testid="dashboard-warnings">
          <h2 class="text-base font-semibold text-amber-700">{{ t('dashboard.warnings.title') }}</h2>
          <button
            v-for="w in data.warnings"
            :key="w.key + (w.route ?? '')"
            type="button"
            :class="[
              'w-full rounded-3xl border p-3 text-left text-sm transition hover:-translate-y-0.5',
              w.severity === 'CRITICAL'
                ? 'border-red-300/60 bg-red-50 text-red-700'
                : w.severity === 'WARNING'
                  ? 'border-amber-300/60 bg-amber-50 text-amber-800'
                  : 'border-emerald-300/35 bg-emerald-50 text-emerald-800',
            ]"
            @click="go(w.route)"
          >
            {{ tSafe(w.key) }}
          </button>
        </section>

        <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div class="space-y-6">
            <TodayChecklistCard :items="checklistItems" @navigate="go" />
            <QuickActionGrid :actions="defaultActions" @navigate="go" />
          </div>

          <XianxiaCard accent="gold" data-testid="dashboard-right-panel">
            <div class="mb-4">
              <h2 class="text-lg font-bold text-emerald-950">{{ t('dashboard.right.title') }}</h2>
              <p class="text-xs text-emerald-900/65">{{ t('dashboard.right.subtitle') }}</p>
            </div>
            <div class="space-y-3">
              <div
                v-if="rightPanelItems.every((item) => item.count === 0)"
                class="rounded-2xl border border-amber-200/45 bg-white/55 p-4 text-sm text-emerald-900/70"
                data-testid="dashboard-right-empty"
              >
                Chưa có lời nào từ thiên cơ. Sự kiện, boss và bí cảnh sẽ sáng lên khi có dữ liệu mới.
              </div>
              <button
                v-for="item in rightPanelItems"
                :key="item.title"
                type="button"
                class="flex w-full items-center gap-3 rounded-2xl border border-emerald-200/35 bg-white/55 p-3 text-left transition hover:bg-emerald-50"
                @click="go(item.route)"
              >
                <GameIcon :name="item.icon" size="sm" />
                <span class="min-w-0 flex-1 truncate text-sm font-semibold text-emerald-950">{{ item.title }}</span>
                <span v-if="item.count > 0" class="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                  {{ item.count }}
                </span>
              </button>
            </div>
          </XianxiaCard>
        </div>
      </template>
    </div>
  </AppShell>
</template>
