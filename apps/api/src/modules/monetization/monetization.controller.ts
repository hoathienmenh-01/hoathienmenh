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
import {
  MONETIZATION_ERROR_CODES,
  WALLET_CURRENCY_KEYS,
  type MonetizationErrorCode,
  type WalletCurrencyKey,
} from '@xuantoi/shared';
import { AuthService } from '../auth/auth.service';
import { MonetizationError, MonetizationService } from './monetization.service';
import { WalletService } from './wallet.service';
import { EntitlementService } from './entitlement.service';
import { MonetizationShopService, MonetizationFoundationError } from './monetization-shop.service';
import { SweepTicketService, ExtraAttemptService } from './sweep-attempt.service';
import { GrowthFundService } from './growth-fund.service';
import { PrismaService } from '../../common/prisma.service';
import { BattlePassV2Service } from './battle-pass-v2.service';
import { LimitedShopService } from './limited-shop.service';
import { MonetizationOverviewService } from './monetization-overview.service';
import { LIMITED_SHOP_KEYS } from '@xuantoi/shared';

const ACCESS_COOKIE = 'xt_access';

const BattlePassClaimInput = z.object({
  level: z.number().int().min(1).max(100),
  track: z.enum(['free', 'premium']),
});

const ShopPurchaseInput = z.object({
  productKey: z.string().min(1).max(64),
});

const SweepUseInput = z.object({
  ticketKey: z.string().min(1).max(64),
  contentType: z.string().min(1).max(32),
  contentKey: z.string().min(1).max(64),
});

const ExtraAttemptBuyInput = z.object({
  limitKey: z.string().min(1).max(64),
});

const GrowthFundClaimInput = z.object({
  fundKey: z.string().min(1).max(64),
  milestoneKey: z.string().min(1).max(64),
});

const LimitedShopPurchaseInput = z.object({
  shopKey: z.enum(LIMITED_SHOP_KEYS),
  itemKey: z.string().min(1).max(64),
});

const WalletLedgerQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  currency: z.enum(WALLET_CURRENCY_KEYS).optional(),
});

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException({ ok: false, error: { code, message: code } }, status);
}

const MONETIZATION_ERROR_SET: ReadonlySet<MonetizationErrorCode> = new Set(
  MONETIZATION_ERROR_CODES,
);

@Controller('monetization')
export class MonetizationController {
  constructor(
    private readonly monetization: MonetizationService,
    private readonly wallet: WalletService,
    private readonly entitlements: EntitlementService,
    private readonly shop: MonetizationShopService,
    private readonly sweep: SweepTicketService,
    private readonly extraAttempt: ExtraAttemptService,
    private readonly growthFund: GrowthFundService,
    private readonly battlePassV2: BattlePassV2Service,
    private readonly limitedShop: LimitedShopService,
    private readonly overviewService: MonetizationOverviewService,
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('battle-pass/current')
  async currentBattlePass(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    return { ok: true, data: await this.monetization.currentBattlePass(userId) };
  }

  @Get('battle-pass/progress')
  async battlePassProgress(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    return { ok: true, data: await this.monetization.battlePassProgress(userId) };
  }

  @Post('battle-pass/claim')
  @HttpCode(200)
  async claimBattlePass(@Req() req: Request, @Body() body: unknown) {
    const userId = await this.requireUserId(req);
    const parsed = BattlePassClaimInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      return {
        ok: true,
        data: await this.monetization.claimBattlePassReward(userId, parsed.data),
      };
    } catch (e) {
      this.failMonetization(e);
    }
  }

