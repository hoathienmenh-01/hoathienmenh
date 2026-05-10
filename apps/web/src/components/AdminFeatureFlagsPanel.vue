<script setup lang="ts">
/**
 * Phase 15.4 — Admin Feature Flag panel.
 *
 * Liệt kê toàn bộ flag từ catalog (kể cả flag chưa có DB row, hiển thị
 * default value). Cho phép admin:
 *   - Toggle enabled (PATCH /admin/feature-flags/:key).
 *   - Refresh defaults (POST /admin/feature-flags/refresh-defaults).
 *   - Clear cache (POST /admin/feature-flags/clear-cache).
 *
 * Tắt flag "lớn" (Arena, Market, LiveOps Events) phải qua confirm modal
 * vì ảnh hưởng nhiều người chơi. I18n VI/EN parity qua
 * `adminFeatureFlags.*`.
 *
 * Server vẫn audit log (`ADMIN_FEATURE_FLAG_*`) — UI chỉ trigger.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  FEATURE_FLAG_CATEGORIES,
  type FeatureFlagAdminView,
  type FeatureFlagCategory,
  type FeatureFlagKey,
} from '@xuantoi/shared';
import { useToastStore } from '@/stores/toast';
import {
  adminClearFeatureFlagCache,
  adminListFeatureFlags,
  adminRefreshFeatureFlagDefaults,
  adminUpdateFeatureFlag,
} from '@/api/featureFlag';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import MButton from '@/components/ui/MButton.vue';
import ConfirmModal from '@/components/ui/ConfirmModal.vue';

const { t } = useI18n();
const toast = useToastStore();

const flags = ref<FeatureFlagAdminView[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const togglingKey = ref<FeatureFlagKey | null>(null);
const refreshingDefaults = ref(false);
const clearingCache = ref(false);
const search = ref('');
const categoryFilter = ref<FeatureFlagCategory | 'ALL'>('ALL');

interface PendingToggle {
  key: FeatureFlagKey;
  nextEnabled: boolean;
  category: FeatureFlagCategory;
  descriptionVi: string;
}

const pendingToggle = ref<PendingToggle | null>(null);

const CATEGORIES: ReadonlyArray<FeatureFlagCategory> = FEATURE_FLAG_CATEGORIES;

/**
 * Flag "lớn" cần confirm modal khi tắt — hệ trọng / impact cao.
 * Không bao gồm flag bật-tắt nhỏ như SHOP_DISCOUNT_EVENTS.
 */
const MAJOR_FLAGS: ReadonlySet<FeatureFlagKey> = new Set<FeatureFlagKey>([
  'ARENA_ENABLED',
  'MARKET_ENABLED',
  'LIVEOPS_EVENTS_ENABLED',
  'TERRITORY_WAR_ENABLED',
  'LIVEOPS_FESTIVAL_GIFT_ENABLED',
]);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return flags.value.filter((f) => {
    if (categoryFilter.value !== 'ALL' && f.category !== categoryFilter.value) {
      return false;
    }
    if (!q) return true;
    return (
      f.key.toLowerCase().includes(q) ||
      f.descriptionVi.toLowerCase().includes(q) ||
      f.descriptionEn.toLowerCase().includes(q) ||
      f.module.toLowerCase().includes(q)
    );
  });
});

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    flags.value = await adminListFeatureFlags();
  } catch (e) {
    error.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void refresh();
});

function requestToggle(flag: FeatureFlagAdminView): void {
  if (togglingKey.value) return;
  const nextEnabled = !flag.enabled;
  // Tắt flag lớn → confirm modal. Bật lại không cần confirm (bật là an toàn).
  if (!nextEnabled && MAJOR_FLAGS.has(flag.key)) {
    pendingToggle.value = {
      key: flag.key,
      nextEnabled,
      category: flag.category,
      descriptionVi: flag.descriptionVi,
    };
    return;
  }
  void doToggle(flag.key, nextEnabled);
}

async function confirmPendingToggle(): Promise<void> {
  const p = pendingToggle.value;
  if (!p) return;
  pendingToggle.value = null;
  await doToggle(p.key, p.nextEnabled);
}

