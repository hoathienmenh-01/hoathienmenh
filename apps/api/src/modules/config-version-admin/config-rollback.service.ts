/**
 * Phase 15.6 — Config Rollback (dry-run + apply).
 *
 * High-level flow:
 *   1. Load target version + latest version (current).
 *   2. Compute diff + safety level (`computeRollbackSafety`).
 *   3. Dry-run → trả response, KHÔNG mutate entity.
 *      Apply  → check safety, apply orchestrator, ghi ConfigVersion mới
 *               action=ROLLBACK, ghi ConfigRollbackRun.
 *
 * Safety gates trước khi apply:
 *   - BLOCKED         → throw, caller HTTP 409 + audit BLOCKED.
 *   - NEED_CONFIRM    → cần `confirmPhrase` exact match (case-insensitive)
 *                       với phrase server-issued. Thiếu/mismatch → throw.
 *   - SAFE            → apply ngay.
 *
 * Caller phải ghi audit log (controller) tự tay — service trả về
 * `ConfigRollbackResponse` để controller bind audit.
 */
import { Injectable } from '@nestjs/common';
import {
  LIVEOPS_EVENT_TYPE_CAPS,
  computeRollbackSafety,
  diffSnapshots,
  type ConfigRollbackResponse,
  type ConfigRollbackSafetyContext,
  type ConfigRollbackSafetyResult,
  type ConfigVersionEntityType,
  type ConfigVersionSnapshot,
  type LiveOpsScheduledEventType,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import {
  ConfigVersionError,
  ConfigVersionService,
  type ConfigVersionView,
} from '../config-version/config-version.service';
import { ConfigRollbackOrchestratorService } from './config-rollback-orchestrator.service';

export class ConfigRollbackError extends Error {
  constructor(
    public readonly code:
      | 'CONFIG_ROLLBACK_BLOCKED'
      | 'CONFIG_ROLLBACK_CONFIRM_REQUIRED'
      | 'CONFIG_ROLLBACK_CONFIRM_MISMATCH'
      | 'CONFIG_ROLLBACK_TARGET_INVALID'
      | 'CONFIG_ROLLBACK_TARGET_IS_LATEST'
      | 'CONFIG_ROLLBACK_NOT_FOUND',
    detail?: string,
    public readonly safety?: ConfigRollbackSafetyResult,
  ) {
    super(detail ?? code);
    this.name = 'ConfigRollbackError';
  }
}

export interface ConfigRollbackInput {
  readonly targetVersionId: string;
  readonly adminUserId: string;
  readonly reason: string | null;
  readonly confirmPhrase?: string | null;
}

@Injectable()
export class ConfigRollbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly versions: ConfigVersionService,
    private readonly orchestrator: ConfigRollbackOrchestratorService,
  ) {}

  // -------------------------------------------------------------------------
  // Dry-run
  // -------------------------------------------------------------------------

  async dryRun(
    targetVersionId: string,
  ): Promise<ConfigRollbackResponse> {
    const target = await this.loadVersion(targetVersionId);
    const latest = await this.versions.getLatestVersion(
      target.entityType,
      target.entityId,
    );
    if (!latest) {
      throw new ConfigRollbackError(
        'CONFIG_ROLLBACK_NOT_FOUND',
        'No latest version found for entity',
      );
    }
    const context = await this.buildSafetyContext(
      target.entityType,
      target.entityId,
      target.afterJson,
    );
    const safety = computeRollbackSafety(
      target.entityType,
      target.afterJson,
      latest.afterJson,
      context,
    );
    const diff = diffSnapshots(latest.afterJson, target.afterJson);
    return {
      status: 'DRY_RUN',
      safetyLevel: safety.level,
      entityType: target.entityType,
      entityId: target.entityId,
      fromVersion: latest.version,
      targetVersion: target.version,
      changedFields: Object.keys(diff),
      diff,
      warnings: safety.warnings,
      requiresConfirm: safety.requiresConfirm,
      confirmPhrase: safety.confirmPhrase,
      appliedVersion: null,
      newVersionId: null,
    };
  }

  // -------------------------------------------------------------------------
  // Apply
  // -------------------------------------------------------------------------

  async apply(input: ConfigRollbackInput): Promise<ConfigRollbackResponse> {
    const target = await this.loadVersion(input.targetVersionId);
    const latest = await this.versions.getLatestVersion(
      target.entityType,
      target.entityId,
    );
    if (!latest) {
      throw new ConfigRollbackError(
        'CONFIG_ROLLBACK_NOT_FOUND',
        'No latest version found for entity',
      );
    }
    if (latest.id === target.id) {
      throw new ConfigRollbackError(
        'CONFIG_ROLLBACK_TARGET_IS_LATEST',
        'Target version is already the latest',
      );
    }
    const context = await this.buildSafetyContext(
      target.entityType,
      target.entityId,
      target.afterJson,
    );
    const safety = computeRollbackSafety(
      target.entityType,
      target.afterJson,
      latest.afterJson,
      context,
    );

    if (safety.level === 'BLOCKED') {
      // Record BLOCKED run for audit chain.
      await this.versions.recordRollbackRun({
        entityType: target.entityType,
        entityId: target.entityId,
        fromVersion: latest.version,
        toVersion: target.version,
        targetVersionId: target.id,
        status: 'BLOCKED',
        safetyLevel: 'BLOCKED',
        performedByAdminId: input.adminUserId,
        reason: input.reason ?? null,
        resultJson: { warnings: [...safety.warnings] },
      });
      throw new ConfigRollbackError(
        'CONFIG_ROLLBACK_BLOCKED',
        safety.warnings[0] ?? 'BLOCKED',
        safety,
      );
    }

    if (safety.level === 'NEED_CONFIRM') {
      const submitted = (input.confirmPhrase ?? '').trim();
      if (!submitted) {
        throw new ConfigRollbackError(
          'CONFIG_ROLLBACK_CONFIRM_REQUIRED',
          'Confirm phrase required for NEED_CONFIRM rollback',
          safety,
        );
      }
      const expected = (safety.confirmPhrase ?? '').trim();
      if (
        !expected ||
        submitted.toLowerCase() !== expected.toLowerCase()
      ) {
        throw new ConfigRollbackError(
          'CONFIG_ROLLBACK_CONFIRM_MISMATCH',
          'Confirm phrase did not match expected',
          safety,
        );
      }
    }

    // Apply orchestrator → entity-level update.
    const result = await this.orchestrator.apply({
      entityType: target.entityType,
      entityId: target.entityId,
      targetSnapshot: target.afterJson,
    });

    // Record ROLLBACK version (action=ROLLBACK, before=current state pre-apply,
    // after=current state post-apply). skipNoOp=false — always record rollback
    // even if snapshot identical to current; recordVersion returns non-null.
    const newVersion = await this.versions.recordVersion({
      entityType: target.entityType,
      entityId: target.entityId,
      action: 'ROLLBACK',
      beforeJson: latest.afterJson,
      afterJson: result.currentSnapshot,
      changedByAdminId: input.adminUserId,
      reason: input.reason ?? null,
      skipNoOp: false,
    });
    if (!newVersion) {
      throw new ConfigRollbackError(
        'CONFIG_ROLLBACK_TARGET_INVALID',
        'recordVersion returned null despite skipNoOp=false',
      );
    }

    await this.versions.recordRollbackRun({
      entityType: target.entityType,
      entityId: target.entityId,
      fromVersion: latest.version,
      toVersion: target.version,
      targetVersionId: target.id,
      status: 'APPLIED',
      safetyLevel: safety.level,
      performedByAdminId: input.adminUserId,
      reason: input.reason ?? null,
      resultJson: { newVersion: newVersion.version },
    });

    const diff = diffSnapshots(latest.afterJson, result.currentSnapshot);
    return {
      status: 'APPLIED',
      safetyLevel: safety.level,
      entityType: target.entityType,
      entityId: target.entityId,
      fromVersion: latest.version,
      targetVersion: target.version,
      changedFields: Object.keys(diff),
      diff,
      warnings: safety.warnings,
      requiresConfirm: safety.requiresConfirm,
      confirmPhrase: safety.confirmPhrase,
      appliedVersion: newVersion.version,
      newVersionId: newVersion.id,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async loadVersion(id: string): Promise<ConfigVersionView> {
    try {
      return await this.versions.getVersion(id);
    } catch (e) {
      if (
        e instanceof ConfigVersionError &&
        e.code === 'CONFIG_VERSION_NOT_FOUND'
      ) {
        throw new ConfigRollbackError(
          'CONFIG_ROLLBACK_NOT_FOUND',
          'Target version id not found',
        );
      }
      throw e;
    }
  }

  /**
   * Per-entity context cho `computeRollbackSafety`. KHÔNG cần fetch
   * cho FEATURE_FLAG / MAINTENANCE_WINDOW / LIVEOPS_ANNOUNCEMENT (pure
   * snapshot-based safety). Riêng LIVEOPS_EVENT: cần claim count +
   * multiplier cap.
   */
  private async buildSafetyContext(
    entityType: ConfigVersionEntityType,
    entityId: string,
    targetSnapshot: ConfigVersionSnapshot,
  ): Promise<ConfigRollbackSafetyContext> {
    if (entityType !== 'LIVEOPS_EVENT') return {};
    const eventType = stringField(targetSnapshot, 'type');
    let claimCount = 0;
    try {
      claimCount = await this.prisma.liveOpsEventRewardClaim.count({
        where: { eventId: entityId },
      });
    } catch {
      claimCount = 0;
    }
    let multiplierMax: number | undefined;
    if (eventType && isLiveOpsEventTypeKey(eventType)) {
      multiplierMax = LIVEOPS_EVENT_TYPE_CAPS[eventType].multiplierMax;
    }
    return {
      liveOpsEventClaimCount: claimCount,
      liveOpsEventTypeMultiplierMax: multiplierMax,
    };
  }
}

function stringField(
  snapshot: ConfigVersionSnapshot,
  key: string,
): string | null {
  const value = snapshot[key];
  return typeof value === 'string' ? value : null;
}

function isLiveOpsEventTypeKey(
  s: string,
): s is LiveOpsScheduledEventType {
  return s in LIVEOPS_EVENT_TYPE_CAPS;
}
