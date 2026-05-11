/**
 * Phase 15.5 — Maintenance Window service.
 *
 * Provides:
 *   - CRUD + status machine cho `MaintenanceWindow`.
 *   - `recomputeStatuses(now)` — idempotent SCHEDULED→ACTIVE / ACTIVE→ENDED.
 *   - `getActiveWindow(now)` — pick winner row dùng shared selector
 *     (severity > target > endsAt > key). Cache 10s in-memory để
 *     middleware không spam DB mỗi request.
 *   - `isMaintenanceActiveForRequest(user, route, method)` — runtime
 *     gate dùng bởi middleware. Trả về:
 *       - `null` = không bị chặn.
 *       - `MaintenanceBlockResult` = bị chặn + payload public-safe.
 *   - `publicStatus(now)` — `MaintenanceWindowPublicView` cho
 *     `GET /maintenance/status`.
 *
 * Cache:
 *   - `getActiveWindow` đọc DB filter `status=ACTIVE` + window window
 *     valid + sort. Cache TTL 10s in-memory (per pod) — admin disable
 *     có hiệu lực sau ≤ 10s. Không cần Redis L2: middleware gọi tần suất
 *     cao nhưng cache 10s đã đủ giảm DB load và giữ window broadcast
 *     gần real-time.
 *   - Service có hook `invalidateCache()` được gọi sau create/update/disable.
 *
 * Bypass rules (xem `isMaintenanceActiveForRequest`):
 *   - `allowHealthcheck && route ∈ HEALTH_BYPASS_ROUTES` → KHÔNG chặn.
 *   - `allowMetrics && route bắt đầu /admin/metrics` → KHÔNG chặn.
 *   - `route === /maintenance/status` → KHÔNG chặn (FE poll status).
 *   - `route === /_auth/*` → KHÔNG chặn nếu `target !== FULL_LOCKDOWN`
 *     (admin cần login lại để bypass; trong FULL_LOCKDOWN mọi route bị
 *     chặn kể cả login).
 *   - `target === FULL_LOCKDOWN` → mọi user (kể cả admin) bị chặn (trừ
 *     healthcheck/metrics nếu allow flags=true).
 *   - `target === API_WRITE_ONLY` → chỉ chặn nếu method ∈
 *     {POST/PUT/PATCH/DELETE}; GET pass.
 *   - `target === NON_ADMIN_USERS` → chặn PLAYER + MOD; ADMIN bypass
 *     bất kể `allowAdminBypass`.
 *   - `target === ALL_PLAYERS` → chặn mọi user trừ ADMIN/MOD nếu
 *     `allowAdminBypass=true`.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MAINTENANCE_BLOCK_ERROR_CODE,
  buildMaintenanceBroadcastPayload,
  type MaintenanceBlockErrorPayload,
  type MaintenanceBroadcastPayload,
  type MaintenanceSeverity,
  type MaintenanceTarget,
  type MaintenanceValidationCode,
  type MaintenanceWindowAdminView,
  type MaintenanceWindowInput,
  type MaintenanceWindowPublicView,
  type MaintenanceWindowSelectorRow,
  type MaintenanceWindowStatus,
  isValidMaintenanceWindowStatus,
  pickActiveMaintenanceWindow,
  validateMaintenanceWindowInput,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { ConfigVersionService } from '../config-version/config-version.service';
import { MaintenanceBroadcastService } from './maintenance-broadcast.service';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type MaintenanceWindowErrorCode =
  | MaintenanceValidationCode
  | 'MAINTENANCE_NOT_FOUND'
  | 'MAINTENANCE_KEY_DUPLICATE'
  | 'MAINTENANCE_INVALID_STATUS_TRANSITION';

export class MaintenanceWindowError extends Error {
  constructor(
    public readonly code: MaintenanceWindowErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
    this.name = 'MaintenanceWindowError';
  }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateMaintenanceWindowInput extends MaintenanceWindowInput {
  /** `DRAFT` mặc định. Admin có thể truyền `SCHEDULED` để publish ngay. */
  initialStatus?: 'DRAFT' | 'SCHEDULED';
}

