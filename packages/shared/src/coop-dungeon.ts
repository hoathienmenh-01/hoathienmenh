/**
 * Phase 20.1 — Party Dungeon / Co-op PvE Foundation (shared catalog, pure).
 *
 * Single source of truth cho hệ thống dungeon tổ đội — enum, DTO, caps,
 * helper deterministic dùng chung FE/BE. Pure (KHÔNG đọc env, KHÔNG mutate).
 *
 * Khác `DungeonRun` (Phase 12.2.B — solo farm dungeon):
 *   - `DungeonRun` = single-character expedition, auto-resolve mỗi
 *     `next()` call. Ownership = `characterId`.
 *   - `PartyDungeonRoom` + `PartyDungeonRun` = multi-member co-op:
 *     leader tạo room → member ready → leader start → server tạo run
 *     → ghi reward claim cho mỗi member → member claim qua endpoint
 *     riêng. Ownership = `partyId` + `userId` per participant.
 *
 * Foundation invariants (Phase 20.1 — test-enforced):
 *   1. Một party chỉ có 1 active room tại một thời điểm
 *      (`maxActiveRoomPerParty=1`).
 *   2. Chỉ active member của party hiện tại (qua `PartyService.getMyParty`)
 *      mới được join room. Người ngoài party → 403/404.
 *   3. Chỉ leader được tạo / start / cancel room (Phase 20.1 policy
 *      mặc định — designer có thể nới ở phase sau qua override config).
 *   4. Start fail nếu < `minMembers` hoặc có participant chưa ready.
 *   5. Run chỉ resolve 1 lần (`finishedAt` set → không re-finish).
 *   6. Reward claim idempotent qua UNIQUE `(runId, characterId)` +
 *      CAS guard `status='PENDING'` → `'CLAIMED'`.
 *   7. Non-participant không claim được (server check theo
 *      `PartyDungeonParticipant.userId` snapshot lúc start).
 *
 * Phase 20.1 KHÔNG làm:
 *   - Matchmaking public (party phải tự gom).
 *   - Realtime combat phức tạp (auto-resolve trên start — placeholder
 *     cho Phase 20.2+ wire combat thật).
 *   - Loot bidding / roll / auction (mỗi member nhận reward riêng,
 *     KHÔNG share pool).
 *   - Cap riêng cho co-op (reuse `DUNGEONS[].runReward` solo, có thể
 *     scale ở phase sau).
 */

import { dungeonByKey } from './combat';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Lifecycle status của 1 PartyDungeonRoom:
 *
 *   - `LOBBY` — vừa tạo, member đang join + ready up.
 *   - `READY_CHECK` — leader trigger ready check (Phase 20.1 inline với
 *     LOBBY, reserved cho future explicit ready window).
 *   - `IN_PROGRESS` — leader start → server tạo `PartyDungeonRun` →
 *     auto-resolve → flip room → COMPLETED/FAILED. Phase 20.1
 *     foundation: IN_PROGRESS thường chỉ tồn tại trong cùng request
 *     (auto-resolve inline trong tx) — Phase 20.2+ sẽ tách thành
 *     persistent state cho realtime combat.
 *   - `COMPLETED` — run CLEAR.
 *   - `FAILED` — run FAIL (chưa wire fail path ở foundation; reserved).
 *   - `CANCELED` — leader cancel hoặc auto-cancel khi party disband.
 */
export const PARTY_DUNGEON_ROOM_STATUSES = [
  'LOBBY',
  'READY_CHECK',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'CANCELED',
] as const;
export type PartyDungeonRoomStatus =
  (typeof PARTY_DUNGEON_ROOM_STATUSES)[number];

export function isPartyDungeonRoomStatus(
  v: unknown,
): v is PartyDungeonRoomStatus {
  return (
    typeof v === 'string' &&
    (PARTY_DUNGEON_ROOM_STATUSES as readonly string[]).includes(v)
  );
}

/** Final outcome của 1 PartyDungeonRun. */
export const PARTY_DUNGEON_RUN_RESULTS = ['CLEAR', 'FAIL', 'CANCELED'] as const;
export type PartyDungeonRunResult = (typeof PARTY_DUNGEON_RUN_RESULTS)[number];

export function isPartyDungeonRunResult(
  v: unknown,
): v is PartyDungeonRunResult {
  return (
    typeof v === 'string' &&
    (PARTY_DUNGEON_RUN_RESULTS as readonly string[]).includes(v)
  );
}

/**
 * Trạng thái claim của 1 reward row trong `PartyDungeonRewardClaim`:
 *
 *   - `PENDING` — server tạo sau khi run COMPLETED, member chưa claim.
 *   - `CLAIMED` — member đã claim, ledger row đã ghi. Idempotent guard.
 *   - `SKIPPED` — member rời party trước khi claim, hoặc admin skip
 *     (reserved cho phase sau).
 *   - `FAILED` — claim attempt fail nội bộ (vd reward cap hit toàn
 *     phần) — Phase 20.1 mặc định không dùng, reserved cho audit.
 */
