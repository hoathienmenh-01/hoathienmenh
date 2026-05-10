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
  LIVEOPS_EVENT_KEY_PATTERN,
  LIVEOPS_EVENT_STATUSES,
  LIVEOPS_EVENT_TYPES,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { PrismaService } from '../../common/prisma.service';
import {
  LiveOpsEventSchedulerError,
  LiveOpsEventSchedulerService,
  toLiveOpsEventBroadcastPayload,
  type LiveOpsScheduledEventView,
  type RecomputeSummary,
} from './liveops-event-scheduler.service';
import { LiveOpsBroadcastService } from '../liveops-announcement/liveops-broadcast.service';

/**
 * Phase 15.1–15.2 — Admin endpoints cho LiveOps Event Scheduler.
 *
 * Endpoints (RequireAdmin — MOD bị reject `ADMIN_ONLY` 403):
 *   - `GET    /admin/liveops/events`               — list all events.
 *   - `POST   /admin/liveops/events`               — create event.
 *   - `PATCH  /admin/liveops/events/:id`           — update event (title/desc/window/config/status).
 *   - `POST   /admin/liveops/events/:id/disable`   — kill switch.
 *   - `POST   /admin/liveops/events/recompute-status` — manual cron trigger
 *     (idempotent, force run cron for testing/operational override).
 *
 * Audit: mọi mutation ghi `AdminAuditLog` action `ADMIN_LIVEOPS_EVENT_*`
 * (mirror `AdminLiveOpsCronController` pattern). Read endpoint KHÔNG ghi
 * audit (read-only, không thay đổi state).
 *
 * Error mapping:
 *   - `LiveOpsEventSchedulerError` code → HTTP 400 (validation) / 404 (not found) / 409 (duplicate).
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
    key: z.string().min(3).max(64).regex(LIVEOPS_EVENT_KEY_PATTERN),
    type: z.enum(LIVEOPS_EVENT_TYPES as unknown as [string, ...string[]]),
    title: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    configJson: z
      .object({
        multiplier: z.number().finite().optional(),
        rewardJson: z.record(z.unknown()).optional(),
      })
      .strict()
      .optional(),
    initialStatus: z.enum(['DRAFT', 'SCHEDULED']).optional(),
  })
  .strict();

const UpdateBodyZ = z
  .object({
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(500).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    configJson: z
      .object({
        multiplier: z.number().finite().optional(),
        rewardJson: z.record(z.unknown()).optional(),
      })
      .strict()
      .optional(),
    status: z
      .enum(LIVEOPS_EVENT_STATUSES as unknown as [string, ...string[]])
      .optional(),
  })
  .strict();

@UseGuards(AdminGuard)
@Controller()
export class AdminLiveOpsEventsController {
  constructor(
    private readonly service: LiveOpsEventSchedulerService,
    private readonly prisma: PrismaService,
    private readonly broadcast: LiveOpsBroadcastService,
  ) {}

  @Get('admin/liveops/events')
  @RequireAdmin()
  async listEvents(): Promise<{
    ok: true;
    data: { events: LiveOpsScheduledEventView[] };
  }> {
    const events = await this.service.listEvents();
    return { ok: true, data: { events } };
  }

  @Post('admin/liveops/events')
  @RequireAdmin()
  async createEvent(
    @Req() req: AdminReq,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: LiveOpsScheduledEventView }> {
    const parsed = CreateBodyZ.safeParse(rawBody);
    if (!parsed.success) fail('INVALID_INPUT');

    let event: LiveOpsScheduledEventView;
    try {
      event = await this.service.createEvent(req.userId, {
        key: parsed.data.key,
        type: parsed.data.type as never,
        title: parsed.data.title,
        description: parsed.data.description,
        startsAt: new Date(parsed.data.startsAt),
        endsAt: new Date(parsed.data.endsAt),
        configJson: parsed.data.configJson ?? {},
        initialStatus: parsed.data.initialStatus,
      });
    } catch (e) {
      handleSchedulerError(e);
    }

    await this.audit(req.userId, 'ADMIN_LIVEOPS_EVENT_CREATE', {
      eventId: event.id,
      key: event.key,
      type: event.type,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      status: event.status,
    });
    return { ok: true, data: event };
  }

  @Patch('admin/liveops/events/:id')
  @RequireAdmin()
  async updateEvent(
    @Req() req: AdminReq,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ): Promise<{ ok: true; data: LiveOpsScheduledEventView }> {
    const parsed = UpdateBodyZ.safeParse(rawBody);
    if (!parsed.success) fail('INVALID_INPUT');

    let event: LiveOpsScheduledEventView;
    try {
      event = await this.service.updateEvent(id, {
        title: parsed.data.title,
        description: parsed.data.description,
        startsAt: parsed.data.startsAt
          ? new Date(parsed.data.startsAt)
          : undefined,
        endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : undefined,
        configJson: parsed.data.configJson,
        status: parsed.data.status as never,
      });
    } catch (e) {
      handleSchedulerError(e);
    }

    await this.audit(req.userId, 'ADMIN_LIVEOPS_EVENT_UPDATE', {
      eventId: event.id,
      key: event.key,
      patch: parsed.data,
      newStatus: event.status,
    });
    return { ok: true, data: event };
  }

  @Post('admin/liveops/events/:id/disable')
  @RequireAdmin()
  async disableEvent(
    @Req() req: AdminReq,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: LiveOpsScheduledEventView }> {
    let event: LiveOpsScheduledEventView;
    try {
      event = await this.service.disableEvent(id);
    } catch (e) {
      handleSchedulerError(e);
    }
    await this.audit(req.userId, 'ADMIN_LIVEOPS_EVENT_DISABLE', {
      eventId: event.id,
      key: event.key,
      status: event.status,
    });
    return { ok: true, data: event };
  }

  @Post('admin/liveops/events/recompute-status')
  @RequireAdmin()
  async recomputeStatus(
    @Req() req: AdminReq,
  ): Promise<{ ok: true; data: RecomputeSummary }> {
    // Phase 15.3.B — dùng method mới `recomputeStatusesWithTransitions`
    // để broadcast WS event public-safe payload cho rows transition. Trả ra
    // controller vẫn dùng `RecomputeSummary` shape (toActivated / toEnded)
    // — bảo toàn contract cho admin FE cũ.
    const summary = await this.service.recomputeStatusesWithTransitions();
    for (const view of summary.activated) {
      this.broadcast.broadcastEvent(
        toLiveOpsEventBroadcastPayload(view, 'LIVEOPS_EVENT_ACTIVE'),
      );
    }
    for (const view of summary.ended) {
      this.broadcast.broadcastEvent(
        toLiveOpsEventBroadcastPayload(view, 'LIVEOPS_EVENT_ENDED'),
      );
    }
    await this.audit(req.userId, 'ADMIN_LIVEOPS_EVENT_RECOMPUTE', {
      scannedAt: summary.scannedAt,
      toActivated: summary.toActivated,
      toEnded: summary.toEnded,
    });
    return {
      ok: true,
      data: {
        scannedAt: summary.scannedAt,
        toActivated: summary.toActivated,
        toEnded: summary.toEnded,
      },
    };
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

function handleSchedulerError(e: unknown): never {
  if (e instanceof LiveOpsEventSchedulerError) {
    if (e.code === 'EVENT_NOT_FOUND') fail(e.code, HttpStatus.NOT_FOUND);
    if (e.code === 'EVENT_KEY_DUPLICATE') fail(e.code, HttpStatus.CONFLICT);
    fail(e.code, HttpStatus.BAD_REQUEST);
  }
  throw e;
}
