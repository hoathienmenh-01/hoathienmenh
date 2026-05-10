import { i18n } from '@/i18n';
import { apiClient } from './client';

/**
 * Phase 11.6.D — Tribulation (Thiên Kiếp) UI API client.
 *
 * Wire `POST /character/tribulation` (Phase 11.6.B server endpoint) cho
 * Pinia `useTribulationStore` + `TribulationView.vue`.
 *
 * Server-authoritative:
 *   - Body rỗng — server resolve `c.realmKey → nextRealm(c.realmKey)` từ
 *     character state (avoid client spoof `toRealmKey`).
 *   - Server validate peak gate (stage 9 + đủ EXP cost) + cooldown +
 *     `getTribulationForBreakthrough(c.realmKey, next.key)` def.
 *   - Server simulate kiếp deterministic + ghi `TribulationAttemptLog`.
 *
 * `TribulationAttemptOutcome` cấu trúc: `success` boolean + reward (linhThach
 * + expBonus + titleKey nếu success) | penalty (expLoss + cooldownAt +
 * taoMaActive + taoMaExpiresAt nếu fail).
 *
 * BigInt fields (`expBonus`/`expBefore`/`expAfter`/`expLoss`) auto-stringify
 * qua Prisma JSON serializer → expose `string` ở frontend type.
 */

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fallbackError(op: string): Error {
  return new Error(i18n.global.t(`common.apiFallback.${op}`));
}

/** Reward branch của outcome — chỉ populated khi `success=true`. */
export interface TribulationRewardView {
  /** Linh thạch reward (server cấp qua CurrencyLedger TRIBULATION_REWARD). */
  linhThach: number;
  /** EXP bonus thêm trên EXP cảnh giới mới (server cộng vào `c.exp`). */
  expBonus: string;
  /** Title key (e.g. `do_kiep_thanh_cong`). Optional. */
  titleKey: string | null;
}

/** Penalty branch của outcome — chỉ populated khi `success=false`. */
export interface TribulationPenaltyView {
  /** EXP trước khi fail. */
  expBefore: string;
  /** EXP sau khi fail (deducted). */
  expAfter: string;
  /** EXP rớt (`expBefore - expAfter`). */
  expLoss: string;
  /** Cooldown timestamp ISO (server tính `now + cooldownMinutes`). */
  cooldownAt: string;
  /** Có bị Tâm Ma debuff không (rolled với `taoMaDebuffChance`). */
  taoMaActive: boolean;
  /** Tâm Ma expires ISO. Null nếu `taoMaActive=false`. */
  taoMaExpiresAt: string | null;
}

/**
 * Phase 14.3.C — consumed support item entry trong outcome view.
 * Server resolve label + bonus từ catalog (FE không tự tra catalog để
 * giữ source-of-truth ở server / shared package).
 */
export interface TribulationConsumedSupportItemView {
  itemKey: string;
  label: string;
  bonus: number;
}

/**
 * Phase 14.3.C — successChance breakdown trong outcome (mirror preview).
 * Cho phép FE so sánh predicted vs actual sau attempt nếu cần.
 */
export interface TribulationSuccessChanceBreakdownOutcomeView {
  base: number;
  supportBonus: number;
  elementAdjustment: number;
  raw: number;
  final: number;
  floorHit: boolean;
  ceilHit: boolean;
}

/** Outcome trả về sau 1 attempt. Mirror `TribulationAttemptOutcome` server. */
export interface TribulationOutcomeView {
  success: boolean;
  tribulationKey: string;
  fromRealmKey: string;
  toRealmKey: string;
  /** 'minor' | 'major' | 'heavenly' | 'saint' */
  severity: string;
  /** 'lei' | 'hoa' | 'bang' | 'phong' | 'tam' */
  type: string;
  wavesCompleted: number;
  totalDamage: number;
  finalHp: number;
  attemptIndex: number;
  reward: TribulationRewardView | null;
  penalty: TribulationPenaltyView | null;
  /** Audit log id (`TribulationAttemptLog.id`). */
  logId: string;
  /**
   * Phase 14.3.C — danh sách consumed support items (label resolved từ
   * server catalog). Empty array nếu attempt KHÔNG dùng item hỗ trợ.
   */
  consumedSupportItems: TribulationConsumedSupportItemView[];
  /** Phase 14.3.C — total support bonus đã apply (sau cap). */
  supportTotalBonus: number;
  /** Phase 14.3.C — successChance breakdown server-side recalc. */
  successChance: TribulationSuccessChanceBreakdownOutcomeView;
}

