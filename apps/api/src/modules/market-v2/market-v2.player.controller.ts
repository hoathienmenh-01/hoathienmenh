/**
 * Phase 30.0 — Market V2 player controller.
 *
 * Endpoint:
 *   - GET  /market-v2/auctions              → list active auctions.
 *   - GET  /market-v2/auctions/:id          → detail.
 *   - POST /market-v2/auctions              → create auction.
 *   - POST /market-v2/auctions/:id/bid      → place bid.
 *   - POST /market-v2/auctions/:id/cancel   → seller cancel (chỉ khi
 *                                              chưa có bid).
 *   - GET  /market-v2/claim-box             → list claim box (PENDING).
 *   - POST /market-v2/claim-box/:id/claim   → claim.
 *   - GET  /market-v2/prices/:itemKey       → price snapshot.
 *
 * Auth qua AuthService (xt_access cookie). Validation qua zod + shared
 * validator. KHÔNG bypass ledger/inventory.
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

import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../../common/prisma.service';
import { AuctionService, AuctionError } from './auction.service';
import { ClaimBoxService, ClaimBoxError } from './claim-box.service';

const ACCESS_COOKIE = 'xt_access';

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

const CreateAuctionZ = z
  .object({
    itemKey: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(10000),
    currency: z.enum([
      'LINH_THACH',
      'SECT_CONTRIBUTION',
      'EVENT_TOKEN',
      'TIEN_NGOC_KHOA',
    ]),
    startPrice: z.string().regex(/^\d+$/),
    minBidStep: z.string().regex(/^\d+$/),
    buyoutPrice: z.string().regex(/^\d+$/).optional(),
    durationMinutes: z.number().int().min(30).max(60 * 24 * 7),
  })
  .strict();

const PlaceBidZ = z
  .object({
    bidAmount: z.string().regex(/^\d+$/),
  })
  .strict();

@Controller('market-v2')
export class MarketV2PlayerController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly auctions: AuctionService,
    private readonly claimBox: ClaimBoxService,
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

  @Get('auctions')
  async listAuctions(@Query('itemKey') itemKey?: string) {
    const items = await this.auctions.listActive({ itemKey });
    return { ok: true, data: items };
  }

  @Get('auctions/:id')
  async getAuction(@Param('id') id: string) {
    const a = await this.auctions.get(id);
    if (!a) fail('AUCTION_NOT_FOUND', HttpStatus.NOT_FOUND);
    return { ok: true, data: a };
  }

  @Post('auctions')
  @HttpCode(200)
  async createAuction(@Req() req: Request, @Body() body: unknown) {
    const me = await this.requireCharacter(req);
    const input = CreateAuctionZ.safeParse(body);
    if (!input.success) fail('INVALID_INPUT');
    try {
      const a = await this.auctions.create({
        sellerCharacterId: me,
        itemKey: input.data.itemKey,
        quantity: input.data.quantity,
        currency: input.data.currency,
        startPrice: BigInt(input.data.startPrice),
        minBidStep: BigInt(input.data.minBidStep),
        buyoutPrice: input.data.buyoutPrice
          ? BigInt(input.data.buyoutPrice)
          : undefined,
        durationMinutes: input.data.durationMinutes,
      });
      return { ok: true, data: a };
    } catch (e) {
      if (e instanceof AuctionError) fail(e.code);
      throw e;
    }
  }

  @Post('auctions/:id/bid')
  @HttpCode(200)
  async placeBid(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const me = await this.requireCharacter(req);
    const input = PlaceBidZ.safeParse(body);
    if (!input.success) fail('INVALID_INPUT');
    try {
      const b = await this.auctions.placeBid({
        auctionId: id,
        bidderCharacterId: me,
        bidAmount: BigInt(input.data.bidAmount),
      });
      return { ok: true, data: b };
    } catch (e) {
      if (e instanceof AuctionError) fail(e.code);
      throw e;
    }
  }

  @Post('auctions/:id/cancel')
  @HttpCode(200)
  async cancelAuction(@Req() req: Request, @Param('id') id: string) {
    const me = await this.requireCharacter(req);
    try {
      return { ok: true, data: await this.auctions.cancelBySeller(id, me) };
    } catch (e) {
      if (e instanceof AuctionError) fail(e.code);
      throw e;
    }
  }

  @Get('claim-box')
  async listClaim(
    @Req() req: Request,
    @Query('status') status?: string,
  ) {
    const me = await this.requireCharacter(req);
    const s =
      status === 'PENDING' || status === 'CLAIMED' || status === 'EXPIRED' || status === 'CANCELLED'
        ? status
        : undefined;
    const items = await this.claimBox.list(me, s);
    return { ok: true, data: items };
  }

  @Post('claim-box/:id/claim')
  @HttpCode(200)
  async claim(@Req() req: Request, @Param('id') id: string) {
    const me = await this.requireCharacter(req);
    try {
      return { ok: true, data: await this.claimBox.claim(me, id) };
    } catch (e) {
      if (e instanceof ClaimBoxError) fail(e.code);
      throw e;
    }
  }

  @Get('prices/:itemKey')
  async price(@Param('itemKey') itemKey: string) {
    const snap = await this.prisma.marketPriceSnapshot.findUnique({
      where: { itemKey },
    });
    return { ok: true, data: snap };
  }
}
