import { apiClient } from './client';
import type { TopupOrderView } from './topup';
import type {
  AchievementDef,
  EconomyReportResponse,
  LiveOpsAnnouncementSeverity,
  LiveOpsAnnouncementStatus,
  LiveOpsAnnouncementTarget,
  LongTermGoalDef,
  ReputationGroupDef,
  TitleDef,
} from '@xuantoi/shared';

export type Role = 'PLAYER' | 'MOD' | 'ADMIN';

export interface AdminUserRow {
  id: string;
  email: string;
  role: Role;
  banned: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  character: {
    id: string;
    name: string;
    realmKey: string;
    realmStage: number;
    linhThach: string;
    tienNgoc: number;
  } | null;
}

export interface AdminAuditRow {
  id: string;
  actorUserId: string;
  actorEmail: string | null;
  action: string;
  meta: unknown;
  createdAt: string;
}

export interface AdminAchievementCatalogSummary {
  achievements: readonly AchievementDef[];
  titles: readonly TitleDef[];
  reputationGroups: readonly ReputationGroupDef[];
  longTermGoals: readonly LongTermGoalDef[];
}

export interface AdminPlayerProgressSummary {
  userId: string;
  characterId: string;
  characterName: string;
  achievements: Array<{
    achievementKey: string;
    progress: number;
    completedAt: string | null;
    claimedAt: string | null;
  }>;
  titles: Array<{
    titleKey: string;
    source: string;
    unlockedAt: string;
  }>;
  reputation: Array<{
    reputationGroup: string;
    score: number;
    dailyGain: number;
    dailyKey: string | null;
    lastGainedAt: string | null;
  }>;
  longTermGoals: Array<{
    goalKey: string;
    progress: number;
    completedAt: string | null;
  }>;
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

interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminListUsersFilters {
  role?: Role;
  banned?: boolean;
  /** Lọc character.linhThach (bigint) >= ngưỡng. Truyền dạng string số nguyên dương. */
  linhThachMin?: string;
  /** Lọc character.linhThach <= ngưỡng. */
  linhThachMax?: string;
  /** Lọc character.tienNgoc (int) trong khoảng. */
  tienNgocMin?: number;
  tienNgocMax?: number;
  /** Lọc character.realmKey chính xác (vd: `luyenkhi`, `truclo`, `kimdan`...). */
  realmKey?: string;
}

export async function adminListUsers(
  q: string,
  page: number,
  filters: AdminListUsersFilters = {},
): Promise<Page<AdminUserRow>> {
  const params: Record<string, string | number> = { q, page };
  if (filters.role) params.role = filters.role;
  if (filters.banned !== undefined) params.banned = filters.banned ? 'true' : 'false';
  if (filters.linhThachMin) params.linhThachMin = filters.linhThachMin;
  if (filters.linhThachMax) params.linhThachMax = filters.linhThachMax;
  if (filters.tienNgocMin !== undefined) params.tienNgocMin = filters.tienNgocMin;
  if (filters.tienNgocMax !== undefined) params.tienNgocMax = filters.tienNgocMax;
  if (filters.realmKey) params.realmKey = filters.realmKey;
  const { data } = await apiClient.get<Envelope<Page<AdminUserRow>>>('/admin/users', {
    params,
  });
  return unwrap(data);
}

export async function adminAchievementCatalog(): Promise<AdminAchievementCatalogSummary> {
  const { data } = await apiClient.get<Envelope<AdminAchievementCatalogSummary>>(
    '/admin/achievement-reputation/catalog',
  );
  return unwrap(data);
}

export async function adminAchievementProgress(
  userId: string,
): Promise<AdminPlayerProgressSummary> {
  const { data } = await apiClient.get<Envelope<AdminPlayerProgressSummary>>(
    `/admin/users/${encodeURIComponent(userId)}/achievement-reputation`,
  );
  return unwrap(data);
}

/**
 * Smart admin user export CSV (session 9i task E). Trả về `text/csv` raw
 * + metadata header. ADMIN-only (BE `@RequireAdmin()`).
 *
 * BE: `GET /admin/users.csv?q=...&role=...&banned=...&{linhThach,tienNgoc}{Min,Max}=...&realmKey=...`.
 * Cap 5000 row trong service; nếu truncated thì response header
 * `X-Export-Truncated: true`.
 */
export async function adminExportUsersCsv(
  q: string,
  filters: AdminListUsersFilters = {},
): Promise<{ csv: string; total: number; rows: number; truncated: boolean }> {
  const params: Record<string, string | number> = {};
  if (q) params.q = q;
  if (filters.role) params.role = filters.role;
  if (filters.banned !== undefined) params.banned = filters.banned ? 'true' : 'false';
  if (filters.linhThachMin) params.linhThachMin = filters.linhThachMin;
  if (filters.linhThachMax) params.linhThachMax = filters.linhThachMax;
  if (filters.tienNgocMin !== undefined) params.tienNgocMin = filters.tienNgocMin;
  if (filters.tienNgocMax !== undefined) params.tienNgocMax = filters.tienNgocMax;
  if (filters.realmKey) params.realmKey = filters.realmKey;
  const res = await apiClient.get<string>('/admin/users.csv', {
    params,
    responseType: 'text',
    transformResponse: (raw: string) => raw,
  });
  const total = Number.parseInt((res.headers['x-export-total'] as string) ?? '0', 10) || 0;
  const rows = Number.parseInt((res.headers['x-export-rows'] as string) ?? '0', 10) || 0;
  const truncated = (res.headers['x-export-truncated'] as string | undefined) === 'true';
  return { csv: res.data, total, rows, truncated };
}

export async function adminBanUser(id: string, banned: boolean): Promise<void> {
  const { data } = await apiClient.post<Envelope<{ ok: true }>>(
    `/admin/users/${encodeURIComponent(id)}/ban`,
    { banned },
  );
  unwrap(data);
}

export async function adminSetRole(id: string, role: Role): Promise<void> {
  const { data } = await apiClient.post<Envelope<{ ok: true }>>(
    `/admin/users/${encodeURIComponent(id)}/role`,
    { role },
  );
  unwrap(data);
}

export async function adminGrant(
  id: string,
  linhThach: string,
  tienNgoc: number,
  reason: string,
): Promise<void> {
  const { data } = await apiClient.post<Envelope<{ ok: true }>>(
    `/admin/users/${encodeURIComponent(id)}/grant`,
    { linhThach, tienNgoc, reason },
  );
  unwrap(data);
}

/**
 * Admin thu hồi item khỏi túi người chơi. Ghi `ItemLedger` reason `ADMIN_REVOKE`
 * + audit log `admin.inventory.revoke`. ADMIN-only (BE `@RequireAdmin()`).
 *
 * BE: `POST /admin/users/:id/inventory/revoke` body `{ itemKey, qty, reason }`.
 * Schema: `qty` integer 1..999, `reason` ≤200 ký tự, `itemKey` 1..80.
 * Lỗi BE map: `ITEM_NOT_FOUND` / `INSUFFICIENT_QTY` → `INVALID_INPUT`.
 */
export async function adminRevokeInventory(
  id: string,
  itemKey: string,
  qty: number,
  reason: string,
): Promise<void> {
  const { data } = await apiClient.post<Envelope<{ ok: true }>>(
    `/admin/users/${encodeURIComponent(id)}/inventory/revoke`,
    { itemKey, qty, reason },
  );
  unwrap(data);
}

export async function adminListTopups(
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | '',
  page: number,
  filters: { from?: string; to?: string; email?: string } = {},
): Promise<Page<TopupOrderView & { userEmail: string }>> {
  const params: Record<string, string | number> = { page };
  if (status) params.status = status;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.email) params.email = filters.email;
  const { data } = await apiClient.get<Envelope<Page<TopupOrderView & { userEmail: string }>>>(
    '/admin/topups',
    { params },
  );
  return unwrap(data);
}

