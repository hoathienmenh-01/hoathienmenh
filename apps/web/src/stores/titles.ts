import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type { TitleDef } from '@xuantoi/shared';
import * as api from '@/api/titles';
import { useGameStore } from './game';

/**
 * Phase 11.9.C — server-authoritative Title (Danh hiệu) store.
 *
 * State mirror server `GET /character/titles`:
 *   - `owned`: rows đã unlock (sort `unlockedAt asc`).
 *   - `catalog`: full catalog snapshot từ server. FE render lock state qua
 *     so sánh `owned[].titleKey` với `catalog`.
 *   - `equipped`: title đang equip (`Character.title`) hoặc null. Cũng có
 *     ở `useGameStore().character.title`, store này keep `def` cho UI render
 *     mà không cần lookup catalog ở mọi consumer.
 *   - `loaded`: đã hydrate ít nhất 1 lần.
 *   - `inFlight`: đang gọi equip/unequip — race-protect double-click.
 *
 * Action `equip(titleKey)` / `unequip()`:
 *   - Server-authoritative — chờ response, refresh `equipped` + sync
 *     `useGameStore().character.title` từ response (server đã cập nhật).
 *   - Trả về `null` (success) hoặc error code. Caller map code → toast i18n
 *     key `titles.errors.{code}`.
 *
 * Computed `ownedKeys` / `ownedCount` / `unlockedRatio` cho UI summary.
 */
export const useTitlesStore = defineStore('titles', () => {
  const owned = ref<api.OwnedTitleRow[]>([]);
  const catalog = ref<readonly TitleDef[]>([]);
  const equipped = ref<api.EquippedTitle | null>(null);
  const loaded = ref(false);
  const inFlight = ref(false);

  const ownedKeys = computed(
    () => new Set(owned.value.map((row) => row.titleKey)),
  );
  const ownedCount = computed(() => owned.value.length);
  const totalCount = computed(() => catalog.value.length);
  const unlockedRatio = computed(() => {
    if (catalog.value.length === 0) return 0;
    return owned.value.length / catalog.value.length;
  });

  function isOwned(titleKey: string): boolean {
    return ownedKeys.value.has(titleKey);
  }

  function isEquipped(titleKey: string): boolean {
    return equipped.value !== null && equipped.value.titleKey === titleKey;
  }

  async function fetchState(): Promise<void> {
    const res = await api.getTitlesState();
    owned.value = res.owned;
    catalog.value = res.catalog;
    equipped.value = res.equipped;
    loaded.value = true;
  }

  /**
   * Server-authoritative equip. Returns error code (string) on failure,
   * `null` on success. Patches `useGameStore().character.title` từ server
   * response để header HUD update ngay không cần refetch state.
   */
  async function equip(titleKey: string): Promise<string | null> {
    if (inFlight.value) return 'IN_FLIGHT';
    if (!isOwned(titleKey)) return 'TITLE_NOT_OWNED';
    if (isEquipped(titleKey)) return 'ALREADY_EQUIPPED';
    inFlight.value = true;
    try {
      const res = await api.equipTitle(titleKey);
      equipped.value = res.equipped;
      const game = useGameStore();
      if (game.character) game.character = res.character;
      return null;
    } catch (e) {
      return extractErrorCode(e);
    } finally {
      inFlight.value = false;
    }
  }

  /**
   * Server-authoritative unequip. Idempotent — server no-op nếu chưa equip,
   * client cũng skip API call cho UX cleaner.
   */
  async function unequip(): Promise<string | null> {
    if (inFlight.value) return 'IN_FLIGHT';
    if (equipped.value === null) return 'NOT_EQUIPPED';
    inFlight.value = true;
    try {
      const res = await api.unequipTitle();
      equipped.value = null;
      const game = useGameStore();
      if (game.character) game.character = res.character;
      return null;
    } catch (e) {
      return extractErrorCode(e);
    } finally {
      inFlight.value = false;
    }
  }

  function reset(): void {
    owned.value = [];
    catalog.value = [];
    equipped.value = null;
    loaded.value = false;
    inFlight.value = false;
  }

  return {
    owned,
    catalog,
    equipped,
    loaded,
    inFlight,
    ownedKeys,
    ownedCount,
    totalCount,
    unlockedRatio,
    isOwned,
    isEquipped,
    fetchState,
    equip,
    unequip,
    reset,
  };
});

function extractErrorCode(e: unknown): string {
  return (
    (e as { code?: string }).code ??
    (e as { error?: { code?: string } }).error?.code ??
    'UNKNOWN'
  );
}
