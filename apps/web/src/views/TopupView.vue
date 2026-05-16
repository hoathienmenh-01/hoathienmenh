<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useToastStore } from '@/stores/toast';
import {
  createTopupOrder,
  getMyTopups,
  getTopupCatalog,
  type TopupBank,
  type TopupOrderView,
  type TopupPackage,
} from '@/api/topup';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import MButton from '@/components/ui/MButton.vue';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const auth = useAuthStore();
const game = useGameStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const packages = ref<TopupPackage[]>([]);
const bank = ref<TopupBank | null>(null);
const orders = ref<TopupOrderView[]>([]);
const submitting = ref(false);
const lastOrder = ref<TopupOrderView | null>(null);

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  try {
    const [cat, mine] = await Promise.all([getTopupCatalog(), getMyTopups()]);
    packages.value = cat.packages;
    bank.value = cat.bank;
    orders.value = mine;
  } catch (e) {
    handleErr(e);
  }
});

async function buy(pkg: TopupPackage): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  try {
    const order = await createTopupOrder(pkg.key);
    lastOrder.value = order;
    orders.value = [order, ...orders.value];
    toast.push({
      type: 'success',
      text: t('topup.orderCreatedToast', { code: order.transferCode }),
    });
  } catch (e) {
    handleErr(e);
  } finally {
    submitting.value = false;
  }
}

function handleErr(e: unknown): void {
  const code = extractApiErrorCodeOrDefault(e, 'ERR');
  const text = t(`topup.errors.${code}`, '__missing__');
  toast.push({
    type: 'error',
    text: text === '__missing__' ? t('topup.errors.UNKNOWN') : text,
  });
}

function statusLabel(s: TopupOrderView['status']): string {
  return s === 'PENDING' ? t('topup.status.PENDING') : s === 'APPROVED' ? t('topup.status.APPROVED') : t('topup.status.REJECTED');
}

function statusClass(s: TopupOrderView['status']): string {
  return s === 'PENDING'
    ? 'bg-amber-700/40 text-amber-200'
    : s === 'APPROVED'
      ? 'bg-emerald-700/40 text-emerald-200'
      : 'bg-red-700/40 text-red-200';
}

function fmtVND(n: number): string {
  return n.toLocaleString('vi-VN') + ' ₫';
}
</script>

<template>
  <AppShell>
    <div class="max-w-5xl mx-auto space-y-6">
      <header>
        <XTPageEyebrow label="Tiên Ngọc Hương Hỏa" />
        <h1 class="text-2xl tracking-widest font-bold mt-1">{{ t('topup.title') }}</h1>
        <p class="text-ink-300 text-sm mt-1">
          {{ t('topup.intro') }}
        </p>
      </header>

      <!-- Lưu ý nạp -->
      <section class="rounded border border-amber-300/40 bg-amber-900/20 p-3 text-xs text-amber-100">
        <p>{{ t('topup.rule1') }}</p>
        <p class="mt-1 text-amber-200/80">
          {{ t('topup.rule2') }}
        </p>
      </section>

      <!-- Packages -->
      <section>
        <h2 class="text-lg mb-2">{{ t('topup.packages') }}</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <article
            v-for="pkg in packages"
            :key="pkg.key"
            class="border border-ink-300/30 rounded p-3 bg-ink-700/30 flex flex-col gap-2"
          >
            <div class="flex items-start gap-2">
              <h3 class="text-base flex-1">{{ pkg.name }}</h3>
              <span
                v-if="pkg.hot"
                class="px-1.5 py-0.5 text-[10px] rounded bg-red-700/40 text-red-200"
              >
                HOT
              </span>
            </div>
            <p class="text-xs text-ink-300">{{ pkg.description }}</p>
            <div class="text-xs text-ink-300 flex justify-between items-end mt-auto">
              <span class="text-amber-200 text-base font-bold">{{ fmtVND(pkg.priceVND) }}</span>
              <span>
                {{ pkg.tienNgoc }}
                <span v-if="pkg.bonus" class="text-emerald-300">+{{ pkg.bonus }}</span>
                {{ t('topup.tienNgoc') }}
              </span>
            </div>
            <MButton :disabled="submitting" @click="buy(pkg)">{{ t('topup.buy') }}</MButton>
          </article>
        </div>
      </section>

      <!-- Last order details -->
      <section
        v-if="lastOrder"
        class="rounded border border-emerald-300/40 bg-emerald-900/20 p-4 text-sm space-y-2"
      >
        <h2 class="text-lg text-emerald-200">{{ t('topup.lastOrderTitle') }}</h2>
        <p>{{ t('topup.transferCode') }} <b class="font-mono text-amber-200">{{ lastOrder.transferCode }}</b></p>
        <p>{{ t('topup.amount', { price: fmtVND(lastOrder.priceVND), ngoc: lastOrder.tienNgocAmount }) }}</p>
        <p v-if="bank" class="text-xs text-ink-300">{{ t('topup.bankLine', { bank: bank.bankName, name: bank.accountName, number: bank.accountNumber }) }}</p>
      </section>

      <!-- History -->
      <section>
        <h2 class="text-lg mb-2">{{ t('topup.history') }}</h2>
        <div v-if="orders.length === 0" class="text-ink-300 text-sm">{{ t('topup.noOrders') }}</div>
        <table v-else class="w-full text-sm">
          <thead class="text-ink-300 text-xs">
            <tr class="text-left">
              <th class="py-1">{{ t('topup.col.code') }}</th>
              <th>{{ t('topup.col.package') }}</th>
              <th>{{ t('topup.col.price') }}</th>
              <th>{{ t('topup.col.tienNgoc') }}</th>
              <th>{{ t('topup.col.status') }}</th>
              <th>{{ t('topup.col.createdAt') }}</th>
              <th>{{ t('topup.col.note') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in orders" :key="o.id" class="border-t border-ink-300/20">
              <td class="py-1 font-mono text-amber-200">{{ o.transferCode }}</td>
              <td>{{ o.packageName }}</td>
              <td>{{ fmtVND(o.priceVND) }}</td>
              <td>{{ o.tienNgocAmount }}</td>
              <td>
                <span class="px-1.5 py-0.5 rounded text-[10px]" :class="statusClass(o.status)">
                  {{ statusLabel(o.status) }}
                </span>
              </td>
              <td class="text-ink-300">
                {{ new Date(o.createdAt).toLocaleString('vi-VN') }}
              </td>
              <td class="text-ink-300">{{ o.note || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </AppShell>
</template>
