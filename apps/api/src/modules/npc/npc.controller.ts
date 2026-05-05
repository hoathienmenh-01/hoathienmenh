import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import {
  NpcDialogueView,
  NpcError,
  NpcService,
  NpcView,
} from './npc.service';

const ACCESS_COOKIE = 'xt_access';

const NpcKeyParam = z.string().min(1).max(80).regex(/^npc_[a-z0-9_]+$/);

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('npcs')
export class NpcController {
  constructor(
    private readonly npcs: NpcService,
    private readonly auth: AuthService,
  ) {}

  @Get('me')
  async me(
    @Req() req: Request,
  ): Promise<{ ok: true; data: { npcs: NpcView[] } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    try {
      const npcs = await this.npcs.listForUser(userId);
      return { ok: true, data: { npcs } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get(':npcKey/dialogue')
  async dialogue(
    @Req() req: Request,
    @Param('npcKey') npcKey: string,
  ): Promise<{ ok: true; data: { dialogue: NpcDialogueView } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = NpcKeyParam.safeParse(npcKey);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const dialogue = await this.npcs.getDialogueForNpc(userId, parsed.data);
      return { ok: true, data: { dialogue } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    if (e instanceof NpcError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'NPC_UNKNOWN':
        case 'NO_DIALOGUE':
          fail(e.code, HttpStatus.NOT_FOUND);
        // eslint-disable-next-line no-fallthrough
        case 'NPC_LOCKED_REALM':
          fail(e.code, HttpStatus.FORBIDDEN);
      }
    }
    throw e;
  }
}
