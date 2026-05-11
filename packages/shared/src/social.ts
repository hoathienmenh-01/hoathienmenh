/**
 * Phase 19.1 — Social System Foundation
 *
 * Shared types + validators cho hệ thống bạn bè + chat riêng + chat
 * nhóm. Cùng pattern với các shared catalog khác (deterministic,
 * server-authoritative, no runtime dependency).
 *
 * Server enforce:
 *   - Cấm self-friend / self-block / self-thread.
 *   - Cap message length (privateMessage, groupMessage), name length
 *     (group), invite message length.
 *   - Block 2 chiều cấm gửi `FriendRequest` mới + cấm gửi
 *     `PrivateChatMessage`.
 *   - Non-member group chat → 404 mask (không leak existence).
 *
 * FE chỉ dùng các constant + DTO ở đây để render — không hard-code
 * literal string status / type.
 */

export const FRIEND_REQUEST_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'CANCELLED',
] as const;
export type FriendRequestStatus = (typeof FRIEND_REQUEST_STATUSES)[number];

export const CHAT_THREAD_TYPES = ['PRIVATE', 'GROUP'] as const;
export type ChatThreadType = (typeof CHAT_THREAD_TYPES)[number];

/**
 * Caps phục vụ validator. Server enforce; FE nên hiển thị
 * `remaining = max - length` để UX preview an toàn.
 */
export const SOCIAL_LIMITS = {
  /** `FriendRequest.message` cap (optional invite note). */
  FRIEND_REQUEST_MESSAGE_MAX: 140,
  /** `PrivateChatMessage.body` cap. */
  PRIVATE_MESSAGE_MAX: 500,
  /** `GroupChatMessage.body` cap. */
  GROUP_MESSAGE_MAX: 500,
  /** `GroupChat.name` cap. */
  GROUP_NAME_MAX: 60,
  /** Tối thiểu length cho `GroupChat.name` (sau trim). */
  GROUP_NAME_MIN: 3,
  /** Số member tối đa 1 group (foundation phase — tăng sau). */
  GROUP_MEMBER_MAX: 30,
} as const;

export interface FriendRequestRow {
  id: string;
  senderUserId: string;
  receiverUserId: string;
  status: FriendRequestStatus;
  message: string | null;
  createdAt: string;
  respondedAt: string | null;
}

export interface FriendRow {
  /** `Friendship.id` */
  id: string;
  /** userId của bạn (đối tác trong friendship — không phải currentUser). */
  friendUserId: string;
  /** Optional: tên hiển thị nhân vật của bạn (server populate). */
  friendDisplayName: string | null;
  /** Server-derived snapshot trạng thái online. */
  online: boolean;
  createdAt: string;
}

export interface PlayerBlockRow {
  id: string;
  blockedUserId: string;
  /** Optional: tên hiển thị nhân vật bị block. */
  blockedDisplayName: string | null;
  createdAt: string;
}

export interface PrivateChatThreadRow {
  id: string;
  /** userId đối tác (không phải currentUser). */
  peerUserId: string;
  /** Optional: tên hiển thị peer. */
  peerDisplayName: string | null;
  /** Server-derived snapshot trạng thái online của peer. */
  peerOnline: boolean;
  createdAt: string;
}

export interface PrivateChatMessageRow {
  id: string;
  threadId: string;
  senderUserId: string;
  /** Optional: tên hiển thị người gửi (server populate). */
  senderDisplayName: string | null;
  body: string;
  createdAt: string;
}

export interface GroupChatRow {
  id: string;
  name: string;
  ownerUserId: string;
  memberCount: number;
  createdAt: string;
}

export interface GroupChatMemberRow {
  id: string;
  groupId: string;
  userId: string;
  displayName: string | null;
  joinedAt: string;
}

export interface GroupChatMessageRow {
  id: string;
  groupId: string;
  senderUserId: string;
  senderDisplayName: string | null;
  body: string;
  createdAt: string;
}

/**
 * Kết quả normalize chuẩn lexicographic 2 userId thành (low, high).
 * Dùng cho Friendship + PrivateChatThread invariant.
 *
 * Trả về `null` khi 2 userId trùng nhau — caller bắt và reject với
 * `SELF_NOT_ALLOWED`.
 */
export function sortUserPair(
  userA: string,
  userB: string,
): { low: string; high: string } | null {
  if (userA === userB) return null;
  const [low, high] = userA < userB ? [userA, userB] : [userB, userA];
  return { low, high };
}

