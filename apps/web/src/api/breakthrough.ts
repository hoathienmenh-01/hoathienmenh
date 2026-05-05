import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 11 nâng cao §5 PR3 — Breakthrough RNG attempt + history UI API client.
 *
 * Wire 2 endpoint server-authoritative:
 *   - `POST /character/breakthrough/attempt` (Phase 11 nâng cao §5 PR2 wire #415):
 *     server roll RNG, ghi `BreakthroughAttemptLog`, advance realm khi success
 *     hoặc apply `tam_ma_light` debuff khi fail.
 *   - `GET /character/breakthrough/log` (Phase 11 nâng cao §5 PR3 prep #418):
 *     read-only audit log cho history view. Optional `?limit=N` (1..100,
 *     default 20).
 *
 * Mirror pattern `tribulation.ts` (Phase 11.6.D/G). BigInt fields server-side
 * cast → string giữ precision khi qua JSON.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(op: string): Error {
  return new Error(i18n.global.t(`common.apiFallback.${op}`));
}

/**
 * Chance breakdown của attempt — `BreakthroughChanceBreakdown` (Phase 11 nâng
 * cao §5 PR1 #413). All numeric fields, không cast.
 *
 *   - `baseChance`: chance gốc theo `nextRealmKey` lookup.
 *   - `rootPurityBonus`: bonus Linh căn purity ratio.
 *   - `methodAffinityBonus`: bonus Cultivation Method affinity với target realm.
 *   - `itemBonus`: bonus item buff (tâm ma kháng dược) — currently 0 MVP.
 *   - `rawChance`: `baseChance + bonuses` trước cap.
 *   - `finalChance`: clamp `rawChance` về `[0, BREAKTHROUGH_CHANCE_MAX_CAP]`.
 *   - `reason`: enum text 'lookup'/'no_root'/'no_method'/'capped'/'all' cho FE
 *     hiển thị tooltip giải thích.
 */
export interface BreakthroughChanceBreakdownView {
  reason: string;
  baseChance: number;
  rootPurityBonus: number;
  methodAffinityBonus: number;
  itemBonus: number;
  rawChance: number;
  finalChance: number;
}

/**
 * Debuff branch của outcome — populated khi `success=false` và BuffService
 * available trên server. `applied=true` ⇒ `key='tam_ma_light'` + `expiresAt`
 * ISO string (hiện tại 5 phút). `applied=false` ⇒ `key=null` + `expiresAt=null`
 * (legacy bootstrap or success branch).
 */
export interface BreakthroughDebuffView {
  applied: boolean;
  key: string | null;
  expiresAt: string | null;
}

/**
 * Outcome trả về sau 1 attempt. Mirror `toBreakthroughAttemptView` server
 * (`apps/api/.../character.controller.ts:1219`).
 *
 * Note: `character` field là `CharacterStatePayload` đầy đủ (post-attempt
 * state). FE thường update `useGameStore.character` từ trường này thay vì
 * refetch.
 */
export interface BreakthroughAttemptOutcomeView {
  success: boolean;
  fromRealmKey: string;
  fromRealmStage: number;
  toRealmKey: string;
  toRealmStage: number;
  breakdown: BreakthroughChanceBreakdownView;
  rngRoll: number;
  attemptIndex: number;
  logId: string;
  debuff: BreakthroughDebuffView;
  /** CharacterStatePayload — post-attempt state. FE update game store. */
  character: unknown;
}

/**
 * POST /character/breakthrough/attempt — server-authoritative RNG attempt.
 *
 * Throw object preserving `code` từ envelope (e.g. NOT_AT_PEAK, NO_CHARACTER,
 * UNAUTHENTICATED) hoặc fallback Error nếu data vắng.
 */
export async function attemptBreakthrough(): Promise<BreakthroughAttemptOutcomeView> {
  const { data } = await apiClient.post<
    Envelope<{ outcome: BreakthroughAttemptOutcomeView }>
  >('/character/breakthrough/attempt', {});
  if (!data.ok || !data.data) throw data.error ?? fallbackError('breakthrough');
  return data.data.outcome;
}

/**
 * View shape của 1 row trong history. Mirror `BreakthroughAttemptLogView`
 * server (`apps/api/.../character.service.ts:748`).
 *
 *   - BigInt fields (`expBefore`, `expAfter`) cast → string.
 *   - Date fields (`tamMaExpiresAt`, `createdAt`) cast → ISO string.
 *   - Numeric breakdown fields (`chance`, `baseChance`, `rngRoll`, etc.) preserve.
 */
export interface BreakthroughAttemptLogView {
  id: string;
  fromRealmKey: string;
  fromRealmStage: number;
  toRealmKey: string;
  toRealmStage: number;
  chance: number;
  baseChance: number;
  rootPurityBonus: number;
  methodAffinityBonus: number;
  itemBonus: number;
  rawChance: number;
  rngRoll: number;
  success: boolean;
  expBefore: string;
  expAfter: string;
  tamMaActive: boolean;
  tamMaExpiresAt: string | null;
  attemptIndex: number;
  createdAt: string;
}

/** Pagination defaults — match server `BREAKTHROUGH_LOG_DEFAULT_LIMIT`/`MAX_LIMIT`. */
export const BREAKTHROUGH_LOG_DEFAULT_LIMIT = 20;
export const BREAKTHROUGH_LOG_MAX_LIMIT = 100;

/**
 * GET /character/breakthrough/log?limit=N (Phase 11 nâng cao §5 PR3 prep #418).
 *
 * Idempotent GET. Server clamp `?limit` về [1, MAX] + fallback default nếu
 * invalid. Trả về DESC theo `createdAt`. Empty list nếu chưa từng attempt.
 *
 * Throw object preserving `code` từ envelope (e.g. UNAUTHENTICATED,
 * NO_CHARACTER) hoặc fallback Error nếu data vắng.
 */
export async function fetchAttemptLog(
  limit?: number,
): Promise<{ rows: BreakthroughAttemptLogView[]; limit: number }> {
  const url =
    limit !== undefined
      ? `/character/breakthrough/log?limit=${encodeURIComponent(String(limit))}`
      : '/character/breakthrough/log';
  const { data } = await apiClient.get<
    Envelope<{ rows: BreakthroughAttemptLogView[]; limit: number }>
  >(url);
  if (!data.ok || !data.data) throw data.error ?? fallbackError('breakthrough');
  return data.data;
}
