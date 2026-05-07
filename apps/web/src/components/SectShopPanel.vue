<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  buySectShopEntry,
  getSectShop,
  type SectShopEntryView,
  type SectShopListView,
} from '@/api/sectShop';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

/**
 * Phase 13.1.B — Sect Shop Panel.
 *
 * - Render entries với contributionCost, dailyLimit, weeklyLimit, sectLevel gate.
 * - Buy form (qty=1 default; non-stackable enforce qty=1).
 * - Disable button khi: insufficient balance / hit limit / level lock.
 * - Toast i18n cho mọi error code (RATE_LIMITED, DAILY_LIMIT, …).
 * - emit `bought` để parent có thể re-fetch / sync mission panel.
 */

const { t } = useI18n();
const toast = useToastStore();
const emit = defineEmits<{
  (e: 'bought', payload: { contribBalance: number }): void;
}>();

const state = ref<SectShopListView | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const buyingKey = ref<string | null>(null);
const qtyByKey = ref<Record<string, number>>({});

onMounted(async () => {
  await refresh();
});

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    state.value = await getSectShop();
    for (const e of state.value.entries) {
      if (qtyByKey.value[e.key] == null) qtyByKey.value[e.key] = 1;
    }
  } catch (e) {
    error.value = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  } finally {
    loading.value = false;
  }
}

defineExpose({ refresh });

function getQty(entry: SectShopEntryView): number {
  return Math.max(1, Math.floor(qtyByKey.value[entry.key] ?? 1));
}

function setQty(entry: SectShopEntryView, raw: string | number): void {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : raw;
  qtyByKey.value[entry.key] = Number.isFinite(n) && n > 0 ? Math.min(99, Math.floor(n)) : 1;
}

function dailyRemaining(entry: SectShopEntryView): number | null {
  if (entry.dailyLimit == null) return null;
  return Math.max(0, entry.dailyLimit - entry.boughtToday);
}
function weeklyRemaining(entry: SectShopEntryView): number | null {
  if (entry.weeklyLimit == null) return null;
  return Math.max(0, entry.weeklyLimit - entry.boughtThisWeek);
}

function maxBuyableQty(entry: SectShopEntryView, balance: number): number {
  const dailyRem = dailyRemaining(entry) ?? 99;
  const weeklyRem = weeklyRemaining(entry) ?? 99;
  const byContrib =
    entry.contributionCost > 0 ? Math.floor(balance / entry.contributionCost) : 99;
  const stackCap = entry.stackable ? 99 : 1;
  return Math.max(0, Math.min(dailyRem, weeklyRem, byContrib, stackCap));
}

function buyDisabledReason(entry: SectShopEntryView): string | null {
  if (!state.value) return 'sectShop.errors.UNKNOWN';
  if (!state.value.sectId) return 'sectShop.errors.SECT_REQUIRED';
  if (
    entry.requiredSectLevel != null &&
    (state.value.sectLevel ?? 0) < entry.requiredSectLevel
  ) {
    return 'sectShop.errors.SECT_LEVEL_REQUIRED';
  }
  const qty = getQty(entry);
  if (!entry.stackable && qty > 1) return 'sectShop.errors.NON_STACKABLE_QTY_GT_1';
  const totalCost = entry.contributionCost * qty;
  if (state.value.contribBalance < totalCost) {
    return 'sectShop.errors.INSUFFICIENT_CONTRIBUTION';
  }
  const dailyRem = dailyRemaining(entry);
  if (dailyRem != null && qty > dailyRem) return 'sectShop.errors.DAILY_LIMIT';
  const weeklyRem = weeklyRemaining(entry);
  if (weeklyRem != null && qty > weeklyRem) return 'sectShop.errors.WEEKLY_LIMIT';
  return null;
}

const totalEntries = computed(() => state.value?.entries.length ?? 0);

async function onBuy(entry: SectShopEntryView): Promise<void> {
  if (buyingKey.value) return;
  const qty = getQty(entry);
  buyingKey.value = entry.key;
  try {
    const res = await buySectShopEntry(entry.key, qty);
    toast.push({
      type: 'success',
      text: t('sectShop.toast.bought', {
        item: entry.itemNameI18nKey ? t(entry.itemNameI18nKey, entry.itemKey) : entry.itemKey,
        qty,
        cost: res.totalCost,
      }),
    });
    emit('bought', { contribBalance: res.contribBalanceAfter });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
    const text = t(`sectShop.errors.${code}`, '__missing__');
    toast.push({
      type: 'error',
      text: text === '__missing__' ? t('sectShop.errors.UNKNOWN') : text,
    });
  } finally {
    buyingKey.value = null;
  }
}
</script>

