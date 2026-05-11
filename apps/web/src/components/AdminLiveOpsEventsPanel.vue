<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  FESTIVAL_GIFT_ITEM_QTY_CAP,
  FESTIVAL_GIFT_ITEMS_MAX,
  FESTIVAL_GIFT_LINH_THACH_CAP,
  FESTIVAL_GIFT_TIEN_NGOC_CAP,
  LIVEOPS_EVENT_TYPE_CAPS,
  LIVEOPS_RUNTIME_SUPPORTED_TYPES,
  validateLiveOpsEventRewardJson,
} from '@xuantoi/shared';
import { useToastStore } from '@/stores/toast';
import {
  adminLiveOpsEventsCreate,
  adminLiveOpsEventsDisable,
  adminLiveOpsEventsList,
  adminLiveOpsEventsRecomputeStatus,
  type AdminLiveOpsEventCreateInput,
  type LiveOpsScheduledEventStatus,
  type LiveOpsScheduledEventType,
  type LiveOpsScheduledEventView,
} from '@/api/admin';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

/**
 * Phase 15.1–15.2 — Admin LiveOps Event Scheduler panel.
 *
 * Liệt kê event đã tạo (status badge + window + multiplier), cho phép admin:
 *   - Tạo event mới (key/type/title/description/startsAt/endsAt/multiplier).
 *   - Disable event đang chạy (status → DISABLED, kill switch).
 *   - Recompute status thủ công (gọi cron job force-run).
 *
 * Mọi mutation luôn yêu cầu confirm prompt + audit log ở BE
 * (`ADMIN_LIVEOPS_EVENT_*`). I18n VI/EN parity qua `adminLiveOpsEvents.*`.
 *
 * Note: shop discount type sẽ map FE multiplier 0.0–0.5 (= 0% off → 50% off).
 * Boost type (DOUBLE_DUNGEON_DROP / CULTIVATION_EXP_BOOST / DAILY_LOGIN_BONUS
 * / BOSS_REWARD_BOOST) map 1.0–2.0 (= no boost → ×2 boost). FESTIVAL_GIFT
 * cần `rewardJson` (JSON object) thay vì multiplier.
 */

const { t } = useI18n();
const toast = useToastStore();

