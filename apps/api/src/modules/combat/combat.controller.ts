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
import { CombatService } from './combat.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';

const ACCESS_COOKIE = 'xt_access';

const StartInput = z.object({ dungeonKey: z.string().min(1) });
const ActionInput = z.object({ skillKey: z.string().optional() });

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('combat')
export class CombatController {
  constructor(
    private readonly combat: CombatService,
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

  @Get('dungeons')
  async dungeons() {
    return { ok: true, data: { dungeons: this.combat.listDungeons() } };
  }

  @Get('encounter/active')
  async active(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    const characterId = await this.requireCharacterId(userId);
    const encounter = await this.combat.getActive(characterId);
    return { ok: true, data: { encounter } };
  }

  @Post('encounter/start')
  @HttpCode(200)
  async start(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const parsed = StartInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const encounter = await this.combat.start(userId, parsed.data.dungeonKey);
      return { ok: true, data: { encounter } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('encounter/:id/action')
  @HttpCode(200)
  async action(@Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const parsed = ActionInput.safeParse(body ?? {});
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const encounter = await this.combat.action(userId, id, parsed.data);
      return { ok: true, data: { encounter } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post('encounter/:id/abandon')
  @HttpCode(200)
  async abandon(@Req() req: Request, @Param('id') id: string) {
    const userId = await this.requireUserId(req);
    try {
      const encounter = await this.combat.abandon(userId, id);
      return { ok: true, data: { encounter } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    const code = (e as { code?: string })?.code;
    switch (code) {
      case 'NO_CHARACTER':
        fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
      // eslint-disable-next-line no-fallthrough
      case 'DUNGEON_NOT_FOUND':
      case 'ENCOUNTER_NOT_FOUND':
        fail(code, HttpStatus.NOT_FOUND);
      // eslint-disable-next-line no-fallthrough
      case 'STAMINA_LOW':
      case 'MP_LOW':
      case 'SKILL_NOT_USABLE':
      case 'ALREADY_IN_FIGHT':
      case 'ENCOUNTER_ENDED':
      case 'CONTROLLED':
      case 'ACTIVITY_IN_PROGRESS':
      case 'TALENT_NOT_LEARNED':
      case 'TALENT_NOT_ACTIVE':
      case 'TALENT_ON_COOLDOWN':
      case 'DUNGEON_DAILY_LIMIT_REACHED':
        fail(code, HttpStatus.CONFLICT);
      // eslint-disable-next-line no-fallthrough
      default:
        throw e;
    }
  }
}
