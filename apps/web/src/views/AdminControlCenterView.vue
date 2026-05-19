<script setup lang="ts">
/**
 * Phase 27.6 — Admin Control Center V2 view.
 *
 * View riêng tách khỏi `AdminView.vue` (1838 dòng — không phình thêm).
 * Hiển thị 6 tab:
 *   - overview        : `AdminOverviewSnapshot` (totalUsers, mintedToday,
 *     spentToday, active flags/events, suspicious count, ...)
 *   - permissions     : Role-perm matrix (read-only)
 *   - rewardProfiles  : List + filter + validate (PR1 minimal — full
 *     editor PR sau)
 *   - dropProfiles    : List + filter (full editor + simulator PR sau)
 *   - contentStatuses : List + filter (full editor PR sau)
 *   - auditActions    : Catalog action types + risk + requiresConfirmation
 *
 * Mọi state hỗ trợ loading / error / empty. KHÔNG mutation ở PR1 web
 * (form editor sẽ ở PR2 — chỉ read-only + validator demo cho admin
 * preview). Audit ghi server-authoritative.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  ADMIN_ACTION_TYPES,
  ADMIN_PERMISSION_KEYS,
  ADMIN_ROLE_KEYS,
  ADMIN_ROLE_PERMISSIONS,
  CONTENT_STATUS_TYPES,
  DEFAULT_ACTION_RISK,
  DROP_PROFILE_SOURCE_TYPES,
  REWARD_PROFILE_CONTENT_TYPES,
  actionRequiresConfirmation,
  type AdminOverviewSnapshot,
  type AdminPermissionKey,
  type AdminRoleKey,
  type ContentStatusSpec,
  type ContentStatusType,
  type DropProfileSourceType,
  type DropProfileSpec,
  type RewardProfileContentType,
  type RewardProfileSpec,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import {
  adminControlCenterAuditActionTypes,
  adminControlCenterMe,
  adminControlCenterOverview,
  adminControlCenterPermissionMatrix,
  listContentStatuses,
  listDropProfiles,
  listRewardProfiles,
  type AdminControlCenterActionMetaRow,
  type AdminControlCenterMe,
  type AdminControlCenterPermissionMatrix,
} from '@/api/adminControlCenter';
import { extractApiErrorCode } from '@/lib/apiError';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTPullRefresh from '@/components/xianxia/XTPullRefresh.vue';
import MButton from '@/components/ui/MButton.vue';

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();
const router = useRouter();

type Tab =
  | 'overview'
  | 'permissions'
  | 'rewardProfiles'
  | 'dropProfiles'
  | 'contentStatuses'
  | 'auditActions';

const tab = ref<Tab>('overview');
const tabs: readonly Tab[] = [
  'overview',
  'permissions',
  'rewardProfiles',
  'dropProfiles',
  'contentStatuses',
  'auditActions',
];

const overview = ref<AdminOverviewSnapshot | null>(null);
const overviewLoading = ref(false);
const overviewError = ref<string | null>(null);

const me = ref<AdminControlCenterMe | null>(null);
const matrix = ref<AdminControlCenterPermissionMatrix | null>(null);
const meLoading = ref(false);
const matrixLoading = ref(false);
const matrixError = ref<string | null>(null);

const rewardProfiles = ref<RewardProfileSpec[]>([]);
const rewardLoading = ref(false);
const rewardError = ref<string | null>(null);
const rewardContentTypeFilter = ref<RewardProfileContentType | ''>('');
const rewardActiveFilter = ref<'all' | 'true' | 'false'>('all');

const dropProfiles = ref<DropProfileSpec[]>([]);
const dropLoading = ref(false);
const dropError = ref<string | null>(null);
const dropSourceTypeFilter = ref<DropProfileSourceType | ''>('');
const dropTierFilter = ref<number | ''>('');
const dropActiveFilter = ref<'all' | 'true' | 'false'>('all');

const contentStatuses = ref<ContentStatusSpec[]>([]);
const contentLoading = ref(false);
const contentError = ref<string | null>(null);
const contentTypeFilter = ref<ContentStatusType | ''>('');

const auditActions = ref<readonly AdminControlCenterActionMetaRow[]>([]);
const auditLoading = ref(false);
const auditError = ref<string | null>(null);

const isAdmin = computed(
  () => auth.user?.role === 'ADMIN' || auth.user?.role === 'MOD',
);

async function loadOverview() {
  overviewLoading.value = true;
  overviewError.value = null;
  try {
    overview.value = await adminControlCenterOverview();
  } catch (e) {
    overviewError.value = extractApiErrorCode(e) ?? null;
  } finally {
    overviewLoading.value = false;
  }
}

async function loadMeAndMatrix() {
  meLoading.value = true;
  matrixLoading.value = true;
  matrixError.value = null;
  try {
    const [m, mat] = await Promise.all([
      adminControlCenterMe(),
      adminControlCenterPermissionMatrix(),
    ]);
    me.value = m;
    matrix.value = mat;
  } catch (e) {
    matrixError.value = extractApiErrorCode(e) ?? null;
  } finally {
    meLoading.value = false;
    matrixLoading.value = false;
  }
}

async function loadRewardProfiles() {
  rewardLoading.value = true;
  rewardError.value = null;
  try {
    const filters: Parameters<typeof listRewardProfiles>[0] = {};
    if (rewardContentTypeFilter.value)
      filters.contentType = rewardContentTypeFilter.value;
    if (rewardActiveFilter.value === 'true') filters.active = true;
    else if (rewardActiveFilter.value === 'false') filters.active = false;
    rewardProfiles.value = await listRewardProfiles(filters);
  } catch (e) {
    rewardError.value = extractApiErrorCode(e) ?? null;
  } finally {
    rewardLoading.value = false;
  }
}

async function loadDropProfiles() {
  dropLoading.value = true;
  dropError.value = null;
  try {
    const filters: Parameters<typeof listDropProfiles>[0] = {};
    if (dropSourceTypeFilter.value) filters.sourceType = dropSourceTypeFilter.value;
    if (typeof dropTierFilter.value === 'number')
      filters.sourceTier = dropTierFilter.value;
    if (dropActiveFilter.value === 'true') filters.active = true;
    else if (dropActiveFilter.value === 'false') filters.active = false;
    dropProfiles.value = await listDropProfiles(filters);
  } catch (e) {
    dropError.value = extractApiErrorCode(e) ?? null;
  } finally {
    dropLoading.value = false;
  }
}

async function loadContentStatuses() {
  contentLoading.value = true;
  contentError.value = null;
  try {
    const filters: Parameters<typeof listContentStatuses>[0] = {};
    if (contentTypeFilter.value) filters.contentType = contentTypeFilter.value;
    contentStatuses.value = await listContentStatuses(filters);
  } catch (e) {
    contentError.value = extractApiErrorCode(e) ?? null;
  } finally {
    contentLoading.value = false;
  }
}

async function loadAuditActions() {
  auditLoading.value = true;
  auditError.value = null;
  try {
    const res = await adminControlCenterAuditActionTypes();
    auditActions.value = res.actions;
  } catch (e) {
    auditError.value = extractApiErrorCode(e) ?? null;
  } finally {
    auditLoading.value = false;
  }
}

function rolePermsHas(role: AdminRoleKey, perm: AdminPermissionKey): boolean {
  return ADMIN_ROLE_PERMISSIONS[role].includes(perm);
}

function selectTab(next: Tab) {
  tab.value = next;
  if (next === 'overview' && !overview.value) void loadOverview();
  if (next === 'permissions' && !matrix.value) void loadMeAndMatrix();
  if (next === 'rewardProfiles') void loadRewardProfiles();
  if (next === 'dropProfiles') void loadDropProfiles();
  if (next === 'contentStatuses') void loadContentStatuses();
  if (next === 'auditActions' && auditActions.value.length === 0)
    void loadAuditActions();
}

onMounted(async () => {
  // QA-004 — hydrate auth store trước khi check role để tránh race condition
  // khi user reload trực tiếp `/admin/control-center`. Trên direct page load,
  // pinia store chưa có `user` cho tới khi `/auth/session` resolve; nếu kiểm
  // tra `isAdmin.value` ngay lập tức, admin hợp lệ vẫn bị reject. Pattern này
  // khớp với `AdminEventBuilderView.vue` / `AdminView.vue`.
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    void router.push({ name: 'auth' });
    return;
  }
  if (!isAdmin.value) {
    toast.push({ text: t('adminControlCenter.notAdminError'), type: 'error' });
    void router.push({ name: 'home' });
    return;
  }
  void loadOverview();
  void loadMeAndMatrix();
});

const rewardContentTypes = REWARD_PROFILE_CONTENT_TYPES;
const dropSourceTypes = DROP_PROFILE_SOURCE_TYPES;
const contentTypes = CONTENT_STATUS_TYPES;

async function refreshCurrentTab() {
  if (tab.value === 'overview') await loadOverview();
  else if (tab.value === 'permissions') await loadMeAndMatrix();
  else if (tab.value === 'rewardProfiles') await loadRewardProfiles();
  else if (tab.value === 'dropProfiles') await loadDropProfiles();
  else if (tab.value === 'contentStatuses') await loadContentStatuses();
  else if (tab.value === 'auditActions') await loadAuditActions();
}

function overviewStatColor(key: string, value: unknown): string {
  if (key === 'suspiciousEventsCount' && typeof value === 'number' && value > 0) return 'text-rose-300';
  if (key === 'pendingTopupsCount' && typeof value === 'number' && value > 0) return 'text-amber-300';
  if (key === 'maintenanceStatus') {
    if (value === 'ACTIVE') return 'text-rose-300';
    if (value === 'SCHEDULED') return 'text-amber-300';
    return 'text-emerald-300';
  }
  return 'text-amber-200';
}
</script>

<template>
  <AppShell>
    <div class="space-y-4 p-4">
      <XTLuxHero
        :eyebrow="t('adminControlCenter.title')"
        :label="t('adminControlCenter.title')"
        :title="t('adminControlCenter.title')"
        :subtitle="me ? t('adminControlCenter.roleLabel', { role: me.role }) : undefined"
        tone="seal"
        watermark-letter="A"
        :breadcrumb="t('adminControlCenter.breadcrumb')"
        test-id="admin-cc-hero"
      >
        <XTPageEyebrow
          caps="CHỦ KHIỂN THIÊN ĐIỆN"
          label="Chủ Khiển Thiên Điện"
          class="sr-only"
        />
      </XTLuxHero>

      <!-- Role hint -->
      <p class="text-sm text-gray-400 px-1" data-testid="admin-cc-role-hint">
        {{ t('adminControlCenter.roleHint') }}
      </p>

      <!-- Cross-navigation -->
      <nav class="flex gap-2 text-xs flex-wrap" data-testid="admin-cc-cross-nav">
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-admin"
          @click="router.push('/admin')"
        >
          <span class="text-amber-400">&#9878;</span>
          <span>{{ t('adminControlCenter.crossNav.admin') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('adminControlCenter.crossNav.adminDesc') }}</span>
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-event-builder"
          @click="router.push('/admin/event-builder')"
        >
          <span class="text-emerald-400">&#9733;</span>
          <span>{{ t('adminControlCenter.crossNav.eventBuilder') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('adminControlCenter.crossNav.eventBuilderDesc') }}</span>
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-system-status"
          @click="router.push('/admin/system-status')"
        >
          <span class="text-blue-400">&#9881;</span>
          <span>{{ t('adminControlCenter.crossNav.systemStatus') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('adminControlCenter.crossNav.systemStatusDesc') }}</span>
        </button>
      </nav>

      <XTPullRefresh
        :on-refresh="refreshCurrentTab"
        test-id="admin-cc-pull-refresh"
        :pull-label="t('common.pullToRefresh')"
        :release-label="t('common.releaseToRefresh')"
        :refreshing-label="t('common.refreshing')"
      >

        <nav class="flex gap-1 border-b border-ink-300/30 text-sm overflow-x-auto">
          <button
            v-for="tk in tabs"
            :key="tk"
            class="px-3 py-2 whitespace-nowrap"
            :class="
              tab === tk
                ? 'border-b-2 border-amber-300 text-ink-50'
                : 'text-ink-300'
            "
            :data-testid="`tab-${tk}`"
            @click="selectTab(tk)"
          >
            {{ t(`adminControlCenter.tab.${tk}`) }}
          </button>
        </nav>

        <!-- OVERVIEW -->
        <section v-if="tab === 'overview'" class="space-y-3">
          <div class="flex justify-between items-center">
            <h2 class="text-lg font-semibold">
              {{ t('adminControlCenter.overview.title') }}
            </h2>
            <MButton
              size="sm"
              :disabled="overviewLoading"
              @click="loadOverview"
            >
              {{ t('common.refresh') }}
            </MButton>
          </div>

          <div v-if="overviewLoading" class="text-ink-300">
            {{ t('common.loading') }}
          </div>
          <div v-else-if="overviewError" class="text-rose-300">
            {{ t('adminControlCenter.errorLoad', { code: overviewError }) }}
          </div>
          <div
            v-else-if="overview"
            class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
            data-testid="overview-grid"
          >
            <div
              v-for="kv in [
                ['totalUsers', overview.totalUsers],
                ['activeUsersToday', overview.activeUsersToday],
                ['activeCharacters', overview.activeCharacters],
                ['newUsersToday', overview.newUsersToday],
                ['mintedToday', overview.currencyMintedTodayLinhThach],
                ['spentToday', overview.currencySpentTodayLinhThach],
                ['rareDropsToday', overview.rareDropsToday],
                ['farmSessionsToday', overview.farmSessionsToday],
                ['dungeonRunsToday', overview.dungeonRunsToday],
                ['bossKillsToday', overview.bossKillsToday],
                ['towerAttemptsToday', overview.towerAttemptsToday],
                ['monthlyCardActiveCount', overview.monthlyCardActiveCount],
                ['suspiciousEventsCount', overview.suspiciousEventsCount],
                ['pendingTopupsCount', overview.pendingTopupsCount],
                ['activeFeatureFlags', overview.activeFeatureFlags],
                ['activeEvents', overview.activeEvents],
              ] as const"
              :key="kv[0]"
              class="bg-ink-800/40 border border-ink-300/20 rounded p-3"
              :data-testid="`overview-stat-${kv[0]}`"
            >
              <div class="text-xs text-ink-300">
                {{ t(`adminControlCenter.overview.stat.${kv[0]}`) }}
              </div>
              <div class="text-xl font-bold" :class="overviewStatColor(kv[0], kv[1])">{{ kv[1] }}</div>
            </div>
            <div class="bg-ink-800/40 border border-ink-300/20 rounded p-3 col-span-2">
              <div class="text-xs text-ink-300">
                {{ t('adminControlCenter.overview.stat.maintenanceStatus') }}
              </div>
              <div
                class="text-xl font-bold"
                :class="
                  overview.maintenanceStatus === 'ACTIVE'
                    ? 'text-rose-300'
                    : overview.maintenanceStatus === 'SCHEDULED'
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                "
              >
                {{ overview.maintenanceStatus }}
              </div>
            </div>
            <div class="bg-ink-800/40 border border-ink-300/20 rounded p-3 col-span-2">
              <div class="text-xs text-ink-300">
                {{ t('adminControlCenter.overview.stat.battlePassActiveSeason') }}
              </div>
              <div class="text-xl font-bold text-amber-200">
                {{ overview.battlePassActiveSeason ?? '—' }}
              </div>
            </div>
            <div class="col-span-full text-xs text-ink-300">
              {{
                t('adminControlCenter.overview.generatedAt', {
                  ts: overview.generatedAt,
                })
              }}
            </div>
          </div>
        </section>

        <!-- PERMISSIONS -->
        <section v-if="tab === 'permissions'" class="space-y-3">
          <div class="flex justify-between items-center">
            <h2 class="text-lg font-semibold">
              {{ t('adminControlCenter.permissions.title') }}
            </h2>
            <MButton
              size="sm"
              :disabled="matrixLoading"
              @click="loadMeAndMatrix"
            >
              {{ t('common.refresh') }}
            </MButton>
          </div>

          <div v-if="me" class="bg-ink-800/40 border border-ink-300/20 rounded p-3">
            <div class="text-sm text-ink-300">
              {{ t('adminControlCenter.permissions.yourRole') }}
            </div>
            <div class="text-base font-bold text-amber-200">{{ me.role }}</div>
            <div class="text-xs text-ink-300 mt-1">
              {{
                t('adminControlCenter.permissions.permissionCount', {
                  n: me.permissions.length,
                })
              }}
            </div>
          </div>

          <div v-if="matrixLoading" class="text-ink-300">
            {{ t('common.loading') }}
          </div>
          <div v-else-if="matrixError" class="text-rose-300">
            {{ t('adminControlCenter.errorLoad', { code: matrixError }) }}
          </div>
          <div v-else-if="matrix" class="overflow-x-auto" data-testid="permission-matrix">
            <table class="text-xs w-full">
              <thead>
                <tr class="border-b border-ink-300/30">
                  <th class="text-left p-2">
                    {{ t('adminControlCenter.permissions.colPermission') }}
                  </th>
                  <th
                    v-for="role in ADMIN_ROLE_KEYS"
                    :key="role"
                    class="p-2 text-center"
                  >
                    {{ role }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="perm in ADMIN_PERMISSION_KEYS"
                  :key="perm"
                  class="border-b border-ink-300/10"
                >
                  <td class="p-2 text-ink-200">{{ perm }}</td>
                  <td
                    v-for="role in ADMIN_ROLE_KEYS"
                    :key="role"
                    class="p-2 text-center"
                    :class="
                      rolePermsHas(role, perm)
                        ? 'text-emerald-300'
                        : 'text-ink-500'
                    "
                  >
                    {{ rolePermsHas(role, perm) ? '✓' : '·' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- REWARD PROFILES -->
        <section v-if="tab === 'rewardProfiles'" class="space-y-3">
          <div class="flex justify-between items-center">
            <h2 class="text-lg font-semibold">
              {{ t('adminControlCenter.rewardProfiles.title') }}
            </h2>
            <MButton
              size="sm"
              :disabled="rewardLoading"
              @click="loadRewardProfiles"
            >
              {{ t('common.refresh') }}
            </MButton>
          </div>

          <div class="flex gap-2 items-center text-xs">
            <label>
              {{ t('adminControlCenter.rewardProfiles.filterContentType') }}
              <select
                v-model="rewardContentTypeFilter"
                class="bg-ink-800 border border-ink-300/30 rounded px-2 py-1 ml-1"
                @change="loadRewardProfiles"
              >
                <option value="">{{ t('common.all') }}</option>
                <option v-for="ct in rewardContentTypes" :key="ct" :value="ct">
                  {{ ct }}
                </option>
              </select>
            </label>
            <label>
              {{ t('adminControlCenter.rewardProfiles.filterActive') }}
              <select
                v-model="rewardActiveFilter"
                class="bg-ink-800 border border-ink-300/30 rounded px-2 py-1 ml-1"
                @change="loadRewardProfiles"
              >
                <option value="all">{{ t('common.all') }}</option>
                <option value="true">{{ t('common.yes') }}</option>
                <option value="false">{{ t('common.no') }}</option>
              </select>
            </label>
          </div>

          <div v-if="rewardLoading" class="text-ink-300">
            {{ t('common.loading') }}
          </div>
          <div v-else-if="rewardError" class="text-rose-300">
            {{ t('adminControlCenter.errorLoad', { code: rewardError }) }}
          </div>
          <div v-else-if="rewardProfiles.length === 0" class="text-ink-300">
            {{ t('adminControlCenter.rewardProfiles.empty') }}
          </div>
          <div v-else class="overflow-x-auto" data-testid="reward-table">
            <table class="text-xs w-full">
              <thead>
                <tr class="border-b border-ink-300/30">
                  <th class="text-left p-2">{{ t('adminControlCenter.rewardProfiles.colKey') }}</th>
                  <th class="text-left p-2">{{ t('adminControlCenter.rewardProfiles.colName') }}</th>
                  <th class="text-left p-2">{{ t('adminControlCenter.rewardProfiles.colContent') }}</th>
                  <th class="text-center p-2">{{ t('adminControlCenter.rewardProfiles.colTier') }}</th>
                  <th class="text-center p-2">{{ t('adminControlCenter.rewardProfiles.colRewards') }}</th>
                  <th class="text-center p-2">{{ t('adminControlCenter.rewardProfiles.colVersion') }}</th>
                  <th class="text-center p-2">{{ t('adminControlCenter.rewardProfiles.colActive') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in rewardProfiles"
                  :key="p.key"
                  class="border-b border-ink-300/10"
                >
                  <td class="p-2 font-mono text-ink-100">{{ p.key }}</td>
                  <td class="p-2">{{ p.name }}</td>
                  <td class="p-2 text-ink-300">
                    {{ p.contentType }}{{ p.contentKey ? `:${p.contentKey}` : '' }}
                  </td>
                  <td class="p-2 text-center">T{{ p.sourceTier }}</td>
                  <td class="p-2 text-center">{{ p.rewards.length }}</td>
                  <td class="p-2 text-center">v{{ p.version }}</td>
                  <td class="p-2 text-center">
                    <span
                      :class="p.active ? 'text-emerald-300' : 'text-ink-500'"
                    >
                      {{ p.active ? '✓' : '·' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- DROP PROFILES -->
        <section v-if="tab === 'dropProfiles'" class="space-y-3">
          <div class="flex justify-between items-center">
            <h2 class="text-lg font-semibold">
              {{ t('adminControlCenter.dropProfiles.title') }}
            </h2>
            <MButton
              size="sm"
              :disabled="dropLoading"
              @click="loadDropProfiles"
            >
              {{ t('common.refresh') }}
            </MButton>
          </div>

          <div class="flex gap-2 items-center text-xs flex-wrap">
            <label>
              {{ t('adminControlCenter.dropProfiles.filterSourceType') }}
              <select
                v-model="dropSourceTypeFilter"
                class="bg-ink-800 border border-ink-300/30 rounded px-2 py-1 ml-1"
                @change="loadDropProfiles"
              >
                <option value="">{{ t('common.all') }}</option>
                <option v-for="st in dropSourceTypes" :key="st" :value="st">
                  {{ st }}
                </option>
              </select>
            </label>
            <label>
              {{ t('adminControlCenter.dropProfiles.filterTier') }}
              <select
                v-model.number="dropTierFilter"
                class="bg-ink-800 border border-ink-300/30 rounded px-2 py-1 ml-1"
                @change="loadDropProfiles"
              >
                <option value="">{{ t('common.all') }}</option>
                <option v-for="n in [1, 2, 3, 4, 5, 6, 7, 8, 9]" :key="n" :value="n">
                  T{{ n }}
                </option>
              </select>
            </label>
            <label>
              {{ t('adminControlCenter.dropProfiles.filterActive') }}
              <select
                v-model="dropActiveFilter"
                class="bg-ink-800 border border-ink-300/30 rounded px-2 py-1 ml-1"
                @change="loadDropProfiles"
              >
                <option value="all">{{ t('common.all') }}</option>
                <option value="true">{{ t('common.yes') }}</option>
                <option value="false">{{ t('common.no') }}</option>
              </select>
            </label>
          </div>

          <div v-if="dropLoading" class="text-ink-300">
            {{ t('common.loading') }}
          </div>
          <div v-else-if="dropError" class="text-rose-300">
            {{ t('adminControlCenter.errorLoad', { code: dropError }) }}
          </div>
          <div v-else-if="dropProfiles.length === 0" class="text-ink-300">
            {{ t('adminControlCenter.dropProfiles.empty') }}
          </div>
          <div v-else class="overflow-x-auto" data-testid="drop-table">
            <table class="text-xs w-full">
              <thead>
                <tr class="border-b border-ink-300/30">
                  <th class="text-left p-2">{{ t('adminControlCenter.dropProfiles.colKey') }}</th>
                  <th class="text-left p-2">{{ t('adminControlCenter.dropProfiles.colName') }}</th>
                  <th class="text-left p-2">{{ t('adminControlCenter.dropProfiles.colSource') }}</th>
                  <th class="text-center p-2">{{ t('adminControlCenter.dropProfiles.colBase') }}</th>
                  <th class="text-center p-2">{{ t('adminControlCenter.dropProfiles.colRare') }}</th>
                  <th class="text-center p-2">{{ t('adminControlCenter.dropProfiles.colItems') }}</th>
                  <th class="text-center p-2">{{ t('adminControlCenter.dropProfiles.colActive') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in dropProfiles"
                  :key="p.key"
                  class="border-b border-ink-300/10"
                >
                  <td class="p-2 font-mono text-ink-100">{{ p.key }}</td>
                  <td class="p-2">{{ p.name }}</td>
                  <td class="p-2 text-ink-300">
                    {{ p.sourceType }} T{{ p.sourceTier }}
                  </td>
                  <td class="p-2 text-center">{{ (p.baseRate * 100).toFixed(1) }}%</td>
                  <td class="p-2 text-center">{{ (p.rareRate * 100).toFixed(1) }}%</td>
                  <td class="p-2 text-center">{{ p.items.length }}</td>
                  <td class="p-2 text-center">
                    <span :class="p.active ? 'text-emerald-300' : 'text-ink-500'">
                      {{ p.active ? '✓' : '·' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- CONTENT STATUSES -->
        <section v-if="tab === 'contentStatuses'" class="space-y-3">
          <div class="flex justify-between items-center">
            <h2 class="text-lg font-semibold">
              {{ t('adminControlCenter.contentStatuses.title') }}
            </h2>
            <MButton
              size="sm"
              :disabled="contentLoading"
              @click="loadContentStatuses"
            >
              {{ t('common.refresh') }}
            </MButton>
          </div>

          <label class="text-xs">
            {{ t('adminControlCenter.contentStatuses.filterContentType') }}
            <select
              v-model="contentTypeFilter"
              class="bg-ink-800 border border-ink-300/30 rounded px-2 py-1 ml-1"
              @change="loadContentStatuses"
            >
              <option value="">{{ t('common.all') }}</option>
              <option v-for="ct in contentTypes" :key="ct" :value="ct">
                {{ ct }}
              </option>
            </select>
          </label>

          <div v-if="contentLoading" class="text-ink-300">
            {{ t('common.loading') }}
          </div>
          <div v-else-if="contentError" class="text-rose-300">
            {{ t('adminControlCenter.errorLoad', { code: contentError }) }}
          </div>
          <div v-else-if="contentStatuses.length === 0" class="text-ink-300">
            {{ t('adminControlCenter.contentStatuses.empty') }}
          </div>
          <div v-else class="overflow-x-auto" data-testid="content-table">
            <table class="text-xs w-full">
              <thead>
                <tr class="border-b border-ink-300/30">
                  <th class="text-left p-2">{{ t('adminControlCenter.contentStatuses.colContent') }}</th>
                  <th class="text-center p-2">{{ t('adminControlCenter.contentStatuses.colEnabled') }}</th>
                  <th class="text-center p-2">{{ t('adminControlCenter.contentStatuses.colPaused') }}</th>
                  <th class="text-center p-2">{{ t('adminControlCenter.contentStatuses.colDisableReward') }}</th>
                  <th class="text-center p-2">{{ t('adminControlCenter.contentStatuses.colDisableClaim') }}</th>
                  <th class="text-left p-2">{{ t('adminControlCenter.contentStatuses.colMessage') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(s, idx) in contentStatuses"
                  :key="`${s.contentType}:${s.contentKey}:${idx}`"
                  class="border-b border-ink-300/10"
                >
                  <td class="p-2 font-mono">
                    {{ s.contentType }}:{{ s.contentKey }}
                  </td>
                  <td class="p-2 text-center">
                    <span :class="s.enabled ? 'text-emerald-300' : 'text-rose-300'">
                      {{ s.enabled ? '✓' : '·' }}
                    </span>
                  </td>
                  <td class="p-2 text-center">
                    <span :class="s.paused ? 'text-amber-300' : 'text-ink-500'">
                      {{ s.paused ? '⏸' : '·' }}
                    </span>
                  </td>
                  <td class="p-2 text-center">
                    <span :class="s.disableReward ? 'text-amber-300' : 'text-ink-500'">
                      {{ s.disableReward ? '⊘' : '·' }}
                    </span>
                  </td>
                  <td class="p-2 text-center">
                    <span :class="s.disableClaim ? 'text-amber-300' : 'text-ink-500'">
                      {{ s.disableClaim ? '⊘' : '·' }}
                    </span>
                  </td>
                  <td class="p-2 text-ink-300">{{ s.message ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- AUDIT ACTIONS -->
        <section v-if="tab === 'auditActions'" class="space-y-3">
          <div class="flex justify-between items-center">
            <h2 class="text-lg font-semibold">
              {{ t('adminControlCenter.auditActions.title') }}
            </h2>
            <MButton
              size="sm"
              :disabled="auditLoading"
              @click="loadAuditActions"
            >
              {{ t('common.refresh') }}
            </MButton>
          </div>

          <div v-if="auditLoading" class="text-ink-300">
            {{ t('common.loading') }}
          </div>
          <div v-else-if="auditError" class="text-rose-300">
            {{ t('adminControlCenter.errorLoad', { code: auditError }) }}
          </div>
          <div v-else class="overflow-x-auto" data-testid="audit-table">
            <table class="text-xs w-full">
              <thead>
                <tr class="border-b border-ink-300/30">
                  <th class="text-left p-2">{{ t('adminControlCenter.auditActions.colAction') }}</th>
                  <th class="text-center p-2">{{ t('adminControlCenter.auditActions.colRisk') }}</th>
                  <th class="text-center p-2">{{ t('adminControlCenter.auditActions.colConfirm') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in (auditActions.length > 0 ? auditActions : ADMIN_ACTION_TYPES.map((a) => ({ action: a, defaultRisk: DEFAULT_ACTION_RISK[a], requiresConfirmation: actionRequiresConfirmation(DEFAULT_ACTION_RISK[a]) })))"
                  :key="row.action"
                  class="border-b border-ink-300/10"
                >
                  <td class="p-2 font-mono text-ink-100">{{ row.action }}</td>
                  <td class="p-2 text-center">
                    <span
                      :class="{
                        'text-emerald-300': row.defaultRisk === 'LOW',
                        'text-amber-300': row.defaultRisk === 'MEDIUM',
                        'text-orange-300': row.defaultRisk === 'HIGH',
                        'text-rose-300': row.defaultRisk === 'CRITICAL',
                      }"
                    >
                      {{ row.defaultRisk }}
                    </span>
                  </td>
                  <td class="p-2 text-center">
                    {{ row.requiresConfirmation ? '✓' : '·' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </XTPullRefresh>
    </div>
  </AppShell>
</template>
