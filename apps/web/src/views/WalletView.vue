<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import XTHeroEyebrow from '@/components/xianxia/XTHeroEyebrow.vue';
import {
  getWallet,
  getWalletLedger,
  listEntitlements,
  type EntitlementView,
  type WalletCurrencyKey,
  type WalletLedgerEntry,
  type WalletSnapshot,
} from '@/api/monetization';

const auth = useAuthStore();
const router = useRouter();
const toast = useToastStore();

const wallet = ref<WalletSnapshot | null>(null);
const ledger = ref<WalletLedgerEntry[]>([]);
const entitlements = ref<EntitlementView[]>([]);
const loading = ref(true);
const filterCurrency = ref<WalletCurrencyKey | ''>('');

const CURRENCIES: { key: WalletCurrencyKey; label: string }[] = [
  { key: 'TIEN_NGOC', label: 'Tiên Ngọc' },
  { key: 'TIEN_NGOC_KHOA', label: 'Tiên Ngọc Khoá' },
  { key: 'LINH_THACH', label: 'Linh Thạch' },
  { key: 'CONG_HIEN_TONG_MON', label: 'Cống Hiến Tông Môn' },
  { key: 'TRIAL_POINT', label: 'Trial Point' },
  { key: 'EVENT_TOKEN', label: 'Event Token' },
];

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const [w, l, ents] = await Promise.all([
      getWallet(),
      getWalletLedger({ limit: 50, currency: filterCurrency.value || undefined }),
      listEntitlements(),
    ]);
    wallet.value = w;
    ledger.value = l;
    entitlements.value = ents;
  } catch {
    toast.push({ type: 'error', text: 'Không tải được ví.' });
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

function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}
</script>

<template>
  <AppShell>
    <section class="wallet-page">
      <header class="wallet-header">
        <XTHeroEyebrow han="乾坤锦囊" label="Càn Khôn Cẩm Nang" />
        <h1 class="mt-1">Ví Tu Tiên (Phase 27.0 Foundation)</h1>
        <p class="muted">
          Tổng hợp 6 loại tiền tệ + entitlements đang active. Mọi giao dịch
          chạy server-authoritative qua CurrencyLedger.
        </p>
      </header>

      <div v-if="loading" class="wallet-loading">Đang tải…</div>
      <template v-else>
        <div class="wallet-grid">
          <div
            v-for="def in CURRENCIES"
            :key="def.key"
            class="wallet-cell"
            :class="{ filtered: filterCurrency === def.key }"
            @click="filterCurrency = filterCurrency === def.key ? '' : def.key; refresh()"
          >
            <div class="wallet-label">{{ def.label }}</div>
            <div class="wallet-amount">
              {{ wallet ? wallet[def.key].toLocaleString() : 0 }}
            </div>
          </div>
        </div>

        <section class="wallet-section">
          <h2>Entitlements active</h2>
          <p v-if="entitlements.length === 0" class="muted">
            Chưa có entitlement nào. Mua thẻ tháng / quỹ trưởng thành để mở khoá tiện ích.
          </p>
          <ul v-else class="entitlement-list">
            <li v-for="e in entitlements" :key="`${e.key}:${e.startsAt}`">
              <strong>{{ e.key }}</strong>
              <span>= {{ e.value }}</span>
              <span class="muted">
                (nguồn: {{ e.source }};
                hết hạn:
                {{ e.expiresAt ? new Date(e.expiresAt).toLocaleString() : 'không thời hạn' }})
              </span>
            </li>
          </ul>
        </section>

        <section class="wallet-section">
          <h2>Sổ cái giao dịch (50 dòng gần nhất)</h2>
          <p v-if="filterCurrency" class="muted">
            Đang lọc theo: <strong>{{ filterCurrency }}</strong>.
            <button type="button" class="link" @click="filterCurrency = ''; refresh()">Bỏ lọc</button>
          </p>
          <table class="ledger-table">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Loại tiền</th>
                <th>Δ</th>
                <th>Lý do</th>
                <th>Ref</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in ledger" :key="entry.id">
                <td>{{ new Date(entry.createdAt).toLocaleString() }}</td>
                <td>{{ entry.currency }}</td>
                <td :class="entry.delta >= 0 ? 'pos' : 'neg'">
                  {{ formatDelta(entry.delta) }}
                </td>
                <td>{{ entry.reason }}</td>
                <td>
                  <code v-if="entry.refType">{{ entry.refType }}:{{ entry.refId }}</code>
                </td>
              </tr>
              <tr v-if="ledger.length === 0">
                <td colspan="5" class="muted">Chưa có giao dịch.</td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
    </section>
  </AppShell>
</template>

<style scoped>
.wallet-page {
  padding: 24px;
  max-width: 1080px;
  margin: 0 auto;
}
.wallet-header h1 {
  margin: 0 0 4px;
}
.muted {
  color: #888;
  font-size: 13px;
}
.wallet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  margin: 16px 0 32px;
}
.wallet-cell {
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 14px 16px;
  cursor: pointer;
  background: #131418;
  transition: border 120ms ease;
}
.wallet-cell:hover {
  border-color: #3d6fff;
}
.wallet-cell.filtered {
  border-color: #6e85ff;
  background: #1a2147;
}
.wallet-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #aaa;
}
.wallet-amount {
  font-size: 22px;
  font-weight: 600;
  margin-top: 6px;
}
.wallet-section {
  margin-top: 28px;
}
.entitlement-list {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 6px;
}
.entitlement-list li {
  background: #14161c;
  border: 1px solid #20222a;
  padding: 10px 14px;
  border-radius: 8px;
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}
.ledger-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.ledger-table th,
.ledger-table td {
  border-bottom: 1px solid #20222a;
  padding: 8px 10px;
  text-align: left;
}
.ledger-table th {
  color: #aaa;
  font-weight: 500;
}
.pos {
  color: #4cd964;
}
.neg {
  color: #ff5e57;
}
.link {
  background: none;
  border: 0;
  color: #6e85ff;
  cursor: pointer;
  padding: 0;
  font: inherit;
}
.wallet-loading {
  padding: 24px 0;
  text-align: center;
  color: #888;
}
</style>
