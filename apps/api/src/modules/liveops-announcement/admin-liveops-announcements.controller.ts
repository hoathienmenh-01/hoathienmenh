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
  LIVEOPS_ANNOUNCEMENT_KEY_PATTERN,
  LIVEOPS_ANNOUNCEMENT_MESSAGE_MAX,
  LIVEOPS_ANNOUNCEMENT_SEVERITIES,
  LIVEOPS_ANNOUNCEMENT_TARGETS,
  LIVEOPS_ANNOUNCEMENT_TITLE_MAX,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { PrismaService } from '../../common/prisma.service';
import { LiveOpsBroadcastService } from './liveops-broadcast.service';
import {
  LiveOpsAnnouncementError,
  LiveOpsAnnouncementService,
  type AnnouncementRecomputeSummary,
  type LiveOpsAnnouncementView,
} from './liveops-announcement.service';

/**
 * Phase 15.3.B — Admin endpoints cho LiveOps Announcement.
 *
 * Endpoints (`@RequireAdmin` — MOD bị reject `ADMIN_ONLY` 403):
 *   - `GET    /admin/liveops/announcements`               — list announcements.
 *   - `POST   /admin/liveops/announcements`               — create announcement.
 *   - `PATCH  /admin/liveops/announcements/:id`           — update fields/status.
 *   - `POST   /admin/liveops/announcements/:id/disable`   — kill switch.
 *   - `POST   /admin/liveops/announcements/recompute-status` — manual cron trigger.
 *
 * Audit: mọi mutation ghi `AdminAuditLog` action `ADMIN_LIVEOPS_ANNOUNCEMENT_*`.
 *
 * Recompute: gọi service.recomputeStatuses() rồi delegate broadcast cho
 * `LiveOpsBroadcastService` — fail-safe nếu WS service lỗi (status
 * transition vẫn thành công, broadcast log warn).
 */

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

const CreateBodyZ = z
  .object({
    key: z.string().min(3).max(80).regex(LIVEOPS_ANNOUNCEMENT_KEY_PATTERN),
    severity: z.enum(
      LIVEOPS_ANNOUNCEMENT_SEVERITIES as unknown as [string, ...string[]],
    ),
    target: z.enum(
      LIVEOPS_ANNOUNCEMENT_TARGETS as unknown as [string, ...string[]],
    ),
    titleVi: z.string().min(1).max(LIVEOPS_ANNOUNCEMENT_TITLE_MAX),
    titleEn: z
      .string()
      .max(LIVEOPS_ANNOUNCEMENT_TITLE_MAX)
      .nullable()
      .optional(),
    messageVi: z.string().min(1).max(LIVEOPS_ANNOUNCEMENT_MESSAGE_MAX),
    messageEn: z
      .string()
      .max(LIVEOPS_ANNOUNCEMENT_MESSAGE_MAX)
      .nullable()
      .optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    initialStatus: z.enum(['DRAFT', 'SCHEDULED']).optional(),
  })
  .strict();

const UpdateBodyZ = z
  .object({
    severity: z
      .enum(LIVEOPS_ANNOUNCEMENT_SEVERITIES as unknown as [string, ...string[]])
      .optional(),
    target: z
      .enum(LIVEOPS_ANNOUNCEMENT_TARGETS as unknown as [string, ...string[]])
      .optional(),
    titleVi: z.string().min(1).max(LIVEOPS_ANNOUNCEMENT_TITLE_MAX).optional(),
    titleEn: z
      .string()
      .max(LIVEOPS_ANNOUNCEMENT_TITLE_MAX)
      .nullable()
      .optional(),
    messageVi: z
      .string()
      .min(1)
      .max(LIVEOPS_ANNOUNCEMENT_MESSAGE_MAX)
      .optional(),
    messageEn: z
      .string()
      .max(LIVEOPS_ANNOUNCEMENT_MESSAGE_MAX)
      .nullable()
      .optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    status: z.enum(['DRAFT', 'SCHEDULED']).optional(),
  })
  .strict();

