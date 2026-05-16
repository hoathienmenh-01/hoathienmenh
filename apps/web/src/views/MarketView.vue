<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  QUALITY_COLOR,
  type ItemKind,
  getMarketPriceBandForItem,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import {
  buyListing,
  cancelListing,
  listMarket,
  listMine,
  postListing,
  type ListingView,
} from '@/api/market';
import { listInventory, type InventoryView } from '@/api/inventory';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTSealFrame from '@/components/xianxia/XTSealFrame.vue';
import MButton from '@/components/ui/MButton.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import SkeletonBlock from '@/components/ui/SkeletonBlock.vue';
import SkeletonTable from '@/components/ui/SkeletonTable.vue';

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const tab = ref<'buy' | 'sell'>('buy');
const submitting = ref(false);
const loading = ref(true);

const buyListings = ref<ListingView[]>([]);
const myListings = ref<ListingView[]>([]);
const inventory = ref<InventoryView[]>([]);
const feePct = ref(0.05);
const filterKind = ref<ItemKind | ''>('');

const KIND_KEYS: ItemKind[] = ['WEAPON', 'ARMOR', 'PILL_HP', 'PILL_MP', 'PILL_EXP', 'ORE', 'MISC'];
function kindLabel(k: ItemKind): string {
  return t(`itemKind.${k}`);
}

// Form đăng bán
const sellInvId = ref<string>('');
const sellQty = ref<number>(1);
const sellPrice = ref<string>('100');

const selectedInv = computed(() =>
  inventory.value.find((i) => i.id === sellInvId.value) ?? null,
);

const sellableInventory = computed(() =>
  inventory.value.filter((i) => !i.equippedSlot && i.qty > 0),
);

// Phase 16.6 — Market price band hint cho item đang chọn bán.
const priceBand = computed(() => {
  const inv = selectedInv.value;
  if (!inv) return null;
  return getMarketPriceBandForItem(inv.item.key);
});

const priceBandHint = computed(() => {
  const band = priceBand.value;
  if (!band) return '';
  return t('market.priceBandHint', {
    min: band.minPrice.toString(),
    max: band.maxPrice.toString(),
  });
});

const totalSell = computed(() => {
  if (!selectedInv.value) return '0';
  try {
    const p = BigInt(sellPrice.value || '0');
    return (p * BigInt(sellQty.value || 0)).toString();
  } catch {
    return '0';
  }
});

const feeNote = computed(() => {
  if (totalSell.value === '0') return '';
  try {
    const tot = BigInt(totalSell.value);
    const f = (tot * BigInt(Math.round(feePct.value * 1000))) / 1000n;
    return t('market.fee', { fee: f.toString(), net: (tot - f).toString() });
  } catch {
    return '';
  }
});

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  await refreshAll();
  loading.value = false;
});

async function refreshAll(): Promise<void> {
  try {
    const [m, mine, inv] = await Promise.all([
      listMarket(filterKind.value || undefined),
      listMine(),
      listInventory(),
    ]);
    buyListings.value = m.listings;
    feePct.value = m.feePct;
    myListings.value = mine;
    inventory.value = inv;
  } catch (e) {
    handleErr(e);
  }
}