  @Post('battle-pass/claim-all')
  @HttpCode(200)
  async claimAllBattlePass(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      return { ok: true, data: await this.monetization.claimAllBattlePassRewards(userId) };
    } catch (e) {
      this.failMonetization(e);
    }
  }

  @Get('monthly-card')
  async monthlyCard(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    return { ok: true, data: await this.monetization.monthlyCard(userId) };
  }

  @Post('monthly-card/claim')
  @HttpCode(200)
  async claimMonthlyCard(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    try {
      return { ok: true, data: await this.monetization.claimMonthlyCard(userId) };
    } catch (e) {
      this.failMonetization(e);
    }
  }

  @Get('vip')
  async vip(@Req() req: Request) {
    const userId = await this.requireUserId(req);
    return { ok: true, data: await this.monetization.vip(userId) };
  }

  // ─── Phase 27.0 — Wallet / Shop / Entitlement / Sweep / Extra / Growth ────

  @Get('wallet')
  async wallet_(@Req() req: Request) {
    const characterId = await this.requireCharacterId(req);
    const data = await this.wallet.getWallet(characterId);
    return { ok: true, data };
  }

  @Get('wallet/ledger')
  async walletLedger(@Req() req: Request, @Query() query: unknown) {
    const characterId = await this.requireCharacterId(req);
    const parsed = WalletLedgerQuery.safeParse(query);
    if (!parsed.success) fail('INVALID_INPUT');
    const entries = await this.wallet.listLedger(characterId, {
      limit: parsed.data.limit,
      currency: parsed.data.currency as WalletCurrencyKey | undefined,
    });
    return { ok: true, data: entries };
  }

  @Get('entitlements')
  async listEntitlements(@Req() req: Request) {
    const characterId = await this.requireCharacterId(req);
    const data = await this.entitlements.getActiveEntitlements(characterId);
    return { ok: true, data };
  }

  @Get('shop')
  async listShop(@Req() req: Request) {
    const characterId = await this.requireCharacterId(req);
    const data = await this.shop.listProducts(characterId);
    return { ok: true, data };
  }

  @Post('shop/purchase')
  @HttpCode(200)
  async purchase(@Req() req: Request, @Body() body: unknown) {
    const characterId = await this.requireCharacterId(req);
    const parsed = ShopPurchaseInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.shop.purchase(characterId, parsed.data.productKey);
      return { ok: true, data };
    } catch (e) {
      this.failFoundation(e);
    }
  }

  @Post('sweep/use')
  @HttpCode(200)
  async useSweep(@Req() req: Request, @Body() body: unknown) {
    const characterId = await this.requireCharacterId(req);
    const parsed = SweepUseInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.sweep.useTicket({
        characterId,
        ticketKey: parsed.data.ticketKey,
        contentType: parsed.data.contentType,
        contentKey: parsed.data.contentKey,
      });
      return { ok: true, data };
    } catch (e) {
      this.failFoundation(e);
    }
  }

  @Get('extra-attempts')
  async extraAttempts(@Req() req: Request) {
    const characterId = await this.requireCharacterId(req);
    const data = await this.extraAttempt.getState(characterId);
    return { ok: true, data };
  }

  @Post('extra-attempts/buy')
  @HttpCode(200)
  async buyExtraAttempt(@Req() req: Request, @Body() body: unknown) {
    const characterId = await this.requireCharacterId(req);
    const parsed = ExtraAttemptBuyInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.extraAttempt.buyExtraAttempt({
        characterId,
        limitKey: parsed.data.limitKey,
      });
      return { ok: true, data };
    } catch (e) {
      this.failFoundation(e);
    }
  }

  @Get('growth-fund')
  async growthFund_(
    @Req() req: Request,
    @Query('fundKey') fundKey?: string,
  ) {
    const characterId = await this.requireCharacterId(req);
    if (!fundKey) fail('INVALID_INPUT');
    const data = await this.growthFund.getFund(characterId, fundKey);
    if (!data) {
      return { ok: true, data: null };
    }
    return { ok: true, data };
  }

  @Post('growth-fund/claim')
  @HttpCode(200)
  async claimGrowthFund(@Req() req: Request, @Body() body: unknown) {
    const characterId = await this.requireCharacterId(req);
    const parsed = GrowthFundClaimInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.growthFund.claimMilestone({
        characterId,
        fundKey: parsed.data.fundKey,
        milestoneKey: parsed.data.milestoneKey,
      });
      return { ok: true, data };
    } catch (e) {
      this.failFoundation(e);
    }
  }

  // ─── Phase 27.1–27.5 — Monetization Systems V1 endpoints ──────────────

  @Get('overview')
  async overview(@Req() req: Request) {
    const characterId = await this.requireCharacterId(req);
    const data = await this.overviewService.overview(characterId);
    return { ok: true, data };
  }

  @Get('battle-pass/missions')
  async battlePassMissions(@Req() req: Request) {
    const characterId = await this.requireCharacterId(req);
    try {
      const data = await this.battlePassV2.listMissions(characterId);
      return { ok: true, data };
    } catch (e) {
      this.failFoundation(e);
    }
  }

  @Get('limited-shops')
  async listLimitedShops(@Req() req: Request) {
    const characterId = await this.requireCharacterId(req);
    const data = await this.limitedShop.listShops(characterId);
    return { ok: true, data };
  }

  @Post('limited-shops/buy')
  @HttpCode(200)
  async buyLimitedShop(@Req() req: Request, @Body() body: unknown) {
    const characterId = await this.requireCharacterId(req);
    const parsed = LimitedShopPurchaseInput.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    try {
      const data = await this.limitedShop.purchase(
        characterId,
        parsed.data.shopKey,
        parsed.data.itemKey,
      );
      return { ok: true, data };
    } catch (e) {
      this.failFoundation(e);
    }
  }

  private async requireUserId(req: Request): Promise<string> {
    const id = await this.auth.userIdFromAccess(req.cookies?.[ACCESS_COOKIE]);
    if (!id) fail('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED);
    return id;
  }

  private async requireCharacterId(req: Request): Promise<string> {
    const userId = await this.requireUserId(req);
    const character = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!character) fail('NO_CHARACTER', HttpStatus.NOT_FOUND);
    return character.id;
  }

  private failMonetization(e: unknown): never {
    if (e instanceof MonetizationError) {
      const status =
        e.code === 'NO_CHARACTER' || e.code === 'NO_ACTIVE_SEASON'
          ? HttpStatus.NOT_FOUND
          : e.code === 'ALREADY_CLAIMED' || e.code === 'MONTHLY_CARD_ALREADY_CLAIMED'
            ? HttpStatus.CONFLICT
            : HttpStatus.BAD_REQUEST;
      fail(e.code, status);
    }
    throw e;
  }

  private failFoundation(e: unknown): never {
    if (e instanceof MonetizationFoundationError) {
      const code = e.code;
      const status = mapFoundationStatus(code);
      fail(code, status);
    }
    if (e instanceof MonetizationError) this.failMonetization(e);
    throw e;
  }
}

