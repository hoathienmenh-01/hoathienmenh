<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { QUALITY_COLOR, type Quality } from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import { buyFromShop, listNpcShop, type ShopEntry } from '@/api/shop';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTSealFrame from '@/components/xianxia/XTSealFrame.vue';
import MButton from '@/components/ui/MButton.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const entries = ref<ShopEntry[]>([]);
const loading = ref(true);
const submittingKey = ref<string | null>(null);
const qtyByKey = ref<Record<string, number>>({});

const balance = computed(() => game.character?.linhThach ?? '0');

function getQty(itemKey: string): number {
  return qtyByKey.value[itemKey] ?? 1;
}

function setQty(itemKey: string, v: number): void {
  const clamped = Math.max(1, Math.min(99, Math.floor(Number(v) || 1)));
  qtyByKey.value = { ...qtyByKey.value, [itemKey]: clamped };
}

function totalPrice(e: ShopEntry): number {
  return e.price * getQty(e.itemKey);
}

function canAfford(e: ShopEntry): boolean {
  if (e.currency === 'TIEN_NGOC') {
    return (game.character?.tienNgoc ?? 0) >= totalPrice(e);
  }
  try {
    return BigInt(balance.value) >= BigInt(totalPrice(e));
  } catch {
    return false;
  }
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    entries.value = await listNpcShop();
  } catch {
    toast.push({ type: 'error', text: t('shop.errors.loadFail') });
  } finally {
    loading.value = false;
  }
}

async function buy(e: ShopEntry): Promise<void> {
  if (submittingKey.value) return;
  const qty = e.stackable ? getQty(e.itemKey) : 1;
  submittingKey.value = e.itemKey;
  try {
    const r = await buyFromShop(e.itemKey, qty);
    toast.push({
      type: 'success',
      text: t('shop.buyOk', { name: e.name, qty: r.qty, price: r.totalPrice }),
    });
    await game.fetchState().catch(() => null);
  } catch (err) {
    const code = extractApiErrorCodeOrDefault(err, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t(`shop.errors.${code}`, t('shop.errors.UNKNOWN')),
    });
  } finally {
    submittingKey.value = null;
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
  <AppShell>
    <div class="max-w-4xl mx-auto space-y-4">
      <XTSealFrame
        tone="gold"
        corner-ornaments="❀✦❀✦"
        watermark-letter="T"
        rounded="xl"
        inset="tight"
        test-id="shop-view-seal-frame"
        aria-label="Tiên Trạm Chính Biển hero frame"
      >
        <header class="flex items-baseline justify-between gap-3">
          <div>
            <XTPageEyebrow caps="TIÊN TRẠM CHÍNH BIỂN" label="Tiên Trạm Chính Biển" />
            <h1 class="text-2xl tracking-widest font-bold mt-1">{{ t('shop.title') }}</h1>
            <p class="text-sm text-ink-300">{{ t('shop.subtitle') }}</p>
          </div>
          <div class="text-right text-sm">
            <div class="text-amber-200 font-bold">{{ balance }}</div>
            <div class="text-xs text-ink-300">{{ t('shop.balance') }}</div>
          </div>
        </header>
      </XTSealFrame>

      <div v-if="loading" class="text-ink-300 text-sm">{{ t('common.loading') }}</div>

      <div
        v-else-if="entries.length === 0"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
      >
        {{ t('shop.empty') }}
      </div>

      <ul v-else class="grid gap-3 md:grid-cols-2">
        <li
          v-for="e in entries"
          :key="e.itemKey"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-3 space-y-2"
        >
          <div class="flex items-baseline justify-between gap-2">
            <h3
              class="font-bold"
              :class="QUALITY_COLOR[e.quality as Quality]"
            >{{ e.name }}</h3>
            <span class="text-amber-200 text-sm">
              {{ totalPrice(e) }} {{ e.currency === 'TIEN_NGOC' ? t('shop.currency.tienNgoc') : t('shop.currency.linhThach') }}
            </span>
          </div>
          <p class="text-xs text-ink-300 leading-relaxed">{{ e.description }}</p>
          <div
            v-if="e.dailyLimit !== null"
            class="text-[10px] uppercase tracking-wider text-ink-400"
          >
            {{ t('shop.dailyLimit', { n: e.dailyLimit }) }}
          </div>
          <div class="flex items-center gap-2">
            <label v-if="e.stackable" class="text-xs text-ink-300 inline-flex items-center gap-1">
              {{ t('shop.qty') }}
              <input
                type="number"
                min="1"
                max="99"
                :value="getQty(e.itemKey)"
                class="w-16 bg-ink-800/60 border border-ink-300/30 rounded px-2 py-1 text-sm text-ink-100"
                @input="setQty(e.itemKey, Number(($event.target as HTMLInputElement).value))"
              />
            </label>
            <span v-else class="text-xs text-ink-400 italic">{{ t('shop.nonStackable') }}</span>
            <span class="grow"></span>
            <MButton
              :loading="submittingKey === e.itemKey"
              :disabled="!canAfford(e) || submittingKey !== null"
              @click="buy(e)"
            >
              {{ t('shop.buy') }}
            </MButton>
          </div>
        </li>
      </ul>
    </div>
  </AppShell>
</template>
