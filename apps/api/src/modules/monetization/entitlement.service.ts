import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ENTITLEMENT_VALUE_CAPS,
  type EntitlementKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

export interface ActiveEntitlement {
  key: EntitlementKey;
  /** Giá trị runtime (cap bởi `ENTITLEMENT_VALUE_CAPS`). */
  value: number;
  /** Nguồn grant (`MONTHLY_CARD:tieu_nguyet_tap`, `SHOP:<productKey>`, …). */
  source: string;
  startsAt: Date;
  expiresAt: Date | null;
}

export interface GrantEntitlementInput {
  characterId: string;
  key: EntitlementKey;
  /** Số ngày hiệu lực. `0` hoặc `undefined` = vô hạn (`expiresAt = null`). */
  durationDays?: number;
  value: number;
  source: string;
  now?: Date;
}

/**
 * Phase 27.0 — Entitlement service. Quản lý quyền lợi premium time-limited
 * (thẻ tháng, slot expansion, sweep ticket daily, …).
 *
 * Pattern:
 *   - 1 row UNIQUE `(characterId, entitlementKey)` per entitlement.
 *   - `grantEntitlement` upsert + bump `expiresAt = max(currentExpiry, now)
 *     + durationDays`. Stack thời lượng nếu mua thêm.
 *   - `getActiveEntitlements` lọc `active = true AND (expiresAt IS NULL OR
 *     expiresAt > now)`.
 *   - `hasEntitlement` check active + (optionally) value ≥ threshold.
 */
@Injectable()
export class EntitlementService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveEntitlements(
    characterId: string,
    now: Date = new Date(),
  ): Promise<ActiveEntitlement[]> {
    const rows = await this.prisma.premiumEntitlement.findMany({
      where: {
        characterId,
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { entitlementKey: 'asc' },
    });
    return rows.map(this.toActive);
  }

  async hasEntitlement(
    characterId: string,
    key: EntitlementKey,
    now: Date = new Date(),
  ): Promise<boolean> {
    const row = await this.prisma.premiumEntitlement.findUnique({
      where: { characterId_entitlementKey: { characterId, entitlementKey: key } },
    });
    if (!row || !row.active) return false;
    if (row.expiresAt && row.expiresAt <= now) return false;
    return true;
  }

  async getEntitlementValue(
    characterId: string,
    key: EntitlementKey,
    now: Date = new Date(),
  ): Promise<number> {
    const row = await this.prisma.premiumEntitlement.findUnique({
      where: { characterId_entitlementKey: { characterId, entitlementKey: key } },
    });
    if (!row || !row.active) return 0;
    if (row.expiresAt && row.expiresAt <= now) return 0;
    const v = (row.valueJson as Prisma.JsonObject | null)?.value;
    if (typeof v === 'number' && Number.isFinite(v)) {
      return Math.min(v, ENTITLEMENT_VALUE_CAPS[key]);
    }
    return 0;
  }

  async grantEntitlementTx(
    tx: Prisma.TransactionClient,
    input: GrantEntitlementInput,
  ): Promise<void> {
    const cap = ENTITLEMENT_VALUE_CAPS[input.key];
    const clampedValue = Math.min(Math.max(input.value, 0), cap);
    const now = input.now ?? new Date();
    const existing = await tx.premiumEntitlement.findUnique({
      where: {
        characterId_entitlementKey: {
          characterId: input.characterId,
          entitlementKey: input.key,
        },
      },
    });
    const newExpiresAt = computeNewExpiry(existing?.expiresAt ?? null, now, input.durationDays);
    if (existing) {
      await tx.premiumEntitlement.update({
        where: { id: existing.id },
        data: {
          source: input.source,
          startsAt: existing.active ? existing.startsAt : now,
          expiresAt: newExpiresAt,
          valueJson: { value: clampedValue } as Prisma.InputJsonValue,
          active: true,
        },
      });
    } else {
      await tx.premiumEntitlement.create({
        data: {
          characterId: input.characterId,
          entitlementKey: input.key,
          source: input.source,
          startsAt: now,
          expiresAt: newExpiresAt,
          valueJson: { value: clampedValue } as Prisma.InputJsonValue,
          active: true,
        },
      });
    }
  }

  async grantEntitlement(input: GrantEntitlementInput): Promise<void> {
    await this.prisma.$transaction((tx) => this.grantEntitlementTx(tx, input));
  }

  private toActive = (row: {
    entitlementKey: string;
    valueJson: Prisma.JsonValue;
    source: string;
    startsAt: Date;
    expiresAt: Date | null;
  }): ActiveEntitlement => {
    const key = row.entitlementKey as EntitlementKey;
    const rawValue = (row.valueJson as Prisma.JsonObject | null)?.value;
    const value =
      typeof rawValue === 'number' && Number.isFinite(rawValue)
        ? Math.min(rawValue, ENTITLEMENT_VALUE_CAPS[key] ?? 0)
        : 0;
    return {
      key,
      value,
      source: row.source,
      startsAt: row.startsAt,
      expiresAt: row.expiresAt,
    };
  };
}

function computeNewExpiry(
  currentExpiresAt: Date | null,
  now: Date,
  durationDays: number | undefined,
): Date | null {
  if (!durationDays || durationDays <= 0) return null;
  const baseMs =
    currentExpiresAt && currentExpiresAt > now
      ? currentExpiresAt.getTime()
      : now.getTime();
  return new Date(baseMs + durationDays * 86_400_000);
}