/**
 * POST /character/tribulation — server-authoritative tribulation attempt.
 *
 * Phase 14.3.C — body có thể include `selectedSupportItemKeys: string[]`
 * (≤ 3 keys, chỉ consumable support items theo shared validator). Server
 * verify ownership in tx + consume in tx + recalc support bonus from
 * scratch (không tin FE bonus values).
 *
 * Throw object preserving `code` từ envelope (test fixture compat) hoặc
 * fallback Error nếu data vắng.
 */
export async function attemptTribulation(
  selectedSupportItemKeys?: readonly string[],
): Promise<TribulationOutcomeView> {
  const body =
    selectedSupportItemKeys && selectedSupportItemKeys.length > 0
      ? { selectedSupportItemKeys: [...selectedSupportItemKeys] }
      : {};
  const { data } = await apiClient.post<
    Envelope<{ tribulation: TribulationOutcomeView }>
  >('/character/tribulation', body);
  if (!data.ok || !data.data) throw data.error ?? fallbackError('tribulation');
  return data.data.tribulation;
}

/**
 * Phase 11.6.G — view shape của 1 row trong history list. Mirror
 * `TribulationAttemptLogView` server (`apps/api/.../tribulation.service.ts`).
 *
 * BigInt fields (`expBefore`/`expAfter`/`expLoss`/`expBonusReward`) cast
 * → string ở server side để giữ precision khi qua JSON.
 *
 * Date fields (`createdAt`/`cooldownAt`/`taoMaExpiresAt`) cast → ISO string.
 */
export interface TribulationAttemptLogView {
  id: string;
  tribulationKey: string;
  fromRealmKey: string;
  toRealmKey: string;
  severity: string;
  type: string;
  success: boolean;
  wavesCompleted: number;
  totalDamage: number;
  finalHp: number;
  hpInitial: number;
  expBefore: string;
  expAfter: string;
  expLoss: string;
  taoMaActive: boolean;
  taoMaExpiresAt: string | null;
  cooldownAt: string | null;
  linhThachReward: number;
  expBonusReward: string;
  titleKeyReward: string | null;
  attemptIndex: number;
  taoMaRoll: number;
  createdAt: string;
}

/** Pagination defaults — match server `TRIBULATION_LOG_DEFAULT_LIMIT`/`MAX_LIMIT`. */
export const TRIBULATION_LOG_DEFAULT_LIMIT = 20;
export const TRIBULATION_LOG_MAX_LIMIT = 100;

/**
 * Phase 11.6.G — GET /character/tribulation/log?limit=N (Phase 11.6.F endpoint).
 *
 * Idempotent GET. Server clamp `?limit` về [1, MAX] + fallback default nếu
 * invalid. Trả về DESC theo `createdAt`. Empty list nếu chưa từng attempt.
 *
 * Throw object preserving `code` từ envelope hoặc fallback Error nếu data
 * vắng.
 */
export async function fetchAttemptLog(
  limit?: number,
): Promise<{ rows: TribulationAttemptLogView[]; limit: number }> {
  const url =
    limit !== undefined
      ? `/character/tribulation/log?limit=${encodeURIComponent(String(limit))}`
      : '/character/tribulation/log';
  const { data } = await apiClient.get<
    Envelope<{ rows: TribulationAttemptLogView[]; limit: number }>
  >(url);
  if (!data.ok || !data.data) throw data.error ?? fallbackError('tribulation');
  return data.data;
}

// ── Phase 14.3.A — preview shape (read-only deterministic estimate) ─────────

/** Mirror server `TribulationDef` subset surfaced trong preview. */
export interface TribulationPreviewDefView {
  key: string;
  name: string;
  description: string;
  type: string;
  severity: string;
  wavesCount: number;
}

/**
 * Mirror `TribulationSuccessChanceBreakdown` từ shared layer.
 *
 * Phase 14.3.B: align với server response —
 *   - `supportBonus`: tổng additive supports bonus (sau clamp).
 *   - `elementAdjustment`: bonus/penalty Ngũ Hành affinity primary vs kiếp.
 *   - `raw`: `base + supportBonus + elementAdjustment` (pre-clamp).
 *   - `floorHit` / `ceilHit`: warning UX khi clamp về [FLOOR, CEIL].
 */
export interface TribulationSuccessChanceBreakdownView {
  base: number;
  supportBonus: number;
  elementAdjustment: number;
  raw: number;
  final: number;
  floorHit: boolean;
  ceilHit: boolean;
}

