<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import XTStatTile from '@/components/xianxia/XTStatTile.vue';
import XTLuxSection from '@/components/xianxia/XTLuxSection.vue';
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
const { t } = useI18n();

const wallet = ref<WalletSnapshot | null>(null);
const ledger = ref<WalletLedgerEntry[]>([]);
const entitlements = ref<EntitlementView[]>([]);
const loading = ref(true);
const filterCurrency = ref<WalletCurrencyKey | ''>('');

type CurrencyDef = {
  key: WalletCurrencyKey;
  label: string;
  eyebrow: string;
  tone: 'gold' | 'jade' | 'seal' | 'smoke' | 'mist';
  icon: string;
};

const CURRENCIES: CurrencyDef[] = [
  { key: 'TIEN_NGOC', label: 'Tiên Ngọc', eyebrow: 'PREMIUM', tone: 'gold', icon: 'wallet' },
  { key: 'TIEN_NGOC_KHOA', label: 'Tiên Ngọc Khoá', eyebrow: 'GIFT', tone: 'gold', icon: 'gift' },
  { key: 'LINH_THACH', label: 'Linh Thạch', eyebrow: 'SOFT', tone: 'jade', icon: 'cultivation' },
  { key: 'CONG_HIEN_TONG_MON', label: 'Cống Hiến Tông Môn', eyebrow: 'SECT', tone: 'jade', icon: 'sect' },
  { key: 'TRIAL_POINT', label: 'Trial Point', eyebrow: 'TRIAL', tone: 'seal', icon: 'combat' },
  { key: 'EVENT_TOKEN', label: 'Event Token', eyebrow: 'EVENT', tone: 'smoke', icon: 'achievement' },
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
      <XTLuxHero
        :eyebrow="t('luxHero.wallet.eyebrow')"
        :label="t('luxHero.wallet.label')"
        title="Ví Tu Tiên"
        :subtitle="t('luxHero.wallet.subtitle')"
        tone="gold"
        watermark-letter="T"
        :breadcrumb="t('luxHero.wallet.breadcrumb')"
        test-id="wallet-view-hero"
      >
        <XTPageEyebrow
          caps="CÀN KHÔN CẨM NANG"
          label="Càn Khôn Cẩm Nang"
          class="sr-only"
        />
      </XTLuxHero>

      <div v-if="loading" class="wallet-loading">Đang tải…</div>
      <template v-else>
        <div class="wallet-grid">
          <button
            v-for="def in CURRENCIES"
            :key="def.key"
            type="button"
            class="wallet-cell-btn"
            :class="{ filtered: filterCurrency === def.key }"
            @click="filterCurrency = filterCurrency === def.key ? '' : def.key; refresh()"
          >
            <XTStatTile
              :eyebrow="def.eyebrow"
              :label="def.label"
              :tone="def.tone"
              :icon="def.icon"
              :value="wallet ? wallet[def.key].toLocaleString() : 0"
              interactive
              :test-id="`wallet-tile-${def.key.toLowerCase()}`"
            />
          </button>
        </div>

        <XTLuxSection
          eyebrow="ĐẶC QUYỀN HIỆN HÀNH"
          title="Entitlements active"
          tone="gold"
          test-id="wallet-entitlements-section"
        >
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
        </XTLuxSection>

        <XTLuxSection
          eyebrow="SỔ CÁI GIAO DỊCH"
          title="50 dòng gần nhất"
          tone="jade"
          test-id="wallet-ledger-section"
        >
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
        </XTLuxSection>
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
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  margin: 16px 0 32px;
}
.wallet-cell-btn {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0;
  display: block;
  width: 100%;
  text-align: left;
  cursor: pointer;
  border-radius: var(--xt-radius-lg, 20px);
  transition: filter 120ms ease;
}
.wallet-cell-btn.filtered {
  filter: drop-shadow(0 0 12px rgba(110, 133, 255, 0.45));
}
.wallet-cell-btn:focus-visible {
  outline: 2px solid var(--xt-gold-bright, #f2d789);
  outline-offset: 4px;
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
