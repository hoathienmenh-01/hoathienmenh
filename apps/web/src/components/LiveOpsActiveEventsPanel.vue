<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  claimLiveOpsEventReward,
  getActiveLiveOpsEvents,
  type LiveOpsActiveEventPublicView,
} from '@/api/liveops';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

/**
 * Phase 15.3.A — Player-facing panel hiển thị LiveOps event đang ACTIVE.
 *
 * Render:
 *   - Loading state khi fetch lần đầu.
 *   - Error state khi API throw (non-fail-soft, ví dụ network).
 *   - Empty state khi không có event ACTIVE.
 *   - List events với title + description + countdown đến `endsAt`.
 *   - Multiplier label cho BOOST/DISCOUNT (vd "x1.5 boost", "30% off").
 *   - Reward summary cho FESTIVAL_GIFT (linhThach + tienNgoc + items).
 *   - Claim button cho FESTIVAL_GIFT khi `claimable=true`.
 *
 * Auto refresh mỗi 60s để countdown sync (nhẹ — payload <2KB).
 */
const { t } = useI18n();
const toast = useToastStore();

const events = ref<LiveOpsActiveEventPublicView[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const claimingKey = ref<string | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

async function refresh(): Promise<void> {
  error.value = null;
  try {
    events.value = await getActiveLiveOpsEvents();
  } catch (e) {
    error.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  refresh();
  timer = setInterval(refresh, 60_000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

const hasEvents = computed(() => events.value.length > 0);

function formatCountdown(endsAtIso: string): string {
  const ms = new Date(endsAtIso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function multiplierLabel(ev: LiveOpsActiveEventPublicView): string | null {
  const mul = ev.publicConfig.multiplier;
  if (mul === null) return null;
  // Discount types use mul ∈ [0, 0.5] meaning fraction off.
  if (ev.type === 'SHOP_DISCOUNT' || ev.type === 'SECT_SHOP_DISCOUNT') {
    const pct = Math.round(mul * 100);
    return t('liveopsActiveEvents.discountLabel', { pct });
  }
  // Boost types use mul ∈ [1.0, 2.0].
  return t('liveopsActiveEvents.boostLabel', { mul: mul.toFixed(2) });
}

function rewardSummary(ev: LiveOpsActiveEventPublicView): string | null {
  const r = ev.publicConfig.reward;
  if (!r) return null;
  const parts: string[] = [];
  if (r.linhThach > 0)
    parts.push(t('liveopsActiveEvents.rewardLinhThach', { n: r.linhThach }));
  if (r.tienNgoc > 0)
    parts.push(t('liveopsActiveEvents.rewardTienNgoc', { n: r.tienNgoc }));
  if (r.items.length > 0)
    parts.push(
      t('liveopsActiveEvents.rewardItemsCount', { n: r.items.length }),
    );
  return parts.length === 0 ? null : parts.join(' · ');
}

async function onClaim(ev: LiveOpsActiveEventPublicView): Promise<void> {
  if (claimingKey.value) return;
  if (!confirm(t('liveopsActiveEvents.confirmClaim', { title: ev.title }))) {
    return;
  }
  claimingKey.value = ev.key;
  try {
    const result = await claimLiveOpsEventReward(ev.key);
    toast.push({
      type: 'success',
      text: t('liveopsActiveEvents.toast.claimed', {
        linhThach: result.granted.linhThach,
        tienNgoc: result.granted.tienNgoc,
        items: result.granted.items.length,
      }),
    });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`liveopsActiveEvents.errors.${code}`, code),
    });
  } finally {
    claimingKey.value = null;
  }
}
</script>

<template>
  <section
    class="rounded border border-amber-300/30 bg-ink-700/30 p-3 space-y-2"
    data-testid="liveops-active-events-panel"
  >
    <header class="flex items-center justify-between gap-2">
      <h3 class="text-sm text-amber-200">
        {{ t('liveopsActiveEvents.title') }}
      </h3>
      <button
        v-if="!loading"
        type="button"
        class="text-[10px] uppercase tracking-widest text-ink-300 hover:text-amber-200"
        data-testid="liveops-active-events-refresh"
        @click="refresh"
      >
        {{ t('liveopsActiveEvents.refresh') }}
      </button>
    </header>

    <div
      v-if="loading"
      class="text-xs text-ink-300"
      data-testid="liveops-active-events-loading"
    >
      {{ t('liveopsActiveEvents.loading') }}
    </div>

    <div
      v-else-if="error"
      class="text-xs text-rose-300"
      data-testid="liveops-active-events-error"
    >
      {{ t(`liveopsActiveEvents.errors.${error}`, error) }}
    </div>

    <div
      v-else-if="!hasEvents"
      class="text-xs text-ink-300"
      data-testid="liveops-active-events-empty"
    >
      {{ t('liveopsActiveEvents.empty') }}
    </div>

    <ul v-else class="space-y-2">
      <li
        v-for="ev in events"
        :key="ev.key"
        class="rounded border border-slate-700/40 bg-ink-800/40 p-2"
        :data-testid="`liveops-active-event-${ev.key}`"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="text-sm text-amber-100 truncate">{{ ev.title }}</div>
            <div class="text-[11px] text-ink-300/80 truncate">
              {{ ev.description }}
            </div>
          </div>
          <span
            class="shrink-0 text-[10px] uppercase tracking-widest text-ink-300"
            :data-testid="`liveops-active-event-countdown-${ev.key}`"
          >
            {{ t('liveopsActiveEvents.endsIn', { time: formatCountdown(ev.endsAt) }) }}
          </span>
        </div>

        <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
          <span
            class="rounded bg-slate-700/40 px-2 py-0.5 text-ink-200"
            :data-testid="`liveops-active-event-type-${ev.key}`"
          >
            {{ ev.type }}
          </span>
          <span
            v-if="multiplierLabel(ev)"
            class="rounded bg-amber-700/40 px-2 py-0.5 text-amber-100"
            :data-testid="`liveops-active-event-multiplier-${ev.key}`"
          >
            {{ multiplierLabel(ev) }}
          </span>
          <span
            v-if="rewardSummary(ev)"
            class="rounded bg-emerald-700/40 px-2 py-0.5 text-emerald-100"
            :data-testid="`liveops-active-event-reward-${ev.key}`"
          >
            {{ rewardSummary(ev) }}
          </span>
          <span
            v-if="!ev.runtimeSupported"
            class="rounded bg-rose-700/40 px-2 py-0.5 text-rose-100"
            :data-testid="`liveops-active-event-unwired-${ev.key}`"
          >
            {{ t('liveopsActiveEvents.notWired') }}
          </span>
        </div>

        <div
          v-if="ev.type === 'FESTIVAL_GIFT'"
          class="mt-2 flex justify-end"
        >
          <button
            v-if="ev.claimable"
            type="button"
            class="px-3 py-1 text-xs rounded bg-amber-700 text-ink-50 hover:bg-amber-600 disabled:opacity-50"
            :disabled="claimingKey === ev.key"
            :data-testid="`liveops-active-event-claim-${ev.key}`"
            @click="onClaim(ev)"
          >
            {{
              claimingKey === ev.key
                ? t('liveopsActiveEvents.claiming')
                : t('liveopsActiveEvents.claimBtn')
            }}
          </button>
          <span
            v-else
            class="text-[11px] text-ink-300"
            :data-testid="`liveops-active-event-claimed-${ev.key}`"
          >
            {{ t('liveopsActiveEvents.alreadyClaimed') }}
          </span>
        </div>
      </li>
    </ul>
  </section>
</template>
