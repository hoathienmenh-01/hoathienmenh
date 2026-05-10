/**
 * Phase 15.6 — Config Version persistence service.
 *
 * Provides:
 *   - `recordVersion(...)` — ghi 1 row `ConfigVersion` snapshot
 *     before/after. Skip nếu no-op (before deep-equal after).
 *   - `listVersions(entityType, entityId)` — list version newest first.
 *   - `getVersion(id)` / `getLatestVersion(entityType, entityId)`.
 *   - `diffVersions(versionAId, versionBId)` — diff JSON 2 version.
 *   - `recordRollbackRun(...)` — ghi audit row `ConfigRollbackRun` cho
 *     mỗi dry-run / apply / blocked / failed rollback.
 *
 * Service KHÔNG biết logic apply rollback (mutate entity row); việc đó
 * thuộc `ConfigRollbackOrchestratorService` ở admin module để tránh
 * cycle import. Service này chỉ persist + sanitize + diff.
 *
 * Sanitize:
 *   - Trước khi persist `beforeJson` / `afterJson`, gọi shared
 *     `sanitizeSnapshot` strip key chứa secret/password/token/cookie...
 *     Defense-in-depth — 4 entity Phase 15.6 không có field như vậy
 *     theo schema, nhưng đảm bảo forward-compat.
 *
 * Concurrency:
 *   - Version tăng tuần tự per `(entityType, entityId)`. Service tính
 *     `max(version)+1` rồi `create`. Race protection: unique index
 *     `(entityType, entityId, version)` — nếu 2 caller cùng tick, một
 *     bên fail P2002 và service retry 1 lần với version mới.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CONFIG_VERSION_ACTIONS,
  CONFIG_VERSION_ENTITY_TYPES,
  diffSnapshots,
  isConfigRollbackSafetyLevel,
  isConfigRollbackStatus,
  isConfigVersionAction,
  isConfigVersionEntityType,
  sanitizeSnapshot,
  type ConfigRollbackSafetyLevel,
  type ConfigRollbackStatus,
  type ConfigSnapshotDiffEntry,
  type ConfigVersionAction,
  type ConfigVersionEntityType,
  type ConfigVersionSnapshot,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ConfigVersionErrorCode =
  | 'CONFIG_VERSION_INVALID_ENTITY_TYPE'
  | 'CONFIG_VERSION_INVALID_ACTION'
  | 'CONFIG_VERSION_INVALID_STATUS'
  | 'CONFIG_VERSION_INVALID_SAFETY_LEVEL'
  | 'CONFIG_VERSION_NOT_FOUND'
  | 'CONFIG_VERSION_NO_OP'
  | 'CONFIG_VERSION_DUPLICATE';

export class ConfigVersionError extends Error {
  constructor(
    public readonly code: ConfigVersionErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
    this.name = 'ConfigVersionError';
  }
}

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface RecordVersionInput {
  readonly entityType: ConfigVersionEntityType;
  readonly entityId: string;
  readonly action: ConfigVersionAction;
  readonly beforeJson: ConfigVersionSnapshot | null;
  readonly afterJson: ConfigVersionSnapshot;
  readonly changedByAdminId: string | null;
  readonly reason?: string | null;
  /**
   * Status recompute spam guard — service skip ghi nếu before deep-equal
   * after. Mặc định `true`. Nếu admin muốn ép ghi (vd reset reason),
   * truyền `false`.
   */
  readonly skipNoOp?: boolean;
}

