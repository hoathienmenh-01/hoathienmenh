import { apiClient } from './client';

export type MentorRelationStatus = 'PENDING' | 'ACTIVE' | 'DECLINED' | 'ENDED';

export interface MentorProfileRow {
  mentorUserId: string;
  displayName: string | null;
  realmTier: number;
  intro: string | null;
  acceptingStudents: boolean;
  activeStudentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MentorRelationRow {
  id: string;
  mentorUserId: string;
  studentUserId: string;
  status: MentorRelationStatus;
  message: string | null;
  mentorDisplayName: string | null;
  studentDisplayName: string | null;
  createdAt: string;
  respondedAt: string | null;
  endedAt: string | null;
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

export async function getMentorProfile(): Promise<MentorProfileRow | null> {
  const { data } = await apiClient.get<
    Envelope<{ profile: MentorProfileRow | null }>
  >('/mentor/profile');
  return unwrap(data).profile;
}

export async function registerMentor(input: {
  intro?: string | null;
  acceptingStudents?: boolean;
}): Promise<MentorProfileRow> {
  const { data } = await apiClient.post<Envelope<{ profile: MentorProfileRow }>>(
    '/mentor/register',
    input,
  );
  return unwrap(data).profile;
}

export async function sendMentorRequest(input: {
  mentorUserId: string;
  message?: string | null;
}): Promise<MentorRelationRow> {
  const { data } = await apiClient.post<Envelope<{ relation: MentorRelationRow }>>(
    '/mentor/request',
    input,
  );
  return unwrap(data).relation;
}

export async function respondMentorRequest(
  relationId: string,
  accept: boolean,
): Promise<MentorRelationRow> {
  const { data } = await apiClient.post<Envelope<{ relation: MentorRelationRow }>>(
    `/mentor/accept/${encodeURIComponent(relationId)}`,
    { accept },
  );
  return unwrap(data).relation;
}

export async function listMentorStudents(): Promise<{
  students: MentorRelationRow[];
  pending: MentorRelationRow[];
}> {
  const { data } = await apiClient.get<
    Envelope<{ students: MentorRelationRow[]; pending: MentorRelationRow[] }>
  >('/mentor/students');
  return unwrap(data);
}

export async function getStudentMentorContext(): Promise<{
  mentor: MentorRelationRow | null;
  pending: MentorRelationRow[];
}> {
  const { data } = await apiClient.get<
    Envelope<{ mentor: MentorRelationRow | null; pending: MentorRelationRow[] }>
  >('/mentor/student-context');
  return unwrap(data);
}
