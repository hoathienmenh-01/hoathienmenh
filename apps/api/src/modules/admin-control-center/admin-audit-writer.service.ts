import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  defaultRiskFor,
  isAdminActionType,
  isAdminRiskLevel,
  type AdminActionType,
  type AdminPermissionKey,
  type AdminRiskLevel,
  type AdminRoleKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 27.6 — Admin Control Center V2 audit writer.
 *
 * Wrap `AdminAuditLog` Phase 18.x — KHÔNG migration `AdminAuditLog`
 * (giữ back-compat với 18+ admin module hiện có). Mở rộng qua
 * `meta` JSON:
 *
 *   meta = {
 *     actionType: AdminActionType,
 *     adminRole: AdminRoleKey,
 *     permissionKey?: AdminPermissionKey,
 *     riskLevel: AdminRiskLevel,
 *     reason: string,
 *     targetType?: string,
 *     targetId?: string,
 *     beforeJson?: unknown,
 *     afterJson?: unknown,
 *     ticketId?: string,
 *     ipAddress?: string,
 *     userAgent?: string,
 *   }
 *
 * `AdminAuditLog.action` lưu raw `actionType` để search bằng index cũ
 * `@@index([action, createdAt])`.
 *
 * Helper tự derive `riskLevel` qua `defaultRiskFor(actionType)` nếu caller
 * không pass — `HIGH+` actions yêu cầu `reason` non-empty (throw).
 */

export interface AdminAuditWriteInput {
  adminUserId: string;
  adminRole: AdminRoleKey;
  actionType: AdminActionType;
  permissionKey?: AdminPermissionKey;
  riskLevel?: AdminRiskLevel;
  reason: string;
  targetType?: string;
  targetId?: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  ticketId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export class AdminAuditValidationError extends Error {
  constructor(
    public readonly code:
      | 'ACTION_TYPE_INVALID'
      | 'RISK_LEVEL_INVALID'
      | 'REASON_REQUIRED'
      | 'REASON_TOO_LONG',
    message: string,
  ) {
    super(message);
    this.name = 'AdminAuditValidationError';
  }
}

@Injectable()
export class AdminAuditWriter {
  private readonly logger = new Logger(AdminAuditWriter.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ghi 1 row audit log. Throw `AdminAuditValidationError` nếu input
   * bất hợp lệ (caller phải catch hoặc để controller bubble lên 500).
   */
  async write(input: AdminAuditWriteInput): Promise<{ id: string }> {
    if (!isAdminActionType(input.actionType)) {
      throw new AdminAuditValidationError(
        'ACTION_TYPE_INVALID',
        `Invalid action type: ${input.actionType}`,
      );
    }
    const risk: AdminRiskLevel = input.riskLevel ?? defaultRiskFor(input.actionType);
    if (!isAdminRiskLevel(risk)) {
      throw new AdminAuditValidationError(
        'RISK_LEVEL_INVALID',
        `Invalid risk level: ${risk}`,
      );
    }
    if (!input.reason || input.reason.trim().length === 0) {
      throw new AdminAuditValidationError(
        'REASON_REQUIRED',
        'reason is required for admin audit log',
      );
    }
    if (input.reason.length > 2000) {
      throw new AdminAuditValidationError(
        'REASON_TOO_LONG',
        'reason must be <= 2000 chars',
      );
    }

    const meta: Record<string, unknown> = {
      actionType: input.actionType,
      adminRole: input.adminRole,
      riskLevel: risk,
      reason: input.reason.trim(),
    };
    if (input.permissionKey !== undefined) meta.permissionKey = input.permissionKey;
    if (input.targetType !== undefined) meta.targetType = input.targetType;
    if (input.targetId !== undefined) meta.targetId = input.targetId;
    if (input.beforeJson !== undefined) meta.beforeJson = input.beforeJson;
    if (input.afterJson !== undefined) meta.afterJson = input.afterJson;
    if (input.ticketId !== undefined) meta.ticketId = input.ticketId;
    if (input.ipAddress !== undefined) meta.ipAddress = input.ipAddress;
    if (input.userAgent !== undefined) meta.userAgent = input.userAgent;

    const row = await this.prisma.adminAuditLog.create({
      data: {
        actorUserId: input.adminUserId,
        action: input.actionType,
        meta: meta as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    this.logger.log(
      `[admin-audit] action=${input.actionType} risk=${risk} admin=${input.adminUserId} target=${input.targetType ?? '-'}:${input.targetId ?? '-'}`,
    );
    return row;
  }
}
