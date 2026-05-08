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
import { PrismaService } from '../../common/prisma.service';
import {
  NPC_AFFINITY_CAPS,
  NpcAffinityError,
  NpcAffinityService,
  NpcAffinityView,
} from './npc-affinity.service';

/**
 * Phase 12.10.A — NPC Affinity HTTP routes:
 *
 *   - `GET  /story/npc-affinity`            → list affinity của character.
 *   - `GET  /story/npc-affinity/:npcKey`    → get single affinity (lazy fallback initialScore).
 *
 * Auth: cookie `xt_access` (mirror StoryDialogueController). Read-only —
 * không cần rate limit. Mutate path đi qua dialogue choice / quest claim
 * (server-authoritative — không có FE-trigger affinity grant).
 */

const ACCESS_COOKIE = 'xt_access';
const NpcKeyParam = z.string().min(1).max(80).regex(/^npc_[a-z0-9_]+$/);

function fail(code: string, status = HttpStatus.BAD_REQUEST, detail?: string): never {
  throw new HttpException(
    { ok: false, error: { code, message: detail ?? code } },
    status,
  );
}

@Controller('story/npc-affinity')
export class NpcAffinityController {
  constructor(
    private readonly service: NpcAffinityService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
  ): Promise<{
    ok: true;
    data: { affinities: NpcAffinityView[]; caps: typeof NPC_AFFINITY_CAPS };
  }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const characterId = await this.resolveCharacterId(userId);
    try {
      const affinities = await this.service.listForCharacter(characterId);
      return { ok: true, data: { affinities, caps: NPC_AFFINITY_CAPS } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Get(':npcKey')
  async getOne(
    @Req() req: Request,
    @Param('npcKey') npcKey: string,
  ): Promise<{ ok: true; data: { affinity: NpcAffinityView } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = NpcKeyParam.safeParse(npcKey);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST, 'npcKey');
    const characterId = await this.resolveCharacterId(userId);
    try {
      const affinity = await this.service.getForNpc(characterId, parsed.data);
      return { ok: true, data: { affinity } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private async resolveCharacterId(userId: string): Promise<string> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!char) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    return char.id;
  }

  private handleErr(e: unknown): never {
    if (e instanceof NpcAffinityError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'NPC_UNKNOWN':
        case 'NPC_AFFINITY_UNKNOWN':
          fail(e.code, HttpStatus.NOT_FOUND, e.detail);
        // eslint-disable-next-line no-fallthrough
        case 'INVALID_DELTA':
        case 'CAP_EXCEEDED':
          fail(e.code, HttpStatus.BAD_REQUEST, e.detail);
      }
    }
    throw e;
  }
}
