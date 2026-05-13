import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/cultivationMethodV2';

/**
 * Phase 26.3 — server-authoritative Cultivation Method V2 store (Pinia).
 *
 * State mirror server `GET /character/cultivation-methods-v2`:
 *   - `catalog`: 36 method entries với progression flags từ server.
 *   - `equippedSlots`: { slot, methodKey } cho 5 slot V2.
 *   - `aggregatedBonuses`: snapshot bonus tổng (UI display).
 *   - `cultivationRateMul` / `bodyRateMul`: multiplier để display.
 *   - `loaded`: hydrate ít nhất 1 lần chưa.
 *   - `inFlight`: Set<string> request đang chạy theo `methodKey:action`
 *     hoặc `slot:action` để race-protect double-click + spinner UI.
 *
 * Actions:
 *   - `fetchState()`            – GET state.
 *   - `unlock(methodKey)`       – POST /unlock.
 *   - `equip(methodKey, slot)`  – POST /equip.
 *   - `unequip(slot)`           – POST /unequip.
 *   - `upgrade(methodKey)`      – POST /upgrade.
 *   - `starUp(methodKey)`       – POST /star-up.
 *
 * Trả về `string | null`: `null` = success, string = i18n error code để
 * caller hiển thị toast `cultivationMethodV2.errors.<code>`.
 */
export const useCultivationMethodV2Store = defineStore('cultivationMethodV2', () => {
  const catalog = ref<api.CultivationMethodV2CatalogEntry[]>([]);
  const equippedSlots = ref<api.CultivationMethodV2EquippedSlot[]>([]);
  const aggregatedBonuses = ref<api.CultivationMethodV2AggregatedBonuses | null>(null);
  const cultivationRateMul = ref(1);
  const bodyRateMul = ref(1);
  const loaded = ref(false);
  const lastError = ref<string | null>(null);
  const inFlight = ref<Set<string>>(new Set());

  function applyState(state: api.CultivationMethodV2State): void {
    catalog.value = state.catalog;
    equippedSlots.value = state.equippedSlots;
    aggregatedBonuses.value = state.aggregatedBonuses;
    cultivationRateMul.value = state.cultivationRateMul;
    bodyRateMul.value = state.bodyRateMul;
    loaded.value = true;
    lastError.value = null;
  }

  function track(key: string): void {
    inFlight.value = new Set(inFlight.value).add(key);
  }

  function untrack(key: string): void {
    if (!inFlight.value.has(key)) return;
    const next = new Set(inFlight.value);
    next.delete(key);
    inFlight.value = next;
  }

  function busy(key: string): boolean {
    return inFlight.value.has(key);
  }

  function extractErrorCode(e: unknown): string {
    if (e && typeof e === 'object' && 'code' in e) {
      const code = (e as { code?: string }).code;
      if (typeof code === 'string') return code;
    }
    return 'UNKNOWN';
  }

  async function fetchState(): Promise<string | null> {
    track('state');
    try {
      applyState(await api.getCultivationMethodV2State());
      return null;
    } catch (e) {
      const code = extractErrorCode(e);
      lastError.value = code;
      return code;
    } finally {
      untrack('state');
    }
  }

  async function unlock(methodKey: string): Promise<string | null> {
    const k = `${methodKey}:unlock`;
    if (busy(k)) return 'IN_FLIGHT';
    track(k);
    try {
      applyState(await api.unlockCultivationMethodV2(methodKey));
      return null;
    } catch (e) {
      const code = extractErrorCode(e);
      lastError.value = code;
      return code;
    } finally {
      untrack(k);
    }
  }

  async function equip(
    methodKey: string,
    slot: api.MethodEquipSlotV2,
  ): Promise<string | null> {
    const k = `${methodKey}:equip:${slot}`;
    if (busy(k)) return 'IN_FLIGHT';
    track(k);
    try {
      applyState(await api.equipCultivationMethodV2(methodKey, slot));
      return null;
    } catch (e) {
      const code = extractErrorCode(e);
      lastError.value = code;
      return code;
    } finally {
      untrack(k);
    }
  }

  async function unequip(slot: api.MethodEquipSlotV2): Promise<string | null> {
    const k = `slot:${slot}:unequip`;
    if (busy(k)) return 'IN_FLIGHT';
    track(k);
    try {
      applyState(await api.unequipCultivationMethodV2(slot));
      return null;
    } catch (e) {
      const code = extractErrorCode(e);
      lastError.value = code;
      return code;
    } finally {
      untrack(k);
    }
  }

  async function upgrade(methodKey: string): Promise<string | null> {
    const k = `${methodKey}:upgrade`;
    if (busy(k)) return 'IN_FLIGHT';
    track(k);
    try {
      applyState(await api.upgradeCultivationMethodV2(methodKey));
      return null;
    } catch (e) {
      const code = extractErrorCode(e);
      lastError.value = code;
      return code;
    } finally {
      untrack(k);
    }
  }

  async function starUp(methodKey: string): Promise<string | null> {
    const k = `${methodKey}:starUp`;
    if (busy(k)) return 'IN_FLIGHT';
    track(k);
    try {
      applyState(await api.starUpCultivationMethodV2(methodKey));
      return null;
    } catch (e) {
      const code = extractErrorCode(e);
      lastError.value = code;
      return code;
    } finally {
      untrack(k);
    }
  }

  // ───────────────────────────────────────────────────────────────────
  // Selectors / computed helpers (UI-friendly).
  // ───────────────────────────────────────────────────────────────────

  const equippedByMethod = computed<Map<string, api.MethodEquipSlotV2>>(() => {
    const m = new Map<string, api.MethodEquipSlotV2>();
    for (const e of equippedSlots.value) m.set(e.methodKey, e.slot);
    return m;
  });

  const equippedBySlot = computed<
    Map<api.MethodEquipSlotV2, api.CultivationMethodV2CatalogEntry | null>
  >(() => {
    const m = new Map<api.MethodEquipSlotV2, api.CultivationMethodV2CatalogEntry | null>();
    const slots: api.MethodEquipSlotV2[] = ['QI_MAIN', 'BODY_MAIN', 'SUPPORT', 'SECT', 'SPECIAL'];
    for (const s of slots) m.set(s, null);
    for (const slot of equippedSlots.value) {
      const entry = catalog.value.find((e) => e.methodKey === slot.methodKey) ?? null;
      m.set(slot.slot, entry);
    }
    return m;
  });

  function findEntry(
    methodKey: string,
  ): api.CultivationMethodV2CatalogEntry | undefined {
    return catalog.value.find((e) => e.methodKey === methodKey);
  }

  return {
    // state
    catalog,
    equippedSlots,
    aggregatedBonuses,
    cultivationRateMul,
    bodyRateMul,
    loaded,
    lastError,
    inFlight,
    // actions
    fetchState,
    unlock,
    equip,
    unequip,
    upgrade,
    starUp,
    busy,
    // selectors
    equippedByMethod,
    equippedBySlot,
    findEntry,
  };
});