export const PARTY_DUNGEON_REWARD_CLAIM_STATUSES = [
  'PENDING',
  'CLAIMED',
  'SKIPPED',
  'FAILED',
] as const;
export type PartyDungeonRewardClaimStatus =
  (typeof PARTY_DUNGEON_REWARD_CLAIM_STATUSES)[number];

export function isPartyDungeonRewardClaimStatus(
  v: unknown,
): v is PartyDungeonRewardClaimStatus {
  return (
    typeof v === 'string' &&
    (PARTY_DUNGEON_REWARD_CLAIM_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * Per-participant ready check status — derived view ở FE. Server
 * không persist enum này; chỉ check `PartyDungeonParticipant.readyAt
 * !== null` tại điểm `startRun` (truthy = ready).
 */
export const READY_CHECK_STATUSES = ['READY', 'NOT_READY'] as const;
export type ReadyCheckStatus = (typeof READY_CHECK_STATUSES)[number];

// ---------------------------------------------------------------------------
// Limits + caps
// ---------------------------------------------------------------------------

/**
 * Caps + policy. Server enforce toàn bộ; FE dùng để hiển thị remaining
 * hoặc disable button trước khi gọi API.
 */
export const COOP_DUNGEON_LIMITS = {
  /** Tối thiểu member sẵn sàng để leader start được. */
  minMembers: 2,
  /**
   * Tối đa participant 1 room. Mirror `PARTY_LIMITS.maxMembers` (5) —
   * room không thể đông hơn party.
   */
  maxMembers: 5,
  /**
   * Sliding window cho ready check. Phase 20.1 foundation chỉ dùng
   * như UX hint (không auto-cancel ở server) — Phase 20.2+ có thể
   * wire cron / scheduled timeout.
   */
  readyTimeoutSeconds: 120,
  /** Tối đa active room (status ∉ COMPLETED/FAILED/CANCELED) per party. */
  maxActiveRoomPerParty: 1,
  /** Số ngày giữ `PartyDungeonRun` rows trước khi prune (admin job). */
  runRetentionDays: 90,
} as const;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface PartyDungeonRoomDto {
  id: string;
  partyId: string;
  leaderUserId: string;
  dungeonKey: string;
  status: PartyDungeonRoomStatus;
  minMembers: number;
  maxMembers: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  canceledAt: string | null;
  /** Pointer tới PartyDungeonRun nếu đã start (null khi LOBBY). */
  currentRunId: string | null;
}

export interface PartyDungeonParticipantDto {
  id: string;
  roomId: string;
  userId: string;
  /** Snapshot characterId tại thời điểm join (null nếu user không có character active). */
  characterId: string | null;
  /** Optional display name (server populate từ Character.name). */
  characterName?: string | null;
  readyAt: string | null;
  joinedAt: string;
  leftAt: string | null;
  /** Set sau khi run resolve — match run.result. */
  resultStatus: PartyDungeonRunResult | null;
}

export interface PartyDungeonRunDto {
  id: string;
  roomId: string;
  partyId: string;
  dungeonKey: string;
  result: PartyDungeonRunResult;
  startedAt: string;
  finishedAt: string | null;
  /** Server-authoritative combat summary (JSON blob, opaque cho FE). */
  combatSummaryJson: Record<string, unknown> | null;
  /** Server-authoritative reward summary (JSON blob, opaque cho FE). */
  rewardSummaryJson: Record<string, unknown> | null;
}

export interface PartyDungeonRewardClaimDto {
  id: string;
  runId: string;
  userId: string;
  characterId: string;
  status: PartyDungeonRewardClaimStatus;
  /**
   * Reward payload — `{ linhThach?: number; tienNgoc?: number;
   * exp?: number; items?: { itemKey, qty }[] }`. Server tính tại
   * thời điểm tạo claim row (deterministic theo dungeon catalog).
   */
  rewardJson: PartyDungeonRewardPreview;
  claimedAt: string | null;
  createdAt: string;
}

export interface PartyDungeonRewardPreview {
  linhThach?: number;
  tienNgoc?: number;
  exp?: number;
  items?: ReadonlyArray<{ itemKey: string; qty: number }>;
}

// ---------------------------------------------------------------------------
// REST response shapes
// ---------------------------------------------------------------------------

export interface MyPartyDungeonRoomResponse {
  /** Active room của party hiện tại (null nếu chưa tạo / đã kết thúc). */
  room: PartyDungeonRoomDto | null;
  participants: PartyDungeonParticipantDto[];
  /** Run gần nhất gắn với room (null nếu room đang LOBBY). */
  currentRun: PartyDungeonRunDto | null;
  /** Reward claim row của user hiện tại (null nếu chưa có run COMPLETED). */
  myReward: PartyDungeonRewardClaimDto | null;
}

export interface PartyDungeonRunDetailResponse {
  run: PartyDungeonRunDto;
  rewards: PartyDungeonRewardClaimDto[];
}

// ---------------------------------------------------------------------------
// WS broadcast payloads
// ---------------------------------------------------------------------------

/**
 * Phase 20.1 — Server emit cho room participants khi room state thay đổi.
 * Server CHỈ fanout tới user trong participant list (snapshot tại
 * emit time) — không broadcast cho party member không join room hoặc
 * người ngoài party.
 */
export interface PartyDungeonRoomUpdatedBroadcastPayload {
  roomId: string;
  partyId: string;
  status: PartyDungeonRoomStatus;
  participantsCount: number;
  readyCount: number;
}

export interface PartyDungeonReadyUpdatedBroadcastPayload {
  roomId: string;
  partyId: string;
  userId: string;
  ready: boolean;
}

export interface PartyDungeonStartedBroadcastPayload {
  roomId: string;
  partyId: string;
  runId: string;
  dungeonKey: string;
}

export interface PartyDungeonCompletedBroadcastPayload {
  roomId: string;
  partyId: string;
  runId: string;
  result: PartyDungeonRunResult;
}

export interface PartyDungeonRewardAvailableBroadcastPayload {
  roomId: string;
  partyId: string;
  runId: string;
  userId: string;
  rewardClaimId: string;
}

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Kiểm tra precondition leader-start. Trả về `{ ok: true }` hoặc lỗi
 * cụ thể. Phase 20.1 leader-only policy.
 *
 * Lỗi:
 *   - `INVALID_DUNGEON`: dungeonKey không có trong catalog `DUNGEONS`.
 *   - `NOT_LEADER`: caller không phải leader hiện tại của party.
 *   - `NOT_ENOUGH_MEMBERS`: < `minMembers` active participant.
 *   - `NOT_ALL_READY`: tồn tại participant chưa ready (`readyAt = null`).
 *   - `ROOM_NOT_LOBBY`: room status không phải LOBBY/READY_CHECK.
 */
export function canStartPartyDungeon(input: {
  callerUserId: string;
  leaderUserId: string;
  dungeonKey: string;
  roomStatus: PartyDungeonRoomStatus;
  participants: ReadonlyArray<{ userId: string; readyAt: string | null; leftAt: string | null }>;
  minMembers?: number;
}):
  | { ok: true }
  | {
      ok: false;
      code:
        | 'INVALID_DUNGEON'
        | 'NOT_LEADER'
        | 'NOT_ENOUGH_MEMBERS'
        | 'NOT_ALL_READY'
        | 'ROOM_NOT_LOBBY';
    } {
  if (!dungeonByKey(input.dungeonKey)) {
    return { ok: false, code: 'INVALID_DUNGEON' };
  }
  if (input.callerUserId !== input.leaderUserId) {
    return { ok: false, code: 'NOT_LEADER' };
  }
  if (input.roomStatus !== 'LOBBY' && input.roomStatus !== 'READY_CHECK') {
    return { ok: false, code: 'ROOM_NOT_LOBBY' };
  }
  const active = input.participants.filter((p) => p.leftAt === null);
  const min = input.minMembers ?? COOP_DUNGEON_LIMITS.minMembers;
  if (active.length < min) {
    return { ok: false, code: 'NOT_ENOUGH_MEMBERS' };
  }
  const notReady = active.find((p) => p.readyAt === null);
  if (notReady) {
    return { ok: false, code: 'NOT_ALL_READY' };
  }
  return { ok: true };
}

/**
 * Phase 20.1 foundation — chia reward đơn giản: **mỗi participant
 * nhận đủ `runReward` của dungeon** (clone, không scale theo team).
 * KHÔNG share pool / KHÔNG bidding — match yêu cầu "simple safe
 * reward" ở phase này.
 *
 * Phase sau có thể override để:
 *   - Chia theo damage contribution.
 *   - Cap reward theo size party (vd team 5 nhận 60% reward solo
 *     từng người).
 *   - Bonus first-clear / weekly bonus.
 */
export function computePartyDungeonRewardSplit(input: {
  dungeonKey: string;
  participantUserIds: ReadonlyArray<string>;
}): Map<string, PartyDungeonRewardPreview> {
  const out = new Map<string, PartyDungeonRewardPreview>();
  const def = dungeonByKey(input.dungeonKey);
  if (!def?.runReward) return out;
  const reward = def.runReward;
  for (const uid of input.participantUserIds) {
    out.set(uid, cloneReward(reward));
  }
  return out;
}

function cloneReward(r: PartyDungeonRewardPreview): PartyDungeonRewardPreview {
  return {
    linhThach: r.linhThach,
    tienNgoc: r.tienNgoc,
    exp: r.exp,
    items: r.items ? r.items.map((i) => ({ ...i })) : undefined,
  };
}

/**
 * Build deterministic refId cho ledger row khi grant party dungeon
 * reward — dùng để debug + cross-link `CurrencyLedger.refId` ↔
 * `PartyDungeonRewardClaim.id`. Format: `<runId>:<characterId>`.
 */
export function buildPartyDungeonRunRefId(input: {
  runId: string;
  characterId: string;
}): string {
  return `${input.runId}:${input.characterId}`;
}
