import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/buffs';

/**
 * Phase 11.8.D — server-authoritative Buff (Trạng thái) store cho HUD
 * `BuffBar.vue`.
 *
 * State mirror server `GET /character/buffs`:
 *   - `active`: list active buff (sort `expiresAt asc`).
 *   - `loaded`: đã hydrate ít nhất 1 lần.
 *   - `lastFetchAt`: epoch ms — UI có thể dùng để stale-check.
 *
 * Server auto-prune expired trước khi return — store không cần tự prune. UI
 * countdown derive từ `expiresAt - now()`. Nếu UI tick qua expiry, gọi
 * `fetchState()` để re-sync (BuffBar handle 1Hz auto-refetch khi sắp hết).
 *
 * Computed:
 *   - `buffCount` / `debuffCount`: split theo `def.polarity`.
 *   - `activeKeys`: Set<buffKey> cho lookup nhanh.
 */
export const useBuffsStore = defineStore('buffs', () => {
  const active = ref<api.ActiveBuffRow[]>([]);
  const loaded = ref(false);
  const lastFetchAt = ref<number | null>(null);

  const buffCount = computed(
    () => active.value.filter((r) => r.def.polarity === 'buff').length,
  );
  const debuffCount = computed(
    () => active.value.filter((r) => r.def.polarity === 'debuff').length,
  );
  const totalCount = computed(() => active.value.length);
  const activeKeys = computed(
    () => new Set(active.value.map((r) => r.buffKey)),
  );

  async function fetchState(): Promise<void> {
    const list = await api.getActiveBuffs();
    active.value = list;
    loaded.value = true;
    lastFetchAt.value = Date.now();
  }

  function reset(): void {
    active.value = [];
    loaded.value = false;
    lastFetchAt.value = null;
  }

  return {
    active,
    loaded,
    lastFetchAt,
    buffCount,
    debuffCount,
    totalCount,
    activeKeys,
    fetchState,
    reset,
  };
});
