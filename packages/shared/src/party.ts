/**
 * Phase 19.4 — Group / Party System Upgrade (shared catalog).
 *
 * Định nghĩa **single source of truth** cho hệ thống tổ đội (party) —
 * cấu trúc dữ liệu, enum, caps + helper deterministic dùng chung FE/BE.
 *
 * Party (tổ đội) là một entity gameplay-ready khác với `GroupChat`
 * (chat nhóm) ở `social.ts`:
 *
 *   - Party có **trưởng nhóm** (`leaderUserId`) + `role` per member
 *     (`LEADER` / `MEMBER`).
 *   - Một user chỉ có thể ở **một active party** tại một thời điểm.
 *   - Party có lifecycle `ACTIVE → DISBANDED` (không reactivate).
 *   - Party có **invite flow** (PartyInvite) với `PENDING → ACCEPTED |
 *     DECLINED | CANCELED | EXPIRED`.
 *   - Chuẩn bị cho dungeon / boss co-op ở các phase sau (Phase 19.4
 *     KHÔNG implement matchmaking, dungeon co-op thực, loot share).
 *
 * Server enforce (test-enforced):
 *   - Cap `maxMembers` ≤ `PARTY_LIMITS.maxMembers`.
 *   - Cap `inviteExpireMinutes` để pending invite hết hạn an toàn.
 *   - Mỗi user 1 active party — sang party khác phải `leave` trước.
 *   - Block 2 chiều cấm invite + cấm accept.
 *   - Chỉ leader được `kick` / `transfer` / `disband`.
 *   - Leader không kick chính mình; phải `leave` (auto-transfer hoặc
 *     disband nếu party còn 1 thành viên).
 *
 * KHÔNG dùng FK ở DB (soft-ref) — cùng pattern với Phase 19.1 social.
 */

export const PARTY_STATUSES = ['ACTIVE', 'DISBANDED'] as const;
export type PartyStatus = (typeof PARTY_STATUSES)[number];

export function isPartyStatus(v: unknown): v is PartyStatus {
  return (
    typeof v === 'string' && (PARTY_STATUSES as readonly string[]).includes(v)
  );
}

export const PARTY_ROLES = ['LEADER', 'MEMBER'] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export function isPartyRole(v: unknown): v is PartyRole {
  return (
    typeof v === 'string' && (PARTY_ROLES as readonly string[]).includes(v)
  );
}

export const PARTY_INVITE_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'CANCELED',
  'EXPIRED',
] as const;
export type PartyInviteStatus = (typeof PARTY_INVITE_STATUSES)[number];

export function isPartyInviteStatus(v: unknown): v is PartyInviteStatus {
  return (
    typeof v === 'string' &&
    (PARTY_INVITE_STATUSES as readonly string[]).includes(v)
  );
}

/**
 * Caps + chính sách dùng cho validator + UX preview. Server enforce
 * tất cả; FE có thể hiển thị `remaining` để cảnh báo trước.
 */
export const PARTY_LIMITS = {
  /** Số thành viên tối đa 1 party (foundation phase — tăng sau). */
  maxMembers: 5,
  /** Số phút trước khi pending invite tự EXPIRED. */
  inviteExpireMinutes: 10,
  /**
   * Số pending invite tối đa cho một invitee user — quá ngưỡng → server
   * reject `TOO_MANY_PENDING_INVITES` để chống spam invite tới 1
   * người.
   */
  maxPendingInvitesPerInvitee: 5,
  /**
   * Số pending invite tối đa party có thể có cùng lúc — chống leader
   * spam invite hàng loạt vượt cap maxMembers.
   */
  maxPendingInvitesPerParty: 10,
  /** `Party.name` cap (sau trim). Null name vẫn hợp lệ. */
  nameMin: 3,
  nameMax: 40,
} as const;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/**
 * DTO cho 1 party row (server response). Soft-ref `leaderUserId` (no
 * FK constraint). `disbandedAt` chỉ set khi `status === 'DISBANDED'`.
 */
