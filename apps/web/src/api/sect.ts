import { apiClient } from './client';

export interface SectListView {
  id: string;
  name: string;
  description: string;
  level: number;
  treasuryLinhThach: string;
  memberCount: number;
  leaderName: string | null;
  createdAt: string;
}

export interface SectMemberView {
  id: string;
  name: string;
  realmKey: string;
  realmStage: number;
  congHien: number;
  role: 'LEADER' | 'ELDER' | 'MEMBER';
  isLeader: boolean;
  isMe: boolean;
}

export interface SectDetailView extends SectListView {
  members: SectMemberView[];
  isMyMember: boolean;
  isMyLeader: boolean;
}

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

export async function listSects(): Promise<SectListView[]> {
  const { data } = await apiClient.get<Envelope<{ sects: SectListView[] }>>('/sect/list');
  return unwrap(data).sects;
}

export async function mySect(): Promise<SectDetailView | null> {
  const { data } = await apiClient.get<Envelope<{ sect: SectDetailView | null }>>(
    '/sect/me',
  );
  return unwrap(data).sect;
}

export async function getSect(id: string): Promise<SectDetailView> {
  const { data } = await apiClient.get<Envelope<{ sect: SectDetailView }>>(`/sect/${id}`);
  return unwrap(data).sect;
}

export async function createSect(
  name: string,
  description: string,
): Promise<SectDetailView> {
  const { data } = await apiClient.post<Envelope<{ sect: SectDetailView }>>(
    '/sect/create',
    { name, description },
  );
  return unwrap(data).sect;
}

export async function joinSect(id: string): Promise<SectDetailView> {
  const { data } = await apiClient.post<Envelope<{ sect: SectDetailView }>>(
    `/sect/${id}/join`,
    {},
  );
  return unwrap(data).sect;
}

export async function leaveSect(): Promise<void> {
  const { data } = await apiClient.post<Envelope<{ ok: true }>>('/sect/leave', {});
  unwrap(data);
}

export async function contributeSect(amount: string): Promise<SectDetailView> {
  const { data } = await apiClient.post<Envelope<{ sect: SectDetailView }>>(
    '/sect/contribute',
    { amount },
  );
  return unwrap(data).sect;
}

export async function promoteMember(targetCharacterId: string): Promise<SectDetailView> {
  const { data } = await apiClient.post<Envelope<{ sect: SectDetailView }>>(
    '/sect/promote',
    { targetCharacterId },
  );
  return unwrap(data).sect;
}

export async function demoteMember(targetCharacterId: string): Promise<SectDetailView> {
  const { data } = await apiClient.post<Envelope<{ sect: SectDetailView }>>(
    '/sect/demote',
    { targetCharacterId },
  );
  return unwrap(data).sect;
}

export async function kickMember(targetCharacterId: string): Promise<SectDetailView> {
  const { data } = await apiClient.post<Envelope<{ sect: SectDetailView }>>(
    '/sect/kick',
    { targetCharacterId },
  );
  return unwrap(data).sect;
}
