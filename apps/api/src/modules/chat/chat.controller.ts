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
import { ChatError, ChatService } from './chat.service';
import type { ChatMessageView } from './chat.service';
import { AuthService } from '../auth/auth.service';

const ACCESS_COOKIE = 'xt_access';

const SendInput = z.object({
  text: z.string().min(1).max(200),
});

const ChannelEnum = z.enum(['WORLD', 'SECT']);

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly auth: AuthService,
  ) {}

  @Get('history')
  async history(
    @Req() req: Request,
    @Query('channel') channelRaw: string,
  ): Promise<{ ok: true; data: { messages: ChatMessageView[] } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const ch = ChannelEnum.safeParse(channelRaw);
    if (!ch.success) fail('INVALID_INPUT');
    try {
      const messages =
        ch.data === 'WORLD'
          ? await this.chat.historyWorld()
          : await this.chat.historySect(userId);
      return { ok: true, data: { messages } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('world')
  @HttpCode(200)
  async world(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = SendInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const message = await this.chat.sendWorld(userId, parsed.data.text);
      return { ok: true, data: { message } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('sect')
  @HttpCode(200)
  async sect(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = SendInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const message = await this.chat.sendSect(userId, parsed.data.text);
      return { ok: true, data: { message } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof ChatError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'NO_SECT':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'EMPTY_TEXT':
        case 'TEXT_TOO_LONG':
          fail(e.code, HttpStatus.BAD_REQUEST);
        // eslint-disable-next-line no-fallthrough
        case 'RATE_LIMITED':
          fail(e.code, HttpStatus.TOO_MANY_REQUESTS);
        // eslint-disable-next-line no-fallthrough
        case 'MUTED':
          fail(e.code, HttpStatus.FORBIDDEN);
      }
    }
    throw e;
  }
}
