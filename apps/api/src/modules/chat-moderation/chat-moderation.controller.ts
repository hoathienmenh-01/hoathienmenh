import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  CHAT_MESSAGE_REPORT_REASONS,
  CHAT_MESSAGE_REPORT_TYPES,
  CHAT_MODERATION_LIMITS,
  type ChatMessageReportRow,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import {
  ChatModerationError,
  ChatModerationService,
} from './chat-moderation.service';

const ACCESS_COOKIE = 'xt_access';

const SubmitReportInput = z
  .object({
    messageType: z.enum(CHAT_MESSAGE_REPORT_TYPES),
    privateMessageId: z.string().min(1).max(64).optional(),
    groupMessageId: z.string().min(1).max(64).optional(),
    reason: z.enum(CHAT_MESSAGE_REPORT_REASONS),
    // Server-side cap = REPORT_DETAILS_MAX = 500. Cho phép FE gửi text
    // dài hơn, service sẽ sanitize + truncate.
    detailsText: z.string().max(4000).optional().nullable(),
  })
  .strict();

const ListMineQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

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

/**
 * Phase 19.2 — User-facing chat moderation endpoints.
 *
 * `POST /chat/reports`           — report private/group message.
 *                                  Rate-limited `CHAT_REPORT_SUBMIT`.
 * `GET  /chat/reports/mine`      — list user's own submitted reports.
 *
 * Auth: cần xt_access cookie. Player + Mod + Admin đều gọi được. Không
 * sử dụng AdminGuard (đây là endpoint cho user thường).
 */
@Controller('chat/reports')
export class ChatModerationController {
  constructor(
    private readonly mod: ChatModerationService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  @HttpCode(200)
  @RateLimitPolicy('CHAT_REPORT_SUBMIT')
  async submitReport(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { report: ChatMessageReportRow } }> {
    const userId = await this.requireUserId(req);
    const parsed = SubmitReportInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    // XOR rule: messageType=PRIVATE → privateMessageId; GROUP → groupMessageId.
    if (
      parsed.data.messageType === 'PRIVATE' &&
      !parsed.data.privateMessageId
    ) {
      fail('INVALID_INPUT');
    }
    if (
      parsed.data.messageType === 'GROUP' &&
      !parsed.data.groupMessageId
    ) {
      fail('INVALID_INPUT');
    }
    try {
      const report = await this.mod.submitReport(userId, {
        messageType: parsed.data.messageType,
        privateMessageId: parsed.data.privateMessageId ?? null,
        groupMessageId: parsed.data.groupMessageId ?? null,
        reason: parsed.data.reason,
        detailsText: parsed.data.detailsText ?? null,
      });
      return { ok: true, data: { report } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('mine')
  async listMine(
    @Req() req: Request,
    @Query() query: unknown,
  ): Promise<{ ok: true; data: { reports: ChatMessageReportRow[] } }> {
    const userId = await this.requireUserId(req);
    const parsed = ListMineQuery.safeParse(query ?? {});
    if (!parsed.success) fail('INVALID_INPUT');
    const reports = await this.mod.listMyReports(
      userId,
      parsed.data.limit ?? 50,
    );
    return { ok: true, data: { reports } };
  }

  // Misc client-helper: expose enum/caps cho FE (1 GET, public-read).
  @Get('catalog')
  async catalog(): Promise<{
    ok: true;
    data: {
      reasons: typeof CHAT_MESSAGE_REPORT_REASONS;
      types: typeof CHAT_MESSAGE_REPORT_TYPES;
      detailsMax: number;
    };
  }> {
    return {
      ok: true,
      data: {
        reasons: CHAT_MESSAGE_REPORT_REASONS,
        types: CHAT_MESSAGE_REPORT_TYPES,
        detailsMax: CHAT_MODERATION_LIMITS.REPORT_DETAILS_MAX,
      },
    };
  }

  // --- helpers ---

  private async requireUserId(req: Request): Promise<string> {
    const token =
      (req as Request & { cookies?: Record<string, string> }).cookies?.[
        ACCESS_COOKIE
      ];
    const userId = await this.auth.userIdFromAccess(token);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return userId;
  }

  private handleErr(e: unknown): never {
    if (e instanceof ChatModerationError) {
      fail(e.code, statusFor(e.code));
    }
    throw e;
  }
}