@UseGuards(AdminGuard)
@Controller()
@RateLimitPolicy('ADMIN_MUTATION')
export class AdminLiveOpsAnnouncementsController {
  constructor(
    private readonly service: LiveOpsAnnouncementService,
    private readonly broadcast: LiveOpsBroadcastService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('admin/liveops/announcements')
  @RequireAdmin()
  async list(): Promise<{
    ok: true;
    data: { announcements: LiveOpsAnnouncementView[] };
  }> {
    const announcements = await this.service.listAnnouncements();
    return { ok: true, data: { announcements } };
  }

  @Post('admin/liveops/announcements')
  @RequireAdmin()
  async create(
    @Req() req: AdminReq,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: LiveOpsAnnouncementView }> {
    const parsed = CreateBodyZ.safeParse(rawBody);
    if (!parsed.success) fail('INVALID_INPUT');

    let announcement: LiveOpsAnnouncementView;
    try {
      announcement = await this.service.createAnnouncement(req.userId, {
        key: parsed.data.key,
        severity: parsed.data.severity as never,
        target: parsed.data.target as never,
        titleVi: parsed.data.titleVi,
        titleEn: parsed.data.titleEn ?? null,
        messageVi: parsed.data.messageVi,
        messageEn: parsed.data.messageEn ?? null,
        startsAt: new Date(parsed.data.startsAt),
        endsAt: new Date(parsed.data.endsAt),
        initialStatus: parsed.data.initialStatus,
      });
    } catch (e) {
      handleError(e);
    }

    await this.audit(req.userId, 'ADMIN_LIVEOPS_ANNOUNCEMENT_CREATE', {
      announcementId: announcement.id,
      key: announcement.key,
      severity: announcement.severity,
      target: announcement.target,
      startsAt: announcement.startsAt,
      endsAt: announcement.endsAt,
      status: announcement.status,
    });
    return { ok: true, data: announcement };
  }

  @Patch('admin/liveops/announcements/:id')
  @RequireAdmin()
  async update(
    @Req() req: AdminReq,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: LiveOpsAnnouncementView }> {
    const parsed = UpdateBodyZ.safeParse(rawBody);
    if (!parsed.success) fail('INVALID_INPUT');

    let announcement: LiveOpsAnnouncementView;
    try {
      announcement = await this.service.updateAnnouncement(id, {
        severity: parsed.data.severity as never,
        target: parsed.data.target as never,
        titleVi: parsed.data.titleVi,
        titleEn:
          parsed.data.titleEn === undefined
            ? undefined
            : (parsed.data.titleEn ?? null),
        messageVi: parsed.data.messageVi,
        messageEn:
          parsed.data.messageEn === undefined
            ? undefined
            : (parsed.data.messageEn ?? null),
        startsAt: parsed.data.startsAt
          ? new Date(parsed.data.startsAt)
          : undefined,
        endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : undefined,
        status: parsed.data.status,
      });
    } catch (e) {
      handleError(e);
    }

    await this.audit(req.userId, 'ADMIN_LIVEOPS_ANNOUNCEMENT_UPDATE', {
      announcementId: announcement.id,
      key: announcement.key,
      patch: parsed.data,
      newStatus: announcement.status,
    });
    return { ok: true, data: announcement };
  }

  @Post('admin/liveops/announcements/:id/disable')
  @RequireAdmin()
  async disable(
    @Req() req: AdminReq,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: LiveOpsAnnouncementView }> {
    let announcement: LiveOpsAnnouncementView;
    try {
      announcement = await this.service.disableAnnouncement(id);
    } catch (e) {
      handleError(e);
    }
    await this.audit(req.userId, 'ADMIN_LIVEOPS_ANNOUNCEMENT_DISABLE', {
      announcementId: announcement.id,
      key: announcement.key,
      status: announcement.status,
      disabledAt: announcement.disabledAt,
    });
    return { ok: true, data: announcement };
  }

  @Post('admin/liveops/announcements/recompute-status')
  @RequireAdmin()
  async recompute(
    @Req() req: AdminReq,
  ): Promise<{ ok: true; data: AnnouncementRecomputeSummary }> {
    const summary = await this.service.recomputeStatuses();
    // Broadcast — fail-safe (broadcast service catch error log warn).
    for (const payload of summary.activated) {
      this.broadcast.broadcastAnnouncement(payload);
    }
    for (const payload of summary.ended) {
      this.broadcast.broadcastAnnouncement(payload);
    }
    await this.audit(req.userId, 'ADMIN_LIVEOPS_ANNOUNCEMENT_RECOMPUTE', {
      scannedAt: summary.scannedAt,
      activated: summary.activated.length,
      ended: summary.ended.length,
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

function handleError(e: unknown): never {
  if (e instanceof LiveOpsAnnouncementError) {
    if (e.code === 'ANNOUNCEMENT_NOT_FOUND') {
      fail(e.code, HttpStatus.NOT_FOUND);
    }
    if (e.code === 'ANNOUNCEMENT_KEY_DUPLICATE') {
      fail(e.code, HttpStatus.CONFLICT);
    }
    fail(e.code, HttpStatus.BAD_REQUEST);
  }
  throw e;
}
