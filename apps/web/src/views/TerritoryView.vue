<script setup lang="ts">
/**
 * Phase 14.0.A + 14.0.B + 14.0.C + 14.0.D — Sect Territory view.
 *
 * Render section:
 *   1. Region list (overview): tổng influence + top sect snapshot + Phase
 *      14.0.B owner badge "Đang chiếm giữ".
 *   2. Per-region leaderboard + history panel: chọn region từ list → fetch
 *      top 10 sect + N snapshot settlement gần nhất.
 *   3. My sect rank: per-region rank/points của sect user (nếu có).
 *   4. Phase 14.0.D — War tab (weekly war loop): countdown, current
 *      periodKey, region contested state, top 3 sect standings, lịch sử
 *      tuần, admin settle-current button.
 *   5. Admin panel (chỉ admin): trigger settlement toàn bộ hoặc từng region.
 *
 * FE read-only — server-authoritative. Influence ghi điểm xảy ra ở
 * server qua hook fail-soft (dungeon claim, boss reward). Settlement chỉ
 * xảy ra ở admin trigger / cron (server-authoritative, FE chỉ trigger).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useTerritoryStore } from '@/stores/territory';
import AppShell from '@/components/shell/AppShell.vue';
import type { TerritoryRegionBuffPreviewLite } from '@/api/territory';

type TerritoryTab = 'overview' | 'leaderboard' | 'me' | 'war';
const ALL_TABS: ReadonlyArray<TerritoryTab> = [
  'overview',
  'leaderboard',
  'me',
  'war',
];

const auth = useAuthStore();
const territory = useTerritoryStore();
const router = useRouter();
const route = useRoute();
const { t, locale, te } = useI18n();

const periodInput = ref('');
const decayBpsInput = ref('');
const isAdmin = computed(() => auth.user?.role === 'ADMIN');

/**
 * Phase 14.0.C — buff label / desc resolver.
 *
 * Catalog định nghĩa `labelI18nKey`/`descriptionI18nKey` ở format
 * `territory.buff.<buffKey>.label|desc`. Nếu key không tồn tại trong locale
 * (ví dụ catalog mở rộng FE chưa kịp ship i18n), fallback `buffKey` raw để
 * không vỡ render.
 */
function buffLabel(b: TerritoryRegionBuffPreviewLite): string {
  return te(b.labelI18nKey) ? t(b.labelI18nKey) : b.buffKey;
}
function buffDesc(b: TerritoryRegionBuffPreviewLite): string {
  return te(b.descriptionI18nKey) ? t(b.descriptionI18nKey) : '';
}
function buffValuePct(b: TerritoryRegionBuffPreviewLite): string {
  return Math.round(b.value * 1000) / 10 + '';
}
function buffTypeLabel(b: TerritoryRegionBuffPreviewLite): string {
  const key = `territory.buff.type.${b.buffType}`;
  if (!te(key)) return b.buffType;
  return t(key, { value: buffValuePct(b) });
}
function buffAppliesToLabel(scope: string): string {
  const key = `territory.buff.appliesTo.${scope}`;
  return te(key) ? t(key) : scope;
}

const queryTab = (route.query.tab as string | undefined) ?? '';
const initialTab: TerritoryTab = (ALL_TABS as ReadonlyArray<string>).includes(
  queryTab,
)
  ? (queryTab as TerritoryTab)
  : 'overview';
const tab = ref<TerritoryTab>(initialTab);

/**
 * Region đang được chọn cho leaderboard tab. Default region đầu tiên
 * trong list (theo `sortOrder`).
 */
const selectedRegionKey = ref<string | null>(
  (route.query.region as string | undefined) ?? null,
);

function setTab(next: TerritoryTab): void {
  tab.value = next;
  router.replace({ query: { ...route.query, tab: next } }).catch(() => null);
}

function setRegion(regionKey: string): void {
  selectedRegionKey.value = regionKey;
  router
    .replace({ query: { ...route.query, region: regionKey } })
    .catch(() => null);
}

