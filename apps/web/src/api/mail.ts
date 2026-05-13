import { apiClient } from './client';

export interface MailRewardItem {
  itemKey: string;
  qty: number;
}

export type MailType =
  | 'SYSTEM'
  | 'ADMIN'
  | 'REWARD'
  | 'EVENT'
  | 'MAINTENANCE'
  | 'PURCHASE'
  | 'SECT'
  | 'FRIEND'
  | 'RETURNER'
  | 'PVP';

export type MailStatus = 'UNREAD' | 'READ' | 'CLAIMED' | 'EXPIRED' | 'DELETED';

export interface MailView {
  id: string;
  senderName: string;
  subject: string;
  body: string;
  rewardLinhThach: string;
  rewardTienNgoc: number;
  rewardExp: string;
  rewardItems: MailRewardItem[];
  readAt: string | null;
  claimedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  claimable: boolean;
  /** Phase 31.0 — taxonomy enum. */
  mailType: MailType;
  /** Phase 31.0 — derived status. */
  status: MailStatus;
  /** Phase 31.0 — soft-delete flag. */
  deleted: boolean;
}

export interface MailClaimAllResult {
  claimedCount: number;
  totalLinhThach: string;
  totalTienNgoc: number;
  totalExp: string;
  skippedCount: number;
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

export async function listMail(): Promise<MailView[]> {
  const { data } = await apiClient.get<Envelope<{ mails: MailView[] }>>('/mail/me');
  return unwrap(data).mails;
}

export async function fetchMailUnreadCount(): Promise<number> {
  const { data } =
    await apiClient.get<Envelope<{ count: number }>>('/mail/unread-count');
  return unwrap(data).count;
}

export async function readMail(id: string): Promise<MailView> {
  const { data } = await apiClient.post<Envelope<{ mail: MailView }>>(
    `/mail/${encodeURIComponent(id)}/read`,
    {},
  );
  return unwrap(data).mail;
}

export async function claimMail(id: string): Promise<MailView> {
  const { data } = await apiClient.post<Envelope<{ mail: MailView }>>(
    `/mail/${encodeURIComponent(id)}/claim`,
    {},
  );
  return unwrap(data).mail;
}

/** Phase 31.0 — single mail getter. */
export async function fetchMail(id: string): Promise<MailView> {
  const { data } = await apiClient.get<Envelope<{ mail: MailView }>>(
    `/mail/${encodeURIComponent(id)}`,
  );
  return unwrap(data).mail;
}

/** Phase 31.0 — soft-delete (set deletedAt). */
export async function deleteMail(id: string): Promise<MailView> {
  const { data } = await apiClient.post<Envelope<{ mail: MailView }>>(
    `/mail/${encodeURIComponent(id)}/delete`,
    {},
  );
  return unwrap(data).mail;
}

/** Phase 31.0 — bulk claim. */
export async function claimAllMail(): Promise<MailClaimAllResult> {
  const { data } = await apiClient.post<Envelope<{ result: MailClaimAllResult }>>(
    '/mail/claim-all',
    {},
  );
  return unwrap(data).result;
}