const events = ref<LiveOpsScheduledEventView[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const submittingCreate = ref(false);
const recomputing = ref(false);
const disablingId = ref<string | null>(null);

const TYPES: ReadonlyArray<LiveOpsScheduledEventType> = [
  'DOUBLE_DUNGEON_DROP',
  'CULTIVATION_EXP_BOOST',
  'SHOP_DISCOUNT',
  'SECT_SHOP_DISCOUNT',
  'DAILY_LOGIN_BONUS',
  'BOSS_REWARD_BOOST',
  'FESTIVAL_GIFT',
];

interface RewardFormItemRow {
  itemKey: string;
  qty: number;
}

interface RewardForm {
  linhThach: number;
  tienNgoc: number;
  items: RewardFormItemRow[];
}

interface CreateForm {
  key: string;
  type: LiveOpsScheduledEventType;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  multiplier: number | null;
  rewardJson: string;
  /**
   * Phase 15.8 — 'form' = form picker (an toàn, validate field-by-field);
   * 'raw' = textarea JSON (power-user / paste from doc). Default form.
   */
  rewardMode: 'form' | 'raw';
  rewardForm: RewardForm;
  initialStatus: 'DRAFT' | 'SCHEDULED';
}

function makeEmptyRewardForm(): RewardForm {
  return { linhThach: 0, tienNgoc: 0, items: [] };
}

const form = ref<CreateForm>({
  key: '',
  type: 'DOUBLE_DUNGEON_DROP',
  title: '',
  description: '',
  startsAt: '',
  endsAt: '',
  multiplier: 1.5,
  rewardJson: '',
  rewardMode: 'form',
  rewardForm: makeEmptyRewardForm(),
  initialStatus: 'SCHEDULED',
});

/**
 * Phase 15.8 — build rewardJson object từ form picker. Empty fields bỏ
 * qua (không emit linhThach=0 / tienNgoc=0). Items với itemKey rỗng
 * bỏ qua. Trả về object được
 * `validateLiveOpsEventRewardJson` chia sẻ xác nhận.
 */
function buildRewardJsonFromForm(
  r: RewardForm,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (r.linhThach > 0) out.linhThach = Math.trunc(r.linhThach);
  if (r.tienNgoc > 0) out.tienNgoc = Math.trunc(r.tienNgoc);
  const items = r.items
    .filter((it) => it.itemKey.trim().length > 0)
    .map((it) => ({
      itemKey: it.itemKey.trim(),
      qty: Math.trunc(it.qty),
    }));
  if (items.length > 0) out.items = items;
  return out;
}

function addRewardItem(): void {
  if (form.value.rewardForm.items.length >= FESTIVAL_GIFT_ITEMS_MAX) return;
  form.value.rewardForm.items.push({ itemKey: '', qty: 1 });
}

function removeRewardItem(index: number): void {
  form.value.rewardForm.items.splice(index, 1);
}

const rewardFormPreview = computed(() => {
  try {
    return JSON.stringify(
      buildRewardJsonFromForm(form.value.rewardForm),
      null,
      2,
    );
  } catch {
    return '{}';
  }
});

const REWARD_CAPS = {
  linhThach: FESTIVAL_GIFT_LINH_THACH_CAP,
  tienNgoc: FESTIVAL_GIFT_TIEN_NGOC_CAP,
  itemsMax: FESTIVAL_GIFT_ITEMS_MAX,
  itemQty: FESTIVAL_GIFT_ITEM_QTY_CAP,
} as const;

const isFestival = computed(() => form.value.type === 'FESTIVAL_GIFT');

const typeCap = computed(() => LIVEOPS_EVENT_TYPE_CAPS[form.value.type]);

const multiplierMin = computed(() => typeCap.value.multiplierMin);
const multiplierMax = computed(() => typeCap.value.multiplierMax);

const formTypeRuntimeSupported = computed(
  () => LIVEOPS_RUNTIME_SUPPORTED_TYPES[form.value.type] === true,
);

function isRuntimeSupportedType(eventType: LiveOpsScheduledEventType): boolean {
  return LIVEOPS_RUNTIME_SUPPORTED_TYPES[eventType] === true;
}

onMounted(async () => {
  await refresh();
});

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    events.value = await adminLiveOpsEventsList();
  } catch (e) {
    error.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.value = false;
  }
}

function badgeClass(status: LiveOpsScheduledEventStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-emerald-700/40 text-emerald-200';
    case 'SCHEDULED':
      return 'bg-amber-700/40 text-amber-200';
    case 'ENDED':
      return 'bg-slate-700/40 text-slate-300';
    case 'DISABLED':
      return 'bg-rose-700/40 text-rose-200';
    case 'DRAFT':
    default:
      return 'bg-slate-700/40 text-slate-200';
  }
}

function formatJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

