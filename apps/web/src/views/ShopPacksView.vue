<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import MButton from '@/components/ui/MButton.vue';
import {
  getShopPacks,
  purchaseShopPack,
  type ShopPackView,
} from '@/api/shopPacks';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

type CategoryFilter = 'all' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'EVENT' | 'STARTER';

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const { locale, t } = useI18n();

const packs = ref<ShopPackView[]>([]);
const loading = ref(true);
const purchasing = ref<string | null>(null);
const confirmPack = ref<ShopPackView | null>(null);
const categoryFilter = ref<CategoryFilter>('all');

const categories: CategoryFilter[] = ['all', 'DAILY', 'WEEKLY', 'MONTHLY', 'EVENT', 'STARTER'];

const filteredPacks = computed(() => {
  if (categoryFilter.value === 'all') return packs.value;
  return packs.value.filter((p) => p.category === categoryFilter.value);
});

function packName(pack: ShopPackView): string {
  return locale.value === 'en' ? pack.nameEn : pack.nameVi;
}

function packDesc(pack: ShopPackView): string {
  return locale.value === 'en' ? pack.descriptionEn : pack.descriptionVi;
}

function windowLabel(window: string): string {
  return t(`shopPacks.window.${window}`);
}

function categoryLabel(cat: CategoryFilter): string {
  if (cat === 'all') return t('common.all');
  return t(`shopPacks.category.${cat}`);
}

function rewardLabel(reward: { kind: string; key: string; qty: number }): string {
  if (reward.kind === 'currency') {
    const name = reward.key === 'linhThach' ? t('shopPacks.currency.linhThach') : t('shopPacks.currency.tienNgocKhoa');
    return `${name} ×${reward.qty.toLocaleString()}`;
  }
  return `${reward.key} ×${reward.qty}`;
}

function canBuy(pack: ShopPackView): boolean {
  if (pack.remainingPurchases <= 0) return false;
  const character = game.character;
  if (!character) return false;
  if (pack.priceCurrency === 'tienNgoc' && character.tienNgoc < pack.priceAmount) return false;
  if (pack.priceCurrency === 'tienNgocKhoa' && (character.tienNgocKhoa ?? 0) < pack.priceAmount) return false;
  return true;
}

function buyDisabledReason(pack: ShopPackView): string | null {
  if (pack.remainingPurchases <= 0) return t('shopPacks.soldOut');
  const character = game.character;
  if (!character) return t('shopPacks.noCharacter');
  if (pack.priceCurrency === 'tienNgoc' && character.tienNgoc < pack.priceAmount) return t('shopPacks.insufficientFunds');
  if (pack.priceCurrency === 'tienNgocKhoa' && (character.tienNgocKhoa ?? 0) < pack.priceAmount) return t('shopPacks.insufficientFunds');
  return null;
}

async function refresh() {
  loading.value = true;
  try {
    packs.value = await getShopPacks();
  } catch (err) {
    void err;
    toast.push({ type: 'error', text: t('shopPacks.loadFail') });
  } finally {
    loading.value = false;
  }
}

function openConfirm(pack: ShopPackView) {
  confirmPack.value = pack;
}

function closeConfirm() {
  confirmPack.value = null;
}