export interface PartyDto {
  id: string;
  leaderUserId: string;
  name: string | null;
  status: PartyStatus;
  maxMembers: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
  disbandedAt: string | null;
}

/**
 * DTO cho 1 party member row. `online` được tính runtime từ presence
 * (Phase 19.3 `RealtimeService`) — fallback `false` khi presence
 * không available. `leftAt` chỉ set khi member rời (LEFT / KICKED /
 * DISBANDED — Phase 19.4 chỉ giữ `leftAt`, không phân loại).
 */
export interface PartyMemberDto {
  id: string;
  partyId: string;
  userId: string;
  /** Optional: tên hiển thị nhân vật (server populate từ Character.name). */
  displayName: string | null;
  role: PartyRole;
  online: boolean;
  joinedAt: string;
  leftAt: string | null;
}

/**
 * DTO cho 1 party invite. Server set `expiresAt` khi tạo theo
 * `PARTY_LIMITS.inviteExpireMinutes`. `respondedAt` set khi
 * accept/decline/cancel. Soft-ref `inviterUserId` / `inviteeUserId`.
 */
export interface PartyInviteDto {
  id: string;
  partyId: string;
  inviterUserId: string;
  /** Optional: tên hiển thị nhân vật người gửi (server populate). */
  inviterDisplayName: string | null;
  inviteeUserId: string;
  /** Optional: tên hiển thị nhân vật người nhận (server populate). */
  inviteeDisplayName: string | null;
  status: PartyInviteStatus;
  /** Tên party tại thời điểm gửi invite (snapshot, optional). */
  partyName: string | null;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
}

// ---------------------------------------------------------------------------
// REST response envelopes
// ---------------------------------------------------------------------------

/**
 * Response cho `GET /party/me`. Khi user không có active party,
 * `party === null` + `members === []`.
 */
export interface MyPartyResponse {
  party: PartyDto | null;
  members: PartyMemberDto[];
}

export interface PartyInviteListResponse {
  invites: PartyInviteDto[];
}

export interface PartyMemberListResponse {
  members: PartyMemberDto[];
}

// ---------------------------------------------------------------------------
// WS broadcast payloads
// ---------------------------------------------------------------------------

/** Emit khi party hoặc memberCount thay đổi. Tới mọi member online. */
export interface PartyUpdatedBroadcastPayload {
  party: PartyDto;
  members: PartyMemberDto[];
}

/** Emit khi có invite mới. Tới invitee. */
export interface PartyInviteBroadcastPayload {
  invite: PartyInviteDto;
}

/** Emit khi member mới join. Tới mọi member online (kể cả người mới). */
export interface PartyMemberJoinedBroadcastPayload {
  partyId: string;
  member: PartyMemberDto;
}

/**
 * Emit khi member rời (tự leave, bị kick, disband). Tới mọi user còn
 * lại trong party + user vừa rời (để FE biết tự cleanup).
 */
export interface PartyMemberLeftBroadcastPayload {
  partyId: string;
  userId: string;
  reason: 'LEFT' | 'KICKED' | 'DISBANDED';
}

/** Emit khi leadership chuyển. Tới mọi member online. */
export interface PartyLeaderChangedBroadcastPayload {
  partyId: string;
  previousLeaderUserId: string;
  newLeaderUserId: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type PartyValidationCode =
  | 'EMPTY'
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'INVALID';

export interface PartyValidationError {
  ok: false;
  code: PartyValidationCode;
  message: string;
}

export interface PartyValidationOk<T> {
  ok: true;
  value: T;
}

export type PartyValidationResult<T> =
  | PartyValidationOk<T>
  | PartyValidationError;

/**
 * Validate `Party.name`. Null / empty (sau trim) đều hợp lệ → trả về
 * `null` (party không tên). Có giá trị → cap min/max.
 */
export function validatePartyName(
  raw: string | null | undefined,
): PartyValidationResult<string | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') {
    return { ok: false, code: 'INVALID', message: 'party name must be string' };
  }
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };
  if (trimmed.length < PARTY_LIMITS.nameMin) {
    return {
      ok: false,
      code: 'TOO_SHORT',
      message: `party name shorter than ${PARTY_LIMITS.nameMin} chars`,
    };
  }
  if (trimmed.length > PARTY_LIMITS.nameMax) {
    return {
      ok: false,
      code: 'TOO_LONG',
      message: `party name exceeds ${PARTY_LIMITS.nameMax} chars`,
    };
  }
  return { ok: true, value: trimmed };
}

