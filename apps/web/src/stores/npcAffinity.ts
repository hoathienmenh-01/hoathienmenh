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
  };
});
