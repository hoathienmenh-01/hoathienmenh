/**
 * Phase 18.1 — Admin Security API client.
 *
 * Endpoints:
 *   - `GET  /admin/security/blocks?type=&limit=&cursor=`
 *   - `GET  /admin/security/events?from=&to=&severity=&type=&limit=`
 *   - `GET  /admin/security/rate-limit/status?policy=&scope=&subject=`
 *   - `POST /admin/security/blocks/:id/lift`
 *
 * Type: nội bộ UI — phản ánh response shape của
 * `AdminSecurityController`. KHÔNG re-export Prisma types để tránh
 * coupling FE → DB schema. IP hash chỉ là string hex 64 char (privacy).
 */
import { apiClient } from './client';

export type SecurityBlockType = 'IP' | 'USER';

export interface AdminSecurityBlockRow {
  id: string;
  type: SecurityBlockType;
  subjectHash: string;
  reason: string;
  expiresAt: string;
  createdAt: string;
}

export type SecurityEventSeverity = 'INFO' | 'WARN' | 'CRITICAL';

export interface AdminSecurityEventRow {
  id: string;
  type: string;
  severity: SecurityEventSeverity;
  ipHash: string | null;
  userId: string | null;
  characterId: string | null;
  policy: string | null;
  detailJson: unknown;
  createdAt: string;
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

export interface ListBlocksParams {
  type?: SecurityBlockType;
  limit?: number;
  cursor?: string;
}

export async function adminListSecurityBlocks(
  params: ListBlocksParams = {},
): Promise<AdminSecurityBlockRow[]> {
  const { data } = await apiClient.get<
    Envelope<{ blocks: AdminSecurityBlockRow[] }>
  >('/admin/security/blocks', { params });
  return unwrap(data).blocks;
}

export interface ListEventsParams {
  type?: string;
  severity?: SecurityEventSeverity;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export async function adminListSecurityEvents(
  params: ListEventsParams = {},
): Promise<AdminSecurityEventRow[]> {
  const { data } = await apiClient.get<
    Envelope<{ events: AdminSecurityEventRow[] }>
  >('/admin/security/events', { params });
  return unwrap(data).events;
}

export async function adminLiftSecurityBlock(
  blockId: string,
): Promise<AdminSecurityBlockRow> {
  const { data } = await apiClient.post<
    Envelope<{
      block: Pick<AdminSecurityBlockRow, 'id' | 'type' | 'subjectHash' | 'reason'>;
    }>
  >(`/admin/security/blocks/${encodeURIComponent(blockId)}/lift`);
  const out = unwrap(data).block;
  return {
    id: out.id,
    type: out.type,
    subjectHash: out.subjectHash,
    reason: out.reason,
    expiresAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}
