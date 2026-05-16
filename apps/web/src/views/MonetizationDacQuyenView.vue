<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMonetizationSystemsStore } from '@/stores/monetizationSystems';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';

/**
 * Phase 27.1–27.5 — Đặc Quyền view tổng (Nạp / Tiện Ích / Đặc Quyền).
 *
 * 7 tabs:
 *  1. Quyền lợi (active entitlements snapshot)
 *  2. Thẻ tháng
 *  3. Vé quét
 *  4. Mua thêm lượt
 *  5. Tiên Lộ Lệnh (battle pass missions)
 *  6. Quỹ trưởng thành (growth fund)
 *  7. Shop giới hạn (DAILY/WEEKLY/MONTHLY)
 */
const store = useMonetizationSystemsStore();
const { t } = useI18n();
const activeTab = ref<
  | 'entitlements'
  | 'monthlyCard'
  | 'sweep'
  | 'extraAttempt'
  | 'battlePass'
  | 'growthFund'
  | 'limitedShop'
>('entitlements');

const purchaseError = ref<string | null>(null);

onMounted(async () => {
  await store.refresh();
});

const TABS: Array<{
  key: typeof activeTab.value;
  i18nKey: string;
}> = [
  { key: 'entitlements', i18nKey: 'dacQuyen.tabs.entitlements' },
  { key: 'monthlyCard', i18nKey: 'dacQuyen.tabs.monthlyCard' },
  { key: 'sweep', i18nKey: 'dacQuyen.tabs.sweep' },
  { key: 'extraAttempt', i18nKey: 'dacQuyen.tabs.extraAttempt' },
  { key: 'battlePass', i18nKey: 'dacQuyen.tabs.battlePass' },
  { key: 'growthFund', i18nKey: 'dacQuyen.tabs.growthFund' },
  { key: 'limitedShop', i18nKey: 'dacQuyen.tabs.limitedShop' },
];

const entitlements = computed(() => store.overview?.activeEntitlements ?? []);
const monthlyCards = computed(() => store.overview?.monthlyCards ?? []);
const sweepTickets = computed(() => store.overview?.sweepTickets ?? []);
const extraAttempts = computed(() => store.overview?.extraAttempts ?? []);
const battlePass = computed(() => store.overview?.battlePass);
const growthFunds = computed(() => store.overview?.growthFunds ?? []);
const limitedShops = computed(() => store.shops);

async function onBuy(
  shopKey: 'DAILY_SHOP' | 'WEEKLY_SHOP' | 'MONTHLY_SHOP',
  itemKey: string,
): Promise<void> {
  purchaseError.value = null;
  const err = await store.buyLimited(shopKey, itemKey);
  if (err) purchaseError.value = err;
}
</script>

