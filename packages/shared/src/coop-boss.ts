/**
 * Phase 20.2 — Co-op Boss / World Boss Party Contribution (shared catalog).
 *
 * Single source of truth cho hệ thống co-op boss tổ đội — enum, DTO,
 * caps, helper deterministic dùng chung FE/BE. Pure (KHÔNG đọc env,
 * KHÔNG mutate, KHÔNG IO).
 *
 * Khác `WorldBoss` / `BossDamage` (Phase 7 / 12.6 — global/region world
 * boss, ranking theo `totalDamage` cộng dồn cross-party): foundation
 * 20.2 là **co-op tổ đội** — 1 `CoopBossRun` gắn với 1 party (Phase
 * 19.4), member tham gia ghi contribution, leader (hoặc system khi
 * boss HP về 0) finishRun → server tạo `CoopBossRewardClaim` cho mỗi
 * eligible participant theo tier (NONE/LOW/NORMAL/HIGH/MVP).
 *
 * Foundation invariants (Phase 20.2 — test-enforced):
 *   1. Mỗi party có 1 active run tại 1 thời điểm
 *      (`COOP_BOSS_LIMITS.maxActiveRunPerParty=1`).
 *   2. Chỉ active member của party (qua `PartyMember`) mới được join
 *      run. Người ngoài → 403/404 mask.
 *   3. Chỉ leader hiện tại được `createRun` / `finishRun` / `cancelRun`.
 *      Member khác có thể `joinRun` / `recordContribution`.
 *   4. Server clamp `damageDone` / `supportScore` / `survivalSeconds`
 *      theo `COOP_BOSS_LIMITS`. Vượt cap → clamp + anomaly log.
 *   5. `contributionScore` < `minContributionScore` → tier `NONE`,
 *      không tạo claim row.
 *   6. Run chỉ resolve 1 lần (`finishedAt` set → không re-finish).
 *   7. Reward claim idempotent qua UNIQUE `(runId, userId)` +
 *      `(runId, characterId)` + CAS guard `status='PENDING'` →
 *      `'CLAIMED'`. Duplicate claim không mutate ledger 2 lần.
 *   8. Non-participant không record contribution / claim được.
 *
 * Phase 20.2 KHÔNG làm (deferred):
 *   - Realtime combat engine phức tạp (foundation chỉ track
 *     contribution server-side; client tự self-report damage hiện
 *     tại — clamp mạnh + anomaly).
 *   - Matchmaking public (party-based duy nhất).
 *   - Loot bidding / roll / auction (mỗi member nhận reward riêng,
 *     KHÔNG share pool).
 *   - Replace `WorldBoss` global ranking (cohabit — `CoopBossRun`
 *     gắn `worldBossEventId?` link tới `WorldBoss.id` nếu có).
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Lifecycle status của 1 `CoopBossRun`:
 *
 *   - `LOBBY` — vừa tạo (leader chuẩn bị join), member đang join.
 *   - `IN_PROGRESS` — leader trigger start (hoặc đủ member ready) →
 *     server ghi contribution liên tục.
 *   - `CLEARED` — boss bị đánh bại / leader gọi finish CLEAR. Server
 *     tạo reward claim cho mỗi eligible participant.
 *   - `FAILED` — party fail (timeout / wipe). KHÔNG tạo reward claim.
 *   - `CANCELED` — leader cancel khi LOBBY hoặc party disband.
 */
export const COOP_BOSS_STATUSES = [
  'LOBBY',
  'IN_PROGRESS',
  'CLEARED',
  'FAILED',
  'CANCELED',
] as const;
export type CoopBossStatus = (typeof COOP_BOSS_STATUSES)[number];