async function onBuy(l: ListingView): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  try {
    await buyListing(l.id);
    toast.push({
      type: 'success',
      text: t('market.buyToast', {
        name: l.item.name,
        qty: l.qty,
        price: l.totalPrice,
      }),
    });
    await refreshAll();
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

async function onCancel(l: ListingView): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  try {
    await cancelListing(l.id);
    toast.push({ type: 'system', text: t('market.cancelToast') });
    await refreshAll();
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

async function onPost(): Promise<void> {
  if (!selectedInv.value || submitting.value) return;
  submitting.value = true;
  try {
    await postListing(sellInvId.value, sellQty.value, sellPrice.value);
    toast.push({ type: 'success', text: t('market.postToast') });
    sellInvId.value = '';
    sellQty.value = 1;
    sellPrice.value = '100';
    await refreshAll();
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

function handleErr(e: unknown): void {
  const code = extractApiErrorCodeOrDefault(e, 'UNKNOWN');
  const text = t(`market.errors.${code}`, '__missing__');
  toast.push({
    type: 'error',
    text: text === '__missing__' ? t('market.errors.UNKNOWN') : text,
  });
}
</script>

<template>
  <AppShell>
    <XTSealFrame
      tone="gold"
      corner-ornaments="❀❦❀❦"
      watermark-letter="G"
      rounded="xl"
      inset="tight"
      test-id="market-view-seal-frame"
      aria-label="Thiên Hạnh Thương Phố hero frame"
      class="mb-4"
    >
      <XTPageEyebrow caps="THIÊN HẠNH THƯƠNG PHỐ" label="Thiên Hạnh Thương Phố" />
      <h2 class="text-xl tracking-widest mt-1">{{ t('market.title') }}</h2>
    </XTSealFrame>

    <div class="flex gap-2 mb-4">
      <MButton :class="tab === 'buy' ? '!bg-ink-50 !text-ink-900' : ''" @click="tab = 'buy'">
        {{ t('market.tab.buy') }}
      </MButton>
      <MButton :class="tab === 'sell' ? '!bg-ink-50 !text-ink-900' : ''" @click="tab = 'sell'">
        {{ t('market.tab.sell') }}
      </MButton>
      <span class="ml-auto text-xs text-ink-300 self-center">
        {{ t('market.feeNote', { pct: Math.round(feePct * 100) }) }}
      </span>
    </div>

    <!-- Tab Mua -->
    <section v-if="tab === 'buy'" class="space-y-3">
      <div class="flex items-center gap-2 text-sm">
        <label class="text-ink-300">{{ t('market.filter') }}</label>
        <select
          v-model="filterKind"
          class="bg-ink-700 border border-ink-300/40 rounded px-2 py-1 text-sm"
          @change="refreshAll"
        >
          <option value="">{{ t('common.all') }}</option>
          <option v-for="k in KIND_KEYS" :key="k" :value="k">
            {{ kindLabel(k) }}
          </option>
        </select>
      </div>

      <SkeletonTable
        v-if="loading"
        :rows="6"
        :cols="4"
        test-id="market-buy-skeleton"
      />
      <div v-else-if="buyListings.length === 0" class="text-ink-300 italic">
        {{ t('market.noListings') }}
      </div>
      <div
        v-for="l in (loading ? [] : buyListings)"
        :key="l.id"
        class="rounded border border-ink-300/40 bg-ink-700/30 p-3 flex items-center gap-3"
      >
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-bold" :class="QUALITY_COLOR[l.item.quality]">
              {{ l.item.name }}
            </span>
            <span class="text-[10px] text-ink-300">
              {{ t('quality.' + l.item.quality) }} · ×{{ l.qty }}
            </span>
          </div>
          <p class="text-xs text-ink-300">{{ l.item.description }}</p>
          <p class="text-xs">
            {{ t('market.sellerPosted', { name: l.sellerName }) }}
          </p>
        </div>
        <div class="text-right">
          <div class="text-amber-300 font-bold text-sm">
            {{ l.totalPrice }} <span class="text-[10px]">⛀</span>
          </div>
          <div class="text-[10px] text-ink-300">{{ t('market.perUnit', { price: l.pricePerUnit }) }}</div>
          <MButton
            v-if="!l.isMine"
            class="mt-1 !px-2 !py-0.5 text-xs"
            :loading="submitting"
            @click="onBuy(l)"
          >
            {{ t('market.buy') }}
          </MButton>
          <span v-else class="text-[10px] text-ink-300/60 italic">{{ t('market.yours') }}</span>
        </div>
      </div>
    </section>

    <!-- Tab Bán -->
    <section v-if="tab === 'sell'" class="space-y-4">
      <!-- Form đăng bán -->
      <div class="rounded border border-ink-300/40 bg-ink-700/30 p-4 space-y-3">
        <h3 class="text-base font-bold">{{ t('market.newListingTitle') }}</h3>
        <div class="grid sm:grid-cols-3 gap-3">
          <label class="text-sm">
            <span class="block text-ink-300 mb-1">{{ t('market.item') }}</span>
            <select
              v-model="sellInvId"
              class="bg-ink-700 border border-ink-300/40 rounded px-2 py-1 w-full"
            >
              <option value="">{{ t('market.chooseItem') }}</option>
              <option v-for="i in sellableInventory" :key="i.id" :value="i.id">
                {{ i.item.name }} (×{{ i.qty }})
              </option>
            </select>
          </label>
          <label class="text-sm">
            <span class="block text-ink-300 mb-1">{{ t('market.qty') }}</span>
            <input
              v-model.number="sellQty"
              type="number"
              min="1"
              :max="selectedInv?.qty ?? 1"
              class="bg-ink-700 border border-ink-300/40 rounded px-2 py-1 w-full"
            />
          </label>
          <label class="text-sm">
            <span class="block text-ink-300 mb-1">{{ t('market.price') }}</span>
            <input
              v-model="sellPrice"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              class="bg-ink-700 border border-ink-300/40 rounded px-2 py-1 w-full"
            />
            <span
              v-if="priceBandHint"
              class="block text-[10px] text-ink-300 mt-1"
              data-testid="market-price-band-hint"
            >
              {{ priceBandHint }}
            </span>
          </label>
        </div>
        <div class="text-xs text-ink-300">
          {{ t('market.totalLine', { total: totalSell, fee: feeNote }) }}
        </div>
        <MButton :loading="submitting" :disabled="!selectedInv" @click="onPost">
          {{ t('market.post') }}
        </MButton>
      </div>

      <!-- Tin đã đăng -->
      <h3 class="text-base font-bold">{{ t('market.myListings') }}</h3>
      <div v-if="loading" class="space-y-2" data-testid="market-mine-skeleton">
        <SkeletonBlock height="h-12" />
        <SkeletonBlock height="h-12" />
        <SkeletonBlock height="h-12" />
      </div>
      <div v-else-if="myListings.length === 0" class="text-ink-300 italic">
        {{ t('market.noMine') }}
      </div>
      <div
        v-for="l in (loading ? [] : myListings)"
        :key="l.id"
        class="rounded border border-ink-300/40 bg-ink-700/30 p-3 flex items-center gap-3"
      >
        <div class="flex-1">
          <span class="font-bold" :class="QUALITY_COLOR[l.item.quality]">
            {{ l.item.name }}
          </span>
          <span class="text-[10px] text-ink-300 ml-1">×{{ l.qty }}</span>
          <span
            class="ml-2 text-[10px] px-1 py-0.5 rounded"
            :class="{
              'bg-emerald-700/40 text-emerald-200': l.status === 'ACTIVE',
              'bg-ink-700/60 text-ink-300': l.status !== 'ACTIVE',
            }"
          >
            {{ t('listingStatus.' + l.status) }}
          </span>
        </div>
        <div class="text-right">
          <span class="text-amber-300 font-bold">{{ l.totalPrice }}</span>
          <span class="text-[10px] text-ink-300 ml-1">⛀</span>
          <MButton
            v-if="l.status === 'ACTIVE'"
            class="ml-2 !px-2 !py-0.5 text-xs"
            :loading="submitting"
            @click="onCancel(l)"
          >
            {{ t('market.takeDown') }}
          </MButton>
        </div>
      </div>
    </section>
  </AppShell>
</template>
