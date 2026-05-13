import { apiClient } from './client';
import type { MailType } from './mail';

export type AdminMailKind = 'SEND_ONE' | 'SEND_BULK' | 'SEND_GLOBAL';

export interface AdminMailRewardItem {
  itemKey: string;
  qty: number;
}

export interface AdminMailReward {
  linhThach: string;
  tienNgoc: number; // Phase 31 cap = 0.
  exp: string;
  items: AdminMailRewardItem[];
}

export interface SystemGiftTargetRule {
  type:
    | 'ALL_PLAYERS'
    | 'REALM_RANGE'
    | 'CREATED_BEFORE'
    | 'ACTIVE_IN_LAST_DAYS'
    | 'SECT_MEMBERS'
    | 'EVENT_PARTICIPANTS';
  realmTierMin?: number;
  realmTierMax?: number;
  createdBefore?: string;
  activeInLastDays?: number;
  sectId?: string;
  eventDefId?: string;
}

export interface AdminMailLogRow {
  id: string;
  adminUserId: string;
  kind: AdminMailKind;
  mailType: MailType;
  subject: string;
  reason: string;
  mailCount: number;
  recipientsSnapshot: string[];
  targetRuleSnapshot: SystemGiftTargetRule | null;
  createdAt: string;
}

export interface AdminMailSendResult {
  logId: string;
  mailCount: number;
  targetCount: number;
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

export async function listAdminMailLogs(opts?: {
  cursor?: string;
  limit?: number;
}): Promise<AdminMailLogRow[]> {
  const params = new URLSearchParams();
  if (opts?.cursor) params.set('cursor', opts.cursor);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const { data } = await apiClient.get<Envelope<{ logs: AdminMailLogRow[] }>>(
    `/admin/mail${qs ? `?${qs}` : ''}`,
  );
  return unwrap(data).logs;
}

export async function sendOne(input: {
  mailType: MailType;
  subject: string;
  body: string;
  senderName?: string;
  reward: AdminMailReward;
  expiresAt: string | null;
  reason: string;
  recipientCharacterId: string;
}): Promise<AdminMailSendResult> {
  const { data } = await apiClient.post<Envelope<AdminMailSendResult>>(
    '/admin/mail/send-one',
    input,
  );
  return unwrap(data);
}

export async function sendBulk(input: {
  mailType: MailType;
  subject: string;
  body: string;
  senderName?: string;
  reward: AdminMailReward;
  expiresAt: string | null;
  reason: string;
  recipientCharacterIds: string[];
}): Promise<AdminMailSendResult> {
  const { data } = await apiClient.post<Envelope<AdminMailSendResult>>(
    '/admin/mail/send-bulk',
    input,
  );
  return unwrap(data);
}

export async function sendGlobal(input: {
  mailType: MailType;
  subject: string;
  body: string;
  senderName?: string;
  reward: AdminMailReward;
  expiresAt: string | null;
  reason: string;
  targetRule: SystemGiftTargetRule;
  previewOnly?: boolean;
}): Promise<AdminMailSendResult> {
  const { data } = await apiClient.post<Envelope<AdminMailSendResult>>(
    '/admin/mail/send-global',
    input,
  );
  return unwrap(data);
}
