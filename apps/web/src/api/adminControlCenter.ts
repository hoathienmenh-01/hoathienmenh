/**
 * Phase 27.6 — Admin Control Center V2 client.
 *
 * Wrap REST endpoints `/admin/control-center/*`. Tách module riêng để
 * KHÔNG phình `admin.ts` (đã 1100+ dòng). Type re-use shared catalog
 * — không định nghĩa duplicate.
 */
import { apiClient } from './client';
import type {
  AdminActionType,
  AdminOverviewSnapshot,
  AdminPermissionKey,
  AdminRiskLevel,
  AdminRoleKey,
  ContentStatusSpec,
  ContentStatusType,
  DropProfileSourceType,
  DropProfileSpec,
  DropProfileValidationIssue,
  DropSimulationResult,
  RewardProfileContentType,
  RewardProfileSpec,
  RewardProfileValidationIssue,
} from '@xuantoi/shared';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; meta?: unknown };
}

function unwrap<T>(env: Envelope<T>): T {
  if (!env.ok || env.data === undefined || env.data === null) {
    const err = env.error ?? { code: 'UNKNOWN', message: 'UNKNOWN' };
    throw Object.assign(new Error(err.message), {
      code: err.code,
      meta: err.meta,
    });
  }
  return env.data;
}

export async function adminControlCenterOverview(): Promise<AdminOverviewSnapshot> {
  const { data } = await apiClient.get<Envelope<AdminOverviewSnapshot>>(
    '/admin/control-center/overview',
  );
  return unwrap(data);
}

export interface AdminControlCenterMe {
  role: AdminRoleKey;
  permissions: readonly AdminPermissionKey[];
}

export async function adminControlCenterMe(): Promise<AdminControlCenterMe> {
  const { data } = await apiClient.get<Envelope<AdminControlCenterMe>>(
    '/admin/control-center/permissions/me',
  );
  return unwrap(data);
}

export interface AdminControlCenterPermissionMatrix {
  roles: readonly AdminRoleKey[];
  permissions: readonly AdminPermissionKey[];
  rolePermissions: Readonly<Record<AdminRoleKey, readonly AdminPermissionKey[]>>;
}

export async function adminControlCenterPermissionMatrix(): Promise<AdminControlCenterPermissionMatrix> {
  const { data } = await apiClient.get<
    Envelope<AdminControlCenterPermissionMatrix>
  >('/admin/control-center/permissions/matrix');
  return unwrap(data);
}

export interface AdminControlCenterActionMetaRow {
  action: AdminActionType;
  defaultRisk: AdminRiskLevel;
  requiresConfirmation: boolean;
}

export interface AdminControlCenterAuditActionTypes {
  actions: readonly AdminControlCenterActionMetaRow[];
  riskLevels: readonly AdminRiskLevel[];
}

export async function adminControlCenterAuditActionTypes(): Promise<AdminControlCenterAuditActionTypes> {
  const { data } = await apiClient.get<
    Envelope<AdminControlCenterAuditActionTypes>
  >('/admin/control-center/audit-action-types');
  return unwrap(data);
}

// ── Reward Profile ─────────────────────────────────────────────────

export async function listRewardProfiles(filters: {
  contentType?: RewardProfileContentType;
  contentKey?: string;
  active?: boolean;
}): Promise<RewardProfileSpec[]> {
  const params: Record<string, string> = {};
  if (filters.contentType) params.contentType = filters.contentType;
  if (filters.contentKey !== undefined) params.contentKey = filters.contentKey;
  if (filters.active !== undefined) params.active = String(filters.active);
  const { data } = await apiClient.get<Envelope<{ profiles: RewardProfileSpec[] }>>(
    '/admin/control-center/reward-profiles',
    { params },
  );
  return unwrap(data).profiles;
}

export async function validateRewardProfileApi(
  spec: Omit<RewardProfileSpec, 'version'>,
): Promise<{
  valid: boolean;
  issues: RewardProfileValidationIssue[];
}> {
  const { data } = await apiClient.post<
    Envelope<{ valid: boolean; issues: RewardProfileValidationIssue[] }>
  >('/admin/control-center/reward-profiles/validate', spec);
  return unwrap(data);
}

// ── Drop Profile ───────────────────────────────────────────────────

export async function listDropProfiles(filters: {
  sourceType?: DropProfileSourceType;
  sourceTier?: number;
  active?: boolean;
}): Promise<DropProfileSpec[]> {
  const params: Record<string, string> = {};
  if (filters.sourceType) params.sourceType = filters.sourceType;
  if (filters.sourceTier !== undefined) params.sourceTier = String(filters.sourceTier);
  if (filters.active !== undefined) params.active = String(filters.active);
  const { data } = await apiClient.get<Envelope<{ profiles: DropProfileSpec[] }>>(
    '/admin/control-center/drop-profiles',
    { params },
  );
  return unwrap(data).profiles;
}

export async function validateDropProfileApi(
  spec: Omit<DropProfileSpec, 'version'>,
): Promise<{ valid: boolean; issues: DropProfileValidationIssue[] }> {
  const { data } = await apiClient.post<
    Envelope<{ valid: boolean; issues: DropProfileValidationIssue[] }>
  >('/admin/control-center/drop-profiles/validate', spec);
  return unwrap(data);
}

export async function simulateDropProfileApi(input: {
  spec: Omit<DropProfileSpec, 'version'>;
  trials: number;
  seed?: number;
}): Promise<DropSimulationResult> {
  const { data } = await apiClient.post<
    Envelope<{ simulation: DropSimulationResult }>
  >('/admin/control-center/drop-profiles/simulate', input);
  return unwrap(data).simulation;
}

// ── Content Status ─────────────────────────────────────────────────

export async function listContentStatuses(filters: {
  contentType?: ContentStatusType;
  enabled?: boolean;
  paused?: boolean;
}): Promise<ContentStatusSpec[]> {
  const params: Record<string, string> = {};
  if (filters.contentType) params.contentType = filters.contentType;
  if (filters.enabled !== undefined) params.enabled = String(filters.enabled);
  if (filters.paused !== undefined) params.paused = String(filters.paused);
  const { data } = await apiClient.get<Envelope<{ statuses: ContentStatusSpec[] }>>(
    '/admin/control-center/content-statuses',
    { params },
  );
  return unwrap(data).statuses;
}
