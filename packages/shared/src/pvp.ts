/**
 * Phase 29.0 — PvP Foundation V1 (shared types).
 *
 * Unified PvP layer that gathers all PvP-flavored modes into a single
 * type system so admin / anti-cheat / audit / battle-log can operate
 * uniformly across Arena (Phase 14.1.B/C), Sect War (Phase 18.x),
 * Territory (Phase 19.x) and the new Duel/Friendly Sparring foundation.
 *
 * Scope (this module is pure data + validators, NO IO):
 *   1. PvpMode / PvpBattleStatus / PvpResult / PvpSnapshotType enums.
 *   2. PvpBattleSnapshot / PvpBattleLog shapes.
 *   3. PvpDefenseProfileDef (saved snapshot for async defender combat).
 *   4. PvpBalancePolicy (cap / cooldown / forbidden-reward / power-gap).
 *   5. PvpAnomalyType (8 detector signals).
 *   6. Validators: validatePvpBalancePolicy / validatePvpDefenseProfile /
 *      validatePvpSnapshot / validatePvpBattleResolve.
 *   7. Helpers: computePvpPowerGap / shouldBlockChallengeByPowerGap /
 *      computeFriendlyMatch / classifyPvpAnomaly.
 *   8. PVP_ERROR_CODES (22 spec codes) + PVP_ADMIN_ACTION_TYPES re-export.
 *
 * Anti-P2W (locked in here, enforced at runtime by services):
 *   - `forbiddenRewardItemKeys` ⊇ `FORBIDDEN_REWARD_ITEM_KEYS` (monetization).
 *   - `forbiddenRewardItemKeys` ⊇ `ADMIN_FORBIDDEN_GRANT_ITEMS` (admin grant).
 *   - `maxRewardTierDelta` ≥ 0 (server clamps reward tier ≤ source/ranking).
 *   - `friendly sparring` produces NO reward (forced rewardGranted=false).
 *   - `maxDailyPaidChallenge` ≤ `maxDailyChallenge / 4` (cannot whale-out).
 *   - PvP reward MUST flow through ledger (validator forbids inline grants).
 *
 * Not part of PR1 (will follow in PR2+):
 *   - Battlefield-node-based Sect War (current sect-war is activity-scoring).
 *   - Active Territory CHALLENGE (current territory is influence-passive).
 *   - Cross-shard / liên server matchmaking.
 *   - WS push for defender notification on challenge.
 */

import {
  FORBIDDEN_REWARD_ITEM_KEYS,
} from './monetization-systems';
import {
  ADMIN_FORBIDDEN_GRANT_ITEMS,
} from './admin-control-center';

// ---------------------------------------------------------------------------
// 1. PvpMode — phân loại trận PvP
// ---------------------------------------------------------------------------

/**
 * Tất cả mode PvP áp vào unified battle log + balance policy.
 *
 *   - `DUEL`: khiêu chiến trực tiếp (cá nhân ↔ cá nhân), không cướp đồ.
 *   - `ARENA`: arena async (Phase 14.1.B/C). Cần seasonKey + rating delta.
 *   - `SECT_WAR`: trận tông môn ↔ tông môn (Phase 18.x + Phase 29.x node).
 *   - `TERRITORY_WAR`: tranh đoạt linh mạch (Phase 19.x + Phase 29.x active).
 *   - `EVENT_PVP`: PvP mode trong event runtime (Phase 28.0 Event Builder).
 *   - `FRIENDLY_SPARRING`: trận thử build, KHÔNG có reward, KHÔNG đổi rating.
 */
export type PvpMode =
  | 'DUEL'
  | 'ARENA'
  | 'SECT_WAR'
  | 'TERRITORY_WAR'
  | 'EVENT_PVP'
  | 'FRIENDLY_SPARRING';

export const PVP_MODES: readonly PvpMode[] = [
  'DUEL',
  'ARENA',
  'SECT_WAR',
  'TERRITORY_WAR',
  'EVENT_PVP',
  'FRIENDLY_SPARRING',
] as const;