export interface ConfigVersionView {
  readonly id: string;
  readonly entityType: ConfigVersionEntityType;
  readonly entityId: string;
  readonly version: number;
  readonly action: ConfigVersionAction;
  readonly beforeJson: ConfigVersionSnapshot | null;
  readonly afterJson: ConfigVersionSnapshot;
  readonly changedByAdminId: string | null;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface ConfigVersionDiffView {
  readonly fromVersion: ConfigVersionView;
  readonly toVersion: ConfigVersionView;
  readonly changedFields: readonly string[];
  readonly diff: Record<string, ConfigSnapshotDiffEntry>;
}

export interface RecordRollbackRunInput {
  readonly entityType: ConfigVersionEntityType;
  readonly entityId: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly targetVersionId: string | null;
  readonly status: ConfigRollbackStatus;
  readonly safetyLevel: ConfigRollbackSafetyLevel;
  readonly performedByAdminId: string | null;
  readonly reason?: string | null;
  readonly resultJson?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ConfigVersionService {
  private readonly logger = new Logger(ConfigVersionService.name);

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // recordVersion
  // -------------------------------------------------------------------------

  /**
   * Persist 1 version row. Pure-fn `sanitizeSnapshot` strip secret-like
   * key trước khi lưu. Skip nếu no-op (before deep-equal after) để
   * tránh spam mỗi cron tick STATUS_RECOMPUTE.
   *
   * Trả về `ConfigVersionView` của row vừa tạo, hoặc `null` khi skip
   * no-op (caller không cần phân biệt — chỉ flow audit).
   */
  async recordVersion(
    input: RecordVersionInput,
  ): Promise<ConfigVersionView | null> {
    if (!isConfigVersionEntityType(input.entityType)) {
      throw new ConfigVersionError(
        'CONFIG_VERSION_INVALID_ENTITY_TYPE',
        `entityType=${input.entityType}`,
      );
    }
    if (!isConfigVersionAction(input.action)) {
      throw new ConfigVersionError(
        'CONFIG_VERSION_INVALID_ACTION',
        `action=${input.action}`,
      );
    }

    const beforeSan = input.beforeJson
      ? sanitizeSnapshot(input.beforeJson as Record<string, unknown>)
      : null;
    const afterSan = sanitizeSnapshot(
      input.afterJson as Record<string, unknown>,
    );

    const skipNoOp = input.skipNoOp ?? true;
    if (skipNoOp && input.beforeJson) {
      const diff = diffSnapshots(beforeSan, afterSan);
      if (Object.keys(diff).length === 0) {
        // No-op — không tạo version mới.
        return null;
      }
    }

    return this.persistVersionWithRetry({
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      beforeJson: beforeSan,
      afterJson: afterSan,
      changedByAdminId: input.changedByAdminId ?? null,
      reason: input.reason ?? null,
    });
  }

  /**
   * Atomic version sequence: tính `max(version)+1` rồi create. Nếu race
   * P2002, retry 1 lần với version mới (đủ cho 2-3 worker concurrent).
   */
  private async persistVersionWithRetry(
    data: {
      entityType: ConfigVersionEntityType;
      entityId: string;
      action: ConfigVersionAction;
      beforeJson: ConfigVersionSnapshot | null;
      afterJson: ConfigVersionSnapshot;
      changedByAdminId: string | null;
      reason: string | null;
    },
    attempt = 0,
  ): Promise<ConfigVersionView> {
    const next = await this.computeNextVersion(data.entityType, data.entityId);
    try {
      const row = await this.prisma.configVersion.create({
        data: {
          entityType: data.entityType,
          entityId: data.entityId,
          version: next,
          action: data.action,
          beforeJson:
            data.beforeJson === null
              ? Prisma.DbNull
              : (data.beforeJson as Prisma.InputJsonValue),
          afterJson: data.afterJson as Prisma.InputJsonValue,
          changedByAdminId: data.changedByAdminId,
          reason: data.reason,
        },
      });
      return toView(row);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        attempt < 2
      ) {
        // Race: someone else inserted the same version. Retry with bump.
        this.logger.warn(
          `recordVersion race attempt=${attempt + 1} for ${data.entityType}/${data.entityId}`,
        );
        return this.persistVersionWithRetry(data, attempt + 1);
      }
      throw e;
    }
  }

