/**
 * Phase 19.1 — Private chat 1-1 REST client. Endpoints khớp
 * `apps/api/src/modules/chat-private/chat-private.controller.ts`.
 *
 * Realtime fanout: server emit `private-chat:msg` qua WS đến cả 2 thành
 * viên thread khi message mới insert (xem `apps/api/src/modules/
 * chat-private/chat-private.service.ts`). FE store nên append message
 * vào thread state khi nhận event này.
 */
import { apiClient } from './client';
import type {
  PrivateChatMessageRow,
  PrivateChatMessagesResponse,
  PrivateChatThreadListResponse,
  PrivateChatThreadRow,
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

export async function listPrivateThreads(): Promise<PrivateChatThreadListResponse> {
  const { data } = await apiClient.get<Envelope<PrivateChatThreadListResponse>>(
    '/chat/private/threads',
  );
  return unwrap(data);
}

export async function openPrivateThread(
  peerUserId: string,
): Promise<PrivateChatThreadRow> {
  const { data } = await apiClient.post<
    Envelope<{ thread: PrivateChatThreadRow }>
  >('/chat/private/threads', { peerUserId });
  return unwrap(data).thread;
}

export async function listPrivateMessages(
  threadId: string,
  limit?: number,
): Promise<PrivateChatMessagesResponse> {
  const { data } = await apiClient.get<Envelope<PrivateChatMessagesResponse>>(
    `/chat/private/threads/${encodeURIComponent(threadId)}/messages`,
    { params: limit ? { limit } : undefined },
  );
  return unwrap(data);
}

export async function sendPrivateMessage(
  threadId: string,
  body: string,
): Promise<PrivateChatMessageRow> {
  const { data } = await apiClient.post<
    Envelope<{ message: PrivateChatMessageRow }>
  >(`/chat/private/threads/${encodeURIComponent(threadId)}/messages`, {
    body,
  });
  return unwrap(data).message;
}