export function isPvpMode(value: unknown): value is PvpMode {
  return typeof value === 'string' && (PVP_MODES as readonly string[]).includes(value);
}

/** Mode tạo reward thật (loại trừ FRIENDLY_SPARRING). */
export const REWARDING_PVP_MODES: readonly PvpMode[] = [
  'DUEL',
  'ARENA',
  'SECT_WAR',
  'TERRITORY_WAR',
  'EVENT_PVP',
] as const;

export function isRewardingPvpMode(mode: PvpMode): boolean {
  return (REWARDING_PVP_MODES as readonly string[]).includes(mode);
}

// ---------------------------------------------------------------------------
// 2. PvpBattleStatus
// ---------------------------------------------------------------------------

/**
 * Lifecycle 1 PvP battle. `INVALIDATED` chỉ set bởi admin (audit) khi phát
 * hiện gian lận sau resolve — KHÔNG rollback reward đã grant (audit log
 * + manual REFUND).
 */
export type PvpBattleStatus =
  | 'PENDING'
  | 'RESOLVED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'INVALIDATED';

export const PVP_BATTLE_STATUSES: readonly PvpBattleStatus[] = [
  'PENDING',
  'RESOLVED',
  'CANCELLED',
  'EXPIRED',
  'INVALIDATED',
] as const;

