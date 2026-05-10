/**
 * Phase 15.6 — Config Rollback Orchestrator.
 *
 * Apply target snapshot trở lại entity. Bao gồm:
 *   - LIVEOPS_EVENT       → `prisma.liveOpsScheduledEvent.update`.
 *   - LIVEOPS_ANNOUNCEMENT → `prisma.liveOpsAnnouncement.update`.
 *   - FEATURE_FLAG        → `prisma.featureFlag.upsert`.
 *   - MAINTENANCE_WINDOW  → `prisma.maintenanceWindow.update`.
 *
 * KHÔNG tự ghi `ConfigVersion` của entity sau apply — caller
 * (`ConfigVersionAdminController`) sẽ ghi 1 row action=`ROLLBACK` với
 * snapshot before/after từ orchestrator để mapper diff đầy đủ.
 *
 * KHÔNG tự ghi `AdminAuditLog` — caller controller wire audit.
 *
 * Safety: orchestrator chỉ apply; safety decision đã được caller compute
 * trước qua `computeRollbackSafety()`. Nếu safety BLOCKED hoặc
 * NEED_CONFIRM thiếu confirmPhrase → caller throw HttpException trước
 * khi gọi orchestrator.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ConfigVersionEntityType,
  ConfigVersionSnapshot,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

export interface OrchestrateRollbackInput {
  readonly entityType: ConfigVersionEntityType;
  readonly entityId: string;
  readonly targetSnapshot: ConfigVersionSnapshot;
}

export interface OrchestrateRollbackResult {
  readonly entityType: ConfigVersionEntityType;
  readonly entityId: string;
  readonly currentSnapshot: ConfigVersionSnapshot;
}

export class ConfigRollbackOrchestratorError extends Error {
  constructor(public readonly code: string, detail?: string) {
    super(detail ?? code);
    this.name = 'ConfigRollbackOrchestratorError';
  }
}

@Injectable()
export class ConfigRollbackOrchestratorService {
  private readonly logger = new Logger(ConfigRollbackOrchestratorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async apply(
    input: OrchestrateRollbackInput,
  ): Promise<OrchestrateRollbackResult> {
    switch (input.entityType) {
      case 'LIVEOPS_EVENT':
        return this.applyLiveOpsEvent(input.entityId, input.targetSnapshot);
      case 'LIVEOPS_ANNOUNCEMENT':
        return this.applyLiveOpsAnnouncement(
          input.entityId,
          input.targetSnapshot,
        );
      case 'FEATURE_FLAG':
        return this.applyFeatureFlag(input.entityId, input.targetSnapshot);
      case 'MAINTENANCE_WINDOW':
        return this.applyMaintenanceWindow(
          input.entityId,
          input.targetSnapshot,
        );
      default: {
        const exhaustive: never = input.entityType;
        throw new ConfigRollbackOrchestratorError(
          'CONFIG_ROLLBACK_ENTITY_TYPE_INVALID',
          `Unsupported entity type: ${String(exhaustive)}`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // LIVEOPS_EVENT
  // -------------------------------------------------------------------------
  private async applyLiveOpsEvent(
    entityId: string,
    target: ConfigVersionSnapshot,
  ): Promise<OrchestrateRollbackResult> {
    const existing = await this.prisma.liveOpsScheduledEvent.findUnique({
      where: { id: entityId },
    });
    if (!existing) {
      throw new ConfigRollbackOrchestratorError(
        'CONFIG_ROLLBACK_ENTITY_NOT_FOUND',
      );
    }
    const data: Prisma.LiveOpsScheduledEventUpdateInput = {};
    if (typeof target.title === 'string') data.title = target.title;
    if (typeof target.description === 'string') {
      data.description = target.description;
    }
    if (typeof target.status === 'string') {
      data.status = target.status;
    }
    if (typeof target.startsAt === 'string') {
      data.startsAt = new Date(target.startsAt);
    }
    if (typeof target.endsAt === 'string') {
      data.endsAt = new Date(target.endsAt);
    }
    if (
      target.configJson &&
      typeof target.configJson === 'object' &&
      !Array.isArray(target.configJson)
    ) {
      data.configJson = target.configJson as Prisma.InputJsonValue;
    }
    const updated = await this.prisma.liveOpsScheduledEvent.update({
      where: { id: entityId },
      data,
    });
    return {
      entityType: 'LIVEOPS_EVENT',
      entityId,
      currentSnapshot: {
        key: updated.key,
        type: updated.type,
        title: updated.title,
        description: updated.description,
        status: updated.status,
        startsAt: updated.startsAt.toISOString(),
        endsAt: updated.endsAt.toISOString(),
        configJson: (updated.configJson as Prisma.JsonValue) ?? {},
      },
    };
  }

  // -------------------------------------------------------------------------
  // LIVEOPS_ANNOUNCEMENT
  // -------------------------------------------------------------------------
  private async applyLiveOpsAnnouncement(
    entityId: string,
    target: ConfigVersionSnapshot,
  ): Promise<OrchestrateRollbackResult> {
    const existing = await this.prisma.liveOpsAnnouncement.findUnique({
      where: { id: entityId },
    });
    if (!existing) {
      throw new ConfigRollbackOrchestratorError(
        'CONFIG_ROLLBACK_ENTITY_NOT_FOUND',
      );
    }
    const data: Prisma.LiveOpsAnnouncementUpdateInput = {};
    if (typeof target.severity === 'string') data.severity = target.severity;
    if (typeof target.target === 'string') data.target = target.target;
    if (typeof target.titleVi === 'string') data.titleVi = target.titleVi;
    if (target.titleEn === null || typeof target.titleEn === 'string') {
      data.titleEn = target.titleEn ?? null;
    }
    if (typeof target.messageVi === 'string') data.messageVi = target.messageVi;
    if (target.messageEn === null || typeof target.messageEn === 'string') {
      data.messageEn = target.messageEn ?? null;
    }
    if (typeof target.startsAt === 'string') {
      data.startsAt = new Date(target.startsAt);
    }
    if (typeof target.endsAt === 'string') {
      data.endsAt = new Date(target.endsAt);
    }
    if (typeof target.status === 'string') {
      data.status = target.status;
    }
    const updated = await this.prisma.liveOpsAnnouncement.update({
      where: { id: entityId },
      data,
    });
    return {
      entityType: 'LIVEOPS_ANNOUNCEMENT',
      entityId,
      currentSnapshot: {
        key: updated.key,
        severity: updated.severity,
        status: updated.status,
        target: updated.target,
        titleVi: updated.titleVi,
        titleEn: updated.titleEn,
        messageVi: updated.messageVi,
        messageEn: updated.messageEn,
        startsAt: updated.startsAt.toISOString(),
        endsAt: updated.endsAt.toISOString(),
      },
    };
  }

  // -------------------------------------------------------------------------
  // FEATURE_FLAG
  // -------------------------------------------------------------------------
  private async applyFeatureFlag(
    entityId: string,
    target: ConfigVersionSnapshot,
  ): Promise<OrchestrateRollbackResult> {
    if (typeof target.key !== 'string') {
      throw new ConfigRollbackOrchestratorError(
        'CONFIG_ROLLBACK_TARGET_INVALID',
        'Feature flag snapshot missing `key`',
      );
    }
    if (target.key !== entityId) {
      throw new ConfigRollbackOrchestratorError(
        'CONFIG_ROLLBACK_TARGET_INVALID',
        'Feature flag snapshot key mismatch entityId',
      );
    }
    const enabled =
      typeof target.enabled === 'boolean' ? target.enabled : false;
    const category =
      typeof target.category === 'string' ? target.category : 'OTHER';
    const description =
      typeof target.description === 'string' ? target.description : '';

    const updated = await this.prisma.featureFlag.upsert({
      where: { key: entityId },
      update: {
        enabled,
        category,
        description,
      },
      create: {
        key: entityId,
        enabled,
        category,
        description,
      },
    });
    return {
      entityType: 'FEATURE_FLAG',
      entityId,
      currentSnapshot: {
        key: updated.key,
        enabled: updated.enabled,
        category: updated.category,
        description: updated.description ?? null,
      },
    };
  }

  // -------------------------------------------------------------------------
  // MAINTENANCE_WINDOW
  // -------------------------------------------------------------------------
  private async applyMaintenanceWindow(
    entityId: string,
    target: ConfigVersionSnapshot,
  ): Promise<OrchestrateRollbackResult> {
    const existing = await this.prisma.maintenanceWindow.findUnique({
      where: { id: entityId },
    });
    if (!existing) {
      throw new ConfigRollbackOrchestratorError(
        'CONFIG_ROLLBACK_ENTITY_NOT_FOUND',
      );
    }
    const data: Prisma.MaintenanceWindowUpdateInput = {};
    if (typeof target.severity === 'string') data.severity = target.severity;
    if (typeof target.target === 'string') data.target = target.target;
    if (typeof target.titleVi === 'string') data.titleVi = target.titleVi;
    if (target.titleEn === null || typeof target.titleEn === 'string') {
      data.titleEn = target.titleEn ?? null;
    }
    if (typeof target.messageVi === 'string') data.messageVi = target.messageVi;
    if (target.messageEn === null || typeof target.messageEn === 'string') {
      data.messageEn = target.messageEn ?? null;
    }
    if (typeof target.startsAt === 'string') {
      data.startsAt = new Date(target.startsAt);
    }
    if (typeof target.endsAt === 'string') {
      data.endsAt = new Date(target.endsAt);
    }
    if (typeof target.allowAdminBypass === 'boolean') {
      data.allowAdminBypass = target.allowAdminBypass;
    }
    if (typeof target.allowHealthcheck === 'boolean') {
      data.allowHealthcheck = target.allowHealthcheck;
    }
    if (typeof target.allowMetrics === 'boolean') {
      data.allowMetrics = target.allowMetrics;
    }
    if (typeof target.status === 'string') {
      data.status = target.status;
    }
    const updated = await this.prisma.maintenanceWindow.update({
      where: { id: entityId },
      data,
    });
    return {
      entityType: 'MAINTENANCE_WINDOW',
      entityId,
      currentSnapshot: {
        key: updated.key,
        status: updated.status,
        severity: updated.severity,
        target: updated.target,
        titleVi: updated.titleVi,
        titleEn: updated.titleEn,
        messageVi: updated.messageVi,
        messageEn: updated.messageEn,
        startsAt: updated.startsAt.toISOString(),
        endsAt: updated.endsAt.toISOString(),
        allowAdminBypass: updated.allowAdminBypass,
        allowHealthcheck: updated.allowHealthcheck,
        allowMetrics: updated.allowMetrics,
      },
    };
  }
}
