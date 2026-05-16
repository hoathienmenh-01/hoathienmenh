<script setup lang="ts">
/**
 * Phase 30.0 — Player Market V2 View (Auction House + Claim Box).
 *
 * Tabs:
 *   - Đấu giá: danh sách auction active, filter theo itemKey.
 *   - Hộp nhận: claim box entries (PENDING/CLAIMED).
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  listAuctions,
  listClaimBox,
  claimEntry,
  type MarketAuctionRow,
  type ClaimBoxRow,
} from '@/api/marketV2';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTGlyphBadge from '@/components/xianxia/XTGlyphBadge.vue';
import MButton from '@/components/ui/MButton.vue';

const { t } = useI18n();
const toast = useToastStore();

type Tab = 'auctions' | 'claimBox';
const tab = ref<Tab>('auctions');

const loading = ref(false);
const auctions = ref<MarketAuctionRow[]>([]);
const claimEntries = ref<ClaimBoxRow[]>([]);
const filterItem = ref('');

async function refresh() {
  loading.value = true;
  try {
    const [a, c] = await Promise.all([
      listAuctions(filterItem.value || undefined),
      listClaimBox('PENDING'),
    ]);
    auctions.value = a;
    claimEntries.value = c;
  } catch (e) {
    toast.push({ type: 'error', text: extractApiErrorCodeOrDefault(e, t('common.error')) });
  } finally {
    loading.value = false;
  }
}

async function doClaim(id: string) {
  try {
    await claimEntry(id);
    toast.push({ type: 'success', text: t('marketV2.claimSuccess') });
    await refresh();
  } catch (e) {
    toast.push({ type: 'error', text: extractApiErrorCodeOrDefault(e, t('common.error')) });
  }
}

onMounted(refresh);

const pendingCount = computed(() => claimEntries.value.filter((e) => e.status === 'PENDING').length);
</script>

<template>
  <AppShell>
    <div class="space-y-4 p-4">
      <XTLuxHero
        :eyebrow="t('luxHero.marketV2.eyebrow')"
        :label="t('luxHero.marketV2.label')"
        :title="t('marketV2.title')"
        :subtitle="t('luxHero.marketV2.subtitle')"
        tone="gold"
        watermark-letter="G"
        :breadcrumb="t('luxHero.marketV2.breadcrumb')"
        test-id="market-v2-hero"
      >
        <XTPageEyebrow
          caps="MA THƯƠNG LIÊN CANG"
          label="Ma Thương Liên Cang"
          class="sr-only"
        />
        <template #meta>
          <XTGlyphBadge
            v-if="pendingCount > 0"
            tone="seal"
            size="sm"
            glyph="✦"
          >{{ pendingCount }} hộp chờ</XTGlyphBadge>
        </template>
      </XTLuxHero>
      <div class="flex gap-2 border-b mb-4">
        <button
          v-for="tb in (['auctions', 'claimBox'] as const)"
          :key="tb"
          class="px-4 py-2 border-b-2"
          :class="tab === tb ? 'border-amber-500 font-semibold' : 'border-transparent text-gray-500'"
          @click="tab = tb"
        >
          {{ tb === 'auctions' ? t('marketV2.tabAuctions') : t('marketV2.tabClaimBox') }}
          <span v-if="tb === 'claimBox' && pendingCount > 0" class="ml-1 bg-red-500 text-white rounded-full px-1.5 text-xs">{{ pendingCount }}</span>
        </button>
      </div>

      <!-- Auctions tab -->
      <div v-if="tab === 'auctions'">
        <div class="flex gap-2 mb-3">
          <input
            v-model="filterItem"
            :placeholder="t('marketV2.filterItemKey')"
            class="border rounded px-2 py-1 flex-1 bg-gray-800 text-white"
            @keyup.enter="refresh"
          />
          <MButton :disabled="loading" @click="refresh">{{ t('common.search') }}</MButton>
        </div>
        <div v-if="loading" class="text-gray-400">{{ t('common.loading') }}</div>
        <table v-else class="w-full text-sm">
          <thead>
            <tr class="text-left text-gray-400">
              <th class="pr-2">{{ t('marketV2.itemKey') }}</th>
              <th>{{ t('marketV2.qty') }}</th>
              <th>{{ t('marketV2.startPrice') }}</th>
              <th>{{ t('marketV2.currentBid') }}</th>
              <th>{{ t('marketV2.endsAt') }}</th>
              <th>{{ t('marketV2.status') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in auctions" :key="a.id" class="border-t border-gray-700">
              <td class="pr-2 py-1">{{ a.itemKey }}</td>
              <td>{{ a.quantity }}</td>
              <td>{{ a.startPrice }}</td>
              <td>{{ a.currentBid ?? '—' }}</td>
              <td>{{ new Date(a.endsAt).toLocaleString() }}</td>
              <td>{{ a.status }}</td>
            </tr>
            <tr v-if="auctions.length === 0">
              <td colspan="6" class="text-gray-500 py-4 text-center">{{ t('marketV2.noAuctions') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Claim Box tab -->
      <div v-if="tab === 'claimBox'">
        <div v-if="loading" class="text-gray-400">{{ t('common.loading') }}</div>
        <div v-else class="space-y-2">
          <div
            v-for="e in claimEntries"
            :key="e.id"
            class="flex items-center justify-between bg-gray-800 rounded p-3"
          >
            <div>
              <span class="font-mono text-sm">{{ e.source }}</span>
              <span v-if="e.itemKey" class="ml-2 text-amber-300">{{ e.itemKey }} ×{{ e.itemQty }}</span>
              <span v-if="e.currency" class="ml-2 text-green-300">{{ e.currency }} {{ e.amount }}</span>
            </div>
            <MButton
              v-if="e.status === 'PENDING'"
              size="sm"
              @click="doClaim(e.id)"
            >
              {{ t('marketV2.claim') }}
            </MButton>
            <span v-else class="text-gray-500 text-sm">{{ e.status }}</span>
          </div>
          <div v-if="claimEntries.length === 0" class="text-gray-500 text-center py-4">
            {{ t('marketV2.noClaimEntries') }}
          </div>
        </div>
      </div>
    </div>
  </AppShell>
</template>
