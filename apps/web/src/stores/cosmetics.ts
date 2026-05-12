import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import type { CosmeticType } from '@xuantoi/shared';
import * as api from '@/api/cosmetics';

/**
 * Phase 25.3 — Cosmetic wardrobe store.
 *
 * Mirrors GET /cosmetics/me. Equip/unequip mutate the loadout server-side
 * (transactional) and refresh local mirror. Never reads/writes character
 * stats — cosmetic is render-only.
 */
export const useCosmeticsStore = defineStore('cosmetics', () => {
  const catalog = ref<api.CosmeticView[]>([]);
  const owned = ref<api.CosmeticOwnedRow[]>([]);
  const loadout = ref<api.CosmeticLoadoutView>({
    activeAuraId: null,
    activeTitleId: null,
    activeAvatarFrameId: null,
    activeChatBadgeId: null,
    activeProfileDecorationId: null,
    activeElementAuraId: null,
  });
  const loaded = ref(false);
  const loading = ref(false);
  const mutating = ref(false);
  const lastError = ref<string | null>(null);

  async function fetchMe(): Promise<void> {
    loading.value = true;
    lastError.value = null;
    try {
      const me = await api.fetchCosmeticMe();
      catalog.value = me.catalog;
      owned.value = me.owned;
      loadout.value = me.loadout;
      loaded.value = true;
    } catch (e) {
      lastError.value =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
    } finally {
      loading.value = false;
    }
  }

  async function equip(cosmeticId: string): Promise<string | null> {
    if (mutating.value) return 'IN_FLIGHT';
    mutating.value = true;
    try {
      const next = await api.equipCosmetic(cosmeticId);
      loadout.value = next;
      // Refresh catalog flags.
      await fetchMe();
      return null;
    } catch (e) {
      const code =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
      lastError.value = code;
      return code;
    } finally {
      mutating.value = false;
    }
  }

  async function unequip(type: CosmeticType): Promise<string | null> {
    if (mutating.value) return 'IN_FLIGHT';
    mutating.value = true;
    try {
      const next = await api.unequipCosmetic(type);
      loadout.value = next;
      await fetchMe();
      return null;
    } catch (e) {
      const code =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
      lastError.value = code;
      return code;
    } finally {
      mutating.value = false;
    }
  }

  const ownedCount = computed(() => owned.value.length);

  return {
    catalog,
    owned,
    loadout,
    loaded,
    loading,
    mutating,
    lastError,
    ownedCount,
    fetchMe,
    equip,
    unequip,
  };
});