export interface UpdateMaintenanceWindowInput {
  severity?: MaintenanceSeverity;
  target?: MaintenanceTarget;
  titleVi?: string;
  titleEn?: string | null;
  messageVi?: string;
  messageEn?: string | null;
  startsAt?: Date;
  endsAt?: Date;
  allowAdminBypass?: boolean;
  allowHealthcheck?: boolean;
  allowMetrics?: boolean;
  /** Chỉ cho phép manual: `DRAFT → SCHEDULED`, `DISABLED → SCHEDULED`. */
  status?: 'SCHEDULED' | 'DRAFT';
}

// ---------------------------------------------------------------------------
// Recompute / block result types
// ---------------------------------------------------------------------------

export interface MaintenanceRecomputeSummary {
  scannedAt: string;
  activatedKeys: string[];
  endedKeys: string[];
}

/**
 * Dữ liệu mà middleware/guard cần để build response 503 envelope:
 *   `{ ok: false, error: { code: 'MAINTENANCE_ACTIVE', message, meta } }`.
 */
export interface MaintenanceBlockResult {
  readonly errorCode: typeof MAINTENANCE_BLOCK_ERROR_CODE;
  readonly payload: MaintenanceBlockErrorPayload;
}

export type RequestRole = 'ADMIN' | 'MOD' | 'PLAYER' | 'ANONYMOUS';

export type RequestMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | string;

export interface MaintenanceRequestContext {
  readonly role: RequestRole;
  readonly path: string;
  readonly method: RequestMethod;
}

// ---------------------------------------------------------------------------
// Bypass route helpers
// ---------------------------------------------------------------------------

/**
 * Healthcheck routes — không bao giờ chặn nếu `allowHealthcheck=true`.
 *
 * Bao gồm cả prefixed (`/api/...`) và non-prefixed để khớp middleware
 * gắn TRƯỚC `app.setGlobalPrefix('api')` (Phase 17 metrics middleware
 * dùng path đã có prefix; Phase 15.5 middleware sẽ gắn cùng vị trí).
 */
const HEALTH_BYPASS_ROUTES = [
  '/healthz',
  '/api/healthz',
  '/readyz',
  '/api/readyz',
  '/version',
  '/api/version',
];

/** Public maintenance status endpoint — không chặn dù maintenance ACTIVE. */
const MAINTENANCE_STATUS_ROUTES = [
  '/maintenance/status',
  '/api/maintenance/status',
];

/** Metrics route prefixes (admin-only nhưng vẫn cho qua middleware nếu allow). */
const METRICS_ROUTE_PREFIXES = ['/admin/metrics', '/api/admin/metrics'];

/** Auth routes (login/refresh) — admin cần login để vào trong giai đoạn bảo trì. */
const AUTH_ROUTE_PREFIXES = ['/_auth', '/api/_auth'];

