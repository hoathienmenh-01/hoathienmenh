import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/monetization';

/**
 * Phase 27.1–27.5 — Monetization Systems V1 store.
 *
 * Aggregates 3 server endpoints into a single client store cho UI
 * `Đặc Quyền` view:
 *
 *   - `GET /monetization/overview` → snapshot (entitlements, monthly
 *     cards, battle pass progress, growth funds, limited shops list).
 *   - `GET /monetization/battle-pass/missions` → DAILY/WEEKLY/SEASON
 *     mission progress.
 *   - `GET /monetization/limited-shops` → 3 shops + items + period
 *     keys + remaining.
 *
 * Actions:
 *   - `refresh()` — load all 3 endpoints song song.
 *   - `buyLimited(shopKey, itemKey)` — debit + grant qua server.
 *
 * Race protect: `inFlight` Set (set per `${shopKey}:${itemKey}`).
 */
export const useMonetizationSystemsStore = defineStore('monetizationSystems', () => {
  const overview = ref<api.MonetizationOverview | null>(null);
  const missions = ref<api.BattlePassMissionsView | null>(null);
  const shops = ref<api.LimitedShopListing[]>([]);
  const loaded = ref(false);
  const inFlight = ref<Set<string>>(new Set());
  const error = ref<string | null>(null);

  const hasMonthlyCard = computed(() =>
    overview.value ? overview.value.monthlyCards.length > 0 : false,
  );

  const claimableMonthlyCards = computed(() =>
    overview.value ? overview.value.monthlyCards.filter((c) => c.canClaimToday) : [],
  );

  const completedMissions = computed(() => {
    if (!missions.value) return 0;
    return [
      ...missions.value.daily,
      ...missions.value.weekly,
      ...missions.value.season,
    ].filter((m) => m.completed).length;
  });

  async function refresh(): Promise<void> {
    error.value = null;
    try {
      const [ov, ms, sh] = await Promise.all([
        api.getMonetizationOverview(),
        api.getBattlePassMissions(),
        api.getLimitedShops(),
      ]);
      overview.value = ov;
      missions.value = ms;
      shops.value = sh;
      loaded.value = true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'UNKNOWN_ERROR';
    }
  }

  async function buyLimited(
    shopKey: 'DAILY_SHOP' | 'WEEKLY_SHOP' | 'MONTHLY_SHOP',
    itemKey: string,
  ): Promise<string | null> {
    const k = `${shopKey}:${itemKey}`;
    if (inFlight.value.has(k)) return 'IN_FLIGHT';
    inFlight.value = new Set([...inFlight.value, k]);
    try {
      await api.buyLimitedShopItem(shopKey, itemKey);
      await refresh();
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'UNKNOWN_ERROR';
      const m = msg.match(/"code"\s*:\s*"([A-Z_]+)"/);
      return m?.[1] ?? msg;
    } finally {
      const s = new Set(inFlight.value);
      s.delete(k);
      inFlight.value = s;
    }
  }

  return {
    overview,
    missions,
    shops,
    loaded,
    inFlight,
    error,
    hasMonthlyCard,
    claimableMonthlyCards,
    completedMissions,
    refresh,
    buyLimited,
  };
});
