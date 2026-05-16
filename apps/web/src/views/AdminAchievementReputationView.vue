<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  adminAchievementCatalog,
  adminAchievementProgress,
  type AdminAchievementCatalogSummary,
  type AdminPlayerProgressSummary,
} from '@/api/admin';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';

defineProps<{ embedded?: boolean }>();

const auth = useAuthStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const catalog = ref<AdminAchievementCatalogSummary | null>(null);
const progress = ref<AdminPlayerProgressSummary | null>(null);
const targetUserId = ref('');
const loading = ref(false);

const totals = computed(() => ({
  achievements: catalog.value?.achievements.length ?? 0,
  titles: catalog.value?.titles.length ?? 0,
  reputationGroups: catalog.value?.reputationGroups.length ?? 0,
  longTermGoals: catalog.value?.longTermGoals.length ?? 0,
}));

async function loadCatalog(): Promise<void> {
  loading.value = true;
  try {
    catalog.value = await adminAchievementCatalog();
  } catch {
    toast.push({ type: 'error', text: t('adminAchievement.errors.load') });
  } finally {
    loading.value = false;
  }
}

async function loadProgress(): Promise<void> {
  if (!targetUserId.value.trim()) return;
  loading.value = true;
  try {
    progress.value = await adminAchievementProgress(targetUserId.value.trim());
  } catch {
    progress.value = null;
    toast.push({ type: 'error', text: t('adminAchievement.errors.progress') });
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.user || (auth.user.role !== 'ADMIN' && auth.user.role !== 'MOD')) {
    router.replace('/home');
    return;
  }
  await loadCatalog();
});
</script>

<template>
  <component :is="embedded ? 'div' : AppShell">
    <div class="max-w-6xl mx-auto space-y-4">
      <header class="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <XTPageEyebrow caps="CÔNG TRẠNG THẨM ĐỊNH" label="Công Trạng Thẩm Định" />
          <h1 class="text-2xl tracking-widest font-bold mt-1">
            {{ t('adminAchievement.title') }}
          </h1>
          <p class="text-xs text-ink-300 mt-1">{{ t('adminAchievement.subtitle') }}</p>
        </div>
        <div class="text-xs text-ink-300" data-testid="admin-achievement-summary">
          {{
            t('adminAchievement.summary', {
              achievements: totals.achievements,
              titles: totals.titles,
              groups: totals.reputationGroups,
              goals: totals.longTermGoals,
            })
          }}
        </div>
      </header>

      <section
        v-if="loading && !catalog"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="admin-achievement-loading"
      >
        {{ t('adminAchievement.loading') }}
      </section>

      <template v-else-if="catalog">
        <section class="grid gap-3 md:grid-cols-4">
          <div
            v-for="item in [
              ['achievements', totals.achievements],
              ['titles', totals.titles],
              ['groups', totals.reputationGroups],
              ['goals', totals.longTermGoals],
            ]"
            :key="item[0]"
            class="rounded border border-ink-300/20 bg-ink-800/60 p-3"
            :data-testid="`admin-achievement-stat-${item[0]}`"
          >
            <div class="text-xs text-ink-300">
              {{ t(`adminAchievement.stat.${item[0]}`) }}
            </div>
            <div class="text-xl font-semibold text-amber-100">{{ item[1] }}</div>
          </div>
        </section>

        <section class="bg-ink-800/60 border border-ink-300/20 rounded p-4 space-y-3">
          <h2 class="text-lg font-semibold">{{ t('adminAchievement.catalogTitle') }}</h2>
          <div class="grid gap-3 md:grid-cols-2">
            <article
              v-for="def in catalog.achievements.slice(0, 12)"
              :key="def.key"
              class="rounded border border-ink-300/20 bg-ink-900/40 p-3"
              :data-testid="`admin-achievement-catalog-${def.key}`"
            >
              <div class="flex items-center gap-2">
                <span class="font-semibold text-ink-100">{{ def.nameVi }}</span>
                <span class="text-[10px] text-ink-300">{{ def.category }} / {{ def.tier }}</span>
              </div>
              <p class="text-xs text-ink-300 mt-1">{{ def.description }}</p>
            </article>
          </div>
        </section>

        <section class="bg-ink-800/60 border border-ink-300/20 rounded p-4 space-y-3">
          <h2 class="text-lg font-semibold">{{ t('adminAchievement.progressTitle') }}</h2>
          <div class="flex flex-wrap gap-2 text-sm">
            <input
              v-model="targetUserId"
              class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 min-w-72"
              :placeholder="t('adminAchievement.userIdPlaceholder')"
              data-testid="admin-achievement-user-id"
            />
            <button
              class="px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 text-ink-950 font-semibold disabled:opacity-50"
              :disabled="loading || !targetUserId.trim()"
              data-testid="admin-achievement-load-progress"
              @click="loadProgress"
            >
              {{ t('adminAchievement.loadProgress') }}
            </button>
          </div>

          <div
            v-if="progress"
            class="grid gap-3 md:grid-cols-4 text-sm"
            data-testid="admin-achievement-progress"
          >
            <div class="rounded border border-ink-300/20 bg-ink-900/40 p-3">
              <div class="text-xs text-ink-300">{{ progress.characterName }}</div>
              <div>{{ progress.userId }}</div>
            </div>
            <div class="rounded border border-ink-300/20 bg-ink-900/40 p-3">
              {{ t('adminAchievement.progress.achievements', { count: progress.achievements.length }) }}
            </div>
            <div class="rounded border border-ink-300/20 bg-ink-900/40 p-3">
              {{ t('adminAchievement.progress.titles', { count: progress.titles.length }) }}
            </div>
            <div class="rounded border border-ink-300/20 bg-ink-900/40 p-3">
              {{ t('adminAchievement.progress.reputation', { count: progress.reputation.length }) }}
            </div>
          </div>
        </section>
      </template>
    </div>
  </component>
</template>