async function doPurchase() {
  const pack = confirmPack.value;
  if (!pack) return;
  purchasing.value = pack.packId;
  confirmPack.value = null;
  try {
    const idempotencyKey = `${pack.packId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await purchaseShopPack(pack.packId, idempotencyKey);
    toast.push({ type: 'success', text: t('shopPacks.purchaseSuccess') });
    await game.fetchState().catch(() => null);
    await refresh();
  } catch (err) {
    const code = extractApiErrorCodeOrDefault(err, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`shopPacks.errors.${code}`, t('shopPacks.purchaseFail')),
    });
  } finally {
    purchasing.value = null;
  }
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  await refresh();
});
</script>

<template>
  <AppShell :title="t('shopPacks.title')">
    <XTLuxHero
      eyebrow="TIÊN LỄ TRANG BAO"
      label="Tiên Lễ Trang Bao"
      :title="t('shopPacks.title')"
      :subtitle="t('shopPacks.subtitle', '')"
      tone="gold"
      watermark-letter="T"
      breadcrumb="Kho Báu · Lễ Bao"
      test-id="shop-packs-view-hero"
      class="mb-4"
    >
      <XTPageEyebrow caps="TIÊN LỄ TRANG BAO" label="Tiên Lễ Trang Bao" class="sr-only" />
    </XTLuxHero>
    <!-- Category filter -->
    <div class="flex flex-wrap gap-2 mb-4">
      <button
        v-for="cat in categories"
        :key="cat"
        class="px-3 py-1 rounded-full text-sm border transition-colors"
        :class="categoryFilter === cat
          ? 'bg-amber-600 text-white border-amber-600'
          : 'bg-zinc-800 text-zinc-300 border-zinc-600 hover:border-amber-500'"
        @click="categoryFilter = cat"
      >
        {{ categoryLabel(cat) }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center text-zinc-400 py-8">
      {{ t('common.loadingData') }}
    </div>

    <!-- Empty -->
    <div v-else-if="filteredPacks.length === 0" class="text-center text-zinc-400 py-8">
      {{ t('shopPacks.empty') }}
    </div>

    <!-- Pack list -->
    <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="pack in filteredPacks"
        :key="pack.packId"
        class="bg-zinc-800/70 border border-zinc-700 rounded-lg p-4 flex flex-col"
      >
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-amber-400 font-semibold text-sm">{{ packName(pack) }}</h3>
          <span class="text-xs text-zinc-400 bg-zinc-700 px-2 py-0.5 rounded">
            {{ categoryLabel(pack.category as CategoryFilter) }}
          </span>
        </div>
        <p class="text-xs text-zinc-400 mb-3">{{ packDesc(pack) }}</p>

        <!-- Rewards -->
        <div class="mb-3 space-y-1">
          <div
            v-for="(reward, idx) in pack.rewards"
            :key="idx"
            class="text-xs text-zinc-300"
          >
            • {{ rewardLabel(reward) }}
          </div>
        </div>

        <!-- Limit -->
        <div class="text-xs text-zinc-400 mb-2">
          {{ t('shopPacks.remaining') }}: {{ pack.remainingPurchases }}/{{ pack.purchaseLimit }}
          <span class="text-zinc-500">· {{ windowLabel(pack.purchaseLimitWindow) }}</span>
        </div>

        <!-- Price + Buy -->
        <div class="mt-auto flex items-center justify-between">
          <span class="text-sm font-bold text-yellow-300">
            {{ pack.priceAmount }} {{ pack.priceCurrency === 'tienNgoc' ? t('shopPacks.currency.tienNgoc') : t('shopPacks.currency.tienNgocKhoa') }}
          </span>
          <MButton
            :disabled="!canBuy(pack) || purchasing === pack.packId"
            :loading="purchasing === pack.packId"
            @click="openConfirm(pack)"
          >
            {{ buyDisabledReason(pack) ?? t('shopPacks.buy') }}
          </MButton>
        </div>
      </div>
    </div>

    <!-- Confirm modal -->
    <Teleport to="body">
      <div
        v-if="confirmPack"
        class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
        @click.self="closeConfirm"
      >
        <div class="bg-zinc-800 border border-zinc-600 rounded-lg p-6 max-w-sm w-full">
          <h3 class="text-amber-400 font-semibold mb-2">{{ t('shopPacks.confirmTitle') }}</h3>
          <p class="text-sm text-zinc-300 mb-4">
            {{ t('shopPacks.confirmBody', { name: packName(confirmPack), price: confirmPack.priceAmount }) }}
          </p>
          <div class="flex gap-3 justify-end">
            <MButton @click="closeConfirm">{{ t('common.cancel') }}</MButton>
            <MButton @click="doPurchase">{{ t('common.confirm') }}</MButton>
          </div>
        </div>
      </div>
    </Teleport>
  </AppShell>
</template>
