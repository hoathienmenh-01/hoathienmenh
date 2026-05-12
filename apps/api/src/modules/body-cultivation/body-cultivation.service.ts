import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BODY_CULTIVATION_INJURY_MS,
  BODY_REALMS,
  bodyExpCostForStage,
  bodyRateForRealm,
  computeBodyBreakthroughRequirement,
  computeBodyBreakthroughSuccessRate,
  computeBodyStatBonus,
  fullBodyRealmName,
  getBodyRealmByKey,
  nextBodyRealm,
  realmByKey,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { InventoryService } from '../inventory/inventory.service';
import { CharacterService } from '../character/character.service';

export class BodyCultivationError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export interface BodyCultivationStatus {
  bodyRealmKey: string;
  bodyRealmName: string;
  bodyStage: number;
  bodyExp: string;
  bodyExpNext: string;
  bodyRate: number;
  bodyCultivating: boolean;
  bodyInjuryUntil: string | null;
  physiqueKey: string | null;
  statBonus: ReturnType<typeof computeBodyStatBonus>;
  canBreakthrough: boolean;
  breakthroughRequirement: {
    fromOrder: number;
    toOrder: number;
    bodyExpCost: string;
    materials: readonly { itemKey: string; qty: number }[];
    pillItemKey: string | null;
    minSuccessRate: number;
  } | null;
  missingMaterials: readonly { itemKey: string; required: number; owned: number }[];
}

type CharacterBodyRow = {
  id: string;
  userId: string;
  realmKey: string;
  bodyRealmKey: string;
  bodyStage: number;
  bodyExp: bigint;
  bodyCultivating: boolean;
  bodyInjuryUntil: Date | null;
  physiqueKey: string | null;
};

