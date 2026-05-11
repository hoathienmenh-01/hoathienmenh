/**
 * Phase 19.4 — Group / Party System Upgrade — REST client.
 *
 * Endpoints khớp `apps/api/src/modules/party/party.controller.ts`.
 * Response server bọc `{ ok, data, error }`. `unwrap` ném
 * `Object.assign(Error, { code })` để FE catch theo code (vd
 * PARTY_FULL, INVITE_EXPIRED) → render i18n.
 */
import { apiClient } from './client';
import type {
  MyPartyResponse,
  PartyDto,
  PartyInviteDto,
  PartyInviteListResponse,
  PartyMemberDto,
  PartyMemberListResponse,
} from '@xuantoi/shared';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env.ok || env.data === undefined) {
    const err = env.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), { code: err.code });
  }
  return env.data;
}

export async function getMyParty(): Promise<MyPartyResponse> {
  const { data } = await apiClient.get<Envelope<MyPartyResponse>>(
    '/party/me',
  );
  return unwrap(data);
}

export async function listPartyMembers(): Promise<PartyMemberListResponse> {
  const { data } = await apiClient.get<Envelope<PartyMemberListResponse>>(
    '/party/members',
  );
  return unwrap(data);
}

export async function listIncomingPartyInvites(): Promise<PartyInviteListResponse> {
  const { data } = await apiClient.get<Envelope<PartyInviteListResponse>>(
    '/party/invites/incoming',
  );
  return unwrap(data);
}

export async function listOutgoingPartyInvites(): Promise<PartyInviteListResponse> {
  const { data } = await apiClient.get<Envelope<PartyInviteListResponse>>(
    '/party/invites/outgoing',
  );
  return unwrap(data);
}

export async function createParty(
  name: string | null,
): Promise<{ party: PartyDto; members: PartyMemberDto[] }> {
  const { data } = await apiClient.post<
    Envelope<{ party: PartyDto; members: PartyMemberDto[] }>
  >('/party', { name });
  return unwrap(data);
}

export async function invitePlayerToParty(
  inviteeUserId: string,
): Promise<{ invite: PartyInviteDto }> {
  const { data } = await apiClient.post<Envelope<{ invite: PartyInviteDto }>>(
    '/party/invites',
    { inviteeUserId },
  );
  return unwrap(data);
}

export async function acceptPartyInvite(
  inviteId: string,
): Promise<{ party: PartyDto; members: PartyMemberDto[] }> {
  const { data } = await apiClient.post<
    Envelope<{ party: PartyDto; members: PartyMemberDto[] }>
  >(`/party/invites/${encodeURIComponent(inviteId)}/accept`);
  return unwrap(data);
}

export async function declinePartyInvite(
  inviteId: string,
): Promise<{ invite: PartyInviteDto }> {
  const { data } = await apiClient.post<Envelope<{ invite: PartyInviteDto }>>(
    `/party/invites/${encodeURIComponent(inviteId)}/decline`,
  );
  return unwrap(data);
}

export async function cancelPartyInvite(
  inviteId: string,
): Promise<{ invite: PartyInviteDto }> {
  const { data } = await apiClient.delete<Envelope<{ invite: PartyInviteDto }>>(
    `/party/invites/${encodeURIComponent(inviteId)}`,
  );
  return unwrap(data);
}

export async function leaveParty(): Promise<{
  party: PartyDto | null;
  members: PartyMemberDto[];
}> {
  const { data } = await apiClient.post<
    Envelope<{ party: PartyDto | null; members: PartyMemberDto[] }>
  >('/party/leave');
  return unwrap(data);
}

export async function kickPartyMember(
  targetUserId: string,
): Promise<{ party: PartyDto; members: PartyMemberDto[] }> {
  const { data } = await apiClient.post<
    Envelope<{ party: PartyDto; members: PartyMemberDto[] }>
  >(`/party/members/${encodeURIComponent(targetUserId)}/kick`);
  return unwrap(data);
}

export async function transferPartyLeader(
  targetUserId: string,
): Promise<{ party: PartyDto; members: PartyMemberDto[] }> {
  const { data } = await apiClient.post<
    Envelope<{ party: PartyDto; members: PartyMemberDto[] }>
  >('/party/leader/transfer', { targetUserId });
  return unwrap(data);
}

export async function disbandParty(): Promise<{ partyId: string }> {
  const { data } = await apiClient.post<Envelope<{ partyId: string }>>(
    '/party/disband',
  );
  return unwrap(data);
}