export async function adminApproveTopup(id: string, note: string): Promise<void> {
  const { data } = await apiClient.post<Envelope<{ ok: true }>>(
    `/admin/topups/${encodeURIComponent(id)}/approve`,
    { note },
  );
  unwrap(data);
}

export async function adminRejectTopup(id: string, note: string): Promise<void> {
  const { data } = await apiClient.post<Envelope<{ ok: true }>>(
    `/admin/topups/${encodeURIComponent(id)}/reject`,
    { note },
  );
  unwrap(data);
}

export async function adminListAudit(
  page: number,
  filters: { action?: string; email?: string } = {},
): Promise<Page<AdminAuditRow>> {
  const params: Record<string, string | number> = { page };
  if (filters.action) params.action = filters.action;
  if (filters.email) params.email = filters.email;
  const { data } = await apiClient.get<Envelope<Page<AdminAuditRow>>>('/admin/audit', {
    params,
  });
  return unwrap(data);
}

export interface AdminStats {
  users: { total: number; banned: number; admins: number };
  characters: {
    total: number;
    cultivating: number;
    bySect: { sectId: string | null; name: string; count: number }[];
  };
  economy: {
    linhThachCirculating: string;
    tienNgocCirculating: string;
    topupPending: number;
    topupApproved: number;
    topupRejected: number;
  };
  activity: {
    last24hLogins: number;
    last7dRegistrations: number;
  };
}

export async function adminStats(): Promise<AdminStats> {
  const { data } = await apiClient.get<Envelope<AdminStats>>('/admin/stats');
  return unwrap(data);
}

export interface AdminEconomyAlerts {
  negativeCurrency: {
    characterId: string;
    name: string;
    userEmail: string;
    linhThach: string;
    tienNgoc: number;
    tienNgocKhoa: number;
  }[];
  negativeInventory: {
    inventoryItemId: string;
    characterId: string;
    characterName: string;
    itemKey: string;
    qty: number;
  }[];
  stalePendingTopups: {
    id: string;
    userEmail: string;
    packageKey: string;
    tienNgocAmount: number;
    createdAt: string;
    ageHours: number;
  }[];
  staleHours: number;
  generatedAt: string;
  /**
   * Bounds áp dụng cho `staleHours` query param (do BE resolve từ env).
   * Optional — BE pre-PR #167 không trả field này, FE vẫn work.
   */
  bounds?: {
    defaultHours: number;
    minHours: number;
    maxHours: number;
  };
}

export async function adminEconomyAlerts(staleHours = 24): Promise<AdminEconomyAlerts> {
  const { data } = await apiClient.get<Envelope<AdminEconomyAlerts>>('/admin/economy/alerts', {
    params: { staleHours },
  });
  return unwrap(data);
}

/**
 * Smart economy safety: kết quả từ `GET /admin/economy/audit-ledger`.
 *
 * Verify SUM(CurrencyLedger.delta) khớp Character.linhThach/tienNgoc và
 * SUM(ItemLedger.qtyDelta) khớp InventoryItem.qty per (char, item). bigint
 * được serialize sang string từ BE để tránh overflow Number.
 */
export interface AdminLedgerAuditCharDiscrepancy {
  characterId: string;
  field: 'linhThach' | 'tienNgoc';
  ledgerSum: string;
  characterValue: string;
  diff: string;
}

export interface AdminLedgerAuditInvDiscrepancy {
  characterId: string;
  itemKey: string;
  ledgerSum: number;
  inventorySum: number;
  diff: number;
}

export interface AdminLedgerAudit {
  charactersScanned: number;
  itemKeysScanned: number;
  currencyDiscrepancies: AdminLedgerAuditCharDiscrepancy[];
  inventoryDiscrepancies: AdminLedgerAuditInvDiscrepancy[];
}

export async function adminAuditLedger(): Promise<AdminLedgerAudit> {
  const { data } = await apiClient.get<Envelope<AdminLedgerAudit>>('/admin/economy/audit-ledger');
  return unwrap(data);
}

/**
 * Smart economy report: kết quả từ `GET /admin/economy/report`.
 *
 * Top 10 character theo linhThach + tienNgoc + tổng circulation. Read-only.
 * `linhThachTotal` + per-row `linhThach` là bigint string để tránh overflow.
 */
export interface AdminEconomyReportTopRowLinh {
  characterId: string;
  name: string;
  realmKey: string;
  realmStage: number;
  userEmail: string;
  linhThach: string;
}

export interface AdminEconomyReportTopRowTien {
  characterId: string;
  name: string;
  realmKey: string;
  realmStage: number;
  userEmail: string;
  tienNgoc: number;
}

export interface AdminEconomyReport {
  generatedAt: string;
  circulation: {
    linhThachTotal: string;
    tienNgocTotal: number;
    tienNgocKhoaTotal: number;
    characterCount: number;
    cultivatingCount: number;
  };
  topByLinhThach: AdminEconomyReportTopRowLinh[];
  topByTienNgoc: AdminEconomyReportTopRowTien[];
}

export async function adminEconomyReport(): Promise<AdminEconomyReport> {
  const { data } = await apiClient.get<Envelope<AdminEconomyReport>>('/admin/economy/report');
  return unwrap(data);
}

export interface AdminBossSpawnInput {
  bossKey?: string;
  level?: number;
  force?: boolean;
  /**
   * Phase 12.6 — explicit region (default 'world' cho legacy world boss).
   * Nếu cùng `bossKey`, def.regionKey phải match (catalog null → 'world').
   */
  regionKey?: string;
  /**
   * Phase 13.1.C — optional admin intent ghi vào audit
   * `ADMIN_FORCE_BOSS_SCHEDULE`. Cap 200 ký tự (BE validate).
   */
  reason?: string;
}