function regionName(r: { nameVi: string; nameEn: string }): string {
  return locale.value === 'en' ? r.nameEn : r.nameVi;
}

const sortedRegions = computed(() =>
  [...(territory.regions?.regions ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  ),
);

const selectedLeaderboard = computed(() => {
  const key = selectedRegionKey.value;
  if (!key) return null;
  return territory.leaderboards[key] ?? null;
});

const selectedRegionView = computed(() => {
  const key = selectedRegionKey.value;
  if (!key) return null;
  return sortedRegions.value.find((r) => r.regionKey === key) ?? null;
});

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  // Fetch song song: regions + me. Leaderboard fetch chỉ khi user vào tab.
  await Promise.all([territory.fetchRegions(), territory.fetchMe()]);
  // Auto-select region đầu tiên nếu chưa có (deep-link query.region đã set).
  if (!selectedRegionKey.value && sortedRegions.value.length > 0) {
    selectedRegionKey.value = sortedRegions.value[0].regionKey;
  }
});

// Khi user chuyển sang leaderboard tab hoặc đổi region → fetch leaderboard
// + history (Phase 14.0.B) nếu cache miss. Cache theo regionKey trong store
// nên chuyển lại tab/region đã visit không trigger fetch lặp.
watch(
  [tab, selectedRegionKey],
  async ([t, region]) => {
    if (t !== 'leaderboard' || !region) return;
    const tasks: Array<Promise<unknown>> = [];
    if (!territory.leaderboards[region]) {
      tasks.push(territory.fetchLeaderboard(region));
    }
    if (!territory.histories[region]) {
      tasks.push(territory.fetchHistory(region));
    }
    if (tasks.length > 0) await Promise.all(tasks);
  },
  { immediate: true },
);

const myRegionRows = computed(() => territory.me?.regions ?? []);

const selectedHistory = computed(() => {
  const key = selectedRegionKey.value;
  if (!key) return null;
  return territory.histories[key] ?? null;
});

async function onSettleAll(): Promise<void> {
  const periodKey = periodInput.value.trim() || undefined;
  await territory.adminSettleAll(periodKey);
}

async function onSettleRegion(): Promise<void> {
  if (!selectedRegionKey.value) return;
  const periodKey = periodInput.value.trim() || undefined;
  await territory.adminSettleRegion(selectedRegionKey.value, periodKey);
  // Refresh history for the just-settled region.
  await territory.fetchHistory(selectedRegionKey.value, { force: true });
}

async function onRunDecay(): Promise<void> {
  const periodKey = periodInput.value.trim() || undefined;
  const raw = decayBpsInput.value.trim();
  let decayBps: number | undefined;
  if (raw.length > 0) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      decayBps = Math.floor(parsed);
    }
  }
  await territory.adminDecay({ periodKey, decayBps });
}

const decayBpsPercent = computed(() => {
  const r = territory.lastDecayResult;
  if (!r) return '';
  return (Math.round((r.decayBps / 10000) * 1000) / 10).toString();
});
</script>