/**
 * Mirror `ComposedTribulationSupport.entries[]` + `TribulationSupportEntry`.
 *
 * Phase 14.3.B: tooltip-friendly fields:
 *   - `source`: 'item' | 'buff' | 'equipment' | 'talent' | 'spirit_root'.
 *   - `label`: tên hiển thị FE (catalog name) — optional, fallback `key`.
 *   - `element`: hệ Ngũ Hành nếu entry là element resist/affinity.
 */
export interface TribulationSupportEntryView {
  source: string;
  key: string;
  bonus: number;
  label?: string | null;
  element?: string | null;
}

/** Mirror `TribulationRewardHint` (BigInt-safe — `expBonus` là string). */
export interface TribulationRewardHintView {
  linhThach: number;
  expBonus: string;
  titleKey: string | null;
}

/** Mirror `TribulationPenaltyHint`. */
export interface TribulationPenaltyHintView {
  expLossRatio: number;
  cooldownMinutes: number;
  taoMaDebuffChance: number;
  taoMaDebuffDurationMinutes: number;
}

/**
 * Mirror server `TribulationPreview`. Read-only — không trigger RNG/log.
 * `null` nếu transition tiếp theo KHÔNG cần kiếp (low-tier hoặc realm cuối).
 */
/**
 * Phase 14.3.C — entry trong `availableSupportItems[]` của preview.
 * Server-resolved từ shared catalog × inventory qty (read-only, KHÔNG mutate).
 * FE dùng để render danh sách checkbox cho user chọn.
 */
export interface TribulationAvailableSupportItemView {
  itemKey: string;
  label: string;
  bonus: number;
  qty: number;
}

export interface TribulationPreviewView {
  requirement: true;
  fromRealmKey: string;
  toRealmKey: string;
  atPeak: boolean;
  def: TribulationPreviewDefView;
  successChance: TribulationSuccessChanceBreakdownView;
  supports: TribulationSupportEntryView[];
  supportTotalBonus: number;
  rewardHint: TribulationRewardHintView;
  penaltyHint: TribulationPenaltyHintView;
  cooldownAt: string | null;
  taoMaUntil: string | null;
  /**
   * Phase 14.3.C — consumable support items player có thể chọn (qty>0,
   * `equippedSlot=null`). FE render thành checkbox UI; selected keys gửi
   * cùng attempt body để server consume.
   */
  availableSupportItems: TribulationAvailableSupportItemView[];
  /**
   * Phase 14.3.C — số item hỗ trợ tối đa được chọn 1 lần attempt
   * (`TRIBULATION_MAX_SELECTED_SUPPORT_ITEMS`, hiện = 3).
   */
  maxSelectedSupportItems: number;
}

/**
 * Phase 14.3.A — GET /character/tribulation/preview.
 *
 * Server-authoritative read-only — recompute success chance + supports +
 * reward/penalty hint từ character state. Không trigger attempt/log/RNG.
 * Server trả `data.preview = null` nếu transition kế tiếp KHÔNG có catalog
 * kiếp (e.g. low-tier hoặc realm cuối).
 */
export async function fetchTribulationPreview(): Promise<TribulationPreviewView | null> {
  const { data } = await apiClient.get<
    Envelope<{ preview: TribulationPreviewView | null }>
  >('/character/tribulation/preview');
  if (!data.ok || !data.data) throw data.error ?? fallbackError('tribulation');
  return data.data.preview;
}

// ── Phase 14.3.D — Encounter system (start/current/resolve) ─────────────

/**
 * Mirror server `TribulationEncounterRowView`. Snapshot 1 row trong
 * `TribulationEncounter` table (state machine: pending | resolved).
 */
export interface TribulationEncounterRowView {
  id: string;
  tribulationKey: string;
  fromRealmKey: string;
  toRealmKey: string;
  encounterKey: string;
  effectType: string;
  element: string;
  difficulty: string;
  selectedSupportItemKeys: string[];
  state: string;
  startedAt: string;
  resolvedAt: string | null;
  resolvedAttemptLogId: string | null;
}

/**
 * Mirror server `TribulationEncounterSpec`. Per-character snapshot:
 * encounter flavor + player advantage.
 */
export interface TribulationEncounterSpecView {
  key: string;
  element: string;
  effectType: string;
  name: string;
  description: string;
  difficulty: string;
  phaseCount: number;
  successThreshold: number;
  requiredPowerHint: number;
  failPenaltyMultiplier: number;
  rewardHintMultiplier: number;
  playerHpMax: number;
  playerPrimaryElement: string | null;
  /** ∈ {-2, -1, 0, +1, +2} */
  elementAdvantage: number;
}