function mapFoundationStatus(code: MonetizationErrorCode | string): HttpStatus {
  if (!MONETIZATION_ERROR_SET.has(code as MonetizationErrorCode)) {
    return HttpStatus.BAD_REQUEST;
  }
  switch (code) {
    case 'PRODUCT_NOT_FOUND':
    case 'FUND_NOT_PURCHASED':
      return HttpStatus.NOT_FOUND;
    case 'PURCHASE_LIMIT_REACHED':
    case 'EXTRA_ATTEMPT_LIMIT_REACHED':
    case 'DAILY_CLAIM_ALREADY_DONE':
    case 'MILESTONE_ALREADY_CLAIMED':
    case 'FUND_ALREADY_PURCHASED':
    case 'CARD_ALREADY_ACTIVE':
    case 'TRANSACTION_CONFLICT':
      return HttpStatus.CONFLICT;
    case 'INSUFFICIENT_CURRENCY':
    case 'CONTENT_NOT_CLEARED':
    case 'PRODUCT_DISABLED':
    case 'ENTITLEMENT_EXPIRED':
    case 'CAP_REACHED':
    case 'MILESTONE_LOCKED':
    case 'INACTIVE_CARD':
    case 'INVALID_CURRENCY':
    case 'INVALID_INPUT':
      return HttpStatus.BAD_REQUEST;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}
