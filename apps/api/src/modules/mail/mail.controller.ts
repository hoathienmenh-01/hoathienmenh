import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import {
  MailError,
  MailService,
  type ClaimAllResult,
  type MailView,
} from './mail.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

const IdParam = z.string().min(1).max(80);

@Controller('mail')
export class MailController {
  constructor(
    private readonly mail: MailService,
    private readonly auth: AuthService,
  ) {}

  @Get('me')
  async inbox(
    @Req() req: Request,
  ): Promise<{ ok: true; data: { mails: MailView[] } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const mails = await this.mail.inbox(userId);
      return { ok: true, data: { mails } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('unread-count')
  async unreadCount(
    @Req() req: Request,
  ): Promise<{ ok: true; data: { count: number } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const count = await this.mail.unreadCount(userId);
    return { ok: true, data: { count } };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@Req() req: Request, @Param('id') id: string) {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    if (!IdParam.safeParse(id).success) fail('INVALID_INPUT');
    try {
      const mail = await this.mail.markRead(userId, id);
      return { ok: true, data: { mail } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':id/claim')
  @HttpCode(200)
  async claim(@Req() req: Request, @Param('id') id: string, @Body() _body: unknown) {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    if (!IdParam.safeParse(id).success) fail('INVALID_INPUT');
    try {
      const mail = await this.mail.claim(userId, id);
      return { ok: true, data: { mail } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Phase 31.0 — GET /mail. Alias of `/mail/me` matching the Phase 31
   * spec (also accepts optional `?mailType=` filter).
   */
  @Get()
  async listV2(
    @Req() req: Request,
  ): Promise<{ ok: true; data: { mails: MailView[] } }> {
    return this.inbox(req);
  }

  /**
   * Phase 31.0 — GET /mail/:id. Single mail (404 mask for cross-user).
   */
  @Get(':id')
  async getOne(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ ok: true; data: { mail: MailView } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    if (!IdParam.safeParse(id).success) fail('INVALID_INPUT');
    try {
      const mail = await this.mail.getById(userId, id);
      return { ok: true, data: { mail } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Phase 31.0 — POST /mail/:id/delete (soft delete). Mail bị deleted
   * sẽ KHÔNG xuất hiện trong inbox & KHÔNG đếm vào unread, claim sẽ
   * fail với `MAIL_DELETED`.
   */
  @Post(':id/delete')
  @HttpCode(200)
  async deleteMail(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() _body: unknown,
  ): Promise<{ ok: true; data: { mail: MailView } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    if (!IdParam.safeParse(id).success) fail('INVALID_INPUT');
    try {
      const mail = await this.mail.softDelete(userId, id);
      return { ok: true, data: { mail } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  /**
   * Phase 31.0 — POST /mail/claim-all. Idempotent batch claim. Returns
   * aggregate `{ claimedCount, totalLinhThach, totalTienNgoc, totalExp,
   * skippedCount }`. Spam request KHÔNG duplicate reward (per-mail CAS).
   */
  @Post('claim-all')
  @HttpCode(200)
  async claimAll(
    @Req() req: Request,
    @Body() _body: unknown,
  ): Promise<{ ok: true; data: ClaimAllResult }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const data = await this.mail.claimAll(userId);
      return { ok: true, data };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof MailError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'MAIL_NOT_FOUND':
        case 'RECIPIENT_NOT_FOUND':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'ALREADY_CLAIMED':
        case 'MAIL_EXPIRED':
        case 'MAIL_DELETED':
        case 'NO_REWARD':
          fail(e.code, HttpStatus.CONFLICT);
        // eslint-disable-next-line no-fallthrough
        case 'INVALID_INPUT':
          fail(e.code, HttpStatus.BAD_REQUEST);
      }
    }
    throw e;
  }
}