export function isCoopBossStatus(v: unknown): v is CoopBossStatus {
  return (
    typeof v === 'string' &&
    (COOP_BOSS_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * Trạng thái claim của 1 `CoopBossRewardClaim`:
 *
 *   - `PENDING` — server tạo sau finishRun, member chưa claim.
 *   - `CLAIMED` — member đã claim, ledger row đã ghi. CAS guard
 *     đảm bảo idempotent.
 *   - `SKIPPED` — member rời run trước finish hoặc tier=NONE
 *     (không tạo claim row ở foundation). Reserved.
 *   - `FAILED` — claim attempt fail nội bộ (vd reward cap hit). Reserved.
 */
export const COOP_BOSS_REWARD_CLAIM_STATUSES = [
  'PENDING',
  'CLAIMED',
  'SKIPPED',
  'FAILED',
] as const;
export type CoopBossRewardClaimStatus =
  (typeof COOP_BOSS_REWARD_CLAIM_STATUSES)[number];

export function isCoopBossRewardClaimStatus(
  v: unknown,
): v is CoopBossRewardClaimStatus {
  return (
    typeof v === 'string' &&
    (COOP_BOSS_REWARD_CLAIM_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * Tier contribution sau finishRun.
 *
 *   - `NONE` — contribution dưới `minContributionScore` hoặc
 *     `eligibleForReward=false` (left early). KHÔNG tạo claim row.
 *   - `LOW` — eligible nhưng contribution thấp. Reward = `baseReward * 0.5`.
 *   - `NORMAL` — contribution chuẩn. Reward = `baseReward * 1.0`.
 *   - `HIGH` — contribution top-N (sau MVP). Reward = `baseReward * 1.25`.
 *   - `MVP` — top 1 contribution + qua minMvpScore. Reward = `baseReward * 1.5` + bonus tag.
 *
 * Server-authoritative tier — client preview qua `classifyContributionTier`
 * chỉ informational.
 */
export const COOP_BOSS_CONTRIBUTION_TIERS = [
  'NONE',
  'LOW',
  'NORMAL',
  'HIGH',
  'MVP',
] as const;
export type CoopBossContributionTier =
  (typeof COOP_BOSS_CONTRIBUTION_TIERS)[number];

export function isCoopBossContributionTier(
  v: unknown,
): v is CoopBossContributionTier {
  return (
    typeof v === 'string' &&
    (COOP_BOSS_CONTRIBUTION_TIERS as readonly string[]).includes(v)
  );
}

// ---------------------------------------------------------------------------
// Limits + caps (server enforce)
// ---------------------------------------------------------------------------

/**
 * Caps + policy. Server enforce toàn bộ; FE dùng để hiển thị remaining /
 * disable button trước khi gọi API.
 *
 * Convention: cap thấp + clamp mạnh để chống cheat khi client tạm
 * self-report damage. Phase 20.3+ có thể nâng cap khi server-side
 * combat engine xử lý damage tuyệt đối.
 */
export const COOP_BOSS_LIMITS = {
  /** Min member để leader start (start gate). */
  minMembers: 2,
  /** Max member 1 run (mirror PARTY_LIMITS.maxMembers). */
  maxMembers: 5,
  /**
   * Min contribution score để eligible nhận reward. Dưới ngưỡng →
   * tier `NONE` → không tạo claim row.
   */
  minContributionScore: 50,
  /**
   * Min survival seconds để eligible nhận reward. Member rời quá
   * sớm → `eligibleForReward=false` ở finishRun.
   */
  minSurvivalSeconds: 30,
  /**
   * Min contribution score để được MVP candidate. Top1 < ngưỡng này
   * → không có MVP run này.
   */
  minMvpScore: 200,
  /** Tối đa số reward claim 1 run (mirror maxMembers). */
  maxRewardClaimsPerRun: 5,
  /**
   * Cửa sổ tính contribution (giây). Member ghi contribution sau
   * window này (so với `startedAt`) bị reject. Bảo vệ run timeout.
   */
  contributionWindowSeconds: 1800,
  /**
   * Max damage 1 lần `recordContribution` được report. Vượt cap →
   * clamp + ghi anomaly. Anti-cheat foundation khi client self-report.
   */
  maxDamagePerContribution: 1_000_000,
  /** Max support score 1 lần record. */
  maxSupportPerContribution: 10_000,
  /** Max actionCount tích lũy / run (avoid runaway counter). */
  maxActionCountPerRun: 10_000,
  /** Số ngày giữ `CoopBossRun` rows trước khi prune (admin job). */
  runRetentionDays: 90,
  /** Max active run per party. */
  maxActiveRunPerParty: 1,
} as const;

// ---------------------------------------------------------------------------
// Reward base values per tier (server clone, FE preview)
// ---------------------------------------------------------------------------

/**
 * Phase 20.2 foundation reward base — server clone vào
 * `CoopBossRewardClaim.rewardJson` lúc finishRun. Đơn giản, deterministic
 * theo tier — không scale theo bossKey / party size để chống snowball
 * economy. Designer có thể override per bossKey ở phase sau.
 *
 * **Daily/Weekly cap**: foundation 20.2 KHÔNG enforce cap riêng cho
 * coop boss reward (reward đi qua `CurrencyService.applyTx` với
 * reason=`COOP_BOSS_REWARD` — `daily-reward-cap.ts` không cap reason
 * này hiện tại). Follow-up TODO: thêm vào `DAILY_REWARD_CAPS` nếu
 * econ team confirm cần cap riêng. Xem `docs/BALANCE_MODEL.md`.
 */
export const COOP_BOSS_BASE_REWARD = {
  linhThach: 200,
  tienNgoc: 0,
  exp: 400,
} as const;

export const COOP_BOSS_TIER_MULTIPLIERS: Readonly<
  Record<CoopBossContributionTier, number>
> = {
  NONE: 0,
  LOW: 0.5,
  NORMAL: 1.0,
  HIGH: 1.25,
  MVP: 1.5,
} as const;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface CoopBossRunDto {
  id: string;
  bossKey: string;
  partyId: string | null;
  worldBossEventId: string | null;
  status: CoopBossStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Server-authoritative summary (mvp, totalDamage). Opaque cho FE consumer. */
  resultSummaryJson: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CoopBossParticipantDto {
  id: string;
  runId: string;
  userId: string;
  characterId: string;
  partyId: string | null;
  /** Display name (server populate từ Character.name). */
  characterName?: string | null;
  joinedAt: string;
  leftAt: string | null;
  eligibleForReward: boolean;
  finalContributionScore: number | null;
}

export interface CoopBossContributionDto {
  id: string;
  runId: string;
  participantId: string;
  /** BigInt → string ở wire format (mirror BossDamage pattern). */
  damageDone: string;
  supportScore: number;
  survivalSeconds: number;
  actionCount: number;
  contributionScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface CoopBossRewardPreview {
  tier: CoopBossContributionTier;
  linhThach?: number;
  tienNgoc?: number;
  exp?: number;
  items?: ReadonlyArray<{ itemKey: string; qty: number }>;
}

export interface CoopBossRewardClaimDto {
  id: string;
  runId: string;
  userId: string;
  characterId: string;
  status: CoopBossRewardClaimStatus;
  rewardTier: CoopBossContributionTier;
  rewardJson: CoopBossRewardPreview;
  claimedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// REST response shapes
// ---------------------------------------------------------------------------

export interface MyCoopBossRunResponse {
  /** Active run của party hiện tại (null nếu chưa tạo / đã kết thúc). */
  run: CoopBossRunDto | null;
  participants: CoopBossParticipantDto[];
  /** Contribution aggregate của caller (null nếu chưa join). */
  myContribution: CoopBossContributionDto | null;
  /** Reward claim row của caller (null nếu chưa có / run chưa CLEARED). */
  myReward: CoopBossRewardClaimDto | null;
  /** Reward tier preview client-side (live, chưa tính cuối cùng). */
  myRewardPreview: CoopBossRewardPreview | null;
}

export interface CoopBossRunDetailResponse {
  run: CoopBossRunDto;
  participants: CoopBossParticipantDto[];
  contributions: CoopBossContributionDto[];
  rewards: CoopBossRewardClaimDto[];
}

export interface CoopBossRunListResponse {
  runs: CoopBossRunDto[];
}

// ---------------------------------------------------------------------------
// WS broadcast payloads
// ---------------------------------------------------------------------------

/**
 * Phase 20.2 — Server emit khi run state thay đổi (member join/leave,
 * status transition). Server CHỈ fanout tới user trong participant
 * list (snapshot lúc emit) — không broadcast cross-party.
 */
export interface CoopBossRunUpdatedBroadcastPayload {
  runId: string;
  partyId: string | null;
  bossKey: string;
  status: CoopBossStatus;
  participantsCount: number;
}

export interface CoopBossContributionUpdatedBroadcastPayload {
  runId: string;
  participantId: string;
  userId: string;
  contributionScore: number;
}

export interface CoopBossFinishedBroadcastPayload {
  runId: string;
  partyId: string | null;
  status: 'CLEARED' | 'FAILED';
  /** Top contribution user (null nếu không ai đạt minMvpScore). */
  mvpUserId: string | null;
}

export interface CoopBossRewardAvailableBroadcastPayload {
  runId: string;
  userId: string;
  rewardClaimId: string;
  rewardTier: CoopBossContributionTier;
}

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Tính contribution score deterministic từ raw metric.
 *
 * Score formula (foundation 20.2):
 *   - 1 damage  → 0.001 point (clamp damageDone qua BigInt before).
 *   - 1 support → 1 point.
 *   - 1 second  → 0.5 point.
 *
 * Final integer (Math.floor). Input clamp `≥ 0`.
 */
export function computeContributionScore(input: {
  damageDone: bigint | number;
  supportScore: number;
  survivalSeconds: number;
}): number {
  const damageNum =
    typeof input.damageDone === 'bigint'
      ? Number(input.damageDone)
      : input.damageDone;
  const d = Math.max(0, Number.isFinite(damageNum) ? damageNum : 0);
  const s = Math.max(0, Number.isFinite(input.supportScore) ? input.supportScore : 0);
  const t = Math.max(
    0,
    Number.isFinite(input.survivalSeconds) ? input.survivalSeconds : 0,
  );
  const score = d * 0.001 + s * 1 + t * 0.5;
  return Math.floor(score);
}

/**
 * Map contribution score → tier. Pure, deterministic. Server gọi
 * 1 lần tại `finishRun` snapshot — client gọi để preview UI.
 *
 *   - `eligibleForReward=false` → `NONE`.
 *   - `score < minContributionScore` → `NONE`.
 *   - `isMvpCandidate && score ≥ minMvpScore` → `MVP`.
 *   - `score ≥ minMvpScore` → `HIGH`.
 *   - `score ≥ minContributionScore * 2` → `NORMAL`.
 *   - `score ≥ minContributionScore` → `LOW`.
 *
 * Thiết kế đảm bảo tier monotonic theo score, và MVP chỉ 1 người
 * (server `isMvpCandidate=true` cho top1 ≥ minMvpScore).
 */
export function classifyContributionTier(input: {
  contributionScore: number;
  eligibleForReward: boolean;
  isMvpCandidate: boolean;
}): CoopBossContributionTier {
  if (!input.eligibleForReward) return 'NONE';
  const score = Math.max(0, Math.floor(input.contributionScore));
  if (score < COOP_BOSS_LIMITS.minContributionScore) return 'NONE';
  if (input.isMvpCandidate && score >= COOP_BOSS_LIMITS.minMvpScore) {
    return 'MVP';
  }
  if (score >= COOP_BOSS_LIMITS.minMvpScore) return 'HIGH';
  if (score >= COOP_BOSS_LIMITS.minContributionScore * 2) return 'NORMAL';
  return 'LOW';
}

/**
 * Tính reward payload theo tier. Server clone vào `CoopBossRewardClaim
 * .rewardJson` tại finishRun. Pure, deterministic.
 *
 *   - tier=NONE → return `{ tier: 'NONE' }` (caller skip create row).
 *   - tier=MVP  → multiplier * base + bonus 1 LINH_THACH bonus tag
 *     (mark MVP, không phá economy).
 *   - other     → multiplier * base, floor integer.
 */
export function computeCoopBossRewardTier(input: {
  tier: CoopBossContributionTier;
}): CoopBossRewardPreview {
  const tier = input.tier;
  const mult = COOP_BOSS_TIER_MULTIPLIERS[tier];
  if (tier === 'NONE' || mult <= 0) return { tier: 'NONE' };
  const out: CoopBossRewardPreview = {
    tier,
    linhThach: Math.floor(COOP_BOSS_BASE_REWARD.linhThach * mult),
    exp: Math.floor(COOP_BOSS_BASE_REWARD.exp * mult),
  };
  // MVP bonus: thêm 1 tien_ngoc tag, không phá economy.
  if (tier === 'MVP') {
    out.tienNgoc = 1;
  }
  return out;
}

/**
 * Check xem caller có thể claim reward không. Gate trước endpoint claim.
 *
 *   - `RUN_NOT_FINISHED` — run chưa `CLEARED` (FAILED/CANCELED cũng reject).
 *   - `NOT_ELIGIBLE`     — `eligibleForReward=false`.
 *   - `TIER_NONE`        — tier=NONE (không có claim row).
 *   - `ALREADY_CLAIMED`  — claim đã CLAIMED.
 *   - `ok: true`         — claim được.
 */
export function canClaimCoopBossReward(input: {
  runStatus: CoopBossStatus;
  eligibleForReward: boolean;
  rewardTier: CoopBossContributionTier;
  rewardStatus: CoopBossRewardClaimStatus;
}):
  | { ok: true }
  | {
      ok: false;
      code:
        | 'RUN_NOT_FINISHED'
        | 'NOT_ELIGIBLE'
        | 'TIER_NONE'
        | 'ALREADY_CLAIMED';
    } {
  if (input.runStatus !== 'CLEARED') {
    return { ok: false, code: 'RUN_NOT_FINISHED' };
  }
  if (!input.eligibleForReward) {
    return { ok: false, code: 'NOT_ELIGIBLE' };
  }
  if (input.rewardTier === 'NONE') {
    return { ok: false, code: 'TIER_NONE' };
  }
  if (input.rewardStatus === 'CLAIMED') {
    return { ok: false, code: 'ALREADY_CLAIMED' };
  }
  return { ok: true };
}

/**
 * Clamp + validate contribution payload trước khi cộng dồn ở server.
 * Trả về `clamped` (sanitized values) + `anomaly` flag (true nếu
 * raw input vượt cap → service log GameplayAnomaly nếu hook khả dụng).
 *
 * Input có thể là `unknown` từ HTTP body → service gọi qua zod
 * trước nhưng helper này tự defensive (NaN/Infinity → 0).
 */
export function clampContributionInput(input: {
  damageDone: number | bigint;
  supportScore: number;
  survivalSeconds: number;
}): {
  clamped: {
    damageDone: bigint;
    supportScore: number;
    survivalSeconds: number;
  };
  anomaly: boolean;
} {
  let anomaly = false;

  const rawDamage =
    typeof input.damageDone === 'bigint'
      ? input.damageDone
      : Number.isFinite(input.damageDone)
      ? BigInt(Math.floor(Math.max(0, input.damageDone)))
      : 0n;
  let damage = rawDamage < 0n ? 0n : rawDamage;
  const maxDamage = BigInt(COOP_BOSS_LIMITS.maxDamagePerContribution);
  if (damage > maxDamage) {
    damage = maxDamage;
    anomaly = true;
  }
  if (rawDamage < 0n) anomaly = true;

  let support = Number.isFinite(input.supportScore)
    ? Math.floor(input.supportScore)
    : 0;
  if (support < 0) {
    support = 0;
    anomaly = true;
  }
  if (support > COOP_BOSS_LIMITS.maxSupportPerContribution) {
    support = COOP_BOSS_LIMITS.maxSupportPerContribution;
    anomaly = true;
  }

  let survival = Number.isFinite(input.survivalSeconds)
    ? Math.floor(input.survivalSeconds)
    : 0;
  if (survival < 0) {
    survival = 0;
    anomaly = true;
  }
  if (survival > COOP_BOSS_LIMITS.contributionWindowSeconds) {
    survival = COOP_BOSS_LIMITS.contributionWindowSeconds;
    anomaly = true;
  }

  return {
    clamped: {
      damageDone: damage,
      supportScore: support,
      survivalSeconds: survival,
    },
    anomaly,
  };
}

/**
 * Build deterministic refId cho ledger / inventory grant — dùng để
 * debug + cross-link `CurrencyLedger.refId` ↔ `CoopBossRewardClaim.id`.
 * Format: `<runId>:<characterId>`.
 */
export function buildCoopBossRunRefId(input: {
  runId: string;
  characterId: string;
}): string {
  return `${input.runId}:${input.characterId}`;
}