const WRITE_METHODS = new Set([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

function startsWithAny(path: string, prefixes: readonly string[]): boolean {
  for (const p of prefixes) {
    if (path === p || path.startsWith(`${p}/`) || path.startsWith(p)) {
      // Match cả exact, trailing-slash form, và prefix subpath.
      if (path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`)) {
        return true;
      }
      // path.startsWith(p) đã cover tất cả nhưng giữ explicit cho rõ.
      return true;
    }
  }
  return false;
}

function exactOrSubpath(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`),
  );
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CachedActive {
  rows: ActiveRow[];
  expiresAt: number;
}

interface ActiveRow extends MaintenanceWindowSelectorRow {
  readonly id: string;
  readonly titleVi: string;
  readonly titleEn: string | null;
  readonly messageVi: string;
  readonly messageEn: string | null;
  readonly allowAdminBypass: boolean;
  readonly allowHealthcheck: boolean;
  readonly allowMetrics: boolean;
}

const CACHE_TTL_MS = 10_000;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class MaintenanceWindowService {
  private readonly logger = new Logger(MaintenanceWindowService.name);
  private cache: CachedActive | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly configVersion?: ConfigVersionService,
    @Optional() private readonly broadcastService?: MaintenanceBroadcastService,
  ) {}

  /**
   * Phase 15.8 — Build payload public-safe + broadcast qua WS. Fail-safe
   * (broadcast service tự catch error log warn). KHÔNG throw — DB
   * transition không bị rollback nếu broadcast fail.
   *
   * `now` truyền vào để giữ serverTime nhất quán với caller (vd cron tick
   * truyền `now` cố định cho cả batch transitions).
   */
  private emitBroadcast(
    row: {
      key: string;
      status: MaintenanceWindowStatus;
      severity: MaintenanceSeverity;
      target: MaintenanceTarget;
      titleVi: string;
      titleEn: string | null;
      messageVi: string;
      messageEn: string | null;
      startsAt: Date;
      endsAt: Date;
      allowAdminBypass: boolean;
    },
    now: Date,
  ): MaintenanceBroadcastPayload | null {
    if (!this.broadcastService) return null;
    let payload: MaintenanceBroadcastPayload;
    try {
      payload = buildMaintenanceBroadcastPayload(row, now);
    } catch (e) {
      this.logger.warn(
        `buildMaintenanceBroadcastPayload threw key=${row.key} status=${row.status}: ${(e as Error).message}`,
      );
      return null;
    }
    this.broadcastService.broadcast(payload);
    return payload;
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async listWindows(): Promise<MaintenanceWindowAdminView[]> {
    const rows = await this.prisma.maintenanceWindow.findMany({
      orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(toAdminView);
  }

  async getWindowById(
    id: string,
  ): Promise<MaintenanceWindowAdminView | null> {
    const row = await this.prisma.maintenanceWindow.findUnique({
      where: { id },
    });
    return row ? toAdminView(row) : null;
  }

  // -------------------------------------------------------------------------
  // Mutation
  // -------------------------------------------------------------------------

  async createWindow(
    adminUserId: string,
    input: CreateMaintenanceWindowInput,
  ): Promise<MaintenanceWindowAdminView> {
    const code = validateMaintenanceWindowInput(input);
    if (code) throw new MaintenanceWindowError(code);

    const status: MaintenanceWindowStatus = input.initialStatus ?? 'DRAFT';

    try {
      const created = await this.prisma.maintenanceWindow.create({
        data: {
          key: input.key,
          severity: input.severity,
          status,
          target: input.target,
          titleVi: input.titleVi.trim(),
          titleEn:
            input.titleEn !== undefined && input.titleEn !== null
              ? input.titleEn.trim() || null
              : null,
          messageVi: input.messageVi.trim(),
          messageEn:
            input.messageEn !== undefined && input.messageEn !== null
              ? input.messageEn.trim() || null
              : null,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          allowAdminBypass: input.allowAdminBypass ?? true,
          allowHealthcheck: input.allowHealthcheck ?? true,
          allowMetrics: input.allowMetrics ?? true,
          createdByAdminId: adminUserId,
        },
      });
      this.invalidateCache();
      const view = toAdminView(created);
      await this.recordConfigVersionSafe({
        entityId: created.id,
        action: 'CREATE',
        beforeJson: null,
        afterJson: snapshotMaintenanceWindow(view),
        adminId: adminUserId,
      });
      return view;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new MaintenanceWindowError('MAINTENANCE_KEY_DUPLICATE');
      }
      throw e;
    }
  }

  async updateWindow(
    id: string,
    input: UpdateMaintenanceWindowInput,
  ): Promise<MaintenanceWindowAdminView> {
    const existing = await this.prisma.maintenanceWindow.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new MaintenanceWindowError('MAINTENANCE_NOT_FOUND');
    }

    if (input.status) {
      if (input.status !== 'DRAFT' && input.status !== 'SCHEDULED') {
        throw new MaintenanceWindowError(
          'MAINTENANCE_INVALID_STATUS_TRANSITION',
          'Cannot manually set ACTIVE/ENDED — use cron recompute',
        );
      }
    }

    const merged: MaintenanceWindowInput = {
      key: existing.key,
      severity: (input.severity ?? existing.severity) as MaintenanceSeverity,
      target: (input.target ?? existing.target) as MaintenanceTarget,
      titleVi: input.titleVi ?? existing.titleVi,
      titleEn:
        input.titleEn !== undefined ? input.titleEn : existing.titleEn,
      messageVi: input.messageVi ?? existing.messageVi,
      messageEn:
        input.messageEn !== undefined ? input.messageEn : existing.messageEn,
      startsAt: input.startsAt ?? existing.startsAt,
      endsAt: input.endsAt ?? existing.endsAt,
    };

    const code = validateMaintenanceWindowInput(merged);
    if (code) throw new MaintenanceWindowError(code);

    const data: Prisma.MaintenanceWindowUpdateInput = {};
    if (input.severity !== undefined) data.severity = input.severity;
    if (input.target !== undefined) data.target = input.target;
    if (input.titleVi !== undefined) data.titleVi = input.titleVi.trim();
    if (input.titleEn !== undefined) {
      data.titleEn =
        input.titleEn === null ? null : input.titleEn.trim() || null;
    }
    if (input.messageVi !== undefined) data.messageVi = input.messageVi.trim();
    if (input.messageEn !== undefined) {
      data.messageEn =
        input.messageEn === null ? null : input.messageEn.trim() || null;
    }
    if (input.startsAt !== undefined) data.startsAt = input.startsAt;
    if (input.endsAt !== undefined) data.endsAt = input.endsAt;
    if (input.allowAdminBypass !== undefined) {
      data.allowAdminBypass = input.allowAdminBypass;
    }
    if (input.allowHealthcheck !== undefined) {
      data.allowHealthcheck = input.allowHealthcheck;
    }
    if (input.allowMetrics !== undefined) {
      data.allowMetrics = input.allowMetrics;
    }
    if (input.status) {
      data.status = input.status;
    }

    const updated = await this.prisma.maintenanceWindow.update({
      where: { id },
      data,
    });
    this.invalidateCache();
    const beforeView = toAdminView(existing);
    const view = toAdminView(updated);
    await this.recordConfigVersionSafe({
      entityId: updated.id,
      action: 'UPDATE',
      beforeJson: snapshotMaintenanceWindow(beforeView),
      afterJson: snapshotMaintenanceWindow(view),
      adminId: updated.createdByAdminId ?? null,
    });
    return view;
  }

  async disableWindow(id: string): Promise<MaintenanceWindowAdminView> {
    const existing = await this.prisma.maintenanceWindow.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new MaintenanceWindowError('MAINTENANCE_NOT_FOUND');
    }
    const updated = await this.prisma.maintenanceWindow.update({
      where: { id },
      data: {
        status: 'DISABLED',
        disabledAt: existing.disabledAt ?? new Date(),
      },
    });
    this.invalidateCache();
    const view = toAdminView(updated);
    await this.recordConfigVersionSafe({
      entityId: updated.id,
      action: 'DISABLE',
      beforeJson: snapshotMaintenanceWindow(toAdminView(existing)),
      afterJson: snapshotMaintenanceWindow(view),
      adminId: updated.createdByAdminId ?? null,
    });
    // Phase 15.8 — broadcast disable transition. Chỉ broadcast khi window
    // trước đó đã từng broadcast (SCHEDULED không leak thông tin
    // DRAFT/SCHEDULED-only ra public; nhưng player có thể đã nhận ACTIVE
    // overlay và cần biết DISABLED để gỡ overlay).
    if (
      existing.status === 'ACTIVE' ||
      existing.status === 'SCHEDULED' ||
      existing.status === 'DRAFT'
    ) {
      this.emitBroadcast(
        {
          key: updated.key,
          status: 'DISABLED',
          severity: updated.severity as MaintenanceSeverity,
          target: updated.target as MaintenanceTarget,
          titleVi: updated.titleVi,
          titleEn: updated.titleEn,
          messageVi: updated.messageVi,
          messageEn: updated.messageEn,
          startsAt: updated.startsAt,
          endsAt: updated.endsAt,
          allowAdminBypass: updated.allowAdminBypass,
        },
        new Date(),
      );
    }
    return view;
  }

  /**
   * Phase 15.6 — best-effort ghi ConfigVersion. KHÔNG throw nếu fail.
   */
  private async recordConfigVersionSafe(args: {
    entityId: string;
    action: 'CREATE' | 'UPDATE' | 'DISABLE' | 'ENABLE' | 'STATUS_RECOMPUTE';
    beforeJson: Record<string, unknown> | null;
    afterJson: Record<string, unknown>;
    adminId: string | null;
  }): Promise<void> {
    if (!this.configVersion) return;
    try {
      await this.configVersion.recordVersion({
        entityType: 'MAINTENANCE_WINDOW',
        entityId: args.entityId,
        action: args.action,
        beforeJson: args.beforeJson,
        afterJson: args.afterJson,
        changedByAdminId: args.adminId,
      });
    } catch (e) {
      this.logger.warn(
        `recordConfigVersion failed for MAINTENANCE_WINDOW/${args.entityId}: ${(e as Error).message}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Cron recompute
  // -------------------------------------------------------------------------

  /**
   * Idempotent recompute. Trả về key của các row transition để caller
   * (cron processor / admin recompute endpoint) audit/broadcast.
   *
   * Rules:
   *   - SCHEDULED ∈ window → ACTIVE.
   *   - SCHEDULED endsAt past → ENDED (skip-to-ended; không đếm vào
   *     `activatedKeys` vì chưa từng ACTIVE).
   *   - ACTIVE endsAt past → ENDED.
   *   - DRAFT/DISABLED/ENDED không tự transition.
   *
   * Idempotent: gọi 2 lần liên tục, lần thứ 2 trả mảng rỗng vì
   * `updateMany` filter `status` đã đổi.
   */
  async recomputeStatuses(
    now: Date = new Date(),
  ): Promise<MaintenanceRecomputeSummary> {
    // SCHEDULED → ACTIVE.
    const activatedCandidates = await this.prisma.maintenanceWindow.findMany({
      where: {
        status: 'SCHEDULED',
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
    });
    const activatedKeys: string[] = [];
    const activatedWinnerIds: string[] = [];
    if (activatedCandidates.length > 0) {
      const upd = await this.prisma.maintenanceWindow.updateMany({
        where: {
          id: { in: activatedCandidates.map((r) => r.id) },
          status: 'SCHEDULED',
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
        data: { status: 'ACTIVE' },
      });
      if (upd.count > 0) {
        const winners = activatedCandidates.slice(0, upd.count);
        for (const r of winners) {
          activatedKeys.push(r.key);
          activatedWinnerIds.push(r.id);
        }
        // Phase 15.6 — record STATUS_RECOMPUTE per transitioned row.
        for (const r of winners) {
          await this.recordConfigVersionSafe({
            entityId: r.id,
            action: 'STATUS_RECOMPUTE',
            beforeJson: snapshotMaintenanceWindow(toAdminView(r)),
            afterJson: snapshotMaintenanceWindow(
              toAdminView({ ...r, status: 'ACTIVE' }),
            ),
            adminId: null,
          });
        }
        // Phase 15.8 — broadcast SCHEDULED→ACTIVE transition. KHÔNG block
        // DB transition; broadcast service catch internal error.
        for (const r of winners) {
          this.emitBroadcast(
            {
              key: r.key,
              status: 'ACTIVE',
              severity: r.severity as MaintenanceSeverity,
              target: r.target as MaintenanceTarget,
              titleVi: r.titleVi,
              titleEn: r.titleEn,
              messageVi: r.messageVi,
              messageEn: r.messageEn,
              startsAt: r.startsAt,
              endsAt: r.endsAt,
              allowAdminBypass: r.allowAdminBypass,
            },
            now,
          );
        }
      }
    }
    void activatedWinnerIds;

    // SCHEDULED past endsAt → ENDED (skip-to-ended).
    const skippedCandidates = await this.prisma.maintenanceWindow.findMany({
      where: { status: 'SCHEDULED', endsAt: { lte: now } },
      select: { id: true },
    });
    if (skippedCandidates.length > 0) {
      await this.prisma.maintenanceWindow.updateMany({
        where: {
          id: { in: skippedCandidates.map((r) => r.id) },
          status: 'SCHEDULED',
          endsAt: { lte: now },
        },
        data: { status: 'ENDED' },
      });
      // Intentionally NOT broadcasting — chưa từng ACTIVE.
    }

    // ACTIVE → ENDED.
    const endedCandidates = await this.prisma.maintenanceWindow.findMany({
      where: { status: 'ACTIVE', endsAt: { lte: now } },
    });
    const endedKeys: string[] = [];
    if (endedCandidates.length > 0) {
      const upd = await this.prisma.maintenanceWindow.updateMany({
        where: {
          id: { in: endedCandidates.map((r) => r.id) },
          status: 'ACTIVE',
          endsAt: { lte: now },
        },
        data: { status: 'ENDED' },
      });
      if (upd.count > 0) {
        const winners = endedCandidates.slice(0, upd.count);
        for (const r of winners) {
          endedKeys.push(r.key);
          await this.recordConfigVersionSafe({
            entityId: r.id,
            action: 'STATUS_RECOMPUTE',
            beforeJson: snapshotMaintenanceWindow(toAdminView(r)),
            afterJson: snapshotMaintenanceWindow(
              toAdminView({ ...r, status: 'ENDED' }),
            ),
            adminId: null,
          });
        }
        // Phase 15.8 — broadcast ACTIVE→ENDED transition.
        for (const r of winners) {
          this.emitBroadcast(
            {
              key: r.key,
              status: 'ENDED',
              severity: r.severity as MaintenanceSeverity,
              target: r.target as MaintenanceTarget,
              titleVi: r.titleVi,
              titleEn: r.titleEn,
              messageVi: r.messageVi,
              messageEn: r.messageEn,
              startsAt: r.startsAt,
              endsAt: r.endsAt,
              allowAdminBypass: r.allowAdminBypass,
            },
            now,
          );
        }
      }
    }

    if (activatedKeys.length > 0 || endedKeys.length > 0) {
      this.invalidateCache();
    }

    return {
      scannedAt: now.toISOString(),
      activatedKeys,
      endedKeys,
    };
  }

  // -------------------------------------------------------------------------
  // Active window selection (cache)
  // -------------------------------------------------------------------------

  /**
   * Trả về row ACTIVE thắng (severity > target > endsAt). Cache 10s.
   *
   * Gọi từ middleware cao tần — cache giảm DB round-trip xuống ≤ 1 lần
   * mỗi 10s mỗi pod. Admin disable/create → invalidate cache ngay.
   */
  async getActiveWindow(now: Date = new Date()): Promise<ActiveRow | null> {
    const t = now.getTime();
    if (this.cache && this.cache.expiresAt > t) {
      return pickActiveMaintenanceWindow(this.cache.rows, now) as ActiveRow | null;
    }
    const rows = await this.prisma.maintenanceWindow.findMany({
      where: {
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      select: {
        id: true,
        key: true,
        status: true,
        severity: true,
        target: true,
        startsAt: true,
        endsAt: true,
        titleVi: true,
        titleEn: true,
        messageVi: true,
        messageEn: true,
        allowAdminBypass: true,
        allowHealthcheck: true,
        allowMetrics: true,
      },
    });
    const mapped: ActiveRow[] = rows
      .filter((r) => isValidMaintenanceWindowStatus(r.status))
      .map((r) => ({
        id: r.id,
        key: r.key,
        status: r.status as MaintenanceWindowStatus,
        severity: r.severity as MaintenanceSeverity,
        target: r.target as MaintenanceTarget,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        titleVi: r.titleVi,
        titleEn: r.titleEn,
        messageVi: r.messageVi,
        messageEn: r.messageEn,
        allowAdminBypass: r.allowAdminBypass,
        allowHealthcheck: r.allowHealthcheck,
        allowMetrics: r.allowMetrics,
      }));
    this.cache = {
      rows: mapped,
      expiresAt: t + CACHE_TTL_MS,
    };
    return pickActiveMaintenanceWindow(mapped, now) as ActiveRow | null;
  }

  invalidateCache(): void {
    this.cache = null;
  }

  // -------------------------------------------------------------------------
  // Public status endpoint
  // -------------------------------------------------------------------------

  async publicStatus(
    now: Date = new Date(),
  ): Promise<MaintenanceWindowPublicView> {
    const winner = await this.getActiveWindow(now);
    if (!winner) {
      return {
        active: false,
        severity: null,
        target: null,
        titleVi: null,
        titleEn: null,
        messageVi: null,
        messageEn: null,
        startsAt: null,
        endsAt: null,
        serverTime: now.toISOString(),
        allowAdminBypass: true,
      };
    }
    return {
      active: true,
      severity: winner.severity,
      target: winner.target,
      titleVi: winner.titleVi,
      titleEn: winner.titleEn,
      messageVi: winner.messageVi,
      messageEn: winner.messageEn,
      startsAt: winner.startsAt.toISOString(),
      endsAt: winner.endsAt.toISOString(),
      serverTime: now.toISOString(),
      allowAdminBypass: winner.allowAdminBypass,
    };
  }

  // -------------------------------------------------------------------------
  // Request gate (used by middleware)
  // -------------------------------------------------------------------------

  /**
   * Quy tắc bypass — return `null` nếu request được pass; return
   * `MaintenanceBlockResult` nếu bị chặn (caller render 503 envelope).
   *
   * 1. Nếu không có ACTIVE window → pass.
   * 2. Nếu route là `/maintenance/status` → pass (mọi role).
   * 3. Nếu `allowHealthcheck && route ∈ HEALTH_BYPASS_ROUTES` → pass.
   * 4. Nếu `allowMetrics && route bắt đầu /admin/metrics` → pass (vẫn
   *    sẽ qua AdminGuard ở Nest layer).
   * 5. Nếu `target=FULL_LOCKDOWN` → block tất cả (kể cả admin), trừ
   *    healthcheck/metrics đã pass ở trên.
   * 6. Nếu route là `/_auth/*` → pass (cho admin login lại).
   * 7. Nếu role=ADMIN/MOD và `target !== FULL_LOCKDOWN`:
   *      - `target=NON_ADMIN_USERS && role=ADMIN` → pass bất kể bypass flag.
   *      - `allowAdminBypass=true` → pass.
   *      - else → block.
   * 8. Nếu `target=API_WRITE_ONLY && method ∈ GET/HEAD/OPTIONS` → pass.
   * 9. Else → block.
   */
  async isMaintenanceActiveForRequest(
    ctx: MaintenanceRequestContext,
    now: Date = new Date(),
  ): Promise<MaintenanceBlockResult | null> {
    const winner = await this.getActiveWindow(now);
    if (!winner) return null;

    // 2. Maintenance status route bypass (mọi role).
    if (exactOrSubpath(ctx.path, MAINTENANCE_STATUS_ROUTES)) return null;

    // 3. Healthcheck bypass.
    if (
      winner.allowHealthcheck &&
      exactOrSubpath(ctx.path, HEALTH_BYPASS_ROUTES)
    ) {
      return null;
    }

    // 4. Metrics bypass.
    if (
      winner.allowMetrics &&
      startsWithAny(ctx.path, METRICS_ROUTE_PREFIXES)
    ) {
      return null;
    }

    // 5. FULL_LOCKDOWN — chặn tất cả các route còn lại (kể cả auth/admin).
    if (winner.target === 'FULL_LOCKDOWN') {
      return buildBlockResult(winner, now);
    }

    // 6. Auth route bypass — cho admin login lại + player gặp UI auth
    //    bình thường (player vẫn bị chặn ở game routes nhưng không bị
    //    chặn login UI để tránh deadlock UX).
    if (startsWithAny(ctx.path, AUTH_ROUTE_PREFIXES)) return null;

    // 7. Role-based bypass.
    if (ctx.role === 'ADMIN' || ctx.role === 'MOD') {
      if (winner.target === 'NON_ADMIN_USERS' && ctx.role === 'ADMIN') {
        return null;
      }
      if (winner.allowAdminBypass) return null;
    }

    // 8. API_WRITE_ONLY — chỉ chặn write methods.
    if (winner.target === 'API_WRITE_ONLY') {
      if (!WRITE_METHODS.has(String(ctx.method).toUpperCase())) {
        return null;
      }
    }

    return buildBlockResult(winner, now);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DbRow {
  id: string;
  key: string;
  status: string;
  severity: string;
  target: string;
  titleVi: string;
  titleEn: string | null;
  messageVi: string;
  messageEn: string | null;
  startsAt: Date;
  endsAt: Date;
  allowAdminBypass: boolean;
  allowHealthcheck: boolean;
  allowMetrics: boolean;
  createdByAdminId: string | null;
  createdAt: Date;
  updatedAt: Date;
  disabledAt: Date | null;
}

/**
 * Phase 15.6 — Snapshot for ConfigVersion persistence (Maintenance Window).
 * KHÔNG include id/createdAt/updatedAt/disabledAt; chỉ ghi semantically-
 * meaningful fields. allow* flags là quan trọng cho rollback safety.
 */
export function snapshotMaintenanceWindow(
  view: MaintenanceWindowAdminView,
): Record<string, unknown> {
  return {
    key: view.key,
    status: view.status,
    severity: view.severity,
    target: view.target,
    titleVi: view.titleVi,
    titleEn: view.titleEn,
    messageVi: view.messageVi,
    messageEn: view.messageEn,
    startsAt: view.startsAt,
    endsAt: view.endsAt,
    allowAdminBypass: view.allowAdminBypass,
    allowHealthcheck: view.allowHealthcheck,
    allowMetrics: view.allowMetrics,
  };
}

function toAdminView(r: DbRow): MaintenanceWindowAdminView {
  return {
    id: r.id,
    key: r.key,
    status: r.status as MaintenanceWindowStatus,
    severity: r.severity as MaintenanceSeverity,
    target: r.target as MaintenanceTarget,
    titleVi: r.titleVi,
    titleEn: r.titleEn,
    messageVi: r.messageVi,
    messageEn: r.messageEn,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    allowAdminBypass: r.allowAdminBypass,
    allowHealthcheck: r.allowHealthcheck,
    allowMetrics: r.allowMetrics,
    createdByAdminId: r.createdByAdminId,
    disabledAt: r.disabledAt ? r.disabledAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function buildBlockResult(
  winner: ActiveRow,
  now: Date,
): MaintenanceBlockResult {
  return {
    errorCode: MAINTENANCE_BLOCK_ERROR_CODE,
    payload: {
      code: MAINTENANCE_BLOCK_ERROR_CODE,
      message: winner.titleVi,
      meta: {
        severity: winner.severity,
        target: winner.target,
        titleVi: winner.titleVi,
        titleEn: winner.titleEn,
        messageVi: winner.messageVi,
        messageEn: winner.messageEn,
        endsAt: winner.endsAt.toISOString(),
        serverTime: now.toISOString(),
      },
    },
  };
}

export const __testing__ = {
  HEALTH_BYPASS_ROUTES,
  MAINTENANCE_STATUS_ROUTES,
  METRICS_ROUTE_PREFIXES,
  AUTH_ROUTE_PREFIXES,
  WRITE_METHODS,
};