export function isPvpBattleStatus(value: unknown): value is PvpBattleStatus {
  return (
    typeof value === 'string' &&
    (PVP_BATTLE_STATUSES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// 3. PvpResult
// ---------------------------------------------------------------------------

export type PvpResult =
  | 'ATTACKER_WIN'
  | 'DEFENDER_WIN'
  | 'DRAW'
  | 'FORFEIT';

export const PVP_RESULTS: readonly PvpResult[] = [
  'ATTACKER_WIN',
  'DEFENDER_WIN',
  'DRAW',
  'FORFEIT',
] as const;

export function isPvpResult(value: unknown): value is PvpResult {
  return (
    typeof value === 'string' &&
    (PVP_RESULTS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// 4. PvpSnapshotType
// ---------------------------------------------------------------------------

export type PvpSnapshotType =
  | 'ATTACKER'
  | 'DEFENDER'
  | 'SECT_MEMBER'
  | 'NPC_GUARDIAN';

export const PVP_SNAPSHOT_TYPES: readonly PvpSnapshotType[] = [
  'ATTACKER',
  'DEFENDER',
  'SECT_MEMBER',
  'NPC_GUARDIAN',
] as const;

export function isPvpSnapshotType(value: unknown): value is PvpSnapshotType {
  return (
    typeof value === 'string' &&
    (PVP_SNAPSHOT_TYPES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// 5. PvpBattleSnapshot — chụp stats tại thời điểm tạo trận
// ---------------------------------------------------------------------------

/**
 * Snapshot pull từ `CombatActorSnapshot` (Phase 14.1.A) + một số trường
 * PvP-specific. Mục đích: trận đã queue/resolve KHÔNG bị ảnh hưởng khi
 * player đổi trang bị / công pháp / pháp bảo sau đó.
 *
 *   - `totalPower` = lực chiến tổng (đã include qi+body+equipment+method+artifact).
 *   - `realmOrder` = realm tu vi ở thời điểm queue.
 *   - `bodyRealmOrder` = realm luyện thể (nullable nếu chưa unlock body).
 *   - `elementAffinity` = ngũ hành chính (Kim/Mộc/Thủy/Hỏa/Thổ).
 *   - `activeMethods` / `equippedArtifacts` / `activeSkills` = key array,
 *     dùng cho replay summary.
 */
export interface PvpBattleSnapshot {
  /** Numeric stable id (hash cuid → 32-bit) cho compat với combat module. */
  characterId: number;
  /** Original cuid string id (DB ref), optional vì test có thể skip. */
  characterKey?: string;
  /** Display name lúc snapshot — UI viewer dùng. */
  displayName?: string;
  /** Realm key (e.g. "luyen_khi_1"). */
  realmKey?: string;
  realmOrder: number;
  /** Tier trong realm (1–10) — UI viewer. */
  realmStage?: number;
  /** Level numeric — UI viewer. */
  level?: number;
  bodyRealmOrder?: number | null;
  totalPower: number;
  qiPower?: number;
  bodyPower?: number;
  equipmentPower?: number;
  methodPower?: number;
  artifactPower?: number;
  elementAffinity?: string | null;
  activeSkills?: readonly string[];
  activeMethods?: readonly string[];
  equippedArtifacts?: readonly string[];
  defensiveStats?: Readonly<Record<string, number>>;
  offensiveStats?: Readonly<Record<string, number>>;
  /** Stats raw (hp/hpMax/mp/mpMax/spirit/speed/luck) tại lúc snapshot. */
  stats?: Readonly<Record<string, number>>;
  snapshotType: PvpSnapshotType;
  createdAt: string; // ISO datetime
}

// ---------------------------------------------------------------------------
// 6. PvpBattleLog — unified log shape
// ---------------------------------------------------------------------------

/**
 * Một dòng battle log trong battle log viewer (player + admin xem chung).
 *
 *   - `roundsJson` = mảng round delta (không cần frame-by-frame, chỉ tóm tắt).
 *   - `rewardJson` = mô tả reward đã grant (KHÔNG dùng để re-grant; chỉ display).
 *   - `ratingChangeJson` = optional, chỉ khi mode = ARENA / DUEL.
 *   - `sourceModuleKey` = arena / sect-war / territory / pvp / event để
 *     trace ngược về module xử lý.
 */
export interface PvpBattleLog {
  battleId: string;
  mode: PvpMode;
  attackerSnapshot: PvpBattleSnapshot;
  defenderSnapshot: PvpBattleSnapshot;
  result: PvpResult;
  status: PvpBattleStatus;
  roundsJson: unknown;
  rewardJson?: unknown;
  ratingChangeJson?: unknown;
  sourceModuleKey: string;
  createdAt: string;
  resolvedAt?: string | null;
}

// ---------------------------------------------------------------------------
// 7. PvpDefenseProfileDef — saved defense formation
// ---------------------------------------------------------------------------

/**
 * Player có thể lưu 1 "defense formation" (snapshot kỹ năng/công pháp/pháp
 * bảo dùng khi BỊ đánh). Khi nhận challenge:
 *   1. Server load `PvpDefenseProfile.snapshotJson`.
 *   2. Nếu KHÔNG có profile → fallback build hiện tại.
 *   3. Nếu CÓ profile nhưng player thay đổi cấu hình quá xa → vẫn dùng
 *      snapshot (KHÔNG rebuild theo current).
 */
export interface PvpDefenseProfileDef {
  characterId: number;
  /** Original cuid string id (DB ref) — optional, matches PvpBattleSnapshot.characterKey. */
  characterKey?: string;
  snapshot: PvpBattleSnapshot;
  /** Note tự do — tên build do player đặt (ví dụ: "Đan Dược Tu", "Hỏa Pháp"). */
  label?: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 8. PvpAnomalyType — anti-cheat signal
// ---------------------------------------------------------------------------

export type PvpAnomalyType =
  | 'PVP_POWER_JUMP_BEFORE_MATCH'
  | 'PVP_DAMAGE_OUTLIER'
  | 'ARENA_RATING_GAIN_OUTLIER'
  | 'ARENA_TARGET_FARMING'
  | 'SECT_WAR_SCORE_OUTLIER'
  | 'TERRITORY_PRODUCTION_DUPLICATE_CLAIM'
  | 'SEASON_REWARD_DOUBLE_CLAIM'
  | 'ROSTER_SWAP_EXPLOIT';

export const PVP_ANOMALY_TYPES: readonly PvpAnomalyType[] = [
  'PVP_POWER_JUMP_BEFORE_MATCH',
  'PVP_DAMAGE_OUTLIER',
  'ARENA_RATING_GAIN_OUTLIER',
  'ARENA_TARGET_FARMING',
  'SECT_WAR_SCORE_OUTLIER',
  'TERRITORY_PRODUCTION_DUPLICATE_CLAIM',
  'SEASON_REWARD_DOUBLE_CLAIM',
  'ROSTER_SWAP_EXPLOIT',
] as const;

export function isPvpAnomalyType(value: unknown): value is PvpAnomalyType {
  return (
    typeof value === 'string' &&
    (PVP_ANOMALY_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Default risk weight per anomaly. Server cộng dồn weight trong 24h sliding
 * window → nếu vượt threshold → suspend reward claim + auto raise admin
 * review queue.
 */
export const PVP_ANOMALY_RISK_WEIGHT: Readonly<Record<PvpAnomalyType, number>> = {
  PVP_POWER_JUMP_BEFORE_MATCH: 0.8,
  PVP_DAMAGE_OUTLIER: 0.6,
  ARENA_RATING_GAIN_OUTLIER: 0.7,
  ARENA_TARGET_FARMING: 0.9,
  SECT_WAR_SCORE_OUTLIER: 0.7,
  TERRITORY_PRODUCTION_DUPLICATE_CLAIM: 1.0,
  SEASON_REWARD_DOUBLE_CLAIM: 1.0,
  ROSTER_SWAP_EXPLOIT: 1.0,
};

// ---------------------------------------------------------------------------
// 9. PvpBalancePolicy — caps + cooldowns + forbidden rewards
// ---------------------------------------------------------------------------

export interface PvpBalancePolicy {
  /** Số trận challenge miễn phí / ngày (theo TZ Asia/Ho_Chi_Minh). */
  maxDailyChallenge: number;
  /** Số trận paid challenge / ngày (luôn ≤ maxDailyChallenge / 4). */
  maxDailyPaidChallenge: number;
  /** Cooldown khi challenge cùng 1 target liên tục (phút). */
  sameTargetCooldownMinutes: number;
  /** Cap rating gain / 24h, null = không cap. */
  maxRatingGainPerDay?: number | null;
  /** Cap arena token / 24h. */
  maxArenaTokenPerDay: number;
  /** rewardTier delta ≤ sourceTier + maxSeasonRewardTierDelta. */
  maxSeasonRewardTierDelta: number;
  /** Item key cấm grant qua PvP reward (⊇ FORBIDDEN + ADMIN_FORBIDDEN). */
  forbiddenRewardItemKeys: readonly string[];
  /** % power gap cảnh báo (UI hiển thị warning) — vd 1.5 = đối thủ mạnh 1.5x. */
  powerGapWarningThreshold: number;
  /** % power gap chặn match (vd 3.0 = không cho challenge nếu mạnh hơn 3x). */
  powerGapMatchBlockThreshold: number;
}

/**
 * Default balance policy. Áp khi admin chưa override seasonKey config.
 */
export const PVP_DEFAULT_BALANCE_POLICY: PvpBalancePolicy = {
  maxDailyChallenge: 10,
  maxDailyPaidChallenge: 2,
  sameTargetCooldownMinutes: 30,
  maxRatingGainPerDay: 200,
  maxArenaTokenPerDay: 500,
  maxSeasonRewardTierDelta: 0,
  forbiddenRewardItemKeys: [
    ...Array.from(FORBIDDEN_REWARD_ITEM_KEYS),
    ...Array.from(ADMIN_FORBIDDEN_GRANT_ITEMS),
  ],
  powerGapWarningThreshold: 1.5,
  powerGapMatchBlockThreshold: 3.0,
} as const;

// ---------------------------------------------------------------------------
// 10. Error codes (spec PHẦN 19)
// ---------------------------------------------------------------------------

export type PvpErrorCode =
  | 'PVP_NOT_ENABLED'
  | 'PVP_TARGET_NOT_FOUND'
  | 'PVP_TARGET_TOO_WEAK'
  | 'PVP_TARGET_TOO_STRONG'
  | 'PVP_SAME_TARGET_COOLDOWN'
  | 'PVP_DAILY_LIMIT_REACHED'
  | 'PVP_BATTLE_NOT_FOUND'
  | 'ARENA_SEASON_NOT_ACTIVE'
  | 'ARENA_DAILY_LIMIT_REACHED'
  | 'ARENA_REWARD_ALREADY_CLAIMED'
  | 'SECT_REQUIRED'
  | 'SECT_PERMISSION_DENIED'
  | 'SECT_WAR_NOT_ACTIVE'
  | 'SECT_WAR_REGISTRATION_CLOSED'
  | 'SECT_WAR_ROSTER_LOCKED'
  | 'SECT_WAR_MATCH_NOT_FOUND'
  | 'TERRITORY_NOT_FOUND'
  | 'TERRITORY_NOT_CHALLENGEABLE'
  | 'TERRITORY_LEAGUE_TOO_LOW'
  | 'TERRITORY_PRODUCTION_ALREADY_CLAIMED'
  | 'SEASON_REWARD_LOCKED'
  | 'ADMIN_PERMISSION_DENIED';

export const PVP_ERROR_CODES: readonly PvpErrorCode[] = [
  'PVP_NOT_ENABLED',
  'PVP_TARGET_NOT_FOUND',
  'PVP_TARGET_TOO_WEAK',
  'PVP_TARGET_TOO_STRONG',
  'PVP_SAME_TARGET_COOLDOWN',
  'PVP_DAILY_LIMIT_REACHED',
  'PVP_BATTLE_NOT_FOUND',
  'ARENA_SEASON_NOT_ACTIVE',
  'ARENA_DAILY_LIMIT_REACHED',
  'ARENA_REWARD_ALREADY_CLAIMED',
  'SECT_REQUIRED',
  'SECT_PERMISSION_DENIED',
  'SECT_WAR_NOT_ACTIVE',
  'SECT_WAR_REGISTRATION_CLOSED',
  'SECT_WAR_ROSTER_LOCKED',
  'SECT_WAR_MATCH_NOT_FOUND',
  'TERRITORY_NOT_FOUND',
  'TERRITORY_NOT_CHALLENGEABLE',
  'TERRITORY_LEAGUE_TOO_LOW',
  'TERRITORY_PRODUCTION_ALREADY_CLAIMED',
  'SEASON_REWARD_LOCKED',
  'ADMIN_PERMISSION_DENIED',
] as const;

export function isPvpErrorCode(value: unknown): value is PvpErrorCode {
  return (
    typeof value === 'string' &&
    (PVP_ERROR_CODES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// 11. Validators
// ---------------------------------------------------------------------------

export interface PvpValidationIssue {
  code: string;
  message: string;
  path?: string;
}

/**
 * Validate 1 PvpBalancePolicy:
 *   - All caps > 0 (or ≥ 0 for ratingGain).
 *   - maxDailyPaidChallenge ≤ maxDailyChallenge / 4 (anti-whaling).
 *   - sameTargetCooldownMinutes ≥ 5 (chặn spam khiêu chiến cùng người).
 *   - maxSeasonRewardTierDelta ∈ [0, 1] (server-authoritative tier cap;
 *     delta 0 = reward tier = source tier; delta 1 = +1 max).
 *   - forbiddenRewardItemKeys phải bao trùm FORBIDDEN_REWARD_ITEM_KEYS
 *     + ADMIN_FORBIDDEN_GRANT_ITEMS (anti-P2W).
 *   - powerGapWarningThreshold ≥ 1.0 && < powerGapMatchBlockThreshold.
 */
export function validatePvpBalancePolicy(
  policy: PvpBalancePolicy,
): PvpValidationIssue[] {
  const issues: PvpValidationIssue[] = [];
  if (!Number.isFinite(policy.maxDailyChallenge) || policy.maxDailyChallenge <= 0) {
    issues.push({
      code: 'PVP_POLICY_INVALID_CAP',
      message: 'maxDailyChallenge phải > 0',
      path: 'maxDailyChallenge',
    });
  }
  if (
    !Number.isFinite(policy.maxDailyPaidChallenge) ||
    policy.maxDailyPaidChallenge < 0
  ) {
    issues.push({
      code: 'PVP_POLICY_INVALID_CAP',
      message: 'maxDailyPaidChallenge phải ≥ 0',
      path: 'maxDailyPaidChallenge',
    });
  }
  if (policy.maxDailyPaidChallenge > policy.maxDailyChallenge / 4) {
    issues.push({
      code: 'PVP_POLICY_PAID_OVER_FREE',
      message: 'maxDailyPaidChallenge KHÔNG được vượt 1/4 maxDailyChallenge',
      path: 'maxDailyPaidChallenge',
    });
  }
  if (
    !Number.isFinite(policy.sameTargetCooldownMinutes) ||
    policy.sameTargetCooldownMinutes < 5
  ) {
    issues.push({
      code: 'PVP_POLICY_COOLDOWN_TOO_LOW',
      message: 'sameTargetCooldownMinutes phải ≥ 5',
      path: 'sameTargetCooldownMinutes',
    });
  }
  if (policy.maxRatingGainPerDay !== null && policy.maxRatingGainPerDay !== undefined) {
    if (!Number.isFinite(policy.maxRatingGainPerDay) || policy.maxRatingGainPerDay < 0) {
      issues.push({
        code: 'PVP_POLICY_INVALID_CAP',
        message: 'maxRatingGainPerDay phải ≥ 0',
        path: 'maxRatingGainPerDay',
      });
    }
  }
  if (!Number.isFinite(policy.maxArenaTokenPerDay) || policy.maxArenaTokenPerDay <= 0) {
    issues.push({
      code: 'PVP_POLICY_INVALID_CAP',
      message: 'maxArenaTokenPerDay phải > 0',
      path: 'maxArenaTokenPerDay',
    });
  }
  if (
    !Number.isFinite(policy.maxSeasonRewardTierDelta) ||
    policy.maxSeasonRewardTierDelta < 0 ||
    policy.maxSeasonRewardTierDelta > 1
  ) {
    issues.push({
      code: 'PVP_POLICY_TIER_DELTA_RANGE',
      message: 'maxSeasonRewardTierDelta phải ∈ [0, 1]',
      path: 'maxSeasonRewardTierDelta',
    });
  }
  // forbidden list phải bao trùm FORBIDDEN + ADMIN_FORBIDDEN.
  const required: readonly string[] = [
    ...Array.from(FORBIDDEN_REWARD_ITEM_KEYS),
    ...Array.from(ADMIN_FORBIDDEN_GRANT_ITEMS),
  ];
  const missing = required.filter(
    (k) => !policy.forbiddenRewardItemKeys.includes(k),
  );
  if (missing.length > 0) {
    issues.push({
      code: 'PVP_POLICY_FORBIDDEN_LIST_INCOMPLETE',
      message: `forbiddenRewardItemKeys thiếu key: ${missing.join(', ')}`,
      path: 'forbiddenRewardItemKeys',
    });
  }
  if (policy.powerGapWarningThreshold < 1.0) {
    issues.push({
      code: 'PVP_POLICY_POWERGAP_INVALID',
      message: 'powerGapWarningThreshold phải ≥ 1.0',
      path: 'powerGapWarningThreshold',
    });
  }
  if (policy.powerGapMatchBlockThreshold <= policy.powerGapWarningThreshold) {
    issues.push({
      code: 'PVP_POLICY_POWERGAP_INVALID',
      message: 'powerGapMatchBlockThreshold phải > powerGapWarningThreshold',
      path: 'powerGapMatchBlockThreshold',
    });
  }
  return issues;
}

export function validatePvpSnapshot(
  snapshot: PvpBattleSnapshot,
): PvpValidationIssue[] {
  const issues: PvpValidationIssue[] = [];
  if (!Number.isInteger(snapshot.characterId) || snapshot.characterId <= 0) {
    issues.push({
      code: 'PVP_SNAPSHOT_INVALID_CHARACTER',
      message: 'characterId không hợp lệ',
      path: 'characterId',
    });
  }
  if (!Number.isFinite(snapshot.realmOrder) || snapshot.realmOrder < 0) {
    issues.push({
      code: 'PVP_SNAPSHOT_INVALID_REALM',
      message: 'realmOrder phải ≥ 0',
      path: 'realmOrder',
    });
  }
  if (!Number.isFinite(snapshot.totalPower) || snapshot.totalPower < 0) {
    issues.push({
      code: 'PVP_SNAPSHOT_INVALID_POWER',
      message: 'totalPower phải ≥ 0',
      path: 'totalPower',
    });
  }
  if (!isPvpSnapshotType(snapshot.snapshotType)) {
    issues.push({
      code: 'PVP_SNAPSHOT_INVALID_TYPE',
      message: 'snapshotType không hợp lệ',
      path: 'snapshotType',
    });
  }
  if (!snapshot.createdAt || Number.isNaN(Date.parse(snapshot.createdAt))) {
    issues.push({
      code: 'PVP_SNAPSHOT_INVALID_CREATED_AT',
      message: 'createdAt phải ISO date',
      path: 'createdAt',
    });
  }
  return issues;
}

export function validatePvpDefenseProfile(
  profile: PvpDefenseProfileDef,
): PvpValidationIssue[] {
  const issues: PvpValidationIssue[] = [];
  if (!Number.isInteger(profile.characterId) || profile.characterId <= 0) {
    issues.push({
      code: 'PVP_DEFENSE_INVALID_CHARACTER',
      message: 'characterId không hợp lệ',
      path: 'characterId',
    });
  }
  const sIssues = validatePvpSnapshot(profile.snapshot);
  for (const s of sIssues) {
    issues.push({ ...s, path: `snapshot.${s.path ?? ''}` });
  }
  if (profile.snapshot.snapshotType !== 'DEFENDER' && profile.snapshot.snapshotType !== 'SECT_MEMBER') {
    issues.push({
      code: 'PVP_DEFENSE_SNAPSHOT_NOT_DEFENDER',
      message: 'snapshotType phải = DEFENDER',
      path: 'snapshot.snapshotType',
    });
  }
  if (profile.label != null && profile.label.length > 60) {
    issues.push({
      code: 'PVP_DEFENSE_LABEL_TOO_LONG',
      message: 'label tối đa 60 ký tự',
      path: 'label',
    });
  }
  return issues;
}

/**
 * Validate resolve params:
 *   - status phải = RESOLVED.
 *   - result phải tương thích status (CANCELLED → result = FORFEIT, etc).
 *   - rewardJson nếu có thì mode KHÔNG được = FRIENDLY_SPARRING.
 */
export function validatePvpBattleResolve(args: {
  mode: PvpMode;
  status: PvpBattleStatus;
  result: PvpResult;
  rewardGranted: boolean;
}): PvpValidationIssue[] {
  const issues: PvpValidationIssue[] = [];
  if (!isPvpMode(args.mode)) {
    issues.push({
      code: 'PVP_BATTLE_INVALID_MODE',
      message: 'mode không hợp lệ',
      path: 'mode',
    });
  }
  if (!isPvpBattleStatus(args.status)) {
    issues.push({
      code: 'PVP_BATTLE_INVALID_STATUS',
      message: 'status không hợp lệ',
      path: 'status',
    });
  }
  if (!isPvpResult(args.result)) {
    issues.push({
      code: 'PVP_BATTLE_INVALID_RESULT',
      message: 'result không hợp lệ',
      path: 'result',
    });
  }
  if (args.mode === 'FRIENDLY_SPARRING' && args.rewardGranted) {
    issues.push({
      code: 'PVP_BATTLE_FRIENDLY_REWARD_FORBIDDEN',
      message: 'FRIENDLY_SPARRING không được grant reward',
      path: 'rewardGranted',
    });
  }
  if (args.status === 'CANCELLED' && args.result !== 'FORFEIT') {
    issues.push({
      code: 'PVP_BATTLE_RESULT_NOT_FORFEIT_ON_CANCEL',
      message: 'CANCELLED status phải đi với result=FORFEIT',
      path: 'result',
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 12. Helpers
// ---------------------------------------------------------------------------

/**
 * Tính power gap ratio. Nếu attacker mạnh hơn → ratio > 1.0.
 *   - ratio = max(att, def) / min(att, def).
 *   - Nếu cả 2 = 0 → return 1.0.
 *   - Nếu min = 0 nhưng max > 0 → return Infinity (vô cực).
 */
export function computePvpPowerGap(
  attackerPower: number,
  defenderPower: number,
): number {
  if (
    !Number.isFinite(attackerPower) ||
    !Number.isFinite(defenderPower) ||
    attackerPower < 0 ||
    defenderPower < 0
  ) {
    return NaN;
  }
  if (attackerPower === 0 && defenderPower === 0) return 1.0;
  if (attackerPower === 0 || defenderPower === 0) return Infinity;
  const max = Math.max(attackerPower, defenderPower);
  const min = Math.min(attackerPower, defenderPower);
  return max / min;
}

/**
 * Quyết định có chặn challenge theo power gap không.
 *   - gap < warning → OK, gap < block → warning, gap ≥ block → BLOCK.
 */
export function shouldBlockChallengeByPowerGap(
  gap: number,
  policy: PvpBalancePolicy,
): { blocked: boolean; warning: boolean } {
  if (!Number.isFinite(gap)) return { blocked: true, warning: true };
  return {
    blocked: gap >= policy.powerGapMatchBlockThreshold,
    warning: gap >= policy.powerGapWarningThreshold,
  };
}

/**
 * Helper xác định 1 trận FRIENDLY_SPARRING:
 *   - mode = FRIENDLY_SPARRING → rewardGranted=false, ratingChange=0.
 *   - Validators sẽ đảm bảo invariant này runtime.
 */
export function computeFriendlyMatch(mode: PvpMode): {
  rewardGranted: false;
  ratingChange: 0;
} | null {
  return mode === 'FRIENDLY_SPARRING'
    ? { rewardGranted: false, ratingChange: 0 }
    : null;
}

/**
 * Classify (loose categorize) 1 anomaly into severity bucket. Server
 * dùng để gửi event vào admin review queue + chặn reward claim nếu
 * severity > 0.8.
 */
export function classifyPvpAnomaly(type: PvpAnomalyType): {
  severity: number;
  blockRewardClaim: boolean;
} {
  const severity = PVP_ANOMALY_RISK_WEIGHT[type];
  return {
    severity,
    blockRewardClaim: severity >= 0.8,
  };
}

// ---------------------------------------------------------------------------
// 13. PvP Admin Action Types (re-export subset for type narrow)
// ---------------------------------------------------------------------------

export const PVP_ADMIN_ACTION_TYPES = [
  'PVP_FEATURE_FLAG_UPDATE',
  'PVP_ANTICHEAT_RESOLVE',
  'PVP_BATTLE_INVALIDATE',
  'ARENA_SEASON_CREATE',
  'ARENA_SEASON_UPDATE',
  'ARENA_SEASON_ACTIVATE',
  'ARENA_SEASON_FINALIZE',
  'ARENA_SEASON_LOCK_REWARDS',
  'ARENA_RANKING_LOCK',
  'ARENA_REWARD_ROLLBACK',
  'SECT_WAR_SEASON_CREATE',
  'SECT_WAR_SEASON_UPDATE',
  'SECT_WAR_SEASON_ACTIVATE',
  'SECT_WAR_SEASON_FINALIZE',
  'SECT_WAR_MATCH_LOCK',
  'SECT_WAR_MATCH_RESOLVE',
  'TERRITORY_UPSERT',
  'TERRITORY_ENABLE',
  'TERRITORY_DISABLE',
  'TERRITORY_RESET_OWNER',
] as const;

export type PvpAdminActionType = (typeof PVP_ADMIN_ACTION_TYPES)[number];
