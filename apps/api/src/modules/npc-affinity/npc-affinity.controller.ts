import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import {
  GiftNpcResult,
  NPC_AFFINITY_CAPS,
  NpcAffinityError,
  NpcAffinityService,
  NpcAffinityView,
} from './npc-affinity.service';

/**
 * Phase 12.10.A — NPC Affinity HTTP routes:
 *
 *   - `GET  /story/npc-affinity`                  → list affinity của character.
 *   - `GET  /story/npc-affinity/:npcKey`          → get single affinity (lazy fallback initialScore).
 *   - `POST /story/npc-affinity/:npcKey/gift`     → tặng quà NPC (Phase 12.10.B).
 *
 * Auth: cookie `xt_access` (mirror StoryDialogueController). Gift POST có
 * server-side daily limit (catalog `NPC_GIFT_PREFERENCES[npcKey].dailyLimit`)
 * + atomic decrement + ledger — KHÔNG cần extra rate limit ngoài.
 */

const ACCESS_COOKIE = 'xt_access';
const NpcKeyParam = z.string().min(1).max(80).regex(/^npc_[a-z0-9_]+$/);
const ItemKeyParam = z.string().min(1).max(80).regex(/^[a-z0-9_]+$/);
const GiftBodySchema = z.object({ itemKey: ItemKeyParam });

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

  /**
   * Phase 12.10.B — POST /story/npc-affinity/:npcKey/gift
   *
   * Body: `{ itemKey: string }`. Server consume 1 stack `itemKey` từ inventory,
   * grant affinity theo catalog `NPC_GIFT_PREFERENCES`, ghi
   * `CharacterNpcGiftLog` (audit + daily limit). Trả `affinity` view mới (FE
   * dùng update store ngay) + `gift` summary (delta + remaining).
   *
   * Errors (HTTP 4xx):
   *   - 400 `INVALID_INPUT` — itemKey malformed.
   *   - 401 `UNAUTHENTICATED`.
   *   - 404 `NO_CHARACTER` / `NPC_GIFT_NOT_CONFIGURED` — npcKey không có gift catalog.
   *   - 400 `ITEM_NOT_ACCEPTED` — itemKey không thuộc accepted list.
   *   - 400 `ITEM_NOT_IN_INVENTORY` — character không có row qty>=1 (chưa equipped).
   *   - 429 `DAILY_LIMIT_REACHED` — đã hết daily limit cho NPC này.
   */
  @Post(':npcKey/gift')
  async gift(
    @Req() req: Request,
    @Param('npcKey') npcKey: string,
    @Body() body: unknown,
  ): Promise<{
    ok: true;
    data: { affinity: NpcAffinityView; gift: GiftNpcResult };
  }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const npcParsed = NpcKeyParam.safeParse(npcKey);
    if (!npcParsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST, 'npcKey');
    const bodyParsed = GiftBodySchema.safeParse(body);
    if (!bodyParsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST, 'itemKey');
    const characterId = await this.resolveCharacterId(userId);
    try {
      const gift = await this.service.giftNpc({
        characterId,
        npcKey: npcParsed.data,
        itemKey: bodyParsed.data.itemKey,
      });
      const affinity = await this.service.getForNpc(characterId, npcParsed.data);
      return { ok: true, data: { affinity, gift } };
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
        case 'NPC_GIFT_NOT_CONFIGURED':
          fail(e.code, HttpStatus.NOT_FOUND, e.detail);
        // eslint-disable-next-line no-fallthrough
        case 'INVALID_DELTA':
        case 'CAP_EXCEEDED':
        case 'ITEM_NOT_ACCEPTED':
        case 'ITEM_NOT_IN_INVENTORY':
          fail(e.code, HttpStatus.BAD_REQUEST, e.detail);
        // eslint-disable-next-line no-fallthrough
        case 'DAILY_LIMIT_REACHED':
          fail(e.code, HttpStatus.TOO_MANY_REQUESTS, e.detail);
      }
    }
    throw e;
  }
}
