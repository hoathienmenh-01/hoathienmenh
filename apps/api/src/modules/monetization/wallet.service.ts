import { Injectable } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import { type WalletCurrencyKey } from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService, type LedgerReason } from '../character/currency.service';

export interface WalletSnapshot {
  TIEN_NGOC: number;
  TIEN_NGOC_KHOA: number;
  LINH_THACH: number;
  CONG_HIEN_TONG_MON: number;
  TRIAL_POINT: number;
  EVENT_TOKEN: number;
}

export interface WalletTxInput {
  characterId: string;
  currency: WalletCurrencyKey;
  /** Có dấu: dương = cộng, âm = trừ. */
  delta: number;
  reason: LedgerReason;
  refType?: string;
  refId?: string;
  meta?: Record<string, unknown>;
  actorUserId?: string;
}

export interface WalletLedgerEntry {
  id: string;
  currency: WalletCurrencyKey;
  delta: number;
  reason: string;
  refType: string | null;
  refId: string | null;
  meta: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Phase 27.0 — Wallet service. Tổng hợp 6 currency view (`WalletSnapshot`),
 * và cung cấp `applyTx` thống nhất qua `CurrencyService.applyTx`. `applyTx`
 * map `WalletCurrencyKey` → `CurrencyKind` để tận dụng atomic ledger pattern
 * sẵn có.
 *
 * Cho `LINH_THACH` (BigInt): clamp về số 53-bit safe int — anti-overflow.
 * Caller phải gọi từ trong $transaction (giống `CurrencyService.applyTx`).
 */
@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  async getWallet(characterId: string): Promise<WalletSnapshot> {
    const c = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: {
        linhThach: true,
        tienNgoc: true,
        tienNgocKhoa: true,
        sectContribBalance: true,
        trialPoint: true,
        eventToken: true,
      },
    });
    if (!c) {
      return zeroWallet();
    }
    return {
      LINH_THACH: clampBigIntToInt(c.linhThach),
      TIEN_NGOC: c.tienNgoc,
      TIEN_NGOC_KHOA: c.tienNgocKhoa,
      CONG_HIEN_TONG_MON: c.sectContribBalance,
      TRIAL_POINT: c.trialPoint,
      EVENT_TOKEN: c.eventToken,
    };
  }

  async applyTx(tx: Prisma.TransactionClient, input: WalletTxInput): Promise<void> {
    if (input.delta === 0) return;
    await this.currency.applyTx(tx, {
      characterId: input.characterId,
      currency: walletToCurrencyKind(input.currency),
      delta: BigInt(input.delta),
      reason: input.reason,
      refType: input.refType,
      refId: input.refId,
      meta: input.meta,
      actorUserId: input.actorUserId,
    });
  }

  async listLedger(
    characterId: string,
    options: { limit?: number; currency?: WalletCurrencyKey } = {},
  ): Promise<WalletLedgerEntry[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const rows = await this.prisma.currencyLedger.findMany({
      where: {
        characterId,
        ...(options.currency
          ? { currency: walletToCurrencyKind(options.currency) }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(this.toEntry);
  }

  private toEntry = (row: {
    id: string;
    currency: CurrencyKind;
    delta: bigint;
    reason: string;
    refType: string | null;
    refId: string | null;
    meta: Prisma.JsonValue;
    createdAt: Date;
  }): WalletLedgerEntry => ({
    id: row.id,
    currency: currencyKindToWallet(row.currency),
    delta: clampBigIntToInt(row.delta),
    reason: row.reason,
    refType: row.refType,
    refId: row.refId,
    meta: (row.meta as Record<string, unknown> | null) ?? {},
    createdAt: row.createdAt,
  });
}

function zeroWallet(): WalletSnapshot {
  return {
    TIEN_NGOC: 0,
    TIEN_NGOC_KHOA: 0,
    LINH_THACH: 0,
    CONG_HIEN_TONG_MON: 0,
    TRIAL_POINT: 0,
    EVENT_TOKEN: 0,
  };
}

const WALLET_TO_KIND: Readonly<Record<WalletCurrencyKey, CurrencyKind>> = {
  TIEN_NGOC: CurrencyKind.TIEN_NGOC,
  TIEN_NGOC_KHOA: CurrencyKind.TIEN_NGOC_KHOA,
  LINH_THACH: CurrencyKind.LINH_THACH,
  CONG_HIEN_TONG_MON: CurrencyKind.CONG_HIEN_TONG_MON,
  TRIAL_POINT: CurrencyKind.TRIAL_POINT,
  EVENT_TOKEN: CurrencyKind.EVENT_TOKEN,
};

const KIND_TO_WALLET: Readonly<Record<CurrencyKind, WalletCurrencyKey>> = {
  [CurrencyKind.TIEN_NGOC]: 'TIEN_NGOC',
  [CurrencyKind.TIEN_NGOC_KHOA]: 'TIEN_NGOC_KHOA',
  [CurrencyKind.LINH_THACH]: 'LINH_THACH',
  [CurrencyKind.CONG_HIEN_TONG_MON]: 'CONG_HIEN_TONG_MON',
  [CurrencyKind.TRIAL_POINT]: 'TRIAL_POINT',
  [CurrencyKind.EVENT_TOKEN]: 'EVENT_TOKEN',
};

export function walletToCurrencyKind(key: WalletCurrencyKey): CurrencyKind {
  const k = WALLET_TO_KIND[key];
  if (!k) throw new Error(`Unknown wallet currency: ${key}`);
  return k;
}

export function currencyKindToWallet(k: CurrencyKind): WalletCurrencyKey {
  return KIND_TO_WALLET[k];
}

function clampBigIntToInt(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const min = -max;
  if (value > max) return Number.MAX_SAFE_INTEGER;
  if (value < min) return -Number.MAX_SAFE_INTEGER;
  return Number(value);
}
