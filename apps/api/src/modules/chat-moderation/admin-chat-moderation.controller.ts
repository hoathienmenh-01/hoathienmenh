import {
  Body,
  Controller,
  Delete,
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
  CHAT_MESSAGE_REPORT_REASONS,
  CHAT_MESSAGE_REPORT_STATUSES,
  CHAT_MESSAGE_REPORT_TYPES,
  CHAT_MODERATION_LIMITS,
  CHAT_MUTE_SCOPES,
  type AdminChatModerationSummary,
  type AdminChatMuteListResponse,
  type AdminChatReportListResponse,
  type ChatMessageReportRow,
  type ChatMessageReportStatus,
  type ChatMuteRow,
} from '@xuantoi/shared';
import { AdminGuard } from '../admin/admin.guard';
import { RequireAdmin } from '../admin/require-admin.decorator';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import {
  ChatModerationError,
  ChatModerationService,
} from './chat-moderation.service';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

function statusFor(code: ChatModerationError['code']): number {
  switch (code) {
    case 'NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'NOT_AUTHORIZED':
      return HttpStatus.FORBIDDEN;
    case 'DUPLICATE_REPORT':
      return HttpStatus.CONFLICT;
    case 'GROUP_LOCKED':
    case 'GROUP_DISSOLVED':
    case 'MUTED':
      return HttpStatus.FORBIDDEN;
    case 'INVALID_TRANSITION':
    case 'INVALID_INPUT':
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ListReportsQuery = z
  .object({
    status: z.enum(CHAT_MESSAGE_REPORT_STATUSES).optional(),
    reason: z.enum(CHAT_MESSAGE_REPORT_REASONS).optional(),
    messageType: z.enum(CHAT_MESSAGE_REPORT_TYPES).optional(),
    targetUserId: z.string().min(1).max(64).optional(),
    reporterUserId: z.string().min(1).max(64).optional(),
    fromDate: z.string().datetime().optional(),
    toDate: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(CHAT_MODERATION_LIMITS.ADMIN_LIST_PAGE_MAX).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const ResolveReportInput = z
  .object({
    status: z.enum(['RESOLVED', 'REJECTED']),
    note: z.string().max(4000).nullable().optional(),
  })
  .strict();

const MuteCreateInput = z
  .object({
    userId: z.string().min(1).max(64),
    scope: z.enum(CHAT_MUTE_SCOPES),
    reason: z.string().min(1).max(2000),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict();

const ListMutesQuery = z
  .object({
    userId: z.string().min(1).max(64).optional(),
    scope: z.enum(CHAT_MUTE_SCOPES).optional(),
    activeOnly: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(CHAT_MODERATION_LIMITS.ADMIN_LIST_PAGE_MAX).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const HideMessageInput = z
  .object({
    messageType: z.enum(CHAT_MESSAGE_REPORT_TYPES),
    reason: z.string().max(2000).nullable().optional(),
  })
  .strict();

const LockGroupInput = z
  .object({
    reason: z.string().max(2000).nullable().optional(),
  })
  .strict();

const DissolveGroupInput = z
  .object({
    reason: z.string().max(2000).nullable().optional(),
  })
  .strict();

/**
 * Phase 19.2 — Admin chat moderation endpoints.
 *
 * Routes (yêu cầu AdminGuard — PLAYER 403):
 *   - GET  /admin/chat/reports              — list filter status/reason/type.
 *   - GET  /admin/chat/reports/summary      — summary cards.
 *   - POST /admin/chat/reports/:id/ack      — OPEN -> ACKNOWLEDGED.
 *   - POST /admin/chat/reports/:id/resolve  — -> RESOLVED hoặc REJECTED.
 *   - GET  /admin/chat/mutes                — list mutes filter.
 *   - POST /admin/chat/mutes                — create mute.
 *   - DELETE /admin/chat/mutes/:id          — revoke mute.
 *   - POST /admin/chat/messages/:id/hide    — soft-hide message.
 *   - POST /admin/chat/messages/:id/unhide  — unhide message.
 *   - POST /admin/chat/groups/:id/lock      — lock group (cấm send).
 *   - POST /admin/chat/groups/:id/unlock    — unlock group.
 *   - POST /admin/chat/groups/:id/dissolve  — dissolve group (soft-del).
 *
 * Policy: MOD được phép GET (read-only). Mutation routes có
 * `@RequireAdmin()` — MOD bị reject FORBIDDEN. Mọi mutation ghi
 * AdminAuditLog với prefix `ADMIN_CHAT_MODERATION_*`.
 *
 * Rate limit: `ADMIN_MUTATION` cho mutation routes (rate cao đủ cho
 * burst admin ops). Read routes không rate-limit (admin tin cậy).
 */
@Controller('admin/chat')
@UseGuards(AdminGuard)
export class AdminChatModerationController {
  constructor(private readonly mod: ChatModerationService) {}

  // ---- Reports ----

  @Get('reports')
  async listReports(
    @Query() query: unknown,
  ): Promise<{ ok: true; data: AdminChatReportListResponse }> {
    const parsed = ListReportsQuery.safeParse(query ?? {});
    if (!parsed.success) fail('INVALID_INPUT');
    const data = await this.mod.adminListReports({
      status: parsed.data.status,
      reason: parsed.data.reason,
      messageType: parsed.data.messageType,
      targetUserId: parsed.data.targetUserId,
      reporterUserId: parsed.data.reporterUserId,
      fromDate: parsed.data.fromDate ? new Date(parsed.data.fromDate) : undefined,
      toDate: parsed.data.toDate ? new Date(parsed.data.toDate) : undefined,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return { ok: true, data };
  }

  @Get('reports/summary')
  async summary(): Promise<{ ok: true; data: AdminChatModerationSummary }> {
    const data = await this.mod.adminSummary();
    return { ok: true, data };
  }

  @Post('reports/:id/ack')
  @RequireAdmin()
  @RateLimitPolicy('ADMIN_MUTATION')
  async ack(
    @Param('id') id: string,
    @Req() req: Request & { userId?: string },
  ): Promise<{ ok: true; data: { report: ChatMessageReportRow } }> {
    const actorId = req.userId;
    if (!actorId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const report = await this.mod.adminAckReport(actorId, id);
      return { ok: true, data: { report } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('reports/:id/resolve')
  @RequireAdmin()
  @RateLimitPolicy('ADMIN_MUTATION')
  async resolve(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { userId?: string },
  ): Promise<{ ok: true; data: { report: ChatMessageReportRow } }> {
    const actorId = req.userId;
    if (!actorId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = ResolveReportInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const report = await this.mod.adminResolveReport(
        actorId,
        id,
        parsed.data.status as ChatMessageReportStatus,
        parsed.data.note ?? null,
      );
      return { ok: true, data: { report } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  // ---- Mutes ----

  @Get('mutes')
  async listMutes(
    @Query() query: unknown,
  ): Promise<{ ok: true; data: AdminChatMuteListResponse }> {
    const parsed = ListMutesQuery.safeParse(query ?? {});
    if (!parsed.success) fail('INVALID_INPUT');
    const data = await this.mod.adminListMutes(parsed.data);
    return { ok: true, data };
  }

  @Post('mutes')
  @RequireAdmin()
  @RateLimitPolicy('ADMIN_MUTATION')
  async createMute(
    @Body() body: unknown,
    @Req() req: Request & { userId?: string },
  ): Promise<{ ok: true; data: { mute: ChatMuteRow } }> {
    const actorId = req.userId;
    if (!actorId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = MuteCreateInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const mute = await this.mod.adminCreateMute(actorId, {
        userId: parsed.data.userId,
        scope: parsed.data.scope,
        reason: parsed.data.reason,
        expiresAt: parsed.data.expiresAt ?? null,
      });
      return { ok: true, data: { mute } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Delete('mutes/:id')
  @RequireAdmin()
  @RateLimitPolicy('ADMIN_MUTATION')
  async revokeMute(
    @Param('id') id: string,
    @Req() req: Request & { userId?: string },
  ): Promise<{ ok: true; data: { mute: ChatMuteRow } }> {
    const actorId = req.userId;
    if (!actorId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const mute = await this.mod.adminRevokeMute(actorId, id);
      return { ok: true, data: { mute } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  // ---- Hide / Unhide message ----

  @Post('messages/:id/hide')
  @RequireAdmin()
  @RateLimitPolicy('ADMIN_MUTATION')
  async hideMessage(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { userId?: string },
  ): Promise<{
    ok: true;
    data: { messageId: string; messageType: 'PRIVATE' | 'GROUP' };
  }> {
    const actorId = req.userId;
    if (!actorId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = HideMessageInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const r = await this.mod.adminHideMessage(
        actorId,
        parsed.data.messageType,
        id,
        parsed.data.reason ?? null,
      );
      return {
        ok: true,
        data: { messageId: r.messageId, messageType: r.messageType },
      };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('messages/:id/unhide')
  @RequireAdmin()
  @RateLimitPolicy('ADMIN_MUTATION')
  async unhideMessage(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { userId?: string },
  ): Promise<{
    ok: true;
    data: { messageId: string; messageType: 'PRIVATE' | 'GROUP' };
  }> {
    const actorId = req.userId;
    if (!actorId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = z
      .object({ messageType: z.enum(CHAT_MESSAGE_REPORT_TYPES) })
      .strict()
      .safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const r = await this.mod.adminUnhideMessage(
        actorId,
        parsed.data.messageType,
        id,
      );
      return {
        ok: true,
        data: { messageId: r.messageId, messageType: r.messageType },
      };
    } catch (e) {
      this.handleErr(e);
    }
  }

  // ---- Group lock / unlock / dissolve ----

  @Post('groups/:id/lock')
  @RequireAdmin()
  @RateLimitPolicy('ADMIN_MUTATION')
  async lockGroup(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { userId?: string },
  ): Promise<{
    ok: true;
    data: { groupId: string; lockedAt: string };
  }> {
    const actorId = req.userId;
    if (!actorId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = LockGroupInput.safeParse(body ?? {});
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const r = await this.mod.adminLockGroup(
        actorId,
        id,
        parsed.data.reason ?? null,
      );
      return { ok: true, data: { groupId: r.groupId, lockedAt: r.lockedAt } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('groups/:id/unlock')
  @RequireAdmin()
  @RateLimitPolicy('ADMIN_MUTATION')
  async unlockGroup(
    @Param('id') id: string,
    @Req() req: Request & { userId?: string },
  ): Promise<{ ok: true; data: { groupId: string } }> {
    const actorId = req.userId;
    if (!actorId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const r = await this.mod.adminUnlockGroup(actorId, id);
      return { ok: true, data: { groupId: r.groupId } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('groups/:id/dissolve')
  @RequireAdmin()
  @RateLimitPolicy('ADMIN_MUTATION')
  async dissolveGroup(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request & { userId?: string },
  ): Promise<{
    ok: true;
    data: { groupId: string; dissolvedAt: string };
  }> {
    const actorId = req.userId;
    if (!actorId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = DissolveGroupInput.safeParse(body ?? {});
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const r = await this.mod.adminDissolveGroup(
        actorId,
        id,
        parsed.data.reason ?? null,
      );
      return {
        ok: true,
        data: { groupId: r.groupId, dissolvedAt: r.dissolvedAt },
      };
    } catch (e) {
      this.handleErr(e);
    }
  }

  // ---- helpers ----

  private handleErr(e: unknown): never {
    if (e instanceof ChatModerationError) {
      fail(e.code, statusFor(e.code));
    }
    throw e;
  }
}