// ---------------------------------------------------------------------------
// Permission helpers — pure, deterministic. Cùng signature dùng cả FE
// (disable button) lẫn BE (assert before mutation).
// ---------------------------------------------------------------------------

/**
 * Trả `true` nếu `actorUserId` có quyền invite vào party. Phase 19.4
 * mặc định **chỉ leader** được invite (chống abuse spam invite). Có
 * thể nới sau qua policy flag.
 */
export function canInviteToParty(input: {
  actorUserId: string;
  leaderUserId: string;
}): boolean {
  return input.actorUserId === input.leaderUserId;
}

/**
 * Trả `true` nếu `actorUserId` có quyền kick `targetUserId` ra khỏi
 * party.
 *
 * Rule:
 *   - Chỉ leader được kick.
 *   - Không kick chính mình (dùng `leave`).
 *   - Không kick member ngoài party (caller phải check membership
 *     trước; helper chỉ enforce role).
 */
export function canKickPartyMember(input: {
  actorUserId: string;
  leaderUserId: string;
  targetUserId: string;
}): boolean {
  if (input.actorUserId !== input.leaderUserId) return false;
  if (input.actorUserId === input.targetUserId) return false;
  return true;
}

/**
 * Trả `true` nếu `actorUserId` có quyền chuyển leadership cho
 * `targetUserId`. Rule:
 *   - Chỉ leader hiện tại được transfer.
 *   - Không transfer cho chính mình (no-op).
 *   - `target` phải là member của party (caller check membership).
 */
export function canTransferLeader(input: {
  actorUserId: string;
  leaderUserId: string;
  targetUserId: string;
}): boolean {
  if (input.actorUserId !== input.leaderUserId) return false;
  if (input.actorUserId === input.targetUserId) return false;
  return true;
}

/**
 * Trả `true` nếu `actorUserId` có quyền disband party. Chỉ leader.
 */
export function canDisbandParty(input: {
  actorUserId: string;
  leaderUserId: string;
}): boolean {
  return input.actorUserId === input.leaderUserId;
}

/**
 * Build key duy nhất cho 1 party membership. Phase 19.4 không persist
 * key này (UNIQUE constraint ở DB layer là `partyId + userId`), nhưng
 * helper hữu ích cho Map<string, PartyMemberDto> ở FE store.
 */
export function buildPartyMemberKey(partyId: string, userId: string): string {
  return `${partyId}:${userId}`;
}

/**
 * Trả `true` nếu invite đã hết hạn so với `now` cho trước. Phase 19.4
 * server enforce ở `acceptInvite`; helper dùng cho FE hiển thị badge
 * "đã hết hạn" mà không cần gọi server.
 */
export function isPartyInviteExpired(
  invite: Pick<PartyInviteDto, 'status' | 'expiresAt'>,
  now: Date = new Date(),
): boolean {
  if (invite.status !== 'PENDING') return false;
  const expires = new Date(invite.expiresAt).getTime();
  if (Number.isNaN(expires)) return false;
  return expires <= now.getTime();
}

/**
 * Trả về timestamp `expiresAt` theo `inviteExpireMinutes` từ `now`.
 * Helper dùng cho service tạo invite + FE preview.
 */
export function computePartyInviteExpiresAt(
  now: Date = new Date(),
): Date {
  return new Date(
    now.getTime() + PARTY_LIMITS.inviteExpireMinutes * 60 * 1000,
  );
}