/**
 * Mirror server `TribulationEncounterCurrentView`. Read-only snapshot
 * encounter sắp tới (hoặc đang pending).
 */
export interface TribulationEncounterCurrentView {
  requirement: true;
  atPeak: boolean;
  fromRealmKey: string;
  toRealmKey: string;
  tribulationKey: string;
  severity: string;
  type: string;
  encounter: TribulationEncounterSpecView;
  successChance: TribulationSuccessChanceBreakdownView | null;
  pending: TribulationEncounterRowView | null;
  cooldownAt: string | null;
  taoMaUntil: string | null;
}

/**
 * Phase 14.3.D — GET /character/tribulation/encounter/current.
 *
 * Idempotent. Server trả `null` nếu transition không có catalog (low-tier).
 */
export async function fetchTribulationEncounterCurrent(): Promise<TribulationEncounterCurrentView | null> {
  const { data } = await apiClient.get<
    Envelope<{ encounter: TribulationEncounterCurrentView | null }>
  >('/character/tribulation/encounter/current');
  if (!data.ok || !data.data) throw data.error ?? fallbackError('tribulation');
  return data.data.encounter;
}

/**
 * Phase 14.3.D — POST /character/tribulation/encounter/start.
 *
 * Snapshot `selectedSupportItemKeys` vào row pending (server-authoritative,
 * KHÔNG consume item). Idempotent: re-call với cùng tribulation key trả
 * row pending hiện có.
 */
export async function startTribulationEncounter(
  selectedSupportItemKeys?: readonly string[],
): Promise<TribulationEncounterRowView> {
  const body =
    selectedSupportItemKeys && selectedSupportItemKeys.length > 0
      ? { selectedSupportItemKeys: [...selectedSupportItemKeys] }
      : {};
  const { data } = await apiClient.post<
    Envelope<{ encounter: TribulationEncounterRowView }>
  >('/character/tribulation/encounter/start', body);
  if (!data.ok || !data.data) throw data.error ?? fallbackError('tribulation');
  return data.data.encounter;
}

/**
 * Phase 14.3.D — POST /character/tribulation/encounter/resolve.
 *
 * Server simulate + consume + atomic update + transition pending → resolved.
 * Idempotent: re-call sau khi state='resolved' trả cached outcome (same
 * `logId`) — KHÔNG double breakthrough/consume/reward.
 */
export async function resolveTribulationEncounter(): Promise<TribulationOutcomeView> {
  const { data } = await apiClient.post<
    Envelope<{ tribulation: TribulationOutcomeView }>
  >('/character/tribulation/encounter/resolve', {});
  if (!data.ok || !data.data) throw data.error ?? fallbackError('tribulation');
  return data.data.tribulation;
}

// ── Phase 14.3.E.2 — Mini-Battle (Thiên Kiếp turn-based) FE client ────────

/**
 * Phase 14.3.E.2 — mirror server `TribulationMiniBattleState` (shared).
 * Re-export local alias để FE store/components dễ import từ 1 chỗ.
 */
export type TribulationMiniBattleStateView =
  | 'PENDING'
  | 'ACTIVE'
  | 'RESOLVED'
  | 'FAILED'
  | 'EXPIRED';

/** Mirror server `TribulationBattleAction`. */
export type TribulationBattleActionKey =
  | 'ATTACK'
  | 'DEFEND'
  | 'FOCUS'
  | 'CLEANSE'
  | 'CHANNEL';

/** Mirror server `TribulationMiniBattleEffectType`. */
export type TribulationMiniBattleEffectTypeView =
  | 'BURST'
  | 'SUSTAIN'
  | 'POISON_RECOVERY'
  | 'ARMOR_CRIT'
  | 'DEFENSE_ENDURANCE';

/** Mirror server `TribulationBattleEvent` (1 entry trong `actionLog`). */
export interface TribulationBattleEventView {
  phase: number;
  action: TribulationBattleActionKey;
  damage: number;
  shield: number;
  heal: number;
  dot: number;
  crit: boolean;
  result: 'ongoing' | 'win' | 'lose';
  messageKey: string;
}

/** Mirror server `TribulationMiniBattleSummary` (terminal state digest). */
export interface TribulationMiniBattleSummaryView {
  state: TribulationMiniBattleStateView;
  result: 'win' | 'lose' | null;
  phasesPlayed: number;
  totalDamageTaken: number;
  totalDamageDealt: number;
  totalHeal: number;
  totalShieldGained: number;
  finalPlayerHp: number;
  finalTribulationHp: number;
  effectType: TribulationMiniBattleEffectTypeView;
}