<template>
  <AppShell>
    <header class="mb-4">
      <h2 class="text-xl tracking-widest">{{ t('territory.title') }}</h2>
      <p class="text-xs text-ink-300 mt-1">{{ t('territory.subtitle') }}</p>
    </header>

    <div
      v-if="territory.regionsLoading || territory.meLoading"
      class="text-ink-300 text-sm"
      data-test="territory-loading"
    >
      {{ t('territory.loading') }}
    </div>
    <div
      v-else-if="territory.regionsError || territory.meError"
      class="text-rose-300 text-sm"
      data-test="territory-error"
    >
      {{
        t(
          `territory.errors.${territory.regionsError || territory.meError}`,
          t('territory.errors.UNKNOWN'),
        )
      }}
    </div>
    <div v-else class="space-y-4" data-test="territory-content">
      <nav
        class="flex flex-wrap gap-2 text-xs"
        role="tablist"
        data-test="territory-tabs"
      >
        <button
          v-for="key in ALL_TABS"
          :key="key"
          type="button"
          role="tab"
          :aria-selected="tab === key"
          class="px-3 py-1 rounded border tracking-widest uppercase"
          :class="
            tab === key
              ? 'border-amber-300/70 text-amber-200 bg-ink-700/40'
              : 'border-ink-300/40 text-ink-300 hover:border-amber-300/40'
          "
          :data-test="`territory-tab-${key}`"
          @click="setTab(key)"
        >
          {{ t(`territory.tab.${key}`) }}
        </button>
      </nav>

      <section
        v-if="tab === 'overview'"
        data-test="territory-tab-content-overview"
      >
        <div
          v-if="territory.regions?.currentPeriodKey"
          class="text-[11px] text-ink-300/70 mb-2"
          data-test="territory-overview-period"
        >
          {{
            t('territory.overview.currentPeriod', {
              period: territory.regions.currentPeriodKey,
            })
          }}
        </div>
        <div
          v-if="sortedRegions.length === 0"
          class="text-ink-300 text-sm"
          data-test="territory-overview-empty"
        >
          {{ t('territory.overview.empty') }}
        </div>
        <ul v-else class="space-y-2">
          <li
            v-for="r in sortedRegions"
            :key="r.regionKey"
            class="rounded border border-ink-300/40 bg-ink-700/30 p-3 flex flex-wrap items-center justify-between gap-3"
            data-test="territory-region-row"
            :data-region-key="r.regionKey"
          >
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-amber-300 text-sm">
                  {{ regionName(r) }}
                </span>
                <span
                  v-if="r.ownerSectId"
                  class="px-2 py-0.5 rounded-full border border-amber-300/70 text-[10px] tracking-widest uppercase text-amber-200 bg-amber-300/10"
                  data-test="territory-region-owner-badge"
                  :data-owner-sect-id="r.ownerSectId"
                >
                  {{ t('territory.overview.ownerBadge') }}
                </span>
              </div>
              <div class="text-xs text-ink-300/80 mt-1">
                {{
                  t('territory.overview.summary', {
                    pts: r.totalPoints,
                    contributors: r.contributors,
                  })
                }}
              </div>
              <div
                class="text-xs mt-1"
                data-test="territory-region-owner"
              >
                <span
                  v-if="r.ownerSectId"
                  class="text-amber-200"
                >
                  {{
                    t('territory.overview.owner', {
                      name: r.ownerSectName ?? r.ownerSectId,
                    })
                  }}
                  <span
                    v-if="r.ownerPeriodKey"
                    class="ml-1 text-ink-300/70"
                  >
                    ·
                    {{
                      t('territory.overview.ownerSettled', {
                        period: r.ownerPeriodKey,
                      })
                    }}
                  </span>
                </span>
                <span v-else class="italic text-ink-300/70">
                  {{ t('territory.overview.noOwner') }}
                </span>
              </div>
            </div>
            <div class="text-xs text-ink-300/90">
              <div v-if="r.topSectId">
                {{
                  t('territory.overview.topSect', {
                    name: r.topSectName,
                    pts: r.topSectPoints,
                  })
                }}
              </div>
              <div v-else class="italic">
                {{ t('territory.overview.noTopSect') }}
              </div>
            </div>
            <!-- Phase 14.0.C — Region buff preview list -->
            <div
              class="basis-full"
              data-test="territory-region-buffs"
              :data-region-key="r.regionKey"
            >
              <div
                class="text-[11px] tracking-widest uppercase text-ink-300/70 mb-1"
              >
                {{ t('territory.overview.buffSectionTitle') }}
              </div>
              <div
                v-if="r.buffs.length === 0"
                class="text-xs italic text-ink-300/70"
                data-test="territory-region-buffs-empty"
              >
                {{ t('territory.overview.buffNone') }}
              </div>
              <ul v-else class="space-y-1">
                <li
                  v-for="b in r.buffs"
                  :key="b.buffKey"
                  class="rounded border border-ink-300/30 bg-ink-800/40 px-2 py-1 flex flex-wrap items-center gap-2 text-xs"
                  data-test="territory-region-buff-row"
                  :data-buff-key="b.buffKey"
                >
                  <span class="text-amber-200">{{ buffLabel(b) }}</span>
                  <span class="text-ink-300/80">{{ buffTypeLabel(b) }}</span>
                  <span
                    v-for="scope in b.appliesTo"
                    :key="scope"
                    class="px-1.5 py-0.5 rounded bg-ink-700/60 text-[10px] tracking-wider uppercase text-ink-300/90"
                  >
                    {{ buffAppliesToLabel(scope) }}
                  </span>
                  <span
                    v-if="r.ownerBuffActive"
                    class="ml-auto px-1.5 py-0.5 rounded-full border border-emerald-300/70 text-[10px] tracking-widest uppercase text-emerald-200 bg-emerald-300/10"
                    data-test="territory-region-buff-active"
                  >
                    {{ t('territory.overview.buffActiveBadge') }}
                  </span>
                  <span
                    v-else
                    class="ml-auto px-1.5 py-0.5 rounded-full border border-ink-300/40 text-[10px] tracking-widest uppercase text-ink-300/70"
                    data-test="territory-region-buff-inactive"
                  >
                    {{ t('territory.overview.buffInactiveBadge') }}
                  </span>
                  <div
                    v-if="buffDesc(b)"
                    class="basis-full text-[11px] text-ink-300/70"
                  >
                    {{ buffDesc(b) }}
                  </div>
                </li>
              </ul>
            </div>
          </li>
        </ul>
        <p class="mt-3 text-[11px] text-ink-300/60">
          {{ t('territory.overview.buffOwnerHint') }}
        </p>
      </section>

      <section
        v-else-if="tab === 'leaderboard'"
        data-test="territory-tab-content-leaderboard"
      >
        <div class="flex flex-wrap gap-2 mb-3" data-test="territory-region-pick">
          <button
            v-for="r in sortedRegions"
            :key="r.regionKey"
            type="button"
            class="px-2 py-1 rounded border text-xs tracking-widest"
            :class="
              selectedRegionKey === r.regionKey
                ? 'border-amber-300/70 text-amber-200 bg-ink-700/40'
                : 'border-ink-300/40 text-ink-300 hover:border-amber-300/40'
            "
            :data-test="`territory-region-pick-${r.regionKey}`"
            @click="setRegion(r.regionKey)"
          >
            {{ regionName(r) }}
          </button>
        </div>

        <div
          v-if="
            selectedRegionKey &&
              territory.leaderboardLoading[selectedRegionKey]
          "
          class="text-ink-300 text-sm"
          data-test="territory-leaderboard-loading"
        >
          {{ t('territory.loading') }}
        </div>
        <div
          v-else-if="
            selectedRegionKey &&
              territory.leaderboardError[selectedRegionKey]
          "
          class="text-rose-300 text-sm"
          data-test="territory-leaderboard-error"
        >
          {{
            t(
              `territory.errors.${territory.leaderboardError[selectedRegionKey]}`,
              t('territory.errors.UNKNOWN'),
            )
          }}
        </div>
        <div
          v-else-if="selectedLeaderboard"
          data-test="territory-leaderboard-table"
        >
          <div
            v-if="selectedRegionView"
            class="text-xs text-ink-300/80 mb-2"
            data-test="territory-leaderboard-region-name"
          >
            {{ regionName(selectedRegionView) }}
          </div>
          <div
            v-if="selectedLeaderboard.rows.length === 0"
            class="text-ink-300 text-sm"
            data-test="territory-leaderboard-empty"
          >
            {{ t('territory.leaderboard.empty') }}
          </div>
          <table
            v-else
            class="w-full text-xs"
            data-test="territory-leaderboard"
          >
            <thead class="text-ink-300/80">
              <tr>
                <th class="text-left py-1">
                  {{ t('territory.leaderboard.col.rank') }}
                </th>
                <th class="text-left py-1">
                  {{ t('territory.leaderboard.col.sect') }}
                </th>
                <th class="text-right py-1">
                  {{ t('territory.leaderboard.col.points') }}
                </th>
                <th class="text-right py-1">
                  {{ t('territory.leaderboard.col.contributors') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in selectedLeaderboard.rows"
                :key="row.sectId"
                class="border-t border-ink-300/20"
                :class="
                  row.sectId === territory.me?.sectId
                    ? 'bg-amber-300/10 text-amber-200'
                    : ''
                "
                data-test="territory-leaderboard-row"
                :data-sect-id="row.sectId"
              >
                <td class="py-1">#{{ row.rank }}</td>
                <td class="py-1">
                  {{ row.sectName }}
                  <span
                    v-if="row.sectId === territory.me?.sectId"
                    class="ml-1 text-amber-300"
                  >
                    {{ t('territory.leaderboard.youTag') }}
                  </span>
                </td>
                <td class="py-1 text-right">{{ row.points }}</td>
                <td class="py-1 text-right">{{ row.contributors }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          v-else
          class="text-ink-300 text-sm"
          data-test="territory-leaderboard-pick-hint"
        >
          {{ t('territory.leaderboard.pickHint') }}
        </div>

        <!-- Phase 14.0.B — Settlement history panel -->
        <div
          v-if="selectedRegionKey"
          class="mt-6 border-t border-ink-300/20 pt-4"
          data-test="territory-history-panel"
        >
          <h3 class="text-sm tracking-widest uppercase text-amber-200 mb-2">
            {{ t('territory.history.title') }}
          </h3>
          <div
            v-if="territory.historyLoading[selectedRegionKey]"
            class="text-ink-300 text-sm"
            data-test="territory-history-loading"
          >
            {{ t('territory.loading') }}
          </div>
          <div
            v-else-if="territory.historyError[selectedRegionKey]"
            class="text-rose-300 text-sm"
            data-test="territory-history-error"
          >
            {{
              t(
                `territory.errors.${territory.historyError[selectedRegionKey]}`,
                t('territory.errors.UNKNOWN'),
              )
            }}
          </div>
          <div v-else-if="selectedHistory">
            <div
              class="text-xs text-ink-300/80 mb-2"
              data-test="territory-history-current"
            >
              <span v-if="selectedHistory.currentOwnerSectId">
                {{
                  t('territory.history.current', {
                    name:
                      selectedHistory.currentOwnerSectName ??
                      selectedHistory.currentOwnerSectId,
                    period: selectedHistory.currentPeriodKey ?? '—',
                  })
                }}
              </span>
              <span v-else class="italic">
                {{ t('territory.history.currentNone') }}
              </span>
            </div>
            <div
              v-if="selectedHistory.snapshots.length === 0"
              class="text-ink-300 text-sm"
              data-test="territory-history-empty"
            >
              {{ t('territory.history.empty') }}
            </div>
            <ul
              v-else
              class="space-y-1 text-xs"
              data-test="territory-history-list"
            >
              <li
                v-for="snap in selectedHistory.snapshots"
                :key="snap.id"
                class="border border-ink-300/30 bg-ink-700/20 rounded px-2 py-1"
                data-test="territory-history-row"
                :data-period-key="snap.periodKey"
              >
                <span v-if="snap.runnerUpSectId">
                  {{
                    t('territory.history.row', {
                      period: snap.periodKey,
                      sect: snap.winnerSectName ?? snap.winnerSectId ?? '—',
                      pts: snap.winnerPoints,
                      runner:
                        snap.runnerUpSectName ?? snap.runnerUpSectId ?? '—',
                      rpts: snap.runnerUpPoints,
                    })
                  }}
                </span>
                <span v-else>
                  {{
                    t('territory.history.rowNoRunner', {
                      period: snap.periodKey,
                      sect: snap.winnerSectName ?? snap.winnerSectId ?? '—',
                      pts: snap.winnerPoints,
                    })
                  }}
                </span>
              </li>
            </ul>
          </div>
        </div>

        <!-- Phase 14.0.B — Admin settlement trigger -->
        <div
          v-if="isAdmin"
          class="mt-6 border-t border-ink-300/20 pt-4 space-y-2"
          data-test="territory-admin-panel"
        >
          <h3 class="text-sm tracking-widest uppercase text-amber-200">
            {{ t('territory.admin.title') }}
          </h3>
          <p class="text-xs text-ink-300/80">
            {{ t('territory.admin.subtitle') }}
          </p>
          <label class="block text-xs text-ink-300/80">
            {{ t('territory.admin.periodLabel') }}
            <input
              v-model="periodInput"
              type="text"
              class="mt-1 block w-full rounded border border-ink-300/40 bg-ink-800/40 px-2 py-1 text-xs"
              placeholder="2026-W23"
              data-test="territory-admin-period-input"
            />
          </label>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              :disabled="territory.settleLoading"
              class="px-3 py-1 rounded border border-amber-300/70 text-amber-200 text-xs tracking-widest uppercase hover:bg-amber-300/10 disabled:opacity-50"
              data-test="territory-admin-settle-all"
              @click="onSettleAll"
            >
              {{
                territory.settleLoading
                  ? t('territory.admin.running')
                  : t('territory.admin.settleAll')
              }}
            </button>
            <button
              v-if="selectedRegionKey"
              type="button"
              :disabled="territory.settleLoading"
              class="px-3 py-1 rounded border border-amber-300/70 text-amber-200 text-xs tracking-widest uppercase hover:bg-amber-300/10 disabled:opacity-50"
              data-test="territory-admin-settle-region"
              @click="onSettleRegion"
            >
              {{ t('territory.admin.settleRegion') }}
            </button>
          </div>
          <div
            v-if="territory.settleError"
            class="text-rose-300 text-xs"
            data-test="territory-admin-error"
          >
            {{
              t(
                `territory.errors.${territory.settleError}`,
                t('territory.errors.UNKNOWN'),
              )
            }}
          </div>
          <div
            v-if="territory.lastSettleResult"
            class="text-xs text-ink-300/90"
            data-test="territory-admin-result"
          >
            {{
              t('territory.admin.lastResult', {
                period: territory.lastSettleResult.periodKey,
                wins: territory.lastSettleResult.snapshots.length,
                skip: territory.lastSettleResult.skippedRegions.length,
              })
            }}
          </div>

          <!-- Phase 14.0.C — Admin influence decay trigger -->
          <div
            class="mt-4 border-t border-ink-300/20 pt-3 space-y-2"
            data-test="territory-admin-decay-panel"
          >
            <h4 class="text-xs tracking-widest uppercase text-amber-200">
              {{ t('territory.admin.decayTitle') }}
            </h4>
            <p class="text-xs text-ink-300/80">
              {{ t('territory.admin.decaySubtitle') }}
            </p>
            <label class="block text-xs text-ink-300/80">
              {{ t('territory.admin.decayBpsLabel') }}
              <input
                v-model="decayBpsInput"
                type="text"
                inputmode="numeric"
                class="mt-1 block w-full rounded border border-ink-300/40 bg-ink-800/40 px-2 py-1 text-xs"
                placeholder="2500"
                data-test="territory-admin-decay-bps-input"
              />
            </label>
            <button
              type="button"
              :disabled="territory.decayLoading"
              class="px-3 py-1 rounded border border-amber-300/70 text-amber-200 text-xs tracking-widest uppercase hover:bg-amber-300/10 disabled:opacity-50"
              data-test="territory-admin-decay-run"
              @click="onRunDecay"
            >
              {{
                territory.decayLoading
                  ? t('territory.admin.decayRunning')
                  : t('territory.admin.decayRun')
              }}
            </button>
            <div
              v-if="territory.decayError"
              class="text-rose-300 text-xs"
              data-test="territory-admin-decay-error"
            >
              {{
                t(
                  `territory.errors.${territory.decayError}`,
                  t('territory.errors.UNKNOWN'),
                )
              }}
            </div>
            <div
              v-if="territory.lastDecayResult && territory.lastDecayResult.skipped"
              class="text-xs text-ink-300/90"
              data-test="territory-admin-decay-skipped"
            >
              {{
                t('territory.admin.decaySkipped', {
                  period: territory.lastDecayResult.periodKey,
                })
              }}
            </div>
            <div
              v-else-if="territory.lastDecayResult"
              class="text-xs text-ink-300/90"
              data-test="territory-admin-decay-result"
            >
              {{
                t('territory.admin.decayLastResult', {
                  period: territory.lastDecayResult.periodKey,
                  delta: territory.lastDecayResult.delta,
                  rows: territory.lastDecayResult.rowsAffected,
                  bpsPercent: decayBpsPercent,
                })
              }}
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="tab === 'me'" data-test="territory-tab-content-me">
        <div
          v-if="!territory.me?.hasSect"
          class="text-ink-300 text-sm"
          data-test="territory-me-no-sect"
        >
          {{ t('territory.me.noSect') }}
        </div>
        <div v-else>
          <div class="text-xs text-ink-300 mb-2">
            {{
              t('territory.me.header', {
                sect: territory.me.sectName,
              })
            }}
          </div>

          <!-- Phase 14.0.C — Active buffs of player's sect -->
          <div class="mb-4" data-test="territory-me-active-buffs">
            <h3
              class="text-sm tracking-widest uppercase text-amber-200 mb-1"
            >
              {{ t('territory.myBuffs.title') }}
            </h3>
            <div
              v-if="(territory.me.activeBuffs ?? []).length === 0"
              class="text-xs italic text-ink-300/70"
              data-test="territory-me-active-buffs-empty"
            >
              {{ t('territory.myBuffs.empty') }}
            </div>
            <ul v-else class="space-y-1">
              <li
                v-for="b in territory.me.activeBuffs"
                :key="b.buffKey"
                class="rounded border border-emerald-300/40 bg-emerald-300/10 px-2 py-1 flex flex-wrap items-center gap-2 text-xs"
                data-test="territory-me-active-buff-row"
                :data-buff-key="b.buffKey"
              >
                <span class="text-emerald-200">{{ buffLabel(b) }}</span>
                <span class="text-ink-300/80">{{ buffTypeLabel(b) }}</span>
                <span
                  v-for="scope in b.appliesTo"
                  :key="scope"
                  class="px-1.5 py-0.5 rounded bg-ink-700/60 text-[10px] tracking-wider uppercase text-ink-300/90"
                >
                  {{ buffAppliesToLabel(scope) }}
                </span>
                <div
                  v-if="buffDesc(b)"
                  class="basis-full text-[11px] text-ink-300/70"
                >
                  {{ buffDesc(b) }}
                </div>
              </li>
            </ul>
          </div>
          <table class="w-full text-xs" data-test="territory-me-table">
            <thead class="text-ink-300/80">
              <tr>
                <th class="text-left py-1">
                  {{ t('territory.me.col.region') }}
                </th>
                <th class="text-right py-1">
                  {{ t('territory.me.col.rank') }}
                </th>
                <th class="text-right py-1">
                  {{ t('territory.me.col.sectPoints') }}
                </th>
                <th class="text-right py-1">
                  {{ t('territory.me.col.personalPoints') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in myRegionRows"
                :key="row.regionKey"
                class="border-t border-ink-300/20"
                data-test="territory-me-row"
                :data-region-key="row.regionKey"
              >
                <td class="py-1">{{ regionName(row) }}</td>
                <td class="py-1 text-right">
                  <span v-if="row.sectRank">#{{ row.sectRank }}</span>
                  <span v-else class="text-ink-300/60">—</span>
                </td>
                <td class="py-1 text-right">{{ row.sectPoints }}</td>
                <td class="py-1 text-right">{{ row.personalPoints }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </AppShell>
</template>
