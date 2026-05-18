/**
 * Phase 29.0 — PvP player controller (non-arena modes).
 *
 * Endpoint:
 *   - GET  /pvp/defense              → load defense profile (return null nếu chưa có).
 *   - POST /pvp/defense              → upsert defense (rebuild snapshot từ current stats).
 *   - POST /pvp/challenge            → challenge mode DUEL / FRIENDLY_SPARRING.
 *   - GET  /pvp/battle-logs          → list battle log (filter mode + cursor).
 *   - GET  /pvp/battle-logs/:id      → detail 1 battle log.
 *   - GET  /pvp/policy               → expose default balance policy (read-only).
 *
 * Mode ARENA tiếp tục dùng `/arena/*` (Phase 14.1.B/C). SECT_WAR /
 * TERRITORY_WAR / EVENT_PVP gọi qua service layer của module tương ứng,
 * KHÔNG expose POST /pvp/challenge trực tiếp.
 */
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
import {
  PVP_DEFAULT_BALANCE_POLICY,
  isPvpMode,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import { PvpDefenseService, PvpDefenseError } from './defense.service';
import { PvpBattleService, PvpBattleError } from './battle.service';
import { PvpSnapshotError } from './snapshot.service';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

const DefenseUpsertZ = z
  .object({
    label: z.string().max(60).nullable().optional(),
  })
  .strict();

const ChallengeZ = z
  .object({
    defenderCharacterId: z.string().min(1),
    mode: z.enum(['DUEL', 'FRIENDLY_SPARRING']),
    idempotencyKey: z.string().min(1).max(100).optional(),
  })
  .strict();

@Controller('pvp')
export class PvpPlayerController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly defense: PvpDefenseService,
    private readonly battle: PvpBattleService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  private async requireCharacter(req: Request): Promise<string> {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const c = await this.prisma.character.findUnique({
      where: { userId: userId as string },
      select: { id: true },
    });
    if (!c) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    return c!.id;
  }

  @Get('policy')
  policy() {
    return { ok: true, data: PVP_DEFAULT_BALANCE_POLICY };
  }

  @Get('defense')
  async getDefense(@Req() req: Request) {
    const characterId = await this.requireCharacter(req);
    const profile = await this.defense.get(characterId);
    return { ok: true, data: profile };
  }

  @Post('defense')
  @HttpCode(HttpStatus.OK)
  async upsertDefense(@Req() req: Request, @Body() body: unknown) {
    const characterId = await this.requireCharacter(req);
    const parsed = DefenseUpsertZ.safeParse(body);
    if (!parsed.success) fail('PVP_DEFENSE_PAYLOAD_INVALID');
    try {
      const profile = await this.defense.upsert(
        characterId,
        parsed.data.label ?? null,
      );
      return { ok: true, data: profile };
    } catch (err) {
      if (err instanceof PvpDefenseError) fail(err.code);
      if (err instanceof PvpSnapshotError) fail(err.code);
      throw err;
    }
  }

  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  async challenge(@Req() req: Request, @Body() body: unknown) {
    const attackerCharacterId = await this.requireCharacter(req);
    await this.featureFlags.requireEnabled('PVP_ENABLED');
    const parsed = ChallengeZ.safeParse(body);
    if (!parsed.success) fail('PVP_CHALLENGE_PAYLOAD_INVALID');
    try {
      const result = await this.battle.challenge({
        attackerCharacterId,
        defenderCharacterId: parsed.data.defenderCharacterId,
        mode: parsed.data.mode,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      return { ok: true, data: result };
    } catch (err) {
      if (err instanceof PvpBattleError) {
        fail(
          err.code,
          err.code === 'PVP_TARGET_NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.BAD_REQUEST,
        );
      }
      if (err instanceof PvpSnapshotError) {
        fail(err.code, HttpStatus.BAD_REQUEST);
      }
      throw err;
    }
  }

  @Get('battle-logs')
  async listLogs(
    @Req() req: Request,
    @Query('mode') mode?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const characterId = await this.requireCharacter(req);
    const parsedMode = mode && isPvpMode(mode) ? mode : undefined;
    const logs = await this.battle.listLogs(characterId, {
      mode: parsedMode,
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor: cursor,
    });
    return { ok: true, data: { logs, characterId } };
  }

  @Get('battle-logs/:id')
  async getLog(@Req() req: Request, @Param('id') id: string) {
    await this.requireCharacter(req);
    try {
      const row = await this.battle.getById(id);
      return { ok: true, data: row };
    } catch (err) {
      if (err instanceof PvpBattleError) {
        fail(err.code, HttpStatus.NOT_FOUND);
      }
      throw err;
    }
  }
}