async function onCreate(): Promise<void> {
  if (submittingCreate.value) return;
  if (!form.value.key.trim() || !form.value.title.trim()) {
    toast.push({ type: 'error', text: t('adminLiveOpsEvents.errors.INVALID_INPUT') });
    return;
  }
  if (!form.value.startsAt || !form.value.endsAt) {
    toast.push({ type: 'error', text: t('adminLiveOpsEvents.errors.INVALID_INPUT') });
    return;
  }
  if (!confirm(t('adminLiveOpsEvents.confirmCreate', { key: form.value.key }))) {
    return;
  }
  submittingCreate.value = true;
  try {
    const startsAtIso = new Date(form.value.startsAt).toISOString();
    const endsAtIso = new Date(form.value.endsAt).toISOString();

    const config: AdminLiveOpsEventCreateInput['configJson'] = {};
    if (isFestival.value) {
      let parsed: Record<string, unknown>;
      if (form.value.rewardMode === 'form') {
        parsed = buildRewardJsonFromForm(form.value.rewardForm);
      } else {
        if (form.value.rewardJson.trim().length === 0) {
          toast.push({
            type: 'error',
            text: t('adminLiveOpsEvents.errors.INVALID_INPUT'),
          });
          submittingCreate.value = false;
          return;
        }
        try {
          parsed = JSON.parse(form.value.rewardJson) as Record<string, unknown>;
        } catch {
          toast.push({
            type: 'error',
            text: t('adminLiveOpsEvents.errors.INVALID_INPUT'),
          });
          submittingCreate.value = false;
          return;
        }
      }
      // Phase 15.3.A — mirror shared validation FE-side để báo lỗi sớm
      // (BE vẫn validate lại — defense-in-depth).
      const code = validateLiveOpsEventRewardJson(parsed);
      if (code) {
        toast.push({
          type: 'error',
          text: t(`adminLiveOpsEvents.errors.${code}`, code),
        });
        submittingCreate.value = false;
        return;
      }
      config.rewardJson = parsed;
    } else if (typeof form.value.multiplier === 'number') {
      // Phase 15.3.A — clamp range mirror shared cap để BE không 400 oan.
      const cap = typeCap.value;
      if (
        form.value.multiplier < cap.multiplierMin ||
        form.value.multiplier > cap.multiplierMax
      ) {
        toast.push({
          type: 'error',
          text: t('adminLiveOpsEvents.errors.MULTIPLIER_OUT_OF_RANGE'),
        });
        submittingCreate.value = false;
        return;
      }
      config.multiplier = form.value.multiplier;
    }

    await adminLiveOpsEventsCreate({
      key: form.value.key.trim(),
      type: form.value.type,
      title: form.value.title.trim(),
      description: form.value.description.trim() || undefined,
      startsAt: startsAtIso,
      endsAt: endsAtIso,
      configJson: Object.keys(config).length > 0 ? config : undefined,
      initialStatus: form.value.initialStatus,
    });
    toast.push({ type: 'success', text: t('adminLiveOpsEvents.toast.created') });
    form.value.key = '';
    form.value.title = '';
    form.value.description = '';
    form.value.rewardJson = '';
    form.value.rewardForm = makeEmptyRewardForm();
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: t(`adminLiveOpsEvents.errors.${code}`, code) });
  } finally {
    submittingCreate.value = false;
  }
}

async function onDisable(ev: LiveOpsScheduledEventView): Promise<void> {
  if (disablingId.value) return;
  if (!confirm(t('adminLiveOpsEvents.confirmDisable', { key: ev.key }))) return;
  disablingId.value = ev.id;
  try {
    await adminLiveOpsEventsDisable(ev.id);
    toast.push({ type: 'success', text: t('adminLiveOpsEvents.toast.disabled') });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: t(`adminLiveOpsEvents.errors.${code}`, code) });
  } finally {
    disablingId.value = null;
  }
}

async function onRecompute(): Promise<void> {
  if (recomputing.value) return;
  if (!confirm(t('adminLiveOpsEvents.confirmRecompute'))) return;
  recomputing.value = true;
  try {
    const r = await adminLiveOpsEventsRecomputeStatus();
    toast.push({
      type: 'success',
      text: t('adminLiveOpsEvents.toast.recomputed', {
        activated: r.toActivated,
        ended: r.toEnded,
      }),
    });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    toast.push({ type: 'error', text: t(`adminLiveOpsEvents.errors.${code}`, code) });
  } finally {
    recomputing.value = false;
  }
}
</script>