export interface SocialValidationError {
  ok: false;
  code:
    | 'EMPTY'
    | 'TOO_LONG'
    | 'TOO_SHORT'
    | 'SELF_NOT_ALLOWED'
    | 'INVALID';
  message: string;
}

export interface SocialValidationOk<T> {
  ok: true;
  value: T;
}

export type SocialValidationResult<T> =
  | SocialValidationOk<T>
  | SocialValidationError;

/**
 * Validate `FriendRequest.message` (optional invite note). Empty
 * string / null đều hợp lệ → trả null normalized. Trim trước khi
 * cap length.
 */
export function validateFriendRequestMessage(
  raw: string | null | undefined,
): SocialValidationResult<string | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };
  if (trimmed.length > SOCIAL_LIMITS.FRIEND_REQUEST_MESSAGE_MAX) {
    return {
      ok: false,
      code: 'TOO_LONG',
      message: `FriendRequest message exceeds ${SOCIAL_LIMITS.FRIEND_REQUEST_MESSAGE_MAX} chars`,
    };
  }
  return { ok: true, value: trimmed };
}

/**
 * Validate body cho `PrivateChatMessage` hoặc `GroupChatMessage`.
 * Empty (sau trim) → reject EMPTY. Quá dài → reject TOO_LONG. Trim
 * cả 2 đầu để tránh user gửi toàn whitespace.
 */
export function validateChatMessageBody(
  raw: string,
  kind: 'PRIVATE' | 'GROUP',
): SocialValidationResult<string> {
  const max =
    kind === 'PRIVATE'
      ? SOCIAL_LIMITS.PRIVATE_MESSAGE_MAX
      : SOCIAL_LIMITS.GROUP_MESSAGE_MAX;
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, code: 'EMPTY', message: 'message empty' };
  }
  if (trimmed.length > max) {
    return {
      ok: false,
      code: 'TOO_LONG',
      message: `message exceeds ${max} chars`,
    };
  }
  return { ok: true, value: trimmed };
}

/**
 * Validate `GroupChat.name`. Trim trước. Reject EMPTY / TOO_SHORT /
 * TOO_LONG. Không kiểm tra ký tự cấm ở phase này — moderation sau.
 */
export function validateGroupName(
  raw: string,
): SocialValidationResult<string> {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: false, code: 'EMPTY', message: 'group name empty' };
  }
  if (trimmed.length < SOCIAL_LIMITS.GROUP_NAME_MIN) {
    return {
      ok: false,
      code: 'TOO_SHORT',
      message: `group name shorter than ${SOCIAL_LIMITS.GROUP_NAME_MIN} chars`,
    };
  }
  if (trimmed.length > SOCIAL_LIMITS.GROUP_NAME_MAX) {
    return {
      ok: false,
      code: 'TOO_LONG',
      message: `group name exceeds ${SOCIAL_LIMITS.GROUP_NAME_MAX} chars`,
    };
  }
  return { ok: true, value: trimmed };
}

/** Public DTO trả về client cho `GET /social/friends`. */
export interface FriendListResponse {
  friends: FriendRow[];
}

/** Public DTO trả về client cho `GET /social/friend-requests/incoming`. */
export interface IncomingFriendRequestsResponse {
  requests: FriendRequestRow[];
}

/** Public DTO trả về client cho `GET /social/friend-requests/outgoing`. */
export interface OutgoingFriendRequestsResponse {
  requests: FriendRequestRow[];
}

/** Public DTO trả về client cho `GET /social/blocks`. */
export interface PlayerBlockListResponse {
  blocks: PlayerBlockRow[];
}

/** Public DTO trả về client cho `GET /chat/private/threads`. */
export interface PrivateChatThreadListResponse {
  threads: PrivateChatThreadRow[];
}

/** Public DTO trả về client cho `GET /chat/private/threads/:id/messages`. */
export interface PrivateChatMessagesResponse {
  threadId: string;
  messages: PrivateChatMessageRow[];
}

/** Public DTO trả về client cho `GET /chat/groups`. */
export interface GroupChatListResponse {
  groups: GroupChatRow[];
}

/** Public DTO trả về client cho `GET /chat/groups/:id/messages`. */
export interface GroupChatMessagesResponse {
  groupId: string;
  messages: GroupChatMessageRow[];
  members: GroupChatMemberRow[];
}
