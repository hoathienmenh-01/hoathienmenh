import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/npcAffinity';

/**
 * Phase 12.10.A — NPC Affinity Pinia store.
 *
 * Holds NPC affinity list for the current character. Read-only view — mutations
 * happen server-side via dialogue choice / quest reward; store reloads after
 * `StoryDialogueModal` applies effects.
 *
 * Phase 12.10.B — bổ sung gift action:
 *   - `dailyCounts` map theo `npcKey` → counts hôm nay (UTC).
 *   - `giftNpc(npcKey, itemKey)` post API + cập nhật affinity + counts in-place.
 *   - `loadDaily()` fetch counts khi mount panel.
 *   - `lastGift` để view có thể show toast "+N affinity" sau lần gift mới nhất.
 */
export const useNpcAffinityStore = defineStore('npcAffinity', () => {
  const affinities = ref<api.NpcAffinityView[]>([]);
  const caps = ref<api.NpcAffinityCaps | null>(null);
  const loaded = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Phase 12.10.B — daily gift counts cho FE locked state.
  const dailyCounts = ref<Record<string, api.NpcGiftDailyCount>>({});
  const dailyLoaded = ref(false);
  const giftLoading = ref<string | null>(null); // npcKey đang gift
  const giftError = ref<string | null>(null);
  const lastGift = ref<api.NpcGiftResultView | null>(null);

  // Phase 12.10.C — Shop + Hidden Unlocks state per NPC.
  const shops = ref<Record<string, api.NpcShopListView>>({});
  const shopLoading = ref<string | null>(null);
  const shopError = ref<string | null>(null);
  const buyLoading = ref<string | null>(null); // `${npcKey}:${itemKey}`
  const buyError = ref<string | null>(null);
  const lastBuy = ref<api.NpcShopBuyReceiptView | null>(null);
  const unlocks = ref<Record<string, api.NpcUnlocksView>>({});
  const unlocksLoading = ref<string | null>(null);

  // Phase 12.10.D — Relationship Quest Chain state per NPC.
  const chains = ref<Record<string, api.NpcRelationshipChainView[]>>({});
  const chainsLoading = ref<string | null>(null);
  const chainsError = ref<string | null>(null);
  const claimChainLoading = ref<string | null>(null); // `${npcKey}:${chainKey}`
  const claimChainError = ref<string | null>(null);
  const lastChainClaim = ref<api.NpcRelationshipChainClaimReceipt | null>(null);

  const count = computed(() => affinities.value.length);

  function findByNpcKey(npcKey: string): api.NpcAffinityView | undefined {
    return affinities.value.find((a) => a.npcKey === npcKey);
  }

  /**
   * Phase 12.10.B — daily count cho 1 NPC. Trả default {usedToday: 0,
   * remainingToday: dailyLimit} nếu chưa có row (lazy backfill).
   */
  function dailyFor(
    npcKey: string,
    fallbackLimit: number,
  ): api.NpcGiftDailyCount {
    const found = dailyCounts.value[npcKey];
    if (found) return found;
    return {
      npcKey,
      dayBucket: '',
      usedToday: 0,
      dailyLimit: fallbackLimit,
      remainingToday: fallbackLimit,
    };
  }

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const result = await api.fetchNpcAffinities();
      affinities.value = result.affinities;
      caps.value = result.caps;
      loaded.value = true;
    } catch (e) {
      error.value =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
    } finally {
      loading.value = false;
    }
  }

  async function refresh(): Promise<void> {
    await load();
  }

  /**
   * Phase 12.10.B — load daily gift counts. Idempotent — gọi lại để refresh
   * khi player mở panel hoặc sau midnight UTC rollover.
   */
  async function loadDaily(): Promise<void> {
    try {
      const counts = await api.fetchNpcGiftDaily();
      const map: Record<string, api.NpcGiftDailyCount> = {};
      for (const c of counts) map[c.npcKey] = c;
      dailyCounts.value = map;
      dailyLoaded.value = true;
    } catch {
      // Phase 12.10.B — fail-soft: panel vẫn render affinities, chỉ disable
      // gift section khi state không xác định (FE check `dailyLoaded`).
    }
  }

  /**
   * Phase 12.10.B — gift 1 item cho NPC. Returns gift result hoặc null nếu
   * lỗi. Caller (panel) đọc `giftError` để render toast/inline error.
   *
   * Sau success, store cập nhật affinity row + dailyCounts in-place — không
   * cần full reload.
   */
  async function giftNpc(
    npcKey: string,
    itemKey: string,
  ): Promise<api.NpcGiftResultView | null> {
    giftLoading.value = npcKey;
    giftError.value = null;
    try {
      const result = await api.giftNpc(npcKey, itemKey);
      const idx = affinities.value.findIndex((a) => a.npcKey === npcKey);
      if (idx >= 0) affinities.value[idx] = result.affinity;
      else affinities.value.push(result.affinity);
      dailyCounts.value[npcKey] = {
        npcKey,
        dayBucket: result.gift.dayBucket,
        usedToday: result.gift.dailyLimit - result.gift.remainingToday,
        dailyLimit: result.gift.dailyLimit,
        remainingToday: result.gift.remainingToday,
      };
      lastGift.value = result.gift;
      return result.gift;
    } catch (e) {
      giftError.value =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
      return null;
    } finally {
      giftLoading.value = null;
    }
  }

  function clearLastGift(): void {
    lastGift.value = null;
  }

  // ==================================================================
  // Phase 12.10.C — Shop + Hidden Unlocks
  // ==================================================================

  async function loadShop(npcKey: string): Promise<void> {
    shopLoading.value = npcKey;
    shopError.value = null;
    try {
      const shop = await api.fetchNpcShop(npcKey);
      shops.value = { ...shops.value, [npcKey]: shop };
    } catch (e) {
      shopError.value =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
    } finally {
      shopLoading.value = null;
    }
  }

  async function buyShopItem(
    npcKey: string,
    itemKey: string,
    qty = 1,
  ): Promise<api.NpcShopBuyReceiptView | null> {
    buyLoading.value = `${npcKey}:${itemKey}`;
    buyError.value = null;
    try {
      const result = await api.buyNpcShopItem(npcKey, itemKey, qty);
      shops.value = { ...shops.value, [npcKey]: result.shop };
      lastBuy.value = result.receipt;
      return result.receipt;
    } catch (e) {
      buyError.value =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
      return null;
    } finally {
      buyLoading.value = null;
    }
  }

  async function loadUnlocks(npcKey: string): Promise<void> {
    unlocksLoading.value = npcKey;
    try {
      const data = await api.fetchNpcUnlocks(npcKey);
      unlocks.value = { ...unlocks.value, [npcKey]: data };
    } catch {
      // fail-soft: panel renders empty unlocks list.
    } finally {
      unlocksLoading.value = null;
    }
  }

  function clearLastBuy(): void {
    lastBuy.value = null;
  }

  // ==================================================================
  // Phase 12.10.D — Relationship Quest Chain
  // ==================================================================

  /**
   * Load chains cho 1 NPC. Idempotent — gọi sau mỗi quest claim/dialogue
   * effect để refresh trạng thái progress + completable.
   */
  async function loadChains(npcKey: string): Promise<void> {
    chainsLoading.value = npcKey;
    chainsError.value = null;
    try {
      const result = await api.fetchNpcQuestChains(npcKey);
      chains.value = { ...chains.value, [npcKey]: result.chains };
    } catch (e) {
      chainsError.value =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
    } finally {
      chainsLoading.value = null;
    }
  }

  /**
   * Claim chain reward — atomic POST. Trả receipt nếu success; null nếu lỗi
   * (caller đọc `claimChainError`). Khi success, store cập nhật chain entry
   * + affinity in-place — không cần full reload.
   */
  async function claimChain(
    npcKey: string,
    chainKey: string,
  ): Promise<api.NpcRelationshipChainClaimReceipt | null> {
    claimChainLoading.value = `${npcKey}:${chainKey}`;
    claimChainError.value = null;
    try {
      const result = await api.claimNpcQuestChain(npcKey, chainKey);
      const list = (chains.value[npcKey] ?? []).slice();
      const idx = list.findIndex((c) => c.chainKey === chainKey);
      if (idx >= 0) list[idx] = result.chain;
      chains.value = { ...chains.value, [npcKey]: list };
      // Cập nhật affinity score nếu chain reward gồm affinity.
      const affIdx = affinities.value.findIndex((a) => a.npcKey === npcKey);
      if (affIdx >= 0) {
        affinities.value[affIdx] = {
          ...affinities.value[affIdx],
          score: result.receipt.newAffinityScore,
        };
      }
      lastChainClaim.value = result.receipt;
      return result.receipt;
    } catch (e) {
      claimChainError.value =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
      return null;
    } finally {
      claimChainLoading.value = null;
    }
  }

  function clearLastChainClaim(): void {
    lastChainClaim.value = null;
  }

  function reset(): void {
    affinities.value = [];
    caps.value = null;
    loaded.value = false;
    loading.value = false;
    error.value = null;
    dailyCounts.value = {};
    dailyLoaded.value = false;
    giftLoading.value = null;
    giftError.value = null;
    lastGift.value = null;
    shops.value = {};
    shopLoading.value = null;
    shopError.value = null;
    buyLoading.value = null;
    buyError.value = null;
    lastBuy.value = null;
    unlocks.value = {};
    unlocksLoading.value = null;
    chains.value = {};
    chainsLoading.value = null;
    chainsError.value = null;
    claimChainLoading.value = null;
    claimChainError.value = null;
    lastChainClaim.value = null;
  }

  return {
    affinities,
    caps,
    loaded,
    loading,
    error,
    count,
    findByNpcKey,
    load,
    refresh,
    reset,
    // Phase 12.10.B
    dailyCounts,
    dailyLoaded,
    giftLoading,
    giftError,
    lastGift,
    dailyFor,
    loadDaily,
    giftNpc,
    clearLastGift,
    // Phase 12.10.C
    shops,
    shopLoading,
    shopError,
    buyLoading,
    buyError,
    lastBuy,
    unlocks,
    unlocksLoading,
    loadShop,
    buyShopItem,
    loadUnlocks,
    clearLastBuy,
    // Phase 12.10.D
    chains,
    chainsLoading,
    chainsError,
    claimChainLoading,
    claimChainError,
    lastChainClaim,
    loadChains,
    claimChain,
    clearLastChainClaim,
  };
});
