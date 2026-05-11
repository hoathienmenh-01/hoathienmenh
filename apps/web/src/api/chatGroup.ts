/**
 * Phase 19.1 — Group chat REST client. Endpoints khớp
 * `apps/api/src/modules/chat-group/chat-group.controller.ts`.
 *
 * Realtime fanout: server emit `group-chat:msg` đến mọi member của
 * group khi message mới insert (chỉ member nhận — non-member tuyệt
 * đối không thấy).
 */
import { apiClient } from './client';
import type {
  GroupChatListResponse,
  GroupChatMemberRow,
  GroupChatMessageRow,
  GroupChatMessagesResponse,
  GroupChatRow,
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

export async function listGroups(): Promise<GroupChatListResponse> {
  const { data } = await apiClient.get<Envelope<GroupChatListResponse>>(
    '/chat/groups',
  );
  return unwrap(data);
}

export async function createGroup(name: string): Promise<GroupChatRow> {
  const { data } = await apiClient.post<Envelope<{ group: GroupChatRow }>>(
    '/chat/groups',
    { name },
  );
  return unwrap(data).group;
}

export async function addGroupMember(
  groupId: string,
  userId: string,
): Promise<GroupChatMemberRow> {
  const { data } = await apiClient.post<
    Envelope<{ member: GroupChatMemberRow }>
  >(`/chat/groups/${encodeURIComponent(groupId)}/members`, { userId });
  return unwrap(data).member;
}

export async function removeGroupMember(
  groupId: string,
  targetUserId: string,
): Promise<{ removed: boolean }> {
  const { data } = await apiClient.delete<Envelope<{ removed: boolean }>>(
    `/chat/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(targetUserId)}`,
  );
  return unwrap(data);
}

export async function listGroupMessages(
  groupId: string,
  limit?: number,
): Promise<GroupChatMessagesResponse> {
  const { data } = await apiClient.get<Envelope<GroupChatMessagesResponse>>(
    `/chat/groups/${encodeURIComponent(groupId)}/messages`,
    { params: limit ? { limit } : undefined },
  );
  return unwrap(data);
}

export async function sendGroupMessage(
  groupId: string,
  body: string,
): Promise<GroupChatMessageRow> {
  const { data } = await apiClient.post<
    Envelope<{ message: GroupChatMessageRow }>
  >(`/chat/groups/${encodeURIComponent(groupId)}/messages`, { body });
  return unwrap(data).message;
}
