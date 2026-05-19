<script setup lang="ts">
/**
 * Market V2 Player UX Polish — Auction House + Claim Box.
 *
 * Polish from utilitarian table to card layout with:
 *   - Time remaining display with color coding
 *   - Status badges (ACTIVE/ENDED/CANCELLED/SOLD)
 *   - Role hint + cross-navigation
 *   - Better claim box with source descriptions
 *   - Enhanced empty states
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
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
import XTLuxSection from '@/components/xianxia/XTLuxSection.vue';
import XTGlyphBadge from '@/components/xianxia/XTGlyphBadge.vue';
import XTPullRefresh from '@/components/xianxia/XTPullRefresh.vue';
import MButton from '@/components/ui/MButton.vue';

const { t } = useI18n();
const toast = useToastStore();
const router = useRouter();

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

// Time remaining helper
function timeRemaining(endsAt: string): { text: string; tone: string } {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return { text: t('marketV2.timeExpired'), tone: 'text-gray-500' };
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  let time: string;
  if (days > 0) time = t('marketV2.timeDays', { n: days });
  else if (hours > 0) time = t('marketV2.timeHours', { n: hours });
  else time = t('marketV2.timeMinutes', { n: Math.max(1, minutes) });
  const tone = minutes < 15 ? 'text-red-400' : minutes < 60 ? 'text-amber-400' : 'text-emerald-400';
  return { text: t('marketV2.timeLeft', { time }), tone };
}

// Status badge helper
function statusInfo(status: string): { label: string; tone: string } {
  const map: Record<string, { label: string; tone: string }> = {
    ACTIVE: { label: t('marketV2.statusActive'), tone: 'bg-emerald-500/20 text-emerald-300' },
    ENDED: { label: t('marketV2.statusEnded'), tone: 'bg-gray-500/20 text-gray-400' },
    CANCELLED: { label: t('marketV2.statusCancelled'), tone: 'bg-red-500/20 text-red-400' },
    SOLD: { label: t('marketV2.statusSold'), tone: 'bg-amber-500/20 text-amber-300' },
  };
  return map[status] ?? { label: status, tone: 'bg-gray-500/20 text-gray-400' };
}

// Currency display
function currencyLabel(currency: string): string {
  if (currency === 'TIEN_NGOC') return t('marketV2.currencyTienNgoc');
  return t('marketV2.currencyLinhThach');
}

// Source description for claim box
function sourceLabel(source: string): string {
  const key = `marketV2.source${source}` as const;
  const translated = t(key);
  return translated !== key ? translated : t('marketV2.sourceOTHER');
}
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
            glyph="&#10022;"
          >{{ pendingCount }} {{ t('marketV2.tabClaimBox') }}</XTGlyphBadge>
        </template>
      </XTLuxHero>

      <!-- Role hint -->
      <p class="text-sm text-gray-400 px-1" data-testid="market-v2-role-hint">
        {{ t('marketV2.roleHint') }}
      </p>

      <!-- Cross-navigation -->
      <nav class="flex gap-2 text-xs" data-testid="market-v2-cross-nav">
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-market"
          @click="router.push('/market')"
        >
          <span class="text-amber-400">&#9878;</span>
          <span>{{ t('marketV2.crossNav.market') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('marketV2.crossNav.marketDesc') }}</span>
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-inventory"
          @click="router.push('/inventory')"
        >
          <span class="text-emerald-400">&#127890;</span>
          <span>{{ t('marketV2.crossNav.inventory') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('marketV2.crossNav.inventoryDesc') }}</span>
        </button>
      </nav>

      <XTPullRefresh
        :on-refresh="refresh"
        test-id="market-v2-pull-refresh"
        :pull-label="t('common.pullToRefresh')"
        :release-label="t('common.releaseToRefresh')"
        :refreshing-label="t('common.refreshing')"
      >
        <!-- Tabs -->
        <div class="flex gap-2 border-b mb-4">
          <button
            v-for="tb in (['auctions', 'claimBox'] as const)"
            :key="tb"
            class="px-4 py-2 border-b-2 transition"
            :class="tab === tb ? 'border-amber-500 font-semibold' : 'border-transparent text-gray-500 hover:text-gray-300'"
            :data-testid="`tab-${tb}`"
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
              class="border rounded px-3 py-1.5 flex-1 bg-gray-800 text-white text-sm"
              data-testid="auction-filter"
              @keyup.enter="refresh"
            />
            <MButton :disabled="loading" @click="refresh">{{ t('common.search') }}</MButton>
          </div>

          <div v-if="loading" class="text-gray-400 text-center py-8">{{ t('common.loading') }}</div>

          <div v-else-if="auctions.length === 0" class="text-center py-8" data-testid="auctions-empty">
            <p class="text-gray-500 mb-2">{{ t('marketV2.noAuctions') }}</p>
            <p class="text-gray-600 text-sm">{{ t('marketV2.emptyHint') }}</p>
          </div>

          <div v-else class="space-y-2" data-testid="auction-list">
            <div
              v-for="a in auctions"
              :key="a.id"
              class="bg-gray-800/60 rounded-lg p-3 border border-gray-700/50 hover:border-gray-600/50 transition"
              data-testid="auction-card"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="font-medium text-sm truncate">{{ a.itemKey }}</span>
                    <span class="text-xs text-gray-400">&times;{{ a.quantity }}</span>
                    <span
                      class="text-xs px-1.5 py-0.5 rounded"
                      :class="statusInfo(a.status).tone"
                    >{{ statusInfo(a.status).label }}</span>
                  </div>
                  <div class="flex items-center gap-3 text-xs text-gray-400">
                    <span>{{ t('marketV2.startPrice') }}: {{ a.startPrice }} {{ currencyLabel(a.currency) }}</span>
                    <span :class="a.currentBid ? 'text-amber-300 font-medium' : 'text-gray-500'">
                      {{ a.currentBid ? t('marketV2.bidLabel', { amount: a.currentBid }) : t('marketV2.noBid') }}
                    </span>
                  </div>
                </div>
                <div class="text-right shrink-0">
                  <span
                    v-if="a.status === 'ACTIVE'"
                    class="text-xs font-medium"
                    :class="timeRemaining(a.endsAt).tone"
                    data-testid="auction-time-remaining"
                  >{{ timeRemaining(a.endsAt).text }}</span>
                  <span v-else class="text-xs text-gray-500">{{ new Date(a.endsAt).toLocaleDateString() }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Claim Box tab -->
        <div v-if="tab === 'claimBox'">
          <div v-if="loading" class="text-gray-400 text-center py-8">{{ t('common.loading') }}</div>

          <div v-else-if="claimEntries.length === 0" class="text-center py-8" data-testid="claim-box-empty">
            <p class="text-gray-500">{{ t('marketV2.noClaimEntries') }}</p>
          </div>

          <div v-else class="space-y-2" data-testid="claim-box-list">
            <XTLuxSection
              :title="t('marketV2.tabClaimBox')"
              :badge="String(pendingCount)"
              tone="gold"
            >
              <div
                v-for="e in claimEntries"
                :key="e.id"
                class="flex items-center justify-between bg-gray-800/60 rounded-lg p-3 border border-gray-700/50"
                data-testid="claim-card"
              >
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="text-xs px-1.5 py-0.5 rounded bg-gray-700/60 text-gray-300">{{ sourceLabel(e.source) }}</span>
                    <span v-if="e.itemKey" class="text-sm text-amber-300 font-medium">{{ e.itemKey }} &times;{{ e.itemQty }}</span>
                    <span v-if="e.currency" class="text-sm text-emerald-300">{{ e.amount }} {{ currencyLabel(e.currency) }}</span>
                  </div>
                  <div v-if="e.expiresAt" class="text-xs text-gray-500">
                    {{ t('marketV2.endsAt') }}: {{ new Date(e.expiresAt).toLocaleString() }}
                  </div>
                </div>
                <MButton
                  v-if="e.status === 'PENDING'"
                  size="sm"
                  data-testid="claim-btn"
                  @click="doClaim(e.id)"
                >
                  {{ t('marketV2.claim') }}
                </MButton>
                <span v-else class="text-gray-500 text-sm">{{ e.status }}</span>
              </div>
            </XTLuxSection>
          </div>
        </div>
      </XTPullRefresh>
    </div>
  </AppShell>
</template>
