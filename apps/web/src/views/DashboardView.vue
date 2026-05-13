<script setup lang="ts">
/**
 * Phase 41.0 — Dashboard view.
 *
 * Read-only aggregate: character summary + counters + today checklist +
 * warnings + quick links. KHÔNG mint reward. Tất cả navigation đi qua
 * Vue Router; checklist disabled item KHÔNG nhảy route.
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppShell from '@/components/shell/AppShell.vue';
import LoadingState from '@/components/ui/LoadingState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import { fetchDashboard } from '@/api/playerExperience';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import type { DashboardResponse } from '@xuantoi/shared';

const { t, te } = useI18n();
const router = useRouter();

const loading = ref(true);
const errorKey = ref<string | null>(null);
const data = ref<DashboardResponse | null>(null);

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
  router.push(route);
}

function tSafe(key: string): string {
  return te(key) ? t(key) : key;
}

onMounted(() => {
  void load();
});
</script>

<template>
  <AppShell>
    <div class="max-w-4xl mx-auto space-y-6">
      <header class="space-y-1">
        <h1 class="text-2xl tracking-widest font-bold">{{ t('dashboard.title') }}</h1>
        <p class="text-xs text-ink-300">{{ t('dashboard.subtitle') }}</p>
      </header>

      <LoadingState v-if="loading" data-testid="dashboard-loading" />
      <ErrorState
        v-else-if="errorKey"
        :error-key="errorKey"
        data-testid="dashboard-error"
        @retry="load()"
      />

      <template v-else-if="data">
        <!-- Character summary -->
        <section
          class="bg-ink-700/30 border border-ink-300/20 rounded p-4 space-y-3 text-sm"
          data-testid="dashboard-character"
        >
          <h2 class="text-amber-200 text-base">{{ t('dashboard.character.title') }}</h2>
          <dl class="grid grid-cols-2 gap-2">
            <dt class="text-ink-300">{{ t('dashboard.character.name') }}</dt>
            <dd>{{ data.character.displayName }}</dd>
            <dt class="text-ink-300">{{ t('dashboard.character.realm') }}</dt>
            <dd>
              {{ data.character.realmKey }} · {{ t('dashboard.character.stage') }}
              {{ data.character.realmStage }}
            </dd>
            <dt class="text-ink-300">{{ t('dashboard.character.bodyRealm') }}</dt>
            <dd>{{ data.character.bodyRealmKey }} · {{ data.character.bodyStage }}</dd>
            <dt class="text-ink-300">{{ t('dashboard.character.power') }}</dt>
            <dd>{{ data.character.power }}</dd>
            <dt class="text-ink-300">{{ t('dashboard.progression.linhThach') }}</dt>
            <dd>{{ data.progression.linhThach }}</dd>
            <dt class="text-ink-300">{{ t('dashboard.progression.tienNgoc') }}</dt>
            <dd>{{ data.progression.tienNgoc }}</dd>
          </dl>
        </section>

        <!-- Counters -->
        <section
          class="grid grid-cols-2 md:grid-cols-4 gap-3"
          data-testid="dashboard-counters"
        >
          <div class="bg-ink-700/30 border border-ink-300/20 rounded p-3 text-center">
            <div class="text-xs text-ink-300">{{ t('dashboard.counters.unreadMail') }}</div>
            <div class="text-xl font-bold text-amber-200">{{ data.counters.unreadMail }}</div>
          </div>
          <div class="bg-ink-700/30 border border-ink-300/20 rounded p-3 text-center">
            <div class="text-xs text-ink-300">{{ t('dashboard.counters.unreadNotification') }}</div>
            <div class="text-xl font-bold text-amber-200">{{ data.counters.unreadNotification }}</div>
          </div>
          <div class="bg-ink-700/30 border border-ink-300/20 rounded p-3 text-center">
            <div class="text-xs text-ink-300">{{ t('dashboard.counters.activeFeedbackCount') }}</div>
            <div class="text-xl font-bold text-amber-200">{{ data.counters.activeFeedbackCount }}</div>
          </div>
          <div class="bg-ink-700/30 border border-ink-300/20 rounded p-3 text-center">
            <div class="text-xs text-ink-300">{{ t('dashboard.counters.activeReportCount') }}</div>
            <div class="text-xl font-bold text-amber-200">{{ data.counters.activeReportCount }}</div>
          </div>
        </section>

        <!-- Warnings -->
        <section
          v-if="data.warnings.length > 0"
          class="space-y-2"
          data-testid="dashboard-warnings"
        >
          <h2 class="text-amber-200 text-base">{{ t('dashboard.warnings.title') }}</h2>
          <div
            v-for="w in data.warnings"
            :key="w.key + (w.route ?? '')"
            :class="[
              'p-3 rounded border text-sm cursor-pointer',
              w.severity === 'CRITICAL'
                ? 'border-red-500/60 bg-red-900/30 text-red-100'
                : w.severity === 'WARNING'
                  ? 'border-amber-500/60 bg-amber-900/20 text-amber-100'
                  : 'border-ink-300/30 bg-ink-700/30 text-ink-100',
            ]"
            @click="go(w.route)"
          >
            {{ tSafe(w.key) }}
          </div>
        </section>

        <!-- Today checklist -->
        <section data-testid="dashboard-checklist" class="space-y-2">
          <h2 class="text-amber-200 text-base">{{ t('dashboard.checklist.title') }}</h2>
          <ul class="space-y-2">
            <li
              v-for="item in data.todayChecklist"
              :key="item.key"
              :data-testid="`checklist-${item.key}`"
              class="bg-ink-700/30 border border-ink-300/20 rounded p-3 flex items-center justify-between gap-3"
            >
              <div class="space-y-0.5">
                <div class="text-sm">
                  <span
                    :class="[
                      'inline-block w-2 h-2 rounded-full mr-2',
                      item.status === 'DONE'
                        ? 'bg-emerald-400'
                        : item.status === 'UNAVAILABLE'
                          ? 'bg-ink-400'
                          : item.priority === 'HIGH'
                            ? 'bg-red-400'
                            : item.priority === 'MEDIUM'
                              ? 'bg-amber-400'
                              : 'bg-ink-300',
                    ]"
                  />
                  {{ tSafe(item.titleKey) }}
                </div>
                <div class="text-xs text-ink-300">
                  {{ tSafe(item.descriptionKey) }}
                  <span v-if="item.progressText" class="ml-2 text-amber-200">
                    {{ item.progressText }}
                  </span>
                </div>
              </div>
              <button
                v-if="item.route && item.status !== 'UNAVAILABLE'"
                class="text-xs px-3 py-1 rounded border border-ink-300/40 hover:bg-ink-700/60"
                @click="go(item.route)"
              >
                {{ t('common.open') }}
              </button>
            </li>
          </ul>
        </section>

        <!-- Quick links -->
        <section data-testid="dashboard-quicklinks" class="space-y-2">
          <h2 class="text-amber-200 text-base">{{ t('dashboard.quickLinks.title') }}</h2>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
            <button
              v-for="ql in data.quickLinks"
              :key="ql.key"
              :disabled="!ql.enabled"
              class="px-3 py-2 rounded border border-ink-300/30 bg-ink-700/30 hover:bg-ink-700/60 disabled:opacity-50 text-sm relative"
              @click="go(ql.route)"
            >
              {{ tSafe(ql.titleKey) }}
              <span
                v-if="ql.badge"
                class="absolute -top-1 -right-1 bg-amber-500 text-ink-900 text-[10px] px-1 rounded-full"
              >
                {{ ql.badge }}
              </span>
            </button>
          </div>
        </section>
      </template>
    </div>
  </AppShell>
</template>
