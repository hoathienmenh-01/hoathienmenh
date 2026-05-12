import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DROP_RULE_CATALOG,
  effectiveDropTier,
  realmOrderToMaterialTier,
  rollDropEconomyMaterials,
  type DropMonsterType,
  type DropRollContext,
  type DropRollResult,
  type DropSource,
  type MaterialDropRule,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { dayBucketFor, getDailyRewardCapTz } from './reward-cap.service';

/**
 * Phase 26.2 — Server-authoritative material drop runtime.
 *
 * Wire points:
 *   - Combat (normal/elite/boss) → `rollAndGrantForCombat(...)`.
 *   - Dungeon-run (per-encounter / claim end) → `rollAndGrantForDungeon(...)`.
 *   - Boss / world boss → `rollAndGrantForBoss(...)`.
 *
 * Tất cả entry point đều:
 *   1. Snapshot character realm order + source tier + monster type.
 *   2. Load daily/weekly cap usage hiện tại.
 *   3. Gọi shared `rollDropEconomyMaterials` (pure).
 *   4. Grant qua `InventoryService.grantTx` + atomic upsert/increment caps.
 *   5. Tất cả gói trong cùng `$transaction` để chống race (kill mob đồng
 *      thời không bypass cap).
 *
 * KHÔNG cấp tienNgoc / linhThach — `RewardCapService` xử lý currency riêng.
 */
@Injectable()
export class DropEconomyService {
  private readonly logger = new Logger(DropEconomyService.name);

  /**
   * Allow tests to inject a fixed RNG. Production luôn dùng `Math.random`.
   */
  private rngFactory: () => () => number = () => Math.random;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  /** Test seam — KHÔNG dùng ở production. */
  __setRngFactory(factory: () => () => number): void {
    this.rngFactory = factory;
  }

  /**
   * Roll + grant material drops cho 1 kill / 1 encounter / 1 boss.
   *
   * @returns danh sách item đã grant (đã pass cap), kèm metadata.
   */
  async rollAndGrant(
    characterId: string,
    args: {
      playerRealmOrder: number;
      sourceTier: number;
      monsterType: DropMonsterType;
      source: DropSource;
      dungeonTier?: number;
      luck?: number;
      /** Số lần roll (default 1 — boss có thể request 2-3). */
      rollCount?: number;
      /** Audit context. */
      refType?: string;
      refId?: string;
      catalog?: readonly MaterialDropRule[];
      now?: Date;
    },
  ): Promise<DropRollResult[]> {
    const catalog = args.catalog ?? DROP_RULE_CATALOG;
    const now = args.now ?? new Date();
    const tz = getDailyRewardCapTz();
    const dayBucket = dayBucketFor(now, tz);
    const weekBucket = weekBucketFor(now, tz);

    // Pre-load cap usage outside transaction (read-mostly path).
    const [dailyRows, weeklyRows] = await Promise.all([
      this.prisma.dailyMaterialCap.findMany({
        where: { characterId, dayBucket },
      }),
      this.prisma.weeklyMaterialCap.findMany({
        where: { characterId, weekBucket },
      }),
    ]);
    const dailyUsed = new Map<string, number>(
      dailyRows.map((r) => [r.ruleKey, r.qtyAccum]),
    );
    const weeklyUsed = new Map<string, number>(
      weeklyRows.map((r) => [r.ruleKey, r.qtyAccum]),
    );

    const ctx: DropRollContext = {
      playerRealmOrder: args.playerRealmOrder,
      sourceTier: args.sourceTier,
      monsterType: args.monsterType,
      source: args.source,
      dungeonTier: args.dungeonTier,
      luck: args.luck,
      dailyUsed,
      weeklyUsed,
      rng: this.rngFactory(),
    };

    const playerTier = realmOrderToMaterialTier(args.playerRealmOrder);
    const effTier = effectiveDropTier(playerTier, args.sourceTier);

    const rolled = rollDropEconomyMaterials(ctx, catalog, args.rollCount ?? 1);
    if (rolled.length === 0) return [];

    // Apply: grant + atomic cap upsert inside one tx.
    await this.prisma.$transaction(async (tx) => {
      for (const r of rolled) {
        const rule = catalog.find((c) => c.key === r.ruleKey);
        if (!rule) continue;

        // Daily cap upsert (only if rule has daily cap).
        if (rule.maxDailyQty !== undefined) {
          await tx.dailyMaterialCap.upsert({
            where: {
              characterId_dayBucket_ruleKey: {
                characterId,
                dayBucket,
                ruleKey: r.ruleKey,
              },
            },
            create: {
              characterId,
              dayBucket,
              ruleKey: r.ruleKey,
              materialCategory: r.materialCategory,
              materialTier: r.materialTier,
              source: r.source,
              qtyAccum: r.qty,
            },
            update: {
              qtyAccum: { increment: r.qty },
            },
          });
        }
        if (rule.maxWeeklyQty !== undefined) {
          await tx.weeklyMaterialCap.upsert({
            where: {
              characterId_weekBucket_ruleKey: {
                characterId,
                weekBucket,
                ruleKey: r.ruleKey,
              },
            },
            create: {
              characterId,
              weekBucket,
              ruleKey: r.ruleKey,
              materialCategory: r.materialCategory,
              materialTier: r.materialTier,
              source: r.source,
              qtyAccum: r.qty,
            },
            update: {
              qtyAccum: { increment: r.qty },
            },
          });
        }

        await this.inventory.grantTx(
          tx,
          characterId,
          [{ itemKey: r.itemKey, qty: r.qty }],
          {
            reason: 'DROP_ECONOMY_MATERIAL',
            refType: args.refType,
            refId: args.refId,
            extra: {
              ruleKey: r.ruleKey,
              materialTier: r.materialTier,
              materialCategory: r.materialCategory,
              source: r.source,
              rarity: r.rarity,
              effectiveDropTier: effTier,
              playerTier,
              sourceTier: args.sourceTier,
              cappedByDaily: r.cappedByDaily ?? null,
              cappedByWeekly: r.cappedByWeekly ?? null,
            } as Prisma.InputJsonValue,
          },
        );
      }
    });

    return rolled;
  }