<template>
  <section class="rounded border border-slate-700/40 p-4 space-y-3" data-testid="admin-liveops-events-panel">
    <header class="flex items-center justify-between gap-2">
      <h3 class="text-base text-amber-200">{{ t('adminLiveOpsEvents.title') }}</h3>
      <button
        type="button"
        class="px-3 py-1 text-xs rounded bg-slate-700 text-ink-50 hover:bg-slate-600 disabled:opacity-50"
        :disabled="recomputing"
        data-testid="admin-liveops-events-recompute"
        @click="onRecompute"
      >
        {{ recomputing ? t('adminLiveOpsEvents.recomputing') : t('adminLiveOpsEvents.recomputeBtn') }}
      </button>
    </header>

    <p class="text-xs text-ink-300">{{ t('adminLiveOpsEvents.help') }}</p>

    <p
      class="text-[10px] text-ink-300"
      data-testid="admin-liveops-events-runtime-legend"
    >
      {{ t('adminLiveOpsEvents.runtimeLegend') }}
    </p>

    <div v-if="loading" class="text-xs text-ink-300">{{ t('adminLiveOpsEvents.loading') }}</div>
    <div v-else-if="error" class="text-xs text-rose-300">
      {{ t(`adminLiveOpsEvents.errors.${error}`, error) }}
    </div>

    <div v-else class="space-y-2">
      <div v-if="events.length === 0" class="text-xs text-ink-300" data-testid="admin-liveops-events-empty">
        {{ t('adminLiveOpsEvents.empty') }}
      </div>
      <table v-else class="w-full text-xs min-w-[700px]" data-testid="admin-liveops-events-table">
        <thead>
          <tr class="text-ink-300 text-left">
            <th class="py-1 pr-2">{{ t('adminLiveOpsEvents.col.key') }}</th>
            <th class="py-1 pr-2">{{ t('adminLiveOpsEvents.col.type') }}</th>
            <th class="py-1 pr-2">{{ t('adminLiveOpsEvents.col.status') }}</th>
            <th class="py-1 pr-2">{{ t('adminLiveOpsEvents.col.window') }}</th>
            <th class="py-1 pr-2">{{ t('adminLiveOpsEvents.col.config') }}</th>
            <th class="py-1 pr-2 text-right">{{ t('adminLiveOpsEvents.col.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="ev in events"
            :key="ev.id"
            class="border-t border-slate-700/40"
            :data-testid="`admin-liveops-event-row-${ev.key}`"
          >
            <td class="py-1 pr-2 text-ink-50">
              <div>{{ ev.key }}</div>
              <div class="text-ink-300 text-[10px]">{{ ev.title }}</div>
            </td>
            <td class="py-1 pr-2">
              <div class="flex flex-col gap-0.5">
                <span>{{ ev.type }}</span>
                <span
                  v-if="isRuntimeSupportedType(ev.type)"
                  class="text-[9px] uppercase tracking-widest text-emerald-300"
                  :data-testid="`admin-liveops-event-runtime-${ev.key}`"
                >
                  {{ t('adminLiveOpsEvents.runtimeWired') }}
                </span>
                <span
                  v-else
                  class="text-[9px] uppercase tracking-widest text-rose-300"
                  :data-testid="`admin-liveops-event-runtime-${ev.key}`"
                >
                  {{ t('adminLiveOpsEvents.runtimeNotWired') }}
                </span>
              </div>
            </td>
            <td class="py-1 pr-2">
              <span
                class="px-2 py-0.5 rounded text-[10px]"
                :class="badgeClass(ev.status)"
                :data-testid="`admin-liveops-event-status-${ev.key}`"
              >
                {{ ev.status }}
              </span>
            </td>
            <td class="py-1 pr-2 text-ink-300 text-[10px]">
              <div>{{ new Date(ev.startsAt).toLocaleString() }}</div>
              <div>→ {{ new Date(ev.endsAt).toLocaleString() }}</div>
            </td>
            <td class="py-1 pr-2 text-ink-300">
              <pre class="text-[10px] whitespace-pre-wrap max-w-[180px]">{{ formatJson(ev.configJson) }}</pre>
            </td>
            <td class="py-1 pr-2 text-right">
              <button
                v-if="ev.status !== 'DISABLED' && ev.status !== 'ENDED'"
                type="button"
                class="px-2 py-1 text-[11px] rounded bg-rose-700 text-ink-50 hover:bg-rose-600 disabled:opacity-50"
                :disabled="disablingId === ev.id"
                :data-testid="`admin-liveops-event-disable-${ev.key}`"
                @click="onDisable(ev)"
              >
                {{ disablingId === ev.id ? t('adminLiveOpsEvents.disabling') : t('adminLiveOpsEvents.disableBtn') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <form
        class="grid gap-2 mt-4 border-t border-slate-700/40 pt-3"
        data-testid="admin-liveops-events-form"
        @submit.prevent="onCreate"
      >
        <h4 class="text-sm text-amber-200">{{ t('adminLiveOpsEvents.form.title') }}</h4>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
          <label class="text-xs text-ink-300 flex flex-col gap-1">
            {{ t('adminLiveOpsEvents.form.key') }}
            <input
              v-model="form.key"
              type="text"
              class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-ink-50"
              :placeholder="t('adminLiveOpsEvents.form.keyPlaceholder')"
              data-testid="admin-liveops-events-form-key"
              required
            />
          </label>
          <label class="text-xs text-ink-300 flex flex-col gap-1">
            {{ t('adminLiveOpsEvents.form.type') }}
            <select
              v-model="form.type"
              class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-ink-50"
              data-testid="admin-liveops-events-form-type"
            >
              <option v-for="ty in TYPES" :key="ty" :value="ty">
                {{ ty }}{{ isRuntimeSupportedType(ty) ? '' : ' (not wired)' }}
              </option>
            </select>
          </label>
          <label class="text-xs text-ink-300 flex flex-col gap-1 md:col-span-2">
            {{ t('adminLiveOpsEvents.form.titleField') }}
            <input
              v-model="form.title"
              type="text"
              class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-ink-50"
              data-testid="admin-liveops-events-form-title"
              required
            />
          </label>
          <label class="text-xs text-ink-300 flex flex-col gap-1 md:col-span-2">
            {{ t('adminLiveOpsEvents.form.description') }}
            <textarea
              v-model="form.description"
              rows="2"
              class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-ink-50"
              data-testid="admin-liveops-events-form-description"
            />
          </label>
          <label class="text-xs text-ink-300 flex flex-col gap-1">
            {{ t('adminLiveOpsEvents.form.startsAt') }}
            <input
              v-model="form.startsAt"
              type="datetime-local"
              class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-ink-50"
              data-testid="admin-liveops-events-form-starts-at"
              required
            />
          </label>
          <label class="text-xs text-ink-300 flex flex-col gap-1">
            {{ t('adminLiveOpsEvents.form.endsAt') }}
            <input
              v-model="form.endsAt"
              type="datetime-local"
              class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-ink-50"
              data-testid="admin-liveops-events-form-ends-at"
              required
            />
          </label>
          <label v-if="!isFestival" class="text-xs text-ink-300 flex flex-col gap-1">
            {{
              t('adminLiveOpsEvents.form.multiplierWithCap', {
                min: multiplierMin,
                max: multiplierMax,
              })
            }}
            <input
              v-model.number="form.multiplier"
              type="number"
              step="0.05"
              :min="multiplierMin"
              :max="multiplierMax"
              class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-ink-50"
              data-testid="admin-liveops-events-form-multiplier"
            />
            <span
              v-if="!formTypeRuntimeSupported"
              class="text-[10px] text-rose-300"
              data-testid="admin-liveops-events-form-runtime-warn"
            >
              {{ t('adminLiveOpsEvents.form.runtimeNotWiredWarn') }}
            </span>
          </label>
          <div v-else class="md:col-span-2 flex flex-col gap-2">
            <div class="flex items-center gap-3 text-xs text-ink-300">
              <span>{{ t('adminLiveOpsEvents.form.rewardMode') }}</span>
              <label class="inline-flex items-center gap-1">
                <input
                  type="radio"
                  value="form"
                  v-model="form.rewardMode"
                  data-testid="admin-liveops-events-form-reward-mode-form"
                />
                {{ t('adminLiveOpsEvents.form.rewardModeForm') }}
              </label>
              <label class="inline-flex items-center gap-1">
                <input
                  type="radio"
                  value="raw"
                  v-model="form.rewardMode"
                  data-testid="admin-liveops-events-form-reward-mode-raw"
                />
                {{ t('adminLiveOpsEvents.form.rewardModeRaw') }}
              </label>
            </div>

            <div
              v-if="form.rewardMode === 'form'"
              class="rounded border border-slate-700/40 p-2 flex flex-col gap-2"
              data-testid="admin-liveops-events-form-reward-picker"
            >
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                <label class="text-xs text-ink-300 flex flex-col gap-1">
                  {{ t('adminLiveOpsEvents.form.linhThachWithCap', { cap: REWARD_CAPS.linhThach }) }}
                  <input
                    v-model.number="form.rewardForm.linhThach"
                    type="number"
                    min="0"
                    :max="REWARD_CAPS.linhThach"
                    step="1"
                    class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-ink-50"
                    data-testid="admin-liveops-events-form-reward-linhthach"
                  />
                </label>
                <label class="text-xs text-ink-300 flex flex-col gap-1">
                  {{ t('adminLiveOpsEvents.form.tienNgocWithCap', { cap: REWARD_CAPS.tienNgoc }) }}
                  <input
                    v-model.number="form.rewardForm.tienNgoc"
                    type="number"
                    min="0"
                    :max="REWARD_CAPS.tienNgoc"
                    step="1"
                    class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-ink-50"
                    data-testid="admin-liveops-events-form-reward-tienngoc"
                  />
                </label>
              </div>
              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between text-xs text-ink-300">
                  <span>
                    {{ t('adminLiveOpsEvents.form.rewardItemsWithCap', { cap: REWARD_CAPS.itemsMax }) }}
                  </span>
                  <button
                    type="button"
                    class="px-2 py-1 text-[11px] rounded bg-slate-700 text-ink-50 hover:bg-slate-600 disabled:opacity-50"
                    :disabled="form.rewardForm.items.length >= REWARD_CAPS.itemsMax"
                    data-testid="admin-liveops-events-form-reward-add-item"
                    @click="addRewardItem"
                  >
                    {{ t('adminLiveOpsEvents.form.rewardAddItem') }}
                  </button>
                </div>
                <div
                  v-for="(it, i) in form.rewardForm.items"
                  :key="`reward-item-${i}`"
                  class="grid grid-cols-[1fr_auto_auto] gap-2"
                  :data-testid="`admin-liveops-events-form-reward-item-${i}`"
                >
                  <input
                    v-model="it.itemKey"
                    type="text"
                    class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-ink-50 text-xs"
                    :placeholder="t('adminLiveOpsEvents.form.rewardItemKey')"
                    :data-testid="`admin-liveops-events-form-reward-item-key-${i}`"
                  />
                  <input
                    v-model.number="it.qty"
                    type="number"
                    min="1"
                    :max="REWARD_CAPS.itemQty"
                    step="1"
                    class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-ink-50 text-xs w-24"
                    :data-testid="`admin-liveops-events-form-reward-item-qty-${i}`"
                  />
                  <button
                    type="button"
                    class="px-2 py-1 text-[11px] rounded bg-rose-700 text-ink-50 hover:bg-rose-600"
                    :data-testid="`admin-liveops-events-form-reward-item-remove-${i}`"
                    @click="removeRewardItem(i)"
                  >
                    {{ t('adminLiveOpsEvents.form.rewardRemoveItem') }}
                  </button>
                </div>
              </div>
              <div class="text-[10px] text-ink-300 flex flex-col gap-1">
                <span>{{ t('adminLiveOpsEvents.form.rewardPreview') }}</span>
                <pre
                  class="font-mono whitespace-pre-wrap bg-slate-900/40 border border-slate-700/40 rounded p-2"
                  data-testid="admin-liveops-events-form-reward-preview"
                >{{ rewardFormPreview }}</pre>
              </div>
            </div>

            <label
              v-else
              class="text-xs text-ink-300 flex flex-col gap-1"
            >
              {{ t('adminLiveOpsEvents.form.rewardJson') }}
              <textarea
                v-model="form.rewardJson"
                rows="4"
                class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-ink-50 font-mono text-[11px]"
                :placeholder="`{&quot;linhThach&quot;: 100, &quot;tienNgoc&quot;: 5, &quot;items&quot;: [{&quot;itemKey&quot;: &quot;...&quot;, &quot;qty&quot;: 1}]}`"
                data-testid="admin-liveops-events-form-reward-json"
              />
              <span class="text-[10px] text-ink-300">
                {{ t('adminLiveOpsEvents.form.rewardJsonHelp') }}
              </span>
            </label>
          </div>
          <label class="text-xs text-ink-300 flex flex-col gap-1">
            {{ t('adminLiveOpsEvents.form.initialStatus') }}
            <select
              v-model="form.initialStatus"
              class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-ink-50"
              data-testid="admin-liveops-events-form-initial-status"
            >
              <option value="DRAFT">DRAFT</option>
              <option value="SCHEDULED">SCHEDULED</option>
            </select>
          </label>
        </div>
        <div class="flex justify-end">
          <button
            type="submit"
            class="px-3 py-1 text-xs rounded bg-amber-700 text-ink-50 hover:bg-amber-600 disabled:opacity-50"
            :disabled="submittingCreate"
            data-testid="admin-liveops-events-form-submit"
          >
            {{ submittingCreate ? t('adminLiveOpsEvents.form.submitting') : t('adminLiveOpsEvents.form.submitBtn') }}
          </button>
        </div>
      </form>
    </div>
  </section>
</template>
