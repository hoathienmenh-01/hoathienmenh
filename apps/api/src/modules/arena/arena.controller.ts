/**
 * Phase 14.1.B — Async Arena REST controller.
 *
 * Endpoints:
 *   - GET  /arena/profile             — lazy-create + return ArenaProfileSummary.
 *   - GET  /arena/opponents?limit=N   — list opponents.
 *   - POST /arena/matches             — body { defenderCharacterId, seed? }.
 *   - GET  /arena/matches/history?limit=N&side=all|attacker|defender.
 *
 * Auth: cookie session (mirror combat.controller.ts pattern).
 *
 * Errors → HTTP:
 *   - UNAUTHENTICATED       → 401
 *   - NO_CHARACTER          → 404
 *   - DEFENDER_NOT_FOUND    → 404
 *   - CANNOT_ATTACK_SELF    → 400
 *   - INVALID_INPUT         → 400
 *   - DAILY_LIMIT_REACHED   → 429
 */
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
import { ArenaError, ArenaService } from './arena.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';

const ACCESS_COOKIE = 'xt_access';

const CreateMatchInput = z.object({
  defenderCharacterId: z.string().min(1),
  seed: z.number().int().optional(),
});

const ListOpponentsQuery = z.object({
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .pipe(z.number().int().min(1).max(20).optional()),
});

const HistoryQuery = z.object({
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .pipe(z.number().int().min(1).max(100).optional()),
  side: z.enum(['all', 'attacker', 'defender']).optional(),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('arena')
export class ArenaController {
  constructor(
    private readonly arena: ArenaService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  private async requireUserId(req: Request): Promise<string> {
    const id = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  private async requireCharacterId(userId: string): Promise<string> {
    const c = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!c) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    return c.id;
  }

  @Get('profile')
  async profile(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    const characterId = await this.requireCharacterId(userId);
    try {
      const profile = await this.arena.getOrCreateProfile(characterId);
      return { ok: true, data: { profile } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('opponents')
  async opponents(@Req() req: Request, @Query() query: unknown) {
    const userId = await this.requireUserId(req);
    const characterId = await this.requireCharacterId(userId);
    const parsed = ListOpponentsQuery.safeParse(query ?? {});
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const opponents = await this.arena.listOpponents(characterId, {
        limit: parsed.data.limit,
      });
      return { ok: true, data: { opponents } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('matches')
  @HttpCode(200)
  async createMatch(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const characterId = await this.requireCharacterId(userId);
    const parsed = CreateMatchInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const match = await this.arena.createMatch(characterId, parsed.data);
      return { ok: true, data: { match } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get('matches/history')
  async history(@Req() req: Request, @Query() query: unknown) {
    const userId = await this.requireUserId(req);
    const characterId = await this.requireCharacterId(userId);
    const parsed = HistoryQuery.safeParse(query ?? {});
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const matches = await this.arena.getMatchHistory(characterId, {
        limit: parsed.data.limit,
        side: parsed.data.side,
      });
      return { ok: true, data: { matches } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof ArenaError) {
      const code = e.code;
      if (code === 'NO_CHARACTER' || code === 'DEFENDER_NOT_FOUND') {
        fail(code, HttpStatus.NOT_FOUND);
      }
      if (code === 'CANNOT_ATTACK_SELF' || code === 'INVALID_INPUT') {
        fail(code, HttpStatus.BAD_REQUEST);
      }
      if (code === 'DAILY_LIMIT_REACHED') {
        fail(code, HttpStatus.TOO_MANY_REQUESTS);
      }
      fail(code, HttpStatus.BAD_REQUEST);
    }
    throw e;
  }
}