  /**
   * Read-only — tóm tắt cap usage hiện tại cho 1 character. Dùng cho
   * admin dashboard / Alchemy "còn bao nhiêu lượt farm hôm nay".
   */
  async getCapUsage(
    characterId: string,
    now: Date = new Date(),
  ): Promise<{
    dayBucket: string;
    weekBucket: string;
    daily: { ruleKey: string; qtyAccum: number; materialCategory: string; materialTier: number; source: string }[];
    weekly: { ruleKey: string; qtyAccum: number; materialCategory: string; materialTier: number; source: string }[];
  }> {
    const tz = getDailyRewardCapTz();
    const dayBucket = dayBucketFor(now, tz);
    const weekBucket = weekBucketFor(now, tz);
    const [daily, weekly] = await Promise.all([
      this.prisma.dailyMaterialCap.findMany({
        where: { characterId, dayBucket },
        orderBy: { ruleKey: 'asc' },
      }),
      this.prisma.weeklyMaterialCap.findMany({
        where: { characterId, weekBucket },
        orderBy: { ruleKey: 'asc' },
      }),
    ]);
    return {
      dayBucket,
      weekBucket,
      daily: daily.map((r) => ({
        ruleKey: r.ruleKey,
        qtyAccum: r.qtyAccum,
        materialCategory: r.materialCategory,
        materialTier: r.materialTier,
        source: r.source,
      })),
      weekly: weekly.map((r) => ({
        ruleKey: r.ruleKey,
        qtyAccum: r.qtyAccum,
        materialCategory: r.materialCategory,
        materialTier: r.materialTier,
        source: r.source,
      })),
    };
  }
}

/**
 * ISO week bucket (`YYYY-Www`) theo timezone reset.
 *
 * Computes ISO 8601 week number — week 1 chứa Thursday đầu năm.
 * Reset Monday 00:00 theo `tz` (mặc định Asia/Ho_Chi_Minh).
 */
export function weekBucketFor(now: Date = new Date(), tz?: string): string {
  const dayStr = dayBucketFor(now, tz); // YYYY-MM-DD ở tz
  const [y, m, d] = dayStr.split('-').map(Number);
  // Build UTC date at tz-local day to avoid TZ-drift inside week math.
  const target = new Date(Date.UTC(y, m - 1, d));
  // ISO 8601: Monday=1..Sunday=7. JS Sunday=0..Saturday=6.
  const dayOfWeek = target.getUTCDay() === 0 ? 7 : target.getUTCDay();
  // Shift to Thursday of current ISO week.
  target.setUTCDate(target.getUTCDate() + 4 - dayOfWeek);
  const yearOfThursday = target.getUTCFullYear();
  const firstJan = new Date(Date.UTC(yearOfThursday, 0, 1));
  const weekNum = Math.ceil(((target.getTime() - firstJan.getTime()) / 86400000 + 1) / 7);
  return `${yearOfThursday}-W${String(weekNum).padStart(2, '0')}`;
}