function cancelPendingToggle(): void {
  pendingToggle.value = null;
}

async function doToggle(
  key: FeatureFlagKey,
  nextEnabled: boolean,
): Promise<void> {
  togglingKey.value = key;
  try {
    const view = await adminUpdateFeatureFlag(key, nextEnabled);
    const idx = flags.value.findIndex((f) => f.key === key);
    if (idx >= 0) flags.value[idx] = view;
    toast.push({
      type: 'success',
      text: t(
        nextEnabled
          ? 'adminFeatureFlags.toast.enabled'
          : 'adminFeatureFlags.toast.disabled',
        { key },
      ),
    });
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text:
        t(`adminFeatureFlags.errors.${code}`, '__missing__') === '__missing__'
          ? t('adminFeatureFlags.errors.UNKNOWN')
          : t(`adminFeatureFlags.errors.${code}`),
    });
  } finally {
    togglingKey.value = null;
  }
}

async function refreshDefaults(): Promise<void> {
  if (refreshingDefaults.value) return;
  refreshingDefaults.value = true;
  try {
    const result = await adminRefreshFeatureFlagDefaults();
    toast.push({
      type: 'success',
      text: t('adminFeatureFlags.toast.refreshedDefaults', {
        created: result.created,
        existing: result.existing,
      }),
    });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text:
        t(`adminFeatureFlags.errors.${code}`, '__missing__') === '__missing__'
          ? t('adminFeatureFlags.errors.UNKNOWN')
          : t(`adminFeatureFlags.errors.${code}`),
    });
  } finally {
    refreshingDefaults.value = false;
  }
}

async function clearCache(): Promise<void> {
  if (clearingCache.value) return;
  clearingCache.value = true;
  try {
    await adminClearFeatureFlagCache();
    toast.push({
      type: 'success',
      text: t('adminFeatureFlags.toast.cacheCleared'),
    });
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text:
        t(`adminFeatureFlags.errors.${code}`, '__missing__') === '__missing__'
          ? t('adminFeatureFlags.errors.UNKNOWN')
          : t(`adminFeatureFlags.errors.${code}`),
    });
  } finally {
    clearingCache.value = false;
  }
}

