import type { BuffDef, BuffSource } from '@xuantoi/shared';
import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 11.8.D — Buff (Trạng thái) UI API client.
 *
 * Wire `GET /character/buffs` (Phase 11.8.D endpoint) cho HUD `BuffBar.vue`.
 * Server auto-prune expired buff trước khi return — client không cần lo
 * stale data, chỉ render countdown từ `expiresAt`.
 *
 * Server-authoritative — client KHÔNG có endpoint apply/remove buff. Buff
 * apply qua các flow khác (pill alchemy / sect aura on join / event /
 * tribulation Tâm Ma / boss debuff …). HUD chỉ display.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(op: string): Error {
  return new Error(i18n.global.t(`common.apiFallback.${op}`));
}

export interface ActiveBuffRow {
  buffKey: string;
  stacks: number;
  source: BuffSource;
  /** ISO timestamp from server. */
  expiresAt: string;
  def: BuffDef;
}

export async function getActiveBuffs(): Promise<ActiveBuffRow[]> {
  const { data } = await apiClient.get<Envelope<{ active: ActiveBuffRow[] }>>(
    '/character/buffs',
  );
  if (!data.ok || !data.data) throw data.error ?? fallbackError('buffsState');
  return data.data.active;
}
