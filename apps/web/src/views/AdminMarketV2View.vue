<script setup lang="ts">
/**
 * Phase 30.0 — Admin Market V2 View.
 *
 * - Auctions list (status filter), cancel với reason → audit log.
 * - Finalize expired (cron-style trigger).
 * - Refund flow (deposit vào claim box player).
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  adminListAuctions,
  adminCancelAuction,
  adminFinalizeExpired,
  adminRefundClaim,
  type MarketAuctionRow,
} from '@/api/marketV2';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import AppShell from '@/components/shell/AppShell.vue';
import MButton from '@/components/ui/MButton.vue';

const { t } = useI18n();
const toast = useToastStore();

const loading = ref(false);
const auctions = ref<MarketAuctionRow[]>([]);
const statusFilter = ref<'ACTIVE' | 'FINALIZED' | 'CANCELLED' | 'EXPIRED' | ''>('ACTIVE');

const refundForm = ref({
  characterId: '',
  itemKey: '',
  itemQty: 0,
  currency: '',
  amount: '',
  reason: '',
});

async function refresh() {
  loading.value = true;
  try {
    auctions.value = await adminListAuctions({
      status: statusFilter.value || undefined,
      limit: 100,
    });
  } catch (e) {
    toast.push({ type: 'error', text: extractApiErrorCodeOrDefault(e, t('common.error')) });
  } finally {
    loading.value = false;
  }
}

async function cancelOne(id: string) {
  const reason = window.prompt(t('adminMarket.cancelReasonPrompt')) ?? '';
  if (reason.length < 3) return;
  try {
    await adminCancelAuction(id, reason);
    toast.push({ type: 'success', text: t('adminMarket.cancelSuccess') });
    await refresh();
  } catch (e) {
    toast.push({ type: 'error', text: extractApiErrorCodeOrDefault(e, t('common.error')) });
  }
}

async function doFinalize() {
  try {
    const r = await adminFinalizeExpired();
    toast.push({ type: 'success', text: t('adminMarket.finalizedCount', { n: r.finalized, total: r.candidates }) });
    await refresh();
  } catch (e) {
    toast.push({ type: 'error', text: extractApiErrorCodeOrDefault(e, t('common.error')) });
  }
}

async function submitRefund() {
  try {
    await adminRefundClaim({
      characterId: refundForm.value.characterId,
      itemKey: refundForm.value.itemKey || undefined,
      itemQty: refundForm.value.itemQty || undefined,
      currency: refundForm.value.currency || undefined,
      amount: refundForm.value.amount ? Number(refundForm.value.amount) : undefined,
      reason: refundForm.value.reason,
    });
    toast.push({ type: 'success', text: t('adminMarket.refundSuccess') });
    refundForm.value = { characterId: '', itemKey: '', itemQty: 0, currency: '', amount: '', reason: '' };
  } catch (e) {
    toast.push({ type: 'error', text: extractApiErrorCodeOrDefault(e, t('common.error')) });
  }
}

onMounted(refresh);
</script>

<template>
  <AppShell>
    <div class="space-y-4 p-4">
      <h1 class="text-xl font-bold">{{ t('adminMarket.title') }}</h1>

      <div class="flex items-center gap-2">
        <select v-model="statusFilter" class="bg-gray-800 text-white rounded px-2 py-1" @change="refresh">
          <option value="">{{ t('common.all') }}</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="FINALIZED">FINALIZED</option>
          <option value="CANCELLED">CANCELLED</option>
          <option value="EXPIRED">EXPIRED</option>
        </select>
        <MButton :disabled="loading" @click="refresh">{{ t('common.refresh') }}</MButton>
        <MButton variant="secondary" @click="doFinalize">{{ t('adminMarket.finalizeExpired') }}</MButton>
      </div>

      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-gray-400">
            <th>{{ t('marketV2.itemKey') }}</th>
            <th>{{ t('marketV2.qty') }}</th>
            <th>{{ t('marketV2.currentBid') }}</th>
            <th>{{ t('marketV2.status') }}</th>
            <th>{{ t('common.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in auctions" :key="a.id" class="border-t border-gray-700">
            <td class="py-1">{{ a.itemKey }}</td>
            <td>{{ a.quantity }}</td>
            <td>{{ a.currentBid ?? '—' }}</td>
            <td>{{ a.status }}</td>
            <td>
              <MButton v-if="a.status === 'ACTIVE'" size="sm" variant="secondary" @click="cancelOne(a.id)">
                {{ t('adminMarket.cancel') }}
              </MButton>
            </td>
          </tr>
          <tr v-if="auctions.length === 0">
            <td colspan="5" class="text-gray-500 text-center py-4">{{ t('marketV2.noAuctions') }}</td>
          </tr>
        </tbody>
      </table>

      <!-- Refund form -->
      <div class="border-t border-gray-700 pt-4 mt-4 space-y-2">
        <h2 class="font-semibold">{{ t('adminMarket.refundTitle') }}</h2>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <input v-model="refundForm.characterId" :placeholder="t('adminMarket.characterId')" class="bg-gray-800 rounded px-2 py-1" />
          <input v-model="refundForm.itemKey" :placeholder="t('adminMarket.itemKey')" class="bg-gray-800 rounded px-2 py-1" />
          <input v-model.number="refundForm.itemQty" :placeholder="t('adminMarket.itemQty')" type="number" class="bg-gray-800 rounded px-2 py-1" />
          <select v-model="refundForm.currency" class="bg-gray-800 rounded px-2 py-1">
            <option value="">{{ t('adminMarket.selectCurrency') }}</option>
            <option value="LINH_THACH">LINH_THACH</option>
            <option value="TIEN_NGOC_KHOA">TIEN_NGOC_KHOA</option>
            <option value="EVENT_TOKEN">EVENT_TOKEN</option>
            <option value="CONG_HIEN_TONG_MON">CONG_HIEN_TONG_MON</option>
          </select>
          <input v-model="refundForm.amount" :placeholder="t('adminMarket.amount')" class="bg-gray-800 rounded px-2 py-1" />
          <input v-model="refundForm.reason" :placeholder="t('adminMarket.reason')" class="bg-gray-800 rounded px-2 py-1" />
        </div>
        <MButton @click="submitRefund">{{ t('adminMarket.refund') }}</MButton>
      </div>
    </div>
  </AppShell>
</template>
