/**
 * Phase 15.5 — Admin endpoints cho Maintenance Window.
 *
 * Endpoints (`@RequireAdmin` — MOD bị reject `ADMIN_ONLY` 403):
 *   - `GET    /admin/maintenance-windows`                     — list.
 *   - `POST   /admin/maintenance-windows`                     — create.
 *   - `PATCH  /admin/maintenance-windows/:id`                 — update fields.
 *   - `POST   /admin/maintenance-windows/:id/disable`         — kill switch.
 *   - `POST   /admin/maintenance-windows/recompute-status`    — manual cron trigger.
 *
 * Audit: ghi `AdminAuditLog` action `ADMIN_MAINTENANCE_CREATE` /
 * `ADMIN_MAINTENANCE_UPDATE` / `ADMIN_MAINTENANCE_DISABLE` /
 * `ADMIN_MAINTENANCE_RECOMPUTE`.
 *
 * Validate body qua zod `.strict()` — trả `INVALID_INPUT` nếu sai shape.
 * Service-level validator (`validateMaintenanceWindowInput`) cap
 * title/message/window — error code chi tiết trả khách hàng.
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  MAINTENANCE_SEVERITIES,
  MAINTENANCE_TARGETS,
  type MaintenanceSeverity,
  type MaintenanceTarget,
  type MaintenanceWindowAdminView,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { PrismaService } from '../../common/prisma.service';
import {
  MaintenanceWindowError,
  MaintenanceWindowService,
} from '../maintenance-window/maintenance-window.service';

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

const SeverityZ = z.enum(
  MAINTENANCE_SEVERITIES as readonly [
    MaintenanceSeverity,
    ...MaintenanceSeverity[],
  ],
);
const TargetZ = z.enum(
  MAINTENANCE_TARGETS as readonly [MaintenanceTarget, ...MaintenanceTarget[]],
);

const IsoDateZ = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(new Date(s).getTime()), {
    message: 'INVALID_DATE',
  });

const CreateBodyZ = z
  .object({
    key: z.string().min(3).max(80),
    severity: SeverityZ,
    target: TargetZ,
    titleVi: z.string().min(1).max(120),
    titleEn: z.string().max(120).nullable().optional(),
    messageVi: z.string().min(1).max(1000),
    messageEn: z.string().max(1000).nullable().optional(),
    startsAt: IsoDateZ,
    endsAt: IsoDateZ,
    allowAdminBypass: z.boolean().optional(),
    allowHealthcheck: z.boolean().optional(),
    allowMetrics: z.boolean().optional(),
    initialStatus: z.enum(['DRAFT', 'SCHEDULED']).optional(),
  })
  .strict();

const PatchBodyZ = z
  .object({
    severity: SeverityZ.optional(),
    target: TargetZ.optional(),
    titleVi: z.string().min(1).max(120).optional(),
    titleEn: z.string().max(120).nullable().optional(),
    messageVi: z.string().min(1).max(1000).optional(),
    messageEn: z.string().max(1000).nullable().optional(),
    startsAt: IsoDateZ.optional(),
    endsAt: IsoDateZ.optional(),
    allowAdminBypass: z.boolean().optional(),
    allowHealthcheck: z.boolean().optional(),
    allowMetrics: z.boolean().optional(),
    status: z.enum(['DRAFT', 'SCHEDULED']).optional(),
  })
  .strict();

@UseGuards(AdminGuard)
@Controller()
export class AdminMaintenanceWindowController {
  constructor(
    private readonly service: MaintenanceWindowService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('admin/maintenance-windows')
  @RequireAdmin()
  async list(): Promise<{
    ok: true;
    data: { windows: MaintenanceWindowAdminView[] };
  }> {
    const windows = await this.service.listWindows();
    return { ok: true, data: { windows } };
  }

  @Post('admin/maintenance-windows')
  @RequireAdmin()
  async create(
    @Req() req: AdminReq,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: MaintenanceWindowAdminView }> {
    const parsed = CreateBodyZ.safeParse(rawBody);
    if (!parsed.success) fail('INVALID_INPUT');
    const body = parsed.data;

    let view: MaintenanceWindowAdminView;
    try {
      view = await this.service.createWindow(req.userId, {
        key: body.key,
        severity: body.severity,
        target: body.target,
        titleVi: body.titleVi,
        titleEn: body.titleEn ?? null,
        messageVi: body.messageVi,
        messageEn: body.messageEn ?? null,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        allowAdminBypass: body.allowAdminBypass,
        allowHealthcheck: body.allowHealthcheck,
        allowMetrics: body.allowMetrics,
        initialStatus: body.initialStatus,
      });
    } catch (e) {
      if (e instanceof MaintenanceWindowError) {
        fail(
          e.code,
          e.code === 'MAINTENANCE_KEY_DUPLICATE'
            ? HttpStatus.CONFLICT
            : HttpStatus.BAD_REQUEST,
        );
      }
      throw e;
    }

    await this.audit(req.userId, 'ADMIN_MAINTENANCE_CREATE', {
      id: view.id,
      key: view.key,
      severity: view.severity,
      target: view.target,
      status: view.status,
      startsAt: view.startsAt,
      endsAt: view.endsAt,
      allowAdminBypass: view.allowAdminBypass,
      allowHealthcheck: view.allowHealthcheck,
      allowMetrics: view.allowMetrics,
    });
    return { ok: true, data: view };
  }

  @Patch('admin/maintenance-windows/:id')
  @RequireAdmin()
  async update(
    @Req() req: AdminReq,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: MaintenanceWindowAdminView }> {
    if (!id || id.length === 0) fail('INVALID_INPUT');
    const parsed = PatchBodyZ.safeParse(rawBody);
    if (!parsed.success) fail('INVALID_INPUT');
    const body = parsed.data;

    let view: MaintenanceWindowAdminView;
    try {
      view = await this.service.updateWindow(id, {
        severity: body.severity,
        target: body.target,
        titleVi: body.titleVi,
        titleEn: body.titleEn ?? undefined,
        messageVi: body.messageVi,
        messageEn: body.messageEn ?? undefined,
        startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
        endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
        allowAdminBypass: body.allowAdminBypass,
        allowHealthcheck: body.allowHealthcheck,
        allowMetrics: body.allowMetrics,
        status: body.status,
      });
    } catch (e) {
      if (e instanceof MaintenanceWindowError) {
        if (e.code === 'MAINTENANCE_NOT_FOUND') {
          fail(e.code, HttpStatus.NOT_FOUND);
        }
        fail(e.code, HttpStatus.BAD_REQUEST);
      }
      throw e;
    }

    await this.audit(req.userId, 'ADMIN_MAINTENANCE_UPDATE', {
      id: view.id,
      key: view.key,
      severity: view.severity,
      target: view.target,
      status: view.status,
      startsAt: view.startsAt,
      endsAt: view.endsAt,
      allowAdminBypass: view.allowAdminBypass,
      allowHealthcheck: view.allowHealthcheck,
      allowMetrics: view.allowMetrics,
    });
    return { ok: true, data: view };
  }

  @Post('admin/maintenance-windows/:id/disable')
  @RequireAdmin()
  async disable(
    @Req() req: AdminReq,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: MaintenanceWindowAdminView }> {
    if (!id || id.length === 0) fail('INVALID_INPUT');

    let view: MaintenanceWindowAdminView;
    try {
      view = await this.service.disableWindow(id);
    } catch (e) {
      if (
        e instanceof MaintenanceWindowError &&
        e.code === 'MAINTENANCE_NOT_FOUND'
      ) {
        fail(e.code, HttpStatus.NOT_FOUND);
      }
      throw e;
    }

    await this.audit(req.userId, 'ADMIN_MAINTENANCE_DISABLE', {
      id: view.id,
      key: view.key,
      disabledAt: view.disabledAt,
    });
    return { ok: true, data: view };
  }

  @Post('admin/maintenance-windows/recompute-status')
  @RequireAdmin()
  async recompute(
    @Req() req: AdminReq,
  ): Promise<{
    ok: true;
    data: { scannedAt: string; activatedKeys: string[]; endedKeys: string[] };
  }> {
    const summary = await this.service.recomputeStatuses();
    await this.audit(req.userId, 'ADMIN_MAINTENANCE_RECOMPUTE', {
      scannedAt: summary.scannedAt,
      activatedKeys: summary.activatedKeys,
      endedKeys: summary.endedKeys,
    });
    return { ok: true, data: summary };
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