<template>
  <section class="border border-ink-300/40 rounded" data-test="sect-shop-panel">
    <div
      class="px-4 py-2 text-xs uppercase tracking-widest text-ink-300 border-b border-ink-300/30 flex items-center justify-between"
    >
      <span>{{ t('sectShop.title') }}</span>
      <span v-if="state" class="text-amber-300/80 normal-case tracking-normal">
        {{ t('sectShop.balance', { balance: state.contribBalance }) }}
      </span>
    </div>

    <div v-if="loading" class="p-4 text-sm text-ink-300" data-test="sect-shop-loading">
      {{ t('sectShop.loading') }}
    </div>
    <div v-else-if="error" class="p-4 text-sm text-rose-300" data-test="sect-shop-error">
      {{ t(`sectShop.errors.${error}`, t('sectShop.errors.UNKNOWN')) }}
    </div>
    <div v-else-if="state" class="p-2 space-y-2" data-test="sect-shop-list">
      <div v-if="!state.sectId" class="px-2 py-2 text-sm text-amber-300">
        {{ t('sectShop.noSect') }}
      </div>
      <div v-else-if="totalEntries === 0" class="px-2 py-2 text-sm text-ink-300/80">
        {{ t('sectShop.empty') }}
      </div>
      <table v-else class="w-full text-sm">
        <thead class="text-xs text-ink-300/70">
          <tr>
            <th class="text-left px-2 py-1">{{ t('sectShop.col.item') }}</th>
            <th class="text-left px-2 py-1">{{ t('sectShop.col.cost') }}</th>
            <th class="text-left px-2 py-1">{{ t('sectShop.col.limit') }}</th>
            <th class="text-left px-2 py-1">{{ t('sectShop.col.qty') }}</th>
            <th class="text-left px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in state.entries"
            :key="entry.key"
            class="border-t border-ink-300/20"
            data-test="sect-shop-row"
          >
            <td class="px-2 py-2">
              <div>{{ entry.itemNameI18nKey ? t(entry.itemNameI18nKey, entry.itemKey) : entry.itemKey }}</div>
              <div class="text-xs text-ink-300/70">{{ entry.itemKey }}</div>
            </td>
            <td class="px-2 py-2 text-amber-300">
              {{ t('sectShop.cost', { n: entry.contributionCost }) }}
            </td>
            <td class="px-2 py-2 text-xs text-ink-300/80">
              <div v-if="entry.dailyLimit != null">
                {{ t('sectShop.daily', {
                  n: entry.boughtToday,
                  m: entry.dailyLimit,
                }) }}
              </div>
              <div v-if="entry.weeklyLimit != null">
                {{ t('sectShop.weekly', {
                  n: entry.boughtThisWeek,
                  m: entry.weeklyLimit,
                }) }}
              </div>
              <div v-if="entry.requiredSectLevel != null" class="text-rose-200">
                {{ t('sectShop.minLevel', { n: entry.requiredSectLevel }) }}
              </div>
            </td>
            <td class="px-2 py-2">
              <input
                type="number"
                min="1"
                max="99"
                :value="getQty(entry)"
                :disabled="!entry.stackable"
                class="w-16 bg-ink-800 border border-ink-300/30 rounded px-1 py-0.5"
                data-test="sect-shop-qty"
                @input="setQty(entry, ($event.target as HTMLInputElement).value)"
              />
              <div v-if="!entry.stackable" class="text-[10px] text-ink-300/60">
                {{ t('sectShop.nonStackable') }}
              </div>
            </td>
            <td class="px-2 py-2 text-right">
              <button
                type="button"
                class="px-3 py-1 rounded border border-amber-300/40 text-amber-200 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="buyingKey === entry.key || !!buyDisabledReason(entry)"
                :title="buyDisabledReason(entry) ? t(buyDisabledReason(entry)!) : ''"
                data-test="sect-shop-buy"
                @click="onBuy(entry)"
              >
                {{ t('sectShop.buyBtn') }}
              </button>
              <div
                v-if="buyDisabledReason(entry)"
                class="text-[10px] text-rose-300 mt-0.5"
              >
                {{ t(buyDisabledReason(entry)!) }}
              </div>
              <div
                v-else-if="state && entry.contributionCost > 0"
                class="text-[10px] text-ink-300/60 mt-0.5"
              >
                {{ t('sectShop.maxBuyable', {
                  n: maxBuyableQty(entry, state.contribBalance),
                }) }}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
