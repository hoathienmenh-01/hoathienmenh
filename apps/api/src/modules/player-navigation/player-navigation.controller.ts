import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  filterNavigationEntries,
  type NavigationEntry,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

/**
 * Phase 41.0 — Navigation registry endpoint.
 *
 * Trả về danh sách navigation entries hợp lệ với role của requester
 * (filter ADMIN/MOD-only ra cho PLAYER). Hỗ trợ `q=` để filter
 * keyword (vi/en) cho Command Palette.
 *
 * Read-only, server-authoritative; KHÔNG mutate.
 */
@Controller('player/navigation')
export class PlayerNavigationController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('entries')
  async entries(
    @Req() req: Request,
    @Query('q') q: string | undefined,
  ): Promise<{ ok: true; data: { entries: NavigationEntry[] } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, banned: true },
    });
    if (!user || user.banned) fail('FORBIDDEN', HttpStatus.FORBIDDEN);
    const role: 'PLAYER' | 'MOD' | 'ADMIN' =
      user.role === 'ADMIN' || user.role === 'MOD' ? user.role : 'PLAYER';
    const entries = filterNavigationEntries(role, q ?? null);
    return { ok: true, data: { entries } };
  }
}