export interface AdminBossSpawnResult {
  id: string;
  bossKey: string;
  level: number;
  maxHp: string;
  /** Phase 12.6 — region của spawned boss (echo từ BE). */
  regionKey: string;
}

export async function adminSpawnBoss(
  input: AdminBossSpawnInput,
): Promise<AdminBossSpawnResult> {
  const { data } = await apiClient.post<Envelope<AdminBossSpawnResult>>(
    '/boss/admin/spawn',
    input,
  );
  return unwrap(data);
}

export type GiftCodeStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'EXHAUSTED';

export interface AdminGiftCodeRewardItem {
  itemKey: string;
  qty: number;
}

export interface AdminGiftCodeRow {
  id: string;
  code: string;
  rewardLinhThach: string;
  rewardTienNgoc: number;
  rewardExp: string;
  rewardItems: AdminGiftCodeRewardItem[];
  maxRedeems: number | null;
  redeemCount: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface AdminGiftCreateInput {
  code: string;
  rewardLinhThach?: string;
  rewardTienNgoc?: number;
  rewardExp?: string;
  rewardItems?: AdminGiftCodeRewardItem[];
  maxRedeems?: number;
  expiresAt?: string;
}

export async function adminListGiftcodes(
  filters: { q?: string; status?: GiftCodeStatus | '' } = {},
  limit = 100,
): Promise<AdminGiftCodeRow[]> {
  const params: Record<string, string | number> = { limit };
  if (filters.q) params.q = filters.q;
  if (filters.status) params.status = filters.status;
  const { data } = await apiClient.get<Envelope<{ codes: AdminGiftCodeRow[] }>>(
    '/admin/giftcodes',
    { params },
  );
  return unwrap(data).codes;
}

export async function adminCreateGiftcode(
  input: AdminGiftCreateInput,
): Promise<AdminGiftCodeRow> {
  const { data } = await apiClient.post<Envelope<{ code: AdminGiftCodeRow }>>(
    '/admin/giftcodes',
    input,
  );
  return unwrap(data).code;
}

export async function adminRevokeGiftcode(code: string): Promise<AdminGiftCodeRow> {
  const { data } = await apiClient.post<Envelope<{ code: AdminGiftCodeRow }>>(
    `/admin/giftcodes/${encodeURIComponent(code)}/revoke`,
    {},
  );
  return unwrap(data).code;
}

// ───────── Phase 13.1.B — Admin LiveOps Controls ─────────

export interface AdminLiveOpsOverrideView {
  key: string;
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  reason: string | null;
  updatedBy: string;
  updatedAt: string;
  createdAt: string;
}

export interface AdminLiveOpsEventStatusView {
  key: string;
  type: 'DAILY' | 'WEEKLY' | 'WINDOW';
  catalogEnabled: boolean;
  effectiveEnabled: boolean;
  override: AdminLiveOpsOverrideView | null;
  titleI18nKey: string;
  descriptionI18nKey: string;
  dailyTime?: string;
  durationMinutes?: number;
  daysOfWeek?: ReadonlyArray<number>;
  regionKey?: string;
  bossKey?: string;
  startTime?: string;
  endTime?: string;
}

export interface AdminLiveOpsStatusView {
  tz: string;
  events: ReadonlyArray<AdminLiveOpsEventStatusView>;
  todayKeys: ReadonlyArray<string>;
  activeKeys: ReadonlyArray<string>;
}

export interface AdminLiveOpsToggleInput {
  key: string;
  enabled: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  reason?: string | null;
}

export interface AdminSectWarStatusView {
  weekKey: string;
  totalSects: number;
  totalContributors: number;
  totalContributions: number;
  topSects: ReadonlyArray<{
    sectId: string;
    sectName: string;
    points: number;
    contributors: number;
  }>;
}

export async function adminLiveOpsStatus(): Promise<AdminLiveOpsStatusView> {
  const { data } = await apiClient.get<Envelope<AdminLiveOpsStatusView>>(
    '/admin/liveops',
  );
  return unwrap(data);
}

export async function adminLiveOpsToggle(
  input: AdminLiveOpsToggleInput,
): Promise<AdminLiveOpsOverrideView> {
  const { data } = await apiClient.post<Envelope<AdminLiveOpsOverrideView>>(
    '/admin/liveops/event/toggle',
    input,
  );
  return unwrap(data);
}

export async function adminSectWarStatus(
  weekKey?: string,
): Promise<AdminSectWarStatusView> {
  const url = weekKey
    ? `/admin/sect-war/status?weekKey=${encodeURIComponent(weekKey)}`
    : '/admin/sect-war/status';
  const { data } = await apiClient.get<Envelope<AdminSectWarStatusView>>(url);
  return unwrap(data);
}

export async function adminSectWarRecalculate(input: {
  weekKey?: string;
  reason?: string;
}): Promise<{ noop: true; weekKey: string }> {
  const { data } = await apiClient.post<
    Envelope<{ noop: true; weekKey: string }>
  >('/admin/sect-war/recalculate', input);
  return unwrap(data);
}

/**
 * Phase 13.1.C — POST /admin/sect-war/snapshot. Read-after-audit snapshot:
 * trả nguyên bản `getSectWarStatus(weekKey)` + ghi audit `ADMIN_SECT_WAR_STATUS`
 * (compliance / handoff paper trail). KHÔNG mutate dữ liệu sect war.
 */
export async function adminSectWarSnapshot(input: {
  weekKey?: string;
  reason?: string;
}): Promise<AdminSectWarStatusView> {
  const { data } = await apiClient.post<Envelope<AdminSectWarStatusView>>(
    '/admin/sect-war/snapshot',
    input,
  );
  return unwrap(data);
}

// ───────── Phase 13.1.D — Admin LiveOps Schedule Preview & Dry-run ─────────

export type AdminLiveOpsEventTypeView =
  | 'DAILY'
  | 'WEEKLY'
  | 'LIMITED'
  | 'BOSS'
  | 'STORY';

export interface AdminLiveOpsActiveEventView {
  key: string;
  type: AdminLiveOpsEventTypeView;
  titleI18nKey: string;
  descriptionI18nKey: string;
  slotStartIso: string;
  slotEndIso: string;
  regionKey?: string;
  bossKey?: string;
  rewardHintI18nKey?: string;
}

export interface AdminLiveOpsUpcomingEventView {
  key: string;
  type: AdminLiveOpsEventTypeView;
  titleI18nKey: string;
  descriptionI18nKey: string;
  catalogEnabled: boolean;
  effectiveEnabled: boolean;
  slotStartIso: string;
  slotEndIso: string;
  regionKey?: string;
  bossKey?: string;
  rewardHintI18nKey?: string;
}

export interface AdminLiveOpsBossScheduleSlotView {
  key: string;
  bossKey: string;
  regionKey: string;
  slotStartIso: string;
  slotEndIso: string;
  status: 'upcoming' | 'active' | 'completed';
  rewardHintI18nKey?: string;
  catalogEnabled: boolean;
  effectiveEnabled: boolean;
  localDate: string;
}

export interface AdminLiveOpsSectWarSeasonView {
  weekKey: string;
  startsAtIso: string;
  endsAtIso: string;
  timezone: string;
}

export interface AdminLiveOpsSchedulePreviewView {
  nowIso: string;
  tz: string;
  activeEvents: ReadonlyArray<AdminLiveOpsActiveEventView>;
  upcomingEvents: ReadonlyArray<AdminLiveOpsUpcomingEventView>;
  bossScheduleToday: ReadonlyArray<AdminLiveOpsBossScheduleSlotView>;
  bossScheduleWeek: ReadonlyArray<AdminLiveOpsBossScheduleSlotView>;
  sectWar: {
    season: AdminLiveOpsSectWarSeasonView;
    status: AdminSectWarStatusView;
  };
  overrides: ReadonlyArray<AdminLiveOpsOverrideView>;
}

export type AdminLiveOpsDryRunKind = 'event' | 'boss';

export interface AdminLiveOpsDryRunInput {
  kind: AdminLiveOpsDryRunKind;
  key: string;
  regionKey?: string;
  level?: number;
  reason?: string;
}

export interface AdminLiveOpsDryRunEventResult {
  kind: 'event';
  key: string;
  type: AdminLiveOpsEventTypeView;
  titleI18nKey: string;
  descriptionI18nKey: string;
  catalogEnabled: boolean;
  effectiveEnabled: boolean;
  override: AdminLiveOpsOverrideView | null;
  nextSlotStartIso: string | null;
  nextSlotEndIso: string | null;
  regionKey?: string;
  bossKey?: string;
  rewardHintI18nKey?: string;
  simulated: true;
  reason: string | null;
  simulatedAt: string;
}

export interface AdminLiveOpsDryRunBossResult {
  kind: 'boss';
  bossKey: string;
  bossName: string;
  regionKey: string;
  level: number;
  simulatedMaxHp: string;
  simulatedReward: {
    baseLinhThach: number;
    topDropPool: ReadonlyArray<string>;
    midDropPool: ReadonlyArray<string>;
    lowDropPool: ReadonlyArray<string>;
  };
  recommendedRealm: string;
  simulated: true;
  reason: string | null;
  simulatedAt: string;
}

export type AdminLiveOpsDryRunResult =
  | AdminLiveOpsDryRunEventResult
  | AdminLiveOpsDryRunBossResult;

export async function adminLiveOpsSchedulePreview(): Promise<AdminLiveOpsSchedulePreviewView> {
  const { data } = await apiClient.get<Envelope<AdminLiveOpsSchedulePreviewView>>(
    '/admin/liveops/schedule-preview',
  );
  return unwrap(data);
}

export async function adminLiveOpsDryRun(
  input: AdminLiveOpsDryRunInput,
): Promise<AdminLiveOpsDryRunResult> {
  const { data } = await apiClient.post<Envelope<AdminLiveOpsDryRunResult>>(
    '/admin/liveops/dry-run',
    input,
  );
  return unwrap(data);
}

// ───────── Phase 13.2.D + 14.0.F — Admin LiveOps Cron Force-Run ─────────

export interface AdminLiveOpsCronTerritorySummary {
  periodKey: string;
  territorySettled: number;
  territorySkipped: number;
  territoryDecaySkipped: boolean;
  territoryDecayDelta: number;
  rewardMailsCreated: number;
  rewardSkippedAlreadyGranted: number;
  errors: Array<{ stage: string; message: string }>;
}

export interface AdminLiveOpsCronSectSeasonSummary {
  seasonSnapshotsCreated: number;
  seasonSnapshotsSkipped: number;
  seasonsProcessed: string[];
  /** Phase 15.7 — Champion (per-member của sect rank-1) mail mới tạo. */
  championMailsCreated: number;
  /** Phase 15.7 — Champion grant đã tồn tại (idempotent skip). */
  championAlreadyGranted: number;
  /** Phase 15.7 — MVP (top-1 cá nhân) mail mới tạo. */
  mvpMailsCreated: number;
  /** Phase 15.7 — MVP grant đã tồn tại (idempotent skip). */
  mvpAlreadyGranted: number;
  errors: Array<{ stage: string; seasonKey?: string; message: string }>;
}

export interface AdminLiveOpsCronWeeklyCycleSummary {
  startedAt: string;
  finishedAt: string;
  skippedAlreadyDone: boolean;
  triggeredBy: string | null;
  territory: AdminLiveOpsCronTerritorySummary;
  sectSeason: AdminLiveOpsCronSectSeasonSummary;
}

export interface AdminLiveOpsCronRunInput {
  periodKey?: string;
  bypassLease?: boolean;
}

/**
 * Phase 13.2.D + 14.0.F — POST /admin/liveops/run-weekly-cycle.
 *
 * Force-run weekly cycle (territory settle + decay + reward mail + sect
 * season snapshot). ADMIN-only. Idempotent: gọi 2 lần KHÔNG double mail
 * (DB UNIQUE guard). `bypassLease=true` skip Redis lease — chỉ dùng cho
 * admin force-run. Server tự xác định `triggeredBy` từ session cookie.
 */
export async function adminLiveOpsRunWeeklyCycle(
  input: AdminLiveOpsCronRunInput = {},
): Promise<AdminLiveOpsCronWeeklyCycleSummary> {
  const { data } = await apiClient.post<Envelope<AdminLiveOpsCronWeeklyCycleSummary>>(
    '/admin/liveops/run-weekly-cycle',
    input,
  );
  return unwrap(data);
}

/**
 * POST /admin/territory/cron/run-now — chỉ chạy phần territory.
 */
export async function adminTerritoryCronRunNow(
  input: AdminLiveOpsCronRunInput = {},
): Promise<AdminLiveOpsCronTerritorySummary> {
  const { data } = await apiClient.post<Envelope<AdminLiveOpsCronTerritorySummary>>(
    '/admin/territory/cron/run-now',
    input,
  );
  return unwrap(data);
}

/**
 * POST /admin/sect-season/cron/run-now — chỉ chạy phần sect season.
 */
export async function adminSectSeasonCronRunNow(
  input: { bypassLease?: boolean } = {},
): Promise<AdminLiveOpsCronSectSeasonSummary> {
  const { data } = await apiClient.post<Envelope<AdminLiveOpsCronSectSeasonSummary>>(
    '/admin/sect-season/cron/run-now',
    input,
  );
  return unwrap(data);
}

/**
 * Phase 15.8 — Cron health status enum (mirror shared
 * `computeLiveOpsCronHealth` return). FE uses this for badge color.
 */
export type AdminLiveOpsCronHealthStatus =
  | 'OK'
  | 'STALE'
  | 'DEGRADED'
  | 'DISABLED';

/**
 * Phase 15.8 — Cron health snapshot returned alongside config + last row.
 */
export interface AdminLiveOpsCronHealthView {
  status: AdminLiveOpsCronHealthStatus;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  staleReason: string | null;
  nextExpectedRunAt: string | null;
}

/**
 * Phase 15.7 — GET /admin/territory/cron/status. Read-only view.
 * Phase 15.8 — adds `health` snapshot.
 */
export interface AdminTerritoryCronStatusView {
  enabled: boolean;
  cron: string;
  timezone: string;
  previousPeriodKey: string;
  lastSettlement: { periodKey: string; settledAt: string } | null;
  lastDecay: { periodKey: string; appliedAt: string } | null;
  lastReward: { periodKey: string; grantedAt: string } | null;
  health: AdminLiveOpsCronHealthView;
}

export async function adminTerritoryCronStatus(): Promise<AdminTerritoryCronStatusView> {
  const { data } = await apiClient.get<Envelope<AdminTerritoryCronStatusView>>(
    '/admin/territory/cron/status',
  );
  return unwrap(data);
}

/**
 * Phase 15.7 — GET /admin/sect-season/cron/status. Read-only view.
 * Phase 15.8 — adds `health` snapshot.
 */
export interface AdminSectSeasonCronStatusView {
  enabled: boolean;
  cron: string;
  timezone: string;
  lastSnapshot: { seasonKey: string; finalizedAt: string } | null;
  lastChampionGrant: { seasonKey: string; grantedAt: string } | null;
  lastMvpGrant: { seasonKey: string; grantedAt: string } | null;
  health: AdminLiveOpsCronHealthView;
}

export async function adminSectSeasonCronStatus(): Promise<AdminSectSeasonCronStatusView> {
  const { data } = await apiClient.get<Envelope<AdminSectSeasonCronStatusView>>(
    '/admin/sect-season/cron/status',
  );
  return unwrap(data);
}

/**
 * Compute display status từ row fields. Mirror BE logic — `revokedAt` thắng,
 * sau đó `expiresAt < now` → EXPIRED, sau đó `redeemCount >= maxRedeems` → EXHAUSTED,
 * còn lại ACTIVE.
 */
export function giftCodeStatusOf(row: AdminGiftCodeRow, now = new Date()): GiftCodeStatus {
  if (row.revokedAt) return 'REVOKED';
  if (row.expiresAt && new Date(row.expiresAt).getTime() < now.getTime()) return 'EXPIRED';
  if (row.maxRedeems !== null && row.redeemCount >= row.maxRedeems) return 'EXHAUSTED';
  return 'ACTIVE';
}

// ---------- Phase 16.6 — Admin Economy Safety ----------

export type EconomyAnomalySeverity = 'INFO' | 'WARN' | 'CRITICAL';
export type EconomyIssueStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type EconomyAnomalySource =
  | 'CURRENCY_DELTA_24H'
  | 'RARE_ITEM_GAIN_24H'
  | 'REWARD_CAP_BYPASS'
  | 'ADMIN_GRANT_OVER_LIMIT'
  | 'MARKET_OUTLIER';

export interface EconomyLedgerCheckRunRow {
  id: string;
  dayBucket: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  summaryJson: unknown;
  triggeredBy: string | null;
}

export interface EconomyLedgerCheckIssueRow {
  id: string;
  runId: string;
  severity: EconomyAnomalySeverity;
  type: string;
  characterId: string | null;
  detailsJson: unknown;
  status: EconomyIssueStatus;
  createdAt: string;
  updatedAt: string;
}

export interface EconomyAnomalyRow {
  id: string;
  severity: EconomyAnomalySeverity;
  source: EconomyAnomalySource;
  characterId: string | null;
  userId: string | null;
  detailsJson: unknown;
  status: EconomyIssueStatus;
  windowKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerCheckRunSummary {
  runId: string;
  dayBucket: string;
  status: string;
  charactersScanned: number;
  itemKeysScanned: number;
  currencyDiscrepancies: number;
  inventoryDiscrepancies: number;
  rewardCapInconsistencies: number;
  negativeBalances: number;
  suspiciousDeltas: number;
  issuesCreated: number;
  alreadyDone: boolean;
}

export interface AnomalyScanSummary {
  windowKey: string;
  topCurrencyDelta: number;
  rareItemGain: number;
  rewardCapBypass: number;
  marketOutlier: number;
  totalAnomaliesCreated: number;
  totalAnomaliesSkipped: number;
}

export async function adminLedgerCheckRun(
  forceRerun = false,
): Promise<LedgerCheckRunSummary> {
  const { data } = await apiClient.post<Envelope<LedgerCheckRunSummary>>(
    '/admin/economy/ledger-check/run',
    { forceRerun },
  );
  return unwrap(data);
}

export async function adminLedgerCheckLatest(): Promise<{
  run: EconomyLedgerCheckRunRow | null;
  openIssues: number;
}> {
  const { data } = await apiClient.get<
    Envelope<{ run: EconomyLedgerCheckRunRow | null; openIssues: number }>
  >('/admin/economy/ledger-check/latest');
  return unwrap(data);
}

export async function adminLedgerCheckIssues(filters: {
  severity?: EconomyAnomalySeverity;
  status?: EconomyIssueStatus;
  type?: string;
  runId?: string;
  limit?: number;
} = {}): Promise<{ items: EconomyLedgerCheckIssueRow[]; total: number }> {
  const params: Record<string, string | number> = {};
  if (filters.severity) params.severity = filters.severity;
  if (filters.status) params.status = filters.status;
  if (filters.type) params.type = filters.type;
  if (filters.runId) params.runId = filters.runId;
  if (filters.limit) params.limit = filters.limit;
  const { data } = await apiClient.get<
    Envelope<{ items: EconomyLedgerCheckIssueRow[]; total: number }>
  >('/admin/economy/ledger-check/issues', { params });
  return unwrap(data);
}

export async function adminLedgerCheckIssueAck(id: string): Promise<void> {
  await apiClient.post(`/admin/economy/ledger-check/issues/${id}/ack`, {});
}

export async function adminLedgerCheckIssueResolve(id: string): Promise<void> {
  await apiClient.post(`/admin/economy/ledger-check/issues/${id}/resolve`, {});
}

/**
 * Phase 16.1.B — `GET /admin/economy/range-report?from=YYYY-MM-DD&to=YYYY-MM-DD`.
 *
 * Date-range economy report. Max 31 ngày, default last 7d (server enforced).
 * Trả về breakdown theo source, top 10 character delta, market volume,
 * shop spend, reward totals, anomaly summary, latest ledger check run.
 */
export async function adminEconomyRangeReport(
  from?: string,
  to?: string,
): Promise<EconomyReportResponse> {
  const params: Record<string, string> = {};
  if (from) params.from = from;
  if (to) params.to = to;
  const { data } = await apiClient.get<Envelope<EconomyReportResponse>>(
    '/admin/economy/range-report',
    Object.keys(params).length > 0 ? { params } : undefined,
  );
  return unwrap(data);
}

export async function adminAnomalyScanRun(): Promise<AnomalyScanSummary> {
  const { data } = await apiClient.post<Envelope<AnomalyScanSummary>>(
    '/admin/economy/anomalies/scan',
    {},
  );
  return unwrap(data);
}

export async function adminListAnomalies(filters: {
  severity?: EconomyAnomalySeverity;
  status?: EconomyIssueStatus;
  source?: EconomyAnomalySource;
  limit?: number;
} = {}): Promise<{ items: EconomyAnomalyRow[]; total: number }> {
  const params: Record<string, string | number> = {};
  if (filters.severity) params.severity = filters.severity;
  if (filters.status) params.status = filters.status;
  if (filters.source) params.source = filters.source;
  if (filters.limit) params.limit = filters.limit;
  const { data } = await apiClient.get<
    Envelope<{ items: EconomyAnomalyRow[]; total: number }>
  >('/admin/economy/anomalies', { params });
  return unwrap(data);
}

export async function adminAnomalyAck(id: string): Promise<void> {
  await apiClient.post(`/admin/economy/anomalies/${id}/ack`, {});
}

export async function adminAnomalyResolve(id: string): Promise<void> {
  await apiClient.post(`/admin/economy/anomalies/${id}/resolve`, {});
}

/* ---------------------------------------------------------------------------
 * Phase 14.1.D — Arena Anti-Wintrade Detection (admin endpoints)
 * ------------------------------------------------------------------------- */

export type ArenaWintradeSeverity = 'INFO' | 'WARN' | 'CRITICAL';
export type ArenaWintradeStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type ArenaWintradeType =
  | 'REPEATED_OPPONENT_PAIR'
  | 'RECIPROCAL_WIN_LOSS'
  | 'RATING_GAIN_SPIKE'
  | 'REWARD_FARM_PATTERN'
  | 'SEASON_SUSPICIOUS_ACTOR';

export interface ArenaWintradeAlertRow {
  id: string;
  seasonId: string | null;
  attackerCharacterId: string | null;
  defenderCharacterId: string | null;
  relatedCharacterIds: string[];
  severity: ArenaWintradeSeverity;
  type: ArenaWintradeType;
  status: ArenaWintradeStatus;
  windowKey: string;
  details: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface ArenaWintradeScanSummary {
  scannedMatches: number;
  alertsCreated: number;
  alertsSkippedDuplicate: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

export async function adminArenaWintradeScan(): Promise<ArenaWintradeScanSummary> {
  const { data } = await apiClient.post<Envelope<ArenaWintradeScanSummary>>(
    '/admin/arena/anti-wintrade/scan',
    {},
  );
  return unwrap(data);
}

export async function adminArenaWintradeListAlerts(
  filters: {
    severity?: ArenaWintradeSeverity;
    status?: ArenaWintradeStatus;
    type?: ArenaWintradeType;
    seasonId?: string;
    limit?: number;
  } = {},
): Promise<{ items: ArenaWintradeAlertRow[]; total: number }> {
  const params: Record<string, string | number> = {};
  if (filters.severity) params.severity = filters.severity;
  if (filters.status) params.status = filters.status;
  if (filters.type) params.type = filters.type;
  if (filters.seasonId) params.seasonId = filters.seasonId;
  if (filters.limit) params.limit = filters.limit;
  const { data } = await apiClient.get<
    Envelope<{ items: ArenaWintradeAlertRow[]; total: number }>
  >('/admin/arena/anti-wintrade/alerts', { params });
  return unwrap(data);
}

export async function adminArenaWintradeAck(id: string): Promise<void> {
  await apiClient.post(`/admin/arena/anti-wintrade/alerts/${id}/ack`, {});
}

export async function adminArenaWintradeResolve(id: string): Promise<void> {
  await apiClient.post(`/admin/arena/anti-wintrade/alerts/${id}/resolve`, {});
}

// ---------- Phase 15.1–15.2 — Admin LiveOps Event Scheduler Core ----------

export type LiveOpsScheduledEventType =
  | 'DOUBLE_DUNGEON_DROP'
  | 'CULTIVATION_EXP_BOOST'
  | 'SHOP_DISCOUNT'
  | 'SECT_SHOP_DISCOUNT'
  | 'DAILY_LOGIN_BONUS'
  | 'BOSS_REWARD_BOOST'
  | 'FESTIVAL_GIFT';

export type LiveOpsScheduledEventStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'ENDED'
  | 'DISABLED';

export interface LiveOpsScheduledEventView {
  id: string;
  key: string;
  type: LiveOpsScheduledEventType;
  title: string;
  description: string;
  status: LiveOpsScheduledEventStatus;
  startsAt: string;
  endsAt: string;
  configJson: Record<string, unknown>;
  createdByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LiveOpsRecomputeSummaryView {
  scannedAt: string;
  toActivated: number;
  toEnded: number;
}

export interface AdminLiveOpsEventCreateInput {
  key: string;
  type: LiveOpsScheduledEventType;
  title: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  configJson?: { multiplier?: number; rewardJson?: Record<string, unknown> };
  initialStatus?: 'DRAFT' | 'SCHEDULED';
}

export interface AdminLiveOpsEventUpdateInput {
  title?: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  configJson?: { multiplier?: number; rewardJson?: Record<string, unknown> };
  status?: LiveOpsScheduledEventStatus;
}

export async function adminLiveOpsEventsList(): Promise<LiveOpsScheduledEventView[]> {
  const { data } = await apiClient.get<
    Envelope<{ events: LiveOpsScheduledEventView[] }>
  >('/admin/liveops/events');
  return unwrap(data).events;
}

export async function adminLiveOpsEventsCreate(
  input: AdminLiveOpsEventCreateInput,
): Promise<LiveOpsScheduledEventView> {
  const { data } = await apiClient.post<Envelope<LiveOpsScheduledEventView>>(
    '/admin/liveops/events',
    input,
  );
  return unwrap(data);
}

export async function adminLiveOpsEventsUpdate(
  id: string,
  input: AdminLiveOpsEventUpdateInput,
): Promise<LiveOpsScheduledEventView> {
  const { data } = await apiClient.patch<Envelope<LiveOpsScheduledEventView>>(
    `/admin/liveops/events/${id}`,
    input,
  );
  return unwrap(data);
}

export async function adminLiveOpsEventsDisable(
  id: string,
): Promise<LiveOpsScheduledEventView> {
  const { data } = await apiClient.post<Envelope<LiveOpsScheduledEventView>>(
    `/admin/liveops/events/${id}/disable`,
    {},
  );
  return unwrap(data);
}

export async function adminLiveOpsEventsRecomputeStatus(): Promise<LiveOpsRecomputeSummaryView> {
  const { data } = await apiClient.post<Envelope<LiveOpsRecomputeSummaryView>>(
    '/admin/liveops/events/recompute-status',
    {},
  );
  return unwrap(data);
}

// ---------------------------------------------------------------------------
// Phase 15.3.B — LiveOps Announcement admin endpoints
// ---------------------------------------------------------------------------

export interface AdminLiveOpsAnnouncementView {
  id: string;
  key: string;
  severity: LiveOpsAnnouncementSeverity;
  status: LiveOpsAnnouncementStatus;
  target: LiveOpsAnnouncementTarget;
  titleVi: string;
  titleEn: string | null;
  messageVi: string;
  messageEn: string | null;
  startsAt: string;
  endsAt: string;
  createdByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
}

export interface AdminLiveOpsAnnouncementCreateInput {
  key: string;
  severity: LiveOpsAnnouncementSeverity;
  target: LiveOpsAnnouncementTarget;
  titleVi: string;
  titleEn?: string | null;
  messageVi: string;
  messageEn?: string | null;
  startsAt: string;
  endsAt: string;
  initialStatus?: 'DRAFT' | 'SCHEDULED';
}

export interface AdminLiveOpsAnnouncementUpdateInput {
  severity?: LiveOpsAnnouncementSeverity;
  target?: LiveOpsAnnouncementTarget;
  titleVi?: string;
  titleEn?: string | null;
  messageVi?: string;
  messageEn?: string | null;
  startsAt?: string;
  endsAt?: string;
  status?: 'DRAFT' | 'SCHEDULED';
}

export interface AdminLiveOpsAnnouncementRecomputeView {
  scannedAt: string;
  activated: ReadonlyArray<{ key: string }>;
  ended: ReadonlyArray<{ key: string }>;
}

export async function adminLiveOpsAnnouncementsList(): Promise<
  AdminLiveOpsAnnouncementView[]
> {
  const { data } = await apiClient.get<
    Envelope<{ announcements: AdminLiveOpsAnnouncementView[] }>
  >('/admin/liveops/announcements');
  return unwrap(data).announcements;
}

export async function adminLiveOpsAnnouncementsCreate(
  input: AdminLiveOpsAnnouncementCreateInput,
): Promise<AdminLiveOpsAnnouncementView> {
  const { data } = await apiClient.post<Envelope<AdminLiveOpsAnnouncementView>>(
    '/admin/liveops/announcements',
    input,
  );
  return unwrap(data);
}

export async function adminLiveOpsAnnouncementsUpdate(
  id: string,
  input: AdminLiveOpsAnnouncementUpdateInput,
): Promise<AdminLiveOpsAnnouncementView> {
  const { data } = await apiClient.patch<Envelope<AdminLiveOpsAnnouncementView>>(
    `/admin/liveops/announcements/${id}`,
    input,
  );
  return unwrap(data);
}

export async function adminLiveOpsAnnouncementsDisable(
  id: string,
): Promise<AdminLiveOpsAnnouncementView> {
  const { data } = await apiClient.post<Envelope<AdminLiveOpsAnnouncementView>>(
    `/admin/liveops/announcements/${id}/disable`,
    {},
  );
  return unwrap(data);
}

export async function adminLiveOpsAnnouncementsRecompute(): Promise<AdminLiveOpsAnnouncementRecomputeView> {
  const { data } = await apiClient.post<
    Envelope<AdminLiveOpsAnnouncementRecomputeView>
  >('/admin/liveops/announcements/recompute-status', {});
  return unwrap(data);
}

/* ---------------------------------------------------------------------------
 * Phase 16.3 — Gameplay Anti-cheat Deep Detection (admin endpoints)
 * ------------------------------------------------------------------------- */

export type GameplayAnomalyType =
  | 'EXP_GAIN_SPIKE'
  | 'CURRENCY_GAIN_SPIKE'
  | 'ITEM_GAIN_SPIKE'
  | 'DUNGEON_REWARD_FARM'
  | 'BOSS_REWARD_FARM'
  | 'MISSION_REWARD_FARM'
  | 'ARENA_REWARD_FARM'
  | 'TERRITORY_REWARD_SPIKE'
  | 'COMBAT_RESULT_MISMATCH'
  | 'REWARD_CAP_BYPASS_ATTEMPT';
export type GameplayAnomalySeverity = 'INFO' | 'WARN' | 'CRITICAL';
export type GameplayAnomalyStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type GameplayAnomalySource =
  | 'DUNGEON_RUN'
  | 'BOSS'
  | 'MISSION'
  | 'ARENA'
  | 'TERRITORY'
  | 'CURRENCY_LEDGER'
  | 'ITEM_LEDGER'
  | 'COMBAT_SNAPSHOT'
  | 'REWARD_CAP'
  | 'CULTIVATION'
  | 'OTHER';

export interface GameplayAnomalyRow {
  id: string;
  type: GameplayAnomalyType;
  severity: GameplayAnomalySeverity;
  status: GameplayAnomalyStatus;
  source: GameplayAnomalySource;
  characterId: string | null;
  userId: string | null;
  windowKey: string;
  detailsJson: unknown;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt: string | null;
  acknowledgedByAdminId: string | null;
  resolvedAt: string | null;
  resolvedByAdminId: string | null;
  resolutionNote: string | null;
}

export interface GameplayAnomalySummary {
  openCount: number;
  openCriticalCount: number;
  openWarnCount: number;
  openInfoCount: number;
  totalCount: number;
  latestCreatedAt: string | null;
  latestResolvedAt: string | null;
}

export interface GameplayScanRuleResult {
  type: GameplayAnomalyType;
  created: number;
  skipped: number;
  errored: boolean;
  errorMessage: string | null;
}

export interface GameplayScanSummaryView {
  windowKeysByType: Record<GameplayAnomalyType, string>;
  totalCreated: number;
  totalSkipped: number;
  totalErrored: number;
  rules: GameplayScanRuleResult[];
  scannedAt: string;
}

export async function adminGameplayAntiCheatSummary(): Promise<GameplayAnomalySummary> {
  const { data } = await apiClient.get<Envelope<GameplayAnomalySummary>>(
    '/admin/anticheat/gameplay/summary',
  );
  return unwrap(data);
}

export async function adminGameplayAntiCheatScan(): Promise<GameplayScanSummaryView> {
  const { data } = await apiClient.post<Envelope<GameplayScanSummaryView>>(
    '/admin/anticheat/gameplay/scan',
    {},
  );
  return unwrap(data);
}

export async function adminGameplayAntiCheatList(filters: {
  severity?: GameplayAnomalySeverity;
  status?: GameplayAnomalyStatus;
  type?: GameplayAnomalyType;
  source?: GameplayAnomalySource;
  characterId?: string;
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<{
  items: GameplayAnomalyRow[];
  total: number;
  filters: {
    severities: readonly string[];
    statuses: readonly string[];
    types: readonly string[];
    sources: readonly string[];
  };
}> {
  const params: Record<string, string | number> = {};
  if (filters.severity) params.severity = filters.severity;
  if (filters.status) params.status = filters.status;
  if (filters.type) params.type = filters.type;
  if (filters.source) params.source = filters.source;
  if (filters.characterId) params.characterId = filters.characterId;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.limit) params.limit = filters.limit;
  const { data } = await apiClient.get<
    Envelope<{
      items: GameplayAnomalyRow[];
      total: number;
      filters: {
        severities: readonly string[];
        statuses: readonly string[];
        types: readonly string[];
        sources: readonly string[];
      };
    }>
  >('/admin/anticheat/gameplay/anomalies', { params });
  return unwrap(data);
}

export async function adminGameplayAntiCheatAck(id: string): Promise<void> {
  await apiClient.post(`/admin/anticheat/gameplay/anomalies/${id}/ack`, {});
}

export async function adminGameplayAntiCheatResolve(
  id: string,
  note?: string,
): Promise<void> {
  await apiClient.post(`/admin/anticheat/gameplay/anomalies/${id}/resolve`, {
    note,
  });
}

// -----------------------------------------------------------------------------
// Phase 16.4 — Admin Market Trade Abuse panel API.
// -----------------------------------------------------------------------------

export type MarketAbuseSeverity = 'INFO' | 'WARN' | 'CRITICAL';
export type MarketAbuseStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type MarketAbuseType =
  | 'PRICE_EXTREME_LOW'
  | 'PRICE_EXTREME_HIGH'
  | 'REPEATED_BUYER_SELLER_PAIR'
  | 'LISTING_SPAM'
  | 'MARKET_VOLUME_SPIKE'
  | 'UNKNOWN_REFERENCE_PRICE';
export type MarketAbuseSource =
  | 'LISTING_CREATE'
  | 'LISTING_BUY'
  | 'SCAN_BATCH'
  | 'OTHER';

export interface MarketAbuseRow {
  id: string;
  type: MarketAbuseType;
  severity: MarketAbuseSeverity;
  status: MarketAbuseStatus;
  source: MarketAbuseSource;
  listingId: string;
  sellerCharacterId: string | null;
  buyerCharacterId: string | null;
  itemKey: string | null;
  quantity: number | null;
  unitPrice: string | null;
  referencePrice: string | null;
  deviationRatio: number | null;
  windowKey: string;
  detailsJson: unknown;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt: string | null;
  acknowledgedByAdminId: string | null;
  resolvedAt: string | null;
  resolvedByAdminId: string | null;
  resolutionNote: string | null;
}

export interface MarketAbuseSummary {
  openCount: number;
  openCriticalCount: number;
  openWarnCount: number;
  openInfoCount: number;
  totalCount: number;
  latestCreatedAt: string | null;
  latestResolvedAt: string | null;
}

export interface MarketAbuseScanRuleResult {
  type: MarketAbuseType;
  created: number;
  skipped: number;
  errored: boolean;
  errorMessage: string | null;
}

export interface MarketAbuseScanSummaryView {
  windowKeysByType: Record<MarketAbuseType, string>;
  totalCreated: number;
  totalSkipped: number;
  totalErrored: number;
  rules: MarketAbuseScanRuleResult[];
  scannedAt: string;
}

export async function adminMarketAbuseSummary(): Promise<MarketAbuseSummary> {
  const { data } = await apiClient.get<Envelope<MarketAbuseSummary>>(
    '/admin/market/abuse/summary',
  );
  return unwrap(data);
}

export async function adminMarketAbuseScan(): Promise<MarketAbuseScanSummaryView> {
  const { data } = await apiClient.post<Envelope<MarketAbuseScanSummaryView>>(
    '/admin/market/abuse/scan',
    {},
  );
  return unwrap(data);
}

export async function adminMarketAbuseList(filters: {
  severity?: MarketAbuseSeverity;
  status?: MarketAbuseStatus;
  type?: MarketAbuseType;
  source?: MarketAbuseSource;
  sellerCharacterId?: string;
  buyerCharacterId?: string;
  itemKey?: string;
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<{
  items: MarketAbuseRow[];
  total: number;
  filters: {
    severities: readonly string[];
    statuses: readonly string[];
    types: readonly string[];
    sources: readonly string[];
  };
}> {
  const params: Record<string, string | number> = {};
  if (filters.severity) params.severity = filters.severity;
  if (filters.status) params.status = filters.status;
  if (filters.type) params.type = filters.type;
  if (filters.source) params.source = filters.source;
  if (filters.sellerCharacterId) {
    params.sellerCharacterId = filters.sellerCharacterId;
  }
  if (filters.buyerCharacterId) {
    params.buyerCharacterId = filters.buyerCharacterId;
  }
  if (filters.itemKey) params.itemKey = filters.itemKey;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.limit) params.limit = filters.limit;
  const { data } = await apiClient.get<
    Envelope<{
      items: MarketAbuseRow[];
      total: number;
      filters: {
        severities: readonly string[];
        statuses: readonly string[];
        types: readonly string[];
        sources: readonly string[];
      };
    }>
  >('/admin/market/abuse/anomalies', { params });
  return unwrap(data);
}

export async function adminMarketAbuseAck(id: string): Promise<void> {
  await apiClient.post(`/admin/market/abuse/anomalies/${id}/ack`, {});
}

export async function adminMarketAbuseResolve(
  id: string,
  note?: string,
): Promise<void> {
  await apiClient.post(`/admin/market/abuse/anomalies/${id}/resolve`, {
    note,
  });
}
