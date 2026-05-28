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
import { realmByKey } from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import { EventService } from './event.service';
import { BracketService } from './bracket.service';
import { EventMissionService } from './event-mission.service';
import { EventShopService } from './event-shop.service';
import { EventRankingService } from './event-ranking.service';
import { EventPersonalMilestoneService } from './event-personal-milestone.service';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

const PurchaseInput = z
  .object({
    shopItemKey: z.string().min(1),
    qty: z.number().int().min(1).max(99).optional(),
  })
  .strict();

const MissionClaimInput = z
  .object({
    missionKey: z.string().min(1),
  })
  .strict();

@Controller('events')
export class EventBuilderPlayerController {
  constructor(
    private readonly events: EventService,
    private readonly brackets: BracketService,
    private readonly missions: EventMissionService,
    private readonly shops: EventShopService,
    private readonly rankings: EventRankingService,
    private readonly personal: EventPersonalMilestoneService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  private async requireCharacter(req: Request): Promise<{
    userId: string;
    characterId: string;
    realmOrder: number;
  }> {
    const userId = await this.auth.userIdFromAccess(
      req.cookies?.[ACCESS_COOKIE],
    );
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const c = await this.prisma.character.findUnique({
      where: { userId: userId as string },
      select: { id: true, realmKey: true },
    });
    if (!c) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    const realm = realmByKey(c!.realmKey);
    return {
      userId: userId!,
      characterId: c!.id,
      realmOrder: realm?.order ?? 0,
    };
  }

  // ----- List + detail (public-safe) -----

  @Get()
  async listEvents(@Req() req: Request) {
    await this.featureFlags.requireEnabled('EVENT_BUILDER_ENABLED');
    const { characterId, realmOrder } = await this.requireCharacter(req);
    const playerTier = Math.min(9, Math.max(1, Math.floor(realmOrder / 3) + 1));
    const data = await this.events.listPublicForPlayer({
      bracketKey: null,
      bracketTier: null,
      playerTier,
    });
    return { ok: true, data: { events: data, characterId } };
  }

  @Get(':key')
  async getEvent(@Req() req: Request, @Param('key') key: string) {
    const { characterId, realmOrder } = await this.requireCharacter(req);
    const e = await this.events.findByKey(key);
    if (!e || !e.enabled) fail('EVENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    const brackets = await this.brackets.listForEvent(key);
    const policy = await this.brackets.getPolicy(key);
    const playerTier = Math.min(9, Math.max(1, Math.floor(realmOrder / 3) + 1));
    const playerCtx = await this.brackets.computePlayerContext(
      key,
      realmOrder,
      playerTier,
    );
    return {
      ok: true,
      data: {
        event: e,
        brackets,
        policy,
        playerCtx,
        characterId,
      },
    };
  }

  // ----- Missions -----

  @Get(':key/missions')
  async listMissions(@Req() req: Request, @Param('key') eventKey: string) {
    const { characterId } = await this.requireCharacter(req);
    const defs = await this.missions.list(eventKey);
    const progress = await this.missions.listProgressForCharacter(
      eventKey,
      characterId,
    );
    return { ok: true, data: { definitions: defs, progress } };
  }

  @Post(':key/missions/claim')
  @HttpCode(200)
  async claimMission(
    @Req() req: Request,
    @Param('key') _eventKey: string,
    @Body() body: unknown,
  ) {
    const { characterId } = await this.requireCharacter(req);
    const parsed = MissionClaimInput.safeParse(body);
    if (!parsed.success) fail('PAYLOAD_INVALID');
    const data = await this.missions.claim(
      parsed.data.missionKey,
      characterId,
    );
    return { ok: true, data };
  }

  // ----- Shop -----

  @Get(':key/shops')
  async listShops(@Req() req: Request, @Param('key') eventKey: string) {
    await this.requireCharacter(req);
    const shops = await this.shops.listShops(eventKey);
    return { ok: true, data: { shops } };
  }

  @Get('shops/:shopKey/items')
  async listShopItems(
    @Req() req: Request,
    @Param('shopKey') shopKey: string,
  ) {
    await this.requireCharacter(req);
    const items = await this.shops.listShopItems(shopKey);
    return { ok: true, data: { items } };
  }

  @Post('shops/purchase')
  @HttpCode(200)
  async purchase(@Req() req: Request, @Body() body: unknown) {
    const { characterId, realmOrder } = await this.requireCharacter(req);
    const parsed = PurchaseInput.safeParse(body);
    if (!parsed.success) fail('PAYLOAD_INVALID');
    // Resolve bracket via shopItem -> shop -> event lookup.
    const item = await this.prisma.eventShopItemDef.findUnique({
      where: { key: parsed.data.shopItemKey },
      include: { shop: true },
    });
    if (!item) fail('SHOP_ITEM_NOT_FOUND', HttpStatus.NOT_FOUND);
    const ctx = await this.brackets.computePlayerContext(
      item!.shop.eventKey,
      realmOrder,
      Math.min(9, Math.max(1, Math.floor(realmOrder / 3) + 1)),
    );
    const result = await this.shops.purchase({
      shopItemKey: parsed.data.shopItemKey,
      characterId,
      qty: parsed.data.qty,
      playerRealmOrder: realmOrder,
      bracketKey: ctx.bracket?.key ?? null,
    });
    return { ok: true, data: result };
  }

  // ----- Ranking -----

  @Get('rankings/:rankingKey/leaderboard')
  async leaderboard(
    @Req() req: Request,
    @Param('rankingKey') rankingKey: string,
    @Query('bracketKey') bracketKey?: string,
  ) {
    await this.requireCharacter(req);
    const entries = await this.rankings.leaderboard(rankingKey, {
      bracketKey: bracketKey ?? undefined,
      limit: 100,
    });
    return { ok: true, data: { entries } };
  }

  // ----- Personal -----

  @Get('personal/list')
  async listPersonal(@Req() req: Request) {
    const { characterId } = await this.requireCharacter(req);
    const rows = await this.personal.listForCharacter(characterId);
    return { ok: true, data: { entries: rows } };
  }

  @Post('personal/:rowId/claim')
  @HttpCode(200)
  async claimPersonal(@Req() req: Request, @Param('rowId') rowId: string) {
    const { characterId } = await this.requireCharacter(req);
    const data = await this.personal.claim(rowId, characterId);
    return { ok: true, data };
  }
}
