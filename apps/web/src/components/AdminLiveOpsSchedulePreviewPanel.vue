<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  adminLiveOpsSchedulePreview,
  type AdminLiveOpsSchedulePreviewView,
} from '@/api/admin';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

/**
 * Phase 13.1.D — Admin LiveOps Schedule Preview panel.
 *
 * Read-only panel hiển thị:
 *   - Active events tại `now` (đã overlay override DB).
 *   - Upcoming event slots (top 5 / event catalog, search 7 ngày).
 *   - Boss schedule today + 7 ngày kế (group theo local day).
 *   - Sect War season tuần hiện tại + status snapshot.
 *   - Toàn bộ override hiện đang lưu trong DB.
 *
 * KHÔNG mutate, KHÔNG audit. Refresh thủ công qua button.
 */

const { t } = useI18n();

const data = ref<AdminLiveOpsSchedulePreviewView | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(refresh);

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    data.value = await adminLiveOpsSchedulePreview();
  } catch (e) {
    error.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.value = false;
  }
}

const bossWeekByDate = computed(() => {
  const groups = new Map<
    string,
    AdminLiveOpsSchedulePreviewView['bossScheduleWeek'][number][]
  >();
  for (const slot of data.value?.bossScheduleWeek ?? []) {
    const list = groups.get(slot.localDate) ?? [];
    list.push(slot);
    groups.set(slot.localDate, list);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
});

defineExpose({ refresh });
</script>

<template>
  <section
    class="border border-ink-300/40 rounded space-y-2"
    data-test="admin-liveops-schedule-preview-panel"
  >
    <div
      class="px-4 py-2 text-xs uppercase tracking-widest text-ink-300 border-b border-ink-300/30 flex items-center justify-between"
    >
      <span>{{ t('adminLiveOpsPreview.title') }}</span>
      <span v-if="data" class="text-ink-300/70 normal-case tracking-normal">
        {{ t('adminLiveOpsPreview.tz', { tz: data.tz }) }}
      </span>
    </div>

    <div
      v-if="loading"
      class="p-4 text-sm text-ink-300"
      data-test="admin-liveops-schedule-preview-loading"
    >
      {{ t('adminLiveOpsPreview.loading') }}
    </div>
    <div
      v-else-if="error"
      class="p-4 text-sm text-rose-300"
      data-test="admin-liveops-schedule-preview-error"
    >
      {{
        t(
          `adminLiveOpsPreview.errors.${error}`,
          t('adminLiveOpsPreview.errors.UNKNOWN'),
        )
      }}
      <button
        type="button"
        class="ml-2 px-2 py-0.5 rounded border border-ink-300/40 text-xs"
        data-test="admin-liveops-schedule-preview-retry"
        @click="refresh"
      >
        {{ t('adminLiveOpsPreview.retry') }}
      </button>
    </div>
    <div
      v-else-if="data"
      class="p-3 space-y-3 text-sm"
      data-test="admin-liveops-schedule-preview-content"
    >
      <div class="text-xs text-ink-300/80 flex items-center justify-between">
        <span>{{ t('adminLiveOpsPreview.now', { iso: data.nowIso }) }}</span>
        <button
          type="button"
          class="px-2 py-0.5 rounded border border-sky-300/40 text-sky-200 text-xs"
          data-test="admin-liveops-schedule-preview-refresh"
          @click="refresh"
        >
          {{ t('adminLiveOpsPreview.refresh') }}
        </button>
      </div>

      <!-- Active events -->
      <section data-test="admin-liveops-schedule-preview-active">
        <div class="text-xs uppercase tracking-widest text-ink-300 mb-1">
          {{
            t('adminLiveOpsPreview.activeHeader', {
              n: data.activeEvents.length,
            })
          }}
        </div>
        <div
          v-if="data.activeEvents.length === 0"
          class="text-xs text-ink-300/60"
          data-test="admin-liveops-schedule-preview-active-empty"
        >
          {{ t('adminLiveOpsPreview.activeEmpty') }}
        </div>
        <ul v-else class="space-y-0.5 text-xs">
          <li
            v-for="ev in data.activeEvents"
            :key="ev.key"
            class="flex flex-wrap items-center gap-2 text-ink-200/90"
            data-test="admin-liveops-schedule-preview-active-row"
          >
            <span class="text-emerald-300">●</span>
            <span class="font-medium">{{ ev.key }}</span>
            <span class="text-ink-300/60">[{{ ev.type }}]</span>
            <span class="text-ink-300/70">{{ t(ev.titleI18nKey, ev.key) }}</span>
            <span class="ml-auto text-ink-300/60">
              {{ ev.slotStartIso }} → {{ ev.slotEndIso }}
            </span>
          </li>
        </ul>
      </section>

      <hr class="border-ink-300/20" />

      <!-- Upcoming events -->
      <section data-test="admin-liveops-schedule-preview-upcoming">
        <div class="text-xs uppercase tracking-widest text-ink-300 mb-1">
          {{
            t('adminLiveOpsPreview.upcomingHeader', {
              n: data.upcomingEvents.length,
            })
          }}
        </div>
        <div
          v-if="data.upcomingEvents.length === 0"
          class="text-xs text-ink-300/60"
          data-test="admin-liveops-schedule-preview-upcoming-empty"
        >
          {{ t('adminLiveOpsPreview.upcomingEmpty') }}
        </div>
        <ul v-else class="space-y-0.5 text-xs">
          <li
            v-for="(slot, idx) in data.upcomingEvents"
            :key="`${slot.key}-${idx}`"
            class="flex flex-wrap items-center gap-2 text-ink-200/90"
            data-test="admin-liveops-schedule-preview-upcoming-row"
          >
            <span
              :class="
                slot.effectiveEnabled ? 'text-emerald-300' : 'text-rose-300'
              "
            >
              {{ slot.effectiveEnabled ? 'ON' : 'OFF' }}
            </span>
            <span class="font-medium">{{ slot.key }}</span>
            <span class="text-ink-300/60">[{{ slot.type }}]</span>
            <span class="text-ink-300/70">{{
              t(slot.titleI18nKey, slot.key)
            }}</span>
            <span class="ml-auto text-ink-300/60">
              {{ slot.slotStartIso }} → {{ slot.slotEndIso }}
            </span>
          </li>
        </ul>
      </section>

      <hr class="border-ink-300/20" />

      <!-- Boss schedule today -->
      <section data-test="admin-liveops-schedule-preview-boss-today">
        <div class="text-xs uppercase tracking-widest text-ink-300 mb-1">
          {{
            t('adminLiveOpsPreview.bossTodayHeader', {
              n: data.bossScheduleToday.length,
            })
          }}
        </div>
        <div
          v-if="data.bossScheduleToday.length === 0"
          class="text-xs text-ink-300/60"
          data-test="admin-liveops-schedule-preview-boss-today-empty"
        >
          {{ t('adminLiveOpsPreview.bossTodayEmpty') }}
        </div>
        <ul v-else class="space-y-0.5 text-xs">
          <li
            v-for="slot in data.bossScheduleToday"
            :key="slot.key"
            class="flex flex-wrap items-center gap-2 text-ink-200/90"
            data-test="admin-liveops-schedule-preview-boss-today-row"
          >
            <span
              :class="{
                'text-emerald-300': slot.status === 'active',
                'text-amber-300': slot.status === 'upcoming',
                'text-ink-300/60': slot.status === 'completed',
              }"
            >
              ●
            </span>
            <span class="font-medium">{{ slot.bossKey }}</span>
            <span class="text-ink-300/60">@{{ slot.regionKey }}</span>
            <span class="text-ink-300/70">[{{ slot.status }}]</span>
            <span
              :class="
                slot.effectiveEnabled ? 'text-emerald-300' : 'text-rose-300'
              "
              class="text-[10px]"
            >
              {{ slot.effectiveEnabled ? 'ON' : 'OFF' }}
            </span>
            <span class="ml-auto text-ink-300/60">
              {{ slot.slotStartIso }} → {{ slot.slotEndIso }}
            </span>
          </li>
        </ul>
      </section>

      <hr class="border-ink-300/20" />

      <!-- Boss schedule week -->
      <section data-test="admin-liveops-schedule-preview-boss-week">
        <div class="text-xs uppercase tracking-widest text-ink-300 mb-1">
          {{
            t('adminLiveOpsPreview.bossWeekHeader', {
              n: data.bossScheduleWeek.length,
            })
          }}
        </div>
        <div
          v-if="bossWeekByDate.length === 0"
          class="text-xs text-ink-300/60"
          data-test="admin-liveops-schedule-preview-boss-week-empty"
        >
          {{ t('adminLiveOpsPreview.bossWeekEmpty') }}
        </div>
        <div v-else class="space-y-1">
          <details
            v-for="[date, slots] in bossWeekByDate"
            :key="date"
            class="text-xs border border-ink-300/20 rounded"
          >
            <summary class="px-2 py-1 cursor-pointer text-ink-300/80">
              {{ date }} · {{ slots.length }}
            </summary>
            <ul class="px-2 pb-1 space-y-0.5">
              <li
                v-for="slot in slots"
                :key="`${date}-${slot.key}-${slot.slotStartIso}`"
                class="flex flex-wrap items-center gap-2 text-ink-200/90"
                data-test="admin-liveops-schedule-preview-boss-week-row"
              >
                <span class="font-medium">{{ slot.bossKey }}</span>
                <span class="text-ink-300/60">@{{ slot.regionKey }}</span>
                <span class="text-ink-300/70">[{{ slot.status }}]</span>
                <span class="ml-auto text-ink-300/60">
                  {{ slot.slotStartIso }}
                </span>
              </li>
            </ul>
          </details>
        </div>
      </section>

      <hr class="border-ink-300/20" />

      <!-- Sect war week -->
      <section data-test="admin-liveops-schedule-preview-sectwar">
        <div class="text-xs uppercase tracking-widest text-ink-300 mb-1">
          {{ t('adminLiveOpsPreview.sectWarHeader') }}
        </div>
        <div class="text-xs text-ink-200/90">
          {{
            t('adminLiveOpsPreview.sectWarRow', {
              week: data.sectWar.season.weekKey,
              tz: data.sectWar.season.timezone,
              start: data.sectWar.season.startsAtIso,
              end: data.sectWar.season.endsAtIso,
            })
          }}
        </div>
        <div class="text-xs text-ink-300/70 mt-1">
          {{
            t('adminLiveOpsPreview.sectWarSummary', {
              sects: data.sectWar.status.totalSects,
              contributors: data.sectWar.status.totalContributors,
              contributions: data.sectWar.status.totalContributions,
            })
          }}
        </div>
      </section>

      <hr class="border-ink-300/20" />

      <!-- Overrides -->
      <section data-test="admin-liveops-schedule-preview-overrides">
        <div class="text-xs uppercase tracking-widest text-ink-300 mb-1">
          {{
            t('adminLiveOpsPreview.overridesHeader', {
              n: data.overrides.length,
            })
          }}
        </div>
        <div
          v-if="data.overrides.length === 0"
          class="text-xs text-ink-300/60"
          data-test="admin-liveops-schedule-preview-overrides-empty"
        >
          {{ t('adminLiveOpsPreview.overridesEmpty') }}
        </div>
        <ul v-else class="space-y-0.5 text-xs">
          <li
            v-for="ovr in data.overrides"
            :key="ovr.key"
            class="flex flex-wrap items-center gap-2 text-ink-200/90"
            data-test="admin-liveops-schedule-preview-overrides-row"
          >
            <span
              :class="ovr.enabled ? 'text-emerald-300' : 'text-rose-300'"
            >
              {{ ovr.enabled ? 'ON' : 'OFF' }}
            </span>
            <span class="font-medium">{{ ovr.key }}</span>
            <span v-if="ovr.reason" class="text-ink-300/70 italic">
              "{{ ovr.reason }}"
            </span>
            <span class="ml-auto text-ink-300/60">
              {{ ovr.updatedAt }}
            </span>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>
