import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 11.1.C — Cultivation Method (Công Pháp) UI API client.
 *
 * Wire `GET /character/cultivation-method` + `POST /character/cultivation-method/equip`
 * (Phase 11.1.B server endpoints) cho Pinia `useCultivationMethodStore` + UI
 * `CultivationMethodView.vue` (Công pháp tab).
 *
 * Server-authoritative: client chỉ gửi `methodKey`, server validate ownership
 * (đã `learn`) + realm + sect + forbiddenElement, rồi đổi
 * `Character.equippedCultivationMethodKey`.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(op: string): Error {
  return new Error(i18n.global.t(`common.apiFallback.${op}`));
}

export interface CultivationMethodLearnedRow {
  methodKey: string;
  /** 'starter' | 'sect_shop' | 'dungeon_drop' | 'boss_drop' | 'event' | 'quest_milestone' */
  source: string;
  /** ISO timestamp from server. */
  learnedAt: string;
}

export interface CultivationMethodState {
  /** Method key currently equipped, or `null` if no method equipped (legacy fallback handled by server). */
  equippedMethodKey: string | null;
  /**
   * Phase 11.1.E — Linh căn × Cultivation Method element affinity bonus
   * fraction (`0` / `0.05` / `0.1`). UI render badge "+10%" nếu primary
   * cùng hệ method, "+5%" nếu secondary cùng hệ, ẩn nếu 0 (khác hệ /
   * vô hệ method / legacy character). Server-authoritative — UI chỉ
   * display, không tự tính.
   *
   * Backward-compat: nếu envelope cũ (pre-Phase 11.1.E) thiếu field này,
   * client default 0 (no bonus) qua `?? 0` trong `getCultivationMethodState`.
   */
  equippedMethodElementAffinity: number;
  learned: CultivationMethodLearnedRow[];
}

/**
 * Wire-shape — server có thể trả thiếu `equippedMethodElementAffinity` cho
 * client connect tới API server pre-Phase-11.1.E. `normalize()` default 0.
 */
interface CultivationMethodStateWire {
  equippedMethodKey: string | null;
  equippedMethodElementAffinity?: number;
  learned: CultivationMethodLearnedRow[];
}

function normalize(wire: CultivationMethodStateWire): CultivationMethodState {
  return {
    equippedMethodKey: wire.equippedMethodKey,
    equippedMethodElementAffinity: wire.equippedMethodElementAffinity ?? 0,
    learned: wire.learned,
  };
}

export async function getCultivationMethodState(): Promise<CultivationMethodState> {
  const { data } = await apiClient.get<
    Envelope<{ cultivationMethod: CultivationMethodStateWire }>
  >('/character/cultivation-method');
  if (!data.ok || !data.data) throw data.error ?? fallbackError('cultivationMethodState');
  return normalize(data.data.cultivationMethod);
}

export async function equipCultivationMethod(
  methodKey: string,
): Promise<CultivationMethodState> {
  const { data } = await apiClient.post<
    Envelope<{ cultivationMethod: CultivationMethodStateWire }>
  >('/character/cultivation-method/equip', { methodKey });
  if (!data.ok || !data.data) throw data.error ?? fallbackError('cultivationMethodEquip');
  return normalize(data.data.cultivationMethod);
}
