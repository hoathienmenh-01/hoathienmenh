/**
 * Phase 30.0 — Market Claim Box Service.
 *
 * Idempotent reward box cho mọi giao dịch market V2 (auction won,
 * listing expired refund, sect auction refund, admin refund). Reward
 * KHÔNG drop trực tiếp vào inventory mà chờ player nhận từ box —
 * giải quyết case offline, inventory full, race condition.
 *
 * Source ∈ MARKET_CLAIM_BOX_SOURCES; dedupe theo `(source, sourceRefId)`.
 * Claim flow atomic: lock entry → grant item/currency → mark CLAIMED.
 */
import { Injectable, Logger } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import type { MarketClaimBoxSource } from '@xuantoi/shared';

import { PrismaService } from '../../common/prisma.service';
import { CurrencyService, type LedgerReason } from '../character/currency.service';

function sourceToLedgerReason(source: string): LedgerReason {
  switch (source) {
    case 'LISTING_SOLD':
      return 'CLAIM_BOX_LISTING_SOLD';
    case 'LISTING_EXPIRED':
      return 'CLAIM_BOX_LISTING_EXPIRED';
    case 'AUCTION_WON':
      return 'CLAIM_BOX_AUCTION_WON';
    case 'AUCTION_REFUND':
      return 'CLAIM_BOX_AUCTION_REFUND';
    case 'AUCTION_SELLER_PAYOUT':
      return 'CLAIM_BOX_AUCTION_SELLER_PAYOUT';
    case 'ADMIN_REFUND':
      return 'CLAIM_BOX_ADMIN_REFUND';
    case 'ADMIN_GRANT':
      return 'CLAIM_BOX_ADMIN_GRANT';
    case 'SECT_AUCTION_WON':
      return 'CLAIM_BOX_SECT_AUCTION_WON';
    case 'SECT_AUCTION_REFUND':
      return 'CLAIM_BOX_SECT_AUCTION_REFUND';
    default:
      return 'CLAIM_BOX_ADMIN_GRANT';
  }
}

export class ClaimBoxError extends Error {
  constructor(
    public code:
      | 'ENTRY_NOT_FOUND'
      | 'ENTRY_NOT_PENDING'
      | 'ENTRY_EXPIRED'
      | 'NOT_OWNER'
      | 'INVALID_PAYLOAD',
  ) {
    super(code);
  }
}

export interface DepositInput {
  characterId: string;
  source: MarketClaimBoxSource;
  sourceRefId?: string;
  itemKey?: string;
  itemQty?: number;
  currency?: keyof typeof CurrencyKind;
  amount?: bigint;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

const SUPPORTED_CURRENCIES: ReadonlySet<keyof typeof CurrencyKind> = new Set([
  'LINH_THACH',
  'TIEN_NGOC_KHOA',
  'EVENT_TOKEN',
  'CONG_HIEN_TONG_MON',
]);

@Injectable()
export class ClaimBoxService {
  private readonly logger = new Logger(ClaimBoxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  /**
   * Idempotent deposit. Nếu đã tồn tại entry cùng `(source, sourceRefId)`
   * và còn PENDING → return entry cũ, không tạo duplicate.
   */
  async deposit(input: DepositInput) {
    if (!input.itemKey && !input.currency) {
      throw new ClaimBoxError('INVALID_PAYLOAD');
    }
    if (input.itemKey && (input.itemQty ?? 0) < 1) {
      throw new ClaimBoxError('INVALID_PAYLOAD');
    }
    if (input.currency && (input.amount ?? 0n) < 1n) {
      throw new ClaimBoxError('INVALID_PAYLOAD');
    }
    if (input.currency && !SUPPORTED_CURRENCIES.has(input.currency)) {
      throw new ClaimBoxError('INVALID_PAYLOAD');
    }

    if (input.sourceRefId) {
      const existing = await this.prisma.marketClaimBoxEntry.findFirst({
        where: {
          source: input.source,
          sourceRefId: input.sourceRefId,
          characterId: input.characterId,
          status: 'PENDING',
        },
      });
      if (existing) return existing;
    }

    return this.prisma.marketClaimBoxEntry.create({
      data: {
        characterId: input.characterId,
        source: input.source,
        sourceRefId: input.sourceRefId,
        itemKey: input.itemKey,
        itemQty: input.itemQty,
        currency: input.currency,
        amount: input.amount,
        expiresAt: input.expiresAt,
        metadataJson: (input.metadata ?? {}) as Prisma.InputJsonValue,
        status: 'PENDING',
      },
    });
  }

  /**
   * Atomic claim. Lock entry by `updateMany {status:PENDING}` (CAS) →
   * grant inventory/currency → mark CLAIMED. Idempotent: retry sẽ
   * return ENTRY_NOT_PENDING.
   */
  async claim(characterId: string, entryId: string) {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.marketClaimBoxEntry.findUnique({
        where: { id: entryId },
      });
      if (!entry) throw new ClaimBoxError('ENTRY_NOT_FOUND');
      if (entry.characterId !== characterId) {
        throw new ClaimBoxError('NOT_OWNER');
      }
      if (entry.status !== 'PENDING') {
        throw new ClaimBoxError('ENTRY_NOT_PENDING');
      }
      if (entry.expiresAt && entry.expiresAt.getTime() < Date.now()) {
        await tx.marketClaimBoxEntry.updateMany({
          where: { id: entry.id, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        });
        throw new ClaimBoxError('ENTRY_EXPIRED');
      }
      const flip = await tx.marketClaimBoxEntry.updateMany({
        where: { id: entry.id, status: 'PENDING' },
        data: { status: 'CLAIMED', claimedAt: new Date() },
      });
      if (flip.count === 0) throw new ClaimBoxError('ENTRY_NOT_PENDING');

      // Grant currency.
      if (entry.currency && entry.amount && entry.amount > 0n) {
        const currencyKind = entry.currency as keyof typeof CurrencyKind;
        if (!SUPPORTED_CURRENCIES.has(currencyKind)) {
          throw new ClaimBoxError('INVALID_PAYLOAD');
        }
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind[currencyKind],
          delta: entry.amount,
          reason: sourceToLedgerReason(entry.source),
          refType: 'MarketClaimBoxEntry',
          refId: entry.id,
          meta: { source: entry.source, sourceRefId: entry.sourceRefId ?? '' },
        });
      }

      // Grant item: insert/update InventoryItem + ItemLedger.
      if (entry.itemKey && entry.itemQty && entry.itemQty > 0) {
        const existing = await tx.inventoryItem.findFirst({
          where: {
            characterId,
            itemKey: entry.itemKey,
            equippedSlot: null,
          },
        });
        if (existing) {
          await tx.inventoryItem.update({
            where: { id: existing.id },
            data: { qty: { increment: entry.itemQty } },
          });
        } else {
          await tx.inventoryItem.create({
            data: { characterId, itemKey: entry.itemKey, qty: entry.itemQty },
          });
        }
        await tx.itemLedger.create({
          data: {
            characterId,
            itemKey: entry.itemKey,
            qtyDelta: entry.itemQty,
            reason: sourceToLedgerReason(entry.source),
            refType: 'MarketClaimBoxEntry',
            refId: entry.id,
            meta: { source: entry.source } as Prisma.InputJsonValue,
          },
        });
      }

      return await tx.marketClaimBoxEntry.findUnique({ where: { id: entry.id } });
    });
  }

  async list(characterId: string, status?: 'PENDING' | 'CLAIMED' | 'EXPIRED' | 'CANCELLED', limit = 100) {
    return this.prisma.marketClaimBoxEntry.findMany({
      where: { characterId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }
}