@Injectable()
export class BodyCultivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly inventory: InventoryService,
    private readonly chars: CharacterService,
  ) {}

  async getStatus(userId: string): Promise<BodyCultivationStatus> {
    const c = await this.prisma.character.findUnique({
      where: { userId },
      select: {
        id: true,
        userId: true,
        realmKey: true,
        bodyRealmKey: true,
        bodyStage: true,
        bodyExp: true,
        bodyCultivating: true,
        bodyInjuryUntil: true,
        physiqueKey: true,
      },
    });
    if (!c) throw new BodyCultivationError('NO_CHARACTER');
    return this.statusFor(c);
  }

  async setBodyCultivating(
    userId: string,
    bodyCultivating: boolean,
  ): Promise<BodyCultivationStatus> {
    const existing = await this.prisma.character.findUnique({ where: { userId } });
    if (!existing) throw new BodyCultivationError('NO_CHARACTER');
    const c = await this.prisma.character.update({
      where: { userId },
      data: { bodyCultivating },
      select: {
        id: true,
        userId: true,
        realmKey: true,
        bodyRealmKey: true,
        bodyStage: true,
        bodyExp: true,
        bodyCultivating: true,
        bodyInjuryUntil: true,
        physiqueKey: true,
      },
    });
    await this.emitState(userId);
    return this.statusFor(c);
  }

  async attemptBreakthrough(
    userId: string,
    rng: () => number = Math.random,
    now: Date = new Date(),
  ): Promise<BodyCultivationStatus & { success: boolean; successRate: number }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const c = await tx.character.findUnique({
        where: { userId },
        select: {
          id: true,
          userId: true,
          realmKey: true,
          bodyRealmKey: true,
          bodyStage: true,
          bodyExp: true,
          bodyCultivating: true,
          bodyInjuryUntil: true,
          physiqueKey: true,
        },
      });
      if (!c) throw new BodyCultivationError('NO_CHARACTER');
      const bodyRealm = getBodyRealmByKey(c.bodyRealmKey) ?? BODY_REALMS[0]!;
      if (c.bodyStage < bodyRealm.stages) {
        throw new BodyCultivationError('NOT_AT_PEAK');
      }
      const next = nextBodyRealm(bodyRealm.key);
      if (!next) throw new BodyCultivationError('MAX_REALM');
      const qi = realmByKey(c.realmKey);
      if (!qi || next.order > qi.order + 1) {
        throw new BodyCultivationError('QI_GATE');
      }
      const req = computeBodyBreakthroughRequirement(bodyRealm.order, next.order);
      if (c.bodyExp < req.bodyExpCost) throw new BodyCultivationError('INSUFFICIENT_EXP');

      const inventoryRows = await tx.inventoryItem.findMany({
        where: { characterId: c.id, equippedSlot: null },
        select: { itemKey: true, qty: true },
      });
      const counts = new Map<string, number>();
      for (const row of inventoryRows) {
        counts.set(row.itemKey, (counts.get(row.itemKey) ?? 0) + row.qty);
      }
      for (const material of req.materials) {
        if ((counts.get(material.itemKey) ?? 0) < material.qty) {
          throw new BodyCultivationError('MISSING_MATERIALS');
        }
      }
      if (req.pillItemKey && (counts.get(req.pillItemKey) ?? 0) < 1) {
        throw new BodyCultivationError('MISSING_PILL');
      }

      const rate = computeBodyBreakthroughSuccessRate(
        bodyRealm.order,
        next.order,
        req.materials.map((m) => ({ itemKey: m.itemKey, qty: counts.get(m.itemKey) ?? 0 })),
        req.pillItemKey,
      );
      const success = rng() < rate;
      const injuryUntil = success ? null : new Date(now.getTime() + BODY_CULTIVATION_INJURY_MS);
      const log = await tx.bodyBreakthroughAttemptLog.create({
        data: {
          characterId: c.id,
          fromBodyRealmKey: bodyRealm.key,
          fromBodyStage: c.bodyStage,
          toBodyRealmKey: next.key,
          toBodyStage: 1,
          success,
          successRate: rate,
          materialsJson: req.materials as unknown as Prisma.InputJsonValue,
          pillItemKey: req.pillItemKey,
          injuryUntil,
        },
      });
      for (const material of req.materials) {
        for (let i = 0; i < material.qty; i += 1) {
          await this.inventory.consumeOneByItemKeyTx(tx, c.id, material.itemKey, {
            reason: 'BODY_BREAKTHROUGH',
            refType: 'BodyBreakthroughAttemptLog',
            refId: log.id,
          });
        }
      }
      if (req.pillItemKey) {
        await this.inventory.consumeOneByItemKeyTx(tx, c.id, req.pillItemKey, {
          reason: 'BODY_BREAKTHROUGH',
          refType: 'BodyBreakthroughAttemptLog',
          refId: log.id,
        });
      }
      const updated = await tx.character.update({
        where: { id: c.id },
        data: success
          ? {
              bodyRealmKey: next.key,
              bodyStage: 1,
              bodyExp: c.bodyExp - req.bodyExpCost,
              bodyBreakthroughCount: { increment: 1 },
              bodyInjuryUntil: null,
            }
          : {
              bodyExp: c.bodyExp - req.bodyExpCost / 4n,
              bodyInjuryUntil: injuryUntil,
            },
        select: {
          id: true,
          userId: true,
          realmKey: true,
          bodyRealmKey: true,
          bodyStage: true,
          bodyExp: true,
          bodyCultivating: true,
          bodyInjuryUntil: true,
          physiqueKey: true,
        },
      });
      return { updated, success, rate };
    });
    await this.emitState(userId);
    return {
      ...(await this.statusFor(result.updated)),
      success: result.success,
      successRate: result.rate,
    };
  }

  async bodyInventoryCounts(
    characterId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, number>> {
    const db = tx ?? this.prisma;
    const rows = await db.inventoryItem.findMany({
      where: { characterId, equippedSlot: null },
      select: { itemKey: true, qty: true },
    });
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.itemKey, (counts.get(row.itemKey) ?? 0) + row.qty);
    }
    return counts;
  }

  private async statusFor(c: CharacterBodyRow): Promise<BodyCultivationStatus> {
    const bodyRealm = getBodyRealmByKey(c.bodyRealmKey) ?? BODY_REALMS[0]!;
    const qi = realmByKey(c.realmKey);
    const bodyExpNext = bodyExpCostForStage(bodyRealm, c.bodyStage) ?? 0n;
    const statBonus = computeBodyStatBonus(bodyRealm.order, c.bodyStage);
    const next = nextBodyRealm(bodyRealm.key);
    const req =
      next && qi && next.order <= qi.order + 1
        ? computeBodyBreakthroughRequirement(bodyRealm.order, next.order)
        : null;
    const counts = await this.bodyInventoryCounts(c.id);
    const missingMaterials =
      req === null
        ? []
        : [
            ...req.materials.map((m) => ({
              itemKey: m.itemKey,
              required: m.qty,
              owned: counts.get(m.itemKey) ?? 0,
            })),
            ...(req.pillItemKey
              ? [
                  {
                    itemKey: req.pillItemKey,
                    required: 1,
                    owned: counts.get(req.pillItemKey) ?? 0,
                  },
                ]
              : []),
          ].filter((m) => m.owned < m.required);
    return {
      bodyRealmKey: bodyRealm.key,
      bodyRealmName: fullBodyRealmName(bodyRealm, c.bodyStage),
      bodyStage: c.bodyStage,
      bodyExp: c.bodyExp.toString(),
      bodyExpNext: bodyExpNext.toString(),
      bodyRate: bodyRateForRealm(bodyRealm.key),
      bodyCultivating: c.bodyCultivating,
      bodyInjuryUntil: c.bodyInjuryUntil ? c.bodyInjuryUntil.toISOString() : null,
      physiqueKey: c.physiqueKey,
      statBonus,
      canBreakthrough:
        req !== null &&
        c.bodyStage >= bodyRealm.stages &&
        c.bodyExp >= req.bodyExpCost &&
        missingMaterials.length === 0,
      breakthroughRequirement: req
        ? {
            fromOrder: req.fromOrder,
            toOrder: req.toOrder,
            bodyExpCost: req.bodyExpCost.toString(),
            materials: req.materials,
            pillItemKey: req.pillItemKey,
            minSuccessRate: req.minSuccessRate,
          }
        : null,
      missingMaterials,
    };
  }

  private async emitState(userId: string): Promise<void> {
    const fresh = await this.chars.findByUser(userId);
    if (fresh) this.realtime.emitToUser(userId, 'state:update', fresh);
  }
}
