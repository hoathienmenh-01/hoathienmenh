/**
 * Phase 15.6 — Admin Config Version + Rollback controller.
 *
 * Endpoints (`@RequireAdmin` — ADMIN only, MOD/PLAYER reject):
 *   - `GET    /admin/config-versions?entityType=…&entityId=…`
 *   - `GET    /admin/config-versions/:id`
 *   - `GET    /admin/config-versions/diff?fromVersionId=…&toVersionId=…`
 *   - `POST   /admin/config-versions/:id/dry-run-rollback`
 *   - `POST   /admin/config-versions/:id/rollback`
 *
 * Audit chain:
 *   - `ADMIN_CONFIG_VERSION_VIEW`         — list / get / diff.
 *   - `ADMIN_CONFIG_ROLLBACK_DRY_RUN`     — dry-run trả safety info.
 *   - `ADMIN_CONFIG_ROLLBACK`             — apply thành công.
 *   - `ADMIN_CONFIG_ROLLBACK_BLOCKED`     — safety BLOCKED hoặc confirm
 *                                            phrase mismatch.
 *
 * Validate body qua zod `.strict()`. Empty body cho dry-run / rollback
 * reject (`INVALID_INPUT`).
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  isConfigVersionEntityType,
  type ConfigRollbackResponse,
  type ConfigVersionEntityType,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { PrismaService } from '../../common/prisma.service';
import {
  ConfigVersionError,
  ConfigVersionService,
} from '../config-version/config-version.service';
import {
  ConfigRollbackError,
  ConfigRollbackService,
} from './config-rollback.service';
import { ConfigRollbackOrchestratorError } from './config-rollback-orchestrator.service';

interface AdminReq extends Request {
  userId: string;
  role: 'ADMIN' | 'MOD' | 'PLAYER';
}

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

const ListQueryZ = z
  .object({
    entityType: z.string().refine(isConfigVersionEntityType, {
      message: 'CONFIG_VERSION_INVALID_ENTITY_TYPE',
    }),
    entityId: z.string().min(1).max(200),
    limit: z.coerce.number().int().positive().max(500).optional(),
  })
  .strict();

const DiffQueryZ = z
  .object({
    fromVersionId: z.string().min(1),
    toVersionId: z.string().min(1),
  })
  .strict();

const DryRunBodyZ = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .or(z.object({}).strict());

const RollbackBodyZ = z
  .object({
    reason: z.string().trim().max(500).optional(),
    confirmPhrase: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

@UseGuards(AdminGuard)
@Controller()
@RateLimitPolicy('ADMIN_MUTATION')
export class AdminConfigVersionController {
  constructor(
    private readonly versions: ConfigVersionService,
    private readonly rollback: ConfigRollbackService,
    private readonly prisma: PrismaService,
  ) {}

  // -------------------------------------------------------------------------
  // List + get + diff
  // -------------------------------------------------------------------------

  @Get('admin/config-versions')
  @RequireAdmin()
  async list(
    @Req() req: AdminReq,
    @Query() raw: unknown,
  ): Promise<{
    ok: true;
    data: {
      versions: Awaited<ReturnType<ConfigVersionService['listVersions']>>;
    };
  }> {
    const parsed = ListQueryZ.safeParse(raw);
    if (!parsed.success) fail('INVALID_INPUT');
    const { entityType, entityId, limit } = parsed.data;
    if (!isConfigVersionEntityType(entityType)) {
      fail('CONFIG_VERSION_INVALID_ENTITY_TYPE');
    }
    let versions;
    try {
      versions = await this.versions.listVersions(
        entityType,
        entityId,
        limit ?? 100,
      );
    } catch (e) {
      this.failConfigVersionError(e);
    }
    await this.audit(req.userId, 'ADMIN_CONFIG_VERSION_VIEW', {
      entityType,
      entityId,
      count: versions.length,
    });
    return { ok: true, data: { versions } };
  }

  @Get('admin/config-versions/diff')
  @RequireAdmin()
  async diff(
    @Req() req: AdminReq,
    @Query() raw: unknown,
  ): Promise<{
    ok: true;
    data: Awaited<ReturnType<ConfigVersionService['diffVersions']>>;
  }> {
    const parsed = DiffQueryZ.safeParse(raw);
    if (!parsed.success) fail('INVALID_INPUT');
    let result;
    try {
      result = await this.versions.diffVersions(
        parsed.data.fromVersionId,
        parsed.data.toVersionId,
      );
    } catch (e) {
      this.failConfigVersionError(e);
    }
    await this.audit(req.userId, 'ADMIN_CONFIG_VERSION_VIEW', {
      fromVersionId: parsed.data.fromVersionId,
      toVersionId: parsed.data.toVersionId,
      changedFields: result.changedFields,
    });
    return { ok: true, data: result };
  }

  @Get('admin/config-versions/:id')
  @RequireAdmin()
  async get(
    @Req() req: AdminReq,
    @Param('id') id: string,
  ): Promise<{
    ok: true;
    data: Awaited<ReturnType<ConfigVersionService['getVersion']>>;
  }> {
    let row;
    try {
      row = await this.versions.getVersion(id);
    } catch (e) {
      this.failConfigVersionError(e);
    }
    await this.audit(req.userId, 'ADMIN_CONFIG_VERSION_VIEW', {
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      version: row.version,
    });
    return { ok: true, data: row };
  }

  // -------------------------------------------------------------------------
  // Dry-run rollback
  // -------------------------------------------------------------------------

  @Post('admin/config-versions/:id/dry-run-rollback')
  @RequireAdmin()
  async dryRunRollback(
    @Req() req: AdminReq,
    @Param('id') id: string,
    @Body() raw: unknown,
  ): Promise<{ ok: true; data: ConfigRollbackResponse }> {
    const parsed = DryRunBodyZ.safeParse(raw ?? {});
    if (!parsed.success) fail('INVALID_INPUT');
    let response: ConfigRollbackResponse;
    try {
      response = await this.rollback.dryRun(id);
    } catch (e) {
      this.failRollbackError(e);
    }
    await this.audit(req.userId, 'ADMIN_CONFIG_ROLLBACK_DRY_RUN', {
      targetVersionId: id,
      entityType: response.entityType,
      entityId: response.entityId,
      fromVersion: response.fromVersion,
      targetVersion: response.targetVersion,
      safetyLevel: response.safetyLevel,
      requiresConfirm: response.requiresConfirm,
      changedFields: response.changedFields,
      warnings: response.warnings,
    });
    return { ok: true, data: response };
  }

  // -------------------------------------------------------------------------
  // Apply rollback
  // -------------------------------------------------------------------------

  @Post('admin/config-versions/:id/rollback')
  @RequireAdmin()
  async applyRollback(
    @Req() req: AdminReq,
    @Param('id') id: string,
    @Body() raw: unknown,
  ): Promise<{ ok: true; data: ConfigRollbackResponse }> {
    const parsed = RollbackBodyZ.safeParse(raw ?? {});
    if (!parsed.success) fail('INVALID_INPUT');
    const reason = parsed.data.reason ?? null;
    const confirmPhrase = parsed.data.confirmPhrase ?? null;

    let response: ConfigRollbackResponse;
    try {
      response = await this.rollback.apply({
        targetVersionId: id,
        adminUserId: req.userId,
        reason,
        confirmPhrase,
      });
    } catch (e) {
      if (e instanceof ConfigRollbackError) {
        // Audit BLOCKED / confirm-related failures.
        await this.audit(req.userId, 'ADMIN_CONFIG_ROLLBACK_BLOCKED', {
          targetVersionId: id,
          code: e.code,
          safetyLevel: e.safety?.level ?? null,
          warnings: e.safety?.warnings ?? [],
        });
        if (
          e.code === 'CONFIG_ROLLBACK_BLOCKED' ||
          e.code === 'CONFIG_ROLLBACK_CONFIRM_REQUIRED' ||
          e.code === 'CONFIG_ROLLBACK_CONFIRM_MISMATCH'
        ) {
          fail(e.code, HttpStatus.CONFLICT);
        }
        if (
          e.code === 'CONFIG_ROLLBACK_NOT_FOUND' ||
          e.code === 'CONFIG_ROLLBACK_TARGET_INVALID' ||
          e.code === 'CONFIG_ROLLBACK_TARGET_IS_LATEST'
        ) {
          fail(e.code, HttpStatus.BAD_REQUEST);
        }
      }
      if (e instanceof ConfigRollbackOrchestratorError) {
        await this.audit(req.userId, 'ADMIN_CONFIG_ROLLBACK_BLOCKED', {
          targetVersionId: id,
          code: e.code,
        });
        fail(e.code, HttpStatus.CONFLICT);
      }
      this.failConfigVersionError(e);
    }
    await this.audit(req.userId, 'ADMIN_CONFIG_ROLLBACK', {
      targetVersionId: id,
      entityType: response.entityType,
      entityId: response.entityId,
      fromVersion: response.fromVersion,
      targetVersion: response.targetVersion,
      appliedVersion: response.appliedVersion,
      newVersionId: response.newVersionId,
      safetyLevel: response.safetyLevel,
      changedFields: response.changedFields,
      reason,
    });
    return { ok: true, data: response };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private failConfigVersionError(e: unknown): never {
    if (e instanceof ConfigVersionError) {
      if (e.code === 'CONFIG_VERSION_NOT_FOUND') {
        fail(e.code, HttpStatus.NOT_FOUND);
      }
      fail(e.code, HttpStatus.BAD_REQUEST);
    }
    throw e;
  }

  private failRollbackError(e: unknown): never {
    if (e instanceof ConfigRollbackError) {
      if (
        e.code === 'CONFIG_ROLLBACK_NOT_FOUND' ||
        e.code === 'CONFIG_ROLLBACK_TARGET_INVALID' ||
        e.code === 'CONFIG_ROLLBACK_TARGET_IS_LATEST'
      ) {
        fail(e.code, HttpStatus.BAD_REQUEST);
      }
      fail(e.code, HttpStatus.CONFLICT);
    }
    throw e;
  }

  private async audit(
    actorUserId: string,
    action: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: { actorUserId, action, meta: meta as Prisma.InputJsonValue },
    });
  }
}

export type { ConfigVersionEntityType };