<template>
  <main class="dac-quyen-view">
    <XTLuxHero
      :eyebrow="t('luxHero.monetizationDacQuyen.eyebrow')"
      :label="t('luxHero.monetizationDacQuyen.label')"
      :title="t('dacQuyen.pageTitle', 'Đặc Quyền')"
      :subtitle="t('dacQuyen.pageSubtitle', '')"
      tone="gold"
      watermark-letter="T"
      :breadcrumb="t('luxHero.monetizationDacQuyen.breadcrumb')"
      test-id="monetization-dac-quyen-view-hero"
    >
      <header class="dac-quyen-header">
        <XTPageEyebrow caps="TIÊN LỘ ĐẶC QUYỀN" label="Tiên Lộ Đặc Quyền" />
        <h1 class="mt-1">{{ t('dacQuyen.title') }}</h1>
        <p class="subtitle">{{ t('dacQuyen.subtitle') }}</p>
      </header>
    </XTLuxHero>

    <nav class="tabs" role="tablist">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.key"
        :class="['tab', { 'tab--active': activeTab === tab.key }]"
        @click="activeTab = tab.key"
      >
        {{ t(tab.i18nKey) }}
      </button>
    </nav>

    <p v-if="store.error" class="error">{{ t('dacQuyen.error', { msg: store.error }) }}</p>
    <p v-else-if="!store.loaded" class="loading">{{ t('dacQuyen.loading') }}</p>

    <section v-else class="tab-panel">
      <!-- Tab 1: Entitlements -->
      <div v-if="activeTab === 'entitlements'">
        <h2>{{ t('dacQuyen.entitlements.title') }}</h2>
        <p v-if="entitlements.length === 0" class="empty">{{ t('dacQuyen.entitlements.empty') }}</p>
        <ul v-else class="entitlement-list">
          <li v-for="e in entitlements" :key="e.key + e.source" class="card">
            <strong>{{ e.key }}</strong>
            <span class="value">{{ t('dacQuyen.entitlements.value', { v: e.value }) }}</span>
            <span class="source">{{ t('dacQuyen.entitlements.source', { src: e.source }) }}</span>
            <span v-if="e.expiresAt" class="expires">{{
              t('dacQuyen.entitlements.expiresAt', { date: new Date(e.expiresAt).toLocaleDateString() })
            }}</span>
          </li>
        </ul>
      </div>

      <!-- Tab 2: Monthly Card -->
      <div v-else-if="activeTab === 'monthlyCard'">
        <h2>{{ t('dacQuyen.monthlyCard.title') }}</h2>
        <p v-if="monthlyCards.length === 0" class="empty">{{ t('dacQuyen.monthlyCard.empty') }}</p>
        <ul v-else class="card-list">
          <li v-for="c in monthlyCards" :key="c.cardKey" class="card">
            <strong>{{ c.cardKey }}</strong>
            <span>{{ t('dacQuyen.monthlyCard.daysRemaining', { days: c.daysRemaining }) }}</span>
            <span v-if="c.canClaimToday" class="claim-available">{{
              t('dacQuyen.monthlyCard.canClaim')
            }}</span>
            <span v-else class="claimed">{{ t('dacQuyen.monthlyCard.claimed') }}</span>
          </li>
        </ul>
      </div>

      <!-- Tab 3: Sweep Tickets -->
      <div v-else-if="activeTab === 'sweep'">
        <h2>{{ t('dacQuyen.sweep.title') }}</h2>
        <p>{{ t('dacQuyen.sweep.description') }}</p>
        <ul class="card-list">
          <li v-for="s in sweepTickets" :key="s.itemKey" class="card">
            <strong>{{ s.itemKey }}</strong>
            <span>{{ t('dacQuyen.sweep.quantity', { q: s.quantity }) }}</span>
          </li>
        </ul>
      </div>

      <!-- Tab 4: Extra Attempts -->
      <div v-else-if="activeTab === 'extraAttempt'">
        <h2>{{ t('dacQuyen.extraAttempt.title') }}</h2>
        <p v-if="extraAttempts.length === 0" class="empty">{{ t('dacQuyen.extraAttempt.empty') }}</p>
        <ul v-else class="card-list">
          <li v-for="ea in extraAttempts" :key="ea.limitKey" class="card">
            <strong>{{ ea.limitKey }}</strong>
            <span>{{ t('dacQuyen.extraAttempt.used', { used: ea.usedToday, max: ea.maxPerDay }) }}</span>
          </li>
        </ul>
      </div>

      <!-- Tab 5: Battle Pass -->
      <div v-else-if="activeTab === 'battlePass'">
        <h2>{{ t('dacQuyen.battlePass.title') }}</h2>
        <p v-if="!battlePass?.seasonId" class="empty">{{ t('dacQuyen.battlePass.noSeason') }}</p>
        <template v-else>
          <p>
            <strong>{{ t('dacQuyen.battlePass.season', { id: battlePass.seasonId }) }}</strong>
          </p>
          <p>
            {{
              t('dacQuyen.battlePass.level', {
                level: battlePass.level,
                max: battlePass.maxLevel,
              })
            }}
          </p>
          <p>{{ t('dacQuyen.battlePass.xp', { xp: battlePass.xp }) }}</p>
          <p :class="battlePass.premiumUnlocked ? 'unlocked' : 'locked'">
            {{
              battlePass.premiumUnlocked
                ? t('dacQuyen.battlePass.premiumUnlocked')
                : t('dacQuyen.battlePass.premiumLocked')
            }}
          </p>
          <div v-if="store.missions" class="mission-section">
            <h3>{{ t('dacQuyen.battlePass.missionsDaily') }}</h3>
            <ul class="mission-list">
              <li v-for="m in store.missions.daily" :key="m.mission.key">
                {{ m.mission.nameVi }} —
                <span>{{ m.progress }}/{{ m.target }}</span>
                <span v-if="m.completed">✓</span>
              </li>
            </ul>
            <h3>{{ t('dacQuyen.battlePass.missionsWeekly') }}</h3>
            <ul class="mission-list">
              <li v-for="m in store.missions.weekly" :key="m.mission.key">
                {{ m.mission.nameVi }} —
                <span>{{ m.progress }}/{{ m.target }}</span>
                <span v-if="m.completed">✓</span>
              </li>
            </ul>
            <h3>{{ t('dacQuyen.battlePass.missionsSeason') }}</h3>
            <ul class="mission-list">
              <li v-for="m in store.missions.season" :key="m.mission.key">
                {{ m.mission.nameVi }} —
                <span>{{ m.progress }}/{{ m.target }}</span>
                <span v-if="m.completed">✓</span>
              </li>
            </ul>
          </div>
        </template>
      </div>

      <!-- Tab 6: Growth Fund -->
      <div v-else-if="activeTab === 'growthFund'">
        <h2>{{ t('dacQuyen.growthFund.title') }}</h2>
        <ul class="card-list">
          <li v-for="g in growthFunds" :key="g.fundKey" class="card">
            <strong>{{ g.fundKey }}</strong>
            <span v-if="g.purchased" class="purchased">
              {{
                t('dacQuyen.growthFund.purchased', {
                  count: g.claimedMilestones.length,
                })
              }}
            </span>
            <span v-else class="not-purchased">{{ t('dacQuyen.growthFund.notPurchased') }}</span>
          </li>
        </ul>
      </div>

      <!-- Tab 7: Limited Shop -->
      <div v-else-if="activeTab === 'limitedShop'">
        <h2>{{ t('dacQuyen.limitedShop.title') }}</h2>
        <p v-if="purchaseError" class="error">
          {{ t('dacQuyen.limitedShop.errors.' + purchaseError, purchaseError) }}
        </p>
        <div v-for="shop in limitedShops" :key="shop.shopKey" class="shop-block">
          <h3>{{ t('dacQuyen.limitedShop.' + shop.shopKey) }}</h3>
          <p class="period">{{ t('dacQuyen.limitedShop.period', { p: shop.periodKey }) }}</p>
          <ul class="shop-items">
            <li
              v-for="li in shop.items"
              :key="li.item.itemKey"
              :class="['shop-item', { 'shop-item--soldout': li.soldOut }]"
            >
              <div class="item-info">
                <strong>{{ li.item.nameVi }}</strong>
                <small>{{ li.item.descriptionVi }}</small>
              </div>
              <div class="item-price">
                {{ li.item.priceAmount }} {{ li.item.priceCurrency }}
              </div>
              <div class="item-stock">
                {{
                  t('dacQuyen.limitedShop.remaining', {
                    rem: li.remaining,
                    max: li.item.purchaseLimitCount,
                  })
                }}
              </div>
              <button
                type="button"
                :disabled="li.soldOut || store.inFlight.has(shop.shopKey + ':' + li.item.itemKey)"
                @click="onBuy(shop.shopKey, li.item.itemKey)"
              >
                {{
                  li.soldOut
                    ? t('dacQuyen.limitedShop.soldOut')
                    : t('dacQuyen.limitedShop.buy')
                }}
              </button>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.dac-quyen-view {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
  color: #e6e3d8;
}
.dac-quyen-header {
  margin-bottom: 24px;
}
.subtitle {
  color: #a39d8b;
}
.tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 24px;
}
.tab {
  background: #1c1a17;
  border: 1px solid #3a3530;
  color: #d8d4c5;
  padding: 8px 14px;
  cursor: pointer;
}
.tab--active {
  background: #4a3a25;
  border-color: #8e6e3a;
  color: #fff;
}
.tab-panel {
  border: 1px solid #3a3530;
  padding: 20px;
  background: #181614;
}
.entitlement-list,
.card-list,
.mission-list,
.shop-items {
  list-style: none;
  padding: 0;
  margin: 0;
}
.card {
  padding: 12px;
  margin-bottom: 8px;
  background: #1c1a17;
  border: 1px solid #2a2620;
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}
.shop-item {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  background: #1c1a17;
  border: 1px solid #2a2620;
  margin-bottom: 6px;
}
.shop-item--soldout {
  opacity: 0.5;
}
button {
  background: #4a3a25;
  border: 1px solid #8e6e3a;
  color: #fff;
  padding: 6px 12px;
  cursor: pointer;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.empty,
.loading {
  color: #a39d8b;
  font-style: italic;
}
.error {
  color: #d97171;
}
.claim-available,
.unlocked,
.purchased {
  color: #a3d97b;
}
.claimed,
.not-purchased,
.locked {
  color: #a39d8b;
}
.mission-section h3 {
  margin-top: 16px;
  color: #c7b790;
}
</style>