function fmtUpdatedAt(iso: string | null): string {
  if (!iso) return t('adminFeatureFlags.row.notUpdated');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
</script>

<template>
  <section
    class="space-y-3 bg-ink-700/30 border border-ink-300/20 rounded p-3"
    data-testid="admin-feature-flags-panel"
  >
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-lg text-amber-200">
          {{ t('adminFeatureFlags.title') }}
        </h2>
        <p class="text-xs text-ink-300">
          {{ t('adminFeatureFlags.hint') }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <MButton
          :disabled="loading"
          data-testid="admin-feature-flags-refresh"
          @click="refresh"
        >
          {{ t('adminFeatureFlags.actions.refresh') }}
        </MButton>
        <MButton
          :disabled="refreshingDefaults"
          data-testid="admin-feature-flags-refresh-defaults"
          @click="refreshDefaults"
        >
          {{ t('adminFeatureFlags.actions.refreshDefaults') }}
        </MButton>
        <MButton
          :disabled="clearingCache"
          data-testid="admin-feature-flags-clear-cache"
          @click="clearCache"
        >
          {{ t('adminFeatureFlags.actions.clearCache') }}
        </MButton>
      </div>
    </header>

    <div class="flex flex-wrap items-center gap-2 text-sm">
      <input
        v-model="search"
        type="text"
        :placeholder="t('adminFeatureFlags.filter.searchPlaceholder')"
        class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
        data-testid="admin-feature-flags-search"
      />
      <select
        v-model="categoryFilter"
        class="bg-ink-700/40 border border-ink-300/30 rounded px-2 py-1"
        data-testid="admin-feature-flags-category-filter"
      >
        <option value="ALL">
          {{ t('adminFeatureFlags.filter.allCategories') }}
        </option>
        <option v-for="c in CATEGORIES" :key="c" :value="c">
          {{ t(`adminFeatureFlags.category.${c}`) }}
        </option>
      </select>
    </div>

    <div
      v-if="loading"
      class="text-ink-300 text-sm"
      data-testid="admin-feature-flags-loading"
    >
      {{ t('adminFeatureFlags.loading') }}
    </div>
    <div
      v-else-if="error"
      class="text-rose-400 text-sm"
      data-testid="admin-feature-flags-error"
    >
      {{
        t(`adminFeatureFlags.errors.${error}`, '__missing__') === '__missing__'
          ? t('adminFeatureFlags.errors.UNKNOWN')
          : t(`adminFeatureFlags.errors.${error}`)
      }}
    </div>
    <div
      v-else-if="filtered.length === 0"
      class="text-ink-300 text-sm italic"
      data-testid="admin-feature-flags-empty"
    >
      {{ t('adminFeatureFlags.empty') }}
    </div>
    <ul
      v-else
      class="space-y-2"
      data-testid="admin-feature-flags-list"
    >
      <li
        v-for="flag in filtered"
        :key="flag.key"
        class="bg-ink-800/40 border border-ink-300/20 rounded p-3"
        :data-testid="`admin-feature-flag-row-${flag.key}`"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="space-y-1 min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span
                class="font-mono text-sm text-ink-100"
                :data-testid="`admin-feature-flag-key-${flag.key}`"
              >{{ flag.key }}</span>
              <span
                class="text-[10px] px-1.5 py-0.5 rounded bg-ink-700/40 border border-ink-300/30 text-ink-300"
              >{{ t(`adminFeatureFlags.category.${flag.category}`) }}</span>
              <span
                v-if="flag.public"
                class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-200"
                :title="t('adminFeatureFlags.row.publicHint')"
              >{{ t('adminFeatureFlags.row.publicTag') }}</span>
            </div>
            <p class="text-xs text-ink-200">{{ flag.descriptionVi }}</p>
            <p class="text-xs text-ink-300">{{ flag.descriptionEn }}</p>
            <p class="text-xs text-ink-400">
              {{ t('adminFeatureFlags.row.module', { module: flag.module }) }}
              ·
              {{
                t('adminFeatureFlags.row.default', {
                  value: flag.defaultEnabled
                    ? t('adminFeatureFlags.row.on')
                    : t('adminFeatureFlags.row.off'),
                })
              }}
              ·
              {{ t('adminFeatureFlags.row.updatedAt', { at: fmtUpdatedAt(flag.updatedAt) }) }}
            </p>
          </div>
          <div class="flex flex-col items-end gap-2">
            <span
              :class="
                flag.enabled
                  ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                  : 'text-rose-300 border-rose-500/40 bg-rose-500/10'
              "
              class="text-xs px-2 py-0.5 rounded border"
              :data-testid="`admin-feature-flag-state-${flag.key}`"
            >
              {{
                flag.enabled
                  ? t('adminFeatureFlags.row.on')
                  : t('adminFeatureFlags.row.off')
              }}
            </span>
            <MButton
              :disabled="togglingKey === flag.key"
              :data-testid="`admin-feature-flag-toggle-${flag.key}`"
              @click="requestToggle(flag)"
            >
              {{
                togglingKey === flag.key
                  ? t('common.loading')
                  : flag.enabled
                    ? t('adminFeatureFlags.actions.disable')
                    : t('adminFeatureFlags.actions.enable')
              }}
            </MButton>
          </div>
        </div>
      </li>
    </ul>

    <ConfirmModal
      :open="pendingToggle !== null"
      danger
      :title="t('adminFeatureFlags.confirm.title')"
      :message="
        pendingToggle
          ? t('adminFeatureFlags.confirm.message', {
            key: pendingToggle.key,
            description: pendingToggle.descriptionVi,
          })
          : ''
      "
      :confirm-text="t('adminFeatureFlags.actions.disable')"
      test-id="admin-feature-flag-confirm"
      @confirm="confirmPendingToggle"
      @cancel="cancelPendingToggle"
    />
  </section>
</template>
