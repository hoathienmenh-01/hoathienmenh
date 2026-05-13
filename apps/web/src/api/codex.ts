/**
 * Phase 32.0 — Codex / Tu Tiên Bách Khoa API client.
 *
 * Player: list/detail/discover/progress.
 * Admin: reindex/hide/show.
 */
import { apiClient } from './client';
import type { CodexEntryType } from '@xuantoi/shared';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface CodexEntryRow {
  id: string;
  entryKey: string;
  type: CodexEntryType;
  refKey: string;
  displayName: string;
  description: string | null;
  iconKey: string | null;
  visibility: string;
  quality: string | null;
  tier: number | null;
  tagsJson: unknown;
  sourceHintsJson: unknown;
  usageHintsJson: unknown;
  relatedEntryKeysJson: unknown;
  discovered?: boolean;
}

export interface CodexDetailRow {
  entry: CodexEntryRow;
  marketPrice: {
    itemKey: string;
    avgPrice24h: string;
    avgPrice7d: string;
    avgPrice30d: string;
    minPrice: string;
    maxPrice: string;
    volume24h: number;
    volume7d: number;
  } | null;
}

export async function listCodex(opts: {
  type?: CodexEntryType;
  limit?: number;
  offset?: number;
} = {}): Promise<{ items: CodexEntryRow[]; total: number }> {
  const params = new URLSearchParams();
  if (opts.type) params.set('type', opts.type);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.offset) params.set('offset', String(opts.offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  const { data } = await apiClient.get<Envelope<{ items: CodexEntryRow[]; total: number }>>(
    `/codex/entries${qs}`,
  );
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'CODEX_LIST_FAIL');
  return data.data;
}

export async function getCodexDetail(entryKey: string): Promise<CodexDetailRow | null> {
  const { data } = await apiClient.get<Envelope<CodexDetailRow | null>>(
    `/codex/entries/${encodeURIComponent(entryKey)}`,
  );
  if (!data.ok) throw new Error(data.error?.code ?? 'CODEX_DETAIL_FAIL');
  return data.data ?? null;
}

export async function discoverCodex(
  entryKey: string,
  context?: string,
): Promise<{ discovered: boolean; alreadyDiscovered: boolean }> {
  const { data } = await apiClient.post<
    Envelope<{ discovered: boolean; alreadyDiscovered: boolean }>
  >(`/codex/entries/${encodeURIComponent(entryKey)}/discover`, { context });
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'CODEX_DISCOVER_FAIL');
  return data.data;
}

export async function getCodexProgress(): Promise<{
  overallPct: number;
  bestiaryPct: number;
  isComplete: boolean;
}> {
  const { data } = await apiClient.get<Envelope<{
    overallPct: number;
    bestiaryPct: number;
    isComplete: boolean;
  }>>('/codex/progress');
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'CODEX_PROGRESS_FAIL');
  return data.data;
}

// ── Admin ──────────────────────────────────────────────────────────────

export async function adminReindexCodex(reason: string): Promise<{
  entriesUpserted: number;
  entriesRemoved: number;
  issuesFound: number;
}> {
  const { data } = await apiClient.post<
    Envelope<{ entriesUpserted: number; entriesRemoved: number; issuesFound: number }>
  >('/admin/codex/reindex', { reason });
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'CODEX_REINDEX_FAIL');
  return data.data;
}

export async function adminUpdateCodexEntry(
  entryKey: string,
  input: {
    description?: string;
    visibility?: 'PUBLIC' | 'DISCOVERED_ONLY' | 'HIDDEN_UNTIL_DISCOVERED' | 'ADMIN_ONLY';
    iconKey?: string;
    reason: string;
  },
): Promise<void> {
  const { data } = await apiClient.post<Envelope<unknown>>(
    `/admin/codex/entries/${encodeURIComponent(entryKey)}`,
    input,
  );
  if (!data.ok) throw new Error(data.error?.code ?? 'CODEX_UPDATE_FAIL');
}

export async function adminHideCodex(entryKey: string, reason: string): Promise<void> {
  return adminUpdateCodexEntry(entryKey, { visibility: 'ADMIN_ONLY', reason });
}

export async function adminShowCodex(entryKey: string, reason: string): Promise<void> {
  return adminUpdateCodexEntry(entryKey, { visibility: 'PUBLIC', reason });
}

export async function adminListCodexIssues(opts: { resolved?: boolean } = {}) {
  const qs = opts.resolved !== undefined ? `?resolved=${opts.resolved}` : '';
  const { data } = await apiClient.get<Envelope<Array<{
    id: string;
    issueKey: string;
    entryKey: string;
    type: string;
    severity: string;
    message: string;
    resolved: boolean;
  }>>>(`/admin/codex/audit${qs}`);
  if (!data.ok || !data.data) throw new Error(data.error?.code ?? 'CODEX_ISSUES_FAIL');
  return data.data;
}
