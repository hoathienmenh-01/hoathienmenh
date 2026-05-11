import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type {
  PrivateChatMessageRow,
  PrivateChatMessagesResponse,
  PrivateChatThreadListResponse,
  PrivateChatThreadRow,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { RateLimitPolicy } from '../security/rate-limit-policy.decorator';
import {
  ChatPrivateError,
  ChatPrivateService,
} from './chat-private.service';

const ACCESS_COOKIE = 'xt_access';

const OpenThreadInput = z.object({
  peerUserId: z.string().min(1).max(64),
});

const SendInput = z.object({
  body: z.string().min(1).max(2000),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

function statusFor(code: ChatPrivateError['code']): number {
  switch (code) {
    case 'NOT_FOUND':
      return HttpStatus.NOT_FOUND;
    case 'NOT_AUTHORIZED':
      return HttpStatus.FORBIDDEN;
    case 'BLOCKED':
      return HttpStatus.FORBIDDEN;
    case 'SELF_NOT_ALLOWED':
    case 'INVALID_INPUT':
      return HttpStatus.BAD_REQUEST;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

@Controller('chat/private')
export class ChatPrivateController {
  constructor(
    private readonly chat: ChatPrivateService,
    private readonly auth: AuthService,
  ) {}

  @Get('threads')
  async listThreads(
    @Req() req: Request,
  ): Promise<{ ok: true; data: PrivateChatThreadListResponse }> {
    const userId = await this.requireUserId(req);
    const threads = await this.chat.listPrivateThreads(userId);
    return { ok: true, data: { threads } };
  }

  @Post('threads')
  @HttpCode(200)
  async openThread(
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { thread: PrivateChatThreadRow } }> {
    const userId = await this.requireUserId(req);
    const parsed = OpenThreadInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const thread = await this.chat.getOrCreatePrivateThread(
        userId,
        parsed.data.peerUserId,
      );
      return { ok: true, data: { thread } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('threads/:threadId/messages')
  async listMessages(
    @Req() req: Request,
    @Param('threadId') threadId: string,
    @Query('limit') limitRaw?: string,
  ): Promise<{ ok: true; data: PrivateChatMessagesResponse }> {
    const userId = await this.requireUserId(req);
    const limit = limitRaw ? Number(limitRaw) : undefined;
    try {
      const messages = await this.chat.listPrivateMessages(
        userId,
        threadId,
        limit,
      );
      return { ok: true, data: { threadId, messages } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('threads/:threadId/messages')
  @HttpCode(200)
  @RateLimitPolicy('CHAT_PRIVATE_SEND')
  async sendMessage(
    @Req() req: Request,
    @Param('threadId') threadId: string,
    @Body() body: unknown,
  ): Promise<{ ok: true; data: { message: PrivateChatMessageRow } }> {
    const userId = await this.requireUserId(req);
    const parsed = SendInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const message = await this.chat.sendPrivateMessage(
        userId,
        threadId,
        parsed.data.body,
      );
      return { ok: true, data: { message } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private async requireUserId(req: Request): Promise<string> {
    const id = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  private handleErr(e: unknown): never {
    if (e instanceof ChatPrivateError) {
      fail(e.code, statusFor(e.code));
    }
    throw e;
  }
}
