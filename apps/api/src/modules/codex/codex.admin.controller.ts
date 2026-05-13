/**
 * Phase 32.0 — Codex admin controller.
 *
 * Endpoint:
 *   - POST /admin/codex/reindex            → trigger reindex từ catalog.
 *   - GET  /admin/codex/audit              → list audit issues.
 *   - POST /admin/codex/audit/:id/resolve  → resolve issue + audit.
 *   - POST /admin/codex/entries/:entryKey  → update (hide/show/description).
 *
 * Require `ADMIN_MANAGE_CODEX`.
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
import { z } from 'zod';
import {
  CODEX_VISIBILITIES,
  type AdminRoleKey,
} from '@xuantoi/shared';

import { PrismaService } from '../../common/prisma.service';
import { AdminPermissionGuard } from '../admin-control-center/admin-permission.guard';
import { RequireAdminPermission } from '../admin-control-center/admin-permission.decorator';
import { AdminAuditWriter } from '../admin-control-center/admin-audit-writer.service';
import { CodexIndexerService } from './codex-indexer.service';

interface AdminReq extends Request {
  userId: string;
  adminRole: AdminRoleKey;
}

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

const UpdateEntryZ = z
  .object({
    description: z.string().max(1000).optional(),
    visibility: z
      .enum([...(CODEX_VISIBILITIES as readonly string[])] as [string, ...string[]])
      .optional(),
    iconKey: z.string().max(200).optional(),
    reason: z.string().min(3).max(500),
  })
  .strict();

const ResolveAuditZ = z
  .object({ reason: z.string().min(3).max(500) })
  .strict();

@Controller('admin/codex')
@UseGuards(AdminPermissionGuard)
export class CodexAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: CodexIndexerService,
    private readonly audit: AdminAuditWriter,
  ) {}

  @Post('reindex')
  @RequireAdminPermission('ADMIN_MANAGE_CODEX')
  async reindex(@Req() req: AdminReq) {
    const result = await this.indexer.reindex(req.userId);
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'CODEX_REINDEX',
      targetType: 'CodexEntry',
      targetId: 'reindex-batch',
      reason: `upserted=${result.entriesUpserted} removed=${result.entriesRemoved} issues=${result.issuesFound}`,
    });
    return { ok: true, data: result };
  }

  @Get('audit')
  @RequireAdminPermission('ADMIN_MANAGE_CODEX')
  async listAudit(@Query('resolved') resolved?: string, @Query('limit') limit?: string) {
    const lim = Math.min(parseInt(limit ?? '100', 10) || 100, 500);
    return {
      ok: true,
      data: await this.prisma.codexAuditIssue.findMany({
        where: resolved === 'true' ? { resolved: true } : { resolved: false },
        orderBy: { createdAt: 'desc' },
        take: lim,
      }),
    };
  }

  @Post('audit/:id/resolve')
  @RequireAdminPermission('ADMIN_MANAGE_CODEX')
  async resolveAudit(@Req() req: AdminReq, @Param('id') id: string, @Body() body: unknown) {
    const parsed = ResolveAuditZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    await this.prisma.codexAuditIssue.update({
      where: { id },
      data: { resolved: true, resolvedBy: req.userId, resolvedAt: new Date() },
    });
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'CODEX_AUDIT_RESOLVE',
      targetType: 'CodexAuditIssue',
      targetId: id,
      reason: parsed.data.reason,
    });
    return { ok: true };
  }

  @Post('entries/:entryKey')
  @RequireAdminPermission('ADMIN_MANAGE_CODEX')
  async updateEntry(@Req() req: AdminReq, @Param('entryKey') entryKey: string, @Body() body: unknown) {
    const parsed = UpdateEntryZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const e = await this.prisma.codexEntry.findUnique({ where: { entryKey } });
    if (!e) fail('CODEX_ENTRY_NOT_FOUND', HttpStatus.NOT_FOUND);
    const update: { description?: string; visibility?: string; iconKey?: string; updatedBy: string; updatedAt: Date } = {
      updatedBy: req.userId,
      updatedAt: new Date(),
    };
    if (parsed.data.description !== undefined) update.description = parsed.data.description;
    if (parsed.data.visibility !== undefined) update.visibility = parsed.data.visibility;
    if (parsed.data.iconKey !== undefined) update.iconKey = parsed.data.iconKey;
    await this.prisma.codexEntry.update({ where: { entryKey }, data: update });

    const actionType =
      parsed.data.visibility === 'ADMIN_ONLY'
        ? 'CODEX_ENTRY_HIDE'
        : parsed.data.visibility === 'PUBLIC'
        ? 'CODEX_ENTRY_SHOW'
        : 'CODEX_ENTRY_UPDATE';
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType,
      targetType: 'CodexEntry',
      targetId: entryKey,
      reason: parsed.data.reason,
    });
    return { ok: true };
  }
}
