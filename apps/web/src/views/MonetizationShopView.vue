<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import MButton from '@/components/ui/MButton.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTSealFrame from '@/components/xianxia/XTSealFrame.vue';
import {
  buyExtraAttempt,
  getExtraAttempts,
  getWallet,
  listShop,
  purchaseProduct,
  type ExtraAttemptStateEntry,
  type ShopListing,
  type WalletSnapshot,
} from '@/api/monetization';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';

const auth = useAuthStore();
const router = useRouter();
const toast = useToastStore();

const wallet = ref<WalletSnapshot | null>(null);
const listings = ref<ShopListing[]>([]);
const extraAttempts = ref<ExtraAttemptStateEntry[]>([]);
const submitting = ref<string | null>(null);
const loading = ref(true);

const grouped = computed(() => {
  const map = new Map<string, ShopListing[]>();
  for (const l of listings.value) {
    const key = l.product.productType;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(l);
  }
  return Array.from(map.entries());
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const [w, l, e] = await Promise.all([
      getWallet(),
      listShop(),
      getExtraAttempts(),
    ]);
    wallet.value = w;
    listings.value = l;
    extraAttempts.value = e;
  } catch {
    toast.push({ type: 'error', text: 'Không tải được cửa hàng.' });
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await refresh();
});

async function buy(productKey: string): Promise<void> {
  if (submitting.value) return;
  submitting.value = productKey;
  try {
    const result = await purchaseProduct(productKey);
    toast.push({
      type: 'success',
      text: `Đã mua ${result.product.nameVi}.`,
    });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'PURCHASE_FAILED');
    toast.push({ type: 'error', text: code });
  } finally {
    submitting.value = null;
  }
}

async function buyAttempt(limitKey: string): Promise<void> {
  if (submitting.value) return;
  submitting.value = `attempt:${limitKey}`;
  try {
    await buyExtraAttempt(limitKey);
    toast.push({ type: 'success', text: 'Đã mua thêm lượt.' });
    await refresh();
  } catch (e) {
    const code = extractApiErrorCodeOrDefault(e, 'BUY_FAILED');
    toast.push({ type: 'error', text: code });
  } finally {
    submitting.value = null;
  }
}
</script>

<template>
  <AppShell>
    <section class="shop-page">
      <XTSealFrame
        tone="gold"
        corner-ornaments="❀✦❀✦"
        watermark-letter="T"
        rounded="xl"
        inset="tight"
        test-id="monetization-shop-view-seal-frame"
        aria-label="Tiên Trạm Nạp Lễ hero frame"
      >
        <header class="shop-header">
          <XTPageEyebrow caps="TIÊN TRẠM NẠP LỄ" label="Tiên Trạm Nạp Lễ" />
          <h1>Cửa hàng nạp (Phase 27.0)</h1>
          <p class="muted">
            Mua thẻ tháng, sweep tickets, mở khoá premium battle pass, quỹ trưởng
            thành, mở slot inventory/queue/market. Tất cả giao dịch chạy
            server-authoritative với cap chống P2W.
          </p>
          <div v-if="wallet" class="wallet-summary">
            <span><strong>Tiên Ngọc</strong>: {{ wallet.TIEN_NGOC }}</span>
            <span><strong>Tiên Ngọc Khoá</strong>: {{ wallet.TIEN_NGOC_KHOA }}</span>
            <span><strong>Linh Thạch</strong>: {{ wallet.LINH_THACH }}</span>
          </div>
        </header>
      </XTSealFrame>

      <div v-if="loading" class="loading">Đang tải…</div>
      <template v-else>
        <section v-for="[ptype, group] in grouped" :key="ptype" class="shop-group">
          <h2>{{ ptype }}</h2>
          <div class="shop-grid">
            <article v-for="l in group" :key="l.product.key" class="shop-card">
              <header>
                <h3>{{ l.product.nameVi }}</h3>
                <span class="muted">{{ l.product.descriptionVi }}</span>
              </header>
              <dl class="shop-meta">
                <div>
                  <dt>Giá</dt>
                  <dd>{{ l.product.priceAmount }} {{ l.product.priceCurrency }}</dd>
                </div>
                <div>
                  <dt>Giới hạn</dt>
                  <dd>
                    {{ l.product.purchaseLimitType }} —
                    còn {{ l.remaining }}/{{ l.product.purchaseLimitCount }}
                  </dd>
                </div>
              </dl>
              <MButton
                :disabled="l.soldOut || !l.product.enabled || submitting === l.product.key"
                @click="buy(l.product.key)"
              >
                {{ l.soldOut ? 'Hết lượt' : 'Mua' }}
              </MButton>
            </article>
          </div>
        </section>

        <section class="shop-group">
          <h2>Lượt thêm (Extra attempts) — daily cap</h2>
          <div class="shop-grid">
            <article
              v-for="entry in extraAttempts"
              :key="entry.limitKey"
              class="shop-card"
            >
              <header>
                <h3>{{ entry.limitKey }}</h3>
                <span class="muted">
                  Đã dùng {{ entry.usedCount }}/{{ entry.maxCount }} hôm nay.
                </span>
              </header>
              <MButton
                :disabled="entry.remaining <= 0 || submitting === `attempt:${entry.limitKey}`"
                @click="buyAttempt(entry.limitKey)"
              >
                {{ entry.remaining > 0 ? 'Mua thêm 1 lượt' : 'Hết cap' }}
              </MButton>
            </article>
          </div>
        </section>
      </template>
    </section>
  </AppShell>
</template>

<style scoped>
.shop-page {
  padding: 24px;
  max-width: 1180px;
  margin: 0 auto;
}
.shop-header h1 {
  margin: 0 0 4px;
}
.muted {
  color: #888;
  font-size: 13px;
}
.wallet-summary {
  margin-top: 12px;
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  font-size: 13px;
}
.shop-group {
  margin-top: 32px;
}
.shop-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  margin-top: 12px;
}
.shop-card {
  background: #131418;
  border: 1px solid #20222a;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.shop-card header h3 {
  margin: 0 0 4px;
  font-size: 16px;
}
.shop-meta {
  display: grid;
  gap: 6px;
  font-size: 13px;
  margin: 0;
}
.shop-meta dt {
  color: #aaa;
  font-weight: 500;
  display: inline;
}
.shop-meta dd {
  margin: 0;
  display: inline;
}
.shop-meta > div {
  display: flex;
  gap: 6px;
}
.loading {
  padding: 24px 0;
  text-align: center;
  color: #888;
}
</style>
