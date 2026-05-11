/**
 * Phase 19.1 — Social System Foundation. Client REST cho friend +
 * block. Endpoints khớp `apps/api/src/modules/social/social.controller.ts`.
 *
 * Mọi response server đều bọc `{ ok, data, error }`. `unwrap` ném
 * `Object.assign(Error, { code })` để FE store dùng
 * `extractApiErrorCode`.
 */
import { apiClient } from './client';
import type {
  FriendListResponse,
  FriendRequestRow,
  IncomingFriendRequestsResponse,
  OutgoingFriendRequestsResponse,
  PlayerBlockListResponse,
  PlayerBlockRow,
} from '@xuantoi/shared';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env.ok || !env.data) {
    const err = env.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  return env.data;
}

export async function getFriends(): Promise<FriendListResponse> {
  const { data } = await apiClient.get<Envelope<FriendListResponse>>(
    '/social/friends',
  );
  return unwrap(data);
}

export async function getIncomingRequests(): Promise<IncomingFriendRequestsResponse> {
  const { data } = await apiClient.get<Envelope<IncomingFriendRequestsResponse>>(
    '/social/friend-requests/incoming',
  );
  return unwrap(data);
}

export async function getOutgoingRequests(): Promise<OutgoingFriendRequestsResponse> {
  const { data } = await apiClient.get<Envelope<OutgoingFriendRequestsResponse>>(
    '/social/friend-requests/outgoing',
  );
  return unwrap(data);
}

export async function sendFriendRequest(
  receiverUserId: string,
  message: string | null,
): Promise<FriendRequestRow> {
  const { data } = await apiClient.post<
    Envelope<{ request: FriendRequestRow }>
  >('/social/friend-requests', { receiverUserId, message });
  return unwrap(data).request;
}

export async function acceptFriendRequest(
  requestId: string,
): Promise<{ request: FriendRequestRow; friendUserId: string }> {
  const { data } = await apiClient.post<
    Envelope<{ request: FriendRequestRow; friendUserId: string }>
  >(`/social/friend-requests/${encodeURIComponent(requestId)}/accept`);
  return unwrap(data);
}

export async function declineFriendRequest(
  requestId: string,
): Promise<FriendRequestRow> {
  const { data } = await apiClient.post<
    Envelope<{ request: FriendRequestRow }>
  >(`/social/friend-requests/${encodeURIComponent(requestId)}/decline`);
  return unwrap(data).request;
}

export async function cancelFriendRequest(
  requestId: string,
): Promise<FriendRequestRow> {
  const { data } = await apiClient.delete<
    Envelope<{ request: FriendRequestRow }>
  >(`/social/friend-requests/${encodeURIComponent(requestId)}`);
  return unwrap(data).request;
}

export async function removeFriend(
  friendUserId: string,
): Promise<{ removed: boolean }> {
  const { data } = await apiClient.delete<Envelope<{ removed: boolean }>>(
    `/social/friends/${encodeURIComponent(friendUserId)}`,
  );
  return unwrap(data);
}

export async function getBlocks(): Promise<PlayerBlockListResponse> {
  const { data } = await apiClient.get<Envelope<PlayerBlockListResponse>>(
    '/social/blocks',
  );
  return unwrap(data);
}

export async function blockUser(userId: string): Promise<PlayerBlockRow> {
  const { data } = await apiClient.post<Envelope<{ block: PlayerBlockRow }>>(
    '/social/block',
    { userId },
  );
  return unwrap(data).block;
}

export async function unblockUser(
  userId: string,
): Promise<{ removed: boolean }> {
  const { data } = await apiClient.delete<Envelope<{ removed: boolean }>>(
    `/social/block/${encodeURIComponent(userId)}`,
  );
  return unwrap(data);
}