  private async computeNextVersion(
    entityType: ConfigVersionEntityType,
    entityId: string,
  ): Promise<number> {
    const top = await this.prisma.configVersion.findFirst({
      where: { entityType, entityId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (top?.version ?? 0) + 1;
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async listVersions(
    entityType: ConfigVersionEntityType,
    entityId: string,
    limit = 100,
  ): Promise<ConfigVersionView[]> {
    if (!isConfigVersionEntityType(entityType)) {
      throw new ConfigVersionError(
        'CONFIG_VERSION_INVALID_ENTITY_TYPE',
        `entityType=${entityType}`,
      );
    }
    const rows = await this.prisma.configVersion.findMany({
      where: { entityType, entityId },
      orderBy: { version: 'desc' },
      take: Math.max(1, Math.min(limit, 500)),
    });
    return rows.map(toView);
  }

  async getVersion(id: string): Promise<ConfigVersionView> {
    const row = await this.prisma.configVersion.findUnique({ where: { id } });
    if (!row) {
      throw new ConfigVersionError('CONFIG_VERSION_NOT_FOUND', `id=${id}`);
    }
    return toView(row);
  }

  async getLatestVersion(
    entityType: ConfigVersionEntityType,
    entityId: string,
  ): Promise<ConfigVersionView | null> {
    const row = await this.prisma.configVersion.findFirst({
      where: { entityType, entityId },
      orderBy: { version: 'desc' },
    });
    return row ? toView(row) : null;
  }

  // -------------------------------------------------------------------------
  // Diff
  // -------------------------------------------------------------------------

  async diffVersions(
    fromVersionId: string,
    toVersionId: string,
  ): Promise<ConfigVersionDiffView> {
    const [fromV, toV] = await Promise.all([
      this.getVersion(fromVersionId),
      this.getVersion(toVersionId),
    ]);
    const diff = diffSnapshots(fromV.afterJson, toV.afterJson);
    return {
      fromVersion: fromV,
      toVersion: toV,
      changedFields: Object.keys(diff),
      diff,
    };
  }

  // -------------------------------------------------------------------------
  // Rollback run audit
  // -------------------------------------------------------------------------

  async recordRollbackRun(
    input: RecordRollbackRunInput,
  ): Promise<{ id: string; createdAt: string }> {
    if (!isConfigVersionEntityType(input.entityType)) {
      throw new ConfigVersionError(
        'CONFIG_VERSION_INVALID_ENTITY_TYPE',
        `entityType=${input.entityType}`,
      );
    }
    if (!isConfigRollbackStatus(input.status)) {
      throw new ConfigVersionError(
        'CONFIG_VERSION_INVALID_STATUS',
        `status=${input.status}`,
      );
    }
    if (!isConfigRollbackSafetyLevel(input.safetyLevel)) {
      throw new ConfigVersionError(
        'CONFIG_VERSION_INVALID_SAFETY_LEVEL',
        `safetyLevel=${input.safetyLevel}`,
      );
    }
    const row = await this.prisma.configRollbackRun.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        fromVersion: input.fromVersion,
        toVersion: input.toVersion,
        targetVersionId: input.targetVersionId,
        status: input.status,
        safetyLevel: input.safetyLevel,
        performedByAdminId: input.performedByAdminId,
        reason: input.reason ?? null,
        resultJson:
          input.resultJson === null || input.resultJson === undefined
            ? Prisma.DbNull
            : (input.resultJson as Prisma.InputJsonValue),
      },
      select: { id: true, createdAt: true },
    });
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toView(row: {
  id: string;
  entityType: string;
  entityId: string;
  version: number;
  action: string;
  beforeJson: Prisma.JsonValue | null;
  afterJson: Prisma.JsonValue;
  changedByAdminId: string | null;
  reason: string | null;
  createdAt: Date;
}): ConfigVersionView {
  // entityType / action validate ngầm — DB chỉ chấp nhận row do service ghi.
  // Nếu DB row cũ có giá trị ngoài catalog (rare/data corruption), cast và
  // log; admin UI vẫn render để admin có thể sửa.
  const entityType = (CONFIG_VERSION_ENTITY_TYPES as readonly string[]).includes(
    row.entityType,
  )
    ? (row.entityType as ConfigVersionEntityType)
    : (row.entityType as ConfigVersionEntityType);
  const action = (CONFIG_VERSION_ACTIONS as readonly string[]).includes(
    row.action,
  )
    ? (row.action as ConfigVersionAction)
    : (row.action as ConfigVersionAction);

  return {
    id: row.id,
    entityType,
    entityId: row.entityId,
    version: row.version,
    action,
    beforeJson: jsonToSnapshot(row.beforeJson),
    afterJson: jsonToSnapshot(row.afterJson) ?? {},
    changedByAdminId: row.changedByAdminId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

function jsonToSnapshot(
  v: Prisma.JsonValue | null,
): ConfigVersionSnapshot | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return null;
  return v as ConfigVersionSnapshot;
}
