/**
 * Phase 30.0 — Market V2 admin controller.
 *
 * Endpoint:
 *   - GET    /admin/market-v2/auctions               → list (filter status).
 *   - POST   /admin/market-v2/auctions/:id/lock      → lock auction + audit.
 *   - POST   /admin/market-v2/auctions/:id/cancel    → cancel + refund + audit.
 *   - GET    /admin/market-v2/item-policy            → list policy.
 *   - POST   /admin/market-v2/item-policy            → upsert + audit.
 *   - GET    /admin/market-v2/anomalies              → list anomaly.
 *   - POST   /admin/market-v2/anomalies/:id/resolve  → resolve + audit.
 *
 * Require permission `ADMIN_MANAGE_MARKET`. Audit qua `AdminAuditWriter`.
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  ITEM_TRADABILITIES,
  type AdminRoleKey,
  validateMarketItemPolicy,
} from '@xuantoi/shared';

import { PrismaService } from '../../common/prisma.service';
import { AdminPermissionGuard } from '../admin-control-center/admin-permission.guard';
import { RequireAdminPermission } from '../admin-control-center/admin-permission.decorator';
import { AdminAuditWriter } from '../admin-control-center/admin-audit-writer.service';
import { AuctionService } from './auction.service';
import { ClaimBoxService } from './claim-box.service';

interface AdminReq extends Request {
  userId: string;
  adminRole: AdminRoleKey;
}

function fail(code: string, status = HttpStatus.BAD_REQUEST): never {
  throw new HttpException(
    { ok: false, error: { code, message: code } },
    status,
  );
}

const LockZ = z
  .object({ reason: z.string().min(3).max(500) })
  .strict();
const CancelZ = z
  .object({ reason: z.string().min(3).max(500), refundToSeller: z.boolean().default(true) })
  .strict();
const PolicyZ = z
  .object({
    itemKey: z.string().min(1).max(100),
    tradability: z.enum([...(ITEM_TRADABILITIES as readonly string[])] as [string, ...string[]]),
    minPrice: z.string().regex(/^\d+$/).optional(),
    maxPrice: z.string().regex(/^\d+$/).optional(),
    maxListingsPerDay: z.number().int().min(0).max(10000).optional(),
    maxQtyPerListing: z.number().int().min(0).max(100000).optional(),
    taxRatePctOverride: z.number().min(0).max(0.5).optional(),
    listingFeeFlatOverride: z.string().regex(/^\d+$/).optional(),
    reason: z.string().min(3).max(500),
  })
  .strict();
const ResolveZ = z
  .object({ resolution: z.enum(['DISMISSED', 'CONFIRMED', 'ESCALATED']), reason: z.string().min(3).max(500) })
  .strict();
const RefundZ = z
  .object({
    characterId: z.string().min(1),
    itemKey: z.string().min(1).optional(),
    itemQty: z.number().int().min(1).max(1_000_000).optional(),
    currency: z
      .enum(['LINH_THACH', 'TIEN_NGOC_KHOA', 'EVENT_TOKEN', 'CONG_HIEN_TONG_MON'])
      .optional(),
    amount: z.string().regex(/^\d+$/).optional(),
    reason: z.string().min(3).max(500),
  })
  .strict();

@Controller('admin/market-v2')
@UseGuards(AdminPermissionGuard)
export class MarketV2AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auctions: AuctionService,
    private readonly claimBox: ClaimBoxService,
    private readonly audit: AdminAuditWriter,
  ) {}

  @Get('auctions')
  @RequireAdminPermission('ADMIN_MANAGE_MARKET')
  async listAuctions(@Query('status') status?: string, @Query('limit') limit?: string) {
    const lim = Math.min(parseInt(limit ?? '50', 10) || 50, 200);
    return {
      ok: true,
      data: await this.prisma.marketAuction.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: 'desc' },
        take: lim,
      }),
    };
  }

  @Post('auctions/:id/lock')
  @RequireAdminPermission('ADMIN_MANAGE_MARKET')
  async lockAuction(@Req() req: AdminReq, @Param('id') id: string, @Body() body: unknown) {
    const parsed = LockZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const a = await this.prisma.marketAuction.findUnique({ where: { id } });
    if (!a) fail('AUCTION_NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.prisma.marketAuction.update({
      where: { id },
      data: {
        status: 'LOCKED',
        lockedBy: req.userId,
        lockedReason: parsed.data.reason,
      },
    });
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'MARKET_AUCTION_LOCK',
      targetType: 'MarketAuction',
      targetId: id,
      reason: parsed.data.reason,
    });
    return { ok: true };
  }

  @Post('auctions/:id/cancel')
  @RequireAdminPermission('ADMIN_MANAGE_MARKET')
  async cancelAuction(@Req() req: AdminReq, @Param('id') id: string, @Body() body: unknown) {
    const parsed = CancelZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const a = await this.prisma.marketAuction.findUnique({ where: { id } });
    if (!a) fail('AUCTION_NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.prisma.$transaction(async (tx) => {
      await tx.marketAuction.update({
        where: { id },
        data: { status: 'CANCELLED', finalizedAt: new Date() },
      });
      if (parsed.data.refundToSeller) {
        await this.claimBox.deposit({
          characterId: a!.sellerCharacterId,
          source: 'ADMIN_REFUND',
          sourceRefId: a!.id,
          itemKey: a!.itemKey,
          itemQty: a!.quantity,
          metadata: { adminReason: parsed.data.reason },
        });
      }
      // Refund any current high bid into bidder claim box.
      if (a!.currentBidderId && a!.currentBid) {
        await this.claimBox.deposit({
          characterId: a!.currentBidderId,
          source: 'ADMIN_REFUND',
          sourceRefId: a!.id,
          currency:
            a!.currency === 'SECT_CONTRIBUTION'
              ? 'CONG_HIEN_TONG_MON'
              : (a!.currency as 'LINH_THACH' | 'TIEN_NGOC_KHOA' | 'EVENT_TOKEN'),
          amount: a!.currentBid,
          metadata: { adminReason: parsed.data.reason },
        });
      }
    });
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'MARKET_AUCTION_CANCEL',
      targetType: 'MarketAuction',
      targetId: id,
      reason: parsed.data.reason,
    });
    return { ok: true };
  }

  @Get('item-policy')
  @RequireAdminPermission('ADMIN_MANAGE_MARKET')
  async listPolicy(@Query('limit') limit?: string) {
    const lim = Math.min(parseInt(limit ?? '100', 10) || 100, 500);
    return {
      ok: true,
      data: await this.prisma.marketItemPolicy.findMany({
        orderBy: { updatedAt: 'desc' },
        take: lim,
      }),
    };
  }

  @Post('item-policy')
  @RequireAdminPermission('ADMIN_MANAGE_MARKET')
  async upsertPolicy(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = PolicyZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const policy = parsed.data;
    const errs = validateMarketItemPolicy({
      itemKey: policy.itemKey,
      tradability: policy.tradability as never,
      minPrice: policy.minPrice ? Number(policy.minPrice) : undefined,
      maxPrice: policy.maxPrice ? Number(policy.maxPrice) : undefined,
      maxListingsPerDay: policy.maxListingsPerDay,
      maxQtyPerListing: policy.maxQtyPerListing,
      taxRatePctOverride: policy.taxRatePctOverride,
      listingFeeFlatOverride: policy.listingFeeFlatOverride
        ? Number(policy.listingFeeFlatOverride)
        : undefined,
      reason: policy.reason,
    });
    if (errs.length) fail(errs[0]);
    const now = new Date();
    await this.prisma.marketItemPolicy.upsert({
      where: { itemKey: policy.itemKey },
      update: {
        tradability: policy.tradability,
        minPrice: policy.minPrice ? BigInt(policy.minPrice) : null,
        maxPrice: policy.maxPrice ? BigInt(policy.maxPrice) : null,
        maxListingsPerDay: policy.maxListingsPerDay ?? null,
        maxQtyPerListing: policy.maxQtyPerListing ?? null,
        taxRatePctOverride: policy.taxRatePctOverride ?? null,
        listingFeeFlatOverride: policy.listingFeeFlatOverride
          ? BigInt(policy.listingFeeFlatOverride)
          : null,
        reason: policy.reason,
        updatedBy: req.userId,
        updatedAt: now,
      },
      create: {
        itemKey: policy.itemKey,
        tradability: policy.tradability,
        minPrice: policy.minPrice ? BigInt(policy.minPrice) : null,
        maxPrice: policy.maxPrice ? BigInt(policy.maxPrice) : null,
        maxListingsPerDay: policy.maxListingsPerDay ?? null,
        maxQtyPerListing: policy.maxQtyPerListing ?? null,
        taxRatePctOverride: policy.taxRatePctOverride ?? null,
        listingFeeFlatOverride: policy.listingFeeFlatOverride
          ? BigInt(policy.listingFeeFlatOverride)
          : null,
        reason: policy.reason,
        updatedBy: req.userId,
        updatedAt: now,
      },
    });
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType:
        policy.tradability === 'ADMIN_LOCKED'
          ? 'MARKET_ITEM_POLICY_LOCK'
          : 'MARKET_ITEM_POLICY_UNLOCK',
      targetType: 'MarketItemPolicy',
      targetId: policy.itemKey,
      reason: policy.reason,
    });
    return { ok: true };
  }

  @Get('anomalies')
  @RequireAdminPermission('ADMIN_MANAGE_MARKET')
  async listAnomalies(@Query('limit') limit?: string) {
    const lim = Math.min(parseInt(limit ?? '50', 10) || 50, 200);
    return {
      ok: true,
      data: await this.prisma.marketAnomaly.findMany({
        where: { resolvedAt: null },
        orderBy: { createdAt: 'desc' },
        take: lim,
      }),
    };
  }

  @Post('anomalies/:id/resolve')
  @RequireAdminPermission('ADMIN_MANAGE_MARKET')
  async resolveAnomaly(@Req() req: AdminReq, @Param('id') id: string, @Body() body: unknown) {
    const parsed = ResolveZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    await this.prisma.marketAnomaly.update({
      where: { id },
      data: {
        resolvedBy: req.userId,
        resolvedAt: new Date(),
        resolveReason: `${parsed.data.resolution}: ${parsed.data.reason}`,
      },
    });
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'MARKET_ANOMALY_RESOLVE',
      targetType: 'MarketAnomaly',
      targetId: id,
      reason: parsed.data.reason,
    });
    return { ok: true };
  }

  /**
   * Phase 30.0 — Cron-style endpoint để admin trigger finalize expired
   * auction. Service layer cũng có thể được gọi từ scheduler module
   * sau này.
   */
  @Post('auctions/finalize-due')
  @RequireAdminPermission('ADMIN_MANAGE_MARKET')
  async finalizeDue(@Req() req: AdminReq) {
    const result = await this.auctions.finalizeExpired();
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'MARKET_AUCTION_LOCK',
      targetType: 'MarketAuction',
      targetId: 'finalize-batch',
      reason: `finalized ${result.finalized}/${result.candidates}`,
    });
    return { ok: true, data: result };
  }

  @Post('refund')
  @RequireAdminPermission('ADMIN_MANAGE_MARKET')
  async refund(@Req() req: AdminReq, @Body() body: unknown) {
    const parsed = RefundZ.safeParse(body);
    if (!parsed.success) fail('INVALID_INPUT');
    const entry = await this.claimBox.deposit({
      characterId: parsed.data.characterId,
      source: 'ADMIN_REFUND',
      itemKey: parsed.data.itemKey,
      itemQty: parsed.data.itemQty,
      currency: parsed.data.currency,
      amount: parsed.data.amount ? BigInt(parsed.data.amount) : undefined,
    });
    await this.audit.write({
      adminUserId: req.userId,
      adminRole: req.adminRole,
      actionType: 'MARKET_REFUND',
      targetType: 'MarketClaimBoxEntry',
      targetId: entry.id,
      reason: parsed.data.reason,
    });
    return { ok: true, data: entry };
  }
}