/**
 * Phase 14.3.E.2 — view shape của 1 row mini-battle, mirror server
 * `TribulationMiniBattleView` (BigInt-free, Date → ISO).
 */
export interface TribulationMiniBattleView {
  id: string;
  characterId: string;
  encounterId: string | null;
  tribulationKey: string;
  realmKey: string;
  effectType: TribulationMiniBattleEffectTypeView;
  element: string;
  difficulty: 'minor' | 'major' | 'heavenly' | 'saint';
  state: TribulationMiniBattleStateView;
  currentPhase: number;
  phaseCount: number;
  playerHp: number;
  playerHpMax: number;
  tribulationHp: number;
  tribulationHpMax: number;
  shield: number;
  dotStacks: number;
  focusCharge: number;
  seed: number;
  actionLog: TribulationBattleEventView[];
  result: TribulationMiniBattleSummaryView | null;
  startedAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Phase 14.3.E.2 — GET /character/tribulation/battle/current.
 *
 * Idempotent. Server trả `null` nếu user chưa start hoặc battle đã RESOLVED.
 * Khi backend disable feature flag, controller trả 501 → axios reject với
 * `code='TRIBULATION_MINI_BATTLE_UNAVAILABLE'`. Caller (store) catch +
 * map sang state "feature unavailable" → FE fallback flow Phase 14.3.D.
 */
export async function fetchCurrentTribulationBattle(): Promise<TribulationMiniBattleView | null> {
  const { data } = await apiClient.get<
    Envelope<{ battle: TribulationMiniBattleView | null }>
  >('/character/tribulation/battle/current');
  if (!data.ok || !data.data) throw data.error ?? fallbackError('tribulation');
  return data.data.battle;
}

/**
 * Phase 14.3.E.2 — POST /character/tribulation/battle/start.
 *
 * Body forward `selectedSupportItemKeys` mirror flow encounter (server
 * snapshot vào row encounter). Server reject `MINI_BATTLE_ALREADY_ACTIVE`
 * (409) nếu đã có row PENDING/ACTIVE — caller map sang resume UX.
 */
export async function startTribulationBattle(
  selectedSupportItemKeys?: readonly string[],
): Promise<TribulationMiniBattleView> {
  const body =
    selectedSupportItemKeys && selectedSupportItemKeys.length > 0
      ? { selectedSupportItemKeys: [...selectedSupportItemKeys] }
      : {};
  const { data } = await apiClient.post<
    Envelope<{ battle: TribulationMiniBattleView }>
  >('/character/tribulation/battle/start', body);
  if (!data.ok || !data.data) throw data.error ?? fallbackError('tribulation');
  return data.data.battle;
}

/**
 * Phase 14.3.E.2 — POST /character/tribulation/battle/action.
 *
 * Body shape: `{ battleId, action, clientNonce? }`. Server idempotent qua
 * `clientNonce` dedupe (cùng nonce → return current state, không apply
 * lần 2). Caller pass nonce để chống double-submit (mạng trùng / user click
 * 2 lần). Trả về snapshot mới (terminal nếu phase done).
 */
export async function submitTribulationBattleAction(args: {
  battleId: string;
  action: TribulationBattleActionKey;
  clientNonce?: string;
}): Promise<TribulationMiniBattleView> {
  const body: Record<string, unknown> = {
    battleId: args.battleId,
    action: args.action,
  };
  if (args.clientNonce !== undefined) {
    body.clientNonce = args.clientNonce;
  }
  const { data } = await apiClient.post<
    Envelope<{ battle: TribulationMiniBattleView }>
  >('/character/tribulation/battle/action', body);
  if (!data.ok || !data.data) throw data.error ?? fallbackError('tribulation');
  return data.data.battle;
}

/**
 * Phase 14.3.E.2 — POST /character/tribulation/battle/resolve.
 *
 * Trigger sau khi battle ở state RESOLVED/FAILED — apply WIN/LOSE outcome
 * (realm advance / cooldown / consume support items) idempotently. Trả về
 * `TribulationOutcomeView` mirror flow encounter resolve. 2nd call return
 * cached outcome (same `logId`).
 */
export async function resolveTribulationBattle(
  battleId: string,
): Promise<TribulationOutcomeView> {
  const { data } = await apiClient.post<
    Envelope<{ tribulation: TribulationOutcomeView }>
  >('/character/tribulation/battle/resolve', { battleId });
  if (!data.ok || !data.data) throw data.error ?? fallbackError('tribulation');
  return data.data.tribulation;
}
