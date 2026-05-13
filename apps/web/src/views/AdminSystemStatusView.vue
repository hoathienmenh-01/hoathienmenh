<script setup lang="ts">
/**
 * Phase 43 — Admin System Status (read-only ops dashboard).
 *
 * Hiển thị:
 *   - Status badge tổng (ok/degraded/down).
 *   - Service info: serviceName, environment, version, buildCommit,
 *     node version, uptime.
 *   - Dependency check: api/db/redis status + latency.
 *   - Recent errors count 24h + breakdown severity.
 *   - Admin activity 24h.
 *   - Integrity last-run summary (artefact ghi bởi
 *     `scripts/integrity-check.mjs`).
 *
 * Permission: ADMIN hoặc MOD (server-side enforce qua `AdminGuard`).
 * UI hiển thị forbidden state cho PLAYER.
 *
 * KHÔNG có write action — không gọi endpoint mutate.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppShell from '@/components/shell/AppShell.vue';
import LoadingState from '@/components/ui/LoadingState.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import { useAuthStore } from '@/stores/auth';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import {
  fetchSystemStatus,
  listSystemErrors,
  type SystemErrorRow,
  type SystemHealthStatus,
  type SystemStatusSnapshot,
} from '@/api/systemStatus';

const { t } = useI18n();
const auth = useAuthStore();

const loading = ref(true);
const errorKey = ref<string | null>(null);
const snapshot = ref<SystemStatusSnapshot | null>(null);
const recentErrors = ref<SystemErrorRow[]>([]);

const isAdmin = computed(
  () => auth.user?.role === 'MOD' || auth.user?.role === 'ADMIN',
);

async function load(): Promise<void> {
  loading.value = true;
  errorKey.value = null;
  try {
    const [snap, errors] = await Promise.all([
      fetchSystemStatus(),
      listSystemErrors({ limit: 20 }).catch(() => ({ rows: [], total: 0 })),
    ]);
    snapshot.value = snap;
    recentErrors.value = errors.rows;
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    errorKey.value = `adminSystemStatus.errors.${code}`;
  } finally {
    loading.value = false;
  }
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function statusClass(status: SystemHealthStatus): string {
  switch (status) {
    case 'ok':
      return 'bg-emerald-700/40 text-emerald-200 border-emerald-500/40';
    case 'degraded':
      return 'bg-amber-700/40 text-amber-200 border-amber-500/40';
    case 'down':
      return 'bg-rose-700/40 text-rose-200 border-rose-500/40';
    default:
      return 'bg-ink-700/40 text-ink-200 border-ink-300/30';
  }
}

onMounted(() => {
  if (isAdmin.value) void load();
  else loading.value = false;
});
</script>

<template>
  <AppShell>
    <div class="max-w-5xl mx-auto space-y-4">
      <header>
        <h1 class="text-2xl tracking-widest font-bold">
          {{ t('adminSystemStatus.title') }}
        </h1>
        <p class="text-xs text-ink-300 mt-1">
          {{ t('adminSystemStatus.subtitle') }}
        </p>
      </header>

      <EmptyState
        v-if="!isAdmin"
        title-key="adminSystemStatus.notAdminTitle"
        description-key="adminSystemStatus.notAdminDescription"
        data-testid="admin-system-status-forbidden"
      />

      <template v-else>
        <LoadingState v-if="loading" data-testid="admin-system-status-loading" />

        <ErrorState
          v-else-if="errorKey"
          :error-key="errorKey"
          test-id="admin-system-status-error"
          @retry="load()"
        />

        <EmptyState
          v-else-if="!snapshot"
          title-key="adminSystemStatus.emptyTitle"
          description-key="adminSystemStatus.emptyDescription"
          data-testid="admin-system-status-empty"
        />

        <template v-else>
          <section
            class="border border-ink-300/30 rounded p-4 space-y-3"
            data-testid="admin-system-status-overview"
          >
            <div class="flex flex-wrap items-center gap-3">
              <span
                class="px-3 py-1 rounded border text-xs uppercase tracking-widest"
                :class="statusClass(snapshot.status)"
                data-testid="admin-system-status-badge"
              >
                {{ t(`adminSystemStatus.status.${snapshot.status}`) }}
              </span>
              <span class="text-xs text-ink-300">
                {{ t('adminSystemStatus.serviceName') }}:
                <span class="text-ink-100 font-mono">{{ snapshot.serviceName }}</span>
              </span>
              <span class="text-xs text-ink-300">
                {{ t('adminSystemStatus.environment') }}:
                <span class="text-ink-100 font-mono">{{ snapshot.environment }}</span>
              </span>
            </div>

            <dl class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs">
              <div>
                <dt class="text-ink-300">{{ t('adminSystemStatus.version') }}</dt>
                <dd class="font-mono">{{ snapshot.version }}</dd>
              </div>
              <div>
                <dt class="text-ink-300">{{ t('adminSystemStatus.buildCommit') }}</dt>
                <dd class="font-mono">{{ snapshot.buildCommit }}</dd>
              </div>
              <div>
                <dt class="text-ink-300">{{ t('adminSystemStatus.nodeVersion') }}</dt>
                <dd class="font-mono">{{ snapshot.node }}</dd>
              </div>
              <div>
                <dt class="text-ink-300">{{ t('adminSystemStatus.uptime') }}</dt>
                <dd class="font-mono">{{ formatUptime(snapshot.uptimeSeconds) }}</dd>
              </div>
              <div>
                <dt class="text-ink-300">{{ t('adminSystemStatus.timestamp') }}</dt>
                <dd class="font-mono">{{ snapshot.timestamp }}</dd>
              </div>
            </dl>
          </section>

          <section
            class="border border-ink-300/30 rounded p-4 space-y-2"
            data-testid="admin-system-status-checks"
          >
            <h2 class="text-sm uppercase tracking-widest text-ink-300">
              {{ t('adminSystemStatus.dependencyChecks') }}
            </h2>
            <ul class="text-xs space-y-1">
              <li
                v-for="(check, key) in {
                  api: snapshot.checks.api,
                  db: snapshot.checks.db,
                  redis: snapshot.checks.redis,
                }"
                :key="key"
                class="flex items-center gap-3"
                :data-testid="`admin-system-check-${key}`"
              >
                <span
                  class="px-2 py-0.5 rounded border text-[10px] uppercase"
                  :class="statusClass(check.status)"
                >
                  {{ t(`adminSystemStatus.status.${check.status}`) }}
                </span>
                <span class="font-mono">{{ key }}</span>
                <span v-if="'latencyMs' in check && typeof check.latencyMs === 'number'" class="text-ink-300">
                  {{ check.latencyMs }}ms
                </span>
                <span
                  v-if="'error' in check && check.error"
                  class="text-rose-300 truncate max-w-md"
                >
                  {{ check.error }}
                </span>
              </li>
            </ul>
          </section>

          <section
            class="border border-ink-300/30 rounded p-4 space-y-2"
            data-testid="admin-system-status-counters"
          >
            <h2 class="text-sm uppercase tracking-widest text-ink-300">
              {{ t('adminSystemStatus.activity24h') }}
            </h2>
            <dl class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div>
                <dt class="text-ink-300">{{ t('adminSystemStatus.recentErrorsTotal') }}</dt>
                <dd class="text-lg font-mono">{{ snapshot.recentErrors.last24h }}</dd>
              </div>
              <div>
                <dt class="text-ink-300">FATAL</dt>
                <dd class="font-mono">{{ snapshot.recentErrors.bySeverity.FATAL }}</dd>
              </div>
              <div>
                <dt class="text-ink-300">ERROR</dt>
                <dd class="font-mono">{{ snapshot.recentErrors.bySeverity.ERROR }}</dd>
              </div>
              <div>
                <dt class="text-ink-300">WARN</dt>
                <dd class="font-mono">{{ snapshot.recentErrors.bySeverity.WARN }}</dd>
              </div>
              <div>
                <dt class="text-ink-300">{{ t('adminSystemStatus.adminActions') }}</dt>
                <dd class="font-mono">{{ snapshot.adminActivity.last24h }}</dd>
              </div>
            </dl>
          </section>

          <section
            class="border border-ink-300/30 rounded p-4 space-y-2"
            data-testid="admin-system-status-integrity"
          >
            <h2 class="text-sm uppercase tracking-widest text-ink-300">
              {{ t('adminSystemStatus.integrityTitle') }}
            </h2>
            <p v-if="!snapshot.integrity" class="text-xs text-ink-300">
              {{ t('adminSystemStatus.integrityNeverRun') }}
            </p>
            <template v-else>
              <div class="text-xs text-ink-300">
                {{ t('adminSystemStatus.integrityRunAt') }}: {{ snapshot.integrity.runAt }}
                · {{ t('adminSystemStatus.integrityScopes') }}: {{ snapshot.integrity.scopes.join(', ') || '—' }}
                · {{ t('adminSystemStatus.integrityIssueCount') }}: {{ snapshot.integrity.issueCount }}
              </div>
              <span
                class="inline-block px-2 py-0.5 rounded border text-[10px] uppercase"
                :class="
                  snapshot.integrity.status === 'CLEAN'
                    ? statusClass('ok')
                    : statusClass('degraded')
                "
              >
                {{ t(`adminSystemStatus.integrityStatus.${snapshot.integrity.status}`) }}
              </span>
              <ul v-if="snapshot.integrity.issues.length" class="text-xs space-y-1 mt-2">
                <li
                  v-for="(issue, idx) in snapshot.integrity.issues"
                  :key="idx"
                  class="border border-ink-300/20 rounded px-2 py-1"
                >
                  <span class="font-mono mr-2">[{{ issue.severity }}]</span>
                  <span class="font-mono mr-2">{{ issue.scope }}</span>
                  {{ issue.message }}
                </li>
              </ul>
            </template>
          </section>

          <section
            class="border border-ink-300/30 rounded p-4 space-y-2"
            data-testid="admin-system-status-recent-errors"
          >
            <h2 class="text-sm uppercase tracking-widest text-ink-300">
              {{ t('adminSystemStatus.recentErrorsTitle') }}
            </h2>
            <p v-if="recentErrors.length === 0" class="text-xs text-ink-300">
              {{ t('adminSystemStatus.recentErrorsEmpty') }}
            </p>
            <ul v-else class="text-xs space-y-1">
              <li
                v-for="row in recentErrors"
                :key="row.id"
                class="border border-ink-300/20 rounded px-2 py-1 grid grid-cols-12 gap-2 items-center"
              >
                <span class="font-mono col-span-3 text-ink-300">{{ row.createdAt }}</span>
                <span class="font-mono col-span-2">{{ row.severity }}</span>
                <span class="font-mono col-span-3">{{ row.type }}</span>
                <span class="font-mono col-span-2 text-ink-300 truncate">{{ row.policy ?? '—' }}</span>
                <span class="font-mono col-span-2 truncate" :title="row.id">{{ row.id }}</span>
              </li>
            </ul>
          </section>
        </template>
      </template>
    </div>
  </AppShell>
</template>
