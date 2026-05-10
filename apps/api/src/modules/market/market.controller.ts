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
import { MarketService, MARKET_FEE_PCT } from './market.service';
import type { ListingView } from './market.service';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';

const ACCESS_COOKIE = 'xt_access';

const PostInput = z.object({
  inventoryItemId: z.string().min(1),
  qty: z.number().int().positive(),
  pricePerUnit: z
    .union([z.string().regex(/^[0-9]+$/), z.number().int().positive()])
    .transform((v) => BigInt(v)),
});

const KindEnum = z.enum([
  'WEAPON',
  'ARMOR',
  'PILL_HP',
  'PILL_MP',
  'PILL_EXP',
  'ORE',
  'MISC',
]);

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

@Controller('market')
export class MarketController {
  constructor(
    private readonly market: MarketService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  private async requireCharacter(req: Request) {
    const userId = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!userId) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    const c = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!c) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    return { userId, characterId: c.id };
  }

  @Get('listings')
  async listings(
    @Req() req: Request,
    @Query('kind') kind?: string,
  ): Promise<{ ok: true; data: { listings: ListingView[]; feePct: number } }> {
    const { characterId } = await this.requireCharacter(req);
    const parsedKind = kind ? KindEnum.safeParse(kind) : null;
    const listings = await this.market.listActive(
      characterId,
      parsedKind?.success ? parsedKind.data : undefined,
    );
    return { ok: true, data: { listings, feePct: MARKET_FEE_PCT } };
  }

  @Get('mine')
  async mine(
    @Req() req: Request,
  ): Promise<{ ok: true; data: { listings: ListingView[] } }> {
    const { characterId } = await this.requireCharacter(req);
    const listings = await this.market.listMine(characterId);
    return { ok: true, data: { listings } };
  }

  @Post('post')
  @HttpCode(200)
  async post(@Req() req: Request, @Body() body: unknown) {
    // Phase 15.4 — runtime gate. Tắt post-listing khi cần freeze
    // economy (vd. exploit / dup). Cancel + listings vẫn hoạt động
    // (read-only) để user thu hồi listing của mình.
    await this.featureFlags.requireEnabled('MARKET_ENABLED');
    const { userId } = await this.requireCharacter(req);
    const parsed = PostInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const listing = await this.market.post(userId, parsed.data);
      return { ok: true, data: { listing } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':id/buy')
  @HttpCode(200)
  async buy(@Req() req: Request, @Param('id') id: string) {
    // Phase 15.4 — runtime gate. Tắt buy khi cần freeze trải
    // nghiệm mua qua sandbox dup. Cancel lối ra vẫn cho phép.
    await this.featureFlags.requireEnabled('MARKET_ENABLED');
    const { userId } = await this.requireCharacter(req);
    try {
      const listing = await this.market.buy(userId, id);
      return { ok: true, data: { listing } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Req() req: Request, @Param('id') id: string) {
    const { userId } = await this.requireCharacter(req);
    try {
      const listing = await this.market.cancel(userId, id);
      return { ok: true, data: { listing } };
    } catch (e) {
      this.handleErr(e);
    }
  }

  private handleErr(e: unknown): never {
    const code = (e as { code?: string })?.code;
    switch (code) {
      case 'NO_CHARACTER':
      case 'INVENTORY_ITEM_NOT_FOUND':
      case 'LISTING_NOT_FOUND':
      case 'ITEM_NOT_FOUND':
        fail(code, HttpStatus.NOT_FOUND);
      // eslint-disable-next-line no-fallthrough
      case 'ITEM_EQUIPPED':
      case 'INVALID_QTY':
      case 'INVALID_PRICE':
      case 'PRICE_TOO_LOW':
      case 'PRICE_TOO_HIGH':
      case 'LISTING_INACTIVE':
      case 'CANNOT_BUY_OWN':
      case 'NOT_OWNER':
      case 'INSUFFICIENT_LINH_THACH':
        fail(code, HttpStatus.CONFLICT);
      // eslint-disable-next-line no-fallthrough
      default:
        throw e;
    }
  }
}
