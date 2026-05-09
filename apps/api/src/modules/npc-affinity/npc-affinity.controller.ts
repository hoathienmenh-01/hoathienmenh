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
import {
  BuyShopItemResult,
  NpcAffinityShopError,
  NpcAffinityShopService,
  NpcShopListResult,
} from './npc-affinity-shop.service';
import {
  ClaimChainResult,
  NpcRelationshipChainError,
  NpcRelationshipChainService,
  NpcRelationshipChainView,
} from './npc-relationship-chain.service';
import type { NpcHiddenUnlockView } from '@xuantoi/shared';

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
const BuyBodySchema = z.object({
  itemKey: ItemKeyParam,
  qty: z.number().int().min(1).max(99).optional(),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST, detail?: string): never {
  throw new HttpException(
    { ok: false, error: { code, message: detail ?? code } },
    status,
  );
}

const ChainKeyParam = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9_]+$/);

@Controller('story/npc-affinity')
export class NpcAffinityController {
  constructor(
    private readonly service: NpcAffinityService,
    private readonly shop: NpcAffinityShopService,
    private readonly chain: NpcRelationshipChainService,
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

  /**
   * Phase 12.10.C — GET /story/npc-affinity/:npcKey/shop
   *
   * Trả list shop entry của NPC + state locked/unlocked + purchased/remaining
   * theo cửa sổ daily/weekly. FE render Shop tab.
   */
  @Get(':npcKey/shop')
  async listShop(
    @Req() req: Request,
    @Param('npcKey') npcKey: string,
  ): Promise<{ ok: true; data: { shop: NpcShopListResult } }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = NpcKeyParam.safeParse(npcKey);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST, 'npcKey');
    const characterId = await this.resolveCharacterId(userId);
    try {
      const shop = await this.shop.listShop(characterId, parsed.data);
      return { ok: true, data: { shop } };
    } catch (e) {
      this.handleShopErr(e);
    }
  }

  /**
   * Phase 12.10.C — POST /story/npc-affinity/:npcKey/shop/buy
   *
   * Body: `{ itemKey: string, qty?: number }`. Server-side check tier +
   * currency + daily/weekly limit; atomic spend currency + grant inventory +
   * ledger reason `NPC_SHOP_BUY`.
   *
   * Errors:
   *   - 400 `INVALID_INPUT` — itemKey/qty malformed.
   *   - 401 `UNAUTHENTICATED`.
   *   - 404 `NO_CHARACTER` / `NPC_AFFINITY_UNKNOWN` / `ITEM_NOT_IN_SHOP`.
   *   - 403 `INSUFFICIENT_AFFINITY_TIER`.
   *   - 400 `INSUFFICIENT_FUNDS` / `NON_STACKABLE_QTY_GT_1` / `INVALID_QTY`.
   *   - 429 `DAILY_LIMIT_REACHED` / `WEEKLY_LIMIT_REACHED`.
   */
  @Post(':npcKey/shop/buy')
  async buyShop(
    @Req() req: Request,
    @Param('npcKey') npcKey: string,
    @Body() body: unknown,
  ): Promise<{
    ok: true;
    data: { shop: NpcShopListResult; receipt: BuyShopItemResult };
  }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const npcParsed = NpcKeyParam.safeParse(npcKey);
    if (!npcParsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST, 'npcKey');
    const bodyParsed = BuyBodySchema.safeParse(body);
    if (!bodyParsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST, 'body');
    const characterId = await this.resolveCharacterId(userId);
    try {
      const receipt = await this.shop.buy({
        characterId,
        npcKey: npcParsed.data,
        itemKey: bodyParsed.data.itemKey,
        qty: bodyParsed.data.qty,
        actorUserId: userId,
      });
      const shop = await this.shop.listShop(characterId, npcParsed.data);
      return { ok: true, data: { shop, receipt } };
    } catch (e) {
      this.handleShopErr(e);
    }
  }

  /**
   * Phase 12.10.C — GET /story/npc-affinity/:npcKey/unlocks
   *
   * Trả list dialogue/quest hidden unlocks của NPC + state unlocked/locked
   * theo tier hiện tại. FE render hint khi locked.
   */
  @Get(':npcKey/unlocks')
  async listUnlocks(
    @Req() req: Request,
    @Param('npcKey') npcKey: string,
  ): Promise<{
    ok: true;
    data: {
      npcKey: string;
      currentTier: string;
      unlocks: NpcHiddenUnlockView[];
    };
  }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = NpcKeyParam.safeParse(npcKey);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST, 'npcKey');
    const characterId = await this.resolveCharacterId(userId);
    try {
      const data = await this.shop.listUnlocks(characterId, parsed.data);
      return { ok: true, data };
    } catch (e) {
      this.handleShopErr(e);
    }
  }

  /**
   * Phase 12.10.D — GET /story/npc-affinity/:npcKey/quest-chain
   *
   * List relationship quest chain của NPC + state per chain (locked/unlocked
   * /completable/claimed) tính từ affinity score + QuestProgress + storyFlags.
   */
  @Get(':npcKey/quest-chain')
  async listQuestChain(
    @Req() req: Request,
    @Param('npcKey') npcKey: string,
  ): Promise<{
    ok: true;
    data: { npcKey: string; chains: NpcRelationshipChainView[] };
  }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const parsed = NpcKeyParam.safeParse(npcKey);
    if (!parsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST, 'npcKey');
    const characterId = await this.resolveCharacterId(userId);
    try {
      const chains = await this.chain.listForCharacter(characterId, parsed.data);
      return { ok: true, data: { npcKey: parsed.data, chains } };
    } catch (e) {
      this.handleChainErr(e);
    }
  }

  /**
   * Phase 12.10.D — POST /story/npc-affinity/:npcKey/quest-chain/:chainKey/claim
   *
   * Claim chain reward (atomic). Phải đáp ứng:
   *   - Chain belong to `:npcKey` + tồn tại trong catalog.
   *   - Tier hiện tại ≥ `requiredAffinityTier`.
   *   - Tất cả quest trong chain đã CLAIMED.
   *   - Chưa claim chain trước đó (storyFlags claim flag missing).
   *
   * Idempotency: JSON-path CAS guard `where: { storyFlags: { path:[flag],
   * equals: '1' } }` chống double-claim race.
   */
  @Post(':npcKey/quest-chain/:chainKey/claim')
  async claimQuestChain(
    @Req() req: Request,
    @Param('npcKey') npcKey: string,
    @Param('chainKey') chainKey: string,
  ): Promise<{
    ok: true;
    data: { receipt: ClaimChainResult; chain: NpcRelationshipChainView };
  }> {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const npcParsed = NpcKeyParam.safeParse(npcKey);
    if (!npcParsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST, 'npcKey');
    const chainParsed = ChainKeyParam.safeParse(chainKey);
    if (!chainParsed.success) fail('INVALID_INPUT', HttpStatus.BAD_REQUEST, 'chainKey');
    const characterId = await this.resolveCharacterId(userId);
    try {
      const receipt = await this.chain.claimChain({
        characterId,
        chainKey: chainParsed.data,
      });
      if (receipt.npcKey !== npcParsed.data) {
        // Defense: chain catalog mismatch with URL — should not happen with
        // catalog-validated keys but guard for stable client UX.
        fail('CHAIN_NPC_MISMATCH', HttpStatus.NOT_FOUND, 'chain not on this NPC');
      }
      const chain = await this.chain.getOne(characterId, chainParsed.data);
      return { ok: true, data: { receipt, chain } };
    } catch (e) {
      this.handleChainErr(e);
    }
  }

  private handleChainErr(e: unknown): never {
    if (e instanceof NpcRelationshipChainError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'CHAIN_UNKNOWN':
          fail(e.code, HttpStatus.NOT_FOUND, e.detail);
        // eslint-disable-next-line no-fallthrough
        case 'CHAIN_LOCKED_TIER':
          fail(e.code, HttpStatus.FORBIDDEN, e.detail);
        // eslint-disable-next-line no-fallthrough
        case 'CHAIN_NOT_COMPLETABLE':
          fail(e.code, HttpStatus.BAD_REQUEST, e.detail);
        // eslint-disable-next-line no-fallthrough
        case 'CHAIN_ALREADY_CLAIMED':
          fail(e.code, HttpStatus.CONFLICT, e.detail);
      }
    }
    throw e;
  }

  private handleShopErr(e: unknown): never {
    if (e instanceof NpcAffinityShopError) {
      switch (e.code) {
        case 'NO_CHARACTER':
        case 'NPC_AFFINITY_UNKNOWN':
        case 'ITEM_NOT_IN_SHOP':
          fail(e.code, HttpStatus.NOT_FOUND, e.detail);
        // eslint-disable-next-line no-fallthrough
        case 'INSUFFICIENT_AFFINITY_TIER':
          fail(e.code, HttpStatus.FORBIDDEN, e.detail);
        // eslint-disable-next-line no-fallthrough
        case 'INSUFFICIENT_FUNDS':
        case 'INVALID_QTY':
        case 'NON_STACKABLE_QTY_GT_1':
          fail(e.code, HttpStatus.BAD_REQUEST, e.detail);
        // eslint-disable-next-line no-fallthrough
        case 'DAILY_LIMIT_REACHED':
        case 'WEEKLY_LIMIT_REACHED':
          fail(e.code, HttpStatus.TOO_MANY_REQUESTS, e.detail);
      }
    }
    if (e instanceof NpcAffinityError) {
      this.handleErr(e);
    }
    throw e;
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
