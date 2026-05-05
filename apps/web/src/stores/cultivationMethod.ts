import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import * as api from '@/api/cultivationMethod';

/**
 * Phase 11.1.C — server-authoritative Cultivation Method (Công Pháp) store.
 *
 * State mirror server `GET /character/cultivation-method`:
 *   - `equippedMethodKey`: Key của method đang equip (hoặc null).
 *   - `learned`: Danh sách method đã học (key + source + learnedAt).
 *   - `loaded`: đã hydrate ít nhất 1 lần chưa.
 *   - `inFlight`: Set<methodKey> đang equip — race-protect double-click.
 *
 * Action `equip(methodKey)`:
 *   - Server-authoritative — chờ response, refresh cache, không optimistic.
 *   - Trả về `null` (success) hoặc error code (string). Caller dùng để hiển
 *     thị toast i18n `cultivationMethod.equip.errors.{code}`.
 *   - `inFlight` set/clear quanh request để UI disable button.
 *
 * KHÔNG có `learn` action — Phase 11.1.C scope chỉ expose `equip` (method
 * `learn` defer Phase 11.1.D khi có drop table mission/dungeon).
 */
export const useCultivationMethodStore = defineStore('cultivationMethod', () => {
  const equippedMethodKey = ref<string | null>(null);
  /**
   * Phase 11.1.E — bonus fraction từ Linh căn × Method element affinity
   * (`0` / `0.05` / `0.1`). Server-authoritative qua
   * `CultivationMethodState.equippedMethodElementAffinity`.
   */
  const equippedMethodElementAffinity = ref(0);
  const learned = ref<api.CultivationMethodLearnedRow[]>([]);
  const loaded = ref(false);
  const inFlight = ref<Set<string>>(new Set());

  function applyState(state: api.CultivationMethodState): void {
    equippedMethodKey.value = state.equippedMethodKey;
    equippedMethodElementAffinity.value = state.equippedMethodElementAffinity;
    learned.value = state.learned;
    loaded.value = true;
  }

  /**
   * Phase 11.1.E — UI badge label cho equipped method:
   *   - `0.10` → `"+10%"` (primary element match)
   *   - `0.05` → `"+5%"` (secondary element match)
   *   - else → `null` (ẩn badge — vô hệ method / khác hệ / legacy)
   *
   * Format `+N%` (no decimal, integer percent) — caller render bên cạnh
   * tên method qua `<span v-if="affinityPercentLabel">…</span>`.
   */
  const affinityPercentLabel = computed<string | null>(() => {
    const f = equippedMethodElementAffinity.value;
    if (f <= 0) return null;
    const pct = Math.round(f * 100);
    return `+${pct}%`;
  });

  /**
   * Phase 11.1.E — hint i18n key tương ứng tier match (primary / secondary):
   *   - `0.10` → `"cultivationMethod.affinity.primary"`
   *   - `0.05` → `"cultivationMethod.affinity.secondary"`
   *   - else → `null`
   *
   * Caller dùng để render tooltip / aria-label giải thích.
   */
  const affinityTierKey = computed<string | null>(() => {
    const f = equippedMethodElementAffinity.value;
    if (f >= 0.1) return 'cultivationMethod.affinity.primary';
    if (f >= 0.05) return 'cultivationMethod.affinity.secondary';
    return null;
  });

  async function fetchState(): Promise<void> {
    const state = await api.getCultivationMethodState();
    applyState(state);
  }

  function isEquipping(methodKey: string): boolean {
    return inFlight.value.has(methodKey);
  }

  function isEquipped(methodKey: string): boolean {
    return equippedMethodKey.value === methodKey;
  }

  /**
   * Server-authoritative equip. Returns error code (string) on failure,
   * `null` on success. Callers map code → toast i18n key.
   */
  async function equip(methodKey: string): Promise<string | null> {
    if (inFlight.value.has(methodKey)) return 'IN_FLIGHT';
    if (equippedMethodKey.value === methodKey) return 'ALREADY_EQUIPPED';
    const next = new Set(inFlight.value);
    next.add(methodKey);
    inFlight.value = next;
    try {
      const state = await api.equipCultivationMethod(methodKey);
      applyState(state);
      return null;
    } catch (e) {
      const code =
        (e as { code?: string }).code ??
        (e as { error?: { code?: string } }).error?.code ??
        'UNKNOWN';
      return code;
    } finally {
      const cleared = new Set(inFlight.value);
      cleared.delete(methodKey);
      inFlight.value = cleared;
    }
  }

  function reset(): void {
    equippedMethodKey.value = null;
    equippedMethodElementAffinity.value = 0;
    learned.value = [];
    loaded.value = false;
    inFlight.value = new Set();
  }

  return {
    equippedMethodKey,
    equippedMethodElementAffinity,
    learned,
    loaded,
    inFlight,
    affinityPercentLabel,
    affinityTierKey,
    fetchState,
    isEquipping,
    isEquipped,
    equip,
    reset,
  };
});
